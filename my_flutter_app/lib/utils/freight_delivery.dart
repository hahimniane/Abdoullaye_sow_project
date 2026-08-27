/// Delivering the parcel to the receiver's own address at the destination,
/// instead of the receiver collecting it from the business there.
///
/// Mirror of `my_flutter_app/functions/freight_delivery.js` (the authority)
/// and `admin_web/src/lib/freight-delivery.ts`. The server re-prices every
/// booking, so a drifted mirror shows a wrong preview only until the
/// callable answers.
library;

const maxDestinationDeliveryFee = 500.0;
const maxReceiverAddressLength = 300;

/// One place a business delivers to, and what it charges to go there.
class FreightDeliveryArea {
  const FreightDeliveryArea({
    required this.id,
    required this.name,
    required this.fee,
  });

  final String id;
  final String name;
  final double fee;

  int get feeCents => (fee * 100).round();
}

class FreightDeliveryPolicy {
  const FreightDeliveryPolicy({
    required this.offered,
    required this.areas,
    required this.fee,
    required this.feeCents,
  });

  final bool offered;

  /// The quartiers this business delivers to on this route. Empty when it
  /// prices the whole country as one number instead.
  final List<FreightDeliveryArea> areas;
  final double fee;
  final int feeCents;

  bool get pricesByArea => areas.isNotEmpty;
}

/// The places a business delivers to at one destination, cleaned.
///
/// A row nobody could be charged for - no name, no fee, or a repeat of one
/// already listed - is dropped rather than shown as a choice that cannot be
/// priced.
List<FreightDeliveryArea> freightDeliveryAreas(Object? raw) {
  if (raw is! List) return const [];
  final areas = <FreightDeliveryArea>[];
  final seen = <String>{};
  for (final entry in raw) {
    if (entry is! Map) continue;
    final name = (entry['name'] ?? '').toString().trim();
    final id = (entry['id'] ?? '').toString().trim();
    final fee = (entry['fee'] as num?)?.toDouble() ?? 0;
    if (id.isEmpty || name.isEmpty || fee <= 0 || seen.contains(id)) continue;
    seen.add(id);
    areas.add(FreightDeliveryArea(id: id, name: name, fee: fee));
  }
  return areas;
}

/// What is published about delivering at one destination.
///
/// Named places rather than one number per country, because that is how the
/// trade quotes it: Cosa is $20, Koloma is $10. Opted in with nowhere
/// listed and no flat price is an unfinished setting, not free delivery.
FreightDeliveryPolicy freightDeliveryPolicy({
  required bool available,
  required double fee,
  Object? areas,
}) {
  final resolved = freightDeliveryAreas(areas);
  final offered = available && (resolved.isNotEmpty || fee > 0);
  return FreightDeliveryPolicy(
    offered: offered,
    areas: offered ? resolved : const [],
    fee: offered && resolved.isEmpty ? fee : 0,
    feeCents: offered && resolved.isEmpty ? (fee * 100).round() : 0,
  );
}

/// Whether a delivery choice is complete enough to book.
///
/// An address is the whole point of the option. Where a business prices by
/// quartier, the quartier is too: the server refuses a delivery it cannot
/// price rather than guessing a fee for somewhere nobody listed.
bool deliveryChoiceIsComplete({
  required bool wantsDelivery,
  required String receiverAddress,
  FreightDeliveryPolicy? policy,
  String areaId = '',
}) {
  if (!wantsDelivery) return true;
  final address = receiverAddress.trim();
  if (address.isEmpty || address.length > maxReceiverAddressLength) {
    return false;
  }
  if (policy == null || !policy.pricesByArea) return true;
  return policy.areas.any((area) => area.id == areaId);
}
