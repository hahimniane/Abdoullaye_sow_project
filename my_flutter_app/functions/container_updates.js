"use strict";

/**
 * Container updates - telling the people behind each line on a container
 * where their goods are, by WhatsApp, without anyone at the business having
 * to remember to.
 *
 * The pure half. A container moves (staff mark it shipped or arrived, or the
 * carrier feed reports it on the ship or landed); each move that a customer
 * cares about is one *update*, and each update becomes one WhatsApp template
 * message per person on each line: the customer who handed the goods in and
 * the receiver who collects them. Everything that touches Firestore or the
 * WhatsApp Cloud API stays in `index.js`.
 *
 * Two sources describe the same moment - staff tapping "Shipped" and the
 * carrier reporting "on_ship" - so a message is keyed by line, person and
 * update, never by what produced it. Whoever reports first sends; the other
 * finds the message already written and says nothing.
 *
 * WhatsApp only lets a business start a conversation with a template that
 * Meta has approved, so the copy here fills a template's variables rather
 * than composing free text. The template text lives in
 * docs/WHATSAPP_CONTAINER_UPDATES.md and must match what is approved.
 */

const {isInternationalPhone} = require("./container_manifest");

const CONTAINER_UPDATE = Object.freeze({
  SHIPPED: "shipped",
  AT_PORT: "at_port",
  ARRIVED: "arrived",
});
const CONTAINER_UPDATES = Object.freeze(Object.values(CONTAINER_UPDATE));

const WHATSAPP_TEMPLATE = "container_status_update";

// What the carrier feed says -> the update a customer hears. Only the moves
// worth a message are here; anything else is recorded on the timeline and
// stays quiet.
const UPDATE_BY_CARRIER_STATUS = Object.freeze({
  on_ship: CONTAINER_UPDATE.SHIPPED,
  grounded: CONTAINER_UPDATE.AT_PORT,
  available: CONTAINER_UPDATE.AT_PORT,
});

// The carrier statuses that move the container's own state forward, so the
// business's list agrees with the sea without anyone tapping a button.
const CONTAINER_STATUS_BY_CARRIER_STATUS = Object.freeze({
  on_ship: "shipped",
  grounded: "arrived",
  available: "arrived",
  picked_up: "arrived",
  delivered: "arrived",
  empty_returned: "arrived",
});

// Past these the carrier has nothing more to say about the box.
const CARRIER_FINAL_STATUSES = Object.freeze(
    ["picked_up", "delivered", "empty_returned"]);

// Whole sentences, because the template reads "...about {{3}}: {{4}}" and
// a phrase that has to agree with "3 barrels" or "a car" never does in both
// languages.
const STATUS_COPY = Object.freeze({
  [CONTAINER_UPDATE.SHIPPED]: {
    en: "the container has left port and is on its way",
    fr: "le conteneur a quitté le port et est en route",
  },
  [CONTAINER_UPDATE.AT_PORT]: {
    en: "the container has reached the destination port and is being unloaded",
    fr: "le conteneur est arrivé au port de destination et est en cours " +
      "de déchargement",
  },
  [CONTAINER_UPDATE.ARRIVED]: {
    en: "it has arrived at its destination",
    fr: "l'envoi est arrivé à destination",
  },
});

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
 * @param {object} line A containerLines row.
 * @param {"en"|"fr"} language The language.
 * @return {string} e.g. "3 barrels", "2015 Toyota Camry (VIN …004352)".
 */
function describeLine(line, language) {
  const row = line && typeof line === "object" ? line : {};
  const fr = language === "fr";
  const kind = text(row.kind, 20);
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
 * The WhatsApp Cloud API request body for one person.
 *
 * Template body ({{n}} in order): the person's name, the business, what is
 * on the line, what just happened, the tracking code. The button opens the
 * tracking page; its URL ends in {{1}}, the tracking code.
 *
 * @param {object} args {phone, name, businessName, line, update,
 *   trackingCode}.
 * @return {object} The /messages request body.
 */
function whatsappUpdateMessage(args) {
  const language = languageForPhone(args.phone);
  const fr = language === "fr";
  // The template opens "Hello {{1}}," / "Bonjour {{1}},", and Meta refuses
  // an empty variable.
  const name = text(args.name, 60) || (fr ? "à vous" : "there");
  const status = STATUS_COPY[args.update] || STATUS_COPY.shipped;
  const parameter = (value) => ({type: "text", text: text(value, 300)});
  return {
    messaging_product: "whatsapp",
    to: text(args.phone, 40).replace(/\D/g, ""),
    type: "template",
    template: {
      name: WHATSAPP_TEMPLATE,
      language: {code: language},
      components: [
        {
          type: "body",
          parameters: [
            parameter(name),
            parameter(text(args.businessName, 80) || "Laawol"),
            parameter(describeLine(args.line, language)),
            parameter(status[language]),
            parameter(args.trackingCode),
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [parameter(args.trackingCode)],
        },
      ],
    },
  };
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

module.exports = {
  CONTAINER_UPDATE,
  CONTAINER_UPDATES,
  WHATSAPP_TEMPLATE,
  STATUS_COPY,
  languageForPhone,
  updateForContainerStatus,
  updateForCarrierStatus,
  containerStatusFromCarrier,
  carrierTrackingFinished,
  describeLine,
  recipientsForLine,
  containerUpdateMessageId,
  trackingLink,
  whatsappUpdateMessage,
  whatsappConfigured,
};
