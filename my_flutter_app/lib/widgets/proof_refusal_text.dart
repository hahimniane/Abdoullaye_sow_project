import '../l10n/app_localizations.dart';

/// The refusal codes the air-packages work added on the server
/// (docs/AIR_PACKAGES.md §4 "Refusal codes added"), each in the app's own
/// words. `package_proof.REFUSAL` holds the first seven;
/// `collected_cents_invalid` is a delivery refusal, `proof_settings_invalid`
/// a settings one, `air_waybill_invalid` a container one, `sender_problem`
/// a loading warning and `not_found` the counter look-up's. One place, so
/// every screen that meets one of these codes reads the same sentence.
const proofRefusalCodes = <String>[
  'air_waybill_invalid',
  'photo_invalid',
  'photo_required',
  'contents_invalid',
  'weight_invalid',
  'declared_value_invalid',
  'pickup_code_invalid',
  'override_incomplete',
  'collected_cents_invalid',
  'proof_settings_invalid',
  'sender_problem',
  'not_found',
];

/// The sentence for [code], or null when it is not one of ours.
String? proofRefusalText(AppLocalizations l10n, String code) =>
    switch (code) {
      'air_waybill_invalid' => l10n.deliverRefusalAirWaybillInvalid,
      'photo_invalid' => l10n.deliverRefusalPhotoInvalid,
      'photo_required' => l10n.deliverRefusalPhotoRequired,
      'contents_invalid' => l10n.deliverRefusalContentsInvalid,
      'weight_invalid' => l10n.deliverRefusalWeightInvalid,
      'declared_value_invalid' => l10n.deliverRefusalDeclaredValueInvalid,
      'pickup_code_invalid' => l10n.deliverRefusalPickupCodeInvalid,
      'override_incomplete' => l10n.deliverRefusalOverrideIncomplete,
      'collected_cents_invalid' => l10n.deliverRefusalCollectedCentsInvalid,
      'proof_settings_invalid' => l10n.deliverRefusalProofSettingsInvalid,
      'sender_problem' => l10n.deliverRefusalSenderProblem,
      'not_found' => l10n.lookupNotFound,
      _ => null,
    };
