// Month end as a table (design A, chosen by the owner 2026-11-12): one row
// per customer card, a search box, filters and a sort. Pure: the page passes
// the cards it already built (statementCards) and what it knows about each
// one's lots and WhatsApp invoice; nothing here reads or writes data.

import { cardOwes, cardPaid } from "./staff-statement.ts";
import type { ParkingMonthCustomer } from "./parking-month-statement.ts";

export type MonthTableView = "owing" | "paid" | "all";
export type MonthTableSort = "owed" | "name" | "cars";

export type MonthTableFilter = {
  view: MonthTableView;
  /** Only customers who paid part of what they owe. */
  part: boolean;
  /** Only team members' bills and statements. */
  team: boolean;
  /** Only customers with money unpaid from before the month. */
  older: boolean;
  /** Only customers whose WhatsApp invoice failed. */
  notDelivered: boolean;
  /** "" = every lot. */
  lotId: string;
  query: string;
  sort: MonthTableSort;
};

export const emptyMonthTableFilter: MonthTableFilter = {
  view: "owing", part: false, team: false, older: false, notDelivered: false, lotId: "", query: "", sort: "owed",
};

/** What the page knows about a card beyond the statement itself. */
export type MonthTableContext = {
  /** The lot ids the customer's cars stand in (main lot when none is set). */
  lotIdsOf: (card: ParkingMonthCustomer) => readonly string[];
  /** Their invoice for the month failed on WhatsApp. */
  invoiceFailed: (card: ParkingMonthCustomer) => boolean;
};

export type MonthRowStatus = "not_paid" | "part_paid" | "paid" | "team_owes" | "team_owed" | "team_settled" | "included";

export function isTeamCard(card: ParkingMonthCustomer): boolean {
  return Boolean(card.forStaffId || card.statementStaffId);
}

/** A customer's status pill. A team member's statement speaks for itself. */
export function monthRowStatus(card: ParkingMonthCustomer): MonthRowStatus {
  if (card.includedInStatementOf) return "included";
  if (card.statementOwesCents !== undefined) {
    if (card.statementOwesCents > 0) return "team_owes";
    if (card.statementOwesCents < 0) return "team_owed";
    return "team_settled";
  }
  if (!card.owes) return "paid";
  return card.monthPaidCents > 0 ? "part_paid" : "not_paid";
}

/** What the row's Due column shows: the statement's number for a team
 * member (negative when the business owes them), 0 for a bill that is in
 * someone's statement, else what is left on the bill. */
export function monthRowDueCents(card: ParkingMonthCustomer): number {
  if (card.includedInStatementOf) return 0;
  return card.statementOwesCents ?? card.dueCents;
}

/** Cars on the bill, this month's and older ones still owing. */
export function monthRowCarCount(card: ParkingMonthCustomer): number {
  return card.cars.length + card.olderCars.length;
}

function hasOlderDebt(card: ParkingMonthCustomer): boolean {
  return card.priorUnpaidCents > 0 || card.olderCars.length > 0 || card.olderActivities.some((a) => a.dueCents > 0);
}

function isPartPaid(card: ParkingMonthCustomer): boolean {
  return monthRowStatus(card) === "part_paid";
}

const digits = (value: string) => value.replace(/\D+/g, "");
const folded = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Whether a card matches the search box: name, phone (3+ digits, any
 * format), VIN or its last digits, the car, its tracking code. */
export function monthSearchMatches(card: ParkingMonthCustomer, query: string): boolean {
  const q = folded(query.trim());
  if (!q) return true;
  const qDigits = digits(q);
  if (qDigits.length >= 3 && qDigits.length === q.replace(/[\s()+.-]/g, "").length && digits(card.customerPhone).includes(qDigits)) return true;
  const cars = [...card.cars, ...card.olderCars];
  const haystack = [
    card.customerName,
    card.customerPhone,
    card.customerEmail,
    ...cars.flatMap((c) => [c.vehicle, c.vinNumber, c.trackingCode, c.registeredTo]),
    ...[...card.activities, ...card.olderActivities].flatMap((a) => [a.label, a.vehicle, a.vinNumber]),
  ].map((v) => folded(String(v ?? ""))).join(" \u0001 ");
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

function inView(card: ParkingMonthCustomer, view: MonthTableView): boolean {
  if (view === "owing") return cardOwes(card);
  if (view === "paid") return cardPaid(card);
  return true;
}

function passesChips(card: ParkingMonthCustomer, filter: MonthTableFilter, context: MonthTableContext): boolean {
  if (filter.part && !isPartPaid(card)) return false;
  if (filter.team && !isTeamCard(card)) return false;
  if (filter.older && !hasOlderDebt(card)) return false;
  if (filter.notDelivered && !context.invoiceFailed(card)) return false;
  if (filter.lotId && !context.lotIdsOf(card).includes(filter.lotId)) return false;
  return true;
}

function compare(sort: MonthTableSort) {
  const byName = (a: ParkingMonthCustomer, b: ParkingMonthCustomer) =>
    (a.customerName || a.customerPhone).localeCompare(b.customerName || b.customerPhone, undefined, { sensitivity: "base" });
  if (sort === "name") return byName;
  if (sort === "cars") return (a: ParkingMonthCustomer, b: ParkingMonthCustomer) => monthRowCarCount(b) - monthRowCarCount(a) || byName(a, b);
  return (a: ParkingMonthCustomer, b: ParkingMonthCustomer) => monthRowDueCents(b) - monthRowDueCents(a) || byName(a, b);
}

/** The rows on screen: the view, then every chip, the lot and the search, in the chosen order. */
export function monthTableRows(
  cards: readonly ParkingMonthCustomer[],
  filter: MonthTableFilter,
  context: MonthTableContext,
): ParkingMonthCustomer[] {
  return cards
    .filter((card) => inView(card, filter.view) && passesChips(card, filter, context) && monthSearchMatches(card, filter.query))
    .sort(compare(filter.sort));
}

export type MonthTableCounts = {
  owing: number;
  paid: number;
  all: number;
  part: number;
  team: number;
  older: number;
  notDelivered: number;
};

/** The numbers on the view buttons and chips: each within the view on
 * screen (chips) or across everyone (views), before the search. */
export function monthTableCounts(
  cards: readonly ParkingMonthCustomer[],
  view: MonthTableView,
  context: MonthTableContext,
): MonthTableCounts {
  const inThisView = cards.filter((c) => inView(c, view));
  return {
    owing: cards.filter(cardOwes).length,
    paid: cards.filter(cardPaid).length,
    all: cards.length,
    part: inThisView.filter(isPartPaid).length,
    team: inThisView.filter(isTeamCard).length,
    older: inThisView.filter(hasOlderDebt).length,
    notDelivered: inThisView.filter((c) => context.invoiceFailed(c)).length,
  };
}

/** Whether any chip, the lot or the search narrows the list. */
export function monthTableNarrowed(filter: MonthTableFilter): boolean {
  return filter.part || filter.team || filter.older || filter.notDelivered || filter.lotId !== "" || filter.query.trim() !== "";
}

export type InvoiceTally = { total: number; seen: number; waiting: number; failed: number };

/** The month's WhatsApp invoices, counted from each one's tick. */
export function invoiceTally(lines: Iterable<{ state: string; tick: string }>): InvoiceTally {
  const out: InvoiceTally = { total: 0, seen: 0, waiting: 0, failed: 0 };
  for (const line of lines) {
    if (line.state === "skipped") continue;
    out.total += 1;
    if (line.state === "failed" || line.state === "stopped") out.failed += 1;
    else if (line.tick === "double" || line.tick === "double-read") out.seen += 1;
    else out.waiting += 1;
  }
  return out;
}
