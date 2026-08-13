/// Ordering the businesses a customer is choosing between, for any service.
///
/// Mirrors `functions/service_ranking.js` and
/// `admin_web/src/lib/service-ranking.ts`. Keep the three in step: the rules
/// are stated in the backend module in full, and all three sides carry the
/// same test cases.
///
/// Sorts, not filters. With two or three businesses on a route, filtering to
/// "cheapest" would hide the alternative - including the one that stands
/// behind the parcel. Sorting shows everything, best first.
library;

import '../models/business_destination_option.dart';
import 'freight_categories.dart';
import 'freight_coverage.dart';

/// Every way a customer can order the businesses on offer.
enum ServiceSort { cheapest, coverage, fastest, rated }

/// Which of those each service can actually answer.
///
/// Derived from what the data holds, not from what would be nice: car
/// transport is priced by bid after review, car sales put the price on the
/// listing rather than the business, and freight is the only service with a
/// loss policy. Rating works everywhere, because every business carries one.
///
/// A service left with a single sort gets no control: one choice is not a
/// choice.
const Map<String, List<ServiceSort>> kServiceSorts = {
  'barrelShipping': [ServiceSort.cheapest, ServiceSort.fastest,
      ServiceSort.rated],
  'sharedBarrels': [ServiceSort.cheapest, ServiceSort.fastest,
      ServiceSort.rated],
  'freight': [ServiceSort.cheapest, ServiceSort.coverage, ServiceSort.fastest,
      ServiceSort.rated],
  'carParking': [ServiceSort.cheapest, ServiceSort.rated],
  'carTransport': [ServiceSort.rated],
  'carSales': [ServiceSort.rated],
};

/// The order used when the customer has not chosen one.
const ServiceSort kDefaultServiceSort = ServiceSort.cheapest;

/// The rating an unreviewed business is treated as having. Mirrors
/// BAYESIAN_PRIOR_MEAN in functions/business_review.js, which is what the
/// platform damps every real score towards.
const double kBayesianPriorMean = 3.8;

/// The sorts a service offers, in the order they should be shown.
List<ServiceSort> sortsForService(String service) =>
    kServiceSorts[service] ?? const [];

/// The sort to start on, which is not always cheapest - car transport has no
/// price to be cheapest by.
ServiceSort? defaultSortForService(String service) {
  final sorts = sortsForService(service);
  if (sorts.isEmpty) return null;
  return sorts.contains(kDefaultServiceSort) ? kDefaultServiceSort : sorts.first;
}

/// Below this many options a sort control is noise: there is nothing to order.
const int kMinOptionsForSort = 3;

/// Sorting value for "no answer", chosen so it always sorts last.
const double kUnknownSortValue = double.infinity;

/// The modes to judge a business on.
///
/// The mobile search list ranks before the customer has chosen air or sea, so
/// an empty mode means "whichever this business does best". Judging everyone
/// on one fixed mode would bury an air-only business under a sea ranking for
/// a service it never claimed to offer. The web console picks a mode first and
/// always passes one.
List<String> _modesToJudge(String mode) =>
    mode.isEmpty ? const ['air', 'sea'] : [mode];

/// What this business charges for what the customer described.
///
/// Car transport is quoted by bid after review and a car's price is on the
/// listing rather than the business, so both return unknown - which is why
/// neither offers a "cheapest" sort at all.
double serviceOptionTotal(
  BusinessDestinationOption option, {
  required String service,
  required double weightKg,
  required String mode,
  String categoryId = '',
  double declaredValue = 0,
  int quantity = 1,
}) {
  if (service == 'freight') {
    return freightOptionTotal(
      option,
      weightKg: weightKg,
      mode: mode,
      categoryId: categoryId,
      declaredValue: declaredValue,
    );
  }
  if (service == 'barrelShipping') {
    final price = option.country.barrelShippingPrice;
    if (price <= 0) return kUnknownSortValue;
    return price * (quantity > 0 ? quantity : 1);
  }
  return kUnknownSortValue;
}

/// What one business would charge for this exact parcel.
///
/// Built from the same helpers as the quote the customer will be shown, so the
/// order of the list and the price on the card can never disagree.
double freightOptionTotal(
  BusinessDestinationOption option, {
  required double weightKg,
  required String mode,
  String categoryId = '',
  double declaredValue = 0,
}) {
  if (mode.isEmpty) {
    var best = kUnknownSortValue;
    for (final candidate in _modesToJudge(mode)) {
      final total = freightOptionTotal(
        option,
        weightKg: weightKg,
        mode: candidate,
        categoryId: categoryId,
        declaredValue: declaredValue,
      );
      if (total < best) best = total;
    }
    return best;
  }

  final ratePerKg = option.country.freightRatePerKg(mode);
  if (ratePerKg <= 0 || weightKg <= 0) return kUnknownSortValue;

  final shipping = freightShippingFee(
    weightKg: weightKg,
    ratePerKg: ratePerKg,
    multiplier: freightCategoryMultiplier(option.freightCategories, categoryId),
  );

  final quote = quoteFreightCoverage(
    policy: option.freightCoverage ?? FreightCoveragePolicy.none,
    declaredValue: declaredValue,
  );
  // A declared value this business will not accept sinks the option rather
  // than making it look cheapest: ranking a business first when it would
  // refuse the parcel sends the customer to a dead end.
  if (quote.error != null) return kUnknownSortValue;

  return shipping + quote.coverageFee;
}

/// How long this business says it takes - the near end of its estimate.
///
/// Read from the delivery estimate, not from the departure days: those are
/// weekday names for when a shipment leaves, not a duration.
double serviceOptionDays(
  BusinessDestinationOption option,
  String service, [
  String mode = '',
]) {
  // Shared barrels ride in the same containers as a solo barrel, so they
  // inherit the barrel estimate rather than carrying one of their own.
  if (service == 'barrelShipping' || service == 'sharedBarrels') {
    final days = option.country.barrelShippingDeliveryEstimateMinDays;
    if (days == null || days <= 0) return kUnknownSortValue;
    return days.toDouble();
  }
  if (service != 'freight') return kUnknownSortValue;
  return freightOptionDays(option, mode);
}

/// How long a freight business says it takes - the near end of its estimate.
double freightOptionDays(BusinessDestinationOption option, String mode) {
  var best = kUnknownSortValue;
  for (final candidate in _modesToJudge(mode)) {
    final days = candidate == 'sea'
        ? option.country.freightSeaDeliveryEstimateMinDays
        : option.country.freightAirDeliveryEstimateMinDays;
    // Nothing set is not "zero days". A business that never stated a time must
    // not rank fastest for a promise it never made.
    if (days == null || days <= 0) continue;
    if (days < best) best = days.toDouble();
  }
  return best;
}

List<double> _speedRank(
  BusinessDestinationOption option,
  String service,
  String mode,
) {
  final min = serviceOptionDays(option, service, mode);
  if (service != 'freight') {
    if (min == kUnknownSortValue) {
      return const [kUnknownSortValue, kUnknownSortValue];
    }
    final max = option.country.barrelShippingDeliveryEstimateMaxDays;
    return [min, (max != null && max >= min) ? max.toDouble() : min];
  }
  if (min == kUnknownSortValue) {
    return const [kUnknownSortValue, kUnknownSortValue];
  }
  var upper = min;
  for (final candidate in _modesToJudge(mode)) {
    final low = candidate == 'sea'
        ? option.country.freightSeaDeliveryEstimateMinDays
        : option.country.freightAirDeliveryEstimateMinDays;
    if (low == null || low.toDouble() != min) continue;
    final max = candidate == 'sea'
        ? option.country.freightSeaDeliveryEstimateMaxDays
        : option.country.freightAirDeliveryEstimateMaxDays;
    // Between "2-3 days" and "2-15 days" the customer means the first, and
    // only the upper bound tells them apart.
    if (max != null && max >= low) upper = max.toDouble();
  }
  return [min, upper];
}

/// How good a business's loss policy is, as a sortable key.
///
/// Covers loss beats does not; higher ceiling beats lower; at the same ceiling
/// the cheaper rate wins. No stated ceiling counts as the highest, because
/// that business has set no limit on what it will carry.
List<double> freightCoverageRank(BusinessDestinationOption option) {
  final policy = option.freightCoverage;
  if (policy == null || !policy.coversLoss) return const [1, 0, 0];
  final ceiling = policy.maxDeclaredValue > 0
      ? policy.maxDeclaredValue
      : double.maxFinite;
  return [0, -ceiling, policy.ratePct];
}

int _compareKeys(List<double> a, List<double> b) {
  final length = a.length > b.length ? a.length : b.length;
  for (var index = 0; index < length; index += 1) {
    final left = index < a.length ? a[index] : 0;
    final right = index < b.length ? b[index] : 0;
    if (left != right) return left < right ? -1 : 1;
  }
  return 0;
}

/// How well reviewed a business is, negated so lower sorts first like every
/// other key.
///
/// The score is Bayesian-damped by the platform, so an unrated business sits
/// at the prior rather than at zero. Sinking the unrated would punish every
/// new business; this sort says "no reason to prefer either", not "terrible".
double ratingRank(BusinessDestinationOption option) {
  final score = option.reviewWeightedScore;
  // A business that has never been reviewed has no aggregate at all - the
  // fields are only written when a review lands, so the score arrives absent
  // rather than as the prior. Reading that as zero sank every new business to
  // the bottom of "best rated", which is the opposite of what the damping is
  // for. Verified against live data: business_2 had no review fields and
  // ranked last behind a business rated 3.5.
  if (!score.isFinite || score <= 0) return -kBayesianPriorMean;
  return -score;
}

/// Orders the businesses on offer. Returns a new list, best first.
List<BusinessDestinationOption> sortServiceOptions(
  List<BusinessDestinationOption> options, {
  required String service,
  ServiceSort? sort,
  double weightKg = 1,
  String mode = '',
  String categoryId = '',
  double declaredValue = 0,
  int quantity = 1,
}) {
  final supported = sortsForService(service);
  // An unsupported sort falls back rather than throwing: a customer switching
  // services with a sort still selected should get a sane order, not an error.
  final chosen = (sort != null && supported.contains(sort))
      ? sort
      : defaultSortForService(service);

  final keyed = <_Ranked>[];
  for (var index = 0; index < options.length; index += 1) {
    final option = options[index];
    final total = serviceOptionTotal(
      option,
      service: service,
      weightKg: weightKg,
      mode: mode,
      categoryId: categoryId,
      declaredValue: declaredValue,
      quantity: quantity,
    );
    final speed = _speedRank(option, service, mode);
    final rating = ratingRank(option);
    final key = switch (chosen) {
      ServiceSort.coverage => [...freightCoverageRank(option), total, rating],
      ServiceSort.fastest => [...speed, total, rating],
      ServiceSort.rated => [rating, total, ...speed],
      _ => [total, ...speed, rating],
    };
    keyed.add(_Ranked(option, key, index));
  }

  keyed.sort((a, b) {
    final byKey = _compareKeys(a.key, b.key);
    if (byKey != 0) return byKey;
    // Ties are the norm at this size. Break them on something stable so the
    // list does not reshuffle between loads and read as broken.
    final byBusiness = a.option.businessId.compareTo(b.option.businessId);
    if (byBusiness != 0) return byBusiness;
    return a.index - b.index;
  });
  return keyed.map((entry) => entry.option).toList();
}

/// Whether a sort control is worth showing at all.
///
/// Two conditions: enough options to order, and more than one way to order
/// them. Car transport can only be sorted by rating, and a control with a
/// single choice is not a control.
bool shouldOfferServiceSort(
  List<BusinessDestinationOption> options,
  String service,
) =>
    options.length >= kMinOptionsForSort &&
    sortsForService(service).length > 1;

class _Ranked {
  const _Ranked(this.option, this.key, this.index);

  final BusinessDestinationOption option;
  final List<double> key;
  final int index;
}
