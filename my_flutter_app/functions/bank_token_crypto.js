"use strict";

/**
 * The bank's access token, sealed at rest.
 *
 * A Plaid access token reads a business's bank account for as long as it
 * lives. Wouri stored it in plain text behind "rules deny all"; one leaked
 * backup or a mis-scoped export would then hand out read access to every
 * connected account. Here it is sealed with AES-256-GCM under the secret
 * BANK_TOKEN_KEY (32 random bytes, base64) and opened only inside a function.
 *
 * The business id is bound in as additional authenticated data, so a sealed
 * token copied onto another business's link document does not open there.
 *
 * Format: "v1:" + base64(iv[12] | tag[16] | ciphertext).
 */

const crypto = require("crypto");

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * @param {string} encoded BANK_TOKEN_KEY as stored (base64 of 32 bytes).
 * @return {Buffer} The key.
 */
function bankTokenKey(encoded) {
  const text = String(encoded || "").trim();
  const key = text ? Buffer.from(text, "base64") : Buffer.alloc(0);
  if (key.length !== KEY_BYTES) {
    throw new Error("BANK_TOKEN_KEY must be 32 bytes, base64 encoded");
  }
  return key;
}

/**
 * @param {string} plaintext The access token.
 * @param {string} keyBase64 BANK_TOKEN_KEY.
 * @param {string} businessId Bound as additional authenticated data.
 * @return {string} The sealed token.
 */
function encryptBankToken(plaintext, keyBase64, businessId) {
  const value = String(plaintext || "");
  if (!value) throw new Error("nothing to encrypt");
  const key = bankTokenKey(keyBase64);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(String(businessId || ""), "utf8"));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, body]).toString("base64")}`;
}

/**
 * Opens a sealed token. Throws on a wrong key, a wrong business, or any
 * change to the stored text: a tampered token never yields a value.
 *
 * @param {string} sealed What encryptBankToken returned.
 * @param {string} keyBase64 BANK_TOKEN_KEY.
 * @param {string} businessId The business it was sealed for.
 * @return {string} The access token.
 */
function decryptBankToken(sealed, keyBase64, businessId) {
  const text = String(sealed || "");
  const prefix = `${VERSION}:`;
  if (!text.startsWith(prefix)) throw new Error("unknown bank token format");
  const raw = Buffer.from(text.slice(prefix.length), "base64");
  if (raw.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("bank token is truncated");
  }
  const key = bankTokenKey(keyBase64);
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(String(businessId || ""), "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()])
      .toString("utf8");
}

module.exports = {
  KEY_BYTES,
  bankTokenKey,
  decryptBankToken,
  encryptBankToken,
};
