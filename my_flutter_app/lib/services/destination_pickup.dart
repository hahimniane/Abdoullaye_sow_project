import '../l10n/app_localizations.dart';
import '../models/destination_country.dart';
import '../utils/phone_number_validator.dart';
import 'waiting_package_service.dart';

/// Where customers collect their goods in one destination country: the
/// optional pickup city, address and phone the ready-for-pickup WhatsApp
/// message gives.
///
/// Mirrors `functions/destination_pickup.js`, which is the authority: the
/// app checks first so the owner sees the reason under the field, then saves
/// through the `setDestinationPickup` callable. The console has the same
/// rules in `admin_web/src/lib/destination-pickup.ts`.
const pickupCityMaxLength = 80;
const pickupAddressMaxLength = 200;

String _oneLine(String value) => value
    .replaceAll(RegExp(r'[\r\n\t]+'), ' ')
    .replaceAll(RegExp(r' {2,}'), ' ')
    .trim();

/// What the owner typed, tidied the way the server stores it.
class DestinationPickup {
  const DestinationPickup({
    this.city = '',
    this.address = '',
    this.phone = '',
  });

  factory DestinationPickup.of(DestinationCountry? country) =>
      DestinationPickup(
        city: country?.pickupCity ?? '',
        address: country?.pickupAddress ?? '',
        phone: country?.pickupPhone ?? '',
      );

  final String city;
  final String address;
  final String phone;

  /// Each field on one line; the phone without its formatting.
  DestinationPickup get normalized => DestinationPickup(
    city: _oneLine(city),
    address: _oneLine(address),
    phone: PhoneNumberValidator.normalized(_oneLine(phone)),
  );

  bool sameAs(DestinationPickup other) {
    final a = normalized;
    final b = other.normalized;
    return a.city == b.city && a.address == b.address && a.phone == b.phone;
  }

  Map<String, Object?> payload() {
    final value = normalized;
    return {
      'pickupCity': value.city,
      'pickupAddress': value.address,
      'pickupPhone': value.phone,
    };
  }
}

String? pickupCityError(AppLocalizations l10n, String value) =>
    _oneLine(value).length > pickupCityMaxLength
    ? l10n.dstPickupCityTooLong
    : null;

String? pickupAddressError(AppLocalizations l10n, String value) =>
    _oneLine(value).length > pickupAddressMaxLength
    ? l10n.dstPickupAddressTooLong
    : null;

/// Blank is fine; anything else must be E.164, which the shared phone field
/// produces once a country is picked.
String? pickupPhoneError(AppLocalizations l10n, String value) {
  final phone = _oneLine(value);
  if (phone.isEmpty) return null;
  return PhoneNumberValidator.isValidE164(phone)
      ? null
      : l10n.dstPickupPhoneInvalid;
}

/// Saves the pickup details when they changed. Returns whether it called
/// the server.
Future<bool> saveDestinationPickup({
  required String businessId,
  required String countryId,
  required DestinationPickup before,
  required DestinationPickup after,
  ContainerCallableCaller caller = callContainerCallable,
}) async {
  if (before.sameAs(after)) return false;
  await caller('setDestinationPickup', {
    'businessId': businessId,
    'countryId': countryId,
    ...after.payload(),
  });
  return true;
}
