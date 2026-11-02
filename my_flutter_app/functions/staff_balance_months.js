"use strict";

/**
 * Staff balances, month by month (docs/STAFF_BALANCES_MONTHLY.md).
 *
 * Each person's net (staff_balances.js) told as one row per month, oldest
 * first: what they collected for that month's bills, what they handed over
 * or received, what their own parking added, what they paid for the lot and
 * what the business paid them back. The rows add up to the net:
 *
 *   monthNet = collected - handedOut + receivedFromOthers + ownParking
 *              - expensesPaid + paidBack
 *   last runningNet = held + parking due - expenses owed to them = net
 *
 * Money counts in the month its bill was for (owner, 2026-11-02): a parking
 * payment pays the car's charges oldest month first, as the month-end bill
 * does; a lot job payment counts in the job's month.
 *
 * Pure: no Firestore, no clock.
 */

const {
  accruedThroughCents,
  dayKeyOf,
  dayNumber,
  monthDays,
  paymentCents,
  parkingMonthSummary,
} = require("./parking_month_statement");
const {
  collectReceipts,
  isBusinessAccount,
  HANDOVER_STATUS,
} = require("./staff_balances");
const {
  BUSINESS_PAYER,
  expenseLabel,
  expenseLineLabels,
} = require("./staff_expense_credit");

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_MONTHS = 36;

const cents = (value) => {
  const n = Math.round(Number(value) || 0);
  return n > 0 ? n : 0;
};
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

/**
 * Milliseconds of a stored date (Timestamp, {_seconds}, Date, ms, string).
 *
 * @param {*} value The value.
 * @return {number} Ms, or 0.
 */
function msOf(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime() || 0;
  if (typeof value === "number") return value;
  if (typeof value === "object" && Number.isFinite(value._seconds)) {
    return value._seconds * 1000;
  }
  if (typeof value === "object" && Number.isFinite(value.seconds)) {
    return value.seconds * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * "yyyy-mm" of a stored date, "" when there is none.
 *
 * @param {*} value The value.
 * @return {string} The month.
 */
function monthOf(value) {
  const day = dayNumber(value);
  return day === null ? "" : dayKeyOf(day).slice(0, 7);
}

/**
 * @param {string} month "yyyy-mm".
 * @return {string} The next month.
 */
function nextMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * @param {string} month "yyyy-mm".
 * @param {number} count Months to step back.
 * @return {string} The month `count` months before.
 */
function monthsBack(month, count) {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) - count;
  return `${Math.floor(total / 12)}-${String(total % 12 + 1).padStart(2, "0")}`;
}

/**
 * @param {*} list An array field.
 * @return {object[]} Its object entries.
 */
function objects(list) {
  return (Array.isArray(list) ? list : [])
      .filter((x) => x && typeof x === "object");
}

/**
 * A car's charges month by month, as cumulative cents: `[{month, upTo}]`,
 * where `upTo` is what the stay had cost by the end of that month.
 *
 * @param {object} car A parkedCars row.
 * @param {number} today Day number of now.
 * @return {object[]} Oldest first; empty when the stay has no start.
 */
function carMonthBounds(car, today) {
  const start = dayNumber(car.parkingDate);
  if (start === null) return [];
  const leave = dayNumber(car.parkingEndDate);
  const last = leave === null ? today : leave;
  const out = [];
  let month = dayKeyOf(start).slice(0, 7);
  const lastMonth = dayKeyOf(Math.max(start, last)).slice(0, 7);
  for (let n = 0; n < MAX_MONTHS && month <= lastMonth; n++) {
    const days = monthDays(month);
    out.push({month, upTo: accruedThroughCents(car, days.last, today)});
    month = nextMonth(month);
  }
  return out;
}

/**
 * Splits the cents `[from, to)` of a car's payments across its months,
 * oldest first. What is paid beyond every charge lands on the last month.
 *
 * @param {object[]} bounds From carMonthBounds.
 * @param {number} from Start, cumulative cents.
 * @param {number} to End, cumulative cents.
 * @param {string} fallback The month when the car has no charges.
 * @return {object[]} `[{month, amountCents}]`, only non-zero parts.
 */
function allocate(bounds, from, to, fallback) {
  if (to <= from) return [];
  if (bounds.length === 0) return [{month: fallback, amountCents: to - from}];
  const out = [];
  let lower = 0;
  for (const b of bounds) {
    const part = Math.max(0, Math.min(to, b.upTo) - Math.max(from, lower));
    if (part > 0) out.push({month: b.month, amountCents: part});
    lower = Math.max(lower, b.upTo);
  }
  const beyond = Math.max(0, to - Math.max(from, lower));
  if (beyond > 0) {
    const last = bounds[bounds.length - 1].month;
    const same = out.find((p) => p.month === last);
    if (same) same.amountCents += beyond;
    else out.push({month: last, amountCents: beyond});
  }
  return out;
}

/**
 * Every receipt of the counted kinds, split into the months its bill was
 * for, with what it was for.
 *
 * @param {object} sources As collectReceipts.
 * @param {Date} now The moment.
 * @param {object} counted businesses.staffBalanceSources.
 * @return {object[]} `{staffId, month, amountCents, source, id, label,
 *   customerName, vehicle, code, collectedAtMs, method}`.
 */
function monthReceipts(sources, now, counted) {
  const s = sources && typeof sources === "object" ? sources : {};
  const today = dayNumber(now);
  const nowMonth = today === null ? "" : dayKeyOf(today).slice(0, 7);
  const cars = new Map(objects(s.parkedCars).map((c) => [text(c.id), c]));
  const activities = new Map(objects(s.lotActivities)
      .map((a) => [text(a.id), a]));
  const activityPayments = new Map(objects(s.lotActivityPayments)
      .map((p) => [text(p.id), p]));
  const rowsBySource = {
    package: new Map(objects(s.containerLinePayments)
        .map((p) => [text(p.id), p])),
    inventory: new Map(objects(s.inventorySales).map((p) => [text(p.id), p])),
    inventory_credit: new Map(objects(s.inventoryCreditPayments)
        .map((p) => [text(p.id), p])),
    invoice: new Map(objects(s.invoicePayments).map((p) => [text(p.id), p])),
  };
  const vehicleOf = (r) => [r?.carYear, r?.carMake, r?.carModel]
      .map((v) => text(v, 40)).filter(Boolean).join(" ");
  const activityMonth = (a) => {
    const explicit = text(a?.activityDateMonth, 7);
    if (MONTH.test(explicit)) return explicit;
    return monthOf(a?.activityDate) || monthOf(a?.createdAt) || nowMonth;
  };
  const out = [];
  for (const r of collectReceipts(sources, now, counted)) {
    if (isBusinessAccount(r.staffId)) continue;
    const base = {staffId: text(r.staffId, 128), source: r.source,
      id: text(r.id), method: r.method};
    if (r.source === "parking") {
      const [carId, index] = text(r.id).split("#");
      const car = cars.get(carId) || {};
      const live = objects(car.parkingPayments)
          .filter((p) => p.reverted !== true);
      let from = 0;
      let collectedAtMs = 0;
      if (index !== undefined) {
        const i = Number(index);
        for (let k = 0; k < i; k++) from += paymentCents(live[k]);
        collectedAtMs = msOf(live[i]?.at);
      } else {
        for (const p of live) from += paymentCents(p);
        collectedAtMs = msOf(car.directPaymentReceivedAt) ||
          msOf(car.updatedAt);
      }
      const bounds = carMonthBounds(car, today);
      const fallback = monthOf(collectedAtMs) || monthOf(car.parkingDate) ||
        nowMonth;
      for (const part of allocate(bounds, from, from + cents(r.amountCents),
          fallback)) {
        out.push({...base, month: part.month, amountCents: part.amountCents,
          label: "Parking", customerName: text(car.customerName ||
            car.ownerName, 120), vehicle: vehicleOf(car),
          code: text(car.trackingCode, 40), collectedAtMs});
      }
      continue;
    }
    if (r.source === "activity") {
      const payment = activityPayments.get(text(r.id));
      const activity = payment ?
        activities.get(text(payment.activityId)) || {} :
        activities.get(text(r.id)) || {};
      const collectedAtMs = payment ?
        msOf(payment.paidAt) || msOf(payment.createdAt) :
        msOf(activity.updatedAt) || msOf(activity.createdAt);
      out.push({...base, month: activityMonth(activity),
        amountCents: cents(r.amountCents),
        label: text(activity.customLabel || activity.activityTypeLabel, 80) ||
          "Lot job",
        customerName: text(activity.customerName, 120),
        vehicle: vehicleOf(activity), code: text(activity.trackingCode, 40),
        collectedAtMs});
      continue;
    }
    const row = rowsBySource[r.source]?.get(text(r.id)) || {};
    const collectedAtMs = msOf(row.paidAt) || msOf(row.soldAt) ||
      msOf(row.createdAt);
    const label = {package: "Package", inventory: "Shop sale",
      inventory_credit: "Shop credit payment", invoice: "Invoice"}[r.source] ||
      "Payment";
    out.push({...base, month: monthOf(collectedAtMs) || nowMonth,
      amountCents: cents(r.amountCents), label,
      customerName: text(row.customerName || row.buyerName, 120),
      vehicle: "", code: text(row.invoiceNumber || row.trackingCode, 40),
      collectedAtMs});
  }
  return out;
}

/**
 * Each person's months (docs/STAFF_BALANCES_MONTHLY.md §2).
 *
 * @param {object} input staffBalances' input: `{now, staffNames, sources,
 *   counted, handovers, netting: {monthKey, entries (with the monthly
 *   lines' standing payers), repayments, links, lines}}`.
 * @return {object} `{[staffId]: month[]}`, oldest first.
 */
function staffBalanceMonths(input) {
  const now = input?.now instanceof Date ? input.now :
    new Date(Number(input?.now) || 0);
  const today = dayNumber(now);
  if (today === null) return {};
  const nowMonth = dayKeyOf(today).slice(0, 7);
  const names = input?.staffNames || {};
  const netting = input?.netting && typeof input.netting === "object" ?
    input.netting : {};
  const sources = input?.sources || {};
  const people = {};
  const slot = (staffId, month) => {
    if (!people[staffId]) people[staffId] = {};
    if (!people[staffId][month]) {
      people[staffId][month] = {monthKey: month, collectedCents: 0,
        handedOutCents: 0, receivedFromOthersCents: 0, ownParkingCents: 0,
        expensesPaidCents: 0, paidBackCents: 0,
        lines: {collected: [], expenses: [], handovers: [], parking: [],
          paidBack: []}};
    }
    return people[staffId][month];
  };

  for (const r of monthReceipts(sources, now, input?.counted)) {
    if (!r.staffId || r.month > nowMonth) continue;
    const m = slot(r.staffId, r.month);
    m.collectedCents += r.amountCents;
    m.lines.collected.push({source: r.source, id: r.id, label: r.label,
      customerName: r.customerName, vehicle: r.vehicle, code: r.code,
      amountCents: r.amountCents, collectedAtMs: r.collectedAtMs,
      method: r.method});
  }

  for (const h of objects(input?.handovers)) {
    if (text(h.status, 20) !== HANDOVER_STATUS.CONFIRMED) continue;
    const amount = cents(h.amountCents);
    const from = text(h.fromStaffId, 128);
    const to = text(h.toId, 128);
    if (amount <= 0 || !from || !to) continue;
    const atMs = Number(h.createdAtMs) || msOf(h.createdAt);
    const month = monthOf(atMs) || nowMonth;
    const out = slot(from, month);
    out.handedOutCents += amount;
    out.lines.handovers.push({id: text(h.id), direction: "out",
      otherName: isBusinessAccount(to) ? "Business account" :
        text(names[to], 120), amountCents: amount, atMs});
    if (!isBusinessAccount(to)) {
      const into = slot(to, month);
      into.receivedFromOthersCents += amount;
      into.lines.handovers.push({id: text(h.id), direction: "in",
        otherName: text(names[from], 120), amountCents: amount, atMs});
    }
  }

  const lineLabels = expenseLineLabels(netting.lines);
  for (const e of objects(netting.entries)) {
    const staffId = text(e.paidByStaffId, 128);
    const month = text(e.month, 7);
    if (!staffId || staffId === BUSINESS_PAYER || e.voided === true ||
      !MONTH.test(month) || month > nowMonth) continue;
    const amount = cents(e.amountCents);
    if (amount <= 0) continue;
    const m = slot(staffId, month);
    m.expensesPaidCents += amount;
    m.lines.expenses.push({id: text(e.id), amountCents: amount,
      label: expenseLabel(lineLabels[text(e.lineId, 128)], e.note) ||
        "Expense",
      standing: e.standing === true});
  }

  for (const r of objects(netting.repayments)) {
    const staffId = text(r.staffId, 128);
    const month = text(r.month, 7);
    if (!staffId || r.voided === true || !MONTH.test(month) ||
      month > nowMonth) continue;
    const amount = cents(r.amountCents);
    if (amount <= 0) continue;
    const m = slot(staffId, month);
    m.paidBackCents += amount;
    m.lines.paidBack.push({id: text(r.id), amountCents: amount,
      atMs: msOf(r.paidAt) || msOf(r.createdAt)});
  }

  // Their own parking: each month's still-unpaid charge on their bills.
  const linkedTo = {};
  for (const [staffId, link] of Object.entries(netting.links || {})) {
    const key = text(link?.customerKey, 200);
    if (!key) continue;
    if (!linkedTo[key]) linkedTo[key] = [];
    linkedTo[key].push(staffId);
  }
  // Their bills' months: from the first car or job, at most MAX_MONTHS back.
  const oldest = monthsBack(nowMonth, MAX_MONTHS - 1);
  const firstMonths = [
    ...objects(sources.parkedCars).map((c) => monthOf(c.parkingDate)),
    ...objects(sources.lotActivities).map((a) =>
      text(a.activityDateMonth, 7) || monthOf(a.activityDate)),
  ].filter((m) => MONTH.test(m) && m <= nowMonth).sort();
  const sharesOf = (staffIds, amount) => {
    const each = Math.trunc(amount / staffIds.length);
    return staffIds.map((id, i) =>
      [id, each + (i === 0 ? amount - each * staffIds.length : 0)]);
  };
  const staffFor = (key) => {
    const ids = new Set(linkedTo[key] || []);
    if (key.startsWith("staff:")) ids.add(key.slice(6));
    return [...ids].filter(Boolean).sort();
  };
  const counted = {};
  let month = firstMonths[0] && firstMonths[0] > oldest ? firstMonths[0] :
    oldest;
  if (firstMonths.length === 0) month = nowMonth;
  for (let n = 0; n < MAX_MONTHS && month <= nowMonth; n++) {
    const summary = parkingMonthSummary(objects(sources.parkedCars), month,
        now, objects(sources.lotActivities));
    for (const customer of summary.customers || []) {
      const key = text(customer.key, 200);
      const staffIds = staffFor(key);
      const unpaid = Math.max(0, cents(customer.monthCents) -
        cents(customer.monthPaidCents));
      if (staffIds.length === 0 || unpaid <= 0) continue;
      counted[key] = (counted[key] || 0) + unpaid;
      for (const [staffId, share] of sharesOf(staffIds, unpaid)) {
        const m = slot(staffId, month);
        m.ownParkingCents += share;
        m.lines.parking.push({customerKey: key,
          label: text(customer.customerName, 120), amountCents: share});
      }
    }
    month = nextMonth(month);
  }
  // The bills the net uses (netting.customers, owed to the end of this
  // month) are the truth: anything they hold that no month above carried
  // (older than the window, or not dated) shows in this month.
  for (const customer of objects(netting.customers)) {
    const key = text(customer.key, 200);
    const staffIds = staffFor(key);
    const rest = cents(customer.dueCents) - (counted[key] || 0);
    if (staffIds.length === 0 || rest === 0) continue;
    for (const [staffId, share] of sharesOf(staffIds, rest)) {
      const m = slot(staffId, nowMonth);
      m.ownParkingCents += share;
      m.lines.parking.push({customerKey: key, label: "Earlier parking",
        amountCents: share});
    }
  }

  const out = {};
  for (const [staffId, byMonth] of Object.entries(people)) {
    const keys = Object.keys(byMonth).sort();
    // Every month from the first with anything to now, so the table has no
    // gaps - unless that would run past MAX_MONTHS rows (then only the
    // months with something).
    const span = [];
    for (let m = keys[0]; m && m <= nowMonth && span.length <= MAX_MONTHS;
      m = nextMonth(m)) span.push(m);
    const list = span.length <= MAX_MONTHS && keys.every((k) => k <= nowMonth) ?
      span : keys;
    let running = 0;
    const rows = [];
    for (const m of list) {
      const row = byMonth[m] || slot(staffId, m);
      row.monthNetCents = row.collectedCents - row.handedOutCents +
        row.receivedFromOthersCents + row.ownParkingCents -
        row.expensesPaidCents + row.paidBackCents;
      running += row.monthNetCents;
      row.runningNetCents = running;
      row.lines.collected.sort((a, b) => a.collectedAtMs - b.collectedAtMs ||
        a.id.localeCompare(b.id));
      rows.push(row);
    }
    out[staffId] = rows;
  }
  return out;
}

module.exports = {
  allocate,
  carMonthBounds,
  monthReceipts,
  staffBalanceMonths,
};
