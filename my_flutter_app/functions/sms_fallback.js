"use strict";

/**
 * A text when WhatsApp fails (docs/WHATSAPP_SMS_FALLBACK.md): the pure half.
 * Which package messages get a text through Twilio, the exact words, and
 * what is recorded. Everything that touches Firestore or Twilio stays in
 * index.js (textAfterWhatsAppFailure).
 */

const {receiptSmsBody} = require("./package_receipt_send");

// Twilio's "this number replied STOP to us".
const TWILIO_OPTED_OUT_CODE = 21610;

// What carriers expect at the end of a business text.
const SMS_OPT_OUT = "Reply STOP to opt out, HELP for help.";

const TRACKING_BASE = "https://customer.laawoldigital.com/t/";

// The updates a text can carry. `confirm` cannot ask for a reply by text, so
// it goes as `received`; `at_port` and the rest are never messages.
const FALLBACK_UPDATES = Object.freeze(
    ["received", "confirm", "shipped", "arrived", "delivered", "receipt"]);

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

/**
 * @param {*} phone A phone number as stored.
 * @return {boolean} True for +1 and ten digits (United States or Canada).
 */
function isUsNumber(phone) {
  const compact = text(phone, 40).replace(/[\s().-]/g, "");
  return /^\+1\d{10}$/.test(compact);
}

/**
 * @param {*} update A row's update.
 * @return {string} The update the text is written as ("" when none):
 *   confirm is texted as received.
 */
function fallbackUpdateFor(update) {
  const value = text(update, 20);
  if (!FALLBACK_UPDATES.includes(value)) return "";
  return value === "confirm" ? "received" : value;
}

// The business's name as a text carries it: 40 characters, no accents.
const textName = (name) => text(name, 80).normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "")
    .trim().slice(0, 40) || "Laawol";

/**
 * The text, word for word (the spec's "The texts").
 *
 * @param {object} args {update, businessName, code, receiptLink}: the row's
 *   update, and for a `receipt` the receipt's own link.
 * @return {string} The body, or "" when the update has no text.
 */
function smsFallbackBody(args) {
  const update = fallbackUpdateFor(args?.update);
  if (!update) return "";
  const biz = textName(args?.businessName);
  const code = text(args?.code, 40);
  if (update === "receipt") {
    return receiptSmsBody({businessName: biz, code,
      link: text(args?.receiptLink, 1000)});
  }
  const label = code ? ` ${code}` : "";
  const link = `${TRACKING_BASE}${encodeURIComponent(code)}`;
  const middle = {
    received: `we received your package${label} / colis recu.`,
    shipped: `your package${label} has left / colis parti.`,
    arrived: `your package${label} is ready for pickup / pret a recuperer.`,
    delivered: `your package${label} was delivered / colis remis.`,
  }[update];
  return `${biz}: ${middle} Track: ${link} ${SMS_OPT_OUT}`;
}

/**
 * @param {object} env The environment.
 * @return {boolean} True when `SMS_FALLBACK` is "on" (any case, trimmed).
 */
function smsFallbackSwitchOn(env = process.env) {
  return text(env?.SMS_FALLBACK, 20).toLowerCase() === "on";
}

/**
 * The rule: does this failed WhatsApp row get a text?
 *
 * @param {object} args {row: the containerUpdates row, business: its
 *   record, smsReady: Twilio is really set up, switchOn: SMS_FALLBACK}.
 * @return {{send: boolean, reason: string, record: boolean}} `reason` says
 *   why not; `record` is whether a refusal is written on the row (not for
 *   "not_configured" / "switched_off", so the text can still go once texting
 *   is on, nor for rows that never qualified).
 */
function smsFallbackWanted(args) {
  const row = args?.row || {};
  const no = (reason, record = false) => ({send: false, reason, record});
  if (row.smsFallback) return no("already_texted");
  if (text(row.channel, 20) === "sms") return no("channel_sms");
  if (text(row.role, 20) !== "sender") return no("not_sender");
  if (!fallbackUpdateFor(row.update)) return no("not_a_text_update");
  // Texting off (the deploy switch, or Twilio not set up) comes before any
  // reason that is written on the row: while it is off nothing is recorded,
  // so the code ships dark and the text can still go once it is on.
  if (args?.switchOn !== true) return no("switched_off");
  if (args?.smsReady !== true) return no("not_configured");
  if (!isUsNumber(row.phone)) return no("not_us_number", true);
  if (args?.business?.packageTextFallback === false) {
    return no("business_off", true);
  }
  return {send: true, reason: "", record: false};
}

/**
 * The `smsFallback` field for the row, from sendTwilioSms's answer.
 *
 * @param {object} result sendTwilioSms's answer {ok, skipped, sid, error,
 *   code}.
 * @param {number} nowMs The time.
 * @return {{status: string, reason: string, twilioSid: string,
 *   atMs: number}}
 */
function smsFallbackRecord(result, nowMs) {
  const atMs = Number(nowMs) || 0;
  if (result?.ok) {
    return {status: "sent", reason: "", twilioSid: text(result.sid, 80), atMs};
  }
  if (result?.skipped) {
    return {status: "skipped", reason: text(result.error, 60) ||
      "not_configured", twilioSid: "", atMs};
  }
  const reason = Number(result?.code) === TWILIO_OPTED_OUT_CODE ?
    "opted_out" : "twilio_error";
  return {status: "failed", reason, twilioSid: "", atMs};
}

/**
 * A skipped refusal as the row records it.
 *
 * @param {string} reason not_us_number | business_off.
 * @param {number} nowMs The time.
 * @return {object} The `smsFallback` field.
 */
function smsFallbackSkipRecord(reason, nowMs) {
  return {status: "skipped", reason: text(reason, 60), twilioSid: "",
    atMs: Number(nowMs) || 0};
}

/**
 * The line's `lastCustomerUpdate` with `sms` on the sender's entry, so the
 * lists can say "Sent by text". The WhatsApp failure stays as it is.
 *
 * @param {object} previous The line's lastCustomerUpdate.
 * @param {string} update The row's update.
 * @param {string} role sender | receiver.
 * @param {string} sms sent | failed.
 * @return {object|null} The new value, or null when nothing changes (a later
 *   update replaced it, the role is not on it, or a receipt).
 */
function withSmsResult(previous, update, role, sms) {
  if (!previous || typeof previous !== "object") return null;
  if (text(update, 20) === "receipt" || !["sent", "failed"].includes(sms)) {
    return null;
  }
  if (text(previous.update, 20) !== fallbackUpdateFor(update)) return null;
  const who = text(role, 20);
  let changed = false;
  const results = (Array.isArray(previous.results) ? previous.results : [])
      .map((entry) => {
        if (text(entry?.role, 20) !== who || entry.sms === sms) return entry;
        changed = true;
        return {...entry, sms};
      });
  return changed ? {...previous, results} : null;
}

module.exports = {
  TWILIO_OPTED_OUT_CODE,
  FALLBACK_UPDATES,
  isUsNumber,
  fallbackUpdateFor,
  smsFallbackBody,
  smsFallbackSwitchOn,
  smsFallbackWanted,
  smsFallbackRecord,
  smsFallbackSkipRecord,
  withSmsResult,
};
