const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");
const {
  MARKETPLACE_DISCLOSURE_VERSION,
} = require("../marketplace_disclosure");

const OWNER_UID = "test-shared-owner";
const JOINER_UID = "test-shared-joiner";
const SECOND_JOINER_UID = "test-shared-second-joiner";
const UNVERIFIED_UID = "test-shared-unverified";
const MISMATCHED_PHONE_UID = "test-shared-mismatched-phone";
const STAFF_UID = "test-shared-staff";
const BUSINESS_ID = "test-shared-business";
const COUNTRY_ID = "gn";
let businessPoolSequence = 0;

const authEmails = {
  [OWNER_UID]: "owner@example.test",
  [JOINER_UID]: "joiner@example.test",
  [SECOND_JOINER_UID]: "second-joiner@example.test",
  [UNVERIFIED_UID]: "unverified@example.test",
  [MISMATCHED_PHONE_UID]: "mismatched@example.test",
  [STAFF_UID]: "staff@example.test",
};

const authPhones = {
  [OWNER_UID]: "+15555550101",
  [JOINER_UID]: "+15555550102",
  [SECOND_JOINER_UID]: "+15555550104",
  [MISMATCHED_PHONE_UID]: "+15555550999",
};

const functions = require("../index");
admin.auth().getUser = async (uid) => ({
  uid,
  email: authEmails[uid] || `${uid}@example.test`,
  phoneNumber: authPhones[uid],
});
admin.auth().updateUser = async (uid, updates) => ({
  uid,
  email: authEmails[uid] || `${uid}@example.test`,
  phoneNumber: authPhones[uid],
  ...updates,
});
const db = admin.firestore();

function participantInput(label, phone, weightKg = 10) {
  return {
    senderName: `${label} Sender`,
    senderAddress: `${label} Address`,
    receiverName: `${label} Receiver`,
    receiverPhone: phone,
    contentsDescription: `${label} household goods`,
    pickupRequested: false,
    attestedWeightKg: weightKg,
    contentsAttested: true,
    prohibitedItemsAcknowledged: true,
    sharedLiabilityAccepted: true,
  };
}

function acceptedMarketplaceDisclosure() {
  return {
    accepted: true,
    version: MARKETPLACE_DISCLOSURE_VERSION,
    locale: "en",
  };
}

async function seedSharedBarrelFixture() {
  await Promise.all([
    db.collection("users").doc(OWNER_UID).set({
      role: "customer",
      phoneVerified: true,
      phone: authPhones[OWNER_UID],
      normalizedPhone: "15555550101",
      fullName: "Owner Customer",
      email: authEmails[OWNER_UID],
    }),
    db.collection("users").doc(JOINER_UID).set({
      role: "customer",
      phoneVerified: true,
      phone: authPhones[JOINER_UID],
      normalizedPhone: "15555550102",
      fullName: "Joiner Customer",
      email: authEmails[JOINER_UID],
    }),
    db.collection("users").doc(SECOND_JOINER_UID).set({
      role: "customer",
      phoneVerified: true,
      phone: authPhones[SECOND_JOINER_UID],
      normalizedPhone: "15555550104",
      fullName: "Second Joiner Customer",
      email: authEmails[SECOND_JOINER_UID],
    }),
    db.collection("users").doc(UNVERIFIED_UID).set({
      role: "customer",
      phoneVerified: false,
      fullName: "Unverified Customer",
      email: authEmails[UNVERIFIED_UID],
      phone: "+15555550103",
      normalizedPhone: "15555550103",
    }),
    db.collection("users").doc(MISMATCHED_PHONE_UID).set({
      role: "customer",
      phoneVerified: true,
      fullName: "Mismatched Phone Customer",
      email: authEmails[MISMATCHED_PHONE_UID],
      phone: "+15555550888",
      normalizedPhone: "15555550888",
    }),
    db.collection("users").doc(STAFF_UID).set({
      role: "staff",
      businessId: BUSINESS_ID,
      businessName: "Shared Barrel Test Business",
      businessPermissions: ["barrels"],
    }),
    db.collection("businesses").doc(BUSINESS_ID).set({
      name: "Shared Barrel Test Business",
      status: "approved",
      enabledServices: ["barrelShipping", "sharedBarrels"],
    }),
    db.collection("businesses").doc(BUSINESS_ID)
        .collection("destinationCountries")
        .doc(COUNTRY_ID)
        .set({
          countryId: COUNTRY_ID,
          name: "Guinea",
          isActive: true,
          barrelShippingPrice: 200,
          barrelShippingDeliveryEstimateMinDays: 20,
          barrelShippingDeliveryEstimateMaxDays: 30,
        }),
  ]);
}

async function createPool({
  totalShares = 2,
  ownerShares = 1,
  maxJoiners = 1,
  approvalMode = "auto",
} = {}) {
  const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString();
  return functions.createBarrelPool.run({
    auth: {uid: OWNER_UID},
    data: {
      businessId: BUSINESS_ID,
      destinationCountryId: COUNTRY_ID,
      origin: "customerPosted",
      totalShares,
      sharesClaimed: ownerShares,
      maxJoiners,
      approvalMode,
      joinDeadline: deadline,
      shipMode: "sea",
      marketplaceDisclosure: acceptedMarketplaceDisclosure(),
      ...participantInput("Owner", "+15555550101"),
    },
  });
}

async function joinPoolAs({
  uid = JOINER_UID,
  label = "Joiner",
  phone = "+15555550102",
  poolId,
  sharesClaimed = 1,
  destinationCountryId = COUNTRY_ID,
}) {
  return functions.requestJoinBarrelPool.run({
    auth: {uid},
    data: {
      poolId,
      destinationCountryId,
      sharesClaimed,
      marketplaceDisclosure: acceptedMarketplaceDisclosure(),
      ...participantInput(label, phone),
    },
  });
}

async function joinPool(poolId, sharesClaimed = 1) {
  return joinPoolAs({poolId, sharesClaimed});
}

async function createBusinessPool({
  origin = "businessHeld",
  totalShares = 2,
  reservedShares = 0,
  maxJoiners = 2,
  extraData = {},
} = {}) {
  const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString();
  return functions.createBusinessBarrelPool.run({
    auth: {uid: STAFF_UID},
    data: {
      businessId: BUSINESS_ID,
      creationId: `test-business-pool-${++businessPoolSequence}`,
      destinationCountryId: COUNTRY_ID,
      origin,
      totalShares,
      reservedShares,
      maxJoiners,
      approvalMode: "approval",
      joinDeadline: deadline,
      shipMode: "sea",
      ...extraData,
    },
  });
}

async function poolData(poolId) {
  const doc = await db.collection("barrelPools").doc(poolId).get();
  return doc.data() || {};
}

async function participantData(poolId, uid) {
  const doc = await db.collection("barrelPools").doc(poolId)
      .collection("participants").doc(uid).get();
  return doc.data() || {};
}

async function refundRequestsFor(poolId) {
  const snapshot = await db.collection("walletRefundRequests")
      .where("barrelPoolId", "==", poolId)
      .get();
  return snapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}));
}

describe("shared barrel callable lifecycle", () => {
  before(seedSharedBarrelFixture);

  it("lists sanitized open pools without requiring authentication",
      async () => {
        await db.collection("openBarrels").doc("public-pool-option").set({
          businessId: BUSINESS_ID,
          businessName: "Shared Barrel Test Business",
          destinationCountryId: COUNTRY_ID,
          destinationCountryName: "Guinea",
          sharesAvailable: 2,
          totalShares: 4,
          pricePerShare: 100,
          depositPerShare: 30,
          currency: "usd",
          status: "open",
          createdByUid: OWNER_UID,
          publicParticipants: {[OWNER_UID]: {name: "Private Owner"}},
        });

        const result = await functions.listOpenBarrelPoolOptions.run({
          data: {},
        });
        const option = result.options.find((row) =>
          row.id === "public-pool-option");
        assert.ok(option);
        assert.equal(option.sharesAvailable, 2);
        assert.equal(Object.hasOwn(option, "createdByUid"), false);
        assert.equal(Object.hasOwn(option, "publicParticipants"), false);
      });

  it("requires verified customer phone numbers to create and join pools",
      async () => {
        const disclosureCountBefore = (
          await db.collection("marketplaceDisclosureAcceptances").get()
        ).size;
        await assert.rejects(
            () => functions.createBarrelPool.run({
              auth: {uid: UNVERIFIED_UID},
              data: {
                businessId: BUSINESS_ID,
                destinationCountryId: COUNTRY_ID,
                origin: "customerPosted",
                totalShares: 2,
                sharesClaimed: 1,
                maxJoiners: 1,
                approvalMode: "auto",
                joinDeadline: new Date(
                    Date.now() + 7 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                shipMode: "sea",
                marketplaceDisclosure: acceptedMarketplaceDisclosure(),
                ...participantInput("Unverified", "+15555550103"),
              },
            }),
            (error) => {
              assert.equal(error.code, "failed-precondition");
              assert.deepEqual(error.details, {
                reason: "phone-verification-required",
              });
              return true;
            },
        );
        const disclosureCountAfterCreateRejection = (
          await db.collection("marketplaceDisclosureAcceptances").get()
        ).size;
        assert.equal(
            disclosureCountAfterCreateRejection,
            disclosureCountBefore,
        );

        const created = await createPool();
        const disclosureCountBeforeJoinRejection = (
          await db.collection("marketplaceDisclosureAcceptances").get()
        ).size;
        await assert.rejects(
            () => functions.requestJoinBarrelPool.run({
              auth: {uid: UNVERIFIED_UID},
              data: {
                poolId: created.poolId,
                sharesClaimed: 1,
                marketplaceDisclosure: acceptedMarketplaceDisclosure(),
                ...participantInput("Unverified", "+15555550103"),
              },
            }),
            /Verify your phone number before using shared barrels/,
        );
        const disclosureCountAfter = (
          await db.collection("marketplaceDisclosureAcceptances").get()
        ).size;
        assert.equal(
            disclosureCountAfter,
            disclosureCountBeforeJoinRejection,
        );
      });

  it("rejects a stale verified flag when the Auth phone does not match",
      async () => {
        await assert.rejects(
            () => functions.createBarrelPool.run({
              auth: {uid: MISMATCHED_PHONE_UID},
              data: {
                businessId: BUSINESS_ID,
                destinationCountryId: COUNTRY_ID,
                origin: "customerPosted",
                totalShares: 2,
                sharesClaimed: 1,
                maxJoiners: 1,
                approvalMode: "auto",
                joinDeadline: new Date(
                    Date.now() + 7 * 24 * 60 * 60 * 1000,
                ).toISOString(),
                shipMode: "sea",
                marketplaceDisclosure: acceptedMarketplaceDisclosure(),
                ...participantInput("Mismatched", "+15555550888"),
              },
            }),
            (error) => {
              assert.equal(error.code, "failed-precondition");
              assert.equal(
                  error.details?.reason,
                  "phone-verification-required",
              );
              return true;
            },
        );
      });

  it("syncs only the phone verified by Firebase Auth", async () => {
    const result = await functions.syncVerifiedCustomerPhone.run({
      auth: {uid: MISMATCHED_PHONE_UID},
      data: {},
    });
    assert.equal(result.phone, authPhones[MISMATCHED_PHONE_UID]);
    assert.equal(result.phoneVerified, true);

    const profile = await db.collection("users")
        .doc(MISMATCHED_PHONE_UID).get();
    assert.equal(profile.data().phone, authPhones[MISMATCHED_PHONE_UID]);
    assert.equal(profile.data().normalizedPhone, "15555550999");
    assert.equal(profile.data().phoneVerified, true);
    const alias = await db.collection("phoneSignInAliases")
        .doc("15555550999").get();
    assert.equal(alias.data().uid, MISMATCHED_PHONE_UID);
  });

  it("clears verification when the customer changes the profile phone",
      async () => {
        const result = await functions.updateCustomerProfile.run({
          auth: {
            uid: MISMATCHED_PHONE_UID,
            token: {email: authEmails[MISMATCHED_PHONE_UID]},
          },
          data: {
            fullName: "Mismatched Phone Customer",
            phone: "+15555550777",
          },
        });
        assert.equal(result.phoneVerified, false);

        const profile = await db.collection("users")
            .doc(MISMATCHED_PHONE_UID).get();
        assert.equal(profile.data().phone, "+15555550777");
        assert.equal(profile.data().phoneVerified, false);
        assert.equal(profile.data().phoneVerifiedAt, undefined);
        const previousAlias = await db.collection("phoneSignInAliases")
            .doc("15555550999").get();
        const unverifiedAlias = await db.collection("phoneSignInAliases")
            .doc("15555550777").get();
        assert.equal(previousAlias.exists, false);
        assert.equal(unverifiedAlias.exists, false);
      });

  it("does not sync a profile when Firebase Auth has no verified phone",
      async () => {
        await assert.rejects(
            () => functions.syncVerifiedCustomerPhone.run({
              auth: {uid: UNVERIFIED_UID},
              data: {},
            }),
            (error) => {
              assert.equal(error.code, "failed-precondition");
              assert.equal(
                  error.details?.reason,
                  "phone-verification-required",
              );
              return true;
            },
        );
      });

  it("requires business-created origins to go through business intake",
      async () => {
        for (const origin of ["dropOff", "businessHeld"]) {
          await assert.rejects(
              () => functions.createBarrelPool.run({
                auth: {uid: OWNER_UID},
                data: {
                  businessId: BUSINESS_ID,
                  destinationCountryId: COUNTRY_ID,
                  origin,
                  totalShares: 2,
                  sharesClaimed: 1,
                  maxJoiners: 1,
                  approvalMode: "auto",
                  joinDeadline: new Date(
                      Date.now() + 7 * 24 * 60 * 60 * 1000,
                  ).toISOString(),
                  shipMode: "sea",
                  marketplaceDisclosure: acceptedMarketplaceDisclosure(),
                  ...participantInput(`Customer ${origin}`, "+15555550106"),
                },
              }),
              /Customers can only post customer-held shared barrels/,
          );
        }
      });

  it("rejects joiners whose destination does not match the pool", async () => {
    const created = await createPool();

    await assert.rejects(
        () => joinPoolAs({
          poolId: created.poolId,
          destinationCountryId: "sn",
        }),
        /Joiner destination must match the shared barrel destination/,
    );

    const participantDoc = await db.collection("barrelPools")
        .doc(created.poolId)
        .collection("participants")
        .doc(JOINER_UID)
        .get();
    assert.equal(participantDoc.exists, false);

    await joinPool(created.poolId);
    const joiner = await participantData(created.poolId, JOINER_UID);
    assert.equal(joiner.destinationCountryId, COUNTRY_ID);
    assert.equal(joiner.destinationCountryName, "Guinea");
  });

  it("creates business consolidation pools with inspection controls",
      async () => {
        const businessHeld = await createBusinessPool();

        assert.equal(businessHeld.success, true);
        assert.equal(businessHeld.origin, "businessHeld");

        const businessHeldPool = await poolData(businessHeld.poolId);
        assert.equal(businessHeldPool.origin, "businessHeld");
        assert.equal(businessHeldPool.holderRole, "business");
        assert.equal(businessHeldPool.createdByRole, "business");
        assert.equal(businessHeldPool.status, "open");
        assert.equal(businessHeldPool.openShares, 2);
        assert.equal(businessHeldPool.takenShares, 0);

        const adjusted = await functions.adjustBarrelPoolCapacity.run({
          auth: {uid: STAFF_UID},
          data: {
            poolId: businessHeld.poolId,
            totalShares: 4,
            inspectionNote:
              "Business measured an empty barrel with four shares.",
          },
        });
        assert.equal(adjusted.success, true);

        const adjustedPool = await poolData(businessHeld.poolId);
        assert.equal(adjustedPool.totalShares, 4);
        assert.equal(adjustedPool.openShares, 4);
        assert.equal(adjustedPool.lastShareAdjustment.totalShares, 4);

        const dropOff = await createBusinessPool({
          origin: "dropOff",
          totalShares: 4,
          reservedShares: 3,
          maxJoiners: 1,
          extraData: participantInput("Dropoff", "+15555550104", 45),
        });

        assert.equal(dropOff.success, true);
        assert.equal(dropOff.origin, "dropOff");

        const dropOffPool = await poolData(dropOff.poolId);
        assert.equal(dropOffPool.origin, "dropOff");
        assert.equal(dropOffPool.holderRole, "business");
        assert.equal(dropOffPool.status, "partially_filled");
        assert.equal(dropOffPool.openShares, 1);
        assert.equal(dropOffPool.takenShares, 3);

        const dropOffParticipants = await db.collection("barrelPools")
            .doc(dropOff.poolId)
            .collection("participants")
            .get();
        assert.equal(dropOffParticipants.size, 1);
        const participant = dropOffParticipants.docs[0].data();
        assert.equal(participant.managedByBusiness, true);
        assert.equal(participant.paymentStatus, "collected_by_business");
        assert.equal(participant.maxWeightKg, 60);

        await assert.rejects(
            () => functions.adjustBarrelPoolCapacity.run({
              auth: {uid: STAFF_UID},
              data: {
                poolId: dropOff.poolId,
                totalShares: 2,
                inspectionNote: "Too small after intake.",
              },
            }),
            /Adjusted total shares cannot be below reserved shares/,
        );
      });

  it("treats date-only pool deadlines as the end of the selected day",
      async () => {
        const selectedDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 10);
        const created = await functions.createBusinessBarrelPool.run({
          auth: {uid: STAFF_UID},
          data: {
            businessId: BUSINESS_ID,
            creationId: `test-business-pool-${++businessPoolSequence}`,
            destinationCountryId: COUNTRY_ID,
            origin: "businessHeld",
            totalShares: 2,
            reservedShares: 0,
            maxJoiners: 2,
            approvalMode: "approval",
            joinDeadline: selectedDate,
            shipMode: "sea",
          },
        });

        const pool = await poolData(created.poolId);
        assert.equal(
            pool.joinDeadline.toMillis(),
            Date.parse(`${selectedDate}T23:59:59.999Z`),
        );
      });

  it("rejects invalid business pool contracts",
      async () => {
        const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            .toISOString();
        const baseData = {
          businessId: BUSINESS_ID,
          destinationCountryId: COUNTRY_ID,
          creationId: `test-business-pool-${++businessPoolSequence}`,
          origin: "businessHeld",
          totalShares: 4,
          reservedShares: 0,
          maxJoiners: 4,
          approvalMode: "approval",
          joinDeadline: deadline,
          shipMode: "sea",
        };

        await assert.rejects(
            () => functions.createBusinessBarrelPool.run({
              auth: {uid: STAFF_UID},
              data: {...baseData, reservedShares: 1},
            }),
            /must start with 0 reserved shares/,
        );
        await assert.rejects(
            () => functions.createBusinessBarrelPool.run({
              auth: {uid: STAFF_UID},
              data: {...baseData, maxJoiners: 5},
            }),
            /Max joiners must fit the open shares/,
        );
        await assert.rejects(
            () => functions.createBusinessBarrelPool.run({
              auth: {uid: STAFF_UID},
              data: {...baseData, shipMode: "ground"},
            }),
            /Invalid ship mode/,
        );
        await assert.rejects(
            () => functions.createBusinessBarrelPool.run({
              auth: {uid: STAFF_UID},
              data: {...baseData, joinDeadline: ""},
            }),
            /Choose a valid join deadline/,
        );
      });

  it("deduplicates retried business pool creation requests", async () => {
    const creationId = `test-business-pool-${++businessPoolSequence}`;
    const first = await createBusinessPool({
      extraData: {creationId},
    });
    const second = await createBusinessPool({
      extraData: {creationId},
    });

    assert.equal(second.duplicate, true);
    assert.equal(second.poolId, first.poolId);
    assert.equal(second.trackingCode, first.trackingCode);

    const snapshot = await db.collection("barrelPools")
        .where("trackingCode", "==", first.trackingCode)
        .get();
    assert.equal(snapshot.size, 1);
  });

  it("lets businesses approve or reject requested joiners", async () => {
    const acceptPool = await createBusinessPool();
    await joinPool(acceptPool.poolId);

    const requestedJoiner = await participantData(
        acceptPool.poolId,
        JOINER_UID,
    );
    assert.equal(requestedJoiner.joinStatus, "requested");
    assert.equal(requestedJoiner.paymentStatus, "succeeded");

    const approved = await functions.decideBarrelPoolJoin.run({
      auth: {uid: STAFF_UID},
      data: {
        poolId: acceptPool.poolId,
        participantUid: JOINER_UID,
        decision: "accept",
      },
    });

    assert.equal(approved.success, true);
    assert.equal(approved.decision, "accept");

    const [acceptedPool, acceptedJoiner] = await Promise.all([
      poolData(acceptPool.poolId),
      participantData(acceptPool.poolId, JOINER_UID),
    ]);
    assert.equal(acceptedPool.requestedShares, 0);
    assert.equal(acceptedPool.acceptedShares, 1);
    assert.equal(
        acceptedPool.publicParticipants[JOINER_UID].joinStatus,
        "accepted",
    );
    assert.equal(acceptedJoiner.joinStatus, "accepted");

    const rejectPool = await createBusinessPool();
    await joinPool(rejectPool.poolId);

    const rejected = await functions.decideBarrelPoolJoin.run({
      auth: {uid: STAFF_UID},
      data: {
        poolId: rejectPool.poolId,
        participantUid: JOINER_UID,
        decision: "reject",
      },
    });

    assert.equal(rejected.success, true);
    assert.equal(rejected.decision, "reject");

    const [reopenedPool, rejectedJoiner, refunds] = await Promise.all([
      poolData(rejectPool.poolId),
      participantData(rejectPool.poolId, JOINER_UID),
      refundRequestsFor(rejectPool.poolId),
    ]);
    assert.equal(reopenedPool.status, "open");
    assert.equal(reopenedPool.openShares, 2);
    assert.equal(reopenedPool.takenShares, 0);
    assert.equal(reopenedPool.requestedShares, 0);
    assert.equal(
        reopenedPool.publicParticipants[JOINER_UID].joinStatus,
        "rejected",
    );
    assert.equal(rejectedJoiner.joinStatus, "rejected");
    assert.equal(rejectedJoiner.paymentStatus, "refund_pending");
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].participantUid, JOINER_UID);
  });

  it("enforces max joiners without leaving unfillable shares", async () => {
    const singleJoinerPool = await createPool({
      totalShares: 4,
      ownerShares: 1,
      maxJoiners: 1,
    });

    await assert.rejects(
        () => joinPool(singleJoinerPool.poolId, 1),
        /The final joiner must claim all remaining shares/,
    );

    await joinPool(singleJoinerPool.poolId, 3);
    const filledSingleJoinerPool = await poolData(singleJoinerPool.poolId);
    assert.equal(filledSingleJoinerPool.openShares, 0);
    assert.equal(filledSingleJoinerPool.takenShares, 4);
    assert.equal(filledSingleJoinerPool.status, "full");

    const multiJoinerPool = await createPool({
      totalShares: 4,
      ownerShares: 1,
      maxJoiners: 2,
    });
    await joinPool(multiJoinerPool.poolId, 1);

    await assert.rejects(
        () => joinPoolAs({
          uid: SECOND_JOINER_UID,
          label: "Second Joiner",
          phone: "+15555550105",
          poolId: multiJoinerPool.poolId,
          sharesClaimed: 1,
        }),
        /The final joiner must claim all remaining shares/,
    );

    await joinPoolAs({
      uid: SECOND_JOINER_UID,
      label: "Second Joiner",
      phone: "+15555550105",
      poolId: multiJoinerPool.poolId,
      sharesClaimed: 2,
    });

    const filledMultiJoinerPool = await poolData(multiJoinerPool.poolId);
    assert.equal(filledMultiJoinerPool.openShares, 0);
    assert.equal(filledMultiJoinerPool.takenShares, 4);
    assert.equal(filledMultiJoinerPool.status, "full");
    assert.equal(
        filledMultiJoinerPool.publicParticipants[SECOND_JOINER_UID]
            .joinStatus,
        "accepted",
    );
  });

  it("creates, joins, and seals a customer-posted shared barrel", async () => {
    const created = await createPool();

    assert.equal(created.success, true);
    assert.equal(created.simulatedPayment, true);
    assert.ok(created.poolId);

    const joined = await joinPool(created.poolId);

    assert.equal(joined.success, true);
    assert.equal(joined.simulatedPayment, true);

    const fullPoolDoc = await db.collection("barrelPools")
        .doc(created.poolId)
        .get();
    const fullPool = fullPoolDoc.data() || {};
    assert.equal(fullPool.status, "full");
    assert.equal(fullPool.openShares, 0);
    assert.equal(fullPool.acceptedShares, 2);
    assert.equal(fullPool.publicParticipants[JOINER_UID].joinStatus,
        "accepted");

    const sealed = await functions.sealBarrelPool.run({
      auth: {uid: STAFF_UID},
      data: {poolId: created.poolId},
    });

    assert.equal(sealed.success, true);
    assert.ok(sealed.shipmentId);
    assert.ok(sealed.trackingCode);

    const [sealedPoolDoc, shipmentDoc, ownerMirrorDoc, joinerMirrorDoc,
      ownerParticipantDoc, joinerParticipantDoc] = await Promise.all([
      db.collection("barrelPools").doc(created.poolId).get(),
      db.collection("barrelShipments").doc(sealed.shipmentId).get(),
      db.collection("users").doc(OWNER_UID)
          .collection("barrelPools").doc(created.poolId).get(),
      db.collection("users").doc(JOINER_UID)
          .collection("barrelPools").doc(created.poolId).get(),
      db.collection("barrelPools").doc(created.poolId)
          .collection("participants").doc(OWNER_UID).get(),
      db.collection("barrelPools").doc(created.poolId)
          .collection("participants").doc(JOINER_UID).get(),
    ]);

    const sealedPool = sealedPoolDoc.data() || {};
    const shipment = shipmentDoc.data() || {};
    const ownerMirror = ownerMirrorDoc.data() || {};
    const joinerMirror = joinerMirrorDoc.data() || {};
    const ownerParticipant = ownerParticipantDoc.data() || {};
    const joinerParticipant = joinerParticipantDoc.data() || {};

    assert.equal(sealedPool.status, "sealed");
    assert.equal(sealedPool.shipmentId, sealed.shipmentId);
    assert.equal(sealedPool.balancePaymentStatus, "succeeded");
    assert.equal(shipment.sharedPoolId, created.poolId);
    assert.equal(shipment.paymentStatus, "succeeded");
    assert.equal(ownerMirror.status, "sealed");
    assert.equal(joinerMirror.status, "sealed");
    assert.equal(ownerParticipant.balancePaymentStatus, "succeeded");
    assert.equal(joinerParticipant.balancePaymentStatus, "succeeded");
    assert.deepEqual(ownerParticipant.balanceStripePaymentIntentIds, [
      `simulated_barrel_pool_balance_${created.poolId}_${OWNER_UID}`,
    ]);
    assert.deepEqual(joinerParticipant.balanceStripePaymentIntentIds, [
      `simulated_barrel_pool_balance_${created.poolId}_${JOINER_UID}`,
    ]);
  });

  it("only seals underfilled pools after the join deadline", async () => {
    const created = await createPool({totalShares: 3, maxJoiners: 2});
    await joinPool(created.poolId);

    await assert.rejects(
        () => functions.sealBarrelPool.run({
          auth: {uid: STAFF_UID},
          data: {poolId: created.poolId},
        }),
        /This pool still has open shares/,
    );
    await assert.rejects(
        () => functions.sealBarrelPool.run({
          auth: {uid: STAFF_UID},
          data: {poolId: created.poolId, shipUnderfilled: true},
        }),
        /Underfilled pools can only ship after the join deadline/,
    );

    await db.collection("barrelPools").doc(created.poolId).update({
      joinDeadline: admin.firestore.Timestamp.fromMillis(Date.now() - 1000),
    });

    const sealed = await functions.sealBarrelPool.run({
      auth: {uid: STAFF_UID},
      data: {poolId: created.poolId, shipUnderfilled: true},
    });
    assert.equal(sealed.success, true);

    const [sealedPool, ownerParticipant, shipmentDoc] = await Promise.all([
      poolData(created.poolId),
      participantData(created.poolId, OWNER_UID),
      db.collection("barrelShipments").doc(sealed.shipmentId).get(),
    ]);
    const shipment = shipmentDoc.data() || {};

    assert.equal(sealedPool.status, "sealed");
    assert.equal(sealedPool.underfilledShares, 1);
    assert.equal(sealedPool.underfilledAmountCents, 6667);
    assert.equal(ownerParticipant.underfilledBalanceAmountCents, 6667);
    assert.equal(shipment.sharedPoolUnderfilledShares, 1);
    assert.equal(shipment.sharedPoolUnderfilledAmountCents, 6667);
  });

  it("rolls expired underfilled pools into business-held matching",
      async () => {
        const created = await createPool({totalShares: 3, maxJoiners: 2});
        const futureDeadline = new Date(
            Date.now() + 10 * 24 * 60 * 60 * 1000,
        ).toISOString();

        await assert.rejects(
            () => functions.rollBarrelPoolToBusinessHeld.run({
              auth: {uid: STAFF_UID},
              data: {
                poolId: created.poolId,
                joinDeadline: futureDeadline,
              },
            }),
            /only after the join deadline/,
        );

        await db.collection("barrelPools").doc(created.poolId).update({
          joinDeadline: admin.firestore.Timestamp.fromMillis(
              Date.now() - 1000,
          ),
        });

        await assert.rejects(
            () => joinPoolAs({poolId: created.poolId, uid: JOINER_UID}),
            /The join deadline has passed/,
        );
        await assert.rejects(
            () => functions.rollBarrelPoolToBusinessHeld.run({
              auth: {uid: OWNER_UID},
              data: {
                poolId: created.poolId,
                joinDeadline: futureDeadline,
              },
            }),
            /permission|business/i,
        );

        const rolled = await functions.rollBarrelPoolToBusinessHeld.run({
          auth: {uid: STAFF_UID},
          data: {
            poolId: created.poolId,
            joinDeadline: futureDeadline,
            maxJoiners: 2,
            note: "Customer dropped the underfilled barrel at the hub.",
          },
        });

        assert.equal(rolled.success, true);
        assert.equal(rolled.origin, "businessHeld");

        const [rolledPool, ownerMembership] = await Promise.all([
          poolData(created.poolId),
          db.collection("users").doc(OWNER_UID)
              .collection("barrelPools").doc(created.poolId).get(),
        ]);
        assert.equal(rolledPool.origin, "businessHeld");
        assert.equal(rolledPool.holderRole, "business");
        assert.equal(rolledPool.openShares, 2);
        assert.equal(rolledPool.status, "partially_filled");
        assert.equal(
            rolledPool.businessHeldRollover.previousOrigin,
            "customerPosted",
        );
        assert.equal(
            rolledPool.businessHeldRollover.note,
            "Customer dropped the underfilled barrel at the hub.",
        );
        assert.equal(ownerMembership.get("origin"), "businessHeld");
        assert.equal(ownerMembership.get("holderRole"), "business");

        const joined = await joinPoolAs({
          poolId: created.poolId,
          uid: JOINER_UID,
        });
        assert.equal(joined.success, true);

        const joinedPool = await poolData(created.poolId);
        assert.equal(joinedPool.origin, "businessHeld");
        assert.equal(joinedPool.openShares, 1);
        assert.equal(joinedPool.acceptedShares, 2);
      });

  it("refunds requested joiners who leave before approval", async () => {
    const created = await createPool({approvalMode: "approval"});
    await joinPool(created.poolId);

    const left = await functions.leaveBarrelPool.run({
      auth: {uid: JOINER_UID},
      data: {poolId: created.poolId},
    });

    assert.equal(left.success, true);
    assert.equal(left.refundedAmount, 30);
    assert.equal(left.forfeitedAmount, 0);

    const [pool, joiner, refunds] = await Promise.all([
      poolData(created.poolId),
      participantData(created.poolId, JOINER_UID),
      refundRequestsFor(created.poolId),
    ]);
    assert.equal(pool.status, "partially_filled");
    assert.equal(pool.openShares, 1);
    assert.equal(pool.takenShares, 1);
    assert.equal(pool.requestedShares, 0);
    assert.equal(pool.acceptedShares, 1);
    assert.equal(
        pool.publicParticipants[JOINER_UID].joinStatus,
        "cancelled",
    );
    assert.equal(joiner.joinStatus, "cancelled");
    assert.equal(joiner.paymentStatus, "refund_pending");
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].participantUid, JOINER_UID);
    assert.equal(refunds[0].amountCents, 3000);
  });

  it("forfeits an accepted joiner deposit after the grace window", async () => {
    const created = await createPool();
    await joinPool(created.poolId);
    const staleAcceptedAt = admin.firestore.Timestamp.fromMillis(
        Date.now() - 2 * 24 * 60 * 60 * 1000,
    );
    await db.collection("barrelPools").doc(created.poolId)
        .collection("participants").doc(JOINER_UID)
        .update({acceptedAt: staleAcceptedAt});

    const left = await functions.leaveBarrelPool.run({
      auth: {uid: JOINER_UID},
      data: {poolId: created.poolId},
    });

    assert.equal(left.success, true);
    assert.equal(left.refundedAmount, 0);
    assert.equal(left.forfeitedAmount, 30);

    const [pool, joiner, refunds] = await Promise.all([
      poolData(created.poolId),
      participantData(created.poolId, JOINER_UID),
      refundRequestsFor(created.poolId),
    ]);
    assert.equal(pool.status, "partially_filled");
    assert.equal(pool.openShares, 1);
    assert.equal(pool.forfeitedDepositAmountCents, 3000);
    assert.equal(joiner.joinStatus, "forfeited");
    assert.equal(joiner.paymentStatus, "forfeited");
    assert.equal(refunds.length, 0);
  });

  it("cancels by owner with owner forfeiture and joiner refund", async () => {
    const created = await createPool();
    await joinPool(created.poolId);

    const cancelled = await functions.cancelBarrelPool.run({
      auth: {uid: OWNER_UID},
      data: {poolId: created.poolId},
    });

    assert.equal(cancelled.success, true);

    const [pool, owner, joiner, refunds] = await Promise.all([
      poolData(created.poolId),
      participantData(created.poolId, OWNER_UID),
      participantData(created.poolId, JOINER_UID),
      refundRequestsFor(created.poolId),
    ]);
    assert.equal(pool.status, "cancelled");
    assert.equal(pool.forfeitedDepositAmountCents, 3000);
    assert.equal(owner.joinStatus, "forfeited");
    assert.equal(owner.paymentStatus, "forfeited");
    assert.equal(joiner.joinStatus, "cancelled");
    assert.equal(joiner.paymentStatus, "refund_pending");
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].participantUid, JOINER_UID);
    assert.equal(refunds[0].amountCents, 3000);
  });

  it("cancels by owner with requested joiner refund", async () => {
    const created = await createPool({approvalMode: "approval"});
    await joinPool(created.poolId);

    const requestedJoiner = await participantData(created.poolId, JOINER_UID);
    assert.equal(requestedJoiner.joinStatus, "requested");

    const cancelled = await functions.cancelBarrelPool.run({
      auth: {uid: OWNER_UID},
      data: {poolId: created.poolId},
    });

    assert.equal(cancelled.success, true);

    const [pool, owner, joiner, refunds] = await Promise.all([
      poolData(created.poolId),
      participantData(created.poolId, OWNER_UID),
      participantData(created.poolId, JOINER_UID),
      refundRequestsFor(created.poolId),
    ]);
    assert.equal(pool.status, "cancelled");
    assert.equal(pool.forfeitedDepositAmountCents, 3000);
    assert.equal(owner.joinStatus, "forfeited");
    assert.equal(owner.paymentStatus, "forfeited");
    assert.equal(joiner.joinStatus, "cancelled");
    assert.equal(joiner.paymentStatus, "refund_pending");
    assert.equal(pool.publicParticipants[OWNER_UID].joinStatus, "forfeited");
    assert.equal(pool.publicParticipants[JOINER_UID].joinStatus, "cancelled");
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].participantUid, JOINER_UID);
    assert.equal(refunds[0].amountCents, 3000);
  });

  it("cancels by business with requested-joiner refunds", async () => {
    const created = await createPool({approvalMode: "approval"});
    await joinPool(created.poolId);

    const requestedJoiner = await participantData(created.poolId, JOINER_UID);
    assert.equal(requestedJoiner.joinStatus, "requested");

    const cancelled = await functions.cancelBarrelPool.run({
      auth: {uid: STAFF_UID},
      data: {poolId: created.poolId},
    });

    assert.equal(cancelled.success, true);

    const [pool, owner, joiner, refunds] = await Promise.all([
      poolData(created.poolId),
      participantData(created.poolId, OWNER_UID),
      participantData(created.poolId, JOINER_UID),
      refundRequestsFor(created.poolId),
    ]);
    assert.equal(pool.status, "cancelled");
    assert.equal(Number(pool.forfeitedDepositAmountCents || 0), 0);
    assert.equal(owner.joinStatus, "cancelled");
    assert.equal(owner.paymentStatus, "refund_pending");
    assert.equal(joiner.joinStatus, "cancelled");
    assert.equal(joiner.paymentStatus, "refund_pending");
    assert.deepEqual(
        refunds.map((refund) => refund.participantUid).sort(),
        [JOINER_UID, OWNER_UID].sort(),
    );
  });

  it("expires underfilled pools and queues no-fault refunds", async () => {
    const created = await createPool({totalShares: 3, maxJoiners: 2});
    await joinPool(created.poolId);
    await db.collection("barrelPools").doc(created.poolId).update({
      joinDeadline: admin.firestore.Timestamp.fromMillis(Date.now() - 1000),
    });

    await functions.expireBarrelPools.run();

    const [pool, owner, joiner, refunds] = await Promise.all([
      poolData(created.poolId),
      participantData(created.poolId, OWNER_UID),
      participantData(created.poolId, JOINER_UID),
      refundRequestsFor(created.poolId),
    ]);
    assert.equal(pool.status, "expired");
    assert.equal(owner.joinStatus, "cancelled");
    assert.equal(owner.paymentStatus, "refund_pending");
    assert.equal(joiner.joinStatus, "cancelled");
    assert.equal(joiner.paymentStatus, "refund_pending");
    assert.equal(refunds.length, 2);
    assert.deepEqual(
        refunds.map((refund) => refund.participantUid).sort(),
        [JOINER_UID, OWNER_UID].sort(),
    );
  });
});
