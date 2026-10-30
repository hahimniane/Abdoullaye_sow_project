"use strict";

// The receipt PDF (docs/PARKING_WHATSAPP.md §2 "Receipt PDF"): a real PDF,
// the amounts and the US month-first date on the page, every label in
// English and French.

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
  it("numbers the receipt after the car's code and the payment", () => {
    const m = model();
    assert.equal(m.receiptNumber, "PK-K7M4P2-2");
    assert.equal(m.rows[0].value, "PK-K7M4P2-2");
  });

  it("shows the date US style, month first, in the lot's day", () => {
    assert.equal(usDate(AT), "Oct 29, 2026");
    // 11 pm in New York is already the next day in UTC.
    assert.equal(usDate(Date.parse("2026-10-30T03:30:00Z")), "Oct 29, 2026");
    assert.equal(usDate(Date.parse("2026-01-05T12:00:00Z")), "Jan 5, 2026");
    assert.equal(shortDay(AT), "Oct 29");
    assert.equal(usDate(0), "");
    assert.deepEqual(model().rows.find((r) => r.label.startsWith("Date")),
        {label: "Date / Date", value: "Oct 29, 2026"});
  });

  it("names the payment, how it came in, who took it and the totals", () => {
    const rows = Object.fromEntries(model().rows.map((r) =>
      [r.label, r.value]));
    assert.equal(rows["This payment / Ce paiement"], "$30.00");
    assert.equal(rows["Method / Mode de paiement"], "Zelle");
    assert.equal(rows["Received by / Reçu par"], "Mamadou Diallo");
    assert.equal(rows["Total paid / Total payé"], "$60.00");
    assert.equal(rows["Customer / Client"], "Alimou Barry");
    assert.equal(rows["Car / Voiture"], "2018 Toyota Camry");
    assert.equal(rows["VIN / NIV"], "1HGCM82633A004352");
    assert.equal(rows["Parked since / Stationné depuis"], "Oct 20, 2026");
    assert.equal(rows["Daily rate / Tarif par jour"], "$10.00");
    assert.equal(rows["Parking to date / Stationnement à ce jour"],
        "$100.00");
  });

  it("states the balance owed, or PAID IN FULL", () => {
    assert.deepEqual(model().balanceRow, {
      label: "Balance owed / Solde à payer", value: "$40.00",
      paidInFull: false});
    assert.deepEqual(model({balance: PAID}).balanceRow, {
      label: "Status / Statut", value: "PAID IN FULL / PAYÉ EN TOTALITÉ",
      paidInFull: true});
  });

  it("leaves out what it does not know", () => {
    const m = receiptModel({business: {}, car: {trackingCode: "PK-1"},
      payment: {amountCents: 500, method: "mystery", atMs: AT},
      balance: {paidCents: 500, balanceCents: 0}});
    const labels = m.rows.map((r) => r.label);
    assert.ok(!labels.includes("VIN / NIV"));
    assert.ok(!labels.includes("Received by / Reçu par"));
    assert.ok(!labels.includes("Parked since / Stationné depuis"));
    assert.equal(m.businessName, "Laawol");
    assert.equal(m.receiptNumber, "PK-1-1");
    assert.equal(m.rows.find((r) => r.label.startsWith("Method")).value,
        METHOD_LABEL.other);
  });

  it("writes every label in English and in French", () => {
    for (const row of model().rows) {
      assert.match(row.label, / \/ /, `${row.label} is not bilingual`);
    }
    assert.equal(model().title, "RECEIPT / REÇU");
    assert.equal(model().footer,
        "Issued through Laawol Digital · laawoldigital.com");
    for (const label of Object.values(METHOD_LABEL)) assert.ok(label);
  });

  it("writes money with a dollar sign and thousands", () => {
    assert.equal(money(123456), "$1,234.56");
    assert.equal(money(0), "$0.00");
  });
});

describe("the receipt PDF", () => {
  it("is a real PDF", async () => {
    const bytes = await renderReceiptPdf(model());
    assert.ok(Buffer.isBuffer(bytes));
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
    assert.ok(bytes.length > 1000);
    assert.match(bytes.subarray(-8).toString("latin1"), /%%EOF/);
  });

  it("prints the amounts, the US date and the bilingual labels", async () => {
    const bytes = await renderReceiptPdf(model(), {compress: false});
    const lines = drawnText(bytes);
    const page = lines.join("\n");
    for (const expected of [
      "Nensona Parking", "RECEIPT / RE", "PK-K7M4P2-2", "Oct 29, 2026",
      "Alimou Barry", "2018 Toyota Camry", "$30.00", "$60.00", "$40.00",
      "Zelle", "Mamadou Diallo", "Receipt no. / N", "Customer / Client",
      "Balance owed / Solde",
      "Issued through Laawol Digital",
    ]) {
      assert.ok(page.includes(expected), `missing "${expected}" in\n${page}`);
    }
    // French accents survive (WinAnsi: ç is 0xE7).
    assert.ok(page.includes("Reçu par"), page);
    assert.ok(!lines.some((line) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(line)),
        "a numeric day-first date");
  });

  it("prints PAID IN FULL when nothing is owed", async () => {
    const bytes = await renderReceiptPdf(model({balance: PAID}),
        {compress: false});
    const page = drawnText(bytes).join("\n");
    assert.ok(page.includes("PAID IN FULL / PAY"), page);
    assert.ok(!page.includes("Balance owed"), page);
  });

  it("renders a receipt made from a real car", async () => {
    const car = {...CAR, parkingDate: "2026-10-20T12:00:00Z", dailyRate: 10,
      parkingPayments: [{amountCents: 3000}]};
    const bytes = await renderReceiptPdf(receiptModel({
      business: {name: "Dala"}, car,
      payment: {amountCents: 3000, method: "cash", atMs: AT, number: 1},
      balance: parkingBalanceNow(car, new Date("2026-10-29T15:00:00Z")),
    }), {compress: false});
    const page = drawnText(bytes).join("\n");
    assert.ok(page.includes("$100.00"), page);
    assert.ok(page.includes("$70.00"), page);
  });
});
