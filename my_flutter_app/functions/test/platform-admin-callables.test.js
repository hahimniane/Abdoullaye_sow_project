const assert = require("node:assert/strict");
const {before, test} = require("node:test");
const admin = require("firebase-admin");

const functions = require("../index");
// This suite writes with ADMIN credentials. Without the emulator env
// those writes land in PRODUCTION - on 2026-08-16 a direct `node
// --test` run did exactly that, seeding 68 approved fixture
// businesses that real customers could see. Fail closed instead.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:platform-admin` " +
      "(firebase emulators:exec). " +
      "A direct node --test run would write its fixtures into the " +
      "real project.");
}

const auth = admin.auth();
const db = admin.firestore();

const SUPER_ADMIN_UID = "platform-admin-callables-super";
const LEGACY_ADMIN_UID = "platform-admin-callables-legacy";
const DEMOTE_ADMIN_UID = "platform-admin-callables-demote";
const CUSTOMER_UID = "platform-admin-callables-customer";
const OWNER_A_UID = "platform-admin-callables-owner-a";
const OWNER_B_UID = "platform-admin-callables-owner-b";
const AUTO_INVITE_UID = "platform-admin-callables-auto-invite";
const EXPLICIT_INVITE_UID = "platform-admin-callables-explicit-invite";
const AMBIGUOUS_INVITE_UID = "platform-admin-callables-ambiguous-invite";
const BUSINESS_ID = "platform-admin-callables-business";

before(async () => {
  await Promise.all([
    auth.createUser({
      uid: SUPER_ADMIN_UID,
      email: "platform-admin-super@example.test",
      password: "PlatformAdmin-2026!",
      emailVerified: true,
    }),
    auth.createUser({
      uid: LEGACY_ADMIN_UID,
      email: "platform-admin-legacy@example.test",
      password: "PlatformLegacy-2026!",
      emailVerified: false,
    }),
    auth.createUser({
      uid: DEMOTE_ADMIN_UID,
      email: "platform-admin-demote@example.test",
      password: "PlatformDemote-2026!",
      emailVerified: true,
    }),
    auth.createUser({
      uid: CUSTOMER_UID,
      email: "platform-admin-customer@example.test",
      password: "PlatformCustomer-2026!",
      emailVerified: true,
    }),
    auth.createUser({
      uid: OWNER_A_UID,
      email: "platform-owner-a@example.test",
      password: "PlatformOwnerA-2026!",
      emailVerified: true,
    }),
    auth.createUser({
      uid: OWNER_B_UID,
      email: "platform-owner-b@example.test",
      password: "PlatformOwnerB-2026!",
      emailVerified: true,
    }),
    auth.createUser({
      uid: AUTO_INVITE_UID,
      email: "platform-auto-invite@example.test",
      password: "PlatformAutoInvite-2026!",
      emailVerified: true,
    }),
    auth.createUser({
      uid: EXPLICIT_INVITE_UID,
      email: "platform-explicit-invite@example.test",
      password: "PlatformExplicitInvite-2026!",
      emailVerified: true,
    }),
    auth.createUser({
      uid: AMBIGUOUS_INVITE_UID,
      email: "platform-ambiguous-invite@example.test",
      password: "PlatformAmbiguousInvite-2026!",
      emailVerified: true,
    }),
    db.collection("users").doc(SUPER_ADMIN_UID).set({
      role: "admin",
      platformAdmin: true,
      adminRole: "superAdmin",
      fullName: "Platform Admin Test Super",
      email: "platform-admin-super@example.test",
    }),
    db.collection("users").doc(LEGACY_ADMIN_UID).set({
      role: "admin",
      platformAdmin: true,
      adminRole: "supportAdmin",
      fullName: "Platform Admin Test Legacy",
      email: "platform-admin-legacy@example.test",
    }),
    db.collection("users").doc(DEMOTE_ADMIN_UID).set({
      role: "admin",
      platformAdmin: true,
      adminRole: "supportAdmin",
      businessId: "legacy-business",
      businessName: "Legacy Business",
      businessServices: ["freight"],
      fullName: "Platform Admin Test Demotion",
      email: "platform-admin-demote@example.test",
    }),
    db.collection("users").doc(CUSTOMER_UID).set({
      role: "customer",
      fullName: "Platform Customer",
      email: "platform-admin-customer@example.test",
    }),
    db.collection("users").doc(OWNER_A_UID).set({
      role: "businessOwner",
      businessId: BUSINESS_ID,
      businessName: "Platform Ownership Test",
      fullName: "Platform Owner A",
      email: "platform-owner-a@example.test",
    }),
    db.collection("users").doc(OWNER_B_UID).set({
      role: "customer",
      fullName: "Platform Owner B",
      email: "platform-owner-b@example.test",
    }),
    db.collection("businesses").doc(BUSINESS_ID).set({
      name: "Platform Ownership Test",
      ownerUid: OWNER_A_UID,
      enabledServices: ["freight"],
      status: "approved",
    }),
  ]);
});

test("trusted super-admin provisioning creates a usable verified manager",
    async () => {
      const result = await functions.createPlatformManager.run({
        auth: {uid: SUPER_ADMIN_UID},
        data: {
          fullName: "Platform Admin Test Manager",
          email: "platform-admin-manager@example.test",
          phone: "+17185550991",
          password: "PlatformManager-2026!",
          adminRole: "operationsManager",
        },
      });

      const [managerAuth, managerProfile] = await Promise.all([
        auth.getUser(result.uid),
        db.collection("users").doc(result.uid).get(),
      ]);
      assert.equal(managerAuth.emailVerified, true);
      assert.equal(managerProfile.get("role"), "admin");
      assert.equal(managerProfile.get("adminRole"), "operationsManager");

      const business = await functions.createAdminBusiness.run({
        auth: {uid: result.uid},
        data: {
          businessId: "platform-admin-manager-business",
          name: "Platform Admin Manager Business",
          status: "pending",
          enabledServices: ["freight"],
          addressLine1: "12 Kaloum Street",
          city: "Conakry",
          country: "Guinea",
        },
      });
      assert.equal(business.success, true);

      await assert.rejects(
          () => functions.createAdminBusiness.run({
            auth: {uid: result.uid},
            data: {
              businessId: "platform-admin-empty-street",
              name: "Empty Street Business",
              status: "pending",
              enabledServices: ["freight"],
              city: "Conakry",
              country: "Guinea",
            },
          }),
          /street address is required/,
      );
    });

test("a super admin can repair an unverified target without authorizing it",
    async () => {
      const result = await functions.setPlatformAdminRole.run({
        auth: {uid: SUPER_ADMIN_UID},
        data: {
          userId: LEGACY_ADMIN_UID,
          adminRole: "financeManager",
        },
      });
      assert.equal(result.success, true);
      const target = await db.collection("users").doc(LEGACY_ADMIN_UID).get();
      assert.equal(target.get("adminRole"), "financeManager");

      await assert.rejects(
          () => functions.createAdminBusiness.run({
            auth: {uid: LEGACY_ADMIN_UID},
            data: {
              businessId: "unverified-admin-business",
              name: "Unverified Admin Business",
              status: "pending",
              enabledServices: ["freight"],
            },
          }),
          /Verify your administrator email/,
      );
    });

test("demotion preserves the account, removes access, and records an audit",
    async () => {
      const result = await functions.updateUserRole.run({
        auth: {uid: SUPER_ADMIN_UID},
        data: {
          userId: DEMOTE_ADMIN_UID,
          newRole: "customer",
        },
      });
      assert.equal(result.success, true);

      const [targetAuth, targetProfile, auditSnapshot] = await Promise.all([
        auth.getUser(DEMOTE_ADMIN_UID),
        db.collection("users").doc(DEMOTE_ADMIN_UID).get(),
        db.collection("adminAuditLogs")
            .where("targetId", "==", DEMOTE_ADMIN_UID)
            .get(),
      ]);
      assert.equal(targetAuth.uid, DEMOTE_ADMIN_UID);
      assert.equal(targetProfile.exists, true);
      assert.equal(targetProfile.get("role"), "customer");
      for (const field of [
        "adminRole",
        "platformAdmin",
        "businessId",
        "businessName",
        "businessServices",
      ]) {
        assert.equal(targetProfile.get(field), undefined, field);
      }
      const audit = auditSnapshot.docs.find(
          (doc) => doc.get("action") === "user_role_updated",
      );
      assert.ok(audit);
      assert.equal(audit.get("previousValue"), "admin");
      assert.equal(audit.get("nextValue"), "customer");

      await assert.rejects(
          () => functions.updateUserRole.run({
            auth: {uid: SUPER_ADMIN_UID},
            data: {
              userId: SUPER_ADMIN_UID,
              newRole: "customer",
            },
          }),
          /cannot change your own admin role/i,
      );
      const caller = await db.collection("users").doc(SUPER_ADMIN_UID).get();
      assert.equal(caller.get("role"), "admin");

      await assert.rejects(
          () => functions.updateUserRole.run({
            auth: {uid: LEGACY_ADMIN_UID},
            data: {
              userId: DEMOTE_ADMIN_UID,
              newRole: "admin",
            },
          }),
          /Verify your administrator email/,
      );
      const unchanged = await db.collection("users")
          .doc(DEMOTE_ADMIN_UID).get();
      assert.equal(unchanged.get("role"), "customer");
    });

test("people lifecycle is verified, redacted, and reversible", async () => {
  const suspended = await functions.setMarketplaceUserStatus.run({
    auth: {uid: SUPER_ADMIN_UID},
    data: {
      userId: CUSTOMER_UID,
      action: "suspend",
      reason: "Security review",
    },
  });
  assert.equal(suspended.accountStatus, "suspended");
  assert.equal((await auth.getUser(CUSTOMER_UID)).disabled, true);

  const directory = await functions.listMarketplacePeople.run({
    auth: {uid: SUPER_ADMIN_UID},
    data: {search: "platform-admin-customer@example.test"},
  });
  assert.equal(directory.people.length, 1);
  assert.equal(directory.people[0].category, "customer");
  assert.equal(directory.people[0].accountStatus, "suspended");
  assert.equal("notificationPreferences" in directory.people[0], false);

  const restored = await functions.setMarketplaceUserStatus.run({
    auth: {uid: SUPER_ADMIN_UID},
    data: {
      userId: CUSTOMER_UID,
      action: "restore",
      reason: "Review complete",
    },
  });
  assert.equal(restored.accountStatus, "active");
  assert.equal((await auth.getUser(CUSTOMER_UID)).disabled, false);
});

test("missing profile repair refuses to overwrite an existing profile",
    async () => {
      await assert.rejects(
          () => functions.createMissingUserProfile.run({
            auth: {uid: SUPER_ADMIN_UID},
            data: {userId: CUSTOMER_UID},
          }),
          /already exists/i,
      );
      const profile = await db.collection("users").doc(CUSTOMER_UID).get();
      assert.equal(profile.get("role"), "customer");
      assert.equal(profile.get("fullName"), "Platform Customer");
    });

test("ownership transfer updates the owner pointer and both role projections",
    async () => {
      const result = await functions.transferBusinessOwnership.run({
        auth: {uid: SUPER_ADMIN_UID},
        data: {
          userId: OWNER_B_UID,
          businessId: BUSINESS_ID,
        },
      });
      assert.equal(result.role, "businessOwner");

      const [business, oldOwner, newOwner] = await Promise.all([
        db.collection("businesses").doc(BUSINESS_ID).get(),
        db.collection("users").doc(OWNER_A_UID).get(),
        db.collection("users").doc(OWNER_B_UID).get(),
      ]);
      assert.equal(business.get("ownerUid"), OWNER_B_UID);
      assert.equal(oldOwner.get("role"), "staff");
      assert.ok(oldOwner.get("businessPermissions").includes("people"));
      assert.equal(newOwner.get("role"), "businessOwner");
      assert.equal(newOwner.get("businessId"), BUSINESS_ID);
      assert.equal(newOwner.get("businessPermissions"), undefined);
    });

test("accepts the single active invitation without an invitation ID",
    async () => {
      const invitationId = "platform-auto-resolved-invitation";
      await db.collection("accessInvitations").doc(invitationId).set({
        kind: "business",
        targetUid: AUTO_INVITE_UID,
        email: "platform-auto-invite@example.test",
        fullName: "Auto Invite",
        status: "pending",
        businessId: BUSINESS_ID,
        businessName: "Platform Ownership Test",
        businessPermissions: ["freight"],
        expiresAt: admin.firestore.Timestamp.fromMillis(
            Date.now() + 60 * 60 * 1000,
        ),
      });

      const result = await functions.acceptAccessInvitation.run({
        auth: {uid: AUTO_INVITE_UID},
        data: {},
      });
      assert.equal(result.invitationId, invitationId);
      assert.equal(result.status, "accepted");

      const [profile, invitation] = await Promise.all([
        db.collection("users").doc(AUTO_INVITE_UID).get(),
        db.collection("accessInvitations").doc(invitationId).get(),
      ]);
      assert.equal(profile.get("role"), "staff");
      assert.equal(profile.get("businessId"), BUSINESS_ID);
      assert.deepEqual(profile.get("businessPermissions"), ["freight"]);
      assert.equal(invitation.get("status"), "accepted");
    });

test("preserves explicit invitation ID acceptance", async () => {
  const invitationId = "platform-explicit-id-invitation";
  await db.collection("accessInvitations").doc(invitationId).set({
    kind: "platform",
    targetUid: EXPLICIT_INVITE_UID,
    email: "platform-explicit-invite@example.test",
    fullName: "Explicit Invite",
    status: "pending",
    adminRole: "supportAdmin",
    expiresAt: admin.firestore.Timestamp.fromMillis(
        Date.now() + 60 * 60 * 1000,
    ),
  });

  const result = await functions.acceptAccessInvitation.run({
    auth: {uid: EXPLICIT_INVITE_UID},
    data: {invitationId},
  });
  assert.equal(result.invitationId, invitationId);
  const profile = await db.collection("users").doc(EXPLICIT_INVITE_UID).get();
  assert.equal(profile.get("role"), "admin");
  assert.equal(profile.get("adminRole"), "supportAdmin");
});

test("rejects ambiguous implicit invitation acceptance", async () => {
  const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + 60 * 60 * 1000,
  );
  await Promise.all([
    db.collection("accessInvitations").doc("platform-ambiguous-business").set({
      kind: "business",
      targetUid: AMBIGUOUS_INVITE_UID,
      email: "platform-ambiguous-invite@example.test",
      status: "pending",
      businessId: BUSINESS_ID,
      businessPermissions: ["freight"],
      expiresAt,
    }),
    db.collection("accessInvitations").doc("platform-ambiguous-admin").set({
      kind: "platform",
      targetUid: AMBIGUOUS_INVITE_UID,
      email: "platform-ambiguous-invite@example.test",
      status: "pending",
      adminRole: "supportAdmin",
      expiresAt,
    }),
  ]);

  await assert.rejects(
      () => functions.acceptAccessInvitation.run({
        auth: {uid: AMBIGUOUS_INVITE_UID},
        data: {},
      }),
      (error) => {
        assert.equal(
            error.details?.reason,
            "invitation-selection-required",
        );
        return true;
      },
  );
  assert.equal(
      (await db.collection("users").doc(AMBIGUOUS_INVITE_UID).get()).exists,
      false,
  );
});
