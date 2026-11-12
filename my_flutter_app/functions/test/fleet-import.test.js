"use strict";

// docs/FLEET.md section 5. SYNTHETIC data only: no real people, plates or
// phones belong in this file.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  FLEET_SHEET_MONTHS,
  parseFleetSheet,
  parseLooseDate,
} = require("../fleet_import");

const HEADER_HEAD = [
  "COMPANY", "START DATE", "END DATE", "Driver", "PHONE", "DROP", "Base",
  "POLYCY#", "Plate", "Vehicle type", "Lic", "Vin", "REG EXP", "DIAM EXP",
  "Ins. Company", "Monthly Ins. pymt", "Autopay", "Due Date",
  "Ins. In charge paymt", "Car Ownership", "Plate fee",
];
const TAIL = ["info 450", "ins", "Fleet2", "Fleet 26", "TOTAL", "Fleet23"];
const WIDTH = 91 + TAIL.length;

const colOf = (month, nth = 0) =>
  Number(Object.keys(FLEET_SHEET_MONTHS)
      .filter((c) => FLEET_SHEET_MONTHS[c] === month)[nth]);

const header = () => {
  const h = new Array(WIDTH).fill("");
  HEADER_HEAD.forEach((t, i) => (h[i] = t));
  for (const c of Object.keys(FLEET_SHEET_MONTHS)) h[c] = `m${c}`;
  TAIL.forEach((t, i) => (h[91 + i] = t));
  return h;
};

/**
 * @param {!Object} f Named fields and {months: {"YYYY-MM": value}}.
 * @return {!Array<string>} A sheet row.
 */
function row(f) {
  const r = new Array(WIDTH).fill("");
  const set = (i, v) => (r[i] = v === undefined ? "" : String(v));
  set(0, f.company); set(1, f.start); set(2, f.end); set(3, f.name);
  set(4, f.phone); set(5, f.drop); set(7, f.policy); set(8, f.plate);
  set(9, f.type); set(10, f.lic); set(11, f.vin); set(12, f.reg);
  set(13, f.diam); set(14, f.insurer); set(15, f.premium);
  set(16, f.autopay); set(17, f.dueDay); set(18, f.paidBy);
  set(19, f.owner); set(20, f.fee);
  for (const [month, value] of Object.entries(f.months || {})) {
    const list = Array.isArray(value) ? value : [value];
    list.forEach((v, nth) => set(colOf(month, nth), v));
  }
  // Tail columns must never count.
  r[91] = "9999"; r[95] = "$12,345";
  return r;
}

const sheet = () => [
  header(),
  // row 2: multi-column early month, a <50 value, paid Oct+Nov 2026.
  row({
    company: "L&A", start: "10/5/2021", name: "Test Driver A",
    phone: "(212) 555-0100", plate: "t000001c", type: "Camry",
    vin: "TESTVIN0000000001", reg: "3/4/2026", diam: "12/31/26",
    insurer: " hereford ins ", premium: "$450.50", autopay: "Yes",
    dueDay: "15", paidBy: "Company", owner: "", fee: "$1,000", lic: "T1",
    policy: "POL-A", months: {
      "2021-10": ["600", "400"], "2021-11": "49", "2026-10": "1,000",
      "2026-11": "1,200",
    },
  }),
  // row 3: owes Oct 2026 ("0"), pays Nov 2026 less than the fee.
  row({
    company: "L&A", start: "1/2/22", name: "Test Driver B",
    phone: "+1 212-555-0101", plate: "T000002C", insurer: "AMERICAN TRANSIT",
    owner: "Owner", fee: "800", months: {"2026-10": "0", "2026-11": "300"},
  }),
  // row 4: gave up (1 marker), no end date.
  row({
    start: "2/1/2023", name: "Test Driver C", phone: "2125550102",
    plate: "T000003C", fee: "700",
    months: {"2026-08": "700", "2026-09": "700", "2026-10": "1"},
  }),
  // row 5: same driver as row 2 (same phone), a second car, new assignment.
  row({
    start: "2026-11-02", name: "Test Driver A", phone: "212.555.0100",
    plate: "T000004C", fee: "900", months: {"2026-11": "900"},
  }),
  // row 6: missing plate: payment kept, warning.
  row({
    start: "3/3/2024", name: "Test Driver D", phone: "2125550103",
    months: {"2026-11": "500"},
  }),
  // row 7: no phone (keyed by name), no start date, bad drop date, ended.
  row({
    name: "Test Driver E", plate: "T000005C", fee: "650", drop: "garbage",
    end: "6/30/2026", months: {"2026-05": "650", "2026-06": "650"},
  }),
];

const find = (list, key) => list.find((x) => x.importKey === key);

describe("fleet import: months and dates", () => {
  it("maps the early multi-column months and the long tail", () => {
    assert.equal(FLEET_SHEET_MONTHS[21], "2021-10");
    assert.equal(FLEET_SHEET_MONTHS[22], "2021-10");
    assert.equal(FLEET_SHEET_MONTHS[24], "2021-11");
    assert.equal(FLEET_SHEET_MONTHS[27], "2022-01");
    assert.equal(FLEET_SHEET_MONTHS[32], "2022-01");
    assert.equal(FLEET_SHEET_MONTHS[33], "2022-02");
    assert.equal(FLEET_SHEET_MONTHS[44], "2023-01");
    assert.equal(FLEET_SHEET_MONTHS[89], "2026-10");
    assert.equal(FLEET_SHEET_MONTHS[90], "2026-11");
    assert.equal(FLEET_SHEET_MONTHS[91], undefined);
  });

  it("parses loose dates", () => {
    assert.equal(parseLooseDate("3/4/2026"), "2026-03-04");
    assert.equal(parseLooseDate("3/4/26"), "2026-03-04");
    assert.equal(parseLooseDate("2026-03-04"), "2026-03-04");
    assert.equal(parseLooseDate("Mar 4, 2026"), "2026-03-04");
    assert.equal(parseLooseDate("2/30/2026"), null);
    assert.equal(parseLooseDate("soon"), null);
    assert.equal(parseLooseDate(""), null);
  });
});

describe("fleet import: payments", () => {
  const out = parseFleetSheet(sheet());

  it("counts two columns in one month as two payments", () => {
    const early = out.payments.filter((p) => p.paidDayKey === "2021-10-01");
    assert.deepEqual(early.map((p) => p.amountCents), [60000, 40000]);
    assert.deepEqual(early.map((p) => p.importKey),
        ["pay:2:21", "pay:2:22"]);
    assert.deepEqual(out.totals.byMonth["2021-10"], {cents: 100000, count: 2});
  });

  it("ignores values under 50, 0, 1 and the tail columns", () => {
    assert.equal(out.payments.some((p) => p.paidDayKey === "2021-11-01"),
        false);
    assert.equal(out.totals.paymentCount, 11);
    assert.equal(out.totals.paymentsCents,
        100000 + 100000 + 120000 + 30000 + 70000 + 70000 + 90000 + 50000 +
        65000 + 65000);
  });

  it("totals by year", () => {
    assert.equal(out.totals.byYear["2021"], 100000);
    assert.equal(out.totals.byYear["2026"], 100000 + 120000 + 30000 + 70000 +
      70000 + 90000 + 50000 + 65000 + 65000);
  });

  it("links payments to driver, car and assignment by import key", () => {
    const p = find(out.payments, "pay:2:89");
    assert.equal(p.driverKey, "drv:2125550100");
    assert.equal(p.assignmentKey, "asg:2");
    assert.equal(p.carKey, "car:T000001C");
    assert.equal(p.method, "import");
    assert.equal(p.imported, true);
  });

  it("keeps a payment on a row with no plate, without a car", () => {
    const p = find(out.payments, `pay:6:90`);
    assert.equal(p.assignmentKey, null);
    assert.equal(p.carKey, null);
    assert.equal(p.amountCents, 50000);
    assert.ok(out.warnings.some((w) => w.row === 6 && w.field === "plate"));
  });
});

describe("fleet import: drivers, cars, assignments", () => {
  const out = parseFleetSheet(sheet());

  it("makes one driver for two rows with the same phone", () => {
    const a = out.drivers.filter((d) => d.importKey === "drv:2125550100");
    assert.equal(a.length, 1);
    assert.equal(a[0].phone, "+12125550100");
    assert.equal(a[0].tlcLicense, "T1");
    assert.equal(a[0].status, "active");
    const mine = out.assignments.filter(
        (x) => x.driverKey === "drv:2125550100");
    assert.deepEqual(mine.map((x) => x.importKey), ["asg:2", "asg:5"]);
    assert.equal(out.totals.driverCount, 5);
  });

  it("keys a driver without a phone by lower-cased name", () => {
    const e = find(out.drivers, "drv:test driver e");
    assert.equal(e.phone, "");
    assert.equal(e.status, "left");
    assert.ok(out.warnings.some((w) => w.row === 7 && w.field === "phone"));
  });

  it("builds cars from unique upper-cased plates", () => {
    assert.equal(out.totals.carCount, 5);
    const car = find(out.cars, "car:T000001C");
    assert.equal(car.plate, "T000001C");
    assert.equal(car.company, "L&A");
    assert.equal(car.vehicleType, "Camry");
    assert.equal(car.vin, "TESTVIN0000000001");
    assert.equal(car.registrationExpiry, "2026-03-04");
    assert.equal(car.diamondExpiry, "2026-12-31");
    assert.equal(car.insurer, "Hereford");
    assert.equal(car.policyNumber, "POL-A");
    assert.equal(car.premiumCents, 45050);
    assert.equal(car.insuranceDueDay, 15);
    assert.equal(car.insuranceAutopay, true);
    assert.equal(car.insurancePaidBy, "Company");
    assert.equal(car.ownership, "company");
    assert.equal(car.status, "active");
    assert.equal(find(out.cars, "car:T000002C").insurer, "American Transit");
    assert.equal(find(out.cars, "car:T000002C").ownership, "driver");
    assert.equal(find(out.cars, "car:T000005C").status, "inactive");
  });

  it("reads start and end dates, with fallbacks and warnings", () => {
    const a2 = find(out.assignments, "asg:2");
    assert.equal(a2.startDayKey, "2021-10-05");
    assert.equal(a2.endDayKey, null);
    assert.equal(a2.rentCents, 100000);
    assert.equal(a2.period, "monthly");
    assert.equal(a2.dueDay, 1);
    assert.equal(find(out.assignments, "asg:3").startDayKey, "2022-01-02");
    assert.equal(find(out.assignments, "asg:5").startDayKey, "2026-11-02");
    const a7 = find(out.assignments, "asg:7");
    assert.equal(a7.startDayKey, "2026-05-01");
    assert.equal(a7.endDayKey, "2026-06-30");
    assert.ok(out.warnings.some((w) => w.row === 7 && w.field === "drop"));
  });

  it("assumes a driver returned when the latest cell is 1", () => {
    const a = find(out.assignments, "asg:4");
    assert.equal(a.endDayKey, "2026-09-30");
    assert.ok(out.warnings.some((w) =>
      w.row === 4 && w.message === "assumed returned (1 marker)"));
    assert.equal(find(out.drivers, "drv:2125550102").status, "left");
    assert.equal(find(out.cars, "car:T000003C").status, "inactive");
  });
});

describe("fleet import: go-live bills", () => {
  const out = parseFleetSheet(sheet());
  const bill = (a, m) => find(out.bills, `bill:${a}:${m}`);

  it("marks a bill paid when the month payment covers the rent", () => {
    const b = bill("asg:2", "2026-11");
    assert.equal(b.status, "paid");
    assert.equal(b.paidCents, 100000); // 1,200 capped at the 1,000 rent
    assert.equal(b.label, "Plate fee Nov 2026");
    assert.equal(b.kind, "rent");
    assert.equal(b.periodFrom, "2026-11-01");
    assert.equal(b.periodTo, "2026-11-30");
    assert.equal(b.dueDayKey, "2026-11-01");
    assert.equal(bill("asg:2", "2026-10").status, "paid");
  });

  it("makes a 0 an owed bill and a part payment an open bill", () => {
    const oct = bill("asg:3", "2026-10");
    assert.equal(oct.status, "open");
    assert.equal(oct.paidCents, 0);
    assert.equal(oct.amountCents, 80000);
    const nov = bill("asg:3", "2026-11");
    assert.equal(nov.status, "open");
    assert.equal(nov.paidCents, 30000);
  });

  it("skips assignments that were not active in the month", () => {
    assert.equal(bill("asg:4", "2026-10"), undefined);
    assert.equal(bill("asg:4", "2026-11"), undefined);
    assert.equal(bill("asg:7", "2026-10"), undefined);
    assert.equal(bill("asg:5", "2026-10"), undefined);
    assert.equal(bill("asg:5", "2026-11").status, "paid");
  });

  it("totals what is still owed", () => {
    // asg:3 Oct 800 + Nov 500 remaining.
    assert.equal(out.totals.ownedBillsCents, 80000 + 50000);
    assert.equal(out.bills.length, 5);
  });

  it("honours custom go-live months", () => {
    const only = parseFleetSheet(sheet(), {goLiveMonths: ["2026-09"]});
    assert.deepEqual(only.bills.map((b) => b.importKey), [
      "bill:asg:2:2026-09", "bill:asg:3:2026-09", "bill:asg:4:2026-09",
    ]);
  });
});

describe("fleet import: edge cases", () => {
  it("handles an empty sheet and skips blank rows", () => {
    const out = parseFleetSheet([header(), new Array(WIDTH).fill("")]);
    assert.equal(out.drivers.length, 0);
    assert.equal(out.totals.paymentCount, 0);
    assert.equal(parseFleetSheet([]).totals.paymentsCents, 0);
  });

  it("never puts names, phones or plates in warnings", () => {
    const text = JSON.stringify(parseFleetSheet(sheet()).warnings);
    for (const secret of ["Test Driver", "2125550", "T00000"]) {
      assert.equal(text.includes(secret), false);
    }
  });
});
