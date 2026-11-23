/// "Send receipt" on a package, app side (docs/PACKAGE_RECEIPT_SEND.md).
/// Pure: the requests `updateContainerLine` takes for `receipt_link` and
/// `receipt_send`, what the answers and refusals mean, the `sms:` and
/// `mailto:` links for the staff's own phone, and how a `receipt` row in
/// `containerUpdates` reads as a status. The receipt goes to the sender only.
library;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../utils/callable_data.dart';
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// The callable both actions ride (same permission as editing a line).
const receiptCallable = 'updateContainerLine';
const receiptActionLink = 'receipt_link';
const receiptActionSend = 'receipt_send';

/// The business setting's callable and the two modes.
const receiptModeCallable = 'setPackageReceiptMode';
const receiptModeButton = 'button';
const receiptModeAuto = 'auto';

/// WhatsApp's "not a WhatsApp user / message undeliverable".
const whatsAppNotOnWhatsAppCode = 131026;

/// How the server sends a receipt.
enum ReceiptChannel { whatsapp, sms }

/// What the customer reads when staff text or email the link from their own
/// phone. The customer's language is not known, so it is both.
String receiptMessageBody(String link, {String name = ''}) {
  final who = name.trim();
  final en = who.isEmpty
      ? 'Your package receipt'
      : 'Receipt for your package, $who';
  final fr = who.isEmpty ? 'Votre reçu de colis' : 'Reçu de votre colis, $who';
  return '$en / $fr:\n${link.trim()}';
}

/// The email's subject, in both languages.
const receiptEmailSubject = 'Your package receipt / Votre reçu de colis';

/// The digits (and a leading plus) of a phone, as `sms:` wants them.
String receiptDialPhone(String phone) {
  final raw = phone.trim();
  final plus = raw.startsWith('+') ? '+' : '';
  return '$plus${raw.replaceAll(RegExp(r'\D'), '')}';
}

/// `sms:+15551230000?body=...`: spaces as %20 (not "+"), so the Messages app
/// shows the text as written. The query form works on iOS and Android.
Uri receiptSmsUri(String phone, String body) {
  final number = receiptDialPhone(phone);
  return Uri.parse('sms:$number?body=${Uri.encodeComponent(body)}');
}

final _emailPattern = RegExp(r'^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$');

/// Whether [email] looks like one address.
bool receiptEmailValid(String email) => _emailPattern.hasMatch(email.trim());

/// `mailto:name@x.com?subject=...&body=...`, every part percent-encoded.
Uri receiptMailUri(String email, String subject, String body) => Uri.parse(
  'mailto:${Uri.encodeComponent(email.trim()).replaceAll('%40', '@')}'
  '?subject=${Uri.encodeComponent(subject)}'
  '&body=${Uri.encodeComponent(body)}',
);

/// The `receipt_link` request, or null for a line with no id.
Map<String, Object?>? receiptLinkRequest(String businessId, String lineId) =>
    _request(receiptActionLink, businessId, lineId);

/// The `receipt_send` request, or null for a line with no id.
Map<String, Object?>? receiptSendRequest(
  String businessId,
  String lineId,
  ReceiptChannel channel,
) {
  final base = _request(receiptActionSend, businessId, lineId);
  if (base == null) return null;
  return {
    ...base,
    'channel': channel == ReceiptChannel.sms ? 'sms' : 'whatsapp',
  };
}

Map<String, Object?>? _request(String action, String business, String line) {
  final b = business.trim();
  final l = line.trim();
  if (b.isEmpty || l.isEmpty) return null;
  return {'action': action, 'businessId': b, 'lineId': l};
}

/// The sender as the server knows them.
class ReceiptSender {
  const ReceiptSender({this.name = '', this.phone = '', this.email = ''});

  final String name;
  final String phone;
  final String email;
}

/// `receipt_link`'s answer.
class ReceiptLink {
  const ReceiptLink({
    required this.link,
    this.filename = '',
    this.expiresAtMs = 0,
    this.smsReady = false,
    this.sender = const ReceiptSender(),
  });

  final String link;
  final String filename;
  final int expiresAtMs;

  /// Texting from the server really works (Twilio is set up).
  final bool smsReady;
  final ReceiptSender sender;

  bool get usable => link.trim().isNotEmpty;

  /// Still good for a few minutes more.
  bool freshAt(int nowMs) =>
      expiresAtMs <= 0 || expiresAtMs - nowMs > 5 * 60 * 1000;

  static ReceiptLink fromCallable(Object? data) {
    final map = callableMap(data);
    final sender = callableMap(map['sender']);
    return ReceiptLink(
      link: callableString(map['link']).trim(),
      filename: callableString(map['filename']),
      expiresAtMs: callableInt(map['expiresAtMs']),
      smsReady: callableBool(map['smsReady']),
      sender: ReceiptSender(
        name: callableString(sender['name']).trim(),
        phone: callableString(sender['phone']).trim(),
        email: callableString(sender['email']).trim(),
      ),
    );
  }
}

/// Why the server would not send the receipt, from `details.reason`.
enum ReceiptRefusal {
  noSenderPhone,
  smsNotSetUp,
  tooSoon,
  lineGone,
  whatsAppOff,
  other,
}

ReceiptRefusal receiptRefusalOf(String? reason) => switch (reason) {
  'receipt_no_sender_phone' => ReceiptRefusal.noSenderPhone,
  'receipt_sms_not_set_up' => ReceiptRefusal.smsNotSetUp,
  'receipt_too_soon' => ReceiptRefusal.tooSoon,
  'receipt_line_gone' => ReceiptRefusal.lineGone,
  'receipt_whatsapp_off' => ReceiptRefusal.whatsAppOff,
  _ => ReceiptRefusal.other,
};

/// A refusal carried by a failed call, the way the other callables do it.
class ReceiptFailure implements Exception {
  const ReceiptFailure(this.refusal);
  final ReceiptRefusal refusal;
}

/// `receipt_send`'s answer.
class ReceiptSent {
  const ReceiptSent({required this.channel, this.messageId = ''});

  final ReceiptChannel channel;
  final String messageId;

  static ReceiptSent fromCallable(Object? data, ReceiptChannel asked) {
    final map = callableMap(data);
    return ReceiptSent(
      channel: callableString(map['channel']) == 'sms'
          ? ReceiptChannel.sms
          : callableString(map['channel']) == 'whatsapp'
          ? ReceiptChannel.whatsapp
          : asked,
      messageId: callableString(map['messageId']),
    );
  }
}

/// One `containerUpdates` row about a receipt.
class ReceiptRow {
  const ReceiptRow({
    required this.channel,
    required this.status,
    this.delivery = '',
    this.errorCode = 0,
    this.at,
  });

  final ReceiptChannel channel;

  /// queued, sending, retrying, waiting_for_template, sent, failed ...
  final String status;

  /// What WhatsApp reported later: delivered, read or failed.
  final String delivery;
  final int errorCode;
  final DateTime? at;

  /// A receipt row for the sender, else null (other updates, receivers).
  static ReceiptRow? fromMap(Map<String, Object?> d) {
    if (callableString(d['update']) != 'receipt') return null;
    final role = callableString(d['role']);
    if (role.isNotEmpty && role != 'sender') return null;
    DateTime? at;
    for (final key in const ['sentAt', 'updatedAt', 'createdAt']) {
      final v = d[key];
      if (v is Timestamp) {
        at = v.toDate();
      } else if (v is num && v > 0) {
        at = DateTime.fromMillisecondsSinceEpoch(v.round());
      }
      if (at != null) break;
    }
    return ReceiptRow(
      channel: callableString(d['channel']) == 'sms'
          ? ReceiptChannel.sms
          : ReceiptChannel.whatsapp,
      status: callableString(d['status']),
      delivery: callableString(d['deliveryStatus']),
      errorCode: callableInt(d['deliveryErrorCode']),
      at: at,
    );
  }
}

enum ReceiptStatusKind { sent, pending, failed, notOnWhatsApp }

/// The last receipt send, as one sentence's worth of facts.
class ReceiptStatus {
  const ReceiptStatus(this.kind, this.channel, this.at);

  final ReceiptStatusKind kind;
  final ReceiptChannel channel;
  final DateTime? at;

  bool get failed =>
      kind == ReceiptStatusKind.failed ||
      kind == ReceiptStatusKind.notOnWhatsApp;
}

/// The newest receipt row's status, or null when none was ever sent.
ReceiptStatus? lastReceiptStatus(Iterable<ReceiptRow> rows) {
  ReceiptRow? latest;
  for (final row in rows) {
    if (latest == null) {
      latest = row;
      continue;
    }
    final a = row.at, b = latest.at;
    if (a != null && (b == null || a.isAfter(b))) latest = row;
  }
  if (latest == null) return null;
  final row = latest;
  final failed = row.delivery == 'failed' || row.status == 'failed';
  if (failed) {
    final notOn =
        row.channel == ReceiptChannel.whatsapp &&
        (row.errorCode == whatsAppNotOnWhatsAppCode || row.errorCode == 0);
    return ReceiptStatus(
      notOn ? ReceiptStatusKind.notOnWhatsApp : ReceiptStatusKind.failed,
      row.channel,
      row.at,
    );
  }
  const inFlight = {
    'queued',
    'sending',
    'retrying',
    'waiting_for_template',
    'waiting_for_whatsapp',
  };
  if (inFlight.contains(row.status)) {
    return ReceiptStatus(ReceiptStatusKind.pending, row.channel, row.at);
  }
  return ReceiptStatus(ReceiptStatusKind.sent, row.channel, row.at);
}

/// The server side of Send receipt. Behind an interface so the sheet is
/// tested with a fake.
abstract interface class PackageReceiptService {
  Future<ReceiptLink> link(String businessId, String lineId);

  Future<ReceiptSent> send(
    String businessId,
    String lineId,
    ReceiptChannel channel,
  );

  /// This package's receipt rows, newest state; empty when unreadable.
  Stream<List<ReceiptRow>> watchRows(String businessId, String lineId);
}

/// The refusal a failed call carries in `details.reason`; anything that is
/// not a refusal (network, permission) is [ReceiptRefusal.other].
ReceiptRefusal receiptRefusalOfError(Object error) {
  if (error is ReceiptFailure) return error.refusal;
  if (error is FirebaseFunctionsException) {
    final details = error.details;
    return receiptRefusalOf(
      details is Map ? details['reason']?.toString() : null,
    );
  }
  return ReceiptRefusal.other;
}

class FirebasePackageReceiptService implements PackageReceiptService {
  const FirebasePackageReceiptService({this.call = callContainerCallable});

  final ContainerCallableCaller call;

  Future<Object?> _call(Map<String, Object?>? request) async {
    if (request == null) throw const ReceiptFailure(ReceiptRefusal.other);
    try {
      return await call(receiptCallable, request);
    } catch (error) {
      throw ReceiptFailure(receiptRefusalOfError(error));
    }
  }

  @override
  Future<ReceiptLink> link(String businessId, String lineId) async {
    final result = ReceiptLink.fromCallable(
      await _call(receiptLinkRequest(businessId, lineId)),
    );
    if (!result.usable) throw const ReceiptFailure(ReceiptRefusal.other);
    return result;
  }

  @override
  Future<ReceiptSent> send(
    String businessId,
    String lineId,
    ReceiptChannel channel,
  ) async => ReceiptSent.fromCallable(
    await _call(receiptSendRequest(businessId, lineId, channel)),
    channel,
  );

  @override
  Stream<List<ReceiptRow>> watchRows(String businessId, String lineId) {
    try {
      return FirebaseFirestore.instance
          .collection('containerUpdates')
          .where('businessId', isEqualTo: businessId)
          .where('lineId', isEqualTo: lineId)
          .snapshots()
          .map(
            (snap) => [
              for (final doc in snap.docs) ?ReceiptRow.fromMap(doc.data()),
            ],
          )
          .handleError((Object _) {});
    } catch (_) {
      return Stream.value(const []);
    }
  }
}

/// Which way the business sends receipts; anything but "auto" is the button.
String receiptModeOf(Object? value) =>
    value == receiptModeAuto ? receiptModeAuto : receiptModeButton;

/// The business's receipt setting, read and saved. Behind an interface for
/// the settings card's tests.
abstract interface class PackageReceiptModeSource {
  Stream<String> watch(String businessId);

  /// Saves; answers the mode the server kept.
  Future<String> save(String businessId, String sendMode);
}

class FirebasePackageReceiptModeSource implements PackageReceiptModeSource {
  const FirebasePackageReceiptModeSource({this.call = callContainerCallable});

  final ContainerCallableCaller call;

  @override
  Stream<String> watch(String businessId) {
    try {
      return FirebaseFirestore.instance
          .collection('businesses')
          .doc(businessId)
          .snapshots()
          .map((doc) {
            final settings = callableMap(
              (doc.data() ?? const {})['packageReceiptSettings'],
            );
            return receiptModeOf(settings['sendMode']);
          });
    } catch (error) {
      return Stream.error(error);
    }
  }

  @override
  Future<String> save(String businessId, String sendMode) async {
    final data = await call(receiptModeCallable, {
      'businessId': businessId,
      'sendMode': sendMode,
    });
    return receiptModeOf(callableMap(data)['sendMode']);
  }
}
