import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  CONTAINER_LINE_KINDS,
  CONTAINER_MESSAGES,
  CONTAINER_OWNER_KINDS,
  CONTAINER_STATUSES,
  ISO_CONTAINER_NUMBER,
  buildVinPlacementIndex,
  cleanVin,
  containerCallableFailure,
  containerCounts,
  containerDeleteRefusal,
  containerDraftFromRow,
  containerIsOpen,
  containerLinePayload,
  containerLineTitle,
  containerMessage,
  containerPayload,
  containerRowCounts,
  containerTitle,
  containerTransitionRefusal,
  emptyContainerDraft,
  emptyContainerLineDraft,
  filterContainers,
  filterParkedCarPicks,
  lineDraftFromParkedCar,
  nextContainerStatus,
  openContainerHoldingVin,
  parkedCarPick,
  parkedCarsInLot,
  searchContainerLines,
  shortDayMonth,
  validateContainerDraft,
  validateContainerLineDraft,
  vinPlacementText,
  type ContainerRefusal,
} from "./container-manifest.ts";

// ---------------------------------------------------------------------------
// Mirror discipline: the server module is the authority.
// ---------------------------------------------------------------------------

const serverSource = readFileSync(
  new URL("../../../my_flutter_app/functions/container_manifest.js", import.meta.url),
  "utf8",
);

test("every refusal message is the server's sentence, verbatim", () => {
  const block = serverSource.match(/const CONTAINER_MESSAGES = Object\.freeze\(\{([\s\S]*?)\}\);/);
  assert.ok(block, "server CONTAINER_MESSAGES not found");
  // Keys and their (possibly concatenated) string values.
  const entries = [...block![1].matchAll(/(\w+):\s*((?:"[^"]*"\s*\+?\s*)+),/g)];
  assert.ok(entries.length >= 18, "expected the full server vocabulary");
  for (const [, key, raw] of entries) {
    const sentence = [...raw.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
    assert.equal(
      CONTAINER_MESSAGES[key as ContainerRefusal],
      sentence,
      `message for ${key} drifted from the server`,
    );
  }
  assert.equal(Object.keys(CONTAINER_MESSAGES).length, entries.length);
});

test("statuses, kinds, owners and the ISO shape match the server", () => {
  assert.deepEqual([...CONTAINER_STATUSES], ["loading", "shipped", "arrived"]);
  assert.deepEqual([...CONTAINER_LINE_KINDS], ["car", "barrels", "other"]);
  assert.deepEqual([...CONTAINER_OWNER_KINDS], ["customer", "stock"]);
  assert.match(serverSource, /const ISO_CONTAINER_NUMBER = \/\^\[A-Z\]\{4\}\\d\{7\}\$\/;/);
  assert.equal(ISO_CONTAINER_NUMBER.source, "^[A-Z]{4}\\d{7}$");
});

// ---------------------------------------------------------------------------
// The container.
// ---------------------------------------------------------------------------

test("a container needs a name; the number is optional but must be ISO 6346", () => {
  assert.deepEqual(validateContainerDraft(emptyContainerDraft), ["container_label_required"]);
  assert.deepEqual(validateContainerDraft({ ...emptyContainerDraft, label: "Box 2" }), []);
  assert.deepEqual(
    validateContainerDraft({ ...emptyContainerDraft, label: "Box 2", containerNumber: "msku1234567" }),
    [],
    "lower case is upper-cased before the check",
  );
  assert.deepEqual(
    validateContainerDraft({ ...emptyContainerDraft, label: "Box 2", containerNumber: "MSKU123456" }),
    ["container_number_invalid"],
  );
  assert.deepEqual(
    validateContainerDraft({ ...emptyContainerDraft, containerNumber: "BL-99" }),
    ["container_label_required", "container_number_invalid"],
    "every problem at once",
  );
});

test("the payload trims, upper-cases the number and the reference, and caps the note", () => {
  const payload = containerPayload({
    label: "  Sailing 3 Oct, box 2  ",
    containerNumber: " msku1234567 ",
    bookingReference: " bl-778 ",
    destinationCountryId: "guinea",
    destinationCountryName: "Guinea",
    notes: "x".repeat(600),
  });
  assert.equal(payload.label, "Sailing 3 Oct, box 2");
  assert.equal(payload.containerNumber, "MSKU1234567");
  assert.equal(payload.bookingReference, "BL-778");
  assert.equal(payload.destinationCountryId, "guinea");
  assert.equal(payload.notes.length, 500);
});

test("a stored row round-trips into the edit form", () => {
  const draft = containerDraftFromRow({
    label: "Box 2",
    containerNumber: "MSKU1234567",
    bookingReference: "BL-1",
    destinationCountryId: "guinea",
    destinationCountryName: "Guinea",
    notes: "n",
    status: "shipped",
  });
  assert.deepEqual(draft, {
    label: "Box 2",
    containerNumber: "MSKU1234567",
    bookingReference: "BL-1",
    destinationCountryId: "guinea",
    destinationCountryName: "Guinea",
    notes: "n",
  });
});

test("a container only moves forward, and ships only with a destination and cargo", () => {
  const loading = { status: "loading", destinationCountryId: "guinea" };
  assert.equal(containerTransitionRefusal(loading, "shipped", 1), null);
  assert.equal(containerTransitionRefusal(loading, "shipped", 0), "container_empty");
  assert.equal(
    containerTransitionRefusal({ status: "loading" }, "shipped", 3),
    "destination_required",
  );
  assert.equal(containerTransitionRefusal(loading, "arrived", 3), "container_transition_invalid");
  assert.equal(containerTransitionRefusal({ status: "shipped" }, "arrived", 0), null);
  assert.equal(containerTransitionRefusal({ status: "shipped" }, "loading", 0), "container_transition_invalid");
  assert.equal(containerTransitionRefusal({ status: "arrived" }, "shipped", 0), "container_transition_invalid");
  assert.equal(containerTransitionRefusal(loading, "lost", 1), "container_status_invalid");
  // A row with no status yet is loading, as the server reads it.
  assert.equal(containerTransitionRefusal({ destinationCountryId: "guinea" }, "shipped", 1), null);
});

test("the next step is shipped, then arrived, then nothing", () => {
  assert.equal(nextContainerStatus({ status: "loading" }), "shipped");
  assert.equal(nextContainerStatus({}), "shipped");
  assert.equal(nextContainerStatus({ status: "shipped" }), "arrived");
  assert.equal(nextContainerStatus({ status: "arrived" }), null);
});

test("only a loading container is open; only an empty one can be deleted", () => {
  assert.equal(containerIsOpen({ status: "loading" }), true);
  assert.equal(containerIsOpen({}), true);
  assert.equal(containerIsOpen({ status: "shipped" }), false);
  assert.equal(containerDeleteRefusal({ status: "loading" }, 0), null);
  assert.equal(containerDeleteRefusal({ status: "loading" }, 2), "container_has_lines");
  assert.equal(containerDeleteRefusal({ status: "shipped" }, 0), "container_locked");
});

// ---------------------------------------------------------------------------
// Lines.
// ---------------------------------------------------------------------------

test("a car line needs a VIN of at least six characters", () => {
  assert.deepEqual(
    validateContainerLineDraft({ ...emptyContainerLineDraft, customerName: "Aissatou" }),
    ["vin_required"],
  );
  assert.deepEqual(
    validateContainerLineDraft({ ...emptyContainerLineDraft, vinNumber: "1hg-cm", customerName: "Aissatou" }),
    ["vin_required"],
    "punctuation does not count toward the six",
  );
  assert.deepEqual(
    validateContainerLineDraft({ ...emptyContainerLineDraft, vinNumber: "1HGCM82633A004352", customerName: "Aissatou" }),
    [],
  );
});

test("barrels need a count; other needs a description and a count", () => {
  const stock = { ...emptyContainerLineDraft, ownerKind: "stock" as const };
  assert.deepEqual(validateContainerLineDraft({ ...stock, kind: "barrels" }), ["quantity_required"]);
  assert.deepEqual(validateContainerLineDraft({ ...stock, kind: "barrels", quantity: "0" }), ["quantity_required"]);
  assert.deepEqual(validateContainerLineDraft({ ...stock, kind: "barrels", quantity: "12" }), []);
  assert.deepEqual(
    validateContainerLineDraft({ ...stock, kind: "other" }),
    ["description_required", "quantity_required"],
  );
  assert.deepEqual(
    validateContainerLineDraft({ ...stock, kind: "other", description: "tires", quantity: "4" }),
    [],
  );
});

test("a customer's line names the customer; stock names no one", () => {
  const car = { ...emptyContainerLineDraft, vinNumber: "1HGCM82633A004352" };
  assert.deepEqual(validateContainerLineDraft(car), ["customer_name_required"]);
  assert.deepEqual(validateContainerLineDraft({ ...car, ownerKind: "stock" }), []);
  assert.deepEqual(
    validateContainerLineDraft({ ...car, kind: "boat" as never, ownerKind: "nobody" as never }),
    ["line_kind_invalid", "owner_kind_invalid"],
  );
});

test("the line payload keeps only the fields its kind and owner use", () => {
  const car = containerLinePayload({
    kind: "car",
    // The form's own bookkeeping — the in-the-lot answer and which parked
    // car was picked — never reaches the server.
    inLot: "yes",
    parkedCarId: "ignored",
    vinNumber: " 1hgcm82633a004352 ",
    carMake: "Honda",
    carModel: "Accord",
    carYear: "2003",
    quantity: "5",
    description: "ignored",
    ownerKind: "stock",
    customerName: "ignored",
    customerPhone: "ignored",
  });
  assert.deepEqual(car, {
    kind: "car",
    vinNumber: "1HGCM82633A004352",
    carMake: "Honda",
    carModel: "Accord",
    carYear: "2003",
    quantity: 1,
    description: "",
    ownerKind: "stock",
    customerName: "",
    customerPhone: "",
  });
  const barrels = containerLinePayload({
    ...emptyContainerLineDraft,
    kind: "barrels",
    quantity: "1200",
    carMake: "ignored",
    customerName: " Aissatou Bah ",
    customerPhone: "+1 646 555 0100",
  });
  assert.equal(barrels.quantity, 999, "capped like the server");
  assert.equal(barrels.carMake, "");
  assert.equal(barrels.customerName, "Aissatou Bah");
  assert.equal(barrels.customerPhone, "+1 646 555 0100");
  const other = containerLinePayload({
    ...emptyContainerLineDraft,
    kind: "other",
    description: " tires ",
    quantity: "4.4",
    ownerKind: "stock",
  });
  assert.equal(other.description, "tires");
  assert.equal(other.quantity, 4);
});

test("a VIN on another open container is a conflict; arrived ones are not", () => {
  const lines = [
    { kind: "car", containerId: "A", containerStatus: "arrived" },
    { kind: "barrels", containerId: "B", containerStatus: "loading" },
    { kind: "car", containerId: "C", containerStatus: "shipped" },
  ];
  assert.equal(openContainerHoldingVin(lines), "C");
  assert.equal(openContainerHoldingVin(lines, "C"), "", "the container being added to is fine");
  assert.equal(openContainerHoldingVin([lines[0]]), "");
  assert.equal(openContainerHoldingVin([]), "");
});

test("counts tally barrels by quantity and cars and other by line", () => {
  const counts = containerCounts([
    { kind: "car", quantity: 1 },
    { kind: "car", quantity: 1 },
    { kind: "barrels", quantity: 12 },
    { kind: "barrels", quantity: 3 },
    { kind: "other", quantity: 4 },
    { kind: "other" },
  ]);
  assert.deepEqual(counts, { lineCount: 6, carCount: 2, barrelCount: 15, otherCount: 5 });
  assert.deepEqual(containerCounts([]), { lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0 });
});

test("a container's stored tallies win; absent ones come from its lines", () => {
  assert.deepEqual(
    containerRowCounts({ lineCount: 2, carCount: 1, barrelCount: 10, otherCount: 0 }, []),
    { lineCount: 2, carCount: 1, barrelCount: 10, otherCount: 0 },
  );
  assert.deepEqual(
    containerRowCounts({}, [{ kind: "car" }]),
    { lineCount: 1, carCount: 1, barrelCount: 0, otherCount: 0 },
  );
});

// ---------------------------------------------------------------------------
// Reading rows.
// ---------------------------------------------------------------------------

test("titles: the number when known, else the working name", () => {
  assert.equal(containerTitle({ label: "Box 2", containerNumber: "MSKU1234567" }), "MSKU1234567");
  assert.equal(containerTitle({ label: "Box 2", containerNumber: "" }), "Box 2");
  assert.equal(containerTitle({}), "Container");
  assert.equal(containerLineTitle({ kind: "car", carYear: "2019", carMake: "Toyota", carModel: "Camry" }), "2019 Toyota Camry");
  assert.equal(containerLineTitle({ kind: "car", vinNumber: "1HGCM82633A004352" }), "1HGCM82633A004352");
  assert.equal(containerLineTitle({ kind: "barrels", quantity: 12 }), "12 barrels");
  assert.equal(containerLineTitle({ kind: "barrels", quantity: 1 }), "1 barrel");
  assert.equal(containerLineTitle({ kind: "other", description: "tires", quantity: 4 }), "4 × tires");
  assert.equal(containerLineTitle({ kind: "other", description: "generator", quantity: 1 }), "generator");
  assert.equal(cleanVin(" 1hg-cm82633a004352xx "), "1HGCM82633A004352");
});

test("the VIN index joins lines to containers once, skipping arrived boxes", () => {
  const containers = [
    { id: "L", label: "Box 2", status: "loading" },
    { id: "S", label: "Box 1", containerNumber: "MSKU1234567", status: "shipped", sailedAt: new Date("2026-10-03T12:00:00Z") },
    { id: "A", label: "Old", status: "arrived" },
  ];
  const lines = [
    { kind: "car", vinNumber: "vin000loading", containerId: "L" },
    { kind: "car", vinNumber: "VIN000SHIPPED", containerId: "S" },
    { kind: "car", vinNumber: "VIN000ARRIVED", containerId: "A" },
    { kind: "barrels", quantity: 3, containerId: "S" },
    { kind: "car", vinNumber: "VIN000ORPHAN", containerId: "missing" },
  ];
  const index = buildVinPlacementIndex(lines, containers);
  assert.deepEqual([...index.keys()].sort(), ["VIN000LOADING", "VIN000SHIPPED"]);
  assert.equal(index.get("VIN000LOADING")?.title, "Box 2");
  assert.equal(index.get("VIN000SHIPPED")?.title, "MSKU1234567");
  assert.equal(index.get("VIN000SHIPPED")?.status, "shipped");
  assert.equal(vinPlacementText(index.get("VIN000LOADING")), "Loading in Box 2");
  assert.equal(vinPlacementText(index.get("VIN000SHIPPED")), "In MSKU1234567 · sailed 3 Oct");
  assert.equal(vinPlacementText(index.get("VIN000ARRIVED")), "");
  assert.equal(vinPlacementText(undefined), "");
});

test("the cross-link reads in French too, so the DOM translator can leave it alone", () => {
  const shipped = { containerId: "S", title: "MSKU1234567", status: "shipped" as const, sailedAt: new Date("2026-10-03T12:00:00Z") };
  assert.equal(vinPlacementText(shipped, "fr"), "Dans MSKU1234567 · parti le 3 oct.");
  assert.equal(
    vinPlacementText({ ...shipped, sailedAt: null }, "fr"),
    "Dans MSKU1234567 · expédié",
  );
  assert.equal(vinPlacementText({ ...shipped, sailedAt: null }), "In MSKU1234567 · shipped");
  assert.equal(
    vinPlacementText({ containerId: "L", title: "Box 2", status: "loading", sailedAt: null }, "fr"),
    "En chargement dans Box 2",
  );
  // The French sentence must survive the English→French pass untouched.
  for (const sentence of [
    vinPlacementText(shipped, "fr"),
    "En chargement dans Box 2",
  ]) {
    assert.equal(translateValue(sentence, "fr"), sentence);
  }
  assert.equal(shortDayMonth({ seconds: 1791028800 }, "en"), "3 Oct");
  assert.equal(shortDayMonth("not a date"), "");
});

test("filters narrow by state and by destination", () => {
  const rows = [
    { id: "1", status: "loading", destinationCountryId: "guinea" },
    { id: "2", status: "shipped", destinationCountryId: "guinea" },
    { id: "3", status: "shipped", destinationCountryId: "senegal" },
    { id: "4", destinationCountryId: "" },
  ];
  const ids = (list: Record<string, unknown>[]) => list.map((r) => r.id);
  assert.deepEqual(ids(filterContainers(rows, { status: "", destinationCountryId: "" })), ["1", "2", "3", "4"]);
  assert.deepEqual(ids(filterContainers(rows, { status: "shipped", destinationCountryId: "" })), ["2", "3"]);
  assert.deepEqual(ids(filterContainers(rows, { status: "loading", destinationCountryId: "" })), ["1", "4"], "no status reads as loading");
  assert.deepEqual(ids(filterContainers(rows, { status: "", destinationCountryId: "guinea" })), ["1", "2"]);
  assert.deepEqual(ids(filterContainers(rows, { status: "loading", destinationCountryId: "senegal" })), []);
});

test("search finds lines by VIN, customer name or phone digits, with their container", () => {
  const containers = [
    { id: "S", label: "Box 1", containerNumber: "MSKU1234567", status: "shipped", sailedAt: "2026-10-03" },
    { id: "L", label: "Box 2", status: "loading" },
  ];
  const lines = [
    { id: "a", kind: "car", vinNumber: "1HGCM82633A004352", customerName: "Aissatou Bah", customerPhone: "+1 (646) 555-0100", containerId: "S" },
    { id: "b", kind: "barrels", quantity: 4, customerName: "Mamadou Diallo", customerPhone: "6465550199", containerId: "L" },
    { id: "c", kind: "other", quantity: 1, description: "generator", ownerKind: "stock", containerId: "L" },
  ];
  const ids = (hits: ReturnType<typeof searchContainerLines>) => hits.map((h) => h.line.id);
  assert.deepEqual(ids(searchContainerLines(lines, containers, "a")), [], "one character is too little");
  assert.deepEqual(ids(searchContainerLines(lines, containers, "4352")), ["a"]);
  assert.deepEqual(ids(searchContainerLines(lines, containers, "1hgcm8")), ["a"], "VIN search is case-insensitive");
  assert.deepEqual(ids(searchContainerLines(lines, containers, "diallo")), ["b"]);
  assert.deepEqual(ids(searchContainerLines(lines, containers, "646 555 01")), ["a", "b"], "phone digits ignore punctuation");
  assert.deepEqual(ids(searchContainerLines(lines, containers, "555-0199")), ["b"]);
  const [hit] = searchContainerLines(lines, containers, "aissatou");
  assert.equal(hit.container?.id, "S");
  assert.equal(hit.status, "shipped");
  assert.equal(hit.sailedAt, "2026-10-03");
  // A line whose container is gone still reports the state stamped on it.
  const orphan = searchContainerLines(
    [{ id: "z", kind: "car", vinNumber: "VIN000ORPHAN", containerId: "gone", containerStatus: "shipped" }],
    containers,
    "orphan",
  );
  assert.equal(orphan[0]?.status, "shipped");
  assert.equal(orphan[0]?.container, undefined);
});

// ---------------------------------------------------------------------------
// What the server said.
// ---------------------------------------------------------------------------

test("a callable failure yields the sentence and the conflicting container", () => {
  const conflict = containerCallableFailure({
    code: "functions/failed-precondition",
    message: CONTAINER_MESSAGES.vin_already_loaded,
    details: { reason: "vin_already_loaded", conflictContainerId: "S" },
  });
  assert.equal(conflict.message, CONTAINER_MESSAGES.vin_already_loaded);
  assert.equal(conflict.conflictContainerId, "S");
  const plain = containerCallableFailure(new Error("Container not found."));
  assert.equal(plain.message, "Container not found.");
  assert.equal(plain.conflictContainerId, "");
  const bare = containerCallableFailure({ details: { reason: "container_empty" } });
  assert.equal(bare.message, CONTAINER_MESSAGES.container_empty);
  assert.equal(containerCallableFailure(null).message, "The change did not save.");
  assert.equal(containerMessage(["vin_required", "customer_name_required"]), "Enter the VIN. Enter the customer's name.");
});

test("every refusal sentence has a French translation", () => {
  for (const [code, english] of Object.entries(CONTAINER_MESSAGES)) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, `no French for ${code}: "${english}"`);
  }
});

// ---------------------------------------------------------------------------
// Picking a car that is already in the lot.
// ---------------------------------------------------------------------------

test("the car form opens with the in-the-lot question unanswered", () => {
  assert.equal(emptyContainerLineDraft.inLot, "");
  assert.equal(emptyContainerLineDraft.parkedCarId, "");
});

test("the pick list is the parked cars not cancelled and not past their end date", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  const rows = [
    { id: "open", vinNumber: "A", status: "reserved" },
    { id: "ends-later", vinNumber: "B", status: "reserved", parkingEndDate: "2026-10-01" },
    { id: "ends-today", vinNumber: "C", status: "reserved", parkingEndDate: "2026-09-18" },
    { id: "left", vinNumber: "D", status: "reserved", parkingEndDate: "2026-09-01" },
    { id: "cancelled", vinNumber: "E", status: "cancelled" },
    { id: "walk-up", vinNumber: "F", source: "business" },
  ];
  assert.deepEqual(
    parkedCarsInLot(rows, now).map((row) => row.id),
    ["open", "ends-later", "ends-today", "walk-up"],
  );
  assert.deepEqual(parkedCarsInLot(undefined as never), []);
});

test("a parked car is offered as its car, VIN and owner, and marked taken from the placement index", () => {
  const placements = buildVinPlacementIndex(
    [{ kind: "car", vinNumber: "1HGCM82633A004352", containerId: "box2" }],
    [{ id: "box2", label: "Box 2", status: "loading" }],
  );
  const known = parkedCarPick(
    {
      id: "p1",
      vinNumber: " 1hgcm-82633a004352 ",
      carMake: "Honda",
      carModel: "Accord",
      carYear: "2003",
      customerName: "Aissatou Bah",
      ownerName: "ignored when customerName is set",
      customerPhone: "+1 646 555 0100",
    },
    placements,
  );
  assert.equal(known.id, "p1");
  assert.equal(known.vin, "1HGCM82633A004352");
  assert.equal(known.car, "2003 Honda Accord");
  assert.equal(known.owner, "Aissatou Bah");
  assert.equal(known.phone, "+1 646 555 0100");
  assert.equal(known.takenBy?.title, "Box 2", "the container holding the car is named");

  const bare = parkedCarPick({ id: "p2", vinNumber: "WBA12345", ownerName: "Mamadou" }, placements);
  assert.equal(bare.car, "Car", "nothing known about the car reads as a car, not a blank");
  assert.equal(bare.owner, "Mamadou", "ownerName stands in when customerName is absent");
  assert.equal(bare.takenBy, undefined);
});

test("the pick list narrows by VIN, owner or make and ignores VIN punctuation", () => {
  const picks = [
    parkedCarPick({ id: "1", vinNumber: "1HGCM82633A004352", carMake: "Honda", carModel: "Accord", carYear: "2003", customerName: "Aissatou Bah" }, new Map()),
    parkedCarPick({ id: "2", vinNumber: "JTDKB20U", carMake: "Toyota", carModel: "Prius", customerName: "Mamadou Diallo" }, new Map()),
  ];
  const ids = (query: string) => filterParkedCarPicks(picks, query).map((p) => p.id);
  assert.deepEqual(ids(""), ["1", "2"]);
  assert.deepEqual(ids("  "), ["1", "2"]);
  assert.deepEqual(ids("1hgcm-826"), ["1"]);
  assert.deepEqual(ids("diallo"), ["2"]);
  assert.deepEqual(ids("toyota"), ["2"]);
  assert.deepEqual(ids("2003"), ["1"]);
  assert.deepEqual(ids("nissan"), []);
});

test("picking a parked car fills the car and the owner and keeps the answer at yes", () => {
  const pick = parkedCarPick(
    { id: "p1", vinNumber: "1HGCM82633A004352", carMake: "Honda", carModel: "Accord", carYear: "2003", customerName: "Aissatou Bah", customerPhone: "+1 646 555 0100" },
    new Map(),
  );
  const typed = { ...emptyContainerLineDraft, inLot: "yes" as const, ownerKind: "stock" as const, customerName: "", customerPhone: "" };
  const filled = lineDraftFromParkedCar(typed, pick);
  assert.equal(filled.inLot, "yes");
  assert.equal(filled.parkedCarId, "p1");
  assert.equal(filled.vinNumber, "1HGCM82633A004352");
  assert.equal(filled.carMake, "Honda");
  assert.equal(filled.carModel, "Accord");
  assert.equal(filled.carYear, "2003");
  assert.equal(filled.ownerKind, "customer", "a named owner makes it a customer's line");
  assert.equal(filled.customerName, "Aissatou Bah");
  assert.equal(filled.customerPhone, "+1 646 555 0100");
  assert.deepEqual(validateContainerLineDraft(filled), [], "what a pick fills is enough to save");

  // A record naming nobody leaves the owner fields alone so the form still asks.
  const nameless = parkedCarPick({ id: "p2", vinNumber: "WBA12345" }, new Map());
  const kept = lineDraftFromParkedCar({ ...emptyContainerLineDraft, customerName: "Typed", customerPhone: "555" }, nameless);
  assert.equal(kept.ownerKind, "customer");
  assert.equal(kept.customerName, "Typed");
  assert.equal(kept.customerPhone, "555");
  assert.equal(kept.parkedCarId, "p2");
});

// A booking whose checkout never completed has no car in the yard; the app's
// picker excludes it, and the console must offer the same cars.
test("a pending-payment booking is not a car in the lot", () => {
  const rows = [
    { id: "a", status: "reserved", vinNumber: "1HGCM82633A004352" },
    { id: "b", status: "pending_payment", vinNumber: "2HGCM82633A004352" },
    { id: "c", status: "cancelled", vinNumber: "3HGCM82633A004352" },
  ];
  assert.deepEqual(parkedCarsInLot(rows).map((r) => r.id), ["a"]);
});
