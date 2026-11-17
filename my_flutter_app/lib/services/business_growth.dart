/// The Growth page, the pure half and its Firebase source: the business's
/// plan, the AI advisor's cards, and the two callables (the Pro checkout and
/// "Generate insights"). Mirrors the website's `GrowthPanel`
/// (admin_web/src/components/business/growth-panel.tsx), so the phone and
/// the console read the same plan and the same cards the same way.
library;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

// ---------------------------------------------------------------------------
// The plan.
// ---------------------------------------------------------------------------

/// What the business's plan allows, read from its `businesses` document.
class GrowthPlan {
  const GrowthPlan({required this.isPro, required this.aiAdvisorEnabled});

  /// No document yet: the free plan, advisor off.
  const GrowthPlan.free() : isPro = false, aiAdvisorEnabled = false;

  final bool isPro;

  /// Pro, or the advisor (or everything) granted by an entitlement. The
  /// console's `aiAdvisorEnabled`.
  final bool aiAdvisorEnabled;

  factory GrowthPlan.fromBusiness(Map<String, dynamic>? data) {
    final plan = (data?['plan'] ?? 'free').toString().trim().toLowerCase();
    final entitlements = data?['entitlements'];
    final granted = entitlements is Map
        ? (entitlements['aiAdvisor'] == true || entitlements['all'] == true)
        : false;
    final pro = plan == 'pro';
    return GrowthPlan(isPro: pro, aiAdvisorEnabled: pro || granted);
  }
}

// ---------------------------------------------------------------------------
// The advisor's cards.
// ---------------------------------------------------------------------------

/// One recommendation.
class GrowthCard {
  const GrowthCard({
    required this.title,
    required this.finding,
    required this.recommendation,
    required this.severity,
  });

  final String title;
  final String finding;
  final String recommendation;

  /// `critical`, `high`, `medium`, `low` or what the server wrote, lower case.
  final String severity;
}

/// One run of the advisor: when, and its cards.
class GrowthInsight {
  const GrowthInsight({
    required this.id,
    required this.createdAt,
    required this.cards,
  });

  final String id;
  final DateTime? createdAt;
  final List<GrowthCard> cards;

  factory GrowthInsight.fromMap(String id, Map<String, dynamic> data) {
    String text(Object? v) => (v ?? '').toString().trim();
    final raw = data['cards'];
    final cards = <GrowthCard>[
      if (raw is List)
        for (final item in raw)
          if (item is Map)
            GrowthCard(
              title: text(item['title']),
              finding: text(item['finding']),
              recommendation: text(item['recommendation']),
              severity: text(item['severity']).toLowerCase(),
            ),
    ];
    final at = data['createdAt'];
    return GrowthInsight(
      id: id,
      createdAt: at is Timestamp
          ? at.toDate()
          : at is DateTime
          ? at
          : DateTime.tryParse(text(at)),
      cards: cards,
    );
  }
}

/// A card with the run it came from, for the list.
class GrowthCardEntry {
  const GrowthCardEntry({
    required this.key,
    required this.card,
    required this.createdAt,
  });

  final String key;
  final GrowthCard card;
  final DateTime? createdAt;
}

/// How many of the newest runs the page shows (the console's three).
const int growthInsightRuns = 3;

/// The cards of the [growthInsightRuns] newest runs, newest run first, each
/// run's cards in the order it wrote them.
List<GrowthCardEntry> growthCardEntries(Iterable<GrowthInsight> insights) {
  final sorted = [...insights]
    ..sort((a, b) {
      final x = a.createdAt?.millisecondsSinceEpoch ?? 0;
      final y = b.createdAt?.millisecondsSinceEpoch ?? 0;
      return y.compareTo(x);
    });
  return [
    for (final insight in sorted.take(growthInsightRuns))
      for (var i = 0; i < insight.cards.length; i++)
        GrowthCardEntry(
          key: '${insight.id}-$i',
          card: insight.cards[i],
          createdAt: insight.createdAt,
        ),
  ];
}

/// The severities that have their own words; any other severity is shown as
/// the text the server wrote, tidied.
const List<String> growthSeverities = <String>[
  'critical',
  'high',
  'medium',
  'low',
];

// ---------------------------------------------------------------------------
// When a call is refused.
// ---------------------------------------------------------------------------

enum GrowthCall { checkout, generate }

/// What went wrong, as a code the screen turns into words in either language
/// (never the server's English sentence).
enum GrowthFailure {
  checkoutOwnerOnly,
  checkoutNotSetUp,
  advisorNeedsPro,
  noAccess,
  generic,
}

/// Which sentence a refused call gets, from the call and the callable's error
/// code (`HttpsError` codes the two functions throw).
GrowthFailure growthFailureFor(GrowthCall call, String code) {
  switch (code) {
    case 'permission-denied':
      return call == GrowthCall.checkout
          ? GrowthFailure.checkoutOwnerOnly
          : GrowthFailure.noAccess;
    case 'failed-precondition':
      return call == GrowthCall.checkout
          ? GrowthFailure.checkoutNotSetUp
          : GrowthFailure.advisorNeedsPro;
    default:
      return GrowthFailure.generic;
  }
}

/// A refusal as the screen handles it.
class GrowthException implements Exception {
  const GrowthException(this.failure);
  final GrowthFailure failure;

  @override
  String toString() => 'GrowthException($failure)';
}

// ---------------------------------------------------------------------------
// The source.
// ---------------------------------------------------------------------------

abstract class BusinessGrowthSource {
  /// The business document (plan, entitlements); null while it has none.
  Stream<Map<String, dynamic>?> watchBusiness(String businessId);

  /// The newest runs of the advisor.
  Stream<List<GrowthInsight>> watchInsights(String businessId);

  /// Starts the Pro subscription's payment page and returns its address.
  /// Throws [GrowthException] when refused.
  Future<String> startProCheckout({
    required String businessId,
    required String successUrl,
    required String cancelUrl,
  });

  /// Asks the advisor for new recommendations. Throws [GrowthException] when
  /// refused.
  Future<void> generateInsights(String businessId);
}

class FirebaseBusinessGrowthSource implements BusinessGrowthSource {
  FirebaseBusinessGrowthSource({
    FirebaseFirestore? firestore,
    FirebaseFunctions? functions,
  }) : _firestoreOverride = firestore,
       _functionsOverride = functions;

  // Resolved lazily so building one never touches Firebase.instance.
  final FirebaseFirestore? _firestoreOverride;
  final FirebaseFunctions? _functionsOverride;

  FirebaseFirestore get _firestore =>
      _firestoreOverride ?? FirebaseFirestore.instance;
  FirebaseFunctions get _functions =>
      _functionsOverride ?? FirebaseFunctions.instance;

  @override
  Stream<Map<String, dynamic>?> watchBusiness(String businessId) => _firestore
      .collection('businesses')
      .doc(businessId)
      .snapshots()
      .map((doc) => doc.data());

  @override
  Stream<List<GrowthInsight>> watchInsights(String businessId) => _firestore
      .collection('businessInsights')
      .where('businessId', isEqualTo: businessId)
      .orderBy('createdAt', descending: true)
      .limit(growthInsightRuns)
      .snapshots()
      .map(
        (snap) => [
          for (final doc in snap.docs)
            GrowthInsight.fromMap(doc.id, doc.data()),
        ],
      );

  @override
  Future<String> startProCheckout({
    required String businessId,
    required String successUrl,
    required String cancelUrl,
  }) async {
    try {
      final result = await _functions
          .httpsCallable('createBusinessProCheckout')
          .call<Object?>({
            'businessId': businessId,
            'successUrl': successUrl,
            'cancelUrl': cancelUrl,
          });
      final data = result.data;
      final url = data is Map ? (data['url'] ?? '').toString().trim() : '';
      if (url.isEmpty) throw const GrowthException(GrowthFailure.generic);
      return url;
    } on FirebaseFunctionsException catch (e) {
      throw GrowthException(growthFailureFor(GrowthCall.checkout, e.code));
    }
  }

  @override
  Future<void> generateInsights(String businessId) async {
    try {
      await _functions
          .httpsCallable(
            'generateBusinessInsights',
            options: HttpsCallableOptions(
              timeout: const Duration(seconds: 130),
            ),
          )
          .call<Object?>({'businessId': businessId});
    } on FirebaseFunctionsException catch (e) {
      throw GrowthException(growthFailureFor(GrowthCall.generate, e.code));
    }
  }
}
