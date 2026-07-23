import assert from "node:assert/strict";
import test from "node:test";

import {
  receiverPhoneIsDifferentCountry,
  validateReceiverPhone,
} from "./receiver-phone-rules.ts";

test("receiver phone must match the selected destination country", () => {
  assert.deepEqual(
    validateReceiverPhone({
      destinationCountryCode: "GN",
      value: "+224620000001",
    }),
    { valid: true, differentCountry: false },
  );
  assert.deepEqual(
    validateReceiverPhone({
      destinationCountryCode: "SL",
      value: "+23276000001",
    }),
    { valid: true, differentCountry: false },
  );
  assert.deepEqual(
    validateReceiverPhone({
      destinationCountryCode: "GN",
      value: "224620000001",
    }),
    { valid: true, differentCountry: false },
  );
  assert.deepEqual(
    validateReceiverPhone({
      destinationCountryCode: "GN",
      value: "+12025550123",
    }),
    {
      valid: false,
      reason: "destination-mismatch",
      expectedDialCode: "+224",
    },
  );
});

test("a different-country number needs the explicit WhatsApp exception", () => {
  assert.deepEqual(
    validateReceiverPhone({
      allowDifferentCountry: true,
      destinationCountryCode: "GN",
      value: "+12025550123",
    }),
    { valid: true, differentCountry: true },
  );
  assert.equal(
    receiverPhoneIsDifferentCountry({
      destinationCountryCode: "GN",
      value: "+12025550123",
    }),
    true,
  );
  assert.equal(
    receiverPhoneIsDifferentCountry({
      destinationCountryCode: "GN",
      value: "12025550123",
    }),
    true,
  );
  assert.deepEqual(
    validateReceiverPhone({
      allowDifferentCountry: true,
      destinationCountryCode: "GN",
      value: "12025550123",
    }),
    {
      valid: false,
      reason: "whatsapp-country-code",
      expectedDialCode: "+224",
    },
  );
});

test("receiver phone validation preserves mobile international-number checks", () => {
  assert.deepEqual(
    validateReceiverPhone({
      destinationCountryCode: "GN",
      value: "",
    }),
    { valid: false, reason: "required" },
  );
  assert.deepEqual(
    validateReceiverPhone({
      destinationCountryCode: "GN",
      value: "not-a-phone",
    }),
    { valid: false, reason: "invalid" },
  );
});
