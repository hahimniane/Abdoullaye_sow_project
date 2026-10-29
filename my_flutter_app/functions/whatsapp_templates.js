"use strict";

/**
 * The WhatsApp templates customers receive about their goods, and the one
 * place that knows each template's name and the order of its variables.
 *
 * WhatsApp only lets a business start a conversation with a template Meta
 * has approved, so this module never composes free text: it fills the
 * approved template's numbered variables. Meta numbers variables in the
 * order they appear in the body, so the order here must follow the
 * approved wording exactly (docs/WHATSAPP_CONTAINER_UPDATES.md carries the
 * full text of each one).
 *
 * Two sets of templates exist; WHATSAPP_TEMPLATE_SET picks one.
 *
 * "bilingual" (the default) - ONE message per update with an English block
 * and then a French block, registered in Meta under language "en":
 *   shipment_received_2lang      - the package is registered.
 *   shipment_departed_2lang      - the container has sailed.
 *   shipment_ready_pickup_2lang  - staff marked it ready for pickup; carries
 *                                  the pickup place, address and phone.
 *   shipment_delivered_2lang     - destination staff handed it over (who
 *                                  collected it, and the day). It has no
 *                                  legacy version: the legacy set sends it
 *                                  too.
 *   package_confirm_2lang        - the sender is asked to confirm what was
 *                                  dropped off (docs/AIR_PACKAGES.md §3):
 *                                  the first photo as the header, the item
 *                                  list and weight, and two quick replies
 *                                  (OK / Something's wrong) instead of the
 *                                  tracking button. No legacy version.
 *   (A line with a pickupCode sends shipment_ready_pickup_2lang too: Meta's
 *   classifier rejects any template that carries a "code to show" as an
 *   authentication message, so the pickup number rides in the address
 *   parameter - container_updates.pickupAddressWithCode.)
 *
 * "legacy" - one template per update, in the reader's language (en or fr),
 * kept as the fallback in case Meta rejects the bilingual set:
 *   package_received, container_departed, container_arrived.
 *
 * Every template but the confirmation carries one dynamic URL button,
 * https://customer.laawoldigital.com/t/{{1}}, whose only parameter is the
 * tracking code (TEMPLATE_SHAPE lists the exceptions). The template
 * `container_status_update` is retired.
 *
 * Pure: no Firestore, no network.
 */

const {CONFIRM_PAYLOAD} = require("./package_proof");

const TEMPLATE = Object.freeze({
  // Bilingual (default).
  SHIPMENT_RECEIVED_2LANG: "shipment_received_2lang",
  SHIPMENT_DEPARTED_2LANG: "shipment_departed_2lang",
  SHIPMENT_READY_PICKUP_2LANG: "shipment_ready_pickup_2lang",
  SHIPMENT_DELIVERED_2LANG: "shipment_delivered_2lang",
  PACKAGE_CONFIRM_2LANG: "package_confirm_2lang",
  // Legacy, one language per message.
  PACKAGE_RECEIVED: "package_received",
  CONTAINER_DEPARTED: "container_departed",
  CONTAINER_ARRIVED: "container_arrived",
});

const TEMPLATE_SET = Object.freeze({
  BILINGUAL: "bilingual",
  LEGACY: "legacy",
});

const BILINGUAL_TEMPLATES = Object.freeze([
  TEMPLATE.SHIPMENT_RECEIVED_2LANG,
  TEMPLATE.SHIPMENT_DEPARTED_2LANG,
  TEMPLATE.SHIPMENT_READY_PICKUP_2LANG,
  TEMPLATE.SHIPMENT_DELIVERED_2LANG,
  TEMPLATE.PACKAGE_CONFIRM_2LANG,
]);
const LEGACY_TEMPLATES = Object.freeze([
  TEMPLATE.PACKAGE_RECEIVED,
  TEMPLATE.CONTAINER_DEPARTED,
  TEMPLATE.CONTAINER_ARRIVED,
]);

// The variables a template can carry, by the name the builder fills them
// from. The *_EN / *_FR ones are always in that language, whoever reads.
const VARIABLE = Object.freeze({
  NAME: "name",
  BUSINESS: "business",
  WHAT: "what",
  DESTINATION: "destination",
  BUSINESS_PHONE: "businessPhone",
  TRACKING_CODE: "trackingCode",
  WHAT_EN: "whatEn",
  WHAT_FR: "whatFr",
  DESTINATION_EN: "destinationEn",
  DESTINATION_FR: "destinationFr",
  PICKUP_PLACE_EN: "pickupPlaceEn",
  PICKUP_PLACE_FR: "pickupPlaceFr",
  PICKUP_ADDRESS: "pickupAddress",
  PICKUP_PHONE: "pickupPhone",
  // Delivered at destination: the day ("October 21, 2026" / "21 octobre
  // 2026") and who collected it.
  DELIVERED_ON_EN: "deliveredOnEn",
  DELIVERED_ON_FR: "deliveredOnFr",
  COLLECTED_BY_EN: "collectedByEn",
  COLLECTED_BY_FR: "collectedByFr",
  // Proof on a package (docs/AIR_PACKAGES.md): what is inside and how
  // heavy, the pickup code shown at handover, and the first drop-off photo
  // (a time-limited link; the confirmation's header, never a body text).
  CONTENTS_EN: "contentsEn",
  CONTENTS_FR: "contentsFr",
  WEIGHT_EN: "weightEn",
  WEIGHT_FR: "weightFr",
  PICKUP_CODE: "pickupCode",
  PHOTO_LINK: "photoLink",
  // Package requests (docs/PACKAGE_REQUESTS.md §7 "WhatsApp templates").
  TOTAL_EN: "totalEn",
  TOTAL_FR: "totalFr",
  PIECES_EN: "piecesEn",
  PIECES_FR: "piecesFr",
  HOURS_EN: "hoursEn",
  HOURS_FR: "hoursFr",
  REQUEST_CODE: "requestCode",
  TOKEN: "token",
});

// A variable that is always written in one language, whatever the template
// or the reader.
const VARIABLE_LANGUAGE = Object.freeze({
  [VARIABLE.WHAT_EN]: "en",
  [VARIABLE.WHAT_FR]: "fr",
  [VARIABLE.DESTINATION_EN]: "en",
  [VARIABLE.DESTINATION_FR]: "fr",
  [VARIABLE.PICKUP_PLACE_EN]: "en",
  [VARIABLE.PICKUP_PLACE_FR]: "fr",
  [VARIABLE.DELIVERED_ON_EN]: "en",
  [VARIABLE.DELIVERED_ON_FR]: "fr",
  [VARIABLE.COLLECTED_BY_EN]: "en",
  [VARIABLE.COLLECTED_BY_FR]: "fr",
  [VARIABLE.CONTENTS_EN]: "en",
  [VARIABLE.CONTENTS_FR]: "fr",
  [VARIABLE.WEIGHT_EN]: "en",
  [VARIABLE.WEIGHT_FR]: "fr",
  [VARIABLE.TOTAL_EN]: "en",
  [VARIABLE.TOTAL_FR]: "fr",
  [VARIABLE.PIECES_EN]: "en",
  [VARIABLE.PIECES_FR]: "fr",
  [VARIABLE.HOURS_EN]: "en",
  [VARIABLE.HOURS_FR]: "fr",
});

// {{1}}, {{2}}, ... in the order the approved body uses them.
const TEMPLATE_VARIABLES = Object.freeze({
  [TEMPLATE.SHIPMENT_RECEIVED_2LANG]: Object.freeze([
    VARIABLE.NAME,
    VARIABLE.BUSINESS, VARIABLE.WHAT_EN, VARIABLE.DESTINATION_EN,
    VARIABLE.BUSINESS, VARIABLE.WHAT_FR, VARIABLE.DESTINATION_FR,
    VARIABLE.TRACKING_CODE,
  ]),
  [TEMPLATE.SHIPMENT_DEPARTED_2LANG]: Object.freeze([
    VARIABLE.NAME,
    VARIABLE.WHAT_EN, VARIABLE.BUSINESS, VARIABLE.DESTINATION_EN,
    VARIABLE.WHAT_FR, VARIABLE.BUSINESS, VARIABLE.DESTINATION_FR,
    VARIABLE.TRACKING_CODE,
  ]),
  [TEMPLATE.SHIPMENT_READY_PICKUP_2LANG]: Object.freeze([
    VARIABLE.NAME,
    VARIABLE.WHAT_EN, VARIABLE.BUSINESS, VARIABLE.PICKUP_PLACE_EN,
    VARIABLE.WHAT_FR, VARIABLE.BUSINESS, VARIABLE.PICKUP_PLACE_FR,
    VARIABLE.PICKUP_ADDRESS, VARIABLE.PICKUP_PHONE, VARIABLE.TRACKING_CODE,
  ]),
  // 1 name, 2 business, 3 contents EN, 4 weight EN, 5 business,
  // 6 contents FR, 7 weight FR, 8 tracking code.
  [TEMPLATE.PACKAGE_CONFIRM_2LANG]: Object.freeze([
    VARIABLE.NAME,
    VARIABLE.BUSINESS, VARIABLE.CONTENTS_EN, VARIABLE.WEIGHT_EN,
    VARIABLE.BUSINESS, VARIABLE.CONTENTS_FR, VARIABLE.WEIGHT_FR,
    VARIABLE.TRACKING_CODE,
  ]),
  [TEMPLATE.SHIPMENT_DELIVERED_2LANG]: Object.freeze([
    VARIABLE.NAME,
    VARIABLE.BUSINESS, VARIABLE.WHAT_EN, VARIABLE.DELIVERED_ON_EN,
    VARIABLE.COLLECTED_BY_EN,
    VARIABLE.BUSINESS, VARIABLE.WHAT_FR, VARIABLE.DELIVERED_ON_FR,
    VARIABLE.COLLECTED_BY_FR,
    VARIABLE.TRACKING_CODE,
  ]),
  [TEMPLATE.PACKAGE_RECEIVED]: Object.freeze([
    VARIABLE.NAME, VARIABLE.BUSINESS, VARIABLE.WHAT, VARIABLE.DESTINATION,
    VARIABLE.TRACKING_CODE,
  ]),
  [TEMPLATE.CONTAINER_DEPARTED]: Object.freeze([
    VARIABLE.NAME, VARIABLE.WHAT, VARIABLE.BUSINESS, VARIABLE.DESTINATION,
    VARIABLE.TRACKING_CODE,
  ]),
  [TEMPLATE.CONTAINER_ARRIVED]: Object.freeze([
    VARIABLE.NAME, VARIABLE.WHAT, VARIABLE.BUSINESS, VARIABLE.DESTINATION,
    VARIABLE.BUSINESS_PHONE, VARIABLE.TRACKING_CODE,
  ]),
});

// The update a row is about -> its template, in the default (bilingual)
// set. `arrived` now means ready for pickup: staff mark it when the goods
// can be collected. The carrier's "at the port" is not ready for pickup,
// so it has no bilingual message (see messageUpdateFor in
// container_updates.js); an old `at_port` row sends nothing.
const TEMPLATE_BY_UPDATE = Object.freeze({
  received: TEMPLATE.SHIPMENT_RECEIVED_2LANG,
  // The sender's `received`, when the business asks senders to confirm.
  confirm: TEMPLATE.PACKAGE_CONFIRM_2LANG,
  shipped: TEMPLATE.SHIPMENT_DEPARTED_2LANG,
  // The pickup number, when the line has one, rides in the address line.
  arrived: TEMPLATE.SHIPMENT_READY_PICKUP_2LANG,
  delivered: TEMPLATE.SHIPMENT_DELIVERED_2LANG,
});

// The fallback set. `at_port` is a legacy row written before the two
// arrival moments shared one message; it reads as the arrival.
const LEGACY_TEMPLATE_BY_UPDATE = Object.freeze({
  received: TEMPLATE.PACKAGE_RECEIVED,
  shipped: TEMPLATE.CONTAINER_DEPARTED,
  at_port: TEMPLATE.CONTAINER_ARRIVED,
  arrived: TEMPLATE.CONTAINER_ARRIVED,
  // No legacy version exists: the delivered message is always the bilingual
  // one, whichever set is switched on. The same for the confirmation.
  delivered: TEMPLATE.SHIPMENT_DELIVERED_2LANG,
  confirm: TEMPLATE.PACKAGE_CONFIRM_2LANG,
});

// What a template carries besides its body. Every template has the
// tracking URL button unless listed here: the confirmation has the first
// drop-off photo as an image header and two quick replies, whose payloads
// (package_proof.CONFIRM_PAYLOAD) come back in the customer's button reply.
const TEMPLATE_SHAPE = Object.freeze({
  [TEMPLATE.PACKAGE_CONFIRM_2LANG]: Object.freeze({
    header: "image", buttons: "quick_reply",
  }),
});
const QUICK_REPLY_PAYLOADS = Object.freeze(
    [CONFIRM_PAYLOAD.OK, CONFIRM_PAYLOAD.PROBLEM]);

// Legacy templates exist in each reader's language; the bilingual ones are
// registered once, under "en".
const TEMPLATE_LANGUAGES = Object.freeze(["en", "fr"]);
const BILINGUAL_TEMPLATE_LANGUAGE = "en";

// What a variable reads as when the record has nothing for it. WhatsApp
// refuses an empty parameter, so each one has words that still read right
// inside the approved sentence: `en`/`fr` for the legacy templates (and the
// fixed-language variables), `both` for a shared variable in a bilingual
// template ("Hello / Bonjour {{1}}").
const FALLBACK = Object.freeze({
  // "Hello there," / "Bonjour à vous," / "Hello / Bonjour Client"
  [VARIABLE.NAME]: {en: "there", fr: "à vous", both: "Client"},
  [VARIABLE.BUSINESS]: {en: "Laawol", fr: "Laawol", both: "Laawol"},
  [VARIABLE.WHAT]: {en: "goods", fr: "marchandises"},
  [VARIABLE.WHAT_EN]: {en: "goods"},
  [VARIABLE.WHAT_FR]: {fr: "marchandises"},
  // "going to its destination country" / "à destination de son pays de
  // destination" - only for a box that has no destination yet.
  [VARIABLE.DESTINATION]: {
    en: "its destination country",
    fr: "son pays de destination",
  },
  [VARIABLE.DESTINATION_EN]: {en: "its destination country"},
  [VARIABLE.DESTINATION_FR]: {fr: "son pays de destination"},
  // "ready for pickup in the destination country" / "prêt à être récupéré
  // à destination".
  [VARIABLE.PICKUP_PLACE_EN]: {en: "the destination country"},
  [VARIABLE.PICKUP_PLACE_FR]: {fr: "destination"},
  // "Pickup address / Adresse : —"
  [VARIABLE.PICKUP_ADDRESS]: {en: "—", fr: "—", both: "—"},
  [VARIABLE.PICKUP_PHONE]: {en: "—", fr: "—", both: "—"},
  // "delivered your shipment of 3 barrels on the day it was collected" -
  // never reached in practice: a delivered line always has its day.
  [VARIABLE.DELIVERED_ON_EN]: {en: "the day it was collected"},
  [VARIABLE.DELIVERED_ON_FR]: {fr: "le jour de son retrait"},
  // "It was collected by the receiver." - a line that names nobody.
  [VARIABLE.COLLECTED_BY_EN]: {en: "the receiver"},
  [VARIABLE.COLLECTED_BY_FR]: {fr: "le destinataire"},
  // "received your package: your package (—)" - the builder already falls
  // back to the line's description, so these are the last resort.
  [VARIABLE.CONTENTS_EN]: {en: "your package"},
  [VARIABLE.CONTENTS_FR]: {fr: "votre colis"},
  [VARIABLE.WEIGHT_EN]: {en: "—"},
  [VARIABLE.WEIGHT_FR]: {fr: "—"},
  // Only sent for a line that has a code; never reached.
  [VARIABLE.PICKUP_CODE]: {en: "—", fr: "—", both: "—"},
  // "you can reach them on the number on your receipt" / "vous pouvez la
  // joindre au numéro indiqué sur votre reçu" - the French body reads
  // "joindre au {{5}}", so the fallback starts after "au".
  [VARIABLE.BUSINESS_PHONE]: {
    en: "the number on your receipt",
    fr: "numéro indiqué sur votre reçu",
  },
  [VARIABLE.TRACKING_CODE]: {en: "-", fr: "-", both: "-"},
  // "your estimate of to be confirmed" never reads; a request always has a
  // total when its estimate is sent. These keep a blank from being refused.
  [VARIABLE.TOTAL_EN]: {en: "to be confirmed"},
  [VARIABLE.TOTAL_FR]: {fr: "à confirmer"},
  [VARIABLE.PIECES_EN]: {en: "your goods"},
  [VARIABLE.PIECES_FR]: {fr: "vos colis"},
  [VARIABLE.HOURS_EN]: {en: "during opening hours"},
  [VARIABLE.HOURS_FR]: {fr: "aux heures d'ouverture"},
  [VARIABLE.REQUEST_CODE]: {en: "-", fr: "-", both: "-"},
  [VARIABLE.TOKEN]: {en: "-", fr: "-", both: "-"},
});

const MAX_PARAMETER = {
  [VARIABLE.NAME]: 60,
  [VARIABLE.BUSINESS]: 80,
  [VARIABLE.WHAT]: 160,
  [VARIABLE.WHAT_EN]: 160,
  [VARIABLE.WHAT_FR]: 160,
  [VARIABLE.DESTINATION]: 80,
  [VARIABLE.DESTINATION_EN]: 80,
  [VARIABLE.DESTINATION_FR]: 80,
  [VARIABLE.PICKUP_PLACE_EN]: 120,
  [VARIABLE.PICKUP_PLACE_FR]: 120,
  [VARIABLE.PICKUP_ADDRESS]: 200,
  [VARIABLE.PICKUP_PHONE]: 40,
  [VARIABLE.DELIVERED_ON_EN]: 40,
  [VARIABLE.DELIVERED_ON_FR]: 40,
  [VARIABLE.COLLECTED_BY_EN]: 120,
  [VARIABLE.COLLECTED_BY_FR]: 120,
  [VARIABLE.BUSINESS_PHONE]: 40,
  [VARIABLE.TRACKING_CODE]: 40,
  [VARIABLE.CONTENTS_EN]: 160,
  [VARIABLE.CONTENTS_FR]: 160,
  [VARIABLE.WEIGHT_EN]: 20,
  [VARIABLE.WEIGHT_FR]: 20,
  [VARIABLE.PICKUP_CODE]: 10,
  [VARIABLE.TOTAL_EN]: 40,
  [VARIABLE.TOTAL_FR]: 40,
  [VARIABLE.PIECES_EN]: 160,
  [VARIABLE.PIECES_FR]: 160,
  [VARIABLE.HOURS_EN]: 200,
  [VARIABLE.HOURS_FR]: 200,
  [VARIABLE.REQUEST_CODE]: 20,
  [VARIABLE.TOKEN]: 80,
};

// WhatsApp also refuses a parameter with a newline, a tab, or more than
// four spaces in a row.
const clean = (value, max) => String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, max);

/**
 * Which set of templates to send. One switch, read at send time, so a
 * rejected bilingual set is undone by setting WHATSAPP_TEMPLATE_SET=legacy
 * and redeploying the sender - no code change.
 *
 * @param {object} [env] The environment (process.env).
 * @return {"bilingual"|"legacy"} Anything but "legacy" is bilingual.
 */
function whatsappTemplateSet(env = process.env) {
  const value = String(env?.WHATSAPP_TEMPLATE_SET ?? "").trim().toLowerCase();
  return value === TEMPLATE_SET.LEGACY ?
    TEMPLATE_SET.LEGACY : TEMPLATE_SET.BILINGUAL;
}

/**
 * @param {string} template A TEMPLATE name.
 * @return {boolean} Whether it is one of the bilingual templates.
 */
function isBilingualTemplate(template) {
  return BILINGUAL_TEMPLATES.includes(template);
}

/**
 * @param {string} update A row's update (received, confirm, shipped,
 *   at_port, arrived, delivered).
 * @param {string} [templateSet] "bilingual" or "legacy"; the switch when
 *   omitted.
 * @return {string|null} The template's name, or null for an update that has
 *   no message.
 */
function templateForUpdate(update, templateSet = whatsappTemplateSet()) {
  const legacy = templateSet === TEMPLATE_SET.LEGACY;
  const map = legacy ? LEGACY_TEMPLATE_BY_UPDATE : TEMPLATE_BY_UPDATE;
  return map[String(update ?? "").trim()] || null;
}

/**
 * @param {string} language "en" or "fr".
 * @return {"en"|"fr"} The template language; anything else is English.
 */
function templateLanguage(language) {
  return language === "fr" ? "fr" : "en";
}

/**
 * One variable's text: the value, or its fallback when the value is blank.
 *
 * @param {string} variable A VARIABLE.
 * @param {object} values The values by variable name.
 * @param {"en"|"fr"|"both"} language The reader's language, or "both" for
 *   a bilingual template. A fixed-language variable ignores it.
 * @return {string} Never empty.
 */
function variableText(variable, values, language) {
  const max = MAX_PARAMETER[variable] || 120;
  const fallback = FALLBACK[variable] || {};
  const own = VARIABLE_LANGUAGE[variable];
  const lang = own || (language === "both" ? "both" :
    templateLanguage(language));
  return clean(values?.[variable], max) ||
    fallback[lang] || fallback.en || "-";
}

/**
 * The template's `components` for one person: the image header when the
 * template has one, the body's variables in the approved order, and its
 * buttons - the tracking URL button, or the quick replies (TEMPLATE_SHAPE).
 *
 * @param {string} template A TEMPLATE name.
 * @param {object} values By VARIABLE name; blanks fall back. `photoLink`
 *   fills an image header.
 * @param {"en"|"fr"} language The reader's language (ignored by a bilingual
 *   template, which fills both).
 * @return {object[]} The Cloud API components.
 */
function templateComponents(template, values, language) {
  const order = TEMPLATE_VARIABLES[template];
  if (!order) throw new Error(`Unknown WhatsApp template: ${template}`);
  const shape = TEMPLATE_SHAPE[template] || {header: "", buttons: "url"};
  const lang = isBilingualTemplate(template) ? "both" : language;
  const parameter = (text) => ({type: "text", text});
  const parts = [];
  if (shape.header === "image") {
    parts.push({
      type: "header",
      parameters: [{type: "image", image: {
        link: String(values?.[VARIABLE.PHOTO_LINK] ?? "").trim(),
      }}],
    });
  }
  parts.push({
    type: "body",
    parameters: order.map((variable) =>
      parameter(variableText(variable, values, lang))),
  });
  if (shape.buttons === "quick_reply") {
    QUICK_REPLY_PAYLOADS.forEach((payload, index) => parts.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(index),
      parameters: [{type: "payload", payload}],
    }));
  } else {
    parts.push({
      // https://customer.laawoldigital.com/t/{{1}}
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [parameter(
          variableText(VARIABLE.TRACKING_CODE, values, lang))],
    });
  }
  return parts;
}

/**
 * The whole /messages request body for one person and one update.
 *
 * @param {object} args {phone, update, language, values, templateSet?}.
 * @return {object|null} The request body, or null for an update that has no
 *   template.
 */
function templateMessage(args) {
  const templateSet = args?.templateSet || whatsappTemplateSet();
  const template = templateForUpdate(args?.update, templateSet);
  if (!template) return null;
  const language = isBilingualTemplate(template) ?
    BILINGUAL_TEMPLATE_LANGUAGE : templateLanguage(args.language);
  return {
    messaging_product: "whatsapp",
    to: String(args.phone ?? "").replace(/\D/g, ""),
    type: "template",
    template: {
      name: template,
      language: {code: language},
      components: templateComponents(template, args.values || {}, language),
    },
  };
}

// ---------------------------------------------------------------------------
// Package requests (docs/PACKAGE_REQUESTS.md §7, §8.3). Two bilingual
// templates (language "en", category Utility), each with one dynamic URL
// button https://customer.laawoldigital.com/e/{{1}} whose parameter is the
// request's token (never its code). They are not part of TEMPLATE above:
// that set is the container updates', and its rows are about lines.
// ---------------------------------------------------------------------------

const REQUEST_TEMPLATE = Object.freeze({
  PACKAGE_ESTIMATE_2LANG: "package_estimate_2lang",
  PACKAGE_DROPOFF_REMINDER_2LANG: "package_dropoff_reminder_2lang",
});

const REQUEST_TEMPLATE_VARIABLES = Object.freeze({
  // 1 name, 2 business, 3 total EN, 4 pieces EN, 5 destination EN,
  // 6 business, 7 total FR, 8 pieces FR, 9 destination FR, 10 request code.
  [REQUEST_TEMPLATE.PACKAGE_ESTIMATE_2LANG]: Object.freeze([
    VARIABLE.NAME,
    VARIABLE.BUSINESS, VARIABLE.TOTAL_EN, VARIABLE.PIECES_EN,
    VARIABLE.DESTINATION_EN,
    VARIABLE.BUSINESS, VARIABLE.TOTAL_FR, VARIABLE.PIECES_FR,
    VARIABLE.DESTINATION_FR,
    VARIABLE.REQUEST_CODE,
  ]),
  // 1 name, 2 business, 3 pieces EN, 4 hours EN, 5 business, 6 pieces FR,
  // 7 hours FR, 8 request code.
  [REQUEST_TEMPLATE.PACKAGE_DROPOFF_REMINDER_2LANG]: Object.freeze([
    VARIABLE.NAME,
    VARIABLE.BUSINESS, VARIABLE.PIECES_EN, VARIABLE.HOURS_EN,
    VARIABLE.BUSINESS, VARIABLE.PIECES_FR, VARIABLE.HOURS_FR,
    VARIABLE.REQUEST_CODE,
  ]),
});

/**
 * @param {string} update A request row's update: `estimate_v{n}`,
 *   `estimate_reminder` or `dropoff_reminder`.
 * @return {string|null} Its template, or null.
 */
function requestTemplateForUpdate(update) {
  const value = String(update ?? "").trim();
  if (/^estimate_v\d+$/.test(value) || value === "estimate_reminder") {
    return REQUEST_TEMPLATE.PACKAGE_ESTIMATE_2LANG;
  }
  if (value === "dropoff_reminder") {
    return REQUEST_TEMPLATE.PACKAGE_DROPOFF_REMINDER_2LANG;
  }
  return null;
}

/**
 * The /messages body for one request message.
 *
 * @param {object} args {phone, update, values} - values by VARIABLE name,
 *   `token` for the button.
 * @return {object|null} The request body, or null for an unknown update.
 */
function requestTemplateMessage(args) {
  const template = requestTemplateForUpdate(args?.update);
  if (!template) return null;
  const values = args.values || {};
  const parameter = (value) => ({type: "text", text: value});
  return {
    messaging_product: "whatsapp",
    to: String(args.phone ?? "").replace(/\D/g, ""),
    type: "template",
    template: {
      name: template,
      language: {code: BILINGUAL_TEMPLATE_LANGUAGE},
      components: [
        {
          type: "body",
          parameters: REQUEST_TEMPLATE_VARIABLES[template].map((variable) =>
            parameter(variableText(variable, values, "both"))),
        },
        {
          // https://customer.laawoldigital.com/e/{{1}}
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [parameter(variableText(VARIABLE.TOKEN, values,
              "both"))],
        },
      ],
    },
  };
}

/**
 * The sign-in code (docs/PHONE_ACCOUNTS.md §5.1): an AUTHENTICATION
 * template, one per language, whose wording Meta fixes ("{{1}} is your
 * verification code...") with a copy-code button. The code fills both the
 * body variable and the button.
 */
const LOGIN_TEMPLATE = "laawol_login_code";
const LOGIN_TEMPLATE_LANGUAGES = Object.freeze(["en", "fr"]);

/**
 * The /messages body for one sign-in code.
 *
 * @param {{phone: string, code: string, language: string}} args Who, what
 *   and in which language ("fr" or anything else for English).
 * @return {object} The request body.
 */
function loginCodeTemplateMessage(args) {
  const code = String(args?.code ?? "").replace(/\D/g, "").slice(0, 8);
  const parameter = {type: "text", text: code};
  return {
    messaging_product: "whatsapp",
    to: String(args?.phone ?? "").replace(/\D/g, ""),
    type: "template",
    template: {
      name: LOGIN_TEMPLATE,
      language: {code: args?.language === "fr" ? "fr" : "en"},
      components: [
        {type: "body", parameters: [parameter]},
        // The copy-code button carries the code as its one parameter.
        {type: "button", sub_type: "url", index: "0",
          parameters: [parameter]},
      ],
    },
  };
}

/**
 * The staff invitation (docs/STAFF_PHONE_INVITES.md). Meta's own Template
 * Library template `account_creation_confirmation_3`, created as
 * `staff_account_setup` in en_US and fr (pre-approved UTILITY; fixed wording,
 * only the parameters are ours). Our earlier `staff_invite_2lang` was
 * re-categorized MARKETING by Meta, and marketing templates are not delivered
 * to US numbers; a reworded one was rejected. Created by the owner with
 * ~/laawol-deploy-logs/create_staff_setup_template.py.
 *
 *   EN  Hi {{1}}, Your new account has been created successfully. Please
 *       verify {{2}} to complete your profile.   [Verify account]
 *   FR  Bonjour {{1}}, Votre nouveau compte a été créé correctement.
 *       Veuillez confirmer votre {{2}} pour terminer la configuration de
 *       votre profil.   [Confirmer le compte]
 *
 * One URL button, https://customer.laawoldigital.com/j/{{1}}, whose
 * parameter is the invitation's link token.
 */
const STAFF_INVITE_TEMPLATE = "staff_account_setup";
// The library template is registered per language (not one 2-language body).
const STAFF_INVITE_LANGUAGES = Object.freeze({en: "en_US", fr: "fr"});
// {{1}} invited person, {{2}} what to verify ("your staff access at X").
const STAFF_INVITE_VARIABLES = Object.freeze(["name", "access"]);
const STAFF_INVITE_FALLBACK = Object.freeze({
  en: {name: "there", business: "Laawol"},
  fr: {name: "à vous", business: "Laawol"},
});

// Meta's library templates refuse a text value over 30 characters
// ("(#100) Invalid parameter ... exceeds the length limit of 30 characters").
const STAFF_INVITE_MAX_PARAM = 30;

/**
 * {{2}}, what the person verifies: names the business when that fits in
 * Meta's 30-character limit, otherwise the generic wording.
 *
 * @param {"en"|"fr"} language The invitation's language.
 * @param {string} business The business name (already cleaned).
 * @return {string} At most 30 characters.
 */
function staffInviteAccessText(language, business) {
  const named = language === "fr" ?
    `accès chez ${business}` : `your ${business} access`;
  if (named.length <= STAFF_INVITE_MAX_PARAM) return named;
  return language === "fr" ? "accès employé" : "your staff access";
}

/**
 * The invitation's language: French when the invite was made in French,
 * English otherwise.
 *
 * @param {string} locale The invitation's locale ("fr", "fr-FR", "en", ...).
 * @return {"en"|"fr"} The language.
 */
function staffInviteLanguage(locale) {
  return /^fr/i.test(String(locale ?? "").trim()) ? "fr" : "en";
}

/**
 * The /messages body for one staff invitation.
 *
 * @param {{phone: string, name: string, business: string, token: string,
 *   locale: string}} args Who is invited, to which business, the link token
 *   for the button, and the invitation's language.
 * @return {object} The request body.
 */
function staffInviteTemplateMessage(args) {
  const values = args || {};
  const language = staffInviteLanguage(values.locale);
  const fallback = STAFF_INVITE_FALLBACK[language];
  const business = clean(values.business, 60) || fallback.business;
  const access = staffInviteAccessText(language, business);
  const parameter = (text) => ({type: "text", text});
  return {
    messaging_product: "whatsapp",
    to: String(values.phone ?? "").replace(/\D/g, ""),
    type: "template",
    template: {
      name: STAFF_INVITE_TEMPLATE,
      language: {code: STAFF_INVITE_LANGUAGES[language]},
      components: [
        {
          type: "body",
          parameters: [
            parameter(clean(values.name, STAFF_INVITE_MAX_PARAM) ||
                fallback.name),
            parameter(access),
          ],
        },
        {
          // https://customer.laawoldigital.com/j/{{1}}
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [parameter(String(values.token ?? "")
              .replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64))],
        },
      ],
    },
  };
}

module.exports = {
  TEMPLATE,
  TEMPLATE_SET,
  BILINGUAL_TEMPLATES,
  LEGACY_TEMPLATES,
  VARIABLE,
  VARIABLE_LANGUAGE,
  TEMPLATE_VARIABLES,
  TEMPLATE_BY_UPDATE,
  LEGACY_TEMPLATE_BY_UPDATE,
  TEMPLATE_SHAPE,
  QUICK_REPLY_PAYLOADS,
  TEMPLATE_LANGUAGES,
  BILINGUAL_TEMPLATE_LANGUAGE,
  FALLBACK,
  whatsappTemplateSet,
  isBilingualTemplate,
  templateForUpdate,
  templateLanguage,
  variableText,
  templateComponents,
  templateMessage,
  REQUEST_TEMPLATE,
  REQUEST_TEMPLATE_VARIABLES,
  requestTemplateForUpdate,
  requestTemplateMessage,
  LOGIN_TEMPLATE,
  LOGIN_TEMPLATE_LANGUAGES,
  loginCodeTemplateMessage,
  STAFF_INVITE_TEMPLATE,
  STAFF_INVITE_VARIABLES,
  STAFF_INVITE_LANGUAGES,
  STAFF_INVITE_MAX_PARAM,
  staffInviteLanguage,
  staffInviteAccessText,
  staffInviteTemplateMessage,
};
