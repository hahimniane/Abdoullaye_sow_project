// Several parking lots for one business (docs/PARKING_LOTS.md). A lot is
// only where a car stands: prices and bills are the business's. The rules
// are the server's (my_flutter_app/functions/parking_lots.js); this is what
// the console needs to read them and to ask for a change.

type Row = Record<string, unknown>;

export type ParkingLot = {
  id: string;
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  zipCode: string;
  totalSpaces: number;
  blockedSpaces: number;
  /** Cars can be parked in it. A closed lot keeps its history. */
  open: boolean;
  /** The business's first lot: where a car with no lot is read as standing. */
  isMain: boolean;
  sortOrder: number;
};

/** One lot's figures from getParkingTotals (`parking.lots`). */
export type ServerParkingLot = {
  lotId: string;
  name: string;
  open: boolean;
  isMain: boolean;
  totals: { inLot: number; reserved: number; left: number; collected: number; owed: number; spacesTotal: number; spacesUsed: number };
  month: { key: string; arrived: number; left: number; collectedCents: number; discountCents?: number };
};

export type ParkingLotDraft = {
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  zipCode: string;
  totalSpaces: string;
  blockedSpaces: string;
  open: boolean;
};

export const emptyParkingLotDraft: ParkingLotDraft = {
  name: "", addressLine1: "", city: "", state: "", zipCode: "", totalSpaces: "", blockedSpaces: "", open: true,
};

function text(value: unknown, max = 200): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function whole(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The id of a business's first lot (the server's `mainLotId`). */
export function mainParkingLotId(businessId: string): string {
  return `${text(businessId, 180)}_main`;
}

/** A `parkingLots` row as the console uses it. */
export function parkingLotFromRow(row: Row): ParkingLot {
  return {
    id: text(row.id),
    name: text(row.name, 60),
    addressLine1: text(row.addressLine1),
    city: text(row.city, 120),
    state: text(row.state, 80),
    zipCode: text(row.zipCode, 20),
    totalSpaces: whole(row.totalSpaces),
    blockedSpaces: whole(row.blockedSpaces),
    open: row.active !== false,
    isMain: row.isMain === true,
    sortOrder: Number(row.sortOrder) || 0,
  };
}

/** Every lot, open ones first, in the order staff see them (the server's `openLots`). */
export function sortedParkingLots(rows: readonly Row[] | null | undefined): ParkingLot[] {
  return (rows ?? []).map(parkingLotFromRow).filter((lot) => lot.id).sort((a, b) =>
    Number(b.open) - Number(a.open) || a.sortOrder - b.sortOrder || Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name));
}

export function openParkingLots(lots: readonly ParkingLot[]): ParkingLot[] {
  return lots.filter((lot) => lot.open);
}

/**
 * The lot a car stands in. A car parked before lots existed, and one the
 * old phone app parked, carries none: it is in the business's first lot.
 */
export function parkingLotIdOf(car: Row | null | undefined, businessId: string): string {
  return text(car?.parkingLotId) || mainParkingLotId(businessId || text(car?.businessId, 180));
}

/** The lot's name for a car: the lot's current name, else the copy the car carries. */
export function parkingLotNameOf(car: Row | null | undefined, businessId: string, lots: readonly ParkingLot[]): string {
  const id = parkingLotIdOf(car, businessId);
  return lots.find((lot) => lot.id === id)?.name || text(car?.parkingLotName, 60);
}

/** Whether staff are asked for a lot at all: only a business with two or more open lots. */
export function asksForParkingLot(lots: readonly ParkingLot[]): boolean {
  return openParkingLots(lots).length >= 2;
}

const LAST_LOT_KEY = "laawol.parkingLastLot";

/** Whether a lot's figures say it has no space left. */
export function parkingLotIsFull(lot: ServerParkingLot | null | undefined): boolean {
  return Boolean(lot && lot.totals.spacesTotal > 0 && lot.totals.spacesUsed >= lot.totals.spacesTotal);
}

/**
 * The lot the form opens on: the one this person used last on this device,
 * when it is still open and has room; else the first open lot with room;
 * else the first open lot (the server then says it is full).
 */
export function defaultParkingLotId(
  lots: readonly ParkingLot[],
  businessId: string,
  remembered: string,
  figures: readonly ServerParkingLot[] = [],
): string {
  const open = openParkingLots(lots);
  const hasRoom = (lot: ParkingLot) => !parkingLotIsFull(figures.find((f) => f.lotId === lot.id));
  const withRoom = open.filter(hasRoom);
  return withRoom.find((lot) => lot.id === remembered)?.id ?? withRoom[0]?.id ??
    open.find((lot) => lot.id === remembered)?.id ?? open[0]?.id ?? mainParkingLotId(businessId);
}

export function rememberedParkingLot(businessId: string): string {
  try {
    return text(window.localStorage.getItem(`${LAST_LOT_KEY}.${businessId}`));
  } catch {
    return "";
  }
}

export function rememberParkingLot(businessId: string, lotId: string): void {
  try {
    window.localStorage.setItem(`${LAST_LOT_KEY}.${businessId}`, lotId);
  } catch {
    // A private window keeps nothing; the form then opens on the first lot.
  }
}

export function parkingLotDraftFrom(lot: ParkingLot | null): ParkingLotDraft {
  if (!lot) return emptyParkingLotDraft;
  return {
    name: lot.name,
    addressLine1: lot.addressLine1,
    city: lot.city,
    state: lot.state,
    zipCode: lot.zipCode,
    totalSpaces: String(lot.totalSpaces),
    blockedSpaces: lot.blockedSpaces > 0 ? String(lot.blockedSpaces) : "",
    open: lot.open,
  };
}

export type ParkingLotError = "lot_name_required" | "lot_name_taken" | "lot_spaces_invalid" | "lot_blocked_invalid";

/** What is wrong with a lot as typed: the server's `normalizeLot`, told before the trip. */
export function parkingLotDraftErrors(draft: ParkingLotDraft, lots: readonly ParkingLot[], lotId = ""): ParkingLotError[] {
  const errors: ParkingLotError[] = [];
  const name = text(draft.name, 60);
  if (!name) errors.push("lot_name_required");
  else if (lots.some((lot) => lot.id !== lotId && lot.name.toLowerCase() === name.toLowerCase())) errors.push("lot_name_taken");
  const total = draft.totalSpaces.trim() === "" ? NaN : Number(draft.totalSpaces);
  if (!Number.isInteger(total) || total < 0 || total > 100000) errors.push("lot_spaces_invalid");
  const blocked = draft.blockedSpaces.trim() === "" ? 0 : Number(draft.blockedSpaces);
  if (!Number.isInteger(blocked) || blocked < 0 || (Number.isInteger(total) && blocked > total)) errors.push("lot_blocked_invalid");
  return errors;
}

/** The sentences of the lot refusals (the server's `LOT_MESSAGES`); the DOM translator has their French. */
export const PARKING_LOT_MESSAGES: Record<string, string> = {
  lot_name_required: "Give the lot a name.",
  lot_name_taken: "Another lot already has that name.",
  lot_spaces_invalid: "Enter how many spaces the lot has, zero or more.",
  lot_blocked_invalid: "Blocked spaces must be zero or more, and no more than the lot has.",
  lot_not_found: "That lot was not found. Refresh and try again.",
  lot_closed: "That lot is closed. Choose another lot.",
  lot_full: "That lot is full. Choose another lot.",
  lot_has_cars: "There are still cars in that lot. Move them to another lot first.",
  lot_last_open: "A business that parks cars needs at least one open lot.",
  lot_limit: "That is the most lots a business can have.",
};

/** A refused lot request as a sentence; "" when the failure is not a lot refusal. */
export function parkingLotRefusalText(failure: unknown): string {
  const reason = text((failure as { details?: { reason?: unknown } } | null)?.details?.reason, 60);
  return PARKING_LOT_MESSAGES[reason] ?? "";
}

/** `updateBusinessParkingEntry` action `lot_save`. */
export function parkingLotSaveRequest(businessId: string, draft: ParkingLotDraft, lotId = "") {
  return {
    action: "lot_save" as const,
    businessId,
    ...(lotId ? { lotId } : {}),
    lot: {
      name: text(draft.name, 60),
      addressLine1: text(draft.addressLine1),
      city: text(draft.city, 120),
      state: text(draft.state, 80),
      zipCode: text(draft.zipCode, 20),
      totalSpaces: Math.trunc(Number(draft.totalSpaces)) || 0,
      blockedSpaces: Math.trunc(Number(draft.blockedSpaces)) || 0,
      active: draft.open,
    },
  };
}

/** `updateBusinessParkingEntry` action `lot_move`. */
export const parkingLotMoveRequest = (entryId: string, parkingLotId: string) =>
  ({ action: "lot_move" as const, entryId, parkingLotId });

/** `updateBusinessParkingEntry` action `lot_booking`. */
export const parkingLotBookingRequest = (businessId: string, lotId: string) =>
  ({ action: "lot_booking" as const, businessId, lotId });
