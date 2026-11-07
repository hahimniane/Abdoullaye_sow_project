"use strict";

/**
 * Apple Wallet and Google Wallet copies of a business card
 * (docs/BUSINESS_CARDS.md "Wallet passes"). Ported from the Wouri member
 * card (wouri-app/functions/src/services/appleWallet.ts and
 * googleWallet.ts), which signs real passes in production.
 *
 * A pass is a static copy of what the public card page shows: it is built
 * from `publicCard()` (business_cards.js), so it can never carry an email, a
 * role, a permission or a uid. There is no web service and no push, so a
 * changed number does not reach a pass already saved; the QR on it opens the
 * live card page, which is always right.
 *
 * Pure-ish: no Firestore. Secrets arrive as plain values, the clock and the
 * image fetch are injectable, so the tests run it with a throwaway
 * certificate.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/** The Apple Developer team that owns the Laawol app and the pass cert. */
const APPLE_TEAM_ID = "GRKB7BXVZK";

/** Ten minutes: long enough to open the link, short enough to be dead soon. */
const PASS_LINK_TTL_SECONDS = 10 * 60;

/** Google accepts a "save" link of about 1800 characters at most. */
const GOOGLE_MAX_JWT_LENGTH = 1800;
const GOOGLE_SAVE_URL = "https://pay.google.com/gp/v/save/";
const GOOGLE_ORIGINS = Object.freeze([
  "https://laawoldigital.com", "https://customer.laawoldigital.com"]);
/** Shown on Google's card for a business with no logo of its own. */
const GOOGLE_FALLBACK_LOGO = "https://laawoldigital.com/assets/logo.png";

/**
 * The business's main color as a hex (mirrors CARD_COLORS in
 * admin_web/src/lib/business-card.ts; business-card-wallet.test.js fails when
 * the two drift). Each one passes 4.5:1 under white text.
 */
const CARD_COLOR_HEX = Object.freeze({
  laawol: "#0b3b38",
  teal: "#0f766e",
  indigo: "#3730a3",
  forest: "#166534",
  burgundy: "#881337",
  saffron: "#b45309",
  charcoal: "#1f2937",
  ocean: "#075985",
  plum: "#6b21a8",
  navy: "#0a214a",
});

// ---------------------------------------------------------------------------
// Secrets.
// ---------------------------------------------------------------------------

/** A secret bound before the owner had the real value holds a placeholder. */
const PLACEHOLDERS = new Set(["", "unset", "disabled", "none", "-"]);

/**
 * @param {*} value A secret's value.
 * @return {string} The value, "" when missing or still a placeholder.
 */
function cleanSecret(value) {
  const text = String(value == null ? "" : value).trim();
  return PLACEHOLDERS.has(text.toLowerCase()) ? "" : text;
}

/**
 * Which wallets are set up. Never throws: a project without the secrets
 * simply has no wallet buttons.
 *
 * @param {object} secrets `{appleCertPem, appleKeyPem, appleWwdrPem,
 *     applePassTypeId, googleIssuerId, googleSaKey}`, raw values.
 * @return {{apple: ?object, google: ?object}} Each half, or null.
 */
function walletConfig(secrets) {
  const s = secrets || {};
  const certPem = cleanSecret(s.appleCertPem);
  const keyPem = cleanSecret(s.appleKeyPem);
  const wwdrPem = cleanSecret(s.appleWwdrPem);
  const passTypeId = cleanSecret(s.applePassTypeId);
  const apple = certPem && keyPem && wwdrPem && passTypeId ?
    {certPem, keyPem, wwdrPem, passTypeId} : null;

  let google = null;
  const issuerId = cleanSecret(s.googleIssuerId);
  const rawKey = cleanSecret(s.googleSaKey);
  if (issuerId && rawKey) {
    try {
      const key = JSON.parse(rawKey);
      if (typeof key?.client_email === "string" && key.client_email &&
          typeof key?.private_key === "string" && key.private_key) {
        google = {issuerId, clientEmail: key.client_email,
          privateKey: key.private_key};
      }
    } catch (_) {
      google = null;
    }
  }
  return {apple, google};
}

// ---------------------------------------------------------------------------
// What the card says (mirrors admin_web/src/lib/business-card.ts).
// ---------------------------------------------------------------------------

const oneLine = (value, max) => String(value == null ? "" : value)
    .replace(/\s+/g, " ").trim().slice(0, max);

/**
 * A name as a card prints it: all capitals or all small letters get a
 * capital per word; a name with its own mix of cases is left alone.
 *
 * @param {*} value The name.
 * @return {string} The printed name.
 */
function cardName(value) {
  const name = oneLine(value, 120);
  const letters = name.replace(/[^\p{L}]/gu, "");
  const lower = letters.toLowerCase();
  if (!letters || (letters !== lower && letters !== letters.toUpperCase())) {
    return name;
  }
  return name.toLowerCase().replace(/(^|[\s\-'’.&/])(\p{L})/gu,
      (_, before, letter) => before + letter.toUpperCase());
}

/**
 * A phone as a card prints it. Ten bare digits are a US number; anything
 * else is shown as typed.
 *
 * @param {*} phone The number as stored.
 * @return {{display: string, tel: ?string}} How to show it and its tel: link.
 */
function cardDial(phone) {
  const typed = oneLine(phone, 40);
  const digits = typed.replace(/\D/g, "");
  if (digits.length < 5) return {display: "", tel: null};
  const plus = typed.startsWith("+");
  const doubled = plus && digits.length === 12 && digits.startsWith("11");
  const us = (!plus && digits.length === 10) ||
    (digits.length === 11 && digits.startsWith("1")) || doubled ?
    digits.slice(-10) : "";
  if (us) {
    return {
      display: `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}`,
      tel: `tel:+1${us}`,
    };
  }
  return {display: typed, tel: `tel:${plus ? "+" : ""}${digits}`};
}

/**
 * @param {string} website What was typed as the website.
 * @return {string} `sahelauto.example`.
 */
function websiteLabel(website) {
  return oneLine(website, 120).replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "").replace(/\/+$/, "");
}

/**
 * @param {object} business A card's business half.
 * @return {string} `12 Example Ave, Bronx, NY 10457`.
 */
function cardAddress(business) {
  const region = [business.state, business.postalCode].filter(Boolean)
      .join(" ");
  return [business.addressLine1, business.city, region].filter(Boolean)
      .join(", ");
}

/** The words a switched-on service puts on a card, in card order. */
const SERVICE_WORDS = Object.freeze([
  {services: ["carSales"], en: "Buy and sell cars",
    fr: "Achat et vente de voitures"},
  {services: ["carParking"], en: "Car parking",
    fr: "Stationnement de voitures"},
  {services: ["barrelShipping", "sharedBarrels", "freight"],
    en: "Package and barrel shipping", fr: "Expédition de colis et de barils"},
  {services: ["carTransport"], en: "Car transport",
    fr: "Transport de voitures"},
  {services: ["inventory"], en: "Shop", fr: "Boutique"},
]);

const SERVICES_MAX = 6;

/**
 * The service lines a card lists: what the owner wrote, else what is
 * switched on.
 *
 * @param {object} card A publicCard().
 * @return {{en: string[], fr: string[], written: boolean}} The lines.
 */
function cardServiceLines(card) {
  const written = card.settings?.services || [];
  if (written.length) {
    const lines = written.slice(0, SERVICES_MAX);
    return {en: lines, fr: lines, written: true};
  }
  const on = card.business?.services || [];
  const rows = SERVICE_WORDS.filter((entry) =>
    entry.services.some((id) => on.includes(id))).slice(0, SERVICES_MAX);
  return {en: rows.map((row) => row.en), fr: rows.map((row) => row.fr),
    written: false};
}

/**
 * Everything a pass prints, from one public card. The only input is
 * `publicCard()`'s output, so the pass shows what the web card shows.
 *
 * @param {object} card A publicCard().
 * @return {object} The model both wallets draw.
 */
function walletCardModel(card) {
  const business = card.business || {};
  const businessName = cardName(business.name) || "Laawol";
  const personName = card.person ? cardName(card.person.name) : "";
  const direct = card.person ? cardDial(card.person.phone) : cardDial("");
  const office = cardDial(business.phone);
  const website = websiteLabel(business.website);
  const services = cardServiceLines(card);
  const colorKey = card.settings?.color;
  return {
    code: card.code,
    link: card.link,
    businessName,
    personName,
    title: personName || businessName,
    direct: direct.display,
    office: office.display,
    address: cardAddress(business),
    website,
    websiteHref: /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(website) ?
      `https://${website}` : "",
    services,
    colorHex: CARD_COLOR_HEX[colorKey] || CARD_COLOR_HEX.laawol,
    logoUrl: business.logoUrl || "",
  };
}

// ---------------------------------------------------------------------------
// Images.
// ---------------------------------------------------------------------------

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * A logo URL is typed by a business, so it is not fetched blindly: https and
 * a storage or Laawol host only (no internal addresses).
 */
const IMAGE_HOSTS = Object.freeze([
  /^firebasestorage\.googleapis\.com$/,
  /^storage\.googleapis\.com$/,
  /\.firebasestorage\.app$/,
  /\.googleusercontent\.com$/,
  /^([a-z0-9-]+\.)?laawoldigital\.com$/,
]);

/**
 * @param {*} value A URL.
 * @return {boolean} True for an https image on a host we already use.
 */
function isFetchableImageUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" &&
      IMAGE_HOSTS.some((pattern) => pattern.test(url.hostname));
  } catch (_) {
    return false;
  }
}

let markCache = null;
/** @return {Buffer} The bundled Laawol mark (assets/laawol-mark.png). */
function laawolMarkPng() {
  if (!markCache) {
    markCache = fs.readFileSync(path.join(__dirname, "assets",
        "laawol-mark.png"));
  }
  return markCache;
}

/**
 * Downloads a PNG or JPEG, or null for anything else: a missing logo must
 * never stop a person getting a pass. A JPEG goes into the pass under the
 * .png name; Wallet reads the bytes, not the extension.
 *
 * @param {string} url The logo.
 * @param {function} fetchImpl `fetch`, injectable.
 * @return {Promise<?Buffer>} The image bytes.
 */
async function fetchWalletImage(url, fetchImpl) {
  if (!isFetchableImageUrl(url)) return null;
  const get = fetchImpl || ((...args) => fetch(...args));
  try {
    const response = await get(url, {signal: AbortSignal.timeout(8000)});
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
    const image = bytes.subarray(0, 4).equals(PNG_MAGIC) ||
      bytes.subarray(0, 3).equals(JPEG_MAGIC);
    return image ? bytes : null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Apple.
// ---------------------------------------------------------------------------

const hexToRgb = (hex) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgb = (parts) => `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;

/**
 * Labels sit a little softer than the values: white toward the color.
 *
 * @param {string} bgHex The card color.
 * @return {string} An rgb() color.
 */
const labelRgb = (bgHex) => {
  const bg = hexToRgb(bgHex) || [11, 59, 56];
  return rgb([0, 1, 2].map((i) => Math.round(255 * 0.78 + bg[i] * 0.22)));
};

const FR = Object.freeze({
  "Direct": "Direct",
  "Office": "Bureau",
  "Address": "Adresse",
  "Website": "Site web",
  "Services": "Services",
  "Card page": "Page de la carte",
});

/**
 * The pass.json half of a card: layout and colors, as plain data (the signed
 * zip is built from it in buildApplePass).
 *
 * @param {object} model walletCardModel().
 * @param {object} apple `walletConfig().apple`.
 * @return {object} `{props, fields}`.
 */
function applePassLayout(model, apple) {
  const props = {
    formatVersion: 1,
    serialNumber: `laawol-card-${model.code}`,
    passTypeIdentifier: apple.passTypeId,
    teamIdentifier: APPLE_TEAM_ID,
    organizationName: model.businessName,
    description: `${model.businessName} business card`,
    logoText: model.businessName,
    backgroundColor: rgb(hexToRgb(model.colorHex)),
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: labelRgb(model.colorHex),
  };
  const phone = "PKDataDetectorTypePhoneNumber";
  const fields = {
    primary: [{key: "name", value: model.title}],
    secondary: [],
    back: [],
  };
  if (model.personName && model.direct) {
    fields.secondary.push({key: "direct", label: "Direct",
      value: model.direct, dataDetectorTypes: [phone]});
  }
  if (model.office) {
    fields.secondary.push({key: "office", label: "Office",
      value: model.office, dataDetectorTypes: [phone]});
  }
  if (model.address) {
    fields.back.push({key: "address", label: "Address",
      value: model.address});
  }
  if (model.website) {
    fields.back.push({key: "website", label: "Website",
      value: model.website, dataDetectorTypes: ["PKDataDetectorTypeLink"]});
  }
  if (model.services.en.length) {
    fields.back.push({key: "services", label: "Services",
      value: model.services.en.join(", ")});
  }
  fields.back.push({key: "card", label: "Card page", value: model.link,
    dataDetectorTypes: ["PKDataDetectorTypeLink"]});
  return {props, fields};
}

/**
 * The signed .pkpass of one card: a zip of pass.json, the images, a manifest
 * of SHA-1s and a detached PKCS#7 signature made with the Pass Type ID
 * certificate (passkit-generator does the signing, as in Wouri).
 *
 * @param {object} input `{card, config, logo}`: a publicCard(), the Apple
 *     half of walletConfig(), and the logo bytes (null for none; left out,
 *     the business's own logo is fetched).
 * @return {Promise<Buffer>} The pkpass bytes.
 */
async function buildApplePass(input) {
  const {card, config} = input;
  // Lazy: passkit-generator pulls in joi and node-forge, which the other
  // functions in this module never need.
  const {PKPass} = require("passkit-generator");
  const model = walletCardModel(card);
  const logo = input.logo !== undefined ? input.logo :
    await fetchWalletImage(model.logoUrl, input.fetchImpl);
  const image = logo || laawolMarkPng();
  const {props, fields} = applePassLayout(model, config);

  const pass = new PKPass({
    "icon.png": image,
    "icon@2x.png": image,
    "logo.png": image,
    "logo@2x.png": image,
  }, {
    wwdr: config.wwdrPem,
    signerCert: config.certPem,
    signerKey: config.keyPem,
  }, props);
  pass.type = "generic";
  fields.primary.forEach((field) => pass.primaryFields.push(field));
  fields.secondary.forEach((field) => pass.secondaryFields.push(field));
  fields.back.forEach((field) => pass.backFields.push(field));
  pass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: model.link,
    messageEncoding: "iso-8859-1",
  });

  const strings = {...FR};
  if (!model.services.written && model.services.en.length) {
    strings[model.services.en.join(", ")] = model.services.fr.join(", ");
  }
  pass.localize("fr", strings);
  return pass.getAsBuffer();
}

// ---------------------------------------------------------------------------
// The short-lived download link (served by parkingDocument, view=card-pass).
// ---------------------------------------------------------------------------

const b64url = (input) => Buffer.from(input).toString("base64url");

/**
 * The link's key is derived from the pass signing key, so a download token
 * can never be mistaken for anything else signed with it, and no new secret
 * is needed: the link is only worth anything where Apple is set up.
 *
 * @param {string} keyPem The Pass Type ID private key.
 * @return {Buffer} The HMAC key.
 */
function linkKey(keyPem) {
  return crypto.createHmac("sha256", keyPem)
      .update("laawol-card-pass-link-v1").digest();
}

/**
 * @param {string} keyPem The Pass Type ID private key.
 * @param {string} code The card's code.
 * @param {number} nowMs The clock.
 * @return {string} `body.mac`, good for ten minutes.
 */
function signCardPassToken(keyPem, code, nowMs = Date.now()) {
  const body = b64url(JSON.stringify({
    c: String(code), e: Math.floor(nowMs / 1000) + PASS_LINK_TTL_SECONDS}));
  const mac = crypto.createHmac("sha256", linkKey(keyPem)).update(body)
      .digest();
  return `${body}.${b64url(mac)}`;
}

/**
 * @param {string} keyPem The Pass Type ID private key.
 * @param {string} token A token from signCardPassToken.
 * @param {number} nowMs The clock.
 * @return {?{c: string, e: number}} The claims when genuine and unexpired.
 */
function verifyCardPassToken(keyPem, token, nowMs = Date.now()) {
  const [body, mac, ...rest] = String(token == null ? "" : token).split(".");
  if (!body || !mac || rest.length) return null;
  const expected = crypto.createHmac("sha256", linkKey(keyPem)).update(body)
      .digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length ||
      !crypto.timingSafeEqual(given, expected)) {
    return null;
  }
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof claims?.c !== "string" || !claims.c ||
        typeof claims?.e !== "number" || claims.e * 1000 < nowMs) {
      return null;
    }
    return {c: claims.c, e: claims.e};
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Google.
// ---------------------------------------------------------------------------

/**
 * @param {object} claims The JWT body.
 * @param {string} privateKey The service account's RSA key.
 * @return {string} An RS256 JWT.
 */
function signRs256Jwt(claims, privateKey) {
  const head = b64url(JSON.stringify({alg: "RS256", typ: "JWT"}));
  const body = b64url(JSON.stringify(claims));
  const signature = crypto.createSign("RSA-SHA256")
      .update(`${head}.${body}`).sign(privateKey);
  return `${head}.${body}.${b64url(signature)}`;
}

const googleClassId = (issuerId) => `${issuerId}.laawol_card`;
const googleObjectId = (issuerId, code) => `${issuerId}.laawol_card_${code}`;

const localized = (value) => ({defaultValue: {language: "en", value}});

/**
 * The Generic pass object of one card. `keep` says which optional parts to
 * leave in, so a long card can be trimmed to fit Google's link limit.
 *
 * @param {string} issuerId The Wallet issuer id.
 * @param {object} model walletCardModel().
 * @param {object} keep `{office, address, website, services, logo, short}`.
 * @return {object} The genericObject.
 */
function googleObject(issuerId, model, keep) {
  const modules = [];
  if (keep.office && model.personName && model.office) {
    modules.push({id: "office", header: "Office", body: model.office});
  }
  if (keep.address && model.address) {
    modules.push({id: "address", header: "Address", body: model.address});
  }
  if (keep.website && model.website) {
    modules.push({id: "website", header: "Website", body: model.website});
  }
  if (keep.services && model.services.en.length) {
    modules.push({id: "services", header: "Services",
      body: model.services.en.join(", ")});
  }
  const subheader = model.personName && model.direct ?
    `Direct ${model.direct}` : (model.office ? `Office ${model.office}` : "");
  const logo = keep.logo && model.logoUrl ? model.logoUrl :
    GOOGLE_FALLBACK_LOGO;
  // Every character counts: the whole pass rides in a link Google limits to
  // about 1800. So no optional field Google fills in by itself (state is
  // ACTIVE unless said otherwise), and names are cut short as a last resort.
  const cut = (value) => keep.short && value.length > 28 ?
    `${value.slice(0, 27)}…` : value;
  return {
    id: googleObjectId(issuerId, model.code),
    classId: googleClassId(issuerId),
    cardTitle: localized(cut(model.businessName)),
    header: localized(cut(model.title)),
    ...(subheader ? {subheader: localized(subheader)} : {}),
    logo: {sourceUri: {uri: logo}},
    hexBackgroundColor: model.colorHex,
    barcode: {type: "QR_CODE", value: model.link},
    ...(modules.length ? {textModulesData: modules} : {}),
  };
}

/** What to drop, in order, until the link fits (the card page has it all). */
const GOOGLE_TRIM_STEPS = Object.freeze([
  {office: true, address: true, website: true, services: true, logo: true},
  {office: true, address: true, website: true, services: false, logo: true},
  {office: true, address: true, website: false, services: false, logo: true},
  {office: true, address: false, website: false, services: false, logo: true},
  {office: false, address: false, website: false, services: false,
    logo: true},
  {office: false, address: false, website: false, services: false,
    logo: false},
  {office: false, address: false, website: false, services: false,
    logo: false, short: true},
]);

/**
 * The claims of a "Save to Google Wallet" JWT. The class and the object ride
 * inside it, so saving needs no call to Google's API (Google creates both
 * when the person taps Save).
 *
 * @param {object} google `walletConfig().google`.
 * @param {object} card A publicCard().
 * @param {object} keep Optional parts to include.
 * @param {number} nowMs The clock.
 * @return {object} The JWT claims.
 */
function googleSaveClaims(google, card, keep, nowMs = Date.now()) {
  const model = walletCardModel(card);
  return {
    iss: google.clientEmail,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(nowMs / 1000),
    origins: [...GOOGLE_ORIGINS],
    payload: {
      genericClasses: [{id: googleClassId(google.issuerId)}],
      genericObjects: [googleObject(google.issuerId, model, keep)],
    },
  };
}

/**
 * The "Save to Google Wallet" URL for one card: the fullest pass whose link
 * fits Google's limit.
 *
 * @param {object} google `walletConfig().google`.
 * @param {object} card A publicCard().
 * @param {number} nowMs The clock.
 * @return {string} `https://pay.google.com/gp/v/save/<jwt>`.
 */
function buildGoogleSaveUrl(google, card, nowMs = Date.now()) {
  let jwt = "";
  for (const keep of GOOGLE_TRIM_STEPS) {
    jwt = signRs256Jwt(googleSaveClaims(google, card, keep, nowMs),
        google.privateKey);
    if (jwt.length <= GOOGLE_MAX_JWT_LENGTH) break;
  }
  return GOOGLE_SAVE_URL + jwt;
}

module.exports = {
  APPLE_TEAM_ID,
  CARD_COLOR_HEX,
  GOOGLE_FALLBACK_LOGO,
  GOOGLE_MAX_JWT_LENGTH,
  GOOGLE_ORIGINS,
  PASS_LINK_TTL_SECONDS,
  applePassLayout,
  buildApplePass,
  buildGoogleSaveUrl,
  cardAddress,
  cardDial,
  cardName,
  cardServiceLines,
  cleanSecret,
  fetchWalletImage,
  googleClassId,
  googleObjectId,
  googleSaveClaims,
  isFetchableImageUrl,
  signCardPassToken,
  verifyCardPassToken,
  walletCardModel,
  walletConfig,
  websiteLabel,
};
