"use strict";

/**
 * Staff expenses netted against their parking bill
 * (docs/STAFF_EXPENSE_CREDIT.md §3).
 *
 * A staff member who paid lot expenses out of pocket is owed that money; if
 * they also park cars, what they owe on parking is lowered by it. Both sides
 * are cumulative to the end of the month shown, so the netting never needs
 * history: applied = min(owed on parking, credit), and what is left of the
 * credit is what the business still owes them.
 *
 * Pure: no Firestore, no clock. Mirrored by the console's
 * `staff-expense-credit.ts` and the app's `staff_expense_credit.dart`;
 * `test/fixtures/staff-expense-credit-cases.json` is run by all three.
 */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const cents = (value) => {
  const n = Math.round(Number(value) || 0);
  return n > 0 ? n : 0;
};
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

/**
 * Each staff member's expenses, paid-back amounts and credit up to the end
 * of `monthKey`.
 *
 * @param {object[]} entries lotExpenseEntries rows
 *   `{paidByStaffId, amountCents, month, voided}`.
 * @param {object[]} repayments staffExpenseRepayments rows
 *   `{staffId, amountCents, month, voided}`.
 * @param {string} monthKey "yyyy-mm".
 * @return {object} `{[staffId]: {expensesCents, repaidCents, creditCents}}`
 */
function staffCredits(entries, repayments, monthKey) {
  const out = {};
  if (!MONTH.test(String(monthKey || ""))) return out;
  const slot = (id) => {
    if (!out[id]) out[id] = {expensesCents: 0, repaidCents: 0, creditCents: 0};
    return out[id];
  };
  for (const e of entries || []) {
    const id = text(e?.paidByStaffId, 128);
    const month = text(e?.month, 7);
    if (!id || e?.voided === true || !MONTH.test(month) || month > monthKey) {
      continue;
    }
    slot(id).expensesCents += cents(e.amountCents);
  }
  for (const r of repayments || []) {
    const id = text(r?.staffId, 128);
    const month = text(r?.month, 7);
    if (!id || r?.voided === true || !MONTH.test(month) || month > monthKey) {
      continue;
    }
    slot(id).repaidCents += cents(r.amountCents);
  }
  for (const s of Object.values(out)) {
    s.creditCents = Math.max(0, s.expensesCents - s.repaidCents);
  }
  return out;
}

/**
 * The staff linked to each customer key.
 *
 * @param {object} links `businesses.staffParkingLinks`:
 *   `{[staffId]: {customerKey}}`.
 * @return {object} `{[customerKey]: staffId[]}`, staff ids sorted.
 */
function staffByCustomer(links) {
  const out = {};
  for (const [staffId, link] of Object.entries(links || {})) {
    const key = text(link?.customerKey, 200);
    if (!key) continue;
    if (!out[key]) out[key] = [];
    out[key].push(staffId);
  }
  for (const list of Object.values(out)) list.sort();
  return out;
}

/**
 * Splits `amount` across staff in proportion to their credits; the rounding
 * remainder goes to the first. Every share is whole cents.
 *
 * @param {number} amount Cents to split.
 * @param {string[]} staffIds In order.
 * @param {object} credits From staffCredits.
 * @return {object} `{[staffId]: cents}`
 */
function splitByCredit(amount, staffIds, credits) {
  const total = staffIds.reduce((s, id) => s + (credits[id]?.creditCents || 0),
      0);
  const out = {};
  if (amount <= 0 || total <= 0) {
    for (const id of staffIds) out[id] = 0;
    return out;
  }
  let given = 0;
  for (const id of staffIds) {
    out[id] = Math.floor(amount * (credits[id]?.creditCents || 0) / total);
    given += out[id];
  }
  out[staffIds[0]] += amount - given;
  return out;
}

/**
 * Nets staff credit into the month's customers and lists what the business
 * still owes its staff.
 *
 * @param {object[]} customers Month-end customers `{key, dueCents, ...}`
 *   (`dueCents` = everything owed to the end of the month).
 * @param {object} ctx `{entries, repayments, links, monthKey, staffNames}`;
 *   `staffNames` is `{[staffId]: name}`.
 * @return {object} `{customers, businessOwes, businessOwesCents,
 *   expenseCreditCents}`; each customer gains `dueBeforeExpensesCents`,
 *   `expenseCreditCents`, `linkedStaffIds` and has `dueCents` netted.
 */
function netStaffExpenses(customers, ctx) {
  const credits = staffCredits(ctx?.entries, ctx?.repayments, ctx?.monthKey);
  const byCustomer = staffByCustomer(ctx?.links);
  const names = ctx?.staffNames || {};
  const owedByStaff = {};
  for (const [id, c] of Object.entries(credits)) {
    owedByStaff[id] = c.creditCents;
  }

  const netted = (customers || []).map((customer) => {
    const linked = byCustomer[customer.key] || [];
    const credit = linked.reduce((s, id) => s + (credits[id]?.creditCents || 0),
        0);
    const before = cents(customer.dueCents);
    const applied = Math.min(before, credit);
    if (linked.length) {
      const used = splitByCredit(applied, linked, credits);
      for (const id of linked) {
        owedByStaff[id] = Math.max(0, (credits[id]?.creditCents || 0) -
          (used[id] || 0));
      }
    }
    return {
      ...customer,
      linkedStaffIds: linked,
      dueBeforeExpensesCents: before,
      expenseCreditCents: applied,
      dueCents: before - applied,
    };
  });

  const keyOf = {};
  for (const [id, link] of Object.entries(ctx?.links || {})) {
    keyOf[id] = text(link?.customerKey, 200);
  }
  const businessOwes = Object.entries(owedByStaff)
      .filter(([, owed]) => owed > 0)
      .map(([staffId, owedCents]) => ({
        staffId,
        staffName: text(names[staffId], 120),
        customerKey: keyOf[staffId] || "",
        owedCents,
      }))
      .sort((a, b) => b.owedCents - a.owedCents ||
        a.staffName.localeCompare(b.staffName) ||
        a.staffId.localeCompare(b.staffId));
  return {
    customers: netted,
    businessOwes,
    businessOwesCents: businessOwes.reduce((s, x) => s + x.owedCents, 0),
    expenseCreditCents: netted.reduce((s, c) => s + c.expenseCreditCents, 0),
  };
}

/**
 * The expense lines' names (`lotExpenseLines.label`) by line id.
 *
 * @param {object[]} lines lotExpenseLines rows `{id, label}`.
 * @return {object} `{[lineId]: label}`; unnamed lines left out.
 */
function expenseLineLabels(lines) {
  const out = {};
  for (const l of lines || []) {
    const id = text(l && l.id, 128);
    const label = text(l && l.label, 120);
    if (id && label) out[id] = label;
  }
  return out;
}

/**
 * What an expense reads as on a bill: its line's name, then its note
 * ("grosseries · tissu, cups"); one of them alone when the other is empty
 * or the same; "" when neither (each client then says "Expense").
 *
 * @param {string} lineLabel The expense line's name.
 * @param {string} note The entry's note.
 * @return {string} The label.
 */
function expenseLabel(lineLabel, note) {
  const a = text(lineLabel, 120);
  const b = text(note, 200);
  if (a && b && a.toLowerCase() === b.toLowerCase()) return a;
  return [a, b].filter(Boolean).join(" · ");
}

/**
 * This month's expenses of the given staff, for the bill's lines.
 *
 * @param {object[]} entries lotExpenseEntries rows.
 * @param {string} monthKey "yyyy-mm".
 * @param {string[]} staffIds The customer's linked staff.
 * @param {object} [lineLabels] `{[lineId]: label}` (expenseLineLabels).
 * @return {object[]} `{id, staffId, amountCents, note, lineId, lineLabel,
 *   label, spentAtMs}`, oldest first.
 */
function monthExpenseLines(entries, monthKey, staffIds, lineLabels) {
  const wanted = new Set(staffIds || []);
  const names = lineLabels || {};
  return (entries || [])
      .filter((e) => e && e.voided !== true && wanted.has(e.paidByStaffId) &&
        text(e.month, 7) === monthKey && cents(e.amountCents) > 0)
      .map((e) => {
        const lineId = text(e.lineId, 128);
        const lineLabel = text(names[lineId], 120);
        const note = text(e.note, 200);
        return {
          id: text(e.id, 128),
          staffId: e.paidByStaffId,
          amountCents: cents(e.amountCents),
          note,
          lineId,
          lineLabel,
          label: expenseLabel(lineLabel, note),
          spentAtMs: Number(e.spentAtMs) || 0,
        };
      })
      .sort((a, b) => a.spentAtMs - b.spentAtMs || a.id.localeCompare(b.id));
}

/**
 * The part of "Less expenses" that came from expenses of earlier months:
 * what was taken off the bill beyond this month's listed lines. With it
 * listed, the lines add up to "Less expenses" whenever the credit covered
 * them (when it did not, the rest of the credit is in Business owes).
 *
 * @param {number} appliedCents The customer's expenseCreditCents.
 * @param {object[]} lines This month's lines `{amountCents}`.
 * @return {number} Cents, never below zero.
 */
function earlierExpenseCents(appliedCents, lines) {
  const applied = cents(appliedCents);
  const listed = (lines || []).reduce((s, l) => s + cents(l && l.amountCents),
      0);
  return applied - Math.min(applied, listed);
}

/**
 * Mark all paid's items after the expense credit: the credit covers the
 * first items (in order), only the rest is recorded as payments.
 *
 * @param {object[]} items `{amountCents, ...}` in payment order.
 * @param {number} creditCents The customer's applied expense credit.
 * @return {object[]} The items still to pay, amounts reduced; empty ones
 *   dropped.
 */
function itemsAfterCredit(items, creditCents) {
  let left = cents(creditCents);
  const out = [];
  for (const item of items || []) {
    const amount = cents(item.amountCents);
    const covered = Math.min(amount, left);
    left -= covered;
    if (amount - covered > 0) {
      out.push({...item, amountCents: amount - covered});
    }
  }
  return out;
}

module.exports = {
  earlierExpenseCents,
  expenseLabel,
  expenseLineLabels,
  itemsAfterCredit,
  monthExpenseLines,
  netStaffExpenses,
  splitByCredit,
  staffByCustomer,
  staffCredits,
};
