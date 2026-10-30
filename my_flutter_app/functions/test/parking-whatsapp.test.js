"use strict";

// The pure rules of parking customers on WhatsApp
// (docs/PARKING_WHATSAPP.md): who is told what from a parkedCars write, the
// payment ids and message rows that make each message happen once, the words
// each template carries, the welcome's grouping by phone, and the signed
// receipt link.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {describe, it} = require("node:test");

const wa = require("../parking_whatsapp");
const {parkingTemplateMessage} = require("../whatsapp_templates");
const {parkingBalanceNow} = require("../parking_month_statement");
const {
  receiptLink,
  receiptLinkValid,
  photoLink,
  photoLinkValid,
  PHOTO_LINK_MS,
} = require("../package_proof");

const NOW = new Date("2026-10-29T15:00:00Z");
const BIZ = "lot-1";
const CAR_ID = "car-1";
const stamp = (iso) => ({
  toMillis: () => Date.parse(iso), seconds: Date.parse(iso) / 1000});

const car = (extra = {}) => ({
  businessId: BIZ,
  source: "business",
  enteredByBusiness: true,
  trackingCode: "PK-K7M4P2",
  customerName: "Alimou Barry",
  customerPhone: "+12015551234",
  carYear: "2014", carMake: "Toyota", carModel: "Corolla",
  parkingDate: "2026-10-20T12:00:00Z",
  dailyRate: 10,
  paymentMethod: "direct",
  paymentStatus: "awaiting_direct_payment",
  status: "reserved",
  ...extra,
});

const payment = (extra = {}) => ({
  amountCents: 3000, receivedVia: "cash", receivedByStaffId: "staff-1",
  at: stamp("2026-10-29T14:00:00Z"), ...extra});

const plan = (before, after, extra = {}) => wa.plannedMessages({
  businessId: BIZ, carId: CAR_ID, before, after,
  eventMs: NOW.getTime(), now: NOW, ...extra});

describe("the payment id", () => {
  it("is the payment's own id when it has a safe one", () => {
    assert.equal(wa.paymentIdOf({businessId: BIZ, carId: CAR_ID,
      payment: {id: "pay_123", amountCents: 100}}), "pay_123");
  });

  it("is derived from business, car, amount and moment when it has none",
      () => {
        const p = payment();
        const expected = "p_" + crypto.createHash("sha1").update(
            `${BIZ}|${CAR_ID}|3000|${Date.parse("2026-10-29T14:00:00Z")}`)
            .digest("hex").slice(0, 20);
        assert.equal(wa.paymentIdOf({businessId: BIZ, carId: CAR_ID,
          payment: p}), expected);
        // Stable: the same payment is the same id again.
        assert.equal(wa.paymentIdOf({businessId: BIZ, carId: CAR_ID,
          payment: {...p}}), expected);
        assert.match(expected, /^p_[0-9a-f]{20}$/);
      });

  it("differs for another amount, moment or car", () => {
    const id = (p, carId = CAR_ID) =>
      wa.paymentIdOf({businessId: BIZ, carId, payment: p});
    const base = id(payment());
    assert.notEqual(id(payment({amountCents: 3100})), base);
    assert.notEqual(id(payment({at: stamp("2026-10-29T14:00:01Z")})), base);
    assert.notEqual(id(payment(), "car-2"), base);
  });

  it("ignores an unsafe own id and derives one instead", () => {
    const id = wa.paymentIdOf({businessId: BIZ, carId: CAR_ID,
      payment: {id: "../escape", amountCents: 500}});
    assert.match(id, /^p_[0-9a-f]{20}$/);
  });
});

describe("which messages one write calls for", () => {
  it("welcomes a car that was just created, and nothing else", () => {
    const created = car({parkingPayments: [payment()]});
    const result = plan(null, created);
    assert.equal(result.parked, true);
    assert.deepEqual(result.receipts, []);
  });

  it("sends nothing for an edit that adds no payment", () => {
    const before = car({parkingPayments: [payment()]});
    const after = {...before, customerName: "Alimou B.",
      occupancyEndMs: 1, customerPhoneE164: "+12015551234"};
    assert.deepEqual(plan(before, after), {parked: false, receipts: []});
  });

  it("sends one receipt per payment just added, numbered in order", () => {
    const first = payment();
    const second = payment({amountCents: 2000,
      at: stamp("2026-10-29T14:30:00Z")});
    const third = payment({amountCents: 500,
      at: stamp("2026-10-29T14:45:00Z")});
    const before = car({parkingPayments: [first]});
    const after = car({parkingPayments: [first, second, third]});
    const {parked, receipts} = plan(before, after);
    assert.equal(parked, false);
    assert.deepEqual(receipts.map((r) => [r.amountCents, r.number]),
        [[2000, 2], [500, 3]]);
    assert.notEqual(receipts[0].id, receipts[1].id);
  });

  it("is idempotent: the same event again names the same payment", () => {
    const before = car({parkingPayments: []});
    const after = car({parkingPayments: [payment()]});
    assert.equal(plan(before, after).receipts[0].id,
        plan(before, after).receipts[0].id);
  });

  it("sends nothing when a payment is reverted", () => {
    const before = car({parkingPayments: [payment()],
      paymentStatus: "awaiting_direct_payment", amountPaidCents: 3000});
    const after = car({parkingPayments: [], amountPaidCents: 0,
      revertedParkingPayments: [payment()]});
    assert.deepEqual(plan(before, after), {parked: false, receipts: []});
  });

  it("skips an entry marked reverted", () => {
    const before = car({parkingPayments: []});
    const after = car({parkingPayments: [payment({reverted: true})]});
    assert.deepEqual(plan(before, after).receipts, []);
  });

  it("sends nothing about a voided or cancelled car", () => {
    for (const extra of [{voided: true}, {status: "cancelled"}]) {
      assert.deepEqual(plan(null, car(extra)),
          {parked: false, receipts: []});
      assert.deepEqual(plan(car({parkingPayments: []}),
          car({...extra, parkingPayments: [payment()]})),
      {parked: false, receipts: []});
    }
  });

  it("is only about cars the lot entered itself", () => {
    const own = {source: undefined, enteredByBusiness: false};
    assert.deepEqual(plan(null, car(own)), {parked: false, receipts: []});
  });

  it("counts a car marked paid in full as one payment for what it added",
      () => {
        const before = car({parkingEndDate: "2026-10-25T12:00:00Z",
          amountDueCents: 6000, amountPaidCents: 2000,
          parkingPayments: [payment({amountCents: 2000})]});
        const after = {...before, paymentStatus: "paid",
          amountPaidCents: 6000,
          directPaymentReceivedAt: stamp("2026-10-29T14:59:00Z")};
        const {receipts} = plan(before, after);
        assert.equal(receipts.length, 1);
        assert.equal(receipts[0].amountCents, 4000);
        assert.equal(receipts[0].synthetic, true);
        assert.equal(receipts[0].number, 2);
        assert.equal(receipts[0].atMs, Date.parse("2026-10-29T14:59:00Z"));
      });

  it("counts a payment link paid through Stripe", () => {
    const before = car({paymentMethod: "payment_link",
      paymentStatus: "pending", status: "pending_payment",
      parkingEndDate: "2026-10-25T12:00:00Z", amountDueCents: 6000});
    const after = {...before, paymentStatus: "succeeded",
      status: "reserved"};
    const {receipts} = plan(before, after);
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].amountCents, 6000);
    assert.equal(receipts[0].receivedVia, "card_link");
    // No stored moment: the event's own.
    assert.equal(receipts[0].atMs, NOW.getTime());
  });

  it("does not count the same settle twice, nor one already settled", () => {
    const settled = car({paymentStatus: "paid", amountPaidCents: 6000,
      parkingEndDate: "2026-10-25T12:00:00Z", amountDueCents: 6000});
    assert.deepEqual(plan(settled, {...settled, customerName: "X"}).receipts,
        []);
  });

  it("does not add a settle on top of the instalment that settled it",
      () => {
        const before = car({parkingEndDate: "2026-10-25T12:00:00Z",
          amountDueCents: 6000, amountPaidCents: 3000,
          parkingPayments: [payment()]});
        const last = payment({amountCents: 3000,
          at: stamp("2026-10-29T14:30:00Z")});
        const after = {...before, paymentStatus: "paid",
          amountPaidCents: 6000, parkingPayments: [payment(), last]};
        const {receipts} = plan(before, after);
        assert.equal(receipts.length, 1);
        assert.equal(receipts[0].synthetic, undefined);
        assert.equal(receipts[0].amountCents, 3000);
      });
});

describe("the switch", () => {
  it("is off unless the owner turned it on", () => {
    assert.equal(wa.parkingWhatsAppEnabled({}), false);
    assert.equal(wa.parkingWhatsAppEnabled({parkingWhatsApp: {}}), false);
    assert.equal(wa.parkingWhatsAppEnabled(
        {parkingWhatsApp: {enabled: false}}), false);
    assert.equal(wa.parkingWhatsAppEnabled(
        {parkingWhatsApp: {enabled: true}}), true);
  });

  it("does not announce what happened before it was switched on", () => {
    const business = {parkingWhatsApp: {enabled: true, enabledAtMs: 1000}};
    assert.equal(wa.switchAllows(business, 2000), true);
    assert.equal(wa.switchAllows(business, 500), false);
    // An event with no time (a direct call) is not held back.
    assert.equal(wa.switchAllows(business, 0), true);
    assert.equal(wa.switchAllows({}, 2000), false);
  });
});

describe("the rows", () => {
  it("names each message once", () => {
    assert.equal(wa.messageRowId("parked", {carId: "c1"}), "c1_parked");
    assert.equal(wa.messageRowId("receipt", {carId: "c1", paymentId: "p_9"}),
        "c1_pay_p_9");
    assert.equal(wa.messageRowId("welcome", {businessId: "b1",
      phone: "+1 (201) 555-1234"}), "welcome_b1_12015551234");
  });

  it("finds a number to message, or says why not", () => {
    const usLot = {country: "United States"};
    assert.deepEqual(wa.reachablePhone(car({customerPhone: "2015551234"}),
        usLot), {phone: "+12015551234", error: ""});
    assert.deepEqual(wa.reachablePhone(car(), {}),
        {phone: "+12015551234", error: ""});
    assert.deepEqual(wa.reachablePhone(car({customerPhone: ""}), usLot),
        {phone: "", error: "no_phone"});
    assert.deepEqual(wa.reachablePhone(car({customerPhone: "620123456"}),
        usLot), {phone: "", error: "needs_country_code"});
  });
});

describe("the words", () => {
  it("writes money in both languages", () => {
    assert.equal(wa.moneyEn(1200), "$12.00");
    assert.equal(wa.moneyEn(123456), "$1,234.56");
    assert.equal(wa.moneyFr(1200), "12,00 $");
    assert.equal(wa.moneyFr(123456), "1 234,56 $");
    assert.equal(wa.rateEn(1200), "$12.00 a day");
    assert.equal(wa.rateFr(1200), "12,00 $ par jour");
  });

  it("writes a day month-first in English and day-first in French", () => {
    assert.equal(wa.dayText("2026-10-29", "en"), "October 29, 2026");
    assert.equal(wa.dayText("2026-10-29", "fr"), "29 octobre 2026");
    assert.equal(wa.dayText("2026-02-01", "fr"), "1er février 2026");
    assert.equal(wa.dayText("nonsense", "en"), "");
  });

  it("lists cars so the phrase stays short", () => {
    assert.equal(wa.carsPhrase([], "en"), "");
    assert.equal(wa.carsPhrase(["A"], "en"), "A");
    assert.equal(wa.carsPhrase(["A", "B"], "en"), "A and B");
    assert.equal(wa.carsPhrase(["A", "B", "C"], "en"), "A, B and C");
    assert.equal(wa.carsPhrase(["A", "B", "C", "D", "E"], "en"),
        "A, B and 3 more");
    assert.equal(wa.carsPhrase(["A", "B", "C", "D", "E"], "fr"),
        "A, B et 3 autres");
    assert.equal(wa.carsPhrase(["A", "B"], "fr"), "A et B");
  });

  it("says what is owed, or that it is paid", () => {
    assert.equal(wa.balanceLine({balanceCents: 4500}, "en"),
        "Balance owed: $45.00");
    assert.equal(wa.balanceLine({balanceCents: 4500}, "fr"),
        "Solde à payer : 45,00 $");
    assert.equal(wa.balanceLine({paidInFull: true, balanceCents: 0}, "en"),
        "Paid in full");
    assert.equal(wa.balanceLine({paidInFull: true, balanceCents: 0}, "fr"),
        "Payé en totalité");
  });

  it("fills the parked message from the car", () => {
    assert.deepEqual(wa.parkedValues(car(), {name: "Dala Parking",
      phone: "+13475550100"}, NOW), {
      name: "Alimou Barry",
      business: "Dala Parking",
      businessPhone: "+13475550100",
      trackingCode: "PK-K7M4P2",
      carEn: "2014 Toyota Corolla", carFr: "2014 Toyota Corolla",
      parkedOnEn: "October 20, 2026", parkedOnFr: "20 octobre 2026",
      rateEn: "$10.00 a day", rateFr: "10,00 $ par jour",
    });
  });

  it("fills the receipt from the payment and the balance now", () => {
    const row = car({amountPaidCents: 3000,
      parkingPayments: [payment()]});
    const balance = parkingBalanceNow(row, NOW);
    assert.deepEqual(wa.receiptValues(row, {name: "Dala Parking",
      phone: "+13475550100"}, {amountCents: 3000}, balance), {
      name: "Alimou Barry",
      business: "Dala Parking",
      businessPhone: "+13475550100",
      trackingCode: "PK-K7M4P2",
      amountEn: "$30.00", amountFr: "30,00 $",
      carEn: "2014 Toyota Corolla", carFr: "2014 Toyota Corolla",
      paidTotalEn: "$30.00", paidTotalFr: "30,00 $",
      balanceEn: "Balance owed: $70.00",
      balanceFr: "Solde à payer : 70,00 $",
    });
    const paid = parkingBalanceNow(car({amountPaidCents: 10000,
      parkingPayments: [payment({amountCents: 10000})]}), NOW);
    assert.equal(wa.receiptValues(row, {}, {amountCents: 1}, paid).balanceEn,
        "Paid in full");
  });

  it("builds messages the templates can send", () => {
    const body = parkingTemplateMessage({
      template: "parking_parked_2lang", phone: "+1 (201) 555-1234",
      values: wa.parkedValues(car(), {name: "Dala"}, NOW)});
    assert.equal(body.to, "12015551234");
    assert.equal(body.template.name, "parking_parked_2lang");
    assert.equal(body.template.components[0].parameters.length, 11);
  });
});

describe("the welcome to cars already parked", () => {
  const rows = [
    car({id: "a", customerPhone: "+12015551234",
      customerName: "Alimou Barry", parkingDate: "2026-10-01T12:00:00Z",
      carYear: "2014", carMake: "Toyota", carModel: "Corolla",
      trackingCode: "PK-AAA"}),
    car({id: "b", customerPhone: "+1 (201) 555-1234",
      customerName: "alimou barry", parkingDate: "2026-10-15T12:00:00Z",
      carYear: "2016", carMake: "Toyota", carModel: "RAV4",
      trackingCode: "PK-BBB"}),
    car({id: "c", customerPhone: "2015559999", customerName: "Fatou Diallo",
      trackingCode: "PK-CCC"}),
    // Not on the lot: left, voided, cancelled, arriving later.
    car({id: "d", customerPhone: "+12015550000",
      parkingEndDate: "2026-10-25T12:00:00Z", amountDueCents: 5000}),
    car({id: "e", customerPhone: "+12015550001", voided: true}),
    car({id: "f", customerPhone: "+12015550002", status: "cancelled"}),
    car({id: "g", customerPhone: "+12015550003",
      parkingDate: "2026-11-05T12:00:00Z"}),
    // Cannot be reached.
    car({id: "h", customerPhone: "620123456", customerName: "Mamadou"}),
    car({id: "i", customerPhone: "", customerName: "Nobody"}),
  ];
  const business = {name: "Dala Parking", country: "United States",
    phone: "+13475550100"};

  it("groups the cars still parked by phone, one recipient each", () => {
    const {recipients} = wa.welcomeRecipients({cars: rows, business,
      welcomed: new Set(), now: NOW});
    assert.deepEqual(recipients.map((r) => r.phone),
        ["+12015551234", "+12015559999"]);
    const alimou = recipients[0];
    assert.equal(alimou.name, "Alimou Barry");
    // Most recently parked first; that car's code rides the button.
    assert.deepEqual(alimou.cars.map((c) => c.id), ["b", "a"]);
    assert.equal(alimou.trackingCode, "PK-BBB");
    assert.deepEqual(alimou.cars[0],
        {id: "b", label: "2016 Toyota RAV4", trackingCode: "PK-BBB"});
    assert.equal(alimou.alreadyWelcomed, false);
    assert.equal(recipients[1].cars.length, 1);
  });

  it("flags a number already sent a parked or welcome message", () => {
    const {recipients} = wa.welcomeRecipients({cars: rows, business,
      welcomed: new Set(["12015551234"]), now: NOW});
    assert.deepEqual(recipients.map((r) => [r.phone, r.alreadyWelcomed]),
        [["+12015551234", true], ["+12015559999", false]]);
  });

  it("lists the numbers it cannot message, with why", () => {
    const {skipped} = wa.welcomeRecipients({cars: rows, business,
      welcomed: new Set(), now: NOW});
    assert.deepEqual(skipped.map((s) => [s.name, s.reason]).sort(),
        [["Mamadou", "needs_country_code"], ["Nobody", "no_phone"]]);
  });

  it("fills the welcome from the recipient", () => {
    const {recipients} = wa.welcomeRecipients({cars: rows, business,
      welcomed: new Set(), now: NOW});
    assert.deepEqual(wa.welcomeValues(recipients[0], business), {
      name: "Alimou Barry",
      business: "Dala Parking",
      businessPhone: "+13475550100",
      trackingCode: "PK-BBB",
      carsEn: "2016 Toyota RAV4 and 2014 Toyota Corolla",
      carsFr: "2016 Toyota RAV4 et 2014 Toyota Corolla",
    });
  });

  it("knows a car is on the lot only between arriving and leaving", () => {
    assert.equal(wa.carIsParkedNow(rows[0], NOW), true);
    assert.equal(wa.carIsParkedNow(rows[3], NOW), false);
    assert.equal(wa.carIsParkedNow(rows[6], NOW), false);
    assert.equal(wa.carIsParkedNow(null, NOW), false);
  });
});

describe("the receipt link", () => {
  const base = "https://us-central1-p.cloudfunctions.net/parkingDocument";
  const token = "tok_tok_tok_tok_tok_tok_tok_tok";
  const nowMs = Date.parse("2026-10-29T15:00:00Z");
  const query = (url) => Object.fromEntries(new URL(url).searchParams);

  it("is valid for 30 days, then not", () => {
    const url = receiptLink({base, token, paymentId: "p_abc",
      expiresMs: nowMs + PHOTO_LINK_MS});
    assert.ok(url.startsWith(`${base}?view=receiptPdf&t=${token}&p=p_abc&e=`));
    assert.equal(receiptLinkValid(query(url), token, nowMs), true);
    assert.equal(receiptLinkValid(query(url), token,
        nowMs + PHOTO_LINK_MS + 1), false);
  });

  it("refuses another token, payment, expiry or signature", () => {
    const q = query(receiptLink({base, token, paymentId: "p_abc",
      expiresMs: nowMs + 1000000}));
    assert.equal(receiptLinkValid(q, "other-token", nowMs), false);
    assert.equal(receiptLinkValid({...q, p: "p_other"}, token, nowMs), false);
    assert.equal(receiptLinkValid({...q, e: String(Number(q.e) + 1)}, token,
        nowMs), false);
    assert.equal(receiptLinkValid({...q, s: "0".repeat(q.s.length)}, token,
        nowMs), false);
    assert.equal(receiptLinkValid({...q, s: "short"}, token, nowMs), false);
    assert.equal(receiptLinkValid({...q, p: "../x"}, token, nowMs), false);
    assert.equal(receiptLinkValid(q, "", nowMs), false);
  });

  it("is not a photo link, and a photo link is not a receipt link", () => {
    const expiresMs = nowMs + 1000000;
    const receipt = query(receiptLink({base, token, paymentId: "p_abc",
      expiresMs}));
    assert.equal(photoLinkValid(receipt, token, nowMs), false);
    const photo = query(photoLink({base, token,
      path: "packagePhotos/biz/uid/file12345.jpg", expiresMs}));
    assert.equal(receiptLinkValid({...photo, p: "p_abc"}, token, nowMs),
        false);
  });
});
