import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';

import '../models/support_case.dart';
import '../models/support_message.dart';
import '../utils/callable_data.dart';
import 'container_manifest.dart'
    show
        ContainerLine,
        ContainerLineUpdate,
        ContainerLineUpdateResult,
        containerPhone,
        containerUpdateFailed,
        containerUpdateRoleReceiver,
        containerUpdateSent,
        isInternationalPhone,
        lineCustomer;
import 'support_service.dart' show SupportInboxScope;
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

// Two-way WhatsApp in the app (docs/WHATSAPP_CONVERSATIONS.md). A customer's
// WhatsApp conversation is a Support case (`caseType == "whatsapp"`); this
// file holds the rules the screens share - states and filters, who sees
// which list, message kinds and delivery ticks, the voice-note format, the
// numbers a package can be messaged on - and the `whatsappConversation`
// callable. Words live in the screens (lib/widgets/whatsapp_widgets.dart).

/// Where a conversation stands. `choosing`: the customer was asked which
/// business they mean and has not answered yet.
enum WhatsAppConversationState { needsReply, waitingCustomer, done, choosing }

WhatsAppConversationState whatsAppStateOf(SupportCase supportCase) {
  switch (supportCase.whatsappState) {
    case 'needs_reply':
      return WhatsAppConversationState.needsReply;
    case 'waiting_customer':
      return WhatsAppConversationState.waitingCustomer;
    case 'done':
      return WhatsAppConversationState.done;
    case 'choosing':
      return WhatsAppConversationState.choosing;
  }
  // An older record without the field: read the Support status mirror.
  if (supportCase.isResolved) return WhatsAppConversationState.done;
  if (supportCase.status == 'waiting_for_customer') {
    return WhatsAppConversationState.waitingCustomer;
  }
  return WhatsAppConversationState.needsReply;
}

/// The WhatsApp list's filter chips.
enum WhatsAppFilter { all, needsReply, waitingCustomer, done }

/// Whether [supportCase] shows under [filter]. A conversation asking the
/// customer which business they mean waits on the customer.
bool whatsAppFilterMatches(SupportCase supportCase, WhatsAppFilter filter) {
  final state = whatsAppStateOf(supportCase);
  return switch (filter) {
    WhatsAppFilter.all => true,
    WhatsAppFilter.needsReply => state == WhatsAppConversationState.needsReply,
    WhatsAppFilter.waitingCustomer =>
      state == WhatsAppConversationState.waitingCustomer ||
          state == WhatsAppConversationState.choosing,
    WhatsAppFilter.done => state == WhatsAppConversationState.done,
  };
}

/// Whether a conversation matches the WhatsApp list's search: the
/// customer's name, their number (digits match however it was typed), the
/// last message, or the business.
bool whatsAppSearchMatches(SupportCase supportCase, String query) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return true;
  final digits = q.replaceAll(RegExp(r'\D'), '');
  if (digits.length >= 3 &&
      supportCase.whatsappPhone
          .replaceAll(RegExp(r'\D'), '')
          .contains(digits)) {
    return true;
  }
  return [
    supportCase.customerName,
    supportCase.whatsappPhone,
    supportCase.lastMessage,
    supportCase.businessName,
    supportCase.suggestedBusinessName,
  ].any((field) => field.toLowerCase().contains(q));
}

/// The lists the Support inbox offers.
enum SupportInboxList { support, whatsApp }

/// Which lists a person's Support inbox shows, first one opened first.
/// Everyone at a business answers WhatsApp (decision 6), so a staff member
/// without the Support permission still gets the WhatsApp list - and only
/// that one. A platform admin sees the escalated support cases and every
/// WhatsApp conversation.
List<SupportInboxList> supportInboxLists({
  required SupportInboxScope scope,
  required bool canManageSupport,
}) {
  return switch (scope) {
    SupportInboxScope.customer => const [SupportInboxList.support],
    SupportInboxScope.business =>
      canManageSupport
          ? const [SupportInboxList.support, SupportInboxList.whatsApp]
          : const [SupportInboxList.whatsApp],
    SupportInboxScope.admin => const [
      SupportInboxList.support,
      SupportInboxList.whatsApp,
    ],
  };
}

/// Whether the business shell shows the Support tab: to everyone linked to
/// a business (for WhatsApp), and to whoever has the Support permission.
bool showBusinessSupportTab({
  required bool isAdmin,
  required bool canManageSupport,
  required String businessId,
}) {
  if (isAdmin) return false;
  return canManageSupport || businessId.trim().isNotEmpty;
}

/// What a message in a WhatsApp thread is.
enum WhatsAppMessageKind {
  /// The customer wrote it on WhatsApp.
  customer,

  /// Someone at the business (or Laawol) wrote it; it went to WhatsApp.
  staff,

  /// An automatic reply the server sent.
  auto,

  /// A private note: only the team sees it.
  note,

  /// A note the server wrote (handed over, the customer chose a business).
  systemNote,
}

WhatsAppMessageKind whatsAppMessageKindOf(SupportMessage message) {
  if (message.isAutoReply) return WhatsAppMessageKind.auto;
  if (message.isPrivateNote) {
    return message.senderRole == 'system'
        ? WhatsAppMessageKind.systemNote
        : WhatsAppMessageKind.note;
  }
  if (message.senderRole == 'customer' || message.whatsappDirection == 'in') {
    return WhatsAppMessageKind.customer;
  }
  if (message.senderRole == 'system') return WhatsAppMessageKind.systemNote;
  return WhatsAppMessageKind.staff;
}

/// The name on a message: the signature the customer saw on WhatsApp when
/// there is one, else the sender's name.
String whatsAppSenderName(SupportMessage message) {
  final label = message.whatsappLabel;
  return label.isNotEmpty ? label : message.senderName.trim();
}

/// The delivery tick under a message we sent.
enum WhatsAppTick {
  /// Nothing to show: the customer's own message, a note, or not sent yet.
  none,
  sent,
  delivered,
  read,
  failed,

  /// Held: outside WhatsApp's 24-hour window it goes out when the customer
  /// writes.
  waiting,

  /// Held, and the customer has stopped updates, so they were not told.
  stopped,
}

WhatsAppTick whatsAppTickOf(SupportMessage message) {
  final kind = whatsAppMessageKindOf(message);
  if (kind != WhatsAppMessageKind.staff && kind != WhatsAppMessageKind.auto) {
    return WhatsAppTick.none;
  }
  return switch (message.whatsappStatus) {
    'sent' => WhatsAppTick.sent,
    'delivered' => WhatsAppTick.delivered,
    'read' => WhatsAppTick.read,
    'failed' => WhatsAppTick.failed,
    'waiting_for_reply' =>
      message.whatsappStopped ? WhatsAppTick.stopped : WhatsAppTick.waiting,
    _ => WhatsAppTick.none,
  };
}

/// What the server did with a message written in a WhatsApp thread
/// (`delivery` returned by sendSupportMessage / uploadSupportAttachmentMetadata).
enum WhatsAppDelivery {
  sent,

  /// Outside the 24-hour window: held, and the customer was sent the
  /// "you have a message" template.
  waiting,

  /// Held; the customer stopped updates, so nothing told them.
  stopped,
  failed,

  /// Not a WhatsApp thread, or nothing said.
  none,
}

WhatsAppDelivery whatsAppDeliveryOf(Object? value) {
  final raw = value is String ? value : callableMap(value)['delivery'];
  return switch (raw) {
    'sent' => WhatsAppDelivery.sent,
    'waiting' => WhatsAppDelivery.waiting,
    'stopped' => WhatsAppDelivery.stopped,
    'failed' => WhatsAppDelivery.failed,
    _ => WhatsAppDelivery.none,
  };
}

/// WhatsApp's customer-service window: a free-form message reaches the
/// customer only within 24 hours of their last message.
const whatsAppReplyWindow = Duration(hours: 24);

/// Whether what staff send now goes straight out (else it waits for the
/// customer to write; see [WhatsAppTick.waiting]).
bool whatsAppWindowOpen(int lastCustomerMessageAtMs, DateTime now) {
  if (lastCustomerMessageAtMs <= 0) return false;
  final elapsed = now.millisecondsSinceEpoch - lastCustomerMessageAtMs;
  return elapsed < whatsAppReplyWindow.inMilliseconds;
}

/// The format voice notes are recorded in. WhatsApp plays only audio/ogg
/// (opus), audio/mpeg, audio/mp4, audio/aac and audio/amr as a voice note;
/// anything else reaches the customer as a document. AAC in an .m4a
/// (`audio/mp4`) records natively on iOS and Android.
class VoiceNoteFormat {
  const VoiceNoteFormat({required this.extension, required this.mimeType});

  final String extension;
  final String mimeType;

  String fileName(DateTime at) =>
      'voice-note-${at.millisecondsSinceEpoch}.$extension';
}

const whatsAppVoiceNoteFormat = VoiceNoteFormat(
  extension: 'm4a',
  mimeType: 'audio/mp4',
);

/// The audio types WhatsApp plays as a voice note. Mirrors the server's
/// `WA_AUDIO_TYPES`.
const whatsAppAudioTypes = <String>{
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
};

/// Whether a file of [mimeType] reaches the customer as a playable voice
/// note (parameters such as `; codecs=opus` are ignored).
bool whatsAppPlaysAsVoiceNote(String mimeType) =>
    whatsAppAudioTypes.contains(mimeType.split(';').first.trim().toLowerCase());

/// The longest voice note: well inside the 10 MB audio limit at AAC rates.
const voiceNoteMaxDuration = Duration(minutes: 5);

/// A recording shorter than this is a slip of the finger, not a message.
const voiceNoteMinDuration = Duration(seconds: 1);

bool voiceNoteLongEnough(Duration length) => length >= voiceNoteMinDuration;

/// "1:05" for a voice note's length.
String voiceNoteClock(Duration length) {
  final seconds = length.inSeconds < 0 ? 0 : length.inSeconds;
  return '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';
}

/// Someone a package's update goes to, who staff can message on WhatsApp.
class WhatsAppContactTarget {
  const WhatsAppContactTarget({
    required this.name,
    required this.phone,
    required this.isReceiver,
  });

  final String name;

  /// As stored on the line (formatting dropped).
  final String phone;
  final bool isReceiver;

  /// Only a full international number can be messaged: the server would
  /// read a local one as a different country.
  bool get reachable => isInternationalPhone(phone);
}

/// Who on a package can be messaged: its customer and, when someone else
/// collects it, the receiver. Stock has nobody; a missing number is left
/// out; the same number twice is offered once.
List<WhatsAppContactTarget> messageCustomerTargets(ContainerLine line) {
  if (line.isStock) return const [];
  final customer = lineCustomer(line);
  final out = <WhatsAppContactTarget>[];
  final seen = <String>{};
  void add(String name, String phone, bool isReceiver) {
    final stored = containerPhone(phone);
    if (stored.isEmpty) return;
    final digits = stored.replaceAll(RegExp(r'\D'), '');
    if (!seen.add(digits)) return;
    out.add(
      WhatsAppContactTarget(
        name: name.trim(),
        phone: stored,
        isReceiver: isReceiver,
      ),
    );
  }

  add(customer.name, customer.phone, line.customerIsReceiver);
  add(line.receiverName, line.receiverPhone, true);
  return out;
}

/// The name customers see on WhatsApp when the person set none: their
/// first name (the server signs "Mamadou (Nensona)").
String whatsAppDefaultDisplayName(String fullName) {
  final words = fullName.trim().split(RegExp(r'\s+'));
  return words.isEmpty ? '' : words.first;
}

/// The longest display name the server keeps.
const whatsAppDisplayNameMaxLength = 40;

/// How a reply is signed for the customer, in WhatsApp's bold:
/// "*Mamadou (Nensona):*". Mirrors the server's `senderLabel` +
/// `signedText`.
String whatsAppSignature({
  required String displayName,
  required String fullName,
  required String orgName,
}) {
  final trimmed = displayName.trim();
  final person = trimmed.isNotEmpty
      ? (trimmed.length > whatsAppDisplayNameMaxLength
            ? trimmed.substring(0, whatsAppDisplayNameMaxLength)
            : trimmed)
      : whatsAppDefaultDisplayName(fullName);
  final org = orgName.trim();
  final label = person.isEmpty
      ? org
      : (org.isEmpty || person == org ? person : '$person ($org)');
  return label.isEmpty ? '' : '*$label:*';
}

/// Whether the "WhatsApp messages" push is on for this person. Owners (and
/// Laawol's admins) hear about every customer message unless they switched
/// it off; staff only once they switch it on. Mirrors the server's
/// `notifyWhatsAppConversation`.
bool whatsAppMessagesOn({required bool? preference, required String role}) =>
    preference ?? (role == 'businessOwner' || role == 'admin');

/// Who sees the "WhatsApp messages" switch: the people the server may tell
/// about a customer message - everyone at a business, and Laawol admins
/// who answer support.
bool showWhatsAppMessagesSwitch({
  required String role,
  required String businessId,
  required bool canViewPlatformSupport,
}) {
  if (role == 'admin') return canViewPlatformSupport;
  return (role == 'businessOwner' || role == 'staff') &&
      businessId.trim().isNotEmpty;
}

/// One of the customer's packages, for the conversation's header.
class WhatsAppPackage {
  const WhatsAppPackage({
    required this.id,
    required this.trackingCode,
    required this.kind,
    required this.description,
    required this.containerId,
    required this.containerStatus,
    required this.destination,
    required this.role,
  });

  factory WhatsAppPackage.fromMap(Map<String, dynamic> data) => WhatsAppPackage(
    id: callableString(data['id']),
    trackingCode: callableString(data['trackingCode']),
    kind: callableString(data['kind']),
    description: callableString(data['description']),
    containerId: callableString(data['containerId']),
    containerStatus: callableString(data['containerStatus']),
    destination: callableString(data['destination']),
    role: callableString(data['role']),
  );

  final String id;
  final String trackingCode;
  final String kind;
  final String description;
  final String containerId;
  final String containerStatus;
  final String destination;

  /// `sender` | `receiver`: what the customer is on this package.
  final String role;

  bool get customerIsReceiver => role == 'receiver';
}

List<WhatsAppPackage> whatsAppPackagesOf(Object? data) {
  final list = callableMap(data)['packages'];
  if (list is! List) return const [];
  return [
    for (final item in list)
      if (item is Map) WhatsAppPackage.fromMap(callableMap(item)),
  ];
}

/// The inbox a conversation can be handed to besides businesses.
const whatsAppLaawolInbox = 'laawol';

/// Why a `whatsappConversation` call was refused.
enum WhatsAppRefusal {
  /// Hand-over: that business has no shipment for this customer.
  notThisCustomer,

  /// Hand-over: the conversation is already in that inbox.
  pickAnotherInbox,
  businessNotFound,

  /// The person may not act on this conversation.
  notAllowed,

  /// Message customer: the number is not a full international number.
  phoneRequired,
  offline,
  unknown,
}

class WhatsAppActionFailure implements Exception {
  const WhatsAppActionFailure(this.reason, [this.message = '']);

  final WhatsAppRefusal reason;

  /// The server's own words, for a refusal the app has no words for.
  final String message;

  @override
  String toString() => 'WhatsAppActionFailure($reason, $message)';
}

/// Reads a refusal from the callable's error code and message.
WhatsAppRefusal whatsAppRefusalOf(String code, String message) {
  final text = message.toLowerCase();
  if (text.contains('no shipment for this customer')) {
    return WhatsAppRefusal.notThisCustomer;
  }
  if (text.contains('pick another inbox')) {
    return WhatsAppRefusal.pickAnotherInbox;
  }
  if (text.contains('phone required')) return WhatsAppRefusal.phoneRequired;
  return switch (code.toLowerCase()) {
    'not-found' => WhatsAppRefusal.businessNotFound,
    'permission-denied' || 'unauthenticated' => WhatsAppRefusal.notAllowed,
    'unavailable' || 'deadline-exceeded' => WhatsAppRefusal.offline,
    _ => WhatsAppRefusal.unknown,
  };
}

/// The `whatsappConversation` callable: everything staff do to a
/// conversation besides writing in it. Writing goes through Support
/// (`SupportRepository.sendMessage` / attachments), which relays it.
class WhatsAppConversationService {
  const WhatsAppConversationService({this.caller = callContainerCallable});

  final ContainerCallableCaller caller;

  static const callableName = 'whatsappConversation';

  Future<Map<String, dynamic>> _call(Map<String, Object?> payload) async {
    try {
      return callableMap(await caller(callableName, payload));
    } on FirebaseFunctionsException catch (error) {
      final message = error.message ?? '';
      throw WhatsAppActionFailure(
        whatsAppRefusalOf(error.code, message),
        message,
      );
    } on WhatsAppActionFailure {
      rethrow;
    } on TimeoutException {
      throw const WhatsAppActionFailure(WhatsAppRefusal.offline);
    } catch (error) {
      final text = error.toString().toLowerCase();
      final offline =
          text.contains('socket') ||
          text.contains('network') ||
          text.contains('connection');
      throw WhatsAppActionFailure(
        offline ? WhatsAppRefusal.offline : WhatsAppRefusal.unknown,
      );
    }
  }

  /// Opens (or finds) the conversation with [phone] in the caller's
  /// business; returns its case id.
  Future<String> open({
    required String phone,
    String name = '',
    String? businessId,
  }) async {
    final data = await _call({
      'action': 'open',
      'phone': phone,
      if (name.trim().isNotEmpty) 'name': name.trim(),
      if (businessId != null && businessId.isNotEmpty) 'businessId': businessId,
    });
    final caseId = callableString(data['caseId']);
    if (caseId.isEmpty) {
      throw const WhatsAppActionFailure(WhatsAppRefusal.unknown);
    }
    return caseId;
  }

  Future<void> markDone(String caseId) =>
      _call({'action': 'done', 'caseId': caseId});

  Future<void> reopen(String caseId) =>
      _call({'action': 'reopen', 'caseId': caseId});

  /// A private note: never sent to the customer.
  Future<void> addNote(String caseId, String text) =>
      _call({'action': 'note', 'caseId': caseId, 'text': text.trim()});

  /// Hands the conversation to [to] (a business id or [whatsAppLaawolInbox]);
  /// returns the new conversation's case id.
  Future<String> handOff(String caseId, String to, {String note = ''}) async {
    final data = await _call({
      'action': 'handoff',
      'caseId': caseId,
      'to': to,
      if (note.trim().isNotEmpty) 'note': note.trim(),
    });
    return callableString(data['caseId']);
  }

  /// Where [caseId] may be handed: Laawol, and the businesses the server
  /// allows (staff: those that know this customer; Laawol: every one).
  Future<List<WhatsAppHandOffOption>> handOffOptions(String caseId) async =>
      whatsAppHandOffOptionsOf(
        await _call({'action': 'handoffOptions', 'caseId': caseId}),
      );

  Future<List<WhatsAppPackage>> packages(String caseId) async =>
      whatsAppPackagesOf(await _call({'action': 'packages', 'caseId': caseId}));

  /// Sets the caller's "Name customers see on WhatsApp"; returns what the
  /// server kept ('' = back to the first name).
  Future<String> setDisplayName(String name) async {
    final data = await _call({'action': 'setDisplayName', 'name': name.trim()});
    return callableString(data['name']);
  }
}

/// How far a package's last WhatsApp update got, for one person
/// (docs/WHATSAPP_CONVERSATIONS.md decision 15).
enum PackageUpdateTick { sent, delivered, read, failed }

class PackageUpdateTickEntry {
  const PackageUpdateTickEntry({
    required this.isReceiver,
    required this.tick,
    this.reason = '',
  });

  final bool isReceiver;
  final PackageUpdateTick tick;

  /// Why it failed (Meta's words, or the send's), '' otherwise.
  final String reason;
}

/// The ticks of a line's last customer update, one per person it went to:
/// a failure (sending, or reported later by WhatsApp) with its reason, else
/// read / delivered / sent. People it was not sent to (queued, skipped,
/// waiting) have no tick.
List<PackageUpdateTickEntry> packageUpdateTicks(ContainerLineUpdate? last) {
  if (last == null) return const [];
  return [for (final result in last.results) ?packageUpdateTickOf(result)];
}

/// One person's tick on an update, or null when it was not sent to them.
PackageUpdateTickEntry? packageUpdateTickOf(ContainerLineUpdateResult result) {
  final PackageUpdateTick tick;
  if (result.delivery == 'failed' || result.status == containerUpdateFailed) {
    tick = PackageUpdateTick.failed;
  } else if (result.delivery == 'read') {
    tick = PackageUpdateTick.read;
  } else if (result.delivery == 'delivered') {
    tick = PackageUpdateTick.delivered;
  } else if (result.status == containerUpdateSent) {
    tick = PackageUpdateTick.sent;
  } else {
    return null;
  }
  return PackageUpdateTickEntry(
    isReceiver: result.role == containerUpdateRoleReceiver,
    tick: tick,
    reason: tick == PackageUpdateTick.failed ? result.reason : '',
  );
}

/// The marks after the person: ✓ sent, ✓✓ delivered or read, ⚠ failed.
String packageUpdateTickMark(PackageUpdateTick tick) => switch (tick) {
  PackageUpdateTick.sent => '✓',
  PackageUpdateTick.delivered || PackageUpdateTick.read => '✓✓',
  PackageUpdateTick.failed => '⚠',
};

/// Where a conversation can be handed (`handoffOptions`): Laawol first,
/// then businesses; never the inbox it is in.
class WhatsAppHandOffOption {
  const WhatsAppHandOffOption({required this.id, required this.name});

  /// A business id, or [whatsAppLaawolInbox].
  final String id;
  final String name;

  bool get isLaawol => id == whatsAppLaawolInbox;
}

List<WhatsAppHandOffOption> whatsAppHandOffOptionsOf(Object? data) {
  final list = callableMap(data)['options'];
  if (list is! List) return const [];
  final seen = <String>{};
  return [
    for (final item in list)
      if (item is Map)
        if (callableString(callableMap(item)['businessId']) case final id
            when id.isNotEmpty && seen.add(id))
          WhatsAppHandOffOption(
            id: id,
            name: callableString(callableMap(item)['businessName'], id),
          ),
  ];
}
