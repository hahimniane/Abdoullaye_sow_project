"use strict";

// The receipt PDF (docs/PARKING_WHATSAPP.md §2 "Receipt PDF"): a real PDF
// laid out like the printable parking document, the amounts and the US
// month-first date on the page, every label in English and French.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  METHOD_LABEL,
  money,
  receiptModel,
  renderReceiptPdf,
  shortDay,
  usDate,
} = require("../parking_receipt_pdf");
const {parkingBalanceNow} = require("../parking_month_statement");

const CAR = {
  trackingCode: "PK-K7M4P2", customerName: "Alimou Barry",
  carYear: "2018", carMake: "Toyota", carModel: "Camry",
  vinNumber: "1hgcm82633a004352",
};
const AT = Date.parse("2026-10-29T15:00:00Z");
const BALANCE_OWED = {dailyRateCents: 1000, sinceDayKey: "2026-10-20",
  days: 10, accruedCents: 10000, paidCents: 6000, balanceCents: 4000,
  paidInFull: false, stillParked: true};
const PAID = {...BALANCE_OWED, paidCents: 10000, balanceCents: 0,
  paidInFull: true};

const model = (extra = {}) => receiptModel({
  business: {name: "Nensona Parking", phone: "+12015550100"},
  car: CAR,
  payment: {amountCents: 3000, method: "zelle",
    receivedByName: "Mamadou Diallo", atMs: AT, number: 2},
  balance: BALANCE_OWED,
  ...extra,
});

const rowsOf = (m) => Object.fromEntries(m.rows.map((r) =>
  [r.label, r.value]));

/**
 * The text a PDF draws, from an uncompressed one: pdfkit writes each string
 * as hex pieces inside a `[...] TJ` array.
 *
 * @param {Buffer} bytes An uncompressed PDF.
 * @return {string[]} One entry per drawn string.
 */
function drawnText(bytes) {
  const source = bytes.toString("latin1");
  const out = [];
  for (const array of source.match(/\[[^\]]*\]\s*TJ/g) || []) {
    let line = "";
    for (const hex of array.match(/<([0-9a-fA-F]*)>/g) || []) {
      line += Buffer.from(hex.slice(1, -1), "hex").toString("latin1");
    }
    out.push(line);
  }
  return out;
}

describe("the receipt's lines", () => {
  it("numbers the receipt like the document, after the car's code", () => {
    const m = model();
    assert.equal(m.receiptNumber, "PK-K7M4P2-2");
    assert.equal(m.reference, "REC-PK-K7M4P2-2");
    assert.equal(m.title, "RECEIPT / REÇU");
  });

  it("shows the date US style, month first, in the lot's day", () => {
    assert.equal(usDate(AT), "Oct 29, 2026");
    // 11 pm in New York is already the next day in UTC.
    assert.equal(usDate(Date.parse("2026-10-30T03:30:00Z")), "Oct 29, 2026");
    assert.equal(usDate(Date.parse("2026-01-05T12:00:00Z")), "Jan 5, 2026");
    assert.equal(shortDay(AT), "Oct 29");
    assert.equal(usDate(0), "");
    assert.equal(rowsOf(model())["Payment received / Paiement reçu le"],
        "Oct 29, 2026");
  });

  it("lists the document's rows, then this payment's", () => {
    const m = model({car: {...CAR, customerPhone: "+12015550142"}});
    assert.deepEqual(m.rows.map((r) => r.label.split(" / ")[0]), [
      "Customer", "Phone", "Vehicle", "VIN", "Parked from",
      "Parked until", "Tracking code", "Payment method",
      "Payment received", "Amount of this payment", "Received by",
    ]);
    const rows = rowsOf(m);
    assert.equal(rows["Customer / Client"], "Alimou Barry");
    assert.equal(rows["Phone / Téléphone"], "+12015550142");
    assert.equal(rows["Vehicle / Véhicule"], "2018 Toyota Camry");
    assert.equal(rows["VIN / NIV"], "1HGCM82633A004352");
    assert.equal(rows["Parked from / Stationné depuis"], "Oct 20, 2026");
    assert.equal(rows["Parked until / Stationné jusqu'au"],
        "Still parked / Toujours stationné");
    assert.equal(rows["Tracking code / Code de suivi"], "PK-K7M4P2");
    assert.equal(rows["Payment method / Mode de paiement"], "Zelle");
    assert.equal(rows["Amount of this payment / Montant de ce paiement"],
        "$30.00");
    assert.equal(rows["Received by / Reçu par"], "Mamadou Diallo");
  });

  it("names the day a car left", () => {
    const rows = rowsOf(model({balance: {...BALANCE_OWED,
      leftDayKey: "2026-10-31", stillParked: true}}));
    assert.equal(rows["Parked until / Stationné jusqu'au"], "Oct 31, 2026");
  });

  it("says Business account when the business took the money", () => {
    const m = model({payment: {amountCents: 3000, method: "cash", atMs: AT,
      number: 1, receivedByStaffId: "business_account"}});
    assert.match(rowsOf(m)["Received by / Reçu par"], /^Business account/);
  });

  it("is PAID when nothing is owed, else PARTLY PAID", () => {
    assert.deepEqual(model().status,
        {label: "PARTLY PAID / PAYÉ EN PARTIE", paidInFull: false});
    assert.deepEqual(model({balance: PAID}).status,
        {label: "PAID / PAYÉ", paidInFull: true});
  });

  it("totals the box: this payment, paid so far, balance or paid in full",
      () => {
        const m = model();
        assert.deepEqual(m.amount,
            {label: "AMOUNT PAID / MONTANT PAYÉ", value: "$30.00"});
        assert.deepEqual(m.totals, [
          {label: "Total paid so far / Total payé à ce jour",
            value: "$60.00"},
          {label: "Balance owed / Solde à payer", value: "$40.00",
            tone: "due"},
        ]);
        assert.deepEqual(model({balance: PAID}).totals[1], {
          label: "Balance / Solde", value: "Paid in full / Payé en totalité",
          tone: "paid"});
      });

  it("uses the business's own header: address, contact, logo", () => {
    const m = model({business: {name: "Nensona Parking",
      phone: "+12015550100", email: "hi@nensona.com",
      addressLine1: "12 Main St", city: "Newark", state: "NJ",
      postalCode: "07102", logoUrl: "https://cdn.example.com/n.png"}});
    assert.equal(m.businessAddress, "12 Main St, Newark, NJ 07102");
    assert.equal(m.businessContact, "+12015550100  |  hi@nensona.com");
    assert.equal(m.logoUrl, "https://cdn.example.com/n.png");
    // No logo of its own: the platform mark, as the web document does.
    assert.match(model().logoUrl, /^https:\/\/laawoldigital\.com\//);
  });

  it("leaves out what it does not know", () => {
    const m = receiptModel({business: {}, car: {trackingCode: "PK-1"},
      payment: {amountCents: 500, method: "mystery", atMs: AT},
      balance: {paidCents: 500, balanceCents: 0}});
    const labels = m.rows.map((r) => r.label);
    assert.ok(!labels.includes("VIN / NIV"));
    assert.ok(!labels.includes("Received by / Reçu par"));
    assert.ok(!labels.includes("Parked from / Stationné depuis"));
    assert.ok(!labels.includes("Parked until / Stationné jusqu'au"));
    assert.equal(m.businessName, "Laawol");
    assert.equal(m.receiptNumber, "PK-1-1");
    assert.equal(rowsOf(m)["Payment method / Mode de paiement"],
        METHOD_LABEL.other);
  });

  it("writes every label in English and in French", () => {
    for (const row of model().rows) {
      assert.match(row.label, / \/ /, `${row.label} is not bilingual`);
    }
    assert.equal(model().footer[1],
        "Issued through Laawol Digital · laawoldigital.com");
    assert.match(model().footer[0], /Thank you.*Merci/);
    for (const label of Object.values(METHOD_LABEL)) assert.ok(label);
  });

  it("writes money with a dollar sign and thousands", () => {
    assert.equal(money(123456), "$1,234.56");
    assert.equal(money(0), "$0.00");
  });
});

describe("the receipt PDF", () => {
  const noLogo = () => Promise.resolve(null);

  it("is a real PDF", async () => {
    const bytes = await renderReceiptPdf(model(), {fetchLogo: noLogo});
    assert.ok(Buffer.isBuffer(bytes));
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
    assert.ok(bytes.length > 1000);
    assert.match(bytes.subarray(-8).toString("latin1"), /%%EOF/);
  });

  it("prints the document's header, rows, amounts and footer", async () => {
    const bytes = await renderReceiptPdf(model({
      car: {...CAR, customerPhone: "+12015550142"},
      payment: {amountCents: 3000, method: "cash", atMs: AT, number: 2,
        receivedByStaffId: "business_account"},
      business: {name: "Nensona Parking", phone: "+12015550100",
        email: "hi@nensona.com", addressLine1: "12 Main St"},
    }), {compress: false, fetchLogo: noLogo});
    const lines = drawnText(bytes);
    const page = lines.join("\n");
    for (const expected of [
      "Nensona Parking", "12 Main St", "+12015550100  |  hi@nensona.com",
      "RECEIPT / RE", "REC-PK-K7M4P2-2", "PARTLY PAID / PAY",
      "Customer / Client", "Alimou Barry", "+12015550142",
      "2018 Toyota Camry", "1HGCM82633A004352", "Oct 20, 2026",
      "Still parked", "PK-K7M4P2", "Cash / Esp", "Oct 29, 2026",
      "Amount of this payment", "Business account",
      "AMOUNT PAID / MONTANT PAY", "$30.00",
      "Total paid so far", "$60.00", "Balance owed / Solde", "$40.00",
      "Thank you", "Issued through Laawol Digital",
    ]) {
      assert.ok(page.includes(expected), `missing "${expected}" in\n${page}`);
    }
    // French accents survive (WinAnsi: ç is 0xE7).
    assert.ok(page.includes("Reçu par"), page);
    assert.ok(!lines.some((line) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(line)),
        "a numeric day-first date");
  });

  it("says PAID, and no balance owed, when nothing is owed", async () => {
    const bytes = await renderReceiptPdf(model({balance: PAID}),
        {compress: false, fetchLogo: noLogo});
    const page = drawnText(bytes).join("\n");
    assert.ok(page.includes("PAID / PAY"), page);
    assert.ok(!page.includes("PARTLY"), page);
    assert.ok(page.includes("Paid in full"), page);
    assert.ok(!page.includes("Balance owed"), page);
  });

  it("renders a receipt made from a real car", async () => {
    const car = {...CAR, parkingDate: "2026-10-20T12:00:00Z", dailyRate: 10,
      parkingPayments: [{amountCents: 3000}]};
    const bytes = await renderReceiptPdf(receiptModel({
      business: {name: "Dala"}, car,
      payment: {amountCents: 3000, method: "cash", atMs: AT, number: 1},
      balance: parkingBalanceNow(car, new Date("2026-10-29T15:00:00Z")),
    }), {compress: false, fetchLogo: noLogo});
    const page = drawnText(bytes).join("\n");
    assert.ok(page.includes("$70.00"), page);
    assert.ok(page.includes("$30.00"), page);
  });

  it("draws the logo when the business has one", async () => {
    const asked = [];
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA" +
      "DUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
    const plain = await renderReceiptPdf(model(),
        {compress: false, fetchLogo: noLogo});
    const bytes = await renderReceiptPdf(model(), {compress: false,
      fetchLogo: (url) => {
        asked.push(url);
        return Promise.resolve(png);
      }});
    assert.equal(asked.length, 1);
    assert.match(bytes.toString("latin1"), /\/Subtype \/Image/);
    assert.doesNotMatch(plain.toString("latin1"), /\/Subtype \/Image/);
  });

  it("still makes the receipt when the logo never arrives", async () => {
    const started = Date.now();
    const bytes = await renderReceiptPdf(model(), {compress: false,
      logoTimeoutMs: 50, fetchLogo: () => new Promise(() => {})});
    assert.ok(Date.now() - started < 2000);
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
    const lines = drawnText(bytes);
    assert.ok(lines.join("\n").includes("$30.00"));
    // The placeholder: the business's initial.
    assert.ok(lines.includes("N"), "no placeholder initial");
  });

  it("still makes the receipt when the logo fails or is not an image",
      async () => {
        for (const fetchLogo of [
          () => Promise.reject(new Error("offline")),
          () => Promise.resolve(Buffer.from("<svg></svg>")),
          () => {
            throw new Error("sync failure");
          },
        ]) {
          const bytes = await renderReceiptPdf(model(), {fetchLogo});
          assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
        }
      });
});
