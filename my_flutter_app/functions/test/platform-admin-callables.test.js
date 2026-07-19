const assert = require("node:assert/strict");
const {before, test} = require("node:test");
const admin = require("firebase-admin");

const functions = require("../index");
const auth = admin.auth();
const db = admin.firestore();

const SUPER_ADMIN_UID = "platform-admin-callables-super";
const LEGACY_ADMIN_UID = "platform-admin-callables-legacy";
const DEMOTE_ADMIN_UID = "platform-admin-callables-demote";

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
        },
      });
      assert.equal(business.success, true);
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
