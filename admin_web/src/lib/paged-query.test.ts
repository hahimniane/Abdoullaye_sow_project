import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_PAGE_SIZE,
  businessCollectionPlan,
  hasMorePages,
  inBatches,
  loadedCountLabel,
  mergePages,
  pageWindows,
  querySpecKey,
  sameWindow,
  statusFilterSpec,
  withFocusedRow,
} from "./paged-query.ts";
import { firestoreCacheChoice } from "./firestore-cache-choice.ts";

// ---------------------------------------------------------------------------
// The page plan: which window each loaded page listens to.
// ---------------------------------------------------------------------------

test("one page: the top, capped", () => {
  assert.deepEqual(pageWindows([], 50), [{ after: null, through: null, limit: 50 }]);
});

test("after Load more, earlier pages are pinned to their last row and only the last page is capped", () => {
  assert.deepEqual(pageWindows(["c1", "c2"], 50), [
    { after: null, through: "c1", limit: null },
    { after: "c1", through: "c2", limit: null },
    { after: "c2", through: null, limit: 50 },
  ]);
});

test("a complete list is one uncapped window, whatever the cursors", () => {
  assert.deepEqual(pageWindows(["c1"], null), [{ after: null, through: null, limit: null }]);
});

test("a window is kept (its listener reused) only when nothing about it changed", () => {
  const w = { after: "a", through: null, limit: 50 };
  assert.ok(sameWindow(w, { ...w }));
  assert.ok(!sameWindow(w, { ...w, through: "b", limit: null }), "pinning a page re-listens it");
  assert.ok(!sameWindow(undefined, w));
});

test("pages merge in order, each record once (a record between two pages for an instant)", () => {
  const rows = mergePages([
    [{ id: "a", _path: "x/a" }, { id: "b", _path: "x/b" }],
    undefined,
    [{ id: "b", _path: "x/b" }, { id: "c", _path: "x/c" }],
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c"]);
  // Same id in two collections is two records.
  assert.equal(mergePages([[{ id: "a", _path: "x/a" }], [{ id: "a", _path: "y/a" }]]).length, 2);
});

test("a full last page means more may follow; a short one or a complete list does not", () => {
  assert.equal(hasMorePages(50, 50), true);
  assert.equal(hasMorePages(49, 50), false);
  assert.equal(hasMorePages(undefined, 50), false);
  assert.equal(hasMorePages(5000, null), false);
});

test("a query's identity is its value, so an inline spec does not re-listen every render", () => {
  const spec = { source: { path: ["cars"] }, filters: [["businessId", "==", "b"]] as const, orderBy: { field: "createdAt", direction: "desc" as const }, pageSize: 50 };
  assert.equal(querySpecKey(spec), querySpecKey({ ...spec, filters: [["businessId", "==", "b"]] }));
  assert.notEqual(querySpecKey(spec), querySpecKey({ ...spec, pageSize: 25 }));
  assert.notEqual(querySpecKey(spec), querySpecKey({ ...spec, orderBy: { field: "createdAt", direction: "asc" } }));
});

test("in-batches never exceed Firestore's 30 values", () => {
  const values = Array.from({ length: 65 }, (_, i) => `v${i}`);
  const batches = inBatches(values);
  assert.deepEqual(batches.map((b) => b.length), [30, 30, 5]);
  assert.deepEqual(batches.flat(), values);
  assert.deepEqual(inBatches([]), []);
});

// ---------------------------------------------------------------------------
// The helpers the panels use around a paged list.
// ---------------------------------------------------------------------------

test("the record a notification points at stays on the list", () => {
  const rows = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(withFocusedRow(rows, { id: "z" }).map((r) => r.id), ["z", "a", "b"]);
  assert.deepEqual(withFocusedRow(rows, { id: "b" }).map((r) => r.id), ["a", "b"], "already loaded: not twice");
  assert.deepEqual(withFocusedRow(rows, null), rows);
});

test("a count of loaded rows says when more exist", () => {
  assert.equal(loadedCountLabel(50, true), "50+");
  assert.equal(loadedCountLabel(12, false), "12");
});

test("a status picker filters in the query, and \"all\" filters nothing", () => {
  assert.deepEqual(statusFilterSpec("status", "all"), []);
  assert.deepEqual(statusFilterSpec("status", ""), []);
  assert.deepEqual(statusFilterSpec("status", "in_transit"), [["status", "==", "in_transit"]]);
  assert.deepEqual(statusFilterSpec("purchaseStatus", " reserved "), [["purchaseStatus", "==", "reserved"]]);
});

test("useBusinessCollection's plan: scoped by business, ordered whenever it is paged", () => {
  assert.deepEqual(businessCollectionPlan(" biz ", {}), {
    filters: [["businessId", "==", "biz"]],
    orderBy: { field: "createdAt", direction: "desc" },
    pageSize: DEFAULT_PAGE_SIZE,
  });
  assert.deepEqual(businessCollectionPlan("biz", { pageSize: null, where: [["status", "in", ["a", "b"]]] }), {
    filters: [["businessId", "==", "biz"], ["status", "in", ["a", "b"]]],
    orderBy: null,
    pageSize: null,
  });
  // A complete list may still be ordered when asked.
  assert.deepEqual(businessCollectionPlan("biz", { pageSize: null, orderBy: "activityDate", direction: "desc" }).orderBy, {
    field: "activityDate",
    direction: "desc",
  });
});

// ---------------------------------------------------------------------------
// The persistent cache, and its fallback.
// ---------------------------------------------------------------------------

test("the Firestore cache is on disk where IndexedDB works, in memory otherwise", () => {
  assert.equal(firestoreCacheChoice({ indexedDB: { open: () => null } }), "persistent");
  assert.equal(firestoreCacheChoice({}), "memory");
  assert.equal(firestoreCacheChoice(null), "memory");
  assert.equal(firestoreCacheChoice({ indexedDB: {} }), "memory", "no open(): not usable");
  const locked = Object.defineProperty({}, "indexedDB", {
    get() {
      throw new Error("SecurityError");
    },
  });
  assert.equal(firestoreCacheChoice(locked), "memory", "a throwing getter (locked-down profile)");
});

test("firebase.ts opens the shared persistent cache and falls back cleanly", () => {
  const source = readFileSync("src/lib/firebase.ts", "utf8");
  assert.match(source, /persistentLocalCache\(\{ tabManager: persistentMultipleTabManager\(\) \}\)/);
  assert.match(source, /: memoryLocalCache\(\)/);
  assert.match(source, /const choice = firestoreCacheChoice\(globalThis\);/);
  // Server render, or an instance a hot reload already made: use what exists.
  assert.match(source, /if \(typeof window === "undefined"\) return getFirestore\(app\);/);
  assert.match(source, /\} catch \{[\s\S]{0,200}return getFirestore\(app\);/);
  assert.match(source, /export const db = createFirestore\(\);/);
});

test("every paged list resolves its loading state, even when Firestore never answers", () => {
  const hook = readFileSync("src/lib/use-paged-query.ts", "utf8");
  assert.match(hook, /export const PAGED_QUERY_TIMEOUT_MS = 20000;/);
  assert.match(hook, /const timer = window\.setTimeout\(\(\) => \{\s*setStatus\(\(prev\) => \(prev\.key === key && \(prev\.loading \|\| prev\.loadingMore\)\s*\? \{ key, loading: false, loadingMore: false, error: PAGED_QUERY_TIMEOUT_MESSAGE \}/);
  // An error answer clears both spinners too.
  assert.match(hook, /\(snapshotError\) => \{[\s\S]{0,200}loading: false, loadingMore: false, error: snapshotError\.message/);
  const totals = readFileSync("src/lib/use-server-totals.ts", "utf8");
  assert.match(totals, /SERVER_TOTALS_TIMEOUT_MS/);
  assert.match(totals, /\.catch\(\(\) => \{[\s\S]{0,200}loading: false, error: SERVER_TOTALS_FAILED/);
});
