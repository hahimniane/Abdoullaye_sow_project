const int vinLength = 17;

final RegExp _invalidVinCharacters = RegExp(r'[IOQ]');
final RegExp _allowedVinCharacter = RegExp(r'[A-HJ-NPR-Z0-9]');
final RegExp _separatorCharacter = RegExp(r'[\s-]');

String normalizeVin(String value) {
  return value.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');
}

bool isValidVin(String value) {
  final vin = normalizeVin(value);
  return vin.length == vinLength &&
      !_invalidVinCharacters.hasMatch(vin) &&
      _hasValidCheckDigit(vin);
}

String? extractVin(String text) {
  var segment = '';
  String? latestCandidate;
  for (final codeUnit in text.toUpperCase().codeUnits) {
    final character = String.fromCharCode(codeUnit);
    if (_allowedVinCharacter.hasMatch(character)) {
      segment += character;
      if (segment.length >= vinLength) {
        for (var index = 0; index <= segment.length - vinLength; index++) {
          final candidate = segment.substring(index, index + vinLength);
          if (isValidVin(candidate)) latestCandidate = candidate;
        }
      }
    } else if (!_separatorCharacter.hasMatch(character)) {
      segment = '';
    }
  }
  if (latestCandidate != null) return latestCandidate;
  final normalized = normalizeVin(text);
  if (isValidVin(normalized)) {
    return normalized;
  }
  return null;
}

bool _hasValidCheckDigit(String vin) {
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  var sum = 0;
  for (var index = 0; index < vin.length; index++) {
    final value = _transliterateVinCharacter(vin[index]);
    if (value == null) return false;
    sum += value * weights[index];
  }
  final remainder = sum % 11;
  final expected = remainder == 10 ? 'X' : remainder.toString();
  return vin[8] == expected;
}

int? _transliterateVinCharacter(String character) {
  final digit = int.tryParse(character);
  if (digit != null) return digit;
  return switch (character) {
    'A' || 'J' => 1,
    'B' || 'K' || 'S' => 2,
    'C' || 'L' || 'T' => 3,
    'D' || 'M' || 'U' => 4,
    'E' || 'N' || 'V' => 5,
    'F' || 'W' => 6,
    'G' || 'P' || 'X' => 7,
    'H' || 'Y' => 8,
    'R' || 'Z' => 9,
    _ => null,
  };
}
