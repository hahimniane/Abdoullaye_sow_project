import '../l10n/app_localizations.dart';
import '../services/parking_lots.dart';

/// EN/FR copy for the parking lots: the decisions are in
/// `services/parking_lots.dart`, the words are here (the same split as
/// `business_parking_localization.dart`).

/// The sentence for one of the server's lot refusals (`details.reason`);
/// '' for a reason that is not a lot refusal.
String parkingLotRefusalText(AppLocalizations l10n, String reason) =>
    switch (reason) {
      'lot_name_required' => l10n.pltRefusalNameRequired,
      'lot_name_taken' => l10n.pltRefusalNameTaken,
      'lot_spaces_invalid' => l10n.pltRefusalSpacesInvalid,
      'lot_blocked_invalid' => l10n.pltRefusalBlockedInvalid,
      'lot_not_found' => l10n.pltRefusalNotFound,
      'lot_closed' => l10n.pltRefusalClosed,
      'lot_full' => l10n.pltRefusalFull,
      'lot_has_cars' => l10n.pltRefusalHasCars,
      'lot_last_open' => l10n.pltRefusalLastOpen,
      'lot_limit' => l10n.pltRefusalLimit,
      _ => '',
    };

/// A failed lot call as a sentence: the server's refusal in words, else
/// [fallback]. Never the server's English `message`.
String parkingLotFailureText(
  AppLocalizations l10n,
  Object? failure,
  String fallback,
) {
  final text = parkingLotRefusalText(l10n, parkingLotRefusalReason(failure));
  return text.isEmpty ? fallback : text;
}

/// What a typed-lot problem says, before the trip.
String parkingLotErrorText(AppLocalizations l10n, ParkingLotError error) =>
    parkingLotRefusalText(l10n, error.reason);
