import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';

/// Correcting a walk-up is a money edit, not a form edit: the dates decide the
/// price, the price on a payment-link entry is baked into the Stripe session
/// the customer is holding, and switching payment method is one arrangement
/// cancelled and another started. All of that is the server's, which is why
/// the details screen may not write to Firestore any more - and why the
/// responses below are read defensively, since a missing link on a reissue
/// has to surface as "copy it yourself" rather than as a null in a button.

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

/// A field handed to the change builder, however the call was wrapped.
Matcher sendsField(String field) => matches(RegExp("moved\\(\\s*'$field'"));

void main() {
  group('canResendBusinessParkingPaymentLink', () {
    test('an unpaid, live payment link can be sent again', () {
      expect(canResendBusinessParkingPaymentLink(row()), isTrue);
    });

    test('a paid entry has nothing left to send', () {
      expect(
        canResendBusinessParkingPaymentLink(row(paymentStatus: 'succeeded')),
        isFalse,
      );
      expect(
        canResendBusinessParkingPaymentLink(row(paymentStatus: 'paid')),
        isFalse,
      );
      // The badge calls a cancelled record "nothing to say" whatever its
      // payment status; the server still calls this one paid and refuses.
      expect(
        canResendBusinessParkingPaymentLink(
          row(paymentStatus: 'succeeded', status: 'cancelled'),
        ),
        isFalse,
      );
    });

    test('a cancelled link is dead, not resendable', () {
      expect(
        canResendBusinessParkingPaymentLink(
          row(paymentLinkCancelledAt: '2026-08-06T00:00:00Z'),
        ),
        isFalse,
      );
    });

    test('a direct entry has no link at all', () {
      expect(
        canResendBusinessParkingPaymentLink(
          row(paymentMethod: 'direct', checkoutUrl: ''),
        ),
        isFalse,
      );
    });

    test("a customer's own booking is not the lot's to send", () {
      expect(canResendBusinessParkingPaymentLink(row(source: 'app')), isFalse);
    });

    test('it is exactly the cancel gate, so the two cannot drift', () {
      final cases = <Map<String, dynamic>>[
        row(),
        row(paymentStatus: 'succeeded'),
        row(paymentLinkCancelledAt: 1),
        row(paymentMethod: 'direct', checkoutUrl: ''),
        row(source: 'app'),
        row(status: 'cancelled'),
      ];
      for (final entry in cases) {
        expect(
          canResendBusinessParkingPaymentLink(entry),
          canCancelBusinessParkingPaymentLink(entry),
        );
      }
    });
  });

  group('BusinessParkingUpdateResult.fromCallable', () {
    test('reads the loosely typed map cloud_functions hands back', () {
      final result = BusinessParkingUpdateResult.fromCallable(
        <Object?, Object?>{
          'success': true,
          'entryId': 'entry-1',
          'paymentMethod': 'payment_link',
          'amountDueCents': 4500,
          'relinked': true,
          'paymentLinkUrl': 'https://pay.laawoldigital.com/parking/xyz',
          'emailed': true,
          'texted': false,
        },
      );
      expect(result.success, isTrue);
      expect(result.entryId, 'entry-1');
      expect(result.isPaymentLink, isTrue);
      expect(result.amountDueCents, 4500);
      expect(result.relinked, isTrue);
      expect(result.paymentLinkUrl, endsWith('/parking/xyz'));
      expect(result.reachedCustomer, isTrue);
    });

    test('a reissue that reached nobody is not a success to report', () {
      final result = BusinessParkingUpdateResult.fromCallable(
        <Object?, Object?>{'relinked': true, 'emailed': false},
      );
      expect(result.relinked, isTrue);
      expect(result.reachedCustomer, isFalse);
    });

    test('a garbled response is empty, never null in a button', () {
      final result = BusinessParkingUpdateResult.fromCallable('nonsense');
      expect(result.entryId, isEmpty);
      expect(result.paymentLinkUrl, isEmpty);
      expect(result.amountDueCents, 0);
      expect(result.relinked, isFalse);
    });

    test('the direct path answers with no link and no relink', () {
      final result = BusinessParkingUpdateResult.fromCallable(
        <Object?, Object?>{
          'success': true,
          'paymentMethod': 'direct',
          'amountDueCents': 12000,
          'relinked': false,
        },
      );
      expect(result.isPaymentLink, isFalse);
      expect(result.relinked, isFalse);
      expect(result.paymentLinkUrl, isEmpty);
    });
  });

  group('BusinessParkingResendLinkResult.fromCallable', () {
    test('reports each channel separately, because they fail separately', () {
      final texted = BusinessParkingResendLinkResult.fromCallable(
        <Object?, Object?>{
          'success': true,
          'emailed': false,
          'texted': true,
          'url': 'https://pay.laawoldigital.com/parking/abc',
        },
      );
      expect(texted.emailed, isFalse);
      expect(texted.texted, isTrue);
      expect(texted.reachedCustomer, isTrue);
      expect(texted.url, isNotEmpty);

      final nowhere = BusinessParkingResendLinkResult.fromCallable(
        <Object?, Object?>{'success': true},
      );
      expect(nowhere.reachedCustomer, isFalse);
      expect(nowhere.url, isEmpty);
    });
  });

  group('the payload the edit sends', () {
    test('dates carry a midday clock so no timezone moves them', () {
      expect(
        businessParkingMiddayIso(DateTime(2026, 8, 10, 23, 45)),
        '2026-08-10T12:00:00',
      );
      expect(businessParkingMiddayIso(null), '');
    });
  });

  group('the details screen routes every save through the callable', () {
    final source = File(
      'lib/screens/parked_car_details_screen.dart',
    ).readAsStringSync();

    test('a walk-up is saved with updateEntry, never written directly', () {
      expect(source, contains('_businessParkingService.updateEntry('));
      final handler = source.substring(
        source.indexOf('Future<bool> _saveBusinessParkingEntry('),
        source.indexOf('Future<bool> _persistChanges('),
      );
      expect(handler, isNot(contains('FirebaseFirestore')));
      expect(handler, isNot(contains('.update(')));
      // The server owns the price: an amount in the payload would offer to
      // contradict what the customer is charged.
      expect(handler, isNot(contains('totalCost')));
      expect(handler, isNot(contains('amountDue:')));
      // The refusal is shown as written - "This parking has been paid for and
      // can no longer be edited" says something this screen's copy cannot.
      expect(handler, contains('FirebaseFunctionsException'));
      expect(handler, contains('showErrorSnackBar('));
      expect(handler, isNot(contains('AppColors.brandRed')));
    });

    test('_persistChanges sends a walk-up down that path first', () {
      final router = source.substring(
        source.indexOf('Future<bool> _persistChanges('),
        source.indexOf('Future<void> _updateRecord()'),
      );
      expect(router, contains('if (_isBusinessEntry)'));
      expect(router, contains('_saveBusinessParkingEntry('));
    });

    test('every editable field the callable accepts is offered', () {
      expect(source, hasWidgetKey('parking-customer-phone'));
      expect(source, hasWidgetKey('parking-customer-email'));
      expect(source, hasWidgetKey('parking-end-date'));
      expect(source, hasWidgetKey('parking-payment-method'));
      expect(source, contains('l10n.customerPhone'));
      expect(source, contains('l10n.customerEmailOptional'));
      expect(source, contains('l10n.howDoesThisParkingGetPaid'));
      expect(source, contains('l10n.customerPaysUsDirectly'));
      expect(source, contains('l10n.sendTheCustomerAPaymentLink'));
      for (final field in const <String>[
        'customerName',
        'customerPhone',
        'customerEmail',
        'carMake',
        'carModel',
        'carYear',
        'vinNumber',
        'startDate',
        'endDate',
        'paymentMethod',
      ]) {
        expect(source, sendsField(field));
      }
    });

    test('a paid record cannot be edited at all', () {
      // The server refuses it; an editable field that cannot be saved is
      // worse than no field.
      expect(source, contains('businessParkingPaymentTone('));
      expect(source, contains('BusinessParkingPaymentTone.paid'));
      expect(source, contains('canRecordPayment && !isPaidEntry'));
      expect(source, hasWidgetKey('parking-edit-locked'));
      expect(source, contains('l10n.parkingPaidCannotBeEdited'));
    });

    test('no amount field is offered on a walk-up', () {
      // The cost-per-day box and the totals belong to a customer booking; the
      // callable reprices a walk-up from the business's own rates.
      final billing = source.substring(
        source.indexOf('Widget _buildBillingCard('),
        source.indexOf('String _parkingStatusLabel('),
      );
      expect(billing, contains('if (!isBusinessEntry)'));
      expect(billing, contains('l10n.costPerDayCurrency'));
      final costLine = billing.indexOf('l10n.costPerDayCurrency');
      final guardLine = billing.indexOf('if (!isBusinessEntry)');
      expect(guardLine, lessThan(costLine));
    });

    test('the resend button is gated on the shared decision', () {
      expect(source, contains('canResendBusinessParkingPaymentLink('));
      expect(source, contains('if (canResendLink)'));
      expect(source, hasWidgetKey('parking-resend-payment-link'));
      expect(source, contains('l10n.resendPaymentLink'));
      // It sits with the copy and cancel actions on the same link, inside the
      // branch that only runs for a live one.
      final copy = source.indexOf('label: l10n.copyPaymentLink,');
      final cancel = source.indexOf('label: l10n.cancelPaymentLink,', copy);
      expect(copy, greaterThan(-1));
      expect(cancel, greaterThan(copy));
      expect(source.substring(copy, cancel), contains('canResendLink'));
    });

    test('the resend outcome is reported from emailed/texted', () {
      final handler = source.substring(
        source.indexOf('Future<void> _resendPaymentLink()'),
        source.indexOf('Future<void> _openParkingDocument()'),
      );
      expect(handler, contains('businessParkingLinkDeliveryMessage('));
      expect(handler, contains('emailed: result.emailed'));
      expect(handler, contains('texted: result.texted'));
      // Reaching neither channel is a failure the staff member must see, even
      // though the callable calls it a success.
      expect(handler, contains('result.reachedCustomer'));
      expect(handler, contains('showErrorSnackBar('));
      expect(handler, contains('FirebaseFunctionsException'));
      expect(handler, isNot(contains('AppColors.brandRed')));
    });

    test('a reissued link is announced, not swallowed', () {
      expect(source, contains('l10n.parkingPaymentLinkReissued'));
      expect(source, contains('result.relinked'));
    });
  });
}
