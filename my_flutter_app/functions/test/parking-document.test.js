"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  PARKING_DOCUMENT_TYPES,
  parkingDocumentType,
  parkingDocumentTitle,
  parkingDocumentModel,
  renderParkingDocument,
} = require("../parking_document");

const PAID_ENTRY = {
  trackingCode: "PK-M4W38G",
  customerName: "nene nane",
  customerPhone: "9175177935",
  customerEmail: "nene@example.com",
  carYear: "1994", carMake: "Audi", carModel: "100/200",
  vinNumber: "WAUZZZ44",
  parkingDate: "2026-08-08",
  parkingEndDate: "2026-08-13",
  amountDueCents: 2500,
  paymentMethod: "payment_link",
  paymentStatus: "succeeded",
};

const UNPAID_ENTRY = {
  ...PAID_ENTRY,
  trackingCode: "PK-4SCHTC",
  amountDueCents: 3500,
  paymentStatus: "pending",
};

const BUSINESS = {name: "Business 1", city: "New York", state: "NY"};
const LINK = "https://example.com/parkingPaymentLink?t=abc";

describe("parkingDocumentType", () => {
  it("pays out a receipt only when the money actually arrived", () => {
    assert.equal(parkingDocumentType({paymentStatus: "succeeded"}),
        PARKING_DOCUMENT_TYPES.RECEIPT);
    assert.equal(parkingDocumentType({paymentStatus: "paid"}),
        PARKING_DOCUMENT_TYPES.RECEIPT);
  });

  it("anything still owed is an invoice", () => {
    for (const status of
      ["pending", "awaiting_direct_payment", "failed", "", undefined]) {
      assert.equal(parkingDocumentType({paymentStatus: status}),
          PARKING_DOCUMENT_TYPES.INVOICE,
          `${status} should be an invoice`);
    }
    assert.equal(parkingDocumentType(null), PARKING_DOCUMENT_TYPES.INVOICE);
  });

  it("titles read the way a business would say them", () => {
    assert.equal(parkingDocumentTitle(PARKING_DOCUMENT_TYPES.RECEIPT),
        "Receipt");
    assert.equal(parkingDocumentTitle(PARKING_DOCUMENT_TYPES.INVOICE),
        "Invoice");
  });
});

describe("parkingDocumentModel", () => {
  it("builds a receipt with the amount paid and no payment link", () => {
    const model = parkingDocumentModel({
      entry: PAID_ENTRY, business: BUSINESS, paymentLinkUrl: LINK,
    });
    assert.equal(model.paid, true);
    assert.equal(model.title, "Receipt");
    assert.equal(model.reference, "REC-PK-M4W38G");
    assert.equal(model.amount, "$25.00");
    assert.equal(model.car, "1994 Audi 100/200");
    assert.equal(model.businessCity, "New York, NY");
    assert.equal(model.methodLabel, "Card payment (Stripe)");
    // Printing a live payment link on a receipt invites a second payment.
    assert.equal(model.paymentLinkUrl, "");
  });

  it("builds an invoice that carries the way to pay", () => {
    const model = parkingDocumentModel({
      entry: UNPAID_ENTRY, business: BUSINESS, paymentLinkUrl: LINK,
    });
    assert.equal(model.paid, false);
    assert.equal(model.title, "Invoice");
    assert.equal(model.reference, "INV-PK-4SCHTC");
    assert.equal(model.amount, "$35.00");
    assert.equal(model.paymentLinkUrl, LINK);
  });

  it("labels a direct payment as settled with the business", () => {
    const model = parkingDocumentModel({
      entry: {...PAID_ENTRY, paymentMethod: "direct", paymentStatus: "paid"},
      business: BUSINESS,
    });
    assert.equal(model.methodLabel, "Paid directly to the business");
  });

  it("survives a sparse record without throwing", () => {
    const model = parkingDocumentModel({entry: {}, business: {}});
    assert.equal(model.amount, "$0.00");
    assert.equal(model.car, "");
    assert.equal(model.title, "Invoice");
  });
});

describe("renderParkingDocument", () => {
  it("a receipt stamps PAID and omits any pay-online block", () => {
    const html = renderParkingDocument(parkingDocumentModel({
      entry: PAID_ENTRY, business: BUSINESS, paymentLinkUrl: LINK,
    }));
    assert.match(html, /<!doctype html>/i);
    assert.match(html, />PAID</);
    assert.match(html, /Amount paid/);
    assert.match(html, /Business 1/);
    assert.match(html, /laawoldigital\.com\/assets\/logo\.png/);
    assert.ok(!html.includes("Pay online"),
        "a receipt must not invite payment");
    assert.ok(!html.includes(LINK), "a receipt must not carry a live link");
  });

  it("an invoice stamps PAYMENT DUE and prints the link", () => {
    const html = renderParkingDocument(parkingDocumentModel({
      entry: UNPAID_ENTRY, business: BUSINESS, paymentLinkUrl: LINK,
    }));
    assert.match(html, />PAYMENT DUE</);
    assert.match(html, /Amount due/);
    assert.match(html, /Pay online/);
    assert.ok(html.includes(LINK));
  });

  it("prints without the on-screen button and escapes hostile input", () => {
    const html = renderParkingDocument(parkingDocumentModel({
      entry: {...PAID_ENTRY, customerName: "<script>alert(1)</script>"},
      business: BUSINESS,
    }));
    // The print button is screen-only, or every printout wastes a line on it.
    assert.match(html, /@media print\{[\s\S]*\.actions\{display:none\}/);
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.match(html, /&lt;script&gt;/);
  });

  it("omits rows the record does not have, rather than printing blanks", () => {
    const html = renderParkingDocument(parkingDocumentModel({
      entry: {...UNPAID_ENTRY, vinNumber: "", customerEmail: ""},
      business: BUSINESS, paymentLinkUrl: LINK,
    }));
    assert.ok(!html.includes(">VIN<"));
    assert.ok(!html.includes(">Email<"));
    assert.match(html, />Vehicle</);
  });
});
