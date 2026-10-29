/// The Deliveries home for the agent at the destination
/// (docs/AIR_PACKAGES.md §1.2, §5 "App"): this business's containers that
/// are ready for pickup - air shipments and sea containers alike - each
/// with the packages still to hand over.
///
/// The rows are precomputed here from two Firestore queries (one per
/// section: containers, lines), never per build; the screen only renders.
/// Pure Dart apart from [FirestoreDeliveriesHomeSource], so the shaping is
/// unit-tested without Firebase.
library;

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import 'container_manifest.dart';
import 'package_requests.dart' show PackageProofSettings;

/// `containers/{id}.shipMode` (docs/AIR_PACKAGES.md §2): "air" is a
/// flight; anything else (or nothing) is sea. Read from the raw document
/// until the model carries it.
bool containerIsAir(Map<String, dynamic> raw) =>
    (raw['shipMode'] ?? '').toString().trim().toLowerCase() == 'air';

/// A container ready for pickup, with what the raw document says about it
/// that the model does not yet.
class ArrivedContainer {
  const ArrivedContainer({required this.container, this.isAir = false});

  final ShippingContainer container;

  /// "Shipment" for air, "Container" for sea.
  final bool isAir;
}

/// A package still to hand over, with whether a pickup code was minted on
/// it (`containerLines/{id}.pickupCode`, read raw: its value is never
/// needed on this screen, and never shown to deliveries-only staff).
class HandoverLine {
  const HandoverLine({required this.line, this.hasPickupCode = false});

  final ContainerLine line;
  final bool hasPickupCode;
}

/// One container's section on the Deliveries home.
class HandoverSection {
  const HandoverSection({required this.arrived, required this.lines});

  final ArrivedContainer arrived;

  /// Undelivered, in the container's order (the newest line last).
  final List<HandoverLine> lines;

  ShippingContainer get container => arrived.container;
  bool get isAir => arrived.isAir;
}

/// The sections to show: every arrived container, in [sortContainers]
/// order, each with its undelivered lines; a container with nothing left
/// to hand over still shows (its "12 of 12 delivered" tells the agent it
/// is done). Lines of a container not in [containers] are left out: they
/// belong to a box that is not ready yet.
List<HandoverSection> handoverSections(
  Iterable<ArrivedContainer> containers,
  Iterable<HandoverLine> lines,
) {
  final byContainer = <String, List<HandoverLine>>{};
  for (final row in lines) {
    if (row.line.isDelivered) continue;
    final id = row.line.containerId;
    if (id.isEmpty) continue;
    (byContainer[id] ??= []).add(row);
  }
  final arrived = [
    for (final c in containers)
      if (c.container.isArrived) c,
  ];
  final order = {
    for (final c in sortContainers([for (final a in arrived) a.container]))
      c.id: c,
  };
  final byId = {for (final a in arrived) a.container.id: a};
  return [
    for (final id in order.keys)
      HandoverSection(
        arrived: byId[id]!,
        lines: _sortLines(byContainer[id] ?? const []),
      ),
  ];
}

List<HandoverLine> _sortLines(List<HandoverLine> rows) {
  final sorted = [...rows];
  sorted.sort((a, b) {
    final ca = a.line.createdAt?.millisecondsSinceEpoch ?? 0;
    final cb = b.line.createdAt?.millisecondsSinceEpoch ?? 0;
    if (ca != cb) return ca.compareTo(cb);
    return a.line.trackingCode.compareTo(b.line.trackingCode);
  });
  return sorted;
}

/// How many packages are still to hand over across [sections].
int handoverCount(Iterable<HandoverSection> sections) =>
    sections.fold(0, (n, s) => n + s.lines.length);

/// Where the Deliveries home reads from; a fake in widget tests.
abstract interface class DeliveriesHomeSource {
  /// The business's containers with status `arrived`.
  Stream<List<ArrivedContainer>> watchArrivedContainers(String businessId);

  /// The business's lines on an arrived container (delivered ones
  /// included; [handoverSections] drops them).
  Stream<List<HandoverLine>> watchArrivedLines(String businessId);

  /// The business's proof switches (`packageProofSettings`); all off when
  /// unreadable.
  Stream<PackageProofSettings> watchProofSettings(String businessId);
}

class FirestoreDeliveriesHomeSource implements DeliveriesHomeSource {
  FirestoreDeliveriesHomeSource({FirebaseFirestore? firestore})
    : _override = firestore;

  final FirebaseFirestore? _override;
  FirebaseFirestore get _db => _override ?? FirebaseFirestore.instance;

  // Equality filters only (`businessId` + status), so no composite index
  // is needed and the `businessId` filter is what the rules allow.
  @override
  Stream<List<ArrivedContainer>> watchArrivedContainers(String businessId) =>
      _db
          .collection('containers')
          .where('businessId', isEqualTo: businessId)
          .where('status', isEqualTo: containerStatusArrived)
          .snapshots()
          .map(
            (snap) => [
              for (final d in snap.docs)
                ArrivedContainer(
                  container: ShippingContainer.fromMap(d.id, d.data()),
                  isAir: containerIsAir(d.data()),
                ),
            ],
          );

  @override
  Stream<List<HandoverLine>> watchArrivedLines(String businessId) => _db
      .collection('containerLines')
      .where('businessId', isEqualTo: businessId)
      .where('containerStatus', isEqualTo: containerStatusArrived)
      .snapshots()
      .map(
        (snap) => [
          for (final d in snap.docs)
            HandoverLine(
              line: ContainerLine.fromMap(d.id, d.data()),
              hasPickupCode: (d.data()['pickupCode'] ?? '')
                  .toString()
                  .trim()
                  .isNotEmpty,
            ),
        ],
      );

  @override
  Stream<PackageProofSettings> watchProofSettings(String businessId) => _db
      .collection('businesses')
      .doc(businessId)
      .snapshots()
      .map((doc) => PackageProofSettings.fromBusiness(doc.data() ?? const {}));
}
