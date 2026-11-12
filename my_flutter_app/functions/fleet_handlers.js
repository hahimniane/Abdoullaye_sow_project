"use strict";

// Fleet (TLC plate leasing) server actions and the daily job
// (docs/FLEET.md). The arithmetic lives in fleet_billing.js and the
// spreadsheet reading in fleet_import.js; this file reads and writes
// Firestore. Wired in index.js as `fleetAction` (one callable, every action)
// and `fleetDaily` (scheduled), like console_totals.js.

const fleetBilling = require("./fleet_billing");
const {parseFleetSheet} = require("./fleet_import");

const STAFF = "fleet";
const ADMIN = "fleet_admin";
const MAX_IMPORT_ROWS = 2000;
const MAX_NOTE_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const FLEET_REFUSALS = Object.freeze({
  fleet_off: "Fleet is not switched on for this business.",
  fleet_admin_only: "Only a Fleet admin can do this.",
  fleet_not_found: "That record was not found.",
  fleet_car_taken: "This car already has a driver. Return it first.",
  fleet_bad_input: "Some details are missing or not valid.",
  fleet_no_amount: "Enter an amount.",
  fleet_already_undone: "That payment was already undone.",
  fleet_not_open: "Only an open bill can be waived.",
  fleet_reason_required: "Say why.",
  fleet_friend_overlap: "Another friend already has this car on those days.",
  fleet_note_empty: "Write a note or attach a file.",
  fleet_note_voided: "That note was already removed.",
  fleet_bad_file: "A file is not allowed (images or PDF, up to 10 MB).",
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
    await db().runTransaction(async (tx) => {
      const active = await tx.get(col.where("businessId", "==", businessId)
          .where("status", "==", "active"));
      const drivers = active.docs.map((x) => ({id: x.id, ...x.data()}));
      drivers.push({id: ref.id, createdAt: Date.now()});
      const cents = fleetBilling.assignPersonalCents(drivers);
      tx.set(ref, {...fields, status: "active", creditCents: 0,
        licenseHistory: [],
        tlcLicenseSince: fields.tlcLicense ? deps.dayKeyNow() : null,
        personalCents: cents[ref.id] ?? null, rememberedSenders: [],
        createdAt: FieldValue.serverTimestamp()});
    });
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
      await doc.ref.set(fields, {merge: true});
      await audit(businessId, uid, "fleet_car", carId, "fleet_car_saved",
          `Car ${plate} edited`);
      return {success: true, carId};
    }
    const ref = col.doc();
    await ref.set({...fields, status: "inactive",
      createdAt: FieldValue.serverTimestamp()});
    await audit(businessId, uid, "fleet_car", ref.id, "fleet_car_added",
        `Car ${plate} added`);
    return {success: true, carId: ref.id};
  }

  // The rent bills an assignment owes through a day that do not exist yet
  // (read inside the caller's transaction; the caller writes them).
  async function billAssignment(tx, assignment, settings, throughDayKey) {
    const billsCol = db().collection("fleetBills");
    const existing = await tx.get(billsCol
        .where("assignmentId", "==", assignment.id));
    const ids = new Set(existing.docs.map((d) => d.id));
    const fresh = fleetBilling.rentBillsToCreate(assignment, ids,
        throughDayKey, settings);
    return {fresh, billsCol};
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
      const [driver, car, taken] = await Promise.all([
        tx.get(db().collection("fleetDrivers").doc(driverId)),
        tx.get(db().collection("fleetCars").doc(carId)),
        tx.get(db().collection("fleetAssignments")
            .where("carId", "==", carId).where("endDayKey", "==", null)),
      ]);
      if (!driver.exists || driver.get("businessId") !== businessId ||
          !car.exists || car.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      if (!taken.empty) throw refuse("fleet_car_taken");
      const assignment = {id: ref.id, businessId, carId, driverId,
        startDayKey, endDayKey: null, rentCents, period, dueDay};
      const {fresh, billsCol} = await billAssignment(tx, assignment,
          settings, today);
      tx.set(ref, {...assignment, createdBy: uid,
        createdAt: FieldValue.serverTimestamp()});
      for (const bill of fresh) {
        tx.set(billsCol.doc(bill.id), {...bill, businessId, driverId,
          carId, createdAt: FieldValue.serverTimestamp()});
      }
      tx.update(car.ref, {status: "active",
        updatedAt: FieldValue.serverTimestamp()});
      tx.update(driver.ref, {status: "active",
        updatedAt: FieldValue.serverTimestamp()});
    });
    await audit(businessId, uid, "fleet_assignment", ref.id,
        "fleet_assignment_started",
        `Car given to driver from ${startDayKey}, ` +
        `$${(rentCents / 100).toFixed(2)} ${period}`);
    return {success: true, assignmentId: ref.id};
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
    const settings = business.fleet?.settings || {};
    let creditBack = 0;
    await db().runTransaction(async (tx) => {
      const ref = db().collection("fleetAssignments").doc(assignmentId);
      const doc = await tx.get(ref);
      if (!doc.exists || doc.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      const a = {id: doc.id, ...doc.data()};
      if (endDayKey < a.startDayKey) {
        throw refuse("fleet_bad_input", "invalid-argument");
      }
      const bills = await tx.get(db().collection("fleetBills")
          .where("assignmentId", "==", assignmentId));
      // What each rent bill should be once the car is back.
      const ended = {...a, endDayKey};
      const keep = new Map(fleetBilling.rentBillsToCreate(ended, new Set(),
          endDayKey, settings).map((b) => [b.id, b.amountCents]));
      const driverRef = db().collection("fleetDrivers").doc(a.driverId);
      for (const b of bills.docs) {
        const bill = b.data();
        if (bill.kind !== "rent" || bill.status === "void" ||
            bill.status === "waived") continue;
        const paid = Math.max(0, Number(bill.paidCents) || 0);
        const target = keep.has(b.id) ? keep.get(b.id) : 0;
        if (target === Number(bill.amountCents)) continue;
        const over = Math.max(0, paid - target);
        creditBack += over;
        tx.update(b.ref, {
          amountCents: target,
          paidCents: paid - over,
          status: target === 0 ? "void" :
            (paid - over >= target ? "paid" : "open"),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      tx.update(ref, {endDayKey, endedBy: uid,
        updatedAt: FieldValue.serverTimestamp()});
      tx.update(db().collection("fleetCars").doc(a.carId),
          {status: "inactive", updatedAt: FieldValue.serverTimestamp()});
      if (creditBack > 0) {
        tx.update(driverRef, {creditCents: FieldValue.increment(creditBack),
          updatedAt: FieldValue.serverTimestamp()});
      }
    });
    await audit(businessId, uid, "fleet_assignment", assignmentId,
        "fleet_assignment_ended", `Car returned on ${endDayKey}` +
        (creditBack > 0 ? `, $${(creditBack / 100).toFixed(2)} to credit` :
          ""));
    return {success: true, creditBackCents: creditBack};
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
    const driver = await db().collection("fleetDrivers").doc(driverId).get();
    if (!driver.exists || driver.get("businessId") !== businessId) {
      throw refuse("fleet_not_found", "not-found");
    }
    const ref = db().collection("fleetBills").doc();
    await ref.set({businessId, driverId, carId: text(data.carId, 180),
      assignmentId: "", kind: "charge", label, periodFrom: dueDayKey,
      periodTo: dueDayKey, dueDayKey, amountCents: amount, paidCents: 0,
      status: "open", createdBy: uid, createdAt: FieldValue.serverTimestamp()});
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
      tx.update(ref, {status: "waived",
        waived: {byUid: uid, atMs: Date.now(), reason},
        updatedAt: FieldValue.serverTimestamp()});
    });
    await audit(businessId, uid, "fleet_bill", billId, "fleet_bill_waived",
        `Waived (${reason})`);
    return {success: true};
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
      const driverRef = db().collection("fleetDrivers").doc(driverId);
      const [driver, open] = await Promise.all([
        tx.get(driverRef),
        tx.get(db().collection("fleetBills")
            .where("driverId", "==", driverId).where("status", "==", "open")),
      ]);
      if (!driver.exists || driver.get("businessId") !== businessId) {
        throw refuse("fleet_not_found", "not-found");
      }
      const bills = open.docs.map((d) => ({id: d.id, ...d.data()}));
      const plan = fleetBilling.allocatePayment(bills, amount);
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
      if (plan.creditAddedCents > 0) {
        tx.update(driverRef, {
          creditCents: FieldValue.increment(plan.creditAddedCents),
          updatedAt: FieldValue.serverTimestamp()});
      }
      tx.set(ref, {businessId, driverId, amountCents: amount, method,
        paidDayKey, receivedAtMs: Date.now(), receivedByUid: uid,
        allocations: plan.allocations,
        creditAddedCents: plan.creditAddedCents, creditUsedCents: 0,
        status: "recorded", imported: false, note: text(data.note, 300),
        createdAt: FieldValue.serverTimestamp()});
      result = plan;
    });
    await audit(businessId, uid, "fleet_payment", ref.id,
        "fleet_payment_recorded",
        `Payment $${(amount / 100).toFixed(2)} (${method})`);
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
      const billDocs = await Promise.all((p.allocations || []).map((a) =>
        tx.get(db().collection("fleetBills").doc(a.billId))));
      for (const [i, a] of (p.allocations || []).entries()) {
        const b = billDocs[i];
        if (!b.exists) continue;
        const paid = Math.max(0, (Number(b.get("paidCents")) || 0) - a.cents);
        const status = b.get("status") === "paid" ? "open" : b.get("status");
        tx.update(b.ref, {paidCents: paid, status,
          updatedAt: FieldValue.serverTimestamp()});
      }
      if (Number(p.creditAddedCents) > 0) {
        tx.update(db().collection("fleetDrivers").doc(p.driverId), {
          creditCents: FieldValue.increment(-Number(p.creditAddedCents)),
          updatedAt: FieldValue.serverTimestamp()});
      }
      tx.update(ref, {status: "undone", undoneByUid: uid,
        undoneAtMs: Date.now()});
      amount = Number(p.amountCents) || 0;
    });
    await audit(businessId, uid, "fleet_payment", paymentId,
        "fleet_payment_undone", `Payment $${(amount / 100).toFixed(2)} undone`);
    return {success: true};
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
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const rows = Array.isArray(data.rows) ? data.rows : null;
    if (!rows || rows.length < 2 || rows.length > MAX_IMPORT_ROWS ||
        !rows.every(Array.isArray)) {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    const parsed = parseFleetSheet(rows.map((r) => r.map((c) => text(c, 500))),
        {goLiveMonths: Array.isArray(data.goLiveMonths) ?
          data.goLiveMonths.filter((m) => MONTH.test(m)) :
          undefined});
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
    const personal = fleetBilling.assignPersonalCents(parsed.drivers
        .filter((d) => d.status === "active")
        .map((d, i) => ({id: id(d.importKey), createdAt: i})));
    for (const d of parsed.drivers) {
      writes.push(["fleetDrivers", id(d.importKey), {...d, businessId,
        creditCents: 0, rememberedSenders: [],
        personalCents: personal[id(d.importKey)] ?? null,
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
    await audit(businessId, uid, "fleet_settings", businessId,
        "fleet_imported", `Spreadsheet imported: ${parsed.drivers.length} ` +
        `drivers, ${parsed.cars.length} cars, ${parsed.payments.length} ` +
        "payments");
    return {success: true, totals: parsed.totals,
      warnings: parsed.warnings.slice(0, 200), written: writes.length};
  }

  // ---- the callable ----------------------------------------------------

  const ACTIONS = {
    settings_save: settingsSave,
    driver_save: driverSave,
    car_save: carSave,
    assignment_start: assignmentStart,
    assignment_end: assignmentEnd,
    charge_add: chargeAdd,
    bill_waive: billWaive,
    payment_record: paymentRecord,
    payment_undo: paymentUndo,
    import_sheet: importSheet,
    note_add: noteAdd,
    note_void: noteVoid,
    substitute_save: substituteSave,
    substitute_void: substituteVoid,
  };

  async function fleetAction(request) {
    const uid = deps.requireAuth(request);
    const data = request.data || {};
    const action = text(data.action, 40);
    if (action === "fleet_enable") return setEnabled(uid, data);
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
      await db().runTransaction(async (tx) => {
        const {fresh, billsCol} = await billAssignment(tx, a, settings, today);
        if (fresh.length === 0) return;
        const driverRef = db().collection("fleetDrivers").doc(a.driverId);
        const driver = await tx.get(driverRef);
        let credit = Math.max(0, Number(driver.get("creditCents")) || 0);
        const used = credit > 0 ?
          fleetBilling.applyCredit(fresh.map((b) => ({...b})), credit) :
          {allocations: [], creditLeftCents: credit};
        for (const bill of fresh) {
          const take = used.allocations.filter((x) => x.billId === bill.id)
              .reduce((s, x) => s + x.cents, 0);
          tx.set(billsCol.doc(bill.id), {...bill, businessId,
            driverId: a.driverId, carId: a.carId, paidCents: take,
            status: take >= bill.amountCents ? "paid" : "open",
            createdAt: FieldValue.serverTimestamp()});
          created += 1;
        }
        if (credit !== used.creditLeftCents) {
          credit = used.creditLeftCents;
          tx.update(driverRef, {creditCents: credit,
            updatedAt: FieldValue.serverTimestamp()});
        }
      });
    }
    if (Number(settings?.lateFee?.cents) > 0) {
      const bills = await db().collection("fleetBills")
          .where("businessId", "==", businessId).get();
      const all = bills.docs.map((d) => ({id: d.id, ...d.data()}));
      const due = fleetBilling.lateFeesToCreate(all, settings, today);
      for (const fee of due) {
        const rent = all.find((b) => b.id === fee.lateFeeForBillId) || {};
        await db().collection("fleetBills").doc(fee.id).create({...fee,
          businessId, driverId: rent.driverId || "", carId: rent.carId || "",
          assignmentId: rent.assignmentId || "", paidCents: 0,
          status: "open", createdAt: FieldValue.serverTimestamp()})
            .then(() => {
              fees += 1;
            }, () => undefined);
      }
    }
    return {created, fees};
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

  return {fleetAction, fleetDaily, runFleetDay};
}

module.exports = {FLEET_REFUSALS, createFleetHandlers};
