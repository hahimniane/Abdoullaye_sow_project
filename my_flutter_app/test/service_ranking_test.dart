import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/business_destination_option.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/services/freight_categories.dart';
import 'package:my_flutter_app/services/freight_coverage.dart';
import 'package:my_flutter_app/services/service_ranking.dart';

/// A business option shaped like the one the callable sends -
/// freightCategories already resolved to this business's multipliers.
BusinessDestinationOption option(
  String businessId, {
  double airRate = 10,
  double seaRate = 0,
  int? airDays,
  int? airMaxDays,
  int? seaDays,
  bool coversLoss = false,
  double ratePct = 0,
  double maxDeclaredValue = 0,
  Map<String, double> categoryRates = const {},
  double barrelPrice = 0,
  int? barrelDays,
  double reviewWeightedScore = 0,
}) {
  return BusinessDestinationOption(
    id: '$businessId-guinea',
    businessId: businessId,
    businessName: businessId,
    country: DestinationCountry(
      id: 'guinea',
      name: 'Guinea',
      freightAirAvailable: airRate > 0,
      freightSeaAvailable: seaRate > 0,
      freightAirPricePerKg: airRate,
      freightSeaPricePerKg: seaRate,
      // The delivery estimate, not the departure days - those are weekday
      // names for when a shipment leaves, not a duration.
      freightAirDeliveryEstimateMinDays: airDays,
      freightAirDeliveryEstimateMaxDays: airMaxDays,
      freightSeaDeliveryEstimateMinDays: seaDays,
      barrelShippingPrice: barrelPrice,
      barrelShippingDeliveryEstimateMinDays: barrelDays,
    ),
    reviewWeightedScore: reviewWeightedScore,
    freightCategories: [
      for (final entry in categoryRates.entries)
        FreightCategory(
          id: entry.key,
          label: entry.key,
          multiplier: entry.value,
        ),
    ],
    freightCoverage: FreightCoveragePolicy(
      coversLoss: coversLoss,
      ratePct: ratePct,
      maxDeclaredValue: maxDeclaredValue,
    ),
  );
}

List<String> ids(List<BusinessDestinationOption> rows) =>
    rows.map((row) => row.businessId).toList();

void main() {
  group('what a parcel actually costs at each business', () {
    test('ranks on the real quote, not the headline rate', () {
      // The business cheaper per kilo can be dearer for electronics. Ranking
      // on the rate alone would name the wrong winner.
      final cheapPerKg = option(
        'cheap-per-kg',
        airRate: 10,
        categoryRates: {'electronics': 3},
      );
      final dearPerKg = option(
        'dear-per-kg',
        airRate: 12,
        categoryRates: {'electronics': 1},
      );

      expect(
        serviceOptionTotal(
          cheapPerKg,
          service: 'freight',
          weightKg: 5,
          mode: 'air',
          categoryId: 'electronics',
        ),
        150,
      );
      expect(
        ids(
          sortServiceOptions(
            service: 'freight',
            [cheapPerKg, dearPerKg],
            weightKg: 5,
            mode: 'air',
            categoryId: 'electronics',
          ),
        ),
        ['dear-per-kg', 'cheap-per-kg'],
      );
    });

    test('counts the coverage fee, because the customer pays it', () {
      final withCover = option(
        'covers',
        airRate: 10,
        coversLoss: true,
        ratePct: 2,
        maxDeclaredValue: 2000,
      );
      // 1kg at $10, plus 2% of $1,000 declared = $30.
      expect(
        serviceOptionTotal(
          withCover,
          service: 'freight',
          weightKg: 1,
          mode: 'air',
          declaredValue: 1000,
        ),
        30,
      );
    });

    test('does not rank a business first when it would refuse the parcel', () {
      // Declaring $3,000 at a business capped at $1,000 is a booking the
      // server rejects. Cheapest-first must not walk the customer into that.
      final capped = option(
        'capped',
        airRate: 1,
        coversLoss: true,
        ratePct: 1,
        maxDeclaredValue: 1000,
      );
      final takesIt = option(
        'dearer-but-takes-it',
        airRate: 50,
        coversLoss: true,
        ratePct: 1,
        maxDeclaredValue: 5000,
      );

      expect(
        serviceOptionTotal(
          capped,
          service: 'freight',
          weightKg: 1,
          mode: 'air',
          declaredValue: 3000,
        ),
        kUnknownSortValue,
      );
      expect(
        ids(
          sortServiceOptions(
            service: 'freight',
            [capped, takesIt],
            weightKg: 1,
            mode: 'air',
            declaredValue: 3000,
          ),
        ),
        ['dearer-but-takes-it', 'capped'],
      );
    });
  });

  group('ranking before the customer has chosen air or sea', () {
    test('judges each business on whichever mode it does best', () {
      // The mobile search list ranks before a mode is picked. Judging on one
      // fixed mode would bury an air-only business under a sea ranking for a
      // service it never claimed to offer.
      final airOnly = option('air-only', airRate: 5, seaRate: 0);
      final seaOnly = option('sea-only', airRate: 0, seaRate: 9);

      expect(
        ids(sortServiceOptions([seaOnly, airOnly], service: 'freight', weightKg: 1, mode: '')),
        ['air-only', 'sea-only'],
      );
      // With a mode fixed, the business that does not serve it sinks.
      expect(
        ids(sortServiceOptions([seaOnly, airOnly], service: 'freight', weightKg: 1, mode: 'air')),
        ['air-only', 'sea-only'],
      );
    });

    test('takes the faster of the two modes when neither is chosen', () {
      final quickBySea = option(
        'quick-by-sea',
        airRate: 5,
        seaRate: 5,
        airDays: 30,
        seaDays: 4,
      );
      expect(serviceOptionDays(quickBySea, 'freight', ''), 4);
      expect(serviceOptionDays(quickBySea, 'freight', 'air'), 30);
    });
  });

  group('fastest', () {
    test('sinks businesses that never stated a delivery time', () {
      final sorted = sortServiceOptions(
        service: 'freight',
        [
          option('silent'),
          option('slow', airDays: 20),
          option('quick', airDays: 4),
        ],
        sort: ServiceSort.fastest,
        weightKg: 1,
        mode: 'air',
      );
      expect(ids(sorted), ['quick', 'slow', 'silent']);
    });

    test('separates a shared lower bound by the upper one', () {
      final sorted = sortServiceOptions(
        service: 'freight',
        [
          option('wide', airDays: 2, airMaxDays: 15),
          option('tight', airDays: 2, airMaxDays: 3),
        ],
        sort: ServiceSort.fastest,
        weightKg: 1,
        mode: 'air',
      );
      expect(ids(sorted), ['tight', 'wide']);
    });
  });

  group('best cover', () {
    test('puts the business that stands behind the parcel first', () {
      // Deliberately ranks the dearer business first: this sort is about who
      // stands behind the parcel, and the price is on the card either way.
      final sorted = sortServiceOptions(
        service: 'freight',
        [
          option('bare', airRate: 5),
          option(
            'covers',
            airRate: 30,
            coversLoss: true,
            ratePct: 2,
            maxDeclaredValue: 1000,
          ),
        ],
        sort: ServiceSort.coverage,
        weightKg: 1,
        mode: 'air',
      );
      expect(ids(sorted), ['covers', 'bare']);
    });

    test('prefers a higher ceiling, then a cheaper rate', () {
      final sorted = sortServiceOptions(
        service: 'freight',
        [
          option(
            'low-ceiling',
            coversLoss: true,
            ratePct: 1,
            maxDeclaredValue: 500,
          ),
          option(
            'high-ceiling',
            coversLoss: true,
            ratePct: 3,
            maxDeclaredValue: 5000,
          ),
          option(
            'same-ceiling-cheaper',
            coversLoss: true,
            ratePct: 1,
            maxDeclaredValue: 5000,
          ),
        ],
        sort: ServiceSort.coverage,
        weightKg: 1,
        mode: 'air',
      );
      expect(ids(sorted), [
        'same-ceiling-cheaper',
        'high-ceiling',
        'low-ceiling',
      ]);
    });
  });

  group('stability', () {
    test('gives the same order every time when everything ties', () {
      // Ties are the norm at this size. A list that reshuffles between loads
      // reads as broken.
      final rows = [option('ccc'), option('aaa'), option('bbb')];
      final first = ids(sortServiceOptions(rows, service: 'freight', weightKg: 1, mode: 'air'));
      final second = ids(
        sortServiceOptions(rows.reversed.toList(), service: 'freight', weightKg: 1, mode: 'air'),
      );
      expect(first, second);
      expect(first, ['aaa', 'bbb', 'ccc']);
    });

    test('never mutates the list it was handed', () {
      final rows = [option('b'), option('a')];
      sortServiceOptions(rows, service: 'freight', weightKg: 1, mode: 'air');
      expect(ids(rows), ['b', 'a']);
    });
  });

  group('whether to offer the control at all', () {
    test('stays hidden until there is enough to order', () {
      // A sort control over one result advertises a choice that does not
      // exist. Every route had exactly one freight business when this was
      // written.
      expect(shouldOfferServiceSort([], 'freight'), isFalse);
      expect(shouldOfferServiceSort([option('a'), option('b')], 'freight'), isFalse);
      expect(
        shouldOfferServiceSort([
          for (var i = 0; i < kMinOptionsForSort; i += 1) option('b$i'),
        ], 'freight'),
        isTrue,
      );
    });
  });

  group('what each service can be sorted by', () {
    test('only offers cover where a loss policy exists', () {
      // freightCoverageEnabled is the platform's one loss policy. Offering
      // "best cover" on barrels would rank every business identically.
      for (final service in ['barrelShipping', 'sharedBarrels', 'carParking']) {
        expect(
          sortsForService(service).contains(ServiceSort.coverage),
          isFalse,
          reason: service,
        );
      }
      expect(
        sortsForService('freight').contains(ServiceSort.coverage),
        isTrue,
      );
    });

    test('offers rating everywhere, because every business carries one', () {
      for (final service in kServiceSorts.keys) {
        expect(
          sortsForService(service).contains(ServiceSort.rated),
          isTrue,
          reason: service,
        );
      }
    });

    test('starts a service on a sort it can actually answer', () {
      expect(defaultSortForService('freight'), ServiceSort.cheapest);
      // No price before the bid, so cheapest is not on offer and must not be
      // the starting order either.
      expect(defaultSortForService('carTransport'), ServiceSort.rated);
      expect(defaultSortForService('teleportation'), isNull);
    });

    test('hides the control for a service with one way to order it', () {
      final enough = [
        for (var i = 0; i < kMinOptionsForSort; i += 1) option('b$i'),
      ];
      expect(shouldOfferServiceSort(enough, 'carTransport'), isFalse);
      expect(shouldOfferServiceSort(enough, 'carSales'), isFalse);
      expect(shouldOfferServiceSort(enough, 'teleportation'), isFalse);
    });
  });

  group('pricing each service on its own terms', () {
    test('prices barrels per barrel, times how many', () {
      final row = option('a', barrelPrice: 120);
      expect(
        serviceOptionTotal(
          row,
          service: 'barrelShipping',
          weightKg: 1,
          mode: '',
          quantity: 3,
        ),
        360,
      );
      // The picker sits above the quantity field; one barrel each is still a
      // fair comparison, and zero would price everything the same.
      expect(
        serviceOptionTotal(row, service: 'barrelShipping', weightKg: 1,
            mode: ''),
        120,
      );
    });

    test('cannot price a service that is quoted after the fact', () {
      // Car transport is bid on, and a car's price is on the listing, not the
      // business. Both must sink rather than pretend to be free.
      for (final service in ['carTransport', 'carSales']) {
        expect(
          serviceOptionTotal(option('a'), service: service, weightKg: 1,
              mode: 'air'),
          kUnknownSortValue,
          reason: service,
        );
      }
    });

    test('gives barrels their own delivery estimate, shared or solo', () {
      final row = option('a', barrelDays: 10);
      expect(serviceOptionDays(row, 'barrelShipping'), 10);
      // A share rides in the same container as a solo barrel.
      expect(serviceOptionDays(row, 'sharedBarrels'), 10);
      // Freight reads its own estimate and finds nothing here.
      expect(serviceOptionDays(row, 'freight', 'air'), kUnknownSortValue);
    });
  });

  group('ordering by rating', () {
    test('treats an unrated business as average, not as terrible', () {
      // The score is Bayesian-damped, so an unrated business sits at the
      // prior. Sinking it would punish every new business on the platform.
      final sorted = sortServiceOptions(
        [
          option('poorly-rated', reviewWeightedScore: 2.1),
          option('unrated', reviewWeightedScore: 3.8),
          option('great', reviewWeightedScore: 4.6),
        ],
        service: 'carTransport',
        sort: ServiceSort.rated,
      );
      expect(ids(sorted), ['great', 'unrated', 'poorly-rated']);
    });

    test('treats a business with no review score at all as average', () {
      // The aggregate is only written when a review lands, so a business that
      // has never been reviewed arrives with no score rather than the prior.
      // Reading that as zero sank it below a business rated 3.5 - caught on
      // live data, not in this file.
      final sorted = sortServiceOptions(
        [
          option('rated-3.5', reviewWeightedScore: 3.74),
          option('never-reviewed'),
        ],
        service: 'carTransport',
        sort: ServiceSort.rated,
      );
      expect(ids(sorted), ['never-reviewed', 'rated-3.5']);
    });
  });
}
