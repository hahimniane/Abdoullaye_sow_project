"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const balances = require("../staff_balances");
const fixture = require("./fixtures/staff-balances-cases.json");

describe("staff balances (shared fixture)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const out = balances.staffBalances({
        now: c.nowMs,
        staffNames: c.staffNames,
        sources: c.sources,
        handovers: c.handovers,
        netting: c.netting,
        counted: c.counted,
      });
      assert.deepEqual(out, c.expect);
    });
  }
});

describe("staff balances: the pieces", () => {
  const NOW = new Date("2026-10-29T16:00:00Z");

  it("collectReceipts keeps Business account receipts apart by id", () => {
    const receipts = balances.collectReceipts({
      containerLinePayments: [
        {id: "a", amountCents: 100, method: "zelle",
          receivedByStaffId: "business_account"},
        {id: "b", amountCents: 200, method: "cash", receivedByStaffId: "mo"},
      ],
    }, NOW);
    assert.deepEqual(receipts.map((r) => [r.staffId, r.amountCents]),
        [["business_account", 100], ["mo", 200]]);
    const applied = balances.applyHandovers(receipts, []);
    assert.deepEqual(Object.keys(applied.people), ["mo"]);
    assert.equal(applied.businessAccount.receivedCents, 100);
  });

  it("an empty method reads as other; rows without amounts are skipped", () => {
    const receipts = balances.collectReceipts({
      invoicePayments: [
        {id: "a", amountCents: 100, method: "", receivedByStaffId: "mo"},
        {id: "b", amountCents: 0, method: "cash", receivedByStaffId: "mo"},
        {id: "c", amountCents: 50, method: "cash", receivedByStaffId: ""},
      ],
    }, NOW, {invoice: true});
    assert.deepEqual(receipts.map((r) => r.method), ["other"]);
  });

  it("an open parking stay marked paid counts what it has run up", () => {
    const receipts = balances.collectReceipts({
      parkedCars: [{id: "p", parkingDate: "2026-10-27", dailyRate: 10,
        paymentStatus: "succeeded", receivedByStaffId: "mo"}],
    }, NOW);
    // 27th, 28th and 29th at $10.
    assert.equal(receipts[0].amountCents, 3000);
  });

  it("a handover answered twice counts once: declined/voided never move",
      () => {
        const applied = balances.applyHandovers(
            [{staffId: "a", amountCents: 1000, method: "cash"}],
            [{fromStaffId: "a", toId: "b", amountCents: 400,
              status: "declined"},
            {fromStaffId: "a", toId: "b", amountCents: 300,
              status: "voided"}]);
        assert.equal(applied.people.a.heldCents, 1000);
        assert.equal(applied.people.b, undefined);
      });

  it("garbage input answers zeros, never throws", () => {
    const out = balances.staffBalances({});
    assert.deepEqual(out, {asOfMs: 0, counted: {parking: true,
      activity: true, package: true, shop: true, invoice: false}, staff: [],
    businessAccount: {receivedCents: 0, pendingInCents: 0}, pending: []});
    assert.doesNotThrow(() => balances.staffBalances(null));
  });
});

describe("staff balances: handover rules", () => {
  const ok = {toId: "fa", amountCents: 100, method: "cash"};

  it("recordHandoverRefusal", () => {
    assert.equal(balances.recordHandoverRefusal({...ok,
      fromStaffId: "mo"}), "");
    assert.equal(balances.recordHandoverRefusal({...ok, fromStaffId: "mo",
      toId: "business_account"}), "");
    assert.equal(balances.recordHandoverRefusal({...ok, fromStaffId: "fa"}),
        "handover_to_self");
    for (const amountCents of [0, -1, 1.5, "100", null, 100000001]) {
      assert.equal(balances.recordHandoverRefusal({...ok, amountCents,
        fromStaffId: "mo"}), "handover_amount_invalid");
    }
    for (const method of ["card", "", undefined]) {
      assert.equal(balances.recordHandoverRefusal({...ok, method,
        fromStaffId: "mo"}), "handover_method_invalid");
    }
    for (const toId of ["", undefined, "a/b"]) {
      assert.equal(balances.recordHandoverRefusal({...ok, toId,
        fromStaffId: "mo"}), "handover_receiver_invalid");
    }
  });

  it("handoverRecord is pending, from the caller, to the receiver", () => {
    const row = balances.handoverRecord({...ok, note: " slip ",
      proofPath: "p"}, {businessId: "b", uid: "mo"});
    assert.equal(row.status, "pending");
    assert.equal(row.kind, "handover");
    assert.equal(row.fromStaffId, "mo");
    assert.equal(row.createdByUid, "mo");
    assert.equal(row.toId, "fa");
    assert.equal(row.note, "slip");
    assert.equal(row.confirmedByUid, "");
  });

  it("openingRecord is confirmed, to the Business account", () => {
    const row = balances.openingRecord({staffId: "mo", amountCents: 5},
        {businessId: "b", uid: "owner"});
    assert.equal(row.kind, "opening");
    assert.equal(row.status, "confirmed");
    assert.equal(row.toId, "business_account");
    assert.equal(row.fromStaffId, "mo");
    assert.equal(row.confirmedByUid, "owner");
  });

  it("only the receiver answers; the owner for the Business account", () => {
    const h = {businessId: "b", fromStaffId: "mo", toId: "fa",
      status: "pending"};
    const as = (uid, isOwner = false, row = h) =>
      balances.handoverAnswerRefusal(row, {uid, businessId: "b", isOwner});
    assert.equal(as("fa"), "");
    assert.equal(as("mo"), "handover_not_receiver");
    // The owner may not answer for a person.
    assert.equal(as("owner", true), "handover_not_receiver");
    const toBank = {...h, toId: "business_account"};
    assert.equal(as("owner", true, toBank), "");
    assert.equal(as("fa", false, toBank), "handover_not_receiver");
    assert.equal(as("fa", false, {...h, status: "confirmed"}),
        "handover_not_pending");
    assert.equal(as("fa", false, null), "handover_not_found");
    assert.equal(as("fa", false, {...h, businessId: "other"}),
        "handover_not_found");
  });

  it("the giver voids while pending; the owner any time; never twice", () => {
    const h = {businessId: "b", fromStaffId: "mo", toId: "fa",
      status: "pending"};
    const voidBy = (uid, isOwner = false, row = h) =>
      balances.handoverVoidRefusal(row, {uid, businessId: "b", isOwner});
    assert.equal(voidBy("mo"), "");
    assert.equal(voidBy("mo", false, {...h, status: "confirmed"}),
        "handover_void_not_allowed");
    assert.equal(voidBy("fa"), "handover_void_not_allowed");
    assert.equal(voidBy("owner", true, {...h, status: "confirmed"}), "");
    assert.equal(voidBy("owner", true, {...h, status: "voided"}),
        "handover_voided");
    assert.equal(voidBy("mo", false, null), "handover_not_found");
  });

  it("every refusal has a message and a kind", () => {
    for (const code of Object.keys(balances.HANDOVER_MESSAGES)) {
      const r = balances.handoverRefusal(code);
      assert.ok(r.message && r.message !== code, code);
      assert.ok(r.kind, code);
    }
  });
});

describe("what counts as the business's money (STAFF_BALANCES.md §7)", () => {
  const NOW = new Date("2026-10-29T16:00:00Z");
  const sources = {
    parkedCars: [{id: "p", parkingDate: "2026-10-27",
      parkingEndDate: "2026-10-27", dailyRate: 10, paymentStatus: "paid",
      amountPaidCents: 1000, receivedByStaffId: "mo"}],
    lotActivityPayments: [{id: "a", activityId: "x", amountCents: 2000,
      receivedVia: "cash", receivedByStaffId: "mo"}],
    containerLinePayments: [{id: "k", amountCents: 3000, method: "cash",
      receivedByStaffId: "mo"}],
    inventorySales: [{id: "s", totalCents: 4000, paymentMethod: "cash",
      soldByStaffId: "mo", receivedByStaffId: "mo"}],
    invoicePayments: [{id: "i", amountCents: 650000, method: "cash",
      receivedByStaffId: "mo"}],
  };
  const kinds = (counted) => balances.collectReceipts(sources, NOW, counted)
      .map((r) => r.source).sort();

  it("by default, invoices (staff's own car sales) do not count", () => {
    assert.ok(!kinds(undefined).includes("invoice"));
    assert.ok(kinds(undefined).includes("parking"));
    assert.ok(kinds(undefined).includes("package"));
    assert.ok(kinds({invoice: true}).includes("invoice"));
  });

  it("each kind the business switches off is left out", () => {
    assert.ok(!kinds({parking: false}).includes("parking"));
    assert.ok(!kinds({activity: false}).includes("activity"));
    assert.ok(!kinds({package: false}).includes("package"));
    const shopOff = kinds({shop: false});
    assert.ok(!shopOff.includes("inventory") &&
      !shopOff.includes("inventory_credit"));
  });

  it("the answer says what counted, every key filled", () => {
    const out = balances.staffBalances({now: NOW, sources,
      counted: {package: false}});
    assert.deepEqual(out.counted, {parking: true, activity: true,
      package: false, shop: true, invoice: false});
    const mo = out.staff.find((r) => r.staffId === "mo");
    assert.ok(mo.heldCents < 650000, "the car sale is not held money");
  });

  it("only real choices are stored", () => {
    assert.equal(balances.cleanCountedSources(null), null);
    assert.equal(balances.cleanCountedSources({invoice: "yes"}), null);
    assert.deepEqual(balances.cleanCountedSources({invoice: true,
      junk: false}), {parking: true, activity: true, package: true,
      shop: true, invoice: true});
  });
});
