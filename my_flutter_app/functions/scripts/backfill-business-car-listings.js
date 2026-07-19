"use strict";

const admin = require("firebase-admin");
const {
  buildBusinessCarBackfillPayload,
  buildBusinessCarBackfillResult,
  eligibleBackfillDocs,
  normalizeBackfillCarIds,
} = require("../business_car_backfill");

const DEFAULT_BUSINESS_SERVICES = [
  "barrelShipping",
  "carSales",
  "carParking",
  "carTransport",
];

function readArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) =>
      letter.toUpperCase());
    if (inlineValue != null) {
      args[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function csvValues(value) {
  return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
}

function normalizeServices(value) {
  if (!Array.isArray(value)) return DEFAULT_BUSINESS_SERVICES;
  const services = value.map((item) => String(item || "").trim())
      .filter(Boolean);
  return services.length ? services : DEFAULT_BUSINESS_SERVICES;
}

async function loadDocs(db, {
  carIds,
  legacyBusinessName,
  limit,
  afterId,
}) {
  if (carIds.length) {
    return db.getAll(...carIds.map((id) => db.collection("cars").doc(id)));
  }

  let query = db.collection("cars")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(limit);
  if (legacyBusinessName) {
    query = db.collection("cars")
        .where("businessName", "==", legacyBusinessName)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(limit);
  }
  if (afterId) {
    query = query.startAfter(afterId);
  }
  const snapshot = await query.get();
  return snapshot.docs;
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const businessId = String(args.businessId || "").trim();
  if (!businessId) {
    throw new Error("Missing --business-id");
  }

  const carIds = normalizeBackfillCarIds(csvValues(args.carIds));
  const reassignExplicitCarIds =
    args.reassignExplicitCarIds === true ||
    args.reassignExplicitCarIds === "true";
  if (reassignExplicitCarIds && carIds.length === 0) {
    throw new Error("--reassign-explicit-car-ids requires --car-ids");
  }

  const projectId = String(args.project || process.env.GCLOUD_PROJECT || "")
      .trim();
  admin.initializeApp(projectId ? {projectId} : undefined);
  const db = admin.firestore();

  const businessDoc = await db.collection("businesses").doc(businessId).get();
  if (!businessDoc.exists) {
    throw new Error(`Business not found: ${businessId}`);
  }

  const business = businessDoc.data() || {};
  const docs = await loadDocs(db, {
    carIds,
    legacyBusinessName: String(args.legacyBusinessName || "").trim(),
    limit: Math.min(Math.max(Number(args.limit) || 100, 1), 500),
    afterId: String(args.afterId || "").trim(),
  });
  const eligibleDocs = eligibleBackfillDocs(docs, {
    allowAssigned: reassignExplicitCarIds,
    targetBusinessId: businessId,
  });
  const dryRun = args.commit !== true && args.commit !== "true";
  const result = buildBusinessCarBackfillResult({
    dryRun,
    businessId,
    docs,
    eligibleDocs,
  });

  if (!dryRun && eligibleDocs.length) {
    const update = buildBusinessCarBackfillPayload({
      businessId,
      business,
      enabledServices: normalizeServices(business.enabledServices),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    for (let index = 0; index < eligibleDocs.length; index += 200) {
      const batch = db.batch();
      eligibleDocs.slice(index, index + 200).forEach((doc) => {
        batch.set(doc.ref, update, {merge: true});
      });
      await batch.commit();
      result.updated += eligibleDocs.slice(index, index + 200).length;
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
