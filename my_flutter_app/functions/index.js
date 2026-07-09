const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {
  onDocumentDeleted,
  onDocumentUpdated,
  onDocumentWritten,
} = require("firebase-functions/v2/firestore");
const {defineSecret} = require("firebase-functions/params");
const crypto = require("crypto");
const admin = require("firebase-admin");
const {
  FieldValue: FirestoreFieldValue,
  Timestamp: FirestoreTimestamp,
} = require("firebase-admin/firestore");
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
const {
  buildBusinessVerificationBypassUpdate,
  buildBusinessVerificationDocumentSubmissionUpdate,
  buildBusinessVerificationReviewUpdate,
  businessServicesForVerification,
  businessVerificationApprovalReadiness,
  cleanBusinessVerificationUploadPayload,
} = require("./business_verification");
const {
  buildStripeAccountBusinessUpdate,
} = require("./stripe_connect_status");
const {
  defaultNotificationPreferences,
  normalizeNotificationPreferences,
  normalizePlatformNotificationSettings,
  notificationData,
  notificationDeliveryStatus,
  notificationHtml,
  notificationProviderDeliveryUpdate,
  notificationRetryPlan,
  notificationTestReadiness,
  platformNotificationEnabled,
} = require("./notification_settings");
const {
  buildOpenBarrelMirrorPayload,
  isValidStripeSecretKey,
  runtimePaymentSimulationEnabled,
  sharedBarrelBalanceCents,
  sharedBarrelDepositCents,
  sharedPoolPaymentFields: buildSharedPoolPaymentFields,
  sharedPoolSealAccounting: buildSharedPoolSealAccounting,
  simulatedPoolBalanceIntent,
  hasRemainingSharedPoolBalanceDue,
} = require("./shared_barrel");

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
const SIMULATE_PAYMENTS = runtimePaymentSimulationEnabled(process.env);
const DEFAULT_BUSINESS_ID = "keren_auto_sales";
const DEFAULT_BUSINESS_NAME = "Keren";
const MAX_BARREL_QUANTITY = 20;
const MAX_BARREL_ORDER_LINES = 10;
const PLATFORM_ADMIN_EMAIL = "admin@gmail.com";
const VALID_BUSINESS_SERVICES = [
  "barrelShipping",
  "sharedBarrels",
  "freight",
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
const DEFAULT_PLATFORM_SERVICE_FEE_PCT = 0.1;
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
  freightShipments: "freight",
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

function assertBusinessApprovalReady(
    business,
    enabledServices,
    options = {},
) {
  const readiness = businessVerificationApprovalReadiness({
    ...(business || {}),
    enabledServices: enabledServices ||
      businessServicesForVerification(business || {}),
  }, {
    allowPlatformDocumentBypass:
      options.allowPlatformDocumentBypass === true,
  });
  if (readiness.ready) return readiness;
  const suffix = readiness.blockers.length ?
    ` Missing: ${readiness.blockers.join(", ")}.` :
    "";
  throw new HttpsError(
      "failed-precondition",
      "Complete Stripe verification and required platform documents before " +
        `approval.${suffix}`,
      {
        blockers: readiness.blockers,
        documentBlockers: readiness.documentBlockers,
        requiredDocumentIds: readiness.requiredDocumentIds,
        stripeReady: readiness.stripeReady,
      },
  );
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

function nullableNumberInRange(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    return null;
  }
  return numeric;
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

function requireSharedBarrelsService(business) {
  const services = normalizeBusinessServices(business.enabledServices);
  if (!services.includes("barrelShipping") ||
      !services.includes("sharedBarrels")) {
    throw new HttpsError(
        "failed-precondition",
        "This business is not accepting shared barrel pools",
    );
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
              freightAirPricePerKg: Number(country.freightAirPricePerKg || 0),
              freightSeaPricePerKg: Number(country.freightSeaPricePerKg || 0),
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

// Lists approved businesses that offer car transport, together with their
// active destination countries, so a customer can pick who handles their
// transport request. Unlike barrel options, no shipping price is required —
// transport is quoted by the business after the request is submitted.
exports.listTransportBusinessOptions = onCall(
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
        if (!services.includes("carTransport")) continue;

        const destinations = await businessDoc.ref
            .collection("destinationCountries")
            .where("isActive", "==", true)
            .get();

        destinations.docs.forEach((destinationDoc) => {
          const country = destinationDoc.data();
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
              barrelShippingPrice: Number(country.barrelShippingPrice || 0),
              freightAirPricePerKg: Number(country.freightAirPricePerKg || 0),
              freightSeaPricePerKg: Number(country.freightSeaPricePerKg || 0),
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

// Creates a customer car-transport request scoped to a chosen business that
// offers the service. No payment at request time — the request lands as
// "pending" with quoteStatus "awaitingQuote" and the business sets the price.
exports.createTransportRequest = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const data = request.data || {};

      const businessId = String(data.businessId || "").trim();
      if (!businessId) {
        throw new HttpsError(
            "invalid-argument",
            "Select a business that offers car transport.",
        );
      }

      const businessDoc = await admin.firestore()
          .collection("businesses")
          .doc(businessId)
          .get();
      if (!businessDoc.exists || businessDoc.data().status !== "approved") {
        throw new HttpsError(
            "failed-precondition",
            "This business is not available right now.",
        );
      }
      const business = businessDoc.data();
      requireBusinessService(
          business,
          "carTransport",
          "This business is not offering car transport right now.",
      );

      const destinationCountryId =
          String(data.destinationCountryId || "").trim();
      let destinationCountryName =
          String(data.destinationCountryName || "").trim();
      if (destinationCountryId) {
        const destDoc = await businessDoc.ref
            .collection("destinationCountries")
            .doc(destinationCountryId)
            .get();
        if (!destDoc.exists || destDoc.data().isActive !== true) {
          throw new HttpsError(
              "failed-precondition",
              "That destination is not available for this business.",
          );
        }
        destinationCountryName =
          destDoc.data().name || destinationCountryName || destinationCountryId;
      }

      const ownerName = String(data.ownerName || "").trim();
      const carMake = String(data.carMake || "").trim();
      const carModel = String(data.carModel || "").trim();
      const carYear = String(data.carYear || "").trim();
      const vinNumber = String(data.vinNumber || "").trim();
      const customerPhone = String(data.customerPhone || "").trim();
      const pickupAddress = String(data.pickupAddress || "").trim();
      const notes = String(data.notes || "").trim();

      if (!ownerName || !carMake || !carModel || !carYear || !customerPhone) {
        throw new HttpsError(
            "invalid-argument",
            "Fill in the owner, car make/model/year, and a contact phone.",
        );
      }

      let preferredDate = null;
      if (data.preferredDate) {
        const parsed = new Date(data.preferredDate);
        if (!Number.isNaN(parsed.getTime())) {
          preferredDate = admin.firestore.Timestamp.fromDate(parsed);
        }
      }

      const trackingCode =
          await generateTrackingCode("TR", "transportRequests");
      const now = admin.firestore.FieldValue.serverTimestamp();
      const docData = {
        trackingCode,
        ownerName,
        carMake,
        carModel,
        carYear,
        vinNumber,
        destinationCountryId: destinationCountryId || "guinea",
        destinationCountryName: destinationCountryName || "Guinea",
        transportDate: preferredDate || now,
        preferredDate: preferredDate || null,
        price: 0,
        quoteStatus: "awaitingQuote",
        status: "pending",
        businessId,
        businessName: business.name || businessId,
        customerUid: uid,
        customerPhone,
        pickupAddress,
        notes,
        source: "customer",
        createdAt: now,
        updatedAt: now,
      };

      const ref = await admin.firestore()
          .collection("transportRequests")
          .add(docData);

      return {id: ref.id, trackingCode};
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
  const secretKey = stripeSecretKey.value();
  if (!isValidStripeSecretKey(secretKey)) {
    logger.error("Stripe secret key is missing or malformed");
    throw new HttpsError(
        "failed-precondition",
        "Stripe payments are not configured. Contact Laawol support.",
    );
  }
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${secretKey.trim()}`,
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

function stripeFormRequest(path, body, options = {}) {
  return stripeRequest(path, {
    method: options.method || "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(options.idempotencyKey && {
        "Idempotency-Key": options.idempotencyKey,
      }),
      ...(options.headers || {}),
    },
    body,
  });
}

async function retrieveStripePaymentIntent(paymentIntentId) {
  return stripeRequest(`/payment_intents/${paymentIntentId}`);
}

async function createStripeExpressAccount(params) {
  const body = new URLSearchParams();
  body.set("type", "express");
  body.set("capabilities[transfers][requested]", "true");
  if (params.email) body.set("email", params.email);
  if (params.country) body.set("country", params.country);
  Object.entries(params.metadata || {}).forEach(([key, value]) => {
    body.set(`metadata[${key}]`, String(value));
  });
  return stripeFormRequest("/accounts", body);
}

async function createStripeAccountLink(params) {
  const body = new URLSearchParams();
  body.set("account", params.accountId);
  body.set("type", "account_onboarding");
  body.set("refresh_url", params.refreshUrl);
  body.set("return_url", params.returnUrl);
  return stripeFormRequest("/account_links", body);
}

async function retrieveStripeAccount(accountId) {
  return stripeRequest(`/accounts/${encodeURIComponent(accountId)}`);
}

function stripeAccountBusinessUpdate(account) {
  return buildStripeAccountBusinessUpdate(account, {
    serverTimestamp: admin.firestore.FieldValue.serverTimestamp,
  });
}

async function createStripeTransfer(params) {
  const body = new URLSearchParams();
  body.set("amount", String(params.amount));
  body.set("currency", params.currency);
  body.set("destination", params.destination);
  body.set("transfer_group", params.transferGroup);
  if (params.sourceTransaction) {
    body.set("source_transaction", params.sourceTransaction);
  }
  Object.entries(params.metadata || {}).forEach(([key, value]) => {
    body.set(`metadata[${key}]`, String(value));
  });
  return stripeFormRequest("/transfers", body, {
    idempotencyKey: params.idempotencyKey,
  });
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

async function loadPlatformNotificationSettings(db) {
  const snap = await db.collection("platformConfig").doc("general").get();
  const data = snap.exists ? snap.data() : {};
  return normalizePlatformNotificationSettings(data?.notifications);
}

async function queueNotificationDeliveries({
  db,
  uid,
  user,
  settings,
  prefs,
  preferenceKey,
  title,
  body,
  data,
}) {
  if (!uid) return [];
  const cleanTitle = String(title || "Laawol Digital update").trim();
  const cleanBody = String(body || "").trim();
  const cleanData = notificationData(data);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  let writes = 0;
  const results = [];
  const base = {
    preferenceKey,
    title: cleanTitle,
    body: cleanBody,
    data: cleanData,
    recipientUid: uid,
    createdAt: now,
    updatedAt: now,
  };
  const email = String(user?.email || "").trim().toLowerCase();
  const emailStatus = notificationDeliveryStatus({
    settings,
    prefs,
    channel: "email",
    recipientAvailable: isValidEmail(email),
  });
  const emailResult = {
    channel: "email",
    status: emailStatus,
    provider: settings.emailProvider,
    to: email,
  };
  if (emailStatus === "queued" || emailStatus === "provider_not_configured") {
    const deliveryRef = db.collection("notificationDeliveries").doc();
    emailResult.deliveryId = deliveryRef.id;
    batch.set(deliveryRef, {
      ...base,
      channel: "email",
      status: emailStatus,
      provider: settings.emailProvider,
      to: email,
      lastError: emailStatus === "provider_not_configured" ?
        "Email sender provider is not connected." :
        "",
    });
    writes += 1;
    if (settings.emailProvider === "firebaseTriggerEmail") {
      batch.set(db.collection("mail").doc(deliveryRef.id), {
        to: [email],
        message: {
          subject: cleanTitle,
          text: cleanBody,
          html: notificationHtml(cleanTitle, cleanBody),
        },
        deliveryId: deliveryRef.id,
        recipientUid: uid,
        createdAt: now,
      });
      writes += 1;
    }
  }
  results.push(emailResult);
  const phone = String(user?.phone || user?.normalizedPhone || "").trim();
  const smsStatus = notificationDeliveryStatus({
    settings,
    prefs,
    channel: "sms",
    recipientAvailable: Boolean(phone),
  });
  const smsResult = {
    channel: "sms",
    status: smsStatus,
    provider: settings.smsProvider,
    to: phone,
  };
  if (smsStatus === "queued" || smsStatus === "provider_not_configured") {
    const deliveryRef = db.collection("notificationDeliveries").doc();
    smsResult.deliveryId = deliveryRef.id;
    batch.set(deliveryRef, {
      ...base,
      channel: "sms",
      status: smsStatus,
      provider: settings.smsProvider,
      to: phone,
      lastError: smsStatus === "provider_not_configured" ?
        "SMS sender provider is not connected." :
        "",
    });
    writes += 1;
    if (settings.smsProvider === "firestoreSmsQueue") {
      batch.set(db.collection("smsMessages").doc(deliveryRef.id), {
        to: phone,
        body: cleanBody || cleanTitle,
        deliveryId: deliveryRef.id,
        recipientUid: uid,
        createdAt: now,
      });
      writes += 1;
    }
  }
  results.push(smsResult);
  if (writes > 0) {
    await batch.commit();
  }
  return results;
}

async function syncNotificationDeliveryFromProvider({
  deliveryId,
  channel,
  provider,
  providerDoc,
}) {
  const update = notificationProviderDeliveryUpdate({
    channel,
    provider,
    providerDoc,
  });
  if (!update) return;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload = {
    ...update,
    providerUpdatedAt: now,
    updatedAt: now,
  };
  if (update.status === "sent") {
    payload.sentAt = update.providerEndedAt || now;
  }
  if (update.status === "failed") {
    payload.failedAt = update.providerEndedAt || now;
  }

  await admin.firestore()
      .collection("notificationDeliveries")
      .doc(deliveryId)
      .set(payload, {merge: true});
}

exports.syncEmailNotificationDeliveryStatus = onDocumentWritten(
    "mail/{deliveryId}",
    async (event) => {
      const after = event.data?.after;
      if (!after?.exists) return;
      await syncNotificationDeliveryFromProvider({
        deliveryId: event.params.deliveryId,
        channel: "email",
        provider: "firebaseTriggerEmail",
        providerDoc: after.data() || {},
      });
    },
);

exports.syncSmsNotificationDeliveryStatus = onDocumentWritten(
    "smsMessages/{deliveryId}",
    async (event) => {
      const after = event.data?.after;
      if (!after?.exists) return;
      await syncNotificationDeliveryFromProvider({
        deliveryId: event.params.deliveryId,
        channel: "sms",
        provider: "firestoreSmsQueue",
        providerDoc: after.data() || {},
      });
    },
);

exports.retryNotificationDelivery = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const adminUid = requireAuth(request);
      const adminUser = await getUserProfile(adminUid);
      requireSuperAdmin(
          adminUser,
          "Only super admins can retry notification deliveries",
      );

      const deliveryId = String(request.data?.deliveryId || "").trim();
      if (!deliveryId) {
        throw new HttpsError("invalid-argument", "Delivery ID is required");
      }

      const db = admin.firestore();
      const deliveryRef = db.collection("notificationDeliveries")
          .doc(deliveryId);
      const deliveryDoc = await deliveryRef.get();
      if (!deliveryDoc.exists) {
        throw new HttpsError("not-found", "Notification delivery not found");
      }
      const delivery = deliveryDoc.data() || {};
      const status = String(delivery.status || "").trim().toLowerCase();
      if (!["failed", "provider_not_configured", "queued"].includes(status)) {
        throw new HttpsError(
            "failed-precondition",
            "Only queued, failed, or provider setup deliveries can be retried",
        );
      }

      const settings = await loadPlatformNotificationSettings(db);
      const plan = notificationRetryPlan({deliveryId, delivery, settings});
      if (!plan.ok) {
        throw new HttpsError(
            "failed-precondition",
            plan.message,
            {code: plan.code},
        );
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const providerRef = db.collection(plan.providerCollection)
          .doc(deliveryId);
      const providerDoc = await providerRef.get();
      const providerPayload = {
        ...plan.providerDoc,
        retryRequestedAt: now,
        retryRequestedBy: adminUid,
        updatedAt: now,
      };
      if (providerDoc.exists) {
        Object.assign(providerPayload, plan.existingProviderUpdate);
      } else {
        providerPayload.createdAt = now;
      }

      const batch = db.batch();
      batch.set(providerRef, providerPayload, {merge: true});
      batch.set(
          deliveryRef,
          {
            ...plan.deliveryUpdate,
            retryRequestedAt: now,
            retryRequestedBy: adminUid,
            updatedAt: now,
          },
          {merge: true},
      );
      setAdminAuditLog(batch, {
        action: "notification_retry",
        actorUid: adminUid,
        targetCollection: "notificationDeliveries",
        targetId: deliveryId,
        targetLabel: adminRecordLabel(
            "notificationDeliveries",
            deliveryId,
            delivery,
        ),
        statusField: "status",
        previousValue: String(delivery.status || ""),
        nextValue: "queued",
      });
      await batch.commit();

      return {
        success: true,
        deliveryId,
        channel: plan.channel,
        provider: plan.provider,
        status: "queued",
      };
    },
);

exports.sendTestNotificationDelivery = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const adminUid = requireAuth(request);
      const adminUser = await getUserProfile(adminUid);
      requireSuperAdmin(
          adminUser,
          "Only super admins can send notification tests",
      );

      const channel = String(request.data?.channel || "")
          .trim()
          .toLowerCase();
      if (!["email", "sms"].includes(channel)) {
        throw new HttpsError(
            "invalid-argument",
            "Choose email or SMS for the notification test",
        );
      }

      const db = admin.firestore();
      const userDoc = await db.collection("users").doc(adminUid).get();
      const user = userDoc.exists ? userDoc.data() || {} : adminUser;
      const email = String(user.email || adminUser.email || "")
          .trim()
          .toLowerCase();
      const phone = String(user.phone || user.normalizedPhone || "").trim();
      if (channel === "email" && !isValidEmail(email)) {
        throw new HttpsError(
            "failed-precondition",
            "Your admin account needs a valid email before testing email.",
        );
      }
      if (channel === "sms" && !phone) {
        throw new HttpsError(
            "failed-precondition",
            "Your admin account needs a phone number before testing SMS.",
        );
      }

      const settings = await loadPlatformNotificationSettings(db);
      const readiness = notificationTestReadiness({channel, settings});
      if (!readiness.ok) {
        throw new HttpsError(
            "failed-precondition",
            readiness.message,
            {code: readiness.code},
        );
      }

      const forcedPrefs = normalizeNotificationPreferences({
        ...user.notificationPreferences,
        emailNotifications: channel === "email",
        smsNotifications: channel === "sms",
      });
      const deliveries = await queueNotificationDeliveries({
        db,
        uid: adminUid,
        user: {
          ...user,
          email,
          phone,
        },
        settings,
        prefs: forcedPrefs,
        preferenceKey: "supportActivity",
        title: "Laawol Digital test notification",
        body: "This confirms your notification provider is connected.",
        data: {
          type: "notification_test",
          channel,
        },
      });
      const result = deliveries.find((item) => item.channel === channel);
      if (!result?.deliveryId) {
        throw new HttpsError(
            "failed-precondition",
            "The notification test could not be queued.",
            {status: result?.status || "unknown"},
        );
      }

      await db.collection("adminAuditLogs").add({
        action: "notification_test",
        actorUid: adminUid,
        targetCollection: "notificationDeliveries",
        targetId: result.deliveryId,
        targetLabel: `${channel} notification test`,
        statusField: "status",
        previousValue: "",
        nextValue: result.status,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        success: true,
        deliveryId: result.deliveryId,
        channel,
        provider: result.provider,
        status: result.status,
        to: result.to,
      };
    },
);

async function sendPreferenceNotification({
  uid,
  preferenceKey,
  settingKey = "",
  title,
  body,
  data = {},
}) {
  if (!uid) return;
  const db = admin.firestore();
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) return;
  const user = userSnap.data() || {};
  const prefs = normalizeNotificationPreferences(
      user.notificationPreferences,
  );
  if (prefs[preferenceKey] === false) return;
  const settings = await loadPlatformNotificationSettings(db);
  if (!platformNotificationEnabled(settings, preferenceKey, settingKey)) return;

  await queueNotificationDeliveries({
    db,
    uid,
    user,
    settings,
    prefs,
    preferenceKey,
    title,
    body,
    data,
  });
  if (settings.pushEnabled === false || prefs.pushNotifications === false) {
    return;
  }

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

async function notifyAdminsForPlatformEvent({
  capability,
  settingKey,
  title,
  body,
  data = {},
}) {
  const db = admin.firestore();
  const settings = await loadPlatformNotificationSettings(db);
  if (settings.notifyAdmins === false || settings[settingKey] === false) {
    return;
  }
  const admins = await db.collection("users")
      .where("role", "==", "admin")
      .limit(100)
      .get();
  await Promise.all(admins.docs.map((doc) => {
    const user = {id: doc.id, ...doc.data()};
    if (capability && !hasAdminCapability(user, capability)) {
      return Promise.resolve();
    }
    return sendPreferenceNotification({
      uid: doc.id,
      preferenceKey: "businessActivity",
      settingKey,
      title,
      body,
      data,
    });
  }));
}

async function safeSendPreferenceNotification(payload) {
  try {
    await sendPreferenceNotification(payload);
  } catch (error) {
    logger.warn("Notification delivery failed", {
      preferenceKey: payload?.preferenceKey || "",
      uid: payload?.uid || "",
      error: error?.message || String(error),
    });
  }
}

async function safeNotifyAdminsForPlatformEvent(payload) {
  try {
    await notifyAdminsForPlatformEvent(payload);
  } catch (error) {
    logger.warn("Admin notification delivery failed", {
      settingKey: payload?.settingKey || "",
      error: error?.message || String(error),
    });
  }
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

exports.createBusinessStripeAccountLink = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const uid = requireAuth(request);
      const {businessId, returnUrl, refreshUrl} = request.data || {};
      if (!businessId) {
        throw new HttpsError("invalid-argument", "Business ID is required");
      }
      await requireBusinessManager(uid, businessId);

      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }
      const business = businessDoc.data();
      let stripeAccountId = String(business.stripeAccountId || "").trim();
      if (!stripeAccountId) {
        const account = await createStripeExpressAccount({
          email: business.email || "",
          country: /^[A-Z]{2}$/.test(String(business.country || "")) ?
            String(business.country).toUpperCase() :
            "US",
          metadata: {businessId},
        });
        stripeAccountId = account.id;
        await businessRef.set(
            stripeAccountBusinessUpdate(account),
            {merge: true},
        );
      }

      const fallbackUrl =
        process.env.BUSINESS_DASHBOARD_URL ||
        "https://laawol.com/app";
      const accountLink = await createStripeAccountLink({
        accountId: stripeAccountId,
        refreshUrl: refreshUrl || fallbackUrl,
        returnUrl: returnUrl || fallbackUrl,
      });
      return {
        businessId,
        stripeAccountId,
        url: accountLink.url,
      };
    },
);

exports.refreshBusinessStripeAccountStatus = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const uid = requireAuth(request);
      const {businessId} = request.data || {};
      if (!businessId) {
        throw new HttpsError("invalid-argument", "Business ID is required");
      }
      await requireBusinessManager(uid, businessId);
      const businessDoc = await admin.firestore()
          .collection("businesses")
          .doc(businessId)
          .get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }
      const stripeAccountId =
        String(businessDoc.data().stripeAccountId || "").trim();
      if (!stripeAccountId) {
        return {
          businessId,
          stripeAccountId: "",
          chargesEnabled: false,
          payoutsEnabled: false,
        };
      }
      try {
        const account = await retrieveStripeAccount(stripeAccountId);
        const payoutsEnabled = await persistStripeAccountStatus({
          businessId,
          account,
        });
        return {
          businessId,
          stripeAccountId,
          chargesEnabled: account.charges_enabled === true,
          payoutsEnabled,
        };
      } catch (error) {
        logger.error("Could not refresh business Stripe account status", {
          businessId,
          stripeAccountId,
          message: error.message,
        });
        throw new HttpsError(
            "failed-precondition",
            "Could not refresh Stripe payout status. Open Stripe setup " +
              "again or contact Laawol support.",
        );
      }
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
        if (event.type === "account.updated") {
          const accountId = object.id || "";
          const businessId = object.metadata?.businessId ||
            await businessIdForStripeAccount(accountId);
          if (businessId) {
            await persistStripeAccountStatus({businessId, account: object});
          }
        } else if (event.type === "checkout.session.completed") {
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
      let responseStatus = "pending";
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
        responseStatus = status;
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
          status,
          submittedAt: now,
          updatedAt: now,
          profile,
          enabledServices: normalizedServices,
        });
        if (status !== "approved") {
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
        }
      });

      if (responseStatus !== "approved") {
        await safeNotifyAdminsForPlatformEvent({
          capability: "businesses",
          settingKey: "newApplication",
          title: "New business application",
          body: `${profile.name} is waiting for platform approval.`,
          data: {
            type: "business_application",
            businessId,
            applicationId: applicationRef.id,
            status: responseStatus,
          },
        });
      }

      return {
        success: true,
        businessId,
        businessName: profile.name,
        enabledServices: normalizedServices,
        status: responseStatus,
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
      if (collectionName === "businesses" && nextStatus === "approved") {
        assertBusinessApprovalReady(
            current,
            normalizeBusinessServices(
                businessServicesForVerification(current),
            ),
        );
      }
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

exports.updateBusinessVerificationReview = onCall(
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
          "Only operations admins can review business verification documents",
      );

      const businessId = String(request.data?.businessId || "").trim();
      if (!businessId) {
        throw new HttpsError("invalid-argument", "Business ID is required.");
      }

      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }

      let update;
      try {
        update = buildBusinessVerificationReviewUpdate({
          documents: request.data?.documents,
          note: request.data?.note,
          adminUid,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (error) {
        throw new HttpsError(
            "invalid-argument",
            error instanceof Error ? error.message : String(error),
        );
      }

      const batch = db.batch();
      batch.update(businessRef, update);
      setAdminAuditLog(batch, {
        action: "business_verification_reviewed",
        actorUid: adminUid,
        targetCollection: "businesses",
        targetId: businessId,
        targetLabel: adminRecordLabel(
            "businesses",
            businessId,
            businessDoc.data(),
        ),
      });
      await batch.commit();

      const business = businessDoc.data() || {};
      if (business.ownerUid) {
        await safeSendPreferenceNotification({
          uid: business.ownerUid,
          preferenceKey: "businessActivity",
          settingKey: "verificationDocuments",
          title: "Business verification updated",
          body:
            String(request.data?.note || "").trim() ||
            "Laawol reviewed your business verification checklist.",
          data: {
            type: "business_verification_review",
            businessId,
          },
        });
      }

      return {success: true, businessId};
    },
);

exports.submitBusinessVerificationDocument = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const businessId = String(request.data?.businessId || "").trim();
      if (!businessId) {
        throw new HttpsError("invalid-argument", "Business ID is required.");
      }
      await requireBusinessPermission(callerUid, businessId, "profile");

      let update;
      try {
        update = buildBusinessVerificationDocumentSubmissionUpdate({
          businessId,
          documentId: request.data?.documentId,
          fileName: request.data?.fileName,
          path: request.data?.path,
          url: request.data?.url,
          contentType: request.data?.contentType,
          size: request.data?.size,
          uid: callerUid,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (error) {
        throw new HttpsError(
            "invalid-argument",
            error instanceof Error ? error.message : String(error),
        );
      }

      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }
      const batch = db.batch();
      batch.update(businessRef, update);
      setAdminAuditLog(batch, {
        action: "business_verification_document_submitted",
        actorUid: callerUid,
        targetCollection: "businesses",
        targetId: businessId,
        targetLabel: adminRecordLabel(
            "businesses",
            businessId,
            businessDoc.data(),
        ),
        nextValue: String(request.data?.documentId || ""),
      });
      await batch.commit();

      await safeNotifyAdminsForPlatformEvent({
        capability: "businesses",
        settingKey: "verificationDocuments",
        title: "Business document submitted",
        body:
          `${businessDoc.data()?.name || businessId} submitted ` +
          `${request.data?.documentId || "a verification document"}.`,
        data: {
          type: "business_verification_document",
          businessId,
          documentId: String(request.data?.documentId || ""),
        },
      });

      return {success: true, businessId};
    },
);

exports.uploadBusinessVerificationDocument = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      memory: "512MiB",
      timeoutSeconds: 60,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const businessId = String(request.data?.businessId || "").trim();
      if (!businessId) {
        throw new HttpsError("invalid-argument", "Business ID is required.");
      }
      await requireBusinessPermission(callerUid, businessId, "profile");

      let upload;
      try {
        upload = cleanBusinessVerificationUploadPayload({
          businessId,
          documentId: request.data?.documentId,
          fileName: request.data?.fileName,
          contentType: request.data?.contentType,
          size: request.data?.size,
          base64: request.data?.base64,
        });
      } catch (error) {
        throw new HttpsError(
            "invalid-argument",
            error instanceof Error ? error.message : String(error),
        );
      }

      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(businessId);
      const businessDoc = await businessRef.get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }

      const bucketName =
        process.env.FIREBASE_STORAGE_BUCKET ||
        process.env.STORAGE_BUCKET ||
        (
          process.env.GCLOUD_PROJECT ?
            `${process.env.GCLOUD_PROJECT}.firebasestorage.app` :
            undefined
        );
      const bucket = bucketName ?
        admin.storage().bucket(bucketName) :
        admin.storage().bucket();
      const token = crypto.randomUUID();
      await bucket.file(upload.path).save(upload.buffer, {
        resumable: false,
        metadata: {
          cacheControl: "private, max-age=0, no-transform",
          contentType: upload.contentType,
          metadata: {
            businessId,
            documentId: upload.documentId,
            firebaseStorageDownloadTokens: token,
            uploadedBy: callerUid,
          },
        },
      });
      const encodedPath = encodeURIComponent(upload.path);
      const url =
        `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
        `/o/${encodedPath}?alt=media&token=${token}`;
      const update = buildBusinessVerificationDocumentSubmissionUpdate({
        businessId,
        documentId: upload.documentId,
        fileName: upload.fileName,
        path: upload.path,
        url,
        contentType: upload.contentType,
        size: upload.size,
        uid: callerUid,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      const batch = db.batch();
      batch.update(businessRef, update);
      setAdminAuditLog(batch, {
        action: "business_verification_document_uploaded",
        actorUid: callerUid,
        targetCollection: "businesses",
        targetId: businessId,
        targetLabel: adminRecordLabel(
            "businesses",
            businessId,
            businessDoc.data(),
        ),
        nextValue: upload.documentId,
      });
      await batch.commit();

      await safeNotifyAdminsForPlatformEvent({
        capability: "businesses",
        settingKey: "verificationDocuments",
        title: "Business document uploaded",
        body:
          `${businessDoc.data()?.name || businessId} uploaded ` +
          `${upload.documentId}.`,
        data: {
          type: "business_verification_document",
          businessId,
          documentId: upload.documentId,
        },
      });

      return {
        success: true,
        businessId,
        documentId: upload.documentId,
        path: upload.path,
        url,
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
        platformDocumentBypass,
        platformDocumentBypassNote,
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
        addressLine1: current.addressLine1,
        city: current.city,
        country: current.country,
        state: current.state,
        postalCode: current.postalCode,
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
      const currentServices = businessServicesForVerification(current);
      const normalizedServices = normalizeBusinessServices(
          enabledServices,
          currentServices.length ? currentServices : DEFAULT_BUSINESS_SERVICES,
      );
      const approveWithPlatformBypass =
        nextStatus === "approved" && platformDocumentBypass === true;
      let approvalReadiness = null;
      if (nextStatus === "approved") {
        approvalReadiness = assertBusinessApprovalReady(
            current,
            normalizedServices,
            {allowPlatformDocumentBypass: approveWithPlatformBypass},
        );
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const businessUpdate = {
        ...profile,
        enabledServices: normalizedServices,
        ownerUid: ownerUid || current.ownerUid || "",
        status: nextStatus,
        applicationStatus: nextStatus,
        reviewedAt: now,
        reviewedBy: adminUid,
        reviewNote: String(reviewNote || "").trim(),
        updatedAt: now,
      };
      const bypassUpdate =
        approveWithPlatformBypass &&
        approvalReadiness?.platformDocumentsBypassed === true ?
          buildBusinessVerificationBypassUpdate({
            business: {
              ...current,
              enabledServices: normalizedServices,
            },
            note: platformDocumentBypassNote || reviewNote,
            adminUid,
            timestamp: now,
          }) :
          {};

      const resolvedOwnerUid = ownerUid || current.ownerUid;

      const applicationDocs = await db.collection("businessApplications")
          .where("businessId", "==", businessId)
          .where("status", "==", "pending")
          .get();
      const notificationDocs = await db.collection("platformNotifications")
          .where("businessId", "==", businessId)
          .where("type", "==", "business_application")
          .get();
      const batch = db.batch();
      batch.update(businessRef, {
        ...businessUpdate,
        ...bypassUpdate,
      });
      if (resolvedOwnerUid) {
        batch.set(db.collection("users").doc(resolvedOwnerUid), {
          role: "businessOwner",
          businessId,
          businessName: profile.name,
          businessServices: normalizedServices,
          updatedAt: now,
        }, {merge: true});
      }
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

      if (resolvedOwnerUid) {
        await safeSendPreferenceNotification({
          uid: resolvedOwnerUid,
          preferenceKey: "businessActivity",
          settingKey: "businessLifecycle",
          title: "Business application update",
          body: `Your business is now ${nextStatus.replace(/_/g, " ")}.`,
          data: {
            type: "business_application_status",
            businessId,
            status: nextStatus,
          },
        });
      }

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
        parkingAddressLine1,
        parkingCity,
        parkingCountry,
        parkingState,
        parkingTotalSpaces,
        parkingBlockedSpaces,
        parkingDailyRate,
        parkingWeeklyRate,
        parkingMonthlyRate,
        parkingMinimumDays,
        parkingPickupAvailable,
        parkingPickupFee,
        parkingInstructions,
        parkingLatitude,
        parkingLongitude,
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
        parkingAddressLine1: String(
            parkingAddressLine1 ?? current.parkingAddressLine1 ?? "",
        ).trim(),
        parkingCity: String(parkingCity ?? current.parkingCity ?? "").trim(),
        parkingCountry: String(
            parkingCountry ?? current.parkingCountry ?? "",
        ).trim(),
        parkingState: String(
            parkingState ?? current.parkingState ?? "",
        ).trim(),
        parkingTotalSpaces: Math.max(0, intOrFallback(
            parkingTotalSpaces,
            current.parkingTotalSpaces || 0,
        )),
        parkingBlockedSpaces: Math.max(0, intOrFallback(
            parkingBlockedSpaces,
            current.parkingBlockedSpaces || 0,
        )),
        parkingDailyRate: Math.max(0, numberOrFallback(
            parkingDailyRate,
            current.parkingDailyRate || 0,
        )),
        parkingWeeklyRate: Math.max(0, numberOrFallback(
            parkingWeeklyRate,
            current.parkingWeeklyRate || 0,
        )),
        parkingMonthlyRate: Math.max(0, numberOrFallback(
            parkingMonthlyRate,
            current.parkingMonthlyRate || 0,
        )),
        parkingMinimumDays: Math.min(365, Math.max(1, intOrFallback(
            parkingMinimumDays,
            current.parkingMinimumDays || 1,
        ))),
        parkingPickupAvailable: parkingPickupAvailable === true,
        parkingPickupFee: Math.max(0, numberOrFallback(
            parkingPickupFee,
            current.parkingPickupFee || 0,
        )),
        parkingInstructions: String(
            parkingInstructions ?? current.parkingInstructions ?? "",
        ).trim(),
        parkingLatitude: parkingLatitude === undefined ?
          current.parkingLatitude ?? null :
          nullableNumberInRange(parkingLatitude, -90, 90),
        parkingLongitude: parkingLongitude === undefined ?
          current.parkingLongitude ?? null :
          nullableNumberInRange(parkingLongitude, -180, 180),
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

const ACTIVE_PARKING_STATUSES = new Set([
  "pending_payment",
  "requested",
  "reserved",
  "vehicle_received",
  "parked",
  "scheduled_for_transport",
  "active",
]);

function parseParkingDate(value, field) {
  const parsed = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpsError("invalid-argument", `${field} is required`);
  }
  return parsed;
}

function parkingBillableDays(start, end) {
  const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  return Math.max(1, Math.ceil(hours / 24));
}

function parkingRangeOverlaps(row, start, end) {
  const rowStart = row.parkingDate?.toDate?.() ||
    parseParkingDate(row.parkingDate, "parkingDate");
  const rowEnd = row.parkingEndDate?.toDate?.() || rowStart;
  return rowEnd.getTime() >= start.getTime() &&
    rowStart.getTime() <= end.getTime();
}

function businessOffersParking(business) {
  return Array.isArray(business.enabledServices) &&
    business.enabledServices.includes("carParking") &&
    String(business.status || "") === "approved" &&
    Number(business.parkingTotalSpaces || 0) > 0 &&
    Number(business.parkingDailyRate || 0) > 0;
}

function parkingEstimateCents({business, start, end, pickupRequested}) {
  let days = parkingBillableDays(start, end);
  let total = 0;
  const monthly = centsFromDollars(business.parkingMonthlyRate || 0);
  const weekly = centsFromDollars(business.parkingWeeklyRate || 0);
  const daily = centsFromDollars(business.parkingDailyRate || 0);
  if (monthly > 0) {
    const months = Math.floor(days / 30);
    total += months * monthly;
    days -= months * 30;
  }
  if (weekly > 0) {
    const weeks = Math.floor(days / 7);
    total += weeks * weekly;
    days -= weeks * 7;
  }
  total += days * daily;
  if (pickupRequested && business.parkingPickupAvailable === true) {
    total += centsFromDollars(business.parkingPickupFee || 0);
  }
  return Math.max(0, total);
}

function parkingAvailability({business, reservations, start, end}) {
  const totalSpaces = Math.max(0, intOrFallback(
      business.parkingTotalSpaces,
      0,
  ));
  const blockedSpaces = Math.max(0, intOrFallback(
      business.parkingBlockedSpaces,
      0,
  ));
  const overlapping = reservations.filter((row) =>
    ACTIVE_PARKING_STATUSES.has(String(row.status || "reserved")) &&
    parkingRangeOverlaps(row, start, end),
  ).length;
  return Math.max(0, totalSpaces - blockedSpaces - overlapping);
}

function distanceMiles(latA, lonA, latB, lonB) {
  const values = [latA, lonA, latB, lonB].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [aLat, aLon, bLat, bLon] = values.map((value) =>
    value * Math.PI / 180,
  );
  const dLat = bLat - aLat;
  const dLon = bLon - aLon;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat +
    Math.cos(aLat) * Math.cos(bLat) * sinLon * sinLon;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function parkingOptionFromBusiness({
  businessId,
  business,
  reservations,
  start,
  end,
  pickupRequested,
  customerLatitude,
  customerLongitude,
}) {
  const availableSpaces = parkingAvailability({
    business,
    reservations,
    start,
    end,
  });
  const estimatedTotalCents = parkingEstimateCents({
    business,
    start,
    end,
    pickupRequested,
  });
  return {
    businessId,
    businessName: business.name || DEFAULT_BUSINESS_NAME,
    city: business.parkingCity || business.city || "",
    address: business.parkingAddressLine1 || business.addressLine1 || "",
    totalSpaces: Math.max(0, intOrFallback(business.parkingTotalSpaces, 0)),
    blockedSpaces: Math.max(0, intOrFallback(
        business.parkingBlockedSpaces,
        0,
    )),
    availableSpaces,
    dailyRate: numberOrFallback(business.parkingDailyRate, 0),
    weeklyRate: numberOrFallback(business.parkingWeeklyRate, 0),
    monthlyRate: numberOrFallback(business.parkingMonthlyRate, 0),
    pickupAvailable: business.parkingPickupAvailable === true,
    pickupFee: numberOrFallback(business.parkingPickupFee, 0),
    minimumDays: Math.max(1, intOrFallback(business.parkingMinimumDays, 1)),
    instructions: business.parkingInstructions || "",
    phone: business.phone || "",
    email: business.email || "",
    latitude: business.parkingLatitude ?? null,
    longitude: business.parkingLongitude ?? null,
    distanceMiles: distanceMiles(
        customerLatitude,
        customerLongitude,
        business.parkingLatitude,
        business.parkingLongitude,
    ),
    estimatedTotal: dollarsFromCents(estimatedTotalCents),
  };
}

exports.listParkingOptions = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      requireAuth(request);
      const {
        city,
        startDate,
        endDate,
        pickupRequested,
        customerLatitude,
        customerLongitude,
      } = request.data || {};
      const normalizedCity = String(city || "").trim().toLowerCase();
      if (!normalizedCity) {
        throw new HttpsError("invalid-argument", "Parking city is required");
      }
      const start = parseParkingDate(startDate, "Parking start date");
      const end = parseParkingDate(endDate, "Parking end date");
      if (end.getTime() < start.getTime()) {
        throw new HttpsError(
            "invalid-argument",
            "Parking end date must be after the start date",
        );
      }

      const db = admin.firestore();
      const businesses = await db.collection("businesses")
          .where("status", "==", "approved")
          .get();
      const options = [];
      for (const doc of businesses.docs) {
        const business = doc.data() || {};
        const businessCity = String(
            business.parkingCity || business.city || "",
        ).trim().toLowerCase();
        if (
          !businessOffersParking(business) ||
          businessCity !== normalizedCity
        ) {
          continue;
        }
        const reservations = await db.collection("parkedCars")
            .where("businessId", "==", doc.id)
            .limit(500)
            .get();
        const option = parkingOptionFromBusiness({
          businessId: doc.id,
          business,
          reservations: reservations.docs.map((reservation) =>
            reservation.data() || {},
          ),
          start,
          end,
          pickupRequested: pickupRequested === true,
          customerLatitude,
          customerLongitude,
        });
        if (option.availableSpaces > 0) options.push(option);
      }
      options.sort((a, b) => {
        if (a.distanceMiles !== null && b.distanceMiles !== null) {
          const distance = Number(a.distanceMiles) - Number(b.distanceMiles);
          if (distance !== 0) return distance;
        }
        if (a.distanceMiles !== null) return -1;
        if (b.distanceMiles !== null) return 1;
        const price = Number(a.estimatedTotal || 0) -
          Number(b.estimatedTotal || 0);
        if (price !== 0) return price;
        return String(a.businessName).localeCompare(String(b.businessName));
      });
      return {options};
    },
);

exports.createParkingReservation = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const {
        businessId,
        customerName,
        customerPhone,
        carMake,
        carModel,
        carYear,
        vinNumber,
        startDate,
        endDate,
        pickupRequested,
      } = request.data || {};
      const cleanBusinessId = String(businessId || "").trim();
      const start = parseParkingDate(startDate, "Parking start date");
      const end = parseParkingDate(endDate, "Parking end date");
      if (!cleanBusinessId) {
        throw new HttpsError("invalid-argument", "Business is required");
      }
      if (end.getTime() < start.getTime()) {
        throw new HttpsError(
            "invalid-argument",
            "Parking end date must be after the start date",
        );
      }
      const cleanName = String(customerName || "").trim();
      const cleanPhone = String(customerPhone || "").trim();
      if (!cleanName || !cleanPhone) {
        throw new HttpsError(
            "invalid-argument",
            "Customer name and phone are required",
        );
      }
      const cleanCarMake = String(carMake || "").trim();
      const cleanCarModel = String(carModel || "").trim();
      const cleanCarYear = String(carYear || "").trim();
      if (!cleanCarMake || !cleanCarModel || !cleanCarYear) {
        throw new HttpsError(
            "invalid-argument",
            "Vehicle make, model, and year are required",
        );
      }

      const db = admin.firestore();
      const businessRef = db.collection("businesses").doc(cleanBusinessId);
      const reservationRef = db.collection("parkedCars").doc();
      const trackingCode = await generateTrackingCode("PK", "parkedCars");
      let paymentCents = 0;
      let totalCents = 0;
      let option;
      await db.runTransaction(async (transaction) => {
        const businessDoc = await transaction.get(businessRef);
        if (!businessDoc.exists) {
          throw new HttpsError("not-found", "Business not found");
        }
        const business = businessDoc.data() || {};
        if (!businessOffersParking(business)) {
          throw new HttpsError(
              "failed-precondition",
              "This business is not accepting parking reservations",
          );
        }
        const reservations = await transaction.get(
            db.collection("parkedCars")
                .where("businessId", "==", cleanBusinessId)
                .limit(500),
        );
        option = parkingOptionFromBusiness({
          businessId: cleanBusinessId,
          business,
          reservations: reservations.docs.map((reservation) =>
            reservation.data() || {},
          ),
          start,
          end,
          pickupRequested: pickupRequested === true,
          customerLatitude: null,
          customerLongitude: null,
        });
        if (option.availableSpaces <= 0) {
          throw new HttpsError(
              "failed-precondition",
              "No parking spaces are available for those dates",
          );
        }
        totalCents = centsFromDollars(option.estimatedTotal);
        paymentCents = Math.min(totalCents, 5000);
        const pricingDoc = await transaction.get(
            db.collection("shipmentPricing").doc("serviceFees"),
        );
        const platformFeePct = servicePlatformFeePctForBusiness(
            pricingDoc.data(),
            business,
            ["parkingPlatformFeePct"],
        );
        const connectReady = !!business.stripeAccountId &&
          business.payoutsEnabled === true;
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.set(reservationRef, {
          trackingCode,
          customerUid,
          customerName: cleanName,
          customerPhone: cleanPhone,
          ownerName: cleanName,
          carMake: cleanCarMake,
          carModel: cleanCarModel,
          carYear: cleanCarYear,
          vinNumber: String(vinNumber || "").trim(),
          businessId: cleanBusinessId,
          businessName: option.businessName,
          parkingCity: option.city,
          parkingAddress: option.address,
          parkingDate: admin.firestore.Timestamp.fromDate(start),
          parkingEndDate: admin.firestore.Timestamp.fromDate(end),
          status: paymentCents > 0 && !SIMULATE_PAYMENTS ?
            "pending_payment" :
            "reserved",
          paymentStatus: paymentCents > 0 && !SIMULATE_PAYMENTS ?
            "pending" :
            "succeeded",
          totalCost: dollarsFromCents(totalCents),
          totalCostCents: totalCents,
          depositAmount: dollarsFromCents(paymentCents),
          depositAmountCents: paymentCents,
          currency: SHIPMENT_CURRENCY,
          pickupRequested: pickupRequested === true &&
            option.pickupAvailable === true,
          pickupFee: option.pickupFee,
          dailyRate: option.dailyRate,
          weeklyRate: option.weeklyRate,
          monthlyRate: option.monthlyRate,
          minimumDays: option.minimumDays,
          instructions: option.instructions,
          ...servicePayoutFields({
            grossCents: paymentCents,
            platformFeePct,
            connectReady,
          }),
          createdAt: now,
          updatedAt: now,
        });
      });

      if (paymentCents > 0 && !SIMULATE_PAYMENTS) {
        let paymentIntent;
        try {
          paymentIntent = await createStripePaymentIntent({
            amount: paymentCents,
            currency: SHIPMENT_CURRENCY,
            metadata: {
              reservationId: reservationRef.id,
              trackingCode,
              customerUid,
              businessId: cleanBusinessId,
              paymentType: "parking_deposit",
            },
          });
          await reservationRef.update({
            stripePaymentIntentId: paymentIntent.id,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (error) {
          await reservationRef.update({
            status: "cancelled",
            paymentStatus: "failed",
            cancellationReason: "parking_payment_intent_failed",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          throw error;
        }
        return {
          success: true,
          reservationId: reservationRef.id,
          trackingCode,
          clientSecret: paymentIntent.client_secret,
          depositAmount: dollarsFromCents(paymentCents),
          estimatedTotal: dollarsFromCents(totalCents),
        };
      }

      return {
        success: true,
        reservationId: reservationRef.id,
        trackingCode,
        simulatedPayment: true,
        depositAmount: dollarsFromCents(paymentCents),
        estimatedTotal: dollarsFromCents(totalCents),
      };
    },
);

exports.completeParkingReservation = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const {reservationId} = request.data || {};
      const cleanReservationId = String(reservationId || "").trim();
      if (!cleanReservationId) {
        throw new HttpsError("invalid-argument", "Reservation ID is required");
      }
      const db = admin.firestore();
      const reservationRef = db.collection("parkedCars")
          .doc(cleanReservationId);
      const reservationDoc = await reservationRef.get();
      if (!reservationDoc.exists) {
        throw new HttpsError("not-found", "Reservation not found");
      }
      const reservation = reservationDoc.data() || {};
      if (reservation.customerUid !== customerUid) {
        throw new HttpsError("permission-denied", "Reservation access denied");
      }
      if (SIMULATE_PAYMENTS) {
        return {success: true, reservationId: cleanReservationId};
      }
      const intent = await retrieveStripePaymentIntent(
          reservation.stripePaymentIntentId,
      );
      if (intent.status !== "succeeded") {
        await reservationRef.update({
          paymentStatus: intent.status,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        throw new HttpsError(
            "failed-precondition",
            `Payment is ${intent.status}`,
        );
      }
      await reservationRef.update({
        status: "reserved",
        paymentStatus: "succeeded",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await issueBusinessPayoutTransfer({
        ref: reservationRef,
        data: {
          ...reservation,
          status: "reserved",
          paymentStatus: "succeeded",
        },
        sourceTransaction: stripeSourceTransactionFromIntent(intent),
        serviceType: "parking_reservation",
      });
      return {success: true, reservationId: cleanReservationId};
    },
);

exports.cancelPendingParkingReservation = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const {reservationId} = request.data || {};
      const cleanReservationId = String(reservationId || "").trim();
      if (!cleanReservationId) {
        throw new HttpsError("invalid-argument", "Reservation ID is required");
      }
      const ref = admin.firestore().collection("parkedCars")
          .doc(cleanReservationId);
      const doc = await ref.get();
      if (!doc.exists) return {success: true};
      const reservation = doc.data() || {};
      if (reservation.customerUid !== customerUid) {
        throw new HttpsError("permission-denied", "Reservation access denied");
      }
      if (reservation.status !== "pending_payment") {
        return {success: true, reservationId: cleanReservationId};
      }
      await ref.update({
        status: "cancelled",
        paymentStatus: "cancelled",
        cancellationReason: "customer_payment_cancelled",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return {success: true, reservationId: cleanReservationId};
    },
);

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

const BARREL_POOL_ORIGINS = new Set([
  "customerPosted",
  "dropOff",
  "businessHeld",
]);
const BARREL_POOL_APPROVAL_MODES = new Set(["auto", "approval"]);
const BARREL_POOL_ACTIVE_STATUSES = new Set([
  "open",
  "partially_filled",
  "full",
  "pending_seal",
]);
const BARREL_POOL_TERMINAL_STATUSES = new Set([
  "sealed",
  "delivered",
  "cancelled",
  "expired",
]);
const BARREL_POOL_ACTIVE_JOIN_STATUSES = new Set(["requested", "accepted"]);
const BARREL_POOL_DEPOSIT_GRACE_MS = 24 * 60 * 60 * 1000;
const SHARED_BARREL_PLATFORM_COMMISSION_RATE = 0.1;
const BARREL_POOL_SHARE_WEIGHT_CAP_KG = 20;

function normalizePoolShares(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(4, Math.trunc(parsed)));
}

function normalizeTotalPoolShares(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(2, Math.min(4, Math.trunc(parsed)));
}

function normalizeReservedPoolShares(value, totalShares, minShares = 0) {
  const parsed = Number(value);
  const fallback = minShares;
  const shares = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(minShares, Math.min(totalShares - 1, shares));
}

function normalizePoolMaxJoiners(value, openShares) {
  const parsed = Number(value);
  const fallback = openShares;
  const joiners = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(1, Math.min(openShares, joiners));
}

function normalizeRolloverMaxJoiners(value, openShares, activeJoiners) {
  const parsed = Number(value);
  const minimum = Math.max(1, activeJoiners + 1);
  const maximum = Math.max(minimum, activeJoiners + openShares);
  const fallback = maximum;
  const joiners = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, joiners));
}

function normalizePoolDeadline(value) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return admin.firestore.Timestamp.fromDate(
        new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    );
  }
  if (parsed.getTime() <= Date.now()) {
    throw new HttpsError(
        "invalid-argument",
        "Join deadline must be in the future",
    );
  }
  return admin.firestore.Timestamp.fromDate(parsed);
}

function requirePoolOrigin(value) {
  const origin = String(value || "customerPosted").trim();
  if (!BARREL_POOL_ORIGINS.has(origin)) {
    throw new HttpsError("invalid-argument", "Invalid barrel pool origin");
  }
  return origin;
}

function poolHolderRole(origin) {
  return origin === "customerPosted" ? "customer" : "business";
}

function requirePoolApprovalMode(value) {
  const mode = String(value || "approval").trim();
  if (!BARREL_POOL_APPROVAL_MODES.has(mode)) {
    throw new HttpsError("invalid-argument", "Invalid pool approval mode");
  }
  return mode;
}

function poolStatusFor(openShares, takenShares) {
  if (openShares <= 0) return "full";
  if (takenShares > 0) return "partially_filled";
  return "open";
}

function normalizePoolParticipantInput(data = {}) {
  const senderName = cleanText(data.senderName, 160);
  const senderAddress = cleanText(data.senderAddress, 240);
  const receiverName = cleanText(data.receiverName, 160);
  const receiverPhone = cleanText(data.receiverPhone, 80);
  const contentsDescription = cleanText(data.contentsDescription, 500);
  const pickupRequested = data.pickupRequested === true;
  const pickupAddress = pickupRequested ?
    cleanText(data.pickupAddress, 240) :
    cleanText(data.pickupAddress, 240);
  const pickupBorough = pickupRequested ?
    cleanText(data.pickupBorough, 120) :
    cleanText(data.pickupBorough, 120);
  const pickupDateTime = pickupRequested ?
    parseFuturePickup(data.pickupDateTime) :
    null;
  const attestedWeightKg = Number(data.attestedWeightKg || 0);
  const contentsAttested = data.contentsAttested === true ||
    data.contentsAttestationAccepted === true;
  const prohibitedItemsAcknowledged =
    data.prohibitedItemsAcknowledged === true ||
    data.prohibitedItemsAccepted === true;
  const sharedLiabilityAccepted = data.sharedLiabilityAccepted === true ||
    data.sharedBarrelLiabilityAccepted === true;

  if (!senderName || !receiverName || !receiverPhone) {
    throw new HttpsError(
        "invalid-argument",
        "Sender, receiver, and receiver phone are required",
    );
  }
  requireValidPhoneNumber(receiverPhone, "Receiver phone");
  if (
    pickupRequested &&
    (!pickupAddress || !pickupBorough || !pickupDateTime)
  ) {
    throw new HttpsError(
        "invalid-argument",
        "Pickup address, borough, date, and time are required",
    );
  }

  return {
    senderName,
    senderAddress,
    receiverName,
    receiverPhone,
    contentsDescription,
    pickupRequested,
    pickupAddress,
    pickupBorough,
    pickupDateTime,
    pickupFee: 0,
    pickupMiles: 0,
    attestedWeightKg: Number.isFinite(attestedWeightKg) ?
      Math.max(0, attestedWeightKg) :
      0,
    contentsAttested,
    prohibitedItemsAcknowledged,
    sharedLiabilityAccepted,
  };
}

function pricePoolParticipantPickup(participantInput, pricingData) {
  if (!participantInput?.pickupRequested) {
    return {miles: 0, fee: 0};
  }
  const pricing = barrelPickupPricingFromData(pricingData);
  return pickupFeeForBorough(pricing, participantInput.pickupBorough);
}

function requirePoolParticipantAttestations(participantInput, sharesClaimed) {
  const shares = normalizePoolShares(sharesClaimed, 1);
  const maxWeightKg = shares * BARREL_POOL_SHARE_WEIGHT_CAP_KG;
  // Weight is no longer collected for shared barrels; contents description and
  // the liability acknowledgments are what we require.
  if (!participantInput.contentsDescription) {
    throw new HttpsError(
        "invalid-argument",
        "Describe the shared barrel contents before reserving space",
    );
  }
  if (
    participantInput.contentsAttested !== true ||
    participantInput.prohibitedItemsAcknowledged !== true ||
    participantInput.sharedLiabilityAccepted !== true
  ) {
    throw new HttpsError(
        "failed-precondition",
        "Confirm contents, prohibited item, and shared liability " +
        "acknowledgments",
    );
  }
  return {
    weightCapKg: BARREL_POOL_SHARE_WEIGHT_CAP_KG,
    maxWeightKg,
  };
}

function participantPublicSummary(participant) {
  return {
    role: participant.role || "joiner",
    sharesClaimed: Number(participant.sharesClaimed || 0),
    joinStatus: participant.joinStatus || "requested",
    paymentStatus: participant.paymentStatus || "pending",
    pickupRequested: participant.pickupRequested === true,
    createdAt:
      participant.createdAt || admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:
      participant.updatedAt || admin.firestore.FieldValue.serverTimestamp(),
  };
}

function activePoolJoinerCount(publicParticipants = {}) {
  return Object.values(publicParticipants)
      .filter((participant) => participant?.role === "joiner")
      .filter((participant) => BARREL_POOL_ACTIVE_JOIN_STATUSES.has(
          String(participant?.joinStatus || ""),
      ))
      .length;
}

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function participantWithinPoolGrace(participant) {
  const acceptedAt = timestampMillis(participant.acceptedAt);
  const createdAt = timestampMillis(participant.createdAt);
  const anchor = acceptedAt || createdAt;
  return !anchor || Date.now() - anchor <= BARREL_POOL_DEPOSIT_GRACE_MS;
}

function sharedPoolPaymentFields({
  poolId,
  uid,
  amountCents,
  totalDepositCents = amountCents,
  type,
}) {
  return buildSharedPoolPaymentFields({
    poolId,
    uid,
    amountCents,
    totalDepositCents,
    type,
    currency: SHIPMENT_CURRENCY,
    simulatePayments: SIMULATE_PAYMENTS,
  });
}

function sharedPoolSealAccounting({
  pool,
  participantRows,
  shipUnderfilled,
  platformFeePct = SHARED_BARREL_PLATFORM_COMMISSION_RATE,
}) {
  return buildSharedPoolSealAccounting({
    pool,
    participantRows,
    shipUnderfilled,
    commissionRate: platformFeePct,
  });
}

function ensurePoolCanChange(pool) {
  if (BARREL_POOL_TERMINAL_STATUSES.has(String(pool.status || ""))) {
    throw new HttpsError(
        "failed-precondition",
        "This shared barrel pool is already finalized",
    );
  }
}

function requireAdjustedPoolTotalShares(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 4) {
    throw new HttpsError(
        "invalid-argument",
        "Adjusted total shares must be between 2 and 4.",
    );
  }
  return parsed;
}

async function requirePoolDecisionMaker(uid, pool) {
  if (pool.createdByUid === uid) return {role: "owner"};
  return requireBusinessPermission(uid, pool.businessId, "barrels");
}

async function requireVerifiedCustomerForSharedPool(uid) {
  const user = await getUserProfile(uid);
  if (user.role !== "customer") {
    throw new HttpsError(
        "permission-denied",
        "Only customer accounts can use shared barrel customer actions",
    );
  }
  if (user.phoneVerified !== true) {
    throw new HttpsError(
        "failed-precondition",
        "Verify your phone number before using shared barrels",
    );
  }
  return user;
}

function queuePoolParticipantRefund({
  transaction,
  participant,
  pool,
  poolId,
  reason,
  requestedBy = "",
}) {
  const uid = participant.uid || "";
  const refundableCents = Number(participant.refundableAmountCents || 0);
  if (!uid || !Number.isFinite(refundableCents) || refundableCents <= 0) {
    return null;
  }
  const db = admin.firestore();
  const amount = dollarsFromCents(refundableCents);
  const currency = participant.currency || pool.currency || SHIPMENT_CURRENCY;
  const trackingCode = pool.trackingCode || poolId;
  const customerName = participant.senderName || participant.customerName || "";
  const customerEmail = participant.customerEmail || "";
  const requestRef = db.collection("walletRefundRequests").doc();
  const notificationRef = db.collection("platformNotifications").doc();
  const walletRef = db.collection("wallets").doc(uid);
  const walletTransactionRef = walletRef.collection("transactions").doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  transaction.set(walletRef, {
    customerUid: uid,
    currency,
    pendingRefundCents: admin.firestore.FieldValue.increment(
        refundableCents,
    ),
    pendingRefund: admin.firestore.FieldValue.increment(amount),
    updatedAt: now,
  }, {merge: true});
  transaction.set(walletTransactionRef, {
    type: "credit",
    reason,
    status: "pending",
    amountCents: refundableCents,
    amount,
    currency,
    refundRequestId: requestRef.id,
    shipmentId: poolId,
    trackingCode,
    businessId: pool.businessId,
    businessName: pool.businessName,
    customerUid: uid,
    customerName,
    customerEmail,
    createdAt: now,
  });
  transaction.set(requestRef, {
    customerUid: uid,
    customerEmail,
    customerName,
    amountCents: refundableCents,
    amount,
    currency,
    status: "pending",
    destination: "original_payment",
    source: "barrel_pool",
    refundReason: reason,
    businessId: pool.businessId || "",
    businessName: pool.businessName || "",
    barrelPoolId: poolId,
    trackingCode,
    participantUid: uid,
    participantRole: participant.role || "",
    sharesClaimed: Number(participant.sharesClaimed || 0),
    relatedCollection: "barrelPools",
    relatedId: poolId,
    relatedLabel: trackingCode,
    createdBy: requestedBy,
    createdAt: now,
    updatedAt: now,
  });
  transaction.set(notificationRef, {
    type: "deposit_refund_due",
    status: "unread",
    businessId: pool.businessId || "",
    businessName: pool.businessName || "",
    barrelPoolId: poolId,
    trackingCode,
    participantUid: uid,
    customerUid: uid,
    customerEmail,
    customerName,
    amount,
    amountCents: refundableCents,
    currency,
    walletRefundRequestId: requestRef.id,
    relatedCollection: "barrelPools",
    relatedId: poolId,
    relatedLabel: trackingCode,
    title: "Shared barrel refund due",
    message:
      `${pool.businessName || "A business"} owes ${customerName || uid} ` +
      `a shared barrel refund of ${amount} ${currency} for ` +
      `${trackingCode}.`,
    createdBy: requestedBy,
    createdAt: now,
    updatedAt: now,
  });
  return {
    refundRequestId: requestRef.id,
    notificationId: notificationRef.id,
    amountCents: refundableCents,
  };
}

function queuePoolParticipantBalancePayment({
  batch,
  participant,
  pool,
  poolId,
  shipmentId,
  shipmentTrackingCode,
  platformFeePct = SHARED_BARREL_PLATFORM_COMMISSION_RATE,
  requestedBy = "",
}) {
  const uid = participant.uid || "";
  const balanceCents = Number(participant.balanceAmountCents || 0);
  if (!uid || !Number.isFinite(balanceCents) || balanceCents <= 0) {
    return null;
  }
  const db = admin.firestore();
  const amount = dollarsFromCents(balanceCents);
  const currency = participant.currency || pool.currency || SHIPMENT_CURRENCY;
  const trackingCode = pool.trackingCode || poolId;
  const customerName = participant.senderName || participant.customerName || "";
  const customerEmail = participant.customerEmail || "";
  const underfilledAmountCents = Number(
      participant.underfilledBalanceAmountCents || 0,
  );
  const underfilledAmount = dollarsFromCents(underfilledAmountCents);
  const requestRef = db.collection("barrelPoolBalanceRequests").doc();
  const notificationRef = db.collection("platformNotifications").doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  batch.set(requestRef, {
    customerUid: uid,
    customerEmail,
    customerName,
    amountCents: balanceCents,
    amount,
    currency,
    status: "pending",
    source: "barrel_pool_balance",
    businessId: pool.businessId || "",
    businessName: pool.businessName || "",
    platformFeePct,
    ...servicePayoutFields({
      grossCents: balanceCents,
      platformFeePct,
      connectReady: false,
    }),
    barrelPoolId: poolId,
    trackingCode,
    participantUid: uid,
    participantRole: participant.role || "",
    sharesClaimed: Number(participant.sharesClaimed || 0),
    underfilledAmountCents,
    underfilledAmount,
    shipmentId,
    shipmentTrackingCode,
    relatedCollection: "barrelPools",
    relatedId: poolId,
    relatedLabel: trackingCode,
    createdBy: requestedBy,
    createdAt: now,
    updatedAt: now,
  });
  batch.set(notificationRef, {
    type: "barrel_pool_balance_due",
    status: "unread",
    businessId: pool.businessId || "",
    businessName: pool.businessName || "",
    barrelPoolId: poolId,
    trackingCode,
    participantUid: uid,
    customerUid: uid,
    customerEmail,
    customerName,
    amount,
    amountCents: balanceCents,
    underfilledAmount,
    underfilledAmountCents,
    currency,
    barrelPoolBalanceRequestId: requestRef.id,
    shipmentId,
    shipmentTrackingCode,
    relatedCollection: "barrelPools",
    relatedId: poolId,
    relatedLabel: trackingCode,
    title: "Shared barrel balance due",
    message:
      `${customerName || uid} owes ${amount} ${currency} for the ` +
      `shared barrel balance on ${trackingCode}.`,
    createdBy: requestedBy,
    createdAt: now,
    updatedAt: now,
  });
  return {
    balanceRequestId: requestRef.id,
    notificationId: notificationRef.id,
    amountCents: balanceCents,
  };
}

function userBarrelPoolRef(db, uid, poolId) {
  return db.collection("users").doc(uid)
      .collection("barrelPools").doc(poolId);
}

function setUserBarrelPoolMembership({
  transaction,
  uid,
  poolId,
  pool,
  participant,
  now,
}) {
  if (!uid || String(uid).startsWith("dropoff_")) return;
  const db = admin.firestore();
  transaction.set(userBarrelPoolRef(db, uid, poolId), {
    poolId,
    businessId: pool.businessId || "",
    businessName: pool.businessName || "",
    destinationCountryId: pool.destinationCountryId || "",
    destinationCountryName: pool.destinationCountryName || "",
    origin: pool.origin || "customerPosted",
    holderRole: pool.holderRole || "customer",
    createdByUid: pool.createdByUid || "",
    createdByRole: pool.createdByRole || "",
    totalShares: Number(pool.totalShares || 0),
    openShares: Number(pool.openShares || 0),
    sharesAvailable: Number(pool.openShares || 0),
    pricePerShare: Number(pool.pricePerShare || 0),
    depositPerShare: Number(pool.depositPerShare || 0),
    currency: pool.currency || SHIPMENT_CURRENCY,
    shipMode: pool.shipMode || "sea",
    joinDeadline: pool.joinDeadline || null,
    status: pool.status || "open",
    trackingCode: pool.trackingCode || poolId,
    approvalMode: pool.approvalMode || "approval",
    participantRole: participant.role || "joiner",
    participantJoinStatus: participant.joinStatus || "requested",
    sharesClaimed: Number(participant.sharesClaimed || 0),
    updatedAt: now,
  }, {merge: true});
}

exports.createBarrelPool = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const customerUid = requireAuth(request);
      await requireVerifiedCustomerForSharedPool(customerUid);
      const {
        businessId,
        destinationCountryId,
        origin,
        totalShares,
        sharesClaimed,
        maxJoiners,
        approvalMode,
        joinDeadline,
        shipMode,
        useWalletBalance,
      } = request.data || {};
      const normalizedOrigin = requirePoolOrigin(origin);
      if (normalizedOrigin !== "customerPosted") {
        throw new HttpsError(
            "permission-denied",
            "Customers can only post customer-held shared barrels",
        );
      }
      const holderRole = poolHolderRole(normalizedOrigin);
      const normalizedTotalShares = normalizeTotalPoolShares(totalShares);
      const normalizedShares = normalizePoolShares(sharesClaimed, 1);
      if (normalizedShares >= normalizedTotalShares) {
        throw new HttpsError(
            "invalid-argument",
            "A shared barrel must leave at least one share open",
        );
      }
      const normalizedMaxJoiners = normalizePoolMaxJoiners(
          maxJoiners,
          normalizedTotalShares - normalizedShares,
      );
      const participantInput = normalizePoolParticipantInput(
          request.data || {},
      );
      const attestation = requirePoolParticipantAttestations(
          participantInput,
          normalizedShares,
      );
      const deadline = normalizePoolDeadline(joinDeadline);
      const mode = requirePoolApprovalMode(approvalMode);
      const businessDestination = await getApprovedBusinessDestination({
        businessId,
        countryId: destinationCountryId,
      });
      const {business, country, shippingFee, deliveryEstimate} =
        businessDestination;
      requireSharedBarrelsService(business);
      const pricePerShare = dollarsFromCents(
          Math.round(centsFromDollars(shippingFee) / normalizedTotalShares),
      );
      const db = admin.firestore();
      const pricingDoc = await db.collection("shipmentPricing")
          .doc("barrelPickup")
          .get();
      const serviceFeesDoc = await db.collection("shipmentPricing")
          .doc("serviceFees")
          .get();
      const platformFeePct = sharedBarrelPlatformFeePctFromPricing(
          serviceFeesDoc.data(),
          business,
      );
      const connectReady =
        !!business.stripeAccountId && business.payoutsEnabled === true;
      const pickup = pricePoolParticipantPickup(
          participantInput,
          pricingDoc.data(),
      );
      const depositCents = sharedBarrelDepositCents(
          pricePerShare,
          normalizedShares,
      );
      const balanceCents = sharedBarrelBalanceCents(
          pricePerShare,
          normalizedShares,
          pickup.fee,
      );
      const poolRef = db.collection("barrelPools").doc();
      const participantRef = poolRef.collection("participants").doc(
          customerUid,
      );
      const trackingCode = await generateTrackingCode("BP", "barrelPools");
      const userRecord = await admin.auth().getUser(customerUid);
      const now = admin.firestore.FieldValue.serverTimestamp();
      let walletAppliedCents = 0;
      let cardDepositCents = 0;
      await db.runTransaction(async (transaction) => {
        if (useWalletBalance === true) {
          walletAppliedCents = await debitWallet({
            transaction,
            customerUid,
            amountCents: depositCents,
            shipmentId: poolRef.id,
            trackingCode,
            reason: "barrel_pool_deposit",
            businessId: businessDestination.businessId,
            businessName: business.name || DEFAULT_BUSINESS_NAME,
          });
        }
        cardDepositCents = depositCents - walletAppliedCents;
        const payment = sharedPoolPaymentFields({
          poolId: poolRef.id,
          uid: customerUid,
          amountCents: cardDepositCents,
          totalDepositCents: depositCents,
          type: "barrel_pool_deposit",
        });
        const openShares = normalizedTotalShares - normalizedShares;
        const initialStatus = payment.paymentStatus === "pending" ?
          "pending_payment" :
          poolStatusFor(openShares, normalizedShares);
        const poolData = {
          businessId: businessDestination.businessId,
          businessName: business.name || DEFAULT_BUSINESS_NAME,
          destinationCountryId,
          destinationCountryName: country.name || destinationCountryId,
          origin: normalizedOrigin,
          holderRole,
          createdByUid: customerUid,
          createdByRole: "customer",
          totalShares: normalizedTotalShares,
          takenShares: normalizedShares,
          openShares,
          acceptedShares: normalizedShares,
          requestedShares: 0,
          maxJoiners: normalizedMaxJoiners,
          approvalMode: mode,
          pricePerShare,
          depositPerShare: dollarsFromCents(sharedBarrelDepositCents(
              pricePerShare,
              1,
          )),
          currency: SHIPMENT_CURRENCY,
          shipMode: shipMode === "air" ? "air" : "sea",
          platformFeePct,
          joinDeadline: deadline,
          status: initialStatus,
          trackingCode,
          ...deliveryEstimate,
          publicParticipants: {
            [customerUid]: {
              role: "owner",
              sharesClaimed: normalizedShares,
              joinStatus: "accepted",
              paymentStatus: payment.paymentStatus,
              pickupRequested: participantInput.pickupRequested,
              createdAt: now,
              updatedAt: now,
            },
          },
          createdAt: now,
          updatedAt: now,
        };
        const ownerParticipant = {
          uid: customerUid,
          role: "owner",
          businessId: businessDestination.businessId,
          businessName: business.name || DEFAULT_BUSINESS_NAME,
          sharesClaimed: normalizedShares,
          senderName: participantInput.senderName,
          senderAddress: participantInput.senderAddress,
          receiverName: participantInput.receiverName,
          receiverPhone: participantInput.receiverPhone,
          contentsDescription: participantInput.contentsDescription,
          pickupRequested: participantInput.pickupRequested,
          pickupAddress: participantInput.pickupAddress,
          pickupBorough: participantInput.pickupBorough,
          pickupMiles: pickup.miles,
          pickupFee: pickup.fee,
          ...(participantInput.pickupDateTime && {
            pickupDateTime: admin.firestore.Timestamp.fromDate(
                participantInput.pickupDateTime,
            ),
          }),
          attestedWeightKg: participantInput.attestedWeightKg,
          weightCapKg: attestation.weightCapKg,
          maxWeightKg: attestation.maxWeightKg,
          contentsAttested: participantInput.contentsAttested,
          prohibitedItemsAcknowledged:
            participantInput.prohibitedItemsAcknowledged,
          sharedLiabilityAccepted: participantInput.sharedLiabilityAccepted,
          customerEmail: userRecord.email || "",
          joinStatus: "accepted",
          depositAmount: dollarsFromCents(depositCents),
          depositAmountCents: depositCents,
          walletAppliedAmount: dollarsFromCents(walletAppliedCents),
          walletAppliedCents,
          cardDepositAmount: dollarsFromCents(cardDepositCents),
          cardDepositAmountCents: cardDepositCents,
          balanceAmount: dollarsFromCents(balanceCents),
          balanceAmountCents: balanceCents,
          refundableAmountCents: depositCents,
          refundableAmount: dollarsFromCents(depositCents),
          platformFeePct,
          ...servicePayoutFields({
            grossCents: depositCents,
            platformFeePct,
            connectReady,
          }),
          ...payment,
          createdAt: now,
          updatedAt: now,
        };
        transaction.set(poolRef, poolData);
        transaction.set(participantRef, ownerParticipant);
        setUserBarrelPoolMembership({
          transaction,
          uid: customerUid,
          poolId: poolRef.id,
          pool: poolData,
          participant: ownerParticipant,
          now,
        });
      });

      if (cardDepositCents > 0 && !SIMULATE_PAYMENTS) {
        let paymentIntent;
        try {
          paymentIntent = await createStripePaymentIntent({
            amount: cardDepositCents,
            currency: SHIPMENT_CURRENCY,
            metadata: {
              poolId: poolRef.id,
              trackingCode,
              customerUid,
              participantUid: customerUid,
              businessId: businessDestination.businessId,
              destinationCountryId,
              paymentType: "barrel_pool_deposit",
            },
          });
          await participantRef.update({
            stripePaymentIntentIds:
              admin.firestore.FieldValue.arrayUnion(paymentIntent.id),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (error) {
          await db.runTransaction(async (transaction) => {
            const failedAt = admin.firestore.FieldValue.serverTimestamp();
            transaction.update(poolRef, {
              status: "cancelled",
              paymentStatus: "failed",
              cancelledAt: failedAt,
              cancellationReason: "deposit_payment_intent_failed",
              [`publicParticipants.${customerUid}.paymentStatus`]: "failed",
              updatedAt: failedAt,
            });
            transaction.update(participantRef, {
              paymentStatus: "failed",
              updatedAt: failedAt,
            });
            setUserBarrelPoolMembership({
              transaction,
              uid: customerUid,
              poolId: poolRef.id,
              pool: {
                businessId: businessDestination.businessId,
                businessName: business.name || DEFAULT_BUSINESS_NAME,
                destinationCountryId,
                destinationCountryName: country.name || destinationCountryId,
                origin: normalizedOrigin,
                holderRole,
                createdByUid: customerUid,
                createdByRole: "customer",
                totalShares: normalizedTotalShares,
                openShares: normalizedTotalShares - normalizedShares,
                pricePerShare,
                depositPerShare: dollarsFromCents(sharedBarrelDepositCents(
                    pricePerShare,
                    1,
                )),
                currency: SHIPMENT_CURRENCY,
                shipMode: shipMode === "air" ? "air" : "sea",
                joinDeadline: deadline,
                status: "cancelled",
                trackingCode,
                approvalMode: mode,
              },
              participant: {
                role: "owner",
                joinStatus: "accepted",
                sharesClaimed: normalizedShares,
                paymentStatus: "failed",
              },
              now: failedAt,
            });
            if (walletAppliedCents > 0) {
              await creditWallet({
                transaction,
                customerUid,
                amountCents: walletAppliedCents,
                shipmentId: poolRef.id,
                trackingCode,
                reason: "barrel_pool_deposit_reversal",
                businessId: businessDestination.businessId,
                businessName: business.name || DEFAULT_BUSINESS_NAME,
              });
            }
          });
          throw error;
        }
        return {
          success: true,
          poolId: poolRef.id,
          trackingCode,
          clientSecret: paymentIntent.client_secret,
          walletAppliedAmount: dollarsFromCents(walletAppliedCents),
          cardDepositAmount: dollarsFromCents(cardDepositCents),
          depositAmount: dollarsFromCents(depositCents),
        };
      }

      return {
        success: true,
        poolId: poolRef.id,
        trackingCode,
        simulatedPayment: true,
        depositAmount: dollarsFromCents(depositCents),
        walletAppliedAmount: dollarsFromCents(walletAppliedCents),
        cardDepositAmount: dollarsFromCents(cardDepositCents),
      };
    },
);

exports.createBusinessBarrelPool = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const {
        businessId,
        destinationCountryId,
        origin,
        totalShares,
        reservedShares,
        maxJoiners,
        approvalMode,
        joinDeadline,
        shipMode,
      } = request.data || {};
      const normalizedOrigin = requirePoolOrigin(origin || "businessHeld");
      if (!["businessHeld", "dropOff"].includes(normalizedOrigin)) {
        throw new HttpsError(
            "invalid-argument",
            "Business pools must be drop-off or business-held",
        );
      }
      const businessDestination = await getApprovedBusinessDestination({
        businessId,
        countryId: destinationCountryId,
      });
      await requireBusinessPermission(
          callerUid,
          businessDestination.businessId,
          "barrels",
      );
      const {business, country, shippingFee, deliveryEstimate} =
        businessDestination;
      requireSharedBarrelsService(business);

      const normalizedTotalShares = normalizeTotalPoolShares(totalShares);
      const minimumReservedShares = normalizedOrigin === "dropOff" ? 1 : 0;
      const normalizedReservedShares = normalizeReservedPoolShares(
          reservedShares,
          normalizedTotalShares,
          minimumReservedShares,
      );
      const openShares = normalizedTotalShares - normalizedReservedShares;
      const normalizedMaxJoiners = normalizePoolMaxJoiners(
          maxJoiners,
          openShares,
      );
      const mode = requirePoolApprovalMode(approvalMode);
      const deadline = normalizePoolDeadline(joinDeadline);
      const pricePerShare = dollarsFromCents(
          Math.round(centsFromDollars(shippingFee) / normalizedTotalShares),
      );
      const depositPerShare = dollarsFromCents(sharedBarrelDepositCents(
          pricePerShare,
          1,
      ));
      const db = admin.firestore();
      const poolRef = db.collection("barrelPools").doc();
      const trackingCode = await generateTrackingCode("BP", "barrelPools");
      const now = admin.firestore.FieldValue.serverTimestamp();
      const participantId = cleanText(request.data?.customerUid, 128)
          .replace(/[/.]/g, "_") || `dropoff_${poolRef.id}`;
      const participantInput = normalizedReservedShares > 0 ?
        normalizePoolParticipantInput(request.data || {}) :
        null;
      const attestation = participantInput ?
        requirePoolParticipantAttestations(
            participantInput,
            normalizedReservedShares,
        ) :
        null;
      const participantRef = participantInput ?
        poolRef.collection("participants").doc(participantId) :
        null;
      const pricingDoc = participantInput?.pickupRequested ?
        await db.collection("shipmentPricing").doc("barrelPickup").get() :
        null;
      const pickup = pricePoolParticipantPickup(
          participantInput,
          pricingDoc?.data(),
      );
      const depositCents = sharedBarrelDepositCents(
          pricePerShare,
          normalizedReservedShares,
      );
      const balanceCents = sharedBarrelBalanceCents(
          pricePerShare,
          normalizedReservedShares,
          pickup.fee,
      );

      await db.runTransaction(async (transaction) => {
        const poolData = {
          businessId: businessDestination.businessId,
          businessName: business.name || DEFAULT_BUSINESS_NAME,
          destinationCountryId,
          destinationCountryName: country.name || destinationCountryId,
          origin: normalizedOrigin,
          holderRole: "business",
          createdByUid: callerUid,
          createdByRole: "business",
          totalShares: normalizedTotalShares,
          takenShares: normalizedReservedShares,
          openShares,
          acceptedShares: normalizedReservedShares,
          requestedShares: 0,
          maxJoiners: normalizedMaxJoiners,
          approvalMode: mode,
          pricePerShare,
          depositPerShare,
          currency: SHIPMENT_CURRENCY,
          shipMode: shipMode === "air" ? "air" : "sea",
          joinDeadline: deadline,
          status: poolStatusFor(openShares, normalizedReservedShares),
          trackingCode,
          ...deliveryEstimate,
          publicParticipants: participantInput ? {
            [participantId]: {
              role: "owner",
              sharesClaimed: normalizedReservedShares,
              joinStatus: "accepted",
              paymentStatus: "collected_by_business",
              pickupRequested: participantInput.pickupRequested,
              createdAt: now,
              updatedAt: now,
            },
          } : {},
          createdAt: now,
          updatedAt: now,
        };
        transaction.set(poolRef, poolData);
        if (participantRef && participantInput) {
          const businessOwnerParticipant = {
            uid: participantId,
            role: "owner",
            managedByBusiness: true,
            sharesClaimed: normalizedReservedShares,
            senderName: participantInput.senderName,
            senderAddress: participantInput.senderAddress,
            receiverName: participantInput.receiverName,
            receiverPhone: participantInput.receiverPhone,
            contentsDescription: participantInput.contentsDescription,
            pickupRequested: participantInput.pickupRequested,
            pickupAddress: participantInput.pickupAddress,
            pickupBorough: participantInput.pickupBorough,
            pickupMiles: pickup.miles,
            pickupFee: pickup.fee,
            ...(participantInput.pickupDateTime && {
              pickupDateTime: admin.firestore.Timestamp.fromDate(
                  participantInput.pickupDateTime,
              ),
            }),
            attestedWeightKg: participantInput.attestedWeightKg,
            weightCapKg: attestation?.weightCapKg || 0,
            maxWeightKg: attestation?.maxWeightKg || 0,
            contentsAttested: participantInput.contentsAttested,
            prohibitedItemsAcknowledged:
              participantInput.prohibitedItemsAcknowledged,
            sharedLiabilityAccepted: participantInput.sharedLiabilityAccepted,
            customerEmail: cleanText(request.data?.customerEmail, 160),
            joinStatus: "accepted",
            depositAmount: dollarsFromCents(depositCents),
            depositAmountCents: depositCents,
            walletAppliedAmount: 0,
            walletAppliedCents: 0,
            cardDepositAmount: 0,
            cardDepositAmountCents: 0,
            balanceAmount: dollarsFromCents(balanceCents),
            balanceAmountCents: balanceCents,
            refundableAmountCents: 0,
            refundableAmount: 0,
            amount: 0,
            amountCents: 0,
            currency: SHIPMENT_CURRENCY,
            paymentStatus: "collected_by_business",
            stripePaymentIntentIds: [],
            createdAt: now,
            updatedAt: now,
          };
          transaction.set(participantRef, businessOwnerParticipant);
          setUserBarrelPoolMembership({
            transaction,
            uid: participantId,
            poolId: poolRef.id,
            pool: poolData,
            participant: businessOwnerParticipant,
            now,
          });
        }
      });

      return {
        success: true,
        poolId: poolRef.id,
        trackingCode,
        origin: normalizedOrigin,
      };
    },
);

exports.adjustBarrelPoolCapacity = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const poolId = cleanText(request.data?.poolId, 160);
      const totalShares = requireAdjustedPoolTotalShares(
          request.data?.totalShares,
      );
      const inspectionNote = cleanText(request.data?.inspectionNote, 500);
      if (!poolId) {
        throw new HttpsError("invalid-argument", "Pool is required.");
      }
      if (!inspectionNote) {
        throw new HttpsError(
            "invalid-argument",
            "Inspection note is required.",
        );
      }

      const db = admin.firestore();
      const poolRef = db.collection("barrelPools").doc(poolId);
      await db.runTransaction(async (transaction) => {
        const [poolDoc, participantSnapshot] = await Promise.all([
          transaction.get(poolRef),
          transaction.get(
              poolRef.collection("participants")
                  .where("joinStatus", "in", ["requested", "accepted"]),
          ),
        ]);
        if (!poolDoc.exists) {
          throw new HttpsError("not-found", "Shared barrel pool not found");
        }
        const pool = poolDoc.data() || {};
        ensurePoolCanChange(pool);
        await requireBusinessPermission(callerUid, pool.businessId, "barrels");
        if (!BARREL_POOL_ACTIVE_STATUSES.has(String(pool.status || ""))) {
          throw new HttpsError(
              "failed-precondition",
              "Only active shared barrel pools can be adjusted.",
          );
        }

        const takenShares = Number(pool.takenShares ??
          Number(pool.acceptedShares || 0) + Number(pool.requestedShares || 0));
        if (totalShares < takenShares) {
          throw new HttpsError(
              "failed-precondition",
              "Adjusted total shares cannot be below reserved shares.",
          );
        }
        const openShares = totalShares - takenShares;
        const nextStatus = String(pool.status || "") === "pending_seal" &&
          openShares === 0 ?
          "pending_seal" :
          poolStatusFor(openShares, takenShares);
        const nextMaxJoiners = openShares > 0 ?
          Math.max(1, Math.min(
              Number(pool.maxJoiners || openShares),
              openShares,
          )) :
          Number(pool.maxJoiners || 1);
        const now = admin.firestore.FieldValue.serverTimestamp();
        const nextPool = {
          ...pool,
          totalShares,
          openShares,
          maxJoiners: nextMaxJoiners,
          status: nextStatus,
        };

        transaction.update(poolRef, {
          totalShares,
          openShares,
          sharesAvailable: openShares,
          maxJoiners: nextMaxJoiners,
          status: nextStatus,
          lastShareAdjustment: {
            previousTotalShares: Number(pool.totalShares || 0),
            previousOpenShares: Number(pool.openShares || 0),
            totalShares,
            openShares,
            inspectionNote,
            adjustedBy: callerUid,
            adjustedAt: now,
          },
          shareAdjustmentCount: admin.firestore.FieldValue.increment(1),
          updatedAt: now,
        });

        participantSnapshot.docs.forEach((participantDoc) => {
          const participant = participantDoc.data() || {};
          setUserBarrelPoolMembership({
            transaction,
            uid: participantDoc.id,
            poolId,
            pool: nextPool,
            participant: {
              ...participant,
              uid: participantDoc.id,
            },
            now,
          });
        });
      });

      return {success: true, poolId, totalShares};
    },
);

exports.rollBarrelPoolToBusinessHeld = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const poolId = cleanText(request.data?.poolId, 160);
      const note = cleanText(request.data?.note, 500);
      if (!poolId) {
        throw new HttpsError("invalid-argument", "Pool is required.");
      }
      const nextDeadline = normalizePoolDeadline(request.data?.joinDeadline);
      const db = admin.firestore();
      const poolRef = db.collection("barrelPools").doc(poolId);

      await db.runTransaction(async (transaction) => {
        const [poolDoc, participantSnapshot] = await Promise.all([
          transaction.get(poolRef),
          transaction.get(
              poolRef.collection("participants")
                  .where("joinStatus", "in", ["requested", "accepted"]),
          ),
        ]);
        if (!poolDoc.exists) {
          throw new HttpsError("not-found", "Shared barrel pool not found");
        }
        const pool = poolDoc.data() || {};
        ensurePoolCanChange(pool);
        await requireBusinessPermission(callerUid, pool.businessId, "barrels");
        if (!BARREL_POOL_ACTIVE_STATUSES.has(String(pool.status || ""))) {
          throw new HttpsError(
              "failed-precondition",
              "Only active shared barrel pools can be rolled over.",
          );
        }
        if (String(pool.origin || "") === "businessHeld") {
          throw new HttpsError(
              "failed-precondition",
              "This pool is already business-held.",
          );
        }
        const previousDeadlineMillis = timestampMillis(pool.joinDeadline);
        if (!previousDeadlineMillis || previousDeadlineMillis > Date.now()) {
          throw new HttpsError(
              "failed-precondition",
              "Shared barrels can roll over only after the join deadline.",
          );
        }
        const openShares = Number(pool.openShares || 0);
        if (openShares <= 0) {
          throw new HttpsError(
              "failed-precondition",
              "Only underfilled pools can roll into business-held matching.",
          );
        }
        const takenShares = Number(pool.takenShares || 0);
        const activeJoiners = activePoolJoinerCount(
            pool.publicParticipants || {},
        );
        const nextMaxJoiners = normalizeRolloverMaxJoiners(
            request.data?.maxJoiners,
            openShares,
            activeJoiners,
        );
        const now = admin.firestore.FieldValue.serverTimestamp();
        const nextPool = {
          ...pool,
          origin: "businessHeld",
          holderRole: "business",
          joinDeadline: nextDeadline,
          maxJoiners: nextMaxJoiners,
          status: poolStatusFor(openShares, takenShares),
        };

        transaction.update(poolRef, {
          origin: "businessHeld",
          holderRole: "business",
          joinDeadline: nextDeadline,
          maxJoiners: nextMaxJoiners,
          status: poolStatusFor(openShares, takenShares),
          businessHeldRollover: {
            previousOrigin: pool.origin || "customerPosted",
            previousHolderRole: pool.holderRole || "customer",
            previousJoinDeadline: pool.joinDeadline || null,
            note,
            rolledBy: callerUid,
            rolledAt: now,
          },
          rolloverCount: admin.firestore.FieldValue.increment(1),
          updatedAt: now,
        });

        participantSnapshot.docs.forEach((participantDoc) => {
          const participant = participantDoc.data() || {};
          setUserBarrelPoolMembership({
            transaction,
            uid: participantDoc.id,
            poolId,
            pool: nextPool,
            participant: {
              ...participant,
              uid: participantDoc.id,
            },
            now,
          });
        });
      });

      return {success: true, poolId, origin: "businessHeld"};
    },
);

exports.requestJoinBarrelPool = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const customerUid = requireAuth(request);
      await requireVerifiedCustomerForSharedPool(customerUid);
      const poolId = cleanText(request.data?.poolId, 160);
      const useWalletBalance = request.data?.useWalletBalance === true;
      const requestedDestinationCountryId = cleanText(
          request.data?.destinationCountryId,
          160,
      );
      const sharesClaimed = normalizePoolShares(
          request.data?.sharesClaimed,
          1,
      );
      if (!poolId) {
        throw new HttpsError("invalid-argument", "Pool is required");
      }
      const participantInput = normalizePoolParticipantInput(
          request.data || {},
      );
      const attestation = requirePoolParticipantAttestations(
          participantInput,
          sharesClaimed,
      );
      const db = admin.firestore();
      const poolRef = db.collection("barrelPools").doc(poolId);
      const participantRef = poolRef.collection("participants").doc(
          customerUid,
      );
      const userRecord = await admin.auth().getUser(customerUid);
      const pricingDoc = participantInput.pickupRequested ?
        await db.collection("shipmentPricing").doc("barrelPickup").get() :
        null;
      const serviceFeesDoc = await db.collection("shipmentPricing")
          .doc("serviceFees")
          .get();
      const poolSnapshotForFee = await poolRef.get();
      const poolForFee = poolSnapshotForFee.exists ?
        poolSnapshotForFee.data() || {} :
        {};
      const businessForFeeDoc = poolForFee.businessId ?
        await db.collection("businesses").doc(poolForFee.businessId).get() :
        null;
      const platformFeePct = sharedBarrelPlatformFeePctFromPricing(
          serviceFeesDoc.data(),
          businessForFeeDoc?.exists ? businessForFeeDoc.data() : poolForFee,
      );
      const pickup = pricePoolParticipantPickup(
          participantInput,
          pricingDoc?.data(),
      );
      let depositCents = 0;
      let walletAppliedCents = 0;
      let cardDepositCents = 0;
      let trackingCode = poolId;
      let poolBusinessId = "";
      let poolBusinessName = "";
      let poolDestinationCountryId = "";
      let joinStatusForPayment = "requested";
      await db.runTransaction(async (transaction) => {
        const [poolDoc, participantDoc] = await Promise.all([
          transaction.get(poolRef),
          transaction.get(participantRef),
        ]);
        if (!poolDoc.exists) {
          throw new HttpsError("not-found", "Shared barrel pool not found");
        }
        if (participantDoc.exists) {
          throw new HttpsError(
              "already-exists",
              "You already joined this shared barrel",
          );
        }
        const pool = poolDoc.data() || {};
        ensurePoolCanChange(pool);
        poolBusinessId = pool.businessId || "";
        poolBusinessName = pool.businessName || "";
        poolDestinationCountryId = pool.destinationCountryId || "";
        if (
          requestedDestinationCountryId &&
          requestedDestinationCountryId !== poolDestinationCountryId
        ) {
          throw new HttpsError(
              "failed-precondition",
              "Joiner destination must match the shared barrel destination",
          );
        }
        if (!BARREL_POOL_ACTIVE_STATUSES.has(String(pool.status || ""))) {
          throw new HttpsError(
              "failed-precondition",
              "This pool is not open for joiners",
          );
        }
        if (
          pool.joinDeadline &&
          pool.joinDeadline.toMillis &&
          pool.joinDeadline.toMillis() <= Date.now()
        ) {
          throw new HttpsError(
              "failed-precondition",
              "The join deadline has passed",
          );
        }
        const openShares = Number(pool.openShares || 0);
        if (sharesClaimed > openShares) {
          throw new HttpsError(
              "failed-precondition",
              "Not enough shares are available",
          );
        }
        const joinerCount = activePoolJoinerCount(
            pool.publicParticipants || {},
        );
        const maxJoiners = Number(pool.maxJoiners || 1);
        if (joinerCount >= maxJoiners) {
          throw new HttpsError(
              "failed-precondition",
              "This pool already has the maximum number of joiners",
          );
        }
        const remainingJoinerSlots = maxJoiners - joinerCount;
        if (remainingJoinerSlots <= 1 && sharesClaimed < openShares) {
          throw new HttpsError(
              "failed-precondition",
              "The final joiner must claim all remaining shares",
          );
        }
        const pricePerShare = Number(pool.pricePerShare || 0);
        depositCents = sharedBarrelDepositCents(pricePerShare, sharesClaimed);
        const balanceCents = sharedBarrelBalanceCents(
            pricePerShare,
            sharesClaimed,
            pickup.fee,
        );
        trackingCode = pool.trackingCode || poolId;
        if (useWalletBalance === true) {
          walletAppliedCents = await debitWallet({
            transaction,
            customerUid,
            amountCents: depositCents,
            shipmentId: poolId,
            trackingCode,
            reason: "barrel_pool_join_deposit",
            businessId: pool.businessId,
            businessName: pool.businessName,
          });
        }
        cardDepositCents = depositCents - walletAppliedCents;
        const nextOpenShares = openShares - sharesClaimed;
        const approvalMode = String(pool.approvalMode || "approval");
        const joinStatus = approvalMode === "auto" ? "accepted" : "requested";
        joinStatusForPayment = joinStatus;
        const requestedShares = Number(pool.requestedShares || 0) +
          (joinStatus === "requested" ? sharesClaimed : 0);
        const acceptedShares = Number(pool.acceptedShares || 0) +
          (joinStatus === "accepted" ? sharesClaimed : 0);
        const payment = sharedPoolPaymentFields({
          poolId,
          uid: customerUid,
          amountCents: cardDepositCents,
          totalDepositCents: depositCents,
          type: "barrel_pool_join",
        });
        const participant = {
          uid: customerUid,
          role: "joiner",
          businessId: poolBusinessId,
          businessName: poolBusinessName,
          sharesClaimed,
          destinationCountryId: poolDestinationCountryId,
          destinationCountryName: pool.destinationCountryName || "",
          senderName: participantInput.senderName,
          senderAddress: participantInput.senderAddress,
          receiverName: participantInput.receiverName,
          receiverPhone: participantInput.receiverPhone,
          contentsDescription: participantInput.contentsDescription,
          pickupRequested: participantInput.pickupRequested,
          pickupAddress: participantInput.pickupAddress,
          pickupBorough: participantInput.pickupBorough,
          pickupMiles: pickup.miles,
          pickupFee: pickup.fee,
          ...(participantInput.pickupDateTime && {
            pickupDateTime: admin.firestore.Timestamp.fromDate(
                participantInput.pickupDateTime,
            ),
          }),
          attestedWeightKg: participantInput.attestedWeightKg,
          weightCapKg: attestation.weightCapKg,
          maxWeightKg: attestation.maxWeightKg,
          contentsAttested: participantInput.contentsAttested,
          prohibitedItemsAcknowledged:
            participantInput.prohibitedItemsAcknowledged,
          sharedLiabilityAccepted: participantInput.sharedLiabilityAccepted,
          customerEmail: userRecord.email || "",
          joinStatus,
          depositAmount: dollarsFromCents(depositCents),
          depositAmountCents: depositCents,
          walletAppliedAmount: dollarsFromCents(walletAppliedCents),
          walletAppliedCents,
          cardDepositAmount: dollarsFromCents(cardDepositCents),
          cardDepositAmountCents: cardDepositCents,
          balanceAmount: dollarsFromCents(balanceCents),
          balanceAmountCents: balanceCents,
          refundableAmountCents: depositCents,
          refundableAmount: dollarsFromCents(depositCents),
          platformFeePct,
          ...servicePayoutFields({
            grossCents: depositCents,
            platformFeePct,
            connectReady: false,
          }),
          ...payment,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        const nextPoolStatus = poolStatusFor(
            nextOpenShares,
            Number(pool.takenShares || 0) + sharesClaimed,
        );
        const membershipPool = {
          ...pool,
          openShares: nextOpenShares,
          takenShares: Number(pool.takenShares || 0) + sharesClaimed,
          requestedShares,
          acceptedShares,
          status: nextPoolStatus,
        };
        transaction.set(participantRef, participant);
        transaction.update(poolRef, {
          takenShares: Number(pool.takenShares || 0) + sharesClaimed,
          openShares: nextOpenShares,
          requestedShares,
          acceptedShares,
          status: nextPoolStatus,
          [`publicParticipants.${customerUid}`]:
            participantPublicSummary(participant),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        setUserBarrelPoolMembership({
          transaction,
          uid: customerUid,
          poolId,
          pool: membershipPool,
          participant,
          now: participant.updatedAt,
        });
        if (pool.createdByUid && pool.createdByUid !== customerUid) {
          const ownerSummary =
            (pool.publicParticipants || {})[pool.createdByUid] || {};
          setUserBarrelPoolMembership({
            transaction,
            uid: pool.createdByUid,
            poolId,
            pool: membershipPool,
            participant: {
              role: "owner",
              joinStatus: "accepted",
              sharesClaimed: Number(ownerSummary.sharesClaimed || 0),
            },
            now: participant.updatedAt,
          });
        }
      });

      if (cardDepositCents > 0 && !SIMULATE_PAYMENTS) {
        let paymentIntent;
        try {
          paymentIntent = await createStripePaymentIntent({
            amount: cardDepositCents,
            currency: SHIPMENT_CURRENCY,
            metadata: {
              poolId,
              trackingCode,
              customerUid,
              participantUid: customerUid,
              businessId: poolBusinessId,
              destinationCountryId: poolDestinationCountryId,
              paymentType: "barrel_pool_join",
            },
          });
          await participantRef.update({
            stripePaymentIntentIds:
              admin.firestore.FieldValue.arrayUnion(paymentIntent.id),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (error) {
          await db.runTransaction(async (transaction) => {
            const [poolDoc, participantDoc] = await Promise.all([
              transaction.get(poolRef),
              transaction.get(participantRef),
            ]);
            if (!poolDoc.exists || !participantDoc.exists) return;
            const pool = poolDoc.data() || {};
            const participant = participantDoc.data() || {};
            const shares = Number(participant.sharesClaimed || sharesClaimed);
            const failedAt = admin.firestore.FieldValue.serverTimestamp();
            const wasRequested =
              String(participant.joinStatus || joinStatusForPayment) ===
              "requested";
            const nextOpenShares = Number(pool.openShares || 0) + shares;
            const nextTakenShares = Math.max(
                0,
                Number(pool.takenShares || 0) - shares,
            );
            const nextRequestedShares = Math.max(
                0,
                Number(pool.requestedShares || 0) -
                  (wasRequested ? shares : 0),
            );
            const nextAcceptedShares = Math.max(
                0,
                Number(pool.acceptedShares || 0) -
                  (wasRequested ? 0 : shares),
            );
            const nextPoolStatus = poolStatusFor(
                nextOpenShares,
                nextTakenShares,
            );
            transaction.update(participantRef, {
              joinStatus: "cancelled",
              paymentStatus: "failed",
              refundableAmountCents: 0,
              refundableAmount: 0,
              updatedAt: failedAt,
            });
            transaction.update(poolRef, {
              openShares: nextOpenShares,
              takenShares: nextTakenShares,
              requestedShares: nextRequestedShares,
              acceptedShares: nextAcceptedShares,
              status: nextPoolStatus,
              [`publicParticipants.${customerUid}.joinStatus`]: "cancelled",
              [`publicParticipants.${customerUid}.paymentStatus`]: "failed",
              [`publicParticipants.${customerUid}.updatedAt`]: failedAt,
              updatedAt: failedAt,
            });
            setUserBarrelPoolMembership({
              transaction,
              uid: customerUid,
              poolId,
              pool: {
                ...pool,
                openShares: nextOpenShares,
                takenShares: nextTakenShares,
                requestedShares: nextRequestedShares,
                acceptedShares: nextAcceptedShares,
                status: nextPoolStatus,
              },
              participant: {
                ...participant,
                joinStatus: "cancelled",
                paymentStatus: "failed",
              },
              now: failedAt,
            });
            if (walletAppliedCents > 0) {
              await creditWallet({
                transaction,
                customerUid,
                amountCents: walletAppliedCents,
                shipmentId: poolId,
                trackingCode,
                reason: "barrel_pool_join_deposit_reversal",
                businessId: poolBusinessId,
                businessName: poolBusinessName,
              });
            }
          });
          throw error;
        }
        return {
          success: true,
          poolId,
          trackingCode,
          depositAmount: dollarsFromCents(depositCents),
          walletAppliedAmount: dollarsFromCents(walletAppliedCents),
          cardDepositAmount: dollarsFromCents(cardDepositCents),
          clientSecret: paymentIntent.client_secret,
        };
      }

      return {
        success: true,
        poolId,
        trackingCode,
        depositAmount: dollarsFromCents(depositCents),
        walletAppliedAmount: dollarsFromCents(walletAppliedCents),
        cardDepositAmount: dollarsFromCents(cardDepositCents),
        simulatedPayment: true,
      };
    },
);

exports.completeBarrelPoolDepositPayment = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const poolId = cleanText(request.data?.poolId, 160);
      if (!poolId) {
        throw new HttpsError("invalid-argument", "Pool is required");
      }

      const db = admin.firestore();
      const poolRef = db.collection("barrelPools").doc(poolId);
      const participantRef = poolRef.collection("participants")
          .doc(customerUid);
      const [poolDoc, participantDoc] = await Promise.all([
        poolRef.get(),
        participantRef.get(),
      ]);
      if (!poolDoc.exists || !participantDoc.exists) {
        throw new HttpsError(
            "not-found",
            "Shared barrel participant not found",
        );
      }
      const pool = poolDoc.data() || {};
      const participant = participantDoc.data() || {};
      if (participant.paymentStatus === "succeeded") {
        return {
          success: true,
          poolId,
          trackingCode: pool.trackingCode || poolId,
        };
      }
      if (participant.paymentStatus !== "pending") {
        throw new HttpsError(
            "failed-precondition",
            "This shared barrel deposit is not pending payment",
        );
      }

      const intentIds = Array.isArray(participant.stripePaymentIntentIds) ?
        participant.stripePaymentIntentIds :
        [];
      const intentId = intentIds[intentIds.length - 1] || "";
      let sourceTransaction = "";
      if (!SIMULATE_PAYMENTS && !String(intentId).startsWith("simulated_")) {
        if (!intentId) {
          throw new HttpsError(
              "failed-precondition",
              "Missing shared barrel deposit payment intent",
          );
        }
        const intent = await retrieveStripePaymentIntent(intentId);
        if (intent.status !== "succeeded") {
          await Promise.all([
            participantRef.update({
              paymentStatus: intent.status,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }),
            poolRef.update({
              [`publicParticipants.${customerUid}.paymentStatus`]:
                intent.status,
              [`publicParticipants.${customerUid}.updatedAt`]:
                admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }),
          ]);
          throw new HttpsError(
              "failed-precondition",
              `Payment is ${intent.status}`,
          );
        }
        sourceTransaction = stripeSourceTransactionFromIntent(intent);
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const nextStatus = pool.status === "pending_payment" ?
        poolStatusFor(
            Number(pool.openShares || 0),
            Number(pool.takenShares || 0),
        ) :
        pool.status || "open";
      await Promise.all([
        participantRef.update({
          paymentStatus: "succeeded",
          paidAt: now,
          updatedAt: now,
        }),
        poolRef.update({
          status: nextStatus,
          [`publicParticipants.${customerUid}.paymentStatus`]: "succeeded",
          [`publicParticipants.${customerUid}.updatedAt`]: now,
          updatedAt: now,
        }),
        userBarrelPoolRef(db, customerUid, poolId).set({
          status: nextStatus,
          participantPaymentStatus: "succeeded",
          updatedAt: now,
        }, {merge: true}),
      ]);
      await issueBusinessPayoutTransfer({
        ref: participantRef,
        data: {
          ...participant,
          paymentStatus: "succeeded",
          poolId,
          trackingCode: pool.trackingCode || poolId,
          businessId: participant.businessId || pool.businessId || "",
          businessName: participant.businessName || pool.businessName || "",
        },
        sourceTransaction,
        serviceType: "shared_barrel_deposit",
        idempotencySuffix: `${poolId}_${customerUid}_deposit`,
      });

      return {
        success: true,
        poolId,
        trackingCode: pool.trackingCode || poolId,
      };
    },
);

exports.cancelPendingBarrelPoolDeposit = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const poolId = cleanText(request.data?.poolId, 160);
      if (!poolId) {
        throw new HttpsError("invalid-argument", "Pool is required");
      }

      const db = admin.firestore();
      const poolRef = db.collection("barrelPools").doc(poolId);
      const participantRef = poolRef.collection("participants")
          .doc(customerUid);
      const [poolDoc, participantDoc] = await Promise.all([
        poolRef.get(),
        participantRef.get(),
      ]);
      if (!poolDoc.exists || !participantDoc.exists) {
        return {success: true, poolId};
      }
      const participant = participantDoc.data() || {};
      if (participant.paymentStatus !== "pending") {
        return {success: true, poolId};
      }

      const intentIds = Array.isArray(participant.stripePaymentIntentIds) ?
        participant.stripePaymentIntentIds :
        [];
      const intentId = intentIds[intentIds.length - 1] || "";
      if (!SIMULATE_PAYMENTS && intentId) {
        const intent = await retrieveStripePaymentIntent(intentId);
        if (intent.status === "succeeded" || intent.status === "processing") {
          await Promise.all([
            participantRef.update({
              paymentStatus: intent.status,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }),
            poolRef.update({
              [`publicParticipants.${customerUid}.paymentStatus`]:
                intent.status,
              [`publicParticipants.${customerUid}.updatedAt`]:
                admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }),
          ]);
          return {success: true, poolId};
        }
      }

      await db.runTransaction(async (transaction) => {
        const [freshPoolDoc, freshParticipantDoc] = await Promise.all([
          transaction.get(poolRef),
          transaction.get(participantRef),
        ]);
        if (!freshPoolDoc.exists || !freshParticipantDoc.exists) return;
        const freshPool = freshPoolDoc.data() || {};
        const freshParticipant = freshParticipantDoc.data() || {};
        if (freshParticipant.paymentStatus !== "pending") return;
        const now = admin.firestore.FieldValue.serverTimestamp();
        const shares = Number(freshParticipant.sharesClaimed || 0);
        const isOwner = freshParticipant.role === "owner" ||
          freshPool.createdByUid === customerUid;
        if (isOwner) {
          transaction.update(participantRef, {
            joinStatus: "cancelled",
            paymentStatus: "cancelled",
            refundableAmountCents: 0,
            refundableAmount: 0,
            cancelledAt: now,
            updatedAt: now,
          });
          transaction.update(poolRef, {
            status: "cancelled",
            cancelledAt: now,
            cancellationReason: "deposit_payment_cancelled",
            [`publicParticipants.${customerUid}.joinStatus`]: "cancelled",
            [`publicParticipants.${customerUid}.paymentStatus`]: "cancelled",
            [`publicParticipants.${customerUid}.updatedAt`]: now,
            updatedAt: now,
          });
          setUserBarrelPoolMembership({
            transaction,
            uid: customerUid,
            poolId,
            pool: {...freshPool, status: "cancelled"},
            participant: {
              ...freshParticipant,
              joinStatus: "cancelled",
              paymentStatus: "cancelled",
            },
            now,
          });
        } else {
          const wasRequested =
            String(freshParticipant.joinStatus || "") === "requested";
          const nextOpenShares = Number(freshPool.openShares || 0) + shares;
          const nextTakenShares = Math.max(
              0,
              Number(freshPool.takenShares || 0) - shares,
          );
          const nextRequestedShares = Math.max(
              0,
              Number(freshPool.requestedShares || 0) -
                (wasRequested ? shares : 0),
          );
          const nextAcceptedShares = Math.max(
              0,
              Number(freshPool.acceptedShares || 0) -
                (wasRequested ? 0 : shares),
          );
          const nextStatus = poolStatusFor(nextOpenShares, nextTakenShares);
          transaction.update(participantRef, {
            joinStatus: "cancelled",
            paymentStatus: "cancelled",
            refundableAmountCents: 0,
            refundableAmount: 0,
            cancelledAt: now,
            updatedAt: now,
          });
          transaction.update(poolRef, {
            openShares: nextOpenShares,
            takenShares: nextTakenShares,
            requestedShares: nextRequestedShares,
            acceptedShares: nextAcceptedShares,
            status: nextStatus,
            [`publicParticipants.${customerUid}.joinStatus`]: "cancelled",
            [`publicParticipants.${customerUid}.paymentStatus`]: "cancelled",
            [`publicParticipants.${customerUid}.updatedAt`]: now,
            updatedAt: now,
          });
          setUserBarrelPoolMembership({
            transaction,
            uid: customerUid,
            poolId,
            pool: {
              ...freshPool,
              openShares: nextOpenShares,
              takenShares: nextTakenShares,
              requestedShares: nextRequestedShares,
              acceptedShares: nextAcceptedShares,
              status: nextStatus,
            },
            participant: {
              ...freshParticipant,
              joinStatus: "cancelled",
              paymentStatus: "cancelled",
            },
            now,
          });
        }
        const walletAppliedCents = Number(
            freshParticipant.walletAppliedCents || 0,
        );
        if (Number.isFinite(walletAppliedCents) && walletAppliedCents > 0) {
          await creditWallet({
            transaction,
            customerUid,
            amountCents: walletAppliedCents,
            shipmentId: poolId,
            trackingCode: freshPool.trackingCode || poolId,
            reason: "barrel_pool_deposit_reversal",
            businessId: freshPool.businessId,
            businessName: freshPool.businessName,
          });
        }
      });

      return {success: true, poolId};
    },
);

exports.decideBarrelPoolJoin = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const poolId = cleanText(request.data?.poolId, 160);
      const participantUid = cleanText(request.data?.participantUid, 160);
      const decision = cleanText(request.data?.decision, 40);
      if (
        !poolId ||
        !participantUid ||
        !["accept", "reject"].includes(decision)
      ) {
        throw new HttpsError(
            "invalid-argument",
            "Pool, participant, and decision are required",
        );
      }
      const db = admin.firestore();
      const poolRef = db.collection("barrelPools").doc(poolId);
      const participantRef = poolRef.collection("participants")
          .doc(participantUid);
      await db.runTransaction(async (transaction) => {
        const [poolDoc, participantDoc] = await Promise.all([
          transaction.get(poolRef),
          transaction.get(participantRef),
        ]);
        if (!poolDoc.exists || !participantDoc.exists) {
          throw new HttpsError("not-found", "Pool participant not found");
        }
        const pool = poolDoc.data() || {};
        const participant = participantDoc.data() || {};
        ensurePoolCanChange(pool);
        await requirePoolDecisionMaker(callerUid, pool);
        if (participant.joinStatus !== "requested") {
          return;
        }
        const shares = Number(participant.sharesClaimed || 0);
        const now = admin.firestore.FieldValue.serverTimestamp();
        const depositSettled =
          participant.paymentStatus === "succeeded" ||
          participant.paymentStatus === "collected_by_business";
        if (decision === "accept") {
          if (!depositSettled) {
            throw new HttpsError(
                "failed-precondition",
                "The participant deposit must be paid before approval.",
            );
          }
          const nextPool = {
            ...pool,
            requestedShares: Math.max(
                0,
                Number(pool.requestedShares || 0) - shares,
            ),
            acceptedShares: Number(pool.acceptedShares || 0) + shares,
          };
          transaction.update(participantRef, {
            joinStatus: "accepted",
            acceptedAt: now,
            updatedAt: now,
          });
          transaction.update(poolRef, {
            requestedShares: Math.max(
                0,
                Number(pool.requestedShares || 0) - shares,
            ),
            acceptedShares: Number(pool.acceptedShares || 0) + shares,
            [`publicParticipants.${participantUid}.joinStatus`]: "accepted",
            [`publicParticipants.${participantUid}.updatedAt`]: now,
            updatedAt: now,
          });
          setUserBarrelPoolMembership({
            transaction,
            uid: participantUid,
            poolId,
            pool: nextPool,
            participant: {
              ...participant,
              joinStatus: "accepted",
            },
            now,
          });
          return;
        }
        const refundRequest = depositSettled ?
          queuePoolParticipantRefund({
            transaction,
            participant: {...participant, uid: participantUid},
            pool,
            poolId,
            reason: "barrel_pool_join_rejected",
            requestedBy: callerUid,
          }) :
          null;
        const nextPaymentStatus = depositSettled ?
          "refund_pending" :
          "cancelled";
        const nextOpenShares = Number(pool.openShares || 0) + shares;
        const nextTakenShares = Math.max(
            0,
            Number(pool.takenShares || 0) - shares,
        );
        const nextPool = {
          ...pool,
          openShares: nextOpenShares,
          takenShares: nextTakenShares,
          requestedShares: Math.max(
              0,
              Number(pool.requestedShares || 0) - shares,
          ),
          status: poolStatusFor(nextOpenShares, nextTakenShares),
        };
        transaction.update(participantRef, {
          joinStatus: "rejected",
          paymentStatus: nextPaymentStatus,
          refundableAmountCents: 0,
          refundableAmount: 0,
          walletRefundRequestId: depositSettled ?
            refundRequest?.refundRequestId || "" :
            admin.firestore.FieldValue.delete(),
          refundRequestedAt: depositSettled ?
            now :
            admin.firestore.FieldValue.delete(),
          updatedAt: now,
        });
        if (!depositSettled) {
          const walletAppliedCents = Number(
              participant.walletAppliedCents || 0,
          );
          if (Number.isFinite(walletAppliedCents) && walletAppliedCents > 0) {
            await creditWallet({
              transaction,
              customerUid: participantUid,
              amountCents: walletAppliedCents,
              shipmentId: poolId,
              trackingCode: pool.trackingCode || poolId,
              reason: "barrel_pool_join_deposit_reversal",
              businessId: pool.businessId,
              businessName: pool.businessName,
            });
          }
        }
        transaction.update(poolRef, {
          openShares: nextOpenShares,
          takenShares: nextTakenShares,
          requestedShares: Math.max(
              0,
              Number(pool.requestedShares || 0) - shares,
          ),
          status: poolStatusFor(nextOpenShares, nextTakenShares),
          [`publicParticipants.${participantUid}.joinStatus`]: "rejected",
          [`publicParticipants.${participantUid}.paymentStatus`]:
            nextPaymentStatus,
          [`publicParticipants.${participantUid}.updatedAt`]: now,
          updatedAt: now,
        });
        setUserBarrelPoolMembership({
          transaction,
          uid: participantUid,
          poolId,
          pool: nextPool,
          participant: {
            ...participant,
            joinStatus: "rejected",
          },
          now,
        });
      });
      return {success: true, poolId, participantUid, decision};
    },
);

exports.leaveBarrelPool = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const customerUid = requireAuth(request);
      await requireVerifiedCustomerForSharedPool(customerUid);
      const poolId = cleanText(request.data?.poolId, 160);
      if (!poolId) {
        throw new HttpsError("invalid-argument", "Pool is required");
      }
      const db = admin.firestore();
      const poolRef = db.collection("barrelPools").doc(poolId);
      const participantRef = poolRef.collection("participants")
          .doc(customerUid);
      let refundedCents = 0;
      let forfeitedCents = 0;
      await db.runTransaction(async (transaction) => {
        const [poolDoc, participantDoc] = await Promise.all([
          transaction.get(poolRef),
          transaction.get(participantRef),
        ]);
        if (!poolDoc.exists || !participantDoc.exists) {
          throw new HttpsError("not-found", "Pool participant not found");
        }
        const pool = poolDoc.data() || {};
        const participant = participantDoc.data() || {};
        ensurePoolCanChange(pool);
        if (participant.role === "owner" || pool.createdByUid === customerUid) {
          throw new HttpsError(
              "failed-precondition",
              "Pool owners must cancel the shared barrel instead",
          );
        }
        const joinStatus = String(participant.joinStatus || "");
        if (!BARREL_POOL_ACTIVE_JOIN_STATUSES.has(joinStatus)) {
          throw new HttpsError(
              "failed-precondition",
              "This participant is not active in the pool",
          );
        }
        const shares = Number(participant.sharesClaimed || 0);
        const now = admin.firestore.FieldValue.serverTimestamp();
        const isRequested = joinStatus === "requested";
        const shouldRefund = isRequested || participantWithinPoolGrace(
            participant,
        );
        refundedCents = shouldRefund ?
          Number(participant.refundableAmountCents || 0) :
          0;
        forfeitedCents = shouldRefund ?
          0 :
          Number(participant.depositAmountCents || 0);
        let refundRequest = null;
        if (shouldRefund) {
          refundRequest = queuePoolParticipantRefund({
            transaction,
            participant: {...participant, uid: customerUid},
            pool,
            poolId,
            reason: "barrel_pool_participant_left",
            requestedBy: customerUid,
          });
        }
        const nextOpenShares = Number(pool.openShares || 0) + shares;
        const nextTakenShares = Math.max(
            0,
            Number(pool.takenShares || 0) - shares,
        );
        const nextRequestedShares = Math.max(
            0,
            Number(pool.requestedShares || 0) -
              (isRequested ? shares : 0),
        );
        const nextAcceptedShares = Math.max(
            0,
            Number(pool.acceptedShares || 0) -
              (isRequested ? 0 : shares),
        );
        const nextJoinStatus = shouldRefund ? "cancelled" : "forfeited";
        const nextPaymentStatus = shouldRefund ?
          "refund_pending" :
          "forfeited";
        const nextPool = {
          ...pool,
          openShares: nextOpenShares,
          takenShares: nextTakenShares,
          requestedShares: nextRequestedShares,
          acceptedShares: nextAcceptedShares,
          status: poolStatusFor(nextOpenShares, nextTakenShares),
        };
        transaction.update(participantRef, {
          joinStatus: nextJoinStatus,
          paymentStatus: nextPaymentStatus,
          refundableAmountCents: 0,
          refundableAmount: 0,
          walletRefundRequestId: shouldRefund ?
            refundRequest?.refundRequestId || "" :
            admin.firestore.FieldValue.delete(),
          leftAt: now,
          refundRequestedAt: shouldRefund ?
            now :
            admin.firestore.FieldValue.delete(),
          depositForfeitureStatus: shouldRefund ? "none" : "forfeited",
          updatedAt: now,
        });
        transaction.update(poolRef, {
          openShares: nextOpenShares,
          takenShares: nextTakenShares,
          requestedShares: nextRequestedShares,
          acceptedShares: nextAcceptedShares,
          forfeitedDepositAmountCents:
            admin.firestore.FieldValue.increment(forfeitedCents),
          forfeitedDepositAmount:
            admin.firestore.FieldValue.increment(
                dollarsFromCents(forfeitedCents),
            ),
          status: poolStatusFor(nextOpenShares, nextTakenShares),
          [`publicParticipants.${customerUid}.joinStatus`]: nextJoinStatus,
          [`publicParticipants.${customerUid}.paymentStatus`]:
            nextPaymentStatus,
          [`publicParticipants.${customerUid}.updatedAt`]: now,
          updatedAt: now,
        });
        setUserBarrelPoolMembership({
          transaction,
          uid: customerUid,
          poolId,
          pool: nextPool,
          participant: {
            ...participant,
            joinStatus: nextJoinStatus,
          },
          now,
        });
        if (pool.createdByUid && pool.createdByUid !== customerUid) {
          const ownerSummary =
            (pool.publicParticipants || {})[pool.createdByUid] || {};
          setUserBarrelPoolMembership({
            transaction,
            uid: pool.createdByUid,
            poolId,
            pool: nextPool,
            participant: {
              role: "owner",
              joinStatus: "accepted",
              sharesClaimed: Number(ownerSummary.sharesClaimed || 0),
            },
            now,
          });
        }
      });
      return {
        success: true,
        poolId,
        refundedAmount: dollarsFromCents(refundedCents),
        forfeitedAmount: dollarsFromCents(forfeitedCents),
      };
    },
);

exports.cancelBarrelPool = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const poolId = cleanText(request.data?.poolId, 160);
      if (!poolId) {
        throw new HttpsError("invalid-argument", "Pool is required");
      }
      const db = admin.firestore();
      const poolRef = db.collection("barrelPools").doc(poolId);
      const poolDoc = await poolRef.get();
      if (!poolDoc.exists) {
        throw new HttpsError("not-found", "Shared barrel pool not found");
      }
      const pool = poolDoc.data() || {};
      ensurePoolCanChange(pool);
      await requirePoolDecisionMaker(callerUid, pool);
      const participants = await poolRef.collection("participants").get();
      await db.runTransaction(async (transaction) => {
        const now = admin.firestore.FieldValue.serverTimestamp();
        const ownerCancellation = callerUid === pool.createdByUid;
        const nextPool = {
          ...pool,
          status: "cancelled",
        };
        transaction.update(poolRef, {
          status: "cancelled",
          cancelledAt: now,
          cancelledBy: callerUid,
          updatedAt: now,
        });
        participants.docs.forEach((doc) => {
          const participant = doc.data() || {};
          const participantPaid = participant.paymentStatus === "succeeded";
          const ownerForfeits = ownerCancellation &&
            participant.role === "owner" &&
            participantPaid;
          const nextJoinStatus = ownerForfeits ? "forfeited" :
            BARREL_POOL_ACTIVE_JOIN_STATUSES.has(
                String(participant.joinStatus || ""),
            ) ?
            "cancelled" :
            participant.joinStatus;
          const nextPaymentStatus = ownerForfeits ? "forfeited" :
            participantPaid ?
            "refund_pending" :
            participant.paymentStatus || "not_required";
          if (ownerForfeits) {
            const forfeitedCents = Number(
                participant.depositAmountCents || 0,
            );
            transaction.update(doc.ref, {
              joinStatus: nextJoinStatus,
              paymentStatus: nextPaymentStatus,
              refundableAmountCents: 0,
              refundableAmount: 0,
              depositForfeitureStatus: "forfeited",
              forfeitedAt: now,
              updatedAt: now,
            });
            transaction.update(poolRef, {
              forfeitedDepositAmountCents:
                admin.firestore.FieldValue.increment(forfeitedCents),
              forfeitedDepositAmount:
                admin.firestore.FieldValue.increment(
                    dollarsFromCents(forfeitedCents),
                ),
            });
          } else if (participantPaid) {
            const refundRequest = queuePoolParticipantRefund({
              transaction,
              participant: {...participant, uid: doc.id},
              pool,
              poolId,
              reason: "barrel_pool_cancelled",
              requestedBy: callerUid,
            });
            transaction.update(doc.ref, {
              joinStatus: nextJoinStatus,
              paymentStatus: nextPaymentStatus,
              refundableAmountCents: 0,
              refundableAmount: 0,
              walletRefundRequestId: refundRequest?.refundRequestId || "",
              refundRequestedAt: now,
              updatedAt: now,
            });
          } else if (BARREL_POOL_ACTIVE_JOIN_STATUSES.has(
              String(participant.joinStatus || ""),
          )) {
            transaction.update(doc.ref, {
              joinStatus: nextJoinStatus,
              updatedAt: now,
            });
          }
          transaction.update(poolRef, {
            [`publicParticipants.${doc.id}.joinStatus`]: nextJoinStatus,
            [`publicParticipants.${doc.id}.paymentStatus`]: nextPaymentStatus,
            [`publicParticipants.${doc.id}.updatedAt`]: now,
          });
          setUserBarrelPoolMembership({
            transaction,
            uid: doc.id,
            poolId,
            pool: nextPool,
            participant: {
              ...participant,
              joinStatus: nextJoinStatus,
            },
            now,
          });
        });
      });
      return {success: true, poolId};
    },
);

exports.sealBarrelPool = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const poolId = cleanText(request.data?.poolId, 160);
      if (!poolId) {
        throw new HttpsError("invalid-argument", "Pool is required");
      }
      const db = admin.firestore();
      const poolRef = db.collection("barrelPools").doc(poolId);
      const poolDoc = await poolRef.get();
      if (!poolDoc.exists) {
        throw new HttpsError("not-found", "Shared barrel pool not found");
      }
      const pool = poolDoc.data() || {};
      ensurePoolCanChange(pool);
      await requireBusinessPermission(callerUid, pool.businessId, "barrels");
      const serviceFeesDoc = await db.collection("shipmentPricing")
          .doc("serviceFees")
          .get();
      const businessForFeeDoc = pool.businessId ?
        await db.collection("businesses").doc(pool.businessId).get() :
        null;
      const platformFeePct = sharedBarrelPlatformFeePctFromPricing(
          serviceFeesDoc.data(),
          businessForFeeDoc?.exists ? businessForFeeDoc.data() : pool,
      );
      const participants = await poolRef.collection("participants")
          .where("joinStatus", "==", "accepted")
          .get();
      if (participants.empty) {
        throw new HttpsError(
            "failed-precondition",
            "No accepted participants are ready to seal",
        );
      }
      if (
        Number(pool.openShares || 0) > 0 &&
        request.data?.shipUnderfilled !== true
      ) {
        throw new HttpsError(
            "failed-precondition",
            "This pool still has open shares",
        );
      }
      if (
        Number(pool.openShares || 0) > 0 &&
        request.data?.shipUnderfilled === true
      ) {
        const deadlineMillis = timestampMillis(pool.joinDeadline);
        if (!deadlineMillis || deadlineMillis > Date.now()) {
          throw new HttpsError(
              "failed-precondition",
              "Underfilled pools can only ship after the join deadline",
          );
        }
      }
      const shipmentRef = db.collection("barrelShipments").doc();
      const shipmentTracking = await generateTrackingCode(
          "BS",
          "barrelShipments",
      );
      const participantRows = participants.docs.map((doc) => ({
        uid: doc.id,
        ...(doc.data() || {}),
      }));
      const unpaidParticipant = participantRows.find((participant) => {
        const paymentStatus = String(participant.paymentStatus || "");
        return !["succeeded", "collected_by_business", "not_required"]
            .includes(paymentStatus);
      });
      if (unpaidParticipant) {
        throw new HttpsError(
            "failed-precondition",
            "All accepted shared barrel deposits must be paid before sealing.",
        );
      }
      const accounting = sharedPoolSealAccounting({
        pool,
        participantRows,
        shipUnderfilled: request.data?.shipUnderfilled === true,
        platformFeePct,
      });
      const owner = participantRows.find((item) => item.role === "owner") ||
        participantRows[0];
      const ownerUid = String(owner.uid || "");
      const receiverSummary = participantRows
          .map((item) => cleanText(item.receiverName, 120))
          .filter(Boolean)
          .join(", ");
      const now = admin.firestore.FieldValue.serverTimestamp();
      const batch = db.batch();
      const participantBalanceWithUnderfill = (participant) =>
        Number(participant.balanceAmountCents || 0) +
        (String(participant.uid || "") === ownerUid ?
          accounting.underfilledAmountCents :
          0);
      const hasManualBalanceDue = !SIMULATE_PAYMENTS &&
        participantRows.some((participant) =>
          participantBalanceWithUnderfill(participant) > 0 &&
          participant.paymentStatus !== "collected_by_business",
        );
      batch.set(shipmentRef, {
        trackingCode: shipmentTracking,
        sharedPoolId: poolId,
        sharedPoolTrackingCode: pool.trackingCode || poolId,
        senderName: `${participantRows.length} shared senders`,
        senderAddress: pool.holderRole === "business" ?
          `${pool.businessName} hub` :
          cleanText(owner.senderAddress, 240),
        receiverName: receiverSummary || "Multiple receivers",
        receiverPhone: cleanText(owner.receiverPhone, 80),
        destinationCountryId: pool.destinationCountryId,
        destinationCountryName: pool.destinationCountryName,
        businessId: pool.businessId,
        businessName: pool.businessName,
        customerUid: pool.createdByUid,
        customerEmail: cleanText(owner.customerEmail, 160),
        pickupRequested: participantRows.some((item) => item.pickupRequested),
        pickupAddress: "",
        pickupBorough: "Shared barrel",
        pickupMiles: 0,
        pickupFee: 0,
        shippingFee: dollarsFromCents(accounting.grossAmountCents),
        pricingPendingReview: false,
        price: dollarsFromCents(accounting.grossAmountCents),
        sharedPoolParticipantDepositAmount:
          dollarsFromCents(accounting.participantDepositCents),
        sharedPoolParticipantDepositAmountCents:
          accounting.participantDepositCents,
        sharedPoolBalanceAmount:
          dollarsFromCents(accounting.participantBalanceCents),
        sharedPoolBalanceAmountCents: accounting.participantBalanceCents,
        sharedPoolUnderfilledShares: accounting.underfilledShares,
        sharedPoolUnderfilledAmount:
          dollarsFromCents(accounting.underfilledAmountCents),
        sharedPoolUnderfilledAmountCents: accounting.underfilledAmountCents,
        grossAmount: dollarsFromCents(accounting.grossAmountCents),
        grossAmountCents: accounting.grossAmountCents,
        platformCommissionRate: platformFeePct,
        platformCommissionAmount:
          dollarsFromCents(accounting.platformCommissionCents),
        platformCommissionAmountCents: accounting.platformCommissionCents,
        businessPayoutAmount:
          dollarsFromCents(accounting.businessPayoutCents),
        businessPayoutAmountCents: accounting.businessPayoutCents,
        paymentStatus: hasManualBalanceDue ? "balance_due" : "succeeded",
        status: hasManualBalanceDue ? "pending_payment" : "pending",
        ...deliveryEstimateFromCountry(pool),
        createdAt: now,
        updatedAt: now,
        ...(hasManualBalanceDue ? {} : {paidAt: now}),
      });
      const poolSealUpdate = {
        status: "sealed",
        sealedAt: now,
        sealedBy: callerUid,
        shipmentId: shipmentRef.id,
        shipmentTrackingCode: shipmentTracking,
        balancePaymentStatus: hasManualBalanceDue ? "balance_due" : "succeeded",
        participantDepositAmount:
          dollarsFromCents(accounting.participantDepositCents),
        participantDepositAmountCents: accounting.participantDepositCents,
        participantBalanceAmount:
          dollarsFromCents(accounting.participantBalanceCents),
        participantBalanceAmountCents: accounting.participantBalanceCents,
        underfilledShares: accounting.underfilledShares,
        underfilledAmount:
          dollarsFromCents(accounting.underfilledAmountCents),
        underfilledAmountCents: accounting.underfilledAmountCents,
        grossAmount: dollarsFromCents(accounting.grossAmountCents),
        grossAmountCents: accounting.grossAmountCents,
        platformCommissionRate: platformFeePct,
        platformCommissionAmount:
          dollarsFromCents(accounting.platformCommissionCents),
        platformCommissionAmountCents: accounting.platformCommissionCents,
        businessPayoutAmount:
          dollarsFromCents(accounting.businessPayoutCents),
        businessPayoutAmountCents: accounting.businessPayoutCents,
        payoutStatus: hasManualBalanceDue ?
          "pending_participant_payments" :
          "paid_via_participant_payments",
        updatedAt: now,
      };
      participantRows.forEach((participant) => {
        const membershipRef = userBarrelPoolRef(db, participant.uid, poolId);
        const underfilledBalanceCents =
          String(participant.uid || "") === ownerUid ?
          accounting.underfilledAmountCents :
          0;
        const balanceCents = Number(participant.balanceAmountCents || 0) +
          underfilledBalanceCents;
        const balanceIntentId = balanceCents > 0 && SIMULATE_PAYMENTS ?
          simulatedPoolBalanceIntent(poolId, participant.uid) :
          "";
        const needsManualBalance = !SIMULATE_PAYMENTS &&
          balanceCents > 0 &&
          participant.paymentStatus !== "collected_by_business";
        const balanceRequest = needsManualBalance ?
          queuePoolParticipantBalancePayment({
            batch,
            participant: {
              ...participant,
              balanceAmountCents: balanceCents,
              balanceAmount: dollarsFromCents(balanceCents),
              underfilledBalanceAmountCents: underfilledBalanceCents,
            },
            pool,
            poolId,
            shipmentId: shipmentRef.id,
            shipmentTrackingCode: shipmentTracking,
            platformFeePct,
            requestedBy: callerUid,
          }) :
          null;
        const participantBalanceStatus = needsManualBalance ?
          "balance_due" :
          "succeeded";
        const participantSealUpdate = {
          balancePaymentStatus: participantBalanceStatus,
          balanceDueAmount: dollarsFromCents(balanceCents),
          balanceDueAmountCents: balanceCents,
          underfilledBalanceAmount: dollarsFromCents(
              underfilledBalanceCents,
          ),
          underfilledBalanceAmountCents: underfilledBalanceCents,
          paymentStatus: participantBalanceStatus,
          sealedAt: now,
          updatedAt: now,
          ...(participantBalanceStatus === "succeeded" ? {
            balancePaidAmount: dollarsFromCents(balanceCents),
            balancePaidAmountCents: balanceCents,
            balancePaidAt: now,
          } : {
            balancePaymentRequestId:
              balanceRequest?.balanceRequestId || "",
            balancePaymentRequestedAt: now,
          }),
          ...(balanceIntentId ? {
            balanceStripePaymentIntentIds:
              admin.firestore.FieldValue.arrayUnion(balanceIntentId),
          } : {}),
        };
        batch.update(
            poolRef.collection("participants").doc(participant.uid),
            participantSealUpdate,
        );
        if (!String(participant.uid || "").startsWith("dropoff_")) {
          batch.set(membershipRef, {
            poolId,
            businessId: pool.businessId || "",
            businessName: pool.businessName || "",
            destinationCountryId: pool.destinationCountryId || "",
            destinationCountryName: pool.destinationCountryName || "",
            origin: pool.origin || "customerPosted",
            holderRole: pool.holderRole || "customer",
            createdByUid: pool.createdByUid || "",
            createdByRole: pool.createdByRole || "",
            totalShares: Number(pool.totalShares || 0),
            openShares: Number(pool.openShares || 0),
            sharesAvailable: Number(pool.openShares || 0),
            pricePerShare: Number(pool.pricePerShare || 0),
            depositPerShare: Number(pool.depositPerShare || 0),
            currency: pool.currency || SHIPMENT_CURRENCY,
            shipMode: pool.shipMode || "sea",
            joinDeadline: pool.joinDeadline || null,
            status: "sealed",
            trackingCode: pool.trackingCode || poolId,
            approvalMode: pool.approvalMode || "approval",
            participantRole: participant.role || "joiner",
            participantJoinStatus: participant.joinStatus || "accepted",
            sharesClaimed: Number(participant.sharesClaimed || 0),
            participantPaymentStatus: participantBalanceStatus,
            balancePaymentStatus: participantBalanceStatus,
            balanceDueAmount: dollarsFromCents(balanceCents),
            balanceDueAmountCents: balanceCents,
            balancePaymentRequestId:
              balanceRequest?.balanceRequestId || "",
            underfilledBalanceAmount: dollarsFromCents(
                underfilledBalanceCents,
            ),
            underfilledBalanceAmountCents: underfilledBalanceCents,
            shipmentId: shipmentRef.id,
            shipmentTrackingCode: shipmentTracking,
            updatedAt: now,
          }, {merge: true});
        }
        poolSealUpdate[`publicParticipants.${participant.uid}.paymentStatus`] =
          participantBalanceStatus;
        poolSealUpdate[`publicParticipants.${participant.uid}.updatedAt`] = now;
      });
      batch.update(poolRef, poolSealUpdate);
      await batch.commit();
      return {
        success: true,
        poolId,
        shipmentId: shipmentRef.id,
        trackingCode: shipmentTracking,
      };
    },
);

exports.createBarrelPoolBalancePaymentIntent = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const requestId = cleanText(request.data?.requestId, 160);
      const poolId = cleanText(request.data?.poolId, 160);
      if (!requestId && !poolId) {
        throw new HttpsError(
            "invalid-argument",
            "Balance request or pool is required",
        );
      }

      const db = admin.firestore();
      let requestRef = requestId ?
        db.collection("barrelPoolBalanceRequests").doc(requestId) :
        null;
      if (!requestRef) {
        const snapshot = await db.collection("barrelPoolBalanceRequests")
            .where("barrelPoolId", "==", poolId)
            .where("customerUid", "==", customerUid)
            .where("status", "==", "pending")
            .limit(1)
            .get();
        if (snapshot.empty) {
          throw new HttpsError(
              "not-found",
              "Shared barrel balance request not found",
          );
        }
        requestRef = snapshot.docs[0].ref;
      }

      const requestDoc = await requestRef.get();
      if (!requestDoc.exists) {
        throw new HttpsError(
            "not-found",
            "Shared barrel balance request not found",
        );
      }
      const balanceRequest = requestDoc.data() || {};
      if (balanceRequest.customerUid !== customerUid) {
        throw new HttpsError(
            "permission-denied",
            "Shared barrel balance access denied",
        );
      }
      if (balanceRequest.status !== "pending") {
        throw new HttpsError(
            "failed-precondition",
            "Only pending shared barrel balances can be paid",
        );
      }
      const amountCents = Number(balanceRequest.amountCents || 0);
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        throw new HttpsError(
            "failed-precondition",
            "Shared barrel balance amount is invalid",
        );
      }

      const actualPoolId = cleanText(balanceRequest.barrelPoolId, 160);
      const participantUid = cleanText(balanceRequest.participantUid, 160);
      if (!actualPoolId || participantUid !== customerUid) {
        throw new HttpsError(
            "failed-precondition",
            "Shared barrel balance request is missing participant context",
        );
      }

      const poolRef = db.collection("barrelPools").doc(actualPoolId);
      const participantRef = poolRef.collection("participants")
          .doc(customerUid);
      const [poolDoc, participantDoc] = await Promise.all([
        poolRef.get(),
        participantRef.get(),
      ]);
      if (!poolDoc.exists || !participantDoc.exists) {
        throw new HttpsError(
            "not-found",
            "Shared barrel participant not found",
        );
      }
      const pool = poolDoc.data() || {};
      const participant = participantDoc.data() || {};
      if (
        participant.balancePaymentRequestId &&
        participant.balancePaymentRequestId !== requestRef.id
      ) {
        throw new HttpsError(
            "failed-precondition",
            "Participant has a different active balance request",
        );
      }
      if (
        participant.balancePaymentStatus !== "balance_due" &&
        participant.paymentStatus !== "balance_due"
      ) {
        throw new HttpsError(
            "failed-precondition",
            "This shared barrel balance is not due",
        );
      }

      if (SIMULATE_PAYMENTS) {
        return {
          requestId: requestRef.id,
          poolId: actualPoolId,
          simulatedPayment: true,
          amount: dollarsFromCents(amountCents),
        };
      }

      const paymentIntent = await createStripePaymentIntent({
        amount: amountCents,
        currency: balanceRequest.currency || pool.currency || SHIPMENT_CURRENCY,
        metadata: {
          requestId: requestRef.id,
          poolId: actualPoolId,
          participantUid: customerUid,
          customerUid,
          businessId: pool.businessId || "",
          paymentType: "barrel_pool_balance",
        },
      });
      const now = admin.firestore.FieldValue.serverTimestamp();
      await Promise.all([
        requestRef.update({
          stripePaymentIntentId: paymentIntent.id,
          updatedAt: now,
        }),
        participantRef.update({
          balanceStripePaymentIntentIds:
            admin.firestore.FieldValue.arrayUnion(paymentIntent.id),
          updatedAt: now,
        }),
      ]);

      return {
        requestId: requestRef.id,
        poolId: actualPoolId,
        clientSecret: paymentIntent.client_secret,
        amount: dollarsFromCents(amountCents),
      };
    },
);

exports.completeBarrelPoolBalancePayment = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const requestId = cleanText(request.data?.requestId, 160);
      if (!requestId) {
        throw new HttpsError("invalid-argument", "Balance request is required");
      }

      const db = admin.firestore();
      const requestRef = db.collection("barrelPoolBalanceRequests")
          .doc(requestId);
      const requestDoc = await requestRef.get();
      if (!requestDoc.exists) {
        throw new HttpsError(
            "not-found",
            "Shared barrel balance request not found",
        );
      }
      const requestData = requestDoc.data() || {};
      if (requestData.customerUid !== customerUid) {
        throw new HttpsError(
            "permission-denied",
            "Shared barrel balance access denied",
        );
      }
      if (requestData.status !== "pending") {
        throw new HttpsError(
            "failed-precondition",
            "Only pending shared barrel balances can be paid",
        );
      }
      const requestAmountCents = Number(requestData.amountCents || 0);
      if (!Number.isFinite(requestAmountCents) || requestAmountCents <= 0) {
        throw new HttpsError(
            "failed-precondition",
            "Shared barrel balance amount is invalid",
        );
      }
      const requestIntentId = cleanText(
          requestData.stripePaymentIntentId,
          160,
      );
      let sourceTransaction = "";
      if (!SIMULATE_PAYMENTS) {
        if (!requestIntentId) {
          throw new HttpsError(
              "failed-precondition",
              "Missing shared barrel balance payment intent",
          );
        }
        const intent = await retrieveStripePaymentIntent(requestIntentId);
        if (intent.status !== "succeeded") {
          await requestRef.update({
            paymentStatus: intent.status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          throw new HttpsError(
              "failed-precondition",
              `Payment is ${intent.status}`,
          );
        }
        sourceTransaction = stripeSourceTransactionFromIntent(intent);
      }

      await db.runTransaction(async (transaction) => {
        const freshRequestDoc = await transaction.get(requestRef);
        if (!freshRequestDoc.exists) {
          throw new HttpsError(
              "not-found",
              "Shared barrel balance request not found",
          );
        }
        const freshRequest = freshRequestDoc.data() || {};
        if (freshRequest.customerUid !== customerUid) {
          throw new HttpsError(
              "permission-denied",
              "Shared barrel balance access denied",
          );
        }
        if (freshRequest.status !== "pending") {
          throw new HttpsError(
              "failed-precondition",
              "Only pending shared barrel balances can be paid",
          );
        }
        const amountCents = Number(freshRequest.amountCents || 0);
        if (!Number.isFinite(amountCents) || amountCents <= 0) {
          throw new HttpsError(
              "failed-precondition",
              "Shared barrel balance amount is invalid",
          );
        }

        const poolId = cleanText(freshRequest.barrelPoolId, 160);
        const participantUid = cleanText(freshRequest.participantUid, 160);
        if (!poolId || participantUid !== customerUid) {
          throw new HttpsError(
              "failed-precondition",
              "Shared barrel balance request is missing participant context",
          );
        }
        const poolRef = db.collection("barrelPools").doc(poolId);
        const participantRef = poolRef.collection("participants")
            .doc(participantUid);
        const shipmentId = cleanText(freshRequest.shipmentId, 160);
        const shipmentRef = shipmentId ?
          db.collection("barrelShipments").doc(shipmentId) :
          null;
        const notificationQuery = db.collection("platformNotifications")
            .where("barrelPoolBalanceRequestId", "==", requestId)
            .limit(10);
        const [poolDoc, participantDoc, shipmentDoc, participantSnapshot,
          notificationSnapshot] = await Promise.all([
          transaction.get(poolRef),
          transaction.get(participantRef),
          shipmentRef ? transaction.get(shipmentRef) : Promise.resolve(null),
          transaction.get(poolRef.collection("participants")
              .where("joinStatus", "==", "accepted")),
          transaction.get(notificationQuery),
        ]);
        if (!poolDoc.exists || !participantDoc.exists) {
          throw new HttpsError(
              "not-found",
              "Shared barrel participant not found",
          );
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        const amount = dollarsFromCents(amountCents);
        transaction.update(participantRef, {
          paymentStatus: "succeeded",
          balancePaymentStatus: "succeeded",
          balancePaidAmount: amount,
          balancePaidAmountCents: amountCents,
          balancePaidAt: now,
          updatedAt: now,
        });
        transaction.set(userBarrelPoolRef(db, participantUid, poolId), {
          participantPaymentStatus: "succeeded",
          balancePaymentStatus: "succeeded",
          balancePaidAmount: amount,
          balancePaidAmountCents: amountCents,
          balancePaidAt: now,
          updatedAt: now,
        }, {merge: true});
        transaction.update(requestRef, {
          status: "completed",
          paymentStatus: "succeeded",
          paidAt: now,
          reviewedAt: now,
          reviewedBy: customerUid,
          updatedAt: now,
        });
        notificationSnapshot.docs.forEach((doc) => {
          transaction.update(doc.ref, {
            status: "resolved",
            resolvedAt: now,
            resolvedBy: customerUid,
            updatedAt: now,
          });
        });

        const remainingDue = hasRemainingSharedPoolBalanceDue(
            participantSnapshot.docs,
            participantUid,
        );
        const poolUpdate = {
          [`publicParticipants.${participantUid}.paymentStatus`]: "succeeded",
          [`publicParticipants.${participantUid}.updatedAt`]: now,
          updatedAt: now,
        };
        if (!remainingDue) {
          poolUpdate.balancePaymentStatus = "succeeded";
          poolUpdate.balancePaidAt = now;
          if (shipmentDoc && shipmentDoc.exists) {
            transaction.update(shipmentRef, {
              paymentStatus: "succeeded",
              status: shipmentDoc.data()?.status === "pending_payment" ?
                "pending" :
                shipmentDoc.data()?.status || "pending",
              paidAt: now,
              updatedAt: now,
            });
          }
        }
        transaction.update(poolRef, poolUpdate);
      });
      await issueBusinessPayoutTransfer({
        ref: requestRef,
        data: {
          ...requestData,
          paymentStatus: "succeeded",
          poolId: requestData.barrelPoolId || "",
          trackingCode: requestData.trackingCode || requestId,
        },
        sourceTransaction,
        serviceType: "shared_barrel_balance",
        idempotencySuffix: `${requestId}_balance`,
      });

      return {success: true, requestId};
    },
);

exports.markBarrelPoolBalanceCollected = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const callerUid = requireAuth(request);
      const requestId = cleanText(request.data?.requestId, 160);
      const note = cleanText(request.data?.note, 500);
      if (!requestId) {
        throw new HttpsError("invalid-argument", "Balance request is required");
      }

      const db = admin.firestore();
      const requestRef = db.collection("barrelPoolBalanceRequests")
          .doc(requestId);
      const requestDoc = await requestRef.get();
      if (!requestDoc.exists) {
        throw new HttpsError(
            "not-found",
            "Shared barrel balance request not found",
        );
      }
      const requestData = requestDoc.data() || {};
      const businessId = cleanText(requestData.businessId, 160);
      const callerUser = await getUserProfile(callerUid);
      if (callerUser.role === "admin") {
        requireAdminCapability(
            callerUser,
            "finance",
            "Only finance admins can reconcile shared barrel balances",
        );
        if (!hasServiceAccess(callerUser, "barrelShipping")) {
          throw new HttpsError(
              "permission-denied",
              "Your role is not allowed to manage barrel shipping finance",
          );
        }
      } else {
        await requireBusinessPermission(callerUid, businessId, "barrels");
      }

      await db.runTransaction(async (transaction) => {
        const freshRequestDoc = await transaction.get(requestRef);
        if (!freshRequestDoc.exists) {
          throw new HttpsError(
              "not-found",
              "Shared barrel balance request not found",
          );
        }
        const freshRequest = freshRequestDoc.data() || {};
        if (freshRequest.status !== "pending") {
          throw new HttpsError(
              "failed-precondition",
              "Only pending shared barrel balance requests can be collected",
          );
        }
        const amountCents = Number(freshRequest.amountCents || 0);
        if (!Number.isFinite(amountCents) || amountCents <= 0) {
          throw new HttpsError(
              "failed-precondition",
              "Shared barrel balance amount is invalid",
          );
        }

        const poolId = cleanText(freshRequest.barrelPoolId, 160);
        const participantUid = cleanText(freshRequest.participantUid, 160);
        if (!poolId || !participantUid) {
          throw new HttpsError(
              "failed-precondition",
              "Shared barrel balance request is missing pool context",
          );
        }

        const poolRef = db.collection("barrelPools").doc(poolId);
        const participantRef = poolRef.collection("participants")
            .doc(participantUid);
        const shipmentId = cleanText(freshRequest.shipmentId, 160);
        const shipmentRef = shipmentId ?
          db.collection("barrelShipments").doc(shipmentId) :
          null;
        const notificationQuery = db.collection("platformNotifications")
            .where("barrelPoolBalanceRequestId", "==", requestId)
            .limit(10);
        const [poolDoc, participantDoc, shipmentDoc, participantSnapshot,
          notificationSnapshot] = await Promise.all([
          transaction.get(poolRef),
          transaction.get(participantRef),
          shipmentRef ? transaction.get(shipmentRef) : Promise.resolve(null),
          transaction.get(poolRef.collection("participants")
              .where("joinStatus", "==", "accepted")),
          transaction.get(notificationQuery),
        ]);
        if (!poolDoc.exists) {
          throw new HttpsError("not-found", "Shared barrel pool not found");
        }
        if (!participantDoc.exists) {
          throw new HttpsError(
              "not-found",
              "Shared barrel participant not found",
          );
        }
        const pool = poolDoc.data() || {};
        if (cleanText(pool.businessId, 160) !== businessId) {
          throw new HttpsError(
              "failed-precondition",
              "Shared barrel balance request does not match the pool business",
          );
        }
        const participant = participantDoc.data() || {};
        if (
          participant.balancePaymentRequestId &&
          participant.balancePaymentRequestId !== requestId
        ) {
          throw new HttpsError(
              "failed-precondition",
              "Participant has a different active balance request",
          );
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        const amount = dollarsFromCents(amountCents);
        const currency = freshRequest.currency || pool.currency ||
          SHIPMENT_CURRENCY;
        const participantUpdate = {
          paymentStatus: "collected_by_business",
          balancePaymentStatus: "collected_by_business",
          balancePaidAmount: amount,
          balancePaidAmountCents: amountCents,
          balancePaidAt: now,
          balanceCollectedAt: now,
          balanceCollectedBy: callerUid,
          balanceCollectionNote: note,
          updatedAt: now,
        };
        transaction.update(participantRef, participantUpdate);

        if (!participantUid.startsWith("dropoff_")) {
          transaction.set(userBarrelPoolRef(db, participantUid, poolId), {
            participantPaymentStatus: "collected_by_business",
            balancePaymentStatus: "collected_by_business",
            balancePaidAmount: amount,
            balancePaidAmountCents: amountCents,
            balancePaidAt: now,
            updatedAt: now,
          }, {merge: true});
        }

        transaction.update(requestRef, {
          status: "completed",
          collectedAt: now,
          collectedBy: callerUid,
          collectionNote: note,
          reviewedAt: now,
          reviewedBy: callerUid,
          updatedAt: now,
        });
        notificationSnapshot.docs.forEach((doc) => {
          transaction.update(doc.ref, {
            status: "resolved",
            resolvedAt: now,
            resolvedBy: callerUid,
            updatedAt: now,
          });
        });

        const remainingDue = hasRemainingSharedPoolBalanceDue(
            participantSnapshot.docs,
            participantUid,
        );
        const poolUpdate = {
          [`publicParticipants.${participantUid}.paymentStatus`]:
            "collected_by_business",
          [`publicParticipants.${participantUid}.updatedAt`]: now,
          updatedAt: now,
        };
        if (!remainingDue) {
          poolUpdate.balancePaymentStatus = "succeeded";
          poolUpdate.balancePaidAt = now;
          if (shipmentDoc && shipmentDoc.exists) {
            transaction.update(shipmentRef, {
              paymentStatus: "succeeded",
              status: shipmentDoc.data()?.status === "pending_payment" ?
                "pending" :
                shipmentDoc.data()?.status || "pending",
              paidAt: now,
              updatedAt: now,
            });
          }
        }
        transaction.update(poolRef, poolUpdate);

        setAdminAuditLog(transaction, {
          action: "barrel_pool_balance_collected",
          actorUid: callerUid,
          targetCollection: "barrelPoolBalanceRequests",
          targetId: requestId,
          targetLabel: `${currency} ${amount}`,
          statusField: "status",
          previousValue: freshRequest.status || "",
          nextValue: "completed",
        });
      });

      return {
        success: true,
        requestId,
        status: "completed",
      };
    },
);

exports.expireBarrelPools = onSchedule(
    "every 24 hours",
    async () => {
      const db = admin.firestore();
      const snapshot = await db.collection("barrelPools")
          .where("status", "in", ["open", "partially_filled"])
          .where("joinDeadline", "<=", admin.firestore.Timestamp.now())
          .limit(100)
          .get();
      await Promise.all(snapshot.docs.map(async (doc) => {
        const poolRef = doc.ref;
        await db.runTransaction(async (transaction) => {
          const [poolDoc, participants] = await Promise.all([
            transaction.get(poolRef),
            transaction.get(poolRef.collection("participants")
                .where("joinStatus", "in", ["requested", "accepted"])),
          ]);
          if (!poolDoc.exists) return;
          const pool = poolDoc.data() || {};
          if (!["open", "partially_filled"].includes(String(pool.status))) {
            return;
          }
          const now = admin.firestore.FieldValue.serverTimestamp();
          const nextPool = {
            ...pool,
            status: "expired",
          };
          transaction.update(poolRef, {
            status: "expired",
            expiredAt: now,
            updatedAt: now,
          });
          participants.docs.forEach((participantDoc) => {
            const participant = participantDoc.data() || {};
            const participantUid = participantDoc.id;
            let refundRequest = null;
            if (participant.paymentStatus === "succeeded") {
              refundRequest = queuePoolParticipantRefund({
                transaction,
                participant: {...participant, uid: participantUid},
                pool,
                poolId: poolRef.id,
                reason: "barrel_pool_expired",
              });
            }
            transaction.update(participantDoc.ref, {
              joinStatus: "cancelled",
              paymentStatus: participant.paymentStatus === "succeeded" ?
                "refund_pending" :
                participant.paymentStatus || "not_required",
              refundableAmountCents: 0,
              refundableAmount: 0,
              walletRefundRequestId:
                participant.paymentStatus === "succeeded" ?
                refundRequest?.refundRequestId || "" :
                admin.firestore.FieldValue.delete(),
              refundRequestedAt: participant.paymentStatus === "succeeded" ?
                now :
                admin.firestore.FieldValue.delete(),
              updatedAt: now,
            });
            transaction.update(poolRef, {
              [`publicParticipants.${participantUid}.joinStatus`]:
                "cancelled",
              [`publicParticipants.${participantUid}.paymentStatus`]:
                participant.paymentStatus === "succeeded" ?
                  "refund_pending" :
                  participant.paymentStatus || "not_required",
              [`publicParticipants.${participantUid}.updatedAt`]: now,
            });
            setUserBarrelPoolMembership({
              transaction,
              uid: participantUid,
              poolId: poolRef.id,
              pool: nextPool,
              participant: {
                ...participant,
                joinStatus: "cancelled",
              },
              now,
            });
          });
        });
      }));
      logger.info("Expired shared barrel pools", {count: snapshot.size});
    },
);

exports.syncOpenBarrelMirror = onDocumentWritten(
    "barrelPools/{poolId}",
    async (event) => {
      const db = admin.firestore();
      const mirrorRef = db.collection("openBarrels").doc(event.params.poolId);
      if (!event.data?.after.exists) {
        await mirrorRef.delete();
        return;
      }
      const pool = event.data.after.data() || {};
      const timestamp = admin.firestore.FieldValue.serverTimestamp();
      const payload = buildOpenBarrelMirrorPayload({
        poolId: event.params.poolId,
        pool,
        now: timestamp,
        currency: SHIPMENT_CURRENCY,
        activeStatuses: BARREL_POOL_ACTIVE_STATUSES,
      });
      if (!payload) {
        await mirrorRef.delete();
        return;
      }
      await mirrorRef.set(payload, {merge: false});
    },
);

function normalizeBarrelQuantity(value) {
  const quantity = Number(value ?? 1);
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_BARREL_QUANTITY
  ) {
    throw new HttpsError(
        "invalid-argument",
        `Barrel quantity must be between 1 and ${MAX_BARREL_QUANTITY}`,
    );
  }
  return quantity;
}

function servicePlatformFeePctFromPricing(pricingDoc, keys = []) {
  let raw;
  for (const key of keys) {
    if (pricingDoc?.[key] !== undefined) {
      raw = pricingDoc[key];
      break;
    }
  }
  if (raw === undefined || raw === null) {
    raw = pricingDoc?.platformFeePct ??
      process.env.PLATFORM_SERVICE_FEE_PCT ??
      DEFAULT_PLATFORM_SERVICE_FEE_PCT;
  }
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct < 0 || pct >= 1) return 0;
  return pct;
}

function businessPlatformFeePctFromBusiness(business) {
  const raw = business?.platformFeePct ?? business?.platformCommissionPct;
  if (raw === undefined || raw === null || raw === "") return null;
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct < 0 || pct >= 1) return null;
  return pct;
}

function servicePlatformFeePctForBusiness(pricingDoc, business, keys = []) {
  return businessPlatformFeePctFromBusiness(business) ??
    servicePlatformFeePctFromPricing(pricingDoc, keys);
}

function barrelPlatformFeePctFromPricing(pricingDoc, business) {
  return servicePlatformFeePctForBusiness(pricingDoc, business, [
    "barrelPlatformFeePct",
  ]);
}

function sharedBarrelPlatformFeePctFromPricing(pricingDoc, business) {
  return servicePlatformFeePctForBusiness(pricingDoc, business, [
    "sharedBarrelPlatformFeePct",
    "barrelPlatformFeePct",
  ]);
}

function servicePayoutFields({
  grossCents,
  platformFeePct,
  connectReady,
}) {
  const platformFeeCents = Math.round(grossCents * platformFeePct);
  return {
    platformFeeCents,
    businessPayoutCents: Math.max(0, grossCents - platformFeeCents),
    payoutStatus: connectReady ? "pending" : "pending_account",
  };
}

function barrelLinePayoutFields({
  shippingFeeCents,
  platformFeePct,
  connectReady,
}) {
  return servicePayoutFields({
    grossCents: shippingFeeCents,
    platformFeePct,
    connectReady,
  });
}

function stripeSourceTransactionFromIntent(intent) {
  const charge = intent?.latest_charge;
  if (!charge) return "";
  return typeof charge === "string" ? charge : charge.id || "";
}

async function persistStripeAccountStatus({businessId, account}) {
  const payoutsEnabled =
    account.charges_enabled === true && account.payouts_enabled === true;
  await admin.firestore()
      .collection("businesses")
      .doc(businessId)
      .set(stripeAccountBusinessUpdate(account), {merge: true});
  if (payoutsEnabled) {
    await retryPendingBusinessTransfersForBusiness(businessId);
  }
  return payoutsEnabled;
}

async function businessIdForStripeAccount(accountId) {
  const snapshot = await admin.firestore()
      .collection("businesses")
      .where("stripeAccountId", "==", accountId)
      .limit(1)
      .get();
  return snapshot.empty ? "" : snapshot.docs[0].id;
}

async function issueBarrelShipmentTransfer({
  shipmentRef,
  shipment,
  sourceTransaction,
}) {
  return issueBusinessPayoutTransfer({
    ref: shipmentRef,
    data: shipment,
    sourceTransaction,
    serviceType: shipment.sharedPoolId ? "shared_barrel" : "barrel_shipment",
  });
}

async function issueBusinessPayoutTransfer({
  ref,
  data,
  sourceTransaction = "",
  serviceType = "service_payment",
  payoutCents,
  idempotencySuffix,
  payoutStatusField = "payoutStatus",
  payoutTransferIdField = "payoutTransferId",
  paidOutAtField = "paidOutAt",
  payoutErrorField = "payoutError",
}) {
  if (SIMULATE_PAYMENTS) return;
  if (data[payoutStatusField] === "paid") return;
  const rawPayoutCents = payoutCents ??
    data.businessPayoutCents ??
    data.businessPayoutAmountCents ??
    0;
  const transferCents = Number(rawPayoutCents);
  if (!Number.isFinite(transferCents) || transferCents <= 0) return;
  const businessId = String(data.businessId || "").trim();
  if (!businessId) return;

  const businessDoc = await admin.firestore()
      .collection("businesses")
      .doc(businessId)
      .get();
  const business = businessDoc.exists ? businessDoc.data() : {};
  if (
    !businessDoc.exists ||
    !business.stripeAccountId ||
    business.payoutsEnabled !== true
  ) {
    await ref.update({
      [payoutStatusField]: "pending_account",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return;
  }

  try {
    const transfer = await createStripeTransfer({
      amount: transferCents,
      currency: SHIPMENT_CURRENCY,
      destination: business.stripeAccountId,
      transferGroup: data.orderId || data.poolId || data.sharedPoolId || ref.id,
      sourceTransaction,
      idempotencyKey: `transfer_${idempotencySuffix || ref.id}`,
      metadata: {
        documentPath: ref.path,
        documentId: ref.id,
        shipmentId: data.trackingCode ? ref.id : "",
        orderId: data.orderId || "",
        poolId: data.poolId || data.sharedPoolId || "",
        purchaseId: data.carId ? ref.id : "",
        businessId,
        paymentType: `${serviceType}_payout`,
      },
    });
    await ref.update({
      [payoutStatusField]: "paid",
      [payoutTransferIdField]: transfer.id,
      [paidOutAtField]: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    logger.error("Barrel transfer failed", {
      documentPath: ref.path,
      orderId: data.orderId || "",
      businessId,
      message: error.message,
    });
    await ref.update({
      [payoutStatusField]: "failed",
      [payoutErrorField]: error.message || "Stripe transfer failed",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

async function issueBarrelOrderTransfers({orderId, sourceTransaction = ""}) {
  const snapshot = await admin.firestore()
      .collection("barrelShipments")
      .where("orderId", "==", orderId)
      .get();
  await Promise.all(snapshot.docs.map((doc) =>
    issueBarrelShipmentTransfer({
      shipmentRef: doc.ref,
      shipment: doc.data(),
      sourceTransaction,
    }),
  ));
}

async function retryPendingBusinessTransfersForBusiness(businessId) {
  const db = admin.firestore();
  const collections = [
    {name: "barrelShipments", serviceType: "barrel_shipment"},
    {name: "freightShipments", serviceType: "freight_shipment"},
    {name: "carPurchases", serviceType: "car_purchase"},
    {name: "barrelPoolBalanceRequests", serviceType: "shared_barrel_balance"},
  ];
  const snapshots = await Promise.all(collections.map((collection) =>
    db.collection(collection.name)
        .where("businessId", "==", businessId)
        .where("payoutStatus", "in", ["pending_account", "failed"])
        .limit(50)
        .get()
        .then((snapshot) => ({snapshot, serviceType: collection.serviceType})),
  ));
  await Promise.all(snapshots.flatMap(({snapshot, serviceType}) =>
    snapshot.docs
        .filter((doc) => {
          const data = doc.data();
          return data.paymentStatus === "succeeded" ||
            data.extensionPaymentStatus === "succeeded";
        })
        .map((doc) => issueBusinessPayoutTransfer({
          ref: doc.ref,
          data: doc.data(),
          serviceType,
        })),
  ));
  const participantSnapshot = await db.collectionGroup("participants")
      .where("businessId", "==", businessId)
      .where("payoutStatus", "in", ["pending_account", "failed"])
      .limit(50)
      .get();
  await Promise.all(participantSnapshot.docs
      .filter((doc) => doc.data().paymentStatus === "succeeded")
      .map((doc) => issueBusinessPayoutTransfer({
        ref: doc.ref,
        data: doc.data(),
        serviceType: "shared_barrel_deposit",
      })));
  const extensionSnapshot = await db.collection("carPurchases")
      .where("businessId", "==", businessId)
      .where("extensionPayoutStatus", "in", ["pending_account", "failed"])
      .limit(50)
      .get();
  await Promise.all(extensionSnapshot.docs
      .filter((doc) => doc.data().extensionPaymentStatus === "succeeded")
      .map((doc) => {
        const data = doc.data();
        return issueBusinessPayoutTransfer({
          ref: doc.ref,
          data,
          serviceType: "hold_extension",
          payoutCents: Number(data.extensionBusinessPayoutCents || 0),
          idempotencySuffix:
            `${doc.id}_hold_extension_${data.extensionPaymentIntentId || ""}`,
          payoutStatusField: "extensionPayoutStatus",
          payoutTransferIdField: "extensionPayoutTransferId",
          paidOutAtField: "extensionPaidOutAt",
          payoutErrorField: "extensionPayoutError",
        });
      }));
}

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
        businessId,
        quantity,
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
      const barrelQuantity = normalizeBarrelQuantity(quantity);

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
      const platformFeePct = barrelPlatformFeePctFromPricing(
          pricingDoc.data(),
          business,
      );
      const pickup = wantsPickup ?
        pickupFeeForBorough(pricing, String(pickupBorough)) :
        {miles: 0, fee: 0};
      const lineShippingFee =
        Math.round(shippingFee * barrelQuantity * 100) / 100;
      const lineShippingFeeCents = Math.round(lineShippingFee * 100);
      const total = lineShippingFee + pickup.fee;
      if (!Number.isFinite(total) || total <= 0) {
        throw new HttpsError("failed-precondition", "Invalid shipment total");
      }
      const totalCents = Math.round(total * 100);
      const connectReady =
        !!business.stripeAccountId && business.payoutsEnabled === true;
      const payoutFields = barrelLinePayoutFields({
        shippingFeeCents: lineShippingFeeCents,
        platformFeePct,
        connectReady,
      });

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
          quantity: barrelQuantity,
          shippingFee: lineShippingFee,
          unitShippingFee: shippingFee,
          pricingPendingReview: false,
          ...(pickupAppointment && {
            pickupDateTime:
              admin.firestore.Timestamp.fromDate(pickupAppointment),
          }),
          price: total,
          platformFeePct,
          ...payoutFields,
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
        if (!SIMULATE_PAYMENTS) {
          const snapshot = await shipmentRef.get();
          await issueBarrelShipmentTransfer({
            shipmentRef,
            shipment: snapshot.data() || {},
            sourceTransaction: "",
          });
        }
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

exports.createBarrelOrderPaymentIntent = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const {
        senderName,
        pickupRequested,
        pickupAddress,
        pickupBorough,
        pickupDateTime,
        useWalletBalance,
      } = request.data || {};
      const lines = Array.isArray(request.data?.lines) ?
        request.data.lines :
        [];

      if (!senderName || lines.length === 0) {
        throw new HttpsError(
            "invalid-argument",
            "Sender and at least one destination are required",
        );
      }
      if (lines.length > MAX_BARREL_ORDER_LINES) {
        throw new HttpsError(
            "invalid-argument",
            `A barrel order can include up to ${MAX_BARREL_ORDER_LINES} ` +
              "destinations",
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
      const pricingRef = db.collection("shipmentPricing").doc("barrelPickup");
      const [pricingDoc, userRecord] = await Promise.all([
        pricingRef.get(),
        admin.auth().getUser(customerUid),
      ]);
      const pickupPricing = barrelPickupPricingFromData(pricingDoc.data());
      const cleanPickupAddress = wantsPickup ?
        String(pickupAddress).trim() :
        pickupPricing.officeAddress;

      const validatedLines = [];
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index] || {};
        const destinationCountryId =
          String(line.destinationCountryId || "").trim();
        const businessId = String(line.businessId || "").trim();
        const receiverName = String(line.receiverName || "").trim();
        const receiverPhone = String(line.receiverPhone || "").trim();
        const quantity = normalizeBarrelQuantity(line.quantity);
        const lineWantsPickup =
          line.pickupRequested === undefined ?
            wantsPickup :
            line.pickupRequested === true;
        const linePickupAddress = lineWantsPickup ?
          String(line.pickupAddress || pickupAddress || "").trim() :
          pickupPricing.officeAddress;
        const linePickupBorough = lineWantsPickup ?
          String(line.pickupBorough || pickupBorough || "").trim() :
          "Office drop-off";
        const linePickupDateTime =
          line.pickupDateTime || pickupDateTime || null;
        if (
          !destinationCountryId ||
          !businessId ||
          !receiverName ||
          !receiverPhone
        ) {
          throw new HttpsError(
              "invalid-argument",
              "Every destination needs a business, receiver, and phone",
          );
        }
        requireValidPhoneNumber(receiverPhone, "Receiver phone");
        if (
          lineWantsPickup &&
          (!linePickupAddress || !linePickupBorough || !linePickupDateTime)
        ) {
          throw new HttpsError(
              "invalid-argument",
              "Every pickup destination needs an address, borough, date, " +
                "and time",
          );
        }
        const linePickupAppointment = lineWantsPickup ?
          parseFuturePickup(linePickupDateTime) :
          null;
        const linePickup = lineWantsPickup ?
          pickupFeeForBorough(pickupPricing, linePickupBorough) :
          {miles: 0, fee: 0};
        const linePickupFeeCents = Math.round(linePickup.fee * 100);
        const businessDestination = await getApprovedBusinessDestination({
          businessId,
          countryId: destinationCountryId,
        });
        const {business, country, shippingFee, deliveryEstimate} =
          businessDestination;
        const lineShippingFee =
          Math.round(shippingFee * quantity * 100) / 100;
        const lineShippingFeeCents = Math.round(lineShippingFee * 100);
        const lineTotalCents = lineShippingFeeCents + linePickupFeeCents;
        const connectReady =
          !!business.stripeAccountId && business.payoutsEnabled === true;
        const platformFeePct = barrelPlatformFeePctFromPricing(
            pricingDoc.data(),
            business,
        );
        validatedLines.push({
          index,
          destinationCountryId,
          businessId: businessDestination.businessId,
          business,
          country,
          deliveryEstimate,
          receiverName,
          receiverPhone,
          quantity,
          pickupRequested: lineWantsPickup,
          pickupAddress: linePickupAddress,
          pickupBorough: linePickupBorough,
          pickupAppointment: linePickupAppointment,
          pickupMiles: linePickup.miles,
          unitShippingFee: shippingFee,
          lineShippingFee,
          lineShippingFeeCents,
          pickupFeeCents: linePickupFeeCents,
          lineTotalCents,
          platformFeePct,
          payoutFields: barrelLinePayoutFields({
            shippingFeeCents: lineShippingFeeCents,
            platformFeePct,
            connectReady,
          }),
        });
      }

      const orderTotalCents = validatedLines.reduce(
          (sum, line) => sum + line.lineTotalCents,
          0,
      );
      if (!Number.isFinite(orderTotalCents) || orderTotalCents <= 0) {
        throw new HttpsError("failed-precondition", "Invalid order total");
      }

      const orderRef = db.collection("barrelOrders").doc();
      const shipmentRefs = validatedLines.map(() =>
        db.collection("barrelShipments").doc(),
      );
      const trackingCodes = [];
      for (let index = 0; index < validatedLines.length; index++) {
        trackingCodes.push(
            await generateTrackingCode("BS", "barrelShipments"),
        );
      }
      const now = admin.firestore.FieldValue.serverTimestamp();
      let walletAppliedCents = 0;

      await db.runTransaction(async (transaction) => {
        if (useWalletBalance === true) {
          walletAppliedCents = await debitWallet({
            transaction,
            customerUid,
            amountCents: orderTotalCents,
            shipmentId: orderRef.id,
            trackingCode: trackingCodes[0],
            reason: "barrel_order_payment",
            businessId: "",
            businessName: "Multiple businesses",
          });
        }
        const chargeCents = orderTotalCents - walletAppliedCents;
        transaction.set(orderRef, {
          customerUid,
          customerEmail: userRecord.email || "",
          senderName: String(senderName).trim(),
          pickupRequested: validatedLines.some((line) => line.pickupRequested),
          pickupAddress: validatedLines.some((line) => line.pickupRequested) ?
            "See shipment pickup details" :
            cleanPickupAddress,
          pickupBorough: validatedLines.some((line) => line.pickupRequested) ?
            "Multiple/line-specific" :
            "Office drop-off",
          ...(pickupAppointment && {
            pickupDateTime:
              admin.firestore.Timestamp.fromDate(pickupAppointment),
          }),
          shipmentIds: shipmentRefs.map((ref) => ref.id),
          trackingCodes,
          lineCount: validatedLines.length,
          quantity: validatedLines.reduce(
              (sum, line) => sum + line.quantity,
              0,
          ),
          currency: SHIPMENT_CURRENCY,
          orderTotalCents,
          orderTotal: dollarsFromCents(orderTotalCents),
          walletAppliedCents,
          walletAppliedAmount: dollarsFromCents(walletAppliedCents),
          cardChargeAmountCents: chargeCents,
          cardChargeAmount: dollarsFromCents(chargeCents),
          paymentStatus: chargeCents === 0 ? "succeeded" : "pending",
          status: chargeCents === 0 ? "pending" : "pending_payment",
          ...(chargeCents === 0 && {paidAt: now}),
          createdAt: now,
          updatedAt: now,
        });

        validatedLines.forEach((line, index) => {
          const shipmentRef = shipmentRefs[index];
          const trackingCode = trackingCodes[index];
          const lineWalletAppliedCents = walletAppliedCents > 0 ?
            Math.round(walletAppliedCents * line.lineTotalCents /
              orderTotalCents) :
            0;
          transaction.set(shipmentRef, {
            orderId: orderRef.id,
            orderLineIndex: line.index,
            trackingCode,
            senderName: String(senderName).trim(),
            senderAddress: line.pickupAddress,
            receiverName: line.receiverName,
            receiverPhone: line.receiverPhone,
            destinationCountryId: line.destinationCountryId,
            destinationCountryName: line.country.name || "Guinea",
            businessId: line.businessId,
            businessName: line.business.name || DEFAULT_BUSINESS_NAME,
            ...line.deliveryEstimate,
            customerUid,
            customerEmail: userRecord.email || "",
            pickupRequested: line.pickupRequested,
            pickupAddress: line.pickupAddress,
            pickupBorough: line.pickupBorough,
            pickupMiles: line.pickupMiles,
            pickupFee: dollarsFromCents(line.pickupFeeCents),
            quantity: line.quantity,
            unitShippingFee: line.unitShippingFee,
            shippingFee: line.lineShippingFee,
            pricingPendingReview: false,
            ...(line.pickupAppointment && {
              pickupDateTime:
                admin.firestore.Timestamp.fromDate(line.pickupAppointment),
            }),
            price: dollarsFromCents(line.lineTotalCents),
            platformFeePct: line.platformFeePct,
            ...line.payoutFields,
            walletAppliedCents: lineWalletAppliedCents,
            walletAppliedAmount: dollarsFromCents(lineWalletAppliedCents),
            cardChargeAmountCents: Math.max(
                0,
                line.lineTotalCents - lineWalletAppliedCents,
            ),
            cardChargeAmount: dollarsFromCents(Math.max(
                0,
                line.lineTotalCents - lineWalletAppliedCents,
            )),
            paymentStatus: chargeCents === 0 ? "succeeded" : "pending",
            status: chargeCents === 0 ? "pending" : "pending_payment",
            ...(chargeCents === 0 && {paidAt: now}),
            createdAt: now,
            updatedAt: now,
          });
        });
      });

      const chargeCents = orderTotalCents - walletAppliedCents;
      if (chargeCents === 0) {
        if (!SIMULATE_PAYMENTS) {
          await issueBarrelOrderTransfers({orderId: orderRef.id});
        }
        return {
          orderId: orderRef.id,
          shipmentIds: shipmentRefs.map((ref) => ref.id),
          trackingCodes,
          simulatedPayment: true,
          walletAppliedAmount: dollarsFromCents(walletAppliedCents),
          cardChargeAmount: 0,
        };
      }

      if (SIMULATE_PAYMENTS) {
        await Promise.all([
          orderRef.update({
            paymentStatus: "succeeded",
            status: "pending",
            stripePaymentIntentId: `simulated_barrel_order_${orderRef.id}`,
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }),
          ...shipmentRefs.map((ref) => ref.update({
            paymentStatus: "succeeded",
            status: "pending",
            stripePaymentIntentId: `simulated_barrel_order_${orderRef.id}`,
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })),
        ]);
        return {
          orderId: orderRef.id,
          shipmentIds: shipmentRefs.map((ref) => ref.id),
          trackingCodes,
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
            orderId: orderRef.id,
            customerUid,
            paymentType: "barrel_order",
          },
        });
        await Promise.all([
          orderRef.update({
            stripePaymentIntentId: paymentIntent.id,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }),
          ...shipmentRefs.map((ref) => ref.update({
            stripePaymentIntentId: paymentIntent.id,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })),
        ]);
      } catch (error) {
        await Promise.all([
          orderRef.update({
            paymentStatus: "failed",
            status: "cancelled",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }),
          ...shipmentRefs.map((ref) => ref.update({
            paymentStatus: "failed",
            status: "cancelled",
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })),
        ]);
        if (walletAppliedCents > 0) {
          await db.runTransaction(async (transaction) => {
            await creditWallet({
              transaction,
              customerUid,
              amountCents: walletAppliedCents,
              shipmentId: orderRef.id,
              trackingCode: trackingCodes[0],
              reason: "barrel_order_payment_reversal",
              businessId: "",
              businessName: "Multiple businesses",
            });
          });
        }
        throw error;
      }

      return {
        orderId: orderRef.id,
        shipmentIds: shipmentRefs.map((ref) => ref.id),
        trackingCodes,
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
      await issueBarrelShipmentTransfer({
        shipmentRef,
        shipment: {
          ...shipment,
          paymentStatus: "succeeded",
          status: "pending",
        },
        sourceTransaction: stripeSourceTransactionFromIntent(intent),
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

exports.completeBarrelOrderPayment = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const callerUid = request.auth?.uid || "";
      const {orderId} = request.data || {};
      if (!orderId) {
        throw new HttpsError("invalid-argument", "Order ID is required");
      }

      const db = admin.firestore();
      const orderRef = db.collection("barrelOrders").doc(orderId);
      const orderDoc = await orderRef.get();
      if (!orderDoc.exists) {
        throw new HttpsError("not-found", "Order not found");
      }
      const order = orderDoc.data();
      if (callerUid && order.customerUid !== callerUid) {
        throw new HttpsError("permission-denied", "Order access denied");
      }

      let sourceTransaction = "";
      if (
        !SIMULATE_PAYMENTS &&
        !String(order.stripePaymentIntentId || "").startsWith("simulated_")
      ) {
        const orderIntentId = String(order.stripePaymentIntentId || "");
        if (!orderIntentId) {
          throw new HttpsError(
              "failed-precondition",
              "Payment intent is missing",
          );
        }
        const intent = await retrieveStripePaymentIntent(
            orderIntentId,
        );
        if (intent.status !== "succeeded") {
          await orderRef.update({
            paymentStatus: intent.status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          throw new HttpsError(
              "failed-precondition",
              `Payment is ${intent.status}`,
          );
        }
        if (!callerUid) {
          const metadata = intent.metadata || {};
          const metadataOrderId = String(metadata.orderId || "");
          const metadataCustomerUid = String(metadata.customerUid || "");
          if (
            metadataOrderId !== orderId ||
            metadataCustomerUid !== order.customerUid
          ) {
            throw new HttpsError(
                "unauthenticated",
                "Authentication required",
            );
          }
        }
        sourceTransaction = stripeSourceTransactionFromIntent(intent);
      } else if (!callerUid) {
        throw new HttpsError("unauthenticated", "Authentication required");
      }

      const shipments = await db.collection("barrelShipments")
          .where("orderId", "==", orderId)
          .get();
      const batch = db.batch();
      const now = admin.firestore.FieldValue.serverTimestamp();
      batch.update(orderRef, {
        paymentStatus: "succeeded",
        status: "pending",
        paidAt: now,
        updatedAt: now,
      });
      shipments.docs.forEach((doc) => {
        batch.update(doc.ref, {
          paymentStatus: "succeeded",
          status: "pending",
          paidAt: now,
          updatedAt: now,
        });
      });
      await batch.commit();

      await issueBarrelOrderTransfers({orderId, sourceTransaction});

      return {
        success: true,
        orderId,
        shipmentIds: shipments.docs.map((doc) => doc.id),
        trackingCodes: shipments.docs.map((doc) => doc.data().trackingCode),
        simulatedPayment:
          SIMULATE_PAYMENTS ||
          String(order.stripePaymentIntentId || "").startsWith("simulated_"),
      };
    },
);

exports.cancelPendingBarrelOrder = onCall(
    {
      enforceAppCheck: false,
      cors: true,
      secrets: [stripeSecretKey],
    },
    async (request) => {
      const customerUid = requireAuth(request);
      const {orderId} = request.data || {};
      if (!orderId) {
        throw new HttpsError("invalid-argument", "Order ID is required");
      }

      const db = admin.firestore();
      const orderRef = db.collection("barrelOrders").doc(orderId);
      const orderDoc = await orderRef.get();
      if (!orderDoc.exists) return {success: true, orderId};
      const order = orderDoc.data();
      if (order.customerUid !== customerUid) {
        throw new HttpsError("permission-denied", "Order access denied");
      }
      if (order.paymentStatus !== "pending") {
        return {success: true, orderId};
      }

      if (!SIMULATE_PAYMENTS && order.stripePaymentIntentId) {
        const intent = await retrieveStripePaymentIntent(
            order.stripePaymentIntentId,
        );
        if (intent.status === "succeeded" || intent.status === "processing") {
          await orderRef.update({
            paymentStatus: intent.status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return {success: true, orderId};
        }
      }

      const shipments = await db.collection("barrelShipments")
          .where("orderId", "==", orderId)
          .get();
      const walletAppliedCents = Number(order.walletAppliedCents || 0);
      await db.runTransaction(async (transaction) => {
        const now = admin.firestore.FieldValue.serverTimestamp();
        transaction.update(orderRef, {
          paymentStatus: "cancelled",
          status: "cancelled",
          walletAppliedReversed: walletAppliedCents > 0,
          updatedAt: now,
        });
        shipments.docs.forEach((doc) => {
          transaction.update(doc.ref, {
            paymentStatus: "cancelled",
            status: "cancelled",
            walletAppliedReversed: walletAppliedCents > 0,
            updatedAt: now,
          });
        });
        if (Number.isFinite(walletAppliedCents) && walletAppliedCents > 0) {
          await creditWallet({
            transaction,
            customerUid,
            amountCents: walletAppliedCents,
            shipmentId: orderId,
            trackingCode: (order.trackingCodes || [])[0] || orderId,
            reason: "barrel_order_payment_reversal",
            businessId: "",
            businessName: "Multiple businesses",
          });
        }
      });

      return {success: true, orderId};
    },
);

// ===== Freight shipments (parcels priced by weight, by air or sea) =====
function normalizeFreightMode(value) {
  return String(value || "sea").trim().toLowerCase() === "air" ?
    "air" :
    "sea";
}

async function getApprovedFreightDestination({businessId, countryId, mode}) {
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
      "freight",
      "This business is not accepting freight shipments",
  );
  if (!destinationDoc.exists || destinationDoc.data().isActive === false) {
    throw new HttpsError("invalid-argument", "Destination is unavailable");
  }
  const country = destinationDoc.data();
  const pricePerKg = mode === "air" ?
    Number(country.freightAirPricePerKg || 0) :
    Number(country.freightSeaPricePerKg || 0);
  if (!Number.isFinite(pricePerKg) || pricePerKg <= 0) {
    throw new HttpsError(
        "failed-precondition",
        `This destination has no ${mode} freight rate yet`,
    );
  }
  return {
    businessId: resolvedBusinessId,
    business,
    country,
    pricePerKg,
    deliveryEstimate: deliveryEstimateFromCountry(country),
  };
}

exports.createFreightShipmentPaymentIntent = onCall(
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
        businessId,
        mode,
        weightKg,
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
      const freightMode = normalizeFreightMode(mode);
      const parcelWeightKg = Number(weightKg || 0);
      if (!Number.isFinite(parcelWeightKg) || parcelWeightKg <= 0) {
        throw new HttpsError(
            "invalid-argument",
            "Parcel weight must be greater than zero",
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
      const pricingRef = db.collection("shipmentPricing").doc("barrelPickup");
      const [freightDestination, pricingDoc, userRecord] = await Promise.all([
        getApprovedFreightDestination({
          businessId,
          countryId: destinationCountryId,
          mode: freightMode,
        }),
        pricingRef.get(),
        admin.auth().getUser(customerUid),
      ]);
      const {business, country, pricePerKg, deliveryEstimate} =
        freightDestination;

      const pricing = barrelPickupPricingFromData(pricingDoc.data());
      const platformFeePct = servicePlatformFeePctForBusiness(
          pricingDoc.data(),
          business,
          ["freightPlatformFeePct"],
      );
      const pickup = wantsPickup ?
        pickupFeeForBorough(pricing, String(pickupBorough)) :
        {miles: 0, fee: 0};
      const shippingFee =
        Math.round(parcelWeightKg * pricePerKg * 100) / 100;
      const shippingFeeCents = Math.round(shippingFee * 100);
      const total = shippingFee + pickup.fee;
      if (!Number.isFinite(total) || total <= 0) {
        throw new HttpsError("failed-precondition", "Invalid shipment total");
      }
      const totalCents = Math.round(total * 100);

      const shipmentRef = db.collection("freightShipments").doc();
      const trackingCode = await generateTrackingCode("FR", "freightShipments");
      const now = admin.firestore.FieldValue.serverTimestamp();
      const cleanPickupAddress = wantsPickup ?
        String(pickupAddress).trim() :
        pricing.officeAddress;
      const connectReady =
        !!business.stripeAccountId && business.payoutsEnabled === true;
      const payoutFields = servicePayoutFields({
        grossCents: shippingFeeCents,
        platformFeePct,
        connectReady,
      });
      let walletAppliedCents = 0;
      await db.runTransaction(async (transaction) => {
        if (useWalletBalance === true) {
          walletAppliedCents = await debitWallet({
            transaction,
            customerUid,
            amountCents: totalCents,
            shipmentId: shipmentRef.id,
            trackingCode,
            reason: "freight_shipment_payment",
            businessId: freightDestination.businessId,
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
          destinationCountryName: country.name || "",
          businessId: freightDestination.businessId,
          businessName: business.name || DEFAULT_BUSINESS_NAME,
          ...deliveryEstimate,
          mode: freightMode,
          weightKg: parcelWeightKg,
          pricePerKg,
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
          platformFeePct,
          ...payoutFields,
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
        if (!SIMULATE_PAYMENTS) {
          const snapshot = await shipmentRef.get();
          await issueBusinessPayoutTransfer({
            ref: shipmentRef,
            data: snapshot.data() || {},
            serviceType: "freight_shipment",
          });
        }
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
          stripePaymentIntentId: `simulated_freight_${shipmentRef.id}`,
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
            businessId: freightDestination.businessId,
            paymentType: "freight_shipment",
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
              reason: "freight_shipment_payment_reversal",
              businessId: freightDestination.businessId,
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

exports.completeFreightShipmentPayment = onCall(
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
      const shipmentRef = db.collection("freightShipments").doc(shipmentId);
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
      await issueBusinessPayoutTransfer({
        ref: shipmentRef,
        data: {
          ...shipment,
          paymentStatus: "succeeded",
          status: "pending",
        },
        sourceTransaction: stripeSourceTransactionFromIntent(intent),
        serviceType: "freight_shipment",
      });

      return {
        success: true,
        shipmentId,
        trackingCode: shipment.trackingCode,
      };
    },
);

exports.cancelPendingFreightShipment = onCall(
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
      const shipmentRef = db.collection("freightShipments").doc(shipmentId);
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
            reason: "freight_shipment_payment_reversal",
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

exports.notifyFreightShipmentStatus = onDocumentUpdated(
    "freightShipments/{shipmentId}",
    async (event) => {
      if (!statusChanged(event)) return;
      const after = event.data.after.data() || {};
      const uid = userIdFrom(after, ["customerUid", "senderUid", "uid"]);
      await sendPreferenceNotification({
        uid,
        preferenceKey: "shipmentActivity",
        title: "Shipment update",
        body: `Your freight shipment is now ${after.status || "updated"}.`,
        data: {
          type: "freight_shipment_status",
          shipmentId: event.params.shipmentId,
          status: after.status || "",
        },
      });
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
      secrets: [stripeSecretKey],
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
      const pricingDoc = await db.collection("shipmentPricing")
          .doc("serviceFees")
          .get();
      const platformFeePct = servicePlatformFeePctForBusiness(
          pricingDoc.data(),
          carBusiness.business,
          [
            "carDepositPlatformFeePct",
          ],
      );
      const connectReady =
        !!carBusiness.business.stripeAccountId &&
        carBusiness.business.payoutsEnabled === true;
      const payoutFields = servicePayoutFields({
        grossCents: holdQuote.amountCents,
        platformFeePct,
        connectReady,
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
        platformFeePct,
        ...payoutFields,
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
          paymentType: "reservation_deposit",
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
      secrets: [stripeSecretKey],
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
      secrets: [stripeSecretKey],
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
      const pricingDoc = await db.collection("shipmentPricing")
          .doc("serviceFees")
          .get();
      const platformFeePct = servicePlatformFeePctForBusiness(
          pricingDoc.data(),
          carBusiness.business,
          [
            "carPurchasePlatformFeePct",
          ],
      );
      const connectReady =
        !!carBusiness.business.stripeAccountId &&
        carBusiness.business.payoutsEnabled === true;
      const payoutFields = servicePayoutFields({
        grossCents: purchaseAmountCents,
        platformFeePct,
        connectReady,
      });
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
          platformFeePct,
          ...payoutFields,
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
            businessId: carBusiness.businessId,
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
      await issueBusinessPayoutTransfer({
        ref: purchaseRef,
        data: {
          ...purchase,
          paymentStatus: "succeeded",
          purchaseStatus: "completed",
        },
        sourceTransaction: stripeSourceTransactionFromIntent(intent),
        serviceType: "car_purchase",
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
      await issueBusinessPayoutTransfer({
        ref: purchaseRef,
        data: {
          ...purchase,
          paymentStatus: "succeeded",
          purchaseStatus: "reserved",
        },
        sourceTransaction: stripeSourceTransactionFromIntent(intent),
        serviceType: "car_deposit",
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
      const businessDoc = purchase.businessId ?
        await db.collection("businesses").doc(purchase.businessId).get() :
        null;
      const business = businessDoc?.exists ? businessDoc.data() : {};
      const pricingDoc = await db.collection("shipmentPricing")
          .doc("serviceFees")
          .get();
      const extensionPlatformFeePct = servicePlatformFeePctForBusiness(
          pricingDoc.data(),
          business,
          [
            "holdExtensionPlatformFeePct",
            "carDepositPlatformFeePct",
          ],
      );
      const extensionConnectReady =
        !!business.stripeAccountId && business.payoutsEnabled === true;
      const extensionPayoutFields = servicePayoutFields({
        grossCents: extraCents,
        platformFeePct: extensionPlatformFeePct,
        connectReady: extensionConnectReady,
      });

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
          extensionPlatformFeePct,
          extensionPlatformFeeCents: extensionPayoutFields.platformFeeCents,
          extensionBusinessPayoutCents:
            extensionPayoutFields.businessPayoutCents,
          extensionPayoutStatus: extensionPayoutFields.payoutStatus,
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
          businessId: purchase.businessId || "",
          paymentType: "hold_extension",
        },
      });
      await purchaseRef.update({
        extensionPaymentIntentId: paymentIntent.id,
        extensionPaymentStatus: "pending",
        extensionPlatformFeePct,
        extensionPlatformFeeCents: extensionPayoutFields.platformFeeCents,
        extensionBusinessPayoutCents:
          extensionPayoutFields.businessPayoutCents,
        extensionPayoutStatus: extensionPayoutFields.payoutStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return {purchaseId, clientSecret: paymentIntent.client_secret};
    },
);

exports.completePaidHoldExtensionPayment = onCall(
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
      assertPaidHoldActionable(purchase);
      if (purchase.extensionRequestStatus !== "approved") {
        return {success: true, purchaseId};
      }
      const intentId = purchase.extensionPaymentIntentId;
      let sourceTransaction = "";
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
        sourceTransaction = stripeSourceTransactionFromIntent(intent);
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
      await issueBusinessPayoutTransfer({
        ref: purchaseRef,
        data: {
          ...purchase,
          extensionPaymentStatus: "succeeded",
          extensionPayoutStatus: purchase.extensionPayoutStatus,
        },
        sourceTransaction,
        serviceType: "hold_extension",
        payoutCents: Number(purchase.extensionBusinessPayoutCents || 0),
        idempotencySuffix: `${purchaseId}_hold_extension_${intentId}`,
        payoutStatusField: "extensionPayoutStatus",
        payoutTransferIdField: "extensionPayoutTransferId",
        paidOutAtField: "extensionPaidOutAt",
        payoutErrorField: "extensionPayoutError",
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

const SUPPORT_CASE_COLLECTIONS = {
  barrelShipments: {
    caseType: "barrel_shipment",
    customerField: "customerUid",
    businessField: "businessId",
    businessNameField: "businessName",
    labelFields: ["trackingCode", "receiverName", "destinationCountryName"],
  },
  freightShipments: {
    caseType: "freight_shipment",
    customerField: "customerUid",
    businessField: "businessId",
    businessNameField: "businessName",
    labelFields: ["trackingCode", "receiverName", "destinationCountryName"],
  },
  transportRequests: {
    caseType: "transport_request",
    customerField: "customerUid",
    businessField: "businessId",
    businessNameField: "businessName",
    labelFields: ["trackingCode", "ownerName", "destinationCountryName"],
  },
  carPurchases: {
    caseType: "car_purchase",
    customerField: "buyerUid",
    businessField: "businessId",
    businessNameField: "businessName",
    labelFields: ["carTitle", "buyerName", "destinationCountryName"],
  },
  barrelOrders: {
    caseType: "barrel_order",
    customerField: "customerUid",
    businessField: "businessId",
    businessNameField: "businessName",
    labelFields: ["trackingCode", "orderNumber", "status"],
  },
  parkedCars: {
    caseType: "parked_car",
    customerField: "customerUid",
    businessField: "businessId",
    businessNameField: "businessName",
    labelFields: ["customerName", "vehicleMake", "vehicleModel"],
  },
  barrelPools: {
    caseType: "barrel_pool",
    customerFields: ["createdByUid"],
    businessField: "businessId",
    businessNameField: "businessName",
    labelFields: ["destinationCountryName", "status"],
  },
  walletRefundRequests: {
    caseType: "wallet_refund",
    customerField: "customerUid",
    businessField: "businessId",
    businessNameField: "businessName",
    labelFields: ["amount", "status", "source"],
    platformOwned: true,
  },
  barrelPoolBalanceRequests: {
    caseType: "barrel_pool_balance",
    customerField: "customerUid",
    businessField: "businessId",
    businessNameField: "businessName",
    labelFields: ["amount", "status", "barrelPoolId"],
  },
};

const SUPPORT_URGENT_ESCALATION_REASONS = [
  "fraud",
  "safety",
  "abuse",
  "legal",
  "urgent",
  "payment_blocked",
  "service_blocked",
  "no_response",
  "payment_no_service",
  "business_unreachable",
  "pickup_delivery_time_sensitive",
  "admin_override",
];

const SUPPORT_MESSAGE_TYPES = [
  "text",
  "image",
  "file",
  "voice",
  "video",
  "system",
];

function supportCaseId(collectionName, relatedId) {
  return `${collectionName}_${relatedId}`
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .slice(0, 220);
}

function supportNow() {
  return FirestoreFieldValue.serverTimestamp();
}

function supportTimestampFromDate(date) {
  return FirestoreTimestamp.fromDate(date);
}

function supportDateFromTimestamp(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  return null;
}

function addBusinessDays(date, days) {
  const next = new Date(date.getTime());
  let remaining = days;
  while (remaining > 0) {
    next.setDate(next.getDate() + 1);
    const day = next.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return next;
}

function supportDisplayName(user, fallback) {
  return cleanText(
      user?.fullName || user?.displayName || user?.businessName ||
        user?.email || fallback || "Support participant",
      160,
  );
}

function supportRoleForUser(user, supportCase) {
  if (user.role === "admin") return "admin";
  if (
    (user.role === "businessOwner" || user.role === "staff") &&
    user.businessId === supportCase.businessId
  ) {
    return "business";
  }
  if (user.id === supportCase.customerUid) return "customer";
  return "";
}

function supportCanAdminSeeAll(user) {
  return user.role === "admin" && hasAdminCapability(user, "support");
}

function supportCanReadCase(user, supportCase) {
  if (!user || !supportCase) return false;
  if (user.id === supportCase.customerUid) return true;
  if (
    (user.role === "businessOwner" || user.role === "staff") &&
    user.businessId === supportCase.businessId
  ) {
    return user.role === "businessOwner" ||
      hasBusinessPermission(user, "support");
  }
  if (supportCanAdminSeeAll(user)) return true;
  return false;
}

function supportCanReply(user, supportCase) {
  const role = supportRoleForUser(user, supportCase);
  if (role === "customer") return true;
  if (role === "admin") return supportCanAdminSeeAll(user);
  if (role === "business") return hasBusinessPermission(user, "support");
  return false;
}

function supportRelatedLabel(record, config, relatedId) {
  const values = (config.labelFields || [])
      .map((field) => record[field])
      .filter((value) => value !== undefined && value !== null && value !== "")
      .map((value) => String(value).trim())
      .filter(Boolean);
  return cleanText(values.join(" · ") || relatedId, 220);
}

function supportCustomerUid(record, config) {
  if (config.customerField && record[config.customerField]) {
    return String(record[config.customerField]).trim();
  }
  for (const field of config.customerFields || []) {
    if (record[field]) return String(record[field]).trim();
  }
  return "";
}

async function resolveSupportRelatedRecord({
  db,
  collectionName,
  relatedId,
  callerUid,
}) {
  const config = SUPPORT_CASE_COLLECTIONS[collectionName];
  if (!config) {
    throw new HttpsError("invalid-argument", "Unsupported support record");
  }
  const relatedRef = db.collection(collectionName).doc(relatedId);
  const relatedDoc = await relatedRef.get();
  if (!relatedDoc.exists) {
    throw new HttpsError("not-found", "Support record not found");
  }
  const record = relatedDoc.data() || {};
  let customerUid = supportCustomerUid(record, config);
  if (!customerUid && collectionName === "barrelPools") {
    const participantDoc = await relatedRef.collection("participants")
        .doc(callerUid)
        .get();
    if (participantDoc.exists) customerUid = callerUid;
  }
  let businessId = String(record[config.businessField] || "").trim();
  if (!businessId && config.platformOwned === true) {
    businessId = "__platform_support";
  }
  if (!businessId) {
    throw new HttpsError(
        "failed-precondition",
        "This record is missing the responsible business.",
    );
  }
  const businessName = cleanText(
      record[config.businessNameField] ||
        (config.platformOwned === true ? "Laawol support" : businessId),
      160,
  );
  const relatedLabel = supportRelatedLabel(record, config, relatedId);
  return {
    relatedRef,
    record,
    customerUid,
    businessId,
    businessName,
    relatedLabel,
    caseType: config.caseType,
  };
}

async function requireSupportCase(db, caseId) {
  const ref = db.collection("supportCases").doc(caseId);
  const doc = await ref.get();
  if (!doc.exists) {
    throw new HttpsError("not-found", "Support case not found");
  }
  return {ref, doc, data: {id: doc.id, ...doc.data()}};
}

function supportMessagePayload({
  uid,
  user,
  supportCase,
  content,
  messageType,
  metadata,
  replyTo,
  visibility,
}) {
  const senderRole = supportRoleForUser(user, supportCase);
  return {
    senderId: uid,
    senderRole,
    senderName: supportDisplayName(user, uid),
    senderProfileImageUrl: cleanText(user.profileImageUrl, 600),
    content,
    messageType,
    metadata: metadata || {},
    replyTo: replyTo || null,
    visibility: visibility || "case",
    readBy: {[uid]: FirestoreTimestamp.now()},
    deletedForUsers: {},
    editHistory: [],
    createdAt: supportNow(),
    updatedAt: supportNow(),
  };
}

function supportCaseStatusAfterMessage(senderRole, supportCase) {
  if (supportCase.caseType === "business_platform") {
    if (senderRole === "business") return "waiting_for_admin";
    if (senderRole === "admin") return "waiting_for_business";
  }
  if (senderRole === "customer") return "waiting_for_business";
  if (senderRole === "business") return "waiting_for_customer";
  if (senderRole === "admin") return "admin_reviewing";
  return supportCase.status || "open";
}

async function notifySupportParticipants({
  supportCase,
  senderUid,
  preferenceKey = "supportMessages",
  title,
  body,
  data,
}) {
  const recipients = new Set();
  if (supportCase.customerUid && supportCase.customerUid !== senderUid) {
    recipients.add(supportCase.customerUid);
  }
  const db = admin.firestore();
  if (supportCase.businessId) {
    const businessUsers = await db.collection("users")
        .where("businessId", "==", supportCase.businessId)
        .where("role", "in", ["businessOwner", "staff"])
        .limit(100)
        .get();
    businessUsers.docs.forEach((doc) => {
      const user = {id: doc.id, ...doc.data()};
      if (
        doc.id !== senderUid &&
        (user.role === "businessOwner" ||
          hasBusinessPermission(user, "support"))
      ) {
        recipients.add(doc.id);
      }
    });
  }
  const admins = await db.collection("users")
      .where("role", "==", "admin")
      .limit(100)
      .get();
  admins.docs.forEach((doc) => {
    const user = {id: doc.id, ...doc.data()};
    if (doc.id !== senderUid && hasAdminCapability(user, "support")) {
      recipients.add(doc.id);
    }
  });
  const participantDocs = await db.collection("supportCases")
      .doc(supportCase.id)
      .collection("participants")
      .get();
  participantDocs.docs.forEach((doc) => {
    const uid = String(doc.data()?.uid || doc.id).trim();
    if (uid && uid !== senderUid && !uid.startsWith("business_")) {
      recipients.add(uid);
    }
  });
  await Promise.all(Array.from(recipients).map((uid) =>
    sendPreferenceNotification({
      uid,
      preferenceKey,
      title,
      body,
      data,
    }),
  ));
}

exports.createOrOpenSupportCase = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const caller = await getUserProfile(uid);
      const db = admin.firestore();
      const relatedCollection = cleanText(
          request.data?.relatedCollection,
          120,
      );
      const relatedId = cleanText(request.data?.relatedId, 180);
      const subject = cleanText(request.data?.subject, 160) || "Support";
      const initialMessage = cleanText(request.data?.message, 4000);
      const priority = cleanText(request.data?.priority, 32) || "normal";
      if (!relatedCollection || !relatedId) {
        throw new HttpsError(
            "invalid-argument",
            "Related record is required",
        );
      }
      if (!["normal", "urgent", "blocked"].includes(priority)) {
        throw new HttpsError("invalid-argument", "Invalid priority");
      }

      const related = await resolveSupportRelatedRecord({
        db,
        collectionName: relatedCollection,
        relatedId,
        callerUid: uid,
      });
      const allowed =
        uid === related.customerUid ||
        canManageBusiness(caller, related.businessId) ||
        supportCanAdminSeeAll(caller);
      if (!allowed) {
        throw new HttpsError("permission-denied", "Support access denied");
      }
      if (
        canManageBusiness(caller, related.businessId) &&
        !hasBusinessPermission(caller, "support")
      ) {
        throw new HttpsError(
            "permission-denied",
            "This staff account cannot manage support cases",
        );
      }

      const caseId = supportCaseId(relatedCollection, relatedId);
      const caseRef = db.collection("supportCases").doc(caseId);
      const nowDate = new Date();
      const responseDueAt = supportTimestampFromDate(
          addBusinessDays(nowDate, 3),
      );
      const now = supportNow();

      await db.runTransaction(async (transaction) => {
        const existing = await transaction.get(caseRef);
        const base = existing.exists ? existing.data() || {} : {};
        const payload = {
          customerUid: related.customerUid || uid,
          customerName: cleanText(
              base.customerName || caller.fullName ||
                request.auth?.token?.name || "Customer",
              160,
          ),
          customerEmail: cleanText(
              base.customerEmail || caller.email ||
                request.auth?.token?.email,
              240,
          ),
          customerPhone: cleanText(base.customerPhone || caller.phone, 40),
          businessId: related.businessId,
          businessName: related.businessName,
          relatedCollection,
          relatedId,
          relatedLabel: related.relatedLabel,
          caseType: related.caseType,
          subject,
          status: base.status === "closed" ?
            "reopened" :
            (base.status || "open"),
          priority,
          escalationStatus: base.escalationStatus || "business_first",
          assignedBusinessUserId: base.assignedBusinessUserId || null,
          assignedAdminUid: base.assignedAdminUid || null,
          businessResponseDueAt: base.businessResponseDueAt || responseDueAt,
          escalationAvailableAt: base.escalationAvailableAt || responseDueAt,
          reopenedAt: existing.exists ? now : (base.reopenedAt || null),
          createdAt: base.createdAt || now,
          updatedAt: now,
        };
        transaction.set(caseRef, payload, {merge: true});
        transaction.set(caseRef.collection("participants").doc(uid), {
          uid,
          role: supportRoleForUser(caller, {
            customerUid: related.customerUid || uid,
            businessId: related.businessId,
          }) || "customer",
          displayName: supportDisplayName(caller, uid),
          visible: true,
          unreadCount: 0,
          lastReadAt: now,
          updatedAt: now,
          createdAt: now,
        }, {merge: true});
        if (related.customerUid) {
          transaction.set(
              caseRef.collection("participants").doc(related.customerUid),
              {
                uid: related.customerUid,
                role: "customer",
                visible: true,
                updatedAt: now,
                createdAt: now,
              },
              {merge: true},
          );
        }
        transaction.set(
            caseRef.collection("participants")
                .doc(`business_${related.businessId}`),
            {
              businessId: related.businessId,
              role: "business",
              visible: true,
              updatedAt: now,
              createdAt: now,
            },
            {merge: true},
        );
        transaction.set(caseRef.collection("timeline").doc(), {
          type: existing.exists ? "reopened" : "created",
          actorUid: uid,
          actorRole: supportRoleForUser(caller, {
            customerUid: related.customerUid || uid,
            businessId: related.businessId,
          }) || "customer",
          actorName: supportDisplayName(caller, uid),
          message: existing.exists ? "Support case reopened" :
            "Support case created",
          createdAt: now,
        });
        if (initialMessage) {
          const messageRef = caseRef.collection("messages").doc();
          const supportCase = {
            id: caseId,
            customerUid: related.customerUid || uid,
            businessId: related.businessId,
          };
          const message = supportMessagePayload({
            uid,
            user: caller,
            supportCase,
            content: initialMessage,
            messageType: "text",
          });
          transaction.set(messageRef, message);
          transaction.set(caseRef, {
            lastMessage: initialMessage,
            lastMessageAt: now,
            lastMessageSenderRole: message.senderRole,
            lastCustomerMessageAt: message.senderRole === "customer" ?
              now : (base.lastCustomerMessageAt || null),
            lastBusinessMessageAt: message.senderRole === "business" ?
              now : (base.lastBusinessMessageAt || null),
            lastAdminMessageAt: message.senderRole === "admin" ?
              now : (base.lastAdminMessageAt || null),
            status: supportCaseStatusAfterMessage(message.senderRole, base),
            updatedAt: now,
          }, {merge: true});
        }
      });

      return {success: true, caseId};
    },
);

exports.createBusinessPlatformSupportCase = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const caller = await getUserProfile(uid);
      const db = admin.firestore();
      const businessId = cleanText(request.data?.businessId, 120);
      const subject = cleanText(request.data?.subject, 160);
      const initialMessage = cleanText(request.data?.message, 4000);
      const priority = cleanText(request.data?.priority, 32) || "normal";

      if (!businessId || !subject || !initialMessage) {
        throw new HttpsError(
            "invalid-argument",
            "Business, subject, and message are required",
        );
      }
      if (!["normal", "urgent", "blocked"].includes(priority)) {
        throw new HttpsError("invalid-argument", "Invalid priority");
      }
      if (!canManageBusiness(caller, businessId) ||
          !hasBusinessPermission(caller, "support")) {
        throw new HttpsError(
            "permission-denied",
            "This account cannot create admin support cases",
        );
      }

      const businessDoc = await db.collection("businesses")
          .doc(businessId)
          .get();
      if (!businessDoc.exists) {
        throw new HttpsError("not-found", "Business not found");
      }
      const business = businessDoc.data() || {};
      const businessName = cleanText(
          business.name || caller.businessName || businessId,
          160,
      );
      const caseRef = db.collection("supportCases").doc();
      const caseId = caseRef.id;
      const now = supportNow();
      const actorName = supportDisplayName(caller, uid);
      const supportCase = {
        id: caseId,
        customerUid: "",
        businessId,
      };
      const message = supportMessagePayload({
        uid,
        user: caller,
        supportCase,
        content: initialMessage,
        messageType: "text",
      });

      await db.runTransaction(async (transaction) => {
        transaction.set(caseRef, {
          customerUid: "",
          customerName: actorName,
          customerEmail: cleanText(caller.email, 240),
          customerPhone: cleanText(caller.phone, 40),
          businessId,
          businessName,
          relatedCollection: "businesses",
          relatedId: businessId,
          relatedLabel: businessName,
          caseType: "business_platform",
          subject,
          status: "waiting_for_admin",
          priority,
          escalationStatus: "escalated",
          escalationReason: "business_platform_help",
          escalatedAt: now,
          assignedBusinessUserId: uid,
          assignedAdminUid: null,
          lastMessage: initialMessage,
          lastMessageAt: now,
          lastMessageSenderRole: "business",
          lastCustomerMessageAt: null,
          lastBusinessMessageAt: now,
          lastAdminMessageAt: null,
          businessResponseDueAt: null,
          escalationAvailableAt: null,
          createdAt: now,
          updatedAt: now,
        });
        transaction.set(caseRef.collection("participants").doc(uid), {
          uid,
          role: "business",
          displayName: actorName,
          visible: true,
          unreadCount: 0,
          lastReadAt: now,
          updatedAt: now,
          createdAt: now,
        }, {merge: true});
        transaction.set(
            caseRef.collection("participants").doc(`business_${businessId}`),
            {
              businessId,
              role: "business",
              visible: true,
              updatedAt: now,
              createdAt: now,
            },
            {merge: true},
        );
        transaction.set(caseRef.collection("messages").doc(), message);
        transaction.set(caseRef.collection("timeline").doc(), {
          type: "created",
          actorUid: uid,
          actorRole: "business",
          actorName,
          message: "Admin support case created",
          createdAt: now,
        });
        setAdminAuditLog(transaction, {
          action: "business_platform_support_case_created",
          actorUid: uid,
          targetCollection: "supportCases",
          targetId: caseId,
          targetLabel: `${businessName}: ${subject}`,
          nextValue: priority,
        });
      });

      await notifySupportParticipants({
        supportCase: {
          ...supportCase,
          subject,
          relatedCollection: "businesses",
          relatedId: businessId,
        },
        senderUid: uid,
        title: `Business admin help: ${subject}`,
        body: initialMessage,
        data: {
          type: "support_message",
          caseId,
          relatedCollection: "businesses",
          relatedId: businessId,
        },
      });

      return {success: true, caseId, businessId};
    },
);

exports.sendSupportMessage = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const user = await getUserProfile(uid);
      const db = admin.firestore();
      const caseId = cleanText(request.data?.caseId, 220);
      const content = cleanText(request.data?.content, 4000);
      const messageType = cleanText(request.data?.messageType, 32) || "text";
      const metadata = request.data?.metadata &&
        typeof request.data.metadata === "object" ? request.data.metadata : {};
      const replyTo = request.data?.replyTo &&
        typeof request.data.replyTo === "object" ? request.data.replyTo : null;
      if (!caseId) throw new HttpsError("invalid-argument", "Case is required");
      if (!SUPPORT_MESSAGE_TYPES.includes(messageType)) {
        throw new HttpsError("invalid-argument", "Invalid message type");
      }
      if (!content && messageType === "text") {
        throw new HttpsError("invalid-argument", "Message is required");
      }
      const {ref, data: supportCase} = await requireSupportCase(db, caseId);
      if (!supportCanReply(user, supportCase)) {
        throw new HttpsError("permission-denied", "Support reply denied");
      }
      const senderRole = supportRoleForUser(user, supportCase);
      const messageContent = content || messageType;
      const now = supportNow();
      const messageRef = ref.collection("messages").doc();
      const message = supportMessagePayload({
        uid,
        user,
        supportCase,
        content: messageContent,
        messageType,
        metadata,
        replyTo,
      });
      const updates = {
        lastMessage: messageContent,
        lastMessageAt: now,
        lastMessageSenderRole: senderRole,
        status: supportCaseStatusAfterMessage(senderRole, supportCase),
        updatedAt: now,
      };
      if (senderRole === "customer") updates.lastCustomerMessageAt = now;
      if (senderRole === "business") updates.lastBusinessMessageAt = now;
      if (senderRole === "admin") updates.lastAdminMessageAt = now;
      await db.runTransaction(async (transaction) => {
        transaction.set(messageRef, message);
        transaction.set(ref, updates, {merge: true});
        transaction.set(ref.collection("timeline").doc(), {
          type: "message_sent",
          actorUid: uid,
          actorRole: senderRole,
          actorName: message.senderName,
          message: messageContent,
          messageId: messageRef.id,
          createdAt: now,
        });
        transaction.set(ref.collection("participants").doc(uid), {
          uid,
          role: senderRole,
          displayName: message.senderName,
          visible: true,
          unreadCount: 0,
          lastReadAt: now,
          updatedAt: now,
          createdAt: now,
        }, {merge: true});
      });
      await notifySupportParticipants({
        supportCase,
        senderUid: uid,
        title: `Support: ${supportCase.subject || supportCase.relatedLabel}`,
        body: messageContent,
        data: {
          type: "support_message",
          caseId,
          messageId: messageRef.id,
          relatedCollection: supportCase.relatedCollection,
          relatedId: supportCase.relatedId,
        },
      });
      return {success: true, caseId, messageId: messageRef.id};
    },
);

exports.uploadSupportAttachmentMetadata = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const user = await getUserProfile(uid);
      const db = admin.firestore();
      const caseId = cleanText(request.data?.caseId, 220);
      const fileUrl = cleanText(
          request.data?.fileUrl || request.data?.downloadUrl,
          1000,
      );
      const filePath = cleanText(
          request.data?.filePath || request.data?.storagePath,
          1000,
      );
      const fileName = cleanText(request.data?.fileName, 220);
      const mimeType = cleanText(
          request.data?.mimeType || request.data?.contentType,
          120,
      );
      const fileSize = Number(
          request.data?.fileSize || request.data?.size || 0,
      );
      const inferredType = mimeType.startsWith("image/") ? "image" :
        mimeType.startsWith("video/") ? "video" :
          mimeType.startsWith("audio/") ? "voice" : "file";
      const messageType = cleanText(
          request.data?.messageType,
          32,
      ) || inferredType;
      if (!caseId || !filePath) {
        throw new HttpsError(
            "invalid-argument",
            "Case and uploaded file are required",
        );
      }
      if (!SUPPORT_MESSAGE_TYPES.includes(messageType)) {
        throw new HttpsError("invalid-argument", "Invalid attachment type");
      }
      const validDocumentTypes = [
        "application/pdf",
        "text/plain",
        "application/msword",
        "application/vnd.openxmlformats-officedocument" +
          ".wordprocessingml.document",
      ];
      const validFile =
        (mimeType.startsWith("image/") && fileSize < 10 * 1024 * 1024) ||
        (mimeType.startsWith("audio/") && fileSize < 10 * 1024 * 1024) ||
        (mimeType.startsWith("video/") && fileSize < 50 * 1024 * 1024) ||
        (validDocumentTypes.includes(mimeType) &&
          fileSize < 25 * 1024 * 1024);
      if (!validFile) {
        throw new HttpsError(
            "invalid-argument",
            "Attachment type or size denied",
        );
      }
      const {ref, data: supportCase} = await requireSupportCase(db, caseId);
      if (!supportCanReply(user, supportCase)) {
        throw new HttpsError("permission-denied", "Attachment access denied");
      }
      if (!filePath.startsWith(`support_cases/${caseId}/${uid}/`)) {
        throw new HttpsError("permission-denied", "Invalid support file path");
      }
      const messageRef = ref.collection("messages").doc();
      const now = supportNow();
      const content = cleanText(request.data?.caption, 1000) ||
        fileName || messageType;
      const message = supportMessagePayload({
        uid,
        user,
        supportCase,
        content,
        messageType,
        metadata: {
          fileUrl,
          filePath,
          fileName,
          mimeType,
          fileSize,
          caption: cleanText(request.data?.caption, 1000),
        },
      });
      await db.runTransaction(async (transaction) => {
        transaction.set(messageRef, message);
        transaction.set(ref, {
          lastMessage: content,
          lastMessageAt: now,
          lastMessageSenderRole: message.senderRole,
          status: supportCaseStatusAfterMessage(
              message.senderRole,
              supportCase,
          ),
          updatedAt: now,
        }, {merge: true});
        transaction.set(ref.collection("timeline").doc(), {
          type: "attachment_uploaded",
          actorUid: uid,
          actorRole: message.senderRole,
          actorName: message.senderName,
          message: content,
          messageId: messageRef.id,
          createdAt: now,
        });
      });
      await notifySupportParticipants({
        supportCase,
        senderUid: uid,
        preferenceKey: "supportMessages",
        title: `Support: ${supportCase.subject || supportCase.relatedLabel}`,
        body: content,
        data: {
          type: "support_message",
          attachment: true,
          caseId,
          messageId: messageRef.id,
          relatedCollection: supportCase.relatedCollection,
          relatedId: supportCase.relatedId,
        },
      });
      return {success: true, caseId, messageId: messageRef.id};
    },
);

exports.markSupportCaseRead = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const user = await getUserProfile(uid);
      const db = admin.firestore();
      const caseId = cleanText(request.data?.caseId, 220);
      const {ref, data: supportCase} = await requireSupportCase(db, caseId);
      if (!supportCanReadCase(user, supportCase)) {
        throw new HttpsError("permission-denied", "Support read denied");
      }
      await ref.collection("participants").doc(uid).set({
        uid,
        role: supportRoleForUser(user, supportCase),
        displayName: supportDisplayName(user, uid),
        unreadCount: 0,
        lastReadAt: supportNow(),
        updatedAt: supportNow(),
      }, {merge: true});
      return {success: true};
    },
);

exports.setSupportTyping = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const user = await getUserProfile(uid);
      const db = admin.firestore();
      const caseId = cleanText(request.data?.caseId, 220);
      const typing = request.data?.typing === true;
      const {ref, data: supportCase} = await requireSupportCase(db, caseId);
      if (!supportCanReply(user, supportCase)) {
        throw new HttpsError("permission-denied", "Support typing denied");
      }
      await ref.collection("participants").doc(uid).set({
        uid,
        typing,
        typingAt: supportNow(),
        updatedAt: supportNow(),
      }, {merge: true});
      return {success: true};
    },
);

exports.escalateSupportCase = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const user = await getUserProfile(uid);
      const db = admin.firestore();
      const caseId = cleanText(request.data?.caseId, 220);
      const reason = cleanText(request.data?.reason, 80);
      const note = cleanText(request.data?.note, 2000);
      const {ref, data: supportCase} = await requireSupportCase(db, caseId);
      const role = supportRoleForUser(user, supportCase);
      if (role !== "customer" && role !== "business" &&
          !supportCanAdminSeeAll(user)) {
        throw new HttpsError("permission-denied", "Escalation denied");
      }
      const urgent = SUPPORT_URGENT_ESCALATION_REASONS.includes(reason);
      const availableAt = supportDateFromTimestamp(
          supportCase.escalationAvailableAt,
      );
      const available = urgent ||
        supportCanAdminSeeAll(user) ||
        !availableAt ||
        availableAt.getTime() <= Date.now();
      if (!available) {
        throw new HttpsError(
            "failed-precondition",
            "Platform escalation is not available yet.",
        );
      }
      const now = supportNow();
      await db.runTransaction(async (transaction) => {
        transaction.set(ref, {
          escalationStatus: "escalated",
          escalationReason: reason || "unresolved",
          escalatedAt: now,
          status: "escalated_to_platform",
          priority: urgent ? "urgent" : (supportCase.priority || "normal"),
          updatedAt: now,
        }, {merge: true});
        transaction.set(ref.collection("timeline").doc(), {
          type: "escalated",
          actorUid: uid,
          actorRole: role || "admin",
          actorName: supportDisplayName(user, uid),
          reason,
          message: note || "Case escalated to admin support",
          createdAt: now,
        });
      });
      await sendPreferenceNotification({
        uid: supportCase.customerUid,
        preferenceKey: "supportEscalations",
        title: "Support case escalated",
        body: supportCase.subject || supportCase.relatedLabel || "Support",
        data: {type: "support_escalated", caseId},
      });
      return {success: true, caseId};
    },
);

exports.assignSupportCase = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const user = await getUserProfile(uid);
      requireAdminCapability(user, "support");
      const db = admin.firestore();
      const caseId = cleanText(request.data?.caseId, 220);
      const assignedAdminUid = cleanText(request.data?.assignedAdminUid, 180);
      const assignedBusinessUserId = cleanText(
          request.data?.assignedBusinessUserId,
          180,
      );
      const {ref, data: supportCase} = await requireSupportCase(db, caseId);
      if (!supportCanReadCase(user, supportCase)) {
        throw new HttpsError("permission-denied", "Assignment denied");
      }
      const now = supportNow();
      await ref.set({
        assignedAdminUid:
          assignedAdminUid || supportCase.assignedAdminUid || uid,
        assignedBusinessUserId:
          assignedBusinessUserId || supportCase.assignedBusinessUserId || null,
        status: "admin_reviewing",
        updatedAt: now,
      }, {merge: true});
      await ref.collection("timeline").add({
        type: "assigned",
        actorUid: uid,
        actorRole: "admin",
        actorName: supportDisplayName(user, uid),
        message: "Support case assigned",
        createdAt: now,
      });
      return {success: true, caseId};
    },
);

exports.requestSupportEvidence = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const user = await getUserProfile(uid);
      const db = admin.firestore();
      const caseId = cleanText(request.data?.caseId, 220);
      const note = cleanText(request.data?.note, 2000) ||
        "Please add more details or evidence.";
      const {ref, data: supportCase} = await requireSupportCase(db, caseId);
      if (!supportCanReply(user, supportCase)) {
        throw new HttpsError("permission-denied", "Evidence request denied");
      }
      const role = supportRoleForUser(user, supportCase);
      if (role === "customer") {
        throw new HttpsError(
            "permission-denied",
            "Customers cannot request support evidence",
        );
      }
      const now = supportNow();
      await db.runTransaction(async (transaction) => {
        transaction.set(ref, {
          status: role === "customer" ? "waiting_for_business" :
            "customer_action_required",
          updatedAt: now,
        }, {merge: true});
        transaction.set(ref.collection("timeline").doc(), {
          type: "evidence_requested",
          actorUid: uid,
          actorRole: role,
          actorName: supportDisplayName(user, uid),
          message: note,
          createdAt: now,
        });
        transaction.set(ref.collection("messages").doc(), {
          senderId: uid,
          senderRole: role,
          senderName: supportDisplayName(user, uid),
          content: note,
          messageType: "system",
          metadata: {eventType: "evidence_requested"},
          visibility: "case",
          readBy: {[uid]: FirestoreTimestamp.now()},
          deletedForUsers: {},
          editHistory: [],
          createdAt: now,
          updatedAt: now,
        });
      });
      await notifySupportParticipants({
        supportCase,
        senderUid: uid,
        preferenceKey: "supportCaseUpdates",
        title: "Support case needs more information",
        body: note,
        data: {
          type: "support_case_update",
          event: "evidence_requested",
          caseId,
          relatedCollection: supportCase.relatedCollection,
          relatedId: supportCase.relatedId,
        },
      });
      return {success: true, caseId};
    },
);

exports.resolveSupportCase = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const user = await getUserProfile(uid);
      const db = admin.firestore();
      const caseId = cleanText(request.data?.caseId, 220);
      const outcome = cleanText(request.data?.outcome, 80) || "resolved";
      const note = cleanText(request.data?.note, 2000);
      const {ref, data: supportCase} = await requireSupportCase(db, caseId);
      if (!supportCanReply(user, supportCase)) {
        throw new HttpsError("permission-denied", "Resolve denied");
      }
      const role = supportRoleForUser(user, supportCase);
      const now = supportNow();
      await db.runTransaction(async (transaction) => {
        transaction.set(ref, {
          status: "resolved",
          outcome,
          resolutionNote: note,
          resolvedAt: now,
          resolvedBy: uid,
          updatedAt: now,
        }, {merge: true});
        transaction.set(ref.collection("timeline").doc(), {
          type: "resolved",
          actorUid: uid,
          actorRole: role,
          actorName: supportDisplayName(user, uid),
          outcome,
          message: note || "Support case resolved",
          createdAt: now,
        });
      });
      await notifySupportParticipants({
        supportCase,
        senderUid: uid,
        preferenceKey: "supportCaseUpdates",
        title: "Support case resolved",
        body: note || supportCase.subject || supportCase.relatedLabel ||
          "Your support case was resolved.",
        data: {
          type: "support_case_update",
          event: "resolved",
          caseId,
          outcome,
          relatedCollection: supportCase.relatedCollection,
          relatedId: supportCase.relatedId,
        },
      });
      return {success: true, caseId};
    },
);

exports.reopenSupportCase = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const user = await getUserProfile(uid);
      const db = admin.firestore();
      const caseId = cleanText(request.data?.caseId, 220);
      const note = cleanText(request.data?.note, 2000);
      const {ref, data: supportCase} = await requireSupportCase(db, caseId);
      if (!supportCanReply(user, supportCase)) {
        throw new HttpsError("permission-denied", "Reopen denied");
      }
      const role = supportRoleForUser(user, supportCase);
      const now = supportNow();
      await db.runTransaction(async (transaction) => {
        transaction.set(ref, {
          status: role === "customer" ? "waiting_for_business" : "open",
          reopenedAt: now,
          updatedAt: now,
        }, {merge: true});
        transaction.set(ref.collection("timeline").doc(), {
          type: "reopened",
          actorUid: uid,
          actorRole: role,
          actorName: supportDisplayName(user, uid),
          message: note || "Support case reopened",
          createdAt: now,
        });
      });
      await notifySupportParticipants({
        supportCase,
        senderUid: uid,
        preferenceKey: "supportCaseUpdates",
        title: "Support case reopened",
        body: note || supportCase.subject || supportCase.relatedLabel ||
          "A support case was reopened.",
        data: {
          type: "support_case_update",
          event: "reopened",
          caseId,
          relatedCollection: supportCase.relatedCollection,
          relatedId: supportCase.relatedId,
        },
      });
      return {success: true, caseId};
    },
);

exports.addSupportInternalNote = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const user = await getUserProfile(uid);
      requireAdminCapability(user, "support");
      const db = admin.firestore();
      const caseId = cleanText(request.data?.caseId, 220);
      const note = cleanText(request.data?.note, 4000);
      if (!note) throw new HttpsError("invalid-argument", "Note is required");
      const {ref, data: supportCase} = await requireSupportCase(db, caseId);
      if (!supportCanReadCase(user, supportCase)) {
        throw new HttpsError("permission-denied", "Internal note denied");
      }
      const now = supportNow();
      const noteRef = ref.collection("internalNotes").doc();
      await db.runTransaction(async (transaction) => {
        transaction.set(noteRef, {
          note,
          actorUid: uid,
          actorName: supportDisplayName(user, uid),
          createdAt: now,
          updatedAt: now,
        });
        transaction.set(ref.collection("timeline").doc(), {
          type: "internal_note_added",
          actorUid: uid,
          actorRole: "admin",
          actorName: supportDisplayName(user, uid),
          message: "Internal note added",
          private: true,
          createdAt: now,
        });
      });
      return {success: true, caseId, noteId: noteRef.id};
    },
);

exports.editSupportMessage = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const db = admin.firestore();
      const caseId = cleanText(request.data?.caseId, 220);
      const messageId = cleanText(request.data?.messageId, 220);
      const content = cleanText(request.data?.content, 4000);
      if (!caseId || !messageId || !content) {
        throw new HttpsError("invalid-argument", "Message update is required");
      }
      const {ref} = await requireSupportCase(db, caseId);
      const messageRef = ref.collection("messages").doc(messageId);
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(messageRef);
        if (!doc.exists) {
          throw new HttpsError("not-found", "Message not found");
        }
        const message = doc.data() || {};
        if (message.senderId !== uid || message.messageType !== "text") {
          throw new HttpsError("permission-denied", "Message edit denied");
        }
        transaction.update(messageRef, {
          content,
          editedAt: supportNow(),
          updatedAt: supportNow(),
          editHistory: FirestoreFieldValue.arrayUnion({
            content: message.content || "",
            editedAt: FirestoreTimestamp.now(),
          }),
        });
      });
      return {success: true};
    },
);

exports.deleteSupportMessageForMe = onCall(
    {
      enforceAppCheck: false,
      cors: true,
    },
    async (request) => {
      const uid = requireAuth(request);
      const user = await getUserProfile(uid);
      const db = admin.firestore();
      const caseId = cleanText(request.data?.caseId, 220);
      const messageId = cleanText(request.data?.messageId, 220);
      const {ref, data: supportCase} = await requireSupportCase(db, caseId);
      if (!supportCanReadCase(user, supportCase)) {
        throw new HttpsError("permission-denied", "Message delete denied");
      }
      await ref.collection("messages").doc(messageId).set({
        deletedForUsers: {[uid]: true},
        updatedAt: supportNow(),
      }, {merge: true});
      return {success: true};
    },
);
