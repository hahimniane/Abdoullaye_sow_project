import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/data/country_catalog.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/services/destination_visibility.dart';

DestinationCountry _c(
  String id, {
  bool active = false,
  bool main = false,
  bool barrel = false,
  bool car = false,
}) => DestinationCountry(
  id: id,
  name: id[0].toUpperCase() + id.substring(1),
  code: id.substring(0, 2).toUpperCase(),
  isActive: active,
  isMain: main,
  barrelShippingAvailable: barrel,
  carTransportAvailable: car,
);

void main() {
  group('destinationIsInUse', () {
    test('a destination is in use when active, main, or any service is on', () {
      expect(destinationIsInUse(_c('guinea', active: true)), isTrue);
      expect(destinationIsInUse(_c('senegal', main: true)), isTrue);
      expect(destinationIsInUse(_c('mali', barrel: true)), isTrue);
      expect(destinationIsInUse(_c('niger', car: true)), isTrue);
    });

    test('an empty seeded record is not in use', () {
      expect(destinationIsInUse(_c('albania')), isFalse);
    });
  });

  group('listedDestinations', () {
    test('drops the empty seeded records and keeps the order', () {
      final listed = listedDestinations([
        _c('albania'),
        _c('senegal', main: true),
        _c('algeria'),
        _c('guinea', active: true),
      ]);
      expect(listed.map((c) => c.id), ['senegal', 'guinea']);
    });

    test('a business with only empty records lists nothing', () {
      expect(listedDestinations([_c('albania'), _c('algeria')]), isEmpty);
    });
  });

  group('destinationsToAdd', () {
    test('offers every catalog country that is not listed', () {
      final offered = destinationsToAdd([_c('guinea', active: true)]);
      expect(offered.any((c) => c.id == 'guinea'), isFalse);
      expect(offered.length, CountryCatalog.all.length - 1);
    });

    test('includes a country whose record exists but is unused, with its record',
        () {
      final stored = DestinationCountry(
        id: 'albania',
        name: 'Albania',
        code: 'AL',
        destinationNote: 'kept',
      );
      final offered = destinationsToAdd([stored]);
      final albania = offered.singleWhere((c) => c.id == 'albania');
      expect(albania.destinationNote, 'kept');
    });

    test('a stored record outside the catalog is offered when unused', () {
      final offered = destinationsToAdd(
        [_c('atlantis')],
        catalog: const [DestinationCountry(id: 'chad', name: 'Chad')],
      );
      expect(offered.map((c) => c.id), containsAll(['atlantis', 'chad']));
    });

    test('is sorted by name', () {
      final names = destinationsToAdd(const []).map((c) => c.name.toLowerCase());
      expect(names.toList(), [...names]..sort());
    });
  });

  group('destinationMatchesSearch', () {
    test('matches name, code and flag; blank matches everything', () {
      final guinea = _c('guinea');
      expect(destinationMatchesSearch(guinea, ''), isTrue);
      expect(destinationMatchesSearch(guinea, 'guin'), isTrue);
      expect(destinationMatchesSearch(guinea, 'gu'), isTrue);
      expect(destinationMatchesSearch(guinea, guinea.flagEmoji), isTrue);
      expect(destinationMatchesSearch(guinea, 'mali'), isFalse);
    });
  });

  group('setMainDestination', () {
    test('sends the country, and an empty id to clear the current main', () async {
      final sent = <(String, Map<String, Object?>)>[];
      Future<Object?> caller(String name, Map<String, Object?> payload) async {
        sent.add((name, payload));
        return null;
      }

      final nowMain = await setMainDestination(
        businessId: 'b1',
        country: _c('guinea', active: true),
        caller: caller,
      );
      expect(nowMain, isTrue);
      expect(sent.single.$1, 'setMainDestination');
      expect(sent.single.$2, {'businessId': 'b1', 'countryId': 'guinea'});

      final cleared = await setMainDestination(
        businessId: 'b1',
        country: _c('guinea', main: true),
        caller: caller,
      );
      expect(cleared, isFalse);
      expect(sent.last.$2, {'businessId': 'b1', 'countryId': ''});
    });
  });
}
