import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../services/package_request_service.dart' show RequestFailure;
import '../services/package_requests.dart'
    show RequestFailureKind, requestFailureKind;
import '../services/pay_now_payouts.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/package_request_widgets.dart' show requestRefusalText;

/// A paid-out refusal in the reader's words, else the shared request wording.
String payoutRefusalText(AppLocalizations l10n, RequestFailure failure) {
  final reason = failure.refusal.reason;
  return switch (reason) {
    'not_allowed' => l10n.ownPayoutsRefNotAllowed,
    'week_not_over' => l10n.ownPayoutsRefWeekNotOver,
    'week_empty' => l10n.ownPayoutsRefWeekEmpty,
    'week_already_paid' => l10n.ownPayoutsRefAlreadyPaid,
    'method_invalid' => l10n.ownPayoutsRefMethod,
    'reference_too_long' => l10n.ownPayoutsRefReferenceLong,
    'week_invalid' => l10n.ownPayoutsRefWeekInvalid,
    _ => requestRefusalText(l10n, failure.refusal),
  };
}

String payoutMethodLabel(AppLocalizations l10n, String method) =>
    switch (method) {
      'zelle' => l10n.ownPayoutsMethodZelle,
      'bank' => l10n.ownPayoutsMethodBank,
      _ => l10n.ownPayoutsMethodOther,
    };

String payoutLedgerLabel(AppLocalizations l10n, String type) => switch (type) {
  'payment' => l10n.ownLedgerPayment,
  'stripe_fee' => l10n.ownLedgerStripeFee,
  'refund' => l10n.ownLedgerRefund,
  'chargeback' => l10n.ownLedgerChargeback,
  'dispute_fee' => l10n.ownLedgerDisputeFee,
  'bill_offset' => l10n.ownLedgerBillOffset,
  'payout' => l10n.ownLedgerPayout,
  'to_bill' => l10n.ownLedgerToBill,
  _ => '',
};

/// The weekly Pay now payouts (docs/PACKAGE_BOX_SIZES_PAY_NOW.md). With a
/// [businessId] it is the business's "Laawol owes you": every week with its
/// lines. With none it is the platform admin's "Pay now payouts": the weeks
/// that are due across businesses and, when [canPayOut], "Mark paid out".
/// It hides itself when there is nothing to show or the viewer may not see it
/// (the server says), and its loading always resolves.
class PayNowPayoutsPanel extends StatefulWidget {
  const PayNowPayoutsPanel({
    super.key,
    this.businessId,
    this.canPayOut = false,
    this.service = const PayNowPayoutsService(),
  });

  final String? businessId;
  final bool canPayOut;
  final PayNowPayoutsService service;

  bool get adminView => businessId == null || businessId!.isEmpty;

  @override
  State<PayNowPayoutsPanel> createState() => _PayNowPayoutsPanelState();
}

class _PayNowPayoutsPanelState extends State<PayNowPayoutsPanel> {
  PayoutsAnswer _answer = const PayoutsAnswer();
  bool _loading = true;
  bool _hidden = false;
  String _error = '';
  String _open = '';

  /// What to say when the read failed: set from the failure on the next build.
  RequestFailure? _failure;
  bool _slow = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _failure = null;
      _slow = false;
    });
    try {
      final answer = await widget.service.load(
        businessId: widget.adminView ? null : widget.businessId,
      );
      if (!mounted) return;
      setState(() => _answer = answer);
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      final notAllowed =
          failure.refusal.has('not_allowed') ||
          requestFailureKind(failure.refusal.code) ==
              RequestFailureKind.permission;
      // Not allowed to see them: nothing to show, and no error either.
      setState(() {
        if (notAllowed) {
          _hidden = true;
        } else {
          _failure = failure;
          _slow = failure.refusal.code == 'unavailable';
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'generic');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _markPaid(PayoutWeek week) async {
    final message = await showLotSheet<String>(
      context,
      MarkPaidOutSheet(week: week, service: widget.service),
    );
    if (message == null || !mounted) return;
    showSuccessSnackBar(context, message);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_hidden) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final failed = _failure != null || _error.isNotEmpty;
    if (!_loading && !failed && _answer.weeks.isEmpty) {
      return const SizedBox.shrink();
    }
    final admin = widget.adminView;
    final shown = admin ? _answer.due : _answer.weeks;
    return Container(
      key: Key(admin ? 'payouts-panel-admin' : 'payouts-panel'),
      width: double.infinity,
      margin: const EdgeInsets.only(top: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.parchment,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.payments_outlined,
                size: 20,
                color: AppColors.cobaltDeep,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  admin ? l10n.ownPayoutsAdminTitle : l10n.ownPayoutsTitle,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              IconButton(
                key: const Key('payouts-refresh'),
                tooltip: l10n.ownPayoutsRefresh,
                onPressed: _loading ? null : _load,
                icon: const Icon(Icons.refresh, size: 20),
              ),
            ],
          ),
          Text(
            admin ? l10n.ownPayoutsAdminLede : l10n.ownPayoutsLede,
            style: const TextStyle(
              fontSize: 12.5,
              height: 1.4,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          if (failed)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Text(
                _slow ? l10n.ownPayoutsSlow : l10n.ownPayoutsLoadFailed,
                key: const Key('payouts-error'),
                style: const TextStyle(
                  fontSize: 12.5,
                  color: AppColors.errorRed,
                ),
              ),
            ),
          if (_loading && _answer.weeks.isEmpty)
            const Center(
              child: Padding(
                padding: EdgeInsets.all(AppSpacing.md),
                child: CircularProgressIndicator(key: Key('payouts-loading')),
              ),
            )
          else ...[
            if (admin && shown.isEmpty && !failed)
              Text(
                l10n.ownPayoutsNoneDue,
                key: const Key('payouts-none-due'),
                style: const TextStyle(color: AppColors.muted),
              )
            else if (!failed || _answer.weeks.isNotEmpty) ...[
              Text(
                admin
                    ? l10n.ownPayoutsDueTotal(
                        formatLotCents(dueTotalCents(_answer.weeks)),
                      )
                    : l10n.ownPayoutsOwedNow(
                        formatLotCents(owedNowCents(_answer.weeks)),
                      ),
                key: const Key('payouts-total'),
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.ink,
                ),
              ),
              if (!admin && _answer.unpaidBillCents > 0)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    l10n.ownPayoutsBillNote(
                      formatLotCents(_answer.unpaidBillCents),
                    ),
                    key: const Key('payouts-bill-note'),
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: AppColors.muted,
                    ),
                  ),
                ),
              const SizedBox(height: AppSpacing.sm),
              for (final week in shown)
                _WeekTile(
                  week: week,
                  showBusiness: admin,
                  expanded: !admin && _open == _keyOf(week),
                  locale: locale,
                  canPayOut: admin && widget.canPayOut,
                  onToggle: admin
                      ? null
                      : () => setState(
                          () =>
                              _open = _open == _keyOf(week) ? '' : _keyOf(week),
                        ),
                  onMarkPaid: () => _markPaid(week),
                ),
              if (admin && _answer.recentlyPaid.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.md),
                Text(
                  l10n.ownPayoutsRecent,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                    color: AppColors.muted,
                  ),
                ),
                for (final week in _answer.recentlyPaid)
                  _WeekTile(
                    week: week,
                    showBusiness: true,
                    expanded: false,
                    locale: locale,
                    canPayOut: false,
                    onToggle: null,
                    onMarkPaid: () {},
                  ),
              ],
            ],
          ],
        ],
      ),
    );
  }

  String _keyOf(PayoutWeek w) => '${w.businessId}-${w.weekKey}';
}

class _WeekTile extends StatelessWidget {
  const _WeekTile({
    required this.week,
    required this.showBusiness,
    required this.expanded,
    required this.locale,
    required this.canPayOut,
    required this.onToggle,
    required this.onMarkPaid,
  });

  final PayoutWeek week;
  final bool showBusiness;
  final bool expanded;
  final String locale;
  final bool canPayOut;
  final VoidCallback? onToggle;
  final VoidCallback onMarkPaid;

  String _status(AppLocalizations l10n) {
    final day = week.payoutDay == null
        ? ''
        : displayDate(week.payoutDay!, locale);
    if (week.isPaid) {
      return [
        l10n.ownPayoutsPaidOut,
        if (week.paidAt != null) displayDate(week.paidAt!, locale),
        if (week.method.isNotEmpty) payoutMethodLabel(l10n, week.method),
        if (week.reference.isNotEmpty) week.reference,
      ].join(' · ');
    }
    if (week.status == 'nothing') return l10n.ownPayoutsNothing;
    if (week.isDue) {
      return week.netCents < 0
          ? l10n.ownPayoutsToBill
          : l10n.ownPayoutsPaidOutOn(day);
    }
    return l10n.ownPayoutsCollecting(day);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final weekDay = displayDay(week.weekKey, locale);
    final negative = week.netCents < 0;
    return Container(
      key: Key('payouts-week-${week.businessId}-${week.weekKey}'),
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Material(
        color: AppColors.paper,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          side: const BorderSide(color: AppColors.rule),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            InkWell(
              onTap: onToggle,
              borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (showBusiness)
                            Text(
                              week.businessName.isEmpty
                                  ? week.businessId
                                  : week.businessName,
                              style: const TextStyle(
                                fontSize: 14.5,
                                fontWeight: FontWeight.w700,
                                color: AppColors.ink,
                              ),
                            ),
                          Text(
                            l10n.ownPayoutsWeekOf(weekDay),
                            style: TextStyle(
                              fontSize: showBusiness ? 12.5 : 14.5,
                              fontWeight: showBusiness
                                  ? FontWeight.w400
                                  : FontWeight.w700,
                              color: showBusiness
                                  ? AppColors.muted
                                  : AppColors.ink,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _status(l10n),
                            style: const TextStyle(
                              fontSize: 12,
                              height: 1.35,
                              color: AppColors.muted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Text(
                      formatLotCents(week.netCents),
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: negative ? AppColors.errorRed : AppColors.ink,
                      ),
                    ),
                    if (onToggle != null)
                      Icon(
                        expanded ? Icons.expand_less : Icons.expand_more,
                        size: 20,
                        color: AppColors.muted,
                      ),
                  ],
                ),
              ),
            ),
            if (expanded && week.lines.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md,
                  0,
                  AppSpacing.md,
                  AppSpacing.md,
                ),
                child: Column(
                  children: [
                    for (final line in week.lines)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Text(
                                [
                                  payoutLedgerLabel(l10n, line.type),
                                  if (line.requestCode.isNotEmpty)
                                    line.requestCode,
                                  if (line.at != null)
                                    displayDateTime(line.at!, locale),
                                ].where((s) => s.isNotEmpty).join(' · '),
                                style: const TextStyle(
                                  fontSize: 12.5,
                                  color: AppColors.ink,
                                ),
                              ),
                            ),
                            const SizedBox(width: AppSpacing.sm),
                            Text(
                              formatLotCents(line.amountCents),
                              style: TextStyle(
                                fontSize: 12.5,
                                color: line.amountCents < 0
                                    ? AppColors.errorRed
                                    : AppColors.ink,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            if (canPayOut && week.isDue)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md,
                  0,
                  AppSpacing.md,
                  AppSpacing.md,
                ),
                child: OutlinedButton(
                  key: Key('payouts-mark-${week.businessId}-${week.weekKey}'),
                  onPressed: onMarkPaid,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(44),
                  ),
                  child: Text(
                    week.netCents > 0
                        ? l10n.ownPayoutsMarkPaid
                        : l10n.ownPayoutsPutOnBill,
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// "Mark paid out": how the money was sent (Zelle, bank, other) and an
/// optional reference. A week that nets to nothing or less is put on the
/// business's Laawol bill and asks for neither. Pops with the success line.
class MarkPaidOutSheet extends StatefulWidget {
  const MarkPaidOutSheet({
    super.key,
    required this.week,
    this.service = const PayNowPayoutsService(),
  });

  final PayoutWeek week;
  final PayNowPayoutsService service;

  @override
  State<MarkPaidOutSheet> createState() => _MarkPaidOutSheetState();
}

class _MarkPaidOutSheetState extends State<MarkPaidOutSheet> {
  String _method = 'zelle';
  final _reference = TextEditingController();
  bool _busy = false;
  String _error = '';

  bool get _toBill => widget.week.netCents <= 0;

  @override
  void dispose() {
    _reference.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    final problem = payoutProblem(
      method: _method,
      reference: _reference.text,
      netCents: widget.week.netCents,
    );
    if (problem.isNotEmpty) {
      setState(
        () => _error = problem == 'method_invalid'
            ? l10n.ownPayoutsRefMethod
            : l10n.ownPayoutsRefReferenceLong,
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await widget.service.markPaid(
        widget.week,
        method: _method,
        reference: _reference.text,
      );
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(
        context,
      ).pop(_toBill ? l10n.ownPayoutsDoneBill : l10n.ownPayoutsDonePaid);
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = payoutRefusalText(l10n, failure));
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = l10n.ownPayoutsLoadFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final week = widget.week;
    final name = week.businessName.isEmpty
        ? week.businessId
        : week.businessName;
    return LotSheetShell(
      title: _toBill ? l10n.ownPayoutsSheetTitleBill : l10n.ownPayoutsPaidOut,
      subtitle:
          '$name · ${formatLotCents(week.netCents)} · ${displayDay(week.weekKey, locale)}',
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_error.isNotEmpty) ...[
            Text(
              _error,
              key: const Key('payouts-sheet-error'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('payouts-sheet-save'),
            label: _toBill ? l10n.ownPayoutsPutOnBill : l10n.ownPayoutsMarkPaid,
            busy: _busy,
            tone: LotTone.good,
            onTap: _save,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            _toBill ? l10n.ownPayoutsSheetBillHint : l10n.ownPayoutsSheetHint,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          if (!_toBill) ...[
            const SizedBox(height: AppSpacing.md),
            Text(
              l10n.ownPayoutsHowPaid,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: [
                for (final m in payoutMethods)
                  ChoiceChip(
                    key: Key('payouts-method-$m'),
                    label: Text(payoutMethodLabel(l10n, m)),
                    selected: _method == m,
                    onSelected: _busy
                        ? null
                        : (_) => setState(() => _method = m),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              key: const Key('payouts-reference'),
              controller: _reference,
              enabled: !_busy,
              maxLength: 120,
              decoration: InputDecoration(
                labelText: l10n.ownPayoutsReference,
                hintText: l10n.ownPayoutsReferenceHint,
                counterText: '',
              ),
            ),
          ],
        ],
      ),
    );
  }
}
