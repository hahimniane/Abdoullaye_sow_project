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
    testEnv.authenticatedContext(uid, {email_verified: true}).firestore() :
    testEnv.unauthenticatedContext().firestore();
}

// Storage rules can't read Firestore in production (see storage.rules'
// comments and the storage-rules-cross-service-broken memory), so they
// authorize business-scoped uploads from custom auth-token claims instead -
// the same role/businessId/adminRole/businessPermissions
// functions/index.js's syncUserCustomClaims trigger mirrors from each
// user's Firestore profile. This roster is that mirror for every uid these
// tests authenticate as, so a storage test exercises the same claims shape
// production actually has, not just whatever the local emulator lets
// cross-service Firestore reads get away with.
const TEST_USER_CLAIMS = {
  "super-admin": {role: "admin", adminRole: "superAdmin"},
  "platform-admin": {role: "admin"},
  "operations-admin": {role: "admin", adminRole: "operationsManager"},
  "content-admin": {role: "admin", adminRole: "contentManager"},
  "finance-admin": {role: "admin", adminRole: "financeManager"},
  "support-admin": {role: "admin", adminRole: "supportAdmin"},
  "owner-a": {role: "businessOwner", businessId: "biz_a"},
  "owner-b": {role: "businessOwner", businessId: "biz_b"},
  "staff-listings-a": {
    role: "staff", businessId: "biz_a", businessPermissions: ["listings"],
  },
  "staff-profile-a": {
    role: "staff", businessId: "biz_a", businessPermissions: ["profile"],
  },
  "staff-barrels-a": {
    role: "staff", businessId: "biz_a", businessPermissions: ["barrels"],
  },
  "staff-freight-a": {
    role: "staff", businessId: "biz_a", businessPermissions: ["freight"],
  },
  "staff-transport-a": {
    role: "staff", businessId: "biz_a", businessPermissions: ["transport"],
  },
  "staff-destinations-a": {
    role: "staff", businessId: "biz_a", businessPermissions: ["destinations"],
  },
  "staff-transport-b": {
    role: "staff", businessId: "biz_b", businessPermissions: ["transport"],
  },
  "staff-support-a": {
    role: "staff", businessId: "biz_a", businessPermissions: ["support"],
  },
  "staff-missing-permissions-a": {role: "staff", businessId: "biz_a"},
  "staff-empty-permissions-a": {
    role: "staff", businessId: "biz_a", businessPermissions: [],
  },
  "customer-owner": {role: "customer"},
  "customer-joiner": {role: "customer"},
  "customer-stranger": {role: "customer"},
  "customer-support": {role: "customer"},
};

function storageFor(uid) {
  if (!uid) return testEnv.unauthenticatedContext().storage();
  const claims = TEST_USER_CLAIMS[uid] || {};
  return testEnv.authenticatedContext(uid, {
    email_verified: true,
    ...claims,
  }).storage();
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

function putBusinessDocument(
    storage,
    businessId,
    documentId,
    fileName,
    options = {},
) {
  return storage
      .ref(`businessDocuments/${businessId}/${documentId}/${fileName}`)
      .put(
          imageBytes(options.size),
          {contentType: options.contentType || "application/pdf"},
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

function destinationCoverage(overrides = {}) {
  return {
    businessId: "biz_a",
    businessName: "Business A",
    businessStatus: "approved",
    countryId: "guinea",
    name: "Guinea",
    code: "GN",
    destinationCoverageVersion: 2,
    serviceAvailability: {
      barrelShipping: false,
      freightAir: false,
      freightSea: false,
      carTransport: false,
    },
    isActive: false,
    barrelShippingPrice: 0,
    freightAirPricePerKg: 0,
    freightSeaPricePerKg: 0,
    barrelShippingDeliveryEstimateMinDays: 10,
    barrelShippingDeliveryEstimateMaxDays: 20,
    ...overrides,
  };
}

async function seedFirestore() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = db.batch();

    const docs = {
      "platformConfig/permissions": {
        roles: {
          contentManager: {sections: {website: "manage"}},
          financeManager: {
            sections: {
              website: "view",
              finance: "manage",
            },
          },
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
      "users/operations-admin": {
        role: "admin",
        adminRole: "operationsManager",
        email: "operations@example.com",
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
      "users/owner-b": {
        role: "businessOwner",
        businessId: "biz_b",
        businessName: "Business B",
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
      "users/staff-profile-a": {
        role: "staff",
        businessId: "biz_a",
        businessName: "Business A",
        businessPermissions: ["profile"],
      },
      "users/staff-barrels-a": {
        role: "staff",
        businessId: "biz_a",
        businessName: "Business A",
        businessPermissions: ["barrels"],
      },
      "users/staff-freight-a": {
        role: "staff",
        businessId: "biz_a",
        businessName: "Business A",
        businessPermissions: ["freight"],
      },
      "users/staff-transport-a": {
        role: "staff",
        businessId: "biz_a",
        businessName: "Business A",
        businessPermissions: ["transport"],
      },
      "users/staff-destinations-a": {
        role: "staff",
        businessId: "biz_a",
        businessName: "Business A",
        businessPermissions: ["destinations"],
      },
      "users/staff-transport-b": {
        role: "staff",
        businessId: "biz_b",
        businessName: "Business B",
        businessPermissions: ["transport"],
      },
      "users/staff-support-a": {
        role: "staff",
        businessId: "biz_a",
        businessName: "Business A",
        businessPermissions: ["support"],
      },
      "users/staff-missing-permissions-a": {
        role: "staff",
        businessId: "biz_a",
        businessName: "Business A",
      },
      "users/staff-empty-permissions-a": {
        role: "staff",
        businessId: "biz_a",
        businessName: "Business A",
        businessPermissions: [],
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
        enabledServices: [
          "barrelShipping",
          "freight",
          "carTransport",
        ],
      },
      "businesses/biz_b": {
        name: "Business B",
        status: "approved",
        enabledServices: ["carTransport"],
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
      "freightShipments/freight_a": {
        businessId: "biz_a",
        customerUid: "customer-owner",
        trackingCode: "FR-A",
        senderName: "Sender A",
        receiverName: "Receiver A",
        price: 100,
        paymentStatus: "succeeded",
        status: "pending",
      },
      "freightShipments/freight_b": {
        businessId: "biz_b",
        customerUid: "customer-other",
        trackingCode: "FR-B",
        senderName: "Sender B",
        receiverName: "Receiver B",
        price: 200,
        paymentStatus: "succeeded",
        status: "pending",
      },
      "freightShipments/freight_v2_unsettled": {
        businessId: "biz_a",
        customerUid: "customer-owner",
        trackingCode: "FR-V2-PENDING",
        freightPricingVersion: 2,
        priceSettlementStatus: "balance_due",
        paymentStatus: "succeeded",
        status: "awaiting_balance_payment",
      },
      "freightShipments/freight_v2_settled": {
        businessId: "biz_a",
        customerUid: "customer-owner",
        trackingCode: "FR-V2-SETTLED",
        freightPricingVersion: 2,
        priceSettlementStatus: "settled",
        paymentStatus: "succeeded",
        status: "pending",
      },
      "freightSettlements/freight_v2_unsettled_v1": {
        settlementId: "freight_v2_unsettled_v1",
        shipmentId: "freight_v2_unsettled",
        businessId: "biz_a",
        customerUid: "customer-owner",
        priceSettlementStatus: "balance_due",
      },
      "transportRequests/transport_v1": {
        customerUid: "customer-owner",
        businessId: "biz_a",
        businessName: "Business A",
        trackingCode: "TR-V1",
        price: 950,
        status: "pending",
        quoteStatus: "awaitingQuote",
      },
      "transportRequests/transport_v2": {
        flowVersion: 2,
        source: "customerMarketplace",
        customerUid: "customer-owner",
        trackingCode: "TR-V2",
        businessId: "",
        businessName: "",
        price: 0,
        amountCents: 0,
        currency: "usd",
        status: "quote_requested",
        quoteStatus: "collecting",
        eligibleBusinessIds: ["biz_a", "biz_b"],
        eligibleBusinessCount: 2,
        selectedQuoteId: "",
        selectedBusinessId: "",
        selectedBusinessName: "",
        selectedAmountCents: 0,
        customerPhone: "+15555550101",
        pickupAddress: "100 Private Test Avenue",
        pickupArea: "Bronx, NY 10458",
        vehicleOperable: true,
        requestedTransportMethod: "open",
        flexibleDates: false,
        notes: "Private request notes",
        vinNumber: "PRIVATEVIN123",
      },
      "transportRequests/transport_v2_selected": {
        flowVersion: 2,
        source: "customerMarketplace",
        customerUid: "customer-owner",
        trackingCode: "TR-V2-SELECTED",
        businessId: "biz_a",
        businessName: "Business A",
        price: 1000,
        amountCents: 100000,
        currency: "usd",
        status: "pending",
        quoteStatus: "selected",
        eligibleBusinessIds: ["biz_a", "biz_b"],
        eligibleBusinessCount: 2,
        selectedQuoteId: "transport_v2_selected__biz_a",
        selectedBusinessId: "biz_a",
        selectedBusinessName: "Business A",
        selectedAmountCents: 100000,
        customerPhone: "+15555550101",
        pickupAddress: "100 Private Test Avenue",
      },
      "transportOpportunities/transport_v2__biz_a": {
        flowVersion: 2,
        requestId: "transport_v2",
        opportunityId: "transport_v2__biz_a",
        trackingCode: "TR-V2",
        businessId: "biz_a",
        businessName: "Business A",
        destinationCountryId: "guinea",
        destinationCountryName: "Guinea",
        carMake: "Toyota",
        carModel: "Camry",
        carYear: "2022",
        pickupArea: "Bronx, NY 10458",
        vehicleOperable: true,
        requestedTransportMethod: "open",
        flexibleDates: false,
        status: "open",
      },
      "transportOpportunities/transport_v2__biz_b": {
        flowVersion: 2,
        requestId: "transport_v2",
        opportunityId: "transport_v2__biz_b",
        trackingCode: "TR-V2",
        businessId: "biz_b",
        businessName: "Business B",
        destinationCountryId: "guinea",
        destinationCountryName: "Guinea",
        carMake: "Toyota",
        carModel: "Camry",
        carYear: "2022",
        pickupArea: "Bronx, NY 10458",
        vehicleOperable: true,
        requestedTransportMethod: "open",
        flexibleDates: false,
        status: "open",
      },
      "transportQuotes/transport_v2__biz_a": {
        flowVersion: 2,
        requestId: "transport_v2",
        opportunityId: "transport_v2__biz_a",
        businessId: "biz_a",
        businessName: "Business A",
        amountCents: 100000,
        currency: "usd",
        transportMethod: "open",
        status: "submitted",
        revision: 1,
      },
      "transportQuotes/transport_v2__biz_b": {
        flowVersion: 2,
        requestId: "transport_v2",
        opportunityId: "transport_v2__biz_b",
        businessId: "biz_b",
        businessName: "Business B",
        amountCents: 120000,
        currency: "usd",
        transportMethod: "enclosed",
        status: "submitted",
        revision: 1,
      },
      "carPurchases/purchase_a": {
        businessId: "biz_a",
        buyerUid: "customer-owner",
        carId: "car_a_1",
        depositAmount: 500,
        paymentStatus: "pending",
        purchaseStatus: "pending",
      },
      "shipmentPricing/serviceFees": {
        platformFeePercent: 5,
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
      "notificationDeliveries/delivery_a": {
        channel: "email",
        status: "failed",
        recipientUid: "owner-a",
        recipientEmail: "owner@example.com",
        title: "Verification update",
      },
      "platformNotifications/notification_a": {
        title: "Review needed",
        read: false,
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

  it("allows active freight-only and car-transport-only destinations",
      async () => {
        const ownerDb = firestoreFor("owner-a");

        await assertSucceeds(
            ownerDb.doc("businesses/biz_a/destinationCountries/freight").set(
                destinationCoverage({
                  countryId: "freight",
                  name: "Freightland",
                  isActive: true,
                  serviceAvailability: {
                    barrelShipping: false,
                    freightAir: false,
                    freightSea: true,
                    carTransport: false,
                  },
                  freightSeaPricePerKg: 5,
                }),
            ),
        );

        await assertSucceeds(
            ownerDb.doc("businesses/biz_a/destinationCountries/transport").set(
                destinationCoverage({
                  countryId: "transport",
                  name: "Transportland",
                  isActive: true,
                  serviceAvailability: {
                    barrelShipping: false,
                    freightAir: false,
                    freightSea: false,
                    carTransport: true,
                  },
                  carTransportAvailable: true,
                }),
            ),
        );
      });

  it("denies active destination service rows with missing required rates",
      async () => {
        const ownerDb = firestoreFor("owner-a");

        await assertFails(
            ownerDb.doc("businesses/biz_a/destinationCountries/no_service").set(
                destinationCoverage({isActive: true}),
            ),
        );
        await assertFails(
            ownerDb.doc("businesses/biz_a/destinationCountries/freight_zero")
                .set(destinationCoverage({
                  countryId: "freight_zero",
                  isActive: true,
                  serviceAvailability: {
                    barrelShipping: false,
                    freightAir: true,
                    freightSea: false,
                    carTransport: false,
                  },
                  freightAirPricePerKg: 0,
                })),
        );
        await assertFails(
            ownerDb.doc("businesses/biz_a/destinationCountries/barrel_zero")
                .set(destinationCoverage({
                  countryId: "barrel_zero",
                  isActive: true,
                  serviceAvailability: {
                    barrelShipping: true,
                    freightAir: false,
                    freightSea: false,
                    carTransport: false,
                  },
                  barrelShippingPrice: 0,
                })),
        );
      });

  it("enforces complete maps, parent service gates, and non-destructive writes",
      async () => {
        const ownerA = firestoreFor("owner-a");
        const ownerB = firestoreFor("owner-b");
        const staffWithoutDestinationPermission =
          firestoreFor("staff-listings-a");
        const staffWithDestinationPermission =
          firestoreFor("staff-destinations-a");
        const validCarCoverage = destinationCoverage({
          businessId: "biz_b",
          countryId: "car_only",
          name: "Car Only",
          isActive: true,
          serviceAvailability: {
            barrelShipping: false,
            freightAir: false,
            freightSea: false,
            carTransport: true,
          },
          carTransportAvailable: true,
        });

        await assertSucceeds(
            ownerB.doc(
                "businesses/biz_b/destinationCountries/car_only",
            ).set(validCarCoverage),
        );
        const optionalEstimateCoverage = {
          ...validCarCoverage,
          countryId: "car_optional_estimate",
          name: "Car Optional Estimate",
        };
        delete optionalEstimateCoverage.barrelShippingDeliveryEstimateMinDays;
        delete optionalEstimateCoverage.barrelShippingDeliveryEstimateMaxDays;
        await assertSucceeds(
            ownerB.doc(
                "businesses/biz_b/destinationCountries/car_optional_estimate",
            ).set(optionalEstimateCoverage),
        );
        await assertSucceeds(
            ownerA.doc(
                "businesses/biz_a/destinationCountries/scheduled_freight",
            ).set(destinationCoverage({
              countryId: "scheduled_freight",
              name: "Scheduled Freight",
              isActive: true,
              serviceAvailability: {
                barrelShipping: false,
                freightAir: true,
                freightSea: true,
                carTransport: false,
              },
              freightAirPricePerKg: 8,
              freightSeaPricePerKg: 4,
              freightAirDepartureDays: ["monday", "thursday"],
              freightSeaDepartureDays: ["saturday"],
            })),
        );
        await assertFails(
            ownerA.doc(
                "businesses/biz_a/destinationCountries/invalid_schedule",
            ).set(destinationCoverage({
              countryId: "invalid_schedule",
              name: "Invalid Schedule",
              isActive: true,
              serviceAvailability: {
                barrelShipping: false,
                freightAir: true,
                freightSea: false,
                carTransport: false,
              },
              freightAirPricePerKg: 8,
              freightAirDepartureDays: ["funday"],
            })),
        );
        await assertFails(
            ownerB.doc(
                "businesses/biz_b/destinationCountries/barrel_forbidden",
            ).set(destinationCoverage({
              businessId: "biz_b",
              countryId: "barrel_forbidden",
              name: "Forbidden Barrel",
              isActive: true,
              serviceAvailability: {
                barrelShipping: true,
                freightAir: false,
                freightSea: false,
                carTransport: false,
              },
              barrelShippingPrice: 200,
            })),
        );
        await assertFails(
            ownerA.doc(
                "businesses/biz_a/destinationCountries/partial_map",
            ).set(destinationCoverage({
              countryId: "partial_map",
              serviceAvailability: {barrelShipping: false},
            })),
        );
        await assertFails(
            staffWithoutDestinationPermission.doc(
                "businesses/biz_a/destinationCountries/staff_denied",
            ).set(destinationCoverage({countryId: "staff_denied"})),
        );
        await assertSucceeds(
            staffWithDestinationPermission.doc(
                "businesses/biz_a/destinationCountries/staff_allowed",
            ).set(destinationCoverage({countryId: "staff_allowed"})),
        );
        await assertFails(
            ownerB.doc(
                "businesses/biz_b/destinationCountries/car_only",
            ).delete(),
        );
      });

  it("requires an explicit rebuilt-title disclosure on new car listings",
      async () => {
        const ownerDb = firestoreFor("owner-a");
        const listing = {
          businessId: "biz_a",
          title: "Disclosure test car",
          status: "active",
        };

        await assertFails(ownerDb.doc("cars/new_missing_disclosure").set({
          ...listing,
        }));
        await assertFails(ownerDb.doc("cars/new_invalid_disclosure").set({
          ...listing,
          isRebuiltTitle: "no",
        }));
        await assertSucceeds(ownerDb.doc("cars/new_rebuilt_title").set({
          ...listing,
          isRebuiltTitle: true,
        }));
        await assertSucceeds(ownerDb.doc("cars/new_not_rebuilt_title").set({
          ...listing,
          isRebuiltTitle: false,
        }));

        await assertSucceeds(ownerDb.doc("cars/car_a_1").set({
          isRebuiltTitle: false,
        }, {merge: true}));
        await assertFails(ownerDb.doc("cars/car_a_2").set({
          isRebuiltTitle: "unknown",
        }, {merge: true}));
      });

  it("lets freight staff fulfill only their business without changing money",
      async () => {
        const staffDb = firestoreFor("staff-freight-a");
        await assertSucceeds(staffDb.doc("freightShipments/freight_a").get());
        await assertFails(staffDb.doc("freightShipments/freight_b").get());
        await assertSucceeds(staffDb.doc("freightShipments/freight_a").set({
          status: "in_transit",
          trackingNumber: "CARRIER-123",
        }, {merge: true}));
        await assertFails(staffDb.doc("freightShipments/freight_a").set({
          price: 1,
          paymentStatus: "refunded",
        }, {merge: true}));
        await assertFails(
            staffDb.doc("freightShipments/freight_v2_unsettled").set({
              status: "in_transit",
            }, {merge: true}),
        );
        await assertSucceeds(
            staffDb.doc("freightShipments/freight_v2_settled").set({
              status: "in_transit",
            }, {merge: true}),
        );
        await assertFails(
            staffDb.doc("freightSettlements/freight_v2_unsettled_v1").set({
              verifiedWeightKg: 1,
            }, {merge: true}),
        );
      });

  it("lets the freight customer read their shipment but not another one",
      async () => {
        const customerDb = firestoreFor("customer-owner");
        await assertSucceeds(
            customerDb.doc("freightShipments/freight_a").get(),
        );
        await assertFails(
            customerDb.doc("freightShipments/freight_b").get(),
        );
      });

  it("fails closed when staff permissions are missing or empty", async () => {
    for (const uid of [
      "staff-missing-permissions-a",
      "staff-empty-permissions-a",
    ]) {
      const staffDb = firestoreFor(uid);

      await assertFails(staffDb.doc("cars/car_a_1").set({
        status: "sold",
      }, {merge: true}));
      await assertFails(staffDb.doc("parkedCars/park_a").set({
        parkingStatus: "completed",
      }, {merge: true}));
    }
  });

  it("keeps business owners authorized when staff access fails closed",
      async () => {
        const ownerDb = firestoreFor("owner-a");

        await assertSucceeds(ownerDb.doc("cars/car_a_1").set({
          status: "sold",
        }, {merge: true}));
        await assertSucceeds(ownerDb.doc("parkedCars/park_a").set({
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

describe("car transport quote marketplace Firestore rules", () => {
  it("keeps an unassigned v2 request private from invited businesses",
      async () => {
        const customerDb = firestoreFor("customer-owner");
        const strangerDb = firestoreFor("customer-stranger");
        const ownerDb = firestoreFor("owner-a");
        const transportStaffDb = firestoreFor("staff-transport-a");
        const adminDb = firestoreFor("operations-admin");

        await assertSucceeds(
            customerDb.doc("transportRequests/transport_v2").get(),
        );
        await assertSucceeds(
            adminDb.doc("transportRequests/transport_v2").get(),
        );
        await assertFails(
            strangerDb.doc("transportRequests/transport_v2").get(),
        );
        await assertFails(
            ownerDb.doc("transportRequests/transport_v2").get(),
        );
        await assertFails(
            transportStaffDb.doc("transportRequests/transport_v2").get(),
        );
        await assertSucceeds(
            ownerDb.doc("transportRequests/transport_v2_selected").get(),
        );
        await assertSucceeds(
            transportStaffDb
                .doc("transportRequests/transport_v2_selected")
                .get(),
        );
      });

  it("shows each business only its sanitized opportunities", async () => {
    const ownerDb = firestoreFor("owner-a");
    const staffDb = firestoreFor("staff-transport-a");
    const listingStaffDb = firestoreFor("staff-listings-a");
    const noPermissionDb = firestoreFor("staff-missing-permissions-a");
    const customerDb = firestoreFor("customer-owner");
    const strangerDb = firestoreFor("customer-stranger");

    const opportunity = await assertSucceeds(
        ownerDb.doc("transportOpportunities/transport_v2__biz_a").get(),
    );
    assert.equal(opportunity.get("trackingCode"), "TR-V2");
    assert.equal(opportunity.get("pickupArea"), "Bronx, NY 10458");
    assert.equal(opportunity.get("vehicleOperable"), true);
    assert.equal(opportunity.get("requestedTransportMethod"), "open");
    assert.equal(opportunity.get("flexibleDates"), false);
    for (const privateField of [
      "customerUid",
      "ownerName",
      "customerPhone",
      "pickupAddress",
      "notes",
      "vinNumber",
    ]) {
      assert.equal(
          Object.prototype.hasOwnProperty.call(
              opportunity.data() || {},
              privateField,
          ),
          false,
      );
    }

    await assertSucceeds(
        staffDb.doc("transportOpportunities/transport_v2__biz_a").get(),
    );
    await assertFails(
        ownerDb.doc("transportOpportunities/transport_v2__biz_b").get(),
    );
    await assertFails(
        staffDb.doc("transportOpportunities/transport_v2__biz_b").get(),
    );
    await assertFails(
        listingStaffDb
            .doc("transportOpportunities/transport_v2__biz_a")
            .get(),
    );
    await assertFails(
        noPermissionDb
            .doc("transportOpportunities/transport_v2__biz_a")
            .get(),
    );
    await assertSucceeds(
        customerDb.doc("transportOpportunities/transport_v2__biz_a").get(),
    );
    await assertSucceeds(
        customerDb.doc("transportOpportunities/transport_v2__biz_b").get(),
    );
    await assertFails(
        strangerDb.doc("transportOpportunities/transport_v2__biz_a").get(),
    );

    const scoped = await assertSucceeds(
        staffDb.collection("transportOpportunities")
            .where("businessId", "==", "biz_a")
            .get(),
    );
    assert.equal(scoped.size, 1);
  });

  it("isolates competing quotes while the customer can compare all",
      async () => {
        const staffADb = firestoreFor("staff-transport-a");
        const staffBDb = firestoreFor("staff-transport-b");
        const customerDb = firestoreFor("customer-owner");
        const strangerDb = firestoreFor("customer-stranger");

        await assertSucceeds(
            staffADb.doc("transportQuotes/transport_v2__biz_a").get(),
        );
        await assertFails(
            staffADb.doc("transportQuotes/transport_v2__biz_b").get(),
        );
        await assertSucceeds(
            staffBDb.doc("transportQuotes/transport_v2__biz_b").get(),
        );
        await assertFails(
            staffBDb.doc("transportQuotes/transport_v2__biz_a").get(),
        );
        await assertSucceeds(
            customerDb.doc("transportQuotes/transport_v2__biz_a").get(),
        );
        await assertSucceeds(
            customerDb.doc("transportQuotes/transport_v2__biz_b").get(),
        );
        await assertFails(
            strangerDb.doc("transportQuotes/transport_v2__biz_a").get(),
        );

        const businessQuotes = await assertSucceeds(
            staffADb.collection("transportQuotes")
                .where("businessId", "==", "biz_a")
                .get(),
        );
        assert.equal(businessQuotes.size, 1);
        const customerQuotes = await assertSucceeds(
            customerDb.collection("transportQuotes")
                .where("requestId", "==", "transport_v2")
                .get(),
        );
        assert.equal(customerQuotes.size, 2);
      });

  it("denies every direct client write to v2 marketplace records",
      async () => {
        const customerDb = firestoreFor("customer-owner");
        const ownerDb = firestoreFor("owner-a");
        const adminDb = firestoreFor("operations-admin");

        for (const clientDb of [customerDb, ownerDb, adminDb]) {
          await assertFails(
              clientDb.doc("transportRequests/transport_v2").set({
                status: "cancelled",
                quoteStatus: "cancelled",
              }, {merge: true}),
          );
          await assertFails(
              clientDb
                  .doc("transportOpportunities/transport_v2__biz_a")
                  .set({status: "selected"}, {merge: true}),
          );
          await assertFails(
              clientDb.doc("transportQuotes/transport_v2__biz_a").set({
                amountCents: 1,
                status: "selected",
              }, {merge: true}),
          );
        }

        await assertFails(
            ownerDb.doc("transportRequests/forged_v2").set({
              flowVersion: 2,
              customerUid: "customer-owner",
              businessId: "biz_a",
              status: "quote_requested",
              quoteStatus: "collecting",
            }),
        );
        await assertFails(
            ownerDb.doc("transportRequests/transport_v1").set({
              flowVersion: 2,
            }, {merge: true}),
        );
      });

  it("preserves the assigned v1 read, fulfillment, and cancellation rules",
      async () => {
        const customerDb = firestoreFor("customer-owner");
        const strangerDb = firestoreFor("customer-stranger");
        const ownerDb = firestoreFor("owner-a");
        const transportStaffDb = firestoreFor("staff-transport-a");
        const listingStaffDb = firestoreFor("staff-listings-a");

        await assertSucceeds(
            customerDb.doc("transportRequests/transport_v1").get(),
        );
        await assertFails(
            strangerDb.doc("transportRequests/transport_v1").get(),
        );
        await assertSucceeds(
            ownerDb.doc("transportRequests/transport_v1").get(),
        );
        await assertSucceeds(
            transportStaffDb.doc("transportRequests/transport_v1").get(),
        );
        await assertSucceeds(
            listingStaffDb.doc("transportRequests/transport_v1").get(),
        );
        await assertFails(
            listingStaffDb.doc("transportRequests/transport_v1").set({
              status: "in_transit",
            }, {merge: true}),
        );
        await assertSucceeds(
            transportStaffDb.doc("transportRequests/transport_v1").set({
              status: "in_transit",
            }, {merge: true}),
        );

        await testEnv.withSecurityRulesDisabled(async (context) => {
          await context.firestore()
              .doc("transportRequests/transport_v1")
              .update({status: "pending"});
        });
        await assertSucceeds(
            customerDb.doc("transportRequests/transport_v1").set({
              status: "cancelled",
              updatedAt: new Date(),
            }, {merge: true}),
        );
      });
});

describe("server-authoritative and granular admin Firestore rules", () => {
  it("allows a safe minimal customer profile to be created by its owner",
      async () => {
        const uid = "new-customer";
        const email = "new-customer@example.com";
        const customerDb = testEnv.authenticatedContext(uid, {
          email,
          email_verified: false,
        }).firestore();

        await assertSucceeds(customerDb.doc(`users/${uid}`).set({
          role: "customer",
          email,
          fullName: "New Customer",
          phone: "+15555550199",
          notificationPreferences: {orderActivity: true},
        }));

        const profile = await assertSucceeds(
            customerDb.doc(`users/${uid}`).get(),
        );
        assert.equal(profile.get("role"), "customer");
        assert.equal(profile.get("email"), email);
      });

  it("denies self-asserted roles, verification, business, trust, and money",
      async () => {
        const forgedProfiles = [
          ["admin-role", {role: "admin"}],
          ["staff-role", {role: "staff"}],
          ["owner-role", {role: "businessOwner"}],
          ["admin-access", {adminRole: "superAdmin", platformAdmin: true}],
          ["phone-verification", {
            phoneVerified: true,
            phoneVerifiedAt: new Date(),
          }],
          ["identity-verification", {
            emailVerified: true,
            identityVerified: true,
            verificationStatus: "approved",
          }],
          ["business-access", {
            businessId: "biz_a",
            businessName: "Business A",
            businessPermissions: ["freight", "finance"],
            businessServices: ["freight"],
          }],
          ["reliability", {
            carBuyerReliability: {
              paidHolds: 100,
              completedHolds: 100,
              noShows: 0,
              forfeitures: 0,
            },
          }],
          ["wallet", {
            walletBalance: 100000,
            walletCredit: 100000,
            balanceCents: 10000000,
          }],
          ["payment", {
            paymentStatus: "succeeded",
            stripeCustomerId: "cus_forged",
          }],
          ["server-identity", {
            normalizedPhone: "15555550199",
            createdAt: new Date(),
            updatedBy: "super-admin",
          }],
        ];

        for (const [label, forgedFields] of forgedProfiles) {
          const uid = `forger-${label}`;
          const email = `${uid}@example.com`;
          const customerDb = testEnv.authenticatedContext(uid, {
            email,
            email_verified: false,
          }).firestore();
          await assertFails(customerDb.doc(`users/${uid}`).set({
            role: "customer",
            email,
            fullName: "Forged Customer",
            ...forgedFields,
          }));
        }
      });

  it("denies adding server-authoritative fields to an existing customer",
      async () => {
        const customerDb = firestoreFor("customer-owner");
        for (const forgedFields of [
          {phoneVerified: true},
          {role: "admin"},
          {businessId: "biz_a", businessPermissions: ["finance"]},
          {carBuyerReliability: {completedHolds: 100}},
          {walletBalance: 100000},
          {paymentStatus: "succeeded"},
        ]) {
          await assertFails(customerDb.doc("users/customer-owner").set(
              forgedFields,
              {merge: true},
          ));
        }
      });

  it("denies every direct customer purchase create, including forged money",
      async () => {
        const customerDb = firestoreFor("customer-owner");

        await assertFails(customerDb.doc("carPurchases/client_purchase").set({
          businessId: "biz_a",
          buyerUid: "customer-owner",
          carId: "car_a_1",
          depositAmount: 500,
          paymentStatus: "pending",
          purchaseStatus: "pending",
        }));
        await assertFails(customerDb.doc("carPurchases/forged_purchase").set({
          businessId: "biz_a",
          buyerUid: "customer-owner",
          carId: "car_a_1",
          depositAmount: 1,
          paymentStatus: "succeeded",
          purchaseStatus: "completed",
          stripePaymentIntentId: "forged",
        }));
      });

  it("allows only the matching admin capability for direct writes",
      async () => {
        const operationsDb = firestoreFor("operations-admin");
        const financeDb = firestoreFor("finance-admin");
        const supportDb = firestoreFor("support-admin");
        const contentDb = firestoreFor("content-admin");
        const legacyAdminDb = firestoreFor("platform-admin");

        await assertSucceeds(operationsDb.doc("parkedCars/park_a").set({
          parkingStatus: "completed",
        }, {merge: true}));
        await assertSucceeds(operationsDb.doc("cars/car_a_1").set({
          status: "sold",
        }, {merge: true}));
        await assertSucceeds(operationsDb.doc("carPurchases/purchase_a").set({
          purchaseStatus: "completed",
        }, {merge: true}));
        await assertFails(operationsDb.doc("shipmentPricing/serviceFees").set({
          platformFeePercent: 7,
        }, {merge: true}));

        await assertSucceeds(financeDb.doc("shipmentPricing/serviceFees").set({
          platformFeePercent: 6,
        }, {merge: true}));
        await assertFails(financeDb.doc("cars/car_a_2").set({
          status: "sold",
        }, {merge: true}));
        await assertFails(financeDb.doc("parkedCars/park_b").set({
          parkingStatus: "completed",
        }, {merge: true}));

        await assertSucceeds(
            supportDb.doc("platformNotifications/notification_a").set({
              read: true,
            }, {merge: true}),
        );
        await assertFails(supportDb.doc("cars/car_a_2").set({
          status: "sold",
        }, {merge: true}));
        await assertFails(contentDb.doc("parkedCars/park_b").set({
          parkingStatus: "completed",
        }, {merge: true}));
        await assertFails(legacyAdminDb.doc("cars/car_a_2").set({
          status: "sold",
        }, {merge: true}));
      });

  it("keeps internal security state inaccessible to every client",
      async () => {
        for (const uid of ["customer-owner", "super-admin"]) {
          const db = firestoreFor(uid);
          for (const path of [
            "callableRateLimits/secret",
            "stripeWebhookEvents/event_secret",
            "paymentReconciliationFailures/failure_secret",
          ]) {
            await assertFails(db.doc(path).get());
            await assertFails(db.doc(path).set({count: 0}));
          }
        }
      });

  it("denies platform access until the administrator email is verified",
      async () => {
        const unverifiedDb = testEnv.authenticatedContext(
            "super-admin",
            {email_verified: false},
        ).firestore();
        const unverifiedStorage = testEnv.authenticatedContext(
            "super-admin",
            {email_verified: false},
        ).storage();

        await assertFails(unverifiedDb.doc("cars/car_a_1").set({
          status: "sold",
        }, {merge: true}));
        await assertFails(
            putLogo(unverifiedStorage, "biz_a", "unverified-admin.png"),
        );
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

describe("notification delivery Firestore rules", () => {
  it("allows admin reads and denies client writes", async () => {
    const adminDb = firestoreFor("support-admin");
    const customerDb = firestoreFor("customer-support");
    const ownerDb = firestoreFor("owner-a");

    await assertSucceeds(
        adminDb.doc("notificationDeliveries/delivery_a").get(),
    );
    await assertSucceeds(adminDb.collection("notificationDeliveries").get());

    await assertFails(
        customerDb.doc("notificationDeliveries/delivery_a").get(),
    );
    await assertFails(ownerDb.doc("notificationDeliveries/delivery_a").get());
    await assertFails(adminDb.doc("notificationDeliveries/delivery_a").set({
      status: "queued",
    }, {merge: true}));
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

  it("lets the pool owner review joiners while protecting participant PII",
      async () => {
        const ownerDb = firestoreFor("customer-owner");
        const joinerDb = firestoreFor("customer-joiner");
        const strangerDb = firestoreFor("customer-stranger");
        const businessDb = firestoreFor("staff-barrels-a");

        await assertSucceeds(
            ownerDb.doc("barrelPools/pool_a/participants/customer-owner").get(),
        );
        await assertSucceeds(
            ownerDb
                .doc("barrelPools/pool_a/participants/customer-joiner")
                .get(),
        );
        await assertSucceeds(
            ownerDb.collection("barrelPools/pool_a/participants").get(),
        );
        await assertSucceeds(
            businessDb
                .doc("barrelPools/pool_a/participants/customer-joiner")
                .get(),
        );
        await assertFails(
            joinerDb.collection("barrelPools/pool_a/participants").get(),
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

  it("allows business-capable admins and owners to upload logos",
      async () => {
        await assertFails(
            putLogo(
                storageForToken("admin-email-only", {email: "admin@gmail.com"}),
                "biz_a",
                "admin-email.png",
            ),
        );
        await assertSucceeds(
            putLogo(storageFor("super-admin"), "biz_a", "super.png"),
        );
        await assertFails(
            putLogo(storageFor("platform-admin"), "biz_a", "platform.png"),
        );
        await assertFails(
            putLogo(storageFor("content-admin"), "biz_a", "admin.png"),
        );
        await assertFails(
            putLogo(storageFor("finance-admin"), "biz_a", "finance.png"),
        );
        await assertSucceeds(
            putLogo(storageFor("operations-admin"), "biz_a", "operations.png"),
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
    await assertFails(
        putLogo(
            storageFor("staff-missing-permissions-a"),
            "biz_a",
            "missing-permissions.png",
        ),
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
  it("allows a linked owner to upload profile images", async () => {
    await assertSucceeds(
        putBusinessProfileImage(
            storageFor("owner-a"),
            "biz_a",
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
        // A business doc's ownerUid alone must not grant access without a
        // matching businessId claim - that legacy fallback required a
        // cross-service Firestore read that's broken in production, so it
        // was removed rather than left silently non-functional.
        await assertFails(
            putBusinessProfileImage(
                storageForToken("owner-doconly", {
                  email_verified: true,
                  role: "businessOwner",
                  businessId: "legacy_business_id",
                }),
                "biz_doc_owner",
                "profile.jpg",
            ),
        );
        await assertFails(
            putBusinessProfileImage(
                storageFor("staff-empty-permissions-a"),
                "biz_a",
                "empty-permissions.jpg",
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

describe("business verification document Storage rules", () => {
  it("allows admins, owners, and profile staff to upload documents",
      async () => {
        await assertSucceeds(
            putBusinessDocument(
                storageFor("super-admin"),
                "biz_a",
                "shippingAuthority",
                "admin.pdf",
            ),
        );
        await assertSucceeds(
            putBusinessDocument(
                storageFor("owner-a"),
                "biz_a",
                "shippingAuthority",
                "owner.pdf",
            ),
        );
        await assertSucceeds(
            putBusinessDocument(
                storageFor("staff-profile-a"),
                "biz_a",
                "shippingAuthority",
                "staff.pdf",
            ),
        );
      });

  it("allows admins and linked business users to read uploaded documents",
      async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
          await putBusinessDocument(
              context.storage(),
              "biz_a",
              "shippingAuthority",
              "saved.pdf",
          );
        });

        await assertSucceeds(
            storageFor("super-admin")
                .ref("businessDocuments/biz_a/shippingAuthority/saved.pdf")
                .getMetadata(),
        );
        await assertSucceeds(
            storageFor("owner-a")
                .ref("businessDocuments/biz_a/shippingAuthority/saved.pdf")
                .getMetadata(),
        );
        await assertSucceeds(
            storageFor("staff-profile-a")
                .ref("businessDocuments/biz_a/shippingAuthority/saved.pdf")
                .getMetadata(),
        );
        await assertFails(
            storageFor("staff-listings-a")
                .ref("businessDocuments/biz_b/shippingAuthority/saved.pdf")
                .getMetadata(),
        );
      });

  it("denies unauthenticated, cross-business, and non-profile staff uploads",
      async () => {
        await assertFails(
            putBusinessDocument(
                storageFor(null),
                "biz_a",
                "shippingAuthority",
                "anon.pdf",
            ),
        );
        await assertFails(
            putBusinessDocument(
                storageFor("owner-a"),
                "biz_b",
                "shippingAuthority",
                "cross.pdf",
            ),
        );
        await assertFails(
            putBusinessDocument(
                storageFor("staff-listings-a"),
                "biz_a",
                "shippingAuthority",
                "listings.pdf",
            ),
        );
      });

  it("denies Stripe-owned KYC document uploads", async () => {
    await assertFails(
        putBusinessDocument(
            storageFor("owner-a"),
            "biz_a",
            "businessRegistration",
            "registration.pdf",
        ),
    );
  });

  it("denies invalid document file types and oversized uploads", async () => {
    await assertFails(
        putBusinessDocument(
            storageFor("owner-a"),
            "biz_a",
            "shippingAuthority",
            "not-allowed.txt",
            {contentType: "text/plain"},
        ),
    );
    await assertFails(
        putBusinessDocument(
            storageFor("owner-a"),
            "biz_a",
            "shippingAuthority",
            "too-large.pdf",
            {size: 20 * 1024 * 1024},
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
                storageFor("operations-admin"),
                "biz_a",
                "car_a_1",
                "operations.jpg",
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
        await assertFails(
            putCarImage(
                storageFor("staff-missing-permissions-a"),
                "biz_a",
                "car_a_1",
                "missing-permissions.jpg",
            ),
        );
        await assertFails(
            putCarImage(
                storageFor("finance-admin"),
                "biz_a",
                "car_a_1",
                "finance.jpg",
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
            storageFor("customer-support"),
            "case_a",
            "customer-support",
            "ios-photo.heic",
            {contentType: "image/heic"},
        ),
    );
    await assertSucceeds(
        putSupportAttachment(
            storageFor("customer-support"),
            "case_a",
            "customer-support",
            "ios-video.mov",
            {contentType: "video/quicktime"},
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
    // Regression: uploads whose content type is missing/generic must not be
    // rejected by the storage rule (the callable validates the real type).
    await assertSucceeds(
        putSupportAttachment(
            storageFor("customer-support"),
            "case_a",
            "customer-support",
            "clip.bin",
            {contentType: "application/octet-stream"},
        ),
    );
  });

  it("allows an administrator with a dynamic support permission", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("platformConfig/permissions").update({
        "roles.contentManager.sections.support": "manage",
      });
    });

    await assertSucceeds(
        putSupportAttachment(
            storageFor("content-admin"),
            "case_a",
            "content-admin",
            "dynamic-support-note.pdf",
        ),
    );
  });

  it("denies wrong uploader paths and invalid support files",
      async () => {
        // Storage rules only enforce the uploader's own uid path + a size
        // cap here - real case membership (customer/participant/business,
        // including "a stranger to this case") is enforced afterward by
        // the uploadSupportAttachmentMetadata callable via the Admin SDK,
        // not by these rules, because that check needs a Firestore read
        // that's broken cross-service in production for non-admins.
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
                "huge.jpg",
                {
                  contentType: "image/jpeg",
                  size: 51 * 1024 * 1024,
                },
            ),
        );
      });
});
