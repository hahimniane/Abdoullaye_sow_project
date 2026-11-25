"use strict";

// Fleet (TLC plate leasing) server actions and the daily job
// (docs/FLEET.md). The arithmetic lives in fleet_billing.js and the
// spreadsheet reading in fleet_import.js; this file reads and writes
// Firestore. Wired in index.js as `fleetAction` (one callable, every action)
// and `fleetDaily` (scheduled), like console_totals.js.

const fleetBilling = require("./fleet_billing");
const fleetBank = require("./fleet_bank");
const fleetWhatsApp = require("./fleet_whatsapp");
const fleetClaims = require("./fleet_claims");
const fleetDriverView = require("./fleet_driver_view");
const {messageDocId} = require("./whatsapp_conversations");
const {parseFleetSheet, previousMonth} = require("./fleet_import");

const STAFF = "fleet";
const ADMIN = "fleet_admin";
const MAX_IMPORT_ROWS = 2000;
const MAX_NOTE_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const FLEET_REFUSALS = Object.freeze({
  fleet_off: "Fleet is not switched on for this business.",
  fleet_admin_only: "Only a Fleet admin can do this.",
  fleet_not_found: "That record was not found.",
  fleet_car_taken: "This plate already has a driver. Get it back first.",
  fleet_car_overlap: "This plate was with another driver until that day. " +
    "Pick a later start day.",
  fleet_already_returned: "This plate was already returned.",
  fleet_driver_has_plate: "This driver still has a plate. Get it back first.",
  fleet_bad_input: "Some details are missing or not valid.",
  fleet_no_amount: "Enter an amount.",
  fleet_already_undone: "That payment was already undone.",
  fleet_not_open: "Only an open bill can be waived.",
  fleet_reason_required: "Say why.",
  fleet_import_locked: "A payment brought in from the spreadsheet " +
    "cannot be undone here.",
  fleet_friend_overlap: "Another friend already has this car on those days.",
  fleet_note_empty: "Write a note or attach a file.",
  fleet_note_voided: "That note was already removed.",
  fleet_bad_file: "A file is not allowed (images or PDF, up to 10 MB).",
  fleet_deposit_used: "That deposit was already used for another payment.",
  fleet_no_bank: "Connect the business's bank first (Profile, Bank for " +
    "Zelle checks).",
  fleet_bad_phone: "Enter a phone number with its area code.",
  fleet_whatsapp_off:
      "WhatsApp to drivers is off for this driver (Fleet settings).",
  fleet_nothing_owed: "This driver owes nothing right now.",
  fleet_zelle_missing:
      "Add the Zelle email or phone in Fleet settings first.",
  fleet_no_phone:
      "This driver has no WhatsApp number. Add one in Edit details.",
  fleet_driver_left: "This driver has left.",
  fleet_deposit_not_waiting: "That deposit is not waiting for the office.",
  fleet_claim_closed: "This report is closed or was already paid.",
  fleet_claim_no_driver: "This report has no driver yet.",
  fleet_bad_name: "That is not a person's name (at least two words, not an " +
    "account or an app).",
});

const text = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const cents = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : NaN;
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/**
 * The fleet handlers.
 *
 * @param {object} deps {admin, HttpsError, FieldValue, logger, requireAuth,
 *   getUserProfile, requireBusinessManager, hasBusinessPermission,
 *   requireAdminCapability, normalizeBusinessServices, writeAudit,
 *   dayKeyNow (() => "YYYY-MM-DD" in New York), now (() => Date)}.
 * @return {{fleetAction: Function, fleetDaily: Function,
 *   runFleetDay: Function}} Handlers.
 */
function createFleetHandlers(deps) {
  const {admin, HttpsError, FieldValue} = deps;
  const db = () => admin.firestore();
  // Tests inject a clock for the claim timers.
  const nowMs = () => (typeof deps.now === "function" ? deps.now() :
    Date.now());
  const refuse = (code, status = "failed-precondition") =>
    new HttpsError(status, FLEET_REFUSALS[code] || code, {reason: code});

  async function businessOf(businessId) {
    const doc = await db().collection("businesses").doc(businessId).get();
    if (!doc.exists) throw refuse("fleet_not_found", "not-found");
    return {ref: doc.ref, data: doc.data() || {}};
  }

  function fleetOn(business) {
    return business?.fleet?.enabled === true;
  }

  // Fleet staff (permission `fleet`) or more. Owners, full access and
  // platform admins pass (hasBusinessPermission).
  async function requireStaff(uid, businessId) {
    const user = await deps.requireBusinessManager(uid, businessId);
    if (!deps.hasBusinessPermission(user, STAFF) &&
        !deps.hasBusinessPermission(user, ADMIN)) {
      throw new HttpsError("permission-denied",
          "This staff account is not allowed to manage Fleet",
          {reason: "fleet_staff_only"});
    }
    return user;
  }

  async function requireAdmin(uid, businessId) {
    const user = await deps.requireBusinessManager(uid, businessId);
    if (!deps.hasBusinessPermission(user, ADMIN)) {
      throw refuse("fleet_admin_only", "permission-denied");
    }
    return user;
  }

  async function audit(businessId, uid, entityType, entityId, action,
      summary) {
    await deps.writeAudit({businessId, entityType, entityId, action,
      byStaffId: uid, changes: [], summary});
  }

  // ---- settings and the switch -----------------------------------------

  async function setEnabled(uid, data) {
    const user = await deps.getUserProfile(uid);
    deps.requireAdminCapability(user, "businesses",
        "Only platform admins can switch Fleet on or off");
    const businessId = text(data.businessId, 180);
    if (typeof data.enabled !== "boolean") {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    const {ref, data: business} = await businessOf(businessId);
    const services = deps.normalizeBusinessServices(business.enabledServices)
        .filter((s) => s !== "fleet");
    if (data.enabled) services.push("fleet");
    await ref.set({
      enabledServices: services,
      businessServices: services,
      fleet: {enabled: data.enabled},
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    await audit(businessId, uid, "fleet_settings", businessId,
        data.enabled ? "fleet_enabled" : "fleet_disabled",
        data.enabled ? "Fleet switched on" : "Fleet switched off");
    return {success: true, enabled: data.enabled};
  }

  /**
   * Validates settings; returns the clean object or throws.
   *
   * @param {object} raw The asked settings.
   * @return {object} Clean settings.
   */
  function cleanSettings(raw) {
    const s = raw && typeof raw === "object" ? raw : {};
    const out = {};
    if (s.lateFee !== undefined) {
      const fee = s.lateFee || {};
      const c = cents(fee.cents);
      const day = Math.trunc(Number(fee.dayOfMonth));
      const first = text(fee.firstMonth, 7);
      if (!(c >= 0) || !(day >= 1 && day <= 28) ||
          (first && !MONTH.test(first))) {
        throw refuse("fleet_bad_input", "invalid-argument");
      }
      out.lateFee = {cents: c, dayOfMonth: day, firstMonth: first};
    }
    if (s.returnRule !== undefined) {
      if (!["full", "days"].includes(s.returnRule)) {
        throw refuse("fleet_bad_input", "invalid-argument");
      }
      out.returnRule = s.returnRule;
    }
    if (s.driversSeeOnlyThisBusiness !== undefined) {
      out.driversSeeOnlyThisBusiness = s.driversSeeOnlyThisBusiness === true;
    }
    if (s.zelle !== undefined) {
      out.zelle = {name: text(s.zelle?.name, 80),
        handle: text(s.zelle?.handle, 120)};
    }
    return out;
  }

  async function settingsSave(uid, businessId, data) {
    await requireAdmin(uid, businessId);
    const {ref, data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const clean = cleanSettings(data.settings);
    const settings = {...(business.fleet?.settings || {}), ...clean};
    await ref.set({fleet: {settings},
      updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    await audit(businessId, uid, "fleet_settings", businessId,
        "fleet_settings_saved", "Fleet settings saved");
    return {success: true, settings};
  }

  // ---- drivers, cars, assignments --------------------------------------

  function cleanPhone(raw) {
    const digits = String(raw ?? "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return `+${digits}`;
  }

  async function driverSave(uid, businessId, data) {
    await requireStaff(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const d = data.driver || {};
    const name = text(d.name, 120);
    if (!name) throw refuse("fleet_bad_input", "invalid-argument");
    const fields = {
      businessId, name,
      phone: cleanPhone(d.phone),
      tlcLicense: text(d.tlcLicense, 20),
      address: {line1: text(d.address?.line1, 160),
        city: text(d.address?.city, 80), state: text(d.address?.state, 40),
        zip: text(d.address?.zip, 12)},
      notes: text(d.notes, 1000),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (d.status === "active" || d.status === "left") fields.status = d.status;
    const col = db().collection("fleetDrivers");
    const driverId = text(data.driverId, 180);
    if (driverId) {
      const doc = await col.doc(driverId).get();
      if (!doc.exists || doc.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      // A driver who still has a plate has not left: end the plate first
      // (or use driver_leave).
      if (fields.status === "left" && doc.get("status") !== "left" &&
          (await openAssignmentsOf(driverId, businessId)).length > 0) {
        throw refuse("fleet_driver_has_plate");
      }
      // A changed TLC license keeps the old one with its dates.
      const before = text(doc.get("tlcLicense"), 20);
      if (before !== fields.tlcLicense) {
        const history = Array.isArray(doc.get("licenseHistory")) ?
          [...doc.get("licenseHistory")] : [];
        if (before) {
          history.push({license: before,
            fromDayKey: doc.get("tlcLicenseSince") || null,
            toDayKey: deps.dayKeyNow()});
        }
        fields.licenseHistory = history;
        fields.tlcLicenseSince = fields.tlcLicense ? deps.dayKeyNow() : null;
      }
      await doc.ref.set(fields, {merge: true});
      await audit(businessId, uid, "fleet_driver", driverId,
          "fleet_driver_saved", `Driver ${name} edited`);
      return {success: true, driverId};
    }
    const ref = col.doc();
    // No personal cents any more (docs/FLEET_PAYMENT_PROOF.md Q6).
    await ref.set({...fields, status: "active", creditCents: 0,
      licenseHistory: [],
      tlcLicenseSince: fields.tlcLicense ? deps.dayKeyNow() : null,
      rememberedSenders: [],
      createdAt: FieldValue.serverTimestamp()});
    await audit(businessId, uid, "fleet_driver", ref.id, "fleet_driver_added",
        `Driver ${name} added`);
    return {success: true, driverId: ref.id};
  }

  async function carSave(uid, businessId, data) {
    await requireStaff(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const c = data.car || {};
    const plate = text(c.plate, 12).toUpperCase();
    if (!plate) throw refuse("fleet_bad_input", "invalid-argument");
    const day = (v) => (DAY.test(text(v, 10)) ? text(v, 10) : null);
    const fields = {
      businessId, plate,
      company: text(c.company, 80), vehicleType: text(c.vehicleType, 80),
      vin: text(c.vin, 17).toUpperCase(),
      registrationExpiry: day(c.registrationExpiry),
      diamondExpiry: day(c.diamondExpiry),
      insurer: text(c.insurer, 80), policyNumber: text(c.policyNumber, 40),
      premiumCents: Math.max(0, cents(c.premiumCents) || 0),
      insuranceDueDay: Math.trunc(Number(c.insuranceDueDay)) || null,
      insuranceAutopay: c.insuranceAutopay === true,
      insurancePaidBy: text(c.insurancePaidBy, 80),
      ownership: c.ownership === "driver" ? "driver" : "company",
      updatedAt: FieldValue.serverTimestamp(),
    };
    const col = db().collection("fleetCars");
    const carId = text(data.carId, 180);
    if (carId) {
      const doc = await col.doc(carId).get();
      if (!doc.exists || doc.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      // The plate is the fleet's and stays; the car on it is usually the
      // driver's and can change. When the office says the plate moved to
      // another car (not a typo being fixed), the car it was on is kept
      // with its dates.
      const beforeVin = text(doc.get("vin"), 17).toUpperCase();
      const beforeType = text(doc.get("vehicleType"), 80);
      const moved = c.vehicleChange && c.vehicleChange.moved === true &&
        (beforeVin || beforeType) &&
        (beforeVin !== fields.vin || beforeType !== fields.vehicleType);
      if (moved) {
        const since = day(c.vehicleChange.sinceDayKey) || deps.dayKeyNow();
        const history = Array.isArray(doc.get("vehicleHistory")) ?
          [...doc.get("vehicleHistory")] : [];
        history.push({vin: beforeVin, vehicleType: beforeType,
          ownership: doc.get("ownership") === "driver" ? "driver" : "company",
          fromDayKey: doc.get("vehicleSince") || null, toDayKey: since});
        fields.vehicleHistory = history.slice(-50);
        fields.vehicleSince = since;
      }
      await doc.ref.set(fields, {merge: true});
      await audit(businessId, uid, "fleet_car", carId, "fleet_car_saved",
          moved ? `Plate ${plate} moved to another car` :
            `Plate ${plate} edited`);
      return {success: true, carId};
    }
    const ref = col.doc();
    await ref.set({...fields, status: "inactive", vehicleHistory: [],
      vehicleSince: fields.vin || fields.vehicleType ? deps.dayKeyNow() : null,
      createdAt: FieldValue.serverTimestamp()});
    await audit(businessId, uid, "fleet_car", ref.id, "fleet_car_added",
        `Plate ${plate} added`);
    return {success: true, carId: ref.id};
  }

  // The rent bills an assignment owes through a day that do not exist yet
  // (read inside the caller's transaction; the caller writes them). The
  // existing bills carry their periods, so a calendar month is never billed
  // twice.
  async function billAssignment(tx, assignment, settings, throughDayKey) {
    const billsCol = db().collection("fleetBills");
    const existing = await tx.get(billsCol
        .where("assignmentId", "==", assignment.id));
    const bills = existing.docs.map((d) => ({id: d.id, ...d.data()}));
    const fresh = fleetBilling.rentBillsToCreate(assignment, bills,
        throughDayKey, settings);
    return {fresh, billsCol};
  }

  // A driver's open assignments (the plates they hold).
  async function openAssignmentsOf(driverId, businessId) {
    const snap = await db().collection("fleetAssignments")
        .where("driverId", "==", driverId).get();
    return snap.docs.filter((d) => d.get("businessId") === businessId &&
      !d.get("endDayKey"));
  }

  // The driver and their open bills, read inside a transaction before any
  // write (L9: credit is spent after ANY new bill, not only new rent).
  async function creditContext(tx, driverId) {
    if (!driverId) return {driver: null, open: [], credit: 0};
    const driverRef = db().collection("fleetDrivers").doc(driverId);
    const [driver, open] = await Promise.all([
      tx.get(driverRef),
      tx.get(db().collection("fleetBills").where("driverId", "==", driverId)
          .where("status", "==", "open")),
    ]);
    return {driver, open: open.docs,
      credit: driver.exists ?
        Math.max(0, Number(driver.get("creditCents")) || 0) : 0};
  }

  // Writes the new bills and spends the driver's credit on every open bill
  // (late fees first, then oldest due), new ones included. Returns the credit
  // left: the caller writes it with its own driver update.
  function writeBillsSpendingCredit(tx, ctx, fresh, base) {
    const billsCol = db().collection("fleetBills");
    const existing = ctx.open.map((d) => ({id: d.id, ...d.data()}));
    const all = [...existing, ...fresh.map((b) => ({...b, paidCents: 0,
      status: "open"}))];
    const used = ctx.credit > 0 ? fleetBilling.applyCredit(all, ctx.credit) :
      {allocations: [], creditLeftCents: ctx.credit};
    const take = (id) => used.allocations.filter((x) => x.billId === id)
        .reduce((sum, x) => sum + x.cents, 0);
    for (const bill of fresh) {
      const paid = take(bill.id);
      tx.set(billsCol.doc(bill.id), {...bill, ...base, paidCents: paid,
        status: paid >= bill.amountCents ? "paid" : "open",
        createdAt: FieldValue.serverTimestamp()});
    }
    for (const b of existing) {
      const more = take(b.id);
      if (more <= 0) continue;
      const paid = (Number(b.paidCents) || 0) + more;
      tx.update(billsCol.doc(b.id), {paidCents: paid,
        status: paid >= Number(b.amountCents) ? "paid" : "open",
        updatedAt: FieldValue.serverTimestamp()});
    }
    return used.creditLeftCents;
  }

  // A late fee whose rent bill is gone (void, cut to zero, waived): void the
  // fee; money already on it goes to the driver's credit. Read the fee in the
  // transaction first (feeDoc); this only writes. Returns the cents moved to
  // credit (the caller adds them to the driver's credit).
  function voidLateFee(tx, feeDoc) {
    if (!feeDoc || !feeDoc.exists) return 0;
    const status = feeDoc.get("status");
    if (status !== "open" && status !== "paid") return 0;
    const paid = Math.max(0, Number(feeDoc.get("paidCents")) || 0);
    tx.update(feeDoc.ref, {status: "void", voidReason: "rent_bill_gone",
      paidCents: 0, updatedAt: FieldValue.serverTimestamp()});
    return paid;
  }

  async function assignmentStart(uid, businessId, data) {
    await requireAdmin(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const driverId = text(data.driverId, 180);
    const carId = text(data.carId, 180);
    const startDayKey = text(data.startDayKey, 10);
    const rentCents = cents(data.rentCents);
    const period = data.period === "weekly" ? "weekly" : "monthly";
    const dueDay = Math.trunc(Number(data.dueDay)) ||
      (period === "weekly" ? 1 : 1);
    if (!driverId || !carId || !DAY.test(startDayKey) || !(rentCents > 0) ||
        dueDay < 1 || dueDay > (period === "weekly" ? 7 : 28)) {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    const settings = business.fleet?.settings || {};
    const today = deps.dayKeyNow();
    const ref = db().collection("fleetAssignments").doc();
    await db().runTransaction(async (tx) => {
      const [driver, car, onPlate] = await Promise.all([
        tx.get(db().collection("fleetDrivers").doc(driverId)),
        tx.get(db().collection("fleetCars").doc(carId)),
        tx.get(db().collection("fleetAssignments")
            .where("carId", "==", carId)),
      ]);
      if (!driver.exists || driver.get("businessId") !== businessId ||
          !car.exists || car.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      const plate = onPlate.docs.filter((d) =>
        d.get("businessId") === businessId);
      if (plate.some((d) => !d.get("endDayKey"))) {
        throw refuse("fleet_car_taken");
      }
      // A new driver cannot start on or before the day the last one left.
      const lastEnd = plate.reduce((m, d) =>
        String(d.get("endDayKey")) > m ? String(d.get("endDayKey")) : m, "");
      if (lastEnd && startDayKey <= lastEnd) throw refuse("fleet_car_overlap");
      const assignment = {id: ref.id, businessId, carId, driverId,
        startDayKey, endDayKey: null, rentCents, period, dueDay};
      const {fresh} = await billAssignment(tx, assignment, settings, today);
      const ctx = await creditContext(tx, driverId);
      tx.set(ref, {...assignment, createdBy: uid,
        createdAt: FieldValue.serverTimestamp()});
      const creditLeft = writeBillsSpendingCredit(tx, ctx, fresh,
          {businessId, driverId, carId});
      tx.update(car.ref, {status: "active",
        updatedAt: FieldValue.serverTimestamp()});
      tx.update(driver.ref, {status: "active",
        ...(creditLeft !== ctx.credit ? {creditCents: creditLeft} : {}),
        updatedAt: FieldValue.serverTimestamp()});
    });
    await audit(businessId, uid, "fleet_assignment", ref.id,
        "fleet_assignment_started",
        `Plate given to driver from ${startDayKey}, ` +
        `$${(rentCents / 100).toFixed(2)} ${period}`);
    return {success: true, assignmentId: ref.id};
  }

  /**
   * Ends one assignment on a day (one transaction): each rent bill is worth
   * what the return rule says, the paid part that is no longer on a bill
   * becomes the driver's credit, and late fees of bills that are gone are
   * voided.
   *
   * @param {string} uid The staff member.
   * @param {string} businessId The business.
   * @param {string} assignmentId The assignment.
   * @param {string} endDayKey The day the plate came back.
   * @param {object} settings The fleet settings.
   * @return {Promise<number>} Cents moved to the driver's credit.
   */
  async function endAssignment(uid, businessId, assignmentId, endDayKey,
      settings) {
    let creditBackOut = 0;
    await db().runTransaction(async (tx) => {
      // Computed here, not outside: a retried transaction starts again.
      let creditBack = 0;
      const ref = db().collection("fleetAssignments").doc(assignmentId);
      const doc = await tx.get(ref);
      if (!doc.exists || doc.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      const a = {id: doc.id, ...doc.data()};
      if (a.endDayKey) throw refuse("fleet_already_returned");
      if (endDayKey < a.startDayKey) {
        throw refuse("fleet_bad_input", "invalid-argument");
      }
      const bills = await tx.get(db().collection("fleetBills")
          .where("assignmentId", "==", assignmentId));
      // What each rent bill is worth once the car is back: its own period,
      // under the return rule.
      const plan = [];
      for (const b of bills.docs) {
        const bill = b.data();
        if (bill.kind !== "rent" || bill.status === "void" ||
            bill.status === "waived") continue;
        const paid = Math.max(0, Number(bill.paidCents) || 0);
        const target = fleetBilling.billAfterReturn(bill, endDayKey,
            settings);
        if (target === Number(bill.amountCents)) continue;
        plan.push({ref: b.ref, id: b.id, paid, target});
      }
      // Late fees of the bills that are gone (read before any write).
      const fees = await Promise.all(plan.filter((x) => x.target === 0)
          .map((x) => tx.get(db().collection("fleetBills")
              .doc(`${x.id}_late`))));
      const driverRef = db().collection("fleetDrivers").doc(a.driverId);
      for (const x of plan) {
        const over = Math.max(0, x.paid - x.target);
        creditBack += over;
        tx.update(x.ref, {
          amountCents: x.target,
          paidCents: x.paid - over,
          status: x.target === 0 ? "void" :
            (x.paid - over >= x.target ? "paid" : "open"),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      for (const fee of fees) creditBack += voidLateFee(tx, fee);
      tx.update(ref, {endDayKey, endedBy: uid,
        updatedAt: FieldValue.serverTimestamp()});
      tx.update(db().collection("fleetCars").doc(a.carId),
          {status: "inactive", updatedAt: FieldValue.serverTimestamp()});
      if (creditBack > 0) {
        tx.update(driverRef, {creditCents: FieldValue.increment(creditBack),
          updatedAt: FieldValue.serverTimestamp()});
      }
      creditBackOut = creditBack;
    });
    return creditBackOut;
  }

  async function assignmentEnd(uid, businessId, data) {
    await requireAdmin(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const assignmentId = text(data.assignmentId, 180);
    const endDayKey = text(data.endDayKey, 10);
    if (!assignmentId || !DAY.test(endDayKey)) {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    const creditBack = await endAssignment(uid, businessId, assignmentId,
        endDayKey, business.fleet?.settings || {});
    await audit(businessId, uid, "fleet_assignment", assignmentId,
        "fleet_assignment_ended", `Plate returned on ${endDayKey}` +
        (creditBack > 0 ? `, $${(creditBack / 100).toFixed(2)} to credit` :
          ""));
    return {success: true, creditBackCents: creditBack};
  }

  // A new plate fee and/or due day for an open assignment. It applies from
  // the next period that has no bill yet; the bills that exist stay as they
  // are, and the previous values are kept in rentHistory.
  async function assignmentUpdate(uid, businessId, data) {
    await requireAdmin(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const assignmentId = text(data.assignmentId, 180);
    const hasRent = data.rentCents !== undefined && data.rentCents !== null;
    const hasDue = data.dueDay !== undefined && data.dueDay !== null;
    const rentCents = hasRent ? cents(data.rentCents) : null;
    const dueDay = hasDue ? Math.trunc(Number(data.dueDay)) : null;
    if (!assignmentId || (!hasRent && !hasDue) ||
        (hasRent && !(rentCents > 0)) ||
        (hasDue && !(dueDay >= 1))) {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    const today = deps.dayKeyNow();
    const ref = db().collection("fleetAssignments").doc(assignmentId);
    let effectiveDayKey = "";
    let summary = "";
    await db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists || doc.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      const a = {id: doc.id, ...doc.data()};
      if (a.endDayKey) throw refuse("fleet_already_returned");
      if (hasDue && dueDay > (a.period === "weekly" ? 7 : 28)) {
        throw refuse("fleet_bad_input", "invalid-argument");
      }
      const bills = await tx.get(db().collection("fleetBills")
          .where("assignmentId", "==", assignmentId));
      const existing = bills.docs.map((d) => ({id: d.id, ...d.data()}));
      const effective = fleetBilling.nextUnbilledPeriodStart(a, existing,
          today);
      if (!effective) throw refuse("fleet_bad_input", "invalid-argument");
      const history = Array.isArray(a.rentHistory) ? [...a.rentHistory] : [];
      history.push({rentCents: Number(a.rentCents) || 0,
        dueDay: Number(a.dueDay) || 1,
        fromDayKey: a.rentFromDayKey || a.startDayKey,
        toDayKey: fleetBilling.dayBefore(effective)});
      const patch = {rentHistory: history, rentFromDayKey: effective,
        updatedAt: FieldValue.serverTimestamp()};
      if (hasRent) patch.rentCents = rentCents;
      if (hasDue) patch.dueDay = dueDay;
      tx.update(ref, patch);
      effectiveDayKey = effective;
      summary = `from ${effective}` +
        (hasRent ? `, $${(rentCents / 100).toFixed(2)}` : "") +
        (hasDue ? `, due day ${dueDay}` : "");
    });
    await audit(businessId, uid, "fleet_assignment", assignmentId,
        "fleet_assignment_updated", `Plate fee changed ${summary}`);
    return {success: true, effectiveDayKey};
  }

  // The driver leaves: every plate they hold comes back on that day, then
  // they are marked "left".
  async function driverLeave(uid, businessId, data) {
    // Returning a plate moves money (a cut bill becomes credit): the same
    // people who may return a plate, not every Fleet staff member.
    await requireAdmin(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const driverId = text(data.driverId, 180);
    const endDayKey = text(data.endDayKey, 10);
    if (!driverId || !DAY.test(endDayKey)) {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    const driverRef = db().collection("fleetDrivers").doc(driverId);
    const driver = await driverRef.get();
    if (!driver.exists || driver.get("businessId") !== businessId) {
      throw refuse("fleet_not_found", "not-found");
    }
    const open = await openAssignmentsOf(driverId, businessId);
    // Nothing is written when a plate cannot come back on that day.
    if (open.some((d) => endDayKey < String(d.get("startDayKey")))) {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    let creditBack = 0;
    for (const d of open) {
      creditBack += await endAssignment(uid, businessId, d.id, endDayKey,
          business.fleet?.settings || {});
      await audit(businessId, uid, "fleet_assignment", d.id,
          "fleet_assignment_ended", `Plate returned on ${endDayKey} ` +
          "(driver left)");
    }
    await driverRef.set({status: "left",
      updatedAt: FieldValue.serverTimestamp()}, {merge: true});
    await audit(businessId, uid, "fleet_driver", driverId,
        "fleet_driver_left", `Driver left on ${endDayKey}` +
        (creditBack > 0 ? `, $${(creditBack / 100).toFixed(2)} to credit` :
          ""));
    return {success: true, ended: open.length};
  }

  // ---- the driver's profile: office notes and files, friends -----------

  const FILE_TYPES = /^(image\/[a-z0-9.+-]+|application\/pdf)$/i;

  function cleanFiles(raw, businessId, driverId) {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length > MAX_NOTE_FILES) {
      throw refuse("fleet_bad_file", "invalid-argument");
    }
    const prefix = `fleetDocs/${businessId}/${driverId}/`;
    return list.map((f) => {
      const path = text(f?.path, 400);
      const size = Math.trunc(Number(f?.size));
      const contentType = text(f?.contentType, 100);
      if (!path.startsWith(prefix) || path.includes("..") ||
          !FILE_TYPES.test(contentType) ||
          !(size >= 0 && size <= MAX_FILE_BYTES)) {
        throw refuse("fleet_bad_file", "invalid-argument");
      }
      return {path, name: text(f?.name, 160) || "file", contentType, size};
    });
  }

  async function noteAdd(uid, businessId, data) {
    const user = await requireStaff(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const driverId = text(data.driverId, 180);
    const note = text(data.text, 2000);
    if (!driverId) throw refuse("fleet_bad_input", "invalid-argument");
    const files = cleanFiles(data.files, businessId, driverId);
    if (!note && files.length === 0) {
      throw refuse("fleet_note_empty", "invalid-argument");
    }
    const driver = await db().collection("fleetDrivers").doc(driverId).get();
    if (!driver.exists || driver.get("businessId") !== businessId) {
      throw refuse("fleet_not_found", "not-found");
    }
    const ref = db().collection("fleetNotes").doc();
    await ref.set({businessId, driverId, text: note, files, byUid: uid,
      byName: text(user?.fullName || user?.email, 120), atMs: Date.now(),
      createdAt: FieldValue.serverTimestamp()});
    await audit(businessId, uid, "fleet_driver", driverId, "fleet_note_added",
        `Note added for ${driver.get("name") || "driver"}` +
        (files.length ? ` with ${files.length} file(s)` : ""));
    return {success: true, noteId: ref.id};
  }

  // Notes are never deleted: an admin marks one removed and it stays
  // visible, greyed out.
  async function noteVoid(uid, businessId, data) {
    const user = await requireAdmin(uid, businessId);
    const noteId = text(data.noteId, 180);
    const ref = db().collection("fleetNotes").doc(noteId || "-");
    let driverId = "";
    await db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists || doc.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      if (doc.get("voided")) throw refuse("fleet_note_voided");
      driverId = doc.get("driverId") || "";
      tx.update(ref, {voided: {byUid: uid,
        byName: text(user?.fullName || user?.email, 120), atMs: Date.now()}});
    });
    await audit(businessId, uid, "fleet_driver", driverId, "fleet_note_voided",
        "Note removed");
    return {success: true};
  }

  async function substituteSave(uid, businessId, data) {
    await requireStaff(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const driverId = text(data.driverId, 180);
    const friend = data.friend || {};
    const name = text(friend.name, 120);
    const fromDayKey = text(data.fromDayKey, 10);
    const toDayKey = text(data.toDayKey, 10);
    if (!driverId || !name || !DAY.test(fromDayKey) || !DAY.test(toDayKey) ||
        toDayKey < fromDayKey) {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    const substituteId = text(data.substituteId, 180);
    const col = db().collection("fleetSubstitutes");
    const ref = substituteId ? col.doc(substituteId) : col.doc();
    let carId = text(data.carId, 180);
    let driverName = "";
    await db().runTransaction(async (tx) => {
      const driver = await tx.get(db().collection("fleetDrivers")
          .doc(driverId));
      if (!driver.exists || driver.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      driverName = driver.get("name") || "";
      if (!carId) {
        // The car the driver has in those days.
        const mine = await tx.get(db().collection("fleetAssignments")
            .where("driverId", "==", driverId));
        const a = mine.docs.map((d) => d.data()).find((x) =>
          x.businessId === businessId && x.startDayKey <= toDayKey &&
          (!x.endDayKey || x.endDayKey >= fromDayKey));
        if (!a) throw refuse("fleet_bad_input", "invalid-argument");
        carId = a.carId;
      }
      const car = await tx.get(db().collection("fleetCars").doc(carId));
      if (!car.exists || car.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      const others = await tx.get(col.where("carId", "==", carId));
      const clash = others.docs.find((d) => d.id !== ref.id &&
        d.get("businessId") === businessId && !d.get("voided") &&
        d.get("fromDayKey") <= toDayKey && fromDayKey <= d.get("toDayKey"));
      if (clash) throw refuse("fleet_friend_overlap");
      let existing = null;
      if (substituteId) {
        existing = await tx.get(ref);
        if (!existing.exists || existing.get("businessId") !== businessId) {
          throw refuse("fleet_not_found", "not-found");
        }
      }
      const fields = {businessId, driverId, carId, name,
        phone: cleanPhone(friend.phone),
        tlcLicense: text(friend.tlcLicense, 20),
        address: {line1: text(friend.address?.line1, 160),
          city: text(friend.address?.city, 80),
          state: text(friend.address?.state, 40),
          zip: text(friend.address?.zip, 12)},
        fromDayKey, toDayKey};
      if (existing) {
        tx.set(ref, {...fields, updatedBy: uid,
          updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      } else {
        tx.set(ref, {...fields, byUid: uid,
          createdAt: FieldValue.serverTimestamp()});
      }
    });
    await audit(businessId, uid, "fleet_driver", driverId,
        "fleet_substitute_saved",
        `${name} drove ${driverName}'s car ${fromDayKey} to ${toDayKey}`);
    return {success: true, substituteId: ref.id, carId};
  }

  async function substituteVoid(uid, businessId, data) {
    await requireAdmin(uid, businessId);
    const id = text(data.substituteId, 180);
    const ref = db().collection("fleetSubstitutes").doc(id || "-");
    let driverId = "";
    await db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists || doc.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      driverId = doc.get("driverId") || "";
      if (doc.get("voided")) return;
      tx.update(ref, {voided: true, voidedBy: uid, voidedAtMs: Date.now()});
    });
    await audit(businessId, uid, "fleet_driver", driverId,
        "fleet_substitute_voided", "Friend period removed");
    return {success: true};
  }

  // ---- charges, waivers, payments --------------------------------------

  async function chargeAdd(uid, businessId, data) {
    await requireStaff(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const driverId = text(data.driverId, 180);
    const amount = cents(data.amountCents);
    const label = text(data.label, 120);
    const dueDayKey = DAY.test(text(data.dueDayKey, 10)) ?
      text(data.dueDayKey, 10) : deps.dayKeyNow();
    if (!driverId || !(amount > 0) || !label) {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    const ref = db().collection("fleetBills").doc();
    await db().runTransaction(async (tx) => {
      const ctx = await creditContext(tx, driverId);
      if (!ctx.driver.exists || ctx.driver.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      const charge = {id: ref.id, assignmentId: "", kind: "charge", label,
        periodFrom: dueDayKey, periodTo: dueDayKey, dueDayKey,
        amountCents: amount, paidCents: 0, status: "open"};
      // The driver's credit pays the new charge too (late fees first).
      const left = writeBillsSpendingCredit(tx, ctx, [charge],
          {businessId, driverId, carId: text(data.carId, 180),
            createdBy: uid});
      if (left !== ctx.credit) {
        tx.update(ctx.driver.ref, {creditCents: left,
          updatedAt: FieldValue.serverTimestamp()});
      }
    });
    await audit(businessId, uid, "fleet_bill", ref.id, "fleet_charge_added",
        `Charge ${label}: $${(amount / 100).toFixed(2)}`);
    return {success: true, billId: ref.id};
  }

  async function billWaive(uid, businessId, data) {
    await requireAdmin(uid, businessId);
    const billId = text(data.billId, 180);
    const reason = text(data.reason, 300);
    if (!reason) throw refuse("fleet_reason_required", "invalid-argument");
    const ref = db().collection("fleetBills").doc(billId);
    await db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists || doc.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      if (doc.get("status") !== "open") throw refuse("fleet_not_open");
      // A waived rent bill takes its late fee with it.
      const fee = doc.get("kind") === "rent" ?
        await tx.get(db().collection("fleetBills").doc(`${billId}_late`)) :
        null;
      tx.update(ref, {status: "waived",
        waived: {byUid: uid, atMs: Date.now(), reason},
        updatedAt: FieldValue.serverTimestamp()});
      const credit = voidLateFee(tx, fee);
      if (credit > 0 && doc.get("driverId")) {
        tx.update(db().collection("fleetDrivers").doc(doc.get("driverId")),
            {creditCents: FieldValue.increment(credit),
              updatedAt: FieldValue.serverTimestamp()});
      }
    });
    await audit(businessId, uid, "fleet_bill", billId, "fleet_bill_waived",
        `Waived (${reason})`);
    return {success: true};
  }

  /**
   * One payment inside a transaction: the driver's open bills, oldest and
   * late fees first, the rest to credit. Reads before writes. A payment
   * that comes from a bank deposit and whose bank date is on or before a
   * late fee's day, and that covers that fee's rent bill, takes the unpaid
   * fee back first (`void`, `voidReason: "paid_on_time"`, docs/
   * FLEET_PAYMENT_PROOF.md Q2).
   *
   * @param {object} tx The transaction.
   * @param {object} ref The new fleetPayments document.
   * @param {object} p {businessId, driverId, amount, method, paidDayKey,
   *   byUid, note, requireActive, claimId, bank?: {creditId, senderName,
   *   how}}.
   * @return {Promise<object>} The allocation plan.
   */
  async function applyPayment(tx, ref, p) {
    const driverRef = db().collection("fleetDrivers").doc(p.driverId);
    const [driver, open] = await Promise.all([
      tx.get(driverRef),
      tx.get(db().collection("fleetBills")
          .where("driverId", "==", p.driverId).where("status", "==", "open")),
    ]);
    if (!driver.exists || driver.get("businessId") !== p.businessId) {
      throw refuse("fleet_not_found", "not-found");
    }
    if (p.requireActive && driver.get("status") !== "active") {
      throw refuse("fleet_driver_left");
    }
    const bills = open.docs.map((d) => ({id: d.id, ...d.data()}));
    const feesBack = p.bank ?
      fleetBilling.lateFeesPaidOnTime(bills, p.paidDayKey, p.amount) : [];
    const plan = fleetBilling.allocatePayment(
        bills.filter((b) => !feesBack.includes(b.id)), p.amount);
    if (!plan.ok) throw refuse(plan.reason, "invalid-argument");
    for (const a of plan.allocations) {
      const bill = bills.find((b) => b.id === a.billId);
      const paid = (Number(bill.paidCents) || 0) + a.cents;
      tx.update(db().collection("fleetBills").doc(a.billId), {
        paidCents: paid,
        status: paid >= Number(bill.amountCents) ? "paid" : "open",
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    for (const feeId of feesBack) {
      tx.update(db().collection("fleetBills").doc(feeId), {
        status: "void", voidReason: "paid_on_time", voidedAtMs: nowMs(),
        voidedByPaymentId: ref.id, updatedAt: FieldValue.serverTimestamp()});
    }
    const driverPatch = {};
    if (plan.creditAddedCents > 0) {
      driverPatch.creditCents = FieldValue.increment(plan.creditAddedCents);
    }
    // The sender is remembered, so their next deposit pays this driver
    // (a person's Zelle only: never an account, an app, cash or a check).
    if (p.bank && fleetBank.senderRememberable(p.bank)) {
      driverPatch.rememberedSenders =
        FieldValue.arrayUnion(fleetBank.matchKey(p.bank.senderName));
    }
    if (Object.keys(driverPatch).length) {
      tx.update(driverRef, {...driverPatch,
        updatedAt: FieldValue.serverTimestamp()});
    }
    tx.set(ref, {businessId: p.businessId, driverId: p.driverId,
      amountCents: p.amount, method: p.method, paidDayKey: p.paidDayKey,
      receivedAtMs: Date.now(), receivedByUid: p.byUid,
      allocations: plan.allocations,
      creditAddedCents: plan.creditAddedCents, creditUsedCents: 0,
      status: "recorded", imported: false, note: p.note || "",
      ...(feesBack.length ? {lateFeesVoided: feesBack} : {}),
      ...(p.claimId ? {claimId: p.claimId} : {}),
      ...(p.bank ? {bankTxnId: p.bank.creditId,
        bankSenderName: p.bank.senderName || "",
        matchedBy: p.bank.how} : {}),
      createdAt: FieldValue.serverTimestamp()});
    return plan;
  }

  async function paymentRecord(uid, businessId, data) {
    await requireStaff(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const driverId = text(data.driverId, 180);
    const amount = cents(data.amountCents);
    const method = ["zelle", "cash", "other"].includes(data.method) ?
      data.method : "zelle";
    const paidDayKey = DAY.test(text(data.paidDayKey, 10)) ?
      text(data.paidDayKey, 10) : deps.dayKeyNow();
    if (!driverId) throw refuse("fleet_bad_input", "invalid-argument");
    if (!(amount > 0)) throw refuse("fleet_no_amount", "invalid-argument");
    const ref = db().collection("fleetPayments").doc();
    let result;
    await db().runTransaction(async (tx) => {
      result = await applyPayment(tx, ref, {businessId, driverId,
        amount, method, paidDayKey, byUid: uid, note: text(data.note, 300)});
    });
    await audit(businessId, uid, "fleet_payment", ref.id,
        "fleet_payment_recorded",
        `Payment $${(amount / 100).toFixed(2)} (${method})`);
    await sendReceipt(businessId, ref.id);
    return {success: true, paymentId: ref.id,
      creditAddedCents: result.creditAddedCents};
  }

  async function paymentUndo(uid, businessId, data) {
    await requireAdmin(uid, businessId);
    const paymentId = text(data.paymentId, 180);
    const ref = db().collection("fleetPayments").doc(paymentId);
    let amount = 0;
    await db().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists || doc.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      const p = doc.data();
      if (p.status === "undone") throw refuse("fleet_already_undone");
      // Spreadsheet history carries no bill split to take back.
      if (p.imported === true) throw refuse("fleet_import_locked");
      const billDocs = await Promise.all((p.allocations || []).map((a) =>
        tx.get(db().collection("fleetBills").doc(a.billId))));
      const driverRef = db().collection("fleetDrivers").doc(p.driverId);
      const driver = await tx.get(driverRef);
      // The late fees this payment took back (paid on time) are owed again.
      const feeDocs = await Promise.all((p.lateFeesVoided || []).map((id) =>
        tx.get(db().collection("fleetBills").doc(String(id)))));
      // The extra this payment left as credit may have paid later bills
      // since: what is no longer held is taken back from the driver's
      // bills, newest first, so what they owe is right again (the credit
      // never goes below zero, where it would simply vanish).
      const creditAdded = Math.max(0, Number(p.creditAddedCents) || 0);
      const held = driver.exists ?
        Math.max(0, Number(driver.get("creditCents")) || 0) : 0;
      // The part of each allocation that is no longer on its bill (a plate
      // came back and the paid part became credit) is taken from the credit
      // too, not just the extra this payment left.
      let returned = 0;
      const stillOn = new Map();
      for (const [i, a] of (p.allocations || []).entries()) {
        if (!billDocs[i].exists) continue;
        const now = stillOn.has(billDocs[i].id) ?
          stillOn.get(billDocs[i].id) :
          Math.max(0, Number(billDocs[i].get("paidCents")) || 0);
        const take = Math.min(now, Number(a.cents) || 0);
        returned += (Number(a.cents) || 0) - take;
        stillOn.set(billDocs[i].id, now - take);
      }
      const creditOut = creditAdded + returned;
      const shortfall = Math.max(0, creditOut - held);
      const laterBills = shortfall > 0 ? (await tx.get(
          db().collection("fleetBills").where("driverId", "==", p.driverId)))
          .docs.filter((d) => d.get("businessId") === businessId) : [];
      // The deposit it used, and the posted copy the bank replaced it with
      // since (the payment still points at the first one).
      const credits = [];
      let creditId = String(p.bankTxnId || "");
      for (let i = 0; creditId && i < 4; i += 1) {
        const c = await tx.get(
            db().collection("businessBankCredits").doc(creditId));
        if (!c.exists) break;
        credits.push(c);
        const next = String(c.get("replacedByTransactionId") || "");
        creditId = next ? `${businessId}_${next}` : "";
      }
      // What each bill has left as paid once this payment's own shares
      // (and then the spent credit) are taken back; one write per bill.
      const after = new Map();
      const billOf = new Map();
      for (const [i, a] of (p.allocations || []).entries()) {
        const b = billDocs[i];
        if (!b.exists) continue;
        billOf.set(b.id, b);
        const now = after.has(b.id) ? after.get(b.id) :
          Number(b.get("paidCents")) || 0;
        after.set(b.id, Math.max(0, now - a.cents));
      }
      const creditTakenBack = [];
      let left = shortfall;
      const newestFirst = [...laterBills].sort((x, y) =>
        String(y.get("dueDayKey") || "").localeCompare(
            String(x.get("dueDayKey") || "")) || y.id.localeCompare(x.id));
      for (const b of newestFirst) {
        if (left <= 0) break;
        if (!["open", "paid"].includes(b.get("status"))) continue;
        const paid = after.has(b.id) ? after.get(b.id) :
          Number(b.get("paidCents")) || 0;
        const take = Math.min(left, paid);
        if (take <= 0) continue;
        billOf.set(b.id, billOf.get(b.id) || b);
        after.set(b.id, paid - take);
        creditTakenBack.push({billId: b.id, cents: take});
        left -= take;
      }
      for (const [billId, paid] of after) {
        const b = billOf.get(billId);
        const status = b.get("status") === "paid" ? "open" : b.get("status");
        tx.update(b.ref, {paidCents: paid, status,
          updatedAt: FieldValue.serverTimestamp()});
      }
      for (const fee of feeDocs) {
        if (fee.exists && fee.get("status") === "void" &&
            fee.get("voidReason") === "paid_on_time") {
          tx.update(fee.ref, {status: "open",
            voidReason: FieldValue.delete(), voidedAtMs: FieldValue.delete(),
            voidedByPaymentId: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp()});
        }
      }
      const driverPatch = {};
      if (creditOut > 0) {
        driverPatch.creditCents = Math.max(0, held - creditOut);
      }
      // The match was wrong: this sender is no longer this driver's, or the
      // next deposit would go to the same wrong driver by itself (stored
      // under the old key or the cleaned one).
      if (p.bankSenderName) {
        driverPatch.rememberedSenders = FieldValue.arrayRemove(
            fleetBank.senderKey(p.bankSenderName),
            fleetBank.matchKey(p.bankSenderName));
      }
      if (driver.exists && Object.keys(driverPatch).length) {
        tx.update(driverRef, {...driverPatch,
          updatedAt: FieldValue.serverTimestamp()});
      }
      tx.update(ref, {status: "undone", undoneByUid: uid,
        undoneAtMs: Date.now(),
        ...(returned > 0 ? {returnCreditTakenCents: returned} : {}),
        ...(creditTakenBack.length ? {creditTakenBack} : {})});
      // The bank deposit goes back to "waiting" for the right driver, and
      // never pays by itself again (`fleetUndone`, also carried to the
      // bank's posted copy).
      for (const c of credits) {
        const used = c.get("consumedBy");
        if (used && used.id && used.id !== paymentId) continue;
        tx.set(c.ref, {
          consumedBy: FieldValue.delete(), consumedAt: FieldValue.delete(),
          consumedByUid: FieldValue.delete(), fleetUndone: true,
          ...(c.get("removed") === true ? {} :
            {fleetWaiting: true, fleetWaitingReason: "undone"}),
        }, {merge: true});
      }
      amount = Number(p.amountCents) || 0;
    });
    // A report that this payment answered goes back to the office.
    await reopenClaimsOf(paymentId);
    await audit(businessId, uid, "fleet_payment", paymentId,
        "fleet_payment_undone", `Payment $${(amount / 100).toFixed(2)} undone`);
    return {success: true};
  }

  // ---- bank deposits (phase 1b, docs/FLEET.md §8) ----------------------

  async function activeDrivers(businessId) {
    const snap = await db().collection("fleetDrivers")
        .where("businessId", "==", businessId)
        .where("status", "==", "active").get();
    return snap.docs.map((d) => ({id: d.id, ...d.data()}));
  }

  /**
   * One deposit paying one driver: claims the deposit (consumedBy) and
   * records the payment in one transaction, so a deposit is never used
   * twice (a shop sale, another driver, a second sync). Paying from a
   * driver's report (`claimId`) marks the report paid in the same
   * transaction. The payment's day is the bank's date (Q2).
   *
   * @param {object} p {businessId, creditId, driverId, how, byUid, claimId,
   *   requireWaiting (the office's "Pay this driver": the deposit must be on
   *   the waiting list), requireActive}.
   * @return {Promise<object>} {paymentId, amountCents}.
   */
  async function payFromDeposit(p) {
    const creditRef = db().collection("businessBankCredits").doc(p.creditId);
    const ref = db().collection("fleetPayments").doc();
    const claimRef = p.claimId ?
      db().collection("fleetClaims").doc(p.claimId) : null;
    let amount = 0;
    await db().runTransaction(async (tx) => {
      const doc = await tx.get(creditRef);
      const claim = claimRef ? await tx.get(claimRef) : null;
      const credit = doc.exists ? doc.data() || {} : null;
      if (!credit || credit.businessId !== p.businessId ||
          credit.removed === true) {
        throw refuse("fleet_not_found", "not-found");
      }
      if (credit.consumedBy && credit.consumedBy.kind) {
        throw refuse("fleet_deposit_used");
      }
      if (p.requireWaiting && credit.fleetWaiting !== true) {
        throw refuse("fleet_deposit_not_waiting");
      }
      if (claim && (!claim.exists ||
          claim.get("businessId") !== p.businessId ||
          claim.get("driverId") !== p.driverId ||
          !fleetClaims.OPEN_STATES.includes(claim.get("state")))) {
        throw refuse("fleet_claim_closed");
      }
      amount = Number(credit.amountCents) || 0;
      const day = String(credit.dateKey || "") || deps.dayKeyNow();
      await applyPayment(tx, ref, {businessId: p.businessId,
        driverId: p.driverId, amount, method: "zelle", paidDayKey: day,
        byUid: p.byUid, note: "", requireActive: p.requireActive !== false,
        claimId: p.claimId || "",
        bank: {creditId: p.creditId, senderName: credit.senderName || "",
          zelle: credit.zelle, how: p.how}});
      tx.set(creditRef, {consumedBy: {kind: "fleet_payment", id: ref.id},
        consumedAt: FieldValue.serverTimestamp(), consumedByUid: p.byUid,
        fleetWaiting: false, fleetWaitingReason: FieldValue.delete()},
      {merge: true});
      if (claimRef) {
        tx.update(claimRef, {state: fleetClaims.STATE.PAID, open: false,
          creditId: p.creditId, paymentId: ref.id, paidAtMs: nowMs(),
          updatedAt: FieldValue.serverTimestamp()});
      }
    });
    await audit(p.businessId, p.byUid, "fleet_payment", ref.id,
        "fleet_payment_recorded",
        `Zelle $${(amount / 100).toFixed(2)} from the bank ` +
        `(${p.how === "office" ? "picked by the office" :
          p.how === "sender" ? "known sender" :
            "from the driver's report"})`);
    if (!p.claimId) {
      await settleClaimsFor(p.driverId, amount, ref.id, p.creditId);
    }
    await sendReceipt(p.businessId, ref.id);
    return {paymentId: ref.id, amountCents: amount};
  }

  /**
   * A deposit paid a driver by a remembered name while the driver also had a
   * report of the same amount: that report is answered. Best effort.
   *
   * @param {string} driverId The driver.
   * @param {number} amountCents The deposit.
   * @param {string} paymentId The payment.
   * @param {string} creditId The deposit.
   * @return {Promise<void>}
   */
  async function settleClaimsFor(driverId, amountCents, paymentId, creditId) {
    try {
      const snap = await db().collection("fleetClaims")
          .where("driverId", "==", driverId).get();
      const claim = snap.docs.find((d) =>
        fleetClaims.takesDeposit({...d.data()}) &&
        Number(d.get("amountCents")) === amountCents);
      if (!claim) return;
      await claim.ref.update({state: fleetClaims.STATE.PAID, open: false,
        paymentId, creditId, paidAtMs: nowMs(),
        updatedAt: FieldValue.serverTimestamp()});
    } catch (error) {
      deps.logger.warn("Fleet report not settled", {driverId,
        error: String(error?.message || error)});
    }
  }

  /**
   * An undone payment: the report it answered goes back to the office.
   *
   * @param {string} paymentId The undone payment.
   * @return {Promise<void>}
   */
  async function reopenClaimsOf(paymentId) {
    try {
      const snap = await db().collection("fleetClaims")
          .where("paymentId", "==", paymentId).get();
      for (const d of snap.docs) {
        if (d.get("state") !== fleetClaims.STATE.PAID) continue;
        await d.ref.update({state: fleetClaims.STATE.OFFICE, open: true,
          reason: fleetClaims.REASON.PAYMENT_UNDONE,
          paymentId: null, creditId: null,
          updatedAt: FieldValue.serverTimestamp()});
      }
    } catch (error) {
      deps.logger.warn("Fleet report not reopened", {paymentId,
        error: String(error?.message || error)});
    }
  }

  /**
   * A business's reports a deposit can pay, as matchDeposit wants them.
   *
   * @param {string} businessId The business.
   * @return {Promise<Array<object>>} [{id, driverId, amountCents, payerName,
   *   dayKey, createdAtMs}].
   */
  async function claimsForMatching(businessId) {
    const snap = await db().collection("fleetClaims")
        .where("businessId", "==", businessId)
        .where("open", "==", true).get();
    return snap.docs.map((d) => ({id: d.id, ...d.data()}))
        .filter((c) => fleetClaims.takesDeposit(c))
        .map((c) => ({id: c.id, driverId: c.driverId,
          amountCents: Number(c.amountCents) || 0,
          payerName: c.payerName || "", dayKey: c.read?.dayKey || "",
          createdAtMs: Number(c.createdAtMs) || 0}));
  }

  /**
   * One stored deposit: it pays its driver, or waits for the office. Throws
   * on a failure of its own (the caller carries on with the next deposit).
   *
   * @param {object} env {businessId, since, drivers, claims (mutable)}.
   * @param {object} doc The deposit's snapshot.
   * @return {Promise<string>} "paid" | "waiting" | "skipped".
   */
  async function matchOneDeposit(env, doc) {
    const {businessId} = env;
    const credit = doc.exists ? doc.data() || {} : null;
    if (!credit || credit.businessId !== businessId) return "skipped";
    if (!fleetBank.depositMatchable(credit, env.since)) return "skipped";
    const sameAmount = await db().collection("businessBankCredits")
        .where("businessId", "==", businessId)
        .where("amountCents", "==", Number(credit.amountCents) || 0)
        .orderBy("createdAt", "desc").limit(50).get();
    const stored = sameAmount.docs.map((d) => ({id: d.id, ...d.data()}));
    const repeat = fleetBank.possibleDuplicateOf({id: doc.id, ...credit},
        stored);
    const others = stored.filter((o) => o.id !== doc.id &&
      o.removed !== true && !(o.consumedBy && o.consumedBy.kind));
    const match = repeat ?
      {reason: repeat.fleetUndone === true ? "undone" : "possible_duplicate"} :
      fleetBank.matchDeposit({id: doc.id, ...credit}, env.drivers,
          {claims: env.claims, others});
    if (match.driverId) {
      try {
        await payFromDeposit({businessId, creditId: doc.id,
          driverId: match.driverId, how: match.how, byUid: "bank",
          claimId: match.claimId || ""});
        const taken = Number(credit.amountCents) || 0;
        env.claims = env.claims.filter((c) => c.id !== match.claimId &&
          !(c.driverId === match.driverId && c.amountCents === taken));
        return "paid";
      } catch (error) {
        // The bank often sends two notices in the same second and both
        // runs try the same deposit: the one that lost has nothing to
        // do. It must not put a paid deposit on the waiting list.
        const now = await doc.ref.get();
        const used = now.exists ? now.data()?.consumedBy : null;
        if (used && used.kind) return "skipped";
        deps.logger.warn("Fleet deposit not applied", {businessId,
          creditId: doc.id, error: String(error?.message || error)});
      }
    }
    const reason = match.reason || "unknown";
    if (credit.fleetWaiting !== true ||
        credit.fleetWaitingReason !== reason || !credit.fleetLookedAtMs) {
      await doc.ref.set({fleetWaiting: true, fleetWaitingReason: reason,
        fleetLookedAtMs: nowMs()}, {merge: true});
    }
    // Two reports could have been this deposit: the office sees why.
    for (const claimId of match.claimIds || []) {
      await db().collection("fleetClaims").doc(claimId).set({
        reason: fleetClaims.REASON.TWO_CLAIMS,
        updatedAt: FieldValue.serverTimestamp()}, {merge: true})
          .catch(() => undefined);
    }
    return "waiting";
  }

  /**
   * After a bank sync: each new deposit from a person pays its driver, or
   * waits for the office. Never throws (a sync must not fail over Fleet),
   * and one failing deposit does not stop the others.
   *
   * @param {string} businessId The business.
   * @param {Array<string>} creditIds The deposits the sync wrote.
   * @return {Promise<object>} {paid, waiting}.
   */
  async function matchBankDeposits(businessId, creditIds) {
    const out = {paid: 0, waiting: 0};
    try {
      const ids = [...new Set((creditIds || []).filter(Boolean))];
      if (ids.length === 0) return out;
      const {data: business} = await businessOf(businessId);
      if (!fleetOn(business)) return out;
      const link = (await db().collection("businessBankLinks")
          .doc(businessId).get()).data() || {};
      const refs = ids.map((id) =>
        db().collection("businessBankCredits").doc(id));
      const docs = [];
      for (let i = 0; i < refs.length; i += 100) {
        docs.push(...await db().getAll(...refs.slice(i, i + 100)));
      }
      // Every driver, not only the active ones: a sender who paid for a
      // driver who left must not be given to someone else.
      const drivers = (await db().collection("fleetDrivers")
          .where("businessId", "==", businessId).get())
          .docs.map((d) => ({id: d.id, ...d.data()}));
      const env = {businessId, since: fleetBank.matchStartMs(business, link),
        drivers, claims: await claimsForMatching(businessId)};
      for (const doc of docs) {
        try {
          const result = await matchOneDeposit(env, doc);
          if (result === "paid") out.paid += 1;
          if (result === "waiting") out.waiting += 1;
        } catch (error) {
          deps.logger.warn("Fleet deposit skipped after an error",
              {businessId, creditId: doc.id,
                error: String(error?.message || error)});
        }
      }
    } catch (error) {
      deps.logger.error("Fleet deposit matching failed", {businessId,
        error: String(error?.message || error)});
    }
    return out;
  }

  /**
   * The deposits waiting for the office are looked at again (a new report
   * or answer may now name them).
   *
   * @param {string} businessId The business.
   * @return {Promise<object>} {paid, waiting}.
   */
  async function rematchWaiting(businessId) {
    const snap = await db().collection("businessBankCredits")
        .where("businessId", "==", businessId)
        .where("fleetWaiting", "==", true).get();
    const ids = snap.docs.filter((d) => d.get("removed") !== true &&
      !(d.get("consumedBy") && d.get("consumedBy").kind)).map((d) => d.id);
    return ids.length ? matchBankDeposits(businessId, ids) :
      {paid: 0, waiting: 0};
  }

  /**
   * A sweep for deposits nobody looked at (a sync that stopped before
   * matching, a failure): recent, matchable, never marked as looked at.
   * Deposits younger than ten minutes are left to their own sync.
   *
   * @param {string} businessId The business.
   * @param {object} business Its record.
   * @return {Promise<object>} {paid, waiting}.
   */
  async function sweepDeposits(businessId, business) {
    const link = (await db().collection("businessBankLinks")
        .doc(businessId).get()).data() || {};
    const since = fleetBank.matchStartMs(business, link);
    const snap = await db().collection("businessBankCredits")
        .where("businessId", "==", businessId)
        .orderBy("createdAt", "desc").limit(100).get();
    const cutoff = nowMs() - 10 * 60 * 1000;
    const ids = snap.docs.filter((d) => {
      const c = d.data() || {};
      const created = typeof c.createdAt?.toMillis === "function" ?
        c.createdAt.toMillis() : 0;
      return created <= cutoff && fleetBank.depositMatchable(c, since) &&
        !c.fleetLookedAtMs && c.fleetWaiting !== true;
    }).map((d) => d.id);
    return ids.length ? matchBankDeposits(businessId, ids) :
      {paid: 0, waiting: 0};
  }

  /**
   * What one bank check costs this business (its Bills price, else
   * Plaid's).
   *
   * @param {string} businessId The business.
   * @return {Promise<number>} Cents.
   */
  async function checkPriceCents(businessId) {
    try {
      const cents = await deps.bankCheckPriceCents(businessId);
      return Number.isFinite(cents) && cents >= 0 ? cents :
        fleetBank.PLAID_REFRESH_CENTS;
    } catch (error) {
      return fleetBank.PLAID_REFRESH_CENTS;
    }
  }

  async function bankStatus(uid, businessId) {
    await requireStaff(uid, businessId);
    const {data: business} = await businessOf(businessId);
    const schedule = fleetBank.cleanBankSchedule(
        business?.fleet?.settings?.bankSchedule);
    const centsEach = await checkPriceCents(businessId);
    const link = await deps.bankLinkSummary(businessId);
    const waitingSnap = await db().collection("businessBankCredits")
        .where("businessId", "==", businessId)
        .where("fleetWaiting", "==", true).get();
    const waiting = waitingSnap.docs.map((d) => ({id: d.id, ...d.data()}))
        .filter((c) => c.removed !== true &&
          !(c.consumedBy && c.consumedBy.kind))
        .sort((a, b) => (Number(b.atMs) || 0) - (Number(a.atMs) || 0))
        .slice(0, 100)
        .map((c) => ({id: c.id, amountCents: Number(c.amountCents) || 0,
          senderName: String(c.senderName || ""), atMs: Number(c.atMs) || 0,
          dateKey: String(c.dateKey || ""), pending: c.pending === true,
          reason: String(c.fleetWaitingReason || "unknown"),
          bankLine: String(c.bankLine || "")}));
    // Payments whose deposit the bank took back since: the office decides.
    const removedSnap = await db().collection("fleetPayments")
        .where("businessId", "==", businessId)
        .where("bankRemoved", "==", true).get();
    const removed = removedSnap.docs
        .filter((d) => d.get("status") === "recorded" &&
          !d.get("bankRemovedKeptAtMs"))
        .map((d) => ({paymentId: d.id,
          driverId: String(d.get("driverId") || ""),
          amountCents: Number(d.get("amountCents")) || 0,
          paidDayKey: String(d.get("paidDayKey") || ""),
          senderName: String(d.get("bankSenderName") || ""),
          removedAtMs: Number(d.get("bankRemovedAtMs")) || 0}))
        .sort((a, b) => b.removedAtMs - a.removedAtMs).slice(0, 50);
    return {success: true, schedule,
      quote: fleetBank.bankScheduleQuote(schedule, centsEach),
      bank: link, waiting, removed, claims: await openClaimsView(businessId),
      lastScheduledMs: Number(business?.fleet?.bankLastScheduledMs) || 0};
  }

  /**
   * The reports the office still has to look at: every open one, newest
   * first (up to 100).
   *
   * @param {string} businessId The business.
   * @return {Promise<Array<object>>} The list `bank_status` returns.
   */
  async function openClaimsView(businessId) {
    const snap = await db().collection("fleetClaims")
        .where("businessId", "==", businessId)
        .where("open", "==", true).get();
    const list = snap.docs.map((d) => ({id: d.id, ...d.data()}))
        .sort((a, b) => (Number(b.createdAtMs) || 0) -
          (Number(a.createdAtMs) || 0)).slice(0, 100);
    const driverIds = [...new Set(list.map((c) => c.driverId)
        .filter(Boolean))];
    const names = new Map();
    for (let i = 0; i < driverIds.length; i += 100) {
      const docs = await db().getAll(...driverIds.slice(i, i + 100)
          .map((id) => db().collection("fleetDrivers").doc(id)));
      for (const d of docs) {
        if (d.exists) names.set(d.id, d.get("name") || "");
      }
    }
    return list.map((c) => ({id: c.id, driverId: c.driverId || null,
      driverName: c.driverId ? String(names.get(c.driverId) || "") : "",
      amountCents: Number(c.amountCents) > 0 ? Number(c.amountCents) : null,
      state: c.state, reason: c.reason || null,
      createdAtMs: Number(c.createdAtMs) || 0,
      hasPhoto: Boolean(c.caseId && c.messageId),
      fromPhone: String(c.fromPhone || ""),
      payerName: c.payerName || null,
      toldLateAtMs: Number(c.toldLateAtMs) || null}));
  }

  async function bankScheduleSave(uid, businessId, data) {
    await requireAdmin(uid, businessId);
    const {ref, data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const schedule = fleetBank.cleanBankSchedule(data.schedule);
    const quote = fleetBank.bankScheduleQuote(schedule,
        await checkPriceCents(businessId));
    await ref.update({"fleet.settings.bankSchedule": schedule,
      updatedAt: FieldValue.serverTimestamp()});
    await audit(businessId, uid, "fleet_settings", businessId,
        "fleet_bank_schedule", schedule.every > 0 ?
          `Pay-day bank checks every ${schedule.every} min, ` +
          `${schedule.fromHour}:00-${schedule.toHour}:00, about ` +
          `${quote.perMonth} a month ` +
          `($${(quote.monthCents / 100).toFixed(2)})` :
          "Pay-day bank checks off");
    return {success: true, schedule, quote};
  }

  /**
   * After a bank sync: deposits the bank took back for good. One that had
   * paid a driver leaves its payment standing (the money may still be
   * there under a new number) and marks it, so the office sees it and
   * decides: keep it, or undo it. Never throws.
   *
   * @param {string} businessId The business.
   * @param {Array<string>} creditIds The removed deposits.
   * @return {Promise<number>} How many payments were marked.
   */
  async function noteRemovedDeposits(businessId, creditIds) {
    let marked = 0;
    try {
      const ids = [...new Set((creditIds || []).filter(Boolean))];
      for (let i = 0; i < ids.length; i += 100) {
        const docs = await db().getAll(...ids.slice(i, i + 100).map((id) =>
          db().collection("businessBankCredits").doc(id)));
        for (const doc of docs) {
          const credit = doc.exists ? doc.data() || {} : null;
          if (!credit || credit.businessId !== businessId) continue;
          const used = credit.consumedBy;
          if (!used || used.kind !== "fleet_payment" || !used.id) continue;
          const ref = db().collection("fleetPayments").doc(String(used.id));
          const done = await db().runTransaction(async (tx) => {
            const pay = await tx.get(ref);
            if (!pay.exists || pay.get("businessId") !== businessId ||
                pay.get("status") !== "recorded" ||
                pay.get("bankRemoved") === true) return false;
            tx.update(ref, {bankRemoved: true, bankRemovedAtMs: Date.now()});
            return true;
          });
          if (done) {
            marked += 1;
            deps.logger.warn("Fleet: the bank removed a deposit that paid " +
              "a driver", {businessId, paymentId: ref.id});
          }
        }
      }
    } catch (error) {
      deps.logger.error("Fleet removed-deposit check failed", {businessId,
        error: String(error?.message || error)});
    }
    return marked;
  }

  /**
   * The office looked at a payment whose deposit the bank removed and the
   * money is there: the payment stays and the notice goes.
   *
   * @param {string} uid The caller.
   * @param {string} businessId The business.
   * @param {object} data {paymentId}.
   * @return {Promise<object>} {success}.
   */
  async function bankRemovedKeep(uid, businessId, data) {
    await requireAdmin(uid, businessId);
    const paymentId = text(data.paymentId, 180);
    const ref = db().collection("fleetPayments").doc(paymentId);
    const doc = await ref.get();
    if (!doc.exists || doc.get("businessId") !== businessId ||
        doc.get("bankRemoved") !== true) {
      throw refuse("fleet_not_found", "not-found");
    }
    await ref.update({bankRemovedKeptByUid: uid,
      bankRemovedKeptAtMs: Date.now()});
    await audit(businessId, uid, "fleet_payment", paymentId,
        "fleet_payment_kept", "Kept: the bank removed its deposit, the " +
        "money was checked");
    return {success: true};
  }

  async function bankAssign(uid, businessId, data) {
    await requireStaff(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const creditId = text(data.creditId, 300);
    const driverId = text(data.driverId, 180);
    if (!creditId || !driverId) {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    // An active driver of this business, and a deposit that is waiting.
    const driver = await db().collection("fleetDrivers").doc(driverId).get();
    if (!driver.exists || driver.get("businessId") !== businessId) {
      throw refuse("fleet_not_found", "not-found");
    }
    if (driver.get("status") !== "active") throw refuse("fleet_driver_left");
    const result = await payFromDeposit({businessId, creditId, driverId,
      how: "office", byUid: uid, requireWaiting: true, requireActive: true});
    return {success: true, ...result};
  }

  async function bankCheckNow(uid, businessId) {
    await requireStaff(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const outcome = await deps.fleetBankCheckNow(businessId, uid);
    if (outcome?.noBank) throw refuse("fleet_no_bank");
    return {success: true, ...(outcome || {})};
  }

  /**
   * The 15-minute job: each Fleet business whose pay-day schedule says so
   * gets one paid refresh; Plaid's webhook then syncs and matching runs.
   *
   * @param {number} nowMs Now.
   * @return {Promise<object>} {asked}.
   */
  async function fleetBankTick(nowMs = Date.now()) {
    const businesses = await db().collection("businesses")
        .where("fleet.enabled", "==", true).get();
    let asked = 0;
    // Rent reminders: once a day, from the reminder hour (New York).
    const now = fleetBank.nyParts(nowMs);
    if (now.hour >= fleetWhatsApp.REMINDER_HOUR) {
      const today = deps.dayKeyNow();
      for (const b of businesses.docs) {
        const business = b.data() || {};
        if (!whatsappOn(business)) continue;
        if (business.fleet?.remindersSentDayKey === today) continue;
        try {
          // No Zelle address: a reminder would tell drivers to pay nobody.
          // Skipped, and said once a business a day.
          if (!zelleHandle(business)) {
            if (business.fleet?.remindersZelleLoggedDayKey !== today) {
              await b.ref.update({"fleet.remindersZelleLoggedDayKey": today});
              deps.logger.warn("Fleet reminders skipped: no Zelle address",
                  {businessId: b.id});
            }
            continue;
          }
          const {tried, failed} = await remindBusiness(b.id, business, today);
          // The day is done only once nothing is left to retry: a pass with
          // a failed send is looked at again on the next tick, and a row
          // that was sent is never sent twice (sendFleetMessage).
          if (failed === 0) {
            await b.ref.update({"fleet.remindersSentDayKey": today});
          }
          deps.logger.info("Fleet reminders", {businessId: b.id, tried,
            failed});
        } catch (error) {
          deps.logger.warn("Fleet reminders failed", {businessId: b.id,
            error: String(error?.message || error)});
        }
      }
    }
    // Drivers' payment reports against the clock, and (once an hour) a sweep
    // for deposits nobody looked at.
    for (const b of businesses.docs) {
      try {
        await runClaimTimers(b.id, b.data() || {}, nowMs);
        if (now.minute < 15) await sweepDeposits(b.id, b.data() || {});
      } catch (error) {
        deps.logger.warn("Fleet report timers failed", {businessId: b.id,
          error: String(error?.message || error)});
      }
    }
    for (const b of businesses.docs) {
      const fleet = b.get("fleet") || {};
      const schedule =
        fleetBank.cleanBankSchedule(fleet.settings?.bankSchedule);
      if (!fleetBank.bankRefreshDue(schedule, nowMs,
          Number(fleet.bankLastScheduledMs) || 0)) {
        continue;
      }
      try {
        await b.ref.update({"fleet.bankLastScheduledMs": nowMs});
        const done = await deps.fleetScheduledRefresh(b.id);
        if (done) asked += 1;
      } catch (error) {
        deps.logger.warn("Fleet bank check failed", {businessId: b.id,
          error: String(error?.message || error)});
      }
    }
    return {asked};
  }

  // ---- drivers on WhatsApp (docs/FLEET.md section 9) --------------------

  function whatsappOn(business) {
    return business?.fleet?.settings?.whatsapp?.enabled === true;
  }

  // The Zelle address drivers are told to pay (empty: none set).
  function zelleHandle(business) {
    return text(business?.fleet?.settings?.zelle?.handle, 120);
  }

  /**
   * Whether this driver may get WhatsApp messages: everyone when the
   * business has no "only these drivers" list (a test or a pilot), else
   * only the drivers on it.
   *
   * @param {object} business The business record.
   * @param {string} driverId The driver.
   * @return {boolean} True when the driver may get messages.
   */
  function whatsappAllows(business, driverId) {
    const only = business?.fleet?.settings?.whatsapp?.onlyDriverIds;
    if (!Array.isArray(only) || only.length === 0) return true;
    return only.includes(driverId);
  }

  /**
   * One driver's open bills and credit, read now.
   *
   * @param {string} driverId The driver.
   * @param {object} driver Their record.
   * @return {Promise<object>} {bills, owedCents, creditCents}.
   */
  async function driverMoney(driverId, driver) {
    const snap = await db().collection("fleetBills")
        .where("driverId", "==", driverId).where("status", "==", "open").get();
    const bills = snap.docs.map((d) => ({id: d.id, ...d.data()}));
    const balance = fleetBilling.driverBalance(bills,
        Number(driver?.creditCents) || 0, deps.dayKeyNow());
    return {bills, owedCents: balance.owedCents,
      creditCents: Math.max(0, Number(driver?.creditCents) || 0)};
  }

  /**
   * A payment's receipt to its driver, when the business has WhatsApp on.
   * Never throws: a payment never fails over a message.
   *
   * @param {string} businessId The business.
   * @param {string} paymentId The fleetPayments id.
   * @return {Promise<string>} The message status, or "" when none was sent.
   */
  async function sendReceipt(businessId, paymentId) {
    try {
      const {data: business} = await businessOf(businessId);
      if (!fleetOn(business) || !whatsappOn(business)) return "";
      const pay = await db().collection("fleetPayments").doc(paymentId).get();
      if (!pay.exists || pay.get("imported") === true) return "";
      const driverId = String(pay.get("driverId") || "");
      if (!whatsappAllows(business, driverId)) return "";
      const driverDoc = await db().collection("fleetDrivers").doc(driverId)
          .get();
      const driver = driverDoc.exists ? driverDoc.data() || {} : {};
      const money = await driverMoney(driverId, driver);
      const values = fleetWhatsApp.receiptValues({
        driverName: driver.name, businessName: business.name,
        businessPhone: business.phone,
        amountCents: Number(pay.get("amountCents")) || 0,
        paidDayKey: String(pay.get("paidDayKey") || deps.dayKeyNow()),
        owedCents: money.owedCents, creditCents: money.creditCents});
      return await deps.sendFleetMessage({
        id: fleetWhatsApp.messageId("receipt", {paymentId}),
        row: {businessId, driverId, kind: "receipt", paymentId,
          template: fleetWhatsApp.RECEIPT_TEMPLATE,
          phone: String(driver.phone || ""), name: String(driver.name || "")},
        body: fleetWhatsApp.templateBody(fleetWhatsApp.RECEIPT_TEMPLATE,
            driver.phone, values),
        reachable: fleetWhatsApp.reachable(driver.phone),
      });
    } catch (error) {
      deps.logger.warn("Fleet receipt not sent", {businessId, paymentId,
        error: String(error?.message || error)});
      return "";
    }
  }

  /**
   * One business's reminders for today: each active driver whose oldest
   * open RENT bill is due in 2 days, due today, 3 days late or a further
   * week late, and (looking ahead) each driver whose next period is due in
   * exactly 2 days and has no bill yet. At most one automatic reminder per
   * driver a day. Idempotent per message id; a failed row is retried by
   * sendFleetMessage on a later call.
   *
   * @param {string} businessId The business.
   * @param {object} business Its record.
   * @param {string} todayKey Today (New York).
   * @return {Promise<object>} {tried, failed}: messages sent or tried, and
   *   how many of them failed or threw (the day is not done while > 0).
   */
  async function remindBusiness(businessId, business, todayKey) {
    if (!zelleHandle(business)) return {tried: 0, failed: 0};
    const [drivers, open] = await Promise.all([
      activeDrivers(businessId),
      db().collection("fleetBills").where("businessId", "==", businessId)
          .where("status", "==", "open").get(),
    ]);
    const billsByDriver = new Map();
    for (const d of open.docs) {
      const bill = {id: d.id, ...d.data()};
      const list = billsByDriver.get(bill.driverId) || [];
      list.push(bill);
      billsByDriver.set(bill.driverId, list);
    }
    // While a driver's report is open, their "late" reminder is paused.
    const reports = await db().collection("fleetClaims")
        .where("businessId", "==", businessId)
        .where("open", "==", true).get();
    const paused = new Set(reports.docs.filter((d) =>
      fleetClaims.PAUSES_LATE_REMINDER_STATES.includes(d.get("state")))
        .map((d) => d.get("driverId")));
    let tried = 0;
    let failed = 0;
    const send = async (message, driverId) => {
      tried += 1;
      const status = await deps.sendFleetMessage(message)
          .catch((error) => {
            deps.logger.warn("Fleet reminder not sent",
                {businessId, driverId, error: String(error?.message || error)});
            return "failed";
          });
      if (status === "failed") failed += 1;
    };
    const reminded = new Set();
    for (const driver of drivers) {
      if (!whatsappAllows(business, driver.id)) continue;
      const bills = billsByDriver.get(driver.id) || [];
      const oldest = fleetWhatsApp.oldestOpenRentBill(bills);
      if (!oldest) continue;
      const kind = fleetWhatsApp.reminderKind(oldest.dueDayKey, todayKey);
      if (!kind) continue;
      if (kind === "late" && paused.has(driver.id)) continue;
      const message = reminderMessage({businessId, business, driver, bills,
        oldest, kind, todayKey});
      if (!message) continue;
      reminded.add(driver.id);
      await send(message, driver.id);
    }
    // Looking ahead: a month's bill is only made on its first day, so the
    // "2 days before" reminder for a coming period comes from the
    // assignment, not from a bill.
    const assignments = await db().collection("fleetAssignments")
        .where("businessId", "==", businessId).get();
    const byId = new Map(drivers.map((d) => [d.id, d]));
    const settings = business.fleet?.settings || {};
    for (const doc of assignments.docs) {
      const a = {id: doc.id, ...doc.data()};
      const driver = byId.get(a.driverId);
      if (!driver || a.endDayKey || reminded.has(driver.id)) continue;
      if (!whatsappAllows(business, driver.id)) continue;
      if (!fleetWhatsApp.comingBill(a, [], todayKey, settings)) continue;
      const existing = await db().collection("fleetBills")
          .where("assignmentId", "==", a.id).get();
      const coming = fleetWhatsApp.comingBill(a,
          existing.docs.map((d) => ({id: d.id, ...d.data()})), todayKey,
          settings);
      if (!coming) continue;
      const message = comingReminderMessage({businessId, business, driver,
        bills: billsByDriver.get(driver.id) || [], assignment: a, coming,
        todayKey});
      if (!message) continue;
      reminded.add(driver.id);
      await send(message, driver.id);
    }
    return {tried, failed};
  }

  /**
   * The "2 days before" reminder for a period that has no bill yet. It
   * states what the driver will owe on the due day: the coming fee plus
   * anything already owed, minus credit; null when that is nothing.
   *
   * @param {object} p {businessId, business, driver, bills (open), assignment,
   *   coming (the bill it will get), todayKey}.
   * @return {object|null} The sendFleetMessage args.
   */
  function comingReminderMessage(p) {
    const {businessId, business, driver, coming} = p;
    if (driver.status === "left") return null;
    const balance = fleetBilling.driverBalance(p.bills,
        Number(driver.creditCents) || 0, p.todayKey);
    const owed = fleetWhatsApp.amountToState(balance.owedCents,
        driver.creditCents, coming.amountCents);
    if (!(owed > 0)) return null;
    const values = fleetWhatsApp.reminderValues({
      driverName: driver.name, businessName: business.name,
      businessPhone: business.phone, settings: business.fleet?.settings,
      kind: "soon", dueDayKey: coming.dueDayKey, owedCents: owed});
    return {
      id: fleetWhatsApp.messageId("lookahead", {driverId: driver.id,
        assignmentId: p.assignment.id, periodFrom: coming.periodFrom}),
      row: {businessId, driverId: driver.id, kind: "reminder",
        reminder: "soon", lookAhead: true, assignmentId: p.assignment.id,
        periodFrom: coming.periodFrom, label: coming.label,
        template: fleetWhatsApp.REMINDER_TEMPLATE,
        phone: String(driver.phone || ""), name: String(driver.name || "")},
      body: fleetWhatsApp.templateBody(fleetWhatsApp.REMINDER_TEMPLATE,
          driver.phone, values),
      reachable: fleetWhatsApp.reachable(driver.phone),
    };
  }

  /**
   * One driver's rent reminder, ready for sendFleetMessage; null when the
   * driver owes nothing.
   *
   * @param {object} p {businessId, business, driver, bills, oldest, kind,
   *   todayKey, manual, byUid}.
   * @return {object|null} The sendFleetMessage args.
   */
  function reminderMessage(p) {
    const {businessId, business, driver, bills, oldest, kind, todayKey} = p;
    if (driver.status === "left") return null;
    const balance = fleetBilling.driverBalance(bills,
        Number(driver.creditCents) || 0, todayKey);
    // What the driver owes after the credit they hold (late fees and
    // charges add to it; the reminder is still about the rent bill).
    const owed = fleetWhatsApp.amountToState(balance.owedCents,
        driver.creditCents);
    if (!(owed > 0)) return null;
    const values = fleetWhatsApp.reminderValues({
      driverName: driver.name, businessName: business.name,
      businessPhone: business.phone, settings: business.fleet?.settings,
      kind, dueDayKey: oldest.dueDayKey, owedCents: owed});
    const base = fleetWhatsApp.messageId("reminder",
        {driverId: driver.id, billId: oldest.id, todayKey});
    return {
      // A reminder sent from the driver's page is its own message (once a
      // day per bill), apart from the daily one.
      id: p.manual ? base.replace(/^reminder_/, "reminder_manual_") : base,
      row: {businessId, driverId: driver.id, kind: "reminder",
        reminder: kind, billId: oldest.id,
        template: fleetWhatsApp.REMINDER_TEMPLATE,
        phone: String(driver.phone || ""), name: String(driver.name || ""),
        ...(p.manual ? {manual: true, byUid: p.byUid} : {})},
      body: fleetWhatsApp.templateBody(fleetWhatsApp.REMINDER_TEMPLATE,
          driver.phone, values),
      reachable: fleetWhatsApp.reachable(driver.phone),
    };
  }

  /**
   * "Send a WhatsApp reminder" on a driver's page: the reminder for the
   * driver's oldest open bill, now. Once a day per bill; only when the
   * business has WhatsApp on for this driver.
   *
   * @param {string} uid The caller (Fleet staff).
   * @param {string} businessId The business.
   * @param {object} data {driverId}.
   * @return {Promise<object>} {status}: sent, failed, skipped, or "" when
   *   one was already sent today.
   */
  async function whatsappRemindDriver(uid, businessId, data) {
    await requireStaff(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const driverId = text(data.driverId, 180);
    if (!whatsappOn(business) || !whatsappAllows(business, driverId)) {
      throw refuse("fleet_whatsapp_off");
    }
    const doc = await db().collection("fleetDrivers").doc(driverId).get();
    if (!doc.exists || doc.get("businessId") !== businessId) {
      throw refuse("fleet_not_found", "not-found");
    }
    const driver = {id: doc.id, ...doc.data()};
    if (driver.status !== "active") throw refuse("fleet_driver_left");
    if (!fleetWhatsApp.reachable(driver.phone)) throw refuse("fleet_no_phone");
    const todayKey = deps.dayKeyNow();
    const {bills} = await driverMoney(driverId, driver);
    if (!zelleHandle(business)) throw refuse("fleet_zelle_missing");
    const oldest = fleetWhatsApp.oldestOpenRentBill(bills);
    const kind = !oldest ? null : oldest.dueDayKey > todayKey ? "soon" :
      oldest.dueDayKey === todayKey ? "today" : "late";
    const message = oldest && reminderMessage({businessId, business, driver,
      bills, oldest, kind, todayKey, manual: true, byUid: uid});
    if (!message) throw refuse("fleet_nothing_owed");
    const status = await deps.sendFleetMessage(message);
    if (status) {
      await audit(businessId, uid, "fleet_driver", driverId,
          "fleet_whatsapp_reminder", `WhatsApp reminder sent (${status})`);
    }
    return {success: true, status};
  }

  async function whatsappSave(uid, businessId, data) {
    await requireAdmin(uid, businessId);
    const {ref, data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    if (typeof data.enabled !== "boolean") {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    if (data.enabled && !zelleHandle(business)) {
      throw refuse("fleet_zelle_missing");
    }
    const update = {"fleet.settings.whatsapp.enabled": data.enabled,
      "fleet.settings.whatsapp.updatedAtMs": Date.now(),
      "fleet.settings.whatsapp.updatedBy": uid,
      updatedAt: FieldValue.serverTimestamp()};
    // Optional "only these drivers" (a test or a pilot). Absent: unchanged;
    // empty: every active driver.
    let only = null;
    if (data.onlyDriverIds !== undefined) {
      if (!Array.isArray(data.onlyDriverIds) ||
          data.onlyDriverIds.length > 50) {
        throw refuse("fleet_bad_input", "invalid-argument");
      }
      only = [...new Set(data.onlyDriverIds.map((id) => text(id, 180))
          .filter(Boolean))];
      const docs = await Promise.all(only.map((id) =>
        db().collection("fleetDrivers").doc(id).get()));
      if (docs.some((d) => !d.exists || d.get("businessId") !== businessId)) {
        throw refuse("fleet_not_found", "not-found");
      }
      update["fleet.settings.whatsapp.onlyDriverIds"] = only;
    }
    await ref.update(update);
    const who = only && only.length ?
      ` (only ${only.length} chosen driver${only.length === 1 ? "" : "s"})` :
      "";
    await audit(businessId, uid, "fleet_settings", businessId,
        "fleet_whatsapp", data.enabled ?
          `WhatsApp to drivers switched on${who}` :
          `WhatsApp to drivers switched off${who}`);
    const saved = business.fleet?.settings?.whatsapp?.onlyDriverIds;
    return {success: true, enabled: data.enabled,
      onlyDriverIds: only ?? (Array.isArray(saved) ? saved : [])};
  }

  /**
   * A sample receipt and a sample reminder to one phone, so the office sees
   * what drivers get before switching it on. Names no driver.
   *
   * @param {string} uid The caller (Fleet admin).
   * @param {string} businessId The business.
   * @param {object} data {phone}.
   * @return {Promise<object>} {receipt, reminder} statuses.
   */
  async function whatsappTest(uid, businessId, data) {
    await requireAdmin(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const phone = text(data.phone, 40);
    if (!fleetWhatsApp.reachable(phone)) {
      throw refuse("fleet_bad_phone", "invalid-argument");
    }
    const today = deps.dayKeyNow();
    const sample = {driverName: "Test", businessName: business.name,
      businessPhone: business.phone};
    const send = (kind, template, values) => deps.sendFleetMessage({
      id: fleetWhatsApp.messageId("test", {businessId}) + `_${kind}`,
      row: {businessId, driverId: "", kind: "test", test: kind, template,
        phone, name: "Test", byUid: uid},
      body: fleetWhatsApp.templateBody(template, phone, values),
      reachable: true,
    });
    const receipt = await send("receipt", fleetWhatsApp.RECEIPT_TEMPLATE,
        fleetWhatsApp.receiptValues({...sample, amountCents: 35017,
          paidDayKey: today, owedCents: 0, creditCents: 17}));
    const reminder = await send("reminder", fleetWhatsApp.REMINDER_TEMPLATE,
        fleetWhatsApp.reminderValues({...sample,
          settings: business.fleet?.settings, kind: "soon",
          dueDayKey: today, owedCents: 35000}));
    await audit(businessId, uid, "fleet_settings", businessId,
        "fleet_whatsapp_test", `Test WhatsApp sent to ${phone}`);
    return {success: true, receipt, reminder};
  }

  // ---- drivers' payment reports (docs/FLEET_PAYMENT_PROOF.md) -----------
  //
  // A driver's screenshot is only a claim; the bank deposit is the proof.
  // The pure decisions are in fleet_claims.js; this is the Firestore and
  // WhatsApp side. Everything that talks to the network is injected
  // (deps.readPicture, deps.sendFleetText, deps.fleetScheduledRefresh).

  const claimsCol = () => db().collection("fleetClaims");

  async function claimIn(businessId, claimId) {
    const doc = await claimsCol().doc(claimId || "-").get();
    if (!doc.exists || doc.get("businessId") !== businessId) {
      throw refuse("fleet_not_found", "not-found");
    }
    return doc;
  }

  /**
   * "This deposit is theirs": the office gives a waiting deposit to the
   * driver a report names. The bank's amount is what is recorded.
   *
   * @param {string} uid The caller (Fleet staff).
   * @param {string} businessId The business.
   * @param {object} data {claimId, creditId}.
   * @return {Promise<object>} {success, claimId, paymentId, amountCents}.
   */
  async function claimAssign(uid, businessId, data) {
    await requireStaff(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const claimId = text(data.claimId, 180);
    const creditId = text(data.creditId, 300);
    if (!claimId || !creditId) {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    const claim = await claimIn(businessId, claimId);
    if (!fleetClaims.OPEN_STATES.includes(claim.get("state"))) {
      throw refuse("fleet_claim_closed");
    }
    const driverId = String(claim.get("driverId") || "");
    if (!driverId) throw refuse("fleet_claim_no_driver");
    const result = await payFromDeposit({businessId, creditId, driverId,
      how: "office", byUid: uid, claimId, requireWaiting: true,
      requireActive: true});
    return {success: true, claimId, ...result};
  }

  /**
   * The office closes a report (nothing will be paid from it).
   *
   * @param {string} uid The caller (Fleet staff).
   * @param {string} businessId The business.
   * @param {object} data {claimId}.
   * @return {Promise<object>} {success}.
   */
  async function claimClose(uid, businessId, data) {
    await requireStaff(uid, businessId);
    const claim = await claimIn(businessId, text(data.claimId, 180));
    if (!fleetClaims.OPEN_STATES.includes(claim.get("state"))) {
      throw refuse("fleet_claim_closed");
    }
    await claim.ref.update({state: fleetClaims.STATE.CLOSED, open: false,
      closedByUid: uid, closedAtMs: nowMs(),
      updatedAt: FieldValue.serverTimestamp()});
    await audit(businessId, uid, "fleet_claim", claim.id,
        "fleet_claim_closed", "Driver's payment report closed by the office");
    return {success: true};
  }

  /**
   * A report's screenshot, for Fleet staff: the file of the message in the
   * business's support thread (the same stored file and download link every
   * WhatsApp picture in Support has; deleted after 12 months).
   *
   * @param {string} uid The caller (Fleet staff).
   * @param {string} businessId The business.
   * @param {object} data {claimId}.
   * @return {Promise<object>} {success, url: string|null, deleted}.
   */
  async function claimPhoto(uid, businessId, data) {
    await requireStaff(uid, businessId);
    const claim = await claimIn(businessId, text(data.claimId, 180));
    const caseId = String(claim.get("caseId") || "");
    const wamid = String(claim.get("messageId") || "");
    if (!caseId || !wamid) return {success: true, url: null, deleted: false};
    const message = await db().collection("supportCases").doc(caseId)
        .collection("messages").doc(messageDocId("in", wamid)).get();
    const meta = message.exists ? message.get("metadata") || {} : {};
    return {success: true, url: String(meta.fileUrl || "") || null,
      deleted: meta.mediaDeleted === true};
  }

  /**
   * "Names this driver pays from": replaces the driver's remembered sender
   * names (at most 10). Account-like and app names, one-word names and
   * stop-listed words are refused; a name already remembered may stay.
   *
   * @param {string} uid The caller (Fleet staff).
   * @param {string} businessId The business.
   * @param {object} data {driverId, names: string[]}.
   * @return {Promise<object>} {success, names} (the stored keys).
   */
  async function payerNamesSave(uid, businessId, data) {
    await requireStaff(uid, businessId);
    const driverId = text(data.driverId, 180);
    if (!driverId || !Array.isArray(data.names) || data.names.length > 10) {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    const doc = await db().collection("fleetDrivers").doc(driverId).get();
    if (!doc.exists || doc.get("businessId") !== businessId) {
      throw refuse("fleet_not_found", "not-found");
    }
    const had = new Set((doc.get("rememberedSenders") || [])
        .map((n) => fleetBank.matchKey(n)));
    const keys = [];
    for (const raw of data.names) {
      const name = text(raw, 80);
      if (!name) continue;
      const key = fleetBank.matchKey(name);
      if (!key) {
        throw new HttpsError("invalid-argument", FLEET_REFUSALS.fleet_bad_name,
            {reason: "fleet_bad_name", name});
      }
      const kept = had.has(key) && !fleetBank.senderIsAccount(name) &&
        !/^(?:ZELLE|VENMO|CASH ?APP|PAYPAL|APPLE CASH)$/.test(key);
      if (!kept && !fleetBank.nameRememberable(name)) {
        throw new HttpsError("invalid-argument", FLEET_REFUSALS.fleet_bad_name,
            {reason: "fleet_bad_name", name});
      }
      if (!keys.includes(key)) keys.push(key);
    }
    await doc.ref.update({rememberedSenders: keys,
      updatedAt: FieldValue.serverTimestamp()});
    await audit(businessId, uid, "fleet_driver", driverId,
        "fleet_payer_names_saved", `Names ${doc.get("name") || "driver"} ` +
        `pays from: ${keys.length}`);
    return {success: true, names: keys};
  }

  // ---- a driver's message -------------------------------------------------

  const pictureTypeOf = (event) => String(event?.media?.mimeType || "")
      .split(";")[0].trim().toLowerCase();
  const isPicture = (event) => Boolean(event?.media) &&
    event.type !== "sticker" &&
    fleetClaims.IMAGE_TYPES.includes(pictureTypeOf(event));

  const businessNames = (business) => [business?.fleet?.settings?.zelle?.name,
    business?.name, business?.fleet?.settings?.zelle?.handle].filter(Boolean);

  /**
   * Whether Fleet takes this driver's WhatsApp messages: Fleet and its
   * WhatsApp switch are on for the business, the driver is on the "only
   * these drivers" list when there is one, and the driver is active.
   *
   * @param {object} business The business record.
   * @param {object} driver {id, status}.
   * @return {boolean} True when the driver takes part.
   */
  function takesPart(business, driver) {
    return fleetOn(business) && whatsappOn(business) &&
      whatsappAllows(business, driver.id) && driver.status === "active";
  }

  /**
   * The picture, read. A failure of any kind is "could not read" (null).
   *
   * @param {object} ctx The inbound context (fetchImage).
   * @return {Promise<?object>} The validated reading, or null.
   */
  async function readPicture(ctx) {
    try {
      if (typeof deps.readPicture !== "function") return null;
      const image = await ctx.fetchImage();
      if (!image) return null;
      const parsed = fleetClaims.parseReading(await deps.readPicture(image));
      return parsed.ok ? parsed.reading : null;
    } catch (error) {
      deps.logger.warn("Fleet picture not read",
          {error: String(error?.message || error).slice(0, 200)});
      return null;
    }
  }

  async function sendClaimText(businessId, phone, text) {
    try {
      const result = await deps.sendFleetText({businessId, phone, text});
      return result?.ok === true;
    } catch (error) {
      return false;
    }
  }

  async function createClaim(f) {
    const ref = claimsCol().doc();
    const t = nowMs();
    const waiting = f.state === fleetClaims.STATE.WAITING_BANK;
    const claim = {
      businessId: f.businessId, driverId: f.driverId || null,
      fromPhone: f.fromPhone, state: f.state,
      amountCents: f.amountCents > 0 ? f.amountCents : null,
      read: f.reading ? {...f.reading} : null, payerName: null,
      mediaPath: f.mediaPath || null, caseId: f.caseId || null,
      messageId: f.messageId || null, creditId: null, paymentId: null,
      reason: f.reason || null, createdAtMs: t,
      bankCheckDueAtMs: waiting ? t + fleetClaims.BANK_CHECK_DELAY_MS : null,
      bankCheckedAtMs: null, toldLateAtMs: null,
      closeAtMs: t + fleetClaims.CLOSE_MS, lang: f.lang === "fr" ? "fr" : "en",
      attempts: 0, open: fleetClaims.OPEN_STATES.includes(f.state),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await ref.set(claim);
    return {id: ref.id, ...claim};
  }

  async function activeClaimsOf(driverId) {
    const snap = await claimsCol().where("driverId", "==", driverId).get();
    return snap.docs.map((d) => ({id: d.id, ...d.data()}));
  }

  /**
   * A picture from a driver who takes part: a claim.
   *
   * @param {object} ctx The inbound context.
   * @param {object} driver {id, ...}.
   * @param {object} business {id, ...data}.
   * @return {Promise<object>} {handled, outcome, notify}.
   */
  async function pictureFromDriver(ctx, driver, business) {
    const reading = await readPicture(ctx);
    if (reading && reading.isPayment === false) return {handled: false};
    const names = businessNames(business.data);
    const plan = fleetClaims.planNewClaim({reading,
      recipientOk: reading ? fleetClaims.recipientMatches(reading.recipient,
          names) : null,
      todayKey: deps.dayKeyNow()});
    if (plan.ignore) return {handled: false};
    const lang = ctx.lang;
    const vars = {amountCents: plan.amountCents, business: business.data.name,
      recipient: reading?.recipient};
    let say = plan.say;
    let state = plan.state;
    let reason = plan.reason;
    let paymentId = null;
    if (plan.state === fleetClaims.STATE.WAITING_BANK) {
      // The same payment reported twice, or already recorded (a remembered
      // name paid it before the picture came): nothing new to wait for.
      const mine = await activeClaimsOf(driver.id);
      const probe = {driverId: driver.id, amountCents: plan.amountCents,
        read: reading};
      const open = mine.find((c) => fleetClaims.takesDeposit(c) &&
        Number(c.amountCents) === plan.amountCents &&
        (!c.read?.dayKey || !reading.dayKey ||
          c.read.dayKey === reading.dayKey));
      const payments = await db().collection("fleetPayments")
          .where("driverId", "==", driver.id).get();
      const recorded = payments.docs.find((d) =>
        fleetClaims.isAlreadyRecorded(probe, d.data()));
      if (open) {
        const kept = await ctx.keep(business.id, {needsReply: false});
        await ctx.say(fleetClaims.replyText("already_waiting", lang, vars));
        return {handled: true, outcome: "claim_duplicate", notify: false,
          caseId: kept.caseId};
      }
      if (recorded) {
        state = fleetClaims.STATE.PAID;
        reason = fleetClaims.REASON.ALREADY_RECORDED;
        paymentId = recorded.id;
        say = "already_recorded";
      }
    }
    const kept = await ctx.keep(business.id,
        {needsReply: state === fleetClaims.STATE.OFFICE});
    const claim = await createClaim({businessId: business.id,
      driverId: driver.id, fromPhone: ctx.event.from, state,
      amountCents: plan.amountCents, reading, reason,
      mediaPath: kept.mediaPath, caseId: kept.caseId,
      messageId: ctx.event.wamid, lang});
    if (paymentId) {
      await claimsCol().doc(claim.id).update({paymentId, open: false,
        paidAtMs: nowMs()});
      await db().collection("fleetPayments").doc(paymentId)
          .update({claimId: claim.id}).catch(() => undefined);
    }
    await ctx.say(fleetClaims.replyText(say, lang, vars));
    if (state === fleetClaims.STATE.WAITING_BANK) {
      await rematchWaiting(business.id);
    }
    return {handled: true, outcome: `claim_${state}`,
      notify: state === fleetClaims.STATE.OFFICE, claimId: claim.id};
  }

  /**
   * The Fleet businesses whose WhatsApp-to-drivers switch is on. No picture
   * is read when there are none.
   *
   * @return {Promise<Array<object>>} [{id, data}].
   */
  async function fleetsOnWhatsApp() {
    const snap = await db().collection("businesses")
        .where("fleet.enabled", "==", true).get();
    return snap.docs.map((d) => ({id: d.id, data: d.data() || {}}))
        .filter((b) => whatsappOn(b.data));
  }

  /**
   * A picture from a phone the whole platform does not know (no business
   * has it on a record, no conversation exists), that reads as a payment
   * to one Fleet business's Zelle name: which driver is it for?
   *
   * @param {object} ctx The inbound context.
   * @param {Array<object>} fleets The Fleet businesses with WhatsApp on.
   * @return {Promise<object>} {handled, outcome, notify}.
   */
  async function pictureFromStranger(ctx, fleets) {
    const reading = await readPicture(ctx);
    if (!reading || reading.isPayment !== true) return {handled: false};
    const owners = fleets.filter((b) => fleetClaims.recipientMatches(
        reading.recipient, businessNames(b.data)) === true);
    if (owners.length !== 1) return {handled: false};
    const business = owners[0];
    const lang = ctx.lang;
    const plan = fleetClaims.planNewClaim({reading, recipientOk: true,
      todayKey: deps.dayKeyNow()});
    const tooOld = plan.state === fleetClaims.STATE.OFFICE;
    const kept = await ctx.keep(business.id, {needsReply: tooOld});
    await createClaim({businessId: business.id, driverId: null,
      fromPhone: ctx.event.from,
      state: tooOld ? fleetClaims.STATE.OFFICE :
        fleetClaims.STATE.ASKING_DRIVER,
      amountCents: plan.state === fleetClaims.STATE.WAITING_BANK ?
        plan.amountCents : null,
      reading, reason: tooOld ? plan.reason : null,
      mediaPath: kept.mediaPath, caseId: kept.caseId,
      messageId: ctx.event.wamid, lang});
    await ctx.say(fleetClaims.replyText(tooOld ? "too_old" : "ask_driver",
        lang, {business: business.data.name}));
    return {handled: true,
      outcome: tooOld ? "claim_office" : "claim_asking_driver",
      notify: tooOld};
  }

  /**
   * The newest report from this phone that is waiting for an answer.
   *
   * @param {string} phone The sender.
   * @return {Promise<?object>} The claim, or null.
   */
  async function askingClaimOf(phone) {
    const snap = await claimsCol().where("fromPhone", "==", phone)
        .limit(20).get();
    const list = snap.docs.map((d) => ({id: d.id, ...d.data()}))
        .filter((c) => c.open === true &&
          fleetClaims.ASKING_STATES.includes(c.state) &&
          nowMs() < (Number(c.closeAtMs) || 0))
        .sort((a, b) => (Number(b.createdAtMs) || 0) -
          (Number(a.createdAtMs) || 0));
    return list[0] || null;
  }

  /**
   * A message that answers the question a report is asking: an amount, a
   * name, or the phone number of the driver the payment is for.
   *
   * @param {object} ctx The inbound context.
   * @param {object} claim The asking report.
   * @return {Promise<object>} {handled, outcome, notify}.
   */
  async function answerClaim(ctx, claim) {
    const businessDoc = await businessOf(claim.businessId);
    if (!fleetOn(businessDoc.data)) return {handled: false};
    if (claim.driverId) {
      const d = await db().collection("fleetDrivers").doc(claim.driverId)
          .get();
      if (!d.exists || !takesPart(businessDoc.data, {id: d.id, ...d.data()})) {
        return {handled: false};
      }
    }
    const lang = ctx.lang;
    const event = ctx.event;
    const reading = claim.state === fleetClaims.STATE.ASKING_AMOUNT &&
      isPicture(event) ? await readPicture(ctx) : null;
    const decision = fleetClaims.interpretAnswer(claim,
        {text: event.text || "", reading});
    const ref = claimsCol().doc(claim.id);
    const stamp = {updatedAt: FieldValue.serverTimestamp()};
    const t = nowMs();
    const vars = {business: businessDoc.data.name};
    const say = async (kind, extra = {}) => ctx.say(
        fleetClaims.replyText(kind, lang, {...vars, ...extra}));
    const kept = (needsReply) => ctx.keep(claim.businessId, {needsReply});
    if (decision.type === "again") {
      await kept(false);
      await ref.update({attempts: FieldValue.increment(1), lang, ...stamp});
      await say(decision.say);
      return {handled: true, outcome: "claim_asked_again", notify: false};
    }
    if (decision.type === "give_up") {
      await kept(true);
      if (claim.state === fleetClaims.STATE.ASKING_NAME) {
        // The name is asked once: the report keeps waiting for the bank.
        await ref.update({state: fleetClaims.STATE.WAITING_BANK,
          nameAskedAtMs: t, attempts: 0, ...stamp});
        await say("name_thanks");
        return {handled: true, outcome: "claim_name_skipped", notify: false};
      }
      const reason = claim.state === fleetClaims.STATE.ASKING_DRIVER ?
        fleetClaims.REASON.NOT_A_DRIVER : fleetClaims.REASON.NO_AMOUNT;
      await ref.update({state: fleetClaims.STATE.OFFICE, reason,
        attempts: 0, ...stamp});
      await say("to_office");
      return {handled: true, outcome: "claim_office", notify: true};
    }
    await kept(false);
    if (decision.type === "name") {
      await ref.update({payerName: decision.payerName,
        state: fleetClaims.STATE.WAITING_BANK, nameAskedAtMs: t, attempts: 0,
        ...stamp});
      await say("name_thanks");
      await rematchWaiting(claim.businessId);
      return {handled: true, outcome: "claim_named", notify: false};
    }
    if (decision.type === "amount") {
      await ref.update({amountCents: decision.amountCents,
        state: fleetClaims.STATE.WAITING_BANK, attempts: 0,
        bankCheckDueAtMs: claim.bankCheckedAtMs ? null :
          t + fleetClaims.BANK_CHECK_DELAY_MS, ...stamp});
      await say("ack");
      await rematchWaiting(claim.businessId);
      return {handled: true, outcome: "claim_amount", notify: false};
    }
    // The phone number of the driver the payment is for (Q7).
    const found = await db().collection("fleetDrivers")
        .where("businessId", "==", claim.businessId)
        .where("phone", "==", decision.phone).get();
    const drivers = found.docs.map((d) => ({id: d.id, ...d.data()}))
        .filter((d) => takesPart(businessDoc.data, d));
    if (drivers.length !== 1) {
      await ref.update({state: fleetClaims.STATE.OFFICE,
        reason: fleetClaims.REASON.NOT_A_DRIVER, attempts: 0, ...stamp});
      await say("to_office");
      return {handled: true, outcome: "claim_office", notify: true};
    }
    const hasAmount = Number(claim.amountCents) > 0;
    await ref.update({driverId: drivers[0].id,
      state: hasAmount ? fleetClaims.STATE.WAITING_BANK :
        fleetClaims.STATE.ASKING_AMOUNT,
      bankCheckDueAtMs: hasAmount ? t + fleetClaims.BANK_CHECK_DELAY_MS :
        null, attempts: 0, ...stamp});
    await say(hasAmount ? "ack" : "ask_amount");
    if (hasAmount) await rematchWaiting(claim.businessId);
    return {handled: true, outcome: "claim_driver_found", notify: false};
  }

  /**
   * A received WhatsApp message, before ordinary support handling. Returns
   * {handled: false} for everything that is not a Fleet claim (the message
   * then goes on exactly as before), and never throws.
   *
   * @param {object} ctx {event, lang, fetchImage(), keep(businessId,
   *   {needsReply}), say(text)} from whatsapp_conversations.handleInbound.
   * @return {Promise<object>} {handled, outcome, notify}.
   */
  async function handleClaimInbound(ctx) {
    try {
      const event = ctx.event;
      const phone = event.from;
      const asking = await askingClaimOf(phone);
      if (asking) {
        const done = await answerClaim(ctx, asking);
        if (done.handled) return done;
      }
      // An ordinary text costs the one query above. A picture is read only
      // when some business has Fleet WhatsApp on.
      if (!isPicture(event)) return {handled: false};
      const fleets = await fleetsOnWhatsApp();
      if (fleets.length === 0) return {handled: false};
      const drivers = await db().collection("fleetDrivers")
          .where("phone", "==", phone).limit(10).get();
      if (drivers.size === 0) {
        // Privacy: only a phone nobody on the platform knows is read. A
        // customer any business already knows goes to ordinary support,
        // unread.
        if (typeof ctx.phoneIsKnown !== "function" ||
            await ctx.phoneIsKnown()) {
          return {handled: false};
        }
        return await pictureFromStranger(ctx, fleets);
      }
      if (drivers.size !== 1) return {handled: false};
      const driver = {id: drivers.docs[0].id, ...drivers.docs[0].data()};
      const business = await db().collection("businesses")
          .doc(String(driver.businessId || "-")).get();
      if (!business.exists ||
          !takesPart(business.data() || {}, driver)) {
        return {handled: false};
      }
      return await pictureFromDriver(ctx, driver,
          {id: business.id, data: business.data() || {}});
    } catch (error) {
      deps.logger.error("Fleet claim step failed", {
        error: String(error?.message || error).slice(0, 300)});
      return {handled: ctx.kept ? ctx.kept() : false, outcome: "claim_error",
        notify: false};
    }
  }

  /**
   * One business's reports against the clock (docs/FLEET_PAYMENT_PROOF.md,
   * Timers): one forced bank check for the reports that are due, the
   * driver's name asked once, the 2-day notice, and closing after 7 days.
   *
   * @param {string} businessId The business.
   * @param {object} business Its record.
   * @param {number} now Now.
   * @return {Promise<object>} Counts {closed, checked, asked, told}.
   */
  async function runClaimTimers(businessId, business, now) {
    const out = {closed: 0, checked: 0, asked: 0, told: 0};
    const snap = await claimsCol().where("businessId", "==", businessId)
        .where("open", "==", true).get();
    const due = snap.docs.map((d) => ({ref: d.ref, claim: {id: d.id,
      ...d.data()}})).map((x) => ({...x,
      actions: fleetClaims.dueActions(x.claim, now)}));
    for (const x of due.filter((y) => y.actions.includes("close"))) {
      await x.ref.update({state: fleetClaims.STATE.CLOSED, open: false,
        closedAtMs: now, updatedAt: FieldValue.serverTimestamp()});
      out.closed += 1;
    }
    const checks = due.filter((y) => y.actions.includes("bank_check"));
    if (checks.length > 0) {
      // One paid refresh and sync for the business, however many reports
      // are due (counted like a scheduled refresh).
      try {
        if (typeof deps.fleetScheduledRefresh === "function") {
          await deps.fleetScheduledRefresh(businessId);
        }
      } catch (error) {
        deps.logger.warn("Fleet report bank check failed", {businessId,
          error: String(error?.message || error)});
      }
      for (const x of checks) {
        await x.ref.update({bankCheckedAtMs: now,
          updatedAt: FieldValue.serverTimestamp()});
        out.checked += 1;
      }
    }
    if (!whatsappOn(business)) return out;
    const fresh = async (x) => {
      const again = await x.ref.get();
      return again.exists ? {id: again.id, ...again.data()} : null;
    };
    for (const x of due.filter((y) => y.actions.includes("ask_name"))) {
      const claim = await fresh(x);
      if (!claim || claim.state !== fleetClaims.STATE.WAITING_BANK ||
          claim.payerName) continue;
      await x.ref.update({state: fleetClaims.STATE.ASKING_NAME,
        nameAskedAtMs: now, attempts: 0,
        updatedAt: FieldValue.serverTimestamp()});
      await sendClaimText(businessId, claim.fromPhone,
          fleetClaims.replyText("ask_name", claim.lang, {}));
      out.asked += 1;
    }
    for (const x of due.filter((y) => y.actions.includes("late_notice"))) {
      const claim = await fresh(x);
      if (!claim || !fleetClaims.takesDeposit(claim) ||
          claim.toldLateAtMs) continue;
      // Outside WhatsApp's 24-hour window a free-form message may not go
      // through: the report is flagged for the office either way.
      const ok = await sendClaimText(businessId, claim.fromPhone,
          fleetClaims.replyText("late", claim.lang,
              {amountCents: claim.amountCents}));
      await x.ref.update({toldLateAtMs: now, toldLateSent: ok,
        reason: claim.reason || fleetClaims.REASON.NO_DEPOSIT,
        updatedAt: FieldValue.serverTimestamp()});
      out.told += 1;
    }
    return out;
  }

  // ---- import ----------------------------------------------------------

  /**
   * A Firestore id from an import key (stable, so a second import of the
   * same sheet overwrites instead of doubling).
   *
   * @param {string} businessId The business.
   * @param {string} key The parser's importKey.
   * @return {string} The id.
   */
  function importId(businessId, key) {
    return `${businessId}_${key}`.replace(/[^A-Za-z0-9_-]/g, "_")
        .slice(0, 300);
  }

  async function importSheet(uid, businessId, data) {
    await requireAdmin(uid, businessId);
    const {ref: businessRef, data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const rows = Array.isArray(data.rows) ? data.rows : null;
    if (!rows || rows.length < 2 || rows.length > MAX_IMPORT_ROWS ||
        !rows.every(Array.isArray)) {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    // The months whose unpaid cells become owed bills: the month of the
    // first import and the one before (owner, 2026-11-11), kept on the
    // business so importing the sheet again later bills the same months.
    const months = (list) => Array.isArray(list) ?
      list.filter((m) => MONTH.test(m)) : [];
    const asked = months(data.goLiveMonths);
    const kept = months(business.fleet?.goLiveMonths);
    const thisMonth = deps.dayKeyNow().slice(0, 7);
    const goLiveMonths = asked.length ? asked : kept.length ? kept :
      [previousMonth(thisMonth), thisMonth];
    const parsed = parseFleetSheet(rows.map((r) => r.map((c) => text(c, 500))),
        {goLiveMonths});
    if (data.dryRun === true) {
      return {success: true, dryRun: true, totals: parsed.totals,
        warnings: parsed.warnings.slice(0, 200),
        counts: {drivers: parsed.drivers.length, cars: parsed.cars.length,
          assignments: parsed.assignments.length,
          payments: parsed.payments.length, bills: parsed.bills.length}};
    }
    const id = (key) => importId(businessId, key);
    const writes = [];
    const stamp = FieldValue.serverTimestamp();
    for (const d of parsed.drivers) {
      writes.push(["fleetDrivers", id(d.importKey), {...d, businessId,
        creditCents: 0, rememberedSenders: [],
        importedAt: stamp, updatedAt: stamp}]);
    }
    for (const c of parsed.cars) {
      writes.push(["fleetCars", id(c.importKey), {...c, businessId,
        importedAt: stamp, updatedAt: stamp}]);
    }
    for (const a of parsed.assignments) {
      const {driverKey, carKey, ...rest} = a;
      writes.push(["fleetAssignments", id(a.importKey), {...rest, businessId,
        driverId: id(driverKey), carId: id(carKey), importedAt: stamp}]);
    }
    for (const b of parsed.bills) {
      const {driverKey, carKey, assignmentKey, ...rest} = b;
      writes.push(["fleetBills", id(b.importKey), {...rest, businessId,
        driverId: id(driverKey), carId: carKey ? id(carKey) : "",
        assignmentId: assignmentKey ? id(assignmentKey) : "",
        importedAt: stamp}]);
    }
    for (const p of parsed.payments) {
      const {driverKey, carKey, assignmentKey, ...rest} = p;
      writes.push(["fleetPayments", id(p.importKey), {...rest, businessId,
        driverId: id(driverKey), carId: carKey ? id(carKey) : "",
        assignmentId: assignmentKey ? id(assignmentKey) : "",
        status: "recorded", allocations: [], creditAddedCents: 0,
        receivedByUid: uid, importedAt: stamp}]);
    }
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db().batch();
      for (const [col, docId, value] of writes.slice(i, i + 400)) {
        batch.set(db().collection(col).doc(docId), value, {merge: true});
      }
      await batch.commit();
    }
    if (!kept.length) {
      await businessRef.set({fleet: {goLiveMonths}}, {merge: true});
    }
    await audit(businessId, uid, "fleet_settings", businessId,
        "fleet_imported", `Spreadsheet imported: ${parsed.drivers.length} ` +
        `drivers, ${parsed.cars.length} cars, ${parsed.payments.length} ` +
        "payments");
    // `centsChanged` stays in the answer for old callers: the personal cents
    // are gone (docs/FLEET_PAYMENT_PROOF.md Q6), so it is always 0.
    return {success: true, totals: parsed.totals,
      warnings: parsed.warnings.slice(0, 200), written: writes.length,
      centsChanged: 0};
  }

  // ---- the callable ----------------------------------------------------

  const ACTIONS = {
    settings_save: settingsSave,
    driver_save: driverSave,
    car_save: carSave,
    assignment_start: assignmentStart,
    assignment_end: assignmentEnd,
    assignment_update: assignmentUpdate,
    driver_leave: driverLeave,
    charge_add: chargeAdd,
    bill_waive: billWaive,
    payment_record: paymentRecord,
    payment_undo: paymentUndo,
    import_sheet: importSheet,
    note_add: noteAdd,
    note_void: noteVoid,
    substitute_save: substituteSave,
    substitute_void: substituteVoid,
    bank_status: bankStatus,
    bank_schedule_save: bankScheduleSave,
    bank_assign: bankAssign,
    bank_removed_keep: bankRemovedKeep,
    bank_check_now: bankCheckNow,
    whatsapp_save: whatsappSave,
    whatsapp_test: whatsappTest,
    whatsapp_remind_driver: whatsappRemindDriver,
    claim_assign: claimAssign,
    claim_close: claimClose,
    claim_photo: claimPhoto,
    payer_names_save: payerNamesSave,
  };

  // ---- the driver's own view (docs/FLEET.md section 11) -----------------

  /**
   * `driver_home`: what the caller owes and holds, in every fleet business
   * that has their verified phone on a driver. No business id is asked: the
   * phone decides, so a driver can never ask for someone else's records. An
   * account with no verified phone, or a phone on no driver, gets an empty
   * list (a regular customer), never a refusal.
   *
   * @param {object} request The callable request.
   * @return {Promise<object>} {success, todayKey, proofWhatsApp, onlyFleet,
   *   fleets}.
   */
  async function driverHome(request) {
    const todayKey = deps.dayKeyNow();
    const answer = (fleets) => ({success: true, todayKey,
      proofWhatsApp: fleetDriverView.proofWhatsApp(process.env),
      onlyFleet: fleets.some((f) => f.onlyFleet), fleets});
    const phone = await deps.callerPhone(request);
    if (!phone) return answer([]);
    const found = await db().collection("fleetDrivers")
        .where("phone", "==", phone).limit(10).get();
    const fleets = [];
    for (const doc of found.docs) {
      const driver = doc.data() || {};
      const businessId = text(driver.businessId, 180);
      if (!businessId) continue;
      const bizDoc = await db().collection("businesses").doc(businessId)
          .get();
      const business = bizDoc.data() || {};
      if (!bizDoc.exists || !fleetOn(business)) continue;
      const rows = (snap) => snap.docs.map((d) => ({id: d.id, ...d.data()}));
      const own = (col) => db().collection(col)
          .where("driverId", "==", doc.id).get().then(rows);
      const [bills, payments, assignments, claims] = await Promise.all([
        own("fleetBills"), own("fleetPayments"), own("fleetAssignments"),
        own("fleetClaims")]);
      // A driver id is unique, but the records must also be this business's.
      const mine = (list) => list.filter((r) => r.businessId === businessId);
      const open = mine(assignments).filter((a) => !a.endDayKey);
      const carIds = [...new Set(open.map((a) => a.carId).filter(Boolean))];
      const carsById = new Map();
      if (carIds.length) {
        const cars = await db().getAll(...carIds.map((id) =>
          db().collection("fleetCars").doc(id)));
        for (const c of cars) {
          if (c.exists && c.get("businessId") === businessId) {
            carsById.set(c.id, c.data());
          }
        }
      }
      const view = fleetDriverView.driverFleetView({businessId, business,
        driverId: doc.id, driver, bills: mine(bills),
        payments: mine(payments), assignments: open, carsById,
        claims: mine(claims), todayKey});
      if (view) fleets.push(view);
    }
    fleets.sort((a, b) => a.businessName.localeCompare(b.businessName));
    return answer(fleets);
  }

  async function fleetAction(request) {
    const uid = deps.requireAuth(request);
    const data = request.data || {};
    const action = text(data.action, 40);
    if (action === "fleet_enable") return setEnabled(uid, data);
    // A driver's own account: the caller's phone decides, not a business id.
    if (action === "driver_home") return driverHome(request);
    const handler = ACTIONS[action];
    if (!handler) throw refuse("fleet_bad_input", "invalid-argument");
    const businessId = text(data.businessId, 180);
    if (!businessId) throw refuse("fleet_bad_input", "invalid-argument");
    return handler(uid, businessId, data);
  }

  // ---- the daily job ---------------------------------------------------

  /**
   * One business's day: the period bills now due, late fees, credit spent.
   *
   * @param {string} businessId The business.
   * @param {object} settings Its fleet settings.
   * @param {string} today Day key.
   * @return {Promise<object>} Counts.
   */
  async function runFleetDay(businessId, settings, today) {
    const assignments = await db().collection("fleetAssignments")
        .where("businessId", "==", businessId).get();
    let created = 0;
    let fees = 0;
    for (const doc of assignments.docs) {
      const a = {id: doc.id, ...doc.data()};
      if (!a.startDayKey || !(Number(a.rentCents) > 0)) continue;
      if (a.endDayKey && a.endDayKey < today.slice(0, 8) + "01") continue;
      // One failing assignment must not stop the others (or the late fees).
      try {
        created += await db().runTransaction(async (tx) => {
          const {fresh} = await billAssignment(tx, a, settings, today);
          if (fresh.length === 0) return 0;
          const ctx = await creditContext(tx, a.driverId);
          if (ctx.driver && ctx.driver.get("status") === "left") {
            deps.logger.warn("Fleet: a driver who left still has an open " +
              "assignment, nothing billed", {businessId,
              assignmentId: a.id, driverId: a.driverId});
            return 0;
          }
          const left = writeBillsSpendingCredit(tx, ctx, fresh,
              {businessId, driverId: a.driverId, carId: a.carId});
          if (left !== ctx.credit) {
            tx.update(ctx.driver.ref, {creditCents: left,
              updatedAt: FieldValue.serverTimestamp()});
          }
          return fresh.length;
        });
      } catch (error) {
        deps.logger.warn("Fleet day: an assignment could not be billed", {
          businessId, assignmentId: a.id,
          error: String(error?.message || error)});
      }
    }
    try {
      fees = await lateFeeStep(businessId, settings, today);
    } catch (error) {
      deps.logger.warn("Fleet day: late fees failed", {businessId,
        error: String(error?.message || error)});
    }
    return {created, fees};
  }

  // Late fees: create the ones now due (the driver's credit pays them), and
  // void the open fee of a rent bill that is void or waived.
  async function lateFeeStep(businessId, settings, today) {
    let fees = 0;
    const billsCol = db().collection("fleetBills");
    const bills = await billsCol.where("businessId", "==", businessId).get();
    const all = bills.docs.map((d) => ({id: d.id, ...d.data()}));
    const byId = new Map(all.map((b) => [b.id, b]));
    for (const fee of all) {
      if (fee.kind !== "late_fee" || fee.status !== "open") continue;
      const rent = byId.get(fee.lateFeeForBillId);
      if (!rent || (rent.status !== "void" && rent.status !== "waived")) {
        continue;
      }
      try {
        await db().runTransaction(async (tx) => {
          const feeDoc = await tx.get(billsCol.doc(fee.id));
          const credit = voidLateFee(tx, feeDoc);
          if (credit > 0 && fee.driverId) {
            tx.update(db().collection("fleetDrivers").doc(fee.driverId),
                {creditCents: FieldValue.increment(credit),
                  updatedAt: FieldValue.serverTimestamp()});
          }
        });
      } catch (error) {
        deps.logger.warn("Fleet day: a late fee could not be voided",
            {businessId, billId: fee.id,
              error: String(error?.message || error)});
      }
    }
    if (!(Number(settings?.lateFee?.cents) > 0)) return fees;
    const due = fleetBilling.lateFeesToCreate(all, settings, today);
    for (const fee of due) {
      try {
        const made = await db().runTransaction(async (tx) => {
          const [feeDoc, rentDoc] = await Promise.all([
            tx.get(billsCol.doc(fee.id)),
            tx.get(billsCol.doc(fee.lateFeeForBillId)),
          ]);
          if (feeDoc.exists || !rentDoc.exists ||
              rentDoc.get("status") !== "open" ||
              (Number(rentDoc.get("amountCents")) || 0) -
              (Number(rentDoc.get("paidCents")) || 0) <= 0) {
            return 0;
          }
          const driverId = rentDoc.get("driverId") || "";
          const ctx = await creditContext(tx, driverId);
          const left = writeBillsSpendingCredit(tx, ctx, [fee], {businessId,
            driverId, carId: rentDoc.get("carId") || "",
            assignmentId: rentDoc.get("assignmentId") || ""});
          if (ctx.driver && ctx.driver.exists && left !== ctx.credit) {
            tx.update(ctx.driver.ref, {creditCents: left,
              updatedAt: FieldValue.serverTimestamp()});
          }
          return 1;
        });
        fees += made;
      } catch (error) {
        deps.logger.warn("Fleet day: a late fee could not be created",
            {businessId, billId: fee.id,
              error: String(error?.message || error)});
      }
    }
    return fees;
  }

  async function fleetDaily() {
    const today = deps.dayKeyNow();
    const businesses = await db().collection("businesses")
        .where("fleet.enabled", "==", true).get();
    for (const b of businesses.docs) {
      try {
        const counts = await runFleetDay(b.id, b.get("fleet")?.settings || {},
            today);
        deps.logger.info("Fleet day", {businessId: b.id, ...counts});
      } catch (error) {
        deps.logger.error("Fleet day failed", {businessId: b.id,
          error: String(error?.message || error)});
      }
    }
  }

  return {fleetAction, fleetDaily, runFleetDay, matchBankDeposits,
    handleClaimInbound, runClaimTimers, rematchWaiting, sweepDeposits,
    noteRemovedDeposits,
    fleetBankTick, sendReceipt, remindBusiness};
}

module.exports = {FLEET_REFUSALS, createFleetHandlers};
