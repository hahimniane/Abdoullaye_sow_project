import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/business_assistant_screen.dart';
import 'package:my_flutter_app/services/business_assistant_service.dart';

class _FakeAssistantClient implements BusinessAssistantClient {
  final List<BusinessAssistantResponse> responses =
      <BusinessAssistantResponse>[];
  final List<List<Map<String, dynamic>>> sentTranscripts =
      <List<Map<String, dynamic>>>[];
  String? lastBusinessId;
  Object? sendFailure;

  String? ranCallable;
  Map<String, dynamic>? ranParams;
  Map<String, dynamic> actionResult = <String, dynamic>{'ok': true};
  Object? actionFailure;

  @override
  Future<BusinessAssistantResponse> sendTranscript({
    required String businessId,
    required List<Map<String, dynamic>> messages,
  }) async {
    lastBusinessId = businessId;
    sentTranscripts.add(messages);
    final failure = sendFailure;
    if (failure != null) {
      sendFailure = null;
      throw failure;
    }
    return responses.removeAt(0);
  }

  @override
  Future<Map<String, dynamic>> runAction({
    required String callable,
    required Map<String, dynamic> params,
  }) async {
    ranCallable = callable;
    ranParams = params;
    final failure = actionFailure;
    if (failure != null) throw failure;
    return actionResult;
  }
}

BusinessAssistantResponse _reply(
  String reply,
  List<Map<String, dynamic>> transcript, {
  BusinessAssistantProposedAction? proposedAction,
}) {
  return BusinessAssistantResponse(
    reply: reply,
    transcript: transcript,
    proposedAction: proposedAction,
  );
}

Future<void> _pumpAssistant(
  WidgetTester tester,
  _FakeAssistantClient client, {
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: BusinessAssistantScreen(businessId: 'biz-1', client: client),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _send(WidgetTester tester, String text) async {
  await tester.enterText(find.byKey(const Key('assistant-input')), text);
  await tester.tap(find.byKey(const Key('assistant-send')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('renders empty state hint and input', (tester) async {
    final client = _FakeAssistantClient();
    await _pumpAssistant(tester, client);

    expect(find.text('How can I help today?'), findsOneWidget);
    expect(find.text('Check which cars are parked right now'), findsOneWidget);
    expect(find.text('Record a walk-up parking entry'), findsOneWidget);
    expect(find.text('Add a shipment tracking update'), findsOneWidget);
    expect(find.byKey(const Key('assistant-input')), findsOneWidget);
    expect(find.byKey(const Key('assistant-send')), findsOneWidget);
  });

  testWidgets('renders the empty state in French', (tester) async {
    final client = _FakeAssistantClient();
    await _pumpAssistant(tester, client, locale: const Locale('fr'));

    expect(find.text('Comment puis-je aider aujourd’hui ?'), findsOneWidget);
    expect(
      find.text('Enregistrer un stationnement sans réservation'),
      findsOneWidget,
    );
  });

  testWidgets('sends a user turn appended to the transcript and shows reply', (
    tester,
  ) async {
    final client = _FakeAssistantClient();
    final transcript = <Map<String, dynamic>>[
      {'role': 'user', 'content': 'How many cars are parked?'},
      {'role': 'assistant', 'content': 'You have 3 cars parked.'},
    ];
    client.responses.add(_reply('You have 3 cars parked.', transcript));
    await _pumpAssistant(tester, client);

    await _send(tester, 'How many cars are parked?');

    expect(client.lastBusinessId, 'biz-1');
    expect(client.sentTranscripts, hasLength(1));
    expect(client.sentTranscripts.single.last, {
      'role': 'user',
      'content': 'How many cars are parked?',
    });
    expect(find.text('How many cars are parked?'), findsOneWidget);
    expect(find.text('You have 3 cars parked.'), findsOneWidget);
    // Empty state is gone once the chat has messages.
    expect(find.text('How can I help today?'), findsNothing);
  });

  testWidgets(
    'proposed action renders a confirmation card without businessId row',
    (tester) async {
      final client = _FakeAssistantClient();
      client.responses.add(
        _reply(
          'I can record that.',
          <Map<String, dynamic>>[
            {'role': 'user', 'content': 'Record a walk-up'},
          ],
          proposedAction: const BusinessAssistantProposedAction(
            toolUseId: 'tu-1',
            tool: 'record_parking',
            callable: 'createBusinessParkingEntry',
            section: 'parking',
            title: 'Record walk-up parking',
            params: <String, dynamic>{
              'businessId': 'biz-1',
              'plate': 'ABC-123',
              'days': 2,
            },
          ),
        ),
      );
      await _pumpAssistant(tester, client);
      await _send(tester, 'Record a walk-up');

      expect(find.text('Record walk-up parking'), findsOneWidget);
      expect(find.text('plate'), findsOneWidget);
      expect(find.text('ABC-123'), findsOneWidget);
      expect(find.text('biz-1'), findsNothing);
      expect(find.byKey(const Key('assistant-action-confirm')), findsOneWidget);
      expect(find.byKey(const Key('assistant-action-cancel')), findsOneWidget);
      // The action must not run before Confirm.
      expect(client.ranCallable, isNull);
    },
  );

  testWidgets('confirm runs the callable and reports the tool result', (
    tester,
  ) async {
    final client = _FakeAssistantClient();
    const action = BusinessAssistantProposedAction(
      toolUseId: 'tu-1',
      tool: 'record_parking',
      callable: 'createBusinessParkingEntry',
      section: 'parking',
      title: 'Record walk-up parking',
      params: <String, dynamic>{'businessId': 'biz-1', 'plate': 'ABC-123'},
    );
    final transcript = <Map<String, dynamic>>[
      {'role': 'user', 'content': 'Record a walk-up'},
    ];
    client.responses.add(
      _reply('Confirm to proceed.', transcript, proposedAction: action),
    );
    client.responses.add(_reply('Done, the entry is recorded.', transcript));
    client.actionResult = <String, dynamic>{'entryId': 'entry-9'};
    await _pumpAssistant(tester, client);
    await _send(tester, 'Record a walk-up');

    await tester.tap(find.byKey(const Key('assistant-action-confirm')));
    await tester.pumpAndSettle();

    expect(client.ranCallable, 'createBusinessParkingEntry');
    expect(client.ranParams, {'businessId': 'biz-1', 'plate': 'ABC-123'});
    expect(client.sentTranscripts, hasLength(2));
    expect(client.sentTranscripts.last.last, {
      'role': 'user',
      'content': [
        {
          'type': 'tool_result',
          'tool_use_id': 'tu-1',
          'content': jsonEncode(<String, dynamic>{'entryId': 'entry-9'}),
        },
      ],
    });
    expect(find.text('Done, the entry is recorded.'), findsOneWidget);
    expect(find.text('Confirmed'), findsOneWidget);
    expect(find.byKey(const Key('assistant-action-confirm')), findsNothing);
    expect(find.byKey(const Key('assistant-action-cancel')), findsNothing);
  });

  testWidgets('cancel declines without running the callable', (tester) async {
    final client = _FakeAssistantClient();
    const action = BusinessAssistantProposedAction(
      toolUseId: 'tu-2',
      tool: 'record_parking',
      callable: 'createBusinessParkingEntry',
      section: 'parking',
      title: 'Record walk-up parking',
      params: <String, dynamic>{'businessId': 'biz-1'},
    );
    final transcript = <Map<String, dynamic>>[
      {'role': 'user', 'content': 'Record a walk-up'},
    ];
    client.responses.add(
      _reply('Confirm to proceed.', transcript, proposedAction: action),
    );
    client.responses.add(_reply('Okay, I will not record it.', transcript));
    await _pumpAssistant(tester, client);
    await _send(tester, 'Record a walk-up');

    await tester.tap(find.byKey(const Key('assistant-action-cancel')));
    await tester.pumpAndSettle();

    expect(client.ranCallable, isNull);
    expect(client.sentTranscripts.last.last, {
      'role': 'user',
      'content': [
        {
          'type': 'tool_result',
          'tool_use_id': 'tu-2',
          'content': 'Declined by the staff member.',
          'is_error': true,
        },
      ],
    });
    expect(find.text('Declined'), findsOneWidget);
    expect(find.byKey(const Key('assistant-action-confirm')), findsNothing);
    expect(find.text('Okay, I will not record it.'), findsOneWidget);
  });

  testWidgets('chat errors are shown inline, not as a snackbar', (
    tester,
  ) async {
    final client = _FakeAssistantClient();
    client.sendFailure = Exception('network down');
    await _pumpAssistant(tester, client);

    await _send(tester, 'Hello?');

    expect(
      find.text('Something went wrong. Please try again.'),
      findsOneWidget,
    );
    expect(find.byType(SnackBar), findsNothing);
    // Input is re-enabled so the user can retry.
    final input = tester.widget<TextField>(
      find.byKey(const Key('assistant-input')),
    );
    expect(input.enabled, isTrue);
  });
}
