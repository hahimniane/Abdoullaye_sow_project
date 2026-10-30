/// Staff expenses netted against their parking bill
/// (docs/STAFF_EXPENSE_CREDIT.md §3).
///
/// A staff member who paid lot expenses out of pocket is owed that money; if
/// they also park cars, what they owe on parking is lowered by it. Both sides
/// are cumulative to the end of the month shown, so the netting never needs
/// history: applied = min(owed on parking, credit), and what is left of the
/// credit is what the business still owes them.
///
/// Pure: no Firestore, no clock. The app's mirror of the server's
/// `functions/staff_expense_credit.js` (and the console's
/// `staff-expense-credit.ts`); `test/staff_expense_credit_test.dart` runs every
/// case of the shared `functions/test/fixtures/staff-expense-credit-cases.json`.
library;

final _month = RegExp(r'^\d{4}-(0[1-9]|1[0-2])$');

int _cents(Object? value) {
  final n = value is num ? value : num.tryParse('${value ?? ''}'.trim());
  if (n == null || !n.isFinite) return 0;
  final r = n.round();
  return r > 0 ? r : 0;
}

String _text(Object? value, [int max = 200]) {
  final t = (value ?? '').toString().trim();
  return t.length > max ? t.substring(0, max) : t;
}

/// One staff member's expenses, paid-back amounts and credit.
class StaffCredit {
  const StaffCredit({
    this.expensesCents = 0,
    this.repaidCents = 0,
    this.creditCents = 0,
  });

  final int expensesCents;
  final int repaidCents;
  final int creditCents;
}

/// Each staff member's expenses, paid-back amounts and credit up to the end
/// of [monthKey]. [entries] are `lotExpenseEntries` rows
/// `{paidByStaffId, amountCents, month, voided}`; [repayments] are
/// `staffExpenseRepayments` rows `{staffId, amountCents, month, voided}`.
Map<String, StaffCredit> staffCredits(
  Iterable<Map<String, dynamic>>? entries,
  Iterable<Map<String, dynamic>>? repayments,
  String monthKey,
) {
  if (!_month.hasMatch(monthKey)) return {};
  final expenses = <String, int>{};
  final repaid = <String, int>{};
  final order = <String>[];
  void touch(String id) {
    if (!expenses.containsKey(id)) {
      expenses[id] = 0;
      repaid[id] = 0;
      order.add(id);
    }
  }

  for (final e in entries ?? const <Map<String, dynamic>>[]) {
    final id = _text(e['paidByStaffId'], 128);
    final month = _text(e['month'], 7);
    if (id.isEmpty ||
        e['voided'] == true ||
        !_month.hasMatch(month) ||
        month.compareTo(monthKey) > 0) {
      continue;
    }
    touch(id);
    expenses[id] = expenses[id]! + _cents(e['amountCents']);
  }
  for (final r in repayments ?? const <Map<String, dynamic>>[]) {
    final id = _text(r['staffId'], 128);
    final month = _text(r['month'], 7);
    if (id.isEmpty ||
        r['voided'] == true ||
        !_month.hasMatch(month) ||
        month.compareTo(monthKey) > 0) {
      continue;
    }
    touch(id);
    repaid[id] = repaid[id]! + _cents(r['amountCents']);
  }
  return {
    for (final id in order)
      id: StaffCredit(
        expensesCents: expenses[id]!,
        repaidCents: repaid[id]!,
        creditCents: expenses[id]! - repaid[id]! > 0
            ? expenses[id]! - repaid[id]!
            : 0,
      ),
  };
}

/// The staff linked to each customer key, staff ids sorted.
/// [links] is `businesses.staffParkingLinks`: `{[staffId]: {customerKey}}`.
Map<String, List<String>> staffByCustomer(Map<String, dynamic>? links) {
  final out = <String, List<String>>{};
  for (final entry in (links ?? const <String, dynamic>{}).entries) {
    final link = entry.value;
    final key = _text(link is Map ? link['customerKey'] : null, 200);
    if (key.isEmpty) continue;
    out.putIfAbsent(key, () => []).add(entry.key);
  }
  for (final list in out.values) {
    list.sort();
  }
  return out;
}

/// Splits [amount] across staff in proportion to their credits; the rounding
/// remainder goes to the first. Every share is whole cents.
Map<String, int> splitByCredit(
  int amount,
  List<String> staffIds,
  Map<String, StaffCredit> credits,
) {
  final total = staffIds.fold<int>(
    0,
    (s, id) => s + (credits[id]?.creditCents ?? 0),
  );
  final out = <String, int>{};
  if (amount <= 0 || total <= 0) {
    for (final id in staffIds) {
      out[id] = 0;
    }
    return out;
  }
  var given = 0;
  for (final id in staffIds) {
    out[id] = (amount * (credits[id]?.creditCents ?? 0)) ~/ total;
    given += out[id]!;
  }
  out[staffIds.first] = out[staffIds.first]! + amount - given;
  return out;
}

/// One customer after the netting.
class StaffNettedCustomer {
  const StaffNettedCustomer({
    required this.key,
    required this.linkedStaffIds,
    required this.dueBeforeExpensesCents,
    required this.expenseCreditCents,
    required this.dueCents,
  });

  final String key;
  final List<String> linkedStaffIds;
  final int dueBeforeExpensesCents;
  final int expenseCreditCents;
  final int dueCents;
}

/// One row of "Business owes": a staff member the business still owes.
class StaffOwedRow {
  const StaffOwedRow({
    required this.staffId,
    required this.staffName,
    required this.customerKey,
    required this.owedCents,
  });

  final String staffId;
  final String staffName;

  /// The linked customer's key; '' when the staff member is not linked.
  final String customerKey;
  final int owedCents;
}

class StaffExpenseNetting {
  const StaffExpenseNetting({
    required this.customers,
    required this.businessOwes,
    required this.businessOwesCents,
    required this.expenseCreditCents,
  });

  /// Same order as the customers passed in.
  final List<StaffNettedCustomer> customers;
  final List<StaffOwedRow> businessOwes;
  final int businessOwesCents;
  final int expenseCreditCents;
}

/// Nets staff credit into the month's customers and lists what the business
/// still owes its staff. [customers] are `(key, dueCents)` where `dueCents`
/// is everything owed to the end of the month; [staffNames] is
/// `{[staffId]: name}`.
StaffExpenseNetting netStaffExpenses(
  List<({String key, int dueCents})> customers, {
  Iterable<Map<String, dynamic>>? entries,
  Iterable<Map<String, dynamic>>? repayments,
  Map<String, dynamic>? links,
  required String monthKey,
  Map<String, String>? staffNames,
}) {
  final credits = staffCredits(entries, repayments, monthKey);
  final byCustomer = staffByCustomer(links);
  final names = staffNames ?? const <String, String>{};
  final owedByStaff = <String, int>{
    for (final e in credits.entries) e.key: e.value.creditCents,
  };

  final netted = <StaffNettedCustomer>[];
  for (final customer in customers) {
    final linked = byCustomer[customer.key] ?? const <String>[];
    final credit = linked.fold<int>(
      0,
      (s, id) => s + (credits[id]?.creditCents ?? 0),
    );
    final before = _cents(customer.dueCents);
    final applied = before < credit ? before : credit;
    if (linked.isNotEmpty) {
      final used = splitByCredit(applied, linked, credits);
      for (final id in linked) {
        final left = (credits[id]?.creditCents ?? 0) - (used[id] ?? 0);
        owedByStaff[id] = left > 0 ? left : 0;
      }
    }
    netted.add(
      StaffNettedCustomer(
        key: customer.key,
        linkedStaffIds: List.unmodifiable(linked),
        dueBeforeExpensesCents: before,
        expenseCreditCents: applied,
        dueCents: before - applied,
      ),
    );
  }

  final keyOf = <String, String>{
    for (final e in (links ?? const <String, dynamic>{}).entries)
      e.key: _text(e.value is Map ? e.value['customerKey'] : null, 200),
  };
  final businessOwes =
      [
        for (final e in owedByStaff.entries)
          if (e.value > 0)
            StaffOwedRow(
              staffId: e.key,
              staffName: _text(names[e.key], 120),
              customerKey: keyOf[e.key] ?? '',
              owedCents: e.value,
            ),
      ]..sort((a, b) {
        final byOwed = b.owedCents.compareTo(a.owedCents);
        if (byOwed != 0) return byOwed;
        final byName = a.staffName.compareTo(b.staffName);
        return byName != 0 ? byName : a.staffId.compareTo(b.staffId);
      });
  return StaffExpenseNetting(
    customers: netted,
    businessOwes: businessOwes,
    businessOwesCents: businessOwes.fold(0, (s, x) => s + x.owedCents),
    expenseCreditCents: netted.fold(0, (s, c) => s + c.expenseCreditCents),
  );
}

/// One of this month's expenses on a bill.
class StaffExpenseLine {
  const StaffExpenseLine({
    required this.id,
    required this.staffId,
    required this.amountCents,
    required this.note,
    required this.spentAtMs,
    this.lineId = '',
    this.lineLabel = '',
    this.label = '',
  });

  final String id;
  final String staffId;
  final int amountCents;
  final String note;
  final int spentAtMs;
  final String lineId;

  /// The expense line's name (`lotExpenseLines.label`), '' when unknown.
  final String lineLabel;

  /// [expenseLabel] of [lineLabel] and [note].
  final String label;
}

/// The expense lines' names (`lotExpenseLines.label`) by line id; unnamed
/// lines left out.
Map<String, String> expenseLineLabels(Iterable<Map<String, dynamic>>? lines) {
  final out = <String, String>{};
  for (final l in lines ?? const <Map<String, dynamic>>[]) {
    final id = _text(l['id'], 128);
    final label = _text(l['label'], 120);
    if (id.isNotEmpty && label.isNotEmpty) out[id] = label;
  }
  return out;
}

/// What an expense reads as on a bill: its line's name, then its note
/// ("grosseries · tissu, cups"); one alone when the other is empty or the
/// same; '' when neither (each client then says "Lot expense").
String expenseLabel(Object? lineLabel, Object? note) {
  final a = _text(lineLabel, 120);
  final b = _text(note, 200);
  if (a.isNotEmpty && b.isNotEmpty && a.toLowerCase() == b.toLowerCase()) {
    return a;
  }
  return [a, b].where((s) => s.isNotEmpty).join(' · ');
}

/// The part of "Less expenses" that came from expenses of earlier months:
/// what was taken off the bill beyond this month's listed lines. With it
/// listed, the lines add up to "Less expenses" whenever the credit covered
/// them (when it did not, the rest of the credit is in Business owes).
int earlierExpenseCents(int appliedCents, Iterable<int> lineCents) {
  final applied = _cents(appliedCents);
  final listed = lineCents.fold<int>(0, (s, c) => s + _cents(c));
  return applied - (listed < applied ? listed : applied);
}

/// This month's expenses of the given staff, for the bill's lines, oldest
/// first. Entries carry `spentAtMs` (milliseconds). [lineLabels] names each
/// expense by its line ([expenseLineLabels]).
List<StaffExpenseLine> monthExpenseLines(
  Iterable<Map<String, dynamic>>? entries,
  String monthKey,
  Iterable<String>? staffIds, [
  Map<String, String>? lineLabels,
]) {
  final wanted = {...?staffIds};
  final names = lineLabels ?? const <String, String>{};
  StaffExpenseLine lineOf(Map<String, dynamic> e) {
    final lineId = _text(e['lineId'], 128);
    final lineLabel = _text(names[lineId], 120);
    final note = _text(e['note'], 200);
    return StaffExpenseLine(
      id: _text(e['id'], 128),
      staffId: '${e['paidByStaffId']}',
      amountCents: _cents(e['amountCents']),
      note: note,
      spentAtMs: (num.tryParse('${e['spentAtMs'] ?? ''}') ?? 0).toInt(),
      lineId: lineId,
      lineLabel: lineLabel,
      label: expenseLabel(lineLabel, note),
    );
  }

  final out = [
    for (final e in entries ?? const <Map<String, dynamic>>[])
      if (e['voided'] != true &&
          wanted.contains(e['paidByStaffId']) &&
          _text(e['month'], 7) == monthKey &&
          _cents(e['amountCents']) > 0)
        lineOf(e),
  ];
  out.sort((a, b) {
    final byTime = a.spentAtMs.compareTo(b.spentAtMs);
    return byTime != 0 ? byTime : a.id.compareTo(b.id);
  });
  return out;
}

/// Mark all paid's items after the expense credit: the credit covers the
/// first items (in order), only the rest is recorded as payments. Items
/// left with nothing to pay are dropped; the others keep their order with
/// their amounts reduced.
List<T> itemsAfterCredit<T>(
  Iterable<T> items,
  int creditCents, {
  required int Function(T item) amountOf,
  required T Function(T item, int amountCents) withAmount,
}) {
  var left = _cents(creditCents);
  final out = <T>[];
  for (final item in items) {
    final amount = _cents(amountOf(item));
    final covered = amount < left ? amount : left;
    left -= covered;
    if (amount - covered > 0) out.add(withAmount(item, amount - covered));
  }
  return out;
}
