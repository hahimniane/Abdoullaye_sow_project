/**
 * Staff invited by phone (docs/STAFF_PHONE_INVITES.md): the pure half the
 * console's invite forms, the pending list and the /j/<token> page share.
 *
 * Nothing here touches Firebase: the drafts and the callable payloads, the
 * answers read defensively, the refusals mapped to console copy (never the
 * server's English), and what the invitation page shows for each state.
 * Every English sentence below has its French in french-dom.ts
 * (staff-phone-invite.test.ts checks each one).
 */

import { isValidE164, normalizePhone } from "./phone.ts";

// ---------------------------------------------------------------------------
// The invite form
// ---------------------------------------------------------------------------

export type InviteMethod = "phone" | "email";

/** Phone first: most staff have WhatsApp, fewer read an email inbox. */
export const INVITE_METHODS: readonly InviteMethod[] = ["phone", "email"];

export const INVITE_METHOD_LABELS: Record<InviteMethod, string> = {
  phone: "Phone (WhatsApp)",
  email: "Email",
};

/** The store question's "every store" choice (otherwise a store id). */
export const ALL_STORES = "all";

export type StaffInviteDraft = {
  method: InviteMethod;
  fullName: string;
  /** "+<calling code><number>", from the shared phone field. */
  phone: string;
  email: string;
  businessPermissions: string[];
  /** ALL_STORES or one store's id; read only when the store is asked. */
  storeChoice: string;
};

export function emptyStaffInviteDraft(method: InviteMethod = "phone"): StaffInviteDraft {
  return {
    method,
    fullName: "",
    phone: "",
    email: "",
    businessPermissions: ["profile", "people"],
    storeChoice: ALL_STORES,
  };
}

/**
 * Whether the form asks "Which store?": only for a business with two or more
 * active stores, and only for someone who will work in Inventory (the same
 * rule as the store controls on a staff member's card).
 */
export function asksWhichStore(storeIds: readonly string[], permissions: readonly string[]): boolean {
  return storeIds.length >= 2 && permissions.includes("inventory");
}

export const STAFF_INVITE_PROBLEMS = {
  fullName: "Enter the person's full name.",
  phone: "Enter the person's WhatsApp number with its country code.",
  email: "Enter the person's email address.",
  store: "Choose which store this person works in.",
  business: "Choose a business first.",
} as const;

/** The first thing to fix before sending, or "" when the draft can go. */
export function staffInviteProblem(
  draft: StaffInviteDraft,
  storeIds: readonly string[] = [],
): string {
  if (!draft.fullName.trim()) return STAFF_INVITE_PROBLEMS.fullName;
  if (draft.method === "phone") {
    if (!isValidE164(draft.phone)) return STAFF_INVITE_PROBLEMS.phone;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) {
    return STAFF_INVITE_PROBLEMS.email;
  }
  if (asksWhichStore(storeIds, draft.businessPermissions)) {
    const choice = draft.storeChoice;
    if (choice !== ALL_STORES && !storeIds.includes(choice)) return STAFF_INVITE_PROBLEMS.store;
  }
  return "";
}

/**
 * inviteBusinessMember's data (contract §4). A phone invitation sends the
 * E.164 number and no email; an email one the address and no number. The
 * store access goes only when the form asked for it.
 */
export function staffInvitePayload(
  draft: StaffInviteDraft,
  options: { businessId: string; locale: "en" | "fr"; storeIds?: readonly string[] },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    businessId: options.businessId,
    fullName: draft.fullName.trim(),
    method: draft.method,
    businessPermissions: [...draft.businessPermissions],
    locale: options.locale,
  };
  if (draft.method === "phone") payload.phone = normalizePhone(draft.phone);
  else payload.email = draft.email.trim().toLowerCase();
  const storeIds = options.storeIds ?? [];
  if (asksWhichStore(storeIds, draft.businessPermissions)) {
    payload.inventoryStoreAccess = draft.storeChoice === ALL_STORES || !storeIds.includes(draft.storeChoice)
      ? { allStores: true }
      : { allStores: false, homeStoreId: draft.storeChoice };
  }
  return payload;
}

// ---------------------------------------------------------------------------
// The invite / resend answer
// ---------------------------------------------------------------------------

export type StaffInviteResult = {
  channel: "phone" | "email";
  phoneMasked: string;
  email: string;
  /** https://customer.laawoldigital.com/j/<token> (phone only). */
  inviteLink: string;
  whatsappSent: boolean;
  whatsappStatus: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function clean(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** A staff invitation link: https, and the /j/<43-char token> path. */
const INVITE_LINK = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/j\/[A-Za-z0-9_-]{43}$/;

export function inviteLinkOrEmpty(value: unknown): string {
  const link = clean(value, 300);
  return INVITE_LINK.test(link) ? link : "";
}

/** inviteBusinessMember's / resendAccessInvitation's answer, read defensively. */
export function staffInviteResultFrom(value: unknown): StaffInviteResult {
  const row = record(value);
  const phone = row.channel === "phone";
  return {
    channel: phone ? "phone" : "email",
    phoneMasked: phone ? clean(row.phoneMasked, 40) : "",
    email: phone ? "" : clean(row.email, 320).toLowerCase(),
    inviteLink: phone ? inviteLinkOrEmpty(row.inviteLink) : "",
    whatsappSent: phone && row.whatsappSent === true,
    whatsappStatus: phone ? clean(row.whatsappStatus, 40) : "",
  };
}

/**
 * Whether the owner must share the link themselves: a phone invitation whose
 * WhatsApp message did not go out (template not approved yet, not
 * configured, or Meta refused). Not an error - the invitation is pending.
 */
export function inviteNeedsSharing(result: Pick<StaffInviteResult, "channel" | "whatsappSent" | "inviteLink">): boolean {
  return result.channel === "phone" && !result.whatsappSent && Boolean(result.inviteLink);
}

export const STAFF_INVITE_COPY = {
  sentOnWhatsApp: "Invitation sent on WhatsApp to",
  notSentShareLink: "WhatsApp message not sent yet - share this link",
  shareLinkHint: "Send it to the person yourself. It opens the invitation, and they sign in with a code sent to their number.",
  linkLabel: "Invitation link",
  copyLink: "Copy link",
  copied: "Copied",
  sentByEmail: "Business staff invitation sent",
  resent: "Invitation resent",
} as const;

// ---------------------------------------------------------------------------
// Refusals: details.reason -> console copy
// ---------------------------------------------------------------------------

function reasonOf(error: unknown): string {
  return clean(record(record(error).details).reason, 60);
}

export const STAFF_INVITE_REFUSAL_COPY: Record<string, string> = {
  "full-name-required": STAFF_INVITE_PROBLEMS.fullName,
  "valid-phone-required": "Enter a valid WhatsApp number.",
  "phone-country-code-required": "Add the country code: choose the country, then type the number.",
  "valid-email-required": "Enter a valid email address.",
  "store-access-invalid": STAFF_INVITE_PROBLEMS.store,
  "store-not-found": "That store no longer exists. Refresh and choose another.",
  "existing-authority-conflict":
    "This person already has staff or admin access somewhere in the system. Remove their existing access first, then invite them again.",
  "invitation-already-pending":
    "There's already a pending invitation for this person. Resend or cancel it instead of sending a new one.",
  "business-owner-required": "Only the business owner can invite staff.",
  "business-required": STAFF_INVITE_PROBLEMS.business,
  "business-not-found": "That business could not be found. Refresh and try again.",
};

export const STAFF_INVITE_FALLBACK = "The invitation could not be sent. Try again.";

/** What an invite form shows when the callable refuses (contract §4). */
export function inviteRefusalMessage(error: unknown): string {
  return STAFF_INVITE_REFUSAL_COPY[reasonOf(error)] ?? STAFF_INVITE_FALLBACK;
}

// ---------------------------------------------------------------------------
// The invitation page (/j/<token>)
// ---------------------------------------------------------------------------

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const JOIN_PATH = /^\/j\/([A-Za-z0-9_-]{43})\/?$/;

/** The token of `/j/<token>` or of its rewritten form `/?service=staff-invite&j=<token>`. */
export function staffInviteTokenFromLocation(pathname: string, search: string): string {
  const path = JOIN_PATH.exec(String(pathname ?? ""));
  if (path) return path[1];
  const query = new URLSearchParams(String(search ?? "")).get("j") ?? "";
  return TOKEN.test(query) ? query : "";
}

/** The not-found page's forward for a host that did not rewrite /j/<token>. */
export function staffInvitePathRedirect(pathname: string): string {
  const path = JOIN_PATH.exec(String(pathname ?? ""));
  return path ? `/?service=staff-invite&j=${path[1]}` : "";
}

export type StaffInviteStatus = "pending" | "expired" | "cancelled" | "accepted";

export type StaffInvitePreview = {
  invitationId: string;
  status: StaffInviteStatus;
  businessId: string;
  businessName: string;
  invitedByName: string;
  fullName: string;
  phoneLastTwo: string;
  expiresAtMs: number;
};

/** phoneAccount({action: "staffInvite"})'s answer. Throws without an id. */
export function parseStaffInvitePreview(value: unknown): StaffInvitePreview {
  const row = record(value);
  const invitationId = clean(row.invitationId, 160);
  if (!invitationId) throw new Error("staff-invite-preview-invalid");
  const status = clean(row.status, 20);
  const lastTwo = clean(row.phoneLastTwo, 4);
  const expires = Number(row.expiresAtMs);
  return {
    invitationId,
    status: status === "expired" || status === "cancelled" || status === "accepted" ? status : "pending",
    businessId: clean(row.businessId, 160),
    businessName: clean(row.businessName),
    invitedByName: clean(row.invitedByName),
    fullName: clean(row.fullName),
    phoneLastTwo: /^\d{2}$/.test(lastTwo) ? lastTwo : "",
    expiresAtMs: Number.isFinite(expires) && expires > 0 ? Math.trunc(expires) : 0,
  };
}

/** The signed-in account, as far as the page cares. */
export type StaffInviteViewer = { signedIn: boolean; phoneNumber: string } | null;

export type StaffInviteView =
  | { kind: "closed"; status: Exclude<StaffInviteStatus, "pending"> }
  | { kind: "sign-in" }
  | { kind: "accept" }
  | { kind: "other-account" };

/** Whether an account's number ends in the invitation's last two digits. */
export function numberEndsWith(phoneNumber: string, lastTwo: string): boolean {
  const digits = String(phoneNumber ?? "").replace(/\D/g, "");
  return /^\d{2}$/.test(lastTwo) && digits.length >= 8 && digits.endsWith(lastTwo);
}

/**
 * What the page offers (contract §6). A closed invitation says so whoever
 * opens it; otherwise a signed-out visitor (or a guest's anonymous session)
 * signs in with the invited number, an account whose number ends in its
 * last two digits accepts, and anyone else signs out first. The server
 * still checks the full number when accepting.
 */
export function staffInviteView(preview: StaffInvitePreview, viewer: StaffInviteViewer): StaffInviteView {
  if (preview.status !== "pending") return { kind: "closed", status: preview.status };
  if (!viewer || !viewer.signedIn) return { kind: "sign-in" };
  return numberEndsWith(viewer.phoneNumber, preview.phoneLastTwo) ? { kind: "accept" } : { kind: "other-account" };
}

export const STAFF_INVITE_PAGE_COPY = {
  title: "Staff invitation",
  invitedYouToJoin: "invited you to join",
  youAreInvitedToJoin: "You’re invited to join",
  onLaawolAsStaff: "on Laawol as staff.",
  acceptWithNumber: "Accept with the number ending in",
  acceptHint: "We’ll send a code on WhatsApp to that number. No password is needed.",
  accept: "Accept invitation",
  accepting: "Accepting the invitation...",
  otherAccount: "You are signed in with another account. This invitation is for the number ending in",
  signOutToContinue: "Sign out to continue",
  signingOut: "Signing out...",
  joined: "You joined the team. Opening your business console...",
  loading: "Opening the invitation...",
  loadFailed: "The invitation could not be loaded. Check your connection and try again.",
  retry: "Retry",
  notFound: "This invitation link is not valid. Ask the business for a new invitation.",
  openLaawol: "Open Laawol",
} as const;

export const STAFF_INVITE_CLOSED_COPY: Record<Exclude<StaffInviteStatus, "pending">, string> = {
  expired: "This invitation has expired. Ask the business for a new invitation.",
  cancelled: "This invitation was cancelled. Ask the business for a new invitation.",
  accepted: "This invitation was already accepted. If that was not you, ask the business for a new invitation.",
};

export const ACCEPT_REFUSAL_COPY: Record<string, string> = {
  "active-invitation-not-found": "This invitation is no longer active. Ask the business for a new invitation.",
  "invitation-selection-required":
    "More than one active invitation was found. Ask Laawol support to choose the correct access.",
  "invitation-expired": STAFF_INVITE_CLOSED_COPY.expired,
  "invitation-not-pending": "This invitation was cancelled or already used. Ask the business for a new invitation.",
  "invitation-identity-mismatch":
    "You are signed in with another number. Sign out, then accept with the invited number.",
  "existing-authority-conflict":
    "This account already has business or admin access. Ask the business to invite another number.",
  "verified-email-required": "Sign in with the invited number, then accept again.",
};

export const ACCEPT_FALLBACK = "We could not accept this invitation. Try again.";

/** acceptAccessInvitation's refusal, in the page's own words. */
export function acceptRefusalMessage(error: unknown): string {
  return ACCEPT_REFUSAL_COPY[reasonOf(error)] ?? ACCEPT_FALLBACK;
}

// ---------------------------------------------------------------------------
// The "Join <business>" prompt after a normal sign-in (contract §4.1)
// ---------------------------------------------------------------------------

export type PendingInvitation = {
  invitationId: string;
  kind: "business" | "platform";
  channel: "phone" | "email";
  businessId: string;
  businessName: string;
  invitedByName: string;
  expiresAtMs: number;
};

/** What a platform invitation is to join (console copy, not user data). */
export const PLATFORM_INVITATION_NAME = "Laawol Digital administration";

export const PENDING_INVITE_COPY = {
  asStaff: "as staff.",
  asAdmin: "as an admin.",
  join: "Join",
  joining: "Joining...",
  notNow: "Not now",
} as const;

/** acceptAccessInvitation({action: "pending"})'s answer, read defensively. */
export function parsePendingInvitations(value: unknown): PendingInvitation[] {
  const list = record(value).invitations;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const rows: PendingInvitation[] = [];
  for (const item of list.slice(0, 20)) {
    const row = record(item);
    const invitationId = clean(row.invitationId, 160);
    if (!invitationId || seen.has(invitationId)) continue;
    seen.add(invitationId);
    const expires = Number(row.expiresAtMs);
    rows.push({
      invitationId,
      kind: row.kind === "platform" ? "platform" : "business",
      channel: row.channel === "phone" ? "phone" : "email",
      businessId: clean(row.businessId, 160),
      businessName: clean(row.businessName),
      invitedByName: clean(row.invitedByName),
      expiresAtMs: Number.isFinite(expires) && expires > 0 ? Math.trunc(expires) : 0,
    });
  }
  return rows;
}

/**
 * The name a prompt invites to join: the business (user data, shown as
 * typed), or for a platform invitation the console's own words. A business
 * with no name reads "A Laawol business".
 */
export function pendingInvitationTarget(invitation: PendingInvitation): { name: string; userData: boolean } {
  if (invitation.kind === "platform") return { name: PLATFORM_INVITATION_NAME, userData: false };
  return invitation.businessName
    ? { name: invitation.businessName, userData: true }
    : { name: "A Laawol business", userData: false };
}

/** "Not now" lasts until the next sign-in: per tab session, per account. */
export function dismissedInvitationsKey(uid: string): string {
  return `laawol.pendingInvites.notNow.${uid}`;
}

/** A stored "Not now" list, read defensively (any junk is an empty list). */
export function readDismissedInvitations(raw: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string" && id.length > 0).slice(0, 50)
      : [];
  } catch {
    return [];
  }
}

export function withDismissedInvitation(dismissed: readonly string[], invitationId: string): string[] {
  return dismissed.includes(invitationId) ? [...dismissed] : [...dismissed, invitationId].slice(-50);
}

export function visiblePendingInvitations(
  invitations: readonly PendingInvitation[],
  dismissed: readonly string[],
): PendingInvitation[] {
  return invitations.filter((invitation) => !dismissed.includes(invitation.invitationId));
}

/**
 * The name the owner typed in a phone invitation, shown on the People card
 * as "Invited as ..." when the number already had an account under another
 * name (that account keeps its own name: one phone = one account). Empty when
 * there is no invited name or it is the account's name anyway.
 */
export function invitedAsName(row: Record<string, unknown>): string {
  const invite = row.phoneInvite;
  const invited =
    invite && typeof invite === "object" && typeof (invite as { invitedName?: unknown }).invitedName === "string"
      ? (invite as { invitedName: string }).invitedName.trim()
      : "";
  if (!invited) return "";
  const norm = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const own = typeof row.fullName === "string" ? row.fullName : "";
  return norm(invited) === norm(own) ? "" : invited;
}
