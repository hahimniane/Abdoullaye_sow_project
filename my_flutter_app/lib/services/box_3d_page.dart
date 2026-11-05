/// The website's real 3D scene (a realistic person scaled to 5 ft 6 in with a
/// height pole, a sneaker and the box) as the app embeds it in a WebView
/// (docs/PACKAGE_BOX_SIZES_PAY_NOW.md §4).
///
/// Pure Dart with no Flutter import, so the URL, the navigation guard, the
/// loading → ready | fallback state machine and the once-per-frame dims
/// throttle are unit-tested without a platform WebView
/// (`test/box_3d_page_test.dart`).
///
/// Page contract (admin_web `/box-3d/`):
/// - `?l=<in>&w=<in>&h=<in>&lang=en|fr`, full-viewport scene, no login.
/// - `window.laawolBox3d.setDims({l,w,h})` / `.setLang("en"|"fr")`.
/// - JavaScript channel [box3dChannelName] posts [box3dReadyMessage] on the
///   first frame with models drawn, [box3dFailedMessage] when WebGL or the
///   models failed or the page's own 8 s timeout fired.
library;

import '../widgets/box_designer/box_geometry.dart';

/// The one place the page's address lives. Tests pass their own base to
/// [box3dPageUri] / the designer instead of touching this.
const String box3dPageUrl = 'https://customer.laawoldigital.com/box-3d/';

/// The JavaScript channel the page talks to the app on.
const String box3dChannelName = 'Box3dChannel';
const String box3dReadyMessage = 'ready';
const String box3dFailedMessage = 'failed';

/// No "ready" within this long and the painter scene stays for good, so a
/// slow or silent page can never leave the customer without a picture.
const Duration box3dReadyTimeout = Duration(seconds: 10);

/// The language the page speaks: French for French, English for the rest.
String box3dLang(String languageCode) => languageCode == 'fr' ? 'fr' : 'en';

/// `…/box-3d/?l=…&w=…&h=…&lang=…`, built with [Uri] so nothing is ever
/// string-glued. Inches are clamped to the box's own limits first.
Uri box3dPageUri({
  required BoxDims dims,
  required String lang,
  String base = box3dPageUrl,
}) {
  final d = dims.clamped;
  return Uri.parse(base).replace(
    queryParameters: {
      'l': inchesText(d.l),
      'w': inchesText(d.w),
      'h': inchesText(d.h),
      'lang': box3dLang(lang),
      // The app shows the models' credit under the scene (box-model-credit).
      'credit': '0',
    },
  );
}

/// Only the page itself may load: same scheme, host, port and path as the
/// base (its query and fragment may differ). Anything else (a link, a
/// redirect, a pop-up) is refused, so the picture can never turn into a
/// browser. `about:blank` is how some platforms start.
bool isBox3dNavigationAllowed(String url, {String base = box3dPageUrl}) {
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

/// `window.laawolBox3d.setDims({l,w,h})`, guarded so a page that has not
/// defined the API yet (or never will) is a no-op rather than an error.
String box3dSetDimsScript(BoxDims dims) {
  final d = dims.clamped;
  return 'window.laawolBox3d&&window.laawolBox3d.setDims('
      '{l:${inchesText(d.l)},w:${inchesText(d.w)},h:${inchesText(d.h)}});';
}

String box3dSetLangScript(String lang) =>
    'window.laawolBox3d&&window.laawolBox3d.setLang("${box3dLang(lang)}");';

/// Where the picture area is in its life.
enum Box3dPhase {
  /// The painter scene shows while the page loads.
  loading,

  /// The page drew its first frame: the WebView is shown.
  ready,

  /// No network, a page error, "failed" or the timeout: the painter scene
  /// stays for good (the page is not retried).
  fallback,
}

/// The state machine and the dims/lang throttle for one picture.
///
/// `loading → ready | fallback`, both terminal: a late "ready" after a
/// fallback is ignored (the customer is already looking at the painter), and
/// a late "failed" after ready is ignored too (the page recovers itself).
///
/// The page is opened with the first dims/lang in its URL. Later changes
/// are collected here and sent as JavaScript, at most once per animation
/// frame: [requestDims] / [requestLang] return true when the caller should
/// schedule a flush for the next frame (none is scheduled yet), and
/// [takeScripts] hands over what is still different from what the page
/// already has. Nothing is sent before the page is ready; the first flush
/// after "ready" catches up on changes made while it loaded.
class Box3dSceneState {
  Box3dSceneState({required BoxDims dims, required String lang})
    : _sentDims = dims.clamped,
      _pendingDims = dims.clamped,
      _sentLang = box3dLang(lang),
      _pendingLang = box3dLang(lang);

  Box3dPhase _phase = Box3dPhase.loading;
  Box3dPhase get phase => _phase;
  bool get isLoading => _phase == Box3dPhase.loading;
  bool get isReady => _phase == Box3dPhase.ready;
  bool get isFallback => _phase == Box3dPhase.fallback;

  BoxDims _sentDims;
  BoxDims _pendingDims;
  String _sentLang;
  String _pendingLang;
  bool _flushScheduled = false;

  /// A message from the page's JavaScript channel. Returns true if the phase
  /// changed. Unknown messages are ignored.
  bool onChannelMessage(String message) {
    switch (message.trim()) {
      case box3dReadyMessage:
        return _move(Box3dPhase.ready);
      case box3dFailedMessage:
        return _move(Box3dPhase.fallback);
    }
    return false;
  }

  /// The safety timeout fired. Only matters while loading.
  bool onTimeout() => _move(Box3dPhase.fallback);

  /// The page could not load (network, HTTP error, no platform WebView).
  /// Only matters while loading.
  bool onPageError() => _move(Box3dPhase.fallback);

  bool _move(Box3dPhase to) {
    if (_phase != Box3dPhase.loading) return false;
    _phase = to;
    return true;
  }

  /// The inches changed. True: schedule a flush for the next frame.
  bool requestDims(BoxDims dims) {
    _pendingDims = dims.clamped;
    return _schedule();
  }

  /// The language changed. True: schedule a flush for the next frame.
  bool requestLang(String lang) {
    _pendingLang = box3dLang(lang);
    return _schedule();
  }

  /// Right after "ready": one flush to catch up on what changed while the
  /// page loaded. True: schedule it.
  bool requestCatchUp() => _schedule();

  bool _schedule() {
    if (_flushScheduled) return false;
    _flushScheduled = true;
    return true;
  }

  /// The scripts to run now (a frame has come). Empty unless the page is
  /// ready and something differs from what it already shows; always
  /// releases the "flush scheduled" flag.
  List<String> takeScripts() {
    _flushScheduled = false;
    if (!isReady) return const [];
    final scripts = <String>[];
    if (_pendingDims != _sentDims) {
      _sentDims = _pendingDims;
      scripts.add(box3dSetDimsScript(_sentDims));
    }
    if (_pendingLang != _sentLang) {
      _sentLang = _pendingLang;
      scripts.add(box3dSetLangScript(_sentLang));
    }
    return scripts;
  }
}
