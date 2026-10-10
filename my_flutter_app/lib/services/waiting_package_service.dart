import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import 'waiting_packages.dart';

/// Calls one of the container callables and hands back its data. The waiting
/// package sheets take this as a parameter, so a widget test answers (or
/// refuses) in place of Firebase; the default is the real callable.
typedef ContainerCallableCaller = Future<Object?> Function(
  String name,
  Map<String, Object?> payload,
);

Future<Object?> callContainerCallable(
  String name,
  Map<String, Object?> payload,
) async {
  final response =
      await FirebaseFunctions.instance.httpsCallable(name).call<Object?>(payload);
  return response.data;
}

/// A package's payments, kept current. Behind an interface for the same
/// reason: the payment sheet is tested with a fake.
abstract interface class LinePaymentsSource {
  Stream<List<ContainerLinePayment>> watch(String businessId, String lineId);
}

/// `containerLinePayments` where `businessId == b and lineId == l`. Both
/// equalities: the rule authorises the read by business, so a query that does
/// not name it is refused. No orderBy, so no composite index; the payments are
/// sorted on the phone.
class FirestoreLinePaymentsSource implements LinePaymentsSource {
  FirestoreLinePaymentsSource({FirebaseFirestore? firestore})
      : _override = firestore;

  final FirebaseFirestore? _override;
  FirebaseFirestore get _db => _override ?? FirebaseFirestore.instance;

  @override
  Stream<List<ContainerLinePayment>> watch(String businessId, String lineId) =>
      _db
          .collection('containerLinePayments')
          .where('businessId', isEqualTo: businessId)
          .where('lineId', isEqualTo: lineId)
          .snapshots()
          .map((snap) => sortPaymentsNewestFirst([
                for (final d in snap.docs)
                  ContainerLinePayment.fromMap(d.id, d.data()),
              ]));
}
