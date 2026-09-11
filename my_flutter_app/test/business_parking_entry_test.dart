import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';
import 'package:my_flutter_app/utils/business_permissions.dart';

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
  bool openEnded = false,
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
  endDate: openEnded ? null : (endDate ?? DateTime(2026, 8, 20)),
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
      ]);
    });

    test('the leave date is optional: an open-ended stay is valid and sends '
        'an empty endDate', () {
      final openEnded = draft(openEnded: true);
      expect(validateBusinessParkingEntry(openEnded), isEmpty);
      expect(businessParkingEntryPayload(openEnded)['endDate'], '');
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
          draft(
            startDate: DateTime(2026, 8, 10, 9),
            endDate: DateTime(2026, 8, 10, 17),
          ),
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
      final result = BusinessParkingEntryResult.fromCallable(<String, dynamic>{
        'entryId': 'entry-1',
        'trackingCode': 'PK-4T2K9M',
        'paymentMethod': 'payment_link',
        'amountDue': 84.5,
        'amountDueCents': 8450,
        'platformFeeCents': 845,
        'paymentStatus': 'pending',
        'checkoutUrl': 'https://checkout.stripe.com/c/pay/cs_test_1',
        'checkoutSessionId': 'cs_test_1',
      });
      expect(result.trackingCode, 'PK-4T2K9M');
      expect(result.amountDue, 84.5);
      expect(result.isPaymentLink, isTrue);
      expect(result.checkoutUrl, 'https://checkout.stripe.com/c/pay/cs_test_1');
    });

    test('a direct entry is not a payment link', () {
      final result = BusinessParkingEntryResult.fromCallable(<String, dynamic>{
        'trackingCode': 'PK-9Q1',
        'paymentMethod': 'direct',
        'amountDueCents': 4000,
        'paymentStatus': 'awaiting_direct_payment',
      });
      expect(result.isPaymentLink, isFalse);
      expect(result.amountDue, 40);
      expect(result.checkoutUrl, '');
    });
  });

  group('BusinessParkingPaidResult', () {
    test('a repeat marking comes back as a success, not an error', () {
      final result = BusinessParkingPaidResult.fromCallable(<String, dynamic>{
        'alreadyPaid': true,
        'amountPaidCents': 4000,
        'trackingCode': 'PK-9Q1',
      });
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
        canMarkBusinessParkingPaid({
          ...directAwaiting,
          'paymentStatus': 'paid',
        }),
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
      expect(
        isBusinessEnteredParking(<String, dynamic>{'source': 'business'}),
        isTrue,
      );
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
        'cancelPaymentLink',
        'cancelPaymentLinkConfirm',
        'paymentLinkCancelled',
        'parkingPaymentLinkCancelled',
        'paymentLinkCouldNotBeCancelled',
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

  // A lot could see its parked cars and open one, but had no way to add one:
  // every route into ParkCarScreen was a customer surface. AuthProvider builds
  // Firebase in its field initializers, so this is asserted the way the rest of
  // this feature's widget behaviour is - on the source and on the decision.
  group('the business home offers a way to record a parked car', () {
    final home = File('lib/screens/home_menu.dart').readAsStringSync();

    test('the action is the primary one on the services card', () {
      final guard = home.indexOf('if (canRecordParkedCar) ...[');
      final button = home.indexOf("Key('record-parked-car')");
      final push = home.indexOf('const ParkCarScreen()');
      expect(guard, greaterThan(-1));
      expect(button, greaterThan(guard));
      expect(push, greaterThan(button));

      // Above the fold, not below a "Recent activity" log heading: it is the
      // action a lot performs all day. It sits under the service overview
      // grid and ahead of the console button, which leaves the app.
      final grid = home.indexOf("Key('service-overview-grid')");
      final heading = home.indexOf('l10n.recentActivity');
      final console = home.indexOf('l10n.openBusinessConsole');
      expect(grid, greaterThan(-1));
      expect(guard, greaterThan(grid));
      expect(push, lessThan(console));
      expect(console, lessThan(heading));

      // It is the one filled control on the page; the console it outranks is
      // outlined. Three identical filled slabs meant nothing read as primary,
      // so the filled costume is now worn by this action alone.
      final action = home.indexOf('_PrimaryAction(');
      expect(action, greaterThan(-1));
      expect(button, greaterThan(action));
      expect(
        button - action,
        lessThan(60),
        reason: 'the record action is itself the filled control',
      );
      expect(
        'buttonKey: const Key('.allMatches(home).length,
        1,
        reason: 'exactly one filled action on the business home',
      );
      expect(home, contains('AsyncActionButton.outlined('));

      expect(home, contains('l10n.recordAParkedCar'));
      // Not through the named customer route - business_mobile_role_safety
      // forbids '/park' here, and the push carries no customer arguments.
      expect(home, contains('MaterialPageRoute<void>('));
    });

    test('it is gated on the same permission as the parkedCars feed', () {
      expect(
        home,
        contains(
          'final canRecordParkedCar = auth.hasBusinessPermission(\n'
          '      BusinessPermission.parking,\n'
          '    );',
        ),
      );
      expect(
        home,
        contains('if (auth.hasBusinessPermission(BusinessPermission.parking))'),
      );
      // One render site, and it sits inside the guard - a user without the
      // permission has no path to the screen from this page.
      expect("Key('record-parked-car')".allMatches(home).length, 1);
      expect('ParkCarScreen('.allMatches(home).length, 1);
    });

    test(
      'the permission decision itself admits owners and scoped staff only',
      () {
        // Owner / admin: not staff-scoped, so every permission is theirs.
        expect(
          canAccessBusinessPermission(
            isStaff: false,
            permissions: const <String>[],
            permission: BusinessPermission.parking,
          ),
          isTrue,
        );
        expect(
          canAccessBusinessPermission(
            isStaff: true,
            permissions: const <String>[BusinessPermission.parking],
            permission: BusinessPermission.parking,
          ),
          isTrue,
        );
        expect(
          canAccessBusinessPermission(
            isStaff: true,
            permissions: const <String>[BusinessPermission.barrels],
            permission: BusinessPermission.parking,
          ),
          isFalse,
        );
      },
    );

    test(
      'ParkCarScreen picks the walk-up flow itself, with no flag to pass',
      () {
        final screen = File(
          'lib/screens/park_car_screen.dart',
        ).readAsStringSync();
        final build = screen.substring(
          screen.indexOf('  Widget build(BuildContext context) {'),
          screen.indexOf('Future<void> _selectBusinessEndDate()'),
        );
        expect(build, contains('final auth = context.watch<AuthProvider>();'));
        expect(build, contains('if (!auth.hasBusinessDashboardAccess) {'));
        expect(
          build,
          contains('return _buildCustomerParkingReservation(context);'),
        );
        expect(build, contains('return _buildBusinessParkingIntake(context);'));
        // The constructor takes test seams only - no mode parameter exists, so
        // `const ParkCarScreen()` from the business home lands on the walk-up
        // intake because the signed-in user has dashboard access.
        final ctor = screen.substring(
          screen.indexOf('  const ParkCarScreen({'),
          screen.indexOf('  State<ParkCarScreen> createState()'),
        );
        expect(ctor, isNot(contains('mode')));
        expect(ctor, isNot(contains('isBusiness')));
      },
    );
  });

  // Staff at the desk are often taking a car from someone the lot already
  // knows. The lot remembers every walk-up customer (createBusinessParkingEntry
  // calls rememberLotCustomer), so a regular is someone to pick, not someone
  // to key in again.
  group('the walk-up form offers the customers the lot already knows', () {
    final screen = File('lib/screens/park_car_screen.dart').readAsStringSync();

    test('it reads the lot own customer memory, scoped to the business', () {
      expect(screen, contains("collection('lotCustomers')"));
      expect(screen, contains("where('businessId', isEqualTo: businessId)"));
      expect(screen, contains('LotCustomer.fromMap('));
    });

    test('the field opens on a list, not on nothing', () {
      // A picker that only answers after two characters is a search box, and
      // reads as broken to someone who tapped expecting a list.
      expect(screen, contains('List<LotCustomer> _suggestFor(String value)'));
      final suggest = screen.indexOf('List<LotCustomer> _suggestFor(');
      final body = screen.substring(suggest, screen.indexOf('\n  }', suggest));
      expect(body, contains('if (typed.length < 2) return _lotCustomers.take(6)'));
      expect(body, contains('matchLotCustomers(_lotCustomers, typed)'));
      expect(body, contains('if (!_nameFocus.hasFocus) return const []'));
      expect(screen, contains('_nameFocus.addListener('));
      expect(screen, contains('focusNode: _nameFocus'));
    });

    test('the lot own people are offered too, and are labelled', () {
      // A colleague parking here should not have to be filed as a customer
      // first. Reading the team needs the 'people' permission, so it is
      // best-effort and silent.
      expect(screen, contains('lotCustomerSources('));
      expect(screen, contains('LotCustomer.fromStaff('));
      expect(screen, contains("collection('users')"));
      expect(screen, contains(r"'${customer.name} · Staff'"));
    });

    test('picking one fills the name and phone it knows, and no car', () {
      final apply = screen.indexOf('void _applyLotCustomer(');
      expect(apply, greaterThan(-1));
      final body = screen.substring(apply, screen.indexOf('\n  }', apply));
      expect(body, contains('_nameController.text = customer.name'));
      expect(body, contains('_phoneController.text = customer.phone'));
      // A customer is a name and a phone number - no car is stored against
      // them, and none is filled from them.
      expect(body, isNot(contains('.cars')));
      // Blank remembered fields must not wipe what is already typed.
      expect(body, contains('if (customer.phone.isNotEmpty)'));
    });

    test('the vehicle comes from the VIN, not the person', () {
      // Typing a full VIN decodes make, model and year onto the record - the
      // car belongs to the parking entry, filled from its VIN.
      expect(screen, contains('void _onVinChanged('));
      expect(screen, contains('onChanged: _onVinChanged'));
      final on = screen.indexOf('void _onVinChanged(');
      final body = screen.substring(on, screen.indexOf('\n  }', on));
      expect(body, contains('vin.length == 17'));
      expect(body, contains('isValidVin(vin)'));
      expect(body, contains('_decodeCurrentVin('));
    });

    test('a customer parking their own car never sees the lot memory', () {
      // Two guards: the read refuses without business access, and the chips
      // render inside the business intake only.
      final load = screen.indexOf('Future<void> _loadLotCustomers()');
      expect(load, greaterThan(-1));
      expect(
        screen.substring(load, load + 260),
        contains('if (!auth.hasBusinessDashboardAccess) return;'),
        reason: 'the lot customer list must not be read for a customer',
      );
      final businessIntake =
          screen.indexOf('_buildBusinessParkingIntake(BuildContext');
      final customerIntake =
          screen.indexOf('_buildCustomerParkingReservation(BuildContext');
      final chip = screen.indexOf('_CustomerSuggestionChip(\n');
      expect(businessIntake, greaterThan(-1));
      expect(customerIntake, greaterThan(businessIntake));
      expect(chip, greaterThan(businessIntake));
      expect(chip, lessThan(customerIntake),
          reason: 'the picker belongs to the business intake only');
    });

    test('a name nobody recognises is still how a new customer is added', () {
      // The suggestions sit beside the field, never replace it: the name
      // input keeps its own validator and controller.
      expect(screen, contains('controller: _nameController'));
      expect(screen, contains('pleaseEnterOwnerName'));
    });
  });

  // "Pays us directly" answers how, not whether. A lot takes the cash at the
  // desk as often as it waits for it, and recording both the same way left
  // money already in the till showing as outstanding.
  group('cash at the desk can be recorded as already paid', () {
    final screen = File('lib/screens/park_car_screen.dart').readAsStringSync();

    test('the question is only asked for a direct payment', () {
      expect(screen, contains('if (_paymentMethod == BusinessParkingPaymentMethod.direct)'));
      expect(screen, contains('l10n.parkingNotPaidYet'));
      expect(screen, contains('l10n.parkingPaidPartOfIt'));
      expect(screen, contains('l10n.parkingAlreadyPaidInFull'));
      expect(screen, contains('l10n.parkingHowDidTheyPay'));
    });

    test('it offers the methods the record screen already reconciles', () {
      expect(screen, contains('businessParkingReceivedViaValues'));
      expect(screen, contains('businessParkingReceivedViaLabel(l10n, value)'));
    });

    test('settling reuses the shared callable, after the car exists', () {
      final record = screen.indexOf('Future<void> _recordWalkUpParking()');
      final body = screen.substring(record, screen.indexOf('\n  }', record));
      expect(body, contains('_businessParkingService.createEntry(draft)'));
      expect(body, contains('_businessParkingService.markPaid('));
      expect(
        body.indexOf('createEntry(draft)'),
        lessThan(body.indexOf('markPaid(')),
        reason: 'the car is recorded before it can be settled',
      );
      // A failed settle leaves the car recorded and still owed - never
      // silently paid.
      expect(body, contains('l10n.parkingRecordedNotSettled'));
    });

    test('every new string is in both catalogs', () {
      final en = jsonDecode(File('lib/l10n/app_en.arb').readAsStringSync())
          as Map<String, dynamic>;
      final fr = jsonDecode(File('lib/l10n/app_fr.arb').readAsStringSync())
          as Map<String, dynamic>;
      for (final key in [
        'parkingNotPaidYet',
        'parkingAlreadyPaid',
        'parkingPaidPartOfIt',
        'parkingAlreadyPaidInFull',
        'parkingHowMuchDidTheyPay',
        'parkingSayWhoReceived',
        'parkingEnterDaysPaid',
        'parkingEnterAmountPaid',
        'parkingHowDidTheyPay',
        'directPaymentSettledExplainer',
        'directPaymentPartPaidExplainer',
        'parkingRecordedAndPaid',
        'parkingRecordedAndPartPaid',
        'parkingRecordedNotSettled',
        'parkingRecordedNotPartPaid',
      ]) {
        expect(en[key], isNotNull, reason: '$key missing from English');
        expect(fr[key], isNotNull, reason: '$key missing from French');
      }
    });
  });

  // A walk-up can be part-paid at the desk: days or a dollar amount now, the
  // rest still owed. It rides the same partial-payment callable the record
  // screen uses, and only after the car exists.
  group('a part payment can be taken on the record form', () {
    final screen = File('lib/screens/park_car_screen.dart').readAsStringSync();

    test('the record form offers a part-payment choice with days or amount', () {
      expect(screen, contains("_paidChoice == 'part'"));
      expect(screen, contains('l10n.parkingHowMuchDidTheyPay'));
      expect(screen, contains('_partByDays'));
      expect(screen, contains('_partValueController'));
    });

    test('the part payment rides the shared callable, after the car exists', () {
      final record = screen.indexOf('Future<void> _recordWalkUpParking()');
      final body = screen.substring(record, screen.indexOf('\n  }', record));
      expect(body, contains('_businessParkingService.recordPartialPayment('));
      expect(
        body.indexOf('createEntry(draft)'),
        lessThan(body.indexOf('recordPartialPayment(')),
        reason: 'the car is recorded before the part payment is taken',
      );
      // Guarded before the record exists, so an invalid part payment never
      // leaves an un-settled car behind.
      expect(body, contains('l10n.parkingSayWhoReceived'));
    });
  });
}
