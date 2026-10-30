"use strict";

// Who gets a monthly parking invoice, what it is numbered, what the
// WhatsApp template says, which month may be sent and when the automatic
// send is due (docs/PARKING_INVOICES.md). Pure: no Firestore.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {parkingMonthSummary} = require("../parking_month_statement");
const invoices = require("../parking_invoices");
const {parkingTemplateMessage, PARKING_TEMPLATE} =
  require("../whatsapp_templates");

const FIXTURE = require("./fixtures/parking-invoices-cases.json");
const NOW = new Date(FIXTURE.now);

const asDates = (row) => {
  const out = {...row};
  for (const key of ["parkingDate", "parkingEndDate", "activityDate"]) {
    if (out[key]) out[key] = new Date(`${out[key]}T12:00:00Z`);
  }
  return out;
};
const credit = (extra = {}) => ({
  ...FIXTURE.staffCredit,
  entries: FIXTURE.staffCredit.entries.map((e) =>
    ({...e, spentAt: new Date(e.spentAt)})),
  ...extra,
});
const summaryOf = (cars = FIXTURE.cars) => parkingMonthSummary(
    cars.map(asDates), FIXTURE.monthKey, NOW,
    FIXTURE.activities.map(asDates));
const run = (extra = {}, staffCredit = credit()) => invoices.invoiceRecipients(
    summaryOf(), staffCredit, NOW,
    {business: FIXTURE.business, ...extra});

describe("who gets an invoice (the fixture)", () => {
  const result = run();
  const byPhone = Object.fromEntries(
      result.recipients.map((r) => [r.phoneDigits, r]));

  it("lists exactly the customers who owe or still have a car parked",
      () => {
        assert.deepEqual(result.recipients.map((r) => r.phoneDigits).sort(),
            FIXTURE.expected.recipients.map((r) => r.phoneDigits).sort());
        for (const want of FIXTURE.expected.recipients) {
          const got = byPhone[want.phoneDigits];
          assert.equal(got.name, want.name, want.name);
          assert.equal(got.totalDueCents, want.totalDueCents, want.name);
          assert.equal(got.stillParked, want.stillParked, want.name);
          assert.equal(got.invoiceNumber, want.invoiceNumber, want.name);
          assert.deepEqual(got.cars.map((c) => c.trackingCode), want.cars,
              want.name);
          assert.equal(got.trackingCode, want.trackingCode, want.name);
          assert.equal(got.customer.expenseCreditCents,
              want.expenseCreditCents || 0, want.name);
          assert.equal(got.phone, `+${want.phoneDigits}`, want.name);
          assert.equal(got.alreadySent, false);
        }
      });

  it("sends nobody who left and paid, whether in cash or by expenses",
      () => {
        const names = result.recipients.map((r) => r.name);
        for (const name of FIXTURE.expected.noInvoice) {
          assert.ok(!names.includes(name), `${name} got an invoice`);
        }
      });

  it("leaves out a voided car's customer entirely", () => {
    const all = [...result.recipients, ...result.skipped].map((r) => r.name);
    assert.ok(!all.includes("Doudou Sy"));
  });

  it("nets a linked staff member's expenses (voided ones do not count)",
      () => {
        const staff = byPhone["12015550005"].customer;
        assert.equal(staff.dueBeforeExpensesCents, 15000);
        assert.equal(staff.expenseCreditCents, 6000);
        assert.equal(staff.dueCents, 9000);
        assert.equal(staff.expenseLines.length, 1);
        assert.deepEqual(staff.expenseLines[0], {
          id: "e-a", date: "2026-10-08", label: "Groceries · cups",
          amountCents: 6000, staffName: "Mamadou Diallo"});
        assert.equal(staff.earlierExpenseCents, 0);
      });

  it("still invoices a customer whose expenses cover everything but whose " +
      "car is still parked, for $0.00", () => {
    const gora = byPhone["12015550007"];
    assert.equal(gora.totalDueCents, 0);
    assert.equal(gora.stillParked, true);
    assert.equal(gora.customer.dueBeforeExpensesCents, 7000);
  });

  it("covers every car of a customer in ONE invoice, newest car first for " +
      "the Track button", () => {
    const mariam = byPhone["12015550013"];
    assert.equal(mariam.cars.length, 2);
    assert.equal(mariam.cars[0].trackingCode, "PK-TWO213");
    assert.equal(mariam.totalDueCents, 10000 + 34000);
  });

  it("invoices a customer who only owes for an activity, with no cars",
      () => {
        const hawa = byPhone["12015550008"];
        assert.deepEqual(hawa.cars, []);
        assert.equal(hawa.totalDueCents, 4000);
        assert.equal(hawa.trackingCode, "PK-ACT008");
      });

  it("sets aside numbers the WhatsApp cannot reach, with why", () => {
    assert.deepEqual(result.skipped.map((s) =>
      ({name: s.name, reason: s.reason, totalDueCents: s.totalDueCents}))
        .sort((a, b) => a.name.localeCompare(b.name)),
    FIXTURE.expected.skipped);
  });

  it("adds up what the recipients owe, most owed first", () => {
    assert.equal(result.totalDueCents, FIXTURE.expected.totalDueCents);
    const dues = result.recipients.map((r) => r.totalDueCents);
    assert.deepEqual(dues, [...dues].sort((a, b) => b - a));
    assert.equal(result.monthKey, "2026-10");
    assert.equal(result.issuedMs, NOW.getTime());
  });

  it("flags who was already sent this month's invoice", () => {
    const flagged = run({sent: new Set(["12015550001"])});
    assert.deepEqual(flagged.recipients.filter((r) => r.alreadySent)
        .map((r) => r.phoneDigits), ["12015550001"]);
  });

  it("works without any staff credit, and with a read that failed", () => {
    const plain = run({}, null);
    const mamadou = plain.recipients.find((r) =>
      r.phoneDigits === "12015550005");
    assert.equal(mamadou.totalDueCents, 15000);
    // Fatou now owes, so she is invoiced.
    assert.ok(plain.recipients.some((r) => r.name === "Fatou Sow"));
  });

  it("reads a local number with the lot's country, else sets it aside",
      () => {
        const local = run({business: {country: "United States"}});
        assert.ok(local.recipients.some((r) =>
          r.phoneDigits === "12015550013"));
        const noCountry = invoices.invoiceRecipients(summaryOf(), credit(),
            NOW, {business: {}});
        // "(201) 555-0013" has no country code without the lot's country.
        assert.ok(noCountry.skipped.length >= result.skipped.length);
      });
});

describe("invoice numbers", () => {
  it("is INV-{YYYYMM}-{last four digits}-{n}", () => {
    assert.equal(invoices.invoiceNumber("2026-10", "12015551234", 1),
        "INV-202610-1234-1");
    assert.equal(invoices.invoiceNumber("2026-01", "42", 3),
        "INV-202601-0042-3");
  });

  it("tells apart numbers that end the same, in phone order, and keeps " +
      "every number the same whoever pays", () => {
    const numbers = (r) => Object.fromEntries(r.recipients.map((x) =>
      [x.phoneDigits, x.invoiceNumber]));
    const before = numbers(run());
    assert.equal(before["12015551234"], "INV-202610-1234-1");
    assert.equal(before["13475551234"], "INV-202610-1234-2");
    // Kadi pays: she is no longer invoiced; Lamine's number does not move.
    const cars = FIXTURE.cars.map((c) => c.id === "same-end-a" ?
      {...c, amountPaidCents: 2000} : c);
    const after = invoices.invoiceRecipients(summaryOf(cars), credit(), NOW,
        {business: FIXTURE.business});
    assert.equal(numbers(after)["13475551234"], "INV-202610-1234-2");
    assert.equal(numbers(after)["12015551234"], undefined);
  });

  it("is unique within the month", () => {
    const all = run().recipients.map((r) => r.invoiceNumber);
    assert.equal(new Set(all).size, all.length);
  });
});

describe("the message values", () => {
  const recipient = run().recipients.find((r) =>
    r.phoneDigits === "12015550005");
  const business = {name: "Keren Auto Sales", phone: "+13475596214",
    paymentInstructions: "Pay at the office, or Zelle 347-559-6214."};

  it("fills the template's variables, money and month in both languages",
      () => {
        assert.deepEqual(invoices.invoiceMessageValues(recipient, business), {
          name: "Mamadou Diallo",
          business: "Keren Auto Sales",
          businessPhone: "+13475596214",
          trackingCode: "PK-STAF05",
          monthEn: "October 2026",
          monthFr: "octobre 2026",
          dueEn: "$90.00",
          dueFr: "90,00 $",
          paymentInstructions: "Pay at the office, or Zelle 347-559-6214.",
        });
      });

  it("builds the exact WhatsApp template components", () => {
    const body = parkingTemplateMessage({
      template: PARKING_TEMPLATE.INVOICE, phone: recipient.phone,
      values: {...invoices.invoiceMessageValues(recipient, business),
        documentLink: "https://example.test/d?view=invoicePdf",
        documentFilename: invoices.invoiceFilename(
            recipient.invoiceNumber)},
    });
    assert.equal(body.to, "12015550005");
    assert.equal(body.template.name, "parking_invoice_2lang");
    assert.deepEqual(body.template.language, {code: "en"});
    assert.deepEqual(body.template.components, [
      {type: "header", parameters: [{type: "document", document: {
        link: "https://example.test/d?view=invoicePdf",
        filename: "Invoice INV-202610-0005-1.pdf"}}]},
      {type: "body", parameters: [
        "Mamadou Diallo",
        "Keren Auto Sales", "October 2026", "$90.00",
        "Keren Auto Sales", "octobre 2026", "90,00 $",
        "Pay at the office, or Zelle 347-559-6214.", "+13475596214",
      ].map((text) => ({type: "text", text}))},
      {type: "button", sub_type: "url", index: "0",
        parameters: [{type: "text", text: "PK-STAF05"}]},
    ]);
  });

  it("says a dash when the owner gave no payment instructions", () => {
    const values = invoices.invoiceMessageValues(recipient,
        {name: "Keren", phone: "+13475596214"});
    assert.equal(values.paymentInstructions, "");
    const body = parkingTemplateMessage({template: PARKING_TEMPLATE.INVOICE,
      phone: "+1", values});
    assert.equal(body.template.components[1].parameters[7].text, "—");
  });

  it("names the file after the invoice", () => {
    assert.equal(invoices.invoiceFilename("INV-202610-0005-1"),
        "Invoice INV-202610-0005-1.pdf");
    assert.equal(invoices.invoiceFilename("A\"b\nc"), "Invoice Abc.pdf");
  });

  it("writes months in French", () => {
    assert.equal(invoices.monthTextFr("2026-02"), "février 2026");
    assert.equal(invoices.monthTextFr("2026-12"), "décembre 2026");
    assert.equal(invoices.monthTextEn("2026-02"), "February 2026");
  });
});

describe("which month, and when", () => {
  const at = (iso) => new Date(iso);

  it("allows only the month that just ended, in New York time", () => {
    // Nov 3, 10 am New York.
    const now = at("2026-11-03T15:00:00Z");
    assert.equal(invoices.justEndedMonthKey(now), "2026-10");
    assert.equal(invoices.invoiceMonthAllowed("2026-10", now), true);
    for (const bad of ["2026-09", "2026-11", "2025-10", "2026-13", "",
      "2026-1", null, undefined, 202610, "October"]) {
      assert.equal(invoices.invoiceMonthAllowed(bad, now), false, String(bad));
    }
  });

  it("goes by New York's calendar, not UTC's", () => {
    // 11:30 pm on Oct 31 in New York (EDT) is already Nov 1 in UTC: the
    // month has not ended yet there.
    const lateOct = at("2026-11-01T03:30:00Z");
    assert.equal(invoices.justEndedMonthKey(lateOct), "2026-09");
    assert.equal(invoices.invoiceMonthAllowed("2026-10", lateOct), false);
    // Half an hour later in New York it has.
    const early = at("2026-11-01T04:30:00Z");
    assert.equal(invoices.invoiceMonthAllowed("2026-10", early), true);
  });

  it("crosses a year", () => {
    assert.equal(invoices.justEndedMonthKey(at("2027-01-05T15:00:00Z")),
        "2026-12");
  });

  it("is due on the 3rd, New York time, and not before", () => {
    // EST in November: midnight on the 3rd is 05:00 UTC.
    assert.equal(invoices.autoSendDue(at("2026-11-03T04:59:59Z")), false);
    assert.equal(invoices.autoSendDue(at("2026-11-03T05:00:00Z")), true);
    assert.equal(invoices.autoSendDue(at("2026-11-01T14:00:00Z")), false);
    assert.equal(invoices.autoSendDue(at("2026-11-02T20:00:00Z")), false);
    assert.equal(invoices.autoSendDue(at("2026-11-20T14:00:00Z")), true);
    assert.equal(invoices.AUTO_SEND_DAY, 3);
  });
});

describe("payment instructions", () => {
  it("keeps plain text, trimmed, up to 300 characters", () => {
    assert.deepEqual(invoices.cleanPaymentInstructions("  Pay by Zelle \n"),
        {ok: true, text: "Pay by Zelle"});
    assert.equal(invoices.cleanPaymentInstructions("x".repeat(300)).ok, true);
    assert.equal(invoices.cleanPaymentInstructions("x".repeat(301)).ok, false);
  });

  it("lets the owner clear them", () => {
    assert.deepEqual(invoices.cleanPaymentInstructions(""),
        {ok: true, text: ""});
    assert.deepEqual(invoices.cleanPaymentInstructions("   "),
        {ok: true, text: ""});
    assert.deepEqual(invoices.cleanPaymentInstructions(null),
        {ok: true, text: ""});
  });

  it("refuses anything that is not text", () => {
    for (const bad of [5, {a: 1}, ["x"], true]) {
      assert.equal(invoices.cleanPaymentInstructions(bad).ok, false);
    }
  });

  it("drops control characters and long runs of blank lines", () => {
    assert.equal(invoices.cleanPaymentInstructions(
        "a\u0000b\r\n\r\n\r\n\r\nc").text, "ab\n\nc");
  });
});

describe("the signed invoice link", () => {
  const packageProof = require("../package_proof");
  const BASE = "https://us-central1-p.cloudfunctions.net/parkingDocument";
  const TOKEN = "run-secret-token-0123456789abcdef";
  const NOW_MS = Date.parse("2026-11-03T15:00:00Z");
  const link = (extra = {}) => packageProof.invoiceLink({base: BASE,
    token: TOKEN, phoneDigits: "12015551234", expiresMs: NOW_MS + 86400000,
    ...extra});
  const query = (url) => Object.fromEntries(new URL(url).searchParams);

  it("points straight at the document function", () => {
    const url = new URL(link());
    assert.equal(`${url.origin}${url.pathname}`, BASE);
    assert.equal(url.searchParams.get("view"), "invoicePdf");
    assert.equal(url.searchParams.get("t"), TOKEN);
    assert.equal(url.searchParams.get("p"), "12015551234");
  });

  it("opens for the customer it was made for, until it expires", () => {
    assert.equal(packageProof.invoiceLinkValid(query(link()), TOKEN, NOW_MS),
        true);
    assert.equal(packageProof.invoiceLinkValid(query(link()), TOKEN,
        NOW_MS + 2 * 86400000), false);
  });

  it("refuses another customer's number, a stretched expiry, a forged " +
      "signature and another month's token", () => {
    const q = query(link());
    assert.equal(packageProof.invoiceLinkValid({...q, p: "12015550000"},
        TOKEN, NOW_MS), false);
    assert.equal(packageProof.invoiceLinkValid({...q,
      e: String(Number(q.e) + 86400000)}, TOKEN, NOW_MS), false);
    assert.equal(packageProof.invoiceLinkValid({...q, s: "0".repeat(24)},
        TOKEN, NOW_MS), false);
    assert.equal(packageProof.invoiceLinkValid(q, "other-token", NOW_MS),
        false);
    assert.equal(packageProof.invoiceLinkValid({...q, p: "../etc"}, TOKEN,
        NOW_MS), false);
  });

  it("is not a receipt's or a photo's link: their signatures never open " +
      "an invoice", () => {
    const receipt = query(packageProof.receiptLink({base: BASE,
      token: TOKEN, paymentId: "12015551234", expiresMs: NOW_MS + 86400000}));
    assert.equal(packageProof.invoiceLinkValid(receipt, TOKEN, NOW_MS),
        false);
    const invoice = query(link());
    assert.equal(packageProof.receiptLinkValid(invoice, TOKEN, NOW_MS),
        false);
  });
});

describe("the run", () => {
  it("starts ready, with the month's numbers and a link secret", () => {
    const run = invoices.newRun({businessId: "biz", monthKey: "2026-10",
      recipients: 8, totalDueCents: 71000, nowMs: 1790000000000,
      documentToken: "t".repeat(32)});
    assert.deepEqual(run, {
      businessId: "biz", monthKey: "2026-10", status: "ready",
      preparedAtMs: 1790000000000, sentAtMs: 0, sentBy: "", recipients: 8,
      totalDueCents: 71000, sent: 0, failed: 0, skipped: 0,
      documentToken: "t".repeat(32)});
  });

  it("names its documents", () => {
    assert.equal(invoices.runId("biz", "2026-10"), "biz_2026-10");
    assert.equal(invoices.messageRowId("biz", "2026-10", "+1 (201) 555-0001"),
        "invoice_biz_2026-10_12015550001");
    assert.equal(invoices.storagePath("biz", "2026-10", "+12015550001"),
        "parkingInvoices/biz/2026-10/12015550001.pdf");
  });

  it("can be claimed unless a fresh send holds it", () => {
    const now = 1790000000000;
    assert.equal(invoices.runClaimable(null, now), true);
    assert.equal(invoices.runClaimable({status: "ready"}, now), true);
    assert.equal(invoices.runClaimable({status: "sent"}, now), true);
    assert.equal(invoices.runClaimable(
        {status: "sending", sendingAtMs: now - 60000}, now), false);
    assert.equal(invoices.runClaimable({status: "sending",
      sendingAtMs: now - invoices.SENDING_LEASE_MS}, now), true);
  });

  it("tallies a month's rows", () => {
    assert.deepEqual(invoices.tallyRows([{status: "sent"}, {status: "sent"},
      {status: "failed"}, {status: "stopped"}, {status: "queued"}, {}]),
    {sent: 2, failed: 1, stopped: 1, queued: 1});
  });

  it("words the owner's push", () => {
    assert.equal(invoices.invoicesReadyText("2026-10", 8, 71000),
        "October's invoices are ready: 8 customers, $710.00. " +
        "Review and send.");
    assert.equal(invoices.invoicesReadyText("2026-10", 1, 0),
        "October's invoices are ready: 1 customer, $0.00. " +
        "Review and send.");
    assert.equal(invoices.invoicesReadyText("2026-10", 0, 0), "");
  });

  it("has a message for every refusal", () => {
    for (const code of Object.values(invoices.REFUSAL)) {
      assert.ok(invoices.REFUSAL_MESSAGE[code], code);
    }
  });
});
