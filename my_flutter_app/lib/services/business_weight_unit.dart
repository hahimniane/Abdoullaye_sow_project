/// The unit a business weighs and quotes in (docs/SHIPPING_SIMPLE_HOME.md
/// K4): its price list's when the list prices at least one route, otherwise
/// the lb / kg the person last picked on this device (pounds when none).
///
/// One rule, one controller, for every counter form that types a weight (the
/// register / line form, the Received sheet) and for the price fill: nothing
/// per screen. Mirrors `businessWeightUnit` and `useBusinessWeightUnit` in
/// the console (`admin_web/src/lib/business-price-list.ts`,
/// `components/business/use-business-weight-unit.ts`).
library;

import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'business_price_list.dart';
import 'package_request_service.dart';

/// The unit of a business: [unit] is "lb" or "kg"; [fromList] says the price
/// list decides it (the lb / kg choice beside a weight field shows only when
/// it does not).
typedef BusinessWeightUnitAnswer = ({String unit, bool fromList});

/// The pure rule: the list's unit when it prices a route, else [remembered]
/// ("kg"), else pounds.
BusinessWeightUnitAnswer businessWeightUnitOf(
  PackagePriceList? list,
  String? remembered,
) {
  if (list != null && list.routes.isNotEmpty) {
    return (unit: list.weightUnit == 'kg' ? 'kg' : 'lb', fromList: true);
  }
  return (unit: remembered == 'kg' ? 'kg' : 'lb', fromList: false);
}

/// The last unit this person picked on this device, for a business with no
/// price list. A per-device convenience only: storage can fail, and then the
/// answer is "none" and the default is pounds.
abstract class WeightUnitMemory {
  Future<String?> read();
  Future<void> write(String unit);
}

const weightUnitMemoryKey = 'laawol.weightUnit';

/// [WeightUnitMemory] in the app's preferences.
class PreferencesWeightUnitMemory implements WeightUnitMemory {
  const PreferencesWeightUnitMemory();

  @override
  Future<String?> read() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final value = prefs.getString(weightUnitMemoryKey);
      return value == 'kg' || value == 'lb' ? value : null;
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> write(String unit) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(weightUnitMemoryKey, unit);
    } catch (_) {
      // The choice lasts until the screen closes; asked again next time.
    }
  }
}

/// [WeightUnitMemory] in memory, for tests.
class MemoryWeightUnitMemory implements WeightUnitMemory {
  MemoryWeightUnitMemory([this.value]);

  String? value;

  @override
  Future<String?> read() async => value;

  @override
  Future<void> write(String unit) async => value = unit;
}

/// `packagePriceLists/{businessId}` as the app reads it; an app with no
/// Firebase (a widget test) has none, which reads as "no list".
Stream<PackagePriceList> watchBusinessPriceList(String businessId) {
  if (Firebase.apps.isEmpty) return const Stream<PackagePriceList>.empty();
  return FirebasePackageRequestService().watchPriceList(businessId);
}

/// The business's weight unit and price list, live. Owned by the sheet or
/// screen that needs it (one document, one listener); [choose] remembers the
/// person's lb / kg pick.
class BusinessWeightUnit extends ChangeNotifier {
  BusinessWeightUnit({
    required this.businessId,
    Stream<PackagePriceList> Function(String businessId)? watchList,
    WeightUnitMemory memory = const PreferencesWeightUnitMemory(),
    Duration timeout = const Duration(seconds: 8),
  }) : _memory = memory {
    _timer = Timer(timeout, _resolve);
    _sub = (watchList ?? watchBusinessPriceList)(businessId).listen(
      (list) {
        _list = list;
        _resolve();
      },
      // A refused or failed read is "no list": the remembered unit decides.
      onError: (Object _) => _resolve(),
      // So is a read that ends without an answer.
      onDone: _resolve,
    );
    memory.read().then((value) {
      if (_disposed || value == _remembered) return;
      _remembered = value;
      notifyListeners();
    });
  }

  final String businessId;
  final WeightUnitMemory _memory;
  StreamSubscription<PackagePriceList>? _sub;
  Timer? _timer;
  PackagePriceList? _list;
  String? _remembered;
  bool _resolved = false;
  bool _disposed = false;

  void _resolve() {
    _timer?.cancel();
    if (_disposed) return;
    _resolved = true;
    notifyListeners();
  }

  /// The price list once it has answered; null before, and for a business
  /// with none.
  PackagePriceList? get list => _list;

  /// The list has answered (or failed, or timed out): what [fromList] says
  /// can be trusted, so a screen shows the lb / kg choice only now.
  bool get resolved => _resolved;

  BusinessWeightUnitAnswer get _answer =>
      businessWeightUnitOf(_list, _remembered);

  /// "lb" or "kg".
  String get unit => _answer.unit;

  /// The price list decides the unit.
  bool get fromList => _answer.fromList;

  /// Whether the lb / kg choice belongs beside a weight field: only once it
  /// is known that there is no price list.
  bool get offersChoice => _resolved && !fromList;

  /// The person picked [next] beside a weight field.
  void choose(String next) {
    final unit = next == 'kg' ? 'kg' : 'lb';
    if (_remembered == unit) return;
    _remembered = unit;
    _memory.write(unit);
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _sub?.cancel();
    super.dispose();
  }
}
