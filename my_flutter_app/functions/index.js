const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {
  onDocumentDeleted,
  onDocumentUpdated,
} = require("firebase-functions/v2/firestore");
const {defineSecret} = require("firebase-functions/params");
const crypto = require("crypto");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const {ALL_COUNTRIES} = require("./country_catalog");
const {
  buildBusinessCarBackfillPayload,
  buildBusinessCarBackfillResult,
  eligibleBackfillDocs,
  normalizeBackfillCarIds,
} = require("./business_car_backfill");
const {
  buildFeaturedBusinessPayload,
  buildFeaturingRequestUpdate,
} = require("./featured_business");

// Initialize Firebase Admin SDK
admin.initializeApp();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const businessProPriceId = defineSecret("BUSINESS_PRO_PRICE_ID");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");
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
const VALID_BUSINESS_PERMISSIONS = [
  "profile",
  "listings",
  "purchases",
  "barrels",
  "transport",
  "parking",
  "destinations",
  "people",
  "support",
  "growth",
];
const VALID_PLATFORM_ADMIN_ROLES = [
  "superAdmin",
  "operationsManager",
  "financeManager",
  "supportAdmin",
  "contentManager",
];
const ADMIN_ROLE_CAPABILITIES = {
  superAdmin: [
    "users",
    "businesses",
    "marketplace",
    "operations",
    "finance",
    "support",
    "website",
  ],
  operationsManager: [
    "businesses",
    "marketplace",
    "operations",
    "support",
    "website",
  ],
  financeManager: ["finance", "support"],
  supportAdmin: ["support"],
  contentManager: ["website"],
};
const ADMIN_BUSINESS_STATUSES = [
  "pending",
  "approved",
  "suspended",
  "changes_requested",
  "rejected",
];
const ADMIN_LISTING_STATUSES = ["active", "inactive", "reserved", "sold"];
const ADMIN_OPERATION_STATUSES = [
  "pending",
  "active",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
  "sold",
  "reserved",
  "inactive",
];
const ADMIN_PURCHASE_STATUSES = [
  "pending",
  "viewing_scheduled",
  "reserved",
  "completed",
  "cancelled",
  "no_show",
  "refunded",
  "forfeited",
];
const DEFAULT_BUSINESS_SERVICES = [...VALID_BUSINESS_SERVICES];
const DEFAULT_BUSINESS_ADVISOR_MODEL = "claude-fable-5";
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
        adminRole: "superAdmin",
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

exports.resolveSignInIdentifier = onCall(async (request) => {
  const identifier = String(request.data?.identifier || "").trim();
  if (!identifier) {
    throw new HttpsError("invalid-argument", "Enter an email or phone number");
  }
  if (identifier.includes("@")) {
    if (!isValidEmail(identifier)) {
      throw new HttpsError("invalid-argument", "Enter a valid email address");
    }
    return {email: identifier.toLowerCase()};
  }

  requireValidPhoneNumber(identifier, "Phone");
  const alias = normalizePhoneAlias(identifier);
  const doc = await admin.firestore()
      .collection("phoneSignInAliases")
      .doc(alias)
      .get();
  if (!doc.exists) {
    throw new HttpsError("not-found", "No account found for this phone");
  }
  const email = String(doc.data()?.email || "").trim().toLowerCase();
  if (!email) {
    throw new HttpsError("not-found", "No account found for this phone");
  }
  return {email};
});

exports.createCustomerUser = onCall(async (request) => {
  const email = String(request.data?.email || "").trim().toLowerCase();
  const password = String(request.data?.password || "");
  const fullName = String(request.data?.fullName || "").trim();
  const phone = String(request.data?.phone || "").trim();

  if (!isValidEmail(email)) {
    throw new HttpsError("invalid-argument", "Enter a valid email address");
  }
  if (password.length < 6) {
    throw new HttpsError(
        "invalid-argument",
        "Password must be at least 6 characters",
    );
  }
  if (!fullName) {
    throw new HttpsError("invalid-argument", "Full name is required");
  }
  requireValidPhoneNumber(phone, "Phone");

  const db = admin.firestore();
  const normalizedPhone = normalizePhoneAlias(phone);
  const aliasRef = db.collection("phoneSignInAliases").doc(normalizedPhone);
  const existingAlias = await aliasRef.get();
  if (existingAlias.exists) {
    throw new HttpsError(
        "already-exists",
        "An account already uses this phone number",
    );
  }

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: fullName,
    });
  } catch (error) {
    if (error.code === "auth/email-already-exists") {
      throw new HttpsError(
          "already-exists",
          "An account already exists with this email",
      );
    }
    if (error.code === "auth/invalid-email") {
      throw new HttpsError("invalid-argument", "Enter a valid email address");
    }
    logger.error("Failed to create customer auth user", error);
    throw new HttpsError("internal", "Could not create account");
  }

  try {
    const now = admin.firestore.FieldValue.serverTimestamp();
    await db.runTransaction(async (transaction) => {
      const aliasSnap = await transaction.get(aliasRef);
      if (aliasSnap.exists) {
        throw new HttpsError(
            "already-exists",
            "An account already uses this phone number",
        );
      }
      transaction.set(db.collection("users").doc(userRecord.uid), {
        email,
        fullName,
        phone,
        normalizedPhone,
        role: "customer",
        notificationPreferences: defaultNotificationPreferences(),
        createdAt: now,
        updatedAt: now,
      });
      transaction.set(aliasRef, {
        uid: userRecord.uid,
        email,
        phone,
        createdAt: now,
        updatedAt: now,
      });
    });
  } catch (error) {
    await admin.auth().deleteUser(userRecord.uid).catch((deleteError) => {
      logger.error("Failed to roll back customer auth user", deleteError);
    });
    if (error instanceof HttpsError) throw error;
    logger.error("Failed to create customer profile", error);
    throw new HttpsError("internal", "Could not create account profile");
  }

  return {
    uid: userRecord.uid,
    email,
    normalizedPhone,
    notificationPreferences: defaultNotificationPreferences(),
  };
});

exports.updateCustomerProfile = onCall(async (request) => {
  const uid = requireAuth(request);
  const fullName = String(request.data?.fullName || "").trim();
  const phone = String(request.data?.phone || "").trim();
  const profileImageUrl =
    String(request.data?.profileImageUrl || "").trim();
  const profileImagePath =
    String(request.data?.profileImagePath || "").trim();
  const notificationPreferences = normalizeNotificationPreferences(
      request.data?.notificationPreferences,
  );

  if (!fullName) {
    throw new HttpsError("invalid-argument", "Full name is required");
  }
  requireValidPhoneNumber(phone, "Phone");

  const db = admin.firestore();
  const userRef = db.collection("users").doc(uid);
  const normalizedPhone = normalizePhoneAlias(phone);
  const nextAliasRef = db.collection("phoneSignInAliases").doc(
      normalizedPhone,
  );
  const email = String(request.auth.token.email || "").toLowerCase();
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User profile not found");
    }
    const current = userSnap.data() || {};
    const currentAlias = String(current.normalizedPhone || "");
    const nextAliasSnap = await transaction.get(nextAliasRef);
    if (nextAliasSnap.exists && nextAliasSnap.data()?.uid !== uid) {
      throw new HttpsError(
          "already-exists",
          "An account already uses this phone number",
      );
    }

    if (currentAlias && currentAlias !== normalizedPhone) {
      transaction.delete(db.collection("phoneSignInAliases").doc(
          currentAlias,
      ));
    }
    transaction.set(nextAliasRef, {
      uid,
      email,
      phone,
      updatedAt: now,
      createdAt: nextAliasSnap.exists ?
        nextAliasSnap.data()?.createdAt || now :
        now,
    }, {merge: true});

    const updates = {
      fullName,
      phone,
      normalizedPhone,
      notificationPreferences,
      updatedAt: now,
    };
    if (profileImageUrl) updates.profileImageUrl = profileImageUrl;
    if (profileImagePath) updates.profileImagePath = profileImagePath;
    transaction.set(userRef, updates, {merge: true});
  });

  await admin.auth().updateUser(uid, {displayName: fullName});
  return {success: true, normalizedPhone, notificationPreferences};
});

exports.notifyCarPurchaseStatus = onDocumentUpdated(
    "carPurchases/{purchaseId}",
    async (event) => {
      if (!statusChanged(event)) return;
      const after = event.data.after.data() || {};
      const uid = userIdFrom(after, ["buyerUid", "customerUid", "uid"]);
      await sendPreferenceNotification({
        uid,
        preferenceKey: "carActivity",
        title: "Car update",
        body: `Your car request is now ${after.status || "updated"}.`,
        data: {
          type: "car_purchase_status",
          purchaseId: event.params.purchaseId,
          status: after.status || "",
        },
      });
    },
);

exports.notifyBarrelShipmentStatus = onDocumentUpdated(
    "barrelShipments/{shipmentId}",
    async (event) => {
      if (!statusChanged(event)) return;
      const after = event.data.after.data() || {};
      const uid = userIdFrom(after, ["customerUid", "senderUid", "uid"]);
      await sendPreferenceNotification({
        uid,
        preferenceKey: "shipmentActivity",
        title: "Shipment update",
        body: `Your barrel shipment is now ${after.status || "updated"}.`,
        data: {
          type: "barrel_shipment_status",
          shipmentId: event.params.shipmentId,
          status: after.status || "",
        },
      });
    },
);

exports.notifyWalletRefundStatus = onDocumentUpdated(
    "walletRefundRequests/{requestId}",
    async (event) => {
      if (!statusChanged(event)) return;
      const after = event.data.after.data() || {};
      const uid = userIdFrom(after, ["customerUid", "userId", "uid"]);
      await sendPreferenceNotification({
        uid,
        preferenceKey: "walletActivity",
        title: "Wallet update",
        body: `Your refund request is now ${after.status || "updated"}.`,
        data: {
          type: "wallet_refund_status",
          requestId: event.params.requestId,
          status: after.status || "",
        },
      });
    },
);

exports.notifyBusinessApplicationStatus = onDocumentUpdated(
    "businessApplications/{applicationId}",
    async (event) => {
      if (!statusChanged(event)) return;
      const after = event.data.after.data() || {};
      const uid = userIdFrom(after, ["applicantUid", "ownerUid", "uid"]);
      await sendPreferenceNotification({
        uid,
        preferenceKey: "businessActivity",
        title: "Business application update",
        body: `Your application is now ${after.status || "updated"}.`,
        data: {
          type: "business_application_status",
          applicationId: event.params.applicationId,
          status: after.status || "",
        },
      });
    },
);

exports.unpublishSuspendedFeaturedBusiness = onDocumentUpdated(
    "businesses/{businessId}",
    async (event) => {
      const before = event.data.before.data() || {};
      const after = event.data.after.data() || {};
      const status = String(after.status || "").toLowerCase();
      const wasFeatured = String(before.featureStatus || "") === "approved" ||
        String(after.featureStatus || "") === "approved";
      if (!wasFeatured && status !== "suspended" && status !== "rejected") {
        return;
      }
      if (status === "approved") return;
      await admin.firestore()
          .collection("featuredBusinesses")
          .doc(event.params.businessId)
          .delete();
      await event.data.after.ref.set({
        featureStatus: "none",
        featureNote:
          "Automatically unpublished because the business is not approved.",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
    },
);

exports.unpublishDeletedFeaturedBusiness = onDocumentDeleted(
    "businesses/{businessId}",
    async (event) => {
      await admin.firestore()
          .collection("featuredBusinesses")
          .doc(event.params.businessId)
          .delete();
    },
);

async function getUserProfile(uid) {
  const doc = await admin.firestore().collection("users").doc(uid).get();
  if (!doc.exists) {
    throw new HttpsError("permission-denied", "User profile not found");
  }
  const user = {id: doc.id, ...doc.data()};
  if (user.role === "admin") {
    const role = platformAdminRole(user);
    if (role === "superAdmin") {
      user.effectiveCapabilities = [
        "users", "businesses", "marketplace",
        "operations", "finance", "support", "website",
      ];
      user.effectiveServices = null; // null = all services
    } else {
      const config = await loadPermissionsConfig();
      const roleConfig = roleConfigFor(role, config);
      if (roleConfig) {
        user.effectiveCapabilities =
          capabilitiesFromSections(roleConfig.sections);
        const svc = roleConfig.services;
        user.effectiveServices =
          (Array.isArray(svc) && svc.length) ? svc : null;
      } else {
        user.effectiveCapabilities = [];
        user.effectiveServices = [];
      }
    }
  }
  return user;
}

// ---- Config-driven RBAC (matches admin_web Settings) ----
const DEFAULT_ROLE_CONFIGS = {
  operationsManager: {
    sections: {
      people: "view", businesses: "manage", marketplace: "manage",
      operations: "manage", finance: "none", support: "manage",
      website: "manage",
    },
    services: [],
  },
  financeManager: {
    sections: {
      people: "view", businesses: "none", marketplace: "none",
      operations: "view", finance: "manage", support: "manage",
      website: "none",
    },
    services: [],
  },
  supportAdmin: {
    sections: {
      people: "view", businesses: "view", marketplace: "view",
      operations: "view", finance: "none", support: "manage",
      website: "none",
    },
    services: [],
  },
  contentManager: {
    sections: {
      people: "view", businesses: "view", marketplace: "none",
      operations: "none", finance: "none", support: "none",
      website: "manage",
    },
    services: [],
  },
};
const SECTION_TO_CAPABILITY = {
  people: "users", businesses: "businesses", marketplace: "marketplace",
  operations: "operations", finance: "finance", support: "support",
  website: "website",
};
const COLLECTION_TO_SERVICE = {
  barrelShipments: "barrelShipping",
  transportRequests: "carTransport",
  parkedCars: "carParking",
  cars: "carSales",
  carPurchases: "carSales",
};

let _permConfigCache = null;
let _permConfigAt = 0;
async function loadPermissionsConfig() {
  if (_permConfigCache && Date.now() - _permConfigAt < 15000) {
    return _permConfigCache;
  }
  try {
    const snap = await admin.firestore()
        .doc("platformConfig/permissions").get();
    _permConfigCache = snap.exists ? (snap.data() || {}) : {};
  } catch (error) {
    logger.warn("Failed to load permissions config", error);
    _permConfigCache = {};
  }
  _permConfigAt = Date.now();
  return _permConfigCache;
}

function roleConfigFor(roleKey, config) {
  const roles = (config && config.roles) || {};
  return roles[roleKey] || DEFAULT_ROLE_CONFIGS[roleKey] || null;
}

// A role is assignable if it's the super admin, a built-in role, or a custom
// role defined in the live config.
async function assertAssignableRole(adminRole) {
  if (adminRole === "superAdmin" ||
      VALID_PLATFORM_ADMIN_ROLES.includes(adminRole)) {
    return;
  }
  const config = await loadPermissionsConfig();
  const roles = (config && config.roles) || {};
  if (roles[adminRole]) return;
  throw new HttpsError("invalid-argument", `Unknown admin role: ${adminRole}`);
}

function capabilitiesFromSections(sections) {
  const caps = [];
  for (const [section, level] of Object.entries(sections || {})) {
    if (level === "manage" && SECTION_TO_CAPABILITY[section]) {
      caps.push(SECTION_TO_CAPABILITY[section]);
    }
  }
  return caps;
}

function hasServiceAccess(user, serviceId) {
  if (user.role !== "admin") return false;
  if (user.effectiveServices == null) return true; // all services
  if (!serviceId) return true;
  return user.effectiveServices.includes(serviceId);
}

function requireServiceAccessForCollection(user, collectionName, message) {
  const serviceId = COLLECTION_TO_SERVICE[collectionName];
  if (serviceId && !hasServiceAccess(user, serviceId)) {
    throw new HttpsError(
        "permission-denied",
        message || "Your role is not allowed to manage this service",
    );
  }
}

exports.updateCurrentAdminProfile = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const current = await getUserProfile(uid);
      if (current.role !== "admin") {
        throw new HttpsError(
            "permission-denied",
            "Only platform admins can update an admin profile",
        );
      }

      const fullName = String(request.data?.fullName || "").trim();
      const phone = String(request.data?.phone || "").trim();
      const profileImageUrl =
        String(request.data?.profileImageUrl || "").trim();
      const profileImagePath =
        String(request.data?.profileImagePath || "").trim();
      if (phone) {
        requireValidPhoneNumber(phone, "Phone");
      }

      const authUser = await admin.auth().getUser(uid);
      const phoneVerified = Boolean(
          phone &&
          authUser.phoneNumber &&
          authUser.phoneNumber === phone &&
          request.data?.phoneVerified === true,
      );
      const now = admin.firestore.FieldValue.serverTimestamp();
      const update = {
        fullName,
        phone,
        profileImageUrl,
        profileImagePath,
        phoneVerified,
        updatedAt: now,
        updatedBy: uid,
      };
      if (phoneVerified) {
        update.phoneVerifiedAt = now;
      } else {
        update.phoneVerifiedAt = admin.firestore.FieldValue.delete();
      }

      const db = admin.firestore();
      const batch = db.batch();
      batch.set(db.collection("users").doc(uid), update, {merge: true});
      setAdminAuditLog(batch, {
        action: "admin_profile_updated",
        actorUid: uid,
        targetCollection: "users",
        targetId: uid,
        targetLabel: current.email || fullName || uid,
        nextValue: phoneVerified ? "phone_verified" : "profile_updated",
      });
      await batch.commit();

      const authUpdate = {};
      if (fullName) authUpdate.displayName = fullName;
      if (profileImageUrl) authUpdate.photoURL = profileImageUrl;
      if (Object.keys(authUpdate).length > 0) {
        await admin.auth().updateUser(uid, authUpdate);
      }

      return {
        success: true,
        profile: {
          ...current,
          fullName,
          phone,
          profileImageUrl,
          profileImagePath,
          phoneVerified,
        },
      };
    },
);

function platformAdminRole(user) {
  if (user.role !== "admin") return "";
  // Any assigned adminRole (built-in or custom) is used as-is; an admin with
  // no role is treated as the legacy super admin.
  const role = String(user.adminRole || "").trim();
  return role || "superAdmin";
}

function hasAdminCapability(user, capability) {
  if (user.role !== "admin") return false;
  // Prefer the effective capabilities resolved from the live config
  // (attached by getUserProfile); fall back to the static defaults.
  if (Array.isArray(user.effectiveCapabilities)) {
    return user.effectiveCapabilities.includes(capability);
  }
  const adminRole = platformAdminRole(user);
  if (adminRole === "superAdmin") return true;
  return (ADMIN_ROLE_CAPABILITIES[adminRole] || []).includes(capability);
}

function requireAdminCapability(user, capability, message) {
  if (!hasAdminCapability(user, capability)) {
    throw new HttpsError(
        "permission-denied",
        message || "Platform administrator permission required",
    );
  }
}

function requireSuperAdmin(user, message) {
  if (platformAdminRole(user) !== "superAdmin") {
    throw new HttpsError(
        "permission-denied",
        message || "Only super admins can perform this action",
    );
  }
}

function statusConfigForCollection(collectionName) {
  switch (collectionName) {
    case "businesses":
      return {
        statusField: "status",
        allowedStatuses: ADMIN_BUSINESS_STATUSES,
        capability: "businesses",
      };
    case "cars":
      return {
        statusField: "status",
        allowedStatuses: ADMIN_LISTING_STATUSES,
        capability: "marketplace",
      };
    case "barrelShipments":
    case "transportRequests":
    case "parkedCars":
      return {
        statusField: "status",
        allowedStatuses: ADMIN_OPERATION_STATUSES,
        capability: "operations",
      };
    case "carPurchases":
      return {
        statusField: "purchaseStatus",
        allowedStatuses: ADMIN_PURCHASE_STATUSES,
        capability: "operations",
      };
    default:
      throw new HttpsError(
          "invalid-argument",
          "This collection cannot be managed from the admin console",
      );
  }
}

function statusUpdatePayload({statusField, previousStatus, nextStatus, uid}) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  return {
    [statusField]: nextStatus,
    updatedAt: now,
    updatedBy: uid,
    [`${statusField}UpdatedAt`]: now,
    [`${statusField}UpdatedBy`]: uid,
    [`${statusField}PreviousValue`]: String(previousStatus || ""),
  };
}

function adminRecordLabel(collectionName, id, data = {}) {
  return String(
      data.title ||
      data.trackingCode ||
      data.carTitle ||
      data.name ||
      data.businessName ||
      id,
  );
}

function setAdminAuditLog(batch, {
  action,
  actorUid,
  targetCollection,
  targetId,
  targetLabel,
  statusField,
  previousValue,
  nextValue,
}) {
  const ref = admin.firestore().collection("adminAuditLogs").doc();
  const payload = {
    action,
    actorUid,
    targetCollection,
    targetId,
    targetPath: `${targetCollection}/${targetId}`,
    targetLabel: String(targetLabel || targetId),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (statusField) payload.statusField = statusField;
  if (previousValue !== undefined) payload.previousValue = previousValue;
  if (nextValue !== undefined) payload.nextValue = nextValue;
  batch.set(ref, payload);
}

exports.publishFeaturedBusiness = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const adminUid = requireAuth(request);
      const adminUser = await getUserProfile(adminUid);
      requireAdminCapability(
          adminUser,
          "website",
          "Only website admins can publish featured businesses",
      );

      const businessId = String(request.data?.businessId || "").trim();
      if (!businessId) {
        throw new HttpsError("invalid-argument", "Business is required");
      }

      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }
      const business = businessDoc.data() || {};
      const feature = buildFeaturedBusinessPayload({
        businessId,
        business,
        data: request.data || {},
        adminUid,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        validateWebsite: requireValidWebsite,
      });
      if (feature.missing) {
        const note = `Missing: ${feature.missing.join(", ")}`;
        await businessRef.set({
          featureStatus: "requested",
          featureNote: note,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: adminUid,
        }, {merge: true});
        throw new HttpsError("failed-precondition", note);
      }

      const batch = db.batch();
      batch.set(
          db.collection("featuredBusinesses").doc(businessId),
          feature.payload,
          {merge: true},
      );
      batch.set(businessRef, {
        marketingBlurb: feature.payload.blurb,
        featureConsent: true,
        featureStatus: "approved",
        featureNote: admin.firestore.FieldValue.delete(),
        featureOrder: feature.payload.order,
        logoUrl: feature.payload.logoUrl,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: adminUid,
      }, {merge: true});
      setAdminAuditLog(batch, {
        action: "featured_business_published",
        actorUid: adminUid,
        targetCollection: "featuredBusinesses",
        targetId: businessId,
        targetLabel: feature.payload.displayName,
        nextValue: feature.payload.active ? "active" : "inactive",
      });
      await batch.commit();
      return {success: true, businessId};
    },
);

exports.unpublishFeaturedBusiness = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const adminUid = requireAuth(request);
      const adminUser = await getUserProfile(adminUid);
      requireAdminCapability(
          adminUser,
          "website",
          "Only website admins can unpublish featured businesses",
      );
      const businessId = String(request.data?.businessId || "").trim();
      if (!businessId) {
        throw new HttpsError("invalid-argument", "Business is required");
      }

      const db = admin.firestore();
      const batch = db.batch();
      batch.delete(db.collection("featuredBusinesses").doc(businessId));
      batch.set(db.collection("businesses").doc(businessId), {
        featureStatus: "none",
        featureNote: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: adminUid,
      }, {merge: true});
      setAdminAuditLog(batch, {
        action: "featured_business_unpublished",
        actorUid: adminUid,
        targetCollection: "featuredBusinesses",
        targetId: businessId,
      });
      await batch.commit();
      return {success: true, businessId};
    },
);

exports.requestFeaturing = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const businessId = String(request.data?.businessId || "").trim();
      if (!businessId) {
        throw new HttpsError("invalid-argument", "Business is required");
      }
      const user = await requireBusinessManager(callerUid, businessId);
      if (user.role === "staff") {
        throw new HttpsError(
            "permission-denied",
            "Only business owners can request featuring",
        );
      }
      const businessRef = admin.firestore()
          .collection("businesses")
          .doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }
      const requestUpdate = buildFeaturingRequestUpdate({
        data: request.data || {},
        business: businessDoc.data() || {},
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: callerUid,
        deleteValue: admin.firestore.FieldValue.delete(),
      });
      if (requestUpdate.missing) {
        const note = `Missing: ${requestUpdate.missing.join(", ")}`;
        const code = requestUpdate.missing.includes("feature consent") ?
          "failed-precondition" :
          "invalid-argument";
        throw new HttpsError(code, note);
      }
      await businessRef.set(requestUpdate.update, {merge: true});
      return {success: true, businessId};
    },
);

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

function normalizeBusinessPermissions(raw) {
  const incoming = Array.isArray(raw) ? raw : [];
  return VALID_BUSINESS_PERMISSIONS.filter((permission) =>
    incoming.includes(permission),
  );
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

const TERMINAL_PURCHASE_STATUSES = [
  "completed", "no_show", "cancelled", "refunded", "forfeited",
];

function isTerminalPurchaseStatus(status) {
  return TERMINAL_PURCHASE_STATUSES.includes(String(status || ""));
}

function purchaseIsViewing(purchase) {
  if (purchase.paymentType === "viewing_reservation") return true;
  return Boolean(purchase.appointmentStart) &&
    Number(purchase.depositAmount || 0) === 0;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "object" && typeof value.seconds === "number") {
    return value.seconds * 1000;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

// A no-show may only be recorded once the hold period has actually ended — this
// stops a business from forfeiting a customer's deposit early.
function assertHoldLapsed(purchase) {
  if (purchase.purchaseStatus === "hold_review_required") return;
  if (purchase.holdReviewRequiredAt) return;
  const holdUntilMs = toMillis(purchase.holdUntilDate);
  if (holdUntilMs && holdUntilMs <= Date.now()) return;
  throw new HttpsError(
      "failed-precondition",
      "A no-show can only be marked after the hold period has ended.",
  );
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

function hasBusinessPermission(user, section) {
  if (user.role === "admin" || user.role === "businessOwner") return true;
  const permissions = Array.isArray(user.businessPermissions) ?
    user.businessPermissions : [];
  return permissions.length === 0 || permissions.includes(section);
}

async function requireBusinessPermission(uid, businessId, section) {
  const user = await requireBusinessManager(uid, businessId);
  if (!hasBusinessPermission(user, section)) {
    throw new HttpsError(
        "permission-denied",
        "This staff account is not allowed to manage this section",
    );
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
              destinationNote: country.destinationNote || "",
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

async function createStripeCheckoutSession(params) {
  const body = new URLSearchParams();
  body.set("mode", "subscription");
  body.set("client_reference_id", params.businessId);
  body.set("success_url", params.successUrl);
  body.set("cancel_url", params.cancelUrl);
  body.set("line_items[0][price]", params.priceId);
  body.set("line_items[0][quantity]", "1");
  Object.entries(params.metadata).forEach(([key, value]) => {
    body.set(`metadata[${key}]`, value);
    body.set(`subscription_data[metadata][${key}]`, value);
  });
  if (params.customerEmail) {
    body.set("customer_email", params.customerEmail);
  }
  return stripeRequest("/checkout/sessions", {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body,
  });
}

function verifyStripeWebhookSignature(req, secret) {
  if (!secret || !secret.startsWith("whsec_")) {
    throw new Error("Stripe webhook secret is not configured");
  }
  const signatureHeader = req.get("stripe-signature") || "";
  const parts = signatureHeader.split(",").reduce((result, part) => {
    const [key, value] = part.split("=");
    if (key && value) {
      result[key] = value;
    }
    return result;
  }, {});
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature || !req.rawBody) {
    throw new Error("Missing Stripe webhook signature");
  }
  const signedPayload = `${timestamp}.${req.rawBody.toString("utf8")}`;
  const expected = crypto
      .createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(signature, "hex");
  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    throw new Error("Invalid Stripe webhook signature");
  }
}

function stripeSubscriptionBusinessId(object) {
  return cleanText(
      object?.metadata?.businessId ||
      object?.client_reference_id ||
      object?.subscription_details?.metadata?.businessId ||
      "",
      120,
  );
}

function isActiveSubscriptionStatus(status) {
  return ["active", "trialing"].includes(String(status || ""));
}

function isInactiveSubscriptionStatus(status) {
  return [
    "canceled",
    "incomplete_expired",
    "unpaid",
    "paused",
  ].includes(String(status || ""));
}

async function updateBusinessProEntitlement({
  businessId,
  status,
  stripeCustomerId,
  stripeSubscriptionId,
  priceId,
  source,
}) {
  if (!businessId) return;
  const active = isActiveSubscriptionStatus(status);
  const inactive = isInactiveSubscriptionStatus(status);
  const plan = active ? "pro" : inactive ? "free" : undefined;
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const subscription = {
    businessId,
    source,
    status: status || "unknown",
    stripeCustomerId: stripeCustomerId || "",
    stripeSubscriptionId: stripeSubscriptionId || "",
    priceId: priceId || "",
    updatedAt: now,
  };
  const businessUpdate = {
    subscription,
    updatedAt: now,
  };
  if (plan) {
    businessUpdate.plan = plan;
    businessUpdate.entitlements = {
      aiAdvisor: active,
      featuredPlacement: active,
      prioritySupport: active,
    };
  }
  const batch = db.batch();
  batch.set(db.collection("businesses").doc(businessId), businessUpdate, {
    merge: true,
  });
  batch.set(db.collection("businessSubscriptions").doc(businessId), {
    ...subscription,
    plan: plan || "pending",
    entitlements: {
      aiAdvisor: active,
      featuredPlacement: active,
      prioritySupport: active,
    },
  }, {merge: true});
  await batch.commit();
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

function normalizePhoneAlias(value) {
  return String(value || "").replace(/\D/g, "");
}

function defaultNotificationPreferences() {
  return {
    carActivity: true,
    shipmentActivity: true,
    walletActivity: true,
    businessActivity: true,
  };
}

function normalizeNotificationPreferences(raw) {
  const defaults = defaultNotificationPreferences();
  const prefs = raw && typeof raw === "object" ? raw : {};
  return {
    carActivity: prefs.carActivity !== false && defaults.carActivity,
    shipmentActivity:
      prefs.shipmentActivity !== false && defaults.shipmentActivity,
    walletActivity: prefs.walletActivity !== false && defaults.walletActivity,
    businessActivity:
      prefs.businessActivity !== false && defaults.businessActivity,
  };
}

async function sendPreferenceNotification({
  uid,
  preferenceKey,
  title,
  body,
  data = {},
}) {
  if (!uid) return;
  const db = admin.firestore();
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) return;
  const prefs = normalizeNotificationPreferences(
      userSnap.data()?.notificationPreferences,
  );
  if (prefs[preferenceKey] === false) return;

  const tokensSnap = await db.collection("users")
      .doc(uid)
      .collection("fcmTokens")
      .where("enabled", "==", true)
      .get();
  const tokenDocs = tokensSnap.docs
      .map((doc) => ({
        id: doc.id,
        token: String(doc.data()?.token || doc.id).trim(),
      }))
      .filter((item) => item.token);
  const tokens = tokenDocs.map((item) => item.token);
  if (!tokens.length) return;

  const response = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: {title, body},
    data: Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, String(value)]),
    ),
  });

  await Promise.all(response.responses.map((item, index) => {
    if (!item.error) return Promise.resolve();
    const code = item.error.code || "";
    if (
      code.includes("registration-token-not-registered") ||
      code.includes("invalid-registration-token")
    ) {
      return db.collection("users")
          .doc(uid)
          .collection("fcmTokens")
          .doc(tokenDocs[index].id)
          .set({
            enabled: false,
            disabledAt: admin.firestore.FieldValue.serverTimestamp(),
            errorCode: code,
          }, {merge: true});
    }
    logger.warn("Push notification send failed", {uid, code});
    return Promise.resolve();
  }));
}

function statusChanged(event) {
  const before = event.data?.before.data() || {};
  const after = event.data?.after.data() || {};
  return String(before.status || "") !== String(after.status || "");
}

function userIdFrom(data, keys) {
  for (const key of keys) {
    const value = String(data?.[key] || "").trim();
    if (value) return value;
  }
  return "";
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
    country: String(data.country || "").trim(),
    state: String(data.state || "").trim(),
    postalCode: String(data.postalCode || "").trim(),
  };
}

function hasBusinessEntitlement(business, key) {
  const entitlements = business.entitlements || {};
  return business.plan === "pro" ||
    entitlements[key] === true ||
    entitlements.all === true;
}

async function buildBusinessAdvisorSummary(db, businessId) {
  const [
    cars,
    purchases,
    shipments,
    transports,
    parkedCars,
    supportRequests,
  ] = await Promise.all([
    db.collection("cars").where("businessId", "==", businessId).limit(250)
        .get(),
    db.collection("carPurchases").where("businessId", "==", businessId)
        .limit(250).get(),
    db.collection("barrelShipments").where("businessId", "==", businessId)
        .limit(250).get(),
    db.collection("transportRequests").where("businessId", "==", businessId)
        .limit(250).get(),
    db.collection("parkedCars").where("businessId", "==", businessId)
        .limit(250).get(),
    db.collection("businessSupportRequests")
        .where("businessId", "==", businessId)
        .limit(100).get(),
  ]);

  const carRows = cars.docs.map((doc) => doc.data() || {});
  const purchaseRows = purchases.docs.map((doc) => doc.data() || {});
  const shipmentRows = shipments.docs.map((doc) => doc.data() || {});
  const transportRows = transports.docs.map((doc) => doc.data() || {});
  const parkedRows = parkedCars.docs.map((doc) => doc.data() || {});
  const supportRows = supportRequests.docs.map((doc) => doc.data() || {});

  return {
    generatedAt: new Date().toISOString(),
    listings: {
      total: carRows.length,
      byStatus: countsBy(carRows, "status"),
      activeInventoryValue: sumNumber(
          carRows.filter((row) => row.status === "active"),
          "price",
      ),
      missingPhotos: carRows.filter((row) =>
        !Array.isArray(row.imageUrls) || row.imageUrls.length === 0,
      ).length,
      missingDescription: carRows.filter((row) =>
        !String(row.description || "").trim(),
      ).length,
    },
    purchases: {
      total: purchaseRows.length,
      byStatus: countsBy(purchaseRows, "purchaseStatus"),
      holdDeposits: sumNumber(purchaseRows, "depositAmount"),
      pendingExtensions: purchaseRows.filter((row) =>
        row.extensionRequestStatus === "pending",
      ).length,
    },
    operations: {
      barrelShipments: {
        total: shipmentRows.length,
        byStatus: countsBy(shipmentRows, "status"),
      },
      transportRequests: {
        total: transportRows.length,
        byStatus: countsBy(transportRows, "status"),
      },
      parkedCars: {
        total: parkedRows.length,
        byStatus: countsBy(parkedRows, "status"),
      },
    },
    support: {
      total: supportRows.length,
      byStatus: countsBy(supportRows, "status"),
      urgent: supportRows.filter((row) =>
        ["urgent", "blocked"].includes(row.priority),
      ).length,
    },
  };
}

function countsBy(rows, field) {
  return rows.reduce((counts, row) => {
    const value = String(row[field] || "unknown").trim() || "unknown";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function sumNumber(rows, field) {
  return rows.reduce((sum, row) => {
    const amount = Number(row[field] || 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

async function callAnthropicAdvisor({model, businessId, business, summary}) {
  const apiKey = cleanText(anthropicApiKey.value(), 240);
  if (!apiKey.startsWith("sk-ant-")) {
    throw new HttpsError(
        "failed-precondition",
        "Anthropic API key is not configured",
    );
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1400,
      system:
        "You are a concise business operations advisor for Laawol Digital. " +
        "Return JSON only with a cards array. Each card must have title, " +
        "severity, finding, and recommendation. Do not expose private totals " +
        "outside this business context.",
      messages: [{
        role: "user",
        content: JSON.stringify({
          businessId,
          businessName: business.name || businessId,
          plan: business.plan || "free",
          enabledServices: business.enabledServices || [],
          summary,
        }),
      }],
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    logger.error("Anthropic advisor request failed", data);
    throw new HttpsError(
        "internal",
        data.error?.message || "AI advisor request failed",
    );
  }
  const rawText = (data.content || [])
      .map((part) => part?.text || "")
      .join("\n")
      .trim();
  return {
    rawText,
    cards: parseAdvisorCards(rawText),
  };
}

function parseAdvisorCards(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed.cards)) {
      return parsed.cards.slice(0, 8).map(normalizeAdvisorCard);
    }
  } catch (error) {
    logger.warn("Advisor response was not strict JSON", error);
  }
  return rawText
      .split(/\n{2,}/)
      .map((chunk, index) => ({
        title: `Recommendation ${index + 1}`,
        severity: "medium",
        finding: chunk.slice(0, 240),
        recommendation: chunk.slice(0, 600),
      }))
      .filter((card) => card.finding)
      .slice(0, 5);
}

function normalizeAdvisorCard(card) {
  return {
    title: cleanText(card?.title, 120) || "Recommendation",
    severity: cleanText(card?.severity, 40) || "medium",
    finding: cleanText(card?.finding, 500),
    recommendation: cleanText(card?.recommendation, 900),
  };
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
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
  country,
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
        businessCountry: country || "",
        businessState: state || "",
        businessPostalCode: postalCode || "",
        businessStatus,
        updatedAt: now,
      },
    });
  });

  const snapshotCollections = [
    "cars",
    "barrelShipments",
    "transportRequests",
    "parkedCars",
    "carPurchases",
  ];
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
          businessCountry: country || "",
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

exports.reviewWalletRefundRequest = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const adminUid = requireAuth(request);
      const adminUser = await getUserProfile(adminUid);
      requireAdminCapability(
          adminUser,
          "finance",
          "Only finance admins can review wallet refund requests",
      );

      const requestId = String(request.data?.requestId || "").trim();
      const decision = String(request.data?.decision || "").trim();
      const note = String(request.data?.note || "").trim();
      if (!requestId) {
        throw new HttpsError("invalid-argument", "Request ID is required");
      }
      if (!["completed", "rejected"].includes(decision)) {
        throw new HttpsError(
            "invalid-argument",
            "Decision must be completed or rejected",
        );
      }

      const db = admin.firestore();
      const requestRef = db.collection("walletRefundRequests").doc(requestId);
      const requestDoc = await requestRef.get();
      if (!requestDoc.exists) {
        throw new HttpsError("not-found", "Refund request not found");
      }
      const requestData = requestDoc.data() || {};
      const customerUid = String(requestData.customerUid || "").trim();
      if (!customerUid) {
        throw new HttpsError(
            "failed-precondition",
            "Refund request is missing a customer",
        );
      }

      const walletRef = db.collection("wallets").doc(customerUid);
      const transactionSnapshot = await walletRef
          .collection("transactions")
          .where("refundRequestId", "==", requestId)
          .limit(1)
          .get();
      const debitRef = transactionSnapshot.empty ?
        null :
        transactionSnapshot.docs[0].ref;

      await db.runTransaction(async (transaction) => {
        const freshRequestDoc = await transaction.get(requestRef);
        if (!freshRequestDoc.exists) {
          throw new HttpsError("not-found", "Refund request not found");
        }
        const freshRequest = freshRequestDoc.data() || {};
        if (freshRequest.status !== "pending") {
          throw new HttpsError(
              "failed-precondition",
              "Only pending refund requests can be reviewed",
          );
        }

        const amountCents = Number(freshRequest.amountCents || 0);
        if (!Number.isFinite(amountCents) || amountCents <= 0) {
          throw new HttpsError(
              "failed-precondition",
              "Refund request amount is invalid",
          );
        }
        const amount = dollarsFromCents(amountCents);
        const currency = freshRequest.currency || SHIPMENT_CURRENCY;
        const now = admin.firestore.FieldValue.serverTimestamp();

        const walletUpdate = {
          customerUid,
          currency,
          pendingRefundCents: admin.firestore.FieldValue.increment(
              -amountCents,
          ),
          pendingRefund: admin.firestore.FieldValue.increment(-amount),
          updatedAt: now,
        };
        if (decision === "rejected") {
          walletUpdate.balanceCents = admin.firestore.FieldValue.increment(
              amountCents,
          );
          walletUpdate.balance = admin.firestore.FieldValue.increment(amount);
        }
        transaction.set(walletRef, walletUpdate, {merge: true});

        transaction.update(requestRef, {
          status: decision,
          reviewedAt: now,
          reviewedBy: adminUid,
          reviewNote: note,
          updatedAt: now,
        });
        setAdminAuditLog(transaction, {
          action: "wallet_refund_reviewed",
          actorUid: adminUid,
          targetCollection: "walletRefundRequests",
          targetId: requestId,
          targetLabel: `${currency} ${amount}`,
          statusField: "status",
          previousValue: freshRequest.status || "",
          nextValue: decision,
        });

        if (debitRef) {
          transaction.update(debitRef, {
            status: decision,
            reviewedAt: now,
            reviewedBy: adminUid,
          });
        }

        if (decision === "rejected") {
          const creditRef = walletRef.collection("transactions").doc();
          transaction.set(creditRef, {
            type: "credit",
            reason: "card_refund_rejected",
            amountCents,
            amount,
            currency,
            refundRequestId: requestId,
            createdAt: now,
            createdBy: adminUid,
          });
        }
      });

      return {
        success: true,
        requestId,
        status: decision,
      };
    },
);

exports.sendBusinessSupportRequest = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const adminUid = requireAuth(request);
      const adminUser = await getUserProfile(adminUid);
      requireAdminCapability(
          adminUser,
          "support",
          "Only support admins can message businesses",
      );

      const businessId = cleanText(request.data?.businessId, 120);
      const priority = cleanText(request.data?.priority, 32) || "normal";
      const subject = cleanText(request.data?.subject, 160);
      const message = cleanText(request.data?.message, 4000);
      const customerName = cleanText(request.data?.customerName, 160);
      const customerEmail = cleanText(request.data?.customerEmail, 240);
      const customerPhone = cleanText(request.data?.customerPhone, 40);
      const relatedCollection = cleanText(
          request.data?.relatedCollection,
          120,
      );
      const relatedId = cleanText(request.data?.relatedId, 180);
      const relatedLabel = cleanText(request.data?.relatedLabel, 220);
      const allowedPriorities = ["normal", "urgent", "blocked"];

      if (!businessId || !subject || !message) {
        throw new HttpsError(
            "invalid-argument",
            "Business, subject, and message are required",
        );
      }
      if (!allowedPriorities.includes(priority)) {
        throw new HttpsError("invalid-argument", "Invalid request priority");
      }
      if (customerEmail && !isValidEmail(customerEmail)) {
        throw new HttpsError(
            "invalid-argument",
            "Customer email must be valid",
        );
      }
      if (customerPhone) {
        requireValidPhoneNumber(customerPhone, "Customer phone");
      }

      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }
      const business = businessDoc.data() || {};
      const now = admin.firestore.FieldValue.serverTimestamp();
      const requestRef = db.collection("businessSupportRequests").doc();
      const notificationRef = db.collection("platformNotifications").doc();
      const actorLabel = adminUser.fullName || adminUser.email || adminUid;
      const businessName = business.name || businessId;
      const payload = {
        businessId,
        businessName,
        businessEmail: business.email || "",
        businessPhone: business.phone || "",
        priority,
        subject,
        message,
        status: "open",
        customerName,
        customerEmail,
        customerPhone,
        relatedCollection,
        relatedId,
        relatedLabel,
        source: "admin_console",
        createdAt: now,
        createdBy: adminUid,
        createdByName: actorLabel,
        createdByEmail: adminUser.email || "",
        updatedAt: now,
      };

      const batch = db.batch();
      batch.set(requestRef, payload);
      batch.set(notificationRef, {
        type: "business_support_request",
        status: "unread",
        businessId,
        businessName,
        title: `Support request: ${subject}`,
        message,
        priority,
        supportRequestId: requestRef.id,
        relatedCollection,
        relatedId,
        relatedLabel,
        createdAt: now,
        createdBy: adminUid,
        updatedAt: now,
      });
      setAdminAuditLog(batch, {
        action: "business_support_request_sent",
        actorUid: adminUid,
        targetCollection: "businessSupportRequests",
        targetId: requestRef.id,
        targetLabel: `${businessName}: ${subject}`,
        nextValue: priority,
      });
      await batch.commit();

      return {
        success: true,
        requestId: requestRef.id,
        businessId,
      };
    },
);

exports.requestBusinessSupport = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const businessId = cleanText(request.data?.businessId, 120);
      const priority = cleanText(request.data?.priority, 32) || "normal";
      const subject = cleanText(request.data?.subject, 160);
      const message = cleanText(request.data?.message, 4000);
      const customerName = cleanText(request.data?.customerName, 160);
      const customerEmail = cleanText(request.data?.customerEmail, 240);
      const customerPhone = cleanText(request.data?.customerPhone, 40);
      const relatedCollection = cleanText(
          request.data?.relatedCollection,
          120,
      );
      const relatedId = cleanText(request.data?.relatedId, 180);
      const relatedLabel = cleanText(request.data?.relatedLabel, 220);
      const allowedPriorities = ["normal", "urgent", "blocked"];

      if (!businessId || !subject || !message) {
        throw new HttpsError(
            "invalid-argument",
            "Business, subject, and message are required",
        );
      }
      if (!allowedPriorities.includes(priority)) {
        throw new HttpsError("invalid-argument", "Invalid request priority");
      }
      if (customerEmail && !isValidEmail(customerEmail)) {
        throw new HttpsError(
            "invalid-argument",
            "Customer email must be valid",
        );
      }
      if (customerPhone) {
        requireValidPhoneNumber(customerPhone, "Customer phone");
      }

      const callerUser = await requireBusinessPermission(
          callerUid,
          businessId,
          "support",
      );
      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }
      const business = businessDoc.data() || {};
      const now = admin.firestore.FieldValue.serverTimestamp();
      const requestRef = db.collection("businessSupportRequests").doc();
      const notificationRef = db.collection("platformNotifications").doc();
      const actorLabel =
        callerUser.fullName || callerUser.email || callerUid;
      const businessName = business.name || callerUser.businessName ||
        businessId;
      const payload = {
        businessId,
        businessName,
        businessEmail: business.email || "",
        businessPhone: business.phone || "",
        priority,
        subject,
        message,
        status: "open",
        customerName,
        customerEmail,
        customerPhone,
        relatedCollection,
        relatedId,
        relatedLabel,
        source: "business_console",
        createdAt: now,
        createdBy: callerUid,
        createdByName: actorLabel,
        createdByEmail: callerUser.email || "",
        updatedAt: now,
      };

      const batch = db.batch();
      batch.set(requestRef, payload);
      batch.set(notificationRef, {
        type: "business_support_request",
        status: "unread",
        businessId,
        businessName,
        title: `Business support: ${subject}`,
        message,
        priority,
        supportRequestId: requestRef.id,
        relatedCollection,
        relatedId,
        relatedLabel,
        createdAt: now,
        createdBy: callerUid,
        updatedAt: now,
      });
      setAdminAuditLog(batch, {
        action: "business_support_request_created",
        actorUid: callerUid,
        targetCollection: "businessSupportRequests",
        targetId: requestRef.id,
        targetLabel: `${businessName}: ${subject}`,
        nextValue: priority,
      });
      await batch.commit();

      return {
        success: true,
        requestId: requestRef.id,
        businessId,
      };
    },
);

exports.createBusinessProCheckout = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey, businessProPriceId],
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const businessId = cleanText(request.data?.businessId, 120);
      const successUrl = requireValidWebsite(
          cleanText(request.data?.successUrl, 600),
      );
      const cancelUrl = requireValidWebsite(
          cleanText(request.data?.cancelUrl, 600),
      );
      if (!businessId) {
        throw new HttpsError("invalid-argument", "Business is required");
      }

      const caller = await requireBusinessManager(callerUid, businessId);
      if (caller.role !== "admin" && caller.role !== "businessOwner") {
        throw new HttpsError(
            "permission-denied",
            "Only business owners can start a subscription",
        );
      }

      const priceId = cleanText(businessProPriceId.value(), 160);
      if (!priceId.startsWith("price_")) {
        throw new HttpsError(
            "failed-precondition",
            "Business Pro price is not configured",
        );
      }

      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }
      const business = businessDoc.data() || {};
      const session = await createStripeCheckoutSession({
        businessId,
        priceId,
        successUrl,
        cancelUrl,
        customerEmail: business.email || caller.email || "",
        metadata: {
          businessId,
          businessName: business.name || businessId,
          feature: "business_pro",
          priceId,
        },
      });

      await businessRef.set({
        subscription: {
          checkoutSessionId: session.id,
          status: "checkout_started",
          priceId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: callerUid,
        },
      }, {merge: true});

      return {
        success: true,
        sessionId: session.id,
        url: session.url,
      };
    },
);

exports.handleBusinessProStripeWebhook = onRequest(
    {
      cors: false,
      secrets: [stripeWebhookSecret],
    },
    async (req, res) => {
      if (req.method !== "POST") {
        res.status(405).send("Method not allowed");
        return;
      }
      try {
        verifyStripeWebhookSignature(req, stripeWebhookSecret.value());
      } catch (error) {
        logger.warn("Rejected Stripe webhook", {message: error.message});
        res.status(400).send("Invalid Stripe signature");
        return;
      }

      let event;
      try {
        event = JSON.parse(req.rawBody.toString("utf8"));
      } catch (error) {
        res.status(400).send("Invalid JSON");
        return;
      }

      const object = event?.data?.object || {};
      try {
        if (event.type === "checkout.session.completed") {
          const businessId = stripeSubscriptionBusinessId(object);
          const status = object.payment_status === "unpaid" ?
            "incomplete" :
            "active";
          await updateBusinessProEntitlement({
            businessId,
            status,
            stripeCustomerId: object.customer,
            stripeSubscriptionId: object.subscription,
            priceId: object.metadata?.priceId || "",
            source: event.type,
          });
        } else if (
          event.type === "customer.subscription.created" ||
          event.type === "customer.subscription.updated" ||
          event.type === "customer.subscription.deleted"
        ) {
          const businessId = stripeSubscriptionBusinessId(object);
          const priceId = object.items?.data?.[0]?.price?.id || "";
          await updateBusinessProEntitlement({
            businessId,
            status: object.status,
            stripeCustomerId: object.customer,
            stripeSubscriptionId: object.id,
            priceId,
            source: event.type,
          });
        } else if (event.type === "invoice.payment_failed") {
          const businessId = stripeSubscriptionBusinessId(object);
          await updateBusinessProEntitlement({
            businessId,
            status: "past_due",
            stripeCustomerId: object.customer,
            stripeSubscriptionId: object.subscription,
            priceId: "",
            source: event.type,
          });
        }
        res.status(200).json({received: true});
      } catch (error) {
        logger.error("Business Pro webhook failed", {
          type: event.type,
          message: error.message,
        });
        res.status(500).send("Webhook handling failed");
      }
    },
);

exports.generateBusinessInsights = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [anthropicApiKey],
      timeoutSeconds: 120,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const businessId = cleanText(request.data?.businessId, 120);
      if (!businessId) {
        throw new HttpsError("invalid-argument", "Business is required");
      }
      await requireBusinessPermission(callerUid, businessId, "growth");

      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }
      const business = businessDoc.data() || {};
      if (!hasBusinessEntitlement(business, "aiAdvisor")) {
        throw new HttpsError(
            "failed-precondition",
            "AI Business Advisor requires a Pro plan",
        );
      }

      const summary = await buildBusinessAdvisorSummary(db, businessId);
      const model = cleanText(
          request.data?.model || business.aiAdvisorModel ||
          DEFAULT_BUSINESS_ADVISOR_MODEL,
          120,
      );
      const insight = await callAnthropicAdvisor({
        model,
        businessId,
        business,
        summary,
      });

      const insightRef = db.collection("businessInsights").doc();
      const payload = {
        businessId,
        businessName: business.name || businessId,
        model,
        summary,
        cards: insight.cards,
        rawText: insight.rawText,
        status: "ready",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdBy: callerUid,
      };
      await insightRef.set(payload);

      return {
        success: true,
        insightId: insightRef.id,
        ...payload,
      };
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
        country,
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
        country,
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

exports.createAdminBusiness = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const adminUid = requireAuth(request);
      const adminUser = await getUserProfile(adminUid);
      requireAdminCapability(
          adminUser,
          "businesses",
          "Only operations admins can create businesses",
      );

      const {
        name,
        phone,
        email,
        website,
        profileImageUrl,
        profileImagePath,
        serviceNote,
        addressLine1,
        city,
        country,
        state,
        postalCode,
        enabledServices,
      } = request.data || {};
      const status = String(request.data?.status || "pending").trim();
      const profile = businessPublicFields({
        name,
        phone,
        email,
        website,
        profileImageUrl,
        profileImagePath,
        serviceNote,
        addressLine1,
        city,
        country,
        state,
        postalCode,
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
      if (!ADMIN_BUSINESS_STATUSES.includes(status)) {
        throw new HttpsError("invalid-argument", "Invalid business status");
      }
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

      const db = admin.firestore();
      const businessId = String(
          request.data?.businessId || slugFromName(profile.name),
      ).trim();
      const businessRef = db.collection("businesses").doc(businessId);
      const existing = await businessRef.get();
      if (existing.exists) {
        throw new HttpsError(
            "already-exists",
            "A business with this ID already exists",
        );
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const batch = db.batch();
      batch.set(businessRef, {
        ...profile,
        enabledServices: normalizedServices,
        status,
        applicationStatus: status,
        createdAt: now,
        createdBy: adminUid,
        updatedAt: now,
        updatedBy: adminUid,
      });
      setAdminAuditLog(batch, {
        action: "business_created",
        actorUid: adminUid,
        targetCollection: "businesses",
        targetId: businessId,
        targetLabel: profile.name,
        nextValue: status,
      });
      await batch.commit();

      return {
        success: true,
        businessId,
        businessName: profile.name,
        status,
        enabledServices: normalizedServices,
      };
    },
);

exports.createMissingBusinessProfile = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const adminUid = requireAuth(request);
      const adminUser = await getUserProfile(adminUid);
      requireAdminCapability(
          adminUser,
          "businesses",
          "Only operations admins can create business profiles",
      );

      const businessId = String(request.data?.businessId || "").trim();
      if (!businessId) {
        throw new HttpsError("invalid-argument", "Business ID is required");
      }
      const status = String(request.data?.status || "approved").trim();
      if (!ADMIN_BUSINESS_STATUSES.includes(status)) {
        throw new HttpsError("invalid-argument", "Invalid business status");
      }
      const profile = businessPublicFields({
        name: request.data?.name || businessId,
        phone: request.data?.phone,
        email: request.data?.email,
        serviceNote:
          request.data?.serviceNote ||
          "Created from existing marketplace or operations records.",
      });
      const normalizedServices = normalizeBusinessServices(
          request.data?.enabledServices,
      );
      if (profile.phone) {
        requireValidPhoneNumber(profile.phone, "Business phone");
      }
      if (profile.email && !isValidEmail(profile.email)) {
        throw new HttpsError(
            "invalid-argument",
            "Please enter a valid business email",
        );
      }

      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (businessDoc.exists) {
        throw new HttpsError(
            "already-exists",
            "Business profile already exists",
        );
      }
      const now = admin.firestore.FieldValue.serverTimestamp();
      const batch = db.batch();
      batch.set(businessRef, {
        ...profile,
        enabledServices: normalizedServices,
        status,
        applicationStatus: status,
        createdAt: now,
        createdBy: adminUid,
        updatedAt: now,
        updatedBy: adminUid,
      }, {merge: true});
      setAdminAuditLog(batch, {
        action: "business_profile_created",
        actorUid: adminUid,
        targetCollection: "businesses",
        targetId: businessId,
        targetLabel: profile.name,
        nextValue: status,
      });
      await batch.commit();

      await propagateBusinessSnapshot({
        businessId,
        businessName: profile.name,
        businessStatus: status,
        phone: profile.phone,
        email: profile.email,
        website: profile.website,
        profileImageUrl: profile.profileImageUrl,
        profileImagePath: profile.profileImagePath,
        enabledServices: normalizedServices,
        serviceNote: profile.serviceNote,
        addressLine1: profile.addressLine1,
        city: profile.city,
        country: profile.country,
        state: profile.state,
        postalCode: profile.postalCode,
      });

      return {success: true, businessId, status};
    },
);

exports.updateAdminRecordStatus = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const adminUid = requireAuth(request);
      const adminUser = await getUserProfile(adminUid);
      const collectionName =
        String(request.data?.collectionName || "").trim();
      const recordId = String(request.data?.recordId || "").trim();
      const nextStatus = String(request.data?.status || "").trim();
      if (!collectionName || !recordId || !nextStatus) {
        throw new HttpsError(
            "invalid-argument",
            "Collection, record, and status are required",
        );
      }
      const config = statusConfigForCollection(collectionName);
      requireAdminCapability(
          adminUser,
          config.capability,
          "This admin role cannot update that record",
      );
      requireServiceAccessForCollection(
          adminUser,
          collectionName,
          "Your role is limited to other services",
      );
      if (!config.allowedStatuses.includes(nextStatus)) {
        throw new HttpsError("invalid-argument", "Invalid status");
      }

      const db = admin.firestore();
      const recordRef = db.collection(collectionName).doc(recordId);
      const recordDoc = await recordRef.get();
      if (!recordDoc.exists) {
        throw new HttpsError("not-found", "Record not found");
      }
      const current = recordDoc.data() || {};
      const previousStatus = current[config.statusField] || "";
      const batch = db.batch();
      batch.update(recordRef, statusUpdatePayload({
        statusField: config.statusField,
        previousStatus,
        nextStatus,
        uid: adminUid,
      }));
      setAdminAuditLog(batch, {
        action: "status_change",
        actorUid: adminUid,
        targetCollection: collectionName,
        targetId: recordId,
        targetLabel: adminRecordLabel(collectionName, recordId, current),
        statusField: config.statusField,
        previousValue: String(previousStatus || ""),
        nextValue: nextStatus,
      });
      await batch.commit();

      if (collectionName === "businesses") {
        await propagateBusinessSnapshot({
          businessId: recordId,
          businessName: current.name || recordId,
          businessStatus: nextStatus,
          phone: current.phone,
          email: current.email,
          website: current.website,
          profileImageUrl: current.profileImageUrl,
          profileImagePath: current.profileImagePath,
          enabledServices: normalizeBusinessServices(current.enabledServices),
          serviceNote: current.serviceNote,
          addressLine1: current.addressLine1,
          city: current.city,
          country: current.country,
          state: current.state,
          postalCode: current.postalCode,
        });
      }

      return {
        success: true,
        collectionName,
        recordId,
        statusField: config.statusField,
        previousStatus,
        nextStatus,
      };
    },
);

exports.deleteAdminRecord = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const adminUid = requireAuth(request);
      const adminUser = await getUserProfile(adminUid);
      requireSuperAdmin(
          adminUser,
          "Only super admins can delete platform records",
      );

      const collectionName =
        String(request.data?.collectionName || "").trim();
      const recordId = String(request.data?.recordId || "").trim();
      if (!collectionName || !recordId) {
        throw new HttpsError(
            "invalid-argument",
            "Collection and record are required",
        );
      }
      statusConfigForCollection(collectionName);

      const db = admin.firestore();
      const recordRef = db.collection(collectionName).doc(recordId);
      const recordDoc = await recordRef.get();
      if (!recordDoc.exists) {
        throw new HttpsError("not-found", "Record not found");
      }
      const current = recordDoc.data() || {};
      const batch = db.batch();
      batch.delete(recordRef);
      setAdminAuditLog(batch, {
        action: "record_deleted",
        actorUid: adminUid,
        targetCollection: collectionName,
        targetId: recordId,
        targetLabel: adminRecordLabel(collectionName, recordId, current),
      });
      await batch.commit();
      return {success: true, collectionName, recordId};
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
      requireAdminCapability(
          adminUser,
          "businesses",
          "Only operations admins can review business applications",
      );

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
      setAdminAuditLog(batch, {
        action: "business_application_reviewed",
        actorUid: adminUid,
        targetCollection: "businesses",
        targetId: businessId,
        targetLabel: profile.name,
        statusField: "status",
        previousValue: current.status || "",
        nextValue: nextStatus,
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
        country: profile.country,
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
        country,
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
        country: country ?? current.country,
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
        country: profile.country,
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

        const callerCanCreateStaff =
          hasAdminCapability(callerData, "operations") ||
          (
            callerData.role === "businessOwner" &&
            callerData.businessId === requestedBusinessId
          );
        if (!callerCanCreateStaff) {
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
          businessPermissions,
        } = request.data;
        const normalizedEmail = String(email || "").trim().toLowerCase();
        const staffName = String(fullName || "").trim();
        const staffPhone = String(phone || "").trim();
        const staffPermissions =
          normalizeBusinessPermissions(businessPermissions);

        // Validate input
        if (!normalizedEmail || !password) {
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
        if (staffPhone) {
          requireValidPhoneNumber(staffPhone, "Staff phone");
        }

        // Create the new user using Admin SDK
        const userRecord = await admin.auth().createUser({
          email: normalizedEmail,
          password: password,
          displayName: staffName || undefined,
        });

        logger.info("User created in Firebase Auth", {
          uid: userRecord.uid,
          email: userRecord.email,
        });

        // Create the user document in Firestore with staff role
        const db = admin.firestore();
        const batch = db.batch();
        batch.set(db.collection("users").doc(userRecord.uid), {
          email: normalizedEmail,
          fullName: staffName,
          phone: staffPhone,
          profileImageUrl: String(profileImageUrl || "").trim(),
          profileImagePath: String(profileImagePath || "").trim(),
          role: "staff",
          businessId: requestedBusinessId,
          businessName: business.name || DEFAULT_BUSINESS_NAME,
          businessServices: normalizeBusinessServices(
              business.enabledServices,
          ),
          businessPermissions: staffPermissions,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: callerUid,
        });
        setAdminAuditLog(batch, {
          action: "staff_user_created",
          actorUid: callerUid,
          targetCollection: "users",
          targetId: userRecord.uid,
          targetLabel: normalizedEmail,
          nextValue: requestedBusinessId,
        });
        await batch.commit().catch(async (error) => {
          await admin.auth().deleteUser(userRecord.uid).catch(
              (deleteError) => {
                logger.error(
                    "Failed to roll back staff auth user",
                    deleteError,
                );
              },
          );
          throw error;
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

exports.updateBusinessStaffPermissions = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const businessId = cleanText(request.data?.businessId, 120);
      const staffUid = cleanText(request.data?.staffUid, 160);
      const permissions = normalizeBusinessPermissions(
          request.data?.businessPermissions,
      );

      if (!businessId || !staffUid) {
        throw new HttpsError(
            "invalid-argument",
            "Business and staff user are required",
        );
      }

      const callerUser = await requireBusinessManager(callerUid, businessId);
      if (callerUser.role !== "admin" && callerUser.role !== "businessOwner") {
        throw new HttpsError(
            "permission-denied",
            "Only business owners can update staff permissions",
        );
      }

      const db = admin.firestore();
      const staffRef = db.collection("users").doc(staffUid);
      const staffDoc = await staffRef.get();
      if (!staffDoc.exists) {
        throw new HttpsError("not-found", "Staff user not found");
      }
      const staff = staffDoc.data() || {};
      if (staff.businessId !== businessId || staff.role !== "staff") {
        throw new HttpsError(
            "failed-precondition",
            "This user is not staff for the selected business",
        );
      }

      const batch = db.batch();
      batch.set(staffRef, {
        businessPermissions: permissions,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: callerUid,
      }, {merge: true});
      setAdminAuditLog(batch, {
        action: "business_staff_permissions_updated",
        actorUid: callerUid,
        targetCollection: "users",
        targetId: staffUid,
        targetLabel: staff.email || staff.fullName || staffUid,
        nextValue: permissions.join(","),
      });
      await batch.commit();

      return {
        success: true,
        staffUid,
        businessPermissions: permissions,
      };
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
      requireSuperAdmin(
          caller,
          "Only super admins can create platform managers",
      );

      const {email, password, fullName, phone} = request.data;
      const adminRole = String(
          request.data?.adminRole || "operationsManager",
      ).trim();
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
      await assertAssignableRole(adminRole);

      let userRecord;
      try {
        userRecord = await admin.auth().createUser({
          email: normalizedEmail,
          password: String(password),
          displayName: managerName,
        });
        const db = admin.firestore();
        const batch = db.batch();
        batch.set(db.collection("users").doc(userRecord.uid), {
          email: normalizedEmail,
          fullName: managerName,
          phone: managerPhone,
          role: "admin",
          platformAdmin: true,
          adminRole,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: callerUid,
        });
        setAdminAuditLog(batch, {
          action: "platform_manager_created",
          actorUid: callerUid,
          targetCollection: "users",
          targetId: userRecord.uid,
          targetLabel: normalizedEmail,
          nextValue: adminRole,
        });
        await batch.commit();
        return {
          success: true,
          uid: userRecord.uid,
          email: normalizedEmail,
          role: "admin",
          adminRole,
        };
      } catch (error) {
        if (userRecord?.uid) {
          await admin.auth().deleteUser(userRecord.uid).catch(
              (deleteError) => {
                logger.error(
                    "Failed to roll back platform manager auth user",
                    deleteError,
                );
              },
          );
        }
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

exports.setPlatformAdminRole = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const caller = await getUserProfile(callerUid);
      requireSuperAdmin(
          caller,
          "Only super admins can change administrator roles",
      );

      const userId = String(request.data?.userId || "").trim();
      const adminRole = String(request.data?.adminRole || "").trim();
      if (!userId) {
        throw new HttpsError("invalid-argument", "userId is required");
      }
      await assertAssignableRole(adminRole);
      if (userId === callerUid) {
        throw new HttpsError(
            "failed-precondition",
            "You cannot change your own access role",
        );
      }

      const target = await getUserProfile(userId);
      if (target.role !== "admin") {
        throw new HttpsError(
            "failed-precondition",
            "This user is not a platform administrator",
        );
      }

      const db = admin.firestore();
      const batch = db.batch();
      batch.set(
          db.collection("users").doc(userId),
          {
            adminRole,
            platformAdmin: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: callerUid,
          },
          {merge: true},
      );
      setAdminAuditLog(batch, {
        action: "platform_admin_role_changed",
        actorUid: callerUid,
        targetCollection: "users",
        targetId: userId,
        targetLabel: target.email || userId,
        previousValue: target.adminRole || "",
        nextValue: adminRole,
      });
      await batch.commit();

      return {success: true, userId, adminRole};
    },
);

exports.listPlatformUsers = onCall(
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
            "Only platform admins can list users",
        );
      }

      const maxResults = Math.min(
          Math.max(Number(request.data?.maxResults) || 1000, 1),
          1000,
      );
      const pageToken = String(request.data?.pageToken || "") || undefined;
      const db = admin.firestore();
      const [authPage, profileSnapshot] = await Promise.all([
        admin.auth().listUsers(maxResults, pageToken),
        db.collection("users").get(),
      ]);
      const profiles = new Map();
      profileSnapshot.docs.forEach((doc) => {
        profiles.set(doc.id, {id: doc.id, ...doc.data()});
      });

      const authUids = new Set(authPage.users.map((userRecord) => {
        return userRecord.uid;
      }));
      const users = authPage.users.map((userRecord) => {
        const profile = profiles.get(userRecord.uid) || {};
        const hasProfile = profiles.has(userRecord.uid);
        return {
          id: userRecord.uid,
          uid: userRecord.uid,
          email: profile.email || userRecord.email || "",
          fullName: profile.fullName || userRecord.displayName || "",
          phone: profile.phone || userRecord.phoneNumber || "",
          profileImageUrl: profile.profileImageUrl || userRecord.photoURL || "",
          profileImagePath: profile.profileImagePath || "",
          phoneVerified: profile.phoneVerified === true,
          phoneVerifiedAt: profile.phoneVerifiedAt || "",
          role: profile.role || "missing_profile",
          adminRole: profile.adminRole || "",
          platformAdmin: profile.platformAdmin === true,
          businessId: profile.businessId || "",
          businessName: profile.businessName || "",
          disabled: userRecord.disabled,
          emailVerified: userRecord.emailVerified,
          createdAt: profile.createdAt || userRecord.metadata.creationTime,
          updatedAt: profile.updatedAt || "",
          lastSignInAt: userRecord.metadata.lastSignInTime || "",
          hasProfile,
          hasAuth: true,
        };
      });
      profileSnapshot.docs.forEach((doc) => {
        if (authUids.has(doc.id)) return;
        const profile = doc.data() || {};
        users.push({
          id: doc.id,
          uid: profile.uid || doc.id,
          email: profile.email || "",
          fullName: profile.fullName || "",
          phone: profile.phone || "",
          profileImageUrl: profile.profileImageUrl || "",
          profileImagePath: profile.profileImagePath || "",
          phoneVerified: profile.phoneVerified === true,
          phoneVerifiedAt: profile.phoneVerifiedAt || "",
          role: profile.role || "customer",
          adminRole: profile.adminRole || "",
          platformAdmin: profile.platformAdmin === true,
          businessId: profile.businessId || "",
          businessName: profile.businessName || "",
          disabled: false,
          emailVerified: null,
          createdAt: profile.createdAt || "",
          updatedAt: profile.updatedAt || "",
          lastSignInAt: "",
          hasProfile: true,
          hasAuth: false,
        });
      });

      return {
        users,
        pageToken: authPage.pageToken || "",
      };
    },
);

exports.createMissingUserProfile = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const caller = await getUserProfile(callerUid);
      requireAdminCapability(
          caller,
          "users",
          "Only user admins can create user profiles",
      );

      const userId = String(request.data?.userId || "").trim();
      if (!userId) {
        throw new HttpsError("invalid-argument", "User ID is required");
      }

      const userRecord = await admin.auth().getUser(userId);
      const now = admin.firestore.FieldValue.serverTimestamp();
      const db = admin.firestore();
      const batch = db.batch();
      batch.set(
          db.collection("users").doc(userId),
          {
            email: userRecord.email || "",
            fullName: userRecord.displayName || "",
            phone: userRecord.phoneNumber || "",
            role: "customer",
            createdAt: now,
            updatedAt: now,
            createdBy: callerUid,
          },
          {merge: true},
      );
      setAdminAuditLog(batch, {
        action: "missing_user_profile_created",
        actorUid: callerUid,
        targetCollection: "users",
        targetId: userId,
        targetLabel: userRecord.email || userId,
        nextValue: "customer",
      });
      await batch.commit();

      return {
        success: true,
        userId,
        role: "customer",
      };
    },
);

exports.updateBusinessMembership = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const caller = await getUserProfile(callerUid);
      requireSuperAdmin(
          caller,
          "Only super admins can update business membership",
      );

      const userId = String(request.data?.userId || "").trim();
      const role = String(request.data?.role || "").trim();
      const businessId = String(request.data?.businessId || "").trim();
      if (!userId || !role) {
        throw new HttpsError(
            "invalid-argument",
            "User ID and membership role are required",
        );
      }
      if (!["businessOwner", "staff", "customer"].includes(role)) {
        throw new HttpsError(
            "invalid-argument",
            "Role must be businessOwner, staff, or customer",
        );
      }
      if ((role === "businessOwner" || role === "staff") && !businessId) {
        throw new HttpsError(
            "invalid-argument",
            "Business is required for owners and staff",
        );
      }
      if (userId === callerUid) {
        throw new HttpsError(
            "invalid-argument",
            "You cannot change your own business membership",
        );
      }

      try {
        await admin.auth().getUser(userId);
      } catch (error) {
        throw new HttpsError(
            "failed-precondition",
            "Business members must have a Firebase Auth account",
        );
      }

      const db = admin.firestore();
      const userRef = db.collection("users").doc(userId);
      const userDoc = await userRef.get();
      if (!userDoc.exists) {
        throw new HttpsError(
            "not-found",
            "Create this user's profile before assigning membership",
        );
      }
      const current = userDoc.data() || {};
      const batch = db.batch();
      const now = admin.firestore.FieldValue.serverTimestamp();

      let business = null;
      if (role === "businessOwner" || role === "staff") {
        const businessDoc = await db.collection("businesses")
            .doc(businessId)
            .get();
        if (!businessDoc.exists) {
          throw new HttpsError("not-found", "Business not found");
        }
        business = businessDoc.data() || {};
        const businessName = business.name || businessId;
        if (role === "businessOwner") {
          const ownerSnapshot = await db.collection("users")
              .where("businessId", "==", businessId)
              .where("role", "==", "businessOwner")
              .get();
          ownerSnapshot.docs.forEach((ownerDoc) => {
            if (ownerDoc.id === userId) return;
            batch.update(ownerDoc.ref, {
              role: "staff",
              businessName,
              businessServices: normalizeBusinessServices(
                  business.enabledServices,
              ),
              updatedAt: now,
              updatedBy: callerUid,
            });
            const owner = ownerDoc.data() || {};
            setAdminAuditLog(batch, {
              action: "business_owner_demoted",
              actorUid: callerUid,
              targetCollection: "users",
              targetId: ownerDoc.id,
              targetLabel: owner.email || owner.fullName || ownerDoc.id,
              statusField: "role",
              previousValue: "businessOwner",
              nextValue: "staff",
            });
          });
        }
        batch.update(userRef, {
          role,
          businessId,
          businessName,
          businessServices: normalizeBusinessServices(business.enabledServices),
          platformAdmin: admin.firestore.FieldValue.delete(),
          adminRole: admin.firestore.FieldValue.delete(),
          updatedAt: now,
          updatedBy: callerUid,
        });
      } else {
        batch.update(userRef, {
          role: "customer",
          businessId: admin.firestore.FieldValue.delete(),
          businessName: admin.firestore.FieldValue.delete(),
          businessServices: admin.firestore.FieldValue.delete(),
          platformAdmin: admin.firestore.FieldValue.delete(),
          adminRole: admin.firestore.FieldValue.delete(),
          updatedAt: now,
          updatedBy: callerUid,
        });
      }

      setAdminAuditLog(batch, {
        action: "business_membership_updated",
        actorUid: callerUid,
        targetCollection: "users",
        targetId: userId,
        targetLabel: current.email || current.fullName || userId,
        statusField: "role",
        previousValue: current.role || "",
        nextValue: role === "customer" ? "customer" : `${role}:${businessId}`,
      });
      await batch.commit();

      return {
        success: true,
        userId,
        role,
        businessId: role === "customer" ? "" : businessId,
      };
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

        requireSuperAdmin(
            callerData,
            "Only super admins can update user roles",
        );

        // Extract details from the request
        const {userId, newRole} = request.data;

        // Validate input
        if (!userId || !newRole) {
          throw new HttpsError(
              "invalid-argument",
              "User ID and new role are required",
          );
        }

        if (userId === callerUid && newRole !== "admin") {
          throw new HttpsError(
              "invalid-argument",
              "You cannot change your own admin role",
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
        if (newRole === "staff" || newRole === "businessOwner") {
          throw new HttpsError(
              "invalid-argument",
              "Use updateBusinessMembership to assign business roles",
          );
        }

        const db = admin.firestore();
        const userRef = db.collection("users").doc(userId);
        const targetDoc = await userRef.get();
        if (!targetDoc.exists) {
          throw new HttpsError("not-found", "User profile not found");
        }
        const target = targetDoc.data() || {};
        const batch = db.batch();
        const updatePayload = {
          role: newRole,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: callerUid,
        };
        if (newRole === "customer" || newRole === "admin") {
          updatePayload.businessId = admin.firestore.FieldValue.delete();
          updatePayload.businessName = admin.firestore.FieldValue.delete();
          updatePayload.businessServices = admin.firestore.FieldValue.delete();
        }
        if (newRole === "customer") {
          updatePayload.platformAdmin = admin.firestore.FieldValue.delete();
          updatePayload.adminRole = admin.firestore.FieldValue.delete();
        }
        if (newRole === "admin") {
          updatePayload.platformAdmin = true;
          updatePayload.adminRole = target.adminRole || "supportAdmin";
        }
        batch.update(userRef, updatePayload);
        setAdminAuditLog(batch, {
          action: "user_role_updated",
          actorUid: callerUid,
          targetCollection: "users",
          targetId: userId,
          targetLabel: target.email || target.fullName || userId,
          statusField: "role",
          previousValue: target.role || "",
          nextValue: newRole,
        });
        await batch.commit();

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
        requireSuperAdmin(
            callerData,
            "Only super admins can delete users",
        );

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

        const db = admin.firestore();
        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();
        const target = userDoc.data() || {};

        // Delete from Firebase Auth
        await admin.auth().deleteUser(userId);

        logger.info("User deleted from Firebase Auth", {userId: userId});

        const batch = db.batch();
        batch.delete(userRef);
        setAdminAuditLog(batch, {
          action: "user_deleted",
          actorUid: callerUid,
          targetCollection: "users",
          targetId: userId,
          targetLabel: target.email || target.fullName || userId,
        });
        await batch.commit();

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
      if (user.role === "admin") {
        requireAdminCapability(
            user,
            "marketplace",
            "Only marketplace admins can seed destination countries",
        );
      }
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
      await requireBusinessPermission(callerUid, businessId, "destinations");
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

exports.listDestinationCoverage = onCall(
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
            "Only platform admins can list destination coverage",
        );
      }

      const db = admin.firestore();
      const businesses = await db.collection("businesses").get();
      const rows = [];
      for (const businessDoc of businesses.docs) {
        const business = businessDoc.data() || {};
        const destinations = await businessDoc.ref
            .collection("destinationCountries")
            .get();
        destinations.docs.forEach((destinationDoc) => {
          rows.push({
            id: destinationDoc.id,
            businessId: businessDoc.id,
            businessName: business.name || businessDoc.id,
            businessStatus: business.status || "",
            ...destinationDoc.data(),
          });
        });
      }

      rows.sort((a, b) => {
        const businessCompare = String(a.businessName || "").localeCompare(
            String(b.businessName || ""),
        );
        if (businessCompare !== 0) return businessCompare;
        return Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
      });

      return {destinations: rows};
    },
);

exports.updateDestinationCoverage = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const user = await getUserProfile(callerUid);
      requireAdminCapability(
          user,
          "marketplace",
          "Only marketplace admins can update destination coverage",
      );

      const businessId = String(request.data?.businessId || "").trim();
      const countryId = String(request.data?.countryId || "").trim();
      const isActive = request.data?.isActive === true;
      const price = Number(request.data?.barrelShippingPrice || 0);
      const minDaysRaw = request.data?.deliveryEstimateMinDays;
      const maxDaysRaw = request.data?.deliveryEstimateMaxDays;
      const destinationNote = String(
          request.data?.destinationNote ||
          request.data?.details ||
          "",
      ).trim();
      const hasEstimate = minDaysRaw !== null &&
        minDaysRaw !== undefined &&
        maxDaysRaw !== null &&
        maxDaysRaw !== undefined;
      const minDays = Number(minDaysRaw);
      const maxDays = Number(maxDaysRaw);

      if (!businessId || !countryId) {
        throw new HttpsError(
            "invalid-argument",
            "Business and destination are required",
        );
      }
      if (!Number.isFinite(price) || price < 0) {
        throw new HttpsError(
            "invalid-argument",
            "Barrel shipping price must be zero or more",
        );
      }
      if (isActive && price <= 0) {
        throw new HttpsError(
            "invalid-argument",
            "Active destinations need a barrel shipping fee greater than 0",
        );
      }
      if (
        hasEstimate &&
        (
          !Number.isInteger(minDays) ||
          !Number.isInteger(maxDays) ||
          minDays <= 0 ||
          maxDays < minDays
        )
      ) {
        throw new HttpsError(
            "invalid-argument",
            "Delivery days must be positive whole numbers",
        );
      }

      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }
      const business = businessDoc.data() || {};
      const destinationRef = businessRef
          .collection("destinationCountries")
          .doc(countryId);
      const payload = {
        businessId,
        businessName: business.name || businessId,
        businessPhone: business.phone || "",
        businessEmail: business.email || "",
        businessWebsite: business.website || "",
        businessProfileImageUrl: business.profileImageUrl || "",
        enabledServices: normalizeBusinessServices(business.enabledServices),
        serviceNote: business.serviceNote || "",
        businessStatus: business.status || "",
        barrelShippingPrice: price,
        isActive,
        destinationNote: destinationNote ||
          admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (hasEstimate) {
        payload.deliveryEstimateMinDays = minDays;
        payload.deliveryEstimateMaxDays = maxDays;
      } else {
        payload.deliveryEstimateMinDays =
          admin.firestore.FieldValue.delete();
        payload.deliveryEstimateMaxDays =
          admin.firestore.FieldValue.delete();
      }
      const previousDoc = await destinationRef.get();
      const previous = previousDoc.data() || {};
      const batch = db.batch();
      batch.set(destinationRef, payload, {merge: true});
      setAdminAuditLog(batch, {
        action: "destination_coverage_updated",
        actorUid: callerUid,
        targetCollection: "businesses",
        targetId: `${businessId}/destinationCountries/${countryId}`,
        targetLabel: `${business.name || businessId} ${countryId}`,
        previousValue:
          `${previous.isActive === true}:${previous.barrelShippingPrice || 0}`,
        nextValue: `${isActive}:${price}`,
      });
      await batch.commit();

      return {
        success: true,
        businessId,
        countryId,
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
      requireSuperAdmin(
          user,
          "Only super admins can run this migration",
      );

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
          const data = doc.data() || {};
          if (cleanText(data.businessId, 120)) return;
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

exports.backfillBusinessCarListings = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const user = await getUserProfile(callerUid);
      requireSuperAdmin(
          user,
          "Only super admins can assign legacy car listings",
      );

      const businessId = cleanText(request.data?.businessId, 120);
      if (!businessId) {
        throw new HttpsError("invalid-argument", "Business is required");
      }
      const dryRun = request.data?.dryRun !== false;
      const batchSize = Math.min(
          Math.max(intOrFallback(request.data?.limit, 100), 1),
          200,
      );
      const afterId = cleanText(request.data?.afterId, 160);
      const legacyBusinessName = cleanText(
          request.data?.legacyBusinessName,
          160,
      );
      const carIds = normalizeBackfillCarIds(request.data?.carIds);
      const reassignExplicitCarIds =
        carIds.length > 0 && request.data?.reassignExplicitCarIds === true;

      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business profile not found");
      }
      const business = businessDoc.data() || {};
      const enabledServices = normalizeBusinessServices(
          business.enabledServices,
      );

      let docs = [];
      if (carIds.length) {
        docs = await db.getAll(
            ...carIds.map((id) => db.collection("cars").doc(id)),
        );
      } else {
        let query = db.collection("cars")
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(batchSize);
        if (legacyBusinessName) {
          query = db.collection("cars")
              .where("businessName", "==", legacyBusinessName)
              .orderBy(admin.firestore.FieldPath.documentId())
              .limit(batchSize);
        }
        if (afterId) {
          query = query.startAfter(afterId);
        }
        const snapshot = await query.get();
        docs = snapshot.docs;
      }

      const eligibleDocs = eligibleBackfillDocs(docs, {
        allowAssigned: reassignExplicitCarIds,
        targetBusinessId: businessId,
      });
      const now = admin.firestore.FieldValue.serverTimestamp();
      const update = buildBusinessCarBackfillPayload({
        businessId,
        business,
        enabledServices,
        updatedAt: now,
      });
      const result = buildBusinessCarBackfillResult({
        dryRun,
        businessId,
        docs,
        eligibleDocs,
      });

      if (dryRun || eligibleDocs.length === 0) {
        return result;
      }

      for (let index = 0; index < eligibleDocs.length; index += 200) {
        const batch = db.batch();
        eligibleDocs.slice(index, index + 200).forEach((doc) => {
          batch.set(doc.ref, update, {merge: true});
          setAdminAuditLog(batch, {
            action: "legacy_car_listing_business_assigned",
            actorUid: callerUid,
            targetCollection: "cars",
            targetId: doc.id,
            targetLabel: doc.data()?.title || doc.id,
            previousValue: cleanText(doc.data()?.businessId, 120) ||
              "unassigned",
            nextValue: businessId,
          });
        });
        await batch.commit();
        result.updated += eligibleDocs.slice(index, index + 200).length;
      }

      return result;
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
        await requireBusinessPermission(uid, purchase.businessId, "purchases");
        assertPaidHoldActionable(purchase);
        const carRef = db.collection("cars").doc(purchase.carId);
        const carDoc = await transaction.get(carRef);
        // Guard against double-selling the same car to a different hold/buyer.
        if (
          carDoc.exists &&
          carDoc.data().status === "sold" &&
          carDoc.data().soldPurchaseId &&
          carDoc.data().soldPurchaseId !== purchaseId
        ) {
          throw new HttpsError(
              "failed-precondition",
              "This car is already marked sold to another buyer.",
          );
        }
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
        await requireBusinessPermission(uid, purchase.businessId, "purchases");
        assertPaidHoldActionable(purchase);
        assertHoldLapsed(purchase);
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

// Business-initiated finalization for NON paid-hold flows (viewings, direct
// purchases): mark completed or cancelled. Enforces the state machine, updates
// the car, and — on cancel of a paid deposit — flags the deposit for refund and
// notifies the platform instead of silently keeping the customer's money.
exports.businessFinalizeCarPurchase = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const {purchaseId, outcome, note} = request.data || {};
      if (!purchaseId) {
        throw new HttpsError("invalid-argument", "Purchase ID is required");
      }
      if (!["completed", "cancelled"].includes(outcome)) {
        throw new HttpsError(
            "invalid-argument", "Outcome must be completed or cancelled",
        );
      }

      const db = admin.firestore();
      const purchaseRef = db.collection("carPurchases").doc(purchaseId);
      const result = await db.runTransaction(async (transaction) => {
        const purchaseDoc = await transaction.get(purchaseRef);
        if (!purchaseDoc.exists) {
          throw new HttpsError("not-found", "Purchase not found");
        }
        const purchase = purchaseDoc.data();
        await requireBusinessPermission(uid, purchase.businessId, "purchases");
        if (isTerminalPurchaseStatus(purchase.purchaseStatus)) {
          throw new HttpsError(
              "failed-precondition",
              "This record is already finalized and cannot be changed.",
          );
        }
        const carRef = purchase.carId ?
          db.collection("cars").doc(purchase.carId) : null;
        const carDoc = carRef ? await transaction.get(carRef) : null;
        const now = admin.firestore.FieldValue.serverTimestamp();
        const isViewing = purchaseIsViewing(purchase);
        const trimmedNote = String(note || "").trim();

        if (outcome === "completed") {
          transaction.update(purchaseRef, {
            purchaseStatus: "completed",
            finalizedAt: now,
            finalizedBy: uid,
            staffNotes: trimmedNote || purchase.staffNotes || "",
            updatedAt: now,
          });
          if (carDoc && carDoc.exists) {
            if (!isViewing) {
              if (
                carDoc.data().status === "sold" &&
                carDoc.data().soldPurchaseId &&
                carDoc.data().soldPurchaseId !== purchaseId
              ) {
                throw new HttpsError(
                    "failed-precondition",
                    "This car is already marked sold to another buyer.",
                );
              }
              transaction.update(carRef, {
                status: "sold",
                soldPurchaseId: purchaseId,
                reservedPurchaseId: admin.firestore.FieldValue.delete(),
                reservationType: admin.firestore.FieldValue.delete(),
                soldInfo: {
                  customerName: purchase.buyerName || "",
                  customerPhone: purchase.buyerPhone || "",
                  customerEmail: purchase.buyerEmail || "",
                  amount:
                    Number(purchase.salePrice || purchase.price || 0) || 0,
                  depositAmount: Number(purchase.depositAmount || 0) || 0,
                  soldDate: now,
                  notes: "Completed by business via console",
                },
                updatedAt: now,
              });
            } else {
              transaction.update(carRef, {
                status: "active",
                reservedPurchaseId: admin.firestore.FieldValue.delete(),
                reservationType: admin.firestore.FieldValue.delete(),
                updatedAt: now,
              });
            }
          }
          return {refundQueued: false};
        }

        // outcome === "cancelled"
        const depositPaid = Number(purchase.depositAmount || 0) > 0 &&
          purchase.paymentStatus === "paid";
        transaction.update(purchaseRef, {
          purchaseStatus: "cancelled",
          cancelledAt: now,
          cancelledBy: uid,
          staffNotes: trimmedNote || purchase.staffNotes || "",
          // Business cancelled, so the customer is owed their deposit back. We
          // never silently keep it — flag it and let the platform process it.
          depositForfeitureStatus: depositPaid ?
            "refund_pending" : (purchase.depositForfeitureStatus || "none"),
          updatedAt: now,
        });
        if (carDoc && carDoc.exists) {
          transaction.update(carRef, {
            status: "active",
            reservedPurchaseId: admin.firestore.FieldValue.delete(),
            reservationType: admin.firestore.FieldValue.delete(),
            updatedAt: now,
          });
        }
        if (depositPaid) {
          const notifRef = db.collection("platformNotifications").doc();
          transaction.set(notifRef, {
            type: "deposit_refund_due",
            status: "unread",
            businessId: purchase.businessId,
            businessName: purchase.businessName || "",
            purchaseId,
            buyerUid: purchase.buyerUid || "",
            buyerEmail: purchase.buyerEmail || "",
            buyerName: purchase.buyerName || "",
            amount: Number(purchase.depositAmount || 0) || 0,
            currency: purchase.depositCurrency || "USD",
            title: "Deposit refund due",
            message:
              `${purchase.businessName || "A business"} cancelled a hold for ` +
              `${purchase.carTitle || "a vehicle"}. Refund the customer's ` +
              `deposit of ${purchase.depositAmount} ` +
              `${purchase.depositCurrency || "USD"}.`,
            createdAt: now,
            updatedAt: now,
          });
        }
        return {refundQueued: depositPaid};
      });
      return {success: true, purchaseId, outcome, ...result};
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
      await requireBusinessPermission(uid, purchase.businessId, "purchases");
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
