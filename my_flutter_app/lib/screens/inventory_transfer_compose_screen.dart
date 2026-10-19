import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory.dart';
import '../services/inventory_context.dart';
import '../services/inventory_service.dart';
import '../services/inventory_stores.dart';
import '../services/inventory_transfers.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/inventory_transfer_widgets.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/scanner_camera_view.dart';

/// New transfer (and Continue a draft): From, To, the products and how many
/// of each. A line says how many the source store holds and its + stops
/// there ("That's all of them."). Save draft keeps it for later and reserves
/// nothing; Send N items takes the pieces out of the source store at once.
///
/// Staff tied to one store always send from it; the owner and all-stores
/// staff pick the source. Products are added by typing their name, or with
/// the small scan button.
class InventoryTransferComposeScreen extends StatefulWidget {
  const InventoryTransferComposeScreen({
    super.key,
    required this.businessId,
    required this.source,
    this.service = const InventoryService(),
    this.access = const InventoryAccess.owner(),
    this.initialFromStoreId = '',
    this.initialItem,
    this.draft,
    this.newRequestId = newInventoryTransferRequestId,
    this.cameraEnabled = true,
    this.scans,
  });

  final String businessId;
  final InventorySource source;
  final InventoryService service;
  final InventoryAccess access;

  /// The source store to start on (someone who picks).
  final String initialFromStoreId;

  /// A product to start with ("Send to another store" on its page).
  final InventoryItem? initialItem;

  /// A draft to continue: its key, stores and lines.
  final InventoryTransfer? draft;
  final String Function() newRequestId;

  @visibleForTesting
  final bool cameraEnabled;

  @visibleForTesting
  final Stream<String>? scans;

  @override
  State<InventoryTransferComposeScreen> createState() =>
      _InventoryTransferComposeScreenState();
}

class _InventoryTransferComposeScreenState
    extends State<InventoryTransferComposeScreen> {
  late InventoryTransferComposer _composer = widget.draft == null
      ? InventoryTransferComposer(
          clientRequestId: widget.newRequestId(),
          fromStoreId: widget.initialFromStoreId,
        )
      : InventoryTransferComposer.fromDraft(widget.draft!);

  late final InventoryContextWatcher _watcher = InventoryContextWatcher(
    source: widget.source,
    businessId: widget.businessId,
    access: widget.access,
    watchCategories: false,
    watchBrands: false,
    onChange: _contextChanged,
  );
  final List<StreamSubscription<Object?>> _subs = [];
  final TextEditingController _find = TextEditingController();
  List<InventoryItem> _items = const [];
  Map<String, InventoryItem> _byId = const {};
  bool _itemsLoaded = false;
  bool _initialAdded = false;

  /// What the server said the source holds, after an `insufficient_stock`.
  Map<String, int> _available = const {};
  String _busy = '';
  String? _error;
  String? _scanNote;

  InventoryStoreContext get _stores => _watcher.context;

  @override
  void initState() {
    super.initState();
    _watcher.start();
    _subs.add(
      widget.source
          .watchItems(widget.businessId)
          .listen(
            (items) {
              if (!mounted) return;
              setState(() {
                _items = items;
                _byId = {for (final i in items) i.id: i};
                _itemsLoaded = true;
              });
              _addInitial();
            },
            onError: (_) {
              if (mounted) setState(() => _itemsLoaded = true);
            },
          ),
    );
    final feed = widget.scans;
    if (feed != null) _subs.add(feed.listen(_addScanned));
  }

  @override
  void dispose() {
    _watcher.dispose();
    for (final s in _subs) {
      s.cancel();
    }
    _find.dispose();
    super.dispose();
  }

  void _contextChanged() {
    if (!mounted) return;
    final stores = _stores;
    setState(() {
      // Staff of one store always send from it; someone who picks starts on
      // the given store, else the first active one.
      if (!widget.access.seesAllStores) {
        final home = stores.homeStoreId;
        if (home.isNotEmpty && _composer.fromStoreId != home) {
          _composer = _composer.withFrom(home);
        }
      } else if (!stores.active.any((s) => s.id == _composer.fromStoreId)) {
        _composer = _composer.withFrom(stores.defaultStoreId);
      }
    });
    _addInitial();
  }

  /// The product the screen was opened for, once its count can be read. The
  /// stores answer before their counts do, so a count of 0 is tried again on
  /// the next change (the note says so meanwhile) rather than given up on.
  void _addInitial() {
    final item = widget.initialItem;
    if (item == null || _initialAdded) return;
    if (!_watcher.storesLoaded || _composer.fromStoreId.isEmpty) return;
    final current = _byId[item.id] ?? item;
    if (_max(current.id) <= 0 && !current.archived) {
      final l10n = AppLocalizations.of(context)!;
      setState(
        () => _scanNote = l10n.invTrNoneInStore(
          current.displayName,
          _stores.storeName(_composer.fromStoreId),
        ),
      );
      return;
    }
    _initialAdded = true;
    _add(current);
  }

  int _max(String itemId) {
    final known = _available[itemId];
    final item =
        _byId[itemId] ??
        (widget.initialItem?.id == itemId ? widget.initialItem : null);
    final local = item == null
        ? 0
        : inventoryTransferMaxFor(
            item,
            _stores,
            _watcher.stock,
            _composer.fromStoreId,
          );
    return known == null ? local : (known < local ? known : local);
  }

  void _add(InventoryItem item) {
    final l10n = AppLocalizations.of(context)!;
    final store = _stores.storeName(_composer.fromStoreId);
    final max = _max(item.id);
    setState(() {
      _error = null;
      if (item.archived) {
        _scanNote = l10n.inventoryItemArchivedScan(item.displayName);
        return;
      }
      if (max <= 0) {
        _scanNote = l10n.invTrNoneInStore(item.displayName, store);
        return;
      }
      _scanNote = null;
      _composer = _composer.add(item, max: max);
      _find.clear();
    });
    AppHaptics.selection();
  }

  Future<void> _addScanned(String raw) async {
    final l10n = AppLocalizations.of(context)!;
    final code = inventoryCodeFromScan(raw);
    if (code == null) {
      setState(() => _scanNote = l10n.inventoryNotATag);
      return;
    }
    InventoryItem? item;
    for (final candidate in _items) {
      if (candidate.code == code) item = candidate;
    }
    if (item == null) {
      try {
        item = await widget.source
            .findItemByCode(widget.businessId, code)
            .timeout(const Duration(seconds: 8));
      } catch (_) {
        if (mounted) setState(() => _scanNote = l10n.inventoryLookupFailed);
        return;
      }
    }
    if (!mounted) return;
    if (item == null ||
        (item.businessId.isNotEmpty && item.businessId != widget.businessId)) {
      AppHaptics.refuse();
      setState(() => _scanNote = l10n.inventoryItemNotYours);
      return;
    }
    _add(item);
  }

  Future<void> _scan() async {
    final code = await showInventoryScanSheet(context);
    if (code != null && mounted) await _addScanned(code);
  }

  Future<void> _pickStore({required bool from}) async {
    final l10n = AppLocalizations.of(context)!;
    final stores = _stores;
    final picked = await pickLotOption<String>(
      context,
      title: from ? l10n.inventoryTransferFrom : l10n.inventoryTransferTo,
      selected: from ? _composer.fromStoreId : _composer.toStoreId,
      options: [
        for (final store in stores.active)
          if (from || store.id != _composer.fromStoreId)
            LotOption(store.id, store.name),
      ],
    );
    if (picked == null || !mounted) return;
    setState(() {
      _error = null;
      _available = const {};
      _composer = from ? _composer.withFrom(picked) : _composer.withTo(picked);
    });
  }

  String _problemText(AppLocalizations l10n, String code) => switch (code) {
    'store_required' => l10n.invTrErrTo,
    'same_store' => l10n.inventoryFailSameStore,
    'transfer_lines_required' => l10n.inventoryFailTransferLinesRequired,
    'transfer_lines_too_many' => l10n.inventoryFailTransferLinesTooMany,
    'insufficient_stock' => l10n.invTrErrOverMax,
    _ => l10n.inventoryErrQuantity,
  };

  Future<void> _save({required bool send}) async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    final problems = _composer.problems(sending: send, maxOf: _max);
    if (problems.isNotEmpty) {
      AppHaptics.refuse();
      setState(() => _error = _problemText(l10n, problems.first));
      return;
    }
    final composer = _composer;
    final toName = _stores.storeName(composer.toStoreId);
    setState(() {
      _busy = send ? 'send' : 'draft';
      _error = null;
    });
    try {
      if (send) {
        final result = await widget.service.sendTransfer(
          widget.businessId,
          composer,
        );
        if (!mounted) return;
        AppHaptics.commit();
        unawaited(
          Navigator.of(context).pushReplacement(
            MaterialPageRoute<void>(
              builder: (_) => InventoryTransferSentScreen(
                toStoreName: toName,
                code: result.code,
                lines: composer.lines,
                itemsCount: result.itemsCount > 0
                    ? result.itemsCount
                    : composer.itemsCount,
              ),
            ),
          ),
        );
      } else {
        await widget.service.saveTransferDraft(widget.businessId, composer);
        if (!mounted) return;
        AppHaptics.commit();
        showSuccessSnackBar(context, l10n.invTrDraftSaved);
        Navigator.of(context).maybePop();
      }
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      final details = error is FirebaseFunctionsException
          ? error.details
          : null;
      setState(() {
        final available = inventoryTransferAvailableOf(details);
        if (available.isNotEmpty) _available = {..._available, ...available};
        _error = inventoryTransferFailureText(l10n, error);
      });
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final stores = _stores;
    final fromName = stores.storeName(_composer.fromStoreId);
    final toName = stores.storeName(_composer.toStoreId);
    final query = _find.text;
    final hits = inventorySellSearch(_items, query);
    final busy = _busy.isNotEmpty;
    final picks = widget.access.seesAllStores && stores.active.length > 1;
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(
            title: widget.draft == null ? l10n.invTrNew : l10n.invTrContinue,
            subtitle: [
              l10n.invTrTitle,
              if (widget.draft?.code.isNotEmpty ?? false) widget.draft!.code,
            ].join(' · '),
          ),
          Expanded(
            child: ListView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                AppSpacing.xl,
              ),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: picks
                          ? LotPickerField(
                              key: const Key('inv-tr-from'),
                              label: l10n.inventoryTransferFrom,
                              value: fromName,
                              placeholder: l10n.invTrChooseStore,
                              onTap: busy
                                  ? () {}
                                  : () => _pickStore(from: true),
                            )
                          : _FixedField(
                              key: const Key('inv-tr-from'),
                              label: l10n.inventoryTransferFrom,
                              value: fromName,
                            ),
                    ),
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 6),
                      child: Icon(
                        Icons.arrow_forward_rounded,
                        color: AppColors.cobalt,
                      ),
                    ),
                    Expanded(
                      child: LotPickerField(
                        key: const Key('inv-tr-to'),
                        label: l10n.inventoryTransferTo,
                        value: toName,
                        placeholder: l10n.invTrChooseStore,
                        onTap: busy ? () {} : () => _pickStore(from: false),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
                TextField(
                  key: const Key('inv-tr-find'),
                  controller: _find,
                  autocorrect: false,
                  textInputAction: TextInputAction.search,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: l10n.invTrAddProductHint,
                    prefixIcon: const Icon(
                      Icons.search,
                      size: 20,
                      color: AppColors.muted,
                    ),
                    suffixIcon: IconButton(
                      key: const Key('inv-tr-scan'),
                      tooltip: l10n.invTrScanTooltip,
                      icon: const Icon(Icons.qr_code_scanner),
                      onPressed: busy || !widget.cameraEnabled ? null : _scan,
                    ),
                  ),
                ),
                if (_scanNote != null) ...[
                  const SizedBox(height: AppSpacing.sm),
                  InventoryNote(
                    key: const Key('inv-tr-scan-note'),
                    error: false,
                    text: _scanNote!,
                  ),
                ],
                if (query.trim().length >= 2) ...[
                  const SizedBox(height: AppSpacing.sm),
                  if (!_itemsLoaded)
                    const Padding(
                      padding: EdgeInsets.all(AppSpacing.md),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else if (hits.isEmpty)
                    Text(
                      l10n.inventoryNoMatch,
                      key: const Key('inv-tr-no-match'),
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppColors.muted,
                      ),
                    )
                  else
                    for (final item in hits)
                      _SearchHit(
                        key: ValueKey('inv-tr-hit-${item.id}'),
                        item: item,
                        holding: _max(item.id),
                        store: fromName,
                        full: _composer.quantityOf(item.id) >= _max(item.id),
                        onTap: () => _add(item),
                      ),
                ],
                const SizedBox(height: AppSpacing.lg),
                if (_composer.lines.isEmpty)
                  Text(
                    l10n.invTrNoProductsYet,
                    key: const Key('inv-tr-no-lines'),
                    style: const TextStyle(
                      fontSize: 13,
                      height: 1.4,
                      color: AppColors.muted,
                    ),
                  )
                else
                  for (final line in _composer.lines)
                    _ComposeLine(
                      key: ValueKey('inv-tr-line-${line.itemId}'),
                      line: line,
                      max: _max(line.itemId),
                      store: fromName,
                      enabled: !busy,
                      onQuantity: (n) => setState(() {
                        _error = null;
                        _composer = _composer.setQuantity(
                          line.itemId,
                          n,
                          max: _max(line.itemId),
                        );
                      }),
                      onRemove: () => setState(() {
                        _error = null;
                        _composer = _composer.remove(line.itemId);
                      }),
                    ),
                if (_error != null) ...[
                  const SizedBox(height: AppSpacing.sm),
                  InventoryNote(key: const Key('inv-tr-error'), text: _error!),
                ],
              ],
            ),
          ),
          _ComposeBar(
            summary: [
              l10n.invTrProducts(_composer.productsCount),
              l10n.invTrItems(_composer.itemsCount),
            ].join(' · '),
            itemsCount: _composer.itemsCount,
            busy: _busy,
            onDraft: () => _save(send: false),
            onSend: () => _save(send: true),
          ),
        ],
      ),
    );
  }
}

/// A store that is not picked (staff send from their own store).
class _FixedField extends StatelessWidget {
  const _FixedField({super.key, required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(
      horizontal: AppSpacing.lg,
      vertical: AppSpacing.md,
    ),
    decoration: BoxDecoration(
      color: AppColors.paper,
      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      border: Border.all(color: AppColors.rule),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.2,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
            color: AppColors.ink,
          ),
        ),
      ],
    ),
  );
}

class _SearchHit extends StatelessWidget {
  const _SearchHit({
    super.key,
    required this.item,
    required this.holding,
    required this.store,
    required this.full,
    required this.onTap,
  });

  final InventoryItem item;
  final int holding;
  final String store;
  final bool full;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final usable = holding > 0 && !full;
    return PressableScale(
      onTap: usable ? onTap : null,
      scale: 0.99,
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: 10,
        ),
        decoration: BoxDecoration(
          color: AppColors.paper,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          border: Border.all(color: AppColors.rule),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.displayName,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                  Text(
                    [item.code, l10n.invTrInStore(holding, store)].join(' · '),
                    style: TextStyle(
                      fontSize: 12,
                      color: holding > 0 ? AppColors.muted : AppColors.warn,
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              Icons.add_circle_outline,
              color: usable ? AppColors.cobalt : AppColors.rule,
            ),
          ],
        ),
      ),
    );
  }
}

class _ComposeLine extends StatelessWidget {
  const _ComposeLine({
    super.key,
    required this.line,
    required this.max,
    required this.store,
    required this.enabled,
    required this.onQuantity,
    required this.onRemove,
  });

  final InventoryTransferDraftLine line;
  final int max;
  final String store;
  final bool enabled;
  final ValueChanged<int> onQuantity;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final atMax = line.quantity >= max;
    final over = line.quantity > max;
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: over
              ? AppColors.errorRed.withValues(alpha: 0.5)
              : AppColors.rule,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      line.name,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                    Text(
                      atMax
                          ? l10n.invTrOnlyInStore(max, store)
                          : l10n.invTrInStore(max, store),
                      key: Key('inv-tr-holding-${line.itemId}'),
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: atMax ? FontWeight.w600 : FontWeight.w400,
                        color: over
                            ? AppColors.errorRed
                            : (atMax ? AppColors.warn : AppColors.muted),
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                key: Key('inv-tr-remove-${line.itemId}'),
                tooltip: l10n.invTrRemoveLine,
                onPressed: enabled ? onRemove : null,
                icon: const Icon(Icons.close, size: 18, color: AppColors.muted),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Align(
            alignment: Alignment.centerRight,
            child: InventoryStepper(
              keyPrefix: 'inv-tr-qty-${line.itemId}',
              value: line.quantity,
              minusLabel: l10n.invTrLess,
              plusLabel: l10n.invTrMore,
              onMinus: enabled && line.quantity > 1
                  ? () => onQuantity(line.quantity - 1)
                  : null,
              onPlus: enabled && !atMax
                  ? () => onQuantity(line.quantity + 1)
                  : null,
            ),
          ),
          if (atMax && max > 0) ...[
            const SizedBox(height: 6),
            Text(
              l10n.invTrAllOfThem,
              key: Key('inv-tr-all-${line.itemId}'),
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.35,
                color: AppColors.warn,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ComposeBar extends StatelessWidget {
  const _ComposeBar({
    required this.summary,
    required this.itemsCount,
    required this.busy,
    required this.onDraft,
    required this.onSend,
  });

  final String summary;
  final int itemsCount;
  final String busy;
  final VoidCallback onDraft;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final working = busy.isNotEmpty;
    return Container(
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
              summary,
              key: const Key('inv-tr-summary'),
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
              ),
            ),
            Text(
              l10n.invTrOwnerNotified,
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    key: const Key('inv-tr-save-draft'),
                    onPressed: working ? null : onDraft,
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(50),
                      foregroundColor: AppColors.cobaltDeep,
                    ),
                    child: busy == 'draft'
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(
                            l10n.invTrSaveDraft,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  flex: 2,
                  child: LotSheetButton(
                    key: const Key('inv-tr-send'),
                    label: l10n.invTrSend(itemsCount),
                    busy: busy == 'send',
                    busyLabel: l10n.invTrSending,
                    onTap: working ? null : onSend,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sent.
// ---------------------------------------------------------------------------

/// What was just sent: where, how many, and that it can be cancelled until
/// the other store confirms.
class InventoryTransferSentScreen extends StatelessWidget {
  const InventoryTransferSentScreen({
    super.key,
    required this.toStoreName,
    required this.code,
    required this.lines,
    required this.itemsCount,
  });

  final String toStoreName;
  final String code;
  final List<InventoryTransferDraftLine> lines;
  final int itemsCount;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(title: l10n.invTrSentTitle, subtitle: code),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              children: [
                const Icon(
                  Icons.local_shipping_outlined,
                  size: 44,
                  color: AppColors.cobalt,
                ),
                const SizedBox(height: AppSpacing.md),
                Text(
                  l10n.invTrSentTo(toStoreName),
                  key: const Key('inv-tr-sent-title'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  l10n.invTrSentBody(itemsCount, toStoreName),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.45,
                    color: AppColors.muted,
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                Container(
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  decoration: BoxDecoration(
                    color: AppColors.paper,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.rule),
                  ),
                  child: Column(
                    children: [
                      for (final line in lines)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  line.name,
                                  style: const TextStyle(
                                    fontSize: 14,
                                    color: AppColors.ink,
                                  ),
                                ),
                              ),
                              Text(
                                '${line.quantity}',
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w800,
                                  color: AppColors.ink,
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                InventoryNote(
                  error: false,
                  text: l10n.invTrSentNote(toStoreName),
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
            color: AppColors.paper,
            child: SafeArea(
              top: false,
              child: LotSheetButton(
                key: const Key('inv-tr-sent-done'),
                label: l10n.invTrDone,
                onTap: () => Navigator.of(context).maybePop(),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// The scan button.
// ---------------------------------------------------------------------------

/// Opens the camera in a sheet and answers the first product tag code it
/// reads (null when closed).
Future<String?> showInventoryScanSheet(BuildContext context) =>
    showLotSheet<String>(context, const _ScanSheet());

class _ScanSheet extends StatefulWidget {
  const _ScanSheet();

  @override
  State<_ScanSheet> createState() => _ScanSheetState();
}

class _ScanSheetState extends State<_ScanSheet> {
  final MobileScannerController _camera = MobileScannerController(
    formats: const [BarcodeFormat.qrCode],
  );
  bool _done = false;

  @override
  void dispose() {
    _camera.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_done) return;
    for (final barcode in capture.barcodes) {
      final code = inventoryCodeFromScan(barcode.rawValue ?? '');
      if (code == null) continue;
      _done = true;
      Navigator.of(context).pop(code);
      return;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return LotSheetShell(
      title: l10n.invTrScanTitle,
      subtitle: l10n.inventoryScanHint,
      body: ClipRRect(
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        child: SizedBox(
          height: 260,
          child: ScannerCameraView(
            controller: _camera,
            onDetect: _onDetect,
            unavailableText: l10n.inventoryCameraUnavailable,
            frameMargin: const EdgeInsets.all(40),
          ),
        ),
      ),
    );
  }
}
