import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/parking_month_statement.dart'
    show parkingMoney, parkingMonthLabel, previousParkingMonthKey;
import '../services/parking_whatsapp.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import 'parking_whatsapp_switch.dart' show parkingWhatsAppErrorText;

/// "Send invoices" on Month end (docs/PARKING_INVOICES.md §3): the month's
/// run - ready, sending, or sent and by whom - and the way into the preview
/// where the owner picks who gets an invoice and sends.
///
/// Shown only when [parkingInvoicesOffered]: the business's WhatsApp switch is
/// on, the viewer is the owner (or a platform admin), and the month on screen
/// is the month just ended. Anything else renders nothing at all.
///
/// The run status follows the server's `parkingInvoiceRuns` doc live, so it
/// flips to "Sent" by itself when a send (or the automatic one on the 3rd)
/// finishes. A refused or silent read just leaves the status line out - the
/// card never waits on it.
class ParkingInvoicesCard extends StatefulWidget {
  const ParkingInvoicesCard({
    super.key,
    required this.businessId,
    required this.monthKey,
    required this.switchOn,
    required this.canSend,
    this.currentMonthKey,
    this.staffNames = const {},
    this.service,
    this.runStream,
    this.timeout = const Duration(seconds: 30),
  });

  final String businessId;

  /// The month on screen, "YYYY-MM".
  final String monthKey;

  /// `parkingWhatsApp.enabled` on the business record.
  final bool switchOn;

  /// Owner or platform admin.
  final bool canSend;

  /// The month just ended; defaults to it as of today.
  final String? currentMonthKey;

  /// uid -> name, to say who sent the run.
  final Map<String, String> staffNames;

  final ParkingWhatsAppService? service;

  /// Overrides the Firestore read of the run; a widget test passes its own.
  final Stream<ParkingInvoiceRun?> Function(String monthKey)? runStream;
  final Duration timeout;

  @override
  State<ParkingInvoicesCard> createState() => _ParkingInvoicesCardState();
}

class _ParkingInvoicesCardState extends State<ParkingInvoicesCard> {
  StreamSubscription<ParkingInvoiceRun?>? _sub;
  ParkingInvoiceRun? _run;
  bool _runKnown = false;

  bool get _offered => parkingInvoicesOffered(
    switchOn: widget.switchOn,
    canSend: widget.canSend,
    monthKey: widget.monthKey,
    currentMonthKey: widget.currentMonthKey ?? previousParkingMonthKey(),
  );

  @override
  void initState() {
    super.initState();
    if (_offered) _subscribe();
  }

  @override
  void didUpdateWidget(ParkingInvoicesCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    final changed =
        oldWidget.monthKey != widget.monthKey ||
        oldWidget.businessId != widget.businessId;
    if (changed || (_sub == null && _offered)) {
      _sub?.cancel();
      _sub = null;
      _run = null;
      _runKnown = false;
      if (_offered) _subscribe();
    }
  }

  void _subscribe() {
    try {
      final stream =
          widget.runStream?.call(widget.monthKey) ??
          parkingInvoiceRunStream(
            businessId: widget.businessId,
            monthKey: widget.monthKey,
          );
      _sub = stream.listen(
        (run) {
          if (!mounted) return;
          setState(() {
            _run = run;
            _runKnown = true;
          });
        },
        onError: (Object error) {
          debugPrint('Parking invoice run read failed: $error');
          if (!mounted) return;
          setState(() {
            _run = null;
            _runKnown = false;
          });
        },
      );
    } catch (error) {
      debugPrint('Parking invoice run read failed: $error');
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  String _statusText(AppLocalizations l10n, String locale, String monthLabel) {
    final run = _run;
    if (run == null) return l10n.parkingInvRunNone(monthLabel);
    switch (run.status) {
      case ParkingInvoiceRunStatus.ready:
        return l10n.parkingInvRunReady(
          monthLabel,
          run.recipients,
          parkingMoney(run.totalDueCents),
        );
      case ParkingInvoiceRunStatus.sending:
        return l10n.parkingInvRunSending(monthLabel);
      case ParkingInvoiceRunStatus.sent:
        final at = run.sentAt;
        final date = at == null ? '' : displayDateTime(at, locale);
        if (date.isEmpty) return l10n.parkingInvResultTitle;
        if (run.sentAutomatically) return l10n.parkingInvRunSentAuto(date);
        final name = (widget.staffNames[run.sentBy] ?? '').trim();
        return name.isEmpty
            ? l10n.parkingInvRunSentOn(date)
            : l10n.parkingInvRunSentBy(date, name);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_offered || widget.businessId.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    final locale = dateLocaleOf(context);
    final monthLabel = parkingMonthLabel(widget.monthKey, locale);
    final run = _run;
    final sending = run?.status == ParkingInvoiceRunStatus.sending;
    return Container(
      key: const Key('parking-invoices-card'),
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.receipt_long_outlined, size: 20),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  l10n.parkingInvCardTitle,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            l10n.parkingInvCardIntro,
            style: theme.textTheme.bodySmall?.copyWith(color: AppColors.muted),
          ),
          if (_runKnown) ...[
            const SizedBox(height: AppSpacing.sm),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (sending) ...[
                  const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                ],
                Expanded(
                  child: Text(
                    _statusText(l10n, locale, monthLabel),
                    key: const Key('parking-invoices-status'),
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            if (run?.status == ParkingInvoiceRunStatus.sent &&
                (run!.sent + run.skipped + run.failed) > 0)
              Text(
                l10n.parkingWaWelcomeResult(run.sent, run.skipped, run.failed),
                key: const Key('parking-invoices-counts'),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: run.failed > 0
                      ? theme.colorScheme.error
                      : AppColors.muted,
                ),
              ),
          ],
          const SizedBox(height: AppSpacing.sm),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: FilledButton(
              key: const Key('parking-invoices-open'),
              onPressed: sending
                  ? null
                  : () => showParkingInvoicesSheet(
                      context,
                      businessId: widget.businessId,
                      monthKey: widget.monthKey,
                      service: widget.service,
                      timeout: widget.timeout,
                    ),
              child: Text(l10n.parkingInvReview),
            ),
          ),
        ],
      ),
    );
  }
}

Future<void> showParkingInvoicesSheet(
  BuildContext context, {
  required String businessId,
  required String monthKey,
  ParkingWhatsAppService? service,
  Duration timeout = const Duration(seconds: 30),
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => ParkingInvoicesSheet(
      businessId: businessId,
      monthKey: monthKey,
      service: service,
      timeout: timeout,
    ),
  );
}

enum _InvoicePhase { loading, ready, sending, done, loadFailed }

/// The preview of everyone who would get an invoice - one row per phone
/// number with its cars, what it owes and whether it is still parked - then
/// the send and what it did. Numbers already sent are muted and start
/// unticked. Every network step has a timeout, so the sheet always leaves
/// its loading state; a send the server cut short offers "Send the rest".
class ParkingInvoicesSheet extends StatefulWidget {
  const ParkingInvoicesSheet({
    super.key,
    required this.businessId,
    required this.monthKey,
    this.service,
    this.timeout = const Duration(seconds: 30),
  });

  final String businessId;
  final String monthKey;
  final ParkingWhatsAppService? service;

  /// For the preview; a send gets ten times as long (the server sends one
  /// after another and stops at 240 s).
  final Duration timeout;

  @override
  State<ParkingInvoicesSheet> createState() => _ParkingInvoicesSheetState();
}

class _ParkingInvoicesSheetState extends State<ParkingInvoicesSheet> {
  _InvoicePhase _phase = _InvoicePhase.loading;
  List<ParkingInvoiceRecipient> _recipients = const [];
  final Set<String> _selected = <String>{};
  ParkingInvoiceResult _result = const ParkingInvoiceResult();
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
      _phase = _InvoicePhase.loading;
      _error = '';
    });
    try {
      final preview = await _service
          .invoicesPreview(
            businessId: widget.businessId,
            monthKey: widget.monthKey,
          )
          .timeout(widget.timeout);
      if (!mounted) return;
      setState(() {
        _recipients = preview.recipients;
        _selected
          ..clear()
          ..addAll([
            for (final r in preview.recipients)
              if (!r.alreadySent) r.phone,
          ]);
        _phase = _InvoicePhase.ready;
      });
    } catch (error) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context)!;
      setState(() {
        _error = parkingWhatsAppErrorText(
          l10n,
          error,
          fallback: l10n.parkingInvLoadFailed,
        );
        _phase = _InvoicePhase.loadFailed;
      });
    }
  }

  Future<void> _send() async {
    if (_phase != _InvoicePhase.ready || _selected.isEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _phase = _InvoicePhase.sending;
      _error = '';
    });
    try {
      final result = await _service
          .invoicesSend(
            businessId: widget.businessId,
            monthKey: widget.monthKey,
            phones: [
              for (final r in _recipients)
                if (_selected.contains(r.phone)) r.phone,
            ],
          )
          .timeout(widget.timeout * 10);
      if (!mounted) return;
      setState(() {
        _result = result;
        _phase = _InvoicePhase.done;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = parkingWhatsAppErrorText(
          l10n,
          error,
          fallback: l10n.parkingInvSendFailed,
        );
        _phase = _InvoicePhase.ready;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    final locale = dateLocaleOf(context);
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
              _phase == _InvoicePhase.done
                  ? l10n.parkingInvResultTitle
                  : l10n.parkingInvSheetTitle(
                      parkingMonthLabel(widget.monthKey, locale),
                    ),
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
      case _InvoicePhase.loading:
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const CircularProgressIndicator(),
              const SizedBox(height: AppSpacing.md),
              Text(l10n.parkingInvLoading),
            ],
          ),
        );
      case _InvoicePhase.loadFailed:
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              _error,
              key: const Key('parking-invoices-error'),
              style: TextStyle(color: theme.colorScheme.error),
            ),
            const SizedBox(height: AppSpacing.md),
            OutlinedButton(
              key: const Key('parking-invoices-retry'),
              onPressed: _load,
              child: Text(l10n.retry),
            ),
          ],
        );
      case _InvoicePhase.done:
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
              key: const Key('parking-invoices-result'),
              style: theme.textTheme.bodyLarge?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            if (_result.remaining > 0) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                l10n.parkingInvRemaining(_result.remaining),
                key: const Key('parking-invoices-remaining'),
                style: theme.textTheme.bodyMedium,
              ),
            ],
            const SizedBox(height: AppSpacing.md),
            if (_result.remaining > 0) ...[
              FilledButton(
                key: const Key('parking-invoices-rest'),
                onPressed: _load,
                child: Text(l10n.parkingInvSendRest),
              ),
              const SizedBox(height: AppSpacing.sm),
              OutlinedButton(
                key: const Key('parking-invoices-done'),
                onPressed: () => Navigator.of(context).maybePop(),
                child: Text(l10n.done),
              ),
            ] else
              FilledButton(
                key: const Key('parking-invoices-done'),
                onPressed: () => Navigator.of(context).maybePop(),
                child: Text(l10n.done),
              ),
          ],
        );
      case _InvoicePhase.ready:
      case _InvoicePhase.sending:
        final sending = _phase == _InvoicePhase.sending;
        if (_recipients.isEmpty) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
            child: Text(
              l10n.parkingInvEmpty,
              key: const Key('parking-invoices-empty'),
            ),
          );
        }
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.parkingInvSheetIntro,
              style: theme.textTheme.bodySmall?.copyWith(
                color: AppColors.lightMuted,
              ),
            ),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: Wrap(
                children: [
                  TextButton(
                    key: const Key('parking-invoices-all'),
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
                    key: const Key('parking-invoices-none'),
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
                    _InvoiceRecipientTile(
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
                key: const Key('parking-invoices-error'),
                style: TextStyle(color: theme.colorScheme.error),
              ),
            ],
            const SizedBox(height: AppSpacing.md),
            FilledButton(
              key: const Key('parking-invoices-send'),
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
                  : Text(l10n.parkingInvSendCount(_selected.length)),
            ),
          ],
        );
    }
  }
}

class _InvoiceRecipientTile extends StatelessWidget {
  const _InvoiceRecipientTile({
    required this.recipient,
    required this.selected,
    required this.enabled,
    required this.onChanged,
  });

  final ParkingInvoiceRecipient recipient;
  final bool selected;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    final muted = recipient.alreadySent;
    final color = muted ? AppColors.lightMuted : null;
    final title = recipient.name.isEmpty
        ? recipient.phone
        : '${recipient.name} · ${recipient.phone}';
    return CheckboxListTile(
      key: Key('parking-invoices-row-${recipient.phone}'),
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
          l10n.parkingInvDue(parkingMoney(recipient.totalDueCents)),
          if (recipient.stillParked) l10n.pmeStillParked,
          if (muted) l10n.parkingInvAlreadySent,
        ].join(' · '),
        style: theme.textTheme.bodySmall?.copyWith(color: color),
      ),
    );
  }
}
