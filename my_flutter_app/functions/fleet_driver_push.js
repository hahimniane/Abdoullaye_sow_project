"use strict";

// A push to a Fleet driver's phone beside the WhatsApp message they get
// (docs/FLEET.md section 12): a payment received, a plate fee due or late,
// a reported payment the bank has not shown. The words here; who gets one
// and when is decided where the WhatsApp message is sent (fleet_handlers),
// so a push never goes to a driver the business has not switched messages
// on for.
//
// The account is found by the phone Firebase Auth holds as VERIFIED for it,
// never by a number someone typed into a profile.

const fleetWhatsApp = require("./fleet_whatsapp");
const fleetClaims = require("./fleet_claims");

/** What kind of push, as the app is told in `data.kind`. */
const KIND = Object.freeze({
  RECEIPT: "receipt",
  REMINDER: "reminder",
  NOT_RECEIVED: "not_received",
});

/** `data.type` of every push written here. */
const PUSH_TYPE = "fleet_driver";

const text = (v, max = 200) => String(v ?? "").replace(/\s+/g, " ").trim()
    .slice(0, max);
const whole = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The title and body of one push, in the driver's language. Null when
 * there is nothing to say (an unknown kind, a reminder with nothing owed).
 *
 * @param {object} p {kind, businessName, amountCents, owedCents,
 *   creditCents, reminder (soon|today|late), dueDayKey}.
 * @param {string} lang "en" | "fr".
 * @return {?{title: string, body: string}} The words.
 */
function driverPushText(p, lang) {
  const fr = lang === "fr";
  const l = fr ? "fr" : "en";
  const business = text(p?.businessName, 60) || "Laawol";
  const title = (en, french) => fr ? `${business} : ${french}` :
    `${business}: ${en}`;
  if (p?.kind === KIND.RECEIPT) {
    const amount = whole(p.amountCents);
    if (!amount) return null;
    const balance = fleetWhatsApp.balanceLines(whole(p.owedCents),
        whole(p.creditCents));
    return {
      title: title("payment received", "paiement reçu"),
      body: fr ?
        `Nous avons reçu ${fleetWhatsApp.money(amount, l)}. ${balance.fr}` :
        `We received ${fleetWhatsApp.money(amount, l)}. ${balance.en}`,
    };
  }
  if (p?.kind === KIND.REMINDER) {
    const owed = whole(p.owedCents);
    if (!owed) return null;
    const reminder = ["today", "late"].includes(p.reminder) ? p.reminder :
      "soon";
    const status = fleetWhatsApp.statusLines(reminder, p.dueDayKey);
    const heads = {
      soon: ["plate fee due soon", "frais de plaque bientôt dus"],
      today: ["plate fee due today", "frais de plaque dus aujourd’hui"],
      late: ["plate fee late", "frais de plaque en retard"],
    }[reminder];
    return {
      title: title(heads[0], heads[1]),
      body: fr ?
        `Votre facture de plaque ${status.fr}. Vous devez ${
          fleetWhatsApp.money(owed, l)}.` :
        `Your plate fee ${status.en}. You owe ${
          fleetWhatsApp.money(owed, l)}.`,
    };
  }
  if (p?.kind === KIND.NOT_RECEIVED) {
    const amount = whole(p.amountCents);
    if (!amount) return null;
    return {
      title: title("payment not found yet", "paiement pas encore trouvé"),
      body: fleetClaims.replyText("late", l, {amountCents: amount}),
    };
  }
  return null;
}

/**
 * The sender: finds the driver's account and hands the words to the
 * notification pipeline. Never throws for "no account" (a driver who has
 * not installed the app simply gets no push).
 *
 * @param {object} deps {findUidByVerifiedPhone(e164) -> ?string,
 *   readUser(uid) -> ?object, recipientLanguage(user) -> "en"|"fr",
 *   notify({uid, title, body, data}) -> Promise}.
 * @return {function(object): Promise<string>} push(p): "pushed",
 *   "no_account" or "nothing" (no words for it).
 */
function createDriverPusher(deps) {
  return async function push(p) {
    const phone = String(p?.phone ?? "").replace(/[^\d+]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) return "no_account";
    const uid = await deps.findUidByVerifiedPhone(phone);
    if (!uid) return "no_account";
    const user = await deps.readUser(uid);
    if (!user) return "no_account";
    const words = driverPushText(p, deps.recipientLanguage(user));
    if (!words) return "nothing";
    await deps.notify({uid, title: words.title, body: words.body,
      data: {type: PUSH_TYPE, kind: text(p.kind, 40),
        businessId: text(p.businessId, 180)}});
    return "pushed";
  };
}

module.exports = {KIND, PUSH_TYPE, createDriverPusher, driverPushText};
