/* eslint-disable max-len */
/* global globalThis */
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {before, beforeEach, describe, it} = require("node:test");
const admin = require("firebase-admin");

// Two-way WhatsApp (docs/WHATSAPP_CONVERSATIONS.md) end to end against the
// Firestore and Storage emulators: the webhook (signature, dedupe, routing,
// automatic replies, STOP, files, delivery ticks), staff replies relayed
// through sendSupportMessage, the 24 hour window and its template, and the
// whatsappConversation actions. Meta is a fake `fetch`.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Run this through `npm run test:whatsapp` " +
    "(firebase emulators:exec).");
}

process.env.FUNCTIONS_EMULATOR = "true";
process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1475234702329161";
process.env.WHATSAPP_APP_SECRET = "test-app-secret";

// --- Fake Meta -------------------------------------------------------------
const sent = [];
let failNextSendCode = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href.includes("graph.facebook.com") && href.endsWith("/messages")) {
    const body = JSON.parse(init.body);
    if (failNextSendCode) {
      const code = failNextSendCode;
      failNextSendCode = 0;
      return new Response(JSON.stringify({error: {code, message: "fail"}}), {status: 400});
    }
    sent.push(body);
    return new Response(JSON.stringify({messages: [{id: `wamid.out.${sent.length}`}]}), {status: 200});
  }
  if (href.includes("graph.facebook.com/v21.0/media-")) {
    return new Response(JSON.stringify({url: "https://lookaside.example/media-file", mime_type: "image/jpeg"}), {status: 200});
  }
  if (href === "https://lookaside.example/media-file") {
    return new Response(Buffer.from("fake-jpeg-bytes"), {status: 200, headers: {"content-type": "image/jpeg"}});
  }
  return realFetch(url, init);
};

const functions = require("../index");
const db = admin.firestore();

const BIZ = "wa-test-biz";
const BIZ2 = "wa-test-biz2";
const OWNER = "wa-owner";
const STAFF_ON = "wa-staff-on";
const STAFF_OFF = "wa-staff-off";
const OTHER_STAFF = "wa-other-staff";
const ADMIN = "wa-admin";
const P1 = "+224621000001";
const P2 = "+224621000002";
const P3 = "+224621000003";
const DAY = 24 * 60 * 60 * 1000;
let wamidSeq = 0;

function signedRequest(body) {
  const raw = Buffer.from(JSON.stringify(body));
  const sig = "sha256=" + crypto.createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(raw).digest("hex");
  return fakeReq({method: "POST", rawBody: raw, headers: {"x-hub-signature-256": sig}});
}

function fakeReq({method, rawBody = Buffer.from(""), query = {}, headers = {}}) {
  return {method, rawBody, query, headers, url: "/", body: {},
    on: () => {}, once: () => {},
    get: (name) => headers[String(name).toLowerCase()] || "",
    header: (name) => headers[String(name).toLowerCase()] || ""};
}

function fakeRes() {
  const res = {statusCode: 0, body: "", headers: {}, headersSent: false,
    on: () => res, once: () => res, emit: () => true,
    setHeader: (k, v) => {
      res.headers[k.toLowerCase()] = v;
    },
    getHeader: (k) => res.headers[k.toLowerCase()],
    end: (value) => {
      if (value !== undefined) res.body = value;
      res.headersSent = true;
      return res;
    }};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.send = (value) => {
    res.body = value;
    return res;
  };
  return res;
}

async function postWebhook(value) {
  const res = fakeRes();
  await functions.whatsappWebhook(signedRequest({object: "whatsapp_business_account",
    entry: [{id: "992521863149970", changes: [{field: "messages", value}]}]}), res);
  return res;
}

async function inbound(from, text, extra = {}) {
  wamidSeq += 1;
  const id = extra.id || `wamid.in.${Date.now()}.${wamidSeq}`;
  const msg = {from: from.replace("+", ""), id, timestamp: String(Math.floor(Date.now() / 1000)),
    type: "text", text: {body: text}, ...extra.message};
  const res = await postWebhook({metadata: {phone_number_id: "1475234702329161"},
    contacts: [{wa_id: from.replace("+", ""), profile: {name: extra.name || "Aissatou Bah"}}],
    messages: [msg]});
  assert.equal(res.statusCode, 200);
  return id;
}

const call = (name, data, uid) => functions[name].run({auth: {uid, token: {}}, data, rawRequest: {}});
const caseRef = (inbox, phone) => db.collection("supportCases").doc(`wa_${inbox}_${phone.replace(/\D/g, "")}`);
const messagesOf = async (ref) => (await ref.collection("messages").orderBy("createdAt").get()).docs.map((d) => ({id: d.id, ...d.data()}));
const lastSentText = () => sent[sent.length - 1]?.text?.body || "";

async function setMode(mode) {
  await db.collection("appConfig").doc("whatsappInbox").set({mode});
}

async function clearCollections() {
  for (const name of ["whatsappContacts", "whatsappStops", "whatsappInbound", "whatsappMessages",
    "whatsappMedia", "whatsappTemplateCounts", "containerLines", "containerUpdates"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  const cases = await db.collection("supportCases").get();
  for (const doc of cases.docs) {
    const msgs = await doc.ref.collection("messages").get();
    await Promise.all(msgs.docs.map((d) => d.ref.delete()));
    await doc.ref.delete();
  }
  for (const uid of [OWNER, STAFF_ON, STAFF_OFF, ADMIN]) {
    const notes = await db.collection("users").doc(uid).collection("notifications").get();
    await Promise.all(notes.docs.map((d) => d.ref.delete()));
  }
  sent.length = 0;
}

async function notificationCount(uid) {
  return (await db.collection("users").doc(uid).collection("notifications").get()).size;
}

before(async () => {
  try {
    await admin.auth().createUser({uid: ADMIN, email: "wa-admin@example.test", emailVerified: true});
  } catch (error) {
    if (error.code !== "auth/uid-already-exists") throw error;
  }
  await db.collection("businesses").doc(BIZ).set({name: "Nensona", ownerUid: OWNER, country: "US",
    packageRequestSettings: {timeZone: "America/New_York", openingHours: {}}});
  await db.collection("businesses").doc(BIZ2).set({name: "Keren", ownerUid: "wa-owner2", country: "US"});
  await db.collection("users").doc(OWNER).set({role: "businessOwner", businessId: BIZ, fullName: "Ousmane Sow"});
  await db.collection("users").doc(STAFF_ON).set({role: "staff", businessId: BIZ, fullName: "Mamadou Diallo",
    businessPermissions: ["containers"], notificationPreferences: {whatsappMessages: true}});
  await db.collection("users").doc(STAFF_OFF).set({role: "staff", businessId: BIZ, fullName: "Fanta Camara",
    businessPermissions: ["deliveries"]});
  await db.collection("users").doc(OTHER_STAFF).set({role: "staff", businessId: BIZ2, fullName: "Kadi"});
  await db.collection("users").doc(ADMIN).set({role: "admin", adminRole: "supportAdmin", fullName: "Hassimiou Niane"});
});

beforeEach(async () => {
  await clearCollections();
  await setMode("businesses");
});

describe("the webhook door", () => {
  it("answers Meta's verification and refuses unsigned posts", async () => {
    const {verifyTokenFor} = require("../whatsapp_inbox");
    const ok = fakeRes();
    await functions.whatsappWebhook(fakeReq({method: "GET", query: {"hub.mode": "subscribe",
      "hub.verify_token": verifyTokenFor("test-app-secret"), "hub.challenge": "42"}}), ok);
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.body, "42");
    const bad = fakeRes();
    await functions.whatsappWebhook(fakeReq({method: "GET", query: {"hub.mode": "subscribe",
      "hub.verify_token": "nope", "hub.challenge": "42"}}), bad);
    assert.equal(bad.statusCode, 403);
    const forged = fakeRes();
    await functions.whatsappWebhook(fakeReq({method: "POST", rawBody: Buffer.from("{}"),
      headers: {"x-hub-signature-256": "sha256=00"}}), forged);
    assert.equal(forged.statusCode, 401);
  });
});

describe("a customer writes", () => {
  it("lands with the business that messaged them last, gets a receipt with the tracking link, and pings the right people", async () => {
    await db.collection("whatsappContacts").doc(P1).set({phone: P1, businesses: {
      [BIZ]: {businessName: "Nensona", lastSentAtMs: Date.now() - DAY, trackingCode: "CL-4F7K"},
      [BIZ2]: {businessName: "Keren", lastSentAtMs: Date.now() - 5 * DAY}}});
    const wamid = await inbound(P1, "Bonjour, mon baril est arrivé ?");
    const conv = (await caseRef(BIZ, P1).get()).data();
    assert.equal(conv.caseType, "whatsapp");
    assert.equal(conv.businessId, BIZ);
    assert.equal(conv.whatsappState, "needs_reply");
    assert.equal(conv.customerName, "Aissatou Bah");
    assert.equal(conv.whatsappLang, "fr");
    const msgs = await messagesOf(caseRef(BIZ, P1));
    assert.equal(msgs[0].senderRole, "customer");
    assert.equal(msgs[0].content, "Bonjour, mon baril est arrivé ?");
    assert.equal(msgs[0].metadata.whatsapp.wamid, wamid);
    // Automatic receipt, in French, with the tracking link.
    assert.match(lastSentText(), /Nensona/);
    assert.match(lastSentText(), /customer\.laawoldigital\.com\/t\/CL-4F7K/);
    assert.ok(msgs.some((m) => m.metadata?.auto === true));
    // Owner and the staff member who switched it on; not the other one.
    assert.equal(await notificationCount(OWNER), 1);
    assert.equal(await notificationCount(STAFF_ON), 1);
    assert.equal(await notificationCount(STAFF_OFF), 0);
    // Meta redelivers: nothing doubles.
    const before = sent.length;
    await inbound(P1, "Bonjour, mon baril est arrivé ?", {id: wamid});
    assert.equal((await messagesOf(caseRef(BIZ, P1))).filter((m) => m.senderRole === "customer").length, 1);
    assert.equal(sent.length, before);
  });

  it("stores photos in our bucket", async () => {
    await db.collection("whatsappContacts").doc(P1).set({phone: P1, businesses: {
      [BIZ]: {businessName: "Nensona", lastSentAtMs: Date.now()}}});
    await inbound(P1, "", {message: {type: "image", image: {id: "media-1", mime_type: "image/jpeg", caption: "carton abîmé"}}});
    const msg = (await messagesOf(caseRef(BIZ, P1)))[0];
    assert.equal(msg.messageType, "image");
    assert.equal(msg.metadata.caption, "carton abîmé");
    assert.match(msg.metadata.filePath, /^support_cases\/wa_wa-test-biz_224621000001\/whatsapp\//);
    assert.match(msg.metadata.fileUrl, /alt=media&token=/);
    assert.equal((await db.collection("whatsappMedia").get()).size, 1);
  });

  it("asks which business when several know them and none wrote lately, then follows the pick", async () => {
    await db.collection("containerLines").doc("l-1").set({businessId: BIZ, customerPhoneE164: P2, trackingCode: "CL-A"});
    await db.collection("containerLines").doc("l-2").set({businessId: BIZ2, receiverPhoneE164: P2, trackingCode: "CL-B"});
    await inbound(P2, "Hello, where is my car?");
    const held = (await caseRef("laawol", P2).get()).data();
    assert.equal(held.whatsappState, "choosing");
    assert.match(lastSentText(), /1 - (Nensona|Keren)\n2 - (Nensona|Keren)/);
    const contact = (await db.collection("whatsappContacts").doc(P2).get()).data();
    const kerenIndex = contact.choosing.options.findIndex((o) => o.businessId === BIZ2) + 1;
    await inbound(P2, "huh?");
    assert.match(lastSentText(), /didn't get that/);
    await inbound(P2, String(kerenIndex));
    const keren = await messagesOf(caseRef(BIZ2, P2));
    assert.ok(keren.some((m) => m.content === "Hello, where is my car?"));
    assert.ok(keren.some((m) => m.content === "The customer chose this business."));
    assert.equal((await caseRef("laawol", P2).get()).data().whatsappState, "done");
    assert.match(lastSentText(), /Keren/);
  });

  it("sends unknown numbers to Laawol's inbox and tells support admins", async () => {
    await inbound(P3, "hi who is this");
    const conv = (await caseRef("laawol", P3).get()).data();
    assert.equal(conv.businessId, "");
    assert.equal(conv.escalationStatus, "escalated");
    assert.match(lastSentText(), /Laawol team/);
    assert.equal(await notificationCount(ADMIN), 1);
  });

  it("keeps everything with Laawol in launch week, remembering whose it would be", async () => {
    await setMode("laawol_only");
    await db.collection("whatsappContacts").doc(P1).set({phone: P1, businesses: {
      [BIZ]: {businessName: "Nensona", lastSentAtMs: Date.now()}}});
    await inbound(P1, "hello");
    const conv = (await caseRef("laawol", P1).get()).data();
    assert.equal(conv.suggestedBusinessId, BIZ);
    assert.equal((await caseRef(BIZ, P1).get()).exists, false);
    assert.equal(await notificationCount(OWNER), 0);
  });
});

describe("staff answer", () => {
  async function conversationWithMessage() {
    await db.collection("whatsappContacts").doc(P1).set({phone: P1, businesses: {
      [BIZ]: {businessName: "Nensona", lastSentAtMs: Date.now(), trackingCode: "CL-4F7K"}}});
    await inbound(P1, "Hello, any news?");
    return caseRef(BIZ, P1);
  }

  it("pings staff only when they switched it on, even after a profile save", async () => {
    // A profile save normalizes preferences; it must not switch staff on.
    const {normalizeNotificationPreferences} = require("../notification_settings");
    await db.collection("users").doc(STAFF_OFF).set({notificationPreferences:
      normalizeNotificationPreferences({pushNotifications: true})}, {merge: true});
    await conversationWithMessage();
    assert.equal(await notificationCount(STAFF_OFF), 0);
    assert.equal(await notificationCount(STAFF_ON), 1);
  });

  it("relays a reply signed with the person and the business, even without the Support permission", async () => {
    const ref = await conversationWithMessage();
    const result = await call("sendSupportMessage", {caseId: ref.id, content: "Loaded on Friday's container."}, STAFF_ON);
    assert.equal(result.delivery, "sent");
    assert.equal(lastSentText(), "*Mamadou (Nensona):* Loaded on Friday's container.");
    const reply = (await messagesOf(ref)).find((m) => m.senderRole === "business");
    assert.equal(reply.metadata.whatsapp.status, "sent");
    assert.equal((await ref.get()).data().whatsappState, "waiting_customer");
    // Delivery ticks only move forward.
    const wamid = reply.metadata.whatsapp.wamid;
    for (const status of ["delivered", "read", "delivered"]) {
      await postWebhook({statuses: [{id: wamid, status, recipient_id: P1.slice(1), timestamp: "1793200000"}]});
    }
    const ticked = (await messagesOf(ref)).find((m) => m.id === reply.id);
    assert.equal(ticked.metadata.whatsapp.status, "read");
    // A display name replaces the first name.
    await call("whatsappConversation", {action: "setDisplayName", name: "Mama"}, STAFF_ON);
    await call("sendSupportMessage", {caseId: ref.id, content: "Thanks!"}, STAFF_ON);
    assert.equal(lastSentText(), "*Mama (Nensona):* Thanks!");
    // Another business's staff cannot reply.
    await assert.rejects(call("sendSupportMessage", {caseId: ref.id, content: "x"}, OTHER_STAFF));
  });

  it("outside 24 hours holds the reply, sends the template once, and delivers when the customer writes", async () => {
    const ref = await conversationWithMessage();
    await ref.set({lastCustomerMessageAtMs: Date.now() - 2 * DAY}, {merge: true});
    sent.length = 0;
    const first = await call("sendSupportMessage", {caseId: ref.id, content: "Your barrel arrived."}, OWNER);
    const second = await call("sendSupportMessage", {caseId: ref.id, content: "Come Monday."}, OWNER);
    assert.equal(first.delivery, "waiting");
    assert.equal(second.delivery, "waiting");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].template.name, "message_waiting_2lang");
    assert.deepEqual(sent[0].template.components[0].parameters.map((p) => p.text),
        ["Aissatou", "Nensona", "CL-4F7K", "Nensona", "CL-4F7K"]);
    const counts = (await db.collection("whatsappTemplateCounts").get()).docs.map((d) => d.data());
    assert.ok(counts.some((c) => c.businessId === BIZ && c.byTemplate.message_waiting_2lang === 1));
    sent.length = 0;
    await inbound(P1, "ok");
    const texts = sent.map((b) => b.text?.body || "");
    assert.ok(texts.includes("*Ousmane (Nensona):* Your barrel arrived."));
    assert.ok(texts.includes("*Ousmane (Nensona):* Come Monday."));
    const statuses = (await messagesOf(ref)).filter((m) => m.senderRole === "business")
        .map((m) => m.metadata.whatsapp.status);
    assert.deepEqual(statuses, ["sent", "sent"]);
  });

  it("STOP pauses templates to that number; START turns them back on", async () => {
    const ref = await conversationWithMessage();
    await inbound(P1, "STOP");
    assert.equal((await db.collection("whatsappStops").doc(P1).get()).data().stopped, true);
    assert.match(lastSentText(), /won't get more updates|ne recevrez plus/);
    assert.equal((await ref.get()).data().updatesStopped, true);
    await ref.set({lastCustomerMessageAtMs: Date.now() - 2 * DAY}, {merge: true});
    sent.length = 0;
    const result = await call("sendSupportMessage", {caseId: ref.id, content: "News"}, OWNER);
    assert.equal(result.delivery, "stopped");
    assert.equal(sent.length, 0);
    await inbound(P1, "START");
    assert.equal((await db.collection("whatsappStops").doc(P1).get()).data().stopped, false);
  });

  it("notes stay private, Done clears the list, a new message reopens it", async () => {
    const ref = await conversationWithMessage();
    sent.length = 0;
    await call("whatsappConversation", {action: "note", caseId: ref.id, text: "Called her, all fine"}, ADMIN);
    assert.equal(sent.length, 0);
    assert.ok((await messagesOf(ref)).some((m) => m.metadata?.note === true && m.content === "Called her, all fine"));
    await call("whatsappConversation", {action: "done", caseId: ref.id}, STAFF_OFF);
    assert.equal((await ref.get()).data().whatsappState, "done");
    await inbound(P1, "one more thing");
    assert.equal((await ref.get()).data().whatsappState, "needs_reply");
  });

  it("hands a conversation to Laawol, and only to businesses that know the customer", async () => {
    const ref = await conversationWithMessage();
    await assert.rejects(call("whatsappConversation", {action: "handoff", caseId: ref.id, to: BIZ2}, OWNER));
    const result = await call("whatsappConversation", {action: "handoff", caseId: ref.id, to: "laawol"}, OWNER);
    assert.equal(result.caseId, `wa_laawol_${P1.slice(1)}`);
    const target = (await caseRef("laawol", P1).get()).data();
    assert.ok(target.handedToLaawolAtMs > 0);
    assert.ok((await messagesOf(caseRef("laawol", P1))).some((m) => m.content === "Hello, any news?"));
    assert.equal((await ref.get()).data().whatsappState, "done");
    // The next message follows the hand-over.
    await inbound(P1, "still there?");
    assert.ok((await messagesOf(caseRef("laawol", P1))).some((m) => m.content === "still there?"));
  });

  it("opens a conversation from a package and lists the customer's packages", async () => {
    await db.collection("containerLines").doc("l-9").set({businessId: BIZ, customerPhoneE164: P1,
      trackingCode: "CL-9", kind: "barrels", containerStatus: "waiting"});
    await db.collection("containerLines").doc("l-10").set({businessId: BIZ2, customerPhoneE164: P1, trackingCode: "CL-10"});
    const {caseId} = await call("whatsappConversation", {action: "open", phone: P1, name: "Aissatou Bah"}, STAFF_OFF);
    assert.equal(caseId, `wa_${BIZ}_${P1.slice(1)}`);
    const {packages} = await call("whatsappConversation", {action: "packages", caseId}, STAFF_OFF);
    assert.deepEqual(packages.map((p) => p.trackingCode), ["CL-9"]);
    // A local number would open the wrong person's thread.
    await assert.rejects(call("whatsappConversation", {action: "open", phone: "621000001"}, STAFF_OFF));
    // Hand-over choices: Laawol and the other business that knows them.
    const {options} = await call("whatsappConversation", {action: "handoffOptions", caseId}, STAFF_OFF);
    assert.deepEqual(options.map((o) => o.businessId), ["laawol", BIZ2]);
  });

  it("only Laawol switches the inbox mode", async () => {
    await assert.rejects(call("whatsappConversation", {action: "setMode", mode: "laawol_only"}, OWNER));
    const result = await call("whatsappConversation", {action: "setMode", mode: "laawol_only"}, ADMIN);
    assert.equal(result.mode, "laawol_only");
    assert.equal((await call("whatsappConversation", {action: "mode"}, ADMIN)).mode, "laawol_only");
  });
});

describe("package updates", () => {
  it("records who messaged the number, and Meta's failure on the update row", async () => {
    await db.collection("containerLines").doc("line-u").set({businessId: BIZ,
      lastCustomerUpdate: {update: "received", atMs: 1000,
        results: [{role: "sender", status: "sent"}, {role: "receiver", status: "sent"}]}});
    await db.collection("containerUpdates").doc("u-1").set({businessId: BIZ, phone: P1, lineId: "line-u",
      whatsappMessageId: "wamid.update.1", status: "sent", update: "received", role: "sender"});
    await postWebhook({statuses: [{id: "wamid.update.1", status: "delivered", recipient_id: P1.slice(1), timestamp: "1"}]});
    await postWebhook({statuses: [{id: "wamid.update.1", status: "failed", recipient_id: P1.slice(1), timestamp: "2",
      errors: [{code: 131026, title: "Message undeliverable"}]}]});
    const row = (await db.collection("containerUpdates").doc("u-1").get()).data();
    assert.equal(row.deliveryStatus, "failed");
    assert.equal(row.deliveryError, "Message undeliverable");
    const last = (await db.collection("containerLines").doc("line-u").get()).data().lastCustomerUpdate;
    assert.equal(last.atMs, 1000, "the update's time does not move");
    assert.deepEqual(last.results, [
      {role: "sender", status: "failed", delivery: "failed", reason: "Message undeliverable"},
      {role: "receiver", status: "sent"}]);
  });
});

describe("the sender's confirmation and photos with a code (docs/AIR_PACKAGES.md)", () => {
  const LINE = "line-confirm";
  const CODE = "CL-K7M4P2";
  const CONFIRM_WAMID = "wamid.confirm.1";
  async function seedConfirm(extra = {}) {
    await db.collection("containerLines").doc(LINE).set({businessId: BIZ, trackingCode: CODE,
      kind: "other", description: "box", ownerKind: "customer", customerName: "Aissatou Bah",
      customerPhone: P1, customerPhoneE164: P1, receiverPhone: P2,
      contents: [{label: "phones", quantity: 2}],
      senderConfirmation: {status: "asked", askedAtMs: 1000}, ...extra});
    await db.collection("containerUpdates").doc(`${LINE}_sender_confirm`).set({businessId: BIZ,
      businessName: "Nensona", phone: P1, lineId: LINE, update: "confirm", role: "sender",
      status: "sent", whatsappMessageId: CONFIRM_WAMID, trackingCode: CODE});
  }
  const tap = (phone, payload, text, extra = {}) => inbound(phone, "", {...extra, message: {
    type: "button", button: {text, payload}, context: {id: extra.replyTo || CONFIRM_WAMID}}});

  it("OK marks the package confirmed, thanks the sender, and opens no conversation", async () => {
    await seedConfirm();
    const wamid = await tap(P1, "confirm_ok", "OK ✓");
    const line = (await db.collection("containerLines").doc(LINE).get()).data();
    assert.equal(line.senderConfirmation.status, "confirmed");
    assert.equal(line.senderConfirmation.wamid, wamid);
    assert.equal(line.senderConfirmation.askedAtMs, 1000);
    assert.ok(line.senderConfirmation.answeredAtMs > 1000);
    const row = (await db.collection("containerUpdates").doc(`${LINE}_sender_confirm`).get()).data();
    assert.equal(row.confirmation, "confirmed");
    // The thanks, in the customer's language (a Guinean number: French).
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, P1.slice(1));
    assert.equal(lastSentText(), "Merci, c'est noté.");
    assert.equal((await db.collection("supportCases").get()).size, 0);
    assert.equal(await notificationCount(OWNER), 0);
    // The contact is recorded, and Meta's redelivery changes nothing.
    assert.equal((await db.collection("whatsappContacts").doc(P1).get()).data().lang, "fr");
    await tap(P1, "confirm_ok", "OK ✓", {id: wamid});
    assert.equal(sent.length, 1);
  });

  it("Something's wrong flags the package and opens the business's conversation as needs reply", async () => {
    await seedConfirm();
    const wamid = await tap(P1, "confirm_problem", "Something's wrong");
    const line = (await db.collection("containerLines").doc(LINE).get()).data();
    assert.equal(line.senderConfirmation.status, "problem");
    assert.equal(line.senderConfirmation.wamid, wamid);
    const conv = (await caseRef(BIZ, P1).get()).data();
    assert.equal(conv.whatsappState, "needs_reply");
    assert.equal(conv.businessId, BIZ);
    assert.equal(conv.lastMessage, "Something's wrong");
    const msgs = await messagesOf(caseRef(BIZ, P1));
    const button = msgs.find((m) => m.senderRole === "customer");
    assert.equal(button.content, "Something's wrong");
    assert.equal(button.metadata.whatsapp.replyToWamid, CONFIRM_WAMID);
    const note = msgs.find((m) => m.metadata?.senderProblem === true);
    assert.equal(note.content, "Sender reported a problem with package CL-K7M4P2 (2 phones).");
    assert.equal(note.metadata.note, true);
    assert.equal(note.metadata.lineId, LINE);
    assert.ok(msgs.some((m) => m.metadata?.auto === true && m.content === "Désolé. Nensona vous répondra ici."));
    assert.equal(lastSentText(), "Désolé. Nensona vous répondra ici.");
    assert.equal(sent.length, 1, "the thanks replaces the usual receipt");
    assert.equal(await notificationCount(OWNER), 1);
    // A second tap on a stale button, with the thread marked Done, reopens it.
    await call("whatsappConversation", {action: "done", caseId: caseRef(BIZ, P1).id}, OWNER);
    await tap(P1, "confirm_problem", "Something's wrong");
    assert.equal((await caseRef(BIZ, P1).get()).data().whatsappState, "needs_reply");
  });

  it("in launch week the problem lands with Laawol, suggesting the business", async () => {
    await setMode("laawol_only");
    await seedConfirm();
    await tap(P1, "confirm_problem", "Something's wrong");
    const conv = (await caseRef("laawol", P1).get()).data();
    assert.equal(conv.suggestedBusinessId, BIZ);
    assert.equal(conv.whatsappState, "needs_reply");
    assert.equal((await caseRef(BIZ, P1).get()).exists, false);
    assert.ok((await messagesOf(caseRef("laawol", P1))).some((m) => m.metadata?.senderProblem === true));
  });

  it("ignores a button that answers nothing of ours, or another number's message", async () => {
    await seedConfirm();
    // Replying to an unknown message: an ordinary inbound (text "OK ✓").
    await tap(P1, "confirm_ok", "OK ✓", {replyTo: "wamid.unknown"});
    assert.equal((await db.collection("containerLines").doc(LINE).get()).data().senderConfirmation.status, "asked");
    assert.equal((await caseRef(BIZ, P1).get()).exists, true);
    // Another number cannot answer for the sender.
    await tap(P3, "confirm_ok", "OK ✓");
    assert.equal((await db.collection("containerLines").doc(LINE).get()).data().senderConfirmation.status, "asked");
  });

  it("files a photo sent with the package code on the package, and routes the number by it", async () => {
    const {storageBucketName} = require("../project_config");
    await db.collection("containerLines").doc("line-photo").set({businessId: BIZ, trackingCode: CODE,
      customerPhoneE164: "+224621009999", customerPhone: "+224621009999"});
    // P3 is unknown to everyone: the code names the business.
    await inbound(P3, "", {message: {type: "image", image: {id: "media-1", mime_type: "image/jpeg",
      caption: "Colis CL-K7M4P2 reçu"}}});
    const conv = (await caseRef(BIZ, P3).get()).data();
    assert.equal(conv.businessId, BIZ);
    const line = (await db.collection("containerLines").doc("line-photo").get()).data();
    assert.equal(line.customerPhotos.length, 1);
    const [photo] = line.customerPhotos;
    assert.match(photo.path, /^packagePhotos\/wa-test-biz\/wa\/[0-9a-f]{24}\.jpg$/);
    assert.equal(photo.phone, P3);
    assert.equal(photo.caseId, caseRef(BIZ, P3).id);
    assert.ok(photo.atMs > 0);
    const [exists] = await admin.storage().bucket(storageBucketName()).file(photo.path).exists();
    assert.equal(exists, true);
    const msgs = await messagesOf(caseRef(BIZ, P3));
    const note = msgs.find((m) => m.content === "Photo filed on package CL-K7M4P2.");
    assert.equal(note.metadata.note, true);
    assert.equal(note.metadata.photoPath, photo.path);
    assert.equal(msgs[0].messageType, "image");
    // Past the cap the oldest entry leaves the list; the file stays.
    await db.collection("containerLines").doc("line-photo").set({customerPhotos: Array.from({length: 10},
        (_, i) => ({path: `packagePhotos/wa-test-biz/wa/old${String(i).padStart(21, "0")}.jpg`,
          phone: P3, atMs: i + 1, caseId: "x"}))}, {merge: true});
    await inbound(P3, "", {message: {type: "image", image: {id: "media-2", mime_type: "image/jpeg",
      caption: CODE}}});
    const capped = (await db.collection("containerLines").doc("line-photo").get()).data().customerPhotos;
    assert.equal(capped.length, 10);
    assert.ok(!capped.some((p) => p.path.endsWith("old000000000000000000000.jpg")));
    assert.match(capped[9].path, /^packagePhotos\/wa-test-biz\/wa\/[0-9a-f]{24}\.jpg$/);
    // A photo without a code, or a code nobody has, files nothing.
    await inbound(P3, "", {message: {type: "image", image: {id: "media-3", mime_type: "image/jpeg",
      caption: "CL-ZZZZZZ"}}});
    assert.equal((await db.collection("containerLines").doc("line-photo").get()).data().customerPhotos.length, 10);
  });
});
