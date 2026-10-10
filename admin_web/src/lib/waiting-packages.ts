/**
 * Waiting packages, console side - a box, barrel or car the customer drops
 * off before staff know which container it will go in.
 *
 * A waiting package is an ordinary container line (same collection, same
 * tracking code for life) with `containerId: ""` and `containerStatus:
 * "waiting"`, plus what a counter needs to take it in: the country it is for,
 * its size in inches, a price in US dollars and what has been paid on it. The
 * callables are the authority (`addWaitingPackage`, `assignContainerLines`,
 * `setContainerLinePrice`, `recordContainerLinePayment`...); this module is
 * the pure half the forms use so a bad entry is refused before it costs a
 * round trip, and so a row, a chip or a refusal reads as a sentence.
 *
 * Nothing here imports Firebase or React: `waiting-packages.test.ts` runs it
 * without a browser. Same shape as `container-manifest.ts`, which it builds on
 * rather than copying: the contact, kind and VIN rules are that module's.
 */

import {
  CONTAINER_MESSAGES,
  MAX_ASSIGN_LINES,
  cleanVin,
  containerCallableFailure,
  containerLineDraftFromRow,
  containerLineFromRow,
  containerLinePayload,
  containerMessage,
  searchContainerLines,
  validateContainerLineDraft,
  type ContainerCallableFailure,
  type ContainerLine,
  type ContainerLineDraft,
  type ContainerLineError,
  type ContainerLineKind,
} from "./container-manifest.ts";
import { shippingCountryDisplayName } from "./customer-shipping.ts";
import { destinationCountryName, destinationCountryOptionForRow } from "./destination-countries.ts";
import {
  INVOICE_PAYMENT_METHODS,
  INVOICE_PAYMENT_METHOD_LABELS,
  MAX_INVOICE_CENTS,
  centsToInput,
  type InvoicePaymentMethod,
} from "./invoice-ledger.ts";
import { readMoneyInput } from "./money-input.ts";

type Row = Record<string, unknown>;

const MAX_TEXT = 200;
const MAX_NOTE = 200;
/** A 40 ft container is 480 in long; anything over 600 is a typo (the server's cap). */
export const MAX_PACKAGE_INCHES = 600;
const CUBIC_INCHES_PER_CUBIC_FOOT = 1728;

function asRow(value: unknown): Row {
  return value && typeof value === "object" ? (value as Row) : {};
}

function text(value: unknown, max = MAX_TEXT): string {
  return String(value ?? "").trim().slice(0, max);
}

type Lang = "en" | "fr";

// ---------------------------------------------------------------------------
// Size: inches in, cubic feet out.
// ---------------------------------------------------------------------------

/**
 * One typed measurement as a number of inches: blank is null, anything that
 * is not a positive number below the cap is NaN (so the form can tell "not
 * filled in" from "filled in wrong"). A decimal comma is read as a point.
 */
export function parseInches(value: unknown): number | null {
  const raw = text(value, 20).replace(",", ".");
  if (!raw) return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) return Number.NaN;
  const n = Number(raw);
  return n > 0 && n <= MAX_PACKAGE_INCHES ? Math.round(n * 100) / 100 : Number.NaN;
}

/** Length x width x height in cubic feet (L*W*H / 1728), two decimals; null if any side is missing. */
export function volumeCubicFeet(lengthIn: unknown, widthIn: unknown, heightIn: unknown): number | null {
  const sides = [lengthIn, widthIn, heightIn].map((side) => Number(side));
  if (sides.some((side) => !Number.isFinite(side) || side <= 0)) return null;
  const cubicInches = sides[0] * sides[1] * sides[2];
  return Math.round((cubicInches / CUBIC_INCHES_PER_CUBIC_FOOT) * 100) / 100;
}

/** 12 -> "12", 12.5 -> "12.5": a measurement without trailing zeros. */
function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export type PackageSize = {
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  volumeCuFt: number;
  /** "40 x 30 x 20 in" */
  dimensionsText: string;
  /** "13.89 ft³" */
  volumeText: string;
};

/** The size a line carries, or null when any side is missing. */
export function packageSize(line: unknown): PackageSize | null {
  const l = containerLineFromRow(line);
  const volume = volumeCubicFeet(l.lengthIn, l.widthIn, l.heightIn);
  if (volume === null || l.lengthIn === null || l.widthIn === null || l.heightIn === null) return null;
  return {
    lengthIn: l.lengthIn,
    widthIn: l.widthIn,
    heightIn: l.heightIn,
    volumeCuFt: volume,
    dimensionsText: `${trimNumber(l.lengthIn)} × ${trimNumber(l.widthIn)} × ${trimNumber(l.heightIn)} in`,
    volumeText: `${trimNumber(volume)} ft³`,
  };
}

// ---------------------------------------------------------------------------
// Price and payments: integer cents end to end.
// ---------------------------------------------------------------------------

export type PackagePaymentStatus = "no_price" | "unpaid" | "partial" | "paid" | "pay_on_arrival";

export const PACKAGE_PAYMENT_LABELS: Record<PackagePaymentStatus, string> = {
  no_price: "No price yet",
  unpaid: "Unpaid",
  partial: "Partial",
  paid: "Paid",
  pay_on_arrival: "Pay on arrival",
};

/** The `status-pill` tone of each chip. */
export const PACKAGE_PAYMENT_TONES: Record<PackagePaymentStatus, string> = {
  no_price: "muted",
  unpaid: "warn",
  partial: "navy",
  paid: "ok",
  pay_on_arrival: "navy",
};

export type PackagePayment = {
  status: PackagePaymentStatus;
  /** Null until a price is set. */
  priceCents: number | null;
  paidCents: number;
  /** What is still owed; null while there is no price. */
  balanceCents: number | null;
  payOnArrival: boolean;
};

/**
 * Where a package stands on money. A price of zero is no price. Paid in full
 * wins over everything; a payment on account reads partial even when the rest
 * is due on arrival (the balance says what is left, and `payOnArrival` stays
 * true for the line that says when).
 */
export function packagePayment(line: unknown): PackagePayment {
  const l = containerLineFromRow(line);
  const price = l.priceCents !== null && l.priceCents > 0 ? l.priceCents : null;
  const paid = Math.max(0, l.paidCents);
  const balance = price === null ? null : Math.max(0, price - paid);
  let status: PackagePaymentStatus;
  if (price !== null && paid >= price) status = "paid";
  else if (price !== null && paid > 0) status = "partial";
  else if (l.payOnArrival) status = "pay_on_arrival";
  else status = price === null ? "no_price" : "unpaid";
  return { status, priceCents: price, paidCents: paid, balanceCents: balance, payOnArrival: l.payOnArrival };
}

// ---------------------------------------------------------------------------
// Where the package is going, and whether a container may take it.
// ---------------------------------------------------------------------------

export type DestinationRef = { id: string; name: string };

/**
 * A country as the reader sees it: its name in their language (from its ISO
 * code, as the shipping screens do, since the catalog has no French names).
 */
export function destinationPlace(id: unknown, name: unknown, lang: Lang = "en"): string {
  const option = destinationCountryOptionForRow({ id, name });
  if (option.code) return shippingCountryDisplayName({ code: option.code, name: option.name }, lang);
  if (option.id) return destinationCountryName(option.id, lang);
  return text(name, 120) || text(id, 60);
}

/**
 * The destination a new package opens with: the business's main destination,
 * else the first one it lists (by name, so the answer does not depend on the
 * order the rows arrived in). Null when it lists none, and the form asks.
 */
export function defaultWaitingDestination(rows: readonly unknown[]): DestinationRef | null {
  const list = (Array.isArray(rows) ? rows : []).map(asRow).filter((row) => text(row.id, 60));
  if (list.length === 0) return null;
  const named = list.map((row) => ({ row, name: destinationCountryOptionForRow(row).name }));
  named.sort((a, b) => a.name.localeCompare(b.name));
  const main = named.find((entry) => entry.row.isMain === true);
  const pick = main ?? named[0];
  return { id: text(pick.row.id, 60), name: pick.name };
}

/** The ids whose `isMain` flag must change so that exactly `id` is main. */
export function mainDestinationChanges(rows: readonly unknown[], id: string): Array<{ id: string; isMain: boolean }> {
  const target = text(id, 60);
  const changes: Array<{ id: string; isMain: boolean }> = [];
  for (const row of (Array.isArray(rows) ? rows : []).map(asRow)) {
    const rowId = text(row.id, 60);
    if (!rowId) continue;
    if (rowId === target) {
      if (row.isMain !== true) changes.push({ id: rowId, isMain: true });
    } else if (row.isMain === true) {
      changes.push({ id: rowId, isMain: false });
    }
  }
  return changes;
}

export type AssignmentRefusal = "container_destination_required" | "destination_mismatch";

/**
 * Whether a container may take a waiting package - the server's rule
 * (`destinationMismatch`), so the list can disable the row instead of letting
 * a click be refused. A package that names no country (a line from before the
 * field existed) rides anywhere; one that does needs a container that has
 * decided where it goes, and it is a hard block when the two differ.
 */
export function assignmentRefusal(line: unknown, container: unknown): AssignmentRefusal | null {
  const wanted = text(asRow(line).destinationCountryId, 60);
  if (!wanted) return null;
  const going = text(asRow(container).destinationCountryId, 60);
  if (!going) return "container_destination_required";
  return going === wanted ? null : "destination_mismatch";
}

/**
 * Why a row is disabled, in the reader's language: "For Senegal, this
 * container goes to Guinea." Built per language (the countries sit inside the
 * sentence), the way `vinPlacementText` is.
 */
export function assignmentBlockText(line: unknown, container: unknown, lang: Lang = "en"): string {
  const refusal = assignmentRefusal(line, container);
  if (!refusal) return "";
  if (refusal === "container_destination_required") return CONTAINER_MESSAGES.container_destination_required;
  const l = containerLineFromRow(line);
  const c = asRow(container);
  const from = destinationPlace(l.destinationCountryId, l.destinationCountryName, lang);
  const to = destinationPlace(c.destinationCountryId, c.destinationCountryName, lang);
  return lang === "fr"
    ? `Pour ${from} ; ce conteneur va vers ${to}.`
    : `For ${from}, this container goes to ${to}.`;
}

export type AssignableLine = { line: Row; id: string; refusal: AssignmentRefusal | null };

/** Every waiting package against one container, each with the reason it cannot go (or null). */
export function assignableLines(lines: readonly unknown[], container: unknown): AssignableLine[] {
  return (Array.isArray(lines) ? lines : []).map(asRow).map((line) => ({
    line,
    id: text(line.id, 200),
    refusal: assignmentRefusal(line, container),
  }));
}

/** The packages a search box narrows the list to; the whole list for a query under two characters. */
export function filterWaitingPackages(lines: readonly unknown[], query: string): Row[] {
  const list = (Array.isArray(lines) ? lines : []).map(asRow);
  if (text(query, 120).length < 2) return list;
  return searchContainerLines(list, [], query).map((hit) => hit.line);
}

/**
 * "Select all matching": the ids of every package the container can take
 * that the filter shows, added to what is already ticked, never past the
 * server's limit of one hundred a call.
 */
export function selectAllMatching(
  visible: readonly AssignableLine[],
  selected: readonly string[],
  limit = MAX_ASSIGN_LINES,
): string[] {
  const next = new Set(selected);
  for (const entry of visible) {
    if (entry.refusal || !entry.id) continue;
    if (next.size >= limit) break;
    next.add(entry.id);
  }
  return [...next];
}

/** The `assignContainerLines` request. Duplicates dropped; the caller checks the count first. */
export function assignLinesRequest(businessId: string, containerId: string, lineIds: readonly string[]) {
  return {
    businessId: text(businessId, 200),
    containerId: text(containerId, 200),
    lineIds: [...new Set(lineIds.map((id) => text(id, 200)).filter(Boolean))],
  };
}

/** Too many ticked for one call, as the form says it; null when the count is fine. */
export function assignSelectionRefusal(count: number): string | null {
  return count > MAX_ASSIGN_LINES ? CONTAINER_MESSAGES.line_ids_invalid : null;
}

/** "3 selected" / "3 sélectionnés": a count sentence in the reader's language. */
export function selectedCountText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} ${count === 1 ? "sélectionné" : "sélectionnés"}`;
  return `${count} selected`;
}

/** "5 packages waiting" / "5 colis en attente". */
export function waitingCountText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} colis en attente`;
  return `${count} ${count === 1 ? "package" : "packages"} waiting`;
}

/** "Added 3 packages to MSKU1234567." in the reader's language. */
export function assignedText(count: number, containerTitle: string, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} ${count === 1 ? "colis ajouté" : "colis ajoutés"} à ${containerTitle}.`;
  return `Added ${count} ${count === 1 ? "package" : "packages"} to ${containerTitle}.`;
}

// ---------------------------------------------------------------------------
// The register form.
// ---------------------------------------------------------------------------

export type WaitingPackageDraft = {
  kind: ContainerLineKind;
  vinNumber: string;
  carMake: string;
  carModel: string;
  carYear: string;
  /** As typed; cars always count one. */
  quantity: string;
  description: string;
  customerName: string;
  customerPhone: string;
  receiverName: string;
  receiverPhone: string;
  notifyCustomer: boolean;
  notifyReceiver: boolean;
  destinationCountryId: string;
  destinationCountryName: string;
  /** Inches as typed. */
  lengthIn: string;
  widthIn: string;
  heightIn: string;
  /** US dollars as typed; blank is "no price yet". */
  price: string;
  payOnArrival: boolean;
};

/** A blank package, opened on the main destination when there is one. */
export function emptyWaitingPackageDraft(destination: DestinationRef | null = null): WaitingPackageDraft {
  return {
    kind: "barrels",
    vinNumber: "",
    carMake: "",
    carModel: "",
    carYear: "",
    quantity: "1",
    description: "",
    customerName: "",
    customerPhone: "",
    receiverName: "",
    receiverPhone: "",
    notifyCustomer: true,
    notifyReceiver: true,
    destinationCountryId: destination?.id ?? "",
    destinationCountryName: destination?.name ?? "",
    lengthIn: "",
    widthIn: "",
    heightIn: "",
    price: "",
    payOnArrival: false,
  };
}

/**
 * "Add another for the same customer": the people, the country and the
 * WhatsApp switches stay; everything about the box itself (what it is, its
 * size, its price) starts over. The kind stays too - the next thing a
 * customer brings is usually another of the same.
 */
export function nextPackageForSameCustomer(draft: WaitingPackageDraft): WaitingPackageDraft {
  return {
    ...emptyWaitingPackageDraft({ id: draft.destinationCountryId, name: draft.destinationCountryName }),
    kind: draft.kind,
    customerName: draft.customerName,
    customerPhone: draft.customerPhone,
    receiverName: draft.receiverName,
    receiverPhone: draft.receiverPhone,
    notifyCustomer: draft.notifyCustomer,
    notifyReceiver: draft.notifyReceiver,
  };
}

/** A stored waiting package back into the form, so the same form edits it. */
export function waitingPackageDraftFromRow(row: unknown): WaitingPackageDraft {
  const line = containerLineFromRow(row);
  const base = containerLineDraftFromRow(row);
  return {
    kind: base.kind,
    vinNumber: base.vinNumber,
    carMake: base.carMake,
    carModel: base.carModel,
    carYear: base.carYear,
    quantity: base.kind === "car" ? "" : base.quantity,
    description: base.description,
    customerName: base.customerName,
    customerPhone: base.customerPhone,
    receiverName: base.receiverName,
    receiverPhone: base.receiverPhone,
    notifyCustomer: base.notifyCustomer,
    notifyReceiver: base.notifyReceiver,
    destinationCountryId: line.destinationCountryId,
    destinationCountryName: line.destinationCountryName,
    lengthIn: line.lengthIn === null ? "" : trimNumber(line.lengthIn),
    widthIn: line.widthIn === null ? "" : trimNumber(line.widthIn),
    heightIn: line.heightIn === null ? "" : trimNumber(line.heightIn),
    price: line.priceCents !== null && line.priceCents > 0 ? centsToInput(line.priceCents) : "",
    payOnArrival: line.payOnArrival,
  };
}

/** The part of the form the manifest already knows how to check and store. */
function lineDraftOf(draft: WaitingPackageDraft): ContainerLineDraft {
  return {
    kind: draft.kind,
    inLot: draft.kind === "car" ? "no" : "",
    parkedCarId: "",
    vinNumber: draft.vinNumber,
    carMake: draft.carMake,
    carModel: draft.carModel,
    carYear: draft.carYear,
    quantity: draft.quantity,
    description: draft.description,
    // A waiting package is always a customer's: stock has no counter drop-off.
    ownerKind: "customer",
    customerName: draft.customerName,
    customerPhone: draft.customerPhone,
    receiverName: draft.receiverName,
    receiverPhone: draft.receiverPhone,
    notifyCustomer: draft.notifyCustomer,
    notifyReceiver: draft.notifyReceiver,
  };
}

export type WaitingPackageError =
  | ContainerLineError
  | "package_destination_required"
  | "size_invalid"
  | "price_invalid";

/**
 * The price as cents: null for blank, NaN for unreadable, a refusal when it
 * is zero or negative. One reader (money-input.ts) so "45,50" means forty-five
 * dollars fifty here as on the phone.
 */
export function readPackagePrice(value: unknown): { cents: number | null; error: WaitingPackageError | null } {
  const read = readMoneyInput(value);
  if (read.issue === "empty") return { cents: null, error: null };
  if (read.cents === null || read.cents <= 0) return { cents: null, error: "price_invalid" };
  if (read.cents > MAX_INVOICE_CENTS) return { cents: null, error: "price_invalid" };
  return { cents: read.cents, error: null };
}

/** The three sides as numbers, or the reason they cannot be. */
function readSides(draft: Pick<WaitingPackageDraft, "lengthIn" | "widthIn" | "heightIn">) {
  const sides = [parseInches(draft.lengthIn), parseInches(draft.widthIn), parseInches(draft.heightIn)];
  if (sides.every((side) => side === null)) return { sides: null, error: null };
  // Two sides of a box are no size: all three, or none (the server's rule).
  if (sides.some((side) => side === null || Number.isNaN(side))) return { sides: null, error: "size_invalid" as const };
  return { sides: sides as [number, number, number], error: null };
}

/** Every problem at once: the manifest's line checks, then the waiting package's own. */
export function validateWaitingPackage(draft: WaitingPackageDraft): WaitingPackageError[] {
  const errors: WaitingPackageError[] = validateContainerLineDraft(lineDraftOf(draft));
  if (!text(draft.destinationCountryId, 60)) errors.push("package_destination_required");
  const { error: sizeError } = readSides(draft);
  if (sizeError) errors.push(sizeError);
  const { error: priceError } = readPackagePrice(draft.price);
  if (priceError) errors.push(priceError);
  return errors;
}

/** The refusals as one sentence per problem, the way the form shows them (the server's sentences). */
export function waitingPackageMessage(codes: readonly WaitingPackageError[]): string {
  return containerMessage(codes);
}

/** What a package carries beyond its line: country, size, price. Only what was entered. */
function packageExtras(draft: WaitingPackageDraft, withPrice = true) {
  const { sides } = readSides(draft);
  const { cents } = readPackagePrice(draft.price);
  return {
    destinationCountryId: text(draft.destinationCountryId, 60),
    destinationCountryName: text(draft.destinationCountryName, 120),
    ...(sides ? { lengthIn: sides[0], widthIn: sides[1], heightIn: sides[2] } : {}),
    ...(withPrice && cents !== null ? { priceCents: cents } : {}),
    payOnArrival: draft.payOnArrival === true,
  };
}

/** The `addWaitingPackage` request, shaped as the server stores it. */
export function addWaitingPackagePayload(businessId: string, draft: WaitingPackageDraft) {
  return {
    businessId: text(businessId, 200),
    ...containerLinePayload(lineDraftOf(draft)),
    ...packageExtras(draft),
  };
}

/**
 * The `updateContainerLine` request for an edited waiting package: no
 * container, and the package's own fields alongside the line's. The price
 * goes through `setContainerLinePrice` (it is audited and checked against
 * what has been paid), so it is left out here.
 */
export function updateWaitingPackageRequest(businessId: string, lineId: string, draft: WaitingPackageDraft) {
  return {
    businessId: text(businessId, 200),
    lineId: text(lineId, 200),
    containerId: "",
    line: { ...containerLinePayload(lineDraftOf(draft)), ...packageExtras(draft, false) },
  };
}

/** Whether saving an edit changes the price or the pay-on-arrival switch, so `setContainerLinePrice` is called. */
export function packagePriceChanged(line: unknown, draft: WaitingPackageDraft): boolean {
  const before = packagePayment(line);
  const { cents } = readPackagePrice(draft.price);
  return before.priceCents !== cents || before.payOnArrival !== (draft.payOnArrival === true);
}

// ---------------------------------------------------------------------------
// Setting the price.
// ---------------------------------------------------------------------------

export type PackagePriceError = "price_invalid" | "price_below_paid";

/** Same checks as the server's `setContainerLinePrice`: readable, sane, not below what is paid. */
export function validatePackagePrice(value: unknown, paidCents: number): PackagePriceError[] {
  const { cents, error } = readPackagePrice(value);
  if (error) return ["price_invalid"];
  // The server also refuses to take a price away once money has been paid.
  if ((cents ?? 0) < Math.max(0, Number(paidCents) || 0)) return ["price_below_paid"];
  return [];
}

/** The `setContainerLinePrice` request; a blank price clears it. */
export function setPackagePriceRequest(businessId: string, lineId: string, price: unknown, payOnArrival: boolean) {
  return {
    businessId: text(businessId, 200),
    lineId: text(lineId, 200),
    priceCents: readPackagePrice(price).cents,
    payOnArrival: payOnArrival === true,
  };
}

// ---------------------------------------------------------------------------
// Payments.
// ---------------------------------------------------------------------------

export type PackagePaymentDraft = {
  /** US dollars as typed. */
  amount: string;
  method: InvoicePaymentMethod;
  note: string;
};

export const emptyPackagePaymentDraft: PackagePaymentDraft = { amount: "", method: "cash", note: "" };

export type PackagePaymentError =
  | "price_required"
  | "amount_required"
  | "amount_too_large"
  | "payment_exceeds_balance"
  | "payment_method_invalid";

export function packagePaymentMessage(codes: readonly PackagePaymentError[]): string {
  return containerMessage(codes);
}

export function packagePriceMessage(codes: readonly PackagePriceError[]): string {
  return containerMessage(codes);
}

/** Same checks as the server's payment validator: a real amount, a known method, never above the balance. */
export function validatePackagePaymentDraft(draft: PackagePaymentDraft, payment: PackagePayment): PackagePaymentError[] {
  if (payment.balanceCents === null) return ["price_required"];
  const errors: PackagePaymentError[] = [];
  const read = readMoneyInput(draft.amount);
  const amount = read.cents;
  if (amount === null || amount <= 0) errors.push("amount_required");
  else if (amount > MAX_INVOICE_CENTS) errors.push("amount_too_large");
  else if (amount > payment.balanceCents) errors.push("payment_exceeds_balance");
  if (!(INVOICE_PAYMENT_METHODS as readonly string[]).includes(text(draft.method, 40))) {
    errors.push("payment_method_invalid");
  }
  return errors;
}

/** "Pay the whole balance": the amount field's text for what is left. */
export function wholeBalanceInput(payment: PackagePayment): string {
  return payment.balanceCents && payment.balanceCents > 0 ? centsToInput(payment.balanceCents) : "";
}

/** The `recordContainerLinePayment` request. */
export function recordPackagePaymentRequest(businessId: string, lineId: string, draft: PackagePaymentDraft) {
  return {
    businessId: text(businessId, 200),
    lineId: text(lineId, 200),
    amountCents: readMoneyInput(draft.amount).cents ?? 0,
    method: text(draft.method, 40),
    note: text(draft.note, MAX_NOTE),
  };
}

/** The `revertContainerLinePayment` request. */
export function revertPackagePaymentRequest(businessId: string, paymentId: string) {
  return { businessId: text(businessId, 200), paymentId: text(paymentId, 200) };
}

export function packageMethodLabel(method: unknown): string {
  const id = text(method, 40);
  return id in INVOICE_PAYMENT_METHOD_LABELS ? INVOICE_PAYMENT_METHOD_LABELS[id as InvoicePaymentMethod] : id;
}

export type PackagePaymentEntry = {
  id: string;
  amountCents: number;
  method: string;
  methodLabel: string;
  note: string;
  receivedByStaffId: string;
  revertedByStaffId: string;
  at: unknown;
  reverted: boolean;
};

function millis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime() || 0;
  const v = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.toDate === "function") return v.toDate().getTime();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  const parsed = new Date(String(value)).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** A package's payment rows, newest first, reverted ones kept (and marked) so the history is whole. */
export function packagePaymentEntries(rows: readonly unknown[]): PackagePaymentEntry[] {
  return (Array.isArray(rows) ? rows : [])
    .map(asRow)
    .map((row) => ({
      id: text(row.id, 200),
      amountCents: Math.max(0, Math.round(Number(row.amountCents)) || 0),
      method: text(row.method, 40),
      methodLabel: packageMethodLabel(row.method),
      note: text(row.note, MAX_NOTE),
      receivedByStaffId: text(row.receivedByStaffId, 200),
      revertedByStaffId: text(row.revertedByStaffId, 200),
      at: row.createdAt ?? null,
      reverted: row.reverted === true,
    }))
    .sort((a, b) => millis(b.at) - millis(a.at));
}

// ---------------------------------------------------------------------------
// The list.
// ---------------------------------------------------------------------------

/** Newest drop-off first. */
export function sortWaitingNewestFirst(rows: readonly unknown[]): Row[] {
  return (Array.isArray(rows) ? rows : [])
    .map(asRow)
    .sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
}

/** The package as one list row reads it, built once per render. */
export type WaitingPackageRow = {
  line: ContainerLine;
  size: PackageSize | null;
  payment: PackagePayment;
  vin: string;
};

export function waitingPackageRow(row: unknown): WaitingPackageRow {
  const line = containerLineFromRow(row);
  return { line, size: packageSize(row), payment: packagePayment(row), vin: cleanVin(line.vinNumber) };
}

/**
 * A package that was just saved, as the labels dialog needs it before the
 * live list has caught up: the server's id and code, and the draft's words.
 */
export function savedPackageStub(response: unknown, draft: WaitingPackageDraft): Row {
  const r = asRow(response);
  return {
    id: text(r.lineId, 200),
    trackingCode: text(r.trackingCode, 40),
    containerId: "",
    containerStatus: "waiting",
    ...containerLinePayload(lineDraftOf(draft)),
  };
}

// ---------------------------------------------------------------------------
// Calling the server.
// ---------------------------------------------------------------------------

/**
 * Runs one callable-backed action behind a busy flag and hands a failure
 * over already read: its sentence, and the details that change what the form
 * offers (which packages did not fit). `runPanelAction` passes its error
 * handler only the message string, which loses `details`, so the waiting
 * forms use this instead and keep the whole refusal.
 */
export async function runPackageCall(
  setBusy: (busy: boolean) => void,
  action: () => Promise<void>,
  onFailure: (failure: ContainerCallableFailure) => void,
): Promise<void> {
  setBusy(true);
  try {
    await action();
  } catch (error) {
    onFailure(containerCallableFailure(error));
  } finally {
    setBusy(false);
  }
}
