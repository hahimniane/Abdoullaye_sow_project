"use strict";

// Fleet drivers on WhatsApp (docs/FLEET.md §9, owner 2026-11-12): a receipt
// each time a payment is recorded, and rent reminders (2 days before, on
// the due day, 3 days late, then weekly), each saying how to pay by Zelle
// with the driver's exact amount. Off until the business switches it on
// (after a test to its own phone). Pure: no Firestore, no WhatsApp.

const RECEIPT_TEMPLATE = "fleet_receipt_2lang";
const REMINDER_TEMPLATE = "fleet_rent_reminder_2lang";
/** Reminders go out once a day at this New York hour. */
const REMINDER_HOUR = 10;
const LANGUAGE = "en";
const DAY_MS = 86400000;

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
 * The amount a driver sends by Zelle: whole dollars of what they owe, and
 * their personal cents (the amount is the code). Same rule as the
 * console's zelleAmountText.
 *
 * @param {number} owedCents What they owe.
 * @param {*} personalCents 1-99.
 * @return {number|null} Cents, or null with no personal cents.
 */
function zelleAmountCents(owedCents, personalCents) {
  const p = Number(personalCents);
  if (!Number.isInteger(p) || p < 1 || p > 99) return null;
  return Math.floor(Math.max(0, Number(owedCents) || 0) / 100) * 100 + p;
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
 * 12 business phone.
 *
 * @param {object} p {driverName, businessName, businessPhone, settings,
 *   kind, dueDayKey, owedCents, personalCents}.
 * @return {Array<string>} The 12 values.
 */
function reminderValues(p) {
  const status = statusLines(p.kind, p.dueDayKey);
  const exact = zelleAmountCents(p.owedCents, p.personalCents);
  const zelle = zelleLine(p.settings, p.businessName);
  const business = text(p.businessName, 80) || "—";
  return [
    text(p.driverName, 60) || "—",
    business, status.en, money(p.owedCents, "en"), zelle,
    exact === null ? money(p.owedCents, "en") : money(exact, "en"),
    business, status.fr, money(p.owedCents, "fr"), zelle,
    exact === null ? money(p.owedCents, "fr") : money(exact, "fr"),
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
    text(p.driverName, 60) || "—",
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
  if (kind === "reminder") {
    return `reminder_${text(p.driverId, 120)}_${text(p.billId, 200)}_${
      text(p.todayKey, 10)}`.replace(/\//g, "_");
  }
  return `test_${text(p.businessId, 120)}_${Date.now()}`;
}

module.exports = {
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
  zelleAmountCents,
  zelleLine,
};
