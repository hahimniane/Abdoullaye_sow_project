const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

// Initialize Firebase Admin SDK
admin.initializeApp();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const DEPOSIT_AMOUNT_CENTS = 50000;
const DEPOSIT_CURRENCY = "usd";
const SEED_COUNTRIES = [
  {id: "guinea", name: "Guinea", code: "GN", sortOrder: 0},
  {id: "senegal", name: "Senegal", code: "SN", sortOrder: 1},
  {id: "sierra-leone", name: "Sierra Leone", code: "SL", sortOrder: 2},
  {id: "liberia", name: "Liberia", code: "LR", sortOrder: 3},
  {id: "mali", name: "Mali", code: "ML", sortOrder: 4},
  {id: "guinea-bissau", name: "Guinea-Bissau", code: "GW", sortOrder: 5},
  {id: "ivory-coast", name: "Ivory Coast", code: "CI", sortOrder: 6},
];

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

      const batch = admin.firestore().batch();
      const now = admin.firestore.FieldValue.serverTimestamp();
      SEED_COUNTRIES.forEach((country) => {
        const ref = admin
            .firestore()
            .collection("destinationCountries")
            .doc(country.id);
        batch.set(
            ref,
            {
              name: country.name,
              code: country.code,
              sortOrder: country.sortOrder,
              isActive: true,
              updatedAt: now,
            },
            {merge: true},
        );
      });
      await batch.commit();

      return {
        success: true,
        count: SEED_COUNTRIES.length,
      };
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
