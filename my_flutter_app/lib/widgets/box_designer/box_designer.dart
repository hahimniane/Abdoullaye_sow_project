import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../l10n/app_localizations.dart';
import '../../services/box_sizes.dart';
import '../../services/package_requests.dart' show formatRequestCents;
import '../../theme/app_colors.dart';
import '../../theme/app_motion.dart';
import '../../theme/app_spacing.dart';
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

  @override
  void initState() {
    super.initState();
    _syncFields(force: true);
    for (var i = 0; i < 3; i++) {
      _focus[i].addListener(() => _onFocus(i));
    }
  }

  @override
  void didUpdateWidget(BoxDesigner old) {
    super.didUpdateWidget(old);
    if (old.dims != widget.dims) _syncFields();
  }

  @override
  void dispose() {
    _spin.dispose();
    for (final c in _controllers) {
      c.dispose();
    }
    for (final f in _focus) {
      f.dispose();
    }
    super.dispose();
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
            label: l10n.boxDesignerSemantics(dims.text),
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
                    TweenAnimationBuilder<SceneFraming>(
                      tween: SceneFramingTween(end: framing),
                      duration: reduced
                          ? Duration.zero
                          : const Duration(milliseconds: 260),
                      curve: AppMotion.standard,
                      builder: (context, animated, _) => RepaintBoundary(
                        child: CustomPaint(
                          painter: BoxScenePainter(
                            scene: scene,
                            framing: animated,
                            spin: _spin,
                          ),
                        ),
                      ),
                    ),
                    Positioned(
                      left: AppSpacing.sm,
                      bottom: AppSpacing.sm,
                      child: IgnorePointer(
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
