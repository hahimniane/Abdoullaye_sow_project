import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/freight_quote.dart';

/// Asking businesses what they charge for a parcel none of them has priced.
///
/// The same marketplace shape as `TransportService`: one request fans out to
/// every business serving the route, each answers with its own number, and the
/// customer picks. What freight adds is the payback - a business quoting an
/// item outside its published table has to say here whether it will make good
/// on it, because that is half of what the customer is choosing between.
class FreightQuoteService {
  FreightQuoteService({
    FirebaseFunctions? functions,
    FirebaseFirestore? firestore,
  }) : _functions = functions ?? FirebaseFunctions.instance,
       _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFunctions _functions;
  final FirebaseFirestore _firestore;

  /// Describes the parcel to every business on the route.
  ///
  /// The weight is optional on purpose: a customer who knows it helps the
  /// business answer faster, and one who does not is exactly who this path
  /// exists for.
  Future<FreightQuoteRequestResult> createRequest({
    required String destinationCountryId,
    required String mode,
    required String description,
    double weightKg = 0,
    String itemCategoryId = '',
    String itemLabel = '',
  }) async {
    final response = await _functions
        .httpsCallable('createFreightQuoteRequest')
        .call<Map<String, dynamic>>({
          'destinationCountryId': destinationCountryId,
          'mode': mode,
          'description': description,
          if (weightKg > 0) 'weightKg': weightKg,
          if (itemCategoryId.trim().isNotEmpty)
            'itemCategoryId': itemCategoryId.trim(),
          if (itemLabel.trim().isNotEmpty) 'itemLabel': itemLabel.trim(),
        });
    final data = Map<String, dynamic>.from(response.data);
    return FreightQuoteRequestResult(
      id: (data['id'] ?? '') as String,
      trackingCode: (data['trackingCode'] ?? '') as String,
      eligibleBusinessCount:
          (data['eligibleBusinessCount'] as num?)?.toInt() ?? 0,
    );
  }

  /// A business answering with its price and what it pays back if it loses
  /// the parcel. [businessId] is only needed by staff who manage more than one.
  Future<String> submitQuote({
    required String requestId,
    required int amountCents,
    int paybackAmountCents = 0,
    String businessId = '',
    String terms = '',
  }) async {
    final response = await _functions
        .httpsCallable('submitFreightQuote')
        .call<Map<String, dynamic>>({
          'requestId': requestId,
          'amountCents': amountCents,
          'paybackAmountCents': paybackAmountCents,
          if (businessId.trim().isNotEmpty) 'businessId': businessId.trim(),
          if (terms.trim().isNotEmpty) 'terms': terms.trim(),
        });
    return (Map<String, dynamic>.from(response.data)['quoteId'] ?? '')
        as String;
  }

  /// The customer picking one price.
  Future<void> selectQuote({
    required String requestId,
    required String quoteId,
  }) async {
    await _functions.httpsCallable('selectFreightQuote').call<void>({
      'requestId': requestId,
      'quoteId': quoteId,
    });
  }

  /// Every answer to one request, cheapest first, as they arrive.
  Stream<List<FreightQuote>> watchQuotes(String requestId) {
    return _firestore
        .collection('freightQuotes')
        .where('requestId', isEqualTo: requestId)
        .snapshots()
        .map((snapshot) {
          final quotes = snapshot.docs
              .map(FreightQuote.fromFirestore)
              .toList()
            ..sort((a, b) => a.amountCents.compareTo(b.amountCents));
          return quotes;
        });
  }

  Stream<FreightQuoteRequest?> watchRequest(String requestId) {
    return _firestore
        .collection('freightQuoteRequests')
        .doc(requestId)
        .snapshots()
        .map(
          (doc) => doc.exists ? FreightQuoteRequest.fromFirestore(doc) : null,
        );
  }
}
