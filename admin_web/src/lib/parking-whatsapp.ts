/**
 * Parking customers on WhatsApp (docs/PARKING_WHATSAPP.md §3): the pure side
 * of the console - the business switch, the welcome preview and its
 * selection, the server's refusals in words, and how a car's WhatsApp
 * messages read.
 *
 * Pure: no React, no Firebase. `parking-whatsapp.test.ts` runs it under node.
 */

type Row = Record<string, unknown>;
export type Lang = "en" | "fr";

const text = (value: unknown, max = 300) => String(value ?? "").trim().slice(0, max);
const asRow = (value: unknown): Row => (value && typeof value === "object" ? (value as Row) : {});

/** A callable that has not answered by now is given up on (loading always resolves). */
export const PARKING_WHATSAPP_TIMEOUT_MS = 30_000;
/** The welcome send is sequential on the server (up to 300 numbers): it gets longer. */
export const PARKING_WELCOME_SEND_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// The switch: businesses/{id}.parkingWhatsApp
// ---------------------------------------------------------------------------

/** Whether the business sends WhatsApp messages to its parking customers. Off unless it says true. */
export function parkingWhatsAppEnabled(business: unknown): boolean {
  return asRow(asRow(business).parkingWhatsApp).enabled === true;
}

/** Whether the switch was ever turned on (a car's messages are worth listing then, even if it is off now). */
export function parkingWhatsAppEverEnabled(business: unknown): boolean {
  const settings = asRow(asRow(business).parkingWhatsApp);
  return settings.enabled === true || Number(settings.enabledAtMs) > 0;
}

export const PARKING_WHATSAPP_COPY = {
  switchTitle: "Send WhatsApp messages to parking customers",
  switchHint:
    "The owner of a car hears from you on WhatsApp when it is parked and gets a receipt for every payment. " +
    "Nothing is sent while this is off.",
  ownerOnly: "Only the business owner can change this.",
  saved: "Saved.",
  welcomeButton: "Send welcome to current customers",
  welcomeLede:
    "Each phone number gets one WhatsApp message that lists its cars, with a link to follow them. " +
    "Numbers that were already welcomed are not selected.",
  welcomeLoading: "Loading customers…",
  welcomeEmpty: "No customer is parked in the lot right now.",
  alreadyWelcomed: "Already welcomed",
  selectAll: "Select all",
  selectNone: "Select none",
  send: "Send",
  saving: "Saving…",
  done: "Done",
  close: "Close",
  messagesTitle: "WhatsApp messages",
  messagesEmpty: "No WhatsApp message has been sent for this car.",
  messagesLoading: "Loading messages…",
  messagesError: "The messages could not be loaded.",
} as const;

/** The server's refusals (HttpsError `details.reason`), in words. */
export const PARKING_WHATSAPP_REFUSALS: Record<string, string> = {
  parking_whatsapp_off: "Turn on WhatsApp messages for parking customers first.",
  welcome_owner_only: "Only the business owner can send the welcome.",
  parking_whatsapp_owner_only: "Only the business owner can change this.",
  unknown: "That did not work. Try again.",
};

/** The sentence for a callable's error: the refusal it carries, else a generic one. Never the raw message. */
export function parkingWhatsAppRefusalText(error: unknown): string {
  const e = asRow(error);
  const reason = text(asRow(e.details).reason, 80);
  if (reason && PARKING_WHATSAPP_REFUSALS[reason]) return PARKING_WHATSAPP_REFUSALS[reason];
  if (/permission-denied$/.test(text(e.code, 80))) return PARKING_WHATSAPP_REFUSALS.parking_whatsapp_owner_only;
  return PARKING_WHATSAPP_REFUSALS.unknown;
}

/** The request that flips the switch. */
export function setParkingWhatsAppRequest(businessId: string, enabled: boolean) {
  return { businessId, action: "set_parking_whatsapp", enabled: enabled === true };
}

// ---------------------------------------------------------------------------
// The welcome to current customers
// ---------------------------------------------------------------------------

export type WelcomeCar = { id: string; label: string; trackingCode: string };
export type WelcomeRecipient = {
  phone: string;
  name: string;
  cars: WelcomeCar[];
  alreadyWelcomed: boolean;
};

export function welcomePreviewRequest(businessId: string) {
  return { businessId, action: "welcome_preview" };
}

/** `phones` is left out to send to every number the preview listed. */
export function welcomeSendRequest(businessId: string, phones: readonly string[]) {
  return { businessId, action: "welcome_send", phones: [...phones] };
}

/**
 * The preview's recipients, defensively: a number appears once, a row without
 * a phone is dropped, and every field is short text.
 */
export function parseWelcomePreview(value: unknown): WelcomeRecipient[] {
  const list = asRow(value).recipients;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: WelcomeRecipient[] = [];
  for (const item of list.slice(0, 1000)) {
    const row = asRow(item);
    const phone = text(row.phone, 40);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    const cars = (Array.isArray(row.cars) ? row.cars : []).slice(0, 100).map((car) => {
      const c = asRow(car);
      return { id: text(c.id, 80), label: text(c.label, 120), trackingCode: text(c.trackingCode, 40) };
    });
    out.push({ phone, name: text(row.name, 120), cars, alreadyWelcomed: row.alreadyWelcomed === true });
  }
  return out;
}

/** Who is ticked when the list opens: everyone not welcomed yet. */
export function defaultWelcomeSelection(recipients: readonly WelcomeRecipient[]): string[] {
  return recipients.filter((r) => !r.alreadyWelcomed).map((r) => r.phone);
}

export function toggleWelcomePhone(selected: readonly string[], phone: string): string[] {
  return selected.includes(phone) ? selected.filter((p) => p !== phone) : [...selected, phone];
}

/** Select all ticks every number, welcomed or not (the owner may want to send again); none clears. */
export function selectAllWelcome(recipients: readonly WelcomeRecipient[]): string[] {
  return recipients.map((r) => r.phone);
}

export type WelcomeResult = { sent: number; skipped: number; failed: number };

export function parseWelcomeResult(value: unknown): WelcomeResult {
  const row = asRow(value);
  const count = (n: unknown) => {
    const x = Math.trunc(Number(n));
    return Number.isFinite(x) && x > 0 ? x : 0;
  };
  return { sent: count(row.sent), skipped: count(row.skipped), failed: count(row.failed) };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "3 of 5 selected" / "3 sur 5 sélectionnés". Built here because it carries numbers. */
export function welcomeSelectionText(selected: number, total: number, lang: Lang = "en"): string {
  return lang === "fr" ? `${selected} sur ${total} sélectionné${selected > 1 ? "s" : ""}` : `${selected} of ${total} selected`;
}

/** The send button: "Send to 3 customers" / "Envoyer à 3 clients". */
export function welcomeSendText(count: number, lang: Lang = "en"): string {
  return lang === "fr"
    ? `Envoyer à ${count} ${plural(count, "client", "clients")}`
    : `Send to ${count} ${plural(count, "customer", "customers")}`;
}

/** The result summary after sending. */
export function welcomeResultText(result: WelcomeResult, lang: Lang = "en"): string {
  const parts: string[] = [];
  if (lang === "fr") {
    parts.push(`${result.sent} ${plural(result.sent, "message envoyé", "messages envoyés")}`);
    if (result.skipped > 0) parts.push(`${result.skipped} ${plural(result.skipped, "ignoré", "ignorés")}`);
    if (result.failed > 0) parts.push(`${result.failed} ${plural(result.failed, "échec", "échecs")}`);
  } else {
    parts.push(`${result.sent} sent`);
    if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
    if (result.failed > 0) parts.push(`${result.failed} failed`);
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// A car's WhatsApp messages: parkingMessages where parkedCarId ==
// ---------------------------------------------------------------------------

export type ParkingMessageKind = "parked" | "receipt" | "welcome" | "invoice";
export type ParkingMessageState = "queued" | "sent" | "delivered" | "read" | "failed" | "stopped" | "skipped";

export const PARKING_MESSAGE_KIND_LABEL: Record<ParkingMessageKind, string> = {
  parked: "Car parked message",
  receipt: "Payment receipt",
  welcome: "Welcome message",
  invoice: "Monthly invoice",
};

export const PARKING_MESSAGE_STATE_LABEL: Record<ParkingMessageState, string> = {
  queued: "Waiting to be sent",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Not sent",
  stopped: "Paused: the customer asked to stop",
  skipped: "Skipped",
};

/** The tick drawn next to a state: none yet, one, two, two (read is blue), or a cross. */
export const PARKING_MESSAGE_TICK: Record<ParkingMessageState, "clock" | "single" | "double" | "double-read" | "cross" | "pause" | "dash"> = {
  queued: "clock",
  sent: "single",
  delivered: "double",
  read: "double-read",
  failed: "cross",
  stopped: "pause",
  skipped: "dash",
};

export type ParkingMessageLine = {
  id: string;
  kind: ParkingMessageKind;
  kindLabel: string;
  state: ParkingMessageState;
  stateLabel: string;
  tick: (typeof PARKING_MESSAGE_TICK)[ParkingMessageState];
  atMs: number;
  /** Why it failed, only for a failed message. */
  error: string;
  phone: string;
};

const KINDS = new Set<string>(["parked", "receipt", "welcome", "invoice"]);
const STATES = new Set<string>(["queued", "sent", "failed", "stopped", "skipped"]);

function millisOf(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const v = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  const parsed = new Date(value as string).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * One message as the car shows it. A message that was sent moves on to the
 * delivery status Meta reported (delivered, read, or failed); a message that
 * never left keeps the server's own status.
 */
export function parkingMessageLine(row: Row): ParkingMessageLine | null {
  const kind = text(row.kind, 20);
  if (!KINDS.has(kind)) return null;
  const status = STATES.has(text(row.status, 20)) ? text(row.status, 20) : "queued";
  const delivery = text(row.deliveryStatus, 20);
  let state = status as ParkingMessageState;
  if (status === "sent") {
    if (delivery === "delivered" || delivery === "read" || delivery === "failed") state = delivery;
  }
  const atMs = millisOf(row.sentAt) || millisOf(row.createdAt);
  return {
    id: text(row.id, 120),
    kind: kind as ParkingMessageKind,
    kindLabel: PARKING_MESSAGE_KIND_LABEL[kind as ParkingMessageKind],
    state,
    stateLabel: PARKING_MESSAGE_STATE_LABEL[state],
    tick: PARKING_MESSAGE_TICK[state],
    atMs,
    error: state === "failed" ? text(row.error, 300) : "",
    phone: text(row.phone, 40),
  };
}

/** A car's messages, newest first. A row this build does not know is left out. */
export function parkingMessageLines(rows: readonly Row[]): ParkingMessageLine[] {
  return rows
    .map(parkingMessageLine)
    .filter((line): line is ParkingMessageLine => line !== null)
    .sort((a, b) => b.atMs - a.atMs);
}
