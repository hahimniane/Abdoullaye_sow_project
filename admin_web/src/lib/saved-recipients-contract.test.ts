import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SAVED_RECIPIENT_LIMIT,
  matchingSavedRecipients,
  savedRecipientFromData,
  savedRecipientIsUsable,
  savedRecipientMatches,
  savedRecipientsPath,
  type SavedRecipient,
} from "./saved-recipients.ts";
import { translateValue } from "./french-dom.ts";

const field = readFileSync("src/components/recipient-name-field.tsx", "utf8");
const shipping = readFileSync(
  "src/components/customer-shipping-services.tsx",
  "utf8",
);
const styles = readFileSync("src/app/globals.css", "utf8");

function recipient(overrides: Partial<SavedRecipient> = {}): SavedRecipient {
  return {
    id: "224622334455",
    name: "Amadou Diallo",
    phone: "+224622334455",
    phoneKey: "224622334455",
    countryId: "guinea",
    countryName: "Guinea",
    address: "12 Rue du Port",
    whatsappOnly: false,
    useCount: 3,
    ...overrides,
  };
}

test("stored recipients are read tolerantly and keyed on phone digits", () => {
  const parsed = savedRecipientFromData("224622334455", {
    name: "Amadou Diallo",
    phone: "+224 622 33 44 55",
    countryName: "Guinea",
    whatsappOnly: true,
  });
  assert.equal(parsed.name, "Amadou Diallo");
  assert.equal(parsed.whatsappOnly, true);
  assert.equal(parsed.phoneKey, "224622334455");
  assert.equal(parsed.address, "");
  assert.equal(parsed.useCount, 0);
  assert.equal(savedRecipientIsUsable(parsed), true);
  assert.equal(
    savedRecipientIsUsable(savedRecipientFromData("x", { name: "No phone" })),
    false,
  );
  assert.deepEqual(savedRecipientsPath("uid-1"), [
    "users",
    "uid-1",
    "savedRecipients",
  ]);
  assert.equal(SAVED_RECIPIENT_LIMIT, 50);
});

test("recipients match on name or phone digits, like the mobile field", () => {
  const person = recipient();
  assert.equal(savedRecipientMatches(person, "ama"), true);
  assert.equal(savedRecipientMatches(person, "DIALLO"), true);
  assert.equal(savedRecipientMatches(person, "622 33"), true);
  assert.equal(savedRecipientMatches(person, "+224"), true);
  assert.equal(savedRecipientMatches(person, "fatou"), false);
  // An empty box offers nothing, and letters must never match every phone.
  assert.equal(savedRecipientMatches(person, "   "), false);
  assert.equal(
    savedRecipientMatches(recipient({ name: "Fatou Barry" }), "zzz"),
    false,
  );
});

test("suggestions stop once the customer has the exact name", () => {
  const people = [
    recipient(),
    recipient({ id: "2", name: "Amadou Bah", phone: "+224622000111", phoneKey: "224622000111" }),
    recipient({ id: "3", name: "Amina Sow", phone: "+224622999888", phoneKey: "224622999888" }),
    recipient({ id: "4", name: "Amara Camara", phone: "+224622777666", phoneKey: "224622777666" }),
    recipient({ id: "5", name: "Amie Toure", phone: "+224622555444", phoneKey: "224622555444" }),
  ];
  assert.equal(matchingSavedRecipients(people, "").length, 0);
  assert.equal(matchingSavedRecipients(people, "am").length, 4);
  assert.equal(matchingSavedRecipients(people, "am", 2).length, 2);
  assert.deepEqual(
    matchingSavedRecipients(people, "amadou diallo").map((it) => it.id),
    [],
  );
  assert.equal(
    matchingSavedRecipients(
      [recipient({ phone: "", phoneKey: "" })],
      "amadou",
    ).length,
    0,
  );
});

test("the recipient field subscribes to the customer's own savedRecipients", () => {
  assert.match(field, /savedRecipientsPath\(uid\)/);
  assert.match(field, /orderBy\("lastUsedAt", "desc"\)/);
  assert.match(field, /limit\(SAVED_RECIPIENT_LIMIT\)/);
  assert.match(field, /onAuthStateChanged\(/);
  // A read failure must degrade to "no suggestions", never to a broken form.
  assert.match(field, /\(\) => setRecipients\(\[\]\),/);
  assert.match(field, /role="combobox"/);
  assert.match(field, /role="listbox"/);
});

test("every customer receiver-name input offers remembered recipients", () => {
  assert.match(shipping, /import \{ RecipientNameField \}/);
  for (const id of [
    "barrel-receiver-name",
    "barrel-order-receiver-name",
    "freight-receiver-name",
  ]) {
    assert.match(shipping, new RegExp(`<RecipientNameField[\\s\\S]{0,80}id="${id}"`));
  }
  // Three flows capture a receiver; none may fall back to a plain input.
  assert.equal(shipping.match(/<RecipientNameField/g)?.length, 3);
  assert.doesNotMatch(shipping, /Receiver name\s*\n\s*<input/);
  // Picking someone fills the phone and the WhatsApp-only flag.
  assert.equal(
    shipping.match(/setReceiverPhoneIsWhatsappOnly\(recipient\.whatsappOnly\)/g)
      ?.length,
    3,
  );
  assert.equal(
    shipping.match(/setReceiverPhone\(recipient\.phone\)/g)?.length,
    3,
  );
});

test("a saved number re-syncs the phone country instead of showing the wrong flag", () => {
  const phone = readFileSync("src/components/customer-phone-field.tsx", "utf8");
  assert.match(phone, /callingCodeOptionForPhone\(trimmed, initialCountryCode\)/);
  assert.match(phone, /if \(next && next\.code !== countryCode\)/);
});

test("recipient suggestions are localized and positioned over the form", () => {
  assert.equal(translateValue("Saved recipients", "fr"), "Destinataires enregistrés");
  assert.match(styles, /\.customer-recipient-field \{[^}]*position: relative;/s);
});
