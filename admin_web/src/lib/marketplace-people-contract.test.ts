import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { translateValue } from "./french-dom.ts";

const source = readFileSync(
  new URL("../components/admin-console.tsx", import.meta.url),
  "utf8",
);
const businessPeopleSource = readFileSync(
  new URL(
    "../components/business/profile-support-people.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("web people directory uses the sanitized paginated callable", () => {
  assert.match(source, /"listMarketplacePeople"/);
  assert.match(source, /nextPageToken|pageToken/);
  assert.match(source, /Load more people/);
  assert.doesNotMatch(source, /loadEveryAuthPage/);
  assert.match(source, /getMarketplacePerson/);
  assert.doesNotMatch(
    source,
    /collection\(db,\s*"users"\)[\s\S]{0,160}(?:onSnapshot|getDocs)/,
  );
  assert.doesNotMatch(
    source,
    /"users",\s*tabNeeds\([^)]*"people"/,
    "People must not enable the raw users collection listener",
  );
});

test("unverified administrators get a bilingual recovery gate before people data or invitations", () => {
  assert.match(source, /sendEmailVerification/);
  assert.match(source, /user\.reload\(\)/);
  assert.match(source, /getIdToken\(true\)/);
  assert.match(
    source,
    /useAdminAuthUsers\(\s*tabNeeds\("people"\) && adminEmailVerified,\s*\)/,
  );
  assert.match(source, /if \(!adminEmailVerified\)/);
  assert.match(source, /verificationBusy === "sending"/);
  assert.match(source, /verificationBusy === "checking"/);

  for (const label of [
    "Security check required",
    "Verify your admin email to manage people",
    "Send verification email",
    "I verified — check again",
    "People management is locked",
    "Roles & security",
  ]) {
    assert.notEqual(
      translateValue(label, "fr"),
      label,
      `missing French translation for "${label}"`,
    );
  }
});

test("web exposes unified categories and guarded lifecycle actions", () => {
  for (const category of [
    "Platform administrators",
    "Business owners",
    "Business staff",
    "Customers",
    "Pending invitations",
    "Missing profiles",
  ]) {
    assert.match(source, new RegExp(category));
  }

  for (const callable of [
    "setMarketplaceUserStatus",
    "revokeUserSessions",
    "sendUserRecoveryEmail",
    "invitePlatformAdmin",
    "inviteBusinessMember",
    "resendAccessInvitation",
    "cancelAccessInvitation",
    "transferBusinessOwnership",
    "reviewAccountDeletion",
    "finalizeAccountDeletion",
  ]) {
    assert.match(source, new RegExp(`"${callable}"`));
  }
  assert.match(source, /data-loading|disabled=\{[^}]*loading|runAction/);
});

test("web keeps sensitive actions unavailable for self and insufficient access", () => {
  assert.match(source, /currentUserId/);
  assert.match(source, /isCurrentUser/);
  assert.match(source, /canManage/);
  assert.match(source, /businessPermissions/);
  assert.match(source, /businessId/);
  assert.match(source, /last super admin|last business owner/i);
});

test("new user-management copy is bilingual", () => {
  for (const label of [
    "Platform administrators",
    "Business owners",
    "Business staff",
    "Customers",
    "Pending invitations",
    "Missing profiles",
    "Suspend account",
    "Restore account",
    "Revoke sessions",
    "Send password reset",
    "Send verification email",
    "Transfer ownership",
    "Resend invitation",
    "Cancel invitation",
    "Review deletion request",
    "Finalize account deletion",
  ]) {
    assert.notEqual(
      translateValue(label, "fr"),
      label,
      `missing French translation for "${label}"`,
    );
  }
});

test("every web personnel entry point uses invitations, never shared passwords", () => {
  const personnelSources = `${source}\n${businessPeopleSource}`;
  assert.match(businessPeopleSource, /"inviteBusinessMember"/);
  assert.doesNotMatch(personnelSources, /"createStaffUser"/);
  assert.doesNotMatch(personnelSources, /"createPlatformManager"/);
  assert.doesNotMatch(
    businessPeopleSource,
    /Temporary password|Share the temporary password/,
  );
  assert.match(businessPeopleSource, /businessPermissions/);
  assert.match(source, /people-permission-picker/);
  assert.match(source, /locale:\s*currentInterfaceLocale\(\)/);
  assert.match(source, /await refreshPeople\(\)/);
});

test("the preview administrator reports one consistent super-admin role", () => {
  assert.match(
    source,
    /id:\s*"admin-preview"[\s\S]{0,240}adminRole:\s*"superAdmin"/,
  );
});
