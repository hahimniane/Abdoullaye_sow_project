import '../l10n/app_localizations.dart';

String canonicalCarOptionValue(String value) {
  final normalized = value
      .trim()
      .toLowerCase()
      .replaceAll('&', ' and ')
      .replaceAll(RegExp(r'[^a-z0-9]+'), '_')
      .replaceAll(RegExp(r'_+'), '_')
      .replaceAll(RegExp(r'^_|_$'), '');
  return switch (normalized) {
    'backup_camera' || 'rear_camera' => 'backup_camera',
    'blind_spot' ||
    'blind_spot_monitor' ||
    'blind_spot_monitoring' => 'blind_spot',
    'lane_assist' ||
    'lane_keep_assist' ||
    'lane_keeping_assist' => 'lane_assist',
    'heated_seats' || 'heated_seat' => 'heated_seats',
    'leather_seats' || 'leather_seat' => 'leather_seats',
    'apple_carplay' => 'apple_carplay',
    'android_auto' => 'android_auto',
    'remote_start' => 'remote_start',
    'keyless_entry' || 'keyless_access' => 'keyless_entry',
    'third_row' || 'third_row_seating' => 'third_row',
    'alloy_wheels' || 'alloy_wheel' => 'alloy_wheels',
    'parking_sensors' || 'parking_sensor' => 'parking_sensors',
    'premium_audio' => 'premium_audio',
    'xdrive_awd' => 'awd',
    'gasoline' => 'gas',
    _ => normalized,
  };
}

bool isKnownCanonicalCarOption(String value) {
  return _knownCanonicalCarOptions.contains(canonicalCarOptionValue(value));
}

List<String> canonicalCarFeatureOptions(Iterable<String> values) {
  final optionsByKey = <String, String>{};
  for (final value in values) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) continue;
    final key = canonicalCarOptionValue(trimmed);
    optionsByKey.putIfAbsent(
      key,
      () => isKnownCanonicalCarOption(trimmed) ? key : trimmed,
    );
  }
  final options = optionsByKey.values.toList()..sort();
  return options;
}

bool carFeaturesContainCanonical(
  Iterable<String> carFeatures,
  String selectedFeature,
) {
  final selected = canonicalCarOptionValue(selectedFeature);
  return carFeatures.any(
    (feature) => canonicalCarOptionValue(feature) == selected,
  );
}

String localizedCarOptionLabel(AppLocalizations l10n, String value) {
  switch (canonicalCarOptionValue(value)) {
    case 'excellent':
      return l10n.conditionExcellent;
    case 'good':
      return l10n.conditionGood;
    case 'fair':
      return l10n.conditionFair;
    case 'poor':
      return l10n.conditionPoor;
    case 'new':
      return l10n.conditionNew;
    case 'used':
      return l10n.conditionUsed;
    case 'certified':
      return l10n.conditionCertified;
    case 'salvage':
      return l10n.conditionSalvage;
    case 'sedan':
      return l10n.bodySedan;
    case 'suv':
      return l10n.bodySuv;
    case 'truck':
      return l10n.bodyTruck;
    case 'van':
      return l10n.bodyVan;
    case 'coupe':
      return l10n.bodyCoupe;
    case 'hatchback':
      return l10n.bodyHatchback;
    case 'wagon':
      return l10n.bodyWagon;
    case 'convertible':
      return l10n.bodyConvertible;
    case 'automatic':
      return l10n.transmissionAutomatic;
    case 'manual':
      return l10n.transmissionManual;
    case 'cvt':
      return l10n.transmissionCvt;
    case 'gas':
      return l10n.fuelGas;
    case 'diesel':
      return l10n.fuelDiesel;
    case 'hybrid':
      return l10n.fuelHybrid;
    case 'electric':
      return l10n.fuelElectric;
    case 'plug_in_hybrid':
      return l10n.fuelPlugInHybrid;
    case 'fwd':
      return l10n.drivetrainFwd;
    case 'rwd':
      return l10n.drivetrainRwd;
    case 'awd':
      return l10n.drivetrainAwd;
    case '4wd':
      return l10n.drivetrainFourWd;
    case 'backup_camera':
      return l10n.featureBackupCamera;
    case 'bluetooth':
      return l10n.featureBluetooth;
    case 'leather_seats':
      return l10n.featureLeatherSeats;
    case 'sunroof':
      return l10n.featureSunroof;
    case 'navigation':
      return l10n.featureNavigation;
    case 'heated_seats':
      return l10n.featureHeatedSeats;
    case 'apple_carplay':
      return l10n.featureAppleCarPlay;
    case 'android_auto':
      return l10n.featureAndroidAuto;
    case 'blind_spot':
      return l10n.featureBlindSpot;
    case 'third_row':
      return l10n.featureThirdRow;
    case 'remote_start':
      return l10n.featureRemoteStart;
    case 'keyless_entry':
      return l10n.featureKeylessEntry;
    case 'lane_assist':
      return l10n.featureLaneAssist;
    case 'alloy_wheels':
      return l10n.featureAlloyWheels;
    case 'parking_sensors':
      return l10n.featureParkingSensors;
    case 'premium_audio':
      return l10n.featurePremiumAudio;
    case 'black':
      return l10n.carColorBlack;
    case 'white':
      return l10n.carColorWhite;
    case 'silver':
      return l10n.carColorSilver;
    case 'gray':
      return l10n.carColorGray;
    case 'red':
      return l10n.carColorRed;
    case 'blue':
      return l10n.carColorBlue;
    case 'green':
      return l10n.carColorGreen;
    case 'yellow':
      return l10n.carColorYellow;
    case 'brown':
      return l10n.carColorBrown;
    case 'beige':
      return l10n.carColorBeige;
    case 'gold':
      return l10n.carColorGold;
    case 'orange':
      return l10n.carColorOrange;
    case 'purple':
      return l10n.carColorPurple;
    case 'burgundy':
      return l10n.carColorBurgundy;
    case 'other':
      return l10n.carColorOther;
    default:
      return value;
  }
}

const Set<String> _knownCanonicalCarOptions = {
  'excellent',
  'good',
  'fair',
  'poor',
  'new',
  'used',
  'certified',
  'salvage',
  'sedan',
  'suv',
  'truck',
  'van',
  'coupe',
  'hatchback',
  'wagon',
  'convertible',
  'automatic',
  'manual',
  'cvt',
  'gas',
  'diesel',
  'hybrid',
  'electric',
  'plug_in_hybrid',
  'fwd',
  'rwd',
  'awd',
  '4wd',
  'backup_camera',
  'bluetooth',
  'leather_seats',
  'sunroof',
  'navigation',
  'heated_seats',
  'apple_carplay',
  'android_auto',
  'blind_spot',
  'third_row',
  'remote_start',
  'keyless_entry',
  'lane_assist',
  'alloy_wheels',
  'parking_sensors',
  'premium_audio',
  'black',
  'white',
  'silver',
  'gray',
  'red',
  'blue',
  'green',
  'yellow',
  'brown',
  'beige',
  'gold',
  'orange',
  'purple',
  'burgundy',
  'other',
};
