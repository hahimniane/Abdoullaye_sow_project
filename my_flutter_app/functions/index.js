const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const {ALL_COUNTRIES} = require("./country_catalog");

// Initialize Firebase Admin SDK
admin.initializeApp();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const googleMapsApiKey = defineSecret("GOOGLE_MAPS_API_KEY");
const DEPOSIT_AMOUNT_CENTS = 50000;
const DEPOSIT_CURRENCY = "usd";
const PURCHASE_CURRENCY = "usd";
const SHIPMENT_CURRENCY = "usd";
async function getUserRole(uid) {
  const doc = await admin.firestore().collection("users").doc(uid).get();
  if (!doc.exists) {
    throw new HttpsError("permission-denied", "User profile not found");
  }
  return doc.data().role;
}

function requireAuth(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }
  return request.auth.uid;
}

async function requireStaffOrAdmin(uid) {
  const role = await getUserRole(uid);
  if (role !== "staff" && role !== "admin") {
    throw new HttpsError("permission-denied", "Staff access required");
  }
  return role;
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
          logger.warn("Non-admin attempted to create user", {
            uid: callerUid,
            role: callerData.role,
          });
          throw new HttpsError(
              "permission-denied",
              "Only admins can create new staff users",
          );
        }

        // Extract user details from the request
        const {email, password} = request.data;

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

        // Create the new user using Admin SDK
        const userRecord = await admin.auth().createUser({
          email: email,
          password: password,
        });

        logger.info("User created in Firebase Auth", {
          uid: userRecord.uid,
          email: userRecord.email,
        });

        // Create the user document in Firestore with staff role
        await admin.firestore().collection("users").doc(userRecord.uid).set({
          email: email,
          role: "staff",
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
        const validRoles = ["customer", "staff", "admin"];
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
      await requireStaffOrAdmin(callerUid);

      const db = admin.firestore();
      const refs = ALL_COUNTRIES.map((country) =>
        db.collection("destinationCountries").doc(country.id),
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

exports.suggestPickupAddresses = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [googleMapsApiKey],
    },
    async (request) => {
      requireAuth(request);
      const input = String(request.data?.input || "").trim();
      if (input.isEmpty) {
        return [];
      }

      const params = new URLSearchParams({
        input,
        key: googleMapsApiKey.value(),
        components: "country:us",
        types: "address",
        location: "40.8448,-73.8648",
        radius: "36000",
      });
      const response = await fetch(
          `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params}`,
      );
      const data = await response.json();
      if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
        logger.warn("Places autocomplete failed", data);
        throw new HttpsError(
            "internal",
            data.error_message || "Address autocomplete is unavailable",
        );
      }

      return (data.predictions || []).slice(0, 6).map((prediction) => ({
        description: prediction.description,
        placeId: prediction.place_id,
      }));
    },
);

exports.createBarrelShipmentPaymentIntent = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const {
        senderName,
        receiverName,
        receiverPhone,
        destinationCountryId,
        pickupRequested,
        pickupAddress,
        pickupBorough,
        pickupDateTime,
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
      const countryRef = db
          .collection("destinationCountries")
          .doc(destinationCountryId);
      const pricingRef = db.collection("shipmentPricing").doc("barrelPickup");
      const [countryDoc, pricingDoc, userRecord] = await Promise.all([
        countryRef.get(),
        pricingRef.get(),
        admin.auth().getUser(customerUid),
      ]);

      if (!countryDoc.exists || countryDoc.data().isActive === false) {
        throw new HttpsError("invalid-argument", "Destination is unavailable");
      }
      const country = countryDoc.data();
      const shippingFee = Number(country.barrelShippingPrice || 0);
      if (!Number.isFinite(shippingFee) || shippingFee <= 0) {
        throw new HttpsError(
            "failed-precondition",
            "This destination does not have a barrel shipping price yet",
        );
      }

      const pricing = barrelPickupPricingFromData(pricingDoc.data());
      const pickup = wantsPickup ?
        pickupFeeForBorough(pricing, String(pickupBorough)) :
        {miles: 0, fee: 0};
      const total = shippingFee + pickup.fee;
      if (!Number.isFinite(total) || total <= 0) {
        throw new HttpsError("failed-precondition", "Invalid shipment total");
      }

      const shipmentRef = db.collection("barrelShipments").doc();
      const trackingCode = await generateTrackingCode("BS", "barrelShipments");
      const now = admin.firestore.FieldValue.serverTimestamp();
      const cleanPickupAddress = wantsPickup ?
        String(pickupAddress).trim() :
        pricing.officeAddress;

      await shipmentRef.set({
        trackingCode,
        senderName: String(senderName).trim(),
        senderAddress: cleanPickupAddress,
        receiverName: String(receiverName).trim(),
        receiverPhone: String(receiverPhone).trim(),
        destinationCountryId,
        destinationCountryName: country.name || "Guinea",
        customerUid,
        customerEmail: userRecord.email || "",
        pickupRequested: wantsPickup,
        pickupAddress: cleanPickupAddress,
        pickupBorough: wantsPickup ? String(pickupBorough) : "Office drop-off",
        pickupMiles: pickup.miles,
        pickupFee: pickup.fee,
        shippingFee,
        pricingPendingReview: false,
        ...(pickupAppointment && {
          pickupDateTime: admin.firestore.Timestamp.fromDate(pickupAppointment),
        }),
        price: total,
        paymentStatus: "pending",
        status: "pending_payment",
        createdAt: now,
        updatedAt: now,
      });

      let paymentIntent;
      try {
        paymentIntent = await createStripePaymentIntent({
          amount: Math.round(total * 100),
          currency: SHIPMENT_CURRENCY,
          metadata: {
            shipmentId: shipmentRef.id,
            trackingCode,
            customerUid,
            destinationCountryId,
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
        throw error;
      }

      return {
        shipmentId: shipmentRef.id,
        trackingCode,
        clientSecret: paymentIntent.client_secret,
      };
    },
);

exports.completeBarrelShipmentPayment = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
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
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const {shipmentId} = request.data || {};
      if (!shipmentId) {
        throw new HttpsError("invalid-argument", "Shipment ID is required");
      }

      const shipmentRef = admin
          .firestore()
          .collection("barrelShipments")
          .doc(shipmentId);
      const shipmentDoc = await shipmentRef.get();
      if (!shipmentDoc.exists) return {success: true, shipmentId};
      const shipment = shipmentDoc.data();
      if (shipment.customerUid !== customerUid) {
        throw new HttpsError("permission-denied", "Shipment access denied");
      }
      if (shipment.paymentStatus !== "pending") {
        return {success: true, shipmentId};
      }

      if (shipment.stripePaymentIntentId) {
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

      await shipmentRef.update({
        paymentStatus: "cancelled",
        status: "cancelled",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return {success: true, shipmentId};
    },
);

exports.createCarDepositPaymentIntent = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const buyerUid = requireAuth(request);
      const {
        carId,
        destinationCountryId,
        buyerName,
        buyerPhone,
      } = request.data || {};

      if (!carId || !destinationCountryId || !buyerName || !buyerPhone) {
        throw new HttpsError(
            "invalid-argument",
            "Car, destination, name, and phone are required",
        );
      }

      const db = admin.firestore();
      const carRef = db.collection("cars").doc(carId);
      const countryRef = db
          .collection("destinationCountries")
          .doc(destinationCountryId);
      const [carDoc, countryDoc, userRecord] = await Promise.all([
        carRef.get(),
        countryRef.get(),
        admin.auth().getUser(buyerUid),
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
      if (!countryDoc.exists || countryDoc.data().isActive === false) {
        throw new HttpsError("invalid-argument", "Destination is unavailable");
      }

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
      const country = countryDoc.data();
      const now = admin.firestore.FieldValue.serverTimestamp();
      await purchaseRef.set({
        carId,
        carTitle: car.title || `${car.make || ""} ${car.model || ""}`.trim(),
        buyerUid,
        buyerEmail: userRecord.email || "",
        buyerName: String(buyerName).trim(),
        buyerPhone: String(buyerPhone).trim(),
        destinationCountryId,
        destinationCountryName: country.name || "Guinea",
        depositAmount: DEPOSIT_AMOUNT_CENTS / 100,
        depositCurrency: DEPOSIT_CURRENCY.toUpperCase(),
        paymentStatus: "pending",
        purchaseStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });

      const paymentIntent = await createStripePaymentIntent({
        amount: DEPOSIT_AMOUNT_CENTS,
        currency: DEPOSIT_CURRENCY,
        metadata: {
          carId,
          buyerUid,
          destinationCountryId,
          purchaseId: purchaseRef.id,
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
        destinationCountryId,
        buyerName,
        buyerPhone,
        appointmentStart,
        appointmentLabel,
      } = request.data || {};

      if (
        !carId ||
        !destinationCountryId ||
        !buyerName ||
        !buyerPhone ||
        !appointmentStart ||
        !appointmentLabel
      ) {
        throw new HttpsError(
            "invalid-argument",
            "Car, destination, name, phone, and viewing time are required",
        );
      }

      const appointment = parseFutureAppointment(appointmentStart);
      const db = admin.firestore();
      const carRef = db.collection("cars").doc(carId);
      const countryRef = db
          .collection("destinationCountries")
          .doc(destinationCountryId);
      const [carDoc, countryDoc, userRecord] = await Promise.all([
        carRef.get(),
        countryRef.get(),
        admin.auth().getUser(buyerUid),
      ]);

      if (!carDoc.exists) {
        throw new HttpsError("not-found", "Car not found");
      }
      if (!countryDoc.exists || countryDoc.data().isActive === false) {
        throw new HttpsError("invalid-argument", "Destination is unavailable");
      }

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
      const country = countryDoc.data();
      const now = admin.firestore.FieldValue.serverTimestamp();

      await db.runTransaction(async (transaction) => {
        const lockedCarDoc = await transaction.get(carRef);
        if (!lockedCarDoc.exists) {
          throw new HttpsError("not-found", "Car not found");
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
          buyerUid,
          buyerEmail: userRecord.email || "",
          buyerName: String(buyerName).trim(),
          buyerPhone: String(buyerPhone).trim(),
          destinationCountryId,
          destinationCountryName: country.name || "Guinea",
          depositAmount: 0,
          depositCurrency: PURCHASE_CURRENCY.toUpperCase(),
          paymentType: "viewing_reservation",
          paymentStatus: "not_required",
          purchaseStatus: "reserved",
          appointmentStart: admin.firestore.Timestamp.fromDate(appointment),
          appointmentLabel: String(appointmentLabel).trim(),
          createdAt: now,
          updatedAt: now,
        });
        transaction.update(carRef, {
          status: "reserved",
          reservedPurchaseId: purchaseRef.id,
          updatedAt: now,
        });
      });

      return {
        success: true,
        purchaseId: purchaseRef.id,
      };
    },
);

exports.createCarPurchasePaymentIntent = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const buyerUid = requireAuth(request);
      const {
        carId,
        destinationCountryId,
        buyerName,
        buyerPhone,
      } = request.data || {};

      if (!carId || !destinationCountryId || !buyerName || !buyerPhone) {
        throw new HttpsError(
            "invalid-argument",
            "Car, destination, name, and phone are required",
        );
      }

      const db = admin.firestore();
      const carRef = db.collection("cars").doc(carId);
      const countryRef = db
          .collection("destinationCountries")
          .doc(destinationCountryId);
      const [carDoc, countryDoc, userRecord] = await Promise.all([
        carRef.get(),
        countryRef.get(),
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
      if (!countryDoc.exists || countryDoc.data().isActive === false) {
        throw new HttpsError("invalid-argument", "Destination is unavailable");
      }

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
      const country = countryDoc.data();
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
          buyerUid,
          buyerEmail: userRecord.email || "",
          buyerName: String(buyerName).trim(),
          buyerPhone: String(buyerPhone).trim(),
          destinationCountryId,
          destinationCountryName: country.name || "Guinea",
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
          updatedAt: now,
        });
      });

      let paymentIntent;
      try {
        paymentIntent = await createStripePaymentIntent({
          amount: purchaseAmountCents,
          currency: PURCHASE_CURRENCY,
          metadata: {
            carId,
            buyerUid,
            destinationCountryId,
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
      secrets: [stripeSecretKey],
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
      secrets: [stripeSecretKey],
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

      if (purchase.stripePaymentIntentId) {
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
      secrets: [stripeSecretKey],
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
          updatedAt: now,
        });
      });

      return {
        success: true,
        purchaseId,
      };
    },
);
