import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../services/business_card_embed.dart';

/// What the card area asks a WebView for.
class CardWebViewRequest {
  const CardWebViewRequest({
    required this.url,
    required this.baseUrl,
    required this.onMessage,
    required this.onPageError,
  });

  /// The embed page for one card and language.
  final Uri url;

  /// The page's address without a query: the only thing that may load.
  final String baseUrl;

  /// A string from the page's [cardEmbedChannelName] channel.
  final ValueChanged<String> onMessage;

  /// The page could not load (network, HTTP error).
  final VoidCallback onPageError;
}

/// A live embedded page. The card area talks to this, never to a platform
/// WebView directly, so widget tests can inject a fake.
abstract class CardWebViewHandle {
  /// The view to put in the tree. Built once per handle.
  Widget build(BuildContext context);

  void dispose();
}

/// Makes a handle, or throws when the platform has no WebView (the card area
/// then keeps the app's own card).
typedef CardWebViewFactory =
    CardWebViewHandle Function(CardWebViewRequest request);

/// The real thing, on iOS and Android through `webview_flutter`.
///
/// No scrolling or zoom; a transparent background so the screen's own shows
/// through; only the page itself may load (every other address is refused); a
/// main-frame error or an HTTP error on the page itself reports
/// [CardWebViewRequest.onPageError].
class PlatformCardWebView implements CardWebViewHandle {
  PlatformCardWebView(CardWebViewRequest request)
    : _controller = WebViewController() {
    final base = request.baseUrl;
    _controller
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.transparent)
      ..enableZoom(false)
      ..addJavaScriptChannel(
        cardEmbedChannelName,
        onMessageReceived: (message) {
          if (!_disposed) request.onMessage(message.message);
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (nav) =>
              isCardEmbedNavigationAllowed(nav.url, base: base)
              ? NavigationDecision.navigate
              : NavigationDecision.prevent,
          onWebResourceError: (error) {
            if (!_disposed && (error.isForMainFrame ?? true)) {
              request.onPageError();
            }
          },
          onHttpError: (error) {
            final uri = error.request?.uri;
            if (!_disposed &&
                uri != null &&
                isCardEmbedNavigationAllowed(uri.toString(), base: base)) {
              request.onPageError();
            }
          },
        ),
      )
      ..loadRequest(request.url);
  }

  final WebViewController _controller;
  bool _disposed = false;

  @override
  Widget build(BuildContext context) => WebViewWidget(
    controller: _controller,
    // A vertical drag that starts on the card still scrolls the screen
    // around it; a tap (the page's "Turn the card over") reaches the page.
    gestureRecognizers: {
      Factory<VerticalDragGestureRecognizer>(VerticalDragGestureRecognizer.new),
    },
  );

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    // The native view goes with its WebViewWidget; the channel is released
    // here so the page can no longer reach the app.
    _controller.removeJavaScriptChannel(cardEmbedChannelName).ignore();
  }
}
