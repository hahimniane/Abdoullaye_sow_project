import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';

/// The app half of business-entered parking (docs/PLAN-2026-08-backlog.md
/// item 5). These assertions are deliberately the same ones
/// `admin_web/src/lib/business-parking-entry.test.ts` makes, because the two
/// clients must accept and refuse exactly the same entries - a walk-up the
/// console takes and the app rejects is a bug, not a difference in taste.

BusinessParkingEntryDraft draft({
  String businessId = 'biz-1',
  String customerName = 'Aissatou Diallo',
  String customerPhone = '+1 917 555 0102',
  String customerEmail = '',
  String carMake = 'Toyota',
  String carModel = 'Camry',
  String carYear = '2019',
  String vinNumber = '1hgcm82633a004352',
  DateTime? startDate,
  DateTime? endDate,
  BusinessParkingPaymentMethod paymentMethod =
      BusinessParkingPaymentMethod.direct,
}) => BusinessParkingEntryDraft(
  businessId: businessId,
  customerName: customerName,
  customerPhone: customerPhone,
  customerEmail: customerEmail,
  carMake: carMake,
  carModel: carModel,
  carYear: carYear,
  vinNumber: vinNumber,
  startDate: startDate ?? DateTime(2026, 8, 10),
  endDate: endDate ?? DateTime(2026, 8, 20),
  paymentMethod: paymentMethod,
);

void main() {
  group('validateBusinessParkingEntry', () {
    test('a complete walk-up entry has nothing to object to', () {
      expect(validateBusinessParkingEntry(draft()), isEmpty);
    });

    test('reports every problem at once, not just the first', () {
      final errors = validateBusinessParkingEntry(
        const BusinessParkingEntryDraft(
          businessId: '',
          customerName: '',
          customerPhone: '',
          carMake: '',
          carModel: '',
          carYear: '',
        ),
      );
      expect(errors, <BusinessParkingEntryError>[
        BusinessParkingEntryError.businessRequired,
        BusinessParkingEntryError.customerNameRequired,
        BusinessParkingEntryError.customerPhoneRequired,
        BusinessParkingEntryError.carMakeRequired,
        BusinessParkingEntryError.carModelRequired,
        BusinessParkingEntryError.carYearRequired,
        BusinessParkingEntryError.startDateRequired,
        BusinessParkingEntryError.endDateRequired,
      ]);
    });

    test('email is optional, but a malformed one is refused', () {
      expect(validateBusinessParkingEntry(draft(customerEmail: '')), isEmpty);
      expect(
        validateBusinessParkingEntry(draft(customerEmail: 'aissatou@b.co')),
        isEmpty,
      );
      expect(
        validateBusinessParkingEntry(draft(customerEmail: 'aissatou@')),
        <BusinessParkingEntryError>[
          BusinessParkingEntryError.customerEmailInvalid,
        ],
      );
    });

    test('a payment link with no phone and no email has nowhere to go', () {
      expect(
        validateBusinessParkingEntry(
          draft(
            paymentMethod: BusinessParkingPaymentMethod.paymentLink,
            customerPhone: '  ',
            customerEmail: '',
          ),
        ),
        <BusinessParkingEntryError>[
          BusinessParkingEntryError.customerPhoneRequired,
          BusinessParkingEntryError.paymentLinkContactRequired,
        ],
      );
      // An email alone still reaches the customer, so only the phone is
      // missing.
      expect(
        validateBusinessParkingEntry(
          draft(
            paymentMethod: BusinessParkingPaymentMethod.paymentLink,
            customerPhone: '',
            customerEmail: 'a@b.co',
          ),
        ),
        <BusinessParkingEntryError>[
          BusinessParkingEntryError.customerPhoneRequired,
        ],
      );
    });

    test('the parking window has to make sense', () {
      expect(
        validateBusinessParkingEntry(draft(endDate: DateTime(2026, 8, 1))),
        <BusinessParkingEntryError>[
          BusinessParkingEntryError.endDateBeforeStartDate,
        ],
      );
      // Same day in and out is a real one-day stay, not an inverted window.
      expect(
        validateBusinessParkingEntry(
          draft(startDate: DateTime(2026, 8, 10, 9), endDate: DateTime(2026, 8, 10, 17)),
        ),
        isEmpty,
      );
    });

    test('the year has to be a plausible model year', () {
      expect(
        validateBusinessParkingEntry(draft(carYear: '1899')),
        <BusinessParkingEntryError>[BusinessParkingEntryError.carYearInvalid],
      );
      expect(
        validateBusinessParkingEntry(draft(carYear: '20x9')),
        <BusinessParkingEntryError>[BusinessParkingEntryError.carYearInvalid],
      );
      expect(validateBusinessParkingEntry(draft(carYear: '2026')), isEmpty);
    });
  });

  group('businessParkingEntryPayload', () {
    test('matches what the callable declares', () {
      expect(businessParkingEntryPayload(draft(businessId: ' biz-1 ')), {
        'businessId': 'biz-1',
        'customerName': 'Aissatou Diallo',
        'customerPhone': '+1 917 555 0102',
        'customerEmail': '',
        'carMake': 'Toyota',
        'carModel': 'Camry',
        'carYear': '2019',
        'vinNumber': '1HGCM82633A004352',
        // Midday, so a timezone west of UTC cannot roll the billed window
        // back a whole day on the server's `new Date(...)`.
        'startDate': '2026-08-10T12:00:00',
        'endDate': '2026-08-20T12:00:00',
        'paymentMethod': 'direct',
      });
    });

    test('carries the payment method the lot chose', () {
      expect(
        businessParkingEntryPayload(
          draft(paymentMethod: BusinessParkingPaymentMethod.paymentLink),
        )['paymentMethod'],
        'payment_link',
      );
    });

    test('a single-digit month and day still pad to a parseable date', () {
      expect(
        businessParkingEntryPayload(
          draft(startDate: DateTime(2026, 1, 5), endDate: DateTime(2026, 2, 9)),
        ),
        containsPair('startDate', '2026-01-05T12:00:00'),
      );
    });
  });

  group('BusinessParkingEntryResult', () {
    test('reads the response defensively so no null reaches a copy button', () {
      final empty = BusinessParkingEntryResult.fromCallable(null);
      expect(empty.checkoutUrl, '');
      expect(empty.trackingCode, '');
      expect(empty.amountDueCents, 0);
      expect(empty.amountDue, 0);
    });

    test('carries the tracking code, the amount and the checkout link', () {
      final result = BusinessParkingEntryResult.fromCallable(
        <String, dynamic>{
          'entryId': 'entry-1',
          'trackingCode': 'PK-4T2K9M',
          'paymentMethod': 'payment_link',
          'amountDue': 84.5,
          'amountDueCents': 8450,
          'platformFeeCents': 845,
          'paymentStatus': 'pending',
          'checkoutUrl': 'https://checkout.stripe.com/c/pay/cs_test_1',
          'checkoutSessionId': 'cs_test_1',
        },
      );
      expect(result.trackingCode, 'PK-4T2K9M');
      expect(result.amountDue, 84.5);
      expect(result.isPaymentLink, isTrue);
      expect(result.checkoutUrl, 'https://checkout.stripe.com/c/pay/cs_test_1');
    });

    test('a direct entry is not a payment link', () {
      final result = BusinessParkingEntryResult.fromCallable(
        <String, dynamic>{
          'trackingCode': 'PK-9Q1',
          'paymentMethod': 'direct',
          'amountDueCents': 4000,
          'paymentStatus': 'awaiting_direct_payment',
        },
      );
      expect(result.isPaymentLink, isFalse);
      expect(result.amountDue, 40);
      expect(result.checkoutUrl, '');
    });
  });

  group('BusinessParkingPaidResult', () {
    test('a repeat marking comes back as a success, not an error', () {
      final result = BusinessParkingPaidResult.fromCallable(
        <String, dynamic>{
          'alreadyPaid': true,
          'amountPaidCents': 4000,
          'trackingCode': 'PK-9Q1',
        },
      );
      expect(result.alreadyPaid, isTrue);
      expect(result.amountPaid, 40);
    });
  });

  group('row helpers', () {
    final directAwaiting = <String, dynamic>{
      'source': 'business',
      'paymentMethod': 'direct',
      'status': 'reserved',
      'paymentStatus': 'awaiting_direct_payment',
    };

    test('mark-paid is offered exactly where the server would accept it', () {
      expect(canMarkBusinessParkingPaid(directAwaiting), isTrue);
      // Stripe owns a payment-link record's payment status.
      expect(
        canMarkBusinessParkingPaid({
          ...directAwaiting,
          'paymentMethod': 'payment_link',
        }),
        isFalse,
      );
      // Already paid must not invite a second marking.
      expect(
        canMarkBusinessParkingPaid({...directAwaiting, 'paymentStatus': 'paid'}),
        isFalse,
      );
      expect(
        canMarkBusinessParkingPaid({...directAwaiting, 'status': 'cancelled'}),
        isFalse,
      );
      // A customer's own booking is not a business entry at all.
      expect(
        canMarkBusinessParkingPaid({...directAwaiting, 'source': 'customer'}),
        isFalse,
      );
    });

    test('a business entry is recognised by either marker', () {
      expect(isBusinessEnteredParking(<String, dynamic>{'source': 'business'}), isTrue);
      expect(
        isBusinessEnteredParking(<String, dynamic>{'enteredByBusiness': true}),
        isTrue,
      );
      expect(isBusinessEnteredParking(<String, dynamic>{}), isFalse);
    });

    test('the recorded amount prefers cents and never renders NaN', () {
      expect(businessParkingAmountDue({'amountDueCents': 8450}), 84.5);
      expect(businessParkingAmountDue({'totalCostCents': 1200}), 12);
      expect(businessParkingAmountDue({'totalCost': 40}), 40);
      expect(businessParkingAmountDue(<String, dynamic>{}), 0);
    });
  });

  group('received-via values', () {
    test('are the exact set the server recognises', () {
      expect(businessParkingReceivedViaValues, <String>[
        'zelle',
        'cash',
        'cashapp',
        'venmo',
        'check',
        'card_in_person',
        'other',
      ]);
    });
  });

  group('localization', () {
    Map<String, dynamic> arb(String locale) =>
        json.decode(File('lib/l10n/app_$locale.arb').readAsStringSync())
            as Map<String, dynamic>;

    test('every string this feature renders exists in English and French', () {
      final en = arb('en');
      final fr = arb('fr');
      const keys = <String>[
        'recordAParkedCar',
        'recordTheCar',
        'recordingParkedCar',
        'parkedCarRecorded',
        'parkedCarRecordedWithCode',
        'printReceiptOnly',
        'howDoesThisParkingGetPaid',
        'customerPaysUsDirectly',
        'sendTheCustomerAPaymentLink',
        'directPaymentExplainer',
        'paymentLinkExplainer',
        'paymentLinkShareHint',
        'directPaymentResultHint',
        'paymentLinkLabel',
        'copyPaymentLink',
        'paymentLinkCopied',
        'paymentLinkCopyFailed',
        'amountDue',
        'amountRecorded',
        'paymentStatusLabel',
        'receivedVia',
        'markPaymentReceived',
        'markPaymentReceivedTitle',
        'markPaymentReceivedMessage',
        'paymentRecorded',
        'parkingAlreadyMarkedPaid',
        'paymentCouldNotBeRecorded',
        'carCouldNotBeRecorded',
        'customerEmailOptional',
        'awaitingPaymentToTheBusiness',
        'paidToTheBusiness',
        'paymentLinkSent',
        'paymentLinkPaid',
        'nothingToCollect',
        'receivedViaZelle',
        'receivedViaCash',
        'receivedViaCashApp',
        'receivedViaVenmo',
        'receivedViaCheck',
        'receivedViaCardInPerson',
        'receivedViaOther',
        'parkingErrorBusinessRequired',
        'parkingErrorCustomerName',
        'parkingErrorCustomerPhone',
        'parkingErrorCustomerEmail',
        'parkingErrorPaymentLinkContact',
        'parkingErrorCarMake',
        'parkingErrorCarModel',
        'parkingErrorCarYear',
        'parkingErrorCarYearInvalid',
        'parkingErrorStartDate',
        'parkingErrorEndDate',
        'parkingErrorEndBeforeStart',
      ];
      for (final key in keys) {
        expect(en[key], isNotNull, reason: 'app_en.arb is missing $key');
        expect(fr[key], isNotNull, reason: 'app_fr.arb is missing $key');
        expect(
          (fr[key] as String).trim(),
          isNotEmpty,
          reason: 'app_fr.arb has an empty $key',
        );
      }
    });

    test('every received-via value has a label key', () {
      final en = arb('en');
      const labelKeys = <String, String>{
        'zelle': 'receivedViaZelle',
        'cash': 'receivedViaCash',
        'cashapp': 'receivedViaCashApp',
        'venmo': 'receivedViaVenmo',
        'check': 'receivedViaCheck',
        'card_in_person': 'receivedViaCardInPerson',
        'other': 'receivedViaOther',
      };
      for (final value in businessParkingReceivedViaValues) {
        expect(labelKeys, contains(value));
        expect(en[labelKeys[value]], isNotNull);
      }
    });
  });
}
