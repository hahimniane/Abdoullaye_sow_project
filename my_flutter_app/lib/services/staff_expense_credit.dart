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

/// Month end's customer key for a team member's own cars.
const _teamKeyPrefix = 'staff:';

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

/// "Paid by: the business" (docs/EXPENSE_PAID_BY.md): nobody's credit. The
/// same value as `businessAccountReceiver`.
const businessPayer = 'business_account';

/// A person who paid, or '' for the business / nobody.
String _personPayer(Object? id) {
  final v = _text(id, 128);
  return v.isNotEmpty && v != businessPayer ? v : '';
}

/// At most this many months of a standing payer (3 years).
const _maxStandingMonths = 36;

/// Who pays a monthly line in [month] (docs/EXPENSE_PAID_BY.md §2), and
/// since which month: the payer with the greatest `fromMonth <= month`.
/// [line] is a `lotExpenseLines` row `{payers}`. Null when no payer entry
/// applies; `staffId` is '' when that entry is the business.
({String staffId, String fromMonth})? linePayerSince(
  Map<String, dynamic>? line,
  String month,
) {
  String? bestFrom;
  var bestId = '';
  final payers = line?['payers'];
  for (final p in payers is List ? payers : const []) {
    if (p is! Map) continue;
    final from = _text(p['fromMonth'], 7);
    if (!_month.hasMatch(from) || from.compareTo(month) > 0) continue;
    if (bestFrom == null || from.compareTo(bestFrom) >= 0) {
      bestFrom = from;
      bestId = _text(p['staffId'], 128);
    }
  }
  if (bestFrom == null) return null;
  // "Since" is where this person's unbroken run began: Sep then Oct, both
  // Yao, reads "since Sep".
  final starts = <({String from, String id})>[
    for (final p in payers is List ? payers : const [])
      if (p is Map &&
          _month.hasMatch(_text(p['fromMonth'], 7)) &&
          _text(p['fromMonth'], 7).compareTo(bestFrom) <= 0)
        (from: _text(p['fromMonth'], 7), id: _text(p['staffId'], 128)),
  ]..sort((a, b) => a.from.compareTo(b.from));
  var since = bestFrom;
  for (var i = starts.length - 1; i >= 0 && starts[i].id == bestId; i--) {
    since = starts[i].from;
  }
  return (staffId: _personPayer(bestId), fromMonth: since);
}

/// Who pays a monthly line in [month]: a staff id, or '' for the business.
String linePayerFor(Map<String, dynamic>? line, String month) =>
    linePayerSince(line, month)?.staffId ?? '';

String _nextMonth(String month) {
  final y = int.parse(month.substring(0, 4));
  final m = int.parse(month.substring(5, 7));
  return m == 12
      ? '${y + 1}-01'
      : '$y-${m + 1 < 10 ? '0' : ''}${m + 1}';
}

/// The months a monthly line's standing payer pays
/// (docs/EXPENSE_PAID_BY.md §3), as virtual expense entries so the netting
/// reads them like purchases. [lines] are `lotExpenseLines` rows `{id, kind,
/// recurringCents, payers, endMonth, voided, active}`; [entries] are
/// `lotExpenseEntries` rows `{lineId, month, voided}` - a real purchase on
/// the line for a month wins. Each is `{id, lineId, month, amountCents,
/// paidByStaffId, note, spentAtMs, standing}`, by line then month.
List<Map<String, dynamic>> standingPayerEntries(
  Iterable<Map<String, dynamic>>? lines,
  Iterable<Map<String, dynamic>>? entries,
  String nowMonth,
) {
  final out = <Map<String, dynamic>>[];
  if (!_month.hasMatch(nowMonth)) return out;
  final logged = <String>{};
  for (final e in entries ?? const <Map<String, dynamic>>[]) {
    if (e['voided'] == true) continue;
    logged.add('${_text(e['lineId'], 128)}|${_text(e['month'], 7)}');
  }
  for (final line in lines ?? const <Map<String, dynamic>>[]) {
    final lineId = _text(line['id'], 128);
    if (lineId.isEmpty ||
        line['kind'] != 'fixed' ||
        line['voided'] == true ||
        line['active'] == false) {
      continue;
    }
    final amount = _cents(line['recurringCents']);
    if (amount <= 0) continue;
    final payers = line['payers'];
    final froms = [
      for (final p in payers is List ? payers : const [])
        if (p is Map && _month.hasMatch(_text(p['fromMonth'], 7)))
          _text(p['fromMonth'], 7),
    ]..sort();
    if (froms.isEmpty) continue;
    final end = _text(line['endMonth'], 7);
    var month = froms.first;
    for (var n = 0;
        n < _maxStandingMonths && month.compareTo(nowMonth) <= 0;
        n++) {
      if (_month.hasMatch(end) && month.compareTo(end) > 0) break;
      final payer = linePayerFor(line, month);
      if (payer.isNotEmpty && !logged.contains('$lineId|$month')) {
        out.add({
          'id': 'standing:$lineId:$month',
          'lineId': lineId,
          'month': month,
          'amountCents': amount,
          'paidByStaffId': payer,
          'note': '',
          'spentAtMs': DateTime.utc(
            int.parse(month.substring(0, 4)),
            int.parse(month.substring(5, 7)),
            1,
            12,
          ).millisecondsSinceEpoch,
          'standing': true,
        });
      }
      month = _nextMonth(month);
    }
  }
  return out;
}

/// The entries every netting reads: the real ones plus the monthly lines'
/// standing payers (docs/EXPENSE_PAID_BY.md §3).
List<Map<String, dynamic>> withStandingPayers(
  Iterable<Map<String, dynamic>>? entries,
  Iterable<Map<String, dynamic>>? lines,
  String nowMonth,
) => [
  ...?entries,
  ...standingPayerEntries(lines, entries, nowMonth),
];

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
    final id = _personPayer(e['paidByStaffId']);
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

  /// Their bill's key: `staff:{uid}` when their own cars are billed under
  /// them, else the linked customer's; '' when neither.
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
  // A team member's own cars (`staff:{uid}`, docs/PARKING_TEAM_CARS.md) are
  // theirs without any link.
  for (final customer in customers) {
    final key = _text(customer.key, 200);
    if (!key.startsWith(_teamKeyPrefix)) continue;
    final id = key.substring(_teamKeyPrefix.length);
    final list = byCustomer.putIfAbsent(key, () => []);
    if (id.isNotEmpty && !list.contains(id)) list.add(id);
  }
  final names = staffNames ?? const <String, String>{};
  // What each person's expenses can still cover: one credit, used once,
  // whichever of their bills it lands on - their own cars first.
  final left = <String, int>{
    for (final e in credits.entries) e.key: e.value.creditCents,
  };
  bool isTeamKey(int i) => _text(customers[i].key).startsWith(_teamKeyPrefix);
  // List.sort is not stable: the index breaks ties, so everyone else keeps
  // the order they came in.
  final order = List<int>.generate(customers.length, (i) => i)
    ..sort((a, b) {
      final byTeam = (isTeamKey(a) ? 0 : 1).compareTo(isTeamKey(b) ? 0 : 1);
      return byTeam != 0 ? byTeam : a.compareTo(b);
    });
  final netted = List<StaffNettedCustomer?>.filled(customers.length, null);
  for (final i in order) {
    final customer = customers[i];
    final linked = byCustomer[customer.key] ?? const <String>[];
    final credit = linked.fold<int>(0, (s, id) => s + (left[id] ?? 0));
    final before = _cents(customer.dueCents);
    final applied = before < credit ? before : credit;
    if (linked.isNotEmpty) {
      final view = <String, StaffCredit>{
        for (final id in linked) id: StaffCredit(creditCents: left[id] ?? 0),
      };
      final used = splitByCredit(applied, linked, view);
      for (final id in linked) {
        final rest = (left[id] ?? 0) - (used[id] ?? 0);
        left[id] = rest > 0 ? rest : 0;
      }
    }
    netted[i] = StaffNettedCustomer(
      key: customer.key,
      linkedStaffIds: List.unmodifiable(linked),
      dueBeforeExpensesCents: before,
      expenseCreditCents: applied,
      dueCents: before - applied,
    );
  }
  final owedByStaff = left;

  final keyOf = <String, String>{
    for (final e in (links ?? const <String, dynamic>{}).entries)
      e.key: _text(e.value is Map ? e.value['customerKey'] : null, 200),
  };
  for (final customer in customers) {
    final key = _text(customer.key, 200);
    if (key.startsWith(_teamKeyPrefix)) {
      keyOf[key.substring(_teamKeyPrefix.length)] = key;
    }
  }
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
    customers: [for (final c in netted) c!],
    businessOwes: businessOwes,
    businessOwesCents: businessOwes.fold(0, (s, x) => s + x.owedCents),
    expenseCreditCents: netted.fold(0, (s, c) => s + c!.expenseCreditCents),
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
  final wanted = {
    for (final id in staffIds ?? const <String>[])
      if (_personPayer(id).isNotEmpty) id,
  };
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
