import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory_context.dart';
import '../services/inventory_transfers.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/inventory_transfer_widgets.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import 'inventory_transfers_screen.dart' show InventoryTransferEnv;

InventoryContextWatcher _storesWatcher(
  InventoryTransferEnv env,
  VoidCallback onChange,
) => InventoryContextWatcher(
  source: env.source,
  businessId: env.businessId,
  access: env.access,
  watchCategories: false,
  watchBrands: false,
  onChange: onChange,
);

// ---------------------------------------------------------------------------
// Receive.
// ---------------------------------------------------------------------------

/// The destination confirms what arrived. Every line starts at what was
/// sent; a number is changed only when it differs (0 up to what was sent).
/// Confirm received: if everything arrived it is done at once; if fewer
/// arrived a sheet says how many did not and takes an optional note first.
class InventoryTransferReceiveScreen extends StatefulWidget {
  const InventoryTransferReceiveScreen({
    super.key,
    required this.env,
    required this.transfer,
  });

  final InventoryTransferEnv env;
  final InventoryTransfer transfer;

  @override
  State<InventoryTransferReceiveScreen> createState() =>
      _InventoryTransferReceiveScreenState();
}

class _InventoryTransferReceiveScreenState
    extends State<InventoryTransferReceiveScreen> {
  late final Map<String, int> _counted = inventoryTransferReceivePrefill(
    widget.transfer,
  );
  late final InventoryContextWatcher _watcher = _storesWatcher(widget.env, () {
    if (mounted) setState(() {});
  });

  /// One key for this receive, so a retry after a lost answer is the same
  /// receive (`replayed`), never a second one.
  late final String _requestId = widget.env.newRequestId();
  bool _busy = false;
  String? _error;

  InventoryTransfer get _t => widget.transfer;

  @override
  void initState() {
    super.initState();
    _watcher.start();
  }

  @override
  void dispose() {
    _watcher.dispose();
    super.dispose();
  }

  Future<bool> _receive(String note) async {
    final l10n = AppLocalizations.of(context)!;
    try {
      await widget.env.service.receiveTransfer(
        businessId: widget.env.businessId,
        transfer: _t,
        counted: Map.of(_counted),
        requestId: _requestId,
        note: note,
      );
      if (!mounted) return true;
      AppHaptics.commit();
      final missing = inventoryTransferMissing(_t, _counted);
      showSuccessSnackBar(
        context,
        missing > 0
            ? l10n.invTrReceivedDoneMissing
            : l10n.invTrReceivedDone(_t.toName(_watcher.context)),
      );
      return true;
    } catch (error) {
      if (!mounted) return false;
      AppHaptics.refuse();
      setState(() => _error = inventoryTransferFailureText(l10n, error));
      return false;
    }
  }

  Future<void> _confirm() async {
    if (_busy) return;
    final missing = inventoryTransferMissing(_t, _counted);
    if (missing > 0) {
      setState(() => _error = null);
      final stores = _watcher.context;
      final ok = await showLotSheet<bool>(
        context,
        InventoryTransferMissingSheet(
          transfer: _t,
          counted: Map.of(_counted),
          storeName: _t.toName(stores),
          onConfirm: _receive,
        ),
      );
      if (ok == true && mounted) Navigator.of(context).maybePop();
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    var ok = false;
    try {
      ok = await _receive('');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (ok && mounted) Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final stores = _watcher.context;
    final t = _t;
    final counted = inventoryTransferCounted(t, _counted);
    final sent = t.lines.fold<int>(0, (sum, l) => sum + l.quantitySent);
    final toName = t.toName(stores);
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(
            title: l10n.invTrReceiveTitle,
            subtitle: l10n.invTrIncomingAt(toName),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                AppSpacing.xl,
              ),
              children: [
                Text(
                  l10n.invTrItemsFrom(sent, t.fromName(stores)),
                  key: const Key('inv-tr-receive-from'),
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
                Text(
                  [
                    if (t.sentAt != null)
                      l10n.invTrSentOnBy(
                        displayMonthDayTime(t.sentAt!, locale),
                        inventoryTransferPerson(l10n, t.sentByName),
                      ),
                    if (t.code.isNotEmpty) t.code,
                  ].join(' · '),
                  style: const TextStyle(fontSize: 13, color: AppColors.muted),
                ),
                const SizedBox(height: AppSpacing.md),
                Text(
                  l10n.invTrReceiveHelp,
                  style: const TextStyle(
                    fontSize: 13.5,
                    height: 1.4,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                for (final line in t.lines)
                  _ReceiveLine(
                    key: ValueKey('inv-tr-recv-${line.itemId}'),
                    line: line,
                    counted: _counted[line.itemId] ?? line.quantitySent,
                    enabled: !_busy,
                    onChanged: (n) => setState(() {
                      _error = null;
                      _counted[line.itemId] = n;
                    }),
                  ),
                if (_error != null) ...[
                  const SizedBox(height: AppSpacing.sm),
                  InventoryNote(
                    key: const Key('inv-tr-receive-error'),
                    text: _error!,
                  ),
                ],
                const SizedBox(height: AppSpacing.md),
                Text(
                  l10n.invTrReceiveFooter(toName),
                  style: const TextStyle(
                    fontSize: 13,
                    height: 1.4,
                    color: AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.md,
              AppSpacing.lg,
              AppSpacing.lg,
            ),
            decoration: const BoxDecoration(
              color: AppColors.paper,
              border: Border(top: BorderSide(color: AppColors.rule)),
            ),
            child: SafeArea(
              top: false,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    l10n.invTrArrivedOf(counted, sent),
                    key: const Key('inv-tr-arrived'),
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: counted < sent ? AppColors.warn : AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  LotSheetButton(
                    key: const Key('inv-tr-confirm-received'),
                    label: l10n.invTrConfirmReceived,
                    busy: _busy,
                    busyLabel: l10n.invTrConfirming,
                    onTap: _busy ? null : _confirm,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ReceiveLine extends StatelessWidget {
  const _ReceiveLine({
    super.key,
    required this.line,
    required this.counted,
    required this.enabled,
    required this.onChanged,
  });

  final InventoryTransferLine line;
  final int counted;
  final bool enabled;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final fewer = line.quantitySent - counted;
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: fewer > 0
            ? AppColors.saffron.withValues(alpha: 0.07)
            : AppColors.paper,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: fewer > 0
              ? AppColors.saffron.withValues(alpha: 0.55)
              : AppColors.rule,
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  line.displayName,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                Text(
                  l10n.invTrSentQty(line.quantitySent),
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.muted,
                  ),
                ),
                if (fewer > 0)
                  Text(
                    l10n.invTrFewer(fewer),
                    key: Key('inv-tr-fewer-${line.itemId}'),
                    style: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.warn,
                    ),
                  ),
              ],
            ),
          ),
          InventoryStepper(
            keyPrefix: 'inv-tr-recv-qty-${line.itemId}',
            value: counted,
            minusLabel: l10n.invTrLess,
            plusLabel: l10n.invTrMore,
            onMinus: enabled && counted > 0
                ? () => onChanged(counted - 1)
                : null,
            onPlus: enabled && counted < line.quantitySent
                ? () => onChanged(counted + 1)
                : null,
          ),
        ],
      ),
    );
  }
}

/// "2 items didn't arrive": what came up short, an optional "What
/// happened?", Go back or Confirm 12 received. [onConfirm] sends the receive
/// and answers whether it went through; the sheet closes only then.
class InventoryTransferMissingSheet extends StatefulWidget {
  const InventoryTransferMissingSheet({
    super.key,
    required this.transfer,
    required this.counted,
    required this.storeName,
    required this.onConfirm,
  });

  final InventoryTransfer transfer;
  final Map<String, int> counted;
  final String storeName;
  final Future<bool> Function(String note) onConfirm;

  @override
  State<InventoryTransferMissingSheet> createState() =>
      _InventoryTransferMissingSheetState();
}

class _InventoryTransferMissingSheetState
    extends State<InventoryTransferMissingSheet> {
  final TextEditingController _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _confirm() async {
    if (_busy) return;
    final navigator = Navigator.of(context);
    setState(() => _busy = true);
    final ok = await widget.onConfirm(_note.text);
    if (!mounted) return;
    setState(() => _busy = false);
    // On a refusal the sheet closes too: the receive screen shows why.
    if (navigator.canPop()) navigator.pop(ok);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final t = widget.transfer;
    final missing = inventoryTransferMissing(t, widget.counted);
    final counted = inventoryTransferCounted(t, widget.counted);
    final sent = t.lines.fold<int>(0, (sum, l) => sum + l.quantitySent);
    final short = inventoryTransferShortLines(t, widget.counted);
    return LotSheetShell(
      title: l10n.invTrMissingTitle(missing),
      subtitle: l10n.invTrMissingBody(counted, sent),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final row in short)
            Container(
              key: ValueKey('inv-tr-missing-${row.line.itemId}'),
              margin: const EdgeInsets.only(bottom: AppSpacing.sm),
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.errorRed.withValues(alpha: 0.05),
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                border: Border.all(
                  color: AppColors.errorRed.withValues(alpha: 0.3),
                ),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      l10n.invTrMissingLine(
                        row.line.displayName,
                        row.line.quantitySent,
                        row.counted,
                      ),
                      style: const TextStyle(
                        fontSize: 13.5,
                        color: AppColors.ink,
                      ),
                    ),
                  ),
                  Text(
                    '−${row.line.quantitySent - row.counted}',
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: AppColors.errorRed,
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: AppSpacing.sm),
          TextField(
            key: const Key('inv-tr-missing-note'),
            controller: _note,
            maxLength: inventoryTransferMaxNote,
            maxLines: 2,
            minLines: 1,
            enabled: !_busy,
            decoration: InputDecoration(labelText: l10n.invTrWhatHappened),
          ),
          Text(
            l10n.invTrMissingStayOff,
            style: const TextStyle(
              fontSize: 12.5,
              height: 1.4,
              color: AppColors.muted,
            ),
          ),
          if (counted > 0) ...[
            const SizedBox(height: 4),
            Text(
              l10n.invTrArrivedCanSell(widget.storeName),
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.4,
                color: AppColors.muted,
              ),
            ),
          ],
        ],
      ),
      footer: Row(
        children: [
          Expanded(
            child: OutlinedButton(
              key: const Key('inv-tr-missing-back'),
              onPressed: _busy ? null : () => Navigator.of(context).pop(false),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(50),
                foregroundColor: AppColors.ink,
              ),
              child: Text(l10n.invTrGoBack),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            flex: 2,
            child: LotSheetButton(
              key: const Key('inv-tr-missing-confirm'),
              label: l10n.invTrConfirmCount(counted),
              busy: _busy,
              busyLabel: l10n.invTrConfirming,
              onTap: _busy ? null : _confirm,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// The owner's review.
// ---------------------------------------------------------------------------

/// Only what did not arrive: per missing line, Return to the source store or
/// Write off with a reason (Lost in transit, Damaged, Stolen, Other) and an
/// optional note. When every line is decided the transfer is settled.
class InventoryTransferReviewScreen extends StatefulWidget {
  const InventoryTransferReviewScreen({
    super.key,
    required this.env,
    required this.transfer,
  });

  final InventoryTransferEnv env;
  final InventoryTransfer transfer;

  @override
  State<InventoryTransferReviewScreen> createState() =>
      _InventoryTransferReviewScreenState();
}

class _InventoryTransferReviewScreenState
    extends State<InventoryTransferReviewScreen> {
  late InventoryTransfer _t = widget.transfer;
  StreamSubscription<InventoryTransfer?>? _sub;
  late final InventoryContextWatcher _watcher = _storesWatcher(widget.env, () {
    if (mounted) setState(() {});
  });

  /// One retry key per line and decision.
  final Map<String, String> _keys = {};

  /// The line whose write-off form is open, its reason and note.
  String _writingOff = '';
  String _reason = '';
  final TextEditingController _note = TextEditingController();
  String _busy = '';

  /// Lines decided on this screen and how they read, until the live
  /// document shows it.
  final Map<String, String> _decided = {};

  @override
  void initState() {
    super.initState();
    _watcher.start();
    _sub = widget.env.transfers
        .watchTransfer(widget.env.businessId, widget.transfer.id)
        .listen((t) {
          if (mounted && t != null) setState(() => _t = t);
        }, onError: (_) {});
  }

  @override
  void dispose() {
    _sub?.cancel();
    _watcher.dispose();
    _note.dispose();
    super.dispose();
  }

  String _key(String itemId, bool writeOff) => _keys.putIfAbsent(
    '$itemId|${writeOff ? 'w' : 'r'}',
    widget.env.newRequestId,
  );

  Future<void> _resolve(
    InventoryTransferLine line, {
    required bool writeOff,
  }) async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    if (writeOff && !inventoryWriteOffReasons.contains(_reason)) {
      showErrorSnackBar(context, l10n.inventoryFailWriteOffReasonInvalid);
      return;
    }
    setState(() => _busy = '${line.itemId}|${writeOff ? 'w' : 'r'}');
    try {
      await widget.env.service.resolveTransferLine(
        businessId: widget.env.businessId,
        transferId: _t.id,
        itemId: line.itemId,
        writeOff: writeOff,
        requestId: _key(line.itemId, writeOff),
        reason: writeOff ? _reason : '',
        note: writeOff ? _note.text : '',
      );
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(
        context,
        writeOff
            ? l10n.invTrWrittenOffDone
            : l10n.invTrReturnedDone(_t.fromName(_watcher.context)),
      );
      final fromName = _t.fromName(_watcher.context);
      setState(() {
        _decided[line.itemId] = writeOff
            ? l10n.invTrResultWrittenOff(
                line.missing,
                inventoryWriteOffReasonLabel(l10n, _reason),
              )
            : l10n.invTrResultReturned(line.missing, fromName);
        _writingOff = '';
        _reason = '';
        _note.clear();
      });
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, inventoryTransferFailureText(l10n, error));
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final stores = _watcher.context;
    final t = _t;
    final fromName = t.fromName(stores);
    final toName = t.toName(stores);
    final disputed = [
      for (final l in t.lines)
        if (l.missing > 0) l,
    ];
    final open = [
      for (final l in disputed)
        if (l.open && !_decided.containsKey(l.itemId)) l,
    ];
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(
            title: l10n.invTrStateReview,
            subtitle: [l10n.invTrStateReview, t.code].join(' · '),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                AppSpacing.xl,
              ),
              children: [
                InventoryTransferRoute(
                  from: fromName,
                  to: toName,
                  fontSize: 16,
                ),
                if (t.receivedAt != null)
                  Text(
                    l10n.invTrConfirmedOnBy(
                      displayMonthDayTime(t.receivedAt!, locale),
                      inventoryTransferPerson(l10n, t.receivedByName),
                    ),
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppColors.muted,
                    ),
                  ),
                const SizedBox(height: AppSpacing.md),
                if (open.isEmpty)
                  InventoryNote(
                    key: const Key('inv-tr-review-settled'),
                    error: false,
                    text: l10n.invTrAllSettled,
                  ),
                for (final line in disputed)
                  _ReviewLine(
                    key: ValueKey('inv-tr-review-${line.itemId}'),
                    line: line,
                    decided: line.open ? _decided[line.itemId] : null,
                    fromName: fromName,
                    toName: toName,
                    note: t.receiveNote,
                    writingOff: _writingOff == line.itemId,
                    reason: _reason,
                    noteController: _note,
                    busy: _busy,
                    onReturn: () => _resolve(line, writeOff: false),
                    onOpenWriteOff: () => setState(() {
                      _writingOff = line.itemId;
                      _reason = '';
                      _note.clear();
                    }),
                    onReason: (r) => setState(() => _reason = r),
                    onWriteOff: () => _resolve(line, writeOff: true),
                  ),
                const SizedBox(height: AppSpacing.lg),
                InventorySectionLabel(l10n.invTrTrackRecord),
                InventoryTransferTimeline(transfer: t, stores: stores),
                const SizedBox(height: AppSpacing.md),
                Text(
                  l10n.invTrReviewFooter,
                  style: const TextStyle(
                    fontSize: 12.5,
                    height: 1.4,
                    color: AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ReviewLine extends StatelessWidget {
  const _ReviewLine({
    super.key,
    required this.line,
    required this.decided,
    required this.fromName,
    required this.toName,
    required this.note,
    required this.writingOff,
    required this.reason,
    required this.noteController,
    required this.busy,
    required this.onReturn,
    required this.onOpenWriteOff,
    required this.onReason,
    required this.onWriteOff,
  });

  final InventoryTransferLine line;

  /// How a line decided on this screen reads, before the live copy shows
  /// the decision.
  final String? decided;
  final String fromName;
  final String toName;
  final String note;
  final bool writingOff;
  final String reason;
  final TextEditingController noteController;
  final String busy;
  final VoidCallback onReturn;
  final VoidCallback onOpenWriteOff;
  final ValueChanged<String> onReason;
  final VoidCallback onWriteOff;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final open = line.open && decided == null;
    final working = busy.isNotEmpty;
    final result = open
        ? ''
        : (decided ?? inventoryTransferResultText(l10n, line, fromName));
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: open
              ? AppColors.errorRed.withValues(alpha: 0.45)
              : AppColors.rule,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  line.displayName,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              InventoryChip(
                label: l10n.invTrMissingN(line.missing),
                color: open ? AppColors.errorRed : AppColors.muted,
              ),
            ],
          ),
          if (!open) ...[
            const SizedBox(height: 6),
            Text(
              result,
              key: Key('inv-tr-review-result-${line.itemId}'),
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: inventoryTransferResultColor(line),
              ),
            ),
          ] else ...[
            const SizedBox(height: 6),
            Text(
              [
                if (note.isNotEmpty) l10n.invTrStoreNote(toName, note),
                l10n.invTrCantSell(line.missing),
              ].join(' '),
              style: const TextStyle(
                fontSize: 13,
                height: 1.4,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: LotSheetButton(
                    key: Key('inv-tr-return-${line.itemId}'),
                    label: l10n.invTrReturnTo(fromName),
                    busy: busy == '${line.itemId}|r',
                    onTap: working ? null : onReturn,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: OutlinedButton(
                    key: Key('inv-tr-writeoff-${line.itemId}'),
                    onPressed: working ? null : onOpenWriteOff,
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(50),
                      foregroundColor: AppColors.errorRed,
                    ),
                    child: Text(l10n.invTrWriteOff),
                  ),
                ),
              ],
            ),
            if (writingOff) ...[
              const SizedBox(height: AppSpacing.md),
              Text(
                l10n.invTrReasonTitle,
                style: const TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                children: [
                  for (final r in inventoryWriteOffReasons)
                    ChoiceChip(
                      key: Key('inv-tr-reason-$r'),
                      label: Text(inventoryWriteOffReasonLabel(l10n, r)),
                      selected: reason == r,
                      onSelected: working ? null : (_) => onReason(r),
                    ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              TextField(
                key: const Key('inv-tr-writeoff-note'),
                controller: noteController,
                enabled: !working,
                maxLength: inventoryTransferMaxNote,
                decoration: InputDecoration(labelText: l10n.invTrNoteOptional),
              ),
              LotSheetButton(
                key: Key('inv-tr-writeoff-confirm-${line.itemId}'),
                label: l10n.invTrWriteOffCount(line.missing),
                tone: LotTone.warn,
                busy: busy == '${line.itemId}|w',
                onTap: working || reason.isEmpty ? null : onWriteOff,
              ),
            ],
          ],
        ],
      ),
    );
  }
}
