/**
 * Which console a hostname serves.
 *
 * One bundle is deployed to three hosts, so anything the hosts must not
 * share - the business console offering customer sign-up was the one that
 * bit - has to be decided from the hostname at runtime, in one place.
 */
export type ConsoleHost = "admin" | "business" | "customer";

export function consoleHostKind(hostname: string): ConsoleHost {
  const host = hostname.trim().toLowerCase();
  if (host === "admin.laawoldigital.com" || host.startsWith("admin.")) {
    return "admin";
  }
  if (
    host === "business.laawoldigital.com" ||
    host.startsWith("business.")
  ) {
    return "business";
  }
  return "customer";
}
