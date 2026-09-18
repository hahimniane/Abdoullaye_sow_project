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
  assert.match(panelSource, /\{lineDraft\.ownerKind === "customer" && \(\s*<div className="lst-form-grid">/);
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
  ];
  for (const english of strings) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, `no French for "${english}"`);
    assert.equal(translateValue(french, "en"), english, `"${english}" does not round-trip`);
  }
});
