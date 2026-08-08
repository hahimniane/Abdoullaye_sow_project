/**
 * The car-viewing negotiation, for the web consoles.
 *
 * A literal port of `my_flutter_app/functions/car_viewing.js`, which stays the
 * authority: `actOnCarViewing` re-runs `decideViewingAction` inside its own
 * transaction and refuses anything this file gets wrong. This exists so the
 * consoles never offer a button the callable will reject - a viewing has four
 * actions, two actors and six statuses, and "click it and find out" is not a
 * workable way to agree an appointment with a stranger.
 *
 * There is one deliberate divergence. The server lets a business decline from
 * any open state; the consoles only offer decline on a request nobody has
 * answered yet. Offering less than the server allows is safe - offering more is
 * exactly the failure this module exists to prevent.
 *
 * Cancel is the opposite case and is treated as such throughout: it is the most
 * permissive action there is, and it stays on offer for both parties while the
 * viewing is open, including on a listing that is no longer active. Somebody
 * who cannot come must never be stuck leaving the other side waiting.
 *
 * Pure by design: no Firestore, no callables, no React. The components hold
 * those.
 */

import { currentLocale } from "./format.ts";

/** Awaiting the business: the customer proposed and has not been answered. */
export const VIEWING_REQUESTED = "viewing_requested";
/** Awaiting the customer: the business offered alternative slots. */
export const VIEWING_COUNTERED = "viewing_countered";
/** Both parties agreed on a time. */
export const VIEWING_SCHEDULED = "viewing_scheduled";
/** The business said no outright. */
export const VIEWING_DECLINED = "viewing_declined";
/** Nobody answered before the deadline. */
export const VIEWING_EXPIRED = "viewing_expired";
/** Either party pulled out. Shared with the rest of carPurchases. */
export const VIEWING_CANCELLED = "cancelled";

/** Every status the viewing state machine produces. */
export const VIEWING_STATUSES = [
  VIEWING_REQUESTED,
  VIEWING_COUNTERED,
  VIEWING_SCHEDULED,
  VIEWING_DECLINED,
  VIEWING_EXPIRED,
  VIEWING_CANCELLED,
] as const;

/** The appointment has not happened and something can still change. */
export const OPEN_VIEWING_STATUSES = [
  VIEWING_REQUESTED,
  VIEWING_COUNTERED,
  VIEWING_SCHEDULED,
] as const;

/** Somebody owes a reply. */
export const PENDING_VIEWING_STATUSES = [
  VIEWING_REQUESTED,
  VIEWING_COUNTERED,
] as const;

/** A business may offer up to three alternatives in one counter. */
export const MAX_VIEWING_COUNTER_SLOTS = 3;

/** Proposals allowed before counters stop and only accept/decline/cancel are left. */
export const MAX_VIEWING_PROPOSAL_ROUNDS = 3;

/** Nothing may be agreed, moved or cancelled inside this window. */
export const VIEWING_EDIT_FLOOR_MS = 60 * 60 * 1000;

export type ViewingActor = "customer" | "business";

export type ViewingSlot = {
  startAtMs: number;
  label: string;
};

export type ViewingHistoryEntry = {
  actor: string;
  action: string;
  slots: ViewingSlot[];
  atMs: number;
};

/** The parts of a carPurchases document the state machine reasons about. */
export type ViewingRecord = {
  purchaseStatus: string;
  proposedSlots: ViewingSlot[];
  proposedBy: string;
  proposalRound: number;
  respondByAtMs: number | null;
  appointmentStartMs: number | null;
  appointmentLabel: string;
};

/**
 * Milliseconds out of anything Firestore hands back.
 *
 * Timestamps arrive as Timestamp objects live and can be plain numbers or ISO
 * strings after a serialisation hop, so all three have to read the same.
 */
function millisOf(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object") {
    const candidate = value as { toMillis?: unknown; toDate?: unknown; seconds?: unknown };
    if (typeof candidate.toMillis === "function") {
      const millis = candidate.toMillis() as unknown;
      return typeof millis === "number" ? millis : null;
    }
    if (typeof candidate.toDate === "function") {
      const date = candidate.toDate() as unknown;
      return date instanceof Date ? date.getTime() : null;
    }
    if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  }
  return null;
}

/**
 * Whether this purchase record is a viewing at all.
 *
 * Mirrors `purchaseIsViewing` on the server: the paymentType is authoritative,
 * and the second arm catches records written before that field existed - an
 * appointment with no deposit was only ever a viewing.
 */
export function carPurchaseIsViewing(
  row: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  if (!row) return false;
  if (row.paymentType === "viewing_reservation") return true;
  return Boolean(row.appointmentStart) && Number(row.depositAmount ?? 0) === 0;
}

/** Slots out of a stored array, dropping anything without a usable time. */
export function viewingSlotsFrom(value: unknown): ViewingSlot[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const slot = (entry ?? {}) as Record<string, unknown>;
      const startAtMs = millisOf(slot.startAtMs ?? slot.startAt);
      return startAtMs == null
        ? null
        : { startAtMs, label: String(slot.label ?? "").trim() };
    })
    .filter((slot): slot is ViewingSlot => slot !== null)
    .sort((a, b) => a.startAtMs - b.startAtMs);
}

/** The audit trail, oldest first, as `viewingHistoryEntry` wrote it. */
export function viewingHistoryFrom(
  row: Readonly<Record<string, unknown>> | null | undefined,
): ViewingHistoryEntry[] {
  const raw = row?.viewingHistory;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      return {
        actor: String(item.actor ?? ""),
        action: String(item.action ?? ""),
        slots: viewingSlotsFrom(item.slots),
        atMs: millisOf(item.atMs) ?? 0,
      };
    })
    .sort((a, b) => a.atMs - b.atMs);
}

/** The state machine's view of a carPurchases document. */
export function viewingRecordFrom(
  row: Readonly<Record<string, unknown>> | null | undefined,
): ViewingRecord {
  return {
    purchaseStatus: String(row?.purchaseStatus ?? ""),
    proposedSlots: viewingSlotsFrom(row?.proposedSlots),
    proposedBy: String(row?.proposedBy ?? ""),
    proposalRound: Number(row?.proposalRound ?? 0) || 0,
    respondByAtMs: millisOf(row?.respondByAt),
    appointmentStartMs: millisOf(row?.appointmentStart),
    appointmentLabel: String(row?.appointmentLabel ?? "").trim(),
  };
}

/** Who owes a reply in this state, or "" when nobody does. */
export function viewingAwaitingParty(status: string): ViewingActor | "" {
  if (status === VIEWING_REQUESTED) return "business";
  if (status === VIEWING_COUNTERED) return "customer";
  return "";
}

/** Whether the viewing is still live and something can change. */
export function viewingStatusIsOpen(status: string): boolean {
  return (OPEN_VIEWING_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether a proposal has run out of time.
 *
 * Two ways to expire, and the second is the one that bites: the deadline
 * passing, or every slot on the table having gone by while nobody answered.
 * Without the second check a business could "accept" a slot that was yesterday.
 */
export function isViewingProposalExpired(
  record: Readonly<ViewingRecord>,
  nowMs: number,
): boolean {
  if (!(PENDING_VIEWING_STATUSES as readonly string[]).includes(record.purchaseStatus)) {
    return false;
  }
  const deadline = record.respondByAtMs;
  if (deadline != null && nowMs >= deadline) return true;
  if (record.proposedSlots.length === 0) return false;
  return record.proposedSlots.every(
    (slot) => slot.startAtMs - VIEWING_EDIT_FLOOR_MS <= nowMs,
  );
}

/** A slot is far enough out to be offered or agreed. */
export function viewingSlotIsFarEnoughOut(startAtMs: number, nowMs: number): boolean {
  return (
    Number.isFinite(startAtMs) && startAtMs - VIEWING_EDIT_FLOOR_MS > nowMs
  );
}

/** Why the console is offering less than the four actions. */
export type ViewingBlockReason =
  | ""
  /** Declined, expired, cancelled - or not a viewing record at all. */
  | "closed"
  /** Nobody answered in time; the hourly sweep will close it. */
  | "expired"
  /** The listing is no longer active, so only cancel is left. */
  | "carUnavailable"
  /** Inside the hour before the agreed time; nothing may change. */
  | "tooCloseToAppointment";

export type ViewingAvailability = {
  /** The viewing is live: some action exists, even if only cancel. */
  open: boolean;
  canAccept: boolean;
  canPropose: boolean;
  canDecline: boolean;
  canCancel: boolean;
  /** Offered slots this actor may accept right now. */
  acceptableSlots: ViewingSlot[];
  /** Most slots one proposal from this actor may carry. */
  maxSlots: number;
  /** Proposals left before counters stop being accepted. */
  proposalsLeft: number;
  blockedReason: ViewingBlockReason;
};

/**
 * What this actor may do to this viewing, right now.
 *
 * `carStatus` is optional because only the business console has the listing to
 * hand; left out, the accept/counter/decline buttons are offered and the
 * server's own "This car is no longer available to view" is what the user
 * sees. Cancel is never gated on it either way.
 */
export function viewingActionAvailability({
  record,
  actor,
  nowMs,
  carStatus = "",
}: {
  record: Readonly<ViewingRecord>;
  actor: ViewingActor;
  nowMs: number;
  carStatus?: string;
}): ViewingAvailability {
  const closed: ViewingAvailability = {
    open: false,
    canAccept: false,
    canPropose: false,
    canDecline: false,
    canCancel: false,
    acceptableSlots: [],
    maxSlots: 0,
    proposalsLeft: 0,
    blockedReason: "closed",
  };

  const status = record.purchaseStatus;
  if (!viewingStatusIsOpen(status)) return closed;
  // The server checks expiry before it even looks at the action, so an
  // unanswered proposal past its deadline blocks cancel too.
  if (isViewingProposalExpired(record, nowMs)) {
    return { ...closed, blockedReason: "expired" };
  }

  const scheduled = status === VIEWING_SCHEDULED;
  const insideEditFloor =
    scheduled &&
    record.appointmentStartMs != null &&
    record.appointmentStartMs - VIEWING_EDIT_FLOOR_MS <= nowMs;
  if (insideEditFloor) {
    return { ...closed, blockedReason: "tooCloseToAppointment" };
  }

  // Nothing but cancel survives a listing that is no longer for sale.
  const carUnavailable = Boolean(carStatus) && carStatus !== "active";
  if (carUnavailable) {
    return {
      ...closed,
      open: true,
      canCancel: true,
      blockedReason: "carUnavailable",
    };
  }

  const acceptableSlots = record.proposedSlots.filter((slot) =>
    viewingSlotIsFarEnoughOut(slot.startAtMs, nowMs),
  );
  // A reschedule restarts the conversation rather than counting toward the
  // cap - agreeing a new date weeks later is not the haggling the cap stops.
  const proposalsLeft = scheduled
    ? MAX_VIEWING_PROPOSAL_ROUNDS
    : Math.max(0, MAX_VIEWING_PROPOSAL_ROUNDS - record.proposalRound);

  return {
    open: true,
    canAccept: viewingAwaitingParty(status) === actor && acceptableSlots.length > 0,
    canPropose: proposalsLeft > 0,
    // The server would also take a decline on a countered or scheduled
    // viewing; the console keeps it to the one place it reads as an answer.
    canDecline: actor === "business" && status === VIEWING_REQUESTED,
    canCancel: true,
    acceptableSlots,
    maxSlots: actor === "business" ? MAX_VIEWING_COUNTER_SLOTS : 1,
    proposalsLeft,
    blockedReason: "",
  };
}

/** Why a set of proposed slots would be refused. */
export type ViewingSlotError =
  | "noSlots"
  | "tooManySlots"
  | "invalidSlot"
  | "slotTooSoon";

/**
 * Whether these slots may be sent, mirroring `validateProposedSlots`.
 *
 * Returns the first refusal or "", in the server's own order, so the console
 * and the callable disagree about nothing.
 */
export function validateViewingSlots(
  slots: readonly ViewingSlot[],
  nowMs: number,
  maxSlots: number,
): ViewingSlotError | "" {
  if (slots.length === 0) return "noSlots";
  if (slots.length > maxSlots) return "tooManySlots";
  for (const slot of slots) {
    if (!Number.isFinite(slot.startAtMs)) return "invalidSlot";
    if (!viewingSlotIsFarEnoughOut(slot.startAtMs, nowMs)) return "slotTooSoon";
  }
  return "";
}

/**
 * The English sentence for one refused set of slots.
 *
 * The wording is the server's own (`VIEWING_ERROR_MESSAGES`), because a
 * refusal that arrives from the callable is shown verbatim and the two must
 * not read as different rules.
 */
export const VIEWING_SLOT_ERROR_MESSAGES: Readonly<
  Record<ViewingSlotError, string>
> = Object.freeze({
  noSlots: "Choose a viewing time",
  tooManySlots: "Too many times offered at once",
  invalidSlot: "That viewing time is not valid",
  slotTooSoon: "Viewing times must be more than an hour away",
});

/** Why nothing, or only cancel, is on offer. */
export const VIEWING_BLOCK_MESSAGES: Readonly<
  Record<Exclude<ViewingBlockReason, "">, string>
> = Object.freeze({
  closed: "This viewing is closed. Nothing more can be arranged on it.",
  expired: "Nobody answered in time, so this proposal can no longer be used.",
  carUnavailable:
    "This listing is no longer active, so no new time can be agreed. Cancelling is still possible.",
  tooCloseToAppointment:
    "Viewings cannot be changed within an hour of the appointment.",
});

/**
 * The plain-English name of a viewing status.
 *
 * The customer console shows raw `purchaseStatus` values on its order rows,
 * which is survivable for `pending` and unreadable for `viewing_countered`.
 * These are the same words the business console's own status table uses, and a
 * test holds the two together.
 */
export const VIEWING_STATUS_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    [VIEWING_REQUESTED]: "Viewing requested",
    [VIEWING_COUNTERED]: "Other times offered",
    [VIEWING_SCHEDULED]: "Viewing scheduled",
    [VIEWING_DECLINED]: "Viewing declined",
    [VIEWING_EXPIRED]: "Viewing request expired",
    [VIEWING_CANCELLED]: "Cancelled",
  });

/** The status name, or "" when this is not a status the machine produces. */
export function viewingStatusLabel(status: string): string {
  return VIEWING_STATUS_LABELS[status] ?? "";
}

/**
 * One line of the audit trail, as a fixed phrase.
 *
 * Fixed rather than built from the actor and the action, because the consoles
 * are translated by substring replacement over the rendered DOM
 * (`lib/french-dom.ts`) and a sentence assembled at runtime would only ever be
 * half-translated. "Buyer" and "Seller" rather than "you" and "them" so the
 * same table serves both consoles - each side reads the same trail.
 */
export const VIEWING_HISTORY_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    "customer:propose": "Buyer proposed a time",
    "customer:accept": "Buyer accepted a time",
    "customer:cancel": "Buyer cancelled the viewing",
    "business:propose": "Seller offered other times",
    "business:accept": "Seller accepted a time",
    "business:decline": "Seller declined the request",
    "business:cancel": "Seller cancelled the viewing",
  });

/** The phrase for one history entry; unknown pairs get a neutral line. */
export function viewingHistoryLabel(entry: Readonly<ViewingHistoryEntry>): string {
  return (
    VIEWING_HISTORY_LABELS[`${entry.actor}:${entry.action}`] ?? "Viewing updated"
  );
}

/** Who is being waited on, said to this actor. */
export function viewingWaitingLabel(status: string, actor: ViewingActor): string {
  const awaiting = viewingAwaitingParty(status);
  if (!awaiting) return "";
  if (awaiting === actor) return "Your reply is needed";
  return actor === "customer" ? "Waiting on the seller" : "Waiting on the buyer";
}

/**
 * One slot, written out for a reader.
 *
 * Always derived from the timestamp rather than the stored label: the label is
 * whatever the proposing party's browser produced, so rendering it would show
 * a French buyer the seller's English date. The label is still sent, because
 * the server puts it in the notification and in `appointmentLabel`.
 */
export function formatViewingSlot(startAtMs: number): string {
  if (!Number.isFinite(startAtMs)) return "";
  return new Intl.DateTimeFormat(currentLocale(), {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startAtMs));
}

/** A slot from a `datetime-local` value, or null when the box is empty. */
export function viewingSlotFromInput(value: string): ViewingSlot | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const startAtMs = new Date(trimmed).getTime();
  if (!Number.isFinite(startAtMs)) return null;
  // Capped at the 120 characters the server keeps, so what we send is what
  // gets stored.
  return { startAtMs, label: formatViewingSlot(startAtMs).slice(0, 120) };
}

/**
 * The earliest value a `datetime-local` box should accept.
 *
 * Local time, not `toISOString().slice(0, 16)`: that is UTC, so east of
 * Greenwich it lets through times the edit floor refuses and west of it blocks
 * times that are fine.
 */
export function viewingSlotInputMin(nowMs: number): string {
  const earliest = new Date(nowMs + VIEWING_EDIT_FLOOR_MS);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${earliest.getFullYear()}-${pad(earliest.getMonth() + 1)}-${pad(earliest.getDate())}` +
    `T${pad(earliest.getHours())}:${pad(earliest.getMinutes())}`
  );
}

export type ViewingAction = "propose" | "accept" | "decline" | "cancel";

export type ViewingActionPayload = {
  purchaseId: string;
  action: ViewingAction;
  slots: Array<{ startAt: string; label: string }>;
};

/**
 * The exact payload `actOnCarViewing` expects.
 *
 * No role: the callable derives it from the record, and a client-supplied one
 * would be a claim rather than a fact.
 */
export function viewingActionPayload({
  purchaseId,
  action,
  slots = [],
}: {
  purchaseId: string;
  action: ViewingAction;
  slots?: readonly ViewingSlot[];
}): ViewingActionPayload {
  return {
    purchaseId,
    action,
    slots: slots.map((slot) => ({
      startAt: new Date(slot.startAtMs).toISOString(),
      label: slot.label,
    })),
  };
}
