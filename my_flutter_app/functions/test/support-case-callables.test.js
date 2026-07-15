const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

const functions = require("../index");
const db = admin.firestore();

const CUSTOMER_UID = "support-flow-customer";
const STRANGER_UID = "support-flow-stranger";
const OWNER_UID = "support-flow-owner";
const SUPPORT_STAFF_UID = "support-flow-staff";
const LISTING_STAFF_UID = "support-flow-listing-staff";
const ADMIN_UID = "support-flow-admin";
const BUSINESS_ID = "support-flow-business";
const SHIPMENT_ID = "support-flow-shipment";

async function seedSupportFixture() {
  try {
    await admin.auth().createUser({
      uid: ADMIN_UID,
      email: "admin@example.test",
      emailVerified: true,
    });
  } catch (error) {
    if (error.code !== "auth/uid-already-exists") throw error;
  }
  await Promise.all([
    db.collection("users").doc(CUSTOMER_UID).set({
      role: "customer",
      fullName: "Support Customer",
      email: "customer@example.test",
      phone: "+15555550101",
      notificationPreferences: {supportMessages: true},
    }),
    db.collection("users").doc(STRANGER_UID).set({
      role: "customer",
      fullName: "Support Stranger",
      email: "stranger@example.test",
    }),
    db.collection("users").doc(OWNER_UID).set({
      role: "businessOwner",
      businessId: BUSINESS_ID,
      businessName: "Support Flow Business",
      fullName: "Business Owner",
    }),
    db.collection("users").doc(SUPPORT_STAFF_UID).set({
      role: "staff",
      businessId: BUSINESS_ID,
      businessName: "Support Flow Business",
      businessPermissions: ["support"],
      fullName: "Support Staff",
    }),
    db.collection("users").doc(LISTING_STAFF_UID).set({
      role: "staff",
      businessId: BUSINESS_ID,
      businessName: "Support Flow Business",
      businessPermissions: ["listings"],
      fullName: "Listing Staff",
    }),
    db.collection("users").doc(ADMIN_UID).set({
      role: "admin",
      adminRole: "superAdmin",
      fullName: "Platform Admin",
      email: "admin@example.test",
    }),
    db.collection("businesses").doc(BUSINESS_ID).set({
      name: "Support Flow Business",
      status: "approved",
    }),
    db.collection("barrelShipments").doc(SHIPMENT_ID).set({
      customerUid: CUSTOMER_UID,
      customerName: "Support Customer",
      customerEmail: "customer@example.test",
      customerPhone: "+15555550101",
      businessId: BUSINESS_ID,
      businessName: "Support Flow Business",
      trackingCode: "SUPPORT-001",
      receiverName: "Receiver",
      destinationCountryName: "Guinea",
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }),
  ]);
}

async function messagesFor(caseId) {
  const snapshot = await db.collection("supportCases").doc(caseId)
      .collection("messages")
      .orderBy("createdAt")
      .get();
  return snapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
}

async function timelineTypes(caseId) {
  const snapshot = await db.collection("supportCases").doc(caseId)
      .collection("timeline")
      .get();
  return snapshot.docs.map((doc) => doc.data().type).sort();
}

async function notificationDeliveriesWhere(predicate) {
  const snapshot = await db.collection("notificationDeliveries").get();
  return snapshot.docs
      .map((doc) => ({id: doc.id, ...doc.data()}))
      .filter(predicate);
}

describe("support case callable lifecycle", () => {
  before(seedSupportFixture);

  it("enforces business-first support, escalation, audit, and local deletes",
      async () => {
        const opened = await functions.createOrOpenSupportCase.run({
          auth: {uid: CUSTOMER_UID},
          data: {
            relatedCollection: "barrelShipments",
            relatedId: SHIPMENT_ID,
            subject: "Shipment help",
            message: "The pickup window was missed.",
          },
        });
        const caseId = opened.caseId;
        assert.equal(caseId, `barrelShipments_${SHIPMENT_ID}`);

        await assert.rejects(
            () => functions.createOrOpenSupportCase.run({
              auth: {uid: STRANGER_UID},
              data: {
                relatedCollection: "barrelShipments",
                relatedId: SHIPMENT_ID,
                subject: "Not mine",
              },
            }),
            /Support access denied/,
        );

        let caseDoc = await db.collection("supportCases").doc(caseId).get();
        assert.equal(caseDoc.get("customerUid"), CUSTOMER_UID);
        assert.equal(caseDoc.get("businessId"), BUSINESS_ID);
        assert.equal(caseDoc.get("status"), "waiting_for_business");
        assert.equal(caseDoc.get("lastMessageSenderRole"), "customer");

        await assert.rejects(
            () => functions.sendSupportMessage.run({
              auth: {uid: LISTING_STAFF_UID},
              data: {caseId, content: "I should not be allowed"},
            }),
            /Support reply denied/,
        );

        const businessReply = await functions.sendSupportMessage.run({
          auth: {uid: SUPPORT_STAFF_UID},
          data: {caseId, content: "We are checking the pickup notes."},
        });
        caseDoc = await db.collection("supportCases").doc(caseId).get();
        assert.equal(caseDoc.get("status"), "waiting_for_customer");
        assert.equal(caseDoc.get("lastMessageSenderRole"), "business");
        assert.ok(caseDoc.get("lastBusinessMessageAt"));

        await functions.markSupportCaseRead.run({
          auth: {uid: CUSTOMER_UID},
          data: {caseId},
        });
        await functions.setSupportTyping.run({
          auth: {uid: SUPPORT_STAFF_UID},
          data: {caseId, typing: true},
        });
        const staffParticipant = await db.collection("supportCases")
            .doc(caseId)
            .collection("participants")
            .doc(SUPPORT_STAFF_UID)
            .get();
        assert.equal(staffParticipant.get("typing"), true);

        await assert.rejects(
            () => functions.escalateSupportCase.run({
              auth: {uid: CUSTOMER_UID},
              data: {caseId, reason: "unresolved"},
            }),
            /Platform escalation is not available yet/,
        );

        await functions.escalateSupportCase.run({
          auth: {uid: CUSTOMER_UID},
          data: {
            caseId,
            reason: "fraud",
            note: "Payment and pickup details do not match.",
          },
        });
        caseDoc = await db.collection("supportCases").doc(caseId).get();
        assert.equal(caseDoc.get("escalationStatus"), "escalated");
        assert.equal(caseDoc.get("priority"), "urgent");

        await functions.assignSupportCase.run({
          auth: {uid: ADMIN_UID},
          data: {caseId, assignedAdminUid: ADMIN_UID},
        });
        await functions.requestSupportEvidence.run({
          auth: {uid: ADMIN_UID},
          data: {caseId, note: "Please upload the receipt and pickup proof."},
        });
        const evidenceRequestDeliveries = await notificationDeliveriesWhere(
            (row) => row.data?.caseId === caseId &&
              row.data?.event === "evidence_requested",
        );
        assert.ok(
            evidenceRequestDeliveries.some((row) =>
              row.preferenceKey === "supportCaseUpdates" &&
              row.recipientUid === CUSTOMER_UID,
            ),
            "evidence requests notify the customer through support updates",
        );

        const internalNote = await functions.addSupportInternalNote.run({
          auth: {uid: ADMIN_UID},
          data: {caseId, note: "Business payout review may be needed."},
        });
        assert.ok(internalNote.noteId);

        const noteDoc = await db.collection("supportCases").doc(caseId)
            .collection("internalNotes")
            .doc(internalNote.noteId)
            .get();
        assert.equal(
            noteDoc.get("note"),
            "Business payout review may be needed.",
        );

        const attachment = await functions.uploadSupportAttachmentMetadata.run({
          auth: {uid: CUSTOMER_UID},
          data: {
            caseId,
            filePath: `support_cases/${caseId}/${CUSTOMER_UID}/receipt.pdf`,
            fileName: "receipt.pdf",
            mimeType: "application/pdf",
            fileSize: 1024,
            caption: "Receipt",
          },
        });
        assert.ok(attachment.messageId);
        const attachmentDeliveries = await notificationDeliveriesWhere(
            (row) => row.data?.caseId === caseId &&
              row.data?.messageId === attachment.messageId &&
              row.data?.attachment === "true",
        );
        assert.ok(
            attachmentDeliveries.some((row) =>
              row.preferenceKey === "supportMessages" &&
              row.recipientUid === ADMIN_UID,
            ),
            "support attachments notify admins like support messages",
        );

        await assert.rejects(
            () => functions.uploadSupportAttachmentMetadata.run({
              auth: {uid: CUSTOMER_UID},
              data: {
                caseId,
                filePath: `support_cases/${caseId}/${CUSTOMER_UID}/huge.pdf`,
                fileName: "huge.pdf",
                mimeType: "application/pdf",
                fileSize: 30 * 1024 * 1024,
              },
            }),
            /Attachment type or size denied/,
        );

        const customerMessage = (await messagesFor(caseId))
            .find((message) => message.senderId === CUSTOMER_UID &&
              message.messageType === "text");
        assert.ok(customerMessage);
        await functions.editSupportMessage.run({
          auth: {uid: CUSTOMER_UID},
          data: {
            caseId,
            messageId: customerMessage.id,
            content: "The pickup window was missed twice.",
          },
        });
        const editedDoc = await db.collection("supportCases").doc(caseId)
            .collection("messages")
            .doc(customerMessage.id)
            .get();
        assert.equal(
            editedDoc.get("content"),
            "The pickup window was missed twice.",
        );
        assert.equal(editedDoc.get("editHistory").length, 1);

        await functions.deleteSupportMessageForMe.run({
          auth: {uid: CUSTOMER_UID},
          data: {caseId, messageId: businessReply.messageId},
        });
        const businessMessageDoc = await db.collection("supportCases")
            .doc(caseId)
            .collection("messages")
            .doc(businessReply.messageId)
            .get();
        assert.equal(
            businessMessageDoc.get(`deletedForUsers.${CUSTOMER_UID}`),
            true,
        );
        assert.equal(
            businessMessageDoc.get("content"),
            "We are checking the pickup notes.",
        );

        await functions.resolveSupportCase.run({
          auth: {uid: ADMIN_UID},
          data: {
            caseId,
            outcome: "business_resolved",
            note: "Business agreed to reschedule pickup.",
          },
        });
        const resolvedDeliveries = await notificationDeliveriesWhere(
            (row) => row.data?.caseId === caseId &&
              row.data?.event === "resolved",
        );
        assert.ok(
            resolvedDeliveries.some((row) =>
              row.preferenceKey === "supportCaseUpdates" &&
              row.recipientUid === CUSTOMER_UID,
            ),
            "resolving support cases notifies the customer",
        );

        caseDoc = await db.collection("supportCases").doc(caseId).get();
        assert.equal(caseDoc.get("status"), "resolved");
        assert.equal(caseDoc.get("outcome"), "business_resolved");

        await functions.reopenSupportCase.run({
          auth: {uid: CUSTOMER_UID},
          data: {caseId, note: "Pickup still needs confirmation."},
        });
        caseDoc = await db.collection("supportCases").doc(caseId).get();
        assert.equal(caseDoc.get("status"), "waiting_for_business");
        const reopenedDeliveries = await notificationDeliveriesWhere(
            (row) => row.data?.caseId === caseId &&
              row.data?.event === "reopened",
        );
        assert.ok(
            reopenedDeliveries.some((row) =>
              row.preferenceKey === "supportCaseUpdates" &&
              row.recipientUid === ADMIN_UID,
            ),
            "reopening support cases notifies support admins",
        );

        const types = await timelineTypes(caseId);
        for (const expected of [
          "assigned",
          "attachment_uploaded",
          "created",
          "escalated",
          "evidence_requested",
          "internal_note_added",
          "message_sent",
          "reopened",
          "resolved",
        ]) {
          assert.ok(types.includes(expected), expected);
        }
      });
});

describe("business admin support callable", () => {
  before(seedSupportFixture);

  it("creates an escalated admin case from business support staff",
      async () => {
        const created = await functions.createBusinessPlatformSupportCase.run({
          auth: {uid: SUPPORT_STAFF_UID},
          data: {
            businessId: BUSINESS_ID,
            priority: "blocked",
            subject: "Payout review needed",
            message: "We need admin help reviewing a payout.",
          },
        });
        assert.ok(created.caseId);

        const caseDoc = await db.collection("supportCases")
            .doc(created.caseId)
            .get();
        assert.equal(caseDoc.get("caseType"), "business_platform");
        assert.equal(caseDoc.get("businessId"), BUSINESS_ID);
        assert.equal(caseDoc.get("customerUid"), "");
        assert.equal(caseDoc.get("status"), "waiting_for_admin");
        assert.equal(caseDoc.get("escalationStatus"), "escalated");
        assert.equal(caseDoc.get("escalationReason"), "business_platform_help");
        assert.equal(caseDoc.get("lastMessageSenderRole"), "business");

        const messages = await messagesFor(created.caseId);
        assert.equal(messages.length, 1);
        assert.equal(messages[0].senderRole, "business");
        assert.equal(
            messages[0].content,
            "We need admin help reviewing a payout.",
        );

        await functions.sendSupportMessage.run({
          auth: {uid: ADMIN_UID},
          data: {
            caseId: created.caseId,
            content: "Platform is reviewing this.",
          },
        });
        const updatedCase = await db.collection("supportCases")
            .doc(created.caseId)
            .get();
        assert.equal(updatedCase.get("lastMessageSenderRole"), "admin");
        assert.equal(updatedCase.get("status"), "waiting_for_business");
      });

  it("denies admin support creation without business support permission",
      async () => {
        await assert.rejects(
            () => functions.createBusinessPlatformSupportCase.run({
              auth: {uid: LISTING_STAFF_UID},
              data: {
                businessId: BUSINESS_ID,
                subject: "Need help",
                message: "I should not be allowed.",
              },
            }),
            /cannot create admin support cases/,
        );
      });
});
