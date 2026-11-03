"use strict";

/**
 * "Send a package" inside WhatsApp (docs/PACKAGE_PRICE_LIST.md §5): a
 * WhatsApp Flow on the Laawol number, backed by a data endpoint that lives
 * on the existing `whatsappWebhook` (no new function: the CPU budget is
 * full).
 *
 * Screens: WHERE (country, Sea/Air) -> ITEMS (up to 4 kinds + something
 * else) -> AMOUNTS (how many, or the pounds, per kind) -> HOW (bring
 * it / pick it up + address) -> PICK (compare the
 * businesses; skipped when the customer came from a business's QR) ->
 * WHEN (day and 2-hour window) -> PEOPLE (names, receiver phone) -> REVIEW
 * (send). The answers live server-side in `whatsappFlowSessions/{token}`;
 * the request is created by the same helper as the app and website.
 *
 * This file holds the pure parts: the Flow JSON, the encryption Meta asks
 * for, and every step's decision with its dependencies injected
 * (test/whatsapp-package-flow.test.js).
 */

const crypto = require("crypto");
const priceList = require("./package_price_list");

const FLOW_VERSION = "6.0";
const DATA_API_VERSION = "3.0";
const SCREENS = Object.freeze(["WHERE", "ITEMS", "AMOUNTS", "HOW", "PICK",
  "WHEN", "PEOPLE", "REVIEW"]);
const SLOTS = 4;
const DAYS_AHEAD = 14;
const PICKUP_DAY = Object.freeze({from: "07:00", to: "21:00"});
const SESSION_MS = 24 * 60 * 60 * 1000;
const MAX_OPTIONS = 200;
const MAX_BUSINESSES = 20;

/** Messages that open the form (whole message, accents and case ignored). */
const OPEN_WORDS = Object.freeze(["send a package", "send package",
  "send a parcel", "envoyer un colis", "envoyer colis", "send", "envoyer",
  "ship", "expedier un colis", "expedier"]);

// ---------------------------------------------------------------------------
// Words. Labels have Meta's limits (labels 20, titles 30, Footer 35).
// ---------------------------------------------------------------------------

const T = Object.freeze({
  en: {
    whereTitle: "Send a package", country: "Country", mode: "Ships by",
    sea: "Sea", air: "Air", next: "Next",
    itemsTitle: "What are you sending", itemsIntro:
      "Pick up to 4 kinds of items. You say how many on the next screen.",
    item: "Item", other: "Something else",
    amountsTitle: "How many", amountsIntro:
      "For things sold by the pound, give the pounds (a suitcase is " +
      "about 50 lb).",
    count: "How many", pounds: "Weight (lb)",
    otherHelp: "Anything not in the list: the business sends its price.",
    howTitle: "Drop-off or pickup", how: "How", bring: "I'll bring it",
    pickup: "Pick it up from me", address: "Pickup address",
    addressHelp: "Street, city, ZIP. Needed for a pickup.",
    pickTitle: "Choose a business", business: "Business",
    pickIntro: "Best match first: full price known, then lowest total.",
    whenTitle: "When", when: "Day and time",
    peopleTitle: "Who", senderName: "Your name",
    receiverName: "Receiver's name", receiverPhone: "Receiver's phone",
    phoneHelp: "With country code, e.g. +224 620 00 00 00",
    reviewTitle: "Check and send", send: "Send request",
    toQuote: "to quote", about: "about", noPickup: "Doesn't pick up there",
    pickupFee: "pickup", nextFlight: "Next flight", nextBox:
      "Next container", around: "around", notConfirmed:
      "Departure date not confirmed", paysBack: "Pays back if lost",
    reviews: "reviews", upTo: "up to", perLb: "/lb", each: "each",
    pay: "You pay at drop-off or pickup. Weighed items are priced on the " +
      "scale.",
    total: "Total", items: "Items", from: "From", to: "To", at: "At",
    noBusinesses: "No business ships there by this way yet.",
    errItems: "Add at least one item.",
    errQty: "Check the amounts: 1 to 50 items, or pounds.",
    errAddress: "Enter the pickup address.",
    errPick: "Choose a business.", errWhen: "Choose a day and time.",
    errNames: "Enter both names.", errPhone:
      "Enter the receiver's phone with its country code.",
    errGone: "This form expired. Send \"Send a package\" again.",
    errSend: "We could not send it. Check the answers and try again.",
    errAir: "Air is not offered there. Choose Sea.",
    something: "Something else",
  },
  fr: {
    whereTitle: "Envoyer un colis", country: "Pays", mode: "Par",
    sea: "Bateau", air: "Avion", next: "Suivant",
    itemsTitle: "Que voulez-vous envoyer", itemsIntro:
      "Choisissez jusqu'à 4 sortes d'articles. Vous donnez les quantités " +
      "à l'écran suivant.",
    item: "Article", other: "Autre chose",
    amountsTitle: "Combien", amountsIntro:
      "Pour ce qui se paie à la livre, donnez les livres (une valise fait " +
      "environ 50 lb).",
    count: "Combien", pounds: "Poids (lb)",
    otherHelp: "Ce qui n'est pas dans la liste : l'entreprise donne son prix.",
    howTitle: "Dépôt ou ramassage", how: "Comment", bring: "Je l'apporte",
    pickup: "Venez le chercher", address: "Adresse",
    addressHelp: "Rue, ville, code postal. Pour un ramassage.",
    pickTitle: "Choisir une entreprise", business: "Entreprise",
    pickIntro: "Le meilleur choix d'abord : prix complet, puis le moins cher.",
    whenTitle: "Quand", when: "Jour et heure",
    peopleTitle: "Qui", senderName: "Votre nom",
    receiverName: "Nom du destinataire", receiverPhone: "Tél. destinataire",
    phoneHelp: "Avec l'indicatif, ex. +224 620 00 00 00",
    reviewTitle: "Vérifier et envoyer", send: "Envoyer la demande",
    toQuote: "à chiffrer", about: "environ", noPickup:
      "Ne ramasse pas à cette adresse", pickupFee: "ramassage",
    nextFlight: "Prochain vol", nextBox: "Prochain conteneur",
    around: "vers le", notConfirmed: "Date de départ non confirmée",
    paysBack: "Rembourse en cas de perte", reviews: "avis", upTo:
      "jusqu'à", perLb: "/lb", each: "chacun",
    pay: "Vous payez au dépôt ou au ramassage. Les articles pesés sont " +
      "facturés à la balance.",
    total: "Total", items: "Articles", from: "De", to: "Pour", at: "À",
    noBusinesses: "Aucune entreprise n'envoie encore là-bas de cette façon.",
    errItems: "Ajoutez au moins un article.",
    errQty: "Vérifiez les quantités : 1 à 50 articles, ou des livres.",
    errAddress: "Entrez l'adresse du ramassage.",
    errPick: "Choisissez une entreprise.",
    errWhen: "Choisissez un jour et une heure.",
    errNames: "Entrez les deux noms.",
    errPhone: "Entrez le téléphone du destinataire avec l'indicatif.",
    errGone: "Ce formulaire a expiré. Écrivez « Envoyer un colis ».",
    errSend: "Envoi impossible. Vérifiez les réponses et réessayez.",
    errAir: "L'avion n'est pas proposé là-bas. Choisissez Bateau.",
    something: "Autre chose",
  },
});
/**
 * @param {string} lang "en" | "fr".
 * @return {object} The words.
 */
function words(lang) {
  return lang === "fr" ? T.fr : T.en;
}

const clip = (value, max) => {
  const s = String(value ?? "").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/**
 * @param {number} cents Whole cents.
 * @param {string} lang "en" | "fr".
 * @return {string} "$1,234.50" / "1 234,50 $".
 */
function money(cents, lang) {
  const value = (Number(cents) || 0) / 100;
  const whole = Number.isInteger(value);
  if (lang === "fr") {
    return `${value.toLocaleString("fr-FR", {minimumFractionDigits:
      whole ? 0 : 2, maximumFractionDigits: 2})} $`.replace(/\u202f/g, " ");
  }
  return `$${value.toLocaleString("en-US", {minimumFractionDigits:
    whole ? 0 : 2, maximumFractionDigits: 2})}`;
}

/**
 * @param {string} hhmm "14:00".
 * @param {string} lang "en" | "fr".
 * @return {string} "2 PM" / "14 h".
 */
function clock(hhmm, lang) {
  const [h, m] = String(hhmm).split(":").map(Number);
  if (lang === "fr") {
    return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  }
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ?
    "AM" : "PM"}`;
}

const EN_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FR_DAYS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
  "Sep", "Oct", "Nov", "Dec"];
const FR_MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.",
  "août", "sept.", "oct.", "nov.", "déc."];

/**
 * @param {string} key "YYYY-MM-DD".
 * @param {string} lang "en" | "fr".
 * @return {string} "Thu, Nov 6" / "jeu. 6 nov.".
 */
function dayText(key, lang) {
  const [, m, d] = key.split("-").map(Number);
  const i = priceList.WEEK_DAYS.indexOf(priceList.weekdayOf(key));
  return lang === "fr" ? `${FR_DAYS[i]} ${d} ${FR_MONTHS[m - 1]}` :
    `${EN_DAYS[i]}, ${EN_MONTHS[m - 1]} ${d}`;
}

// ---------------------------------------------------------------------------
// The Flow JSON (uploaded once by ops/create_package_flow.py).
// ---------------------------------------------------------------------------

const str = (example) => ({type: "string", __example__: example});
const bool = (example) => ({type: "boolean", __example__: example});
const list = () => ({type: "array", items: {type: "object", properties: {
  id: {type: "string"}, title: {type: "string"},
  description: {type: "string"}}},
__example__: [{id: "a", title: "A", description: ""}]});

/**
 * The Flow definition. Every text comes from the endpoint's data, so one
 * Flow serves both languages.
 *
 * @return {object} Flow JSON.
 */
function flowJson() {
  const footer = (screen, payload) => ({type: "Footer",
    label: "${data.l_next}",
    "on-click-action": {name: "data_exchange", payload: {screen,
      ...payload}}});
  const slot = (n) => [
    {type: "Dropdown", name: `item_${n}`, label: `\${data.l_item_${n}}`,
      "data-source": "${data.items}", required: n === 1},
  ];
  // One box per chosen item, labelled for it: "How many" for things
  // counted, "Weight (lb)" for things sold by the pound.
  const amount = (n) => ({type: "TextInput", name: `qty_${n}`,
    label: `\${data.l_qty_${n}}`, "helper-text": `\${data.h_qty_${n}}`,
    "input-type": "number", required: false,
    visible: `\${data.show_${n}}`});
  const itemsPayload = {};
  const amountsPayload = {};
  const amountData = {};
  for (let n = 1; n <= SLOTS; n++) {
    itemsPayload[`item_${n}`] = `\${form.item_${n}}`;
    amountsPayload[`qty_${n}`] = `\${form.qty_${n}}`;
    amountData[`l_qty_${n}`] = str("How many");
    amountData[`h_qty_${n}`] = str("Barrel");
    amountData[`show_${n}`] = {type: "boolean", __example__: n === 1};
  }
  itemsPayload.other = "${form.other}";
  const itemLabels = {};
  for (let n = 1; n <= SLOTS; n++) itemLabels[`l_item_${n}`] = str("Item");
  return {
    version: FLOW_VERSION,
    data_api_version: DATA_API_VERSION,
    routing_model: {
      WHERE: ["ITEMS"], ITEMS: ["AMOUNTS", "HOW"], AMOUNTS: ["HOW"],
      HOW: ["PICK", "WHEN"],
      PICK: ["WHEN"], WHEN: ["PEOPLE"], PEOPLE: ["REVIEW"], REVIEW: [],
    },
    screens: [
      {id: "WHERE", title: "Laawol", data: {
        l_title: str("Send a package"), l_country: str("Country"),
        l_mode: str("Ships by"), l_next: str("Next"),
        countries: list(), modes: list()},
      layout: {type: "SingleColumnLayout", children: [
        {type: "TextHeading", text: "${data.l_title}"},
        {type: "Dropdown", name: "country", label: "${data.l_country}",
          "data-source": "${data.countries}", required: true},
        {type: "RadioButtonsGroup", name: "mode", label: "${data.l_mode}",
          "data-source": "${data.modes}", required: true},
        footer("WHERE", {country: "${form.country}",
          mode: "${form.mode}"}),
      ]}},
      {id: "ITEMS", title: "Laawol", data: {
        l_title: str("What are you sending"), l_intro: str("Pick"),
        ...itemLabels, l_other: str("Other"),
        l_other_help: str("Anything else"), l_next: str("Next"),
        items: list()},
      layout: {type: "SingleColumnLayout", children: [
        {type: "TextHeading", text: "${data.l_title}"},
        {type: "TextBody", text: "${data.l_intro}"},
        ...slot(1), ...slot(2), ...slot(3), ...slot(4),
        {type: "TextArea", name: "other", label: "${data.l_other}",
          "helper-text": "${data.l_other_help}", required: false,
          "max-length": 120},
        footer("ITEMS", itemsPayload),
      ]}},
      {id: "AMOUNTS", title: "Laawol", data: {
        l_title: str("How many"), l_intro: str("For things sold by the lb"),
        l_next: str("Next"), ...amountData},
      layout: {type: "SingleColumnLayout", children: [
        {type: "TextHeading", text: "${data.l_title}"},
        {type: "TextBody", text: "${data.l_intro}"},
        amount(1), amount(2), amount(3), amount(4),
        footer("AMOUNTS", amountsPayload),
      ]}},
      {id: "HOW", title: "Laawol", data: {
        l_title: str("Drop-off or pickup"), l_how: str("How"),
        l_address: str("Pickup address"), l_address_help: str("Street"),
        l_next: str("Next"), hows: list()},
      layout: {type: "SingleColumnLayout", children: [
        {type: "TextHeading", text: "${data.l_title}"},
        {type: "RadioButtonsGroup", name: "how", label: "${data.l_how}",
          "data-source": "${data.hows}", required: true},
        {type: "TextArea", name: "address", label: "${data.l_address}",
          "helper-text": "${data.l_address_help}", required: false,
          "max-length": 200},
        footer("HOW", {how: "${form.how}", address: "${form.address}"}),
      ]}},
      {id: "PICK", title: "Laawol", data: {
        l_title: str("Choose a business"), l_intro: str("Best match"),
        l_business: str("Business"), l_next: str("Next"),
        businesses: list()},
      layout: {type: "SingleColumnLayout", children: [
        {type: "TextHeading", text: "${data.l_title}"},
        {type: "TextCaption", text: "${data.l_intro}"},
        {type: "RadioButtonsGroup", name: "business",
          label: "${data.l_business}", "data-source": "${data.businesses}",
          required: true},
        footer("PICK", {business: "${form.business}"}),
      ]}},
      {id: "WHEN", title: "Laawol", data: {
        l_title: str("When"), l_when: str("Day and time"),
        l_next: str("Next"), whens: list()},
      layout: {type: "SingleColumnLayout", children: [
        {type: "TextHeading", text: "${data.l_title}"},
        {type: "Dropdown", name: "when", label: "${data.l_when}",
          "data-source": "${data.whens}", required: true},
        footer("WHEN", {when: "${form.when}"}),
      ]}},
      {id: "PEOPLE", title: "Laawol", data: {
        l_title: str("Who"), l_sender: str("Your name"),
        l_receiver: str("Receiver's name"), l_phone: str("Phone"),
        l_phone_help: str("+224"), l_next: str("Next"),
        sender_name: str("Fatou")},
      layout: {type: "SingleColumnLayout", children: [
        {type: "TextHeading", text: "${data.l_title}"},
        {type: "TextInput", name: "sender_name", label: "${data.l_sender}",
          "input-type": "text", required: true,
          "init-value": "${data.sender_name}"},
        {type: "TextInput", name: "receiver_name",
          label: "${data.l_receiver}", "input-type": "text", required: true},
        {type: "TextInput", name: "receiver_phone", label: "${data.l_phone}",
          "input-type": "phone", required: true,
          "helper-text": "${data.l_phone_help}"},
        footer("PEOPLE", {sender_name: "${form.sender_name}",
          receiver_name: "${form.receiver_name}",
          receiver_phone: "${form.receiver_phone}"}),
      ]}},
      {id: "REVIEW", title: "Laawol", terminal: true, data: {
        l_title: str("Check and send"), summary: str("2 × Phone"),
        l_pay: str("You pay at drop-off"), l_next: str("Send request"),
        show_pay: bool(true)},
      layout: {type: "SingleColumnLayout", children: [
        {type: "TextHeading", text: "${data.l_title}"},
        {type: "TextBody", text: "${data.summary}"},
        {type: "TextCaption", text: "${data.l_pay}",
          visible: "${data.show_pay}"},
        footer("REVIEW", {}),
      ]}},
    ],
  };
}

// ---------------------------------------------------------------------------
// Encryption (Meta's Flows endpoint scheme).
// ---------------------------------------------------------------------------

/**
 * Decrypts a Flows endpoint request.
 *
 * @param {object} body {encrypted_flow_data, encrypted_aes_key,
 *   initial_vector}.
 * @param {string} privatePem The RSA private key (PEM).
 * @return {{payload: object, aesKey: Buffer, iv: Buffer}}
 */
function decryptFlowRequest(body, privatePem) {
  const aesKey = crypto.privateDecrypt({
    key: crypto.createPrivateKey(privatePem),
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  }, Buffer.from(String(body.encrypted_aes_key || ""), "base64"));
  const data = Buffer.from(String(body.encrypted_flow_data || ""), "base64");
  const iv = Buffer.from(String(body.initial_vector || ""), "base64");
  const tag = data.subarray(data.length - 16);
  const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data.subarray(0,
      data.length - 16)), decipher.final()]).toString("utf8");
  return {payload: JSON.parse(plain), aesKey, iv};
}

/**
 * Encrypts a Flows endpoint response: same key, the IV's bits flipped.
 *
 * @param {object} response The response object.
 * @param {Buffer} aesKey The request's AES key.
 * @param {Buffer} iv The request's IV.
 * @return {string} Base64 body (sent as text/plain).
 */
function encryptFlowResponse(response, aesKey, iv) {
  const flipped = Buffer.from(iv.map((byte) => ~byte & 0xff));
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, flipped);
  return Buffer.concat([cipher.update(JSON.stringify(response), "utf8"),
    cipher.final(), cipher.getAuthTag()]).toString("base64");
}

// ---------------------------------------------------------------------------
// Opening the form.
// ---------------------------------------------------------------------------

/**
 * Whether a customer's message asks to send a package, and which business
 * it names ("SEND nensona" from a business's QR).
 *
 * @param {string} folded The message after whatsapp_inbox.fold().
 * @return {?{slug: string}} null when it is not a request to send.
 */
function openRequest(folded) {
  const text = String(folded || "").trim();
  if (!text || text.length > 60) return null;
  if (OPEN_WORDS.includes(text)) return {slug: ""};
  const match = /^(?:send|envoyer)\s+([a-z0-9][a-z0-9 -]{1,40})$/.exec(text);
  if (!match) return null;
  const slug = match[1].trim().replace(/\s+/g, "-");
  return /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/.test(slug) ?
    {slug} : null;
}

/**
 * The interactive message that opens the Flow.
 *
 * @param {object} args {phone, flowId, flowToken, lang, businessName}.
 * @return {object} A /messages body.
 */
function flowMessageBody({phone, flowId, flowToken, lang, businessName}) {
  const fr = lang === "fr";
  const body = businessName ?
    (fr ? `Envoyez un colis avec ${businessName} : choisissez vos ` +
      "articles, voyez le prix et dites quand vous l'apportez." :
      `Send a package with ${businessName}: pick your items, see the ` +
      "price and say when you'll bring it.") :
    (fr ? "Envoyez un colis : choisissez vos articles, comparez les prix " +
      "des entreprises et dites quand vous l'apportez." :
      "Send a package: pick your items, compare the businesses' prices " +
      "and say when you'll bring it.");
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: String(phone).replace(/\D/g, ""),
    type: "interactive",
    interactive: {
      type: "flow",
      body: {text: body},
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: flowToken,
          flow_id: flowId,
          flow_cta: fr ? "Envoyer un colis" : "Send a package",
          flow_action: "data_exchange",
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// The steps.
// ---------------------------------------------------------------------------

/**
 * The item catalog for a country and mode: every item any business there
 * lists (same name and category = one line), the categories sold by the
 * pound, barrels by sea, and "something else" (asked separately).
 *
 * @param {object[]} options The country's options.
 * @param {string} mode "sea" | "air".
 * @param {string} lang "en" | "fr".
 * @return {object[]} [{id, kind, label, categoryId, title, description}].
 */
function catalogFor(options, mode, lang) {
  const w = words(lang);
  const items = new Map();
  const perLb = new Map();
  let barrel = false;
  for (const option of options) {
    const route = option.routes?.[mode];
    for (const item of route?.items || []) {
      const key = `${item.categoryId}|${item.label.toLowerCase()}`;
      const prev = items.get(key);
      const from = prev ? Math.min(prev.from, item.priceCents) :
        item.priceCents;
      items.set(key, {label: item.label, categoryId: item.categoryId, from,
        includedLb: item.includedLb || 0});
    }
    for (const [categoryId, cents] of Object.entries(route?.perLbCents ||
        {})) {
      const prev = perLb.get(categoryId);
      perLb.set(categoryId, prev === undefined ? cents : Math.min(prev,
          cents));
    }
    if (mode === "sea" && Number.isInteger(option.barrelPriceCents)) {
      barrel = true;
    }
  }
  const rows = [];
  for (const [key, item] of [...items.entries()].sort((a, b) =>
    a[1].label.localeCompare(b[1].label))) {
    rows.push({id: `i:${key}`, kind: "item", label: item.label,
      categoryId: item.categoryId, title: clip(item.label, 30),
      description: clip(`${w.from} ${money(item.from, lang)}` +
        (item.includedLb ? ` (${w.upTo} ${item.includedLb} lb ${w.each})` :
          ""), 300)});
  }
  for (const category of priceList.CATEGORIES) {
    if (!perLb.has(category.id)) continue;
    rows.push({id: `lb:${category.id}`, kind: "per_lb",
      label: category[lang === "fr" ? "fr" : "en"], categoryId: category.id,
      title: clip(`${category[lang === "fr" ? "fr" : "en"]} (lb)`, 30),
      description: `${w.from} ${money(perLb.get(category.id), lang)}` +
        w.perLb});
  }
  if (barrel) {
    rows.push({id: "barrel", kind: "barrel", label: lang === "fr" ?
      "Baril" : "Barrel", categoryId: "", title: lang === "fr" ? "Baril" :
      "Barrel", description: ""});
  }
  return rows.slice(0, MAX_OPTIONS);
}

/**
 * The customer's lines as one business prices them: its own item with the
 * same name, else "ask me".
 *
 * @param {object[]} lines [{kind, label, categoryId, amount}] + other text.
 * @param {?object} route The business's route.
 * @param {string} other "Something else" text.
 * @return {object[]} Pieces for priceBasket / submitPackageRequest.
 */
function piecesFor(lines, route, other) {
  const pieces = [];
  for (const line of lines) {
    if (line.kind === "item") {
      const match = (route?.items || []).find((item) =>
        item.categoryId === line.categoryId &&
        item.label.toLowerCase() === line.label.toLowerCase());
      pieces.push({priceItemId: match ? match.id : "i_not_listed",
        quantity: line.amount, label: line.label, kind: "other"});
    } else if (line.kind === "per_lb") {
      pieces.push({categoryId: line.categoryId, weightLb: line.amount,
        kind: "other"});
    } else if (line.kind === "barrel") {
      for (let i = 0; i < line.amount; i++) pieces.push({kind: "barrel"});
    }
  }
  const text = String(other || "").trim();
  if (text) pieces.push({kind: "box", description: text.slice(0, 120)});
  return pieces;
}

/**
 * The day-and-window choices: the next open days, 2-hour windows.
 *
 * @param {object} args {handoff, locations, todayKey, nowMinutes, lang}.
 * @return {object[]} [{id: "date|from|to|locationId", title, description}].
 */
function whenChoices({handoff, locations, todayKey, nowMinutes, lang}) {
  const rows = [];
  const spots = handoff === "collect" ? [{id: "", label: "",
    hours: null}] : (locations || []);
  const minutes = (hhmm) => {
    const [h, m] = String(hhmm).split(":").map(Number);
    return h * 60 + m;
  };
  const hhmm = (total) => `${String(Math.floor(total / 60)).padStart(2,
      "0")}:${String(total % 60).padStart(2, "0")}`;
  for (let i = 0; i < DAYS_AHEAD && rows.length < MAX_OPTIONS; i++) {
    const key = priceList.addDays(todayKey, i);
    for (const spot of spots) {
      const day = handoff === "collect" ? {open: true, ...PICKUP_DAY} :
        spot.hours?.[priceList.weekdayOf(key)];
      if (!day || day.open !== true) continue;
      const open = minutes(day.from);
      const close = minutes(day.to);
      for (let start = open; start + 30 <= close; start += 120) {
        const end = Math.min(start + 120, close);
        if (i === 0 && start <= nowMinutes) continue;
        const where = spots.length > 1 ? `${clip(spot.label, 40)} · ` : "";
        rows.push({id: `${key}|${hhmm(start)}|${hhmm(end)}|${spot.id}`,
          title: clip(`${dayText(key, lang)}, ${clock(hhmm(start), lang)}` +
            `–${clock(hhmm(end), lang)}`, 30),
          description: where ? where.slice(0, -3) : ""});
        if (rows.length >= MAX_OPTIONS) break;
      }
    }
  }
  return rows;
}

/**
 * What one comparison row says.
 *
 * @param {object} args {option, basket, mode, quote, lang}.
 * @return {string} The description line.
 */
function rowDescription({option, basket, mode, quote, lang}) {
  const w = words(lang);
  const parts = [];
  if (basket.allPriced) {
    parts.push(`${basket.weighsAtCounter ? `${w.about} ` : ""}` +
      money(basket.totalCents, lang));
  } else {
    parts.push(`${money(basket.pricedCents, lang)} + ${basket.unpricedCount}` +
      ` ${w.toQuote}`);
  }
  if (quote && quote.priced) {
    parts.push(`${w.pickupFee} ${money(quote.feeCents, lang)}`);
  }
  const departure = option.departures?.[mode];
  if (departure?.source === "unconfirmed") {
    parts.push(w.notConfirmed);
  } else if (departure?.dateKey) {
    parts.push(`${mode === "air" ? w.nextFlight : w.nextBox}: ` +
      `${departure.approximate ? `${w.around} ` : ""}` +
      dayText(departure.dateKey, lang));
  }
  if (Number.isFinite(option.rating) && option.reviewCount > 0) {
    parts.push(`★ ${option.rating} (${option.reviewCount} ${w.reviews})`);
  }
  if (option.coversLoss) parts.push(w.paysBack);
  return clip(parts.join(" · "), 300);
}

/**
 * Builds the label data a screen needs in the session's language.
 *
 * @param {string} screen The screen id.
 * @param {string} lang "en" | "fr".
 * @return {object} l_* fields.
 */
function labels(screen, lang) {
  const w = words(lang);
  switch (screen) {
    case "WHERE":
      return {l_title: w.whereTitle, l_country: w.country, l_mode: w.mode,
        l_next: w.next};
    case "ITEMS": {
      const out = {l_title: w.itemsTitle, l_intro: w.itemsIntro,
        l_other: w.other, l_other_help: w.otherHelp, l_next: w.next};
      for (let n = 1; n <= SLOTS; n++) out[`l_item_${n}`] = `${w.item} ${n}`;
      return out;
    }
    case "AMOUNTS":
      return {l_title: w.amountsTitle, l_intro: w.amountsIntro,
        l_next: w.next};
    case "HOW":
      return {l_title: w.howTitle, l_how: w.how, l_address: w.address,
        l_address_help: w.addressHelp, l_next: w.next};
    case "PICK":
      return {l_title: w.pickTitle, l_intro: w.pickIntro,
        l_business: w.business, l_next: w.next};
    case "WHEN":
      return {l_title: w.whenTitle, l_when: w.when, l_next: w.next};
    case "PEOPLE":
      return {l_title: w.peopleTitle, l_sender: w.senderName,
        l_receiver: w.receiverName, l_phone: w.receiverPhone,
        l_phone_help: w.phoneHelp, l_next: w.next};
    case "REVIEW":
      return {l_title: w.reviewTitle, l_pay: w.pay, l_next: w.send,
        show_pay: true};
    default:
      return {};
  }
}

/**
 * The Flow endpoint's brain.
 *
 * @param {object} deps {
 *   loadSession(token) -> session|null,
 *   saveSession(token, patch),
 *   loadOptions({slug}) -> {business|null, options: requestOption[]},
 *   pickupQuotes(address, businessIds) -> quote[],
 *   createRequest(data, session) -> {code, token, status, totalCents},
 *   nowMs() -> number, todayKey(zone) -> "YYYY-MM-DD",
 *   nowMinutes(zone) -> number}.
 * @return {{handle: function(object): Promise<object>}}
 */
function createPackageFlow(deps) {
  const screenOut = async (token, session, screen, data) => {
    const full = {...labels(screen, session.lang), ...data};
    await deps.saveSession(token, {[`screens.${screen}`]: full,
      lastScreen: screen});
    return {screen, data: full};
  };
  const fail = (session, screen, message) => ({screen, data: {
    ...(session.screens?.[screen] || labels(screen, session.lang)),
    error_message: message}});

  const countryOptions = (session, all) => all.filter((o) =>
    o.country.id === session.country &&
    (session.mode !== "air" || o.shipsByAir));

  async function handle(payload) {
    const action = String(payload?.action || "");
    if (action === "ping") return {data: {status: "active"}};
    if (payload?.data?.error) return {data: {acknowledged: true}};
    const token = String(payload?.flow_token || "");
    const session = token ? await deps.loadSession(token) : null;
    if (!session || Number(session.expiresAtMs || 0) < deps.nowMs()) {
      const lang = session?.lang === "fr" ? "fr" : "en";
      return {screen: "WHERE", data: {...labels("WHERE", lang),
        countries: [{id: "none", title: "—", description: ""}],
        modes: [{id: "sea", title: words(lang).sea, description: ""}],
        error_message: words(lang).errGone}};
    }
    const lang = session.lang === "fr" ? "fr" : "en";
    const w = words(lang);
    if (action === "BACK") {
      const screen = SCREENS.includes(payload.screen) ? payload.screen :
        session.lastScreen || "WHERE";
      return {screen, data: session.screens?.[screen] ||
        labels(screen, lang)};
    }
    const {business, options} = await deps.loadOptions({slug:
      session.slug || ""});
    if (action === "INIT") {
      const countries = [...new Map(options.map((o) => [o.country.id,
        o.country.name])).entries()]
          .sort((a, b) => a[1].localeCompare(b[1]))
          .map(([id, name]) => ({id, title: clip(name, 30),
            description: ""}));
      if (countries.length === 0) {
        countries.push({id: "none", title: "—", description: ""});
      }
      return screenOut(token, session, "WHERE", {countries,
        modes: [{id: "sea", title: w.sea, description: ""},
          {id: "air", title: w.air, description: ""}]});
    }
    if (action !== "data_exchange") {
      return fail(session, session.lastScreen || "WHERE", w.errSend);
    }
    const data = payload.data || {};
    const screen = String(data.screen || payload.screen || "");

    // Bring it in / pick it up: only the ways a business there offers.
    const howScreen = (current, from = "ITEMS") => {
      const here = countryOptions(current, options);
      const hows = [];
      if (here.some((o) => o.bringIn?.available)) {
        hows.push({id: "bring_in", title: w.bring, description: ""});
      }
      if (here.some((o) => o.collect?.available)) {
        hows.push({id: "collect", title: w.pickup, description: ""});
      }
      if (!hows.length) return fail(current, from, w.noBusinesses);
      return screenOut(token, current, "HOW", {hows});
    };

    if (screen === "WHERE") {
      const country = String(data.country || "");
      const mode = data.mode === "air" ? "air" : "sea";
      const here = options.filter((o) => o.country.id === country);
      if (!here.length) return fail(session, "WHERE", w.noBusinesses);
      if (mode === "air" && !here.some((o) => o.shipsByAir)) {
        return fail(session, "WHERE", w.errAir);
      }
      const catalog = catalogFor(mode === "air" ?
        here.filter((o) => o.shipsByAir) : here, mode, lang);
      await deps.saveSession(token, {country, mode, catalog,
        countryName: here[0].country.name});
      const items = catalog.length ? catalog.map((row) => ({id: row.id,
        title: row.title, description: row.description})) :
        [{id: "none", title: w.something, description: w.otherHelp}];
      return screenOut(token, {...session, country, mode}, "ITEMS", {items});
    }

    if (screen === "ITEMS") {
      const catalog = Array.isArray(session.catalog) ? session.catalog : [];
      const picked = [];
      for (let n = 1; n <= SLOTS; n++) {
        const id = String(data[`item_${n}`] || "");
        if (!id || id === "none") continue;
        const row = catalog.find((c) => c.id === id);
        // The same kind twice is one line.
        if (row && !picked.includes(id)) picked.push(id);
      }
      const other = String(data.other || "").trim().slice(0, 120);
      if (!picked.length && !other) return fail(session, "ITEMS", w.errItems);
      await deps.saveSession(token, {picked, other, lines: []});
      if (!picked.length) return howScreen({...session, other});
      const amounts = {};
      for (let n = 1; n <= SLOTS; n++) {
        const row = catalog.find((c) => c.id === picked[n - 1]);
        amounts[`show_${n}`] = Boolean(row);
        amounts[`l_qty_${n}`] = row?.kind === "per_lb" ? w.pounds : w.count;
        amounts[`h_qty_${n}`] = row ? clip(row.title, 80) : "";
      }
      return screenOut(token, session, "AMOUNTS", amounts);
    }

    if (screen === "AMOUNTS") {
      const catalog = Array.isArray(session.catalog) ? session.catalog : [];
      const picked = Array.isArray(session.picked) ? session.picked : [];
      const lines = [];
      for (let n = 1; n <= picked.length && n <= SLOTS; n++) {
        const row = catalog.find((c) => c.id === picked[n - 1]);
        if (!row) continue;
        const amount = Number(String(data[`qty_${n}`] ?? "")
            .replace(",", "."));
        const ok = row.kind === "per_lb" ?
          amount >= 0.1 && amount <= priceList.LIMIT.WEIGHT_LB :
          Number.isInteger(amount) && amount >= 1 &&
            amount <= priceList.LIMIT.QUANTITY;
        if (!ok) return fail(session, "AMOUNTS", w.errQty);
        lines.push({kind: row.kind, label: row.label,
          categoryId: row.categoryId, amount: row.kind === "per_lb" ?
            Math.round(amount * 10) / 10 : amount});
      }
      if (!lines.length && !session.other) {
        return fail(session, "AMOUNTS", w.errQty);
      }
      await deps.saveSession(token, {lines});
      return howScreen(session, "AMOUNTS");
    }

    if (screen === "HOW") {
      const handoff = data.how === "collect" ? "collect" : "bring_in";
      const address = String(data.address || "").trim().slice(0, 200);
      if (handoff === "collect" && !address) {
        return fail(session, "HOW", w.errAddress);
      }
      const here = countryOptions(session, options).filter((o) =>
        handoff === "collect" ? o.collect?.available :
          o.bringIn?.available);
      if (!here.length) return fail(session, "HOW", w.noBusinesses);
      const quotes = handoff === "collect" ? await deps.pickupQuotes(address,
          here.map((o) => o.businessId)) : [];
      const quoteOf = (id) => quotes.find((q) => q.businessId === id) ||
        null;
      const rows = here.map((option) => {
        const quote = quoteOf(option.businessId);
        const route = priceList.routeOf({routes: {[option.country.id]:
          option.routes}}, option.country.id, session.mode);
        const basket = priceList.priceBasket(route,
            piecesFor(session.lines || [], route, session.other),
            {barrelPriceCents: option.barrelPriceCents,
              pickupFeeCents: quote?.priced ? quote.feeCents : 0});
        return {option, quote, basket, businessId: option.businessId,
          businessName: option.businessName, allPriced: basket.allPriced &&
            (handoff !== "collect" || Boolean(quote?.priced)),
          unpricedCount: basket.unpricedCount, totalCents: basket.totalCents,
          pricedCents: basket.pricedCents, rating: option.rating,
          reviewCount: option.reviewCount,
          departureKey: option.departures?.[session.mode]?.dateKey || "",
          reachable: handoff !== "collect" || quote?.available !== false};
      }).filter((row) => row.reachable);
      if (!rows.length) return fail(session, "HOW", w.noPickup);
      await deps.saveSession(token, {handoff, address});
      if (business || rows.length === 1) {
        const only = rows[0];
        await deps.saveSession(token, {businessId: only.businessId});
        return screenOut(token, session, "WHEN", {whens: whenChoices({
          handoff, locations: only.option.bringIn?.locations,
          todayKey: deps.todayKey(only.option.timeZone),
          nowMinutes: deps.nowMinutes(only.option.timeZone), lang})});
      }
      const businesses = priceList.rankOptions(rows, "best")
          .slice(0, MAX_BUSINESSES).map((row) => ({id: row.businessId,
            title: clip(row.businessName, 30),
            description: rowDescription({option: row.option,
              basket: row.basket, mode: session.mode, quote: row.quote,
              lang})}));
      return screenOut(token, session, "PICK", {businesses});
    }

    if (screen === "PICK") {
      const option = countryOptions(session, options)
          .find((o) => o.businessId === String(data.business || ""));
      if (!option) return fail(session, "PICK", w.errPick);
      await deps.saveSession(token, {businessId: option.businessId});
      return screenOut(token, session, "WHEN", {whens: whenChoices({
        handoff: session.handoff, locations: option.bringIn?.locations,
        todayKey: deps.todayKey(option.timeZone),
        nowMinutes: deps.nowMinutes(option.timeZone), lang})});
    }

    if (screen === "WHEN") {
      const [date, from, to, locationId] = String(data.when || "")
          .split("|");
      if (!priceList.dateKeyValid(date) || !from || !to) {
        return fail(session, "WHEN", w.errWhen);
      }
      await deps.saveSession(token, {when: {date, from, to,
        locationId: locationId || ""}});
      return screenOut(token, session, "PEOPLE", {sender_name:
        clip(session.profileName || "", 80)});
    }

    if (screen === "PEOPLE") {
      const sender = String(data.sender_name || "").trim().slice(0, 80);
      const receiver = String(data.receiver_name || "").trim().slice(0, 80);
      const digits = String(data.receiver_phone || "").replace(/[^\d+]/g,
          "");
      const phone = digits.startsWith("+") ? digits :
        (digits.startsWith("00") ? `+${digits.slice(2)}` : `+${digits}`);
      if (!sender || !receiver) return fail(session, "PEOPLE", w.errNames);
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
        return fail(session, "PEOPLE", w.errPhone);
      }
      const option = countryOptions(session, options)
          .find((o) => o.businessId === session.businessId);
      if (!option) return fail(session, "PEOPLE", w.errPick);
      const route = priceList.routeOf({routes: {[option.country.id]:
        option.routes}}, option.country.id, session.mode);
      const basket = priceList.priceBasket(route,
          piecesFor(session.lines || [], route, session.other),
          {barrelPriceCents: option.barrelPriceCents});
      const lineText = (session.lines || []).map((l) => l.kind === "per_lb" ?
        `${l.label} · ${l.amount} lb` : `${l.amount} × ${l.label}`);
      if (session.other) lineText.push(session.other);
      const when = session.when || {};
      const summary = [
        `${option.businessName} · ${session.countryName || ""} · ` +
          `${session.mode === "air" ? w.air : w.sea}`,
        `${w.items}: ${lineText.join(", ")}`,
        `${w.total}: ${basket.allPriced ? `${basket.weighsAtCounter ?
          `${w.about} ` : ""}${money(basket.totalCents, lang)}` :
          `${money(basket.pricedCents, lang)} + ${basket.unpricedCount} ` +
          w.toQuote}`,
        `${session.handoff === "collect" ? w.pickup : w.bring}: ` +
          `${priceList.dateKeyValid(when.date) ? dayText(when.date, lang) :
            ""}, ${clock(when.from, lang)}–${clock(when.to, lang)}` +
          (session.handoff === "collect" ? ` · ${session.address}` : ""),
        `${w.from}: ${sender} · ${w.to}: ${receiver} (${phone})`,
      ].join("\n");
      await deps.saveSession(token, {senderName: sender,
        receiverName: receiver, receiverPhone: phone});
      return screenOut(token, session, "REVIEW", {summary: clip(summary,
          4000)});
    }

    if (screen === "REVIEW") {
      const option = countryOptions(session, options)
          .find((o) => o.businessId === session.businessId);
      if (!option) return fail(session, "REVIEW", w.errPick);
      const route = priceList.routeOf({routes: {[option.country.id]:
        option.routes}}, option.country.id, session.mode);
      const when = session.when || {};
      const request = {
        businessId: option.businessId,
        destinationCountryId: option.country.id,
        handoff: session.handoff,
        shipMode: session.mode,
        channel: "whatsapp",
        foundVia: session.slug ? "business" : "laawol",
        ...(session.handoff === "collect" ? {pickup: {address:
          session.address, date: when.date,
        window: `${when.from}-${when.to}`, note: ""}} : {
          locationId: when.locationId || undefined,
          plannedDate: when.date,
          plannedWindow: {from: when.from, to: when.to}}),
        sender: {name: session.senderName, phoneE164: session.phone},
        receiver: {name: session.receiverName,
          phoneE164: session.receiverPhone},
        pieces: piecesFor(session.lines || [], route, session.other),
        language: lang,
        idempotencyKey: `wa-${token.slice(0, 40)}`,
      };
      let created = null;
      try {
        created = await deps.createRequest(request, session);
      } catch (error) {
        return fail(session, "REVIEW", w.errSend);
      }
      await deps.saveSession(token, {requestCode: created.code,
        requestToken: created.token, doneAtMs: deps.nowMs()});
      return {screen: "SUCCESS", data: {extension_message_response: {
        params: {flow_token: token, request_code: created.code,
          request_token: created.token}}}};
    }
    return fail(session, session.lastScreen || "WHERE", w.errSend);
  }
  return {handle};
}

module.exports = {
  FLOW_VERSION,
  SCREENS,
  SESSION_MS,
  OPEN_WORDS,
  flowJson,
  decryptFlowRequest,
  encryptFlowResponse,
  openRequest,
  flowMessageBody,
  catalogFor,
  piecesFor,
  whenChoices,
  rowDescription,
  labels,
  words,
  money,
  dayText,
  createPackageFlow,
};
