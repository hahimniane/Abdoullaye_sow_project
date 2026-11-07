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
    assert.equal(rows["Phone / Téléphone"], "(201) 555-0142");
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
    assert.equal(m.businessContact, "(201) 555-0100  |  hi@nensona.com");
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
      "Nensona Parking", "12 Main St", "(201) 555-0100  |  hi@nensona.com",
      "RECEIPT / RE", "REC-PK-K7M4P2-2", "PARTLY PAID / PAY",
      "Customer / Client", "Alimou Barry", "(201) 555-0142",
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

// The package receipt the sender gets with "package received"
// (docs/WHATSAPP_CONTAINER_UPDATES.md "Package receipt for the sender").
describe("the package receipt", () => {
  const {packageReceiptModel, usDateTime} =
    require("../parking_receipt_pdf");
  const RECEIVED = Date.parse("2026-11-07T20:42:00Z");
  const LINE = {
    trackingCode: "CL-K7M4P2", customerName: "Fatou Diallo",
    customerPhone: "+16465550100", receiverName: "Mariama Bah",
    receiverPhone: "+224620000000", shipMode: "sea", priceCents: 30000,
    paidCents: 10000, receivedAt: {toMillis: () => RECEIVED},
  };
  const pkg = (extra = {}, line = {}) => packageReceiptModel({
    business: {name: "Dala Shipping", phone: "+16465550199"},
    line: {...LINE, ...line},
    contentsEn: "2 barrels, 1 box", contentsFr: "2 barils, 1 carton",
    destinationEn: "Guinea", destinationFr: "Guinée",
    receivedByName: "Awa Cashier", ...extra,
  });

  it("shows the date US style, month first, with a 12-hour clock", () => {
    assert.equal(usDateTime(RECEIVED), "Nov 7, 2026, 3:42 PM");
    assert.equal(usDateTime(Date.parse("2026-11-07T17:05:00Z")),
        "Nov 7, 2026, 12:05 PM");
    assert.equal(usDateTime(Date.parse("2026-11-08T05:09:00Z")),
        "Nov 8, 2026, 12:09 AM");
    // The business's own day.
    assert.equal(usDateTime(RECEIVED, "America/Los_Angeles"),
        "Nov 7, 2026, 12:42 PM");
    assert.equal(usDateTime(0), "");
  });

  it("lists the package's rows, every label in English and French", () => {
    const m = pkg();
    assert.equal(m.title, "PACKAGE RECEIPT\nREÇU DE COLIS");
    assert.equal(m.reference, "REC-CL-K7M4P2");
    assert.deepEqual(m.rows.map((r) => r.label.split(" / ")[0]), [
      "Status", "Sender", "Phone", "Receiver", "Destination", "Contents",
      "Ship mode", "Tracking code", "Received on", "Received by"]);
    for (const row of m.rows) assert.match(row.label, / \/ /);
    const rows = rowsOf(m);
    assert.equal(rows["Status / Statut"], "Package received / Colis reçu");
    assert.equal(rows["Sender / Expéditeur"], "Fatou Diallo");
    assert.equal(rows["Receiver / Destinataire"], "Mariama Bah");
    assert.equal(rows["Destination / Destination"], "Guinea / Guinée");
    assert.equal(rows["Contents / Contenu"],
        "2 barrels, 1 box / 2 barils, 1 carton");
    assert.equal(rows["Ship mode / Mode d'expédition"], "Sea / Mer");
    assert.equal(rows["Tracking code / Code de suivi"], "CL-K7M4P2");
    assert.equal(rows["Received on / Reçu le"], "Nov 7, 2026, 3:42 PM");
    assert.equal(rows["Received by / Reçu par"], "Awa Cashier");
  });

  it("prints the sender's own phone and never the receiver's", () => {
    const m = pkg();
    assert.equal(rowsOf(m)["Phone / Téléphone"], "(646) 555-0100");
    assert.ok(!JSON.stringify(m).includes("+224620000000"));
    assert.ok(!JSON.stringify(m).includes("224620000000"));
  });

  it("says a value once when both languages read the same", () => {
    const rows = rowsOf(pkg({contentsEn: "2 × TV", contentsFr: "2 × TV",
      destinationEn: "Mali", destinationFr: "Mali"}, {shipMode: "air"}));
    assert.equal(rows["Contents / Contenu"], "2 × TV");
    assert.equal(rows["Destination / Destination"], "Mali");
    assert.equal(rows["Ship mode / Mode d'expédition"], "Air / Avion");
  });

  it("totals the box: price, paid so far, and the balance owed", () => {
    const m = pkg();
    assert.deepEqual(m.amount,
        {label: "TOTAL PRICE / PRIX TOTAL", value: "$300.00"});
    assert.deepEqual(m.totals, [
      {label: "Paid so far / Payé à ce jour", value: "$100.00"},
      {label: "Balance owed / Solde à payer", value: "$200.00",
        tone: "due"},
    ]);
    assert.deepEqual(m.status,
        {label: "PARTLY PAID / PAYÉ EN PARTIE", paidInFull: false});
  });

  it("says Paid in full, Pay on arrival, or that the price is to come",
      () => {
        const paid = pkg({}, {paidCents: 30000});
        assert.deepEqual(paid.status,
            {label: "PAID / PAYÉ", paidInFull: true});
        assert.deepEqual(paid.totals[1], {label: "Balance / Solde",
          value: "Paid in full / Payé en totalité", tone: "paid"});
        const arrival = pkg({}, {paidCents: 0, payOnArrival: true});
        assert.equal(arrival.status.label,
            "PAY ON ARRIVAL / À PAYER À L'ARRIVÉE");
        assert.equal(arrival.totals[1].value,
            "Pay on arrival / Payer à l'arrivée");
        assert.equal(arrival.totals[0].value, "$0.00");
        const unpriced = pkg({}, {priceCents: null, paidCents: 0});
        assert.equal(unpriced.amount.value, "—");
        assert.equal(unpriced.totals[1].value,
            "To be confirmed / À confirmer");
        assert.equal(pkg({}, {paidCents: 0}).status.label,
            "NOT PAID YET / PAS ENCORE PAYÉ");
      });

  it("leaves out what it does not know", () => {
    const m = packageReceiptModel({business: {},
      line: {trackingCode: "CL-1"}, contentsEn: "", contentsFr: "",
      destinationEn: "", destinationFr: ""});
    const labels = m.rows.map((r) => r.label.split(" / ")[0]);
    for (const gone of ["Sender", "Phone", "Receiver", "Destination",
      "Contents", "Ship mode", "Received on", "Received by"]) {
      assert.ok(!labels.includes(gone), gone);
    }
    assert.equal(m.businessName, "Laawol");
    assert.equal(m.reference, "REC-CL-1");
  });

  it("is a real PDF with the receipt's words and no receiver phone",
      async () => {
        const bytes = await renderReceiptPdf(pkg(), {
          compress: false, fetchLogo: () => Promise.resolve(null)});
        assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
        assert.match(bytes.subarray(-8).toString("latin1"), /%%EOF/);
        const words = drawnText(bytes).join("\n");
        for (const expected of ["PACKAGE RECEIPT", "REÇU DE COLIS",
          "REC-CL-K7M4P2",
          "Fatou Diallo", "Mariama Bah", "Guinea / Gu", "CL-K7M4P2",
          "Nov 7, 2026, 3:42 PM", "Awa Cashier", "$300.00", "$100.00",
          "$200.00", "Dala Shipping"]) {
          assert.ok(words.includes(expected), `${expected}\n${words}`);
        }
        assert.ok(!words.includes("224620000000"));
      });
});
