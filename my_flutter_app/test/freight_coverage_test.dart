import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/freight_coverage.dart';

/// The app half of freight loss coverage. The same assertions
/// `functions/test/freight-coverage.test.js` makes, because the fee shown
/// before payment and the fee charged have to be the same number, and because
/// the promise the customer reads ("we pay up to $X") is the promise the
/// shipment record will carry.

FreightCoveragePolicy policy({
  bool coversLoss = true,
  double ratePct = 2,
  double maxDeclaredValue = 2000,
}) => FreightCoveragePolicy(
  coversLoss: coversLoss,
  ratePct: ratePct,
  maxDeclaredValue: maxDeclaredValue,
);

void main() {
  group('reading a policy', () {
    test('a business that has set nothing covers nothing, accepts anything', () {
      final read = FreightCoveragePolicy.fromBusinessData(<String, dynamic>{});
      expect(read.coversLoss, isFalse);
      expect(read.ratePct, 0);
      expect(read.maxDeclaredValue, 0);
      expect(read.hasCeiling, isFalse);
      expect(read.declarationThreshold, freightDeclarationThreshold);
    });

    test('ticking the box without a rate is not coverage', () {
      final read = FreightCoveragePolicy.fromBusinessData({
        'freightCoverageEnabled': true,
        'freightCoverageRatePct': 0,
      });
      expect(read.coversLoss, isFalse);
    });

    test('a rate or ceiling beyond the platform maximum is clamped', () {
      final read = FreightCoveragePolicy.fromBusinessData({
        'freightCoverageEnabled': true,
        'freightCoverageRatePct': 90,
        'freightMaxDeclaredValue': 999999,
      });
      expect(read.ratePct, maxFreightCoverageRatePct);
      expect(read.maxDeclaredValue, platformMaxDeclaredValue);
    });

    test('null from the callable means the business has no freight at all', () {
      expect(FreightCoveragePolicy.fromWire(null), isNull);
      expect(FreightCoveragePolicy.fromWire('none'), isNull);
    });

    test('the wire policy is read whole', () {
      final read = FreightCoveragePolicy.fromWire({
        'coversLoss': true,
        'ratePct': 2.5,
        'maxDeclaredValue': 1500,
        'declarationThreshold': 200,
      })!;
      expect(read.coversLoss, isTrue);
      expect(read.ratePct, 2.5);
      expect(read.maxDeclaredValue, 1500);
      expect(read.declarationThreshold, 200);
    });

    test('a missing threshold falls back to the platform one', () {
      final read = FreightCoveragePolicy.fromWire({'coversLoss': false})!;
      expect(read.declarationThreshold, freightDeclarationThreshold);
    });
  });

  group('whether the question is worth asking', () {
    test('is asked when the business pays for a lost parcel', () {
      expect(
        policy(maxDeclaredValue: 0).worthAskingDeclaredValue,
        isTrue,
      );
    });

    test('is asked when the business states what it will carry', () {
      expect(
        policy(coversLoss: false, ratePct: 0).worthAskingDeclaredValue,
        isTrue,
      );
    });

    test('is not asked when the answer would change nothing', () {
      // No cover and no ceiling: the value buys nothing, limits nothing and
      // costs nothing. Asking anyway would be friction sold as protection.
      const bare = FreightCoveragePolicy.none;
      expect(bare.worthAskingDeclaredValue, isFalse);
    });
  });

  group('pricing a declaration', () {
    test('nothing declared is no fee, no cover and no cap', () {
      final quote = quoteFreightCoverage(policy: policy(), declaredValue: 0);
      expect(quote.ok, isTrue);
      expect(quote.coverageFee, 0);
      expect(quote.covered, isFalse);
      expect(quote.payoutCap, 0);
    });

    test('the fee is the rate on the declared value, to the cent', () {
      final quote = quoteFreightCoverage(
        policy: policy(ratePct: 2),
        declaredValue: 800,
      );
      expect(quote.coverageFee, 16);
      expect(quote.covered, isTrue);
    });

    test('an awkward rate rounds the way the server rounds it', () {
      // 333.33 x 2.5% = 8.33325 -> 8.33
      final quote = quoteFreightCoverage(
        policy: policy(ratePct: 2.5),
        declaredValue: 333.33,
      );
      expect(quote.coverageFee, 8.33);
    });

    test('the payout cap is exactly what was declared', () {
      final quote = quoteFreightCoverage(
        policy: policy(),
        declaredValue: 640,
      );
      // Understate it to save a few dollars and you have capped your own
      // compensation. That is what makes an unchecked declaration workable.
      expect(quote.payoutCap, 640);
    });

    test('a business that covers nothing still records the value', () {
      final quote = quoteFreightCoverage(
        policy: policy(coversLoss: false, ratePct: 0),
        declaredValue: 900,
      );
      expect(quote.ok, isTrue);
      expect(quote.declaredValue, 900);
      expect(quote.coverageFee, 0);
      expect(quote.covered, isFalse);
      expect(quote.payoutCap, 0);
    });

    test('a value above the ceiling is refused, coverage or not', () {
      for (final covers in [true, false]) {
        final quote = quoteFreightCoverage(
          policy: policy(coversLoss: covers, ratePct: covers ? 2 : 0),
          declaredValue: 2500,
        );
        expect(quote.ok, isFalse);
        expect(quote.error, FreightCoverageError.aboveMaxDeclaredValue);
      }
    });

    test('a value at the ceiling exactly is still accepted', () {
      final quote = quoteFreightCoverage(
        policy: policy(maxDeclaredValue: 2000),
        declaredValue: 2000,
      );
      expect(quote.ok, isTrue);
      expect(quote.payoutCap, 2000);
    });

    test('no stated ceiling still stops at the platform maximum', () {
      final quote = quoteFreightCoverage(
        policy: policy(maxDeclaredValue: 0),
        declaredValue: platformMaxDeclaredValue + 1,
      );
      expect(quote.ok, isFalse);
      expect(quote.error, FreightCoverageError.abovePlatformMaximum);
    });

    test('a typed value arrives as text and is still priced', () {
      final quote = quoteFreightCoverage(
        policy: policy(ratePct: 2),
        declaredValue: ' 500 ',
      );
      expect(quote.coverageFee, 10);
    });

    test('unreadable or negative text declares nothing', () {
      for (final value in ['', 'lots', '-40']) {
        final quote = quoteFreightCoverage(
          policy: policy(),
          declaredValue: value,
        );
        expect(quote.ok, isTrue, reason: 'for $value');
        expect(quote.declaredValue, 0, reason: 'for $value');
      }
    });
  });

  group('the line shown before a business is chosen', () {
    test('names the ceiling and the rate when it covers loss', () {
      expect(
        freightCoverageSummaryOf(policy()),
        FreightCoverageSummary.coversWithCeiling,
      );
    });

    test('covers loss without a ceiling when none is stated', () {
      expect(
        freightCoverageSummaryOf(policy(maxDeclaredValue: 0)),
        FreightCoverageSummary.coversNoCeiling,
      );
    });

    test('says so plainly when nothing is covered', () {
      expect(
        freightCoverageSummaryOf(policy(coversLoss: false, ratePct: 0)),
        FreightCoverageSummary.noCoverage,
      );
    });

    test('is silent for a business that does not do freight', () {
      expect(
        freightCoverageSummaryOf(null),
        FreightCoverageSummary.notOffered,
      );
    });
  });

  group('the words a customer reads', () {
    Map<String, Object?> arb(String locale) =>
        jsonDecode(File('lib/l10n/app_$locale.arb').readAsStringSync())
            as Map<String, Object?>;

    test('every coverage string exists in both catalogs', () {
      final en = arb('en');
      final fr = arb('fr');
      const keys = <String>[
        'freightCoverageNone',
        'freightCoverageCoversUpTo',
        'freightCoverageCoversLoss',
        'freightCoverageSectionTitle',
        'freightCoverageQuestion',
        'freightCoverageQuestionHelp',
        'freightDeclaredValueLabel',
        'freightDeclaredValueHelper',
        'freightCoverageFeeLabel',
        'freightCoverageEnterValue',
        'freightCoveragePaysUpTo',
        'freightCoverageWhoPays',
        'freightCoverageNotOffered',
        'freightCoverageCarriesUpTo',
      ];
      for (final key in keys) {
        expect(en[key], isNotNull, reason: 'app_en.arb is missing $key');
        expect(fr[key], isNotNull, reason: 'app_fr.arb is missing $key');
        expect(
          (fr[key] as String).trim(),
          isNotEmpty,
          reason: 'app_fr.arb has an empty $key',
        );
      }
    });
  });

  group('the screen keeps its side of the bargain', () {
    final screen = File(
      'lib/screens/send_freight_screen.dart',
    ).readAsStringSync();

    test('a business that does not cover loss says so on the form', () {
      expect(screen, contains('freightCoverageNotOffered'));
    });

    test('coverage is shown on the card before a business is chosen', () {
      expect(screen, contains('_coveragePill'));
      expect(screen, contains('freightCoverageSummaryText'));
    });

    test('the declared value and its fee reach the total and the callable', () {
      // Only for businesses still on the old model: a payback-table business
      // prices from its own published row and sends itemId instead - the
      // customer declares nothing.
      expect(
        screen,
        contains('declaredValue: !_usesItemPricing && _declaredValue > 0'),
      );
      expect(screen, contains('_coverageFeeApplied'));
    });

    test('a payback business asks for the item, never a value', () {
      expect(screen, contains('_usesItemPricing'));
      expect(screen, contains('protectionIncludedUpTo'));
      expect(
        screen,
        contains("itemId: _usesItemPricing"),
      );
    });

    test('the funnel never offers a category nobody would take', () {
      // Canada offered "Clothes and fabric" because a provider PRICES that
      // category, while no provider's payback table would take anything in
      // it - the customer was told "no business takes this" without ever
      // being asked what the item was, over a search box with nothing to
      // search. Categories are filtered to ones with item choices, the
      // funnel is answered only by an actual item pick, and a withdrawn
      // selection counts as unanswered rather than dangling.
      expect(screen, contains('_funnelCategoryChoices'));
      expect(
        screen,
        contains('if (freightItemChoicesFor(tables, category.id).isNotEmpty)'),
      );
      expect(
        screen,
        contains(
          '_funnelCountryId.isNotEmpty && _activeFunnelItemId.isNotEmpty',
        ),
      );
      expect(screen, isNot(contains('_funnelItems.isEmpty ||')));
      // No stacked empty-states: the search box hides when there is nothing
      // to narrow.
      expect(
        screen,
        contains('if (!_funnelSatisfied || (results.isEmpty && _query.isEmpty))'),
      );
    });

    test('a refusal from the server is repeated verbatim', () {
      // Only the server knows what this business will carry; paraphrasing its
      // refusal would leave the customer changing fields at random.
      expect(screen, contains('_declaredValueRefusal'));
      expect(screen, contains('error.message'));
    });
  });
}
