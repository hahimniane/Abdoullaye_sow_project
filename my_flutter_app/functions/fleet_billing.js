"use strict";

// Fleet (TLC plate leasing) billing rules, docs/FLEET.md section 3.
// Pure: no Firestore, no clock (callers pass day keys). Day keys are
// "YYYY-MM-DD" strings already in America/New_York. Money is integer cents.
// Mirrored in admin_web/src/lib/fleet-billing.ts; both run the shared
// fixture test/fixtures/fleet-billing-cases.json.

const FLEET_MESSAGES = Object.freeze({
  fleet_no_amount: "Enter an amount greater than zero.",
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
  "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86400000;

/**
 * @param {string} key A "YYYY-MM-DD" day key.
 * @return {{y: number, m: number, d: number}} Its parts.
 */
function parts(key) {
  const [y, m, d] = String(key).split("-").map(Number);
  return {y, m, d};
}

/**
 * @param {string} key A "YYYY-MM-DD" day key.
 * @return {number} Days since 1970-01-01.
 */
function dayNum(key) {
  const {y, m, d} = parts(key);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/**
 * @param {number} n Days since 1970-01-01.
 * @return {string} The day key.
 */
function dayKeyOf(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The day key for a day of a month, clamped to the month's length.
 *
 * @param {number} year The year.
 * @param {number} month The month, 1-12; may overflow (13 = next January).
 * @param {number} day The wanted day of the month.
 * @return {string} The day key.
 */
function monthDay(year, month, day) {
  const y = year + Math.floor((month - 1) / 12);
  const m = ((month - 1) % 12 + 12) % 12 + 1;
  const d = Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate());
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * @param {string} key A day key.
 * @return {string} The day before it.
 */
function dayBefore(key) {
  return dayKeyOf(dayNum(key) - 1);
}

/**
 * US month-first date, e.g. "Nov 9, 2026".
 *
 * @param {string} key A day key.
 * @return {string} The text.
 */
function usDate(key) {
  const {y, m, d} = parts(key);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * The plate fee and due day in force for a period that begins on
 * periodFrom: the assignment's `rentHistory` ([{rentCents, dueDay,
 * fromDayKey, toDayKey}], the values before a change) when a row covers
 * that day, else the current ones.
 *
 * @param {object} assignment The assignment.
 * @param {string} periodFrom The period's first day.
 * @return {{rentCents: number, dueDay: number}} The terms.
 */
function termsAt(assignment, periodFrom) {
  const a = assignment || {};
  for (const h of Array.isArray(a.rentHistory) ? a.rentHistory : []) {
    if (h && h.fromDayKey <= periodFrom && periodFrom <= h.toDayKey) {
      return {rentCents: h.rentCents, dueDay: h.dueDay};
    }
  }
  return {rentCents: a.rentCents, dueDay: a.dueDay};
}

/**
 * The rent periods of an assignment, from its start to the period holding
 * throughDayKey (or endDayKey when that comes first).
 *
 * Monthly billing is by calendar month (owner, 2026-11-19): the first
 * period runs from the start (or billFromDayKey) to the end of that month
 * and is due on the later of that day and the due day; every later period
 * is the 1st to the last day, due on the due day of its month. Weekly
 * periods run from the start's weekday.
 *
 * `billFromDayKey` (later than the start) is the first day rent is owed
 * from: a driver brought in from the spreadsheet started years ago, but
 * owes nothing before go-live. Weekly periods that begin before it are
 * left out.
 *
 * @param {object} assignment {startDayKey, endDayKey, period, dueDay,
 *   billFromDayKey?, rentHistory?}.
 * @param {string} throughDayKey Last day to bill through.
 * @return {Array<{periodFrom: string, periodTo: string, dueDayKey: string}>}
 *   The periods.
 */
function rentPeriods(assignment, throughDayKey) {
  const a = assignment || {};
  const billFrom = a.billFromDayKey && a.billFromDayKey > a.startDayKey ?
    a.billFromDayKey : "";
  const firstKey = billFrom && a.period !== "weekly" ?
    billFrom : a.startDayKey;
  const start = parts(firstKey);
  const stop = a.endDayKey && a.endDayKey < throughDayKey ?
    a.endDayKey : throughDayKey;
  const out = [];
  for (let k = 0; k < 10000; k++) {
    let from;
    let to;
    let due;
    if (a.period === "weekly") {
      const f = dayNum(a.startDayKey) + 7 * k;
      from = dayKeyOf(f);
      to = dayKeyOf(f + 6);
      const weekday = ((f + 3) % 7 + 7) % 7 + 1; // 1970-01-01 was Thursday
      const dueDay = Number(termsAt(a, from).dueDay);
      due = dayKeyOf(f + ((dueDay - weekday + 7) % 7));
    } else {
      from = k === 0 ? firstKey : monthDay(start.y, start.m + k, 1);
      const f = parts(from);
      to = monthDay(f.y, f.m, 31);
      const dueDay = Number(termsAt(a, from).dueDay);
      due = monthDay(f.y, f.m, dueDay);
      if (due < from) due = from;
    }
    if (from > stop) break;
    if (billFrom && from < billFrom) continue;
    out.push({periodFrom: from, periodTo: to, dueDayKey: due});
  }
  return out;
}

/**
 * The periods that still need a bill: no bill with their id, and (monthly)
 * no rent bill of the assignment that is not void already overlapping
 * their calendar month. Bills made when periods ran from the start's day
 * of the month, or by the spreadsheet import, keep a month from being
 * billed twice.
 *
 * @param {object} assignment The assignment.
 * @param {Array<string|object>} existing Ids of existing bills, or the
 *   bills ({id, kind, status, periodFrom, periodTo}); only bills carry the
 *   overlap check.
 * @param {string} throughDayKey Last day to bill through.
 * @return {Array<object>} The periods (see rentPeriods).
 */
function missingRentPeriods(assignment, existing, throughDayKey) {
  const a = assignment || {};
  const list = existing || [];
  const have = new Set(list.map((x) => typeof x === "string" ? x : x?.id));
  const bills = list.filter((x) => x && typeof x === "object" &&
    (x.kind === undefined || x.kind === "rent") && x.status !== "void");
  return rentPeriods(a, throughDayKey).filter((p) => {
    if (have.has(`${a.id}_${p.periodFrom}`)) return false;
    if (a.period === "weekly") return true;
    const f = parts(p.periodFrom);
    const first = monthDay(f.y, f.m, 1);
    const last = monthDay(f.y, f.m, 31);
    return !bills.some((b) => b.periodFrom <= last && b.periodTo >= first);
  });
}

/**
 * The first day of the next period that has no bill yet: where a changed
 * plate fee or due day starts to apply.
 *
 * @param {object} assignment The assignment (open).
 * @param {Array<string|object>} existing Existing bills (see
 *   missingRentPeriods).
 * @param {string} fromDayKey Today's day key.
 * @return {string} The day key, or "" when nothing is left to bill.
 */
function nextUnbilledPeriodStart(assignment, existing, fromDayKey) {
  const through = dayKeyOf(dayNum(fromDayKey) + 800);
  const next = missingRentPeriods(assignment, existing, through)[0];
  return next ? next.periodFrom : "";
}

/**
 * Rent bills not yet created, through a day. Idempotent by bill id (and
 * never a second bill for a calendar month, see missingRentPeriods). The
 * period cut by endDayKey follows settings.returnRule ("full" by default,
 * or "days": pro rata by days used within that period, start and end
 * inclusive). A cut period keeps its full periodFrom/periodTo. Each period
 * is billed at the fee in force for it (rentHistory).
 *
 * @param {object} assignment The assignment (with id, driverId, carId...).
 * @param {Array<string|object>} existingBillIds Ids of bills that already
 *   exist, or the bills themselves.
 * @param {string} throughDayKey Last day to bill through.
 * @param {object} settings Fleet settings ({returnRule}).
 * @return {Array<object>} New fleet bill documents (without timestamps).
 */
function rentBillsToCreate(assignment, existingBillIds, throughDayKey,
    settings) {
  const a = assignment || {};
  const days = Boolean(settings) && settings.returnRule === "days";
  const out = [];
  for (const p of missingRentPeriods(a, existingBillIds, throughDayKey)) {
    const id = `${a.id}_${p.periodFrom}`;
    let amount = Math.round(Number(termsAt(a, p.periodFrom).rentCents) || 0);
    if (days && a.endDayKey && a.endDayKey >= p.periodFrom &&
        a.endDayKey < p.periodTo) {
      const used = dayNum(a.endDayKey) - dayNum(p.periodFrom) + 1;
      const total = dayNum(p.periodTo) - dayNum(p.periodFrom) + 1;
      amount = Math.round(amount * used / total);
    }
    const f = parts(p.periodFrom);
    out.push({
      id,
      businessId: a.businessId || null,
      driverId: a.driverId || null,
      carId: a.carId || null,
      assignmentId: a.id,
      kind: "rent",
      label: a.period === "weekly" ?
        `Plate fee week of ${usDate(p.periodFrom)}` :
        `Plate fee ${MONTHS[f.m - 1]} ${f.y}`,
      periodFrom: p.periodFrom,
      periodTo: p.periodTo,
      dueDayKey: p.dueDayKey,
      amountCents: amount,
      paidCents: 0,
      status: "open",
    });
  }
  return out;
}

/**
 * What a rent bill is worth once the plate came back on endDayKey, for a
 * bill the assignment's own periods do not name (a go-live month's bill made
 * by the spreadsheet import covers a calendar month under its own id): a
 * period used to its last day stays as it is, the period the return falls
 * in follows settings.returnRule, a period that begins after the return is
 * worth nothing. Without this, returning an imported driver's plate voided
 * their imported bills and turned what they had paid into credit.
 *
 * @param {object} bill {periodFrom, periodTo, amountCents}.
 * @param {string} endDayKey The day the plate came back.
 * @param {object} settings Fleet settings ({returnRule}).
 * @return {number} The bill's amount in cents after the return.
 */
function billAfterReturn(bill, endDayKey, settings) {
  const amount = Math.round(Number(bill?.amountCents) || 0);
  const from = String(bill?.periodFrom || "");
  const to = String(bill?.periodTo || "");
  if (!from || !to) return 0;
  if (endDayKey >= to) return amount;
  if (endDayKey < from) return 0;
  if (!settings || settings.returnRule !== "days") return amount;
  const used = dayNum(endDayKey) - dayNum(from) + 1;
  const total = dayNum(to) - dayNum(from) + 1;
  return Math.round(amount * used / total);
}

const remaining = (b) =>
  Math.max(0, (Number(b.amountCents) || 0) - (Number(b.paidCents) || 0));

/**
 * Late fees to create: one per open, unpaid rent bill whose fee day (the
 * office's day of the due month when the bill is due on or before it, else
 * three days after the due day) has come, from firstMonth on, with no late
 * fee yet (a waived or void fee still counts as the one fee).
 *
 * @param {Array<object>} bills The driver's (or business's) bills.
 * @param {object} settings {lateFee: {cents, dayOfMonth, firstMonth}}.
 * @param {string} todayKey Today's day key.
 * @return {Array<object>} New late_fee bills.
 */
function lateFeesToCreate(bills, settings, todayKey) {
  const lf = (settings && settings.lateFee) || {};
  const cents = Math.round(Number(lf.cents) || 0);
  const dom = Number(lf.dayOfMonth);
  if (cents <= 0 || !(dom >= 1) || !lf.firstMonth) return [];
  const charged = new Set(
      (bills || []).filter((b) => b.kind === "late_fee")
          .map((b) => b.lateFeeForBillId));
  const out = [];
  for (const b of bills || []) {
    if (b.kind !== "rent" || b.status !== "open" || remaining(b) <= 0) {
      continue;
    }
    if (!b.dueDayKey || charged.has(b.id)) continue;
    if (b.dueDayKey.slice(0, 7) < lf.firstMonth) continue;
    const due = parts(b.dueDayKey);
    let fee = monthDay(due.y, due.m, dom);
    if (b.dueDayKey > fee) fee = dayKeyOf(dayNum(b.dueDayKey) + 3);
    if (todayKey < fee) continue;
    out.push({
      id: `${b.id}_late`,
      businessId: b.businessId || null,
      driverId: b.driverId || null,
      carId: b.carId || null,
      assignmentId: b.assignmentId || null,
      kind: "late_fee",
      label: `Late fee — ${b.label || "Plate fee"}`,
      periodFrom: b.periodFrom || null,
      periodTo: b.periodTo || null,
      dueDayKey: fee,
      amountCents: cents,
      paidCents: 0,
      status: "open",
      lateFeeForBillId: b.id,
    });
  }
  return out;
}

/**
 * Late fees first, then everything else; each by due day then id.
 *
 * @param {Array<object>} bills Bills.
 * @return {Array<object>} The open, unpaid bills in paying order.
 */
function payOrder(bills) {
  const rank = (b) => b.kind === "late_fee" ? 0 : 1;
  return (bills || []).filter((b) => b.status === "open" && remaining(b) > 0)
      .sort((x, y) => rank(x) - rank(y) ||
        String(x.dueDayKey).localeCompare(String(y.dueDayKey)) ||
        String(x.id).localeCompare(String(y.id)));
}

/**
 * @param {Array<object>} bills Open bills.
 * @param {number} cents Money to spend.
 * @return {{allocations: Array<object>, left: number}} The split.
 */
function spend(bills, cents) {
  let left = Math.max(0, Math.round(Number(cents) || 0));
  const allocations = [];
  for (const b of payOrder(bills)) {
    if (left <= 0) break;
    const pay = Math.min(left, remaining(b));
    allocations.push({billId: b.id, cents: pay});
    left -= pay;
  }
  return {allocations, left};
}

/**
 * Spread a payment over open bills; the leftover becomes driver credit.
 *
 * @param {Array<object>} openBills The driver's bills.
 * @param {number} amountCents The payment.
 * @return {object} {ok, allocations, creditAddedCents} or {ok:false, reason}.
 */
function allocatePayment(openBills, amountCents) {
  const amount = Number(amountCents);
  if (!Number.isFinite(amount) || Math.round(amount) <= 0) {
    return {ok: false, reason: "fleet_no_amount"};
  }
  const {allocations, left} = spend(openBills, amount);
  return {ok: true, allocations, creditAddedCents: left};
}

/**
 * Use a driver's credit on open bills, same order as a payment.
 *
 * @param {Array<object>} openBills The driver's bills.
 * @param {number} creditCents The credit held.
 * @return {{allocations: Array<object>, creditLeftCents: number}} The split.
 */
function applyCredit(openBills, creditCents) {
  const {allocations, left} = spend(openBills, creditCents);
  return {allocations, creditLeftCents: left};
}

/**
 * What a driver owes now. Waived, void and paid bills do not count. nextDue
 * is the soonest bill due today or later (that day's total), else null.
 *
 * @param {Array<object>} bills The driver's bills.
 * @param {number} creditCents The credit held.
 * @param {string} todayKey Today's day key.
 * @return {object} {owedCents, lateCents, nextDue, creditCents}.
 */
function driverBalance(bills, creditCents, todayKey) {
  let owed = 0;
  let late = 0;
  let nextDay = null;
  let nextCents = 0;
  for (const b of bills || []) {
    if (b.status !== "open") continue;
    const r = remaining(b);
    if (r <= 0) continue;
    owed += r;
    if (b.dueDayKey < todayKey) {
      late += r;
    } else if (nextDay === null || b.dueDayKey < nextDay) {
      nextDay = b.dueDayKey;
      nextCents = r;
    } else if (b.dueDayKey === nextDay) {
      nextCents += r;
    }
  }
  return {
    owedCents: owed,
    lateCents: late,
    nextDue: nextDay === null ? null : {dueDayKey: nextDay, cents: nextCents},
    creditCents: Math.max(0, Math.round(Number(creditCents) || 0)),
  };
}

/**
 * Personal cents (1-99, unique) for active drivers. A driver holding a valid
 * value nobody earlier holds keeps it; others get the lowest free value.
 * Order is createdAt then id. Beyond 99 drivers the extra get null.
 *
 * @param {Array<object>} activeDrivers [{id, personalCents, createdAt}].
 * @return {Object<string, number|null>} Driver id to personal cents.
 */
function assignPersonalCents(activeDrivers) {
  const ordered = [...(activeDrivers || [])].sort((x, y) => {
    const a = Number(x.createdAt);
    const b = Number(y.createdAt);
    const byTime = Number.isFinite(a) && Number.isFinite(b) ?
      a - b :
      String(x.createdAt ?? "").localeCompare(String(y.createdAt ?? ""));
    return byTime || String(x.id).localeCompare(String(y.id));
  });
  const taken = new Set();
  const result = {};
  for (const d of ordered) {
    const v = d.personalCents;
    if (Number.isInteger(v) && v >= 1 && v <= 99 && !taken.has(v)) {
      taken.add(v);
      result[d.id] = v;
    }
  }
  let next = 1;
  for (const d of ordered) {
    if (d.id in result) continue;
    while (next <= 99 && taken.has(next)) next++;
    if (next > 99) {
      result[d.id] = null;
    } else {
      taken.add(next);
      result[d.id] = next;
    }
  }
  return result;
}

/**
 * Who had the car on a day: the assigned driver, and the friend (if the
 * office recorded one for that day) who actually drove it. The main driver
 * stays responsible for rent and charged tickets; phase 3 (city tickets)
 * puts the friend's name on a ticket in those dates.
 *
 * @param {object[]} assignments {carId, driverId, startDayKey, endDayKey}.
 * @param {object[]} substitutes {id, carId, fromDayKey, toDayKey, voided?}.
 * @param {string} carId The car.
 * @param {string} dayKey YYYY-MM-DD.
 * @return {{driverId: (string|null), substituteId: (string|null)}} Who.
 */
function whoDroveAt(assignments, substitutes, carId, dayKey) {
  const a = (assignments || []).find((x) => x.carId === carId &&
    x.startDayKey <= dayKey && (!x.endDayKey || x.endDayKey >= dayKey));
  if (!a) return {driverId: null, substituteId: null};
  const s = (substitutes || []).find((x) => x.carId === carId &&
    x.voided !== true && x.fromDayKey <= dayKey && x.toDayKey >= dayKey);
  return {driverId: a.driverId, substituteId: s ? s.id : null};
}

module.exports = {
  FLEET_MESSAGES,
  dayBefore,
  rentPeriods,
  rentBillsToCreate,
  missingRentPeriods,
  nextUnbilledPeriodStart,
  termsAt,
  billAfterReturn,
  lateFeesToCreate,
  allocatePayment,
  applyCredit,
  driverBalance,
  assignPersonalCents,
  whoDroveAt,
};
