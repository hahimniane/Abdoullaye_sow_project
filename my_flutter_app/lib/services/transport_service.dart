import 'package:cloud_functions/cloud_functions.dart';

import '../models/business_destination_option.dart';
import '../models/business_service.dart';

/// Customer-facing car-transport requests. Businesses that enable the
/// `carTransport` service receive these requests and quote a price; the
/// customer never pays at request time.
class TransportService {
  TransportService({FirebaseFunctions? functions})
    : _functions = functions ?? FirebaseFunctions.instance;

  final FirebaseFunctions _functions;

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

  /// Submits a transport request to the chosen business. Returns the new
  /// document id and its tracking code.
  Future<TransportRequestResult> createRequest({
    required String businessId,
    required String destinationCountryId,
    required String destinationCountryName,
    required String ownerName,
    required String carMake,
    required String carModel,
    required String carYear,
    required String customerPhone,
    String vinNumber = '',
    String pickupAddress = '',
    String notes = '',
    DateTime? preferredDate,
  }) async {
    final response = await _functions
        .httpsCallable('createTransportRequest')
        .call<Map<String, dynamic>>({
          'businessId': businessId,
          'destinationCountryId': destinationCountryId,
          'destinationCountryName': destinationCountryName,
          'ownerName': ownerName,
          'carMake': carMake,
          'carModel': carModel,
          'carYear': carYear,
          'customerPhone': customerPhone,
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
}

class TransportRequestResult {
  const TransportRequestResult({required this.id, required this.trackingCode});

  final String id;
  final String trackingCode;
}
