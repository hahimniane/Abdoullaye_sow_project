import assert from "node:assert/strict";
import test from "node:test";

import { phoneFromTyped,
  CALLING_CODE_OPTIONS,
  callingCodeOptionForPhone,
  composeInternationalPhone,
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
