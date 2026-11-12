"use strict";

// Fleet spreadsheet import (docs/FLEET.md section 5). PURE: rows in, plain
// objects out. No Firestore, no clock, no files. Warnings never carry names,
// phones, plates or policy numbers: only the sheet row, the field and a
// message.
//
// Sheet columns (0-based): 0 company, 1 start, 2 end, 3 driver, 4 phone,
// 5 drop, 7 policy, 8 plate, 9 vehicle type, 10 TLC licence, 11 VIN,
// 12 registration expiry, 13 diamond expiry, 14 insurer, 15 monthly premium,
// 16 autopay, 17 insurance due day, 18 insurance paid by, 19 ownership,
// 20 plate fee. Columns 21..90 are one payment month each (the first
// months have two columns); later columns are not payments.

const LAST_MONTH_COLUMN = 90;
const MIN_PAYMENT_DOLLARS = 50;
const DEFAULT_GO_LIVE = Object.freeze(["2026-10", "2026-11"]);
const MONTH_NAMES = Object.freeze([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]);

const pad = (n, width = 2) => String(n).padStart(width, "0");
const monthKey = (year, month) => `${year}-${pad(month)}`;

/**
 * Column index to "YYYY-MM" for the payment columns.
 * @return {!Object<number, string>} Map keyed by column index.
 */
function buildSheetMonths() {
  const out = {};
  const early = [
    [21, "2021-10"], [22, "2021-10"], [23, "2021-11"], [24, "2021-11"],
    [25, "2021-12"], [26, "2021-12"],
  ];
  for (const [col, key] of early) out[col] = key;
  for (let col = 27; col <= 32; col++) out[col] = "2022-01";
  for (let col = 33; col <= LAST_MONTH_COLUMN; col++) {
    const total = 2022 * 12 + 1 + (col - 33); // col 33 = 2022-02
    out[col] = monthKey(Math.floor(total / 12), (total % 12) + 1);
  }
  return Object.freeze(out);
}

const FLEET_SHEET_MONTHS = buildSheetMonths();

const cell = (row, index) => String(row[index] ?? "").trim();

/**
 * @param {*} value A sheet cell.
 * @return {?number} Dollars, or null when it is not a number.
 */
function parseMoney(value) {
  const cleaned = String(value ?? "").replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const validDay = (y, m, d) =>
  y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
const dayKey = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

/**
 * Loose date parser: M/D/YYYY, M/D/YY, M-D-YYYY, YYYY-MM-DD, "Jan 5, 2022".
 * @param {*} value A sheet cell.
 * @return {?string} "YYYY-MM-DD" or null.
 */
function parseLooseDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validDay(y, mo, d) ? dayKey(y, mo, d) : null;
  }
  m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    let y = Number(m[3]);
    if (m[3].length === 2) y += y < 70 ? 2000 : 1900;
    return validDay(y, mo, d) ? dayKey(y, mo, d) : null;
  }
  m = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTH_NAMES.findIndex(
        (n) => n.toLowerCase() === m[1].slice(0, 3).toLowerCase()) + 1;
    const [y, d] = [Number(m[3]), Number(m[2])];
    return mo && validDay(y, mo, d) ? dayKey(y, mo, d) : null;
  }
  return null;
}

/**
 * @param {string} month "YYYY-MM".
 * @return {string} Its last day, "YYYY-MM-DD".
 */
function lastDayOfMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return dayKey(y, m, daysIn(y, m));
}

/**
 * @param {string} month "YYYY-MM".
 * @return {string} The month before, "YYYY-MM".
 */
function previousMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? monthKey(y - 1, 12) : monthKey(y, m - 1);
}

const monthLabel = (month) => {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

const phoneDigits = (value) => String(value ?? "").replace(/\D/g, "");

/**
 * @param {string} digits Phone digits.
 * @return {string} E.164 "+1XXXXXXXXXX" or "" when there are not 10 digits.
 */
function toE164(digits) {
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  return "";
}

/**
 * @param {string} value Insurer text.
 * @return {string} A normalized insurer name.
 */
function normalizeInsurer(value) {
  const t = String(value ?? "").trim();
  if (/heref|herf/i.test(t)) return "Hereford";
  if (/^amer(ican|\.)?\s*transit/i.test(t)) return "American Transit";
  return t;
}

const isTruthyText = (value) =>
  /^(yes|y|auto|autopay|true|x|on)\b/i.test(String(value ?? "").trim());

/**
 * @param {string} value Insurance due day cell.
 * @return {?number} 1..31 or null.
 */
function parseDueDay(value) {
  const t = String(value ?? "").trim();
  let n = null;
  if (/^\d{1,2}$/.test(t)) {
    n = Number(t);
  } else {
    const date = parseLooseDate(t);
    if (date) n = Number(date.slice(8, 10));
  }
  return n >= 1 && n <= 31 ? n : null;
}

/**
 * @param {!Array<!Array<*>>} rows Sheet rows INCLUDING the header row.
 * @param {{goLiveMonths: (!Array<string>|undefined)}=} options
 * @return {!Object} drivers, cars, assignments, payments, bills, warnings,
 *     totals.
 */
function parseFleetSheet(rows, options = {}) {
  const goLive = options.goLiveMonths || DEFAULT_GO_LIVE;
  const warnings = [];
  const warn = (row, field, message) => warnings.push({row, field, message});
  const drivers = new Map();
  const cars = new Map();
  const assignments = [];
  const payments = [];
  const monthColumns = Object.keys(FLEET_SHEET_MONTHS).map(Number);

  for (let i = 1; i < (rows || []).length; i++) {
    const row = rows[i] || [];
    const rowNumber = i + 1;
    if (row.every((c) => String(c ?? "").trim() === "")) continue;

    const name = cell(row, 3);
    const digits = phoneDigits(cell(row, 4));
    const plate = cell(row, 8).toUpperCase();

    // Month cells, in month order.
    const cells = [];
    for (const col of monthColumns) {
      const text = cell(row, col);
      if (text === "") continue;
      cells.push({col, month: FLEET_SHEET_MONTHS[col],
        dollars: parseMoney(text)});
    }
    const paid = cells.filter(
        (c) => c.dollars !== null && c.dollars >= MIN_PAYMENT_DOLLARS);

    if (!name && !digits) {
      warn(rowNumber, "driver", "Row has no driver name or phone; skipped.");
      continue;
    }

    const phoneKey = digits.length >= 10 ? digits.slice(-10) : "";
    if (!phoneKey) warn(rowNumber, "phone", "No usable phone; keyed by name.");
    const driverKey = `drv:${phoneKey || name.toLowerCase()}`;
    let driver = drivers.get(driverKey);
    if (!driver) {
      driver = {
        importKey: driverKey, name, phone: toE164(digits),
        tlcLicense: cell(row, 10), status: "left",
      };
      drivers.set(driverKey, driver);
    } else {
      if (!driver.name) driver.name = name;
      if (!driver.phone) driver.phone = toE164(digits);
      if (!driver.tlcLicense) driver.tlcLicense = cell(row, 10);
    }

    let assignmentKey = null;
    let carKey = null;
    if (!plate) {
      warn(rowNumber, "plate", "No plate; payments kept, no car or " +
        "assignment created.");
    } else {
      carKey = `car:${plate}`;
      assignmentKey = `asg:${rowNumber}`;
      const car = cars.get(carKey) || {
        importKey: carKey, plate, company: "", vehicleType: "", vin: "",
        registrationExpiry: null, diamondExpiry: null, insurer: "",
        policyNumber: "", premiumCents: null, insuranceDueDay: null,
        insuranceAutopay: false, insurancePaidBy: "", ownership: "company",
        status: "inactive",
      };
      const setText = (field, value) => {
        if (!car[field] && value) car[field] = value;
      };
      setText("company", cell(row, 0));
      setText("vehicleType", cell(row, 9));
      setText("vin", cell(row, 11));
      setText("insurer", normalizeInsurer(cell(row, 14)));
      setText("policyNumber", cell(row, 7));
      setText("insurancePaidBy", cell(row, 18));
      for (const [field, col] of [["registrationExpiry", 12],
        ["diamondExpiry", 13]]) {
        const text = cell(row, col);
        const parsed = parseLooseDate(text);
        if (parsed) car[field] = parsed;
        else if (text) warn(rowNumber, field, "Date not understood.");
      }
      const premium = parseMoney(cell(row, 15));
      if (premium !== null && car.premiumCents === null) {
        car.premiumCents = Math.round(premium * 100);
      }
      const due = parseDueDay(cell(row, 17));
      if (due && !car.insuranceDueDay) car.insuranceDueDay = due;
      if (isTruthyText(cell(row, 16))) car.insuranceAutopay = true;
      if (/owner/i.test(cell(row, 19))) car.ownership = "driver";
      cars.set(carKey, car);

      const startRaw = cell(row, 1);
      let startDayKey = parseLooseDate(startRaw);
      if (startRaw && !startDayKey) {
        warn(rowNumber, "start", "Date not understood.");
      }
      if (!startDayKey) {
        if (paid.length) {
          startDayKey = `${paid[0].month}-01`;
        } else {
          warn(rowNumber, "start", "No start date and no payments.");
        }
      }
      let endDayKey = null;
      for (const [field, col] of [["end", 2], ["drop", 5]]) {
        const text = cell(row, col);
        const parsed = parseLooseDate(text);
        if (parsed && !endDayKey) endDayKey = parsed;
        else if (text && !parsed) {
          warn(rowNumber, field, "Date not understood.");
        }
      }
      if (!endDayKey && cells.length &&
          cells[cells.length - 1].dollars === 1) {
        endDayKey = lastDayOfMonth(
            previousMonth(cells[cells.length - 1].month));
        warn(rowNumber, "end", "assumed returned (1 marker)");
      }

      const rentDollars = parseMoney(cell(row, 20));
      if (rentDollars === null) warn(rowNumber, "rent", "No plate fee.");
      assignments.push({
        importKey: assignmentKey, driverKey, carKey, startDayKey, endDayKey,
        rentCents: rentDollars === null ? 0 : Math.round(rentDollars * 100),
        period: "monthly", dueDay: 1,
      });
      if (!endDayKey) {
        driver.status = "active";
        car.status = "active";
      }
    }

    for (const c of paid) {
      payments.push({
        importKey: `pay:${rowNumber}:${c.col}`, driverKey, assignmentKey,
        carKey, amountCents: Math.round(c.dollars * 100), method: "import",
        paidDayKey: `${c.month}-01`, imported: true,
      });
    }
  }

  // One rent bill per assignment per go-live month it was active in.
  const bills = [];
  for (const a of assignments) {
    if (!a.startDayKey || !a.rentCents) continue;
    for (const month of goLive) {
      const from = `${month}-01`;
      const to = lastDayOfMonth(month);
      if (a.startDayKey > to || (a.endDayKey && a.endDayKey < from)) continue;
      const inMonth = payments
          .filter((p) => p.assignmentKey === a.importKey &&
            p.paidDayKey.slice(0, 7) === month)
          .reduce((sum, p) => sum + p.amountCents, 0);
      const paidCents = Math.min(inMonth, a.rentCents);
      bills.push({
        importKey: `bill:${a.importKey}:${month}`,
        driverKey: a.driverKey, carKey: a.carKey,
        assignmentKey: a.importKey, kind: "rent",
        label: `Plate fee ${monthLabel(month)}`, periodFrom: from,
        periodTo: to, dueDayKey: from, amountCents: a.rentCents, paidCents,
        status: paidCents >= a.rentCents ? "paid" : "open",
      });
    }
  }

  const byYear = {};
  const byMonth = {};
  let paymentsCents = 0;
  for (const p of payments) {
    paymentsCents += p.amountCents;
    const month = p.paidDayKey.slice(0, 7);
    const year = month.slice(0, 4);
    byYear[year] = (byYear[year] || 0) + p.amountCents;
    byMonth[month] = byMonth[month] || {cents: 0, count: 0};
    byMonth[month].cents += p.amountCents;
    byMonth[month].count += 1;
  }
  const ownedBillsCents = bills
      .filter((b) => b.status === "open")
      .reduce((sum, b) => sum + (b.amountCents - b.paidCents), 0);

  return {
    drivers: [...drivers.values()],
    cars: [...cars.values()],
    assignments,
    payments,
    bills,
    warnings,
    totals: {
      paymentsCents, paymentCount: payments.length,
      driverCount: drivers.size, carCount: cars.size, byYear, byMonth,
      ownedBillsCents,
    },
  };
}

module.exports = {
  FLEET_SHEET_MONTHS,
  parseFleetSheet,
  parseLooseDate,
  parseMoney,
  normalizeInsurer,
};
