import assert from "node:assert/strict";
import test from "node:test";

import { BOX_3D_TIMEOUT_MS, startWithin, webglAvailable } from "./box-3d-load.ts";

const later = <T>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

test("the scene arrives in time: its value is the outcome", async () => {
  const discarded: string[] = [];
  const run = startWithin(() => later("scene", 5), 200, (late) => discarded.push(late));
  assert.deepEqual(await run.done, { ok: true, value: "scene" });
  assert.deepEqual(discarded, []);
});

test("a failed load settles as an error, never hangs", async () => {
  const run = startWithin(() => Promise.reject(new Error("no webgl")), 200, () => undefined);
  assert.deepEqual(await run.done, { ok: false, reason: "error" });
  const thrown = startWithin(() => {
    throw new Error("sync");
  }, 200, () => undefined);
  assert.deepEqual(await thrown.done, { ok: false, reason: "error" });
});

test("too slow: a timeout, and the late scene is handed back to be freed", async () => {
  const discarded: string[] = [];
  const run = startWithin(() => later("late scene", 40), 10, (late) => discarded.push(late));
  assert.deepEqual(await run.done, { ok: false, reason: "timeout" });
  await later(null, 80);
  assert.deepEqual(discarded, ["late scene"]);
});

test("a cancel (the page left) settles at once and frees a scene that still arrives", async () => {
  const discarded: string[] = [];
  const run = startWithin(() => later("scene", 20), 500, (late) => discarded.push(late));
  run.cancel();
  assert.deepEqual(await run.done, { ok: false, reason: "cancelled" });
  await later(null, 60);
  assert.deepEqual(discarded, ["scene"]);
  run.cancel();
});

test("the timeout is the 8 seconds the contract promises, and webgl probing never throws", () => {
  assert.equal(BOX_3D_TIMEOUT_MS, 8000);
  assert.equal(webglAvailable(null), false);
  assert.equal(webglAvailable({ createElement: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement }), false);
  assert.equal(webglAvailable({ createElement: () => ({ getContext: () => ({}) }) as unknown as HTMLCanvasElement }), true);
  assert.equal(webglAvailable({ createElement: () => { throw new Error("boom"); } }), false);
});
