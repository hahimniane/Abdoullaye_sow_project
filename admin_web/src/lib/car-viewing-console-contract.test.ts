// What the two consoles must do with a car viewing.
//
// The rules live in `car-viewing.ts` and are tested there. These tests are
// about the wiring: that both consoles ask the same module which buttons
// exist, that they send `actOnCarViewing` rather than writing Firestore, that
// a business can actually see a request waiting on it, and that every sentence
// either console adds - including the ones the callable throws back - has a
// French translation.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { VIEWING_STATUS_LABELS } from "./car-viewing.ts";
import { translateValue } from "./french-dom.ts";

const operationsSource = readFileSync(
  new URL("../components/business/operations-panels.tsx", import.meta.url),
  "utf8",
);
const customerViewingSource = readFileSync(
  new URL("../components/customer-car-viewing.tsx", import.meta.url),
  "utf8",
);
const customerConsoleSource = readFileSync(
  new URL("../components/customer-console.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

const purchasesPanel = operationsSource.slice(
  operationsSource.indexOf("function ViewingNegotiation"),
  operationsSource.indexOf("function useBusinessRows"),
);

test("both consoles decide their buttons from the shared rules, never from the status alone", () => {
  for (const source of [purchasesPanel, customerViewingSource]) {
    assert.match(source, /viewingActionAvailability\(\{/);
    assert.match(source, /available\.canAccept/);
    assert.match(source, /available\.canPropose/);
    assert.match(source, /available\.canCancel/);
  }
  assert.match(purchasesPanel, /actor: "business"/);
  assert.match(customerViewingSource, /actor: "customer"/);
});

test("every viewing transition goes through the one callable, with no client-supplied role", () => {
  for (const source of [operationsSource, customerViewingSource]) {
    assert.match(source, /httpsCallable\(functions, "actOnCarViewing"\)\(\s*viewingActionPayload\(/);
  }
  // The four actions, and only those four.
  for (const action of ['"accept"', '"propose"', '"decline"', '"cancel"']) {
    assert.ok(purchasesPanel.includes(action), `business console never sends ${action}`);
  }
  for (const action of ['"accept"', '"propose"', '"cancel"']) {
    assert.ok(customerViewingSource.includes(action), `customer console never sends ${action}`);
  }
  // Declining is the seller's answer; the buyer cancels instead.
  assert.doesNotMatch(customerViewingSource, /"decline"/);
  // The role is derived server-side from the record.
  for (const source of [purchasesPanel, customerViewingSource]) {
    assert.doesNotMatch(source, /role:\s*"(customer|business)"/);
  }
});

test("a viewing waiting on the business is visible without going looking for it", () => {
  // Same alert border and same Needs action filter as a hold review.
  assert.match(
    operationsSource,
    /function purchaseNeedsAction[\s\S]*?viewingAwaitingParty\(text\(row\.purchaseStatus, ""\)\) === "business"/,
  );
  // And each new status is filterable in its own right. The filter list is
  // split by queue - viewings and purchases each offer only what can match
  // them - so the assertion is against the viewings branch.
  const viewingFilters = operationsSource.match(
    /scope === "viewings" \?\s*\[([^\]]*)\]/,
  );
  assert.ok(viewingFilters, "the viewings queue has no filter list");
  for (const status of [
    "viewing_requested",
    "viewing_countered",
    "viewing_scheduled",
    "viewing_declined",
    "viewing_expired",
  ]) {
    assert.ok(
      viewingFilters[1].includes(`"${status}"`),
      `${status} is not offered as a filter on the viewings queue`,
    );
  }

  // The purchases queue must not offer them: they can never match there now
  // that viewings have their own tab, so they would return an empty list.
  const purchaseFilters = operationsSource.match(
    /:\s*\["all", "needs_action", "holds"([^\]]*)\]/,
  );
  assert.ok(purchaseFilters, "the purchases queue has no filter list");
  assert.ok(
    !purchaseFilters[1].includes("viewing_"),
    "the purchases queue still offers viewing filters that cannot match",
  );
});

test("the business card shows who is waited on, by when, and what is on the table", () => {
  for (const label of [
    "Waiting on",
    "Reply by",
    "Times on the table",
    "Pick a time to accept",
    "Negotiation history",
  ]) {
    assert.ok(purchasesPanel.includes(label), `the business card never shows "${label}"`);
  }
  // Up to three times in one counter, the cap the server enforces.
  assert.match(purchasesPanel, /counterSlots\.length < available\.maxSlots/);
  assert.match(purchasesPanel, /Add another time/);
  assert.match(purchasesPanel, /validateViewingSlots\(slots, nowMs, available\.maxSlots\)/);
});

test("the customer counters with one time, and is never offered a bulk counter", () => {
  assert.match(customerViewingSource, /viewingSlotFromInput\(proposedAt\)/);
  assert.match(customerViewingSource, /validateViewingSlots\(slots, nowMs, available\.maxSlots\)/);
  assert.doesNotMatch(customerViewingSource, /Add another time/);
});

test("cancel is offered last and gated on nothing but the viewing being open", () => {
  for (const source of [purchasesPanel, customerViewingSource]) {
    assert.match(source, /available\.canCancel && \(/);
    assert.match(source, /Cancel viewing/);
    // Nothing narrows it further - not the round cap, not the listing status.
    assert.doesNotMatch(source, /canCancel &&\s*available\.(canPropose|proposalsLeft)/);
  }
});

test("a refusal from the callable is shown as the sentence it already is", () => {
  assert.match(
    customerViewingSource,
    /catch \(callableError\)[\s\S]*?callableError instanceof Error\s*\?\s*callableError\.message/,
  );
  // The business panel routes viewing actions through runHold, which already
  // surfaces the error message rather than a generic line.
  assert.match(
    operationsSource,
    /setMessage\(error instanceof Error \? error\.message : "Action failed\."\)/,
  );
});

test("both consoles tick a clock, so a card left open stops offering a stale action", () => {
  for (const source of [operationsSource, customerViewingSource]) {
    assert.match(source, /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 30_000\)/);
  }
});

test("the customer drawer reads the live record rather than a snapshot taken at open time", () => {
  assert.match(customerConsoleSource, /const \[selectedKey, setSelectedKey\] = useState\(""\)/);
  assert.match(
    customerConsoleSource,
    /orders\.find\(\(order\) => orderKey\(order\) === selectedKey\)/,
  );
  assert.doesNotMatch(customerConsoleSource, /setSelected\(order\)/);
  assert.match(
    customerConsoleSource,
    /carPurchaseIsViewing\(selected\.row\) && \(\s*<CustomerCarViewing row=\{selected\.row\}/,
  );
});

test("the console's status names match the ones the business panel already prints", () => {
  for (const [status, label] of Object.entries(VIEWING_STATUS_LABELS)) {
    assert.match(
      operationsSource,
      new RegExp(`${status}: "${label}"`),
      `the business status table disagrees about ${status}`,
    );
  }
  // And the customer console shows those names instead of the raw value.
  assert.match(customerConsoleSource, /viewingStatusLabel\(status\) \|\| status/);
});

test("the shared slot, counter and history styles exist for both consoles to use", () => {
  for (const rule of [
    ".viewing-slots",
    ".viewing-slot",
    ".viewing-counter-fields",
    ".viewing-history",
    ".customer-viewing",
  ]) {
    assert.ok(stylesSource.includes(`${rule} `), `${rule} has no styles`);
  }
});

test("every sentence the viewing flow adds is translated", () => {
  const strings = [
    // Rendered by the consoles.
    "Viewing appointment",
    "Viewing status",
    "Agreed time",
    "Waiting on",
    "Reply by",
    "Your reply is needed",
    "Waiting on the seller",
    "Waiting on the buyer",
    "Times on the table",
    "Pick a time to accept",
    "Too soon",
    "Add another time",
    "Time you would like",
    "Negotiation history",
    "Accept this time",
    "Offer other times",
    "Offer a different time",
    "Propose a new time",
    "Send these times",
    "Send this time",
    "Discard these times",
    "Discard this time",
    "Viewing done",
    "Cancel viewing",
    "Viewing requested",
    "Other times offered",
    "Viewing declined",
    "Viewing request expired",
    // Thrown by actOnCarViewing and shown verbatim.
    "This viewing is already closed",
    "This proposal has expired. Please propose a new time",
    "You are waiting on the other party to respond",
    "You cannot take that action on this viewing",
    "Choose one of the times that was offered",
    "Viewing times must be more than an hour away",
    "Viewings cannot be changed within an hour of the appointment",
    "This car is no longer available to view",
    "This has gone back and forth enough - accept a time, decline, or cancel",
    "Too many times offered at once",
    "Choose a viewing time",
    "That viewing time is not valid",
  ];
  const untranslated = strings.filter(
    (english) => translateValue(english, "fr") === english,
  );
  assert.deepEqual(
    untranslated,
    [],
    `these viewing strings render in English for a French user:\n${untranslated.join("\n")}`,
  );
});
