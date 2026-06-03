import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/vin_utils.dart';

void main() {
  test('validates 17-character VINs', () {
    expect(isValidVin('1HGCM82633A004352'), isTrue);
    expect(normalizeVin(' 1hg cm82633a004352 '), '1HGCM82633A004352');
  });

  test('rejects short VINs and invalid VIN characters', () {
    expect(isValidVin('1HGCM82633A00435'), isFalse);
    expect(isValidVin('1HGCM82633A00435O'), isFalse);
    expect(isValidVin('1HGCM82633A00435I'), isFalse);
    expect(isValidVin('1HGCM82633A00435Q'), isFalse);
  });

  test('extracts VIN from OCR text with spaces and line breaks', () {
    const text = '''
      VEHICLE IDENTIFICATION NUMBER
      1HG CM8263
      3A004352
    ''';

    expect(extractVin(text), '1HGCM82633A004352');
  });

  test('repairs common OCR VIN mistakes only when checksum stays valid', () {
    expect(extractVin('VIN 1HGCM82633AOO4352'), '1HGCM82633A004352');
    expect(extractVin('VIN 1HGCM82633AO0435I'), isNull);
  });

  test('returns review candidate when OCR text is VIN-like but invalid', () {
    const text = '''
      VIN PLATE
      4T1 BF1FK
      5HU6O3521
    ''';

    expect(extractVin(text), isNull);
    expect(extractVinCandidateForReview(text), '4T1BF1FK5HU6O3521');
  });
}
