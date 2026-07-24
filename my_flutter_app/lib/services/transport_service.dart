import 'package:cloud_functions/cloud_functions.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/business_destination_option.dart';
import '../models/business_service.dart';
import '../models/transport_quote.dart';

/// Customer-facing car-transport requests. Businesses that enable the
/// `carTransport` service receive these requests and quote a price; the
/// customer never pays at request time.
class TransportService {
  TransportService({FirebaseFunctions? functions, FirebaseFirestore? firestore})
    : _functions = functions ?? FirebaseFunctions.instance,
      _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFunctions _functions;
  final FirebaseFirestore _firestore;

  /// Approved businesses offering car transport, paired with each active
  /// destination they cover.
  Future<List<BusinessDestinationOption>> activeTransportOptions() async {
    final response = await _functions
        .httpsCallable('listTransportBusinessOptions')
        .call<Map<String, dynamic>>();
    final rawOptions = response.data['options'];
    if (rawOptions is! List) return const <BusinessDestinationOption>[];
    return rawOptions
        .whereType<Map>()
        .map(
          (option) => BusinessDestinationOption.fromFunctionData(
            Map<String, dynamic>.from(option),
          ),
        )
        .where(
          (option) => option.isAvailableFor(BusinessServiceKey.carTransport),
        )
        .toList();
  }

  /// Submits one marketplace request to every eligible business serving the
  /// selected destination. The customer chooses a provider after quotes arrive.
  Future<TransportRequestResult> createRequest({
    required String destinationCountryId,
    required String destinationCountryName,
    required String ownerName,
    required String carMake,
    required String carModel,
    required String carYear,
    required String customerPhone,
    required String pickupArea,
    required bool vehicleOperable,
    required String requestedTransportMethod,
    required bool flexibleDates,
    String vinNumber = '',
    String pickupAddress = '',
    String notes = '',
    DateTime? preferredDate,
  }) async {
    final response = await _functions
        .httpsCallable('createTransportRequest')
        .call<Map<String, dynamic>>({
          'destinationCountryId': destinationCountryId,
          'destinationCountryName': destinationCountryName,
          'ownerName': ownerName,
          'carMake': carMake,
          'carModel': carModel,
          'carYear': carYear,
          'customerPhone': customerPhone,
          'pickupArea': pickupArea,
          'vehicleOperable': vehicleOperable,
          'requestedTransportMethod': requestedTransportMethod,
          'flexibleDates': flexibleDates,
          'vinNumber': vinNumber,
          'pickupAddress': pickupAddress,
          'notes': notes,
          if (preferredDate != null)
            'preferredDate': preferredDate.toIso8601String(),
        });
    final data = response.data;
    return TransportRequestResult(
      id: (data['id'] ?? '') as String,
      trackingCode: (data['trackingCode'] ?? '') as String,
    );
  }

  Stream<List<TransportQuote>> watchQuotes(String requestId) {
    return _firestore
        .collection('transportQuotes')
        .where('requestId', isEqualTo: requestId)
        .snapshots()
        .map((snapshot) {
          final quotes = snapshot.docs
              .map(TransportQuote.fromFirestore)
              .where((quote) => quote.status != 'withdrawn')
              .toList();
          quotes.sort((a, b) => a.amountCents.compareTo(b.amountCents));
          return quotes;
        });
  }

  Future<void> selectQuote({
    required String requestId,
    required String quoteId,
  }) async {
    await _functions.httpsCallable('selectTransportQuote').call<void>({
      'requestId': requestId,
      'quoteId': quoteId,
    });
  }

  Future<void> cancelRequest(String requestId) async {
    await _functions.httpsCallable('cancelTransportQuoteRequest').call<void>({
      'requestId': requestId,
    });
  }
}

class TransportRequestResult {
  const TransportRequestResult({required this.id, required this.trackingCode});

  final String id;
  final String trackingCode;
}
