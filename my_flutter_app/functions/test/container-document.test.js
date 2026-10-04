"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  containerDocumentModel,
  maskedPhone,
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
    assert.match(html, /<b>Mariama Bah<\/b><span class="sub">•••• 0000/);
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

  // Regression: the page is a bearer link (/d?t=...) that travels to agents,
  // ports and customs, and it used to print every customer's and receiver's
  // full phone number. It now prints the last four digits only. The names,
  // quantities and VINs the box is checked off by stay whole.
  it("masks every phone number but keeps names and quantities", () => {
    const crowded = [
      ...lines,
      {kind: "barrels", quantity: 3, ownerKind: "customer",
        customerName: "Ibrahima Sow", customerPhone: "(207) 555-4821",
        receiverName: "Aissatou Sow", receiverPhone: "+224 655 12 34 56"},
      {kind: "other", description: "Generator", quantity: 2,
        ownerKind: "customer", customerName: "Short Number",
        customerPhone: "98761"},
    ];
    const model = containerDocumentModel(
        {container: box(), lines: crowded, business});
    const html = renderContainerDocument(model);

    for (const full of ["+1 646 555 0199", "6465550199", "+224 620 00 00 00",
      "(207) 555-4821", "2075554821", "+224 655 12 34 56", "224655123456",
      "98761"]) {
      assert.ok(!html.includes(full), `${full} must not be printed`);
    }
    // Not even with the formatting stripped out of the page.
    const digitsOnly = html.replace(/[^\d]/g, "");
    for (const full of ["6465550199", "2075554821", "224655123456"]) {
      assert.ok(!digitsOnly.includes(full), `${full} leaks as digits`);
    }

    assert.equal(model.lines[1].phone, "•••• 0199");
    assert.equal(model.lines[1].receiverPhone, "•••• 0000");
    assert.equal(model.lines[2].phone, "•••• 4821");
    assert.equal(model.lines[2].receiverPhone, "•••• 3456");
    // Too short to be a number: masked whole rather than printed in full.
    assert.equal(model.lines[3].phone, "••••");
    // Business stock has no customer, so no phone at all.
    assert.equal(model.lines[0].phone, "");

    for (const name of ["Fatou Diallo", "Mariama Bah", "Ibrahima Sow",
      "Aissatou Sow", "Short Number", "Business stock"]) {
      assert.match(html, new RegExp(`<b>${name}</b>`));
    }
    assert.match(html, /1HGCM82633A004352/);
    assert.match(html, /<td class="qty">8<\/td>/);
    assert.match(html, /<td class="qty">3<\/td>/);
    assert.match(html, /<td class="qty">2<\/td>/);
    // The shipper's own contact is public on purpose and stays whole.
    assert.match(html, /\+1 646 555 0100/);
  });

  it("masks a phone to its last four digits", () => {
    assert.equal(maskedPhone("+1 646 555 0199"), "•••• 0199");
    assert.equal(maskedPhone("6465550199"), "•••• 0199");
    assert.equal(maskedPhone("123456"), "••••");
    assert.equal(maskedPhone(""), "");
    assert.equal(maskedPhone(undefined), "");
    assert.equal(maskedPhone("no number"), "");
  });

  it("escapes what the business typed", () => {
    const html = renderContainerDocument(containerDocumentModel({
      container: box({notes: "<script>alert(1)</script>"}), lines, business}));
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
  });
});
