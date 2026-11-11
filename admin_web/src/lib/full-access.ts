// "Full access" staff (docs/STAFF_FULL_ACCESS.md): a staff member the
// business owner, or a Laawol super admin, trusted with everything the owner
// can do in that one business. The server decides
// (my_flutter_app/functions/staff_full_access.js); the console mirrors it so
// the screens the owner sees open for them too.

type Row = Record<string, unknown>;

/**
 * The signed-in profile as the screens should see it: a full-access staff
 * member of a business is that business's owner, with `storedRole: "staff"`
 * kept. Anyone else is unchanged.
 */
export function effectiveProfile<T extends Row>(profile: T): T {
  if (!profile || profile.role !== "staff" || profile.fullAccess !== true ||
      !String(profile.businessId ?? "").trim()) {
    return profile;
  }
  return { ...profile, role: "businessOwner", storedRole: "staff" };
}

/** Whether this profile is the business's real owner (not a full-access staff member acting as one). */
export function isRealOwner(profile: Row | null | undefined, businessId: string): boolean {
  return Boolean(profile) && profile?.role === "businessOwner" && profile?.storedRole !== "staff" &&
    profile?.fullAccess !== true && String(profile?.businessId ?? "") === businessId;
}

/** Whether a staff row has full access. */
export function hasFullAccess(row: Row | null | undefined): boolean {
  return row?.role === "staff" && row?.fullAccess === true;
}

/** `updateBusinessStaffPermissions` with the full-access switch; the permissions go along unchanged. */
export function fullAccessRequest(businessId: string, staffUid: string, businessPermissions: readonly string[], fullAccess: boolean) {
  return { businessId, staffUid, businessPermissions: [...businessPermissions], fullAccess };
}

export const FULL_ACCESS_EXPLAINED =
  "Full access: everything the owner can do here, including settings, prices and staff. Transferring the business and its Stripe and bank stay the owner's.";
