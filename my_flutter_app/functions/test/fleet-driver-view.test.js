"use strict";

// What a Fleet driver sees of their own account (docs/FLEET.md section 11):
// the pure shaping. Synthetic data only.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const view = require("../fleet_driver_view");

const TODAY = "2026-12-05";
const bill = (id, over = {}) => ({id, businessId: "biz", driverId: "d1",
  kind: "rent", label: "Rent", periodFrom: "2026-12-01",
  periodTo: "2026-12-31", dueDayKey: "2026-12-01", amountCents: 40000,
  paidCents: 0, status: "open", ...over});
const business = (settings = {}) => ({name: "Dala Fleet",
  phone: "+16465550100", fleet: {enabled: true, settings: {
    zelle: {name: "Dala Fleet LLC", handle: "pay@dala.test"}, ...settings}}});
const cars = new Map([["car1", {plate: "t100000c", vehicleType: "Camry",
  ownership: "driver", registrationExpiry: "2027-03-01",
  diamondExpiry: "2026-12-20", insurer: "Hereford", policyNumber: "P-1",
  vin: "VINVINVIN", premiumCents: 69166}]]);
const assignment = (over = {}) => ({id: "a1", carId: "car1", driverId: "d1",
  startDayKey: "2026-01-10", rentCents: 40000, period: "monthly", dueDay: 1,
  ...over});
const build = (over = {}) => view.driverFleetView({businessId: "biz",
  business: business(), driverId: "d1",
  driver: {name: "Awa Test #49", status: "active", creditCents: 0,
    notes: "office only", rememberedSenders: ["SOMEONE ELSE"],
    address: {line1: "1 Main St"}},
  bills: [bill("b1")], payments: [], assignments: [assignment()],
  carsById: cars, claims: [], todayKey: TODAY, ...over});

describe("driverFleetView", () => {
  it("says what the driver owes, what is late and where to pay", () => {
    const v = build({bills: [bill("b1"),
      bill("b2", {dueDayKey: "2027-01-01", periodFrom: "2027-01-01"}),
      bill("fee", {kind: "late_fee", label: "Late fee", amountCents: 2500,
        dueDayKey: "2026-12-05"})]});
    assert.deepEqual(v.balance, {owedCents: 82500, lateCents: 40000,
      nextDueDayKey: "2026-12-05", nextDueCents: 2500});
    assert.deepEqual(v.zelle, {name: "Dala Fleet LLC",
      handle: "pay@dala.test"});
    assert.equal(v.businessName, "Dala Fleet");
    assert.equal(v.onlyFleet, true);
    assert.equal(v.driver.name, "Awa Test");
  });

  it("carries nothing the office keeps for itself", () => {
    const v = build({payments: [{id: "p1", amountCents: 40000,
      method: "zelle", paidDayKey: "2026-11-02", status: "recorded",
      note: "office note", receivedByUid: "staff-1", bankTxnId: "txn",
      matchedBy: "sender", allocations: [{billId: "b0", cents: 40000}]}],
    claims: [{id: "c1", open: true, state: "waiting_bank",
      amountCents: 40000, createdAtMs: 5, fromPhone: "+16465550111",
      mediaPath: "support_cases/x/p.jpg", payerName: "X", read: {a: 1}}]});
    const flat = JSON.stringify(v);
    for (const secret of ["office only", "SOMEONE ELSE", "1 Main St",
      "office note", "staff-1", "txn", "matchedBy", "allocations",
      "mediaPath", "support_cases", "fromPhone", "payerName", "VINVINVIN",
      "premiumCents", "rememberedSenders", "P-1", "policyNumber"]) {
      assert.equal(flat.includes(secret), false, secret);
    }
    assert.deepEqual(v.payments, [{id: "p1", amountCents: 40000,
      method: "zelle", paidDayKey: "2026-11-02", creditAddedCents: 0}]);
    assert.deepEqual(v.claims, [{id: "c1", amountCents: 40000,
      state: "checking", createdAtMs: 5}]);
  });

  it("is off only when the Fleet admin switched it off", () => {
    assert.equal(build({business: business(
        {driversSeeOnlyThisBusiness: false})}).onlyFleet, false);
    assert.equal(build({business: business(
        {driversSeeOnlyThisBusiness: true})}).onlyFleet, true);
  });

  it("keeps a driver who left while they owe or still hold a plate, and " +
      "lets them go after", () => {
    const left = {name: "Awa", status: "left", creditCents: 0};
    assert.equal(build({driver: left, assignments: []}).driver.status,
        "left");
    assert.equal(build({driver: left, bills: [], assignments: []}), null);
    assert.equal(build({driver: left, bills: [],
      assignments: [assignment()]}).plates.length, 1);
    // An active driver with nothing owed and no plate is still a driver.
    assert.equal(build({bills: [], assignments: []}).driver.status,
        "active");
  });
});

describe("shippingOf", () => {
  const shipper = (over = {}) => ({status: "approved",
    enabledServices: ["fleet", "barrelShipping"], requestSlug: "dala-ship",
    packageRequestSettings: {acceptRequests: true}, ...over});
  it("offers the business's own request form when it takes requests", () => {
    assert.deepEqual(view.shippingOf(shipper()),
        {enabled: true, sendSlug: "dala-ship"});
    assert.deepEqual(build({business: {...business(), ...shipper()}})
        .shipping, {enabled: true, sendSlug: "dala-ship"});
  });
  it("shows packages but no form when requests are off or it has no link",
      () => {
        assert.deepEqual(view.shippingOf(shipper(
            {packageRequestSettings: {acceptRequests: false}})),
        {enabled: true, sendSlug: ""});
        assert.deepEqual(view.shippingOf(shipper({requestSlug: ""})),
            {enabled: true, sendSlug: ""});
      });
  it("is off for a business that does not ship, or is not approved", () => {
    const off = {enabled: false, sendSlug: ""};
    assert.deepEqual(view.shippingOf(shipper({enabledServices: ["fleet"]})),
        off);
    assert.deepEqual(view.shippingOf(shipper({status: "pending"})), off);
    assert.deepEqual(view.shippingOf(shipper(
        {enabledServices: "barrelShipping"})), off);
    assert.deepEqual(view.shippingOf(null), off);
    assert.deepEqual(build().shipping, off);
  });
});

describe("shownBills", () => {
  it("drops void bills, puts open ones first by due day, then the newest",
      () => {
        const rows = view.shownBills([
          bill("paid-old", {status: "paid", paidCents: 40000,
            dueDayKey: "2026-10-01"}),
          bill("void", {status: "void", voidReason: "billed_by_mistake"}),
          bill("open-late", {dueDayKey: "2026-11-01"}),
          bill("waived", {status: "waived", dueDayKey: "2026-11-15"}),
          bill("open-next", {dueDayKey: "2026-12-01"}),
        ]);
        assert.deepEqual(rows.map((b) => b.id),
            ["open-late", "open-next", "waived", "paid-old"]);
      });
  it("never says more was paid than the bill", () => {
    assert.equal(view.shownBills([bill("b", {paidCents: 99999})])[0]
        .paidCents, 40000);
  });
  it("keeps every open bill and at most 60 closed ones", () => {
    const many = [];
    for (let i = 0; i < 70; i += 1) {
      many.push(bill(`p${i}`, {status: "paid",
        dueDayKey: `2020-01-${String((i % 28) + 1).padStart(2, "0")}`}));
      many.push(bill(`o${i}`));
    }
    const rows = view.shownBills(many);
    assert.equal(rows.filter((b) => b.status === "open").length, 70);
    assert.equal(rows.filter((b) => b.status === "paid").length,
        view.CLOSED_BILL_LIMIT);
  });
});

describe("shownPayments", () => {
  it("leaves out undone payments, calls history `import`, newest first",
      () => {
        const rows = view.shownPayments([
          {id: "a", amountCents: 40000, method: "zelle",
            paidDayKey: "2026-10-02", status: "recorded"},
          {id: "b", amountCents: 40000, method: "cash",
            paidDayKey: "2026-11-02", status: "undone"},
          {id: "c", amountCents: 40000, method: "import", imported: true,
            paidDayKey: "2025-03-01", status: "recorded"},
          {id: "d", amountCents: 45000, method: "weird",
            paidDayKey: "2026-11-03", status: "recorded",
            creditAddedCents: 5000},
        ]);
        assert.deepEqual(rows.map((p) => [p.id, p.method]),
            [["d", "other"], ["a", "zelle"], ["c", "import"]]);
        assert.equal(rows[0].creditAddedCents, 5000);
      });
});

describe("shownClaims", () => {
  it("shows open reports only, in the driver's words", () => {
    const rows = view.shownClaims([
      {id: "1", open: true, state: "waiting_bank", amountCents: 40000,
        createdAtMs: 1},
      {id: "2", open: true, state: "asking_name", amountCents: 40000,
        createdAtMs: 3},
      {id: "3", open: true, state: "office", amountCents: null,
        createdAtMs: 2},
      {id: "4", open: false, state: "paid", amountCents: 40000,
        createdAtMs: 9},
      {id: "5", open: false, state: "closed", createdAtMs: 8},
    ]);
    assert.deepEqual(rows.map((c) => [c.id, c.state, c.amountCents]),
        [["2", "reply", 40000], ["3", "office", 0], ["1", "checking", 40000]]);
  });
});

describe("shownPlates", () => {
  it("lists the plates still held with the paperwork a driver needs", () => {
    const rows = view.shownPlates([assignment(),
      assignment({id: "a0", endDayKey: "2026-06-01"}),
      assignment({id: "a2", carId: "gone", period: "weekly", dueDay: 3})],
    cars);
    assert.deepEqual(rows.map((p) => p.assignmentId), ["a2", "a1"]);
    assert.deepEqual(rows[1], {assignmentId: "a1", plate: "T100000C",
      vehicleType: "Camry", ownership: "driver",
      registrationExpiry: "2027-03-01", diamondExpiry: "2026-12-20",
      insurer: "Hereford", rentCents: 40000,
      period: "monthly", dueDay: 1, startDayKey: "2026-01-10"});
    // The policy number stays with the office.
    assert.equal(JSON.stringify(rows).includes("P-1"), false);
    assert.equal(rows[0].plate, "");
    assert.equal(rows[0].period, "weekly");
  });
});

describe("proofWhatsApp", () => {
  it("is Laawol's number unless the env names a real one", () => {
    assert.equal(view.proofWhatsApp({}), view.PROOF_WHATSAPP);
    assert.equal(view.proofWhatsApp({WHATSAPP_DISPLAY_NUMBER: "nope"}),
        view.PROOF_WHATSAPP);
    assert.equal(view.proofWhatsApp(
        {WHATSAPP_DISPLAY_NUMBER: "+16465550100"}), "+16465550100");
  });
});
