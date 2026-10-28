import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/support_case.dart';
import 'package:my_flutter_app/models/support_message.dart';
import 'package:my_flutter_app/screens/containers_screen.dart'
    show containerLineCardForTesting;
import 'package:my_flutter_app/screens/support_inbox_screen.dart';
import 'package:my_flutter_app/screens/support_thread_screen.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/support_service.dart';
import 'package:my_flutter_app/services/whatsapp_conversations.dart';
import 'package:my_flutter_app/widgets/whatsapp_widgets.dart';

/// Support, as a WhatsApp thread and the inboxes see it. Only what these
/// screens call is answered.
class _FakeSupport implements SupportRepository {
  _FakeSupport({
    this.supportCase,
    this.messages = const [],
    this.cases = const [],
    this.whatsAppCases = const [],
  });

  final SupportCase? supportCase;
  final List<SupportMessage> messages;
  final List<SupportCase> cases;
  final List<SupportCase> whatsAppCases;

  String? delivery;
  String? sentContent;
  String? uploadedMimeType;
  String? uploadedMessageType;
  String? uploadedName;
  int? uploadedDuration;
  final List<String?> whatsAppInboxBusinessIds = [];
  final List<SupportInboxScope> inboxScopes = [];

  @override
  Stream<SupportCase?> watchCase(String caseId) => Stream.value(supportCase);

  @override
  Stream<SupportMessageWindow> watchMessages(
    String caseId,
    String uid, {
    int limit = supportMessagePageSize,
  }) => Stream.value(
    SupportMessageWindow(messages: messages, reachedLimit: false),
  );

  @override
  Stream<List<SupportCase>> watchInbox({
    required SupportInboxScope scope,
    String? businessId,
  }) {
    inboxScopes.add(scope);
    return Stream.value(cases);
  }

  @override
  Stream<List<SupportCase>> watchWhatsAppInbox({String? businessId}) {
    whatsAppInboxBusinessIds.add(businessId);
    return Stream.value(whatsAppCases);
  }

  @override
  Future<void> markRead(String caseId) async {}

  @override
  Future<void> setTyping(String caseId, bool typing) async {}

  @override
  Future<String?> sendMessage({
    required String caseId,
    required String content,
    SupportReplyReference? replyTo,
  }) async {
    sentContent = content;
    return delivery;
  }

  @override
  Future<String?> uploadPickedAttachment({
    required String caseId,
    required XFile file,
    required String mimeType,
    required String messageType,
    int? durationSeconds,
    String caption = '',
  }) async {
    uploadedMimeType = mimeType;
    uploadedMessageType = messageType;
    uploadedName = file.name;
    uploadedDuration = durationSeconds;
    return delivery;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeRecorder implements VoiceNoteRecorder {
  bool permission = true;
  int starts = 0;
  int stops = 0;
  int cancels = 0;

  @override
  Future<bool> hasPermission() async => permission;

  @override
  Future<String> start() async {
    starts += 1;
    return '/tmp/voice-note.m4a';
  }

  @override
  Future<String?> stop() async {
    stops += 1;
    return '/tmp/voice-note.m4a';
  }

  @override
  Future<void> cancel() async => cancels += 1;

  @override
  Future<void> dispose() async {}
}

SupportCase _conversation({
  String state = 'needs_reply',
  bool stopped = true,
  int lastCustomerMessageAtMs = 0,
  String id = 'wa_biz-1_224621000001',
  String name = 'Aissatou Diallo',
}) => SupportCase.fromMap(id, {
  'caseType': 'whatsapp',
  'inbox': 'biz-1',
  'businessId': 'biz-1',
  'businessName': 'Nensona',
  'whatsappPhone': '+224621000001',
  'customerName': name,
  'subject': name,
  'whatsappState': state,
  'status': 'waiting_for_business',
  'updatesStopped': stopped,
  'lastCustomerMessageAtMs': lastCustomerMessageAtMs,
  'lastMessage': 'Where is my barrel?',
  'unreadCount': 2,
  'customerUid': '',
});

SupportMessage _message(
  String id, {
  required String role,
  required String content,
  String senderId = 'someone',
  String type = 'text',
  Map<String, dynamic> metadata = const {},
}) => SupportMessage(
  id: id,
  senderId: senderId,
  senderRole: role,
  senderName: role == 'customer' ? 'Aissatou Diallo' : 'Mamadou Bah',
  content: content,
  messageType: type,
  metadata: metadata,
  createdAt: DateTime(2026, 10, 28, 9, 15),
);

// Newest first, as the thread's query returns them.
final _messages = [
  _message(
    'failed',
    role: 'business',
    senderId: 'staff-1',
    content: 'Your barrel left on Monday.',
    metadata: {
      'channel': 'whatsapp',
      'whatsappLabel': 'Mamadou (Nensona)',
      'whatsapp': {
        'direction': 'out',
        'status': 'failed',
        'error': 'Number not on WhatsApp',
      },
    },
  ),
  _message(
    'note',
    role: 'business',
    senderId: 'staff-2',
    content: 'She called the shop too.',
    metadata: {'channel': 'whatsapp', 'note': true},
  ),
  _message(
    'auto',
    role: 'system',
    type: 'system',
    senderId: 'whatsapp:auto',
    content: 'Thanks, Nensona will answer soon.',
    metadata: {
      'auto': true,
      'channel': 'whatsapp',
      'whatsapp': {'direction': 'out', 'status': 'delivered'},
    },
  ),
  _message(
    'photo',
    role: 'customer',
    type: 'image',
    content: 'image',
    metadata: {
      'mediaDeleted': true,
      'whatsapp': {'direction': 'in'},
    },
  ),
  _message(
    'question',
    role: 'customer',
    content: 'Where is my barrel?',
    metadata: {
      'whatsapp': {'direction': 'in'},
    },
  ),
];

WhatsAppConversationService _service(
  List<Map<String, Object?>> calls, {
  Future<Object?> Function(Map<String, Object?> payload)? answer,
}) => WhatsAppConversationService(
  caller: (name, payload) async {
    calls.add(payload);
    if (answer != null) return answer(payload);
    if (payload['action'] == 'packages') {
      return {
        'packages': [
          {
            'id': 'l1',
            'trackingCode': 'CL-K7M4P2',
            'description': '2 barrels',
            'destination': 'Guinea',
            'role': 'receiver',
          },
        ],
      };
    }
    return {'success': true};
  },
);

Future<void> _pumpThread(
  WidgetTester tester,
  _FakeSupport support, {
  required WhatsAppConversationService service,
  VoiceNoteRecorder? recorder,
  DateTime Function()? clock,
  Locale locale = const Locale('en'),
  bool isAdmin = false,
}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2.5;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: SupportThreadScreen(
        caseId: 'wa_biz-1_224621000001',
        supportRepository: support,
        userIdOverride: 'staff-1',
        isAdminOverride: isAdmin,
        whatsAppService: service,
        voiceRecorder: recorder ?? _FakeRecorder(),
        clock: clock ?? DateTime.now,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'a WhatsApp thread shows automatic replies, private notes, failed ticks '
    'and deleted files',
    (tester) async {
      final calls = <Map<String, Object?>>[];
      await _pumpThread(
        tester,
        _FakeSupport(supportCase: _conversation(), messages: _messages),
        service: _service(calls),
      );

      // Header: badge, state, stopped updates.
      expect(find.text('Aissatou Diallo'), findsWidgets);
      expect(find.text('+224621000001 · Nensona'), findsOneWidget);
      expect(find.byType(WhatsAppBadge), findsOneWidget);
      expect(find.text('Needs reply'), findsOneWidget);
      expect(find.text('Stopped updates'), findsOneWidget);

      // Messages.
      expect(find.text('Automatic reply'), findsOneWidget);
      expect(find.text('Thanks, Nensona will answer soon.'), findsOneWidget);
      expect(find.text('Delivered'), findsOneWidget);
      expect(
        find.text('Private note · Only your team sees this'),
        findsOneWidget,
      );
      expect(find.text('She called the shop too.'), findsOneWidget);
      expect(
        find.text('Not delivered: Number not on WhatsApp'),
        findsOneWidget,
      );
      expect(find.text('File deleted after 12 months'), findsOneWidget);
      // The oldest message is above the fold.
      await tester.dragUntilVisible(
        find.text('Where is my barrel?'),
        find.byType(ListView).first,
        const Offset(0, 200),
      );
      expect(find.text('Where is my barrel?'), findsOneWidget);

      // The customer's packages, asked once, behind one line.
      expect(find.text('Packages · 1'), findsOneWidget);
      await tester.tap(find.byKey(const Key('wa-packages-toggle')));
      await tester.pumpAndSettle();
      expect(
        find.text('CL-K7M4P2 · 2 barrels · Guinea · Receiver'),
        findsOneWidget,
      );
      expect(calls.where((c) => c['action'] == 'packages'), hasLength(1));

      // WhatsApp's tools, not Support's escalation.
      expect(find.byKey(const Key('wa-done')), findsOneWidget);
      expect(find.byKey(const Key('wa-note')), findsOneWidget);
      expect(find.byKey(const Key('wa-handover')), findsOneWidget);
      expect(find.text('Ask Laawol'), findsNothing);
      expect(find.byKey(const Key('wa-voice-record')), findsOneWidget);
      // The customer has not written for over 24 hours.
      expect(find.byKey(const Key('wa-window-closed')), findsOneWidget);
    },
  );

  testWidgets('the WhatsApp thread reads in French', (tester) async {
    await _pumpThread(
      tester,
      _FakeSupport(supportCase: _conversation(), messages: _messages),
      service: _service([]),
      locale: const Locale('fr'),
    );
    expect(find.text('Réponse automatique'), findsOneWidget);
    expect(
      find.text('Note privée · Seule votre équipe la voit'),
      findsOneWidget,
    );
    expect(find.text('Non distribué : Number not on WhatsApp'), findsOneWidget);
    expect(find.text('Mises à jour arrêtées'), findsOneWidget);
    expect(find.text('Fichier supprimé après 12 mois'), findsOneWidget);
  });

  testWidgets('a reply held outside the 24-hour window says so', (
    tester,
  ) async {
    final support = _FakeSupport(
      supportCase: _conversation(
        lastCustomerMessageAtMs: DateTime.now().millisecondsSinceEpoch,
      ),
      messages: _messages,
    )..delivery = 'waiting';
    await _pumpThread(tester, support, service: _service([]));
    expect(find.byKey(const Key('wa-window-closed')), findsNothing);

    await tester.enterText(find.byType(TextField), 'It sails Friday.');
    await tester.tap(find.byIcon(Icons.send));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(support.sentContent, 'It sails Friday.');
    expect(
      find.textContaining('Outside WhatsApp’s 24-hour window'),
      findsOneWidget,
    );
  });

  testWidgets('Mark done shows progress and blocks a second tap', (
    tester,
  ) async {
    final calls = <Map<String, Object?>>[];
    final gate = Completer<Object?>();
    await _pumpThread(
      tester,
      _FakeSupport(supportCase: _conversation(), messages: _messages),
      service: _service(
        calls,
        answer: (payload) async {
          if (payload['action'] == 'done') return await gate.future;
          return {'packages': []};
        },
      ),
    );

    await tester.tap(find.byKey(const Key('wa-done')));
    await tester.pump();
    expect(find.text('Marking done…'), findsOneWidget);
    await tester.tap(find.byKey(const Key('wa-done')), warnIfMissed: false);
    await tester.pump();
    expect(calls.where((c) => c['action'] == 'done'), hasLength(1));

    gate.complete({'success': true});
    await tester.pumpAndSettle();
    expect(find.text('Mark done'), findsOneWidget);
    expect(
      calls.where((c) => c['action'] == 'done').single['caseId'],
      'wa_biz-1_224621000001',
    );
  });

  testWidgets('a private note goes through the callable, never the chat', (
    tester,
  ) async {
    final calls = <Map<String, Object?>>[];
    final support = _FakeSupport(
      supportCase: _conversation(),
      messages: _messages,
    );
    await _pumpThread(tester, support, service: _service(calls));

    await tester.tap(find.byKey(const Key('wa-note')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('wa-note-field')),
      'Promised a call back',
    );
    await tester.tap(find.byKey(const Key('wa-note-save')));
    await tester.pumpAndSettle();

    expect(calls.last, {
      'action': 'note',
      'caseId': 'wa_biz-1_224621000001',
      'text': 'Promised a call back',
    });
    expect(support.sentContent, isNull);
    expect(find.text('Note saved.'), findsOneWidget);
  });

  testWidgets('hand-over lists the server’s options and shows its refusal', (
    tester,
  ) async {
    final calls = <Map<String, Object?>>[];
    final options = Completer<Object?>();
    await _pumpThread(
      tester,
      _FakeSupport(supportCase: _conversation(), messages: _messages),
      service: _service(
        calls,
        answer: (payload) async {
          if (payload['action'] == 'handoffOptions') {
            return await options.future;
          }
          if (payload['action'] == 'handoff') {
            // ignore: invalid_use_of_protected_member
            throw FirebaseFunctionsException(
              code: 'permission-denied',
              message: 'That business has no shipment for this customer',
            );
          }
          return {'packages': []};
        },
      ),
    );

    await tester.tap(find.byKey(const Key('wa-handover')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byKey(const Key('wa-handover-loading')), findsOneWidget);
    expect(calls.last, {
      'action': 'handoffOptions',
      'caseId': 'wa_biz-1_224621000001',
    });

    options.complete({
      'options': [
        {'businessId': 'laawol', 'businessName': 'Laawol'},
        {'businessId': 'biz-2', 'businessName': 'Keren'},
      ],
    });
    await tester.pumpAndSettle();
    expect(find.text('Laawol support'), findsOneWidget);
    expect(find.text('Keren'), findsOneWidget);

    await tester.tap(find.text('Keren'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('wa-handover-submit')));
    await tester.pumpAndSettle();

    expect(calls.last['action'], 'handoff');
    expect(calls.last['to'], 'biz-2');
    expect(
      find.text('That business has no shipment for this customer.'),
      findsOneWidget,
    );
  });

  testWidgets('hand-over options that fail to load offer Retry', (
    tester,
  ) async {
    var fail = true;
    await _pumpThread(
      tester,
      _FakeSupport(supportCase: _conversation(), messages: _messages),
      service: _service(
        [],
        answer: (payload) async {
          if (payload['action'] == 'handoffOptions') {
            if (fail) {
              // ignore: invalid_use_of_protected_member
              throw FirebaseFunctionsException(
                code: 'permission-denied',
                message: 'Not your conversation',
              );
            }
            return {
              'options': [
                {'businessId': 'laawol', 'businessName': 'Laawol'},
              ],
            };
          }
          return {'packages': []};
        },
      ),
    );
    await tester.tap(find.byKey(const Key('wa-handover')));
    await tester.pumpAndSettle();
    expect(
      find.text('You can’t do this on this conversation.'),
      findsOneWidget,
    );
    fail = false;
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('Laawol support'), findsOneWidget);
    // Only Laawol: staff are told Laawol can pass it on.
    expect(find.textContaining('Laawol can pass it on'), findsOneWidget);
  });

  testWidgets('a voice note records as m4a and is sent as a voice message', (
    tester,
  ) async {
    var now = DateTime(2026, 10, 28, 10);
    final recorder = _FakeRecorder();
    final support = _FakeSupport(
      supportCase: _conversation(
        lastCustomerMessageAtMs: DateTime.now().millisecondsSinceEpoch,
      ),
      messages: _messages,
    )..delivery = 'sent';
    await _pumpThread(
      tester,
      support,
      service: _service([]),
      recorder: recorder,
      clock: () => now,
    );

    await tester.tap(find.byKey(const Key('wa-voice-record')));
    await tester.pump();
    expect(recorder.starts, 1);
    expect(find.byKey(const Key('wa-recording-bar')), findsOneWidget);

    now = now.add(const Duration(seconds: 7));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Recording 0:07'), findsOneWidget);

    await tester.tap(find.byKey(const Key('wa-voice-send')));
    await tester.pumpAndSettle();

    expect(recorder.stops, 1);
    expect(support.uploadedMessageType, 'voice');
    expect(support.uploadedMimeType, 'audio/mp4');
    expect(support.uploadedName, endsWith('.m4a'));
    expect(support.uploadedDuration, 7);
    expect(find.byKey(const Key('wa-recording-bar')), findsNothing);
  });

  testWidgets('a voice note can be thrown away; a refused mic says why', (
    tester,
  ) async {
    final recorder = _FakeRecorder();
    final support = _FakeSupport(
      supportCase: _conversation(),
      messages: _messages,
    );
    await _pumpThread(
      tester,
      support,
      service: _service([]),
      recorder: recorder,
    );

    await tester.tap(find.byKey(const Key('wa-voice-record')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('wa-voice-discard')));
    await tester.pumpAndSettle();
    expect(recorder.cancels, 1);
    expect(support.uploadedMessageType, isNull);

    recorder.permission = false;
    await tester.tap(find.byKey(const Key('wa-voice-record')));
    await tester.pumpAndSettle();
    expect(
      find.text('Allow the microphone in Settings to record voice notes.'),
      findsOneWidget,
    );
    expect(recorder.starts, 1);
  });

  group('inbox', () {
    Future<void> pumpInbox(
      WidgetTester tester,
      _FakeSupport support, {
      required SupportInboxScope scope,
      bool canManageSupport = true,
    }) async {
      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          routes: {
            '/support-thread': (context) => Scaffold(
              body: Text(
                'Thread ${ModalRoute.of(context)!.settings.arguments}',
              ),
            ),
          },
          home: SupportInboxScreen(
            scope: scope,
            supportRepository: support,
            businessIdOverride: scope == SupportInboxScope.business
                ? 'biz-1'
                : null,
            canManageSupportOverride: canManageSupport,
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    final whatsAppCases = [
      _conversation(),
      _conversation(
        id: 'wa_biz-1_224622000002',
        name: 'Ibrahima Sow',
        state: 'done',
        stopped: false,
      ),
    ];

    testWidgets('staff without Support see only WhatsApp conversations', (
      tester,
    ) async {
      final support = _FakeSupport(whatsAppCases: whatsAppCases);
      await pumpInbox(
        tester,
        support,
        scope: SupportInboxScope.business,
        canManageSupport: false,
      );

      expect(find.byKey(const Key('support-inbox-lists')), findsNothing);
      // The Support query (which their rules refuse) is never run.
      expect(support.inboxScopes, isEmpty);
      expect(support.whatsAppInboxBusinessIds, ['biz-1']);
      expect(find.text('Aissatou Diallo'), findsOneWidget);
      expect(find.text('Ibrahima Sow'), findsOneWidget);
      expect(find.text('Stopped updates'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('wa-filter:done')));
      await tester.pumpAndSettle();
      expect(find.text('Aissatou Diallo'), findsNothing);
      expect(find.text('Ibrahima Sow'), findsOneWidget);

      await tester.tap(find.text('Ibrahima Sow'));
      await tester.pumpAndSettle();
      expect(find.text('Thread wa_biz-1_224622000002'), findsOneWidget);
    });

    testWidgets('Laawol sees escalated cases and every WhatsApp thread', (
      tester,
    ) async {
      final support = _FakeSupport(
        // A Laawol-inbox conversation is also "escalated": it belongs to
        // the WhatsApp list, not the support cases.
        cases: [whatsAppCases.first],
        whatsAppCases: whatsAppCases,
      );
      await pumpInbox(tester, support, scope: SupportInboxScope.admin);

      expect(find.byKey(const Key('support-inbox-lists')), findsOneWidget);
      expect(find.text('Aissatou Diallo'), findsNothing);
      expect(find.text('No support cases yet'), findsOneWidget);

      await tester.tap(find.text('WhatsApp').first);
      await tester.pumpAndSettle();
      expect(support.whatsAppInboxBusinessIds, [null]);
      expect(find.text('Aissatou Diallo'), findsOneWidget);
      expect(find.text('Ibrahima Sow'), findsOneWidget);
    });
  });

  testWidgets('a container line shows how far its last update got', (
    tester,
  ) async {
    final line = ContainerLine.fromMap('l1', {
      'businessId': 'b1',
      'containerId': 'c1',
      'kind': containerLineKindBarrels,
      'quantity': 1,
      'ownerKind': containerOwnerCustomer,
      'customerName': 'Fatou Diallo',
      'customerPhone': '+19175551234',
      'receiverName': 'Mariama Bah',
      'receiverPhone': '+224621234567',
      'lastCustomerUpdate': {
        'update': 'shipped',
        'atMs': 1700000000000,
        'results': [
          {'role': 'sender', 'status': 'sent', 'delivery': 'delivered'},
          {
            'role': 'receiver',
            'status': 'failed',
            'delivery': 'failed',
            'reason': 'Message undeliverable',
          },
        ],
      },
    });
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: containerLineCardForTesting(line: line)),
      ),
    );
    expect(find.text('Customer ✓✓ Delivered'), findsOneWidget);
    expect(
      find.text('Receiver ⚠ Not delivered: Message undeliverable'),
      findsOneWidget,
    );
  });
}
