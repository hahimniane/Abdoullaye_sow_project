/// What a parcel is worth, and who stands behind it. App side.
///
/// A deliberate mirror of the server's pure module,
/// `functions/freight_coverage.js`. The callable is still the authority - it
/// re-prices the declaration against a freshly read business document, and
/// refuses in its own words when a business will not carry a parcel that
/// valuable - and this exists so the customer can see the fee and the promise
/// before paying, and so a business's policy can be shown *before* it is
/// chosen.
///
/// Two things stay separate here on purpose. The category answers "what is it";
/// the declared value answers "what does it cost to replace". An iPhone 17 and
/// a five-year-old Samsung are the same category and the same weight, and only
/// the sender knows which is in the box. The rule that makes the answer honest
/// is that **the declared value is also the cap on the payout**: understate it
/// to save a few dollars and you have capped your own compensation.
///
/// The platform is not the insurer - the business pays the customer back. So
/// the screens show whose promise it is, by name.
///
/// Everything in this file is pure: no Firebase, no widgets, so
/// `test/freight_coverage_test.dart` drives it directly.
library;

/// Coverage priced above this would be a business nobody should be running.
/// `MAX_COVERAGE_RATE_PCT` on the server.
const double maxFreightCoverageRatePct = 10;

/// Ceiling on what any business may accept, whatever it sets. A single parcel
/// worth more than this belongs with a real freight forwarder.
/// `PLATFORM_MAX_DECLARED_VALUE` on the server.
const double platformMaxDeclaredValue = 10000;

/// Below this the question is not worth asking.
/// `DECLARATION_THRESHOLD` on the server.
const double freightDeclarationThreshold = 200;

/// One business's policy, as it stood when the option was read.
class FreightCoveragePolicy {
  const FreightCoveragePolicy({
    this.coversLoss = false,
    this.ratePct = 0,
    this.maxDeclaredValue = 0,
    this.declarationThreshold = freightDeclarationThreshold,
  });

  /// A business that has never touched these settings: covers nothing, accepts
  /// anything. Exactly how freight behaved before this existed.
  static const FreightCoveragePolicy none = FreightCoveragePolicy();

  /// Whether it pays the customer back for a lost parcel.
  final bool coversLoss;

  /// The price of that promise, as a percent of the declared value.
  final double ratePct;

  /// The most it will carry. 0 means "no stated ceiling", which is honest
  /// rather than unlimited: it is what every business looked like before.
  final double maxDeclaredValue;

  /// Below this, do not bother asking what the parcel is worth.
  final double declarationThreshold;

  bool get hasCeiling => maxDeclaredValue > 0;

  /// Whether the value question earns the space it takes.
  ///
  /// A business that neither covers loss nor states a ceiling does nothing
  /// with the answer: no fee, no promise, no limit. Asking anyway would be
  /// friction sold as protection, so it is not asked.
  bool get worthAskingDeclaredValue => coversLoss || hasCeiling;

  /// Reads the `freightCoverage` object off one destination option. Null when
  /// the business does not offer freight at all, which the callable signals by
  /// sending null - that is not the same as "offers freight, covers nothing".
  static FreightCoveragePolicy? fromWire(Object? value) {
    if (value is! Map) return null;
    return FreightCoveragePolicy(
      coversLoss: value['coversLoss'] == true,
      ratePct: _positiveNumber(value['ratePct'], max: maxFreightCoverageRatePct),
      maxDeclaredValue: _positiveNumber(
        value['maxDeclaredValue'],
        max: platformMaxDeclaredValue,
      ),
      declarationThreshold: _positiveNumber(
        value['declarationThreshold'],
        max: platformMaxDeclaredValue,
        fallback: freightDeclarationThreshold,
      ),
    );
  }

  /// Builds the policy straight from a business document, for the Firestore
  /// fallback path where the callable is not available.
  /// `freightCoveragePolicy` on the server.
  factory FreightCoveragePolicy.fromBusinessData(
    Map<String, dynamic>? business,
  ) {
    final ratePct = _positiveNumber(
      business?['freightCoverageRatePct'],
      max: maxFreightCoverageRatePct,
    );
    return FreightCoveragePolicy(
      // Covering nothing at a rate of zero is not coverage, whatever the flag
      // says: a business that ticks the box but never sets a rate would other-
      // wise appear to be standing behind the parcel.
      coversLoss: business?['freightCoverageEnabled'] == true && ratePct > 0,
      ratePct: ratePct,
      maxDeclaredValue: _positiveNumber(
        business?['freightMaxDeclaredValue'],
        max: platformMaxDeclaredValue,
      ),
    );
  }

  static double _positiveNumber(
    Object? value, {
    required double max,
    double fallback = 0,
  }) {
    final parsed = value is num
        ? value.toDouble()
        : double.tryParse('${value ?? ''}');
    if (parsed == null || !parsed.isFinite || parsed <= 0) return fallback;
    return parsed > max ? max : parsed;
  }
}

/// Why a declared value cannot be shipped. The callable refuses in its own
/// words and those words are what the customer is shown; these codes exist so
/// the screen can mark the offending field without inventing a second sentence
/// that contradicts the server's.
enum FreightCoverageError {
  /// This business will not carry a parcel worth that much.
  aboveMaxDeclaredValue,

  /// Nobody on the platform will.
  abovePlatformMaximum,
}

/// What one declaration costs and what it buys.
class FreightCoverageQuote {
  const FreightCoverageQuote({
    required this.policy,
    this.error,
    this.declaredValue = 0,
    this.coverageFee = 0,
    this.covered = false,
    this.payoutCap = 0,
  });

  final FreightCoveragePolicy policy;

  /// Null when the declaration is shippable.
  final FreightCoverageError? error;

  /// What the customer said it is worth. 0 when nothing was declared.
  final double declaredValue;

  /// What the promise costs, to the cent. 0 when nothing is promised.
  final double coverageFee;

  /// Whether the business is standing behind this parcel.
  final bool covered;

  /// The most that can be paid back. Capped at what was declared, which is the
  /// whole reason the declaration can be trusted without anyone checking it.
  final double payoutCap;

  bool get ok => error == null;
}

/// Prices a declared value against a business's policy.
/// `quoteFreightCoverage` on the server; keep the two in sync.
FreightCoverageQuote quoteFreightCoverage({
  required FreightCoveragePolicy policy,
  Object? declaredValue,
}) {
  final raw = declaredValue is num
      ? declaredValue.toDouble()
      : double.tryParse('${declaredValue ?? ''}'.trim());
  final declared = raw != null && raw.isFinite && raw > 0 ? raw : 0.0;

  if (declared <= 0) {
    // Nothing declared: no fee, no cover, and no cap to argue about later.
    return FreightCoverageQuote(policy: policy);
  }

  // The ceiling applies whether or not the business sells coverage: it is a
  // statement about what it is willing to carry, not about what it insures.
  if (policy.hasCeiling && declared > policy.maxDeclaredValue) {
    return FreightCoverageQuote(
      policy: policy,
      error: FreightCoverageError.aboveMaxDeclaredValue,
      declaredValue: declared,
    );
  }
  if (declared > platformMaxDeclaredValue) {
    return FreightCoverageQuote(
      policy: policy,
      error: FreightCoverageError.abovePlatformMaximum,
      declaredValue: declared,
    );
  }

  if (!policy.coversLoss) {
    // The value is still recorded - it is what the business agreed to carry -
    // but nothing is charged and nothing is promised.
    return FreightCoverageQuote(policy: policy, declaredValue: declared);
  }

  final feeCents = (declared * (policy.ratePct / 100) * 100).round();
  return FreightCoverageQuote(
    policy: policy,
    declaredValue: declared,
    coverageFee: feeCents / 100,
    covered: true,
    payoutCap: declared,
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

  /// It pays up to the declared value, and states a ceiling on what it takes.
  coversWithCeiling,

  /// It pays up to the declared value, with no stated ceiling.
  coversNoCeiling,
}

/// Reduces a policy to the summary its option card should show.
FreightCoverageSummary freightCoverageSummaryOf(FreightCoveragePolicy? policy) {
  if (policy == null) return FreightCoverageSummary.notOffered;
  if (!policy.coversLoss) return FreightCoverageSummary.noCoverage;
  return policy.hasCeiling
      ? FreightCoverageSummary.coversWithCeiling
      : FreightCoverageSummary.coversNoCeiling;
}
