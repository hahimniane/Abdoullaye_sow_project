const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

const CUSTOMER_UID = "service-test-customer";
const OTHER_UID = "service-test-other";
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
  airRate = 12.5,
  seaRate = 5,
} = {}) {
  const ref = db.collection("businesses").doc(id);
  await Promise.all([
    ref.set({
      name: `Service Test ${id}`,
      status,
      enabledServices: services,
      city: "Bronx",
      addressLine1: "100 Test Avenue",
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
      isActive: destinationActive,
      barrelShippingPrice: 225,
      freightAirPricePerKg: airRate,
      freightSeaPricePerKg: seaRate,
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

describe("freight service callable lifecycle", () => {
  it("lists freight-only destinations without requiring a barrel rate",
      async () => {
        const businessId = "freight-only-discovery-business";
        await seedBusiness(businessId, {services: ["freight"]});
        await db.collection("businesses").doc(businessId)
            .collection("destinationCountries").doc(COUNTRY_ID)
            .set({barrelShippingPrice: 0}, {merge: true});
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

  it("prices an optional pickup and records its appointment", async () => {
    const businessId = "freight-pickup-business";
    await seedBusiness(businessId);
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
    assert.ok(shipment.pickupDateTime);
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
            /Pickup address, borough, date, and time are required/,
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
});

describe("car parking service callable lifecycle", () => {
  it("lists capacity and creates a simulated paid reservation", async () => {
    const businessId = "parking-service-business";
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

describe("car sales service callable lifecycle", () => {
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
});
