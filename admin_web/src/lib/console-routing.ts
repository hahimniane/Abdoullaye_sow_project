import type { Role } from "@/types/admin";

export type ConsoleKind = "admin" | "business" | "customer" | "unsupported";

export function resolveConsoleKind(role: Role | string | null | undefined): ConsoleKind {
  if (role === "admin") return "admin";
  if (role === "businessOwner" || role === "staff") return "business";
  if (role === "customer") return "customer";
  return "unsupported";
}

/**
 * Whether a `?service=` link opens the guest service page instead of the
 * signed-in person's own console. Guests and customers always get it.
 * Business and admin accounts get it only for tracking: a package label's QR
 * lands on `?service=tracking&code=CL-...`, and staff scanning one want that
 * package (their staff view sits above the public result there), not their
 * console's home. Every other service link keeps them in their console.
 * An inventory tag's page (`item-tag`) opens for everyone with a console.
 */
export function serviceEntryApplies(
  service: string | null | undefined,
  kind: ConsoleKind | null,
): boolean {
  if (!service) return false;
  // An inventory tag's page says the same to everyone, signed in or not: a
  // staff member's browser must not swap it for their console.
  if (service === "item-tag") return kind !== "unsupported";
  // The estimate page is the customer's (the token is the capability); a
  // staff member opening a customer's link sees the customer's page too.
  if (service === "package-estimate") return kind !== "unsupported";
  // A staff invitation's page (/j/<token>) handles every state itself:
  // signed out, a customer accepting, or someone signed in with another
  // account who must sign out first (docs/STAFF_PHONE_INVITES.md §6).
  if (service === "staff-invite") return kind !== "unsupported";
  if (kind === null || kind === "customer") return true;
  return service === "tracking" && (kind === "business" || kind === "admin");
}

/** The fields of a live profile that decide which console it may open. */
export type ConsoleAccessProfile = {
  role?: unknown;
  businessId?: unknown;
} | null | undefined;

function accessKey(profile: ConsoleAccessProfile) {
  if (!profile) return null;
  const kind = resolveConsoleKind(String(profile.role ?? ""));
  if (kind === "admin") return "admin";
  if (kind === "business") return `business:${String(profile.businessId ?? "").trim()}`;
  return null;
}

/**
 * Whether the live profile just lost the business or platform access the
 * session opened with (docs/STAFF_PHONE_INVITES.md §5): the role became
 * customer (or anything without a console), the business changed, or the
 * document disappeared. The server revokes the refresh tokens at that
 * moment, so the router forces a token refresh and signs out when it fails,
 * instead of leaving the person in the console for up to an hour.
 *
 * Gaining access (a customer accepting an invitation) is not a loss, and
 * neither is an owner becoming staff of the same business.
 */
export function consoleAccessLost(
  previous: ConsoleAccessProfile,
  next: ConsoleAccessProfile,
): boolean {
  const before = accessKey(previous);
  if (!before) return false;
  const after = accessKey(next);
  return after !== before;
}
