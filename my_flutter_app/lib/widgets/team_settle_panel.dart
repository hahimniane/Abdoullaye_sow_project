import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/business_account_receiver.dart';
import '../services/lot_ledger.dart' show lotDollarsToCents;
import '../services/parking_month_statement.dart' show parkingMoney;
import '../services/team_settle.dart';
import '../services/team_settle_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import 'app_snackbars.dart';
import 'lot_sheets.dart';

/// The words for a refused settlement action, by the server's
/// `details.reason`.
String teamSettleRefusalText(AppLocalizations l10n, String reason) =>
    switch (reason) {
      SettleRefusal.noAmount => l10n.pmeTsNoAmount,
      SettleRefusal.moreThanOwed => l10n.pmeTsMoreThanOwed,
      SettleRefusal.nothingOwed => l10n.pmeTsNothingOwed,
      SettleRefusal.scopeInvalid => l10n.pmeTsScopeInvalid,
      SettleRefusal.methodInvalid => l10n.pmeTsMethodInvalid,
      SettleRefusal.monthInvalid => l10n.pmeTsMonthInvalid,
      SettleRefusal.noStatement => l10n.pmeTsNoStatement,
      SettleRefusal.receiverInvalid => l10n.pmeTsReceiverInvalid,
      SettleRefusal.notOwn => l10n.pmeTsNotOwn,
      SettleRefusal.notFound => l10n.pmeTsNotFound,
      SettleRefusal.notReceiver => l10n.pmeTsNotReceiver,
      SettleRefusal.notPending => l10n.pmeTsNotPending,
      SettleRefusal.notUndoable => l10n.pmeTsNotUndoable,
      SettleRefusal.billChanged => l10n.pmeTsBillChanged,
      SettleRefusal.ownerOnly => l10n.pmeTsOwnerOnly,
      SettleRefusal.paybackNotOwed => l10n.pmeTsPaybackNotOwed,
      SettleRefusal.paybackMoreThanOwed => l10n.pmeTsPaybackMore,
      _ => l10n.pmeTsUnknown,
    };

/// A failure as words: offline is "could not save", a permission refusal says
/// so, anything else the server's named reason.
String teamSettleFailureText(AppLocalizations l10n, TeamSettleFailure failure) {
  if (failure.reason.isNotEmpty) {
    return teamSettleRefusalText(l10n, failure.reason);
  }
  if (failure.offline) return l10n.lotCouldNotSave;
  if (failure.notAllowed) return l10n.pmeNotAllowed;
  return l10n.pmeTsUnknown;
}

/// A way of paying, as words.
String teamSettleMethodLabel(AppLocalizations l10n, String method) =>
    switch (method) {
      'cash' => l10n.invMethodCash,
      'zelle' => l10n.invMethodZelle,
      'check' => l10n.invMethodCheck,
      'deposit' => l10n.pmeTsMethodDeposit,
      _ => l10n.invMethodOther,
    };

/// Whole cents as the text a money field starts with ("1227.00"); integer
/// arithmetic, never a float.
String centsInputText(int cents) {
  final abs = cents < 0 ? -cents : cents;
  return '${cents < 0 ? '-' : ''}${abs ~/ 100}.'
      '${(abs % 100).toString().padLeft(2, '0')}';
}

String _scopeLabel(AppLocalizations l10n, String scope) => switch (scope) {
  SettleScope.cash => l10n.pmeTsScopeCash,
  SettleScope.parking => l10n.pmeTsScopeParking,
  _ => l10n.pmeTsScopeEverything,
};

/// Confirms or declines a settlement waiting for the signed-in person.
/// Decline asks for an optional reason first. Returns whether it was done;
/// a refusal is shown in words.
Future<bool> answerTeamSettlement(
  BuildContext context, {
  required TeamSettleService service,
  required String businessId,
  required SettlementRecord record,
  required String staffName,
  required bool confirm,
  void Function(bool busy)? onBusy,
}) async {
  final l10n = AppLocalizations.of(context)!;
  String note = '';
  if (!confirm) {
    final answer = await _askDeclineReason(
      context,
      amount: parkingMoney(record.amountCents),
      staffName: staffName,
    );
    if (answer == null || !context.mounted) return false;
    note = answer;
  }
  // Busy only while the server answers, never while a question is open.
  onBusy?.call(true);
  try {
    final result = confirm
        ? await service.confirm(businessId: businessId, settlementId: record.id)
        : await service.decline(
            businessId: businessId,
            settlementId: record.id,
            note: note,
          );
    if (!context.mounted) return true;
    AppHaptics.commit();
    showSuccessSnackBar(
      context,
      confirm ? l10n.pmeTsDoneConfirmed : l10n.pmeTsDoneDeclined,
    );
    if (result.receipt == 'failed') {
      showErrorSnackBar(context, l10n.pmeTsReceiptFailed);
    }
    return true;
  } on TeamSettleFailure catch (failure) {
    if (context.mounted) {
      AppHaptics.refuse();
      showErrorSnackBar(context, teamSettleFailureText(l10n, failure));
    }
  } catch (_) {
    if (context.mounted) showErrorSnackBar(context, l10n.lotCouldNotSave);
  } finally {
    onBusy?.call(false);
  }
  return false;
}

Future<String?> _askDeclineReason(
  BuildContext context, {
  required String amount,
  required String staffName,
}) {
  final l10n = AppLocalizations.of(context)!;
  final controller = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l10n.pmeTsDeclineTitle),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('$amount · $staffName'),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('team-settle-decline-note'),
            controller: controller,
            maxLength: 300,
            decoration: InputDecoration(
              labelText: l10n.pmeTsDeclineWhy,
              counterText: '',
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(),
          child: Text(l10n.cancel),
        ),
        TextButton(
          key: const Key('team-settle-decline-confirm'),
          style: TextButton.styleFrom(foregroundColor: AppColors.errorRed),
          onPressed: () => Navigator.of(dialogContext).pop(controller.text),
          child: Text(l10n.pmeTsDecline),
        ),
      ],
    ),
  );
}

/// "I paid everything" on a team member's Month end card
/// (docs/TEAM_SETTLE.md): the member says they paid their month; it counts
/// once the receiver confirms. The receiver confirms or declines; anyone on
/// the team can undo a settlement that counts. When the business owes the
/// member, the owner (or Full access) records "Paid them back".
class TeamSettlePanel extends StatefulWidget {
  const TeamSettlePanel({
    super.key,
    required this.businessId,
    required this.monthKey,
    required this.staffId,
    required this.staffName,
    required this.owesCents,
    required this.parkingJobsCents,
    required this.expenseCents,
    required this.cashHeldCents,
    required this.settlements,
    required this.receivers,
    required this.names,
    required this.myUid,
    required this.isReceiver,
    required this.estimating,
    this.service = const TeamSettleService(),
  });

  final String businessId;
  final String monthKey;

  /// The team member whose statement this is.
  final String staffId;
  final String staffName;

  /// The statement's number: positive = they owe the business, negative =
  /// the business owes them.
  final int owesCents;
  final int parkingJobsCents;
  final int expenseCents;
  final int cashHeldCents;

  /// This member's settlements, oldest first.
  final List<SettlementRecord> settlements;

  /// Everyone who may receive: the owner and people with Full access.
  final List<({String id, String name})> receivers;
  final Map<String, String> names;
  final String myUid;

  /// The signed-in person is the owner, has Full access, or is a platform
  /// admin.
  final bool isReceiver;
  final bool estimating;
  final TeamSettleService service;

  @override
  State<TeamSettlePanel> createState() => _TeamSettlePanelState();
}

class _TeamSettlePanelState extends State<TeamSettlePanel> {
  String _busy = '';

  SettleStatement get _statement => SettleStatement(
    parkingJobsCents: widget.parkingJobsCents,
    expenseCents: widget.expenseCents,
    cashHeldCents: widget.cashHeldCents,
  );

  bool get _mine => widget.staffId == widget.myUid;

  String _nameOf(String id) => isBusinessAccountReceiver(id)
      ? AppLocalizations.of(context)!.sbalBusinessAccount
      : widget.names[id] ?? '';

  Future<void> _openSettle() async {
    final l10n = AppLocalizations.of(context)!;
    final done = await showLotSheet<String>(
      context,
      TeamSettleSheet(
        businessId: widget.businessId,
        monthKey: widget.monthKey,
        staffId: widget.staffId,
        staffName: widget.staffName,
        statement: _statement,
        receivers: widget.receivers,
        myUid: widget.myUid,
        mine: _mine,
        isReceiver: widget.isReceiver,
        service: widget.service,
      ),
    );
    if (done == null || !mounted) return;
    showSuccessSnackBar(
      context,
      done == 'direct' ? l10n.pmeTsDoneRecorded : l10n.pmeTsDoneSent,
    );
  }

  Future<void> _openPayback() async {
    final l10n = AppLocalizations.of(context)!;
    final done = await showLotSheet<bool>(
      context,
      TeamPaybackSheet(
        businessId: widget.businessId,
        monthKey: widget.monthKey,
        staffId: widget.staffId,
        staffName: widget.staffName,
        owesCents: widget.owesCents,
        service: widget.service,
      ),
    );
    if (done == true && mounted) {
      showSuccessSnackBar(context, l10n.pmeTsDonePayback);
    }
  }

  Future<void> _answer(SettlementRecord record, bool confirm) async {
    if (_busy.isNotEmpty) return;
    await answerTeamSettlement(
      context,
      service: widget.service,
      businessId: widget.businessId,
      record: record,
      staffName: widget.staffName,
      confirm: confirm,
      onBusy: (busy) {
        if (mounted) setState(() => _busy = busy ? record.id : '');
      },
    );
  }

  Future<void> _undo(SettlementRecord record) async {
    final l10n = AppLocalizations.of(context)!;
    if (_busy.isNotEmpty) return;
    final pending = record.pending;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(pending ? l10n.pmeTsCancelTitle : l10n.pmeTsUndoTitle),
        content: Text(
          '${parkingMoney(record.amountCents)} · ${widget.staffName}\n\n'
          '${pending ? l10n.pmeTsCancelBody : l10n.pmeTsUndoBody}',
        ),
        actions: [
          TextButton(
            key: const Key('team-settle-undo-keep'),
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.pmeTsKeepIt),
          ),
          TextButton(
            key: const Key('team-settle-undo-confirm'),
            style: TextButton.styleFrom(foregroundColor: AppColors.errorRed),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(pending ? l10n.pmeTsCancelDo : l10n.pmeTsUndoDo),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = record.id);
    try {
      await widget.service.undo(
        businessId: widget.businessId,
        settlementId: record.id,
      );
      if (mounted) {
        AppHaptics.commit();
        showSuccessSnackBar(context, l10n.pmeTsDoneUndone);
      }
    } on TeamSettleFailure catch (failure) {
      if (mounted) {
        AppHaptics.refuse();
        showErrorSnackBar(context, teamSettleFailureText(l10n, failure));
      }
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final canFile =
        !widget.estimating &&
        widget.owesCents > 0 &&
        (_mine || widget.isReceiver);
    final canPayback =
        !widget.estimating && widget.owesCents < 0 && widget.isReceiver;
    if (!canFile && !canPayback && widget.settlements.isEmpty) {
      return const SizedBox.shrink();
    }
    final locale = dateLocaleOf(context);
    String when(int ms) => ms > 0
        ? displayDateTime(DateTime.fromMillisecondsSinceEpoch(ms), locale)
        : '';
    return Padding(
      key: const Key('team-settle-panel'),
      padding: const EdgeInsets.only(top: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Divider(height: 16),
          Text(
            l10n.pmeTsTitle,
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: 4),
          for (final s in widget.settlements)
            _SettlementRow(
              key: Key('team-settle-${s.id}'),
              record: s,
              receiver: _nameOf(s.receiverId),
              undoneBy: _nameOf(s.undoneByUid),
              confirmedAt: when(s.confirmedAtMs),
              undoneAt: when(s.undoneAtMs),
              answerable: mayAnswerSettlement(
                s,
                uid: widget.myUid,
                isReceiver: widget.isReceiver,
              ),
              busy: _busy == s.id,
              anyBusy: _busy.isNotEmpty,
              onConfirm: () => _answer(s, true),
              onDecline: () => _answer(s, false),
              onUndo: () => _undo(s),
            ),
          if (canFile) ...[
            const SizedBox(height: AppSpacing.xs),
            OutlinedButton.icon(
              key: const Key('team-settle-open'),
              onPressed: _busy.isNotEmpty ? null : _openSettle,
              icon: const Icon(Icons.payments_outlined, size: 18),
              label: Text(
                '${_mine ? l10n.pmeTsPaidEverything : l10n.pmeTsTheyPaid}'
                ' · ${parkingMoney(defaultSettleCents(_statement))}',
              ),
            ),
          ],
          if (canPayback) ...[
            const SizedBox(height: AppSpacing.xs),
            OutlinedButton.icon(
              key: const Key('team-payback-open'),
              onPressed: _busy.isNotEmpty ? null : _openPayback,
              icon: const Icon(Icons.payments_outlined, size: 18),
              label: Text(
                '${l10n.pmeTsPaidThemBack} · '
                '${parkingMoney(-widget.owesCents)}',
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SettlementRow extends StatelessWidget {
  const _SettlementRow({
    super.key,
    required this.record,
    required this.receiver,
    required this.undoneBy,
    required this.confirmedAt,
    required this.undoneAt,
    required this.answerable,
    required this.busy,
    required this.anyBusy,
    required this.onConfirm,
    required this.onDecline,
    required this.onUndo,
  });

  final SettlementRecord record;
  final String receiver;
  final String undoneBy;
  final String confirmedAt;
  final String undoneAt;
  final bool answerable;
  final bool busy;
  final bool anyBusy;
  final VoidCallback onConfirm;
  final VoidCallback onDecline;
  final VoidCallback onUndo;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final s = record;
    final dim = s.status == 'undone' || s.status == 'declined';
    final ink = dim ? AppColors.muted : AppColors.ink;
    final status = switch (s.status) {
      'pending' =>
        answerable
            ? l10n.pmeTsWaitingForYou
            : l10n.pmeTsWaitingFor(receiver.isEmpty ? '—' : receiver),
      'confirmed' =>
        confirmedAt.isEmpty
            ? l10n.pmeTsConfirmedPlain
            : l10n.pmeTsConfirmed(confirmedAt),
      'declined' =>
        s.declineNote.isEmpty
            ? l10n.pmeTsDeclined
            : '${l10n.pmeTsDeclined} · ${s.declineNote}',
      _ => [
        undoneAt.isEmpty ? l10n.pmeTsUndonePlain : l10n.pmeTsUndone(undoneAt),
        if (undoneBy.isNotEmpty) l10n.pmeTsUndoneBy(undoneBy),
      ].join(' · '),
    };
    final detail = [
      status,
      teamSettleMethodLabel(l10n, s.method),
      if (s.status != 'pending' && receiver.isNotEmpty)
        l10n.pmeTsReceivedBy(receiver),
    ].where((x) => x.isNotEmpty).join(' · ');
    final split = [
      if (s.cashCents > 0)
        '${l10n.pmeTsPreviewCash} ${parkingMoney(s.cashCents)}',
      if (s.parkingCents > 0)
        '${l10n.pmeTsPreviewParking} ${parkingMoney(s.parkingCents)}',
      l10n.pmeTsStatementWas(parkingMoney(s.statementOwedCents)),
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            parkingMoney(s.amountCents),
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: ink,
              decoration: dim ? TextDecoration.lineThrough : null,
            ),
          ),
          Text(
            detail,
            key: Key('team-settle-status-${s.id}'),
            style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
          ),
          Text(
            split,
            style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
          ),
          if (answerable)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Wrap(
                spacing: AppSpacing.sm,
                runSpacing: 4,
                children: [
                  FilledButton(
                    key: Key('team-settle-confirm-${s.id}'),
                    onPressed: anyBusy ? null : onConfirm,
                    child: busy
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(l10n.pmeTsConfirm),
                  ),
                  OutlinedButton(
                    key: Key('team-settle-decline-${s.id}'),
                    onPressed: anyBusy ? null : onDecline,
                    child: Text(l10n.pmeTsDecline),
                  ),
                ],
              ),
            )
          else if (s.status == 'confirmed' || s.status == 'pending')
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                key: Key('team-settle-undo-${s.id}'),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: const Size(0, 32),
                  foregroundColor: AppColors.errorRed,
                ),
                onPressed: anyBusy ? null : onUndo,
                child: busy
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        s.status == 'pending'
                            ? l10n.pmeTsCancelPending
                            : l10n.pmeTsUndo,
                      ),
              ),
            ),
        ],
      ),
    );
  }
}

/// "I paid everything": what it is for, how much, who received it and how.
/// Pops 'direct' (it counts at once: the owner filed it for someone and took
/// it) or 'sent' (it waits for the receiver).
class TeamSettleSheet extends StatefulWidget {
  const TeamSettleSheet({
    super.key,
    required this.businessId,
    required this.monthKey,
    required this.staffId,
    required this.staffName,
    required this.statement,
    required this.receivers,
    required this.myUid,
    required this.mine,
    required this.isReceiver,
    this.service = const TeamSettleService(),
  });

  final String businessId;
  final String monthKey;
  final String staffId;
  final String staffName;
  final SettleStatement statement;
  final List<({String id, String name})> receivers;
  final String myUid;
  final bool mine;
  final bool isReceiver;
  final TeamSettleService service;

  @override
  State<TeamSettleSheet> createState() => _TeamSettleSheetState();
}

class _TeamSettleSheetState extends State<TeamSettleSheet> {
  late final TextEditingController _amount = TextEditingController(
    text: centsInputText(defaultSettleCents(widget.statement)),
  );
  final _note = TextEditingController();
  String _scope = SettleScope.everything;
  String _method = 'cash';
  late String _receiverId = _defaultReceiver();
  bool _busy = false;
  String _error = '';

  /// Everyone who can receive it, but never the member themselves; the
  /// Business account last.
  List<({String id, String name})> _options(AppLocalizations l10n) => [
    for (final r in widget.receivers)
      if (r.id != widget.staffId) r,
    (id: businessAccountReceiver, name: l10n.sbalBusinessAccount),
  ];

  String _defaultReceiver() {
    // A receiver filing it for the member is the receiver themselves; the
    // member picks the owner (or whoever took it).
    final ids = [
      for (final r in widget.receivers)
        if (r.id != widget.staffId) r.id,
    ];
    if (widget.isReceiver && !widget.mine && ids.contains(widget.myUid)) {
      return widget.myUid;
    }
    return ids.isNotEmpty ? ids.first : businessAccountReceiver;
  }

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  int get _typedCents => lotDollarsToCents(_amount.text) ?? 0;

  SettlePlan get _plan => teamSettlePlan(
    statement: widget.statement,
    amountCents: _typedCents,
    scope: _scope,
  );

  int _limitFor(String scope) {
    final limits = settleLimits(widget.statement);
    return scope == SettleScope.cash
        ? limits.cashDueCents
        : scope == SettleScope.parking
        ? limits.parkingDueCents
        : defaultSettleCents(widget.statement);
  }

  Future<void> _pickScope() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.pmeTsScope,
      selected: _scope,
      options: [
        for (final s in SettleScope.all) LotOption(s, _scopeLabel(l10n, s)),
      ],
    );
    if (picked != null && mounted) {
      setState(() {
        _scope = picked;
        _amount.text = centsInputText(_limitFor(picked));
        _error = '';
      });
    }
  }

  Future<void> _pickReceiver() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.pmeTsReceiver,
      selected: _receiverId,
      options: [for (final o in _options(l10n)) LotOption(o.id, o.name)],
    );
    if (picked != null && mounted) setState(() => _receiverId = picked);
  }

  Future<void> _pickMethod() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.invPayMethod,
      selected: _method,
      options: [
        for (final m in settleMethods)
          LotOption(m, teamSettleMethodLabel(l10n, m)),
      ],
    );
    if (picked != null && mounted) setState(() => _method = picked);
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    final plan = _plan;
    if (_busy || !plan.ok || _receiverId.isEmpty) return;
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final result = await widget.service.request(
        businessId: widget.businessId,
        monthKey: widget.monthKey,
        staffId: widget.staffId,
        amountCents: _typedCents,
        scope: _scope,
        receiverId: _receiverId,
        method: _method,
        note: _note.text,
      );
      if (!mounted) return;
      AppHaptics.commit();
      final direct =
          widget.isReceiver &&
          !widget.mine &&
          (_receiverId == widget.myUid ||
              _receiverId == businessAccountReceiver);
      Navigator.of(context).pop(direct ? 'direct' : 'sent');
      if (result.receipt == 'failed') {
        showErrorSnackBar(context, l10n.pmeTsReceiptFailed);
      }
    } on TeamSettleFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = teamSettleFailureText(l10n, failure));
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final plan = _plan;
    final typed = _amount.text.trim().isNotEmpty;
    final receiverName = _options(
      l10n,
    ).where((o) => o.id == _receiverId).firstOrNull?.name;
    return LotSheetShell(
      title: l10n.pmeTsPaidEverything,
      subtitle: widget.staffName,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_error.isNotEmpty) ...[
            Text(
              _error,
              key: const Key('team-settle-error'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('team-settle-save'),
            label: l10n.pmeTsPaidEverything,
            busy: _busy,
            tone: LotTone.good,
            onTap: plan.ok && _receiverId.isNotEmpty ? _save : null,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.pmeTsSheetHint,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            key: const Key('team-settle-scope'),
            label: l10n.pmeTsScope,
            value: _scopeLabel(l10n, _scope),
            placeholder: l10n.pmeTsScope,
            onTap: _busy ? () {} : _pickScope,
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('team-settle-amount'),
            controller: _amount,
            enabled: !_busy,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() => _error = ''),
            decoration: InputDecoration(
              labelText: l10n.pmeTsAmountPaid,
              prefixText: r'$ ',
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          if (plan.ok)
            Column(
              key: const Key('team-settle-preview'),
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (plan.cashCents > 0)
                  _PreviewLine(
                    l10n.pmeTsPreviewCash,
                    parkingMoney(plan.cashCents),
                  ),
                if (plan.parkingCents > 0)
                  _PreviewLine(
                    l10n.pmeTsPreviewParking,
                    parkingMoney(plan.parkingCents),
                  ),
                const Divider(height: 14),
                _PreviewLine(
                  l10n.pmeTsPreviewLeft,
                  parkingMoney(plan.leftCents),
                  bold: true,
                ),
              ],
            )
          else if (typed)
            Text(
              teamSettleRefusalText(l10n, plan.reason),
              key: const Key('team-settle-refusal'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
            ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            key: const Key('team-settle-receiver'),
            label: l10n.pmeTsReceiver,
            value: receiverName,
            placeholder: l10n.pmeTsPickReceiver,
            onTap: _busy ? () {} : _pickReceiver,
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            key: const Key('team-settle-method'),
            label: l10n.invPayMethod,
            value: teamSettleMethodLabel(l10n, _method),
            placeholder: l10n.invPayMethod,
            onTap: _busy ? () {} : _pickMethod,
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _note,
            enabled: !_busy,
            maxLength: 300,
            decoration: InputDecoration(
              labelText: l10n.invPayNote,
              counterText: '',
            ),
          ),
        ],
      ),
    );
  }
}

class _PreviewLine extends StatelessWidget {
  const _PreviewLine(this.label, this.amount, {this.bold = false});

  final String label;
  final String amount;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontSize: bold ? 14 : 13,
      fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
      color: AppColors.ink,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          const SizedBox(width: 8),
          Text(amount, style: style),
        ],
      ),
    );
  }
}

/// "Paid them back": the business owes the member (their statement is
/// negative) and pays it. Pops true once recorded.
class TeamPaybackSheet extends StatefulWidget {
  const TeamPaybackSheet({
    super.key,
    required this.businessId,
    required this.monthKey,
    required this.staffId,
    required this.staffName,
    required this.owesCents,
    this.service = const TeamSettleService(),
  });

  final String businessId;
  final String monthKey;
  final String staffId;
  final String staffName;
  final int owesCents;
  final TeamSettleService service;

  @override
  State<TeamPaybackSheet> createState() => _TeamPaybackSheetState();
}

class _TeamPaybackSheetState extends State<TeamPaybackSheet> {
  late final TextEditingController _amount = TextEditingController(
    text: centsInputText(-widget.owesCents),
  );
  final _note = TextEditingController();
  String _method = 'cash';
  bool _busy = false;
  String _error = '';

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  int get _typedCents => lotDollarsToCents(_amount.text) ?? 0;

  String get _problem => paybackRefusal(
    owesCents: widget.owesCents,
    amountCents: _typedCents,
    method: _method,
  );

  Future<void> _pickMethod() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.invPayMethod,
      selected: _method,
      options: [
        for (final m in paybackMethods)
          LotOption(m, teamSettleMethodLabel(l10n, m)),
      ],
    );
    if (picked != null && mounted) setState(() => _method = picked);
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    if (_busy || _problem.isNotEmpty) return;
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await widget.service.payback(
        businessId: widget.businessId,
        monthKey: widget.monthKey,
        staffId: widget.staffId,
        amountCents: _typedCents,
        method: _method,
        note: _note.text,
      );
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(true);
    } on TeamSettleFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = teamSettleFailureText(l10n, failure));
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final problem = _problem;
    final typed = _amount.text.trim().isNotEmpty;
    return LotSheetShell(
      title: l10n.pmeTsPaidThemBack,
      subtitle: widget.staffName,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_error.isNotEmpty) ...[
            Text(
              _error,
              key: const Key('team-payback-error'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('team-payback-save'),
            label: l10n.pmeTsPaidThemBack,
            busy: _busy,
            tone: LotTone.good,
            onTap: problem.isEmpty ? _save : null,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.pmeTsPaybackHint(parkingMoney(-widget.owesCents)),
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('team-payback-amount'),
            controller: _amount,
            enabled: !_busy,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() => _error = ''),
            decoration: InputDecoration(
              labelText: l10n.pmeTsPaybackAmount,
              prefixText: r'$ ',
            ),
          ),
          if (problem.isNotEmpty && typed) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              teamSettleRefusalText(l10n, problem),
              key: const Key('team-payback-refusal'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            key: const Key('team-payback-method'),
            label: l10n.invPayMethod,
            value: teamSettleMethodLabel(l10n, _method),
            placeholder: l10n.invPayMethod,
            onTap: _busy ? () {} : _pickMethod,
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _note,
            enabled: !_busy,
            maxLength: 300,
            decoration: InputDecoration(
              labelText: l10n.invPayNote,
              counterText: '',
            ),
          ),
        ],
      ),
    );
  }
}

/// "Waiting for your OK": the settlements waiting for the signed-in person
/// to confirm, at the top of Month end so none is missed. Each can be
/// confirmed or declined right here. Hidden when nothing waits.
class TeamSettleWaitingCard extends StatefulWidget {
  const TeamSettleWaitingCard({
    super.key,
    required this.businessId,
    required this.waiting,
    required this.names,
    this.service = const TeamSettleService(),
  });

  final String businessId;
  final List<SettlementRecord> waiting;
  final Map<String, String> names;
  final TeamSettleService service;

  @override
  State<TeamSettleWaitingCard> createState() => _TeamSettleWaitingCardState();
}

class _TeamSettleWaitingCardState extends State<TeamSettleWaitingCard> {
  String _busy = '';

  Future<void> _answer(SettlementRecord record, bool confirm) async {
    if (_busy.isNotEmpty) return;
    await answerTeamSettlement(
      context,
      service: widget.service,
      businessId: widget.businessId,
      record: record,
      staffName: widget.names[record.staffId] ?? '',
      confirm: confirm,
      onBusy: (busy) {
        if (mounted) setState(() => _busy = busy ? record.id : '');
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.waiting.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    return Container(
      key: const Key('team-settle-waiting'),
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.warn.withValues(alpha: 0.6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.pmeTsWaitingTitle,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          for (final r in widget.waiting)
            Padding(
              key: Key('team-settle-waiting-${r.id}'),
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.pmeTsWaitingLine(
                      widget.names[r.staffId] ?? '—',
                      parkingMoney(r.amountCents),
                    ),
                    style: const TextStyle(
                      fontSize: 13.5,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: 4,
                    children: [
                      FilledButton(
                        key: Key('team-settle-waiting-confirm-${r.id}'),
                        onPressed: _busy.isNotEmpty
                            ? null
                            : () => _answer(r, true),
                        child: _busy == r.id
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : Text(l10n.pmeTsConfirm),
                      ),
                      OutlinedButton(
                        key: Key('team-settle-waiting-decline-${r.id}'),
                        onPressed: _busy.isNotEmpty
                            ? null
                            : () => _answer(r, false),
                        child: Text(l10n.pmeTsDecline),
                      ),
                    ],
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
