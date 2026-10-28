/**
 * Two-way WhatsApp in the consoles - the pure half (docs/WHATSAPP_CONVERSATIONS.md).
 *
 * A WhatsApp conversation is a Support case (`caseType: "whatsapp"`), so the
 * Support panel shows it; everything here decides how it reads: the state
 * filter, the message kinds, the delivery ticks, the media players, the
 * voice-note format, the result of a send, who may see what, and which
 * package phone can be messaged. Every label is a whole English sentence (one
 * french-dom.ts key each). Nothing imports Firebase, so it is unit-tested in
 * node.
 */

import { CONTAINER_STATUS_LABELS } from "./container-manifest.ts";

type Row = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

function asRow(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

// ---------------------------------------------------------------------------
// Conversations.
// ---------------------------------------------------------------------------

export function isWhatsAppCase(row: unknown): boolean {
  return str(asRow(row).caseType) === "whatsapp";
}

/** `whatsappState` on the conversation (whatsapp_inbox.js CONVERSATION_STATE). */
export type WhatsAppState = "needs_reply" | "waiting_customer" | "done" | "choosing";

export const WHATSAPP_STATE_LABELS: Record<WhatsAppState, string> = {
  needs_reply: "Needs reply",
  waiting_customer: "Waiting for customer",
  done: "Done",
  choosing: "Asking which business",
};

export const WHATSAPP_STATE_TONES: Record<WhatsAppState, "warn" | "navy" | "ok" | "muted"> = {
  needs_reply: "warn",
  waiting_customer: "navy",
  done: "ok",
  choosing: "muted",
};

/**
 * The state of a conversation. A missing or unknown `whatsappState` falls
 * back on the Support status the server mirrors, so an old thread still sorts.
 */
export function whatsappStateOf(row: unknown): WhatsAppState {
  const r = asRow(row);
  const state = str(r.whatsappState);
  if (state === "needs_reply" || state === "waiting_customer" || state === "done" || state === "choosing") {
    return state;
  }
  const status = str(r.status);
  if (status === "resolved" || status === "closed") return "done";
  if (status === "waiting_for_customer") return "waiting_customer";
  return "needs_reply";
}

/** The inbox's state filter. "Asking which business" waits on the customer too. */
export type WhatsAppFilter = "needs_reply" | "waiting_customer" | "done" | "all";

export const WHATSAPP_FILTERS: ReadonlyArray<{ id: WhatsAppFilter; label: string }> = [
  { id: "needs_reply", label: "Needs reply" },
  { id: "waiting_customer", label: "Waiting for customer" },
  { id: "done", label: "Done" },
  { id: "all", label: "All conversations" },
];

export function whatsappFilterMatches(row: unknown, filter: WhatsAppFilter): boolean {
  if (filter === "all") return true;
  const state = whatsappStateOf(row);
  if (filter === "waiting_customer") return state === "waiting_customer" || state === "choosing";
  return state === filter;
}

/** How many loaded conversations each filter holds - one pass over the rows. */
export function whatsappFilterCounts(rows: readonly unknown[]): Record<WhatsAppFilter, number> {
  const counts: Record<WhatsAppFilter, number> = { needs_reply: 0, waiting_customer: 0, done: 0, all: 0 };
  for (const row of rows) {
    if (!isWhatsAppCase(row)) continue;
    counts.all += 1;
    const state = whatsappStateOf(row);
    if (state === "choosing") counts.waiting_customer += 1;
    else counts[state] += 1;
  }
  return counts;
}

/**
 * Who answers the conversation, as the admin list shows it: the business, or
 * Laawol - with, in the launch week, the business it would belong to.
 */
export function whatsappInboxLabel(row: unknown): { owner: string; isLaawol: boolean; suggested: string } {
  const r = asRow(row);
  const isLaawol = !str(r.businessId);
  return {
    owner: isLaawol ? "Laawol" : str(r.businessName),
    isLaawol,
    suggested: isLaawol ? str(r.suggestedBusinessName) : "",
  };
}

// ---------------------------------------------------------------------------
// Messages.
// ---------------------------------------------------------------------------

export type WhatsAppMessageKind = "customer" | "staff" | "auto" | "note" | "system";

export function messageMetadata(message: unknown): Row {
  return asRow(asRow(message).metadata);
}

/**
 * What a thread message is: the customer's, a staff reply, an automatic
 * reply, a private note (never sent), or a system line (handed over...).
 */
export function whatsappMessageKind(message: unknown): WhatsAppMessageKind {
  const m = asRow(message);
  const meta = messageMetadata(m);
  if (meta.auto === true) return "auto";
  if (meta.note === true) return str(m.senderRole) === "system" ? "system" : "note";
  const role = str(m.senderRole);
  if (role === "customer") return "customer";
  if (role === "system" || str(m.messageType) === "system") return "system";
  return "staff";
}

export type DeliveryTick = {
  status: "sent" | "delivered" | "read" | "failed" | "waiting" | "none";
  /** "✓", "✓✓" or "" - never translated. */
  ticks: string;
  label: string;
  /** Meta's reason when it failed (as WhatsApp wrote it). */
  error: string;
  /** Held outside the 24 hours, and the customer stopped updates: the waiting template did not go. */
  stopped: boolean;
};

/** The delivery ticks of an outgoing message, from `metadata.whatsapp`. */
export function deliveryTick(message: unknown): DeliveryTick {
  const wa = asRow(messageMetadata(message).whatsapp);
  const status = str(wa.status);
  const stopped = wa.stopped === true;
  switch (status) {
    case "sent":
      return { status: "sent", ticks: "✓", label: "Sent", error: "", stopped };
    case "delivered":
      return { status: "delivered", ticks: "✓✓", label: "Delivered", error: "", stopped };
    case "read":
      return { status: "read", ticks: "✓✓", label: "Read by the customer", error: "", stopped };
    case "failed":
      return { status: "failed", ticks: "", label: "Not delivered", error: str(wa.error), stopped };
    case "waiting_for_reply":
      return {
        status: "waiting",
        ticks: "",
        label: stopped
          ? "Waits for the customer to write. They stopped updates, so we could not ask them to reply."
          : "Waits for the customer to write — we sent them a WhatsApp asking them to reply",
        error: "",
        stopped,
      };
    default:
      return { status: "none", ticks: "", label: "", error: "", stopped };
  }
}

/** What the callable's `delivery` means, said to the person who just sent. */
export function deliveryResultText(delivery: unknown): { text: string; tone: "ok" | "info" | "warn" | "error" } | null {
  switch (str(delivery)) {
    case "sent":
      return { text: "Sent", tone: "ok" };
    case "waiting":
      return { text: "Will be delivered when the customer writes", tone: "info" };
    case "stopped":
      return { text: "The customer stopped updates", tone: "warn" };
    case "failed":
      return { text: "Not delivered", tone: "error" };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Files.
// ---------------------------------------------------------------------------

export type MediaKind = "image" | "audio" | "video" | "file";

export function baseMime(mime: unknown): string {
  return str(mime).split(";")[0].trim().toLowerCase();
}

/** Which player a message's file needs: by its type, then by its mime type. */
export function messageMediaKind(messageType: unknown, mimeType: unknown): MediaKind {
  const type = str(messageType);
  const mime = baseMime(mimeType);
  if (type === "image" || mime.startsWith("image/")) return "image";
  if (type === "voice" || mime.startsWith("audio/")) return "audio";
  if (type === "video" || mime.startsWith("video/")) return "video";
  return "file";
}

export type MessageMedia = {
  kind: MediaKind;
  url: string;
  fileName: string;
  caption: string;
  /** Removed after 12 months (`metadata.mediaDeleted`). */
  deleted: boolean;
  /** The server could not copy the customer's file (`metadata.mediaError`). */
  error: string;
};

const MEDIA_TYPES = new Set(["image", "voice", "video", "file"]);

/** The file of a message, or null for a text message. */
export function messageMedia(message: unknown): MessageMedia | null {
  const m = asRow(message);
  const meta = messageMetadata(m);
  const url = str(meta.fileUrl);
  const deleted = meta.mediaDeleted === true;
  const error = str(meta.mediaError);
  if (!url && !deleted && !error && !MEDIA_TYPES.has(str(m.messageType))) return null;
  if (!url && !deleted && !error) return null;
  return {
    kind: messageMediaKind(m.messageType, meta.mimeType),
    url,
    fileName: str(meta.fileName),
    caption: str(meta.caption),
    deleted,
    error,
  };
}

// ---------------------------------------------------------------------------
// Voice notes recorded in the browser.
// ---------------------------------------------------------------------------

/** WhatsApp plays these as voice notes (whatsapp_conversations.js WA_AUDIO_TYPES). */
export const WHATSAPP_AUDIO_TYPES: readonly string[] = ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/amr"];

/** What MediaRecorder is asked for, best first: ogg/opus, then mp4/aac, then webm. */
export const RECORDER_MIME_PREFERENCE: readonly string[] = [
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
  "audio/webm;codecs=opus",
  "audio/webm",
];

export type RecorderChoice = {
  /** Passed to MediaRecorder; "" lets the browser pick. */
  recorderMime: string;
  /** Plays as a voice note on WhatsApp; otherwise it arrives as a file. */
  playsOnWhatsApp: boolean;
};

export function chooseRecorderMime(isSupported: (mime: string) => boolean): RecorderChoice {
  for (const mime of RECORDER_MIME_PREFERENCE) {
    let ok = false;
    try {
      ok = isSupported(mime);
    } catch {
      ok = false;
    }
    if (ok) return { recorderMime: mime, playsOnWhatsApp: WHATSAPP_AUDIO_TYPES.includes(baseMime(mime)) };
  }
  return { recorderMime: "", playsOnWhatsApp: false };
}

/**
 * The file a recording is uploaded as: its type without codec parameters
 * (the storage rules and WhatsApp both look at the plain type) and a name
 * with the matching extension.
 */
export function recordingFile(blobType: string, fallbackMime: string, atMs: number): { mimeType: string; fileName: string; playsOnWhatsApp: boolean } {
  const mimeType = baseMime(blobType) || baseMime(fallbackMime) || "audio/webm";
  const extension: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/mpeg": "mp3",
    "audio/amr": "amr",
    "audio/webm": "webm",
  };
  return {
    mimeType,
    fileName: `voice-note-${Math.round(atMs)}.${extension[mimeType] ?? "audio"}`,
    playsOnWhatsApp: WHATSAPP_AUDIO_TYPES.includes(mimeType),
  };
}

/** A recording stops by itself here: 10 MB is the upload cap for audio. */
export const MAX_VOICE_NOTE_MS = 5 * 60 * 1000;

/** "0:42" - a duration, never translated. */
export function durationText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Who sees what.
// ---------------------------------------------------------------------------

/**
 * Decision 6: everyone at a business answers WhatsApp. Staff without the
 * Support permission open Support too, but see only the WhatsApp
 * conversations (the only query the rules let them run); with it, they see
 * every case as before.
 */
export function businessSupportAccess(holdsSupport: boolean): { whatsappOnly: boolean; canReplyToCases: boolean } {
  return { whatsappOnly: !holdsSupport, canReplyToCases: holdsSupport };
}

// ---------------------------------------------------------------------------
// Package phones ("Message customer").
// ---------------------------------------------------------------------------

/** "+224621000001" for a number WhatsApp can reach, else "" (a local number has no country). */
export function whatsappPhone(value: unknown): string {
  const compact = str(value).replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : "";
}

export type MessageContact = { role: "sender" | "receiver"; name: string; phone: string };

/**
 * The people of a package who can be messaged, sender first. Each source
 * names its own fields: a loading-list line (customerName/customerPhone,
 * receiverName/receiverPhone, ownerKind) or a package request
 * (sender.{name,phoneE164}, receiver.{name,phoneE164}).
 */
export function packageMessageContacts(row: unknown): MessageContact[] {
  const r = asRow(row);
  const out: MessageContact[] = [];
  const push = (role: MessageContact["role"], name: unknown, phone: unknown) => {
    const e164 = whatsappPhone(phone);
    if (!e164 || out.some((c) => c.phone === e164)) return;
    out.push({ role, name: str(name), phone: e164 });
  };
  const sender = asRow(r.sender);
  const receiver = asRow(r.receiver);
  if (Object.keys(sender).length > 0 || Object.keys(receiver).length > 0) {
    push("sender", sender.name, sender.phoneE164 ?? sender.phone);
    push("receiver", receiver.name, receiver.phoneE164 ?? receiver.phone);
    return out;
  }
  if (str(r.ownerKind) !== "stock") push("sender", r.customerName, r.customerPhoneE164 || r.customerPhone);
  push("receiver", r.receiverName, r.receiverPhoneE164 || r.receiverPhone);
  return out;
}

// ---------------------------------------------------------------------------
// Settings.
// ---------------------------------------------------------------------------

/**
 * Whether "WhatsApp messages" is on (functions notifyWhatsAppConversation):
 * owners and Laawol admins unless they switched it off, staff only once they
 * switched it on.
 */
export function whatsappMessagesOn(role: unknown, saved: Record<string, unknown> | undefined | null): boolean {
  const value = saved ? saved.whatsappMessages : undefined;
  return str(role) === "staff" ? value === true : value !== false;
}

export function whatsappMessagesHint(role: unknown): string {
  return str(role) === "staff"
    ? "A notification when a customer writes on WhatsApp. Off until you turn it on."
    : "A notification when a customer writes on WhatsApp. On unless you turn it off.";
}

/** The name customers see before " (Business)": the chosen one, else the first name. */
export function chatDisplayName(profile: unknown): string {
  const p = asRow(profile);
  const chosen = str(p.chatDisplayName);
  if (chosen) return chosen.slice(0, 40);
  return str(p.fullName).split(/\s+/)[0] ?? "";
}

export const CHAT_DISPLAY_NAME_MAX = 40;

// ---------------------------------------------------------------------------
// Laawol's inbox mode.
// ---------------------------------------------------------------------------

export type InboxMode = "laawol_only" | "businesses";

export const INBOX_MODES: ReadonlyArray<{ id: InboxMode; label: string; explanation: string; confirm: string; confirmFr: string }> = [
  {
    id: "laawol_only",
    label: "Laawol only",
    explanation: "Every conversation comes to Laawol. Each one records the business it belongs to, and businesses do not see it.",
    confirm: "Switch to Laawol only? New customer messages will come to Laawol instead of the businesses.",
    confirmFr: "Passer en Laawol uniquement ? Les nouveaux messages des clients arriveront chez Laawol au lieu des entreprises.",
  },
  {
    id: "businesses",
    label: "Businesses",
    explanation: "Each conversation goes to the business whose package it is. Laawol still sees every conversation, and numbers no business knows come to Laawol.",
    confirm: "Switch to Businesses? New customer messages will go to the business whose package it is.",
    confirmFr: "Passer en mode Entreprises ? Les nouveaux messages des clients iront à l’entreprise à qui appartient le colis.",
  },
];

export function inboxModeOf(value: unknown): InboxMode | "" {
  const mode = str(asRow(value).mode ?? value);
  return mode === "laawol_only" || mode === "businesses" ? mode : "";
}

// ---------------------------------------------------------------------------
// The customer's packages (`whatsappConversation {action: "packages"}`).
// ---------------------------------------------------------------------------

export type ConversationPackage = {
  id: string;
  trackingCode: string;
  description: string;
  kind: string;
  containerStatus: string;
  destination: string;
  role: "sender" | "receiver";
};

export function conversationPackages(data: unknown): ConversationPackage[] {
  const list = asRow(data).packages;
  if (!Array.isArray(list)) return [];
  return list.map(asRow).filter((p) => str(p.id)).map((p) => ({
    id: str(p.id),
    trackingCode: str(p.trackingCode),
    description: str(p.description),
    kind: str(p.kind),
    containerStatus: str(p.containerStatus),
    destination: str(p.destination),
    role: str(p.role) === "receiver" ? "receiver" : "sender",
  }));
}

/**
 * A container's status as the packages header says it - the loading lists'
 * own words (CONTAINER_STATUS_LABELS): "arrived" is "Ready for pickup".
 */
export function packageContainerStatusText(status: string): string {
  if (status === "loading" || status === "shipped" || status === "arrived") {
    return CONTAINER_STATUS_LABELS[status];
  }
  return status ? status.replace(/_/g, " ") : "Waiting list";
}

// ---------------------------------------------------------------------------
// Where a conversation can be handed (`whatsappConversation {action: "handoffOptions"}`).
// ---------------------------------------------------------------------------

export type HandoffTarget = { id: string; name: string };

/**
 * The server's list, in its order (Laawol first), each inbox once. Staff get
 * Laawol and the other businesses that know the customer; admins every
 * business; the conversation's own inbox is never in it.
 */
export function handoffOptionsFrom(data: unknown): HandoffTarget[] {
  const list = asRow(data).options;
  if (!Array.isArray(list)) return [];
  const out: HandoffTarget[] = [];
  for (const item of list.map(asRow)) {
    const id = str(item.businessId);
    if (!id || out.some((o) => o.id === id)) continue;
    out.push({ id, name: str(item.businessName) || id });
  }
  return out;
}
