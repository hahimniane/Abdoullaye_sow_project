import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/car.dart';
import 'package:my_flutter_app/services/favorite_cars_service.dart';

/// A favourite stores the car as it looked the day it was saved. A listing
/// finished afterwards - photos uploaded, price set - never reached that copy,
/// so the card rendered blank forever: no photo, no title, $0.00. The live car
/// is now layered over the saved copy.
Car _car({
  String title = 'Live title',
  String make = 'BMW',
  String model = '318i',
  String year = '1990',
  double price = 9500,
  List<String> imageUrls = const ['https://example.test/live.jpg'],
  bool? isRebuiltTitle,
}) {
  return Car(
    id: 'car_1',
    title: title,
    make: make,
    model: model,
    year: year,
    mileage: '120000',
    price: price,
    description: '',
    features: const [],
    imageUrls: imageUrls,
    status: 'active',
    contactPhone: '',
    isRebuiltTitle: isRebuiltTitle,
  );
}

FavoriteCarSnapshot _saved({
  String title = '',
  String make = '',
  String model = '',
  String year = '',
  double price = 0,
  String imageUrl = '',
  bool? isRebuiltTitle,
}) {
  return FavoriteCarSnapshot(
    carId: 'car_1',
    title: title,
    make: make,
    model: model,
    year: year,
    price: price,
    imageUrl: imageUrl,
    isRebuiltTitle: isRebuiltTitle,
    createdAt: DateTime.utc(2026, 7, 1),
  );
}

void main() {
  test('a car finished after being saved shows its real details', () {
    // The exact reported failure: saved while the listing was still empty.
    final merged = mergeFavoriteWithLiveCar(_saved(), _car());

    expect(merged.title, 'Live title');
    expect(merged.imageUrl, 'https://example.test/live.jpg');
    expect(merged.price, 9500);
    expect(merged.year, '1990');
  });

  test('live values replace stale saved ones', () {
    final merged = mergeFavoriteWithLiveCar(
      _saved(title: 'Old title', price: 12000, imageUrl: 'old.jpg'),
      _car(title: 'New title', price: 8000, imageUrls: const ['new.jpg']),
    );

    expect(merged.title, 'New title');
    expect(merged.price, 8000);
    expect(merged.imageUrl, 'new.jpg');
  });

  test('a delisted car keeps what was last known about it', () {
    // Whole point of holding the snapshot: the row must not go blank when the
    // car can no longer be read.
    final saved = _saved(title: 'Saved title', price: 7000, imageUrl: 's.jpg');
    final merged = mergeFavoriteWithLiveCar(saved, null);

    expect(merged.title, 'Saved title');
    expect(merged.price, 7000);
    expect(merged.imageUrl, 's.jpg');
  });

  test('an unpriced live car does not render as \$0.00', () {
    // price 0 means "not priced yet", not "free".
    final merged = mergeFavoriteWithLiveCar(
      _saved(price: 7000),
      _car(price: 0),
    );

    expect(merged.price, 7000);
  });

  test('a live car with no photo falls back to the saved one', () {
    final merged = mergeFavoriteWithLiveCar(
      _saved(imageUrl: 'saved.jpg'),
      _car(imageUrls: const []),
    );

    expect(merged.imageUrl, 'saved.jpg');
  });

  test('rebuilt-title status prefers live, keeps saved when live is unknown', () {
    expect(
      mergeFavoriteWithLiveCar(
        _saved(isRebuiltTitle: false),
        _car(isRebuiltTitle: true),
      ).isRebuiltTitle,
      isTrue,
    );
    // A live null is "not stated", so it must not erase what was recorded.
    expect(
      mergeFavoriteWithLiveCar(
        _saved(isRebuiltTitle: true),
        _car(),
      ).isRebuiltTitle,
      isTrue,
    );
  });

  test('identity fields always come from the saved favourite', () {
    final merged = mergeFavoriteWithLiveCar(_saved(), _car());

    expect(merged.carId, 'car_1');
    // Ordering in the list is by when it was favourited, not by the car.
    expect(merged.createdAt, DateTime.utc(2026, 7, 1));
  });
}
