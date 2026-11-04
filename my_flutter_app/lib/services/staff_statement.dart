/// Staff statements for parking businesses (docs/PARKING_INVOICES.md §6).
///
/// A TEAM MEMBER (a person whose own cars are team cars - month-end customer
/// key `staff:{uid}` - and/or who is linked to a parking customer through
/// `staffParkingLinks`) gets ONE statement for the month, and Month end shows
/// the very same numbers as the WhatsApp statement:
///
///   parking + lot jobs of the month (plus anything unpaid from before)
///   - the lot expenses they paid that are not yet credited (cumulative to
///     the end of the month, so a September expense counts in October)
///   + the cash they hold for the business at the END of the month
///   = what they owe the business (negative: the business owes them)
///
/// Pure: no Firebase, no clock. An exact mirror of
/// `functions/staff_statement.js` and the console's `staff-statement.ts`;
/// `functions/test/fixtures/staff-statement-cases.json` is run by all three.
/// The cash itself comes from the server (`staff_statement_cash`): it needs
/// every payment and handover, not only the month's cars.
library;

import 'parking_month_statement.dart';
import 'staff_expense_credit.dart';

String _text(Object? v, [int max = 200]) {
  final t = (v ?? '').toString().trim();
  return t.length > max ? t.substring(0, max) : t;
}

/// One team member's statement for the month.
class StaffStatement {
  const StaffStatement({
    required this.staffId,
    required this.name,
    required this.key,
    required this.customerKeys,
    required this.monthKey,
    required this.parkingJobsCents,
    required this.expenseCents,
    required this.expenseLines,
    required this.earlierExpenseCents,
    required this.cashHeldCents,
    required this.owesCents,
    required this.stillParked,
    required this.customer,
  });

  final String staffId;
  final String name;

  /// The card that carries the statement (their own cars' card first).
  final String key;
  final List<String> customerKeys;
  final String monthKey;

  /// Parking and lot jobs: this month plus what was unpaid from before.
  final int parkingJobsCents;

  /// Their lot expenses not yet credited (all of them, to the month's end).
  final int expenseCents;
  final List<ParkingMonthExpenseLine> expenseLines;
  final int earlierExpenseCents;

  /// The cash they hold for the business at the month's end (signed).
  final int cashHeldCents;

  /// Parking and jobs - expenses + cash held. Negative: the business owes
  /// them.
  final int owesCents;
  final bool stillParked;

  /// All of the person's bills as one month-end customer, carrying the
  /// statement's money.
  final ParkingMonthCustomer customer;
}

/// The statements, and which month-end customers belong to one.
class StaffStatements {
  const StaffStatements({required this.statements, required this.customerKeys});

  final List<StaffStatement> statements;

  /// Every month-end customer key that belongs to a statement, to its staff
  /// id: those customers are NOT invoiced, and only the first of a member's
  /// bills carries the figures.
  final Map<String, String> customerKeys;
}

/// The team member a month-end customer is billed under: the member whose
/// own cars they are (`staff:{uid}`), or the ONE member linked to them. A
/// customer linked to several members stays a customer.
String statementMemberOf(ParkingMonthCustomer customer) {
  final key = _text(customer.key, 200);
  if (key.startsWith('staff:')) return key.substring(6);
  final ids = customer.linkedStaffIds.where((id) => id.isNotEmpty).toList();
  return ids.length == 1 ? _text(ids.first, 128) : '';
}

ParkingMonthCustomer _mergedBill(
  List<ParkingMonthCustomer> bills,
  String name,
  int cashHeldCents,
  int owesCents,
  String staffId,
  int expenseCents,
  List<ParkingMonthExpenseLine> expenseLines,
  int earlierCents,
) {
  final first = bills.first;
  int sum(int Function(ParkingMonthCustomer) f) =>
      bills.fold(0, (s, b) => s + f(b));
  List<T> all<T>(List<T> Function(ParkingMonthCustomer) f) => [
    for (final b in bills) ...f(b),
  ];
  final due = sum((b) => b.dueBeforeExpensesCents);
  final monthCents = sum((b) => b.monthCents);
  final phone = bills
      .map((b) => b.customerPhone)
      .firstWhere((p) => p.trim().isNotEmpty, orElse: () => '');
  return ParkingMonthCustomer(
    key: first.key,
    monthKey: first.monthKey,
    customerName: name.isNotEmpty ? name : first.customerName,
    customerPhone: phone,
    customerEmail: first.customerEmail,
    cars: all((b) => b.cars),
    registeredTo: all((b) => b.registeredTo),
    activities: all((b) => b.activities),
    olderActivities: all((b) => b.olderActivities),
    activityRegisteredTo: all((b) => b.activityRegisteredTo),
    olderRegisteredTo: all((b) => b.olderRegisteredTo),
    monthCents: monthCents,
    monthPaidCents: sum((b) => b.monthPaidCents),
    monthUnpaidCents: sum((b) => b.monthUnpaidCents),
    priorUnpaidCents: sum((b) => b.priorUnpaidCents),
    dueCents: due,
    owes: due > 0,
    paid: parkingMonthCustomerPaid(monthCents: monthCents, dueCents: due),
    paidVia: [
      for (final via in {for (final b in bills) ...b.paidVia}) via,
    ],
    partialMonth: bills.any((b) => b.partialMonth),
    forStaffId: first.forStaffId,
    dueBeforeExpensesCents: due,
    expenseCreditCents: expenseCents,
    expenseLines: expenseLines,
    earlierExpenseCents: earlierCents,
    olderCars: all((b) => b.olderCars),
    olderCarsRegisteredTo: all((b) => b.olderCarsRegisteredTo),
    linkedStaffIds: [staffId],
    cashHeldCents: cashHeldCents,
    statementOwesCents: owesCents,
    statementStaffId: staffId,
  );
}

/// Each team member's statement for the month.
///
/// [customers] are the month's customers AFTER staff expenses were netted
/// (`parkingMonthSummary(...).customers`). [entries] are `lotExpenseEntries`
/// rows with standing payers and `spentAtMs`
/// ([parkingMonthCreditEntries]); [held] is `{staffId: cash held at the
/// month's end}`.
StaffStatements staffStatements(
  List<ParkingMonthCustomer> customers, {
  required String monthKey,
  Iterable<Map<String, dynamic>> entries = const [],
  Iterable<Map<String, dynamic>> repayments = const [],
  Iterable<Map<String, dynamic>> lines = const [],
  Map<String, String> staffNames = const {},
  Map<String, int> held = const {},
}) {
  final credits = staffCredits(entries, repayments, monthKey);
  final labels = expenseLineLabels(lines);
  final byMember = <String, List<ParkingMonthCustomer>>{};
  final customerKeys = <String, String>{};
  for (final customer in customers) {
    final staffId = statementMemberOf(customer);
    if (staffId.isEmpty) continue;
    byMember.putIfAbsent(staffId, () => []).add(customer);
    customerKeys[_text(customer.key, 200)] = staffId;
  }
  String dayOf(int ms) {
    if (ms <= 0) return '';
    final day = parkingDayNumber(
      DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true),
    );
    return day == null
        ? ''
        : DateTime.fromMillisecondsSinceEpoch(
            day * 24 * 60 * 60 * 1000,
            isUtc: true,
          ).toIso8601String().substring(0, 10);
  }

  final statements = <StaffStatement>[];
  byMember.forEach((staffId, found) {
    // The card that carries the statement: their own cars first.
    final bills = [...found]
      ..sort((a, b) {
        final own = (a.key.startsWith('staff:') ? 0 : 1).compareTo(
          b.key.startsWith('staff:') ? 0 : 1,
        );
        return own != 0 ? own : a.key.compareTo(b.key);
      });
    var name = _text(staffNames[staffId], 120);
    if (name.isEmpty) {
      final own = bills.where((b) => b.key.startsWith('staff:'));
      name = _text(
        own.isNotEmpty ? own.first.customerName : bills.first.customerName,
        120,
      );
    }
    final parkingJobs = bills.fold<int>(
      0,
      (s, b) => s + b.dueBeforeExpensesCents,
    );
    final expense = credits[staffId]?.creditCents ?? 0;
    final expenseLines = [
      for (final line in monthExpenseLines(entries, monthKey, [
        staffId,
      ], labels))
        ParkingMonthExpenseLine(
          id: line.id,
          date: dayOf(line.spentAtMs),
          label: line.label,
          amountCents: line.amountCents,
          staffId: staffId,
          staffName: name,
        ),
    ];
    final cash = held[staffId] ?? 0;
    final owes = parkingJobs - expense + cash;
    final earlier = earlierExpenseCents(
      expense,
      expenseLines.map((l) => l.amountCents),
    );
    final merged = _mergedBill(
      bills,
      name,
      cash,
      owes,
      staffId,
      expense,
      expenseLines,
      earlier,
    );
    statements.add(
      StaffStatement(
        staffId: staffId,
        name: name,
        key: _text(bills.first.key, 200),
        customerKeys: [for (final b in bills) _text(b.key, 200)],
        monthKey: monthKey,
        parkingJobsCents: parkingJobs,
        expenseCents: expense,
        expenseLines: expenseLines,
        earlierExpenseCents: earlier,
        cashHeldCents: cash,
        owesCents: owes,
        stillParked: merged.cars.any((b) => b.stillParked),
        customer: merged,
      ),
    );
  });
  statements.sort((a, b) {
    final byName = a.name.compareTo(b.name);
    return byName != 0 ? byName : a.staffId.compareTo(b.staffId);
  });
  return StaffStatements(statements: statements, customerKeys: customerKeys);
}

/// What the Month end list shows for each customer once the statements are
/// known: the member's FIRST bill becomes their statement (all their bills as
/// one, with the cash line and "owes the business"); their other bills are
/// marked as included in it; everyone else is untouched.
List<ParkingMonthCustomer> statementCards(
  List<ParkingMonthCustomer> customers,
  StaffStatements result,
) {
  final byStaff = {for (final s in result.statements) s.staffId: s};
  return [
    for (final c in customers)
      () {
        final staffId = result.customerKeys[c.key];
        final statement = staffId == null ? null : byStaff[staffId];
        if (statement == null) return c;
        if (statement.key != c.key) {
          return c.withStatement(includedInStatementOf: statement.name);
        }
        return statement.customer;
      }(),
  ];
}

/// Whether a card is on Month end's "Who owes" list: a statement by what the
/// member owes, a customer as before.
bool cardOwes(ParkingMonthCustomer card) {
  if (card.includedInStatementOf.isNotEmpty) return false;
  final owes = card.statementOwesCents;
  return owes != null ? owes > 0 : card.owes;
}

/// Whether a card is on the "Paid" list: a statement once nothing is owed, a
/// customer as before.
bool cardPaid(ParkingMonthCustomer card) {
  if (card.includedInStatementOf.isNotEmpty) return false;
  final owes = card.statementOwesCents;
  return owes != null ? owes <= 0 : card.paid;
}

/// Whether Month end needs the cash at all: some bill belongs to a team
/// member.
bool hasTeamBills(Iterable<ParkingMonthCustomer> customers) =>
    customers.any((c) => statementMemberOf(c).isNotEmpty);

/// The `staff_statement_cash` answer's `held`, normalised:
/// `{staffId: whole cents}` (an odd answer reads as nobody holding anything).
Map<String, int> staffStatementCashFrom(Object? value) {
  final held = value is Map ? value['held'] : null;
  final out = <String, int>{};
  if (held is! Map) return out;
  held.forEach((id, cents) {
    final n = num.tryParse('$cents');
    if ('$id'.isNotEmpty && n != null && n.isFinite) {
      out['$id'] = n.round();
    }
  });
  return out;
}

/// The month as Month end lists it once the statements are known: a team
/// member's first bill is their statement, their other bills are marked as
/// included, and the lists and the "Still owed" total follow. [base] comes
/// back untouched when nobody has a statement.
ParkingMonthSummary summaryWithStatements(
  ParkingMonthSummary base,
  StaffStatements result,
) {
  if (result.statements.isEmpty) return base;
  final cards = statementCards(base.customers, result);
  final owing = cards.where(cardOwes).toList();
  return ParkingMonthSummary(
    monthKey: base.monthKey,
    carsOnLot: base.carsOnLot,
    carsOwing: base.carsOwing,
    activitiesInMonth: base.activitiesInMonth,
    customers: cards,
    customersOwing: owing,
    customersPaid: cards.where(cardPaid).toList(),
    billedCents: base.billedCents,
    collectedCents: base.collectedCents,
    owedCents: base.owedCents,
    olderOwedCents: base.olderOwedCents,
    dueCents: owing.fold(0, (s, c) => s + (c.statementOwesCents ?? c.dueCents)),
    owing: base.owing,
    bills: base.bills,
    carried: base.carried,
    expenseCreditCents: base.expenseCreditCents,
    businessOwes: base.businessOwes,
    businessOwesCents: base.businessOwesCents,
  );
}
