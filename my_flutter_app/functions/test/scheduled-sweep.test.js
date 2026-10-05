"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  drainPages,
  mapWithConcurrency,
  sweepDeadline,
} = require("../scheduled_sweep");

describe("sweepDeadline", () => {
  it("keeps a reserve and applies the share", () => {
    assert.equal(sweepDeadline({startMs: 0, timeoutSeconds: 480}),
        450 * 1000);
    assert.equal(
        sweepDeadline({startMs: 1000, timeoutSeconds: 480, fraction: 0.6}),
        1000 + Math.floor(450 * 1000 * 0.6),
    );
  });

  it("never goes before the start", () => {
    assert.equal(sweepDeadline({startMs: 5, timeoutSeconds: 10}), 5);
  });
});

describe("mapWithConcurrency", () => {
  it("never runs more than the cap at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3,
        async (n) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
          return n * 2;
        });
    assert.equal(peak, 3);
    assert.deepEqual(results.map((r) => r.value), [2, 4, 6, 8, 10, 12, 14]);
  });

  it("isolates failures and keeps input order", async () => {
    const results = await mapWithConcurrency(["a", "b", "c"], 2,
        async (item) => {
          if (item === "b") throw new Error("boom");
          return item;
        });
    assert.deepEqual(results.map((r) => r.status),
        ["fulfilled", "rejected", "fulfilled"]);
    assert.equal(results[1].reason.message, "boom");
  });

  it("handles an empty list", async () => {
    assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
  });
});

describe("drainPages", () => {
  const source = (total) => async (cursor) => {
    const from = cursor === null ? 0 : cursor + 1;
    return Array.from({length: Math.max(0, Math.min(3, total - from))},
        (_, i) => from + i);
  };

  it("pages with the cursor until the source runs dry", async () => {
    const seen = [];
    const result = await drainPages({
      fetchPage: source(7), pageSize: 3, deadlineMs: Infinity,
      processPage: async (docs) => seen.push(...docs),
    });
    assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(result.exhausted, true);
    assert.equal(result.deadlineReached, false);
  });

  it("stops starting pages at the deadline (a started page finishes)",
      async () => {
        let clock = 0;
        const seen = [];
        const result = await drainPages({
          fetchPage: source(100), pageSize: 3, deadlineMs: 2,
          now: () => clock,
          processPage: async (docs) => {
            seen.push(...docs);
            clock += 1;
          },
        });
        assert.deepEqual(seen, [0, 1, 2, 3, 4, 5]);
        assert.equal(result.exhausted, false);
        assert.equal(result.deadlineReached, true);
      });

  it("has a page cap as a guard against a stuck cursor", async () => {
    const result = await drainPages({
      fetchPage: async () => [1, 2, 3], pageSize: 3, deadlineMs: Infinity,
      processPage: async () => {}, maxPages: 4,
    });
    assert.equal(result.pages, 4);
  });
});
