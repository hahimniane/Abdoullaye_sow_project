import assert from "node:assert/strict";
import { test } from "node:test";

import { refreshTokenSoftly, withRetries, withTimeout } from "./console-boot.ts";

const noSleep = async () => undefined;

test("a failed first try is retried, and the second answer is used", async () => {
  let calls = 0;
  const value = await withRetries(async () => {
    calls += 1;
    if (calls === 1) throw new Error("offline");
    return "profile";
  }, {attempts: 2, delayMs: 1000, sleep: noSleep});
  assert.equal(value, "profile");
  assert.equal(calls, 2);
});

test("after the last try the failure is passed on", async () => {
  let calls = 0;
  await assert.rejects(withRetries(async () => {
    calls += 1;
    throw new Error(`fail ${calls}`);
  }, {attempts: 2, delayMs: 1, sleep: noSleep}), /fail 2/);
  assert.equal(calls, 2);
});

test("a session that ended stops the retries", async () => {
  let calls = 0;
  await assert.rejects(withRetries(async () => {
    calls += 1;
    throw new Error("offline");
  }, {attempts: 3, delayMs: 1, sleep: noSleep, keepGoing: () => false}));
  assert.equal(calls, 1);
});

test("a slow answer times out", async () => {
  await assert.rejects(withTimeout(new Promise(() => undefined), 5, "slow"), /slow/);
  assert.equal(await withTimeout(Promise.resolve(7), 50, "slow"), 7);
});

test("a token refresh that fails or hangs never stops the console", async () => {
  const failing = {getIdToken: (force?: boolean) => force ? Promise.reject(new Error("network")) : Promise.resolve("t")};
  assert.equal(await refreshTokenSoftly(failing), "cached");
  const hanging = {getIdToken: () => new Promise<string>(() => undefined)};
  assert.equal(await refreshTokenSoftly(hanging, 5), "cached");
  const fine = {getIdToken: () => Promise.resolve("t")};
  assert.equal(await refreshTokenSoftly(fine), "fresh");
});
