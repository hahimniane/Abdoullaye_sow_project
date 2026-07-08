import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/support_case.dart';
import 'package:my_flutter_app/models/support_message.dart';
import 'package:my_flutter_app/screens/support_thread_screen.dart';
import 'package:my_flutter_app/services/support_service.dart';

class _FakeSupportRepository implements SupportRepository {
  _FakeSupportRepository({
    required this.supportCase,
    required this.messages,
    this.internalNotes = const <Map<String, dynamic>>[],
  });

  final SupportCase supportCase;
  final List<SupportMessage> messages;
  final List<Map<String, dynamic>> internalNotes;

  int markReadCount = 0;
  int setTypingCount = 0;
  String? sentContent;
  SupportReplyReference? sentReplyTo;
  String? editedMessageId;
  String? editedContent;
  String? deletedMessageId;
  String? requestedEvidenceNote;
  String? escalationReason;
  String? escalationNote;
  String? internalNote;
  String? uploadedFileName;
  String? uploadedMessageType;
  bool resolved = false;
  bool reopened = false;

  @override
  Stream<SupportCase?> watchCase(String caseId) => Stream.value(supportCase);

  @override
  Stream<List<SupportMessage>> watchMessages(String caseId, String uid) {
    return Stream.value(
      messages.where((message) => !message.deletedFor(uid)).toList(),
    );
  }

  @override
  Stream<List<Map<String, dynamic>>> watchInternalNotes(String caseId) {
    return Stream.value(internalNotes);
  }

  @override
  Future<void> markRead(String caseId) async {
    markReadCount += 1;
  }

  @override
  Future<void> setTyping(String caseId, bool typing) async {
    setTypingCount += 1;
  }

  @override
  Future<void> sendMessage({
    required String caseId,
    required String content,
    SupportReplyReference? replyTo,
  }) async {
    sentContent = content;
    sentReplyTo = replyTo;
  }

  @override
  Future<void> editMessage({
    required String caseId,
    required String messageId,
    required String content,
  }) async {
    editedMessageId = messageId;
    editedContent = content;
  }

  @override
  Future<void> deleteMessageForMe({
    required String caseId,
    required String messageId,
  }) async {
    deletedMessageId = messageId;
  }

  @override
  Future<void> requestEvidence({
    required String caseId,
    required String note,
  }) async {
    requestedEvidenceNote = note;
  }

  @override
  Future<void> addInternalNote({
    required String caseId,
    required String note,
  }) async {
    internalNote = note;
  }

  @override
  Future<void> resolve({
    required String caseId,
    String outcome = 'resolved',
    String? note,
  }) async {
    resolved = true;
  }

  @override
  Future<void> reopen({required String caseId, String? note}) async {
    reopened = true;
  }

  @override
  Stream<List<SupportCase>> watchInbox({
    required SupportInboxScope scope,
    String? businessId,
  }) {
    throw UnimplementedError();
  }

  @override
  Stream<List<Map<String, dynamic>>> watchTimeline(String caseId) {
    return Stream.value(const <Map<String, dynamic>>[]);
  }

  @override
  Future<String> createOrOpenCase(SupportCaseOpenRequest request) {
    throw UnimplementedError();
  }

  @override
  Future<String> createBusinessPlatformCase({
    required String businessId,
    required String subject,
    required String message,
    String priority = 'normal',
  }) {
    throw UnimplementedError();
  }

  @override
  Future<void> escalate({
    required String caseId,
    required String reason,
    String? note,
  }) async {
    escalationReason = reason;
    escalationNote = note;
  }

  @override
  Future<void> assign({
    required String caseId,
    String? assignedAdminUid,
    String? assignedBusinessUserId,
  }) async {}

  @override
  Future<void> uploadImageMessage({
    required String caseId,
    required XFile file,
    String caption = '',
  }) {
    throw UnimplementedError();
  }

  @override
  Future<void> uploadAttachmentFile({
    required String caseId,
    required String fileName,
    required List<int> bytes,
    required String mimeType,
    required String messageType,
    int? durationSeconds,
    String caption = '',
  }) async {
    uploadedFileName = fileName;
    uploadedMessageType = messageType;
  }

  @override
  Future<void> uploadAttachmentMetadata({
    required String caseId,
    required String messageType,
    required String fileUrl,
    required String fileName,
    String mimeType = 'application/octet-stream',
    int? fileSize,
    int? durationSeconds,
    String caption = '',
  }) {
    throw UnimplementedError();
  }
}

SupportCase _supportCase({
  String status = 'waiting_for_business',
  String escalationStatus = 'business_first',
}) {
  return SupportCase(
    id: 'case-1',
    customerUid: 'customer-1',
    customerName: 'Aissatou Diallo',
    customerEmail: 'customer@example.test',
    customerPhone: '+15555550101',
    businessId: 'business-1',
    businessName: 'Keren Shipping',
    relatedCollection: 'barrelShipments',
    relatedId: 'shipment-1',
    relatedLabel: 'SUPPORT-001',
    caseType: 'barrel_shipment',
    subject: 'Shipment help',
    status: status,
    priority: 'normal',
    escalationStatus: escalationStatus,
    lastMessage: 'We are checking the pickup notes.',
    updatedAt: DateTime(2026, 6, 30),
  );
}

SupportMessage _message({
  required String id,
  required String senderId,
  required String senderName,
  required String content,
  String senderRole = 'customer',
  String messageType = 'text',
  Map<String, dynamic> metadata = const <String, dynamic>{},
  SupportReplyReference? replyTo,
}) {
  return SupportMessage(
    id: id,
    senderId: senderId,
    senderRole: senderRole,
    senderName: senderName,
    content: content,
    messageType: messageType,
    metadata: metadata,
    replyTo: replyTo,
    createdAt: DateTime(2026, 6, 30, 9, 15),
  );
}

Future<void> _pumpThread(
  WidgetTester tester,
  _FakeSupportRepository repository, {
  String userId = 'customer-1',
  bool isAdmin = false,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: SupportThreadScreen(
        caseId: 'case-1',
        supportRepository: repository,
        userIdOverride: userId,
        isAdminOverride: isAdmin,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'support thread sends replies, edits, and delete-for-me actions',
    (tester) async {
      final repository = _FakeSupportRepository(
        supportCase: _supportCase(),
        messages: [
          _message(
            id: 'business-message',
            senderId: 'staff-1',
            senderName: 'Business Staff',
            senderRole: 'business',
            content: 'We are checking the pickup notes.',
          ),
          _message(
            id: 'customer-message',
            senderId: 'customer-1',
            senderName: 'Aissatou',
            content: 'The pickup window was missed.',
            replyTo: const SupportReplyReference(
              messageId: 'business-message',
              senderName: 'Business Staff',
              content: 'We are checking the pickup notes.',
            ),
          ),
        ],
      );

      await _pumpThread(tester, repository);

      expect(repository.markReadCount, 1);
      expect(find.text('Shipment help'), findsOneWidget);
      expect(find.text('SUPPORT-001'), findsOneWidget);
      expect(find.text('We are checking the pickup notes.'), findsOneWidget);
      expect(find.text('Request evidence'), findsNothing);
      expect(find.textContaining('Business Staff'), findsNothing);
      expect(
        find.text('Keren Shipping: We are checking the pickup notes.'),
        findsOneWidget,
      );

      await tester.longPress(find.text('We are checking the pickup notes.'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Reply'));
      await tester.pumpAndSettle();

      expect(find.text('Replying to Keren Shipping'), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'Thanks for checking.');
      await tester.tap(find.byIcon(Icons.send));
      await tester.pumpAndSettle();

      expect(repository.sentContent, 'Thanks for checking.');
      expect(repository.sentReplyTo?.messageId, 'business-message');
      expect(repository.sentReplyTo?.senderName, 'Keren Shipping');

      await tester.longPress(find.text('The pickup window was missed.'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Edit message'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'Pickup missed twice.');
      await tester.tap(find.byIcon(Icons.check));
      await tester.pumpAndSettle();

      expect(repository.editedMessageId, 'customer-message');
      expect(repository.editedContent, 'Pickup missed twice.');

      await tester.longPress(find.text('We are checking the pickup notes.'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete for me'));
      await tester.pumpAndSettle();

      expect(repository.deletedMessageId, 'business-message');
    },
  );

  testWidgets('support thread attachment sheet shows mobile upload actions', (
    tester,
  ) async {
    final repository = _FakeSupportRepository(
      supportCase: _supportCase(),
      messages: const [],
    );

    await _pumpThread(tester, repository);

    await tester.tap(find.byIcon(Icons.add));
    await tester.pumpAndSettle();

    expect(find.text('Add attachment'), findsOneWidget);
    expect(find.text('Photo'), findsOneWidget);
    expect(find.text('Camera'), findsOneWidget);
    expect(find.text('Video'), findsOneWidget);
    expect(find.text('File'), findsOneWidget);
  });

  testWidgets('admin support thread shows admin actions and internal notes', (
    tester,
  ) async {
    final repository = _FakeSupportRepository(
      supportCase: _supportCase(
        status: 'escalated_to_platform',
        escalationStatus: 'escalated',
      ),
      messages: [
        _message(
          id: 'customer-message',
          senderId: 'customer-1',
          senderName: 'Aissatou',
          content: 'Please review this case.',
        ),
      ],
      internalNotes: const [
        {
          'note': 'Business payout review may be needed.',
          'actorName': 'Platform Admin',
        },
      ],
    );

    await _pumpThread(tester, repository, userId: 'admin-1', isAdmin: true);

    expect(find.text('Request evidence'), findsOneWidget);
    expect(find.text('Add internal note'), findsOneWidget);
    expect(find.text('Internal notes'), findsOneWidget);

    await tester.tap(find.text('Internal notes'));
    await tester.pumpAndSettle();

    expect(find.text('Business payout review may be needed.'), findsOneWidget);
    expect(find.text('Platform Admin'), findsOneWidget);
  });

  testWidgets('business support thread can request info resolve and escalate', (
    tester,
  ) async {
    final repository = _FakeSupportRepository(
      supportCase: _supportCase(),
      messages: [
        _message(
          id: 'customer-message',
          senderId: 'customer-1',
          senderName: 'Aissatou',
          content: 'The pickup driver did not arrive.',
        ),
      ],
    );

    await _pumpThread(tester, repository, userId: 'staff-1');

    await tester.enterText(
      find.byType(TextField),
      'We are contacting dispatch.',
    );
    await tester.tap(find.byIcon(Icons.send));
    await tester.pumpAndSettle();
    expect(repository.sentContent, 'We are contacting dispatch.');

    await tester.tap(find.text('Request evidence'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextField).last,
      'Please upload the pickup confirmation.',
    );
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
    expect(
      repository.requestedEvidenceNote,
      'Please upload the pickup confirmation.',
    );

    await tester.tap(find.text('Mark resolved'));
    await tester.pumpAndSettle();
    expect(repository.resolved, isTrue);

    await tester.tap(find.text('Ask Laawol admin to help'));
    await tester.pumpAndSettle();
    expect(find.text('Escalation reason'), findsOneWidget);
    await tester.enterText(
      find.byType(TextField).last,
      'Customer needs platform review.',
    );
    await tester.tap(find.text('Ask Laawol admin to help').last);
    await tester.pumpAndSettle();

    expect(repository.escalationReason, 'unresolved');
    expect(repository.escalationNote, 'Customer needs platform review.');
  });
}
