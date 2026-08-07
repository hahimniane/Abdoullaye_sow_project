"use strict";

// Everything an access invitation DECIDES, kept away from Firestore and Auth.
//
// Two separate problems live here:
//
//   * the lifecycle - a stored invitation carries a status and an expiry, and
//     the pair (not the status alone) decides whether an operator may cancel
//     it, resend it, or whether it is simply dead. An invitation that ran out
//     of time is still written as "pending", because nothing sweeps the
//     collection; the derived status is what a console must show and what the
//     callables must gate on;
//
//   * the invitation email itself - which sender is used, and what the
//     recipient actually reads. The stock Firebase password-reset template
//     tells the recipient nothing about who invited them or why, so a branded
//     document is rendered here and sent through the Trigger Email extension
//     with a link this platform generated itself.
//
// Both are pure so they can be unit-tested without an emulator.

const LOGO_URL = "https://laawoldigital.com/assets/logo.png";
const BRAND_TEAL = "#0D9488";

// Seven days. Long enough to survive a weekend and a missed inbox, short
// enough that a forgotten invitation stops being a live way in.
const ACCESS_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ACCESS_INVITATION_STATUS = Object.freeze({
  PENDING: "pending",
  ACCEPTED: "accepted",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
});

const ACCESS_INVITATION_REFUSALS = Object.freeze({
  ACCEPTED: "invitation-already-accepted",
  CANCELLED: "invitation-already-cancelled",
  UNKNOWN: "invitation-not-pending",
});

function text(value, maxLength = 200) {
  return String(value === null || value === undefined ? "" : value)
      .trim().slice(0, maxLength);
}

/**
 * Milliseconds for anything Firestore, a callable payload, or a test might
 * hand over: a Timestamp, a Date, an epoch number, or an ISO string.
 * @param {*} value The candidate instant.
 * @return {number} Epoch milliseconds, or 0 when unreadable.
 */
function instantMs(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  }
  if (typeof value.toMillis === "function") {
    const millis = Number(value.toMillis());
    return Number.isFinite(millis) ? millis : 0;
  }
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ?
      date.getTime() : 0;
  }
  if (typeof value._seconds === "number") return value._seconds * 1000;
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * The status a console should show, which is not always the stored one.
 *
 * Nothing sweeps `accessInvitations`, so an invitation whose window closed is
 * still stored as "pending". Reading the expiry here means an expired
 * invitation stops advertising itself as live everywhere at once, without a
 * scheduled job whose failure would quietly resurrect dead links.
 *
 * @param {Object} invitation A stored accessInvitations document.
 * @param {number} nowMs The current instant.
 * @return {string} An ACCESS_INVITATION_STATUS value.
 */
function accessInvitationStatus(invitation, nowMs = Date.now()) {
  const record = invitation && typeof invitation === "object" ? invitation : {};
  const stored = text(record.status, 40) || ACCESS_INVITATION_STATUS.PENDING;
  if (stored === ACCESS_INVITATION_STATUS.ACCEPTED ||
      stored === ACCESS_INVITATION_STATUS.CANCELLED) {
    return stored;
  }
  if (stored !== ACCESS_INVITATION_STATUS.PENDING) return stored;
  const expiresAt = instantMs(record.expiresAt);
  if (expiresAt > 0 && expiresAt <= nowMs) {
    return ACCESS_INVITATION_STATUS.EXPIRED;
  }
  return ACCESS_INVITATION_STATUS.PENDING;
}

/**
 * Whether an invitation is still a working way in.
 * @param {Object} invitation A stored accessInvitations document.
 * @param {number} nowMs The current instant.
 * @return {boolean} True while the link can still be accepted.
 */
function accessInvitationIsLive(invitation, nowMs = Date.now()) {
  return accessInvitationStatus(invitation, nowMs) ===
    ACCESS_INVITATION_STATUS.PENDING;
}

/**
 * Whether an operator may cancel or resend, and why not when they may not.
 *
 * An EXPIRED invitation stays actionable on purpose: resending is exactly how
 * an operator revives one, and cancelling is how they clear it off the list.
 * Only an invitation that was already accepted or already cancelled is
 * refused - re-issuing a link for an account that is already active would
 * hand out a password reset nobody asked for.
 *
 * @param {Object} invitation A stored accessInvitations document.
 * @param {string} action Either "cancel" or "resend".
 * @param {number} nowMs The current instant.
 * @return {{allowed: boolean, reason: string, status: string}} The decision.
 */
function accessInvitationActionDecision(
    invitation,
    action,
    nowMs = Date.now(),
) {
  const status = accessInvitationStatus(invitation, nowMs);
  if (status === ACCESS_INVITATION_STATUS.ACCEPTED) {
    return {allowed: false, reason: ACCESS_INVITATION_REFUSALS.ACCEPTED,
      status};
  }
  if (status === ACCESS_INVITATION_STATUS.CANCELLED) {
    return {allowed: false, reason: ACCESS_INVITATION_REFUSALS.CANCELLED,
      status};
  }
  if (status !== ACCESS_INVITATION_STATUS.PENDING &&
      status !== ACCESS_INVITATION_STATUS.EXPIRED) {
    return {allowed: false, reason: ACCESS_INVITATION_REFUSALS.UNKNOWN, status};
  }
  if (action !== "cancel" && action !== "resend") {
    return {allowed: false, reason: ACCESS_INVITATION_REFUSALS.UNKNOWN, status};
  }
  return {allowed: true, reason: "", status};
}

/**
 * The instant a freshly sent invitation stops working.
 * @param {number} nowMs The moment it is sent.
 * @return {number} Epoch milliseconds of the expiry.
 */
function accessInvitationExpiryMs(nowMs = Date.now()) {
  return nowMs + ACCESS_INVITATION_TTL_MS;
}

/**
 * One console row for a stored invitation.
 * @param {string} id The invitation document id.
 * @param {Object} invitation The stored document.
 * @param {number} nowMs The current instant.
 * @return {Object} A plain, serializable row.
 */
function accessInvitationRow(id, invitation, nowMs = Date.now()) {
  const record = invitation && typeof invitation === "object" ? invitation : {};
  const permissions = Array.isArray(record.businessPermissions) ?
    record.businessPermissions.map((item) => text(item, 60)).filter(Boolean) :
    [];
  return {
    invitationId: text(id, 160),
    kind: text(record.kind, 40) || "business",
    email: text(record.email, 320).toLowerCase(),
    fullName: text(record.fullName, 200),
    role: text(record.kind, 40) === "platform" ?
      text(record.adminRole, 120) || "admin" : "staff",
    adminRole: text(record.adminRole, 120),
    businessId: text(record.businessId, 160),
    businessName: text(record.businessName, 200),
    businessPermissions: permissions,
    status: accessInvitationStatus(record, nowMs),
    storedStatus: text(record.status, 40) || ACCESS_INVITATION_STATUS.PENDING,
    invitedBy: text(record.invitedBy, 160),
    invitedByName: text(record.invitedByName, 200),
    sentAtMs: instantMs(record.updatedAt) || instantMs(record.createdAt),
    createdAtMs: instantMs(record.createdAt),
    expiresAtMs: instantMs(record.expiresAt),
    sendCount: Number(record.sendCount || 0) || 0,
    emailProvider: text(record.lastEmailProvider, 60),
    emailBranded: record.lastEmailBranded === true,
  };
}

/**
 * The rows a People panel should show: everything still awaiting an answer,
 * newest first. Accepted invitations drop off because the person is now in
 * the staff list itself, and cancelled ones drop off because an operator
 * already dismissed them - otherwise the panel only ever grows.
 *
 * @param {Array<{id: string, data: Object}>} entries Stored invitations.
 * @param {number} nowMs The current instant.
 * @return {Array<Object>} Rows for the console.
 */
function outstandingAccessInvitations(entries, nowMs = Date.now()) {
  const list = Array.isArray(entries) ? entries : [];
  return list
      .map((entry) => accessInvitationRow(
          entry?.id,
          entry?.data,
          nowMs,
      ))
      .filter((row) => row.status === ACCESS_INVITATION_STATUS.PENDING ||
        row.status === ACCESS_INVITATION_STATUS.EXPIRED)
      .sort((a, b) => (b.sentAtMs - a.sentAtMs) ||
        a.email.localeCompare(b.email));
}

// ---------------------------------------------------------------------------
// Email delivery
// ---------------------------------------------------------------------------

const ACCESS_EMAIL_SENDERS = Object.freeze({
  TRIGGER_EMAIL: "firebaseTriggerEmail",
  FIREBASE_AUTH: "firebaseAuth",
  NONE: "",
});

/**
 * Which sender carries this email, decided before anything is written.
 *
 * The branded document can only go out through the Trigger Email extension,
 * so when no provider is connected the choice is between Firebase's own stock
 * template and nobody hearing about the invitation at all. For an invitation
 * or a password reset the stock template still contains a working link, so it
 * is used as a fallback rather than failing the invite silently - the branding
 * is lost, the access is not. The delivery record keeps which one was used so
 * an operator can see that a plain email went out and resend once a sender is
 * configured.
 *
 * Anything else (an email-verification notice, for instance) has no stock
 * equivalent, so it is recorded as undeliverable instead of pretending.
 *
 * @param {{emailProvider: string, kind: string}} input Provider and email kind.
 * @return {Object} The sender plan.
 */
function accessEmailDeliveryPlan({emailProvider, kind} = {}) {
  const provider = text(emailProvider, 60);
  const emailKind = text(kind, 40);
  if (provider === ACCESS_EMAIL_SENDERS.TRIGGER_EMAIL) {
    return {
      sender: ACCESS_EMAIL_SENDERS.TRIGGER_EMAIL,
      provider: ACCESS_EMAIL_SENDERS.TRIGGER_EMAIL,
      status: "queued",
      branded: true,
      useTriggerEmail: true,
      useFirebaseFallback: false,
      lastError: "",
    };
  }
  if (["invitation", "password_reset"].includes(emailKind)) {
    return {
      sender: ACCESS_EMAIL_SENDERS.FIREBASE_AUTH,
      provider: ACCESS_EMAIL_SENDERS.FIREBASE_AUTH,
      status: "sent",
      branded: false,
      useTriggerEmail: false,
      useFirebaseFallback: true,
      lastError: "",
    };
  }
  return {
    sender: ACCESS_EMAIL_SENDERS.NONE,
    provider,
    status: "provider_not_configured",
    branded: false,
    useTriggerEmail: false,
    useFirebaseFallback: false,
    lastError: "Email sender provider is not connected.",
  };
}

function frenchLocale(locale) {
  return text(locale, 12).toLowerCase().startsWith("fr");
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
      .replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;",
      }[char]));
}

function formatExpiry(expiresAtMs, french) {
  const millis = instantMs(expiresAtMs);
  if (!millis) return "";
  return new Date(millis).toLocaleDateString(french ? "fr-FR" : "en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}

/**
 * The (short) words of an invitation email, in the recipient's language.
 *
 * The owner asked for very little wording, so this carries only what a
 * recipient needs to not read it as phishing: who invited them, to what, the
 * one thing they are asked to do, and when the link dies.
 *
 * @param {Object} input Recipient locale and invitation facts.
 * @return {Object} Subject, headline, sentence, button, expiry note.
 */
function accessInvitationEmailCopy({
  locale,
  kind,
  businessName,
  inviterName,
  adminRoleLabel,
  expiresAtMs,
  actionUrl,
} = {}) {
  const french = frenchLocale(locale);
  const platform = text(kind, 40) === "platform";
  const workspace = platform ?
    (text(adminRoleLabel, 120) || (french ?
      "l’administration Laawol Digital" : "Laawol Digital administration")) :
    (text(businessName, 200) || "Laawol Digital");
  const inviter = text(inviterName, 200);
  const expiry = formatExpiry(expiresAtMs, french);

  const sentence = french ?
    (inviter ?
      `${inviter} vous invite à rejoindre ${workspace} sur Laawol Digital.` :
      `Vous êtes invité à rejoindre ${workspace} sur Laawol Digital.`) :
    (inviter ?
      `${inviter} invited you to join ${workspace} on Laawol Digital.` :
      `You have been invited to join ${workspace} on Laawol Digital.`);

  return {
    locale: french ? "fr" : "en",
    subject: french ?
      `Rejoignez ${workspace} sur Laawol Digital` :
      `Join ${workspace} on Laawol Digital`,
    headline: french ? "Vous êtes invité" : "You are invited",
    sentence,
    instruction: french ?
      "Créez votre mot de passe pour activer votre accès." :
      "Create your password to activate your access.",
    buttonLabel: french ? "Créer mon mot de passe" : "Set my password",
    expiryNote: expiry ?
      (french ? `Ce lien expire le ${expiry}.` : `This link expires ${expiry}.`) :
      "",
    signature: french ?
      "Laawol Digital · laawoldigital.com" :
      "Laawol Digital · laawoldigital.com",
    ignoreNote: french ?
      "Vous ne connaissez pas cette invitation ? Ignorez cet e-mail." :
      "Did not expect this invitation? Ignore this email.",
    actionUrl: text(actionUrl, 2000),
  };
}

/**
 * The plain-text twin of the branded email, for clients that refuse HTML.
 * @param {Object} copy The output of accessInvitationEmailCopy.
 * @return {string} Plain text body.
 */
function renderAccessInvitationText(copy) {
  return [
    copy.sentence,
    copy.instruction,
    copy.actionUrl,
    copy.expiryNote,
    copy.ignoreNote,
    copy.signature,
  ].filter(Boolean).join("\n\n");
}

/**
 * The branded invitation email.
 *
 * Table layout and inline styles because email clients are not browsers, and
 * the same teal/logo the printed parking documents already use so the two
 * pieces of post a customer gets from this platform look like one company.
 *
 * @param {Object} copy The output of accessInvitationEmailCopy.
 * @return {string} An HTML document body.
 */
function renderAccessInvitationEmail(copy) {
  const button = copy.actionUrl ?
    `<tr><td style="padding:26px 0 6px">
      <a href="${escapeHtml(copy.actionUrl)}"
        style="background:${BRAND_TEAL};color:#ffffff;text-decoration:none;
        display:inline-block;padding:13px 26px;border-radius:8px;
        font-weight:700;font-size:15px">${escapeHtml(copy.buttonLabel)}</a>
    </td></tr>` :
    "";
  const expiry = copy.expiryNote ?
    `<tr><td style="padding:14px 0 0;color:#5b6b68;font-size:13px">
      ${escapeHtml(copy.expiryNote)}</td></tr>` :
    "";
  return `<table role="presentation" width="100%" cellpadding="0"
  cellspacing="0" style="background:#eef1f0;padding:24px 0;margin:0">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="max-width:560px;background:#ffffff;border-radius:12px;
  padding:32px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,
  sans-serif;color:#12211f">
  <tr><td style="border-bottom:2px solid ${BRAND_TEAL};padding-bottom:16px">
    <img src="${LOGO_URL}" width="44" height="44" alt="Laawol Digital"
      style="display:block;border-radius:9px">
  </td></tr>
  <tr><td style="padding:22px 0 0;font-size:20px;font-weight:700">
    ${escapeHtml(copy.headline)}</td></tr>
  <tr><td style="padding:10px 0 0;font-size:15px;line-height:1.6">
    ${escapeHtml(copy.sentence)}</td></tr>
  <tr><td style="padding:6px 0 0;font-size:15px;line-height:1.6">
    ${escapeHtml(copy.instruction)}</td></tr>
  ${button}
  ${expiry}
  <tr><td style="padding:22px 0 0;border-top:1px solid #eceeed;
    color:#5b6b68;font-size:12px;line-height:1.6">
    ${escapeHtml(copy.ignoreNote)}<br>${escapeHtml(copy.signature)}
  </td></tr>
</table>
</td></tr></table>`;
}

module.exports = {
  ACCESS_EMAIL_SENDERS,
  ACCESS_INVITATION_REFUSALS,
  ACCESS_INVITATION_STATUS,
  ACCESS_INVITATION_TTL_MS,
  accessEmailDeliveryPlan,
  accessInvitationActionDecision,
  accessInvitationEmailCopy,
  accessInvitationExpiryMs,
  accessInvitationIsLive,
  accessInvitationRow,
  accessInvitationStatus,
  outstandingAccessInvitations,
  renderAccessInvitationEmail,
  renderAccessInvitationText,
};
