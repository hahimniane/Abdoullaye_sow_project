/// The app's motion house style.
///
/// Apple's *Designing Fluid Interfaces* reasons about motion with two
/// designer-facing numbers instead of the physics triplet:
///
/// * **damping ratio** — 1.0 settles with no overshoot; below 1.0 bounces.
/// * **response** — how quickly the value reaches its target, in seconds.
///   Not a duration: a spring has no fixed one, its settle time emerges.
///
/// Default to critically damped (1.0). Bounce is earned only when the gesture
/// itself carried momentum — a flick, a throw, a drag release. Overshoot on a
/// panel that merely appeared reads as decoration; overshoot on something you
/// threw reads as physics.
///
/// Flutter takes stiffness, so response converts as `k = m·(2π/response)²`.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

abstract final class AppMotion {
  /// A spring in the two numbers that matter, converted for Flutter.
  static SpringDescription spring({
    required double response,
    double dampingRatio = 1.0,
    double mass = 1.0,
  }) {
    final stiffness = mass * math.pow(2 * math.pi / response, 2).toDouble();
    return SpringDescription.withDampingRatio(
      mass: mass,
      stiffness: stiffness,
      ratio: dampingRatio,
    );
  }

  /// Repositioning something on screen: no overshoot.
  static final SpringDescription move = spring(response: 0.4);

  /// Sheets and drawers, which arrive off a drag: a little bounce.
  static final SpringDescription sheet =
      spring(response: 0.3, dampingRatio: 0.8);

  /// A press must be felt at once, so this is short enough to read as
  /// instant rather than as an animation.
  static const Duration press = Duration(milliseconds: 100);

  /// Content swaps (a segment change, a month change).
  static const Duration swap = Duration(milliseconds: 260);

  static const Curve standard = Curves.easeOutCubic;

  /// The mirror of [standard], so a reversible transition returns along the
  /// path it left by.
  static const Curve standardReverse = Curves.easeInCubic;

  /// Reduced motion does not mean no feedback: it means the gentler,
  /// non-vestibular version. Callers cross-fade instead of sliding, and drop
  /// overshoot, when this is true.
  static bool reduced(BuildContext context) =>
      MediaQuery.maybeDisableAnimationsOf(context) ?? false;

  static Duration swapFor(BuildContext context) =>
      reduced(context) ? const Duration(milliseconds: 120) : swap;

  /// Where a flick is heading, so a gesture can be handed to the snap point
  /// nearest its projected rest — not to the one nearest where the finger
  /// happened to leave the glass. Exponential decay, the way scrolling
  /// decelerates; the textbook `v²/2a` is not what this should feel like.
  static double project(double velocityPerSecond, {double deceleration = 0.998}) {
    return (velocityPerSecond / 1000) * deceleration / (1 - deceleration);
  }

  /// Progressive resistance past a boundary. A hard stop reads as frozen;
  /// resistance reads as responsive with nothing further to give.
  static double rubberband(double overshoot, double dimension,
      {double constant = 0.55}) {
    if (dimension <= 0) return overshoot;
    return (overshoot * dimension * constant) /
        (dimension + constant * overshoot.abs());
  }
}

/// Presses report themselves the instant the finger lands, not on release.
///
/// The scale is small on purpose: enough to acknowledge the touch, not enough
/// to become the point. Dragging off cancels, dragging back re-arms, which is
/// the behavior a tap has everywhere else on the platform.
class PressableScale extends StatefulWidget {
  const PressableScale({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.scale = 0.97,
    this.behavior = HitTestBehavior.opaque,
  });

  final Widget child;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final double scale;
  final HitTestBehavior behavior;

  @override
  State<PressableScale> createState() => _PressableScaleState();
}

class _PressableScaleState extends State<PressableScale> {
  bool _down = false;

  void _set(bool value) {
    if (_down == value) return;
    setState(() => _down = value);
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null || widget.onLongPress != null;
    final flat = AppMotion.reduced(context);
    return GestureDetector(
      behavior: widget.behavior,
      onTapDown: enabled ? (_) => _set(true) : null,
      onTapUp: enabled ? (_) => _set(false) : null,
      onTapCancel: enabled ? () => _set(false) : null,
      onTap: widget.onTap,
      onLongPress: widget.onLongPress,
      child: AnimatedScale(
        scale: _down && enabled && !flat ? widget.scale : 1,
        duration: AppMotion.press,
        curve: Curves.easeOut,
        child: AnimatedOpacity(
          opacity: _down && enabled ? 0.92 : 1,
          duration: AppMotion.press,
          child: widget.child,
        ),
      ),
    );
  }
}

/// Haptics are reserved for moments that mean something — a commit, a snap, a
/// refusal. Spent everywhere, they teach people to stop noticing them.
abstract final class AppHaptics {
  static void selection() => HapticFeedback.selectionClick();
  static void commit() => HapticFeedback.lightImpact();
  static void refuse() => HapticFeedback.heavyImpact();
}
