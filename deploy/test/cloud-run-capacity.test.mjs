// The check that would have prevented two outages on 2026-08-07.
//
// Both times the deploy's preflight passed and the deploy then exhausted the
// Cloud Run CPU quota, leaving functions on revisions that could not serve.
// The gap was never a missing signal - it was that nothing added up what a
// deploy was ABOUT to reserve on top of what was already held.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_MAX_INSTANCES,
  deployCapacity,
  revisionReservedCpu,
  summarizeReservations,
} from "../cloud-run-capacity-lib.mjs";

test("a revision reserves cpu times its instance ceiling", () => {
  assert.equal(revisionReservedCpu({ cpu: 1, maxInstances: 10 }), 10);
  assert.equal(revisionReservedCpu({ cpu: "1", maxInstances: "3" }), 3);
  assert.equal(revisionReservedCpu({ cpu: 0.5, maxInstances: 4 }), 2);
});

test("an unpinned maxInstances reserves Cloud Run's default, not one", () => {
  // Reading a missing ceiling as 1 would under-report by a hundredfold and
  // wave through exactly the deploy this check exists to stop.
  assert.equal(
      revisionReservedCpu({ cpu: 1 }),
      DEFAULT_MAX_INSTANCES,
  );
});

test("unreadable rows contribute nothing rather than throwing", () => {
  assert.equal(revisionReservedCpu(null), 0);
  assert.equal(revisionReservedCpu({}), 0);
  assert.equal(revisionReservedCpu({ cpu: "unknown", maxInstances: 3 }), 0);
  assert.equal(revisionReservedCpu({ cpu: -1, maxInstances: 3 }), 0);
});

test("idle revisions are counted as recoverable debt", () => {
  const summary = summarizeReservations([
    { cpu: 1, maxInstances: 10, serving: true },
    { cpu: 1, maxInstances: 10, serving: false },
    { cpu: 1, maxInstances: 10, serving: false },
  ]);
  assert.equal(summary.reservedCpu, 30);
  assert.equal(summary.servingCpu, 10);
  assert.equal(summary.debtCpu, 20);
  assert.equal(summary.total, 3);
  assert.equal(summary.idle, 2);
});

test("a non-array is a summary of nothing, not a crash", () => {
  const summary = summarizeReservations(undefined);
  assert.equal(summary.reservedCpu, 0);
  assert.equal(summary.total, 0);
});

test("the peak counts the incoming revisions, not just what is held", () => {
  // The whole point. Old revisions are held until the new ones are healthy,
  // so a deploy's peak is current + incoming. Judging on `reserved` alone is
  // what let both outages through.
  const summary = summarizeReservations([
    { cpu: 1, maxInstances: 10, serving: true },
  ]);
  const verdict = deployCapacity(summary, 10, 10, 100);
  assert.equal(verdict.projected, 110);
  assert.equal(verdict.fits, false, "110 does not fit in 100");
});

test("it recommends a prune when a prune would be enough", () => {
  const summary = summarizeReservations([
    { cpu: 1, maxInstances: 10, serving: true },
    ...Array.from({ length: 8 }, () => ({
      cpu: 1,
      maxInstances: 10,
      serving: false,
    })),
  ]);
  // 90 reserved, 80 of it idle, deploy adds 30 -> 120 now, 40 after a prune.
  const verdict = deployCapacity(summary, 10, 3, 100);
  assert.equal(verdict.fits, false);
  assert.equal(verdict.fitsAfterPrune, true);
  assert.match(verdict.remedy, /prune idle revisions first/);
  assert.match(verdict.remedy, /80 CPU/);
});

test("it says so plainly when pruning cannot save the deploy", () => {
  // The situation on 2026-08-07: even with every idle revision gone, the
  // deploy still did not fit. Recommending a prune here would have sent
  // someone round the same loop that had already failed twice.
  const summary = summarizeReservations([
    { cpu: 1, maxInstances: 10, serving: true },
    { cpu: 1, maxInstances: 10, serving: false },
  ]);
  const verdict = deployCapacity(summary, 178, 10, 100);
  assert.equal(verdict.fits, false);
  assert.equal(verdict.fitsAfterPrune, false);
  assert.match(verdict.remedy, /quota/);
  assert.doesNotMatch(verdict.remedy, /prune idle revisions first/);
});

test("a deploy that fits carries no remedy", () => {
  const summary = summarizeReservations([
    { cpu: 1, maxInstances: 3, serving: true },
  ]);
  const verdict = deployCapacity(summary, 10, 3, 1000);
  assert.equal(verdict.fits, true);
  assert.equal(verdict.headroom, 1000 - 33);
  assert.equal(verdict.remedy, "");
});

test("an unknown limit never reports a fit", () => {
  // Failing closed matters more than convenience here: silently passing when
  // the ceiling could not be read is how the old dry-run check behaved.
  const summary = summarizeReservations([
    { cpu: 1, maxInstances: 3, serving: true },
  ]);
  assert.equal(deployCapacity(summary, 1, 3, 0).fits, false);
  assert.equal(deployCapacity(summary, 1, 3, NaN).fits, false);
});
