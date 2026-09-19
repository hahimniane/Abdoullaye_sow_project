"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  validateContainer,
  containerRecord,
  containerTransitionRefusal,
  containerIsOpen,
  containerDeleteRefusal,
  validateContainerLine,
  containerLineRecord,
  openContainerHoldingVin,
  containerCounts,
} = require("../container_manifest");

const VIN = "1HGCM82633A004352";
const car = (extra = {}) => ({kind: "car", vinNumber: VIN, ...extra});
const refusal = containerTransitionRefusal;

describe("a container's identity", () => {
  it("needs a working name and nothing else to exist", () => {
    assert.deepEqual(validateContainer({label: "Sailing 3 Oct"}), []);
    assert.deepEqual(validateContainer({}), ["container_label_required"]);
  });

  // The number arrives from the line after the box is half full; when it
  // does, it has to be a real one so it can be tracked later.
  it("accepts an ISO container number and refuses anything else as one", () => {
    assert.deepEqual(
        validateContainer({label: "x", containerNumber: "msku1234567"}), []);
    assert.deepEqual(
        validateContainer({label: "x", containerNumber: "BOOK-99881"}),
        ["container_number_invalid"]);
  });

  it("keeps the booking reference apart from the number", () => {
    const record = containerRecord({
      label: " Box 2 ", containerNumber: "msku1234567",
      bookingReference: "cma-77120", destinationCountryId: "GN",
      destinationCountryName: "Guinea", notes: "tyres on top",
    });
    assert.equal(record.label, "Box 2");
    assert.equal(record.containerNumber, "MSKU1234567");
    assert.equal(record.bookingReference, "CMA-77120");
    assert.equal(record.destinationCountryId, "GN");
  });
});

describe("a container's life", () => {
  const loading = (extra = {}) =>
    ({status: "loading", destinationCountryId: "GN", ...extra});

  it("moves forward only", () => {
    assert.equal(refusal(loading(), "shipped", 3), null);
    assert.equal(refusal({status: "shipped"}, "arrived", 3), null);
    assert.equal(refusal({status: "shipped"}, "loading", 3),
        "container_transition_invalid");
    assert.equal(refusal({status: "arrived"}, "shipped", 3),
        "container_transition_invalid");
    assert.equal(refusal(loading(), "loading", 3),
        "container_transition_invalid");
    assert.equal(refusal(loading(), "sold", 3), "container_status_invalid");
  });

  it("will not ship empty, or to nowhere", () => {
    assert.equal(refusal(loading(), "shipped", 0), "container_empty");
    assert.equal(refusal({status: "loading"}, "shipped", 2),
        "destination_required");
  });

  it("reads a record with no status as still loading", () => {
    assert.equal(containerIsOpen({}), true);
    assert.equal(containerIsOpen({status: "shipped"}), false);
  });

  it("can be deleted only while loading and empty", () => {
    assert.equal(containerDeleteRefusal({status: "loading"}, 0), null);
    assert.equal(containerDeleteRefusal({status: "loading"}, 2),
        "container_has_lines");
    assert.equal(containerDeleteRefusal({status: "shipped"}, 0),
        "container_locked");
  });
});

describe("a line on the list", () => {
  // The name painted on the barrel is the receiver's, not the sender's;
  // whoever opens the box in Conakry matches lines by it. Stock has one too
  // (the business's agent), so it is never tied to the owner kind.
  it("keeps the receiver at destination for any owner", () => {
    const line = containerLineRecord({
      kind: "barrels", quantity: 3, ownerKind: "stock",
      receiverName: "  Mariama Bah ", receiverPhone: "+224 620 00 00 00",
    }, {containerId: "c1"});
    assert.equal(line.receiverName, "Mariama Bah");
    assert.equal(line.receiverPhone, "+224 620 00 00 00");
    assert.equal(line.customerName, "");
  });

  it("asks each kind for what identifies it", () => {
    assert.deepEqual(validateContainerLine(car({ownerKind: "stock"})), []);
    assert.deepEqual(
        validateContainerLine(car({vinNumber: "ABC", ownerKind: "stock"})),
        ["vin_required"]);
    assert.deepEqual(
        validateContainerLine({kind: "barrels", ownerKind: "customer",
          customerName: "Fatou"}),
        ["quantity_required"]);
    assert.deepEqual(
        validateContainerLine({kind: "other", quantity: 2, ownerKind: "stock"}),
        ["description_required"]);
    assert.deepEqual(
        validateContainerLine({kind: "pallet", ownerKind: "stock"}),
        ["line_kind_invalid"]);
  });

  // A stock car has no customer; demanding a name there is how fictional
  // customers get typed into the memory.
  it("names the customer only when there is one", () => {
    assert.deepEqual(validateContainerLine(car({ownerKind: "customer"})),
        ["customer_name_required"]);
    assert.deepEqual(validateContainerLine(car({ownerKind: "stock"})), []);
    assert.deepEqual(validateContainerLine(car({ownerKind: "somebody"})),
        ["owner_kind_invalid"]);
  });

  it("keeps each kind's fields and drops the others", () => {
    const stockCar = containerLineRecord({
      kind: "car", vinNumber: VIN.toLowerCase(), carMake: "Honda",
      carModel: "Accord", carYear: "2003", quantity: 7,
      description: "ignored", ownerKind: "stock", customerName: "ignored",
    }, {containerId: "c1", containerStatus: "loading", addedByStaffId: "s1"});
    assert.equal(stockCar.vinNumber, VIN);
    assert.equal(stockCar.quantity, 1);
    assert.equal(stockCar.description, "");
    assert.equal(stockCar.customerName, "");
    assert.equal(stockCar.containerStatus, "loading");

    const barrels = containerLineRecord({
      kind: "barrels", quantity: 8, ownerKind: "customer",
      customerName: "Fatou Diallo", customerPhone: "+1 646 555 0100",
    }, {containerId: "c1"});
    assert.equal(barrels.receiverName, "", "no receiver until one is named");
    assert.equal(barrels.receiverPhone, "");
    assert.equal(barrels.quantity, 8);
    assert.equal(barrels.vinNumber, "");
    assert.equal(barrels.customerName, "Fatou Diallo");
  });
});

describe("one open container per car", () => {
  const line = (containerId, containerStatus, kind = "car") =>
    ({kind, containerId, containerStatus, vinNumber: VIN});

  it("names the open container already holding the VIN", () => {
    assert.equal(openContainerHoldingVin([line("c1", "loading")]), "c1");
    assert.equal(openContainerHoldingVin([line("c1", "shipped")]), "c1");
  });

  it("lets a car that has arrived be shipped again later", () => {
    assert.equal(openContainerHoldingVin([line("c1", "arrived")]), "");
  });

  it("ignores the container the line is being moved from", () => {
    assert.equal(openContainerHoldingVin([line("c1", "loading")], "c1"), "");
  });

  it("only cars conflict", () => {
    assert.equal(
        openContainerHoldingVin([line("c1", "loading", "barrels")]), "");
  });
});

describe("what a container carries", () => {
  it("counts barrels by quantity and the rest by line", () => {
    assert.deepEqual(containerCounts([
      {kind: "car"}, {kind: "car"},
      {kind: "barrels", quantity: 8}, {kind: "barrels", quantity: 12},
      {kind: "other", quantity: 2},
    ]), {lineCount: 5, carCount: 2, barrelCount: 20, otherCount: 2});
    assert.deepEqual(containerCounts([]),
        {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0});
  });
});

// The wiring, pinned by reading the source: the callables need Firestore to
// run, and what matters is that each one is gated on the containers section,
// that every change is audited as a container, and that the /d page can find
// a loading list by its own token.
describe("the container callables and their gates", () => {
  const {readFileSync} = require("node:fs");
  const path = require("node:path");
  const source = readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const rules = readFileSync(
      path.join(__dirname, "..", "..", "firestore.rules"), "utf8");
  const callable = (name) => {
    const start = source.indexOf(`exports.${name} = onCall(`);
    assert.ok(start > -1, `${name} not found`);
    const next = source.indexOf("\nexports.", start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  };

  it("exposes every callable the clients call, gated on containers", () => {
    for (const name of ["createContainer", "updateContainer",
      "deleteContainer", "addContainerLine", "removeContainerLine",
      "moveContainerLine", "setContainerStatus",
      "getContainerDocumentUrl"]) {
      const body = callable(name);
      // The gate is either inline or the shared loader, which carries it.
      assert.match(body, /CONTAINER_SECTION|loadContainerFor\(/,
          `${name} must be gated on the containers section`);
    }
    assert.match(source, /const CONTAINER_SECTION = "containers";/);
    const loader = source.slice(
        source.indexOf("async function loadContainerFor("),
        source.indexOf("async function refreshContainerCounts("));
    assert.match(loader,
        /requireBusinessPermission\(uid, businessId, CONTAINER_SECTION\)/);
  });

  it("refuses a car already on an open container, naming it", () => {
    const body = callable("addContainerLine");
    assert.match(body, /openContainerHoldingVin\(/);
    assert.match(body, /conflictContainerId: conflict/);
    // Adding never exempts the container being added to: the same car twice
    // on one list is a mistake too. Only a move passes an exemption.
    assert.doesNotMatch(body, /openContainerHoldingVin\([\s\S]*?, ref\.id\)/);
  });

  it("audits every change as a container", () => {
    assert.match(source, /entityType: "container", entityId: containerId/);
    for (const action of ["created", "edited", "deleted", "line_added",
      "line_removed", "line_moved"]) {
      assert.match(source, new RegExp(`"${action}", uid`),
          `audit action ${action}`);
    }
  });

  it("serves the loading list from its own token, not the payment one", () => {
    assert.match(source,
        /collection\("containers"\)\s*\.where\("documentToken", "==", token\)/);
    assert.match(source, /renderContainerDocument\(/);
  });

  it("keeps both collections read-only to clients", () => {
    for (const name of ["containers", "containerLines"]) {
      const block = rules.slice(rules.indexOf(`match /${name}/`));
      assert.ok(block.length > 0, `${name} rule missing`);
      assert.match(block.slice(0, 220), /allow write: if false;/);
    }
  });
});
