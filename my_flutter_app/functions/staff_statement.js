"use strict";

/**
 * Staff statements for parking businesses (docs/PARKING_INVOICES.md section 6).
 *
 * A TEAM MEMBER (a person whose own cars are team cars - month-end customer
 * key `staff:{uid}` - and/or who is linked to a parking customer through
 * `staffParkingLinks`) is not invoiced like a customer: they get ONE
 * statement for the month, and Month end shows the very same numbers:
 *
 *   parking + lot jobs of the month (plus anything unpaid from before)
 *   - the lot expenses they paid that are not yet credited (cumulative to
 *     the end of the month, so a September expense counts in October)
 *   + the cash they hold for the business at the END of the month
 *   = what they owe the business (negative: the business owes them)
 *
 * This is Staff balances' net (held + parking due - expenses owed to them)
 * told as of a month's last moment: because the parking bill and the credit
 * are both cumulative, `parking - credit` is the same number whether the
 * credit is spent on the bill or left over.
 *
 * Pure: no Firestore, no clock. Mirrored by the console's
 * `staff-statement.ts` and the app's `staff_statement.dart`;
 * `test/fixtures/staff-statement-cases.json` is run by all of them.
 */

const {
  dayKeyOf,
  dayNumber,
  parkingMonthCustomerPaid,
} = require("./parking_month_statement");
const {
  earlierExpenseCents,
  expenseLineLabels,
  monthExpenseLines,
  staffCredits,
} = require("./staff_expense_credit");
const {
  applyHandovers,
  collectReceipts,
  HANDOVER_STATUS,
  isBusinessAccount,
} = require("./staff_balances");
const {msOf} = require("./parking_whatsapp");

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const TIME_ZONE = "America/New_York";

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
// Signed whole cents (the cash a person holds can be below zero).
const signed = (value) => Math.round(Number(value) || 0);
const objects = (list) => (Array.isArray(list) ? list : [])
    .filter((x) => x && typeof x === "object");

// ---------------------------------------------------------------------------
// The end of a month, in New York
// ---------------------------------------------------------------------------

/**
 * The hour of day (0-23) of an instant in New York.
 *
 * @param {number} ms The instant.
 * @return {{year: number, month: number, day: number, hour: number}} Its
 *   New York wall-clock parts.
 */
function zonedParts(ms) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return {year: get("year"), month: get("month"), day: get("day"),
    hour: get("hour")};
}

/**
 * The last moment of a month in New York.
 *
 * @param {string} monthKey "yyyy-mm".
 * @return {number} The instant (ms) one millisecond before the next
 *   month's first midnight in New York; 0 for a bad month.
 */
function monthEndMs(monthKey) {
  const key = text(monthKey, 7);
  if (!MONTH.test(key)) return 0;
  const [year, month] = key.split("-").map(Number);
  // First midnight of the next month, New York: 04:00Z (EDT) or 05:00Z (EST).
  const base = Date.UTC(year, month, 1);
  for (const hours of [4, 5]) {
    const candidate = base + hours * 3600 * 1000;
    const p = zonedParts(candidate);
    if (p.hour === 0 && p.day === 1) return candidate - 1;
  }
  return base + 5 * 3600 * 1000 - 1;
}

// ---------------------------------------------------------------------------
// Cash held as of an instant
// ---------------------------------------------------------------------------

/**
 * When each receipt was collected, by `id` per source, from the rows the
 * receipts came from. 0 means "not recorded": such money is old enough to
 * have been counted before anything that has a date.
 *
 * @param {object} sources As collectReceipts' sources.
 * @return {function(object): number} The receipt's time in ms (0 unknown).
 */
function receiptTimes(sources) {
  const s = sources && typeof sources === "object" ? sources : {};
  const byId = (rows) => new Map(objects(rows)
      .map((row) => [text(row.id), row]));
  const cars = byId(s.parkedCars);
  const activities = byId(s.lotActivities);
  const activityPayments = byId(s.lotActivityPayments);
  const rows = {
    package: byId(s.containerLinePayments),
    inventory: byId(s.inventorySales),
    inventory_credit: byId(s.inventoryCreditPayments),
    invoice: byId(s.invoicePayments),
  };
  return (r) => {
    if (r.source === "parking") {
      const [carId, index] = text(r.id).split("#");
      const car = cars.get(carId) || {};
      if (index !== undefined) {
        const live = objects(car.parkingPayments)
            .filter((p) => p.reverted !== true);
        return msOf(live[Number(index)]?.at);
      }
      // What the car carries beyond its listed payments: when it was marked
      // paid. Never the record's `updatedAt`: any later edit moves that.
      return msOf(car.directPaymentReceivedAt) || msOf(car.paidAt);
    }
    if (r.source === "activity") {
      const payment = activityPayments.get(text(r.id));
      if (payment) return msOf(payment.paidAt) || msOf(payment.createdAt);
      return msOf(activities.get(text(r.id))?.paidAt);
    }
    const row = rows[r.source]?.get(text(r.id)) || {};
    return msOf(row.paidAt) || msOf(row.soldAt) || msOf(row.createdAt);
  };
}

/**
 * When a handover took effect: its confirmation (an opening amount is
 * confirmed as it is made).
 *
 * @param {object} handover A staffHandovers row.
 * @return {number} Ms, 0 when not recorded.
 */
function handoverMs(handover) {
  return Number(handover?.confirmedAtMs) || msOf(handover?.confirmedAt) ||
    Number(handover?.createdAtMs) || msOf(handover?.createdAt);
}

/**
 * The money each person held for the business at a moment: what they had
 * collected by then (the kinds of money the business counts, Staff
 * balances' "What counts"), minus the handovers they had given and plus
 * those they had received, counting only handovers CONFIRMED by then.
 * Payments and handovers after the moment change nothing.
 *
 * @param {object} input `{sources (collectReceipts), counted
 *   (businesses.staffBalanceSources), handovers (staffHandovers rows with
 *   confirmedAtMs / createdAtMs), asOfMs, now (Date, for open parking
 *   stays; defaults to the moment)}`.
 * @return {object} `{[staffId]: heldCents}` (signed), for everyone with any
 *   money in or out by then.
 */
function staffHeldAsOf(input) {
  const asOfMs = Number(input?.asOfMs) || 0;
  const now = input?.now instanceof Date ? input.now :
    new Date(Number(input?.now) || asOfMs);
  const timeOf = receiptTimes(input?.sources);
  const receipts = collectReceipts(input?.sources, now, input?.counted)
      .filter((r) => {
        if (isBusinessAccount(r.staffId)) return false;
        const at = timeOf(r);
        return !(at > 0) || at <= asOfMs;
      });
  const handovers = objects(input?.handovers).filter((h) => {
    if (text(h.status, 20) !== HANDOVER_STATUS.CONFIRMED) return false;
    const at = handoverMs(h);
    return !(at > 0) || at <= asOfMs;
  });
  const {people} = applyHandovers(receipts, handovers);
  const out = {};
  for (const [id, money] of Object.entries(people)) {
    out[id] = signed(money.heldCents);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The statements
// ---------------------------------------------------------------------------

/**
 * The team member a month-end customer is billed under: the member whose
 * own cars they are (`staff:{uid}`), or the ONE member linked to them. A
 * customer linked to several members stays a customer.
 *
 * @param {object} customer A netted month-end customer
 *   `{key, linkedStaffIds}`.
 * @return {string} The staff id, "" for a customer.
 */
function memberOf(customer) {
  const key = text(customer?.key, 200);
  if (key.startsWith("staff:")) return key.slice(6);
  const ids = Array.isArray(customer?.linkedStaffIds) ?
    customer.linkedStaffIds.filter(Boolean) : [];
  return ids.length === 1 ? text(ids[0], 128) : "";
}

/**
 * Several of one person's bills as one.
 *
 * @param {object[]} bills Their netted month-end customers, primary first.
 * @param {string} name The name to show.
 * @return {object} A month-end customer (cars, activities, older items and
 *   the money fields added up).
 */
function mergedBill(bills, name) {
  const sum = (k) => bills.reduce((s, b) => s + (Number(b[k]) || 0), 0);
  const all = (k) => bills.flatMap((b) => Array.isArray(b[k]) ? b[k] : []);
  const first = bills[0] || {};
  const dueCents = sum("dueBeforeExpensesCents");
  const monthCents = sum("monthCents");
  return {
    ...first,
    customerName: name || text(first.customerName, 120),
    customerPhone: text(bills.find((b) => text(b.customerPhone))
        ?.customerPhone, 40),
    cars: all("cars"),
    activities: all("activities"),
    olderActivities: all("olderActivities"),
    olderCars: all("olderCars"),
    monthCents,
    monthPaidCents: sum("monthPaidCents"),
    monthUnpaidCents: sum("monthUnpaidCents"),
    priorUnpaidCents: sum("priorUnpaidCents"),
    dueCents,
    dueBeforeExpensesCents: dueCents,
    owes: dueCents > 0,
    paid: parkingMonthCustomerPaid({monthCents, dueCents}),
  };
}

/**
 * Each team member's statement for the month.
 *
 * @param {object[]} customers The month's customers AFTER staff expenses
 *   were netted (parking_invoices.nettedCustomers): each has
 *   `dueBeforeExpensesCents` and `linkedStaffIds`.
 * @param {object} ctx `{monthKey, entries (lotExpenseEntries rows, standing
 *   payers included, `spentAtMs`), repayments, lines (lotExpenseLines),
 *   staffNames, held ({[staffId]: cash held at the month's end, cents})}`.
 * @return {{statements: object[], customerKeys: object}} Statements by
 *   name; `customerKeys` maps every month-end customer key that belongs to
 *   a statement to its staff id (those customers are NOT invoiced and show
 *   no figures of their own). Each statement: `{staffId, name, key (the card
 *   that carries it), customerKeys, monthKey, monthCents, priorUnpaidCents,
 *   monthPaidCents, parkingJobsCents, expenseCents, expenseLines,
 *   earlierExpenseCents, cashHeldCents, owesCents, stillParked, customer
 *   (the person's bills as one month-end customer)}`.
 */
function staffStatements(customers, ctx) {
  const monthKey = text(ctx?.monthKey, 7);
  const names = ctx?.staffNames && typeof ctx.staffNames === "object" ?
    ctx.staffNames : {};
  const held = ctx?.held && typeof ctx.held === "object" ? ctx.held : {};
  const entries = objects(ctx?.entries);
  const credits = staffCredits(entries, ctx?.repayments, monthKey);
  const labels = expenseLineLabels(ctx?.lines || []);
  const byMember = new Map();
  const customerKeys = {};
  for (const customer of objects(customers)) {
    const staffId = memberOf(customer);
    if (!staffId) continue;
    if (!byMember.has(staffId)) byMember.set(staffId, []);
    byMember.get(staffId).push(customer);
    customerKeys[text(customer.key, 200)] = staffId;
  }
  const statements = [];
  for (const [staffId, bills] of byMember) {
    // The card that carries the statement: their own cars first.
    bills.sort((a, b) =>
      Number(!text(a.key).startsWith("staff:")) -
        Number(!text(b.key).startsWith("staff:")) ||
      text(a.key).localeCompare(text(b.key)));
    const name = text(names[staffId], 120) ||
      text(bills.find((b) => text(b.key).startsWith("staff:"))
          ?.customerName, 120) || text(bills[0].customerName, 120);
    const customer = mergedBill(bills, name);
    const parkingJobsCents = customer.dueCents;
    const expenseCents = credits[staffId]?.creditCents || 0;
    const expenseLines = monthExpenseLines(entries, monthKey, [staffId],
        labels).map((l) => {
      const day = l.spentAtMs > 0 ? dayNumber(new Date(l.spentAtMs)) : null;
      return {
        id: l.id,
        date: day === null ? "" : dayKeyOf(day),
        label: l.label,
        lineLabel: l.lineLabel,
        note: l.note,
        amountCents: l.amountCents,
        staffId,
        staffName: name,
      };
    });
    const cashHeldCents = signed(held[staffId]);
    const owesCents = parkingJobsCents - expenseCents + cashHeldCents;
    statements.push({
      staffId,
      name,
      key: text(bills[0].key, 200),
      customerKeys: bills.map((b) => text(b.key, 200)),
      monthKey,
      monthCents: customer.monthCents,
      priorUnpaidCents: customer.priorUnpaidCents,
      monthPaidCents: customer.monthPaidCents,
      parkingJobsCents,
      expenseCents,
      expenseLines,
      earlierExpenseCents: earlierExpenseCents(expenseCents, expenseLines),
      cashHeldCents,
      owesCents,
      stillParked: customer.cars.some((b) => b.stillParked === true),
      customer: {...customer, linkedStaffIds: [staffId],
        expenseCreditCents: expenseCents, expenseLines,
        earlierExpenseCents: earlierExpenseCents(expenseCents, expenseLines)},
    });
  }
  statements.sort((a, b) => a.name.localeCompare(b.name) ||
    a.staffId.localeCompare(b.staffId));
  return {statements, customerKeys};
}

module.exports = {
  handoverMs,
  memberOf,
  monthEndMs,
  receiptTimes,
  staffHeldAsOf,
  staffStatements,
};
