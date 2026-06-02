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
}
