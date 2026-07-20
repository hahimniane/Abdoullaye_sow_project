import '../data/calling_code_catalog.dart';
import '../models/destination_country.dart';
import 'phone_number_validator.dart';

class ReceiverPhoneRules {
  static String? validate({
    required String? value,
    required DestinationCountry? destination,
    required bool allowDifferentCountry,
    required String requiredMessage,
    required String invalidPhoneMessage,
    required String invalidInternationalPhoneMessage,
    required String whatsAppCountryCodeMessage,
    required String Function(String destinationName, String prefix)
    destinationMismatchMessage,
  }) {
    final raw = value?.trim() ?? '';
    if (raw.isEmpty) return requiredMessage;

    final normalized = PhoneNumberValidator.normalized(raw);
    if (!PhoneNumberValidator.isValid(raw)) {
      return invalidPhoneMessage;
    }

    final international = normalized.startsWith('+')
        ? normalized.substring(1)
        : normalized;
    if (international.length < 8 || international.length > 15) {
      return invalidInternationalPhoneMessage;
    }

    final destinationCode = destination?.displayCode ?? '';
    final expectedCodes = CallingCodeCatalog.callingCodesForCountryCode(
      destinationCode,
    );
    if (expectedCodes.isEmpty) return null;

    final matchesDestination = expectedCodes.any(
      (code) => international.startsWith(code),
    );
    if (matchesDestination) return null;

    if (allowDifferentCountry) {
      return normalized.startsWith('+') ? null : whatsAppCountryCodeMessage;
    }

    final prefixExample = '+${expectedCodes.first}';
    final destinationName = destination?.name ?? 'the destination';
    return destinationMismatchMessage(destinationName, prefixExample);
  }

  static bool isDifferentCountryNumber({
    required String value,
    required DestinationCountry? destination,
  }) {
    final normalized = PhoneNumberValidator.normalized(value);
    if (!PhoneNumberValidator.isValid(value)) return false;

    final destinationCode = destination?.displayCode ?? '';
    final expectedCodes = CallingCodeCatalog.callingCodesForCountryCode(
      destinationCode,
    );
    if (expectedCodes.isEmpty) return false;

    final international = normalized.startsWith('+')
        ? normalized.substring(1)
        : normalized;
    return !expectedCodes.any((code) => international.startsWith(code));
  }
}
