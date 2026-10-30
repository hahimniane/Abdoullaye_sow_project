import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/parking_whatsapp.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'parking_whatsapp_switch.dart' show parkingWhatsAppErrorText;

/// "Send welcome to current customers" on the parking list
/// (docs/PARKING_WHATSAPP.md §1 decision 4, §3).
///
/// Offered only to the owner / a platform admin ([canSend]) and only while
/// the business's WhatsApp switch is on: it follows `parkingWhatsApp.enabled`
/// on the business record, so flipping the switch in settings shows or hides
/// it live. A record that cannot be read hides it - never a crash.
class ParkingWelcomeEntry extends StatelessWidget {
  const ParkingWelcomeEntry({
    super.key,
    required this.businessId,
    required this.canSend,
    this.service,
    this.enabledStream,
  });

  final String businessId;
  final bool canSend;
  final ParkingWhatsAppService? service;

  /// Overrides the business-record read; a widget test passes its own.
  final Stream<bool>? enabledStream;

  Stream<bool> _stream() => FirebaseFirestore.instance
      .collection('businesses')
      .doc(businessId)
      .snapshots()
      .map((doc) {
        final value = doc.data()?['parkingWhatsApp'];
        return value is Map && value['enabled'] == true;
      });

  @override
  Widget build(BuildContext context) {
    if (!canSend || businessId.isEmpty) return const SizedBox.shrink();
    return _SafeEnabledBuilder(
      key: ValueKey(businessId),
      streamFactory: enabledStream == null ? _stream : () => enabledStream!,
      builder: (context, enabled) {
        if (!enabled) return const SizedBox.shrink();
        final l10n = AppLocalizations.of(context)!;
        return TextButton.icon(
          key: const Key('parking-welcome-open'),
          onPressed: () => showParkingWelcomeSheet(
            context,
            businessId: businessId,
            service: service,
          ),
          icon: const Icon(Icons.waving_hand_outlined, size: 18),
          label: Text(l10n.parkingWaWelcomeButton),
        );
      },
    );
  }
}

/// Listens to [streamFactory] once; any error (including Firebase not being
/// set up) reads as "off".
class _SafeEnabledBuilder extends StatefulWidget {
  const _SafeEnabledBuilder({
    super.key,
    required this.streamFactory,
    required this.builder,
  });

  final Stream<bool> Function() streamFactory;
  final Widget Function(BuildContext context, bool enabled) builder;

  @override
  State<_SafeEnabledBuilder> createState() => _SafeEnabledBuilderState();
}

class _SafeEnabledBuilderState extends State<_SafeEnabledBuilder> {
  StreamSubscription<bool>? _sub;
  bool _enabled = false;

  @override
  void initState() {
    super.initState();
    try {
      _sub = widget.streamFactory().listen(
        (value) {
          if (mounted && value != _enabled) setState(() => _enabled = value);
        },
        onError: (Object error) {
          debugPrint('Parking WhatsApp switch read failed: $error');
          if (mounted && _enabled) setState(() => _enabled = false);
        },
      );
    } catch (error) {
      debugPrint('Parking WhatsApp switch read failed: $error');
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.builder(context, _enabled);
}

Future<void> showParkingWelcomeSheet(
  BuildContext context, {
  required String businessId,
  ParkingWhatsAppService? service,
  Duration timeout = const Duration(seconds: 30),
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => ParkingWelcomeSheet(
      businessId: businessId,
      service: service,
      timeout: timeout,
    ),
  );
}

enum _WelcomePhase { loading, ready, sending, done, loadFailed }

/// The preview of everyone a welcome would go to - one row per phone number
/// with its cars - then the send and what it did. Numbers already welcomed
/// are muted and start unticked. Every network step has a timeout, so the
/// sheet always leaves its loading state.
class ParkingWelcomeSheet extends StatefulWidget {
  const ParkingWelcomeSheet({
    super.key,
    required this.businessId,
    this.service,
    this.timeout = const Duration(seconds: 30),
  });

  final String businessId;
  final ParkingWhatsAppService? service;
  final Duration timeout;

  @override
  State<ParkingWelcomeSheet> createState() => _ParkingWelcomeSheetState();
}

class _ParkingWelcomeSheetState extends State<ParkingWelcomeSheet> {
  _WelcomePhase _phase = _WelcomePhase.loading;
  List<ParkingWelcomeRecipient> _recipients = const [];
  final Set<String> _selected = <String>{};
  ParkingWelcomeResult _result = const ParkingWelcomeResult();
  String _error = '';

  ParkingWhatsAppService get _service =>
      widget.service ?? FirebaseParkingWhatsAppService();

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _phase = _WelcomePhase.loading;
      _error = '';
    });
    try {
      final recipients = await _service
          .welcomePreview(widget.businessId)
          .timeout(widget.timeout);
      if (!mounted) return;
      setState(() {
        _recipients = recipients;
        _selected
          ..clear()
          ..addAll([
            for (final r in recipients)
              if (!r.alreadyWelcomed) r.phone,
          ]);
        _phase = _WelcomePhase.ready;
      });
    } catch (error) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context)!;
      setState(() {
        _error = parkingWhatsAppErrorText(
          l10n,
          error,
          fallback: l10n.parkingWaWelcomeLoadFailed,
        );
        _phase = _WelcomePhase.loadFailed;
      });
    }
  }

  Future<void> _send() async {
    if (_phase != _WelcomePhase.ready || _selected.isEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _phase = _WelcomePhase.sending;
      _error = '';
    });
    try {
      final result = await _service
          .welcomeSend(
            businessId: widget.businessId,
            phones: [
              for (final r in _recipients)
                if (_selected.contains(r.phone)) r.phone,
            ],
          )
          // Sends go one after another on the server; give them room.
          .timeout(widget.timeout * 4);
      if (!mounted) return;
      setState(() {
        _result = result;
        _phase = _WelcomePhase.done;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = parkingWhatsAppErrorText(
          l10n,
          error,
          fallback: l10n.parkingWaWelcomeSendFailed,
        );
        _phase = _WelcomePhase.ready;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          AppSpacing.md,
          AppSpacing.lg,
          AppSpacing.lg,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              _phase == _WelcomePhase.done
                  ? l10n.parkingWaWelcomeResultTitle
                  : l10n.parkingWaWelcomeTitle,
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Flexible(child: _body(context, l10n)),
          ],
        ),
      ),
    );
  }

  Widget _body(BuildContext context, AppLocalizations l10n) {
    final theme = Theme.of(context);
    switch (_phase) {
      case _WelcomePhase.loading:
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const CircularProgressIndicator(),
              const SizedBox(height: AppSpacing.md),
              Text(l10n.parkingWaWelcomeLoading),
            ],
          ),
        );
      case _WelcomePhase.loadFailed:
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              _error,
              key: const Key('parking-welcome-error'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
            const SizedBox(height: AppSpacing.md),
            OutlinedButton(
              key: const Key('parking-welcome-retry'),
              onPressed: _load,
              child: Text(l10n.retry),
            ),
          ],
        );
      case _WelcomePhase.done:
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.parkingWaWelcomeResult(
                _result.sent,
                _result.skipped,
                _result.failed,
              ),
              key: const Key('parking-welcome-result'),
              style: theme.textTheme.bodyLarge?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            FilledButton(
              key: const Key('parking-welcome-done'),
              onPressed: () => Navigator.of(context).maybePop(),
              child: Text(l10n.done),
            ),
          ],
        );
      case _WelcomePhase.ready:
      case _WelcomePhase.sending:
        final sending = _phase == _WelcomePhase.sending;
        if (_recipients.isEmpty) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
            child: Text(
              l10n.parkingWaWelcomeEmpty,
              key: const Key('parking-welcome-empty'),
            ),
          );
        }
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.parkingWaWelcomeIntro,
              style: theme.textTheme.bodySmall?.copyWith(
                color: AppColors.lightMuted,
              ),
            ),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Wrap(
                children: [
                  TextButton(
                    key: const Key('parking-welcome-all'),
                    onPressed: sending
                        ? null
                        : () => setState(
                            () => _selected.addAll(
                              _recipients.map((r) => r.phone),
                            ),
                          ),
                    child: Text(l10n.parkingWaWelcomeSelectAll),
                  ),
                  TextButton(
                    key: const Key('parking-welcome-none'),
                    onPressed: sending ? null : () => setState(_selected.clear),
                    child: Text(l10n.parkingWaWelcomeSelectNone),
                  ),
                ],
              ),
            ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final recipient in _recipients)
                    _RecipientTile(
                      recipient: recipient,
                      selected: _selected.contains(recipient.phone),
                      enabled: !sending,
                      onChanged: (value) => setState(() {
                        if (value) {
                          _selected.add(recipient.phone);
                        } else {
                          _selected.remove(recipient.phone);
                        }
                      }),
                    ),
                ],
              ),
            ),
            if (_error.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                _error,
                key: const Key('parking-welcome-error'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ],
            const SizedBox(height: AppSpacing.md),
            FilledButton(
              key: const Key('parking-welcome-send'),
              onPressed: sending || _selected.isEmpty ? null : _send,
              child: sending
                  ? Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Text(l10n.parkingWaWelcomeSending),
                      ],
                    )
                  : Text(l10n.parkingWaWelcomeSendCount(_selected.length)),
            ),
          ],
        );
    }
  }
}

class _RecipientTile extends StatelessWidget {
  const _RecipientTile({
    required this.recipient,
    required this.selected,
    required this.enabled,
    required this.onChanged,
  });

  final ParkingWelcomeRecipient recipient;
  final bool selected;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    final muted = recipient.alreadyWelcomed;
    final color = muted ? AppColors.lightMuted : null;
    final title = recipient.name.isEmpty
        ? recipient.phone
        : '${recipient.name} · ${recipient.phone}';
    return CheckboxListTile(
      key: Key('parking-welcome-row-${recipient.phone}'),
      contentPadding: EdgeInsets.zero,
      controlAffinity: ListTileControlAffinity.leading,
      value: selected,
      onChanged: enabled ? (value) => onChanged(value ?? false) : null,
      title: Text(
        title,
        style: theme.textTheme.bodyMedium?.copyWith(
          fontWeight: FontWeight.w800,
          color: color,
        ),
      ),
      subtitle: Text(
        [
          if (recipient.carsText.isNotEmpty) recipient.carsText,
          if (muted) l10n.parkingWaWelcomeAlready,
        ].join(' · '),
        style: theme.textTheme.bodySmall?.copyWith(color: color),
      ),
    );
  }
}
