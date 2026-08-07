import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';

/// A Stripe webhook can arrive late, be misconfigured, or never arrive at all.
///
/// Without a way to ask Stripe directly, a lot working only from the phone had
/// no way to reconcile a car the customer HAS paid for: the record sat on
/// "Payment link sent" for ever, the payout never went out, and the only fix
/// was to open the web console. `refreshBusinessParkingPayment` is that way,
/// and everything it can answer is decided below - outside the widget, so
/// every branch is driven here without Firebase and without a screen.

Map<String, dynamic> row({
  String source = 'business',
  String paymentMethod = 'payment_link',
  String? paymentStatus = 'awaiting_link_payment',
  String status = 'active',
  String checkoutUrl = 'https://pay.laawoldigital.com/parking/abc',
  Object? paymentLinkCancelledAt,
}) => <String, dynamic>{
  'source': source,
  'paymentMethod': paymentMethod,
  'paymentStatus': ?paymentStatus,
  'status': status,
  'checkoutUrl': checkoutUrl,
  'paymentLinkCancelledAt': ?paymentLinkCancelledAt,
};

/// A widget key, however the formatter chose to wrap the call.
Matcher hasWidgetKey(String name) =>
    matches(RegExp("ValueKey<String>\\(\\s*'$name'"));

void main() {
  group('BusinessParkingRefreshResult reads the callable defensively', () {
    test('a paid, freshly recorded answer', () {
      final result = BusinessParkingRefreshResult.fromCallable(
        <String, Object?>{
          'paid': true,
          'alreadyRecorded': false,
          'paymentStatus': 'succeeded',
        },
      );
      expect(result.paid, isTrue);
      expect(result.alreadyRecorded, isFalse);
      expect(result.paymentStatus, 'succeeded');
      expect(
        result.outcome,
        BusinessParkingRefreshOutcome.confirmedAndRecorded,
      );
    });

    test('a paid answer the record already knew about', () {
      final result = BusinessParkingRefreshResult.fromCallable(
        <String, Object?>{
          'paid': true,
          'alreadyRecorded': true,
          'paymentStatus': 'succeeded',
        },
      );
      expect(result.outcome, BusinessParkingRefreshOutcome.alreadyRecorded);
    });

    test('an unpaid answer carries the session status back', () {
      final result = BusinessParkingRefreshResult.fromCallable(
        <String, Object?>{
          'paid': false,
          'paymentStatus': 'awaiting_link_payment',
          'sessionStatus': 'open',
        },
      );
      expect(result.outcome, BusinessParkingRefreshOutcome.notReceived);
      expect(result.sessionStatus, 'open');
    });

    test('nothing but an explicit true counts as paid', () {
      // Telling a lot the money has arrived when it has not is the one
      // mistake this action must never make, so a truthy-looking string, a 1
      // and a missing field all read as unpaid.
      for (final value in <Object?>['true', 1, 'yes', null]) {
        expect(
          BusinessParkingRefreshResult.fromCallable(<String, Object?>{
            'paid': value,
          }).outcome,
          BusinessParkingRefreshOutcome.notReceived,
          reason: 'paid: $value must not be treated as a payment',
        );
      }
    });

    test('a response that is not a map at all is "not received"', () {
      expect(
        BusinessParkingRefreshResult.fromCallable(null).outcome,
        BusinessParkingRefreshOutcome.notReceived,
      );
      expect(
        BusinessParkingRefreshResult.fromCallable('boom').outcome,
        BusinessParkingRefreshOutcome.notReceived,
      );
    });

    test('alreadyRecorded on an unpaid answer does not promote it', () {
      // `paid` decides first, exactly as the console's checkLinkPayment does.
      // Reading alreadyRecorded first would report a payment that Stripe has
      // explicitly said it never received.
      expect(
        BusinessParkingRefreshResult.fromCallable(<String, Object?>{
          'paid': false,
          'alreadyRecorded': true,
        }).outcome,
        BusinessParkingRefreshOutcome.notReceived,
      );
    });
  });

  group('canCheckBusinessParkingPayment', () {
    test('an unpaid payment link can be checked', () {
      expect(canCheckBusinessParkingPayment(row()), isTrue);
    });

    test('a paid entry has nothing left to ask Stripe', () {
      // The console hides the button on exactly this.
      expect(
        canCheckBusinessParkingPayment(row(paymentStatus: 'succeeded')),
        isFalse,
      );
      expect(
        canCheckBusinessParkingPayment(row(paymentStatus: 'paid')),
        isFalse,
      );
    });

    test('a CANCELLED link can still be checked', () {
      // Not the resend/cancel gate, and deliberately so: a customer can pay a
      // link in the minutes before the lot kills it, and that payment is
      // precisely the one nobody would otherwise find.
      final cancelled = row(paymentLinkCancelledAt: '2026-08-06T00:00:00Z');
      expect(canCancelBusinessParkingPaymentLink(cancelled), isFalse);
      expect(canResendBusinessParkingPaymentLink(cancelled), isFalse);
      expect(canCheckBusinessParkingPayment(cancelled), isTrue);
    });

    test('a cancelled RECORD can still be checked while it is unpaid', () {
      expect(
        canCheckBusinessParkingPayment(row(status: 'cancelled')),
        isTrue,
      );
    });

    test('a direct entry is not Stripe\'s to answer for', () {
      expect(
        canCheckBusinessParkingPayment(
          row(paymentMethod: 'direct', checkoutUrl: ''),
        ),
        isFalse,
      );
    });

    test('a record with no checkout link has nothing to check', () {
      expect(canCheckBusinessParkingPayment(row(checkoutUrl: '')), isFalse);
    });

    test("a customer's own booking is not the lot's to reconcile", () {
      expect(canCheckBusinessParkingPayment(row(source: 'app')), isFalse);
    });
  });

  group('the three sentences are the console\'s own', () {
    final english =
        jsonDecode(File('lib/l10n/app_en.arb').readAsStringSync()) as Map;
    final french =
        jsonDecode(File('lib/l10n/app_fr.arb').readAsStringSync()) as Map;

    test('English matches operations-panels.tsx word for word', () {
      // A lot that reads one wording on the console and another on the phone
      // reasonably concludes the two are reporting different things.
      expect(
        english['parkingPaymentConfirmedWithStripe'],
        'Payment confirmed with Stripe and recorded.',
      );
      expect(english['parkingPaymentAlreadyRecorded'], 'Already recorded as paid.');
      expect(
        english['parkingPaymentNotReceivedYet'],
        'Stripe has not received this payment yet.',
      );
    });

    test('every new string has a French counterpart', () {
      for (final key in <String>[
        'checkPaymentStatus',
        'checkingPaymentStatus',
        'parkingPaymentConfirmedWithStripe',
        'parkingPaymentAlreadyRecorded',
        'parkingPaymentNotReceivedYet',
        'parkingPaymentStatusCouldNotBeChecked',
        'parkingPaymentLinkAlreadyCancelled',
      ]) {
        expect(english[key], isA<String>(), reason: '$key missing in English');
        expect(french[key], isA<String>(), reason: '$key missing in French');
        expect(
          french[key],
          isNot(english[key]),
          reason: '$key was never translated',
        );
      }
    });
  });

  group('the service asks the right callable', () {
    final source = File(
      'lib/services/business_parking_entry.dart',
    ).readAsStringSync();

    test('refreshPayment calls refreshBusinessParkingPayment with entryId', () {
      final method = source.substring(
        source.indexOf('Future<BusinessParkingRefreshResult> refreshPayment'),
      );
      expect(method, contains("httpsCallable('refreshBusinessParkingPayment')"));
      expect(method, contains("'entryId': entryId"));
    });
  });

  group('the details screen spends the decision it is given', () {
    final source = File(
      'lib/screens/parked_car_details_screen.dart',
    ).readAsStringSync();

    test('the button is gated on the decision above, not on the link gate', () {
      expect(source, contains('canCheckBusinessParkingPayment('));
      expect(source, contains('if (canCheckPayment)'));
      expect(source, contains('l10n.checkPaymentStatus'));
      expect(source, hasWidgetKey('parking-check-payment-status'));
    });

    test('the three outcomes go through the shared localisation', () {
      final handler = source.substring(
        source.indexOf('Future<void> _checkPaymentStatus()'),
        source.indexOf('Future<void> _cancelPaymentLink()'),
      );
      expect(handler, contains('businessParkingRefreshMessage('));
      // "Stripe has not been paid" is not a green toast: it means the lot is
      // still owed, and a staff member who reads it as "done" stops chasing.
      expect(
        handler,
        contains('BusinessParkingRefreshOutcome.notReceived'),
      );
      expect(handler, contains('showErrorSnackBar('));
      expect(handler, contains('showSuccessSnackBar('));
      expect(handler, isNot(contains('AppColors.brandRed')));
    });

    test('a confirmed payment settles the card without a round trip', () {
      final handler = source.substring(
        source.indexOf('Future<void> _checkPaymentStatus()'),
        source.indexOf('Future<void> _cancelPaymentLink()'),
      );
      expect(handler, contains("'paymentStatus': 'succeeded'"));
      // The server's own refusals ("not paid by payment link", "no checkout
      // session to check") say what this screen's copy cannot.
      expect(handler, contains('FirebaseFunctionsException'));
      expect(handler, contains('l10n.parkingPaymentStatusCouldNotBeChecked'));
    });
  });
}
