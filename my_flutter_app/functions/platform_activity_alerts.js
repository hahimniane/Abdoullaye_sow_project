"use strict";

/**
 * Platform activity alerts (owner request, 2026-10-22): the platform's own
 * admins hear when people use the platform - a car parked, a package saved
 * or a shop sale, in any business. A push and an inbox entry, never an email
 * or an SMS.
 *
 * Who hears: platform admins whose role looks after businesses
 * (PLATFORM_ACTIVITY_ROLES), not blocked, who have not switched
 * `platformActivity` off. Never the person who did it, and never an owner of
 * that business (they already get the staff alert, staff_activity_alerts.js).
 *
 * Only a business's own people make news: a customer's online reservation
 * or an admin working inside a business never alerts (the same actor check
 * as the staff alerts).
 *
 * Grouping, so an admin's phone does not buzz for every package of every
 * business: one window per business (ACTIVITY_WINDOW_MS, shared with the
 * staff alerts). The first event of a window is sent at once, with its
 * details; the next ones are tallied per person and kind, and the scheduled
 * flush sends one summary per business ("Aissatou: 12 packages, 2 cars ·
 * Moussa: 3 sales ($240.00)"). The send/hold/summary steps are the staff
 * alerts' planWindowEvent / planWindowFlush; this file adds the tally.
 *
 * Sign-ups and staff joining are rare, so they go out at once through
 * index.js notifyAdminsForPlatformEvent (preference `businessActivity`).
 *
 * Pure: no Firestore, no clock. The triggers and the flush live in index.js
 * (notifyStaffOfParkedCar, notifyStaffOfNewPackage, notifyAdminsOfSale,
 * flushStaffActivityAlerts).
 */

const {recipientLanguage} = require("./notification_settings");
const {moneyText} = require("./inventory");
const staffActivity = require("./staff_activity_alerts");

const PLATFORM_KIND = Object.freeze({
  CAR: "car",
  PACKAGE: "package",
  SALE: "sale",
});
const PLATFORM_KINDS = Object.freeze(Object.values(PLATFORM_KIND));

/** The notification preference that switches the feed off. */
const PLATFORM_ACTIVITY_PREFERENCE = "platformActivity";
/** The `data.type` of every feed alert, which the consoles route on. */
const PLATFORM_ACTIVITY_TYPE = "platform_activity";
/** The `data.type` of "someone joined a business as staff". */
const BUSINESS_MEMBER_JOINED_TYPE = "business_member_joined";

/** Platform admin roles that look after businesses (index.js roles). */
const PLATFORM_ACTIVITY_ROLES = Object.freeze(
    ["superAdmin", "operationsManager"]);
/** The most admins one alert goes to. */
const MAX_PLATFORM_RECIPIENTS = 20;
/** People named in one summary; the rest are "+N others". */
const MAX_SUMMARY_PEOPLE = 4;

/** Server-only collections (firestore.rules denies every client). */
const PLATFORM_ACTIVITY_ALERTS = "platformActivityAlerts";
const PLATFORM_ACTIVITY_ALERT_CLAIMS = "platformActivityAlertClaims";

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

/**
 * @param {*} kind A kind.
 * @return {boolean} Whether it is one of PLATFORM_KINDS.
 */
function isPlatformKind(kind) {
  return PLATFORM_KINDS.includes(kind);
}

/**
 * @param {*} value A count.
 * @return {number} A whole count, never negative.
 */
function countOf(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// Which records alert.
// ---------------------------------------------------------------------------

/**
 * @param {object} sale An inventorySales document.
 * @return {number} How many pieces it sold.
 */
function salePieces(sale) {
  const lines = Array.isArray(sale?.lines) ? sale.lines : [];
  return lines.reduce((n, line) => n + countOf(line?.quantity), 0);
}

/**
 * Whether a just-created record is news for the platform admins.
 *
 * @param {string} kind "car" | "package" | "sale".
 * @param {object} record The document as created.
 * @param {string} id Its id.
 * @param {number} nowMs The time now.
 * @return {{skip: string}|{businessId: string, actorUid: string}} Why not,
 *   or the event.
 */
function platformEventFor(kind, record, id, nowMs) {
  if (!isPlatformKind(kind)) return {skip: "bad_kind"};
  if (kind !== PLATFORM_KIND.SALE) {
    return staffActivity.activityEventFor(kind, record, id, nowMs);
  }
  const row = record && typeof record === "object" ? record : {};
  const businessId = text(row.businessId);
  if (!businessId) return {skip: "no_business"};
  if (row.voided === true) return {skip: "voided"};
  const actorUid = text(row.soldByStaffId);
  if (!actorUid) return {skip: "no_actor"};
  const createdMs = staffActivity.toMillis(row.createdAt);
  if (createdMs === null ||
      Math.abs(nowMs - createdMs) > staffActivity.ACTIVITY_FRESH_MS) {
    return {skip: "stale"};
  }
  return {businessId, actorUid};
}

// ---------------------------------------------------------------------------
// Who hears.
// ---------------------------------------------------------------------------

/**
 * @param {object} user A `users` profile.
 * @return {boolean} True for a platform admin whose role gets the feed.
 */
function getsPlatformActivity(user) {
  return user?.role === "admin" &&
    PLATFORM_ACTIVITY_ROLES.includes(text(user.adminRole, 40));
}

/**
 * The admins one event (or summary) goes to.
 *
 * @param {object} input The admins and who to leave out.
 * @param {Array<object>} input.admins `users` profiles, each with `id`.
 * @param {string} [input.actorUid] Who did it.
 * @param {string[]} [input.ownerUids] The business's owner(s), who already
 *   get the staff alert.
 * @param {function(object): boolean} [input.isBlocked] Blocked accounts.
 * @return {Array<{uid: string, user: object}>} Sorted by uid, at most
 *   MAX_PLATFORM_RECIPIENTS.
 */
function planPlatformRecipients({admins, actorUid = "", ownerUids = [],
  isBlocked = () => false}) {
  const skip = new Set([text(actorUid),
    ...(Array.isArray(ownerUids) ? ownerUids : []).map((uid) => text(uid))]
      .filter(Boolean));
  const chosen = new Map();
  for (const user of Array.isArray(admins) ? admins : []) {
    const uid = text(user?.id);
    if (!uid || skip.has(uid) || chosen.has(uid)) continue;
    if (!getsPlatformActivity(user) || isBlocked(user)) continue;
    if (user.notificationPreferences?.[PLATFORM_ACTIVITY_PREFERENCE] ===
        false) {
      continue;
    }
    chosen.set(uid, {uid, user});
  }
  return [...chosen.values()]
      .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0))
      .slice(0, MAX_PLATFORM_RECIPIENTS);
}

// ---------------------------------------------------------------------------
// What they read.
// ---------------------------------------------------------------------------

/**
 * @param {string} name The business's name.
 * @param {"en"|"fr"} language The language.
 * @return {string} The name, or "A business" / "Une entreprise".
 */
function businessTitle(name, language) {
  return text(name, 120) || (language === "fr" ? "Une entreprise" :
    "A business");
}

/**
 * The words of one sale, for an admin.
 *
 * @param {object} sale The inventorySales document.
 * @param {string} actorName The seller's first name.
 * @param {"en"|"fr"} language The language.
 * @return {string} "Aissatou sold 3 pieces · $240.00".
 */
function saleBody(sale, actorName, language) {
  const fr = language === "fr";
  const name = text(actorName, 120) || (fr ? "Quelqu'un" : "Someone");
  const pieces = salePieces(sale);
  const total = moneyText(sale?.totalCents);
  if (fr) {
    return `${name} a vendu ${pieces} ` +
      `${pieces === 1 ? "article" : "articles"} · ${total}`;
  }
  return `${name} sold ${pieces} ${pieces === 1 ? "piece" : "pieces"} ` +
    `· ${total}`;
}

/**
 * The words of one event, for an admin: the business is the title, the
 * staff alert's sentence (with the price - an admin sees money) the body.
 *
 * @param {object} input The event.
 * @param {string} input.kind "car" | "package" | "sale".
 * @param {string} input.businessName The business's name.
 * @param {object} input.record The document.
 * @param {string} input.actorName Who did it (first name).
 * @param {object} [input.container] {containerNumber, label}.
 * @param {"en"|"fr"} input.language The language.
 * @return {{title: string, body: string}} The copy.
 */
function platformEventCopy({kind, businessName, record, actorName, container,
  language}) {
  const lang = language === "fr" ? "fr" : "en";
  const title = businessTitle(businessName, lang);
  if (kind === PLATFORM_KIND.SALE) {
    return {title, body: saleBody(record, actorName, lang)};
  }
  if (kind === PLATFORM_KIND.CAR) {
    return {title,
      body: staffActivity.carAlertCopy(record, actorName, lang).body};
  }
  const where = {containerNumber: text(container?.containerNumber),
    containerLabel: text(container?.label)};
  return {title, body: staffActivity.packageAlertCopy(record, where,
      actorName, lang, true).body};
}

/**
 * @param {string} kind "car" | "package" | "sale".
 * @param {number} n How many.
 * @param {"en"|"fr"} language The language.
 * @return {string} "2 cars" / "1 colis" / "3 ventes".
 */
function kindCount(kind, n, language) {
  const one = n === 1;
  if (language === "fr") {
    if (kind === PLATFORM_KIND.CAR) {
      return `${n} ${one ? "voiture" : "voitures"}`;
    }
    if (kind === PLATFORM_KIND.SALE) return `${n} ${one ? "vente" : "ventes"}`;
    return `${n} colis`;
  }
  if (kind === PLATFORM_KIND.CAR) return `${n} ${one ? "car" : "cars"}`;
  if (kind === PLATFORM_KIND.SALE) return `${n} ${one ? "sale" : "sales"}`;
  return `${n} ${one ? "package" : "packages"}`;
}

/**
 * @param {object} entry One person's tally.
 * @return {number} Their events in it.
 */
function entryTotal(entry) {
  return PLATFORM_KINDS.reduce((n, kind) => n + countOf(entry?.[kind]), 0);
}

/**
 * The words of a business's summary.
 *
 * @param {string} businessName The business's name.
 * @param {object} tally {uid: {name, car, package, sale, saleCents}}.
 * @param {"en"|"fr"} language The language.
 * @return {{title: string, body: string}} The copy.
 */
function platformSummaryCopy(businessName, tally, language) {
  const fr = language === "fr";
  const lang = fr ? "fr" : "en";
  const people = Object.values(tally && typeof tally === "object" ? tally : {})
      .filter((entry) => entryTotal(entry) > 0)
      .sort((a, b) => entryTotal(b) - entryTotal(a) ||
        text(a?.name).localeCompare(text(b?.name)));
  const parts = people.slice(0, MAX_SUMMARY_PEOPLE).map((entry) => {
    const name = text(entry.name, 120) || (fr ? "Quelqu'un" : "Someone");
    const counts = [PLATFORM_KIND.PACKAGE, PLATFORM_KIND.CAR,
      PLATFORM_KIND.SALE]
        .filter((kind) => countOf(entry[kind]) > 0)
        .map((kind) => {
          const words = kindCount(kind, countOf(entry[kind]), lang);
          const cents = countOf(entry.saleCents);
          return kind === PLATFORM_KIND.SALE && cents > 0 ?
            `${words} (${moneyText(cents)})` : words;
        });
    return `${name}${fr ? " : " : ": "}${counts.join(", ")}`;
  });
  const others = people.length - MAX_SUMMARY_PEOPLE;
  if (others > 0) {
    parts.push(fr ? `+${others} ${others === 1 ? "autre" : "autres"}` :
      `+${others} ${others === 1 ? "other" : "others"}`);
  }
  return {
    title: `${businessTitle(businessName, lang)} · ` +
      (fr ? "autre activité" : "more activity"),
    body: parts.join(" · "),
  };
}

/**
 * The tap payload of a feed alert. The consoles open the business.
 *
 * @param {string} kind "car" | "package" | "sale" ("" for a summary).
 * @param {string} businessId The business.
 * @param {string} [recordId] The record (none for a summary).
 * @return {object} String-valued data.
 */
function platformActivityData(kind, businessId, recordId = "") {
  const collections = {car: "parkedCars", package: "containerLines",
    sale: "inventorySales"};
  const id = text(recordId);
  return {type: PLATFORM_ACTIVITY_TYPE, businessId: text(businessId),
    kind: text(kind), summary: id ? "false" : "true",
    relatedCollection: id ? collections[kind] || "" : "", relatedId: id};
}

/**
 * Who hears one event, and what each reads.
 *
 * @param {object} input {kind, businessId, businessName, record, recordId,
 *   actorName, container, admins, actorUid, ownerUids, isBlocked}.
 * @return {{recipients: Array<{uid: string, language: string,
 *   title: string, body: string}>, data: object}} The plan.
 */
function planPlatformAlert({kind, businessId, businessName, record, recordId,
  actorName, container, admins, actorUid, ownerUids, isBlocked}) {
  const data = platformActivityData(kind, businessId, recordId);
  const copies = new Map();
  const recipients = planPlatformRecipients({admins, actorUid, ownerUids,
    isBlocked}).map(({uid, user}) => {
    const language = recipientLanguage(user);
    if (!copies.has(language)) {
      copies.set(language, platformEventCopy({kind, businessName, record,
        actorName, container, language}));
    }
    return {uid, language, ...copies.get(language)};
  });
  return {recipients, data};
}

/**
 * Who hears a business's summary, and what each reads.
 *
 * @param {object} input {businessId, businessName, tally, admins,
 *   ownerUids, isBlocked}.
 * @return {{recipients: Array<object>, data: object}} The plan (nobody when
 *   the tally is empty).
 */
function planPlatformSummary({businessId, businessName, tally, admins,
  ownerUids, isBlocked}) {
  const data = platformActivityData("", businessId);
  if (tallyTotal(tally) === 0) return {recipients: [], data};
  const recipients = planPlatformRecipients({admins, ownerUids, isBlocked})
      .map(({uid, user}) => {
        const language = recipientLanguage(user);
        return {uid, language,
          ...platformSummaryCopy(businessName, tally, language)};
      });
  return {recipients, data};
}

// ---------------------------------------------------------------------------
// Grouping windows: platformActivityAlerts/{businessId}.
// ---------------------------------------------------------------------------

/**
 * @param {object} tally A stored tally.
 * @return {number} Its events.
 */
function tallyTotal(tally) {
  return Object.values(tally && typeof tally === "object" ? tally : {})
      .reduce((n, entry) => n + entryTotal(entry), 0);
}

/**
 * A tally with one more event.
 *
 * @param {object} tally The stored tally (not changed).
 * @param {object} event {kind, actorUid, actorName, cents}.
 * @return {object} The new tally.
 */
function addToTally(tally, {kind, actorUid, actorName, cents = 0}) {
  const next = {};
  for (const [uid, entry] of Object.entries(
      tally && typeof tally === "object" ? tally : {})) {
    next[uid] = {...entry};
  }
  const uid = text(actorUid, 128);
  if (!uid || !isPlatformKind(kind)) return next;
  const entry = next[uid] || {};
  entry.name = text(actorName, 120) || text(entry.name, 120);
  entry[kind] = countOf(entry[kind]) + 1;
  if (kind === PLATFORM_KIND.SALE) {
    entry.saleCents = countOf(entry.saleCents) + countOf(cents);
  }
  next[uid] = entry;
  return next;
}

/**
 * @param {string} kind The kind.
 * @param {string} recordId The record's id.
 * @return {string} The claim document's id: one per record.
 */
function platformClaimId(kind, recordId) {
  return `${text(kind)}_${text(recordId)}`;
}

/**
 * What one new event does to its business's window: planWindowEvent's
 * send / hold / summary, plus the tally the summary will name.
 *
 * @param {object|null} state The stored window ({windowEndMs, pending,
 *   tally}).
 * @param {object} event {kind, actorUid, actorName, cents}.
 * @param {number} nowMs The time now.
 * @return {{action: string, tally: object, next: object}} What to do, the
 *   tally to send with a "summary", and the whole window to write.
 */
function planPlatformWindowEvent(state, event, nowMs) {
  const step = staffActivity.planWindowEvent(state, nowMs);
  const stored = state?.tally;
  if (step.action === "hold") {
    return {action: "hold", tally: {},
      next: {...state, ...step.next, tally: addToTally(stored, event)}};
  }
  return {
    action: step.action,
    tally: step.action === "summary" ? addToTally(stored, event) : {},
    next: {...step.next, tally: {}},
  };
}

/**
 * What the scheduled flush does to one business's window.
 *
 * @param {object} state The stored window.
 * @param {number} nowMs The time now.
 * @return {{flush: boolean, tally: object, next: ?object}} Whether to send
 *   a summary of `tally`, and the fields to write (null: none).
 */
function planPlatformWindowFlush(state, nowMs) {
  const step = staffActivity.planWindowFlush(state, nowMs);
  if (!step.next) return {flush: false, tally: {}, next: null};
  const resets = step.next.pending === 0;
  return {
    flush: step.flush,
    tally: step.flush ? state?.tally || {} : {},
    next: resets ? {...step.next, tally: {}} : step.next,
  };
}

module.exports = {
  PLATFORM_KIND,
  PLATFORM_KINDS,
  PLATFORM_ACTIVITY_PREFERENCE,
  PLATFORM_ACTIVITY_TYPE,
  BUSINESS_MEMBER_JOINED_TYPE,
  PLATFORM_ACTIVITY_ROLES,
  MAX_PLATFORM_RECIPIENTS,
  MAX_SUMMARY_PEOPLE,
  PLATFORM_ACTIVITY_ALERTS,
  PLATFORM_ACTIVITY_ALERT_CLAIMS,
  salePieces,
  platformEventFor,
  getsPlatformActivity,
  planPlatformRecipients,
  platformEventCopy,
  platformSummaryCopy,
  platformActivityData,
  planPlatformAlert,
  planPlatformSummary,
  tallyTotal,
  addToTally,
  platformClaimId,
  planPlatformWindowEvent,
  planPlatformWindowFlush,
};
