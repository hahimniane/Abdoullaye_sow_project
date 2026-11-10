import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  airOnlyBusiness,
  hasSeaContainerFromCounts,
  shippingCopy,
  shippingStepsFor,
  todayLabelFor,
} from "./air-only.ts";
import { translateValue } from "./french-dom.ts";
import { shipsByChoiceShown } from "./package-proof.ts";

// An air-only business on the website console (docs/SHIPPING_SIMPLE_HOME.md
// W): the rule, the words, and where the console applies them, pinned by
// reading the source the way the other console contracts do.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const consoleSource = read("../components/business-console.tsx");
const panel = read("../components/business/containers-panel.tsx");
const waiting = read("../components/business/waiting-packages-panel.tsx");
const todayView = read("../components/business/today-view.tsx");
const data = read("./business-data.ts");

const TODAY_LABELS = ["Packages waiting for a container", "Containers loading", "Containers sailed"];
// What the shipment page says for a container marked Air (containers-panel.tsx).
const DETAIL_STRINGS = [
  "All shipments",
  "Packages waiting for this shipment's destination. Add puts the whole package on the shipment.",
  "Set this shipment's destination to see what's still waiting.",
];

test("air-only is a business that flies and never had a sea container", () => {
  assert.equal(airOnlyBusiness(true, false), true);
  assert.equal(airOnlyBusiness(true, true), false);
  assert.equal(airOnlyBusiness(false, false), false);
  assert.equal(airOnlyBusiness(false, true), false);
  // Still loading, or the read failed: the console as it was.
  assert.equal(airOnlyBusiness(true, null), false);
});

test("a sea container is any container not marked Air", () => {
  assert.equal(hasSeaContainerFromCounts(0, 0), false);
  assert.equal(hasSeaContainerFromCounts(3, 3), false);
  assert.equal(hasSeaContainerFromCounts(3, 2), true);
  assert.equal(hasSeaContainerFromCounts(1, 0), true);
  assert.equal(hasSeaContainerFromCounts(null, 0), null);
  assert.equal(hasSeaContainerFromCounts(2, null), null);
});

test("no word an air-only business reads says container, in English or in French", () => {
  const air = shippingCopy(true);
  const strings = [
    ...Object.values(air),
    ...TODAY_LABELS.map((label) => todayLabelFor(label, true)),
    ...DETAIL_STRINGS,
  ];
  for (const text of strings) {
    assert.doesNotMatch(text, /container/i, text);
    const french = translateValue(text, "fr");
    assert.notEqual(french, text, `no French for: ${text}`);
    assert.doesNotMatch(french, /container|conteneur/i, french);
  }
});

test("every other business reads the words it read before", () => {
  const standard = shippingCopy(false);
  assert.equal(standard.waitingTitle, "Waiting list");
  assert.equal(standard.waitingSearch, "VIN, customer, phone");
  assert.equal(standard.registerSubtitle, "What the customer dropped off. It waits here until a container takes it.");
  assert.equal(standard.listTitle, "Containers");
  assert.equal(standard.newButton, "New container");
  assert.equal(standard.column, "Container");
  assert.equal(standard.notLoaded, "Waiting for a container");
  assert.equal(standard.todayTitle, "Containers in progress");
  assert.equal(standard.leftLabel, "Sailed");
  // Each of them still has its French.
  for (const text of Object.values(standard)) {
    assert.notEqual(translateValue(text, "fr"), text, `no French for: ${text}`);
  }
  for (const label of TODAY_LABELS) assert.equal(todayLabelFor(label, false), label);
  assert.equal(todayLabelFor("Cars parked", true), "Cars parked");
});

test("the Shipping steps keep their ids and order; only two labels change", () => {
  const steps = [
    {id: "requests", label: "Requests", permission: "containers"},
    {id: "waiting", label: "Waiting", permission: "containers"},
    {id: "containers", label: "Containers", permission: "containers"},
    {id: "deliveries", label: "Deliveries", permission: "deliveries"},
  ];
  assert.deepEqual(shippingStepsFor(steps, false), steps);
  assert.deepEqual(
    shippingStepsFor(steps, true).map((step) => [step.id, step.label, step.permission]),
    [
      ["requests", "Requests", "containers"],
      ["waiting", "Packages here", "containers"],
      ["containers", "Shipments", "containers"],
      ["deliveries", "Deliveries", "deliveries"],
    ],
  );
  // The caller's list is never changed.
  assert.equal(steps[1].label, "Waiting");
});

test("a new package is not asked Sea or Air; an old sea package still is", () => {
  assert.equal(shipsByChoiceShown(true, null, true), false);
  assert.equal(shipsByChoiceShown(true, {shipMode: "air"}, true), false);
  assert.equal(shipsByChoiceShown(true, {shipMode: "sea"}, true), true);
  assert.equal(shipsByChoiceShown(true, {}, true), true);
  // Not air-only: as before.
  assert.equal(shipsByChoiceShown(true, null), true);
  assert.equal(shipsByChoiceShown(false, null), false);
  assert.equal(shipsByChoiceShown(false, {shipMode: "air"}), true);
});

test("the console asks once whether a sea container exists, with two equality counts", () => {
  assert.match(data, /getCountFromServer\(query\(collection\(db, "containers"\), mine\)\),\s*getCountFromServer\(query\(collection\(db, "containers"\), mine, where\("shipMode", "==", "air"\)\)\),/);
  // A failed read is "not known", which reads as the console as it was.
  assert.match(data, /\(\) => \{\s*if \(!cancelled\) setState\(\{ businessId: scopedBusinessId, hasSea: null \}\);/);
  // Only for a business that flies and a person who can open the lists.
  assert.match(consoleSource, /useBusinessHasSeaContainer\(\s*businessId,\s*enabled && flies && canOpenContainerLists,/);
  assert.match(consoleSource, /const airOnly = airOnlyBusiness\(flies, hasSeaContainer\);/);
});

test("the console hands air-only to the step bar, the sidebar, Today and the lists", () => {
  assert.match(consoleSource, /shippingStepsFor\(shippingSteps, airOnly\)/);
  assert.match(consoleSource, /steps=\{shippingStepsShown\}/);
  assert.match(consoleSource, /description: shippingCopy\(true\)\.sidebarDescription/);
  assert.match(consoleSource, /<TodayView\s+airOnly=\{airOnly\}/);
  assert.match(consoleSource, /<ContainersPanel\s+airOnly=\{airOnly\}/);
  assert.match(todayView, /title=\{copy\.todayTitle\}/);
  assert.match(todayView, /leftLabel=\{copy\.leftLabel\}/);
});

test("the lists start on Air and a sea container found later brings the old words back", () => {
  // The rows the panel already holds overrule the count.
  assert.match(panel, /const airOnly = useMemo\(\s*\(\) => airOnlyBusiness && !containerRows\.some\(\(row\) => !isAirContainer\(row\)\),/);
  assert.match(panel, /setContainerDraft\(airOnly \? \{ ?\.\.\.emptyContainerDraft, shipMode: "air" ?\} : emptyContainerDraft\)/);
  assert.match(panel, /<h2>\{copy\.listTitle\}<\/h2>/);
  assert.match(panel, /airOnly=\{airOnly\}/);
});

test("the register form of an air-only business starts on Air with a box and no car question", () => {
  assert.match(waiting, /setShipMode\(airOnly \? "air" : "sea"\);/);
  assert.match(waiting, /airOnly \? \{ \.\.\.next, pieces: \[newPieceDraft\("box"\)\] \} : next/);
  assert.match(waiting, /setDraft\(startDraft\(emptyWaitingPackageDraft\(defaultDestination\)\)\);/);
  assert.match(waiting, /\{\(!airOnly \|\| draft\.kind === "car"\) && \(\s*<fieldset className="lst-fieldset">/);
  assert.match(waiting, /<h2>\{copy\.waitingTitle\}<\/h2>/);
  assert.match(waiting, /placeholder=\{copy\.waitingSearch\}/);
  assert.match(waiting, /: copy\.registerSubtitle\}/);
  // The Air / Sea filter shows only while there is something to tell apart.
  assert.match(waiting, /const modeFilterShown = shipsByAir && \(!airOnly \|\| airCount < sorted\.length\);/);
});
