"use strict";

/**
 * Fleet alerts to admins (docs/FLEET.md section 18): the people who run a
 * Fleet business hear about Fleet activity they did not do - a push and an
 * inbox entry, never an email or an SMS.
 *
 * Who hears: the business's owner(s), full-access staff, and staff holding
 * `fleet_admin`; never the person who did it, never another business's
 * people, never a blocked account, never someone who set `fleetAlerts` to
 * "off" (or to "needs" for an info alert). Events with no admin behind them
 * (the bank, a driver's screenshot, the daily run) have no actor, so every
 * admin hears.
 *
 * Grouping reuses staff_activity_alerts.js: the grouped kinds go through its
 * window (planWindowEvent / planWindowFlush, the staffActivityAlerts
 * collection, the scheduled flush). The urgent kinds go at once.
 *
 * Pure: no Firestore, no clock. The hook and the flush live in index.js
 * (handleFleetAdminAlert, flushStaffActivityWindow). The words never carry
 * the insurance policy number: no event field holds it.
 */

const {recipientLanguage} = require("./notification_settings");
const {sellerFirstName} = require("./inventory");

const KIND = Object.freeze({
  DEPOSIT_WAITING: "deposit_waiting",
  CLAIM_NEEDS_OFFICE: "claim_needs_office",
  BANK_TOOK_BACK: "bank_took_back",
  PLATE_ADDED: "plate_added",
  DRIVER_ADDED: "driver_added",
  PAYMENT_RECORDED: "payment_recorded",
  BANK_MATCHED: "bank_matched",
});
const KINDS = Object.freeze(Object.values(KIND));

const LEVEL = Object.freeze({NEEDS: "needs", INFO: "info"});

/** The level of each kind ("needs" = it is in Needs you). */
const KIND_LEVEL = Object.freeze({
  [KIND.DEPOSIT_WAITING]: LEVEL.NEEDS,
  [KIND.CLAIM_NEEDS_OFFICE]: LEVEL.NEEDS,
  [KIND.BANK_TOOK_BACK]: LEVEL.NEEDS,
  [KIND.PLATE_ADDED]: LEVEL.INFO,
  [KIND.DRIVER_ADDED]: LEVEL.INFO,
  [KIND.PAYMENT_RECORDED]: LEVEL.INFO,
  [KIND.BANK_MATCHED]: LEVEL.INFO,
});

/** Kinds sent through a per-person grouping window. */
const GROUPED_KINDS = Object.freeze([KIND.PLATE_ADDED, KIND.DRIVER_ADDED,
  KIND.PAYMENT_RECORDED]);

/** The permission that makes a staff member a Fleet admin. */
const FLEET_ADMIN_PERMISSION = "fleet_admin";
/** The notification preference (a string: "all" | "needs" | "off"). */
const FLEET_ALERT_PREFERENCE = "fleetAlerts";
const FLEET_ALERT_SETTINGS = Object.freeze(["all", "needs", "off"]);
/** `data.type` of every alert here. */
const FLEET_ALERT_TYPE = "fleet_alert";
const MAX_FLEET_RECIPIENTS = 50;
const MAX_NAMES = 3;

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const whole = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * @param {*} kind A kind.
 * @return {boolean} Whether it is one of KINDS.
 */
function isFleetAlertKind(kind) {
  return KINDS.includes(kind);
}

/**
 * @param {*} kind A kind.
 * @return {boolean} Whether it goes through a grouping window.
 */
function isGroupedKind(kind) {
  return GROUPED_KINDS.includes(kind);
}

/**
 * @param {*} value A stored `fleetAlerts` value.
 * @return {"all"|"needs"|"off"} The setting; unknown or missing = "all".
 */
function normalizeFleetAlertSetting(value) {
  return FLEET_ALERT_SETTINGS.includes(value) ? value : "all";
}

/**
 * @param {string} kind A kind.
 * @param {string} setting A person's `fleetAlerts`.
 * @return {boolean} Whether that setting lets the kind through.
 */
function settingAllows(kind, setting) {
  const s = normalizeFleetAlertSetting(setting);
  if (s === "off") return false;
  if (s === "needs") return KIND_LEVEL[kind] === LEVEL.NEEDS;
  return true;
}

/**
 * @param {number} cents Cents.
 * @return {string} "$1,200.00".
 */
function money(cents) {
  const fixed = (whole(cents) / 100).toFixed(2);
  const [dollars, rest] = fixed.split(".");
  return `$${dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${rest}`;
}

// ---------------------------------------------------------------------------
// Who hears.
// ---------------------------------------------------------------------------

/**
 * @param {object} user A `users` profile with `id`.
 * @param {string} businessId The business.
 * @param {string[]} ownerUids The business document's owner(s).
 * @return {boolean} True for the business's owner.
 */
function isOwner(user, businessId, ownerUids) {
  const uid = text(user?.id);
  if (uid && ownerUids.includes(uid)) return true;
  return user?.role === "businessOwner" &&
    text(user.businessId) === businessId;
}

/**
 * @param {object} user A `users` profile with `id`.
 * @param {string} businessId The business.
 * @param {string[]} [ownerUids] The business document's owner(s).
 * @return {boolean} Whether they run this business's Fleet: the owner,
 *   full-access staff, or staff holding `fleet_admin`.
 */
function isFleetAdmin(user, businessId, ownerUids = []) {
  if (!user || !text(user.id)) return false;
  const business = text(businessId);
  if (isOwner(user, business, ownerUids)) return true;
  if (user.role !== "staff" || text(user.businessId) !== business) {
    return false;
  }
  if (user.fullAccess === true) return true;
  return Array.isArray(user.businessPermissions) &&
    user.businessPermissions.includes(FLEET_ADMIN_PERMISSION);
}

/**
 * @param {object} input {kind, businessId, users, actorUid, ownerUids,
 *   isBlocked}.
 * @return {Array<{uid: string, owner: boolean, user: object}>} The admins
 *   to tell: owners first, at most MAX_FLEET_RECIPIENTS.
 */
function planFleetRecipients({kind, businessId, users, actorUid,
  ownerUids = [], isBlocked = () => false}) {
  if (!isFleetAlertKind(kind)) return [];
  const business = text(businessId);
  const actor = text(actorUid);
  const owners = (Array.isArray(ownerUids) ? ownerUids : []).map((uid) =>
    text(uid)).filter(Boolean);
  const chosen = [];
  const seen = new Set();
  for (const user of Array.isArray(users) ? users : []) {
    const uid = text(user?.id);
    if (!uid || uid === actor || seen.has(uid)) continue;
    if (!isFleetAdmin(user, business, owners)) continue;
    if (isBlocked(user)) continue;
    if (!settingAllows(kind,
        user.notificationPreferences?.[FLEET_ALERT_PREFERENCE])) continue;
    seen.add(uid);
    chosen.push({uid, owner: isOwner(user, business, owners), user});
  }
  chosen.sort((a, b) => (a.owner === b.owner ?
    (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0) : a.owner ? -1 : 1));
  return chosen.slice(0, MAX_FLEET_RECIPIENTS);
}

// ---------------------------------------------------------------------------
// What they read.
// ---------------------------------------------------------------------------

const WAITING_REASON = Object.freeze({
  unknown: {
    en: "No driver matches the sender.",
    fr: "Aucun chauffeur ne correspond à l'expéditeur."},
  possible_duplicate: {
    en: "It may be a repeat of another deposit.",
    fr: "Il pourrait s'agir d'un doublon."},
  shared_payer: {
    en: "The sender pays for more than one driver.",
    fr: "L'expéditeur paie pour plusieurs chauffeurs."},
  driver_left: {
    en: "The driver has left.",
    fr: "Le chauffeur est parti."},
  undone: {
    en: "A payment you undid shows up again.",
    fr: "Un paiement annulé réapparaît."},
  own_transfer: {
    en: "It looks like a transfer between your own accounts.",
    fr: "On dirait un virement entre vos propres comptes."},
  not_zelle: {
    en: "It is not a Zelle payment.",
    fr: "Ce n'est pas un paiement Zelle."},
});

const CLAIM_REASON = Object.freeze({
  wrong_recipient: {
    en: "It was sent to someone else.",
    fr: "Il a été envoyé à quelqu'un d'autre."},
  too_old: {
    en: "The screenshot is too old.",
    fr: "La capture est trop ancienne."},
  not_a_driver: {
    en: "We could not tell which driver it is for.",
    fr: "Impossible de savoir pour quel chauffeur."},
  no_amount: {
    en: "The amount could not be read.",
    fr: "Le montant n'a pas pu être lu."},
  no_deposit: {
    en: "The deposit never showed in the bank.",
    fr: "Le dépôt n'est jamais apparu à la banque."},
  two_claims: {
    en: "Two reports could be the same deposit.",
    fr: "Deux signalements pourraient viser le même dépôt."},
  deposit_taken: {
    en: "The deposit already paid someone.",
    fr: "Le dépôt a déjà payé quelqu'un."},
  already_recorded: {
    en: "A payment was already recorded.",
    fr: "Un paiement est déjà enregistré."},
  payment_undone: {
    en: "The payment was undone.",
    fr: "Le paiement a été annulé."},
});

/**
 * @param {string} name A first name ("" when unknown).
 * @param {"en"|"fr"} language The language.
 * @return {string} The name, or "Someone" / "Quelqu'un".
 */
function who(name, language) {
  return text(name, 120) || (language === "fr" ? "Quelqu'un" : "Someone");
}

/**
 * @param {Array<string>} names First names.
 * @param {"en"|"fr"} language The language.
 * @return {string} "Moussa, Awa, Ibrahim and 2 more".
 */
function nameList(names, language) {
  const clean = [...new Set((names || []).map((n) => text(n, 60))
      .filter(Boolean))];
  const shown = clean.slice(0, MAX_NAMES);
  const rest = clean.length - shown.length;
  const fr = language === "fr";
  if (rest > 0) {
    return `${shown.join(", ")} ${fr ? "et" : "and"} ${rest} ${
      fr ? (rest === 1 ? "autre" : "autres") : "more"}`;
  }
  if (shown.length > 1) {
    return `${shown.slice(0, -1).join(", ")} ${fr ? "et" : "and"} ${
      shown[shown.length - 1]}`;
  }
  return shown[0] || "";
}

const plural = (n, one, many) => (n === 1 ? one : many);

/**
 * The words of one alert (one event, or one aggregated run).
 *
 * @param {object} event {kind, plate, driverName, amountCents, reason,
 *   senderName, count, totalCents, names}.
 * @param {string} actorName The first name of who did it ("" none).
 * @param {"en"|"fr"} language The language.
 * @return {{title: string, body: string}} The copy.
 */
function fleetAlertCopy(event, actorName, language) {
  const fr = language === "fr";
  const e = event || {};
  const actor = who(actorName, fr ? "fr" : "en");
  const driver = text(e.driverName, 120);
  const amount = whole(e.amountCents);
  const n = Math.max(1, whole(e.count) || 1);
  switch (e.kind) {
    case KIND.PLATE_ADDED: {
      const plate = text(e.plate, 12);
      return fr ?
        {title: "Plaque ajoutée", body: `${actor} a ajouté la plaque ${
          plate}`.trim()} :
        {title: "Plate added", body: `${actor} added plate ${plate}`.trim()};
    }
    case KIND.DRIVER_ADDED:
      return fr ?
        {title: "Chauffeur ajouté", body: `${actor} a ajouté le chauffeur ${
          driver}`.trim()} :
        {title: "Driver added", body: `${actor} added driver ${
          driver}`.trim()};
    case KIND.PAYMENT_RECORDED: {
      if (fr) {
        return {title: "Paiement enregistré", body: `${actor} a enregistré ${
          amount ? `${money(amount)} ` : "un paiement "}${
          driver ? `de ${driver}` : ""}`.trim()};
      }
      return {title: "Payment recorded", body: `${actor} recorded ${
        amount ? `${money(amount)} ` : "a payment "}${
        driver ? `from ${driver}` : ""}`.trim()};
    }
    case KIND.BANK_MATCHED: {
      const total = whole(e.totalCents);
      const names = nameList(e.names, fr ? "fr" : "en");
      if (n === 1) {
        return fr ?
          {title: "Paiement de la banque", body: `La banque a enregistré ${
            money(total)}${names ? ` de ${names}` : ""}.`} :
          {title: "Bank payment", body: `The bank recorded ${money(total)}${
            names ? ` from ${names}` : ""}.`};
      }
      return fr ?
        {title: "Paiements de la banque", body: `La banque a enregistré ${n
        } paiements, ${money(total)} au total${
          names ? ` : ${names}` : ""}.`} :
        {title: "Bank payments", body: `The bank recorded ${n
        } payments, ${money(total)} in all${names ? `: ${names}` : ""}.`};
    }
    case KIND.DEPOSIT_WAITING: {
      const reason = (WAITING_REASON[e.reason] ||
        WAITING_REASON.unknown)[fr ? "fr" : "en"];
      if (n > 1) {
        const total = whole(e.totalCents);
        return fr ?
          {title: "Dépôts en attente", body: `${n} dépôts${
            total ? ` (${money(total)})` : ""} vous attendent.`} :
          {title: "Deposits waiting", body: `${n} deposits${
            total ? ` (${money(total)})` : ""} are waiting for you.`};
      }
      const from = text(e.senderName, 80);
      return fr ?
        {title: "Un dépôt vous attend", body: `${
          amount ? money(amount) : "Un dépôt"}${from ? ` de ${from}` : ""
        } n'a pas pu être attribué. ${reason}`} :
        {title: "A deposit needs you", body: `${
          amount ? money(amount) : "A deposit"}${from ? ` from ${from}` : ""
        } could not be given to a driver. ${reason}`};
    }
    case KIND.CLAIM_NEEDS_OFFICE: {
      const reason = (CLAIM_REASON[e.reason] || null);
      const why = reason ? ` ${reason[fr ? "fr" : "en"]}` : "";
      return fr ?
        {title: "Un signalement vous attend", body: `${
          driver || "Quelqu'un"} a envoyé un signalement de paiement${
          amount ? ` de ${money(amount)}` : ""}.${why}`} :
        {title: "A payment report needs you", body: `${
          driver || "Someone"} sent a payment report${
          amount ? ` of ${money(amount)}` : ""}.${why}`};
    }
    case KIND.BANK_TOOK_BACK: {
      const names = nameList(e.names, fr ? "fr" : "en");
      const total = whole(e.totalCents) || amount;
      if (n > 1) {
        return fr ?
          {title: "La banque a retiré des dépôts", body: `La banque a retiré ${
            n} dépôts qui avaient payé des chauffeurs${
            total ? ` (${money(total)})` : ""}. Gardez-les ou annulez-les.`} :
          {title: "The bank took back deposits", body: `The bank removed ${n
          } deposits that had paid drivers${
            total ? ` (${money(total)})` : ""}. Keep them or undo them.`};
      }
      return fr ?
        {title: "La banque a retiré un dépôt", body: `La banque a retiré ${
          total ? `un dépôt de ${money(total)}` : "un dépôt"}${
          names ? ` qui avait payé ${names}` : ""
        }. Gardez-le ou annulez-le.`} :
        {title: "The bank took back a deposit", body: `The bank removed ${
          total ? `a ${money(total)} deposit` : "a deposit"}${
          names ? ` that had paid ${names}` : ""}. Keep it or undo it.`};
    }
    default:
      return {title: "", body: ""};
  }
}

/**
 * The words of a window's summary.
 *
 * @param {string} kind A grouped kind.
 * @param {string} actorName The first name of who did them.
 * @param {number} count How many more since the first alert.
 * @param {"en"|"fr"} language The language.
 * @return {{title: string, body: string}} The copy.
 */
function fleetSummaryCopy(kind, actorName, count, language) {
  const fr = language === "fr";
  const n = Math.max(1, whole(count) || 1);
  const name = who(actorName, fr ? "fr" : "en");
  if (kind === KIND.PLATE_ADDED) {
    return fr ?
      {title: "Plaques ajoutées", body: `${name} a ajouté ${n} ${
        plural(n, "plaque", "plaques")} de plus`} :
      {title: "Plates added", body: `${name} added ${n} more ${
        plural(n, "plate", "plates")}`};
  }
  if (kind === KIND.DRIVER_ADDED) {
    return fr ?
      {title: "Chauffeurs ajoutés", body: `${name} a ajouté ${n} ${
        plural(n, "chauffeur", "chauffeurs")} de plus`} :
      {title: "Drivers added", body: `${name} added ${n} more ${
        plural(n, "driver", "drivers")}`};
  }
  return fr ?
    {title: "Paiements enregistrés", body: `${name} a enregistré ${n} ${
      plural(n, "paiement", "paiements")} de plus`} :
    {title: "Payments recorded", body: `${name} recorded ${n} more ${
      plural(n, "payment", "payments")}`};
}

// ---------------------------------------------------------------------------
// The push data (docs/FLEET.md section 18).
// ---------------------------------------------------------------------------

/**
 * @param {string} kind A kind.
 * @param {object} [event] The event (its ids pick the tab).
 * @return {string} needs | drivers | plates | payments | paperwork.
 */
function fleetTab(kind, event = {}) {
  if (KIND_LEVEL[kind] === LEVEL.NEEDS) return "needs";
  if (kind === KIND.PLATE_ADDED) return "plates";
  if (kind === KIND.DRIVER_ADDED) return "drivers";
  if (kind === KIND.PAYMENT_RECORDED) {
    return text(event.driverId) ? "drivers" : "payments";
  }
  return "payments";
}

/**
 * @param {object} event {kind, businessId, driverId, carId, paymentId}.
 * @return {object} String-valued data: never any other field of the event.
 */
function fleetAlertData(event) {
  const e = event || {};
  const data = {type: FLEET_ALERT_TYPE, businessId: text(e.businessId, 180),
    fleetKind: e.kind, fleetTab: fleetTab(e.kind, e)};
  for (const key of ["driverId", "carId", "paymentId"]) {
    const value = text(e[key], 180);
    if (value) data[key] = value;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Plans.
// ---------------------------------------------------------------------------

/**
 * @param {object} input {businessId, users, actorUid, actor}.
 * @return {string} The actor's first name ("" when unknown or no actor).
 */
function actorFirstName({users, actorUid, actor}) {
  const uid = text(actorUid);
  if (!uid) return "";
  const profile = (actor && text(actor.id) === uid ? actor : null) ||
    (Array.isArray(users) ? users : []).find((u) => text(u?.id) === uid);
  return profile ? sellerFirstName(profile) : "";
}

/**
 * Who hears about one event, and what each of them reads.
 *
 * @param {object} input {event, users, actor, ownerUids, isBlocked}; the
 *   event is {kind, businessId, actorUid, ...facts}.
 * @return {{recipients: Array<{uid: string, language: string, title: string,
 *   body: string}>, data: object}} The plan.
 */
function planFleetAlert({event, users, actor, ownerUids = [], isBlocked}) {
  const e = event || {};
  const data = fleetAlertData(e);
  const actorName = actorFirstName({users, actorUid: e.actorUid, actor});
  const copies = new Map();
  const recipients = planFleetRecipients({kind: e.kind,
    businessId: e.businessId, users, actorUid: e.actorUid, ownerUids,
    isBlocked}).map(({uid, user}) => {
    const language = recipientLanguage(user);
    if (!copies.has(language)) {
      copies.set(language, fleetAlertCopy(e, actorName, language));
    }
    return {uid, language, ...copies.get(language)};
  });
  return {recipients, data};
}

/**
 * Who hears a window's summary. A summary names no one record: the tap
 * opens the kind's tab.
 *
 * @param {object} input {kind, businessId, users, actorUid, actor,
 *   ownerUids, count, isBlocked}.
 * @return {{recipients: Array<object>, data: object}} The plan.
 */
function planFleetSummary({kind, businessId, users, actorUid, actor,
  ownerUids = [], count, isBlocked}) {
  const n = Math.max(1, whole(count) || 1);
  const data = {...fleetAlertData({kind, businessId}), summary: "true",
    count: String(n)};
  if (!isGroupedKind(kind)) return {recipients: [], data};
  const actorName = actorFirstName({users, actorUid, actor});
  const recipients = planFleetRecipients({kind, businessId, users, actorUid,
    ownerUids, isBlocked}).map(({uid, user}) => {
    const language = recipientLanguage(user);
    return {uid, language, ...fleetSummaryCopy(kind, actorName, n, language)};
  });
  return {recipients, data};
}

module.exports = {
  KIND,
  KINDS,
  LEVEL,
  KIND_LEVEL,
  GROUPED_KINDS,
  FLEET_ADMIN_PERMISSION,
  FLEET_ALERT_PREFERENCE,
  FLEET_ALERT_SETTINGS,
  FLEET_ALERT_TYPE,
  MAX_FLEET_RECIPIENTS,
  isFleetAlertKind,
  isGroupedKind,
  normalizeFleetAlertSetting,
  settingAllows,
  money,
  isFleetAdmin,
  planFleetRecipients,
  fleetAlertCopy,
  fleetSummaryCopy,
  fleetTab,
  fleetAlertData,
  planFleetAlert,
  planFleetSummary,
};
