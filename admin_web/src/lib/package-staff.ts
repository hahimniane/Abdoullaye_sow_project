/**
 * The staff view of one package (a container line) on the tracking page.
 *
 * A package label's QR opens https://customer.laawoldigital.com/t/CL-XXXXXX,
 * which lands on `?service=tracking&code=CL-XXXXXX`. Everyone gets the public
 * tracking result there. Owners and staff of the business that holds the
 * line - and platform admins with operations access - also get what the
 * mobile app's package screen shows (my_flutter_app/lib/screens/
 * package_result_screen.dart): what it is, whose it is and who collects it
 * with a way to call or message them, its container, and whether the
 * WhatsApp updates reached anyone.
 *
 * The rules below mirror the app's `package_codes.dart` and
 * `ContainerLine.fromMap`. Nothing here imports Firebase or React:
 * `package-staff.test.ts` runs it without a browser. The Firestore rules are
 * the authority on who may read a line; `packageStaffScope` only decides
 * whether to ask, so a customer never even sends the query.
 */

import { adminSectionAccess, type AdminPermissionsConfig } from "./admin-access.ts";
import {
  cleanVin,
  containerLineIsStock,
  containerLineTitle,
  containerLineWhatsApp,
  containerLineWhatsAppText,
  containerStatus,
  containerTitle,
  contactPhoneReach,
  type ContainerStatus,
} from "./container-manifest.ts";

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  return value && typeof value === "object" ? (value as Row) : {};
}

function text(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

// ---------------------------------------------------------------------------
// The code.
// ---------------------------------------------------------------------------

/** The tracking-code alphabet: no 0/O, 1/I/L, no vowels (`package_codes.dart`). */
export const PACKAGE_TRACKING_ALPHABET = "23456789BCDFGHJKMNPQRSTVWXYZ";
const PACKAGE_CODE = new RegExp(`^CL([${PACKAGE_TRACKING_ALPHABET}]{6})$`);

/**
 * A typed or linked code as "CL-XXXXXX", or "" when it is not a container
 * line's code ("BS-..." bookings, a zero for an O, anything else). Spaces,
 * dashes and lower case are the typist's and are dropped.
 */
export function packageCodeFrom(raw: unknown): string {
  const compact = text(raw, 60).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = PACKAGE_CODE.exec(compact);
  return match ? `CL-${match[1]}` : "";
}

// ---------------------------------------------------------------------------
// Who may see it.
// ---------------------------------------------------------------------------

export type PackageStaffProfile = {
  role?: unknown;
  businessId?: unknown;
  businessPermissions?: unknown;
  adminRole?: unknown;
  disabled?: unknown;
};

/**
 * Where the signed-in person may look the code up: in their own business's
 * lines, across every business (a platform admin with operations access),
 * or nowhere - the public tracking result alone.
 */
export type PackageStaffScope =
  | { kind: "none" }
  | { kind: "business"; businessId: string }
  | { kind: "admin" };

export function packageStaffScope(input: {
  profile: PackageStaffProfile | null | undefined;
  signedIn: boolean;
  isAnonymous: boolean;
  /** Whether an admin's role reaches Operations; ignored for everyone else. */
  adminOperations: boolean;
}): PackageStaffScope {
  const profile = input.profile;
  if (!profile || !input.signedIn || input.isAnonymous) return { kind: "none" };
  if (profile.disabled === true) return { kind: "none" };
  const role = text(profile.role, 40);
  const businessId = text(profile.businessId, 200);
  if (role === "businessOwner") {
    return businessId ? { kind: "business", businessId } : { kind: "none" };
  }
  if (role === "staff") {
    // Staff need the Containers permission, as the console's tab does. The
    // permission alone is not enough: the business has to be theirs.
    const permissions = Array.isArray(profile.businessPermissions)
      ? profile.businessPermissions.map((item) => text(item, 40))
      : [];
    return businessId && permissions.includes("containers")
      ? { kind: "business", businessId }
      : { kind: "none" };
  }
  if (role === "admin") {
    return input.adminOperations ? { kind: "admin" } : { kind: "none" };
  }
  return { kind: "none" };
}

/**
 * Whether the staff view could apply to this profile at all, before an
 * admin's role has been read. Decides whether the staff code is even loaded:
 * customers and guests never download it.
 */
export function packageStaffCandidate(input: {
  profile: PackageStaffProfile | null | undefined;
  signedIn: boolean;
  isAnonymous: boolean;
}): boolean {
  return packageStaffScope({ ...input, adminOperations: true }).kind !== "none";
}

/** A platform admin reaches packages through the Operations area (view or manage). */
export function adminHasOperationsAccess(
  adminRole: unknown,
  config: AdminPermissionsConfig | null,
): boolean {
  return adminSectionAccess(adminRole, config, "operations") !== "none";
}

// ---------------------------------------------------------------------------
// Calling and messaging the people on a line (`package_codes.dart`).
// ---------------------------------------------------------------------------

/** `tel:` for a phone, keeping a leading "+" and the digits. Null when there is nothing to dial. */
export function packageCallHref(phone: unknown): string | null {
  const trimmed = text(phone, 40);
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 5) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

/**
 * `https://wa.me/<digits>` for a phone. WhatsApp needs the full number with
 * its country code, so a number stored without "+" gets null rather than a
 * chat with a stranger in another country.
 */
export function packageWhatsAppHref(phone: unknown): string | null {
  const compact = text(phone, 40).replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) return null;
  return `https://wa.me/${compact.slice(1)}`;
}

// ---------------------------------------------------------------------------
// The last WhatsApp update (`containerLines/{id}.lastCustomerUpdate`).
// ---------------------------------------------------------------------------

export type PackageUpdateTone = "ok" | "error" | "warn" | "info" | "muted";

/** The moment the line's last update was about, as one whole sentence. */
export const PACKAGE_UPDATE_SENTENCE: Record<string, string> = {
  shipped: "Last update: left port",
  at_port: "Last update: at the destination port",
  arrived: "Last update: arrived",
};

const RESULT_PHRASE: Record<string, string> = {
  sent: "sent",
  failed: "failed to send",
  waiting_for_whatsapp: "waiting for WhatsApp to be connected",
  // The send queue's states: on its way, not a failure.
  queued: "queued to send",
  sending: "sending",
  retrying: "retrying after a failed try",
};

const SKIP_PHRASE: Record<string, string> = {
  no_phone: "not sent, no phone",
  switched_off: "not sent, updates switched off",
  needs_country_code: "not sent, the phone has no country code",
};

const RESULT_TONE: Record<string, PackageUpdateTone> = {
  sent: "ok",
  failed: "error",
  waiting_for_whatsapp: "warn",
  queued: "info",
  sending: "info",
  retrying: "warn",
};

/**
 * One person's outcome as a whole sentence ("Customer: sent"), so each is a
 * single dictionary key for the French translator rather than fragments
 * stitched together.
 */
export function packageUpdateResultText(role: string, status: string, reason = ""): string {
  const who = role === "receiver" ? "Receiver" : "Customer";
  const phrase = RESULT_PHRASE[status] ?? SKIP_PHRASE[reason] ?? "not sent";
  return `${who}: ${phrase}`;
}

export function packageUpdateResultTone(status: string): PackageUpdateTone {
  return RESULT_TONE[status] ?? "muted";
}

export type PackageUpdateResult = { role: string; text: string; tone: PackageUpdateTone };

export type PackageLastUpdate = {
  sentence: string;
  /** When it went out, or null when not recorded. */
  at: Date | null;
  results: PackageUpdateResult[];
};

/**
 * Null for anything that is not a recorded update, so a malformed field reads
 * as "no update yet" rather than breaking the view (`ContainerLineUpdate.fromMap`).
 */
export function packageLastUpdate(value: unknown): PackageLastUpdate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Row;
  const update = text(row.update, 40);
  if (!update) return null;
  const results: PackageUpdateResult[] = [];
  for (const item of Array.isArray(row.results) ? row.results : []) {
    const entry = asRow(item);
    const role = text(entry.role, 20);
    const status = text(entry.status, 40);
    if (!role || !status) continue;
    results.push({
      role,
      text: packageUpdateResultText(role, status, text(entry.reason, 40)),
      tone: packageUpdateResultTone(status),
    });
  }
  const atMs = Number(row.atMs);
  const at = Number.isFinite(atMs) && atMs > 0 ? new Date(Math.round(atMs)) : dateOf(row.at);
  // A moment this build does not know yet still reads as an update.
  return { sentence: PACKAGE_UPDATE_SENTENCE[update] ?? "Latest update", at, results };
}

function dateOf(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const v = value as { toDate?: () => Date; seconds?: number };
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  return null;
}

// ---------------------------------------------------------------------------
// The view, built once from the line and its container.
// ---------------------------------------------------------------------------

export type PackagePerson = {
  name: string;
  phone: string;
  callHref: string | null;
  whatsAppHref: string | null;
  /** A local number: callable, but WhatsApp cannot reach it until it has its country code. */
  needsCountryCode: boolean;
};

export type PackageContainer = {
  id: string;
  /** The container number when known, else the working name. */
  title: string;
  /** The working name under the number, when both exist. */
  subtitle: string;
  status: ContainerStatus;
  destinationId: string;
  destinationName: string;
  sailedAt: Date | null;
  arrivedAt: Date | null;
};

export type PackageKind = "car" | "barrels" | "other";

export type PackageStaffViewModel = {
  lineId: string;
  businessId: string;
  containerId: string;
  code: string;
  /** "2019 Toyota Camry" / "12 barrels" / "3 × tires". */
  title: string;
  kind: PackageKind;
  /** Barrels and other goods; 0 for a car. */
  quantity: number;
  /** Cars only. */
  vin: string;
  description: string;
  /** The business's own stock has no customer. */
  stock: boolean;
  owner: PackagePerson | null;
  /** Null when no receiver was recorded. */
  receiver: PackagePerson | null;
  /** Null while it loads, or when it was deleted. */
  container: PackageContainer | null;
  whatsApp: { summary: string; warnings: string[] };
  lastUpdate: PackageLastUpdate | null;
  /** The business console, opened on this container with this line marked. */
  consoleLink: string;
};

function person(name: unknown, phone: unknown): PackagePerson {
  const stored = text(phone, 40);
  return {
    name: text(name, 120),
    phone: stored,
    callHref: packageCallHref(stored),
    whatsAppHref: packageWhatsAppHref(stored),
    needsCountryCode: contactPhoneReach(stored) === "local",
  };
}

function packageContainer(value: unknown): PackageContainer | null {
  const row = asRow(value);
  const id = text(row.id, 200);
  if (!id) return null;
  const number = text(row.containerNumber, 20);
  const label = text(row.label, 120);
  return {
    id,
    title: containerTitle(row),
    subtitle: number && label ? label : "",
    status: containerStatus(row),
    destinationId: text(row.destinationCountryId, 60),
    destinationName: text(row.destinationCountryName, 120),
    sailedAt: dateOf(row.sailedAt),
    arrivedAt: dateOf(row.arrivedAt),
  };
}

export function packageStaffViewModel(line: unknown, container: unknown): PackageStaffViewModel {
  const row = asRow(line);
  const kindRaw = text(row.kind, 20);
  const kind: PackageKind = kindRaw === "car" || kindRaw === "barrels" ? kindRaw : "other";
  const quantityRaw = Number(row.quantity);
  const quantity = kind === "car" || !Number.isFinite(quantityRaw) || quantityRaw <= 0
    ? 0
    : Math.round(quantityRaw);
  const stock = containerLineIsStock(row);
  const receiverName = text(row.receiverName, 120);
  const receiverPhone = text(row.receiverPhone, 40);
  const lineId = text(row.id, 200);
  const containerId = text(row.containerId, 200);
  const ownContainer = packageContainer(container);
  return {
    lineId,
    businessId: text(row.businessId, 200),
    containerId,
    code: text(row.trackingCode, 40).toUpperCase(),
    title: containerLineTitle(row),
    kind,
    quantity,
    vin: kind === "car" ? cleanVin(row.vinNumber) : "",
    description: text(row.description, 120),
    stock,
    owner: stock ? null : person(row.customerName, row.customerPhone),
    receiver: receiverName || receiverPhone ? person(receiverName, receiverPhone) : null,
    // Only the line's own container: a stale snapshot of another one (the
    // line was just moved) is not shown under it.
    container: ownContainer && ownContainer.id === containerId ? ownContainer : null,
    whatsApp: containerLineWhatsAppText(containerLineWhatsApp(row)),
    lastUpdate: packageLastUpdate(row.lastCustomerUpdate),
    consoleLink: businessConsoleContainerLink(containerId, lineId),
  };
}

// ---------------------------------------------------------------------------
// The business console's deep link to one container and line.
// ---------------------------------------------------------------------------

export const BUSINESS_CONSOLE_ORIGIN = "https://business.laawoldigital.com";

/** `https://business.laawoldigital.com/?container=<id>&line=<lineId>`. */
export function businessConsoleContainerLink(containerId: string, lineId = ""): string {
  const container = text(containerId, 200);
  if (!container) return `${BUSINESS_CONSOLE_ORIGIN}/`;
  const params = new URLSearchParams({ container });
  const line = text(lineId, 200);
  if (line) params.set("line", line);
  return `${BUSINESS_CONSOLE_ORIGIN}/?${params.toString()}`;
}

export type ContainerDeepLink = { containerId: string; lineId: string };

/** What the business console opens on: `?container=<id>&line=<lineId>`, or null. */
export function containerDeepLinkFromSearch(search: string): ContainerDeepLink | null {
  const params = new URLSearchParams(search);
  const containerId = text(params.get("container"), 200);
  // Firestore ids never hold a slash; anything that does is not one of ours.
  if (!containerId || containerId.includes("/")) return null;
  const lineId = text(params.get("line"), 200);
  return { containerId, lineId: lineId.includes("/") ? "" : lineId };
}
