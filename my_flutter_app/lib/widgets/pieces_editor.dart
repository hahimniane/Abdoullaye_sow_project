import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/line_pieces.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../services/invoice_ledger.dart' show invoiceCentsToInput;
import '../services/waiting_packages.dart' show trimNumber;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/money_input.dart';

/// What a package that is not a car holds, piece by piece, as the counter
/// types it (docs/WAITING_PACKAGES.md "Pieces"): each piece a barrel, a box
/// or something else, what it is, an optional size in inches and its own
/// price. One editor, used wherever a line's pieces are entered: registering
/// a package at the counter, editing a waiting package, and adding or
/// editing a line on a container.
///
/// The sheet owns a [PiecesEditorController]; [PiecesEditor] draws its
/// pieces and [PiecesTotalLine] the count and total for the footer. The
/// rules are `lib/services/line_pieces.dart` (`pieceErrors`, 1 to
/// [maxPieces]); the editor shows each piece's own problems once the sheet
/// asks it to ([PiecesEditor.showErrors]).

/// One piece as typed.
class PieceDraftRow {
  PieceDraftRow._({
    required this.uid,
    required this.id,
    required this.kind,
    String description = '',
    String length = '',
    String width = '',
    String height = '',
    String price = '',
  }) : description = TextEditingController(text: description),
       length = TextEditingController(text: length),
       width = TextEditingController(text: width),
       height = TextEditingController(text: height),
       price = TextEditingController(text: price),
       showSize = length.isNotEmpty || width.isNotEmpty || height.isNotEmpty;

  /// Local identity, so a row keeps its fields when one above it goes.
  final int uid;

  /// The stored piece's id, kept on an edit; "" for a new piece (the server
  /// gives it the first free `p<n>`).
  final String id;
  String kind;
  final TextEditingController description;
  final TextEditingController length;
  final TextEditingController width;
  final TextEditingController height;
  final TextEditingController price;

  /// The size fields are open: asked for, or already filled in.
  bool showSize;

  List<TextEditingController> get _fields => [
    description,
    length,
    width,
    height,
    price,
  ];

  static String _side(String typed) => typed.trim().replaceAll(',', '.');

  /// The piece as `pieceErrors` and the request read it. A price that could
  /// not be read is kept as unreadable, so it is refused, never guessed.
  Map<String, Object?> toDraft() {
    final reading = readMoneyInput(price.text);
    return {
      'id': id,
      'kind': kind,
      'description': description.text,
      'sizeIn': {
        'l': _side(length.text),
        'w': _side(width.text),
        'h': _side(height.text),
      },
      'priceCents': reading.isEmpty ? null : (reading.cents ?? 'unreadable'),
    };
  }

  void _dispose() {
    for (final c in _fields) {
      c.dispose();
    }
  }
}

/// The pieces being typed: add one, remove one, change a kind, start over.
/// Tells its listeners on every change, typing included, so the total and
/// the "print N labels" button follow.
class PiecesEditorController extends ChangeNotifier {
  /// Opens on [initial] (an edit: its ids, kinds, descriptions, sizes and
  /// prices), else on one piece of [kind].
  ///
  /// [limit] caps how many pieces can be added: [maxPieces] at the counter,
  /// fewer where the server holds a smaller cap (a request's 20 at
  /// Received).
  PiecesEditorController({
    Iterable<LinePiece> initial = const [],
    String kind = 'barrel',
    this.limit = maxPieces,
  }) {
    final start = initial.where((p) => !p.isCar).toList();
    if (start.isEmpty) {
      _rows.add(_row(kind: kind));
    } else {
      for (final piece in start) {
        final size = piece.sizeIn;
        _rows.add(
          _row(
            id: piece.id,
            kind: piece.kind,
            description: piece.description,
            length: size == null ? '' : trimNumber(size.l),
            width: size == null ? '' : trimNumber(size.w),
            height: size == null ? '' : trimNumber(size.h),
            price: piece.priceCents == null
                ? ''
                : invoiceCentsToInput(piece.priceCents!),
          ),
        );
      }
    }
  }

  final List<PieceDraftRow> _rows = [];

  /// Rows taken away stay alive until the controller goes: the fields they
  /// fed may still be on screen for the frame that removes them.
  final List<PieceDraftRow> _retired = [];
  int _nextUid = 0;

  PieceDraftRow _row({
    String id = '',
    required String kind,
    String description = '',
    String length = '',
    String width = '',
    String height = '',
    String price = '',
  }) {
    final row = PieceDraftRow._(
      uid: _nextUid++,
      id: id,
      kind: pieceKinds.contains(kind) ? kind : pieceKind.other,
      description: description,
      length: length,
      width: width,
      height: height,
      price: price,
    );
    for (final c in row._fields) {
      c.addListener(notifyListeners);
    }
    return row;
  }

  List<PieceDraftRow> get rows => List.unmodifiable(_rows);
  int get count => _rows.length;
  /// The most pieces this editor takes.
  final int limit;

  bool get canAdd => _rows.length < limit;

  /// The pieces as the request carries them before they are cleaned.
  List<Map<String, Object?>> get draftPieces => [
    for (final row in _rows) row.toDraft(),
  ];

  /// The line total: the sum of the priced pieces, null while none is.
  int? get totalCents => piecesTotalCents(normalizePieces(draftPieces));

  /// One piece's own problems (not the list's: "too many", "none").
  List<String> errorsFor(int index) {
    if (index < 0 || index >= _rows.length) return const [];
    return pieceErrors([
      _rows[index].toDraft(),
    ]).where((c) => c != 'pieces_required' && c != 'pieces_too_many').toList();
  }

  /// Another piece, of the same kind as the last (barrels come in runs).
  void add() {
    if (!canAdd) return;
    _rows.add(_row(kind: _rows.isEmpty ? pieceKind.barrel : _rows.last.kind));
    notifyListeners();
  }

  /// A package always keeps one piece.
  void remove(int index) {
    if (_rows.length <= 1 || index < 0 || index >= _rows.length) return;
    _retired.add(_rows.removeAt(index));
    notifyListeners();
  }

  void setKind(int index, String kind) {
    if (index < 0 || index >= _rows.length || !pieceKinds.contains(kind)) {
      return;
    }
    if (_rows[index].kind == kind) return;
    _rows[index].kind = kind;
    notifyListeners();
  }

  void openSize(int index) {
    if (index < 0 || index >= _rows.length) return;
    _rows[index].showSize = true;
    notifyListeners();
  }

  /// One fresh piece: the next package starts over.
  void reset({String kind = 'barrel', String description = ''}) {
    _retired.addAll(_rows);
    _rows
      ..clear()
      ..add(_row(kind: kind, description: description));
    notifyListeners();
  }

  @override
  void dispose() {
    for (final row in [..._rows, ..._retired]) {
      row._dispose();
    }
    super.dispose();
  }
}

/// The pieces of a package, one card each, and "Add another piece".
class PiecesEditor extends StatelessWidget {
  const PiecesEditor({
    super.key,
    required this.controller,
    required this.describe,
    this.showErrors = false,
    this.error,
    this.enabled = true,
  });

  final PiecesEditorController controller;

  /// A refusal code in words (the screen's `containerErrorText`).
  final String Function(String code) describe;

  /// Each piece says what is wrong with it: after a refused save.
  final bool showErrors;

  /// A problem with the pieces as a whole (none, too many, below what was
  /// paid), said under them.
  final String? error;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final rows = controller.rows;
        return Column(
          key: const Key('pieces-editor'),
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.pcsPiecesTitle(rows.length),
              key: const Key('pieces-title'),
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.2,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            for (var i = 0; i < rows.length; i++)
              KeyedSubtree(
                key: ValueKey('piece-row:${rows[i].uid}'),
                child: _PieceCard(
                  index: i,
                  row: rows[i],
                  removable: rows.length > 1 && enabled,
                  enabled: enabled,
                  errors: showErrors
                      ? [for (final c in controller.errorsFor(i)) describe(c)]
                      : const [],
                  onKind: (kind) {
                    AppHaptics.selection();
                    controller.setKind(i, kind);
                  },
                  onRemove: () {
                    AppHaptics.selection();
                    controller.remove(i);
                  },
                  onOpenSize: () => controller.openSize(i),
                ),
              ),
            _AddPieceButton(
              enabled: enabled && controller.canAdd,
              onTap: () {
                AppHaptics.selection();
                controller.add();
              },
            ),
            if (error != null) ...[
              const SizedBox(height: 6),
              Text(
                error!,
                key: const Key('pieces-error'),
                style: const TextStyle(
                  fontSize: 12,
                  height: 1.35,
                  fontWeight: FontWeight.w600,
                  color: AppColors.errorRed,
                ),
              ),
            ],
          ],
        );
      },
    );
  }
}

class _PieceCard extends StatelessWidget {
  const _PieceCard({
    required this.index,
    required this.row,
    required this.removable,
    required this.enabled,
    required this.errors,
    required this.onKind,
    required this.onRemove,
    required this.onOpenSize,
  });

  final int index;
  final PieceDraftRow row;
  final bool removable;
  final bool enabled;
  final List<String> errors;
  final ValueChanged<String> onKind;
  final VoidCallback onRemove;
  final VoidCallback onOpenSize;

  static final _decimal = FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'));

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final number = index + 1;
    final invalid = errors.isNotEmpty;
    Widget side(String key, TextEditingController c, String label) => Expanded(
      child: TextField(
        key: Key('$key-$index'),
        controller: c,
        enabled: enabled,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [_decimal],
        decoration: InputDecoration(
          labelText: label,
          suffixText: 'in',
          isDense: true,
        ),
      ),
    );

    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(
          color: invalid ? AppColors.errorRed : AppColors.rule,
          width: invalid ? 1.5 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.mist,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                ),
                child: Text(
                  '$number',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.cobaltDeep,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Semantics(
                  label: l10n.pcsKindLabel(number),
                  child: Row(
                    children: [
                      for (final kind in pieceKinds) ...[
                        Expanded(
                          child: _KindButton(
                            key: Key('piece-kind-$index-$kind'),
                            label: switch (kind) {
                              'barrel' => l10n.pcsKindBarrel,
                              'box' => l10n.pcsKindBox,
                              _ => l10n.pcsKindOther,
                            },
                            selected: row.kind == kind,
                            onTap: enabled ? () => onKind(kind) : null,
                          ),
                        ),
                        if (kind != pieceKinds.last) const SizedBox(width: 6),
                      ],
                    ],
                  ),
                ),
              ),
              if (removable)
                IconButton(
                  key: Key('piece-remove-$index'),
                  onPressed: onRemove,
                  icon: const Icon(Icons.close, size: 18),
                  color: AppColors.muted,
                  tooltip: l10n.pcsRemovePiece(number),
                  visualDensity: VisualDensity.compact,
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  key: Key('piece-description-$index'),
                  controller: row.description,
                  enabled: enabled,
                  textCapitalization: TextCapitalization.sentences,
                  maxLength: maxPieceDescription,
                  buildCounter:
                      (
                        _, {
                        required currentLength,
                        required isFocused,
                        maxLength,
                      }) => null,
                  decoration: InputDecoration(
                    labelText: row.kind == pieceKind.barrel
                        ? l10n.pcsDescriptionOptional
                        : l10n.pcsDescriptionWhat,
                    isDense: true,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              SizedBox(
                width: 104,
                child: TextField(
                  key: Key('piece-price-$index'),
                  controller: row.price,
                  enabled: enabled,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: InputDecoration(
                    labelText: l10n.pcsPrice,
                    prefixText: r'$ ',
                    isDense: true,
                  ),
                ),
              ),
            ],
          ),
          if (row.showSize) ...[
            const SizedBox(height: AppSpacing.sm),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                side('piece-length', row.length, l10n.wpkLength),
                const SizedBox(width: 6),
                side('piece-width', row.width, l10n.wpkWidth),
                const SizedBox(width: 6),
                side('piece-height', row.height, l10n.wpkHeight),
              ],
            ),
          ] else
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                key: Key('piece-add-size-$index'),
                onPressed: enabled ? onOpenSize : null,
                icon: const Icon(Icons.straighten, size: 16),
                label: Text(l10n.pcsAddSize),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  visualDensity: VisualDensity.compact,
                ),
              ),
            ),
          for (final message in errors)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                message,
                key: Key('piece-error-$index'),
                style: const TextStyle(
                  fontSize: 12,
                  height: 1.3,
                  fontWeight: FontWeight.w600,
                  color: AppColors.errorRed,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _KindButton extends StatelessWidget {
  const _KindButton({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: PressableScale(
        scale: 0.96,
        onTap: onTap,
        child: AnimatedContainer(
          duration: AppMotion.press,
          height: 40,
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 4),
          decoration: BoxDecoration(
            color: selected ? AppColors.mist : AppColors.parchment,
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            border: Border.all(
              color: selected ? AppColors.cobalt : AppColors.rule,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 13,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
              color: selected ? AppColors.cobaltDeep : AppColors.muted,
            ),
          ),
        ),
      ),
    );
  }
}

class _AddPieceButton extends StatelessWidget {
  const _AddPieceButton({required this.enabled, required this.onTap});

  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Semantics(
      button: true,
      enabled: enabled,
      child: PressableScale(
        key: const Key('pieces-add'),
        scale: 0.98,
        onTap: enabled ? onTap : null,
        child: Container(
          height: 46,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            border: Border.all(
              color: enabled ? AppColors.cobalt : AppColors.rule,
              width: 1.5,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.add,
                size: 18,
                color: enabled ? AppColors.cobaltDeep : AppColors.muted,
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  l10n.pcsAddPiece,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: enabled ? AppColors.cobaltDeep : AppColors.muted,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "3 pieces · Total" and the total, for the sheet's footer: it follows the
/// pieces as they are typed.
class PiecesTotalLine extends StatelessWidget {
  const PiecesTotalLine({super.key, required this.controller});

  final PiecesEditorController controller;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final total = controller.totalCents;
        return Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
          child: Row(
            key: const Key('pieces-total'),
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Expanded(
                child: Text(
                  l10n.pcsTotalLabel(controller.count),
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              Text(
                total == null ? l10n.pcsNoPriceYet : formatLotCents(total),
                key: const Key('pieces-total-amount'),
                style: TextStyle(
                  fontSize: total == null ? 13 : 20,
                  fontWeight: FontWeight.w800,
                  color: total == null ? AppColors.muted : AppColors.cobaltDeep,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
