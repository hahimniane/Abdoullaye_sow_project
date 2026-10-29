"use strict";

/**
 * Two-way WhatsApp (docs/WHATSAPP_CONVERSATIONS.md): customers write to the
 * shared Laawol number and the business whose package it is answers, in a
 * Support thread.
 *
 * This module is the pure half: reading Meta's webhook, checking its
 * signature, deciding where a message goes and what the customer is told
 * automatically, and building the /messages bodies we send. No Firestore,
 * no network (crypto only).
 */

const crypto = require("crypto");
const {scanCodeFrom} = require("./container_loading");

/** The inbox id of Laawol's own conversations (no business, or not yet). */
const LAAWOL_INBOX = "laawol";

/** Free-form messages are allowed this long after the customer's last one. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** A business that messaged the customer within this long gets the reply. */
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

/** Files customers and staff send are kept this long, then deleted. */
const MEDIA_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/** The "you have a message, reply to read it" template (bilingual, en). */
const WAITING_TEMPLATE = "message_waiting_2lang";

/** Inbox modes (appConfig/whatsappInbox.mode). */
const INBOX_MODE = Object.freeze({
  // Every conversation lands in Laawol's inbox (launch week).
  LAAWOL_ONLY: "laawol_only",
  // Conversations go to the business; Laawol sees all of them.
  BUSINESSES: "businesses",
});

/** Conversation states shown to staff. */
const CONVERSATION_STATE = Object.freeze({
  NEEDS_REPLY: "needs_reply",
  WAITING_CUSTOMER: "waiting_customer",
  DONE: "done",
  // Asked the customer which business; waiting for "1", "2"...
  CHOOSING: "choosing",
});

// Words that, as the whole message, mean "stop messaging me" / "start again".
// Compared without accents, case or punctuation.
const STOP_WORDS = new Set([
  "stop", "stopp", "stop all", "stopall", "unsubscribe", "cancel",
  "arret", "arrete", "arreter", "arretez", "stopper", "desabonner",
  "desabonnement", "desinscrire", "ne plus recevoir",
]);
const START_WORDS = new Set([
  "start", "unstop", "subscribe", "resume",
  "demarrer", "reprendre", "recommencer", "abonner", "reabonner",
]);

// Country codes whose customers are written to in French by default.
const FRENCH_CALLING_CODES = [
  "224", "221", "223", "225", "226", "227", "228", "229", "222", "235",
  "236", "237", "241", "242", "243", "250", "257", "261", "269", "33",
  "32", "41", "509",
];

const FRENCH_MARKERS = new RegExp("\\b(" + [
  "bonjour", "bonsoir", "salut", "merci", "oui", "non", "svp", "stp",
  "s'il", "colis", "baril", "fut", "futs", "conteneur", "quand", "est-ce",
  "mon", "ma", "mes", "je", "j'ai", "vous", "nous", "c'est", "pourquoi",
  "combien", "arrive", "arrivé", "reçu", "recu", "livraison",
].join("|") + ")\\b", "i");
const ENGLISH_MARKERS = new RegExp("\\b(" + [
  "hello", "hi", "hey", "thanks", "thank", "yes", "please", "my", "when",
  "where", "is", "the", "package", "barrel", "container", "arrived",
  "received", "delivery", "how",
].join("|") + ")\\b", "i");

/**
 * "+" and the digits of a number as Meta writes it ("224621000000").
 *
 * @param {unknown} value A WhatsApp id or phone.
 * @return {string} "+224621000000", or "" when there are no digits.
 */
function phoneFromWa(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

/**
 * The conversation document id for one inbox and one customer number.
 *
 * @param {string} inboxId A business id, or LAAWOL_INBOX.
 * @param {string} phone The customer's number.
 * @return {string} `wa_{inbox}_{digits}`.
 */
function conversationId(inboxId, phone) {
  const inbox = String(inboxId || LAAWOL_INBOX).replace(/[^A-Za-z0-9_-]/g, "_");
  const digits = String(phone ?? "").replace(/\D/g, "");
  return `wa_${inbox}_${digits}`.slice(0, 220);
}

/**
 * The verify token Meta sends back when the webhook is registered: derived
 * from the app secret, so there is no second secret to keep.
 *
 * @param {string} appSecret The Meta app secret.
 * @return {string} 32 hex characters, or "" without a secret.
 */
function verifyTokenFor(appSecret) {
  const secret = String(appSecret ?? "").trim();
  if (!secret || secret === "unset") return "";
  return crypto.createHash("sha256")
      .update(`laawol-whatsapp-verify:${secret}`).digest("hex").slice(0, 32);
}

/**
 * Whether a POST really comes from Meta: X-Hub-Signature-256 is the
 * HMAC-SHA256 of the raw body with the app secret.
 *
 * @param {Buffer|string} rawBody The body exactly as received.
 * @param {unknown} header The X-Hub-Signature-256 header.
 * @param {string} appSecret The Meta app secret.
 * @return {boolean} True when it matches.
 */
function verifySignature(rawBody, header, appSecret) {
  const secret = String(appSecret ?? "").trim();
  const given = String(header ?? "").trim();
  if (!secret || secret === "unset" || !given.startsWith("sha256=")) {
    return false;
  }
  const body = Buffer.isBuffer(rawBody) ?
    rawBody : Buffer.from(String(rawBody ?? ""), "utf8");
  const expected = "sha256=" + crypto.createHmac("sha256", secret)
      .update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const MEDIA_TYPES = ["image", "audio", "video", "document", "sticker"];

/**
 * The messages and delivery statuses in one webhook call. Anything that is
 * not for our number's messages field is ignored.
 *
 * @param {object} body The parsed JSON body.
 * @return {{messages: object[], statuses: object[]}} Flattened events.
 */
function parseWebhook(body) {
  const messages = [];
  const statuses = [];
  if (!body || body.object !== "whatsapp_business_account") {
    return {messages, statuses};
  }
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field !== "messages") continue;
      const value = change.value || {};
      const phoneNumberId = String(value.metadata?.phone_number_id || "");
      const names = new Map((Array.isArray(value.contacts) ?
        value.contacts : []).map((contact) =>
        [String(contact?.wa_id || ""), String(contact?.profile?.name || "")]));
      for (const msg of Array.isArray(value.messages) ? value.messages : []) {
        const from = phoneFromWa(msg?.from);
        const wamid = String(msg?.id || "");
        if (!from || !wamid) continue;
        const type = String(msg.type || "");
        const event = {
          wamid,
          phoneNumberId,
          from,
          profileName: names.get(String(msg.from || "")) || "",
          timestampMs: Number(msg.timestamp) > 0 ?
            Number(msg.timestamp) * 1000 : 0,
          type,
          text: "",
          media: null,
          replyToWamid: String(msg.context?.id || ""),
          // A template quick reply's payload (package_proof.CONFIRM_PAYLOAD
          // for the sender's confirmation); the button's text is `text`.
          buttonPayload: "",
        };
        if (type === "text") {
          event.text = String(msg.text?.body || "");
        } else if (type === "button") {
          event.text = String(msg.button?.text || msg.button?.payload || "");
          event.buttonPayload = String(msg.button?.payload || "");
        } else if (type === "interactive") {
          const reply = msg.interactive?.button_reply ||
            msg.interactive?.list_reply || {};
          event.text = String(reply.title || reply.id || "");
          event.buttonPayload = String(reply.id || "");
        } else if (MEDIA_TYPES.includes(type)) {
          const media = msg[type] || {};
          event.media = {
            id: String(media.id || ""),
            mimeType: String(media.mime_type || ""),
            fileName: String(media.filename || ""),
            voice: type === "audio" && media.voice === true,
          };
          event.text = String(media.caption || "");
        } else if (type === "location") {
          const loc = msg.location || {};
          event.text = [loc.name, loc.address,
            loc.latitude !== undefined ?
              `https://maps.google.com/?q=${loc.latitude},${loc.longitude}` :
              ""].filter(Boolean).join(" - ");
        } else if (type === "contacts") {
          event.text = (Array.isArray(msg.contacts) ? msg.contacts : [])
              .map((c) => [c?.name?.formatted_name,
                ...(Array.isArray(c?.phones) ? c.phones : [])
                    .map((p) => p?.phone)].filter(Boolean).join(" "))
              .join("\n");
        } else if (type === "reaction") {
          event.text = String(msg.reaction?.emoji || "");
        }
        messages.push(event);
      }
      for (const st of Array.isArray(value.statuses) ? value.statuses : []) {
        const wamid = String(st?.id || "");
        const status = String(st?.status || "");
        if (!wamid || !status) continue;
        const error = Array.isArray(st.errors) ? st.errors[0] || {} : {};
        statuses.push({
          wamid,
          status,
          recipient: phoneFromWa(st.recipient_id),
          timestampMs: Number(st.timestamp) > 0 ?
            Number(st.timestamp) * 1000 : 0,
          errorCode: Number(error.code) || 0,
          errorTitle: String(error.title || error.message ||
            error.error_data?.details || "").slice(0, 300),
        });
      }
    }
  }
  return {messages, statuses};
}

/**
 * Text folded for comparing: lower case, no accents, no punctuation.
 *
 * @param {unknown} text Any text.
 * @return {string} Folded text.
 */
function fold(text) {
  return String(text ?? "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ").trim();
}

/**
 * Whether a message, as a whole, asks to stop or restart updates.
 *
 * @param {unknown} text The message text.
 * @return {"stop"|"start"|""} The request, if any.
 */
function stopOrStart(text) {
  const folded = fold(text);
  if (!folded || folded.length > 30) return "";
  if (STOP_WORDS.has(folded)) return "stop";
  if (START_WORDS.has(folded)) return "start";
  return "";
}

/**
 * The language to answer in: the message's own when it is clear, else the
 * conversation's, else French for French-speaking countries.
 *
 * @param {string} text The message.
 * @param {string} phone The customer's number.
 * @param {string} previous The conversation's language so far.
 * @return {"fr"|"en"} The language.
 */
function detectLanguage(text, phone, previous = "") {
  const value = String(text ?? "");
  const fr = FRENCH_MARKERS.test(value);
  const en = ENGLISH_MARKERS.test(value);
  if (fr && !en) return "fr";
  if (en && !fr) return "en";
  if (previous === "fr" || previous === "en") return previous;
  const digits = String(phone ?? "").replace(/\D/g, "");
  return FRENCH_CALLING_CODES.some((code) => digits.startsWith(code)) ?
    "fr" : "en";
}

/**
 * Where a customer's new message goes.
 *
 * @param {object} args {candidates: [{businessId, businessName,
 *   lastSentAtMs}], nowMs, mode}. Candidates are the businesses that have
 *   this number on a record; lastSentAtMs is when that business last
 *   messaged it (0 when never).
 * @return {object} {kind: business | ask | laawol, businessId, options,
 *   laawolOnly}. In Laawol-only mode a business decision still names the
 *   business (so the conversation can move there later) with laawolOnly
 *   true.
 */
function routeInbound({candidates = [], nowMs = Date.now(), mode = ""} = {}) {
  const unique = [];
  const seen = new Set();
  for (const c of candidates) {
    const id = String(c?.businessId || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push({businessId: id, businessName: String(c.businessName || ""),
      lastSentAtMs: Number(c.lastSentAtMs) || 0});
  }
  unique.sort((a, b) => b.lastSentAtMs - a.lastSentAtMs ||
    a.businessName.localeCompare(b.businessName));
  const laawolOnly = mode !== INBOX_MODE.BUSINESSES;
  const recent = unique.filter((c) =>
    c.lastSentAtMs > 0 && nowMs - c.lastSentAtMs <= RECENT_MS);
  if (recent.length > 0) {
    return {kind: "business", businessId: recent[0].businessId,
      options: [], laawolOnly};
  }
  if (unique.length === 1) {
    return {kind: "business", businessId: unique[0].businessId,
      options: [], laawolOnly};
  }
  if (unique.length > 1) {
    return {kind: "ask", businessId: "", options: unique.slice(0, 9),
      laawolOnly};
  }
  return {kind: "laawol", businessId: "", options: [], laawolOnly};
}

/**
 * The business a customer picked from the list we sent ("1", "2", or the
 * business's name).
 *
 * @param {string} text Their answer.
 * @param {object[]} options The list, in the order it was sent.
 * @return {string} The business id, or "".
 */
function choiceFromReply(text, options) {
  const list = Array.isArray(options) ? options : [];
  const folded = fold(text);
  if (!folded) return "";
  const number = folded.match(/^(\d{1,2})$/);
  if (number) {
    const pick = list[Number(number[1]) - 1];
    return pick ? String(pick.businessId || "") : "";
  }
  const named = list.filter((o) => {
    const name = fold(o?.businessName);
    return name && (folded === name || folded.includes(name) ||
      (folded.length >= 4 && name.includes(folded)));
  });
  return named.length === 1 ? String(named[0].businessId || "") : "";
}

/**
 * Whether a free-form message may go to the customer now.
 *
 * @param {number} lastCustomerAtMs When they last wrote (0 = never).
 * @param {number} nowMs Now.
 * @return {boolean} True inside the 24 hour window.
 */
function withinWindow(lastCustomerAtMs, nowMs = Date.now()) {
  const last = Number(lastCustomerAtMs) || 0;
  return last > 0 && nowMs - last < WINDOW_MS;
}

const WEEK_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Whether the business is open now, from its package-request opening hours
 * (any office open counts).
 *
 * @param {object} openingHours officeId -> {mon..sun: {open, from, to}}.
 * @param {string} timeZone The business's IANA zone.
 * @param {number} nowMs Now.
 * @return {boolean|null} null when the business set no hours.
 */
function isOpenNow(openingHours, timeZone, nowMs = Date.now()) {
  const weeks = openingHours && typeof openingHours === "object" ?
    Object.values(openingHours).filter((w) => w && typeof w === "object") :
    [];
  const hasAny = weeks.some((week) =>
    WEEK_KEYS.some((day) => week[day]?.open === true));
  if (!hasAny) return null;
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "America/New_York",
      weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(nowMs));
  } catch (error) {
    return null;
  }
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const day = get("weekday").slice(0, 3).toLowerCase();
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  const toMinutes = (hhmm) => {
    const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };
  return weeks.some((week) => {
    const today = week[day];
    if (!today || today.open !== true) return false;
    const from = toMinutes(today.from);
    const to = toMinutes(today.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
    return to > from ? minutes >= from && minutes < to :
      minutes >= from || minutes < to;
  });
}

/**
 * What the customer is told automatically. Sent inside the window they just
 * opened, so it is free-form text. `confirm_ok` / `confirm_problem` answer
 * the sender's tap on the package confirmation (docs/AIR_PACKAGES.md §3).
 *
 * @param {object} args {kind: received|closed|ask|ask_again|stopped|started|
 *   laawol|confirm_ok|confirm_problem, lang, businessName, trackingUrl,
 *   options}.
 * @return {string} The message, or "" for an unknown kind.
 */
function autoReplyText({kind, lang = "en", businessName = "", trackingUrl = "",
  options = []} = {}) {
  const fr = lang === "fr";
  const name = String(businessName || "Laawol").trim();
  const track = trackingUrl ?
    (fr ? `\nSuivez votre envoi : ${trackingUrl}` :
      `\nTrack your shipment: ${trackingUrl}`) : "";
  const list = (Array.isArray(options) ? options : [])
      .map((o, i) => `${i + 1} - ${o.businessName || o.businessId}`).join("\n");
  switch (kind) {
    case "received":
      return fr ?
        `Merci, votre message a été transmis à ${name}. ` +
          `Ils vous répondront ici.${track}` :
        `Thanks, your message went to ${name}. They will reply here.${track}`;
    case "closed":
      return fr ?
        `${name} est fermé pour le moment et vous répondra ` +
          `dès l’ouverture.${track}` :
        `${name} is closed right now and will reply when they open.${track}`;
    case "laawol":
      return fr ?
        "Merci, votre message a été reçu. L’équipe Laawol vous répondra ici." :
        "Thanks, your message was received. The Laawol team will reply here.";
    case "ask":
      return fr ?
        "Merci ! Votre message concerne quel envoi ? " +
          `Répondez avec le numéro :\n${list}` :
        `Thanks! Which shipment is this about? Reply with the number:\n${list}`;
    case "ask_again":
      return fr ?
        "Désolé, nous n’avons pas compris. " +
          `Répondez avec le numéro :\n${list}` :
        `Sorry, we didn't get that. Reply with the number:\n${list}`;
    case "stopped":
      return fr ?
        "Vous ne recevrez plus de mises à jour sur ce numéro. " +
          "Répondez START pour les réactiver." :
        "You won't get more updates on this number. " +
          "Reply START to turn them back on.";
    case "started":
      return fr ?
        "Les mises à jour sont réactivées. Merci !" :
        "Updates are back on. Thank you!";
    case "confirm_ok":
      return fr ? "Merci, c'est noté." : "Thanks, noted.";
    case "confirm_problem":
      return fr ?
        `Désolé. ${name} vous répondra ici.` :
        `Sorry about that. ${name} will reply here.`;
    default:
      return "";
  }
}

// A package code as a customer writes it inside a sentence: "CL-K7M4P2",
// "cl k7m4p2", a split part "CL-K7M4P2-2", or the label's link.
const CODE_IN_TEXT = /\bCL[\s-]?[A-Z0-9]{6}(?:-?[1-9]\d?)?\b/gi;

/**
 * The package code a message mentions, so a photo sent with it files
 * itself on the package (docs/AIR_PACKAGES.md §4.6). The first code found
 * wins; what looks like one but is not (a zero for an O) is no code.
 *
 * @param {string} text The message's text or caption.
 * @return {string} "CL-XXXXXX" (or "CL-XXXXXX-n"), or "".
 */
function codeInText(text) {
  const value = String(text ?? "");
  for (const match of value.matchAll(CODE_IN_TEXT)) {
    const code = scanCodeFrom(match[0]);
    if (code) return code;
  }
  return "";
}

/**
 * The first name of a full name.
 *
 * @param {string} fullName "Mamadou Diallo".
 * @return {string} "Mamadou".
 */
function firstName(fullName) {
  return String(fullName ?? "").trim().split(/\s+/)[0] || "";
}

/**
 * How a reply is signed for the customer: "Mamadou (Nensona)", or
 * "Hassimiou (Laawol)" for Laawol's own team.
 *
 * @param {object} args {chatDisplayName, fullName, isLaawol, businessName}.
 * @return {string} The label.
 */
function senderLabel({chatDisplayName = "", fullName = "", isLaawol = false,
  businessName = ""} = {}) {
  const person = String(chatDisplayName || "").trim().slice(0, 40) ||
    firstName(fullName) || (isLaawol ? "Laawol" : "");
  const org = isLaawol ? "Laawol" : String(businessName || "").trim();
  if (!person) return org;
  if (!org || person === org) return person;
  return `${person} (${org})`;
}

/**
 * A text reply with its signature, in WhatsApp's bold.
 *
 * @param {string} label The signature.
 * @param {string} text The reply.
 * @return {string} "*Mamadou (Nensona):* text".
 */
function signedText(label, text) {
  const body = String(text ?? "").trim();
  return label ? `*${label}:* ${body}` : body;
}

/**
 * The thread's message type for a file's MIME type.
 *
 * @param {string} mimeType The type.
 * @param {boolean} voice A recorded voice note.
 * @return {"image"|"voice"|"video"|"file"} Our type.
 */
function messageTypeForMime(mimeType, voice = false) {
  const mime = String(mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/") || voice) return "voice";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

/**
 * The /messages body for a free-form message.
 *
 * @param {object} args {phone, kind: text|image|audio|video|document, text,
 *   link, fileName, caption, replyToWamid}.
 * @return {object|null} The body, or null when something is missing.
 */
function freeFormBody({phone, kind = "text", text = "", link = "",
  fileName = "", caption = "", replyToWamid = ""} = {}) {
  const to = String(phone ?? "").replace(/\D/g, "");
  if (!to) return null;
  const base = {messaging_product: "whatsapp", recipient_type: "individual",
    to};
  if (replyToWamid) base.context = {message_id: String(replyToWamid)};
  if (kind === "text") {
    const body = String(text ?? "").trim();
    if (!body) return null;
    return {...base, type: "text",
      text: {preview_url: true, body: body.slice(0, 4096)}};
  }
  if (!link) return null;
  if (kind === "image" || kind === "video") {
    return {...base, type: kind,
      [kind]: {link, ...(caption ? {caption: caption.slice(0, 1024)} : {})}};
  }
  if (kind === "audio") {
    // Audio cannot carry a caption: the signature goes as its own text.
    return {...base, type: "audio", audio: {link}};
  }
  if (kind === "document") {
    return {...base, type: "document", document: {link,
      ...(fileName ? {filename: fileName.slice(0, 200)} : {}),
      ...(caption ? {caption: caption.slice(0, 1024)} : {})}};
  }
  return null;
}

/**
 * The WhatsApp kind to send a thread message as.
 *
 * @param {string} messageType Our type (image, voice, video, file).
 * @return {"image"|"audio"|"video"|"document"} Meta's type.
 */
function waKindForMessageType(messageType) {
  if (messageType === "image") return "image";
  if (messageType === "voice") return "audio";
  if (messageType === "video") return "video";
  return "document";
}

/**
 * The "you have a message" template: Hello {{1}}, {{2}} has a message for
 * you about your shipment {{3}}. Reply to this message to read it. / the
 * same in French with {{4}} {{5}}.
 *
 * @param {object} args {phone, name, businessName, reference}.
 * @return {object|null} The body.
 */
function waitingTemplateBody({phone, name = "", businessName = "",
  reference = ""} = {}) {
  const to = String(phone ?? "").replace(/\D/g, "");
  if (!to) return null;
  const clip = (value, fallback) =>
    (String(value ?? "").trim() || fallback).replace(/\s+/g, " ").slice(0, 60);
  const who = clip(name, "there");
  const biz = clip(businessName, "Laawol");
  const ref = clip(reference, "-");
  const param = (text) => ({type: "text", text});
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: WAITING_TEMPLATE,
      language: {code: "en"},
      components: [{type: "body", parameters: [
        param(who), param(biz), param(ref), param(biz), param(ref),
      ]}],
    },
  };
}

/** Delivery statuses in order; a later one never goes back. */
const DELIVERY_RANK = Object.freeze({sent: 1, delivered: 2, read: 3,
  failed: 4});

/**
 * The delivery status after a Meta status event.
 *
 * @param {string} current What is recorded.
 * @param {string} incoming What Meta reports.
 * @return {string} The status to keep.
 */
function nextDeliveryStatus(current, incoming) {
  const now = DELIVERY_RANK[current] || 0;
  const next = DELIVERY_RANK[incoming] || 0;
  if (!next) return current || "";
  // failed always wins over sent/delivered; read never goes back.
  if (current === "read") return "read";
  return next > now ? incoming : current;
}

/**
 * What a staff-facing preview of a message says.
 *
 * @param {string} messageType Our type.
 * @param {string} text Its text or caption.
 * @return {string} Preview text.
 */
function previewText(messageType, text) {
  const body = String(text ?? "").trim();
  if (body) return body.slice(0, 400);
  const labels = {image: "Photo", voice: "Voice note", video: "Video",
    file: "Document"};
  return labels[messageType] || "Message";
}

module.exports = {
  LAAWOL_INBOX,
  WINDOW_MS,
  RECENT_MS,
  MEDIA_RETENTION_MS,
  WAITING_TEMPLATE,
  INBOX_MODE,
  CONVERSATION_STATE,
  DELIVERY_RANK,
  phoneFromWa,
  conversationId,
  verifyTokenFor,
  verifySignature,
  parseWebhook,
  fold,
  stopOrStart,
  detectLanguage,
  routeInbound,
  choiceFromReply,
  withinWindow,
  isOpenNow,
  autoReplyText,
  codeInText,
  firstName,
  senderLabel,
  signedText,
  messageTypeForMime,
  freeFormBody,
  waKindForMessageType,
  waitingTemplateBody,
  nextDeliveryStatus,
  previewText,
};
