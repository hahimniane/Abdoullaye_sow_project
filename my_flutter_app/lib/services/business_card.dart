/// Business cards in the app (docs/BUSINESS_CARDS.md): everything about a
/// card that is not a drawing or a network call. Every business and each
/// person on its team has one card, known by a short code; the QR carries
/// `https://laawoldigital.com/c/<code>` and the page it opens reads the card
/// fresh from the server.
///
/// This is the Dart twin of `admin_web/src/lib/business-card.ts` (phones,
/// names, the words on a card, the vCard). Keep the two in step. The
/// server's half is `functions/business_cards.js`.
///
/// Pure Dart: no Flutter, no Firebase, so every line of it is unit-tested.
library;

import 'package:qr/qr.dart';

import '../utils/callable_data.dart';
import 'tag_labels.dart' show QrMatrix;

// ---------------------------------------------------------------------------
// What a business may choose (mirrors business_cards.js).
// ---------------------------------------------------------------------------

/// The business's main color, by name. Fixed lists: each passes contrast as
/// text on white and under white text.
const Map<String, int> cardColors = {
  'laawol': 0xFF0B3B38,
  'teal': 0xFF0F766E,
  'indigo': 0xFF3730A3,
  'forest': 0xFF166534,
  'burgundy': 0xFF881337,
  'saffron': 0xFFB45309,
  'charcoal': 0xFF1F2937,
  'ocean': 0xFF075985,
  'plum': 0xFF6B21A8,
  'navy': 0xFF0A214A,
};

/// The second color of the signature card.
const Map<String, int> cardAccents = {
  'red': 0xFFCF1026,
  'amber': 0xFFB45309,
  'teal': 0xFF0D9488,
  'blue': 0xFF1D4ED8,
};

const List<String> cardStyles = ['classic', 'signature'];

const int cardTaglineMax = 60;
const int cardServiceMax = 40;
const int cardServicesMax = 6;

/// What a printed QR opens. Never change it: printed cards are forever.
const String cardLinkBase = 'https://laawoldigital.com/c/';

final RegExp _codePattern = RegExp(r'^[23456789BCDFGHJKMNPQRSTVWXYZ]{8}$');

/// A code as typed or scanned, in the stored form; '' when it is not one.
String normalizeCardCode(Object? input) {
  final code = (input ?? '').toString().trim().toUpperCase();
  return _codePattern.hasMatch(code) ? code : '';
}

String cardLink(String code) => '$cardLinkBase${normalizeCardCode(code)}';

String _text(Object? value, int max) {
  final clean = (value ?? '').toString().replaceAll(RegExp(r'\s+'), ' ').trim();
  return clean.length > max ? clean.substring(0, max) : clean;
}

/// A name as a card prints it. A name typed all in capitals or all in small
/// letters gets a capital per word; a name with its own mix of cases
/// ("DHL Express") is the owner's choice and is left alone.
String cardName(Object? value) {
  final name = _text(value, 120);
  final letters = name.replaceAll(RegExp(r'[^\p{L}]', unicode: true), '');
  if (letters.isEmpty ||
      (letters != letters.toLowerCase() && letters != letters.toUpperCase())) {
    return name;
  }
  return name.toLowerCase().replaceAllMapped(
    RegExp(r"(^|[\s\-'’.&/])(\p{L})", unicode: true),
    (m) => '${m[1]}${m[2]!.toUpperCase()}',
  );
}

/// Who has a card of their own: a business owner or staff member of a
/// business. Customers and platform admins (no business) have none; the
/// server refuses them with `not_team_member`.
bool hasOwnBusinessCard({
  required bool isBusinessOwner,
  required bool isStaff,
  required String? businessId,
}) => (isBusinessOwner || isStaff) && (businessId ?? '').isNotEmpty;

// ---------------------------------------------------------------------------
// The card.
// ---------------------------------------------------------------------------

class CardSettings {
  const CardSettings({
    this.style = 'classic',
    this.color = 'laawol',
    this.accent = 'red',
    this.tagline = '',
    this.services = const [],
  });

  final String style;
  final String color;
  final String accent;
  final String tagline;
  final List<String> services;

  bool get isSignature => style == 'signature';
  int get colorValue => cardColors[color] ?? cardColors['laawol']!;
  int get accentValue => cardAccents[accent] ?? cardAccents['red']!;

  /// Settings from the server, with a default for anything missing: a card
  /// always draws.
  factory CardSettings.fromCallable(Object? raw) {
    final source = callableMap(raw);
    final style = callableString(source['style']);
    final color = callableString(source['color']);
    final accent = callableString(source['accent']);
    final lines = source['services'];
    return CardSettings(
      style: cardStyles.contains(style) ? style : 'classic',
      color: cardColors.containsKey(color) ? color : 'laawol',
      accent: cardAccents.containsKey(accent) ? accent : 'red',
      tagline: _text(source['tagline'], cardTaglineMax),
      services: [
        if (lines is List)
          for (final line in lines)
            if (_text(line, cardServiceMax).isNotEmpty)
              _text(line, cardServiceMax),
      ].take(cardServicesMax).toList(growable: false),
    );
  }
}

class CardPerson {
  const CardPerson({required this.name, this.phone = ''});

  final String name;
  final String phone;
}

class CardBusiness {
  const CardBusiness({
    this.businessId = '',
    this.name = '',
    this.phone = '',
    this.website = '',
    this.addressLine1 = '',
    this.city = '',
    this.state = '',
    this.postalCode = '',
    this.logoUrl = '',
    this.services = const [],
  });

  final String businessId;
  final String name;
  final String phone;
  final String website;
  final String addressLine1;
  final String city;
  final String state;
  final String postalCode;
  final String logoUrl;

  /// Service ids switched on (`carSales`, `carParking`, ...).
  final List<String> services;
}

/// One card as the server answers (`publicCard()` in business_cards.js).
class BusinessCardData {
  const BusinessCardData({
    required this.code,
    required this.link,
    required this.business,
    this.person,
    this.settings = const CardSettings(),
  });

  final String code;
  final String link;
  final CardPerson? person;
  final CardBusiness business;
  final CardSettings settings;

  /// A card from the server, or null when the answer is not one.
  static BusinessCardData? fromCallable(Object? raw, {String url = ''}) {
    final source = callableMap(raw);
    final code = normalizeCardCode(source['code']);
    final b = callableMap(source['business']);
    if (code.isEmpty || b.isEmpty) return null;
    final p = callableMap(source['person']);
    final personName = cardName(p['name']);
    final link = url.trim().isNotEmpty
        ? url.trim()
        : callableString(source['link'], cardLink(code));
    return BusinessCardData(
      code: code,
      link: link,
      person: personName.isEmpty
          ? null
          : CardPerson(name: personName, phone: _text(p['phone'], 40)),
      business: CardBusiness(
        businessId: _text(b['businessId'], 120),
        name: cardName(b['name']),
        phone: _text(b['phone'], 40),
        website: _text(b['website'], 120),
        addressLine1: cardName(b['addressLine1']),
        city: cardName(b['city']),
        state: _text(b['state'], 40),
        postalCode: _text(b['postalCode'], 20),
        logoUrl: _text(b['logoUrl'], 600),
        services: [
          for (final s in (b['services'] is List ? b['services'] as List : []))
            if (_text(s, 40).isNotEmpty) _text(s, 40),
        ],
      ),
      settings: CardSettings.fromCallable(source['settings']),
    );
  }
}

/// The answer of `businessCards {action: "mine"}`.
class MyCard {
  const MyCard({
    required this.card,
    required this.url,
    this.appleWallet = false,
    this.googleWallet = false,
  });

  final BusinessCardData card;

  /// What the QR holds: `https://laawoldigital.com/c/<code>`.
  final String url;
  final bool appleWallet;
  final bool googleWallet;

  /// Null when the answer is not a card.
  static MyCard? fromCallable(Object? raw) {
    final source = callableMap(raw);
    final code = normalizeCardCode(source['code']);
    final url = callableString(
      source['url'],
      code.isEmpty ? '' : cardLink(code),
    );
    final card = BusinessCardData.fromCallable(source['card'], url: url);
    if (card == null || url.isEmpty) return null;
    final wallet = callableMap(source['wallet']);
    return MyCard(
      card: card,
      url: url,
      appleWallet: callableBool(wallet['apple']),
      googleWallet: callableBool(wallet['google']),
    );
  }
}

// ---------------------------------------------------------------------------
// Phones.
// ---------------------------------------------------------------------------

/// A phone number as a card prints it. Most Laawol businesses are in the
/// United States and many numbers were typed without a country code, so ten
/// bare digits are read as a US number: `(347) 555-0142`. Anything else is
/// shown as typed. '' when there is nothing to show.
String cardPhoneDisplay(Object? phone) => _dial(phone).display;

/// The number for a contact file or a dialer: `+13475550142`, '' for none.
String cardPhoneDial(Object? phone) => _dial(phone).dial;

({String display, String dial}) _dial(Object? phone) {
  final typed = _text(phone, 40);
  final digits = typed.replaceAll(RegExp(r'\D'), '');
  if (digits.length < 5) return (display: '', dial: '');
  final plus = typed.startsWith('+');
  // "+1 1347..." is a US number whose country code was typed twice: no US
  // area code starts with 1, so it can be nothing else.
  final doubled = plus && digits.length == 12 && digits.startsWith('11');
  final us =
      (!plus && digits.length == 10) ||
          (digits.length == 11 && digits.startsWith('1')) ||
          doubled
      ? digits.substring(digits.length - 10)
      : '';
  if (us.isNotEmpty) {
    return (
      display:
          '(${us.substring(0, 3)}) ${us.substring(3, 6)}-${us.substring(6)}',
      dial: '+1$us',
    );
  }
  return (display: typed, dial: '${plus ? '+' : ''}$digits');
}

// ---------------------------------------------------------------------------
// What the card says.
// ---------------------------------------------------------------------------

const Map<String, List<(List<String>, String, String)>> _tagWords = {
  'en': [
    (['carSales'], 'Car sales', 'Buy and sell cars'),
    (['carParking'], 'Parking', 'Car parking'),
    (
      ['barrelShipping', 'sharedBarrels', 'freight'],
      'Shipping',
      'Package and barrel shipping',
    ),
    (['carTransport'], 'Car transport', 'Car transport'),
    (['inventory'], 'Shop', 'Shop'),
  ],
  'fr': [
    (['carSales'], 'Vente de voitures', 'Achat et vente de voitures'),
    (['carParking'], 'Stationnement', 'Stationnement de voitures'),
    (
      ['barrelShipping', 'sharedBarrels', 'freight'],
      'Expédition',
      "Expédition de colis et de barils",
    ),
    (['carTransport'], 'Transport de voitures', 'Transport de voitures'),
    (['inventory'], 'Boutique', 'Boutique'),
  ],
};

/// The line under the business's name: what the owner wrote, else its
/// services in a few words (mirrors `cardTagline` on the web). [languageCode]
/// is `en` or `fr`; anything else reads as English.
String cardTagline(BusinessCardData card, String languageCode) {
  if (card.settings.tagline.isNotEmpty) return card.settings.tagline;
  final words = _tagWords[languageCode == 'fr' ? 'fr' : 'en']!;
  return [
    for (final entry in words)
      if (entry.$1.any(card.business.services.contains)) entry.$2,
  ].take(3).join(' · ');
}

/// `12 Example Ave, Bronx, NY 10457`, from the parts the business filled in.
String cardAddress(CardBusiness business) {
  final region = [
    business.state,
    business.postalCode,
  ].where((part) => part.isNotEmpty).join(' ');
  return [
    business.addressLine1,
    business.city,
    region,
  ].where((part) => part.isNotEmpty).join(', ');
}

/// Whose card this is, in a few words: the person, else the business.
String cardTitle(BusinessCardData card) =>
    card.person?.name ?? card.business.name;

/// Up to two letters for a business with no logo.
String cardInitials(String name) => _text(name, 80)
    .split(' ')
    .where((word) => word.isNotEmpty)
    .take(2)
    .map((word) => word.substring(0, 1).toUpperCase())
    .join();

/// The two numbers, the person's own first; a business's own card has only
/// its number. `label` is `direct` or `office`.
List<({String label, String number})> cardPhoneRows(BusinessCardData card) {
  final direct = card.person == null
      ? ''
      : cardPhoneDisplay(card.person!.phone);
  final office = cardPhoneDisplay(card.business.phone);
  return [
    if (direct.isNotEmpty) (label: 'direct', number: direct),
    if (office.isNotEmpty && office != direct)
      (label: 'office', number: office),
  ];
}

/// `sahelauto.example` from whatever was typed as the website.
String cardWebsiteLabel(String website) => website
    .trim()
    .replaceFirst(RegExp(r'^https?://', caseSensitive: false), '')
    .replaceFirst(RegExp(r'^www\.', caseSensitive: false), '')
    .replaceFirst(RegExp(r'/+$'), '');

/// A link for the website, or null when it is not a web address.
String? cardWebsiteHref(String website) {
  final label = cardWebsiteLabel(website);
  return RegExp(
        r'^[a-z0-9-]+(\.[a-z0-9-]+)+(/\S*)?$',
        caseSensitive: false,
      ).hasMatch(label)
      ? 'https://$label'
      : null;
}

// ---------------------------------------------------------------------------
// Save contact (vCard 3.0).
// ---------------------------------------------------------------------------

String _vEscape(String value) => value
    .replaceAll(r'\', r'\\')
    .replaceAll(RegExp(r'\r?\n'), r'\n')
    .replaceAllMapped(RegExp(r'([,;])'), (m) => '\\${m[1]}');

/// The contact file "Save contact" hands to the phone (mirrors `vcardText`
/// on the web): the person's own number is the mobile, the business's is
/// work; a business's own card is saved as a company.
String cardVcard(BusinessCardData card) {
  final person = card.person;
  final business = card.business;
  final lines = <String>['BEGIN:VCARD', 'VERSION:3.0'];
  if (person != null) {
    final parts = person.name.split(' ').where((p) => p.isNotEmpty).toList();
    final family = parts.length > 1 ? parts.last : '';
    final given = parts.length > 1
        ? parts.sublist(0, parts.length - 1).join(' ')
        : person.name;
    lines
      ..add('N:${_vEscape(family)};${_vEscape(given)};;;')
      ..add('FN:${_vEscape(person.name)}');
  } else {
    lines
      ..add('N:;;;;')
      ..add('FN:${_vEscape(business.name)}')
      ..add('X-ABShowAs:COMPANY');
  }
  if (business.name.isNotEmpty) lines.add('ORG:${_vEscape(business.name)}');
  final direct = person == null ? '' : cardPhoneDial(person.phone);
  final office = cardPhoneDial(business.phone);
  if (direct.isNotEmpty) lines.add('TEL;TYPE=CELL:$direct');
  if (office.isNotEmpty && office != direct) {
    lines.add('TEL;TYPE=WORK:$office');
  }
  final site = cardWebsiteHref(business.website);
  if (site != null) lines.add('URL:$site');
  if (business.addressLine1.isNotEmpty || business.city.isNotEmpty) {
    lines.add(
      'ADR;TYPE=WORK:;;${_vEscape(business.addressLine1)};'
      '${_vEscape(business.city)};${_vEscape(business.state)};'
      '${_vEscape(business.postalCode)};',
    );
  }
  lines
    ..add('NOTE:${_vEscape(card.link)}')
    ..add('END:VCARD');
  return '${lines.join('\r\n')}\r\n';
}

/// `awa-camara.vcf`.
String cardVcardFileName(BusinessCardData card) {
  const accents = {
    'à': 'a',
    'á': 'a',
    'â': 'a',
    'ä': 'a',
    'ã': 'a',
    'å': 'a',
    'ç': 'c',
    'è': 'e',
    'é': 'e',
    'ê': 'e',
    'ë': 'e',
    'ì': 'i',
    'í': 'i',
    'î': 'i',
    'ï': 'i',
    'ñ': 'n',
    'ò': 'o',
    'ó': 'o',
    'ô': 'o',
    'ö': 'o',
    'õ': 'o',
    'ù': 'u',
    'ú': 'u',
    'û': 'u',
    'ü': 'u',
    'ý': 'y',
    'ÿ': 'y',
  };
  final plain = cardTitle(
    card,
  ).toLowerCase().split('').map((c) => accents[c] ?? c).join();
  final slug = plain
      .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
      .replaceAll(RegExp(r'^-+|-+$'), '');
  return '${slug.isEmpty ? 'contact' : slug}.vcf';
}

// ---------------------------------------------------------------------------
// The QR.
// ---------------------------------------------------------------------------

/// The card's QR, error correction M: a card link is short, so the code
/// stays coarse enough to scan from a phone screen.
QrMatrix cardQrMatrix(String link) {
  final code = QrCode.fromData(
    data: link,
    errorCorrectLevel: QrErrorCorrectLevel.M,
  );
  final image = QrImage(code);
  final n = image.moduleCount;
  return QrMatrix(n, [
    for (var r = 0; r < n; r++)
      for (var c = 0; c < n; c++) image.isDark(r, c),
  ]);
}
