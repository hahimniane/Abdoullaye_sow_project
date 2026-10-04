"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  LABELS_PER_PACKAGE,
  labelFormat,
  containerLabelsModel,
  renderContainerLabels,
} = require("../container_labels");

const container = {containerNumber: "MSKU1234567", label: "Sailing 3 Oct",
  destinationCountryName: "Guinea"};
const business = {name: "Dala Shipping", phone: "+16465550100"};
const lines = [
  {kind: "barrels", quantity: 3, ownerKind: "customer",
    customerName: "Fatou Diallo", customerPhone: "+16465550100",
    receiverName: "Mariama Bah", receiverPhone: "+224620000000",
    trackingCode: "CL-K7M4P2"},
  {kind: "car", vinNumber: "1HGCM82633A004352", carYear: "2015",
    carMake: "Toyota", carModel: "Camry", ownerKind: "stock",
    trackingCode: "CL-B3C4D5"},
  {kind: "other", quantity: 2, description: "Boxes", ownerKind: "customer",
    customerName: "Amadou", trackingCode: ""},
];
const model = () => containerLabelsModel({container, lines, business,
  consoleUrl: "https://customer.laawoldigital.com"});

describe("package labels", () => {
  // One label per side, two sides per package: a scraped label leaves one.
  it("prints two labels for every package on every coded line", () => {
    const m = model();
    assert.equal(LABELS_PER_PACKAGE, 2);
    assert.equal(m.labels.length, (3 + 1) * 2);
    assert.deepEqual(m.codes, ["CL-K7M4P2", "CL-B3C4D5"]);
    const barrels = m.labels.filter((l) => l.code === "CL-K7M4P2");
    assert.deepEqual(barrels.map((l) => l.packageNumber), [1, 1, 2, 2, 3, 3]);
    assert.ok(barrels.every((l) => l.packageCount === 3));
  });

  // The QR is the public tracking link - a stranger learns where it goes,
  // never whose phone it is.
  it("encodes the public tracking link and prints no phone number", () => {
    const m = model();
    assert.equal(m.labels[0].link,
        "https://customer.laawoldigital.com/?service=tracking&code=CL-K7M4P2");
    const page = renderContainerLabels(m, {qrSvgByCode: {}});
    assert.doesNotMatch(page, /\+224620000000|620000000/);
    assert.match(page, /CL-K7M4P2/);
    assert.match(page, /Mariama Bah/);
    assert.match(page, /VIN 1HGCM82633A004352/);
    assert.match(page, /1 \/ 3/);
  });

  it("names the receiver, and the sender only when there is no receiver",
      () => {
        const only = containerLabelsModel({container, business, lines: [
          {kind: "barrels", quantity: 1, ownerKind: "customer",
            customerName: "Fatou", trackingCode: "CL-K7M4P2"}]});
        const page = renderContainerLabels(only, {});
        assert.match(page, /From \/ De<\/span>Fatou/);
      });

  it("lays out a letter sheet six to a page, or a 4x6 roll one to a page",
      () => {
        assert.equal(labelFormat("thermal"), "thermal");
        assert.equal(labelFormat("anything"), "sheet");
        const sheet = renderContainerLabels(model(), {format: "sheet"});
        assert.equal((sheet.match(/<section class="page">/g) || []).length, 2);
        assert.match(sheet, /@page\{size:letter;margin:0\}/);
        const roll = renderContainerLabels(model(), {format: "thermal"});
        assert.equal((roll.match(/<section class="page">/g) || []).length, 8);
        assert.match(roll, /@page\{size:4in 6in;margin:0\}/);
      });

  it("escapes what staff typed", () => {
    const page = renderContainerLabels(containerLabelsModel({container,
      business, lines: [{kind: "other", quantity: 1,
        description: "<script>x</script>", ownerKind: "stock",
        trackingCode: "CL-K7M4P2"}]}), {});
    assert.doesNotMatch(page, /<script>x/);
  });
});
