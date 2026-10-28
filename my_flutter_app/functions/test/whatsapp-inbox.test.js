/* eslint-disable max-len */
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {describe, it} = require("node:test");

const wa = require("../whatsapp_inbox");

const DAY = 24 * 60 * 60 * 1000;

function webhook(value) {
  return {object: "whatsapp_business_account",
    entry: [{id: "992521863149970", changes: [{field: "messages", value}]}]};
}

describe("reading Meta's webhook", () => {
  it("flattens text, media, buttons and statuses", () => {
    const body = webhook({
      metadata: {phone_number_id: "1475234702329161"},
      contacts: [{wa_id: "224621000001", profile: {name: "Aissatou"}}],
      messages: [
        {from: "224621000001", id: "wamid.A", timestamp: "1793200000",
          type: "text", text: {body: "Bonjour, mon colis ?"}},
        {from: "224621000001", id: "wamid.B", timestamp: "1793200001",
          type: "audio", audio: {id: "media1", mime_type: "audio/ogg; codecs=opus", voice: true}},
        {from: "224621000001", id: "wamid.C", timestamp: "1793200002",
          type: "image", image: {id: "media2", mime_type: "image/jpeg", caption: "carton abîmé"},
          context: {id: "wamid.OUR"}},
        {from: "224621000001", id: "wamid.D", timestamp: "1793200003",
          type: "button", button: {text: "Yes"}},
      ],
      statuses: [{id: "wamid.OUT", status: "failed", recipient_id: "224621000002",
        timestamp: "1793200004", errors: [{code: 131026, title: "Message undeliverable"}]}],
    });
    const {messages, statuses} = wa.parseWebhook(body);
    assert.equal(messages.length, 4);
    assert.deepEqual(
        {from: messages[0].from, name: messages[0].profileName, text: messages[0].text,
          at: messages[0].timestampMs, phoneNumberId: messages[0].phoneNumberId},
        {from: "+224621000001", name: "Aissatou", text: "Bonjour, mon colis ?",
          at: 1793200000000, phoneNumberId: "1475234702329161"});
    assert.deepEqual(messages[1].media, {id: "media1", mimeType: "audio/ogg; codecs=opus",
      fileName: "", voice: true});
    assert.equal(messages[2].text, "carton abîmé");
    assert.equal(messages[2].replyToWamid, "wamid.OUR");
    assert.equal(messages[3].text, "Yes");
    assert.deepEqual(statuses, [{wamid: "wamid.OUT", status: "failed",
      recipient: "+224621000002", timestampMs: 1793200004000, errorCode: 131026,
      errorTitle: "Message undeliverable"}]);
  });

  it("ignores anything that is not a WhatsApp messages change", () => {
    assert.deepEqual(wa.parseWebhook({object: "page", entry: []}), {messages: [], statuses: []});
    assert.deepEqual(wa.parseWebhook({object: "whatsapp_business_account",
      entry: [{changes: [{field: "account_update", value: {}}]}]}), {messages: [], statuses: []});
    assert.deepEqual(wa.parseWebhook(null), {messages: [], statuses: []});
  });
});

describe("the webhook's signature and verify token", () => {
  const secret = "app-secret-123";
  const raw = Buffer.from(JSON.stringify({object: "whatsapp_business_account"}));
  const good = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");

  it("accepts Meta's HMAC and refuses anything else", () => {
    assert.equal(wa.verifySignature(raw, good, secret), true);
    assert.equal(wa.verifySignature(raw, good, "other"), false);
    assert.equal(wa.verifySignature(Buffer.from("{}"), good, secret), false);
    assert.equal(wa.verifySignature(raw, "", secret), false);
    assert.equal(wa.verifySignature(raw, good, "unset"), false);
    assert.equal(wa.verifySignature(raw, "sha256=short", secret), false);
  });

  it("derives a stable verify token from the secret", () => {
    assert.equal(wa.verifyTokenFor(secret).length, 32);
    assert.equal(wa.verifyTokenFor(secret), wa.verifyTokenFor(secret));
    assert.notEqual(wa.verifyTokenFor(secret), wa.verifyTokenFor("x"));
    assert.equal(wa.verifyTokenFor("unset"), "");
  });
});

describe("routing a customer's message", () => {
  const now = Date.UTC(2026, 9, 28);
  const nensona = {businessId: "nensona", businessName: "Nensona"};
  const keren = {businessId: "keren", businessName: "Keren"};

  it("goes to the business that messaged them most recently", () => {
    const r = wa.routeInbound({mode: "businesses", nowMs: now, candidates: [
      {...nensona, lastSentAtMs: now - 5 * DAY}, {...keren, lastSentAtMs: now - 1 * DAY}]});
    assert.equal(r.kind, "business");
    assert.equal(r.businessId, "keren");
    assert.equal(r.laawolOnly, false);
  });

  it("asks the customer when nobody wrote in 30 days and several businesses know them", () => {
    const r = wa.routeInbound({mode: "businesses", nowMs: now, candidates: [
      {...nensona, lastSentAtMs: now - 40 * DAY}, {...keren, lastSentAtMs: 0}]});
    assert.equal(r.kind, "ask");
    assert.deepEqual(r.options.map((o) => o.businessId), ["nensona", "keren"]);
  });

  it("goes to the only business that knows them, even if it is quiet", () => {
    const r = wa.routeInbound({mode: "businesses", nowMs: now,
      candidates: [{...nensona, lastSentAtMs: 0}, {...nensona, lastSentAtMs: 0}]});
    assert.equal(r.kind, "business");
    assert.equal(r.businessId, "nensona");
  });

  it("sends unknown numbers to Laawol, and flags launch week", () => {
    assert.equal(wa.routeInbound({mode: "businesses", nowMs: now}).kind, "laawol");
    const launch = wa.routeInbound({mode: "laawol_only", nowMs: now,
      candidates: [{...nensona, lastSentAtMs: now}]});
    assert.equal(launch.businessId, "nensona");
    assert.equal(launch.laawolOnly, true);
    // Unknown mode = the safe one.
    assert.equal(wa.routeInbound({nowMs: now}).laawolOnly, true);
  });

  it("reads the customer's pick by number or name", () => {
    const options = [nensona, keren];
    assert.equal(wa.choiceFromReply("2", options), "keren");
    assert.equal(wa.choiceFromReply(" 1 ", options), "nensona");
    assert.equal(wa.choiceFromReply("C'est Nensona", options), "nensona");
    assert.equal(wa.choiceFromReply("3", options), "");
    assert.equal(wa.choiceFromReply("bonjour", options), "");
  });
});

describe("STOP, language and the 24 hour window", () => {
  it("recognises stop and start words as the whole message only", () => {
    for (const word of ["STOP", "Stop.", "arrête", "ARRET", "désabonner", "unsubscribe"]) {
      assert.equal(wa.stopOrStart(word), "stop", word);
    }
    for (const word of ["START", "Démarrer", "reprendre"]) {
      assert.equal(wa.stopOrStart(word), "start", word);
    }
    assert.equal(wa.stopOrStart("please don't stop my barrel"), "");
    assert.equal(wa.stopOrStart(""), "");
  });

  it("answers in the customer's language", () => {
    assert.equal(wa.detectLanguage("Bonjour, mon colis est arrivé ?", "+15551234567"), "fr");
    assert.equal(wa.detectLanguage("Hello, where is my barrel?", "+224621000000"), "en");
    assert.equal(wa.detectLanguage("👍", "+224621000000"), "fr");
    assert.equal(wa.detectLanguage("👍", "+13475551234"), "en");
    assert.equal(wa.detectLanguage("ok", "+13475551234", "fr"), "fr");
  });

  it("allows free text only within 24 hours of the customer's last message", () => {
    const now = 1000000000000;
    assert.equal(wa.withinWindow(now - DAY + 1000, now), true);
    assert.equal(wa.withinWindow(now - DAY, now), false);
    assert.equal(wa.withinWindow(0, now), false);
  });
});

describe("opening hours", () => {
  const hours = {office1: {
    mon: {open: true, from: "08:00", to: "19:00"},
    sun: {open: false, from: "", to: ""},
  }};
  it("is open inside the hours in the business's zone, closed outside", () => {
    // Monday 2026-10-26 10:00 New York = 14:00 UTC.
    assert.equal(wa.isOpenNow(hours, "America/New_York", Date.UTC(2026, 9, 26, 14)), true);
    // Monday 20:00 New York.
    assert.equal(wa.isOpenNow(hours, "America/New_York", Date.UTC(2026, 9, 27, 0)), false);
    // Sunday.
    assert.equal(wa.isOpenNow(hours, "America/New_York", Date.UTC(2026, 9, 25, 15)), false);
  });
  it("says nothing when the business set no hours", () => {
    assert.equal(wa.isOpenNow({}, "America/New_York"), null);
    assert.equal(wa.isOpenNow(undefined, "America/New_York"), null);
  });
});

describe("what customers read", () => {
  it("has every automatic reply in both languages", () => {
    for (const kind of ["received", "closed", "laawol", "ask", "ask_again", "stopped", "started"]) {
      const en = wa.autoReplyText({kind, lang: "en", businessName: "Nensona",
        options: [{businessName: "Nensona"}, {businessName: "Keren"}]});
      const fr = wa.autoReplyText({kind, lang: "fr", businessName: "Nensona",
        options: [{businessName: "Nensona"}, {businessName: "Keren"}]});
      assert.ok(en && fr && en !== fr, kind);
    }
    assert.match(wa.autoReplyText({kind: "received", businessName: "Nensona",
      trackingUrl: "https://customer.laawoldigital.com/t/CL-1"}), /Nensona[\s\S]*\/t\/CL-1/);
    assert.match(wa.autoReplyText({kind: "ask", options: [{businessName: "A"}, {businessName: "B"}]}),
        /1 - A\n2 - B/);
    assert.equal(wa.autoReplyText({kind: "nope"}), "");
  });

  it("signs replies with the person and the business", () => {
    assert.equal(wa.senderLabel({fullName: "Mamadou Diallo", businessName: "Nensona"}), "Mamadou (Nensona)");
    assert.equal(wa.senderLabel({chatDisplayName: "Mama", fullName: "Mamadou Diallo",
      businessName: "Nensona"}), "Mama (Nensona)");
    assert.equal(wa.senderLabel({fullName: "Hassimiou Niane", isLaawol: true}), "Hassimiou (Laawol)");
    assert.equal(wa.senderLabel({businessName: "Nensona"}), "Nensona");
    assert.equal(wa.signedText("Mamadou (Nensona)", " Loaded Friday "), "*Mamadou (Nensona):* Loaded Friday");
  });
});

describe("what we send", () => {
  it("builds free-form text and media bodies", () => {
    assert.deepEqual(wa.freeFormBody({phone: "+224 621 000 001", text: "hi"}), {
      messaging_product: "whatsapp", recipient_type: "individual", to: "224621000001",
      type: "text", text: {preview_url: true, body: "hi"}});
    assert.equal(wa.freeFormBody({phone: "+1", text: " "}), null);
    assert.equal(wa.freeFormBody({phone: "", text: "x"}), null);
    assert.deepEqual(wa.freeFormBody({phone: "+1555", kind: "audio", link: "https://x/a.ogg"}).audio,
        {link: "https://x/a.ogg"});
    assert.deepEqual(wa.freeFormBody({phone: "+1555", kind: "document", link: "https://x/f.pdf",
      fileName: "receipt.pdf", caption: "Receipt"}).document,
    {link: "https://x/f.pdf", filename: "receipt.pdf", caption: "Receipt"});
    assert.equal(wa.freeFormBody({phone: "+1555", kind: "image"}), null);
    assert.equal(wa.waKindForMessageType("voice"), "audio");
    assert.equal(wa.waKindForMessageType("file"), "document");
    assert.equal(wa.messageTypeForMime("audio/ogg"), "voice");
    assert.equal(wa.messageTypeForMime("application/pdf"), "file");
  });

  it("fills the waiting template's five variables in order", () => {
    const body = wa.waitingTemplateBody({phone: "+224621000001", name: "Aissatou",
      businessName: "Nensona", reference: "CL-4F7K"});
    assert.equal(body.template.name, "message_waiting_2lang");
    assert.deepEqual(body.template.components[0].parameters.map((p) => p.text),
        ["Aissatou", "Nensona", "CL-4F7K", "Nensona", "CL-4F7K"]);
    assert.deepEqual(wa.waitingTemplateBody({phone: "+1555"}).template.components[0]
        .parameters.map((p) => p.text), ["there", "Laawol", "-", "Laawol", "-"]);
  });

  it("only moves delivery ticks forward", () => {
    assert.equal(wa.nextDeliveryStatus("", "sent"), "sent");
    assert.equal(wa.nextDeliveryStatus("sent", "delivered"), "delivered");
    assert.equal(wa.nextDeliveryStatus("read", "delivered"), "read");
    assert.equal(wa.nextDeliveryStatus("delivered", "sent"), "delivered");
    assert.equal(wa.nextDeliveryStatus("delivered", "failed"), "failed");
    assert.equal(wa.nextDeliveryStatus("read", "failed"), "read");
    assert.equal(wa.nextDeliveryStatus("sent", "weird"), "sent");
  });

  it("names conversations per inbox and number", () => {
    assert.equal(wa.conversationId("nensona_auto", "+224 621-000-001"), "wa_nensona_auto_224621000001");
    assert.equal(wa.conversationId("", "+1555"), "wa_laawol_1555");
  });
});
