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
 * full English and French text of each one).
 *
 *   package_received    - the package is registered (drop-off, or added
 *                         straight onto a container).
 *   container_departed  - the container has sailed.
 *   container_arrived   - the container reached the destination (whichever
 *                         of the carrier's "at the port" or staff's
 *                         "arrived" came first; one message, not two).
 *
 * Every template carries one dynamic URL button,
 * https://customer.laawoldigital.com/t/{{1}}, whose only parameter is the
 * tracking code. The template `container_status_update` (one template with
 * a "what happened" sentence) is retired; nothing sends it any more.
 *
 * Pure: no Firestore, no network.
 */

const TEMPLATE = Object.freeze({
  PACKAGE_RECEIVED: "package_received",
  CONTAINER_DEPARTED: "container_departed",
  CONTAINER_ARRIVED: "container_arrived",
});

// The variables a template can carry, by the name the builder fills them
// from.
const VARIABLE = Object.freeze({
  NAME: "name",
  BUSINESS: "business",
  WHAT: "what",
  DESTINATION: "destination",
  BUSINESS_PHONE: "businessPhone",
  TRACKING_CODE: "trackingCode",
});

// {{1}}, {{2}}, ... in the order the approved body uses them.
const TEMPLATE_VARIABLES = Object.freeze({
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

// The update a row is about -> its template. `at_port` is a legacy row
// written before the two arrival moments shared one message; it reads as
// the arrival.
const TEMPLATE_BY_UPDATE = Object.freeze({
  received: TEMPLATE.PACKAGE_RECEIVED,
  shipped: TEMPLATE.CONTAINER_DEPARTED,
  at_port: TEMPLATE.CONTAINER_ARRIVED,
  arrived: TEMPLATE.CONTAINER_ARRIVED,
});

const TEMPLATE_LANGUAGES = Object.freeze(["en", "fr"]);

// What a variable reads as when the record has nothing for it. WhatsApp
// refuses an empty parameter, so each one has words that still read right
// inside the approved sentence, in both languages.
const FALLBACK = Object.freeze({
  // "Hello there," / "Bonjour à vous,"
  [VARIABLE.NAME]: {en: "there", fr: "à vous"},
  [VARIABLE.BUSINESS]: {en: "Laawol", fr: "Laawol"},
  [VARIABLE.WHAT]: {en: "goods", fr: "marchandises"},
  // "going to its destination country" / "à destination de son pays de
  // destination" - only for a box that has no destination yet.
  [VARIABLE.DESTINATION]: {
    en: "its destination country",
    fr: "son pays de destination",
  },
  // "you can reach them on the number on your receipt" / "vous pouvez la
  // joindre au numéro indiqué sur votre reçu" - the French body reads
  // "joindre au {{5}}", so the fallback starts after "au".
  [VARIABLE.BUSINESS_PHONE]: {
    en: "the number on your receipt",
    fr: "numéro indiqué sur votre reçu",
  },
  [VARIABLE.TRACKING_CODE]: {en: "-", fr: "-"},
});

const MAX_PARAMETER = {
  [VARIABLE.NAME]: 60,
  [VARIABLE.BUSINESS]: 80,
  [VARIABLE.WHAT]: 160,
  [VARIABLE.DESTINATION]: 80,
  [VARIABLE.BUSINESS_PHONE]: 40,
  [VARIABLE.TRACKING_CODE]: 40,
};

// WhatsApp also refuses a parameter with a newline, a tab, or more than
// four spaces in a row.
const clean = (value, max) => String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, max);

/**
 * @param {string} update A row's update (received, shipped, at_port,
 *   arrived).
 * @return {string|null} The template's name, or null for an update that has
 *   no message.
 */
function templateForUpdate(update) {
  return TEMPLATE_BY_UPDATE[String(update ?? "").trim()] || null;
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
 * @param {"en"|"fr"} language The language.
 * @return {string} Never empty.
 */
function variableText(variable, values, language) {
  const max = MAX_PARAMETER[variable] || 120;
  return clean(values?.[variable], max) ||
    FALLBACK[variable][templateLanguage(language)];
}

/**
 * The template's `components` for one person: the body's variables in the
 * approved order and the tracking button.
 *
 * @param {string} template A TEMPLATE name.
 * @param {object} values {name, business, what, destination, businessPhone,
 *   trackingCode}; blanks fall back.
 * @param {"en"|"fr"} language The language.
 * @return {object[]} The Cloud API components.
 */
function templateComponents(template, values, language) {
  const order = TEMPLATE_VARIABLES[template];
  if (!order) throw new Error(`Unknown WhatsApp template: ${template}`);
  const parameter = (text) => ({type: "text", text});
  return [
    {
      type: "body",
      parameters: order.map((variable) =>
        parameter(variableText(variable, values, language))),
    },
    {
      // https://customer.laawoldigital.com/t/{{1}}
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [parameter(
          variableText(VARIABLE.TRACKING_CODE, values, language))],
    },
  ];
}

/**
 * The whole /messages request body for one person and one update.
 *
 * @param {object} args {phone, update, language, values}.
 * @return {object|null} The request body, or null for an update that has no
 *   template.
 */
function templateMessage(args) {
  const template = templateForUpdate(args?.update);
  if (!template) return null;
  const language = templateLanguage(args.language);
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

module.exports = {
  TEMPLATE,
  VARIABLE,
  TEMPLATE_VARIABLES,
  TEMPLATE_BY_UPDATE,
  TEMPLATE_LANGUAGES,
  FALLBACK,
  templateForUpdate,
  templateLanguage,
  variableText,
  templateComponents,
  templateMessage,
};
