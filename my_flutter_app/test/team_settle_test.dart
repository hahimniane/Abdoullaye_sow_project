import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/team_settle.dart';
import 'package:my_flutter_app/services/team_settle_service.dart';
import 'package:my_flutter_app/widgets/team_settle_panel.dart';

/// "I paid everything" (docs/TEAM_SETTLE.md). The server's `team_settle.js`
/// is the rule; the shared fixture pins the server, the console and this app
/// to the same answers, and the rest mirrors the console's
/// `team-settle.test.ts`.
void main() {
  final fixture =
      jsonDecode(
            File(
              'functions/test/fixtures/team-settle-cases.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;

  SettleStatement statementOf(Object? j) {
    final m = Map<String, dynamic>.from(j as Map);
    return SettleStatement(
      parkingJobsCents: (m['parkingJobsCents'] as num).round(),
      expenseCents: (m['expenseCents'] as num).round(),
      cashHeldCents: (m['cashHeldCents'] as num).round(),
    );
  }

  group('every shared split gives the server answer', () {
    for (final c in (fixture['plans'] as List).cast<Map<String, dynamic>>()) {
      test(c['name'] as String, () {
        final plan = teamSettlePlan(
          statement: statementOf(c['statement']),
          cashHeldCents: (c['cashHeldCents'] as num?)?.round(),
          parkingDueCents: (c['parkingDueCents'] as num?)?.round(),
          amountCents: c['amountCents'] as num,
          scope: c['scope'] as String,
        );
        expect(plan.toJson(), c['expected']);
      });
    }
  });

  group('every shared default is the statement number', () {
    for (final c
        in (fixture['defaults'] as List).cast<Map<String, dynamic>>()) {
      test(c['name'] as String, () {
        expect(defaultSettleCents(statementOf(c['statement'])), c['expected']);
      });
    }
  });

  group('every shared pay-back gives the server answer', () {
    for (final c
        in (fixture['paybacks'] as List).cast<Map<String, dynamic>>()) {
      test(c['name'] as String, () {
        expect(
          paybackRefusal(
            owesCents: (c['owesCents'] as num).round(),
            amountCents: c['amountCents'] as num,
            method: c['method'] as String,
          ),
          c['expected'],
        );
      });
    }
  });

  test(
    'the limits: parking after expenses, cash cut by expenses beyond it',
    () {
      final l = settleLimits(
        const SettleStatement(
          parkingJobsCents: 10000,
          expenseCents: 30000,
          cashHeldCents: 50000,
        ),
      );
      expect((l.parkingDueCents, l.cashDueCents), (0, 30000));
    },
  );

  test('settlements are read oldest first and odd rows are left out', () {
    final rows = settlementRecords([
      {
        'id': 'b',
        'status': 'confirmed',
        'requestedAtMs': 2,
        'amountCents': 100,
      },
      {'id': 'a', 'status': 'pending', 'requestedAtMs': 1, 'amountCents': 50},
      {'id': 'x', 'status': 'weird'},
      {'status': 'pending'},
    ]);
    expect([for (final r in rows) r.id], ['a', 'b']);
    expect(rows.first.pending, isTrue);
  });

  test('only the named receiver in a receiver role answers a pending one', () {
    final pending = settlementRecords([
      {'id': 'a', 'status': 'pending', 'receiverId': 'owner'},
    ]).first;
    expect(
      mayAnswerSettlement(pending, uid: 'owner', isReceiver: true),
      isTrue,
    );
    expect(
      mayAnswerSettlement(pending, uid: 'other', isReceiver: true),
      isFalse,
    );
    expect(
      mayAnswerSettlement(pending, uid: 'owner', isReceiver: false),
      isFalse,
    );
    final account = settlementRecords([
      {'id': 'b', 'status': 'pending', 'receiverId': 'business_account'},
    ]).first;
    expect(
      mayAnswerSettlement(account, uid: 'anyone', isReceiver: true),
      isTrue,
    );
    final done = settlementRecords([
      {'id': 'c', 'status': 'confirmed', 'receiverId': 'owner'},
    ]).first;
    expect(mayAnswerSettlement(done, uid: 'owner', isReceiver: true), isFalse);
  });

  test('the ones waiting for a person: theirs and the Business account', () {
    final records = settlementRecords([
      {
        'id': 'a',
        'status': 'pending',
        'receiverId': 'owner',
        'requestedAtMs': 1,
      },
      {'id': 'b', 'status': 'pending', 'receiverId': 'u2', 'requestedAtMs': 2},
      {
        'id': 'c',
        'status': 'pending',
        'receiverId': 'business_account',
        'requestedAtMs': 3,
      },
      {
        'id': 'd',
        'status': 'declined',
        'receiverId': 'owner',
        'requestedAtMs': 4,
      },
    ]);
    expect(
      [
        for (final r in settlementsWaitingFor(
          records,
          uid: 'owner',
          isReceiver: true,
        ))
          r.id,
      ],
      ['a', 'c'],
    );
    expect(
      settlementsWaitingFor(records, uid: 'owner', isReceiver: false),
      isEmpty,
    );
    expect([for (final r in settlementsOf(records, 'nobody')) r.id], isEmpty);
  });

  test('receivers: the owner and Full access, never ordinary staff', () {
    final receivers = settleReceiversOf(
      people: const [
        (id: 'u1', name: 'Keren'),
        (id: 'u2', name: 'Ibra'),
        (id: 'u3', name: 'Awa'),
      ],
      profiles: {
        'u1': {'role': 'businessOwner'},
        'u2': {'role': 'staff', 'fullAccess': true, 'businessId': 'b'},
        'u3': {'role': 'staff', 'businessId': 'b'},
      },
      ownerUid: 'u1',
      ownerFallbackName: 'Owner',
    );
    expect([for (final r in receivers) r.id], ['u1', 'u2']);
    // An owner no profile names is listed first, as "Owner".
    final lone = settleReceiversOf(
      people: const [(id: 'u3', name: 'Awa')],
      profiles: const {},
      ownerUid: 'boss',
      ownerFallbackName: 'Owner',
    );
    expect(lone.single, (id: 'boss', name: 'Owner'));
  });

  test('a failure reads its reason from details, else from the message', () {
    expect(
      parseTeamSettleFailure('failed-precondition', {
        'reason': 'team_settle_not_own',
      }).reason,
      SettleRefusal.notOwn,
    );
    expect(
      parseTeamSettleFailure(
        'failed-precondition',
        null,
        'team_settle_bill_changed',
      ).reason,
      SettleRefusal.billChanged,
    );
    expect(parseTeamSettleFailure('unavailable', null).offline, isTrue);
  });

  test('the service sends each action as the server reads it', () async {
    final sent = <Map<String, Object?>>[];
    final service = TeamSettleService(
      caller: (name, payload) async {
        sent.add({'name': name, ...payload});
        return {'success': true, 'receipt': 'sent'};
      },
    );
    final result = await service.request(
      businessId: 'b',
      monthKey: '2026-10',
      staffId: 's',
      amountCents: 100,
      scope: SettleScope.cash,
      receiverId: 'owner',
      method: 'zelle',
      note: ' hi ',
    );
    expect(result.receipt, 'sent');
    await service.confirm(businessId: 'b', settlementId: 'x');
    await service.decline(businessId: 'b', settlementId: 'x', note: 'no');
    await service.undo(businessId: 'b', settlementId: 'x');
    await service.payback(
      businessId: 'b',
      monthKey: '2026-10',
      staffId: 's',
      amountCents: 5,
      method: 'cash',
    );
    expect(
      [for (final s in sent) s['action']],
      [
        'team_settle_request',
        'team_settle_confirm',
        'team_settle_decline',
        'team_settle_undo',
        'team_payback',
      ],
    );
    expect(sent.every((s) => s['name'] == 'updateLotExpenseEntry'), isTrue);
    expect(sent.first, {
      'name': 'updateLotExpenseEntry',
      'action': 'team_settle_request',
      'businessId': 'b',
      'monthKey': '2026-10',
      'staffId': 's',
      'amountCents': 100,
      'scope': 'cash',
      'receiverId': 'owner',
      'method': 'zelle',
      'note': 'hi',
    });
  });

  test('every refusal has words in both languages', () {
    for (final code in ['en', 'fr']) {
      final l10n = lookupAppLocalizations(Locale(code));
      for (final reason in SettleRefusal.all) {
        expect(
          teamSettleRefusalText(l10n, reason),
          isNot(l10n.pmeTsUnknown),
          reason: '$code $reason',
        );
      }
    }
  });

  test('money text is whole cents, never a float', () {
    expect(centsInputText(122700), '1227.00');
    expect(centsInputText(5), '0.05');
    expect(centsInputText(0), '0.00');
  });
}
