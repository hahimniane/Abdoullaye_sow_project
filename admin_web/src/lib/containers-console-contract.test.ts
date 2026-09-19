import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { translateValue } from "./french-dom.ts";
import { businessSidebarTabs } from "./business-sidebar.ts";

// Containers are the business's own loading lists. These tests pin the
// console wiring the feature depends on — the tab, its permission, the panel
// route, the search, and the cross-link under a car in the parking list and
// the ledger — by reading the source the way the permission-vocabulary test
// on the backend does, so a refactor that drops one of them fails here rather
// than in front of a business owner.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const consoleSource = read("../components/business-console.tsx");
const panelSource = read("../components/business/containers-panel.tsx");
const operationsSource = read("../components/business/operations-panels.tsx");
const peopleSource = read("../components/business/profile-support-people.tsx");
const sidebarSource = read("./business-sidebar.ts");
const stylesSource = read("../app/globals.css");

test("the Containers tab sits under Transport & shipping, gated by its permission and no service", () => {
  const tab = businessSidebarTabs.find((entry) => entry.id === "containers");
  assert.ok(tab, "no containers tab");
  assert.equal(tab.label, "Containers");
  assert.equal(tab.group, "transport");
  assert.equal(tab.permission, "containers");
  assert.equal(tab.service, undefined, "a loading list is not tied to a sold service");
  assert.match(sidebarSource, /\{id: "containers", label: "Containers", [^}]*permission: "containers"\}/);
  // The staff-permission chip the owner grants, in the People panel — the
  // list the backend parity test regex-reads.
  assert.match(peopleSource, /const businessPermissionOptions = \[[\s\S]*?\{id: "containers", label: "Containers"\}[\s\S]*?\];/);
});

test("the console routes the tab to ContainersPanel like every other panel", () => {
  assert.match(consoleSource, /import \{ContainersPanel\} from "@\/components\/business\/containers-panel";/);
  assert.match(consoleSource, /\{activeTab === "containers" && \(\s*<ContainersPanel businessId=\{businessId\} previewMode=\{previewMode\} \/>\s*\)\}/);
  assert.match(consoleSource, /containers: <Container \{\.\.\.props\} \/>,/, "the sidebar icon map must cover the tab");
});

test("the panel reads containers and lines by business and writes only through callables", () => {
  assert.match(panelSource, /useBusinessCollection\("containers", businessId, enabled, \d+\)/);
  assert.match(panelSource, /useBusinessCollection\("containerLines", businessId, enabled, \d+\)/);
  assert.match(panelSource, /useBusinessDestinations\(businessId, enabled, \d+\)/, "destinations come from the business's own list");
  for (const callable of [
    "createContainer",
    "updateContainer",
    "deleteContainer",
    "addContainerLine",
    "removeContainerLine",
    "moveContainerLine",
    "setContainerStatus",
    "getContainerDocumentUrl",
  ]) {
    assert.match(panelSource, new RegExp(`httpsCallable\\(functions, "${callable}"\\)`), `${callable} is not called`);
  }
  assert.doesNotMatch(panelSource, /\b(setDoc|updateDoc|addDoc|deleteDoc)\(/, "containers are never client-written");
});

test("a server refusal lands inside the modal, not only in the panel banner", () => {
  // Every modal save routes its failure through runPanelAction's onError
  // argument into the modal's own error line.
  assert.match(panelSource, /await httpsCallable\(functions, "createContainer"\)[\s\S]*?\}, failInModal\);/);
  assert.match(panelSource, /await httpsCallable\(functions, "addContainerLine"\)[\s\S]*?\}, failInModal\);/);
  assert.match(panelSource, /await httpsCallable\(functions, "moveContainerLine"\)[\s\S]*?\}, failInModal\);/);
  assert.match(panelSource, /function failInModal\(error: unknown\) \{\s*const failure = containerCallableFailure\(error\);\s*setDraftError\(failure\.message\);\s*setConflictId\(failure\.conflictContainerId\);/);
  assert.match(panelSource, /\{draftError && <div className="lst-form-error" role="alert">\{draftError\}/);
  // The VIN conflict names the container and offers to open it.
  assert.match(panelSource, /conflictContainer && \([\s\S]*?onClick=\{jumpToConflict\}>Go to that container<\/button>/);
  assert.match(operationsSource, /export async function runPanelAction\(/);
});

test("the search box finds lines by VIN, customer or phone and shows their container and state", () => {
  assert.match(panelSource, /searchContainerLines\(lines\.rows, containers\.rows, search\)/);
  assert.match(panelSource, /<input type="search" placeholder="VIN, customer, phone" value=\{search\}/);
  assert.match(panelSource, /<span>Cargo<\/span><span>Whose<\/span><span>Container<\/span><span>State<\/span>/);
  assert.match(panelSource, /<StatusBadge status=\{hit\.status\} \/>\{Boolean\(hit\.sailedAt\) && <small>\{formatDate\(hit\.sailedAt\)\}<\/small>\}/);
});

test("the list filters by state and by destination", () => {
  assert.match(panelSource, /filterContainers\(containers\.rows, \{ status: statusFilter, destinationCountryId: destinationFilter \}\)/);
  assert.match(panelSource, /aria-label="Filter by state"/);
  assert.match(panelSource, /aria-label="Filter by destination"/);
});

test("the line form reuses the ledger's VIN prefill and customer memory rather than forking them", () => {
  // Same records the ledger scans, same shared helpers, same decode.
  assert.match(panelSource, /findVehicleRecordByVin\(\[\.\.\.parkedCars\.rows, \.\.\.activities\.rows\], clean\)/);
  assert.match(panelSource, /await decodeVinWithCatalog\(vin\)/);
  assert.match(panelSource, /matchLotCustomers\(knownCustomers, typed\)/);
  assert.match(panelSource, /useBusinessCollection\("lotCustomers", businessId, enabled, \d+\)/);
  // The ledger's record form now goes through the same helper.
  assert.match(operationsSource, /const match = findVehicleRecordByVin\(\[\.\.\.parkedCars\.rows, \.\.\.activities\.rows\], clean\);/);
  assert.match(operationsSource, /async function decodeActivityVin\(vin: string\) \{\s*setVinHint\(VIN_LOOKING_UP\);\s*try \{\s*const result = await decodeVinWithCatalog\(vin\);/);
  // The car fields stay catalog pickers, never free text.
  assert.match(panelSource, /\{getMakes\(\)\.map\(\(m\) => \(<option key=\{m\} value=\{m\}>\{m\}<\/option>\)\)\}/);
  // Stock lines name nobody: the customer fields are hidden, not greyed.
  assert.match(panelSource, /\{ownerVisible && lineDraft\.ownerKind === "customer" && \(\s*<div className="lst-form-grid">/);
});

test("a car line asks whether the car is in the lot before it shows a VIN field", () => {
  const question = panelSource.indexOf('<legend>Is this car parked in your lot?</legend>');
  const vinField = panelSource.indexOf('<label className="lst-field wide"><span>VIN</span>');
  assert.ok(question > 0, "the question is not asked");
  assert.ok(vinField > question, "the VIN field renders before the question");
  // Two answers and nothing else until one is chosen: the car fields, the
  // owner fields and the Add button all wait on the answer.
  assert.match(panelSource, /name="ctninlot" checked=\{lineDraft\.inLot === "yes"\} onChange=\{\(\) => answerInLot\("yes"\)\} \/><span>Yes<\/span>/);
  assert.match(panelSource, /name="ctninlot" checked=\{lineDraft\.inLot === "no"\} onChange=\{\(\) => answerInLot\("no"\)\} \/><span>No<\/span>/);
  assert.match(panelSource, /const carFieldsVisible = lineDraft\.inLot === "no" \|\| Boolean\(lineDraft\.parkedCarId\);/);
  assert.match(panelSource, /const ownerVisible = lineDraft\.kind !== "car" \|\| carFieldsVisible;/);
  assert.match(panelSource, /\{lineDraft\.kind === "car" && carFieldsVisible && \(\s*<>\s*<label className="lst-field wide"><span>VIN<\/span>/);
  assert.match(panelSource, /disabled=\{busy \|\| !ownerVisible\} aria-busy=\{busy\} onClick=\{\(\) => void saveLine\(\)\}/);
  // The answer lives in the draft and is reset with the kind and on open.
  assert.match(panelSource, /function setLineKind\(kind: ContainerLineDraft\["kind"\]\) \{[\s\S]*?inLot: "",\s*parkedCarId: "",/);
  assert.match(panelSource, /onChange=\{\(\) => setLineKind\("car"\)\} \/><span>A car<\/span>/);
  assert.match(panelSource, /function openAddLine\(\) \{\s*setLineDraft\(emptyContainerLineDraft\);/);
});

test("the pick list is the parked cars in the lot, from the subscription the VIN prefill already holds", () => {
  const subscriptions = panelSource.match(/useBusinessCollection\("parkedCars", businessId, enabled, \d+\)/g) ?? [];
  assert.equal(subscriptions.length, 1, "one parkedCars subscription per panel, not one per modal");
  assert.match(panelSource, /parkedCarsInLot\(parkedCars\.rows\)\.map\(\(row\) => parkedCarPick\(row, vinPlacements\)\)/);
  assert.match(panelSource, /const vinPlacements = useMemo\(\s*\(\) => buildVinPlacementIndex\(lines\.rows, containers\.rows\),/);
  assert.match(panelSource, /filterParkedCarPicks\(parkedPicks, parkedFilter\)/);
  assert.match(panelSource, /<input type="search" placeholder="VIN, owner, make" aria-label="Filter parked cars" value=\{parkedFilter\}/);
  assert.match(panelSource, /<div className="mini-table-head"><span>Car<\/span><span>VIN<\/span><span>Owner<\/span><\/div>/);
  // Empty lot: say so and offer the other answer.
  assert.match(panelSource, /No cars are parked in your lot right now\.\s*<button className="ghost-button" type="button" onClick=\{\(\) => answerInLot\("no"\)\}>Enter the VIN instead<\/button>/);
});

test("a parked car already on an open container is shown disabled with that container named", () => {
  assert.match(panelSource, /const taken = Boolean\(pick\.takenBy\);/);
  assert.match(panelSource, /className=\{`mini-table-row \$\{taken \? "ctn-pick-taken" : "ctn-clickable"\}`\}/);
  assert.match(panelSource, /tabIndex=\{taken \? -1 : 0\}\s*aria-disabled=\{taken\}/);
  assert.match(panelSource, /\{taken && <small className="ctn-placement">\{vinPlacementText\(pick\.takenBy, lang\)\}<\/small>\}/);
  assert.match(panelSource, /function pickParkedCar\(pick: ParkedCarPick\) \{\s*if \(pick\.takenBy\) return;/);
  assert.match(stylesSource, /\.ctn-table \.mini-table-row\.ctn-pick-taken \{ cursor: not-allowed; \}/);
});

test("picking a parked car fills the car and the owner through the shared helper, then shows the fields", () => {
  assert.match(panelSource, /setLineDraft\(\(d\) => lineDraftFromParkedCar\(d, pick\)\);/);
  // The VIN is known: the decoder must not fire once the field renders.
  assert.match(panelSource, /lastVinRef\.current = pick\.vin;\s*setLineDraft\(\(d\) => lineDraftFromParkedCar\(d, pick\)\);/);
  assert.match(panelSource, /setVinHint\(recordHint\(pick\.car === "Car" \? "" : pick\.car, pick\.owner\)\);/);
  // Same sentence the typed-VIN prefill shows, so the two paths read alike.
  assert.match(panelSource, /function recordHint\(car: string, who: string\) \{\s*return `Filled from an existing record\$\{car \? `: \$\{car\}` : ""\}\$\{who \? ` for \$\{who\}` : ""\}\. You can change anything below\.`;/);
  assert.match(panelSource, /onClick=\{\(\) => answerInLot\("yes"\)\}>Pick another car<\/button>/);
});

test("a parked-car row and a ledger activity say which container the car is on", () => {
  // One index per render from rows the panel already holds — never a query per row.
  const parkingHooks = operationsSource.match(/const parkingCustomers = useBusinessRows\("lotCustomers"[\s\S]*?const placementLang = /);
  assert.ok(parkingHooks, "parking panel does not build the placement index");
  assert.match(parkingHooks[0], /useBusinessRows\("containerLines", businessId, Boolean\(businessId && !previewMode\), \d+\)/);
  assert.match(parkingHooks[0], /useBusinessRows\("containers", businessId, Boolean\(businessId && !previewMode\), \d+\)/);
  assert.match(parkingHooks[0], /buildVinPlacementIndex\(containerLines\.rows, containerRows\.rows\)/);

  const ledgerHooks = operationsSource.match(/const lotCustomers = useBusinessRows\("lotCustomers", businessId, enabled, 500\);[\s\S]*?const placementLang = /);
  assert.ok(ledgerHooks, "ledger panel does not build the placement index");
  assert.match(ledgerHooks[0], /useBusinessRows\("containerLines", businessId, enabled, \d+\)/);
  assert.match(ledgerHooks[0], /buildVinPlacementIndex\(containerLines\.rows, containerRows\.rows\)/);

  // Parking list row, parking card, and ledger activity row each render the line.
  const placements = operationsSource.match(/className="ctn-placement">\{vinPlacementText\(vinPlacements\.get\(/g) ?? [];
  assert.equal(placements.length, 3, "expected the cross-link on the parking row, the parking card and the activity row");
  assert.match(operationsSource, /<small>\{text\(row\.vinNumber, ""\) \|\| text\(row\.trackingCode, ""\)\}<\/small>\s*\{vinPlacements\.has\(text\(row\.vinNumber, ""\)\.toUpperCase\(\)\) && \(/);
  assert.match(operationsSource, /<div><span>Container<\/span><b className="ctn-placement">/);
  assert.match(operationsSource, /\{vin && vinPlacements\.has\(vin\.toUpperCase\(\)\) && \(/);
  assert.match(stylesSource, /\.ctn-placement \{/);
});

test("every string the panel shows has French", () => {
  const strings = [
    "Containers",
    "Loading lists and sailings",
    "New container",
    "Every state",
    "Every destination",
    "Loading",
    "Shipped",
    "Arrived",
    "Loading list",
    "Mark shipped",
    "Mark arrived",
    "Add line",
    "Business stock",
    "Go to that container",
    "Move line",
    "Container number",
    "Booking / BL reference",
    "Nothing loaded matches that search.",
    "No containers yet. Start one when you begin loading a box.",
    "Filter by state",
    "Filter by destination",
    "Search loaded cargo",
    "Sailing 3 Oct, box 2",
    "Move to another container",
    "Remove line",
    "Is this car parked in your lot?",
    "Yes",
    "No",
    "Pick the car from your lot. It fills the VIN and the owner.",
    "No cars are parked in your lot right now.",
    "No parked car matches that filter.",
    "Enter the VIN instead",
    "Pick another car",
    "VIN, owner, make",
    "Filter parked cars",
    "Owner",
    "Car",
  ];
  for (const english of strings) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, `no French for "${english}"`);
    assert.equal(translateValue(french, "en"), english, `"${english}" does not round-trip`);
  }
});
