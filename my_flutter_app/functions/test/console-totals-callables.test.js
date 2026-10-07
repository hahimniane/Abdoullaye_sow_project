"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");
const {Timestamp} = require("firebase-admin/firestore");

const {cacheDocId, createConsoleTotalsHandlers} =
  require("../console_totals");
const {invoiceBoard, lotLedgerTotals} = require("../console_summaries");

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// A small in-memory Firestore: the subset the handlers use.
// ---------------------------------------------------------------------------

function comparable(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return value;
}

function compare(a, b) {
  const x = comparable(a);
  const y = comparable(b);
  if (x === y) return 0;
  if (x === undefined || x === null) return -1;
  if (y === undefined || y === null) return 1;
  return x < y ? -1 : 1;
}

function matches(row, [field, op, value]) {
  if (!(field in row)) return false;
  const actual = comparable(row[field]);
  const wanted = comparable(value);
  switch (op) {
    case "==": return actual === wanted;
    case "<": return typeof actual === typeof wanted && actual < wanted;
    case "<=": return typeof actual === typeof wanted && actual <= wanted;
    case ">": return typeof actual === typeof wanted && actual > wanted;
    case ">=": return typeof actual === typeof wanted && actual >= wanted;
    case "in": return wanted.includes(actual);
    default: throw new Error(`fake firestore: unhandled op ${op}`);
  }
}

function snapshotOf(id, data) {
  return {id, exists: data !== undefined, data: () => data && {...data}};
}

class FakeQuery {
  constructor(db, name, state = {}) {
    this.db = db;
    this.name = name;
    this.state = {filters: [], orders: [], limit: null, after: null,
      ...state};
  }
  with(change) {
    return new FakeQuery(this.db, this.name, {...this.state, ...change});
  }
  where(field, op, value) {
    return this.with({filters: [...this.state.filters, [field, op, value]]});
  }
  orderBy(field, direction = "asc") {
    return this.with({orders: [...this.state.orders, [field, direction]]});
  }
  limit(n) {
    return this.with({limit: n});
  }
  startAfter(doc) {
    return this.with({after: doc.id});
  }
  select() {
    return this;
  }
  rows() {
    this.db.reads.push(this.name);
    const all = Object.entries(this.db.data[this.name] || {})
        .map(([id, data]) => ({id, data}))
        .filter(({data}) => this.state.filters.every((f) => matches(data, f)));
    const inequality = this.state.filters
        .find(([, op]) => !["==", "in"].includes(op));
    const orders = this.state.orders.length ? this.state.orders :
      inequality ? [[inequality[0], "asc"]] : [];
    all.sort((a, b) => {
      for (const [field, direction] of orders) {
        const c = compare(a.data[field], b.data[field]);
        if (c !== 0) return direction === "desc" ? -c : c;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    let rows = all;
    if (this.state.after) {
      const at = rows.findIndex((row) => row.id === this.state.after);
      rows = rows.slice(at + 1);
    }
    if (this.state.limit != null) rows = rows.slice(0, this.state.limit);
    return rows;
  }
  async get() {
    return {docs: this.rows().map(({id, data}) => snapshotOf(id, data))};
  }
  count() {
    return {get: async () => ({data: () => ({count: this.rows().length})})};
  }
  aggregate(spec) {
    return {get: async () => {
      const rows = this.rows();
      const out = {};
      for (const [key, field] of Object.entries(spec)) {
        out[key] = field.aggregateType === "count" ? rows.length :
          rows.reduce((sum, {data}) =>
            sum + (typeof data[field._field] === "number" ?
              data[field._field] : 0), 0);
      }
      return {data: () => out};
    }};
  }
  doc(id) {
    const db = this.db;
    const name = this.name;
    // Firestore reads "/" as a path separator: `collection(c).doc("a/b")`
    // names a collection, and the Admin SDK throws.
    if (typeof id !== "string" || !id || id.includes("/")) {
      throw new Error(`Value for argument "documentPath" must point to a ` +
        `document, but was "${name}/${id}".`);
    }
    return {
      name, id,
      get: async () => snapshotOf(id, (db.data[name] || {})[id]),
      set: async (data) => {
        db.data[name] = db.data[name] || {};
        db.data[name][id] = data;
        db.writes.push(`${name}/${id}`);
      },
    };
  }
}

function fakeDb(data) {
  const db = {data, reads: [], writes: []};
  db.collection = (name) => new FakeQuery(db, name);
  db.getAll = async (...refs) => Promise.all(refs.map((ref) => ref.get()));
  return db;
}

// ---------------------------------------------------------------------------
// Handlers wired to stand-in permission helpers.
// ---------------------------------------------------------------------------

const USERS = {
  owner: {role: "businessOwner", businessId: "biz"},
  ledgerStaff: {role: "staff", businessId: "biz",
    businessPermissions: ["ledger"]},
  parkingStaff: {role: "staff", businessId: "biz",
    businessPermissions: ["parking"]},
  outsider: {role: "businessOwner", businessId: "other"},
  customer: {role: "customer"},
  financeAdmin: {role: "admin", effectiveCapabilities: ["finance"]},
  financeViewer: {role: "admin", effectiveCapabilities: [],
    effectiveSections: {finance: "view"}},
  opsAdmin: {role: "admin", effectiveCapabilities: ["operations"]},
  bareAdmin: {role: "admin", effectiveCapabilities: [],
    effectiveSections: {}},
};

function hasBusinessPermission(user, section) {
  if (user.role === "admin" || user.role === "businessOwner") return true;
  return (user.businessPermissions || []).includes(section);
}

function handlersFor(data, {touchGuard = false} = {}) {
  const db = fakeDb(data);
  let gated = false;
  const gates = [];
  const firestore = () => {
    if (touchGuard && !gated) {
      throw new Error("database read before the permission check");
    }
    return db;
  };
  const requireBusinessManager = async (uid, businessId) => {
    gates.push(["manager", businessId]);
    const user = USERS[uid];
    const ok = user && (user.role === "admin" ||
      (["staff", "businessOwner"].includes(user.role) &&
        user.businessId === businessId));
    if (!ok) {
      throw new HttpsError("permission-denied", "Business access denied");
    }
    gated = true;
    return user;
  };
  const handlers = createConsoleTotalsHandlers({
    admin: {firestore},
    HttpsError,
    logger: {warn: () => {}},
    requireAuth: (request) => {
      if (!request.auth) throw new HttpsError("unauthenticated", "Sign in");
      return request.auth.uid;
    },
    requireBusinessManager,
    requireBusinessPermission: async (uid, businessId, section) => {
      gates.push(["section", section]);
      gated = false;
      const user = await requireBusinessManager(uid, businessId);
      gated = false;
      if (!hasBusinessPermission(user, section)) {
        throw new HttpsError("permission-denied", "Not allowed");
      }
      gated = true;
      return user;
    },
    hasBusinessPermission,
    getUserProfile: async (uid) => {
      gated = true;
      return USERS[uid] || {role: "customer"};
    },
    hasAdminCapability: (user, capability) => user.role === "admin" &&
      (user.effectiveCapabilities || []).includes(capability),
    hasAdminSectionAccess: (user, section) => user.role === "admin" &&
      ["view", "manage"].includes((user.effectiveSections || {})[section]),
    normalizeBusinessServices: (raw) => Array.isArray(raw) ? raw :
      ["barrelShipping", "freight", "carSales", "carTransport", "carParking"],
    ensureParkingOccupancyIndexed: async () => {},
    now: () => new Date("2026-10-05T15:00:00Z"),
  });
  return {handlers, db, gates};
}

const call = (uid, data = {}, {verified = true} = {}) => ({
  auth: uid ? {uid, token: {email_verified: verified}} : null, data});

describe("console totals callables: who may call", () => {
  const businessCalls = [
    ["getInvoiceBoardTotals", "ledger"],
    ["getLotLedgerTotals", "ledger"],
    ["getParkingTotals", "parking"],
  ];

  for (const [name, section] of businessCalls) {
    it(`${name} is gated on the ${section} section`, async () => {
      const {handlers, gates} = handlersFor({}, {touchGuard: true});
      await assert.rejects(handlers[name](call(null, {businessId: "biz"})),
          {code: "unauthenticated"});
      await assert.rejects(handlers[name](call("outsider",
          {businessId: "biz"})), {code: "permission-denied"});
      const wrongStaff = section === "ledger" ? "parkingStaff" :
        "ledgerStaff";
      await assert.rejects(handlers[name](call(wrongStaff,
          {businessId: "biz"})), {code: "permission-denied"});
      await assert.rejects(handlers[name](call("customer",
          {businessId: "biz"})), {code: "permission-denied"});
      assert.ok(gates.some(([kind, value]) =>
        kind === "section" && value === section));
    });
  }

  it("getBusinessOverview needs someone who works for that business",
      async () => {
        const {handlers} = handlersFor({}, {touchGuard: true});
        await assert.rejects(handlers.getBusinessOverview(call("outsider",
            {businessId: "biz"})), {code: "permission-denied"});
        await assert.rejects(handlers.getBusinessOverview(call("owner", {})),
            {code: "invalid-argument"});
      });

  it("getPlatformEarnings needs finance (capability or view access)",
      async () => {
        const {handlers} = handlersFor({});
        await assert.rejects(handlers.getPlatformEarnings(call("opsAdmin")),
            {code: "permission-denied"});
        await assert.rejects(handlers.getPlatformEarnings(call("owner")),
            {code: "permission-denied"});
        const viewer = await handlers.getPlatformEarnings(
            call("financeViewer"));
        assert.ok(viewer.summary, "a finance viewer reads the earnings");
        const manager = await handlers.getPlatformEarnings(
            call("financeAdmin"));
        assert.ok(manager.summary);
      });

  it("getAdminOverview is for verified platform administrators only",
      async () => {
        const {handlers} = handlersFor({});
        await assert.rejects(handlers.getAdminOverview(call("owner")),
            {code: "permission-denied"});
        await assert.rejects(handlers.getAdminOverview(call(null)),
            {code: "unauthenticated"});
        await assert.rejects(handlers.getAdminOverview(
            call("bareAdmin", {}, {verified: false})),
        {code: "permission-denied"});
        // Today is every admin's landing tab, view-only roles included.
        const overview = await handlers.getAdminOverview(call("bareAdmin"));
        assert.equal(typeof overview.users.total, "number");
      });
});

describe("console totals callables: what they answer", () => {
  it("the invoice board counts every invoice of that business only",
      async () => {
        const invoices = {};
        for (let i = 0; i < 1200; i += 1) {
          invoices[`inv${i}`] = {businessId: "biz",
            status: i % 3 === 0 ? "paid" : "open",
            dueOn: i % 5 === 0 ? "2026-09-01" : "2026-12-01",
            balanceCents: i % 3 === 0 ? 0 : 100, paidCents: 50};
        }
        invoices.foreign = {businessId: "other", status: "open",
          dueOn: "2026-01-01", balanceCents: 99999, paidCents: 99999};
        const {handlers} = handlersFor({invoices});
        const result = await handlers.getInvoiceBoardTotals(
            call("ledgerStaff", {businessId: "biz", today: "2026-10-05"}));
        const own = Object.values(invoices)
            .filter((row) => row.businessId === "biz");
        assert.deepEqual(result.board, invoiceBoard(own, "2026-10-05"));
        assert.equal(result.board.count, 1200);
      });

  it("the ledger totals match the definition over the same records",
      async () => {
        const at = (iso) => Timestamp.fromDate(new Date(iso));
        const data = {
          lotActivities: {
            a1: {businessId: "biz", feeCents: 5000, activityTypeId: "t",
              activityDate: at("2026-10-02T12:00:00Z"),
              activityDateMonth: "2026-10", paymentStatus: "succeeded"},
            a2: {businessId: "biz", feeCents: 8000, activityTypeId: "t",
              activityDate: at("2026-07-02T12:00:00Z"),
              activityDateMonth: "2026-07",
              paymentStatus: "awaiting_direct_payment",
              amountPaidCents: 3000},
            a3: {businessId: "biz", feeCents: 4000, activityTypeId: "t",
              activityDate: at("2025-02-02T12:00:00Z"),
              activityDateMonth: "2025-02",
              paymentStatus: "awaiting_direct_payment",
              amountPaidCents: 1000},
            x1: {businessId: "other", feeCents: 99999, activityTypeId: "t",
              activityDate: at("2026-10-02T12:00:00Z"),
              activityDateMonth: "2026-10", paymentStatus: "succeeded"},
          },
          lotActivityPayments: {
            p1: {businessId: "biz", activityId: "a2", amountCents: 3000,
              paidAtMonth: "2026-07"},
            // Paid in October against a job billed in February 2025.
            p2: {businessId: "biz", activityId: "a3", amountCents: 1000,
              paidAtMonth: "2026-10"},
          },
          lotExpenseLines: {},
          lotExpenseEntries: {
            e1: {businessId: "biz", month: "2026-10", amountCents: 700},
            e2: {businessId: "biz", month: "", amountCents: 300,
              spentAt: at("2026-10-03T12:00:00Z")},
          },
          parkedCars: {},
          businesses: {biz: {name: "Biz"}},
        };
        const {handlers} = handlersFor(data);
        const request = {businessId: "biz", rangeStart: "2026-07",
          rangeEnd: "2026-10", month: "2026-10", year: 2026,
          nowMonth: "2026-10", timeZone: "UTC"};
        const result = await handlers.getLotLedgerTotals(
            call("ledgerStaff", request));
        const own = (name) => Object.entries(data[name])
            .map(([id, row]) => ({id, ...row}))
            .filter((row) => row.businessId === "biz");
        const expected = lotLedgerTotals({
          activities: own("lotActivities"),
          payments: own("lotActivityPayments"),
          expenseLines: [],
          expenseEntries: own("lotExpenseEntries"),
          rangeStart: "2026-07", rangeEnd: "2026-10", month: "2026-10",
          year: 2026, nowMonth: "2026-10", timeZone: "UTC"});
        assert.deepEqual(result.ledger, expected);
        assert.equal(result.ledger.scoreboard.collectedCents, 9000);
        assert.equal(result.ledger.monthExpenseCents, 1000);
        assert.equal(result.complete, true);
      });

  it("caches the business overview and refreshes it only when asked",
      async () => {
        const data = {
          businesses: {biz: {enabledServices: ["carSales"]}},
          cars: {c1: {businessId: "biz", status: "active", price: 9000}},
          carPurchases: {p1: {businessId: "biz", purchaseStatus: "pending",
            depositAmount: 500}},
          supportCases: {},
        };
        const {handlers, db} = handlersFor(data);
        const first = await handlers.getBusinessOverview(
            call("owner", {businessId: "biz"}));
        assert.equal(first.cached, false);
        assert.equal(first.overview.metrics.activeListings, 1);
        assert.equal(first.overview.metrics.pendingPurchases, 1);
        assert.equal(first.overview.activeInventoryValue, 9000);
        const readsAfterFirst = db.reads.length;
        const second = await handlers.getBusinessOverview(
            call("owner", {businessId: "biz"}));
        assert.equal(second.cached, true);
        assert.deepEqual(second.overview, first.overview);
        assert.equal(db.reads.length, readsAfterFirst,
            "a cached answer reads no records");
        // A refresh inside the first minute still serves the cache.
        const third = await handlers.getBusinessOverview(
            call("owner", {businessId: "biz", refresh: true}));
        assert.equal(third.cached, true);
      });

  // Regression: the parking cache key embeds the viewer's zone, and an
  // unencoded "America/New_York" made the cache id a path - every ledger
  // and parking total failed ("Totals could not be loaded").
  for (const timeZone of ["America/New_York",
    "America/Argentina/Buenos_Aires", "Africa/Conakry", "UTC", ""]) {
    it(`ledger and parking totals load for a viewer in "${timeZone}"`,
        async () => {
          const data = {
            lotActivities: {}, lotActivityPayments: {}, lotExpenseLines: {},
            lotExpenseEntries: {},
            parkedCars: {},
            businesses: {biz: {name: "Biz", parkingTotalSpaces: 10}},
          };
          const {handlers, db} = handlersFor(data);
          const ledger = await handlers.getLotLedgerTotals(call("ledgerStaff",
              {businessId: "biz", year: 2026, timeZone}));
          assert.equal(ledger.complete, true);
          const parking = await handlers.getParkingTotals(call("parkingStaff",
              {businessId: "biz", year: 2026, timeZone}));
          assert.equal(parking.parking.year, 2026);
          const cacheWrites = db.writes
              .filter((path) => path.startsWith("consoleSummaryCache/"));
          assert.ok(cacheWrites.length > 0, "the ended-stays cache is written");
          for (const written of cacheWrites) {
            assert.equal(written.split("/").length, 2,
                `${written} is one document id`);
          }
          // The second call is served from the cache written by the first.
          const again = await handlers.getParkingTotals(call("parkingStaff",
              {businessId: "biz", year: 2026, timeZone}));
          assert.equal(again.parking.endedComputedAtMs,
              parking.parking.endedComputedAtMs);
        });
  }
});

describe("console totals: cache document ids", () => {
  it("encodes path separators and keeps plain keys unchanged", () => {
    assert.equal(cacheDocId("businessOverview__biz__cars"),
        "businessOverview__biz__cars");
    assert.equal(cacheDocId("parkingEnded__biz__2026__UTC"),
        "parkingEnded__biz__2026__UTC");
    const zoned = cacheDocId("parkingEnded__biz__2026__America/New_York");
    assert.equal(zoned, "parkingEnded__biz__2026__America%2FNew_York");
    assert.doesNotMatch(zoned, /\//);
  });

  it("never collides two zones and never yields an invalid id", () => {
    const a = cacheDocId("k__America/New_York");
    const b = cacheDocId("k__America_New_York");
    assert.notEqual(a, b);
    for (const key of ["", ".", "..", "__x__", "x".repeat(2000),
      "a/b/c/d", "biz with spaces/é"]) {
      const id = cacheDocId(key);
      assert.ok(id.length > 0 && id.length <= 400, key);
      assert.doesNotMatch(id, /\//);
      assert.notEqual(id, ".");
      assert.notEqual(id, "..");
      assert.doesNotMatch(id, /^__.*__$/);
    }
  });

  it("every cache read and write goes through the encoder", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "console_totals.js"), "utf8");
    const cacheDocs = source.match(
        /collection\(CACHE_COLLECTION\)\s*\.doc\(([^)]*\)?)\)/g) || [];
    assert.ok(cacheDocs.length >= 2);
    for (const use of cacheDocs) assert.match(use, /\.doc\(cacheDocId\(/);
  });
});

describe("console totals callables: wiring", () => {
  const root = path.join(__dirname, "..");
  const index = fs.readFileSync(path.join(root, "index.js"), "utf8");
  const rules = fs.readFileSync(path.join(root, "..", "firestore.rules"),
      "utf8");

  it("exports every handler with the browser callable options", () => {
    const options = index.match(
        new RegExp("const CONSOLE_TOTALS_CALLABLE_OPTIONS = " +
          "Object\\.freeze\\(\\{([^}]*)\\}\\)"));
    assert.ok(options, "shared options object missing");
    assert.match(options[1], /enforceAppCheck: ENFORCE_APP_CHECK/);
    assert.match(options[1], /cors: true/);
    assert.match(options[1], /invoker: "public"/);
    for (const name of ["getBusinessOverview", "getInvoiceBoardTotals",
      "getLotLedgerTotals", "getParkingTotals", "getAdminOverview",
      "getPlatformEarnings"]) {
      assert.match(index, new RegExp(`exports\\.${name} = onCall\\(` +
        `CONSOLE_TOTALS_CALLABLE_OPTIONS,\\s*consoleTotals\\.${name}\\);`));
    }
  });

  it("keeps the summary cache out of every client's reach", () => {
    assert.doesNotMatch(rules, /consoleSummaryCache/);
    assert.doesNotMatch(rules, /match \/\{document=\*\*\}/);
  });
});
