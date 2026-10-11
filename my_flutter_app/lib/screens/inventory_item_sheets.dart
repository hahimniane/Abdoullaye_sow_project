import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory.dart';
import '../services/inventory_service.dart';
import '../services/inventory_stores.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import 'inventory_categories_screen.dart';

/// The product form: create a product, or edit one. Money and counts are read
/// by the same readers the server's limits mirror, so a bad entry is refused
/// at the field before the round trip. The count is asked for only when
/// creating; afterwards it changes through stock adjustments, never by editing.
///
/// The category is picked from the business's [categories] (or added on the
/// spot). In a business with several stores, someone who works in every store
/// types a starting count for each store; everyone else types one count.
///
/// Answers true when something was saved.
Future<bool?> showInventoryItemForm(
  BuildContext context, {
  required String businessId,
  InventoryItem? existing,
  InventoryService service = const InventoryService(),
  List<InventoryCategory> categories = const [],
  InventoryStoreContext? stores,
}) =>
    showLotSheet<bool>(
      context,
      InventoryItemFormSheet(
        businessId: businessId,
        existing: existing,
        service: service,
        categories: categories,
        stores: stores ?? InventoryStoreContext.single,
      ),
    );

class InventoryItemFormSheet extends StatefulWidget {
  const InventoryItemFormSheet({
    super.key,
    required this.businessId,
    this.existing,
    this.service = const InventoryService(),
    this.categories = const [],
    this.stores,
  });

  final String businessId;
  final InventoryItem? existing;
  final InventoryService service;
  final List<InventoryCategory> categories;
  final InventoryStoreContext? stores;

  @override
  State<InventoryItemFormSheet> createState() => _InventoryItemFormSheetState();
}

class _InventoryItemFormSheetState extends State<InventoryItemFormSheet> {
  late final InventoryItemDraft _start = widget.existing == null
      ? const InventoryItemDraft()
      : InventoryItemDraft.fromItem(widget.existing!);
  late final _name = TextEditingController(text: _start.name);
  late final _price = TextEditingController(text: _start.price);
  late final _cost = TextEditingController(text: _start.cost);
  late final _quantity = TextEditingController(text: _start.quantity);
  late final _lowStock = TextEditingController(text: _start.lowStockAt);
  late final _photo = TextEditingController(text: _start.photoUrl);

  late final InventoryStoreContext _stores =
      widget.stores ?? InventoryStoreContext.single;

  /// A starting count per store, for someone who works in every store of a
  /// multi-store business. Empty: one count, as in a single-store business.
  late final Map<String, TextEditingController> _stock = {
    if (_creating && _stores.viewerSeesAll)
      for (final store in _stores.active) store.id: TextEditingController(),
  };

  /// The categories on offer: the business's, plus any added in this sheet.
  late final List<InventoryCategory> _categories = [...widget.categories];
  late String _categoryId = widget.existing?.categoryId ?? '';
  late String _categoryName = inventoryCategoryById(
          widget.categories, widget.existing?.categoryId ?? '')
      ?.name ??
      widget.existing?.category ??
      '';

  bool _busy = false;
  bool _submitted = false;
  String _serverNote = '';

  bool get _creating => widget.existing == null;

  @override
  void dispose() {
    for (final c in [_name, _price, _cost, _quantity, _lowStock, _photo]) {
      c.dispose();
    }
    for (final c in _stock.values) {
      c.dispose();
    }
    super.dispose();
  }

  InventoryItemDraft get _draft => InventoryItemDraft(
        name: _name.text,
        price: _price.text,
        cost: _cost.text,
        quantity: _quantity.text,
        lowStockAt: _lowStock.text,
        category: _categoryName,
        categoryId: _categoryId,
        photoUrl: _photo.text,
        stock: {
          for (final entry in _stock.entries) entry.key: entry.value.text,
        },
      );

  static const _addCategory = '__add__';

  Future<void> _pickCategory() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.inventoryCategoryPickTitle,
      // A product typed before categories existed has a name but no id: no
      // option is its own.
      selected: _categoryId.isEmpty && _categoryName.isNotEmpty ? null : _categoryId,
      options: [
        LotOption('', l10n.inventoryCategoryNone),
        for (final category in inventoryActiveCategories(_categories))
          LotOption(category.id, category.name),
        LotOption(_addCategory, l10n.inventoryCategoryAddNew),
      ],
    );
    if (picked == null || !mounted) return;
    if (picked == _addCategory) {
      final made = await showInventoryCategorySheet(
        context,
        businessId: widget.businessId,
        service: widget.service,
      );
      if (made == null || !mounted) return;
      setState(() {
        if (made.id.isNotEmpty) {
          _categories.add(InventoryCategory(id: made.id, name: made.name));
        }
        _categoryId = made.id;
        _categoryName = made.name;
      });
      return;
    }
    setState(() {
      _categoryId = picked;
      _categoryName =
          inventoryCategoryById(_categories, picked)?.name ?? '';
    });
  }

  List<String> get _errors => _submitted
      ? validateInventoryItemDraft(_draft, creating: _creating)
      : const [];

  String? _errorFor(AppLocalizations l10n, List<String> codes, List<String> own) {
    for (final code in own) {
      if (codes.contains(code)) return inventoryFieldErrorText(l10n, code);
    }
    return null;
  }

  Future<void> _save() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    final draft = _draft;
    final problems = validateInventoryItemDraft(draft, creating: _creating);
    if (problems.isNotEmpty) {
      AppHaptics.refuse();
      setState(() {
        _submitted = true;
        _serverNote = '';
      });
      return;
    }
    setState(() {
      _busy = true;
      _serverNote = '';
    });
    try {
      final existing = widget.existing;
      if (existing == null) {
        await widget.service.createItem(widget.businessId, draft);
      } else {
        await widget.service.updateItem(widget.businessId, existing, draft);
      }
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _serverNote =
          inventoryFailureText(l10n, inventoryFailureFromError(error)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final errors = _errors;
    void changed(String _) {
      if (_submitted) setState(() {});
    }

    return LotSheetShell(
      title: _creating ? l10n.inventoryNewProduct : l10n.inventoryEditProduct,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            InventoryNote(key: const Key('inv-form-error'), text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('inv-form-save'),
            label: l10n.inventorySaveProduct,
            busy: _busy,
            busyLabel: l10n.inventorySaving,
            onTap: _save,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('inv-field-name'),
            controller: _name,
            enabled: !_busy,
            textCapitalization: TextCapitalization.sentences,
            onChanged: changed,
            decoration: InputDecoration(
              labelText: l10n.inventoryFieldName,
              errorText: _errorFor(l10n, errors, ['name_required', 'name_too_long']),
              errorMaxLines: 3,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('inv-field-price'),
            controller: _price,
            enabled: !_busy,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: changed,
            decoration: InputDecoration(
              labelText: l10n.inventoryFieldPrice,
              prefixText: r'$ ',
              errorText: _errorFor(l10n, errors, ['price_invalid']),
              errorMaxLines: 3,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('inv-field-cost'),
            controller: _cost,
            enabled: !_busy,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: changed,
            decoration: InputDecoration(
              labelText: l10n.inventoryFieldCost,
              prefixText: r'$ ',
              errorText: _errorFor(l10n, errors, ['cost_invalid']),
              errorMaxLines: 3,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          if (_creating && _stock.isNotEmpty)
            for (final store in _stores.active) ...[
              TextField(
                key: Key('inv-field-quantity-${store.id}'),
                controller: _stock[store.id],
                enabled: !_busy,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                onChanged: changed,
                decoration: InputDecoration(
                  labelText: l10n.inventoryFieldQuantityAt(store.name),
                  errorText: _errorFor(l10n, errors, ['quantity_invalid']),
                  errorMaxLines: 3,
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
            ]
          else if (_creating)
            TextField(
              key: const Key('inv-field-quantity'),
              controller: _quantity,
              enabled: !_busy,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              onChanged: changed,
              decoration: InputDecoration(
                labelText: _stores.ownStoreId.isEmpty
                    ? l10n.inventoryFieldQuantity
                    : l10n.inventoryFieldQuantityAt(
                        _stores.storeName(_stores.ownStoreId)),
                errorText: _errorFor(l10n, errors, ['quantity_invalid']),
                errorMaxLines: 3,
              ),
            )
          else
            Text(
              l10n.inventoryQuantityHelpEdit,
              key: const Key('inv-quantity-help'),
              style: const TextStyle(fontSize: 12.5, height: 1.4, color: AppColors.muted),
            ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('inv-field-low'),
            controller: _lowStock,
            enabled: !_busy,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            onChanged: changed,
            decoration: InputDecoration(
              labelText: l10n.inventoryFieldLowStock,
              helperText: l10n.inventoryLowStockHelp,
              helperMaxLines: 3,
              errorText: _errorFor(l10n, errors, ['low_stock_invalid']),
              errorMaxLines: 3,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            key: const Key('inv-field-category'),
            label: l10n.inventoryFieldCategory,
            value: _categoryName,
            placeholder: l10n.inventoryCategoryNone,
            onTap: _busy ? () {} : _pickCategory,
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('inv-field-photo'),
            controller: _photo,
            enabled: !_busy,
            keyboardType: TextInputType.url,
            autocorrect: false,
            onChanged: changed,
            decoration: InputDecoration(
              labelText: l10n.inventoryFieldPhoto,
              errorText: _errorFor(l10n, errors, ['photo_invalid']),
              errorMaxLines: 3,
            ),
          ),
        ],
      ),
    );
  }
}

/// Add stock to a product, or set its count (a correction after counting the
/// shelf, which clears "count was off"). In a business with several stores,
/// someone who works in every store picks the store ([initialStoreId] to start
/// on); everyone else counts in their own store. Answers true when saved.
Future<bool?> showInventoryStockSheet(
  BuildContext context, {
  required String businessId,
  required InventoryItem item,
  required bool add,
  InventoryService service = const InventoryService(),
  InventoryStoreContext? stores,
  InventoryStockIndex? stock,
  String initialStoreId = '',
}) =>
    showLotSheet<bool>(
      context,
      InventoryStockSheet(
        businessId: businessId,
        item: item,
        add: add,
        service: service,
        stores: stores ?? InventoryStoreContext.single,
        stock: stock ?? InventoryStockIndex.empty,
        initialStoreId: initialStoreId,
      ),
    );

class InventoryStockSheet extends StatefulWidget {
  const InventoryStockSheet({
    super.key,
    required this.businessId,
    required this.item,
    required this.add,
    this.service = const InventoryService(),
    this.stores,
    this.stock,
    this.initialStoreId = '',
  });

  final String businessId;
  final InventoryItem item;
  final bool add;
  final InventoryService service;
  final InventoryStoreContext? stores;
  final InventoryStockIndex? stock;
  final String initialStoreId;

  @override
  State<InventoryStockSheet> createState() => _InventoryStockSheetState();
}

class _InventoryStockSheetState extends State<InventoryStockSheet> {
  late final InventoryStoreContext _stores =
      widget.stores ?? InventoryStoreContext.single;
  late final InventoryStockIndex _index =
      widget.stock ?? InventoryStockIndex.empty;

  /// Someone who works in every store picks the store; the sale of a count in
  /// any other case goes to their own store (the server routes it).
  bool get _picks => _stores.viewerSeesAll;

  late String _storeId = !_picks
      ? ''
      : (_stores.active.any((s) => s.id == widget.initialStoreId)
          ? widget.initialStoreId
          : _stores.defaultStoreId);

  /// The count of this product in the store being counted.
  int _countIn(String storeId) {
    if (_picks) return _index.at(widget.item.id, storeId);
    if (_stores.ownStoreId.isNotEmpty) {
      return _index.at(widget.item.id, _stores.ownStoreId);
    }
    return widget.item.quantity;
  }

  late final _quantity =
      TextEditingController(text: widget.add ? '' : '${_countIn(_storeId)}');
  bool _quantityTouched = false;
  final _note = TextEditingController();
  bool _busy = false;
  bool _invalid = false;
  String _serverNote = '';

  Future<void> _pickStore() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.inventoryStoreLabel,
      selected: _storeId,
      options: [
        for (final store in _stores.active)
          LotOption(store.id, store.name,
              detail: l10n.inventoryInStockCount(_countIn(store.id))),
      ],
    );
    if (picked == null || !mounted) return;
    setState(() {
      _storeId = picked;
      // Setting the count starts from what the chosen store holds, until
      // the person has typed their own number.
      if (!widget.add && !_quantityTouched) {
        _quantity.text = '${_countIn(picked)}';
      }
    });
  }

  @override
  void dispose() {
    _quantity.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    if (validateStockAdjustment(_quantity.text, adding: widget.add).isNotEmpty) {
      AppHaptics.refuse();
      setState(() => _invalid = true);
      return;
    }
    setState(() {
      _busy = true;
      _invalid = false;
      _serverNote = '';
    });
    try {
      await widget.service.adjustStock(
        businessId: widget.businessId,
        itemId: widget.item.id,
        add: widget.add,
        quantity: readWholeNumber(_quantity.text) ?? 0,
        note: _note.text,
        storeId: _storeId,
      );
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _serverNote =
          inventoryFailureText(l10n, inventoryFailureFromError(error)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return LotSheetShell(
      title: widget.add ? l10n.inventoryAddStock : l10n.inventorySetCount,
      subtitle: widget.item.name,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            InventoryNote(key: const Key('inv-stock-error'), text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('inv-stock-save'),
            label: widget.add ? l10n.inventoryAddStock : l10n.inventorySetCount,
            busy: _busy,
            busyLabel: l10n.inventorySaving,
            onTap: _save,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            widget.add ? l10n.inventoryAddStockHelp : l10n.inventorySetCountHelp,
            style: const TextStyle(fontSize: 13, height: 1.4, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          if (_picks) ...[
            LotPickerField(
              key: const Key('inv-stock-store'),
              label: l10n.inventoryStoreLabel,
              value: _stores.storeName(_storeId),
              placeholder: l10n.inventoryStoreLabel,
              onTap: _busy ? () {} : _pickStore,
            ),
            const SizedBox(height: AppSpacing.md),
          ] else if (_stores.ownStoreId.isNotEmpty) ...[
            Text(
              l10n.inventoryStockForStore(_stores.storeName(_stores.ownStoreId)),
              key: const Key('inv-stock-own-store'),
              style: const TextStyle(
                  fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.ink),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
          TextField(
            key: const Key('inv-stock-quantity'),
            controller: _quantity,
            enabled: !_busy,
            autofocus: true,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            onChanged: (_) {
              _quantityTouched = true;
              if (_invalid) setState(() => _invalid = false);
            },
            decoration: InputDecoration(
              labelText: l10n.inventoryQty,
              errorText: _invalid
                  ? (widget.add
                      ? l10n.inventoryErrQuantityAdd
                      : l10n.inventoryErrQuantity)
                  : null,
              errorMaxLines: 3,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('inv-stock-note'),
            controller: _note,
            enabled: !_busy,
            textCapitalization: TextCapitalization.sentences,
            maxLength: inventoryMaxNote,
            decoration: InputDecoration(
              labelText: l10n.inventoryNoteOptional,
              counterText: '',
            ),
          ),
        ],
      ),
    );
  }
}

/// Move stock between two stores (owner and "works in all stores" staff).
/// Totals do not change. Answers true when moved.
Future<bool?> showInventoryTransferSheet(
  BuildContext context, {
  required String businessId,
  required InventoryItem item,
  required InventoryStoreContext stores,
  InventoryStockIndex? stock,
  InventoryService service = const InventoryService(),
  String initialFromStoreId = '',
}) =>
    showLotSheet<bool>(
      context,
      InventoryTransferSheet(
        businessId: businessId,
        item: item,
        stores: stores,
        stock: stock ?? InventoryStockIndex.empty,
        service: service,
        initialFromStoreId: initialFromStoreId,
      ),
    );

class InventoryTransferSheet extends StatefulWidget {
  const InventoryTransferSheet({
    super.key,
    required this.businessId,
    required this.item,
    required this.stores,
    required this.stock,
    this.service = const InventoryService(),
    this.initialFromStoreId = '',
  });

  final String businessId;
  final InventoryItem item;
  final InventoryStoreContext stores;
  final InventoryStockIndex stock;
  final InventoryService service;
  final String initialFromStoreId;

  @override
  State<InventoryTransferSheet> createState() => _InventoryTransferSheetState();
}

class _InventoryTransferSheetState extends State<InventoryTransferSheet> {
  late String _from = _startFrom();
  late String _to = _startTo();
  final _quantity = TextEditingController();
  final _note = TextEditingController();
  bool _busy = false;
  bool _submitted = false;
  String _serverNote = '';

  /// The store that holds the most (or the one asked for), so the usual move -
  /// from where it is to where it is needed - starts filled in.
  String _startFrom() {
    final active = widget.stores.active;
    if (active.any((s) => s.id == widget.initialFromStoreId)) {
      return widget.initialFromStoreId;
    }
    var best = active.isEmpty ? '' : active.first.id;
    for (final store in active) {
      if (widget.stock.at(widget.item.id, store.id) >
          widget.stock.at(widget.item.id, best)) {
        best = store.id;
      }
    }
    return best;
  }

  String _startTo() {
    for (final store in widget.stores.active) {
      if (store.id != _from) return store.id;
    }
    return '';
  }

  @override
  void dispose() {
    _quantity.dispose();
    _note.dispose();
    super.dispose();
  }

  InventoryTransferDraft get _draft => InventoryTransferDraft(
        fromStoreId: _from,
        toStoreId: _to,
        quantity: _quantity.text,
        note: _note.text,
      );

  Future<void> _pick({required bool from}) async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: from ? l10n.inventoryTransferFrom : l10n.inventoryTransferTo,
      selected: from ? _from : _to,
      options: [
        for (final store in widget.stores.active)
          LotOption(store.id, store.name,
              detail: l10n.inventoryInStockCount(
                  widget.stock.at(widget.item.id, store.id))),
      ],
    );
    if (picked == null || !mounted) return;
    setState(() => from ? _from = picked : _to = picked);
  }

  Future<void> _save() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    if (validateInventoryTransfer(_draft).isNotEmpty) {
      AppHaptics.refuse();
      setState(() => _submitted = true);
      return;
    }
    setState(() {
      _busy = true;
      _serverNote = '';
    });
    try {
      await widget.service.transfer(widget.businessId, widget.item.id, _draft);
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _serverNote =
          inventoryFailureText(l10n, inventoryFailureFromError(error)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final problems =
        _submitted ? validateInventoryTransfer(_draft) : const <String>[];
    final sideError = problems.contains('same_store')
        ? inventoryFieldErrorText(l10n, 'same_store')
        : (problems.contains('store_required')
            ? inventoryFieldErrorText(l10n, 'store_required')
            : null);
    return LotSheetShell(
      title: l10n.inventoryTransfer,
      subtitle: widget.item.name,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            InventoryNote(key: const Key('inv-transfer-error'), text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('inv-transfer-save'),
            label: l10n.inventoryTransferGo,
            busy: _busy,
            busyLabel: l10n.inventorySaving,
            onTap: _save,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.inventoryTransferHelp,
            style: const TextStyle(fontSize: 13, height: 1.4, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            key: const Key('inv-transfer-from'),
            label: l10n.inventoryTransferFrom,
            value: widget.stores.storeName(_from),
            placeholder: l10n.inventoryStoreLabel,
            onTap: _busy ? () {} : () => _pick(from: true),
          ),
          const SizedBox(height: AppSpacing.sm),
          LotPickerField(
            key: const Key('inv-transfer-to'),
            label: l10n.inventoryTransferTo,
            value: widget.stores.storeName(_to),
            placeholder: l10n.inventoryStoreLabel,
            onTap: _busy ? () {} : () => _pick(from: false),
            error: sideError,
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('inv-transfer-quantity'),
            controller: _quantity,
            enabled: !_busy,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            onChanged: (_) {
              if (_submitted) setState(() {});
            },
            decoration: InputDecoration(
              labelText: l10n.inventoryQty,
              errorText: problems.contains('quantity_invalid')
                  ? l10n.inventoryErrQuantityAdd
                  : null,
              errorMaxLines: 3,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('inv-transfer-note'),
            controller: _note,
            enabled: !_busy,
            textCapitalization: TextCapitalization.sentences,
            maxLength: inventoryMaxNote,
            decoration: InputDecoration(
              labelText: l10n.inventoryNoteOptional,
              counterText: '',
            ),
          ),
        ],
      ),
    );
  }
}

/// Print tags for a product: N copies of the same code, opened as a page in
/// the browser where the print dialog takes over.
Future<bool?> showInventoryTagSheet(
  BuildContext context, {
  required String businessId,
  required InventoryItem item,
  InventoryTagOpener opener = openInventoryTags,
}) =>
    showLotSheet<bool>(
      context,
      InventoryTagSheet(businessId: businessId, item: item, opener: opener),
    );

class InventoryTagSheet extends StatefulWidget {
  const InventoryTagSheet({
    super.key,
    required this.businessId,
    required this.item,
    this.opener = openInventoryTags,
  });

  final String businessId;
  final InventoryItem item;
  final InventoryTagOpener opener;

  @override
  State<InventoryTagSheet> createState() => _InventoryTagSheetState();
}

class _InventoryTagSheetState extends State<InventoryTagSheet> {
  final _copies = TextEditingController(text: '1');
  bool _busy = false;
  bool _invalid = false;
  bool _failed = false;

  @override
  void dispose() {
    _copies.dispose();
    super.dispose();
  }

  Future<void> _open() async {
    if (_busy) return;
    final copies = readTagCopies(_copies.text);
    if (copies == null) {
      AppHaptics.refuse();
      setState(() => _invalid = true);
      return;
    }
    setState(() {
      _busy = true;
      _invalid = false;
      _failed = false;
    });
    try {
      await widget.opener(
        businessId: widget.businessId,
        itemId: widget.item.id,
        copies: copies,
      );
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return LotSheetShell(
      title: l10n.inventoryPrintTags,
      subtitle: '${widget.item.name} · ${widget.item.code}',
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_failed) ...[
            InventoryNote(
              key: const Key('inv-tags-error'),
              text: l10n.inventoryTagsCouldNotOpen,
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('inv-tags-open'),
            label: l10n.inventoryTagsOpen,
            busy: _busy,
            busyLabel: l10n.inventoryTagsOpening,
            onTap: _open,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.inventoryTagNote,
            style: const TextStyle(fontSize: 13, height: 1.4, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('inv-tags-copies'),
            controller: _copies,
            enabled: !_busy,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            onChanged: (_) {
              if (_invalid) setState(() => _invalid = false);
            },
            decoration: InputDecoration(
              labelText: l10n.inventoryTagCopies,
              helperText: l10n.inventoryTagCopiesHelp,
              helperMaxLines: 3,
              errorText: _invalid ? l10n.inventoryTagCopiesError : null,
              errorMaxLines: 3,
            ),
          ),
        ],
      ),
    );
  }
}
