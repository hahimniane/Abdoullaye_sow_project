import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/my_card_screen.dart';
import 'package:my_flutter_app/screens/team_cards_screen.dart';
import 'package:my_flutter_app/services/business_card.dart';
import 'package:my_flutter_app/services/business_card_service.dart';

/// Team cards (docs/BUSINESS_CARDS.md): the business's cards, "How your cards
/// look" and a colleague's numbers. The `businessCards` callable is a
/// recorder; the share sheet and browser are a fake. Fake names and numbers
/// only (the repository is public).

const _bizCode = 'BCDFGHJK';
const _meCode = 'MNPQRSTV';
const _kofiCode = 'WXYZ2345';

Map<String, Object?> _card(
  String code, {
  Map<String, Object?>? person,
  String uid = '',
  bool mine = false,
  bool canEditPhones = false,
  Map<String, Object?> settings = const {},
}) => {
  'code': code,
  'link': 'https://laawoldigital.com/c/$code',
  'person': ?person,
  'business': {
    'businessId': 'sahel',
    'name': 'Sahel Auto Sales',
    'phone': '+1 3475550100',
    'services': ['carSales', 'carParking'],
  },
  'settings': {'style': 'classic', 'color': 'laawol', ...settings},
  'uid': uid,
  'mine': mine,
  'canEditPhones': canEditPhones,
};

Map<String, Object?> _list({
  bool canEdit = true,
  Map<String, Object?> settings = const {},
}) => {
  'version': 1,
  'canEdit': canEdit,
  'settings': {'style': 'classic', 'color': 'laawol', ...settings},
  'cards': [
    _card(_bizCode),
    _card(
      _meCode,
      person: {'name': 'Awa Camara', 'phone': '+13475550142'},
      uid: 'me',
      mine: true,
      canEditPhones: true,
    ),
    _card(
      _kofiCode,
      person: {'name': 'Kofi Mensah', 'phone': '', 'phones': <Object?>[]},
      uid: 'kofi',
      canEditPhones: true,
    ),
  ],
};

class _Cards {
  final log = <Map<String, Object?>>[];
  Object? Function(Map<String, Object?> payload)? respond;
  Map<String, Object?> Function() list = _list;

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    log.add(payload);
    final custom = respond;
    if (custom != null) {
      final r = custom(payload);
      if (r != null) return r;
    }
    switch (payload['action']) {
      case 'list':
        return list();
      case 'saveSettings':
        return {'version': 1, 'settings': payload['settings']};
      case 'savePhones':
        return {'version': 1, 'phones': payload['phones']};
    }
    return {};
  }

  List<Map<String, Object?>> sent(String action) => [
    for (final p in log)
      if (p['action'] == action) p,
  ];

  BusinessCardService get service =>
      BusinessCardService(caller: call, timeout: const Duration(seconds: 2));
}

class _Actions extends MyCardActions {
  final shared = <String>[];
  final opened = <Uri>[];
  bool openResult = true;

  @override
  Future<void> shareText({
    required String text,
    required String subject,
    Rect? origin,
  }) async => shared.add(text);

  @override
  Future<bool> open(Uri uri) async {
    opened.add(uri);
    return openResult;
  }
}

FirebaseFunctionsException _refusal(
  String code,
  String reason, {
  List<String> reasons = const [],
}) => FirebaseFunctionsException(
  message: reason,
  code: code,
  details: {'reason': reason, if (reasons.isNotEmpty) 'reasons': reasons},
);

Future<_Actions> _pump(
  WidgetTester tester,
  _Cards cards, {
  Locale locale = const Locale('en'),
  Size size = const Size(800, 3000),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final actions = _Actions();
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: TeamCardsScreen(
        businessId: 'sahel',
        service: cards.service,
        actions: actions,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return actions;
}

Future<void> _show(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

Future<void> _tap(WidgetTester tester, String key) async {
  await _show(tester, key);
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

void main() {
  group('the rules', () {
    test('settings keep the picture and send the whole choice', () {
      final s = CardSettings.fromCallable({
        'style': 'signature',
        'color': 'navy',
        'accent': 'blue',
        'photo': 'car',
        'tagline': '  Cars  ',
        'services': ['A', ' ', 'B'],
      });
      expect(s.photo, 'car');
      expect(s.toCallable(), {
        'style': 'signature',
        'color': 'navy',
        'accent': 'blue',
        'photo': 'car',
        'tagline': 'Cars',
        'services': ['A', 'B'],
      });
      expect(CardSettings.fromCallable({'photo': 'cat'}).photo, 'none');
      expect(const CardSettings().toCallable()['photo'], 'none');
    });

    test('a look is checked before it is sent', () {
      expect(cardLookProblem(tagline: 'ok', servicesText: 'a\nb'), '');
      expect(
        cardLookProblem(tagline: 'x' * 61, servicesText: ''),
        'tagline_too_long',
      );
      expect(
        cardLookProblem(
          tagline: '',
          servicesText: List.filled(7, 'a').join('\n'),
        ),
        'services_too_many',
      );
      expect(
        cardLookProblem(tagline: '', servicesText: 'a' * 41),
        'service_too_long',
      );
      expect(cardServiceLines('  a  b \n\n c\n'), ['a b', 'c']);
    });

    test('the list reads the flags and skips what is not a card', () {
      final raw = _list()
        ..['cards'] = [
          ...(_list()['cards']! as List),
          {'code': 'bad'},
          'nope',
        ];
      final list = BusinessCardList.fromCallable(raw);
      expect(list.canEdit, isTrue);
      expect(list.cards.map((c) => c.card.code), [
        _bizCode,
        _meCode,
        _kofiCode,
      ]);
      expect(list.cards.first.isBusiness, isTrue);
      expect(list.cards[1].mine, isTrue);
      expect(list.cards[2].canEditPhones, isTrue);
      expect(list.cards[2].uid, 'kofi');
      expect(BusinessCardList.fromCallable(null).cards, isEmpty);
    });

    test('numbers and look replace in place', () {
      final list = BusinessCardList.fromCallable(_list());
      final withPhones = list.withPhones(_kofiCode, const [
        CardPhone(label: 'WhatsApp', phone: '+224621234567'),
      ]);
      expect(withPhones.cards[2].card.person!.phones.single.label, 'WhatsApp');
      expect(withPhones.cards[1].card.person!.phones, isEmpty);
      final styled = list.withSettings(const CardSettings(color: 'navy'));
      expect(
        styled.cards.every((c) => c.card.settings.color == 'navy'),
        isTrue,
      );
    });

    test('the service asks, saves the look, and saves a colleague', () async {
      final cards = _Cards();
      final s = cards.service;
      await s.list('sahel');
      final saved = await s.saveSettings(
        'sahel',
        const CardSettings(color: 'navy', tagline: 'Cars'),
      );
      expect(saved.color, 'navy');
      await s.savePhones(const [CardPhone(phone: '+224621234567')]);
      await s.savePhones(
        const [CardPhone(label: 'Work', phone: '+224621234567')],
        uid: 'kofi',
        businessId: 'sahel',
      );
      expect(cards.sent('list').single, {
        'action': 'list',
        'businessId': 'sahel',
      });
      expect(cards.sent('saveSettings').single['settings'], isA<Map>());
      // Your own numbers carry no uid; a colleague's carries uid and business.
      final phones = cards.sent('savePhones');
      expect(phones.first.containsKey('uid'), isFalse);
      expect(phones.last['uid'], 'kofi');
      expect(phones.last['businessId'], 'sahel');
    });

    test('an owner-only refusal and its reasons are read', () async {
      final cards = _Cards()
        ..respond = (p) => p['action'] == 'saveSettings'
            ? throw _refusal('permission-denied', 'owner_only')
            : null;
      await expectLater(
        cards.service.saveSettings('sahel', const CardSettings()),
        throwsA(
          isA<BusinessCardFailure>().having((f) => f.ownerOnly, 'o', true),
        ),
      );
      final many = _Cards()
        ..respond = (p) => throw _refusal(
          'invalid-argument',
          '',
          reasons: ['services_too_many'],
        );
      await expectLater(
        many.service.saveSettings('sahel', const CardSettings()),
        throwsA(
          isA<BusinessCardFailure>().having(
            (f) => f.hasReason('services_too_many'),
            'r',
            true,
          ),
        ),
      );
    });
  });

  group('the screen', () {
    testWidgets('shows the business card first and every team card', (
      tester,
    ) async {
      final cards = _Cards();
      await _pump(tester, cards);
      expect(find.text("The business's card"), findsOneWidget);
      expect(find.text('Your card'), findsOneWidget);
      expect(find.text('Team card'), findsOneWidget);
      expect(find.text('Awa Camara'), findsWidgets);
      expect(find.text('Kofi Mensah'), findsWidgets);
      expect(cards.sent('list').single['businessId'], 'sahel');
      // Kofi has no number of his own.
      expect(
        find.byKey(const Key('team-card-no-number-$_kofiCode')),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('team-card-no-number-$_meCode')),
        findsNothing,
      );
    });

    testWidgets('Share, Copy link and Open work on a card', (tester) async {
      String? clipboard;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            clipboard = (call.arguments as Map)['text'] as String?;
          }
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );
      final actions = await _pump(tester, _Cards());
      await _tap(tester, 'team-card-share-$_kofiCode');
      expect(
        actions.shared.single,
        contains('https://laawoldigital.com/c/$_kofiCode'),
      );
      await _tap(tester, 'team-card-copy-$_kofiCode');
      expect(clipboard, 'https://laawoldigital.com/c/$_kofiCode');
      expect(find.text('Link copied'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
      await _tap(tester, 'team-card-open-$_kofiCode');
      expect(
        actions.opened.single.toString(),
        'https://laawoldigital.com/c/$_kofiCode',
      );
    });

    testWidgets('an Open that does nothing says so', (tester) async {
      final actions = await _pump(tester, _Cards());
      actions.openResult = false;
      await _tap(tester, 'team-card-open-$_bizCode');
      expect(
        find.text('We could not open the card. Try again.'),
        findsOneWidget,
      );
    });

    testWidgets('the owner saves how the cards look, picture kept', (
      tester,
    ) async {
      final cards = _Cards()..list = () => _list(settings: {'photo': 'car'});
      await _pump(tester, cards);
      await _tap(tester, 'card-look-style-signature');
      await _tap(tester, 'card-look-color-navy');
      await _tap(tester, 'card-look-accent-blue');
      await _show(tester, 'card-look-tagline');
      await tester.enterText(
        find.byKey(const Key('card-look-tagline')),
        'Cars and parking',
      );
      await _show(tester, 'card-look-services');
      await tester.enterText(
        find.byKey(const Key('card-look-services')),
        'Car sales\nParking',
      );
      await _tap(tester, 'card-look-save');
      expect(cards.sent('saveSettings').single['settings'], {
        'style': 'signature',
        'color': 'navy',
        'accent': 'blue',
        'photo': 'car',
        'tagline': 'Cars and parking',
        'services': ['Car sales', 'Parking'],
      });
      expect(find.text('Card saved.'), findsOneWidget);
    });

    testWidgets('a look the server refuses is said in words', (tester) async {
      final cards = _Cards()
        ..respond = (p) => p['action'] == 'saveSettings'
            ? throw _refusal('permission-denied', 'owner_only')
            : null;
      await _pump(tester, cards);
      await _tap(tester, 'card-look-save');
      expect(
        find.text('Only the business owner can change how the cards look.'),
        findsOneWidget,
      );
    });

    testWidgets('too many services is caught before sending', (tester) async {
      final cards = _Cards();
      await _pump(tester, cards);
      await _tap(tester, 'card-look-style-signature');
      await _show(tester, 'card-look-services');
      await tester.enterText(
        find.byKey(const Key('card-look-services')),
        List.filled(7, 'x').join('\n'),
      );
      await _tap(tester, 'card-look-save');
      expect(find.text('List six services at most.'), findsOneWidget);
      expect(cards.sent('saveSettings'), isEmpty);
    });

    testWidgets('the look is hidden from someone who cannot change it', (
      tester,
    ) async {
      final cards = _Cards()..list = () => _list(canEdit: false);
      await _pump(tester, cards);
      expect(find.byKey(const Key('card-look')), findsNothing);
      expect(find.text('How your cards look'), findsNothing);
      expect(
        find.byKey(const Key('team-card-share-$_bizCode')),
        findsOneWidget,
      );
    });

    testWidgets("a colleague's numbers are saved with their uid", (
      tester,
    ) async {
      final cards = _Cards();
      await _pump(tester, cards);
      await _tap(tester, 'team-card-phones-$_kofiCode');
      expect(find.text('Numbers on this card'), findsOneWidget);
      await tester.enterText(
        find.byKey(const Key('my-card-phone-number-0')),
        '+224 621 23 45 67',
      );
      await tester.enterText(
        find.byKey(const Key('my-card-phone-label-0')),
        'Guinea',
      );
      await _tap(tester, 'my-card-phones-save');
      final sent = cards.sent('savePhones').single;
      expect(sent['uid'], 'kofi');
      expect(sent['businessId'], 'sahel');
      expect(sent['phones'], [
        {'label': 'Guinea', 'phone': '+224 621 23 45 67'},
      ]);
      expect(find.text('The numbers are saved.'), findsOneWidget);
      expect(find.text('Edit numbers'), findsOneWidget);
    });

    testWidgets('your own numbers carry no uid', (tester) async {
      final cards = _Cards();
      await _pump(tester, cards);
      await _tap(tester, 'team-card-phones-$_meCode');
      await tester.enterText(
        find.byKey(const Key('my-card-phone-number-0')),
        '(929) 555-0101',
      );
      await _tap(tester, 'my-card-phones-save');
      expect(cards.sent('savePhones').single.containsKey('uid'), isFalse);
    });

    testWidgets("a colleague's numbers the server refuses are said in words", (
      tester,
    ) async {
      final cards = _Cards()
        ..respond = (p) => p['action'] == 'savePhones'
            ? throw _refusal('permission-denied', 'not_allowed')
            : null;
      await _pump(tester, cards);
      await _tap(tester, 'team-card-phones-$_kofiCode');
      await tester.enterText(
        find.byKey(const Key('my-card-phone-number-0')),
        '(929) 555-0101',
      );
      await _tap(tester, 'my-card-phones-save');
      expect(
        find.text("You cannot change this person's numbers."),
        findsOneWidget,
      );
      expect(find.byKey(const Key('my-card-phones-page')), findsOneWidget);
    });

    testWidgets('no edit button where the server does not allow it', (
      tester,
    ) async {
      final cards = _Cards()
        ..list = () {
          final l = _list();
          final rows = (l['cards']! as List).cast<Map<String, Object?>>();
          rows[2]['canEditPhones'] = false;
          return l;
        };
      await _pump(tester, cards);
      expect(
        find.byKey(const Key('team-card-phones-$_kofiCode')),
        findsNothing,
      );
      expect(
        find.byKey(const Key('team-card-phones-$_meCode')),
        findsOneWidget,
      );
    });

    testWidgets('a failed load says so and Try again loads', (tester) async {
      var fail = true;
      final cards = _Cards()
        ..respond = (p) => fail ? throw _refusal('internal', '') : null;
      await _pump(tester, cards);
      expect(find.text('The cards did not load. Try again.'), findsOneWidget);
      fail = false;
      await _tap(tester, 'team-cards-retry');
      expect(find.byKey(const Key('team-cards-error')), findsNothing);
      expect(find.text("The business's card"), findsOneWidget);
    });

    testWidgets('a permission refusal on load is said in words', (
      tester,
    ) async {
      final cards = _Cards()
        ..respond = (p) => throw _refusal('permission-denied', 'not_allowed');
      await _pump(tester, cards);
      expect(find.text("You cannot see the team's cards."), findsOneWidget);
    });

    testWidgets('a load that never answers resolves', (tester) async {
      tester.view.physicalSize = const Size(800, 3000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: TeamCardsScreen(
            businessId: 'sahel',
            service: BusinessCardService(
              caller: (_, _) => Completer<Object?>().future,
              timeout: const Duration(milliseconds: 50),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle(const Duration(seconds: 1));
      expect(find.byKey(const Key('team-cards-loading')), findsNothing);
      expect(find.byKey(const Key('team-cards-error')), findsOneWidget);
    });

    testWidgets('French at 320 px wide does not overflow', (tester) async {
      final cards = _Cards()
        ..list = () => _list(settings: {'style': 'signature'});
      await _pump(
        tester,
        cards,
        locale: const Locale('fr'),
        size: const Size(320, 4000),
      );
      expect(find.text("L'apparence de vos cartes"), findsOneWidget);
      expect(find.text('Copier le lien'), findsWidgets);
      await _tap(tester, 'card-look-style-signature');
      await _show(tester, 'card-look-services');
      await _show(tester, 'team-card-phones-$_kofiCode');
      expect(tester.takeException(), isNull);
      await _tap(tester, 'team-card-phones-$_kofiCode');
      expect(find.text('Numéros sur cette carte'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
