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
import 'parking_month_statement.dart' show parkingCustomerKeyOf;

/// The refusals `updateBusinessParkingEntry` gives the WhatsApp actions
/// (`details.reason`).
enum ParkingWhatsAppRefusal {
  /// The business's switch is off.
  switchOff,

  /// The welcome is the owner's (or a platform admin's) to send.
  welcomeOwnerOnly,

  /// The switch is the owner's (or a platform admin's) to flip.
  switchOwnerOnly,

  /// Invoices are the owner's (or a platform admin's) to send
  /// (docs/PARKING_INVOICES.md §2).
  invoicesOwnerOnly,

  /// Only the month that just ended may be invoiced.
  invoiceMonthInvalid,

  /// The server refused the payment instructions text.
  paymentInstructionsInvalid,

  /// "Send on WhatsApp": the car's customer is not messageable (a team
  /// member's car, a voided car or an online booking)
  /// (docs/PARKING_LEFT_WHATSAPP.md §2).
  carNotMessageable,

  /// "Send on WhatsApp": the car has no phone number.
  noPhone,

  /// "Send on WhatsApp": the number has no country code.
  needsCountryCode,

  /// "Send on WhatsApp": five manual sends for this car today.
  sendLimit,
}

/// The refusal a callable error carries in `details.reason`, or null for
/// anything else (shown as a generic failure).
ParkingWhatsAppRefusal? parkingWhatsAppRefusal(Object? details) {
  if (details is! Map) return null;
  return switch ('${details['reason'] ?? ''}'.trim()) {
    'parking_whatsapp_off' => ParkingWhatsAppRefusal.switchOff,
    'welcome_owner_only' => ParkingWhatsAppRefusal.welcomeOwnerOnly,
    'parking_whatsapp_owner_only' => ParkingWhatsAppRefusal.switchOwnerOnly,
    'invoices_owner_only' => ParkingWhatsAppRefusal.invoicesOwnerOnly,
    'invoice_month_invalid' => ParkingWhatsAppRefusal.invoiceMonthInvalid,
    'payment_instructions_invalid' =>
      ParkingWhatsAppRefusal.paymentInstructionsInvalid,
    'car_not_messageable' => ParkingWhatsAppRefusal.carNotMessageable,
    'no_phone' => ParkingWhatsAppRefusal.noPhone,
    'needs_country_code' => ParkingWhatsAppRefusal.needsCountryCode,
    'send_limit' => ParkingWhatsAppRefusal.sendLimit,
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

// ---------------------------------------------------------------------------
// Monthly invoices (docs/PARKING_INVOICES.md §2-§3).
// ---------------------------------------------------------------------------

/// The longest payment instructions the server accepts.
const int parkingPaymentInstructionsMaxLength = 300;

int _wireCount(Object? v) => v is num && v.isFinite && v > 0 ? v.toInt() : 0;

/// A time the server wrote as epoch milliseconds (or a Firestore timestamp).
DateTime? _wireTime(Object? v) {
  if (v is DateTime) return v;
  if (v is Timestamp) return v.toDate();
  if (v is num && v.isFinite && v > 0) {
    return DateTime.fromMillisecondsSinceEpoch(v.toInt());
  }
  return null;
}

enum ParkingInvoiceRunStatus { ready, sending, sent }

/// The month's batch (`parkingInvoiceRuns/{businessId}_{yyyy-mm}`): prepared
/// on the 1st, then sent by the owner or automatically on the 3rd.
class ParkingInvoiceRun {
  const ParkingInvoiceRun({
    required this.status,
    this.preparedAt,
    this.sentAt,
    this.sentBy = '',
    this.recipients = 0,
    this.totalDueCents = 0,
    this.sent = 0,
    this.failed = 0,
    this.skipped = 0,
  });

  final ParkingInvoiceRunStatus status;
  final DateTime? preparedAt;
  final DateTime? sentAt;

  /// The sender's uid, or "auto" for the 3rd-of-the-month send.
  final String sentBy;
  final int recipients;
  final int totalDueCents;
  final int sent;
  final int failed;
  final int skipped;

  bool get sentAutomatically => sentBy == 'auto';

  /// Null for anything that is not a run this app can read.
  static ParkingInvoiceRun? fromWire(Object? value) {
    if (value is! Map) return null;
    final status = switch ('${value['status'] ?? ''}'.trim()) {
      'ready' => ParkingInvoiceRunStatus.ready,
      'sending' => ParkingInvoiceRunStatus.sending,
      'sent' => ParkingInvoiceRunStatus.sent,
      _ => null,
    };
    if (status == null) return null;
    return ParkingInvoiceRun(
      status: status,
      preparedAt: _wireTime(value['preparedAtMs'] ?? value['preparedAt']),
      sentAt: _wireTime(value['sentAtMs'] ?? value['sentAt']),
      sentBy: '${value['sentBy'] ?? ''}'.trim(),
      recipients: _wireCount(value['recipients']),
      totalDueCents: _wireCount(value['totalDueCents']),
      sent: _wireCount(value['sent']),
      failed: _wireCount(value['failed']),
      skipped: _wireCount(value['skipped']),
    );
  }
}

/// One customer in the invoice preview.
class ParkingInvoiceRecipient {
  const ParkingInvoiceRecipient({
    required this.phone,
    required this.name,
    required this.cars,
    required this.totalDueCents,
    required this.stillParked,
    required this.alreadySent,
  });

  final String phone;
  final String name;
  final List<ParkingWelcomeCar> cars;
  final int totalDueCents;
  final bool stillParked;

  /// An invoice for this month already went to this number.
  final bool alreadySent;

  String get carsText => cars
      .map((car) => car.label.trim())
      .where((label) => label.isNotEmpty)
      .join(', ');

  static ParkingInvoiceRecipient? fromWire(Object? value) {
    if (value is! Map) return null;
    final phone = '${value['phone'] ?? ''}'.trim();
    if (phone.isEmpty) return null;
    final rawCars = value['cars'];
    return ParkingInvoiceRecipient(
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
      totalDueCents: _wireCount(value['totalDueCents']),
      stillParked: value['stillParked'] == true,
      alreadySent: value['alreadySent'] == true,
    );
  }
}

/// `invoices_preview`: the month, its run (null before one is prepared) and
/// who would get an invoice, in the server's order.
class ParkingInvoicePreview {
  const ParkingInvoicePreview({
    required this.monthKey,
    required this.run,
    required this.recipients,
  });

  final String monthKey;
  final ParkingInvoiceRun? run;
  final List<ParkingInvoiceRecipient> recipients;

  factory ParkingInvoicePreview.fromWire(Object? data) {
    final map = data is Map ? data : const {};
    final raw = map['recipients'];
    return ParkingInvoicePreview(
      monthKey: '${map['monthKey'] ?? ''}'.trim(),
      run: ParkingInvoiceRun.fromWire(map['run']),
      recipients: [
        if (raw is List)
          for (final item in raw) ?ParkingInvoiceRecipient.fromWire(item),
      ],
    );
  }
}

/// What `invoices_send` did. [remaining] is what the server did not get to
/// (it stops at 240 s); send again to continue.
class ParkingInvoiceResult {
  const ParkingInvoiceResult({
    this.sent = 0,
    this.failed = 0,
    this.skipped = 0,
    this.remaining = 0,
  });

  final int sent;
  final int failed;
  final int skipped;
  final int remaining;

  factory ParkingInvoiceResult.fromWire(Object? data) {
    final map = data is Map ? data : const {};
    return ParkingInvoiceResult(
      sent: _wireCount(map['sent']),
      failed: _wireCount(map['failed']),
      skipped: _wireCount(map['skipped']),
      remaining: _wireCount(map['remaining']),
    );
  }
}

/// Whether the "Send invoices" card is offered: the switch is on, the viewer
/// is the owner (or a platform admin) and the month on screen is the month
/// just ended - the only one the server will send.
bool parkingInvoicesOffered({
  required bool switchOn,
  required bool canSend,
  required String monthKey,
  required String currentMonthKey,
}) => switchOn && canSend && monthKey.isNotEmpty && monthKey == currentMonthKey;

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

  /// Saves the text printed on invoices and sent with them (owner or admin).
  Future<void> setPaymentInstructions({
    required String businessId,
    required String text,
  });

  /// Who the month's invoices would go to, and the month's run.
  Future<ParkingInvoicePreview> invoicesPreview({
    required String businessId,
    String? monthKey,
  });

  /// Sends the month's invoices to [phones] (all not-yet-sent when null).
  Future<ParkingInvoiceResult> invoicesSend({
    required String businessId,
    required String monthKey,
    List<String>? phones,
  });

  /// "Send on WhatsApp" for one car, by any staff with the parking
  /// permission (docs/PARKING_LEFT_WHATSAPP.md §2). A failure from Meta is an
  /// answer ([ParkingWhatsAppSendResult.status] failed), not a throw.
  Future<ParkingWhatsAppSendResult> sendOnWhatsApp({
    required String businessId,
    required String carId,
  });

  /// The last WhatsApp message of one car; null when it has none.
  Future<ParkingWhatsAppLastStatus?> lastStatus({
    required String businessId,
    required String carId,
  });
}

class FirebaseParkingWhatsAppService implements ParkingWhatsAppService {
  FirebaseParkingWhatsAppService({FirebaseFunctions? functions})
    : _functionsOverride = functions;

  final FirebaseFunctions? _functionsOverride;

  FirebaseFunctions get _functions =>
      _functionsOverride ?? FirebaseFunctions.instance;

  Future<Object?> _call(
    Map<String, dynamic> payload, {
    Duration? timeout,
  }) async {
    final response = await _functions
        .httpsCallable(
          'updateBusinessParkingEntry',
          options: timeout == null
              ? null
              : HttpsCallableOptions(timeout: timeout),
        )
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

  @override
  Future<void> setPaymentInstructions({
    required String businessId,
    required String text,
  }) async {
    await _call(<String, dynamic>{
      'businessId': businessId,
      'action': 'set_payment_instructions',
      'text': text,
    });
  }

  @override
  Future<ParkingInvoicePreview> invoicesPreview({
    required String businessId,
    String? monthKey,
  }) async => ParkingInvoicePreview.fromWire(
    await _call(<String, dynamic>{
      'businessId': businessId,
      'action': 'invoices_preview',
      if (monthKey != null && monthKey.isNotEmpty) 'monthKey': monthKey,
    }, timeout: const Duration(seconds: 120)),
  );

  @override
  Future<ParkingInvoiceResult> invoicesSend({
    required String businessId,
    required String monthKey,
    List<String>? phones,
  }) async => ParkingInvoiceResult.fromWire(
    await _call(
      <String, dynamic>{
        'businessId': businessId,
        'action': 'invoices_send',
        'monthKey': monthKey,
        'phones': ?phones,
      },
      // The server sends one by one and stops at 240 s.
      timeout: const Duration(seconds: 300),
    ),
  );

  @override
  Future<ParkingWhatsAppSendResult> sendOnWhatsApp({
    required String businessId,
    required String carId,
  }) async => ParkingWhatsAppSendResult.fromWire(
    await _call(<String, dynamic>{
      'businessId': businessId,
      'carId': carId,
      'action': 'send_whatsapp',
    }, timeout: const Duration(seconds: 60)),
  );

  @override
  Future<ParkingWhatsAppLastStatus?> lastStatus({
    required String businessId,
    required String carId,
  }) async => ParkingWhatsAppLastStatus.fromWire(
    await _call(<String, dynamic>{
      'businessId': businessId,
      'carId': carId,
      'action': 'whatsapp_status',
    }),
  );
}

// ---------------------------------------------------------------------------
// The messages on one parked car.
// ---------------------------------------------------------------------------

enum ParkingMessageKind { parked, receipt, welcome, invoice, left }

enum ParkingMessageStatus { queued, sent, failed, stopped, skipped }

/// A message kind as the server writes it; null for one this app does not know.
ParkingMessageKind? parkingMessageKindOf(Object? wire) =>
    switch ('${wire ?? ''}'.trim()) {
      'parked' => ParkingMessageKind.parked,
      'receipt' => ParkingMessageKind.receipt,
      'welcome' => ParkingMessageKind.welcome,
      'invoice' => ParkingMessageKind.invoice,
      'left' => ParkingMessageKind.left,
      _ => null,
    };

/// A message status as the server writes it; null for one this app does not
/// know.
ParkingMessageStatus? parkingMessageStatusOf(Object? wire) =>
    switch ('${wire ?? ''}'.trim()) {
      'queued' => ParkingMessageStatus.queued,
      'sent' => ParkingMessageStatus.sent,
      'failed' => ParkingMessageStatus.failed,
      'stopped' => ParkingMessageStatus.stopped,
      'skipped' => ParkingMessageStatus.skipped,
      _ => null,
    };

/// One `parkingMessages` row, as the car's details list it.
class ParkingMessage {
  const ParkingMessage({
    required this.id,
    required this.kind,
    required this.status,
    this.deliveryStatus = '',
    this.error = '',
    this.phone = '',
    this.monthKey = '',
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

  /// "YYYY-MM" of an invoice; '' for every other kind.
  final String monthKey;

  /// When it went out, else when it was queued.
  final DateTime? at;

  /// Null for a row of a kind or status this app does not know.
  static ParkingMessage? fromMap(String id, Map<String, dynamic> data) {
    final kind = parkingMessageKindOf(data['kind']);
    final status = parkingMessageStatusOf(data['status']);
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
      monthKey: '${data['monthKey'] ?? ''}'.trim(),
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

// ---------------------------------------------------------------------------
// The month's invoices: the run and each customer's invoice message.
// ---------------------------------------------------------------------------

/// Live `parkingInvoiceRuns/{businessId}_{monthKey}`: null until the server
/// prepares the month. Business managers may read it.
Stream<ParkingInvoiceRun?> parkingInvoiceRunStream({
  required String businessId,
  required String monthKey,
  FirebaseFirestore? firestore,
}) => (firestore ?? FirebaseFirestore.instance)
    .collection('parkingInvoiceRuns')
    .doc('${businessId}_$monthKey')
    .snapshots()
    .map((doc) => ParkingInvoiceRun.fromWire(doc.data()));

/// Live invoice rows of one month: `parkingMessages` by equality on the
/// business, the kind and the month (the rules let managers read these).
Stream<List<ParkingMessage>> parkingInvoiceMessagesStream({
  required String businessId,
  required String monthKey,
  FirebaseFirestore? firestore,
}) => (firestore ?? FirebaseFirestore.instance)
    .collection('parkingMessages')
    .where('businessId', isEqualTo: businessId)
    .where('kind', isEqualTo: 'invoice')
    .where('monthKey', isEqualTo: monthKey)
    .snapshots()
    .map(
      (snapshot) => parkingMessagesOf([
        for (final doc in snapshot.docs) (id: doc.id, data: doc.data()),
      ]),
    );

/// The month's invoice rows by customer key (`ParkingMonthCustomer.key`): a
/// row's phone is read the way the month-end statement keys a customer (its
/// last ten digits). When a number has more than one row the newest wins.
Map<String, ParkingMessage> parkingInvoiceStatusByCustomer(
  Iterable<ParkingMessage> rows,
) {
  final newestFirst = [...rows]
    ..sort(
      (a, b) => (b.at?.millisecondsSinceEpoch ?? 0).compareTo(
        a.at?.millisecondsSinceEpoch ?? 0,
      ),
    );
  final byKey = <String, ParkingMessage>{};
  for (final row in newestFirst) {
    if (row.kind != ParkingMessageKind.invoice) continue;
    final key = parkingCustomerKeyOf(row.phone, '');
    if (key.startsWith('phone:')) byKey.putIfAbsent(key, () => row);
  }
  return byKey;
}

// ---------------------------------------------------------------------------
// "Send on WhatsApp" and the car's last message (docs/PARKING_LEFT_WHATSAPP.md
// §2 and §4).
// ---------------------------------------------------------------------------

/// What `send_whatsapp` answered. [status] is null for an answer this app
/// cannot read (shown as a generic failure, never as a success).
class ParkingWhatsAppSendResult {
  const ParkingWhatsAppSendResult({
    required this.kind,
    required this.status,
    this.error = '',
  });

  /// Which message went: the parked one while the car is on the lot, the left
  /// one once it has gone. Null when the server did not say.
  final ParkingMessageKind? kind;
  final ParkingMessageStatus? status;

  /// What Meta said when [status] is failed.
  final String error;

  bool get sent => status == ParkingMessageStatus.sent;

  factory ParkingWhatsAppSendResult.fromWire(Object? data) {
    final map = data is Map ? data : const {};
    return ParkingWhatsAppSendResult(
      kind: parkingMessageKindOf(map['kind']),
      status: parkingMessageStatusOf(map['status']),
      error: '${map['error'] ?? ''}'.trim(),
    );
  }
}

/// `whatsapp_status`: the newest WhatsApp message of one car.
class ParkingWhatsAppLastStatus {
  const ParkingWhatsAppLastStatus({
    required this.kind,
    required this.status,
    this.error = '',
    this.at,
  });

  final ParkingMessageKind? kind;
  final ParkingMessageStatus status;
  final String error;
  final DateTime? at;

  /// Null when the car has no message (an empty answer), or one this app
  /// cannot read.
  static ParkingWhatsAppLastStatus? fromWire(Object? data) {
    if (data is! Map) return null;
    final status = parkingMessageStatusOf(data['status']);
    if (status == null) return null;
    return ParkingWhatsAppLastStatus(
      kind: parkingMessageKindOf(data['kind']),
      status: status,
      error: '${data['error'] ?? ''}'.trim(),
      at: _wireTime(data['atMs'] ?? data['at']),
    );
  }
}

/// What the last-message line says, before it is put into words.
enum ParkingWhatsAppLine {
  /// Nothing has been sent for this car yet.
  none,

  /// Waiting to go out.
  queued,
  sent,

  /// Not delivered: check the number.
  failed,

  /// The customer replied STOP.
  stopped,
}

/// The line for [last] (null: nothing sent). A skipped message did not go and
/// is not worth a line, so it reads as nothing sent.
ParkingWhatsAppLine parkingWhatsAppLineOf(ParkingWhatsAppLastStatus? last) =>
    switch (last?.status) {
      null || ParkingMessageStatus.skipped => ParkingWhatsAppLine.none,
      ParkingMessageStatus.queued => ParkingWhatsAppLine.queued,
      ParkingMessageStatus.sent => ParkingWhatsAppLine.sent,
      ParkingMessageStatus.failed => ParkingWhatsAppLine.failed,
      ParkingMessageStatus.stopped => ParkingWhatsAppLine.stopped,
    };

/// Whether a parked car's details offer "Send on WhatsApp" and the last-message
/// line: the business switch is on, the viewer may act on parking, and the car
/// is the lot's own walk-up that is neither a team member's car nor voided.
bool parkingWhatsAppSendOffered({
  required bool switchOn,
  required bool canSend,
  required bool isBusinessEntry,
  required bool isTeamCar,
  required bool isVoided,
}) => switchOn && canSend && isBusinessEntry && !isTeamCar && !isVoided;

/// Whether a saved edit makes the server resend the car's last message: the
/// phone moved to a number, on a car that is messaged, with the switch on
/// (docs/PARKING_LEFT_WHATSAPP.md §3). [changes] is what the save sent.
bool parkingPhoneEditResends({
  required Map<String, dynamic> changes,
  required bool switchOn,
  required bool isTeamCar,
  required bool isVoided,
}) =>
    switchOn &&
    !isTeamCar &&
    !isVoided &&
    changes.containsKey('customerPhone') &&
    '${changes['customerPhone'] ?? ''}'.trim().isNotEmpty;

/// Whether a contact fix makes the server resend: its answer's `changed`
/// includes the phone, with the switch on, on a messaged car.
bool parkingContactEditResends({
  required Iterable<String> changed,
  required bool switchOn,
  required bool isTeamCar,
  required bool isVoided,
}) =>
    switchOn && !isTeamCar && !isVoided && changed.contains('customerPhone');

/// Live `businesses/{id}.parkingWhatsApp.enabled`. Staff with business access
/// may read the record; a refused or missing read is "off", so nothing is
/// offered that the server would refuse.
Stream<bool> parkingWhatsAppEnabledStream(
  String businessId, {
  FirebaseFirestore? firestore,
}) => (firestore ?? FirebaseFirestore.instance)
    .collection('businesses')
    .doc(businessId)
    .snapshots()
    .map((doc) {
      final value = doc.data()?['parkingWhatsApp'];
      return value is Map && value['enabled'] == true;
    });
