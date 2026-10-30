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
  editKeepsLegacyForm,
  editedLinePayload,
  lineDraftHasPieces,
  lineShipModeOf,
  searchContainerLines,
  shipModeMismatch,
  shipModeMismatchMessage,
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
import {
  groupRootId,
  lineCounts,
  lineGroupSummary,
  lineHasPieces,
  nextPartIndex,
  paidFloorForLine,
  partIndexOf,
  partTrackingCode,
  splitPieces,
  type LineGroupSummary,
} from "./line-pieces.ts";
import { readMoneyInput } from "./money-input.ts";
import { BUSINESS_ACCOUNT_RECEIVER } from "./staff-balances.ts";
import {
  newPieceDraft,
  parseInches,
  piecesCountText,
  piecesDraftTotalCents,
  readPickupFeeInput,
  type PieceDraft,
} from "./piece-drafts.ts";
import { bankCheckFrom, type BankCheck } from "./zelle-check.ts";

export { parseInches };

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

export type AssignmentRefusal = "container_destination_required" | "destination_mismatch" | "ship_mode_mismatch";

/**
 * Whether a container may take a waiting package - the server's rule
 * (`destinationMismatch`), so the list can disable the row instead of letting
 * a click be refused. A package that names no country (a line from before the
 * field existed) rides anywhere; one that does needs a container that has
 * decided where it goes, and it is a hard block when the two differ.
 */
export function assignmentRefusal(line: unknown, container: unknown): AssignmentRefusal | null {
  const wanted = text(asRow(line).destinationCountryId, 60);
  if (wanted) {
    const going = text(asRow(container).destinationCountryId, 60);
    if (!going) return "container_destination_required";
    if (going !== wanted) return "destination_mismatch";
  }
  // "Ships by": a package marked to fly goes on a flight, one for sea on a
  // sea container (the server's `shipModeMismatch`, a hard block too).
  return shipModeMismatch(line, container);
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
  if (refusal === "ship_mode_mismatch") return shipModeMismatchMessage(lineShipModeOf(line));
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

/**
 * The `assignContainerLines` request. Duplicates dropped; the caller checks
 * the count first. `going` is how many of each line's pieces go in, from the
 * split stepper: only a line sending fewer than all of them is named in
 * `pieceCounts` (docs/WAITING_PACKAGES.md "Split across containers"), so a
 * plain add is the request it always was.
 */
export function assignLinesRequest(
  businessId: string,
  containerId: string,
  lineIds: readonly string[],
  going: Readonly<Record<string, number>> = {},
  lines: readonly unknown[] = [],
) {
  const ids = [...new Set(lineIds.map((id) => text(id, 200)).filter(Boolean))];
  const byId = new Map((Array.isArray(lines) ? lines : []).map(asRow).map((row) => [text(row.id, 200), row]));
  const pieceCounts: Record<string, number> = {};
  for (const id of ids) {
    const row = byId.get(id);
    const n = going[id];
    if (!row || n === undefined) continue;
    const total = splittablePieceCount(row);
    if (total > 1 && Number.isInteger(n) && n >= 1 && n < total) pieceCounts[id] = n;
  }
  return {
    businessId: text(businessId, 200),
    containerId: text(containerId, 200),
    lineIds: ids,
    ...(Object.keys(pieceCounts).length ? { pieceCounts } : {}),
  };
}

// ---------------------------------------------------------------------------
// Splitting a package across containers.
// ---------------------------------------------------------------------------

/** How many pieces a waiting line could split: 0 for a car (never split), else its piece count. */
export function splittablePieceCount(line: unknown): number {
  const row = asRow(line);
  if (text(row.kind, 20) === "car") return 0;
  return lineCounts(row).pieceCount;
}

/** The stepper's value kept inside 1..m. */
export function clampPiecesGoing(value: number, total: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return total;
  return Math.min(Math.max(1, n), Math.max(1, total));
}

/** "Pieces going in: 2 of 4" / "Colis qui partent : 2 sur 4". */
export function piecesGoingText(going: number, total: number, lang: Lang = "en"): string {
  return lang === "fr" ? `Colis qui partent : ${going} sur ${total}` : `Pieces going in: ${going} of ${total}`;
}

export type SplitPreviewRow = { code: string; pieceCount: number; going: boolean; text: string };

/**
 * The code the part that stays would get: the root's code and one past the
 * group's highest part. Exact when the root is among `rows`; otherwise it is
 * read off the line's own code (the server's answer has the real one).
 */
export function previewPartCode(line: unknown, rows: readonly unknown[]): string {
  const row = asRow(line);
  const id = text(row.id, 200);
  const rootId = groupRootId(row, id);
  const all = (Array.isArray(rows) ? rows : []).map(asRow);
  const root = rootId === id ? row : all.find((r) => text(r.id, 200) === rootId);
  const group = all.filter((r) => groupRootId(r, r.id) === rootId);
  if (!group.some((r) => text(r.id, 200) === id)) group.push(row);
  const rootCode = root
    ? text(root.trackingCode, 40)
    : text(row.trackingCode, 40).replace(/-\d+$/, "");
  if (!rootCode) return "";
  return partTrackingCode(rootCode, nextPartIndex(root ?? {}, group));
}

/**
 * The two rows under a stepper: "CL-T9W2QA 2 pieces → this container" and
 * "CL-T9W2QA-2 2 pieces stay waiting". Nothing when every piece goes.
 */
export function splitPreviewRows(line: unknown, going: number, rows: readonly unknown[], lang: Lang = "en"): SplitPreviewRow[] {
  const row = asRow(line);
  const split = splitPieces(row, going);
  if (split.error || !split.split) return [];
  const code = text(row.trackingCode, 40);
  const partCode = previewPartCode(row, rows);
  const goes = split.going.length;
  const stays = split.staying.length;
  return [
    {
      code,
      pieceCount: goes,
      going: true,
      text: lang === "fr" ? `${piecesCountText(goes, lang)} → ce conteneur` : `${piecesCountText(goes, lang)} → this container`,
    },
    {
      code: partCode,
      pieceCount: stays,
      going: false,
      text: piecesStayText(stays, lang),
    },
  ];
}

export type AssignedPart = { lineId: string; partLineId: string; trackingCode: string; pieceCount: number };
export type AssignAnswer = { assigned: number; alreadyAssigned: number; parts: AssignedPart[] };

/** The `assignContainerLines` answer, read defensively (an older server sends no parts). */
export function assignAnswerFrom(data: unknown): AssignAnswer {
  const r = asRow(data);
  const count = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  const parts = (Array.isArray(r.parts) ? r.parts : [])
    .map(asRow)
    .map((part) => ({
      lineId: text(part.lineId, 200),
      partLineId: text(part.partLineId, 200),
      trackingCode: text(part.trackingCode, 40),
      pieceCount: count(part.pieceCount),
    }))
    .filter((part) => part.partLineId);
  return { assigned: count(r.assigned), alreadyAssigned: count(r.alreadyAssigned), parts };
}

/**
 * The parts that stay waiting, as the labels dialog asks for them: by line id,
 * with the code and count the answer gave until the live list catches up.
 */
export function partLabelStubs(parts: readonly AssignedPart[]): Row[] {
  return parts.map((part) => ({
    id: part.partLineId,
    trackingCode: part.trackingCode,
    containerId: "",
    containerStatus: "waiting",
    kind: "other",
    quantity: part.pieceCount,
    pieceCount: part.pieceCount,
  }));
}

/** "2 pieces stay waiting" / "2 colis restent en attente". */
export function piecesStayText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} colis ${count === 1 ? "reste" : "restent"} en attente`;
  return `${count} ${count === 1 ? "piece stays" : "pieces stay"} waiting`;
}

/** How many pieces a set of lines holds (one label each): the stored count, else what the line reads as. */
export function labelsPieceCount(lines: readonly unknown[]): number {
  let total = 0;
  for (const raw of Array.isArray(lines) ? lines : []) {
    const row = asRow(raw);
    const stored = Number(row.pieceCount);
    total += Number.isInteger(stored) && stored > 0 ? stored : lineCounts(row).pieceCount;
  }
  return total;
}

/** "Prints 6 labels: 3 pieces × 2" / "Imprime 6 étiquettes : 3 colis × 2". */
export function labelCountText(pieces: number, copies: number, lang: Lang = "en"): string {
  const labels = pieces * Math.max(1, copies);
  if (lang === "fr") {
    return `Imprime ${labels} ${labels === 1 ? "étiquette" : "étiquettes"} : ${piecesCountText(pieces, lang)} × ${copies}`;
  }
  return `Prints ${labels} ${labels === 1 ? "label" : "labels"}: ${piecesCountText(pieces, lang)} × ${copies}`;
}

/** "2 parts stay waiting with new codes." in the reader's language. */
export function partsCreatedText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") {
    return count === 1
      ? "1 partie reste en attente avec un nouveau code."
      : `${count} parties restent en attente avec de nouveaux codes.`;
  }
  return count === 1 ? "1 part stays waiting with a new code." : `${count} parts stay waiting with new codes.`;
}

// ---------------------------------------------------------------------------
// Group money: a line and the parts split from it share one balance, kept on
// the root (lineGroupSummary).
// ---------------------------------------------------------------------------

/**
 * Every group among the lines a panel already holds, keyed by root id, built
 * once per change of those lines (never per row). A group whose root is not
 * among them adds up what is there: its paid amount reads 0 until the root
 * is loaded.
 */
export function buildLineGroups(rows: readonly unknown[]): Map<string, LineGroupSummary> {
  const buckets = new Map<string, Array<{ id: string; line: Row }>>();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const line = asRow(raw);
    const id = text(line.id, 200);
    if (!id) continue;
    const root = groupRootId(line, id);
    const bucket = buckets.get(root);
    if (bucket) bucket.push({ id, line });
    else buckets.set(root, [{ id, line }]);
  }
  const groups = new Map<string, LineGroupSummary>();
  for (const [root, entries] of buckets) groups.set(root, lineGroupSummary(entries, root));
  return groups;
}

/** A line's group from the index, or its own one-line group when it is not in it. */
export function groupForLine(groups: ReadonlyMap<string, LineGroupSummary> | null | undefined, line: unknown): LineGroupSummary {
  const row = asRow(line);
  const id = text(row.id, 200);
  const root = groupRootId(row, id);
  return groups?.get(root) ?? lineGroupSummary([{ id, line: row }], root);
}

/** A group's money as the chips and the payment dialog read it (the same statuses as one package). */
export function groupPayment(group: LineGroupSummary): PackagePayment {
  const price = group.priceCents !== null && group.priceCents > 0 ? group.priceCents : null;
  const paid = Math.max(0, group.paidCents);
  const balance = price === null ? null : Math.max(0, price - paid);
  let status: PackagePaymentStatus;
  if (price !== null && paid >= price) status = "paid";
  else if (price !== null && paid > 0) status = "partial";
  else if (group.payOnArrival) status = "pay_on_arrival";
  else status = price === null ? "no_price" : "unpaid";
  return { status, priceCents: price, paidCents: paid, balanceCents: balance, payOnArrival: group.payOnArrival };
}

/** "Part 2 of 3" / "Partie 2 sur 3" for a line in a split group; "" for a line alone. */
export function partHintText(group: LineGroupSummary, line: unknown, lang: Lang = "en"): string {
  if (group.partCount <= 1) return "";
  const row = asRow(line);
  const id = text(row.id, 200);
  const at = group.parts.findIndex((part) => part.id === id);
  const index = at >= 0 ? at + 1 : partIndexOf(row);
  return lang === "fr" ? `Partie ${index} sur ${group.partCount}` : `Part ${index} of ${group.partCount}`;
}

/** "Group of 3 parts: $310.00" / "Groupe de 3 parties : 310,00 $" - what the balance is the balance of. */
export function groupMoneyNote(group: LineGroupSummary, lang: Lang = "en"): string {
  if (group.partCount <= 1) return "";
  const codes = group.parts.map((part) => part.trackingCode).filter(Boolean).join(", ");
  return lang === "fr"
    ? `Paiements partagés par les ${group.partCount} parties${codes ? ` (${codes})` : ""}`
    : `Payments shared by all ${group.partCount} parts${codes ? ` (${codes})` : ""}`;
}

/** What a price change on this line may not go below: what the root was paid less what the other parts cover. */
export function linePaidFloor(group: LineGroupSummary, line: unknown): number {
  return paidFloorForLine(group, text(asRow(line).id, 200));
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
  /** "car", or the pieces form ("barrels"/"other": a summary the server recomputes). */
  kind: ContainerLineKind;
  vinNumber: string;
  carMake: string;
  carModel: string;
  carYear: string;
  /** What a package that is not a car holds: one entry per barrel, box or thing handed over. */
  pieces: PieceDraft[];
  /** A collected request's pickup fee as typed, for a package that has one; null for any other (no field). */
  pickupFee: string | null;
  customerName: string;
  customerPhone: string;
  receiverName: string;
  receiverPhone: string;
  notifyCustomer: boolean;
  notifyReceiver: boolean;
  /** "Sender is the receiver": the sender fields hidden, the receiver stored as both. */
  senderIsReceiver: boolean;
  destinationCountryId: string;
  destinationCountryName: string;
  /** A car's size in inches as typed (each piece has its own). */
  lengthIn: string;
  widthIn: string;
  heightIn: string;
  /** A car's price in US dollars as typed; blank is "no price yet". Pieces are priced one by one. */
  price: string;
  payOnArrival: boolean;
  /** Money taken at the counter as it is dropped off; per package, never carried to the next. */
  money: IntakeMoneyDraft;
};

/**
 * "Money received now?": the switch, and when it is on, the same fields a
 * later payment asks for. Sent with the package as `payment`, judged by the
 * server with the same rules as `recordContainerLinePayment`.
 */
export type IntakeMoneyDraft = PackagePaymentDraft & { received: boolean };

/** The money section switched off and blank: no amount, nobody chosen. */
export function emptyIntakeMoney(): IntakeMoneyDraft {
  return { received: false, ...emptyPackagePaymentDraft };
}

/** A blank package, opened on the main destination when there is one. */
export function emptyWaitingPackageDraft(destination: DestinationRef | null = null): WaitingPackageDraft {
  return {
    kind: "barrels",
    vinNumber: "",
    carMake: "",
    carModel: "",
    carYear: "",
    pieces: [newPieceDraft()],
    pickupFee: null,
    customerName: "",
    customerPhone: "",
    receiverName: "",
    receiverPhone: "",
    notifyCustomer: true,
    notifyReceiver: true,
    senderIsReceiver: false,
    destinationCountryId: destination?.id ?? "",
    destinationCountryName: destination?.name ?? "",
    lengthIn: "",
    widthIn: "",
    heightIn: "",
    price: "",
    payOnArrival: false,
    money: emptyIntakeMoney(),
  };
}

/**
 * "Save & add another": a customer's pieces for one receiver are one package
 * already, so the next one is for a different receiver or country. Only the
 * sender stays - name, phone and WhatsApp switch; the receiver, the pieces
 * and the money start over, on the business's main destination.
 */
export function nextPackageForSameSender(draft: WaitingPackageDraft, destination: DestinationRef | null = null): WaitingPackageDraft {
  // A sender who was the receiver stays the sender, now named in the sender
  // fields: the next package goes to someone else.
  const same = draft.senderIsReceiver;
  return {
    ...emptyWaitingPackageDraft(destination),
    customerName: same ? draft.receiverName : draft.customerName,
    customerPhone: same ? draft.receiverPhone : draft.customerPhone,
    notifyCustomer: same ? draft.notifyReceiver : draft.notifyCustomer,
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
    pieces: base.pieces,
    pickupFee: base.pickupFee,
    customerName: base.customerName,
    customerPhone: base.customerPhone,
    receiverName: base.receiverName,
    receiverPhone: base.receiverPhone,
    notifyCustomer: base.notifyCustomer,
    notifyReceiver: base.notifyReceiver,
    senderIsReceiver: base.senderIsReceiver,
    destinationCountryId: line.destinationCountryId,
    destinationCountryName: line.destinationCountryName,
    // A car's own size and price; a package's are on its pieces.
    lengthIn: base.kind !== "car" || line.lengthIn === null ? "" : trimNumber(line.lengthIn),
    widthIn: base.kind !== "car" || line.widthIn === null ? "" : trimNumber(line.widthIn),
    heightIn: base.kind !== "car" || line.heightIn === null ? "" : trimNumber(line.heightIn),
    price: base.kind === "car" && line.priceCents !== null && line.priceCents > 0 ? centsToInput(line.priceCents) : "",
    payOnArrival: line.payOnArrival,
    // Money on a saved package goes through "Record a payment", never the edit form.
    money: emptyIntakeMoney(),
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
    quantity: "",
    description: "",
    pieces: draft.pieces,
    pickupFee: draft.pickupFee ?? null,
    // A waiting package is always a customer's: stock has no counter drop-off.
    ownerKind: "customer",
    customerName: draft.customerName,
    customerPhone: draft.customerPhone,
    receiverName: draft.receiverName,
    receiverPhone: draft.receiverPhone,
    notifyCustomer: draft.notifyCustomer,
    notifyReceiver: draft.notifyReceiver,
    senderIsReceiver: draft.senderIsReceiver === true,
  };
}

export type WaitingPackageError =
  | ContainerLineError
  | "package_destination_required"
  | "size_invalid"
  | "price_invalid"
  | IntakeMoneyError;

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

/**
 * Every problem at once: the manifest's line checks, then the waiting
 * package's own, then the money taken at drop-off (when the switch is on).
 * `staffIds` is the business's people the "Received by" select offers.
 */
export function validateWaitingPackage(
  draft: WaitingPackageDraft,
  staffIds?: readonly string[],
  original?: unknown,
): WaitingPackageError[] {
  // `original`: the stored package when the form edits one (an old package
  // with no receiver is only asked for one when its people change).
  const errors: WaitingPackageError[] = validateContainerLineDraft(lineDraftOf(draft), original);
  if (!text(draft.destinationCountryId, 60)) errors.push("package_destination_required");
  if (!lineDraftHasPieces(draft)) {
    // A car's own size and price; pieces carry theirs (checked above).
    const { error: sizeError } = readSides(draft);
    if (sizeError) errors.push(sizeError);
    const { error: priceError } = readPackagePrice(draft.price);
    if (priceError) errors.push(priceError);
  }
  errors.push(...validateIntakeMoney(draft, staffIds));
  return errors;
}

/**
 * What the package costs in all, as the form has it: a car's price, or the
 * sum of the priced pieces plus the package's own pickup fee when it has one
 * (the server's rule, `lineTotalCents`). Null while nothing is priced or a
 * typed price cannot be read.
 */
export function waitingDraftTotalCents(draft: Pick<WaitingPackageDraft, "kind" | "price" | "pieces"> & { pickupFee?: string | null }): number | null {
  if (!lineDraftHasPieces(draft)) return readPackagePrice(draft.price).cents;
  const fee = draft.pickupFee === null || draft.pickupFee === undefined ? 0 : readPickupFeeInput(draft.pickupFee).cents;
  return piecesDraftTotalCents(draft.pieces ?? [], fee);
}

/** How many labels the package prints: one per piece, one for a car. */
export function waitingDraftLabelCount(draft: Pick<WaitingPackageDraft, "kind" | "pieces">): number {
  return lineDraftHasPieces(draft) ? Math.max(1, (draft.pieces ?? []).length) : 1;
}

// ---------------------------------------------------------------------------
// "Money received now?" - a payment taken as the package is registered.
// ---------------------------------------------------------------------------

export type IntakeMoneyError = PackagePaymentError | "received_by_invalid";

/** The switch can only be turned on once there is a total to judge a payment against. */
export function intakeMoneyAvailable(draft: Pick<WaitingPackageDraft, "kind" | "price" | "pieces">): boolean {
  return waitingDraftTotalCents(draft) !== null;
}

/**
 * Turning the money section on opens it on the full price (editable), cash,
 * and nobody chosen - who took it must be picked, as for any payment.
 * Turning it off forgets what was typed.
 */
export function switchIntakeMoney(draft: WaitingPackageDraft, on: boolean): WaitingPackageDraft {
  if (!on) return { ...draft, money: emptyIntakeMoney() };
  const cents = waitingDraftTotalCents(draft);
  if (cents === null) return draft;
  return { ...draft, money: { ...emptyIntakeMoney(), received: true, amount: centsToInput(cents) } };
}

/**
 * The server's checks for money at drop-off, before the round trip: the
 * payment validator's, against the price in the same form and nothing paid
 * yet, and the person who took it must be one of the business's people.
 */
export function validateIntakeMoney(draft: WaitingPackageDraft, staffIds?: readonly string[]): IntakeMoneyError[] {
  const money = draft.money;
  if (!money?.received) return [];
  // Judged against the total: a car's price or the pieces' sum.
  const cents = waitingDraftTotalCents(draft);
  const errors: IntakeMoneyError[] = validatePackagePaymentDraft(money, {
    status: cents === null ? "no_price" : "unpaid",
    priceCents: cents,
    paidCents: 0,
    balanceCents: cents,
    payOnArrival: draft.payOnArrival === true,
  });
  const who = text(money.receivedByStaffId, 120);
  // The Business account is a receiver too (docs/STAFF_BALANCES.md), though no person.
  if (who && who !== BUSINESS_ACCOUNT_RECEIVER && staffIds && !staffIds.includes(who)) errors.push("received_by_invalid");
  return errors;
}

/** The `payment` half of the `addWaitingPackage` request, or null when no money was received. */
export function intakePaymentPayload(draft: WaitingPackageDraft) {
  const money = draft.money;
  if (!money?.received) return null;
  const note = text(money.note, MAX_NOTE);
  return {
    amountCents: readMoneyInput(money.amount).cents ?? 0,
    method: text(money.method, 40),
    receivedByStaffId: text(money.receivedByStaffId, 120),
    ...(note ? { note } : {}),
  };
}

/** The refusals as one sentence per problem, the way the form shows them (the server's sentences). */
export function waitingPackageMessage(codes: readonly WaitingPackageError[]): string {
  return containerMessage(codes);
}

/**
 * The register form's field for each refusal, as the element id it renders,
 * listed in the order the fields appear on screen. A failed save brings the
 * first one into view and focuses it: the modal scrolls, and a message at its
 * top is off-screen by the time the person reaches Save.
 */
export const WAITING_PACKAGE_FIELD_ORDER = [
  "wpk-vin",
  "wpk-pieces",
  "wpk-length",
  "wpk-destination",
  "wpk-price",
  "wpk-money-amount",
  "wpk-money-method",
  "wpk-received-by",
  "wpk-customer-name",
  "wpk-customer-phone",
  "wpk-receiver-name",
  "wpk-receiver-phone",
] as const;

export type WaitingPackageField = (typeof WAITING_PACKAGE_FIELD_ORDER)[number];

const WAITING_PACKAGE_ERROR_FIELD: Partial<Record<WaitingPackageError, WaitingPackageField>> = {
  vin_required: "wpk-vin",
  pieces_required: "wpk-pieces",
  pieces_too_many: "wpk-pieces",
  piece_kind_invalid: "wpk-pieces",
  piece_description_required: "wpk-pieces",
  piece_description_too_long: "wpk-pieces",
  piece_size_invalid: "wpk-pieces",
  piece_price_invalid: "wpk-pieces",
  size_invalid: "wpk-length",
  package_destination_required: "wpk-destination",
  price_invalid: "wpk-price",
  price_required: "wpk-price",
  amount_required: "wpk-money-amount",
  amount_too_large: "wpk-money-amount",
  payment_exceeds_balance: "wpk-money-amount",
  payment_method_invalid: "wpk-money-method",
  received_by_required: "wpk-received-by",
  received_by_invalid: "wpk-received-by",
  customer_name_required: "wpk-customer-name",
  customer_phone_invalid: "wpk-customer-phone",
  receiver_name_required: "wpk-receiver-name",
  receiver_phone_invalid: "wpk-receiver-phone",
};

/** The field a refusal belongs to, or null for one with no field (e.g. a bad kind). */
export function waitingPackageErrorField(code: WaitingPackageError): WaitingPackageField | null {
  return WAITING_PACKAGE_ERROR_FIELD[code] ?? null;
}

/** The first field on screen with a problem, or null when none of the refusals has a field. */
export function firstInvalidWaitingPackageField(codes: readonly WaitingPackageError[]): WaitingPackageField | null {
  const fields = new Set(codes.map(waitingPackageErrorField));
  return WAITING_PACKAGE_FIELD_ORDER.find((field) => fields.has(field)) ?? null;
}

/** The sentence shown under one field: only that field's refusals, or "" when it has none. */
export function waitingPackageFieldMessage(codes: readonly WaitingPackageError[], field: WaitingPackageField): string {
  const own = codes.filter((code) => waitingPackageErrorField(code) === field);
  return own.length ? containerMessage(own) : "";
}

/**
 * What a package carries beyond its line: country, pay on arrival, and - for
 * a car - its size and price. A package with pieces sends neither: the server
 * reads them off the pieces.
 */
function packageExtras(draft: WaitingPackageDraft, withPrice = true) {
  const car = !lineDraftHasPieces(draft);
  const { sides } = car ? readSides(draft) : { sides: null };
  const cents = car ? readPackagePrice(draft.price).cents : null;
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
  const payment = intakePaymentPayload(draft);
  return {
    businessId: text(businessId, 200),
    ...containerLinePayload(lineDraftOf(draft)),
    ...packageExtras(draft),
    // Only when money was received: without it the request is what it always was.
    ...(payment ? { payment } : {}),
  };
}

/**
 * The `updateContainerLine` request for an edited waiting package: no
 * container, and the package's own fields alongside the line's. A package's
 * pieces go with their prices (ids kept; the server checks them against what
 * was paid). A car's price goes through `setContainerLinePrice`, so it is
 * left out here. A legacy package whose pieces were not touched is sent in
 * its old form.
 */
export function updateWaitingPackageRequest(businessId: string, lineId: string, draft: WaitingPackageDraft, line: unknown = {}) {
  const row = { ...asRow(line), id: text(lineId, 200) };
  return {
    businessId: text(businessId, 200),
    lineId: text(lineId, 200),
    containerId: "",
    line: { ...editedLinePayload(row, lineDraftOf(draft)), ...packageExtras(draft, false) },
  };
}

/**
 * Whether saving an edit calls `setContainerLinePrice`: a car's price or the
 * pay-on-arrival switch changed. A package's piece prices travel in
 * `updateContainerLine`; here only the switch can make the call.
 */
export function packagePriceChanged(line: unknown, draft: WaitingPackageDraft): boolean {
  const before = packagePayment(line);
  const arrival = before.payOnArrival !== (draft.payOnArrival === true);
  if (lineDraftHasPieces(draft)) return arrival;
  const { cents } = readPackagePrice(draft.price);
  return before.priceCents !== cents || arrival;
}

/**
 * The `setContainerLinePrice` request an edit makes, or null when none is
 * needed. For a package with pieces it passes the new total unchanged (the
 * pieces already carry it), so the server only toggles pay on arrival - a
 * changed total there would be spread evenly over the pieces.
 */
export function editPriceRequest(businessId: string, lineId: string, line: unknown, draft: WaitingPackageDraft) {
  if (!packagePriceChanged(line, draft)) return null;
  if (!lineDraftHasPieces(draft)) return setPackagePriceRequest(businessId, lineId, draft.price, draft.payOnArrival);
  const legacy = editKeepsLegacyForm(line, lineDraftOf(draft));
  return {
    businessId: text(businessId, 200),
    lineId: text(lineId, 200),
    // A legacy package kept in its old form keeps its stored price.
    priceCents: legacy ? packagePayment(line).priceCents : waitingDraftTotalCents(draft),
    payOnArrival: draft.payOnArrival === true,
  };
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
  /** The staff member who took the money; blank until chosen, as for parking. */
  receivedByStaffId: string;
};

export const emptyPackagePaymentDraft: PackagePaymentDraft = { amount: "", method: "cash", note: "", receivedByStaffId: "" };

export type PackagePaymentError =
  | "price_required"
  | "amount_required"
  | "amount_too_large"
  | "payment_exceeds_balance"
  | "payment_method_invalid"
  | "received_by_required";

export function packagePaymentMessage(codes: readonly PackagePaymentError[]): string {
  return containerMessage(codes);
}

export function packagePriceMessage(codes: readonly PackagePriceError[]): string {
  return containerMessage(codes);
}

/** Same checks as the server's payment validator: a real amount, a known method, who took it, never above the balance. */
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
  if (!text(draft.receivedByStaffId, 120)) errors.push("received_by_required");
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
    receivedByStaffId: text(draft.receivedByStaffId, 120),
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
  /** Who held the money. */
  receivedByStaffId: string;
  /** Who typed it in; blank on older rows, which stored only the person who entered them as the receiver. */
  recordedByStaffId: string;
  revertedByStaffId: string;
  at: unknown;
  reverted: boolean;
  /** The Zelle bank check (server-written); null when never checked. */
  bankCheck: BankCheck | null;
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
      recordedByStaffId: text(row.recordedByStaffId, 200),
      revertedByStaffId: text(row.revertedByStaffId, 200),
      at: row.createdAt ?? null,
      reverted: row.reverted === true,
      bankCheck: bankCheckFrom(row.bankCheck),
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
  const line = containerLinePayload(lineDraftOf(draft));
  return {
    id: text(r.lineId, 200),
    trackingCode: text(r.trackingCode, 40),
    containerId: "",
    containerStatus: "waiting",
    ...line,
    // The counts the labels dialog adds up (one label per piece).
    ...lineCounts(line),
  };
}

/** Whether a stored line is described by its own pieces (not a car, not a legacy line). */
export function packageHasPieces(line: unknown): boolean {
  return lineHasPieces(line);
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
