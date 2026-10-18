/**
 * Containers, console side — what a business loaded into a shipping box,
 * recorded by the business itself rather than assembled from customer
 * requests.
 *
 * The rules here are a deliberate mirror of the server's pure module,
 * `my_flutter_app/functions/container_manifest.js`. The callables are the
 * authority; this exists so a form refuses a bad entry before it costs a
 * round trip, and so the refusal reads as a sentence next to the field rather
 * than a raw code. Everything a row needs to be listed, searched, filtered or
 * joined against a parked car lives here too, so `containers-panel.tsx` stays
 * a thin wrapper.
 *
 * Nothing here imports Firebase or React: `container-manifest.test.ts`
 * validates it without a browser. Copy that shape from `lot-ledger.ts`.
 */

import { businessParkingEndLabel } from "./business-parking-entry.ts";
import { CALLING_CODE_BY_COUNTRY } from "./calling-code-catalog.ts";
import { destinationCountryOptionForRow } from "./destination-countries.ts";
import {
  groupRootId,
  lineCounts,
  lineHasPieces,
  linePieces,
  lineSourceOf,
  partIndexOf,
  pieceSummaryText,
  piecesSummaryFields,
  type LineSource,
  type Piece,
} from "./line-pieces.ts";
import {
  newPieceDraft,
  pieceDraftProblems,
  pieceDraftsFromLine,
  piecesDifferFromLine,
  piecesPayload,
  type PieceDraft,
  type PiecePayload,
} from "./piece-drafts.ts";

export const CONTAINER_STATUSES = ["loading", "shipped", "arrived"] as const;
export type ContainerStatus = (typeof CONTAINER_STATUSES)[number];

/**
 * The state badge: its word and its `lst-badge` tone. `arrived` is stored as
 * before but means READY FOR PICKUP: staff mark it when the goods can be
 * collected (the ready-for-pickup WhatsApp message goes out then).
 */
export const CONTAINER_STATUS_LABELS: Record<ContainerStatus, string> = {
  loading: "Loading",
  shipped: "Shipped",
  arrived: "Ready for pickup",
};

export const CONTAINER_STATUS_TONES: Record<ContainerStatus, string> = {
  loading: "warn",
  shipped: "navy",
  arrived: "ok",
};

/**
 * A package that has been dropped off but is not on a container yet. It is a
 * line like any other (same collection, same tracking code for life) with
 * `containerId: ""` and `containerStatus: "waiting"`; it is not a state a
 * container can be in, so `CONTAINER_STATUSES` does not list it.
 */
export const WAITING_STATUS = "waiting";
/** Where a line stands: waiting, or the state of the container it is on. */
export type LineStage = ContainerStatus | typeof WAITING_STATUS;

export const LINE_STAGE_LABELS: Record<LineStage, string> = {
  ...CONTAINER_STATUS_LABELS,
  waiting: "Waiting list",
};

export const LINE_STAGE_TONES: Record<LineStage, string> = {
  ...CONTAINER_STATUS_TONES,
  waiting: "muted",
};

export const CONTAINER_LINE_KINDS = ["car", "barrels", "other"] as const;
export type ContainerLineKind = (typeof CONTAINER_LINE_KINDS)[number];

export const CONTAINER_OWNER_KINDS = ["customer", "stock"] as const;
export type ContainerOwnerKind = (typeof CONTAINER_OWNER_KINDS)[number];

/**
 * ISO 6346: four letters (owner code) and seven digits. Booking numbers and
 * bills of lading have no universal shape, so they live in their own field
 * and are never mistaken for a container number.
 */
export const ISO_CONTAINER_NUMBER = /^[A-Z]{4}\d{7}$/;

const MAX_TEXT = 200;
const MAX_LABEL = 120;
const MAX_NOTE = 500;
const MAX_VIN = 17;
const MIN_VIN = 6;
const MAX_QUANTITY = 999;

type Row = Record<string, unknown>;

function text(value: unknown, max = MAX_TEXT): string {
  return String(value ?? "").trim().slice(0, max);
}

function positiveInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function asRow(value: unknown): Row {
  return value && typeof value === "object" ? (value as Row) : {};
}

// ---------------------------------------------------------------------------
// Phones. Mirrors the server's `phone`, `isInternationalPhone` and
// `phoneAcceptable`: formatting is the typist's and is dropped; the leading
// plus is kept. Only the full international form can receive WhatsApp.
// ---------------------------------------------------------------------------

const PHONE_FORMATTING = /[\s().-]/g;
/** +<country code><number> — the only form WhatsApp can reach. */
export const INTERNATIONAL_PHONE = /^\+[1-9]\d{7,14}$/;
const STORABLE_PHONE = /^\+?\d{7,15}$/;

/**
 * A phone as the server stores it: spaces, dots, dashes and parentheses
 * dropped, the leading plus kept. Anything that is not 7-15 digits comes back
 * as typed (trimmed) so the validator can name it.
 */
export function cleanContainerPhone(value: unknown): string {
  const raw = text(value, 40);
  const compact = raw.replace(PHONE_FORMATTING, "");
  return STORABLE_PHONE.test(compact) ? compact : raw;
}

/** Whether a stored or typed phone is a reachable international number. */
export function isInternationalPhone(value: unknown): boolean {
  return INTERNATIONAL_PHONE.test(cleanContainerPhone(value));
}

/**
 * Empty is fine (nobody to reach); anything else must look like a phone.
 * Local numbers are still accepted, as the server accepts them from older
 * app versions, but only an international one can be messaged.
 */
function phoneAcceptable(value: unknown): boolean {
  const stored = cleanContainerPhone(value);
  return !stored || STORABLE_PHONE.test(stored);
}

/**
 * How a phone stands for WhatsApp: nothing typed, reachable, a local number
 * missing its country code, or something too short or malformed to be one.
 */
export type ContactPhoneReach = "empty" | "international" | "local" | "incomplete";

export function contactPhoneReach(value: unknown): ContactPhoneReach {
  const stored = cleanContainerPhone(value);
  if (!stored) return "empty";
  if (INTERNATIONAL_PHONE.test(stored)) return "international";
  if (!stored.startsWith("+") && STORABLE_PHONE.test(stored)) return "local";
  return "incomplete";
}

/** A switch that is on unless it was explicitly turned off (server `onUnlessOff`). */
function onUnlessOff(value: unknown): boolean {
  return value !== false && value !== "false";
}

/**
 * The ISO-2 code a phone picker should open on for the business's own
 * customers: the business's country (stored as a name, e.g. "United States",
 * or a code), else the US.
 */
export function phoneCountryForBusiness(business: unknown): string {
  const r = asRow(business);
  const option = destinationCountryOptionForRow({
    name: r.country ?? r.addressCountry,
    code: r.countryCode,
  });
  const code = text(option.code, 4).toUpperCase();
  return code && CALLING_CODE_BY_COUNTRY[code] ? code : "US";
}

/**
 * The ISO-2 code a receiver's phone picker should open on: the container's
 * destination. `destinationCountryId` is a catalog slug ("guinea"), not a
 * code, so it is mapped through the country catalog; an unknown destination
 * falls back to `fallback`.
 */
export function phoneCountryForDestination(
  container: unknown,
  fallback = "US",
  destinations: readonly unknown[] = [],
): string {
  const r = asRow(container);
  const id = text(r.destinationCountryId, 60);
  const name = text(r.destinationCountryName, MAX_LABEL);
  if (!id && !name) return fallback;
  // The business's own destination documents come first: their ids need not
  // be catalog slugs, but they carry a code or a name that is (the mobile
  // picker's `countryCodeForReference` searches them the same way).
  const own = id
    ? (Array.isArray(destinations) ? destinations : []).map(asRow).find((row) => text(row.id, MAX_LABEL) === id)
    : undefined;
  const ownCode = own ? text(destinationCountryOptionForRow(own).code, 4).toUpperCase() : "";
  if (ownCode && CALLING_CODE_BY_COUNTRY[ownCode]) return ownCode;
  const option = destinationCountryOptionForRow({ id, name });
  const code = text(option.code, 4).toUpperCase();
  return code && CALLING_CODE_BY_COUNTRY[code] ? code : fallback;
}

/** A VIN as the server stores it: upper-case, alphanumeric, at most 17. */
export function cleanVin(value: unknown): string {
  return text(value, 40).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, MAX_VIN);
}

// ---------------------------------------------------------------------------
// Every refusal the server can send, as the sentence the form shows.
// ---------------------------------------------------------------------------

export type ContainerRefusal =
  | "container_label_required"
  | "container_number_invalid"
  | "container_status_invalid"
  | "container_transition_invalid"
  | "destination_required"
  | "container_empty"
  | "container_locked"
  | "container_has_lines"
  | "container_not_found"
  | "line_not_found"
  | "line_kind_invalid"
  | "vin_required"
  | "quantity_required"
  | "description_required"
  | "owner_kind_invalid"
  | "customer_name_required"
  | "customer_phone_invalid"
  | "receiver_phone_invalid"
  | "vin_already_loaded"
  | "vin_already_waiting"
  | "move_target_not_loading"
  | "package_destination_required"
  | "destination_mismatch"
  | "container_destination_required"
  | "size_invalid"
  | "line_not_waiting"
  | "line_is_waiting"
  | "line_not_in_container"
  | "line_ids_invalid"
  | "line_has_payments"
  | "price_invalid"
  | "price_below_paid"
  | "price_required"
  | "amount_required"
  | "amount_too_large"
  | "payment_method_invalid"
  | "received_by_required"
  | "received_by_invalid"
  | "payment_exceeds_balance"
  | "payment_not_found"
  | "payment_already_reverted"
  | "carrier_invalid"
  | "pieces_required"
  | "pieces_too_many"
  | "piece_kind_invalid"
  | "piece_description_required"
  | "piece_description_too_long"
  | "piece_size_invalid"
  | "piece_price_invalid"
  | "piece_count_invalid"
  | "line_has_parts";

export const CONTAINER_MESSAGES: Record<ContainerRefusal, string> = {
  container_label_required: "Give the container a working name, or its container or booking number.",
  container_number_invalid:
    "A container number is four letters and seven digits, like MSKU1234567. " +
    "Booking numbers and bills of lading go in the reference field.",
  container_status_invalid: "That is not a state a container can be in.",
  container_transition_invalid:
    "A container only moves forward: loading, then shipped, then arrived.",
  destination_required: "Choose where this container is going before it ships.",
  container_empty: "Nothing is on this container yet, so it can't ship.",
  container_locked:
    "This container has shipped. Its list is the record of what went; add a " +
    "note instead of changing it.",
  container_has_lines:
    "This container has lines on it. Remove them first, or leave it.",
  container_not_found: "Container not found.",
  line_not_found: "That line is no longer on the container.",
  line_kind_invalid:
    "Say what this line is: a car, barrels, or something else.",
  vin_required: "Enter the VIN.",
  quantity_required: "Enter how many.",
  description_required: "Say what it is.",
  owner_kind_invalid: "Say whose this is: a customer, or your own stock.",
  customer_name_required: "Enter the customer's name.",
  customer_phone_invalid:
    "The customer's phone doesn't look like a phone number.",
  receiver_phone_invalid:
    "The receiver's phone doesn't look like a phone number.",
  vin_already_loaded:
    "This car is already on another container that hasn't arrived.",
  vin_already_waiting: "This car is already waiting for a container.",
  move_target_not_loading:
    "You can only move a line to a container that is still loading.",
  package_destination_required: "Choose where this package is going.",
  destination_mismatch:
    "A package can only go on a container headed to the same country.",
  container_destination_required:
    "Choose where this container is going before adding packages to it.",
  size_invalid:
    "Enter the length, width and height in inches, or leave all three empty.",
  line_not_waiting: "That package is already on a container.",
  line_is_waiting:
    "This package is waiting for a container. Add it to one from the " +
    "waiting list.",
  line_not_in_container: "That package is not on a container.",
  line_ids_invalid: "Choose between 1 and 100 packages.",
  line_has_payments:
    "Payments are recorded for this package. Revert them first.",
  price_invalid: "Enter the price in dollars, more than zero.",
  price_below_paid: "The price can't be less than what has been paid.",
  price_required: "Set a price before recording a payment.",
  amount_required: "Enter the amount received.",
  amount_too_large: "That amount is larger than a package can carry.",
  payment_method_invalid: "Say how the payment arrived.",
  received_by_required: "Say which staff member took the payment.",
  received_by_invalid: "Choose someone on your team as the person who took the payment.",
  payment_exceeds_balance: "That is more than what is still owed.",
  payment_not_found: "That payment no longer exists.",
  payment_already_reverted: "That payment was already reverted.",
  carrier_invalid: "Choose the shipping line from the list.",
  pieces_required: "Add at least one piece.",
  pieces_too_many: "A package can have at most 60 pieces.",
  piece_kind_invalid:
    "Say what each piece is: a barrel, a box, or something else.",
  piece_description_required: "Say what each box or item is.",
  piece_description_too_long:
    "Keep each piece's description to 120 characters.",
  piece_size_invalid:
    "Enter a piece's length, width and height in inches, or leave all " +
    "three empty.",
  piece_price_invalid: "Enter each piece's price in dollars, zero or more.",
  piece_count_invalid:
    "Choose how many pieces go in: from 1 to the number the package has.",
  line_has_parts:
    "Other parts of this package are still listed. Remove them first.",
};

export function containerMessage(codes: readonly ContainerRefusal[]): string {
  return codes.map((code) => CONTAINER_MESSAGES[code]).join(" ");
}

/** The most packages one `assignContainerLines` call takes. */
export const MAX_ASSIGN_LINES = 100;

// ---------------------------------------------------------------------------
// The container.
// ---------------------------------------------------------------------------

export type ContainerDraft = {
  label: string;
  containerNumber: string;
  bookingReference: string;
  destinationCountryId: string;
  destinationCountryName: string;
  notes: string;
  /** The shipping line's SCAC; "" = guess it from the container number. */
  carrierScac: string;
};

export const emptyContainerDraft: ContainerDraft = {
  label: "",
  containerNumber: "",
  bookingReference: "",
  destinationCountryId: "",
  destinationCountryName: "",
  notes: "",
  carrierScac: "",
};

/** A SCAC as the server stores it (`containerCarrierScac`). */
export function containerCarrierScac(value: unknown): string {
  return text(value, 40).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

/**
 * Whether carrier tracking gave up on this container because it could not
 * tell the shipping line from the number (a leasing prefix such as TCKU)
 * and nobody has chosen one since: the console asks staff to choose it, and
 * choosing it starts tracking (`shouldStartCarrierTracking` on the server).
 */
export function containerCarrierNeedsChoice(row: unknown): boolean {
  const r = asRow(row);
  const number = text(r.containerNumber, 20);
  if (!number || containerStatus(r) === "arrived") return false;
  if (text(r.trackingProvider, 40) === "carrier_api" && text(r.trackedContainerNumber, 20) === number) {
    return false;
  }
  return (
    text(r.carrierTrackingError, 300) === "carrier_unknown" &&
    text(r.carrierTrackingFailedFor, 20) === number &&
    !containerCarrierScac(r.carrierScac)
  );
}

export type ContainerError =
  | "container_label_required"
  | "container_number_invalid";

/** Same checks as the server's `validateContainer`, every problem at once. */
export function validateContainerDraft(draft: ContainerDraft): ContainerError[] {
  const errors: ContainerError[] = [];
  const number = text(draft.containerNumber, 20).toUpperCase();
  // The working name is for the box that has no number yet; a container or
  // booking number is a name enough.
  if (!text(draft.label, MAX_LABEL) && !number && !text(draft.bookingReference, 60)) {
    errors.push("container_label_required");
  }
  if (number && !ISO_CONTAINER_NUMBER.test(number)) {
    errors.push("container_number_invalid");
  }
  return errors;
}

/**
 * The fields a business may set, shaped as the server's `containerRecord`
 * plus the shipping line (`carrierScac`), which both callables take apart.
 */
export function containerPayload(draft: ContainerDraft) {
  return {
    label: text(draft.label, MAX_LABEL),
    containerNumber: text(draft.containerNumber, 20).toUpperCase(),
    bookingReference: text(draft.bookingReference, 60).toUpperCase(),
    destinationCountryId: text(draft.destinationCountryId, 60),
    destinationCountryName: text(draft.destinationCountryName, MAX_LABEL),
    notes: text(draft.notes, MAX_NOTE),
    carrierScac: containerCarrierScac(draft.carrierScac),
  };
}

/** A stored container back into the edit form. */
export function containerDraftFromRow(row: Row): ContainerDraft {
  return {
    label: text(row.label, MAX_LABEL),
    containerNumber: text(row.containerNumber, 20),
    bookingReference: text(row.bookingReference, 60),
    destinationCountryId: text(row.destinationCountryId, 60),
    destinationCountryName: text(row.destinationCountryName, MAX_LABEL),
    notes: text(row.notes, MAX_NOTE),
    carrierScac: containerCarrierScac(row.carrierScac),
  };
}

export function containerStatus(row: unknown): ContainerStatus {
  const value = text(asRow(row).status, 20);
  return (CONTAINER_STATUSES as readonly string[]).includes(value)
    ? (value as ContainerStatus)
    : "loading";
}

/**
 * Whether the container may move from its current state to the next one.
 * Forward only: a shipped box does not come back to the yard, and an arrived
 * one is closed. Shipping needs a destination and something on board.
 */
export function containerTransitionRefusal(
  current: unknown,
  nextStatus: string,
  lineCount: number,
): ContainerRefusal | null {
  const row = asRow(current);
  const from = containerStatus(row);
  const to = text(nextStatus, 20);
  if (!(CONTAINER_STATUSES as readonly string[]).includes(to)) {
    return "container_status_invalid";
  }
  if (from === "loading" && to === "shipped") {
    if (!text(row.destinationCountryId, 60)) return "destination_required";
    if (positiveInt(lineCount) <= 0) return "container_empty";
    return null;
  }
  if (from === "shipped" && to === "arrived") return null;
  return "container_transition_invalid";
}

/** True while structural fields (and lines) may still change. */
export function containerIsOpen(current: unknown): boolean {
  return containerStatus(current) === "loading";
}

export function containerDeleteRefusal(
  current: unknown,
  lineCount: number,
): ContainerRefusal | null {
  if (!containerIsOpen(current)) return "container_locked";
  if (positiveInt(lineCount) > 0) return "container_has_lines";
  return null;
}

/** The forward step from here, or null once arrived. */
export function nextContainerStatus(current: unknown): ContainerStatus | null {
  const status = containerStatus(current);
  if (status === "loading") return "shipped";
  if (status === "shipped") return "arrived";
  return null;
}

// ---------------------------------------------------------------------------
// A line on the list.
// ---------------------------------------------------------------------------

/**
 * The first question the car form asks, before any VIN field: is the car in
 * the lot? "" until answered; "yes" offers the parked cars to pick from,
 * "no" is the VIN-first flow. Reset with the kind.
 */
export type ContainerLineInLot = "" | "yes" | "no";

export type ContainerLineDraft = {
  kind: ContainerLineKind;
  inLot: ContainerLineInLot;
  /** The parkedCars row the car fields were filled from, when one was picked. */
  parkedCarId: string;
  vinNumber: string;
  carMake: string;
  carModel: string;
  carYear: string;
  /** As typed; cars always count one. */
  quantity: string;
  description: string;
  ownerKind: ContainerOwnerKind;
  customerName: string;
  customerPhone: string;
  /** Who collects it at the other end - the name written on the barrel. */
  receiverName: string;
  receiverPhone: string;
  /** Whether the customer hears about the shipment on WhatsApp. On by default. */
  notifyCustomer: boolean;
  /** Whether the receiver hears about the shipment on WhatsApp. On by default. */
  notifyReceiver: boolean;
  /**
   * What a line that is not a car holds: each barrel, box or other thing
   * handed over (docs/WAITING_PACKAGES.md "Pieces"). `quantity` and
   * `description` are what the server writes from them for older apps.
   */
  pieces: PieceDraft[];
};

export const emptyContainerLineDraft: ContainerLineDraft = {
  kind: "car",
  inLot: "",
  parkedCarId: "",
  vinNumber: "",
  carMake: "",
  carModel: "",
  carYear: "",
  quantity: "",
  description: "",
  ownerKind: "customer",
  customerName: "",
  customerPhone: "",
  receiverName: "",
  receiverPhone: "",
  notifyCustomer: true,
  notifyReceiver: true,
  pieces: [newPieceDraft()],
};

/** Whether a line draft is described by its pieces (every kind but a car). */
export function lineDraftHasPieces(draft: { kind: string }): boolean {
  return text(draft.kind, 20) !== "car";
}

export type ContainerLineError =
  | "line_kind_invalid"
  | "vin_required"
  | "quantity_required"
  | "description_required"
  | "owner_kind_invalid"
  | "customer_name_required"
  | "customer_phone_invalid"
  | "receiver_phone_invalid"
  | "pieces_required"
  | "pieces_too_many"
  | "piece_kind_invalid"
  | "piece_description_required"
  | "piece_description_too_long"
  | "piece_size_invalid"
  | "piece_price_invalid";

type ContactPhoneError = "customer_phone_invalid" | "receiver_phone_invalid";

/** Same checks as the server's `contactPhoneErrors`. */
function contactPhoneErrors(
  input: { customerPhone?: unknown; receiverPhone?: unknown },
  owner: string,
): ContactPhoneError[] {
  const errors: ContactPhoneError[] = [];
  if (owner === "customer" && !phoneAcceptable(input.customerPhone)) {
    errors.push("customer_phone_invalid");
  }
  if (!phoneAcceptable(input.receiverPhone)) errors.push("receiver_phone_invalid");
  return errors;
}

/** Same checks as the server's `validateContainerLine`. */
export function validateContainerLineDraft(
  draft: ContainerLineDraft,
): ContainerLineError[] {
  const errors: ContainerLineError[] = [];
  const kind = text(draft.kind, 20);
  if (!(CONTAINER_LINE_KINDS as readonly string[]).includes(kind)) {
    errors.push("line_kind_invalid");
  }
  if (kind === "car") {
    if (cleanVin(draft.vinNumber).length < MIN_VIN) errors.push("vin_required");
  } else if ((CONTAINER_LINE_KINDS as readonly string[]).includes(kind)) {
    // What the line is comes from its pieces, as on the server
    // (`linesInPiecesMode`): 1-60 of them, each saying what it is.
    errors.push(...pieceDraftProblems(draft.pieces ?? []).codes);
  }
  const owner = text(draft.ownerKind, 20);
  if (!(CONTAINER_OWNER_KINDS as readonly string[]).includes(owner)) {
    errors.push("owner_kind_invalid");
  }
  // A customer's line has to say who; the business's own stock has no one to
  // name, and asking for a name there is how fictional customers get typed.
  if (owner === "customer" && !text(draft.customerName, MAX_LABEL)) {
    errors.push("customer_name_required");
  }
  errors.push(...contactPhoneErrors(draft, owner));
  return errors;
}

/**
 * The contact half of a line as the server's `containerLineContacts` stores
 * it: phones stripped of formatting, a stock line naming no customer, and
 * each WhatsApp switch forced off when there is no number to send to.
 */
function lineContacts(
  input: {
    customerName?: unknown;
    customerPhone?: unknown;
    receiverName?: unknown;
    receiverPhone?: unknown;
    notifyCustomer?: unknown;
    notifyReceiver?: unknown;
  },
  owner: string,
) {
  const customer = owner === "customer";
  const customerPhone = customer ? cleanContainerPhone(input.customerPhone) : "";
  const receiverPhone = cleanContainerPhone(input.receiverPhone);
  return {
    customerName: customer ? text(input.customerName, MAX_LABEL) : "",
    customerPhone,
    // Either owner kind may name a receiver: stock goes to the business's
    // own agent at the port.
    receiverName: text(input.receiverName, MAX_LABEL),
    receiverPhone,
    notifyCustomer: Boolean(customerPhone) && onUnlessOff(input.notifyCustomer),
    notifyReceiver: Boolean(receiverPhone) && onUnlessOff(input.notifyReceiver),
  };
}

/**
 * The `line` body `addContainerLine` takes, shaped as the server stores it.
 * A line that is not a car sends its `pieces`; the kind, quantity and
 * description beside them are the summary the server recomputes (and what an
 * older server still reads).
 */
/** The `line` body of a request: every field the server takes for a line, `pieces` for all but a car. */
export type ContainerLinePayload = ReturnType<typeof lineContacts> & {
  kind: string;
  vinNumber: string;
  carMake: string;
  carModel: string;
  carYear: string;
  ownerKind: string;
  quantity: number;
  description: string;
  pieces?: PiecePayload[];
};

export function containerLinePayload(draft: ContainerLineDraft): ContainerLinePayload {
  const kind = text(draft.kind, 20);
  const owner = text(draft.ownerKind, 20);
  const isCar = kind === "car";
  const base = {
    vinNumber: isCar ? cleanVin(draft.vinNumber) : "",
    carMake: isCar ? text(draft.carMake, 80) : "",
    carModel: isCar ? text(draft.carModel, 80) : "",
    carYear: isCar ? text(draft.carYear, 8) : "",
    ownerKind: owner,
    ...lineContacts(draft, owner),
  };
  if (isCar) return { kind, ...base, quantity: 1, description: "" };
  const pieces = piecesPayload(draft.pieces ?? []);
  const summary = piecesSummaryFields(pieces);
  return {
    kind: summary.kind,
    ...base,
    quantity: Math.min(MAX_QUANTITY, summary.quantity),
    description: summary.kind === "other" ? text(summary.description, MAX_LABEL) : "",
    pieces,
  };
}

/**
 * The same body in the old kind/quantity form, for a line saved before
 * pieces existed whose pieces were not changed: an edit of its contacts or
 * destination leaves what it is exactly as stored.
 */
function legacyLinePayload(line: unknown, draft: ContainerLineDraft): ContainerLinePayload {
  const r = asRow(line);
  const owner = text(draft.ownerKind, 20);
  const kind = text(r.kind, 20) === "barrels" ? "barrels" : "other";
  return {
    kind,
    vinNumber: "",
    carMake: "",
    carModel: "",
    carYear: "",
    quantity: Math.min(MAX_QUANTITY, positiveInt(r.quantity) || 1),
    description: kind === "other" ? text(r.description, MAX_LABEL) : "",
    ownerKind: owner,
    ...lineContacts(draft, owner),
  };
}

/** Whether an edit keeps a legacy line in its old form (its pieces were left as they read). */
export function editKeepsLegacyForm(line: unknown, draft: Pick<ContainerLineDraft, "kind" | "pieces">): boolean {
  const r = asRow(line);
  const legacy = text(r.kind, 20) !== "car" && !lineHasPieces(r);
  return lineDraftHasPieces(draft) && legacy && !piecesDifferFromLine(r, draft.pieces ?? []);
}

/**
 * What an edit sends for the line itself: its pieces (ids kept), or - for a
 * legacy line whose pieces were left as they read - its old form.
 */
export function editedLinePayload(line: unknown, draft: ContainerLineDraft): ContainerLinePayload {
  return editKeepsLegacyForm(line, draft) ? legacyLinePayload(line, draft) : containerLinePayload(draft);
}

// ---------------------------------------------------------------------------
// Editing a whole line — what it is and whose, as well as its contacts. The
// server (`updateContainerLine`) takes a change to what the line is only while
// the container is loading; contacts stay correctable in every state.
// ---------------------------------------------------------------------------

/**
 * A stored line back into the add-line form, so the same form edits it. A
 * car opens on the typed-VIN branch ("not picked from the lot") with its VIN,
 * make, model and year filled; barrels and other cargo carry their count. A
 * line saved before the WhatsApp switches existed reads as switched on, like
 * the server's `onUnlessOff`.
 */
export function containerLineDraftFromRow(line: unknown): ContainerLineDraft {
  const r = asRow(line);
  const rawKind = text(r.kind, 20);
  const kind: ContainerLineKind = (CONTAINER_LINE_KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as ContainerLineKind)
    : "car";
  const owner: ContainerOwnerKind = text(r.ownerKind, 20) === "stock" ? "stock" : "customer";
  const isCar = kind === "car";
  const quantity = positiveInt(r.quantity);
  return {
    kind,
    inLot: isCar ? "no" : "",
    parkedCarId: "",
    vinNumber: isCar ? cleanVin(r.vinNumber) : "",
    carMake: isCar ? text(r.carMake, 80) : "",
    carModel: isCar ? text(r.carModel, 80) : "",
    carYear: isCar ? text(r.carYear, 8) : "",
    quantity: !isCar && quantity > 0 ? String(quantity) : "",
    description: kind === "other" ? text(r.description, MAX_LABEL) : "",
    ownerKind: owner,
    customerName: owner === "customer" ? text(r.customerName, MAX_LABEL) : "",
    customerPhone: owner === "customer" ? text(r.customerPhone, 40) : "",
    receiverName: text(r.receiverName, MAX_LABEL),
    receiverPhone: text(r.receiverPhone, 40),
    // Someone with no number yet starts switched on, as on a new line; a
    // switch staff turned off stays off.
    notifyCustomer: !text(r.customerPhone, 40) || onUnlessOff(r.notifyCustomer),
    notifyReceiver: !text(r.receiverPhone, 40) || onUnlessOff(r.notifyReceiver),
    // The line's pieces, ids kept (a legacy line's count expanded).
    pieces: pieceDraftsFromLine(r),
  };
}

/** The whole `updateContainerLine` request for an edited line. */
export function updateContainerLineRequest(
  businessId: string,
  line: unknown,
  draft: ContainerLineDraft,
) {
  const r = asRow(line);
  return {
    businessId: text(businessId, MAX_LABEL),
    lineId: text(r.id, MAX_LABEL),
    containerId: text(r.containerId, MAX_LABEL),
    line: editedLinePayload(r, draft),
  };
}

// ---------------------------------------------------------------------------
// Correcting a line's contacts — allowed in every container state, because a
// wrong number matters most once the box has sailed.
// ---------------------------------------------------------------------------

export type ContainerLineContactsDraft = {
  customerName: string;
  customerPhone: string;
  receiverName: string;
  receiverPhone: string;
  notifyCustomer: boolean;
  notifyReceiver: boolean;
};

/**
 * A stored line back into the contacts form. A line saved before the
 * switches existed has neither field; like the server's `onUnlessOff`, a
 * missing switch reads as on.
 */
export function containerLineContactsDraftFromRow(line: unknown): ContainerLineContactsDraft {
  const r = asRow(line);
  return {
    customerName: text(r.customerName, MAX_LABEL),
    customerPhone: text(r.customerPhone, 40),
    receiverName: text(r.receiverName, MAX_LABEL),
    receiverPhone: text(r.receiverPhone, 40),
    notifyCustomer: onUnlessOff(r.notifyCustomer),
    notifyReceiver: onUnlessOff(r.notifyReceiver),
  };
}

/** Same checks as the server's `validateContainerLineContacts`. */
export function validateContainerLineContactsDraft(
  draft: ContainerLineContactsDraft,
  line: unknown,
): ContainerLineError[] {
  const owner = text(asRow(line).ownerKind, 20);
  const errors: ContainerLineError[] = [];
  if (owner === "customer" && !text(draft.customerName, MAX_LABEL)) {
    errors.push("customer_name_required");
  }
  errors.push(...contactPhoneErrors(draft, owner));
  return errors;
}

/**
 * The `contacts` body `updateContainerLineContacts` takes, shaped as the
 * server's `containerLineContactsUpdate` will store it for this line.
 */
export function containerLineContactsPayload(
  draft: ContainerLineContactsDraft,
  line: unknown,
) {
  return lineContacts(draft, text(asRow(line).ownerKind, 20));
}

/** The whole `updateContainerLineContacts` request. */
export function updateContainerLineContactsRequest(
  businessId: string,
  line: unknown,
  draft: ContainerLineContactsDraft,
) {
  return {
    businessId: text(businessId, MAX_LABEL),
    lineId: text(asRow(line).id, MAX_LABEL),
    contacts: containerLineContactsPayload(draft, line),
  };
}

// ---------------------------------------------------------------------------
// Package labels: the printable QR + code sheet for a container or one line.
// ---------------------------------------------------------------------------

/** A Letter sheet (Avery 5524, six per page) or a 4×6 thermal roll. */
export type ContainerLabelFormat = "sheet" | "thermal";
/** Two labels per package (one per side) by default; one to replace a torn label. */
export type ContainerLabelCopies = 1 | 2;
export type ContainerLabelChoice = { format: ContainerLabelFormat; copies: ContainerLabelCopies };

export const DEFAULT_CONTAINER_LABEL_CHOICE: ContainerLabelChoice = { format: "sheet", copies: 2 };
/** Where the console remembers the last format and count, per browser. */
export const CONTAINER_LABEL_CHOICE_KEY = "laawol.containerLabels.v1";

/**
 * Any stored or typed choice, as one the server accepts. Mirrors the
 * server's `labelFormat`/`labelCopies`: anything not "thermal" is a sheet,
 * anything not 1 is two. Accepts the raw localStorage string too.
 */
export function containerLabelChoice(raw: unknown): ContainerLabelChoice {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      value = null;
    }
  }
  const row = asRow(value);
  return {
    format: row.format === "thermal" ? "thermal" : "sheet",
    copies: Number(row.copies) === 1 ? 1 : 2,
  };
}

type ChoiceStorage = Pick<Storage, "getItem" | "setItem">;

/** The last choice from this browser; the default when storage is empty or blocked. */
export function readContainerLabelChoice(storage: ChoiceStorage | null | undefined): ContainerLabelChoice {
  try {
    const raw = storage?.getItem(CONTAINER_LABEL_CHOICE_KEY);
    return raw ? containerLabelChoice(raw) : { ...DEFAULT_CONTAINER_LABEL_CHOICE };
  } catch {
    return { ...DEFAULT_CONTAINER_LABEL_CHOICE };
  }
}

/** Remembers the choice; a private window or full storage just forgets it. */
export function writeContainerLabelChoice(storage: ChoiceStorage | null | undefined, choice: ContainerLabelChoice): void {
  try {
    storage?.setItem(CONTAINER_LABEL_CHOICE_KEY, JSON.stringify(containerLabelChoice(choice)));
  } catch {
    // Remembering is a convenience; printing must not depend on it.
  }
}

/**
 * The `getContainerDocumentUrl` request for labels: the whole container, or
 * only one line's packages when `lineId` is given (a reprint for one barrel).
 * With no container - packages still waiting - the labels are asked for by
 * `lineIds`, one or several.
 */
export function containerLabelsRequest(
  businessId: string,
  containerId: string,
  choice: ContainerLabelChoice,
  lineId: string | readonly string[] = "",
) {
  const { format, copies } = containerLabelChoice(choice);
  const lineIds = (Array.isArray(lineId) ? lineId : [lineId])
    .map((id) => text(id, MAX_LABEL))
    .filter(Boolean);
  const container = text(containerId, MAX_LABEL);
  const base = {
    businessId: text(businessId, MAX_LABEL),
    view: "labels" as const,
    format,
    copies,
  };
  if (!container) return { ...base, lineIds };
  return {
    ...base,
    containerId: container,
    ...(lineIds.length ? { lineId: lineIds[0] } : {}),
  };
}

// ---------------------------------------------------------------------------
// Who hears about a line on WhatsApp, as the list shows it.
// ---------------------------------------------------------------------------

/**
 * One person's WhatsApp standing on a line: "none" (no number, or not this
 * line's to have), "off" (switched off), "on" (will be messaged), or
 * "needs_code" (switched on, but the number cannot be reached as stored).
 */
export type LineWhatsAppState = "none" | "off" | "on" | "needs_code";

export type LineWhatsApp = { customer: LineWhatsAppState; receiver: LineWhatsAppState };

function whatsAppState(phone: unknown, notify: unknown): LineWhatsAppState {
  const stored = cleanContainerPhone(phone);
  if (!stored) return "none";
  if (!onUnlessOff(notify)) return "off";
  return INTERNATIONAL_PHONE.test(stored) ? "on" : "needs_code";
}

export function containerLineWhatsApp(line: unknown): LineWhatsApp {
  const r = asRow(line);
  const customer = text(r.ownerKind, 20) === "customer";
  return {
    customer: customer ? whatsAppState(r.customerPhone, r.notifyCustomer) : "none",
    receiver: whatsAppState(r.receiverPhone, r.notifyReceiver),
  };
}

/**
 * The line under "Whose": who gets updates, then a warning per number that
 * needs its country code. Whole sentences, so each is one dictionary key for
 * the French translator rather than words stitched together.
 */
export function containerLineWhatsAppText(state: LineWhatsApp): { summary: string; warnings: string[] } {
  const customer = state.customer === "on";
  const receiver = state.receiver === "on";
  const summary = customer && receiver
    ? "WhatsApp updates: customer and receiver"
    : customer
      ? "WhatsApp updates: customer"
      : receiver
        ? "WhatsApp updates: receiver"
        : "No WhatsApp updates";
  const warnings: string[] = [];
  if (state.customer === "needs_code") warnings.push("Customer's phone needs a country code");
  if (state.receiver === "needs_code") warnings.push("Receiver's phone needs a country code");
  return { summary, warnings };
}

/**
 * The open container already holding this VIN, if any. A car on two loading
 * lists is a mistake every time; the form refuses before the server does and
 * names the container.
 */
export function openContainerHoldingVin(
  lines: readonly unknown[],
  ignoreContainerId = "",
): string {
  for (const line of Array.isArray(lines) ? lines : []) {
    const row = asRow(line);
    if (text(row.kind, 20) !== "car") continue;
    if (text(row.containerStatus, 20) === "arrived") continue;
    const id = text(row.containerId, MAX_LABEL);
    if (id && id !== text(ignoreContainerId, MAX_LABEL)) return id;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Picking a car that is already in the lot.
// ---------------------------------------------------------------------------

/**
 * The parked cars that are in the lot right now: not cancelled and not past
 * their end date — the same rows the parking panel counts as "In the lot".
 * A car that has left, or a booking that was cancelled, is not there to load.
 */
export function parkedCarsInLot(rows: readonly unknown[], now: Date = new Date()): Row[] {
  return (Array.isArray(rows) ? rows : [])
    .map(asRow)
    .filter((row) => text(row.status, 40) !== "cancelled")
    // A booking whose checkout never completed has no car in the yard. The
    // app draws the same line, so both pickers offer the same cars.
    .filter((row) => text(row.status, 40) !== "pending_payment")
    .filter((row) => businessParkingEndLabel(row, now) !== "Ended");
}

export type ParkedCarPick = {
  id: string;
  vin: string;
  /** "2019 Toyota Camry", or "Car" when nothing is known about it. */
  car: string;
  make: string;
  model: string;
  year: string;
  owner: string;
  phone: string;
  /** Set when the car is already on a container that has not arrived. */
  takenBy: VinPlacement | undefined;
};

/**
 * A parked car as the pick list shows it, looked up in the placement index
 * the panel already builds so a car on another open container is offered
 * disabled with that container named, rather than picked and then refused.
 */
export function parkedCarPick(row: unknown, placements: ReadonlyMap<string, VinPlacement>): ParkedCarPick {
  const r = asRow(row);
  const vin = cleanVin(r.vinNumber);
  const make = text(r.carMake, 80);
  const model = text(r.carModel, 80);
  const year = text(r.carYear, 8);
  return {
    id: text(r.id, MAX_LABEL),
    vin,
    car: [year, make, model].filter(Boolean).join(" ") || "Car",
    make,
    model,
    year,
    owner: text(r.customerName, MAX_LABEL) || text(r.ownerName, MAX_LABEL),
    phone: text(r.customerPhone, 40),
    takenBy: vin ? placements.get(vin) : undefined,
  };
}

/** Narrow the pick list by VIN, owner or make (model and year too, since they sit in the same label). */
export function filterParkedCarPicks(picks: readonly ParkedCarPick[], query: string): ParkedCarPick[] {
  const q = text(query, 120).toLowerCase();
  if (!q) return [...picks];
  const qVin = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return picks.filter(
    (pick) =>
      (qVin.length > 0 && pick.vin.includes(qVin)) ||
      pick.owner.toLowerCase().includes(q) ||
      pick.car.toLowerCase().includes(q),
  );
}

/**
 * The draft after a parked car is picked: the car fields and the owner come
 * from the record, and the answer stays "yes". The owner is a customer when
 * the record names one; a record with no name leaves the owner fields as
 * they were so the form still asks whose it is.
 */
export function lineDraftFromParkedCar(draft: ContainerLineDraft, pick: ParkedCarPick): ContainerLineDraft {
  return {
    ...draft,
    kind: "car",
    inLot: "yes",
    parkedCarId: pick.id,
    vinNumber: pick.vin,
    carMake: pick.make,
    carModel: pick.model,
    carYear: pick.year,
    ownerKind: pick.owner ? "customer" : draft.ownerKind,
    customerName: pick.owner || draft.customerName,
    customerPhone: pick.owner ? pick.phone || draft.customerPhone : draft.customerPhone,
  };
}

export type ContainerCounts = {
  lineCount: number;
  carCount: number;
  barrelCount: number;
  otherCount: number;
};

/**
 * The server's `containerCounts`: lines once each, and the pieces on them by
 * kind - barrel pieces as barrels, boxes and other things as "other", cars as
 * cars. A legacy line counts its quantity (`lineCounts`).
 */
export function containerCounts(lines: readonly unknown[]): ContainerCounts {
  const out: ContainerCounts = { lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0 };
  for (const line of Array.isArray(lines) ? lines : []) {
    out.lineCount += 1;
    const counts = lineCounts(asRow(line));
    out.carCount += counts.carPieces;
    out.barrelCount += counts.barrelPieces;
    out.otherCount += counts.packagePieces;
  }
  return out;
}

/** The stored tallies, or the ones the lines add up to when they are absent. */
export function containerRowCounts(row: unknown, lines: readonly unknown[]): ContainerCounts {
  const r = asRow(row);
  if (typeof r.lineCount === "number") {
    return {
      lineCount: positiveInt(r.lineCount),
      carCount: positiveInt(r.carCount),
      barrelCount: positiveInt(r.barrelCount),
      otherCount: positiveInt(r.otherCount),
    };
  }
  return containerCounts(lines);
}

// ---------------------------------------------------------------------------
// Reading rows: what the list, the search and the cross-link say.
// ---------------------------------------------------------------------------

/** The container number when known, else the working name. */
export function containerTitle(row: unknown): string {
  const r = asRow(row);
  return text(r.containerNumber, 20) || text(r.label, MAX_LABEL) || text(r.bookingReference, 60) || "Container";
}

/**
 * "2019 Toyota Camry" / "12 barrels" / "3 × tires"; a car with no decode
 * shows its VIN. A line with pieces says what they are in the reader's
 * language ("2 barrels, 1 box" / "2 fûts, 1 colis", the server's
 * `pieceSummaryText`), so it renders as data-no-translate.
 */
export function containerLineTitle(line: unknown, lang: "en" | "fr" = "en"): string {
  const r = asRow(line);
  const kind = text(r.kind, 20);
  if (kind !== "car" && lineHasPieces(r)) return pieceSummaryText(linePieces(r), lang);
  if (kind === "car") {
    const car = [text(r.carYear, 8), text(r.carMake, 80), text(r.carModel, 80)]
      .filter(Boolean)
      .join(" ");
    return car || cleanVin(r.vinNumber) || "Car";
  }
  const qty = positiveInt(r.quantity);
  if (kind === "barrels") return `${qty} ${qty === 1 ? "barrel" : "barrels"}`;
  const what = text(r.description, MAX_LABEL);
  return qty > 1 ? `${qty} × ${what}` : what;
}

/**
 * Whether containerLineTitle is console copy ("2 barrels", "Car") rather
 * than what someone typed (a make and model, a VIN, a description). Copy is
 * translated in French; typed values render inside data-no-translate.
 */
export function containerLineTitleIsCopy(line: unknown): boolean {
  const r = asRow(line);
  const kind = text(r.kind, 20);
  // Pieces are named in the reader's language already, typed names inside.
  if (kind !== "car" && lineHasPieces(r)) return false;
  if (kind === "barrels") return true;
  if (kind !== "car") return false;
  return containerLineTitle(line) === "Car";
}

export function containerLineIsStock(line: unknown): boolean {
  return text(asRow(line).ownerKind, 20) === "stock";
}

/** Whether a line is still waiting for a container (dropped off, not loaded). */
export function containerLineIsWaiting(line: unknown): boolean {
  const r = asRow(line);
  return text(r.containerStatus, 20) === WAITING_STATUS || !text(r.containerId, MAX_LABEL);
}

/** A positive finite number (an inch measurement), or null. */
function positiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Whole cents >= 0, or null when the field is absent or not a number. */
function wholeCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * A stored line as the console reads it. Every field a package can carry,
 * with the waiting-package ones (destination, size, price, payments) read
 * defensively: a line saved before they existed has none of them.
 */
export type ContainerLine = {
  id: string;
  businessId: string;
  /** "" while the package waits. */
  containerId: string;
  containerStatus: LineStage | "";
  kind: ContainerLineKind;
  vinNumber: string;
  carMake: string;
  carModel: string;
  carYear: string;
  quantity: number;
  description: string;
  ownerKind: ContainerOwnerKind;
  customerName: string;
  customerPhone: string;
  receiverName: string;
  receiverPhone: string;
  trackingCode: string;
  destinationCountryId: string;
  destinationCountryName: string;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  /** Null until a price is set. */
  priceCents: number | null;
  /** The sum of the payments not reverted; the server keeps it under the price. */
  paidCents: number;
  /** The customer settles on arrival; the Guinea team records it. */
  payOnArrival: boolean;
  /** Every piece, old lines included (`linePieces`): a car is one car piece. */
  pieces: Piece[];
  /** Whether the line stores its own pieces (false for cars and legacy lines). */
  hasPieces: boolean;
  /** The denormalized counts, or what the pieces add up to when absent. */
  pieceCount: number;
  barrelPieces: number;
  packagePieces: number;
  carPieces: number;
  source: LineSource;
  /** When the pieces were received; legacy lines read `createdAt`. */
  receivedAt: unknown;
  /** The root of its split group (its own id when never split). */
  rootLineId: string;
  /** 1 for the root, 2 for the first part split from it... */
  partIndex: number;
};

export function containerLineFromRow(row: unknown): ContainerLine {
  const r = asRow(row);
  const rawKind = text(r.kind, 20);
  const stage = text(r.containerStatus, 20);
  return {
    id: text(r.id, MAX_LABEL),
    businessId: text(r.businessId, MAX_LABEL),
    containerId: text(r.containerId, MAX_LABEL),
    containerStatus: stage === WAITING_STATUS || (CONTAINER_STATUSES as readonly string[]).includes(stage)
      ? (stage as LineStage)
      : "",
    kind: (CONTAINER_LINE_KINDS as readonly string[]).includes(rawKind) ? (rawKind as ContainerLineKind) : "other",
    vinNumber: cleanVin(r.vinNumber),
    carMake: text(r.carMake, 80),
    carModel: text(r.carModel, 80),
    carYear: text(r.carYear, 8),
    quantity: positiveInt(r.quantity),
    description: text(r.description, MAX_LABEL),
    ownerKind: text(r.ownerKind, 20) === "stock" ? "stock" : "customer",
    customerName: text(r.customerName, MAX_LABEL),
    customerPhone: text(r.customerPhone, 40),
    receiverName: text(r.receiverName, MAX_LABEL),
    receiverPhone: text(r.receiverPhone, 40),
    trackingCode: text(r.trackingCode, 40),
    destinationCountryId: text(r.destinationCountryId, 60),
    destinationCountryName: text(r.destinationCountryName, MAX_LABEL),
    lengthIn: positiveNumber(r.lengthIn),
    widthIn: positiveNumber(r.widthIn),
    heightIn: positiveNumber(r.heightIn),
    priceCents: wholeCents(r.priceCents),
    paidCents: wholeCents(r.paidCents) ?? 0,
    payOnArrival: r.payOnArrival === true,
    ...linePieceFields(r),
  };
}

/** The piece and group half of `containerLineFromRow`. */
function linePieceFields(r: Row) {
  const pieces = linePieces(r);
  const counted = lineCounts(r);
  const stored = (key: keyof typeof counted): number => {
    const value = r[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : counted[key];
  };
  return {
    pieces,
    hasPieces: lineHasPieces(r),
    pieceCount: stored("pieceCount"),
    barrelPieces: stored("barrelPieces"),
    packagePieces: stored("packagePieces"),
    carPieces: stored("carPieces"),
    source: lineSourceOf(r.source),
    receivedAt: r.receivedAt ?? r.createdAt ?? null,
    rootLineId: groupRootId(r, r.id),
    partIndex: partIndexOf(r),
  };
}

function rowDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const v = value as { toDate?: () => Date; seconds?: number };
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "Oct 3" / "3 oct." — the day a box sailed, short enough for a sub-line. */
export function shortDayMonth(value: unknown, lang: "en" | "fr" = "en"): string {
  const date = rowDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", {
    day: "numeric",
    month: "short",
  }).format(date);
}

export type VinPlacement = {
  containerId: string;
  /** Number when known, else the working name. */
  title: string;
  status: ContainerStatus;
  sailedAt: unknown;
};

/**
 * Every VIN on a container that has not arrived, keyed by VIN. Built once
 * per render from the rows a panel already holds, so a parked-car row or a
 * ledger activity looks itself up in O(1) — never a query per row.
 */
export function buildVinPlacementIndex(
  lines: readonly unknown[],
  containers: readonly unknown[],
): Map<string, VinPlacement> {
  const byId = new Map<string, Row>();
  for (const container of Array.isArray(containers) ? containers : []) {
    const r = asRow(container);
    const id = text(r.id, MAX_LABEL);
    if (id) byId.set(id, r);
  }
  const index = new Map<string, VinPlacement>();
  for (const line of Array.isArray(lines) ? lines : []) {
    const r = asRow(line);
    if (text(r.kind, 20) !== "car") continue;
    const vin = cleanVin(r.vinNumber);
    if (!vin) continue;
    const container = byId.get(text(r.containerId, MAX_LABEL));
    if (!container) continue;
    const status = containerStatus(container);
    if (status === "arrived") continue;
    const placement: VinPlacement = {
      containerId: text(container.id, MAX_LABEL),
      title: containerTitle(container),
      status,
      sailedAt: container.sailedAt ?? null,
    };
    // A car on a shipped box outranks one still loading, should both exist.
    const existing = index.get(vin);
    if (!existing || (existing.status === "loading" && status === "shipped")) {
      index.set(vin, placement);
    }
  }
  return index;
}

/**
 * The cross-link under a car: "In MSKU1234567 · sailed Oct 3", or
 * "Loading in Box 2". Built in the reader's language here rather than by the
 * DOM translator because the container's name sits inside the sentence, and
 * a bare "In" is a dictionary key that would also rewrite the parking list's
 * "In" column header. Same approach as `destinationCountryName(id, lang)`.
 */
export function vinPlacementText(
  placement: VinPlacement | undefined,
  lang: "en" | "fr" = "en",
): string {
  if (!placement) return "";
  if (placement.status === "loading") {
    return lang === "fr"
      ? `En chargement dans ${placement.title}`
      : `Loading in ${placement.title}`;
  }
  const day = shortDayMonth(placement.sailedAt, lang);
  if (lang === "fr") {
    return `Dans ${placement.title}${day ? ` · parti le ${day}` : " · expédié"}`;
  }
  return `In ${placement.title}${day ? ` · sailed ${day}` : " · shipped"}`;
}

export type ContainerFilters = {
  /** "" for every state. */
  status: "" | ContainerStatus;
  /** A destinationCountryId, or "" for every destination. */
  destinationCountryId: string;
};

export function filterContainers(
  containers: readonly unknown[],
  filters: ContainerFilters,
): Row[] {
  return (Array.isArray(containers) ? containers : [])
    .map(asRow)
    .filter((row) => !filters.status || containerStatus(row) === filters.status)
    .filter(
      (row) =>
        !filters.destinationCountryId ||
        text(row.destinationCountryId, 60) === filters.destinationCountryId,
    );
}

export type ContainerLineHit = {
  line: Row;
  /** Undefined for a package still waiting (or one whose container is not loaded). */
  container: Row | undefined;
  /** Where it is: waiting, or the state of its container. */
  status: LineStage;
  sailedAt: unknown;
  /** True while the package has no container yet. */
  waiting: boolean;
};

/**
 * Lines matching a VIN, a tracking code, a customer's name or a phone number,
 * each with the container it sits on - or, for a package that has not been
 * loaded yet, a hit that says it is waiting. Two characters is enough to
 * start; digits match the phone with its punctuation ignored.
 */
export function searchContainerLines(
  lines: readonly unknown[],
  containers: readonly unknown[],
  query: string,
): ContainerLineHit[] {
  const q = text(query, 120).toLowerCase();
  if (q.length < 2) return [];
  const qVin = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const qDigits = q.replace(/\D+/g, "");
  const byId = new Map<string, Row>();
  for (const container of Array.isArray(containers) ? containers : []) {
    const r = asRow(container);
    if (text(r.id, MAX_LABEL)) byId.set(text(r.id, MAX_LABEL), r);
  }
  const hits: ContainerLineHit[] = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const r = asRow(line);
    const vin = cleanVin(r.vinNumber);
    const name = text(r.customerName, MAX_LABEL).toLowerCase();
    const phone = text(r.customerPhone, 40).replace(/\D+/g, "");
    // The receiver is who the port asks about ("is there anything for
    // Mariama Bah?"), so the search answers for that name too.
    const receiver = text(r.receiverName, MAX_LABEL).toLowerCase();
    const receiverPhone = text(r.receiverPhone, 40).replace(/\D+/g, "");
    // A customer calling about a shipment reads out the code on their label.
    const code = text(r.trackingCode, 40).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const matches =
      (qVin.length >= 4 && code.length > 0 && code.includes(qVin)) ||
      (qVin.length >= 2 && vin.includes(qVin)) ||
      (name && name.includes(q)) ||
      (receiver && receiver.includes(q)) ||
      (qDigits.length >= 3 && phone.includes(qDigits)) ||
      (qDigits.length >= 3 && receiverPhone.includes(qDigits));
    if (!matches) continue;
    const container = byId.get(text(r.containerId, MAX_LABEL));
    const waiting = !container && containerLineIsWaiting(r);
    hits.push({
      line: r,
      container,
      status: container
        ? containerStatus(container)
        : waiting
          ? WAITING_STATUS
          : containerStatus(r.containerStatus ? { status: r.containerStatus } : {}),
      sailedAt: container?.sailedAt ?? null,
      waiting,
    });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// What the server said, as the form should show it.
// ---------------------------------------------------------------------------

export type ContainerCallableFailure = {
  message: string;
  /** Set when the refusal was `vin_already_loaded` and the car is on a container. */
  conflictContainerId: string;
  /** Set when the car that is already held is a package waiting for a container (nothing to jump to). */
  conflictWaiting: boolean;
  /** Set when the refusal was `destination_mismatch`: the packages that do not fit. */
  offendingLineIds: string[];
};

/**
 * A callable's rejection, read for the sentence and the details that change
 * what the form offers: the container already holding the VIN, so the person
 * can jump to it instead of hunting for it, and the packages whose country
 * does not match the container's.
 */
export function containerCallableFailure(error: unknown): ContainerCallableFailure {
  // `runPanelAction` hands its onError the message it already read off the
  // error, not the error itself. Read as a row, a string is empty, and every
  // refusal used to collapse into "The change did not save."
  if (typeof error === "string") {
    return { message: text(error, 500) || "The change did not save.", conflictContainerId: "", conflictWaiting: false, offendingLineIds: [] };
  }
  const e = asRow(error);
  const details = asRow(e.details);
  const reason = text(details.reason, 40);
  const message =
    text(e.message, 500) ||
    (reason && reason in CONTAINER_MESSAGES
      ? CONTAINER_MESSAGES[reason as ContainerRefusal]
      : "") ||
    "The change did not save.";
  const rawIds = Array.isArray(details.lineIds) ? details.lineIds : details.lineId ? [details.lineId] : [];
  // A waiting holder is named "waiting" (no container id): say so, and offer no jump.
  const holder = reason === "vin_already_loaded" ? text(details.conflictContainerId, MAX_LABEL) : "";
  const conflictWaiting = holder === "waiting" || details.conflictWaiting === true;
  return {
    message,
    conflictContainerId: conflictWaiting ? "" : holder,
    conflictWaiting,
    offendingLineIds:
      reason === "destination_mismatch" ? rawIds.map((id) => text(id, MAX_LABEL)).filter(Boolean) : [],
  };
}
