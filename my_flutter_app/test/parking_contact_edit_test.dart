import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/parked_car.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/screens/parked_car_details_screen.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';
import 'package:my_flutter_app/services/parking_whatsapp.dart';
import 'package:provider/provider.dart';

/// Fixing a parked car's phone, name or email (docs/PARKING_LEFT_WHATSAPP.md
/// §3-§4): an edit that moves only contact fields goes to `update_contact`,
/// which works on a PAID car too, and the resend notice shows only when the
/// server says the phone changed and the switch is on.

class _Auth extends ChangeNotifier implements AuthProvider {
  @override
  bool get isAdmin => true;
  @override
  bool get isStaff => true;
  @override
  bool get hasContainersAccess => false;
  @override
  bool hasBusinessPermission(String permission) => true;
  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.isGetter) return null;
    return super.noSuchMethod(invocation);
  }
}

class _FakeParking implements BusinessParkingService {
  final List<Map<String, dynamic>> contactCalls = [];
  final List<Map<String, dynamic>> entryCalls = [];
  Object? contactError;
  List<String>? changedOverride;

  @override
  Future<BusinessParkingContactResult> updateContact({
    required String businessId,
    required String carId,
    required Map<String, dynamic> changes,
  }) async {
    contactCalls.add({'businessId': businessId, 'carId': carId, ...changes});
    final error = contactError;
    if (error != null) throw error;
    return BusinessParkingContactResult(
      success: true,
      entryId: carId,
      changed: changedOverride ?? changes.keys.toList(),
    );
  }

  @override
  Future<BusinessParkingUpdateResult> updateEntry({
    required String entryId,
    required Map<String, dynamic> changes,
  }) async {
    entryCalls.add(changes);
    return BusinessParkingUpdateResult.fromCallable({
      'success': true,
      'entryId': entryId,
    });
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName}');
}

/// The "Send on WhatsApp" card's service: no message on any car.
class _NoMessages implements ParkingWhatsAppService {
  @override
  Future<ParkingWhatsAppLastStatus?> lastStatus({
    required String businessId,
    required String carId,
  }) async => null;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName}');
}

FirebaseFunctionsException _refusal(String reason) =>
    FirebaseFunctionsException(
      message: 'refused',
      code: 'invalid-argument',
      details: <String, Object?>{'reason': reason},
    );

ParkedCar _car({bool paid = true, String forStaffId = ''}) => ParkedCar(
  id: 'car1',
  trackingCode: 'TRK123',
  ownerName: 'Awa Camara',
  carMake: 'Toyota',
  carModel: 'Corolla',
  carYear: '2018',
  vinNumber: '',
  parkingDate: DateTime(2026, 10, 1),
  parkingEndDate: DateTime(2026, 10, 5),
  paymentFields: {
    'source': 'business',
    'businessId': 'biz1',
    'customerName': 'Awa Camara',
    'customerPhone': '+13475550101',
    'customerEmail': '',
    'carMake': 'Toyota',
    'carModel': 'Corolla',
    'carYear': '2018',
    'vinNumber': '',
    'paymentMethod': 'direct',
    'paymentStatus': paid ? 'succeeded' : 'awaiting_direct_payment',
    if (forStaffId.isNotEmpty) 'forStaffId': forStaffId,
  },
);

Future<void> _pumpScreen(
  WidgetTester tester,
  ParkedCar car,
  _FakeParking parking, {
  bool switchOn = true,
  String lang = 'en',
}) async {
  // An editable form paints ListTiles inside a tinted card, which Flutter's
  // debug check calls out; that is the form's layout, not this test's concern.
  final onError = FlutterError.onError;
  FlutterError.onError = (details) {
    if (details.exceptionAsString().contains('ListTile background color')) {
      return;
    }
    onError?.call(details);
  };
  addTearDown(() => FlutterError.onError = onError);
  tester.view.physicalSize = const Size(400, 3200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: _Auth()),
        ChangeNotifierProvider<LanguageProvider>.value(
          value: LanguageProvider()..setLanguage(lang),
        ),
      ],
      child: MaterialApp(
        locale: Locale(lang),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: ParkedCarDetailsScreen(
          parkedCar: car,
          businessParkingService: parking,
          parkingMessages: Stream.value(const <ParkingMessage>[]),
          parkingWhatsAppEnabled: Stream.value(switchOn),
          parkingWhatsAppService: _NoMessages(),
        ),
      ),
    ),
  );
  // The car catalog loads from assets.
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

final _phoneField = find.byKey(
  const ValueKey<String>('parking-customer-phone'),
);
final _saveButton = find.byKey(const ValueKey<String>('parking-save-entry'));

Future<void> _editPhoneAndSave(WidgetTester tester, String phone) async {
  await tester.enterText(_phoneField, phone);
  await tester.tap(_saveButton);
  await tester.pump();
  await tester.pump();
}

void main() {
  group('the routing rule', () {
    test('only contact fields moved: the contact edit', () {
      expect(
        businessParkingChangesAreContactOnly({'customerPhone': '+1347'}),
        isTrue,
      );
      expect(
        businessParkingChangesAreContactOnly({
          'customerName': 'A',
          'customerPhone': '+1347',
          'customerEmail': 'a@b.co',
        }),
        isTrue,
      );
    });

    test('anything else moved, or nothing: the full edit', () {
      expect(businessParkingChangesAreContactOnly({}), isFalse);
      expect(
        businessParkingChangesAreContactOnly({
          'customerPhone': '+1347',
          'endDate': '2026-10-06T12:00:00',
        }),
        isFalse,
      );
      expect(
        businessParkingChangesAreContactOnly({'carMake': 'Honda'}),
        isFalse,
      );
      expect(
        businessParkingChangesAreContactOnly({'forStaffId': 'u1'}),
        isFalse,
      );
    });

    test('contact changes are the fields that differ, trimmed', () {
      final current = {
        'customerName': 'Awa Camara',
        'customerPhone': '+13475550101',
        'customerEmail': 'awa@example.com',
      };
      expect(
        businessParkingContactChanges(
          current: current,
          name: ' Awa Camara ',
          phone: '+13475550101',
          email: 'AWA@example.com',
        ),
        isEmpty,
      );
      expect(
        businessParkingContactChanges(
          current: current,
          name: 'Awa Diallo',
          phone: ' +224620000000 ',
          email: '',
        ),
        {
          'customerName': 'Awa Diallo',
          'customerPhone': '+224620000000',
          'customerEmail': '',
        },
      );
      // The name falls back to the owner name on an older record.
      expect(
        businessParkingContactChanges(
          current: {'ownerName': 'Awa Camara'},
          name: 'Awa Camara',
          phone: '',
          email: '',
        ),
        isEmpty,
      );
    });

    test('the answer and refusals are read defensively', () {
      final result = BusinessParkingContactResult.fromCallable(
        <Object?, Object?>{
          'success': true,
          'entryId': 'car1',
          'changed': ['customerPhone'],
        },
      );
      expect(result.changed, ['customerPhone']);
      expect(result.phoneChanged, isTrue);
      expect(
        BusinessParkingContactResult.fromCallable('nonsense').changed,
        isEmpty,
      );

      for (final reason in [
        'nothing_to_change',
        'customer_phone_required',
        'customer_name_required',
        'customer_email_invalid',
        'team_car',
        'not_business_entered',
        'car_voided',
      ]) {
        expect(
          businessParkingContactRefusal(<String, Object?>{'reason': reason}),
          reason,
        );
      }
      expect(businessParkingContactRefusal({'reason': 'other'}), '');
      expect(businessParkingContactRefusal(null), '');
    });

    test('the notice follows what the server changed, and the switch', () {
      bool resends(
        List<String> changed, {
        bool switchOn = true,
        bool isTeamCar = false,
        bool isVoided = false,
      }) => parkingContactEditResends(
        changed: changed,
        switchOn: switchOn,
        isTeamCar: isTeamCar,
        isVoided: isVoided,
      );
      expect(resends(['customerPhone']), isTrue);
      expect(resends(['customerName', 'customerEmail']), isFalse);
      expect(resends(['customerPhone'], switchOn: false), isFalse);
      expect(resends(['customerPhone'], isTeamCar: true), isFalse);
      expect(resends(['customerPhone'], isVoided: true), isFalse);
    });
  });

  group('the refusal words', () {
    testWidgets('every refusal reads in English and French', (tester) async {
      for (final (locale, texts) in [
        (
          const Locale('en'),
          {
            'nothing_to_change': 'Nothing was changed.',
            'customer_phone_required': "Enter the customer's phone number.",
            'customer_name_required': "Enter the customer's name.",
            'customer_email_invalid': 'Enter a valid email address.',
            'team_car':
                "A team member's car takes its name and number from the team "
                'member.',
            'not_business_entered':
                'Only cars the business recorded can be changed here.',
            'car_voided': 'This car was voided and can no longer be changed.',
          },
        ),
        (
          const Locale('fr'),
          {
            'customer_name_required': 'Indiquez le nom du client.',
            'team_car':
                'La voiture d’un membre de l’équipe prend le nom et le numéro '
                'de ce membre.',
            'not_business_entered':
                'Seules les voitures enregistrées par l’entreprise peuvent être '
                'modifiées ici.',
          },
        ),
      ]) {
        late AppLocalizations l10n;
        await tester.pumpWidget(
          MaterialApp(
            locale: locale,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Builder(
              builder: (context) {
                l10n = AppLocalizations.of(context)!;
                return const SizedBox();
              },
            ),
          ),
        );
        for (final entry in texts.entries) {
          expect(parkingContactRefusalText(l10n, entry.key), entry.value);
        }
        expect(parkingContactRefusalText(l10n, 'unknown'), isNull);
      }
    });
  });

  group('the details screen', () {
    testWidgets("a paid car's phone can be edited, and says it will resend", (
      tester,
    ) async {
      final parking = _FakeParking();
      await _pumpScreen(tester, _car(), parking);

      // The money is locked, the contact details are not.
      expect(
        find.textContaining('Only the customer\'s name, phone and email'),
        findsOneWidget,
      );
      expect(tester.widget<TextFormField>(_phoneField).enabled, isNot(false));
      expect(
        tester
            .widget<EditableText>(
              find.descendant(
                of: _phoneField,
                matching: find.byType(EditableText),
              ),
            )
            .readOnly,
        isFalse,
      );

      await _editPhoneAndSave(tester, '+224620000000');

      expect(parking.entryCalls, isEmpty);
      expect(parking.contactCalls, hasLength(1));
      expect(parking.contactCalls.single, {
        'businessId': 'biz1',
        'carId': 'car1',
        'customerPhone': '+224620000000',
      });
      expect(
        find.text('Saved. The last message will be resent to the new number.'),
        findsOneWidget,
      );
    });

    testWidgets('no resend notice when the switch is off', (tester) async {
      final parking = _FakeParking();
      await _pumpScreen(tester, _car(), parking, switchOn: false);
      await _editPhoneAndSave(tester, '+224620000000');
      expect(parking.contactCalls, hasLength(1));
      expect(find.textContaining('will be resent'), findsNothing);
      expect(find.text('Record updated successfully!'), findsOneWidget);
    });

    testWidgets('no resend notice when only the name changed', (tester) async {
      final parking = _FakeParking();
      await _pumpScreen(tester, _car(), parking);
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Awa Camara'),
        'Awa D',
      );
      await tester.tap(_saveButton);
      await tester.pump();
      await tester.pump();
      expect(parking.contactCalls.single['customerName'], 'Awa D');
      expect(find.textContaining('will be resent'), findsNothing);
      expect(find.text('Record updated successfully!'), findsOneWidget);
    });

    testWidgets('an unpaid car with only the phone changed also routes there', (
      tester,
    ) async {
      final parking = _FakeParking();
      await _pumpScreen(tester, _car(paid: false), parking);
      await _editPhoneAndSave(tester, '+224620000000');
      expect(parking.entryCalls, isEmpty);
      expect(parking.contactCalls.single['customerPhone'], '+224620000000');
    });

    testWidgets('a refusal reads in words, in French too', (tester) async {
      final parking = _FakeParking()
        ..contactError = _refusal('customer_email_invalid');
      await _pumpScreen(tester, _car(), parking, lang: 'fr');
      await _editPhoneAndSave(tester, '+224620000000');
      expect(find.text('Saisissez une adresse email valide.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a team member\'s paid car stays locked', (tester) async {
      final parking = _FakeParking();
      await _pumpScreen(tester, _car(forStaffId: 'u1'), parking);
      expect(
        find.text(
          'This parking has been paid for and can no longer be edited.',
        ),
        findsOneWidget,
      );
      expect(find.textContaining("Only the customer's name"), findsNothing);
    });
  });
}
