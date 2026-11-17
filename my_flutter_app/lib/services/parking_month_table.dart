/// Month end's customer list: the search box, the sort and the filter chips
/// (design A, chosen by the owner 2026-11-12). Pure: the screen hands in the
/// cards of the view on screen (Who owes / Paid / Everyone) and what it knows
/// about each one's WhatsApp invoice; nothing here reads or writes data.
///
/// A deliberate mirror of the console's `parking-month-table.ts` (minus the
/// lot filter, which is the lots feature's), so a search or a chip gives the
/// same list on the phone and on the website.
library;

import 'package:flutter/foundation.dart' show immutable;

import 'package_price_list.dart' show foldAccents;
import 'parking_month_statement.dart';

enum MonthTableSort { owed, name, cars }

/// The search, the sort and the chips. [empty] filters nothing.
@immutable
class MonthTableFilter {
  const MonthTableFilter({
    this.part = false,
    this.team = false,
    this.older = false,
    this.notDelivered = false,
    this.query = '',
    this.sort = MonthTableSort.owed,
  });

  /// Only customers who paid part of what they owe.
  final bool part;

  /// Only team members' bills and statements.
  final bool team;

  /// Only customers with money unpaid from before the month.
  final bool older;

  /// Only customers whose WhatsApp invoice failed.
  final bool notDelivered;
  final String query;
  final MonthTableSort sort;

  static const empty = MonthTableFilter();

  MonthTableFilter copyWith({
    bool? part,
    bool? team,
    bool? older,
    bool? notDelivered,
    String? query,
    MonthTableSort? sort,
  }) => MonthTableFilter(
    part: part ?? this.part,
    team: team ?? this.team,
    older: older ?? this.older,
    notDelivered: notDelivered ?? this.notDelivered,
    query: query ?? this.query,
    sort: sort ?? this.sort,
  );

  /// "Clear filters": every chip and the search off, the sort kept.
  MonthTableFilter cleared() => MonthTableFilter(sort: sort);

  /// Whether any chip or the search narrows the list.
  bool get narrowed =>
      part || team || older || notDelivered || query.trim().isNotEmpty;

  @override
  bool operator ==(Object other) =>
      other is MonthTableFilter &&
      other.part == part &&
      other.team == team &&
      other.older == older &&
      other.notDelivered == notDelivered &&
      other.query == query &&
      other.sort == sort;

  @override
  int get hashCode => Object.hash(part, team, older, notDelivered, query, sort);
}

/// A team member's bill or statement.
bool isTeamCard(ParkingMonthCustomer card) =>
    card.forStaffId.isNotEmpty || card.statementStaffId.isNotEmpty;

/// Part paid: owes, has paid something this month, and is not a team
/// statement (which speaks for itself) nor a bill inside one.
bool isPartPaidCard(ParkingMonthCustomer card) {
  if (card.includedInStatementOf.isNotEmpty) return false;
  if (card.statementOwesCents != null) return false;
  return card.owes && card.monthPaidCents > 0;
}

/// What the row owes: the statement's number for a team member (negative
/// when the business owes them), 0 for a bill inside a statement, else what
/// is left on the bill.
int monthRowDueCents(ParkingMonthCustomer card) {
  if (card.includedInStatementOf.isNotEmpty) return 0;
  return card.statementOwesCents ?? card.dueCents;
}

/// Cars on the bill: this month's and older ones still owing.
int monthRowCarCount(ParkingMonthCustomer card) =>
    card.cars.length + card.olderCars.length;

/// Money unpaid from before the month.
bool hasOlderDebt(ParkingMonthCustomer card) =>
    card.priorUnpaidCents > 0 ||
    card.olderCars.isNotEmpty ||
    card.olderActivities.any((a) => a.dueCents > 0);

String _digits(String value) => value.replaceAll(RegExp(r'\D+'), '');

/// Whether a card matches the search box: name, phone (3+ digits, any
/// format), VIN or its last digits, the car, its tracking code, whom a car is
/// registered to. Every word typed must be found.
bool monthSearchMatches(ParkingMonthCustomer card, String query) {
  final q = foldAccents(query.trim());
  if (q.isEmpty) return true;
  final qDigits = _digits(q);
  if (qDigits.length >= 3 &&
      qDigits.length == q.replaceAll(RegExp(r'[\s()+.\-]'), '').length &&
      _digits(card.customerPhone).contains(qDigits)) {
    return true;
  }
  final haystack = [
    card.customerName,
    card.customerPhone,
    card.customerEmail,
    for (final c in card.cars) ...[c.vehicle, c.vinNumber, c.trackingCode],
    for (final c in card.olderCars) ...[c.vehicle, c.vinNumber, c.trackingCode],
    ...card.registeredTo,
    ...card.olderCarsRegisteredTo,
    for (final a in card.activities) ...[a.label, a.vehicle, a.vinNumber],
    for (final a in card.olderActivities) ...[a.label, a.vehicle, a.vinNumber],
  ].map(foldAccents).join(' \u0001 ');
  return q.split(RegExp(r'\s+')).every(haystack.contains);
}

/// What the screen knows about a card beyond the statement itself.
@immutable
class MonthTableContext {
  const MonthTableContext({this.invoiceFailed = _never});

  /// Their invoice for the month failed on WhatsApp.
  final bool Function(ParkingMonthCustomer card) invoiceFailed;

  static bool _never(ParkingMonthCustomer _) => false;
}

bool _passesChips(
  ParkingMonthCustomer card,
  MonthTableFilter filter,
  MonthTableContext context,
) {
  if (filter.part && !isPartPaidCard(card)) return false;
  if (filter.team && !isTeamCard(card)) return false;
  if (filter.older && !hasOlderDebt(card)) return false;
  if (filter.notDelivered && !context.invoiceFailed(card)) return false;
  return true;
}

String _nameOf(ParkingMonthCustomer c) =>
    c.customerName.isNotEmpty ? c.customerName : c.customerPhone;

int _byName(ParkingMonthCustomer a, ParkingMonthCustomer b) {
  final c = foldAccents(_nameOf(a)).compareTo(foldAccents(_nameOf(b)));
  return c != 0 ? c : _nameOf(a).compareTo(_nameOf(b));
}

/// The rows on screen: [cards] (already the view on screen), then every chip
/// and the search, in the chosen order. A stable sort: ties keep the
/// statement's order after the name.
List<ParkingMonthCustomer> monthTableRows(
  Iterable<ParkingMonthCustomer> cards,
  MonthTableFilter filter, [
  MonthTableContext context = const MonthTableContext(),
]) {
  final rows = [
    for (final card in cards)
      if (_passesChips(card, filter, context) &&
          monthSearchMatches(card, filter.query))
        card,
  ];
  final indexed = [for (var i = 0; i < rows.length; i++) (i, rows[i])];
  int Function(ParkingMonthCustomer, ParkingMonthCustomer) compare =
      switch (filter.sort) {
        MonthTableSort.name => _byName,
        MonthTableSort.cars => (a, b) {
          final c = monthRowCarCount(b).compareTo(monthRowCarCount(a));
          return c != 0 ? c : _byName(a, b);
        },
        MonthTableSort.owed => (a, b) {
          final c = monthRowDueCents(b).compareTo(monthRowDueCents(a));
          return c != 0 ? c : _byName(a, b);
        },
      };
  indexed.sort((a, b) {
    final c = compare(a.$2, b.$2);
    return c != 0 ? c : a.$1.compareTo(b.$1);
  });
  return [for (final x in indexed) x.$2];
}

/// The numbers on the chips, each within the view on screen, before the
/// search.
@immutable
class MonthTableCounts {
  const MonthTableCounts({
    required this.part,
    required this.team,
    required this.older,
    required this.notDelivered,
  });

  final int part;
  final int team;
  final int older;
  final int notDelivered;
}

MonthTableCounts monthTableCounts(
  Iterable<ParkingMonthCustomer> cardsInView, [
  MonthTableContext context = const MonthTableContext(),
]) {
  final cards = cardsInView.toList();
  return MonthTableCounts(
    part: cards.where(isPartPaidCard).length,
    team: cards.where(isTeamCard).length,
    older: cards.where(hasOlderDebt).length,
    notDelivered: cards.where(context.invoiceFailed).length,
  );
}
