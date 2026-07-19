"use strict";

function cleanBackfillText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeBackfillCarIds(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const ids = [];
  raw.forEach((value) => {
    const id = cleanBackfillText(value, 160);
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids.slice(0, 200);
}

function needsBusinessCarBackfill(data, {
  allowAssigned = false,
  targetBusinessId = "",
} = {}) {
  const currentBusinessId = String(data?.businessId || "").trim();
  if (!currentBusinessId) return true;
  return allowAssigned && currentBusinessId !== targetBusinessId;
}

function eligibleBackfillDocs(docs, options = {}) {
  return docs.filter((doc) =>
    doc.exists && needsBusinessCarBackfill(doc.data(), options),
  );
}

function buildBusinessCarBackfillPayload({
  businessId,
  business,
  enabledServices,
  updatedAt,
}) {
  return {
    businessId,
    businessName: business.name || businessId,
    businessStatus: business.status || "pending",
    businessProfileImageUrl: business.profileImageUrl || "",
    enabledServices,
    updatedAt,
  };
}

function backfillDocDetail(doc, {
  eligibleIds = new Set(),
} = {}) {
  const data = doc.data() || {};
  return {
    id: doc.id,
    eligible: eligibleIds.has(doc.id),
    currentBusinessId: cleanBackfillText(data.businessId, 120),
    businessName: cleanBackfillText(data.businessName, 160),
    title: cleanBackfillText(data.title || data.name, 160),
    status: cleanBackfillText(data.status, 80),
  };
}

function buildBusinessCarBackfillResult({
  dryRun,
  businessId,
  docs,
  eligibleDocs,
  updated = 0,
}) {
  const eligibleIds = new Set(eligibleDocs.map((doc) => doc.id));
  return {
    success: true,
    dryRun,
    businessId,
    scanned: docs.length,
    eligible: eligibleDocs.length,
    updated,
    skipped: docs.length - eligibleDocs.length,
    nextAfterId: docs.length ? docs[docs.length - 1].id : "",
    carIds: eligibleDocs.map((doc) => doc.id),
    inspected: docs.map((doc) => backfillDocDetail(doc, {eligibleIds})),
  };
}

module.exports = {
  backfillDocDetail,
  buildBusinessCarBackfillPayload,
  buildBusinessCarBackfillResult,
  cleanBackfillText,
  eligibleBackfillDocs,
  needsBusinessCarBackfill,
  normalizeBackfillCarIds,
};
