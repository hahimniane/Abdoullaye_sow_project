import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/transport_request.dart';

void main() {
  test('transport request accepts numeric vehicle years from Firestore', () {
    final request = TransportRequest.fromMap(
      id: 'transport-1',
      data: {
        'trackingCode': 'TR-001',
        'ownerName': 'Customer',
        'carMake': 'Toyota',
        'carModel': 'Camry',
        'carYear': 2022,
        'destinationCountryId': 'gn',
        'destinationCountryName': 'Guinea',
        'status': 'pending',
      },
    );

    expect(request.carYear, '2022');
    expect(request.trackingCode, 'TR-001');
  });
}
