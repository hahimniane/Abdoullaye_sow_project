"use strict";

/**
 * Helpers for the business-card wallet tests: a throwaway self-signed
 * certificate and key (so the real passkit-generator signs a real .pkpass
 * without Apple's certificate), a reader for the zip a pass is delivered as,
 * and a check of the pass's detached PKCS#7 signature. Not a test file: the
 * name has no ".test".
 */

const crypto = require("node:crypto");
const zlib = require("node:zlib");
const forge = require("node-forge");

let cached = null;

/**
 * @return {{certPem: string, keyPem: string}} A self-signed certificate and
 *     its key, made once per run. It also stands in for Apple's WWDR cert.
 */
function makeTestCertificate() {
  if (cached) return cached;
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 3600000);
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  const subject = [{name: "commonName", value: "Laawol test pass certificate"}];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  cached = {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
  return cached;
}

/**
 * @return {{privateKey: string, publicKey: string}} An RSA pair standing in
 *     for the Google service account's key.
 */
function makeRsaPair() {
  const {privateKey, publicKey} = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {type: "pkcs8", format: "pem"},
    publicKeyEncoding: {type: "spki", format: "pem"},
  });
  return {privateKey, publicKey};
}

/**
 * Every file in a zip, by name (reads the central directory, so data
 * descriptors are fine).
 *
 * @param {Buffer} zip The pkpass.
 * @return {Object<string, Buffer>} The files.
 */
function unzip(zip) {
  const files = {};
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("not a zip");
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i += 1) {
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength)
        .toString("utf8");
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const data = zip.subarray(start, start + compressedSize);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/**
 * Checks a pass's detached PKCS#7 signature against its manifest: the
 * signed attributes carry the manifest's digest, and the certificate's key
 * signed those attributes.
 *
 * @param {Buffer} signature The `signature` file.
 * @param {Buffer} manifest The `manifest.json` bytes.
 * @param {string} certPem The signer's certificate.
 * @return {boolean} True when the signature is genuine.
 */
function signatureValid(signature, manifest, certPem) {
  const asn1 = forge.asn1.fromDer(
      forge.util.createBuffer(signature.toString("binary")));
  const p7 = forge.pkcs7.messageFromAsn1(asn1);
  const raw = p7.rawCapture;
  const oid = forge.asn1.derToOid(raw.digestAlgorithm);
  const algorithm = forge.pki.oids[oid];
  const digest = (bytes) => {
    const md = forge.md[algorithm].create();
    md.update(bytes);
    return md.digest().getBytes();
  };
  const attributes = forge.asn1.create(forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SET, true, raw.authenticatedAttributes);
  const signed = digest(forge.asn1.toDer(attributes).getBytes());
  const cert = forge.pki.certificateFromPem(certPem);
  if (!cert.publicKey.verify(signed, raw.signature)) return false;
  // The manifest's own digest must be the one the attributes carry.
  const wanted = digest(manifest.toString("binary"));
  return raw.authenticatedAttributes.some((attribute) => {
    const type = forge.asn1.derToOid(attribute.value[0].value);
    return type === forge.pki.oids.messageDigest &&
      attribute.value[1].value[0].value === wanted;
  });
}

module.exports = {makeRsaPair, makeTestCertificate, signatureValid, unzip};
