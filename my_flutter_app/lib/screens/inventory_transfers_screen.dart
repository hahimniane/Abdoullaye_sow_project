import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory_context.dart';
import '../services/inventory_service.dart';
import '../services/inventory_stores.dart';
import '../services/inventory_transfer_feed.dart';
import '../services/inventory_transfers.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/inventory_transfer_widgets.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import 'containers_screen.dart' show ContainerActionButton;
import 'inventory_transfer_compose_screen.dart';
import 'inventory_transfer_receive_screen.dart';
import 'print_tags_sheet.dart';

/// What every transfer screen needs, handed from the list to the screens it
/// opens so a widget test replaces Firebase once.
class InventoryTransferEnv {
  const InventoryTransferEnv({
    required this.businessId,
    required this.source,
    required this.transfers,
    required this.service,
    required this.access,
    required this.userId,
    required this.clock,
    required this.newRequestId,
    this.tagOpener = openInventoryTags,
    this.cameraEnabled = true,
    this.scans,
  });

  final String businessId;
  final InventorySource source;
  final InventoryTransferSource transfers;
  final InventoryService service;
  final InventoryAccess access;

  /// The signed-in uid (the sender may cancel their own transfer).
  final String userId;
  final DateTime Function() clock;

  /// Makes a retry key (a transfer being composed, a receive, a cancel).
  final String Function() newRequestId;
  final InventoryTagOpener tagOpener;
  final bool cameraEnabled;
  final Stream<String>? scans;
}

/// Store transfers: tabs Outgoing · Incoming · In transit · Review with their
/// counts, a card per transfer, and New transfer. Someone tied to one store
/// sees what goes from or to it; the owner and all-stores staff see every
/// store, with a store filter.
///
/// Opened from a transfer notification ([transferId]) it reads that transfer
/// and opens it - the receive screen for its destination's staff while in
/// transit, the review for the owner while in review, else its detail. A
/// transfer that does not exist, that the person may not see, or that does
/// not answer within 15 s leaves the list open with "That transfer is not
/// available.".
class InventoryTransfersScreen extends StatefulWidget {
  const InventoryTransfersScreen({
    super.key,
    required this.businessId,
    this.source,
    this.transferSource,
    this.service = const InventoryService(),
    this.access = const InventoryAccess.owner(),
    this.currentUserId,
    this.transferId,
    this.clock = DateTime.now,
    this.newRequestId = newInventoryTransferRequestId,
    this.tagOpener = openInventoryTags,
    this.cameraEnabled = true,
    this.scans,
  });

  final String businessId;
  final InventorySource? source;
  final InventoryTransferSource? transferSource;
  final InventoryService service;
  final InventoryAccess access;
  final String? currentUserId;

  /// The transfer to open first (from a notification).
  final String? transferId;
  final DateTime Function() clock;
  final String Function() newRequestId;
  final InventoryTagOpener tagOpener;

  /// Off in widget tests, where there is no camera plugin.
  @visibleForTesting
  final bool cameraEnabled;

  /// Raw tag payloads fed in place of the camera (widget tests).
  @visibleForTesting
  final Stream<String>? scans;

  @override
  State<InventoryTransfersScreen> createState() =>
      _InventoryTransfersScreenState();
}

class _InventoryTransfersScreenState extends State<InventoryTransfersScreen> {
  late final InventoryTransferEnv _env = InventoryTransferEnv(
    businessId: widget.businessId,
    source: widget.source ?? FirestoreInventorySource(),
    transfers: widget.transferSource ?? FirestoreInventoryTransferSource(),
    service: widget.service,
    access: widget.access,
    userId: widget.currentUserId ?? inventoryCurrentUserId(),
    clock: widget.clock,
    newRequestId: widget.newRequestId,
    tagOpener: widget.tagOpener,
    cameraEnabled: widget.cameraEnabled,
    scans: widget.scans,
  );

  late final InventoryContextWatcher _watcher = InventoryContextWatcher(
    source: _env.source,
    businessId: widget.businessId,
    access: widget.access,
    watchCategories: false,
    watchBrands: false,
    onChange: _storesChanged,
  );

  late final InventoryTransferFeed _feed = InventoryTransferFeed(
    source: _env.transfers,
    businessId: widget.businessId,
    withRecent: true,
    onChange: () {
      if (!mounted) return;
      if (_feed.loaded) _safety?.cancel();
      setState(() {});
    },
  );

  Timer? _safety;
  bool _timedOut = false;
  InventoryTransferTab _tab = InventoryTransferTab.outgoing;
  String _storeFilter = '';

  StreamSubscription<InventoryTransfer?>? _focusSub;
  Timer? _focusSafety;
  bool _focusStarted = false;
  bool _focusDone = false;
  bool _focusMissing = false;

  String get _focusId => widget.transferId?.trim() ?? '';

  InventoryTransferViewer get _viewer =>
      InventoryTransferViewer(stores: _watcher.context, userId: _env.userId);

  @override
  void initState() {
    super.initState();
    // The list always resolves, even if nothing ever answers.
    _safety = Timer(const Duration(seconds: 15), () {
      if (mounted && !_feed.loaded) setState(() => _timedOut = true);
    });
    if (_focusId.isNotEmpty) {
      _focusSafety = Timer(const Duration(seconds: 15), () {
        if (mounted && !_focusDone) _refuseFocus();
      });
    }
    _watcher.start();
  }

  @override
  void dispose() {
    _safety?.cancel();
    _focusSafety?.cancel();
    _focusSub?.cancel();
    _feed.dispose();
    _watcher.dispose();
    super.dispose();
  }

  void _storesChanged() {
    if (!mounted) return;
    setState(() {});
    _feed.sync(_watcher.context, storesLoaded: _watcher.storesLoaded);
    _listenFocus();
  }

  /// Reads the notification's transfer once the person's reach is known.
  void _listenFocus() {
    final id = _focusId;
    if (id.isEmpty || _focusStarted || _focusDone) return;
    if (!_watcher.storesLoaded) return;
    _focusStarted = true;
    if (_viewer.blocked) {
      _refuseFocus();
      return;
    }
    _focusSub = _env.transfers
        .watchTransfer(widget.businessId, id)
        .listen(
          (t) {
            if (!mounted || _focusDone) return;
            if (t == null ||
                !inventoryTransferVisible(
                  t,
                  businessId: widget.businessId,
                  viewer: _viewer,
                )) {
              _refuseFocus();
              return;
            }
            _focusDone = true;
            _focusSafety?.cancel();
            _focusSub?.cancel();
            _focusSub = null;
            unawaited(
              _open(t, target: inventoryTransferOpenTarget(t, _viewer)),
            );
          },
          onError: (_) {
            if (mounted && !_focusDone) _refuseFocus();
          },
        );
  }

  void _refuseFocus() {
    _focusDone = true;
    _focusSafety?.cancel();
    _focusSub?.cancel();
    _focusSub = null;
    if (mounted) setState(() => _focusMissing = true);
  }

  Future<void> _open(
    InventoryTransfer t, {
    InventoryTransferTarget target = InventoryTransferTarget.detail,
  }) async {
    final Widget screen = switch (target) {
      InventoryTransferTarget.receive => InventoryTransferReceiveScreen(
        env: _env,
        transfer: t,
      ),
      InventoryTransferTarget.review => InventoryTransferReviewScreen(
        env: _env,
        transfer: t,
      ),
      InventoryTransferTarget.detail => InventoryTransferDetailScreen(
        env: _env,
        transfer: t,
      ),
    };
    await Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => screen));
  }

  Future<void> _newTransfer() async {
    final stores = _watcher.context;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => InventoryTransferComposeScreen(
          businessId: widget.businessId,
          source: _env.source,
          service: _env.service,
          access: _env.access,
          initialFromStoreId: _viewer.seesAllStores && _storeFilter.isNotEmpty
              ? _storeFilter
              : stores.homeStoreId,
          newRequestId: _env.newRequestId,
          cameraEnabled: _env.cameraEnabled,
          scans: _env.scans,
        ),
      ),
    );
  }

  void _retry() {
    setState(() => _timedOut = false);
    _feed.sync(
      _watcher.context,
      storesLoaded: _watcher.storesLoaded,
      force: true,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final stores = _watcher.context;
    final viewer = _viewer;
    final lists = InventoryTransferLists.of(
      _feed.all,
      viewer: viewer,
      businessId: widget.businessId,
      storeId: _storeFilter,
    );
    final shown = lists.of(_tab);
    final loading = (!_watcher.storesLoaded || !_feed.loaded) && !_timedOut;
    final now = widget.clock();
    final subtitle = stores.ownStoreId.isNotEmpty
        ? stores.storeName(stores.ownStoreId)
        : (stores.viewerSeesAll
              ? (_storeFilter.isEmpty
                    ? l10n.inventoryStoreFilterAll
                    : stores.storeName(_storeFilter))
              : null);
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(
            title: l10n.invTrTitle,
            subtitle: subtitle,
            actions: [
              if (viewer.canStartTransfer)
                // Shrinks (never overflows) beside a long title in French on
                // a narrow phone.
                Flexible(
                  child: TextButton.icon(
                    key: const Key('inv-tr-new'),
                    onPressed: _newTransfer,
                    icon: const Icon(Icons.add, size: 18),
                    label: Text(
                      l10n.invTrNew,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
            ],
          ),
          if (stores.multi && !viewer.blocked)
            _Tabs(
              selected: _tab,
              counts: lists.counts,
              onSelected: (tab) => setState(() => _tab = tab),
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
                if (_focusMissing) ...[
                  InventoryNote(
                    key: const Key('inv-tr-not-available'),
                    error: false,
                    text: l10n.invTrNotAvailable,
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
                if (stores.viewerSeesAll) ...[
                  InventoryChoiceChips(
                    keyPrefix: 'inv-tr-store',
                    options: inventoryStoreChoices(l10n, stores),
                    selected: _storeFilter,
                    onSelected: (id) => setState(() => _storeFilter = id),
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
                if (loading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: AppSpacing.xl),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (viewer.blocked)
                  InventoryNote(
                    key: const Key('inv-tr-home-missing'),
                    error: false,
                    text: l10n.inventoryStoreHomeRequiredView,
                  )
                else if (!stores.multi)
                  LotEmptyState(
                    key: const Key('inv-tr-single-store'),
                    icon: Icons.storefront_outlined,
                    title: l10n.invTrNeedsStores,
                  )
                else if (_feed.failed && shown.isEmpty)
                  InventoryNote(
                    key: const Key('inv-tr-load-failed'),
                    text: l10n.invTrLoadFailed,
                    trailing: TextButton(
                      key: const Key('inv-tr-retry'),
                      onPressed: _retry,
                      child: Text(l10n.retry),
                    ),
                  )
                else if (shown.isEmpty)
                  LotEmptyState(
                    key: Key('inv-tr-empty-${_tab.name}'),
                    icon: Icons.local_shipping_outlined,
                    title: switch (_tab) {
                      InventoryTransferTab.outgoing => l10n.invTrEmptyOutgoing,
                      InventoryTransferTab.incoming => l10n.invTrEmptyIncoming,
                      InventoryTransferTab.inTransit =>
                        l10n.invTrEmptyInTransit,
                      InventoryTransferTab.review => l10n.invTrEmptyReview,
                    },
                    hint:
                        _tab == InventoryTransferTab.outgoing &&
                            viewer.canStartTransfer
                        ? l10n.invTrEmptyHint
                        : null,
                  )
                else
                  for (final t in shown)
                    InventoryTransferCard(
                      key: ValueKey('inv-tr-card-${t.id}'),
                      transfer: t,
                      stores: stores,
                      now: now,
                      onTap: () => _open(t),
                    ),
                if (!loading && stores.multi && !viewer.blocked) ...[
                  const SizedBox(height: AppSpacing.lg),
                  Text(
                    l10n.invTrIncomingHint,
                    key: const Key('inv-tr-incoming-hint'),
                    style: const TextStyle(
                      fontSize: 13,
                      height: 1.4,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The four tabs, each with its count; Review's as a badge.
class _Tabs extends StatelessWidget {
  const _Tabs({
    required this.selected,
    required this.counts,
    required this.onSelected,
  });

  final InventoryTransferTab selected;
  final Map<InventoryTransferTab, int> counts;
  final ValueChanged<InventoryTransferTab> onSelected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    String label(InventoryTransferTab tab) => switch (tab) {
      InventoryTransferTab.outgoing => l10n.invTrTabOutgoing,
      InventoryTransferTab.incoming => l10n.invTrTabIncoming,
      InventoryTransferTab.inTransit => l10n.invTrTabInTransit,
      InventoryTransferTab.review => l10n.invTrTabReview,
    };
    return Container(
      color: AppColors.paper,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
        child: Row(
          children: [
            for (final tab in InventoryTransferTab.values)
              _Tab(
                key: Key('inv-tr-tab-${tab.name}'),
                label: tab == InventoryTransferTab.review
                    ? label(tab)
                    : '${label(tab)} · ${counts[tab] ?? 0}',
                badge:
                    tab == InventoryTransferTab.review && (counts[tab] ?? 0) > 0
                    ? '${counts[tab]}'
                    : null,
                selected: tab == selected,
                onTap: () => onSelected(tab),
              ),
          ],
        ),
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.badge,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: 48),
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                width: 3,
                color: selected ? AppColors.cobalt : Colors.transparent,
              ),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                  color: selected ? AppColors.ink : AppColors.muted,
                ),
              ),
              if (badge != null) ...[
                const SizedBox(width: 5),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 1,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.saffron,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    badge!,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: AppColors.ink,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// One transfer.
// ---------------------------------------------------------------------------

/// A transfer: Sent vs Received per product with its result, the receive
/// note, the track record, and the actions its state and the person allow
/// (Cancel, Receive, Review, Continue / Discard a draft, Print tags).
class InventoryTransferDetailScreen extends StatefulWidget {
  const InventoryTransferDetailScreen({
    super.key,
    required this.env,
    required this.transfer,
  });

  final InventoryTransferEnv env;
  final InventoryTransfer transfer;

  @override
  State<InventoryTransferDetailScreen> createState() =>
      _InventoryTransferDetailScreenState();
}

class _InventoryTransferDetailScreenState
    extends State<InventoryTransferDetailScreen> {
  late InventoryTransfer _t = widget.transfer;
  StreamSubscription<InventoryTransfer?>? _sub;
  late final InventoryContextWatcher _watcher = InventoryContextWatcher(
    source: widget.env.source,
    businessId: widget.env.businessId,
    access: widget.env.access,
    watchCategories: false,
    watchBrands: false,
    onChange: () {
      if (mounted) setState(() {});
    },
  );
  String _busy = '';

  /// One key per cancel attempt on this screen, so a retry after a lost
  /// answer is the same cancel.
  late final String _cancelKey = widget.env.newRequestId();

  InventoryTransferViewer get _viewer => InventoryTransferViewer(
    stores: _watcher.context,
    userId: widget.env.userId,
  );

  @override
  void initState() {
    super.initState();
    _watcher.start();
    // Live, so a receive or a decision made elsewhere shows at once.
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
    super.dispose();
  }

  Future<void> _push(Widget screen) => Navigator.of(
    context,
  ).push(MaterialPageRoute<void>(builder: (_) => screen));

  Future<void> _cancel({required bool draft}) async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    final stores = _watcher.context;
    final ok = await confirmMajorAction(
      context,
      title: draft ? l10n.invTrDiscardTitle : l10n.invTrCancelTitle,
      message: draft
          ? l10n.invTrDiscardMessage
          : l10n.invTrCancelMessage(_t.itemsCount, _t.fromName(stores)),
      confirmLabel: draft ? l10n.invTrDiscard : l10n.invTrCancel,
      destructive: true,
    );
    if (!ok || !mounted) return;
    setState(() => _busy = draft ? 'discard' : 'cancel');
    try {
      await widget.env.service.cancelTransfer(
        businessId: widget.env.businessId,
        transferId: _t.id,
        requestId: _cancelKey,
      );
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(
        context,
        draft ? l10n.invTrDiscardDone : l10n.invTrCancelDone,
      );
      if (draft) Navigator.of(context).maybePop();
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, inventoryTransferFailureText(l10n, error));
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _printTags() async {
    final l10n = AppLocalizations.of(context)!;
    final lines = [
      for (final l in _t.lines)
        if ((l.quantityReceived ?? 0) > 0) l,
    ];
    if (lines.isEmpty) return;
    final line = lines.length == 1
        ? lines.single
        : await pickLotOption<InventoryTransferLine>(
            context,
            title: l10n.invTrPrintPick,
            options: [
              for (final l in lines)
                LotOption(
                  l,
                  l.displayName,
                  detail: [
                    l.code,
                    l10n.invTrReceivedQty(l.quantityReceived ?? 0),
                  ].join(' · '),
                ),
            ],
          );
    if (line == null || !mounted) return;
    await showPrintTagsSheet(
      context,
      businessId: widget.env.businessId,
      itemId: line.itemId,
      code: line.code,
      title: line.displayName,
      opener: widget.env.tagOpener,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final stores = _watcher.context;
    final viewer = _viewer;
    final t = _t;
    final now = widget.env.clock();
    final chip = inventoryTransferChip(l10n, t, now);
    final busy = _busy.isNotEmpty;
    final received = t.isReceived;
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(
            title: t.code.isEmpty ? l10n.invTrTitle : t.code,
            subtitle: l10n.invTrTitle,
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
                _Panel(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: InventoryTransferRoute(
                            from: t.fromName(stores),
                            to: t.toName(stores),
                            fontSize: 16,
                          ),
                        ),
                        InventoryChip(
                          key: const Key('inv-tr-detail-chip'),
                          label: chip.label,
                          color: chip.color,
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      inventoryTransferCardDetail(l10n, t, now, locale),
                      style: const TextStyle(
                        fontSize: 13,
                        height: 1.35,
                        color: AppColors.muted,
                      ),
                    ),
                    if (t.valueCents > 0) ...[
                      const SizedBox(height: 4),
                      Text(
                        l10n.invTrValueAtCost(formatLotCents(t.valueCents)),
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                _Panel(
                  children: [_LinesTable(transfer: t, stores: stores)],
                ),
                if (t.receiveNote.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.md),
                  InventoryNote(
                    key: const Key('inv-tr-receive-note'),
                    error: false,
                    text: l10n.invTrStoreNote(t.toName(stores), t.receiveNote),
                  ),
                ],
                const SizedBox(height: AppSpacing.lg),
                if (canReceiveTransfer(t, viewer)) ...[
                  ContainerActionButton(
                    key: const Key('inv-tr-act-receive'),
                    icon: Icons.inventory_outlined,
                    label: l10n.invTrConfirmReceived,
                    primary: true,
                    onTap: busy
                        ? () {}
                        : () => _push(
                            InventoryTransferReceiveScreen(
                              env: widget.env,
                              transfer: t,
                            ),
                          ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                ],
                if (canResolveTransfer(t, viewer)) ...[
                  ContainerActionButton(
                    key: const Key('inv-tr-act-review'),
                    icon: Icons.fact_check_outlined,
                    label: l10n.invTrReviewAction,
                    primary: true,
                    onTap: busy
                        ? () {}
                        : () => _push(
                            InventoryTransferReviewScreen(
                              env: widget.env,
                              transfer: t,
                            ),
                          ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                ],
                if (canEditTransferDraft(t, viewer)) ...[
                  ContainerActionButton(
                    key: const Key('inv-tr-act-continue'),
                    icon: Icons.edit_outlined,
                    label: l10n.invTrContinue,
                    primary: true,
                    onTap: busy
                        ? () {}
                        : () => _push(
                            InventoryTransferComposeScreen(
                              businessId: widget.env.businessId,
                              source: widget.env.source,
                              service: widget.env.service,
                              access: widget.env.access,
                              draft: t,
                              newRequestId: widget.env.newRequestId,
                              cameraEnabled: widget.env.cameraEnabled,
                              scans: widget.env.scans,
                            ),
                          ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                ],
                if (received &&
                    t.lines.any((l) => (l.quantityReceived ?? 0) > 0)) ...[
                  ContainerActionButton(
                    key: const Key('inv-tr-act-tags'),
                    icon: Icons.qr_code_2,
                    label: l10n.inventoryPrintTags,
                    onTap: busy ? () {} : _printTags,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                ],
                if (canCancelTransfer(t, viewer)) ...[
                  ContainerActionButton(
                    key: const Key('inv-tr-act-cancel'),
                    icon: Icons.undo,
                    label: l10n.invTrCancel,
                    busy: _busy == 'cancel',
                    enabled: !busy,
                    onTap: () => _cancel(draft: false),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                ],
                if (canDiscardTransferDraft(t, viewer)) ...[
                  ContainerActionButton(
                    key: const Key('inv-tr-act-discard'),
                    icon: Icons.delete_outline,
                    label: l10n.invTrDiscard,
                    busy: _busy == 'discard',
                    enabled: !busy,
                    onTap: () => _cancel(draft: true),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                ],
                const SizedBox(height: AppSpacing.md),
                InventorySectionLabel(l10n.invTrTrackRecord),
                InventoryTransferTimeline(transfer: t, stores: stores),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(AppSpacing.lg),
    decoration: BoxDecoration(
      color: AppColors.paper,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: AppColors.rule),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    ),
  );
}

/// Product | Sent | Received, with each line's result under its name.
class _LinesTable extends StatelessWidget {
  const _LinesTable({required this.transfer, required this.stores});

  final InventoryTransfer transfer;
  final InventoryStoreContext stores;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    const head = TextStyle(
      fontSize: 11.5,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.3,
      color: AppColors.muted,
    );
    const number = TextStyle(
      fontSize: 15,
      fontWeight: FontWeight.w700,
      color: AppColors.ink,
    );
    final from = transfer.fromName(stores);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: Text(l10n.invTrColProduct, style: head)),
            SizedBox(
              width: 64,
              child: Text(
                l10n.invTrColSent,
                style: head,
                textAlign: TextAlign.end,
              ),
            ),
            SizedBox(
              width: 76,
              child: Text(
                l10n.invTrColReceived,
                style: head,
                textAlign: TextAlign.end,
              ),
            ),
          ],
        ),
        const Divider(height: AppSpacing.lg, color: AppColors.rule),
        for (final line in transfer.lines)
          Padding(
            key: ValueKey('inv-tr-line-${line.itemId}'),
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        line.displayName,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      if (line.code.isNotEmpty)
                        Text(
                          line.code,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.muted,
                          ),
                        ),
                      if (inventoryTransferResultText(
                        l10n,
                        line,
                        from,
                      ).isNotEmpty)
                        Text(
                          inventoryTransferResultText(l10n, line, from),
                          key: Key('inv-tr-result-${line.itemId}'),
                          style: TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: inventoryTransferResultColor(line),
                          ),
                        ),
                    ],
                  ),
                ),
                SizedBox(
                  width: 64,
                  child: Text(
                    '${line.quantitySent}',
                    style: number,
                    textAlign: TextAlign.end,
                  ),
                ),
                SizedBox(
                  width: 76,
                  child: Text(
                    line.quantityReceived == null
                        ? '—'
                        : '${line.quantityReceived}',
                    key: Key('inv-tr-received-${line.itemId}'),
                    style: number,
                    textAlign: TextAlign.end,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
