import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/business_price_list.dart'
    show priceLbText, priceSnapshotWeighs;
import '../services/line_pieces.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../services/invoice_ledger.dart' show invoiceCentsToInput;
import '../services/package_price_list.dart' show counterPriceCents, unitOf;
import '../services/package_price_mode.dart';
import '../services/piece_rows.dart';
import '../services/price_list_fill.dart';
import '../services/waiting_packages.dart' show trimNumber;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/money_input.dart';
import 'price_fill_sheet.dart';

/// What a package that is not a car holds, piece by piece, as the counter
/// types it (docs/WAITING_PACKAGES.md "Pieces"): each piece a barrel, a box
/// or something else, what it is, an optional size in inches and its own
/// price. Identical pieces are one row with "How many", priced each or all
/// of that row together ("How many, and a row priced all together": the
/// amount is shared among the row's own pieces, never another row's). One
/// editor, used wherever a line's pieces are entered: registering
/// a package at the counter, editing a waiting package, and adding or
/// editing a line on a container.
///
/// The sheet owns a [PiecesEditorController]; [PiecesEditor] draws its
/// pieces and [PiecesTotalLine] the count and total for the footer. The
/// rules are `lib/services/line_pieces.dart` (`pieceErrors`, 1 to
/// [maxPieces]); the editor shows each piece's own problems once the sheet
/// asks it to ([PiecesEditor.showErrors]).

/// One row as typed: a piece, or several identical ones ([count]).
class PieceDraftRow {
  PieceDraftRow._({
    required this.uid,
    required this.id,
    required this.kind,
    this.count = 1,
    List<String> moreIds = const [],
    this.priceFor = priceForEach,
    String description = '',
    String length = '',
    String width = '',
    String height = '',
    String price = '',
    this.snapshot,
    String weight = '',
  }) : description = TextEditingController(text: description),
       length = TextEditingController(text: length),
       width = TextEditingController(text: width),
       height = TextEditingController(text: height),
       price = TextEditingController(text: price),
       weight = priceSnapshotWeighs(snapshot)
           ? TextEditingController(text: weight)
           : null,
       moreIds = List.unmodifiable(moreIds),
       showSize = length.isNotEmpty || width.isNotEmpty || height.isNotEmpty;

  /// Local identity, so a row keeps its fields when one above it goes.
  final int uid;

  /// The stored piece's id, kept on an edit; "" for a new piece (the server
  /// gives it the first free `p<n>`).
  final String id;
  String kind;

  /// "How many": the identical pieces this row stands for. Each is still a
  /// piece of its own once saved: its own label, its own scan.
  int count;

  /// The stored ids of the second, third... of them, so an edit keeps its
  /// pieces. They stay when [count] is lowered: fewer pieces simply send
  /// fewer of them.
  final List<String> moreIds;

  /// How a row of several is priced: [priceForEach] piece at [price], or
  /// [priceForAll] of them together for [price], shared among this row's
  /// pieces only. One piece is always priced each.
  String priceFor;

  /// The row's price is one amount for all its pieces.
  bool get pricedTogether => rowPricedTogether(priceFor, count);
  final TextEditingController description;
  final TextEditingController length;
  final TextEditingController width;
  final TextEditingController height;
  final TextEditingController price;

  /// The price the business's list gave this piece when it was requested
  /// (docs/PACKAGE_PRICE_LIST.md §3), when the counter scale decides its
  /// final price: an item that covers only some pounds, or a category
  /// priced by the pound. Null for every other piece.
  final Map<String, dynamic>? snapshot;

  /// The weighed weight, for a piece with a [snapshot] that weighs, in the
  /// snapshot's unit ([weightUnit]); typing one sets [price] from the list
  /// (`counterPriceCents`), still editable.
  final TextEditingController? weight;

  /// "kg" for a piece the business priced by the kilo, else "lb".
  String get weightUnit => unitOf(snapshot);

  /// The size fields are open: asked for, or already filled in.
  bool showSize;

  /// The weight a "From the price list" fill asked for this piece (the
  /// list's unit); null when it was never filled by weight. Nothing is stored
  /// from it: it only lets the sheet fill an air package's empty weight.
  double? fillWeight;

  List<TextEditingController> get _fields => [
    description,
    length,
    width,
    height,
    price,
    ?weight,
  ];

  static String _side(String typed) => typed.trim().replaceAll(',', '.');

  /// The row's price as typed: whole cents, null for blank, or
  /// "unreadable" - kept, so it is refused, never guessed.
  Object? get _typedPrice {
    final reading = readMoneyInput(price.text);
    return reading.isEmpty ? null : (reading.cents ?? 'unreadable');
  }

  /// The price typed in whole cents; null while blank or unreadable.
  int? get priceCents {
    final typed = _typedPrice;
    return typed is int ? typed : null;
  }

  /// The row as `pieceErrors` reads it - what it is and the price typed on
  /// it - for the row's own problems.
  Map<String, Object?> toDraft() => _piece(id, _typedPrice);

  /// The row's pieces as the request carries them: [count] of them, the
  /// first with the row's id and the others with the ids stored beside it
  /// (none for a new one). Priced together, the amount is spread over them
  /// (`rowPieceCents`); a price that could not be read stays unreadable on
  /// every one.
  List<Map<String, Object?>> toDrafts() {
    final typed = _typedPrice;
    final shares = typed is int
        ? rowPieceCents(typed, count, priceFor)
        : List<Object?>.filled(count, typed);
    return [
      for (var i = 0; i < count; i++)
        _piece(
          i == 0 ? id : (i - 1 < moreIds.length ? moreIds[i - 1] : ''),
          shares[i],
        ),
    ];
  }

  Map<String, Object?> _piece(String pieceId, Object? priceCents) => {
    'id': pieceId,
    'kind': kind,
    'description': description.text,
    'sizeIn': {
      'l': _side(length.text),
      'w': _side(width.text),
      'h': _side(height.text),
    },
    'priceCents': priceCents,
  };

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
  ///
  /// [pickupFeeCents] opens the "Pickup fee" field on that amount: a
  /// collected request's fee, its own amount beside the pieces and inside
  /// the total, never spread into the piece prices (owner decision
  /// 2026-10-18). Null: the line has none and no field shows.
  ///
  /// [priceSnapshots] by piece id: a piece whose snapshot weighs gets a
  /// weight field that fills its price (a request's pieces at Received).
  ///
  /// [priceMode] is how the business prices a package
  /// (docs/PACKAGE_ONE_PRICE.md): [packagePriceModePiece] is the form as it
  /// always was; [packagePriceModePackage] has no price on a row, one "Price
  /// for everything" instead, shared among the pieces
  /// (`packagePiecePrices`). In that mode rows are grouped by shape alone and
  /// [priceSnapshots] are not used. [isEdit] says [initial] is a saved
  /// package: its pieces are what an untouched save keeps and what the one
  /// price opens on (their sum). Otherwise it opens on [packagePriceCents]
  /// (a received request's estimate total), blank when null.
  PiecesEditorController({
    Iterable<LinePiece> initial = const [],
    String kind = 'barrel',
    this.limit = maxPieces,
    int? pickupFeeCents,
    Map<String, Map<String, dynamic>> priceSnapshots = const {},
    this.priceMode = packagePriceModePiece,
    bool isEdit = false,
    int? packagePriceCents,
  }) : hasPickupFee = pickupFeeCents != null,
       pickupFee = TextEditingController(
         text: pickupFeeCents == null
             ? ''
             : invoiceCentsToInput(pickupFeeCents),
       ),
       _stored =
           priceMode == packagePriceModePackage &&
               isEdit &&
               initial.any((p) => !p.isCar)
           ? List.unmodifiable(initial.where((p) => !p.isCar))
           : null,
       packagePrice = TextEditingController(
         text: priceMode != packagePriceModePackage
             ? ''
             : _centsText(
                 isEdit
                     ? packagePricePrefill(initial.where((p) => !p.isCar))
                     : packagePriceCents,
               ),
       ) {
    pickupFee.addListener(notifyListeners);
    packagePrice.addListener(notifyListeners);
    final onePrice = isPackageMode;
    final start = initial.where((p) => !p.isCar).toList();
    if (start.isEmpty) {
      _rows.add(_row(kind: kind));
    } else {
      // Identical pieces that follow each other open as one row (`How
      // many`); a piece weighed at Received keeps its own row and field.
      final groups = groupPieceRows(
        start,
        keepAlone: onePrice
            ? null
            : (piece) => priceSnapshotWeighs(priceSnapshots[piece.id]),
        ignorePrices: onePrice,
      );
      for (final group in groups) {
        final piece = group.pieces.first;
        final size = piece.sizeIn;
        _rows.add(
          _row(
            id: piece.id,
            kind: piece.kind,
            count: group.count,
            moreIds: [for (final p in group.pieces.skip(1)) p.id],
            priceFor: group.priceFor,
            description: piece.description,
            length: size == null ? '' : trimNumber(size.l),
            width: size == null ? '' : trimNumber(size.w),
            height: size == null ? '' : trimNumber(size.h),
            price: group.priceCents == null
                ? ''
                : invoiceCentsToInput(group.priceCents!),
            snapshot: onePrice ? null : priceSnapshots[piece.id],
            weight: onePrice ? '' : _startWeight(priceSnapshots[piece.id]),
          ),
        );
      }
    }
  }

  static String _centsText(int? cents) =>
      cents == null ? '' : invoiceCentsToInput(cents);

  /// How the business prices a package ([packagePriceModePiece] or
  /// [packagePriceModePackage]).
  final String priceMode;

  /// One price for the whole package: no price on a row.
  bool get isPackageMode => priceMode == packagePriceModePackage;

  /// The one price for everything, in US dollars as typed; only used in
  /// package mode.
  final TextEditingController packagePrice;

  /// The saved package's pieces, when editing in package mode: an untouched
  /// save keeps their prices (`packagePiecePrices`), and the note under the
  /// price says how many were added or removed since.
  final List<LinePiece>? _stored;

  /// How many pieces the saved package had; 0 for a new one.
  int get savedCount => _stored?.length ?? 0;

  /// The one price typed, in whole cents; null while blank or unreadable.
  int? get onePriceCents => readPackagePriceField(packagePrice.text).cents;

  /// What is wrong with the one price, as codes (`piece_price_invalid`, and
  /// for a customer's package `package_price_required`).
  List<String> priceProblems({bool requirePrice = false}) => isPackageMode
      ? packagePriceProblems(packagePrice.text, requirePrice: requirePrice)
      : const [];

  /// The pieces' ids in the form's order, "" for a new one.
  List<String> get pieceIds => [
    for (final row in _rows)
      for (var i = 0; i < row.count; i++)
        i == 0
            ? row.id
            : (i - 1 < row.moreIds.length ? row.moreIds[i - 1] : ''),
  ];

  final List<PieceDraftRow> _rows = [];

  /// Whether this load has a pickup fee field (a collected request's).
  final bool hasPickupFee;

  /// The pickup fee in US dollars as typed; blank is no fee.
  final TextEditingController pickupFee;

  /// The typed fee in whole cents: 0 for blank, for none, or for something
  /// that is not money ([pickupFeeInvalid] says which).
  int get pickupFeeCents {
    if (!hasPickupFee) return 0;
    final reading = readMoneyInput(pickupFee.text);
    final cents = reading.cents;
    return cents != null && cents >= 0 ? cents : 0;
  }

  /// The fee typed is not money, or below zero (`pickup_fee_invalid`).
  bool get pickupFeeInvalid {
    if (!hasPickupFee) return false;
    final reading = readMoneyInput(pickupFee.text);
    if (reading.isEmpty) return false;
    final cents = reading.cents;
    return cents == null || cents < 0;
  }

  /// The fee as a request carries it: null when the line has no fee field.
  int? get pickupFeeForRequest => hasPickupFee ? pickupFeeCents : null;

  /// Rows taken away stay alive until the controller goes: the fields they
  /// fed may still be on screen for the frame that removes them.
  final List<PieceDraftRow> _retired = [];
  int _nextUid = 0;

  /// A by-the-weight piece opens on the weight the customer gave, in the
  /// snapshot's unit.
  static String _startWeight(Map<String, dynamic>? snapshot) {
    final lb = snapshot?['weightLb'];
    return lb is num && lb > 0 ? priceLbText(lb) : '';
  }

  /// The weight typed for [row] (in its snapshot's unit) sets its price from
  /// the list; a weight that is not a number, or a price the list cannot give
  /// (extra weight with no rate), leaves the price as it was for staff to
  /// type.
  void _weighed(PieceDraftRow row) {
    final text = row.weight?.text.trim().replaceAll(',', '.') ?? '';
    final lb = double.tryParse(text);
    if (lb == null || lb <= 0) return;
    final cents = counterPriceCents(row.snapshot, lb);
    if (cents == null) return;
    final next = invoiceCentsToInput(cents);
    if (row.price.text != next) row.price.text = next;
  }

  PieceDraftRow _row({
    String id = '',
    required String kind,
    int count = 1,
    List<String> moreIds = const [],
    String priceFor = priceForEach,
    String description = '',
    String length = '',
    String width = '',
    String height = '',
    String price = '',
    Map<String, dynamic>? snapshot,
    String weight = '',
  }) {
    final row = PieceDraftRow._(
      uid: _nextUid++,
      id: id,
      kind: pieceKinds.contains(kind) ? kind : pieceKind.other,
      count: count < 1 ? 1 : count,
      moreIds: moreIds,
      priceFor: priceFor == priceForAll ? priceForAll : priceForEach,
      description: description,
      length: length,
      width: width,
      height: height,
      price: price,
      snapshot: snapshot,
      weight: weight,
    );
    for (final c in row._fields) {
      c.addListener(notifyListeners);
    }
    row.weight?.addListener(() => _weighed(row));
    return row;
  }

  List<PieceDraftRow> get rows => List.unmodifiable(_rows);

  /// The pieces in all: what is saved, labelled and scanned (every row's
  /// "How many" added up).
  int get count => _rows.fold(0, (sum, row) => sum + row.count);

  /// The most pieces this editor takes.
  final int limit;

  bool get canAdd => count < limit;

  /// The number of row [index]'s first piece, as its label will carry it.
  int firstNumber(int index) {
    var number = 1;
    for (var i = 0; i < index && i < _rows.length; i++) {
      number += _rows[i].count;
    }
    return number;
  }

  /// The most row [index] can stand for: what the package still has room
  /// for beside the other rows, never below one.
  int maxCount(int index) {
    if (index < 0 || index >= _rows.length) return 1;
    final room = limit - (count - _rows[index].count);
    return room < 1 ? 1 : room;
  }

  /// "How many" set on a row: 1 up to [maxCount].
  void setCount(int index, int value) {
    if (index < 0 || index >= _rows.length) return;
    final next = value.clamp(1, maxCount(index));
    if (_rows[index].count == next) return;
    _rows[index].count = next;
    notifyListeners();
  }

  /// A row's price switch: the number typed stays as it is and only what it
  /// stands for changes (the price of each piece, or of all the row's
  /// pieces together).
  void setPriceFor(int index, String priceFor) {
    if (index < 0 || index >= _rows.length) return;
    if (priceFor != priceForEach && priceFor != priceForAll) return;
    if (_rows[index].priceFor == priceFor) return;
    _rows[index].priceFor = priceFor;
    notifyListeners();
  }

  /// The pieces as the request carries them before they are cleaned: every
  /// row's pieces, in order.
  ///
  /// In package mode every piece carries its share of the one price
  /// (`packagePieceDrafts`).
  List<Map<String, Object?>> get draftPieces {
    final drafts = [for (final row in _rows) ...row.toDrafts()];
    return isPackageMode
        ? packagePieceDrafts(
            drafts,
            priceText: packagePrice.text,
            stored: _stored,
          )
        : drafts;
  }

  /// The line total: the priced pieces plus the pickup fee when the line
  /// has one (`lineTotalCents`), null while no piece is priced. In package
  /// mode: the one price plus the fee.
  int? get totalCents => isPackageMode
      ? packageTotalCents(packagePrice.text, pickupFeeCents)
      : lineTotalCents(normalizePieces(draftPieces), pickupFeeCents);

  /// One piece's own problems (not the list's: "too many", "none").
  /// [requirePrice] (a customer's package: docs/PACKAGE_PRICE_REQUIRED.md)
  /// adds `piece_price_required` when its price is blank; $0 is a price.
  List<String> errorsFor(int index, {bool requirePrice = false}) {
    if (index < 0 || index >= _rows.length) return const [];
    final draft = _rows[index].toDraft();
    // One price for the package: a row has no price of its own, so none of
    // the price problems belong to it ([priceProblems] says them).
    if (isPackageMode) {
      return pieceErrors([draft])
          .where(
            (c) =>
                c != 'pieces_required' &&
                c != 'pieces_too_many' &&
                c != 'piece_price_invalid',
          )
          .toList();
    }
    return [
      ...pieceErrors([
        draft,
      ]).where((c) => c != 'pieces_required' && c != 'pieces_too_many'),
      if (requirePrice && draft['priceCents'] == null) 'piece_price_required',
    ];
  }

  /// "From the price list" picked something for piece [index]: its price is
  /// typed in (staff can still change it), and its description when it has
  /// none. Nothing else is stored.
  void applyFill(int index, PriceFill fill) {
    if (index < 0 || index >= _rows.length) return;
    final row = _rows[index];
    final price = invoiceCentsToInput(fill.priceCents);
    if (row.price.text != price) row.price.text = price;
    if (row.description.text.trim().isEmpty) {
      row.description.text = fill.description;
    }
    row.fillWeight = fill.weight;
    notifyListeners();
  }

  /// The weights "From the price list" asked for, added up; null when no
  /// piece was filled by weight.
  double? get filledWeightTotal =>
      sumFilledWeights([for (final row in _rows) row.fillWeight]);

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
    if (packagePrice.text.isNotEmpty) packagePrice.text = '';
    notifyListeners();
  }

  @override
  void dispose() {
    for (final row in [..._rows, ..._retired]) {
      row._dispose();
    }
    pickupFee.dispose();
    packagePrice.dispose();
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
    this.requirePrices = false,
    this.priceRoute,
    this.onPriceFilled,
  });

  final PiecesEditorController controller;

  /// The route the business priced for this package's country and ship mode
  /// (`PriceRoute.raw`): each piece then offers "From the price list". Null,
  /// or a route with nothing on it, offers nothing.
  final Map<String, dynamic>? priceRoute;

  /// Told after a piece was filled from the list (its index), so the sheet
  /// can fill the package weight of an air package.
  final void Function(int index, PriceFill fill)? onPriceFilled;

  /// Every piece must have a price typed in ($0 is allowed): a customer's
  /// package (docs/PACKAGE_PRICE_REQUIRED.md). The price fields are marked
  /// required and a blank one says so. Off for the business's own stock.
  final bool requirePrices;

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
              l10n.pcsPiecesTitle(controller.count),
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
                  number: controller.firstNumber(i),
                  maxCount: controller.maxCount(i),
                  onCount: (value) {
                    AppHaptics.selection();
                    controller.setCount(i, value);
                  },
                  onPriceFor: (priceFor) {
                    AppHaptics.selection();
                    controller.setPriceFor(i, priceFor);
                  },
                  removable: rows.length > 1 && enabled,
                  enabled: enabled,
                  requirePrice: requirePrices,
                  packageMode: controller.isPackageMode,
                  onFromList:
                      !controller.isPackageMode &&
                          priceFillAvailable(priceRoute)
                      ? () async {
                          final fill = await showPriceFillSheet(
                            context,
                            route: priceRoute!,
                          );
                          if (fill == null) return;
                          controller.applyFill(i, fill);
                          onPriceFilled?.call(i, fill);
                        }
                      : null,
                  errors: showErrors
                      ? [
                          for (final c in controller.errorsFor(
                            i,
                            requirePrice: requirePrices,
                          ))
                            describe(c),
                        ]
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
            if (controller.isPackageMode) ...[
              const SizedBox(height: AppSpacing.sm),
              _PackagePriceBlock(
                controller: controller,
                requirePrice: requirePrices,
                enabled: enabled,
                problem: showErrors
                    ? controller
                          .priceProblems(requirePrice: requirePrices)
                          .map(describe)
                          .firstOrNull
                    : null,
              ),
            ],
            if (controller.hasPickupFee) ...[
              const SizedBox(height: AppSpacing.sm),
              Align(
                alignment: Alignment.centerLeft,
                child: SizedBox(
                  width: 180,
                  child: TextField(
                    key: const Key('pieces-pickup-fee'),
                    controller: controller.pickupFee,
                    enabled: enabled,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    decoration: InputDecoration(
                      labelText: l10n.prqPickupFee,
                      prefixText: r'$ ',
                      isDense: true,
                      errorText: showErrors && controller.pickupFeeInvalid
                          ? l10n.prqErrPickupFee
                          : null,
                    ),
                  ),
                ),
              ),
            ],
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

/// The one price for everything, in package mode
/// (docs/PACKAGE_ONE_PRICE.md): the strongest thing in the editor. Its label
/// and the count of pieces it covers, the amount, and - on an edit whose
/// number of pieces changed - a note asking whether the price still holds.
class _PackagePriceBlock extends StatelessWidget {
  const _PackagePriceBlock({
    required this.controller,
    required this.requirePrice,
    required this.enabled,
    required this.problem,
  });

  final PiecesEditorController controller;
  final bool requirePrice;
  final bool enabled;

  /// What is wrong with the price, already in words; null for nothing.
  final String? problem;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final language = Localizations.localeOf(context).languageCode;
    final count = controller.count;
    final cents = controller.onePriceCents;
    final change = packagePieceCountChange(controller.savedCount, count);
    String? note;
    if (cents != null && change.added > 0) {
      note = l10n.ppmNoteAdded(
        change.added,
        formatLotCents(cents, language: language),
        count,
      );
    } else if (cents != null && change.removed > 0) {
      note = l10n.ppmNoteRemoved(
        change.removed,
        formatLotCents(cents, language: language),
        count,
      );
    }
    return Container(
      key: const Key('pieces-package-price-block'),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.mist,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(
          color: problem != null ? AppColors.errorRed : AppColors.cobalt,
          width: 1.5,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            requirePrice ? '${l10n.ppmPriceLabel} *' : l10n.ppmPriceLabel,
            key: const Key('pieces-package-price-label'),
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w800,
              color: AppColors.cobaltDeep,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            l10n.ppmCountLine(count),
            key: const Key('pieces-package-count'),
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.sm),
          Semantics(
            label: l10n.ppmPriceLabel,
            child: TextField(
              key: const Key('pieces-package-price'),
              controller: controller.packagePrice,
              enabled: enabled,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
              decoration: InputDecoration(
                prefixText: r'$ ',
                hintText: '0.00',
                filled: true,
                fillColor: AppColors.paper,
                errorText: problem,
                errorMaxLines: 2,
              ),
            ),
          ),
          if (note != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                note,
                key: const Key('pieces-package-note'),
                style: const TextStyle(
                  fontSize: 12.5,
                  height: 1.35,
                  fontWeight: FontWeight.w600,
                  color: AppColors.warn,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _PieceCard extends StatelessWidget {
  const _PieceCard({
    required this.index,
    required this.row,
    required this.number,
    required this.maxCount,
    required this.onCount,
    required this.onPriceFor,
    required this.removable,
    required this.enabled,
    required this.errors,
    required this.requirePrice,
    required this.packageMode,
    required this.onFromList,
    required this.onKind,
    required this.onRemove,
    required this.onOpenSize,
  });

  /// "From the price list", when the business priced this package's route.
  final VoidCallback? onFromList;

  final int index;
  final PieceDraftRow row;

  /// The number of the row's first piece, as its label will carry it.
  final int number;

  /// The most "How many" can be: what the package still has room for.
  final int maxCount;
  final ValueChanged<int> onCount;
  final ValueChanged<String> onPriceFor;
  final bool removable;
  final bool enabled;
  final List<String> errors;

  /// The price field is marked required (a customer's package).
  final bool requirePrice;

  /// One price for the whole package: the row has no price field and no
  /// "Each piece / All together" switch (docs/PACKAGE_ONE_PRICE.md).
  final bool packageMode;
  final ValueChanged<String> onKind;
  final VoidCallback onRemove;
  final VoidCallback onOpenSize;

  static final _decimal = FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'));

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final invalid = errors.isNotEmpty;
    final count = row.count;
    Widget step(String key, IconData icon, String label, VoidCallback? onTap) =>
        SizedBox(
          width: 44,
          height: 44,
          child: IconButton.outlined(
            key: Key('$key-$index'),
            onPressed: onTap,
            icon: Icon(icon, size: 20),
            tooltip: label,
          ),
        );
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
                constraints: const BoxConstraints(minWidth: 28),
                height: 28,
                padding: const EdgeInsets.symmetric(horizontal: 6),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.mist,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                ),
                child: Text(
                  // A row of several carries the numbers of its labels.
                  count > 1
                      ? l10n.pcsPieceNumbers(number, number + count - 1)
                      : '$number',
                  key: Key('piece-number-$index'),
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
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
              if (!packageMode) ...[
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
                      labelText: requirePrice
                          ? '${l10n.pcsPrice} *'
                          : l10n.pcsPrice,
                      prefixText: r'$ ',
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ],
          ),
          if (onFromList != null)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                key: Key('piece-from-list-$index'),
                onPressed: enabled ? onFromList : null,
                icon: const Icon(Icons.price_check, size: 16),
                label: Text(
                  l10n.pcsFromList,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  visualDensity: VisualDensity.compact,
                ),
              ),
            ),
          if (row.weight != null) ...[
            const SizedBox(height: AppSpacing.sm),
            Align(
              alignment: Alignment.centerLeft,
              child: SizedBox(
                width: 220,
                child: TextField(
                  key: Key('piece-weight-$index'),
                  controller: row.weight,
                  enabled: enabled,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  inputFormatters: [_decimal],
                  decoration: InputDecoration(
                    labelText: row.weightUnit == 'kg'
                        ? l10n.pplWeightKg
                        : l10n.pplWeightLb,
                    suffixText: row.weightUnit,
                    helperText: l10n.pplWeightHelper,
                    helperMaxLines: 2,
                    isDense: true,
                  ),
                ),
              ),
            ),
          ],
          // A piece weighed at Received is one piece: its weight is its own.
          if (row.weight == null) ...[
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.pcsHowMany,
                    style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                ),
                step(
                  'piece-fewer',
                  Icons.remove,
                  l10n.pcsFewer,
                  enabled && count > 1 ? () => onCount(count - 1) : null,
                ),
                // The number itself opens a box to type a larger one.
                InkWell(
                  key: Key('piece-count-$index'),
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                  onTap: !enabled
                      ? null
                      : () async {
                          final typed = await _askPieceCount(
                            context,
                            current: count,
                            max: maxCount,
                          );
                          if (typed != null) onCount(typed);
                        },
                  child: SizedBox(
                    width: 52,
                    height: 44,
                    child: Center(
                      child: Text(
                        '$count',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                          color: AppColors.ink,
                        ),
                      ),
                    ),
                  ),
                ),
                step(
                  'piece-more',
                  Icons.add,
                  l10n.pcsMore,
                  enabled && count < maxCount ? () => onCount(count + 1) : null,
                ),
              ],
            ),
          ],
          if (count > 1 && !packageMode) ...[
            const SizedBox(height: AppSpacing.sm),
            Semantics(
              label: l10n.pcsPriceFor,
              child: Row(
                children: [
                  Expanded(
                    child: _KindButton(
                      key: Key('piece-price-each-$index'),
                      label: l10n.pcsEachPiece,
                      selected: !row.pricedTogether,
                      onTap: enabled ? () => onPriceFor(priceForEach) : null,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: _KindButton(
                      key: Key('piece-price-all-$index'),
                      label: l10n.pcsAllTogether(count),
                      selected: row.pricedTogether,
                      onTap: enabled ? () => onPriceFor(priceForAll) : null,
                    ),
                  ),
                ],
              ),
            ),
            if (_rowSumText(l10n, row) case final sum?)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  sum,
                  key: Key('piece-row-sum-$index'),
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.muted,
                  ),
                ),
              ),
          ],
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

/// Under a row of several, what its price comes to. Priced each: "3 × $45.00
/// = $135.00". Priced together: "$50.00 each", or "2 at $66.67, 1 at $66.66"
/// when the amount does not divide. Null while no price can be read.
String? _rowSumText(AppLocalizations l10n, PieceDraftRow row) {
  final cents = row.priceCents;
  if (cents == null || row.count < 2) return null;
  if (!row.pricedTogether) {
    return l10n.pcsRowSumEach(
      row.count,
      formatLotCents(cents),
      formatLotCents(cents * row.count),
    );
  }
  final runs = rowShareRuns(cents, row.count);
  if (runs.length == 1) return l10n.pcsShareEach(formatLotCents(runs[0].cents));
  return l10n.pcsShareSplit(
    runs[0].count,
    formatLotCents(runs[0].cents),
    runs[1].count,
    formatLotCents(runs[1].cents),
  );
}

/// "How many pieces like this one?": a number typed instead of tapped up.
/// Above [pieceCountConfirmAbove] the box says how many labels that prints
/// before it is taken. Null when cancelled or nothing usable was typed.
Future<int?> _askPieceCount(
  BuildContext context, {
  required int current,
  required int max,
}) {
  return showDialog<int>(
    context: context,
    builder: (context) => _PieceCountDialog(current: current, max: max),
  );
}

class _PieceCountDialog extends StatefulWidget {
  const _PieceCountDialog({required this.current, required this.max});

  final int current;
  final int max;

  @override
  State<_PieceCountDialog> createState() => _PieceCountDialogState();
}

class _PieceCountDialogState extends State<_PieceCountDialog> {
  late final TextEditingController _field =
      TextEditingController(text: '${widget.current}')
        ..selection = TextSelection(
          baseOffset: 0,
          extentOffset: '${widget.current}'.length,
        );

  @override
  void dispose() {
    _field.dispose();
    super.dispose();
  }

  /// What was typed, when it is a count the package has room for.
  int? get _typed {
    final value = int.tryParse(_field.text.trim());
    return value != null && value >= 1 && value <= widget.max ? value : null;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final typed = _typed;
    return AlertDialog(
      title: Text(l10n.pcsHowManyTitle),
      content: TextField(
        key: const Key('piece-count-field'),
        controller: _field,
        autofocus: true,
        keyboardType: TextInputType.number,
        inputFormatters: [
          FilteringTextInputFormatter.digitsOnly,
          LengthLimitingTextInputFormatter(2),
        ],
        onChanged: (_) => setState(() {}),
        onSubmitted: (_) {
          if (_typed != null) Navigator.of(context).pop(_typed);
        },
        decoration: InputDecoration(
          // Said back before a large count is taken: 30 typed for 3 prints
          // 30 labels.
          helperText: typed != null && typed > pieceCountConfirmAbove
              ? l10n.pcsHowManyPrints(typed)
              : l10n.pcsHowManyUpTo(widget.max),
          errorText: typed == null && _field.text.trim().isNotEmpty
              ? l10n.pcsHowManyUpTo(widget.max)
              : null,
        ),
      ),
      actions: [
        TextButton(
          key: const Key('piece-count-cancel'),
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.cancel),
        ),
        TextButton(
          key: const Key('piece-count-done'),
          onPressed: typed == null
              ? null
              : () => Navigator.of(context).pop(typed),
          child: Text(l10n.done),
        ),
      ],
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
                    fontWeight: FontWeight.w700,
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
        final fee = controller.pickupFeeCents;
        final totalRow = Row(
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
                fontWeight: FontWeight.w700,
                color: total == null ? AppColors.muted : AppColors.cobaltDeep,
              ),
            ),
          ],
        );
        return Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.sm),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // A collected request's pickup fee, its own row: it is inside
              // the total, never inside a piece price.
              if (controller.hasPickupFee && fee > 0)
                Padding(
                  padding: const EdgeInsets.only(bottom: 2),
                  child: Row(
                    key: const Key('pieces-pickup-fee-row'),
                    children: [
                      Expanded(
                        child: Text(
                          l10n.prqPickupFee,
                          style: const TextStyle(
                            fontSize: 13,
                            color: AppColors.muted,
                          ),
                        ),
                      ),
                      Text(
                        formatLotCents(fee),
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
              totalRow,
            ],
          ),
        );
      },
    );
  }
}
