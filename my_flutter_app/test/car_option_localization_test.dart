import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations_en.dart';
import 'package:my_flutter_app/l10n/app_localizations_fr.dart';
import 'package:my_flutter_app/utils/car_option_localization.dart';

void main() {
  test('localizes canonical and display feature values in French', () {
    final l10n = AppLocalizationsFr();

    expect(localizedCarOptionLabel(l10n, 'backup_camera'), 'Caméra de recul');
    expect(localizedCarOptionLabel(l10n, 'Backup camera'), 'Caméra de recul');
    expect(
      localizedCarOptionLabel(l10n, 'Blind spot monitor'),
      'Détection angle mort',
    );
    expect(localizedCarOptionLabel(l10n, 'Heated seats'), 'Sièges chauffants');
    expect(
      localizedCarOptionLabel(l10n, 'Lane assist'),
      'Aide au maintien de voie',
    );
    expect(
      localizedCarOptionLabel(l10n, 'Custom cooled cupholder'),
      'Custom cooled cupholder',
    );
  });

  test('keeps English localization correct for display feature aliases', () {
    final l10n = AppLocalizationsEn();

    expect(localizedCarOptionLabel(l10n, 'xDrive AWD'), 'AWD');
    expect(localizedCarOptionLabel(l10n, 'Premium audio'), 'Premium audio');
  });

  test('collapses duplicate raw and canonical feature options', () {
    expect(
      canonicalCarFeatureOptions([
        'backup_camera',
        'Backup camera',
        'Blind spot monitor',
        'blind_spot',
        'Custom option',
      ]),
      ['Custom option', 'backup_camera', 'blind_spot'],
    );
  });

  test(
    'matches selected canonical feature against raw listing feature values',
    () {
      expect(
        carFeaturesContainCanonical([
          'Backup camera',
          'Bluetooth',
        ], 'backup_camera'),
        isTrue,
      );
      expect(
        carFeaturesContainCanonical(['Lane assist'], 'lane_assist'),
        isTrue,
      );
      expect(
        carFeaturesContainCanonical(['Leather seats'], 'heated_seats'),
        isFalse,
      );
    },
  );
}
