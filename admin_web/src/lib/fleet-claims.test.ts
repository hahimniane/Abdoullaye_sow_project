import assert from "node:assert/strict";
import test from "node:test";

import {
  claimSentence,
  cleanPayerNames,
  depositsForClaim,
  isOpenClaim,
  openClaimViews,
  readClaim,
  readPayerNames,
} from "./fleet-claims.ts";
import { FLEET_REFUSALS, fleetErrorMessage } from "./fleet.ts";
import { translateValue } from "./french-dom.ts";

// Synthetic data only.
const names = new Map([["d1", "Test Driver One"], ["d2", "Test Driver Two"]]);
const claim = (extra: Record<string, unknown>) => ({
  id: "c", businessId: "b", driverId: "d1", fromPhone: "+15550000001", state: "waiting_bank", amountCents: 40000,
  createdAtMs: 1000, ...extra,
});

test("only open claims are listed; paid, closed and unreadable are not", () => {
  const rows = [
    claim({ id: "a", state: "asking_driver", driverId: null }),
    claim({ id: "b", state: "asking_amount", amountCents: null }),
    claim({ id: "c", state: "waiting_bank" }),
    claim({ id: "d", state: "asking_name" }),
    claim({ id: "e", state: "office", reason: "two_claims" }),
    claim({ id: "f", state: "paid" }),
    claim({ id: "g", state: "closed" }),
    claim({ id: "h", state: "something_new" }),
    { state: "waiting_bank" },
    null,
  ];
  assert.deepEqual(openClaimViews(rows, names).map((v) => v.id).sort(), ["a", "b", "c", "d", "e"]);
  assert.equal(isOpenClaim(readClaim(claim({ state: "paid" }))!), false);
});

test("oldest first; the phone stands in when there is no driver yet", () => {
  const views = openClaimViews([
    claim({ id: "late", createdAtMs: 5000 }),
    claim({ id: "old", createdAtMs: 1000, driverId: null, fromPhone: "+15550000009" }),
    claim({ id: "mid", createdAtMs: 3000, driverId: "d2" }),
  ], names);
  assert.deepEqual(views.map((v) => v.id), ["old", "mid", "late"]);
  assert.equal(views[0].who, "+15550000009");
  assert.equal(views[0].hasDriver, false);
  assert.equal(views[1].who, "Test Driver Two");
});

test("a claim with no readable amount shows none, never NaN or 0", () => {
  assert.equal(readClaim(claim({ amountCents: null }))!.amountCents, null);
  assert.equal(readClaim(claim({ amountCents: "x" }))!.amountCents, null);
  assert.equal(readClaim(claim({ amountCents: 0 }))!.amountCents, null);
  assert.equal(readClaim(claim({ amountCents: 40000 }))!.amountCents, 40000);
});

test("every state and office reason has its own sentence", () => {
  const sentences = new Set<string>();
  for (const state of ["asking_driver", "asking_amount", "asking_name", "waiting_bank"]) {
    sentences.add(claimSentence({ state: state as never, reason: "", toldLateAtMs: 0 }));
  }
  sentences.add(claimSentence({ state: "waiting_bank", reason: "", toldLateAtMs: 9 }));
  for (const reason of ["wrong_recipient", "deposit_taken", "too_old", "not_a_driver", "two_claims", "", "new_reason"]) {
    sentences.add(claimSentence({ state: "office", reason, toldLateAtMs: 0 }));
  }
  assert.equal(sentences.size, 11); // four states, the late one, five reasons, one fallback
  assert.ok([...sentences].every((t) => t.length > 10));
  for (const english of sentences) assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
});

test("deposits offered to a claim: not pending, same amount first, then newest", () => {
  const waiting = [
    { id: "w1", amountCents: 30000, atMs: 3000, pending: false },
    { id: "w2", amountCents: 40000, atMs: 1000, pending: false },
    { id: "w3", amountCents: 40000, atMs: 2000, pending: false },
    { id: "w4", amountCents: 40000, atMs: 9000, pending: true },
    { id: "", amountCents: 40000, atMs: 9000, pending: false },
  ];
  const offered = depositsForClaim(40000, waiting);
  assert.deepEqual(offered.map((o) => o.deposit.id), ["w3", "w2", "w1"]);
  assert.deepEqual(offered.map((o) => o.sameAmount), [true, true, false]);
  assert.deepEqual(depositsForClaim(null, waiting).map((o) => o.sameAmount), [false, false, false]);
  assert.deepEqual(depositsForClaim(40000, []), []);
});

test("remembered names: old records read without error, cleaned like a save", () => {
  assert.deepEqual(readPayerNames({ id: "d", personalCents: 7 }), []);
  assert.deepEqual(readPayerNames(null), []);
  assert.deepEqual(readPayerNames({ rememberedSenders: ["TEST ONE", " test  one ", "", "TEST TWO"] }), ["TEST ONE", "TEST TWO"]);
  assert.deepEqual(cleanPayerNames(["A  B", "a b", 5, null]), ["A B", "5"]);
});

test("the claim refusals have plain sentences, with a generic fallback", () => {
  for (const reason of ["fleet_claim_not_found", "fleet_deposit_taken", "fleet_bad_input", "fleet_driver_not_active"]) {
    assert.ok(FLEET_REFUSALS[reason], reason);
    assert.equal(fleetErrorMessage({ details: { reason } }), FLEET_REFUSALS[reason]);
  }
  assert.equal(fleetErrorMessage({ details: { reason: "fleet_unheard_of" } }), "Something went wrong. Try again.");
});

test("every new word on the claims panel and the names panel reads in French", () => {
  for (const english of [
    "Reported by drivers, waiting for the bank",
    "A driver sent a payment screenshot on WhatsApp. Nobody is marked paid from a picture: the deposit in the bank is the proof.",
    "No payment reported by a driver is waiting.",
    "The reported payments could not be loaded. Refresh in a moment.",
    "View photo", "Photo not available", "No photo", "Payment screenshot",
    "This deposit is theirs", "Give this deposit", "Deposit that is theirs", "Pick the deposit…", "No deposit is waiting",
    "Pick the deposit that is theirs.",
    "This deposit is for a different amount. The bank's amount is what is recorded.",
    "Report closed.", "Close",
    "Names this driver pays from",
    "A Zelle from one of these names pays this driver by itself.",
    "No name yet. It is remembered the first time a deposit is matched to this driver.",
    "Remove this name", "Add a name", "Add name", "Name on the Zelle account",
    "That name is already on the list.", "Type a name first.",
    FLEET_REFUSALS.fleet_claim_not_found, FLEET_REFUSALS.fleet_deposit_taken, FLEET_REFUSALS.fleet_driver_not_active,
  ]) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});
