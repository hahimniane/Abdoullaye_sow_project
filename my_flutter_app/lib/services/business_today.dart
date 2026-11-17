/// The business Today page, app side: what the server counted
/// (`getBusinessOverview`, functions/business_overview.js) turned into the
/// month tiles, the "Needs attention" rows and the money breakdown the
/// screen lays out.
///
/// A pure Dart mirror of the console's `admin_web/src/lib/business-today.ts`
/// (its tests are mirrored in test/business_today_test.dart). Worked out once
/// per answer; the screen never re-derives a figure while it builds. Where the
/// console carries English labels, this carries a key and the screen turns it
/// into the phone's language.
///
/// The server already cuts the answer to what one viewer may see: a figure
/// they may not see (or one that failed) arrives as null and is left out here,
/// so a row never links to a place the viewer cannot open.
library;

import 'package:intl/intl.dart';

import '../models/business_service.dart' as business_services;
import '../utils/business_permissions.dart';
import '../utils/callable_data.dart';
import 'lot_ledger.dart' show formatLotCents, lotDateOf;

// ---------------------------------------------------------------------------
// What the server answers.
// ---------------------------------------------------------------------------

class TodayActivityMonth {
  const TodayActivityMonth({
    this.pieces = 0,
    this.packages = 0,
    this.barrels = 0,
    this.carsReceived = 0,
    this.carsShipped = 0,
    this.containersShipped = 0,
    this.piecesShipped = 0,
  });

  final int pieces;
  final int packages;
  final int barrels;
  final int carsReceived;
  final int carsShipped;
  final int containersShipped;
  final int piecesShipped;

  factory TodayActivityMonth.fromMap(Map<String, dynamic> map) =>
      TodayActivityMonth(
        pieces: callableInt(map['pieces']),
        packages: callableInt(map['packages']),
        barrels: callableInt(map['barrels']),
        carsReceived: callableInt(map['carsReceived']),
        carsShipped: callableInt(map['carsShipped']),
        containersShipped: callableInt(map['containersShipped']),
        piecesShipped: callableInt(map['piecesShipped']),
      );
}

class TodayActivity {
  const TodayActivity({
    required this.current,
    required this.previous,
    this.change = const {},
  });

  final TodayActivityMonth current;
  final TodayActivityMonth previous;

  /// Percent against last month by field name; null where there is nothing
  /// to compare with.
  final Map<String, double?> change;
}

class TodayContainer {
  const TodayContainer({
    required this.id,
    required this.name,
    required this.status,
    required this.destination,
    required this.pieces,
    this.sailedAtMs,
  });

  final String id;
  final String name;
  final String status;
  final String destination;
  final int pieces;
  final int? sailedAtMs;

  factory TodayContainer.fromMap(Map<String, dynamic> map) => TodayContainer(
    id: callableString(map['id']),
    name: callableString(map['name']),
    status: callableString(map['status']),
    destination: callableString(map['destination']),
    pieces: callableInt(map['pieces']),
    sailedAtMs: map['sailedAtMs'] is num
        ? callableInt(map['sailedAtMs'])
        : null,
  );
}

class TodayContainers {
  const TodayContainers({
    required this.loading,
    required this.atSea,
    required this.list,
    required this.more,
  });

  final int loading;
  final int atSea;
  final List<TodayContainer> list;
  final bool more;
}

class TodayMoneyMonth {
  const TodayMoneyMonth({
    this.totalCents = 0,
    this.payments = 0,
    this.byService = const {},
    this.byMethod = const {},
  });

  final int totalCents;
  final int payments;
  final Map<String, int> byService;
  final Map<String, int> byMethod;

  factory TodayMoneyMonth.fromMap(Map<String, dynamic> map) {
    Map<String, int> ints(Object? raw) => {
      for (final e in callableMap(raw).entries) e.key: callableInt(e.value),
    };
    return TodayMoneyMonth(
      totalCents: callableInt(map['totalCents']),
      payments: callableInt(map['payments']),
      byService: ints(map['byService']),
      byMethod: ints(map['byMethod']),
    );
  }
}

/// What the viewer's own answer owes: a part is null when they may not see it.
class TodayOwed {
  const TodayOwed({
    this.packagesCents,
    this.invoicesCents,
    this.parkingCents,
    this.shopCreditCents,
    this.totalCents,
  });

  final int? packagesCents;
  final int? invoicesCents;
  final int? parkingCents;
  final int? shopCreditCents;
  final int? totalCents;

  int? byKey(TodayOwedKey key) => switch (key) {
    TodayOwedKey.packages => packagesCents,
    TodayOwedKey.invoices => invoicesCents,
    TodayOwedKey.parking => parkingCents,
    TodayOwedKey.shopCredit => shopCreditCents,
  };
}

enum TodayOwedKey { packages, invoices, parking, shopCredit }

class TodayMoney {
  const TodayMoney({
    required this.current,
    required this.previous,
    this.change,
  });

  final TodayMoneyMonth current;
  final TodayMoneyMonth previous;
  final double? change;
}

class TodayShop {
  const TodayShop({required this.current, required this.previous, this.change});

  final int current;
  final int previous;
  final double? change;
}

class TodayParking {
  const TodayParking({
    required this.inLot,
    required this.reserved,
    required this.spacesTotal,
  });

  final int inLot;
  final int reserved;
  final int spacesTotal;
}

/// What one viewer may see of the month. A section the viewer may not see
/// (or whose read failed) is null.
class BusinessToday {
  const BusinessToday({
    required this.month,
    required this.previousMonth,
    this.timeZone = 'America/New_York',
    this.activity,
    this.containers,
    this.queues = const {},
    this.owed = const TodayOwed(),
    this.money,
    this.shop,
    this.parking,
    this.listingsActive,
    this.unavailable = const [],
  });

  /// "yyyy-MM" in New York time.
  final String month;
  final String previousMonth;
  final String timeZone;
  final TodayActivity? activity;
  final TodayContainers? containers;

  /// How many of each kind of work is waiting, by [TodayQueueKey] name; a
  /// kind the viewer may not see is null (or absent).
  final Map<String, int?> queues;
  final TodayOwed owed;
  final TodayMoney? money;
  final TodayShop? shop;
  final TodayParking? parking;
  final int? listingsActive;
  final List<String> unavailable;

  factory BusinessToday.fromMap(Map<String, dynamic> map) {
    int? optInt(Object? v) => v == null ? null : callableInt(v);
    double? optDouble(Object? v) =>
        v is num && v.isFinite ? v.toDouble() : null;

    TodayActivity? activity;
    final a = map['activity'];
    if (a is Map) {
      final am = callableMap(a);
      final change = <String, double?>{
        for (final e in callableMap(am['change']).entries)
          e.key: optDouble(e.value),
      };
      activity = TodayActivity(
        current: TodayActivityMonth.fromMap(callableMap(am['current'])),
        previous: TodayActivityMonth.fromMap(callableMap(am['previous'])),
        change: change,
      );
    }

    TodayContainers? containers;
    final c = map['containers'];
    if (c is Map) {
      final cm = callableMap(c);
      containers = TodayContainers(
        loading: callableInt(cm['loading']),
        atSea: callableInt(cm['atSea']),
        more: callableBool(cm['more']),
        list: [
          for (final row
              in (cm['list'] is List ? cm['list'] as List : const []))
            if (row is Map) TodayContainer.fromMap(callableMap(row)),
        ],
      );
    }

    final queues = <String, int?>{
      for (final e in callableMap(map['queues']).entries)
        e.key: optInt(e.value),
    };

    final o = callableMap(map['owed']);
    final owed = TodayOwed(
      packagesCents: optInt(o['packagesCents']),
      invoicesCents: optInt(o['invoicesCents']),
      parkingCents: optInt(o['parkingCents']),
      shopCreditCents: optInt(o['shopCreditCents']),
      totalCents: optInt(o['totalCents']),
    );

    TodayMoney? money;
    final m = map['money'];
    if (m is Map) {
      final mm = callableMap(m);
      money = TodayMoney(
        current: TodayMoneyMonth.fromMap(callableMap(mm['current'])),
        previous: TodayMoneyMonth.fromMap(callableMap(mm['previous'])),
        change: optDouble(mm['change']),
      );
    }

    TodayShop? shop;
    final s = map['shop'];
    if (s is Map) {
      final sm = callableMap(s);
      shop = TodayShop(
        current: callableInt(sm['current']),
        previous: callableInt(sm['previous']),
        change: optDouble(sm['change']),
      );
    }

    TodayParking? parking;
    final p = map['parking'];
    if (p is Map) {
      final pm = callableMap(p);
      parking = TodayParking(
        inLot: callableInt(pm['inLot']),
        reserved: callableInt(pm['reserved']),
        spacesTotal: callableInt(pm['spacesTotal']),
      );
    }

    int? listingsActive;
    final l = map['listings'];
    if (l is Map) listingsActive = callableInt(callableMap(l)['active']);

    return BusinessToday(
      month: callableString(map['month']),
      previousMonth: callableString(map['previousMonth']),
      timeZone: callableString(map['timeZone'], 'America/New_York'),
      activity: activity,
      containers: containers,
      queues: queues,
      owed: owed,
      money: money,
      shop: shop,
      parking: parking,
      listingsActive: listingsActive,
      unavailable: [
        for (final v
            in (map['unavailable'] is List
                ? map['unavailable'] as List
                : const []))
          v.toString(),
      ],
    );
  }
}

/// The whole `getBusinessOverview` answer.
class BusinessTodayResponse {
  const BusinessTodayResponse({
    this.today,
    this.complete = true,
    this.computedAt,
    this.cached = false,
  });

  final BusinessToday? today;

  /// False when some read failed on the server, so a total may be low.
  final bool complete;
  final DateTime? computedAt;
  final bool cached;

  factory BusinessTodayResponse.fromCallable(Object? data) {
    final map = callableMap(data);
    final today = map['today'];
    final at = map['computedAtMs'];
    return BusinessTodayResponse(
      today: today is Map ? BusinessToday.fromMap(callableMap(today)) : null,
      complete: map['complete'] != false,
      computedAt: at is num && at.isFinite
          ? DateTime.fromMillisecondsSinceEpoch(at.toInt())
          : null,
      cached: callableBool(map['cached']),
    );
  }
}

// ---------------------------------------------------------------------------
// Tiles.
// ---------------------------------------------------------------------------

/// A whole non-negative count: rounded, anything unusable is zero.
int _n(Object? value) {
  final x = callableDouble(value).round();
  return x > 0 ? x : 0;
}

enum TodayTileKey {
  packages,
  barrels,
  carsShipped,
  containers,
  collected,
  owed,
  shopSales,
  inLot,
  listings,
}

enum TodayTileKind { count, money }

enum TodayNoteKey { openNow, payments, spaces }

enum TodayTone { neutral, good, money, attention }

class TodayTileNote {
  const TodayTileNote(this.key, this.value, this.kind);

  final TodayNoteKey key;
  final int value;
  final TodayTileKind kind;
}

class TodayTile {
  const TodayTile({
    required this.key,
    required this.kind,
    required this.value,
    required this.compares,
    required this.tone,
    this.change,
    this.note,
  });

  final TodayTileKey key;
  final TodayTileKind kind;

  /// A whole count, or cents for money.
  final int value;

  /// Percent against last month; null when there is nothing to compare.
  final double? change;

  /// Whether the tile compares with last month at all (a balance does not).
  final bool compares;
  final TodayTileNote? note;
  final TodayTone tone;
}

/// The month's headline tiles, in reading order: what came in and went out,
/// the money, then the shop, the lot and the listings - each only when the
/// server sent it for this viewer.
List<TodayTile> todayTiles(BusinessToday? today) {
  if (today == null) return const [];
  final tiles = <TodayTile>[];
  final activity = today.activity;
  if (activity != null) {
    TodayTile count(
      TodayTileKey key,
      int value,
      String field, {
      TodayTileNote? note,
    }) => TodayTile(
      key: key,
      kind: TodayTileKind.count,
      tone: TodayTone.neutral,
      compares: true,
      value: _n(value),
      change: activity.change[field],
      note: note,
    );
    final containers = today.containers;
    tiles.addAll([
      count(TodayTileKey.packages, activity.current.packages, 'packages'),
      count(TodayTileKey.barrels, activity.current.barrels, 'barrels'),
      count(
        TodayTileKey.carsShipped,
        activity.current.carsShipped,
        'carsShipped',
      ),
      count(
        TodayTileKey.containers,
        activity.current.containersShipped,
        'containersShipped',
        note: containers == null
            ? null
            : TodayTileNote(
                TodayNoteKey.openNow,
                _n(containers.loading) + _n(containers.atSea),
                TodayTileKind.count,
              ),
      ),
    ]);
  }
  final money = today.money;
  if (money != null) {
    tiles.add(
      TodayTile(
        key: TodayTileKey.collected,
        kind: TodayTileKind.money,
        tone: TodayTone.good,
        compares: true,
        value: _n(money.current.totalCents),
        change: money.change,
        note: TodayTileNote(
          TodayNoteKey.payments,
          _n(money.current.payments),
          TodayTileKind.count,
        ),
      ),
    );
  }
  if (today.owed.totalCents != null) {
    tiles.add(
      TodayTile(
        key: TodayTileKey.owed,
        kind: TodayTileKind.money,
        tone: TodayTone.attention,
        compares: false,
        value: _n(today.owed.totalCents),
      ),
    );
  }
  final shop = today.shop;
  if (shop != null) {
    tiles.add(
      TodayTile(
        key: TodayTileKey.shopSales,
        kind: TodayTileKind.count,
        tone: TodayTone.neutral,
        compares: true,
        value: _n(shop.current),
        change: shop.change,
      ),
    );
  }
  final parking = today.parking;
  if (parking != null) {
    tiles.add(
      TodayTile(
        key: TodayTileKey.inLot,
        kind: TodayTileKind.count,
        tone: TodayTone.neutral,
        compares: false,
        value: _n(parking.inLot),
        note: parking.spacesTotal > 0
            ? TodayTileNote(
                TodayNoteKey.spaces,
                _n(parking.spacesTotal),
                TodayTileKind.count,
              )
            : null,
      ),
    );
  }
  final listings = today.listingsActive;
  if (listings != null) {
    tiles.add(
      TodayTile(
        key: TodayTileKey.listings,
        kind: TodayTileKind.count,
        tone: TodayTone.neutral,
        compares: false,
        value: _n(listings),
      ),
    );
  }
  return tiles;
}

// ---------------------------------------------------------------------------
// Needs attention.
// ---------------------------------------------------------------------------

/// The console tab a row opens; the screen maps it to the phone's own place.
enum TodayTab {
  containers,
  barrels,
  freight,
  purchases,
  transport,
  cases,
  invoices,
  parking,
  inventory,
}

/// Which list of Containers a row opens on.
enum TodayContainersView { none, requests, waiting }

/// The kinds of work counted in [BusinessToday.queues].
enum TodayQueueKey {
  packageRequests,
  waitingPackages,
  containersLoading,
  barrelOrders,
  freightOrders,
  carPurchases,
  transportRequests,
  supportRequests,
  openInvoices,
}

/// One row of "Needs attention". [key] names its label.
class TodayAttentionItem {
  const TodayAttentionItem({
    required this.key,
    required this.count,
    required this.amountCents,
    required this.tab,
    required this.view,
  });

  final String key;

  /// How many; null for a balance that is only an amount.
  final int? count;

  /// What is owed on it, in cents, when the viewer may see that.
  final int? amountCents;
  final TodayTab tab;
  final TodayContainersView view;
}

class _AttentionSpec {
  const _AttentionSpec(
    this.key,
    this.tab, {
    this.view = TodayContainersView.none,
    this.count,
    this.amount,
  });

  final String key;
  final TodayTab tab;
  final TodayContainersView view;
  final TodayQueueKey? count;
  final TodayOwedKey? amount;
}

// Work first (it has a customer waiting), then money to collect.
const _attention = <_AttentionSpec>[
  _AttentionSpec(
    'packageRequests',
    TodayTab.containers,
    view: TodayContainersView.requests,
    count: TodayQueueKey.packageRequests,
  ),
  _AttentionSpec(
    'waitingPackages',
    TodayTab.containers,
    view: TodayContainersView.waiting,
    count: TodayQueueKey.waitingPackages,
  ),
  _AttentionSpec(
    'containersLoading',
    TodayTab.containers,
    count: TodayQueueKey.containersLoading,
  ),
  _AttentionSpec(
    'barrelOrders',
    TodayTab.barrels,
    count: TodayQueueKey.barrelOrders,
  ),
  _AttentionSpec(
    'freightOrders',
    TodayTab.freight,
    count: TodayQueueKey.freightOrders,
  ),
  _AttentionSpec(
    'carPurchases',
    TodayTab.purchases,
    count: TodayQueueKey.carPurchases,
  ),
  _AttentionSpec(
    'transportRequests',
    TodayTab.transport,
    count: TodayQueueKey.transportRequests,
  ),
  _AttentionSpec(
    'supportRequests',
    TodayTab.cases,
    count: TodayQueueKey.supportRequests,
  ),
  _AttentionSpec(
    'packagesOwed',
    TodayTab.containers,
    amount: TodayOwedKey.packages,
  ),
  _AttentionSpec(
    'openInvoices',
    TodayTab.invoices,
    count: TodayQueueKey.openInvoices,
    amount: TodayOwedKey.invoices,
  ),
  _AttentionSpec('parkingOwed', TodayTab.parking, amount: TodayOwedKey.parking),
  _AttentionSpec(
    'shopCredit',
    TodayTab.inventory,
    amount: TodayOwedKey.shopCredit,
  ),
];

/// The rows of "Needs attention": only what has something waiting (a count or
/// an amount above zero), each with the place that can act on it. Figures the
/// viewer may not see are null and left out.
List<TodayAttentionItem> todayAttention(BusinessToday? today) {
  if (today == null) return const [];
  final items = <TodayAttentionItem>[];
  for (final spec in _attention) {
    final rawCount = spec.count == null ? null : today.queues[spec.count!.name];
    final rawAmount = spec.amount == null
        ? null
        : today.owed.byKey(spec.amount!);
    final count = rawCount == null ? null : _n(rawCount);
    final amount = rawAmount == null ? null : _n(rawAmount);
    if (!((count ?? 0) > 0) && !((amount ?? 0) > 0)) continue;
    items.add(
      TodayAttentionItem(
        key: spec.key,
        count: count,
        amountCents: amount,
        tab: spec.tab,
        view: spec.view,
      ),
    );
  }
  return items;
}

// ---------------------------------------------------------------------------
// Money.
// ---------------------------------------------------------------------------

/// Where money comes from, in display order.
const todayServiceKeys = <String>[
  'packages',
  'invoices',
  'lot',
  'parking',
  'shop',
  'online',
];

/// How it was paid, in display order.
const todayMethodKeys = <String>[
  'cash',
  'zelle',
  'cashapp',
  'venmo',
  'check',
  'card_in_person',
  'online',
  'other',
];

class TodayMoneyRow {
  const TodayMoneyRow({
    required this.key,
    required this.cents,
    required this.percent,
  });

  final String key;
  final int cents;

  /// Share of the month's total, 0..100 (whole percent, for the bar).
  final int percent;
}

List<TodayMoneyRow> _moneyRows(Map<String, int>? values, int total) {
  final rows =
      [
        for (final e in (values ?? const <String, int>{}).entries)
          (key: e.key, cents: _n(e.value)),
      ].where((r) => r.cents > 0).toList()..sort((a, b) {
        final byCents = b.cents.compareTo(a.cents);
        return byCents != 0 ? byCents : a.key.compareTo(b.key);
      });
  return [
    for (final r in rows)
      TodayMoneyRow(
        key: r.key,
        cents: r.cents,
        percent: total > 0
            ? (r.cents / total * 100).round().clamp(1, 1 << 30)
            : 0,
      ),
  ];
}

class TodayMoneyBreakdown {
  const TodayMoneyBreakdown({
    required this.totalCents,
    required this.services,
    required this.methods,
  });

  final int totalCents;
  final List<TodayMoneyRow> services;
  final List<TodayMoneyRow> methods;
}

/// The month's money by service and by method: non-empty rows, largest first.
TodayMoneyBreakdown todayMoneyBreakdown(TodayMoneyMonth? month) {
  final total = _n(month?.totalCents);
  return TodayMoneyBreakdown(
    totalCents: total,
    services: _moneyRows(month?.byService, total),
    methods: _moneyRows(month?.byMethod, total),
  );
}

class TodayOwedRow {
  const TodayOwedRow(this.key, this.cents);

  final TodayOwedKey key;
  final int cents;
}

/// What customers owe, by where: only the parts read and above zero.
List<TodayOwedRow> todayOwedRows(BusinessToday? today) {
  if (today == null) return const [];
  return [
    for (final key in TodayOwedKey.values)
      if (_n(today.owed.byKey(key)) > 0)
        TodayOwedRow(key, _n(today.owed.byKey(key))),
  ];
}

const _moneyReads = <String>{
  'packagePayments',
  'invoicePayments',
  'lotPayments',
  'shopSales',
  'shopCreditPayments',
  'parking',
  'barrels',
  'freight',
  'transport',
  'purchases',
};

/// Whether a money figure was shown with every source read.
bool todayMoneyComplete(BusinessToday? today) =>
    !(today?.unavailable ?? const <String>[]).any(_moneyReads.contains);

/// Everything the screen shows, worked out once when an answer arrives.
class TodayViewModel {
  TodayViewModel(this.today)
    : tiles = todayTiles(today),
      attention = todayAttention(today),
      money = todayMoneyBreakdown(today.money?.current),
      owedRows = todayOwedRows(today),
      moneyComplete = todayMoneyComplete(today);

  final BusinessToday today;
  final List<TodayTile> tiles;
  final List<TodayAttentionItem> attention;
  final TodayMoneyBreakdown money;
  final List<TodayOwedRow> owedRows;
  final bool moneyComplete;
}

// ---------------------------------------------------------------------------
// Lot ledger alerts (the unacknowledged `lotLedgerAudit` changes).
// ---------------------------------------------------------------------------

/// One ledger change waiting to be seen.
class TodayLedgerEvent {
  const TodayLedgerEvent({
    required this.id,
    required this.entityType,
    required this.action,
    required this.summary,
    required this.byStaffId,
    required this.at,
  });

  final String id;
  final String entityType;
  final String action;
  final String summary;
  final String byStaffId;
  final DateTime? at;

  factory TodayLedgerEvent.fromMap(String id, Map<String, dynamic> d) {
    String s(Object? v, int max) {
      final t = (v ?? '').toString().trim();
      return t.length > max ? t.substring(0, max) : t;
    }

    return TodayLedgerEvent(
      id: id,
      entityType: s(d['entityType'], 60),
      action: s(d['action'], 40),
      summary: s(d['summary'], 300),
      byStaffId: s(d['byStaffId'], 120),
      at: lotDateOf(d['at']),
    );
  }
}

enum TodayLedgerTitle {
  parkingLinked,
  parkingUnlinked,
  staffRepaid,
  staffRepaymentVoided,
  entryVoided,
  paymentReceived,
  entryEdited,
}

/// Mirrors the console's `ledgerEventTitle`: the staff-expense entries say
/// what happened; every other entry keeps the wording it always had.
TodayLedgerTitle todayLedgerTitle(TodayLedgerEvent event) {
  if (event.entityType == 'staff_parking_link') {
    return event.action == 'unlinked'
        ? TodayLedgerTitle.parkingUnlinked
        : TodayLedgerTitle.parkingLinked;
  }
  if (event.entityType == 'staff_repayment') {
    return event.action == 'voided'
        ? TodayLedgerTitle.staffRepaymentVoided
        : TodayLedgerTitle.staffRepaid;
  }
  if (event.action == 'voided') return TodayLedgerTitle.entryVoided;
  if (event.action == 'paid') return TodayLedgerTitle.paymentReceived;
  return TodayLedgerTitle.entryEdited;
}

/// How many ledger alerts Today shows, newest first (as the console does).
const todayLedgerAlertLimit = 6;

/// Unacknowledged events, newest first, at most [todayLedgerAlertLimit].
List<TodayLedgerEvent> todayLedgerAlerts(
  Iterable<TodayLedgerEvent> events, {
  Set<String> dismissed = const {},
}) {
  final list = events.where((e) => !dismissed.contains(e.id)).toList()
    ..sort(
      (a, b) => (b.at?.millisecondsSinceEpoch ?? 0).compareTo(
        a.at?.millisecondsSinceEpoch ?? 0,
      ),
    );
  return list.take(todayLedgerAlertLimit).toList();
}

/// Whether Today shows lot-ledger alerts: the business runs parking and this
/// person holds the ledger permission (the server refuses a dismiss without it).
bool todayShowsLedgerAlerts({
  required Iterable<String> services,
  required bool Function(String permission) hasPermission,
}) =>
    business_services.hasBusinessService(
      services,
      business_services.BusinessServiceKey.carParking,
    ) &&
    hasPermission(BusinessPermission.ledger);

// ---------------------------------------------------------------------------
// Formatting.
// ---------------------------------------------------------------------------

/// Cents as US dollars in the phone's language, through the app's one money
/// formatter: "$1,284.50" / "1 284,50 $"; [whole] drops the cents for a tile
/// ("$1,285"), rounding to the nearest dollar. Negative or unusable is $0.
String formatTodayMoney(
  Object? cents, {
  String language = 'en',
  bool whole = false,
}) {
  final value = _n(cents);
  if (!whole) return formatLotCents(value, language: language);
  final rounded = ((value + 50) ~/ 100) * 100;
  final text = formatLotCents(rounded, language: language);
  return text.replaceFirst(RegExp(r'[.,]00(?=\s\$$|$)'), '');
}

/// "12", "1,284" / "1 284": a count with the language's grouping.
String formatTodayCount(int value, {String language = 'en'}) =>
    NumberFormat.decimalPattern(
      language == 'fr' ? 'fr' : 'en',
    ).format(_n(value));

/// "+12%" / "−8%" / "0%" ("+12 %" in French); '' when there is nothing to
/// compare with.
String formatTodayChange(double? pct, {String language = 'en'}) {
  if (pct == null || !pct.isFinite) return '';
  final rounded = pct.round();
  final digits = NumberFormat.decimalPattern(
    language == 'fr' ? 'fr' : 'en',
  ).format(rounded.abs());
  final sign = rounded > 0 ? '+' : (rounded < 0 ? '−' : '');
  return language == 'fr' ? '$sign$digits %' : '$sign$digits%';
}

enum TodayChangeTone { up, down, flat }

TodayChangeTone todayChangeTone(double? pct) {
  if (pct == null || !pct.isFinite) return TodayChangeTone.flat;
  final rounded = pct.round();
  if (rounded > 0) return TodayChangeTone.up;
  if (rounded < 0) return TodayChangeTone.down;
  return TodayChangeTone.flat;
}

/// The first day of the month "yyyy-MM" names, or null when it is not one.
DateTime? todayMonthStart(String key) {
  final m = RegExp(r'^(\d{4})-(\d{2})$').firstMatch(key.trim());
  if (m == null) return null;
  final month = int.parse(m.group(2)!);
  if (month < 1 || month > 12) return null;
  return DateTime(int.parse(m.group(1)!), month);
}
