"use strict";

// Every function that opens the bank link or records a Fleet payment must
// declare the bank and WhatsApp secrets: without them "Check bank now"
// failed ("bank token could not be opened") and receipts could not send
// (2026-11-12). Reads the deployed options only; nothing runs.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

process.env.FUNCTIONS_EMULATOR = "true";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "demo-secrets";
const functions = require("../index");

const NEED = ["PLAID_CLIENT_ID", "PLAID_SECRET", "BANK_TOKEN_KEY",
  "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"];

describe("Fleet functions declare their secrets", () => {
  for (const name of ["fleetAction", "fleetBankRefresh", "plaidWebhook",
    "checkZellePayment", "connectBusinessBank"]) {
    it(name, () => {
      const keys = (functions[name].__endpoint.secretEnvironmentVariables ||
          []).map((s) => s.key);
      for (const key of NEED) {
        assert.ok(keys.includes(key), `${name} is missing ${key}`);
      }
    });
  }
});
