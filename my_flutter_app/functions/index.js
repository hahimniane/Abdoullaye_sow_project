const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

// Initialize Firebase Admin SDK
admin.initializeApp();

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
