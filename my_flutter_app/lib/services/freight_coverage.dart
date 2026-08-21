/// Who stands behind a lost parcel. App side.
///
/// A deliberate mirror of the server's pure module,
/// `functions/freight_coverage.js`. The callable is still the authority - it
/// re-reads the business document at booking and writes a snapshot of the
/// policy onto the shipment, because a claim argued six weeks later has to be
/// judged on the terms in force when the parcel was handed over - and this
/// exists so a business's policy can be shown *before* it is chosen.
///
/// Cover costs nothing. A business prices each item it carries by what that
/// item is worth to carry, which is the whole reason freight is priced per
/// item rather than per kilo, so the risk already sits inside the shipping
/// rate; a separate percentage would bill the same risk twice.
///
/// That leaves one question: does this business pay for a parcel it loses? If
/// yes, it pays the full payback it published for that item. If no, the
/// customer gets nothing back and has to be told so while the business can
/// still be avoided. The sender is never asked what the parcel is worth - they
/// say what the item is, and the business's own table says what it pays.
///
/// The platform is not the insurer - the business pays the customer back. So
/// the screens show whose promise it is, by name.
///
/// Everything in this file is pure: no Firebase, no widgets, so
/// `test/freight_coverage_test.dart` drives it directly.
library;

/// One business's policy, as it stood when the option was read.
class FreightCoveragePolicy {
  const FreightCoveragePolicy({this.coversLoss = false});

  /// A business that has never touched these settings: pays nothing back.
  static const FreightCoveragePolicy none = FreightCoveragePolicy();

  /// Whether it pays the customer back for a parcel it loses. One flag, one
  /// meaning: a business either makes good on a lost parcel or it does not.
  final bool coversLoss;

  /// Reads the `freightCoverage` object off one destination option. Null when
  /// the business does not offer freight at all, which the callable signals by
  /// sending null - that is not the same as "offers freight, covers nothing".
  static FreightCoveragePolicy? fromWire(Object? value) {
    if (value is! Map) return null;
    return FreightCoveragePolicy(coversLoss: value['coversLoss'] == true);
  }

  /// Builds the policy straight from a business document, for the Firestore
  /// fallback path where the callable is not available.
  /// `freightCoveragePolicy` on the server.
  factory FreightCoveragePolicy.fromBusinessData(
    Map<String, dynamic>? business,
  ) => FreightCoveragePolicy(
    coversLoss: business?['freightCoverageEnabled'] == true,
  );
}

/// The one line a customer reads about a business before choosing it.
///
/// This is the piece that matters most: a customer should be able to pick a
/// business partly on whether it stands behind the parcel, and the business
/// that does not has to say so before the parcel is lost rather than after.
enum FreightCoverageSummary {
  /// The business does not offer freight, so there is nothing to say.
  notOffered,

  /// It carries the parcel but pays nothing if it goes missing.
  noCoverage,

  /// It pays back what it published for the item, at no charge.
  coversLoss,
}

/// Reduces a policy to the summary its option card should show.
FreightCoverageSummary freightCoverageSummaryOf(FreightCoveragePolicy? policy) {
  if (policy == null) return FreightCoverageSummary.notOffered;
  return policy.coversLoss
      ? FreightCoverageSummary.coversLoss
      : FreightCoverageSummary.noCoverage;
}
