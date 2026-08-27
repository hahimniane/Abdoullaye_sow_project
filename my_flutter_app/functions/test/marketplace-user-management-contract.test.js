const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const functionsSource = fs.readFileSync(
    path.join(__dirname, "..", "index.js"),
    "utf8",
);
const rulesSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "firestore.rules"),
    "utf8",
);
const indexes = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "..", "firestore.indexes.json"),
    "utf8",
));

function exportedCallable(name, nextName) {
  const start = functionsSource.indexOf(`exports.${name} = onCall`);
  assert.notEqual(start, -1, `${name} must be exported`);
  const end = nextName ?
    functionsSource.indexOf(`exports.${nextName} = onCall`, start + 1) :
    functionsSource.indexOf("\nexports.", start + 1);
  return functionsSource.slice(start, end === -1 ? undefined : end);
}

function sourceBetween(startMarker, endMarker) {
  const start = functionsSource.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} must exist`);
  const end = functionsSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${endMarker} must follow ${startMarker}`);
  return functionsSource.slice(start, end);
}

describe("marketplace people backend contract", () => {
  it("uses shared public transport options for every access callable", () => {
    const options = sourceBetween(
        "const MARKETPLACE_PEOPLE_CALLABLE_OPTIONS",
        "const DEFAULT_BUSINESS_ID",
    );
    assert.match(options, /invoker:\s*"public"/);
    assert.match(options, /enforceAppCheck:\s*ENFORCE_APP_CHECK/);
    assert.match(options, /cors:\s*true/);

    for (const name of [
      "listMarketplacePeople",
      "getMarketplacePerson",
      "setMarketplaceUserStatus",
      "revokeUserSessions",
      "sendUserRecoveryEmail",
      "invitePlatformAdmin",
      "inviteBusinessMember",
      "resendAccessInvitation",
      "cancelAccessInvitation",
      "acceptAccessInvitation",
      "transferBusinessOwnership",
      "reviewAccountDeletion",
      "finalizeAccountDeletion",
      "listPlatformUsers",
      "createMissingUserProfile",
      "updateBusinessMembership",
      "updateUserRole",
      "setPlatformAdminRole",
      "deleteUser",
    ]) {
      const callable = exportedCallable(name);
      assert.match(
          callable.slice(0, 220),
          /onCall\(\s*MARKETPLACE_PEOPLE_CALLABLE_OPTIONS,/,
          `${name} must allow public HTTP transport through shared options`,
      );
    }
  });

  it("exports every independent lifecycle operation", () => {
    for (const name of [
      "listMarketplacePeople",
      "getMarketplacePerson",
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
      assert.match(functionsSource, new RegExp(`exports\\.${name} = onCall`));
    }
  });

  it("returns a redacted, categorized, paginated directory DTO", () => {
    const source = sourceBetween(
        "async function listMarketplacePeopleHandler",
        "async function getMarketplacePersonHandler",
    );
    assert.match(source, /pageToken/);
    assert.match(source, /maxResults|pageSize/);
    assert.match(source, /nextPageToken|pageToken/);
    for (const categoryField of [
      "category",
      "role",
      "adminRole",
      "businessId",
      "businessPermissions",
      "hasProfile",
      "hasAuth",
    ]) {
      assert.match(functionsSource, new RegExp(categoryField));
    }
    for (const category of [
      "platform",
      "business",
      "customer",
      "invitation",
      "missing_profile",
    ]) {
      assert.match(functionsSource, new RegExp(`"${category}"`));
    }
    assert.match(source, /accessInvitations/);
    for (const secret of [
      "passwordHash",
      "passwordSalt",
      "customClaims",
      "tokensValidAfterTime",
      "providerData",
    ]) {
      assert.doesNotMatch(source, new RegExp(`${secret}\\s*:`));
    }
  });

  it("guards status, session, recovery, and invitation transitions", () => {
    const status = sourceBetween(
        "async function setMarketplaceUserStatusHandler",
        "async function revokeUserSessionsHandler",
    );
    assert.match(status, /suspend/);
    assert.match(status, /restore/);
    assert.match(status, /updateUser/);
    assert.match(status, /disabled/);
    assert.match(status, /accountStatus/);
    assert.match(status, /runTransaction|batch\(/);
    assert.match(status, /callerUid|request\.auth\.uid/);
    assert.match(status, /assertCanManageTarget/);

    const revoke = sourceBetween(
        "async function revokeUserSessionsHandler",
        "exports.listMarketplacePeople",
    );
    assert.match(revoke, /revokeRefreshTokens/);

    const recovery = sourceBetween(
        "async function sendUserRecoveryEmailHandler",
        "async function createAccessInvitation",
    );
    assert.match(recovery, /password_reset/);
    assert.match(recovery, /verify_email/);
    assert.match(recovery, /authActionLinks/);
    assert.match(functionsSource, /generatePasswordResetLink/);
    assert.match(functionsSource, /generateEmailVerificationLink/);

    const invite = sourceBetween(
        "async function createAccessInvitation",
        "async function resendAccessInvitationHandler",
    );
    assert.match(invite, /accessInvitations/);
    assert.match(invite, /pending/);
    assert.match(invite, /expiresAt/);
    const invitationLifecycle = sourceBetween(
        "async function resendAccessInvitationHandler",
        "exports.sendUserRecoveryEmail",
    );
    assert.match(invitationLifecycle, /cancelled/);
    assert.match(invitationLifecycle, /accepted/);
    assert.match(invitationLifecycle, /expired/);
  });

  it("fails closed unless an invitation email is queued or sent", () => {
    const delivery = sourceBetween(
        "async function queueAccessEmail",
        "async function sendUserRecoveryEmailHandler",
    );
    assert.match(delivery, /sendFirebasePasswordSetupEmail/);
    assert.match(delivery, /deliveryStatus = "sent"/);
    assert.match(delivery, /deliveryStatus = "failed"/);
    assert.match(delivery, /if \(fallbackError\)/);
    assert.match(delivery, /invitation-email-delivery-failed/);
    assert.match(
        delivery,
        /emailSent:\s*deliveryStatus === "queued" \|\|[\s\S]*"sent"/,
    );

    const invitation = sourceBetween(
        "async function createAccessInvitation",
        "async function invitationForManagement",
    );
    assert.match(invitation, /const delivery = await queueAccessEmail/);
    assert.match(invitation, /\.\.\.delivery/);
  });

  it("auto-resolves one active invitation and rejects ambiguity", () => {
    const resolver = sourceBetween(
        "async function invitationRefForAcceptance",
        "async function acceptAccessInvitationHandler",
    );
    assert.match(resolver, /targetUid/);
    assert.match(resolver, /email/);
    assert.match(resolver, /pending/);
    assert.match(resolver, /expiresAt/);
    assert.match(resolver, /\.limit\(2\)/);
    assert.match(resolver, /invitation-selection-required/);
    assert.match(
        sourceBetween(
            "async function acceptAccessInvitationHandler",
            "exports.sendUserRecoveryEmail",
        ),
        /requestedInvitationId/,
    );

    const invitationIndex = indexes.indexes.find(
        (index) => index.collectionGroup === "accessInvitations",
    );
    assert.ok(invitationIndex, "access invitation lookup needs an index");
    assert.deepEqual(
        invitationIndex.fields.map((field) => field.fieldPath),
        ["targetUid", "email", "status", "expiresAt"],
    );
  });

  it("protects irreplaceable administrators and business owners", () => {
    assert.match(functionsSource, /assertSuperAdminContinuity/);
    assert.match(functionsSource, /last-super-admin/);
    assert.match(functionsSource, /self-access-change-not-allowed/);

    assert.match(functionsSource, /ownership-transfer-required/);
    assert.match(functionsSource, /ownerUid/);
  });

  it("blocks destructive deletion while active money or work exists", () => {
    const source = sourceBetween(
        "const USER_DELETION_DEPENDENCIES",
        "exports.deleteUser",
    );
    for (const dependency of [
      "barrelShipments",
      "freightShipments",
      "transportRequests",
      "parkedCars",
      "carPurchases",
      "barrelPoolBalanceRequests",
      "supportCases",
    ]) {
      assert.match(source, new RegExp(dependency));
    }
    assert.match(source, /failed-precondition/);
    assert.match(source, /deletedUserTombstones/);
  });

  it("no longer blocks deletion on the retired wallet", () => {
    // The wallet is removed (docs/PLAN-2026-08-backlog.md #3) and the stored
    // balances are test data, so a leftover balance or refund request must
    // not stand between an admin and a deletion they have decided on.
    const source = sourceBetween(
        "const USER_DELETION_DEPENDENCIES",
        "exports.deleteUser",
    );
    assert.doesNotMatch(source, /walletRefundRequests/);
    assert.doesNotMatch(source, /wallet-balance-must-be-resolved/);
    assert.doesNotMatch(source, /collection\("wallets"\)/);
  });

  it("makes missing-profile repair create-only", () => {
    const source = exportedCallable(
        "createMissingUserProfile",
        "updateBusinessMembership",
    );
    assert.match(source, /userRef|getStoredUserProfile|collection\("users"\)/);
    assert.match(source, /\.exists/);
    assert.match(source, /already-exists|failed-precondition/);
    assert.doesNotMatch(source, /\{merge:\s*true\}/);
  });

  it("scrubs stale role fields and transfers ownerUid atomically", () => {
    const membership = sourceBetween(
        "async function updateBusinessMembershipHandler",
        "exports.updateBusinessMembership",
    );
    assert.match(membership, /nonBusinessAuthorityCleanup/);
    assert.match(membership, /nonAdminAuthorityCleanup/);
    const cleanup = sourceBetween(
        "function nonBusinessAuthorityCleanup",
        "async function updateBusinessMembershipHandler",
    );
    for (const field of [
      "adminRole",
      "platformAdmin",
      "businessId",
      "businessName",
      "businessServices",
      "businessPermissions",
    ]) {
      assert.match(cleanup, new RegExp(field));
    }
    assert.match(cleanup, /FirestoreFieldValue\.delete/);

    assert.match(membership, /runTransaction/);
    assert.match(membership, /ownerUid/);
    assert.match(membership, /businessOwner/);
    assert.match(membership, /staff/);
    assert.match(membership, /businessPermissions/);
    assert.match(
        exportedCallable("transferBusinessOwnership"),
        /updateBusinessMembershipHandler\(request,\s*"businessOwner"\)/,
    );
  });

  it("keeps dynamic role and business permissions fail closed in rules", () => {
    const dynamicRoleGate =
      /userAdminRole\(userId\) in get\([\s\S]*?\.data\.roles/;
    const businessGate =
      /userBusinessId\(userId\) == businessId[\s\S]*businessPermissions/;
    assert.match(
        rulesSource,
        dynamicRoleGate,
    );
    assert.match(
        rulesSource,
        /sections\[section\] == 'manage'/,
    );
    assert.match(
        rulesSource,
        businessGate,
    );
    assert.match(rulesSource, /section in userProfile\(userId\)\.get\(/);
  });
});
