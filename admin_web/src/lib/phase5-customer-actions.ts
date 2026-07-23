export const MAERSK_TRACKING_URL = "https://www.maersk.com/tracking";

export type SupportPriority = "normal" | "urgent" | "blocked";

export type CustomerSupportReference = {
  collection: string;
  id: string;
  label: string;
};

function required(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export function buildOpenSupportCasePayload({
  reference,
  subject,
  message,
  priority = "normal",
}: {
  reference: CustomerSupportReference;
  subject: string;
  message: string;
  priority?: SupportPriority;
}) {
  return {
    relatedCollection: required(reference.collection, "Related collection"),
    relatedId: required(reference.id, "Related record"),
    subject: required(subject, "Subject"),
    message: required(message, "Message"),
    priority,
  };
}

export function buildSupportMessagePayload(
  caseId: string,
  content: string,
  replyTo?: {
    messageId: string;
    senderName: string;
    content: string;
  },
) {
  return {
    caseId: required(caseId, "Case"),
    content: required(content, "Message"),
    messageType: "text" as const,
    ...(replyTo ? { replyTo } : {}),
  };
}

export function buildSupportCaseIdPayload(caseId: string) {
  return { caseId: required(caseId, "Case") };
}

export function buildSupportTypingPayload(caseId: string, typing: boolean) {
  return { ...buildSupportCaseIdPayload(caseId), typing };
}

export function buildWalletCardRefundPayload() {
  return {};
}

export function safeCustomerTrackingUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return MAERSK_TRACKING_URL;
  try {
    const url = new URL(value.trim());
    const maerskHost =
      url.hostname === "maersk.com" || url.hostname.endsWith(".maersk.com");
    return url.protocol === "https:" && maerskHost
      ? url.toString()
      : MAERSK_TRACKING_URL;
  } catch {
    return MAERSK_TRACKING_URL;
  }
}

export function trackingCodeFor(record: Record<string, unknown>) {
  for (const key of [
    "trackingCode",
    "trackingNumber",
    "containerNumber",
    "bookingNumber",
  ]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
