import 'package:flutter/services.dart';

class PhoneNumberValidator {
  static final allowedInputFormatters = <TextInputFormatter>[
    FilteringTextInputFormatter.allow(RegExp(r'[0-9+().\-\s]')),
  ];

  static String digitsOnly(String value) => value.replaceAll(RegExp(r'\D'), '');

  static String normalized(String value) =>
      value.trim().replaceAll(RegExp(r'[\s().-]'), '');

  static String aliasKey(String value) => digitsOnly(value);

  static bool isValid(String? value) {
    final raw = value?.trim() ?? '';
    if (raw.isEmpty) return false;
    if (RegExp(r'[A-Za-z]').hasMatch(raw)) return false;

    final normalizedValue = normalized(raw);
    if (!RegExp(r'^\+?\d+$').hasMatch(normalizedValue)) return false;

    final digits = digitsOnly(normalizedValue);
    return digits.length >= 7 && digits.length <= 15;
  }

  static String? validate(
    String? value, {
    required String requiredMessage,
    String invalidMessage = 'Enter a valid phone number with 7 to 15 digits.',
  }) {
    if ((value?.trim() ?? '').isEmpty) return requiredMessage;
    return isValid(value) ? null : invalidMessage;
  }
}
