"use strict";

/**
 * A team member's own car on the lot (docs/PARKING_TEAM_CARS.md).
 *
 * The add-car form asks "Whose car?": a team member, or someone else. A team
 * member's car is tied to the person (`forStaffId`), not to a phone number:
 * Month end bills it under them (customer key `staff:{uid}`), their lot
 * expenses net against it, and no customer account or customer WhatsApp is
 * made for it. A car typed with a number the owner linked to a team member
 * (People → parking bill, `staffParkingLinks`) is tied to them too.
 *
 * Pure: no Firestore.
 */

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const last10 = (value) => String(value ?? "").replace(/\D/g, "").slice(-10);

const TEAM_KEY_PREFIX = "staff:";

/**
 * Month end's customer key for a team member.
 *
 * @param {string} staffId The team member's uid.
 * @return {string} "staff:{uid}".
 */
function teamCustomerKey(staffId) {
  return `${TEAM_KEY_PREFIX}${text(staffId, 128)}`;
}

/**
 * The team member a Month end customer key names, or "".
 *
 * @param {string} key A parkingCustomerKey.
 * @return {string} The uid.
 */
function staffIdOfKey(key) {
  const k = text(key, 200);
  return k.startsWith(TEAM_KEY_PREFIX) ? k.slice(TEAM_KEY_PREFIX.length) : "";
}

/**
 * Who may be picked: the business's owner and every staff member, whatever
 * their permissions (a package-only member can still park their own car).
 *
 * @param {object} user A users document.
 * @param {string} uid Its id.
 * @param {string} businessId The lot.
 * @param {object} business The businesses document (its ownerUid).
 * @return {boolean} True for a member of the team.
 */
function isTeamMember(user, uid, businessId, business) {
  if (!businessId || !uid) return false;
  if (text(business?.ownerUid, 128) === uid) return true;
  return Boolean(user) &&
    (user.role === "staff" || user.role === "businessOwner") &&
    user.businessId === businessId;
}

/**
 * The name and number a team member's car carries: the parking customer the
 * owner linked to them, when there is one, else their profile name and no
 * number (a team car needs no number to reach anyone).
 *
 * @param {object} args `{staffId, user, link}`: the users document and their
 *   `staffParkingLinks` entry (or null).
 * @return {{forStaffId: string, forStaffName: string, customerName: string,
 *   customerPhone: string}} The fields to store.
 */
function teamCarFields({staffId, user, link}) {
  const profileName = text(user?.fullName || user?.displayName ||
    user?.name, 120) || text(user?.email, 120);
  const linkName = text(link?.customerName, 120);
  return {
    forStaffId: text(staffId, 128),
    forStaffName: profileName || linkName,
    customerName: linkName || profileName,
    customerPhone: text(link?.customerPhone, 40),
  };
}

/**
 * The team member a typed number belongs to, from the owner's links: the
 * one link whose number has the same last ten digits. Two links on one
 * number tie to nobody (the owner has to say which).
 *
 * @param {string} phone The number typed on the car.
 * @param {object} links `businesses.staffParkingLinks`.
 * @return {string} The uid, or "".
 */
function linkedStaffForPhone(phone, links) {
  const typed = last10(phone);
  if (typed.length < 10) return "";
  const hits = Object.entries(links && typeof links === "object" ? links : {})
      .filter(([, link]) => last10(link?.customerPhone) === typed ||
        text(link?.customerKey, 200) === `phone:${typed}`)
      .map(([id]) => id);
  return hits.length === 1 ? hits[0] : "";
}

module.exports = {
  TEAM_KEY_PREFIX,
  isTeamMember,
  linkedStaffForPhone,
  staffIdOfKey,
  teamCarFields,
  teamCustomerKey,
};
