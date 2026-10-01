"use strict";

/**
 * Month-end parking bills. A parked car carries one running balance from
 * the day it arrived; settling the books means cutting that balance into
 * months, so each month closes with its own bill:
 *
 *   this month's days x the rate, plus anything still unpaid from before,
 *   minus what has been paid - payments applied to the oldest month first.
 *
 * Always worked out live from the car: payments are recorded on the car as
 * they always were, and a later fix to a rate or a date changes the bill
 * (the car's change history says who and when). Nothing here is stored.
 *
 * Mirrored by `admin_web/src/lib/parking-month-statement.ts` and
 * `lib/services/parking_month_statement.dart`; tests pin the three to the
 * same numbers.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTH_NAMES = Object.freeze([
  "January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December",
]);

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  if (typeof value._seconds === "number") {
    return new Date(value._seconds * 1000);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The UTC calendar day a moment falls on, as a day number - the same day
 * the parking list counts with.
 *
 * @param {*} value A Date, Timestamp or string.
 * @return {number|null} Days since the epoch, or null.
 */
function dayNumber(value) {
  const date = toDate(value);
  if (!date) return null;
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(),
      date.getUTCDate()) / DAY_MS);
}

function dayKeyOf(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * @param {string} monthKey "YYYY-MM".
 * @return {{first: number, last: number}|null} Its first and last day.
 */
function monthDays(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(text(monthKey, 7));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11) return null;
  return {
    first: Math.floor(Date.UTC(year, month, 1) / DAY_MS),
    last: Math.floor(Date.UTC(year, month + 1, 1) / DAY_MS) - 1,
  };
}

/**
 * @param {Date} [now] The moment.
 * @return {string} "YYYY-MM" of the month before it.
 */
function previousMonthKey(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * @param {string} monthKey "YYYY-MM".
 * @return {string} "September 2026".
 */
function monthLabel(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(text(monthKey, 7));
  if (!match) return text(monthKey, 7);
  return `${MONTH_NAMES[Number(match[2]) - 1] || ""} ${match[1]}`.trim();
}

function centsOf(row, centsKeys, dollarKeys) {
  for (const key of centsKeys) {
    const n = Number(row?.[key]);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  for (const key of dollarKeys) {
    const n = Number(row?.[key]);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100);
  }
  return 0;
}

/**
 * What the stay has run up by the end of a given day, in cents. An
 * open-ended stay runs at its daily rate; a stay with a leave date was
 * priced as a whole and is spread evenly over its days.
 *
 * @param {object} row A parkedCars document.
 * @param {number} day The day number to count through.
 * @param {number} today Today's day number (an open stay stops here).
 * @return {number} Cents.
 */
function accruedThroughCents(row, day, today) {
  const start = dayNumber(row?.parkingDate);
  if (start === null || day < start) return 0;
  const leave = dayNumber(row?.parkingEndDate);
  const end = leave === null ? today : leave;
  if (end < start) return 0;
  const through = Math.min(day, end);
  const days = through - start + 1;
  if (leave === null) {
    const daily = Math.round((Number(row?.dailyRate) || 0) * 100);
    return daily > 0 ? days * daily : 0;
  }
  const total = centsOf(row, ["amountDueCents", "totalCostCents"],
      ["amountDue", "totalCost"]);
  const stayDays = end - start + 1;
  return stayDays > 0 ? Math.round(total * days / stayDays) : 0;
}

/**
 * What has been paid on the car, in cents - recorded payments, or the
 * whole of it when the record is marked paid without amounts.
 *
 * @param {object} row A parkedCars document.
 * @param {number} today Today's day number.
 * @return {number} Cents.
 */
function paidCents(row, today) {
  const recorded = Math.round(Number(row?.amountPaidCents) || 0);
  if (recorded > 0) return recorded;
  const status = text(row?.paymentStatus, 40);
  if (status === "succeeded" || status === "paid") {
    return accruedThroughCents(row, today, today);
  }
  return 0;
}

/**
 * One car's bill for one month, or null when the car was not on the lot
 * that month (or has nothing to collect at all).
 *
 * @param {object} row A parkedCars document (with its `id`).
 * @param {string} monthKey "YYYY-MM".
 * @param {Date} [now] The moment the bill is worked out.
 * @return {object|null} The bill.
 */
function parkingMonthStatement(row, monthKey, now = new Date()) {
  const r = row && typeof row === "object" ? row : {};
  if (text(r.status, 40) === "cancelled") return null;
  if (text(r.paymentStatus, 40) === "not_required") return null;
  const month = monthDays(monthKey);
  const start = dayNumber(r.parkingDate);
  const today = dayNumber(now);
  if (!month || start === null || today === null) return null;
  const leave = dayNumber(r.parkingEndDate);
  const lastDay = leave === null ? today : leave;
  const from = Math.max(start, month.first);
  const to = Math.min(lastDay, month.last);
  if (to < from) return null;

  const priorCents = accruedThroughCents(r, month.first - 1, today);
  const throughCents = accruedThroughCents(r, to, today);
  const monthCents = Math.max(0, throughCents - priorCents);
  if (monthCents <= 0) return null;

  // Oldest first: money pays off what came before this month, then this
  // month. Whatever is left over belongs to later months.
  const paid = paidCents(r, today);
  const priorUnpaidCents = Math.max(0, priorCents - paid);
  const towardMonth = Math.max(0, paid - priorCents);
  const monthPaidCents = Math.min(monthCents, towardMonth);
  const monthUnpaidCents = monthCents - monthPaidCents;
  const days = to - from + 1;

  return {
    id: text(r.id),
    monthKey,
    periodFrom: dayKeyOf(from),
    periodTo: dayKeyOf(to),
    days,
    // What one day cost this month - for the "30 x $15" line.
    dayRateCents: Math.round(monthCents / days),
    monthCents,
    monthPaidCents,
    monthUnpaidCents,
    priorUnpaidCents,
    dueCents: priorUnpaidCents + monthUnpaidCents,
    owes: monthUnpaidCents > 0,
    stillParked: lastDay > month.last,
    // The month is not over yet when its last day is still ahead.
    partialMonth: month.last > today,
    customerName: text(r.customerName) || text(r.ownerName),
    customerPhone: text(r.customerPhone, 40),
    customerEmail: text(r.customerEmail, 180),
    vehicle: [r.carYear, r.carMake, r.carModel].map((v) => text(v, 80))
        .filter(Boolean).join(" "),
    vinNumber: text(r.vinNumber, 17).toUpperCase(),
    trackingCode: text(r.trackingCode, 40),
  };
}

/**
 * The business's month: every car on the lot that month, what it ran up,
 * what came in, and who still owes - biggest first.
 *
 * @param {object[]} rows The business's parkedCars documents.
 * @param {string} monthKey "YYYY-MM".
 * @param {Date} [now] The moment.
 * @return {object} The summary and the bills.
 */
function parkingMonthSummary(rows, monthKey, now = new Date()) {
  const bills = (Array.isArray(rows) ? rows : [])
      .map((row) => parkingMonthStatement(row, monthKey, now))
      .filter(Boolean);
  const owing = bills.filter((b) => b.owes)
      .sort((a, b) => b.dueCents - a.dueCents ||
        a.customerName.localeCompare(b.customerName));
  const sum = (list, key) => list.reduce((s, b) => s + b[key], 0);
  const customers = parkingMonthCustomers(bills);
  return {
    monthKey,
    carsOnLot: bills.length,
    carsOwing: owing.length,
    customers,
    customersOwing: customers.filter((c) => c.owes),
    billedCents: sum(bills, "monthCents"),
    collectedCents: sum(bills, "monthPaidCents"),
    owedCents: sum(bills, "monthUnpaidCents"),
    olderOwedCents: sum(owing, "priorUnpaidCents"),
    dueCents: sum(owing, "dueCents"),
    owing,
    bills,
  };
}

/**
 * Who a bill goes to: the phone number, last ten digits. Names are typed a
 * dozen ways for the same person ("Abd Sow", "abdoulaye sow"); the phone is
 * what the WhatsApp reaches, and every parked car carries one.
 *
 * @param {object} bill From parkingMonthStatement.
 * @return {string} The grouping key.
 */
function parkingCustomerKey(bill) {
  const digits = text(bill?.customerPhone, 40).replace(/\D+/g, "").slice(-10);
  if (digits.length >= 7) return `phone:${digits}`;
  return `name:${text(bill?.customerName).toLowerCase().replace(/\s+/g, " ")}`;
}

const normName = (v) => text(v).toLowerCase().replace(/\s+/g, " ");
const sameName = (a, b) => normName(a) === normName(b);

/**
 * The name a customer goes by: the spelling used most often (capitals and
 * spacing ignored), the longest on a tie, shown in its capitalised form when
 * one was typed.
 *
 * @param {string[]} names The names on the customer's cars.
 * @return {string} The name to print.
 */
function mostUsedName(names) {
  const groups = new Map();
  for (const raw of names) {
    const name = text(raw).replace(/\s+/g, " ");
    if (!name) continue;
    const key = normName(name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(name);
  }
  const best = [...groups.entries()].sort((a, b) =>
    b[1].length - a[1].length || b[0].length - a[0].length ||
    a[0].localeCompare(b[0]))[0];
  if (!best) return "";
  const capitalised = (n) => n.split(" ").filter((w) => /^[A-ZÀ-Ý]/.test(w))
      .length;
  return [...best[1]].sort((a, b) => capitalised(b) - capitalised(a))[0];
}

/**
 * The month's bills grouped by customer - one bill per phone, listing each
 * car with the dates it covers. The name shown is the spelling used most
 * often on that phone (the longest, on a tie); a car registered under a
 * different name says so on its own line.
 *
 * @param {object[]} bills From parkingMonthStatement.
 * @return {object[]} Customers, most owed first.
 */
function parkingMonthCustomers(bills) {
  const groups = new Map();
  for (const bill of Array.isArray(bills) ? bills : []) {
    const key = parkingCustomerKey(bill);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bill);
  }
  const customers = [];
  for (const [key, list] of groups) {
    const customerName = mostUsedName(list.map((b) => b.customerName));
    const cars = [...list].sort((a, b) =>
      a.periodFrom.localeCompare(b.periodFrom) ||
      a.vehicle.localeCompare(b.vehicle))
        .map((b) => ({...b, registeredTo:
          sameName(b.customerName, customerName) ? "" : b.customerName}));
    const sum = (k) => cars.reduce((s, b) => s + b[k], 0);
    customers.push({
      key,
      monthKey: cars[0].monthKey,
      customerName,
      customerPhone: cars.find((b) => b.customerPhone)?.customerPhone || "",
      customerEmail: cars.find((b) => b.customerEmail)?.customerEmail || "",
      cars,
      monthCents: sum("monthCents"),
      monthPaidCents: sum("monthPaidCents"),
      monthUnpaidCents: sum("monthUnpaidCents"),
      priorUnpaidCents: sum("priorUnpaidCents"),
      dueCents: sum("dueCents"),
      owes: cars.some((b) => b.owes),
      partialMonth: cars.some((b) => b.partialMonth),
    });
  }
  return customers.sort((a, b) => b.dueCents - a.dueCents ||
    a.customerName.localeCompare(b.customerName));
}

function moneyText(cents) {
  const n = Math.round(Number(cents) || 0);
  const whole = Math.trunc(Math.abs(n) / 100);
  const part = String(Math.abs(n) % 100).padStart(2, "0");
  return `${n < 0 ? "-" : ""}$${whole.toLocaleString("en-US")}.${part}`;
}

/**
 * The message pasted into WhatsApp beside the PDF.
 *
 * @param {object} bill From parkingMonthStatement.
 * @param {string} businessName The lot.
 * @return {string} Plain text.
 */
function parkingMonthBillText(bill, businessName) {
  const b = bill || {};
  const lines = [
    `${text(businessName) || "Parking"} — Parking bill, ` +
      `${monthLabel(b.monthKey)}`,
    `For: ${b.customerName || "—"}`,
  ];
  const car = [b.vehicle, b.vinNumber ? `VIN ${b.vinNumber}` : ""]
      .filter(Boolean).join(" · ");
  if (car) lines.push(car);
  lines.push("",
      `${b.periodFrom} to ${b.periodTo}: ${b.days} day` +
      `${b.days === 1 ? "" : "s"} × ${moneyText(b.dayRateCents)} — ` +
      `${moneyText(b.monthCents)}`);
  if (b.priorUnpaidCents > 0) {
    lines.push(`Unpaid from before — ${moneyText(b.priorUnpaidCents)}`);
  }
  if (b.monthPaidCents > 0) {
    lines.push(`Paid — -${moneyText(b.monthPaidCents)}`);
  }
  lines.push(b.dueCents > 0 ?
    `BALANCE DUE: ${moneyText(b.dueCents)}` : "PAID IN FULL");
  return lines.join("\n");
}

/**
 * One customer's bill as WhatsApp text: every car, the dates it covers, and
 * what is owed in all.
 *
 * @param {object} customer From parkingMonthCustomers.
 * @param {string} businessName The lot.
 * @return {string} Plain text.
 */
function parkingMonthCustomerText(customer, businessName) {
  const c = customer || {};
  const lines = [
    `${text(businessName) || "Parking"} — Parking bill, ` +
      `${monthLabel(c.monthKey)}`,
    `For: ${[c.customerName || "—", c.customerPhone].filter(Boolean)
        .join(" · ")}`,
    "",
  ];
  for (const b of c.cars || []) {
    const car = [b.vehicle || "Car", b.vinNumber ? `VIN ${b.vinNumber}` : ""]
        .filter(Boolean).join(" · ");
    lines.push(car + (b.registeredTo ? ` (registered to ${b.registeredTo})` :
      ""));
    lines.push(`  ${b.periodFrom} to ${b.periodTo}: ${b.days} day` +
      `${b.days === 1 ? "" : "s"} × ${moneyText(b.dayRateCents)} — ` +
      `${moneyText(b.monthCents)}`);
  }
  lines.push("", `Total for ${MONTH_NAMES[Number(String(c.monthKey)
      .slice(5, 7)) - 1] || "the month"} — ${moneyText(c.monthCents)}`);
  if (c.priorUnpaidCents > 0) {
    lines.push(`Unpaid from before — ${moneyText(c.priorUnpaidCents)}`);
  }
  if (c.monthPaidCents > 0) {
    lines.push(`Paid — -${moneyText(c.monthPaidCents)}`);
  }
  lines.push(c.dueCents > 0 ?
    `BALANCE DUE: ${moneyText(c.dueCents)}` : "PAID IN FULL");
  return lines.join("\n");
}

module.exports = {
  MONTH_NAMES,
  parkingCustomerKey,
  parkingMonthCustomers,
  parkingMonthCustomerText,
  dayNumber,
  monthDays,
  previousMonthKey,
  monthLabel,
  accruedThroughCents,
  parkingMonthStatement,
  parkingMonthSummary,
  parkingMonthBillText,
  moneyText,
};
