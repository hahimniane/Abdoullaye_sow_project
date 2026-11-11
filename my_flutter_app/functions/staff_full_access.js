"use strict";

// "Full access" staff (docs/STAFF_FULL_ACCESS.md): a staff member the
// business owner, or a Laawol super admin, trusted with everything the
// owner can do in that one business, while the business keeps its owner.
// Pure, so the rules can be unit-tested; index.js applies them.
//
// The server reads every caller through getUserProfile, which hands back a
// full-access staff member as the business's owner (`role:
// "businessOwner"`), so every owner check already in place lets them in.
// What stays the real owner's is checked against `fullAccess` itself:
// connecting the bank (zelle_check.bankRoleOf) and granting full access.
// Transferring ownership and Stripe are super admin / owner flows that
// never read this.

const FULL_ACCESS_MESSAGES = Object.freeze({
  full_access_owner_only:
    "Only the business owner or a Laawol super admin can change full access.",
  full_access_staff_only:
    "Full access is for staff of this business.",
});

/**
 * The user as the server's checks should see it: a full-access staff
 * member of a business is that business's owner for every check; the stored
 * role is kept in `storedRole`. Anyone else is unchanged.
 *
 * @param {object} user A users document (with its id).
 * @return {object} The same object, or a copy acting as the owner.
 */
function effectiveUser(user) {
  if (!user || user.role !== "staff" || user.fullAccess !== true ||
      !String(user.businessId || "").trim()) {
    return user;
  }
  return {...user, role: "businessOwner", storedRole: "staff"};
}

/**
 * Whether this caller may switch full access on or off for one of the
 * business's staff: the real owner of that business (never a full-access
 * staff member acting as one), or a super admin.
 *
 * @param {object} args {caller (the effective user), superAdmin (boolean),
 *   businessId, staff (the target's stored users document)}.
 * @return {string} A FULL_ACCESS_MESSAGES code, or "" to allow.
 */
function fullAccessGrantRefusal({caller, superAdmin, businessId, staff}) {
  const realOwner = caller?.role === "businessOwner" &&
    caller?.fullAccess !== true && caller?.storedRole === undefined &&
    String(caller?.businessId || "") === String(businessId || "");
  if (!superAdmin && !realOwner) return "full_access_owner_only";
  if (!staff || staff.role !== "staff" ||
      String(staff.businessId || "") !== String(businessId || "")) {
    return "full_access_staff_only";
  }
  return "";
}

module.exports = {
  FULL_ACCESS_MESSAGES,
  effectiveUser,
  fullAccessGrantRefusal,
};
