/**
 * Loading lists, console side (docs/WAITING_PACKAGES.md "Loading lists").
 *
 * On a container that is still loading, the people loading it want three
 * answers: what went on lately and who put it there, what each customer has
 * on it, and what has not been scanned yet - plus, beside it, what is still
 * waiting to be loaded. This module is the pure half of that: the filters,
 * the grouping, the sorting and the counts, over the rows the panel already
 * reads (the container's lines and the business's waiting lines). Nothing here
 * imports Firebase or React; `container-loading-lists.test.ts` runs it
 * without a browser.
 *
 * Built on, not copied from: the customer is `lineCustomerName`, the search is
 * the waiting list's `filterWaitingPackages`, "can this waiting package go on
 * this container" is a destination match, a line's piece count is
 * `labelsPieceCount`.
 */

import { asDate } from "./format.ts";
import { containerLineTitle, containerLineIsStock, lineCustomerName, lineCustomerPhone } from "./container-manifest.ts";
import {
  filterWaitingPackages,
  labelsPieceCount,
} from "./waiting-packages.ts";

type Row = Record<string, unknown>;
type Lang = "en" | "fr";

const asRow = (value: unknown): Row => (value && typeof value === "object" ? (value as Row) : {});
const clean = (value: unknown, max = 200): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

// ---------------------------------------------------------------------------
// The filters.
// ---------------------------------------------------------------------------

export type LoadingFilter = "all" | "recent" | "customer" | "unscanned";

/** The chips, in order. English; the console translates the labels. */
export const LOADING_FILTERS: ReadonlyArray<{ id: LoadingFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "recent", label: "Recently added" },
  { id: "customer", label: "By customer" },
  { id: "unscanned", label: "Not scanned yet" },
];

/** "Not scanned yet" only means something while the container is loading. */
export function loadingFiltersFor(loading: boolean): ReadonlyArray<{ id: LoadingFilter; label: string }> {
  return loading ? LOADING_FILTERS : LOADING_FILTERS.filter((filter) => filter.id !== "unscanned");
}

/** How a package went on: by hand, by a scan, or moved from another container. */
export type AddedVia = "hand" | "scan" | "move" | "";

export function lineAddedVia(line: unknown): AddedVia {
  const via = clean(asRow(line).containerAssignedVia, 20);
  return via === "hand" || via === "scan" || via === "move" ? via : "";
}

/** When it went on, in milliseconds; 0 for a line put on before the field existed. */
export function lineAddedMs(line: unknown): number {
  const date = asDate(asRow(line).containerAssignedAt);
  const ms = date ? date.getTime() : 0;
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/** Who put it on (a staff id), or "". */
export function lineAddedBy(line: unknown): string {
  return clean(asRow(line).containerAssignedByStaffId, 200);
}

/** The pieces the package has (at least one). */
export function linePieceTotal(line: unknown): number {
  return Math.max(1, labelsPieceCount([line]));
}

/** The pieces scanned onto the container so far: 0 when absent, never more than the package has. */
export function lineScannedPieces(line: unknown): number {
  const n = Number(asRow(line).loadScannedPieces);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), linePieceTotal(line));
}

/** Not scanned yet: `loadScannedPieces` 0 or absent. */
export function lineNotScanned(line: unknown): boolean {
  const n = Number(asRow(line).loadScannedPieces);
  return !Number.isFinite(n) || n <= 0;
}

/** Newest first; lines without the field keep their order and go last. */
export function sortRecentlyAdded<T extends object>(lines: readonly T[]): T[] {
  const rows = Array.isArray(lines) ? [...lines] : [];
  const keyed = rows.map((row, index) => ({ row, index, ms: lineAddedMs(row) }));
  keyed.sort((a, b) => (b.ms - a.ms) || (a.index - b.index));
  return keyed.map((entry) => entry.row);
}

export type CustomerGroup<T extends object = Row> = {
  key: string;
  /** The customer's name; "" for business stock. */
  name: string;
  lines: T[];
  packages: number;
  pieces: number;
  scanned: number;
};

function customerKey(line: unknown): string {
  if (containerLineIsStock(line)) return "stock";
  const name = lineCustomerName(line).toLowerCase();
  if (name) return `n:${name}`;
  const phone = lineCustomerPhone(line).replace(/\D+/g, "");
  return phone ? `p:${phone}` : "none";
}

/**
 * Grouped by customer (sender, else receiver): alphabetical, business stock
 * and nameless lines last. Each group counts its packages, pieces and pieces
 * scanned.
 */
export function groupByCustomer<T extends object>(lines: readonly T[]): CustomerGroup<T>[] {
  const groups = new Map<string, CustomerGroup<T>>();
  for (const row of Array.isArray(lines) ? lines : []) {
    const key = customerKey(row);
    let group = groups.get(key);
    if (!group) {
      group = { key, name: key === "stock" ? "" : lineCustomerName(row), lines: [], packages: 0, pieces: 0, scanned: 0 };
      groups.set(key, group);
    }
    group.lines.push(row);
    group.packages += 1;
    group.pieces += linePieceTotal(row);
    group.scanned += lineScannedPieces(row);
  }
  const rank = (group: CustomerGroup<T>) => (group.key === "stock" ? 2 : group.name ? 0 : 1);
  return [...groups.values()].sort(
    (a, b) => (rank(a) - rank(b)) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export type LoadingView<T extends object = Row> = {
  /** One group with no header, or one group per customer. */
  groups: Array<{ key: string; group: CustomerGroup<T> | null; lines: T[] }>;
  /** Packages shown. */
  count: number;
};

/**
 * What the container page lists for one chip and one search. The search
 * (code, name, phone) narrows first; "All" keeps the order the lines came in.
 */
export function loadingView<T extends object>(lines: readonly T[], filter: LoadingFilter, query: string): LoadingView<T> {
  // filterWaitingPackages hands back the very rows it was given.
  const searched = filterWaitingPackages(lines, query) as unknown as T[];
  if (filter === "customer") {
    const groups = groupByCustomer(searched);
    return {
      groups: groups.map((group) => ({ key: group.key, group, lines: group.lines })),
      count: searched.length,
    };
  }
  let shown = searched;
  if (filter === "recent") shown = sortRecentlyAdded(searched);
  else if (filter === "unscanned") shown = searched.filter((row) => lineNotScanned(row));
  return { groups: [{ key: filter, group: null, lines: shown }], count: shown.length };
}

// ---------------------------------------------------------------------------
// Still to load.
// ---------------------------------------------------------------------------

export type StillToLoad<T extends object = Row> = {
  /** Whether the container has decided where it goes; without it nothing is listed. */
  hasDestination: boolean;
  /** Waiting packages going to the container's destination. */
  total: number;
  groups: CustomerGroup<T>[];
};

/**
 * The business's waiting packages whose destination is this container's
 * (`destinationCountryId` equal, as the server's `load_summary` and the app
 * count them), grouped by customer. A package with no destination is not
 * listed, and a container with no destination lists nothing.
 */
export function stillToLoad<T extends object>(waitingLines: readonly T[], container: unknown): StillToLoad<T> {
  const going = clean(asRow(container).destinationCountryId, 60);
  if (!going) return { hasDestination: false, total: 0, groups: [] };
  const fits = (Array.isArray(waitingLines) ? waitingLines : []).filter(
    (line) => clean(asRow(line).destinationCountryId, 60) === going,
  );
  return { hasDestination: true, total: fits.length, groups: groupByCustomer(fits) };
}

// ---------------------------------------------------------------------------
// Sentences. Built per language, because the names and numbers sit inside them.
// ---------------------------------------------------------------------------

/**
 * The strings the page lets the console's DOM translation read: each has its
 * French in french-dom.ts (the test says so). Everything else on the lists is
 * built per language below - "All", "Scanned" and "Moved" are too short and too
 * common for a dictionary entry, which also rewrites them inside longer text.
 */
export const LOADING_LIST_DOM_STRINGS: readonly string[] = [
  "Search code, name or phone",
  "Filter packages",
  "Take off",
  "Set this container's destination to see what's still waiting.",
  "Still to load",
  "Packages waiting for this container's destination. Add puts the whole package on the container.",
  "Nothing is waiting for this destination.",
  "Nothing matches that search.",
  "Every package has been scanned.",
];

/** A chip's label in the reader's language. */
export function filterLabel(id: LoadingFilter, lang: Lang = "en"): string {
  if (lang === "fr") {
    return id === "all" ? "Tous" : id === "recent" ? "Ajoutés récemment" : id === "customer" ? "Par client" : "Pas encore scannés";
  }
  return LOADING_FILTERS.find((filter) => filter.id === id)?.label ?? "";
}

export function packagesText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} colis`;
  return `${count} ${count === 1 ? "package" : "packages"}`;
}

function piecesWord(count: number, lang: Lang): string {
  if (lang === "fr") return count === 1 ? "pièce" : "pièces";
  return count === 1 ? "piece" : "pieces";
}

/** "Moussa Diallo · 3 packages · 4 of 7 pieces scanned". */
export function groupHeaderText(
  name: string,
  packages: number,
  scanned: number,
  pieces: number,
  lang: Lang = "en",
): string {
  const who = name || (lang === "fr" ? "Stock de l’entreprise" : "Business stock");
  if (lang === "fr") {
    return `${who} · ${packagesText(packages, lang)} · ${scanned} sur ${pieces} ${piecesWord(pieces, lang)} ${pieces === 1 ? "scannée" : "scannées"}`;
  }
  return `${who} · ${packagesText(packages, lang)} · ${scanned} of ${pieces} ${piecesWord(pieces, lang)} scanned`;
}

/** The "Still to load" group header: "Moussa Diallo · 2 packages". */
export function stillGroupHeaderText(name: string, packages: number, lang: Lang = "en"): string {
  const who = name || (lang === "fr" ? "Stock de l’entreprise" : "Business stock");
  return `${who} · ${packagesText(packages, lang)}`;
}

/** The header line: "12 still waiting for Guinea". */
export function stillWaitingText(count: number, destination: string, lang: Lang = "en"): string {
  const place = destination.trim();
  if (lang === "fr") return place ? `${count} encore en attente pour ${place}` : `${count} encore en attente`;
  return place ? `${count} still waiting for ${place}` : `${count} still waiting`;
}

/** A row's scan progress: "2 of 5 scanned", or that none is yet. */
export function scanProgressText(scanned: number, pieces: number, lang: Lang = "en"): string {
  if (scanned <= 0) return lang === "fr" ? "Pas encore scanné" : "Not scanned yet";
  // French agrees with how many were scanned: "1 sur 1 scannée", "2 sur 5 scannées".
  return lang === "fr" ?
    `${scanned} sur ${pieces} ${scanned === 1 ? "scannée" : "scannées"}` :
    `${scanned} of ${pieces} scanned`;
}

/** How it went on: "Scanned", "By hand", "Moved"; "Added earlier" for a line with no record. */
export function addedHowText(via: AddedVia, lang: Lang = "en"): string {
  if (lang === "fr") {
    return via === "scan" ? "Scanné" : via === "hand" ? "À la main" : via === "move" ? "Déplacé" : "Ajouté auparavant";
  }
  return via === "scan" ? "Scanned" : via === "hand" ? "By hand" : via === "move" ? "Moved" : "Added earlier";
}

/** "Take CL-K7M4P2 off Container 12? It goes back to waiting." */
export function takeOffConfirmText(line: unknown, containerLabel: string, lang: Lang = "en"): string {
  const code = clean(asRow(line).trackingCode, 40) || containerLineTitle(line, lang);
  return lang === "fr"
    ? `Retirer ${code} de ${containerLabel} ? Il retourne en attente.`
    : `Take ${code} off ${containerLabel}? It goes back to waiting.`;
}
