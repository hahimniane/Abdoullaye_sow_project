import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/widgets.dart' show Locale;
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/notification_preferences.dart';
import 'package:my_flutter_app/models/support_case.dart';
import 'package:my_flutter_app/models/support_message.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/support_service.dart';
import 'package:my_flutter_app/services/whatsapp_conversations.dart';
import 'package:my_flutter_app/widgets/whatsapp_widgets.dart'
    show packageUpdateTickLabel;

SupportCase _conversation({
  String state = 'needs_reply',
  String status = 'waiting_for_business',
  String customerName = 'Aissatou Diallo',
  String phone = '+224621000001',
  String lastMessage = 'Where is my barrel?',
  String businessName = 'Nensona',
}) {
  return SupportCase.fromMap('wa_biz-1_224621000001', {
    'caseType': 'whatsapp',
    'channel': 'whatsapp',
    'inbox': 'biz-1',
    'businessId': 'biz-1',
    'businessName': businessName,
    'whatsappPhone': phone,
    'customerPhone': phone,
    'customerName': customerName,
    'whatsappState': state,
    'status': status,
    'lastMessage': lastMessage,
    'customerUid': '',
  });
}

SupportMessage _msg(
  Map<String, dynamic> data, {
  String role = 'business',
  String type = 'text',
}) {
  return SupportMessage.fromMap('m1', {
    'senderId': 'u1',
    'senderRole': role,
    'senderName': 'Mamadou Bah',
    'content': 'Hello',
    'messageType': type,
    'metadata': data,
  });
}

ContainerLine _line([Map<String, dynamic> extra = const {}]) =>
    ContainerLine.fromMap('l1', {
      'businessId': 'b1',
      'containerId': 'c1',
      'kind': containerLineKindBarrels,
      'quantity': 1,
      'ownerKind': containerOwnerCustomer,
      'customerName': 'Fatou Diallo',
      'customerPhone': '+19175551234',
      'receiverName': 'Mariama Bah',
      'receiverPhone': '+224621234567',
      'trackingCode': 'CL-K7M4P2',
      ...extra,
    });

void main() {
  group('conversation records', () {
    test('a WhatsApp case reads its own fields', () {
      final c = SupportCase.fromMap('wa_laawol_224621000001', {
        'caseType': 'whatsapp',
        'inbox': 'laawol',
        'businessId': '',
        'whatsappPhone': '+224621000001',
        'whatsappState': 'choosing',
        'whatsappLang': 'fr',
        'updatesStopped': true,
        'unreadCount': 3,
        'handedTo': '',
        'suggestedBusinessId': 'biz-2',
        'suggestedBusinessName': 'Keren',
        'lastCustomerMessageAtMs': 1700000000000,
      });
      expect(c.isWhatsApp, isTrue);
      expect(c.inbox, 'laawol');
      expect(c.whatsappLang, 'fr');
      expect(c.updatesStopped, isTrue);
      expect(c.unreadCount, 3);
      expect(c.suggestedBusinessName, 'Keren');
      expect(c.lastCustomerMessageAtMs, 1700000000000);
      expect(whatsAppStateOf(c), WhatsAppConversationState.choosing);
    });

    test('an app support case is not WhatsApp and has empty fields', () {
      final c = SupportCase.fromMap('case-1', {'caseType': 'barrel_shipment'});
      expect(c.isWhatsApp, isFalse);
      expect(c.whatsappPhone, '');
      expect(c.updatesStopped, isFalse);
      expect(c.unreadCount, 0);
    });

    test('a record without whatsappState falls back on the status', () {
      expect(
        whatsAppStateOf(_conversation(state: '', status: 'resolved')),
        WhatsAppConversationState.done,
      );
      expect(
        whatsAppStateOf(
          _conversation(state: '', status: 'waiting_for_customer'),
        ),
        WhatsAppConversationState.waitingCustomer,
      );
      expect(
        whatsAppStateOf(_conversation(state: '')),
        WhatsAppConversationState.needsReply,
      );
    });
  });

  group('filters and search', () {
    test('each filter shows its state; choosing waits on the customer', () {
      final needs = _conversation();
      final waiting = _conversation(state: 'waiting_customer');
      final choosing = _conversation(state: 'choosing');
      final done = _conversation(state: 'done');
      bool shows(SupportCase c, WhatsAppFilter f) =>
          whatsAppFilterMatches(c, f);

      for (final c in [needs, waiting, choosing, done]) {
        expect(shows(c, WhatsAppFilter.all), isTrue);
      }
      expect(shows(needs, WhatsAppFilter.needsReply), isTrue);
      expect(shows(waiting, WhatsAppFilter.needsReply), isFalse);
      expect(shows(waiting, WhatsAppFilter.waitingCustomer), isTrue);
      expect(shows(choosing, WhatsAppFilter.waitingCustomer), isTrue);
      expect(shows(done, WhatsAppFilter.done), isTrue);
      expect(shows(needs, WhatsAppFilter.done), isFalse);
    });

    test('search finds the name, the message and the number however typed', () {
      final c = _conversation();
      expect(whatsAppSearchMatches(c, ''), isTrue);
      expect(whatsAppSearchMatches(c, 'aissatou'), isTrue);
      expect(whatsAppSearchMatches(c, 'barrel'), isTrue);
      expect(whatsAppSearchMatches(c, '621 000'), isTrue);
      expect(whatsAppSearchMatches(c, 'nensona'), isTrue);
      expect(whatsAppSearchMatches(c, 'keren'), isFalse);
    });
  });

  group('who sees what', () {
    test('staff without Support get only the WhatsApp list', () {
      expect(
        supportInboxLists(
          scope: SupportInboxScope.business,
          canManageSupport: false,
        ),
        [SupportInboxList.whatsApp],
      );
      expect(
        supportInboxLists(
          scope: SupportInboxScope.business,
          canManageSupport: true,
        ),
        [SupportInboxList.support, SupportInboxList.whatsApp],
      );
      expect(
        supportInboxLists(
          scope: SupportInboxScope.admin,
          canManageSupport: false,
        ),
        [SupportInboxList.support, SupportInboxList.whatsApp],
      );
      expect(
        supportInboxLists(
          scope: SupportInboxScope.customer,
          canManageSupport: false,
        ),
        [SupportInboxList.support],
      );
    });

    test('the business Support tab is for everyone linked to a business', () {
      expect(
        showBusinessSupportTab(
          isAdmin: false,
          canManageSupport: false,
          businessId: 'biz-1',
        ),
        isTrue,
      );
      expect(
        showBusinessSupportTab(
          isAdmin: false,
          canManageSupport: false,
          businessId: '',
        ),
        isFalse,
      );
      expect(
        showBusinessSupportTab(
          isAdmin: false,
          canManageSupport: true,
          businessId: '',
        ),
        isTrue,
      );
      // Platform admins have their own Support tab.
      expect(
        showBusinessSupportTab(
          isAdmin: true,
          canManageSupport: true,
          businessId: 'biz-1',
        ),
        isFalse,
      );
    });

    test('WhatsApp messages: owners and admins on, staff off until on', () {
      expect(whatsAppMessagesOn(preference: null, role: 'businessOwner'), true);
      expect(whatsAppMessagesOn(preference: null, role: 'admin'), true);
      expect(whatsAppMessagesOn(preference: null, role: 'staff'), false);
      expect(whatsAppMessagesOn(preference: true, role: 'staff'), true);
      expect(
        whatsAppMessagesOn(preference: false, role: 'businessOwner'),
        false,
      );
    });

    test('the switch shows for business people and support admins', () {
      bool shows(String role, String businessId, bool support) =>
          showWhatsAppMessagesSwitch(
            role: role,
            businessId: businessId,
            canViewPlatformSupport: support,
          );
      expect(shows('businessOwner', 'b1', false), isTrue);
      expect(shows('staff', 'b1', false), isTrue);
      expect(shows('staff', '', false), isFalse);
      expect(shows('customer', 'b1', false), isFalse);
      expect(shows('admin', '', true), isTrue);
      expect(shows('admin', '', false), isFalse);
    });

    test('an unset WhatsApp preference is never written', () {
      final unset = NotificationPreferences.fromMap(const {});
      expect(unset.whatsappMessages, isNull);
      expect(unset.toMap().containsKey('whatsappMessages'), isFalse);
      final on = unset.copyWith(whatsappMessages: true);
      expect(on.toMap()['whatsappMessages'], isTrue);
      expect(
        NotificationPreferences.fromMap(const {
          'whatsappMessages': false,
        }).whatsappMessages,
        isFalse,
      );
    });
  });

  group('messages and ticks', () {
    test('kinds: customer, staff, automatic reply, notes', () {
      expect(
        whatsAppMessageKindOf(
          _msg({
            'whatsapp': {'direction': 'in'},
          }, role: 'customer'),
        ),
        WhatsAppMessageKind.customer,
      );
      expect(
        whatsAppMessageKindOf(_msg({'channel': 'whatsapp'})),
        WhatsAppMessageKind.staff,
      );
      expect(
        whatsAppMessageKindOf(
          _msg({'auto': true}, role: 'system', type: 'system'),
        ),
        WhatsAppMessageKind.auto,
      );
      expect(
        whatsAppMessageKindOf(_msg({'note': true})),
        WhatsAppMessageKind.note,
      );
      expect(
        whatsAppMessageKindOf(
          _msg({'note': true, 'handoff': true}, role: 'system', type: 'system'),
        ),
        WhatsAppMessageKind.systemNote,
      );
    });

    test('the signature the customer saw names the sender', () {
      expect(
        whatsAppSenderName(_msg({'whatsappLabel': 'Mamadou (Nensona)'})),
        'Mamadou (Nensona)',
      );
      expect(whatsAppSenderName(_msg(const {})), 'Mamadou Bah');
    });

    test('ticks follow the status; notes and customers have none', () {
      WhatsAppTick tick(Map<String, dynamic> wa, {String role = 'business'}) =>
          whatsAppTickOf(_msg({'whatsapp': wa}, role: role));
      expect(tick({'status': 'sent'}), WhatsAppTick.sent);
      expect(tick({'status': 'delivered'}), WhatsAppTick.delivered);
      expect(tick({'status': 'read'}), WhatsAppTick.read);
      expect(tick({'status': 'failed', 'error': 'x'}), WhatsAppTick.failed);
      expect(tick({'status': 'waiting_for_reply'}), WhatsAppTick.waiting);
      expect(
        tick({'status': 'waiting_for_reply', 'stopped': true}),
        WhatsAppTick.stopped,
      );
      expect(tick({}), WhatsAppTick.none);
      expect(
        tick({'direction': 'in', 'status': 'read'}, role: 'customer'),
        WhatsAppTick.none,
      );
      expect(
        whatsAppTickOf(
          _msg({
            'note': true,
            'whatsapp': {'status': 'sent'},
          }),
        ),
        WhatsAppTick.none,
      );
      final failed = _msg({
        'whatsapp': {'status': 'failed', 'error': 'Number not on WhatsApp'},
      });
      expect(failed.whatsappError, 'Number not on WhatsApp');
    });

    test('an automatic reply carries its tick', () {
      expect(
        whatsAppTickOf(
          _msg(
            {
              'auto': true,
              'whatsapp': {'direction': 'out', 'status': 'delivered'},
            },
            role: 'system',
            type: 'system',
          ),
        ),
        WhatsAppTick.delivered,
      );
    });

    test('a deleted file says so', () {
      final m = _msg({'mediaDeleted': true}, role: 'customer', type: 'image');
      expect(m.mediaDeleted, isTrue);
      expect(m.isAttachment, isTrue);
    });

    test('delivery results read the callable answer or the bare word', () {
      expect(whatsAppDeliveryOf('sent'), WhatsAppDelivery.sent);
      expect(
        whatsAppDeliveryOf({'delivery': 'waiting'}),
        WhatsAppDelivery.waiting,
      );
      expect(whatsAppDeliveryOf('stopped'), WhatsAppDelivery.stopped);
      expect(whatsAppDeliveryOf('failed'), WhatsAppDelivery.failed);
      expect(whatsAppDeliveryOf(null), WhatsAppDelivery.none);
      expect(whatsAppDeliveryOf('skipped'), WhatsAppDelivery.none);
    });

    test('the reply window is 24 hours from the customer’s last message', () {
      final now = DateTime(2026, 10, 28, 12);
      final ms = now.millisecondsSinceEpoch;
      expect(whatsAppWindowOpen(0, now), isFalse);
      expect(whatsAppWindowOpen(ms - 60 * 1000, now), isTrue);
      expect(
        whatsAppWindowOpen(ms - const Duration(hours: 25).inMilliseconds, now),
        isFalse,
      );
    });
  });

  group('voice notes', () {
    test('recorded as AAC in an .m4a, a type WhatsApp plays', () {
      expect(whatsAppVoiceNoteFormat.mimeType, 'audio/mp4');
      expect(whatsAppVoiceNoteFormat.extension, 'm4a');
      expect(
        whatsAppPlaysAsVoiceNote(whatsAppVoiceNoteFormat.mimeType),
        isTrue,
      );
      expect(
        whatsAppVoiceNoteFormat.fileName(
          DateTime.fromMillisecondsSinceEpoch(42),
        ),
        'voice-note-42.m4a',
      );
    });

    test('playable types mirror the server; webm goes as a document', () {
      for (final type in [
        'audio/ogg; codecs=opus',
        'audio/mpeg',
        'audio/mp4',
        'audio/aac',
        'AUDIO/AMR',
      ]) {
        expect(whatsAppPlaysAsVoiceNote(type), isTrue, reason: type);
      }
      expect(whatsAppPlaysAsVoiceNote('audio/webm'), isFalse);
      expect(whatsAppPlaysAsVoiceNote('audio/wav'), isFalse);
    });

    test('length rules and the clock', () {
      expect(voiceNoteLongEnough(const Duration(milliseconds: 400)), isFalse);
      expect(voiceNoteLongEnough(const Duration(seconds: 2)), isTrue);
      expect(voiceNoteClock(const Duration(seconds: 65)), '1:05');
      expect(voiceNoteClock(Duration.zero), '0:00');
      expect(voiceNoteMaxDuration, const Duration(minutes: 5));
    });
  });

  group('message customer', () {
    test('offers the sender and the receiver', () {
      final targets = messageCustomerTargets(_line());
      expect(targets.map((t) => t.phone), ['+19175551234', '+224621234567']);
      expect(targets.first.isReceiver, isFalse);
      expect(targets.last.isReceiver, isTrue);
      expect(targets.every((t) => t.reachable), isTrue);
    });

    test('a number without its country code cannot be messaged', () {
      final targets = messageCustomerTargets(
        _line({'customerPhone': '9175551234', 'receiverPhone': ''}),
      );
      expect(targets, hasLength(1));
      expect(targets.single.reachable, isFalse);
    });

    test('stock has nobody; the same number is offered once', () {
      expect(
        messageCustomerTargets(_line({'ownerKind': containerOwnerStock})),
        isEmpty,
      );
      final same = messageCustomerTargets(
        _line({'receiverPhone': '+1 917 555 1234'}),
      );
      expect(same, hasLength(1));
    });

    test('with no sender, the receiver is the customer', () {
      final targets = messageCustomerTargets(
        _line({'customerName': '', 'customerPhone': ''}),
      );
      expect(targets, hasLength(1));
      expect(targets.single.phone, '+224621234567');
      expect(targets.single.isReceiver, isTrue);
    });
  });

  group('display name', () {
    test('defaults to the first name; signature mirrors the server', () {
      expect(whatsAppDefaultDisplayName('Mamadou Saliou Bah'), 'Mamadou');
      expect(whatsAppDefaultDisplayName(''), '');
      expect(
        whatsAppSignature(
          displayName: '',
          fullName: 'Mamadou Bah',
          orgName: 'Nensona',
        ),
        '*Mamadou (Nensona):*',
      );
      expect(
        whatsAppSignature(
          displayName: 'Mo',
          fullName: 'Mamadou Bah',
          orgName: 'Laawol',
        ),
        '*Mo (Laawol):*',
      );
      expect(
        whatsAppSignature(displayName: '', fullName: '', orgName: 'Keren'),
        '*Keren:*',
      );
    });
  });

  group('packages', () {
    test('parses the callable answer', () {
      final list = whatsAppPackagesOf({
        'success': true,
        'packages': [
          {
            'id': 'l1',
            'trackingCode': 'CL-1',
            'kind': 'barrels',
            'description': '2 barrels',
            'containerId': 'c1',
            'containerStatus': 'shipped',
            'destination': 'Guinea',
            'role': 'receiver',
          },
          'junk',
        ],
      });
      expect(list, hasLength(1));
      expect(list.single.trackingCode, 'CL-1');
      expect(list.single.customerIsReceiver, isTrue);
      expect(whatsAppPackagesOf(null), isEmpty);
    });
  });

  group('refusals', () {
    test('hand-over refusals are named', () {
      expect(
        whatsAppRefusalOf(
          'permission-denied',
          'That business has no shipment for this customer',
        ),
        WhatsAppRefusal.notThisCustomer,
      );
      expect(
        whatsAppRefusalOf('invalid-argument', 'Pick another inbox'),
        WhatsAppRefusal.pickAnotherInbox,
      );
      expect(
        whatsAppRefusalOf('not-found', 'Business not found'),
        WhatsAppRefusal.businessNotFound,
      );
      expect(
        whatsAppRefusalOf('permission-denied', 'Not your conversation'),
        WhatsAppRefusal.notAllowed,
      );
      expect(
        whatsAppRefusalOf('invalid-argument', 'Phone required'),
        WhatsAppRefusal.phoneRequired,
      );
      expect(whatsAppRefusalOf('unavailable', ''), WhatsAppRefusal.offline);
      expect(whatsAppRefusalOf('internal', ''), WhatsAppRefusal.unknown);
    });
  });

  group('the whatsappConversation callable', () {
    test('sends each action with its payload', () async {
      final calls = <(String, Map<String, Object?>)>[];
      Object? answer = {'success': true};
      final service = WhatsAppConversationService(
        caller: (name, payload) async {
          calls.add((name, payload));
          return answer;
        },
      );

      answer = {'success': true, 'caseId': 'wa_b1_224621234567'};
      expect(
        await service.open(phone: '+224621234567', name: ' Mariama '),
        'wa_b1_224621234567',
      );
      answer = {'success': true};
      await service.markDone('wa_1');
      await service.reopen('wa_1');
      await service.addNote('wa_1', '  call back  ');
      answer = {'success': true, 'caseId': 'wa_laawol_1'};
      expect(
        await service.handOff('wa_1', 'laawol', note: 'billing'),
        'wa_laawol_1',
      );
      answer = {'success': true, 'name': 'Mo'};
      expect(await service.setDisplayName(' Mo '), 'Mo');

      expect(calls.every((c) => c.$1 == 'whatsappConversation'), isTrue);
      expect(calls[0].$2, {
        'action': 'open',
        'phone': '+224621234567',
        'name': 'Mariama',
      });
      expect(calls[1].$2, {'action': 'done', 'caseId': 'wa_1'});
      expect(calls[2].$2, {'action': 'reopen', 'caseId': 'wa_1'});
      expect(calls[3].$2, {
        'action': 'note',
        'caseId': 'wa_1',
        'text': 'call back',
      });
      expect(calls[4].$2, {
        'action': 'handoff',
        'caseId': 'wa_1',
        'to': 'laawol',
        'note': 'billing',
      });
      expect(calls[5].$2, {'action': 'setDisplayName', 'name': 'Mo'});
    });

    test('a refusal arrives as a WhatsAppActionFailure', () async {
      final service = WhatsAppConversationService(
        caller: (name, payload) async {
          // ignore: invalid_use_of_protected_member
          throw FirebaseFunctionsException(
            code: 'permission-denied',
            message: 'That business has no shipment for this customer',
          );
        },
      );
      await expectLater(
        service.handOff('wa_1', 'biz-2'),
        throwsA(
          isA<WhatsAppActionFailure>().having(
            (f) => f.reason,
            'reason',
            WhatsAppRefusal.notThisCustomer,
          ),
        ),
      );
    });

    test('open without a case id is a failure, not an empty thread', () async {
      final service = WhatsAppConversationService(
        caller: (name, payload) async => {'success': true},
      );
      await expectLater(
        service.open(phone: '+224621234567'),
        throwsA(isA<WhatsAppActionFailure>()),
      );
    });
  });

  group('package update ticks', () {
    ContainerLineUpdate update(List<Map<String, Object?>> results) =>
        ContainerLineUpdate.fromMap({
          'update': 'shipped',
          'atMs': 1700000000000,
          'results': results,
        })!;

    test('delivery outranks the send; failures keep their reason', () {
      final ticks = packageUpdateTicks(
        update([
          {'role': 'sender', 'status': 'sent', 'delivery': 'delivered'},
          {'role': 'receiver', 'status': 'sent', 'delivery': 'read'},
        ]),
      );
      expect(ticks.map((t) => t.tick), [
        PackageUpdateTick.delivered,
        PackageUpdateTick.read,
      ]);
      expect(ticks.first.isReceiver, isFalse);
      expect(ticks.last.isReceiver, isTrue);

      final failed = packageUpdateTicks(
        update([
          {
            'role': 'receiver',
            'status': 'failed',
            'delivery': 'failed',
            'reason': 'Message undeliverable',
          },
          {'role': 'sender', 'status': 'sent'},
          {'role': 'sender', 'status': 'skipped', 'reason': 'no_phone'},
          {'role': 'receiver', 'status': 'queued'},
        ]),
      );
      expect(failed, hasLength(2));
      expect(failed.first.tick, PackageUpdateTick.failed);
      expect(failed.first.reason, 'Message undeliverable');
      expect(failed.last.tick, PackageUpdateTick.sent);
      expect(failed.last.reason, '');
      expect(packageUpdateTicks(null), isEmpty);
    });

    test('a failure reported after sending is a failure', () {
      final ticks = packageUpdateTicks(
        update([
          {'role': 'sender', 'status': 'sent', 'delivery': 'failed'},
        ]),
      );
      expect(ticks.single.tick, PackageUpdateTick.failed);
    });

    test('labels in English and French', () {
      final en = lookupAppLocalizations(const Locale('en'));
      final fr = lookupAppLocalizations(const Locale('fr'));
      const delivered = PackageUpdateTickEntry(
        isReceiver: false,
        tick: PackageUpdateTick.delivered,
      );
      const read = PackageUpdateTickEntry(
        isReceiver: true,
        tick: PackageUpdateTick.read,
      );
      const sent = PackageUpdateTickEntry(
        isReceiver: false,
        tick: PackageUpdateTick.sent,
      );
      const failed = PackageUpdateTickEntry(
        isReceiver: true,
        tick: PackageUpdateTick.failed,
        reason: 'Message undeliverable',
      );
      const failedNoReason = PackageUpdateTickEntry(
        isReceiver: true,
        tick: PackageUpdateTick.failed,
      );
      expect(packageUpdateTickLabel(en, delivered), 'Customer ✓✓ Delivered');
      expect(packageUpdateTickLabel(en, read), 'Receiver ✓✓ Read');
      expect(packageUpdateTickLabel(en, sent), 'Customer ✓ Sent');
      expect(
        packageUpdateTickLabel(en, failed),
        'Receiver ⚠ Not delivered: Message undeliverable',
      );
      expect(
        packageUpdateTickLabel(en, failedNoReason),
        'Receiver ⚠ Not delivered',
      );
      expect(packageUpdateTickLabel(fr, delivered), 'Client ✓✓ Distribué');
      expect(packageUpdateTickLabel(fr, read), 'Destinataire ✓✓ Lu');
      expect(
        packageUpdateTickLabel(fr, failed),
        'Destinataire ⚠ Non distribué : Message undeliverable',
      );
    });
  });

  group('hand-over options', () {
    test('parses the server list, Laawol first, no repeats', () {
      final options = whatsAppHandOffOptionsOf({
        'success': true,
        'options': [
          {'businessId': 'laawol', 'businessName': 'Laawol'},
          {'businessId': 'biz-2', 'businessName': 'Keren'},
          {'businessId': 'biz-2', 'businessName': 'Keren again'},
          {'businessId': '', 'businessName': 'nobody'},
          {'businessId': 'biz-3'},
        ],
      });
      expect(options.map((o) => o.id), ['laawol', 'biz-2', 'biz-3']);
      expect(options.first.isLaawol, isTrue);
      expect(options[1].name, 'Keren');
      expect(options.last.name, 'biz-3');
      expect(whatsAppHandOffOptionsOf(null), isEmpty);
    });

    test('asks the callable for this conversation', () async {
      final calls = <Map<String, Object?>>[];
      final service = WhatsAppConversationService(
        caller: (name, payload) async {
          calls.add(payload);
          return {
            'options': [
              {'businessId': 'laawol', 'businessName': 'Laawol'},
            ],
          };
        },
      );
      final options = await service.handOffOptions('wa_1');
      expect(calls.single, {'action': 'handoffOptions', 'caseId': 'wa_1'});
      expect(options.single.isLaawol, isTrue);
    });
  });
}
