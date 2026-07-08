import type { FirestoreRow } from "@/types/admin";

export type VerificationStatus =
  | "missing"
  | "submitted"
  | "verified"
  | "needs_changes"
  | "not_applicable";

export type VerificationDocumentRequirement = {
  id: string;
  label: string;
  description: string;
  services: string[];
  aliases?: string[];
};

export type VerificationEvidence = {
  present: boolean;
  label: string;
  url: string;
};

export type BusinessVerificationItem = VerificationDocumentRequirement & {
  evidence: VerificationEvidence;
  status: VerificationStatus;
  reviewNote: string;
};

export type BusinessVerificationSummary = {
  total: number;
  missing: number;
  submitted: number;
  verified: number;
  needsChanges: number;
  notApplicable: number;
  approvalReady: boolean;
};

export type StripeVerificationState =
  | "not_started"
  | "action_required"
  | "pending"
  | "ready";

export type BusinessStripeVerification = {
  state: StripeVerificationState;
  ready: boolean;
  stripeAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  currentlyDue: string[];
  pastDue: string[];
  pendingVerification: string[];
  disabledReason: string;
  primaryLabel: string;
  helperText: string;
};

export const VERIFICATION_STATUSES: VerificationStatus[] = [
  "missing",
  "submitted",
  "verified",
  "needs_changes",
  "not_applicable",
];

export const BUSINESS_VERIFICATION_DOCUMENTS: VerificationDocumentRequirement[] = [
  {
    id: "shippingAuthority",
    label: "Freight or shipping authority",
    description:
      "Freight-forwarder license, warehouse agreement, customs broker agreement, or receiving-partner proof.",
    services: ["barrelShipping", "sharedBarrels", "freight"],
    aliases: ["freightLicense", "shippingLicense", "warehouseAgreement"],
  },
  {
    id: "dealerLicense",
    label: "Dealer license or sales authorization",
    description:
      "Dealer license, reseller authorization, auction access proof, or local vehicle sales permit.",
    services: ["carSales"],
    aliases: ["autoDealerLicense", "salesLicense"],
  },
  {
    id: "parkingFacilityProof",
    label: "Parking facility proof",
    description:
      "Lot lease, property ownership, facility insurance, or written parking authorization.",
    services: ["carParking"],
    aliases: ["parkingLease", "facilityProof"],
  },
  {
    id: "transportInsurance",
    label: "Transport insurance and authority",
    description:
      "Commercial auto policy, transporter authority, USDOT/MC registration, or carrier agreement.",
    services: ["carTransport"],
    aliases: ["carrierAuthority", "transportAuthority", "commercialAutoInsurance"],
  },
];

const SERVICE_LABELS: Record<string, string> = {
  barrelShipping: "Barrel shipping",
  sharedBarrels: "Shared barrels",
  freight: "Freight (parcels)",
  carSales: "Car sales",
  carParking: "Car parking",
  carTransport: "Car transport",
};

export function businessServiceLabel(serviceId: string): string {
  return SERVICE_LABELS[serviceId] ?? serviceId;
}

export function businessServicesFromRow(row: FirestoreRow): string[] {
  return Array.isArray(row.enabledServices)
    ? row.enabledServices.map((item) => String(item)).filter(Boolean)
    : [];
}

export function requiredBusinessVerificationDocuments(
  services: readonly string[],
): VerificationDocumentRequirement[] {
  const serviceSet = new Set(services);
  return BUSINESS_VERIFICATION_DOCUMENTS.filter(
    (document) =>
      document.services.length === 0 ||
      document.services.some((service) => serviceSet.has(service)),
  );
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function evidenceFromValue(value: unknown): VerificationEvidence | null {
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    return {
      present: true,
      label: trimmed.split("/").pop() || "Document",
      url: trimmed.startsWith("http") ? trimmed : "",
    };
  }
  const object = objectValue(value);
  if (!object) return null;
  const url = String(
    object.url ??
      object.fileUrl ??
      object.downloadUrl ??
      object.publicUrl ??
      "",
  ).trim();
  const path = String(object.path ?? object.storagePath ?? "").trim();
  const name = String(
    object.fileName ??
      object.name ??
      object.title ??
      path.split("/").pop() ??
      "",
  ).trim();
  if (!url && !path && !name) return null;
  return {
    present: true,
    label: name || path.split("/").pop() || "Document",
    url,
  };
}

function candidateKeys(requirement: VerificationDocumentRequirement) {
  return [requirement.id, ...(requirement.aliases ?? [])];
}

function documentEvidence(
  row: FirestoreRow,
  requirement: VerificationDocumentRequirement,
): VerificationEvidence {
  const keys = candidateKeys(requirement);
  const map = objectValue(row.verificationDocuments);
  if (map) {
    for (const key of keys) {
      const evidence = evidenceFromValue(map[key]);
      if (evidence) return evidence;
    }
  }

  if (Array.isArray(row.verificationDocuments)) {
    for (const candidate of row.verificationDocuments) {
      const object = objectValue(candidate);
      if (!object) continue;
      const type = String(
        object.id ??
          object.type ??
          object.documentId ??
          object.documentType ??
          object.requirementId ??
          "",
      );
      if (keys.includes(type)) {
        const evidence = evidenceFromValue(object);
        if (evidence) return evidence;
      }
    }
  }

  for (const key of keys) {
    const direct = evidenceFromValue(row[key]);
    if (direct) return direct;
    const url = evidenceFromValue(row[`${key}Url`]);
    if (url) return url;
    const file = evidenceFromValue(row[`${key}FileUrl`]);
    if (file) return file;
    const path = evidenceFromValue(row[`${key}Path`]);
    if (path) return path;
  }

  return { present: false, label: "", url: "" };
}

function normalizeStatus(value: unknown): VerificationStatus | null {
  const status = String(value ?? "").trim();
  return VERIFICATION_STATUSES.includes(status as VerificationStatus)
    ? (status as VerificationStatus)
    : null;
}

function reviewDataFor(
  row: FirestoreRow,
  requirement: VerificationDocumentRequirement,
): { status: VerificationStatus | null; note: string } {
  const review = objectValue(row.verificationReview);
  const documents = objectValue(review?.documents);
  const entry = objectValue(documents?.[requirement.id]);
  return {
    status: normalizeStatus(entry?.status),
    note: String(entry?.note ?? "").trim(),
  };
}

function documentProvidedStatus(
  row: FirestoreRow,
  requirement: VerificationDocumentRequirement,
): VerificationStatus | null {
  const keys = candidateKeys(requirement);
  const map = objectValue(row.verificationDocuments);
  if (map) {
    for (const key of keys) {
      const object = objectValue(map[key]);
      const status = normalizeStatus(object?.status ?? object?.reviewStatus);
      if (status) return status;
    }
  }
  if (Array.isArray(row.verificationDocuments)) {
    for (const candidate of row.verificationDocuments) {
      const object = objectValue(candidate);
      if (!object) continue;
      const type = String(
        object.id ??
          object.type ??
          object.documentId ??
          object.documentType ??
          object.requirementId ??
          "",
      );
      if (!keys.includes(type)) continue;
      const status = normalizeStatus(object.status ?? object.reviewStatus);
      if (status) return status;
    }
  }
  return null;
}

export function summarizeVerificationItems(
  items: readonly Pick<BusinessVerificationItem, "status">[],
): BusinessVerificationSummary {
  const summary: BusinessVerificationSummary = {
    total: items.length,
    missing: 0,
    submitted: 0,
    verified: 0,
    needsChanges: 0,
    notApplicable: 0,
    approvalReady: true,
  };
  for (const item of items) {
    if (item.status === "missing") summary.missing += 1;
    if (item.status === "submitted") summary.submitted += 1;
    if (item.status === "verified") summary.verified += 1;
    if (item.status === "needs_changes") summary.needsChanges += 1;
    if (item.status === "not_applicable") summary.notApplicable += 1;
  }
  summary.approvalReady =
    items.every(
      (item) => item.status === "verified" || item.status === "not_applicable",
    );
  return summary;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter(Boolean);
}

export function resolveBusinessStripeVerification(
  row: Record<string, unknown>,
): BusinessStripeVerification {
  const stripeAccountId = stringValue(row.stripeAccountId);
  const chargesEnabled = row.chargesEnabled === true;
  const payoutsEnabled = chargesEnabled && row.payoutsEnabled === true;
  const requirements = objectValue(row.stripeRequirements);
  const currentlyDue = stringList(requirements?.currentlyDue);
  const pastDue = stringList(requirements?.pastDue);
  const pendingVerification = stringList(requirements?.pendingVerification);
  const disabledReason = stringValue(requirements?.disabledReason);

  if (!stripeAccountId) {
    return {
      state: "not_started",
      ready: false,
      stripeAccountId,
      chargesEnabled,
      payoutsEnabled,
      currentlyDue,
      pastDue,
      pendingVerification,
      disabledReason,
      primaryLabel: "Stripe setup required",
      helperText:
        "Stripe collects owner identity, business legal/tax information, and bank details so Laawol does not ask for those documents here.",
    };
  }

  if (payoutsEnabled) {
    return {
      state: "ready",
      ready: true,
      stripeAccountId,
      chargesEnabled,
      payoutsEnabled,
      currentlyDue,
      pastDue,
      pendingVerification,
      disabledReason,
      primaryLabel: "Stripe verification complete",
      helperText:
        "Stripe has enabled this business for payouts. Laawol only needs to review service-specific documents.",
    };
  }

  if (currentlyDue.length > 0 || pastDue.length > 0 || disabledReason) {
    return {
      state: "action_required",
      ready: false,
      stripeAccountId,
      chargesEnabled,
      payoutsEnabled,
      currentlyDue,
      pastDue,
      pendingVerification,
      disabledReason,
      primaryLabel: "Stripe action required",
      helperText:
        "Send the business back to Stripe for identity, tax, legal, or bank updates instead of collecting those files in Laawol.",
    };
  }

  return {
    state: "pending",
    ready: false,
    stripeAccountId,
    chargesEnabled,
    payoutsEnabled,
    currentlyDue,
    pastDue,
    pendingVerification,
    disabledReason,
    primaryLabel: "Stripe review pending",
    helperText:
      "Stripe is still reviewing this business. Refresh the Stripe status before approving the business.",
  };
}

export function buildBusinessVerificationChecklist(row: FirestoreRow): {
  items: BusinessVerificationItem[];
  summary: BusinessVerificationSummary;
} {
  const services = businessServicesFromRow(row);
  const items = requiredBusinessVerificationDocuments(services).map((requirement) => {
    const evidence = documentEvidence(row, requirement);
    const review = reviewDataFor(row, requirement);
    return {
      ...requirement,
      evidence,
      status:
        review.status ??
        documentProvidedStatus(row, requirement) ??
        (evidence.present ? "submitted" : "missing"),
      reviewNote: review.note,
    };
  });
  return {
    items,
    summary: summarizeVerificationItems(items),
  };
}

export function businessVerificationActionCount(row: FirestoreRow): number {
  if (row._inferred === true) return 0;
  const status = String(row.status ?? "pending");
  if (status !== "pending" && status !== "changes_requested") return 0;
  const checklist = buildBusinessVerificationChecklist(row);
  const stripeAction = resolveBusinessStripeVerification(row).ready ? 0 : 1;
  return (
    stripeAction +
    checklist.summary.missing +
    checklist.summary.submitted +
    checklist.summary.needsChanges
  );
}
