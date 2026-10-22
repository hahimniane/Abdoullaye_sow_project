"use strict";

/**
 * Staff activity alerts (owner request, 2026-10-22): when someone of a
 * business parks a car or saves a package, the other people of the business
 * who work in that area hear about it - a push and an inbox entry, never an
 * email or an SMS, exactly like the inventory sale alerts.
 *
 * Who hears:
 *   - the business owner(s), always;
 *   - staff of that business who work in the area: a car -> the `parking`
 *     permission; a package -> `containers` or `deliveries`;
 *   - never the person who did it, never another business's people, never a
 *     blocked account, never someone who switched the alert off
 *     (`parkedCarAlerts` / `packageAlerts`); owners first, at most
 *     MAX_ACTIVITY_RECIPIENTS.
 *
 * Money: a deliveries-only person never sees what a package costs
 * (container_delivery.js DELIVERY_MONEY_SECTIONS); owners and staff with
 * containers or ledger see the price.
 *
 * Grouping, so a phone does not buzz 30 times while one person registers 30
 * packages: per (business, kind, actor) a window of ACTIVITY_WINDOW_MS. The
 * first event of a window is sent at once; the next ones only count
 * (`pending`). When the window has ended, the scheduled flush sends one
 * summary ("Aissatou saved 12 more packages") and resets the count. An event
 * that arrives after its window ended, before the flush ran, folds the
 * pending count into one summary right away.
 *
 * Pure: no Firestore, no clock. The triggers and the flush live in index.js
 * (notifyStaffOfParkedCar, notifyStaffOfNewPackage,
 * flushStaffActivityAlerts).
 */

const {recipientLanguage} = require("./notification_settings");
const {lineCustomerName} = require("./container_manifest");
const {DELIVERY_MONEY_SECTIONS} = require("./container_delivery");
const {isRootLine} = require("./volume_counts");
const {moneyText, sellerFirstName} = require("./inventory");

const ACTIVITY_KIND = Object.freeze({CAR: "car", PACKAGE: "package"});
const ACTIVITY_KINDS = Object.freeze(Object.values(ACTIVITY_KIND));

/** The notification preference that switches each alert off. */
const ACTIVITY_PREFERENCE = Object.freeze({
  car: "parkedCarAlerts",
  package: "packageAlerts",
});

/** The staff permissions that make someone work in the area. */
const ACTIVITY_SECTIONS = Object.freeze({
  car: Object.freeze(["parking"]),
  package: Object.freeze(["containers", "deliveries"]),
});

/** The `data.type` of each alert, which the apps route on. */
const ACTIVITY_NOTIFICATION_TYPE = Object.freeze({
  car: "parked_car",
  package: "container_line",
});

/** The most people one event notifies. */
const MAX_ACTIVITY_RECIPIENTS = 50;
/** How long further events of one person are grouped. */
const ACTIVITY_WINDOW_MS = 10 * 60 * 1000;
/**
 * A record created longer ago than this is not news: a copied or restored
 * record (a project migration, a backfill) never alerts anyone.
 */
const ACTIVITY_FRESH_MS = 60 * 60 * 1000;
/** A summary later than this after its window is dropped, not sent. */
const ACTIVITY_FLUSH_STALE_MS = 2 * 60 * 60 * 1000;

/** Server-only collections (firestore.rules denies every client). */
const STAFF_ACTIVITY_ALERTS = "staffActivityAlerts";
const STAFF_ACTIVITY_ALERT_CLAIMS = "staffActivityAlertClaims";

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

/**
 * @param {*} value A Firestore Timestamp, a Date, a number of ms, or a
 *   {seconds}/{_seconds} object.
 * @return {number|null} Milliseconds, or null when it is not a time.
 */
function toMillis(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value.toMillis === "function") return value.toMillis();
  const seconds = Number(value.seconds ?? value._seconds);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

/**
 * @param {*} kind A kind.
 * @return {boolean} Whether it is one of ACTIVITY_KINDS.
 */
function isActivityKind(kind) {
  return ACTIVITY_KINDS.includes(kind);
}

// ---------------------------------------------------------------------------
// Which records alert, and who did it.
// ---------------------------------------------------------------------------

/**
 * Who parked this car, when it was a business's person.
 *
 * - `createBusinessParkingEntry` (console, app "Record the car", the
 *   assistant) stamps `enteredByUid`.
 * - The app's "Print receipt only" writes the row directly and stamps
 *   `createdByUid` (the rules hold it to the signed-in person).
 * - A customer's online reservation (`createParkingReservation`) names only
 *   the customer (`customerUid`): it is not a car parked, so "".
 *
 * @param {object} car A parkedCars document.
 * @return {string} The uid, or "" when nobody of a business can be named.
 */
function parkedCarActor(car) {
  const row = car && typeof car === "object" ? car : {};
  const entered = text(row.enteredByUid);
  if (entered) return entered;
  const businessEntry = row.enteredByBusiness === true ||
    text(row.source) === "business";
  if (text(row.customerUid) && !businessEntry) return "";
  return text(row.createdByUid);
}

/**
 * A package somebody just registered: the root of its own group. A split
 * part (assignContainerLines leaving pieces behind) is the same package, so
 * it never alerts.
 *
 * @param {object} line A containerLines document.
 * @param {string} id Its document id.
 * @return {boolean} True for a new package.
 */
function isNewPackage(line, id) {
  const row = line && typeof line === "object" ? line : {};
  return isRootLine(row, id) && !text(row.splitFromLineId);
}

/**
 * @param {object} line A containerLines document.
 * @param {string} id Its document id.
 * @return {string} Who registered it ("" for a split part, or none named).
 */
function packageActor(line, id) {
  if (!isNewPackage(line, id)) return "";
  return text(line?.addedByStaffId);
}

/**
 * Whether a just-created record is an event to tell people about.
 *
 * @param {string} kind "car" | "package".
 * @param {object} record The document as created.
 * @param {string} id Its id.
 * @param {number} nowMs The time now.
 * @return {{skip: string}|{businessId: string, actorUid: string}} Why not
 *   (no_business, not_new, no_actor, stale, bad_kind), or the event.
 */
function activityEventFor(kind, record, id, nowMs) {
  if (!isActivityKind(kind)) return {skip: "bad_kind"};
  const row = record && typeof record === "object" ? record : {};
  const businessId = text(row.businessId);
  if (!businessId) return {skip: "no_business"};
  if (kind === ACTIVITY_KIND.PACKAGE && !isNewPackage(row, id)) {
    return {skip: "not_new"};
  }
  const actorUid = kind === ACTIVITY_KIND.CAR ?
    parkedCarActor(row) : packageActor(row, id);
  if (!actorUid) return {skip: "no_actor"};
  const createdMs = toMillis(row.createdAt);
  // The record's own time, checked against the clock both ways: a record
  // with no time, or one from long ago, is not news.
  if (createdMs === null || nowMs - createdMs > ACTIVITY_FRESH_MS ||
      createdMs - nowMs > ACTIVITY_FRESH_MS) {
    return {skip: "stale"};
  }
  return {businessId, actorUid};
}

// ---------------------------------------------------------------------------
// Who hears.
// ---------------------------------------------------------------------------

/**
 * @param {object} user A `users` profile.
 * @return {string[]} Its business permissions.
 */
function permissionsOf(user) {
  return Array.isArray(user?.businessPermissions) ?
    user.businessPermissions : [];
}

/**
 * @param {object} user A `users` profile with `id`.
 * @param {string} businessId The business.
 * @param {string[]} ownerUids The business document's owner(s).
 * @return {boolean} True when they are the business's owner.
 */
function isOwnerOf(user, businessId, ownerUids) {
  const uid = text(user?.id);
  if (uid && ownerUids.includes(uid)) return true;
  return user?.role === "businessOwner" &&
    text(user.businessId) === businessId;
}

/**
 * @param {object} user A `users` profile with `id`.
 * @param {string} businessId The business.
 * @param {string[]} [ownerUids] The business document's owner(s).
 * @return {boolean} True for the business's owner or one of its staff.
 */
function isBusinessPerson(user, businessId, ownerUids = []) {
  if (!user || !text(user.id)) return false;
  if (isOwnerOf(user, businessId, ownerUids)) return true;
  return user.role === "staff" && text(user.businessId) === businessId;
}

/**
 * @param {object} user A business person's profile.
 * @param {boolean} owner Whether they are the owner.
 * @return {boolean} Whether they may see what a package costs.
 */
function seesPackageMoney(user, owner) {
  if (owner) return true;
  const permissions = permissionsOf(user);
  return DELIVERY_MONEY_SECTIONS.some((section) =>
    permissions.includes(section));
}

/**
 * Who hears about one event (see the file comment).
 *
 * @param {object} input The event and the people.
 * @param {string} input.kind "car" | "package".
 * @param {string} input.businessId The business.
 * @param {Array<object>} input.users The business's profiles, each with
 *   its `id` (the uid).
 * @param {string} input.actorUid Who did it.
 * @param {string[]} [input.ownerUids] The business document's owner(s).
 * @param {function(object): boolean} [input.isBlocked] True for a blocked
 *   account (index.js accountAccessBlocked).
 * @return {Array<{uid: string, owner: boolean, user: object,
 *   seesMoney: boolean}>} Owners first, at most MAX_ACTIVITY_RECIPIENTS.
 */
function planActivityRecipients({kind, businessId, users, actorUid,
  ownerUids = [], isBlocked = () => false}) {
  if (!isActivityKind(kind)) return [];
  const business = text(businessId);
  const actor = text(actorUid);
  const owners = (Array.isArray(ownerUids) ? ownerUids : []).map((uid) =>
    text(uid)).filter(Boolean);
  const sections = ACTIVITY_SECTIONS[kind];
  const preference = ACTIVITY_PREFERENCE[kind];
  const chosen = [];
  const seen = new Set();
  for (const user of Array.isArray(users) ? users : []) {
    const uid = text(user?.id);
    if (!uid || uid === actor || seen.has(uid)) continue;
    if (!isBusinessPerson(user, business, owners)) continue;
    if (isBlocked(user)) continue;
    if (user.notificationPreferences?.[preference] === false) continue;
    const owner = isOwnerOf(user, business, owners);
    if (!owner && !sections.some((section) =>
      permissionsOf(user).includes(section))) {
      continue;
    }
    seen.add(uid);
    chosen.push({uid, owner, user,
      seesMoney: kind === ACTIVITY_KIND.PACKAGE &&
        seesPackageMoney(user, owner)});
  }
  chosen.sort((a, b) => (a.owner === b.owner ?
    (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0) : a.owner ? -1 : 1));
  return chosen.slice(0, MAX_ACTIVITY_RECIPIENTS);
}

/**
 * The actor's profile and whether an event of theirs alerts at all: only a
 * business's own staff or owner (a platform admin or a stranger: no).
 *
 * @param {object} input {businessId, users, actorUid, actor, ownerUids}.
 * @return {{ok: boolean, name: string}} Their first name ("" unknown).
 */
function activityActor({businessId, users, actorUid, actor, ownerUids = []}) {
  const uid = text(actorUid);
  const people = Array.isArray(users) ? users : [];
  const profile = (actor && text(actor.id) === uid ? actor : null) ||
    people.find((user) => text(user?.id) === uid) || null;
  const owners = (Array.isArray(ownerUids) ? ownerUids : []).map((id) =>
    text(id));
  const ok = Boolean(uid && profile &&
    isBusinessPerson(profile, text(businessId), owners));
  return {ok, name: ok ? sellerFirstName(profile) : ""};
}

// ---------------------------------------------------------------------------
// What they read.
// ---------------------------------------------------------------------------

/**
 * @param {object} car A parkedCars document.
 * @param {"en"|"fr"} language The language.
 * @return {string} "a 2018 Toyota Camry" / "une Toyota Camry 2018", or
 *   "a car" / "une voiture" when the record names no vehicle.
 */
function vehicleName(car, language) {
  const year = text(car?.carYear, 8);
  const make = text(car?.carMake, 80);
  const model = text(car?.carModel, 80);
  const name = [make, model].filter(Boolean).join(" ");
  if (language === "fr") {
    if (!name) return year ? `une voiture ${year}` : "une voiture";
    return `une ${[name, year].filter(Boolean).join(" ")}`;
  }
  const words = [year, name].filter(Boolean).join(" ");
  if (!words) return "a car";
  return `${/^[aeiou]/i.test(words) ? "an" : "a"} ${words}`;
}

/**
 * @param {string} name A first name ("" when unknown).
 * @param {"en"|"fr"} language The language.
 * @return {string} The name, or "Someone" / "Quelqu'un".
 */
function who(name, language) {
  return text(name, 120) || (language === "fr" ? "Quelqu'un" : "Someone");
}

/**
 * The words of one "car parked" alert.
 *
 * @param {object} car The parkedCars document.
 * @param {string} actorName The first name of who parked it.
 * @param {"en"|"fr"} language The language.
 * @return {{title: string, body: string}} The copy.
 */
function carAlertCopy(car, actorName, language) {
  const fr = language === "fr";
  const code = text(car?.trackingCode, 60) || text(car?.vinNumber, 40);
  const tail = code ? ` · ${code}` : "";
  const vehicle = vehicleName(car, fr ? "fr" : "en");
  if (fr) {
    return {title: "Voiture garée",
      body: `${who(actorName, "fr")} a garé ${vehicle}${tail}`};
  }
  return {title: "Car parked",
    body: `${who(actorName, "en")} parked ${vehicle}${tail}`};
}

/**
 * The words of one "package saved" alert.
 *
 * @param {object} line The containerLines document.
 * @param {object} where {containerNumber, containerLabel} of its container
 *   ("" / none for a waiting package).
 * @param {string} actorName The first name of who saved it.
 * @param {"en"|"fr"} language The language.
 * @param {boolean} showMoney Whether this reader may see the price.
 * @return {{title: string, body: string}} The copy.
 */
function packageAlertCopy(line, where, actorName, language, showMoney) {
  const fr = language === "fr";
  const customer = lineCustomerName(line);
  const price = Number(line?.priceCents);
  const money = showMoney && Number.isInteger(price) && price > 0 ?
    ` · ${moneyText(price)}` : "";
  const waiting = !text(line?.containerId);
  const box = text(where?.containerNumber, 40) ||
    text(where?.containerLabel, 80);
  let place = "";
  if (waiting) {
    place = fr ? " · en attente d'un conteneur" :
      " · waiting for a container";
  } else if (box) {
    place = ` · ${box}`;
  }
  if (fr) {
    return {title: "Colis enregistré",
      body: `${who(actorName, "fr")} a enregistré un colis` +
        (customer ? ` pour ${customer}` : "") + money + place};
  }
  return {title: "Package saved",
    body: `${who(actorName, "en")} saved a package` +
      (customer ? ` for ${customer}` : "") + money + place};
}

/**
 * The words of a window's summary.
 *
 * @param {string} kind "car" | "package".
 * @param {string} actorName The first name of who did them.
 * @param {number} count How many more since the first alert.
 * @param {"en"|"fr"} language The language.
 * @return {{title: string, body: string}} The copy.
 */
function activitySummaryCopy(kind, actorName, count, language) {
  const fr = language === "fr";
  const n = Math.max(1, Math.round(Number(count) || 1));
  const name = who(actorName, fr ? "fr" : "en");
  if (kind === ACTIVITY_KIND.CAR) {
    if (fr) {
      return {title: "Voitures garées",
        body: `${name} a garé ${n} ${n === 1 ? "voiture" : "voitures"} ` +
          "de plus"};
    }
    return {title: "Cars parked",
      body: `${name} parked ${n} more ${n === 1 ? "car" : "cars"}`};
  }
  if (fr) {
    return {title: "Colis enregistrés",
      body: `${name} a enregistré ${n} colis de plus`};
  }
  return {title: "Packages saved",
    body: `${name} saved ${n} more ${n === 1 ? "package" : "packages"}`};
}

/**
 * The tap payload of one event's alert.
 *
 * @param {string} kind "car" | "package".
 * @param {string} businessId The business.
 * @param {object} record The document.
 * @param {string} recordId Its id.
 * @return {object} String-valued data.
 */
function activityData(kind, businessId, record, recordId) {
  const id = text(recordId);
  const trackingCode = text(record?.trackingCode, 60);
  if (kind === ACTIVITY_KIND.CAR) {
    return {type: ACTIVITY_NOTIFICATION_TYPE.car, businessId,
      parkedCarId: id, trackingCode,
      relatedCollection: "parkedCars", relatedId: id};
  }
  return {type: ACTIVITY_NOTIFICATION_TYPE.package, businessId,
    lineId: id, containerId: text(record?.containerId), trackingCode,
    relatedCollection: "containerLines", relatedId: id};
}

/**
 * Who hears about one event, and what each of them reads.
 *
 * @param {object} input The event, its people and (for a package) where it
 *   is.
 * @param {string} input.kind "car" | "package".
 * @param {string} input.businessId The business.
 * @param {object} input.record The document as created.
 * @param {string} input.recordId Its id.
 * @param {Array<object>} input.users The business's profiles.
 * @param {string} input.actorUid Who did it.
 * @param {object} [input.actor] Their profile, when it is not in `users`.
 * @param {string[]} [input.ownerUids] The business document's owner(s).
 * @param {object} [input.container] {containerNumber, label} of the
 *   package's container.
 * @param {function(object): boolean} [input.isBlocked] Blocked accounts.
 * @return {{recipients: Array<{uid: string, language: string,
 *   title: string, body: string}>, data: object}} The plan (no recipients
 *   when the actor is not one of the business's people).
 */
function planActivityAlert({kind, businessId, record, recordId, users,
  actorUid, actor, ownerUids = [], container, isBlocked}) {
  const business = text(businessId);
  const data = activityData(kind, business, record, recordId);
  const actorInfo = activityActor({businessId: business, users, actorUid,
    actor, ownerUids});
  if (!actorInfo.ok) return {recipients: [], data};
  const where = {containerNumber: text(container?.containerNumber),
    containerLabel: text(container?.label)};
  const copies = new Map();
  const copyFor = (language, showMoney) => {
    const key = `${language}:${showMoney}`;
    if (!copies.has(key)) {
      copies.set(key, kind === ACTIVITY_KIND.CAR ?
        carAlertCopy(record, actorInfo.name, language) :
        packageAlertCopy(record, where, actorInfo.name, language, showMoney));
    }
    return copies.get(key);
  };
  const recipients = planActivityRecipients({kind, businessId: business,
    users, actorUid, ownerUids, isBlocked}).map(({uid, user, seesMoney}) => {
    const language = recipientLanguage(user);
    return {uid, language, ...copyFor(language, seesMoney)};
  });
  return {recipients, data};
}

/**
 * Who hears a window's summary, and what each reads. A summary names no one
 * record: the tap opens the list (parking, or the packages).
 *
 * @param {object} input {kind, businessId, users, actorUid, actor,
 *   ownerUids, count, isBlocked}.
 * @return {{recipients: Array<{uid: string, language: string,
 *   title: string, body: string}>, data: object}} The plan.
 */
function planActivitySummary({kind, businessId, users, actorUid, actor,
  ownerUids = [], count, isBlocked}) {
  const business = text(businessId);
  const n = Math.max(1, Math.round(Number(count) || 1));
  const data = {type: ACTIVITY_NOTIFICATION_TYPE[kind] || "",
    businessId: business, summary: "true", count: String(n)};
  const actorInfo = activityActor({businessId: business, users, actorUid,
    actor, ownerUids});
  if (!actorInfo.ok || !isActivityKind(kind)) return {recipients: [], data};
  const recipients = planActivityRecipients({kind, businessId: business,
    users, actorUid, ownerUids, isBlocked}).map(({uid, user}) => {
    const language = recipientLanguage(user);
    return {uid, language,
      ...activitySummaryCopy(kind, actorInfo.name, n, language)};
  });
  return {recipients, data};
}

// ---------------------------------------------------------------------------
// Grouping windows: staffActivityAlerts/{businessId}_{kind}_{actorUid}.
// ---------------------------------------------------------------------------

/**
 * @param {string} businessId The business.
 * @param {string} kind "car" | "package".
 * @param {string} actorUid Who.
 * @return {string} The window document's id.
 */
function activityWindowId(businessId, kind, actorUid) {
  return `${text(businessId)}_${text(kind)}_${text(actorUid)}`;
}

/**
 * @param {string} kind "car" | "package".
 * @param {string} recordId The parked car's or the line's id.
 * @return {string} The claim document's id: one per record, so a retried
 *   event never counts or sends twice.
 */
function activityClaimId(kind, recordId) {
  return `${text(kind)}_${text(recordId)}`;
}

/**
 * @param {*} value A stored count.
 * @return {number} A whole count, never negative.
 */
function pendingOf(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * What one new event does to its window.
 *
 * - No window, or its time is up with nothing waiting: "send" this one now
 *   and open a new window.
 * - Its time is up with events waiting (the flush has not run yet): one
 *   "summary" now of those and this one (`count`), and a new window.
 * - Inside the window: "hold" - only the count goes up; the flush sends it.
 *
 * @param {object|null} state The stored window ({windowEndMs, pending}).
 * @param {number} nowMs The time now.
 * @param {number} [windowMs] The window's length.
 * @return {{action: string, count: number, next: object}} What to do
 *   ("send", "summary" or "hold") and the window's fields to write.
 */
function planWindowEvent(state, nowMs, windowMs = ACTIVITY_WINDOW_MS) {
  const endMs = Number(state?.windowEndMs);
  const open = state && Number.isFinite(endMs) && nowMs < endMs;
  if (open) {
    const pending = pendingOf(state.pending) + 1;
    return {action: "hold", count: 0,
      next: {pending, flushDueMs: endMs, lastEventMs: nowMs}};
  }
  const carried = state ? pendingOf(state.pending) : 0;
  return {
    action: carried > 0 ? "summary" : "send",
    count: carried > 0 ? carried + 1 : 1,
    next: {windowStartMs: nowMs, windowEndMs: nowMs + windowMs, pending: 0,
      flushDueMs: null, lastEventMs: nowMs},
  };
}

/**
 * What the scheduled flush does to one window.
 *
 * @param {object} state The stored window.
 * @param {number} nowMs The time now.
 * @return {{flush: boolean, count: number, next: ?object}} Whether to
 *   send a summary of `count`, and the fields to write (null: none).
 */
function planWindowFlush(state, nowMs) {
  const endMs = Number(state?.windowEndMs);
  const pending = pendingOf(state?.pending);
  if (pending > 0 && Number.isFinite(endMs) && nowMs < endMs) {
    // Still open (the due time moved): leave it for a later run.
    return {flush: false, count: 0,
      next: state?.flushDueMs === endMs ? null : {flushDueMs: endMs}};
  }
  const reset = {pending: 0, flushDueMs: null};
  if (pending === 0) {
    return {flush: false, count: 0,
      next: state?.flushDueMs === null || state?.flushDueMs === undefined ?
        null : reset};
  }
  // Long overdue (the scheduler was down): stale news is dropped.
  if (!Number.isFinite(endMs) || nowMs - endMs > ACTIVITY_FLUSH_STALE_MS) {
    return {flush: false, count: 0, next: reset};
  }
  return {flush: true, count: pending, next: reset};
}

module.exports = {
  ACTIVITY_KIND,
  ACTIVITY_KINDS,
  ACTIVITY_PREFERENCE,
  ACTIVITY_SECTIONS,
  ACTIVITY_NOTIFICATION_TYPE,
  MAX_ACTIVITY_RECIPIENTS,
  ACTIVITY_WINDOW_MS,
  ACTIVITY_FRESH_MS,
  ACTIVITY_FLUSH_STALE_MS,
  STAFF_ACTIVITY_ALERTS,
  STAFF_ACTIVITY_ALERT_CLAIMS,
  toMillis,
  parkedCarActor,
  isNewPackage,
  packageActor,
  activityEventFor,
  isBusinessPerson,
  planActivityRecipients,
  activityActor,
  vehicleName,
  carAlertCopy,
  packageAlertCopy,
  activitySummaryCopy,
  activityData,
  planActivityAlert,
  planActivitySummary,
  activityWindowId,
  activityClaimId,
  planWindowEvent,
  planWindowFlush,
};
