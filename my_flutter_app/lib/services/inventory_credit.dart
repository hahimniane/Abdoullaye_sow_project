/// Credit sales, app side: who took the money at the counter, the part of a
/// sale a named customer still owes, the staff member who collects it, and
/// the payments that come in later until it is paid.
///
/// The callables are the authority (`recordInventorySale` with `credit`,
/// `recordInventoryCreditPayment`, `revertInventoryCreditPayment`,
/// `setInventoryCreditCollector`). This module is the pure half: the checkout
/// draft and its validator, the request builders, where a credit stands
/// (open, overdue, paid), the open-credit list and its totals, and the
/// payment rows. No Firebase here, so every rule is unit-tested.
///
/// Money is integer cents, as everywhere in Inventory.
library;

import '../utils/callable_data.dart';
import '../utils/date_display.dart' show parseDayKey;
import '../utils/money_input.dart';
import '../utils/phone_number_validator.dart';
import 'inventory.dart';
import 'lot_ledger.dart' show lotDateOf;
import 'zelle_check.dart' show BankCheck;
import 'waiting_packages.dart'
    show packageStanding, validatePackagePayment, PackagePayment;

const inventoryMaxCustomerName = 120;
const inventoryMaxCreditNote = 200;

// ---------------------------------------------------------------------------
// The checkout: who took the money, and the part left on credit.
// ---------------------------------------------------------------------------

/// What the Sell screen's checkout holds, as typed.
class InventoryCheckoutDraft {
  const InventoryCheckoutDraft({
    this.receivedByStaffId = '',
    this.paymentMethod = 'cash',
    this.onCredit = false,
    this.paidNow = '',
    this.customerName = '',
    this.customerPhone = '',
    this.collectorStaffId = '',
    this.dueDate = '',
  });

  /// Who took the money ('' = the seller, which the server assumes).
  final String receivedByStaffId;
  final String paymentMethod;

  /// Part (or all) of the total is left for the customer to pay later.
  final bool onCredit;

  /// What the customer pays now, as typed ('' = nothing).
  final String paidNow;
  final String customerName;

  /// As the country phone field writes it: `+<code><number>`.
  final String customerPhone;

  /// Who collects the rest. No default: it is always chosen.
  final String collectorStaffId;

  /// "YYYY-MM-DD", or '' for no due date.
  final String dueDate;

  InventoryCheckoutDraft copyWith({
    String? receivedByStaffId,
    String? paymentMethod,
    bool? onCredit,
    String? paidNow,
    String? customerName,
    String? customerPhone,
    String? collectorStaffId,
    String? dueDate,
  }) => InventoryCheckoutDraft(
    receivedByStaffId: receivedByStaffId ?? this.receivedByStaffId,
    paymentMethod: paymentMethod ?? this.paymentMethod,
    onCredit: onCredit ?? this.onCredit,
    paidNow: paidNow ?? this.paidNow,
    customerName: customerName ?? this.customerName,
    customerPhone: customerPhone ?? this.customerPhone,
    collectorStaffId: collectorStaffId ?? this.collectorStaffId,
    dueDate: dueDate ?? this.dueDate,
  );

  /// What the sale's retry id depends on beyond the basket: changing any of
  /// it is another sale.
  String get signature => onCredit
      ? [
          receivedByStaffId,
          'credit',
          inventoryPaidNowCents(this) ?? 'x',
          customerName.trim(),
          PhoneNumberValidator.normalized(customerPhone),
          collectorStaffId,
          dueDate,
        ].join('|')
      : receivedByStaffId;
}

/// The amount typed as paid now, in cents: 0 when blank, null when it cannot
/// be read (or is negative). Only meaningful on credit; a normal sale pays
/// the whole total.
int? inventoryPaidNowCents(InventoryCheckoutDraft draft) {
  final read = readMoneyInput(draft.paidNow);
  if (read.isEmpty) return 0;
  final cents = read.cents;
  if (cents == null || cents < 0) return null;
  return cents;
}

/// How [totalCents] splits at the counter: everything now, or - on credit -
/// what is paid now and what is left owed. An unreadable amount counts as
/// nothing paid now (the validator says why it is refused).
({int paidNowCents, int creditCents}) inventoryCheckoutSplit(
  int totalCents,
  InventoryCheckoutDraft draft,
) {
  if (!draft.onCredit) return (paidNowCents: totalCents, creditCents: 0);
  var paid = inventoryPaidNowCents(draft) ?? 0;
  if (paid > totalCents) paid = totalCents;
  return (paidNowCents: paid, creditCents: totalCents - paid);
}

/// Today as a day key ("2026-10-16"), local calendar.
String inventoryDayKey(DateTime day) =>
    '${day.year.toString().padLeft(4, '0')}-'
    '${day.month.toString().padLeft(2, '0')}-'
    '${day.day.toString().padLeft(2, '0')}';

/// Why this checkout cannot be sold yet, as codes:
///
/// - `received_by_invalid`: the person picked is not in the business.
/// - `payment_method_invalid`: money is taken now but by no known method.
/// - `paid_now_invalid`: the amount paid now cannot be read.
/// - `paid_now_too_large`: on credit, something must be left owed.
/// - `customer_name_required`, `customer_phone_required`,
///   `customer_phone_invalid`: who owes it, and how to reach them.
/// - `collector_required`, `collector_invalid`: who collects it.
/// - `due_date_invalid`: not a real day, or a day already past.
///
/// [staffIds] is everyone the pickers offer; an empty list (the team could
/// not be read) checks nothing about people and leaves it to the server.
List<String> validateInventoryCheckout(
  InventoryCheckoutDraft draft, {
  required int totalCents,
  Iterable<String> staffIds = const [],
  required DateTime today,
}) {
  final codes = <String>[];
  final known = {for (final id in staffIds) id.trim()}..remove('');
  bool unknown(String id) => known.isNotEmpty && !known.contains(id.trim());

  final receiver = draft.receivedByStaffId.trim();
  if (receiver.isNotEmpty && unknown(receiver)) {
    codes.add('received_by_invalid');
  }
  final split = inventoryCheckoutSplit(totalCents, draft);
  final takesMoneyNow = !draft.onCredit || split.paidNowCents > 0;
  if (takesMoneyNow && !inventoryPaymentMethods.contains(draft.paymentMethod)) {
    codes.add('payment_method_invalid');
  }
  if (!draft.onCredit) return codes;

  final paid = inventoryPaidNowCents(draft);
  if (paid == null) {
    codes.add('paid_now_invalid');
  } else if (paid >= totalCents) {
    codes.add('paid_now_too_large');
  }
  final name = draft.customerName.trim();
  if (name.isEmpty) codes.add('customer_name_required');
  // The phone is optional. The field writes "+1" alone while nothing is
  // typed, which counts as no phone; anything longer must be a real number.
  final phone = draft.customerPhone.trim();
  if (inventoryCreditPhoneGiven(phone) &&
      !PhoneNumberValidator.isValidE164(phone)) {
    codes.add('customer_phone_invalid');
  }
  final collector = draft.collectorStaffId.trim();
  if (collector.isEmpty) {
    codes.add('collector_required');
  } else if (unknown(collector)) {
    codes.add('collector_invalid');
  }
  if (!inventoryDueDateValid(draft.dueDate, today: today)) {
    codes.add('due_date_invalid');
  }
  return codes;
}

/// A due date is optional; when given it is a real day, today or later.
bool inventoryDueDateValid(String raw, {required DateTime today}) {
  final text = raw.trim();
  if (text.isEmpty) return true;
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text)) return false;
  final day = parseDayKey(text);
  if (day == null) return false;
  final start = DateTime(today.year, today.month, today.day);
  return !day.isBefore(start);
}

/// The `credit` object `recordInventorySale` takes, or null for a sale paid
/// in full. Call only after [validateInventoryCheckout] is clean.
Map<String, Object?>? inventoryCreditRequest(
  int totalCents,
  InventoryCheckoutDraft draft,
) {
  if (!draft.onCredit) return null;
  final split = inventoryCheckoutSplit(totalCents, draft);
  final name = draft.customerName.trim();
  return {
    'paidNowCents': split.paidNowCents,
    'customerName': name.length > inventoryMaxCustomerName
        ? name.substring(0, inventoryMaxCustomerName)
        : name,
    'customerPhone': inventoryCreditPhoneGiven(draft.customerPhone)
        ? PhoneNumberValidator.normalized(draft.customerPhone)
        : '',
    'collectorStaffId': draft.collectorStaffId.trim(),
    'dueDate': draft.dueDate.trim(),
  };
}

// ---------------------------------------------------------------------------
// Where a credit stands.
// ---------------------------------------------------------------------------

/// A sale's credit: none (paid in full at the counter), still owed, owed
/// past its due date, or paid off.
enum InventoryCreditStanding { none, open, overdue, paid }

/// Overdue is a due date strictly before [today] (the due day itself is
/// still on time). A voided sale is owed nothing.
InventoryCreditStanding inventoryCreditStanding(
  InventorySale sale, {
  required DateTime today,
}) {
  if (!sale.isOnCredit || sale.voided) return InventoryCreditStanding.none;
  if (!sale.creditOpen) return InventoryCreditStanding.paid;
  return inventoryCreditOverdue(sale, today: today)
      ? InventoryCreditStanding.overdue
      : InventoryCreditStanding.open;
}

bool inventoryCreditOverdue(InventorySale sale, {required DateTime today}) {
  if (!sale.creditOpen) return false;
  final due = parseDayKey(sale.credit?.dueDate);
  if (due == null) return false;
  return due.isBefore(DateTime(today.year, today.month, today.day));
}

/// The credit chip filter on the sales list.
enum InventoryCreditFilter { all, open, paid }

List<InventorySale> inventorySalesForCredit(
  Iterable<InventorySale> sales,
  InventoryCreditFilter filter,
) => [
  for (final sale in sales)
    if (switch (filter) {
      InventoryCreditFilter.all => true,
      InventoryCreditFilter.open => sale.creditOpen,
      InventoryCreditFilter.paid =>
        sale.isOnCredit && !sale.voided && !sale.creditOpen,
    })
      sale,
];

// ---------------------------------------------------------------------------
// The open-credit list.
// ---------------------------------------------------------------------------

/// Which collector the "Credit owed" list starts on: everyone's for the
/// owner, the person's own for staff.
String inventoryCreditDefaultCollector({
  required bool isOwner,
  required String currentUserId,
}) => isOwner ? '' : currentUserId.trim();

/// The open credits a list shows: still owed, of [collectorId] ('' anyone)
/// and of [storeId] ('' any; a sale from before stores counts under every
/// store). Overdue first, then the nearest due date, then those with no due
/// date; oldest sale first within each.
List<InventorySale> inventoryOpenCredits(
  Iterable<InventorySale> sales, {
  String collectorId = '',
  String storeId = '',
  required DateTime today,
}) {
  final rows = [
    for (final sale in sales)
      if (sale.creditOpen &&
          (collectorId.isEmpty ||
              sale.credit?.collectorStaffId == collectorId) &&
          (storeId.isEmpty || sale.storeId.isEmpty || sale.storeId == storeId))
        sale,
  ];
  int rank(InventorySale s) => inventoryCreditOverdue(s, today: today)
      ? 0
      : (parseDayKey(s.credit?.dueDate) == null ? 2 : 1);
  rows.sort((a, b) {
    final r = rank(a).compareTo(rank(b));
    if (r != 0) return r;
    final da = parseDayKey(a.credit?.dueDate);
    final db = parseDayKey(b.credit?.dueDate);
    if (da != null && db != null) {
      final d = da.compareTo(db);
      if (d != 0) return d;
    }
    final x = a.createdAt, y = b.createdAt;
    if (x == null && y == null) return a.id.compareTo(b.id);
    if (x == null) return 1;
    if (y == null) return -1;
    return x.compareTo(y);
  });
  return rows;
}

/// The figures over an open-credit list.
class InventoryCreditTotals {
  const InventoryCreditTotals({
    this.count = 0,
    this.owedCents = 0,
    this.overdueCount = 0,
    this.overdueCents = 0,
  });

  final int count;
  final int owedCents;
  final int overdueCount;
  final int overdueCents;
}

InventoryCreditTotals inventoryCreditTotals(
  Iterable<InventorySale> credits, {
  required DateTime today,
}) {
  var count = 0, owed = 0, overdueCount = 0, overdue = 0;
  for (final sale in credits) {
    if (!sale.creditOpen) continue;
    count++;
    owed += sale.creditBalanceCents;
    if (inventoryCreditOverdue(sale, today: today)) {
      overdueCount++;
      overdue += sale.creditBalanceCents;
    }
  }
  return InventoryCreditTotals(
    count: count,
    owedCents: owed,
    overdueCount: overdueCount,
    overdueCents: overdue,
  );
}

/// The collectors who have something open in [credits], each once, in the
/// order first seen.
List<String> inventoryCreditCollectors(Iterable<InventorySale> credits) {
  final seen = <String>{};
  return [
    for (final sale in credits)
      if (sale.creditOpen &&
          (sale.credit?.collectorStaffId ?? '').isNotEmpty &&
          seen.add(sale.credit!.collectorStaffId))
        sale.credit!.collectorStaffId,
  ];
}

// ---------------------------------------------------------------------------
// Later payments.
// ---------------------------------------------------------------------------

/// One row of `inventoryCreditPayments`: money that came in against a
/// credit. A mistaken one is struck through (`reverted`), never erased.
class InventoryCreditPayment {
  const InventoryCreditPayment({
    required this.id,
    this.businessId = '',
    this.saleId = '',
    this.storeId = '',
    required this.amountCents,
    this.method = '',
    this.receivedByStaffId = '',
    this.recordedByStaffId = '',
    this.note = '',
    this.reverted = false,
    this.revertedByStaffId = '',
    this.revertedAt,
    this.createdAt,
    this.bankCheck,
  });

  factory InventoryCreditPayment.fromMap(String id, Map<String, dynamic> d) {
    String text(Object? v, int max) {
      final t = (v ?? '').toString().trim();
      return t.length > max ? t.substring(0, max) : t;
    }

    final amount = d['amountCents'];
    return InventoryCreditPayment(
      id: id,
      businessId: text(d['businessId'], 128),
      saleId: text(d['saleId'], 128),
      storeId: text(d['storeId'], 128),
      amountCents: amount is num && amount.isFinite ? amount.round() : 0,
      method: text(d['method'], 40),
      receivedByStaffId: text(d['receivedByStaffId'], 128),
      recordedByStaffId: text(d['recordedByStaffId'], 128),
      note: text(d['note'], inventoryMaxCreditNote),
      reverted: d['reverted'] == true,
      revertedByStaffId: text(d['revertedByStaffId'], 128),
      revertedAt: lotDateOf(d['revertedAt']),
      createdAt: lotDateOf(d['createdAt']),
      bankCheck: BankCheck.fromMap(d['bankCheck'], date: lotDateOf),
    );
  }

  /// What the owner's bank showed for this payment (null: never checked).
  final BankCheck? bankCheck;
  final String id;
  final String businessId;
  final String saleId;
  final String storeId;
  final int amountCents;
  final String method;
  final String receivedByStaffId;
  final String recordedByStaffId;
  final String note;
  final bool reverted;
  final String revertedByStaffId;
  final DateTime? revertedAt;
  final DateTime? createdAt;
}

/// Newest first; rows with no time yet (just written) on top.
List<InventoryCreditPayment> sortCreditPaymentsNewestFirst(
  Iterable<InventoryCreditPayment> rows,
) => rows.toList()
  ..sort((a, b) {
    final x = a.createdAt, y = b.createdAt;
    if (x == null && y == null) return 0;
    if (x == null) return -1;
    if (y == null) return 1;
    return y.compareTo(x);
  });

/// A credit's money as the package payment sheet reads it: the amount left
/// on credit is the "price", what came in since is "paid".
PackagePayment inventoryCreditMoney({
  required int creditCents,
  required int creditPaidCents,
}) => packageStanding(
  priceCents: creditCents,
  paidCents: creditPaidCents,
  payOnArrival: false,
);

/// A later payment's refusals, the same rules (and codes) as a package
/// payment: `amount_required`, `amount_too_large`, `payment_exceeds_balance`,
/// `payment_method_invalid`, `received_by_required`, `received_by_invalid`.
List<String> validateInventoryCreditPayment({
  required String amount,
  required String method,
  required int creditCents,
  required int creditPaidCents,
  required String receivedByStaffId,
  Iterable<String> staffIds = const [],
}) =>
    // The package cap and the sale cap are the same figure (invoice cents).
    validatePackagePayment(
      amount: amount,
      method: method,
      standing: inventoryCreditMoney(
        creditCents: creditCents,
        creditPaidCents: creditPaidCents,
      ),
      receivedByStaffId: receivedByStaffId,
      staffIds: staffIds,
    );

Map<String, Object?> recordInventoryCreditPaymentRequest({
  required String businessId,
  required String saleId,
  required int amountCents,
  required String method,
  required String receivedByStaffId,
  String note = '',
}) {
  final clean = note.trim();
  return {
    'businessId': businessId.trim(),
    'saleId': saleId.trim(),
    'amountCents': amountCents,
    'method': method.trim(),
    'receivedByStaffId': receivedByStaffId.trim(),
    if (clean.isNotEmpty)
      'note': clean.length > inventoryMaxCreditNote
          ? clean.substring(0, inventoryMaxCreditNote)
          : clean,
  };
}

Map<String, Object?> revertInventoryCreditPaymentRequest(
  String businessId,
  String paymentId,
) => {'businessId': businessId.trim(), 'paymentId': paymentId.trim()};

/// `setInventoryCreditCollector`: a new collector, and the due date when it
/// is being changed too ('' clears it; null leaves it as it is).
Map<String, Object?> setInventoryCreditCollectorRequest({
  required String businessId,
  required String saleId,
  required String collectorStaffId,
  String? dueDate,
}) => {
  'businessId': businessId.trim(),
  'saleId': saleId.trim(),
  'collectorStaffId': collectorStaffId.trim(),
  if (dueDate != null) 'dueDate': dueDate.trim(),
};

/// What `recordInventoryCreditPayment` / `revertInventoryCreditPayment`
/// answer: the credit's paid total and status after the change.
class InventoryCreditPaymentResult {
  const InventoryCreditPaymentResult({
    this.paymentId = '',
    this.creditPaidCents,
    this.creditStatus = '',
  });

  factory InventoryCreditPaymentResult.fromCallable(Object? data) {
    final map = callableMap(data);
    final paid = map['creditPaidCents'];
    return InventoryCreditPaymentResult(
      paymentId: callableString(map['paymentId']),
      creditPaidCents: paid is num && paid.isFinite ? paid.round() : null,
      creditStatus: callableString(map['creditStatus']),
    );
  }

  final String paymentId;

  /// Null when the server did not say (the screen then adds it up itself).
  final int? creditPaidCents;
  final String creditStatus;
}

/// Whether a credit customer's phone was really typed: more than a country
/// code alone (the phone field's starting "+1").
bool inventoryCreditPhoneGiven(String phone) =>
    PhoneNumberValidator.digitsOnly(phone.trim()).length > 3 ||
    PhoneNumberValidator.isValidE164(phone.trim());
