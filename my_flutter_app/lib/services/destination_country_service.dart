import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/destination_country.dart';
import 'business_service.dart';

class DestinationCountryService {
  DestinationCountryService({FirebaseFirestore? firestore})
    : _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _firestore;

  Stream<List<DestinationCountry>> activeCountries() async* {
    yield* BusinessService(
      firestore: _firestore,
    ).activeMarketplaceCountries().handleError((_) {
      return <DestinationCountry>[DestinationCountry.fallback];
    });
  }
}
