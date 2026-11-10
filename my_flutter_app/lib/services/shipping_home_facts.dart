import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import 'business_activity_queries.dart';
import 'shipping_home.dart';

/// Reads the two facts the simple shipping home needs for [businessId]. A
/// fake stands in for it in widget tests.
typedef ShippingHomeFactsLoader =
    Future<ShippingHomeFacts> Function(String businessId);

/// How long the home waits for the facts before it falls back to the
/// Containers row. The loading state must always resolve.
const shippingHomeFactsTimeout = Duration(seconds: 10);

/// `businesses/{id}.shipsByAir`, and whether any container of the business is
/// not an air shipment.
///
/// "Not air" cannot be one query (`shipMode != 'air'` skips containers from
/// before ship modes, which carry no `shipMode`), so it is two `count()`
/// aggregates - all containers, and air ones - and any difference is a sea
/// container. Counts read index entries, not documents. Deleted containers
/// are deleted for real, so they never count. A business that does not ship
/// by air is not air-only whatever its containers are, so the counts are
/// skipped for it.
///
/// Throws when a read fails; the home turns that into
/// [ShippingHomeFacts.unknown].
Future<ShippingHomeFacts> loadShippingHomeFacts(
  String businessId, {
  FirebaseFirestore? db,
}) async {
  final firestore = db ?? FirebaseFirestore.instance;
  final id = businessId.trim();
  final business = await firestore.collection('businesses').doc(id).get();
  final shipsByAir = business.data()?['shipsByAir'] == true;
  if (!shipsByAir) {
    return const ShippingHomeFacts(shipsByAir: false, hasSeaContainer: true);
  }
  final counts = await Future.wait([
    containersCountSpec(id).build(firestore).count().get(),
    airContainersCountSpec(id).build(firestore).count().get(),
  ]);
  final all = counts[0].count ?? 0;
  final air = counts[1].count ?? 0;
  return ShippingHomeFacts(shipsByAir: true, hasSeaContainer: all > air);
}
