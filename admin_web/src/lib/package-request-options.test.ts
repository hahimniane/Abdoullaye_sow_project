import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PACKAGE_OPTIONS_MAX_AGE_MS,
  loadPackageOptions,
  prefetchPackageOptions,
  readCachedPackageOptions,
  validPackageAnswer,
  writeCachedPackageOptions,
} from "./package-request-options.ts";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

const ANSWER = { business: null, options: [{ country: { id: "GN", name: "Guinea" }, businessId: "b1" }] };

test("an answer is usable only with options that name a country", () => {
  assert.equal(validPackageAnswer(ANSWER), true);
  assert.equal(validPackageAnswer({ business: null, options: [] }), false);
  assert.equal(validPackageAnswer({ options: [{ country: {} }] }), false);
  assert.equal(validPackageAnswer(null), false);
  assert.equal(validPackageAnswer("x"), false);
});

test("a kept answer comes back for its own link, while it is fresh", () => {
  const storage = memoryStorage();
  writeCachedPackageOptions(storage, "", ANSWER, 1_000);
  assert.deepEqual(readCachedPackageOptions(storage, "", 2_000), ANSWER);
  // Another business's link has its own answer.
  assert.equal(readCachedPackageOptions(storage, "dala-ny", 2_000), null);
  writeCachedPackageOptions(storage, "Dala-NY", ANSWER, 1_000);
  assert.deepEqual(readCachedPackageOptions(storage, "dala-ny", 2_000), ANSWER);
  // Too old, or from the future (a wrong clock): not shown.
  assert.equal(readCachedPackageOptions(storage, "", 1_000 + PACKAGE_OPTIONS_MAX_AGE_MS + 1), null);
  assert.equal(readCachedPackageOptions(storage, "", 1_000 - 120_000), null);
});

test("unreadable or blocked storage never breaks the page", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
  assert.equal(readCachedPackageOptions(broken, "", 1), null);
  assert.doesNotThrow(() => writeCachedPackageOptions(broken, "", ANSWER, 1));
  const garbage = memoryStorage();
  garbage.setItem("laawol.packageOptions.v1.all", "{not json");
  assert.equal(readCachedPackageOptions(garbage, "", 1), null);
  assert.equal(readCachedPackageOptions(null, "", 1), null);
  // An empty answer is never kept (it would hide businesses for a week).
  const storage = memoryStorage();
  writeCachedPackageOptions(storage, "", { business: null, options: [] }, 1);
  assert.equal(storage.map.size, 0);
});

test("the form picks up the router's early request once, then asks again", async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return ANSWER; };
  prefetchPackageOptions("early", fetcher);
  prefetchPackageOptions("early", fetcher);
  assert.equal(calls, 1, "a second prefetch joins the first");
  const first = loadPackageOptions("early", fetcher);
  const again = loadPackageOptions("early", fetcher);
  assert.deepEqual(await first, ANSWER);
  assert.deepEqual(await again, ANSWER);
  assert.equal(calls, 1, "the form (even mounted twice) reused the early request");
  await loadPackageOptions("early", fetcher);
  assert.equal(calls, 1, "a form that mounts just after the answer reuses it");
});

test("a failed request is forgotten at once, so Try again asks again", async () => {
  let calls = 0;
  const failing = async () => { calls += 1; throw new Error("offline"); };
  await assert.rejects(loadPackageOptions("down", failing));
  await new Promise((r) => setTimeout(r, 0));
  await assert.rejects(loadPackageOptions("down", failing));
  assert.equal(calls, 2);
});
