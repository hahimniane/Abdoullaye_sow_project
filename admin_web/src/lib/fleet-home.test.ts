import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { indexFleet, type FleetData } from "./fleet.ts";
import type { FleetBankStatus } from "./fleet-bank.ts";
import type { ClaimView } from "./fleet-claims.ts";
import { fleetSearch, fleetViewForTab, idlePlates, needsItems, parseDayWords, plateOnDay } from "./fleet-home.ts";
import { driverRows } from "./fleet.ts";

const TODAY = "2026-11-26";

function sample(): FleetData {
  return {
    drivers: [
      { id: "d1", name: "Amadou Diallo", phone: "+19175550101", status: "active", creditCents: 0 },
      { id: "d2", name: "Bako Sy", phone: "+19175550102", status: "active", creditCents: 0 },
      { id: "d3", name: "Old Driver", phone: "+19175550103", status: "left" },
    ],
    cars: [
      { id: "c1", plate: "T123456C", company: "Landa", registrationExpiry: "2027-06-01", diamondExpiry: "2026-12-08" },
      { id: "c2", plate: "T222222C", company: "Landa", registrationExpiry: "2027-06-01", diamondExpiry: "2027-06-01" },
      { id: "c3", plate: "T712000C", company: "Dala Cars", registrationExpiry: "", diamondExpiry: "2027-06-01" },
      { id: "c4", plate: "T999999C", company: "Dala Cars", registrationExpiry: "2026-11-01", diamondExpiry: "2027-06-01" },
    ],
    assignments: [
      { id: "a1", carId: "c1", driverId: "d1", startDayKey: "2026-01-01", endDayKey: null, rentCents: 42500, period: "monthly" },
      { id: "a2", carId: "c2", driverId: "d2", startDayKey: "2026-02-01", endDayKey: null, rentCents: 40000, period: "monthly" },
      { id: "a3", carId: "c3", driverId: "d3", startDayKey: "2026-08-14", endDayKey: "2026-11-16", rentCents: 42000, period: "monthly" },
    ],
    bills: [
      { id: "b1", driverId: "d1", kind: "rent", status: "open", amountCents: 42500, paidCents: 0, dueDayKey: "2026-11-01" },
      { id: "b2", driverId: "d2", kind: "rent", status: "paid", amountCents: 40000, paidCents: 40000, dueDayKey: "2026-11-01" },
    ],
    payments: [],
    notes: [],
    substitutes: [{ id: "s1", carId: "c1", driverId: "d1", name: "Ibou Mbaye", fromDayKey: "2026-07-01", toDayKey: "2026-07-14" }],
  };
}

const bank = (over: Partial<FleetBankStatus> = {}): FleetBankStatus => ({
  schedule: { every: 0, fromHour: 7, toHour: 23 } as FleetBankStatus["schedule"],
  quote: { perDay: 0, days: 0, perMonth: 0, centsEach: 12, monthCents: 0 },
  bank: { connected: true, institutionName: "Bank", accountMask: "1234" },
  waiting: [],
  removed: [],
  lastScheduledMs: 0,
  ...over,
});

const claim = (over: Partial<ClaimView>): ClaimView => ({
  id: "k1",
  driverId: "d2",
  who: "Bako Sy",
  hasDriver: true,
  amountCents: 40000,
  atMs: 1,
  sentence: "",
  hasPhoto: true,
  state: "waiting_bank",
  ...over,
});

describe("fleetViewForTab", () => {
  it("sends every old Fleet menu id to its tab", () => {
    assert.equal(fleetViewForTab("fleetPayments"), "payments");
    assert.equal(fleetViewForTab("fleetDrivers"), "drivers");
    assert.equal(fleetViewForTab("fleetCars"), "plates");
    assert.equal(fleetViewForTab("fleetPaperwork"), "paperwork");
    assert.equal(fleetViewForTab("fleetSettings"), "settings");
    assert.equal(fleetViewForTab("fleet"), "needs");
    assert.equal(fleetViewForTab("parking"), null);
  });
});

describe("idlePlates", () => {
  it("counts the days since the last driver gave it back and prorates the last fee", () => {
    const data = sample();
    const idle = idlePlates(data, indexFleet(data), TODAY);
    const c3 = idle.find((p) => p.carId === "c3");
    assert.equal(c3?.idleDays, 10);
    assert.equal(c3?.missedCents, 14000); // 420.00 / 30 * 10
    const never = idle.find((p) => p.carId === "c4");
    assert.equal(never?.idleDays, null);
    assert.equal(never?.missedCents, 0);
    assert.equal(idle[0].carId, "c3", "the most rent missed first");
    assert.ok(!idle.some((p) => p.carId === "c1"), "a plate with a driver is not idle");
  });
});

describe("needsItems", () => {
  it("lists money first, then paperwork soonest first, then one line for missing dates", () => {
    const data = sample();
    const items = needsItems({ data, index: indexFleet(data), todayKey: TODAY, claims: [], bank: null });
    assert.deepEqual(items.map((i) => i.kind), ["late", "idle", "paper", "paper", "idle", "missingPaper"]);
    const late = items[0];
    assert.equal(late.kind === "late" && late.driverId, "d1");
    const papers = items.filter((i) => i.kind === "paper");
    assert.deepEqual(papers.map((p) => p.kind === "paper" && p.carId), ["c4", "c1"], "the expired one first");
    const missing = items.at(-1);
    assert.equal(missing?.kind === "missingPaper" && missing.count, 1);
  });

  it("shows a driver's screenshot only once the office must act on it", () => {
    const data = sample();
    const index = indexFleet(data);
    const deposit = { id: "w1", amountCents: 40000, senderName: "B SY", atMs: 1, dateKey: "2026-11-25", pending: false, reason: "", bankLine: "" };
    const kinds = (claims: ClaimView[], b: FleetBankStatus | null) => needsItems({ data, index, todayKey: TODAY, claims, bank: b }).map((i) => i.kind);
    assert.ok(!kinds([claim({})], bank()).includes("claim"), "waiting on the bank with no matching deposit: not yet");
    assert.ok(kinds([claim({})], bank({ waiting: [deposit] })).includes("claim"), "a deposit of the same amount came in");
    assert.ok(kinds([claim({ state: "office" })], bank()).includes("claim"), "the server handed it to the office");
    assert.ok(!kinds([claim({ state: "asking_driver" })], bank()).includes("claim"), "still talking to the driver");
    assert.ok(kinds([], bank({ waiting: [deposit] })).includes("deposit"));
    assert.ok(!kinds([], bank({ waiting: [{ ...deposit, pending: true }] })).includes("deposit"), "a pending deposit can still change");
    const removed = needsItems({ data, index, todayKey: TODAY, claims: [], bank: bank({ removed: [{ paymentId: "p9", driverId: "d1", amountCents: 42500, paidDayKey: "2026-11-02", senderName: "A DIALLO" }] }) });
    assert.equal(removed[0].kind, "removed", "money already moved comes first at equal amounts");
  });
});

describe("parseDayWords", () => {
  it("reads the ways people write a day, never a future day without a year", () => {
    assert.equal(parseDayWords("Oct 3", TODAY), "2026-10-03");
    assert.equal(parseDayWords("october 3", TODAY), "2026-10-03");
    assert.equal(parseDayWords("3 oct", TODAY), "2026-10-03");
    assert.equal(parseDayWords("10/3", TODAY), "2026-10-03");
    assert.equal(parseDayWords("10/3/25", TODAY), "2025-10-03");
    assert.equal(parseDayWords("2026-10-03", TODAY), "2026-10-03");
    assert.equal(parseDayWords("Dec 20", TODAY), "2025-12-20", "no year and later than today: last year");
    assert.equal(parseDayWords("Feb 30", TODAY), "");
    assert.equal(parseDayWords("hello", TODAY), "");
  });
});

describe("plateOnDay", () => {
  it("names who had the plate that day, and the friend who drove it", () => {
    const data = sample();
    const index = indexFleet(data);
    const a = plateOnDay("T712000C Oct 3", data, index, TODAY);
    assert.equal(a?.driverName, "Old Driver");
    assert.equal(a?.fromDayKey, "2026-08-14");
    assert.equal(a?.toDayKey, "2026-11-16");
    const friend = plateOnDay("t123456c jul 5", data, index, TODAY);
    assert.equal(friend?.driverName, "Amadou Diallo");
    assert.equal(friend?.friendName, "Ibou Mbaye");
    const nobody = plateOnDay("T712000C Nov 20", data, index, TODAY);
    assert.equal(nobody?.driverId, "");
    assert.equal(plateOnDay("T000 Oct 3", data, index, TODAY), null, "an unknown plate");
    assert.equal(plateOnDay("T712000C", data, index, TODAY), null, "no date");
  });
});

describe("fleetSearch", () => {
  it("finds drivers by name, phone or plate and plates by plate or company", () => {
    const data = sample();
    const index = indexFleet(data);
    const rows = driverRows(data, index, TODAY);
    assert.deepEqual(fleetSearch("bako", data, index, rows).map((h) => h.kind === "driver" && h.id), ["d2"]);
    assert.ok(fleetSearch("T2222", data, index, rows).some((h) => h.kind === "plate" && h.id === "c2"));
    assert.equal(fleetSearch("dala", data, index, rows).filter((h) => h.kind === "plate").length, 2);
    assert.deepEqual(fleetSearch("", data, index, rows), []);
  });
});
