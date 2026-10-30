/// Parking customers on WhatsApp, app side (docs/PARKING_WHATSAPP.md §2-§3).
///
/// Everything above [FirebaseParkingWhatsAppService] is pure: the shapes the
/// server answers with, read defensively, so `test/parking_whatsapp_test.dart`
/// drives them without Firebase. The callable stays the authority - it
/// refuses with `details.reason` when the switch is off or the caller is not
/// the owner - and this file only gives those words a name.
library;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../utils/callable_data.dart';

/// The refusals `updateBusinessParkingEntry` gives the WhatsApp actions
/// (`details.reason`).
enum ParkingWhatsAppRefusal {
  /// The business's switch is off.
  switchOff,

  /// The welcome is the owner's (or a platform admin's) to send.
  welcomeOwnerOnly,

  /// The switch is the owner's (or a platform admin's) to flip.
  switchOwnerOnly,
}

/// The refusal a callable error carries in `details.reason`, or null for
/// anything else (shown as a generic failure).
ParkingWhatsAppRefusal? parkingWhatsAppRefusal(Object? details) {
  if (details is! Map) return null;
  return switch ('${details['reason'] ?? ''}'.trim()) {
    'parking_whatsapp_off' => ParkingWhatsAppRefusal.switchOff,
    'welcome_owner_only' => ParkingWhatsAppRefusal.welcomeOwnerOnly,
    'parking_whatsapp_owner_only' => ParkingWhatsAppRefusal.switchOwnerOnly,
    _ => null,
  };
}

/// A refusal read off whatever a failed call threw; null when it is not one.
ParkingWhatsAppRefusal? parkingWhatsAppRefusalOf(Object error) =>
    error is FirebaseFunctionsException
    ? parkingWhatsAppRefusal(error.details)
    : null;

/// One car in a welcome preview.
class ParkingWelcomeCar {
  const ParkingWelcomeCar({
    required this.id,
    required this.label,
    required this.trackingCode,
  });

  final String id;
  final String label;
  final String trackingCode;
}

/// One phone number the welcome would go to, with the cars it covers.
class ParkingWelcomeRecipient {
  const ParkingWelcomeRecipient({
    required this.phone,
    required this.name,
    required this.cars,
    required this.alreadyWelcomed,
  });

  final String phone;
  final String name;
  final List<ParkingWelcomeCar> cars;

  /// This number was already sent a parked or welcome message.
  final bool alreadyWelcomed;

  /// "2014 Toyota Corolla, 2016 RAV4".
  String get carsText => cars
      .map((car) => car.label.trim())
      .where((label) => label.isNotEmpty)
      .join(', ');

  static ParkingWelcomeRecipient? fromWire(Object? value) {
    if (value is! Map) return null;
    final phone = '${value['phone'] ?? ''}'.trim();
    if (phone.isEmpty) return null;
    final rawCars = value['cars'];
    return ParkingWelcomeRecipient(
      phone: phone,
      name: '${value['name'] ?? ''}'.trim(),
      cars: [
        if (rawCars is List)
          for (final car in rawCars)
            if (car is Map)
              ParkingWelcomeCar(
                id: '${car['id'] ?? ''}'.trim(),
                label: '${car['label'] ?? ''}'.trim(),
                trackingCode: '${car['trackingCode'] ?? ''}'.trim(),
              ),
      ],
      alreadyWelcomed: value['alreadyWelcomed'] == true,
    );
  }
}

/// The recipients of a welcome preview, in the order the server gave them.
List<ParkingWelcomeRecipient> parkingWelcomeRecipients(Object? data) {
  final raw = data is Map ? data['recipients'] : null;
  return [
    if (raw is List)
      for (final item in raw) ?ParkingWelcomeRecipient.fromWire(item),
  ];
}

/// What a welcome send did: messages sent, numbers skipped (stopped, already
/// welcomed) and failed.
class ParkingWelcomeResult {
  const ParkingWelcomeResult({
    this.sent = 0,
    this.skipped = 0,
    this.failed = 0,
  });

  final int sent;
  final int skipped;
  final int failed;

  factory ParkingWelcomeResult.fromWire(Object? data) {
    int count(Object? v) => v is num && v.isFinite && v > 0 ? v.toInt() : 0;
    final map = data is Map ? data : const {};
    return ParkingWelcomeResult(
      sent: count(map['sent']),
      skipped: count(map['skipped']),
      failed: count(map['failed']),
    );
  }
}

/// What the app asks the server about parking and WhatsApp. An interface so
/// widget tests answer without Firebase.
abstract interface class ParkingWhatsAppService {
  /// Flips the business's switch (owner or platform admin).
  Future<void> setEnabled({required String businessId, required bool enabled});

  /// Who a one-time welcome would go to.
  Future<List<ParkingWelcomeRecipient>> welcomePreview(String businessId);

  /// Sends the welcome to [phones] (all not-yet-welcomed when null).
  Future<ParkingWelcomeResult> welcomeSend({
    required String businessId,
    List<String>? phones,
  });
}

class FirebaseParkingWhatsAppService implements ParkingWhatsAppService {
  FirebaseParkingWhatsAppService({FirebaseFunctions? functions})
    : _functionsOverride = functions;

  final FirebaseFunctions? _functionsOverride;

  FirebaseFunctions get _functions =>
      _functionsOverride ?? FirebaseFunctions.instance;

  Future<Object?> _call(Map<String, dynamic> payload) async {
    final response = await _functions
        .httpsCallable('updateBusinessParkingEntry')
        .call<Object?>(payload);
    final data = response.data;
    return data is Map ? callableMap(data) : data;
  }

  @override
  Future<void> setEnabled({
    required String businessId,
    required bool enabled,
  }) async {
    await _call(<String, dynamic>{
      'businessId': businessId,
      'action': 'set_parking_whatsapp',
      'enabled': enabled,
    });
  }

  @override
  Future<List<ParkingWelcomeRecipient>> welcomePreview(
    String businessId,
  ) async => parkingWelcomeRecipients(
    await _call(<String, dynamic>{
      'businessId': businessId,
      'action': 'welcome_preview',
    }),
  );

  @override
  Future<ParkingWelcomeResult> welcomeSend({
    required String businessId,
    List<String>? phones,
  }) async => ParkingWelcomeResult.fromWire(
    await _call(<String, dynamic>{
      'businessId': businessId,
      'action': 'welcome_send',
      'phones': ?phones,
    }),
  );
}

// ---------------------------------------------------------------------------
// The messages on one parked car.
// ---------------------------------------------------------------------------

enum ParkingMessageKind { parked, receipt, welcome }

enum ParkingMessageStatus { queued, sent, failed, stopped, skipped }

/// One `parkingMessages` row, as the car's details list it.
class ParkingMessage {
  const ParkingMessage({
    required this.id,
    required this.kind,
    required this.status,
    this.deliveryStatus = '',
    this.error = '',
    this.phone = '',
    this.at,
  });

  final String id;
  final ParkingMessageKind kind;
  final ParkingMessageStatus status;

  /// What WhatsApp later said about a sent message ("delivered", "read",
  /// "failed"), '' when nothing yet.
  final String deliveryStatus;
  final String error;
  final String phone;

  /// When it went out, else when it was queued.
  final DateTime? at;

  /// Null for a row of a kind or status this app does not know.
  static ParkingMessage? fromMap(String id, Map<String, dynamic> data) {
    final kind = switch ('${data['kind'] ?? ''}') {
      'parked' => ParkingMessageKind.parked,
      'receipt' => ParkingMessageKind.receipt,
      'welcome' => ParkingMessageKind.welcome,
      _ => null,
    };
    final status = switch ('${data['status'] ?? ''}') {
      'queued' => ParkingMessageStatus.queued,
      'sent' => ParkingMessageStatus.sent,
      'failed' => ParkingMessageStatus.failed,
      'stopped' => ParkingMessageStatus.stopped,
      'skipped' => ParkingMessageStatus.skipped,
      _ => null,
    };
    if (kind == null || status == null) return null;
    DateTime? at(Object? v) {
      if (v is DateTime) return v;
      if (v is Timestamp) return v.toDate();
      if (v is num && v > 0) {
        return DateTime.fromMillisecondsSinceEpoch(v.toInt());
      }
      return null;
    }

    return ParkingMessage(
      id: id,
      kind: kind,
      status: status,
      deliveryStatus: '${data['deliveryStatus'] ?? ''}'.trim().toLowerCase(),
      error: '${data['error'] ?? ''}'.trim(),
      phone: '${data['phone'] ?? ''}'.trim(),
      at: at(data['sentAt']) ?? at(data['createdAt']),
    );
  }
}

/// The car's messages, newest first; rows this app cannot read are left out.
List<ParkingMessage> parkingMessagesOf(
  Iterable<({String id, Map<String, dynamic> data})> rows,
) {
  final messages = <ParkingMessage>[
    for (final row in rows) ?ParkingMessage.fromMap(row.id, row.data),
  ];
  messages.sort(
    (a, b) => (b.at?.millisecondsSinceEpoch ?? 0).compareTo(
      a.at?.millisecondsSinceEpoch ?? 0,
    ),
  );
  return messages;
}

/// Live `parkingMessages` of one parked car. Both the business and the car
/// are named so the query is provably inside what the rules let a manager
/// read.
Stream<List<ParkingMessage>> parkingMessagesStream({
  required String parkedCarId,
  String businessId = '',
  FirebaseFirestore? firestore,
}) {
  Query<Map<String, dynamic>> query = (firestore ?? FirebaseFirestore.instance)
      .collection('parkingMessages')
      .where('parkedCarId', isEqualTo: parkedCarId);
  if (businessId.trim().isNotEmpty) {
    query = query.where('businessId', isEqualTo: businessId.trim());
  }
  return query.snapshots().map(
    (snapshot) => parkingMessagesOf([
      for (final doc in snapshot.docs) (id: doc.id, data: doc.data()),
    ]),
  );
}
