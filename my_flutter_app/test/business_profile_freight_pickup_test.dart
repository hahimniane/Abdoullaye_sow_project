import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/business_profile.dart';

BusinessProfile _profile({String? state, String model = 'distance'}) {
  return BusinessProfile(
    id: 'b1',
    name: 'Test Business',
    state: state,
    freightPickupModel: model,
  );
}

void main() {
  group('BusinessProfile freight pickup', () {
    test('detects New York businesses from the state field', () {
      expect(_profile(state: 'NY').isNewYorkBased, isTrue);
      expect(_profile(state: 'New York').isNewYorkBased, isTrue);
      expect(_profile(state: 'ny').isNewYorkBased, isTrue);
      expect(_profile(state: 'NJ').isNewYorkBased, isFalse);
      expect(_profile(state: null).isNewYorkBased, isFalse);
    });

    test('keeps the borough model only for New York businesses', () {
      expect(
        _profile(state: 'NY', model: 'borough').effectiveFreightPickupModel,
        'borough',
      );
    });

    test('coerces the borough model to distance outside New York', () {
      expect(
        _profile(state: 'NJ', model: 'borough').effectiveFreightPickupModel,
        'distance',
      );
    });

    test('defaults the model to distance', () {
      expect(_profile().effectiveFreightPickupModel, 'distance');
      expect(_profile().freightPickupAvailable, isFalse);
    });
  });
}
