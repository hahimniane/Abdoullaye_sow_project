"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  CHANNEL,
  RECEIPT_REFUSAL,
  RESEND_GUARD_MS,
  SEND_MODE,
  autoReceiptRowId,
  autoReceiptRowWanted,
  receiptRowFields,
  receiptSmsBody,
  receiptTooSoon,
  senderOf,
  senderPhoneOf,
  sendModeOf,
  smsConfigured,
  validSendMode,
} = require("../package_receipt_send");

describe("how a business's package receipts go", () => {
  it("is the button unless the business chose auto", () => {
    assert.equal(sendModeOf({}), "button");
    assert.equal(sendModeOf(null), "button");
    assert.equal(sendModeOf({packageReceiptSettings: {}}), "button");
    assert.equal(sendModeOf({packageReceiptSettings: {sendMode: "auto"}}),
        "auto");
    assert.equal(sendModeOf({packageReceiptSettings: {sendMode: "bogus"}}),
        "button");
  });

  it("accepts only button and auto", () => {
    assert.equal(validSendMode("auto"), "auto");
    assert.equal(validSendMode("button"), "button");
    for (const bad of ["", "AUTO", "manual", null, undefined, 1, ["auto"]]) {
      assert.equal(validSendMode(bad), "", String(bad));
    }
    assert.deepEqual(Object.values(SEND_MODE), ["button", "auto"]);
  });
});

describe("the automatic receipt row", () => {
  const base = {sendMode: "auto", update: "received", role: "sender",
    photoState: "attached"};

  it("is queued only in auto mode, for the sender, after the photo", () => {
    assert.equal(autoReceiptRowWanted(base), true);
    assert.equal(autoReceiptRowWanted({...base, sendMode: "button"}), false);
    assert.equal(autoReceiptRowWanted({...base, role: "receiver"}), false);
    assert.equal(autoReceiptRowWanted({...base, update: "confirm"}), false);
    assert.equal(autoReceiptRowWanted({...base, update: "shipped"}), false);
    // No photo header: the receipt rides on the confirmation itself.
    assert.equal(autoReceiptRowWanted({...base, photoState: ""}), false);
    assert.equal(autoReceiptRowWanted({...base, photoState: "fallback"}),
        false);
  });

  it("has one fixed id per package", () => {
    assert.equal(autoReceiptRowId("abc123"), "abc123_receipt_auto");
    assert.equal(autoReceiptRowId("a/b c"), "abc_receipt_auto");
  });
});

describe("the one-minute guard", () => {
  it("holds the same channel for 60 seconds", () => {
    const now = 1000000;
    assert.equal(RESEND_GUARD_MS, 60000);
    assert.equal(receiptTooSoon(now - 59999, now), true);
    assert.equal(receiptTooSoon(now - 60000, now), false);
    assert.equal(receiptTooSoon(0, now), false);
    assert.equal(receiptTooSoon(undefined, now), false);
  });
});

describe("texting", () => {
  const sid = `AC${"0123456789abcdef".repeat(2)}`;

  it("is set up only with a real account SID, a token and a number", () => {
    assert.equal(smsConfigured({sid, token: "t", from: "+15550001111"}),
        true);
    assert.equal(smsConfigured({sid: "ACplaceholder", token: "t",
      from: "+15550001111"}), false);
    assert.equal(smsConfigured({sid: "unset", token: "t", from: "+1"}),
        false);
    assert.equal(smsConfigured({sid, token: "", from: "+15550001111"}),
        false);
    assert.equal(smsConfigured({sid, token: "t", from: " "}), false);
    assert.equal(smsConfigured({}), false);
    assert.equal(smsConfigured(null), false);
  });

  it("writes a short message in both languages with the link", () => {
    const body = receiptSmsBody({businessName: "Dala Shipping",
      code: "CL-K7M4P2", link: "https://laawoldigital.com/d?view=x"});
    assert.equal(body, "Dala Shipping: your package receipt CL-K7M4P2 / " +
      "votre reçu de colis CL-K7M4P2 : https://laawoldigital.com/d?view=x " +
      "Reply STOP to opt out, HELP for help.");
    assert.ok(body.length < 240);
    // The toll-free registration's sample ends this way: every text must.
    assert.match(receiptSmsBody({link: "https://x.test"}),
        / Reply STOP to opt out, HELP for help\.$/);
    assert.match(receiptSmsBody({link: "https://x.test"}), /^Laawol: /);
  });
});

describe("the sender", () => {
  const line = {customerName: "Fatou Diallo", customerPhone: "6465550100"};

  it("is reached on an international number, a US business's local one as +1",
      () => {
        assert.equal(senderPhoneOf(line, "United States"), "+16465550100");
        assert.equal(senderPhoneOf({customerPhone: "+224620000000"}, ""),
            "+224620000000");
        assert.equal(senderPhoneOf(line, "Guinea"), "");
        assert.equal(senderPhoneOf({}, "United States"), "");
      });

  it("is shown as the line has them", () => {
    assert.deepEqual(senderOf({...line, customerEmail: "fatou@example.test"}),
        {name: "Fatou Diallo", phone: "6465550100",
          email: "fatou@example.test"});
    assert.deepEqual(senderOf({}), {name: "", phone: "", email: ""});
  });
});

describe("the receipt rows", () => {
  it("is a sender-only receipt row, a text one marked channel sms", () => {
    const args = {businessId: "b1", containerId: "c1", lineId: "l1",
      trackingCode: "CL-1", businessName: "Dala", name: "Fatou",
      phone: "+16465550100", trigger: "button", requestedByUid: "u1"};
    assert.deepEqual(receiptRowFields({...args, channel: CHANNEL.WHATSAPP}), {
      businessId: "b1", containerId: "c1", lineId: "l1", update: "receipt",
      role: "sender", name: "Fatou", phone: "+16465550100",
      trackingCode: "CL-1", businessName: "Dala", trigger: "button",
      requestedByUid: "u1"});
    const sms = receiptRowFields({...args, channel: CHANNEL.SMS});
    assert.equal(sms.channel, "sms");
    assert.equal(receiptRowFields({...args, trigger: "auto",
      requestedByUid: ""}).requestedByUid, undefined);
    assert.equal(receiptRowFields({...args, trigger: "x"}).trigger, "button");
  });

  it("names every refusal the screens handle", () => {
    for (const reason of ["receipt_no_sender_phone", "receipt_sms_not_set_up",
      "receipt_too_soon", "receipt_line_gone", "receipt_whatsapp_off"]) {
      assert.ok(RECEIPT_REFUSAL[reason], reason);
    }
  });
});
