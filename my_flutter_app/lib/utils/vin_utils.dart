const int vinLength = 17;

final RegExp _invalidVinCharacters = RegExp(r'[IOQ]');
final RegExp _ocrVinCharacter = RegExp(r'[A-Z0-9]');
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
    if (_ocrVinCharacter.hasMatch(character)) {
      segment += character;
      if (segment.length >= vinLength) {
        for (var index = 0; index <= segment.length - vinLength; index++) {
          final candidate = segment.substring(index, index + vinLength);
          final vin = _validVinFromOcrCandidate(candidate);
          if (vin != null) latestCandidate = vin;
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
  return _validVinFromOcrCandidate(normalized);
}

String? extractVinCandidateForReview(String text) {
  final segments = <String>[];
  var segment = '';
  for (final codeUnit in text.toUpperCase().codeUnits) {
    final character = String.fromCharCode(codeUnit);
    if (_ocrVinCharacter.hasMatch(character)) {
      segment += character;
    } else if (!_separatorCharacter.hasMatch(character)) {
      if (segment.length >= vinLength) segments.add(segment);
      segment = '';
    }
  }
  if (segment.length >= vinLength) segments.add(segment);

  for (final segment in segments) {
    if (segment.length == vinLength) return segment;
    if (segment.length > vinLength) {
      final candidate = _bestReviewCandidate(segment);
      if (candidate != null) return candidate;
    }
  }
  return null;
}

String? _bestReviewCandidate(String segment) {
  String? best;
  var bestScore = -1;
  for (var index = 0; index <= segment.length - vinLength; index++) {
    final candidate = segment.substring(index, index + vinLength);
    final score = _vinLikeScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

int _vinLikeScore(String candidate) {
  var score = 0;
  for (final codeUnit in candidate.codeUnits) {
    final character = String.fromCharCode(codeUnit);
    if (_ocrVinCharacter.hasMatch(character)) score++;
    if (!_invalidVinCharacters.hasMatch(character)) score++;
    if (int.tryParse(character) != null) score += 3;
  }
  return score;
}

String? _validVinFromOcrCandidate(String candidate) {
  final normalized = normalizeVin(candidate);
  if (normalized.length != vinLength) return null;
  if (isValidVin(normalized)) return normalized;

  final invalidIndexes = <int>[];
  for (var index = 0; index < normalized.length; index++) {
    final character = normalized[index];
    if (_invalidVinCharacters.hasMatch(character)) {
      invalidIndexes.add(index);
    }
  }
  if (invalidIndexes.isEmpty || invalidIndexes.length > 4) return null;

  final repaired = normalized.split('');
  for (final index in invalidIndexes) {
    repaired[index] = switch (repaired[index]) {
      'I' => '1',
      'O' || 'Q' => '0',
      _ => repaired[index],
    };
  }
  final repairedVin = repaired.join();
  if (isValidVin(repairedVin)) {
    return repairedVin;
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
