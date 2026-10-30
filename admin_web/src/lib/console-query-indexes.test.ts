// Every console list is ordered before it is capped, and every query shape
// the consoles ask for has its composite index in
// my_flutter_app/firestore.indexes.json.
//
// Why both: `where(businessId) + limit(N)` with no order is answered with
// the first N documents by id - a random subset - so new records went
// missing past N and totals counted from the rows were wrong. And a query
// whose index is missing fails in production (the emulator does not enforce
// composite indexes), which reads as a list that never loads.
//
// The second half is a manifest: every query call site, per file and per
// kind, with the shapes it can produce. Adding a call site without adding it
// here fails the site count, so a new shape cannot skip the index check.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { invoiceListQuery } from "./invoice-ledger.ts";
import { transferReadOptions } from "./inventory-transfers.ts";
import { lotActivityListQuery, lotExpenseEntryQueries } from "./lot-ledger.ts";
import { businessCollectionPlan, statusFilterSpec, type BusinessCollectionOptions, type QueryFilterSpec } from "./paged-query.ts";
import { parkingMonthQueryPlan } from "./parking-month-statement.ts";
import { describeRequiredIndex, requiredIndex, shapeIsIndexed, type IndexDefinition, type QueryShape } from "./query-index.ts";
import { PENDING_HANDOVERS_WHERE } from "./staff-balances.ts";
import { supportCasesQuerySpec } from "./support-cases-query.ts";

const indexes = (JSON.parse(readFileSync("../my_flutter_app/firestore.indexes.json", "utf8")) as {
  indexes: IndexDefinition[];
}).indexes;

// ---------------------------------------------------------------------------
// Source helpers.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

/**
 * Comments out, so prose about `limit()` never counts as a call. String
 * literals are skipped whole (an `accept="image/*"` is not a comment).
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
      continue;
    }
    if (ch === "/" && next === "/" && source[i - 1] !== ":") {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end;
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) {
        if (source[j] === "\\") j += 1;
        // A line break ends a broken ' or " literal (JSX text apostrophes).
        if (ch !== "`" && source[j] === "\n") break;
        j += 1;
      }
      out += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** The argument text of every `query(` call (balanced parentheses). */
function queryCalls(source: string): string[] {
  const calls: string[] = [];
  const re = /(^|[^A-Za-z0-9_.$])query\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    for (; i < source.length && depth > 0; i += 1) {
      if (source[i] === "(") depth += 1;
      else if (source[i] === ")") depth -= 1;
    }
    calls.push(source.slice(start, i - 1));
  }
  return calls;
}

const files = sourceFiles("src");
const sources = new Map(files.map((file) => [file, stripComments(readFileSync(file, "utf8"))]));

// ---------------------------------------------------------------------------
// 1. A cap is always ordered.
// ---------------------------------------------------------------------------

test("no query in admin_web caps its results without an order", () => {
  const offenders: string[] = [];
  for (const [file, source] of sources) {
    for (const call of queryCalls(source)) {
      if (!/\blimit\(/.test(call)) continue;
      // A one-document existence probe needs no order: any match answers it.
      if (/\blimit\(1\)/.test(call)) continue;
      if (/\borderBy\(/.test(call)) continue;
      offenders.push(`${file}: query(${call.replace(/\s+/g, " ").slice(0, 160)})`);
    }
  }
  assert.deepEqual(offenders, [], "limit() without orderBy() returns a random subset");
});

test("the paged hooks refuse a cap without an order", () => {
  const hook = sources.get(join("src", "lib", "use-paged-query.ts")) ?? "";
  assert.match(hook, /if \(pageSize != null && !order\) \{\s*throw new Error\("usePagedQuery: a capped query needs an orderBy\."\);/);
  // useBusinessCollection orders every paged list (newest createdAt first by
  // default) through the one plan the index checks below also use.
  assert.deepEqual(businessCollectionPlan("biz", {}).orderBy, { field: "createdAt", direction: "desc" });
  assert.equal(businessCollectionPlan("biz", { pageSize: null }).orderBy, null);
  assert.deepEqual(businessCollectionPlan("biz", { pageSize: 10, orderBy: "at", direction: "asc" }).orderBy, { field: "at", direction: "asc" });
});

// ---------------------------------------------------------------------------
// 2. Every query shape has its index.
// ---------------------------------------------------------------------------

/** What useBusinessCollection(name, "biz", ..., options) asks Firestore. */
function bc(collection: string, options: BusinessCollectionOptions = {}): QueryShape {
  const plan = businessCollectionPlan("biz", options);
  return { collection, filters: plan.filters, orderBy: plan.orderBy };
}

/** What admin-console's useAdminCollection(name, ..., options) asks. */
function ac(collection: string, options: { pageSize: number | null; orderBy?: string; direction?: "asc" | "desc"; where?: QueryFilterSpec[] }): QueryShape {
  const order = options.pageSize != null || options.orderBy
    ? { field: options.orderBy ?? "createdAt", direction: options.direction ?? "desc" }
    : null;
  return { collection, filters: options.where ?? [], orderBy: order };
}

const raw = (collection: string, filters: QueryFilterSpec[] = [], orderBy: QueryShape["orderBy"] = null, group = false): QueryShape =>
  ({ collection, filters, orderBy, group });

const eq = (field: string): QueryFilterSpec => [field, "==", "x"];
/** A status picker: no filter ("all") or one status. */
const withStatus = (field: string, make: (where: QueryFilterSpec[]) => QueryShape): QueryShape[] =>
  [make(statusFilterSpec(field, "all")), make(statusFilterSpec(field, "pending"))];

const monthPlan = parkingMonthQueryPlan("2026-09")!;
const expensePlan = lotExpenseEntryQueries(2026);

type Kind = "useBusinessCollection" | "useAdminCollection" | "usePagedQuery" | "query" | "useDocsWhereIn";
type Site = { file: string; kind: Kind; what: string; shapes: QueryShape[] };

const B = (file: string) => join("src", "components", "business", file);
const C = (file: string) => join("src", "components", file);
const L = (file: string) => join("src", "lib", file);

const SITES: Site[] = [
  // --- lib/business-data.ts -------------------------------------------------
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useActiveParkedCars", shapes: [bc("parkedCars", { pageSize: null, where: [["occupancyEndMs", ">=", 0]] })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useParkedCarHistory", shapes: [bc("parkedCars", { orderBy: "occupancyEndMs", direction: "desc", where: [["occupancyEndMs", "<", 0]] })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useOpenContainerPlacements containers", shapes: [bc("containers", { pageSize: null, where: [["status", "in", ["loading", "shipped"]]] })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "month cars", shapes: [bc("parkedCars", { pageSize: null, where: monthPlan.cars.where })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "month cars unpaid", shapes: [bc("parkedCars", { pageSize: null, where: monthPlan.unpaidCars.where })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "month activities in month", shapes: [bc("lotActivities", { pageSize: null, where: monthPlan.inMonth.where, orderBy: "activityDate", direction: "desc" })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "month activities unsettled", shapes: [bc("lotActivities", { pageSize: null, where: monthPlan.unsettled.where })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "month activities undated", shapes: [bc("lotActivities", { pageSize: null, where: monthPlan.undated.where })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useParkingBillPayments: the month's bill payments", shapes: [bc("parkingBillPayments", { pageSize: null, where: [["monthKey", "==", "2026-09"]] })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useStaffExpenseCreditInputs: every lot expense", shapes: [bc("lotExpenseEntries", { pageSize: null })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useStaffExpenseCreditInputs: every paid-back record", shapes: [bc("staffExpenseRepayments", { pageSize: null })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useStaffExpenseCreditInputs: expense lines (names on the bill)", shapes: [bc("lotExpenseLines", { pageSize: null })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useParkingLinkCars (last twelve months)", shapes: [bc("parkedCars", { pageSize: null, where: [["occupancyEndMs", ">=", 0]] })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useBusinessStaff", shapes: [bc("users", { pageSize: null })] },
  { file: L("business-data.ts"), kind: "usePagedQuery", what: "useBusinessCollection itself", shapes: [] },
  { file: L("business-data.ts"), kind: "usePagedQuery", what: "business subcollections (destinations whole, reviews newest first)", shapes: [raw("destinationCountries"), raw("officeLocations"), raw("reviews", [], { field: "createdAt", direction: "desc" })] },
  { file: L("business-data.ts"), kind: "query", what: "useBusinessHasRecords probe (limit 1)", shapes: [raw("cars", [eq("businessId")])] },
  { file: L("business-data.ts"), kind: "query", what: "useBusinessCountsByValue", shapes: [raw("lotActivities", [eq("businessId"), eq("activityTypeId")])] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useWaitingPackages", shapes: [bc("containerLines", { pageSize: null, where: [["containerStatus", "==", "waiting"]] })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "usePackageRequests", shapes: [bc("packageRequests", { pageSize: null, orderBy: "createdAt", direction: "desc", where: [["status", "in", ["new", "estimate_sent", "confirmed"]]] })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useInventoryItems on sale and archived", shapes: [true, false].map((archived) => bc("inventoryItems", { pageSize: null, where: [["archived", "==", archived]] })) },
  // Sales: every store at once (owner, all-stores staff), or one store only (staff who work in one store: the rules' shape).
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useInventorySales newest first, all stores or one store", shapes: [bc("inventorySales", {}), bc("inventorySales", { where: [eq("storeId")] })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useInventoryCategories", shapes: [bc("inventoryCategories", { pageSize: null })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useInventoryBrands", shapes: [bc("inventoryBrands", { pageSize: null })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useInventoryStores", shapes: [bc("inventoryStores", { pageSize: null })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useInventoryStock, all stores or one store", shapes: [bc("inventoryStock", { pageSize: null }), bc("inventoryStock", { pageSize: null, where: [eq("storeId")] })] },
  { file: L("business-data.ts"), kind: "useBusinessCollection", what: "useInventoryMovements of one product", shapes: [bc("inventoryMovements", { where: [eq("itemId")] })] },
  // Credit sales (v4) and the sales history: every shape also store-scoped for staff of one store.
  {
    file: L("business-data.ts"), kind: "useBusinessCollection", what: "useInventoryOpenCredit, all stores or one store",
    shapes: [bc("inventorySales", { pageSize: null, where: [["creditStatus", "==", "open"]] }),
      bc("inventorySales", { pageSize: null, where: [eq("storeId"), ["creditStatus", "==", "open"]] })],
  },
  {
    file: L("business-data.ts"), kind: "useBusinessCollection", what: "useInventoryCreditPayments of one sale",
    shapes: [bc("inventoryCreditPayments", { pageSize: null, where: [eq("saleId")] }),
      bc("inventoryCreditPayments", { pageSize: null, where: [eq("storeId"), eq("saleId")] })],
  },
  {
    file: L("business-data.ts"), kind: "useBusinessCollection", what: "useInventoryPeriodRows (sales, movements, credit payments in a period)",
    shapes: (["inventorySales", "inventoryMovements", "inventoryCreditPayments"] as const).flatMap((name) => [false, true].map((scoped) =>
      bc(name, {
        pageSize: 1000,
        where: [...(scoped ? [eq("storeId")] : []), ["createdAt", ">=", 1], ["createdAt", "<", 2]],
        orderBy: "createdAt",
        direction: "desc",
      }))),
  },
  // Store transfers (v5): open / recent / received this month, unscoped for whoever sees every store,
  // and for a store's staff once by fromStoreId and once by toStoreId (two call sites, merged).
  {
    file: L("business-data.ts"), kind: "useBusinessCollection", what: "useInventoryTransfers, unscoped or from one store",
    shapes: (["open", "recent", "month"] as const).flatMap((read) =>
      [transferReadOptions(read, "", "", 1), transferReadOptions(read, "from", "s1", 1)].map((options) => bc("inventoryTransfers", options))),
  },
  {
    file: L("business-data.ts"), kind: "useBusinessCollection", what: "useInventoryTransfers, to one store",
    shapes: (["open", "recent", "month"] as const).map((read) => bc("inventoryTransfers", transferReadOptions(read, "to", "s1", 1))),
  },
  { file: L("business-data.ts"), kind: "useDocsWhereIn", what: "open container lines", shapes: [raw("containerLines", [eq("businessId"), ["containerId", "in", ["a"]]])] },
  // --- lib/use-paged-query.ts: the generic hooks themselves -----------------
  { file: L("use-paged-query.ts"), kind: "query", what: "usePagedQuery window (generic)", shapes: [] },
  { file: L("use-paged-query.ts"), kind: "query", what: "useDocsWhereIn batch (generic)", shapes: [] },
  // --- lib/vin-records.ts ---------------------------------------------------
  { file: L("vin-records.ts"), kind: "query", what: "VIN lookup (limit 1)", shapes: [raw("parkedCars", [eq("businessId"), eq("vinNumber")]), raw("lotActivities", [eq("businessId"), eq("vinNumber")])] },
  // --- lib/public-cars.ts ---------------------------------------------------
  { file: L("public-cars.ts"), kind: "usePagedQuery", what: "active cars newest first", shapes: [raw("cars", [["status", "==", "active"]], { field: "createdAt", direction: "desc" })] },
  // --- business-console.tsx -------------------------------------------------
  // Today's queues are counted on the server (getBusinessOverview); the tab
  // keeps only its unacknowledged ledger changes live.
  { file: C("business-console.tsx"), kind: "useBusinessCollection", what: "Growth insights", shapes: [bc("businessInsights", { pageSize: 3 })] },
  { file: C("business-console.tsx"), kind: "useBusinessCollection", what: "Today ledger changes", shapes: [bc("lotLedgerAudit", { pageSize: 6, orderBy: "at", where: [["acknowledged", "==", false]] })] },
  // Staff balances (docs/STAFF_BALANCES.md): the sidebar badge / Today row ask for this business's pending hand-overs
  // (two equalities, no composite index); the page itself reads every hand-over of the business (one equality).
  { file: C("business-console.tsx"), kind: "useBusinessCollection", what: "pending staff hand-overs (badge and Today row)", shapes: [bc("staffHandovers", { pageSize: null, where: PENDING_HANDOVERS_WHERE })] },
  { file: B("staff-balances-panel.tsx"), kind: "useBusinessCollection", what: "every staff hand-over of the business", shapes: [bc("staffHandovers", { pageSize: null })] },
  // --- invoices-panel.tsx ---------------------------------------------------
  { file: B("invoices-panel.tsx"), kind: "useBusinessCollection", what: "lotCustomers", shapes: [bc("lotCustomers", { pageSize: 300, orderBy: "lastSeenAt" })] },
  { file: B("invoices-panel.tsx"), kind: "useBusinessCollection", what: "invoices by filter", shapes: (["", "open", "paid", "overdue"] as const).map((filter) => bc("invoices", invoiceListQuery(filter, "2026-10-05"))) },
  { file: B("invoices-panel.tsx"), kind: "useBusinessCollection", what: "invoiceLines of one invoice", shapes: [bc("invoiceLines", { pageSize: null, where: [eq("invoiceId")] })] },
  { file: B("invoices-panel.tsx"), kind: "useBusinessCollection", what: "invoicePayments of one invoice", shapes: [bc("invoicePayments", { pageSize: null, where: [eq("invoiceId")] })] },
  { file: B("invoices-panel.tsx"), kind: "query", what: "invoice history", shapes: [raw("lotLedgerAudit", [eq("businessId"), eq("entityId")], { field: "at", direction: "desc" })] },
  // --- containers-panel.tsx -------------------------------------------------
  { file: B("containers-panel.tsx"), kind: "useBusinessCollection", what: "open containers", shapes: [bc("containers", { pageSize: null, where: [["status", "in", ["loading", "shipped"]]] })] },
  { file: B("containers-panel.tsx"), kind: "useBusinessCollection", what: "arrived containers", shapes: [bc("containers", { pageSize: 25, orderBy: "arrivedAt", where: [["status", "==", "arrived"]] })] },
  { file: B("containers-panel.tsx"), kind: "useBusinessCollection", what: "lotCustomers", shapes: [bc("lotCustomers", { pageSize: 300, orderBy: "lastSeenAt" })] },
  { file: B("containers-panel.tsx"), kind: "useDocsWhereIn", what: "lines of the containers on screen", shapes: [raw("containerLines", [eq("businessId"), ["containerId", "in", ["a"]]])] },
  { file: B("containers-panel.tsx"), kind: "query", what: "container history", shapes: [raw("lotLedgerAudit", [eq("businessId"), eq("entityId")], { field: "at", direction: "desc" })] },
  // --- package-payment-dialog.tsx -------------------------------------------
  { file: B("package-payment-dialog.tsx"), kind: "useBusinessCollection", what: "containerLinePayments of one package", shapes: [bc("containerLinePayments", { pageSize: null, where: [eq("lineId")] })] },
  // --- operations-panels.tsx ------------------------------------------------
  { file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "listings (every car)", shapes: [bc("cars", { pageSize: null })] },
  { file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "barrel shipments", shapes: withStatus("status", (where) => bc("barrelShipments", { where })) },
  { file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "barrel pools", shapes: withStatus("status", (where) => bc("barrelPools", { orderBy: "updatedAt", where })) },
  { file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "pending balance requests", shapes: [bc("barrelPoolBalanceRequests", { pageSize: null, where: [["status", "==", "pending"]] })] },
  { file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "freight shipments", shapes: withStatus("status", (where) => bc("freightShipments", { where })) },
  { file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "open transport opportunities", shapes: [bc("transportOpportunities", { pageSize: null, where: [["status", "in", ["open", "quoted", "withdrawn"]]] })] },
  { file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "transport jobs", shapes: withStatus("status", (where) => bc("transportRequests", { where })) },
  { file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "parking lotCustomers", shapes: [bc("lotCustomers", { pageSize: 300, orderBy: "lastSeenAt" })] },
  { file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "purchases", shapes: withStatus("purchaseStatus", (where) => bc("carPurchases", { where })) },
  { file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "activity types", shapes: [bc("lotActivityTypes", { pageSize: null })] },
  { file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "expense lines", shapes: [bc("lotExpenseLines", { pageSize: null })] },
  { file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "ledger lotCustomers", shapes: [bc("lotCustomers", { pageSize: 300, orderBy: "lastSeenAt" })] },
  {
    file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "ledger activity list",
    shapes: ["all", "custom", "type1"].flatMap((typeFilter) => (["all", "owed", "paid"] as const).map((payFilter) =>
      bc("lotActivities", lotActivityListQuery({ rangeStart: "2026-08", rangeEnd: "2026-10", typeFilter, payFilter })))),
  },
  { file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "expense entries in the year", shapes: [bc("lotExpenseEntries", { pageSize: null, where: expensePlan.inYear })] },
  { file: B("operations-panels.tsx"), kind: "useBusinessCollection", what: "undated expense entries", shapes: [bc("lotExpenseEntries", { pageSize: null, where: expensePlan.undated })] },
  { file: B("operations-panels.tsx"), kind: "usePagedQuery", what: "open freight price requests", shapes: [raw("freightQuoteRequests", [["eligibleBusinessIds", "array-contains", "biz"], ["quoteStatus", "==", "collecting"]])] },
  { file: B("operations-panels.tsx"), kind: "useDocsWhereIn", what: "own freight quotes", shapes: [raw("freightQuotes", [eq("businessId"), ["requestId", "in", ["a"]]])] },
  { file: B("operations-panels.tsx"), kind: "useDocsWhereIn", what: "own transport quotes", shapes: [raw("transportQuotes", [eq("businessId"), ["requestId", "in", ["a"]]])] },
  { file: B("operations-panels.tsx"), kind: "useDocsWhereIn", what: "cars of the purchases on screen", shapes: [raw("cars", [eq("businessId"), ["__name__", "in", ["a"]]])] },
  { file: B("operations-panels.tsx"), kind: "query", what: "parking history", shapes: [raw("lotLedgerAudit", [eq("businessId"), eq("entityId")], { field: "at", direction: "desc" })] },
  { file: B("operations-panels.tsx"), kind: "query", what: "ledger history", shapes: [raw("lotLedgerAudit", [eq("businessId"), eq("entityId")], { field: "at", direction: "desc" })] },
  // A parked car's WhatsApp messages (docs/PARKING_WHATSAPP.md §3): equalities only, no composite index.
  { file: B("parking-whatsapp.tsx"), kind: "query", what: "a parked car's WhatsApp messages", shapes: [raw("parkingMessages", [eq("businessId"), eq("parkedCarId")])] },
  // A month's invoice messages (docs/PARKING_INVOICES.md §3): three equalities, no order, no composite index.
  { file: B("parking-invoices.tsx"), kind: "query", what: "a month's invoice WhatsApp messages", shapes: [raw("parkingMessages", [eq("businessId"), eq("kind"), eq("monthKey")])] },
  { file: B("tracking-updates-section.tsx"), kind: "query", what: "tracking events", shapes: [raw("trackingEvents", [], { field: "timestamp", direction: "desc" })] },
  // --- support --------------------------------------------------------------
  {
    file: join("src", "components", "support", "support-cases-panel.tsx"), kind: "usePagedQuery", what: "support inbox",
    shapes: (["business", "admin"] as const).flatMap((scope) =>
      (["cases", "whatsapp"] as const).map((view) => {
        const spec = supportCasesQuerySpec(scope, "biz", view);
        return raw("supportCases", spec.filters, spec.orderBy);
      }),
    ),
  },
  { file: join("src", "components", "support", "support-cases-panel.tsx"), kind: "query", what: "case messages", shapes: [raw("messages", [], { field: "createdAt", direction: "asc" })] },
  { file: join("src", "components", "support", "support-cases-panel.tsx"), kind: "query", what: "internal notes", shapes: [raw("internalNotes", [], { field: "createdAt", direction: "desc" })] },
  { file: join("src", "components", "support", "support-cases-panel.tsx"), kind: "query", what: "timeline", shapes: [raw("timeline", [], { field: "createdAt", direction: "desc" })] },
  { file: C("customer-support.tsx"), kind: "query", what: "my cases", shapes: [raw("supportCases", [eq("customerUid")], { field: "updatedAt", direction: "desc" })] },
  { file: C("customer-support.tsx"), kind: "query", what: "case messages", shapes: [raw("messages", [], { field: "createdAt", direction: "desc" })] },
  // --- customer surfaces ----------------------------------------------------
  { file: C("customer-review-composer.tsx"), kind: "query", what: "my reviews (group)", shapes: [raw("reviews", [eq("customerUid")], null, true)] },
  { file: C("notification-bell.tsx"), kind: "query", what: "my notifications", shapes: [raw("notifications", [], { field: "createdAt", direction: "desc" })] },
  { file: C("guest-tracking.tsx"), kind: "query", what: "claimed request", shapes: [raw("freightQuoteRequests", [eq("customerUid"), eq("trackingCode")])] },
  // A package's staff view on the tracking page: the business's own line by
  // code, or (platform admin) any line by code. Equalities only, limit 1.
  { file: C("package-staff-view.tsx"), kind: "query", what: "package line by code", shapes: [raw("containerLines", [eq("businessId"), eq("trackingCode")]), raw("containerLines", [eq("trackingCode")])] },
  // A split package's other parts, for the group's money (payments on the root). Equalities only.
  { file: C("package-staff-view.tsx"), kind: "query", what: "a split package's parts", shapes: [raw("containerLines", [eq("businessId"), eq("rootLineId")])] },
  // The Deliveries page's "Arrived · to hand over" list (docs/AIR_PACKAGES.md
  // §5): the business's arrived containers and the lines on them (lines carry
  // their container's status). Equalities only, no composite index.
  { file: B("deliveries-panel.tsx"), kind: "query", what: "arrived containers", shapes: [raw("containers", [eq("businessId"), eq("status")])] },
  { file: B("deliveries-panel.tsx"), kind: "query", what: "lines on arrived containers", shapes: [raw("containerLines", [eq("businessId"), eq("containerStatus")])] },
  { file: C("customer-parking-pools.tsx"), kind: "query", what: "open barrels", shapes: [raw("openBarrels", [eq("status")])] },
  { file: C("customer-console.tsx"), kind: "query", what: "my records", shapes: [] },
  { file: C("recipient-name-field.tsx"), kind: "query", what: "saved recipients", shapes: [raw("savedRecipients", [], { field: "lastUsedAt", direction: "desc" })] },
  { file: C("pay-return.tsx"), kind: "query", what: "settlement attempts", shapes: [raw("paymentAttempts", [eq("customerUid")])] },
  { file: C("customer-shipping-services.tsx"), kind: "query", what: "office locations", shapes: [raw("officeLocations", [eq("isActive")])] },
  { file: C("customer-shipping-services.tsx"), kind: "query", what: "my freight requests", shapes: [raw("freightQuoteRequests", [eq("customerUid")])] },
  { file: C("customer-shipping-services.tsx"), kind: "query", what: "quotes on a request", shapes: [raw("freightQuotes", [eq("requestId")])] },
  { file: C("customer-shipping-services.tsx"), kind: "query", what: "my transport requests", shapes: [raw("transportRequests", [eq("customerUid")])] },
  { file: C("customer-shipping-services.tsx"), kind: "query", what: "quotes on a transport request", shapes: [raw("transportQuotes", [eq("requestId")])] },
  // --- admin-console.tsx ----------------------------------------------------
  ...([
    ["businesses", "status", "createdAt"],
    ["businessApplications", "status", "submittedAt"],
    ["carPurchases", "purchaseStatus", "createdAt"],
    ["barrelShipments", "status", "createdAt"],
    ["freightShipments", "status", "createdAt"],
  ] as const).map(([name, field, order]): Site => ({
    file: C("admin-console.tsx"), kind: "useAdminCollection", what: `Today pending ${name}`,
    shapes: [ac(name, { pageSize: 10, orderBy: order, where: [[field, "==", "pending"]] })],
  })),
  ...([
    ["users", { pageSize: 1000, orderBy: "__name__", direction: "asc" }],
    ["businesses", { pageSize: 500 }],
    ["cars", { pageSize: 1000 }],
    ["barrelShipments", { pageSize: 1000 }],
    ["freightShipments", { pageSize: 1000 }],
    ["transportRequests", { pageSize: 1000 }],
    ["parkedCars", { pageSize: 1000, orderBy: "__name__", direction: "asc" }],
    ["carPurchases", { pageSize: 1000 }],
    ["barrelPoolBalanceRequests", { pageSize: 500 }],
    ["shipmentPricing", { pageSize: null }],
    ["businessApplications", { pageSize: 150, orderBy: "submittedAt" }],
    ["platformNotifications", { pageSize: 150 }],
    ["notificationDeliveries", { pageSize: 250, orderBy: "updatedAt" }],
    ["businessSupportRequests", { pageSize: 500 }],
    ["featuredBusinesses", { pageSize: null }],
  ] as const).map(([name, options]): Site => ({
    file: C("admin-console.tsx"), kind: "useAdminCollection", what: name, shapes: [ac(name, options)],
  })),
  { file: C("admin-console.tsx"), kind: "usePagedQuery", what: "useAdminCollection itself", shapes: [] },
  { file: C("admin-console.tsx"), kind: "usePagedQuery", what: "flagged reviews (group)", shapes: [raw("reviews", [["moderationStatus", "==", "flagged"]], { field: "createdAt", direction: "desc" }, true)] },
  { file: C("admin-console.tsx"), kind: "usePagedQuery", what: "destination coverage (group, whole)", shapes: [raw("destinationCountries", [], null, true)] },
];

const CALL_PATTERNS: Record<Kind, RegExp> = {
  useBusinessCollection: /(?<!function )\buseBusinessCollection\(/g,
  useAdminCollection: /(?<!function )\buseAdminCollection\(/g,
  usePagedQuery: /(?<!function )\busePagedQuery\(/g,
  query: /(^|[^A-Za-z0-9_.$])query\(/g,
  useDocsWhereIn: /(?<!function )\buseDocsWhereIn\(/g,
};

test("every query call site in admin_web is in the manifest", () => {
  const expected = new Map<string, number>();
  for (const site of SITES) {
    const key = `${site.file}|${site.kind}`;
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  const problems: string[] = [];
  for (const [file, source] of sources) {
    for (const kind of Object.keys(CALL_PATTERNS) as Kind[]) {
      const found = (source.match(CALL_PATTERNS[kind]) ?? []).length;
      const listed = expected.get(`${file}|${kind}`) ?? 0;
      if (found !== listed) problems.push(`${file}: ${found} ${kind}( call(s), manifest lists ${listed}`);
    }
  }
  assert.deepEqual(problems, [], "add the new query site (and its index) to SITES");
});

test("every console query shape has a matching index in firestore.indexes.json", () => {
  const missing: string[] = [];
  for (const site of SITES) {
    for (const shape of site.shapes) {
      if (!shapeIsIndexed(shape, indexes)) {
        missing.push(`${site.file} ${site.what}: needs ${describeRequiredIndex(shape)}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("the server totals' own queries are indexed too", () => {
  // console_totals.js (getLotLedgerTotals, getParkingTotals,
  // getInvoiceBoardTotals) - the shapes it asks, checked against its source.
  const server = readFileSync("../my_flutter_app/functions/console_totals.js", "utf8");
  assert.match(server, /\.where\("activityDate", ">=", Timestamp\.fromMillis\(startMs\)\)\s*\.where\("activityDate", "<", Timestamp\.fromMillis\(endMs\)\)\s*\.orderBy\("activityDate", "desc"\)/);
  assert.match(server, /\.where\("paidAtMonth", ">=", input\.rangeStart\)\s*\.where\("paidAtMonth", "<=", input\.rangeEnd\)\s*\.orderBy\("paidAtMonth"\)/);
  assert.match(server, /\.where\("month", ">=", input\.readFrom\)\s*\.where\("month", "<=", input\.readThrough\)\s*\.orderBy\("month"\)/);
  assert.match(server, /parked\.where\("occupancyEndMs", "<", boundaryMs\)/);
  for (const name of ["containerLinePayments", "inventorySales", "inventoryCreditPayments"]) {
    assert.match(server, new RegExp(`scoped\\("${name}"\\)\\s*\\.where\\("createdAt", ">=", from\\)\\.where\\("createdAt", "<", until\\)\\s*\\.orderBy\\("createdAt"`));
  }
  assert.match(server, /\.where\("paidOn", ">=", months\.firstDay\)\s*\.where\("paidOn", "<=", months\.lastDay\)\s*\.orderBy\("paidOn"\)/);
  assert.match(server, /\.where\("paidAtMonth", ">=", months\.previousMonth\)\s*\.where\("paidAtMonth", "<=", months\.month\)\s*\.orderBy\("paidAtMonth"\)/);
  const shapes: QueryShape[] = [
    raw("lotActivities", [eq("businessId"), ["activityDate", ">=", 0], ["activityDate", "<", 1]], { field: "activityDate", direction: "desc" }),
    raw("lotActivityPayments", [eq("businessId"), ["paidAtMonth", ">=", "a"], ["paidAtMonth", "<=", "b"]], { field: "paidAtMonth", direction: "asc" }),
    raw("lotExpenseEntries", [eq("businessId"), ["month", ">=", "a"], ["month", "<=", "b"]], { field: "month", direction: "asc" }),
    raw("parkedCars", [eq("businessId"), ["occupancyEndMs", "<", 0]]),
    raw("parkedCars", [eq("businessId"), ["occupancyEndMs", ">=", 0]]),
    raw("invoices", [eq("businessId"), eq("status"), ["dueOn", ">", ""], ["dueOn", "<", "z"]]),
    // getBusinessOverview (Today): two months of payments, open containers,
    // and the aggregates behind the queues and balances.
    raw("containerLinePayments", [eq("businessId"), ["createdAt", ">=", 0], ["createdAt", "<", 1]], { field: "createdAt", direction: "asc" }),
    raw("invoicePayments", [eq("businessId"), ["paidOn", ">=", "a"], ["paidOn", "<=", "b"]], { field: "paidOn", direction: "asc" }),
    raw("lotActivityPayments", [eq("businessId"), ["paidAtMonth", ">=", "a"], ["paidAtMonth", "<=", "b"]], { field: "paidAtMonth", direction: "asc" }),
    raw("inventorySales", [eq("businessId"), ["createdAt", ">=", 0], ["createdAt", "<", 1]], { field: "createdAt", direction: "desc" }),
    raw("inventoryCreditPayments", [eq("businessId"), ["createdAt", ">=", 0], ["createdAt", "<", 1]], { field: "createdAt", direction: "desc" }),
    raw("containers", [eq("businessId"), eq("status")]),
    raw("packageRequests", [eq("businessId"), eq("status")]),
    raw("containerLines", [eq("businessId"), eq("containerStatus")]),
    raw("inventorySales", [eq("businessId"), eq("creditStatus")]),
  ];
  const missing = shapes.filter((shape) => !shapeIsIndexed(shape, indexes)).map(describeRequiredIndex);
  assert.deepEqual(missing, []);
});

// ---------------------------------------------------------------------------
// The matcher itself.
// ---------------------------------------------------------------------------

test("requiredIndex: what needs a composite index and what does not", () => {
  assert.equal(requiredIndex(raw("x", [eq("a"), eq("b")])), null, "equalities merge single-field indexes");
  assert.equal(requiredIndex(raw("x", [], { field: "t", direction: "desc" })), null, "one field");
  assert.equal(requiredIndex(raw("x", [eq("a")], { field: "__name__", direction: "asc" })), null, "id order is implied");
  assert.deepEqual(requiredIndex(raw("x", [eq("a")], { field: "t", direction: "desc" })), {
    collection: "x", scope: "COLLECTION",
    prefix: [{ fieldPath: "a", contains: false }],
    order: { fieldPath: "t", order: "DESCENDING" },
  });
  // An inequality without an order is ordered by its own field, ascending.
  assert.deepEqual(requiredIndex(raw("x", [eq("a"), ["t", ">=", 1]]))?.order, { fieldPath: "t", order: "ASCENDING" });
  assert.throws(() => requiredIndex(raw("x", [["t", ">", 1]], { field: "u", direction: "desc" })), /first orderBy/);
  const need = raw("x", [eq("a"), eq("b")], { field: "t", direction: "desc" });
  const index = (fields: IndexDefinition["fields"]): IndexDefinition => ({ collectionGroup: "x", queryScope: "COLLECTION", fields });
  assert.ok(shapeIsIndexed(need, [index([{ fieldPath: "b", order: "ASCENDING" }, { fieldPath: "a", order: "ASCENDING" }, { fieldPath: "t", order: "DESCENDING" }])]));
  assert.ok(!shapeIsIndexed(need, [index([{ fieldPath: "a", order: "ASCENDING" }, { fieldPath: "b", order: "ASCENDING" }, { fieldPath: "t", order: "ASCENDING" }])]), "direction matters");
  assert.ok(!shapeIsIndexed(need, [index([{ fieldPath: "a", order: "ASCENDING" }, { fieldPath: "t", order: "DESCENDING" }])]), "every equality field");
});
