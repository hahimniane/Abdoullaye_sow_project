#!/usr/bin/env node

const admin = require("firebase-admin");
const {
  buildE2EPlatformAdminProfile,
  buildFreightBalanceFixture,
} = require("./e2e-seed-fixtures");

if (!process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error(
      "Refusing to seed without Firestore and Auth emulator hosts",
  );
}

const projectId = process.env.GCLOUD_PROJECT || "demo-laawol-e2e";
const e2ePassword = String(process.env.E2E_TEST_PASSWORD || "").trim();
if (e2ePassword.length < 12) {
  throw new Error("Set E2E_TEST_PASSWORD to at least 12 characters");
}
admin.initializeApp({projectId});
const db = admin.firestore();

async function resetFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const response = await fetch(
      `http://${host}/emulator/v1/projects/${projectId}` +
      "/databases/(default)/documents",
      {method: "DELETE"},
  );
  if (!response.ok) {
    throw new Error(
        `Could not reset Firestore emulator: ${response.status} ` +
        await response.text(),
    );
  }
}

const accounts = [
  {
    uid: "e2e-customer",
    email: "e2e.customer@laawol.test",
    password: e2ePassword,
    displayName: "E2E Customer",
    phoneNumber: "+17185550199",
  },
  {
    uid: "e2e-customer-b",
    email: "e2e.customer.b@laawol.test",
    password: e2ePassword,
    displayName: "E2E Customer B",
    phoneNumber: "+17185550200",
  },
  {
    uid: "e2e-customer-c",
    email: "e2e.customer.c@laawol.test",
    password: e2ePassword,
    displayName: "E2E Customer C",
    phoneNumber: "+17185550201",
  },
  {
    uid: "e2e-customer-d",
    email: "e2e.customer.d@laawol.test",
    password: e2ePassword,
    displayName: "E2E Customer D",
    phoneNumber: "+17185550202",
  },
  {
    uid: "e2e-customer-unverified",
    email: "e2e.customer.unverified@laawol.test",
    password: e2ePassword,
    displayName: "E2E Unverified Customer",
  },
  {
    uid: "e2e-business-owner",
    email: "e2e.business@laawol.test",
    password: e2ePassword,
    displayName: "E2E Freight Owner",
  },
  {
    uid: "e2e-platform-admin",
    email: "e2e.admin@laawol.test",
    password: e2ePassword,
    displayName: "E2E Platform Admin",
  },
];

async function upsertAccount(account) {
  try {
    await admin.auth().getUser(account.uid);
    await admin.auth().updateUser(account.uid, account);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    await admin.auth().createUser({...account, emailVerified: true});
  }
}

async function main() {
  await resetFirestore();
  await Promise.all(accounts.map(upsertAccount));
  const now = admin.firestore.Timestamp.now();
  const later = admin.firestore.Timestamp.fromMillis(
      Date.now() + 14 * 24 * 60 * 60 * 1000,
  );
  const businessId = "e2e-logistics";
  const batch = db.batch();
  const set = (path, data) => batch.set(db.doc(path), data, {merge: true});
  const freightBalanceFixture = buildFreightBalanceFixture({now, businessId});

  set("users/e2e-customer", {
    role: "customer",
    fullName: "E2E Customer",
    email: "e2e.customer@laawol.test",
    phone: "+17185550199",
    normalizedPhone: "17185550199",
    phoneVerified: true,
    language: "en",
  });
  set("users/e2e-customer-b", {
    role: "customer",
    fullName: "E2E Customer B",
    email: "e2e.customer.b@laawol.test",
    phone: "+17185550200",
    normalizedPhone: "17185550200",
    phoneVerified: true,
    language: "en",
  });
  set("users/e2e-customer-c", {
    role: "customer",
    fullName: "E2E Customer C",
    email: "e2e.customer.c@laawol.test",
    phone: "+17185550201",
    normalizedPhone: "17185550201",
    phoneVerified: true,
    language: "en",
  });
  set("users/e2e-customer-d", {
    role: "customer",
    fullName: "E2E Customer D",
    email: "e2e.customer.d@laawol.test",
    phone: "+17185550202",
    normalizedPhone: "17185550202",
    phoneVerified: true,
    language: "en",
  });
  set("users/e2e-customer-unverified", {
    role: "customer",
    fullName: "E2E Unverified Customer",
    email: "e2e.customer.unverified@laawol.test",
    phone: "+17185550203",
    normalizedPhone: "17185550203",
    phoneVerified: false,
    language: "en",
  });
  set("users/e2e-business-owner", {
    role: "businessOwner",
    businessId,
    fullName: "E2E Freight Owner",
    email: "e2e.business@laawol.test",
    businessPermissions: [
      "overview", "destinations", "barrels", "freight", "transport",
      "parking", "cars", "purchases", "earnings", "profile", "support",
    ],
  });
  set("users/e2e-platform-admin", buildE2EPlatformAdminProfile());
  set(`businesses/${businessId}`, {
    name: "E2E Atlantic Logistics",
    status: "approved",
    ownerUid: "e2e-business-owner",
    phone: "+17185550120",
    email: "e2e.business@laawol.test",
    addressLine1: "100 Test Freight Avenue",
    city: "Bronx",
    state: "NY",
    postalCode: "10451",
    enabledServices: [
      "barrelShipping", "sharedBarrels", "freight", "carSales",
      "carParking", "carTransport",
    ],
    parkingCity: "Bronx",
    parkingAddressLine1: "100 Test Freight Avenue",
    parkingTotalSpaces: 8,
    parkingBlockedSpaces: 0,
    parkingDailyRate: 25,
    parkingWeeklyRate: 140,
    parkingMonthlyRate: 500,
    parkingMinimumDays: 1,
    parkingPickupAvailable: true,
    parkingPickupFee: 40,
    createdAt: now,
    updatedAt: now,
  });
  set(`businesses/${businessId}/destinationCountries/gn`, {
    countryId: "gn",
    name: "Guinea",
    code: "GN",
    isActive: true,
    barrelShippingPrice: 225,
    freightAirPricePerKg: 12.5,
    freightSeaPricePerKg: 5,
    barrelShippingDeliveryEstimateMinDays: 10,
    barrelShippingDeliveryEstimateMaxDays: 20,
    freightAirDeliveryEstimateMinDays: 3,
    freightAirDeliveryEstimateMaxDays: 5,
    freightSeaDeliveryEstimateMinDays: 25,
    freightSeaDeliveryEstimateMaxDays: 35,
    updatedAt: now,
  });
  set("shipmentPricing/barrelPickup", {
    officeAddress: "100 Test Freight Avenue, Bronx, NY 10451",
    boroughPrices: {
      Bronx: 40,
      Manhattan: 64,
      Queens: 84,
      Brooklyn: 108,
      "Staten Island": 148,
    },
    freightPlatformFeePct: 0.1,
    barrelPlatformFeePct: 0.1,
  });
  set("shipmentPricing/serviceFees", {
    parkingPlatformFeePct: 0.1,
    carPurchasePlatformFeePct: 0.1,
    carDepositPlatformFeePct: 0.1,
  });
  set("freightShipments/freight-e2e-balance", {
    trackingCode: "FR-E2E-BALANCE",
    senderName: "E2E Customer",
    senderAddress: "100 Test Freight Avenue, Bronx, NY 10451",
    receiverName: "Aissatou Diallo",
    receiverPhone: "+224620000001",
    destinationCountryId: "gn",
    destinationCountryName: "Guinea",
    businessId,
    businessName: "E2E Atlantic Logistics",
    mode: "air",
    freightPricingVersion: 2,
    settlementVersion: 1,
    estimatedWeightKg: 10,
    weightKg: 10,
    pricePerKg: 12.5,
    pricePerKgCents: 1250,
    pickupFee: 0,
    pickupFeeCents: 0,
    estimatedShippingFee: 125,
    estimatedShippingFeeCents: 12500,
    estimatedTotal: 125,
    estimatedTotalCents: 12500,
    price: 125,
    customerUid: "e2e-customer",
    customerEmail: "e2e.customer@laawol.test",
    cardChargeAmount: 125,
    cardChargeAmountCents: 12500,
    walletAppliedAmount: 0,
    walletAppliedCents: 0,
    stripePaymentIntentId: "simulated_freight_e2e_balance",
    paymentStatus: "succeeded",
    platformFeePct: 0.1,
    paidAt: now,
    createdAt: now,
    updatedAt: now,
    ...freightBalanceFixture.shipmentUpdate,
  });
  set(
      freightBalanceFixture.settlementPath,
      freightBalanceFixture.settlement,
  );
  set("barrelShipments/barrel-e2e", {
    trackingCode: "BR-E2E-001",
    customerUid: "e2e-customer",
    customerEmail: "e2e.customer@laawol.test",
    senderName: "E2E Customer",
    receiverName: "Mamadou Bah",
    receiverPhone: "+224620000002",
    destinationCountryId: "gn",
    destinationCountryName: "Guinea",
    businessId,
    businessName: "E2E Atlantic Logistics",
    price: 225,
    paymentStatus: "succeeded",
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  set("barrelPools/pool-e2e", {
    destinationCountryId: "gn",
    destinationCountryName: "Guinea",
    businessId,
    businessName: "E2E Atlantic Logistics",
    creatorUid: "e2e-business-owner",
    status: "open",
    totalShares: 4,
    acceptedShares: 2,
    requestedShares: 0,
    takenShares: 2,
    openShares: 2,
    maxJoiners: 2,
    pricePerBarrel: 225,
    pricePerShare: 56.25,
    joinDeadline: later,
    createdAt: now,
    updatedAt: now,
  });
  set("openBarrels/pool-e2e", {
    poolId: "pool-e2e",
    destinationCountryId: "gn",
    destinationCountryName: "Guinea",
    businessId,
    businessName: "E2E Atlantic Logistics",
    status: "open",
    totalShares: 4,
    acceptedShares: 2,
    requestedShares: 0,
    takenShares: 2,
    openShares: 2,
    maxJoiners: 2,
    pricePerBarrel: 225,
    pricePerShare: 56.25,
    joinDeadline: later,
    updatedAt: now,
  });
  set("barrelPools/pool-e2e-auto", {
    destinationCountryId: "gn",
    destinationCountryName: "Guinea",
    businessId,
    businessName: "E2E Atlantic Logistics",
    origin: "businessPosted",
    holderRole: "business",
    createdByUid: "e2e-business-owner",
    createdByRole: "businessOwner",
    approvalMode: "auto",
    trackingCode: "BP-E2E-AUTO",
    status: "open",
    totalShares: 2,
    acceptedShares: 0,
    requestedShares: 0,
    takenShares: 0,
    openShares: 2,
    maxJoiners: 2,
    pricePerShare: 112.5,
    depositPerShare: 33.75,
    currency: "usd",
    shipMode: "sea",
    platformFeePct: 0.1,
    joinDeadline: later,
    publicParticipants: {},
    createdAt: now,
    updatedAt: now,
  });
  set("openBarrels/pool-e2e-auto", {
    poolId: "pool-e2e-auto",
    destinationCountryId: "gn",
    destinationCountryName: "Guinea",
    businessId,
    businessName: "E2E Atlantic Logistics",
    origin: "businessPosted",
    holderRole: "business",
    approvalMode: "auto",
    status: "open",
    totalShares: 2,
    acceptedShares: 0,
    requestedShares: 0,
    takenShares: 0,
    openShares: 2,
    sharesAvailable: 2,
    maxJoiners: 2,
    pricePerShare: 112.5,
    depositPerShare: 33.75,
    currency: "usd",
    shipMode: "sea",
    joinDeadline: later,
    createdAt: now,
    updatedAt: now,
  });
  set("transportRequests/transport-e2e", {
    trackingCode: "TR-E2E-001",
    customerUid: "e2e-customer",
    ownerName: "E2E Customer",
    carMake: "Toyota",
    carModel: "Camry",
    carYear: 2022,
    destinationCountryId: "gn",
    destinationCountryName: "Guinea",
    businessId,
    businessName: "E2E Atlantic Logistics",
    status: "pending",
    price: 0,
    createdAt: now,
    updatedAt: now,
  });
  set("parkedCars/parking-e2e", {
    customerUid: "e2e-customer",
    customerName: "E2E Customer",
    businessId,
    businessName: "E2E Atlantic Logistics",
    vehicleTitle: "2021 Honda Accord",
    paymentStatus: "succeeded",
    parkingStatus: "reserved",
    status: "reserved",
    parkingDate: now,
    parkingEndDate: later,
    totalCost: 75,
    totalCostCents: 7500,
    createdAt: now,
    updatedAt: now,
  });
  set("cars/car-e2e", {
    businessId,
    businessName: "E2E Atlantic Logistics",
    title: "2020 Toyota RAV4 XLE",
    make: "Toyota",
    model: "RAV4",
    year: 2020,
    price: 22000,
    mileage: 42000,
    condition: "used",
    bodyType: "suv",
    transmission: "automatic",
    fuelType: "gas",
    drivetrain: "awd",
    exteriorColor: "silver",
    isRebuiltTitle: false,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  set("cars/car-e2e-hold", {
    businessId,
    businessName: "E2E Atlantic Logistics",
    title: "2021 Honda CR-V EX",
    make: "Honda",
    model: "CR-V",
    year: 2021,
    price: 24500,
    mileage: 36000,
    condition: "used",
    bodyType: "suv",
    transmission: "automatic",
    fuelType: "gas",
    drivetrain: "awd",
    exteriorColor: "blue",
    isRebuiltTitle: false,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  set("cars/car-e2e-purchase", {
    businessId,
    businessName: "E2E Atlantic Logistics",
    title: "2022 Nissan Rogue SV",
    make: "Nissan",
    model: "Rogue",
    year: 2022,
    price: 27000,
    mileage: 29000,
    condition: "used",
    bodyType: "suv",
    transmission: "automatic",
    fuelType: "gas",
    drivetrain: "awd",
    exteriorColor: "black",
    isRebuiltTitle: false,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  set("cars/car-e2e-existing-purchase", {
    businessId,
    businessName: "E2E Atlantic Logistics",
    title: "2019 Ford Escape SE",
    make: "Ford",
    model: "Escape",
    year: 2019,
    price: 18500,
    mileage: 51000,
    condition: "used",
    bodyType: "suv",
    transmission: "automatic",
    fuelType: "gas",
    drivetrain: "awd",
    exteriorColor: "white",
    isRebuiltTitle: false,
    status: "reserved",
    createdAt: now,
    updatedAt: now,
  });
  set("carPurchases/purchase-e2e", {
    buyerUid: "e2e-customer",
    buyerName: "E2E Customer",
    businessId,
    businessName: "E2E Atlantic Logistics",
    carId: "car-e2e-existing-purchase",
    carTitle: "2019 Ford Escape SE",
    paymentStatus: "succeeded",
    purchaseStatus: "reserved",
    depositAmount: 500,
    depositAmountCents: 50000,
    createdAt: now,
    updatedAt: now,
  });
  set("wallets/e2e-customer", {
    customerUid: "e2e-customer",
    currency: "USD",
    balanceCents: 10000,
    balance: 100,
    pendingRefundCents: 0,
    pendingRefund: 0,
    updatedAt: now,
  });
  set("wallets/e2e-customer/transactions/e2e-credit", {
    type: "credit",
    reason: "e2e_test_credit",
    status: "completed",
    amountCents: 10000,
    amount: 100,
    currency: "USD",
    createdAt: now,
  });

  await batch.commit();
  process.stdout.write(JSON.stringify({
    projectId,
    businessId,
    accounts: accounts.map(({uid, email}) => ({uid, email})),
    password: e2ePassword,
  }, null, 2) + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
