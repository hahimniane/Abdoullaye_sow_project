"use strict";

// The monthly invoice PDF (docs/PARKING_INVOICES.md §1.3): a real PDF in the
// receipt's design, with a row per car, the month's activities, unpaid from
// before, payments, expenses, the Balance due box and the payment
// instructions - every label in English and French.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {parkingMonthSummary} = require("../parking_month_statement");
const {invoiceRecipients} = require("../parking_invoices");
const {invoiceModel, renderInvoicePdf} = require("../parking_invoice_pdf");

const NOW = new Date("2026-11-03T15:00:00Z");
const day = (iso) => new Date(`${iso}T12:00:00Z`);
const noLogo = () => Promise.resolve(null);

const PHONE = "+12015551234";
const CARS = [
  {id: "c1", customerName: "Alimou Barry", customerPhone: PHONE,
    carYear: "2018", carMake: "Toyota", carModel: "Camry",
    vinNumber: "1hgcm82633a004352", trackingCode: "PK-K7M4P2",
    parkingDate: day("2026-08-20"), dailyRate: 10, paymentMethod: "direct",
    source: "business", amountPaidCents: 30000},
  {id: "c2", customerName: "Alimou Barry", customerPhone: PHONE,
    carYear: "2014", carMake: "Honda", carModel: "Accord",
    vinNumber: "2HGFA16507H301234", trackingCode: "PK-A2B3C4",
    parkingDate: day("2026-10-05"), parkingEndDate: day("2026-10-20"),
    dailyRate: 12, amountDueCents: 19200, totalCostCents: 19200,
    paymentMethod: "direct", source: "business", amountPaidCents: 5000},
  {id: "c3", customerName: "A. Barry (garage)", customerPhone: "(201) 555-1234",
    carYear: "2011", carMake: "Ford", carModel: "F-150",
    vinNumber: "1FTFW1ET5BFA12345", trackingCode: "PK-F150XX",
    parkingDate: day("2026-10-12"), dailyRate: 15, paymentMethod: "direct",
    source: "business"},
];
const ACTIVITIES = [
  {id: "a1", customerName: "Alimou Barry", customerPhone: PHONE,
    activityDate: day("2026-10-14"), activityTypeLabel: "Tire change",
    feeCents: 8000, carYear: "2018", carMake: "Toyota", carModel: "Camry",
    trackingCode: "PK-K7M4P2", paymentStatus: "awaiting_direct_payment"},
  {id: "a0", customerName: "Alimou Barry", customerPhone: PHONE,
    activityDate: day("2026-09-10"), activityTypeLabel: "Jump start",
    feeCents: 2500, carYear: "2018", carMake: "Toyota", carModel: "Camry",
    trackingCode: "PK-K7M4P2", paymentStatus: "awaiting_direct_payment"},
];
const CREDIT = {
  links: {staff1: {customerKey: "phone:2015551234"}},
  staffNames: {staff1: "Mamadou Diallo"},
  lines: [{id: "l1", label: "Groceries"}],
  repayments: [],
  entries: [
    {id: "e1", paidByStaffId: "staff1", amountCents: 4500, month: "2026-10",
      spentAt: day("2026-10-08"), note: "cups", lineId: "l1"},
    {id: "e2", paidByStaffId: "staff1", amountCents: 3000, month: "2026-09",
      spentAt: day("2026-09-08"), note: ""},
  ],
};
const BUSINESS = {name: "Keren Auto Sales", phone: "+1 347 559 6214",
  email: "pay@keren.example", addressLine1: "412 Atlantic Ave",
  city: "Brooklyn", state: "NY", postalCode: "11217",
  country: "United States"};

/**
 * The invoice of the first recipient the given records make.
 *
 * @param {object} [parts] {cars, activities, credit}.
 * @return {object} The recipient.
 */
function recipientOf({cars = CARS, activities = ACTIVITIES,
  credit = CREDIT} = {}) {
  const summary = parkingMonthSummary(cars, "2026-10", NOW, activities);
  return invoiceRecipients(summary, credit, NOW,
      {business: BUSINESS}).recipients[0];
}
const modelOf = (extra = {}, parts = {}) => invoiceModel({
  business: BUSINESS,
  recipient: recipientOf(parts),
  monthKey: "2026-10",
  issuedMs: NOW.getTime(),
  paymentInstructions: "Pay at the office, or Zelle 347-559-6214.",
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
  const out = [];
  for (const array of bytes.toString("latin1").match(/\[[^\]]*\]\s*TJ/g) ||
      []) {
    let line = "";
    for (const hex of array.match(/<([0-9a-fA-F]*)>/g) || []) {
      line += Buffer.from(hex.slice(1, -1), "hex").toString("latin1");
    }
    out.push(line);
  }
  return out;
}
const pagesOf = (bytes) =>
  (bytes.toString("latin1").match(/\/Type \/Page\b(?!s)/g) || []).length;

describe("the invoice's lines", () => {
  const m = modelOf();

  it("numbers the invoice and names it in both languages", () => {
    assert.equal(m.title, "INVOICE / FACTURE");
    assert.equal(m.reference, "INV-202610-1234-1");
    assert.equal(m.invoiceNumber, "INV-202610-1234-1");
  });

  it("is PAYMENT DUE while money is owed", () => {
    assert.deepEqual(m.status,
        {label: "PAYMENT DUE / À PAYER", paidInFull: false});
  });

  it("has the customer block, with the month and the date US style", () => {
    assert.deepEqual(m.rows, [
      {label: "Customer / Client", value: "Alimou Barry"},
      {label: "Phone / Téléphone", value: PHONE},
      {label: "Invoice for / Facture du mois",
        value: "October 2026 / octobre 2026"},
      {label: "Invoice date / Date de la facture", value: "Nov 3, 2026"},
    ]);
  });

  it("has one line per car: car, VIN, period, days x rate, month's amount",
      () => {
        const parking = m.sections[0];
        assert.equal(parking.heading, "Parking / Stationnement");
        assert.equal(parking.lines.length, 3);
        const camry = parking.lines.find((l) =>
          l.title === "2018 Toyota Camry");
        assert.equal(camry.detail, "VIN / NIV 1HGCM82633A004352");
        assert.equal(camry.period, "Oct 1, 2026 – Oct 31, 2026");
        assert.equal(camry.calc, "31 days / jours × $10.00");
        assert.equal(camry.amount, "$310.00");
        const accord = parking.lines.find((l) =>
          l.title === "2014 Honda Accord");
        assert.equal(accord.calc, "16 days / jours × $12.00");
        assert.equal(accord.amount, "$192.00");
      });

  it("says whose name a car was registered under when it differs", () => {
    const f150 = m.sections[0].lines.find((l) => l.title.includes("F-150"));
    assert.match(f150.detail,
        /Registered to \/ Au nom de A\. Barry \(garage\)/);
    const camry = m.sections[0].lines.find((l) => l.title.includes("Camry"));
    assert.doesNotMatch(camry.detail, /Registered to/);
  });

  it("lists the month's lot activities", () => {
    const acts = m.sections[1];
    assert.equal(acts.heading, "Activities / Activités");
    assert.deepEqual(acts.lines, [{title: "Tire change",
      detail: "2018 Toyota Camry", period: "Oct 14, 2026", calc: "",
      amount: "$80.00"}]);
  });

  it("adds up: total, unpaid from before, payments, expenses", () => {
    const by = Object.fromEntries(m.summary.map((s) => [s.label, s]));
    assert.equal(by["Total for October 2026 / Total pour octobre 2026"].value,
        "$882.00");
    const prior = by["Unpaid from before / Impayé des mois précédents"];
    assert.equal(prior.value, "$145.00");
    assert.deepEqual(prior.sub, [{
      label: "Sep 10, 2026 · Jump start · 2018 Toyota Camry",
      value: "$25.00"}]);
    assert.equal(by["Payments received / Paiements reçus"].value, "-$50.00");
    const expenses = m.summary.find((s) => s.label.startsWith("Less expenses"));
    assert.equal(expenses.value, "-$75.00");
    assert.deepEqual(expenses.sub, [
      {label: "Oct 8, 2026 · Groceries · cups · paid by / payé par " +
        "Mamadou Diallo", value: "-$45.00"},
      {label: "Expenses from earlier months / " +
        "Dépenses des mois précédents", value: "-$30.00"},
    ]);
    // 882 + 145 - 50 - 75
    assert.equal(m.balance.value, "$902.00");
    assert.equal(m.balance.label, "BALANCE DUE / SOLDE À PAYER");
    assert.equal(m.balance.note, "");
  });

  it("leaves out the lines that do not apply", () => {
    const plain = modelOf({}, {
      cars: [{id: "x", customerName: "Binta Diallo",
        customerPhone: "+12015550002", carYear: "2016", carMake: "Honda",
        carModel: "Civic", parkingDate: day("2026-10-10"),
        parkingEndDate: day("2026-10-19"), amountDueCents: 10000,
        totalCostCents: 10000, paymentMethod: "direct",
        trackingCode: "PK-1"}],
      activities: [], credit: null});
    assert.deepEqual(plain.summary.map((s) => s.label),
        ["Total for October 2026 / Total pour octobre 2026"]);
    assert.equal(plain.sections.length, 1);
  });

  it("is PAID UP when nothing is due, and says why it was sent", () => {
    const paidUp = modelOf({}, {
      cars: [{id: "y", customerName: "Binta Diallo",
        customerPhone: "+12015550002", carYear: "2016", carMake: "Honda",
        carModel: "Civic", parkingDate: day("2026-10-20"), dailyRate: 10,
        amountPaidCents: 12000, paymentMethod: "direct",
        trackingCode: "PK-2"}],
      activities: [], credit: null});
    assert.deepEqual(paidUp.status,
        {label: "PAID UP / À JOUR", paidInFull: true});
    assert.equal(paidUp.balance.value, "$0.00");
    assert.match(paidUp.balance.note, /still parked/);
    assert.match(paidUp.balance.note, /toujours stationnée/);
  });

  it("carries the owner's payment instructions, or nothing", () => {
    assert.deepEqual(m.instructions, {label: "How to pay / Comment payer",
      text: "Pay at the office, or Zelle 347-559-6214."});
    assert.equal(modelOf({paymentInstructions: ""}).instructions, null);
    assert.equal(modelOf({paymentInstructions: undefined}).instructions,
        null);
  });

  it("uses the business's header like the receipt: address, contact, logo",
      () => {
        assert.equal(m.businessName, "Keren Auto Sales");
        assert.equal(m.businessAddress,
            "412 Atlantic Ave, Brooklyn, NY 11217, United States");
        assert.equal(m.businessContact,
            "+1 347 559 6214  |  pay@keren.example");
        assert.match(m.logoUrl, /^https:\/\//);
        assert.equal(m.footer[1],
            "Issued through Laawol Digital · laawoldigital.com");
      });
});

describe("the invoice PDF", () => {
  it("is a real PDF", async () => {
    const bytes = await renderInvoicePdf(modelOf(), {fetchLogo: noLogo});
    assert.ok(Buffer.isBuffer(bytes));
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
    assert.ok(bytes.length > 1000);
    assert.match(bytes.subarray(-8).toString("latin1"), /%%EOF/);
  });

  it("prints the header, every car, the totals and the instructions",
      async () => {
        const bytes = await renderInvoicePdf(modelOf(),
            {compress: false, fetchLogo: noLogo});
        const lines = drawnText(bytes);
        const page = lines.join("\n");
        for (const expected of [
          "Keren Auto Sales", "412 Atlantic Ave", "INVOICE / FACTURE",
          "INV-202610-1234-1", "PAYMENT DUE / ", "Customer / Client",
          "Alimou Barry", "October 2026 / octobre 2026", "Nov 3, 2026",
          "Parking / Stationnement", "2018 Toyota Camry",
          "VIN / NIV 1HGCM82633A004352", "31 days / jours", "$310.00",
          "2014 Honda Accord", "$192.00", "2011 Ford F-150", "$300.00",
          "Activities / Activit", "Tire change", "$80.00",
          "Total for October 2026", "$882.00", "Unpaid from before",
          "$145.00", "Payments received", "-$50.00", "Less expenses",
          "-$75.00", "paid by / pay", "Mamadou Diallo",
          "BALANCE DUE / SOLDE ", "$902.00", "How to pay / Comment payer",
          "Pay at the office, or Zelle 347-559-6214.",
          "Thank you", "Issued through Laawol Digital",
        ]) {
          assert.ok(page.includes(expected),
              `missing "${expected}" in\n${page}`);
        }
        // French accents survive (WinAnsi).
        assert.ok(page.includes("Impay"), page);
        assert.ok(!lines.some((line) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(line)),
            "a numeric day-first date");
      });

  it("leaves out the payment instructions when there are none", async () => {
    const bytes = await renderInvoicePdf(modelOf({paymentInstructions: ""}),
        {compress: false, fetchLogo: noLogo});
    assert.ok(!drawnText(bytes).join("\n").includes("How to pay"));
  });

  it("says PAID UP with the $0.00 balance", async () => {
    const model = modelOf({}, {
      cars: [{id: "y", customerName: "Binta Diallo",
        customerPhone: "+12015550002", carYear: "2016", carMake: "Honda",
        carModel: "Civic", parkingDate: day("2026-10-20"), dailyRate: 10,
        amountPaidCents: 12000, paymentMethod: "direct",
        trackingCode: "PK-2"}],
      activities: [], credit: null});
    const page = drawnText(await renderInvoicePdf(model,
        {compress: false, fetchLogo: noLogo})).join("\n");
    assert.ok(page.includes("PAID UP / "), page);
    assert.ok(!page.includes("PAYMENT DUE"), page);
    assert.ok(page.includes("$0.00"), page);
    assert.ok(page.includes("Nothing is due"), page);
  });

  it("keeps the Balance due box with the totals and fits a typical " +
      "customer on one page", async () => {
    const one = modelOf({}, {
      cars: [CARS[1]], activities: [], credit: null});
    const bytes = await renderInvoicePdf(one,
        {compress: false, fetchLogo: noLogo});
    assert.equal(pagesOf(bytes), 1);
  });

  it("runs onto more pages for a lot of cars, each page saying whose " +
      "invoice it is, and never splits a row", async () => {
    const many = Array.from({length: 40}, (_, i) => ({
      id: `m${i}`, customerName: "Fleet Co", customerPhone: "+12015559999",
      carYear: "2020", carMake: "Ford", carModel: `Transit ${i}`,
      vinNumber: `VIN${String(i).padStart(14, "0")}`,
      trackingCode: `PK-M${i}`, parkingDate: day("2026-10-01"),
      parkingEndDate: day("2026-10-10"), amountDueCents: 5000,
      totalCostCents: 5000, paymentMethod: "direct"}));
    const model = modelOf({}, {cars: many, activities: [], credit: null});
    const bytes = await renderInvoicePdf(model,
        {compress: false, fetchLogo: noLogo});
    assert.ok(pagesOf(bytes) >= 3, `only ${pagesOf(bytes)} pages`);
    const lines = drawnText(bytes);
    const page = lines.join("\n");
    assert.ok(page.includes("(continued / suite)"), page);
    for (let i = 0; i < 40; i += 1) {
      assert.ok(page.includes(`Transit ${i}`), `lost Transit ${i}`);
    }
    // The total is on the last page with the box and the footer.
    assert.ok(page.includes("$2,000.00"), page);
    assert.ok(page.includes("BALANCE DUE / SOLDE "), page);
    assert.ok(page.includes("Issued through Laawol Digital"), page);
  });

  it("draws the logo when the business has one, else the initial",
      async () => {
        const png = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA" +
            "DUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
        const withLogo = await renderInvoicePdf(modelOf(),
            {compress: false, fetchLogo: () => Promise.resolve(png)});
        const without = await renderInvoicePdf(modelOf(),
            {compress: false, fetchLogo: noLogo});
        assert.match(withLogo.toString("latin1"), /\/Subtype \/Image/);
        assert.doesNotMatch(without.toString("latin1"), /\/Subtype \/Image/);
        assert.ok(drawnText(without).includes("K"), "no placeholder initial");
      });

  it("still makes the invoice when the logo never arrives", async () => {
    const started = Date.now();
    const bytes = await renderInvoicePdf(modelOf(), {compress: false,
      logoTimeoutMs: 50, fetchLogo: () => new Promise(() => {})});
    assert.ok(Date.now() - started < 2000);
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  });
});
