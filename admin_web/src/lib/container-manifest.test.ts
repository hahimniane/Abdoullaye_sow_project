import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  CONTAINER_LINE_KINDS,
  CONTAINER_LABEL_CHOICE_KEY,
  CONTAINER_MESSAGES,
  CONTAINER_OWNER_KINDS,
  DEFAULT_CONTAINER_LABEL_CHOICE,
  CONTAINER_STATUSES,
  ISO_CONTAINER_NUMBER,
  buildVinPlacementIndex,
  cleanVin,
  cleanContainerPhone,
  contactPhoneReach,
  containerCallableFailure,
  containerCounts,
  containerLineContactsDraftFromRow,
  containerLineContactsPayload,
  containerLineDraftFromRow,
  containerLineWhatsApp,
  containerLineWhatsAppText,
  containerDeleteRefusal,
  containerDraftFromRow,
  containerLabelChoice,
  containerLabelsRequest,
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
  INTERNATIONAL_PHONE,
  isInternationalPhone,
  lineDraftFromParkedCar,
  nextContainerStatus,
  openContainerHoldingVin,
  parkedCarPick,
  parkedCarsInLot,
  phoneCountryForBusiness,
  phoneCountryForDestination,
  readContainerLabelChoice,
  searchContainerLines,
  updateContainerLineContactsRequest,
  updateContainerLineRequest,
  shortDayMonth,
  validateContainerDraft,
  validateContainerLineContactsDraft,
  validateContainerLineDraft,
  vinPlacementText,
  writeContainerLabelChoice,
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
  // A number or a booking reference is a name enough.
  assert.deepEqual(validateContainerDraft({ ...emptyContainerDraft, containerNumber: "MSKU1234567" }), []);
  assert.deepEqual(validateContainerDraft({ ...emptyContainerDraft, bookingReference: "CMA-77120" }), []);
  assert.equal(containerTitle({ bookingReference: "CMA-77120" }), "CMA-77120");
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
    ["container_number_invalid"],
    "a number that needs fixing is still the name; one problem to solve, not two",
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
    ...emptyContainerLineDraft,
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
    receiverName: "",
    receiverPhone: "",
    // Nobody to message without a number, so both switches are off.
    notifyCustomer: false,
    notifyReceiver: false,
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
  assert.equal(barrels.customerPhone, "+16465550100", "formatting dropped like the server");
  assert.equal(barrels.notifyCustomer, true, "on by default once there is a number");
  assert.equal(barrels.receiverName, "", "no receiver until one is named");
  // The name on the barrel is the receiver's; stock names one too (the
  // business's agent), so it never depends on the owner kind.
  const toAgent = containerLinePayload({
    ...emptyContainerLineDraft,
    kind: "barrels",
    quantity: "3",
    ownerKind: "stock",
    receiverName: " Mariama Bah ",
    receiverPhone: "+224 620 00 00 00",
  });
  assert.equal(toAgent.receiverName, "Mariama Bah");
  assert.equal(toAgent.receiverPhone, "+224620000000");
  assert.equal(toAgent.notifyReceiver, true);
  assert.equal(toAgent.notifyCustomer, false, "stock has no customer to message");
  assert.equal(toAgent.customerName, "");
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
  assert.equal(vinPlacementText(index.get("VIN000SHIPPED")), "In MSKU1234567 · sailed Oct 3");
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
  assert.equal(shortDayMonth({ seconds: 1791028800 }, "en"), "Oct 3");
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
    { id: "c", kind: "other", quantity: 1, description: "generator", ownerKind: "stock", containerId: "L", receiverName: "Ousmane Camara", receiverPhone: "+224 620 11 22 33" },
  ];
  const ids = (hits: ReturnType<typeof searchContainerLines>) => hits.map((h) => h.line.id);
  // "Is there anything for Ousmane?" is the port's question; the receiver
  // answers it even on a stock line that names no customer.
  assert.deepEqual(ids(searchContainerLines(lines, containers, "ousmane")), ["c"]);
  assert.deepEqual(ids(searchContainerLines(lines, containers, "620 11")), ["c"]);
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
  // Regression: runPanelAction passes its onError the message string, not the
  // error. The server's sentence must survive that, not collapse into the
  // generic fallback.
  assert.equal(
    containerCallableFailure(CONTAINER_MESSAGES.customer_phone_invalid).message,
    CONTAINER_MESSAGES.customer_phone_invalid,
  );
  assert.equal(containerCallableFailure("").message, "The change did not save.");
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

// ---------------------------------------------------------------------------
// Phones and WhatsApp switches: the server's `phone`, `isInternationalPhone`,
// `contactPhoneErrors` and `containerLineContacts`, mirrored.
// ---------------------------------------------------------------------------

test("the international pattern is the server's", () => {
  assert.match(serverSource, /const INTERNATIONAL_PHONE = \/\^\\\+\[1-9\]\\d\{7,14\}\$\/;/);
  assert.equal(INTERNATIONAL_PHONE.source, "^\\+[1-9]\\d{7,14}$");
  // The formatting the server strips, character for character.
  assert.match(serverSource, /const PHONE_FORMATTING = \/\[\\s\(\)\.-\]\/g;/);
});

test("a phone is stored with its formatting dropped and the plus kept", () => {
  assert.equal(cleanContainerPhone(" +1 (646) 555-0100 "), "+16465550100");
  assert.equal(cleanContainerPhone("+224.620.00.00.00"), "+224620000000");
  assert.equal(cleanContainerPhone("622 11 22 33"), "622112233", "a local number stays local");
  assert.equal(cleanContainerPhone("call me"), "call me", "not a phone: returned as typed for the validator");
  assert.equal(cleanContainerPhone("12 34"), "12 34", "too short: returned as typed");
  assert.equal(cleanContainerPhone(undefined), "");
});

test("only a + international number can receive WhatsApp", () => {
  assert.equal(isInternationalPhone("+1 646 555 0100"), true);
  assert.equal(isInternationalPhone("+224 620 00 00 00"), true);
  assert.equal(isInternationalPhone("622112233"), false, "local");
  assert.equal(isInternationalPhone("+0123456789"), false, "no country code starts with 0");
  assert.equal(isInternationalPhone("+1234567"), false, "seven digits is not enough");
  assert.equal(isInternationalPhone(""), false);
  assert.equal(contactPhoneReach(""), "empty");
  assert.equal(contactPhoneReach("+16465550100"), "international");
  assert.equal(contactPhoneReach("622 11 22 33"), "local");
  assert.equal(contactPhoneReach("+1646"), "incomplete");
  assert.equal(contactPhoneReach("not a phone"), "incomplete");
});

test("a phone that is there must look like one; a local number is still accepted", () => {
  const barrels = { ...emptyContainerLineDraft, kind: "barrels" as const, quantity: "2", customerName: "Aissatou" };
  assert.deepEqual(validateContainerLineDraft(barrels), []);
  assert.deepEqual(validateContainerLineDraft({ ...barrels, customerPhone: "622 11 22 33" }), []);
  assert.deepEqual(validateContainerLineDraft({ ...barrels, customerPhone: "+1 646 555 0100" }), []);
  assert.deepEqual(validateContainerLineDraft({ ...barrels, customerPhone: "12345" }), ["customer_phone_invalid"]);
  assert.deepEqual(
    validateContainerLineDraft({ ...barrels, customerPhone: "abc", receiverPhone: "+1 2" }),
    ["customer_phone_invalid", "receiver_phone_invalid"],
  );
  // Stock has no customer phone to check, but its receiver's is checked.
  assert.deepEqual(
    validateContainerLineDraft({ ...barrels, ownerKind: "stock", customerPhone: "abc", receiverPhone: "abc" }),
    ["receiver_phone_invalid"],
  );
});

test("the WhatsApp switches default on and follow the number", () => {
  assert.equal(emptyContainerLineDraft.notifyCustomer, true);
  assert.equal(emptyContainerLineDraft.notifyReceiver, true);
  const base = { ...emptyContainerLineDraft, kind: "barrels" as const, quantity: "1", customerName: "A" };
  const both = containerLinePayload({ ...base, customerPhone: "+16465550100", receiverPhone: "+224620000000" });
  assert.equal(both.notifyCustomer, true);
  assert.equal(both.notifyReceiver, true);
  const off = containerLinePayload({
    ...base,
    customerPhone: "+16465550100",
    receiverPhone: "+224620000000",
    notifyCustomer: false,
    notifyReceiver: false,
  });
  assert.equal(off.notifyCustomer, false);
  assert.equal(off.notifyReceiver, false);
  const noPhones = containerLinePayload(base);
  assert.equal(noPhones.notifyCustomer, false, "forced off without a number, as the server does");
  assert.equal(noPhones.notifyReceiver, false);
});

test("a contacts correction reads the stored line, and a missing switch reads as on", () => {
  const legacy = {
    id: "L1",
    ownerKind: "customer",
    customerName: "Aissatou Bah",
    customerPhone: "6465550100",
    receiverName: "Mariama",
    receiverPhone: "+224620000000",
  };
  const draft = containerLineContactsDraftFromRow(legacy);
  assert.deepEqual(draft, {
    customerName: "Aissatou Bah",
    customerPhone: "6465550100",
    receiverName: "Mariama",
    receiverPhone: "+224620000000",
    notifyCustomer: true,
    notifyReceiver: true,
  });
  assert.equal(containerLineContactsDraftFromRow({ notifyCustomer: false }).notifyCustomer, false);
});

test("a contacts correction is validated and shaped like the server's update", () => {
  const customerLine = { id: "L1", ownerKind: "customer" };
  const stockLine = { id: "L2", ownerKind: "stock" };
  const draft = {
    customerName: " Aissatou Bah ",
    customerPhone: "+1 646 555 0100",
    receiverName: " Mariama ",
    receiverPhone: "",
    notifyCustomer: true,
    notifyReceiver: true,
  };
  assert.deepEqual(validateContainerLineContactsDraft(draft, customerLine), []);
  assert.deepEqual(
    validateContainerLineContactsDraft({ ...draft, customerName: "" }, customerLine),
    ["customer_name_required"],
  );
  assert.deepEqual(
    validateContainerLineContactsDraft({ ...draft, customerName: "", receiverPhone: "x" }, stockLine),
    ["receiver_phone_invalid"],
    "stock names no customer",
  );
  assert.deepEqual(containerLineContactsPayload(draft, customerLine), {
    customerName: "Aissatou Bah",
    customerPhone: "+16465550100",
    receiverName: "Mariama",
    receiverPhone: "",
    notifyCustomer: true,
    notifyReceiver: false,
  });
  assert.deepEqual(updateContainerLineContactsRequest("biz", customerLine, draft), {
    businessId: "biz",
    lineId: "L1",
    contacts: containerLineContactsPayload(draft, customerLine),
  });
  const stock = containerLineContactsPayload({ ...draft, receiverPhone: "+224 620 00 00 00" }, stockLine);
  assert.equal(stock.customerName, "");
  assert.equal(stock.customerPhone, "");
  assert.equal(stock.notifyCustomer, false);
  assert.equal(stock.notifyReceiver, true);
});

test("a stored line opens the add-line form pre-filled for editing", () => {
  const car = {
    id: "L1", containerId: "C1", kind: "car", vinNumber: "1hgcm82633a004352",
    carMake: "Honda", carModel: "Accord", carYear: "2003", quantity: 1,
    ownerKind: "customer", customerName: "Fatou", customerPhone: "+16465550100",
    receiverName: "Mariama", receiverPhone: "+224620000000",
    notifyCustomer: false, notifyReceiver: true, trackingCode: "CL-K7M4P2",
  };
  const draft = containerLineDraftFromRow(car);
  assert.deepEqual(draft, {
    kind: "car",
    // The typed-VIN branch, so the car fields show at once.
    inLot: "no",
    parkedCarId: "",
    vinNumber: "1HGCM82633A004352",
    carMake: "Honda",
    carModel: "Accord",
    carYear: "2003",
    quantity: "",
    description: "",
    ownerKind: "customer",
    customerName: "Fatou",
    customerPhone: "+16465550100",
    receiverName: "Mariama",
    receiverPhone: "+224620000000",
    notifyCustomer: false,
    notifyReceiver: true,
  });
  assert.deepEqual(validateContainerLineDraft(draft), []);
  // Saved unchanged, the request is the line as stored: nothing to change.
  const request = updateContainerLineRequest("biz", car, draft);
  assert.equal(request.lineId, "L1");
  assert.equal(request.containerId, "C1");
  assert.equal(request.businessId, "biz");
  assert.deepEqual(request.line, {
    kind: "car",
    vinNumber: "1HGCM82633A004352",
    carMake: "Honda",
    carModel: "Accord",
    carYear: "2003",
    quantity: 1,
    description: "",
    ownerKind: "customer",
    customerName: "Fatou",
    customerPhone: "+16465550100",
    receiverName: "Mariama",
    receiverPhone: "+224620000000",
    notifyCustomer: false,
    notifyReceiver: true,
  });
  assert.ok(!("trackingCode" in request.line), "the code is never sent");

  const barrels = containerLineDraftFromRow({ kind: "barrels", quantity: 3, ownerKind: "stock", customerName: "ghost", receiverPhone: "" });
  assert.equal(barrels.quantity, "3");
  assert.equal(barrels.inLot, "");
  assert.equal(barrels.ownerKind, "stock");
  assert.equal(barrels.customerName, "");
  // No number yet: the switch starts on, as on a new line.
  assert.equal(barrels.notifyReceiver, true);
  const other = containerLineDraftFromRow({ kind: "other", quantity: 2, description: "Tires", ownerKind: "customer", customerName: "Awa" });
  assert.equal(other.description, "Tires");
  assert.equal(other.quantity, "2");
  assert.deepEqual(containerLinePayload(other), containerLinePayload({ ...emptyContainerLineDraft, ...other }));
  // An unknown kind falls back to a car rather than an impossible form.
  assert.equal(containerLineDraftFromRow({}).kind, "car");
});

test("the list says who gets WhatsApp updates and which number needs a country code", () => {
  assert.deepEqual(
    containerLineWhatsApp({ ownerKind: "customer", customerPhone: "+16465550100", receiverPhone: "+224620000000" }),
    { customer: "on", receiver: "on" },
  );
  assert.deepEqual(
    containerLineWhatsApp({ ownerKind: "customer", customerPhone: "6465550100", notifyCustomer: true, receiverPhone: "+224620000000", notifyReceiver: false }),
    { customer: "needs_code", receiver: "off" },
  );
  assert.deepEqual(
    containerLineWhatsApp({ ownerKind: "stock", customerPhone: "+16465550100" }),
    { customer: "none", receiver: "none" },
  );
  assert.deepEqual(containerLineWhatsAppText({ customer: "on", receiver: "on" }), {
    summary: "WhatsApp updates: customer and receiver",
    warnings: [],
  });
  assert.equal(containerLineWhatsAppText({ customer: "on", receiver: "off" }).summary, "WhatsApp updates: customer");
  assert.equal(containerLineWhatsAppText({ customer: "none", receiver: "on" }).summary, "WhatsApp updates: receiver");
  assert.deepEqual(containerLineWhatsAppText({ customer: "needs_code", receiver: "needs_code" }), {
    summary: "No WhatsApp updates",
    warnings: ["Customer's phone needs a country code", "Receiver's phone needs a country code"],
  });
});

test("every WhatsApp sentence the list shows has French", () => {
  const sentences = [
    "WhatsApp updates: customer and receiver",
    "WhatsApp updates: customer",
    "WhatsApp updates: receiver",
    "No WhatsApp updates",
    "Customer's phone needs a country code",
    "Receiver's phone needs a country code",
  ];
  for (const english of sentences) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, `no French for "${english}"`);
    assert.equal(translateValue(french, "en"), english, `"${english}" does not round-trip`);
  }
});

test("the phone pickers open on the business's country and the container's destination", () => {
  assert.equal(phoneCountryForBusiness({ country: "United States" }), "US");
  assert.equal(phoneCountryForBusiness({ country: "Guinea" }), "GN");
  assert.equal(phoneCountryForBusiness({ countryCode: "sn" }), "SN");
  assert.equal(phoneCountryForBusiness({}), "US");
  assert.equal(phoneCountryForBusiness(null), "US");
  assert.equal(phoneCountryForBusiness({ country: "Atlantis" }), "US");
  // destinationCountryId is a catalog slug, not an ISO code.
  assert.equal(phoneCountryForDestination({ destinationCountryId: "guinea" }), "GN");
  assert.equal(phoneCountryForDestination({ destinationCountryId: "senegal", destinationCountryName: "Senegal" }), "SN");
  assert.equal(phoneCountryForDestination({ destinationCountryId: "", destinationCountryName: "Mali" }), "ML");
  assert.equal(phoneCountryForDestination({}, "GN"), "GN", "no destination yet: the fallback");
  assert.equal(phoneCountryForDestination({ destinationCountryId: "nowhere_land" }, "US"), "US");
  // A business destination document whose id is not a catalog slug.
  const own = [{ id: "dest_8f2k", name: "Guinée", code: "GN" }];
  assert.equal(phoneCountryForDestination({ destinationCountryId: "dest_8f2k", destinationCountryName: "Guinée" }, "US", own), "GN");
  assert.equal(phoneCountryForDestination({ destinationCountryId: "dest_8f2k" }, "US", []), "US");
});

test("search finds a line by its tracking code, with or without the dash", () => {
  const lines = [
    { id: "a", containerId: "C", kind: "barrels", quantity: 2, customerName: "X", trackingCode: "CL-K7M4P2" },
    { id: "b", containerId: "C", kind: "barrels", quantity: 1, customerName: "Y" },
  ];
  const containers = [{ id: "C", status: "shipped" }];
  assert.deepEqual(searchContainerLines(lines, containers, "cl-k7m4p2").map((h) => h.line.id), ["a"]);
  assert.deepEqual(searchContainerLines(lines, containers, "K7M4").map((h) => h.line.id), ["a"]);
});

// ---------------------------------------------------------------------------
// Package labels: the callable request and the remembered choice.
// ---------------------------------------------------------------------------

test("a labels request asks for view \"labels\" with the format and count, for the whole container", () => {
  assert.deepEqual(
    containerLabelsRequest(" biz1 ", "ctn1", { format: "thermal", copies: 1 }),
    { businessId: "biz1", containerId: "ctn1", view: "labels", format: "thermal", copies: 1 },
  );
  // No lineId key at all for the whole box, not an empty one.
  assert.equal("lineId" in containerLabelsRequest("biz1", "ctn1", DEFAULT_CONTAINER_LABEL_CHOICE, ""), false);
});

test("a line's labels carry its lineId so the server prints only that line", () => {
  assert.deepEqual(
    containerLabelsRequest("biz1", "ctn1", { format: "sheet", copies: 2 }, "line9"),
    { businessId: "biz1", containerId: "ctn1", view: "labels", format: "sheet", copies: 2, lineId: "line9" },
  );
});

test("a label choice normalizes the way the server does: sheet unless thermal, two unless one", () => {
  assert.deepEqual(DEFAULT_CONTAINER_LABEL_CHOICE, { format: "sheet", copies: 2 });
  assert.deepEqual(containerLabelChoice({ format: "thermal", copies: 1 }), { format: "thermal", copies: 1 });
  assert.deepEqual(containerLabelChoice({ format: "a4", copies: 7 }), { format: "sheet", copies: 2 });
  assert.deepEqual(containerLabelChoice('{"format":"thermal","copies":"1"}'), { format: "thermal", copies: 1 });
  assert.deepEqual(containerLabelChoice("not json"), { format: "sheet", copies: 2 });
  assert.deepEqual(containerLabelChoice(null), { format: "sheet", copies: 2 });
  // A tampered stored value never reaches the server as anything else.
  assert.deepEqual(
    containerLabelsRequest("b", "c", { format: "x", copies: 3 } as never),
    { businessId: "b", containerId: "c", view: "labels", format: "sheet", copies: 2 },
  );
});

test("the last label choice is remembered per browser and survives blocked storage", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };
  assert.deepEqual(readContainerLabelChoice(storage), { format: "sheet", copies: 2 });
  writeContainerLabelChoice(storage, { format: "thermal", copies: 1 });
  assert.equal(store.get(CONTAINER_LABEL_CHOICE_KEY), '{"format":"thermal","copies":1}');
  assert.deepEqual(readContainerLabelChoice(storage), { format: "thermal", copies: 1 });

  const blocked = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("QuotaExceededError"); },
  };
  assert.deepEqual(readContainerLabelChoice(blocked), { format: "sheet", copies: 2 });
  assert.doesNotThrow(() => writeContainerLabelChoice(blocked, { format: "thermal", copies: 1 }));
  assert.deepEqual(readContainerLabelChoice(null), { format: "sheet", copies: 2 });
  // The default is a copy: changing what one caller got never changes the next.
  const first = readContainerLabelChoice(null);
  first.copies = 1;
  assert.deepEqual(readContainerLabelChoice(null), { format: "sheet", copies: 2 });
});

test("the label request mirrors what the server's callable and label page read", () => {
  const labels = readFileSync(new URL("../../../my_flutter_app/functions/container_labels.js", import.meta.url), "utf8");
  const index = readFileSync(new URL("../../../my_flutter_app/functions/index.js", import.meta.url), "utf8");
  assert.match(labels, /=== "thermal" \? "thermal" : "sheet"/);
  assert.match(labels, /Number\(value\) === 1 \? 1 : LABELS_PER_PACKAGE/);
  const callable = index.slice(index.indexOf("exports.getContainerDocumentUrl"));
  assert.match(callable, /String\(data\.view \|\| ""\) !== "labels"/);
  assert.match(callable, /labelFormat\(data\.format\)/);
  assert.match(callable, /labelCopies\(data\.copies\)/);
  assert.match(callable, /const lineId = String\(data\.lineId \|\| ""\);/);
});
