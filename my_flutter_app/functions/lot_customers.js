"use strict";

// The lot's customer memory. Every customer a business types onto a ledger
// activity or a walk-up parking entry is remembered once, with the cars seen
// against them, so the next entry can be picked instead of re-keyed. Pure:
// index.js does the Firestore read/merge/write around these.

const MAX_CARS = 20;

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

function carOf(seen) {
  const s = seen || {};
  const car = {
    vin: text(s.vinNumber, 17).toUpperCase(),
    make: text(s.carMake, 80),
    model: text(s.carModel, 80),
    year: text(s.carYear, 8),
  };
  return car.vin || car.make || car.model ? car : null;
}

function sameCar(a, b) {
  if (a.vin && b.vin) return a.vin === b.vin;
  return !a.vin && !b.vin && a.make.toLowerCase() === b.make.toLowerCase() &&
    a.model.toLowerCase() === b.model.toLowerCase() && a.year === b.year;
}

/**
 * The stored customer after seeing them again. The newest non-empty contact
 * detail wins; a blank never erases what was known. Cars are a set, newest
 * first, capped so one busy customer cannot grow without bound.
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
  const car = carOf(s);
  const cars = Array.isArray(cur.cars) ? cur.cars.slice() : [];
  const merged = car ?
    [car, ...cars.filter((c) => !sameCar(c, car))].slice(0, MAX_CARS) :
    cars;
  return {
    businessId: text(m.businessId || cur.businessId, 180),
    key: lotCustomerKey(s) || text(cur.key, 200),
    name: text(s.customerName, 120) || text(cur.name, 120),
    phone: text(s.customerPhone, 40) || text(cur.phone, 40),
    email: text(s.customerEmail, 180).toLowerCase() || text(cur.email, 180),
    cars: merged,
    seenCount: Math.max(0, Number(cur.seenCount) || 0) + 1,
    lastSource: text(m.source, 40) || text(cur.lastSource, 40),
    lastSeenByStaffId: text(m.staffId, 120) || text(cur.lastSeenByStaffId, 120),
  };
}

/**
 * The customers that match what staff typed, best first. Matches name,
 * phone (by digits), email and any car's VIN; a prefix match on the name
 * outranks a match buried mid-word; ties break on how recently seen.
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
    const email = text(c.email, 180).toLowerCase();
    const phone = digits(c.phone);
    const vins = (Array.isArray(c.cars) ? c.cars : [])
        .map((x) => text(x.vin, 17).toLowerCase());
    let score = 0;
    if (name.startsWith(q)) score = 4;
    else if (name.split(" ").some((w) => w.startsWith(q))) score = 3;
    else if (name.includes(q)) score = 2;
    if (qd.length >= 3 && phone.includes(qd)) score = Math.max(score, 3);
    if (email && email.startsWith(q)) score = Math.max(score, 3);
    if (vins.some((v) => v && v.includes(q))) score = Math.max(score, 2);
    if (score > 0) scored.push({c, score, seen: Number(c.lastSeenMs) || 0});
  }
  scored.sort((a, b) => b.score - a.score || b.seen - a.seen);
  return scored.slice(0, limit).map((x) => x.c);
}

module.exports = {
  MAX_CARS,
  lotCustomerKey,
  mergeLotCustomer,
  matchLotCustomers,
};
