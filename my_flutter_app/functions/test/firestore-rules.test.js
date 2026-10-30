const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
// This suite writes with ADMIN credentials. Without the emulator env
// those writes land in PRODUCTION - on 2026-08-16 a direct `node
// --test` run did exactly that, seeding 68 approved fixture
// businesses that real customers could see. Fail closed instead.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:rules` (firebase emulators:exec). " +
      "A direct node --test run would write its fixtures into the " +
      "real project.");
}

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
  "staff-parking-a": {
    role: "staff", businessId: "biz_a", businessPermissions: ["parking"],
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
      "users/staff-parking-a": {
        role: "staff",
        businessId: "biz_a",
        businessName: "Business A",
        businessPermissions: ["parking"],
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
      "businesses/biz_pending": {
        name: "Business Pending",
        status: "pending",
      },
      "businesses/biz_a/reviews/review_1": {
        businessId: "biz_a",
        customerUid: "customer-owner",
        rating: 5,
        comment: "Great service",
        moderationStatus: "published",
      },
      "businesses/biz_a/reviews/review_1/flags/staff-listings-a": {
        uid: "staff-listings-a",
        reason: "Suspected fake review",
      },
      "businesses/biz_a/reviews/review_flagged": {
        businessId: "biz_a",
        customerUid: "customer-owner",
        rating: 1,
        comment: "Never showed up",
        moderationStatus: "flagged",
      },
      "businesses/biz_pending/reviews/review_2": {
        businessId: "biz_pending",
        customerUid: "customer-owner",
        rating: 3,
        comment: "Pending business review",
        moderationStatus: "published",
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
      "barrelShipments/barrel_a": {
        businessId: "biz_a",
        customerUid: "customer-owner",
        trackingCode: "BR-A",
        status: "in_transit",
      },
      "barrelShipments/barrel_a/trackingEvents/event_1": {
        label: "Departed origin port",
        source: "staff",
      },
      // Container gate fixtures: a load cannot be marked in transit until the
      // container number the carrier tracking API is keyed on exists.
      "barrelShipments/barrel_no_container": {
        businessId: "biz_a",
        customerUid: "customer-owner",
        trackingCode: "BR-NC",
        status: "pending",
      },
      "barrelShipments/barrel_with_container": {
        businessId: "biz_a",
        customerUid: "customer-owner",
        trackingCode: "BR-WC",
        status: "pending",
        containerNumber: "MSKU1234567",
      },
      "barrelShipments/barrel_carrier_tracked": {
        businessId: "biz_a",
        customerUid: "customer-owner",
        trackingCode: "BR-T49",
        status: "pending",
        containerNumber: "MSKU1111111",
        trackingProvider: "carrier_api",
      },
      "freightShipments/freight_sea_no_container": {
        businessId: "biz_a",
        customerUid: "customer-owner",
        trackingCode: "FR-SEA-NC",
        mode: "sea",
        status: "pending",
      },
      "freightShipments/freight_sea_with_container": {
        businessId: "biz_a",
        customerUid: "customer-owner",
        trackingCode: "FR-SEA-WC",
        mode: "sea",
        status: "pending",
        containerNumber: "MSKU7654321",
      },
      "freightShipments/freight_air_no_container": {
        businessId: "biz_a",
        customerUid: "customer-owner",
        trackingCode: "FR-AIR",
        mode: "air",
        status: "pending",
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
      "freightShipments/freight_a/trackingEvents/event_1": {
        label: "Left the warehouse",
        source: "staff",
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
      "freightShipments/freight_v2_due_on_arrival": {
        businessId: "biz_a",
        customerUid: "customer-owner",
        trackingCode: "FR-Q56QWK",
        freightPricingVersion: 2,
        payOnArrival: true,
        priceSettlementStatus: "due_on_arrival",
        paymentStatus: "card_saved",
        status: "pending",
      },
      "freightShipments/freight_v2_card_saved_awaiting_weight": {
        businessId: "biz_a",
        customerUid: "customer-owner",
        trackingCode: "FR-CARD-SAVED",
        freightPricingVersion: 2,
        payOnArrival: true,
        priceSettlementStatus: "awaiting_weight",
        paymentStatus: "card_saved",
        status: "awaiting_weight_confirmation",
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
      "supportCases/wa_biz_a_224621000001": {
        caseType: "whatsapp",
        customerUid: "",
        businessId: "biz_a",
        businessName: "Business A",
        whatsappPhone: "+224621000001",
        subject: "Aissatou",
        status: "waiting_for_business",
      },
      "supportCases/wa_biz_a_224621000001/messages/in_1": {
        senderRole: "customer",
        content: "Bonjour",
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
  // The app does not read parked cars one document at a time: it subscribes to
  // `parkedCars where businessId == mine`. A query is evaluated against the
  // rule as a whole - the security rules must be satisfiable from the query's
  // constraints alone, without reading any document - so a get() passing says
  // nothing about whether the list loads. Every test above this one was a
  // get(), which is how "the business cannot see its parked cars" could be
  // true while the rules tests were green.
  it("lets the lot run the parked-car QUERY the app actually subscribes to",
      async () => {
        const {query, collection, where, getDocs} =
            require("firebase/firestore");

        for (const uid of ["owner-a", "staff-parking-a"]) {
          const db = firestoreFor(uid);
          await assertSucceeds(getDocs(query(
              collection(db, "parkedCars"),
              where("businessId", "==", "biz_a"))));
        }

        // Unfiltered, and filtered to someone else's lot, must both be refused
        // - the filter is the only thing that makes the query safe.
        await assertFails(getDocs(query(collection(
            firestoreFor("owner-a"), "parkedCars"))));
        await assertFails(getDocs(query(
            collection(firestoreFor("owner-a"), "parkedCars"),
            where("businessId", "==", "biz_b"))));
      });

  // The instalment history is read as a QUERY - `where businessId == mine and
  // activityId == this one` - so the rule has to be satisfiable from those
  // constraints alone. A get() passing here would prove nothing, which is the
  // lesson the parked-car query above was written for.
  it("lets the lot run the instalment-history QUERY the clients subscribe to",
      async () => {
        const {query, collection, where, getDocs, doc, setDoc} =
            require("firebase/firestore");

        await testEnv.withSecurityRulesDisabled(async (context) => {
          await setDoc(
              doc(context.firestore(), "lotActivityPayments/pay_a"),
              {businessId: "biz_a", activityId: "act_a", amountCents: 5000,
                source: "cash", paidAtMonth: "2026-11"});
        });

        await assertSucceeds(getDocs(query(
            collection(firestoreFor("owner-a"), "lotActivityPayments"),
            where("businessId", "==", "biz_a"),
            where("activityId", "==", "act_a"))));

        // Unfiltered, and filtered to another lot, must both be refused: the
        // business filter is the only thing that makes the query safe.
        await assertFails(getDocs(query(collection(
            firestoreFor("owner-a"), "lotActivityPayments"))));
        await assertFails(getDocs(query(
            collection(firestoreFor("owner-a"), "lotActivityPayments"),
            where("businessId", "==", "biz_b"))));
      });

  // Money rows are written by the callables as admin. A client that could
  // write here could write itself paid.
  it("never lets a client write an instalment", async () => {
    const {doc, setDoc} = require("firebase/firestore");
    await assertFails(setDoc(
        doc(firestoreFor("owner-a"), "lotActivityPayments/forged"),
        {businessId: "biz_a", activityId: "act_a", amountCents: 100000}));
  });

  // Containers and their lines are read as `where businessId == mine`
  // queries and written only by the callables. Tested as the query, not a
  // get(): a get() passing says nothing about whether the list loads.
  it("lets the lot run the container and line QUERIES the clients subscribe to",
      async () => {
        const {query, collection, where, getDocs, doc, setDoc} =
            require("firebase/firestore");
        await testEnv.withSecurityRulesDisabled(async (context) => {
          const db = context.firestore();
          await setDoc(doc(db, "containers/box_a"),
              {businessId: "biz_a", label: "Sailing 3 Oct", status: "loading"});
          await setDoc(doc(db, "containerLines/line_a"),
              {businessId: "biz_a", containerId: "box_a", kind: "car",
                vinNumber: "1HGCM82633A004352", containerStatus: "loading"});
        });
        for (const name of ["containers", "containerLines"]) {
          await assertSucceeds(getDocs(query(
              collection(firestoreFor("owner-a"), name),
              where("businessId", "==", "biz_a"))));
          await assertFails(getDocs(query(
              collection(firestoreFor("owner-a"), name))));
          await assertFails(getDocs(query(
              collection(firestoreFor("owner-a"), name),
              where("businessId", "==", "biz_b"))));
        }
      });

  // The timeline and the WhatsApp log are the business's to read and the
  // server's alone to write - a client that could write an update could
  // message every customer on a box.
  it("lets the lot read a container's timeline and update log, never write",
      async () => {
        const {query, collection, where, getDocs, doc, setDoc, getDoc} =
            require("firebase/firestore");
        await testEnv.withSecurityRulesDisabled(async (context) => {
          const db = context.firestore();
          await setDoc(doc(db, "containers/box_a"),
              {businessId: "biz_a", label: "Sailing 3 Oct", status: "shipped"});
          await setDoc(doc(db, "containers/box_a/trackingEvents/staff_shipped"),
              {label: "Container shipped", customerUpdate: "shipped"});
          await setDoc(doc(db, "containerUpdates/line_a_sender_shipped"),
              {businessId: "biz_a", containerId: "box_a", lineId: "line_a",
                status: "waiting_for_whatsapp"});
        });
        const owner = firestoreFor("owner-a");
        await assertSucceeds(getDoc(
            doc(owner, "containers/box_a/trackingEvents/staff_shipped")));
        await assertSucceeds(getDocs(query(
            collection(owner, "containerUpdates"),
            where("businessId", "==", "biz_a"))));
        await assertFails(getDocs(query(
            collection(owner, "containerUpdates"),
            where("businessId", "==", "biz_b"))));
        await assertFails(getDoc(doc(firestoreFor("owner-b"),
            "containers/box_a/trackingEvents/staff_shipped")));
        await assertFails(setDoc(
            doc(owner, "containers/box_a/trackingEvents/forged"),
            {label: "x", customerUpdate: "arrived"}));
        await assertFails(setDoc(doc(owner, "containerUpdates/forged"),
            {businessId: "biz_a", status: "sent"}));
      });

  it("never lets a client write a container or a line", async () => {
    const {doc, setDoc, updateDoc} = require("firebase/firestore");
    const db = firestoreFor("owner-a");
    await assertFails(setDoc(doc(db, "containers/forged"),
        {businessId: "biz_a", label: "x", status: "shipped"}));
    await assertFails(updateDoc(doc(db, "containers/box_a"),
        {status: "shipped"}));
    await assertFails(setDoc(doc(db, "containerLines/forged"),
        {businessId: "biz_a", containerId: "box_a", kind: "car"}));
  });

  // Waiting packages are lines with no container; the console subscribes to
  // them by business and status, and to a package's payments by business and
  // line (two equalities, so no composite index).
  it("lets the lot read waiting packages and their payments, never write",
      async () => {
        const {query, collection, where, getDocs, doc, setDoc, updateDoc,
          deleteDoc} = require("firebase/firestore");
        await testEnv.withSecurityRulesDisabled(async (context) => {
          const db = context.firestore();
          await setDoc(doc(db, "containerLines/wait_a"),
              {businessId: "biz_a", containerId: "", kind: "barrels",
                containerStatus: "waiting", destinationCountryId: "gn",
                priceCents: 15000, paidCents: 5000});
          await setDoc(doc(db, "containerLinePayments/pay_a"),
              {businessId: "biz_a", lineId: "wait_a", amountCents: 5000,
                method: "cash", receivedByStaffId: "owner-a",
                reverted: false});
        });
        const owner = firestoreFor("owner-a");
        await assertSucceeds(getDocs(query(collection(owner, "containerLines"),
            where("businessId", "==", "biz_a"),
            where("containerStatus", "==", "waiting"))));
        await assertSucceeds(getDocs(query(
            collection(owner, "containerLinePayments"),
            where("businessId", "==", "biz_a"),
            where("lineId", "==", "wait_a"))));
        // Not by line alone: the rule authorises by business.
        await assertFails(getDocs(query(
            collection(owner, "containerLinePayments"),
            where("lineId", "==", "wait_a"))));
        await assertFails(getDocs(query(
            collection(owner, "containerLinePayments"),
            where("businessId", "==", "biz_b"))));
        await assertFails(getDocs(query(
            collection(firestoreFor("owner-b"), "containerLinePayments"),
            where("businessId", "==", "biz_a"))));
        // A client that could write here could write a package paid.
        await assertFails(setDoc(doc(owner, "containerLinePayments/forged"),
            {businessId: "biz_a", lineId: "wait_a", amountCents: 15000,
              method: "cash", reverted: false}));
        await assertFails(updateDoc(doc(owner, "containerLinePayments/pay_a"),
            {reverted: true}));
        await assertFails(deleteDoc(doc(owner,
            "containerLinePayments/pay_a")));
        await assertFails(updateDoc(doc(owner, "containerLines/wait_a"),
            {paidCents: 15000, containerStatus: "shipped"}));
        // Scan to load's marks are the server's alone, even for the owner
        // (a client that could write them could say a package is loaded).
        await assertFails(updateDoc(doc(owner, "containerLines/wait_a"),
            {loadScannedPieces: 3, loadAddedByScan: true,
              loadScanIds: ["forged-scan"]}));
        await assertFails(deleteDoc(doc(owner, "containerLines/wait_a")));
      });

  // The VIN lock is how two quick adds of one car are serialised. A client
  // that could write it could block a car from every container, or delete
  // the lock and load it twice; one that could read it learns nothing it
  // needs. Server-only, even for the business that owns it.
  it("keeps the container VIN locks server-only", async () => {
    const {doc, setDoc, getDoc, deleteDoc, getDocs, collection, query,
      where} = require("firebase/firestore");
    const lockId = "biz_a_1HGCM82633A004352";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `containerVinLocks/${lockId}`),
          {businessId: "biz_a", vinNumber: "1HGCM82633A004352",
            containerId: "box_a", lineId: "line_a"});
    });
    const owner = firestoreFor("owner-a");
    await assertFails(getDoc(doc(owner, `containerVinLocks/${lockId}`)));
    await assertFails(getDocs(query(collection(owner, "containerVinLocks"),
        where("businessId", "==", "biz_a"))));
    await assertFails(setDoc(doc(owner, "containerVinLocks/biz_a_FORGED1"),
        {businessId: "biz_a", vinNumber: "FORGED1", containerId: "box_a",
          lineId: "x"}));
    await assertFails(deleteDoc(doc(owner, `containerVinLocks/${lockId}`)));
    await assertFails(getDoc(doc(firestoreFor("owner-b"),
        `containerVinLocks/${lockId}`)));
  });

  // Monthly volume rollups are recounted by the server and read through
  // getPlatformVolume / getBusinessVolume, which decide who sees them. A
  // client that could write one could rewrite what the platform bills on;
  // even reading is left to the callables. Server-only for everyone.
  it("keeps the monthly volume rollups server-only", async () => {
    const {doc, setDoc, getDoc, deleteDoc, getDocs, collection, query,
      where} = require("firebase/firestore");
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "volumeMonthly/biz_a_2026-10"),
          {businessId: "biz_a", month: "2026-10", pieces: 40});
    });
    for (const uid of ["owner-a", "super-admin", "owner-b", null]) {
      const db = firestoreFor(uid);
      await assertFails(getDoc(doc(db, "volumeMonthly/biz_a_2026-10")));
      await assertFails(getDocs(query(collection(db, "volumeMonthly"),
          where("businessId", "==", "biz_a"))));
      await assertFails(getDocs(query(collection(db, "volumeMonthly"),
          where("month", "==", "2026-10"))));
      await assertFails(setDoc(doc(db, "volumeMonthly/biz_a_2026-10"),
          {businessId: "biz_a", month: "2026-10", pieces: 1}));
      await assertFails(setDoc(doc(db, "volumeMonthly/biz_a_2026-11"),
          {businessId: "biz_a", month: "2026-11", pieces: 999}));
      await assertFails(deleteDoc(doc(db, "volumeMonthly/biz_a_2026-10")));
    }
  });

  // Laawol bills (docs/PLATFORM_BILLING.md): deals, months and payments are
  // read and written only through platformBilling. A business must never
  // see or touch its own bill, and even a super admin goes through the
  // callable (which audits every change).
  it("keeps Laawol bills server-only", async () => {
    const {doc, setDoc, getDoc, deleteDoc, getDocs, collection, query,
      where} = require("firebase/firestore");
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const fs = context.firestore();
      await setDoc(doc(fs, "billingDeals/biz_a"), {businessId: "biz_a",
        commissionMode: "keep", versions: []});
      await setDoc(doc(fs, "billingMonths/biz_a_2026-09"), {
        businessId: "biz_a", month: "2026-09", status: "closed",
        amountCents: 5000, paidCents: 0, unpaidCents: 5000});
      await setDoc(doc(fs, "billingPayments/pay_1"), {businessId: "biz_a",
        month: "2026-09", amountCents: 100, voided: false});
    });
    for (const uid of ["owner-a", "super-admin", "owner-b", null]) {
      const db = firestoreFor(uid);
      await assertFails(getDoc(doc(db, "billingDeals/biz_a")));
      await assertFails(getDoc(doc(db, "billingMonths/biz_a_2026-09")));
      await assertFails(getDoc(doc(db, "billingPayments/pay_1")));
      await assertFails(getDocs(query(collection(db, "billingMonths"),
          where("businessId", "==", "biz_a"))));
      await assertFails(getDocs(query(collection(db, "billingPayments"),
          where("businessId", "==", "biz_a"))));
      await assertFails(setDoc(doc(db, "billingDeals/biz_a"),
          {businessId: "biz_a", versions: []}));
      await assertFails(setDoc(doc(db, "billingMonths/biz_a_2026-09"),
          {businessId: "biz_a", status: "open", amountCents: 0}));
      await assertFails(setDoc(doc(db, "billingPayments/pay_2"),
          {businessId: "biz_a", month: "2026-09", amountCents: 999999}));
      await assertFails(deleteDoc(doc(db, "billingPayments/pay_1")));
    }
  });

  // Inventory (docs/INVENTORY.md): products, sales and stock movements are
  // read by the business's own managers as `where businessId == mine`
  // queries (a product also by code, a sale newest first, a product's
  // movements by item) and written only by the callables. A client that
  // could write a count or a sale could sell or restock for free.
  it("lets the shop read its inventory by query, and never write it",
      async () => {
        const {query, collection, where, orderBy, getDocs, doc, setDoc,
          updateDoc, deleteDoc} = require("firebase/firestore");
        await testEnv.withSecurityRulesDisabled(async (context) => {
          const db = context.firestore();
          await setDoc(doc(db, "inventoryItems/item_a"),
              {businessId: "biz_a", name: "Shea butter", code: "IT-K7M4P2",
                priceCents: 1000, quantity: 5, archived: false,
                documentToken: "secret-token-of-the-tag-link"});
          await setDoc(doc(db, "inventorySales/sale_a"),
              {businessId: "biz_a", totalCents: 1000, voided: false,
                createdAt: new Date("2026-10-10"), lines: []});
          await setDoc(doc(db, "inventoryMovements/move_a"),
              {businessId: "biz_a", itemId: "item_a", type: "sale",
                delta: -1, quantityAfter: 4,
                createdAt: new Date("2026-10-10")});
        });
        const owner = firestoreFor("owner-a");
        const shapes = [
          (db, b) => query(collection(db, "inventoryItems"),
              where("businessId", "==", b)),
          (db, b) => query(collection(db, "inventoryItems"),
              where("businessId", "==", b), where("code", "==", "IT-K7M4P2")),
          (db, b) => query(collection(db, "inventoryItems"),
              where("businessId", "==", b), where("archived", "==", false)),
          (db, b) => query(collection(db, "inventorySales"),
              where("businessId", "==", b), orderBy("createdAt", "desc")),
          (db, b) => query(collection(db, "inventoryMovements"),
              where("businessId", "==", b), where("itemId", "==", "item_a")),
        ];
        for (const shape of shapes) {
          await assertSucceeds(getDocs(shape(owner, "biz_a")));
          await assertFails(getDocs(shape(owner, "biz_b")));
          await assertFails(getDocs(shape(firestoreFor("owner-b"), "biz_a")));
          await assertFails(getDocs(shape(firestoreFor(null), "biz_a")));
        }
        for (const name of ["inventoryItems", "inventorySales",
          "inventoryMovements"]) {
          await assertFails(getDocs(query(collection(owner, name))));
        }
        // Every write is a callable's.
        await assertFails(setDoc(doc(owner, "inventoryItems/forged"),
            {businessId: "biz_a", name: "Free", priceCents: 1, quantity: 99}));
        await assertFails(updateDoc(doc(owner, "inventoryItems/item_a"),
            {quantity: 999}));
        await assertFails(deleteDoc(doc(owner, "inventoryItems/item_a")));
        await assertFails(setDoc(doc(owner, "inventorySales/forged"),
            {businessId: "biz_a", totalCents: 1, voided: false, lines: []}));
        await assertFails(updateDoc(doc(owner, "inventorySales/sale_a"),
            {voided: true}));
        await assertFails(deleteDoc(doc(owner, "inventorySales/sale_a")));
        await assertFails(setDoc(doc(owner, "inventoryMovements/forged"),
            {businessId: "biz_a", itemId: "item_a", type: "add", delta: 99}));
        await assertFails(updateDoc(doc(owner, "inventoryMovements/move_a"),
            {delta: 5}));
        await assertFails(deleteDoc(doc(owner, "inventoryMovements/move_a")));
      });

  // Categories and stores (v2). Once a business has two or more active
  // stores, a staff member reads only their home store's stock rows, sales
  // and stock movements; the owner, a platform admin and staff with
  // all-stores access read everything; and a business that is not
  // multi-store reads exactly as before. Nothing here is client-writable.
  describe("inventory categories and stores", () => {
    const {query, collection, where, orderBy, limit, getDocs, getDoc, doc,
      setDoc, updateDoc, deleteDoc} = require("firebase/firestore");

    async function seedStores({multiStore}) {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        const put = (p, data) => setDoc(doc(db, p), data);
        await Promise.all([
          put("users/inv-clerk-annex", {role: "staff", businessId: "biz_a",
            businessPermissions: ["inventory"],
            inventoryHomeStoreId: "store_annex"}),
          put("users/inv-clerk-main", {role: "staff", businessId: "biz_a",
            businessPermissions: ["inventory"],
            inventoryHomeStoreId: "store_main"}),
          put("users/inv-clerk-none", {role: "staff", businessId: "biz_a",
            businessPermissions: ["inventory"]}),
          put("users/inv-clerk-empty", {role: "staff", businessId: "biz_a",
            businessPermissions: ["inventory"], inventoryHomeStoreId: ""}),
          put("users/inv-rover", {role: "staff", businessId: "biz_a",
            businessPermissions: ["inventory"], inventoryAllStores: true}),
          put("users/inv-clerk-b", {role: "staff", businessId: "biz_b",
            businessPermissions: ["inventory"],
            inventoryHomeStoreId: "store_annex"}),
          put("inventoryConfig/biz_a", {businessId: "biz_a",
            storesConverted: true, mainStoreId: "store_main", multiStore}),
          put("inventoryCategoryKeys/lock1", {businessId: "biz_a",
            categoryId: "cat_a"}),
          put("inventoryCategories/cat_a", {businessId: "biz_a",
            name: "Skin", nameKey: "skin", archived: false}),
          put("inventoryBrandKeys/lock1", {businessId: "biz_a",
            brandId: "brand_a"}),
          put("inventoryBrands/brand_a", {businessId: "biz_a",
            name: "Jordan", nameKey: "jordan", archived: false}),
          put("inventoryStores/store_main", {businessId: "biz_a",
            name: "Main store", isMain: true, archived: false}),
          put("inventoryStores/store_annex", {businessId: "biz_a",
            name: "Annex", isMain: false, archived: false}),
          put("inventoryStock/item_a__store_main", {businessId: "biz_a",
            itemId: "item_a", storeId: "store_main", quantity: 4}),
          put("inventoryStock/item_a__store_annex", {businessId: "biz_a",
            itemId: "item_a", storeId: "store_annex", quantity: 2}),
          put("inventorySales/sale_main", {businessId: "biz_a",
            storeId: "store_main", totalCents: 1000, voided: false,
            createdAt: new Date("2026-10-10"), lines: []}),
          put("inventorySales/sale_annex", {businessId: "biz_a",
            storeId: "store_annex", totalCents: 500, voided: false,
            createdAt: new Date("2026-10-10"), lines: []}),
          put("inventorySales/sale_legacy", {businessId: "biz_a",
            totalCents: 700, voided: false,
            createdAt: new Date("2026-10-01"), lines: []}),
          put("inventoryMovements/move_annex", {businessId: "biz_a",
            itemId: "item_a", storeId: "store_annex", type: "sale",
            createdAt: new Date("2026-10-10")}),
        ]);
      });
    }

    const stockQuery = (db, storeId) => query(collection(db, "inventoryStock"),
        where("businessId", "==", "biz_a"),
        ...(storeId ? [where("storeId", "==", storeId)] : []));
    const salesQuery = (db, storeId) => query(collection(db, "inventorySales"),
        where("businessId", "==", "biz_a"),
        ...(storeId ? [where("storeId", "==", storeId)] : []),
        orderBy("createdAt", "desc"));
    const movesQuery = (db, storeId) => query(
        collection(db, "inventoryMovements"),
        where("businessId", "==", "biz_a"), where("itemId", "==", "item_a"),
        ...(storeId ? [where("storeId", "==", storeId)] : []));

    it("limits staff to their home store once there are several stores",
        async () => {
          await seedStores({multiStore: true});
          const annex = firestoreFor("inv-clerk-annex");
          for (const [ask, id] of [[stockQuery, 1], [salesQuery, 1],
            [movesQuery, 1]]) {
            const mine = await assertSucceeds(getDocs(ask(annex,
                "store_annex")));
            assert.equal(mine.size, id);
            assert.equal(mine.docs[0].data().storeId, "store_annex");
            await assertFails(getDocs(ask(annex, "store_main")));
            // An unscoped list cannot be proven to stay in the store.
            await assertFails(getDocs(ask(annex, null)));
          }
          // Reading one document: own store's yes, the other's no.
          await assertSucceeds(getDoc(doc(annex,
              "inventoryStock/item_a__store_annex")));
          await assertFails(getDoc(doc(annex,
              "inventoryStock/item_a__store_main")));
          await assertSucceeds(getDoc(doc(annex, "inventorySales/sale_annex")));
          await assertFails(getDoc(doc(annex, "inventorySales/sale_main")));
          // A sale from before stores existed has no store: staff do not see
          // it, the owner does.
          await assertFails(getDoc(doc(annex, "inventorySales/sale_legacy")));
          // The clerk of another store sees theirs, not the annex's.
          const main = firestoreFor("inv-clerk-main");
          await assertSucceeds(getDocs(stockQuery(main, "store_main")));
          await assertFails(getDocs(stockQuery(main, "store_annex")));
        });

    it("shows nothing to staff with no home store, in a multi-store business",
        async () => {
          await seedStores({multiStore: true});
          for (const uid of ["inv-clerk-none", "inv-clerk-empty"]) {
            const db = firestoreFor(uid);
            for (const ask of [stockQuery, salesQuery, movesQuery]) {
              await assertFails(getDocs(ask(db, null)));
              await assertFails(getDocs(ask(db, "store_annex")));
              await assertFails(getDocs(ask(db, "")));
            }
            await assertFails(getDoc(doc(db, "inventorySales/sale_legacy")));
          }
        });

    it("shows everything to the owner, an admin and all-stores staff",
        async () => {
          await seedStores({multiStore: true});
          for (const uid of ["owner-a", "super-admin", "inv-rover"]) {
            const db = firestoreFor(uid);
            assert.equal((await assertSucceeds(getDocs(stockQuery(db, null))))
                .size, 2, uid);
            assert.equal((await assertSucceeds(getDocs(salesQuery(db, null))))
                .size, 3, uid);
            assert.equal((await assertSucceeds(getDocs(movesQuery(db, null))))
                .size, 1, uid);
            await assertSucceeds(getDocs(stockQuery(db, "store_main")));
            await assertSucceeds(getDoc(doc(db, "inventorySales/sale_legacy")));
          }
          // Another business's people never see these.
          for (const uid of ["owner-b", "inv-clerk-b", "customer-owner"]) {
            const db = firestoreFor(uid);
            await assertFails(getDocs(stockQuery(db, "store_annex")));
            await assertFails(getDocs(salesQuery(db, null)));
          }
          await assertFails(getDocs(stockQuery(firestoreFor(null), null)));
        });

    it("reads as before while the business has fewer than two stores",
        async () => {
          await seedStores({multiStore: false});
          for (const uid of ["inv-clerk-none", "inv-clerk-annex",
            "inv-clerk-empty"]) {
            const db = firestoreFor(uid);
            assert.equal((await assertSucceeds(getDocs(stockQuery(db, null))))
                .size, 2, uid);
            assert.equal((await assertSucceeds(getDocs(salesQuery(db, null))))
                .size, 3, uid);
            await assertSucceeds(getDocs(movesQuery(db, null)));
            await assertSucceeds(getDoc(doc(db, "inventorySales/sale_legacy")));
          }
          await assertFails(getDocs(salesQuery(firestoreFor("owner-b"), null)));
        });

    it("reads as before for a business that never had stores", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, "inventorySales/sale_old"), {businessId: "biz_a",
          totalCents: 100, voided: false, createdAt: new Date("2026-10-01"),
          lines: []});
      });
      const owner = firestoreFor("owner-a");
      assert.equal((await assertSucceeds(getDocs(salesQuery(owner, null))))
          .size, 1);
    });

    // Credit payments (v4) are read by whoever may read their sale - the
    // sale's store travels on each row - and written only by the callables.
    it("reads credit payments like their sale, and never writes them",
        async () => {
          await seedStores({multiStore: true});
          await testEnv.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            const put = (p, data) => setDoc(doc(db, p), data);
            await Promise.all([
              put("inventoryCreditPayments/pay_annex", {businessId: "biz_a",
                saleId: "sale_annex", storeId: "store_annex",
                amountCents: 200, reverted: false,
                createdAt: new Date("2026-10-11")}),
              put("inventoryCreditPayments/pay_main", {businessId: "biz_a",
                saleId: "sale_main", storeId: "store_main", amountCents: 300,
                reverted: false, createdAt: new Date("2026-10-11")}),
            ]);
          });
          const paysOf = (db, saleId, storeId) => query(
              collection(db, "inventoryCreditPayments"),
              where("businessId", "==", "biz_a"),
              ...(storeId ? [where("storeId", "==", storeId)] : []),
              where("saleId", "==", saleId));
          const historyOf = (db, storeId) => query(
              collection(db, "inventoryCreditPayments"),
              where("businessId", "==", "biz_a"),
              ...(storeId ? [where("storeId", "==", storeId)] : []),
              orderBy("createdAt", "desc"));
          const annex = firestoreFor("inv-clerk-annex");
          assert.equal((await assertSucceeds(getDocs(paysOf(annex,
              "sale_annex", "store_annex")))).size, 1);
          await assertSucceeds(getDocs(historyOf(annex, "store_annex")));
          await assertFails(getDocs(paysOf(annex, "sale_main", "store_main")));
          await assertFails(getDocs(paysOf(annex, "sale_annex", null)));
          await assertFails(getDocs(historyOf(annex, null)));
          await assertSucceeds(getDoc(doc(annex,
              "inventoryCreditPayments/pay_annex")));
          await assertFails(getDoc(doc(annex,
              "inventoryCreditPayments/pay_main")));
          for (const uid of ["owner-a", "inv-rover"]) {
            const db = firestoreFor(uid);
            assert.equal((await assertSucceeds(getDocs(historyOf(db, null))))
                .size, 2, uid);
            await assertSucceeds(getDocs(paysOf(db, "sale_main", null)));
          }
          for (const uid of ["owner-b", "inv-clerk-b"]) {
            await assertFails(getDocs(historyOf(firestoreFor(uid), null)));
          }
          await assertFails(getDocs(historyOf(firestoreFor(null), null)));
          const owner = firestoreFor("owner-a");
          await assertFails(setDoc(doc(owner,
              "inventoryCreditPayments/forged"), {businessId: "biz_a",
            saleId: "sale_main", storeId: "store_main", amountCents: 1000,
            reverted: false}));
          await assertFails(updateDoc(doc(owner,
              "inventoryCreditPayments/pay_main"), {reverted: true}));
          await assertFails(deleteDoc(doc(owner,
              "inventoryCreditPayments/pay_main")));
        });

    // Store transfers (v5): read by whoever may see either end, written
    // only by the transfer callables.
    it("reads a transfer from either of its stores, and never writes one",
        async () => {
          await seedStores({multiStore: true});
          await testEnv.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            const put = (p, data) => setDoc(doc(db, p), data);
            const t = (from, to, stage) => ({businessId: "biz_a",
              fromStoreId: from, toStoreId: to, stage, status: stage,
              createdAt: new Date("2026-10-18"), lines: []});
            await Promise.all([
              put("inventoryTransfers/tr_out", t("store_annex", "store_main",
                  "in_transit")),
              put("inventoryTransfers/tr_in", t("store_main", "store_annex",
                  "review")),
              put("inventoryTransfers/tr_other", t("store_main", "store_depot",
                  "in_transit")),
            ]);
          });
          const open = (db, field, storeId) => query(
              collection(db, "inventoryTransfers"),
              where("businessId", "==", "biz_a"),
              ...(field ? [where(field, "==", storeId)] : []),
              where("stage", "in", ["draft", "in_transit", "review"]));
          const recent = (db, field, storeId) => query(
              collection(db, "inventoryTransfers"),
              where("businessId", "==", "biz_a"),
              ...(field ? [where(field, "==", storeId)] : []),
              orderBy("createdAt", "desc"), limit(50));
          const annex = firestoreFor("inv-clerk-annex");
          assert.equal((await assertSucceeds(getDocs(open(annex,
              "fromStoreId", "store_annex")))).size, 1);
          assert.equal((await assertSucceeds(getDocs(open(annex,
              "toStoreId", "store_annex")))).size, 1);
          await assertSucceeds(getDocs(recent(annex, "toStoreId",
              "store_annex")));
          await assertFails(getDocs(open(annex, null)));
          await assertFails(getDocs(recent(annex, "fromStoreId",
              "store_main")));
          await assertSucceeds(getDoc(doc(annex, "inventoryTransfers/tr_in")));
          await assertSucceeds(getDoc(doc(annex,
              "inventoryTransfers/tr_out")));
          await assertFails(getDoc(doc(annex, "inventoryTransfers/tr_other")));
          // No home store: nothing of a multi-store business.
          await assertFails(getDoc(doc(firestoreFor("inv-clerk-none"),
              "inventoryTransfers/tr_in")));
          for (const uid of ["owner-a", "inv-rover"]) {
            assert.equal((await assertSucceeds(getDocs(open(
                firestoreFor(uid), null)))).size, 3, uid);
          }
          for (const uid of ["owner-b", "inv-clerk-b", null]) {
            await assertFails(getDocs(open(firestoreFor(uid), null)));
          }
          const owner = firestoreFor("owner-a");
          await assertFails(setDoc(doc(owner, "inventoryTransfers/forged"),
              {businessId: "biz_a", fromStoreId: "store_main",
                toStoreId: "store_annex", stage: "in_transit"}));
          await assertFails(updateDoc(doc(owner, "inventoryTransfers/tr_in"),
              {stage: "done"}));
          await assertFails(deleteDoc(doc(owner,
              "inventoryTransfers/tr_out")));
        });

    it("lets managers list categories, brands and stores, nobody write",
        async () => {
          await seedStores({multiStore: true});
          for (const name of ["inventoryCategories", "inventoryBrands",
            "inventoryStores"]) {
            const list = (db, b) => getDocs(query(collection(db, name),
                where("businessId", "==", b)));
            for (const uid of ["owner-a", "inv-clerk-none",
              "inv-clerk-annex"]) {
              await assertSucceeds(list(firestoreFor(uid), "biz_a"));
            }
            await assertFails(list(firestoreFor("owner-b"), "biz_a"));
            await assertFails(list(firestoreFor(null), "biz_a"));
            await assertFails(getDocs(query(collection(
                firestoreFor("owner-a"), name))));
          }
          const owner = firestoreFor("owner-a");
          const writes = [
            ["inventoryCategories/forged", {businessId: "biz_a", name: "X"}],
            ["inventoryBrands/forged", {businessId: "biz_a", name: "X"}],
            ["inventoryStores/forged", {businessId: "biz_a", name: "X"}],
            ["inventoryStock/forged", {businessId: "biz_a", itemId: "i",
              storeId: "store_main", quantity: 99}],
            ["inventoryConfig/forged", {businessId: "biz_a",
              multiStore: false}],
            ["inventoryCategoryKeys/forged", {businessId: "biz_a"}],
            ["inventoryBrandKeys/forged", {businessId: "biz_a"}],
            ["inventorySaleNotifications/forged", {businessId: "biz_a"}],
          ];
          for (const [path, data] of writes) {
            await assertFails(setDoc(doc(owner, path), data));
          }
          await assertFails(updateDoc(doc(owner,
              "inventoryStock/item_a__store_main"), {quantity: 999}));
          await assertFails(deleteDoc(doc(owner,
              "inventoryStock/item_a__store_main")));
          await assertFails(updateDoc(doc(owner,
              "inventoryStores/store_main"), {archived: true}));
          await assertFails(updateDoc(doc(owner,
              "inventoryCategories/cat_a"), {name: "Renamed"}));
          await assertFails(updateDoc(doc(owner,
              "inventoryBrands/brand_a"), {name: "Renamed"}));
          await assertFails(deleteDoc(doc(owner,
              "inventoryBrands/brand_a")));
          await assertFails(deleteDoc(doc(owner,
              "inventoryBrandKeys/lock1")));
          await assertFails(deleteDoc(doc(owner,
              "inventoryStores/store_main")));
        });

    it("keeps the store bookkeeping out of every client's reach",
        async () => {
          await seedStores({multiStore: true});
          for (const uid of ["owner-a", "super-admin", "inv-rover"]) {
            const db = firestoreFor(uid);
            await assertFails(getDoc(doc(db, "inventoryConfig/biz_a")));
            await assertFails(getDoc(doc(db, "inventoryCategoryKeys/lock1")));
            await assertFails(getDoc(doc(db, "inventoryBrandKeys/lock1")));
            await assertFails(getDoc(doc(db,
                "inventorySaleNotifications/sale1")));
          }
        });

    // Zelle bank check: the sealed token, the feed cursor and the deposits
    // are the server's alone - not even the owner reads them directly.
    it("keeps the connected bank and its deposits server-only",
        async () => {
          await testEnv.withSecurityRulesDisabled(async (context) => {
            const admin = context.firestore();
            await setDoc(doc(admin, "businessBankLinks/biz_a"), {
              businessId: "biz_a", itemId: "item-1", status: "active",
              accessTokenEnc: "v1:sealed", accountMask: "1234"});
            await setDoc(doc(admin, "businessBankCredits/biz_a_t1"), {
              businessId: "biz_a", transactionId: "t1", amountCents: 4000,
              senderName: "Fatou Bah"});
          });
          for (const uid of ["owner-a", "super-admin", "inv-clerk-none",
            "owner-b", null]) {
            const db = firestoreFor(uid);
            await assertFails(getDoc(doc(db, "businessBankLinks/biz_a")));
            await assertFails(getDoc(doc(db,
                "businessBankCredits/biz_a_t1")));
            await assertFails(getDocs(query(collection(db,
                "businessBankCredits"), where("businessId", "==", "biz_a"))));
            await assertFails(getDocs(query(collection(db,
                "businessBankLinks"), where("businessId", "==", "biz_a"))));
            await assertFails(setDoc(doc(db, "businessBankLinks/biz_a"),
                {businessId: "biz_a", windowMinutes: 60}));
            await assertFails(updateDoc(doc(db,
                "businessBankCredits/biz_a_t1"),
            {consumedBy: {kind: "inventory_sale", id: "s"}}));
            await assertFails(deleteDoc(doc(db,
                "businessBankCredits/biz_a_t1")));
          }
        });

    it("keeps Check bank usage server-only (owner reads it by callable)",
        async () => {
          await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(),
                "businessBankUsage/biz_a_2026-10"), {businessId: "biz_a",
              month: "2026-10", checks: 3, refreshes: 1,
              byUid: {"inv-clerk-none": {checks: 3, refreshes: 1}}});
          });
          for (const uid of ["owner-a", "super-admin", "inv-clerk-none",
            "owner-b", null]) {
            const db = firestoreFor(uid);
            await assertFails(getDoc(doc(db,
                "businessBankUsage/biz_a_2026-10")));
            await assertFails(getDocs(query(collection(db,
                "businessBankUsage"), where("businessId", "==", "biz_a"))));
            await assertFails(setDoc(doc(db,
                "businessBankUsage/biz_a_2026-10"), {businessId: "biz_a",
              refreshes: 0}));
            await assertFails(updateDoc(doc(db,
                "businessBankUsage/biz_a_2026-10"), {refreshes: 0}));
            await assertFails(deleteDoc(doc(db,
                "businessBankUsage/biz_a_2026-10")));
          }
        });

    it("does not let a client write a payment's bankCheck", async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "inventorySales/bank_sale"), {
          businessId: "biz_a", paymentMethod: "zelle", totalCents: 4000,
          storeId: ""});
      });
      for (const uid of ["owner-a", "inv-clerk-none"]) {
        await assertFails(updateDoc(doc(firestoreFor(uid),
            "inventorySales/bank_sale"), {bankCheck: {status: "confirmed"}}));
      }
    });

    it("does not let staff give themselves a store or all-stores access",
        async () => {
          await seedStores({multiStore: true});
          const clerk = firestoreFor("inv-clerk-none");
          await assertFails(updateDoc(doc(clerk, "users/inv-clerk-none"),
              {inventoryHomeStoreId: "store_main"}));
          await assertFails(updateDoc(doc(clerk, "users/inv-clerk-none"),
              {inventoryAllStores: true}));
          const annex = firestoreFor("inv-clerk-annex");
          await assertFails(updateDoc(doc(annex, "users/inv-clerk-annex"),
              {inventoryHomeStoreId: "store_main"}));
          // The owner cannot write it from a client either: it is a
          // callable (setInventoryStaffAccess).
          await assertFails(updateDoc(doc(firestoreFor("owner-a"),
              "users/inv-clerk-none"), {inventoryHomeStoreId: "store_main"}));
        });
  });

  it("lets a business owner read their own private records only", async () => {
    const ownerDb = firestoreFor("owner-a");

    await assertSucceeds(ownerDb.doc("businesses/biz_a").get());
    await assertFails(ownerDb.doc("businesses/biz_b").get());
    await assertSucceeds(ownerDb.doc("parkedCars/park_a").get());
    await assertFails(ownerDb.doc("parkedCars/park_b").get());
  });

  // Business-entered parking (docs/PLAN-2026-08-backlog.md item 5): a
  // walk-up customer deliberately has no account, so the record carries no
  // customerUid. The rules must still let the lot create and read it, and
  // must still keep it scoped to the business and the parking section.
  it("lets the parking section create a walk-up entry with no customerUid",
      async () => {
        const entry = {
          businessId: "biz_a",
          trackingCode: "PK-WALKUP1",
          source: "business",
          customerName: "Walk-up Customer",
          customerPhone: "+19175550134",
          paymentMethod: "direct",
          status: "reserved",
          paymentStatus: "awaiting_direct_payment",
        };

        await assertSucceeds(
            firestoreFor("staff-parking-a")
                .doc("parkedCars/park_walkup_staff").set(entry),
        );
        await assertSucceeds(
            firestoreFor("owner-a")
                .doc("parkedCars/park_walkup_owner").set(entry),
        );
        await assertSucceeds(
            firestoreFor("owner-a").doc("parkedCars/park_walkup_staff").get(),
        );
        // Payment state is server-owned: "Mark payment received" and the
        // Stripe webhook write it through callables. The lot may still move
        // the car's status directly.
        await assertFails(
            firestoreFor("staff-parking-a")
                .doc("parkedCars/park_walkup_staff")
                .set({paymentStatus: "paid"}, {merge: true}),
        );
        await assertSucceeds(
            firestoreFor("staff-parking-a")
                .doc("parkedCars/park_walkup_staff")
                .set({status: "completed"}, {merge: true}),
        );

        // Still scoped: another business, staff without the parking
        // section, and a signed-in stranger all stay out.
        await assertFails(
            firestoreFor("owner-b")
                .doc("parkedCars/park_walkup_foreign").set(entry),
        );
        await assertFails(
            firestoreFor("staff-listings-a")
                .doc("parkedCars/park_walkup_denied").set(entry),
        );
        await assertFails(
            firestoreFor("customer-stranger")
                .doc("parkedCars/park_walkup_staff").get(),
        );
      });

  // The staff "car parked" alert names who parked it (notifyStaffOfParkedCar):
  // a direct write may name only the signed-in person, and never claim the
  // callable's `enteredByUid`.
  it("lets a direct parked-car write name only its own author", async () => {
    const entry = {
      businessId: "biz_a",
      trackingCode: "PC-SELF1",
      ownerName: "Walk-up Customer",
      status: "parked",
    };
    await assertSucceeds(firestoreFor("staff-parking-a")
        .doc("parkedCars/park_self_named")
        .set({...entry, createdByUid: "staff-parking-a"}));
    // Old app builds name nobody: still allowed (they just do not alert).
    await assertSucceeds(firestoreFor("staff-parking-a")
        .doc("parkedCars/park_self_unnamed").set(entry));
    await assertFails(firestoreFor("staff-parking-a")
        .doc("parkedCars/park_forged_creator")
        .set({...entry, createdByUid: "owner-a"}));
    await assertFails(firestoreFor("staff-parking-a")
        .doc("parkedCars/park_forged_entered")
        .set({...entry, enteredByUid: "staff-parking-a"}));
  });

  it("keeps the staff activity windows and claims server-only", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc("staffActivityAlerts/biz_a_car_staff-parking-a").set({
        businessId: "biz_a", kind: "car", actorUid: "staff-parking-a",
        pending: 3});
      await db.doc("staffActivityAlertClaims/car_park_a").set({
        businessId: "biz_a"});
    });
    for (const uid of ["owner-a", "staff-parking-a", "super-admin"]) {
      const db = firestoreFor(uid);
      await assertFails(
          db.doc("staffActivityAlerts/biz_a_car_staff-parking-a").get());
      await assertFails(db.doc("staffActivityAlertClaims/car_park_a").get());
      await assertFails(
          db.doc("staffActivityAlerts/biz_a_car_staff-parking-a")
              .set({pending: 0}, {merge: true}));
      await assertFails(db.doc("staffActivityAlertClaims/car_forged")
          .set({businessId: "biz_a"}));
    }
  });

  // The lot ledger's VIN duplicate locks (lot_ledger.js lotVinJobLockId):
  // a client that could delete one could record the same job twice.
  it("keeps the lot ledger's VIN/job locks server-only", async () => {
    const lock = "lotVinJobLocks/biz_a__1HGCM82633A004352__aa__bb";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(lock).set({
        businessId: "biz_a", activityId: "act_1",
        vinKey: "1HGCM82633A004352", jobKey: "dispatch",
        customerKey: "p:2015551234"});
    });
    for (const uid of ["owner-a", "staff-parking-a", "super-admin"]) {
      const db = firestoreFor(uid);
      await assertFails(db.doc(lock).get());
      await assertFails(db.collection("lotVinJobLocks")
          .where("businessId", "==", "biz_a").get());
      await assertFails(db.doc(lock).set({activityId: "forged"},
          {merge: true}));
      await assertFails(db.doc(lock).delete());
      await assertFails(db.doc("lotVinJobLocks/biz_a__new__cc__dd")
          .set({businessId: "biz_a", activityId: "act_2"}));
    }
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

  it("blocks in-transit on a container load until the container is known",
      async () => {
        // "In transit" is the point the customer starts asking where their
        // load is. The number can be saved manually (sandbox / no Terminal49)
        // or by subscribeToContainerTracking. Automated tracking is optional.
        const barrelStaff = firestoreFor("staff-barrels-a");
        await assertFails(
            barrelStaff.doc("barrelShipments/barrel_no_container").set({
              status: "in_transit",
            }, {merge: true}),
        );
        await assertSucceeds(
            barrelStaff.doc("barrelShipments/barrel_with_container").set({
              status: "in_transit",
            }, {merge: true}),
        );
        // Any other status stays reachable - the gate is on in_transit only,
        // so a business is never stuck unable to progress or cancel a load.
        await assertSucceeds(
            barrelStaff.doc("barrelShipments/barrel_no_container").set({
              status: "cancelled",
            }, {merge: true}),
        );
        await assertSucceeds(
            barrelStaff.doc("barrelShipments/barrel_no_container").set({
              status: "ready_for_pickup",
            }, {merge: true}),
        );
        // A short / fake-looking typed value does not satisfy the gate.
        await assertFails(
            barrelStaff.doc("barrelShipments/barrel_no_container").set({
              status: "in_transit",
              containerNumber: "AB",
            }, {merge: true}),
        );
        // Manual container / BOL, without trackingProvider:carrier_api.
        await assertSucceeds(
            barrelStaff.doc("barrelShipments/barrel_no_container").set({
              containerNumber: "BOL-SENEGAL-1",
            }, {merge: true}),
        );
        await assertSucceeds(
            barrelStaff.doc("barrelShipments/barrel_no_container").set({
              status: "in_transit",
            }, {merge: true}),
        );
        // One write can set both the number and in_transit.
        await assertSucceeds(
            barrelStaff.doc("barrelShipments/barrel_a").set({
              status: "in_transit",
              containerNumber: "MSKU9999999",
            }, {merge: true}),
        );
        // Automated tracking stays optional: the business cannot self-assert
        // a carrier_api subscription from the client.
        await assertFails(
            barrelStaff.doc("barrelShipments/barrel_a").set({
              trackingProvider: "carrier_api",
            }, {merge: true}),
        );
        // A Terminal49-owned number cannot be overwritten from the client.
        await assertFails(
            barrelStaff.doc("barrelShipments/barrel_carrier_tracked").set({
              containerNumber: "MANUAL9999",
            }, {merge: true}),
        );
        await assertSucceeds(
            barrelStaff.doc("barrelShipments/barrel_carrier_tracked").set({
              status: "in_transit",
            }, {merge: true}),
        );
        await assertFails(
            barrelStaff.doc("barrelShipments/barrel_a").set({
              price: 1,
              paymentStatus: "refunded",
            }, {merge: true}),
        );
      });

  it("gates sea freight on a container but leaves air freight alone",
      async () => {
        const freightStaff = firestoreFor("staff-freight-a");
        await assertFails(
            freightStaff.doc("freightShipments/freight_sea_no_container").set({
              status: "in_transit",
            }, {merge: true}),
        );
        await assertSucceeds(
            freightStaff.doc("freightShipments/freight_sea_with_container")
                .set({status: "in_transit"}, {merge: true}),
        );
        // Air freight has no container, so gating it would make air shipments
        // impossible to progress.
        await assertSucceeds(
            freightStaff.doc("freightShipments/freight_air_no_container").set({
              status: "in_transit",
            }, {merge: true}),
        );
        // Freight still cannot self-write a container number. Barrel's
        // manual-BOL path is the exception; sea freight stays on the
        // subscribe-or-already-on-file gate.
        await assertFails(
            freightStaff.doc("freightShipments/freight_sea_no_container").set({
              status: "in_transit",
              containerNumber: "SELF1234567",
            }, {merge: true}),
        );
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
        // Pay-on-arrival with a saved card: transit and arrival must write
        // so the charge trigger can run. Completion still waits for settled.
        await assertSucceeds(
            staffDb.doc("freightShipments/freight_v2_due_on_arrival").set({
              status: "in_transit",
            }, {merge: true}),
        );
        await assertSucceeds(
            staffDb.doc("freightShipments/freight_v2_due_on_arrival").set({
              status: "ready_for_pickup",
            }, {merge: true}),
        );
        await assertFails(
            staffDb.doc("freightShipments/freight_v2_due_on_arrival").set({
              status: "completed",
            }, {merge: true}),
        );
        await assertFails(
            staffDb.doc(
                "freightShipments/freight_v2_card_saved_awaiting_weight",
            ).set({status: "in_transit"}, {merge: true}),
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
          status: "completed",
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

describe("shipment tracking timeline Firestore rules", () => {
  it("lets the shipment's own customer and the business's staff read " +
      "a barrel shipment's tracking events", async () => {
    const customerDb = firestoreFor("customer-owner");
    const staffDb = firestoreFor("staff-barrels-a");

    await assertSucceeds(
        customerDb.doc("barrelShipments/barrel_a/trackingEvents/event_1")
            .get(),
    );
    await assertSucceeds(
        staffDb.doc("barrelShipments/barrel_a/trackingEvents/event_1").get(),
    );
  });

  it("denies a different customer or an unrelated business from reading " +
      "a barrel shipment's tracking events", async () => {
    const strangerDb = firestoreFor("customer-stranger");
    const otherBusinessStaffDb = firestoreFor("staff-transport-b");

    await assertFails(
        strangerDb.doc("barrelShipments/barrel_a/trackingEvents/event_1")
            .get(),
    );
    await assertFails(
        otherBusinessStaffDb
            .doc("barrelShipments/barrel_a/trackingEvents/event_1")
            .get(),
    );
  });

  it("applies the same rule to a freight shipment's tracking events",
      async () => {
        const customerDb = firestoreFor("customer-owner");
        const strangerDb = firestoreFor("customer-stranger");

        await assertSucceeds(
            customerDb
                .doc("freightShipments/freight_a/trackingEvents/event_1")
                .get(),
        );
        await assertFails(
            strangerDb
                .doc("freightShipments/freight_a/trackingEvents/event_1")
                .get(),
        );
      });

  it("denies direct client writes to a shipment's tracking events " +
      "(server-only via addShipmentTrackingMilestone)", async () => {
    const staffDb = firestoreFor("staff-barrels-a");
    await assertFails(
        staffDb.doc("barrelShipments/barrel_a/trackingEvents/event_2").set({
          label: "Forged update",
          source: "staff",
        }),
    );
    await assertFails(
        staffDb.doc("barrelShipments/barrel_a/trackingEvents/event_1")
            .update({label: "Edited"}),
    );
  });
});

describe("business review Firestore rules", () => {
  it("lets anyone read a review on an approved business", async () => {
    const anonDb = firestoreFor(null);
    await assertSucceeds(anonDb.doc("businesses/biz_a/reviews/review_1").get());
  });

  it("denies reading a review on a not-yet-approved business, " +
      "except its own author or staff", async () => {
    const anonDb = firestoreFor(null);
    const strangerDb = firestoreFor("customer-stranger");
    const authorDb = firestoreFor("customer-owner");

    await assertFails(
        anonDb.doc("businesses/biz_pending/reviews/review_2").get(),
    );
    await assertFails(
        strangerDb.doc("businesses/biz_pending/reviews/review_2").get(),
    );
    await assertSucceeds(
        authorDb.doc("businesses/biz_pending/reviews/review_2").get(),
    );
  });

  it("denies direct client writes to a review, even by its own author " +
      "or the reviewed business's staff", async () => {
    const authorDb = firestoreFor("customer-owner");
    const staffDb = firestoreFor("staff-listings-a");

    await assertFails(authorDb.doc("businesses/biz_a/reviews/review_1").set({
      businessId: "biz_a",
      customerUid: "customer-owner",
      rating: 1,
      comment: "Edited",
      moderationStatus: "published",
    }));
    await assertFails(
        staffDb.doc("businesses/biz_a/reviews/review_1").update({rating: 1}),
    );
    await assertFails(
        authorDb.doc("businesses/biz_a/reviews/review_1").delete(),
    );
    await assertFails(
        authorDb.doc("businesses/biz_a/reviews/review_new").set({
          businessId: "biz_a",
          customerUid: "customer-owner",
          rating: 5,
          comment: "New review",
          moderationStatus: "published",
        }),
    );
  });

  it("only lets the reviewed business's staff or an admin read who " +
      "flagged a review", async () => {
    const staffDb = firestoreFor("staff-listings-a");
    const otherBusinessStaffDb = firestoreFor("staff-transport-b");
    const adminDb = firestoreFor("super-admin");
    const authorDb = firestoreFor("customer-owner");

    await assertSucceeds(
        staffDb.doc(
            "businesses/biz_a/reviews/review_1/flags/staff-listings-a",
        ).get(),
    );
    await assertSucceeds(
        adminDb.doc(
            "businesses/biz_a/reviews/review_1/flags/staff-listings-a",
        ).get(),
    );
    await assertFails(
        otherBusinessStaffDb.doc(
            "businesses/biz_a/reviews/review_1/flags/staff-listings-a",
        ).get(),
    );
    await assertFails(
        authorDb.doc(
            "businesses/biz_a/reviews/review_1/flags/staff-listings-a",
        ).get(),
    );
  });

  it("denies direct client writes to a review's flags", async () => {
    const authorDb = firestoreFor("customer-owner");
    await assertFails(
        authorDb.doc("businesses/biz_a/reviews/review_1/flags/customer-owner")
            .set({uid: "customer-owner", reason: "Not real"}),
    );
  });

  // The businesses/{businessId}/reviews/{reviewId} rule above only
  // authorizes queries scoped to one specific business (a direct
  // subcollection reference or a get()) - it does NOT cover a true
  // collectionGroup('reviews') query spanning every business, which
  // Firestore only authorizes via a separate top-level {path=**} rule. This
  // gap is invisible to every .doc(...).get() test above (none of them
  // exercise collectionGroup), so it needs its own dedicated coverage - see
  // the {path=**}/reviews rule in firestore.rules.
  it("lets an admin list flagged reviews via a collectionGroup query, " +
      "but denies the same query to a non-admin", async () => {
    const adminDb = firestoreFor("super-admin");
    const staffDb = firestoreFor("staff-listings-a");

    const adminSnap = await assertSucceeds(
        adminDb.collectionGroup("reviews")
            .where("moderationStatus", "==", "flagged")
            .get(),
    );
    assert.deepEqual(
        adminSnap.docs.map((doc) => doc.id).sort(),
        ["review_flagged"],
    );

    await assertFails(
        staffDb.collectionGroup("reviews")
            .where("moderationStatus", "==", "flagged")
            .get(),
    );
  });

  it("lets a customer list their own reviews via a collectionGroup query, " +
      "but denies the same query for a different customer's uid", async () => {
    const authorDb = firestoreFor("customer-owner");
    const strangerDb = firestoreFor("customer-stranger");

    const ownSnap = await assertSucceeds(
        authorDb.collectionGroup("reviews")
            .where("customerUid", "==", "customer-owner")
            .get(),
    );
    assert.deepEqual(
        ownSnap.docs.map((doc) => doc.id).sort(),
        ["review_1", "review_2", "review_flagged"],
    );

    await assertFails(
        strangerDb.collectionGroup("reviews")
            .where("customerUid", "==", "customer-owner")
            .get(),
    );
  });

  it("denies an unfiltered collectionGroup query on reviews to anyone",
      async () => {
        const adminDb = firestoreFor("super-admin");
        await assertFails(adminDb.collectionGroup("reviews").get());
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
          status: "completed",
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

  it("lets the whole business read its WhatsApp threads", async () => {
    // docs/WHATSAPP_CONVERSATIONS.md: no Support permission needed.
    const listingStaffDb = firestoreFor("staff-listings-a");
    const ownerB = firestoreFor("owner-b");
    const customerDb = firestoreFor("customer-support");
    const waCase = "supportCases/wa_biz_a_224621000001";
    await assertSucceeds(listingStaffDb.doc(waCase).get());
    await assertSucceeds(
        listingStaffDb.collection(`${waCase}/messages`).get());
    await assertSucceeds(listingStaffDb.collection("supportCases")
        .where("businessId", "==", "biz_a")
        .where("caseType", "==", "whatsapp").get());
    await assertFails(ownerB.doc(waCase).get());
    await assertFails(customerDb.doc(waCase).get());
    // Still server-written only.
    await assertFails(listingStaffDb.doc(waCase)
        .set({status: "resolved"}, {merge: true}));
    // The routing and stop records are server-only.
    const ownerA = firestoreFor("owner-a");
    await assertFails(ownerA.doc("whatsappContacts/+224621000001").get());
    await assertFails(ownerA.doc("whatsappStops/+224621000001").get());
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

// ---------------------------------------------------------------------------
// Security audit regressions (2026-10). Each block failed before its fix.
// ---------------------------------------------------------------------------
describe("car purchase status is server-owned for businesses", () => {
  it("lets a purchases manager edit notes but never the status", async () => {
    const ownerDb = firestoreFor("owner-a");

    await assertSucceeds(ownerDb.doc("carPurchases/purchase_a").update({
      staffNotes: "Called the buyer back",
    }));
    // Terminal outcomes must go through businessFinalizeCarPurchase /
    // markPaidHoldSold / markPaidHoldNoShow, which move the car and queue
    // refunds. Before the fix every one of these succeeded.
    for (const purchaseStatus of [
      "completed",
      "no_show",
      "cancelled",
      "refunded",
      "forfeited",
    ]) {
      await assertFails(ownerDb.doc("carPurchases/purchase_a").update({
        purchaseStatus,
      }));
    }
    // Non-terminal states are payment- or negotiation-driven too
    // (reconciliation, actOnCarViewing); no client writes them directly.
    for (const purchaseStatus of [
      "reserved",
      "hold_review_required",
      "viewing_scheduled",
      "made_up_status",
    ]) {
      await assertFails(ownerDb.doc("carPurchases/purchase_a").update({
        purchaseStatus,
      }));
    }
    await assertFails(ownerDb.doc("carPurchases/purchase_a").update({
      staffNotes: 42,
    }));
    await assertFails(ownerDb.doc("carPurchases/purchase_a").update({
      paymentStatus: "succeeded",
    }));
    // Staff without the purchases section stay out entirely.
    await assertFails(
        firestoreFor("staff-listings-a").doc("carPurchases/purchase_a").update({
          staffNotes: "not mine",
        }),
    );
  });

  it("keeps the operations admin override", async () => {
    await assertSucceeds(
        firestoreFor("operations-admin").doc("carPurchases/purchase_a").update({
          purchaseStatus: "cancelled",
        }),
    );
  });
});

describe("billingConfig is a finance-only switch", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("billingConfig/settings").set({
        autoChargeEnabled: false,
      });
    });
  });

  it("lets super admins and finance admins write it", async () => {
    await assertSucceeds(
        firestoreFor("super-admin").doc("billingConfig/settings").set({
          autoChargeEnabled: true,
        }, {merge: true}),
    );
    await assertSucceeds(
        firestoreFor("finance-admin").doc("billingConfig/settings").set({
          autoChargeEnabled: false,
        }, {merge: true}),
    );
  });

  it("denies every other admin and every non-admin", async () => {
    for (const uid of [
      "operations-admin",
      "support-admin",
      "content-admin",
      "platform-admin",
      "owner-a",
      "customer-owner",
    ]) {
      await assertFails(
          firestoreFor(uid).doc("billingConfig/settings").set({
            autoChargeEnabled: true,
          }, {merge: true}),
      );
    }
    // Reading the switch stays open to admins.
    await assertSucceeds(
        firestoreFor("operations-admin").doc("billingConfig/settings").get(),
    );
    await assertFails(
        firestoreFor("owner-a").doc("billingConfig/settings").get(),
    );
  });
});

describe("parkedCars direct updates are limited to client fields", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("parkedCars/park_entry_a").set({
        businessId: "biz_a",
        source: "business",
        trackingCode: "PK-ENTRY1",
        status: "reserved",
        paymentMethod: "payment_link",
        paymentStatus: "awaiting_payment",
        totalCost: 120,
        amountPaidCents: 0,
      });
    });
  });

  it("allows what the app and console write", async () => {
    const ownerDb = firestoreFor("owner-a");
    const staffDb = firestoreFor("staff-parking-a");

    // Console updateParkingStatus: merge with the unchanged businessId.
    await assertSucceeds(staffDb.doc("parkedCars/park_a").set({
      businessId: "biz_a",
      status: "completed",
      updatedAt: new Date(),
    }, {merge: true}));
    // App legacy edit form on a staff-keyed record.
    await assertSucceeds(ownerDb.doc("parkedCars/park_a").update({
      ownerName: "Customer A",
      carMake: "Toyota",
      carModel: "Camry",
      carYear: "2019",
      vinNumber: "1HGCM82633A004352",
      parkingDate: new Date("2026-10-01T00:00:00Z"),
      parkingEndDate: new Date("2026-10-08T00:00:00Z"),
      totalCost: 70,
      status: "active",
    }));
    // A business-entered record still takes a status move.
    await assertSucceeds(staffDb.doc("parkedCars/park_entry_a").update({
      status: "cancelled",
      updatedAt: new Date(),
    }));
  });

  it("denies server-owned payment and identity fields", async () => {
    const ownerDb = firestoreFor("owner-a");
    for (const forged of [
      {amountPaidCents: 12000},
      {paymentStatus: "paid"},
      {parkingPayments: [{amountCents: 12000}]},
      {billingHistory: []},
      {recordedByStaffId: "owner-a"},
      {stripePaymentIntentId: "pi_forged"},
      {checkoutSessionId: "cs_forged"},
      {paymentLinkToken: "forged"},
      {customerUid: "customer-owner"},
      {businessId: "biz_b"},
    ]) {
      await assertFails(ownerDb.doc("parkedCars/park_entry_a").update(forged));
      await assertFails(ownerDb.doc("parkedCars/park_a").update(forged));
    }
    // An operations admin is held to the same list.
    await assertFails(
        firestoreFor("operations-admin").doc("parkedCars/park_a").update({
          amountPaidCents: 1,
        }),
    );
  });

  it("never lets a client void, un-void or move a voided car", async () => {
    const staffDb = firestoreFor("staff-parking-a");
    await assertFails(staffDb.doc("parkedCars/park_entry_a").update({
      voided: true,
    }));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("parkedCars/park_entry_a").set({
        voided: true, voidedByStaffId: "staff-parking-a", voidReason: "test",
      }, {merge: true});
    });
    await assertFails(staffDb.doc("parkedCars/park_entry_a").update({
      status: "cancelled",
      updatedAt: new Date(),
    }));
    await assertFails(staffDb.doc("parkedCars/park_entry_a").update({
      voided: false,
    }));
    // Still readable: a voided car stays on the record.
    await assertSucceeds(staffDb.doc("parkedCars/park_entry_a").get());
  });

  it("keeps a server-priced entry's dates and amount callable-only",
      async () => {
        const ownerDb = firestoreFor("owner-a");
        await assertFails(ownerDb.doc("parkedCars/park_entry_a").update({
          totalCost: 1,
        }));
        await assertFails(ownerDb.doc("parkedCars/park_entry_a").update({
          parkingEndDate: new Date("2027-01-01T00:00:00Z"),
        }));
      });
});

describe("lot ledger collections are callable-only", () => {
  it("denies every client write, even to ledger managers", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const name of [
        "lotActivityTypes",
        "lotActivities",
        "lotExpenseLines",
        "lotExpenseEntries",
      ]) {
        await db.doc(`${name}/seed_a`).set({businessId: "biz_a", amount: 1});
      }
    });

    for (const uid of ["owner-a", "operations-admin", "super-admin"]) {
      const db = firestoreFor(uid);
      for (const name of [
        "lotActivityTypes",
        "lotActivities",
        "lotExpenseLines",
        "lotExpenseEntries",
      ]) {
        await assertFails(db.doc(`${name}/forged_${uid}`).set({
          businessId: "biz_a",
          amount: 1,
        }));
        await assertFails(db.doc(`${name}/seed_a`).update({amount: 999}));
        await assertFails(db.doc(`${name}/seed_a`).delete());
      }
    }
    // Reads are unchanged.
    await assertSucceeds(firestoreFor("owner-a").doc("lotActivities/seed_a")
        .get());
    await assertFails(firestoreFor("owner-b").doc("lotActivities/seed_a")
        .get());
  });
});

describe("staff expense credit is callable-only", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc("staffExpenseRepayments/repay_a").set({
        businessId: "biz_a", staffId: "staff-parking-a", amountCents: 500,
        month: "2026-10", method: "cash", voided: false,
      });
      await db.doc("businesses/biz_a").set({
        staffParkingLinks: {"staff-parking-a": {
          customerKey: "phone:2015551234", customerName: "A",
          customerPhone: "2015551234", linkedAtMs: 1, linkedByUid: "owner-a",
        }},
      }, {merge: true});
    });
  });

  it("lets the business's managers read repayments, nobody else", async () => {
    await assertSucceeds(firestoreFor("owner-a")
        .doc("staffExpenseRepayments/repay_a").get());
    await assertSucceeds(firestoreFor("staff-parking-a")
        .doc("staffExpenseRepayments/repay_a").get());
    await assertSucceeds(firestoreFor("owner-a")
        .collection("staffExpenseRepayments")
        .where("businessId", "==", "biz_a").get());
    await assertFails(firestoreFor("owner-b")
        .doc("staffExpenseRepayments/repay_a").get());
    await assertFails(firestoreFor("customer-stranger")
        .doc("staffExpenseRepayments/repay_a").get());
    await assertFails(firestoreFor(null)
        .doc("staffExpenseRepayments/repay_a").get());
  });

  it("denies every client write to repayments", async () => {
    for (const uid of ["owner-a", "staff-parking-a", "super-admin"]) {
      const db = firestoreFor(uid);
      await assertFails(db.doc(`staffExpenseRepayments/forged_${uid}`).set({
        businessId: "biz_a", staffId: "staff-parking-a", amountCents: 1,
      }));
      await assertFails(db.doc("staffExpenseRepayments/repay_a")
          .update({voided: true}));
      await assertFails(db.doc("staffExpenseRepayments/repay_a").delete());
    }
  });

  it("shows staffParkingLinks to managers and lets no manager write it",
      async () => {
        const owner = firestoreFor("owner-a");
        const snap = await assertSucceeds(owner.doc("businesses/biz_a").get());
        assert.equal(
            snap.data().staffParkingLinks["staff-parking-a"].customerKey,
            "phone:2015551234");
        await assertFails(firestoreFor("owner-b").doc("businesses/biz_a")
            .get());
        for (const uid of ["owner-a", "staff-parking-a",
          "staff-profile-a"]) {
          const db = firestoreFor(uid);
          await assertFails(db.doc("businesses/biz_a").update({
            "staffParkingLinks.staff-parking-a.customerKey": "name:someone",
          }));
          await assertFails(db.doc("businesses/biz_a").set({
            staffParkingLinks: {[uid]: {customerKey: "name:me"}},
          }, {merge: true}));
        }
      });
});

describe("user folder Storage rules", () => {
  function putUserFile(storage, uid, fileName, options = {}) {
    return storage.ref(`users/${uid}/profile/${fileName}`).put(
        imageBytes(options.size),
        {contentType: options.contentType || "image/jpeg"},
    );
  }

  it("lets the owner upload an image and read it back", async () => {
    await assertSucceeds(
        putUserFile(storageFor("customer-owner"), "customer-owner", "me.jpg"),
    );
    await assertSucceeds(
        storageFor("customer-owner")
            .ref("users/customer-owner/profile/me.jpg").getMetadata(),
    );
    await assertSucceeds(
        storageFor("super-admin")
            .ref("users/customer-owner/profile/me.jpg").getMetadata(),
    );
  });

  it("denies other users, non-images, and oversized files", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await putUserFile(context.storage(), "customer-owner", "saved.jpg");
    });
    // Before the fix any signed-in user could read every user's folder.
    await assertFails(
        storageFor("customer-stranger")
            .ref("users/customer-owner/profile/saved.jpg").getMetadata(),
    );
    await assertFails(
        storageFor(null)
            .ref("users/customer-owner/profile/saved.jpg").getMetadata(),
    );
    await assertFails(
        putUserFile(storageFor("customer-stranger"), "customer-owner", "x.jpg"),
    );
    await assertFails(
        putUserFile(storageFor("customer-owner"), "customer-owner", "x.html", {
          contentType: "text/html",
        }),
    );
    await assertFails(
        putUserFile(storageFor("customer-owner"), "customer-owner", "big.jpg", {
          size: 11 * 1024 * 1024,
        }),
    );
  });
});

describe("support attachment type allow-list", () => {
  it("refuses types and sizes the callable would refuse", async () => {
    for (const [fileName, contentType, size] of [
      ["clip.bin", "application/octet-stream", 16],
      ["page.html", "text/html", 16],
      ["tool.exe", "application/x-msdownload", 16],
      ["huge-photo.jpg", "image/jpeg", 10 * 1024 * 1024],
      ["huge-voice.m4a", "audio/mp4", 10 * 1024 * 1024],
      ["huge.pdf", "application/pdf", 25 * 1024 * 1024],
    ]) {
      await assertFails(
          putSupportAttachment(
              storageFor("customer-support"),
              "case_a",
              "customer-support",
              fileName,
              {contentType, size},
          ),
      );
    }
    for (const [fileName, contentType] of [
      ["voice.m4a", "audio/mp4"],
      ["letter.docx",
        "application/vnd.openxmlformats-officedocument" +
          ".wordprocessingml.document"],
    ]) {
      await assertSucceeds(
          putSupportAttachment(
              storageFor("customer-support"),
              "case_a",
              "customer-support",
              fileName,
              {contentType},
          ),
      );
    }
  });
});

describe("lot expense receipt Storage rules", () => {
  function putReceipt(storage, businessId, fileName, options = {}) {
    return storage.ref(`lotExpenseProofs/${businessId}/${fileName}`).put(
        imageBytes(options.size),
        {contentType: options.contentType || "image/jpeg"},
    );
  }

  it("accepts a photo or a PDF from a ledger manager", async () => {
    await assertSucceeds(putReceipt(storageFor("owner-a"), "biz_a", "r.jpg"));
    await assertSucceeds(putReceipt(storageFor("owner-a"), "biz_a", "r.pdf", {
      contentType: "application/pdf",
    }));
    await assertSucceeds(
        putReceipt(storageFor("operations-admin"), "biz_a", "ops.png", {
          contentType: "image/png",
        }),
    );
  });

  it("refuses other types, oversized files, and other businesses",
      async () => {
        for (const contentType of [
          "text/html",
          "video/mp4",
          "application/octet-stream",
          "application/zip",
        ]) {
          await assertFails(
              putReceipt(storageFor("owner-a"), "biz_a", "bad", {contentType}),
          );
        }
        await assertFails(
            putReceipt(storageFor("owner-a"), "biz_a", "huge.pdf", {
              contentType: "application/pdf",
              size: 20 * 1024 * 1024,
            }),
        );
        await assertFails(putReceipt(storageFor("owner-b"), "biz_a", "x.jpg"));
      });
});

// Customer package requests (docs/PACKAGE_REQUESTS.md §8.3, §8.4). The
// console and the app read requests as `where businessId == mine` queries;
// the app's "My requests" as `where sender.uid == me`. Every write is a
// callable.
describe("package request rules", () => {
  async function seedRequests() {
    const {doc, setDoc} = require("firebase/firestore");
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "users/staff-containers-a"), {role: "staff",
        businessId: "biz_a", businessPermissions: ["containers"]});
      await setDoc(doc(db, "packageRequests/req_a"), {businessId: "biz_a",
        status: "new", code: "R-K7M4P", token: "t".repeat(43),
        sender: {name: "Fatou", phoneE164: "+16465550100",
          uid: "customer-owner"}});
      await setDoc(doc(db, "packageRequests/req_anon"), {businessId: "biz_a",
        status: "new", sender: {name: "Guest", phoneE164: "+16465550101"}});
      await setDoc(doc(db, "packageRequestSlugs/dala"),
          {businessId: "biz_a"});
    });
  }

  it("lets the business's container people query their requests", async () => {
    const {query, collection, where, getDocs} = require("firebase/firestore");
    await seedRequests();
    for (const uid of ["owner-a", "staff-containers-a"]) {
      await assertSucceeds(getDocs(query(
          collection(firestoreFor(uid), "packageRequests"),
          where("businessId", "==", "biz_a"),
          where("status", "in", ["new", "estimate_sent", "confirmed"]))));
    }
    // Staff without the containers section, another business, no filter.
    await assertFails(getDocs(query(
        collection(firestoreFor("staff-barrels-a"), "packageRequests"),
        where("businessId", "==", "biz_a"))));
    await assertFails(getDocs(query(
        collection(firestoreFor("owner-b"), "packageRequests"),
        where("businessId", "==", "biz_a"))));
    await assertFails(getDocs(query(
        collection(firestoreFor("owner-a"), "packageRequests"))));
  });

  it("lets a signed-in customer read only their own requests", async () => {
    const {query, collection, where, getDocs, doc, getDoc} =
        require("firebase/firestore");
    await seedRequests();
    const customer = firestoreFor("customer-owner");
    await assertSucceeds(getDocs(query(
        collection(customer, "packageRequests"),
        where("sender.uid", "==", "customer-owner"))));
    await assertSucceeds(getDoc(doc(customer, "packageRequests/req_a")));
    await assertFails(getDoc(doc(customer, "packageRequests/req_anon")));
    await assertFails(getDoc(doc(firestoreFor("customer-stranger"),
        "packageRequests/req_a")));
    await assertFails(getDocs(query(
        collection(firestoreFor("customer-stranger"), "packageRequests"),
        where("sender.uid", "==", "customer-owner"))));
    await assertFails(getDoc(doc(firestoreFor(null),
        "packageRequests/req_a")));
  });

  it("never lets a client write a request or its bookkeeping", async () => {
    const {doc, setDoc, updateDoc, getDoc} = require("firebase/firestore");
    await seedRequests();
    const owner = firestoreFor("owner-a");
    await assertFails(setDoc(doc(owner, "packageRequests/forged"),
        {businessId: "biz_a", status: "confirmed"}));
    await assertFails(updateDoc(doc(owner, "packageRequests/req_a"),
        {status: "confirmed"}));
    await assertFails(updateDoc(doc(firestoreFor("customer-owner"),
        "packageRequests/req_a"), {status: "confirmed"}));
    for (const path of ["packageRequestSlugs/dala",
      "packageRequestCodes/R-K7M4P", "packageRequestKeys/k"]) {
      await assertFails(getDoc(doc(owner, path)));
      await assertFails(setDoc(doc(owner, path), {businessId: "biz_a"}));
    }
  });

  function putRequestPhoto(storage, businessId, uploader, fileName,
      options = {}) {
    return storage.ref(
        `packageRequestPhotos/${businessId}/${uploader}/${fileName}`).put(
        imageBytes(options.size), {contentType: options.contentType ||
          "image/jpeg"});
  }
  const anonymous = (uid) => storageForToken(uid,
      {firebase: {sign_in_provider: "anonymous"}});

  it("lets an anonymous customer upload images to their own folder only",
      async () => {
        await assertSucceeds(putRequestPhoto(anonymous("anon-1"), "biz_a",
            "anon-1", "photo-0001.jpg"));
        await assertSucceeds(putRequestPhoto(anonymous("anon-1"), "biz_a",
            "anon-1", "photo-0002.webp", {contentType: "image/webp"}));
        await assertFails(putRequestPhoto(anonymous("anon-1"), "biz_a",
            "anon-2", "photo-0003.jpg"));
        await assertFails(putRequestPhoto(storageFor(null), "biz_a",
            "anon-1", "photo-0004.jpg"));
        for (const contentType of ["image/gif", "text/html", "video/mp4",
          "application/pdf"]) {
          await assertFails(putRequestPhoto(anonymous("anon-1"), "biz_a",
              "anon-1", "photo-0005.jpg", {contentType}));
        }
        await assertFails(putRequestPhoto(anonymous("anon-1"), "biz_a",
            "anon-1", "photo-0006.jpg", {size: 2 * 1024 * 1024}));
        await assertFails(putRequestPhoto(anonymous("anon-1"), "biz_a",
            "anon-1", "bad name.jpg"));
        // Create only: no overwriting a photo once it is attached.
        await assertFails(putRequestPhoto(anonymous("anon-1"), "biz_a",
            "anon-1", "photo-0001.jpg"));
      });

  it("shows request photos to the uploader and the business's container " +
      "people only", async () => {
    await assertSucceeds(putRequestPhoto(anonymous("anon-1"), "biz_a",
        "anon-1", "photo-0101.jpg"));
    const path = "packageRequestPhotos/biz_a/anon-1/photo-0101.jpg";
    await assertSucceeds(anonymous("anon-1").ref(path).getMetadata());
    await assertSucceeds(storageFor("owner-a").ref(path).getMetadata());
    await assertSucceeds(storageForToken("staff-containers-a", {
      role: "staff", businessId: "biz_a",
      businessPermissions: ["containers"]}).ref(path).getMetadata());
    await assertFails(storageFor("staff-barrels-a").ref(path).getMetadata());
    await assertFails(storageFor("owner-b").ref(path).getMetadata());
    await assertFails(anonymous("anon-2").ref(path).getMetadata());
    await assertFails(anonymous("anon-1").ref(path).delete());
    // A deliveries-only agent sees them too (docs/AIR_PACKAGES.md §2).
    await assertSucceeds(storageForToken("staff-deliveries-a", {
      role: "staff", businessId: "biz_a",
      businessPermissions: ["deliveries"]}).ref(path).getMetadata());
  });
});

// Package photos (docs/AIR_PACKAGES.md §2 "Storage"): staff upload into
// their own uid folder, the business's container and delivery people read,
// nobody overwrites or deletes through the client.
describe("package photo rules", () => {
  const containers = () => storageForToken("staff-containers-a", {
    role: "staff", businessId: "biz_a", businessPermissions: ["containers"]});
  const deliveries = () => storageForToken("staff-deliveries-a", {
    role: "staff", businessId: "biz_a", businessPermissions: ["deliveries"]});
  function putPackagePhoto(storage, businessId, uploader, fileName,
      options = {}) {
    return storage.ref(
        `packagePhotos/${businessId}/${uploader}/${fileName}`).put(
        imageBytes(options.size), {contentType: options.contentType ||
          "image/jpeg"});
  }

  it("lets the owner, container and delivery staff upload to their own " +
      "folder only", async () => {
    await assertSucceeds(putPackagePhoto(storageFor("owner-a"), "biz_a",
        "owner-a", "photo-0001.jpg"));
    await assertSucceeds(putPackagePhoto(containers(), "biz_a",
        "staff-containers-a", "photo-0002.webp", {contentType: "image/webp"}));
    await assertSucceeds(putPackagePhoto(deliveries(), "biz_a",
        "staff-deliveries-a", "photo-0003.png", {contentType: "image/png"}));
    // Someone else's folder, the server's folders, another business.
    await assertFails(putPackagePhoto(containers(), "biz_a", "owner-a",
        "photo-0004.jpg"));
    await assertFails(putPackagePhoto(containers(), "biz_a", "req",
        "photo-0005.jpg"));
    await assertFails(putPackagePhoto(containers(), "biz_a", "wa",
        "photo-0006.jpg"));
    await assertFails(putPackagePhoto(containers(), "biz_b",
        "staff-containers-a", "photo-0007.jpg"));
    // Not a container person, not signed in.
    await assertFails(putPackagePhoto(storageFor("staff-barrels-a"), "biz_a",
        "staff-barrels-a", "photo-0008.jpg"));
    await assertFails(putPackagePhoto(storageFor(null), "biz_a", "owner-a",
        "photo-0009.jpg"));
    // Type, size and name.
    for (const contentType of ["image/gif", "text/html", "video/mp4",
      "application/pdf"]) {
      await assertFails(putPackagePhoto(containers(), "biz_a",
          "staff-containers-a", "photo-0010.jpg", {contentType}));
    }
    await assertFails(putPackagePhoto(containers(), "biz_a",
        "staff-containers-a", "photo-0011.jpg",
        {size: 2 * 1024 * 1024 + 1}));
    await assertFails(putPackagePhoto(containers(), "biz_a",
        "staff-containers-a", "bad name.jpg"));
    await assertFails(putPackagePhoto(containers(), "biz_a",
        "staff-containers-a", "short.jpg"));
    await assertFails(putPackagePhoto(containers(), "biz_a",
        "staff-containers-a", "photo-0012.gif"));
    // Create only: no overwriting a photo once it is attached.
    await assertFails(putPackagePhoto(storageFor("owner-a"), "biz_a",
        "owner-a", "photo-0001.jpg"));
  });

  it("shows package photos to the business's container and delivery " +
      "people and operations admins; nobody deletes", async () => {
    await assertSucceeds(putPackagePhoto(containers(), "biz_a",
        "staff-containers-a", "photo-0101.jpg"));
    const path = "packagePhotos/biz_a/staff-containers-a/photo-0101.jpg";
    await assertSucceeds(containers().ref(path).getMetadata());
    await assertSucceeds(deliveries().ref(path).getMetadata());
    await assertSucceeds(storageFor("owner-a").ref(path).getMetadata());
    await assertSucceeds(
        storageFor("operations-admin").ref(path).getMetadata());
    await assertFails(storageFor("staff-barrels-a").ref(path).getMetadata());
    await assertFails(storageFor("owner-b").ref(path).getMetadata());
    await assertFails(storageFor("content-admin").ref(path).getMetadata());
    await assertFails(storageFor("customer-owner").ref(path).getMetadata());
    await assertFails(storageFor(null).ref(path).getMetadata());
    await assertFails(containers().ref(path).delete());
    await assertFails(storageFor("owner-a").ref(path).delete());
    await assertFails(storageFor("super-admin").ref(path).delete());
  });
});

// Phone accounts (docs/PHONE_ACCOUNTS.md §6): customers still cannot read
// the records their number is on - only the phoneAccount callable projects
// them - and the sign-in state is server-only.
describe("phone account rules", () => {
  async function seedPhoneAccounts() {
    const {doc, setDoc} = require("firebase/firestore");
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "users/phone-customer"), {role: "customer",
        phone: "+12025550123", accountOrigin: "shipment",
        firstSignInAt: null});
      await setDoc(doc(db,
          "users/phone-customer/hiddenShipments/containerLines__l1"),
      {key: "containerLines/l1"});
      await setDoc(doc(db, "containerLines/phone-line"), {
        businessId: "biz_a", customerPhone: "+12025550123",
        customerPhoneE164: "+12025550123"});
      await setDoc(doc(db, "phoneLoginChallenges/c1"),
          {phoneE164: "+12025550123", codeHash: "x"});
      await setDoc(doc(db, "phoneLoginLimits/l1"), {count: 1});
      await setDoc(doc(db, "phoneAccountOptOuts/+12025550123"), {uid: "x"});
      await setDoc(doc(db, "phoneAccountClaims/+12025550123"),
          {uid: "phone-customer", profileReady: true});
    });
  }

  it("keeps the record itself and the sign-in state from the customer",
      async () => {
        await seedPhoneAccounts();
        const {doc, getDoc, setDoc, updateDoc, getDocs, query, collection,
          where} = require("firebase/firestore");
        const customer = firestoreFor("phone-customer");
        await assertFails(getDoc(doc(customer, "containerLines/phone-line")));
        await assertFails(getDocs(query(collection(customer,
            "containerLines"),
        where("customerPhoneE164", "==", "+12025550123"))));
        for (const path of ["phoneLoginChallenges/c1",
          "phoneLoginLimits/l1", "phoneAccountOptOuts/+12025550123",
          "phoneAccountClaims/+12025550123"]) {
          await assertFails(getDoc(doc(customer, path)));
          await assertFails(setDoc(doc(customer, path), {x: 1}));
        }
        // The profile's sign-in state is not the customer's to change.
        await assertFails(updateDoc(doc(customer, "users/phone-customer"),
            {firstSignInAt: new Date(), accountOrigin: "phone_sign_in"}));
        // Nor the phone-invited staff marker (docs/STAFF_PHONE_INVITES.md),
        // nor an invitation.
        await assertFails(updateDoc(doc(customer, "users/phone-customer"),
            {signInMethod: "phone"}));
        await assertFails(updateDoc(doc(customer, "users/phone-customer"),
            {phoneInvite: {phoneE164: "+12025550123"}}));
        await assertFails(setDoc(doc(customer, "accessInvitations/x"),
            {channel: "phone", phoneE164: "+12025550123"}));
        await assertFails(getDocs(query(collection(customer,
            "accessInvitations"), where("phoneE164", "==", "+12025550123"))));
      });

  it("lets the owner read, never write, what they hid", async () => {
    await seedPhoneAccounts();
    const {doc, getDoc, setDoc, deleteDoc} = require("firebase/firestore");
    const path = "users/phone-customer/hiddenShipments/containerLines__l1";
    await assertSucceeds(getDoc(doc(firestoreFor("phone-customer"), path)));
    await assertFails(getDoc(doc(firestoreFor("customer-owner"), path)));
    await assertFails(setDoc(doc(firestoreFor("phone-customer"),
        "users/phone-customer/hiddenShipments/x"), {key: "x"}));
    await assertFails(deleteDoc(doc(firestoreFor("phone-customer"), path)));
  });
});

// Parking customers on WhatsApp (docs/PARKING_WHATSAPP.md §2): the message
// rows are the business's to read and the server's alone to write, and the
// receipt PDFs in Storage are nobody's but the server's.
describe("parking WhatsApp rules", () => {
  async function seedParkingMessages() {
    const {doc, setDoc} = require("firebase/firestore");
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "parkingMessages/car_a_parked"), {
        businessId: "biz_a", parkedCarId: "car_a", kind: "parked",
        phone: "+12015551234", status: "sent", wamid: "wamid.1"});
      await setDoc(doc(db, "parkingMessages/car_a_pay_p_1"), {
        businessId: "biz_a", parkedCarId: "car_a", kind: "receipt",
        paymentId: "p_1", status: "failed"});
      await setDoc(doc(db, "parkingMessages/car_b_parked"), {
        businessId: "biz_b", parkedCarId: "car_b", kind: "parked",
        status: "sent"});
    });
  }

  it("lets the lot's owner and staff read its message rows, as a query",
      async () => {
        await seedParkingMessages();
        const {query, collection, where, getDocs, getDoc, doc} =
            require("firebase/firestore");
        for (const uid of ["owner-a", "staff-parking-a", "super-admin"]) {
          const db = firestoreFor(uid);
          await assertSucceeds(getDoc(doc(db, "parkingMessages/car_a_parked")));
          const rows = await assertSucceeds(getDocs(query(
              collection(db, "parkingMessages"),
              where("businessId", "==", "biz_a"),
              where("parkedCarId", "==", "car_a"))));
          assert.equal(rows.size, 2, uid);
        }
      });

  it("keeps another lot's rows, customers and the signed-out out",
      async () => {
        await seedParkingMessages();
        const {query, collection, where, getDocs, getDoc, doc} =
            require("firebase/firestore");
        for (const uid of ["owner-b", "staff-transport-b", "customer-owner",
          "support-admin", null]) {
          const db = firestoreFor(uid);
          await assertFails(getDoc(doc(db, "parkingMessages/car_a_parked")));
          await assertFails(getDocs(query(collection(db, "parkingMessages"),
              where("businessId", "==", "biz_a"))));
        }
        // Not even your own lot's, without saying which lot.
        await assertFails(getDocs(query(collection(firestoreFor("owner-a"),
            "parkingMessages"))));
      });

  it("never lets any client write a message row", async () => {
    await seedParkingMessages();
    const {doc, setDoc, updateDoc, deleteDoc} = require("firebase/firestore");
    for (const uid of ["owner-a", "staff-parking-a", "super-admin",
      "customer-owner", null]) {
      const db = firestoreFor(uid);
      await assertFails(setDoc(doc(db, "parkingMessages/forged"),
          {businessId: "biz_a", status: "sent"}));
      await assertFails(updateDoc(doc(db, "parkingMessages/car_a_parked"),
          {status: "failed"}));
      await assertFails(deleteDoc(doc(db, "parkingMessages/car_a_parked")));
    }
  });

  it("keeps the receipt PDFs from every client, read and write", async () => {
    const path = "parkingReceipts/biz_a/car_a/p_1.pdf";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.storage().ref(path).put(
          Buffer.from("%PDF-1.4 receipt"), {contentType: "application/pdf"});
    });
    for (const uid of ["owner-a", "staff-parking-a", "super-admin",
      "platform-admin", "customer-owner", null]) {
      const storage = storageFor(uid);
      await assertFails(storage.ref(path).getMetadata());
      await assertFails(storage.ref(path).getDownloadURL());
      await assertFails(storage.ref(path).put(Buffer.from("%PDF-1.4 x"),
          {contentType: "application/pdf"}));
      await assertFails(storage.ref(
          "parkingReceipts/biz_a/car_a/p_2.pdf").put(
          Buffer.from("%PDF-1.4 x"), {contentType: "application/pdf"}));
      await assertFails(storage.ref(path).delete());
    }
  });
});
