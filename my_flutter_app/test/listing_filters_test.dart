import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/car.dart';
import 'package:my_flutter_app/services/listing_filters.dart';

Car _car(
  String id, {
  String title = '',
  String make = 'Toyota',
  String model = 'Camry',
  String year = '2018',
  String status = 'active',
  double price = 9000,
  String vin = '',
  String stock = '',
  String city = 'Bronx',
}) => Car(
  id: id,
  title: title.isEmpty ? '$year $make $model' : title,
  make: make,
  model: model,
  year: year,
  mileage: '1',
  price: price,
  description: '',
  features: const [],
  imageUrls: const [],
  status: status,
  contactPhone: '',
  vin: vin,
  stockNumber: stock,
  locationCity: city,
);

void main() {
  final cars = [
    _car('a'),
    _car(
      'b',
      make: 'Honda',
      model: 'Civic',
      status: 'sold',
      vin: '1HGCM82633A004352',
    ),
    _car(
      'c',
      make: 'Ford',
      model: 'F-150',
      status: 'draft',
      stock: 'ST-77',
      city: 'Newark',
    ),
    _car('d', make: 'Honda', model: 'Accord', status: ''),
  ];

  test('no query and all statuses returns the same list', () {
    expect(identical(filterListings(cars), cars), isTrue);
    expect(filterListings(cars, status: 'all'), cars);
  });

  test('search matches make, model, vin, stock, city and price, any case', () {
    ids(String q) => filterListings(cars, query: q).map((c) => c.id).toList();
    expect(ids('HONDA'), ['b', 'd']);
    expect(ids('civic'), ['b']);
    expect(ids('004352'), ['b']);
    expect(ids('st-77'), ['c']);
    expect(ids('newark'), ['c']);
    expect(ids('9000'), ['a', 'b', 'c', 'd']);
    expect(ids('honda accord'), ['d']);
    expect(ids('nothing here'), isEmpty);
  });

  test('a blank status counts as active', () {
    expect(listingStatusOf(cars[3]), 'active');
    expect(filterListings(cars, status: 'active').map((c) => c.id), ['a', 'd']);
  });

  test('status filter and search combine', () {
    expect(
      filterListings(cars, query: 'honda', status: 'sold').map((c) => c.id),
      ['b'],
    );
    expect(filterListings(cars, status: 'draft').map((c) => c.id), ['c']);
  });

  test('the console\'s five statuses, in its order', () {
    expect(listingStatuses, [
      'draft',
      'active',
      'reserved',
      'sold',
      'inactive',
    ]);
  });

  test('selection toggles and drops listings that are gone', () {
    var sel = toggleListingSelection(<String>{}, 'a', true);
    sel = toggleListingSelection(sel, 'b', true);
    expect(sel, {'a', 'b'});
    expect(toggleListingSelection(sel, 'a', false), {'b'});
    expect(pruneListingSelection(sel, ['b', 'z']), {'b'});
  });

  test('ids are chunked under the batch limit', () {
    final ids = [for (var i = 0; i < 905; i++) 'i$i'];
    final chunks = chunkListingIds(ids);
    expect(chunks.map((c) => c.length), [400, 400, 105]);
    expect(chunkListingIds(const []), isEmpty);
  });

  group('photo link', () {
    test('accepts a web address under the cap', () {
      expect(
        checkListingImageLink(
          ' https://cdn.example.com/a.jpg ',
          count: 3,
          max: 12,
        ),
        isNull,
      );
    });
    test('refuses blank, non-web and full', () {
      expect(
        checkListingImageLink('  ', count: 0, max: 12),
        ListingImageLinkProblem.empty,
      );
      expect(
        checkListingImageLink('ftp://x.com/a.jpg', count: 0, max: 12),
        ListingImageLinkProblem.notHttps,
      );
      expect(
        checkListingImageLink('not a link', count: 0, max: 12),
        ListingImageLinkProblem.notHttps,
      );
      expect(
        checkListingImageLink('https://localhost/a', count: 0, max: 12),
        ListingImageLinkProblem.notHttps,
      );
      expect(
        checkListingImageLink('https://a.com/x.jpg', count: 12, max: 12),
        ListingImageLinkProblem.full,
      );
    });
  });
}
