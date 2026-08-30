import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/business_destination_option.dart';
import '../models/business_profile.dart';
import '../models/business_service.dart';
import '../models/destination_country.dart';
import '../utils/callable_data.dart';

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
    Object? callableError;
    try {
      yield await _destinationOptionsFromFunction();
      // The callable answers once, so an open screen would keep showing a
      // service a business has since switched off. publicCatalog/services is
      // bumped by the server on every such change - re-ask on each bump.
      await for (final _
          in _firestore
              .collection('publicCatalog')
              .doc('services')
              .snapshots()
              .skip(1)) {
        yield await _destinationOptionsFromFunction();
      }
      return;
    } on FirebaseException catch (error) {
      // App Check rejects the callable as unauthenticated on an iOS
      // simulator whose debug token is not registered. The Firestore
      // fallbacks below are for local/dev; production customers cannot
      // list businesses, so a failed callable must not become an empty
      // "no freight businesses" catalog.
      callableError = error;
    }

    try {
      final approved = await _destinationOptionsFromApprovedBusinesses();
      if (approved.isNotEmpty) {
        yield approved;
        return;
      }
    } on FirebaseException {
      // Customers cannot list the businesses collection.
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
      if (callableError != null) {
        throw callableError;
      }
      yield* _legacyDestinationOptions();
    }
  }

  Future<List<BusinessDestinationOption>>
  _destinationOptionsFromFunction() async {
    Future<List<BusinessDestinationOption>> once() async {
      final response = await _functions
          .httpsCallable('listActiveBarrelDestinationOptions')
          .call();
      return destinationOptionsFromCallableData(response.data)
        ..sort(_compareDestinationOptions);
    }

    try {
      return await once();
    } on FirebaseFunctionsException catch (error) {
      // App Check often finishes a beat after the first catalog call on a
      // debug iOS build. One retry turns that race into a loaded list.
      if (error.code == 'unauthenticated' || error.code == 'unavailable') {
        await Future<void>.delayed(const Duration(milliseconds: 800));
        return once();
      }
      rethrow;
    }
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
    // A well-reviewed business should generally surface ahead of a cheaper
    // unrated one, but price still matters among similarly-rated options -
    // ignore noise-level rating differences so this doesn't flip-flop ahead
    // of price on every recompute. Mirrors compareDestinationOptions in
    // functions/index.js; keep the two in sync.
    final rating = b.reviewWeightedScore.compareTo(a.reviewWeightedScore);
    if (rating.sign != 0 && (b.reviewWeightedScore - a.reviewWeightedScore).abs() > 0.05) {
      return rating;
    }
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

/// Parses `listActiveBarrelDestinationOptions` the way both Send freight and
/// Send barrel consume it. Kept top-level so tests can feed the live Conakry
/// Express wire shape without standing up Functions.
List<BusinessDestinationOption> destinationOptionsFromCallableData(
  dynamic data,
) {
  final rawOptions = callableMap(data)['options'];
  if (rawOptions is! List) return const <BusinessDestinationOption>[];
  return rawOptions
      .whereType<Map>()
      .map((option) => BusinessDestinationOption.fromFunctionData(callableMap(option)))
      .where((option) => option.isAvailableForAnyShippingService)
      .toList();
}

/// Same eligibility web uses for freight (`shippingOptionIsEligible`).
List<BusinessDestinationOption> freightEligibleOptions(
  Iterable<BusinessDestinationOption> options,
) {
  return [
    for (final option in options)
      if (option.isAvailableFor(BusinessServiceKey.freight)) option,
  ];
}
