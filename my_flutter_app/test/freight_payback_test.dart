import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/freight_quote.dart';
import 'package:my_flutter_app/utils/freight_delivery.dart';
import 'package:my_flutter_app/utils/freight_payback.dart';

// Twin of functions/test/freight-payback.test.js and the web mirror -
// three clients, one price.
void main() {
  _deliveryAreaTests();
  const table = <String, dynamic>{
    'electronics': {
      'items': [
        {'id': 'iphone', 'label': 'iPhone'},
        {'id': 'samsung-phone', 'label': 'Samsung phone'},
      ],
      'otherPricingMode': 'per_kg',
    },
    'clothing': {'items': <Object>[]},
  };

  test('finds the exact row the business published', () {
    final iphone = freightPaybackFor(
      table: table, categoryId: 'electronics', itemId: 'iphone',
    );
    expect(iphone.listed, true);
    expect(iphone.source, 'item');
    expect(iphone.label, 'iPhone');
  });

  test('falls back to the catch-all, and says unlisted otherwise', () {
    final unknown = freightPaybackFor(
      table: table, categoryId: 'electronics', itemId: 'walkman',
    );
    expect(unknown.listed, true);
    expect(unknown.source, 'other');
    expect(
      freightPaybackFor(table: table, categoryId: 'clothing', itemId: 'boubou')
          .listed,
      false,
    );
    expect(
      freightPaybackFor(table: null, categoryId: 'electronics').listed,
      false,
    );
  });

  test('a category with no catch-all pricing lists nothing extra', () {
    // A catch-all is "listed" purely by being priced. Without a pricing mode
    // there is no row for anything else in the category, so the customer is
    // sent to ask rather than booked against a business that never said yes.
    const noCatchAll = <String, dynamic>{
      'electronics': {
        'items': [
          {'id': 'iphone', 'label': 'iPhone'},
        ],
      },
    };
    expect(
      freightPaybackFor(
        table: noCatchAll, categoryId: 'electronics', itemId: 'walkman',
      ).listed,
      false,
    );
  });

  test('the funnel offers every listed item, and a way past the list', () {
    const withTable = <String, dynamic>{
      'electronics': {
        'items': [
          {
            'id': 'iphone', 'label': 'iPhone',
            'pricingMode': 'flat', 'flatPrice': 50,
          },
        ],
      },
    };
    const withCatchAll = <String, dynamic>{
      'electronics': {
        'items': <Object>[],
        'otherPricingMode': 'per_kg',
      },
    };

    // The catch-all always closes the list: an item nobody has priced is a
    // question the businesses answer, so no choice here is a dead end.
    final choices =
        freightItemChoicesFor([withTable, withCatchAll], 'electronics');
    expect(choices.map((c) => c.id).toList(), ['iphone', otherItemId]);
    expect(
      freightItemChoicesFor([withTable], 'clothing').map((c) => c.id).toList(),
      [otherItemId],
    );

    // Booking on the spot needs BOTH a price and a listed row from the same
    // business - the pair the callable checks before it charges anything.
    expect(providerQualifiesForItem(withTable, 'electronics', 'iphone'), true);
    expect(
      providerQualifiesForItem(withCatchAll, 'electronics', 'iphone'),
      true,
    );
    expect(
      providerQualifiesForItem(withTable, 'electronics', otherItemId),
      false,
    );
    // A business that publishes no table has quoted nothing, so it cannot be
    // booked on the spot - it can only answer a price request.
    expect(providerQualifiesForItem(null, 'electronics', 'anything'), false);
  });

  test('a listed row with no price cannot be booked', () {
    // The sharp edge: the business lists this item but has never said what it
    // charges to carry it. Half an answer is not a booking.
    const listedOnly = <String, dynamic>{
      'electronics': {
        'items': [
          {'id': 'legacy', 'label': 'Legacy row'},
        ],
      },
    };
    expect(
      freightPaybackFor(
        table: listedOnly, categoryId: 'electronics', itemId: 'legacy',
      ).listed,
      true,
    );
    expect(
      freightItemPricing(
        table: listedOnly, categoryId: 'electronics', itemId: 'legacy',
      ).priced,
      false,
    );
    expect(
      providerQualifiesForItem(listedOnly, 'electronics', 'legacy'),
      false,
    );
  });

  group('how a business prices what it carries', () {
    // The same fixture the functions authority resolves against, row for row,
    // so a drift in either resolution order fails on one of the two sides.
    const priced = <String, dynamic>{
      'electronics': {
        'items': [
          // A known object: one price, and an allowance so the retail box and
          // charger do not come out of the business's pocket.
          {
            'id': 'iphone', 'label': 'iPhone 16',
            'pricingMode': 'flat', 'flatPrice': 50, 'includedKg': 2,
          },
          // A set price covering the parcel however heavy it is.
          {
            'id': 'sim', 'label': 'SIM card',
            'pricingMode': 'flat', 'flatPrice': 10,
          },
          // Goods that vary, priced by the scale at the route rate.
          {
            'id': 'mixed-tech', 'label': 'Assorted tech',
            'pricingMode': 'per_kg',
          },
          // A row this business has never put a number on.
          {'id': 'legacy', 'label': 'Legacy row'},
        ],
        'otherPricingMode': 'per_kg',
      },
      'clothing': {'items': <Object>[]},
    };

    test('prices a known object once, and never weighs it at booking', () {
      final p = freightItemPricing(
        table: priced,
        categoryId: 'electronics',
        itemId: 'iphone',
      );
      expect(p.priced, true);
      expect(p.mode, 'flat');
      expect(p.isFlat, true);
      expect(p.flatPrice, 50);
      expect(p.includedKg, 2);
      // The customer picks the item and sees the price - nobody guesses the
      // weight of an iPhone at their kitchen table.
      expect(p.needsWeightAtBooking, false);
      // The counter still weighs it, because the price covers only 2kg.
      expect(p.weighsAtDropOff, true);
      expect(p.source, 'item');
    });

    test('never weighs a set price that covers any weight', () {
      final p = freightItemPricing(
        table: priced,
        categoryId: 'electronics',
        itemId: 'sim',
      );
      expect(p.flatPrice, 10);
      expect(p.includedKg, 0);
      expect(p.needsWeightAtBooking, false);
      expect(p.weighsAtDropOff, false);
    });

    test("weighs goods that vary, at the business's own route rate", () {
      final p = freightItemPricing(
        table: priced,
        categoryId: 'electronics',
        itemId: 'mixed-tech',
      );
      expect(p.priced, true);
      expect(p.mode, 'per_kg');
      // No factor to reason about: a kilo costs what this business charges
      // for a kilo on this route.
      expect(p.weightFactor, 1);
      expect(p.needsWeightAtBooking, true);
      expect(p.weighsAtDropOff, true);
    });

    test('sends a row nobody priced to a request, never to a guess', () {
      final p = freightItemPricing(
        table: priced,
        categoryId: 'electronics',
        itemId: 'legacy',
      );
      expect(p.priced, false);
      expect(p.mode, isNull);
      expect(p.flatPrice, 0);
      expect(p.weightFactor, 0);
      expect(p.source, isNull);
    });

    test("falls through to the category's catch-all pricing", () {
      final p = freightItemPricing(
        table: priced,
        categoryId: 'electronics',
        itemId: 'not-a-row',
      );
      expect(p.priced, true);
      expect(p.source, 'other');
      expect(p.mode, 'per_kg');
      expect(p.weightFactor, 1);
    });

    test('sends everything to a request when there is no table at all', () {
      // A category listed with no catch-all pricing is not a price either.
      for (final query in const <(Map<String, dynamic>?, String, String)>[
        (null, 'electronics', 'iphone'),
        (priced, 'clothing', 'boubou'),
      ]) {
        expect(
          freightItemPricing(
            table: query.$1,
            categoryId: query.$2,
            itemId: query.$3,
          ).priced,
          false,
          reason: '${query.$2}/${query.$3}',
        );
      }
    });

    test('resolves in the order the functions authority documents', () {
      // A listed row that names no pricing must NOT reach the catch-all: the
      // business would be charging a set price it never chose for that row.
      const catchAllIsFlat = <String, dynamic>{
        'electronics': {
          'items': [
            {
              'id': 'mixed-tech', 'label': 'Assorted tech',
              'pricingMode': 'per_kg',
            },
            {'id': 'legacy', 'label': 'Legacy row'},
          ],
          'otherPricingMode': 'flat',
          'otherFlatPrice': 25,
          'otherIncludedKg': 3,
        },
      };
      expect(
        freightItemPricing(
          table: catchAllIsFlat,
          categoryId: 'electronics',
          itemId: 'legacy',
        ).priced,
        false,
      );
      final row = freightItemPricing(
        table: catchAllIsFlat,
        categoryId: 'electronics',
        itemId: 'mixed-tech',
      );
      expect(row.mode, 'per_kg');
      expect(row.weightFactor, 1);
      expect(row.source, 'item');

      final catchAll = freightItemPricing(
        table: catchAllIsFlat,
        categoryId: 'electronics',
        itemId: '',
      );
      expect(catchAll.mode, 'flat');
      expect(catchAll.flatPrice, 25);
      expect(catchAll.includedKg, 3);
      expect(catchAll.weighsAtDropOff, true);
      expect(catchAll.source, 'other');
    });
  });

  group('the booking screen prices a set item without a scale', () {
    final screen = File(
      'lib/screens/send_freight_screen.dart',
    ).readAsStringSync();
    final service = File(
      'lib/services/freight_shipment_service.dart',
    ).readAsStringSync();

    test('a set price hides the weight field and never sends a weight', () {
      // Asking what an iPhone weighs would put a number in the booking that
      // nothing is ever charged against.
      expect(screen, contains('bool get _setPrice => _itemPricing.isFlat;'));
      expect(screen, contains('else if (_setPrice)\n          _setPriceSection('));
      expect(screen, contains('weightKg: _setPrice ? 0 : _weightKg'));
      // And the guard on the button must not hold the order for a weight
      // this parcel has no reason to carry - an agreed price carries none
      // either (see freight_agreed_booking_contract_test.dart).
      expect(
        screen,
        contains('if (!_setPrice && !_hasAgreedPrice && _weightKg <= 0)'),
      );
      expect(service, contains("if (weightKg > 0) 'weightKg': weightKg"));
      expect(service, contains('double weightKg = 0,'));
    });

    test('the allowance and what excess costs are both shown', () {
      // An allowance is the one thing that can still move this price at the
      // counter, so it is said before the parcel is handed over.
      expect(screen, contains('freightSetPriceCoversUpTo'));
      expect(screen, contains('freightSetPriceCoversAnyWeight'));
      expect(screen, contains('freightSetPriceOverAllowanceNote'));
      expect(screen, contains('freightSetPriceFinal'));
      // The excess rides on the route's own per-kg rate.
      expect(
        screen,
        contains("'\\\$\${_ratePerKg.toStringAsFixed(2)}',"),
      );
    });

    test('the price is the set price, and the total adds the fees to it', () {
      expect(
        screen,
        contains(
          // A declared box prices as the sum of its manifest; the
          // single-item shapes below are the fallback inside the same
          // getter, unchanged.
          'return !_itemPriced\n'
          '        ? 0\n'
          '        : _setPrice\n'
          '        ? _itemPricing.flatPrice',
        ),
      );
      expect(
        screen,
        contains(
          'double get _totalPrice => _price + _appliedPickupFee + '
          '_appliedDeliveryFee;',
        ),
      );
    });

    test('a by-weight item is charged the route rate, with no factor', () {
      // A unitless multiplier was a number the business had to reason about
      // instead of a price it could state, so nothing on this screen applies
      // one to the destination's rate.
      expect(
        screen,
        contains(
          'freightShippingFee(weightKg: _weightKg, ratePerKg: _ratePerKg)',
        ),
      );
      expect(screen, isNot(contains('_effectiveRatePerKg')));
      expect(screen, isNot(contains('_categoryPricesParcel')));
      expect(screen, isNot(contains('freightMultiplierText')));
      expect(screen, isNot(contains('freightCategoryRateText')));
    });

    test('an unpriced item shows the request path and never a price', () {
      // A price nobody set is not a price to show: the total, the per-kg
      // line and the Book button all assert one, so all three are gone and
      // the customer is offered the question instead.
      // Still the pricing table's answer, with one exception: a price the
      // customer already accepted from a business counts as priced, or
      // arriving with an agreed price would send them back to ask for it.
      expect(
        screen,
        contains('bool get _itemPriced => _hasAgreedPrice || '
            '_itemPricing.priced;'),
      );
      expect(
        screen,
        contains("bool get _hasAgreedPrice => "
            "widget.quoteRequestId.trim().isNotEmpty;"),
      );
      expect(
        screen,
        contains(
          'if (!_itemPriced)\n'
          '          _askForPriceCard(',
        ),
      );
      expect(screen, contains('if (_itemPriced) ...['));
      expect(screen, contains("if (!_setPrice && _itemPriced) ...["));
      // Nobody on the route has priced it either - the same offer, made
      // before a business has even been chosen.
      expect(screen, contains('freightNoBusinessPricedItem'));
      expect(screen, contains('freightBusinessHasNotPricedItem'));
      expect(screen, contains('FreightQuoteRequestScreen('));
      // And the callable is never reached with an item it would refuse.
      expect(screen, contains('if (!_itemPriced) return;'));
    });

    test('the set-price copy exists in both catalogs', () {
      final en = _arb('en');
      final fr = _arb('fr');
      for (final key in const [
        'freightSetPriceTitle',
        'freightSetPriceLine',
        'freightSetPriceCoversUpTo',
        'freightSetPriceCoversAnyWeight',
        'freightSetPriceFinal',
        'freightSetPriceOverAllowanceNote',
      ]) {
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

  group('asking a business what it charges', () {
    final service = File(
      'lib/services/freight_quote_service.dart',
    ).readAsStringSync();
    final details = File(
      'lib/screens/freight_quote_details_screen.dart',
    ).readAsStringSync();

    test('the request says what, where and how - and nothing else', () {
      // The customer is here because nobody could price the parcel; demanding
      // a taxonomy would be asking for the answer they came for.
      expect(service, contains("httpsCallable('createFreightQuoteRequest')"));
      expect(service, contains("'destinationCountryId': destinationCountryId"));
      expect(service, contains("'mode': mode,"));
      expect(service, contains("'description': description,"));
      // A weight the customer does not have must not be sent as zero.
      expect(service, contains("if (weightKg > 0) 'weightKg': weightKg"));
      expect(
        service,
        contains("if (itemCategoryId.trim().isNotEmpty)"),
      );
      expect(service, contains("if (itemLabel.trim().isNotEmpty)"));
    });

    test('all three callables are reachable from one service', () {
      expect(service, contains("httpsCallable('submitFreightQuote')"));
      expect(service, contains("httpsCallable('selectFreightQuote')"));
      expect(
        service,
        contains("collection('freightQuotes')\n"
            "        .where('requestId', isEqualTo: requestId)"),
      );
    });

    test('a quote carries its own cover answer into the comparison', () {
      // The item is not in the business's table, so the promise travels on
      // the quote - and a business that will not make good says so where the
      // customer is still choosing.
      final quote = FreightQuote.fromMap(
        id: 'req__biz',
        data: const {
          'requestId': 'req',
          'businessId': 'biz',
          'businessName': 'Ndiaye Cargo',
          'amountCents': 12500,
          'coversLoss': true,
          'currency': 'usd',
          'status': 'submitted',
          'revision': 1,
        },
      );
      expect(quote.amount, 125);
      expect(quote.coversLoss, true);
      expect(quote.isSubmitted, true);

      final bare = FreightQuote.fromMap(
        id: 'req__other',
        data: const {
          'requestId': 'req',
          'businessName': 'Sow Freight',
          'amountCents': 9000,
          'status': 'submitted',
        },
      );
      // Nothing said about cover is not cover: the customer must not be left
      // to assume a promise no business made.
      expect(bare.coversLoss, false);

      // Both halves reach the card the customer compares on, and the price is
      // the only figure on it.
      expect(details, contains('freightQuoteCoversLoss'));
      expect(details, contains('freightQuoteDoesNotCoverLoss'));
      expect(details, contains('quote.coversLoss'));
      expect(details, contains('freightMoney(quote.amount)'));
      expect(details, contains('_service.selectQuote('));
    });

    test('a business states cover, never a sum, when it answers', () {
      // The callable takes a flag. An amount here is the per-parcel figure
      // this whole design exists to keep out of the conversation.
      expect(service, contains("'coversLoss': coversLoss,"));
      expect(service, contains('bool coversLoss = false,'));
      for (final gone in const [
        'paybackAmountCents',
        'paybackAmount',
        'coveragePayoutCapCents',
        'payoutCapCents',
      ]) {
        expect(service, isNot(contains(gone)), reason: gone);
        expect(details, isNot(contains(gone)), reason: gone);
      }
    });

    test('the request-and-quote copy exists in both catalogs', () {
      final en = _arb('en');
      final fr = _arb('fr');
      for (final key in const [
        'freightNoPriceForItemTitle',
        'freightNoBusinessPricedItem',
        'freightBusinessHasNotPricedItem',
        'freightAskForPriceCta',
        'freightAskForPriceTitle',
        'freightAskForPriceIntro',
        'freightAskForPriceNote',
        'freightQuoteDescriptionLabel',
        'freightQuoteDescriptionHint',
        'freightQuoteDescriptionRequired',
        'freightQuoteWeightLabel',
        'freightQuoteWeightHelper',
        'freightQuoteSendRequest',
        'freightQuoteSending',
        'freightQuoteRequestFailed',
        'freightQuotesTitle',
        'freightQuotesIntro',
        'freightQuoteRequestReference',
        'freightQuoteAskedBusinesses',
        'waitingForFreightQuotes',
        'waitingForFreightQuotesSubtitle',
        'freightQuoteCoversLoss',
        'freightQuoteDoesNotCoverLoss',
        'selectFreightQuote',
        'selectingFreightQuote',
        'confirmFreightQuoteTitle',
        'confirmFreightQuoteMessage',
        'couldNotSelectFreightQuote',
        'couldNotLoadFreightQuotes',
        'freightQuoteChosenTitle',
        'freightQuoteChosenMessage',
      ]) {
        expect(en[key], isNotNull, reason: 'app_en.arb is missing $key');
        expect(fr[key], isNotNull, reason: 'app_fr.arb is missing $key');
        expect(
          (fr[key] as String).trim(),
          isNotEmpty,
          reason: 'app_fr.arb has an empty $key',
        );
        expect(
          fr[key],
          isNot(en[key]),
          reason: 'app_fr.arb left $key in English',
        );
      }
    });
  });
}

/// One catalog, read as the customer's phone reads it.
Map<String, dynamic> _arb(String locale) => Map<String, dynamic>.from(
  jsonDecode(File('lib/l10n/app_$locale.arb').readAsStringSync()) as Map,
);

/// Delivery is priced per quartier, per destination. Crossing Dakar and
/// crossing Conakry are different jobs at different costs, and one fee for a
/// whole country either overcharges the neighbourhood next to the office or
/// loses money on the one an hour away.
void _deliveryAreaTests() {
  group('what it costs to deliver there', () {
    const conakry = [
      {'id': 'cosa', 'name': 'Cosa', 'fee': 20},
      {'id': 'koloma', 'name': 'Koloma', 'fee': 10},
    ];

    test('each place carries its own price', () {
      final policy = freightDeliveryPolicy(
        available: true,
        fee: 0,
        areas: conakry,
      );
      expect(policy.offered, isTrue);
      expect(policy.pricesByArea, isTrue);
      expect(policy.areas.map((a) => a.feeCents), [2000, 1000]);
    });

    test('one price for the whole country is still an answer', () {
      final policy = freightDeliveryPolicy(available: true, fee: 15);
      expect(policy.pricesByArea, isFalse);
      expect(policy.feeCents, 1500);
    });

    test('opted in with nowhere listed offers nothing', () {
      expect(
        freightDeliveryPolicy(available: true, fee: 0, areas: const []).offered,
        isFalse,
      );
    });

    test('a row nobody could be charged for is dropped', () {
      final areas = freightDeliveryAreas(const [
        {'id': 'cosa', 'name': 'Cosa', 'fee': 20},
        {'id': 'blank', 'name': '', 'fee': 10},
        {'id': 'free', 'name': 'Free', 'fee': 0},
        {'id': 'cosa', 'name': 'Cosa again', 'fee': 30},
      ]);
      expect(areas.map((a) => a.id), ['cosa']);
    });

    test('a booking priced by place needs the place named', () {
      final policy = freightDeliveryPolicy(
        available: true,
        fee: 0,
        areas: conakry,
      );
      // Guessing a fee for an unlisted quartier is how a business ends up
      // driving somewhere it never priced.
      expect(
        deliveryChoiceIsComplete(
          wantsDelivery: true,
          receiverAddress: 'Rue KA-020',
          policy: policy,
          areaId: '',
        ),
        isFalse,
      );
      expect(
        deliveryChoiceIsComplete(
          wantsDelivery: true,
          receiverAddress: 'Rue KA-020',
          policy: policy,
          areaId: 'ratoma',
        ),
        isFalse,
      );
      expect(
        deliveryChoiceIsComplete(
          wantsDelivery: true,
          receiverAddress: 'Rue KA-020',
          policy: policy,
          areaId: 'cosa',
        ),
        isTrue,
      );
    });

    test('the screen asks where before it asks the address', () {
      final screen = File(
        'lib/screens/send_freight_screen.dart',
      ).readAsStringSync();
      expect(screen, contains('freightDeliveryAreaLabel'));
      expect(screen, contains('_deliveryAreaId'));
      expect(screen, contains('deliveryAreaId: _deliveryChosen'));
    });
  });
}
