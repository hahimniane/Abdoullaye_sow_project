"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const sms = require("../sms_fallback");

const LINK = "https://customer.laawoldigital.com/t/CL-K7M4P2";
const TAIL = "Reply STOP to opt out, HELP for help.";

const row = (extra = {}) => ({role: "sender", update: "received",
  phone: "+16465550100", channel: undefined, ...extra});
const ready = {smsReady: true, switchOn: true};
const wanted = (rowExtra = {}, args = {}) => sms.smsFallbackWanted({
  row: row(rowExtra), business: {}, ...ready, ...args});

describe("isUsNumber", () => {
  it("accepts +1 and ten digits, however it is spaced", () => {
    for (const phone of ["+16465550100", "+1 646 555 0100",
      "+1 (646) 555-0100"]) {
      assert.equal(sms.isUsNumber(phone), true, phone);
    }
  });
  it("refuses everything else", () => {
    for (const phone of ["+224620000000", "6465550100", "16465550100",
      "+1646555010", "+164655501001", "", null, undefined]) {
      assert.equal(sms.isUsNumber(phone), false, String(phone));
    }
  });
});

describe("fallbackUpdateFor", () => {
  it("texts confirm as received and the five others as themselves", () => {
    assert.equal(sms.fallbackUpdateFor("confirm"), "received");
    for (const update of ["received", "shipped", "arrived", "delivered",
      "receipt"]) {
      assert.equal(sms.fallbackUpdateFor(update), update);
    }
  });
  it("is empty for anything that is not a text", () => {
    for (const update of ["at_port", "", "nope", null]) {
      assert.equal(sms.fallbackUpdateFor(update), "");
    }
  });
});

describe("smsFallbackBody", () => {
  const body = (update, extra = {}) => sms.smsFallbackBody({update,
    businessName: "Dala Shipping", code: "CL-K7M4P2", ...extra});
  it("says each update in both languages with the link and how to stop",
      () => {
        assert.equal(body("received"), "Dala Shipping: we received your " +
          `package CL-K7M4P2 / colis recu. Track: ${LINK} ${TAIL}`);
        assert.equal(body("confirm"), body("received"));
        assert.equal(body("shipped"), "Dala Shipping: your package " +
          `CL-K7M4P2 has left / colis parti. Track: ${LINK} ${TAIL}`);
        assert.equal(body("arrived"), "Dala Shipping: your package " +
          "CL-K7M4P2 is ready for pickup / pret a recuperer. Track: " +
          `${LINK} ${TAIL}`);
        assert.equal(body("delivered"), "Dala Shipping: your package " +
          `CL-K7M4P2 was delivered / colis remis. Track: ${LINK} ${TAIL}`);
      });
  it("uses the receipt's own words and link for a receipt", () => {
    const out = body("receipt", {receiptLink: "https://x.test/d?p=1"});
    assert.equal(out, "Dala Shipping: your package receipt CL-K7M4P2 / " +
      `votre reçu de colis CL-K7M4P2 : https://x.test/d?p=1 ${TAIL}`);
  });
  it("keeps the business name to 40 characters without accents", () => {
    const out = body("received", {businessName: "Société Générale des " +
      "Expéditions de Conakry et Dakar"});
    assert.ok(out.startsWith("Societe Generale des Expeditions de Cona: "));
  });
  it("is empty for an update with no text, and survives no code", () => {
    assert.equal(body("at_port"), "");
    assert.equal(sms.smsFallbackBody({update: "received",
      businessName: ""}), "Laawol: we received your package / colis recu. " +
      `Track: https://customer.laawoldigital.com/t/ ${TAIL}`);
  });
});

describe("smsFallbackSwitchOn", () => {
  it("is on only for `on`, any case, trimmed", () => {
    for (const value of ["on", "ON", " On "]) {
      assert.equal(sms.smsFallbackSwitchOn({SMS_FALLBACK: value}), true);
    }
    for (const value of [undefined, "", "off", "true", "1", "yes"]) {
      assert.equal(sms.smsFallbackSwitchOn({SMS_FALLBACK: value}), false);
    }
    assert.equal(sms.smsFallbackSwitchOn({}), false);
  });
});

describe("smsFallbackWanted", () => {
  it("texts a US sender's failed update", () => {
    for (const update of ["received", "confirm", "shipped", "arrived",
      "delivered", "receipt"]) {
      assert.deepEqual(wanted({update}),
          {send: true, reason: "", record: false}, update);
    }
  });
  it("never texts the receiver, a text, a row already texted, or news that " +
      "is not a message", () => {
    assert.deepEqual(wanted({role: "receiver"}),
        {send: false, reason: "not_sender", record: false});
    assert.deepEqual(wanted({channel: "sms", update: "receipt"}),
        {send: false, reason: "channel_sms", record: false});
    assert.deepEqual(wanted({smsFallback: {status: "sent"}}),
        {send: false, reason: "already_texted", record: false});
    assert.deepEqual(wanted({update: "at_port"}),
        {send: false, reason: "not_a_text_update", record: false});
  });
  it("records a refusal for a number outside the US and a business that " +
      "turned it off", () => {
    assert.deepEqual(wanted({phone: "+224620000000"}),
        {send: false, reason: "not_us_number", record: true});
    assert.deepEqual(wanted({}, {business: {packageTextFallback: false}}),
        {send: false, reason: "business_off", record: true});
    // Missing or true is on.
    assert.equal(wanted({}, {business: {packageTextFallback: true}}).send,
        true);
  });
  it("does not record when texting is simply not on yet", () => {
    assert.deepEqual(wanted({}, {switchOn: false}),
        {send: false, reason: "switched_off", record: false});
    assert.deepEqual(wanted({}, {smsReady: false}),
        {send: false, reason: "not_configured", record: false});
    assert.deepEqual(wanted({}, {switchOn: false, smsReady: false}),
        {send: false, reason: "switched_off", record: false});
    // Dark means dark: while it is off, not even a reason that would be
    // written (a number abroad, a business that said no) is recorded.
    assert.deepEqual(wanted({phone: "+224620000000"}, {switchOn: false}),
        {send: false, reason: "switched_off", record: false});
    assert.deepEqual(wanted({phone: "+224620000000"}, {smsReady: false}),
        {send: false, reason: "not_configured", record: false});
    assert.deepEqual(wanted({}, {switchOn: false,
      business: {packageTextFallback: false}}),
    {send: false, reason: "switched_off", record: false});
  });
  it("is safe with nothing", () => {
    assert.equal(sms.smsFallbackWanted().send, false);
  });
});

describe("smsFallbackRecord", () => {
  it("records a sent text with its sid", () => {
    assert.deepEqual(sms.smsFallbackRecord(
        {ok: true, skipped: false, sid: "SM1", error: ""}, 5),
    {status: "sent", reason: "", twilioSid: "SM1", atMs: 5});
  });
  it("maps Twilio's STOP refusal (21610) to opted_out", () => {
    assert.deepEqual(sms.smsFallbackRecord({ok: false, skipped: false,
      sid: "", error: "Twilio answered 400", code: 21610}, 6),
    {status: "failed", reason: "opted_out", twilioSid: "", atMs: 6});
  });
  it("calls any other refusal twilio_error", () => {
    for (const result of [{ok: false, skipped: false, error: "x", code: 0},
      {ok: false, skipped: false, error: "x", code: 21211},
      {ok: false, skipped: false, error: "network"}]) {
      assert.equal(sms.smsFallbackRecord(result, 1).reason, "twilio_error");
    }
  });
  it("calls an unattempted text skipped", () => {
    assert.deepEqual(sms.smsFallbackRecord({ok: false, skipped: true,
      error: "not_configured"}, 7),
    {status: "skipped", reason: "not_configured", twilioSid: "", atMs: 7});
  });
  it("builds a skip record", () => {
    assert.deepEqual(sms.smsFallbackSkipRecord("business_off", 9),
        {status: "skipped", reason: "business_off", twilioSid: "", atMs: 9});
  });
});

describe("withSmsResult", () => {
  const summary = () => ({update: "received", atMs: 1, results: [
    {role: "sender", status: "failed", delivery: "failed"},
    {role: "receiver", status: "sent"}]});
  it("adds sms to the sender's entry and leaves the failure as it was", () => {
    const out = sms.withSmsResult(summary(), "confirm", "sender", "sent");
    assert.deepEqual(out.results, [{role: "sender", status: "failed",
      delivery: "failed", sms: "sent"}, {role: "receiver", status: "sent"}]);
    assert.equal(out.atMs, 1);
  });
  it("changes nothing for a receipt, another update, a missing role or " +
      "the same answer", () => {
    assert.equal(sms.withSmsResult(summary(), "receipt", "sender", "sent"),
        null);
    assert.equal(sms.withSmsResult(summary(), "shipped", "sender", "sent"),
        null);
    assert.equal(sms.withSmsResult(summary(), "received", "owner", "sent"),
        null);
    assert.equal(sms.withSmsResult(null, "received", "sender", "sent"), null);
    assert.equal(sms.withSmsResult(summary(), "received", "sender", "maybe"),
        null);
    const done = sms.withSmsResult(summary(), "received", "sender", "failed");
    assert.equal(sms.withSmsResult(done, "received", "sender", "failed"),
        null);
  });
});
