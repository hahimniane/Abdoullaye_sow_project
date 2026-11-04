"use strict";

/**
 * Photos a customer picks inside a WhatsApp Flow (PhotoPicker, Flow JSON
 * 4.0+). The data-exchange payload does not carry the pictures: each one is
 * `{media_id, cdn_url, file_name, encryption_metadata}`, a file on WhatsApp's
 * CDN, encrypted. This module turns one into plain image bytes:
 *
 *   1. download cdn_url (WhatsApp hosts only, https, no redirects, capped);
 *   2. SHA-256(file) must equal `encrypted_hash`;
 *   3. the file is `ciphertext || hmac10`; hmac10 must equal the first 10
 *      bytes of HMAC-SHA256(hmac_key, iv || ciphertext);
 *   4. AES-256-CBC (PKCS#7) with `encryption_key` and `iv`;
 *   5. SHA-256(plaintext) must equal `plaintext_hash`;
 *   6. the bytes must be a JPEG, PNG or WebP under the size the web's
 *      request photos allow (package_requests.PHOTO_MAX_BYTES).
 *
 * Everything but the download is pure (test/whatsapp-package-flow.test.js
 * builds an encrypted fixture the same way). Spec:
 * developers.facebook.com/documentation/business-messaging/whatsapp/flows/
 * guides/media_upload
 */

const crypto = require("crypto");

const MAC_BYTES = 10;
const BLOCK = 16;
const KEY_BYTES = 32;
const CDN_TIMEOUT_MS = 6000;
const CDN_HOSTS = Object.freeze([".whatsapp.net", ".whatsapp.com",
  ".fbcdn.net"]);

/** A photo that cannot be used; `code` says why. */
class FlowMediaError extends Error {
  /**
   * @param {string} code Short reason.
   */
  constructor(code) {
    super(code);
    this.name = "FlowMediaError";
    this.code = code;
  }
}

const sha256b64 = (buffer) => crypto.createHash("sha256").update(buffer)
    .digest("base64");

const same = (a, b) => a.length === b.length &&
  crypto.timingSafeEqual(a, b);

/**
 * @param {string} value A CDN address from the payload.
 * @return {boolean} Whether it is an https address on a WhatsApp host.
 */
function cdnUrlValid(value) {
  let url = null;
  try {
    url = new URL(String(value || ""));
  } catch (error) {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password ||
      url.port) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return CDN_HOSTS.some((suffix) => host.endsWith(suffix));
}

/**
 * What kind of picture the bytes are, from their first bytes (the file name
 * and any type the payload claims are not trusted).
 *
 * @param {Buffer} bytes The picture.
 * @return {?{contentType: string, ext: string}} null when not a JPEG, PNG or
 *   WebP.
 */
function sniffImage(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[2] === 0xff) {
    return {contentType: "image/jpeg", ext: "jpg"};
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return {contentType: "image/png", ext: "png"};
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") ===
      "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    return {contentType: "image/webp", ext: "webp"};
  }
  return null;
}

/**
 * Checks and decrypts one downloaded file.
 *
 * @param {Buffer} file The CDN file: ciphertext followed by the 10-byte MAC.
 * @param {object} meta The payload's encryption_metadata {encrypted_hash,
 *   iv, encryption_key, hmac_key, plaintext_hash}, all base64.
 * @return {Buffer} The plain bytes.
 */
function decryptMedia(file, meta) {
  const m = meta && typeof meta === "object" ? meta : {};
  const b64 = (value) => Buffer.from(String(value || ""), "base64");
  const key = b64(m.encryption_key);
  const iv = b64(m.iv);
  const macKey = b64(m.hmac_key);
  if (key.length !== KEY_BYTES || iv.length !== BLOCK || !macKey.length ||
      !m.encrypted_hash || !m.plaintext_hash) {
    throw new FlowMediaError("media_metadata");
  }
  if (!same(b64(sha256b64(file)), b64(m.encrypted_hash))) {
    throw new FlowMediaError("media_hash");
  }
  if (file.length <= MAC_BYTES + BLOCK ||
      (file.length - MAC_BYTES) % BLOCK !== 0) {
    throw new FlowMediaError("media_shape");
  }
  const cipherText = file.subarray(0, file.length - MAC_BYTES);
  const mac = file.subarray(file.length - MAC_BYTES);
  const expected = crypto.createHmac("sha256", macKey).update(iv)
      .update(cipherText).digest().subarray(0, MAC_BYTES);
  if (!same(mac, expected)) throw new FlowMediaError("media_mac");
  let plain = null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    plain = Buffer.concat([decipher.update(cipherText), decipher.final()]);
  } catch (error) {
    throw new FlowMediaError("media_decrypt");
  }
  if (!same(b64(sha256b64(plain)), b64(m.plaintext_hash))) {
    throw new FlowMediaError("media_plain_hash");
  }
  return plain;
}

/**
 * Downloads a CDN file, never reading more than `maxBytes`.
 *
 * @param {string} url The CDN address (checked by cdnUrlValid).
 * @param {object} [options] {maxBytes, timeoutMs, fetchImpl}.
 * @return {Promise<Buffer>} The file.
 */
async function downloadCdn(url, {maxBytes, timeoutMs = CDN_TIMEOUT_MS,
  fetchImpl = fetch} = {}) {
  if (!cdnUrlValid(url)) throw new FlowMediaError("media_url");
  let res = null;
  try {
    res = await fetchImpl(url, {redirect: "error",
      signal: AbortSignal.timeout(timeoutMs)});
  } catch (error) {
    throw new FlowMediaError("media_download");
  }
  if (!res.ok) throw new FlowMediaError("media_download");
  const declared = Number(res.headers?.get?.("content-length") || 0);
  if (declared > maxBytes) throw new FlowMediaError("media_too_large");
  const chunks = [];
  let total = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => null);
        throw new FlowMediaError("media_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof FlowMediaError) throw error;
    throw new FlowMediaError("media_download");
  }
  return Buffer.concat(chunks);
}

/**
 * One picked photo, ready to store.
 *
 * @param {object} item One entry of the PhotoPicker value.
 * @param {object} options {maxBytes (the plain picture's limit, exclusive),
 *   download(url, {maxBytes}) -> Buffer (default: downloadCdn)}.
 * @return {Promise<{bytes: Buffer, contentType: string, ext: string}>}
 */
async function readPickedPhoto(item, {maxBytes, download = downloadCdn}) {
  const entry = item && typeof item === "object" ? item : {};
  // Ciphertext is at most one block (padding) and the MAC longer.
  const file = await download(String(entry.cdn_url || ""),
      {maxBytes: maxBytes + BLOCK + MAC_BYTES});
  const bytes = decryptMedia(file, entry.encryption_metadata);
  if (bytes.length === 0 || bytes.length >= maxBytes) {
    throw new FlowMediaError("media_too_large");
  }
  const kind = sniffImage(bytes);
  if (!kind) throw new FlowMediaError("media_type");
  return {bytes, ...kind};
}

module.exports = {
  FlowMediaError,
  CDN_HOSTS,
  cdnUrlValid,
  sniffImage,
  decryptMedia,
  downloadCdn,
  readPickedPhoto,
};
