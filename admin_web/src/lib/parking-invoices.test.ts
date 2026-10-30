import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { TEXT_TRANSLATIONS, ATTRIBUTE_TRANSLATIONS, translateValue } from "./french-dom.ts";
import {
  PARKING_INVOICES_COPY,
  PARKING_INVOICES_REFUSALS,
  PAYMENT_INSTRUCTIONS_MAX,
  defaultInvoiceSelection,
  invoiceMessagesByCustomer,
  invoiceMessagesFilters,
  invoiceMonthKey,
  invoiceResultText,
  invoiceRunText,
  invoiceSelectionText,
  invoiceSendText,
  invoicesOfferedFor,
  invoicesPreviewRequest,
  invoicesSendRequest,
  newYorkMonthKey,
  parkingInvoiceRefusalText,
  parseInvoicePreview,
  parseInvoiceResult,
  paymentInstructionsCanSave,
  paymentInstructionsOf,
  selectAllInvoices,
  setPaymentInstructionsRequest,
} from "./parking-invoices.ts";
import { PARKING_MESSAGE_KIND_LABEL, PARKING_MESSAGE_STATE_LABEL, PARKING_WHATSAPP_REFUSALS, parkingMessageLine } from "./parking-whatsapp.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const component = read("../components/business/parking-invoices.tsx");
const monthEnd = read("../components/business/parking-month-end.tsx");
const profile = read("../components/business/profile-support-people.tsx");
const panels = read("../components/business/operations-panels.tsx");

// ---------------------------------------------------------------------------
// Payment instructions
// ---------------------------------------------------------------------------

test("the payment instructions are the business's text, trimmed and within the limit", () => {
  assert.equal(PAYMENT_INSTRUCTIONS_MAX, 300);
  assert.equal(paymentInstructionsOf(null), "");
  assert.equal(paymentInstructionsOf({}), "");
  assert.equal(paymentInstructionsOf({ paymentInstructions: "  Pay at the office  " }), "Pay at the office");
  assert.equal(paymentInstructionsOf({ paymentInstructions: "x".repeat(500) }).length, 300);
  assert.deepEqual(setPaymentInstructionsRequest("biz1", "  Zelle 347-555-0100  "), {
    businessId: "biz1",
    action: "set_payment_instructions",
    text: "Zelle 347-555-0100",
  });
  // Clearing the text is a save of "".
  assert.deepEqual(setPaymentInstructionsRequest("biz1", "   "), { businessId: "biz1", action: "set_payment_instructions", text: "" });
});

test("a draft can be saved only when it changed and fits", () => {
  assert.equal(paymentInstructionsCanSave("Pay at the office", "Pay at the office"), false);
  assert.equal(paymentInstructionsCanSave("  Pay at the office ", "Pay at the office"), false, "spaces alone are no change");
  assert.equal(paymentInstructionsCanSave("Zelle", "Pay at the office"), true);
  assert.equal(paymentInstructionsCanSave("", "Pay at the office"), true, "clearing is allowed");
  assert.equal(paymentInstructionsCanSave("x".repeat(301), ""), false);
  assert.equal(paymentInstructionsCanSave("x".repeat(300), ""), true);
});

test("the field sits under the WhatsApp switch, is the owner's, and saves on its own", () => {
  assert.ok(profile.indexOf("<ParkingWhatsAppSwitch") < profile.indexOf("<PaymentInstructionsField"));
  assert.match(profile, /<PaymentInstructionsField\s+businessId=\{businessId\}\s+business=\{business\}\s+canChange=\{canSetParkingWhatsApp\}/);
  assert.match(component, /updateBusinessParkingEntry/);
  assert.match(component, /setPaymentInstructionsRequest\(businessId, draft\)/);
  assert.match(component, /maxLength=\{PAYMENT_INSTRUCTIONS_MAX\}/);
  assert.match(component, /disabled=\{!canChange \|\| busy \|\| !businessId\}/);
  assert.match(component, /paymentInstructionsOf\(business\)/);
  // A button inside the services form must not submit it.
  assert.match(component, /<button className="lst-btn ghost" type="button" disabled=\{!canSave\}/);
  // An error ends the busy state and reads in words.
  assert.match(component, /finally \{\s*setBusy\(false\);/);
  assert.match(component, /parkingInvoiceRefusalText\(failure\)/);
  assert.match(PARKING_INVOICES_COPY.paymentHint, /^Shown on monthly invoices, e\.g\. Pay at the office, or Zelle/);
});

// ---------------------------------------------------------------------------
// The month that may be invoiced
// ---------------------------------------------------------------------------

test("the month just ended is read on the New York calendar", () => {
  // Nov 1, 02:00 UTC is still Oct 31 in New York: October is not over there yet.
  assert.equal(newYorkMonthKey(new Date("2026-11-01T02:00:00Z")), "2026-10");
  assert.equal(invoiceMonthKey(new Date("2026-11-01T02:00:00Z")), "2026-09");
  assert.equal(invoiceMonthKey(new Date("2026-11-01T05:00:00Z")), "2026-10");
  assert.equal(invoiceMonthKey(new Date("2026-11-03T15:00:00Z")), "2026-10");
  assert.equal(invoiceMonthKey(new Date("2027-01-02T12:00:00Z")), "2026-12", "across the new year");
  const now = new Date("2026-11-03T15:00:00Z");
  assert.equal(invoicesOfferedFor("2026-10", now), true);
  assert.equal(invoicesOfferedFor("2026-09", now), false);
  assert.equal(invoicesOfferedFor("2026-11", now), false, "the month in progress is never invoiced");
  assert.equal(invoicesOfferedFor("", now), false);
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test("the server's refusals read in words, this feature's and the switch's", () => {
  for (const reason of ["invoices_owner_only", "invoice_month_invalid", "payment_instructions_invalid"]) {
    const text = parkingInvoiceRefusalText({ code: "functions/failed-precondition", details: { reason } });
    assert.equal(text, PARKING_INVOICES_REFUSALS[reason]);
    assert.doesNotMatch(text, /_/, "never the raw reason");
  }
  assert.equal(
    parkingInvoiceRefusalText({ code: "functions/failed-precondition", details: { reason: "parking_whatsapp_off" } }),
    PARKING_WHATSAPP_REFUSALS.parking_whatsapp_off,
  );
  assert.equal(parkingInvoiceRefusalText(new Error("INTERNAL: boom")), PARKING_WHATSAPP_REFUSALS.unknown);
  assert.equal(parkingInvoiceRefusalText(undefined), PARKING_WHATSAPP_REFUSALS.unknown);
});

// ---------------------------------------------------------------------------
// The preview, the selection and the send
// ---------------------------------------------------------------------------

const PREVIEW = {
  monthKey: "2026-10",
  run: { status: "ready", preparedAtMs: 1_793_000_000_000, sentAtMs: 0, sentBy: "", recipients: 3, totalDueCents: 45_050, sent: 0, failed: 0, skipped: 0 },
  recipients: [
    { phone: "+12075550101", name: "Awa Diallo", cars: [{ id: "c1", label: "2014 Toyota Corolla" }, { id: "c2", label: "2016 RAV4" }], totalDueCents: 30_000, stillParked: true, alreadySent: false },
    { phone: "+12075550102", name: "Moussa", cars: [{ id: "c3", label: "2019 Honda Civic" }], totalDueCents: 0, stillParked: true, alreadySent: true },
    { phone: "+12075550101", name: "A duplicate number", cars: [], totalDueCents: 5, stillParked: false, alreadySent: false },
    { name: "No phone", cars: [] },
    "not a row",
  ],
};

test("the preview lists each number once with its cars and balance; only the unsent are ticked", () => {
  const preview = parseInvoicePreview(PREVIEW);
  assert.equal(preview.monthKey, "2026-10");
  assert.deepEqual(preview.recipients.map((r) => r.phone), ["+12075550101", "+12075550102"]);
  assert.deepEqual(preview.recipients[0].cars.map((c) => c.label), ["2014 Toyota Corolla", "2016 RAV4"]);
  assert.equal(preview.recipients[0].totalDueCents, 30_000);
  assert.equal(preview.recipients[0].stillParked, true);
  assert.equal(preview.recipients[1].alreadySent, true);
  assert.deepEqual(defaultInvoiceSelection(preview.recipients), ["+12075550101"]);
  assert.deepEqual(selectAllInvoices(preview.recipients), ["+12075550101", "+12075550102"]);
  assert.equal(preview.run?.status, "ready");
  assert.equal(preview.run?.totalDueCents, 45_050);
  // A server that has not prepared the month answers run: null; garbage reads as empty.
  assert.equal(parseInvoicePreview({ monthKey: "2026-10", run: null, recipients: [] }).run, null);
  assert.deepEqual(parseInvoicePreview(null), { monthKey: "", run: null, recipients: [] });
  assert.deepEqual(parseInvoicePreview({ recipients: "x" }).recipients, []);
  // A balance is never negative text and an unknown run status reads as ready.
  assert.equal(parseInvoicePreview({ recipients: [{ phone: "+1", totalDueCents: -5 }] }).recipients[0].totalDueCents, 0);
  assert.equal(parseInvoicePreview({ run: { status: "weird" } }).run?.status, "ready");
});

test("the requests and the result follow the contract", () => {
  assert.deepEqual(invoicesPreviewRequest("biz1", "2026-10"), { businessId: "biz1", action: "invoices_preview", monthKey: "2026-10" });
  assert.deepEqual(invoicesSendRequest("biz1", "2026-10", ["+12075550101"]), {
    businessId: "biz1",
    action: "invoices_send",
    monthKey: "2026-10",
    phones: ["+12075550101"],
  });
  assert.deepEqual(parseInvoiceResult({ sent: 2, failed: 1, skipped: "3", remaining: 0 }), { sent: 2, failed: 1, skipped: 3, remaining: 0 });
  assert.deepEqual(parseInvoiceResult(undefined), { sent: 0, failed: 0, skipped: 0, remaining: 0 });
  assert.equal(invoiceResultText({ sent: 2, failed: 1, skipped: 1, remaining: 4 }, "en"), "2 sent · 1 skipped · 1 failed · 4 still to send");
  assert.equal(invoiceResultText({ sent: 1, failed: 0, skipped: 0, remaining: 0 }, "en"), "1 sent");
  assert.equal(invoiceResultText({ sent: 2, failed: 1, skipped: 1, remaining: 4 }, "fr"), "2 factures envoyées · 1 ignorée · 1 échec · 4 restent à envoyer");
  assert.equal(invoiceResultText({ sent: 1, failed: 0, skipped: 0, remaining: 1 }, "fr"), "1 facture envoyée · 1 reste à envoyer");
  assert.equal(invoiceSelectionText(1, 2, "en"), "1 of 2 selected");
  assert.equal(invoiceSelectionText(2, 2, "fr"), "2 sur 2 sélectionnés");
  assert.equal(invoiceSendText(1, "en"), "Send to 1 customer");
  assert.equal(invoiceSendText(3, "en"), "Send to 3 customers");
  assert.equal(invoiceSendText(3, "fr"), "Envoyer à 3 clients");
});

test("the run's status line: ready, sending, sent by a person, sent automatically", () => {
  const ready = parseInvoicePreview(PREVIEW).run;
  assert.equal(invoiceRunText(ready, { lang: "en" }), "Ready to send: 3 customers · $450.50");
  assert.equal(invoiceRunText(ready, { lang: "fr" }), "Prêt à envoyer : 3 clients · $450.50");
  assert.equal(invoiceRunText(null), PARKING_INVOICES_COPY.runNone);
  assert.equal(invoiceRunText({ ...ready!, status: "sending" }), PARKING_INVOICES_COPY.runSending);
  const sent = { ...ready!, status: "sent" as const, sentAtMs: 1_793_700_000_000, sentBy: "u1", sent: 2, failed: 1 };
  assert.equal(invoiceRunText(sent, { lang: "en", sentOn: "Nov 3, 2026", staffNames: { u1: "Awa" } }), "Sent Nov 3, 2026 by Awa · 2 sent · 1 failed");
  assert.equal(invoiceRunText(sent, { lang: "fr", sentOn: "3 nov. 2026", staffNames: { u1: "Awa" } }), "Envoyées 3 nov. 2026 par Awa · 2 factures envoyées · 1 échec");
  // An unknown user id leaves the name out rather than showing the id.
  assert.equal(invoiceRunText(sent, { lang: "en", sentOn: "Nov 3, 2026" }), "Sent Nov 3, 2026 · 2 sent · 1 failed");
  assert.equal(invoiceRunText({ ...sent, sentBy: "auto" }, { lang: "en", sentOn: "Nov 3, 2026" }), "Sent Nov 3, 2026 automatically · 2 sent · 1 failed");
  assert.equal(invoiceRunText({ ...sent, sentBy: "auto" }, { lang: "fr", sentOn: "3 nov. 2026" }), "Envoyées 3 nov. 2026 automatiquement · 2 factures envoyées · 1 échec");
});

test("the panel sits on Month end only for the owner, with the switch on, in the month just ended", () => {
  assert.match(monthEnd, /const invoicesOffered = canSendInvoices && parkingWhatsAppEnabled\(business\) && invoicesOfferedFor\(monthKey\)/);
  assert.match(monthEnd, /\{invoicesOffered && <ParkingInvoicesPanel key=\{monthKey\} businessId=\{businessId\} monthKey=\{monthKey\} staffNames=\{staffNames\} \/>\}/);
  assert.match(panels, /<ParkingMonthEnd[\s\S]*?canSendInvoices=\{canSendParkingWelcome\}/);
  // The same owner / platform-admin flag the welcome uses, never in a preview.
  assert.match(read("../components/business-console.tsx"), /canSendParkingWelcome=\{\s*\(profile\.role === "businessOwner" \|\| profile\.role === "admin"\) && !previewMode/);
});

test("the panel previews first, sends only what is ticked after a confirmation, and every wait ends", () => {
  assert.match(component, /invoicesPreviewRequest\(businessId, monthKey\)/);
  assert.match(component, /invoicesSendRequest\(businessId, monthKey, selected\)/);
  assert.match(component, /parkingEntryCall\(PARKING_INVOICES_PREVIEW_TIMEOUT_MS\)\(invoicesPreviewRequest/);
  assert.match(component, /parkingEntryCall\(PARKING_INVOICES_SEND_TIMEOUT_MS\)\(invoicesSendRequest/);
  assert.match(component, /httpsCallable\(functions, "updateBusinessParkingEntry", \{ timeout \}\)/);
  // Already sent: muted, unticked by default, still selectable.
  assert.match(component, /person\.alreadySent \? "muted"/);
  assert.match(component, /defaultInvoiceSelection\(parsed\.recipients\)/);
  assert.match(component, /selectAllInvoices\(recipients\)/);
  assert.match(component, /onClick=\{\(\) => setSelected\(\[\]\)\}/);
  // The button asks first; nothing ticked, nothing sent; a run that is sending cannot be sent again.
  assert.match(component, /disabled=\{sending \|\| runBusy \|\| selected\.length === 0\}/);
  assert.match(component, /onClick=\{\(\) => setConfirming\(true\)\}/);
  assert.match(component, /onClick=\{\(\) => void send\(\)\}/);
  // An error leaves the panel usable (Retry), `finally` ends the sending state, the result is shown with counts.
  assert.match(component, /\.catch\(\(failure\) => \{\s*if \(active\) setLoadError/);
  assert.match(component, /finally \{\s*setSending\(false\);/);
  assert.match(component, /invoiceResultText\(result, language\)/);
  // After a send the list and the run line are read again.
  assert.match(component, /setResult\(parseInvoiceResult\(answer\.data\)\);\s*\/\/[^\n]*\n\s*setAttempt/);
  // The run line says who sent it (by name) and when, in the US date style.
  assert.match(component, /formatDate\(run\.sentAtMs\)/);
  assert.match(component, /invoiceRunText\(run, \{ lang: language, sentOn, staffNames \}\)/);
});

// ---------------------------------------------------------------------------
// Each customer's invoice message
// ---------------------------------------------------------------------------

test("an invoice message reads as Monthly invoice with its tick", () => {
  assert.equal(PARKING_MESSAGE_KIND_LABEL.invoice, "Monthly invoice");
  const line = parkingMessageLine({ id: "invoice_biz1_2026-10_12075550101", kind: "invoice", status: "sent", deliveryStatus: "read", phone: "+12075550101", monthKey: "2026-10", sentAt: 5000 });
  assert.equal(line?.kindLabel, "Monthly invoice");
  assert.equal(line?.tick, "double-read");
});

test("each customer card gets its month's invoice message, matched by phone", () => {
  const rows = [
    { id: "a", kind: "invoice", monthKey: "2026-10", status: "sent", phone: "+1 (207) 555-0101", sentAt: 1000 },
    { id: "a2", kind: "invoice", monthKey: "2026-10", status: "failed", error: "No WhatsApp", phone: "+12075550101", createdAt: 2000 },
    { id: "b", kind: "invoice", monthKey: "2026-10", status: "queued", phone: "+12075550102" },
    { id: "c", kind: "invoice", monthKey: "2026-09", status: "sent", phone: "+12075550103" },
    { id: "d", kind: "receipt", monthKey: "2026-10", status: "sent", phone: "+12075550104" },
    { id: "e", kind: "invoice", monthKey: "2026-10", status: "sent" },
  ];
  const map = invoiceMessagesByCustomer(rows, "2026-10");
  assert.deepEqual([...map.keys()].sort(), ["phone:2075550101", "phone:2075550102"]);
  assert.equal(map.get("phone:2075550101")?.id, "a2", "the newest row of a phone wins");
  assert.equal(map.get("phone:2075550101")?.state, "failed");
  assert.equal(map.get("phone:2075550102")?.tick, "clock");
});

test("the messages query is three equalities and nothing else, opened per month, and it always resolves", () => {
  assert.deepEqual(invoiceMessagesFilters("biz1", "2026-10"), [
    ["businessId", "==", "biz1"],
    ["kind", "==", "invoice"],
    ["monthKey", "==", "2026-10"],
  ]);
  assert.match(component, /collection\(db, "parkingMessages"\)/);
  assert.match(component, /where\("businessId", "==", businessId\),\s*where\("kind", "==", "invoice"\),\s*where\("monthKey", "==", monthKey\)/);
  assert.doesNotMatch(component, /parkingMessages"\)[\s\S]{0,300}(orderBy|limit)\(/, "equalities only: no composite index");
  assert.match(component, /if \(!enabled \|\| !businessId \|\| !monthKey\) return undefined/);
  assert.match(component, /PARKING_INVOICE_MESSAGES_TIMEOUT_MS/);
  assert.match(component, /\(\) => \{\s*settled\.current = true;\s*setRows\(\[\]\);\s*setLoading\(false\);/);
  // Month end subscribes once the business has used the switch, and each card shows its line.
  assert.match(monthEnd, /useParkingInvoiceMessages\(businessId, monthKey, parkingWhatsAppEverEnabled\(business\)\)/);
  assert.match(monthEnd, /invoiceMessages\.byCustomer\.get\(customer\.key\)!/);
  assert.match(monthEnd, /<InvoiceMessageStatus line=/);
  // The month-end view still never writes the database itself.
  assert.doesNotMatch(component, /setDoc\(|updateDoc\(|addDoc\(|deleteDoc\(/);
});

// ---------------------------------------------------------------------------
// French (guardrails §5)
// ---------------------------------------------------------------------------

test("every string this feature shows has its French", () => {
  const strings = [
    ...Object.values(PARKING_INVOICES_COPY).filter((value) => value !== PARKING_INVOICES_COPY.done),
    ...Object.values(PARKING_INVOICES_REFUSALS),
    ...Object.values(PARKING_MESSAGE_KIND_LABEL),
    ...Object.values(PARKING_MESSAGE_STATE_LABEL),
    "Saved.",
    "Only the business owner can change this.",
  ];
  const missing = strings.filter((value) => !TEXT_TRANSLATIONS[value]);
  assert.deepEqual(missing, []);
  assert.equal(translateValue("Payment instructions", "fr"), "Instructions de paiement");
  assert.equal(translateValue("Send invoices", "fr"), "Envoyer les factures");
  assert.equal(translateValue("Monthly invoice", "fr"), "Facture mensuelle");
  assert.equal(translateValue(PARKING_INVOICES_REFUSALS.invoices_owner_only, "fr"), "Seul le propriétaire de l’entreprise peut envoyer les factures.");
});

test("the component's own JSX text and attributes are all in the dictionary", () => {
  const missing: string[] = [];
  for (const match of component.matchAll(/(?<!=)>\s*([A-Z][A-Za-z' ,.…()—:-]{2,})\s*</g)) {
    const value = match[1].trim();
    if (!TEXT_TRANSLATIONS[value]) missing.push(value);
  }
  for (const match of component.matchAll(/(?:placeholder|aria-label|title)="([^"]+)"/g)) {
    if (!TEXT_TRANSLATIONS[match[1]] && !ATTRIBUTE_TRANSLATIONS[match[1]]) missing.push(match[1]);
  }
  assert.deepEqual(missing, []);
  assert.equal(ATTRIBUTE_TRANSLATIONS["Pay at the office, or Zelle …"], "Payez au bureau, ou Zelle …");
  assert.equal(ATTRIBUTE_TRANSLATIONS["Send invoices"], "Envoyer les factures");
});
