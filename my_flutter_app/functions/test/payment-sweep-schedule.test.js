"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  BASE_RECONCILE_DELAY_MS,
  MAX_RECONCILE_AGE_MS,
  MAX_RECONCILE_DELAY_MS,
  needsFreshSchedule,
  planNextReconcileCheck,
  reconcileBackoffMs,
  reconcileTrackingKey,
  rotateForRun,
  roundRobinPages,
} = require("../payment_sweep_schedule");

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("reconcile backoff", () => {
  it("doubles from 10 minutes and caps at a day", () => {
    assert.equal(reconcileBackoffMs(1), 10 * MIN);
    assert.equal(reconcileBackoffMs(2), 20 * MIN);
    assert.equal(reconcileBackoffMs(3), 40 * MIN);
    assert.equal(reconcileBackoffMs(9), MAX_RECONCILE_DELAY_MS);
    assert.equal(reconcileBackoffMs(10000), MAX_RECONCILE_DELAY_MS);
    assert.equal(reconcileBackoffMs(0), BASE_RECONCILE_DELAY_MS);
  });

  it("a never-paid record is checked a bounded number of times, then " +
      "abandoned - not every 10 minutes forever", () => {
    const started = DAY;
    let now = started + 10 * MIN;
    let previous;
    let checks = 0;
    for (;;) {
      const plan = planNextReconcileCheck({previous, key: "pi:1", nowMs: now,
        recordStartedAtMs: started});
      checks += 1;
      if (plan.abandoned) {
        assert.equal(plan.abandonReason, "max_age");
        assert.equal(plan.nextCheckAtMs, null);
        break;
      }
      assert.ok(plan.nextCheckAtMs > now);
      previous = plan;
      now = plan.nextCheckAtMs;
      assert.ok(checks < 50, "never abandoned");
    }
    // The old sweep: every 10 minutes for 7 days = 1008 checks.
    assert.ok(checks <= 16, `took ${checks} checks`);
    assert.ok(now - started >= MAX_RECONCILE_AGE_MS);
  });
});

describe("planNextReconcileCheck", () => {
  it("starts a fresh schedule at attempt 1 from the record's start", () => {
    const plan = planNextReconcileCheck({key: "pi:a", nowMs: 2 * HOUR,
      recordStartedAtMs: HOUR});
    assert.equal(plan.attempts, 1);
    assert.equal(plan.startedAtMs, HOUR);
    assert.equal(plan.nextCheckAtMs, 2 * HOUR + 10 * MIN);
    assert.equal(plan.abandoned, false);
  });

  it("continues the same attempt and resets on a new one", () => {
    const first = planNextReconcileCheck({key: "pi:a", nowMs: HOUR,
      recordStartedAtMs: MIN});
    const second = planNextReconcileCheck({previous: first, key: "pi:a",
      nowMs: 2 * HOUR});
    assert.equal(second.attempts, 2);
    assert.equal(second.startedAtMs, MIN);
    // The customer tried again with a new intent: backoff starts over.
    const retry = planNextReconcileCheck({previous: second, key: "pi:b",
      nowMs: 3 * HOUR, recordStartedAtMs: 3 * HOUR});
    assert.equal(retry.attempts, 1);
    assert.equal(retry.startedAtMs, 3 * HOUR);
  });

  it("abandons immediately with a reason (simulated intents)", () => {
    const plan = planNextReconcileCheck({key: "pi:simulated_1",
      nowMs: HOUR, abandonReason: "simulated"});
    assert.equal(plan.abandoned, true);
    assert.equal(plan.abandonReason, "simulated");
    assert.equal(plan.nextCheckAtMs, null);
  });

  it("an old legacy record gets one last check, then is abandoned", () => {
    const plan = planNextReconcileCheck({key: "cs:x", nowMs: 30 * DAY,
      recordStartedAtMs: DAY});
    assert.equal(plan.abandoned, true);
  });

  it("ignores a nonsense start (future or missing)", () => {
    assert.equal(planNextReconcileCheck({key: "none", nowMs: HOUR,
      recordStartedAtMs: 5 * HOUR}).startedAtMs, HOUR);
    assert.equal(planNextReconcileCheck({key: "none", nowMs: HOUR,
      recordStartedAtMs: NaN}).startedAtMs, HOUR);
  });
});

describe("discovery", () => {
  it("keys a record by intent, else session", () => {
    assert.equal(reconcileTrackingKey("pi_1", "cs_1"), "pi:pi_1");
    assert.equal(reconcileTrackingKey("", "cs_1"), "cs:cs_1");
    assert.equal(reconcileTrackingKey("", ""), "none");
  });

  it("checks a record only when it has no schedule for this attempt", () => {
    assert.equal(needsFreshSchedule(undefined, "pi:a"), true);
    assert.equal(needsFreshSchedule({key: "pi:a"}, "pi:a"), false);
    // Abandoned for this attempt stays abandoned.
    assert.equal(needsFreshSchedule({key: "pi:a", abandonedAtMs: 1}, "pi:a"),
        false);
    // A session that later bound an intent is a new key: checked again.
    assert.equal(needsFreshSchedule({key: "cs:s"}, "pi:a"), true);
  });
});

describe("fair scheduling across scans", () => {
  it("rotates the starting scan each run", () => {
    const scans = ["a", "b", "c"];
    assert.deepEqual(rotateForRun(scans, 0), ["a", "b", "c"]);
    assert.deepEqual(rotateForRun(scans, 10 * MIN), ["b", "c", "a"]);
    assert.deepEqual(rotateForRun(scans, 20 * MIN), ["c", "a", "b"]);
    assert.deepEqual(rotateForRun([], 0), []);
  });

  it("a huge backlog in one scan cannot starve the others", async () => {
    const pages = {big: 0, small1: 0, small2: 0};
    const make = (id, total) => ({id, nextPage: async () => {
      pages[id] += 1;
      return pages[id] < total;
    }});
    let clock = 0;
    const result = await roundRobinPages({
      sources: [make("big", 1000), make("small1", 2), make("small2", 3)],
      deadlineMs: 10,
      now: () => clock++,
    });
    assert.equal(result.deadlineReached, true);
    // Old behaviour: scan "big" would have used the whole run first.
    assert.equal(pages.small1, 2);
    assert.equal(pages.small2, 3);
    assert.ok(pages.big >= 3);
  });

  it("finishes when every source runs dry", async () => {
    const result = await roundRobinPages({
      sources: [{id: "a", nextPage: async () => false}],
      deadlineMs: Infinity,
    });
    assert.equal(result.deadlineReached, false);
    assert.deepEqual(result.pagesBySource, {a: 1});
  });
});
