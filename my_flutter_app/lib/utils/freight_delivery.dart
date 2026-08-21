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

class FreightDeliveryPolicy {
  const FreightDeliveryPolicy({
    required this.offered,
    required this.fee,
    required this.feeCents,
  });

  final bool offered;
  final double fee;
  final int feeCents;
}

/// What a business publishes about delivering at the destination. Opted in
/// but unpriced is an unfinished setting, not free delivery.
FreightDeliveryPolicy freightDeliveryPolicy({
  required bool available,
  required double fee,
}) {
  final live = available && fee > 0;
  return FreightDeliveryPolicy(
    offered: live,
    fee: live ? fee : 0,
    feeCents: live ? (fee * 100).round() : 0,
  );
}

/// Whether a delivery choice is complete enough to book. An address is the
/// whole point of the option, so it is required rather than optional.
bool deliveryChoiceIsComplete({
  required bool wantsDelivery,
  required String receiverAddress,
}) {
  if (!wantsDelivery) return true;
  final address = receiverAddress.trim();
  return address.isNotEmpty && address.length <= maxReceiverAddressLength;
}
