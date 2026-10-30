"use strict";

/**
 * Staff balances: who holds the business's money and who owes what
 * (docs/STAFF_BALANCES.md).
 *
 *   held = collected (payments naming the person as receiver, except those
 *          received by the Business account) - confirmed handovers out
 *          + confirmed handovers in
 *   net  = held + parking due after expenses - what the business owes them
 *          for expenses
 *
 * Pure: no Firestore, no clock. The callable (`updateLotExpenseEntry`
 * action `staff_balances`) gathers the rows and calls `staffBalances`; the
 * console and the app only render the answer, from the shared fixture
 * `test/fixtures/staff-balances-cases.json`.
 */

const {
  dayNumber,
  paidNowCents,
  paymentCents,
} = require("./parking_month_statement");
const {
  netStaffExpenses,
  staffCredits,
} = require("./staff_expense_credit");

/** Money paid straight to the business (Zelle, transfer, card, links). */
const BUSINESS_ACCOUNT_RECEIVER = "business_account";

const HANDOVER_METHODS = Object.freeze(
    ["cash", "zelle", "check", "deposit", "other"]);
const HANDOVER_STATUS = Object.freeze({
  PENDING: "pending",
  CONFIRMED: "confirmed",
  DECLINED: "declined",
  VOIDED: "voided",
});
const HANDOVER_KIND = Object.freeze({
  HANDOVER: "handover",
  OPENING: "opening",
});
const MAX_HANDOVER_CENTS = 100000000;
const MAX_NOTE = 300;

const HANDOVER_MESSAGES = Object.freeze({
  handover_to_self: "You cannot hand money over to yourself.",
  handover_amount_invalid: "Enter how much was handed over.",
  handover_method_invalid: "Choose how the money was handed over.",
  handover_receiver_invalid:
    "Choose a person of this business, or the Business account.",
  handover_proof_invalid: "The photo could not be used. Add it again.",
  handover_not_found: "This handover was not found.",
  handover_not_receiver: "Only the person receiving this money can answer it.",
  handover_not_pending: "This handover was already answered.",
  handover_voided: "This handover is already voided.",
  handover_void_not_allowed:
    "Only the person who handed it over (while it waits) or the owner can " +
    "void a handover.",
  opening_owner_only: "Only the owner can record an opening amount.",
  opening_amount_invalid: "Enter the amount already handed over.",
  staff_not_member: "This person is not on this business's staff.",
  staff_balances_action_invalid: "Unknown action.",
  counted_sources_owner_only:
    "Only the owner can choose what counts as the business's money.",
  counted_sources_invalid: "Choose what counts as the business's money.",
});

const REFUSAL_KIND = Object.freeze({
  handover_to_self: "invalid-argument",
  handover_amount_invalid: "invalid-argument",
  handover_method_invalid: "invalid-argument",
  handover_receiver_invalid: "failed-precondition",
  handover_proof_invalid: "invalid-argument",
  handover_not_found: "not-found",
  handover_not_receiver: "permission-denied",
  handover_not_pending: "failed-precondition",
  handover_voided: "failed-precondition",
  handover_void_not_allowed: "permission-denied",
  opening_owner_only: "permission-denied",
  opening_amount_invalid: "invalid-argument",
  staff_not_member: "failed-precondition",
  staff_balances_action_invalid: "invalid-argument",
  counted_sources_owner_only: "permission-denied",
  counted_sources_invalid: "invalid-argument",
});

const STAFF_BALANCE_ACTIONS = Object.freeze([
  "staff_balances",
  "record_handover",
  "confirm_handover",
  "decline_handover",
  "void_handover",
  "record_opening",
  "set_counted_sources",
]);

// Which kinds of money count as the business's (docs/STAFF_BALANCES.md §7):
// each business decides. Invoices are off unless the owner turns them on -
// at Keren they are staff's own car sales, not the business's money.
const COUNTED_SOURCE_KEYS = Object.freeze(
    ["parking", "activity", "package", "shop", "invoice"]);
const COUNTED_SOURCE_DEFAULTS = Object.freeze({
  parking: true, activity: true, package: true, shop: true, invoice: false,
});
// A receipt's `source` and the setting that decides it.
const RECEIPT_SOURCE_KEY = Object.freeze({
  parking: "parking",
  activity: "activity",
  package: "package",
  inventory: "shop",
  inventory_credit: "shop",
  invoice: "invoice",
});

/**
 * The business's choice, every key filled from the defaults.
 *
 * @param {*} stored `businesses.staffBalanceSources`.
 * @return {object} `{parking, activity, package, shop, invoice}` booleans.
 */
function countedSources(stored) {
  const given = stored && typeof stored === "object" ? stored : {};
  const out = {};
  for (const key of COUNTED_SOURCE_KEYS) {
    out[key] = typeof given[key] === "boolean" ? given[key] :
      COUNTED_SOURCE_DEFAULTS[key];
  }
  return out;
}

/**
 * A new choice as sent by the owner: only the known keys, only booleans.
 *
 * @param {*} value The request's `sources`.
 * @return {?object} The full choice, or null when nothing valid was sent.
 */
function cleanCountedSources(value) {
  if (!value || typeof value !== "object") return null;
  const keys = COUNTED_SOURCE_KEYS.filter((k) =>
    typeof value[k] === "boolean");
  if (keys.length === 0) return null;
  return countedSources(Object.fromEntries(keys.map((k) => [k, value[k]])));
}

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const cents = (value) => {
  const n = Math.round(Number(value) || 0);
  return n > 0 ? n : 0;
};

/**
 * @param {*} id A `receivedByStaffId` / `toId`.
 * @return {boolean} True for the Business account.
 */
function isBusinessAccount(id) {
  return text(id, 128) === BUSINESS_ACCOUNT_RECEIVER;
}

/**
 * @param {string} code A refusal code.
 * @return {object} `{kind, message}` for an HttpsError.
 */
function handoverRefusal(code) {
  return {
    kind: REFUSAL_KIND[code] || "failed-precondition",
    message: HANDOVER_MESSAGES[code] || code,
  };
}

/**
 * @param {*} value Cents as sent.
 * @return {?number} Whole cents 1..MAX, or null.
 */
function cleanHandoverCents(value) {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 1 && value <= MAX_HANDOVER_CENTS ? value : null;
}

/**
 * Why a handover cannot be recorded, from the request alone (whether the
 * receiver is a person of the business is the callable's read).
 *
 * @param {object} input `{fromStaffId, toId, amountCents, method}`.
 * @return {string} A refusal code or "".
 */
function recordHandoverRefusal(input) {
  if (cleanHandoverCents(input?.amountCents) === null) {
    return "handover_amount_invalid";
  }
  if (!HANDOVER_METHODS.includes(text(input?.method, 20))) {
    return "handover_method_invalid";
  }
  const toId = text(input?.toId, 128);
  if (!toId || toId.includes("/")) return "handover_receiver_invalid";
  if (toId === text(input?.fromStaffId, 128)) return "handover_to_self";
  return "";
}

/**
 * The `staffHandovers` row of a new handover (without its timestamps).
 *
 * @param {object} data The request `{toId, amountCents, method, note,
 *   proofPath}`.
 * @param {object} ctx `{businessId, uid}` - the caller is the giver.
 * @return {object} The row, status pending.
 */
function handoverRecord(data, ctx) {
  return {
    businessId: text(ctx?.businessId, 160),
    kind: HANDOVER_KIND.HANDOVER,
    fromStaffId: text(ctx?.uid, 128),
    toId: text(data?.toId, 128),
    amountCents: cleanHandoverCents(data?.amountCents) || 0,
    method: text(data?.method, 20),
    note: text(data?.note, MAX_NOTE),
    proofPath: text(data?.proofPath, 300),
    status: HANDOVER_STATUS.PENDING,
    createdByUid: text(ctx?.uid, 128),
    confirmedByUid: "",
    declinedByUid: "",
    declineNote: "",
    voidedByUid: "",
    voidReason: "",
  };
}

/**
 * The row of an opening handover: the owner clears what a person handed
 * over before staff balances existed - from the person to the Business
 * account, recorded and confirmed in one step.
 *
 * @param {object} data The request `{staffId, amountCents, note}`.
 * @param {object} ctx `{businessId, uid}` - the owner.
 * @return {object} The row, status confirmed.
 */
function openingRecord(data, ctx) {
  return {
    businessId: text(ctx?.businessId, 160),
    kind: HANDOVER_KIND.OPENING,
    fromStaffId: text(data?.staffId, 128),
    toId: BUSINESS_ACCOUNT_RECEIVER,
    amountCents: cleanHandoverCents(data?.amountCents) || 0,
    method: "other",
    note: text(data?.note, MAX_NOTE),
    proofPath: "",
    status: HANDOVER_STATUS.CONFIRMED,
    createdByUid: text(ctx?.uid, 128),
    confirmedByUid: text(ctx?.uid, 128),
    declinedByUid: "",
    declineNote: "",
    voidedByUid: "",
    voidReason: "",
  };
}

/**
 * Whether a stored handover is this business's.
 *
 * @param {?object} handover The stored row (null when missing).
 * @param {string} businessId The business the caller acts for.
 * @return {boolean} True when it exists and belongs to the business.
 */
function handoverIsOf(handover, businessId) {
  return Boolean(handover) &&
    text(handover.businessId, 160) === text(businessId, 160);
}

/**
 * Why the caller may not confirm or decline a handover, or "". Only the
 * receiver answers; for the Business account that is the owner (or a
 * platform admin).
 *
 * @param {?object} handover The stored row (null when missing).
 * @param {object} ctx `{uid, businessId, isOwner}`.
 * @return {string} A refusal code or "".
 */
function handoverAnswerRefusal(handover, ctx) {
  if (!handoverIsOf(handover, ctx?.businessId)) return "handover_not_found";
  const toId = text(handover.toId, 128);
  const mayAnswer = toId === BUSINESS_ACCOUNT_RECEIVER ?
    ctx?.isOwner === true : toId === text(ctx?.uid, 128);
  if (!mayAnswer) return "handover_not_receiver";
  if (text(handover.status, 20) !== HANDOVER_STATUS.PENDING) {
    return "handover_not_pending";
  }
  return "";
}

/**
 * Why the caller may not void a handover, or "". The giver while it is
 * pending; the owner (or a platform admin) any time; never twice.
 *
 * @param {?object} handover The stored row (null when missing).
 * @param {object} ctx `{uid, businessId, isOwner}`.
 * @return {string} A refusal code or "".
 */
function handoverVoidRefusal(handover, ctx) {
  if (!handoverIsOf(handover, ctx?.businessId)) return "handover_not_found";
  const status = text(handover.status, 20);
  if (status === HANDOVER_STATUS.VOIDED) return "handover_voided";
  if (ctx?.isOwner === true) return "";
  const giver = text(handover.fromStaffId, 128) === text(ctx?.uid, 128);
  return giver && status === HANDOVER_STATUS.PENDING ? "" :
    "handover_void_not_allowed";
}

/**
 * How a payment's method reads as a key: lower case, "other" when absent.
 *
 * @param {*} value A `receivedVia` / `method`.
 * @return {string} The key.
 */
function methodKey(value) {
  return text(value, 40).toLowerCase() || "other";
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
 * Parking money held by a person. The listed payments name their own
 * receiver; what the car carries beyond them (a car marked paid in full,
 * or paid after instalments) belongs to the record's receiver. Reverted
 * payments and voided cars count for nothing.
 *
 * @param {object[]} cars parkedCars rows (with `id`).
 * @param {Date} now The moment.
 * @return {object[]} Receipts.
 */
function parkingReceipts(cars, now) {
  const out = [];
  const today = dayNumber(now);
  for (const car of objects(cars)) {
    if (car.voided === true || text(car.status, 40) === "cancelled") continue;
    const list = objects(car.parkingPayments);
    const live = list.filter((p) => p.reverted !== true);
    let listed = 0;
    live.forEach((p, i) => {
      const amountCents = paymentCents(p);
      listed += amountCents;
      const staffId = text(p.receivedByStaffId, 128);
      if (amountCents > 0 && staffId) {
        out.push({source: "parking", id: `${text(car.id)}#${i}`, staffId,
          amountCents, method: methodKey(p.receivedVia)});
      }
    });
    const staffId = text(car.receivedByStaffId, 128);
    if (!staffId || today === null) continue;
    const rest = paidNowCents(car, today) - listed;
    if (rest > 0) {
      const last = live.length > 0 ? live[live.length - 1].receivedVia : "";
      out.push({source: "parking", id: text(car.id), staffId,
        amountCents: rest,
        method: methodKey(car.directPaymentMethod || last)});
    }
  }
  return out;
}

/**
 * Lot activity money held by a person: every live instalment that names a
 * receiver, plus what an activity was settled for beyond its instalments
 * (paid in one go before instalments existed, or marked received at
 * creation). Voided activities and reverted instalments count for nothing.
 *
 * @param {object[]} activities lotActivities rows (with `id`).
 * @param {object[]} payments lotActivityPayments rows.
 * @return {object[]} Receipts.
 */
function activityReceipts(activities, payments) {
  const out = [];
  const voided = new Set();
  const liveByActivity = {};
  for (const a of objects(activities)) {
    if (a.voided === true) voided.add(text(a.id));
  }
  for (const p of objects(payments)) {
    const activityId = text(p.activityId);
    if (p.reverted === true || voided.has(activityId)) continue;
    const amountCents = cents(p.amountCents);
    liveByActivity[activityId] = (liveByActivity[activityId] || 0) +
      amountCents;
    const staffId = text(p.receivedByStaffId, 128);
    if (amountCents > 0 && staffId) {
      out.push({source: "activity", id: text(p.id), staffId, amountCents,
        method: methodKey(p.receivedVia)});
    }
  }
  for (const a of objects(activities)) {
    const staffId = text(a.receivedByStaffId, 128);
    if (a.voided === true || !staffId) continue;
    const stored = cents(a.amountPaidCents);
    const settled = stored > 0 ? stored :
      (text(a.paymentStatus, 40) === "succeeded" ? cents(a.feeCents) : 0);
    const rest = settled - (liveByActivity[text(a.id)] || 0);
    if (rest > 0) {
      out.push({source: "activity", id: text(a.id), staffId,
        amountCents: rest, method: methodKey(a.receivedVia)});
    }
  }
  return out;
}

/**
 * Inventory money held by a person: what each live sale took at the
 * counter, and every live payment on a credit. Voided sales (and the
 * payments behind them) count for nothing.
 *
 * @param {object[]} sales inventorySales rows (with `id`).
 * @param {object[]} payments inventoryCreditPayments rows.
 * @return {object[]} Receipts.
 */
function inventoryReceipts(sales, payments) {
  const out = [];
  const voided = new Set();
  for (const s of objects(sales)) {
    if (s.voided === true) {
      voided.add(text(s.id));
      continue;
    }
    const staffId = text(s.receivedByStaffId, 128);
    // A sale from before credit existed took its whole total.
    const taken = s.paidNowCents === undefined || s.paidNowCents === null ?
      cents(s.totalCents) : cents(s.paidNowCents);
    if (staffId && taken > 0) {
      out.push({source: "inventory", id: text(s.id), staffId,
        amountCents: taken, method: methodKey(s.paymentMethod)});
    }
  }
  for (const p of objects(payments)) {
    const staffId = text(p.receivedByStaffId, 128);
    if (p.reverted === true || voided.has(text(p.saleId)) || !staffId) {
      continue;
    }
    if (cents(p.amountCents) > 0) {
      out.push({source: "inventory_credit", id: text(p.id), staffId,
        amountCents: cents(p.amountCents), method: methodKey(p.method)});
    }
  }
  return out;
}

/**
 * Package and invoice payments held by a person. A payment the customer
 * made by card online (`source: "card_order"`) has no one holding it.
 *
 * @param {object[]} payments containerLinePayments rows.
 * @param {object[]} invoicePayments invoicePayments rows.
 * @return {object[]} Receipts.
 */
function packageAndInvoiceReceipts(payments, invoicePayments) {
  const out = [];
  for (const p of objects(payments)) {
    const staffId = text(p.receivedByStaffId, 128);
    const online = text(p.source, 40) === "card_order";
    if (p.reverted === true || !staffId || online) continue;
    if (cents(p.amountCents) > 0) {
      out.push({source: "package", id: text(p.id), staffId,
        amountCents: cents(p.amountCents), method: methodKey(p.method)});
    }
  }
  for (const p of objects(invoicePayments)) {
    const staffId = text(p.receivedByStaffId, 128);
    if (p.reverted === true || !staffId) continue;
    if (cents(p.amountCents) > 0) {
      out.push({source: "invoice", id: text(p.id), staffId,
        amountCents: cents(p.amountCents), method: methodKey(p.method)});
    }
  }
  return out;
}

/**
 * Every payment a person is named as receiving, from each source, as
 * `{source, id, staffId, amountCents, method}`. Payments received by the
 * Business account are kept (staffId `business_account`) so the business's
 * own total can be shown; applyHandovers keeps them out of every person's
 * collected money. Payments with no receiver (online card, payment links)
 * are not receipts.
 *
 * @param {object} sources `{parkedCars, lotActivities, lotActivityPayments,
 *   containerLinePayments, inventorySales, inventoryCreditPayments,
 *   invoicePayments}`, each an array of rows (with `id`).
 * @param {Date} [now] The moment (an open parking stay is worked out to it).
 * @param {object} [counted] `businesses.staffBalanceSources`: kinds of money
 *   the business switched off are left out (countedSources' defaults).
 * @return {object[]} Receipts.
 */
function collectReceipts(sources, now = new Date(), counted = undefined) {
  const s = sources && typeof sources === "object" ? sources : {};
  const on = countedSources(counted);
  return [
    ...parkingReceipts(s.parkedCars, now),
    ...activityReceipts(s.lotActivities, s.lotActivityPayments),
    ...inventoryReceipts(s.inventorySales, s.inventoryCreditPayments),
    ...packageAndInvoiceReceipts(s.containerLinePayments, s.invoicePayments),
  ].filter((r) => on[RECEIPT_SOURCE_KEY[r.source]] !== false);
}

/**
 * @return {object} A person's money, all zero.
 */
function emptyPerson() {
  return {
    collectedCents: 0,
    collectedByMethod: {},
    handedOutCents: 0,
    receivedFromOthersCents: 0,
    pendingOutCents: 0,
    pendingInCents: 0,
    heldCents: 0,
  };
}

/**
 * Receipts and handovers put together: what each person collected, what
 * they handed over and received (confirmed only), what is still waiting,
 * and so what they hold. A pending handover changes nothing until it is
 * confirmed; declined and voided ones never do.
 *
 * @param {object[]} receipts From collectReceipts.
 * @param {object[]} handovers `staffHandovers` rows
 *   `{kind, fromStaffId, toId, amountCents, status}`.
 * @return {object} `{people: {[staffId]: money}, businessAccount:
 *   {receivedCents, pendingInCents}}`.
 */
function applyHandovers(receipts, handovers) {
  const people = {};
  const person = (id) => {
    if (!people[id]) people[id] = emptyPerson();
    return people[id];
  };
  const businessAccount = {receivedCents: 0, pendingInCents: 0};
  for (const r of objects(receipts)) {
    const amount = cents(r.amountCents);
    if (amount <= 0) continue;
    if (isBusinessAccount(r.staffId)) {
      businessAccount.receivedCents += amount;
      continue;
    }
    const p = person(text(r.staffId, 128));
    p.collectedCents += amount;
    const method = methodKey(r.method);
    p.collectedByMethod[method] = (p.collectedByMethod[method] || 0) + amount;
  }
  for (const h of objects(handovers)) {
    const amount = cents(h.amountCents);
    const from = text(h.fromStaffId, 128);
    const to = text(h.toId, 128);
    const status = text(h.status, 20);
    if (amount <= 0 || !from || !to) continue;
    const confirmed = status === HANDOVER_STATUS.CONFIRMED;
    const pending = status === HANDOVER_STATUS.PENDING;
    if (!confirmed && !pending) continue;
    if (confirmed) person(from).handedOutCents += amount;
    else person(from).pendingOutCents += amount;
    if (isBusinessAccount(to)) {
      if (confirmed) businessAccount.receivedCents += amount;
      else businessAccount.pendingInCents += amount;
    } else if (confirmed) {
      person(to).receivedFromOthersCents += amount;
    } else {
      person(to).pendingInCents += amount;
    }
  }
  for (const p of Object.values(people)) {
    p.heldCents = p.collectedCents - p.handedOutCents +
      p.receivedFromOthersCents;
  }
  return {people, businessAccount};
}

/**
 * What each person owes on parking after their expenses, and what the
 * business still owes them for expenses - the month-end netting
 * (staff_expense_credit.netStaffExpenses), cumulative to `monthKey`.
 *
 * A customer linked to several staff has the bill left after expenses split
 * evenly among them (the odd cent to the first by id).
 *
 * @param {?object} netting `{monthKey, customers (month-end customers
 *   `{key, dueCents}`), entries, repayments, links}`; null for none.
 * @return {object} `{[staffId]: {parkingDueCents, expenseCreditCents,
 *   expenseOwedToThemCents}}`, only for people with something.
 */
function parkingNetting(netting) {
  const out = {};
  if (!netting || typeof netting !== "object") return out;
  const slot = (id) => {
    if (!out[id]) {
      out[id] = {parkingDueCents: 0, expenseCreditCents: 0,
        expenseOwedToThemCents: 0};
    }
    return out[id];
  };
  const net = netStaffExpenses(netting.customers, {
    entries: netting.entries,
    repayments: netting.repayments,
    links: netting.links,
    monthKey: netting.monthKey,
    staffNames: {},
  });
  const leftover = {};
  for (const owed of net.businessOwes) leftover[owed.staffId] = owed.owedCents;
  const credits = staffCredits(netting.entries, netting.repayments,
      netting.monthKey);
  for (const [id, credit] of Object.entries(credits)) {
    const rest = leftover[id] || 0;
    if (credit.creditCents <= 0) continue;
    const p = slot(id);
    p.expenseOwedToThemCents = rest;
    p.expenseCreditCents = credit.creditCents - rest;
  }
  for (const customer of net.customers) {
    const ids = [...(customer.linkedStaffIds || [])].sort();
    const due = cents(customer.dueCents);
    if (ids.length === 0 || due <= 0) continue;
    const each = Math.floor(due / ids.length);
    ids.forEach((id, i) => {
      const extra = i === 0 ? due - each * ids.length : 0;
      slot(id).parkingDueCents += each + extra;
    });
  }
  return out;
}

/**
 * One row per person with the netting folded in:
 * `net = held + parkingDue - expenseOwedToThem` (positive: owes the
 * business; negative: the business owes them).
 *
 * @param {object} applied From applyHandovers.
 * @param {object} nettingByStaff From parkingNetting.
 * @param {object} staffNames `{[staffId]: name}` - the business's people;
 *   everyone listed gets a row even with nothing.
 * @return {object[]} The rows, by name then id.
 */
function netBalances(applied, nettingByStaff, staffNames) {
  const names = staffNames && typeof staffNames === "object" ? staffNames : {};
  const people = applied?.people || {};
  const netting = nettingByStaff || {};
  const ids = new Set([...Object.keys(names), ...Object.keys(people),
    ...Object.keys(netting)].filter((id) => id && !isBusinessAccount(id)));
  const rows = [...ids].map((staffId) => {
    const money = people[staffId] || emptyPerson();
    const n = netting[staffId] || {parkingDueCents: 0, expenseCreditCents: 0,
      expenseOwedToThemCents: 0};
    return {
      staffId,
      name: text(names[staffId], 120),
      collectedCents: money.collectedCents,
      collectedByMethod: money.collectedByMethod,
      handedOutCents: money.handedOutCents,
      receivedFromOthersCents: money.receivedFromOthersCents,
      pendingOutCents: money.pendingOutCents,
      pendingInCents: money.pendingInCents,
      heldCents: money.heldCents,
      parkingDueCents: n.parkingDueCents,
      expenseCreditCents: n.expenseCreditCents,
      expenseOwedToThemCents: n.expenseOwedToThemCents,
      netCents: money.heldCents + n.parkingDueCents -
        n.expenseOwedToThemCents,
    };
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name) ||
    a.staffId.localeCompare(b.staffId));
}

/**
 * The handovers waiting on someone, as the answer lists them.
 *
 * @param {object[]} handovers `staffHandovers` rows (with `id`,
 *   `createdAtMs`).
 * @param {object} names `{[staffId]: name}`.
 * @return {object[]} Oldest first.
 */
function pendingHandovers(handovers, names) {
  return objects(handovers)
      .filter((h) => text(h.status, 20) === HANDOVER_STATUS.PENDING)
      .map((h) => ({
        id: text(h.id, 128),
        kind: text(h.kind, 20) || HANDOVER_KIND.HANDOVER,
        fromStaffId: text(h.fromStaffId, 128),
        fromName: text(names[text(h.fromStaffId, 128)], 120),
        toId: text(h.toId, 128),
        toName: text(names[text(h.toId, 128)], 120),
        amountCents: cents(h.amountCents),
        method: text(h.method, 20),
        note: text(h.note, MAX_NOTE),
        proofPath: text(h.proofPath, 300),
        status: HANDOVER_STATUS.PENDING,
        createdByUid: text(h.createdByUid, 128),
        createdAtMs: Number(h.createdAtMs) || 0,
      }))
      .sort((a, b) => a.createdAtMs - b.createdAtMs ||
        a.id.localeCompare(b.id));
}

/**
 * The `staff_balances` answer (docs/STAFF_BALANCES.md §3).
 *
 * @param {object} input `{now (Date or ms), staffNames, sources
 *   (collectReceipts), counted (businesses.staffBalanceSources), handovers,
 *   netting (parkingNetting)}`.
 * @return {object} `{asOfMs, counted, staff, businessAccount, pending}`.
 */
function staffBalances(input) {
  const now = input?.now instanceof Date ? input.now :
    new Date(Number(input?.now) || 0);
  const names = input?.staffNames && typeof input.staffNames === "object" ?
    input.staffNames : {};
  const handovers = objects(input?.handovers);
  const receipts = collectReceipts(input?.sources, now, input?.counted);
  const applied = applyHandovers(receipts, handovers);
  return {
    asOfMs: now.getTime(),
    counted: countedSources(input?.counted),
    staff: netBalances(applied, parkingNetting(input?.netting), names),
    businessAccount: applied.businessAccount,
    pending: pendingHandovers(handovers, names),
  };
}

module.exports = {
  BUSINESS_ACCOUNT_RECEIVER,
  COUNTED_SOURCE_DEFAULTS,
  COUNTED_SOURCE_KEYS,
  HANDOVER_KIND,
  HANDOVER_MESSAGES,
  HANDOVER_METHODS,
  HANDOVER_STATUS,
  MAX_HANDOVER_CENTS,
  STAFF_BALANCE_ACTIONS,
  applyHandovers,
  cleanCountedSources,
  cleanHandoverCents,
  collectReceipts,
  countedSources,
  handoverAnswerRefusal,
  handoverRecord,
  handoverRefusal,
  handoverVoidRefusal,
  isBusinessAccount,
  netBalances,
  openingRecord,
  parkingNetting,
  pendingHandovers,
  recordHandoverRefusal,
  staffBalances,
};
