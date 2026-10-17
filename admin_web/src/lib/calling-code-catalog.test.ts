import assert from "node:assert/strict";
import test from "node:test";

import { phoneFromTyped,
  CALLING_CODE_OPTIONS,
  callingCodeOptionForCountry,
  callingCodeOptionForPhone,
  composeInternationalPhone,
  phoneFieldCountry,
  phoneFieldNationalNumber,
} from "./calling-code-catalog.ts";

test("web phone picker stays complete and aligned with mobile", () => {
  assert.ok(CALLING_CODE_OPTIONS.length >= 230);
  assert.equal(CALLING_CODE_OPTIONS[0].code, "US");
  assert.equal(
    callingCodeOptionForPhone("+224 620 00 00 00")?.code,
    "GN",
  );
  assert.equal(composeInternationalPhone("224", "620 00 00 00"), "+224620000000");
});

test("a pasted international number keeps its own country code, once", () => {
  const guinea = { code: "GN", callingCode: "224" };
  const picked: string[] = [];
  // Regression: "+224 620 00 00 01" typed with Guinea selected was stored as
  // +224224620000001 - a number no message can reach.
  assert.equal(phoneFromTyped("+224 620 00 00 01", guinea, "US", (c) => picked.push(c)), "+224620000001");
  assert.equal(picked.length, 0);
  // A pasted number from another country switches the picker to it.
  assert.equal(phoneFromTyped("+1 (646) 555-0100", guinea, "US", (c) => picked.push(c)), "+16465550100");
  assert.deepEqual(picked, ["US"]);
  // A local number still gets the selected country's code.
  assert.equal(phoneFromTyped("620 00 00 01", guinea, "US"), "+224620000001");
  assert.equal(phoneFromTyped("", guinea, "US"), "");
});

// A pure stand-in for CustomerPhoneField's state: the stored value plus the
// country the person picked, driven through the same helpers the field uses.
function phoneField(fallback: string, value = "") {
  let chosen: string | null = null;
  const option = () =>
    callingCodeOptionForCountry(phoneFieldCountry(value, chosen, fallback))!;
  return {
    get value() { return value; },
    get country() { return option().code; },
    get shown() { return phoneFieldNationalNumber(value, option()); },
    pick(code: string) {
      const next = callingCodeOptionForCountry(code)!;
      const national = phoneFieldNationalNumber(value, option());
      chosen = next.code;
      value = composeInternationalPhone(next.callingCode, national);
    },
    type(text: string) {
      const current = option();
      value = phoneFromTyped(text, current, current.code, (c) => { chosen = c; });
    },
  };
}

test("a country picked before any digits sticks (receiver default Guinea)", () => {
  const field = phoneField("GN");
  assert.equal(field.country, "GN");
  field.pick("US");
  assert.equal(field.value, "");
  assert.equal(field.country, "US", "the destination default must not win back");
  field.type("9175177935");
  assert.equal(field.value, "+19175177935");
  assert.equal(field.country, "US");
});

test("clearing the number keeps the picked country, and retyping is clean", () => {
  const field = phoneField("GN");
  field.pick("US");
  field.type("9175177935");
  field.type("");
  assert.equal(field.value, "");
  assert.equal(field.country, "US");
  for (let i = 0; i < 4; i += 1) {
    field.type("9175177935");
    assert.equal(field.value, "+19175177935");
    field.type("");
    assert.equal(field.country, "US");
  }
});

test("switching countries mid-number never stacks calling codes", () => {
  // Regression: "+2241224122412241224 19175177935" - the code re-prefixed
  // every time the field and its country disagreed.
  const field = phoneField("GN");
  for (const code of ["US", "GN", "US", "GN", "SN", "US"]) {
    field.type("9175177935");
    field.pick(code);
    const option = callingCodeOptionForCountry(code)!;
    assert.equal(field.value, `+${option.callingCode}9175177935`);
    assert.equal(field.shown, "9175177935");
    assert.equal(field.country, code);
  }
});

test("what the field shows always round-trips to the same stored value", () => {
  const values = [
    "", "+19175177935", "+224620000001", "+2241224", "+1224",
    "+8", "+86 138 0013 8000", "6200000", "+221 77 000 00 00",
  ];
  for (const fallback of ["GN", "US", "SN"]) {
    for (const chosen of [null, "US", "GN", "CA"]) {
      for (const start of values) {
        const option = callingCodeOptionForCountry(
          phoneFieldCountry(start, chosen, fallback),
        )!;
        const once = phoneFromTyped(phoneFieldNationalNumber(start, option), option, option.code);
        // Retyping what is on screen, again and again, reaches a fixpoint.
        let again = once;
        for (let i = 0; i < 3; i += 1) {
          const o = callingCodeOptionForCountry(phoneFieldCountry(again, chosen, fallback))!;
          again = phoneFromTyped(phoneFieldNationalNumber(again, o), o, o.code);
        }
        const label = `${start} under ${chosen ?? "-"}/${fallback}`;
        assert.equal(again, once, label);
        if (start.startsWith("+")) {
          assert.equal(once, `+${start.replace(/\D/g, "")}`, label);
        }
      }
    }
  }
});

test("composing an already-international value never prefixes it again", () => {
  assert.equal(composeInternationalPhone("224", "+19175177935"), "+19175177935");
  assert.equal(composeInternationalPhone("224", "+"), "");
  assert.equal(composeInternationalPhone("1", ""), "");
});

test("a number set from outside shows its own country; a shared +1 keeps the pick", () => {
  assert.equal(phoneFieldCountry("+16465550100", null, "GN"), "US");
  assert.equal(phoneFieldCountry("+16465550100", "CA", "GN"), "CA");
  assert.equal(phoneFieldCountry("+224620000001", "US", "US"), "GN");
  assert.equal(phoneFieldCountry("", "US", "GN"), "US");
  assert.equal(phoneFieldCountry("", null, "GN"), "GN");
});
