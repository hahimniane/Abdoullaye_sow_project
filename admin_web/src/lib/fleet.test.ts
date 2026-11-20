import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { translateValue } from "./french-dom.ts";

import {
  carRows,
  carsInPaperworkScope,
  carTimeline,
  daysBetween,
  dollarsToCents,
  driverDisplayName,
  driverLeaveConfirm,
  driverRows,
  estimateFeeEffectiveDay,
  driverTenure,
  driverTimeline,
  expiryState,
  fleetEnabled,
  fleetErrorMessage,
  fleetTiles,
  freeCars,
  indexFleet,
  matchesSearch,
  monthWindow,
  paperworkCounts,
  paperworkRows,
  parseCsv,
  plateFeesPaidLine,
  readPlateFeeInput,
  refreshedDayKey,
  shiftDayKey,
  paymentsGrid,
  readFleetSettings,
  readImportPreview,
  shiftMonth,
  tenureText,
  type FleetData,
} from "./fleet.ts";

const TODAY = "2026-11-11";

function sample(): FleetData {
  return {
    drivers: [
      { id: "d1", name: "Amadou Diallo", phone: "+19175550101", status: "active", creditCents: 0, personalCents: 7 },
      { id: "d2", name: "Bako Sy", phone: "+19175550102", status: "active", creditCents: 5000 },
      { id: "d3", name: "Old Driver", status: "left" },
      { id: "d4", name: "Cheick Ba", status: "left" },
    ],
    cars: [
      { id: "c1", plate: "T123456C", registrationExpiry: "2026-12-01", diamondExpiry: "2027-06-01" },
      { id: "c2", plate: "T222222C", registrationExpiry: "2026-10-01", diamondExpiry: "" },
      { id: "c3", plate: "T333333C", registrationExpiry: "2028-01-01", diamondExpiry: "2028-01-01" },
    ],
    assignments: [
      { id: "a1", carId: "c1", driverId: "d1", startDayKey: "2026-01-01", endDayKey: null, rentCents: 120000, period: "monthly" },
      { id: "a0", carId: "c1", driverId: "d3", startDayKey: "2025-01-01", endDayKey: "2025-12-31", rentCents: 100000, period: "monthly" },
      { id: "a2", carId: "c2", driverId: "d2", startDayKey: "2026-02-01", endDayKey: null, rentCents: 90000, period: "monthly" },
    ],
    bills: [
      { id: "b1", driverId: "d1", kind: "rent", status: "paid", amountCents: 120000, paidCents: 120000, dueDayKey: "2026-10-01" },
      { id: "b2", driverId: "d1", kind: "rent", status: "open", amountCents: 120000, paidCents: 0, dueDayKey: "2026-11-01" },
      { id: "b3", driverId: "d2", kind: "rent", status: "open", amountCents: 90000, paidCents: 30000, dueDayKey: "2026-11-01" },
      { id: "b4", driverId: "d2", kind: "rent", status: "open", amountCents: 90000, paidCents: 0, dueDayKey: "2026-10-01" },
      { id: "b5", driverId: "d2", kind: "rent", status: "waived", amountCents: 90000, paidCents: 0, dueDayKey: "2026-09-01" },
    ],
    payments: [
      { id: "p1", driverId: "d1", amountCents: 120000, status: "recorded", paidDayKey: "2026-09-28" },
      { id: "p2", driverId: "d2", amountCents: 30000, status: "recorded", paidDayKey: "2026-11-05" },
      { id: "p3", driverId: "d2", amountCents: 99900, status: "undone", paidDayKey: "2026-11-06" },
      { id: "p4", driverId: "d3", amountCents: 50000, status: "recorded", paidDayKey: "2026-06-01" },
    ],
  };
}

describe("months", () => {
  it("shifts across years and builds a window ending on the current month", () => {
    assert.equal(shiftMonth("2026-01", -1), "2025-12");
    assert.equal(shiftMonth("2026-11", 2), "2027-01");
    assert.deepEqual(monthWindow("2026-11", 3), ["2026-09", "2026-10", "2026-11"]);
  });
});

describe("payments grid", () => {
  const data = sample();
  const grid = paymentsGrid(data, monthWindow("2026-11", 3));
  const row = (id: string) => grid.rows.find((r) => r.driverId === id)!;

  it("colours a cell from that month's rent bills", () => {
    // d1: Sep paid with no bill (history) = full; Oct bill fully paid = full; Nov unpaid = owed.
    assert.deepEqual(row("d1").cells.map((c) => c.state), ["full", "full", "owed"]);
    // d2: Sep waived bill + no payment = none; Oct unpaid = owed; Nov part paid = part.
    assert.deepEqual(row("d2").cells.map((c) => c.state), ["none", "owed", "part"]);
  });

  it("sums only recorded payments by paid month, with totals", () => {
    assert.equal(row("d2").cells[2].paidCents, 30000);
    assert.deepEqual(grid.totals, [120000, 0, 30000]);
    assert.equal(grid.grandTotalCents, 150000);
  });

  it("hides a driver who left with nothing in the window, keeps one with activity", () => {
    assert.equal(grid.rows.find((r) => r.driverId === "d3"), undefined);
    assert.equal(grid.rows.find((r) => r.driverId === "d4"), undefined);
    const wide = paymentsGrid(data, monthWindow("2026-11", 6));
    assert.ok(wide.rows.find((r) => r.driverId === "d3"));
  });
});

describe("tiles, drivers and cars", () => {
  const data = sample();
  const index = indexFleet(data);

  it("counts collected this month, owed now and late drivers", () => {
    assert.deepEqual(fleetTiles(data, index, TODAY), { collectedCents: 30000, owedCents: 120000 + 60000 + 90000, lateDrivers: 2, lateCents: 270000, owingDrivers: 2, plateFeesBilledCents: 210000, plateFeesPaidCents: 30000 });
  });

  it("lists drivers with their car and owed", () => {
    const rows = driverRows(data, index, TODAY);
    assert.equal(rows[0].name, "Amadou Diallo");
    assert.equal(rows[0].plate, "T123456C");
    assert.equal(rows[0].owedCents, 120000);
    // An old record that still carries personalCents reads without error and shows nothing.
    assert.equal("personalCents" in rows[0], false);
    assert.equal(rows[1].creditCents, 5000);
    assert.ok(matchesSearch(rows[0].search, "t1234 amadou"));
    assert.ok(!matchesSearch(rows[0].search, "bako"));
    assert.deepEqual(rows.slice(2).map((r) => r.status), ["left", "left"]);
  });

  it("knows which cars are free and who had a car when", () => {
    assert.deepEqual(freeCars(data, index).map((c) => c.id), ["c3"]);
    const timeline = carTimeline("c1", index);
    assert.deepEqual(timeline.map((t) => [t.driverName, t.endDayKey]), [["Amadou Diallo", ""], ["Old Driver", "2025-12-31"]]);
  });
});

describe("paperwork", () => {
  it("states expiry as expired, soon (60 days), missing or ok", () => {
    assert.equal(expiryState("2026-11-10", TODAY), "expired");
    assert.equal(expiryState("2026-11-11", TODAY), "soon");
    assert.equal(expiryState("2027-01-10", TODAY), "soon");
    assert.equal(expiryState("2027-01-11", TODAY), "ok");
    assert.equal(expiryState("", TODAY), "missing");
    assert.equal(expiryState(null, TODAY), "missing");
  });

  it("sorts cars by the soonest of the two dates, undated last, and counts the worst state", () => {
    const data = sample();
    data.cars.push({ id: "c4", plate: "T444444C" });
    const rows = paperworkRows(carRows(data, indexFleet(data), TODAY));
    assert.deepEqual(rows.map((r) => r.plate), ["T222222C", "T123456C", "T333333C", "T444444C"]);
    assert.deepEqual(rows.map((r) => r.worst), ["expired", "soon", "ok", "missing"]);
    assert.deepEqual(paperworkCounts(rows), { expired: 1, soon: 1, missing: 1, ok: 1 });
  });
});

describe("money and codes", () => {
  it("reads typed dollars", () => {
    assert.equal(dollarsToCents("1,200.50"), 120050);
    assert.equal(dollarsToCents("$75"), 7500);
    assert.equal(dollarsToCents("0.5"), 50);
    assert.equal(dollarsToCents("abc"), null);
    assert.equal(dollarsToCents("1.234"), null);
    assert.equal(dollarsToCents(""), null);
  });

});

describe("settings and refusals", () => {
  it("defaults drivers-see-only to on", () => {
    assert.equal(readFleetSettings({}).driversSeeOnly, true);
    assert.equal(readFleetSettings({ fleet: { settings: { driversSeeOnlyThisBusiness: false } } }).driversSeeOnly, false);
    assert.equal(
      readFleetSettings({ fleet: { settings: { returnRule: "days", lateFee: { cents: 2500, dayOfMonth: 8, firstMonth: "2026-12" } } } })
        .lateFeeFirstMonth,
      "2026-12",
    );
  });

  it("is on by the flag or the service", () => {
    assert.equal(fleetEnabled({ fleet: { enabled: true } }), true);
    assert.equal(fleetEnabled({ enabledServices: ["fleet"] }), true);
    assert.equal(fleetEnabled({ enabledServices: ["carParking"] }), false);
    assert.equal(fleetEnabled(null), false);
  });

  it("maps a refusal reason to its sentence", () => {
    assert.equal(fleetErrorMessage({ details: { reason: "fleet_car_taken" }, message: "x" }), "This plate already has a driver. Get it back first.");
    assert.equal(fleetErrorMessage({ message: "boom" }), "boom");
    assert.equal(fleetErrorMessage(null), "Something went wrong. Try again.");
  });
});

describe("parseCsv", () => {
  it("splits plain rows and ignores the trailing newline and BOM", () => {
    assert.deepEqual(parseCsv("﻿a,b,c\n1,2,3\n"), [["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("keeps quoted commas, doubled quotes and line breaks inside a field", () => {
    assert.deepEqual(parseCsv('name,note\n"Diallo, Amadou","said ""hi""\nthen left"\n'), [
      ["name", "note"],
      ["Diallo, Amadou", 'said "hi"\nthen left'],
    ]);
  });

  it("reads CRLF and CR endings, empty cells and a last row without a newline", () => {
    assert.deepEqual(parseCsv("a,,c\r\n,,\r\nx,y,z"), [["a", "", "c"], ["", "", ""], ["x", "y", "z"]]);
    assert.deepEqual(parseCsv("a,b\rc,d"), [["a", "b"], ["c", "d"]]);
  });

  it("keeps empty rows in the middle and drops empty rows at the end", () => {
    assert.deepEqual(parseCsv("a\n\nb\n,\n\n"), [["a"], [""], ["b"]]);
  });

  it("reads a quoted empty field and an empty file", () => {
    assert.deepEqual(parseCsv('"",x'), [["", "x"]]);
    assert.deepEqual(parseCsv(""), []);
  });
});

describe("import preview", () => {
  it("reads counts, totals and warnings, and tolerates a missing answer", () => {
    const p = readImportPreview({
      counts: { drivers: 94, cars: 77, assignments: 90, payments: 2760, bills: 19 },
      totals: { paymentsCents: 86326500, ownedBillsCents: 1000 },
      warnings: [{ row: 5, field: "phone", message: "Not a phone number" }],
    });
    assert.equal(p.payments, 2760);
    assert.equal(p.paymentsCents, 86326500);
    assert.deepEqual(p.warnings, [{ row: 5, field: "phone", message: "Not a phone number" }]);
    assert.equal(readImportPreview(null).drivers, 0);
  });
});

describe("driver profile: tenure", () => {
  const A = (startDayKey: string, endDayKey: string | null) => ({ id: startDayKey, startDayKey, endDayKey }) as never;

  it("joined is the first start; days add up, gaps do not count", () => {
    const t = driverTenure([A("2023-01-01", "2023-12-31"), A("2024-06-01", null)], "2026-11-11");
    assert.equal(t.joinedDayKey, "2023-01-01");
    assert.equal(t.days, 364 + daysBetween("2024-06-01", "2026-11-11"));
  });

  it("overlapping assignments are counted once", () => {
    assert.equal(driverTenure([A("2026-01-01", "2026-03-01"), A("2026-02-01", "2026-04-01")], TODAY).days, 90);
  });

  it("no assignment: no join date and 0 days", () => {
    assert.deepEqual(driverTenure([], TODAY), { joinedDayKey: "", days: 0 });
  });

  it("reads as years and months, in both languages", () => {
    assert.equal(tenureText(365 * 3 + 62), "3 years 2 months");
    assert.equal(tenureText(365 * 3 + 62, "fr"), "3 ans 2 mois");
    assert.equal(tenureText(365), "1 year");
    assert.equal(tenureText(31), "1 month");
    assert.equal(tenureText(12), "12 days");
    assert.equal(tenureText(12, "fr"), "12 jours");
    assert.equal(tenureText(1), "1 day");
  });
});

describe("driver profile: track record", () => {
  function build() {
    const data: FleetData = {
      drivers: [{ id: "d1", name: "Amadou", licenseHistory: [{ license: "5000001", fromDayKey: "2023-01-05", toDayKey: "2025-02-10" }] }],
      cars: [
        { id: "c1", plate: "T111111C" },
        { id: "c2", plate: "T222222C" },
      ],
      assignments: [
        { id: "a1", carId: "c1", driverId: "d1", startDayKey: "2023-01-01", endDayKey: "2024-01-31", rentCents: 100000, period: "monthly" },
        { id: "a2", carId: "c2", driverId: "d1", startDayKey: "2024-02-10", endDayKey: "2024-12-31", rentCents: 110000, period: "monthly" },
        { id: "a3", carId: "c2", driverId: "d1", startDayKey: "2025-06-01", endDayKey: null, rentCents: 110000, period: "monthly" },
      ],
      bills: [
        { id: "b1", driverId: "d1", kind: "late_fee", status: "paid", label: "Late fee", amountCents: 2500, dueDayKey: "2025-07-10" },
        { id: "b2", driverId: "d1", kind: "charge", status: "open", label: "Tow", amountCents: 6500, dueDayKey: "2025-08-01" },
        { id: "b3", driverId: "d1", kind: "rent", status: "waived", label: "Rent", amountCents: 110000, dueDayKey: "2025-09-01", waived: { atMs: Date.UTC(2025, 8, 5, 16), reason: "Office mistake" } },
      ],
      payments: [],
      notes: [
        { id: "n1", driverId: "d1", text: "Signed agreement", files: [{ path: "p", name: "a.pdf", contentType: "application/pdf", size: 5 }], atMs: Date.UTC(2025, 9, 1, 16), byName: "Fleet Staff" },
        { id: "n2", driverId: "d1", text: "Wrong note", atMs: Date.UTC(2025, 9, 2, 16), voided: { byUid: "x" } },
      ],
      substitutes: [
        { id: "s1", driverId: "d1", carId: "c2", name: "Friend One", fromDayKey: "2025-07-01", toDayKey: "2025-07-05" },
        { id: "s2", driverId: "d1", carId: "c2", name: "Gone Friend", fromDayKey: "2025-07-20", toDayKey: "2025-07-21", voided: true },
      ],
    };
    return { data, index: indexFleet(data) };
  }

  it("joined, cars given and returned, rent change, left and back", () => {
    const { data, index } = build();
    const t = driverTimeline(data.drivers[0], index);
    const kinds = (k: string) => t.filter((e) => e.kind === k);
    assert.equal(kinds("joined").length, 1);
    assert.equal(kinds("joined")[0].plate, "T111111C");
    assert.equal(kinds("car_given").length, 3);
    assert.deepEqual(kinds("car_returned").map((e) => e.dayKey), ["2024-12-31", "2024-01-31"]);
    assert.deepEqual(kinds("rent_change").map((e) => [e.fromRentCents, e.rentCents]), [[100000, 110000]]);
    // 2024-12-31 -> 2025-06-01 is more than 30 days; 2024-01-31 -> 2024-02-10 is not.
    assert.deepEqual(kinds("left_back").map((e) => [e.leftDayKey, e.dayKey]), [["2024-12-31", "2025-06-01"]]);
  });

  it("license history, friends (not voided), money events", () => {
    const { data, index } = build();
    const t = driverTimeline(data.drivers[0], index);
    assert.deepEqual(t.filter((e) => e.kind === "license").map((e) => [e.license, e.fromDayKey, e.toDayKey]), [["5000001", "2023-01-05", "2025-02-10"]]);
    assert.deepEqual(t.filter((e) => e.kind === "friend").map((e) => [e.name, e.plate, e.fromDayKey, e.toDayKey]), [["Friend One", "T222222C", "2025-07-01", "2025-07-05"]]);
    assert.equal(t.filter((e) => e.kind === "late_fee")[0].amountCents, 2500);
    assert.equal(t.filter((e) => e.kind === "charge")[0].label, "Tow");
    const waived = t.filter((e) => e.kind === "waived")[0];
    assert.equal(waived.dayKey, "2025-09-05");
    assert.equal(waived.text, "Office mistake");
  });

  it("notes keep voided ones (greyed) and everything is newest first", () => {
    const { data, index } = build();
    const t = driverTimeline(data.drivers[0], index, [
      { id: "x1", action: "fleet_driver_saved", atMs: Date.UTC(2025, 10, 1, 16) },
      { id: "x2", action: "fleet_note_added", atMs: Date.UTC(2025, 10, 2, 16) },
    ]);
    const notes = t.filter((e) => e.kind === "note");
    assert.deepEqual(notes.map((n) => [n.noteId, n.voided]), [["n2", true], ["n1", false]]);
    assert.equal(notes[1].files?.length, 1);
    assert.equal(t.filter((e) => e.kind === "edit").length, 1, "only the actions worth showing");
    const days = t.map((e) => e.dayKey);
    assert.deepEqual(days, [...days].sort().reverse());
    assert.equal(t[0].kind, "edit");
  });

  it("a driver with no records has an empty record", () => {
    const data: FleetData = { drivers: [{ id: "d9", name: "New" }], cars: [], assignments: [], bills: [], payments: [] };
    assert.deepEqual(driverTimeline(data.drivers[0], indexFleet(data)), []);
  });

  it("friends show under the driver on the car's timeline", () => {
    const { index } = build();
    const t = carTimeline("c2", index);
    const withFriend = t.find((e) => e.id === "a3")!;
    assert.deepEqual(withFriend.friends.map((f) => f.name), ["Friend One"]);
    assert.deepEqual(t.find((e) => e.id === "a2")!.friends, []);
  });
});

describe("plates and the cars on them", () => {
  it("the car now first, then the earlier ones, newest first", async () => {
  const { plateCarHistory } = await import("./fleet.ts");
  assert.deepEqual(plateCarHistory(null), []);
  assert.deepEqual(plateCarHistory({ plate: "T1" }), [], "a plate with no car recorded");
  const rows = plateCarHistory({
    vehicleType: "Honda Accord 2022", vin: "2B", ownership: "driver", vehicleSince: "2026-12-10",
    vehicleHistory: [
      { vehicleType: "Toyota Camry 2019", vin: "1A", ownership: "driver", fromDayKey: "2026-01-05", toDayKey: "2026-06-01" },
      { vehicleType: "Nissan Altima 2020", vin: "9Z", ownership: "company", fromDayKey: "2026-06-01", toDayKey: "2026-12-10" },
      null, { vehicleType: "", vin: "" },
    ],
  });
  assert.deepEqual(rows.map((r) => [r.vehicleType, r.vin, r.ownership, r.fromDayKey, r.toDayKey]), [
    ["Honda Accord 2022", "2B", "driver", "2026-12-10", ""],
    ["Nissan Altima 2020", "9Z", "company", "2026-06-01", "2026-12-10"],
    ["Toyota Camry 2019", "1A", "driver", "2026-01-05", "2026-06-01"],
  ]);
});

  it("Fleet speaks of plates, in French too", async () => {
  const { translateValue } = await import("./french-dom.ts");
  for (const english of [
    "Plates", "Plates and who has them", "Add plate", "Edit plate", "Save plate", "All plates", "Who had this plate",
    "Give a plate", "Give the plate", "Plate returned", "Current plate", "No plate right now.", "Choose a plate…",
    "This plate already has a driver. Get it back first.", "Car on this plate", "Cars this plate has been on",
    "The plate moved to another car", "Same car: I am fixing a mistake", "Whose car",
    "Say whether the plate moved to another car or you are fixing a mistake.",
  ]) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});
});

describe("S1: the plate-fee share", () => {
  it("is the paid share of this month's rent bills, not collected money over everything billed", () => {
    const data = sample();
    // An old debt paid this month, a late fee and a charge due this month, a void and a waived rent bill.
    data.payments.push({ id: "p9", driverId: "d2", amountCents: 500000, status: "recorded", paidDayKey: "2026-11-03" });
    data.bills.push(
      { id: "f1", driverId: "d2", kind: "late_fee", status: "open", amountCents: 2500, paidCents: 0, dueDayKey: "2026-11-08" },
      { id: "c1", driverId: "d1", kind: "charge", status: "open", amountCents: 7000, paidCents: 0, dueDayKey: "2026-11-02" },
      { id: "v1", driverId: "d1", kind: "rent", status: "void", amountCents: 99900, paidCents: 0, dueDayKey: "2026-11-01" },
      { id: "w1", driverId: "d1", kind: "rent", status: "waived", amountCents: 88800, paidCents: 0, dueDayKey: "2026-11-01" },
    );
    const tiles = fleetTiles(data, indexFleet(data), TODAY);
    assert.equal(tiles.collectedCents, 530000);
    assert.equal(tiles.plateFeesBilledCents, 210000);
    assert.equal(tiles.plateFeesPaidCents, 30000);
  });

  it("words the line with both amounts, in both languages", () => {
    assert.equal(plateFeesPaidLine(1510000, 1190000), "79% of this month's plate fees paid ($11,900 of $15,100)");
    assert.equal(plateFeesPaidLine(1510000, 1190000, "fr"), "79 % des frais de plaque de ce mois payés (11\u202f900 $ sur 15\u202f100 $)");
    assert.equal(plateFeesPaidLine(210000, 30050), "14% of this month's plate fees paid ($300.50 of $2,100)");
    assert.equal(plateFeesPaidLine(100000, 150000), "100% of this month's plate fees paid ($1,000 of $1,000)");
  });
});

describe("S2: the payments grid cell", () => {
  const months = monthWindow("2026-11", 3);
  const build = (bills: Record<string, unknown>[], payments: Record<string, unknown>[]) =>
    paymentsGrid({ drivers: [{ id: "d1", name: "A", status: "active" }], cars: [], assignments: [], bills: bills as never, payments: payments as never }, months).rows[0].cells;

  it("colours a month that has a rent bill from that bill only, even when a payment landed that month", () => {
    // A payment for an old debt landed in November; November's bill has nothing on it.
    const cells = build(
      [{ id: "b", driverId: "d1", kind: "rent", status: "open", amountCents: 100000, paidCents: 0, dueDayKey: "2026-11-01" }],
      [{ id: "p", driverId: "d1", amountCents: 40000, status: "recorded", paidDayKey: "2026-11-04" }],
    );
    assert.equal(cells[2].state, "owed");
    assert.equal(cells[2].paidCents, 40000, "the number shown stays what was received that month");
  });

  it("is part paid by the bill's paidCents and full when it covers the amount", () => {
    const cells = build(
      [
        { id: "b1", driverId: "d1", kind: "rent", status: "open", amountCents: 100000, paidCents: 25000, dueDayKey: "2026-10-01" },
        { id: "b2", driverId: "d1", kind: "rent", status: "paid", amountCents: 100000, paidCents: 100000, dueDayKey: "2026-11-01" },
      ],
      [],
    );
    assert.deepEqual(cells.map((c) => c.state), ["none", "part", "full"]);
  });

  it("calls a month with payments and no bill paid, and one with neither empty", () => {
    const cells = build([], [{ id: "p", driverId: "d1", amountCents: 100000, status: "recorded", paidDayKey: "2026-09-12" }]);
    assert.deepEqual(cells.map((c) => c.state), ["full", "none", "none"]);
  });

  it("marks a late fee or charge still owed in the month without changing the colour", () => {
    const cells = build(
      [
        { id: "b", driverId: "d1", kind: "rent", status: "paid", amountCents: 100000, paidCents: 100000, dueDayKey: "2026-10-01" },
        { id: "f", driverId: "d1", kind: "late_fee", status: "open", amountCents: 2500, paidCents: 500, dueDayKey: "2026-10-08" },
        { id: "c", driverId: "d1", kind: "charge", status: "open", amountCents: 7000, paidCents: 0, dueDayKey: "2026-09-20" },
        { id: "g", driverId: "d1", kind: "late_fee", status: "paid", amountCents: 2500, paidCents: 2500, dueDayKey: "2026-11-08" },
        { id: "h", driverId: "d1", kind: "charge", status: "void", amountCents: 900, paidCents: 0, dueDayKey: "2026-11-08" },
      ],
      [],
    );
    assert.deepEqual(cells.map((c) => c.extraOwedCents), [7000, 2000, 0]);
    assert.equal(cells[1].state, "full");
    assert.equal(cells[0].state, "none");
  });

  it("keeps a driver who left and still owes a charge in the window", () => {
    const grid = paymentsGrid(
      { drivers: [{ id: "d9", name: "Gone", status: "left" }], cars: [], assignments: [], bills: [{ id: "c", driverId: "d9", kind: "charge", status: "open", amountCents: 500, paidCents: 0, dueDayKey: "2026-11-02" }] as never, payments: [] },
      months,
    );
    assert.equal(grid.rows.length, 1);
  });
});

describe("S3: paperwork scope", () => {
  it("counts only plates with a driver by default and every plate on request", () => {
    const data = sample();
    data.cars.push({ id: "c4", plate: "T444444C" });
    const cars = carRows(data, indexFleet(data), TODAY);
    const withDriver = carsInPaperworkScope(cars, "driver");
    assert.deepEqual(withDriver.map((c) => c.plate).sort(), ["T123456C", "T222222C"]);
    assert.deepEqual(paperworkCounts(paperworkRows(withDriver)), { expired: 1, soon: 1, missing: 0, ok: 0 });
    assert.deepEqual(paperworkCounts(paperworkRows(carsInPaperworkScope(cars, "all"))), { expired: 1, soon: 1, missing: 1, ok: 1 });
  });
});

describe("S4: the New York day key", () => {
  it("keeps the same string within a day and moves at New York midnight", () => {
    const held = "2026-11-10";
    assert.equal(refreshedDayKey(held, new Date("2026-11-11T04:59:59Z")), held); // 11:59:59 PM EST
    assert.equal(refreshedDayKey(held, new Date("2026-11-11T05:00:00Z")), "2026-11-11"); // midnight EST
    assert.equal(refreshedDayKey("2026-07-04", new Date("2026-07-05T03:59:59Z")), "2026-07-04"); // EDT
    assert.equal(refreshedDayKey("2026-07-04", new Date("2026-07-05T04:00:00Z")), "2026-07-05");
  });
});

describe("S5: plate fee and leaving", () => {
  const current = { rentCents: 120000, dueDay: 5, period: "monthly" };

  it("sends only what changed and refuses nothing-changed or bad numbers", () => {
    assert.deepEqual(readPlateFeeInput("1,300", "", current), { ok: true, payload: { rentCents: 130000 } });
    assert.deepEqual(readPlateFeeInput("1200", "10", current), { ok: true, payload: { dueDay: 10 } });
    assert.deepEqual(readPlateFeeInput("1300", "10", current), { ok: true, payload: { rentCents: 130000, dueDay: 10 } });
    assert.equal(readPlateFeeInput("1200", "5", current).ok, false);
    assert.equal(readPlateFeeInput("", "5", current).ok, false);
    assert.equal(readPlateFeeInput("abc", "", current).ok, false);
    assert.equal(readPlateFeeInput("1300", "29", current).ok, false);
    assert.equal(readPlateFeeInput("1300", "0", current).ok, false);
    assert.equal(readPlateFeeInput("1300", "2.5", current).ok, false);
    assert.equal(readPlateFeeInput("1300", "7", { ...current, period: "weekly" }).ok, true);
    assert.equal(readPlateFeeInput("1300", "8", { ...current, period: "weekly" }).ok, false);
  });

  it("estimates the first period with no bill yet", () => {
    const a = { id: "a1", startDayKey: "2026-01-01", endDayKey: null, period: "monthly", dueDay: 5, rentCents: 100 };
    const bills = [
      { id: "a1_2026-10-01" },
      { id: "a1_2026-11-01" },
    ] as never;
    // Jan-Sep periods have no bill in this list, so the first gap is Jan 1: a real list has them all.
    const all = Array.from({ length: 11 }, (_, i) => ({ id: `a1_2026-${String(i + 1).padStart(2, "0")}-01` })) as never;
    assert.equal(estimateFeeEffectiveDay(a, all, "2026-11-11"), "2026-12-01");
    assert.equal(estimateFeeEffectiveDay(a, bills, "2026-11-11"), "2026-01-01");
    assert.equal(shiftDayKey("2026-12-25", 10), "2027-01-04");
  });

  it("words the refusals", () => {
    assert.equal(fleetErrorMessage({ details: { reason: "fleet_driver_has_plate" } }), "This driver still has a plate. Get it back first, or ask a Fleet admin to use Driver has left.");
    assert.equal(fleetErrorMessage({ details: { reason: "fleet_already_returned" } }), "This plate was already returned.");
    assert.equal(fleetErrorMessage({ details: { reason: "fleet_car_overlap" } }), "This plate was with another driver until that day. Pick a later start day.");
    assert.equal(fleetErrorMessage({ details: { reason: "fleet_admin_only" } }), "Only a Fleet admin can do this.");
    assert.equal(fleetErrorMessage({ details: { reason: "fleet_bad_input" } }), "Some details are missing or not valid.");
    assert.equal(fleetErrorMessage({ details: { reason: "fleet_not_found" } }), "That record was not found.");
  });

  it("addresses the driver by display name in the leave confirm", () => {
    const c = driverLeaveConfirm("ABU HASSAN (25)", "T123456C", "Nov 11, 2026");
    assert.equal(c.en, "Mark ABU HASSAN as having left on Nov 11, 2026? Plate T123456C comes back on that date and bills stop.");
    assert.match(c.fr, /^Marquer ABU HASSAN comme parti le Nov 11, 2026/);
    assert.equal(driverLeaveConfirm("Bako", "", "x").en, "Mark Bako as having left on x? Bills stop.");
  });
});

describe("S6: driverDisplayName", () => {
  const cases: [string, string][] = [
    ["Fawaz #9", "Fawaz"],
    ["ABU HASSAN (25)", "ABU HASSAN"],
    ["Amadou Diallo #49 STORAGE 2/14/25", "Amadou Diallo"],
    ["Dorjee Tenzin T (26) Drop it 08/25/2025 at 12:55 Pm", "Dorjee Tenzin T"],
    ["IDY # 50", "IDY"],
    ["KHUSRAV # (26)", "KHUSRAV"],
    ["Bako Sy", "Bako Sy"],
    ["  Bako   Sy  ", "Bako Sy"],
    ["Mamadou voir folder 12", "Mamadou"],
    ["Mamadou VOIR  FOLDER", "Mamadou"],
    ["Ali drop", "Ali"],
    ["Ali storage", "Ali"],
    ["Dropo Kone", "Dropo Kone"],
    ["Storageman", "Storageman"],
    ["Sam (25) Jones", "Sam (25) Jones"],
  ];
  for (const [input, expected] of cases) {
    it(JSON.stringify(input), () => assert.equal(driverDisplayName(input), expected));
  }
  it("falls back to the full name when nothing would be left", () => {
    assert.equal(driverDisplayName("#46"), "#46");
    assert.equal(driverDisplayName("(25)"), "(25)");
    assert.equal(driverDisplayName("STORAGE 2/14/25"), "STORAGE 2/14/25");
    assert.equal(driverDisplayName(""), "");
    assert.equal(driverDisplayName(null), "");
  });
  it("is idempotent", () => {
    for (const [input] of cases) assert.equal(driverDisplayName(driverDisplayName(input)), driverDisplayName(input));
  });
});

describe("French for the new fleet screen strings", () => {
  const strings = [
    "Plates with a driver", "Every plate", "Which plates", "+ fee owed", "A late fee or charge is still owed this month",
    "Driver has left", "Change plate fee", "Save plate fee", "New plate fee a month ($)", "New plate fee a week ($)",
    "Due weekday, optional (1 = Monday … 7 = Sunday)", "Due day of the month, optional (1–28)", "Applies from",
    "Bills already made are not changed.", "The plate comes back on this date and bills stop.", "Bills stop on this date.",
    "The driver is marked as left. Their plate came back and their bills stopped.", "Nothing was changed.",
    "This driver still has a plate. Get it back first, or ask a Fleet admin to use Driver has left.", "This plate was already returned.",
    "This plate was with another driver until that day. Pick a later start day.",
  ];
  for (const english of strings) {
    it(english, () => assert.notEqual(translateValue(english, "fr"), english));
  }
});
