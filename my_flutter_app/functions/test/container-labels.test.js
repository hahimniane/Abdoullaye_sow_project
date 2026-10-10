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

  // The QR is the public tracking link - a stranger who scans it learns
  // where it goes, never whose phone it is. The paper itself, for whoever
  // holds the package in Conakry, carries both numbers in full.
  it("encodes the public tracking link, and prints both full phone numbers",
      () => {
        const m = model();
        assert.equal(m.labels[0].link,
            "https://customer.laawoldigital.com/t/CL-K7M4P2");
        assert.doesNotMatch(m.labels[0].link, /\+|2246|6465/);
        const page = renderContainerLabels(m, {qrSvgByCode: {}});
        assert.match(page, /CL-K7M4P2/);
        assert.match(page, /Mariama Bah<em>\+224620000000<\/em>/);
        assert.match(page, /Fatou Diallo<em>\+16465550100<\/em>/);
        assert.match(page, /VIN 1HGCM82633A004352/);
        assert.match(page, /1 \/ 3/);
      });

  it("names the receiver and the sender, each with their number", () => {
    const only = containerLabelsModel({container, business, lines: [
      {kind: "barrels", quantity: 1, ownerKind: "customer",
        customerName: "Fatou", trackingCode: "CL-K7M4P2"}]});
    const page = renderContainerLabels(only, {});
    assert.match(page, /From \/ De<\/span>Fatou/);
    assert.doesNotMatch(page, /To \/ Pour/);
    // A business's own stock has no sender to print.
    const stock = renderContainerLabels(containerLabelsModel({container,
      business, lines: [{kind: "other", quantity: 1, description: "Tires",
        ownerKind: "stock", receiverName: "Agent",
        trackingCode: "CL-K7M4P2"}]}), {});
    assert.doesNotMatch(stock, /From \/ De<\/span>/);
    assert.match(stock, /To \/ Pour<\/span>Agent/);
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

describe("labels for packages waiting for a container", () => {
  const waiting = [{kind: "other", quantity: 2, description: "Boxes",
    ownerKind: "customer", customerName: "Fatou Diallo",
    customerPhone: "+16465550100", receiverName: "Mariama Bah",
    receiverPhone: "+224620000000", destinationCountryName: "Guinea",
    lengthIn: 30, widthIn: 20, heightIn: 12.5, priceCents: 15000,
    paidCents: 5000, trackingCode: "CL-W4X5Y6", containerId: "",
    containerStatus: "waiting"}];
  const waitingModel = (extra = {}) => containerLabelsModel({
    container: null, lines: waiting, business,
    consoleUrl: "https://customer.laawoldigital.com", ...extra});

  it("print before any container exists, without a container footer", () => {
    const m = waitingModel();
    assert.equal(m.hasContainer, false);
    assert.equal(m.reference, "");
    assert.equal(m.labels.length, 2 * 2);
    const page = renderContainerLabels(m, {qrSvgByCode: {}});
    assert.match(page, /CL-W4X5Y6/);
    assert.match(page, /Dala Shipping/);
    // Nothing of a container: not its word, not an empty second footer cell.
    assert.doesNotMatch(page, /<span>Container<\/span>/);
    assert.equal((page.match(/<div class="foot">\s*<span>/g) || []).length, 4);
    assert.equal((page.match(/<div class="foot">[\s\S]*?<\/div>/g) || [])
        .every((foot) => (foot.match(/<span>/g) || []).length === 1), true);
    assert.match(page, /Waiting packages/);
  });

  it("carry the package's own destination, size and both phones", () => {
    const page = renderContainerLabels(waitingModel(), {});
    assert.match(page, /Guinea &middot;|Guinea · 30 × 20 × 12.5 in/);
    assert.match(page, /30 × 20 × 12\.5 in/);
    assert.match(page, /\+224620000000/);
    assert.match(page, /\+16465550100/);
  });

  it("never print the price or what has been paid", () => {
    const page = renderContainerLabels(waitingModel(), {});
    assert.doesNotMatch(page, /150|15000|5000|\$|paid|price/i);
    // The container's destination is the fallback for a line with none.
    const onBox = containerLabelsModel({container, business, lines: [
      {...waiting[0], destinationCountryName: "", lengthIn: null}]});
    assert.equal(onBox.labels[0].destination, "Guinea");
    assert.equal(onBox.labels[0].size, "");
  });

  it("print the size only when all three sides are set", () => {
    const partial = containerLabelsModel({container: null, business,
      lines: [{...waiting[0], heightIn: null}]});
    assert.equal(partial.labels[0].size, "");
    assert.equal(partial.labels[0].place, "Guinea");
  });

  it("say so when there is nothing to print", () => {
    const page = renderContainerLabels(
        containerLabelsModel({container: null, business, lines: []}), {});
    assert.match(page, /No packages to print\./);
  });
});

describe("reprinting one package", () => {
  // A torn label on one barrel is a reprint of that line, not the box.
  it("prints only the asked-for line, one label per package when asked",
      () => {
        const m = containerLabelsModel({container, lines, business,
          onlyCode: "cl-b3c4d5", copies: 1});
        assert.equal(m.labels.length, 1);
        assert.equal(m.labels[0].code, "CL-B3C4D5");
        const page = renderContainerLabels(m, {query: "t=x&view=labels"});
        // The toolbar keeps the line filter when switching format.
        assert.match(page, /code=CL-B3C4D5/);
        assert.match(page, /copies=1/);
      });

  it("tells staff how to make a label last", () => {
    const page = renderContainerLabels(model(), {});
    assert.match(page, /clear\s+packing tape/);
    assert.match(page, /direct\s+thermal labels fade/);
  });
});
