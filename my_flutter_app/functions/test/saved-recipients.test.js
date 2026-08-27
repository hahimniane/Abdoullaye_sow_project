"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  recipientPhoneKey,
  buildSavedRecipient,
  mergeSavedRecipient,
} = require("../saved_recipients");

const BASE = Object.freeze({
  receiverName: "Amadou Diallo",
  receiverPhone: "+224 620 00 00 22",
  destinationCountryId: "guinea",
  destinationCountryName: "Guinea",
  source: "barrel",
});

describe("identifying a saved recipient", () => {
  it("keys on the phone digits, ignoring formatting", () => {
    assert.equal(recipientPhoneKey("+224 620-00-00-22"), "224620000022");
    assert.equal(recipientPhoneKey("(718) 555-0148"), "7185550148");
    // The same number typed two ways is the same recipient.
    assert.equal(
        recipientPhoneKey("+1 718 555 0148"),
        `1${recipientPhoneKey("(718) 555-0148")}`,
    );
    assert.equal(recipientPhoneKey(""), "");
  });

  it("builds a record whose id is the phone key", () => {
    const record = buildSavedRecipient(BASE);
    assert.equal(record.id, "224620000022");
    assert.equal(record.data.name, "Amadou Diallo");
    assert.equal(record.data.countryId, "guinea");
    assert.equal(record.data.whatsappOnly, false);
    assert.equal(record.data.lastSource, "barrel");
  });

  it("refuses to remember someone with no phone", () => {
    // Without a phone there is no reliable identity, and a guessed one would
    // merge two different people onto one record.
    assert.equal(buildSavedRecipient({...BASE, receiverPhone: ""}), null);
    assert.equal(buildSavedRecipient({...BASE, receiverPhone: "n/a"}), null);
  });

  it("refuses a nameless record and an unknown service", () => {
    assert.equal(buildSavedRecipient({...BASE, receiverName: "  "}), null);
    assert.equal(buildSavedRecipient({...BASE, source: "wallet"}), null);
  });

  it("carries the whatsapp-only flag and address when present", () => {
    const record = buildSavedRecipient({
      ...BASE,
      source: "freight",
      address: "12 Rue du Port, Conakry",
      receiverPhoneIsWhatsappOnly: true,
    });
    assert.equal(record.data.address, "12 Rue du Port, Conakry");
    assert.equal(record.data.whatsappOnly, true);
    assert.equal(record.data.lastSource, "freight");
  });
});

describe("merging repeat sends onto one recipient", () => {
  it("counts uses and keeps the newest details", () => {
    const first = buildSavedRecipient(BASE).data;
    const stored = mergeSavedRecipient(null, first);
    assert.equal(stored.useCount, 1);

    const second = buildSavedRecipient({
      ...BASE,
      receiverName: "Amadou D.",
      source: "carTransport",
    }).data;
    const merged = mergeSavedRecipient(stored, second);
    assert.equal(merged.useCount, 2);
    assert.equal(merged.name, "Amadou D.");
    assert.equal(merged.lastSource, "carTransport");
  });

  it("never blanks a known detail with an empty one", () => {
    // Re-sending without typing the address again must not erase it.
    const withAddress = mergeSavedRecipient(
        null,
        buildSavedRecipient({...BASE, address: "12 Rue du Port"}).data,
    );
    const withoutAddress = mergeSavedRecipient(
        withAddress,
        buildSavedRecipient(BASE).data,
    );
    assert.equal(withoutAddress.address, "12 Rue du Port");
    assert.equal(withoutAddress.useCount, 2);
  });

  it("does let a real new value replace the old one", () => {
    const first = mergeSavedRecipient(
        null,
        buildSavedRecipient({...BASE, address: "12 Rue du Port"}).data,
    );
    const second = mergeSavedRecipient(
        first,
        buildSavedRecipient({...BASE, address: "40 Avenue de la Paix"}).data,
    );
    assert.equal(second.address, "40 Avenue de la Paix");
  });
});
