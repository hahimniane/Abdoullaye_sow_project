import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ATTRIBUTE_TRANSLATIONS, TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { screenStrings } from "./screen-strings.ts";
import {
  accessInvitationConfirmations,
  accessInvitationContact,
  accessInvitationDeliveryNote,
  accessInvitationNeedsSharing,
  accessInvitationRowFrom,
  accessInvitationTitle,
  type AccessInvitationRow,
} from "./access-invitations.ts";
import { customerServiceFromLocation } from "./customer-service-intent.ts";
import { PHONE_REFUSAL_COPY, phoneRefusalOf, phoneRefusalText } from "./phone-accounts.ts";
import {
  ACCEPT_FALLBACK,
  ACCEPT_REFUSAL_COPY,
  ALL_STORES,
  PENDING_INVITE_COPY,
  PLATFORM_INVITATION_NAME,
  dismissedInvitationsKey,
  parsePendingInvitations,
  pendingInvitationTarget,
  readDismissedInvitations,
  visiblePendingInvitations,
  withDismissedInvitation,
  INVITE_METHOD_LABELS,
  STAFF_INVITE_CLOSED_COPY,
  STAFF_INVITE_COPY,
  STAFF_INVITE_FALLBACK,
  STAFF_INVITE_PAGE_COPY,
  STAFF_INVITE_PROBLEMS,
  STAFF_INVITE_REFUSAL_COPY,
  acceptRefusalMessage,
  asksWhichStore,
  emptyStaffInviteDraft,
  inviteLinkOrEmpty,
  inviteNeedsSharing,
  inviteRefusalMessage,
  numberEndsWith,
  parseStaffInvitePreview,
  staffInvitePathRedirect,
  staffInvitePayload,
  staffInviteProblem,
  staffInviteResultFrom,
  staffInviteTokenFromLocation,
  staffInviteView,
  type StaffInvitePreview,
} from "./staff-phone-invite.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const TOKEN = "A".repeat(20) + "b_-" + "9".repeat(20);
const LINK = `https://customer.laawoldigital.com/j/${TOKEN}`;

// ---------------------------------------------------------------------------
// The invite form
// ---------------------------------------------------------------------------

test("a new invitation starts on the phone, with the usual two sections", () => {
  const draft = emptyStaffInviteDraft();
  assert.equal(draft.method, "phone");
  assert.deepEqual(draft.businessPermissions, ["profile", "people"]);
  assert.equal(draft.storeChoice, ALL_STORES);
  assert.equal(emptyStaffInviteDraft("email").method, "email");
});

test("a phone invitation sends the E.164 number and no email (contract §4)", () => {
  const draft = { ...emptyStaffInviteDraft(), fullName: "  Amina Barry ", phone: "+224 622 12 34 56" };
  assert.equal(staffInviteProblem(draft), "");
  assert.deepEqual(staffInvitePayload(draft, { businessId: "biz", locale: "fr" }), {
    businessId: "biz",
    fullName: "Amina Barry",
    method: "phone",
    phone: "+224622123456",
    businessPermissions: ["profile", "people"],
    locale: "fr",
  });
});

test("an email invitation sends the lower-cased address and no number", () => {
  const draft = { ...emptyStaffInviteDraft("email"), fullName: "Amina", email: " Amina@Example.COM ", phone: "+224622123456" };
  const payload = staffInvitePayload(draft, { businessId: "biz", locale: "en" });
  assert.equal(payload.method, "email");
  assert.equal(payload.email, "amina@example.com");
  assert.equal("phone" in payload, false);
});

test("the form refuses a missing name, a number without its country code, or a bad email", () => {
  const base = emptyStaffInviteDraft();
  assert.equal(staffInviteProblem({ ...base, phone: "+224622123456" }), STAFF_INVITE_PROBLEMS.fullName);
  assert.equal(staffInviteProblem({ ...base, fullName: "A", phone: "622123456" }), STAFF_INVITE_PROBLEMS.phone);
  assert.equal(staffInviteProblem({ ...base, fullName: "A", phone: "" }), STAFF_INVITE_PROBLEMS.phone);
  assert.equal(staffInviteProblem({ ...base, method: "email", fullName: "A", email: "nope" }), STAFF_INVITE_PROBLEMS.email);
  assert.equal(staffInviteProblem({ ...base, method: "email", fullName: "A", email: "a@b.co" }), "");
});

test("'Which store?' is asked only with two or more stores and the Inventory section", () => {
  const stores = ["s1", "s2"];
  assert.equal(asksWhichStore(stores, ["inventory"]), true);
  assert.equal(asksWhichStore(["s1"], ["inventory"]), false);
  assert.equal(asksWhichStore(stores, ["profile"]), false);
  const draft = { ...emptyStaffInviteDraft(), fullName: "A", phone: "+224622123456", businessPermissions: ["inventory"] };
  assert.deepEqual(staffInvitePayload(draft, { businessId: "b", locale: "en", storeIds: stores }).inventoryStoreAccess, { allStores: true });
  assert.deepEqual(
    staffInvitePayload({ ...draft, storeChoice: "s2" }, { businessId: "b", locale: "en", storeIds: stores }).inventoryStoreAccess,
    { allStores: false, homeStoreId: "s2" },
  );
  // Not asked: nothing sent, whatever the draft holds.
  assert.equal("inventoryStoreAccess" in staffInvitePayload({ ...draft, storeChoice: "s2" }, { businessId: "b", locale: "en", storeIds: ["s1"] }), false);
  assert.equal(staffInviteProblem({ ...draft, storeChoice: "gone" }, stores), STAFF_INVITE_PROBLEMS.store);
  assert.equal(staffInviteProblem({ ...draft, storeChoice: "s1" }, stores), "");
});

// ---------------------------------------------------------------------------
// The answer, and "not sent yet - share this link"
// ---------------------------------------------------------------------------

test("a phone answer is read defensively; whatsappSent false is a link to share, not an error", () => {
  const notSent = staffInviteResultFrom({
    success: true, invitationId: "i1", channel: "phone", email: "", phoneMasked: "+224 ••••56",
    status: "pending", inviteLink: LINK, whatsappSent: false, whatsappStatus: "template_pending",
  });
  assert.deepEqual(notSent, {
    channel: "phone", phoneMasked: "+224 ••••56", email: "", inviteLink: LINK,
    whatsappSent: false, whatsappStatus: "template_pending",
  });
  assert.equal(inviteNeedsSharing(notSent), true);
  assert.equal(inviteNeedsSharing({ ...notSent, whatsappSent: true }), false);
  assert.equal(inviteNeedsSharing({ ...notSent, inviteLink: "" }), false);
  // An email answer (or an older server's) never offers a link.
  const email = staffInviteResultFrom({ success: true, email: "A@B.co", inviteLink: LINK, whatsappSent: false });
  assert.equal(email.channel, "email");
  assert.equal(email.inviteLink, "");
  assert.equal(inviteNeedsSharing(email), false);
  assert.equal(staffInviteResultFrom(null).channel, "email");
});

test("only a real /j/<token> https link is ever shown to copy", () => {
  assert.equal(inviteLinkOrEmpty(LINK), LINK);
  assert.equal(inviteLinkOrEmpty(`http://customer.laawoldigital.com/j/${TOKEN}`), "");
  assert.equal(inviteLinkOrEmpty(`https://customer.laawoldigital.com/j/short`), "");
  assert.equal(inviteLinkOrEmpty(`javascript:alert(1)//https://x/j/${TOKEN}`), "");
  assert.equal(inviteLinkOrEmpty(42), "");
});

test("every refusal of the contract maps to console copy, never the server's English", () => {
  const reasons = [
    "full-name-required", "valid-phone-required", "phone-country-code-required", "store-access-invalid",
    "store-not-found", "existing-authority-conflict", "invitation-already-pending", "business-owner-required",
    "business-required", "business-not-found", "valid-email-required",
  ];
  assert.deepEqual(Object.keys(STAFF_INVITE_REFUSAL_COPY).sort(), [...reasons].sort());
  for (const reason of reasons) {
    const shown = inviteRefusalMessage({ message: "Server English", details: { reason } });
    assert.equal(shown, STAFF_INVITE_REFUSAL_COPY[reason]);
  }
  assert.equal(inviteRefusalMessage(new Error("Server English")), STAFF_INVITE_FALLBACK);
  assert.equal(inviteRefusalMessage(null), STAFF_INVITE_FALLBACK);
});

// ---------------------------------------------------------------------------
// The pending list
// ---------------------------------------------------------------------------

function phoneRow(overrides: Record<string, unknown> = {}): AccessInvitationRow {
  const row = accessInvitationRowFrom({
    invitationId: "inv-p", kind: "business", channel: "phone", email: "", fullName: "Amina Barry",
    phoneMasked: "+224 ••••56", phoneLastTwo: "56", inviteLink: LINK, whatsappStatus: "template_pending",
    inventoryStoreAccess: { allStores: false, homeStoreId: "s2" }, status: "pending", businessPermissions: ["inventory"],
    sentAtMs: 1, expiresAtMs: 2, ...overrides,
  });
  assert.ok(row);
  return row;
}

test("a phone row reads its masked number, link, WhatsApp status and store", () => {
  const row = phoneRow();
  assert.equal(row.channel, "phone");
  assert.equal(row.phoneMasked, "+224 ••••56");
  assert.equal(row.phoneLastTwo, "56");
  assert.equal(row.inviteLink, LINK);
  assert.equal(row.whatsappStatus, "template_pending");
  assert.deepEqual(row.inventoryStoreAccess, { allStores: false, homeStoreId: "s2" });
  // An email row (or a row without a channel) carries none of it.
  const email = accessInvitationRowFrom({ invitationId: "inv-e", email: "a@b.co", inviteLink: LINK, phoneMasked: "x" });
  assert.ok(email);
  assert.equal(email.channel, "email");
  assert.equal(email.inviteLink, "");
  assert.equal(email.phoneMasked, "");
  assert.equal(email.inventoryStoreAccess, null);
});

test("a phone row shows its name and masked number, never 'undefined' or an empty email", () => {
  const row = phoneRow();
  assert.equal(accessInvitationTitle(row), "Amina Barry");
  assert.equal(accessInvitationContact(row), "+224 ••••56");
  const nameless = phoneRow({ fullName: "", phoneMasked: "" });
  assert.equal(accessInvitationTitle(nameless), "••56");
  assert.doesNotMatch(accessInvitationTitle(phoneRow({ fullName: undefined })), /undefined/);
  // The email delivery note never speaks for a WhatsApp invitation.
  assert.equal(accessInvitationDeliveryNote(phoneRow({ emailProvider: "smtpBroken" })), "");
});

test("the 'not sent yet' note shows until WhatsApp says sent, and only while the row can act", () => {
  assert.equal(accessInvitationNeedsSharing(phoneRow()), true);
  assert.equal(accessInvitationNeedsSharing(phoneRow({ whatsappStatus: "" })), true);
  assert.equal(accessInvitationNeedsSharing(phoneRow({ whatsappStatus: "sent" })), false);
  assert.equal(accessInvitationNeedsSharing(phoneRow({ status: "cancelled" })), false);
  assert.equal(accessInvitationNeedsSharing(phoneRow({ inviteLink: "" })), false);
});

test("confirmations name a phone invitation by its masked number in both languages", () => {
  const phone = accessInvitationConfirmations(phoneRow());
  assert.match(phone.resend.confirm, /\+224 ••••56/);
  assert.match(phone.resend.confirmFr, /\+224 ••••56/);
  assert.match(phone.cancel.confirm, /\+224 ••••56/);
  assert.match(phone.cancel.confirmFr, /\+224 ••••56/);
  const email = accessInvitationConfirmations(accessInvitationRowFrom({ invitationId: "e", email: "a@b.co" })!);
  assert.match(email.resend.confirm, /a@b\.co/);
  assert.match(email.cancel.confirmFr, /a@b\.co/);
});

// ---------------------------------------------------------------------------
// The invitation page (/j/<token>)
// ---------------------------------------------------------------------------

test("/j/<token> is a staff invitation, as a path or in its rewritten query form", () => {
  assert.equal(customerServiceFromLocation(`/j/${TOKEN}`, ""), "staff-invite");
  assert.equal(customerServiceFromLocation(`/j/${TOKEN}/`, ""), "staff-invite");
  assert.equal(customerServiceFromLocation("/", `?service=staff-invite&j=${TOKEN}`), "staff-invite");
  assert.equal(customerServiceFromLocation("/j/short", ""), null);
  assert.equal(staffInviteTokenFromLocation(`/j/${TOKEN}`, ""), TOKEN);
  assert.equal(staffInviteTokenFromLocation("/", `?service=staff-invite&j=${TOKEN}`), TOKEN);
  assert.equal(staffInviteTokenFromLocation("/", "?j=bad"), "");
  assert.equal(staffInvitePathRedirect(`/j/${TOKEN}`), `/?service=staff-invite&j=${TOKEN}`);
  assert.equal(staffInvitePathRedirect("/nothing"), "");
});

test("the preview is read defensively: two digits of the number at most", () => {
  const preview = parseStaffInvitePreview({
    invitationId: "i1", status: "pending", businessId: "b", businessName: "Atlantic", invitedByName: "Abdoullaye",
    fullName: "Amina", phoneLastTwo: "56", expiresAtMs: 1_800_000_000_000, phoneE164: "+224622123456",
  });
  assert.equal(preview.phoneLastTwo, "56");
  assert.equal("phoneE164" in preview, false);
  assert.equal(parseStaffInvitePreview({ invitationId: "i", status: "weird", phoneLastTwo: "123" }).status, "pending");
  assert.equal(parseStaffInvitePreview({ invitationId: "i", phoneLastTwo: "123" }).phoneLastTwo, "");
  assert.throws(() => parseStaffInvitePreview({}), /staff-invite-preview-invalid/);
});

const PREVIEW: StaffInvitePreview = {
  invitationId: "i1", status: "pending", businessId: "b", businessName: "Atlantic", invitedByName: "Abdoullaye",
  fullName: "Amina", phoneLastTwo: "35", expiresAtMs: 0,
};

test("the page: sign in with the invited number, accept with it, or sign out first", () => {
  assert.deepEqual(staffInviteView(PREVIEW, null), { kind: "sign-in" });
  assert.deepEqual(staffInviteView(PREVIEW, { signedIn: false, phoneNumber: "" }), { kind: "sign-in" });
  assert.deepEqual(staffInviteView(PREVIEW, { signedIn: true, phoneNumber: "+224622123435" }), { kind: "accept" });
  assert.deepEqual(staffInviteView(PREVIEW, { signedIn: true, phoneNumber: "+224622123456" }), { kind: "other-account" });
  // An email account has no number: another account.
  assert.deepEqual(staffInviteView(PREVIEW, { signedIn: true, phoneNumber: "" }), { kind: "other-account" });
  for (const status of ["expired", "cancelled", "accepted"] as const) {
    assert.deepEqual(staffInviteView({ ...PREVIEW, status }, null), { kind: "closed", status });
    assert.deepEqual(staffInviteView({ ...PREVIEW, status }, { signedIn: true, phoneNumber: "+224622123435" }), { kind: "closed", status });
  }
  assert.equal(numberEndsWith("+1 (201) 555-0135", "35"), true);
  assert.equal(numberEndsWith("35", "35"), false, "a full number, not two digits");
  assert.equal(numberEndsWith("+224622123435", ""), false);
});

test("accept refusals and the link's own refusal read as plain messages", () => {
  for (const [reason, copy] of Object.entries(ACCEPT_REFUSAL_COPY)) {
    assert.equal(acceptRefusalMessage({ details: { reason }, message: "Server English" }), copy);
  }
  assert.equal(acceptRefusalMessage(new Error("x")), ACCEPT_FALLBACK);
  const linkGone = phoneRefusalText(phoneRefusalOf({ details: { reason: "invite_not_found" } }));
  assert.equal(linkGone.message, PHONE_REFUSAL_COPY.invite_not_found);
});

// ---------------------------------------------------------------------------
// French
// ---------------------------------------------------------------------------

function missingFrench(strings: readonly string[]): string[] {
  return strings.filter((english) => !(english in TEXT_TRANSLATIONS) && !(english in ATTRIBUTE_TRANSLATIONS));
}

const COPY_STRINGS = [
  ...Object.values(INVITE_METHOD_LABELS),
  ...Object.values(STAFF_INVITE_PROBLEMS),
  ...Object.values(STAFF_INVITE_COPY),
  ...Object.values(STAFF_INVITE_REFUSAL_COPY),
  STAFF_INVITE_FALLBACK,
  ...Object.values(STAFF_INVITE_PAGE_COPY),
  ...Object.values(STAFF_INVITE_CLOSED_COPY),
  ...Object.values(ACCEPT_REFUSAL_COPY),
  ACCEPT_FALLBACK,
  PHONE_REFUSAL_COPY.invite_not_found,
  ...Object.values(PENDING_INVITE_COPY),
  PLATFORM_INVITATION_NAME,
  "A Laawol business",
];

test("every sentence the staff invitation modules build has its French, and it converges", () => {
  assert.deepEqual(missingFrench(COPY_STRINGS), []);
  for (const english of COPY_STRINGS) {
    const french = translateValue(english, "fr");
    // "Email" is spelled the same in the console's French.
    if (english !== "Email") assert.notEqual(french, english, english);
    assert.equal(translateValue(french, "fr"), french, `${english} converges`);
  }
  // Staff is "membre de l'équipe" in French.
  assert.match(translateValue(STAFF_INVITE_PAGE_COPY.onLaawolAsStaff, "fr"), /membre de l’équipe/);
  assert.match(translateValue(STAFF_INVITE_PAGE_COPY.title, "fr"), /membre de l’équipe/);
});

for (const [name, path] of [
  ["the invitation page", "../components/staff-invite-page.tsx"],
  ["the invite fields", "../components/staff-invite-fields.tsx"],
  ["the Join prompt", "../components/pending-invitations-prompt.tsx"],
] as const) {
  test(`every sentence on ${name} has its French`, () => {
    const strings = screenStrings(read(path), path);
    assert.ok(strings.length >= 1 || path.endsWith("pending-invitations-prompt.tsx"), "the scan found nothing to check");
    assert.deepEqual(missingFrench(strings), []);
  });
}

test("the strings the People panels gained for phone invitations have their French", () => {
  const strings = [
    // profile-support-people.tsx
    "By phone, the person gets a WhatsApp message with an Accept button and signs in with a code sent to that number - no password. By email, they set their own password from an expiring email invitation.",
    "WhatsApp number", "Which store?", "All stores", "By WhatsApp", "Store",
    "Invitations sent — waiting for the person to accept",
    // admin-console.tsx
    "Business staff accept by phone with a WhatsApp code, or by email with their own password. Platform admins use email.",
    "No password is needed. The person gets a WhatsApp message with an Accept button and signs in with a code sent to that number. The invitation expires and access remains inactive until it is accepted.",
    "No password is needed. The person gets a WhatsApp message with an Accept button and signs in with a code sent to that number.",
    "Invited by WhatsApp: the person signs in with a code sent to their number.",
    "Enter the person's WhatsApp number with its country code.",
    "Done",
  ];
  assert.deepEqual(missingFrench(strings), []);
  const sources = [read("../components/business/profile-support-people.tsx"), read("../components/admin-console.tsx")]
    .join("\n").replace(/\s+/g, " ");
  for (const english of strings) assert.ok(sources.includes(english), `${english} is on a screen`);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test("the router shows the invitation page for every console, and cuts a removed person's session", () => {
  const router = read("../components/console-router.tsx");
  assert.match(router, /if \(serviceIntent === "staff-invite"\) \{\s*return <StaffInvitePage firebaseUser=\{firebaseUser\} \/>;/);
  assert.ok(router.indexOf('serviceIntent === "staff-invite"') < router.indexOf("if (booting)"));
  // The live profile follower: losing access forces a refresh, and a failed
  // refresh (revoked tokens) signs out.
  assert.match(router, /consoleAccessLost\(lastLive, next\)/);
  assert.match(router, /user\.getIdToken\(true\)\s*\.catch\(\(\) => signOut\(auth\)/);
  assert.match(router, /if \(!live\.exists\(\)\) \{\s*cutIfAccessLost\(null\);/);
});

test("the page signs in with the masked invitation flow, then accepts by token and leaves for the console", () => {
  const page = read("../components/staff-invite-page.tsx");
  assert.match(page, /hint=\{\{ inviteToken: token, lastTwo \}\}/);
  assert.match(page, /onSignedIn=\{\(\) => void accept\(\)\}/);
  assert.match(page, /await withTimeout\(user\.getIdToken\(true\)/);
  assert.match(page, /window\.location\.replace\("\/"\)/);
  assert.match(page, /if \(busyRef\.current\) return;/);
  const client = read("./phone-accounts-client.ts");
  assert.match(client, /callPhoneAccount\("staffInvite", \{ token \}\)/);
  assert.match(client, /httpsCallable\(functions, "acceptAccessInvitation", \{ timeout: CALL_TIMEOUT_MS \}\)/);
  assert.match(client, /await call\(\{ inviteToken \}\)/);
  const signIn = read("../components/phone-sign-in.tsx");
  assert.match(signIn, /"inviteToken" in hint\s*\? \{ inviteToken: hint\.inviteToken \}/);
});

test("the not-found page forwards /j/<token> like the request links", () => {
  assert.match(read("../app/not-found.tsx"), /staffInvitePathRedirect\(window\.location\.pathname\)/);
});

test("every invite form sends the phone method and maps refusals by reason", () => {
  const people = read("../components/business/profile-support-people.tsx");
  assert.match(people, /staffInvitePayload\(draft, \{/);
  assert.match(people, /throw new Error\(inviteRefusalMessage\(submitError\)\)/);
  assert.match(people, /<InviteMethodSwitch/);
  assert.match(people, /<CustomerPhoneField/);
  assert.doesNotMatch(people, /function inviteStaffErrorMessage/);
  const admin = read("../components/admin-console.tsx");
  assert.ok((admin.match(/<InviteMethodSwitch/g) ?? []).length >= 2, "both admin invite forms offer the phone");
  assert.match(admin, /STAFF_INVITE_REFUSAL_COPY\[reason\]/);
  // Platform admins stay email-only.
  assert.match(admin, /const byPhone = personType === "businessPerson" && method === "phone";/);
});

// ---------------------------------------------------------------------------
// "Join <business>" after a normal sign-in (contract §4.1)
// ---------------------------------------------------------------------------

test("the waiting invitations are read defensively, once each", () => {
  const rows = parsePendingInvitations({
    invitations: [
      { invitationId: "a", kind: "business", channel: "phone", businessId: "b1", businessName: "Atlantic", invitedByName: "Abdoullaye", expiresAtMs: 5, phoneE164: "+224622123456" },
      { invitationId: "a", kind: "business" },
      { invitationId: "p", kind: "platform", channel: "email", expiresAtMs: -1 },
      { kind: "business" },
      "junk",
    ],
  });
  assert.deepEqual(rows.map((row) => row.invitationId), ["a", "p"]);
  assert.equal(rows[0].channel, "phone");
  assert.equal("phoneE164" in rows[0], false);
  assert.equal(rows[1].kind, "platform");
  assert.equal(rows[1].expiresAtMs, 0);
  assert.deepEqual(parsePendingInvitations(null), []);
  assert.deepEqual(parsePendingInvitations({ invitations: "x" }), []);
});

test("a prompt names the business as typed, a platform invitation in console words", () => {
  const [business, platform, nameless] = parsePendingInvitations({
    invitations: [
      { invitationId: "a", kind: "business", businessName: "Atlantic" },
      { invitationId: "p", kind: "platform", businessName: "ignored" },
      { invitationId: "n", kind: "business" },
    ],
  });
  assert.deepEqual(pendingInvitationTarget(business), { name: "Atlantic", userData: true });
  assert.deepEqual(pendingInvitationTarget(platform), { name: PLATFORM_INVITATION_NAME, userData: false });
  assert.deepEqual(pendingInvitationTarget(nameless), { name: "A Laawol business", userData: false });
});

test("'Not now' hides one invitation for this account until the next sign-in", () => {
  const rows = parsePendingInvitations({ invitations: [{ invitationId: "a" }, { invitationId: "b" }] });
  const dismissed = withDismissedInvitation([], "a");
  assert.deepEqual(withDismissedInvitation(dismissed, "a"), ["a"]);
  assert.deepEqual(visiblePendingInvitations(rows, dismissed).map((row) => row.invitationId), ["b"]);
  assert.deepEqual(readDismissedInvitations(JSON.stringify(dismissed)), ["a"]);
  for (const junk of [null, undefined, "", "{", "42", JSON.stringify([1, "", "ok"])]) {
    assert.ok(Array.isArray(readDismissedInvitations(junk)));
  }
  assert.deepEqual(readDismissedInvitations(JSON.stringify([1, "", "ok"])), ["ok"]);
  assert.notEqual(dismissedInvitationsKey("u1"), dismissedInvitationsKey("u2"));
});

test("the customer console lists, joins and dismisses with progress and storage guarded", () => {
  const prompt = read("../components/pending-invitations-prompt.tsx");
  assert.match(prompt, /if \(joiningRef\.current\) return;/);
  assert.match(prompt, /window\.location\.replace\("\/"\)/);
  assert.match(prompt, /getIdToken\(true\)/);
  assert.match(prompt, /try \{\s*return readDismissedInvitations\(window\.sessionStorage/);
  assert.match(prompt, /try \{\s*window\.sessionStorage\.setItem/);
  const client = read("./phone-accounts-client.ts");
  assert.match(client, /call\(\{ action: "pending" \}\)/);
  assert.match(client, /await call\(\{ invitationId \}\)/);
  assert.match(read("../components/customer-console.tsx"), /<PendingInvitationsPrompt uid=\{firebaseUser\.uid\} \/>/);
});
