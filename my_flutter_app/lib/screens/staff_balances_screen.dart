import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/foundation.dart' show ValueListenable;
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../l10n/app_localizations.dart';
import '../services/business_account_receiver.dart';
import '../services/lot_ledger.dart' show formatLotCents, lotDollarsToCents;
import '../services/package_photo_service.dart';
import '../services/staff_balances.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/lot_sheets.dart';

/// Staff balances (docs/STAFF_BALANCES.md §4): one row per person - what they
/// hold, their own parking bill, the expenses the business owes them and the
/// net - with a breakdown and history sheet, the business account, and the
/// two-step handovers: hand over money, confirm or decline what is handed to
/// you, void a pending one, and (owner) record an opening amount.
///
/// Every number comes from `updateLotExpenseEntry` `staff_balances`; the phone
/// only shows it and sends the actions. Everyone in the business sees every
/// balance.

/// Takes one photo with the camera and answers its bytes, or null when the
/// person backed out. Widget tests hand in their own.
typedef HandoverPhotoCapture = Future<Uint8List?> Function();

/// Puts a handover slip photo in the giver's own folder under
/// `staffHandoverProofs/` and answers its Storage path.
typedef HandoverPhotoUploader =
    Future<String> Function({
      required String businessId,
      required List<int> bytes,
    });

/// A download URL for a Storage path (the slip photo).
typedef HandoverPhotoUrl = Future<String> Function(String path);

Future<Uint8List?> _cameraPhoto() async {
  final picked = await ImagePicker().pickImage(
    source: ImageSource.camera,
    maxWidth: 1600,
    imageQuality: 82,
  );
  return picked?.readAsBytes();
}

Future<String> _uploadProof({
  required String businessId,
  required List<int> bytes,
}) => PackagePhotoService().upload(
  businessId: businessId,
  bytes: bytes,
  root: staffHandoverProofRoot,
);

Future<String> _proofUrl(String path) => PackagePhotoService().url(path);

/// A refused action in the reader's words, by `details.reason`.
String staffBalancesRefusalText(
  AppLocalizations l10n,
  StaffBalancesFailure failure,
) {
  if (failure.offline) return l10n.lotCouldNotSave;
  return switch (failure.reason) {
    'handover_to_self' => l10n.sbalRefusalToSelf,
    'handover_amount_invalid' => l10n.sbalRefusalAmountInvalid,
    'handover_method_invalid' => l10n.sbalRefusalMethodInvalid,
    'handover_receiver_invalid' => l10n.sbalRefusalReceiverInvalid,
    'handover_not_receiver' => l10n.sbalRefusalNotReceiver,
    'handover_not_pending' => l10n.sbalRefusalNotPending,
    'opening_owner_only' => l10n.sbalRefusalOpeningOwnerOnly,
    _ => l10n.lotCouldNotSave,
  };
}

String staffHandoverMethodLabel(AppLocalizations l10n, String method) =>
    switch (method) {
      'cash' => l10n.sbalMethodCash,
      'zelle' => l10n.sbalMethodZelle,
      'check' => l10n.sbalMethodCheck,
      'deposit' => l10n.sbalMethodDeposit,
      _ => l10n.sbalMethodOther,
    };

String _statusLabel(AppLocalizations l10n, String status) => switch (status) {
  'confirmed' => l10n.sbalStatusConfirmed,
  'declined' => l10n.sbalStatusDeclined,
  'voided' => l10n.sbalStatusVoided,
  _ => l10n.sbalStatusPending,
};

/// "owes $50.00" / "is owed $20.00" / "all square".
String staffNetText(AppLocalizations l10n, int netCents) =>
    switch (staffNetKind(netCents)) {
      StaffNetKind.owes => l10n.sbalOwes(formatLotCents(netCents)),
      StaffNetKind.isOwed => l10n.sbalIsOwed(formatLotCents(-netCents)),
      StaffNetKind.settled => l10n.sbalSettled,
    };

Color _netColor(int netCents) => switch (staffNetKind(netCents)) {
  StaffNetKind.owes => AppColors.warn,
  StaffNetKind.isOwed => AppColors.sage,
  StaffNetKind.settled => AppColors.muted,
};

// ---------------------------------------------------------------------------
// The menu badge.
// ---------------------------------------------------------------------------

/// "N waiting on you" for the business menu entry: the pending handovers the
/// signed-in person has to confirm. Silent when the feed cannot be read - the
/// entry then simply has no badge.
class StaffBalancesBadge extends StatefulWidget {
  const StaffBalancesBadge({
    super.key,
    required this.businessId,
    required this.uid,
    required this.isOwner,
    this.feed,
  });

  final String businessId;
  final String uid;

  /// The business owner or a platform admin: also answers for the business
  /// account.
  final bool isOwner;

  /// The live read; the real `staffHandovers` query when null.
  final StaffHandoverFeed? feed;

  @override
  State<StaffBalancesBadge> createState() => _StaffBalancesBadgeState();
}

class _StaffBalancesBadgeState extends State<StaffBalancesBadge> {
  Stream<List<StaffHandover>>? _stream;

  @override
  void initState() {
    super.initState();
    _stream = _open();
  }

  @override
  void didUpdateWidget(StaffBalancesBadge old) {
    super.didUpdateWidget(old);
    if (old.businessId != widget.businessId || old.feed != widget.feed) {
      _stream = _open();
    }
  }

  Stream<List<StaffHandover>>? _open() {
    if (widget.businessId.isEmpty || widget.uid.isEmpty) return null;
    try {
      return (widget.feed ?? FirestoreStaffHandoverFeed()).watch(
        widget.businessId,
        pendingOnly: true,
      );
    } catch (_) {
      // Firebase is not up (a widget test, a signed-out moment): no badge.
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    final stream = _stream;
    if (stream == null) return const SizedBox.shrink();
    return StreamBuilder<List<StaffHandover>>(
      stream: stream,
      builder: (context, snap) {
        final waiting = handoversWaitingOn(
          snap.data ?? const [],
          uid: widget.uid,
          isOwner: widget.isOwner,
        ).length;
        if (snap.hasError || waiting == 0) return const SizedBox.shrink();
        final l10n = AppLocalizations.of(context)!;
        return Semantics(
          label: l10n.sbalWaitingBadge(waiting),
          child: Container(
            key: const Key('staff-balances-badge'),
            constraints: const BoxConstraints(minWidth: 22),
            height: 22,
            padding: const EdgeInsets.symmetric(horizontal: 7),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.errorRed,
              borderRadius: BorderRadius.circular(11),
            ),
            child: ExcludeSemantics(
              child: Text(
                '$waiting',
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                  color: Colors.white,
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------------

class StaffBalancesScreen extends StatefulWidget {
  const StaffBalancesScreen({
    super.key,
    required this.businessId,
    required this.currentUid,
    this.isOwner = false,
    this.service = const StaffBalancesService(),
    this.feed,
    this.photoCapture,
    this.photoUploader,
    this.photoUrl,
  });

  final String businessId;

  /// The signed-in person.
  final String currentUid;

  /// The business owner or a platform admin: records opening amounts, voids
  /// anyone's pending handover and answers for the business account.
  final bool isOwner;
  final StaffBalancesService service;

  /// The live `staffHandovers` read for the history; the real one when null.
  final StaffHandoverFeed? feed;
  final HandoverPhotoCapture? photoCapture;
  final HandoverPhotoUploader? photoUploader;
  final HandoverPhotoUrl? photoUrl;

  @override
  State<StaffBalancesScreen> createState() => _StaffBalancesScreenState();
}

class _StaffBalancesScreenState extends State<StaffBalancesScreen> {
  StaffBalancesSnapshot? _snapshot;
  bool _loading = true;
  bool _failed = false;
  final Set<String> _busy = {};
  final ValueNotifier<List<StaffHandover>> _history = ValueNotifier(const []);
  StreamSubscription<List<StaffHandover>>? _historySub;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    _openHistory();
  }

  @override
  void dispose() {
    _historySub?.cancel();
    _history.dispose();
    super.dispose();
  }

  void _openHistory() {
    try {
      _historySub = (widget.feed ?? FirestoreStaffHandoverFeed())
          .watch(widget.businessId)
          .listen((rows) {
            if (mounted) _history.value = rows;
          }, onError: (_) {});
    } catch (_) {
      // No live history; the pending list from the answer still shows.
    }
  }

  /// Loading always resolves: the service times out, and either way the
  /// spinner is released.
  Future<void> _load({bool keep = false}) async {
    if (!keep) {
      setState(() {
        _loading = true;
        _failed = false;
      });
    }
    try {
      final snapshot = await widget.service.load(widget.businessId);
      if (!mounted) return;
      setState(() {
        _snapshot = snapshot;
        _failed = false;
      });
    } on StaffBalancesFailure {
      if (!mounted) return;
      // Keep the numbers already on screen when only a refresh failed.
      if (_snapshot == null) setState(() => _failed = true);
    } catch (_) {
      if (!mounted) return;
      if (_snapshot == null) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _name(AppLocalizations l10n, String id) {
    if (isBusinessAccountReceiver(id)) return l10n.sbalBusinessAccount;
    final named = _snapshot?.nameOf(id) ?? '';
    if (named.isNotEmpty) return named;
    return id == widget.currentUid ? l10n.you : '—';
  }

  /// Runs one handover action: one at a time per handover, the refusal in
  /// words, the numbers refreshed after.
  Future<void> _act(
    String handoverId,
    Future<void> Function() work,
    String done,
  ) async {
    if (_busy.contains(handoverId)) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _busy.add(handoverId));
    try {
      await work();
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(context, done);
      await _load(keep: true);
    } on StaffBalancesFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, staffBalancesRefusalText(l10n, failure));
      // A stale pending list is the usual reason (answered elsewhere).
      if (failure.reason == 'handover_not_pending') {
        await _load(keep: true);
      }
    } finally {
      if (mounted) setState(() => _busy.remove(handoverId));
    }
  }

  Future<void> _confirm(StaffHandover h) {
    final l10n = AppLocalizations.of(context)!;
    return _act(
      h.id,
      () => widget.service.confirm(widget.businessId, h.id),
      l10n.sbalConfirmDone,
    );
  }

  Future<void> _decline(StaffHandover h) async {
    final l10n = AppLocalizations.of(context)!;
    final note = await _askNote(
      title: l10n.sbalDeclineTitle,
      body: l10n.sbalDeclineBody(
        _name(l10n, h.fromStaffId),
        formatLotCents(h.amountCents),
      ),
      label: l10n.sbalDeclineNote,
      confirmLabel: l10n.sbalDecline,
      fieldKey: const Key('sbal-decline-note'),
      confirmKey: const Key('sbal-decline-confirm'),
    );
    if (note == null || !mounted) return;
    await _act(
      h.id,
      () => widget.service.decline(widget.businessId, h.id, note: note),
      l10n.sbalDeclineDone,
    );
  }

  Future<void> _void(StaffHandover h) async {
    final l10n = AppLocalizations.of(context)!;
    final reason = await _askNote(
      title: l10n.sbalVoidTitle,
      body: l10n.sbalVoidBody(formatLotCents(h.amountCents)),
      label: l10n.sbalVoidReason,
      confirmLabel: l10n.sbalVoid,
      fieldKey: const Key('sbal-void-reason'),
      confirmKey: const Key('sbal-void-confirm'),
    );
    if (reason == null || !mounted) return;
    await _act(
      h.id,
      () =>
          widget.service.voidHandover(widget.businessId, h.id, reason: reason),
      l10n.sbalVoidDone,
    );
  }

  /// A short confirmation with an optional note; the note ('' when empty), or
  /// null when cancelled.
  Future<String?> _askNote({
    required String title,
    required String body,
    required String label,
    required String confirmLabel,
    required Key fieldKey,
    required Key confirmKey,
  }) => showDialog<String>(
    context: context,
    builder: (_) => _NoteDialog(
      title: title,
      body: body,
      label: label,
      confirmLabel: confirmLabel,
      fieldKey: fieldKey,
      confirmKey: confirmKey,
    ),
  );

  Future<void> _handOver() async {
    final snapshot = _snapshot;
    if (snapshot == null) return;
    final done = await showLotSheet<String>(
      context,
      HandOverMoneySheet(
        businessId: widget.businessId,
        people: [
          for (final s in snapshot.staff)
            if (s.staffId != widget.currentUid) (id: s.staffId, name: s.name),
        ],
        service: widget.service,
        photoCapture: widget.photoCapture,
        photoUploader: widget.photoUploader,
      ),
    );
    if (done == null || !mounted) return;
    showSuccessSnackBar(context, done);
    await _load(keep: true);
  }

  Future<void> _opening({String staffId = ''}) async {
    final snapshot = _snapshot;
    if (snapshot == null) return;
    final done = await showLotSheet<String>(
      context,
      OpeningAmountSheet(
        businessId: widget.businessId,
        people: [for (final s in snapshot.staff) (id: s.staffId, name: s.name)],
        initialStaffId: staffId,
        service: widget.service,
      ),
    );
    if (done == null || !mounted) return;
    showSuccessSnackBar(context, done);
    await _load(keep: true);
  }

  Future<void> _showDetail(StaffBalanceRow row) async {
    final snapshot = _snapshot;
    if (snapshot == null) return;
    final action = await showLotSheet<String>(
      context,
      StaffBalanceDetailSheet(
        row: row,
        history: _history,
        pending: snapshot.pending,
        nameOf: (id) => _name(AppLocalizations.of(context)!, id),
        canRecordOpening: widget.isOwner,
        photoUrl: widget.photoUrl ?? _proofUrl,
      ),
    );
    if (action == 'opening' && mounted) {
      await _opening(staffId: row.staffId);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final snapshot = _snapshot;
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          Container(
            decoration: BoxDecoration(
              color: AppColors.paper,
              border: Border(
                bottom: BorderSide(
                  color: AppColors.rule.withValues(alpha: 0.8),
                ),
              ),
            ),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  4,
                  4,
                  AppSpacing.lg,
                  AppSpacing.md,
                ),
                child: Row(
                  children: [
                    const AppBackButton(),
                    Expanded(
                      child: Text(
                        l10n.sbalTitle,
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          height: 1.1,
                          letterSpacing: -0.4,
                          color: AppColors.ink,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => _load(keep: true),
              child: _body(l10n, locale, snapshot),
            ),
          ),
        ],
      ),
    );
  }

  Widget _body(
    AppLocalizations l10n,
    String locale,
    StaffBalancesSnapshot? snapshot,
  ) {
    if (snapshot == null) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          if (_loading && !_failed)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Center(
                child: CircularProgressIndicator(key: Key('sbal-loading')),
              ),
            )
          else
            _LoadFailed(onRetry: _load),
        ],
      );
    }
    final waiting = handoversWaitingOn(
      snapshot.pending,
      uid: widget.currentUid,
      isOwner: widget.isOwner,
    );
    final waitingIds = {for (final h in waiting) h.id};
    final others = [
      for (final h in snapshot.pending)
        if (!waitingIds.contains(h.id)) h,
    ]..sort(compareHandoverOldestFirst);
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        Text(
          l10n.sbalIntro,
          style: const TextStyle(
            fontSize: 12.5,
            height: 1.4,
            color: AppColors.muted,
          ),
        ),
        if (snapshot.asOf != null) ...[
          const SizedBox(height: 2),
          Text(
            l10n.sbalAsOf(displayDateTime(snapshot.asOf!, locale)),
            style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
          ),
        ],
        const SizedBox(height: AppSpacing.md),
        _Actions(
          showOpening: widget.isOwner,
          onHandOver: _handOver,
          onOpening: () => _opening(),
        ),
        if (waiting.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.lg),
          _SectionTitle(l10n.sbalWaitingOnYou, count: waiting.length),
          for (final h in waiting)
            _HandoverTile(
              handover: h,
              nameOf: (id) => _name(l10n, id),
              locale: locale,
              busy: _busy.contains(h.id),
              canConfirm: true,
              canVoid: canVoidHandover(
                h,
                uid: widget.currentUid,
                isOwner: widget.isOwner,
              ),
              onConfirm: () => _confirm(h),
              onDecline: () => _decline(h),
              onVoid: () => _void(h),
              photoUrl: widget.photoUrl ?? _proofUrl,
            ),
        ],
        if (others.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.lg),
          _SectionTitle(l10n.sbalOtherPending),
          for (final h in others)
            _HandoverTile(
              handover: h,
              nameOf: (id) => _name(l10n, id),
              locale: locale,
              busy: _busy.contains(h.id),
              canConfirm: false,
              canVoid: canVoidHandover(
                h,
                uid: widget.currentUid,
                isOwner: widget.isOwner,
              ),
              onConfirm: () {},
              onDecline: () {},
              onVoid: () => _void(h),
              photoUrl: widget.photoUrl ?? _proofUrl,
            ),
        ],
        const SizedBox(height: AppSpacing.lg),
        if (snapshot.staff.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
            child: Text(
              l10n.sbalEmpty,
              key: const Key('sbal-empty'),
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.muted),
            ),
          )
        else
          for (final row in snapshot.staff)
            _BalanceCard(
              row: row,
              isYou: row.staffId == widget.currentUid,
              onTap: () => _showDetail(row),
            ),
        const SizedBox(height: AppSpacing.sm),
        _BusinessAccountCard(row: snapshot.businessAccount),
        const SizedBox(height: AppSpacing.xl),
      ],
    );
  }
}

class _LoadFailed extends StatelessWidget {
  const _LoadFailed({required this.onRetry});

  final Future<void> Function({bool keep}) onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
      child: Column(
        children: [
          Text(
            l10n.sbalLoadFailed,
            key: const Key('sbal-load-failed'),
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted, height: 1.4),
          ),
          const SizedBox(height: AppSpacing.md),
          OutlinedButton(
            key: const Key('sbal-retry'),
            onPressed: () => onRetry(),
            child: Text(l10n.sbalTryAgain),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text, {this.count});

  final String text;
  final int? count;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        children: [
          Flexible(
            child: Text(
              text,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w800,
                color: AppColors.ink,
              ),
            ),
          ),
          if (count != null) ...[
            const SizedBox(width: AppSpacing.sm),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
              decoration: BoxDecoration(
                color: AppColors.errorRed,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                '$count',
                style: const TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w800,
                  color: Colors.white,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Actions extends StatelessWidget {
  const _Actions({
    required this.showOpening,
    required this.onHandOver,
    required this.onOpening,
  });

  final bool showOpening;
  final VoidCallback onHandOver;
  final VoidCallback onOpening;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final handOver = FilledButton.icon(
      key: const Key('sbal-hand-over'),
      onPressed: onHandOver,
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.cobalt,
        minimumSize: const Size(0, 48),
      ),
      icon: const Icon(Icons.swap_horiz, size: 20),
      label: Text(l10n.sbalHandOver, maxLines: 2, textAlign: TextAlign.center),
    );
    if (!showOpening) {
      return SizedBox(width: double.infinity, child: handOver);
    }
    return Row(
      children: [
        Expanded(child: handOver),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: OutlinedButton.icon(
            key: const Key('sbal-opening'),
            onPressed: onOpening,
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
            icon: const Icon(Icons.flag_outlined, size: 20),
            label: Text(
              l10n.sbalOpening,
              maxLines: 2,
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ],
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({
    required this.row,
    required this.isYou,
    required this.onTap,
  });

  final StaffBalanceRow row;
  final bool isYou;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final name = row.name.isEmpty ? '—' : row.name;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: PressableScale(
        key: Key('sbal-row-${row.staffId}'),
        onTap: onTap,
        scale: 0.99,
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.paper,
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            border: Border.all(color: AppColors.rule),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      isYou ? '$name (${l10n.you})' : name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Flexible(
                    child: Text(
                      staffNetText(l10n, row.netCents),
                      key: Key('sbal-net-${row.staffId}'),
                      textAlign: TextAlign.end,
                      style: TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w800,
                        color: _netColor(row.netCents),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: _MiniStat(
                      label: l10n.sbalHolds,
                      value: formatLotCents(row.heldCents),
                    ),
                  ),
                  Expanded(
                    child: _MiniStat(
                      label: l10n.sbalParking,
                      value: formatLotCents(row.parkingDueCents),
                    ),
                  ),
                  Expanded(
                    child: _MiniStat(
                      label: l10n.sbalExpensesOwed,
                      value: formatLotCents(row.expenseOwedToThemCents),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 11, color: AppColors.muted),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: AppColors.ink,
          ),
        ),
      ],
    );
  }
}

class _BusinessAccountCard extends StatelessWidget {
  const _BusinessAccountCard({required this.row});

  final BusinessAccountRow row;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      key: const Key('sbal-business-account'),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.parchment,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.account_balance_outlined,
            size: 20,
            color: AppColors.cobaltDeep,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.sbalBusinessAccount,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  l10n.sbalBusinessAccountReceived(
                    formatLotCents(row.receivedCents),
                  ),
                  style: const TextStyle(fontSize: 12.5, color: AppColors.ink),
                ),
                if (row.pendingInCents > 0)
                  Text(
                    l10n.sbalBusinessAccountComing(
                      formatLotCents(row.pendingInCents),
                    ),
                    style: const TextStyle(
                      fontSize: 12.5,
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

/// One handover with what the viewer may do to it: Confirm received / Decline
/// when it waits on them, Void when it is theirs (or they are the owner).
class _HandoverTile extends StatelessWidget {
  const _HandoverTile({
    required this.handover,
    required this.nameOf,
    required this.locale,
    required this.busy,
    required this.canConfirm,
    required this.canVoid,
    required this.onConfirm,
    required this.onDecline,
    required this.onVoid,
    required this.photoUrl,
  });

  final StaffHandover handover;
  final String Function(String id) nameOf;
  final String locale;
  final bool busy;
  final bool canConfirm;
  final bool canVoid;
  final VoidCallback onConfirm;
  final VoidCallback onDecline;
  final VoidCallback onVoid;
  final HandoverPhotoUrl photoUrl;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final h = handover;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Container(
        key: Key('sbal-pending-${h.id}'),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.paper,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(
            color: canConfirm
                ? AppColors.warn.withValues(alpha: 0.6)
                : AppColors.rule,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            HandoverSummary(handover: h, nameOf: nameOf, locale: locale),
            if (h.proofPath.isNotEmpty)
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: ViewHandoverPhotoButton(
                  path: h.proofPath,
                  photoUrl: photoUrl,
                ),
              ),
            if (canConfirm || canVoid) ...[
              const SizedBox(height: AppSpacing.sm),
              Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                children: [
                  if (canConfirm)
                    FilledButton(
                      key: Key('sbal-confirm-${h.id}'),
                      onPressed: busy ? null : onConfirm,
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.cobalt,
                      ),
                      child: Text(l10n.sbalConfirm),
                    ),
                  if (canConfirm)
                    OutlinedButton(
                      key: Key('sbal-decline-${h.id}'),
                      onPressed: busy ? null : onDecline,
                      child: Text(l10n.sbalDecline),
                    ),
                  if (canVoid)
                    TextButton(
                      key: Key('sbal-void-${h.id}'),
                      onPressed: busy ? null : onVoid,
                      style: TextButton.styleFrom(
                        foregroundColor: AppColors.errorRed,
                      ),
                      child: Text(l10n.sbalVoid),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A handover as words: who gave what to whom, how, when, the note, and
/// where it stands.
class HandoverSummary extends StatelessWidget {
  const HandoverSummary({
    super.key,
    required this.handover,
    required this.nameOf,
    required this.locale,
  });

  final StaffHandover handover;
  final String Function(String id) nameOf;
  final String locale;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final h = handover;
    final amount = formatLotCents(h.amountCents);
    final title = h.isOpening
        ? l10n.sbalOpeningLine(nameOf(h.fromStaffId), amount)
        : l10n.sbalHandedLine(nameOf(h.fromStaffId), amount, nameOf(h.toId));
    final when = h.when;
    final detail = [
      if (!h.isOpening) staffHandoverMethodLabel(l10n, h.method),
      if (when != null) displayDateTime(when, locale),
    ].join(' · ');
    final extra = h.status == 'declined' && h.declineNote.isNotEmpty
        ? h.declineNote
        : h.status == 'voided' && h.voidReason.isNotEmpty
        ? h.voidReason
        : h.note;
    final statusColor = switch (h.status) {
      'confirmed' => AppColors.sage,
      'declined' || 'voided' => AppColors.errorRed,
      _ => AppColors.warn,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w600,
            height: 1.3,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          _statusLabel(l10n, h.status),
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: statusColor,
          ),
        ),
        if (detail.isNotEmpty)
          Text(
            detail,
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
        if (extra.isNotEmpty)
          Text(
            extra,
            style: const TextStyle(
              fontSize: 12,
              height: 1.3,
              color: AppColors.muted,
            ),
          ),
      ],
    );
  }
}

/// "View photo": opens the slip photo of a handover in a dialog.
class ViewHandoverPhotoButton extends StatelessWidget {
  const ViewHandoverPhotoButton({
    super.key,
    required this.path,
    required this.photoUrl,
  });

  final String path;
  final HandoverPhotoUrl photoUrl;

  Future<void> _open(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    String url;
    try {
      url = await photoUrl(path).timeout(const Duration(seconds: 20));
    } catch (_) {
      if (context.mounted) showErrorSnackBar(context, l10n.sbalPhotoOpenFailed);
      return;
    }
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => Dialog(
        child: Image.network(
          url,
          fit: BoxFit.contain,
          errorBuilder: (_, _, _) => Padding(
            padding: const EdgeInsets.all(AppSpacing.xl),
            child: Text(l10n.sbalPhotoOpenFailed),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return TextButton.icon(
      key: Key('sbal-photo-$path'),
      onPressed: () => _open(context),
      style: TextButton.styleFrom(
        visualDensity: VisualDensity.compact,
        padding: EdgeInsets.zero,
      ),
      icon: const Icon(Icons.photo_outlined, size: 18),
      label: Text(l10n.sbalViewPhoto),
    );
  }
}

// ---------------------------------------------------------------------------
// The breakdown and history sheet.
// ---------------------------------------------------------------------------

class StaffBalanceDetailSheet extends StatelessWidget {
  const StaffBalanceDetailSheet({
    super.key,
    required this.row,
    required this.history,
    required this.pending,
    required this.nameOf,
    required this.canRecordOpening,
    required this.photoUrl,
  });

  final StaffBalanceRow row;

  /// Every `staffHandovers` row of the business, live.
  final ValueListenable<List<StaffHandover>> history;

  /// The pending rows of the answer: the history when the live read is not
  /// available.
  final List<StaffHandover> pending;
  final String Function(String id) nameOf;
  final bool canRecordOpening;
  final HandoverPhotoUrl photoUrl;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    Widget line(String label, int cents, {bool strong = false, Key? key}) =>
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: strong ? FontWeight.w700 : FontWeight.w400,
                    color: AppColors.ink,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                formatLotCents(cents),
                key: key,
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: strong ? FontWeight.w800 : FontWeight.w600,
                  color: AppColors.ink,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
        );
    return LotSheetShell(
      title: row.name.isEmpty ? '—' : row.name,
      subtitle: staffNetText(l10n, row.netCents),
      body: ValueListenableBuilder<List<StaffHandover>>(
        valueListenable: history,
        builder: (context, live, _) {
          final all = live.isEmpty ? pending : live;
          final mine = handoversOf(all, row.staffId);
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              line(l10n.sbalDetailCollected, row.collectedCents),
              for (final e in row.collectedByMethod.entries)
                Padding(
                  padding: const EdgeInsetsDirectional.only(start: 14),
                  child: line(staffHandoverMethodLabel(l10n, e.key), e.value),
                ),
              line(l10n.sbalDetailHandedOut, row.handedOutCents),
              line(l10n.sbalDetailReceived, row.receivedFromOthersCents),
              if (row.pendingOutCents != 0)
                line(l10n.sbalDetailPendingOut, row.pendingOutCents),
              if (row.pendingInCents != 0)
                line(l10n.sbalDetailPendingIn, row.pendingInCents),
              const Divider(height: AppSpacing.lg),
              line(
                l10n.sbalDetailHolds,
                row.heldCents,
                strong: true,
                key: const Key('sbal-detail-held'),
              ),
              line(l10n.sbalDetailParking, row.parkingDueCents),
              if (row.expenseCreditCents != 0)
                line(l10n.sbalDetailExpensesApplied, row.expenseCreditCents),
              line(l10n.sbalDetailExpensesOwed, row.expenseOwedToThemCents),
              const Divider(height: AppSpacing.lg),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        l10n.sbalNet,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w800,
                          color: AppColors.ink,
                        ),
                      ),
                    ),
                    Text(
                      staffNetText(l10n, row.netCents),
                      key: const Key('sbal-detail-net'),
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: _netColor(row.netCents),
                      ),
                    ),
                  ],
                ),
              ),
              if (canRecordOpening) ...[
                const SizedBox(height: AppSpacing.sm),
                OutlinedButton.icon(
                  key: const Key('sbal-detail-opening'),
                  onPressed: () => Navigator.of(context).pop('opening'),
                  icon: const Icon(Icons.flag_outlined, size: 18),
                  label: Text(l10n.sbalOpening),
                ),
              ],
              const SizedBox(height: AppSpacing.lg),
              Text(
                l10n.sbalHistory,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              if (mine.isEmpty)
                Text(
                  l10n.sbalHistoryEmpty,
                  key: const Key('sbal-history-empty'),
                  style: const TextStyle(color: AppColors.muted),
                )
              else
                for (final h in mine)
                  Padding(
                    key: Key('sbal-history-${h.id}'),
                    padding: const EdgeInsets.only(bottom: AppSpacing.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        HandoverSummary(
                          handover: h,
                          nameOf: nameOf,
                          locale: locale,
                        ),
                        if (h.proofPath.isNotEmpty)
                          ViewHandoverPhotoButton(
                            path: h.proofPath,
                            photoUrl: photoUrl,
                          ),
                      ],
                    ),
                  ),
            ],
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Hand over money.
// ---------------------------------------------------------------------------

/// "Hand over money": to a person of the business or to the Business account,
/// how much and how, a note and (optionally) a photo of the slip. It stays
/// pending until the receiver confirms. Pops with the success message.
class HandOverMoneySheet extends StatefulWidget {
  const HandOverMoneySheet({
    super.key,
    required this.businessId,
    required this.people,
    this.service = const StaffBalancesService(),
    this.photoCapture,
    this.photoUploader,
  });

  final String businessId;

  /// The people the money can go to (not the giver).
  final List<({String id, String name})> people;
  final StaffBalancesService service;
  final HandoverPhotoCapture? photoCapture;
  final HandoverPhotoUploader? photoUploader;

  @override
  State<HandOverMoneySheet> createState() => _HandOverMoneySheetState();
}

class _HandOverMoneySheetState extends State<HandOverMoneySheet> {
  final _amount = TextEditingController();
  final _note = TextEditingController();
  String _to = '';
  String _method = 'cash';
  Uint8List? _photoBytes;
  String _photoPath = '';
  bool _uploading = false;
  bool _busy = false;
  String _error = '';
  bool _amountWrong = false;
  bool _toMissing = false;
  String _photoError = '';

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  String _toName(AppLocalizations l10n) {
    if (_to.isEmpty) return '';
    if (isBusinessAccountReceiver(_to)) return l10n.sbalBusinessAccount;
    return widget.people.where((p) => p.id == _to).firstOrNull?.name ?? '';
  }

  Future<void> _pickTo() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.sbalTo,
      selected: _to,
      options: [
        LotOption(businessAccountReceiver, l10n.sbalBusinessAccount),
        for (final p in widget.people) LotOption(p.id, p.name),
      ],
    );
    if (picked != null && mounted) {
      setState(() {
        _to = picked;
        _toMissing = false;
        _error = '';
      });
    }
  }

  Future<void> _pickMethod() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.sbalMethod,
      selected: _method,
      options: [
        for (final m in staffHandoverMethods)
          LotOption(m, staffHandoverMethodLabel(l10n, m)),
      ],
    );
    if (picked != null && mounted) setState(() => _method = picked);
  }

  Future<void> _takePhoto() async {
    if (_busy || _uploading) return;
    final l10n = AppLocalizations.of(context)!;
    Uint8List? bytes;
    try {
      bytes = await (widget.photoCapture ?? _cameraPhoto)();
    } catch (_) {
      if (mounted) setState(() => _photoError = l10n.sbalPhotoFailed);
      return;
    }
    if (bytes == null || !mounted) return;
    setState(() {
      _uploading = true;
      _photoError = '';
      _photoBytes = bytes;
      _photoPath = '';
    });
    try {
      final path = await (widget.photoUploader ?? _uploadProof)(
        businessId: widget.businessId,
        bytes: bytes,
      );
      if (mounted) setState(() => _photoPath = path);
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() {
        _photoBytes = null;
        _photoError = l10n.sbalPhotoFailed;
      });
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _send() async {
    if (_busy || _uploading) return;
    final l10n = AppLocalizations.of(context)!;
    final cents = lotDollarsToCents(_amount.text) ?? 0;
    if (_to.isEmpty || cents <= 0) {
      AppHaptics.refuse();
      setState(() {
        _toMissing = _to.isEmpty;
        _amountWrong = cents <= 0;
        _error = '';
      });
      return;
    }
    setState(() {
      _busy = true;
      _error = '';
      _amountWrong = false;
      _toMissing = false;
    });
    try {
      await widget.service.recordHandover(
        businessId: widget.businessId,
        toId: _to,
        amountCents: cents,
        method: _method,
        note: _note.text,
        proofPath: _photoPath,
      );
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(
        context,
      ).pop(l10n.sbalHandOverDone(formatLotCents(cents), _toName(l10n)));
    } on StaffBalancesFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = staffBalancesRefusalText(l10n, failure));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return LotSheetShell(
      title: l10n.sbalHandOver,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_error.isNotEmpty) ...[
            Text(
              _error,
              key: const Key('sbal-handover-error'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('sbal-handover-send'),
            label: l10n.sbalSendForConfirmation,
            busy: _busy,
            tone: LotTone.good,
            onTap: _uploading ? null : _send,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.sbalHandOverHint,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            key: const Key('sbal-handover-to'),
            label: l10n.sbalTo,
            value: _toName(l10n).isEmpty ? null : _toName(l10n),
            placeholder: l10n.sbalChoosePerson,
            onTap: _busy ? () {} : _pickTo,
            error: _toMissing ? l10n.sbalSayWho : null,
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('sbal-handover-amount'),
            controller: _amount,
            enabled: !_busy,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() => _amountWrong = false),
            decoration: InputDecoration(
              labelText: l10n.sbalAmount,
              prefixText: r'$ ',
              errorText: _amountWrong ? l10n.sbalAmountInvalid : null,
              errorMaxLines: 2,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            key: const Key('sbal-handover-method'),
            label: l10n.sbalMethod,
            value: staffHandoverMethodLabel(l10n, _method),
            placeholder: l10n.sbalMethod,
            onTap: _busy ? () {} : _pickMethod,
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('sbal-handover-note'),
            controller: _note,
            enabled: !_busy,
            maxLength: 500,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: l10n.sbalNote),
          ),
          _ProofPhoto(
            bytes: _photoBytes,
            uploaded: _photoPath.isNotEmpty,
            uploading: _uploading,
            error: _photoError,
            onTake: _busy ? null : _takePhoto,
          ),
        ],
      ),
    );
  }
}

/// The optional slip photo: a camera button, then the thumbnail with Retake.
class _ProofPhoto extends StatelessWidget {
  const _ProofPhoto({
    required this.bytes,
    required this.uploaded,
    required this.uploading,
    required this.error,
    required this.onTake,
  });

  final Uint8List? bytes;
  final bool uploaded;
  final bool uploading;
  final String error;
  final VoidCallback? onTake;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final photo = bytes;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            if (photo != null)
              ClipRRect(
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                child: Image.memory(
                  photo,
                  key: const Key('sbal-photo-thumb'),
                  width: 56,
                  height: 56,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => const SizedBox(
                    width: 56,
                    height: 56,
                    child: Icon(Icons.photo_outlined),
                  ),
                ),
              ),
            if (photo != null) const SizedBox(width: AppSpacing.md),
            Expanded(
              child: OutlinedButton.icon(
                key: const Key('sbal-photo-take'),
                onPressed: uploading ? null : onTake,
                icon: uploading
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(
                        uploaded
                            ? Icons.check_circle_outline
                            : Icons.photo_camera_outlined,
                        size: 18,
                      ),
                label: Text(
                  uploaded ? l10n.sbalRetakePhoto : l10n.sbalAddPhoto,
                  maxLines: 2,
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          ],
        ),
        if (uploaded)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              l10n.sbalPhotoAdded,
              key: const Key('sbal-photo-added'),
              style: const TextStyle(fontSize: 12, color: AppColors.sage),
            ),
          ),
        if (error.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              error,
              key: const Key('sbal-photo-error'),
              style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Opening amount (owner / admin).
// ---------------------------------------------------------------------------

/// "Opening amount": what a person already handed over before Staff balances
/// existed - one step, confirmed on the spot. Owner / admin only (the server
/// checks; the button is only shown to them). Pops with the success message.
class OpeningAmountSheet extends StatefulWidget {
  const OpeningAmountSheet({
    super.key,
    required this.businessId,
    required this.people,
    this.initialStaffId = '',
    this.service = const StaffBalancesService(),
  });

  final String businessId;
  final List<({String id, String name})> people;
  final String initialStaffId;
  final StaffBalancesService service;

  @override
  State<OpeningAmountSheet> createState() => _OpeningAmountSheetState();
}

class _OpeningAmountSheetState extends State<OpeningAmountSheet> {
  final _amount = TextEditingController();
  final _note = TextEditingController();
  late String _staff = widget.initialStaffId;
  bool _busy = false;
  String _error = '';
  bool _amountWrong = false;
  bool _staffMissing = false;

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  String get _staffName =>
      widget.people.where((p) => p.id == _staff).firstOrNull?.name ?? '';

  Future<void> _pickStaff() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.sbalOpeningPerson,
      selected: _staff,
      options: [for (final p in widget.people) LotOption(p.id, p.name)],
    );
    if (picked != null && mounted) {
      setState(() {
        _staff = picked;
        _staffMissing = false;
      });
    }
  }

  Future<void> _save() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    final cents = lotDollarsToCents(_amount.text) ?? 0;
    if (_staff.isEmpty || cents <= 0) {
      AppHaptics.refuse();
      setState(() {
        _staffMissing = _staff.isEmpty;
        _amountWrong = cents <= 0;
      });
      return;
    }
    setState(() {
      _busy = true;
      _error = '';
      _amountWrong = false;
    });
    try {
      await widget.service.recordOpening(
        businessId: widget.businessId,
        staffId: _staff,
        amountCents: cents,
        note: _note.text,
      );
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(
        context,
      ).pop(l10n.sbalOpeningDone(formatLotCents(cents), _staffName));
    } on StaffBalancesFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = staffBalancesRefusalText(l10n, failure));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return LotSheetShell(
      title: l10n.sbalOpening,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_error.isNotEmpty) ...[
            Text(
              _error,
              key: const Key('sbal-opening-error'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('sbal-opening-save'),
            label: l10n.sbalOpeningSave,
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
            l10n.sbalOpeningHint,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            key: const Key('sbal-opening-person'),
            label: l10n.sbalOpeningPerson,
            value: _staffName.isEmpty ? null : _staffName,
            placeholder: l10n.sbalChoosePerson,
            onTap: _busy ? () {} : _pickStaff,
            error: _staffMissing ? l10n.sbalSayWho : null,
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('sbal-opening-amount'),
            controller: _amount,
            enabled: !_busy,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() => _amountWrong = false),
            decoration: InputDecoration(
              labelText: l10n.sbalAmount,
              prefixText: r'$ ',
              errorText: _amountWrong ? l10n.sbalAmountInvalid : null,
              errorMaxLines: 2,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('sbal-opening-note'),
            controller: _note,
            enabled: !_busy,
            maxLength: 500,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: l10n.sbalNote),
          ),
        ],
      ),
    );
  }
}

/// The Decline / Void confirmation: what it means and an optional note. Owns
/// its text controller, so it outlives the dialog's closing animation.
class _NoteDialog extends StatefulWidget {
  const _NoteDialog({
    required this.title,
    required this.body,
    required this.label,
    required this.confirmLabel,
    required this.fieldKey,
    required this.confirmKey,
  });

  final String title;
  final String body;
  final String label;
  final String confirmLabel;
  final Key fieldKey;
  final Key confirmKey;

  @override
  State<_NoteDialog> createState() => _NoteDialogState();
}

class _NoteDialogState extends State<_NoteDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return AlertDialog(
      title: Text(widget.title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.body),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: widget.fieldKey,
            controller: _controller,
            maxLength: 500,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: widget.label),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.cancel),
        ),
        TextButton(
          key: widget.confirmKey,
          style: TextButton.styleFrom(foregroundColor: AppColors.errorRed),
          onPressed: () => Navigator.of(context).pop(_controller.text.trim()),
          child: Text(widget.confirmLabel),
        ),
      ],
    );
  }
}
