import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory.dart';
import '../services/inventory_service.dart';
import '../services/inventory_stores.dart';
import '../services/label_printer.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import 'inventory_brands_screen.dart';
import 'inventory_categories_screen.dart';
import 'print_tags_sheet.dart';

/// The product form: create a product, or edit one. Money and counts are read
/// by the same readers the server's limits mirror, so a bad entry is refused
/// at the field before the round trip. The count is asked for only when
/// creating; afterwards it changes through stock adjustments, never by editing.
///
/// The category and the brand are picked from the business's [categories] and
/// [brands] (or added on the spot). A new product also offers "Save and add
/// another like it": it saves, then the form starts again empty with only the
/// brand and the category kept. In a business with several stores, someone who works in every store
/// types a starting count for each store; everyone else types one count.
///
/// Answers true when something was saved (also when the form was closed after
/// one or more "save and add another"). [onCreated] hears of each new
/// product (its id, code and display name), so the caller can offer to
/// print its tag.
Future<bool?> showInventoryItemForm(
  BuildContext context, {
  required String businessId,
  InventoryItem? existing,
  InventoryService service = const InventoryService(),
  List<InventoryCategory> categories = const [],
  List<InventoryBrand> brands = const [],
  InventoryStoreContext? stores,
  ValueChanged<InventoryCreatedItem>? onCreated,
}) async {
  var savedAny = false;
  final closed = await showLotSheet<bool>(
    context,
    InventoryItemFormSheet(
      businessId: businessId,
      existing: existing,
      service: service,
      categories: categories,
      brands: brands,
      stores: stores ?? InventoryStoreContext.single,
      onSaved: () => savedAny = true,
      onCreated: onCreated,
    ),
  );
  return savedAny || closed == true ? true : closed;
}

/// A product just created: enough to print its tag.
typedef InventoryCreatedItem = ({String itemId, String code, String title});

class InventoryItemFormSheet extends StatefulWidget {
  const InventoryItemFormSheet({
    super.key,
    required this.businessId,
    this.existing,
    this.service = const InventoryService(),
    this.categories = const [],
    this.brands = const [],
    this.stores,
    this.onSaved,
    this.onCreated,
  });

  final String businessId;
  final InventoryItem? existing;
  final InventoryService service;
  final List<InventoryCategory> categories;
  final List<InventoryBrand> brands;
  final InventoryStoreContext? stores;

  /// Called after every successful save, including each "save and add
  /// another" (the sheet stays open then).
  final VoidCallback? onSaved;

  /// Called after each new product is created.
  final ValueChanged<InventoryCreatedItem>? onCreated;

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
  late String _categoryName =
      inventoryCategoryById(
        widget.categories,
        widget.existing?.categoryId ?? '',
      )?.name ??
      widget.existing?.category ??
      '';

  /// The brands on offer: the business's, plus any added in this sheet.
  late final List<InventoryBrand> _brands = [...widget.brands];
  late String _brandId = widget.existing?.brandId ?? '';
  late String _brandName =
      inventoryBrandById(widget.brands, widget.existing?.brandId ?? '')?.name ??
      widget.existing?.brand ??
      '';

  final _nameFocus = FocusNode();

  bool _busy = false;
  bool _submitted = false;
  String _serverNote = '';

  /// What the last "save and add another" saved, shown until the next save.
  String _justAdded = '';

  bool get _creating => widget.existing == null;

  @override
  void dispose() {
    for (final c in [_name, _price, _cost, _quantity, _lowStock, _photo]) {
      c.dispose();
    }
    for (final c in _stock.values) {
      c.dispose();
    }
    _nameFocus.dispose();
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
    brand: _brandName,
    brandId: _brandId,
    photoUrl: _photo.text,
    stock: {for (final entry in _stock.entries) entry.key: entry.value.text},
  );

  static const _addCategory = '__add__';
  static const _addBrand = '__add_brand__';

  Future<void> _pickBrand() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.inventoryBrandPickTitle,
      // A brand kept as plain text (a server with no brand list) has a name
      // but no id: no option is its own.
      selected: _brandId.isEmpty && _brandName.isNotEmpty ? null : _brandId,
      options: [
        LotOption('', l10n.inventoryBrandNone),
        for (final brand in inventoryActiveBrands(_brands))
          LotOption(brand.id, brand.name),
        LotOption(_addBrand, l10n.inventoryBrandAddNew),
      ],
    );
    if (picked == null || !mounted) return;
    if (picked == _addBrand) {
      final made = await showInventoryBrandSheet(
        context,
        businessId: widget.businessId,
        service: widget.service,
      );
      if (made == null || !mounted) return;
      setState(() {
        if (made.id.isNotEmpty) {
          _brands.add(InventoryBrand(id: made.id, name: made.name));
        }
        _brandId = made.id;
        _brandName = made.name;
      });
      return;
    }
    setState(() {
      _brandId = picked;
      _brandName = inventoryBrandById(_brands, picked)?.name ?? '';
    });
  }

  Future<void> _pickCategory() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.inventoryCategoryPickTitle,
      // A product typed before categories existed has a name but no id: no
      // option is its own.
      selected: _categoryId.isEmpty && _categoryName.isNotEmpty
          ? null
          : _categoryId,
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
      _categoryName = inventoryCategoryById(_categories, picked)?.name ?? '';
    });
  }

  List<String> get _errors => _submitted
      ? validateInventoryItemDraft(_draft, creating: _creating)
      : const [];

  String? _errorFor(
    AppLocalizations l10n,
    List<String> codes,
    List<String> own,
  ) {
    for (final code in own) {
      if (codes.contains(code)) return inventoryFieldErrorText(l10n, code);
    }
    return null;
  }

  /// The form again, empty, with only the brand and the category kept.
  void _startNext() {
    for (final c in [_name, _price, _cost, _quantity, _lowStock, _photo]) {
      c.clear();
    }
    for (final c in _stock.values) {
      c.clear();
    }
    _submitted = false;
    _nameFocus.requestFocus();
    // The sheet may have been scrolled down to the buttons: bring the name
    // back into view.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ctx = _nameFocus.context;
      if (ctx != null && ctx.mounted) {
        Scrollable.ensureVisible(ctx, duration: Duration.zero);
      }
    });
  }

  Future<void> _save({bool another = false}) async {
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
        final created = await widget.service.createItem(
          widget.businessId,
          draft,
        );
        if (created.itemId.isNotEmpty && created.code.isNotEmpty) {
          widget.onCreated?.call((
            itemId: created.itemId,
            code: created.code,
            title: inventoryDisplayName(draft.brand, draft.name),
          ));
        }
      } else {
        await widget.service.updateItem(widget.businessId, existing, draft);
      }
      widget.onSaved?.call();
      if (!mounted) return;
      AppHaptics.commit();
      if (another && existing == null) {
        setState(() {
          _justAdded = inventoryDisplayName(draft.brand, draft.name);
          _startNext();
        });
        return;
      }
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(
        () => _serverNote = inventoryFailureText(
          l10n,
          inventoryFailureFromError(error),
        ),
      );
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
          if (_creating) ...[
            const SizedBox(height: AppSpacing.sm),
            OutlinedButton(
              key: const Key('inv-form-save-another'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(50),
                foregroundColor: AppColors.cobalt,
                side: const BorderSide(color: AppColors.cobalt),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                ),
              ),
              onPressed: _busy ? null : () => _save(another: true),
              child: Text(
                l10n.inventorySaveAndAddAnother,
                maxLines: 2,
                textAlign: TextAlign.center,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_justAdded.isNotEmpty) ...[
            _AddedNote(
              key: const Key('inv-form-added'),
              text: l10n.inventoryProductAddedNext(_justAdded),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
          LotPickerField(
            key: const Key('inv-field-brand'),
            label: l10n.inventoryFieldBrand,
            value: _brandName,
            placeholder: l10n.inventoryBrandNone,
            onTap: _busy ? () {} : _pickBrand,
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('inv-field-name'),
            controller: _name,
            focusNode: _nameFocus,
            enabled: !_busy,
            textCapitalization: TextCapitalization.sentences,
            onChanged: changed,
            decoration: InputDecoration(
              labelText: l10n.inventoryFieldName,
              errorText: _errorFor(l10n, errors, [
                'name_required',
                'name_too_long',
              ]),
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
                        _stores.storeName(_stores.ownStoreId),
                      ),
                errorText: _errorFor(l10n, errors, ['quantity_invalid']),
                errorMaxLines: 3,
              ),
            )
          else
            Text(
              l10n.inventoryQuantityHelpEdit,
              key: const Key('inv-quantity-help'),
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.4,
                color: AppColors.muted,
              ),
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

/// The line under a "save and add another": what was just saved.
class _AddedNote extends StatelessWidget {
  const _AddedNote({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: AppColors.sage.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: AppColors.sage.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.check_circle_outline,
            size: 16,
            color: AppColors.sage,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                fontSize: 13,
                height: 1.35,
                color: AppColors.ink,
              ),
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
}) => showLotSheet<bool>(
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

  late final _quantity = TextEditingController(
    text: widget.add ? '' : '${_countIn(_storeId)}',
  );
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
          LotOption(
            store.id,
            store.name,
            detail: l10n.inventoryInStockCount(_countIn(store.id)),
          ),
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
    if (validateStockAdjustment(
      _quantity.text,
      adding: widget.add,
    ).isNotEmpty) {
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
      setState(
        () => _serverNote = inventoryFailureText(
          l10n,
          inventoryFailureFromError(error),
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return LotSheetShell(
      title: widget.add ? l10n.inventoryAddStock : l10n.inventorySetCount,
      subtitle: widget.item.displayName,
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
            widget.add
                ? l10n.inventoryAddStockHelp
                : l10n.inventorySetCountHelp,
            style: const TextStyle(
              fontSize: 13,
              height: 1.4,
              color: AppColors.muted,
            ),
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
              l10n.inventoryStockForStore(
                _stores.storeName(_stores.ownStoreId),
              ),
              key: const Key('inv-stock-own-store'),
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
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

/// Print tags for a product: N copies of its one code, straight to the
/// shop's label printer, as an exact-size PDF to share, or as the tag page
/// in the browser (see `print_tags_sheet.dart`).
Future<void> showInventoryTagSheet(
  BuildContext context, {
  required String businessId,
  required InventoryItem item,
  InventoryTagOpener opener = openInventoryTags,
  LabelPrinterController? printer,
  TagPdfSharer sharer = shareTagPdf,
}) => showPrintTagsSheet(
  context,
  businessId: businessId,
  itemId: item.id,
  code: item.code,
  title: item.displayName,
  opener: opener,
  printer: printer,
  sharer: sharer,
);
