"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  containerCustomsModel,
  customsContentsText,
  renderContainerCustoms,
  usdText,
} = require("../container_customs");

const business = {
  name: "Conakry Express Shipping", phone: "+1 646 555 0100",
  email: "ops@example.com", addressLine1: "3184 Webster Ave", city: "Bronx",
  state: "NY", postalCode: "10467", country: "USA",
};
const stamp = (iso) => ({toDate: () => new Date(iso)});
const flight = (extra = {}) => ({
  shipMode: "air", airWaybill: "176-12345678", airline: "Air France",
  label: "Friday flight", destinationCountryName: "Guinea",
  status: "shipped", sailedAt: stamp("2026-10-03"),
  createdAt: stamp("2026-10-01"), ...extra,
});
const lines = [
  {trackingCode: "CL-K7M4P2", kind: "other", quantity: 2,
    description: "Phones", ownerKind: "customer",
    customerName: "Fatou Diallo", customerPhone: "+16465550100",
    receiverName: "Mariama Bah", receiverPhone: "+224620000000",
    contents: [{label: "iPhone 13", quantity: 2, serial: "356789012345678"},
      {label: "clothes", quantity: 1, serial: ""}],
    weightLb: 4.2, declaredValueCents: 125000, priceCents: 9000},
  {trackingCode: "CL-B3C4D5", kind: "barrels", quantity: 3,
    ownerKind: "customer", customerName: "", customerPhone: "",
    receiverName: "Awa Sow", receiverPhone: "+224620000011",
    weightLb: 60, declaredValueCents: 0},
  {trackingCode: "CL-S7T8U9", kind: "car", vinNumber: "1HGCM82633A004352",
    carYear: "2003", carMake: "Honda", carModel: "Accord", ownerKind: "stock",
    receiverName: "Agent"},
];
const model = (extra = {}) => containerCustomsModel({
  container: flight(extra.container), lines: extra.lines || lines, business});

describe("what is inside, for customs", () => {
  it("prints every item with its count and its serial", () => {
    assert.equal(customsContentsText(lines[0].contents),
        "2 × iPhone 13 (S/N 356789012345678), clothes");
    assert.equal(customsContentsText([]), "");
    assert.equal(customsContentsText(null), "");
    assert.equal(customsContentsText([{label: "", quantity: 3}]), "");
  });

  it("falls back to what the line is when nothing was declared", () => {
    const m = model();
    assert.equal(m.lines[1].contents, "3 barrels");
    assert.equal(m.lines[2].contents, "car 1HGCM82633A004352");
  });
});

describe("the customs list", () => {
  it("names the shipment, its airline, destination and dates", () => {
    const m = model();
    assert.equal(m.kindWord, "Shipment");
    assert.equal(m.kindWordFr, "Envoi");
    assert.equal(m.reference, "176-12345678");
    assert.equal(m.airline, "Air France");
    assert.equal(m.destination, "Guinea");
    assert.equal(m.departedOn, "Oct 3, 2026");
    assert.equal(m.arrivedOn, "");
    const arrived = model({container: {status: "arrived",
      arrivedAt: stamp("2026-10-05")}});
    assert.equal(arrived.arrivedOn, "Oct 5, 2026");
    const box = containerCustomsModel({container: {containerNumber:
      "MSKU1234567", airWaybill: "176-12345678"}, lines, business});
    assert.equal(box.kindWord, "Container");
    assert.equal(box.reference, "MSKU1234567");
    assert.equal(box.airline, "");
  });

  it("lists code, sender, receiver, contents, weight and value per line",
      () => {
        const [phones, barrels, car] = model().lines;
        assert.deepEqual([phones.n, phones.code, phones.senderName,
          phones.senderPhone, phones.receiverName, phones.receiverPhone],
        [1, "CL-K7M4P2", "Fatou Diallo", "+16465550100", "Mariama Bah",
          "+224620000000"]);
        assert.equal(phones.weightText, "4.2 lb");
        assert.equal(phones.declaredValueText, "$1,250.00");
        // No sender: the receiver is the customer (lineCustomer).
        assert.equal(barrels.senderName, "Awa Sow");
        assert.equal(barrels.weightText, "60 lb");
        assert.equal(barrels.declaredValueText, "$0.00");
        // The business's own stock, nothing declared.
        assert.equal(car.senderName, "Business stock");
        assert.equal(car.weightLb, null);
        assert.equal(car.weightText, "");
        assert.equal(car.declaredValueCents, null);
        assert.equal(car.declaredValueText, "");
      });

  it("totals weight and value and says what the totals cover", () => {
    const {totals} = model();
    assert.deepEqual(totals, {lineCount: 3, weightLb: 64.2,
      weightText: "64.2 lb", weighed: 2, declaredValueCents: 125000,
      declaredValueText: "$1,250.00", valued: 2});
    const html = renderContainerCustoms(model());
    assert.match(html, /Total \/ Total &middot; 3 packages/);
    assert.match(html, /64\.2 lb/);
    assert.match(html, /\$1,250\.00/);
    assert.match(html, new RegExp("Totals cover weight on 2 of 3 packages; " +
      "declared value on 2 of 3 packages\\."));
    const empty = containerCustomsModel({container: flight(), lines: [],
      business});
    assert.deepEqual(empty.totals, {lineCount: 0, weightLb: null,
      weightText: "", weighed: 0, declaredValueCents: null,
      declaredValueText: "", valued: 0});
    assert.match(renderContainerCustoms(empty), /Nothing on this shipment\./);
    assert.equal(usdText(null), "");
    assert.equal(usdText(5), "$0.05");
  });

  it("prints one Letter portrait page with the business's identity", () => {
    const html = renderContainerCustoms(model());
    assert.match(html, /@page\{size:letter portrait;/);
    assert.match(html, /Conakry Express Shipping/);
    assert.match(html, /3184 Webster Ave, Bronx, NY 10467/);
    assert.match(html,
        /<title>Customs list 176-12345678 - Conakry Express Shipping<\/title>/);
    assert.match(html, /Shipment 176-12345678/);
    assert.match(html, /Liste pour la douane/);
    assert.match(html, /Expéditeur/);
    assert.match(html, /Destinataire/);
    assert.match(html, /2 × iPhone 13 \(S\/N 356789012345678\), clothes/);
    assert.match(html, /window\.print\(\)/);
    // Declared values are on it, the business's prices are not.
    assert.doesNotMatch(html, /90\.00|9000/);
    assert.doesNotMatch(html, /Container/);
  });

  it("escapes what staff typed", () => {
    const html = renderContainerCustoms(containerCustomsModel({
      container: flight({label: "<script>x</script>", airWaybill: ""}),
      lines: [{...lines[0], contents: [{label: "<b>phone</b>",
        quantity: 1}]}], business}));
    assert.doesNotMatch(html, /<script>x|<b>phone/);
    assert.match(html, /&lt;script&gt;x/);
  });
});
