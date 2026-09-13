import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_motion.dart';

/// One thing a customer can send home.
class ShipOption {
  const ShipOption({
    required this.route,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.tint,
  });

  final String route;
  final IconData icon;
  final String title;
  final String subtitle;
  final Color tint;
}

/// "Ship" answers *that* you are sending something; this asks *what*.
///
/// Splitting it this way keeps the common path one tap from anywhere and the
/// choice one level deeper, instead of four shipping services competing for
/// room in a tab bar. Returns the chosen route, or null if dismissed.
Future<String?> showShipSheet(
  BuildContext context, {
  required String title,
  required String subtitle,
  required List<ShipOption> options,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    barrierColor: AppColors.ink.withValues(alpha: 0.38),
    builder: (sheetContext) => _ShipSheet(
      title: title,
      subtitle: subtitle,
      options: options,
    ),
  );
}

class _ShipSheet extends StatelessWidget {
  const _ShipSheet({
    required this.title,
    required this.subtitle,
    required this.options,
  });

  final String title;
  final String subtitle;
  final List<ShipOption> options;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 38,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.rule,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 21,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                  height: 1.1,
                  // Large text reads too loose at default tracking.
                  letterSpacing: -0.4,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                subtitle,
                style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.muted,
                  height: 1.35,
                ),
              ),
              const SizedBox(height: 18),
              // The sheet itself slides up; the choices then land one after
              // another, which walks the eye down the list in order.
              for (var i = 0; i < options.length; i++) ...[
                RiseIn(
                  index: i + 1,
                  offset: 10,
                  stagger: const Duration(milliseconds: 45),
                  child: _ShipOptionRow(option: options[i]),
                ),
                if (i < options.length - 1) const SizedBox(height: 10),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ShipOptionRow extends StatelessWidget {
  const _ShipOptionRow({required this.option});

  final ShipOption option;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: '${option.title}. ${option.subtitle}',
      child: PressableScale(
        scale: 0.985,
        onTap: () {
          AppHaptics.selection();
          Navigator.of(context).pop(option.route);
        },
        child: Container(
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(
            color: AppColors.cream,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppColors.rule),
          ),
          child: Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: option.tint.withValues(alpha: 0.13),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(option.icon, color: option.tint, size: 23),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      option.title,
                      style: const TextStyle(
                        fontSize: 15.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      option.subtitle,
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: AppColors.muted,
                        height: 1.25,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(
                Icons.chevron_right,
                size: 20,
                color: AppColors.muted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
