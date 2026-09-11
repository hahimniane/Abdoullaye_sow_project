"use strict";

// The lot's customer memory. Every customer a business types onto a ledger
// activity or a walk-up parking entry is remembered once, with the cars seen
// against them, so the next entry can be picked instead of re-keyed. Pure:
// index.js does the Firestore read/merge/write around these.

function text(value, max = 200) {
  return String(value === null || value === undefined ? "" : value)
      .trim().slice(0, max);
}

function digits(value) {
  return text(value, 40).replace(/\D+/g, "");
}

/**
 * The identity of a customer inside one business. Phone first (what a lot
 * actually asks for), then email, then the name - never the raw name when
 * a contact detail exists, so "Amadou" with two different phones stays two
 * people and the same phone with a typo'd name stays one.
 *
 * @param {object} seen customerName / customerPhone / customerEmail.
 * @return {string} A stable key, or "" when there is nothing to remember.
 */
function lotCustomerKey(seen) {
  const s = seen || {};
  const phone = digits(s.customerPhone);
  if (phone.length >= 7) return `p:${phone.slice(-10)}`;
  const email = text(s.customerEmail, 180).toLowerCase();
  if (email.includes("@")) return `e:${email}`;
  const name = text(s.customerName, 120).toLowerCase().replace(/\s+/g, " ");
  return name ? `n:${name}` : "";
}

/**
 * The stored customer after seeing them again. A customer is only ever a name
 * and a phone number — no car is kept against them (a car belongs to the
 * parking/ledger record, decoded from its VIN, not to a person). The newest
 * non-empty contact detail wins; a blank never erases what was known.
 *
 * @param {object|null} existing The stored lotCustomers document, if any.
 * @param {object} seen The fields just recorded on an activity or entry.
 * @param {object} meta {businessId, source, staffId, nowMs}.
 * @return {object} The document body to write (merge).
 */
function mergeLotCustomer(existing, seen, meta) {
  const cur = existing || {};
  const s = seen || {};
  const m = meta || {};
  return {
    businessId: text(m.businessId || cur.businessId, 180),
    key: lotCustomerKey(s) || text(cur.key, 200),
    name: text(s.customerName, 120) || text(cur.name, 120),
    phone: text(s.customerPhone, 40) || text(cur.phone, 40),
    seenCount: Math.max(0, Number(cur.seenCount) || 0) + 1,
    lastSource: text(m.source, 40) || text(cur.lastSource, 40),
    lastSeenByStaffId: text(m.staffId, 120) || text(cur.lastSeenByStaffId, 120),
  };
}

/**
 * The customers that match what staff typed, best first. Matches the name and
 * the phone (by digits) — the two things a customer is. A prefix match on the
 * name outranks a match buried mid-word; ties break on how recently seen.
 *
 * @param {object[]} customers Stored lotCustomers rows.
 * @param {string} query What was typed.
 * @param {number} limit How many to offer.
 * @return {object[]} Matching rows.
 */
function matchLotCustomers(customers, query, limit = 6) {
  const q = text(query, 120).toLowerCase();
  const qd = q.replace(/\D+/g, "");
  if (q.length < 2) return [];
  const scored = [];
  for (const c of customers || []) {
    const name = text(c.name, 120).toLowerCase();
    const phone = digits(c.phone);
    let score = 0;
    if (name.startsWith(q)) score = 4;
    else if (name.split(" ").some((w) => w.startsWith(q))) score = 3;
    else if (name.includes(q)) score = 2;
    if (qd.length >= 3 && phone.includes(qd)) score = Math.max(score, 3);
    if (score > 0) scored.push({c, score, seen: Number(c.lastSeenMs) || 0});
  }
  scored.sort((a, b) => b.score - a.score || b.seen - a.seen);
  return scored.slice(0, limit).map((x) => x.c);
}

module.exports = {
  lotCustomerKey,
  mergeLotCustomer,
  matchLotCustomers,
};
