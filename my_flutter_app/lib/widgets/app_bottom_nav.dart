import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';

class AppBottomNavItem {
  const AppBottomNavItem({
    required this.icon,
    required this.label,
    IconData? selectedIcon,
  }) : selectedIcon = selectedIcon ?? icon;

  final IconData icon;
  final IconData selectedIcon;
  final String label;
}

/// The one thing the app is for, lifted out of the bar.
///
/// A tab bar of equals says every destination matters the same amount. Sending
/// something home is why people open this app, so it is not a tab: it is an
/// action, raised off the surface, carrying the brand gradient and its own
/// light. Everything else stays quiet around it.
class AppBottomNavAction {
  const AppBottomNavAction({
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  /// True while the user is inside the flow this action starts, so the button
  /// reads as the current place as well as the way in.
  final bool active;
}

/// Flat paper tab bar used on customer and staff home screens.
///
/// With [action] set the bar splits around a raised centre button; without it
/// the bar is the plain row of equals it has always been.
class AppBottomNav extends StatelessWidget {
  const AppBottomNav({
    super.key,
    required this.items,
    required this.currentIndex,
    required this.onTap,
    this.action,
  });

  final List<AppBottomNavItem> items;
  final int currentIndex;
  final ValueChanged<int> onTap;
  final AppBottomNavAction? action;

  /// How far the centre button rises above the bar's top edge.
  static const double _lift = 24;
  static const double _buttonSize = 58;
  static const double _itemHeight = 64;

  @override
  Widget build(BuildContext context) {
    final bar = _bar(context);
    final raised = action;
    if (raised == null) return bar;
    // The lift lives inside this widget's own bounds, so nothing is ever
    // clipped by the scaffold: the strip above the bar is simply transparent
    // and the button floats in it.
    return Stack(
      clipBehavior: Clip.none,
      alignment: Alignment.topCenter,
      children: [
        Padding(padding: const EdgeInsets.only(top: _lift), child: bar),
        Positioned(top: 0, child: _RaisedAction(action: raised)),
      ],
    );
  }

  Widget _bar(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final slots = <Widget>[];
    // With a centre action the items split evenly around it; the middle slot
    // holds only the label, because the button itself floats above.
    final split = action == null ? -1 : (items.length / 2).floor();
    for (var index = 0; index < items.length; index++) {
      if (index == split) slots.add(_centreSlot(context));
      slots.add(_item(index));
    }
    if (split == items.length) slots.add(_centreSlot(context));

    return Container(
      decoration: BoxDecoration(
        color: colorScheme.surface,
        border: Border(
          top: BorderSide(color: colorScheme.outline.withValues(alpha: 0.75)),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 18,
            offset: const Offset(0, -8),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm,
            vertical: 7,
          ),
          child: Row(children: slots),
        ),
      ),
    );
  }

  /// The gap the raised button sits over. It carries the action's label at the
  /// same baseline as every other tab label, so the row still reads as a row.
  Widget _centreSlot(BuildContext context) {
    final raised = action!;
    return Expanded(
      child: SizedBox(
        height: _itemHeight,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const SizedBox(height: 22), // where a tab's icon would sit
            const SizedBox(height: 5),
            Text(
              raised.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: raised.active
                    ? AppColors.cobaltDeep
                    : AppColors.cobalt,
                fontFamily: 'JetBrains Mono',
                fontWeight: FontWeight.w800,
                fontSize: 9.5,
                height: 1.08,
                letterSpacing: 0.2,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _item(int index) {
    final item = items[index];
    final isSelected = currentIndex == index;
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2),
        child: Semantics(
          selected: isSelected,
          button: true,
          child: InkWell(
            onTap: () => onTap(index),
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              curve: Curves.easeOut,
              height: _itemHeight,
              decoration: BoxDecoration(
                color: isSelected
                    ? AppColors.mist.withValues(alpha: 0.82)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    isSelected ? item.selectedIcon : item.icon,
                    color: isSelected ? AppColors.cobaltDeep : AppColors.muted,
                    size: 22,
                  ),
                  const SizedBox(height: 5),
                  Text(
                    item.label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: isSelected ? AppColors.cobaltDeep : AppColors.muted,
                      fontFamily: 'JetBrains Mono',
                      fontWeight: FontWeight.w700,
                      fontSize: 9.5,
                      height: 1.08,
                      letterSpacing: 0,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The button itself: brand gradient, a bright top edge where the light
/// catches it, and a coloured shadow so it reads as sitting above the bar
/// rather than painted on it.
class _RaisedAction extends StatefulWidget {
  const _RaisedAction({required this.action});

  final AppBottomNavAction action;

  @override
  State<_RaisedAction> createState() => _RaisedActionState();
}

class _RaisedActionState extends State<_RaisedAction>
    with SingleTickerProviderStateMixin {
  /// Unbounded because a spring settles on its own terms; clamping it to
  /// [0, 1] would cut the overshoot that makes the button read as landing.
  late final AnimationController _enter =
      AnimationController.unbounded(vsync: this, value: 0);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (AppMotion.reduced(context)) {
        _enter.value = 1;
        return;
      }
      // A little bounce is earned here: the button is arriving into place, not
      // merely fading up.
      _enter.animateWith(
        SpringSimulation(
          AppMotion.spring(response: 0.42, dampingRatio: 0.68),
          0,
          1,
          0,
        ),
      );
    });
  }

  @override
  void dispose() {
    _enter.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final action = widget.action;
    return AnimatedBuilder(
      animation: _enter,
      builder: (context, child) {
        final t = _enter.value;
        return Transform.translate(
          offset: Offset(0, (1 - t) * 18),
          child: Transform.scale(
            scale: 0.6 + 0.4 * t,
            child: Opacity(opacity: t.clamp(0.0, 1.0), child: child),
          ),
        );
      },
      child: _button(context, action),
    );
  }

  Widget _button(BuildContext context, AppBottomNavAction action) {
    return Semantics(
      button: true,
      label: action.label,
      child: PressableScale(
        scale: 0.93,
        onTap: () {
          AppHaptics.commit();
          action.onTap();
        },
        child: AnimatedContainer(
          duration: AppMotion.swapFor(context),
          curve: AppMotion.standard,
          width: AppBottomNav._buttonSize,
          height: AppBottomNav._buttonSize,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                AppColors.cobaltMid,
                AppColors.cobalt,
                AppColors.cobaltDeep,
              ],
              stops: [0, 0.55, 1],
            ),
            borderRadius: BorderRadius.circular(20),
            // A ring of the page colour separates the button from the bar it
            // overlaps, which is what makes it read as lifted.
            border: Border.all(
              color: Theme.of(context).colorScheme.surface,
              width: 3,
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.cobalt.withValues(
                  alpha: action.active ? 0.52 : 0.38,
                ),
                blurRadius: 22,
                spreadRadius: -2,
                offset: const Offset(0, 10),
              ),
              BoxShadow(
                color: AppColors.ink.withValues(alpha: 0.16),
                blurRadius: 8,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: Icon(action.icon, color: Colors.white, size: 26),
        ),
      ),
    );
  }
}
