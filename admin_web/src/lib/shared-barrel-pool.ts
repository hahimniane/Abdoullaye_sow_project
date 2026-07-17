export const SHARED_BARREL_SHARE_WEIGHT_CAP_KG = 20;

export type SharedBarrelPoolDraft = {
  origin: "businessHeld" | "dropOff";
  destinationCountryId: string;
  totalShares: string;
  reservedShares: string;
  maxJoiners: string;
  approvalMode: "approval" | "auto";
  shipMode: "sea" | "air";
  joinDeadline: string;
  senderName: string;
  senderAddress: string;
  receiverName: string;
  receiverPhone: string;
  contentsDescription: string;
  attestedWeightKg: string;
  contentsAttested: boolean;
  prohibitedItemsAcknowledged: boolean;
  sharedLiabilityAccepted: boolean;
};

export type SharedBarrelPoolField = keyof SharedBarrelPoolDraft | "businessId";

export type SharedBarrelPoolValidationError = {
  field: SharedBarrelPoolField;
  message: string;
};

type CallableLikeError = {
  code?: unknown;
  message?: unknown;
};

export function sharedBarrelPoolErrorMessage(error: unknown) {
  const candidate = (error || {}) as CallableLikeError;
  const code = String(candidate.code || "").replace(/^functions\//, "");
  const message = String(candidate.message || "").trim();

  if (code === "permission-denied") {
    return "You do not have permission to open shared barrel pools for this business.";
  }
  if (code === "unauthenticated") {
    return "Your session expired. Sign in again and retry.";
  }
  if (
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    code === "internal"
  ) {
    return "Could not open the pool. Check your connection and try again.";
  }
  if (/app.?check/i.test(message)) {
    return "Security check failed. Refresh the page and try again.";
  }
  if (message) {
    return message
      .replace(/^Firebase(?:Error)?:\s*/i, "")
      .replace(/\s*\(functions\/[^)]+\)\.?$/i, "")
      .trim();
  }
  return "Could not open the pool. Check your connection and try again.";
}

export function sharedBarrelDeadlineIso(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T23:59:59.999Z`;
  }
  return trimmed;
}

export function validateSharedBarrelPoolDraft(
  businessId: string,
  draft: SharedBarrelPoolDraft,
  now = Date.now(),
): SharedBarrelPoolValidationError | null {
  if (!businessId) {
    return {field: "businessId", message: "Business ID is required."};
  }
  if (!draft.destinationCountryId) {
    return {field: "destinationCountryId", message: "Choose a destination."};
  }

  const totalShares = Number(draft.totalShares);
  if (!Number.isInteger(totalShares) || totalShares < 2 || totalShares > 4) {
    return {
      field: "totalShares",
      message: "Total shares must be between 2 and 4.",
    };
  }

  const reservedShares = Number(draft.reservedShares);
  if (draft.origin === "businessHeld" && reservedShares !== 0) {
    return {
      field: "reservedShares",
      message: "Business-held pools must start with 0 reserved shares.",
    };
  }
  const minimumReserved = draft.origin === "dropOff" ? 1 : 0;
  if (
    !Number.isInteger(reservedShares) ||
    reservedShares < minimumReserved ||
    reservedShares >= totalShares
  ) {
    return {
      field: "reservedShares",
      message:
        draft.origin === "dropOff"
          ? "Drop-off pools need 1 reserved share and at least 1 open share."
          : "Reserved shares must leave at least 1 share open.",
    };
  }

  const maxJoiners = Number(draft.maxJoiners);
  const openShares = totalShares - reservedShares;
  if (
    !Number.isInteger(maxJoiners) ||
    maxJoiners < 1 ||
    maxJoiners > openShares
  ) {
    return {
      field: "maxJoiners",
      message: "Max joiners must fit the open shares.",
    };
  }

  const deadlineMillis = Date.parse(sharedBarrelDeadlineIso(draft.joinDeadline));
  if (!Number.isFinite(deadlineMillis) || deadlineMillis <= now) {
    return {
      field: "joinDeadline",
      message: "Choose a future join deadline.",
    };
  }

  if (draft.origin !== "dropOff") return null;

  if (!draft.senderName.trim()) {
    return {
      field: "senderName",
      message: "Sender, receiver, and receiver phone are required for drop-off pools.",
    };
  }
  if (!draft.receiverName.trim()) {
    return {
      field: "receiverName",
      message: "Sender, receiver, and receiver phone are required for drop-off pools.",
    };
  }
  if (!draft.receiverPhone.trim()) {
    return {
      field: "receiverPhone",
      message: "Sender, receiver, and receiver phone are required for drop-off pools.",
    };
  }
  if (!draft.contentsDescription.trim()) {
    return {
      field: "contentsDescription",
      message: "Contents note is required for drop-off pools.",
    };
  }

  const weightKg = Number(draft.attestedWeightKg);
  if (
    !Number.isFinite(weightKg) ||
    weightKg <= 0 ||
    weightKg > reservedShares * SHARED_BARREL_SHARE_WEIGHT_CAP_KG
  ) {
    return {
      field: "attestedWeightKg",
      message: "Drop-off weight must fit the reserved shares.",
    };
  }

  if (!draft.contentsAttested) {
    return {
      field: "contentsAttested",
      message:
        "Confirm contents, prohibited items, and shared liability before starting the pool.",
    };
  }
  if (!draft.prohibitedItemsAcknowledged) {
    return {
      field: "prohibitedItemsAcknowledged",
      message:
        "Confirm contents, prohibited items, and shared liability before starting the pool.",
    };
  }
  if (!draft.sharedLiabilityAccepted) {
    return {
      field: "sharedLiabilityAccepted",
      message:
        "Confirm contents, prohibited items, and shared liability before starting the pool.",
    };
  }

  return null;
}
