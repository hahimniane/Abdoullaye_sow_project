"use strict";

process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

const admin = require("firebase-admin");

const projectId = process.env.GCLOUD_PROJECT || "demo-laawol-support-local";
const password = process.env.SUPPORT_DEMO_PASSWORD || "Support123!";

const users = [
  {
    uid: "customer-support-demo",
    email: "support.customer@example.test",
    fullName: "Aissatou Diallo",
    role: "customer",
  },
  {
    uid: "business-owner-support-demo",
    email: "support.owner@example.test",
    fullName: "Mamadou Barry",
    role: "businessOwner",
    businessPermissions: [],
  },
  {
    uid: "business-staff-support-demo",
    email: "support.staff@example.test",
    fullName: "Keren Support Staff",
    role: "staff",
    businessPermissions: ["support"],
  },
  {
    uid: "admin-support-demo",
    email: "support.admin@example.test",
    fullName: "Platform Support Admin",
    role: "admin",
    adminRole: "supportAdmin",
  },
];

const businessId = "biz_support_demo";
const businessName = "Keren Shipping Support Demo";
const firstLineShipmentId = "shipment_support_demo";
const escalatedShipmentId = "shipment_support_escalated_demo";
const escalatedCaseId = `barrelShipments_${escalatedShipmentId}`;

function now() {
  return admin.firestore.Timestamp.now();
}

function futureBusinessDueAt() {
  return admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  );
}

async function upsertAuthUser({uid, email, fullName}) {
  const payload = {
    email,
    password,
    displayName: fullName,
    emailVerified: true,
  };
  try {
    await admin.auth().updateUser(uid, payload);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    await admin.auth().createUser({uid, ...payload});
  }
}

function userDoc(user) {
  return {
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    phone: "+15555550100",
    notificationPreferences: {
      supportActivity: true,
      supportMessages: true,
      supportEscalations: true,
      supportCaseUpdates: true,
    },
    ...(user.adminRole ? {adminRole: user.adminRole} : {}),
    ...(user.role === "businessOwner" || user.role === "staff" ? {
      businessId,
      businessName,
      businessServices: ["barrelShipping", "freight", "carTransport"],
      businessPermissions: user.businessPermissions || [],
    } : {}),
    updatedAt: now(),
  };
}

function shipmentDoc({
  shipmentId,
  trackingCode,
  receiverName,
  status,
}) {
  return {
    trackingCode,
    senderName: "Aissatou Diallo",
    senderAddress: "125 Demo Street, New York, NY",
    receiverName,
    receiverPhone: "+224620000000",
    destinationCountryId: "guinea",
    destinationCountryName: "Guinea",
    businessId,
    businessName,
    customerUid: "customer-support-demo",
    customerEmail: "support.customer@example.test",
    pickupRequested: true,
    pickupAddress: "125 Demo Street, New York, NY",
    pickupBorough: "Brooklyn",
    pickupFee: 25,
    shippingFee: 120,
    quantity: 1,
    orderId: shipmentId,
    price: 145,
    status,
    paymentStatus: "paid",
    createdAt: now(),
    updatedAt: now(),
  };
}

function caseDoc() {
  return {
    customerUid: "customer-support-demo",
    customerName: "Aissatou Diallo",
    customerEmail: "support.customer@example.test",
    customerPhone: "+15555550100",
    businessId,
    businessName,
    relatedCollection: "barrelShipments",
    relatedId: escalatedShipmentId,
    relatedLabel: "SUPPORT-ESC-001",
    caseType: "barrel_shipment",
    subject: "Pickup missed twice",
    status: "escalated_to_platform",
    priority: "urgent",
    escalationStatus: "escalated",
    escalationReason: "business_unreachable",
    escalatedAt: now(),
    assignedAdminUid: "admin-support-demo",
    lastMessage: "Customer needs platform review.",
    lastMessageSenderRole: "customer",
    lastMessageAt: now(),
    lastCustomerMessageAt: now(),
    businessResponseDueAt: futureBusinessDueAt(),
    escalationAvailableAt: now(),
    createdAt: now(),
    updatedAt: now(),
  };
}

async function seed() {
  admin.initializeApp({projectId});
  const db = admin.firestore();
  await Promise.all(users.map(upsertAuthUser));

  const batch = db.batch();
  batch.set(db.collection("businesses").doc(businessId), {
    name: businessName,
    ownerUid: "business-owner-support-demo",
    ownerEmail: "support.owner@example.test",
    status: "approved",
    services: ["barrelShipping", "freight", "carTransport"],
    updatedAt: now(),
    createdAt: now(),
  }, {merge: true});

  for (const user of users) {
    batch.set(db.collection("users").doc(user.uid), userDoc(user), {
      merge: true,
    });
  }

  batch.set(
      db.collection("barrelShipments").doc(firstLineShipmentId),
      shipmentDoc({
        shipmentId: firstLineShipmentId,
        trackingCode: "SUPPORT-001",
        receiverName: "Fatou Diallo",
        status: "in_transit",
      }),
      {merge: true},
  );
  batch.set(
      db.collection("barrelShipments").doc(escalatedShipmentId),
      shipmentDoc({
        shipmentId: escalatedShipmentId,
        trackingCode: "SUPPORT-ESC-001",
        receiverName: "Moussa Diallo",
        status: "pending",
      }),
      {merge: true},
  );

  const caseRef = db.collection("supportCases").doc(escalatedCaseId);
  batch.set(caseRef, caseDoc(), {merge: true});
  batch.set(caseRef.collection("participants").doc("customer-support-demo"), {
    uid: "customer-support-demo",
    role: "customer",
    displayName: "Aissatou Diallo",
    visible: true,
    unreadCount: 0,
    lastReadAt: now(),
    createdAt: now(),
    updatedAt: now(),
  }, {merge: true});
  batch.set(caseRef.collection("participants").doc(`business_${businessId}`), {
    businessId,
    role: "business",
    visible: true,
    createdAt: now(),
    updatedAt: now(),
  }, {merge: true});
  batch.set(caseRef.collection("participants").doc("admin-support-demo"), {
    uid: "admin-support-demo",
    role: "admin",
    displayName: "Platform Support Admin",
    visible: true,
    unreadCount: 0,
    lastReadAt: now(),
    createdAt: now(),
    updatedAt: now(),
  }, {merge: true});
  batch.set(caseRef.collection("messages").doc("customer-message"), {
    senderId: "customer-support-demo",
    senderRole: "customer",
    senderName: "Aissatou Diallo",
    content: "The pickup window was missed and the business is unreachable.",
    messageType: "text",
    metadata: {},
    readBy: {"customer-support-demo": now()},
    deletedForUsers: {},
    editHistory: [],
    visibility: "case",
    createdAt: now(),
    updatedAt: now(),
  }, {merge: true});
  batch.set(caseRef.collection("timeline").doc("created"), {
    type: "created",
    actorUid: "customer-support-demo",
    actorRole: "customer",
    actorName: "Aissatou Diallo",
    message: "Support case created",
    createdAt: now(),
  }, {merge: true});
  batch.set(caseRef.collection("timeline").doc("escalated"), {
    type: "escalated",
    actorUid: "customer-support-demo",
    actorRole: "customer",
    actorName: "Aissatou Diallo",
    message: "Customer needs platform review.",
    createdAt: now(),
  }, {merge: true});
  batch.set(caseRef.collection("internalNotes").doc("admin-note"), {
    note: "Seeded private note. Customer and business must not see this.",
    actorUid: "admin-support-demo",
    actorName: "Platform Support Admin",
    createdAt: now(),
  }, {merge: true});

  await batch.commit();

  console.log("Seeded support emulator data.");
  console.log(`Project: ${projectId}`);
  console.log(`Password for all demo users: ${password}`);
  for (const user of users) {
    console.log(`${user.role}: ${user.email}`);
  }
  console.log(`First-line shipment: ${firstLineShipmentId}`);
  console.log(`Escalated support case: ${escalatedCaseId}`);
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
