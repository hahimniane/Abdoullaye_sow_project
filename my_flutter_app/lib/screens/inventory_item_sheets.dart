import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory.dart';
import '../services/inventory_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';

/// The product form: create a product, or edit one. Money and counts are read
/// by the same readers the server's limits mirror, so a bad entry is refused
/// at the field before the round trip. The count is asked for only when
/// creating; afterwards it changes through stock adjustments, never by editing.
///
/// Answers true when something was saved.
Future<bool?> showInventoryItemForm(
  BuildContext context, {
  required String businessId,
  InventoryItem? existing,
  InventoryService service = const InventoryService(),
}) =>
    showLotSheet<bool>(
      context,
      InventoryItemFormSheet(
        businessId: businessId,
        existing: existing,
        service: service,
      ),
    );

class InventoryItemFormSheet extends StatefulWidget {
  const InventoryItemFormSheet({
    super.key,
    required this.businessId,
    this.existing,
    this.service = const InventoryService(),
  });

  final String businessId;
  final InventoryItem? existing;
  final InventoryService service;

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
  late final _category = TextEditingController(text: _start.category);
  late final _photo = TextEditingController(text: _start.photoUrl);

  bool _busy = false;
  bool _submitted = false;
  String _serverNote = '';

  bool get _creating => widget.existing == null;

  @override
  void dispose() {
    for (final c in [_name, _price, _cost, _quantity, _lowStock, _category, _photo]) {
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
        category: _category.text,
        photoUrl: _photo.text,
      );

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
          if (_creating)
            TextField(
              key: const Key('inv-field-quantity'),
              controller: _quantity,
              enabled: !_busy,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              onChanged: changed,
              decoration: InputDecoration(
                labelText: l10n.inventoryFieldQuantity,
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
          TextField(
            key: const Key('inv-field-category'),
            controller: _category,
            enabled: !_busy,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: l10n.inventoryFieldCategory),
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
/// shelf, which clears "count was off"). Answers true when saved.
Future<bool?> showInventoryStockSheet(
  BuildContext context, {
  required String businessId,
  required InventoryItem item,
  required bool add,
  InventoryService service = const InventoryService(),
}) =>
    showLotSheet<bool>(
      context,
      InventoryStockSheet(
        businessId: businessId,
        item: item,
        add: add,
        service: service,
      ),
    );

class InventoryStockSheet extends StatefulWidget {
  const InventoryStockSheet({
    super.key,
    required this.businessId,
    required this.item,
    required this.add,
    this.service = const InventoryService(),
  });

  final String businessId;
  final InventoryItem item;
  final bool add;
  final InventoryService service;

  @override
  State<InventoryStockSheet> createState() => _InventoryStockSheetState();
}

class _InventoryStockSheetState extends State<InventoryStockSheet> {
  late final _quantity =
      TextEditingController(text: widget.add ? '' : '${widget.item.quantity}');
  final _note = TextEditingController();
  bool _busy = false;
  bool _invalid = false;
  String _serverNote = '';

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
          TextField(
            key: const Key('inv-stock-quantity'),
            controller: _quantity,
            enabled: !_busy,
            autofocus: true,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            onChanged: (_) {
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
