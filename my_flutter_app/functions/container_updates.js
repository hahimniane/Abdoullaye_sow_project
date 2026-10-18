"use strict";

/**
 * Container updates - telling the people behind each line on a container
 * where their goods are, by WhatsApp, without anyone at the business having
 * to remember to.
 *
 * The pure half. A package is registered (`received`), then its container
 * moves (staff mark it shipped or arrived, or the carrier feed reports it on
 * the ship or landed); each move that a customer cares about is one
 * *update*, and each update becomes one WhatsApp template message per person
 * on each line: the customer who handed the goods in and the receiver who
 * collects them. Everything that touches Firestore or the WhatsApp Cloud API
 * stays in `index.js`.
 *
 * Two sources describe the same moment - staff tapping "Shipped" and the
 * carrier reporting "on_ship", or the carrier's "at the port" and staff's
 * "Arrived" - so a message is keyed by line, person and the message's
 * update (messageUpdateFor), never by what produced it. Whoever reports
 * first sends; the other finds the message already written and says
 * nothing.
 *
 * WhatsApp only lets a business start a conversation with a template that
 * Meta has approved. Which template each update sends, and the order of its
 * variables, live in whatsapp_templates.js; the approved text lives in
 * docs/WHATSAPP_CONTAINER_UPDATES.md and must match.
 */

const {isInternationalPhone} = require("./container_manifest");
const {ALL_COUNTRIES} = require("./country_catalog");
const {
  TEMPLATE_SET,
  templateMessage,
  whatsappTemplateSet,
} = require("./whatsapp_templates");
const {pickupDetails, pickupPlace} = require("./destination_pickup");
const {lineHasPieces, linePiecesWhat} = require("./line_pieces");

const CONTAINER_UPDATE = Object.freeze({
  // The package is registered: dropped off to wait for a container, or
  // added straight onto one. Per line, not a moment on a container's
  // timeline.
  RECEIVED: "received",
  SHIPPED: "shipped",
  // The carrier reports the box landed. A timeline moment of its own, but
  // never a message of its own: it shares the arrival's message (see
  // messageUpdateFor), so a person hears "arrived" once.
  AT_PORT: "at_port",
  ARRIVED: "arrived",
});
const CONTAINER_UPDATES = Object.freeze(Object.values(CONTAINER_UPDATE));

// What the carrier feed says -> the update a customer hears. Only the moves
// worth a message are here; anything else is recorded on the timeline and
// stays quiet.
const UPDATE_BY_CARRIER_STATUS = Object.freeze({
  on_ship: CONTAINER_UPDATE.SHIPPED,
  grounded: CONTAINER_UPDATE.AT_PORT,
  available: CONTAINER_UPDATE.AT_PORT,
});

// The carrier statuses that move the container's own state forward, so the
// business's list agrees with the sea without anyone tapping a button. Only
// sailing: "arrived" now means READY FOR PICKUP, which only staff can say -
// a box discharged at the port is not yet something a customer can collect.
const CONTAINER_STATUS_BY_CARRIER_STATUS = Object.freeze({
  on_ship: "shipped",
});

// Past these the carrier has nothing more to say about the box.
const CARRIER_FINAL_STATUSES = Object.freeze(
    ["picked_up", "delivered", "empty_returned"]);

// Countries where a customer is far more likely to read French than
// English. Everyone else gets English; the template exists in both.
const FRENCH_CALLING_CODES = Object.freeze([
  "33", "32", "41", "352", "377", "509", "212", "213", "216", "221", "222",
  "223", "224", "225", "226", "227", "228", "229", "235", "236", "237",
  "240", "241", "242", "243", "253", "257", "261", "269",
]);

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const positiveInt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * @param {string} phone An international number.
 * @return {"en"|"fr"} The template language for it.
 */
function languageForPhone(phone) {
  const digits = text(phone, 40).replace(/\D/g, "");
  return FRENCH_CALLING_CODES.some((code) => digits.startsWith(code)) ?
    "fr" : "en";
}

/**
 * The update a staff status change means.
 *
 * @param {string} status The container's new status.
 * @return {string|null} The update, or null.
 */
function updateForContainerStatus(status) {
  if (status === "shipped") return CONTAINER_UPDATE.SHIPPED;
  if (status === "arrived") return CONTAINER_UPDATE.ARRIVED;
  return null;
}

/**
 * The update a carrier status means, given where the container already is.
 * Once staff have said it arrived, "at the port" would be news from the
 * past, so it is not sent.
 *
 * @param {string} carrierStatus Terminal49's current_status.
 * @param {string} containerStatus The container's status before this.
 * @return {string|null} The update, or null.
 */
function updateForCarrierStatus(carrierStatus, containerStatus) {
  const update = UPDATE_BY_CARRIER_STATUS[text(carrierStatus, 60)] || null;
  if (update === CONTAINER_UPDATE.AT_PORT && containerStatus === "arrived") {
    return null;
  }
  return update;
}

/**
 * The container status the carrier's report moves it to, forward only.
 *
 * @param {string} carrierStatus Terminal49's current_status.
 * @param {string} containerStatus The container's status now.
 * @return {string|null} The next status, or null to leave it.
 */
function containerStatusFromCarrier(carrierStatus, containerStatus) {
  const target = CONTAINER_STATUS_BY_CARRIER_STATUS[text(carrierStatus, 60)];
  if (!target) return null;
  const order = ["loading", "shipped", "arrived"];
  const from = order.indexOf(text(containerStatus, 20) || "loading");
  const to = order.indexOf(target);
  if (to <= from) return null;
  // A box goes loading -> shipped -> arrived; a carrier report that skips a
  // step (the feed was only switched on after sailing) still lands on it.
  return target;
}

/**
 * @param {string} carrierStatus Terminal49's current_status.
 * @return {boolean} Whether polling this container can stop.
 */
function carrierTrackingFinished(carrierStatus) {
  return CARRIER_FINAL_STATUSES.includes(text(carrierStatus, 60));
}

/**
 * What is on the line, as a person would say it - no possessive, because
 * the receiver hears the same words as the sender.
 *
 * A line with pieces says what its pieces are ("2 barrels, 1 box"), or -
 * once it has been split across containers - which share of the whole this
 * part is ("2 of your 4 pieces" / "2 de vos 4 colis"; line_pieces.js).
 *
 * @param {object} line A containerLines row.
 * @param {"en"|"fr"} language The language.
 * @param {object|null} [group] lineGroupSummary of the line's group.
 * @return {string} e.g. "3 barrels", "2015 Toyota Camry (VIN …004352)".
 */
function describeLine(line, language, group = null) {
  const row = line && typeof line === "object" ? line : {};
  const fr = language === "fr";
  const kind = text(row.kind, 20);
  if (kind !== "car" && lineHasPieces(row)) {
    return linePiecesWhat(row, fr ? "fr" : "en", group);
  }
  if (kind === "car") {
    const car = [row.carYear, row.carMake, row.carModel]
        .map((part) => text(part, 80)).filter(Boolean).join(" ");
    const vin = text(row.vinNumber, 17);
    const tail = vin ? ` (VIN …${vin.slice(-6)})` : "";
    return `${car || (fr ? "le véhicule" : "the car")}${tail}`;
  }
  const quantity = positiveInt(row.quantity) || 1;
  if (kind === "barrels") {
    if (fr) return quantity === 1 ? "1 fût" : `${quantity} fûts`;
    return quantity === 1 ? "1 barrel" : `${quantity} barrels`;
  }
  const what = text(row.description, 120) || (fr ? "colis" : "package");
  return quantity === 1 ? what : `${quantity} × ${what}`;
}

/**
 * Who should hear about a line, and why anyone else will not.
 *
 * @param {object} line A containerLines row.
 * @return {{send: object[], skipped: object[]}} The people to message,
 *   each {role, name, phone}, and the people passed over with a reason.
 */
function recipientsForLine(line) {
  const row = line && typeof line === "object" ? line : {};
  const people = [];
  if (text(row.ownerKind, 20) === "customer") {
    people.push({
      role: "sender",
      name: text(row.customerName, 120),
      phone: text(row.customerPhone, 40),
      on: row.notifyCustomer !== false,
    });
  }
  people.push({
    role: "receiver",
    name: text(row.receiverName, 120),
    phone: text(row.receiverPhone, 40),
    on: row.notifyReceiver !== false,
  });
  const send = [];
  const skipped = [];
  for (const person of people) {
    const {on, ...who} = person;
    if (!who.phone) {
      // Nobody named and no number is not a skip worth reporting.
      if (who.name) skipped.push({...who, reason: "no_phone"});
    } else if (!on) {
      skipped.push({...who, reason: "switched_off"});
    } else if (!isInternationalPhone(who.phone)) {
      skipped.push({...who, reason: "needs_country_code"});
    } else {
      send.push(who);
    }
  }
  // The same number on both sides is one person; tell them once.
  const seen = new Set();
  const unique = send.filter((who) => {
    const digits = who.phone.replace(/\D/g, "");
    if (seen.has(digits)) return false;
    seen.add(digits);
    return true;
  });
  return {send: unique, skipped};
}

/**
 * One message's identity, so the same update never reaches the same person
 * twice, whichever source reported it first.
 *
 * @param {string} lineId The line.
 * @param {string} role "sender" or "receiver".
 * @param {string} update The update.
 * @return {string} A Firestore document id.
 */
function containerUpdateMessageId(lineId, role, update) {
  const safe = (value) => text(value, 120).replace(/[^A-Za-z0-9_-]/g, "");
  return `${safe(lineId)}_${safe(role)}_${safe(update)}`;
}

/**
 * The tracking link on a label and in every message: a short path the app
 * claims as a universal/app link (only /t/, so payment and sign-in pages
 * on the same host stay in the browser), and that the web host redirects
 * to the tracking page when the app is not installed. Short on purpose: a
 * shorter link is a less dense QR, and a less dense QR survives more damage.
 *
 * @param {string} consoleUrl The customer console's base URL.
 * @param {string} trackingCode The line's code.
 * @return {string} The URL.
 */
function trackingLink(consoleUrl, trackingCode) {
  const base = text(consoleUrl, 300).replace(/\/+$/, "") ||
    "https://customer.laawoldigital.com";
  const code = text(trackingCode, 40).toUpperCase().replace(/[^A-Z0-9-]/g, "");
  return `${base}/t/${code}`;
}

/**
 * The update a moment's message is keyed by.
 *
 * With the bilingual templates (the default) `arrived` is the
 * ready-for-pickup message, which only staff send by marking the container
 * ready for pickup; the carrier's "at the port" stays on the timeline and
 * sends nothing, since a box at the port cannot be collected yet.
 *
 * With the legacy templates the carrier's "at the port" and staff's
 * "arrived" are the same news (container_arrived: "it has arrived; the team
 * will tell you when it is ready"), so both are the `arrived` message:
 * whichever is reported first queues it, and the other finds the row
 * already written.
 *
 * @param {string} update A moment's customerUpdate.
 * @param {string} [templateSet] "bilingual" or "legacy"; the switch when
 *   omitted.
 * @return {string|null} The message's update, or null for none.
 */
function messageUpdateFor(update, templateSet = whatsappTemplateSet()) {
  const value = text(update, 20);
  if (value === CONTAINER_UPDATE.AT_PORT) {
    return templateSet === TEMPLATE_SET.LEGACY ?
      CONTAINER_UPDATE.ARRIVED : null;
  }
  return CONTAINER_UPDATES.includes(value) ? value : null;
}

const COUNTRY_BY_ID = new Map(ALL_COUNTRIES.map((c) => [c.id, c]));
const COUNTRY_BY_NAME = new Map(
    ALL_COUNTRIES.map((c) => [c.name.toLowerCase(), c]));
const CATALOG_NAME_BY_CODE = new Map(
    ALL_COUNTRIES.map((c) => [c.code, c.name]));
let frenchRegionNames = null;

/**
 * A country's ISO code from what a line or container stores (an ISO code
 * such as "gn", a catalog id such as "guinea", or only its name).
 *
 * @param {string} id destinationCountryId.
 * @param {string} name destinationCountryName.
 * @return {string} The two-letter code, or "".
 */
function countryCode(id, name) {
  const key = text(id, 60).toLowerCase();
  if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();
  const row = COUNTRY_BY_ID.get(key) ||
    COUNTRY_BY_NAME.get(text(name, 120).toLowerCase());
  return row ? row.code : "";
}

/**
 * Where the goods are going, in the reader's language: the line's own
 * destination (a waiting package carries one), else its container's.
 * French readers get the French name ("Guinée"); a country Intl does not
 * know keeps its stored name.
 *
 * @param {object} line A containerLines row.
 * @param {object|null} container Its container, if any.
 * @param {"en"|"fr"} language The language.
 * @return {string} The country's name, or "" when none is known.
 */
function destinationName(line, container, language) {
  const own = text(line?.destinationCountryName, 120) ||
    text(line?.destinationCountryId, 60);
  const source = own ? line : (container || {});
  const code = countryCode(source?.destinationCountryId,
      source?.destinationCountryName);
  const stored = text(source?.destinationCountryName, 120) ||
    (CATALOG_NAME_BY_CODE.get(code) || "");
  if (language !== "fr" || !code) return stored;
  try {
    frenchRegionNames = frenchRegionNames ||
      new Intl.DisplayNames(["fr"], {type: "region"});
    const french = frenchRegionNames.of(code);
    return french && french !== code ? french : stored;
  } catch (_) {
    return stored;
  }
}

/**
 * The business destination record a line's goods are collected from: the
 * line's own destination (a waiting package carries one), else its
 * container's. Records are keyed by the id the destination picker stores;
 * a stored ISO code or name is also tried as the catalog id.
 *
 * @param {object} line A containerLines row.
 * @param {object|null} container Its container, if any.
 * @return {string[]} Candidate destinationCountries ids, best first.
 */
function pickupDestinationIds(line, container) {
  const own = text(line?.destinationCountryId, 60) ||
    text(line?.destinationCountryName, 120);
  const source = own ? line : (container || {});
  const id = text(source?.destinationCountryId, 60);
  const code = countryCode(id, source?.destinationCountryName);
  const catalog = code ? ALL_COUNTRIES.find((c) => c.code === code) : null;
  const ids = [id, catalog ? catalog.id : "", code.toLowerCase()]
      .filter((value) => value && !value.includes("/"));
  return [...new Set(ids)];
}

/**
 * The WhatsApp Cloud API request body for one person and one update. The
 * template and the order of its variables live in whatsapp_templates.js;
 * this gathers the values from the records - each in the reader's language
 * for the legacy templates, and in both English and French for the
 * bilingual ones.
 *
 * @param {object} args {phone, name, businessName, businessPhone, business,
 *   line, container, pickupDestination, update, trackingCode,
 *   templateSet?, group?}. `group` is lineGroupSummary of a split line's
 *   group (the "what" then says which share this part is).
 *   `pickupDestination` is the destinationCountries record
 *   (pickupCity, pickupAddress, pickupPhone); `business` the business
 *   record (its address and phone are the pickup fallbacks).
 * @return {object|null} The /messages request body, or null for an update
 *   that has no message.
 */
function whatsappUpdateMessage(args) {
  const language = languageForPhone(args.phone);
  const destinationEn = destinationName(args.line, args.container, "en");
  const destinationFr = destinationName(args.line, args.container, "fr");
  const business = {
    ...(args.business && typeof args.business === "object" ?
      args.business : {}),
    phone: text(args.businessPhone, 40) || text(args.business?.phone, 40),
  };
  const pickup = pickupDetails(args.pickupDestination, business);
  return templateMessage({
    phone: text(args.phone, 40),
    update: args.update,
    language,
    templateSet: args.templateSet,
    values: {
      name: args.name,
      business: args.businessName,
      what: describeLine(args.line, language, args.group),
      destination: language === "fr" ? destinationFr : destinationEn,
      businessPhone: business.phone,
      trackingCode: args.trackingCode,
      whatEn: describeLine(args.line, "en", args.group),
      whatFr: describeLine(args.line, "fr", args.group),
      destinationEn,
      destinationFr,
      pickupPlaceEn: pickupPlace(pickup.city, destinationEn),
      pickupPlaceFr: pickupPlace(pickup.city, destinationFr),
      pickupAddress: pickup.address,
      pickupPhone: pickup.phone,
    },
  });
}

/**
 * Whether WhatsApp can send yet. Until Meta approves the business and the
 * token and number id are set, every message is recorded as waiting.
 *
 * @param {object} config {accessToken, phoneNumberId}.
 * @return {boolean} True when both are present and real.
 */
function whatsappConfigured(config) {
  const token = text(config?.accessToken, 1000);
  const numberId = text(config?.phoneNumberId, 60);
  const placeholder = (value) =>
    !value || ["unset", "none", "placeholder", "todo"]
        .includes(value.toLowerCase());
  return !placeholder(token) && /^\d{6,}$/.test(numberId);
}

// -------------------------------------------------------------------------
// The send queue. Recording an update writes one `containerUpdates` row per
// person (`queued`, or `waiting_for_whatsapp` until WhatsApp is connected);
// a separate trigger sends each queued row on its own, so a big container
// never runs one long serial loop, and a failure is retried row by row.
//
//   queued -> sending -> sent
//                     -> retrying -> sending ... (a 5xx, a 429, the network)
//                     -> failed                   (Meta refused the message)
//                     -> waiting_for_template     (template not approved yet)
//   waiting_for_template -> queued  (every 30 minutes, for up to 14 days,
//                                    so a newly approved template just works)
//
// A row is claimed in a transaction (queued/retrying -> sending, with a
// lease). A sender that dies mid-send leaves `sending` with a lease that
// runs out; after that the row may be claimed again. The cost is at most
// one duplicate message, never a row stuck forever.
// -------------------------------------------------------------------------

const UPDATE_STATUS = Object.freeze({
  QUEUED: "queued",
  SENDING: "sending",
  RETRYING: "retrying",
  SENT: "sent",
  FAILED: "failed",
  WAITING: "waiting_for_whatsapp",
  WAITING_TEMPLATE: "waiting_for_template",
});

// Meta's answer when a template name/language is not usable yet - the case
// right after a template is submitted and still in review. Such a row waits
// (it is not the message's fault) and is tried again until the template is
// approved, instead of failing for good.
const TEMPLATE_NOT_READY_CODES = Object.freeze([132001]);
// How long a row may wait for its template before it is given up on.
const TEMPLATE_WAIT_MAX_MS = 14 * 24 * 60 * 60 * 1000;

// Longer than one send can take (the fetch gives up at WHATSAPP_TIMEOUT_MS
// and the function at its own timeout), so a live sender is never robbed.
const WHATSAPP_SEND_LEASE_MS = 5 * 60 * 1000;
const WHATSAPP_TIMEOUT_MS = 15 * 1000;
const WHATSAPP_MAX_ATTEMPTS = 5;
// Retries of one event stop here even if something keeps throwing; the row
// is marked failed and can be sent again by hand (sendContainerCurrentStatus).
const WHATSAPP_MAX_EVENT_AGE_MS = 6 * 60 * 60 * 1000;

// How far along each update is. `received` is first: once the box ships,
// the line's summary moves on to that, and a late "received" finishing its
// send changes nothing. `at_port` stays ranked for lines summarised before
// the two arrival moments shared one message.
const UPDATE_RANK = Object.freeze({
  [CONTAINER_UPDATE.RECEIVED]: 1,
  [CONTAINER_UPDATE.SHIPPED]: 2,
  [CONTAINER_UPDATE.AT_PORT]: 3,
  [CONTAINER_UPDATE.ARRIVED]: 4,
});

/**
 * @param {string} update An update.
 * @return {number} How far along it is; 0 for anything unknown.
 */
function updateRank(update) {
  return UPDATE_RANK[text(update, 20)] || 0;
}

/**
 * Whether a write to a containerUpdates row is the one that asks for it to
 * be sent: it became `queued` (created queued, or re-queued by hand). The
 * sender's own writes (sending, retrying, sent) never are.
 *
 * @param {object|null} before The row before the write.
 * @param {object|null} after The row after it.
 * @return {boolean} True when this write should send.
 */
function shouldSendQueuedRow(before, after) {
  return text(after?.status, 40) === UPDATE_STATUS.QUEUED &&
    text(before?.status, 40) !== UPDATE_STATUS.QUEUED;
}

/**
 * Whether this sender may take the row, read inside the claiming
 * transaction.
 *
 * @param {object|null} row The containerUpdates row now.
 * @param {number} nowMs The time.
 * @param {object} [opts] {eventAgeMs, maxAttempts, maxEventAgeMs}.
 * @return {{action: string, attempts: number}} `claim` (send it), `busy`
 *   (another sender holds a live lease - retry later), `give_up` (too many
 *   tries or too old - mark failed), or `done` (nothing to do).
 */
function claimContainerUpdate(row, nowMs, opts = {}) {
  const maxAttempts = opts.maxAttempts || WHATSAPP_MAX_ATTEMPTS;
  const maxAge = opts.maxEventAgeMs || WHATSAPP_MAX_EVENT_AGE_MS;
  const attempts = positiveInt(row?.attempts);
  const status = text(row?.status, 40);
  const claimable = status === UPDATE_STATUS.QUEUED ||
    status === UPDATE_STATUS.RETRYING ||
    (status === UPDATE_STATUS.SENDING &&
      Number(row?.leaseUntilMs || 0) <= nowMs);
  if (!row || !claimable) {
    return {
      action: status === UPDATE_STATUS.SENDING ? "busy" : "done",
      attempts,
    };
  }
  if (attempts >= maxAttempts || Number(opts.eventAgeMs || 0) > maxAge) {
    return {action: "give_up", attempts};
  }
  return {action: "claim", attempts: attempts + 1};
}

/**
 * What a WhatsApp answer means for the row.
 *
 * @param {object} result {ok, httpStatus, errorCode} - httpStatus 0 when
 *   the request never got an answer (network, timeout); errorCode is Meta's
 *   error code when it gave one.
 * @return {"sent"|"retry"|"await_template"|"failed"} `retry` for what may
 *   pass on a second try (the network, Meta overloaded or rate-limiting),
 *   `await_template` while the template is not approved yet, `failed` for
 *   what never will (a number or a token Meta refused).
 */
function whatsappSendOutcome(result) {
  if (result?.ok) return "sent";
  if (TEMPLATE_NOT_READY_CODES.includes(Number(result?.errorCode || 0))) {
    return "await_template";
  }
  const status = Number(result?.httpStatus || 0);
  if (!status || status === 408 || status === 429 || status >= 500) {
    return "retry";
  }
  return "failed";
}

/**
 * The row's status after one attempt.
 *
 * @param {string} outcome From whatsappSendOutcome.
 * @param {number} attempts Attempts made, this one included.
 * @param {number} [maxAttempts] The bound.
 * @return {string} sent, retrying, waiting_for_template, or failed.
 */
function statusAfterAttempt(outcome, attempts,
    maxAttempts = WHATSAPP_MAX_ATTEMPTS) {
  if (outcome === "sent") return UPDATE_STATUS.SENT;
  if (outcome === "await_template") return UPDATE_STATUS.WAITING_TEMPLATE;
  if (outcome === "retry" && positiveInt(attempts) < maxAttempts) {
    return UPDATE_STATUS.RETRYING;
  }
  return UPDATE_STATUS.FAILED;
}

/**
 * What "send the current status" does with one person's row.
 *
 * @param {object|null} row The containerUpdates row, or null.
 * @param {number} nowMs The time.
 * @return {"create"|"requeue"|"already_sent"|"in_flight"} `create` when
 *   there is no row (the number was added after the update), `requeue` for
 *   one that waited for WhatsApp, failed, or whose sender died.
 */
function requeueDecision(row, nowMs) {
  if (!row) return "create";
  const status = text(row.status, 40);
  if (status === UPDATE_STATUS.SENT) return "already_sent";
  // Waiting for its template counts as on its way: the half-hourly sweep
  // sends it the moment the template is approved.
  if (status === UPDATE_STATUS.QUEUED || status === UPDATE_STATUS.RETRYING ||
      status === UPDATE_STATUS.WAITING_TEMPLATE) {
    return "in_flight";
  }
  if (status === UPDATE_STATUS.SENDING &&
      Number(row.leaseUntilMs || 0) > nowMs) {
    return "in_flight";
  }
  return "requeue";
}

/**
 * What the half-hourly sweep does with a row waiting for its template.
 *
 * @param {object|null} row The containerUpdates row.
 * @param {number} nowMs The time.
 * @param {number} [maxWaitMs] How long a row may wait.
 * @return {"requeue"|"expire"|"skip"} `requeue` to try again now, `expire`
 *   when it has waited too long (marked failed), `skip` for any other row.
 */
function templateWaitDecision(row, nowMs, maxWaitMs = TEMPLATE_WAIT_MAX_MS) {
  if (!row || text(row.status, 40) !== UPDATE_STATUS.WAITING_TEMPLATE) {
    return "skip";
  }
  const since = toMillis(row.createdAt) || toMillis(row.updatedAt);
  if (since && nowMs - since > maxWaitMs) return "expire";
  return "requeue";
}

const toMillis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The container's current update: the furthest one along its timeline, so a
 * late "on the ship" from the carrier never outranks "arrived". Read as the
 * message it sends, so the carrier's "at the port" is the arrival.
 *
 * @param {object[]} events trackingEvents rows.
 * @param {string} [templateSet] "bilingual" or "legacy"; the switch when
 *   omitted (see messageUpdateFor).
 * @return {string|null} The update, or null when nothing was ever sent.
 */
function latestCustomerUpdate(events, templateSet = whatsappTemplateSet()) {
  let best = null;
  let bestRank = 0;
  let bestAt = -1;
  for (const event of Array.isArray(events) ? events : []) {
    const update = messageUpdateFor(event?.customerUpdate, templateSet) || "";
    const rank = updateRank(update);
    if (!rank) continue;
    const at = toMillis(event?.timestamp);
    if (rank > bestRank || (rank === bestRank && at > bestAt)) {
      best = update;
      bestRank = rank;
      bestAt = at;
    }
  }
  return best;
}

/**
 * The line's `lastCustomerUpdate` after some people's news changed. Entries
 * replace the same person's entry for the same update; a newer update starts
 * the list again; an older one finishing late changes nothing.
 *
 * @param {object|null} previous The line's lastCustomerUpdate.
 * @param {string} update The update the entries are about.
 * @param {object[]} entries [{role, status, reason?}].
 * @param {number} atMs The time.
 * @return {object|null} The new value, or null to leave it.
 */
function mergeLastCustomerUpdate(previous, update, entries, atMs) {
  const incoming = (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && text(entry.role, 20));
  if (incoming.length === 0) return null;
  const before = previous && typeof previous === "object" ? previous : null;
  const beforeRank = updateRank(before?.update);
  const rank = updateRank(update);
  if (before && beforeRank > rank) return null;
  const kept = before && text(before.update, 20) === text(update, 20) &&
    Array.isArray(before.results) ? before.results : [];
  const roles = new Set(incoming.map((entry) => text(entry.role, 20)));
  const results = [
    ...kept.filter((entry) => !roles.has(text(entry?.role, 20))),
    ...incoming.map((entry) => ({
      role: text(entry.role, 20),
      status: text(entry.status, 40),
      ...(entry.reason ? {reason: text(entry.reason, 60)} : {}),
    })),
  ];
  return {update: text(update, 20), results, atMs};
}

module.exports = {
  UPDATE_STATUS,
  TEMPLATE_NOT_READY_CODES,
  TEMPLATE_WAIT_MAX_MS,
  templateWaitDecision,
  WHATSAPP_SEND_LEASE_MS,
  WHATSAPP_TIMEOUT_MS,
  WHATSAPP_MAX_ATTEMPTS,
  WHATSAPP_MAX_EVENT_AGE_MS,
  updateRank,
  shouldSendQueuedRow,
  claimContainerUpdate,
  whatsappSendOutcome,
  statusAfterAttempt,
  requeueDecision,
  latestCustomerUpdate,
  mergeLastCustomerUpdate,
  CONTAINER_UPDATE,
  CONTAINER_UPDATES,
  messageUpdateFor,
  countryCode,
  destinationName,
  languageForPhone,
  updateForContainerStatus,
  updateForCarrierStatus,
  containerStatusFromCarrier,
  carrierTrackingFinished,
  describeLine,
  recipientsForLine,
  containerUpdateMessageId,
  trackingLink,
  pickupDestinationIds,
  whatsappUpdateMessage,
  whatsappConfigured,
};
