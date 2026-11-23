"use strict";

/**
 * "Send receipt": the pure half (docs/PACKAGE_RECEIPT_SEND.md). A business
 * chooses whether the package receipt goes out on its own with the "package
 * received" confirmation (`auto`) or when staff press a button (`button`,
 * the default); staff can send it by WhatsApp or, when Twilio is really set
 * up, by text message. Everything that touches Firestore, Storage, WhatsApp
 * or Twilio stays in index.js.
 */

const {
  isInternationalPhone,
  phoneWithBusinessCountry,
} = require("./container_manifest");

const SEND_MODE = Object.freeze({BUTTON: "button", AUTO: "auto"});
const SEND_MODES = Object.freeze(Object.values(SEND_MODE));

const CHANNEL = Object.freeze({WHATSAPP: "whatsapp", SMS: "sms"});
const CHANNELS = Object.freeze(Object.values(CHANNEL));

// The same channel, the same package, less than this ago: a double tap.
const RESEND_GUARD_MS = 60 * 1000;

// Refusals of receipt_send / receipt_link: `details.reason` on the
// HttpsError, English message here (the screens say it in both languages).
const RECEIPT_REFUSAL = Object.freeze({
  receipt_no_sender_phone:
    "This package has no sender phone number to send the receipt to.",
  receipt_sms_not_set_up:
    "Text messages are not set up yet. Send it on WhatsApp, or text it " +
    "from your own phone.",
  receipt_too_soon:
    "The receipt was just sent. Wait a minute before sending it again.",
  receipt_line_gone: "That package is no longer here.",
  receipt_whatsapp_off:
    "WhatsApp is not connected yet, so nothing can be sent on it.",
  receipt_channel_invalid: "Choose WhatsApp or text message.",
  receipt_sms_failed:
    "The text message could not be sent. Try WhatsApp, or text it from " +
    "your own phone.",
});

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

/**
 * @param {object} business The businesses record.
 * @return {"button"|"auto"} How its receipts go; `button` when unset.
 */
function sendModeOf(business) {
  return business?.packageReceiptSettings?.sendMode === SEND_MODE.AUTO ?
    SEND_MODE.AUTO : SEND_MODE.BUTTON;
}

/**
 * @param {*} value A sendMode a caller asked for.
 * @return {string} The mode, or "" when it is neither button nor auto.
 */
function validSendMode(value) {
  return typeof value === "string" && SEND_MODES.includes(value) ?
    value : "";
}

/**
 * Whether the sender's `received` row carries the receipt itself (the
 * receipt template, no photo header): only in `auto`, and then only when
 * the photo does not head the message (a message has one header; the photo
 * case queues a separate receipt row instead: autoReceiptRowWanted).
 *
 * @param {object} args {sendMode, update, role, set?: whether the bilingual
 *   set is on (receiptDocumentWanted's answer)}.
 * @return {boolean}
 */
function receiptRidesOnConfirmation(args) {
  return args?.sendMode === SEND_MODE.AUTO && args?.wanted === true;
}

/**
 * Whether a separate `receipt` row is queued for the sender right after
 * their confirmation went out: `auto` mode, a sender's `received`, and the
 * drop-off photo headed that message (so the receipt could not ride on it).
 *
 * @param {object} args {sendMode, update, role, photoState}.
 * @return {boolean}
 */
function autoReceiptRowWanted(args) {
  return args?.sendMode === SEND_MODE.AUTO &&
    text(args?.update, 20) === "received" &&
    text(args?.role, 20) === "sender" &&
    args?.photoState === "attached";
}

/**
 * @param {string} lineId The package.
 * @return {string} The automatic receipt row's id: one per package, so a
 *   retry or a re-sent confirmation never sends a second receipt.
 */
function autoReceiptRowId(lineId) {
  return `${text(lineId, 120).replace(/[^A-Za-z0-9_-]/g, "")}_receipt_auto`;
}

/**
 * @param {*} lastAtMs When this channel last sent this package's receipt.
 * @param {number} nowMs The time.
 * @return {boolean} True for a send the same channel made under a minute ago.
 */
function receiptTooSoon(lastAtMs, nowMs) {
  const last = Number(lastAtMs);
  return Number.isFinite(last) && last > 0 && nowMs - last < RESEND_GUARD_MS;
}

/**
 * Whether Twilio is really set up (the saved values are placeholders on the
 * live project until the owner connects an account).
 *
 * @param {{sid: string, token: string, from: string}} config The secrets.
 * @return {boolean}
 */
function smsConfigured(config) {
  return /^AC[0-9a-f]{32}$/i.test(text(config?.sid, 80)) &&
    text(config?.token, 200) !== "" && text(config?.from, 40) !== "";
}

/**
 * The sender's number as it can be messaged ("" when there is none or it
 * has no country code).
 *
 * @param {object} line A containerLines row.
 * @param {string} businessCountry The business's country.
 * @return {string} An international number, or "".
 */
function senderPhoneOf(line, businessCountry) {
  const phone = phoneWithBusinessCountry(
      text(line?.customerPhone, 40), businessCountry);
  return phone && isInternationalPhone(phone) ? phone : "";
}

/**
 * @param {object} line A containerLines row.
 * @return {{name: string, phone: string, email: string}} The sender as the
 *   line has them (the phone as typed), for the screens' text / email
 *   buttons.
 */
function senderOf(line) {
  return {
    name: text(line?.customerName, 120),
    phone: text(line?.customerPhone, 40),
    email: text(line?.customerEmail || line?.senderEmail, 200),
  };
}

/**
 * The text message: short, in both languages, with the receipt's link.
 *
 * @param {{businessName: string, code: string, link: string}} args
 * @return {string}
 */
function receiptSmsBody(args) {
  const business = text(args?.businessName, 80) || "Laawol";
  const code = text(args?.code, 40);
  const label = code ? ` ${code}` : "";
  return `${business}: your package receipt${label} / ` +
    `votre reçu de colis${label} : ${text(args?.link, 1000)}`;
}

/**
 * The row a receipt sent by hand writes on `containerUpdates` (WhatsApp:
 * queued, for the existing sender; text: already decided, never picked up
 * by the WhatsApp sender).
 *
 * @param {object} args {businessId, containerId, lineId, trackingCode,
 *   businessName, name, phone, channel, trigger, requestedByUid}.
 * @return {object} The fields (without timestamps and status).
 */
function receiptRowFields(args) {
  return {
    businessId: text(args.businessId, 128),
    containerId: text(args.containerId, 128),
    lineId: text(args.lineId, 128),
    update: "receipt",
    role: "sender",
    name: text(args.name, 120),
    phone: text(args.phone, 40),
    trackingCode: text(args.trackingCode, 40),
    businessName: text(args.businessName, 160),
    trigger: args.trigger === "auto" ? "auto" : "button",
    ...(args.channel === CHANNEL.SMS ? {channel: CHANNEL.SMS} : {}),
    ...(args.requestedByUid ?
      {requestedByUid: text(args.requestedByUid, 128)} : {}),
  };
}

module.exports = {
  SEND_MODE,
  SEND_MODES,
  CHANNEL,
  CHANNELS,
  RESEND_GUARD_MS,
  RECEIPT_REFUSAL,
  sendModeOf,
  validSendMode,
  receiptRidesOnConfirmation,
  autoReceiptRowWanted,
  autoReceiptRowId,
  receiptTooSoon,
  smsConfigured,
  senderPhoneOf,
  senderOf,
  receiptSmsBody,
  receiptRowFields,
};
