import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/freight_coverage.dart';

/// The app half of freight loss coverage. The same assertions
/// `functions/test/freight-coverage.test.js` makes, because the promise the
/// customer reads ("we pay you $X") is the promise the shipment record will
/// carry, and because cover is free: any fee reaching the total or the
/// callable is a bug this file is here to catch.

void main() {
  group('reading a policy', () {
    test('a business that has set nothing pays nothing back', () {
      final read = FreightCoveragePolicy.fromBusinessData(<String, dynamic>{});
      expect(read.coversLoss, isFalse);
    });

    test('the flag is the whole policy', () {
      final read = FreightCoveragePolicy.fromBusinessData({
        'freightCoverageEnabled': true,
      });
      expect(read.coversLoss, isTrue);
    });

    test('null from the callable means the business has no freight at all', () {
      expect(FreightCoveragePolicy.fromWire(null), isNull);
      expect(FreightCoveragePolicy.fromWire('none'), isNull);
    });

    test('the wire policy carries one field and nothing else', () {
      expect(FreightCoveragePolicy.fromWire({'coversLoss': true})!.coversLoss,
          isTrue);
      expect(FreightCoveragePolicy.fromWire({'coversLoss': false})!.coversLoss,
          isFalse);
      // A business that offers freight and covers nothing is a policy, not an
      // absent one - the option card has to say so out loud.
      expect(FreightCoveragePolicy.fromWire(<String, Object?>{}), isNotNull);
    });
  });

  group('the line shown before a business is chosen', () {
    test('says it covers loss when it pays for a lost parcel', () {
      expect(
        freightCoverageSummaryOf(const FreightCoveragePolicy(coversLoss: true)),
        FreightCoverageSummary.coversLoss,
      );
    });

    test('says so plainly when nothing is covered', () {
      expect(
        freightCoverageSummaryOf(FreightCoveragePolicy.none),
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
        'freightCoverageCoversLoss',
        'freightCoverageSectionTitle',
        'freightCoveragePaysForLoss',
        'freightCoverageNoExtraCharge',
        'freightCoverageWhoPays',
        'freightCoverageNotOffered',
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

    test('no string asks for a value or prices the promise', () {
      for (final locale in ['en', 'fr']) {
        final catalog = arb(locale);
        for (final key in const [
          'protectionIncludedUpTo',
          'freightCoveragePaysUpTo',
          'freightCoverageCoversUpTo',
          'freightCoverageQuestion',
          'freightCoverageQuestionHelp',
          'freightDeclaredValueLabel',
          'freightDeclaredValueHelper',
          'freightCoverageFeeLabel',
          'freightCoverageEnterValue',
          'freightCoverageCarriesUpTo',
        ]) {
          expect(
            catalog[key],
            isNull,
            reason: 'app_$locale.arb still carries $key',
          );
        }
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

    test('the customer is never asked what the parcel is worth', () {
      // The business already priced the item by what it is worth to carry, so
      // a second valuation from the sender would price the same risk twice -
      // and made the honest customer subsidise the optimistic one.
      for (final gone in const [
        '_declaresValue',
        '_declaredValueController',
        '_declaredValue',
        '_resetDeclaredValue',
        '_worthAskingDeclaredValue',
        'declaredValue:',
        'freightDeclaredValueLabel',
      ]) {
        expect(screen, isNot(contains(gone)), reason: gone);
      }
    });

    test('no coverage fee reaches the total or the callable', () {
      for (final gone in const [
        '_coverageQuote',
        '_itemCoverageFee',
        '_coverageFeeApplied',
        'coverageFeeCentsFor',
        'freightCoverageFeeLabel',
      ]) {
        expect(screen, isNot(contains(gone)), reason: gone);
      }
      // The total is shipping, pickup and destination delivery. Nothing else.
      expect(
        screen,
        contains(
          'double get _totalPrice => _price + _appliedPickupFee + '
          '_appliedDeliveryFee;',
        ),
      );
    });

    test('a covering business says so, without quoting a sum', () {
      // Losing a parcel is rare. A figure on the booking screen turns a
      // reassurance into a headline, and into the number a customer expects
      // to argue over - the published amount settles a claim instead.
      expect(screen, contains('freightCoveragePaysForLoss'));
      expect(screen, contains('freightCoverageNoExtraCharge'));
      for (final gone in const [
        'protectionIncludedUpTo',
        'freightCoveragePaysUpTo',
        'lookup.paybackAmount',
      ]) {
        expect(screen, isNot(contains(gone)), reason: gone);
      }
    });

    test('a payback business asks for the item, never a value', () {
      expect(screen, contains('_usesItemPricing'));
      expect(screen, contains('itemId: _submittedItemId'));
      expect(
        screen,
        contains('String? get _submittedItemId => _usesItemPricing'),
      );
    });

    test('no answer in the funnel is a dead end', () {
      // Canada offered "Clothes and fabric" and then told the customer "no
      // business takes this" over a search box with nothing to search. Every
      // category is offered now because none of them ends nowhere: an item
      // nobody has priced becomes a question the businesses answer. The
      // funnel is still answered only by an actual item pick, and a withdrawn
      // selection counts as unanswered rather than dangling.
      expect(screen, contains('_funnelCategoryChoices'));
      expect(
        screen,
        contains(
          '_funnelCountryId.isNotEmpty && _activeFunnelItemId.isNotEmpty',
        ),
      );
      expect(screen, isNot(contains('_funnelItems.isEmpty ||')));
      // An empty result list is the offer to ask for a price, not a note
      // saying the customer is out of luck.
      expect(screen, isNot(contains('noBusinessTakesItem')));
      expect(
        screen,
        contains(
          'if (_funnelSatisfied && _filtered.isEmpty && _query.isEmpty) ...[',
        ),
      );
      expect(screen, contains('_askForPriceCard('));
      // No stacked empty-states: the search box hides when there is nothing
      // to narrow.
      expect(
        screen,
        contains('if (!_funnelSatisfied || (results.isEmpty && _query.isEmpty))'),
      );
    });

    test('the booking sheet never re-asks what the funnel answered', () {
      // The chips let a customer who picked Electronics/iPhone switch the
      // parcel to "Clothes and fabric" - a category no business on the
      // route takes - and the form kept quoting. The category question is
      // asked once, in the funnel; the sheet only states the price effect,
      // and the funnel's answer reaches the server verbatim (the server
      // resolves both the price and the payback row from the submitted
      // category, so a default substituted here misfiles the item).
      expect(
        screen,
        isNot(contains('setState(() => _categoryId = category.id)')),
      );
      expect(
        screen,
        contains('_categoryId = _activeFunnelCategoryId.isNotEmpty'),
      );
    });

    test('a refusal from the server is repeated verbatim', () {
      // Only the server has read the live business document; paraphrasing its
      // refusal would leave the customer changing fields at random.
      expect(screen, contains('_serverRefusal'));
      expect(screen, contains('error.message'));
    });
  });
}
