import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_card.dart';

/// The Dart half of business cards (docs/BUSINESS_CARDS.md): the same
/// phone, name, tagline and vCard rules as `admin_web/src/lib/business-card.ts`,
/// and the server's `mine` answer read into a card. Fake names and numbers
/// only (the repository is public).

Map<String, Object?> _cardJson({
  Object? person = const {'name': 'Awa Camara', 'phone': '+13475550142'},
  Map<String, Object?> business = const {},
  Map<String, Object?> settings = const {},
}) => {
  'code': 'K7M4P2XB',
  'link': 'https://laawoldigital.com/c/K7M4P2XB',
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
    'requestSlug': 'sahel',
    'services': ['carSales', 'carParking', 'barrelShipping', 'sharedBarrels'],
    ...business,
  },
  'settings': {'style': 'classic', 'color': 'laawol', ...settings},
};

BusinessCardData _sample({
  Object? person = const {'name': 'Awa Camara', 'phone': '+13475550142'},
  Map<String, Object?> business = const {},
  Map<String, Object?> settings = const {},
}) => BusinessCardData.fromCallable(
  _cardJson(person: person, business: business, settings: settings),
)!;

void main() {
  group('phones print US style', () {
    test('a US number in any typing', () {
      expect(cardPhoneDisplay('+13475550142'), '(347) 555-0142');
      expect(cardPhoneDial('+13475550142'), '+13475550142');
      expect(cardPhoneDisplay('+1 3475550100'), '(347) 555-0100');
      expect(cardPhoneDisplay('347 555 0142'), '(347) 555-0142');
      expect(cardPhoneDial('347 555 0142'), '+13475550142');
      expect(cardPhoneDisplay('1 (347) 555-0142'), '(347) 555-0142');
      expect(cardPhoneDisplay('(347) 555-0142'), '(347) 555-0142');
    });

    test('the country code typed twice is still the US number', () {
      expect(cardPhoneDisplay('+1 13475550142'), '(347) 555-0142');
      expect(cardPhoneDial('+1 13475550142'), '+13475550142');
    });

    test('another country keeps its own form', () {
      expect(cardPhoneDisplay('+224 622 00 11 22'), '+224 622 00 11 22');
      expect(cardPhoneDial('+224 622 00 11 22'), '+224622001122');
      expect(cardPhoneDisplay('622 00 11 22'), '622 00 11 22');
      expect(cardPhoneDial('622 00 11 22'), '622001122');
    });

    test('nothing to show for an empty or too-short number', () {
      expect(cardPhoneDisplay(''), '');
      expect(cardPhoneDisplay(null), '');
      expect(cardPhoneDisplay('12'), '');
      expect(cardPhoneDial('12'), '');
    });
  });

  group('names get their capitals', () {
    test('all capitals or all small letters, one capital per word', () {
      expect(cardName('SAHEL AUTO SALES'), 'Sahel Auto Sales');
      expect(cardName('awa camara'), 'Awa Camara');
      expect(cardName("  jean-pierre  o'neil "), "Jean-Pierre O'Neil");
      expect(cardName("ÉLISE N'DIAYE"), "Élise N'Diaye");
      expect(cardName('B&B CARGO'), 'B&B Cargo');
    });

    test('a name with its own mix of cases is left alone', () {
      expect(cardName('DHL Express'), 'DHL Express');
      expect(cardName('McDonald Shipping'), 'McDonald Shipping');
      expect(cardName(''), '');
      expect(cardName('2024'), '2024');
    });
  });

  group('the words on a card', () {
    test('the tagline is the owner\'s, else the services in the language', () {
      final card = _sample();
      expect(cardTagline(card, 'en'), 'Car sales · Parking · Shipping');
      expect(
        cardTagline(card, 'fr'),
        'Vente de voitures · Stationnement · Expédition',
      );
      expect(
        cardTagline(_sample(settings: {'tagline': 'Cars you can trust'}), 'fr'),
        'Cars you can trust',
      );
      expect(cardTagline(_sample(business: {'services': []}), 'en'), '');
    });

    test('the address, from the parts filled in', () {
      expect(
        cardAddress(_sample().business),
        '12 Example Ave, Bronx, NY 10457',
      );
      expect(
        cardAddress(
          _sample(
            business: {'addressLine1': '', 'state': '', 'postalCode': ''},
          ).business,
        ),
        'Bronx',
      );
    });

    test(
      'Direct is the person\'s number, Office the business\'s, once each',
      () {
        final rows = cardPhoneRows(_sample());
        expect(rows.map((r) => (r.label, r.number)), [
          ('direct', '(347) 555-0142'),
          ('office', '(347) 555-0100'),
        ]);
        // The same number twice is shown once.
        expect(
          cardPhoneRows(
            _sample(person: {'name': 'Yao', 'phone': '(347) 555-0100'}),
          ).length,
          1,
        );
        // A business's own card has only its number.
        expect(cardPhoneRows(_sample(person: null)).map((r) => r.label), [
          'office',
        ]);
      },
    );

    test('initials for a business with no logo', () {
      expect(cardInitials('Sahel Auto Sales'), 'SA');
      expect(cardInitials('acme'), 'A');
    });
  });

  group('Save contact (vCard 3.0)', () {
    test('a person\'s card, exactly as the web writes it', () {
      expect(
        cardVcard(_sample()),
        [
          'BEGIN:VCARD',
          'VERSION:3.0',
          'N:Camara;Awa;;;',
          'FN:Awa Camara',
          'ORG:Sahel Auto Sales',
          'TEL;TYPE=CELL:+13475550142',
          'TEL;TYPE=WORK:+13475550100',
          'URL:https://sahelauto.example',
          'ADR;TYPE=WORK:;;12 Example Ave;Bronx;NY;10457;',
          'NOTE:https://laawoldigital.com/c/K7M4P2XB',
          'END:VCARD',
          '',
        ].join('\r\n'),
      );
      expect(cardVcardFileName(_sample()), 'awa-camara.vcf');
    });

    test('a business card is a company and odd characters cannot break it', () {
      final card = _sample(
        person: null,
        business: {'name': 'Diallo; Frères, SARL'},
      );
      final text = cardVcard(card);
      expect(
        text,
        contains(
          r'FN:Diallo\; Frères\, SARL'
          '\r\n',
        ),
      );
      expect(text, contains('X-ABShowAs:COMPANY\r\n'));
      expect(text, isNot(contains('TYPE=CELL')));
      expect(cardVcardFileName(card), 'diallo-freres-sarl.vcf');
    });

    test('one number is written once', () {
      final text = cardVcard(
        _sample(person: {'name': 'Yao', 'phone': '(347) 555-0100'}),
      );
      expect('TEL;'.allMatches(text).length, 1);
    });
  });

  group('the answer of `mine`', () {
    test('reads the code, the link, the card and the wallet flags', () {
      final mine = MyCard.fromCallable({
        'code': 'K7M4P2XB',
        'url': 'https://laawoldigital.com/c/K7M4P2XB',
        'card': _cardJson(),
        'wallet': {'apple': true, 'google': false},
      })!;
      expect(mine.url, 'https://laawoldigital.com/c/K7M4P2XB');
      expect(mine.card.code, 'K7M4P2XB');
      expect(mine.card.person!.name, 'Awa Camara');
      expect(mine.card.business.name, 'Sahel Auto Sales');
      expect(mine.appleWallet, isTrue);
      expect(mine.googleWallet, isFalse);
    });

    test('a missing wallet block means no wallet buttons', () {
      final mine = MyCard.fromCallable({
        'code': 'K7M4P2XB',
        'url': 'https://laawoldigital.com/c/K7M4P2XB',
        'card': _cardJson(),
      })!;
      expect(mine.appleWallet, isFalse);
      expect(mine.googleWallet, isFalse);
    });

    test('whatever the server sends, a card still draws (or is refused)', () {
      expect(MyCard.fromCallable(null), isNull);
      expect(MyCard.fromCallable({'code': 'nope', 'card': {}}), isNull);
      final settings = CardSettings.fromCallable({
        'style': 'neon',
        'color': 3,
        'services': 'x',
      });
      expect(settings.style, 'classic');
      expect(settings.color, 'laawol');
      expect(settings.services, isEmpty);
      final signature = _sample(
        settings: {'style': 'signature', 'color': 'navy', 'accent': 'blue'},
      ).settings;
      expect(signature.isSignature, isTrue);
      expect(signature.colorValue, 0xFF0A214A);
      expect(signature.accentValue, 0xFF1D4ED8);
    });

    test('names and addresses typed in capitals are printed with capitals', () {
      final card = _sample(
        person: {'name': 'AWA CAMARA', 'phone': '3475550142'},
        business: {'addressLine1': '12 EXAMPLE AVE', 'name': 'sahel auto'},
      );
      expect(card.person!.name, 'Awa Camara');
      expect(card.business.name, 'Sahel Auto');
      expect(card.business.addressLine1, '12 Example Ave');
    });
  });

  group('the QR', () {
    test('is coarse enough to scan from a screen and is stable', () {
      final qr = cardQrMatrix('https://laawoldigital.com/c/K7M4P2XB');
      expect(qr.size, lessThanOrEqualTo(33));
      // The three corner eyes (finder patterns) are dark at their corners.
      expect(qr.dark(0, 0), isTrue);
      expect(qr.dark(0, qr.size - 1), isTrue);
      expect(qr.dark(qr.size - 1, 0), isTrue);
      expect(
        cardQrMatrix('https://laawoldigital.com/c/K7M4P2XB').toRows(),
        qr.toRows(),
      );
    });
  });

  test('the choices a business may make are the server\'s, word for word', () {
    final server = File('functions/business_cards.js').readAsStringSync();
    List<String> list(String name) {
      final match = RegExp(
        'const $name = Object\\.freeze\\(\\[([^\\]]+)\\]\\)',
      ).firstMatch(server);
      expect(match, isNotNull, reason: '$name moved in business_cards.js');
      return RegExp(
        '"([^"]+)"',
      ).allMatches(match!.group(1)!).map((m) => m.group(1)!).toList();
    }

    expect(list('CARD_STYLES'), cardStyles);
    expect(list('CARD_COLORS'), cardColors.keys.toList());
    expect(list('CARD_ACCENTS'), cardAccents.keys.toList());
    expect(
      RegExp('CARD_LINK_BASE = "([^"]+)"').firstMatch(server)!.group(1),
      cardLinkBase,
    );
  });
}
