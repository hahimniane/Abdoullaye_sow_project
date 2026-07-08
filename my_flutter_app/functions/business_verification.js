const VALID_VERIFICATION_STATUSES = [
  "missing",
  "submitted",
  "verified",
  "needs_changes",
  "not_applicable",
];

const VALID_BUSINESS_VERIFICATION_DOCUMENT_IDS = [
  "shippingAuthority",
  "dealerLicense",
  "parkingFacilityProof",
  "transportInsurance",
];
const BUSINESS_VERIFICATION_DOCUMENT_REQUIREMENTS = [
  {
    id: "shippingAuthority",
    label: "Freight or shipping authority",
    services: ["barrelShipping", "sharedBarrels", "freight"],
    aliases: ["freightLicense", "shippingLicense", "warehouseAgreement"],
  },
  {
    id: "dealerLicense",
    label: "Dealer license or sales authorization",
    services: ["carSales"],
    aliases: ["autoDealerLicense", "salesLicense"],
  },
  {
    id: "parkingFacilityProof",
    label: "Parking facility proof",
    services: ["carParking"],
    aliases: ["parkingLease", "facilityProof"],
  },
  {
    id: "transportInsurance",
    label: "Transport insurance and authority",
    services: ["carTransport"],
    aliases: [
      "carrierAuthority",
      "transportAuthority",
      "commercialAutoInsurance",
    ],
  },
];
const MAX_BUSINESS_VERIFICATION_DOCUMENT_BYTES = 20 * 1024 * 1024;
const VALID_BUSINESS_VERIFICATION_CONTENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/octet-stream",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

function cleanVerificationDocumentUpdates(rawDocuments, options = {}) {
  if (!Array.isArray(rawDocuments)) {
    throw new Error("Verification documents must be a list");
  }
  if (!options.allowEmpty && rawDocuments.length === 0) {
    throw new Error("At least one verification document is required");
  }
  return rawDocuments.map((document) => {
    const id = String(document?.id || document?.documentId || "").trim();
    if (
      !/^[A-Za-z][A-Za-z0-9_-]{1,80}$/.test(id) ||
      !VALID_BUSINESS_VERIFICATION_DOCUMENT_IDS.includes(id)
    ) {
      throw new Error("Invalid verification document ID");
    }
    const status = String(document?.status || "").trim();
    if (!VALID_VERIFICATION_STATUSES.includes(status)) {
      throw new Error("Invalid verification document status");
    }
    return {
      id,
      status,
      note: String(document?.note || "").trim(),
    };
  });
}

function cleanString(value) {
  return String(value || "").trim();
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item)).filter(Boolean);
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ?
    value :
    null;
}

function verificationStatus(value) {
  const status = cleanString(value);
  return VALID_VERIFICATION_STATUSES.includes(status) ? status : "";
}

function evidencePresent(value) {
  if (typeof value === "string") return cleanString(value) !== "";
  const object = objectValue(value);
  if (!object) return false;
  return Boolean(
      cleanString(object.url) ||
      cleanString(object.fileUrl) ||
      cleanString(object.downloadUrl) ||
      cleanString(object.publicUrl) ||
      cleanString(object.path) ||
      cleanString(object.storagePath) ||
      cleanString(object.fileName) ||
      cleanString(object.name),
  );
}

function requirementKeys(requirement) {
  return [requirement.id, ...(requirement.aliases || [])];
}

function reviewStatusForRequirement(business, requirement) {
  const review = objectValue(business?.verificationReview);
  const documents = objectValue(review?.documents);
  if (!documents) return "";
  for (const key of requirementKeys(requirement)) {
    const entry = objectValue(documents[key]);
    const status = verificationStatus(entry?.status);
    if (status) return status;
  }
  return "";
}

function documentStatusForRequirement(business, requirement) {
  const keys = requirementKeys(requirement);
  const map = objectValue(business?.verificationDocuments);
  if (map) {
    for (const key of keys) {
      const entry = map[key];
      const object = objectValue(entry);
      const status = verificationStatus(object?.status ?? object?.reviewStatus);
      if (status) return status;
      if (evidencePresent(entry)) return "submitted";
    }
  }

  if (Array.isArray(business?.verificationDocuments)) {
    for (const candidate of business.verificationDocuments) {
      const object = objectValue(candidate);
      if (!object) continue;
      const type = cleanString(
          object.id ||
          object.type ||
          object.documentId ||
          object.documentType ||
          object.requirementId,
      );
      if (!keys.includes(type)) continue;
      const status = verificationStatus(object.status ?? object.reviewStatus);
      if (status) return status;
      if (evidencePresent(object)) return "submitted";
    }
  }

  for (const key of keys) {
    if (evidencePresent(business?.[key]) ||
        evidencePresent(business?.[`${key}Url`]) ||
        evidencePresent(business?.[`${key}FileUrl`]) ||
        evidencePresent(business?.[`${key}Path`])) {
      return "submitted";
    }
  }
  return "missing";
}

function statusForRequirement(business, requirement) {
  return reviewStatusForRequirement(business, requirement) ||
    documentStatusForRequirement(business, requirement);
}

function requiredBusinessVerificationDocuments(services) {
  const serviceSet = new Set(stringList(services));
  return BUSINESS_VERIFICATION_DOCUMENT_REQUIREMENTS.filter((requirement) =>
    requirement.services.some((service) => serviceSet.has(service)),
  );
}

function businessVerificationApprovalReadiness(business) {
  const services = stringList(business?.enabledServices);
  const requiredDocuments = requiredBusinessVerificationDocuments(services);
  const documentBlockers = requiredDocuments
      .map((requirement) => ({
        id: requirement.id,
        label: requirement.label,
        status: statusForRequirement(business, requirement),
      }))
      .filter((document) =>
        document.status !== "verified" &&
        document.status !== "not_applicable",
      );
  const stripeReady =
    cleanString(business?.stripeAccountId) !== "" &&
    business?.chargesEnabled === true &&
    business?.payoutsEnabled === true;
  const blockers = [
    ...(stripeReady ? [] : ["Stripe verification"]),
    ...documentBlockers.map((document) => document.label),
  ];
  return {
    ready: stripeReady && documentBlockers.length === 0,
    stripeReady,
    requiredDocumentIds: requiredDocuments.map((document) => document.id),
    documentBlockers,
    blockers,
  };
}

function buildBusinessVerificationReviewUpdate({
  documents,
  note,
  adminUid,
  timestamp,
}) {
  const cleanDocuments = cleanVerificationDocumentUpdates(
      documents,
      {allowEmpty: true},
  );
  const update = {
    "verificationReview.note": String(note || "").trim(),
    "verificationReview.updatedAt": timestamp,
    "verificationReview.updatedBy": adminUid,
    updatedAt: timestamp,
    updatedBy: adminUid,
  };
  for (const document of cleanDocuments) {
    update[`verificationReview.documents.${document.id}`] = {
      status: document.status,
      note: document.note,
      updatedAt: timestamp,
      updatedBy: adminUid,
    };
  }
  return update;
}

function buildBusinessVerificationDocumentSubmissionUpdate({
  businessId,
  documentId,
  fileName,
  path,
  url,
  contentType,
  size,
  uid,
  timestamp,
}) {
  const cleanId = cleanVerificationDocumentUpdates([
    {id: documentId, status: "submitted"},
  ])[0].id;
  const cleanBusinessId = String(businessId || "").trim();
  const cleanPath = String(path || "").trim();
  const expectedPrefix = `businessDocuments/${cleanBusinessId}/${cleanId}/`;
  if (!cleanBusinessId || !cleanPath.startsWith(expectedPrefix)) {
    throw new Error("Document storage path does not match the business");
  }
  const cleanUrl = String(url || "").trim();
  if (!/^https?:\/\//.test(cleanUrl)) {
    throw new Error("Document download URL is required");
  }
  const cleanSize = Number(size || 0);
  if (!Number.isFinite(cleanSize) || cleanSize <= 0) {
    throw new Error("Document file size is required");
  }
  const payload = {
    id: cleanId,
    fileName: String(fileName || "Document").trim() || "Document",
    path: cleanPath,
    url: cleanUrl,
    contentType: String(contentType || "application/octet-stream").trim(),
    size: cleanSize,
    status: "submitted",
    uploadedAt: timestamp,
    uploadedBy: uid,
    updatedAt: timestamp,
  };
  return {
    [`verificationDocuments.${cleanId}`]: payload,
    [`verificationReview.documents.${cleanId}`]: {
      status: "submitted",
      note: "",
      updatedAt: timestamp,
      updatedBy: uid,
    },
    "verificationReview.updatedAt": timestamp,
    "verificationReview.updatedBy": uid,
    updatedAt: timestamp,
    updatedBy: uid,
  };
}

function cleanBusinessVerificationDocumentId(documentId) {
  return cleanVerificationDocumentUpdates([
    {id: documentId, status: "submitted"},
  ])[0].id;
}

function cleanBusinessVerificationBusinessId(businessId) {
  const cleanBusinessId = String(businessId || "").trim();
  if (!/^[A-Za-z0-9_-]{2,120}$/.test(cleanBusinessId)) {
    throw new Error("Business ID is required");
  }
  return cleanBusinessId;
}

function cleanBusinessVerificationContentType(contentType) {
  const cleanContentType =
    String(contentType || "application/octet-stream").trim().toLowerCase();
  const valid =
    cleanContentType.startsWith("image/") ||
    VALID_BUSINESS_VERIFICATION_CONTENT_TYPES.includes(cleanContentType);
  if (!valid) {
    throw new Error("Documents must be PDF, Word, or image files.");
  }
  return cleanContentType;
}

function cleanBusinessVerificationFileName(fileName) {
  const cleanFileName = String(fileName || "Document").trim();
  return cleanFileName || "Document";
}

function safeBusinessVerificationStorageFileName(fileName) {
  const cleanFileName = cleanBusinessVerificationFileName(fileName)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return cleanFileName || "document";
}

function decodeBusinessVerificationBase64(base64, size) {
  const cleanBase64 = String(base64 || "").trim();
  if (!cleanBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)) {
    throw new Error("Document upload payload is required");
  }
  const buffer = Buffer.from(cleanBase64, "base64");
  const cleanSize = Number(size || 0);
  if (
    !Number.isInteger(cleanSize) ||
    cleanSize <= 0 ||
    cleanSize > MAX_BUSINESS_VERIFICATION_DOCUMENT_BYTES
  ) {
    throw new Error("Documents must be under 20 MB.");
  }
  if (buffer.length !== cleanSize) {
    throw new Error("Document file size does not match upload payload");
  }
  return buffer;
}

function buildBusinessVerificationStoragePath({
  businessId,
  documentId,
  fileName,
  nowMs,
}) {
  const cleanBusinessId = cleanBusinessVerificationBusinessId(businessId);
  const cleanId = cleanBusinessVerificationDocumentId(documentId);
  const stamp = Number.isInteger(nowMs) && nowMs > 0 ? nowMs : Date.now();
  return [
    "businessDocuments",
    cleanBusinessId,
    cleanId,
    `${stamp}-${safeBusinessVerificationStorageFileName(fileName)}`,
  ].join("/");
}

function cleanBusinessVerificationUploadPayload({
  businessId,
  documentId,
  fileName,
  contentType,
  size,
  base64,
  nowMs,
}) {
  const cleanBusinessId = cleanBusinessVerificationBusinessId(businessId);
  const cleanId = cleanBusinessVerificationDocumentId(documentId);
  const cleanFileName = cleanBusinessVerificationFileName(fileName);
  const cleanContentType = cleanBusinessVerificationContentType(contentType);
  const buffer = decodeBusinessVerificationBase64(base64, size);
  return {
    businessId: cleanBusinessId,
    documentId: cleanId,
    fileName: cleanFileName,
    contentType: cleanContentType,
    size: buffer.length,
    buffer,
    path: buildBusinessVerificationStoragePath({
      businessId: cleanBusinessId,
      documentId: cleanId,
      fileName: cleanFileName,
      nowMs,
    }),
  };
}

module.exports = {
  BUSINESS_VERIFICATION_DOCUMENT_REQUIREMENTS,
  MAX_BUSINESS_VERIFICATION_DOCUMENT_BYTES,
  VALID_BUSINESS_VERIFICATION_DOCUMENT_IDS,
  VALID_BUSINESS_VERIFICATION_CONTENT_TYPES,
  VALID_VERIFICATION_STATUSES,
  buildBusinessVerificationDocumentSubmissionUpdate,
  buildBusinessVerificationStoragePath,
  buildBusinessVerificationReviewUpdate,
  businessVerificationApprovalReadiness,
  cleanBusinessVerificationUploadPayload,
  cleanVerificationDocumentUpdates,
  requiredBusinessVerificationDocuments,
};
