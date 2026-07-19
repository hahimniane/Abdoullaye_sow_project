import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations_en.dart';
import 'package:my_flutter_app/l10n/app_localizations_fr.dart';
import 'package:my_flutter_app/models/car.dart';

Car _car({bool? isRebuiltTitle}) {
  return Car(
    id: 'car-1',
    title: 'Test car',
    make: 'Toyota',
    model: 'Camry',
    year: '2020',
    mileage: '10000',
    price: 12000,
    description: '',
    features: const [],
    imageUrls: const [],
    status: 'active',
    contactPhone: '',
    isRebuiltTitle: isRebuiltTitle,
  );
}

void main() {
  test('legacy cars remain unknown instead of defaulting to clean title', () {
    expect(_car().isRebuiltTitle, isNull);

    final modelSource = File('lib/models/car.dart').readAsStringSync();
    expect(
      modelSource,
      contains("isRebuiltTitle: data['isRebuiltTitle'] is bool"),
    );
    expect(modelSource, contains("? data['isRebuiltTitle'] as bool"));
    expect(modelSource, contains(': null,'));
  });

  test('new and edited listings require and persist an explicit bool', () {
    expect(_car(isRebuiltTitle: true).isRebuiltTitle, isTrue);
    expect(_car(isRebuiltTitle: false).isRebuiltTitle, isFalse);

    final staffSource = File(
      'lib/screens/staff_car_management_screen.dart',
    ).readAsStringSync();
    expect(staffSource, contains('_isRebuiltTitle = car?.isRebuiltTitle;'));
    expect(staffSource, contains('_isRebuiltTitle == null ||'));
    expect(staffSource, contains('isRebuiltTitle: _isRebuiltTitle!'));
    expect(staffSource, contains("'isRebuiltTitle': isRebuiltTitle"));
  });

  test(
    'customer card and detail disclose rebuilt, clean, and unknown states',
    () {
      final cardSource = File(
        'lib/screens/sell_cars_screen.dart',
      ).readAsStringSync();
      final detailSource = File(
        'lib/screens/car_details_screen.dart',
      ).readAsStringSync();

      for (final source in [cardSource, detailSource]) {
        expect(source, contains('l10n.rebuiltTitleYes'));
        expect(source, contains('l10n.rebuiltTitleNo'));
        expect(source, contains('l10n.rebuiltTitleUnknown'));
      }
      expect(detailSource, contains('final bool? isRebuiltTitle;'));
      expect(
        detailSource,
        contains('final isUnknown = isRebuiltTitle == null;'),
      );
    },
  );

  test('favorite snapshots preserve and disclose rebuilt-title status', () {
    final favoriteServiceSource = File(
      'lib/services/favorite_cars_service.dart',
    ).readAsStringSync();
    final favoriteScreenSource = File(
      'lib/screens/favorite_cars_screen.dart',
    ).readAsStringSync();

    expect(
      favoriteServiceSource,
      contains("'isRebuiltTitle': car.isRebuiltTitle"),
    );
    expect(favoriteServiceSource, contains("data['isRebuiltTitle'] is bool"));
    expect(favoriteScreenSource, contains('favorite.isRebuiltTitle == null'));
    expect(favoriteScreenSource, contains('l10n.rebuiltTitleUnknown'));
  });

  test('English and French title disclosures are complete and distinct', () {
    final en = AppLocalizationsEn();
    final fr = AppLocalizationsFr();

    expect(en.rebuiltTitleUnknown, 'Not provided');
    expect(fr.rebuiltTitleUnknown, 'Non renseigné');
    expect(en.rebuiltTitleYes, contains('rebuilt'));
    expect(en.rebuiltTitleNo, contains('not a rebuilt'));
    expect(fr.rebuiltTitleYes, contains('reconstruit'));
    expect(fr.rebuiltTitleNo, contains('pas de titre reconstruit'));
    expect(en.rebuiltTitleDisclosureHelp, isNotEmpty);
    expect(fr.rebuiltTitleDisclosureHelp, isNotEmpty);
  });
}
