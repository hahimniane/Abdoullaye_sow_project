import '../utils/callable_data.dart';
import 'container_manifest.dart'
    show ContainerLine, ShippingContainer, containerStatusLoading;
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// A business's month in pieces (docs/PACKAGE_REQUESTS.md, "Monthly
/// volume"): what the `getBusinessVolume` callable answers. The numbers are
/// counted on the server (functions `volume_counts.js`); the app only reads
/// them, as the business console's Volume tab does.
class BusinessVolume {
  const BusinessVolume({
    required this.month,
    required this.pieces,
    required this.barrels,
    required this.packages,
    required this.cars,
    required this.containersShipped,
  });

  /// "yyyy-mm" in New York time.
  final String month;
  final int pieces;
  final int barrels;
  final int packages;
  final int cars;
  final int containersShipped;

  factory BusinessVolume.fromCallable(Object? data) {
    final map = callableMap(data);
    final totals = callableMap(map['totals']);
    int count(String key) {
      final n = callableInt(totals[key]);
      return n < 0 ? 0 : n;
    }

    return BusinessVolume(
      month: callableString(map['month']),
      pieces: count('pieces'),
      barrels: count('barrels'),
      packages: count('packages'),
      cars: count('cars'),
      containersShipped: count('containersShipped'),
    );
  }

  /// The first day of [month] (a calendar date, for the month's name), or
  /// null when the server sent none.
  DateTime? get monthStart {
    final match = RegExp(r'^(\d{4})-(\d{2})$').firstMatch(month);
    if (match == null) return null;
    final m = int.parse(match.group(2)!);
    if (m < 1 || m > 12) return null;
    return DateTime(int.parse(match.group(1)!), m);
  }
}

/// The request for the current month (the server picks it in New York time).
Map<String, Object?> businessVolumeRequest(String businessId, {String? month}) =>
    {
      'businessId': businessId,
      if (month != null && month.isNotEmpty) 'month': month,
    };

class BusinessVolumeService {
  const BusinessVolumeService({this.caller = callContainerCallable});

  final ContainerCallableCaller caller;

  Future<BusinessVolume> thisMonth(String businessId) async =>
      BusinessVolume.fromCallable(
        await caller('getBusinessVolume', businessVolumeRequest(businessId)),
      );
}

/// What a business's month in pieces is counted from, as a phone holding
/// its live lines and containers sees it: the lines, their pieces and
/// receipt days, and which containers have sailed. Any write that changes
/// the count changes this (a payment or a phone edit does not), so the
/// "This month" card reloads on it ([ContainerVolumeCard.refreshKey]).
String volumeFeedSignature(
  Iterable<ContainerLine> lines,
  Iterable<ShippingContainer> containers,
) {
  var count = 0, pieces = 0, received = 0;
  for (final line in lines) {
    count++;
    pieces += line.pieceCount;
    received = received ^ (line.receivedAt?.millisecondsSinceEpoch ?? 0);
  }
  var sailed = 0, sailedIds = 0;
  for (final box in containers) {
    if (box.status != containerStatusLoading) {
      sailed++;
      sailedIds = sailedIds ^ box.id.hashCode;
    }
  }
  return '$count:$pieces:$received:$sailed:$sailedIds';
}
