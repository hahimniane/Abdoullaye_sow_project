import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/bank_check.dart';
import 'package:my_flutter_app/services/notification_routing.dart';
import 'package:my_flutter_app/services/zelle_check.dart';

/// "Check bank" any time, the pure part (docs/ZELLE_BANK_CHECK.md): the
/// requests exactly as the callables read them, the answers (never
/// "received" without a deposit), the amount typed, who sees the entry, the
/// short status cache, this month's usage and the owner's limit, and the
/// monthly-limit notification.

void main() {
  group('requests', () {
    test(
      'standalone check: amount in cents, the window, auto only when set',
      () {
        expect(standaloneBankCheckRequest('b1', amountCents: 6050), {
          'businessId': 'b1',
          'mode': 'standalone',
          'amountCents': 6050,
          'since': '15m',
        });
        expect(
          standaloneBankCheckRequest(
            'b1',
            amountCents: 100,
            since: BankCheckSince.today,
            auto: true,
          ),
          {
            'businessId': 'b1',
            'mode': 'standalone',
            'amountCents': 100,
            'since': 'today',
            'auto': true,
          },
        );
      },
    );

    test('a payment check sends auto only for the timed re-checks', () {
      expect(
        checkZellePaymentRequest('b1', ZelleCheckKind.inventorySale, 's1'),
        {'businessId': 'b1', 'kind': 'inventory_sale', 'id': 's1'},
      );
      expect(
        checkZellePaymentRequest(
          'b1',
          ZelleCheckKind.containerLinePayment,
          'p1',
          auto: true,
        )['auto'],
        isTrue,
      );
    });

    test('records: the query squeezed, trimmed and capped at 80', () {
      expect(bankUseRecordsRequest('b1', 'c1'), {
        'businessId': 'b1',
        'mode': 'records',
        'creditId': 'c1',
      });
      expect(
        bankUseRecordsRequest('b1', 'c1', query: '  Fatou \n Diallo ')['query'],
        'Fatou Diallo',
      );
      expect(
        bankUseRecordsRequest('b1', 'c1', query: 'x' * 200)['query'],
        'x' * 80,
      );
      expect(
        bankUseRecordsRequest('b1', 'c1', query: '   ').containsKey('query'),
        isFalse,
      );
    });

    test('use: the deposit and the payment it pays', () {
      expect(
        bankUseDepositRequest(
          'b1',
          'c1',
          ZelleCheckKind.inventoryCreditPayment,
          'cp1',
        ),
        {
          'businessId': 'b1',
          'mode': 'use',
          'creditId': 'c1',
          'kind': 'inventory_credit_payment',
          'id': 'cp1',
        },
      );
    });

    test('the limit is sent alone to setBankCheckWindow', () {
      expect(setBankRefreshLimitRequest('b1', 250), {
        'businessId': 'b1',
        'refreshLimit': 250,
      });
    });
  });

  group('the amount typed', () {
    test('whole cents from the app\'s one money reader', () {
      expect(readBankCheckAmount('60').cents, 6000);
      expect(readBankCheckAmount('60.5').cents, 6050);
      expect(readBankCheckAmount('60,50').cents, 6050);
      expect(readBankCheckAmount(r'$1,000,000.00').cents, 100000000);
    });

    test('empty, unreadable, zero and too large are refused', () {
      expect(readBankCheckAmount('').issue, BankCheckAmountIssue.empty);
      expect(readBankCheckAmount('  ').issue, BankCheckAmountIssue.empty);
      expect(readBankCheckAmount('sixty').issue, BankCheckAmountIssue.invalid);
      expect(readBankCheckAmount('0').issue, BankCheckAmountIssue.notPositive);
      expect(
        readBankCheckAmount('1000000.01').issue,
        BankCheckAmountIssue.tooLarge,
      );
    });

    test('the windows round-trip', () {
      for (final since in BankCheckSince.values) {
        expect(bankCheckSinceOfWire(since.wire), since);
      }
      expect(bankCheckSinceOfWire('2h'), isNull);
      expect(bankCheckSinceOfWire(null), isNull);
    });
  });

  group('answers', () {
    final at = DateTime.utc(2026, 10, 17, 18, 43);

    test('received: the deposit, never more', () {
      final answer = BankCheckAnswer.fromCallable({
        'result': 'received',
        'deposits': [
          {
            'creditId': 'c1',
            'amountCents': 6000,
            'atMs': at.millisecondsSinceEpoch,
            'timeKnown': false,
            'senderName': 'FATOU D.',
            'pending': true,
            'balance': 999999,
          },
        ],
        'since': '1h',
        'fromMs': at.millisecondsSinceEpoch,
        'limitReached': true,
      })!;
      expect(answer.outcome, BankCheckOutcome.received);
      final d = answer.deposits.single;
      expect(d.creditId, 'c1');
      expect(d.amountCents, 6000);
      expect(d.at, at);
      expect(d.timeKnown, isFalse);
      expect(d.senderName, 'FATOU D.');
      expect(d.pending, isTrue);
      expect(answer.since, BankCheckSince.lastHour);
      expect(answer.from, at);
      expect(answer.limitReached, isTrue);
    });

    test('the outcome follows the deposits that could be read', () {
      // "several" with one readable deposit is one deposit.
      expect(
        BankCheckAnswer.fromCallable({
          'result': 'several',
          'deposits': [
            {'creditId': 'c1', 'amountCents': 6000},
            {'creditId': '', 'amountCents': 6000},
            {'creditId': 'c3', 'amountCents': 0},
            {'creditId': 'c1', 'amountCents': 6000},
          ],
        })!.outcome,
        BankCheckOutcome.received,
      );
      // "received" with two is a choice.
      expect(
        BankCheckAnswer.fromCallable({
          'result': 'received',
          'deposits': [
            {'creditId': 'c1', 'amountCents': 6000},
            {'creditId': 'c2', 'amountCents': 6000},
          ],
        })!.outcome,
        BankCheckOutcome.several,
      );
    });

    test('never "received" without a deposit; unknown results are null', () {
      expect(
        BankCheckAnswer.fromCallable({'result': 'received', 'deposits': []}),
        isNull,
      );
      expect(BankCheckAnswer.fromCallable({'result': 'maybe'}), isNull);
      expect(BankCheckAnswer.fromCallable(null), isNull);
      final notFound = BankCheckAnswer.fromCallable({
        'result': 'not_found',
        'deposits': [
          {'creditId': 'c1', 'amountCents': 6000},
        ],
      })!;
      expect(notFound.outcome, BankCheckOutcome.notFound);
      expect(notFound.deposits, isEmpty);
    });

    test('records: known kinds, positive amounts, once each', () {
      final records = BankUseRecords.fromCallable({
        'records': [
          {
            'kind': 'inventory_sale',
            'id': 's1',
            'amountCents': 6000,
            'who': 'Aminata',
            'what': 'Shea butter',
          },
          {'kind': 'inventory_sale', 'id': 's1', 'amountCents': 6000},
          {'kind': 'car_sale', 'id': 'x', 'amountCents': 6000},
          {'kind': 'container_line_payment', 'id': '', 'amountCents': 6000},
          {'kind': 'container_line_payment', 'id': 'p1', 'amountCents': -1},
          {'kind': 'container_line_payment', 'id': 'p2', 'amountCents': 6000},
        ],
        'searched': true,
      })!;
      expect(
        [for (final r in records.records) r.key],
        ['inventory_sale:s1', 'container_line_payment:p2'],
      );
      expect(records.records.first.who, 'Aminata');
      expect(records.searched, isTrue);
      expect(BankUseRecords.fromCallable({}), isNull);
    });
  });

  group('who sees Check bank', () {
    const active = BusinessBankStatus(
      connected: true,
      status: BankLinkStatus.active,
    );
    const reauth = BusinessBankStatus(
      connected: true,
      status: BankLinkStatus.needsReauth,
    );

    BankCheckEntryState of(
      BusinessBankStatus? status, {
      bool isOwner = false,
      bool canCheck = true,
    }) => bankCheckEntryState(
      status: status,
      isOwner: isOwner,
      canCheck: canCheck,
    );

    test('only with an active bank, for whoever can check or the owner', () {
      expect(of(active), BankCheckEntryState.check);
      expect(
        of(active, isOwner: true, canCheck: false),
        BankCheckEntryState.check,
      );
      expect(of(active, canCheck: false), BankCheckEntryState.hidden);
    });

    test('no bank link: staff see nothing, the owner a hint', () {
      expect(of(BusinessBankStatus.none), BankCheckEntryState.hidden);
      expect(of(reauth), BankCheckEntryState.hidden);
      expect(
        of(BusinessBankStatus.none, isOwner: true),
        BankCheckEntryState.connectHint,
      );
      expect(of(reauth, isOwner: true), BankCheckEntryState.reconnectHint);
    });

    test('not read yet (or unreadable): nothing', () {
      expect(of(null, isOwner: true), BankCheckEntryState.hidden);
    });
  });

  group('the status cache', () {
    const status = BusinessBankStatus(
      connected: true,
      status: BankLinkStatus.active,
    );

    test('kept for its time, per business, and forgotten on demand', () {
      var now = DateTime(2026, 10, 20, 9);
      final cache = BankStatusCache(clock: () => now);
      expect(cache.fresh('b1'), isNull);
      cache.put('b1', status);
      expect(cache.fresh('b1'), same(status));
      expect(cache.fresh('b2'), isNull);
      now = now.add(const Duration(minutes: 1, seconds: 59));
      expect(cache.fresh('b1'), same(status));
      now = now.add(const Duration(seconds: 1));
      expect(cache.fresh('b1'), isNull);
      cache.put('b1', status);
      cache.forget('b1');
      expect(cache.fresh('b1'), isNull);
    });

    test('never grows without bound', () {
      final cache = BankStatusCache();
      for (var i = 0; i < 50; i++) {
        cache.put('b$i', status);
      }
      expect(cache.fresh('b49'), same(status));
      expect(cache.fresh('b0'), isNull);
    });
  });

  group('usage and the limit', () {
    test('the owner\'s answer carries the month and the limit', () {
      final status = BusinessBankStatus.fromCallable({
        'connected': true,
        'status': 'active',
        'refreshLimit': 250,
        'usage': {
          'month': '2026-10',
          'checks': 41,
          'refreshes': 12,
          'refreshesFailed': -3,
          'estimatedCostCents': 144,
          'refreshLimit': 250,
          'limitReached': false,
          'byStaff': [
            {'uid': 'u1', 'name': 'Aminata', 'checks': 30, 'refreshes': 9},
            {'uid': 'u1', 'name': 'again', 'checks': 1, 'refreshes': 1},
            {'uid': '', 'name': 'no uid'},
            {'uid': 'u2', 'checks': 11, 'refreshes': 3},
          ],
        },
      });
      expect(status.refreshLimit, 250);
      final usage = status.usage!;
      expect(usage.checks, 41);
      expect(usage.refreshes, 12);
      expect(usage.refreshesFailed, 0);
      expect(usage.estimatedCostCents, 144);
      expect(usage.monthStart, DateTime(2026, 10));
      expect([for (final p in usage.byStaff) p.uid], ['u1', 'u2']);
      expect(usage.byStaff.last.name, '');
    });

    test('staff answers carry no usage and the default limit', () {
      final status = BusinessBankStatus.fromCallable({
        'connected': true,
        'status': 'active',
      });
      expect(status.usage, isNull);
      expect(status.refreshLimit, defaultBankRefreshLimit);
    });

    test('a limit out of range reads as the default', () {
      expect(bankRefreshLimitOf(0), 0);
      expect(bankRefreshLimitOf(1000), 1000);
      expect(bankRefreshLimitOf(1001), defaultBankRefreshLimit);
      expect(bankRefreshLimitOf(-1), defaultBankRefreshLimit);
      expect(bankRefreshLimitOf(12.5), defaultBankRefreshLimit);
      expect(bankRefreshLimitOf('50'), defaultBankRefreshLimit);
      expect(bankRefreshLimitFromAnswer({'refreshLimit': 40}), 40);
      expect(bankRefreshLimitFromAnswer({'refreshLimit': 4000}), isNull);
      expect(bankRefreshLimitFromAnswer({}), isNull);
    });

    test('a typed limit: digits only, 0..1000, never guessed', () {
      expect(readBankRefreshLimit('0'), 0);
      expect(readBankRefreshLimit(' 250 '), 250);
      expect(readBankRefreshLimit('1000'), 1000);
      for (final bad in ['', '1001', '1,000', '12.5', '-1', 'ten', '10000']) {
        expect(readBankRefreshLimit(bad), isNull, reason: bad);
      }
    });

    test('a new limit re-reads "reached" from the month\'s refreshes', () {
      const usage = BankUsage(refreshes: 12, refreshLimit: 100);
      expect(usage.withRefreshLimit(12).limitReached, isTrue);
      expect(usage.withRefreshLimit(13).limitReached, isFalse);
      const status = BusinessBankStatus(
        connected: true,
        status: BankLinkStatus.active,
        usage: usage,
      );
      final changed = status.copyWith(refreshLimit: 10);
      expect(changed.refreshLimit, 10);
      expect(changed.usage!.refreshLimit, 10);
      expect(changed.usage!.limitReached, isTrue);
      // Another change keeps the usage as it was.
      expect(status.copyWith(windowMinutes: 30).usage, same(usage));
    });
  });

  group('the monthly-limit notification', () {
    const business = NotificationAudience.business;

    test('opens the owner\'s bank settings, for that business', () {
      final route = routeForNotificationData({
        'type': 'bank_check_limit',
        'businessId': 'b1',
      }, audience: business);
      expect(route?.name, '/business-bank');
      expect((route?.arguments as BusinessBankArguments).businessId, 'b1');
      // The payload may carry only the type.
      final bare = routeForNotificationData({
        'type': 'bank_check_limit',
      }, audience: business);
      expect((bare?.arguments as BusinessBankArguments).businessId, '');
      // A customer never gets it.
      expect(routeForNotificationData({'type': 'bank_check_limit'}), isNull);
    });

    test('the route exists and lets only the owner in', () {
      final main = File('lib/main.dart').readAsStringSync();
      final start = main.indexOf("'/business-bank': (context)");
      expect(start, greaterThan(0));
      final body = main.substring(start, main.indexOf('},', start));
      expect(body, contains('args is BusinessBankArguments'));
      expect(body, contains('!auth.isBusinessOwner'));
      expect(body, contains('BankZelleSettingsScreen(businessId: businessId)'));
    });
  });
}
