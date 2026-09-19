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

export const CONTAINER_STATUSES = ["loading", "shipped", "arrived"] as const;
export type ContainerStatus = (typeof CONTAINER_STATUSES)[number];

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
  | "vin_already_loaded"
  | "move_target_not_loading";

export const CONTAINER_MESSAGES: Record<ContainerRefusal, string> = {
  container_label_required: "Give the container a name to find it by.",
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
  vin_already_loaded:
    "This car is already on another container that hasn't arrived.",
  move_target_not_loading:
    "You can only move a line to a container that is still loading.",
};

export function containerMessage(codes: readonly ContainerRefusal[]): string {
  return codes.map((code) => CONTAINER_MESSAGES[code]).join(" ");
}

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
};

export const emptyContainerDraft: ContainerDraft = {
  label: "",
  containerNumber: "",
  bookingReference: "",
  destinationCountryId: "",
  destinationCountryName: "",
  notes: "",
};

export type ContainerError =
  | "container_label_required"
  | "container_number_invalid";

/** Same checks as the server's `validateContainer`, every problem at once. */
export function validateContainerDraft(draft: ContainerDraft): ContainerError[] {
  const errors: ContainerError[] = [];
  if (!text(draft.label, MAX_LABEL)) errors.push("container_label_required");
  const number = text(draft.containerNumber, 20).toUpperCase();
  if (number && !ISO_CONTAINER_NUMBER.test(number)) {
    errors.push("container_number_invalid");
  }
  return errors;
}

/** The fields a business may set, shaped as the server's `containerRecord`. */
export function containerPayload(draft: ContainerDraft) {
  return {
    label: text(draft.label, MAX_LABEL),
    containerNumber: text(draft.containerNumber, 20).toUpperCase(),
    bookingReference: text(draft.bookingReference, 60).toUpperCase(),
    destinationCountryId: text(draft.destinationCountryId, 60),
    destinationCountryName: text(draft.destinationCountryName, MAX_LABEL),
    notes: text(draft.notes, MAX_NOTE),
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
};

export type ContainerLineError =
  | "line_kind_invalid"
  | "vin_required"
  | "quantity_required"
  | "description_required"
  | "owner_kind_invalid"
  | "customer_name_required";

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
  } else if (kind === "barrels") {
    if (positiveInt(draft.quantity) <= 0) errors.push("quantity_required");
  } else if (kind === "other") {
    if (!text(draft.description, MAX_LABEL)) errors.push("description_required");
    if (positiveInt(draft.quantity) <= 0) errors.push("quantity_required");
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
  return errors;
}

/** The `line` body `addContainerLine` takes, shaped as the server stores it. */
export function containerLinePayload(draft: ContainerLineDraft) {
  const kind = text(draft.kind, 20);
  const owner = text(draft.ownerKind, 20);
  const isCar = kind === "car";
  const customer = owner === "customer";
  return {
    kind,
    vinNumber: isCar ? cleanVin(draft.vinNumber) : "",
    carMake: isCar ? text(draft.carMake, 80) : "",
    carModel: isCar ? text(draft.carModel, 80) : "",
    carYear: isCar ? text(draft.carYear, 8) : "",
    quantity: isCar ? 1 : Math.min(MAX_QUANTITY, positiveInt(draft.quantity)),
    description: kind === "other" ? text(draft.description, MAX_LABEL) : "",
    ownerKind: owner,
    customerName: customer ? text(draft.customerName, MAX_LABEL) : "",
    customerPhone: customer ? text(draft.customerPhone, 40) : "",
    // Either owner kind may name a receiver: stock goes to the business's
    // own agent at the port.
    receiverName: text(draft.receiverName, MAX_LABEL),
    receiverPhone: text(draft.receiverPhone, 40),
  };
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

/** Barrels count by quantity; cars and other by line. */
export function containerCounts(lines: readonly unknown[]): ContainerCounts {
  const out: ContainerCounts = { lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0 };
  for (const line of Array.isArray(lines) ? lines : []) {
    const row = asRow(line);
    out.lineCount += 1;
    const kind = text(row.kind, 20);
    if (kind === "car") out.carCount += 1;
    else if (kind === "barrels") out.barrelCount += positiveInt(row.quantity);
    else out.otherCount += positiveInt(row.quantity) || 1;
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
  return text(r.containerNumber, 20) || text(r.label, MAX_LABEL) || "Container";
}

/** "2019 Toyota Camry" / "12 barrels" / "3 × tires"; a car with no decode shows its VIN. */
export function containerLineTitle(line: unknown): string {
  const r = asRow(line);
  const kind = text(r.kind, 20);
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

export function containerLineIsStock(line: unknown): boolean {
  return text(asRow(line).ownerKind, 20) === "stock";
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

/** "3 Oct" / "3 oct." — the day a box sailed, short enough for a sub-line. */
export function shortDayMonth(value: unknown, lang: "en" | "fr" = "en"): string {
  const date = rowDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", {
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
 * The cross-link under a car: "In MSKU1234567 · sailed 3 Oct", or
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
  container: Row | undefined;
  status: ContainerStatus;
  sailedAt: unknown;
};

/**
 * Lines matching a VIN, a customer's name or a phone number, each with the
 * container it sits on. Two characters is enough to start; digits match the
 * phone with its punctuation ignored.
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
    const matches =
      (qVin.length >= 2 && vin.includes(qVin)) ||
      (name && name.includes(q)) ||
      (receiver && receiver.includes(q)) ||
      (qDigits.length >= 3 && phone.includes(qDigits)) ||
      (qDigits.length >= 3 && receiverPhone.includes(qDigits));
    if (!matches) continue;
    const container = byId.get(text(r.containerId, MAX_LABEL));
    hits.push({
      line: r,
      container,
      status: container ? containerStatus(container) : containerStatus(r.containerStatus ? { status: r.containerStatus } : {}),
      sailedAt: container?.sailedAt ?? null,
    });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// What the server said, as the form should show it.
// ---------------------------------------------------------------------------

export type ContainerCallableFailure = {
  message: string;
  /** Set when the refusal was `vin_already_loaded`. */
  conflictContainerId: string;
};

/**
 * A callable's rejection, read for the sentence and the one detail that
 * changes what the form offers: the container already holding the VIN, so
 * the person can jump to it instead of hunting for it.
 */
export function containerCallableFailure(error: unknown): ContainerCallableFailure {
  const e = asRow(error);
  const details = asRow(e.details);
  const reason = text(details.reason, 40);
  const message =
    text(e.message, 500) ||
    (reason && reason in CONTAINER_MESSAGES
      ? CONTAINER_MESSAGES[reason as ContainerRefusal]
      : "") ||
    "The change did not save.";
  return {
    message,
    conflictContainerId:
      reason === "vin_already_loaded" ? text(details.conflictContainerId, MAX_LABEL) : "",
  };
}
