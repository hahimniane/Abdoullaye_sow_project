/**
 * "Send receipt" on a package (docs/PACKAGE_RECEIPT_SEND.md): the pure rules.
 * The receipt always goes to the SENDER, never the receiver. Nothing here
 * imports Firebase or React, so `package-receipt.test.ts` runs without a
 * browser.
 */

export type ReceiptLang = "en" | "fr";
export type ReceiptSendMode = "button" | "auto";
export type ReceiptChannel = "whatsapp" | "sms";

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

function clean(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

/** The business's choice; anything missing or unknown is the button. */
export function receiptSendMode(business: unknown): ReceiptSendMode {
  return clean(asRow(asRow(business).packageReceiptSettings).sendMode, 20) === "auto" ? "auto" : "button";
}

export const RECEIPT_MODE_OPTIONS: ReadonlyArray<{ value: ReceiptSendMode; label: string; hint: string }> = [
  {
    value: "button",
    label: "Staff press Send receipt",
    hint: "The confirmation goes out on its own. The receipt goes only when staff press Send receipt on the package.",
  },
  {
    value: "auto",
    label: "Send it automatically with the confirmation",
    hint: "The receipt goes to the sender with the confirmation, without a click.",
  },
];

/** The refusals the server gives (HttpsError details.reason), in plain words. */
export const RECEIPT_ERROR_MESSAGES: Record<string, string> = {
  receipt_no_sender_phone: "This package has no sender phone number. Add one, or send the receipt by email or show the QR.",
  receipt_sms_not_set_up: "Texting from Laawol is not set up yet. Use Text from this phone instead.",
  receipt_too_soon: "The receipt was just sent this way. Wait a minute before sending it again.",
  receipt_line_gone: "This package was removed, so there is no receipt to send.",
  receipt_whatsapp_off: "WhatsApp is not connected yet. Send the receipt by text or email, or show the QR.",
  receipt_sms_failed: "The text could not be sent. Try again, or use Text from this phone.",
  receipt_channel_invalid: "Could not send the receipt. Try again.",
};
export const RECEIPT_GENERIC_ERROR = "Could not send the receipt. Try again.";
export const RECEIPT_LINK_ERROR = "Could not get the receipt link. Try again.";

/** The sentence for a failed call: the server's reason first, else a generic line. */
export function receiptErrorText(error: unknown, fallback = RECEIPT_GENERIC_ERROR): string {
  const reason = clean(asRow(asRow(error).details).reason, 60);
  return RECEIPT_ERROR_MESSAGES[reason] ?? fallback;
}

/** Digits with a leading + for an sms: / tel: target. */
export function receiptPhoneTarget(phone: unknown): string {
  const raw = clean(phone, 40);
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return "";
  return `${raw.startsWith("+") ? "+" : ""}${digits}`;
}

/** The receipt text in both languages, with the link on its own line. */
export function receiptMessageBody(link: string, senderName = "", businessName = ""): string {
  const hello = clean(senderName, 80);
  const from = clean(businessName, 80);
  return [
    `${hello ? `Hello ${hello}, ` : ""}here is your package receipt${from ? ` from ${from}` : ""}:`,
    `${hello ? `Bonjour ${hello}, ` : ""}voici votre reçu de colis${from ? ` de ${from}` : ""} :`,
    clean(link, 2000),
  ].join("\n");
}

export function receiptEmailSubject(businessName = ""): string {
  const from = clean(businessName, 80);
  return `Package receipt / Reçu de colis${from ? ` - ${from}` : ""}`;
}

/** sms: link. The body is encoded; the `?` form works on iPhone and Android. */
export function receiptSmsHref(phone: unknown, body: string): string {
  const target = receiptPhoneTarget(phone);
  return `sms:${target}?body=${encodeURIComponent(body)}`;
}

/** mailto: link, encoded with %20 (not +) so every mail app reads it. */
export function receiptMailtoHref(email: unknown, subject: string, body: string): string {
  const address = clean(email, 200);
  return `mailto:${encodeURIComponent(address).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function looksLikeEmail(value: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean(value, 200));
}

// ---------------------------------------------------------------------------
// The last receipt send, read from the line's containerUpdates rows.
// ---------------------------------------------------------------------------

export type ReceiptSendState = {
  kind: "none" | "sent" | "waiting" | "failed" | "not_on_whatsapp";
  channel: "whatsapp" | "sms" | "";
  atMs: number;
  /** A whole sentence, in the asked language ("Receipt sent on WhatsApp Nov 23, 2026, 2:10 AM"). */
  text: string;
};

const NOT_ON_WHATSAPP_CODES = [131026];

function millisOf(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const v = value as { toMillis?: () => number; seconds?: number; toDate?: () => Date } | null;
  if (v && typeof v.toMillis === "function") return v.toMillis();
  if (v && typeof v.seconds === "number") return v.seconds * 1000;
  if (v && typeof v.toDate === "function") return v.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  return 0;
}

function rowMillis(row: Row): number {
  return millisOf(row.sentAt) || millisOf(row.sentAtMs) || millisOf(row.atMs) || millisOf(row.updatedAt) || millisOf(row.createdAt);
}

/** US date, 12-hour time in both languages: "Nov 23, 2026, 2:10 AM" (owner rule: month-first). */
export function receiptMoment(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(date);
}

function isReceiptRow(row: Row): boolean {
  return clean(row.update, 40) === "receipt" && clean(row.role, 20) !== "receiver";
}

function failedRow(row: Row): boolean {
  const status = clean(row.status, 40);
  // The webhook writes Meta's verdict as deliveryStatus / deliveryErrorCode.
  const delivery = clean(row.deliveryStatus ?? row.delivery, 40);
  return status === "failed" || delivery === "failed";
}

function notOnWhatsApp(row: Row): boolean {
  const codes = [row.deliveryErrorCode, row.errorCode, row.failureCode, row.code, row.reason].map((v) => Number(clean(v, 20)));
  return codes.some((code) => NOT_ON_WHATSAPP_CODES.includes(code)) || /131026/.test(clean(row.reason, 200) + clean(row.failure, 200) + clean(row.error, 200));
}

/**
 * What to say about the latest receipt send. `rows` are the line's
 * containerUpdates rows; only sender receipt rows count (WhatsApp, or SMS
 * with channel "sms"). The newest one wins.
 */
export function receiptSendState(rows: readonly unknown[], lang: ReceiptLang = "en"): ReceiptSendState {
  const mine = rows.map(asRow).filter(isReceiptRow).sort((a, b) => rowMillis(b) - rowMillis(a));
  const row = mine[0];
  if (!row) return { kind: "none", channel: "", atMs: 0, text: "" };
  const channel: "whatsapp" | "sms" = clean(row.channel, 20) === "sms" ? "sms" : "whatsapp";
  const atMs = rowMillis(row);
  const when = atMs ? receiptMoment(atMs) : "";
  const fr = lang === "fr";
  if (failedRow(row)) {
    if (channel === "whatsapp" && notOnWhatsApp(row)) {
      return {
        kind: "not_on_whatsapp", channel, atMs,
        text: fr
          ? "Ce numéro n’est pas sur WhatsApp. Envoyez le reçu par texto ou par e-mail, ou montrez le QR."
          : "This number is not on WhatsApp. Send the receipt by text or email, or show the QR.",
      };
    }
    return {
      kind: "failed", channel, atMs,
      text: channel === "sms"
        ? (fr ? "Le texto n’a pas pu être envoyé." : "The text could not be sent.")
        : (fr ? "Le reçu n’a pas pu être envoyé sur WhatsApp." : "The receipt could not be sent on WhatsApp."),
    };
  }
  const status = clean(row.status, 40);
  const delivery = clean(row.deliveryStatus ?? row.delivery, 40);
  if (status === "sent" || delivery === "delivered" || delivery === "read") {
    const how = channel === "sms" ? (fr ? "par texto" : "by text") : (fr ? "sur WhatsApp" : "on WhatsApp");
    return {
      kind: "sent", channel, atMs,
      text: `${fr ? "Reçu envoyé" : "Receipt sent"} ${how}${when ? ` ${fr ? "le " : ""}${when}` : ""}`,
    };
  }
  return { kind: "waiting", channel, atMs, text: fr ? "En attente…" : "Waiting…" };
}
