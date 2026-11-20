"use strict";

// Fleet drivers on WhatsApp (docs/FLEET.md §9, owner 2026-11-12): a receipt
// each time a payment is recorded, and rent reminders (2 days before, on
// the due day, 3 days late, then weekly), each saying how to pay by Zelle
// with the plain amount owed. Off until the business switches it on
// (after a test to its own phone). Pure: no Firestore, no WhatsApp.

const fleetBilling = require("./fleet_billing");

const RECEIPT_TEMPLATE = "fleet_receipt_2lang";
const REMINDER_TEMPLATE = "fleet_rent_reminder_2lang";
/** Reminders go out once a day at this New York hour. */
const REMINDER_HOUR = 10;
const LANGUAGE = "en";
const DAY_MS = 86400000;
/** A message row is tried at most this many times in all. */
const MAX_ATTEMPTS = 3;
/** A row still "queued" after this long was lost in a crash: retry it. */
const QUEUED_STALE_MS = 10 * 60 * 1000;

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
  "Sep", "Oct", "Nov", "Dec"];
const FR_MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc."];

const text = (v, max = 200) => String(v ?? "").replace(/\s+/g, " ").trim()
    .slice(0, max);
const dayNum = (key) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS) : null;
};

const dayKeyOf = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/**
 * How a driver is addressed: the stored name without the office notes
 * imported names carry ("Fawaz #9", "ABU HASSAN (25)", "... STORAGE
 * 2/14/25"). Same rule as driverDisplayName in admin_web/src/lib/fleet.ts:
 * a trailing "drop", "storage" or "voir folder" word and all after it, then
 * trailing "#12", "#" and "(25)" tags, are cut; an empty result falls back
 * to the full name. The stored name is never changed.
 *
 * @param {*} name The stored name.
 * @return {string} The name to put in a message.
 */
function driverDisplayName(name) {
  const full = String(name ?? "").replace(/\s+/g, " ").trim();
  let out = full.replace(
      /(^|\s)(?:drop|storage|voir\s+folder)(?![\p{L}\p{N}_]).*$/iu, "")
      .trim();
  for (let i = 0; i < 10; i++) {
    const next = out.replace(/\s*(?:#\s*\d*|\(\s*\d+\s*\))\s*$/, "")
        .trim();
    if (next === out) break;
    out = next;
  }
  return out || full;
}

/**
 * "$1,234.56" / "1 234,56 $".
 *
 * @param {number} cents Cents.
 * @param {string} lang "en" | "fr".
 * @return {string} The amount.
 */
function money(cents, lang) {
  const n = Math.round(Number(cents) || 0) / 100;
  if (lang === "fr") {
    return `${n.toLocaleString("fr-FR", {minimumFractionDigits: 2,
      maximumFractionDigits: 2}).replace(/[\u202f\u00a0]/g, " ")} $`;
  }
  return `$${n.toLocaleString("en-US", {minimumFractionDigits: 2,
    maximumFractionDigits: 2})}`;
}

/**
 * "Dec 1, 2026" / "1 déc. 2026" (US order in English).
 *
 * @param {string} key YYYY-MM-DD.
 * @param {string} lang "en" | "fr".
 * @return {string} The day.
 */
function dayText(key, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!m) return "";
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  return lang === "fr" ? `${day} ${FR_MONTHS[month]} ${m[1]}` :
    `${EN_MONTHS[month]} ${day}, ${m[1]}`;
}

/**
 * Which reminder a driver gets today for their oldest open bill, or null:
 * "soon" 2 days before, "today" on the due day, "late" 3 days after and
 * every 7 days after that.
 *
 * @param {string} dueDayKey The oldest open bill's due day.
 * @param {string} todayKey Today (New York).
 * @return {string|null} The kind.
 */
function reminderKind(dueDayKey, todayKey) {
  const due = dayNum(dueDayKey);
  const today = dayNum(todayKey);
  if (due === null || today === null) return null;
  const d = today - due;
  if (d === -2) return "soon";
  if (d === 0) return "today";
  if (d >= 3 && (d - 3) % 7 === 0) return "late";
  return null;
}

/**
 * The oldest open bill with money left on it.
 *
 * @param {Array<object>} bills The driver's bills.
 * @return {object|null} The bill.
 */
function oldestOpenBill(bills) {
  let best = null;
  for (const b of bills || []) {
    if (!b || b.status !== "open") continue;
    const left = (Number(b.amountCents) || 0) - (Number(b.paidCents) || 0);
    if (left <= 0) continue;
    if (!best || String(b.dueDayKey) < String(best.dueDayKey)) best = b;
  }
  return best;
}

/**
 * The oldest open RENT bill with money left on it. A reminder is always
 * about a rent bill: late fees and one-off charges only add to the amount.
 *
 * @param {Array<object>} bills The driver's bills.
 * @return {object|null} The bill.
 */
function oldestOpenRentBill(bills) {
  return oldestOpenBill((bills || []).filter((b) => b && b.kind === "rent"));
}

/**
 * What a reminder says is owed: everything open, minus the credit the
 * driver holds, never below zero.
 *
 * @param {number} owedCents Open bills' remaining total.
 * @param {number} creditCents Credit held.
 * @param {number} extraCents A coming fee not billed yet.
 * @return {number} Cents.
 */
function amountToState(owedCents, creditCents, extraCents = 0) {
  return Math.max(0, Math.round(Number(owedCents) || 0) +
    Math.round(Number(extraCents) || 0) -
    Math.max(0, Math.round(Number(creditCents) || 0)));
}

/**
 * Looking ahead: the bill an assignment will get for the period that is due
 * in exactly 2 days when none exists yet (a month's bill is only made on
 * its first day, so the "2 days before" reminder cannot come from bills).
 * Nothing is created; this only says what the bill will be.
 *
 * @param {object} assignment An open assignment (with id).
 * @param {Array<object>} existing Every bill of that assignment.
 * @param {string} todayKey Today (New York).
 * @param {object} settings fleet.settings.
 * @return {object|null} The bill it will get (label, dueDayKey, periodFrom,
 *   amountCents...), or null.
 */
function comingBill(assignment, existing, todayKey, settings) {
  const today = dayNum(todayKey);
  if (today === null || !assignment || assignment.endDayKey) return null;
  const target = dayKeyOf(today + 2);
  const bills = fleetBilling.rentBillsToCreate(assignment, existing || [],
      target, settings);
  return bills.find((b) => b.dueDayKey === target) || null;
}

/**
 * Whether a message row may be sent again: a failed one, or one stuck in
 * "queued" for over 10 minutes, at most MAX_ATTEMPTS times in all. A sent,
 * stopped or skipped row is final.
 *
 * @param {object} row The fleetMessages row (status, attempts, queuedAtMs
 *   or createdAt).
 * @param {number} nowMs Now.
 * @return {boolean} True when to send again.
 */
function mayRetry(row, nowMs) {
  const attempts = Math.max(1, Number(row?.attempts) || 1);
  if (attempts >= MAX_ATTEMPTS) return false;
  if (row?.status === "failed") return true;
  if (row?.status === "queued") {
    const since = Number(row.queuedAtMs) ||
      (typeof row.createdAt?.toMillis === "function" ?
        row.createdAt.toMillis() : 0);
    return nowMs - since > QUEUED_STALE_MS;
  }
  return false;
}

/**
 * The reminder's status line, both languages.
 *
 * @param {string} kind soon | today | late.
 * @param {string} dueDayKey The due day.
 * @return {object} {en, fr}.
 */
function statusLines(kind, dueDayKey) {
  if (kind === "today") return {en: "is due today", fr: "est due aujourd’hui"};
  if (kind === "late") {
    return {en: `was due on ${dayText(dueDayKey, "en")} and is late`,
      fr: `était due le ${dayText(dueDayKey, "fr")} et est en retard`};
  }
  return {en: `is due on ${dayText(dueDayKey, "en")}`,
    fr: `est due le ${dayText(dueDayKey, "fr")}`};
}

/**
 * How to pay by Zelle: the business's Zelle name and email or phone.
 *
 * @param {object} settings fleet.settings.
 * @param {string} businessName Fallback name.
 * @return {string} "Landa Shipping (718-807-6869)".
 */
function zelleLine(settings, businessName) {
  const name = text(settings?.zelle?.name, 80) || text(businessName, 80);
  const handle = text(settings?.zelle?.handle, 120);
  return handle ? `${name} (${handle})` : name;
}

/**
 * The reminder's variables, in the template's order:
 * 1 name, 2 business, 3 status EN, 4 amount EN, 5 Zelle, 6 exact amount EN,
 * 7 business, 8 status FR, 9 amount FR, 10 Zelle, 11 exact amount FR,
 * 12 business phone. The amount to send is the plain amount owed (the
 * personal cents are gone, docs/FLEET_PAYMENT_PROOF.md Q6): variables 6 and
 * 11 repeat it, so the approved template needs no change.
 *
 * @param {object} p {driverName, businessName, businessPhone, settings,
 *   kind, dueDayKey, owedCents}.
 * @return {Array<string>} The 12 values.
 */
function reminderValues(p) {
  const status = statusLines(p.kind, p.dueDayKey);
  const zelle = zelleLine(p.settings, p.businessName);
  const business = text(p.businessName, 80) || "—";
  return [
    text(driverDisplayName(p.driverName), 60) || "—",
    business, status.en, money(p.owedCents, "en"), zelle,
    money(p.owedCents, "en"),
    business, status.fr, money(p.owedCents, "fr"), zelle,
    money(p.owedCents, "fr"),
    text(p.businessPhone, 40) || "—",
  ];
}

/**
 * The receipt's balance line, both languages.
 *
 * @param {number} owedCents Owed after the payment.
 * @param {number} creditCents Credit after it.
 * @return {object} {en, fr}.
 */
function balanceLines(owedCents, creditCents) {
  if (owedCents > 0) {
    return {en: `You still owe ${money(owedCents, "en")}.`,
      fr: `Il vous reste ${money(owedCents, "fr")} à payer.`};
  }
  if (creditCents > 0) {
    return {en: `You owe nothing now, and you have ${
      money(creditCents, "en")} credit for next time.`,
    fr: `Vous ne devez plus rien, et vous avez ${money(creditCents, "fr")
    } de crédit pour la prochaine fois.`};
  }
  return {en: "You owe nothing now.", fr: "Vous ne devez plus rien."};
}

/**
 * The receipt's variables, in the template's order:
 * 1 name, 2 business, 3 amount EN, 4 day EN, 5 balance EN,
 * 6 business, 7 amount FR, 8 day FR, 9 balance FR, 10 business phone.
 *
 * @param {object} p {driverName, businessName, businessPhone, amountCents,
 *   paidDayKey, owedCents, creditCents}.
 * @return {Array<string>} The 10 values.
 */
function receiptValues(p) {
  const balance = balanceLines(Number(p.owedCents) || 0,
      Number(p.creditCents) || 0);
  const business = text(p.businessName, 80) || "—";
  return [
    text(driverDisplayName(p.driverName), 60) || "—",
    business, money(p.amountCents, "en"), dayText(p.paidDayKey, "en"),
    balance.en,
    business, money(p.amountCents, "fr"), dayText(p.paidDayKey, "fr"),
    balance.fr,
    text(p.businessPhone, 40) || "—",
  ];
}

/**
 * A WhatsApp /messages body for one of the two templates.
 *
 * @param {string} template RECEIPT_TEMPLATE | REMINDER_TEMPLATE.
 * @param {string} phone The number (any format).
 * @param {Array<string>} values The body's variables.
 * @return {object} The body.
 */
function templateBody(template, phone, values) {
  return {
    messaging_product: "whatsapp",
    to: String(phone ?? "").replace(/\D/g, ""),
    type: "template",
    template: {
      name: template,
      language: {code: LANGUAGE},
      components: [{type: "body", parameters: values.map((v) =>
        ({type: "text", text: text(v, 400) || "—"}))}],
    },
  };
}

/**
 * Whether a phone can get a WhatsApp: 10 to 15 digits.
 *
 * @param {string} phone The stored phone.
 * @return {boolean} Whether to try.
 */
function reachable(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * fleetMessages ids: one receipt per payment, one reminder per driver, bill
 * and day, so a retried job never sends twice.
 *
 * @param {string} kind receipt | reminder | test.
 * @param {object} p {paymentId} | {driverId, billId, todayKey}.
 * @return {string} The id.
 */
function messageId(kind, p) {
  if (kind === "receipt") return `receipt_${text(p.paymentId, 160)}`;
  if (kind === "lookahead") {
    return `reminder_${text(p.driverId, 120)}_soon_${
      text(p.assignmentId, 200)}_${text(p.periodFrom, 10)}`
        .replace(/\//g, "_");
  }
  if (kind === "reminder") {
    return `reminder_${text(p.driverId, 120)}_${text(p.billId, 200)}_${
      text(p.todayKey, 10)}`.replace(/\//g, "_");
  }
  return `test_${text(p.businessId, 120)}_${Date.now()}`;
}

module.exports = {
  MAX_ATTEMPTS,
  QUEUED_STALE_MS,
  amountToState,
  comingBill,
  driverDisplayName,
  mayRetry,
  oldestOpenRentBill,
  RECEIPT_TEMPLATE,
  REMINDER_HOUR,
  REMINDER_TEMPLATE,
  balanceLines,
  dayText,
  messageId,
  money,
  oldestOpenBill,
  reachable,
  receiptValues,
  reminderKind,
  reminderValues,
  statusLines,
  templateBody,
  zelleLine,
};
