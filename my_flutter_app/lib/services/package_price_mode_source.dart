/// The business's package price setting, read and saved
/// (docs/PACKAGE_ONE_PRICE.md). Behind an interface for the settings card's
/// tests; the pure rule is `package_price_mode.dart`.
library;

import 'package:cloud_firestore/cloud_firestore.dart';

import '../utils/callable_data.dart';
import 'package_price_mode.dart';
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

abstract interface class PackagePriceModeSource {
  Stream<String> watch(String businessId);

  /// Saves; answers the mode the server kept.
  Future<String> save(String businessId, String mode);
}

class FirebasePackagePriceModeSource implements PackagePriceModeSource {
  const FirebasePackagePriceModeSource({this.call = callContainerCallable});

  final ContainerCallableCaller call;

  @override
  Stream<String> watch(String businessId) {
    try {
      return FirebaseFirestore.instance
          .collection('businesses')
          .doc(businessId)
          .snapshots()
          .map((doc) => packagePriceModeOf(doc.data()));
    } catch (error) {
      return Stream.error(error);
    }
  }

  @override
  Future<String> save(String businessId, String mode) async {
    final data = await call(packagePriceModeCallable, {
      'businessId': businessId,
      'mode': mode,
    });
    final kept = validPackagePriceMode(callableMap(data)['mode']);
    return kept.isEmpty ? mode : kept;
  }
}
