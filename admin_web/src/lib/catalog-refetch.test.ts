import assert from "node:assert/strict";
import test from "node:test";

import {
  CATALOG_REFETCH_MAX_JITTER_MS,
  catalogRefetchDelayMs,
  createCatalogBumpScheduler,
} from "./catalog-refetch.ts";

test("the jitter spans 0 to 30 seconds", () => {
  assert.equal(CATALOG_REFETCH_MAX_JITTER_MS, 30_000);
  assert.equal(catalogRefetchDelayMs(() => 0), 0);
  assert.equal(catalogRefetchDelayMs(() => 0.5), 15_000);
  assert.equal(catalogRefetchDelayMs(() => 0.999999999), 30_000);
  for (let i = 0; i < 1000; i += 1) {
    const delay = catalogRefetchDelayMs();
    assert.ok(Number.isInteger(delay) && delay >= 0 && delay <= 30_000, String(delay));
  }
});

test("a bad random source still yields a delay in range", () => {
  assert.equal(catalogRefetchDelayMs(() => Number.NaN), 0);
  assert.equal(catalogRefetchDelayMs(() => -1), 0);
  assert.equal(catalogRefetchDelayMs(() => 1), 30_000);
  assert.equal(catalogRefetchDelayMs(() => 7), 30_000);
});

function fakeClock() {
  let next = 1;
  const timers = new Map<number, { callback: () => void; ms: number }>();
  return {
    timers,
    setTimer: (callback: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { callback, ms });
      return id;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    fireAll() {
      const due = [...timers.entries()];
      timers.clear();
      due.forEach(([, timer]) => timer.callback());
    },
  };
}

test("the first snapshot is the current value and never re-fetches", () => {
  const clock = fakeClock();
  let refetches = 0;
  const scheduler = createCatalogBumpScheduler({
    refetch: () => { refetches += 1; },
    delayMs: () => 1234,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  scheduler.onSignal();
  assert.equal(clock.timers.size, 0);
  clock.fireAll();
  assert.equal(refetches, 0);
});

test("a bump re-fetches only after the jitter elapses", () => {
  const clock = fakeClock();
  let refetches = 0;
  const scheduler = createCatalogBumpScheduler({
    refetch: () => { refetches += 1; },
    delayMs: () => 1234,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  scheduler.onSignal();
  scheduler.onSignal();
  assert.equal(refetches, 0, "nothing is fetched at bump time");
  assert.deepEqual([...clock.timers.values()].map((timer) => timer.ms), [1234]);
  clock.fireAll();
  assert.equal(refetches, 1);
  // A later bump schedules a fresh wait.
  scheduler.onSignal();
  assert.equal(clock.timers.size, 1);
  clock.fireAll();
  assert.equal(refetches, 2);
});

test("bumps during a pending wait join it instead of stacking or postponing", () => {
  const clock = fakeClock();
  let refetches = 0;
  const scheduler = createCatalogBumpScheduler({
    refetch: () => { refetches += 1; },
    delayMs: () => 500,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  scheduler.onSignal();
  scheduler.onSignal();
  scheduler.onSignal();
  scheduler.onSignal();
  assert.equal(clock.timers.size, 1);
  clock.fireAll();
  assert.equal(refetches, 1);
});

test("unmount cancels a pending re-fetch", () => {
  const clock = fakeClock();
  let refetches = 0;
  const scheduler = createCatalogBumpScheduler({
    refetch: () => { refetches += 1; },
    delayMs: () => 500,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  scheduler.onSignal();
  scheduler.onSignal();
  scheduler.dispose();
  assert.equal(clock.timers.size, 0);
  scheduler.onSignal();
  assert.equal(clock.timers.size, 0);
  assert.equal(refetches, 0);
});

test("the default timers really wait before re-fetching", async () => {
  let refetches = 0;
  const scheduler = createCatalogBumpScheduler({
    refetch: () => { refetches += 1; },
    delayMs: () => 20,
  });
  scheduler.onSignal();
  scheduler.onSignal();
  assert.equal(refetches, 0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(refetches, 1);
  scheduler.dispose();
});
