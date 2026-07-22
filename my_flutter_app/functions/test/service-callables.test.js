const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

const CUSTOMER_UID = "service-test-customer";
const OTHER_UID = "service-test-other";
const FINANCE_UID = "service-test-finance";
const DELETE_UID = "service-test-delete-own";
const DELETE_ADMIN_UID = "service-test-delete-admin";
const COUNTRY_ID = "gn";

const functions = require("../index");
admin.auth().getUser = async (uid) => ({
  uid,
  email: `${uid}@example.test`,
  emailVerified: true,
});
const db = admin.firestore();

function futureIso(hours = 24) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function futureDate(days = 1) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
}

async function seedBusiness(id, {
  status = "approved",
  services = [
    "barrelShipping",
    "sharedBarrels",
    "freight",
    "carSales",
    "carParking",
    "carTransport",
  ],
  destinationActive = true,
  barrelRate = 225,
  airRate = 12.5,
  seaRate = 5,
  serviceAvailability,
  freightPickup,
} = {}) {
  const ref = db.collection("businesses").doc(id);
  const availability = serviceAvailability || {
    barrelShipping: barrelRate > 0,
    freightAir: airRate > 0,
    freightSea: seaRate > 0,
    carTransport: true,
  };
  await Promise.all([
    ref.set({
      name: `Service Test ${id}`,
      status,
      enabledServices: services,
      city: "Bronx",
      addressLine1: "100 Test Avenue",
      ...(freightPickup || {}),
      parkingCity: "Bronx",
      parkingAddressLine1: "100 Test Avenue",
      parkingTotalSpaces: 5,
      parkingBlockedSpaces: 0,
      parkingDailyRate: 25,
      parkingWeeklyRate: 140,
      parkingMonthlyRate: 500,
      parkingMinimumDays: 1,
      parkingPickupAvailable: true,
      parkingPickupFee: 40,
    }),
    ref.collection("destinationCountries").doc(COUNTRY_ID).set({
      countryId: COUNTRY_ID,
      name: "Guinea",
      code: "GN",
      destinationCoverageVersion: 2,
      serviceAvailability: availability,
      isActive: destinationActive &&
        Object.values(availability).some(Boolean),
      barrelShippingPrice: barrelRate,
      freightAirPricePerKg: airRate,
      freightSeaPricePerKg: seaRate,
      carTransportAvailable: availability.carTransport,
      deliveryEstimateMinDays: 10,
      deliveryEstimateMaxDays: 20,
    }),
  ]);
  return ref;
}

function freightInput(businessId, overrides = {}) {
  return {
    senderName: "Test Sender",
    receiverName: "Test Receiver",
    receiverPhone: "+224620000001",
    destinationCountryId: COUNTRY_ID,
    businessId,
    mode: "air",
    weightKg: 10,
    pickupRequested: false,
    useWalletBalance: false,
    ...overrides,
  };
}

async function freightData(shipmentId) {
  const snapshot = await db.collection("freightShipments")
      .doc(shipmentId).get();
  assert.equal(snapshot.exists, true);
  return snapshot.data() || {};
}

async function seedFreightManager(businessId, {
  permissions = ["freight"],
} = {}) {
  const uid = `manager-${businessId}`;
  await db.collection("users").doc(uid).set({
    role: "staff",
    businessId,
    fullName: `Manager ${businessId}`,
    businessPermissions: permissions,
  });
  return {uid};
}

before(async () => {
  await Promise.all([
    db.collection("users").doc(CUSTOMER_UID).set({
      role: "customer",
      fullName: "Service Test Customer",
      email: `${CUSTOMER_UID}@example.test`,
    }),
    db.collection("users").doc(OTHER_UID).set({
      role: "customer",
      fullName: "Other Customer",
      email: `${OTHER_UID}@example.test`,
    }),
    db.collection("users").doc(FINANCE_UID).set({
      role: "admin",
      adminRole: "financeManager",
      fullName: "Finance Manager",
      email: `${FINANCE_UID}@example.test`,
    }),
    db.collection("users").doc(DELETE_UID).set({
      role: "customer",
      fullName: "Delete Own Customer",
      email: `${DELETE_UID}@example.test`,
    }),
    db.collection("users").doc(DELETE_ADMIN_UID).set({
      role: "admin",
      platformAdmin: true,
      adminRole: "superAdmin",
      fullName: "Delete Admin",
      email: `${DELETE_ADMIN_UID}@example.test`,
    }),
    db.collection("shipmentPricing").doc("barrelPickup").set({
      officeAddress: "Bronx Test Office",
      boroughPrices: {
        Bronx: 40,
        Manhattan: 64,
        Queens: 84,
        Brooklyn: 108,
        "Staten Island": 148,
      },
      freightPlatformFeePct: 0.1,
      barrelPlatformFeePct: 0.1,
    }),
    db.collection("shipmentPricing").doc("serviceFees").set({
      parkingPlatformFeePct: 0.1,
      carPurchasePlatformFeePct: 0.1,
      carDepositPlatformFeePct: 0.1,
    }),
  ]);
});

describe("self-service account deletion request", () => {
  const recentAuth = (uid) => ({
    uid,
    token: {auth_time: Math.floor(Date.now() / 1000)},
  });

  it("requires authentication and never accepts a target user ID", async () => {
    await assert.rejects(
        () => functions.requestOwnAccountDeletion.run({data: {}}),
        /Authentication is required/,
    );
    await assert.rejects(
        () => functions.requestOwnAccountDeletion.run({
          auth: recentAuth(DELETE_UID),
          data: {userId: OTHER_UID},
        }),
        /never accepts a target user ID/,
    );
  });

  it("blocks platform admins from deleting their own managed account",
      async () => {
        await assert.rejects(
            () => functions.requestOwnAccountDeletion.run({
              auth: recentAuth(DELETE_ADMIN_UID),
              data: {},
            }),
            /require another super admin/,
        );
      });

  it("records one idempotent in-app request for the signed-in user",
      async () => {
        const first = await functions.requestOwnAccountDeletion.run({
          auth: recentAuth(DELETE_UID),
          data: {},
        });
        const second = await functions.requestOwnAccountDeletion.run({
          auth: recentAuth(DELETE_UID),
          data: {},
        });
        assert.equal(first.success, true);
        assert.equal(first.status, "pending");
        assert.equal(second.success, true);
        assert.equal(second.status, "pending");

        const requestDoc = await db.collection("accountDeletionRequests")
            .doc(DELETE_UID).get();
        const userDoc = await db.collection("users").doc(DELETE_UID).get();
        assert.equal(requestDoc.exists, true);
        assert.equal(requestDoc.get("userId"), DELETE_UID);
        assert.equal(requestDoc.get("source"), "in_app");
        assert.equal(requestDoc.get("targetCompletionDays"), 30);
        assert.equal(userDoc.get("accountDeletionStatus"), "pending");
      });
});

describe("freight service callable lifecycle", () => {
  it("lists freight-only destinations without requiring a barrel rate",
      async () => {
        const businessId = "freight-only-discovery-business";
        await seedBusiness(businessId, {
          services: ["freight"],
          barrelRate: 0,
          serviceAvailability: {
            barrelShipping: false,
            freightAir: true,
            freightSea: true,
            carTransport: false,
          },
        });
        const result = await functions.listActiveBarrelDestinationOptions.run({
          data: {},
        });
        const option = result.options.find((row) =>
          row.businessId === businessId);
        assert.ok(option);
        assert.equal(option.country.barrelShippingPrice, 0);
        assert.equal(option.country.freightAirPricePerKg, 12.5);
        assert.equal(option.country.freightSeaPricePerKg, 5);
        assert.equal(option.businessAddress, "100 Test Avenue, Bronx");
      });

  it("rejects freight modes disabled for the destination", async () => {
    const businessId = "freight-mode-disabled-business";
    await seedBusiness(businessId, {
      serviceAvailability: {
        barrelShipping: false,
        freightAir: false,
        freightSea: true,
        carTransport: false,
      },
    });

    await assert.rejects(
        () => functions.createFreightShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: freightInput(businessId, {mode: "air"}),
        }),
        /no air freight rate yet/,
    );

    const sea = await functions.createFreightShipmentPaymentIntent.run({
      auth: {uid: CUSTOMER_UID},
      data: freightInput(businessId, {mode: "sea"}),
    });
    const seaShipment = await freightData(sea.shipmentId);
    assert.equal(seaShipment.mode, "sea");
    assert.equal(seaShipment.pricePerKg, 5);
  });

  it("books air and sea freight at the authoritative configured rate",
      async () => {
        const businessId = "freight-pricing-business";
        await seedBusiness(businessId);

        const air = await functions.createFreightShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: freightInput(businessId),
        });
        const airShipment = await freightData(air.shipmentId);
        assert.equal(air.simulatedPayment, true);
        assert.match(air.trackingCode, /^FR/);
        assert.equal(airShipment.mode, "air");
        assert.equal(airShipment.weightKg, 10);
        assert.equal(airShipment.pricePerKg, 12.5);
        assert.equal(airShipment.shippingFee, 125);
        assert.equal(airShipment.price, 125);
        assert.equal(airShipment.cardChargeAmountCents, 12500);
        assert.equal(airShipment.paymentStatus, "succeeded");
        assert.equal(airShipment.status, "awaiting_weight_confirmation");
        assert.equal(airShipment.freightPricingVersion, 2);
        assert.equal(airShipment.estimatedWeightKg, 10);
        assert.equal(airShipment.estimatedTotalCents, 12500);
        assert.equal(airShipment.priceSettlementStatus, "awaiting_weight");
        assert.equal(airShipment.destinationCountryName, "Guinea");
        assert.equal(airShipment.deliveryEstimateMinDays, 10);
        assert.equal(airShipment.deliveryEstimateMaxDays, 20);

        const sea = await functions.createFreightShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: freightInput(businessId, {mode: "sea", weightKg: 7.5}),
        });
        const seaShipment = await freightData(sea.shipmentId);
        assert.equal(seaShipment.mode, "sea");
        assert.equal(seaShipment.shippingFee, 37.5);
        assert.equal(seaShipment.cardChargeAmountCents, 3750);
      });

  it("prices a NY borough pickup and records its appointment", async () => {
    const businessId = "freight-pickup-business";
    await seedBusiness(businessId, {
      freightPickup: {
        // Borough pricing is New York only, so this business must be NY-based.
        state: "NY",
        freightPickupAvailable: true,
        freightPickupModel: "borough",
        freightPickupBoroughPrices: {Bronx: 40, Manhattan: 64},
      },
    });
    const result = await functions.createFreightShipmentPaymentIntent.run({
      auth: {uid: CUSTOMER_UID},
      data: freightInput(businessId, {
        mode: "sea",
        weightKg: 10,
        pickupRequested: true,
        pickupAddress: "200 Pickup Street, Bronx, NY",
        pickupBorough: "Bronx",
        pickupDateTime: futureIso(),
      }),
    });
    const shipment = await freightData(result.shipmentId);
    assert.equal(shipment.shippingFee, 50);
    assert.equal(shipment.pickupFee, 40);
    assert.equal(shipment.price, 90);
    assert.equal(shipment.cardChargeAmountCents, 9000);
    assert.equal(shipment.pickupRequested, true);
    assert.equal(shipment.pickupBorough, "Bronx");
    assert.equal(shipment.pickupModel, "borough");
    assert.ok(shipment.pickupDateTime);
  });

  it("rejects pickup when the business has not enabled it", async () => {
    const businessId = "freight-no-pickup-business";
    await seedBusiness(businessId);
    await assert.rejects(
        () => functions.createFreightShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: freightInput(businessId, {
            mode: "sea",
            weightKg: 10,
            pickupRequested: true,
            pickupAddress: "200 Pickup Street, Bronx, NY",
            pickupBorough: "Bronx",
            pickupDateTime: futureIso(),
          }),
        }),
        /pickup/i,
    );
  });

  it("applies wallet funds once and makes cancellation reversal idempotent",
      async () => {
        const businessId = "freight-wallet-business";
        await seedBusiness(businessId);
        await db.collection("wallets").doc(CUSTOMER_UID).set({
          customerUid: CUSTOMER_UID,
          currency: "usd",
          balanceCents: 2500,
          balance: 25,
        });
        const paid = await functions.createFreightShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: freightInput(businessId, {
            mode: "sea",
            weightKg: 10,
            useWalletBalance: true,
          }),
        });
        const paidShipment = await freightData(paid.shipmentId);
        assert.equal(paidShipment.walletAppliedCents, 2500);
        assert.equal(paidShipment.cardChargeAmountCents, 2500);
        const walletAfterDebit = await db.collection("wallets")
            .doc(CUSTOMER_UID).get();
        assert.equal(walletAfterDebit.get("balanceCents"), 0);

        const pendingRef = db.collection("freightShipments").doc();
        await pendingRef.set({
          customerUid: CUSTOMER_UID,
          businessId,
          businessName: "Freight Wallet Business",
          trackingCode: "FR-CANCEL-WALLET",
          paymentStatus: "pending",
          status: "pending_payment",
          walletAppliedCents: 2500,
        });
        await functions.cancelPendingFreightShipment.run({
          auth: {uid: CUSTOMER_UID},
          data: {shipmentId: pendingRef.id},
        });
        await functions.cancelPendingFreightShipment.run({
          auth: {uid: CUSTOMER_UID},
          data: {shipmentId: pendingRef.id},
        });
        const cancelled = await pendingRef.get();
        const walletAfterCancel = await db.collection("wallets")
            .doc(CUSTOMER_UID).get();
        assert.equal(cancelled.get("paymentStatus"), "cancelled");
        assert.equal(cancelled.get("walletAppliedReversed"), true);
        assert.equal(walletAfterCancel.get("balanceCents"), 2500);
      });

  it("rejects invalid freight inputs and unavailable configurations",
      async () => {
        const businessId = "freight-validation-business";
        await seedBusiness(businessId);
        const call = (overrides = {}, uid = CUSTOMER_UID) =>
          functions.createFreightShipmentPaymentIntent.run({
            auth: {uid},
            data: freightInput(businessId, overrides),
          });
        await assert.rejects(() => call({weightKg: 0}), /greater than zero/);
        await assert.rejects(
            () => call({receiverPhone: "not-a-phone"}),
            /Receiver phone must be a valid/,
        );
        await assert.rejects(
            () => call({mode: "rail"}),
            /Freight mode must be air or sea/,
        );
        await assert.rejects(
            () => call({
              pickupRequested: true,
              pickupAddress: "",
              pickupBorough: "",
              pickupDateTime: "",
            }),
            /Pickup address, date, and time are required/,
        );
        await assert.rejects(
            () => call({
              pickupRequested: true,
              pickupAddress: "200 Pickup Street",
              pickupBorough: "Bronx",
              pickupDateTime: new Date(Date.now() - 60000).toISOString(),
            }),
            /future/,
        );

        const disabledId = "freight-disabled-destination";
        await seedBusiness(disabledId, {destinationActive: false});
        await assert.rejects(
            () => functions.createFreightShipmentPaymentIntent.run({
              auth: {uid: CUSTOMER_UID},
              data: freightInput(disabledId),
            }),
            /Destination is unavailable/,
        );

        const noServiceId = "freight-no-service";
        await seedBusiness(noServiceId, {services: ["barrelShipping"]});
        await assert.rejects(
            () => functions.createFreightShipmentPaymentIntent.run({
              auth: {uid: CUSTOMER_UID},
              data: freightInput(noServiceId),
            }),
            /not accepting freight/,
        );

        const emptyServiceId = "freight-empty-services";
        await seedBusiness(emptyServiceId, {services: []});
        await assert.rejects(
            () => functions.createFreightShipmentPaymentIntent.run({
              auth: {uid: CUSTOMER_UID},
              data: freightInput(emptyServiceId),
            }),
            /not accepting freight/,
        );

        const noRateId = "freight-no-rate";
        await seedBusiness(noRateId, {airRate: 0});
        await assert.rejects(
            () => functions.createFreightShipmentPaymentIntent.run({
              auth: {uid: CUSTOMER_UID},
              data: freightInput(noRateId),
            }),
            /no air freight rate/,
        );
      });

  it("keeps completed freight immutable to another customer", async () => {
    const businessId = "freight-ownership-business";
    await seedBusiness(businessId);
    const result = await functions.createFreightShipmentPaymentIntent.run({
      auth: {uid: CUSTOMER_UID},
      data: freightInput(businessId),
    });
    await assert.rejects(
        () => functions.completeFreightShipmentPayment.run({
          auth: {uid: OTHER_UID},
          data: {shipmentId: result.shipmentId},
        }),
        /Shipment access denied/,
    );
    await assert.rejects(
        () => functions.cancelPendingFreightShipment.run({
          auth: {uid: OTHER_UID},
          data: {shipmentId: result.shipmentId},
        }),
        /Shipment access denied/,
    );
    const completion = await functions.completeFreightShipmentPayment.run({
      auth: {uid: CUSTOMER_UID},
      data: {shipmentId: result.shipmentId},
    });
    assert.equal(completion.success, true);
  });

  it("settles equal verified weight once and locks later corrections",
      async () => {
        const businessId = "freight-equal-settlement-business";
        await seedBusiness(businessId);
        const manager = await seedFreightManager(businessId);
        const booking = await functions.createFreightShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: freightInput(businessId, {weightKg: 10}),
        });
        const first = await functions.confirmFreightShipmentWeight.run({
          auth: manager,
          data: {shipmentId: booking.shipmentId, verifiedWeightKg: 10},
        });
        assert.equal(first.priceSettlementStatus, "settled");
        assert.equal(first.difference, 0);
        const shipment = await freightData(booking.shipmentId);
        assert.equal(shipment.verifiedWeightKg, 10);
        assert.equal(shipment.finalTotalCents, 12500);
        assert.equal(shipment.status, "pending");

        const duplicate = await functions.confirmFreightShipmentWeight.run({
          auth: manager,
          data: {shipmentId: booking.shipmentId, verifiedWeightKg: 10},
        });
        assert.equal(duplicate.priceSettlementStatus, "settled");
        await assert.rejects(
            () => functions.confirmFreightShipmentWeight.run({
              auth: manager,
              data: {shipmentId: booking.shipmentId, verifiedWeightKg: 11},
            }),
            /already locked/,
        );
      });

  it("blocks heavier freight until the customer pays the balance",
      async () => {
        const businessId = "freight-balance-settlement-business";
        await seedBusiness(businessId);
        const manager = await seedFreightManager(businessId);
        const booking = await functions.createFreightShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: freightInput(businessId, {weightKg: 10}),
        });
        const confirmed = await functions.confirmFreightShipmentWeight.run({
          auth: manager,
          data: {shipmentId: booking.shipmentId, verifiedWeightKg: 12},
        });
        assert.equal(confirmed.priceSettlementStatus, "balance_due");
        assert.equal(confirmed.balanceDue, 25);
        let shipment = await freightData(booking.shipmentId);
        assert.equal(shipment.status, "awaiting_balance_payment");
        assert.equal(shipment.payoutStatus, "awaiting_balance");

        const paid = await functions.createFreightSettlementPayment.run({
          auth: {uid: CUSTOMER_UID},
          data: {shipmentId: booking.shipmentId},
        });
        assert.equal(paid.simulatedPayment, true);
        assert.equal(paid.cardChargeAmount, 25);
        shipment = await freightData(booking.shipmentId);
        assert.equal(shipment.priceSettlementStatus, "settled");
        assert.equal(shipment.balancePaymentStatus, "succeeded");
        assert.equal(shipment.price, 150);
        assert.equal(shipment.status, "pending");

        const repeated = await functions.createFreightSettlementPayment.run({
          auth: {uid: CUSTOMER_UID},
          data: {shipmentId: booking.shipmentId},
        });
        assert.equal(repeated.alreadySettled, true);
      });

  it("converges simultaneous freight balance payment requests",
      async () => {
        const businessId = "freight-concurrent-settlement-business";
        await seedBusiness(businessId);
        const manager = await seedFreightManager(businessId);
        const booking = await functions.createFreightShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: freightInput(businessId, {weightKg: 10}),
        });
        const confirmed = await functions.confirmFreightShipmentWeight.run({
          auth: manager,
          data: {shipmentId: booking.shipmentId, verifiedWeightKg: 12},
        });

        const results = await Promise.all([
          functions.createFreightSettlementPayment.run({
            auth: {uid: CUSTOMER_UID},
            data: {shipmentId: booking.shipmentId},
          }),
          functions.createFreightSettlementPayment.run({
            auth: {uid: CUSTOMER_UID},
            data: {shipmentId: booking.shipmentId},
          }),
        ]);

        assert.equal(results.length, 2);
        const attempts = await db.collection("freightSettlements")
            .doc(confirmed.settlementId).collection("paymentAttempts").get();
        assert.equal(attempts.size, 1);
        const shipment = await freightData(booking.shipmentId);
        assert.equal(shipment.priceSettlementStatus, "settled");
        assert.equal(shipment.balancePaymentStatus, "succeeded");
      });

  it("refunds a lighter parcel card-first and restores wallet exactly once",
      async () => {
        const businessId = "freight-refund-settlement-business";
        await seedBusiness(businessId);
        const manager = await seedFreightManager(businessId);
        await db.collection("wallets").doc(CUSTOMER_UID).set({
          customerUid: CUSTOMER_UID,
          currency: "usd",
          balanceCents: 2500,
          balance: 25,
        });
        const booking = await functions.createFreightShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: freightInput(businessId, {
            weightKg: 10,
            useWalletBalance: true,
          }),
        });
        const confirmed = await functions.confirmFreightShipmentWeight.run({
          auth: manager,
          data: {shipmentId: booking.shipmentId, verifiedWeightKg: 1},
        });
        assert.equal(confirmed.priceSettlementStatus, "settled");
        assert.equal(confirmed.refundDue, 112.5);
        const settlement = await db.collection("freightSettlements")
            .doc(confirmed.settlementId).get();
        assert.equal(settlement.get("cardRefundedCents"), 10000);
        assert.equal(settlement.get("walletRefundedCents"), 1250);
        let wallet = await db.collection("wallets").doc(CUSTOMER_UID).get();
        assert.equal(wallet.get("balanceCents"), 1250);

        await functions.confirmFreightShipmentWeight.run({
          auth: manager,
          data: {shipmentId: booking.shipmentId, verifiedWeightKg: 1},
        });
        wallet = await db.collection("wallets").doc(CUSTOMER_UID).get();
        assert.equal(wallet.get("balanceCents"), 1250);
      });

  it("denies weight confirmation without the business freight permission",
      async () => {
        const businessId = "freight-permission-settlement-business";
        await seedBusiness(businessId);
        const noPermission = await seedFreightManager(businessId, {
          permissions: [],
        });
        const booking = await functions.createFreightShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: freightInput(businessId),
        });
        await assert.rejects(
            () => functions.confirmFreightShipmentWeight.run({
              auth: noPermission,
              data: {shipmentId: booking.shipmentId, verifiedWeightKg: 10},
            }),
            /not allowed to manage this section/,
        );
        await assert.rejects(
            () => functions.confirmFreightShipmentWeight.run({
              auth: {uid: OTHER_UID},
              data: {shipmentId: booking.shipmentId, verifiedWeightKg: 10},
            }),
            /Business access denied/,
        );
      });
});

describe("destination coverage admin callable", () => {
  it("saves service-specific coverage without requiring a barrel fee",
      async () => {
        const businessId = "destination-coverage-admin-business";
        await seedBusiness(businessId);

        const result = await functions.updateDestinationCoverage.run({
          auth: {uid: DELETE_ADMIN_UID},
          data: {
            businessId,
            countryId: COUNTRY_ID,
            isActive: true,
            barrelShippingPrice: 0,
            freightAirPricePerKg: 0,
            freightSeaPricePerKg: 7,
            serviceAvailability: {
              barrelShipping: false,
              freightAir: false,
              freightSea: true,
              carTransport: true,
            },
          },
        });

        assert.equal(result.success, true);
        assert.equal(result.isActive, true);
        assert.deepEqual(result.serviceAvailability, {
          barrelShipping: false,
          freightAir: false,
          freightSea: true,
          carTransport: true,
        });

        const doc = await db.collection("businesses").doc(businessId)
            .collection("destinationCountries").doc(COUNTRY_ID).get();
        assert.equal(doc.get("isActive"), true);
        assert.equal(doc.get("barrelShippingPrice"), 0);
        assert.equal(doc.get("freightSeaPricePerKg"), 7);
        assert.equal(doc.get("serviceAvailability.freightSea"), true);
        assert.equal(doc.get("serviceAvailability.carTransport"), true);
      });

  it("rejects enabled destination services with missing rates", async () => {
    const businessId = "destination-coverage-rate-required";
    await seedBusiness(businessId);

    await assert.rejects(
        () => functions.updateDestinationCoverage.run({
          auth: {uid: DELETE_ADMIN_UID},
          data: {
            businessId,
            countryId: COUNTRY_ID,
            isActive: true,
            barrelShippingPrice: 0,
            freightAirPricePerKg: 0,
            freightSeaPricePerKg: 0,
            serviceAvailability: {
              barrelShipping: false,
              freightAir: true,
              freightSea: false,
              carTransport: false,
            },
          },
        }),
        /Air freight destinations need a rate/,
    );
  });
});

describe("car transport service callable lifecycle", () => {
  it("lists eligible businesses and creates a quote request", async () => {
    const businessId = "transport-service-business";
    await seedBusiness(businessId);
    const options = await functions.listTransportBusinessOptions.run({
      data: {},
    });
    assert.ok(options.options.some((row) =>
      row.businessId === businessId && row.country.id === COUNTRY_ID));

    const created = await functions.createTransportRequest.run({
      auth: {uid: CUSTOMER_UID},
      data: {
        businessId,
        destinationCountryId: COUNTRY_ID,
        ownerName: "Vehicle Owner",
        carMake: "Toyota",
        carModel: "Camry",
        carYear: "2022",
        vinNumber: "1HGCM82633A004352",
        customerPhone: "+15555550101",
        pickupAddress: "100 Test Avenue",
        preferredDate: futureIso(72),
        notes: "Handle with care",
      },
    });
    const snapshot = await db.collection("transportRequests")
        .doc(created.id).get();
    assert.equal(snapshot.get("customerUid"), CUSTOMER_UID);
    assert.equal(snapshot.get("businessId"), businessId);
    assert.equal(snapshot.get("destinationCountryName"), "Guinea");
    assert.equal(snapshot.get("quoteStatus"), "awaitingQuote");
    assert.equal(snapshot.get("status"), "pending");
    assert.equal(snapshot.get("price"), 0);
    assert.match(snapshot.get("trackingCode"), /^TR/);
  });

  it("excludes car transport destinations disabled for that country",
      async () => {
        const businessId = "transport-disabled-destination";
        await seedBusiness(businessId, {
          serviceAvailability: {
            barrelShipping: true,
            freightAir: true,
            freightSea: true,
            carTransport: false,
          },
        });

        const options = await functions.listTransportBusinessOptions.run({
          data: {},
        });
        assert.equal(
            options.options.some((row) =>
              row.businessId === businessId && row.country.id === COUNTRY_ID),
            false,
        );

        await assert.rejects(
            () => functions.createTransportRequest.run({
              auth: {uid: CUSTOMER_UID},
              data: {
                businessId,
                destinationCountryId: COUNTRY_ID,
                ownerName: "Vehicle Owner",
                carMake: "Toyota",
                carModel: "Camry",
                carYear: "2022",
                customerPhone: "+15555550101",
              },
            }),
            /not available for car transport/,
        );
      });

  it("rejects businesses without transport or an active destination",
      async () => {
        const noServiceId = "transport-no-service";
        await seedBusiness(noServiceId, {services: ["freight"]});
        await assert.rejects(
            () => functions.createTransportRequest.run({
              auth: {uid: CUSTOMER_UID},
              data: {
                businessId: noServiceId,
                destinationCountryId: COUNTRY_ID,
                ownerName: "Vehicle Owner",
                carMake: "Toyota",
                carModel: "Camry",
                carYear: "2022",
                customerPhone: "+15555550101",
              },
            }),
            /not offering car transport/,
        );
      });
});

describe("barrel shipping service callable lifecycle", () => {
  it("rejects destinations where barrel shipping is disabled", async () => {
    const businessId = "barrel-disabled-destination";
    await seedBusiness(businessId, {
      serviceAvailability: {
        barrelShipping: false,
        freightAir: true,
        freightSea: true,
        carTransport: true,
      },
    });

    await assert.rejects(
        () => functions.createBarrelShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: {
            senderName: "Barrel Sender",
            receiverName: "Barrel Receiver",
            receiverPhone: "+224620000002",
            destinationCountryId: COUNTRY_ID,
            businessId,
            quantity: 1,
            pickupRequested: false,
            useWalletBalance: false,
          },
        }),
        /not configured for barrel shipping/,
    );
  });

  it("books a direct barrel shipment at the configured destination rate",
      async () => {
        const businessId = "barrel-service-business";
        await seedBusiness(businessId);
        const created = await functions.createBarrelShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: {
            senderName: "Barrel Sender",
            receiverName: "Barrel Receiver",
            receiverPhone: "+224620000002",
            destinationCountryId: COUNTRY_ID,
            businessId,
            quantity: 2,
            pickupRequested: false,
            useWalletBalance: false,
          },
        });
        const shipment = await db.collection("barrelShipments")
            .doc(created.shipmentId).get();
        assert.equal(created.simulatedPayment, true);
        assert.equal(shipment.get("quantity"), 2);
        assert.equal(shipment.get("unitShippingFee"), 225);
        assert.equal(shipment.get("shippingFee"), 450);
        assert.equal(shipment.get("price"), 450);
        assert.equal(shipment.get("paymentStatus"), "succeeded");
        assert.equal(shipment.get("status"), "pending");
        assert.match(shipment.get("trackingCode"), /^BS/);

        await db.collection("businesses").doc(businessId)
            .collection("destinationCountries").doc("gh").set({
              countryId: "gh",
              name: "Ghana",
              code: "GH",
              isActive: true,
              barrelShippingPrice: 300,
              deliveryEstimateMinDays: 12,
              deliveryEstimateMaxDays: 24,
            });
        const changed = await functions.changeBarrelShipmentDestination.run({
          auth: {uid: CUSTOMER_UID},
          data: {
            shipmentId: created.shipmentId,
            destinationCountryId: "gh",
            businessId,
            changeRequestId: "quantity-price-change",
          },
        });
        const updated = await db.collection("barrelShipments")
            .doc(created.shipmentId).get();
        assert.equal(changed.simulatedPayment, true);
        assert.equal(changed.amountDue, 150);
        assert.equal(updated.get("unitShippingFee"), 300);
        assert.equal(updated.get("shippingFee"), 600);
        assert.equal(updated.get("price"), 600);
        assert.equal(updated.get("destinationCountryName"), "Ghana");
        assert.equal(updated.get("platformFeePct"), 0.1);
        assert.equal(updated.get("platformFeeCents"), 6000);
        assert.equal(updated.get("businessPayoutCents"), 54000);
        assert.equal(updated.get("payoutStatus"), "pending_account");

        await db.collection("businesses").doc(businessId)
            .collection("destinationCountries").doc("sl").set({
              countryId: "sl",
              name: "Sierra Leone",
              code: "SL",
              isActive: true,
              barrelShippingPrice: 350,
              deliveryEstimateMinDays: 12,
              deliveryEstimateMaxDays: 24,
            });
        await updated.ref.update({payoutStatus: "paid"});
        await assert.rejects(
            () => functions.changeBarrelShipmentDestination.run({
              auth: {uid: CUSTOMER_UID},
              data: {
                shipmentId: created.shipmentId,
                destinationCountryId: "sl",
                businessId,
                changeRequestId: "paid-payout-change",
              },
            }),
            /needs support to change its destination safely/,
        );
      });

  it("rejects a business that does not offer barrel shipping", async () => {
    const businessId = "barrel-no-service";
    await seedBusiness(businessId, {services: ["freight"]});
    await assert.rejects(
        () => functions.createBarrelShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: {
            senderName: "Barrel Sender",
            receiverName: "Barrel Receiver",
            receiverPhone: "+224620000002",
            destinationCountryId: COUNTRY_ID,
            businessId,
            quantity: 1,
          },
        }),
        /not accepting barrel shipments/,
    );
  });

  it("creates one paid order with independent destination shipments",
      async () => {
        const businessId = "barrel-order-service-business";
        const businessRef = await seedBusiness(businessId);
        await businessRef.collection("destinationCountries").doc("gh").set({
          countryId: "gh",
          name: "Ghana",
          code: "GH",
          isActive: true,
          barrelShippingPrice: 300,
          deliveryEstimateMinDays: 12,
          deliveryEstimateMaxDays: 24,
        });
        const created = await functions.createBarrelOrderPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: {
            senderName: "Multi Destination Sender",
            pickupRequested: false,
            useWalletBalance: false,
            lines: [
              {
                destinationCountryId: COUNTRY_ID,
                businessId,
                receiverName: "Guinea Receiver",
                receiverPhone: "+224620000010",
                quantity: 1,
              },
              {
                destinationCountryId: "gh",
                businessId,
                receiverName: "Ghana Receiver",
                receiverPhone: "+233201234567",
                quantity: 2,
              },
            ],
          },
        });
        assert.equal(created.simulatedPayment, true);
        assert.equal(created.shipmentIds.length, 2);
        assert.equal(created.trackingCodes.length, 2);

        const [order, ...shipments] = await Promise.all([
          db.collection("barrelOrders").doc(created.orderId).get(),
          ...created.shipmentIds.map((id) =>
            db.collection("barrelShipments").doc(id).get()),
        ]);
        assert.equal(order.get("paymentStatus"), "succeeded");
        assert.equal(order.get("lineCount"), 2);
        assert.equal(order.get("quantity"), 3);
        assert.equal(order.get("orderTotal"), 825);
        assert.deepEqual(
            shipments.map((shipment) => shipment.get("price")),
            [225, 600],
        );
        assert.ok(shipments.every((shipment) =>
          shipment.get("paymentStatus") === "succeeded"));
      });
});

describe("car parking service callable lifecycle", () => {
  it("lists capacity and creates a simulated paid reservation", async () => {
    const businessId = `parking-service-business-${Date.now()}`;
    await seedBusiness(businessId);
    const startDate = futureDate(2);
    const endDate = futureDate(4);
    const listed = await functions.listParkingOptions.run({
      auth: {uid: CUSTOMER_UID},
      data: {city: "Bronx", startDate, endDate, pickupRequested: false},
    });
    const option = listed.options.find((row) =>
      row.businessId === businessId);
    assert.ok(option);
    assert.equal(option.availableSpaces, 5);
    assert.equal(option.estimatedTotal, 50);

    const created = await functions.createParkingReservation.run({
      auth: {uid: CUSTOMER_UID},
      data: {
        businessId,
        customerName: "Parking Customer",
        customerPhone: "+15555550102",
        carMake: "Honda",
        carModel: "Accord",
        carYear: "2021",
        vinNumber: "1HGCM82633A004353",
        startDate,
        endDate,
        pickupRequested: false,
      },
    });
    const reservation = await db.collection("parkedCars")
        .doc(created.reservationId).get();
    assert.equal(created.simulatedPayment, true);
    assert.equal(reservation.get("customerUid"), CUSTOMER_UID);
    assert.equal(reservation.get("status"), "reserved");
    assert.equal(reservation.get("paymentStatus"), "succeeded");
    assert.equal(reservation.get("totalCost"), 50);
    assert.equal(reservation.get("depositAmount"), 50);
    assert.match(reservation.get("trackingCode"), /^PK/);
  });
});

describe("wallet refund lifecycle", () => {
  it("moves funds to pending and restores or completes them exactly once",
      async () => {
        const walletRef = db.collection("wallets").doc(OTHER_UID);
        await walletRef.set({
          customerUid: OTHER_UID,
          currency: "usd",
          balanceCents: 5000,
          balance: 50,
          pendingRefundCents: 0,
          pendingRefund: 0,
        });

        const first = await functions.requestWalletCardRefund.run({
          auth: {uid: OTHER_UID},
          data: {},
        });
        let wallet = await walletRef.get();
        assert.equal(wallet.get("balanceCents"), 0);
        assert.equal(wallet.get("pendingRefundCents"), 5000);
        await assert.rejects(
            () => functions.requestWalletCardRefund.run({
              auth: {uid: OTHER_UID},
              data: {},
            }),
            /no wallet balance to return/,
        );

        await functions.reviewWalletRefundRequest.run({
          auth: {uid: FINANCE_UID},
          data: {
            requestId: first.refundRequestId,
            decision: "rejected",
            note: "External card return was not available.",
          },
        });
        wallet = await walletRef.get();
        assert.equal(wallet.get("balanceCents"), 5000);
        assert.equal(wallet.get("pendingRefundCents"), 0);

        const second = await functions.requestWalletCardRefund.run({
          auth: {uid: OTHER_UID},
          data: {},
        });
        await functions.reviewWalletRefundRequest.run({
          auth: {uid: FINANCE_UID},
          data: {
            requestId: second.refundRequestId,
            decision: "completed",
            note: "External card return confirmed.",
          },
        });
        wallet = await walletRef.get();
        assert.equal(wallet.get("balanceCents"), 0);
        assert.equal(wallet.get("pendingRefundCents"), 0);
        await assert.rejects(
            () => functions.reviewWalletRefundRequest.run({
              auth: {uid: FINANCE_UID},
              data: {
                requestId: second.refundRequestId,
                decision: "completed",
              },
            }),
            /Only pending refund requests can be reviewed/,
        );
      });
});

describe("car sales service callable lifecycle", () => {
  it("returns exact server-side paid-hold pricing to customers", async () => {
    const businessId = "car-hold-quote-business";
    const businessRef = await seedBusiness(businessId);
    await businessRef.update({
      carHoldPricingMode: "per_day",
      carHoldDailyRate: 85,
      carHoldMaxDays: 9,
    });
    const carRef = db.collection("cars").doc("service-hold-quote-car");
    await carRef.set({
      businessId,
      businessName: "Service Test Cars",
      title: "2022 Honda CR-V",
      make: "Honda",
      model: "CR-V",
      year: 2022,
      price: 25000,
      status: "active",
      useBusinessHoldPricing: true,
    });

    const quote = await functions.getCarHoldPricing.run({
      auth: {uid: CUSTOMER_UID},
      data: {carId: carRef.id},
    });

    assert.deepEqual(quote, {
      mode: "per_day",
      flatFee: 500,
      dailyRate: 85,
      maxDays: 9,
    });
  });

  it("allows only one paid hold when two customers reserve together",
      async () => {
        const businessId = "car-deposit-race-business";
        await seedBusiness(businessId);
        const carRef = db.collection("cars").doc();
        await carRef.set({
          businessId,
          businessName: "Service Test Cars",
          title: "2021 Honda Accord",
          make: "Honda",
          model: "Accord",
          year: 2021,
          price: 15000,
          status: "active",
          locationCity: "Bronx",
          locationState: "NY",
        });

        const reserve = (uid, phone) =>
          functions.createCarDepositPaymentIntent.run({
            auth: {uid},
            data: {
              carId: carRef.id,
              buyerName: `Buyer ${uid}`,
              buyerPhone: phone,
              holdUntilDate: futureDate(2),
            },
          });
        const attempts = await Promise.allSettled([
          reserve(CUSTOMER_UID, "+15555550110"),
          reserve(OTHER_UID, "+15555550111"),
        ]);
        const successful = attempts.filter(
            (result) => result.status === "fulfilled",
        );
        const rejected = attempts.filter(
            (result) => result.status === "rejected",
        );

        assert.equal(successful.length, 1);
        assert.equal(rejected.length, 1);
        assert.match(
            String(rejected[0].reason),
            /not available for reservation/,
        );

        const winner = successful[0].value;
        const [car, purchases] = await Promise.all([
          carRef.get(),
          db.collection("carPurchases")
              .where("carId", "==", carRef.id)
              .get(),
        ]);
        assert.equal(car.get("status"), "reserved");
        assert.equal(car.get("reservedPurchaseId"), winner.purchaseId);
        assert.equal(car.get("reservationType"), "paid_hold");
        assert.equal(
            purchases.docs.filter((doc) =>
              doc.get("purchaseStatus") === "reserved").length,
            1,
        );
      });

  it("atomically completes a simulated full car purchase", async () => {
    const businessId = "car-sales-service-business";
    await seedBusiness(businessId);
    const carRef = db.collection("cars").doc("service-test-car");
    await carRef.set({
      businessId,
      businessName: "Service Test Cars",
      title: "2022 Toyota Camry",
      make: "Toyota",
      model: "Camry",
      year: 2022,
      price: 18000,
      status: "active",
      locationCity: "Bronx",
      locationState: "NY",
    });

    const created = await functions.createCarPurchasePaymentIntent.run({
      auth: {uid: CUSTOMER_UID},
      data: {
        carId: carRef.id,
        buyerName: "Car Buyer",
        buyerPhone: "+15555550103",
      },
    });
    const [purchase, car] = await Promise.all([
      db.collection("carPurchases").doc(created.purchaseId).get(),
      carRef.get(),
    ]);
    assert.equal(created.simulatedPayment, true);
    assert.equal(purchase.get("paymentStatus"), "succeeded");
    assert.equal(purchase.get("purchaseStatus"), "completed");
    assert.equal(purchase.get("depositAmount"), 18000);
    assert.equal(car.get("status"), "sold");
    assert.equal(car.get("soldPurchaseId"), created.purchaseId);

    await assert.rejects(
        () => functions.createCarPurchasePaymentIntent.run({
          auth: {uid: OTHER_UID},
          data: {
            carId: carRef.id,
            buyerName: "Second Buyer",
            buyerPhone: "+15555550104",
          },
        }),
        /not available for purchase/,
    );
  });

  it("creates, reschedules, and cancels a car viewing", async () => {
    const businessId = "car-viewing-service-business";
    await seedBusiness(businessId);
    const carRef = db.collection("cars").doc("service-viewing-car");
    await carRef.set({
      businessId,
      businessName: "Service Test Cars",
      title: "2020 Toyota RAV4",
      make: "Toyota",
      model: "RAV4",
      year: 2020,
      price: 17000,
      status: "active",
      locationCity: "Bronx",
      locationState: "NY",
    });

    const created = await functions.createCarViewingReservation.run({
      auth: {uid: CUSTOMER_UID},
      data: {
        carId: carRef.id,
        buyerName: "Viewing Customer",
        buyerPhone: "+15555550120",
        appointmentStart: futureIso(48),
        appointmentLabel: "Friday afternoon",
      },
    });
    let viewing = await db.collection("carPurchases")
        .doc(created.purchaseId).get();
    assert.equal(viewing.get("paymentType"), "viewing_reservation");
    assert.equal(viewing.get("purchaseStatus"), "viewing_scheduled");
    assert.equal(viewing.get("paymentStatus"), "not_required");

    const rescheduledAt = futureIso(72);
    await functions.updateCarViewingReservation.run({
      auth: {uid: CUSTOMER_UID},
      data: {
        purchaseId: created.purchaseId,
        appointmentStart: rescheduledAt,
        appointmentLabel: "Saturday afternoon",
      },
    });
    viewing = await viewing.ref.get();
    assert.equal(
        viewing.get("appointmentStart").toMillis(),
        Date.parse(rescheduledAt),
    );

    await functions.cancelCarViewingReservation.run({
      auth: {uid: CUSTOMER_UID},
      data: {purchaseId: created.purchaseId},
    });
    viewing = await viewing.ref.get();
    assert.equal(viewing.get("purchaseStatus"), "cancelled");
  });

  it("extends an approved paid car hold exactly once", async () => {
    const businessId = "car-hold-extension-business";
    const businessRef = await seedBusiness(businessId);
    await businessRef.update({
      carHoldPricingMode: "per_day",
      carHoldDailyRate: 100,
      carHoldMaxDays: 10,
    });
    const manager = await seedFreightManager(businessId, {
      permissions: ["purchases"],
    });
    const carRef = db.collection("cars").doc("service-extension-car");
    await carRef.set({
      businessId,
      businessName: "Service Test Cars",
      title: "2019 Honda CR-V",
      make: "Honda",
      model: "CR-V",
      year: 2019,
      price: 16000,
      status: "active",
      locationCity: "Bronx",
      locationState: "NY",
    });
    const hold = await functions.createCarDepositPaymentIntent.run({
      auth: {uid: CUSTOMER_UID},
      data: {
        carId: carRef.id,
        buyerName: "Hold Customer",
        buyerPhone: "+15555550121",
        holdUntilDate: futureDate(2),
      },
    });
    const purchaseRef = db.collection("carPurchases").doc(hold.purchaseId);
    const before = await purchaseRef.get();
    const originalDeposit = Number(before.get("depositAmount"));

    await functions.requestPaidHoldExtension.run({
      auth: {uid: CUSTOMER_UID},
      data: {
        purchaseId: hold.purchaseId,
        requestedHoldUntilDate: futureDate(4),
      },
    });
    await functions.decidePaidHoldExtension.run({
      auth: manager,
      data: {purchaseId: hold.purchaseId, decision: "approved"},
    });
    const paid = await functions.createPaidHoldExtensionPaymentIntent.run({
      auth: {uid: CUSTOMER_UID},
      data: {purchaseId: hold.purchaseId},
    });
    assert.equal(paid.simulatedPayment, true);

    const extended = await purchaseRef.get();
    assert.equal(extended.get("extensionRequestStatus"), "paid");
    assert.equal(extended.get("extensionPaymentStatus"), "succeeded");
    assert.ok(Number(extended.get("depositAmount")) > originalDeposit);
    const depositAfterExtension = extended.get("depositAmount");

    await functions.completePaidHoldExtensionPayment.run({
      auth: {uid: CUSTOMER_UID},
      data: {purchaseId: hold.purchaseId},
    });
    const completedAgain = await purchaseRef.get();
    assert.equal(completedAgain.get("depositAmount"), depositAfterExtension);
  });
});
