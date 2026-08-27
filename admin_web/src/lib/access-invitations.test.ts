import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

import {
  accessInvitationDeliveryNote,
  accessInvitationExpiryLine,
  accessInvitationRowFrom,
  accessInvitationRowsFrom,
  accessInvitationSentLine,
  accessInvitationStatusLabel,
  accessInvitationStatusTone,
  canActOnAccessInvitation,
  type AccessInvitationRow,
} from "./access-invitations.ts";
import {translateValue} from "./french-dom.ts";

const SENT_AT = Date.UTC(2026, 7, 6, 12, 0, 0);
const EXPIRES_AT = Date.UTC(2026, 7, 13, 12, 0, 0);

function payload(overrides: Record<string, unknown> = {}) {
  return {
    invitationId: "inv-1",
    kind: "business",
    email: "Amina@Example.com",
    fullName: "Amina Barry",
    role: "staff",
    businessId: "keren_auto_sales",
    businessName: "Keren Auto Sales",
    businessPermissions: ["parking", "listings"],
    status: "pending",
    invitedByName: "Abdoullaye Sow",
    sentAtMs: SENT_AT,
    expiresAtMs: EXPIRES_AT,
    sendCount: 1,
    emailProvider: "firebaseTriggerEmail",
    emailBranded: true,
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}): AccessInvitationRow {
  const parsed = accessInvitationRowFrom(payload(overrides));
  assert.ok(parsed);
  return parsed;
}

const isoDate = (value: unknown) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : "";

test("a callable row is normalized, not trusted verbatim", () => {
  const parsed = row();
  assert.equal(parsed.email, "amina@example.com");
  assert.equal(parsed.status, "pending");
  assert.deepEqual(parsed.businessPermissions, ["parking", "listings"]);
  assert.equal(parsed.sendCount, 1);
});

test("a row with no id is dropped rather than rendered blank", () => {
  assert.equal(accessInvitationRowFrom(payload({invitationId: ""})), null);
  assert.equal(accessInvitationRowFrom(null), null);
  assert.equal(accessInvitationRowFrom("inv-1"), null);
  assert.deepEqual(accessInvitationRowsFrom(null), []);
  assert.equal(
    accessInvitationRowsFrom([payload(), payload({invitationId: ""})]).length,
    1,
  );
});

test("an unknown status is read as pending, never invented", () => {
  assert.equal(row({status: "weird"}).status, "pending");
  assert.equal(row({status: undefined}).status, "pending");
  assert.equal(row({status: "expired"}).status, "expired");
});

test("an expired invitation is labelled expired, not left as pending", () => {
  const live = row();
  assert.equal(accessInvitationStatusLabel(live), "Awaiting reply");
  assert.equal(accessInvitationStatusTone(live), "ok");

  const dead = row({status: "expired"});
  assert.equal(accessInvitationStatusLabel(dead), "Expired");
  assert.equal(accessInvitationStatusTone(dead), "warn");
});

test("both actions stay available on a pending or expired invitation", () => {
  assert.equal(canActOnAccessInvitation(row()), true);
  assert.equal(canActOnAccessInvitation(row({status: "expired"})), true);
  assert.equal(canActOnAccessInvitation(row({status: "accepted"})), false);
  assert.equal(canActOnAccessInvitation(row({status: "cancelled"})), false);
});

test("the label and its value stay in separate translatable pieces", () => {
  const expiry = accessInvitationExpiryLine(row(), isoDate);
  assert.equal(expiry.label, "Link expires");
  assert.equal(expiry.detail, "2026-08-13");

  const sent = accessInvitationSentLine(row(), isoDate);
  assert.equal(sent.label, "Invitation sent");
  assert.equal(sent.detail, "2026-08-06 · Abdoullaye Sow");
});

test("an expired link says so instead of printing a past date", () => {
  const expiry = accessInvitationExpiryLine(row({status: "expired"}), isoDate);
  assert.equal(expiry.label, "Link expired — resend to renew");
  assert.equal(expiry.detail, "");
});

test("a missing expiry is reported, not rendered as an epoch", () => {
  const expiry = accessInvitationExpiryLine(row({expiresAtMs: 0}), isoDate);
  assert.equal(expiry.label, "No expiry recorded");
  assert.equal(expiry.detail, "");
});

test("the sent line survives a missing date or sender", () => {
  assert.equal(
    accessInvitationSentLine(row({sentAtMs: 0}), isoDate).detail,
    "Abdoullaye Sow",
  );
  assert.equal(
    accessInvitationSentLine(row({invitedByName: ""}), isoDate).detail,
    "2026-08-06",
  );
  assert.equal(
    accessInvitationSentLine(
      row({sentAtMs: 0, invitedByName: ""}),
      isoDate,
    ).detail,
    "",
  );
});

test("a branded delivery says nothing; a fallback explains itself", () => {
  assert.equal(accessInvitationDeliveryNote(row()), "");
  assert.match(
    accessInvitationDeliveryNote(
      row({emailBranded: false, emailProvider: "firebaseAuth"}),
    ),
    /plain Firebase template/,
  );
  assert.match(
    accessInvitationDeliveryNote(
      row({emailBranded: false, emailProvider: "smtpBroken"}),
    ),
    /could not be delivered/,
  );
  // Nothing recorded yet (an older invitation) stays quiet rather than
  // accusing a delivery that may well have worked.
  assert.equal(
    accessInvitationDeliveryNote(row({emailBranded: false, emailProvider: ""})),
    "",
  );
});

test("every pending-invitation label the panels render is bilingual", () => {
  for (const label of [
    "Invitations sent — waiting for the person to set a password",
    "Team members",
    "Awaiting reply",
    "Expired",
    "Invitation sent",
    "Link expires",
    "Link expired — resend to renew",
    "No expiry recorded",
    "Invited to manage",
    "No sections selected",
    "Resend invitation",
    "Cancel invitation",
    "Invitation cancelled",
    "Pending invitations could not be loaded.",
    "Sent with the plain Firebase template — connect an email sender for the branded invitation.",
    "The invitation email could not be delivered. Resend it.",
    "Invitation expired",
    "The link no longer works. Resend it to issue a new one.",
    "Send date not reported",
  ]) {
    assert.notEqual(
      translateValue(label, "fr"),
      label,
      `missing French translation for "${label}"`,
    );
  }
});

test("the business People panel lists, cancels, and resends invitations", () => {
  const source = readFileSync(
    new URL("../components/business/profile-support-people.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /"listBusinessInvitations"/);
  assert.match(source, /"resendAccessInvitation"/);
  assert.match(source, /"cancelAccessInvitation"/);
  assert.match(source, /PendingInvitationRow/);
  // The list must be re-read after every action, or a cancelled invitation
  // keeps sitting in the panel offering a Cancel button.
  assert.ok(
    (source.match(/invitations\.refresh\(\)/g) || []).length >= 3,
    "invite, resend and cancel must all refresh the pending list",
  );
});
