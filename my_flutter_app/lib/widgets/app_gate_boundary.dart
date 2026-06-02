import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/app_version_config.dart';
import '../providers/app_gate_provider.dart';
import '../theme/app_colors.dart';

class AppGateBoundary extends StatefulWidget {
  const AppGateBoundary({super.key, required this.child});

  final Widget child;

  @override
  State<AppGateBoundary> createState() => _AppGateBoundaryState();
}

class _AppGateBoundaryState extends State<AppGateBoundary> {
  bool _dialogShowing = false;

  @override
  Widget build(BuildContext context) {
    return Consumer<AppGateProvider>(
      builder: (context, gate, child) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted || _dialogShowing) return;
          if (gate.status == AppGateStatus.updateAvailable) {
            _showUpdateWarning(gate);
          }
        });

        return Stack(
          children: [
            child!,
            if (gate.status == AppGateStatus.checking)
              _GateScreen(
                icon: Icons.cloud_sync_outlined,
                title: AppLocalizations.of(context)!.checkingConnection,
                message: AppLocalizations.of(
                  context,
                )!.checkingConnectionMessage,
                loading: true,
              ),
            if (gate.status == AppGateStatus.offline)
              _GateScreen(
                icon: Icons.wifi_off_outlined,
                title: AppLocalizations.of(context)!.noInternetConnection,
                message: AppLocalizations.of(context)!.noInternetMessage,
                actionLabel: AppLocalizations.of(context)!.retry,
                onAction: gate.refresh,
              ),
            if (gate.status == AppGateStatus.forceUpdate)
              _ForceUpdateScreen(gate: gate),
          ],
        );
      },
      child: widget.child,
    );
  }

  Future<void> _showUpdateWarning(AppGateProvider gate) async {
    final l10n = AppLocalizations.of(context)!;
    final decision = gate.decision;
    _dialogShowing = true;
    final locale = Localizations.localeOf(context).languageCode;
    final message = locale == 'fr'
        ? decision?.updateMessageFr
        : decision?.updateMessageEn;
    final versionText = _versionText(decision);
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) {
        return AlertDialog(
          title: Text(l10n.updateAvailable),
          content: Text(
            message?.trim().isNotEmpty == true
                ? message!
                : l10n.updateAvailableMessage(versionText),
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(context).pop();
                gate.continuePastUpdateWarning();
              },
              child: Text(l10n.continueLabel),
            ),
            FilledButton(
              onPressed: () async {
                final opened = await gate.openUpdateUrl();
                if (!opened && context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(l10n.updateLinkUnavailable)),
                  );
                }
              },
              child: Text(l10n.updateNow),
            ),
          ],
        );
      },
    );
    _dialogShowing = false;
  }
}

class _ForceUpdateScreen extends StatelessWidget {
  const _ForceUpdateScreen({required this.gate});

  final AppGateProvider gate;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final decision = gate.decision;
    final locale = Localizations.localeOf(context).languageCode;
    final message = locale == 'fr'
        ? decision?.updateMessageFr
        : decision?.updateMessageEn;
    final versionText = _versionText(decision);

    return _GateScreen(
      icon: Icons.system_update_alt_outlined,
      title: l10n.updateRequired,
      message: message?.trim().isNotEmpty == true
          ? message!
          : l10n.updateRequiredMessage(versionText),
      actionLabel: l10n.updateNow,
      onAction: () async {
        final opened = await gate.openUpdateUrl();
        if (!opened && context.mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(l10n.updateLinkUnavailable)));
        }
      },
      secondaryActionLabel: l10n.retry,
      onSecondaryAction: gate.refresh,
    );
  }
}

String _versionText(AppVersionDecision? decision) {
  final version = decision?.latestVersionName?.trim();
  return version == null || version.isEmpty ? '' : ' $version';
}

class _GateScreen extends StatelessWidget {
  const _GateScreen({
    required this.icon,
    required this.title,
    required this.message,
    this.loading = false,
    this.actionLabel,
    this.onAction,
    this.secondaryActionLabel,
    this.onSecondaryAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final bool loading;
  final String? actionLabel;
  final VoidCallback? onAction;
  final String? secondaryActionLabel;
  final VoidCallback? onSecondaryAction;

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: Material(
        color: Theme.of(context).colorScheme.surface,
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        color: AppColors.cobalt.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Icon(icon, color: AppColors.cobaltDeep, size: 34),
                    ),
                    const SizedBox(height: 20),
                    Text(
                      title,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      message,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Theme.of(
                          context,
                        ).colorScheme.onSurface.withValues(alpha: 0.72),
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 24),
                    if (loading)
                      const CircularProgressIndicator()
                    else ...[
                      if (actionLabel != null && onAction != null)
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton(
                            onPressed: onAction,
                            child: Text(actionLabel!),
                          ),
                        ),
                      if (secondaryActionLabel != null &&
                          onSecondaryAction != null) ...[
                        const SizedBox(height: 8),
                        TextButton(
                          onPressed: onSecondaryAction,
                          child: Text(secondaryActionLabel!),
                        ),
                      ],
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
