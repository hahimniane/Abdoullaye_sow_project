"use strict";

// Fleet (TLC plate leasing) server actions and the daily job
// (docs/FLEET.md). The arithmetic lives in fleet_billing.js and the
// spreadsheet reading in fleet_import.js; this file reads and writes
// Firestore. Wired in index.js as `fleetAction` (one callable, every action)
// and `fleetDaily` (scheduled), like console_totals.js.

const fleetBilling = require("./fleet_billing");
const fleetBank = require("./fleet_bank");
const fleetWhatsApp = require("./fleet_whatsapp");
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
  fleet_no_phone:
      "This driver has no WhatsApp number. Add one in Edit details.",
  fleet_driver_left: "This driver has left.",
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

  /**
   * One payment inside a transaction: the driver's open bills, oldest and
   * late fees first, the rest to credit. Reads before writes.
   *
   * @param {object} tx The transaction.
   * @param {object} ref The new fleetPayments document.
   * @param {object} p {businessId, driverId, amount, method, paidDayKey,
   *   byUid, note, bank?: {creditId, senderName, how}}.
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
    const bills = open.docs.map((d) => ({id: d.id, ...d.data()}));
    const plan = fleetBilling.allocatePayment(bills, p.amount);
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
    const driverPatch = {};
    if (plan.creditAddedCents > 0) {
      driverPatch.creditCents = FieldValue.increment(plan.creditAddedCents);
    }
    // The sender is remembered, so their next deposit pays this driver.
    if (p.bank?.senderName) {
      driverPatch.rememberedSenders =
        FieldValue.arrayUnion(fleetBank.senderKey(p.bank.senderName));
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
      // A bank deposit it used goes back to "waiting" for the right driver.
      if (p.bankTxnId) {
        tx.set(db().collection("businessBankCredits").doc(p.bankTxnId), {
          consumedBy: FieldValue.delete(), consumedAt: FieldValue.delete(),
          consumedByUid: FieldValue.delete(), fleetWaiting: true,
          fleetWaitingReason: "undone"}, {merge: true});
      }
      amount = Number(p.amountCents) || 0;
    });
    await audit(businessId, uid, "fleet_payment", paymentId,
        "fleet_payment_undone", `Payment $${(amount / 100).toFixed(2)} undone`);
    return {success: true};
  }

  // ---- bank deposits (phase 1b, docs/FLEET.md §8) ----------------------

  /**
   * Where matching starts for a business: go-live, or Fleet's own start.
   *
   * @param {object} business The business.
   * @return {number} The earliest deposit time.
   */
  function matchSince(business) {
    return Math.max(fleetBank.BANK_MATCH_START_MS,
        Number(business?.fleet?.enabledAtMs) || 0);
  }

  async function activeDrivers(businessId) {
    const snap = await db().collection("fleetDrivers")
        .where("businessId", "==", businessId)
        .where("status", "==", "active").get();
    return snap.docs.map((d) => ({id: d.id, ...d.data()}));
  }

  /**
   * One deposit paying one driver: claims the deposit (consumedBy) and
   * records the payment in one transaction, so a deposit is never used
   * twice (a shop sale, another driver, a second sync).
   *
   * @param {object} p {businessId, creditId, driverId, how, byUid}.
   * @return {Promise<object>} {paymentId, amountCents}.
   */
  async function payFromDeposit(p) {
    const creditRef = db().collection("businessBankCredits").doc(p.creditId);
    const ref = db().collection("fleetPayments").doc();
    let amount = 0;
    await db().runTransaction(async (tx) => {
      const doc = await tx.get(creditRef);
      const credit = doc.exists ? doc.data() || {} : null;
      if (!credit || credit.businessId !== p.businessId ||
          credit.removed === true) {
        throw refuse("fleet_not_found", "not-found");
      }
      if (credit.consumedBy && credit.consumedBy.kind) {
        throw refuse("fleet_deposit_used");
      }
      amount = Number(credit.amountCents) || 0;
      const day = String(credit.dateKey || "") || deps.dayKeyNow();
      await applyPayment(tx, ref, {businessId: p.businessId,
        driverId: p.driverId, amount, method: "zelle", paidDayKey: day,
        byUid: p.byUid, note: "",
        bank: {creditId: p.creditId, senderName: credit.senderName || "",
          how: p.how}});
      tx.set(creditRef, {consumedBy: {kind: "fleet_payment", id: ref.id},
        consumedAt: FieldValue.serverTimestamp(), consumedByUid: p.byUid,
        fleetWaiting: false, fleetWaitingReason: FieldValue.delete()},
      {merge: true});
    });
    await audit(p.businessId, p.byUid, "fleet_payment", ref.id,
        "fleet_payment_recorded",
        `Zelle $${(amount / 100).toFixed(2)} from the bank ` +
        `(${p.how === "office" ? "picked by the office" : p.how === "sender" ?
          "known sender" : "driver's cents"})`);
    await sendReceipt(p.businessId, ref.id);
    return {paymentId: ref.id, amountCents: amount};
  }

  /**
   * After a bank sync: each new deposit from a person pays its driver, or
   * waits for the office. Never throws (a sync must not fail over Fleet).
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
      const since = matchSince(business);
      const refs = ids.map((id) =>
        db().collection("businessBankCredits").doc(id));
      const docs = [];
      for (let i = 0; i < refs.length; i += 100) {
        docs.push(...await db().getAll(...refs.slice(i, i + 100)));
      }
      const drivers = await activeDrivers(businessId);
      for (const doc of docs) {
        const credit = doc.exists ? doc.data() || {} : null;
        if (!credit || credit.businessId !== businessId) continue;
        if (!fleetBank.depositMatchable(credit, since)) continue;
        const match = fleetBank.matchDeposit(credit, drivers);
        if (match.driverId) {
          try {
            await payFromDeposit({businessId, creditId: doc.id,
              driverId: match.driverId, how: match.how, byUid: "bank"});
            out.paid += 1;
            continue;
          } catch (error) {
            deps.logger.warn("Fleet deposit not applied", {businessId,
              creditId: doc.id, error: String(error?.message || error)});
          }
        }
        if (credit.fleetWaiting !== true) {
          await doc.ref.set({fleetWaiting: true,
            fleetWaitingReason: match.reason || "unknown"}, {merge: true});
        }
        out.waiting += 1;
      }
    } catch (error) {
      deps.logger.error("Fleet deposit matching failed", {businessId,
        error: String(error?.message || error)});
    }
    return out;
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
          reason: String(c.fleetWaitingReason || "unknown")}));
    return {success: true, schedule,
      quote: fleetBank.bankScheduleQuote(schedule, centsEach),
      bank: link, waiting,
      lastScheduledMs: Number(business?.fleet?.bankLastScheduledMs) || 0};
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

  async function bankAssign(uid, businessId, data) {
    await requireStaff(uid, businessId);
    const {data: business} = await businessOf(businessId);
    if (!fleetOn(business)) throw refuse("fleet_off");
    const creditId = text(data.creditId, 300);
    const driverId = text(data.driverId, 180);
    if (!creditId || !driverId) {
      throw refuse("fleet_bad_input", "invalid-argument");
    }
    const result = await payFromDeposit({businessId, creditId, driverId,
      how: "office", byUid: uid});
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
          await b.ref.update({"fleet.remindersSentDayKey": today});
          const tried = await remindBusiness(b.id, business, today);
          deps.logger.info("Fleet reminders", {businessId: b.id, tried});
        } catch (error) {
          deps.logger.warn("Fleet reminders failed", {businessId: b.id,
            error: String(error?.message || error)});
        }
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
   * open bill is due in 2 days, due today, 3 days late or a further week
   * late. Idempotent per driver, bill and day.
   *
   * @param {string} businessId The business.
   * @param {object} business Its record.
   * @param {string} todayKey Today (New York).
   * @return {Promise<number>} Messages sent or tried.
   */
  async function remindBusiness(businessId, business, todayKey) {
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
    let tried = 0;
    for (const driver of drivers) {
      if (!whatsappAllows(business, driver.id)) continue;
      const bills = billsByDriver.get(driver.id) || [];
      const oldest = fleetWhatsApp.oldestOpenBill(bills);
      if (!oldest) continue;
      const kind = fleetWhatsApp.reminderKind(oldest.dueDayKey, todayKey);
      if (!kind) continue;
      const message = reminderMessage({businessId, business, driver, bills,
        oldest, kind, todayKey});
      if (!message) continue;
      await deps.sendFleetMessage(message)
          .catch((error) => deps.logger.warn("Fleet reminder not sent",
              {businessId, driverId: driver.id,
                error: String(error?.message || error)}));
      tried += 1;
    }
    return tried;
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
    const balance = fleetBilling.driverBalance(bills,
        Number(driver.creditCents) || 0, todayKey);
    if (!(balance.owedCents > 0)) return null;
    const values = fleetWhatsApp.reminderValues({
      driverName: driver.name, businessName: business.name,
      businessPhone: business.phone, settings: business.fleet?.settings,
      kind, dueDayKey: oldest.dueDayKey, owedCents: balance.owedCents,
      personalCents: driver.personalCents});
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
    const oldest = fleetWhatsApp.oldestOpenBill(bills);
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
          dueDayKey: today, owedCents: 35000, personalCents: 17}));
    await audit(businessId, uid, "fleet_settings", businessId,
        "fleet_whatsapp_test", `Test WhatsApp sent to ${phone}`);
    return {success: true, receipt, reminder};
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
    bank_status: bankStatus,
    bank_schedule_save: bankScheduleSave,
    bank_assign: bankAssign,
    bank_check_now: bankCheckNow,
    whatsapp_save: whatsappSave,
    whatsapp_test: whatsappTest,
    whatsapp_remind_driver: whatsappRemindDriver,
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

  return {fleetAction, fleetDaily, runFleetDay, matchBankDeposits,
    fleetBankTick, sendReceipt, remindBusiness};
}

module.exports = {FLEET_REFUSALS, createFleetHandlers};
