import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/destination_country.dart';

class DestinationCountryService {
  DestinationCountryService({FirebaseFirestore? firestore})
    : _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _firestore;

  Stream<List<DestinationCountry>> activeCountries() async* {
    try {
      await for (final snapshot
          in _firestore
              .collection('destinationCountries')
              .where('isActive', isEqualTo: true)
              .snapshots()) {
        final countries =
            snapshot.docs
                .map(DestinationCountry.fromFirestore)
                .where((country) => country.name.trim().isNotEmpty)
                .toList()
              ..sort((a, b) {
                final order = a.sortOrder.compareTo(b.sortOrder);
                return order != 0 ? order : a.name.compareTo(b.name);
              });
        yield countries;
      }
    } on FirebaseException {
      yield <DestinationCountry>[DestinationCountry.fallback];
    }
  }
}
