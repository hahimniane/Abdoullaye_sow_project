import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A Firestore `limit(N)` without an `orderBy` in the same query returns the
// first N documents by document id - a random subset. Past N, new records
// silently went missing from these surfaces. Every capped query here must
// say which N it wants. `limit(1)` existence probes are the one exception.

const OWNED_FILES = [
  "src/components/support/support-cases-panel.tsx",
  "src/lib/public-cars.ts",
  "src/components/customer-shipping-services.tsx",
  "src/components/notification-bell.tsx",
  "src/components/recipient-name-field.tsx",
  "src/components/pay-return.tsx",
  "src/components/customer-support.tsx",
];

/** Source with // and /* *\/ comments blanked, so prose cannot match. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/(^|[\s;,(){}])\/\/[^\n]*/g, (_match, lead: string) => lead);
}

/** The full text of every `query(...)` call, parentheses balanced. */
export function queryCalls(source: string): string[] {
  const calls: string[] = [];
  const pattern = /\bquery\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(match.index, end + 1));
  }
  return calls;
}

export function cappedWithoutOrder(call: string): boolean {
  const limits = [...call.matchAll(/\blimit\(\s*([^)]*)\)/g)].map((m) => m[1].trim());
  if (limits.length === 0) return false;
  if (limits.every((value) => value === "1")) return false;
  return !/\borderBy\(/.test(call);
}

test("the scanner flags an unordered cap and nothing else", () => {
  assert.equal(cappedWithoutOrder('query(c, where("a", "==", 1), limit(5))'), true);
  assert.equal(cappedWithoutOrder('query(c, orderBy("t", "desc"), limit(5))'), false);
  assert.equal(cappedWithoutOrder('query(c, where("a", "==", 1), limit(1))'), false);
  assert.equal(cappedWithoutOrder('query(c, orderBy("t", "asc"), limitToLast(200))'), false);
  assert.equal(cappedWithoutOrder('query(c, where("a", "==", 1))'), false);
  const nested = queryCalls('x = query(collection(db, "a"), where("b", "==", f(1)), limit(9)); y = 1;');
  assert.deepEqual(nested, ['query(collection(db, "a"), where("b", "==", f(1)), limit(9))']);
  assert.equal(
    stripComments('query(c, // limit(5) was here\n  where("a", "==", 1))').includes("limit("),
    false,
  );
  assert.equal(stripComments('const u = "https://x";').includes("https://x"), true);
});

for (const file of OWNED_FILES) {
  test(`${file}: every capped query carries an orderBy`, () => {
    const source = stripComments(readFileSync(file, "utf8"));
    const offenders = queryCalls(source).filter(cappedWithoutOrder);
    assert.deepEqual(offenders, [], `${file} caps a query with no orderBy`);
  });
}

test("the support inbox is ordered by updatedAt and paged with Load more", () => {
  const panel = stripComments(readFileSync("src/components/support/support-cases-panel.tsx", "utf8"));
  const spec = readFileSync("src/lib/support-cases-query.ts", "utf8");
  assert.doesNotMatch(panel, /limit\(300\)/);
  assert.match(panel, /usePagedQuery\(\{[\s\S]*?orderBy: spec\.orderBy,[\s\S]*?pageSize: SUPPORT_CASES_PAGE_SIZE/);
  assert.match(panel, /<LoadMoreButton hasMore=\{hasMore\} loading=\{loadingMore\} onLoadMore=\{loadMore\} \/>/);
  assert.match(spec, /orderBy: \{ field: "updatedAt", direction: "desc" \}/);
});

test("public car listings are the newest active ones, paged", () => {
  const source = stripComments(readFileSync("src/lib/public-cars.ts", "utf8"));
  assert.doesNotMatch(source, /\blimit\(/);
  assert.match(source, /filters: \[\["status", "==", "active"\]\]/);
  assert.match(source, /orderBy: \{ field: "createdAt", direction: "desc" \}/);
  assert.match(source, /pageSize: PUBLIC_CARS_PAGE_SIZE/);
  const cars = readFileSync("src/components/customer-cars.tsx", "utf8");
  assert.match(cars, /<LoadMoreButton[\s\S]*?onLoadMore=\{state\.loadMore\}/);
});

test("a catalog bump waits for the jitter before re-fetching", () => {
  const source = stripComments(readFileSync("src/components/customer-shipping-services.tsx", "utf8"));
  // One listener: two of them re-fetched twice per bump.
  assert.equal(source.match(/doc\(db, "publicCatalog", "services"\)/g)?.length, 1);
  const effect = source.slice(
    source.indexOf("createCatalogBumpScheduler({"),
    source.indexOf("scheduler.dispose();") + "scheduler.dispose();".length,
  );
  assert.match(effect, /refetch: \(\) => setOptionsReloadKey\(\(current\) => current \+ 1\)/);
  assert.match(effect, /delayMs: \(\) => catalogRefetchDelayMs\(\)/);
  // The snapshot only signals the scheduler; it never re-fetches directly.
  assert.match(effect, /doc\(db, "publicCatalog", "services"\),\s*\(\) => scheduler\.onSignal\(\),/);
  assert.match(effect, /unsubscribe\(\);\s*scheduler\.dispose\(\);/);
});

test("the payment return reads every attempt instead of an unordered five", () => {
  const source = stripComments(readFileSync("src/components/pay-return.tsx", "utf8"));
  assert.doesNotMatch(source, /\blimit\(/);
  assert.match(source, /"paymentAttempts",\s*\),\s*where\("customerUid", "==", user\.uid\),\s*\)/);
});

test("the customer support list is the newest 100 by activity", () => {
  const source = stripComments(readFileSync("src/components/customer-support.tsx", "utf8"));
  assert.match(
    source,
    /where\("customerUid", "==", uid\),\s*orderBy\("updatedAt", "desc"\),\s*limit\(100\),/,
  );
});
