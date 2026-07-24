import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/transport_quote.dart';

void main() {
  test('transport quote parses structured marketplace fields', () {
    final quote = TransportQuote.fromMap(
      id: 'request-1__business-1',
      data: {
        'requestId': 'request-1',
        'businessId': 'business-1',
        'businessName': 'Verified Transport',
        'amountCents': 125050,
        'currency': 'usd',
        'status': 'submitted',
        'revision': 2,
        'transportMethod': 'Enclosed carrier',
        'terms': 'Door-to-door service',
        'estimatedPickupDate': Timestamp.fromDate(DateTime(2026, 8, 3)),
        'estimatedDeliveryDate': Timestamp.fromDate(DateTime(2026, 8, 10)),
        'expiresAt': Timestamp.fromDate(
          DateTime.now().add(const Duration(days: 3)),
        ),
      },
    );

    expect(quote.requestId, 'request-1');
    expect(quote.businessId, 'business-1');
    expect(quote.amount, 1250.5);
    expect(quote.isSubmitted, isTrue);
    expect(quote.isExpired, isFalse);
    expect(quote.transportMethod, 'Enclosed carrier');
    expect(quote.estimatedDeliveryDate, DateTime(2026, 8, 10));
  });

  test('withdrawn and expired transport quotes cannot be active choices', () {
    final quote = TransportQuote.fromMap(
      id: 'request-1__business-1',
      data: {
        'requestId': 'request-1',
        'businessId': 'business-1',
        'amountCents': 50000,
        'status': 'withdrawn',
        'expiresAt': Timestamp.fromDate(
          DateTime.now().subtract(const Duration(minutes: 1)),
        ),
      },
    );

    expect(quote.isSubmitted, isFalse);
    expect(quote.isExpired, isTrue);
  });
}
