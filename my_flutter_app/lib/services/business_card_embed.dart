/// The website's real business card as the app embeds it in a WebView
/// (docs/BUSINESS_CARDS.md): the same classic or signature design, front and
/// back, that the card's public page shows.
///
/// Pure Dart with no Flutter import, so the address, the navigation guard and
/// the loading -> ready | fallback state machine are unit-tested without a
/// platform WebView.
///
/// Page contract (admin_web `?service=business-card&c=<CODE>&embed=1`):
/// - Only the card face and "Turn the card over": no page chrome, a
///   transparent background, the card filling the width.
/// - `&lang=en|fr` names the language.
/// - JavaScript channel [cardEmbedChannelName] posts [cardEmbedReadyMessage]
///   once the card is painted, [cardEmbedErrorMessage] when it is missing or
///   could not be read.
library;

import 'business_card.dart';

/// The one place the page's address lives.
const String cardEmbedBaseUrl = 'https://customer.laawoldigital.com/';

const String cardEmbedChannelName = 'LaawolCard';
const String cardEmbedReadyMessage = 'ready';
const String cardEmbedErrorMessage = 'error';

/// No "ready" within this long and the app's own card stays for good, so a
/// slow, offline or silent page can never leave the screen without a card.
const Duration cardEmbedReadyTimeout = Duration(seconds: 15);

/// A card is 3.5 x 2 in (1050 x 600): the picture's width over its height.
const double cardEmbedAspect = 7 / 4;

/// The page's own "Turn the card over" row under the card, in logical pixels.
const double cardEmbedFlipHeight = 44;

/// The language the page speaks: French for French, English for the rest.
String cardEmbedLang(String languageCode) => languageCode == 'fr' ? 'fr' : 'en';

/// `…/?service=business-card&c=<CODE>&embed=1&lang=en|fr`, built with [Uri]
/// so nothing is string-glued. Null when [code] is not a card code.
Uri? cardEmbedUri({
  required String code,
  required String languageCode,
  String base = cardEmbedBaseUrl,
}) {
  final normalized = normalizeCardCode(code);
  if (normalized.isEmpty) return null;
  final page = Uri.parse(base);
  return page.replace(
    path: page.path.isEmpty ? '/' : page.path,
    queryParameters: {
      'service': 'business-card',
      'c': normalized,
      'embed': '1',
      'lang': cardEmbedLang(languageCode),
    },
  );
}

/// Whether the embedded page may navigate to [url]: only the page itself
/// (same scheme, host, port and path as [base]; its query may differ). Any
/// other address (a link, a redirect, a pop-up) is refused, so the card can
/// never turn into a browser. `about:blank` is how some platforms start.
bool isCardEmbedNavigationAllowed(
  String url, {
  String base = cardEmbedBaseUrl,
}) {
  final target = Uri.tryParse(url);
  if (target == null) return false;
  if (url == 'about:blank') return true;
  final page = Uri.parse(base);
  return target.scheme == page.scheme &&
      target.host == page.host &&
      target.port == page.port &&
      _trimSlash(target.path) == _trimSlash(page.path);
}

String _trimSlash(String path) =>
    path.endsWith('/') ? path.substring(0, path.length - 1) : path;

/// Where the card area is in its life.
enum CardEmbedPhase {
  /// Waiting for the page: the app shows a placeholder.
  loading,

  /// The page painted the real card: the WebView is shown.
  ready,

  /// The page failed, said so, or took too long: the app's own card.
  fallback,
}

/// The loading -> ready | fallback rule. Once it leaves loading it never
/// changes (a late "ready" after the fallback is ignored, so the picture
/// never swaps under the customer's eyes).
CardEmbedPhase cardEmbedNextPhase(
  CardEmbedPhase phase, {
  String? message,
  bool timedOut = false,
  bool pageError = false,
}) {
  if (phase != CardEmbedPhase.loading) return phase;
  if (pageError || timedOut || message == cardEmbedErrorMessage) {
    return CardEmbedPhase.fallback;
  }
  if (message == cardEmbedReadyMessage) return CardEmbedPhase.ready;
  return phase;
}
