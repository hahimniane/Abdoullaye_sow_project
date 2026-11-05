import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../services/box_3d_page.dart';

/// What the designer asks a WebView for.
class Box3dWebViewRequest {
  const Box3dWebViewRequest({
    required this.url,
    required this.baseUrl,
    required this.onMessage,
    required this.onPageError,
  });

  /// The page with the first inches and language in its query.
  final Uri url;

  /// The page's address without a query: the only thing that may load.
  final String baseUrl;

  /// A string from the page's [box3dChannelName] channel.
  final ValueChanged<String> onMessage;

  /// The page could not load (network, HTTP error).
  final VoidCallback onPageError;
}

/// A live embedded page. The designer talks to this, never to a platform
/// WebView directly, so widget tests can inject a fake.
abstract class Box3dWebViewHandle {
  /// The view to put in the tree. Built once per handle.
  Widget build(BuildContext context);

  Future<void> runJavaScript(String script);

  void dispose();
}

/// Makes a handle, or throws when the platform has no WebView (the designer
/// then keeps the painter scene).
typedef Box3dWebViewFactory =
    Box3dWebViewHandle Function(Box3dWebViewRequest request);

/// The factory the designer uses when none is passed in. Tests set this to a
/// fake in `setUp` and back to null in `tearDown`.
@visibleForTesting
Box3dWebViewFactory? debugBox3dWebViewFactory;

Box3dWebViewHandle createBox3dWebView(Box3dWebViewRequest request) =>
    (debugBox3dWebViewFactory ?? PlatformBox3dWebView.new)(request);

/// The real thing, on iOS and Android through `webview_flutter`.
///
/// Zoom is off; the background is white; only the page itself may load
/// (every other address is refused); a main-frame error or an HTTP error on
/// the page itself reports [Box3dWebViewRequest.onPageError].
class PlatformBox3dWebView implements Box3dWebViewHandle {
  PlatformBox3dWebView(Box3dWebViewRequest request)
    : _controller = WebViewController() {
    final base = request.baseUrl;
    _controller
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..enableZoom(false)
      ..addJavaScriptChannel(
        box3dChannelName,
        onMessageReceived: (message) {
          if (!_disposed) request.onMessage(message.message);
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (nav) =>
              isBox3dNavigationAllowed(nav.url, base: base)
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
                isBox3dNavigationAllowed(uri.toString(), base: base)) {
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
    // The picture takes every drag that starts on it, so spinning works
    // inside a bottom sheet or a scroll view; the page around it still
    // scrolls.
    gestureRecognizers: {
      Factory<EagerGestureRecognizer>(EagerGestureRecognizer.new),
    },
  );

  @override
  Future<void> runJavaScript(String script) =>
      _disposed ? Future.value() : _controller.runJavaScript(script);

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    // The native view goes with its WebViewWidget; the channel is released
    // here so the page can no longer reach the app.
    _controller.removeJavaScriptChannel(box3dChannelName).ignore();
  }
}

/// Swallows a platform failure of a fire-and-forget script.
void ignorePlatformError(Object error, StackTrace stack) {
  if (error is PlatformException) return;
  debugPrint('Box 3D page script failed: $error');
}
