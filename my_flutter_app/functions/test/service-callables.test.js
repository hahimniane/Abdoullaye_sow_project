const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

// These handlers run directly against the Firestore emulator instead of
// through the Functions emulator, so declare the runtime explicitly before
// loading index.js.
process.env.FUNCTIONS_EMULATOR = "true";

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
  pickupPlan,
  destinationId = COUNTRY_ID,
  destinationName = "Guinea",
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
      ...(pickupPlan ? {state: "NY", pickupPlan} : {}),
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
    ref.collection("destinationCountries").doc(destinationId).set({
      countryId: destinationId,
      name: destinationName,
      code: "GN",
      destinationCoverageVersion: 2,
      serviceAvailability: availability,
      isActive: destinationActive &&
        Object.values(availability).some(Boolean),
      barrelShippingPrice: barrelRate,
      freightAirPricePerKg: airRate,
      freightSeaPricePerKg: seaRate,
      carTransportAvailable: availability.carTransport,
      freightAirDepartureDays: ["monday", "thursday"],
      freightSeaDepartureDays: ["saturday"],
      // Deliberately different per service so tests can confirm a shipment
      // inherits the estimate for the service it actually booked, not a
      // shared country-level value.
      barrelShippingDeliveryEstimateMinDays: 10,
      barrelShippingDeliveryEstimateMaxDays: 20,
      freightAirDeliveryEstimateMinDays: 3,
      freightAirDeliveryEstimateMaxDays: 5,
      freightSeaDeliveryEstimateMinDays: 25,
      freightSeaDeliveryEstimateMaxDays: 35,
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

async function seedTransportManager(businessId, {
  permissions = ["transport"],
  uid = `transport-manager-${businessId}`,
} = {}) {
  await db.collection("users").doc(uid).set({
    role: "staff",
    businessId,
    fullName: `Transport Manager ${businessId}`,
    businessPermissions: permissions,
  });
  return {uid};
}

function transportRequestInput(overrides = {}) {
  return {
    destinationCountryId: COUNTRY_ID,
    destinationCountryName: "Client supplied name",
    ownerName: "Vehicle Owner",
    carMake: "Toyota",
    carModel: "Camry",
    carYear: "2022",
    vinNumber: "1HGCM82633A004352",
    customerPhone: "+15555550101",
    pickupAddress: "100 Private Test Avenue",
    pickupArea: "Bronx, NY 10458",
    vehicleOperable: true,
    requestedTransportMethod: "open",
    flexibleDates: false,
    preferredDate: futureIso(72),
    notes: "Private handling instructions",
    ...overrides,
  };
}

function quoteInput(requestId, businessId, overrides = {}) {
  return {
    requestId,
    businessId,
    amountCents: 125000,
    currency: "usd",
    transportMethod: "open",
    estimatedPickupDate: futureIso(48),
    estimatedDeliveryDate: futureIso(240),
    terms: "Door-to-port service",
    ...overrides,
  };
}

async function transportRequestData(requestId) {
  const snapshot = await db.collection("transportRequests")
      .doc(requestId).get();
  assert.equal(snapshot.exists, true);
  return snapshot.data() || {};
}

async function transportOpportunityData(requestId, businessId) {
  const snapshot = await db.collection("transportOpportunities")
      .doc(`${requestId}__${businessId}`).get();
  assert.equal(snapshot.exists, true);
  return snapshot.data() || {};
}

async function transportQuoteData(requestId, businessId) {
  const snapshot = await db.collection("transportQuotes")
      .doc(`${requestId}__${businessId}`).get();
  assert.equal(snapshot.exists, true);
  return snapshot.data() || {};
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
        assert.deepEqual(
            option.country.freightAirDepartureDays,
            ["monday", "thursday"],
        );
        assert.deepEqual(
            option.country.freightSeaDepartureDays,
            ["saturday"],
        );
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
        // Air freight's own estimate (3-5 days), not barrel shipping's
        // (10-20) or sea freight's (25-35) — proves the per-service split.
        assert.equal(airShipment.deliveryEstimateMinDays, 3);
        assert.equal(airShipment.deliveryEstimateMaxDays, 5);
        assert.deepEqual(
            airShipment.freightDepartureDays,
            ["monday", "thursday"],
        );

        const sea = await functions.createFreightShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: freightInput(businessId, {mode: "sea", weightKg: 7.5}),
        });
        const seaShipment = await freightData(sea.shipmentId);
        assert.equal(seaShipment.mode, "sea");
        assert.equal(seaShipment.shippingFee, 37.5);
        assert.equal(seaShipment.cardChargeAmountCents, 3750);
        assert.deepEqual(seaShipment.freightDepartureDays, ["saturday"]);
        // Sea freight's own estimate (25-35 days) — independent of air's.
        assert.equal(seaShipment.deliveryEstimateMinDays, 25);
        assert.equal(seaShipment.deliveryEstimateMaxDays, 35);
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

  it("automatically charges a heavier balance when a card is on file",
      async () => {
        const businessId = "freight-auto-charge-business";
        await seedBusiness(businessId);
        const manager = await seedFreightManager(businessId);
        const booking = await functions.createFreightShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: freightInput(businessId, {weightKg: 10}),
        });
        // Stands in for a card saved from the customer's original estimate
        // payment (see completeFreightShipmentPayment) - without this, the
        // shipment falls back to the existing manual-payment flow instead.
        await db.collection("freightShipments").doc(booking.shipmentId)
            .update({stripePaymentMethodId: "pm_test_on_file"});

        const confirmed = await functions.confirmFreightShipmentWeight.run({
          auth: manager,
          data: {shipmentId: booking.shipmentId, verifiedWeightKg: 12},
        });
        assert.equal(confirmed.priceSettlementStatus, "settled");
        const shipment = await freightData(booking.shipmentId);
        assert.equal(shipment.priceSettlementStatus, "settled");
        assert.equal(shipment.balancePaymentStatus, "succeeded");
        assert.equal(shipment.status, "pending");
        assert.equal(shipment.price, 150);
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

  it("rejects country coverage for services disabled on the business profile",
      async () => {
        const cases = [
          {
            suffix: "barrel",
            services: ["freight"],
            availability: {
              barrelShipping: true,
              freightAir: false,
              freightSea: false,
              carTransport: false,
            },
            barrelShippingPrice: 200,
          },
          {
            suffix: "freight",
            services: ["barrelShipping"],
            availability: {
              barrelShipping: false,
              freightAir: true,
              freightSea: false,
              carTransport: false,
            },
            freightAirPricePerKg: 12,
          },
          {
            suffix: "transport",
            services: ["freight"],
            availability: {
              barrelShipping: false,
              freightAir: false,
              freightSea: false,
              carTransport: true,
            },
          },
        ];

        for (const testCase of cases) {
          const businessId = `destination-global-gate-${testCase.suffix}`;
          await seedBusiness(businessId, {services: testCase.services});
          await assert.rejects(
              () => functions.updateDestinationCoverage.run({
                auth: {uid: DELETE_ADMIN_UID},
                data: {
                  businessId,
                  countryId: COUNTRY_ID,
                  isActive: true,
                  barrelShippingPrice:
                    testCase.barrelShippingPrice || 0,
                  freightAirPricePerKg:
                    testCase.freightAirPricePerKg || 0,
                  freightSeaPricePerKg: 0,
                  serviceAvailability: testCase.availability,
                },
              }),
              /must also be enabled on the business profile/,
          );
        }
      });
});

describe("car transport service callable lifecycle", () => {
  it("does not infer legacy car transport from a generic active destination",
      async () => {
        const businessId = "transport-legacy-active-is-not-car";
        const destinationId = "legacy-active-barrel-country";
        const businessRef = await seedBusiness(businessId, {
          services: ["carTransport"],
          destinationId,
        });
        await businessRef.collection("destinationCountries")
            .doc(destinationId).set({
              countryId: destinationId,
              name: "Legacy Barrel Country",
              code: "LB",
              isActive: true,
              barrelShippingPrice: 225,
            });

        await assert.rejects(
            () => functions.createTransportRequest.run({
              auth: {uid: CUSTOMER_UID},
              data: transportRequestInput({
                destinationCountryId: destinationId,
              }),
            }),
            /No approved businesses currently serve this destination/,
        );
      });

  it("creates one unassigned v2 request from server-derived eligibility",
      async () => {
        const eligibleA = "transport-market-a";
        const eligibleB = "transport-market-b";
        const noService = "transport-market-no-service";
        const unapproved = "transport-market-unapproved";
        const unavailable = "transport-market-unavailable";
        const destinationId = "transport-market-derived-country";
        const destinationName = "Derived Country";

        await Promise.all([
          seedBusiness(eligibleA, {destinationId, destinationName}),
          seedBusiness(eligibleB, {destinationId, destinationName}),
          seedBusiness(noService, {
            services: ["freight"],
            destinationId,
            destinationName,
          }),
          seedBusiness(unapproved, {
            status: "pending",
            destinationId,
            destinationName,
          }),
          seedBusiness(unavailable, {
            destinationId,
            destinationName,
            serviceAvailability: {
              barrelShipping: true,
              freightAir: true,
              freightSea: true,
              carTransport: false,
            },
          }),
        ]);

        const created = await functions.createTransportRequest.run({
          auth: {uid: CUSTOMER_UID},
          data: transportRequestInput({
            destinationCountryId: destinationId,
            businessId: unapproved,
            eligibleBusinessIds: [unapproved, "forged-business"],
          }),
        });
        const request = await transportRequestData(created.id);

        assert.equal(request.flowVersion, 2);
        assert.equal(request.source, "customerMarketplace");
        assert.equal(request.customerUid, CUSTOMER_UID);
        assert.equal(request.status, "quote_requested");
        assert.equal(request.quoteStatus, "collecting");
        assert.equal(request.businessId, "");
        assert.equal(request.businessName, "");
        assert.equal(request.price, 0);
        assert.equal(request.amountCents, 0);
        assert.equal(request.currency, "usd");
        assert.equal(request.selectedQuoteId, "");
        assert.equal(request.selectedBusinessId, "");
        assert.equal(request.selectedBusinessName, "");
        assert.equal(request.selectedAmountCents, 0);
        assert.equal(request.pickupArea, "Bronx, NY 10458");
        assert.equal(request.vehicleOperable, true);
        assert.equal(request.requestedTransportMethod, "open");
        assert.equal(request.flexibleDates, false);
        assert.match(request.trackingCode, /^TR/);
        assert.ok(request.quoteDeadlineAt);
        assert.deepEqual(
            [...request.eligibleBusinessIds].sort(),
            [eligibleA, eligibleB].sort(),
        );
        assert.equal(request.eligibleBusinessCount, 2);

        const opportunities = await db.collection("transportOpportunities")
            .where("requestId", "==", created.id).get();
        assert.deepEqual(
            opportunities.docs.map((doc) => doc.get("businessId")).sort(),
            [eligibleA, eligibleB].sort(),
        );
      });

  it("keeps private customer and vehicle identity out of opportunities",
      async () => {
        const businessId = "transport-market-sanitized";
        await seedBusiness(businessId);

        const created = await functions.createTransportRequest.run({
          auth: {uid: CUSTOMER_UID},
          data: transportRequestInput(),
        });
        const opportunity = await transportOpportunityData(
            created.id,
            businessId,
        );

        assert.equal(opportunity.flowVersion, 2);
        assert.equal(opportunity.requestId, created.id);
        assert.match(opportunity.trackingCode, /^TR/);
        assert.equal(
            opportunity.opportunityId,
            `${created.id}__${businessId}`,
        );
        assert.equal(opportunity.businessId, businessId);
        assert.equal(opportunity.destinationCountryId, COUNTRY_ID);
        assert.equal(opportunity.destinationCountryName, "Guinea");
        assert.equal(opportunity.carMake, "Toyota");
        assert.equal(opportunity.carModel, "Camry");
        assert.equal(opportunity.carYear, "2022");
        assert.equal(opportunity.pickupArea, "Bronx, NY 10458");
        assert.equal(opportunity.vehicleOperable, true);
        assert.equal(opportunity.requestedTransportMethod, "open");
        assert.equal(opportunity.flexibleDates, false);
        assert.equal(opportunity.status, "open");
        assert.ok(opportunity.expiresAt);

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
                  opportunity,
                  privateField,
              ),
              false,
              `${privateField} must not be exposed in an opportunity`,
          );
        }
      });

  it("validates the sanitized marketplace matching fields", async () => {
    for (const invalidData of [
      {pickupArea: ""},
      {pickupArea: "x".repeat(161)},
      {pickupArea: "100 Main Street, Bronx, NY"},
      {vehicleOperable: "yes"},
      {requestedTransportMethod: ""},
      {requestedTransportMethod: "flatbed"},
      {flexibleDates: "sometimes"},
    ]) {
      await assert.rejects(
          () => functions.createTransportRequest.run({
            auth: {uid: CUSTOMER_UID},
            data: transportRequestInput(invalidData),
          }),
          /pickup|operable|transport|method|flexible|boolean|required/i,
      );
    }
  });

  it("rejects a request when no approved provider covers the destination",
      async () => {
        const noService = "transport-market-none-service";
        const unavailable = "transport-market-none-destination";
        await Promise.all([
          seedBusiness(noService, {services: ["freight"]}),
          seedBusiness(unavailable, {
            serviceAvailability: {
              barrelShipping: false,
              freightAir: true,
              freightSea: false,
              carTransport: false,
            },
          }),
        ]);

        await assert.rejects(
            () => functions.createTransportRequest.run({
              auth: {uid: CUSTOMER_UID},
              data: transportRequestInput({
                destinationCountryId: "no-marketplace-coverage",
              }),
            }),
            /available|eligible|destination/i,
        );
      });

  it("allows only an authorized eligible transport manager to quote",
      async () => {
        const businessId = "transport-market-authorized";
        const forgedBusinessId = "transport-market-forged-business";
        await Promise.all([
          seedBusiness(businessId),
          seedBusiness(forgedBusinessId),
        ]);
        const manager = await seedTransportManager(businessId);
        const noPermission = await seedTransportManager(businessId, {
          permissions: [],
          uid: "transport-manager-no-permission",
        });
        const created = await functions.createTransportRequest.run({
          auth: {uid: CUSTOMER_UID},
          data: transportRequestInput(),
        });

        await assert.rejects(
            () => functions.submitTransportQuote.run({
              auth: {uid: CUSTOMER_UID},
              data: quoteInput(created.id, businessId),
            }),
            /permission|business|manager/i,
        );
        await assert.rejects(
            () => functions.submitTransportQuote.run({
              auth: noPermission,
              data: quoteInput(created.id, businessId),
            }),
            /permission|business|manager/i,
        );
        await assert.rejects(
            () => functions.submitTransportQuote.run({
              auth: manager,
              data: quoteInput(created.id, forgedBusinessId),
            }),
            /permission|business|manager|match/i,
        );

        await functions.submitTransportQuote.run({
          auth: manager,
          data: quoteInput(created.id, businessId),
        });
        const quote = await transportQuoteData(created.id, businessId);
        assert.equal(quote.businessId, businessId);
        assert.equal(quote.requestId, created.id);
        assert.equal(quote.status, "submitted");
      });

  it("validates quotes and revises one deterministic quote per business",
      async () => {
        const businessId = "transport-market-revision";
        await seedBusiness(businessId);
        const manager = await seedTransportManager(businessId);
        const created = await functions.createTransportRequest.run({
          auth: {uid: CUSTOMER_UID},
          data: transportRequestInput(),
        });

        for (const invalidData of [
          {amountCents: 0},
          {amountCents: 12.5},
          {currency: "eur"},
          {transportMethod: ""},
          {transportMethod: "flatbed"},
        ]) {
          await assert.rejects(
              () => functions.submitTransportQuote.run({
                auth: manager,
                data: quoteInput(created.id, businessId, invalidData),
              }),
              /amount|currency|transport|method|invalid/i,
          );
        }

        await functions.submitTransportQuote.run({
          auth: manager,
          data: quoteInput(created.id, businessId),
        });
        await functions.submitTransportQuote.run({
          auth: manager,
          data: quoteInput(created.id, businessId, {
            amountCents: 135000,
            transportMethod: "enclosed",
            terms: "Revised enclosed transport",
          }),
        });

        const matches = await db.collection("transportQuotes")
            .where("requestId", "==", created.id)
            .where("businessId", "==", businessId)
            .get();
        assert.equal(matches.size, 1);
        assert.equal(matches.docs[0].id, `${created.id}__${businessId}`);
        assert.equal(matches.docs[0].get("amountCents"), 135000);
        assert.equal(matches.docs[0].get("transportMethod"), "enclosed");
        assert.equal(matches.docs[0].get("revision"), 2);
        assert.equal(matches.docs[0].get("status"), "submitted");
      });

  it("withdraws a quote idempotently and prevents selecting it",
      async () => {
        const businessId = "transport-market-withdraw";
        await seedBusiness(businessId);
        const manager = await seedTransportManager(businessId);
        const created = await functions.createTransportRequest.run({
          auth: {uid: CUSTOMER_UID},
          data: transportRequestInput(),
        });
        await functions.submitTransportQuote.run({
          auth: manager,
          data: quoteInput(created.id, businessId),
        });

        const withdrawal = {
          auth: manager,
          data: {requestId: created.id, businessId},
        };
        await functions.withdrawTransportQuote.run(withdrawal);
        await functions.withdrawTransportQuote.run(withdrawal);

        const quote = await transportQuoteData(created.id, businessId);
        assert.equal(quote.status, "withdrawn");
        await assert.rejects(
            () => functions.selectTransportQuote.run({
              auth: {uid: CUSTOMER_UID},
              data: {
                requestId: created.id,
                businessId,
              },
            }),
            /withdrawn|available|submitted|select/i,
        );
      });

  it("lets only the customer owner select and assigns compatibility fields",
      async () => {
        const businessId = "transport-market-select";
        await seedBusiness(businessId);
        const manager = await seedTransportManager(businessId);
        const created = await functions.createTransportRequest.run({
          auth: {uid: CUSTOMER_UID},
          data: transportRequestInput(),
        });
        await functions.submitTransportQuote.run({
          auth: manager,
          data: quoteInput(created.id, businessId, {amountCents: 145500}),
        });
        const quoteId = `${created.id}__${businessId}`;

        await assert.rejects(
            () => functions.selectTransportQuote.run({
              auth: {uid: OTHER_UID},
              data: {requestId: created.id, businessId},
            }),
            /permission|owner|customer/i,
        );
        await functions.selectTransportQuote.run({
          auth: {uid: CUSTOMER_UID},
          data: {requestId: created.id, businessId},
        });

        const request = await transportRequestData(created.id);
        const quote = await transportQuoteData(created.id, businessId);
        assert.equal(request.quoteStatus, "selected");
        assert.equal(request.status, "pending");
        assert.equal(request.selectedQuoteId, quoteId);
        assert.equal(request.selectedBusinessId, businessId);
        assert.equal(request.businessId, businessId);
        assert.equal(request.selectedAmountCents, 145500);
        assert.equal(request.amountCents, 145500);
        assert.equal(request.price, 1455);
        assert.equal(quote.status, "selected");
      });

  it("allows only the selected provider to advance fulfillment",
      async () => {
        const businessA = "transport-market-fulfillment-a";
        const businessB = "transport-market-fulfillment-b";
        await Promise.all([
          seedBusiness(businessA),
          seedBusiness(businessB),
        ]);
        const managerA = await seedTransportManager(businessA);
        const managerB = await seedTransportManager(businessB);
        const noPermission = await seedTransportManager(businessA, {
          permissions: [],
          uid: "transport-fulfillment-no-permission",
        });
        const created = await functions.createTransportRequest.run({
          auth: {uid: CUSTOMER_UID},
          data: transportRequestInput(),
        });

        await assert.rejects(
            () => functions.updateTransportFulfillmentStatus.run({
              auth: managerA,
              data: {requestId: created.id, status: "scheduled"},
            }),
            /selected|assigned|quote/i,
        );
        await functions.submitTransportQuote.run({
          auth: managerA,
          data: quoteInput(created.id, businessA),
        });
        await functions.selectTransportQuote.run({
          auth: {uid: CUSTOMER_UID},
          data: {requestId: created.id, businessId: businessA},
        });

        for (const denied of [
          {
            auth: {uid: CUSTOMER_UID},
            data: {requestId: created.id, status: "scheduled"},
          },
          {
            auth: managerB,
            data: {requestId: created.id, status: "scheduled"},
          },
          {
            auth: noPermission,
            data: {requestId: created.id, status: "scheduled"},
          },
        ]) {
          await assert.rejects(
              () => functions.updateTransportFulfillmentStatus.run(denied),
              /permission|selected|assigned|business/i,
          );
        }
        await assert.rejects(
            () => functions.updateTransportFulfillmentStatus.run({
              auth: managerA,
              data: {requestId: created.id, status: "refunded"},
            }),
            /status|transition|invalid/i,
        );

        // A car in transit is in a container, and the customer's next question
        // is where it is - so in_transit is refused until the number the
        // carrier tracking API is keyed on exists.
        await assert.rejects(
            () => functions.updateTransportFulfillmentStatus.run({
              auth: managerA,
              data: {requestId: created.id, status: "in_transit"},
            }),
            /container/i,
        );

        for (const status of ["scheduled", "in_transit", "delivered"]) {
          await functions.updateTransportFulfillmentStatus.run({
            auth: managerA,
            data: {
              requestId: created.id,
              status,
              // Supplied once on the move that needs it; it persists on the
              // request, so "delivered" does not have to repeat it.
              ...(status === "in_transit" ?
                {containerNumber: "MSKU1234567"} :
                {}),
            },
          });
          const request = await transportRequestData(created.id);
          assert.equal(request.status, status);
          assert.equal(request.fulfillmentStatus, status);
        }
        assert.equal(
            (await transportRequestData(created.id)).containerNumber,
            "MSKU1234567",
        );
        await assert.rejects(
            () => functions.updateTransportFulfillmentStatus.run({
              auth: managerA,
              data: {requestId: created.id, status: "cancelled"},
            }),
            /terminal|transition|delivered/i,
        );
      });

  it("supports provider cancellation and keeps it terminal", async () => {
    const businessId = "transport-market-fulfillment-cancel";
    await seedBusiness(businessId);
    const manager = await seedTransportManager(businessId);
    const created = await functions.createTransportRequest.run({
      auth: {uid: CUSTOMER_UID},
      data: transportRequestInput(),
    });
    await functions.submitTransportQuote.run({
      auth: manager,
      data: quoteInput(created.id, businessId),
    });
    await functions.selectTransportQuote.run({
      auth: {uid: CUSTOMER_UID},
      data: {requestId: created.id, businessId},
    });

    await functions.updateTransportFulfillmentStatus.run({
      auth: manager,
      data: {requestId: created.id, status: "cancelled"},
    });
    const request = await transportRequestData(created.id);
    assert.equal(request.status, "cancelled");
    assert.equal(request.fulfillmentStatus, "cancelled");
    await assert.rejects(
        () => functions.updateTransportFulfillmentStatus.run({
          auth: manager,
          data: {requestId: created.id, status: "scheduled"},
        }),
        /terminal|transition|cancelled/i,
    );
  });

  it("revalidates provider eligibility when a quote is submitted",
      async () => {
        const suspendedId = "transport-market-suspended";
        const disabledId = "transport-market-disabled-after-create";
        const selectionId = "transport-market-disabled-before-selection";
        await Promise.all([
          seedBusiness(suspendedId),
          seedBusiness(disabledId),
          seedBusiness(selectionId),
        ]);
        const suspendedManager = await seedTransportManager(suspendedId);
        const disabledManager = await seedTransportManager(disabledId);
        const selectionManager = await seedTransportManager(selectionId);
        const created = await functions.createTransportRequest.run({
          auth: {uid: CUSTOMER_UID},
          data: transportRequestInput(),
        });
        await functions.submitTransportQuote.run({
          auth: selectionManager,
          data: quoteInput(created.id, selectionId),
        });

        await db.collection("businesses").doc(suspendedId)
            .update({status: "suspended"});
        await db.collection("businesses").doc(disabledId)
            .collection("destinationCountries").doc(COUNTRY_ID).update({
              "serviceAvailability.carTransport": false,
              "carTransportAvailable": false,
            });
        await db.collection("businesses").doc(selectionId)
            .update({status: "suspended"});

        await assert.rejects(
            () => functions.submitTransportQuote.run({
              auth: suspendedManager,
              data: quoteInput(created.id, suspendedId),
            }),
            /approved|available|eligible/i,
        );
        await assert.rejects(
            () => functions.submitTransportQuote.run({
              auth: disabledManager,
              data: quoteInput(created.id, disabledId),
            }),
            /destination|available|eligible/i,
        );
        await assert.rejects(
            () => functions.selectTransportQuote.run({
              auth: {uid: CUSTOMER_UID},
              data: {requestId: created.id, businessId: selectionId},
            }),
            /approved|available|eligible/i,
        );
      });

  it("rejects quotes and selections after the request deadline",
      async () => {
        const businessId = "transport-market-expired";
        await seedBusiness(businessId);
        const manager = await seedTransportManager(businessId);
        const created = await functions.createTransportRequest.run({
          auth: {uid: CUSTOMER_UID},
          data: transportRequestInput(),
        });

        await db.collection("transportRequests").doc(created.id).update({
          quoteDeadlineAt: admin.firestore.Timestamp.fromMillis(
              Date.now() - 1000,
          ),
        });
        await assert.rejects(
            () => functions.submitTransportQuote.run({
              auth: manager,
              data: quoteInput(created.id, businessId),
            }),
            /expired|deadline|closed/i,
        );

        await db.collection("transportQuotes")
            .doc(`${created.id}__${businessId}`).set({
              flowVersion: 2,
              requestId: created.id,
              opportunityId: `${created.id}__${businessId}`,
              businessId,
              businessName: businessId,
              amountCents: 100000,
              currency: "usd",
              transportMethod: "open",
              status: "submitted",
              revision: 1,
              expiresAt: admin.firestore.Timestamp.fromMillis(
                  Date.now() - 1000,
              ),
            });
        await assert.rejects(
            () => functions.selectTransportQuote.run({
              auth: {uid: CUSTOMER_UID},
              data: {
                requestId: created.id,
                businessId,
              },
            }),
            /expired|deadline|closed/i,
        );
      });

  it("selects exactly one winner under concurrent customer requests",
      async () => {
        const businessA = "transport-market-race-a";
        const businessB = "transport-market-race-b";
        await Promise.all([
          seedBusiness(businessA),
          seedBusiness(businessB),
        ]);
        const managerA = await seedTransportManager(businessA);
        const managerB = await seedTransportManager(businessB);
        const created = await functions.createTransportRequest.run({
          auth: {uid: CUSTOMER_UID},
          data: transportRequestInput(),
        });
        await Promise.all([
          functions.submitTransportQuote.run({
            auth: managerA,
            data: quoteInput(created.id, businessA, {amountCents: 110000}),
          }),
          functions.submitTransportQuote.run({
            auth: managerB,
            data: quoteInput(created.id, businessB, {amountCents: 120000}),
          }),
        ]);

        const selections = await Promise.allSettled([
          functions.selectTransportQuote.run({
            auth: {uid: CUSTOMER_UID},
            data: {
              requestId: created.id,
              businessId: businessA,
            },
          }),
          functions.selectTransportQuote.run({
            auth: {uid: CUSTOMER_UID},
            data: {
              requestId: created.id,
              businessId: businessB,
            },
          }),
        ]);
        assert.equal(
            selections.filter((result) => result.status === "fulfilled").length,
            1,
        );
        assert.equal(
            selections.filter((result) => result.status === "rejected").length,
            1,
        );

        const request = await transportRequestData(created.id);
        const quoteA = await transportQuoteData(created.id, businessA);
        const quoteB = await transportQuoteData(created.id, businessB);
        assert.ok([businessA, businessB].includes(request.businessId));
        assert.equal(
            [quoteA, quoteB].filter((quote) =>
              quote.status === "selected").length,
            1,
        );
      });

  it("cancels collecting requests owner-only and idempotently",
      async () => {
        const businessId = "transport-market-cancel";
        await seedBusiness(businessId);
        const manager = await seedTransportManager(businessId);
        const created = await functions.createTransportRequest.run({
          auth: {uid: CUSTOMER_UID},
          data: transportRequestInput(),
        });

        await assert.rejects(
            () => functions.cancelTransportQuoteRequest.run({
              auth: {uid: OTHER_UID},
              data: {requestId: created.id},
            }),
            /permission|owner|customer/i,
        );
        const cancellation = {
          auth: {uid: CUSTOMER_UID},
          data: {requestId: created.id},
        };
        await functions.cancelTransportQuoteRequest.run(cancellation);
        await functions.cancelTransportQuoteRequest.run(cancellation);

        const request = await transportRequestData(created.id);
        assert.equal(request.status, "cancelled");
        assert.equal(request.fulfillmentStatus, "cancelled");
        assert.equal(request.quoteStatus, "cancelled");
        await assert.rejects(
            () => functions.submitTransportQuote.run({
              auth: manager,
              data: quoteInput(created.id, businessId),
            }),
            /cancelled|closed|collecting/i,
        );
      });

  it("does not apply v2 quote mutations to a legacy v1 request",
      async () => {
        const businessId = "transport-legacy-business";
        const legacyId = "transport-legacy-v1";
        await seedBusiness(businessId);
        const manager = await seedTransportManager(businessId);
        await db.collection("transportRequests").doc(legacyId).set({
          customerUid: CUSTOMER_UID,
          businessId,
          businessName: "Legacy Business",
          price: 950,
          status: "pending",
          quoteStatus: "awaitingQuote",
          trackingCode: "TR-LEGACY",
        });

        for (const action of [
          () => functions.submitTransportQuote.run({
            auth: manager,
            data: quoteInput(legacyId, businessId),
          }),
          () => functions.selectTransportQuote.run({
            auth: {uid: CUSTOMER_UID},
            data: {
              requestId: legacyId,
              businessId,
            },
          }),
          () => functions.cancelTransportQuoteRequest.run({
            auth: {uid: CUSTOMER_UID},
            data: {requestId: legacyId},
          }),
        ]) {
          await assert.rejects(action, /version|marketplace|legacy|flow/i);
        }

        const legacy = await transportRequestData(legacyId);
        assert.equal(legacy.businessId, businessId);
        assert.equal(legacy.price, 950);
        assert.equal(legacy.status, "pending");
        assert.equal(legacy.flowVersion, undefined);
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
              barrelShippingDeliveryEstimateMinDays: 12,
              barrelShippingDeliveryEstimateMaxDays: 24,
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
              barrelShippingDeliveryEstimateMinDays: 12,
              barrelShippingDeliveryEstimateMaxDays: 24,
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

  it("books pickup from a resolved address without trusting the client zone",
      async () => {
        const businessId = "barrel-any-address-pickup";
        // Pickup now belongs to the business: without a pickupPlan the
        // callable refuses with barrel_pickup_unavailable (decision #9).
        await seedBusiness(businessId, {
          pickupPlan: {
            version: 1,
            shared: {
              enabled: true,
              mode: "borough",
              boroughPrices: {Brooklyn: 108, Bronx: 40},
            },
            services: {},
          },
        });
        const pickupDateTime = futureIso();
        const created = await functions.createBarrelShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: {
            senderName: "Barrel Pickup Sender",
            receiverName: "Barrel Pickup Receiver",
            receiverPhone: "+224620000022",
            destinationCountryId: COUNTRY_ID,
            businessId,
            quantity: 1,
            pickupRequested: true,
            pickupAddress: "123 Atlantic Ave, Brooklyn, NY 11201",
            pickupBorough: "Albany",
            pickupDateTime,
            useWalletBalance: false,
          },
        });
        const shipment = await db.collection("barrelShipments")
            .doc(created.shipmentId).get();
        assert.equal(shipment.get("pickupRequested"), true);
        assert.equal(
            shipment.get("pickupAddress"),
            "123 Atlantic Ave, Brooklyn, NY 11201",
        );
        assert.equal(shipment.get("pickupBorough"), "Brooklyn");
        assert.equal(shipment.get("pickupFee"), 108);
        assert.equal(shipment.get("shippingFee"), 225);
        assert.equal(shipment.get("price"), 333);
        assert.equal(
            shipment.get("pickupDateTime").toDate().toISOString(),
            pickupDateTime,
        );
      });

  it("rejects incomplete pickup details and past appointments",
      async () => {
        const businessId = "barrel-pickup-validation";
        await seedBusiness(businessId);
        const call = (overrides = {}) =>
          functions.createBarrelShipmentPaymentIntent.run({
            auth: {uid: CUSTOMER_UID},
            data: {
              senderName: "Barrel Pickup Sender",
              receiverName: "Barrel Pickup Receiver",
              receiverPhone: "+224620000023",
              destinationCountryId: COUNTRY_ID,
              businessId,
              quantity: 1,
              pickupRequested: true,
              pickupAddress: "123 Atlantic Ave, Brooklyn, NY 11201",
              pickupBorough: "Bronx",
              pickupDateTime: futureIso(),
              useWalletBalance: false,
              ...overrides,
            },
          });

        await assert.rejects(
            () => call({pickupAddress: ""}),
            /Pickup address, date, and time are required/,
        );
        await assert.rejects(
            () => call({
              pickupDateTime: new Date(Date.now() - 60000).toISOString(),
            }),
            /Pickup time must be in the future/,
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

  it("falls back to the business's main address when no office " +
      "locations are configured",
  async () => {
    const businessId = "barrel-office-fallback";
    await seedBusiness(businessId);
    const created = await functions.createBarrelShipmentPaymentIntent.run({
      auth: {uid: CUSTOMER_UID},
      data: {
        senderName: "Fallback Sender",
        receiverName: "Fallback Receiver",
        receiverPhone: "+224620000040",
        destinationCountryId: COUNTRY_ID,
        businessId,
        quantity: 1,
        pickupRequested: false,
        useWalletBalance: false,
      },
    });
    const shipment = await db.collection("barrelShipments")
        .doc(created.shipmentId).get();
    assert.equal(shipment.get("pickupAddress"), "100 Test Avenue, Bronx");
    assert.equal(shipment.get("officeLocationId"), "default");
  });

  it("requires choosing among a business's multiple office locations",
      async () => {
        const businessId = "barrel-office-multiple";
        await seedBusiness(businessId);
        await db.collection("businesses").doc(businessId)
            .collection("officeLocations").doc("bronx").set({
              businessId,
              label: "Bronx Warehouse",
              address: "10 Bronx Way, Bronx, NY",
              isActive: true,
              sortOrder: 0,
            });
        await db.collection("businesses").doc(businessId)
            .collection("officeLocations").doc("manhattan").set({
              businessId,
              label: "Manhattan Office",
              address: "20 Manhattan Ave, New York, NY",
              isActive: true,
              sortOrder: 1,
            });

        const attempt = () => functions.createBarrelShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: {
            senderName: "Multi Sender",
            receiverName: "Multi Receiver",
            receiverPhone: "+224620000041",
            destinationCountryId: COUNTRY_ID,
            businessId,
            quantity: 1,
            pickupRequested: false,
            useWalletBalance: false,
          },
        });
        await assert.rejects(attempt, /multiple office locations/);

        await assert.rejects(
            () => functions.createBarrelShipmentPaymentIntent.run({
              auth: {uid: CUSTOMER_UID},
              data: {
                senderName: "Multi Sender",
                receiverName: "Multi Receiver",
                receiverPhone: "+224620000041",
                destinationCountryId: COUNTRY_ID,
                businessId,
                quantity: 1,
                pickupRequested: false,
                officeLocationId: "not-a-real-location",
                useWalletBalance: false,
              },
            }),
            /Select a valid office location/,
        );

        const created = await functions.createBarrelShipmentPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: {
            senderName: "Multi Sender",
            receiverName: "Multi Receiver",
            receiverPhone: "+224620000041",
            destinationCountryId: COUNTRY_ID,
            businessId,
            quantity: 1,
            pickupRequested: false,
            officeLocationId: "manhattan",
            useWalletBalance: false,
          },
        });
        const shipment = await db.collection("barrelShipments")
            .doc(created.shipmentId).get();
        assert.equal(
            shipment.get("pickupAddress"),
            "20 Manhattan Ave, New York, NY",
        );
        assert.equal(shipment.get("officeLocationId"), "manhattan");
        assert.equal(shipment.get("officeLocationLabel"), "Manhattan Office");
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
          barrelShippingDeliveryEstimateMinDays: 12,
          barrelShippingDeliveryEstimateMaxDays: 24,
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

  it("charges shared pickup once for every independent order line",
      async () => {
        const businessId = "barrel-order-shared-pickup";
        const businessRef = await seedBusiness(businessId, {
          pickupPlan: {
            version: 1,
            shared: {
              enabled: true,
              mode: "borough",
              boroughPrices: {Brooklyn: 108, Bronx: 40},
            },
            services: {},
          },
        });
        await businessRef.collection("destinationCountries").doc("gh").set({
          countryId: "gh",
          name: "Ghana",
          code: "GH",
          isActive: true,
          barrelShippingPrice: 300,
          barrelShippingDeliveryEstimateMinDays: 12,
          barrelShippingDeliveryEstimateMaxDays: 24,
        });
        const pickupDateTime = futureIso();
        const created = await functions.createBarrelOrderPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: {
            senderName: "Shared Pickup Sender",
            pickupRequested: true,
            pickupAddress: "123 Atlantic Ave, Brooklyn, NY 11201",
            pickupBorough: "Brooklyn",
            pickupDateTime,
            useWalletBalance: false,
            lines: [
              {
                destinationCountryId: COUNTRY_ID,
                businessId,
                receiverName: "Guinea Receiver",
                receiverPhone: "+224620000030",
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
        const [order, ...shipments] = await Promise.all([
          db.collection("barrelOrders").doc(created.orderId).get(),
          ...created.shipmentIds.map((id) =>
            db.collection("barrelShipments").doc(id).get()),
        ]);

        assert.equal(order.get("lineCount"), 2);
        assert.equal(order.get("quantity"), 3);
        assert.equal(order.get("orderTotal"), 1041);
        assert.deepEqual(
            shipments.map((shipment) => shipment.get("pickupFee")),
            [108, 108],
        );
        assert.deepEqual(
            shipments.map((shipment) => shipment.get("price")),
            [333, 708],
        );
        assert.ok(shipments.every((shipment) =>
          shipment.get("pickupAddress") ===
            "123 Atlantic Ave, Brooklyn, NY 11201" &&
          shipment.get("pickupBorough") === "Brooklyn" &&
          shipment.get("pickupRequested") === true &&
          shipment.get("pickupDateTime").toDate().toISOString() ===
            pickupDateTime));
      });

  it("preserves independent pickup and drop-off details per order line",
      async () => {
        const businessId = "barrel-order-line-pickups";
        const businessRef = await seedBusiness(businessId, {
          pickupPlan: {
            version: 1,
            shared: {
              enabled: true,
              mode: "borough",
              boroughPrices: {Brooklyn: 108, Bronx: 40},
            },
            services: {},
          },
        });
        await businessRef.collection("destinationCountries").doc("gh").set({
          countryId: "gh",
          name: "Ghana",
          code: "GH",
          isActive: true,
          barrelShippingPrice: 300,
          barrelShippingDeliveryEstimateMinDays: 12,
          barrelShippingDeliveryEstimateMaxDays: 24,
        });
        const pickupDateTime = futureIso();
        const created = await functions.createBarrelOrderPaymentIntent.run({
          auth: {uid: CUSTOMER_UID},
          data: {
            senderName: "Line Pickup Sender",
            useWalletBalance: false,
            lines: [
              {
                destinationCountryId: COUNTRY_ID,
                businessId,
                receiverName: "Guinea Receiver",
                receiverPhone: "+224620000031",
                quantity: 1,
                pickupRequested: true,
                pickupAddress: "123 Atlantic Ave, Brooklyn, NY 11201",
                pickupBorough: "Brooklyn",
                pickupDateTime,
              },
              {
                destinationCountryId: "gh",
                businessId,
                receiverName: "Ghana Receiver",
                receiverPhone: "+233201234568",
                quantity: 2,
                pickupRequested: false,
                pickupAddress: "Ignored customer drop-off address",
                pickupBorough: "Office drop-off",
              },
            ],
          },
        });
        const [order, ...shipments] = await Promise.all([
          db.collection("barrelOrders").doc(created.orderId).get(),
          ...created.shipmentIds.map((id) =>
            db.collection("barrelShipments").doc(id).get()),
        ]);

        assert.equal(order.get("pickupRequested"), true);
        assert.equal(order.get("pickupAddress"), "See shipment pickup details");
        assert.equal(order.get("pickupBorough"), "Multiple/line-specific");
        assert.equal(order.get("orderTotal"), 933);
        assert.deepEqual(
            shipments.map((shipment) => shipment.get("pickupRequested")),
            [true, false],
        );
        assert.deepEqual(
            shipments.map((shipment) => shipment.get("pickupAddress")),
            [
              "123 Atlantic Ave, Brooklyn, NY 11201",
              // Office drop-off now resolves to the business's own address
              // (no configured office locations, so it falls back to the
              // business's main address) instead of the old shared global
              // pricing-doc placeholder.
              "100 Test Avenue, Bronx, NY",
            ],
        );
        assert.deepEqual(
            shipments.map((shipment) => shipment.get("pickupBorough")),
            ["Brooklyn", "Office drop-off"],
        );
        assert.deepEqual(
            shipments.map((shipment) => shipment.get("pickupFee")),
            [108, 0],
        );
        assert.deepEqual(
            shipments.map((shipment) => shipment.get("price")),
            [333, 600],
        );
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

    const publicListed = await functions.listPublicParkingOptions.run({
      data: {city: "Bronx", startDate, endDate, pickupRequested: false},
    });
    const publicOption = publicListed.options.find((row) =>
      row.businessId === businessId);
    assert.ok(publicOption);
    assert.equal(publicOption.address, "Bronx");
    assert.equal(Object.hasOwn(publicOption, "phone"), false);
    assert.equal(Object.hasOwn(publicOption, "email"), false);
    assert.equal(Object.hasOwn(publicOption, "latitude"), false);
    assert.equal(Object.hasOwn(publicOption, "longitude"), false);

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
