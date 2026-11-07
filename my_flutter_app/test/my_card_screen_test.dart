import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/my_card_screen.dart';
import 'package:my_flutter_app/services/business_card.dart';
import 'package:my_flutter_app/services/business_card_service.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

/// "My card" (docs/BUSINESS_CARDS.md) on screen: the card, the QR, Share,
/// Save contact and the wallet button of the phone's own platform, in
/// English and in French on a 320-wide phone. The `businessCards` callable
/// is answered by a recorder and the share sheet / browser by a fake, so no
/// Firebase is needed. Fake names and numbers only (the repository is
/// public).

const _url = 'https://laawoldigital.com/c/K7M4P2XB';

Map<String, Object?> _mine({
  bool apple = true,
  bool google = true,
  Object? person = const {'name': 'Awa Camara', 'phone': '+13475550142'},
  Map<String, Object?> settings = const {},
}) => {
  'code': 'K7M4P2XB',
  'url': _url,
  'card': {
    'code': 'K7M4P2XB',
    'link': _url,
    'person': person,
    'business': {
      'businessId': 'sahel_auto_sales',
      'name': 'Sahel Auto Sales',
      'phone': '+1 3475550100',
      'website': 'https://www.sahelauto.example/',
      'addressLine1': '12 Example Ave',
      'city': 'Bronx',
      'state': 'NY',
      'postalCode': '10457',
      'logoUrl': '',
      'services': ['carSales', 'carParking', 'barrelShipping'],
    },
    'settings': {'style': 'classic', 'color': 'laawol', ...settings},
  },
  'wallet': {'apple': apple, 'google': google},
};

FirebaseFunctionsException _refusal(String reason) =>
    FirebaseFunctionsException(
      message: reason,
      code: 'failed-precondition',
      details: {'reason': reason},
    );

/// Answers `businessCards` by action, and keeps what was sent.
class _Cards {
  _Cards({Object? Function()? mine, Object? Function(String platform)? wallet})
    : mine = mine ?? (() => _mine()),
      wallet =
          wallet ?? ((platform) => {'url': 'https://example.test/$platform'});

  Object? Function() mine;
  Object? Function(String platform) wallet;
  final List<Map<String, Object?>> log = [];

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    expect(name, 'businessCards');
    log.add(payload);
    if (payload['action'] == 'mine') return mine();
    if (payload['action'] == 'wallet') {
      return wallet(payload['platform']! as String);
    }
    throw StateError('unexpected action ${payload['action']}');
  }

  BusinessCardService service({
    Duration timeout = const Duration(seconds: 5),
  }) => BusinessCardService(caller: call, timeout: timeout);

  int count(String action) => log.where((p) => p['action'] == action).length;
}

class _FakeActions extends MyCardActions {
  _FakeActions({this.opens = true, this.shareFails = false});

  final bool opens;
  final bool shareFails;
  final List<String> shared = [];
  final List<({String fileName, String vcard})> contacts = [];
  final List<Uri> opened = [];

  @override
  Future<void> shareText({
    required String text,
    required String subject,
    Rect? origin,
  }) async {
    if (shareFails) throw StateError('no share sheet');
    shared.add(text);
  }

  @override
  Future<void> shareContactFile({
    required String fileName,
    required String vcard,
    required String subject,
    Rect? origin,
  }) async {
    contacts.add((fileName: fileName, vcard: vcard));
  }

  @override
  Future<bool> open(Uri uri) async {
    opened.add(uri);
    return opens;
  }
}

Future<void> _pump(
  WidgetTester tester,
  _Cards cards, {
  _FakeActions? actions,
  TargetPlatform platform = TargetPlatform.iOS,
  Locale locale = const Locale('en'),
  Size size = const Size(400, 1600),
  Duration timeout = const Duration(seconds: 5),
  bool settle = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: MyCardScreen(
        service: cards.service(timeout: timeout),
        actions: actions ?? _FakeActions(),
        platform: platform,
      ),
    ),
  );
  if (settle) await tester.pumpAndSettle();
}

final _appleButton = find.byKey(const Key('my-card-apple-wallet'));
final _googleButton = find.byKey(const Key('my-card-google-wallet'));

void main() {
  group('the card', () {
    testWidgets('shows loading, then the card, the QR and the buttons', (
      tester,
    ) async {
      final cards = _Cards();
      await _pump(tester, cards, settle: false);
      expect(find.byKey(const Key('my-card-loading')), findsOneWidget);
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('my-card-loading')), findsNothing);
      expect(cards.count('mine'), 1);
      expect(find.text('My card'), findsOneWidget);
      expect(find.text('Sahel Auto Sales'), findsOneWidget);
      // No tagline written: the services in a few words.
      expect(find.text('Car sales · Parking · Shipping'), findsOneWidget);
      expect(find.text('Awa Camara'), findsOneWidget);
      expect(find.text('Direct'), findsOneWidget);
      expect(find.text('(347) 555-0142'), findsOneWidget);
      expect(find.text('Office'), findsOneWidget);
      expect(find.text('(347) 555-0100'), findsOneWidget);
      expect(find.text('sahelauto.example'), findsOneWidget);
      expect(find.text('12 Example Ave, Bronx, NY 10457'), findsOneWidget);
      // No logo: the initials. No role or title anywhere.
      expect(find.byKey(const Key('my-card-initials')), findsOneWidget);
      expect(find.text('SA'), findsOneWidget);
      expect(find.byKey(const Key('my-card-qr')), findsOneWidget);
      expect(find.text('Scan to save my contact'), findsOneWidget);
      expect(find.text('Share'), findsOneWidget);
      expect(find.text('Save contact'), findsOneWidget);
    });

    testWidgets('the QR is large enough to scan from the screen', (
      tester,
    ) async {
      await _pump(tester, _Cards());
      expect(
        tester.getSize(find.byKey(const Key('my-card-qr'))).shortestSide,
        greaterThanOrEqualTo(220),
      );
    });

    testWidgets('a signature card puts the business color in a band', (
      tester,
    ) async {
      await _pump(
        tester,
        _Cards(
          mine: () => _mine(
            settings: {'style': 'signature', 'color': 'navy', 'accent': 'red'},
          ),
        ),
      );
      final band = tester.widget<Container>(
        find.byKey(const Key('my-card-band')),
      );
      expect(band.color, const Color(0xFF0A214A));
    });

    testWidgets('a business\'s own card shows its number only', (tester) async {
      await _pump(tester, _Cards(mine: () => _mine(person: null)));
      expect(find.text('Direct'), findsNothing);
      expect(find.text('Office'), findsOneWidget);
      expect(find.text('(347) 555-0100'), findsOneWidget);
    });

    for (final width in [320.0, 400.0]) {
      testWidgets('in French at ${width.toInt()} wide, nothing overflows', (
        tester,
      ) async {
        await _pump(
          tester,
          _Cards(),
          locale: const Locale('fr'),
          size: Size(width, 1600),
        );
        expect(find.text('Ma carte'), findsOneWidget);
        expect(find.text('Bureau'), findsOneWidget);
        expect(find.text('Direct'), findsOneWidget);
        expect(
          find.text('Vente de voitures · Stationnement · Expédition'),
          findsOneWidget,
        );
        expect(
          find.text('Scannez pour enregistrer mon contact'),
          findsOneWidget,
        );
        expect(find.text('Partager'), findsOneWidget);
        expect(find.text('Enregistrer le contact'), findsOneWidget);
        expect(find.text('Ajouter à Apple Wallet'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('Share and Save contact', () {
    testWidgets('Share sends a sentence with the card\'s link', (tester) async {
      final actions = _FakeActions();
      await _pump(tester, _Cards(), actions: actions);
      await tester.tap(find.byKey(const Key('my-card-share')));
      await tester.pumpAndSettle();
      expect(actions.shared, ['My business card, Awa Camara: $_url']);
    });

    testWidgets('Share in French is in French', (tester) async {
      final actions = _FakeActions();
      await _pump(
        tester,
        _Cards(),
        actions: actions,
        locale: const Locale('fr'),
      );
      await tester.tap(find.byKey(const Key('my-card-share')));
      await tester.pumpAndSettle();
      expect(actions.shared, ['Ma carte de visite, Awa Camara : $_url']);
    });

    testWidgets('a failed share says so instead of failing silently', (
      tester,
    ) async {
      await _pump(tester, _Cards(), actions: _FakeActions(shareFails: true));
      await tester.tap(find.byKey(const Key('my-card-share')));
      await tester.pumpAndSettle();
      expect(
        find.text('We could not share your card. Try again.'),
        findsOneWidget,
      );
    });

    testWidgets('Save contact hands over the vCard as awa-camara.vcf', (
      tester,
    ) async {
      final actions = _FakeActions();
      await _pump(tester, _Cards(), actions: actions);
      await tester.tap(find.byKey(const Key('my-card-save-contact')));
      await tester.pumpAndSettle();
      expect(actions.contacts, hasLength(1));
      expect(actions.contacts.single.fileName, 'awa-camara.vcf');
      final vcard = actions.contacts.single.vcard;
      expect(vcard, startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n'));
      expect(vcard, contains('FN:Awa Camara'));
      expect(vcard, contains('TEL;TYPE=CELL:+13475550142'));
      expect(vcard, contains('TEL;TYPE=WORK:+13475550100'));
    });
  });

  group('wallet buttons', () {
    testWidgets('iOS with Apple on: only Add to Apple Wallet', (tester) async {
      await _pump(tester, _Cards(), platform: TargetPlatform.iOS);
      expect(_appleButton, findsOneWidget);
      expect(find.text('Add to Apple Wallet'), findsOneWidget);
      expect(_googleButton, findsNothing);
      expect(find.text('Add to Google Wallet'), findsNothing);
    });

    testWidgets('Android with Google on: only Add to Google Wallet', (
      tester,
    ) async {
      await _pump(tester, _Cards(), platform: TargetPlatform.android);
      expect(_googleButton, findsOneWidget);
      expect(find.text('Add to Google Wallet'), findsOneWidget);
      expect(_appleButton, findsNothing);
    });

    for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
      testWidgets('no wallet button when the server cannot make a pass '
          '($platform)', (tester) async {
        await _pump(
          tester,
          _Cards(mine: () => _mine(apple: false, google: false)),
          platform: platform,
        );
        expect(find.text('Share'), findsOneWidget);
        expect(_appleButton, findsNothing);
        expect(_googleButton, findsNothing);
      });
    }

    testWidgets('an Apple flag alone shows nothing on Android', (tester) async {
      await _pump(
        tester,
        _Cards(mine: () => _mine(apple: true, google: false)),
        platform: TargetPlatform.android,
      );
      expect(_appleButton, findsNothing);
      expect(_googleButton, findsNothing);
    });

    testWidgets('a Google flag alone shows nothing on iOS', (tester) async {
      await _pump(
        tester,
        _Cards(mine: () => _mine(apple: false, google: true)),
        platform: TargetPlatform.iOS,
      );
      expect(_appleButton, findsNothing);
      expect(_googleButton, findsNothing);
    });

    testWidgets('tapping Apple asks for an apple pass and opens its link', (
      tester,
    ) async {
      final cards = _Cards();
      final actions = _FakeActions();
      await _pump(tester, cards, actions: actions);
      await tester.tap(_appleButton);
      await tester.pumpAndSettle();
      expect(cards.log.last, {'action': 'wallet', 'platform': 'apple'});
      expect(actions.opened, [Uri.parse('https://example.test/apple')]);
    });

    testWidgets('tapping Google asks for a google pass', (tester) async {
      final cards = _Cards(
        wallet: (_) => {'url': 'https://pay.google.com/gp/v/save/abc'},
      );
      final actions = _FakeActions();
      await _pump(
        tester,
        cards,
        actions: actions,
        platform: TargetPlatform.android,
      );
      await tester.tap(_googleButton);
      await tester.pumpAndSettle();
      expect(cards.log.last, {'action': 'wallet', 'platform': 'google'});
      expect(actions.opened.single.host, 'pay.google.com');
    });

    testWidgets('wallet_not_ready is a friendly message, not an error page', (
      tester,
    ) async {
      final cards = _Cards(wallet: (_) => throw _refusal('wallet_not_ready'));
      await _pump(tester, cards);
      await tester.tap(_appleButton);
      await tester.pumpAndSettle();
      expect(
        find.text('Wallet cards are not available yet. Try again later.'),
        findsOneWidget,
      );
      // The card is still there.
      expect(find.text('Awa Camara'), findsOneWidget);
    });

    testWidgets('a link that does not open says so', (tester) async {
      final actions = _FakeActions(opens: false);
      await _pump(tester, _Cards(), actions: actions);
      await tester.tap(_appleButton);
      await tester.pumpAndSettle();
      expect(
        find.text('We could not open your wallet card. Try again.'),
        findsOneWidget,
      );
    });

    testWidgets('a second tap while the link is fetched does nothing', (
      tester,
    ) async {
      final pending = Completer<Object?>();
      final cards = _Cards(wallet: (_) => pending.future);
      final actions = _FakeActions();
      await _pump(tester, cards, actions: actions);
      await tester.tap(_appleButton);
      await tester.pump();
      await tester.tap(_appleButton);
      await tester.pump();
      expect(cards.count('wallet'), 1);
      pending.complete({'url': 'https://example.test/apple'});
      await tester.pumpAndSettle();
      expect(actions.opened, hasLength(1));
      // Free again afterwards.
      await tester.tap(_appleButton);
      await tester.pumpAndSettle();
      expect(cards.count('wallet'), 2);
    });
  });

  group('errors always resolve', () {
    testWidgets('a failed load shows an error with a Retry that works', (
      tester,
    ) async {
      var fail = true;
      final cards = _Cards(
        mine: () {
          if (fail) throw _refusal('something_else');
          return _mine();
        },
      );
      await _pump(tester, cards);
      expect(find.byKey(const Key('my-card-error')), findsOneWidget);
      expect(
        find.text('We could not load your card. Try again.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('my-card-loading')), findsNothing);
      fail = false;
      await tester.tap(find.byKey(const Key('my-card-retry')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('my-card-error')), findsNothing);
      expect(find.text('Awa Camara'), findsOneWidget);
      expect(cards.count('mine'), 2);
    });

    testWidgets('a call that never answers times out into the error state', (
      tester,
    ) async {
      final cards = _Cards(mine: () => Completer<Object?>().future);
      await _pump(
        tester,
        cards,
        timeout: const Duration(milliseconds: 200),
        settle: false,
      );
      expect(find.byKey(const Key('my-card-loading')), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pump();
      expect(find.byKey(const Key('my-card-loading')), findsNothing);
      expect(find.byKey(const Key('my-card-error')), findsOneWidget);
      expect(find.byKey(const Key('my-card-retry')), findsOneWidget);
    });

    testWidgets('not on a team: explained, with no pointless Retry', (
      tester,
    ) async {
      final cards = _Cards(mine: () => throw _refusal('not_team_member'));
      await _pump(tester, cards);
      expect(
        find.text(
          'Your account is not on a business team, so there is no card to show.',
        ),
        findsOneWidget,
      );
      expect(find.byKey(const Key('my-card-retry')), findsNothing);
    });

    testWidgets('business not approved: explained, no Retry, in French too', (
      tester,
    ) async {
      final cards = _Cards(mine: () => throw _refusal('business_not_approved'));
      await _pump(tester, cards);
      expect(find.text('Your business is not approved yet.'), findsOneWidget);
      expect(find.byKey(const Key('my-card-retry')), findsNothing);
    });

    testWidgets('an unknown refusal is a generic error with Retry', (
      tester,
    ) async {
      final cards = _Cards(mine: () => throw _refusal('brand_new_reason'));
      await _pump(tester, cards, locale: const Locale('fr'));
      expect(
        find.text("Nous n'avons pas pu charger votre carte. Réessayez."),
        findsOneWidget,
      );
      expect(find.byKey(const Key('my-card-retry')), findsOneWidget);
    });

    testWidgets('an unreadable answer is an error, not a blank screen', (
      tester,
    ) async {
      await _pump(tester, _Cards(mine: () => {'oops': true}));
      expect(find.byKey(const Key('my-card-error')), findsOneWidget);
    });

    testWidgets('offline reads as a connection problem, in French too', (
      tester,
    ) async {
      final cards = _Cards(
        mine: () => throw FirebaseFunctionsException(
          message: 'offline',
          code: 'unavailable',
        ),
      );
      await _pump(tester, cards, locale: const Locale('fr'));
      expect(
        find.text('Pas de connexion. Vérifiez votre internet et réessayez.'),
        findsOneWidget,
      );
    });
  });

  group('who has a card', () {
    test('owners and staff of a business; nobody else', () {
      bool has({bool owner = false, bool staff = false, String? id}) =>
          hasOwnBusinessCard(
            isBusinessOwner: owner,
            isStaff: staff,
            businessId: id,
          );
      expect(has(owner: true, id: 'biz-1'), isTrue);
      expect(has(staff: true, id: 'biz-1'), isTrue);
      // A customer, and an admin with no business.
      expect(has(id: 'biz-1'), isFalse);
      expect(has(owner: true), isFalse);
      expect(has(staff: true, id: ''), isFalse);
    });
  });
}
