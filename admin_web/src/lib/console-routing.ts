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
  if (kind === null || kind === "customer") return true;
  return service === "tracking" && (kind === "business" || kind === "admin");
}
