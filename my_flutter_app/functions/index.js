const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const {ALL_COUNTRIES} = require("./country_catalog");

// Initialize Firebase Admin SDK
admin.initializeApp();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const googleMapsApiKey = defineSecret("GOOGLE_MAPS_API_KEY");
const DEPOSIT_CURRENCY = "usd";
const DEFAULT_HOLD_MAX_DAYS = 14;
const PURCHASE_CURRENCY = "usd";
const SHIPMENT_CURRENCY = "usd";
const SIMULATE_PAYMENTS = true;
const DEFAULT_BUSINESS_ID = "keren_auto_sales";
const DEFAULT_BUSINESS_NAME = "Keren";
const PLATFORM_ADMIN_EMAIL = "admin@gmail.com";
const VALID_BUSINESS_SERVICES = [
  "barrelShipping",
  "carSales",
  "carParking",
  "carTransport",
];
const DEFAULT_BUSINESS_SERVICES = [...VALID_BUSINESS_SERVICES];
function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }
  return request.auth.uid;
}

exports.ensurePlatformAdminProfile = onCall(async (request) => {
  const uid = requireAuth(request);
  const email = (request.auth.token.email || "").toLowerCase();
  if (email !== PLATFORM_ADMIN_EMAIL) {
    throw new HttpsError(
        "permission-denied",
        "This account is not the platform administrator",
    );
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await admin.firestore().collection("users").doc(uid).set(
      {
        email,
        fullName: "Platform Administrator",
        role: "admin",
        businessId: admin.firestore.FieldValue.delete(),
        businessName: admin.firestore.FieldValue.delete(),
        businessServices: admin.firestore.FieldValue.delete(),
        platformAdmin: true,
        updatedAt: now,
        createdAt: now,
      },
      {merge: true},
  );

  return {
    success: true,
    role: "admin",
    email,
  };
});

async function getUserProfile(uid) {
  const doc = await admin.firestore().collection("users").doc(uid).get();
  if (!doc.exists) {
    throw new HttpsError("permission-denied", "User profile not found");
  }
  return {id: doc.id, ...doc.data()};
}

function canManageBusiness(user, businessId) {
  if (user.role === "admin") return true;
  return (
    (user.role === "staff" || user.role === "businessOwner") &&
    user.businessId === businessId
  );
}

function normalizeBusinessServices(raw, fallback = DEFAULT_BUSINESS_SERVICES) {
  const incoming = Array.isArray(raw) ? raw : [];
  const services = VALID_BUSINESS_SERVICES.filter((service) =>
    incoming.includes(service),
  );
  return services.length ? services : [...fallback];
}

function deliveryEstimateFromCountry(country) {
  const minDays = Number(country.deliveryEstimateMinDays);
  const maxDays = Number(country.deliveryEstimateMaxDays);
  if (
    !Number.isInteger(minDays) ||
    !Number.isInteger(maxDays) ||
    minDays <= 0 ||
    maxDays < minDays
  ) {
    return {};
  }
  return {
    deliveryEstimateMinDays: minDays,
    deliveryEstimateMaxDays: maxDays,
    deliveryEstimateLabel: minDays === maxDays ?
      `${minDays} days` :
      `${minDays}-${maxDays} days`,
  };
}

function compareDestinationOptions(a, b) {
  const country = a.country.name.localeCompare(b.country.name);
  if (country !== 0) return country;
  const aEstimate = deliveryEstimateFromCountry(a.country);
  const bEstimate = deliveryEstimateFromCountry(b.country);
  const aHasEstimate = aEstimate.deliveryEstimateMinDays !== undefined;
  const bHasEstimate = bEstimate.deliveryEstimateMinDays !== undefined;
  if (aHasEstimate !== bHasEstimate) return aHasEstimate ? -1 : 1;
  if (aHasEstimate && bHasEstimate) {
    const minDays =
      aEstimate.deliveryEstimateMinDays - bEstimate.deliveryEstimateMinDays;
    if (minDays !== 0) return minDays;
    const maxDays =
      aEstimate.deliveryEstimateMaxDays - bEstimate.deliveryEstimateMaxDays;
    if (maxDays !== 0) return maxDays;
  }
  const price =
    a.country.barrelShippingPrice - b.country.barrelShippingPrice;
  if (price !== 0) return price;
  return a.businessName.localeCompare(b.businessName);
}

function numberOrFallback(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function intOrFallback(value, fallback) {
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : fallback;
}

function dateOnly(date) {
  return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
  ));
}

function parseHoldUntilDate(raw) {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new HttpsError("invalid-argument", "Choose a valid hold date");
  }
  return dateOnly(date);
}

function resolveHoldPricing(car, business) {
  const useBusiness = car.useBusinessHoldPricing !== false;
  const source = useBusiness ? business : car;
  const mode = source.carHoldPricingMode === "per_day" ? "per_day" : "flat";
  const flatFee = numberOrFallback(source.carHoldFlatFee, 500);
  const dailyRate = numberOrFallback(source.carHoldDailyRate, 100);
  const maxDays = Math.min(
      30,
      Math.max(1, intOrFallback(source.carHoldMaxDays, DEFAULT_HOLD_MAX_DAYS)),
  );
  return {
    mode,
    flatFee: flatFee > 0 ? flatFee : 500,
    dailyRate: dailyRate > 0 ? dailyRate : 100,
    maxDays,
  };
}

function calculateHoldQuote({car, business, holdUntilDate}) {
  const pricing = resolveHoldPricing(car, business);
  const today = dateOnly(new Date());
  const holdDate = parseHoldUntilDate(holdUntilDate);
  const holdDays = Math.ceil((holdDate.getTime() - today.getTime()) /
    (24 * 60 * 60 * 1000));
  if (holdDays < 1) {
    throw new HttpsError(
        "invalid-argument",
        "Hold date must be at least tomorrow",
    );
  }
  if (holdDays > pricing.maxDays) {
    throw new HttpsError(
        "invalid-argument",
        `Hold date must be within ${pricing.maxDays} days`,
    );
  }
  const amount = pricing.mode === "per_day" ?
    pricing.dailyRate * holdDays :
    pricing.flatFee;
  const amountCents = Math.round(amount * 100);
  return {
    holdDate,
    holdExpiresAt: new Date(holdDate.getTime() + 24 * 60 * 60 * 1000),
    holdDays,
    amount,
    amountCents,
    holdPricingMode: pricing.mode,
    holdRateAmount: pricing.mode === "per_day" ?
      pricing.dailyRate :
      pricing.flatFee,
  };
}

function calculateHoldExtensionQuote({purchase, car, business, holdUntilDate}) {
  const newQuote = calculateHoldQuote({car, business, holdUntilDate});
  const currentDate = purchase.holdUntilDate?.toDate?.();
  if (currentDate && newQuote.holdDate.getTime() <=
      dateOnly(currentDate).getTime()) {
    throw new HttpsError(
        "invalid-argument",
        "Choose a later hold date",
    );
  }
  const existingCents = centsFromDollars(purchase.depositAmount);
  const extraCents = Math.max(0, newQuote.amountCents - existingCents);
  return {
    ...newQuote,
    extraAmount: dollarsFromCents(extraCents),
    extraAmountCents: extraCents,
  };
}

function isPaidHold(purchase) {
  return purchase.paymentType === "reservation_deposit";
}

function assertPaidHoldActionable(purchase) {
  if (!isPaidHold(purchase)) {
    throw new HttpsError(
        "failed-precondition",
        "Only paid holds can use this action",
    );
  }
  if (
    purchase.purchaseStatus === "completed" ||
    purchase.purchaseStatus === "no_show" ||
    purchase.purchaseStatus === "cancelled" ||
    purchase.purchaseStatus === "refunded" ||
    purchase.purchaseStatus === "forfeited"
  ) {
    throw new HttpsError(
        "failed-precondition",
        "This hold has already been finalized",
    );
  }
}

function reliabilitySummaryFromUser(user) {
  return user?.carBuyerReliability || {
    paidHolds: 0,
    completedHolds: 0,
    noShows: 0,
    forfeitures: 0,
  };
}

function requireBusinessService(business, service, message) {
  const services = normalizeBusinessServices(business.enabledServices);
  if (!services.includes(service)) {
    throw new HttpsError("failed-precondition", message);
  }
}

async function requireBusinessManager(uid, businessId) {
  const user = await getUserProfile(uid);
  if (!canManageBusiness(user, businessId)) {
    throw new HttpsError("permission-denied", "Business access denied");
  }
  return user;
}

async function getApprovedBusinessDestination({businessId, countryId}) {
  const db = admin.firestore();
  const resolvedBusinessId = businessId || DEFAULT_BUSINESS_ID;
  const businessRef = db.collection("businesses").doc(resolvedBusinessId);
  const destinationRef = businessRef
      .collection("destinationCountries")
      .doc(countryId);
  const [businessDoc, destinationDoc] = await Promise.all([
    businessRef.get(),
    destinationRef.get(),
  ]);

  if (!businessDoc.exists) {
    throw new HttpsError("invalid-argument", "Business is unavailable");
  }
  const business = businessDoc.data();
  if (business.status !== "approved") {
    throw new HttpsError("failed-precondition", "Business is not approved");
  }
  requireBusinessService(
      business,
      "barrelShipping",
      "This business is not accepting barrel shipments",
  );
  if (!destinationDoc.exists || destinationDoc.data().isActive === false) {
    throw new HttpsError("invalid-argument", "Destination is unavailable");
  }
  const country = destinationDoc.data();
  const shippingFee = Number(country.barrelShippingPrice || 0);
  if (!Number.isFinite(shippingFee) || shippingFee <= 0) {
    throw new HttpsError(
        "failed-precondition",
        "This destination does not have a barrel shipping price yet",
    );
  }

  return {
    businessId: resolvedBusinessId,
    business,
    country,
    shippingFee,
    deliveryEstimate: deliveryEstimateFromCountry(country),
  };
}

exports.listActiveBarrelDestinationOptions = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async () => {
      const db = admin.firestore();
      const businesses = await db.collection("businesses")
          .where("status", "==", "approved")
          .get();
      const options = [];

      for (const businessDoc of businesses.docs) {
        const business = businessDoc.data();
        const services = normalizeBusinessServices(business.enabledServices);
        if (!services.includes("barrelShipping")) continue;

        const destinations = await businessDoc.ref
            .collection("destinationCountries")
            .where("isActive", "==", true)
            .get();

        destinations.docs.forEach((destinationDoc) => {
          const country = destinationDoc.data();
          const price = Number(country.barrelShippingPrice || 0);
          if (!Number.isFinite(price) || price <= 0) return;

          options.push({
            id: `${businessDoc.id}_${destinationDoc.id}`,
            businessId: businessDoc.id,
            businessName: business.name || businessDoc.id,
            businessPhone: business.phone || "",
            businessEmail: business.email || "",
            businessWebsite: business.website || "",
            businessProfileImageUrl: business.profileImageUrl || "",
            enabledServices: services,
            serviceNote: business.serviceNote || "",
            businessStatus: "approved",
            country: {
              id: destinationDoc.id,
              name: country.name || destinationDoc.id,
              code: country.code || "",
              isActive: country.isActive === true,
              sortOrder: Number(country.sortOrder || 0),
              barrelShippingPrice: price,
              ...deliveryEstimateFromCountry(country),
            },
          });
        });
      }

      options.sort(compareDestinationOptions);

      return {options};
    },
);

async function requireActiveBusinessForCar(car) {
  const businessId = car.businessId || DEFAULT_BUSINESS_ID;
  const businessDoc = await admin.firestore()
      .collection("businesses")
      .doc(businessId)
      .get();
  if (!businessDoc.exists || businessDoc.data().status !== "approved") {
    throw new HttpsError(
        "failed-precondition",
        "This car's business is not available",
    );
  }
  const business = businessDoc.data();
  requireBusinessService(
      business,
      "carSales",
      "This business is not selling cars right now",
  );
  return {
    businessId,
    business,
  };
}

async function stripeRequest(path, options = {}) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${stripeSecretKey.value()}`,
      "Stripe-Version": "2024-12-18.acacia",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    logger.error("Stripe request failed", data);
    throw new HttpsError(
        "internal",
        data.error?.message || "Stripe request failed",
    );
  }
  return data;
}

async function createStripePaymentIntent(params) {
  const body = new URLSearchParams();
  body.set("amount", String(params.amount));
  body.set("currency", params.currency);
  body.set("automatic_payment_methods[enabled]", "true");
  Object.entries(params.metadata).forEach(([key, value]) => {
    body.set(`metadata[${key}]`, value);
  });
  return stripeRequest("/payment_intents", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body,
  });
}

async function retrieveStripePaymentIntent(paymentIntentId) {
  return stripeRequest(`/payment_intents/${paymentIntentId}`);
}

function carTitle(car) {
  return car.title || `${car.make || ""} ${car.model || ""}`.trim();
}

function carPriceCents(car) {
  const price = Number(car.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new HttpsError(
        "failed-precondition",
        "This car does not have a valid purchase price",
    );
  }
  return Math.round(price * 100);
}

function parseFutureAppointment(value) {
  const appointment = new Date(value);
  if (Number.isNaN(appointment.getTime())) {
    throw new HttpsError("invalid-argument", "Viewing time is invalid");
  }
  if (appointment.getTime() <= Date.now()) {
    throw new HttpsError(
        "invalid-argument",
        "Viewing time must be in the future",
    );
  }
  return appointment;
}

function assertViewingEditable(appointment) {
  const oneHourFromNow = Date.now() + 60 * 60 * 1000;
  if (appointment.getTime() <= oneHourFromNow) {
    throw new HttpsError(
        "failed-precondition",
        "Viewing appointments can only be changed more than one hour " +
          "before the viewing time",
    );
  }
}

function parseFuturePickup(value) {
  const pickup = new Date(value);
  if (Number.isNaN(pickup.getTime())) {
    throw new HttpsError("invalid-argument", "Pickup time is invalid");
  }
  if (pickup.getTime() <= Date.now()) {
    throw new HttpsError(
        "invalid-argument",
        "Pickup time must be in the future",
    );
  }
  return pickup;
}

function isValidPhoneNumber(value) {
  const raw = String(value || "").trim();
  if (!raw || /[A-Za-z]/.test(raw)) return false;
  const normalized = raw.replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(normalized)) return false;
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function requireValidPhoneNumber(value, fieldName) {
  if (!isValidPhoneNumber(value)) {
    throw new HttpsError(
        "invalid-argument",
        `${fieldName} must be a valid phone number with 7 to 15 digits`,
    );
  }
}

function centsFromDollars(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function dollarsFromCents(value) {
  return Math.round(Number(value || 0)) / 100;
}

function slugFromName(value) {
  const slug = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  return slug || `business_${Date.now()}`;
}

function businessPublicFields(data = {}) {
  return {
    name: String(data.name || "").trim(),
    phone: String(data.phone || "").trim(),
    email: String(data.email || "").trim(),
    website: normalizeWebsite(data.website),
    profileImageUrl: String(data.profileImageUrl || "").trim(),
    profileImagePath: String(data.profileImagePath || "").trim(),
    serviceNote: String(data.serviceNote || "").trim(),
    addressLine1: String(data.addressLine1 || "").trim(),
    city: String(data.city || "").trim(),
    state: String(data.state || "").trim(),
    postalCode: String(data.postalCode || "").trim(),
  };
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function normalizeWebsite(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function requireValidWebsite(value) {
  const normalized = normalizeWebsite(value);
  try {
    const parsed = new URL(normalized);
    if (!parsed.hostname || !parsed.hostname.includes(".")) {
      throw new Error("Invalid website");
    }
    return normalized;
  } catch (error) {
    throw new HttpsError("invalid-argument", "Please enter a valid website");
  }
}

async function propagateBusinessSnapshot({
  businessId,
  businessName,
  businessStatus,
  phone,
  email,
  website,
  profileImageUrl,
  profileImagePath,
  enabledServices,
  serviceNote,
  addressLine1,
  city,
  state,
  postalCode,
}) {
  const db = admin.firestore();
  const writes = [];
  const now = admin.firestore.FieldValue.serverTimestamp();

  const destinations = await db.collection("businesses")
      .doc(businessId)
      .collection("destinationCountries")
      .get();
  destinations.docs.forEach((doc) => {
    writes.push({
      ref: doc.ref,
      data: {
        businessName,
        businessPhone: phone || "",
        businessEmail: email || "",
        businessWebsite: website || "",
        businessProfileImageUrl: profileImageUrl || "",
        businessProfileImagePath: profileImagePath || "",
        enabledServices,
        serviceNote: serviceNote || "",
        businessAddressLine1: addressLine1 || "",
        businessCity: city || "",
        businessState: state || "",
        businessPostalCode: postalCode || "",
        businessStatus,
        updatedAt: now,
      },
    });
  });

  const snapshotCollections = ["cars", "barrelShipments", "carPurchases"];
  for (const collection of snapshotCollections) {
    const docs = await db.collection(collection)
        .where("businessId", "==", businessId)
        .get();
    docs.docs.forEach((doc) => {
      writes.push({
        ref: doc.ref,
        data: {
          businessName,
          businessStatus,
          businessPhone: phone || "",
          businessEmail: email || "",
          businessWebsite: website || "",
          businessProfileImageUrl: profileImageUrl || "",
          businessProfileImagePath: profileImagePath || "",
          enabledServices,
          serviceNote: serviceNote || "",
          businessAddressLine1: addressLine1 || "",
          businessCity: city || "",
          businessState: state || "",
          businessPostalCode: postalCode || "",
          updatedAt: now,
        },
      });
    });
  }

  for (let index = 0; index < writes.length; index += 450) {
    const batch = db.batch();
    writes.slice(index, index + 450).forEach((write) => {
      batch.set(write.ref, write.data, {merge: true});
    });
    await batch.commit();
  }
}

function requireCustomerShipmentEditable(shipment, customerUid) {
  if (shipment.customerUid !== customerUid) {
    throw new HttpsError("permission-denied", "Shipment access denied");
  }
  if (shipment.status !== "pending") {
    throw new HttpsError(
        "failed-precondition",
        "This shipment can no longer be changed",
    );
  }
  if (
    shipment.pickupDateTime &&
    shipment.pickupDateTime.toMillis() <= Date.now()
  ) {
    throw new HttpsError(
        "failed-precondition",
        "Pickup time has passed, so this shipment can no longer be changed",
    );
  }
}

async function creditWallet({
  transaction,
  customerUid,
  amountCents,
  shipmentId,
  trackingCode,
  reason,
  businessId,
  businessName,
}) {
  if (amountCents <= 0) return;
  const db = admin.firestore();
  const walletRef = db.collection("wallets").doc(customerUid);
  const creditRef = walletRef.collection("transactions").doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  transaction.set(walletRef, {
    customerUid,
    currency: SHIPMENT_CURRENCY,
    balanceCents: admin.firestore.FieldValue.increment(amountCents),
    balance: admin.firestore.FieldValue.increment(
        dollarsFromCents(amountCents),
    ),
    updatedAt: now,
  }, {merge: true});
  transaction.set(creditRef, {
    type: "credit",
    reason,
    amountCents,
    amount: dollarsFromCents(amountCents),
    currency: SHIPMENT_CURRENCY,
    shipmentId,
    trackingCode,
    businessId: businessId || "",
    businessName: businessName || "",
    createdAt: now,
  });
}

async function debitWallet({
  transaction,
  customerUid,
  amountCents,
  shipmentId,
  trackingCode,
  reason,
  businessId,
  businessName,
}) {
  if (amountCents <= 0) return 0;
  const db = admin.firestore();
  const walletRef = db.collection("wallets").doc(customerUid);
  const walletDoc = await transaction.get(walletRef);
  const wallet = walletDoc.exists ? walletDoc.data() : {};
  const balanceCents = Number(wallet.balanceCents || 0);
  const appliedCents = Math.max(
      0,
      Math.min(
          amountCents,
          Number.isFinite(balanceCents) ? balanceCents : 0,
      ),
  );
  if (appliedCents <= 0) return 0;

  const debitRef = walletRef.collection("transactions").doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  transaction.set(walletRef, {
    customerUid,
    currency: SHIPMENT_CURRENCY,
    balanceCents: admin.firestore.FieldValue.increment(-appliedCents),
    balance: admin.firestore.FieldValue.increment(
        -dollarsFromCents(appliedCents),
    ),
    updatedAt: now,
  }, {merge: true});
  transaction.set(debitRef, {
    type: "debit",
    reason,
    amountCents: appliedCents,
    amount: dollarsFromCents(appliedCents),
    currency: SHIPMENT_CURRENCY,
    shipmentId,
    trackingCode,
    businessId: businessId || "",
    businessName: businessName || "",
    createdAt: now,
  });
  return appliedCents;
}

exports.requestWalletCardRefund = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const db = admin.firestore();
      const walletRef = db.collection("wallets").doc(customerUid);
      const requestRef = db.collection("walletRefundRequests").doc();
      const debitRef = walletRef.collection("transactions").doc();
      const userRecord = await admin.auth().getUser(customerUid);

      return db.runTransaction(async (transaction) => {
        const walletDoc = await transaction.get(walletRef);
        const wallet = walletDoc.exists ? walletDoc.data() : {};
        const balanceCents = Number(wallet.balanceCents || 0);
        if (!Number.isFinite(balanceCents) || balanceCents <= 0) {
          throw new HttpsError(
              "failed-precondition",
              "There is no wallet balance to return",
          );
        }

        const amount = dollarsFromCents(balanceCents);
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.set(walletRef, {
          customerUid,
          currency: wallet.currency || SHIPMENT_CURRENCY,
          balanceCents: admin.firestore.FieldValue.increment(-balanceCents),
          balance: admin.firestore.FieldValue.increment(-amount),
          pendingRefundCents: admin.firestore.FieldValue.increment(
              balanceCents,
          ),
          pendingRefund: admin.firestore.FieldValue.increment(amount),
          updatedAt: now,
        }, {merge: true});
        transaction.set(debitRef, {
          type: "debit",
          reason: "card_refund_request",
          status: "pending",
          amountCents: balanceCents,
          amount,
          currency: wallet.currency || SHIPMENT_CURRENCY,
          refundRequestId: requestRef.id,
          createdAt: now,
        });
        transaction.set(requestRef, {
          customerUid,
          customerEmail: userRecord.email || "",
          amountCents: balanceCents,
          amount,
          currency: wallet.currency || SHIPMENT_CURRENCY,
          status: "pending",
          destination: "original_card",
          createdAt: now,
          updatedAt: now,
        });

        return {
          success: true,
          refundRequestId: requestRef.id,
          amount,
          amountCents: balanceCents,
        };
      });
    },
);

exports.submitBusinessApplication = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const applicantUid = requireAuth(request);
      const {
        ownerName,
        ownerPhone,
        businessName,
        businessPhone,
        businessEmail,
        businessWebsite,
        profileImageUrl,
        profileImagePath,
        enabledServices,
        serviceNote,
        addressLine1,
        city,
        state,
        postalCode,
      } = request.data || {};

      if (!ownerName || !ownerPhone || !businessName) {
        throw new HttpsError(
            "invalid-argument",
            "Owner name, owner phone, and business name are required",
        );
      }
      requireValidPhoneNumber(ownerPhone, "Owner phone");
      if (businessPhone) {
        requireValidPhoneNumber(businessPhone, "Business phone");
      }
      if (businessEmail && !isValidEmail(businessEmail)) {
        throw new HttpsError(
            "invalid-argument",
            "Please enter a valid business email",
        );
      }
      const normalizedBusinessWebsite = businessWebsite ?
        requireValidWebsite(businessWebsite) :
        "";
      const normalizedServices = normalizeBusinessServices(
          enabledServices,
          [],
      );
      if (!normalizedServices.length) {
        throw new HttpsError(
            "invalid-argument",
            "Choose at least one business service",
        );
      }

      const userRecord = await admin.auth().getUser(applicantUid);
      const db = admin.firestore();
      const baseId = slugFromName(businessName);
      let businessId = baseId;
      let suffix = 2;
      for (let attempt = 0; attempt < 25; attempt++) {
        const existing = await db
            .collection("businesses")
            .doc(businessId)
            .get();
        if (!existing.exists || existing.data().ownerUid === applicantUid) {
          break;
        }
        businessId = `${baseId}_${suffix}`;
        suffix += 1;
      }

      const businessRef = db.collection("businesses").doc(businessId);
      const applicationRef = db.collection("businessApplications").doc();
      const notificationRef = db.collection("platformNotifications").doc();
      const now = admin.firestore.FieldValue.serverTimestamp();
      const profile = businessPublicFields({
        name: businessName,
        phone: businessPhone || ownerPhone,
        email: businessEmail || userRecord.email || "",
        website: normalizedBusinessWebsite,
        profileImageUrl,
        profileImagePath,
        serviceNote,
        addressLine1,
        city,
        state,
        postalCode,
      });

      await db.runTransaction(async (transaction) => {
        const businessDoc = await transaction.get(businessRef);
        const currentStatus = businessDoc.data()?.status || "pending";
        const status = currentStatus === "approved" ? "approved" : "pending";
        transaction.set(businessRef, {
          ...profile,
          status,
          ownerUid: applicantUid,
          ownerName: String(ownerName).trim(),
          ownerPhone: String(ownerPhone).trim(),
          ownerEmail: userRecord.email || "",
          enabledServices: normalizedServices,
          applicationStatus: status === "approved" ? "approved" : "pending",
          createdAt: businessDoc.exists ?
            businessDoc.data().createdAt || now :
            now,
          updatedAt: now,
          appliedAt: businessDoc.data()?.appliedAt || now,
        }, {merge: true});
        transaction.set(db.collection("users").doc(applicantUid), {
          email: userRecord.email || "",
          fullName: String(ownerName).trim(),
          phone: String(ownerPhone).trim(),
          role: "businessOwner",
          businessId,
          businessName: profile.name,
          businessServices: normalizedServices,
          updatedAt: now,
          createdAt: now,
        }, {merge: true});
        transaction.set(applicationRef, {
          businessId,
          businessName: profile.name,
          applicantUid,
          applicantEmail: userRecord.email || "",
          ownerName: String(ownerName).trim(),
          ownerPhone: String(ownerPhone).trim(),
          status: "pending",
          submittedAt: now,
          updatedAt: now,
          profile,
          enabledServices: normalizedServices,
        });
        transaction.set(notificationRef, {
          type: "business_application",
          status: "unread",
          businessId,
          businessName: profile.name,
          applicantUid,
          applicantEmail: userRecord.email || "",
          title: "New business application",
          message: `${profile.name} is waiting for platform approval.`,
          enabledServices: normalizedServices,
          createdAt: now,
          updatedAt: now,
        });
      });

      return {
        success: true,
        businessId,
        businessName: profile.name,
        enabledServices: normalizedServices,
        status: "pending",
      };
    },
);

exports.reviewBusinessApplication = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const adminUid = requireAuth(request);
      const adminUser = await getUserProfile(adminUid);
      if (adminUser.role !== "admin") {
        throw new HttpsError(
            "permission-denied",
            "Only platform admins can review business applications",
        );
      }

      const {
        businessId,
        action,
        name,
        phone,
        email,
        website,
        profileImageUrl,
        profileImagePath,
        enabledServices,
        serviceNote,
        ownerUid,
        reviewNote,
      } = request.data || {};
      if (!businessId || !action) {
        throw new HttpsError(
            "invalid-argument",
            "Business and review action are required",
        );
      }
      const statusByAction = {
        approve: "approved",
        suspend: "suspended",
        reject: "rejected",
        request_changes: "changes_requested",
      };
      const nextStatus = statusByAction[action];
      if (!nextStatus) {
        throw new HttpsError("invalid-argument", "Invalid review action");
      }

      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }
      const current = businessDoc.data();
      const profile = businessPublicFields({
        name: name || current.name,
        phone: phone || current.phone,
        email: email || current.email,
        website: website ?? current.website,
        profileImageUrl: profileImageUrl ?? current.profileImageUrl,
        profileImagePath: profileImagePath ?? current.profileImagePath,
        serviceNote: serviceNote ?? current.serviceNote,
      });
      if (!profile.name) {
        throw new HttpsError("invalid-argument", "Business name is required");
      }
      if (profile.email && !isValidEmail(profile.email)) {
        throw new HttpsError(
            "invalid-argument",
            "Please enter a valid business email",
        );
      }
      if (profile.website) {
        profile.website = requireValidWebsite(profile.website);
      }
      const normalizedServices = normalizeBusinessServices(
          enabledServices,
          current.enabledServices || DEFAULT_BUSINESS_SERVICES,
      );

      const now = admin.firestore.FieldValue.serverTimestamp();
      await businessRef.set({
        ...profile,
        enabledServices: normalizedServices,
        ownerUid: ownerUid || current.ownerUid || "",
        status: nextStatus,
        applicationStatus: nextStatus,
        reviewedAt: now,
        reviewedBy: adminUid,
        reviewNote: String(reviewNote || "").trim(),
        updatedAt: now,
      }, {merge: true});

      const resolvedOwnerUid = ownerUid || current.ownerUid;
      if (resolvedOwnerUid) {
        await db.collection("users").doc(resolvedOwnerUid).set({
          role: "businessOwner",
          businessId,
          businessName: profile.name,
          businessServices: normalizedServices,
          updatedAt: now,
        }, {merge: true});
      }

      const applicationDocs = await db.collection("businessApplications")
          .where("businessId", "==", businessId)
          .where("status", "==", "pending")
          .get();
      const notificationDocs = await db.collection("platformNotifications")
          .where("businessId", "==", businessId)
          .where("type", "==", "business_application")
          .get();
      const batch = db.batch();
      applicationDocs.docs.forEach((doc) => {
        batch.update(doc.ref, {
          status: nextStatus,
          enabledServices: normalizedServices,
          reviewedAt: now,
          reviewedBy: adminUid,
          reviewNote: String(reviewNote || "").trim(),
          updatedAt: now,
        });
      });
      notificationDocs.docs.forEach((doc) => {
        batch.update(doc.ref, {
          status: "resolved",
          resolvedAt: now,
          resolvedBy: adminUid,
          updatedAt: now,
        });
      });
      await batch.commit();

      await propagateBusinessSnapshot({
        businessId,
        businessName: profile.name,
        businessStatus: nextStatus,
        phone: profile.phone,
        email: profile.email,
        website: profile.website,
        profileImageUrl: profile.profileImageUrl,
        profileImagePath: profile.profileImagePath,
        enabledServices: normalizedServices,
        serviceNote: profile.serviceNote,
        addressLine1: profile.addressLine1,
        city: profile.city,
        state: profile.state,
        postalCode: profile.postalCode,
      });

      return {
        success: true,
        businessId,
        businessName: profile.name,
        status: nextStatus,
      };
    },
);

exports.updateBusinessProfile = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const {
        businessId,
        name,
        phone,
        email,
        website,
        profileImageUrl,
        profileImagePath,
        enabledServices,
        serviceNote,
        addressLine1,
        city,
        state,
        postalCode,
        carHoldPricingMode,
        carHoldFlatFee,
        carHoldDailyRate,
        carHoldMaxDays,
      } = request.data || {};
      const user = await requireBusinessManager(callerUid, businessId);
      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }
      const current = businessDoc.data();
      if (user.role !== "admin" && user.role !== "businessOwner") {
        throw new HttpsError(
            "permission-denied",
            "Only business owners can update business settings",
        );
      }

      const profile = businessPublicFields({
        name: name || current.name,
        phone: phone ?? current.phone,
        email: email ?? current.email,
        website: website ?? current.website,
        profileImageUrl: profileImageUrl ?? current.profileImageUrl,
        profileImagePath: profileImagePath ?? current.profileImagePath,
        serviceNote: serviceNote ?? current.serviceNote,
        addressLine1: addressLine1 ?? current.addressLine1,
        city: city ?? current.city,
        state: state ?? current.state,
        postalCode: postalCode ?? current.postalCode,
      });
      if (!profile.name) {
        throw new HttpsError("invalid-argument", "Business name is required");
      }
      if (profile.phone) {
        requireValidPhoneNumber(profile.phone, "Business phone");
      }
      if (profile.email && !isValidEmail(profile.email)) {
        throw new HttpsError(
            "invalid-argument",
            "Please enter a valid business email",
        );
      }
      if (profile.website) {
        profile.website = requireValidWebsite(profile.website);
      }
      const normalizedServices = normalizeBusinessServices(
          enabledServices,
          current.enabledServices || DEFAULT_BUSINESS_SERVICES,
      );
      const holdMode = carHoldPricingMode === "per_day" ? "per_day" : "flat";
      const holdFlatFee = numberOrFallback(carHoldFlatFee, 500);
      const holdDailyRate = numberOrFallback(carHoldDailyRate, 100);
      const holdMaxDays = Math.min(
          30,
          Math.max(1, intOrFallback(carHoldMaxDays, DEFAULT_HOLD_MAX_DAYS)),
      );
      if ((holdMode === "flat" && holdFlatFee <= 0) ||
          (holdMode === "per_day" && holdDailyRate <= 0)) {
        throw new HttpsError(
            "invalid-argument",
            "Paid hold pricing must be greater than zero",
        );
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      await businessRef.set({
        ...profile,
        enabledServices: normalizedServices,
        carHoldPricingMode: holdMode,
        carHoldFlatFee: holdFlatFee > 0 ? holdFlatFee : 500,
        carHoldDailyRate: holdDailyRate > 0 ? holdDailyRate : 100,
        carHoldMaxDays: holdMaxDays,
        updatedAt: now,
      }, {merge: true});

      const users = await db.collection("users")
          .where("businessId", "==", businessId)
          .where("role", "in", ["staff", "businessOwner"])
          .get();
      const batch = db.batch();
      users.docs.forEach((doc) => {
        batch.set(doc.ref, {
          businessName: profile.name,
          businessServices: normalizedServices,
          updatedAt: now,
        }, {merge: true});
      });
      await batch.commit();

      await propagateBusinessSnapshot({
        businessId,
        businessName: profile.name,
        businessStatus: current.status || "pending",
        phone: profile.phone,
        email: profile.email,
        website: profile.website,
        profileImageUrl: profile.profileImageUrl,
        profileImagePath: profile.profileImagePath,
        enabledServices: normalizedServices,
        serviceNote: profile.serviceNote,
        addressLine1: profile.addressLine1,
        city: profile.city,
        state: profile.state,
        postalCode: profile.postalCode,
      });

      return {
        success: true,
        businessId,
        businessName: profile.name,
        enabledServices: normalizedServices,
      };
    },
);

async function generateTrackingCode(prefix, collectionPath) {
  const db = admin.firestore();
  for (let attempt = 0; attempt < 8; attempt++) {
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    const code = `${prefix}-${Date.now().toString(36).toUpperCase()}-${random}`;
    const existing = await db
        .collection(collectionPath)
        .where("trackingCode", "==", code)
        .limit(1)
        .get();
    if (existing.empty) return code;
  }
  throw new HttpsError("internal", "Could not generate tracking code");
}

function barrelPickupPricingFromData(data) {
  const defaults = {
    officeAddress: "Bronx, NY",
    boroughPrices: {
      Bronx: 40,
      Manhattan: 64,
      Queens: 84,
      Brooklyn: 108,
      "Staten Island": 148,
    },
  };
  const pricing = data || {};
  const legacyPrices = boroughPricesFromLegacyMileage(pricing);
  return {
    officeAddress: pricing.officeAddress || defaults.officeAddress,
    boroughPrices: {
      ...defaults.boroughPrices,
      ...legacyPrices,
      ...(pricing.boroughPrices || {}),
    },
  };
}

const NYC_BOROUGHS = new Set([
  "Bronx",
  "Manhattan",
  "Brooklyn",
  "Queens",
  "Staten Island",
]);

function boroughFromPostalCode(postalCode) {
  const zip = Number.parseInt(String(postalCode || "").slice(0, 5), 10);
  if (!Number.isFinite(zip)) return null;
  if (zip >= 10000 && zip <= 10299) return "Manhattan";
  if (zip >= 10300 && zip <= 10399) return "Staten Island";
  if (zip >= 10400 && zip <= 10499) return "Bronx";
  if (zip >= 11200 && zip <= 11299) return "Brooklyn";
  if ((zip >= 11000 && zip <= 11199) || (zip >= 11300 && zip <= 11699)) {
    return "Queens";
  }
  return null;
}

function boroughFromComponents(components) {
  const values = components.flatMap((component) => [
    component.long_name,
    component.short_name,
  ]);
  for (const value of values) {
    if (NYC_BOROUGHS.has(value)) return value;
    if (value === "New York") return "Manhattan";
    if (value === "Kings County") return "Brooklyn";
    if (value === "Queens County") return "Queens";
    if (value === "Bronx County") return "Bronx";
    if (value === "Richmond County") return "Staten Island";
  }

  const postal = components.find((component) =>
    component.types.includes("postal_code"),
  );
  return boroughFromPostalCode(postal?.long_name);
}

function addressComponent(components, type) {
  return components.find((component) => component.types.includes(type));
}

function pickupSuggestionFromPlace(place) {
  const components = place.address_components || [];
  const streetNumber = addressComponent(components, "street_number");
  const route = addressComponent(components, "route");
  const postalCode = addressComponent(components, "postal_code");
  const borough = boroughFromComponents(components);
  if (!borough || !streetNumber || !route) return null;

  const street = `${streetNumber.long_name} ${route.long_name}`;
  const zip = postalCode?.long_name || "";
  const description = [street, borough, "NY", zip]
      .filter(Boolean)
      .join(", ");

  return {
    description,
    placeId: place.place_id || "",
    borough,
    postalCode: zip,
    formattedAddress: place.formatted_address || description,
    latitude: place.geometry?.location?.lat ?? null,
    longitude: place.geometry?.location?.lng ?? null,
  };
}

async function googlePlacesJson(path, params) {
  const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/${path}/json?${params}`,
  );
  const data = await response.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    logger.warn(`Places ${path} failed`, data);
    throw new HttpsError(
        "internal",
        data.error_message || "Address autocomplete is unavailable",
    );
  }
  return data;
}

function boroughPricesFromLegacyMileage(pricing) {
  if (!pricing || !pricing.boroughMiles) return {};
  const basePickupFee = Number(pricing.basePickupFee ?? 20);
  const perMileFee = Number(pricing.perMileFee ?? 4);
  const minimumPickupFee = Number(pricing.minimumPickupFee ?? 35);
  return Object.entries(pricing.boroughMiles).reduce(
      (prices, [borough, miles]) => {
        const calculated = basePickupFee + Number(miles || 0) * perMileFee;
        prices[borough] = Math.max(calculated, minimumPickupFee);
        return prices;
      },
      {},
  );
}

function pickupFeeForBorough(pricing, borough) {
  const fee = Number(
      pricing.boroughPrices[borough] || pricing.boroughPrices.Bronx || 0,
  );
  return {
    miles: 0,
    fee,
  };
}

/**
 * Cloud Function to create a new user account
 * This allows admins to create staff users without logging out
 */
exports.createStaffUser = onCall(
    {
      enforceAppCheck: false, // Set to true in production if using App Check
      cors: true,
    },
    async (request) => {
      logger.info("createStaffUser called", {
        uid: request.auth?.uid,
        data: request.data,
      });

      // Verify that the request is authenticated
      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "Authentication required to create users",
        );
      }

      const callerUid = request.auth.uid;

      try {
      // Get the caller's user document to check staff creation scope.
        const callerDoc = await admin
            .firestore()
            .collection("users")
            .doc(callerUid)
            .get();

        if (!callerDoc.exists) {
          throw new HttpsError("permission-denied", "User profile not found");
        }

        const callerData = callerDoc.data();

        const requestedBusinessId =
          request.data.businessId ||
          callerData.businessId ||
          DEFAULT_BUSINESS_ID;
        const businessDoc = await admin.firestore()
            .collection("businesses")
            .doc(requestedBusinessId)
            .get();
        if (!businessDoc.exists) {
          throw new HttpsError("invalid-argument", "Business not found");
        }
        const business = businessDoc.data();

        if (
          callerData.role !== "admin" &&
          !(
            callerData.role === "businessOwner" &&
            callerData.businessId === requestedBusinessId
          )
        ) {
          logger.warn("Non-admin attempted to create user", {
            uid: callerUid,
            role: callerData.role,
          });
          throw new HttpsError(
              "permission-denied",
              "Only platform admins or business owners can create staff users",
          );
        }

        // Extract user details from the request
        const {
          email,
          password,
          fullName,
          phone,
          profileImageUrl,
          profileImagePath,
        } = request.data;

        // Validate input
        if (!email || !password) {
          throw new HttpsError(
              "invalid-argument",
              "Email and password are required",
          );
        }

        if (password.length < 6) {
          throw new HttpsError(
              "invalid-argument",
              "Password must be at least 6 characters",
          );
        }
        if (phone) {
          requireValidPhoneNumber(phone, "Staff phone");
        }

        // Create the new user using Admin SDK
        const userRecord = await admin.auth().createUser({
          email: email,
          password: password,
          displayName: String(fullName || "").trim() || undefined,
        });

        logger.info("User created in Firebase Auth", {
          uid: userRecord.uid,
          email: userRecord.email,
        });

        // Create the user document in Firestore with staff role
        await admin.firestore().collection("users").doc(userRecord.uid).set({
          email: email,
          fullName: String(fullName || "").trim(),
          phone: String(phone || "").trim(),
          profileImageUrl: String(profileImageUrl || "").trim(),
          profileImagePath: String(profileImagePath || "").trim(),
          role: "staff",
          businessId: requestedBusinessId,
          businessName: business.name || DEFAULT_BUSINESS_NAME,
          businessServices: normalizeBusinessServices(
              business.enabledServices,
          ),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: callerUid,
        });

        logger.info("User document created in Firestore", {
          uid: userRecord.uid,
          role: "staff",
        });

        return {
          success: true,
          uid: userRecord.uid,
          email: userRecord.email,
          message: "Staff user created successfully",
        };
      } catch (error) {
        logger.error("Error creating staff user", error);

        // Handle specific Firebase Auth errors
        if (error.code === "auth/email-already-exists") {
          throw new HttpsError(
              "already-exists",
              "A user with this email already exists",
          );
        }

        if (error.code === "auth/invalid-email") {
          throw new HttpsError("invalid-argument", "Invalid email address");
        }

        if (error.code === "auth/weak-password") {
          throw new HttpsError(
              "invalid-argument",
              "The password is too weak",
          );
        }

        // Re-throw HttpsError instances
        if (error instanceof HttpsError) {
          throw error;
        }

        // Generic error
        throw new HttpsError(
            "internal",
            "An error occurred while creating the user",
        );
      }
    },
);

exports.createPlatformManager = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const caller = await getUserProfile(callerUid);
      if (caller.role !== "admin") {
        throw new HttpsError(
            "permission-denied",
            "Only platform admins can create platform managers",
        );
      }

      const {email, password, fullName, phone} = request.data;
      const normalizedEmail = String(email || "").trim().toLowerCase();
      const managerName = String(fullName || "").trim();
      const managerPhone = String(phone || "").trim();

      if (!normalizedEmail || !password || !managerName) {
        throw new HttpsError(
            "invalid-argument",
            "Name, email, and password are required",
        );
      }
      if (String(password).length < 6) {
        throw new HttpsError(
            "invalid-argument",
            "Password must be at least 6 characters",
        );
      }
      if (managerPhone) {
        requireValidPhoneNumber(managerPhone, "Platform manager phone");
      }

      try {
        const userRecord = await admin.auth().createUser({
          email: normalizedEmail,
          password: String(password),
          displayName: managerName,
        });
        await admin.firestore().collection("users").doc(userRecord.uid).set({
          email: normalizedEmail,
          fullName: managerName,
          phone: managerPhone,
          role: "admin",
          platformAdmin: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: callerUid,
        });
        return {
          success: true,
          uid: userRecord.uid,
          email: normalizedEmail,
          role: "admin",
        };
      } catch (error) {
        logger.error("Error creating platform manager", error);
        if (error.code === "auth/email-already-exists") {
          throw new HttpsError(
              "already-exists",
              "A user with this email already exists",
          );
        }
        if (error.code === "auth/invalid-email") {
          throw new HttpsError("invalid-argument", "Invalid email address");
        }
        if (error.code === "auth/weak-password") {
          throw new HttpsError(
              "invalid-argument",
              "The password is too weak",
          );
        }
        if (error instanceof HttpsError) throw error;
        throw new HttpsError(
            "internal",
            "An error occurred while creating the platform manager",
        );
      }
    },
);

/**
 * Cloud Function to update a user's role
 * This allows admins to change user roles
 */
exports.updateUserRole = onCall(
    {
      enforceAppCheck: false, // Set to true in production if using App Check
      cors: true,
    },
    async (request) => {
      logger.info("updateUserRole called", {
        uid: request.auth?.uid,
        data: request.data,
      });

      // Verify that the request is authenticated
      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "Authentication required to update user roles",
        );
      }

      const callerUid = request.auth.uid;

      try {
      // Get the caller's user document to check if they're an admin
        const callerDoc = await admin
            .firestore()
            .collection("users")
            .doc(callerUid)
            .get();

        if (!callerDoc.exists) {
          throw new HttpsError("permission-denied", "User profile not found");
        }

        const callerData = callerDoc.data();

        // Check if the caller has admin role
        if (callerData.role !== "admin") {
          logger.warn("Non-admin attempted to update user role", {
            uid: callerUid,
            role: callerData.role,
          });
          throw new HttpsError(
              "permission-denied",
              "Only admins can update user roles",
          );
        }

        // Extract details from the request
        const {userId, newRole} = request.data;

        // Validate input
        if (!userId || !newRole) {
          throw new HttpsError(
              "invalid-argument",
              "User ID and new role are required",
          );
        }

        // Validate role
        const validRoles = ["customer", "staff", "businessOwner", "admin"];
        if (!validRoles.includes(newRole)) {
          throw new HttpsError(
              "invalid-argument",
              `Invalid role. Must be one of: ${validRoles.join(", ")}`,
          );
        }

        // Update the user's role in Firestore
        await admin.firestore().collection("users").doc(userId).update({
          role: newRole,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: callerUid,
        });

        logger.info("User role updated", {
          userId: userId,
          newRole: newRole,
          updatedBy: callerUid,
        });

        return {
          success: true,
          userId: userId,
          newRole: newRole,
          message: `User role updated to ${newRole}`,
        };
      } catch (error) {
        logger.error("Error updating user role", error);

        // Re-throw HttpsError instances
        if (error instanceof HttpsError) {
          throw error;
        }

        // Generic error
        throw new HttpsError(
            "internal",
            "An error occurred while updating the user role",
        );
      }
    },
);

/**
 * Cloud Function to delete a user
 * This allows admins to delete user accounts
 */
exports.deleteUser = onCall(
    {
      enforceAppCheck: false, // Set to true in production if using App Check
      cors: true,
    },
    async (request) => {
      logger.info("deleteUser called", {
        uid: request.auth?.uid,
        data: request.data,
      });

      // Verify that the request is authenticated
      if (!request.auth) {
        throw new HttpsError(
            "unauthenticated",
            "Authentication required to delete users",
        );
      }

      const callerUid = request.auth.uid;

      try {
      // Get the caller's user document to check if they're an admin
        const callerDoc = await admin
            .firestore()
            .collection("users")
            .doc(callerUid)
            .get();

        if (!callerDoc.exists) {
          throw new HttpsError("permission-denied", "User profile not found");
        }

        const callerData = callerDoc.data();

        // Check if the caller has admin role
        if (callerData.role !== "admin") {
          logger.warn("Non-admin attempted to delete user", {
            uid: callerUid,
            role: callerData.role,
          });
          throw new HttpsError(
              "permission-denied",
              "Only admins can delete users",
          );
        }

        // Extract user ID from the request
        const {userId} = request.data;

        // Validate input
        if (!userId) {
          throw new HttpsError("invalid-argument", "User ID is required");
        }

        // Prevent admin from deleting themselves
        if (userId === callerUid) {
          throw new HttpsError(
              "invalid-argument",
              "You cannot delete your own account",
          );
        }

        // Delete from Firebase Auth
        await admin.auth().deleteUser(userId);

        logger.info("User deleted from Firebase Auth", {userId: userId});

        // Delete from Firestore
        await admin.firestore().collection("users").doc(userId).delete();

        logger.info("User document deleted from Firestore", {userId: userId});

        return {
          success: true,
          userId: userId,
          message: "User deleted successfully",
        };
      } catch (error) {
        logger.error("Error deleting user", error);

        if (error.code === "auth/user-not-found") {
          throw new HttpsError("not-found", "User not found");
        }

        // Re-throw HttpsError instances
        if (error instanceof HttpsError) {
          throw error;
        }

        // Generic error
        throw new HttpsError(
            "internal",
            "An error occurred while deleting the user",
        );
      }
    },
);

exports.seedDestinationCountries = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const user = await getUserProfile(callerUid);
      if (
        user.role !== "admin" &&
        user.role !== "businessOwner" &&
        user.role !== "staff"
      ) {
        throw new HttpsError("permission-denied", "Staff access required");
      }

      const db = admin.firestore();
      const businessId = user.role === "admin" ?
        (request.data?.businessId || DEFAULT_BUSINESS_ID) :
        user.businessId;
      if (!businessId) {
        throw new HttpsError("failed-precondition", "Business is required");
      }
      await requireBusinessManager(callerUid, businessId);
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }
      const business = businessDoc.data();
      const refs = ALL_COUNTRIES.map((country) =>
        businessRef.collection("destinationCountries").doc(country.id),
      );
      const existingDocs = await db.getAll(...refs);
      const batch = db.batch();
      const now = admin.firestore.FieldValue.serverTimestamp();
      ALL_COUNTRIES.forEach((country, index) => {
        const existingData = existingDocs[index].data() || {};
        batch.set(
            refs[index],
            {
              name: country.name,
              code: country.code,
              businessId,
              businessName: business.name || DEFAULT_BUSINESS_NAME,
              businessPhone: business.phone || "",
              businessEmail: business.email || "",
              businessWebsite: business.website || "",
              businessProfileImageUrl: business.profileImageUrl || "",
              businessProfileImagePath: business.profileImagePath || "",
              enabledServices: normalizeBusinessServices(
                  business.enabledServices,
              ),
              serviceNote: business.serviceNote || "",
              businessStatus: business.status || "pending",
              sortOrder: country.sortOrder,
              isActive: existingData.isActive === true,
              barrelShippingPrice:
                typeof existingData.barrelShippingPrice === "number" ?
                  existingData.barrelShippingPrice :
                  0,
              updatedAt: now,
            },
            {merge: true},
        );
      });
      await batch.commit();

      return {
        success: true,
        count: ALL_COUNTRIES.length,
      };
    },
);

exports.migrateDefaultBusiness = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const user = await getUserProfile(callerUid);
      if (user.role !== "admin") {
        throw new HttpsError(
            "permission-denied",
            "Only platform admins can run this migration",
        );
      }

      const db = admin.firestore();
      const now = admin.firestore.FieldValue.serverTimestamp();
      const businessRef = db.collection("businesses").doc(DEFAULT_BUSINESS_ID);
      const businessDoc = await businessRef.get();
      const businessData = {
        name: DEFAULT_BUSINESS_NAME,
        status: "approved",
        ownerUid: businessDoc.data()?.ownerUid || callerUid,
        phone: businessDoc.data()?.phone || "",
        email: businessDoc.data()?.email || "",
        website: businessDoc.data()?.website || "",
        profileImageUrl: businessDoc.data()?.profileImageUrl || "",
        profileImagePath: businessDoc.data()?.profileImagePath || "",
        enabledServices: normalizeBusinessServices(
            businessDoc.data()?.enabledServices,
        ),
        serviceNote:
          businessDoc.data()?.serviceNote ||
          "Barrel shipping, vehicle sales, and customer support.",
        createdAt: businessDoc.exists ?
          businessDoc.data().createdAt || now :
          now,
        updatedAt: now,
      };

      const writes = [];
      writes.push({
        ref: businessRef,
        data: businessData,
        options: {merge: true},
      });

      const legacyCountries = await db.collection("destinationCountries").get();
      legacyCountries.docs.forEach((doc) => {
        const data = doc.data();
        writes.push({
          ref: businessRef.collection("destinationCountries").doc(doc.id),
          data: {
            ...data,
            businessId: DEFAULT_BUSINESS_ID,
            businessName: DEFAULT_BUSINESS_NAME,
            businessPhone: businessData.phone,
            businessEmail: businessData.email,
            businessWebsite: businessData.website,
            businessProfileImageUrl: businessData.profileImageUrl,
            businessProfileImagePath: businessData.profileImagePath,
            enabledServices: businessData.enabledServices,
            serviceNote: businessData.serviceNote,
            businessStatus: "approved",
            updatedAt: now,
          },
          options: {merge: true},
        });
      });

      const collections = [
        "barrelShipments",
        "cars",
        "carPurchases",
        "parkedCars",
        "transportRequests",
      ];
      for (const collection of collections) {
        const snapshot = await db.collection(collection).get();
        snapshot.docs.forEach((doc) => {
          writes.push({
            ref: doc.ref,
            data: {
              businessId: DEFAULT_BUSINESS_ID,
              businessName: DEFAULT_BUSINESS_NAME,
              businessStatus: "approved",
              enabledServices: businessData.enabledServices,
              businessProfileImageUrl: businessData.profileImageUrl,
              updatedAt: now,
            },
            options: {merge: true},
          });
        });
      }

      const users = await db.collection("users")
          .where("role", "in", ["staff", "businessOwner"])
          .get();
      users.docs.forEach((doc) => {
        writes.push({
          ref: doc.ref,
          data: {
            businessId: DEFAULT_BUSINESS_ID,
            businessName: DEFAULT_BUSINESS_NAME,
            businessServices: businessData.enabledServices,
            updatedAt: now,
          },
          options: {merge: true},
        });
      });

      for (let index = 0; index < writes.length; index += 450) {
        const batch = db.batch();
        writes.slice(index, index + 450).forEach((write) => {
          batch.set(write.ref, write.data, write.options);
        });
        await batch.commit();
      }

      return {
        success: true,
        businessId: DEFAULT_BUSINESS_ID,
        writes: writes.length,
      };
    },
);

exports.suggestPickupAddresses = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [googleMapsApiKey],
    },
    async (request) => {
      requireAuth(request);
      const input = String(request.data?.input || "").trim();
      if (!input) {
        return [];
      }

      const key = googleMapsApiKey.value();
      const params = new URLSearchParams({
        input,
        key,
        components: "country:us",
        types: "address",
        location: "40.8448,-73.8648",
        radius: "26000",
        strictbounds: "true",
      });
      const data = await googlePlacesJson("autocomplete", params);
      const predictions = (data.predictions || []).slice(0, 8);
      if (!predictions.length) return [];

      const details = await Promise.all(predictions.map(async (prediction) => {
        if (!prediction.place_id) return null;
        const detailParams = new URLSearchParams({
          place_id: prediction.place_id,
          key,
          fields: "place_id,formatted_address,address_component,geometry",
        });
        const detail = await googlePlacesJson("details", detailParams);
        return pickupSuggestionFromPlace(detail.result || {});
      }));

      const seen = new Set();
      return details
          .filter(Boolean)
          .filter((suggestion) => {
            const key = suggestion.description.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 6);
    },
);

exports.createBarrelShipmentPaymentIntent = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const {
        senderName,
        receiverName,
        receiverPhone,
        destinationCountryId,
        businessId,
        pickupRequested,
        pickupAddress,
        pickupBorough,
        pickupDateTime,
        useWalletBalance,
      } = request.data || {};

      if (
        !senderName ||
        !receiverName ||
        !receiverPhone ||
        !destinationCountryId
      ) {
        throw new HttpsError(
            "invalid-argument",
            "Sender, receiver, phone, and destination are required",
        );
      }
      requireValidPhoneNumber(receiverPhone, "Receiver phone");

      const wantsPickup = pickupRequested === true;
      if (
        wantsPickup &&
        (!pickupAddress || !pickupBorough || !pickupDateTime)
      ) {
        throw new HttpsError(
            "invalid-argument",
            "Pickup address, borough, date, and time are required",
        );
      }

      const pickupAppointment = wantsPickup ?
        parseFuturePickup(pickupDateTime) :
        null;
      const db = admin.firestore();
      const pricingRef = db.collection("shipmentPricing").doc("barrelPickup");
      const [businessDestination, pricingDoc, userRecord] = await Promise.all([
        getApprovedBusinessDestination({
          businessId,
          countryId: destinationCountryId,
        }),
        pricingRef.get(),
        admin.auth().getUser(customerUid),
      ]);
      const {business, country, shippingFee, deliveryEstimate} =
        businessDestination;

      const pricing = barrelPickupPricingFromData(pricingDoc.data());
      const pickup = wantsPickup ?
        pickupFeeForBorough(pricing, String(pickupBorough)) :
        {miles: 0, fee: 0};
      const total = shippingFee + pickup.fee;
      if (!Number.isFinite(total) || total <= 0) {
        throw new HttpsError("failed-precondition", "Invalid shipment total");
      }
      const totalCents = Math.round(total * 100);

      const shipmentRef = db.collection("barrelShipments").doc();
      const trackingCode = await generateTrackingCode("BS", "barrelShipments");
      const now = admin.firestore.FieldValue.serverTimestamp();
      const cleanPickupAddress = wantsPickup ?
        String(pickupAddress).trim() :
        pricing.officeAddress;
      let walletAppliedCents = 0;
      await db.runTransaction(async (transaction) => {
        if (useWalletBalance === true) {
          walletAppliedCents = await debitWallet({
            transaction,
            customerUid,
            amountCents: totalCents,
            shipmentId: shipmentRef.id,
            trackingCode,
            reason: "barrel_shipment_payment",
            businessId: businessDestination.businessId,
            businessName: business.name || DEFAULT_BUSINESS_NAME,
          });
        }
        const chargeCents = totalCents - walletAppliedCents;
        transaction.set(shipmentRef, {
          trackingCode,
          senderName: String(senderName).trim(),
          senderAddress: cleanPickupAddress,
          receiverName: String(receiverName).trim(),
          receiverPhone: String(receiverPhone).trim(),
          destinationCountryId,
          destinationCountryName: country.name || "Guinea",
          businessId: businessDestination.businessId,
          businessName: business.name || DEFAULT_BUSINESS_NAME,
          ...deliveryEstimate,
          customerUid,
          customerEmail: userRecord.email || "",
          pickupRequested: wantsPickup,
          pickupAddress: cleanPickupAddress,
          pickupBorough: wantsPickup ?
            String(pickupBorough) :
            "Office drop-off",
          pickupMiles: pickup.miles,
          pickupFee: pickup.fee,
          shippingFee,
          pricingPendingReview: false,
          ...(pickupAppointment && {
            pickupDateTime:
              admin.firestore.Timestamp.fromDate(pickupAppointment),
          }),
          price: total,
          walletAppliedAmount: dollarsFromCents(walletAppliedCents),
          walletAppliedCents,
          cardChargeAmount: dollarsFromCents(chargeCents),
          cardChargeAmountCents: chargeCents,
          paymentStatus: chargeCents === 0 ? "succeeded" : "pending",
          status: chargeCents === 0 ? "pending" : "pending_payment",
          ...(chargeCents === 0 && {paidAt: now}),
          createdAt: now,
          updatedAt: now,
        });
      });

      const chargeCents = totalCents - walletAppliedCents;
      if (chargeCents === 0) {
        return {
          shipmentId: shipmentRef.id,
          trackingCode,
          simulatedPayment: true,
          walletAppliedAmount: dollarsFromCents(walletAppliedCents),
          cardChargeAmount: 0,
        };
      }

      if (SIMULATE_PAYMENTS) {
        await shipmentRef.update({
          paymentStatus: "succeeded",
          status: "pending",
          stripePaymentIntentId: `simulated_barrel_${shipmentRef.id}`,
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return {
          shipmentId: shipmentRef.id,
          trackingCode,
          simulatedPayment: true,
          walletAppliedAmount: dollarsFromCents(walletAppliedCents),
          cardChargeAmount: dollarsFromCents(chargeCents),
        };
      }

      let paymentIntent;
      try {
        paymentIntent = await createStripePaymentIntent({
          amount: chargeCents,
          currency: SHIPMENT_CURRENCY,
          metadata: {
            shipmentId: shipmentRef.id,
            trackingCode,
            customerUid,
            destinationCountryId,
            businessId: businessDestination.businessId,
            paymentType: "barrel_shipment",
          },
        });
        await shipmentRef.update({
          stripePaymentIntentId: paymentIntent.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (error) {
        await shipmentRef.update({
          paymentStatus: "failed",
          status: "cancelled",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if (walletAppliedCents > 0) {
          await db.runTransaction(async (transaction) => {
            await creditWallet({
              transaction,
              customerUid,
              amountCents: walletAppliedCents,
              shipmentId: shipmentRef.id,
              trackingCode,
              reason: "barrel_shipment_payment_reversal",
              businessId: businessDestination.businessId,
              businessName: business.name || DEFAULT_BUSINESS_NAME,
            });
          });
        }
        throw error;
      }

      return {
        shipmentId: shipmentRef.id,
        trackingCode,
        clientSecret: paymentIntent.client_secret,
        walletAppliedAmount: dollarsFromCents(walletAppliedCents),
        cardChargeAmount: dollarsFromCents(chargeCents),
      };
    },
);

exports.completeBarrelShipmentPayment = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const {shipmentId} = request.data || {};
      if (!shipmentId) {
        throw new HttpsError("invalid-argument", "Shipment ID is required");
      }

      const db = admin.firestore();
      const shipmentRef = db.collection("barrelShipments").doc(shipmentId);
      const shipmentDoc = await shipmentRef.get();
      if (!shipmentDoc.exists) {
        throw new HttpsError("not-found", "Shipment not found");
      }
      const shipment = shipmentDoc.data();
      if (shipment.customerUid !== customerUid) {
        throw new HttpsError("permission-denied", "Shipment access denied");
      }

      if (
        SIMULATE_PAYMENTS ||
        String(shipment.stripePaymentIntentId || "").startsWith("simulated_")
      ) {
        await shipmentRef.update({
          paymentStatus: "succeeded",
          status: "pending",
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return {
          success: true,
          shipmentId,
          trackingCode: shipment.trackingCode,
          simulatedPayment: true,
        };
      }

      const intent = await retrieveStripePaymentIntent(
          shipment.stripePaymentIntentId,
      );
      if (intent.status !== "succeeded") {
        await shipmentRef.update({
          paymentStatus: intent.status,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        throw new HttpsError(
            "failed-precondition",
            `Payment is ${intent.status}`,
        );
      }

      await shipmentRef.update({
        paymentStatus: "succeeded",
        status: "pending",
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        shipmentId,
        trackingCode: shipment.trackingCode,
      };
    },
);

exports.cancelPendingBarrelShipment = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const {shipmentId} = request.data || {};
      if (!shipmentId) {
        throw new HttpsError("invalid-argument", "Shipment ID is required");
      }

      const db = admin.firestore();
      const shipmentRef = db.collection("barrelShipments").doc(shipmentId);
      const shipmentDoc = await shipmentRef.get();
      if (!shipmentDoc.exists) return {success: true, shipmentId};
      const shipment = shipmentDoc.data();
      if (shipment.customerUid !== customerUid) {
        throw new HttpsError("permission-denied", "Shipment access denied");
      }
      if (shipment.paymentStatus !== "pending") {
        return {success: true, shipmentId};
      }

      if (!SIMULATE_PAYMENTS && shipment.stripePaymentIntentId) {
        const intent = await retrieveStripePaymentIntent(
            shipment.stripePaymentIntentId,
        );
        if (intent.status === "succeeded" || intent.status === "processing") {
          await shipmentRef.update({
            paymentStatus: intent.status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return {success: true, shipmentId};
        }
      }

      const walletAppliedCents = Number(shipment.walletAppliedCents || 0);
      if (Number.isFinite(walletAppliedCents) && walletAppliedCents > 0) {
        await db.runTransaction(async (transaction) => {
          transaction.update(shipmentRef, {
            paymentStatus: "cancelled",
            status: "cancelled",
            walletAppliedReversed: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          await creditWallet({
            transaction,
            customerUid,
            amountCents: walletAppliedCents,
            shipmentId,
            trackingCode: shipment.trackingCode,
            reason: "barrel_shipment_payment_reversal",
            businessId: shipment.businessId,
            businessName: shipment.businessName,
          });
        });
      } else {
        await shipmentRef.update({
          paymentStatus: "cancelled",
          status: "cancelled",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      return {success: true, shipmentId};
    },
);

exports.changeBarrelShipmentDestination = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const {shipmentId, destinationCountryId, businessId} = request.data || {};
      if (!shipmentId || !destinationCountryId || !businessId) {
        throw new HttpsError(
            "invalid-argument",
            "Shipment, destination, and business are required",
        );
      }

      const db = admin.firestore();
      const shipmentRef = db.collection("barrelShipments").doc(shipmentId);
      const [shipmentDoc, businessDestination] = await Promise.all([
        shipmentRef.get(),
        getApprovedBusinessDestination({
          businessId,
          countryId: destinationCountryId,
        }),
      ]);

      if (!shipmentDoc.exists) {
        throw new HttpsError("not-found", "Shipment not found");
      }

      const shipment = shipmentDoc.data();
      requireCustomerShipmentEditable(shipment, customerUid);

      const {business, country, shippingFee, deliveryEstimate} =
        businessDestination;

      if (
        shipment.destinationCountryId === destinationCountryId &&
        shipment.businessId === businessDestination.businessId
      ) {
        return {
          success: true,
          shipmentId,
          trackingCode: shipment.trackingCode,
          difference: 0,
          walletCredit: 0,
          amountDue: 0,
        };
      }

      const previousTotalCents = centsFromDollars(shipment.price);
      const newTotalCents = centsFromDollars(
          shippingFee + Number(shipment.pickupFee || 0),
      );
      if (newTotalCents <= 0) {
        throw new HttpsError("failed-precondition", "Invalid shipment total");
      }

      const differenceCents = newTotalCents - previousTotalCents;
      const update = {
        destinationCountryId,
        destinationCountryName: country.name || destinationCountryId,
        businessId: businessDestination.businessId,
        businessName: business.name || DEFAULT_BUSINESS_NAME,
        deliveryEstimateMinDays:
          deliveryEstimate.deliveryEstimateMinDays ??
          admin.firestore.FieldValue.delete(),
        deliveryEstimateMaxDays:
          deliveryEstimate.deliveryEstimateMaxDays ??
          admin.firestore.FieldValue.delete(),
        deliveryEstimateLabel:
          deliveryEstimate.deliveryEstimateLabel ??
          admin.firestore.FieldValue.delete(),
        shippingFee,
        price: dollarsFromCents(newTotalCents),
        destinationChangedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (differenceCents > 0) {
        update.paymentStatus = "succeeded";
        update.destinationAdjustmentPaymentStatus = "succeeded";
        update.destinationAdjustmentAmount = dollarsFromCents(differenceCents);
        update.destinationAdjustmentAmountCents = differenceCents;
        update.destinationAdjustmentPaymentIntentId =
          `simulated_destination_change_${shipmentId}_${Date.now()}`;
        await shipmentRef.update(update);
        return {
          success: true,
          shipmentId,
          trackingCode: shipment.trackingCode,
          difference: dollarsFromCents(differenceCents),
          amountDue: dollarsFromCents(differenceCents),
          walletCredit: 0,
          simulatedPayment: true,
        };
      }

      if (differenceCents < 0) {
        const creditCents = Math.abs(differenceCents);
        await db.runTransaction(async (transaction) => {
          const latestShipmentDoc = await transaction.get(shipmentRef);
          if (!latestShipmentDoc.exists) {
            throw new HttpsError("not-found", "Shipment not found");
          }
          const latestShipment = latestShipmentDoc.data();
          requireCustomerShipmentEditable(latestShipment, customerUid);
          transaction.update(shipmentRef, {
            ...update,
            destinationAdjustmentPaymentStatus: "credited_to_wallet",
            destinationAdjustmentAmount: -dollarsFromCents(creditCents),
            destinationAdjustmentAmountCents: -creditCents,
          });
          await creditWallet({
            transaction,
            customerUid,
            amountCents: creditCents,
            shipmentId,
            trackingCode: latestShipment.trackingCode,
            reason: "barrel_destination_refund",
            businessId: businessDestination.businessId,
            businessName: business.name || DEFAULT_BUSINESS_NAME,
          });
        });
        return {
          success: true,
          shipmentId,
          trackingCode: shipment.trackingCode,
          difference: -dollarsFromCents(creditCents),
          amountDue: 0,
          walletCredit: dollarsFromCents(creditCents),
        };
      }

      await shipmentRef.update(update);
      return {
        success: true,
        shipmentId,
        trackingCode: shipment.trackingCode,
        difference: 0,
        amountDue: 0,
        walletCredit: 0,
      };
    },
);

exports.createCarDepositPaymentIntent = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const buyerUid = requireAuth(request);
      const {
        carId,
        buyerName,
        buyerPhone,
        holdUntilDate,
      } = request.data || {};

      if (!carId || !buyerName || !buyerPhone || !holdUntilDate) {
        throw new HttpsError(
            "invalid-argument",
            "Car, name, phone, and hold date are required",
        );
      }
      requireValidPhoneNumber(buyerPhone, "Buyer phone");

      const db = admin.firestore();
      const carRef = db.collection("cars").doc(carId);
      const [carDoc, userRecord, userDoc] = await Promise.all([
        carRef.get(),
        admin.auth().getUser(buyerUid),
        db.collection("users").doc(buyerUid).get(),
      ]);

      if (!carDoc.exists) {
        throw new HttpsError("not-found", "Car not found");
      }
      const car = carDoc.data();
      if (car.status !== "active") {
        throw new HttpsError(
            "failed-precondition",
            "This car is not available for reservation",
        );
      }
      const carBusiness = await requireActiveBusinessForCar(car);
      const holdQuote = calculateHoldQuote({
        car,
        business: carBusiness.business,
        holdUntilDate,
      });

      const existing = await db
          .collection("carPurchases")
          .where("carId", "==", carId)
          .where("purchaseStatus", "in", ["pending", "reserved"])
          .limit(1)
          .get();
      if (!existing.empty) {
        throw new HttpsError(
            "already-exists",
            "This car already has an active reservation",
        );
      }

      const purchaseRef = db.collection("carPurchases").doc();
      const now = admin.firestore.FieldValue.serverTimestamp();
      await purchaseRef.set({
        carId,
        carTitle: car.title || `${car.make || ""} ${car.model || ""}`.trim(),
        businessId: carBusiness.businessId,
        businessName: carBusiness.business.name || DEFAULT_BUSINESS_NAME,
        buyerUid,
        buyerEmail: userRecord.email || "",
        buyerName: String(buyerName).trim(),
        buyerPhone: String(buyerPhone).trim(),
        destinationCountryId: "",
        destinationCountryName: "",
        vehicleLocation: [car.locationCity, car.locationState]
            .filter(Boolean)
            .join(", "),
        depositAmount: holdQuote.amount,
        depositCurrency: DEPOSIT_CURRENCY.toUpperCase(),
        holdUntilDate: admin.firestore.Timestamp.fromDate(holdQuote.holdDate),
        holdExpiresAt: admin.firestore.Timestamp.fromDate(
            holdQuote.holdExpiresAt,
        ),
        holdPricingMode: holdQuote.holdPricingMode,
        holdDays: holdQuote.holdDays,
        holdRateAmount: holdQuote.holdRateAmount,
        depositForfeitureStatus: "active",
        buyerReliabilitySnapshot: reliabilitySummaryFromUser(userDoc.data()),
        paymentType: "reservation_deposit",
        paymentStatus: "pending",
        purchaseStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });

      if (SIMULATE_PAYMENTS) {
        try {
          await db.runTransaction(async (transaction) => {
            const lockedCarDoc = await transaction.get(carRef);
            if (!lockedCarDoc.exists) {
              throw new HttpsError("not-found", "Car not found");
            }
            const lockedCar = lockedCarDoc.data();
            if (lockedCar.status !== "active") {
              throw new HttpsError(
                  "failed-precondition",
                  "This car is no longer available",
              );
            }
            const paidAt = admin.firestore.FieldValue.serverTimestamp();
            transaction.update(purchaseRef, {
              paymentStatus: "succeeded",
              purchaseStatus: "reserved",
              stripePaymentIntentId: `simulated_deposit_${purchaseRef.id}`,
              paidAt,
              updatedAt: paidAt,
            });
            transaction.update(carRef, {
              status: "reserved",
              reservedPurchaseId: purchaseRef.id,
              reservationType: "paid_hold",
              updatedAt: paidAt,
            });
            transaction.set(db.collection("users").doc(buyerUid), {
              "carBuyerReliability.paidHolds":
                admin.firestore.FieldValue.increment(1),
              "carBuyerReliability.updatedAt": paidAt,
            }, {merge: true});
          });
        } catch (error) {
          await purchaseRef.update({
            paymentStatus: "failed",
            purchaseStatus: "cancelled",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          throw error;
        }
        return {
          purchaseId: purchaseRef.id,
          simulatedPayment: true,
        };
      }

      const paymentIntent = await createStripePaymentIntent({
        amount: holdQuote.amountCents,
        currency: DEPOSIT_CURRENCY,
        metadata: {
          carId,
          buyerUid,
          businessId: carBusiness.businessId,
          purchaseId: purchaseRef.id,
          holdUntilDate: holdQuote.holdDate.toISOString(),
        },
      });

      await purchaseRef.update({
        stripePaymentIntentId: paymentIntent.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        purchaseId: purchaseRef.id,
        clientSecret: paymentIntent.client_secret,
      };
    },
);

exports.createCarViewingReservation = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const buyerUid = requireAuth(request);
      const {
        carId,
        buyerName,
        buyerPhone,
        appointmentStart,
        appointmentLabel,
      } = request.data || {};

      if (
        !carId ||
        !buyerName ||
        !buyerPhone ||
        !appointmentStart ||
        !appointmentLabel
      ) {
        throw new HttpsError(
            "invalid-argument",
            "Car, name, phone, and viewing time are required",
        );
      }
      requireValidPhoneNumber(buyerPhone, "Buyer phone");

      const appointment = parseFutureAppointment(appointmentStart);
      assertViewingEditable(appointment);
      const db = admin.firestore();
      const carRef = db.collection("cars").doc(carId);
      const [carDoc, userRecord] = await Promise.all([
        carRef.get(),
        admin.auth().getUser(buyerUid),
      ]);

      if (!carDoc.exists) {
        throw new HttpsError("not-found", "Car not found");
      }
      const listedCar = carDoc.data();
      const carBusiness = await requireActiveBusinessForCar(listedCar);

      const purchaseRef = db.collection("carPurchases").doc();
      const now = admin.firestore.FieldValue.serverTimestamp();

      await db.runTransaction(async (transaction) => {
        const lockedCarDoc = await transaction.get(carRef);
        if (!lockedCarDoc.exists) {
          throw new HttpsError("not-found", "Car not found");
        }
        const existingViewingQuery = db.collection("carPurchases")
            .where("buyerUid", "==", buyerUid)
            .where("carId", "==", carId);
        const existingViewingSnapshot = await transaction.get(
            existingViewingQuery,
        );
        const hasActiveViewing = existingViewingSnapshot.docs.some((doc) => {
          const purchase = doc.data();
          const isViewingReservation =
            purchase.paymentType === "viewing_reservation" ||
            (
              purchase.appointmentStart &&
              Number(purchase.depositAmount || 0) === 0
            );
          return isViewingReservation &&
            purchase.purchaseStatus !== "cancelled" &&
            purchase.purchaseStatus !== "completed";
        });
        if (hasActiveViewing) {
          throw new HttpsError(
              "already-exists",
              "You already have an active viewing for this listing",
          );
        }
        const car = lockedCarDoc.data();
        if (car.status !== "active") {
          throw new HttpsError(
              "failed-precondition",
              "This car is not available for reservation",
          );
        }
        transaction.set(purchaseRef, {
          carId,
          carTitle: carTitle(car),
          businessId: carBusiness.businessId,
          businessName: carBusiness.business.name || DEFAULT_BUSINESS_NAME,
          buyerUid,
          buyerEmail: userRecord.email || "",
          buyerName: String(buyerName).trim(),
          buyerPhone: String(buyerPhone).trim(),
          destinationCountryId: "",
          destinationCountryName: "",
          vehicleLocation: [car.locationCity, car.locationState]
              .filter(Boolean)
              .join(", "),
          depositAmount: 0,
          depositCurrency: PURCHASE_CURRENCY.toUpperCase(),
          paymentType: "viewing_reservation",
          paymentStatus: "not_required",
          purchaseStatus: "viewing_scheduled",
          appointmentStart: admin.firestore.Timestamp.fromDate(appointment),
          appointmentLabel: String(appointmentLabel).trim(),
          createdAt: now,
          updatedAt: now,
        });
      });

      return {
        success: true,
        purchaseId: purchaseRef.id,
      };
    },
);

exports.updateCarViewingReservation = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const buyerUid = requireAuth(request);
      const {purchaseId, appointmentStart, appointmentLabel} =
        request.data || {};

      if (!purchaseId || !appointmentStart || !appointmentLabel) {
        throw new HttpsError(
            "invalid-argument",
            "Reservation and viewing time are required",
        );
      }

      const appointment = parseFutureAppointment(appointmentStart);
      assertViewingEditable(appointment);
      const db = admin.firestore();
      const purchaseRef = db.collection("carPurchases").doc(purchaseId);

      await db.runTransaction(async (transaction) => {
        const purchaseDoc = await transaction.get(purchaseRef);
        if (!purchaseDoc.exists) {
          throw new HttpsError("not-found", "Reservation not found");
        }
        const purchase = purchaseDoc.data();
        if (purchase.buyerUid !== buyerUid) {
          throw new HttpsError(
              "permission-denied",
              "Reservation access denied",
          );
        }
        const isViewingReservation =
          purchase.paymentType === "viewing_reservation" ||
          (
            purchase.appointmentStart &&
            Number(purchase.depositAmount || 0) === 0
          );
        if (!isViewingReservation) {
          throw new HttpsError(
              "failed-precondition",
              "Only viewing reservations can be edited here",
          );
        }
        if (
          purchase.purchaseStatus !== "viewing_scheduled" &&
          purchase.purchaseStatus !== "reserved"
        ) {
          throw new HttpsError(
              "failed-precondition",
              "This viewing reservation can no longer be edited",
          );
        }
        const currentAppointment = purchase.appointmentStart?.toDate?.();
        if (currentAppointment) {
          assertViewingEditable(currentAppointment);
        }

        const carRef = db.collection("cars").doc(purchase.carId);
        const carDoc = await transaction.get(carRef);
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(purchaseRef, {
          appointmentStart: admin.firestore.Timestamp.fromDate(appointment),
          appointmentLabel: String(appointmentLabel).trim(),
          purchaseStatus: "viewing_scheduled",
          paymentStatus: "not_required",
          updatedAt: now,
        });
        if (
          carDoc.exists &&
          carDoc.data().status === "reserved" &&
          carDoc.data().reservedPurchaseId === purchaseId
        ) {
          transaction.update(carRef, {
            status: "active",
            reservedPurchaseId: admin.firestore.FieldValue.delete(),
            reservationType: admin.firestore.FieldValue.delete(),
            updatedAt: now,
          });
        }
      });

      return {success: true, purchaseId};
    },
);

exports.cancelCarViewingReservation = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const buyerUid = requireAuth(request);
      const {purchaseId} = request.data || {};

      if (!purchaseId) {
        throw new HttpsError("invalid-argument", "Reservation is required");
      }

      const db = admin.firestore();
      const purchaseRef = db.collection("carPurchases").doc(purchaseId);
      await db.runTransaction(async (transaction) => {
        const purchaseDoc = await transaction.get(purchaseRef);
        if (!purchaseDoc.exists) {
          throw new HttpsError("not-found", "Reservation not found");
        }
        const purchase = purchaseDoc.data();
        if (purchase.buyerUid !== buyerUid) {
          throw new HttpsError(
              "permission-denied",
              "Reservation access denied",
          );
        }
        const isViewingReservation =
          purchase.paymentType === "viewing_reservation" ||
          (
            purchase.appointmentStart &&
            Number(purchase.depositAmount || 0) === 0
          );
        if (!isViewingReservation) {
          throw new HttpsError(
              "failed-precondition",
              "Only viewing reservations can be cancelled here",
          );
        }
        if (
          purchase.purchaseStatus === "completed" ||
          purchase.purchaseStatus === "cancelled"
        ) {
          return;
        }

        const carRef = db.collection("cars").doc(purchase.carId);
        const carDoc = await transaction.get(carRef);
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(purchaseRef, {
          purchaseStatus: "cancelled",
          paymentStatus: "cancelled",
          updatedAt: now,
        });
        if (
          carDoc.exists &&
          carDoc.data().status === "reserved" &&
          carDoc.data().reservedPurchaseId === purchaseId
        ) {
          transaction.update(carRef, {
            status: "active",
            reservedPurchaseId: admin.firestore.FieldValue.delete(),
            reservationType: admin.firestore.FieldValue.delete(),
            updatedAt: now,
          });
        }
      });

      return {success: true, purchaseId};
    },
);

exports.createCarPurchasePaymentIntent = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const buyerUid = requireAuth(request);
      const {
        carId,
        buyerName,
        buyerPhone,
      } = request.data || {};

      if (!carId || !buyerName || !buyerPhone) {
        throw new HttpsError(
            "invalid-argument",
            "Car, name, and phone are required",
        );
      }
      requireValidPhoneNumber(buyerPhone, "Buyer phone");

      const db = admin.firestore();
      const carRef = db.collection("cars").doc(carId);
      const [carDoc, userRecord] = await Promise.all([
        carRef.get(),
        admin.auth().getUser(buyerUid),
      ]);

      if (!carDoc.exists) {
        throw new HttpsError("not-found", "Car not found");
      }
      const car = carDoc.data();
      if (car.status !== "active") {
        throw new HttpsError(
            "failed-precondition",
            "This car is not available for purchase",
        );
      }
      const carBusiness = await requireActiveBusinessForCar(car);

      const existing = await db
          .collection("carPurchases")
          .where("carId", "==", carId)
          .where("purchaseStatus", "in", ["pending", "reserved"])
          .limit(1)
          .get();
      if (!existing.empty) {
        throw new HttpsError(
            "already-exists",
            "This car already has an active purchase",
        );
      }

      const purchaseRef = db.collection("carPurchases").doc();
      const purchaseAmountCents = carPriceCents(car);
      const now = admin.firestore.FieldValue.serverTimestamp();

      await db.runTransaction(async (transaction) => {
        const lockedCarDoc = await transaction.get(carRef);
        if (!lockedCarDoc.exists) {
          throw new HttpsError("not-found", "Car not found");
        }
        const lockedCar = lockedCarDoc.data();
        if (lockedCar.status !== "active") {
          throw new HttpsError(
              "failed-precondition",
              "This car is not available for purchase",
          );
        }
        transaction.set(purchaseRef, {
          carId,
          carTitle: carTitle(lockedCar),
          businessId: carBusiness.businessId,
          businessName: carBusiness.business.name || DEFAULT_BUSINESS_NAME,
          buyerUid,
          buyerEmail: userRecord.email || "",
          buyerName: String(buyerName).trim(),
          buyerPhone: String(buyerPhone).trim(),
          destinationCountryId: "",
          destinationCountryName: "",
          vehicleLocation: [lockedCar.locationCity, lockedCar.locationState]
              .filter(Boolean)
              .join(", "),
          depositAmount: purchaseAmountCents / 100,
          depositCurrency: PURCHASE_CURRENCY.toUpperCase(),
          paymentType: "full_purchase",
          paymentStatus: "pending",
          purchaseStatus: "pending",
          createdAt: now,
          updatedAt: now,
        });
        transaction.update(carRef, {
          status: "reserved",
          reservedPurchaseId: purchaseRef.id,
          reservationType: "purchase_pending",
          updatedAt: now,
        });
      });

      if (SIMULATE_PAYMENTS) {
        await db.runTransaction(async (transaction) => {
          const lockedCarDoc = await transaction.get(carRef);
          if (!lockedCarDoc.exists) {
            throw new HttpsError("not-found", "Car not found");
          }
          const lockedCar = lockedCarDoc.data();
          const isLockedForPurchase =
              lockedCar.status === "reserved" &&
              lockedCar.reservedPurchaseId === purchaseRef.id;
          if (!isLockedForPurchase) {
            throw new HttpsError(
                "failed-precondition",
                "This car is no longer available",
            );
          }
          const paidAt = admin.firestore.FieldValue.serverTimestamp();
          transaction.update(purchaseRef, {
            paymentStatus: "succeeded",
            purchaseStatus: "completed",
            stripePaymentIntentId: `simulated_purchase_${purchaseRef.id}`,
            paidAt,
            updatedAt: paidAt,
          });
          transaction.update(carRef, {
            status: "sold",
            reservedPurchaseId: admin.firestore.FieldValue.delete(),
            reservationType: admin.firestore.FieldValue.delete(),
            soldPurchaseId: purchaseRef.id,
            soldInfo: {
              customerName: String(buyerName).trim(),
              customerPhone: String(buyerPhone).trim(),
              customerEmail: userRecord.email || "",
              amount: purchaseAmountCents / 100,
              soldDate: paidAt,
              notes: "Simulated purchase through app",
            },
            updatedAt: paidAt,
          });
        });
        return {
          purchaseId: purchaseRef.id,
          simulatedPayment: true,
        };
      }

      let paymentIntent;
      try {
        paymentIntent = await createStripePaymentIntent({
          amount: purchaseAmountCents,
          currency: PURCHASE_CURRENCY,
          metadata: {
            carId,
            buyerUid,
            purchaseId: purchaseRef.id,
            paymentType: "full_purchase",
          },
        });

        await purchaseRef.update({
          stripePaymentIntentId: paymentIntent.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (error) {
        await Promise.all([
          purchaseRef.update({
            paymentStatus: "failed",
            purchaseStatus: "cancelled",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }),
          carRef.update({
            status: "active",
            reservedPurchaseId: admin.firestore.FieldValue.delete(),
            reservationType: admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }),
        ]);
        throw error;
      }

      return {
        purchaseId: purchaseRef.id,
        clientSecret: paymentIntent.client_secret,
      };
    },
);

exports.completeCarPurchase = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const buyerUid = requireAuth(request);
      const {purchaseId} = request.data || {};

      if (!purchaseId) {
        throw new HttpsError("invalid-argument", "Purchase ID is required");
      }

      const db = admin.firestore();
      const purchaseRef = db.collection("carPurchases").doc(purchaseId);
      const purchaseDoc = await purchaseRef.get();
      if (!purchaseDoc.exists) {
        throw new HttpsError("not-found", "Purchase not found");
      }
      const purchase = purchaseDoc.data();
      if (purchase.buyerUid !== buyerUid) {
        throw new HttpsError("permission-denied", "Purchase access denied");
      }
      if (
        purchase.holdExpiresAt &&
        purchase.holdExpiresAt.toMillis() <= Date.now()
      ) {
        throw new HttpsError(
            "failed-precondition",
            "This hold date has expired. Choose a new return date.",
        );
      }

      if (
        SIMULATE_PAYMENTS ||
        String(purchase.stripePaymentIntentId || "").startsWith("simulated_")
      ) {
        return {
          success: true,
          purchaseId,
          simulatedPayment: true,
        };
      }

      const intent = await retrieveStripePaymentIntent(
          purchase.stripePaymentIntentId);
      if (intent.status !== "succeeded") {
        await purchaseRef.update({
          paymentStatus: intent.status,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        throw new HttpsError(
            "failed-precondition",
            `Payment is ${intent.status}`,
        );
      }

      const carRef = db.collection("cars").doc(purchase.carId);
      await db.runTransaction(async (transaction) => {
        const carDoc = await transaction.get(carRef);
        if (!carDoc.exists) {
          throw new HttpsError("not-found", "Car not found");
        }
        const car = carDoc.data();
        const isLockedForPurchase =
            car.status === "reserved" &&
            car.reservedPurchaseId === purchaseId;
        if (car.status !== "active" && !isLockedForPurchase) {
          throw new HttpsError(
              "failed-precondition",
              "This car is no longer available",
          );
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(purchaseRef, {
          paymentStatus: "succeeded",
          purchaseStatus: "completed",
          updatedAt: now,
        });
        transaction.update(carRef, {
          status: "sold",
          reservedPurchaseId: admin.firestore.FieldValue.delete(),
          reservationType: admin.firestore.FieldValue.delete(),
          soldPurchaseId: purchaseId,
          soldInfo: {
            customerName: purchase.buyerName,
            customerPhone: purchase.buyerPhone,
            customerEmail: purchase.buyerEmail,
            amount: purchase.depositAmount,
            soldDate: now,
            notes: "Purchased directly through app",
          },
          updatedAt: now,
        });
      });

      return {
        success: true,
        purchaseId,
      };
    },
);

exports.cancelPendingCarPurchase = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const buyerUid = requireAuth(request);
      const {purchaseId} = request.data || {};

      if (!purchaseId) {
        throw new HttpsError("invalid-argument", "Purchase ID is required");
      }

      const db = admin.firestore();
      const purchaseRef = db.collection("carPurchases").doc(purchaseId);
      const purchaseDoc = await purchaseRef.get();
      if (!purchaseDoc.exists) {
        throw new HttpsError("not-found", "Purchase not found");
      }
      const purchase = purchaseDoc.data();
      if (purchase.buyerUid !== buyerUid) {
        throw new HttpsError("permission-denied", "Purchase access denied");
      }
      if (purchase.purchaseStatus !== "pending") {
        return {success: true, purchaseId};
      }

      if (!SIMULATE_PAYMENTS && purchase.stripePaymentIntentId) {
        const intent = await retrieveStripePaymentIntent(
            purchase.stripePaymentIntentId);
        if (intent.status === "succeeded" || intent.status === "processing") {
          await purchaseRef.update({
            paymentStatus: intent.status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return {success: true, purchaseId};
        }
      }

      const carRef = db.collection("cars").doc(purchase.carId);
      await db.runTransaction(async (transaction) => {
        const carDoc = await transaction.get(carRef);
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(purchaseRef, {
          paymentStatus: "cancelled",
          purchaseStatus: "cancelled",
          updatedAt: now,
        });
        if (
          carDoc.exists &&
          carDoc.data().status === "reserved" &&
          carDoc.data().reservedPurchaseId === purchaseId
        ) {
          transaction.update(carRef, {
            status: "active",
            reservedPurchaseId: admin.firestore.FieldValue.delete(),
            reservationType: admin.firestore.FieldValue.delete(),
            updatedAt: now,
          });
        }
      });

      return {
        success: true,
        purchaseId,
      };
    },
);

exports.completeCarDepositReservation = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const buyerUid = requireAuth(request);
      const {purchaseId} = request.data || {};

      if (!purchaseId) {
        throw new HttpsError("invalid-argument", "Purchase ID is required");
      }

      const db = admin.firestore();
      const purchaseRef = db.collection("carPurchases").doc(purchaseId);
      const purchaseDoc = await purchaseRef.get();
      if (!purchaseDoc.exists) {
        throw new HttpsError("not-found", "Purchase not found");
      }
      const purchase = purchaseDoc.data();
      if (purchase.buyerUid !== buyerUid) {
        throw new HttpsError("permission-denied", "Purchase access denied");
      }

      if (
        SIMULATE_PAYMENTS ||
        String(purchase.stripePaymentIntentId || "").startsWith("simulated_")
      ) {
        return {
          success: true,
          purchaseId,
          simulatedPayment: true,
        };
      }

      const intent = await retrieveStripePaymentIntent(
          purchase.stripePaymentIntentId);
      if (intent.status !== "succeeded") {
        await purchaseRef.update({
          paymentStatus: intent.status,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        throw new HttpsError(
            "failed-precondition",
            `Payment is ${intent.status}`,
        );
      }

      const carRef = db.collection("cars").doc(purchase.carId);
      await db.runTransaction(async (transaction) => {
        const carDoc = await transaction.get(carRef);
        if (!carDoc.exists) {
          throw new HttpsError("not-found", "Car not found");
        }
        const car = carDoc.data();
        if (car.status !== "active" && car.status !== "reserved") {
          throw new HttpsError(
              "failed-precondition",
              "This car is no longer available",
          );
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(purchaseRef, {
          paymentStatus: "succeeded",
          purchaseStatus: "reserved",
          updatedAt: now,
        });
        transaction.update(carRef, {
          status: "reserved",
          reservedPurchaseId: purchaseId,
          reservationType: "paid_hold",
          updatedAt: now,
        });
        transaction.set(db.collection("users").doc(buyerUid), {
          "carBuyerReliability.paidHolds":
            admin.firestore.FieldValue.increment(1),
          "carBuyerReliability.updatedAt": now,
        }, {merge: true});
      });

      return {
        success: true,
        purchaseId,
      };
    },
);

exports.markPaidHoldSold = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const {purchaseId} = request.data || {};
      if (!purchaseId) {
        throw new HttpsError("invalid-argument", "Purchase ID is required");
      }

      const db = admin.firestore();
      const purchaseRef = db.collection("carPurchases").doc(purchaseId);
      await db.runTransaction(async (transaction) => {
        const purchaseDoc = await transaction.get(purchaseRef);
        if (!purchaseDoc.exists) {
          throw new HttpsError("not-found", "Purchase not found");
        }
        const purchase = purchaseDoc.data();
        await requireBusinessManager(uid, purchase.businessId);
        assertPaidHoldActionable(purchase);
        const carRef = db.collection("cars").doc(purchase.carId);
        const carDoc = await transaction.get(carRef);
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(purchaseRef, {
          purchaseStatus: "completed",
          depositForfeitureStatus: "completed",
          holdFinalizedAt: now,
          holdFinalizedBy: uid,
          updatedAt: now,
        });
        if (carDoc.exists) {
          transaction.update(carRef, {
            status: "sold",
            reservedPurchaseId: admin.firestore.FieldValue.delete(),
            reservationType: admin.firestore.FieldValue.delete(),
            soldPurchaseId: purchaseId,
            soldInfo: {
              customerName: purchase.buyerName,
              customerPhone: purchase.buyerPhone,
              customerEmail: purchase.buyerEmail,
              amount: purchase.depositAmount,
              soldDate: now,
              notes: "Paid hold completed by business",
            },
            updatedAt: now,
          });
        }
        transaction.set(db.collection("users").doc(purchase.buyerUid), {
          "carBuyerReliability.completedHolds":
            admin.firestore.FieldValue.increment(1),
          "carBuyerReliability.lastCompletedHoldAt": now,
          "carBuyerReliability.updatedAt": now,
        }, {merge: true});
      });
      return {success: true, purchaseId};
    },
);

exports.markPaidHoldNoShow = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const {purchaseId, note} = request.data || {};
      if (!purchaseId) {
        throw new HttpsError("invalid-argument", "Purchase ID is required");
      }

      const db = admin.firestore();
      const purchaseRef = db.collection("carPurchases").doc(purchaseId);
      await db.runTransaction(async (transaction) => {
        const purchaseDoc = await transaction.get(purchaseRef);
        if (!purchaseDoc.exists) {
          throw new HttpsError("not-found", "Purchase not found");
        }
        const purchase = purchaseDoc.data();
        await requireBusinessManager(uid, purchase.businessId);
        assertPaidHoldActionable(purchase);
        const carRef = db.collection("cars").doc(purchase.carId);
        const carDoc = await transaction.get(carRef);
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(purchaseRef, {
          purchaseStatus: "no_show",
          depositForfeitureStatus: "forfeited",
          noShowAt: now,
          noShowMarkedBy: uid,
          noShowNote: String(note || "").trim(),
          updatedAt: now,
        });
        if (
          carDoc.exists &&
          carDoc.data().status === "reserved" &&
          carDoc.data().reservedPurchaseId === purchaseId
        ) {
          transaction.update(carRef, {
            status: "active",
            reservedPurchaseId: admin.firestore.FieldValue.delete(),
            reservationType: admin.firestore.FieldValue.delete(),
            updatedAt: now,
          });
        }
        transaction.set(db.collection("users").doc(purchase.buyerUid), {
          "carBuyerReliability.noShows":
            admin.firestore.FieldValue.increment(1),
          "carBuyerReliability.forfeitures":
            admin.firestore.FieldValue.increment(1),
          "carBuyerReliability.lastNoShowAt": now,
          "carBuyerReliability.updatedAt": now,
        }, {merge: true});
      });
      return {success: true, purchaseId};
    },
);

exports.requestPaidHoldExtension = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const buyerUid = requireAuth(request);
      const {purchaseId, requestedHoldUntilDate} = request.data || {};
      if (!purchaseId || !requestedHoldUntilDate) {
        throw new HttpsError(
            "invalid-argument",
            "Purchase and requested date are required",
        );
      }

      const db = admin.firestore();
      const purchaseRef = db.collection("carPurchases").doc(purchaseId);
      const purchaseDoc = await purchaseRef.get();
      if (!purchaseDoc.exists) {
        throw new HttpsError("not-found", "Purchase not found");
      }
      const purchase = purchaseDoc.data();
      if (purchase.buyerUid !== buyerUid) {
        throw new HttpsError("permission-denied", "Purchase access denied");
      }
      assertPaidHoldActionable(purchase);
      if (
        ["pending", "approved"].includes(purchase.extensionRequestStatus)
      ) {
        throw new HttpsError(
            "already-exists",
            "An extension request is already open",
        );
      }

      const carDoc = await db.collection("cars").doc(purchase.carId).get();
      if (!carDoc.exists) {
        throw new HttpsError("not-found", "Car not found");
      }
      const car = carDoc.data();
      const carBusiness = await requireActiveBusinessForCar(car);
      const quote = calculateHoldExtensionQuote({
        purchase,
        car,
        business: carBusiness.business,
        holdUntilDate: requestedHoldUntilDate,
      });
      const now = admin.firestore.FieldValue.serverTimestamp();
      await purchaseRef.update({
        extensionRequestStatus: "pending",
        extensionRequestedHoldUntilDate:
          admin.firestore.Timestamp.fromDate(quote.holdDate),
        extensionRequestedHoldExpiresAt:
          admin.firestore.Timestamp.fromDate(quote.holdExpiresAt),
        extensionRequestedHoldDays: quote.holdDays,
        extensionExtraAmount: quote.extraAmount,
        extensionExtraAmountCents: quote.extraAmountCents,
        extensionHoldPricingMode: quote.holdPricingMode,
        extensionHoldRateAmount: quote.holdRateAmount,
        extensionRequestedAt: now,
        extensionDecidedAt: admin.firestore.FieldValue.delete(),
        extensionDecidedBy: admin.firestore.FieldValue.delete(),
        extensionPaymentIntentId: admin.firestore.FieldValue.delete(),
        extensionPaymentStatus: admin.firestore.FieldValue.delete(),
        updatedAt: now,
      });
      return {success: true, purchaseId};
    },
);

exports.decidePaidHoldExtension = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const {purchaseId, decision} = request.data || {};
      if (!purchaseId || !["approved", "rejected"].includes(decision)) {
        throw new HttpsError("invalid-argument", "Choose approve or reject");
      }

      const db = admin.firestore();
      const purchaseRef = db.collection("carPurchases").doc(purchaseId);
      const purchaseDoc = await purchaseRef.get();
      if (!purchaseDoc.exists) {
        throw new HttpsError("not-found", "Purchase not found");
      }
      const purchase = purchaseDoc.data();
      await requireBusinessManager(uid, purchase.businessId);
      assertPaidHoldActionable(purchase);
      if (purchase.extensionRequestStatus !== "pending") {
        throw new HttpsError(
            "failed-precondition",
            "No pending extension request",
        );
      }
      const now = admin.firestore.FieldValue.serverTimestamp();
      await purchaseRef.update({
        extensionRequestStatus: decision,
        extensionDecidedAt: now,
        extensionDecidedBy: uid,
        updatedAt: now,
      });
      return {success: true, purchaseId};
    },
);

exports.createPaidHoldExtensionPaymentIntent = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const buyerUid = requireAuth(request);
      const {purchaseId} = request.data || {};
      if (!purchaseId) {
        throw new HttpsError("invalid-argument", "Purchase ID is required");
      }

      const db = admin.firestore();
      const purchaseRef = db.collection("carPurchases").doc(purchaseId);
      const purchaseDoc = await purchaseRef.get();
      if (!purchaseDoc.exists) {
        throw new HttpsError("not-found", "Purchase not found");
      }
      const purchase = purchaseDoc.data();
      if (purchase.buyerUid !== buyerUid) {
        throw new HttpsError("permission-denied", "Purchase access denied");
      }
      assertPaidHoldActionable(purchase);
      if (purchase.extensionRequestStatus !== "approved") {
        throw new HttpsError(
            "failed-precondition",
            "This extension is not approved",
        );
      }
      const extraCents = Number(purchase.extensionExtraAmountCents || 0);
      if (!Number.isFinite(extraCents) || extraCents < 0) {
        throw new HttpsError(
            "failed-precondition",
            "Extension amount is invalid",
        );
      }

      async function applyExtension(paymentIntentId, paymentStatus) {
        const now = admin.firestore.FieldValue.serverTimestamp();
        await purchaseRef.update({
          holdUntilDate: purchase.extensionRequestedHoldUntilDate,
          holdExpiresAt: purchase.extensionRequestedHoldExpiresAt,
          holdDays: purchase.extensionRequestedHoldDays,
          holdPricingMode: purchase.extensionHoldPricingMode,
          holdRateAmount: purchase.extensionHoldRateAmount,
          depositAmount: Number(purchase.depositAmount || 0) +
            Number(purchase.extensionExtraAmount || 0),
          extensionRequestStatus: "paid",
          extensionPaymentStatus: paymentStatus,
          extensionPaymentIntentId: paymentIntentId,
          purchaseStatus: "reserved",
          depositForfeitureStatus: "active",
          extensionPaidAt: now,
          updatedAt: now,
        });
      }

      if (extraCents === 0 || SIMULATE_PAYMENTS) {
        await applyExtension(`simulated_extension_${purchaseId}`, "succeeded");
        return {success: true, purchaseId, simulatedPayment: true};
      }

      const paymentIntent = await createStripePaymentIntent({
        amount: extraCents,
        currency: DEPOSIT_CURRENCY,
        metadata: {
          purchaseId,
          buyerUid,
          paymentType: "hold_extension",
        },
      });
      await purchaseRef.update({
        extensionPaymentIntentId: paymentIntent.id,
        extensionPaymentStatus: "pending",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return {purchaseId, clientSecret: paymentIntent.client_secret};
    },
);

exports.completePaidHoldExtensionPayment = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const buyerUid = requireAuth(request);
      const {purchaseId} = request.data || {};
      if (!purchaseId) {
        throw new HttpsError("invalid-argument", "Purchase ID is required");
      }
      const db = admin.firestore();
      const purchaseRef = db.collection("carPurchases").doc(purchaseId);
      const purchaseDoc = await purchaseRef.get();
      if (!purchaseDoc.exists) {
        throw new HttpsError("not-found", "Purchase not found");
      }
      const purchase = purchaseDoc.data();
      if (purchase.buyerUid !== buyerUid) {
        throw new HttpsError("permission-denied", "Purchase access denied");
      }
      assertPaidHoldActionable(purchase);
      if (purchase.extensionRequestStatus !== "approved") {
        return {success: true, purchaseId};
      }
      const intentId = purchase.extensionPaymentIntentId;
      if (!String(intentId || "").startsWith("simulated_")) {
        const intent = await retrieveStripePaymentIntent(intentId);
        if (intent.status !== "succeeded") {
          await purchaseRef.update({
            extensionPaymentStatus: intent.status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          throw new HttpsError(
              "failed-precondition",
              `Payment is ${intent.status}`,
          );
        }
      }
      const now = admin.firestore.FieldValue.serverTimestamp();
      await purchaseRef.update({
        holdUntilDate: purchase.extensionRequestedHoldUntilDate,
        holdExpiresAt: purchase.extensionRequestedHoldExpiresAt,
        holdDays: purchase.extensionRequestedHoldDays,
        holdPricingMode: purchase.extensionHoldPricingMode,
        holdRateAmount: purchase.extensionHoldRateAmount,
        depositAmount: Number(purchase.depositAmount || 0) +
          Number(purchase.extensionExtraAmount || 0),
        extensionRequestStatus: "paid",
        extensionPaymentStatus: "succeeded",
        purchaseStatus: "reserved",
        depositForfeitureStatus: "active",
        extensionPaidAt: now,
        updatedAt: now,
      });
      return {success: true, purchaseId};
    },
);

exports.expirePaidCarHolds = onSchedule(
    {
      schedule: "every 1 hours",
      timeZone: "America/New_York",
    },
    async () => {
      const db = admin.firestore();
      const now = admin.firestore.Timestamp.now();
      const expired = await db.collection("carPurchases")
          .where("paymentType", "==", "reservation_deposit")
          .where("purchaseStatus", "==", "reserved")
          .where("holdExpiresAt", "<=", now)
          .limit(100)
          .get();

      for (const purchaseDoc of expired.docs) {
        await db.runTransaction(async (transaction) => {
          const purchaseRef = purchaseDoc.ref;
          const lockedPurchase = await transaction.get(purchaseRef);
          if (!lockedPurchase.exists) return;
          const purchase = lockedPurchase.data();
          if (
            purchase.purchaseStatus !== "reserved" ||
            purchase.paymentType !== "reservation_deposit"
          ) {
            return;
          }
          const carRef = db.collection("cars").doc(purchase.carId);
          const carDoc = await transaction.get(carRef);
          const updateTime = admin.firestore.FieldValue.serverTimestamp();
          transaction.update(purchaseRef, {
            purchaseStatus: "hold_review_required",
            depositForfeitureStatus: "review_pending",
            holdReviewRequiredAt: updateTime,
            updatedAt: updateTime,
          });
          if (carDoc.exists &&
              carDoc.data().status === "reserved" &&
              carDoc.data().reservedPurchaseId === purchaseRef.id) {
            transaction.update(carRef, {updatedAt: updateTime});
          }
        });
      }

      logger.info("Expired paid car holds", {count: expired.size});
    },
);
