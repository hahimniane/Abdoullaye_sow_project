import assert from "node:assert/strict";
import test from "node:test";

import {
  RECEIPT_ERROR_MESSAGES,
  receiptErrorText,
  receiptMailtoHref,
  receiptMessageBody,
  receiptPhoneTarget,
  receiptSendMode,
  receiptSendState,
  receiptSmsHref,
} from "./package-receipt.ts";
import { TEXT_TRANSLATIONS } from "./french-dom.ts";

test("a missing or unknown send mode is the button", () => {
  assert.equal(receiptSendMode(null), "button");
  assert.equal(receiptSendMode({}), "button");
  assert.equal(receiptSendMode({ packageReceiptSettings: { sendMode: "weird" } }), "button");
  assert.equal(receiptSendMode({ packageReceiptSettings: { sendMode: "auto" } }), "auto");
});

test("the phone target keeps a leading plus and drops punctuation", () => {
  assert.equal(receiptPhoneTarget("+1 (347) 555-0100"), "+13475550100");
  assert.equal(receiptPhoneTarget("3475550100"), "3475550100");
  assert.equal(receiptPhoneTarget("12"), "");
});

test("sms and mailto links encode the body and the link", () => {
  const body = receiptMessageBody("https://x.test/r?a=1&b=2", "Awa", "Test Shipping");
  const sms = receiptSmsHref("+1 347 555 0100", body);
  assert.ok(sms.startsWith("sms:+13475550100?body="));
  assert.ok(sms.includes(encodeURIComponent("https://x.test/r?a=1&b=2")));
  assert.ok(!sms.includes("&b=2"));
  assert.ok(body.includes("Bonjour Awa") && body.includes("Hello Awa"));
  const mail = receiptMailtoHref("a.b@mail.test", "Reçu & co", body);
  assert.ok(mail.startsWith("mailto:a.b@mail.test?subject=Re%C3%A7u%20%26%20co&body="));
  assert.ok(!mail.includes("+"));
});

test("refusals map to plain sentences and every one has a French entry", () => {
  for (const reason of ["receipt_no_sender_phone", "receipt_sms_not_set_up", "receipt_too_soon", "receipt_line_gone", "receipt_whatsapp_off"]) {
    assert.ok(RECEIPT_ERROR_MESSAGES[reason], reason);
    assert.ok(TEXT_TRANSLATIONS[RECEIPT_ERROR_MESSAGES[reason]], `French for ${reason}`);
    assert.equal(receiptErrorText({ details: { reason } }), RECEIPT_ERROR_MESSAGES[reason]);
  }
  assert.equal(receiptErrorText(new Error("x")), "Could not send the receipt. Try again.");
});

test("send state: nothing, waiting, sent, failed, not on WhatsApp", () => {
  const at = Date.UTC(2026, 10, 23, 12, 0);
  assert.equal(receiptSendState([]).kind, "none");
  assert.equal(receiptSendState([{ update: "received", status: "sent", atMs: at }]).kind, "none");
  assert.equal(receiptSendState([{ update: "receipt", role: "receiver", status: "sent", atMs: at }]).kind, "none");
  assert.equal(receiptSendState([{ update: "receipt", role: "sender", status: "queued", atMs: at }]).text, "Waiting…");
  const sent = receiptSendState([{ update: "receipt", role: "sender", status: "sent", atMs: at }]);
  assert.equal(sent.kind, "sent");
  assert.match(sent.text, /^Receipt sent on WhatsApp Nov 23, 2026, \d{1,2}:\d{2} (AM|PM)$/);
  assert.equal(receiptSendState([{ update: "receipt", role: "sender", status: "failed", errorCode: 131026, atMs: at }]).kind, "not_on_whatsapp");
  assert.equal(receiptSendState([{ update: "receipt", role: "sender", status: "failed", atMs: at }]).kind, "failed");
});

test("send state: the newest row wins and an sms row reads as text", () => {
  const rows = [
    { update: "receipt", role: "sender", status: "failed", errorCode: 131026, atMs: 1000 },
    { update: "receipt", role: "sender", channel: "sms", status: "sent", atMs: 2000 },
  ];
  const state = receiptSendState(rows);
  assert.equal(state.channel, "sms");
  assert.match(state.text, /^Receipt sent by text/);
});

test("French status uses the same month-first moment", () => {
  const state = receiptSendState([{ update: "receipt", role: "sender", status: "sent", atMs: Date.UTC(2026, 10, 23, 12, 0) }], "fr");
  assert.match(state.text, /^Reçu envoyé sur WhatsApp le /);
});
