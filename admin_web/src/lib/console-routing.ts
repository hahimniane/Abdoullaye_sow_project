import type { Role } from "@/types/admin";

export type ConsoleKind = "admin" | "business" | "customer" | "unsupported";

export function resolveConsoleKind(role: Role | string | null | undefined): ConsoleKind {
  if (role === "admin") return "admin";
  if (role === "businessOwner" || role === "staff") return "business";
  if (role === "customer") return "customer";
  return "unsupported";
}
