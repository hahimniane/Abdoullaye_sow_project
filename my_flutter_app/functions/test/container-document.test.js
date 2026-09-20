"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  containerDocumentModel,
  renderContainerDocument,
} = require("../container_document");

const business = {
  name: "Conakry Express Shipping", phone: "+1 646 555 0100",
  email: "ops@example.com", addressLine1: "3184 Webster Ave", city: "Bronx",
  state: "NY", postalCode: "10467", country: "USA",
  logoUrl: "https://cdn.example.com/logo.png",
};
const stamp = (iso) => ({toDate: () => new Date(iso)});
const box = (extra = {}) => ({
  label: "Sailing 3 Oct, box 2", containerNumber: "MSKU1234567",
  bookingReference: "CMA-77120", destinationCountryName: "Guinea",
  status: "loading", notes: "tyres on top", createdAt: stamp("2026-09-18"),
  ...extra,
});
const lines = [
  {kind: "car", vinNumber: "1HGCM82633A004352", carYear: "2003",
    carMake: "Honda", carModel: "Accord", ownerKind: "stock"},
  {kind: "barrels", quantity: 8, ownerKind: "customer",
    customerName: "Fatou Diallo", customerPhone: "+1 646 555 0199",
    receiverName: "Mariama Bah", receiverPhone: "+224 620 00 00 00"},
];

describe("the loading list wears the shipper's identity", () => {
  it("prints the business's own logo, name, address and contact", () => {
    const model = containerDocumentModel({container: box(), lines, business});
    assert.equal(model.logo.url, "https://cdn.example.com/logo.png");
    assert.equal(model.logo.own, true);
    assert.equal(model.businessName, "Conakry Express Shipping");
    assert.match(model.businessAddress, /3184 Webster Ave, Bronx, NY 10467/);
    const html = renderContainerDocument(model);
    assert.match(html, /<img src="https:\/\/cdn\.example\.com\/logo\.png"/);
    assert.match(html, /Conakry Express Shipping/);
    assert.match(html, /\+1 646 555 0100 {2}\| {2}ops@example\.com/);
  });

  // A business with no logo of its own gets the platform mark, never a broken
  // image - the same rule the receipts follow.
  it("falls back to the Laawol mark when the business has no logo", () => {
    const model = containerDocumentModel(
        {container: box(), lines, business: {name: "Lot"}});
    assert.equal(model.logo.own, false);
    assert.match(model.logo.url, /laawoldigital\.com\/assets\/logo\.png$/);
  });
});

describe("the loading list's title and stamp", () => {
  it("leads with the container number and keeps the working name", () => {
    const model = containerDocumentModel({container: box(), lines, business});
    assert.equal(model.reference, "MSKU1234567");
    assert.equal(model.label, "Sailing 3 Oct, box 2");
    assert.equal(model.bookingReference, "CMA-77120");
  });

  it("falls back to the booking reference when that is all there is", () => {
    const model = containerDocumentModel({container: box(
        {containerNumber: "", label: ""}), lines, business});
    assert.equal(model.reference, "CMA-77120");
  });

  it("stands the working name in until the number is known", () => {
    const model = containerDocumentModel(
        {container: box({containerNumber: ""}), lines, business});
    assert.equal(model.reference, "Sailing 3 Oct, box 2");
    assert.equal(model.label, "");
  });

  it("stamps loading, sailed or arrived with the date", () => {
    const loading = containerDocumentModel({container: box(), lines, business});
    assert.deepEqual(loading.stamp, {text: "LOADING", tone: "loading"});
    const sailed = containerDocumentModel({container: box({
      status: "shipped", sailedAt: stamp("2026-10-03")}), lines, business});
    assert.deepEqual(sailed.stamp,
        {text: "SAILED Oct 3, 2026", tone: "sailed"});
    const arrived = containerDocumentModel({container: box({
      status: "arrived", arrivedAt: stamp("2026-10-24")}), lines, business});
    assert.deepEqual(arrived.stamp,
        {text: "ARRIVED Oct 24, 2026", tone: "arrived"});
    assert.match(renderContainerDocument(sailed),
        /class="stamp sailed">SAILED Oct 3, 2026</);
  });
});

describe("what the loading list prints", () => {
  it("lists every line with what, how many and whose", () => {
    const html = renderContainerDocument(
        containerDocumentModel({container: box(), lines, business}));
    assert.match(html, /2003 Honda Accord/);
    assert.match(html, /1HGCM82633A004352/);
    assert.match(html, /Business stock/);
    assert.match(html, /Barrels/);
    assert.match(html, /Fatou Diallo/);
    assert.match(html, /1 car · 8 barrels/);
    // The receiver is the name on the barrel; the list prints it beside
    // the customer so the box can be checked off at the port.
    assert.match(html, /<th>Receiver<\/th>/);
    assert.match(html, /<b>Mariama Bah<\/b><span class="sub">\+224 620/);
    assert.match(html, /Guinea/);
    assert.match(html, /tyres on top/);
  });

  // The page is a record of what was loaded, never a bill.
  it("carries no money", () => {
    const html = renderContainerDocument(
        containerDocumentModel({container: box(), lines, business}));
    assert.doesNotMatch(html, /\$|Amount|PAID|DUE/);
  });

  it("offers print-to-PDF and names the file after the container", () => {
    const html = renderContainerDocument(
        containerDocumentModel({container: box(), lines, business}));
    assert.match(html, /window\.print\(\)/);
    assert.match(html,
        /<title>Loading list MSKU1234567 - Conakry Express Shipping<\/title>/);
  });

  it("escapes what the business typed", () => {
    const html = renderContainerDocument(containerDocumentModel({
      container: box({notes: "<script>alert(1)</script>"}), lines, business}));
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
  });
});
