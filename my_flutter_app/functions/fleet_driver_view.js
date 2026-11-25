"use strict";

// What a Fleet driver sees of their own account in the app (docs/FLEET.md
// section 11). Pure: `fleet_handlers.driverHome` reads the records of the
// driver whose phone is the caller's verified phone, this shapes the answer.
//
// The rule that matters: the answer carries the driver's own money and plate
// and NOTHING the office keeps for itself (notes, the track record, friends
// who drove, remembered payer names, who recorded a payment, bank ids, the
// screenshot of a report, other drivers).

const fleetBilling = require("./fleet_billing");
const fleetClaims = require("./fleet_claims");
const {driverDisplayName} = require("./fleet_whatsapp");

/** Closed bills and payments sent to the phone, newest first. */
const CLOSED_BILL_LIMIT = 60;
const PAYMENT_LIMIT = 60;

/** Laawol's WhatsApp number: where a driver sends the Zelle screenshot. */
const PROOF_WHATSAPP = "+13475596214";

const text = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const whole = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The number drivers send their screenshot to. `WHATSAPP_DISPLAY_NUMBER`
 * (functions env) replaces the built-in one when it is a real E.164 number.
 *
 * @param {object} env process.env.
 * @return {string} E.164.
 */
function proofWhatsApp(env) {
  const asked = text(env?.WHATSAPP_DISPLAY_NUMBER, 20);
  return /^\+[1-9]\d{7,14}$/.test(asked) ? asked : PROOF_WHATSAPP;
}

/**
 * The bills a driver is shown: open, paid and waived ones. A void bill was
 * taken back (a plate returned, a fee paid on time, a bill made by mistake)
 * and is nobody's. Open first, soonest due first; then the rest, newest
 * first.
 *
 * @param {Array<object>} bills [{id, ...fleetBills fields}].
 * @return {Array<object>} Driver-safe rows.
 */
function shownBills(bills) {
  const rows = (bills || [])
      .filter((b) => ["open", "paid", "waived"].includes(b.status))
      .map((b) => ({
        id: text(b.id, 200),
        kind: ["rent", "charge", "late_fee", "ticket"].includes(b.kind) ?
          b.kind : "charge",
        label: text(b.label, 120),
        periodFrom: text(b.periodFrom, 10),
        periodTo: text(b.periodTo, 10),
        dueDayKey: text(b.dueDayKey, 10),
        amountCents: whole(b.amountCents),
        paidCents: Math.min(whole(b.paidCents), whole(b.amountCents)),
        status: b.status,
      }));
  const open = rows.filter((b) => b.status === "open")
      .sort((a, b) => a.dueDayKey.localeCompare(b.dueDayKey) ||
        a.id.localeCompare(b.id));
  const closed = rows.filter((b) => b.status !== "open")
      .sort((a, b) => b.dueDayKey.localeCompare(a.dueDayKey) ||
        a.id.localeCompare(b.id))
      .slice(0, CLOSED_BILL_LIMIT);
  return [...open, ...closed];
}

/**
 * The payments a driver is shown: recorded ones (an undone payment never
 * happened), newest first.
 *
 * @param {Array<object>} payments [{id, ...fleetPayments fields}].
 * @return {Array<object>} Driver-safe rows.
 */
function shownPayments(payments) {
  return (payments || [])
      .filter((p) => p.status !== "undone" && whole(p.amountCents) > 0)
      .map((p) => ({
        id: text(p.id, 200),
        amountCents: whole(p.amountCents),
        method: p.imported === true ? "import" :
          (["zelle", "cash", "other"].includes(p.method) ? p.method : "other"),
        paidDayKey: text(p.paidDayKey, 10),
        creditAddedCents: whole(p.creditAddedCents),
      }))
      .sort((a, b) => b.paidDayKey.localeCompare(a.paidDayKey) ||
        a.id.localeCompare(b.id))
      .slice(0, PAYMENT_LIMIT);
}

/**
 * The driver's reports still open ("I paid" screenshots the bank has not
 * confirmed yet), newest first. `state`: `checking` (waiting for the bank),
 * `reply` (we asked the driver something on WhatsApp), `office` (a person
 * at the business is looking at it).
 *
 * @param {Array<object>} claims [{id, ...fleetClaims fields}].
 * @return {Array<object>} Driver-safe rows.
 */
function shownClaims(claims) {
  const S = fleetClaims.STATE;
  const stateOf = (c) => {
    if (c.state === S.WAITING_BANK) return "checking";
    if (c.state === S.OFFICE) return "office";
    return "reply";
  };
  return (claims || [])
      .filter((c) => c.open === true &&
        fleetClaims.OPEN_STATES.includes(c.state))
      .map((c) => ({
        id: text(c.id, 200),
        amountCents: whole(c.amountCents),
        state: stateOf(c),
        createdAtMs: whole(c.createdAtMs),
      }))
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, 10);
}

/**
 * The plates the driver holds now, with the paperwork a driver needs.
 *
 * @param {Array<object>} assignments [{id, carId, endDayKey, ...}].
 * @param {Map<string, object>} carsById fleetCars by id.
 * @return {Array<object>} One row per open assignment.
 */
function shownPlates(assignments, carsById) {
  return (assignments || [])
      .filter((a) => !text(a.endDayKey, 10))
      .map((a) => {
        const car = carsById?.get(a.carId) || {};
        return {
          assignmentId: text(a.id, 200),
          plate: text(car.plate, 20).toUpperCase(),
          vehicleType: text(car.vehicleType, 80),
          ownership: car.ownership === "driver" ? "driver" : "company",
          registrationExpiry: text(car.registrationExpiry, 10),
          diamondExpiry: text(car.diamondExpiry, 10),
          insurer: text(car.insurer, 80),
          policyNumber: text(car.policyNumber, 60),
          rentCents: whole(a.rentCents),
          period: a.period === "weekly" ? "weekly" : "monthly",
          dueDay: whole(a.dueDay) || 1,
          startDayKey: text(a.startDayKey, 10),
        };
      })
      .sort((a, b) => a.plate.localeCompare(b.plate));
}

/**
 * One fleet business as its driver sees it, or null when there is nothing
 * to show (a driver who left, owes nothing and holds no plate is a regular
 * Laawol customer again).
 *
 * @param {object} p {businessId, business, driverId, driver, bills,
 *   payments, assignments, carsById, claims, todayKey}.
 * @return {?object} The view.
 */
function driverFleetView(p) {
  const driver = p.driver || {};
  const business = p.business || {};
  const settings = business.fleet?.settings || {};
  const bills = shownBills(p.bills);
  const plates = shownPlates(p.assignments, p.carsById);
  const balance = fleetBilling.driverBalance(
      bills.filter((b) => b.status === "open"),
      Number(driver.creditCents) || 0, p.todayKey);
  const left = driver.status === "left";
  if (left && balance.owedCents <= 0 && plates.length === 0) return null;
  return {
    businessId: text(p.businessId, 180),
    businessName: text(business.name, 120),
    businessPhone: text(business.phone, 40),
    // On unless the Fleet admin switched it off (docs/FLEET.md Q11).
    onlyFleet: settings.driversSeeOnlyThisBusiness !== false,
    zelle: {name: text(settings.zelle?.name, 80),
      handle: text(settings.zelle?.handle, 120)},
    driver: {
      id: text(p.driverId, 200),
      name: text(driverDisplayName(driver.name), 80),
      status: left ? "left" : "active",
      creditCents: balance.creditCents,
    },
    balance: {
      owedCents: balance.owedCents,
      lateCents: balance.lateCents,
      nextDueDayKey: balance.nextDue ? balance.nextDue.dueDayKey : "",
      nextDueCents: balance.nextDue ? balance.nextDue.cents : 0,
    },
    plates,
    bills,
    payments: shownPayments(p.payments),
    claims: shownClaims(p.claims),
  };
}

module.exports = {
  CLOSED_BILL_LIMIT,
  PAYMENT_LIMIT,
  PROOF_WHATSAPP,
  driverFleetView,
  proofWhatsApp,
  shownBills,
  shownClaims,
  shownPayments,
  shownPlates,
};
