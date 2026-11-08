import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_card_embed.dart';

/// The address of the website's embedded card, the guard that keeps the
/// embedded page on itself, and the loading -> ready | fallback rule. Fake
/// codes only.
void main() {
  group('cardEmbedUri', () {
    test('builds the embed page for a code, with its language', () {
      expect(
        cardEmbedUri(code: 'K7M4P2XB', languageCode: 'en').toString(),
        'https://customer.laawoldigital.com/'
        '?service=business-card&c=K7M4P2XB&embed=1&lang=en',
      );
      expect(
        cardEmbedUri(code: 'k7m4p2xb', languageCode: 'fr').toString(),
        'https://customer.laawoldigital.com/'
        '?service=business-card&c=K7M4P2XB&embed=1&lang=fr',
      );
    });

    test('any other language is English', () {
      expect(cardEmbedLang('fr'), 'fr');
      expect(cardEmbedLang('en'), 'en');
      expect(cardEmbedLang('es'), 'en');
    });

    test('is null for something that is not a card code', () {
      expect(cardEmbedUri(code: '', languageCode: 'en'), isNull);
      expect(cardEmbedUri(code: 'short', languageCode: 'en'), isNull);
    });

    test('takes a test base', () {
      expect(
        cardEmbedUri(
          code: 'K7M4P2XB',
          languageCode: 'en',
          base: 'http://localhost:3000/',
        ).toString(),
        startsWith('http://localhost:3000/?service=business-card'),
      );
    });
  });

  group('isCardEmbedNavigationAllowed', () {
    test('allows only the page itself', () {
      expect(
        isCardEmbedNavigationAllowed(
          'https://customer.laawoldigital.com/?service=business-card&c=K7M4P2XB&embed=1',
        ),
        isTrue,
      );
      expect(isCardEmbedNavigationAllowed('about:blank'), isTrue);
    });

    test('refuses every other address', () {
      for (final url in [
        'https://example.com/',
        'https://customer.laawoldigital.com/other',
        'http://customer.laawoldigital.com/',
        'https://laawoldigital.com/',
        'tel:+13475550142',
        'https://wa.me/13475550142',
        'not a url',
      ]) {
        expect(isCardEmbedNavigationAllowed(url), isFalse, reason: url);
      }
    });
  });

  group('cardEmbedNextPhase', () {
    const loading = CardEmbedPhase.loading;

    test('ready, error, page error and timeout leave loading', () {
      expect(
        cardEmbedNextPhase(loading, message: cardEmbedReadyMessage),
        CardEmbedPhase.ready,
      );
      expect(
        cardEmbedNextPhase(loading, message: cardEmbedErrorMessage),
        CardEmbedPhase.fallback,
      );
      expect(
        cardEmbedNextPhase(loading, pageError: true),
        CardEmbedPhase.fallback,
      );
      expect(
        cardEmbedNextPhase(loading, timedOut: true),
        CardEmbedPhase.fallback,
      );
    });

    test('an unknown message changes nothing', () {
      expect(cardEmbedNextPhase(loading, message: 'hello'), loading);
    });

    test('once decided it never changes', () {
      expect(
        cardEmbedNextPhase(
          CardEmbedPhase.fallback,
          message: cardEmbedReadyMessage,
        ),
        CardEmbedPhase.fallback,
      );
      expect(
        cardEmbedNextPhase(CardEmbedPhase.ready, timedOut: true),
        CardEmbedPhase.ready,
      );
    });
  });

  group('the card as a picture (Share)', () {
    final jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4];

    test('a picture message is the JPEG it carries', () {
      final reply = cardEmbedImageReply('image:${base64Encode(jpeg)}');
      expect(reply, isNotNull);
      expect(reply!.bytes, jpeg);
    });

    test('a failure, garbage or a non-picture is a reply without bytes', () {
      expect(cardEmbedImageReply('image-error')!.bytes, isNull);
      expect(cardEmbedImageReply('image:not base64!!')!.bytes, isNull);
      final text = base64Encode(utf8.encode('<html>nope</html>'));
      expect(cardEmbedImageReply('image:$text')!.bytes, isNull);
    });

    test('ready and error are not about the picture', () {
      expect(cardEmbedImageReply(cardEmbedReadyMessage), isNull);
      expect(cardEmbedImageReply(cardEmbedErrorMessage), isNull);
      // ...and a picture message never moves the card out of loading.
      expect(
        cardEmbedNextPhase(CardEmbedPhase.loading, message: 'image-error'),
        CardEmbedPhase.loading,
      );
    });

    test('the script calls the page and answers at once on an old page', () {
      expect(cardEmbedImageScript, contains('window.laawolCardImage()'));
      expect(
        cardEmbedImageScript,
        contains('LaawolCard.postMessage("image-error")'),
      );
    });
  });
}
