/// The purchases and viewings screen's text search and quick filters
/// ("Needs action", "Paid holds") as pure functions. Mirrors the website's
/// `purchaseNeedsAction`, `purchaseKind` and `filterRows` in
/// operations-panels.tsx, so the phone and the console agree on what needs
/// the business's attention.
library;

import '../models/car_purchase.dart';
import 'car_viewing_service.dart';

/// The quick filters offered beside the status chips.
enum PurchaseQuickFilter { all, needsAction, paidHolds }

/// Somebody is waiting on the business: a hold awaiting review, a pending
/// hold extension, or a viewing request nobody answered. Same test as the
/// console's `purchaseNeedsAction`.
bool purchaseNeedsAction(CarPurchase purchase) {
  return purchase.holdReviewRequiredAt != null ||
      purchase.extensionRequestStatus == 'pending' ||
      viewingAwaitingParty(purchase.purchaseStatus) == ViewingParty.business;
}

/// A paid hold: the console's `purchaseKind(row) === "hold"`. A viewing
/// reservation is never one.
bool purchaseIsPaidHold(CarPurchase purchase) {
  return purchase.paymentType == 'reservation_deposit';
}

/// The text the search reads: the console's car, buyer name, email, phone,
/// purchase and payment status, and destination country.
String purchaseSearchText(CarPurchase purchase) => [
  purchase.carTitle,
  purchase.buyerName,
  purchase.buyerEmail,
  purchase.buyerPhone,
  purchase.purchaseStatus,
  purchase.paymentStatus,
  purchase.destinationCountryName,
].join(' ').toLowerCase();

/// Records matching every word of [query] (any case) and the [quick] filter,
/// in the order given.
List<CarPurchase> filterPurchases(
  List<CarPurchase> purchases, {
  String query = '',
  PurchaseQuickFilter quick = PurchaseQuickFilter.all,
}) {
  final words = query
      .toLowerCase()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty)
      .toList();
  if (words.isEmpty && quick == PurchaseQuickFilter.all) return purchases;
  return [
    for (final purchase in purchases)
      if (switch (quick) {
            PurchaseQuickFilter.all => true,
            PurchaseQuickFilter.needsAction => purchaseNeedsAction(purchase),
            PurchaseQuickFilter.paidHolds => purchaseIsPaidHold(purchase),
          } &&
          (words.isEmpty || words.every(purchaseSearchText(purchase).contains)))
        purchase,
  ];
}

/// How many of [purchases] need action (the header count).
int purchaseNeedsActionCount(Iterable<CarPurchase> purchases) =>
    purchases.where(purchaseNeedsAction).length;
