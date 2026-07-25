import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/business_destination_option.dart';
import '../models/business_profile.dart';
import '../models/destination_country.dart';

class BusinessService {
  BusinessService({FirebaseFirestore? firestore, FirebaseFunctions? functions})
    : _firestore = firestore ?? FirebaseFirestore.instance,
      _functions = functions ?? FirebaseFunctions.instance;

  final FirebaseFirestore _firestore;
  final FirebaseFunctions _functions;

  Stream<List<BusinessProfile>> approvedBusinesses() {
    return _firestore
        .collection('businesses')
        .where('status', isEqualTo: 'approved')
        .snapshots()
        .map(
          (snapshot) =>
              snapshot.docs.map(BusinessProfile.fromFirestore).toList()
                ..sort((a, b) => a.name.compareTo(b.name)),
        );
  }

  Stream<List<BusinessDestinationOption>> activeDestinationOptions() async* {
    try {
      yield await _destinationOptionsFromFunction();
      return;
    } on FirebaseException {
      // Fall through to direct Firestore reads for local/dev projects where the
      // callable has not been deployed yet.
    }

    try {
      await for (final snapshot
          in _firestore
              .collectionGroup('destinationCountries')
              .where('isActive', isEqualTo: true)
              .where('businessStatus', isEqualTo: 'approved')
              .snapshots()) {
        var options = await _optionsWithLiveBusinessProfiles(snapshot.docs);
        if (options.isEmpty) {
          options = await _destinationOptionsFromApprovedBusinesses();
        }
        yield options;
      }
    } on FirebaseException {
      yield* _legacyDestinationOptions();
    }
  }

  Future<List<BusinessDestinationOption>>
  _destinationOptionsFromFunction() async {
    final response = await _functions
        .httpsCallable('listActiveBarrelDestinationOptions')
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
        .where((option) => option.isAvailableForAnyShippingService)
        .toList()
      ..sort(_compareDestinationOptions);
  }

  Future<List<BusinessDestinationOption>>
  _destinationOptionsFromApprovedBusinesses() async {
    final businessSnapshot = await _firestore
        .collection('businesses')
        .where('status', isEqualTo: 'approved')
        .get();
    final options = <BusinessDestinationOption>[];

    for (final businessDoc in businessSnapshot.docs) {
      final destinationSnapshot = await businessDoc.reference
          .collection('destinationCountries')
          .where('isActive', isEqualTo: true)
          .get();
      for (final destinationDoc in destinationSnapshot.docs) {
        final option = BusinessDestinationOption.fromFirestoreData(
          destinationDoc,
          destinationDoc.data(),
          businessData: businessDoc.data(),
        );
        if (option.isAvailableForAnyShippingService) {
          options.add(option);
        }
      }
    }

    return options..sort(_compareDestinationOptions);
  }

  Future<List<BusinessDestinationOption>> _optionsWithLiveBusinessProfiles(
    List<QueryDocumentSnapshot<Map<String, dynamic>>> docs,
  ) async {
    final businessIds = <String>{
      for (final doc in docs)
        if (doc.reference.parent.parent != null)
          doc.reference.parent.parent!.id,
    };
    final businessSnapshots = await Future.wait(
      businessIds.map(
        (businessId) =>
            _firestore.collection('businesses').doc(businessId).get(),
      ),
    );
    final businessesById = {
      for (final doc in businessSnapshots)
        if (doc.exists) doc.id: doc.data() ?? <String, dynamic>{},
    };

    final options = <BusinessDestinationOption>[];
    for (final doc in docs) {
      final businessId = doc.reference.parent.parent?.id;
      final businessData = businessId == null
          ? null
          : businessesById[businessId];
      if (businessData == null) continue;
      final option = BusinessDestinationOption.fromFirestoreData(
        doc,
        doc.data(),
        businessData: businessData,
      );
      if (option.isAvailableForAnyShippingService) {
        options.add(option);
      }
    }
    return options..sort(_compareDestinationOptions);
  }

  Stream<List<DestinationCountry>> activeMarketplaceCountries() {
    return activeDestinationOptions().map((options) {
      final byCountry = <String, DestinationCountry>{};
      for (final option in options) {
        final existing = byCountry[option.country.id];
        if (existing == null ||
            (!existing.hasAnyDeliveryEstimate &&
                option.country.hasAnyDeliveryEstimate) ||
            option.country.barrelShippingPrice < existing.barrelShippingPrice) {
          byCountry[option.country.id] = option.country;
        }
      }
      return byCountry.values.toList()..sort((a, b) {
        final order = a.sortOrder.compareTo(b.sortOrder);
        return order != 0 ? order : a.name.compareTo(b.name);
      });
    });
  }

  Stream<List<BusinessDestinationOption>> optionsForCountry(String countryId) {
    return activeDestinationOptions().map(
      (options) =>
          options.where((option) => option.country.id == countryId).toList(),
    );
  }

  Stream<List<BusinessDestinationOption>> _legacyDestinationOptions() {
    return _firestore
        .collection('destinationCountries')
        .where('isActive', isEqualTo: true)
        .snapshots()
        .map(
          (snapshot) =>
              snapshot.docs
                  .map(DestinationCountry.fromFirestore)
                  .where((country) => country.barrelShippingPrice > 0)
                  .map(BusinessDestinationOption.fromLegacyCountry)
                  .toList()
                ..sort(_compareDestinationOptions),
        );
  }

  int _compareDestinationOptions(
    BusinessDestinationOption a,
    BusinessDestinationOption b,
  ) {
    final country = a.country.name.compareTo(b.country.name);
    if (country != 0) return country;
    // Options can offer barrel shipping and/or freight at once, each with
    // its own transit time, so there is no single "the" estimate to sort
    // mixed-service options by; fall back to price and business name.
    final price = a.country.barrelShippingPrice.compareTo(
      b.country.barrelShippingPrice,
    );
    if (price != 0) return price;
    return a.businessName.compareTo(b.businessName);
  }
}
