const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
  after,
  before,
  beforeEach,
  describe,
  it,
} = require("node:test");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");

const projectId = "demo-laawol-rules";
let testEnv;

function firestoreFor(uid) {
  return uid ?
    testEnv.authenticatedContext(uid).firestore() :
    testEnv.unauthenticatedContext().firestore();
}

function storageFor(uid) {
  return uid ?
    testEnv.authenticatedContext(uid).storage() :
    testEnv.unauthenticatedContext().storage();
}

function storageForToken(uid, token) {
  return testEnv.authenticatedContext(uid, token).storage();
}

function imageBytes(size = 16) {
  return Buffer.alloc(size, 1);
}

function putLogo(storage, businessId, fileName, options = {}) {
  return storage.ref(`businessLogos/${businessId}/${fileName}`).put(
      imageBytes(options.size),
      {contentType: options.contentType || "image/png"},
  );
}

function putBusinessProfileImage(storage, businessId, fileName, options = {}) {
  return storage.ref(`businesses/${businessId}/profile/${fileName}`).put(
      imageBytes(options.size),
      {contentType: options.contentType || "image/jpeg"},
  );
}

function putCarImage(storage, businessId, carId, fileName, options = {}) {
  return storage.ref(`cars/${businessId}/${carId}/${fileName}`).put(
      imageBytes(options.size),
      {contentType: options.contentType || "image/jpeg"},
  );
}

function putLegacyCarImage(storage, carId, fileName, options = {}) {
  return storage.ref(`cars/${carId}/${fileName}`).put(
      imageBytes(options.size),
      {contentType: options.contentType || "image/jpeg"},
  );
}

function putSupportAttachment(storage, caseId, uid, fileName, options = {}) {
  return storage.ref(`support_cases/${caseId}/${uid}/${fileName}`).put(
      imageBytes(options.size),
      {contentType: options.contentType || "application/pdf"},
  );
}

async function seedFirestore() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = db.batch();

    const docs = {
      "platformConfig/permissions": {
        roles: {
          contentManager: {sections: {website: "manage"}},
          financeManager: {sections: {website: "view"}},
        },
      },
      "users/super-admin": {
        role: "admin",
        adminRole: "superAdmin",
        email: "super@example.com",
      },
      "users/platform-admin": {
        role: "admin",
        platformAdmin: true,
        email: "platform@example.com",
      },
      "users/content-admin": {
        role: "admin",
        adminRole: "contentManager",
        email: "content@example.com",
      },
      "users/finance-admin": {
        role: "admin",
        adminRole: "financeManager",
        email: "finance@example.com",
      },
      "users/support-admin": {
        role: "admin",
        adminRole: "supportAdmin",
        email: "support@example.com",
      },
      "users/owner-a": {
        role: "businessOwner",
        businessId: "biz_a",
        businessName: "Business A",
      },
      "users/owner-doconly": {
        role: "businessOwner",
        businessId: "legacy_business_id",
        businessName: "Business Doc Owner",
      },
      "users/staff-listings-a": {
        role: "staff",
        businessId: "biz_a",
        businessName: "Business A",
        businessPermissions: ["listings"],
      },
      "users/staff-barrels-a": {
        role: "staff",
        businessId: "biz_a",
        businessName: "Business A",
        businessPermissions: ["barrels"],
      },
      "users/staff-support-a": {
        role: "staff",
        businessId: "biz_a",
        businessName: "Business A",
        businessPermissions: ["support"],
      },
      "users/customer-owner": {
        role: "customer",
        fullName: "Pool Owner",
      },
      "users/customer-joiner": {
        role: "customer",
        fullName: "Pool Joiner",
      },
      "users/customer-stranger": {
        role: "customer",
        fullName: "Pool Stranger",
      },
      "users/customer-support": {
        role: "customer",
        fullName: "Support Customer",
      },
      "websiteContent/home": {
        hero: {headline: "Trusted business support"},
        featured: {enabled: true, maxToShow: 6},
      },
      "featuredBusinesses/biz_a": {
        businessId: "biz_a",
        displayName: "Business A",
        active: true,
        order: 1,
      },
      "businesses/biz_a": {
        name: "Business A",
        status: "approved",
      },
      "businesses/biz_b": {
        name: "Business B",
        status: "approved",
      },
      "businesses/biz_doc_owner": {
        name: "Business Doc Owner",
        ownerUid: "owner-doconly",
        status: "approved",
      },
      "cars/car_a_1": {
        businessId: "biz_a",
        title: "Car A 1",
        status: "available",
      },
      "cars/car_a_2": {
        businessId: "biz_a",
        title: "Car A 2",
        status: "available",
      },
      "cars/car_b_1": {
        businessId: "biz_b",
        title: "Car B 1",
        status: "available",
      },
      "parkedCars/park_a": {
        businessId: "biz_a",
        customerName: "Customer A",
        parkingStatus: "active",
      },
      "parkedCars/park_b": {
        businessId: "biz_b",
        customerName: "Customer B",
        parkingStatus: "active",
      },
      "businessSupportRequests/support_a": {
        businessId: "biz_a",
        createdBy: "owner-a",
        status: "open",
        subject: "Need help",
      },
      "businessSupportRequests/support_b": {
        businessId: "biz_b",
        createdBy: "other-owner",
        status: "open",
        subject: "Need help",
      },
      "barrelPools/pool_a": {
        businessId: "biz_a",
        businessName: "Business A",
        destinationCountryId: "guinea",
        destinationCountryName: "Guinea",
        createdByUid: "customer-owner",
        totalShares: 2,
        takenShares: 1,
        openShares: 1,
        pricePerShare: 150,
        depositPerShare: 45,
        status: "open",
      },
      "barrelPools/pool_a/participants/customer-owner": {
        uid: "customer-owner",
        role: "owner",
        sharesClaimed: 1,
        senderName: "Owner Sender",
        receiverName: "Owner Receiver",
        receiverPhone: "+15555550100",
      },
      "barrelPools/pool_a/participants/customer-joiner": {
        uid: "customer-joiner",
        role: "joiner",
        sharesClaimed: 1,
        senderName: "Joiner Sender",
        receiverName: "Joiner Receiver",
        receiverPhone: "+15555550101",
      },
      "users/customer-owner/barrelPools/pool_a": {
        poolId: "pool_a",
        businessId: "biz_a",
        destinationCountryName: "Guinea",
        participantRole: "owner",
        participantJoinStatus: "accepted",
        status: "open",
      },
      "users/customer-joiner/barrelPools/pool_a": {
        poolId: "pool_a",
        businessId: "biz_a",
        destinationCountryName: "Guinea",
        participantRole: "joiner",
        participantJoinStatus: "requested",
        status: "open",
      },
      "openBarrels/pool_a": {
        poolId: "pool_a",
        businessId: "biz_a",
        businessName: "Business A",
        destinationCountryId: "guinea",
        destinationCountryName: "Guinea",
        sharesAvailable: 1,
        totalShares: 2,
        pricePerShare: 150,
        depositPerShare: 45,
        status: "open",
      },
      "barrelPoolBalanceRequests/balance_a": {
        businessId: "biz_a",
        businessName: "Business A",
        customerUid: "customer-joiner",
        customerName: "Pool Joiner",
        amount: 105,
        amountCents: 10500,
        status: "pending",
        source: "barrel_pool_balance",
        barrelPoolId: "pool_a",
        trackingCode: "BP-TEST",
      },
      "supportCases/case_a": {
        customerUid: "customer-support",
        businessId: "biz_a",
        businessName: "Business A",
        subject: "Order help",
        status: "open",
        escalationStatus: "not_escalated",
        participantUids: ["customer-support"],
      },
      "supportCases/case_a/participants/customer-support": {
        uid: "customer-support",
        role: "customer",
      },
      "supportCases/case_a/participants/business_biz_a": {
        businessId: "biz_a",
        role: "business",
      },
      "supportCases/case_a/messages/msg_a": {
        body: "Visible message",
        senderUid: "customer-support",
        senderRole: "customer",
        internal: false,
      },
      // A message WITHOUT the optional `internal` field — list reads must not
      // throw "Property internal is undefined" on it (regression guard).
      "supportCases/case_a/messages/msg_no_field": {
        body: "Message without an internal flag",
        senderUid: "customer-support",
        senderRole: "customer",
      },
      "supportCases/case_a/timeline/event_a": {
        type: "case_created",
        private: false,
      },
      "supportCases/case_a/internalNotes/note_a": {
        body: "Admin-only note",
        createdBy: "support-admin",
      },
      "supportCases/case_b": {
        customerUid: "customer-stranger",
        businessId: "biz_b",
        businessName: "Business B",
        subject: "Other case",
        status: "open",
        escalationStatus: "not_escalated",
      },
      "supportCases/case_escalated": {
        customerUid: "customer-support",
        businessId: "biz_a",
        businessName: "Business A",
        subject: "Escalated case",
        status: "escalated_to_platform",
        escalationStatus: "escalated",
      },
    };

    for (const [docPath, data] of Object.entries(docs)) {
      batch.set(db.doc(docPath), data);
    }
    await batch.commit();
  });
}

async function seedStorage() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.storage().ref("businessLogos/biz_a/public.png").put(
        imageBytes(),
        {contentType: "image/png"},
    );
    await context.storage().ref("cars/legacy_car/public.jpg").put(
        imageBytes(),
        {contentType: "image/jpeg"},
    );
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(
          path.join(__dirname, "../../firestore.rules"),
          "utf8",
      ),
    },
    storage: {
      rules: fs.readFileSync(
          path.join(__dirname, "../storage.rules"),
          "utf8",
      ),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await seedFirestore();
  await seedStorage();
});

after(async () => {
  await testEnv?.cleanup();
});

describe("public Website CMS rules", () => {
  it("allows public Website reads and private business gating", async () => {
    const db = firestoreFor(null);

    await assertSucceeds(db.doc("websiteContent/home").get());
    await assertSucceeds(db.doc("featuredBusinesses/biz_a").get());
    await assertFails(db.doc("businesses/biz_a").get());
  });

  it("allows only website-capable admins to write CMS docs", async () => {
    const contentDb = firestoreFor("content-admin");
    const financeDb = firestoreFor("finance-admin");

    await assertSucceeds(contentDb.doc("websiteContent/home").set({
      hero: {headline: "Updated headline"},
    }, {merge: true}));
    await assertSucceeds(contentDb.doc("featuredBusinesses/biz_a").set({
      displayName: "Updated Business A",
    }, {merge: true}));

    await assertFails(financeDb.doc("websiteContent/home").set({
      hero: {headline: "Finance should not write this"},
    }, {merge: true}));
    await assertFails(financeDb.doc("featuredBusinesses/biz_a").set({
      displayName: "Finance should not write this",
    }, {merge: true}));
  });
});

describe("business dashboard Firestore rules", () => {
  it("lets a business owner read their own private records only", async () => {
    const ownerDb = firestoreFor("owner-a");

    await assertSucceeds(ownerDb.doc("businesses/biz_a").get());
    await assertFails(ownerDb.doc("businesses/biz_b").get());
    await assertSucceeds(ownerDb.doc("parkedCars/park_a").get());
    await assertFails(ownerDb.doc("parkedCars/park_b").get());
  });

  it("returns every posted car for a scoped listings query", async () => {
    const ownerDb = firestoreFor("owner-a");

    const snapshot = await assertSucceeds(
        ownerDb.collection("cars").where("businessId", "==", "biz_a").get(),
    );

    assert.equal(snapshot.size, 2);
    assert.deepEqual(
        snapshot.docs.map((doc) => doc.id).sort(),
        ["car_a_1", "car_a_2"],
    );
  });

  it("enforces staff section permissions for writes", async () => {
    const staffDb = firestoreFor("staff-listings-a");

    await assertSucceeds(staffDb.doc("cars/car_a_1").set({
      businessId: "biz_a",
      title: "Car A 1",
      status: "sold",
    }, {merge: true}));

    await assertFails(staffDb.doc("parkedCars/park_a").set({
      businessId: "biz_a",
      customerName: "Customer A",
      parkingStatus: "completed",
    }, {merge: true}));
  });

  it("denies changing a foreign record into staff scope", async () => {
    const staffDb = firestoreFor("staff-listings-a");

    await assertFails(staffDb.doc("cars/car_b_1").set({
      businessId: "biz_a",
      title: "Car B 1",
      status: "sold",
    }, {merge: true}));
  });

  it("denies business staff reads across businesses", async () => {
    const staffDb = firestoreFor("staff-listings-a");

    await assertSucceeds(
        staffDb.doc("businessSupportRequests/support_a").get(),
    );
    await assertFails(staffDb.doc("businessSupportRequests/support_b").get());
  });
});

describe("marketplace support Firestore rules", () => {
  it("allows case participants to read visible support data only", async () => {
    const customerDb = firestoreFor("customer-support");
    const supportStaffDb = firestoreFor("staff-support-a");
    const listingStaffDb = firestoreFor("staff-listings-a");
    const supportAdminDb = firestoreFor("support-admin");
    const strangerDb = firestoreFor("customer-stranger");

    await assertSucceeds(customerDb.doc("supportCases/case_a").get());
    await assertSucceeds(
        customerDb.doc("supportCases/case_a/messages/msg_a").get(),
    );
    await assertSucceeds(
        customerDb.doc("supportCases/case_a/timeline/event_a").get(),
    );
    await assertSucceeds(
        supportStaffDb.doc("supportCases/case_a").get(),
    );
    await assertSucceeds(
        supportAdminDb.doc("supportCases/case_a/internalNotes/note_a").get(),
    );

    await assertFails(
        customerDb.doc("supportCases/case_a/internalNotes/note_a").get(),
    );
    await assertFails(listingStaffDb.doc("supportCases/case_a").get());
    await assertFails(strangerDb.doc("supportCases/case_a").get());
  });

  it("allows the business and admin inbox LIST queries", async () => {
    // Regression: the support inbox queries are `list` (collection) reads, not
    // single-doc gets. canReadSupportCase must stay evaluable for list, and the
    // optional message `internal` flag must not throw when absent.
    const customerDb = firestoreFor("customer-support");
    const supportStaffDb = firestoreFor("staff-support-a");
    const supportAdminDb = firestoreFor("support-admin");
    const listingStaffDb = firestoreFor("staff-listings-a");
    const strangerDb = firestoreFor("customer-stranger");

    // Customer inbox: where customerUid == me
    await assertSucceeds(
        customerDb.collection("supportCases")
            .where("customerUid", "==", "customer-support").get(),
    );
    // Business inbox: where businessId == my business
    await assertSucceeds(
        supportStaffDb.collection("supportCases")
            .where("businessId", "==", "biz_a").get(),
    );
    // Admin inbox: where escalationStatus == 'escalated'
    await assertSucceeds(
        supportAdminDb.collection("supportCases")
            .where("escalationStatus", "==", "escalated").get(),
    );
    // Message thread is also a list read, incl. a message with no `internal`.
    await assertSucceeds(
        customerDb.collection("supportCases/case_a/messages").get(),
    );

    // A business staffer without the support section cannot list the queue.
    await assertFails(
        listingStaffDb.collection("supportCases")
            .where("businessId", "==", "biz_a").get(),
    );
    // A stranger cannot list another business's cases.
    await assertFails(
        strangerDb.collection("supportCases")
            .where("businessId", "==", "biz_a").get(),
    );
  });

  it("denies direct client writes to support case collections", async () => {
    const customerDb = firestoreFor("customer-support");
    const supportAdminDb = firestoreFor("support-admin");

    await assertFails(customerDb.doc("supportCases/case_a/messages/new").set({
      body: "Client write should use callable",
      senderUid: "customer-support",
    }));
    await assertFails(supportAdminDb.doc("supportCases/case_a").set({
      status: "resolved",
    }, {merge: true}));
    await assertFails(
        supportAdminDb.doc("supportCases/case_a/internalNotes/new").set({
          body: "Client write should use callable",
        }),
    );
  });
});

describe("shared barrel Firestore rules", () => {
  it("allows signed-in customers to read only the PII-free mirror",
      async () => {
        const anonDb = firestoreFor(null);
        const customerDb = firestoreFor("customer-stranger");

        await assertFails(anonDb.doc("openBarrels/pool_a").get());
        const mirror = await assertSucceeds(
            customerDb.doc("openBarrels/pool_a").get(),
        );

        assert.equal(mirror.get("sharesAvailable"), 1);
        assert.equal(mirror.get("receiverPhone"), undefined);
        assert.equal(mirror.get("senderName"), undefined);
      });

  it("limits private pool reads to participants, business, and admins",
      async () => {
        const ownerDb = firestoreFor("customer-owner");
        const joinerDb = firestoreFor("customer-joiner");
        const strangerDb = firestoreFor("customer-stranger");
        const businessDb = firestoreFor("staff-barrels-a");
        const adminDb = firestoreFor("super-admin");

        await assertSucceeds(ownerDb.doc("barrelPools/pool_a").get());
        await assertSucceeds(joinerDb.doc("barrelPools/pool_a").get());
        await assertSucceeds(businessDb.doc("barrelPools/pool_a").get());
        await assertSucceeds(adminDb.doc("barrelPools/pool_a").get());
        await assertFails(strangerDb.doc("barrelPools/pool_a").get());
      });

  it("protects participant PII from customers and all client writes",
      async () => {
        const ownerDb = firestoreFor("customer-owner");
        const joinerDb = firestoreFor("customer-joiner");
        const strangerDb = firestoreFor("customer-stranger");
        const businessDb = firestoreFor("staff-barrels-a");

        await assertSucceeds(
            ownerDb.doc("barrelPools/pool_a/participants/customer-owner").get(),
        );
        await assertSucceeds(
            businessDb
                .doc("barrelPools/pool_a/participants/customer-joiner")
                .get(),
        );
        await assertFails(
            joinerDb
                .doc("barrelPools/pool_a/participants/customer-owner")
                .get(),
        );
        await assertFails(
            strangerDb
                .doc("barrelPools/pool_a/participants/customer-joiner")
                .get(),
        );
        await assertFails(
            ownerDb.doc("barrelPools/pool_a").set(
                {status: "cancelled"},
                {merge: true},
            ),
        );
        await assertFails(
            businessDb.doc("openBarrels/pool_a").set(
                {sharesAvailable: 2},
                {merge: true},
            ),
        );
      });

  it("allows customers to read only their private pool membership index",
      async () => {
        const ownerDb = firestoreFor("customer-owner");
        const joinerDb = firestoreFor("customer-joiner");
        const strangerDb = firestoreFor("customer-stranger");
        const adminDb = firestoreFor("super-admin");

        await assertSucceeds(
            ownerDb.doc("users/customer-owner/barrelPools/pool_a").get(),
        );
        await assertSucceeds(
            adminDb.doc("users/customer-owner/barrelPools/pool_a").get(),
        );
        await assertFails(
            joinerDb.doc("users/customer-owner/barrelPools/pool_a").get(),
        );
        await assertFails(
            strangerDb.doc("users/customer-joiner/barrelPools/pool_a").get(),
        );
        await assertFails(
            ownerDb.doc("users/customer-owner/barrelPools/pool_a").set(
                {status: "cancelled"},
                {merge: true},
            ),
        );
      });

  it("protects shared barrel balance payment requests",
      async () => {
        const joinerDb = firestoreFor("customer-joiner");
        const strangerDb = firestoreFor("customer-stranger");
        const businessDb = firestoreFor("staff-barrels-a");
        const adminDb = firestoreFor("super-admin");

        await assertSucceeds(
            joinerDb.doc("barrelPoolBalanceRequests/balance_a").get(),
        );
        await assertSucceeds(
            businessDb.doc("barrelPoolBalanceRequests/balance_a").get(),
        );
        await assertSucceeds(
            adminDb.doc("barrelPoolBalanceRequests/balance_a").get(),
        );
        await assertFails(
            strangerDb.doc("barrelPoolBalanceRequests/balance_a").get(),
        );
        await assertFails(
            businessDb.doc("barrelPoolBalanceRequests/balance_a").set(
                {status: "paid"},
                {merge: true},
            ),
        );
      });
});

describe("featured business logo Storage rules", () => {
  it("allows public reads for approved marketing logo files", async () => {
    const storage = storageFor(null);

    await assertSucceeds(
        storage.ref("businessLogos/biz_a/public.png").getMetadata(),
    );
  });

  it("allows platform admins and owning business owners to upload logos",
      async () => {
        await assertSucceeds(
            putLogo(
                storageForToken("admin-email-only", {email: "admin@gmail.com"}),
                "biz_a",
                "admin-email.png",
            ),
        );
        await assertSucceeds(
            putLogo(storageFor("super-admin"), "biz_a", "super.png"),
        );
        await assertSucceeds(
            putLogo(storageFor("platform-admin"), "biz_a", "platform.png"),
        );
        await assertSucceeds(
            putLogo(storageFor("content-admin"), "biz_a", "admin.png"),
        );
        await assertSucceeds(
            putLogo(storageFor("finance-admin"), "biz_a", "finance.png"),
        );
        await assertSucceeds(
            putLogo(storageFor("owner-a"), "biz_a", "owner.png"),
        );
      });

  it("denies staff and cross-business logo uploads", async () => {
    await assertFails(
        putLogo(storageFor("staff-listings-a"), "biz_a", "staff.png"),
    );
    await assertFails(
        putLogo(storageFor("owner-a"), "biz_b", "cross.png"),
    );
  });

  it("denies non-image and oversized logo uploads", async () => {
    await assertFails(
        putLogo(storageFor("owner-a"), "biz_a", "not-image.txt", {
          contentType: "text/plain",
        }),
    );
    await assertFails(
        putLogo(storageFor("owner-a"), "biz_a", "too-large.png", {
          size: 10 * 1024 * 1024,
        }),
    );
  });
});

describe("business profile image Storage rules", () => {
  it("allows linked owners and business-doc owners to upload profile images",
      async () => {
        await assertSucceeds(
            putBusinessProfileImage(
                storageFor("owner-a"),
                "biz_a",
                "profile.jpg",
            ),
        );
        await assertSucceeds(
            putBusinessProfileImage(
                storageFor("owner-doconly"),
                "biz_doc_owner",
                "profile.jpg",
            ),
        );
      });

  it("denies unauthenticated, cross-business, and invalid profile uploads",
      async () => {
        await assertFails(
            putBusinessProfileImage(
                storageFor(null),
                "biz_a",
                "anon.jpg",
            ),
        );
        await assertFails(
            putBusinessProfileImage(
                storageFor("owner-a"),
                "biz_b",
                "cross.jpg",
            ),
        );
        await assertFails(
            putBusinessProfileImage(
                storageFor("owner-a"),
                "biz_a",
                "not-image.txt",
                {contentType: "text/plain"},
            ),
        );
        await assertFails(
            putBusinessProfileImage(
                storageFor("owner-a"),
                "biz_a",
                "too-large.jpg",
                {size: 10 * 1024 * 1024},
            ),
        );
      });
});

describe("car listing image Storage rules", () => {
  it("keeps existing car image URLs publicly readable", async () => {
    const storage = storageFor(null);

    await assertSucceeds(
        storage.ref("cars/legacy_car/public.jpg").getMetadata(),
    );
  });

  it("allows admins, owners, and listing staff to upload scoped car images",
      async () => {
        await assertSucceeds(
            putCarImage(
                storageFor("super-admin"),
                "biz_a",
                "car_a_1",
                "admin.jpg",
            ),
        );
        await assertSucceeds(
            putCarImage(
                storageFor("owner-a"),
                "biz_a",
                "car_a_1",
                "owner.jpg",
            ),
        );
        await assertSucceeds(
            putCarImage(
                storageFor("staff-listings-a"),
                "biz_a",
                "car_a_1",
                "staff.jpg",
            ),
        );
      });

  it("denies legacy, unauthenticated, and cross-business car image writes",
      async () => {
        await assertFails(
            putLegacyCarImage(storageFor("owner-a"), "car_a_1", "legacy.jpg"),
        );
        await assertFails(
            putCarImage(storageFor(null), "biz_a", "car_a_1", "anon.jpg"),
        );
        await assertFails(
            putCarImage(storageFor("owner-a"), "biz_b", "car_b_1", "cross.jpg"),
        );
        await assertFails(
            putCarImage(
                storageFor("staff-listings-a"),
                "biz_b",
                "car_b_1",
                "cross-staff.jpg",
            ),
        );
      });

  it("denies non-image and oversized car image uploads", async () => {
    await assertFails(
        putCarImage(
            storageFor("owner-a"),
            "biz_a",
            "car_a_1",
            "not-image.txt",
            {contentType: "text/plain"},
        ),
    );
    await assertFails(
        putCarImage(
            storageFor("owner-a"),
            "biz_a",
            "car_a_1",
            "too-large.jpg",
            {size: 10 * 1024 * 1024},
        ),
    );
  });
});

describe("support attachment Storage rules", () => {
  it("allows support participants to upload scoped attachments", async () => {
    await assertSucceeds(
        putSupportAttachment(
            storageFor("customer-support"),
            "case_a",
            "customer-support",
            "receipt.pdf",
        ),
    );
    await assertSucceeds(
        putSupportAttachment(
            storageFor("staff-support-a"),
            "case_a",
            "staff-support-a",
            "photo.jpg",
            {contentType: "image/jpeg"},
        ),
    );
    await assertSucceeds(
        putSupportAttachment(
            storageFor("support-admin"),
            "case_a",
            "support-admin",
            "note.txt",
            {contentType: "text/plain"},
        ),
    );
  });

  it("denies strangers, wrong uploader paths, and invalid support files",
      async () => {
        await assertFails(
            putSupportAttachment(
                storageFor("customer-stranger"),
                "case_a",
                "customer-stranger",
                "cross.pdf",
            ),
        );
        await assertFails(
            putSupportAttachment(
                storageFor("customer-support"),
                "case_a",
                "other-user",
                "wrong-owner.pdf",
            ),
        );
        await assertFails(
            putSupportAttachment(
                storageFor("customer-support"),
                "case_a",
                "customer-support",
                "script.js",
                {contentType: "application/javascript"},
            ),
        );
        await assertFails(
            putSupportAttachment(
                storageFor("customer-support"),
                "case_a",
                "customer-support",
                "huge.jpg",
                {
                  contentType: "image/jpeg",
                  size: 10 * 1024 * 1024,
                },
            ),
        );
      });
});
