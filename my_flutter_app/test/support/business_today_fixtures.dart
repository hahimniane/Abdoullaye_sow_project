import 'package:my_flutter_app/services/business_today.dart';
import 'package:my_flutter_app/services/business_today_service.dart';

/// A `getBusinessOverview` answer shaped as the server sends it (the Dart
/// twin of the console's `previewBusinessToday`), with only the sections the
/// services run, so the figures hang together: the money splits add up to
/// the total and the owed total is the sum of its parts.
Map<String, Object?> todayMap({
  bool shipping = false,
  bool parking = false,
  bool shop = false,
  bool carSales = false,
  bool barrels = false,
  bool freight = false,
  bool transport = false,
  bool finance = true,
}) {
  final byService = <String, int>{
    'packages': shipping ? 1842000 : 0,
    'invoices': 265000,
    'lot': parking ? 120000 : 0,
    'parking': parking ? 98000 : 0,
    'shop': shop ? 54250 : 0,
    'online': shipping ? 312500 : 0,
  };
  final total = byService.values.fold<int>(0, (a, b) => a + b);
  final byMethod = <String, int>{
    'cash': total - 65000 - 71250,
    'check': 65000,
    'card_in_person': 71250,
    'zelle': 0,
    'online': 0,
  };
  final owed = <String, int?>{
    'packagesCents': shipping ? 734500 : null,
    'invoicesCents': 182000,
    'parkingCents': parking ? 46000 : null,
    'shopCreditCents': shop ? 12500 : null,
  };
  final owedTotal = owed.values.fold<int>(0, (a, b) => a + (b ?? 0));
  return {
    'today': {
      'month': '2026-10',
      'previousMonth': '2026-09',
      'timeZone': 'America/New_York',
      'activity': shipping
          ? {
              'current': {
                'packages': 118,
                'barrels': 92,
                'carsShipped': 6,
                'containersShipped': 3,
              },
              'previous': {
                'packages': 101,
                'barrels': 84,
                'carsShipped': 4,
                'containersShipped': 2,
              },
              'change': {
                'packages': 16.8,
                'barrels': 9.5,
                'carsShipped': 50,
                'containersShipped': 50,
              },
            }
          : null,
      'containers': shipping
          ? {
              'loading': 2,
              'atSea': 1,
              'more': false,
              'list': [
                {
                  'id': 'c1',
                  'name': 'MSKU4820193',
                  'status': 'loading',
                  'destination': 'Guinea',
                  'pieces': 64,
                },
                {
                  'id': 'c3',
                  'name': 'CMAU7716402',
                  'status': 'shipped',
                  'destination': 'Guinea',
                  'pieces': 71,
                  'sailedAtMs': DateTime(2026, 10, 12).millisecondsSinceEpoch,
                },
              ],
            }
          : null,
      'queues': {
        'packageRequests': shipping ? 5 : null,
        'waitingPackages': shipping ? 23 : null,
        'containersLoading': shipping ? 2 : null,
        'barrelOrders': barrels ? 3 : null,
        'freightOrders': freight ? 1 : null,
        'carPurchases': carSales ? 2 : null,
        'transportRequests': transport ? 0 : null,
        'supportRequests': 1,
        'openInvoices': 4,
      },
      'owed': finance
          ? {...owed, 'totalCents': owedTotal}
          : {
              'packagesCents': null,
              'invoicesCents': null,
              'parkingCents': null,
              'shopCreditCents': null,
              'totalCents': null,
            },
      'money': finance
          ? {
              'current': {
                'totalCents': total,
                'payments': 148,
                'byService': byService,
                'byMethod': byMethod,
              },
              'previous': {'totalCents': 1610000, 'payments': 121},
              'change': 12.4,
            }
          : null,
      'shop': shop ? {'current': 41, 'previous': 38, 'change': 7.9} : null,
      'parking': parking
          ? {'inLot': 37, 'reserved': 2, 'spacesTotal': 60}
          : null,
      'listings': carSales ? {'active': 9} : null,
      'unavailable': <String>[],
    },
    'complete': true,
    'computedAtMs': DateTime(2026, 10, 21, 15, 5).millisecondsSinceEpoch,
  };
}

BusinessToday todayOf(Map<String, Object?> answer) =>
    BusinessTodayResponse.fromCallable(answer).today!;

/// A fake [BusinessTodayApi]: answers from [response] (or throws [error]) and
/// records what was asked, dismissed and refreshed.
class FakeBusinessTodayApi implements BusinessTodayApi {
  FakeBusinessTodayApi({
    this.response,
    this.error,
    this.events = const [],
    this.dismissError,
  });

  Object? response;
  Object? error;
  List<TodayLedgerEvent> events;
  Object? dismissError;

  int loads = 0;
  final List<bool> refreshes = [];
  final List<String> dismissed = [];

  @override
  Future<BusinessTodayResponse> load(
    String businessId, {
    bool refresh = false,
  }) async {
    loads++;
    refreshes.add(refresh);
    if (error != null) throw error!;
    return BusinessTodayResponse.fromCallable(response);
  }

  @override
  Future<List<TodayLedgerEvent>> ledgerAlerts(String businessId) async =>
      events;

  @override
  Future<void> dismissLedgerEvent(String eventId) async {
    if (dismissError != null) throw dismissError!;
    dismissed.add(eventId);
  }
}
