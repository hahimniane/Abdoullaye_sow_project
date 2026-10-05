import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/destination_country.dart';
import '../data/calling_code_catalog.dart';
import 'container_manifest.dart';
import 'package_codes.dart';

/// Reading one package - a container line - and its container, scoped to the
/// business the way the rules require. Behind an interface so the scan
/// screen, the result view and the app-link router can be tested with a
/// fake.
abstract interface class ContainerPackageRepository {
  /// The business's line with [code], or null when none of its lines has it
  /// (a mistyped code, or another business's label).
  Future<ContainerLine?> findLineByCode(String businessId, String code);

  /// The same line, kept current: null while none matches.
  Stream<ContainerLine?> watchLineByCode(String businessId, String code);

  /// One line by id, kept current - for a line found by name or phone that
  /// has no code yet. Null when it is gone.
  Stream<ContainerLine?> watchLine(String lineId);

  Stream<ShippingContainer?> watchContainer(String containerId);

  /// Every line and container of the business, for search.
  Stream<List<ContainerLine>> watchLines(String businessId);
  Stream<List<ShippingContainer>> watchContainers(String businessId);

  /// The business's own country (ISO code) and destination list, which pick
  /// where the phone pickers start. Empty when unreadable.
  Future<String> businessCountryCode(String businessId);
  Future<List<DestinationCountry>> destinations(String businessId);
}

class FirestoreContainerPackageRepository implements ContainerPackageRepository {
  FirestoreContainerPackageRepository({FirebaseFirestore? firestore})
      : _override = firestore;

  final FirebaseFirestore? _override;
  FirebaseFirestore get _db => _override ?? FirebaseFirestore.instance;

  /// Equality on `businessId` and `trackingCode` only - no orderBy - so the
  /// query needs no composite index, and the `businessId` filter is what
  /// lets the rules allow it.
  Query<Map<String, dynamic>> _byCode(String businessId, String code) => _db
      .collection('containerLines')
      .where('businessId', isEqualTo: businessId)
      .where('trackingCode', isEqualTo: code)
      .limit(1);

  @override
  Future<ContainerLine?> findLineByCode(String businessId, String code) async {
    final snap = await _byCode(businessId, code).get();
    if (snap.docs.isEmpty) return null;
    final d = snap.docs.first;
    return ContainerLine.fromMap(d.id, d.data());
  }

  @override
  Stream<ContainerLine?> watchLineByCode(String businessId, String code) =>
      _byCode(businessId, code).snapshots().map((snap) {
        if (snap.docs.isEmpty) return null;
        final d = snap.docs.first;
        return ContainerLine.fromMap(d.id, d.data());
      });

  @override
  Stream<ContainerLine?> watchLine(String lineId) => _db
      .collection('containerLines')
      .doc(lineId)
      .snapshots()
      .map((doc) {
        final data = doc.data();
        return data == null ? null : ContainerLine.fromMap(doc.id, data);
      });

  @override
  Stream<ShippingContainer?> watchContainer(String containerId) => _db
      .collection('containers')
      .doc(containerId)
      .snapshots()
      .map((doc) {
        final data = doc.data();
        return data == null ? null : ShippingContainer.fromMap(doc.id, data);
      });

  @override
  Stream<List<ContainerLine>> watchLines(String businessId) => _db
      .collection('containerLines')
      .where('businessId', isEqualTo: businessId)
      .snapshots()
      .map((snap) => [
            for (final d in snap.docs) ContainerLine.fromMap(d.id, d.data()),
          ]);

  @override
  Stream<List<ShippingContainer>> watchContainers(String businessId) => _db
      .collection('containers')
      .where('businessId', isEqualTo: businessId)
      .snapshots()
      .map((snap) => sortContainers([
            for (final d in snap.docs) ShippingContainer.fromMap(d.id, d.data()),
          ]));

  @override
  Future<String> businessCountryCode(String businessId) async {
    try {
      final doc = await _db.collection('businesses').doc(businessId).get();
      final country = (doc.data()?['country'] ?? '').toString();
      return CallingCodeCatalog.countryCodeForReference(country) ?? '';
    } catch (_) {
      return '';
    }
  }

  @override
  Future<List<DestinationCountry>> destinations(String businessId) async {
    try {
      final snap = await _db
          .collection('businesses')
          .doc(businessId)
          .collection('destinationCountries')
          .get();
      return [for (final d in snap.docs) DestinationCountry.fromFirestore(d)];
    } catch (_) {
      return const [];
    }
  }
}

/// Fetches the printable label page for a container (or one of its lines)
/// and opens it in the browser, where the system print dialog takes over.
/// Throws when the server refuses or nothing could open the page; the
/// caller says so.
typedef ContainerLabelOpener = Future<void> Function({
  required String businessId,
  required String containerId,
  required LabelPrintChoice choice,
  String lineId,
});

Future<void> openContainerLabels({
  required String businessId,
  required String containerId,
  required LabelPrintChoice choice,
  String lineId = '',
}) async {
  final response = await FirebaseFunctions.instance
      .httpsCallable('getContainerDocumentUrl')
      .call<Object?>(containerLabelsRequest(
        businessId: businessId,
        containerId: containerId,
        choice: choice,
        lineId: lineId,
      ));
  final data = response.data;
  final url = data is Map ? (data['url'] ?? '').toString() : '';
  final uri = url.isEmpty ? null : Uri.tryParse(url);
  if (uri == null) throw StateError('no url');
  final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!opened) throw StateError('not opened');
}
