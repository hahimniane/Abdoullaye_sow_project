import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../l10n/app_localizations.dart';
import '../services/invoice_ledger.dart' show invoiceCentsToInput;
import '../services/inventory.dart';
import '../services/inventory_context.dart';
import '../services/inventory_service.dart';
import '../services/inventory_stores.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/scanner_camera_view.dart';

/// The counter: scan a product's tag and it joins the basket; scan it again
/// and it counts one more. Quantity and price can be changed per line (the
/// list price stays visible), a payment method is picked, and Sold records the
/// sale in one call.
///
/// Online only: when the connection fails the basket stays exactly as it was
/// and Sold is tried again - the same `clientRequestId` goes with the retry, so
/// a sale whose answer was lost is never recorded twice.
///
/// A tag resolves to a product of THIS business only; a tag from another shop,
/// or an archived product, says so instead of joining the basket. A tag that
/// will not scan is typed, or its product is found by name.
class InventorySellScreen extends StatefulWidget {
  const InventorySellScreen({
    super.key,
    required this.businessId,
    this.initialCode = '',
    this.source,
    this.service = const InventoryService(),
    this.newRequestId = newInventoryRequestId,
    this.cameraEnabled = true,
    this.scans,
    this.access = const InventoryAccess.owner(),
  });

  final String businessId;

  /// What the signed-in person may do across stores. In a business with
  /// several stores it decides where the sale goes: staff sell from their home
  /// store without being asked; the owner and "works in all stores" staff pick.
  final InventoryAccess access;

  /// A tag the screen opens with - an app link the person tapped.
  final String initialCode;
  final InventorySource? source;
  final InventoryService service;

  /// Makes the id one sale attempt is sent with (a fake in tests).
  final String Function() newRequestId;

  /// Off in widget tests, where there is no camera plugin.
  @visibleForTesting
  final bool cameraEnabled;

  /// Raw tag payloads fed in place of the camera (widget tests).
  @visibleForTesting
  final Stream<String>? scans;

  @override
  State<InventorySellScreen> createState() => _InventorySellScreenState();
}

class _InventorySellScreenState extends State<InventorySellScreen> {
  late final InventorySource _source = widget.source ?? FirestoreInventorySource();
  late final SaleAttempt _attempt = SaleAttempt(newId: widget.newRequestId);
  final ScanDebouncer _debouncer = ScanDebouncer();
  final TextEditingController _find = TextEditingController();
  final List<StreamSubscription<Object?>> _subs = [];

  MobileScannerController? _camera;

  /// Whether the camera is open. It closes after every tag it reads, so a
  /// camera drifting over the shelf cannot keep adding things; the person
  /// opens it again for the next product.
  bool _scanning = true;

  late final InventoryContextWatcher _watcher = InventoryContextWatcher(
    source: _source,
    businessId: widget.businessId,
    access: widget.access,
    watchCategories: false,
    onChange: () {
      if (!mounted) return;
      setState(_refreshView);
    },
  );

  /// The store a person who picks has chosen ('' = their default).
  String _pickedStore = '';

  /// The products as stored, and as sold from the store in use (its own count
  /// in place of the total, in a business with several stores).
  List<InventoryItem> _rawItems = const [];
  List<InventoryItem> _items = const [];
  String _soldStoreName = '';
  Basket _basket = const Basket();
  String _payment = 'cash';

  bool _busy = false;
  InventoryFailure? _failure;

  /// The sale just recorded: shown in place of the basket until a new sale
  /// starts.
  InventorySaleResult? _result;
  List<BasketLine> _soldLines = const [];

  ({String text, bool error})? _note;
  bool _foreignQr = false;

  /// Lines whose typed price cannot be read: Sold waits until fixed.
  final Set<String> _badPrices = {};

  @override
  void initState() {
    super.initState();
    if (widget.cameraEnabled) {
      _camera = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
    }
    _watcher.start();
    _subs.add(_source.watchItems(widget.businessId).listen((items) {
      if (!mounted) return;
      setState(() {
        _rawItems = items;
        _refreshView();
      });
    }, onError: (_) {}));
    final feed = widget.scans;
    if (feed != null) _subs.add(feed.listen(_addRaw));
    if (widget.initialCode.isNotEmpty) {
      // After the first frame: the note it may set needs the screen's l10n.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _addRaw(widget.initialCode);
      });
    }
  }

  /// Where this sale goes, for this person.
  InventorySellStore get _sell => inventorySellStore(_watcher.context);

  /// The store whose counts the basket is checked against ('' for none).
  String get _countStoreId {
    final sell = _sell;
    return sell.mode == InventorySellStoreMode.pick
        ? (_pickedStore.isNotEmpty ? _pickedStore : sell.defaultStoreId)
        : '';
  }

  /// Recomputes what the screen sells from; call inside setState.
  void _refreshView() {
    _items = inventoryViewItems(
      _rawItems,
      _watcher.context,
      _watcher.stock,
      storeFilter: _countStoreId,
    );
    _basket = _basket.refreshed(_items);
  }

  @override
  void dispose() {
    _watcher.dispose();
    for (final s in _subs) {
      s.cancel();
    }
    _camera?.dispose();
    _find.dispose();
    super.dispose();
  }

  // ----- adding what was scanned --------------------------------------------

  void _onDetect(BarcodeCapture capture) {
    for (final barcode in capture.barcodes) {
      final raw = barcode.rawValue ?? '';
      if (raw.isEmpty) continue;
      final code = inventoryCodeFromScan(raw);
      if (code == null) {
        if (!_foreignQr) setState(() => _foreignQr = true);
        continue;
      }
      if (!_debouncer.accept(code, DateTime.now())) return;
      _closeScanner();
      _addRaw(code);
      return;
    }
  }

  void _closeScanner() {
    if (!_scanning) return;
    setState(() => _scanning = false);
    _camera?.stop().catchError((Object _) {});
  }

  void _openScanner() {
    if (_scanning) return;
    setState(() {
      _scanning = true;
      _foreignQr = false;
    });
  }

  Future<void> _addRaw(String raw) async {
    final l10n = AppLocalizations.of(context)!;
    final code = inventoryCodeFromScan(raw);
    if (code == null) {
      setState(() => _note = (text: l10n.inventoryNotATag, error: true));
      return;
    }
    await _addCode(code);
  }

  Future<void> _addCode(String code) async {
    final l10n = AppLocalizations.of(context)!;
    InventoryItem? item;
    for (final candidate in _items) {
      if (candidate.code == code) {
        item = candidate;
        break;
      }
    }
    if (item == null) {
      try {
        item = await _source
            .findItemByCode(widget.businessId, code)
            .timeout(const Duration(seconds: 8));
      } catch (_) {
        if (!mounted) return;
        setState(() => _note = (text: l10n.inventoryLookupFailed, error: true));
        AppHaptics.refuse();
        return;
      }
    }
    if (!mounted) return;
    if (item == null ||
        (item.businessId.isNotEmpty && item.businessId != widget.businessId)) {
      AppHaptics.refuse();
      setState(() => _note = (text: l10n.inventoryItemNotYours, error: true));
      return;
    }
    _addItem(inventoryViewItems([item], _watcher.context, _watcher.stock,
            storeFilter: _countStoreId)
        .first);
  }

  void _addItem(InventoryItem item) {
    final l10n = AppLocalizations.of(context)!;
    if (item.archived) {
      AppHaptics.refuse();
      setState(() => _note =
          (text: l10n.inventoryItemArchivedScan(item.name), error: true));
      return;
    }
    AppHaptics.commit();
    setState(() {
      // A scan after a finished sale starts the next one.
      if (_result != null) {
        _result = null;
        _soldLines = const [];
      }
      _basket = _basket.addScan(item);
      _failure = null;
      _foreignQr = false;
      _note = (text: l10n.inventoryAddedToBasket(item.name), error: false);
    });
  }

  // ----- the basket ----------------------------------------------------------

  void _setQuantity(String itemId, int quantity) => setState(() {
        _basket = _basket.withQuantity(itemId, quantity);
        _failure = null;
      });

  void _setPrice(String itemId, int cents) => setState(() {
        _basket = _basket.withPrice(itemId, cents);
        _badPrices.remove(itemId);
        _failure = null;
      });

  void _priceInvalid(String itemId, bool invalid) => setState(() {
        if (invalid) {
          _badPrices.add(itemId);
        } else {
          _badPrices.remove(itemId);
        }
      });

  void _remove(String itemId) => setState(() {
        _basket = _basket.withoutLine(itemId);
        _badPrices.remove(itemId);
        _failure = null;
      });

  Future<void> _pickPayment() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.inventoryPaymentHow,
      selected: _payment,
      options: [
        for (final m in inventoryPaymentMethods)
          LotOption(m, inventoryPaymentLabel(l10n, m)),
      ],
    );
    if (picked == null || !mounted) return;
    setState(() => _payment = picked);
  }

  // ----- selling -------------------------------------------------------------

  Future<void> _pickStore() async {
    final l10n = AppLocalizations.of(context)!;
    final stores = _watcher.context;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.inventoryStoreSellPick,
      selected: _countStoreId,
      options: [
        for (final store in stores.active) LotOption(store.id, store.name),
      ],
    );
    if (picked == null || !mounted) return;
    setState(() {
      _pickedStore = picked;
      _failure = null;
      _refreshView();
    });
  }

  Future<void> _sold() async {
    if (_busy || _basket.isEmpty || _badPrices.isNotEmpty) return;
    // A staff member of a business with several stores cannot sell until the
    // owner gives them a store; the stores are known before anything is sent.
    if (!_sell.canSell || !_watcher.storesLoaded) return;
    if (_basket.problems.isNotEmpty) {
      AppHaptics.refuse();
      setState(() {});
      return;
    }
    setState(() {
      _busy = true;
      _failure = null;
    });
    final basket = _basket;
    // Only someone who picks a store sends one; staff with a home store leave
    // it to the server, and a single-store business sends none at all.
    final storeId = inventoryRequestStoreId(_sell, _pickedStore);
    final storeName = _watcher.context.storeName(
        _sell.mode == InventorySellStoreMode.home ? _sell.defaultStoreId : storeId);
    try {
      final result = await widget.service.recordSale(
        businessId: widget.businessId,
        clientRequestId: _attempt.idFor(basket, _payment, storeId: storeId),
        paymentMethod: _payment,
        basket: basket,
        storeId: storeId,
      );
      if (!mounted) return;
      AppHaptics.commit();
      _attempt.clear();
      setState(() {
        _result = result;
        _soldStoreName = storeName;
        _soldLines = basket.lines;
        _basket = const Basket();
        _badPrices.clear();
        _note = null;
      });
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      // The basket and the attempt id stay: Sold again is a safe retry.
      setState(() => _failure = inventoryFailureFromError(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _newSale() => setState(() {
        _scanning = true;
        _result = null;
        _soldLines = const [];
        _note = null;
        _failure = null;
      });

  // ----- building ------------------------------------------------------------

  Future<bool?> _confirmDiscardBasket() {
    final l10n = AppLocalizations.of(context)!;
    return showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.inventorySellDiscardTitle),
        content: Text(l10n.inventorySellDiscardBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.inventorySellDiscardKeep),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.inventorySellDiscardLeave),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final query = _find.text.trim();
    final typedCode = inventoryCodeFromScan(query);
    final hits =
        typedCode == null ? inventorySellSearch(_items, query) : const <InventoryItem>[];
    final showBar = _result == null && _basket.isNotEmpty;
    final sell = _sell;

    return PopScope(
      // Leaving with items in the basket asks first; a finished sale or an
      // empty basket leaves straight away.
      canPop: _basket.isEmpty || _result != null,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        final navigator = Navigator.of(context);
        final leave = await _confirmDiscardBasket();
        if (leave == true) navigator.pop();
      },
      child: Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(
            title: l10n.inventorySellTitle,
            subtitle: _basket.isEmpty
                ? null
                : l10n.inventoryPieces(_basket.itemCount),
          ),
          Expanded(
            child: ListView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.xl),
              children: [
                ..._storeBlock(l10n, sell),
                if (_camera != null) ...[
                  _cameraBox(l10n),
                  const SizedBox(height: AppSpacing.md),
                ],
                TextField(
                  key: const Key('inv-find'),
                  controller: _find,
                  autocorrect: false,
                  textInputAction: TextInputAction.search,
                  onChanged: (_) => setState(() {}),
                  onSubmitted: (_) {
                    if (typedCode != null) {
                      _addCode(typedCode);
                      setState(_find.clear);
                    } else if (hits.isNotEmpty) {
                      _addItem(hits.first);
                      setState(_find.clear);
                    }
                  },
                  decoration: InputDecoration(
                    labelText: l10n.inventoryFindHint,
                    prefixIcon: const Icon(Icons.search,
                        size: 20, color: AppColors.muted),
                    suffixIcon: _find.text.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close, size: 18),
                            tooltip: l10n.cancel,
                            onPressed: () => setState(_find.clear),
                          ),
                  ),
                ),
                if (typedCode != null) ...[
                  const SizedBox(height: AppSpacing.sm),
                  _PrimaryButton(
                    key: const Key('inv-add-code'),
                    icon: Icons.add,
                    label: l10n.inventoryAddCode(typedCode),
                    onTap: () {
                      _addCode(typedCode);
                      setState(_find.clear);
                    },
                  ),
                ],
                for (final hit in hits)
                  _HitRow(
                    key: ValueKey('inv-hit-${hit.id}'),
                    item: hit,
                    onTap: () {
                      _addItem(hit);
                      setState(_find.clear);
                    },
                  ),
                if (_note != null) ...[
                  const SizedBox(height: AppSpacing.sm),
                  _scanNote(_note!),
                ] else if (_foreignQr) ...[
                  const SizedBox(height: AppSpacing.sm),
                  InventoryNote(
                    key: const Key('inv-foreign-qr'),
                    text: l10n.inventoryNotATag,
                  ),
                ],
                const SizedBox(height: AppSpacing.md),
                if (_result != null)
                  _saleDone(l10n, _result!)
                else if (_basket.isEmpty)
                  LotEmptyState(
                    key: const Key('inv-basket-empty'),
                    icon: Icons.qr_code_scanner,
                    title: l10n.inventoryBasketEmpty,
                    hint: l10n.inventoryBasketEmptyHint,
                  )
                else
                  for (final line in _basket.lines.reversed)
                    _BasketLineTile(
                      key: ValueKey('inv-line-${line.item.id}'),
                      line: line,
                      onQuantity: (q) => _setQuantity(line.item.id, q),
                      onPrice: (c) => _setPrice(line.item.id, c),
                      onPriceInvalid: (bad) => _priceInvalid(line.item.id, bad),
                      onRemove: () => _remove(line.item.id),
                    ),
              ],
            ),
          ),
          if (showBar) _bottomBar(l10n),
        ],
      ),
    ),
    );
  }

  /// Where the sale goes. Nothing at all in a single-store business; a plain
  /// line for staff who sell from their own store; a picker for the owner and
  /// "works in all stores" staff; and a clear message for staff with no store.
  List<Widget> _storeBlock(AppLocalizations l10n, InventorySellStore sell) {
    final stores = _watcher.context;
    switch (sell.mode) {
      case InventorySellStoreMode.single:
        return const [];
      case InventorySellStoreMode.home:
        return [
          Text(
            l10n.inventoryStoreSellingFrom(stores.storeName(sell.defaultStoreId)),
            key: const Key('inv-sell-store-home'),
            style: const TextStyle(
                fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.ink),
          ),
          const SizedBox(height: AppSpacing.md),
        ];
      case InventorySellStoreMode.pick:
        return [
          LotPickerField(
            key: const Key('inv-sell-store'),
            label: l10n.inventoryStoreSellPick,
            value: stores.storeName(_countStoreId),
            placeholder: l10n.inventoryStoreLabel,
            onTap: _busy ? () {} : _pickStore,
          ),
          const SizedBox(height: AppSpacing.md),
        ];
      case InventorySellStoreMode.missing:
        return [
          InventoryNote(
            key: const Key('inv-home-store-required'),
            text: l10n.inventoryStoreHomeRequired,
          ),
          const SizedBox(height: AppSpacing.md),
        ];
    }
  }

  Widget _cameraBox(AppLocalizations l10n) => _scanning
      ? _liveCamera(l10n)
      : OutlinedButton.icon(
          key: const Key('inv-scan-another'),
          onPressed: _openScanner,
          icon: const Icon(Icons.qr_code_scanner),
          label: Text(l10n.inventoryScanAnother),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(52),
            foregroundColor: AppColors.ink,
          ),
        );

  Widget _liveCamera(AppLocalizations l10n) => ClipRRect(
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        child: SizedBox(
          height: 190,
          child: Stack(
            fit: StackFit.expand,
            children: [
              ScannerCameraView(
                controller: _camera!,
                onDetect: _onDetect,
                unavailableText: l10n.inventoryCameraUnavailable,
                frameMargin: const EdgeInsets.all(34),
              ),
              Positioned(
                left: AppSpacing.md,
                right: AppSpacing.md,
                bottom: AppSpacing.sm,
                child: IgnorePointer(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.md, vertical: 6),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.62),
                      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                    ),
                    child: Text(
                      l10n.inventoryScanHint,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                          color: Colors.white, fontSize: 13, height: 1.3),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      );

  Widget _scanNote(({String text, bool error}) note) => Row(
        key: const Key('inv-scan-note'),
        children: [
          Icon(note.error ? Icons.error_outline : Icons.check_circle_outline,
              size: 16, color: note.error ? AppColors.errorRed : AppColors.sage),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              note.text,
              style: TextStyle(
                fontSize: 13,
                height: 1.35,
                color: note.error ? AppColors.errorRed : AppColors.sage,
              ),
            ),
          ),
        ],
      );

  Widget _saleDone(AppLocalizations l10n, InventorySaleResult result) {
    final names = {for (final l in _soldLines) l.item.id: l.item.name};
    return Container(
      key: const Key('inv-sale-done'),
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.sage.withValues(alpha: 0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.check_circle, color: AppColors.sage),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  l10n.inventorySaleDone,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            l10n.inventorySaleDoneTotal(formatLotCents(result.totalCents)),
            key: const Key('inv-sale-done-total'),
            style: const TextStyle(fontSize: 14, color: AppColors.muted),
          ),
          if (_soldStoreName.isNotEmpty)
            Text(
              l10n.inventoryStoreOf(_soldStoreName),
              key: const Key('inv-sale-done-store'),
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          const SizedBox(height: AppSpacing.md),
          for (final line in _soldLines)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text(
                l10n.inventorySaleLine(
                  line.quantity,
                  line.item.name,
                  formatLotCents(line.soldPriceCents),
                ),
                style: const TextStyle(fontSize: 13, color: AppColors.ink),
              ),
            ),
          for (final id in result.countWasOffItemIds) ...[
            const SizedBox(height: AppSpacing.sm),
            InventoryNote(
              key: ValueKey('inv-warning-$id'),
              error: false,
              text: l10n.inventoryCountWasOffWarn(names[id] ?? id),
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
          LotSheetButton(
            key: const Key('inv-new-sale'),
            label: l10n.inventoryNewSale,
            onTap: _newSale,
          ),
        ],
      ),
    );
  }

  Widget _bottomBar(AppLocalizations l10n) {
    final problems = _basket.problems;
    String? problem;
    if (problems.contains('item_archived')) {
      problem = l10n.inventoryProblemArchived;
    } else if (problems.contains('total_too_large') ||
        problems.contains('price_too_large')) {
      problem = l10n.inventoryProblemTooLarge;
    }
    final failure = _failure;
    final blocked = _badPrices.isNotEmpty ||
        problems.isNotEmpty ||
        !_sell.canSell ||
        !_watcher.storesLoaded;
    return Container(
      decoration: BoxDecoration(
        color: AppColors.paper,
        border: Border(top: BorderSide(color: AppColors.rule.withValues(alpha: 0.9))),
      ),
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.md),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (failure != null) ...[
              InventoryNote(
                key: const Key('inv-sale-error'),
                text: inventoryFailureText(l10n, failure),
                trailing: inventoryFailureIsRetryable(failure)
                    ? TextButton(
                        key: const Key('inv-retry'),
                        onPressed: _busy ? null : _sold,
                        child: Text(l10n.inventoryTryAgain),
                      )
                    : null,
              ),
              const SizedBox(height: AppSpacing.sm),
            ] else if (problem != null) ...[
              InventoryNote(key: const Key('inv-problem'), text: problem),
              const SizedBox(height: AppSpacing.sm),
            ],
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.inventoryTotal,
                        style: const TextStyle(
                            fontSize: 12, color: AppColors.muted),
                      ),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        alignment: Alignment.centerLeft,
                        child: Text(
                          formatLotCents(_basket.totalCents),
                          key: const Key('inv-total'),
                          style: const TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w800,
                            color: AppColors.ink,
                          ),
                        ),
                      ),
                      if (_basket.discountCents > 0)
                        Text(
                          l10n.inventoryDiscountOff(
                              formatLotCents(_basket.discountCents)),
                          key: const Key('inv-discount'),
                          style: const TextStyle(
                              fontSize: 12, color: AppColors.warn),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Flexible(
                  child: PressableScale(
                    key: const Key('inv-payment'),
                    onTap: _busy ? null : _pickPayment,
                    scale: 0.98,
                    child: Container(
                      height: 44,
                      padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.md),
                      decoration: BoxDecoration(
                        color: AppColors.parchment,
                        borderRadius:
                            BorderRadius.circular(AppSpacing.radiusSm),
                        border: Border.all(color: AppColors.rule),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Flexible(
                            child: Text(
                              inventoryPaymentLabel(l10n, _payment),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                                color: AppColors.ink,
                              ),
                            ),
                          ),
                          const Icon(Icons.expand_more,
                              size: 18, color: AppColors.muted),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            LotSheetButton(
              key: const Key('inv-sold'),
              label: l10n.inventorySold,
              busy: _busy,
              busyLabel: l10n.inventorySelling,
              onTap: blocked ? null : _sold,
            ),
          ],
        ),
      ),
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  const _PrimaryButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: onTap,
      child: Container(
        height: 44,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.cobalt,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 18, color: Colors.white),
            const SizedBox(width: AppSpacing.sm),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A product found by name: tap to add it to the basket.
class _HitRow extends StatelessWidget {
  const _HitRow({super.key, required this.item, required this.onTap});

  final InventoryItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: onTap,
      scale: 0.985,
      child: Container(
        margin: const EdgeInsets.only(top: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.paper,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(color: AppColors.rule),
        ),
        child: Row(
          children: [
            InventoryPhoto(url: item.photoUrl, size: 36),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  Text(
                    '${item.code} · ${formatLotCents(item.priceCents)}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: AppColors.muted),
                  ),
                ],
              ),
            ),
            const Icon(Icons.add_circle_outline,
                size: 22, color: AppColors.cobaltDeep),
          ],
        ),
      ),
    );
  }
}

/// One line of the basket. Owns its two text fields (so typing is never
/// fought by a rebuild) and reports a valid quantity or price upward; an
/// unreadable price is reported as invalid so Sold waits.
class _BasketLineTile extends StatefulWidget {
  const _BasketLineTile({
    super.key,
    required this.line,
    required this.onQuantity,
    required this.onPrice,
    required this.onPriceInvalid,
    required this.onRemove,
  });

  final BasketLine line;
  final ValueChanged<int> onQuantity;
  final ValueChanged<int> onPrice;
  final ValueChanged<bool> onPriceInvalid;
  final VoidCallback onRemove;

  @override
  State<_BasketLineTile> createState() => _BasketLineTileState();
}

class _BasketLineTileState extends State<_BasketLineTile> {
  late final _qty = TextEditingController(text: '${widget.line.quantity}');
  late final _price = TextEditingController(
      text: invoiceCentsToInput(widget.line.soldPriceCents));
  final _qtyFocus = FocusNode();
  late int _knownPriceCents = widget.line.soldPriceCents;
  bool _priceBad = false;

  @override
  void initState() {
    super.initState();
    _qtyFocus.addListener(() {
      // Leaving the field with nothing usable puts the real count back.
      if (!_qtyFocus.hasFocus) _qty.text = '${widget.line.quantity}';
    });
  }

  @override
  void didUpdateWidget(_BasketLineTile old) {
    super.didUpdateWidget(old);
    final typedQty = readWholeNumber(_qty.text);
    if (typedQty != widget.line.quantity && !(_qtyFocus.hasFocus && typedQty == null)) {
      _qty.text = '${widget.line.quantity}';
    }
    // A price changed from outside (a refreshed list price) shows; one the
    // person is typing is left alone.
    if (widget.line.soldPriceCents != _knownPriceCents) {
      _knownPriceCents = widget.line.soldPriceCents;
      _price.text = invoiceCentsToInput(_knownPriceCents);
      _priceBad = false;
    }
  }

  @override
  void dispose() {
    _qty.dispose();
    _price.dispose();
    _qtyFocus.dispose();
    super.dispose();
  }

  void _typedQuantity(String text) {
    final q = readWholeNumber(text);
    if (q != null && q >= 1) widget.onQuantity(q);
  }

  void _typedPrice(String text) {
    final cents = readSoldPrice(text);
    if (cents == null) {
      setState(() => _priceBad = true);
      widget.onPriceInvalid(true);
      return;
    }
    _knownPriceCents = cents;
    setState(() => _priceBad = false);
    widget.onPriceInvalid(false);
    widget.onPrice(cents);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final line = widget.line;
    final id = line.item.id;
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
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
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      line.item.name,
                      key: Key('inv-line-name-$id'),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                    Text(
                      '${line.item.code} · ${l10n.inventoryListPrice(formatLotCents(line.listPriceCents))}',
                      key: Key('inv-line-list-$id'),
                      style: const TextStyle(fontSize: 12, color: AppColors.muted),
                    ),
                  ],
                ),
              ),
              IconButton(
                key: Key('inv-remove-$id'),
                tooltip: l10n.inventoryRemoveLine,
                onPressed: widget.onRemove,
                icon: const Icon(Icons.close, size: 20),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.md,
            runSpacing: AppSpacing.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    key: Key('inv-qty-down-$id'),
                    tooltip: l10n.inventoryQuantityDown,
                    visualDensity: VisualDensity.compact,
                    onPressed: line.quantity <= 1
                        ? null
                        : () => widget.onQuantity(line.quantity - 1),
                    icon: const Icon(Icons.remove_circle_outline),
                  ),
                  SizedBox(
                    width: 54,
                    child: TextField(
                      key: Key('inv-qty-$id'),
                      controller: _qty,
                      focusNode: _qtyFocus,
                      textAlign: TextAlign.center,
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                      onChanged: _typedQuantity,
                      decoration: InputDecoration(
                        isDense: true,
                        labelText: l10n.inventoryQty,
                      ),
                    ),
                  ),
                  IconButton(
                    key: Key('inv-qty-up-$id'),
                    tooltip: l10n.inventoryQuantityUp,
                    visualDensity: VisualDensity.compact,
                    onPressed: () => widget.onQuantity(line.quantity + 1),
                    icon: const Icon(Icons.add_circle_outline),
                  ),
                ],
              ),
              SizedBox(
                width: 130,
                child: TextField(
                  key: Key('inv-price-$id'),
                  controller: _price,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  onChanged: _typedPrice,
                  decoration: InputDecoration(
                    isDense: true,
                    labelText: l10n.inventoryLinePrice,
                    prefixText: r'$ ',
                    errorText: _priceBad ? l10n.inventoryPriceInvalid : null,
                    errorMaxLines: 2,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.inventoryLineTotal,
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ),
              Text(
                formatLotCents(line.totalCents),
                key: Key('inv-line-total-$id'),
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.ink,
                ),
              ),
            ],
          ),
          if (line.exceedsCount)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.sm),
              child: InventoryNote(
                key: Key('inv-exceeds-$id'),
                error: false,
                text: l10n.inventoryExceedsCount(line.item.quantity),
              ),
            ),
        ],
      ),
    );
  }
}
