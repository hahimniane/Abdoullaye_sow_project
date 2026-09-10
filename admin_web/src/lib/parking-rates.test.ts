import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  nextParkingRateId,
  normalizeParkingRates,
  parkingRateChoices,
  parkingRateOptionLabel,
} from "./parking-rates.ts";

// A lot can charge more than one price — a bigger space, a long-stay deal, a
// rate for the dealer who brings six cars at once.
test("only cards that can price a stay are kept", () => {
  const cards = normalizeParkingRates([
    { id: "ok", label: "Standard", dailyRate: 12 },
    { id: "", label: "No id", dailyRate: 12 },
    { id: "noname", label: "", dailyRate: 12 },
    { id: "free", label: "No rate", dailyRate: 0 },
    { id: "ok", label: "Duplicate", dailyRate: 99 },
    "not an object",
    null,
  ]);
  assert.deepEqual(cards.map((c) => c.id), ["ok"]);
  // Blank optionals settle at zero; a minimum stay is at least one day.
  assert.equal(cards[0].weeklyRate, 0);
  assert.equal(cards[0].minimumDays, 1);
  // Nothing at all is not an error, just no cards.
  assert.deepEqual(normalizeParkingRates(undefined), []);
});

test("the picker offers the standard rate first, then each card", () => {
  const choices = parkingRateChoices({
    parkingDailyRate: 12,
    parkingRates: [
      { id: "suv", label: "SUV / oversize", dailyRate: 18 },
      { id: "long", label: "Long stay", dailyRate: 9 },
    ],
  });
  assert.deepEqual(choices.map((c) => c.id), ["", "suv", "long"]);
  // The standard rate carries an empty id — which is exactly what the server
  // reads as "no card chosen", so the default costs nothing to express.
  assert.equal(choices[0].id, "");
  assert.equal(parkingRateOptionLabel(choices[1]), "SUV / oversize — $18.00/day");

  // A lot with only its own rate has nothing to choose between, and the
  // picker hides itself on length.
  assert.equal(parkingRateChoices({ parkingDailyRate: 12 }).length, 1);
  // And a lot that has not set a rate at all offers nothing rather than $0.
  assert.deepEqual(parkingRateChoices({}), []);
});

test("a new card never collides with one already there", () => {
  const existing = normalizeParkingRates([
    { id: "rate1", label: "A", dailyRate: 1 },
    { id: "rate2", label: "B", dailyRate: 2 },
  ]);
  assert.equal(nextParkingRateId(existing), "rate3");
  assert.equal(nextParkingRateId([]), "rate1");
});

test("the walk-up form only sends a price when one was chosen", () => {
  const lib = readFileSync("src/lib/business-parking-entry.ts", "utf8");
  assert.match(lib, /\.\.\.\(rateId \? \{parkingRateId: rateId\} : \{\}\)/);
  const panel = readFileSync("src/components/business/operations-panels.tsx", "utf8");
  // The picker is absent when there is nothing to pick.
  assert.match(panel, /\{rateChoices\.length > 1 && \(/);
  assert.match(panel, /parkingRateId: event\.target\.value/);
});
