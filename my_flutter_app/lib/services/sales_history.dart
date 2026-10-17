/// Sales history, the pure half: periods (a day, a Sunday-to-Saturday week,
/// a month, a year) on the shop's clock, the bars of the chart, the headline
/// figures and their change against the period before, the breakdowns, and
/// the "what happened" timeline.
///
/// The shop's clock (America/New_York) is `eastern_clock.dart`, exported
/// from here.
///
/// Wall-clock times are carried as `DateTime.utc(...)` values whose fields
/// ARE the New York wall clock (a "wall" date); real instants are true UTC.
/// Nothing here touches Firebase.
library;

import 'eastern_clock.dart';
import 'inventory.dart';
import 'inventory_credit.dart';

export 'eastern_clock.dart';

// ---------------------------------------------------------------------------
// Periods.
// ---------------------------------------------------------------------------

enum SalesPeriodKind { day, week, month, year }

/// One period on the shop's clock: [startDay] (a wall date) up to, not
/// including, [endDay]; [startUtc]/[endUtc] are the instants a query uses.
class SalesPeriod {
  SalesPeriod._(this.kind, this.startDay, this.endDay)
    : startUtc = easternMidnightUtc(startDay),
      endUtc = easternMidnightUtc(endDay);

  /// The period of [kind] holding the wall date [day]. Weeks start on
  /// Sunday, US style.
  factory SalesPeriod.containing(SalesPeriodKind kind, DateTime day) {
    final d = wallDate(day);
    switch (kind) {
      case SalesPeriodKind.day:
        return SalesPeriod._(kind, d, DateTime.utc(d.year, d.month, d.day + 1));
      case SalesPeriodKind.week:
        final back = d.weekday % 7; // Sunday 0 .. Saturday 6
        final start = DateTime.utc(d.year, d.month, d.day - back);
        return SalesPeriod._(
          kind,
          start,
          DateTime.utc(start.year, start.month, start.day + 7),
        );
      case SalesPeriodKind.month:
        return SalesPeriod._(
          kind,
          DateTime.utc(d.year, d.month, 1),
          DateTime.utc(d.year, d.month + 1, 1),
        );
      case SalesPeriodKind.year:
        return SalesPeriod._(
          kind,
          DateTime.utc(d.year, 1, 1),
          DateTime.utc(d.year + 1, 1, 1),
        );
    }
  }

  /// The period of [kind] holding [now] on the shop's clock.
  factory SalesPeriod.current(SalesPeriodKind kind, DateTime now) =>
      SalesPeriod.containing(kind, easternWall(now));

  final SalesPeriodKind kind;
  final DateTime startDay;
  final DateTime endDay;
  final DateTime startUtc;
  final DateTime endUtc;

  SalesPeriod get previous => SalesPeriod.containing(
    kind,
    DateTime.utc(startDay.year, startDay.month, startDay.day - 1),
  );

  SalesPeriod get next => SalesPeriod.containing(kind, endDay);

  /// The same kind of period, for another wall date (the calendar button).
  SalesPeriod withKind(SalesPeriodKind other) =>
      SalesPeriod.containing(other, startDay);

  /// Whether [instant] falls inside.
  bool contains(DateTime? instant) {
    if (instant == null) return false;
    final utc = instant.toUtc();
    return !utc.isBefore(startUtc) && utc.isBefore(endUtc);
  }

  /// The period has started by [now] (there is nothing to see further on).
  bool startedBy(DateTime now) => !now.toUtc().isBefore(startUtc);

  /// How many bars the chart has: 24 hours, 7 days, the month's days, 12
  /// months.
  int get bucketCount => switch (kind) {
    SalesPeriodKind.day => 24,
    SalesPeriodKind.week => 7,
    SalesPeriodKind.month => DateTime.utc(
      startDay.year,
      startDay.month + 1,
      0,
    ).day,
    SalesPeriodKind.year => 12,
  };

  /// The bar [instant] goes in (by the wall clock: on the day the clocks
  /// fall back, both 1 o'clocks go in the 1 a.m. bar), or null outside.
  int? bucketOf(DateTime? instant) {
    if (!contains(instant)) return null;
    final wall = easternWall(instant!);
    return switch (kind) {
      SalesPeriodKind.day => wall.hour,
      SalesPeriodKind.week || SalesPeriodKind.month =>
        wallDate(wall).difference(startDay).inHours ~/ 24,
      SalesPeriodKind.year => wall.month - 1,
    };
  }

  /// The wall date each bar starts on (the hour bars all share the day).
  DateTime bucketDay(int index) => switch (kind) {
    SalesPeriodKind.day => startDay,
    SalesPeriodKind.week || SalesPeriodKind.month => DateTime.utc(
      startDay.year,
      startDay.month,
      startDay.day + index,
    ),
    SalesPeriodKind.year => DateTime.utc(startDay.year, index + 1, 1),
  };

  @override
  bool operator ==(Object other) =>
      other is SalesPeriod &&
      other.kind == kind &&
      other.startDay == startDay &&
      other.endDay == endDay;

  @override
  int get hashCode => Object.hash(kind, startDay, endDay);
}

// ---------------------------------------------------------------------------
// Figures.
// ---------------------------------------------------------------------------

/// One row of a breakdown: what [id] (a store, a seller, a payment method,
/// a product, a brand, a category) brought in.
class SalesBreakdownRow {
  const SalesBreakdownRow({
    required this.id,
    required this.label,
    this.cents = 0,
    this.count = 0,
  });

  final String id;

  /// A name snapshot from the sales ('' when the screen names it).
  final String label;
  final int cents;

  /// Sales (stores, sellers, methods) or pieces (products, brands,
  /// categories).
  final int count;
}

/// The method a sale's credit part is filed under in "By payment".
const salesOnCreditMethod = 'on_credit';

class SalesHistorySummary {
  const SalesHistorySummary({
    this.totalCents = 0,
    this.salesCount = 0,
    this.itemsSold = 0,
    this.paidNowCents = 0,
    this.creditCents = 0,
    this.creditCollectedCents = 0,
    this.costCents = 0,
    this.profitCents = 0,
    this.linesWithoutCost = 0,
    this.discountCents = 0,
    this.voidedCount = 0,
    this.buckets = const [],
    this.byStore = const [],
    this.bySeller = const [],
    this.byPayment = const [],
    this.topProducts = const [],
    this.topBrands = const [],
    this.topCategories = const [],
  });

  /// What was sold (voided sales left out), by the price charged.
  final int totalCents;
  final int salesCount;
  final int itemsSold;

  /// Of [totalCents]: taken at the counter, and left on credit.
  final int paidNowCents;
  final int creditCents;

  /// Credit money that came in during the period (on any sale).
  final int creditCollectedCents;

  /// Over the lines whose cost is known; [linesWithoutCost] were left out.
  final int costCents;
  final int profitCents;
  final int linesWithoutCost;
  final int discountCents;
  final int voidedCount;

  /// The chart: sales total per bar.
  final List<int> buckets;
  final List<SalesBreakdownRow> byStore;
  final List<SalesBreakdownRow> bySeller;
  final List<SalesBreakdownRow> byPayment;
  final List<SalesBreakdownRow> topProducts;
  final List<SalesBreakdownRow> topBrands;
  final List<SalesBreakdownRow> topCategories;

  /// The average sale, rounded to the cent; 0 with no sales.
  int get averageCents =>
      salesCount == 0 ? 0 : (totalCents / salesCount).round();

  bool get isEmpty => salesCount == 0 && voidedCount == 0;
}

List<SalesBreakdownRow> _ranked(
  Map<String, ({String label, int cents, int count})> rows, {
  bool byCount = false,
  int? limit,
}) {
  final list = [
    for (final e in rows.entries)
      SalesBreakdownRow(
        id: e.key,
        label: e.value.label,
        cents: e.value.cents,
        count: e.value.count,
      ),
  ];
  list.sort((a, b) {
    final primary = byCount
        ? b.count.compareTo(a.count)
        : b.cents.compareTo(a.cents);
    if (primary != 0) return primary;
    final secondary = byCount
        ? b.cents.compareTo(a.cents)
        : b.count.compareTo(a.count);
    if (secondary != 0) return secondary;
    return a.label.toLowerCase().compareTo(b.label.toLowerCase());
  });
  return limit != null && list.length > limit ? list.sublist(0, limit) : list;
}

void _add(
  Map<String, ({String label, int cents, int count})> into,
  String id,
  String label,
  int cents,
  int count,
) {
  final had = into[id];
  into[id] = (
    label: had == null || had.label.isEmpty ? label : had.label,
    cents: (had?.cents ?? 0) + cents,
    count: (had?.count ?? 0) + count,
  );
}

/// Adds up [sales] (and the credit [payments] that came in) for [period].
/// Sales outside the period are ignored, so a read that ran a little wide
/// never inflates a figure. Voided sales count only in [voidedCount].
SalesHistorySummary summarizeSales(
  SalesPeriod period,
  Iterable<InventorySale> sales, {
  Iterable<InventoryCreditPayment> payments = const [],
  int topLimit = 5,
}) {
  final buckets = List<int>.filled(period.bucketCount, 0);
  var total = 0, count = 0, items = 0, paidNow = 0, credit = 0;
  var cost = 0, costedRevenue = 0, noCost = 0, discount = 0, voided = 0;
  final stores = <String, ({String label, int cents, int count})>{};
  final sellers = <String, ({String label, int cents, int count})>{};
  final methods = <String, ({String label, int cents, int count})>{};
  final products = <String, ({String label, int cents, int count})>{};
  final brands = <String, ({String label, int cents, int count})>{};
  final categories = <String, ({String label, int cents, int count})>{};

  for (final sale in sales) {
    final bucket = period.bucketOf(sale.createdAt);
    if (bucket == null) continue;
    if (sale.voided) {
      voided++;
      continue;
    }
    count++;
    total += sale.totalCents;
    buckets[bucket] += sale.totalCents;
    final now = sale.paidAtSaleCents.clamp(0, sale.totalCents);
    final owed = sale.hadCredit ? sale.creditCents : 0;
    paidNow += now;
    credit += owed;
    _add(stores, sale.storeId, sale.storeName, sale.totalCents, 1);
    _add(sellers, sale.soldByStaffId, '', sale.totalCents, 1);
    if (now > 0) _add(methods, sale.paymentMethod, '', now, 1);
    if (owed > 0) _add(methods, salesOnCreditMethod, '', owed, 1);
    for (final line in sale.lines) {
      items += line.quantity;
      discount += line.discountCents;
      final known = line.costCents;
      if (known == null) {
        noCost++;
      } else {
        cost += known * line.quantity;
        costedRevenue += line.totalCents;
      }
      _add(
        products,
        line.itemId.isEmpty ? line.code : line.itemId,
        line.displayName,
        line.totalCents,
        line.quantity,
      );
      _add(
        brands,
        line.brandId.isNotEmpty ? line.brandId : line.brand.trim(),
        line.brand.trim(),
        line.totalCents,
        line.quantity,
      );
      _add(
        categories,
        line.categoryId.isNotEmpty ? line.categoryId : line.category.trim(),
        line.category.trim(),
        line.totalCents,
        line.quantity,
      );
    }
  }

  var collected = 0;
  for (final payment in payments) {
    if (payment.reverted || !period.contains(payment.createdAt)) continue;
    collected += payment.amountCents;
  }

  return SalesHistorySummary(
    totalCents: total,
    salesCount: count,
    itemsSold: items,
    paidNowCents: paidNow,
    creditCents: credit,
    creditCollectedCents: collected,
    costCents: cost,
    profitCents: costedRevenue - cost,
    linesWithoutCost: noCost,
    discountCents: discount,
    voidedCount: voided,
    buckets: buckets,
    byStore: _ranked(stores),
    bySeller: _ranked(sellers),
    byPayment: _ranked(methods),
    topProducts: _ranked(products, byCount: true, limit: topLimit),
    topBrands: _ranked(brands, limit: topLimit),
    topCategories: _ranked(categories, limit: topLimit),
  );
}

/// The change from [previous] to [current], in percent; null when there is
/// nothing to compare with (the period before had none).
double? percentChange(int current, int previous) {
  if (previous == 0) return null;
  return (current - previous) * 100 / previous.abs();
}

/// "+12%", "-3%", "0%" - whole percent, never "-0%".
String percentChangeText(double change) {
  final rounded = change.round();
  if (rounded == 0) return '0%';
  return rounded > 0 ? '+$rounded%' : '$rounded%';
}

// ---------------------------------------------------------------------------
// What happened.
// ---------------------------------------------------------------------------

enum SalesEventKind {
  sale,
  voided,
  creditPayment,
  creditReverted,
  stockAdded,
  stockSet,
  stockMoved,
}

/// One row of the timeline: when, what, and what it points at.
class SalesEvent {
  const SalesEvent({
    required this.kind,
    required this.at,
    this.saleId = '',
    this.itemId = '',
    this.cents = 0,
    this.quantity = 0,
    this.staffId = '',
    this.title = '',
    this.storeId = '',
    this.saleVoided = false,
    this.lineCount = 0,
  });

  final SalesEventKind kind;
  final DateTime at;

  /// The sale it belongs to (sales, voids, credit payments).
  final String saleId;

  /// The product (stock changes).
  final String itemId;
  final int cents;

  /// Pieces (a sale's items; a stock change's signed delta, or a set's
  /// count after).
  final int quantity;
  final String staffId;

  /// A name the event carries: the first line of a sale, the customer of a
  /// credit payment.
  final String title;
  final String storeId;

  /// On a sale row: the sale was voided since (it is marked, not removed).
  final bool saleVoided;

  /// On a sale row: how many lines it has ("Soap + 2 more").
  final int lineCount;

  bool get opensSale => saleId.isNotEmpty;
}

/// Every event of [period], newest first: each sale (marked when voided
/// since), each void, each credit payment and revert, and stock added, set
/// or moved. Movements that a sale or a void wrote are left out - the sale
/// row says it. A credit payment carries its customer's name when its sale
/// is among [sales].
List<SalesEvent> salesTimeline(
  SalesPeriod period, {
  Iterable<InventorySale> sales = const [],
  Iterable<InventoryCreditPayment> payments = const [],
  Iterable<InventoryMovement> movements = const [],
}) {
  final events = <SalesEvent>[];
  final customers = <String, String>{};
  for (final sale in sales) {
    final name = sale.credit?.customerName ?? '';
    if (name.isNotEmpty) customers[sale.id] = name;
    if (period.contains(sale.createdAt)) {
      final first = sale.lines.isEmpty ? null : sale.lines.first;
      events.add(
        SalesEvent(
          kind: SalesEventKind.sale,
          at: sale.createdAt!,
          saleId: sale.id,
          cents: sale.totalCents,
          quantity: sale.itemCount,
          staffId: sale.soldByStaffId,
          title: first?.displayName ?? '',
          storeId: sale.storeId,
          saleVoided: sale.voided,
          lineCount: sale.lines.length,
        ),
      );
    }
    if (sale.voided && period.contains(sale.voidedAt)) {
      events.add(
        SalesEvent(
          kind: SalesEventKind.voided,
          at: sale.voidedAt!,
          saleId: sale.id,
          cents: sale.totalCents,
          staffId: sale.voidedByStaffId,
          storeId: sale.storeId,
        ),
      );
    }
  }
  for (final p in payments) {
    if (period.contains(p.createdAt)) {
      events.add(
        SalesEvent(
          kind: SalesEventKind.creditPayment,
          at: p.createdAt!,
          saleId: p.saleId,
          cents: p.amountCents,
          staffId: p.receivedByStaffId,
          title: customers[p.saleId] ?? '',
          storeId: p.storeId,
        ),
      );
    }
    if (p.reverted && period.contains(p.revertedAt)) {
      events.add(
        SalesEvent(
          kind: SalesEventKind.creditReverted,
          at: p.revertedAt!,
          saleId: p.saleId,
          cents: p.amountCents,
          staffId: p.revertedByStaffId,
          title: customers[p.saleId] ?? '',
          storeId: p.storeId,
        ),
      );
    }
  }
  for (final m in movements) {
    if (!period.contains(m.createdAt)) continue;
    final kind = switch (m.type) {
      'add' || 'initial' => SalesEventKind.stockAdded,
      'set' => SalesEventKind.stockSet,
      _ when m.isTransfer => SalesEventKind.stockMoved,
      _ => null,
    };
    if (kind == null) continue;
    events.add(
      SalesEvent(
        kind: kind,
        at: m.createdAt!,
        itemId: m.itemId,
        quantity: kind == SalesEventKind.stockSet ? m.quantityAfter : m.delta,
        staffId: m.byStaffId,
        storeId: m.storeId,
      ),
    );
  }
  events.sort((a, b) {
    final t = b.at.compareTo(a.at);
    if (t != 0) return t;
    return a.kind.index.compareTo(b.kind.index);
  });
  return events;
}

/// The timeline in days, newest day first (wall dates of the shop's clock).
List<({DateTime day, List<SalesEvent> events})> salesTimelineByDay(
  List<SalesEvent> events,
) {
  final days = <({DateTime day, List<SalesEvent> events})>[];
  for (final event in events) {
    final day = wallDate(easternWall(event.at));
    if (days.isEmpty || days.last.day != day) {
      days.add((day: day, events: [event]));
    } else {
      days.last.events.add(event);
    }
  }
  return days;
}
