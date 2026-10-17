"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {describe, it} = require("node:test");

const {
  bankTokenKey,
  decryptBankToken,
  encryptBankToken,
} = require("../bank_token_crypto");

const KEY = crypto.randomBytes(32).toString("base64");
const OTHER_KEY = crypto.randomBytes(32).toString("base64");
const TOKEN = "access-sandbox-1234abcd-5678-efgh";

describe("bank access token sealing", () => {
  it("round-trips for the business it was sealed for", () => {
    const sealed = encryptBankToken(TOKEN, KEY, "biz_a");
    assert.match(sealed, /^v1:[A-Za-z0-9+/=]+$/);
    assert.ok(!sealed.includes(TOKEN), "the token must not appear in clear");
    assert.equal(decryptBankToken(sealed, KEY, "biz_a"), TOKEN);
  });

  it("never seals the same token to the same text twice", () => {
    assert.notEqual(encryptBankToken(TOKEN, KEY, "biz_a"),
        encryptBankToken(TOKEN, KEY, "biz_a"));
  });

  it("refuses a sealed token that was changed by one bit", () => {
    const sealed = encryptBankToken(TOKEN, KEY, "biz_a");
    const raw = Buffer.from(sealed.slice(3), "base64");
    for (const at of [0, 12, 28, raw.length - 1]) {
      const copy = Buffer.from(raw);
      copy[at] ^= 0x01;
      assert.throws(() => decryptBankToken(`v1:${copy.toString("base64")}`,
          KEY, "biz_a"), `byte ${at} flipped must not open`);
    }
  });

  it("refuses the wrong key, the wrong business and odd input", () => {
    const sealed = encryptBankToken(TOKEN, KEY, "biz_a");
    assert.throws(() => decryptBankToken(sealed, OTHER_KEY, "biz_a"));
    assert.throws(() => decryptBankToken(sealed, KEY, "biz_b"));
    assert.throws(() => decryptBankToken(TOKEN, KEY, "biz_a"));
    assert.throws(() => decryptBankToken("v1:AAAA", KEY, "biz_a"));
    assert.throws(() => decryptBankToken("", KEY, "biz_a"));
  });

  it("insists on a 32-byte key", () => {
    assert.equal(bankTokenKey(KEY).length, 32);
    assert.throws(() => bankTokenKey(""));
    assert.throws(() => bankTokenKey("unset"));
    assert.throws(() =>
      bankTokenKey(crypto.randomBytes(16).toString("base64")));
    assert.throws(() => encryptBankToken(TOKEN, "short", "biz_a"));
    assert.throws(() => encryptBankToken("", KEY, "biz_a"));
  });
});
