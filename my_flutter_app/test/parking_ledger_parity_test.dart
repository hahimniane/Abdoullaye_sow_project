import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The console ran ahead of the app for about fifteen pull requests: work
/// landed as "the console half" and the Flutter half was never written. The
/// clearest symptom was a callable the web called that the app never did — an
/// owner on the phone could record an activity but not define one, could see a
/// stay accruing but never bill it.
///
/// This guards the wiring, not the arithmetic (that is
/// `parking_billing_actions_test.dart`). It reads source because these are
/// screens behind a signed-in business with live Firestore streams, and a
/// missing call is exactly the failure that a screen which never renders in a
/// test cannot report.
void main() {
  String read(String path) => File(path).readAsStringSync();

  group('a parked car can be billed, settled and closed from the phone', () {
    final service = read('lib/services/business_parking_entry.dart');
    final screen = read('lib/screens/parked_car_details_screen.dart');

    test('the service calls each callable the console calls', () {
      for (final callable in [
        'billParkingThroughToday',
        'recordParkingPaymentReceived',
        'closeParkingStay',
      ]) {
        expect(
          service,
          contains("httpsCallable('$callable')"),
          reason: '$callable is called by the console and not by the app',
        );
      }
    });

    test('every new action is on the screen behind its own gate', () {
      // Gate and action are asserted together on purpose: an action with no
      // gate offers staff a button the server then refuses, and a gate with no
      // action is dead code.
      const wiring = <String, String>{
        'canBillBusinessParkingThroughToday': '_billThroughToday',
        'canRecordBusinessParkingPaymentReceived':
            '_recordPaymentReceivedInPerson',
        'canCloseBusinessParkingStay': '_closeStay',
        'canSettleBusinessParkingBalance': '_markFullyPaid',
      };
      wiring.forEach((gate, action) {
        expect(screen, contains('$gate(_paymentFields)'), reason: gate);
        expect(screen, contains('$action,'), reason: action);
      });
    });

    test('the accrual is shown, not just the amount recorded', () {
      // "Amount recorded" on an open-ended stay is a figure from the day the
      // car arrived; on its own it says nothing about what is owed now.
      expect(screen, contains('businessParkingUnbilled(_paymentFields)'));
      expect(screen, contains('_buildAccrualPanel'));
    });
  });

  test('the parking edit form fills the vehicle from the VIN', () {
    // The record form and the ledger's activity form have done this since
    // VIN-first. The edit form was the last one still asking for a make and
    // model beside a VIN that already names them.
    final screen = read('lib/screens/parked_car_details_screen.dart');
    expect(screen, contains('onChanged: canEdit ? _onVinChanged : null'));
    expect(screen, contains('matchDecodedVehicleToCatalog('));
  });

  test('the ledger can define what it charges for, and its receipt rule', () {
    final screen = read('lib/screens/lot_ledger_screen.dart');
    for (final callable in [
      'upsertLotActivityType',
      'deleteLotActivityType',
      'setExpenseProofThreshold',
    ]) {
      expect(
        screen,
        contains("httpsCallable('$callable')"),
        reason: '$callable is called by the console and not by the app',
      );
    }
    // The editor must see the switched-off types too, or there is no way back.
    expect(screen, contains('_allTypes'));
    expect(screen, contains('types: _allTypes'));
  });

  test('the business profile can author the lot\'s price cards', () {
    final profile = read('lib/screens/business_profile_screen.dart');
    final provider = read('lib/providers/auth_provider.dart');
    final model = read('lib/models/business_profile.dart');
    expect(model, contains('final List<ParkingRate> parkingRates;'));
    expect(model, contains("normalizeParkingRates(data['parkingRates'])"));
    expect(profile, contains('_ParkingRateCardsEditor'));
    expect(
      profile,
      contains('parkingRates: _parkingRatesKey.currentState?.buildRates()'),
    );
    // Absent, not empty: the server keeps the current cards when the field is
    // missing, so a screen that does not edit them cannot wipe them.
    expect(provider, contains("'parkingRates': ?parkingRates,"));
  });

  test('the parked-car list carries the columns the console table has', () {
    // The console opens on a dense table; the app only had cards, so the lot
    // could see a car but not what it had run up, what it costs a day, or who
    // took the money. A phone has one column, not eleven — the assertion is
    // that every figure is present, not that it is laid out the same way.
    final home = read('lib/screens/home_menu.dart');
    expect(home, contains('_ParkingListRow'));
    expect(home, contains('_ParkingViewToggle'));
    // Days, rate and total.
    expect(home, contains('businessParkingStayDays(fields)'));
    expect(home, contains("fields['dailyRate']"));
    expect(home, contains('businessParkingAmountDue(fields)'));
    // Registered by / Received by, which need the team loaded.
    expect(home, contains("fields['enteredByUid']"));
    expect(home, contains("fields['receivedByStaffId']"));
    expect(home, contains('_loadStaffNames'));
  });

  test('the console stops handing staff a cancelled payment link', () {
    final lib = read('../admin_web/src/lib/business-parking-entry.ts');
    final panel =
        read('../admin_web/src/components/business/operations-panels.tsx');
    expect(lib, contains('export function isBusinessParkingPaymentLinkCancelled'));
    expect(panel, contains('isBusinessParkingPaymentLinkCancelled(row)'));
  });
}
