import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../screens/business_assistant_screen.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import 'app_snackbars.dart';
import 'async_action_button.dart';

// The pieces both business homes are built from: the loud action, a list of
// places, the "more tools" buttons, and the tail every services card ends
// with. One implementation, so the standard home and the simple shipping home
// can never drift apart.

/// One "more tools" button: the console section it stands in for.
class HomeTool {
  const HomeTool(this.key, this.icon, this.label, this.onPressed);

  final String key;
  final IconData icon;
  final String label;
  final VoidCallback onPressed;
}

/// The one thing this screen is for, and the only filled button on it.
///
/// A filled button is a commit: it does something. When three of them stack up
/// the eye has no entry point and the screen reads as a menu of equals, which
/// is how the business home used to look. Everything else on the page is
/// quieter than this by design.
class HomePrimaryAction extends StatelessWidget {
  const HomePrimaryAction({
    super.key,
    required this.buttonKey,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final Key buttonKey;
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      key: buttonKey,
      onTap: onTap,
      child: Container(
        height: 52,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.cobalt,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          boxShadow: [
            BoxShadow(
              color: AppColors.cobaltDeep.withValues(alpha: 0.18),
              blurRadius: 10,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 19, color: Colors.white),
            const SizedBox(width: AppSpacing.sm),
            // A long French label on a narrow phone shortens instead of
            // overflowing the button.
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.1,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One place the business can go.
class HomeDestination {
  const HomeDestination({
    required this.rowKey,
    required this.icon,
    required this.title,
    this.subtitle = '',
    required this.onTap,
    this.trailing,
  });

  final Key rowKey;
  final IconData icon;
  final String title;

  /// A badge before the chevron (a count of things waiting), if any.
  final Widget? trailing;

  /// What is inside, under the title; '' for a place whose name says it.
  final String subtitle;
  final VoidCallback onTap;
}

/// Destinations, grouped the way a list of places is grouped everywhere else
/// on the platform: one surface, hairlines between the rows, a chevron saying
/// each one leads somewhere.
class HomeDestinationGroup extends StatelessWidget {
  const HomeDestinationGroup({super.key, required this.rows});

  final List<HomeDestination> rows;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return const SizedBox.shrink();
    return Container(
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0)
              // Inset to start under the text, so the icons read as one column.
              const Padding(
                padding: EdgeInsets.only(left: 60),
                child: Divider(height: 1, thickness: 1),
              ),
            _HomeDestinationRow(row: rows[i]),
          ],
        ],
      ),
    );
  }
}

class _HomeDestinationRow extends StatelessWidget {
  const _HomeDestinationRow({required this.row});

  final HomeDestination row;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      key: row.rowKey,
      onTap: row.onTap,
      scale: 0.99,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: 14,
        ),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.mist,
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              ),
              child: Icon(row.icon, size: 18, color: AppColors.cobaltDeep),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    row.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.2,
                      color: AppColors.ink,
                    ),
                  ),
                  if (row.subtitle.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      row.subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        height: 1.35,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            if (row.trailing != null) ...[
              row.trailing!,
              const SizedBox(width: AppSpacing.xs),
            ],
            const Icon(Icons.chevron_right, size: 20, color: AppColors.muted),
          ],
        ),
      ),
    );
  }
}

/// What both business homes end with: the console's other sections as
/// buttons ([tools], by the same permissions the console uses), the business
/// console - which leaves the app, so it is outlined and says so - and the
/// assistant. Shared by the services card and the simple shipping home.
class BusinessHomeTail extends StatelessWidget {
  const BusinessHomeTail({
    super.key,
    required this.tools,
    required this.businessId,
  });

  final List<HomeTool> tools;
  final String businessId;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (tools.isNotEmpty) ...[
          const SizedBox(height: 18),
          Text(
            l10n.businessMoreTools,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
              color: AppColors.muted,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final tool in tools)
                OutlinedButton.icon(
                  key: Key('business-tool-${tool.key}'),
                  icon: Icon(tool.icon, size: 18),
                  label: Text(tool.label),
                  onPressed: tool.onPressed,
                ),
            ],
          ),
        ],
        // Occasional, and it leaves the app - so it is outlined, and it says
        // so before it is tapped.
        const SizedBox(height: 12),
        SizedBox(
          width: double.infinity,
          child: AsyncActionButton.outlined(
            icon: Icons.open_in_browser,
            label: l10n.openBusinessConsole,
            loadingLabel: l10n.openingBusinessConsole,
            onPressed: () async {
              final opened = await launchUrl(
                Uri.parse('https://business.laawoldigital.com/'),
                mode: LaunchMode.externalApplication,
              );
              if (!opened && context.mounted) {
                showErrorSnackBar(context, l10n.businessConsoleOpenFailed);
              }
            },
          ),
        ),
        const SizedBox(height: 6),
        Text(
          l10n.businessOperationsWebNote,
          style: Theme.of(
            context,
          ).textTheme.bodySmall?.copyWith(color: AppColors.muted, height: 1.4),
        ),
        if (businessId.isNotEmpty) ...[
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              key: const Key('open-business-assistant'),
              icon: const Icon(Icons.support_agent),
              label: Text(l10n.businessAssistantOpen),
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) =>
                        BusinessAssistantScreen(businessId: businessId),
                  ),
                );
              },
            ),
          ),
        ],
      ],
    );
  }
}
