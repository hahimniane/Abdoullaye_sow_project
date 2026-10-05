// The admin console's reads must be whole or ordered - never a random subset.
//
// `query(collection(db, name), limit(max))` with no order is answered with the
// first N documents by id. Past N, new records silently went missing and the
// Today counts and the Finance commission summary were computed from that
// random subset. These checks pin the replacement: every capped list is
// ordered (and pages with "Load more"), Today's counts and the platform's
// earnings come from server callables that read every record, and a list is
// never ordered by a field some of its writers leave out (an ordered query
// drops those documents).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const source = readFileSync(
  new URL("../components/admin-console.tsx", import.meta.url),
  "utf8",
);

/** The source without comments, so prose about `limit(` is not code. */
const code = source
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
  .join("\n");

function functionBody(name: string) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  return source.slice(start, source.indexOf("\nfunction ", start + 10));
}

function useAdminCollectionCall(collectionName: string, from = 0) {
  const start = source.indexOf(`useAdminCollection(\n    "${collectionName}",`, from);
  assert.ok(start >= 0, `${collectionName} must be read through useAdminCollection`);
  return source.slice(start, source.indexOf(");", start) + 2);
}

describe("admin console queries", () => {
  test("useAdminCollection reads through the shared paged query, always ordered when capped", () => {
    const body = functionBody("useAdminCollection");
    assert.match(body, /usePagedQuery\(\{/);
    assert.match(body, /orderBy:\s*order/);
    assert.match(body, /field:\s*options\.orderBy \?\? "createdAt"/);
    assert.match(body, /direction:\s*options\.direction \?\? "desc"/);
    assert.match(body, /pageSize != null \|\| options\.orderBy/);
    assert.doesNotMatch(body, /onSnapshot\(|limit\(/, "no forked listener code");
  });

  test("no capped Firestore query without an order is left in the console", () => {
    assert.doesNotMatch(code, /\blimit\(/, "every cap goes through usePagedQuery, which requires an orderBy");
    assert.doesNotMatch(code, /collectionGroup\(/, "collection-group reads go through usePagedQuery too");
  });

  test("Today counts come from getAdminOverview, not from capped rows", () => {
    assert.match(
      source,
      /useServerTotals<AdminOverviewResponse>\(\s*"getAdminOverview",\s*onToday \? \{\} : null,?\s*\)/,
    );
    assert.match(source, /adminTodayMetrics\(/);
    const today = functionBody("Today");
    assert.match(today, /props\.metrics/);
    assert.match(today, /<TotalsStatus/);
    assert.doesNotMatch(today, /countBy\(|countWhere\(/, "Today must not count loaded rows");
    assert.doesNotMatch(today, /props\.(users|cars|transportRequests|parkedCars)\b/);
  });

  test("Today reads no whole collection, only a few newest open records", () => {
    assert.doesNotMatch(
      source,
      /tabNeeds\([^)]*"today"/,
      "the big collections must not load just because Today is open",
    );
    for (const name of ["businesses", "businessApplications", "carPurchases", "barrelShipments", "freightShipments"]) {
      const start = source.indexOf("const onToday = ");
      const call = useAdminCollectionCall(name, start);
      assert.match(call, /onToday,\s*recentPending\(/, `${name} recent list must be enabled only on Today`);
    }
    assert.match(source, /pageSize: TODAY_RECENT_LIMIT,/);
    assert.match(source, /where: \[\[field, "==", "pending"\]\]/);
  });

  test("Finance commission comes from getPlatformEarnings with the focus", () => {
    const finance = functionBody("FinanceView");
    assert.match(
      finance,
      /useServerTotals<PlatformEarningsResponse>\(\s*"getPlatformEarnings",\s*previewMode \? null : platformEarningsPayload\(commissionFocus\),?\s*\)/,
    );
    assert.doesNotMatch(
      finance,
      /summarizePlatformEarnings\(/,
      "the page must not sum the commission from paged rows",
    );
    assert.match(finance, /<TotalsStatus/);
  });

  test("flagged reviews keep the filter the rules require, ordered and paged", () => {
    const body = functionBody("useFlaggedReviews");
    assert.match(body, /group: "reviews"/);
    assert.match(source, /\["moderationStatus", "==", "flagged"\]/);
    assert.match(body, /filters: FLAGGED_REVIEW_FILTERS/);
    assert.match(body, /orderBy: \{ field: "createdAt", direction: "desc" \}/);
    assert.match(functionBody("FlaggedReviewsPanel"), /<LoadMoreButton/);
  });

  test("destination coverage reads every country document", () => {
    const body = functionBody("useAdminDestinationCoverage");
    assert.match(body, /group: "destinationCountries"/);
    assert.match(body, /pageSize: null/);
  });

  test("lists are never ordered by a field some of their writers leave out", () => {
    // users (guest profiles) and parkedCars (the app's receipt-only entry)
    // can lack createdAt; applications stamp submittedAt; provider-synced
    // deliveries stamp only updatedAt.
    assert.match(useAdminCollectionCall("users"), /orderBy: DOCUMENT_ID/);
    assert.match(useAdminCollectionCall("parkedCars"), /orderBy: DOCUMENT_ID/);
    assert.match(source, /const DOCUMENT_ID = "__name__";/);
    assert.match(useAdminCollectionCall("businessApplications", source.indexOf("const userProfiles")), /orderBy: "submittedAt"/);
    assert.match(source, /recentPending\("status", "submittedAt"\)/);
    assert.match(useAdminCollectionCall("notificationDeliveries"), /orderBy: "updatedAt"/);
    // Bounded by nature: read whole.
    assert.match(useAdminCollectionCall("shipmentPricing"), /pageSize: null/);
    assert.match(useAdminCollectionCall("featuredBusinesses"), /pageSize: null/);
  });

  test("a partly loaded list offers Load more", () => {
    assert.match(source, /olderRecordLists\.length > 0 &&/);
    assert.match(source, /<LoadMoreButton\s+hasMore\s+loading=\{loadingOlderRecords\}\s+onLoadMore=\{loadOlderRecords\}/);
  });
});
