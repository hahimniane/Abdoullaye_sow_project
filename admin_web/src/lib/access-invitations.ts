// What a People panel shows for an invitation that has been sent but not yet
// answered. The callable already decides which invitations are outstanding;
// this decides how a row reads and which buttons it earns, so the panel stays
// a template and the rules stay testable.

import { inviteLinkOrEmpty } from "./staff-phone-invite.ts";

export type AccessInvitationStatus =
  | "pending"
  | "expired"
  | "accepted"
  | "cancelled";

export type AccessInvitationRow = {
  invitationId: string;
  kind: string;
  email: string;
  fullName: string;
  role: string;
  businessId: string;
  businessName: string;
  businessPermissions: string[];
  status: AccessInvitationStatus;
  invitedByName: string;
  sentAtMs: number;
  expiresAtMs: number;
  sendCount: number;
  emailProvider: string;
  emailBranded: boolean;
  /** "phone" for a WhatsApp invitation (docs/STAFF_PHONE_INVITES.md). */
  channel: "phone" | "email";
  /** "+224 ••••56": the only part of the number a list ever shows. */
  phoneMasked: string;
  phoneLastTwo: string;
  /** The /j/<token> link to share (phone only). */
  inviteLink: string;
  /** sent | not_configured | template_pending | failed, "" before a try. */
  whatsappStatus: string;
  inventoryStoreAccess: {allStores: boolean; homeStoreId: string} | null;
};

function text(value: unknown, max = 320) {
  return String(value ?? "").trim().slice(0, max);
}

function millis(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function status(value: unknown): AccessInvitationStatus {
  const normalized = text(value, 40);
  return normalized === "expired" ||
    normalized === "accepted" ||
    normalized === "cancelled"
    ? normalized
    : "pending";
}

/**
 * Normalizes one row off the `listBusinessInvitations` callable. The callable
 * is trusted for the facts, not for the shape - a row rendered from `any`
 * turns a missing field into "undefined" in front of an operator.
 */
export function accessInvitationRowFrom(
  value: unknown,
): AccessInvitationRow | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const invitationId = text(record.invitationId, 160);
  if (!invitationId) return null;
  const permissions = Array.isArray(record.businessPermissions)
    ? record.businessPermissions.map((item) => text(item, 60)).filter(Boolean)
    : [];
  const phone = record.channel === "phone";
  const lastTwo = text(record.phoneLastTwo, 4);
  return {
    invitationId,
    kind: text(record.kind, 40) || "business",
    email: text(record.email).toLowerCase(),
    fullName: text(record.fullName, 200),
    role: text(record.role, 120) || "staff",
    businessId: text(record.businessId, 160),
    businessName: text(record.businessName, 200),
    businessPermissions: permissions,
    status: status(record.status),
    invitedByName: text(record.invitedByName, 200),
    sentAtMs: millis(record.sentAtMs),
    expiresAtMs: millis(record.expiresAtMs),
    sendCount: Number(record.sendCount) || 0,
    emailProvider: text(record.emailProvider, 60),
    emailBranded: record.emailBranded === true,
    channel: phone ? "phone" : "email",
    phoneMasked: phone ? text(record.phoneMasked, 40) : "",
    phoneLastTwo: phone && /^\d{2}$/.test(lastTwo) ? lastTwo : "",
    inviteLink: phone ? inviteLinkOrEmpty(record.inviteLink) : "",
    whatsappStatus: phone ? text(record.whatsappStatus, 40) : "",
    inventoryStoreAccess: storeAccessFrom(record.inventoryStoreAccess),
  };
}

function storeAccessFrom(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const access = value as Record<string, unknown>;
  return {
    allStores: access.allStores === true,
    homeStoreId: text(access.homeStoreId, 128),
  };
}

export function accessInvitationRowsFrom(value: unknown): AccessInvitationRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => accessInvitationRowFrom(item))
    .filter((row): row is AccessInvitationRow => row !== null);
}

/**
 * The badge an operator reads. An expired invitation is called expired rather
 * than pending, because "pending" invites them to keep waiting for someone
 * who can no longer get in.
 */
export function accessInvitationStatusLabel(row: AccessInvitationRow) {
  return row.status === "expired" ? "Expired" : "Awaiting reply";
}

export function accessInvitationStatusTone(row: AccessInvitationRow) {
  return row.status === "expired" ? "warn" : "ok";
}

// A line is split into a fixed label and a variable detail on purpose: the
// console's French dictionary matches whole text nodes, so a date or a
// person's name glued into the sentence would leave the label untranslated.
export type AccessInvitationLine = { label: string; detail: string };

/**
 * The expiry line. Once the window has closed, an exact date is noise - what
 * matters is that the link no longer works and needs resending.
 */
export function accessInvitationExpiryLine(
  row: AccessInvitationRow,
  formatDate: (value: unknown) => string,
): AccessInvitationLine {
  if (!row.expiresAtMs) return {label: "No expiry recorded", detail: ""};
  if (row.status === "expired") {
    return {label: "Link expired — resend to renew", detail: ""};
  }
  return {
    label: "Link expires",
    detail: formatDate(new Date(row.expiresAtMs)),
  };
}

export function accessInvitationSentLine(
  row: AccessInvitationRow,
  formatDate: (value: unknown) => string,
): AccessInvitationLine {
  const detail = [
    row.sentAtMs ? formatDate(new Date(row.sentAtMs)) : "",
    row.invitedByName,
  ]
    .filter(Boolean)
    .join(" · ");
  return {label: "Invitation sent", detail};
}

/**
 * A note only when the email that went out was NOT the branded one, so an
 * operator who hears "that email looked like spam" can see why, and so a
 * delivery that failed outright is never silent.
 */
export function accessInvitationDeliveryNote(row: AccessInvitationRow) {
  // A phone invitation's delivery is WhatsApp's: see accessInvitationShareNote.
  if (row.channel === "phone") return "";
  if (row.emailBranded) return "";
  if (row.emailProvider === "firebaseAuth") {
    return "Sent with the plain Firebase template — connect an email sender " +
      "for the branded invitation.";
  }
  if (!row.emailProvider) return "";
  return "The invitation email could not be delivered. Resend it.";
}

/**
 * Both actions stay available on an expired invitation: resending is how an
 * operator revives one, cancelling is how they clear it off the list.
 */
export function canActOnAccessInvitation(row: AccessInvitationRow) {
  return row.status === "pending" || row.status === "expired";
}

/**
 * Who a row is for, as the list shows it under the name: the masked number
 * of a phone invitation (never an empty email), the email otherwise.
 */
export function accessInvitationContact(row: AccessInvitationRow) {
  if (row.channel === "phone") return row.phoneMasked || (row.phoneLastTwo ? `••${row.phoneLastTwo}` : "");
  return row.email;
}

/** The row's title: the name, else its contact. */
export function accessInvitationTitle(row: AccessInvitationRow) {
  return row.fullName || accessInvitationContact(row);
}

/**
 * A phone invitation whose WhatsApp message has not gone out (or not yet
 * been tried) carries "not sent yet - share this link". Until Meta approves
 * the template this is every phone invitation, and that is not an error.
 */
export function accessInvitationNeedsSharing(row: AccessInvitationRow) {
  return row.channel === "phone" && row.whatsappStatus !== "sent" &&
    Boolean(row.inviteLink) && canActOnAccessInvitation(row);
}

export type InvitationConfirm = {confirm: string; confirmFr: string};

/** The confirmations of a row's Resend and Cancel, naming whom (masked). */
export function accessInvitationConfirmations(row: AccessInvitationRow): {
  resend: InvitationConfirm;
  cancel: InvitationConfirm;
} {
  const who = accessInvitationContact(row) || accessInvitationTitle(row);
  if (row.channel === "phone") {
    return {
      resend: {
        confirm: `Send the WhatsApp invitation to ${who} again? The link stays the same.`,
        confirmFr: `Renvoyer l’invitation WhatsApp au ${who} ? Le lien reste le même.`,
      },
      cancel: {
        confirm: `Cancel the invitation for ${who}? Its link stops working.`,
        confirmFr: `Annuler l’invitation du ${who} ? Son lien cessera de fonctionner.`,
      },
    };
  }
  return {
    resend: {
      confirm: `Send ${who} a new invitation link?`,
      confirmFr: `Envoyer à ${who} un nouveau lien d’invitation ?`,
    },
    cancel: {
      confirm: `Cancel the invitation for ${who}? Their link stops working.`,
      confirmFr: `Annuler l’invitation de ${who} ? Son lien cessera de fonctionner.`,
    },
  };
}
