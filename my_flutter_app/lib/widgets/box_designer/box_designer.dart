import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';

import '../../l10n/app_localizations.dart';
import '../../services/box_3d_page.dart';
import '../../services/box_sizes.dart';
import '../../services/package_requests.dart' show formatRequestCents;
import '../../theme/app_colors.dart';
import '../../theme/app_motion.dart';
import '../../theme/app_spacing.dart';
import 'box_3d_web_view.dart';
import 'box_geometry.dart';
import 'box_scene_painter.dart';

/// What the badge says about money.
enum BoxBadgePrice {
  /// The size alone ("Medium").
  none,

  /// The chosen business's price ("Medium · $35"), or that the business will
  /// quote when it has none.
  exact,

  /// What the cheapest business asks ("Medium · from $35").
  from,
}

/// A 3D cardboard box a customer resizes by dragging a slider or typing
/// inches, next to a sneaker and a person so the size can be felt, and a
/// badge with the size it makes (docs/PACKAGE_BOX_SIZES_PAY_NOW.md §4).
///
/// Drag the picture to spin it (the tilt is clamped). With [onChanged] null
/// the designer is read-only - what staff see on a request - and the
/// controls give way to the inches; the box still spins.
///
/// The picture is the website's real 3D scene (a realistic person scaled to
/// 5 ft 6 in with a height pole, a sneaker and the box) in a WebView. The
/// painted scene below it is the placeholder while the page loads and stays
/// for good when there is no network, the page errors or says it failed, or
/// it has not said "ready" within [box3dReadyTimeout] (`Box3dSceneState`
/// holds the rules). The inches and language reach the page as JavaScript,
/// at most once per frame, without a reload.
///
/// With reduced motion the framing jumps instead of easing and nothing
/// moves unless the finger does.
class BoxDesigner extends StatefulWidget {
  const BoxDesigner({
    super.key,
    required this.dims,
    this.onChanged,
    this.badgePrice = BoxBadgePrice.none,
    this.priceCentsFor,
    this.sceneHeight = 250,
    this.pageBaseUrl = box3dPageUrl,
    this.webViewFactory,
  });

  final BoxDims dims;

  /// Null: read-only.
  final ValueChanged<BoxDims>? onChanged;

  final BoxBadgePrice badgePrice;

  /// The price of a size in cents (the business's, or the cheapest of the
  /// comparison); null for a size nobody priced. Needed for
  /// [BoxBadgePrice.exact] and [BoxBadgePrice.from].
  final int? Function(String sizeId)? priceCentsFor;

  final double sceneHeight;

  /// The 3D page's address without a query (one constant, overridable so
  /// tests and staging can point elsewhere).
  final String pageBaseUrl;

  /// Makes the embedded page; null uses the platform WebView. Tests pass a
  /// fake so no platform view is needed.
  final Box3dWebViewFactory? webViewFactory;

  @override
  State<BoxDesigner> createState() => _BoxDesignerState();
}

class _BoxDesignerState extends State<BoxDesigner> {
  final ValueNotifier<SceneSpin> _spin = ValueNotifier(SceneSpin.start);
  final _controllers = [
    TextEditingController(),
    TextEditingController(),
    TextEditingController(),
  ];
  final _focus = [FocusNode(), FocusNode(), FocusNode()];

  /// Which sides hold something that is not inches (red until fixed).
  final _invalid = [false, false, false];

  /// The embedded 3D page and where it is in loading → ready | fallback.
  /// Null page: no WebView (yet, or any more) and the painter scene shows.
  Box3dSceneState? _scene;
  Box3dWebViewHandle? _web;
  Timer? _timeout;

  @override
  void initState() {
    super.initState();
    _syncFields(force: true);
    for (var i = 0; i < 3; i++) {
      _focus[i].addListener(() => _onFocus(i));
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final lang = box3dLang(Localizations.localeOf(context).languageCode);
    final scene = _scene;
    if (scene == null) {
      _openPage(lang);
    } else if (scene.requestLang(lang)) {
      _scheduleFlush();
    }
  }

  @override
  void didUpdateWidget(BoxDesigner old) {
    super.didUpdateWidget(old);
    if (old.dims != widget.dims) {
      _syncFields();
      if (_scene?.requestDims(widget.dims) ?? false) _scheduleFlush();
    }
  }

  @override
  void dispose() {
    _timeout?.cancel();
    _web?.dispose();
    _web = null;
    _spin.dispose();
    for (final c in _controllers) {
      c.dispose();
    }
    for (final f in _focus) {
      f.dispose();
    }
    super.dispose();
  }

  /// Starts the page, or - when the platform has no WebView - keeps the
  /// painter scene for good.
  void _openPage(String lang) {
    final scene = _scene = Box3dSceneState(dims: widget.dims, lang: lang);
    try {
      _web = (widget.webViewFactory ?? createBox3dWebView)(
        Box3dWebViewRequest(
          url: box3dPageUri(
            dims: widget.dims,
            lang: lang,
            base: widget.pageBaseUrl,
          ),
          baseUrl: widget.pageBaseUrl,
          onMessage: (m) => _changed(scene.onChannelMessage(m)),
          onPageError: () => _changed(scene.onPageError()),
        ),
      );
    } catch (error) {
      debugPrint('Box 3D page unavailable (${error.runtimeType}).');
      scene.onPageError();
      return;
    }
    // Loading must always resolve: no "ready" in time keeps the painter.
    _timeout = Timer(box3dReadyTimeout, () => _changed(scene.onTimeout()));
  }

  /// The page's phase moved (or not). Ready: show it and catch it up on any
  /// change made while it loaded. Fallback: let go of the WebView.
  void _changed(bool moved) {
    if (!mounted || !moved) return;
    final scene = _scene!;
    _timeout?.cancel();
    _timeout = null;
    if (scene.isFallback) {
      _web?.dispose();
      _web = null;
    } else if (scene.requestCatchUp()) {
      _scheduleFlush();
    }
    setState(() {});
  }

  /// One flush per frame at most: whatever the inches and language are by
  /// the next frame is what the page is told, once.
  void _scheduleFlush() {
    SchedulerBinding.instance
      ..addPostFrameCallback((_) => _flush())
      ..ensureVisualUpdate();
  }

  void _flush() {
    final web = _web;
    final scene = _scene;
    if (!mounted || web == null || scene == null) return;
    for (final script in scene.takeScripts()) {
      web.runJavaScript(script).catchError(ignorePlatformError);
    }
  }

  List<double> get _sides => [widget.dims.l, widget.dims.w, widget.dims.h];

  /// Puts the inches in the fields that are not being typed in.
  void _syncFields({bool force = false}) {
    final sides = _sides;
    for (var i = 0; i < 3; i++) {
      if (!force && _focus[i].hasFocus) continue;
      final text = inchesText(sides[i]);
      if (_controllers[i].text != text) _controllers[i].text = text;
      _invalid[i] = false;
    }
  }

  void _onFocus(int i) {
    if (_focus[i].hasFocus) return;
    // Leaving a field that holds nothing usable puts the box's inches back.
    if (_invalid[i] || _controllers[i].text.trim().isEmpty) {
      setState(() {
        _invalid[i] = false;
        _controllers[i].text = inchesText(_sides[i]);
      });
    }
  }

  BoxDims _with(int i, double value) => switch (i) {
    0 => widget.dims.copyWith(l: value),
    1 => widget.dims.copyWith(w: value),
    _ => widget.dims.copyWith(h: value),
  };

  void _typed(int i, String text) {
    final value = parseInches(text);
    setState(() => _invalid[i] = value == null && text.trim().isNotEmpty);
    if (value != null) widget.onChanged?.call(_with(i, value));
  }

  void _slid(int i, double value) {
    final inches = value.roundToDouble();
    _controllers[i].text = inchesText(inches);
    setState(() => _invalid[i] = false);
    widget.onChanged?.call(_with(i, inches));
  }

  String _badgeText(AppLocalizations l10n, String language) {
    final id = boxSizeIdOf(widget.dims);
    if (id == null) return '';
    final name = boxSizeName(id, language);
    final priceOf = widget.priceCentsFor;
    if (widget.badgePrice == BoxBadgePrice.none || priceOf == null) {
      return name;
    }
    final cents = id == boxSizeXl ? null : priceOf(id);
    if (cents == null) return l10n.boxBadgeQuote(name);
    final price = formatRequestCents(cents);
    return widget.badgePrice == BoxBadgePrice.from
        ? l10n.boxBadgeFrom(name, price)
        : l10n.boxBadgePrice(name, price);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final language = Localizations.localeOf(context).languageCode;
    final dims = widget.dims.clamped;
    final scene = layoutScene(dims);
    final framing = SceneFraming.of(scene);
    final quote = boxSizeIdOf(dims) == boxSizeXl;
    final badge = _badgeText(l10n, language);
    final reduced = AppMotion.reduced(context);
    final editable = widget.onChanged != null;
    final web = _web;
    final pageReady = web != null && (_scene?.isReady ?? false);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (badge.isNotEmpty)
          Align(
            alignment: Alignment.centerLeft,
            child: _Badge(
              key: const Key('box-badge'),
              text: badge,
              warn: quote,
            ),
          ),
        const SizedBox(height: AppSpacing.sm),
        ClipRRect(
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          child: Semantics(
            label: pageReady
                ? l10n.boxDesignerSemanticsScene(dims.text)
                : l10n.boxDesignerSemantics(dims.text),
            container: true,
            child: Container(
              height: widget.sceneHeight,
              decoration: const BoxDecoration(
                color: AppColors.cream,
                border: Border.fromBorderSide(
                  BorderSide(color: AppColors.rule),
                ),
                borderRadius: BorderRadius.all(
                  Radius.circular(AppSpacing.radiusMd),
                ),
              ),
              child: GestureDetector(
                key: const Key('box-scene'),
                behavior: HitTestBehavior.opaque,
                onPanUpdate: (d) =>
                    _spin.value = _spin.value.dragged(d.delta.dx, d.delta.dy),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    // The page sits UNDER the painted scene while it loads.
                    // A widget at opacity 0 is not painted at all, so a
                    // hidden platform view never joins the window and the
                    // page can never draw its first frame (it never says
                    // "ready"). The painted scene covers it instead and
                    // fades away once the page is drawn.
                    if (web != null)
                      Positioned.fill(
                        child: ExcludeSemantics(
                          child: IgnorePointer(
                            ignoring: !pageReady,
                            child: KeyedSubtree(
                              key: const Key('box-3d-page'),
                              child: web.build(context),
                            ),
                          ),
                        ),
                      ),
                    Positioned.fill(
                      child: IgnorePointer(
                        // The painted scene takes the touches (and the
                        // spin) until the page is drawn.
                        ignoring: pageReady,
                        child: AnimatedOpacity(
                          key: const Key('box-painted-scene'),
                          opacity: pageReady ? 0 : 1,
                          duration: reduced
                              ? Duration.zero
                              : const Duration(milliseconds: 220),
                          curve: AppMotion.standard,
                          child: ColoredBox(
                            color: Colors.white,
                            child: TweenAnimationBuilder<SceneFraming>(
                              tween: SceneFramingTween(end: framing),
                              duration: reduced
                                  ? Duration.zero
                                  : const Duration(milliseconds: 260),
                              curve: AppMotion.standard,
                              builder: (context, animated, _) =>
                                  RepaintBoundary(
                                    child: CustomPaint(
                                      painter: BoxScenePainter(
                                        scene: scene,
                                        framing: animated,
                                        spin: _spin,
                                      ),
                                    ),
                                  ),
                            ),
                          ),
                        ),
                      ),
                    ),
                    Positioned(
                      left: AppSpacing.sm,
                      bottom: AppSpacing.sm,
                      child: IgnorePointer(
                        // A white pill: the hint stays readable over the
                        // floor, the pole or the person.
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.88),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 3,
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(
                                  Icons.threed_rotation,
                                  size: 16,
                                  color: AppColors.muted,
                                ),
                                const SizedBox(width: 4),
                                Text(
                                  l10n.boxDesignerDrag,
                                  style: const TextStyle(
                                    fontSize: 11.5,
                                    color: AppColors.muted,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          l10n.boxDesignerScaleNote,
          key: const Key('box-scale-note'),
          style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
        ),
        // The 3D page leaves its credit out (credit=0) so it never covers the
        // labels; the models' licences still need it shown.
        if (pageReady)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              l10n.boxDesignerModelCredit,
              key: const Key('box-model-credit'),
              style: const TextStyle(fontSize: 9.5, color: AppColors.muted),
            ),
          ),
        const SizedBox(height: AppSpacing.sm),
        if (editable)
          ..._controls(l10n)
        else
          Text(
            dims.text,
            key: const Key('box-readonly-dims'),
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
      ],
    );
  }

  List<Widget> _controls(AppLocalizations l10n) {
    final labels = [
      l10n.boxDesignerLength,
      l10n.boxDesignerWidth,
      l10n.boxDesignerHeight,
    ];
    const keys = ['length', 'width', 'height'];
    final sides = _sides;
    return [
      for (var i = 0; i < 3; i++)
        Padding(
          padding: const EdgeInsets.only(bottom: 2),
          child: Row(
            children: [
              SizedBox(
                width: 64,
                child: Text(
                  labels[i],
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
              ),
              Expanded(
                child: Slider(
                  key: Key('box-slider-${keys[i]}'),
                  min: boxMinIn,
                  max: boxSliderMaxIn,
                  divisions: (boxSliderMaxIn - boxMinIn).toInt(),
                  value: sides[i].clamp(boxMinIn, boxSliderMaxIn).toDouble(),
                  onChanged: (v) => _slid(i, v),
                ),
              ),
              SizedBox(
                width: 84,
                child: TextField(
                  key: Key('box-field-${keys[i]}'),
                  controller: _controllers[i],
                  focusNode: _focus[i],
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                    LengthLimitingTextInputFormatter(5),
                  ],
                  onChanged: (t) => _typed(i, t),
                  decoration: InputDecoration(
                    isDense: true,
                    suffixText: l10n.boxDesignerInchesUnit,
                    // A red border; the sentence is said once, below.
                    errorText: _invalid[i] ? '' : null,
                  ),
                ),
              ),
            ],
          ),
        ),
      if (_invalid.any((v) => v))
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Text(
            l10n.boxDesignerRange,
            key: const Key('box-range-error'),
            style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
          ),
        ),
    ];
  }
}

class _Badge extends StatelessWidget {
  const _Badge({super.key, required this.text, required this.warn});

  final String text;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final color = warn ? AppColors.warn : AppColors.cobaltDeep;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 13.5,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }
}
