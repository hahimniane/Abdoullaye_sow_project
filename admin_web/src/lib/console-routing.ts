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
 */
export function serviceEntryApplies(
  service: string | null | undefined,
  kind: ConsoleKind | null,
): boolean {
  if (!service) return false;
  if (kind === null || kind === "customer") return true;
  return service === "tracking" && (kind === "business" || kind === "admin");
}
