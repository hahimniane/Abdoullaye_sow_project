import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/support_case.dart';
import 'package:my_flutter_app/screens/support_inbox_screen.dart';
import 'package:my_flutter_app/services/support_service.dart';

class _FakeSupportRepository implements SupportRepository {
  _FakeSupportRepository(this.cases);

  final List<SupportCase> cases;

  SupportInboxScope? lastScope;
  String? lastBusinessId;
  String? createdBusinessId;
  String? createdSubject;
  String? createdMessage;
  String? createdPriority;

  @override
  Stream<List<SupportCase>> watchInbox({
    required SupportInboxScope scope,
    String? businessId,
  }) {
    lastScope = scope;
    lastBusinessId = businessId;
    return Stream.value(cases);
  }

  @override
  Future<String> createBusinessPlatformCase({
    required String businessId,
    required String subject,
    required String message,
    String priority = 'normal',
  }) async {
    createdBusinessId = businessId;
    createdSubject = subject;
    createdMessage = message;
    createdPriority = priority;
    return 'case-platform-1';
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

SupportCase _case({
  required String id,
  required String subject,
  required String status,
  String priority = 'normal',
  String escalationStatus = 'business_first',
  String lastMessage = 'Latest update',
}) {
  return SupportCase(
    id: id,
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
    subject: subject,
    status: status,
    priority: priority,
    escalationStatus: escalationStatus,
    lastMessage: lastMessage,
    updatedAt: DateTime(2026, 6, 30),
  );
}

Future<void> _pumpInbox(
  WidgetTester tester, {
  required _FakeSupportRepository repository,
  SupportInboxScope scope = SupportInboxScope.customer,
  String? businessId,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      routes: {
        '/support-thread': (context) {
          final caseId = ModalRoute.of(context)!.settings.arguments as String;
          return Scaffold(body: Text('Thread $caseId'));
        },
      },
      home: SupportInboxScreen(
        scope: scope,
        supportRepository: repository,
        businessIdOverride: businessId,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('support inbox renders empty state without auth provider', (
    tester,
  ) async {
    await _pumpInbox(tester, repository: _FakeSupportRepository(const []));

    expect(find.text('Support center'), findsOneWidget);
    expect(find.text('No support cases yet'), findsOneWidget);
    expect(find.text('Search support cases'), findsOneWidget);
  });

  testWidgets('support inbox filters cases by search and status chips', (
    tester,
  ) async {
    final repository = _FakeSupportRepository([
      _case(
        id: 'urgent',
        subject: 'Pickup missed twice',
        status: 'waiting_for_business',
        priority: 'urgent',
        lastMessage: 'Pickup window was missed.',
      ),
      _case(
        id: 'escalated',
        subject: 'Payment dispute',
        status: 'escalated_to_platform',
        escalationStatus: 'escalated',
      ),
      _case(id: 'resolved', subject: 'Receipt uploaded', status: 'resolved'),
    ]);

    await _pumpInbox(
      tester,
      repository: repository,
      scope: SupportInboxScope.business,
      businessId: 'business-1',
    );

    expect(repository.lastScope, SupportInboxScope.business);
    expect(repository.lastBusinessId, 'business-1');
    expect(find.text('Pickup missed twice'), findsOneWidget);
    expect(find.text('Payment dispute'), findsOneWidget);
    expect(find.text('Receipt uploaded'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'payment');
    await tester.pumpAndSettle();

    expect(find.text('Pickup missed twice'), findsNothing);
    expect(find.text('Payment dispute'), findsOneWidget);
    expect(find.text('Receipt uploaded'), findsNothing);

    await tester.tap(find.text('Urgent'));
    await tester.pumpAndSettle();
    expect(find.text('Payment dispute'), findsNothing);
    expect(find.text('No support cases yet'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();
    expect(find.text('Pickup missed twice'), findsOneWidget);
    expect(find.text('Payment dispute'), findsNothing);

    await tester.tap(find.text('Escalated'));
    await tester.pumpAndSettle();
    expect(find.text('Pickup missed twice'), findsNothing);
    expect(find.text('Payment dispute'), findsOneWidget);

    await tester.tap(find.text('Resolved'));
    await tester.pumpAndSettle();
    expect(find.text('Payment dispute'), findsNothing);
    expect(find.text('Receipt uploaded'), findsOneWidget);
  });

  testWidgets('business inbox can create platform admin support case', (
    tester,
  ) async {
    final repository = _FakeSupportRepository(const []);

    await _pumpInbox(
      tester,
      repository: repository,
      scope: SupportInboxScope.business,
      businessId: 'business-1',
    );

    expect(find.text('Ask platform admin'), findsOneWidget);

    await tester.tap(find.text('Ask platform admin'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Ask platform admin for help'), findsOneWidget);
    expect(find.text('Support subject'), findsOneWidget);

    await tester.tap(find.text('Open support'));
    await tester.pump();

    expect(find.text('Enter a support subject.'), findsOneWidget);
    expect(find.text('Write a message before sending.'), findsOneWidget);

    await tester.enterText(
      find.widgetWithText(TextField, 'Support subject'),
      'Payout question',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Write a message'),
      'Can an admin review our latest payout?',
    );
    await tester.pump();

    expect(find.text('Enter a support subject.'), findsNothing);
    expect(find.text('Write a message before sending.'), findsNothing);

    await tester.tap(find.text('Open support'));
    await tester.pumpAndSettle();

    expect(repository.createdBusinessId, 'business-1');
    expect(repository.createdSubject, 'Payout question');
    expect(repository.createdMessage, 'Can an admin review our latest payout?');
    expect(repository.createdPriority, 'normal');
    expect(find.text('Thread case-platform-1'), findsOneWidget);
  });
}
