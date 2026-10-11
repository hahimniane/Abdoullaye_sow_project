/// Inventory, app side: products a shop keeps, the QR tag on each, and the
/// sales staff ring up at the counter by scanning tags.
///
/// The callables are the authority (`docs/INVENTORY.md`: `createInventoryItem`,
/// `recordInventorySale`, `voidInventorySale`...). This module is the pure half
/// the screens use, so a bad entry is refused before the round trip and a
/// basket adds up the same way the server will: tag-link parsing, the product
/// and sale models, the basket (a repeat scan adds one, a price can be
/// changed per line, totals and discount), request builders for every
/// callable, and how a failure reads. No Firebase here, so all of it is
/// unit-tested without a camera or a network.
///
/// Money is integer cents end to end (the server caps it like invoices).
library;

import '../utils/callable_data.dart';
import '../utils/money_input.dart';
import 'invoice_ledger.dart' show invoiceCentsToInput, invoicePaymentMethods;
import 'lot_ledger.dart' show lotDateOf;
import 'package_codes.dart' show packageLinkHost, packageTrackingAlphabet;

// ---------------------------------------------------------------------------
// Limits. Cents mirror the invoice cap; the quantities are what a counter can
// reasonably key, kept well inside the server's integers.
// ---------------------------------------------------------------------------

const inventoryMaxCents = 100000000;
const inventoryMaxStock = 1000000;
const inventoryMaxSaleQuantity = 9999;
const inventoryMaxName = 120;
const inventoryMaxCategory = 60;
const inventoryMaxPhotoUrl = 500;
const inventoryMaxNote = 200;
const inventoryMinTagCopies = 1;
const inventoryMaxTagCopies = 500;

/// The payment methods a sale can be recorded with: the invoice list, so a
/// counter sale and an invoice payment read the same.
const inventoryPaymentMethods = invoicePaymentMethods;

// ---------------------------------------------------------------------------
// Tag codes: "IT-K7M4P2" and the link a tag's QR holds.
// ---------------------------------------------------------------------------

/// Product codes carry the IT prefix (`IT-` + 6 characters of the reduced
/// alphabet shared with package codes).
const inventoryCodePrefix = 'IT';

/// The path a product tag's link lives under: `/i/<code>`.
const inventoryLinkSegment = 'i';

final RegExp _itemCode =
    RegExp('^$inventoryCodePrefix([$packageTrackingAlphabet]{6})\$');

/// [raw] - a QR payload, a typed code, a pasted link - as "IT-XXXXXX", or
/// null when it holds no product code.
///
/// Accepts "IT-K7M4P2", "it k7m4p2", "ITK7M4P2" and the tag's link
/// `https://customer.laawoldigital.com/i/IT-K7M4P2` (scheme optional). A link
/// to any other site, or to another Laawol path, is refused: a QR on someone
/// else's product is not ours to read. The short alphabet has no 0, O, 1, I or
/// L, so "IT-K7M4P0" is null.
String? inventoryCodeFromScan(String? raw) {
  final text = (raw ?? '').trim();
  if (text.isEmpty) return null;
  final lower = text.toLowerCase();
  final hasScheme = lower.startsWith('http://') || lower.startsWith('https://');
  if (hasScheme || lower.startsWith('$packageLinkHost/')) {
    final uri = Uri.tryParse(hasScheme ? text : 'https://$text');
    return inventoryCodeFromLink(uri);
  }
  if (text.contains('/') || text.contains('?')) return null;
  return _normalizeItemCode(text);
}

/// The code an incoming app link carries, or null when it is not a product
/// tag link: only the Laawol host, only `/i/<code>`.
String? inventoryCodeFromLink(Uri? uri) {
  if (uri == null) return null;
  final scheme = uri.scheme.toLowerCase();
  if (scheme != 'https' && scheme != 'http') return null;
  if (uri.host.toLowerCase() != packageLinkHost) return null;
  final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  if (segments.length != 2 ||
      segments.first.toLowerCase() != inventoryLinkSegment) {
    return null;
  }
  return _normalizeItemCode(segments[1]);
}

String? _normalizeItemCode(String value) {
  final stripped = value.toUpperCase().replaceAll(RegExp('[^A-Z0-9]'), '');
  final match = _itemCode.firstMatch(stripped);
  return match == null ? null : '$inventoryCodePrefix-${match.group(1)}';
}

/// The camera sees the same tag on every frame; this lets one scan through
/// and holds the same code back for [cooldown], so holding a tag still adds
/// one, while moving to another tag (or the same tag after a pause) adds
/// again.
class ScanDebouncer {
  ScanDebouncer({this.cooldown = const Duration(milliseconds: 1800)});

  final Duration cooldown;
  String _last = '';
  DateTime _at = DateTime.fromMillisecondsSinceEpoch(0);

  /// Whether [code] seen at [now] counts as a new scan.
  bool accept(String code, DateTime now) {
    if (code == _last && now.difference(_at) < cooldown) return false;
    _last = code;
    _at = now;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Who may use it.
// ---------------------------------------------------------------------------

/// The Inventory section shows only when the business has the service on
/// AND this person holds the inventory permission AND there is a business to
/// look in. Both gates, like Car transport.
bool inventoryAvailable({
  required Iterable<String> services,
  required bool hasPermission,
  required String businessId,
}) =>
    services.contains('inventory') &&
    hasPermission &&
    businessId.trim().isNotEmpty;

// ---------------------------------------------------------------------------
// Models. Read from Firestore documents; every write is a callable.
// ---------------------------------------------------------------------------

String _text(Object? value, [int max = 200]) {
  if (value == null) return '';
  final text = value.toString().trim();
  return text.length > max ? text.substring(0, max) : text;
}

int _int(Object? value) {
  if (value is num && value.isFinite) return value.round();
  if (value is String) return int.tryParse(value.trim()) ?? 0;
  return 0;
}

int? _optionalInt(Object? value) {
  if (value == null) return null;
  if (value is num && value.isFinite) return value.round();
  if (value is String) return int.tryParse(value.trim());
  return null;
}

/// How a product's count stands: fine, running low, or none left.
enum InventoryStock { ok, low, out }

/// Low when `quantity <= lowStockAt`, and always when the count is zero.
InventoryStock stockStatus({required int quantity, int? lowStockAt}) {
  if (quantity <= 0) return InventoryStock.out;
  if (lowStockAt != null && quantity <= lowStockAt) return InventoryStock.low;
  return InventoryStock.ok;
}

class InventoryItem {
  const InventoryItem({
    required this.id,
    required this.businessId,
    required this.name,
    required this.code,
    required this.priceCents,
    this.costCents,
    this.quantity = 0,
    this.lowStockAt,
    this.category = '',
    this.photoUrl = '',
    this.archived = false,
    this.countWasOff = false,
    this.createdAt,
    this.updatedAt,
    this.createdByStaffId = '',
  });

  factory InventoryItem.fromMap(String id, Map<String, dynamic> data) =>
      InventoryItem(
        id: id,
        businessId: _text(data['businessId'], 128),
        name: _text(data['name'], inventoryMaxName),
        code: _text(data['code'], 20).toUpperCase(),
        priceCents: _int(data['priceCents']),
        costCents: _optionalInt(data['costCents']),
        quantity: _int(data['quantity']) < 0 ? 0 : _int(data['quantity']),
        lowStockAt: _optionalInt(data['lowStockAt']),
        category: _text(data['category'], inventoryMaxCategory),
        photoUrl: _text(data['photoUrl'], inventoryMaxPhotoUrl),
        archived: data['archived'] == true,
        countWasOff: data['countWasOff'] == true,
        createdAt: lotDateOf(data['createdAt']),
        updatedAt: lotDateOf(data['updatedAt']),
        createdByStaffId: _text(data['createdByStaffId'], 128),
      );

  final String id;
  final String businessId;
  final String name;
  final String code;
  final int priceCents;
  final int? costCents;
  final int quantity;
  final int? lowStockAt;
  final String category;
  final String photoUrl;
  final bool archived;
  final bool countWasOff;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final String createdByStaffId;

  InventoryStock get stock =>
      stockStatus(quantity: quantity, lowStockAt: lowStockAt);

  /// Low includes none left.
  bool get isLow => stock != InventoryStock.ok;

  /// Worth a look: low, or a count that a sale found wrong.
  bool get needsAttention => !archived && (isLow || countWasOff);
}

class InventorySaleLine {
  const InventorySaleLine({
    required this.itemId,
    required this.name,
    required this.code,
    required this.quantity,
    required this.listPriceCents,
    required this.soldPriceCents,
    this.costCents,
    this.countWasOff = false,
  });

  factory InventorySaleLine.fromMap(Map<String, dynamic> data) =>
      InventorySaleLine(
        itemId: _text(data['itemId'], 128),
        name: _text(data['name'], inventoryMaxName),
        code: _text(data['code'], 20).toUpperCase(),
        quantity: _int(data['quantity']),
        listPriceCents: _int(data['listPriceCents']),
        soldPriceCents: _int(data['soldPriceCents']),
        costCents: _optionalInt(data['costCents']),
        countWasOff: data['countWasOff'] == true,
      );

  final String itemId;
  final String name;
  final String code;
  final int quantity;
  final int listPriceCents;
  final int soldPriceCents;
  final int? costCents;
  final bool countWasOff;

  int get totalCents => quantity * soldPriceCents;

  /// What was given off the list price on this line (never negative).
  int get discountCents {
    final off = listPriceCents - soldPriceCents;
    return off > 0 ? off * quantity : 0;
  }

  bool get priceChanged => listPriceCents != soldPriceCents;
}

class InventorySale {
  const InventorySale({
    required this.id,
    required this.businessId,
    required this.lines,
    required this.totalCents,
    required this.paymentMethod,
    required this.soldByStaffId,
    this.clientRequestId = '',
    this.voided = false,
    this.voidedByStaffId = '',
    this.voidedAt,
    this.createdAt,
  });

  factory InventorySale.fromMap(String id, Map<String, dynamic> data) {
    final rawLines = data['lines'];
    final lines = [
      if (rawLines is Iterable)
        for (final line in rawLines)
          if (line is Map) InventorySaleLine.fromMap(callableMap(line)),
    ];
    return InventorySale(
      id: id,
      businessId: _text(data['businessId'], 128),
      lines: lines,
      totalCents: _int(data['totalCents']),
      paymentMethod: _text(data['paymentMethod'], 40),
      soldByStaffId: _text(data['soldByStaffId'], 128),
      clientRequestId: _text(data['clientRequestId'], 128),
      voided: data['voided'] == true,
      voidedByStaffId: _text(data['voidedByStaffId'], 128),
      voidedAt: lotDateOf(data['voidedAt']),
      createdAt: lotDateOf(data['createdAt']),
    );
  }

  final String id;
  final String businessId;
  final List<InventorySaleLine> lines;
  final int totalCents;
  final String paymentMethod;
  final String soldByStaffId;
  final String clientRequestId;
  final bool voided;
  final String voidedByStaffId;
  final DateTime? voidedAt;
  final DateTime? createdAt;

  int get itemCount => lines.fold(0, (sum, line) => sum + line.quantity);
  int get discountCents =>
      lines.fold(0, (sum, line) => sum + line.discountCents);
  bool get hadCountWasOff => lines.any((line) => line.countWasOff);
}

/// The kinds of stock movement the server records.
const inventoryMovementTypes = ['initial', 'add', 'set', 'sale', 'void'];

class InventoryMovement {
  const InventoryMovement({
    required this.id,
    required this.itemId,
    required this.type,
    required this.delta,
    required this.quantityAfter,
    this.byStaffId = '',
    this.note = '',
    this.saleId = '',
    this.createdAt,
  });

  factory InventoryMovement.fromMap(String id, Map<String, dynamic> data) =>
      InventoryMovement(
        id: id,
        itemId: _text(data['itemId'], 128),
        type: _text(data['type'], 20),
        delta: _int(data['delta']),
        quantityAfter: _int(data['quantityAfter']),
        byStaffId: _text(data['byStaffId'], 128),
        note: _text(data['note'], inventoryMaxNote),
        saleId: _text(data['saleId'], 128),
        createdAt: lotDateOf(data['createdAt']),
      );

  final String id;
  final String itemId;
  final String type;
  final int delta;
  final int quantityAfter;
  final String byStaffId;
  final String note;
  final String saleId;
  final DateTime? createdAt;
}

/// Newest first; movements with no time sink to the end.
List<InventoryMovement> sortMovementsNewestFirst(
  Iterable<InventoryMovement> movements,
) =>
    movements.toList()
      ..sort((a, b) {
        final x = a.createdAt, y = b.createdAt;
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return y.compareTo(x);
      });

List<InventorySale> sortSalesNewestFirst(Iterable<InventorySale> sales) =>
    sales.toList()
      ..sort((a, b) {
        final x = a.createdAt, y = b.createdAt;
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return y.compareTo(x);
      });

// ---------------------------------------------------------------------------
// Listing: low stock first, search, archived.
// ---------------------------------------------------------------------------

/// What the products list shows: the active products, or - with
/// [showArchived] - only the archived ones. Low stock and counts that were off
/// come first, then by name.
List<InventoryItem> inventoryListing(
  Iterable<InventoryItem> items, {
  String query = '',
  bool showArchived = false,
}) {
  final matched = [
    for (final item in items)
      if (item.archived == showArchived && inventoryItemMatches(item, query))
        item,
  ];
  matched.sort((a, b) {
    if (a.needsAttention != b.needsAttention) {
      return a.needsAttention ? -1 : 1;
    }
    return a.name.toLowerCase().compareTo(b.name.toLowerCase());
  });
  return matched;
}

/// Name, category or code (the code with or without its dash, any case).
bool inventoryItemMatches(InventoryItem item, String query) {
  final text = query.trim().toLowerCase();
  if (text.isEmpty) return true;
  final compact = text.replaceAll(RegExp('[^a-z0-9]'), '');
  return item.name.toLowerCase().contains(text) ||
      item.category.toLowerCase().contains(text) ||
      item.code.toLowerCase().contains(text) ||
      (compact.length >= 2 &&
          item.code.toLowerCase().replaceAll('-', '').contains(compact));
}

/// The "tag will not scan" fallback: active products matching [query], the
/// closest few. Two characters at least, so a stray letter lists nothing.
List<InventoryItem> inventorySellSearch(
  Iterable<InventoryItem> items,
  String query, {
  int limit = 8,
}) {
  if (query.trim().length < 2) return const [];
  final hits = inventoryListing(items, query: query)
      .where((item) => !item.archived)
      .toList();
  return hits.length > limit ? hits.sublist(0, limit) : hits;
}

// ---------------------------------------------------------------------------
// The basket.
// ---------------------------------------------------------------------------

class BasketLine {
  const BasketLine({
    required this.item,
    this.quantity = 1,
    this.priceOverrideCents,
  });

  /// The product as last seen (kept current by [Basket.refreshed]).
  final InventoryItem item;
  final int quantity;

  /// A price typed for this sale only; null sells at the list price.
  final int? priceOverrideCents;

  int get listPriceCents => item.priceCents;
  int get soldPriceCents => priceOverrideCents ?? item.priceCents;
  bool get priceChanged => soldPriceCents != listPriceCents;
  int get totalCents => quantity * soldPriceCents;

  /// What this line gives off the list price (never negative).
  int get discountCents {
    final off = listPriceCents - soldPriceCents;
    return off > 0 ? off * quantity : 0;
  }

  /// Selling more than the count says is allowed - the count floors at zero
  /// and the sale reports "count was off" - so this is a heads-up, not a stop.
  bool get exceedsCount => quantity > item.quantity;

  BasketLine copyWith({
    InventoryItem? item,
    int? quantity,
    int? priceOverrideCents,
    bool clearPrice = false,
  }) =>
      BasketLine(
        item: item ?? this.item,
        quantity: quantity ?? this.quantity,
        priceOverrideCents:
            clearPrice ? null : (priceOverrideCents ?? this.priceOverrideCents),
      );
}

/// What is about to be sold. Immutable: every change answers a new basket.
class Basket {
  const Basket([this.lines = const []]);

  final List<BasketLine> lines;

  bool get isEmpty => lines.isEmpty;
  bool get isNotEmpty => lines.isNotEmpty;

  /// Pieces in the basket (sum of quantities).
  int get itemCount => lines.fold(0, (sum, line) => sum + line.quantity);
  int get totalCents => lines.fold(0, (sum, line) => sum + line.totalCents);
  int get discountCents =>
      lines.fold(0, (sum, line) => sum + line.discountCents);

  BasketLine? lineFor(String itemId) {
    for (final line in lines) {
      if (line.item.id == itemId) return line;
    }
    return null;
  }

  /// A scan: a product not in the basket joins with quantity 1; one already
  /// there gains [by] (1 for a repeat scan). The product snapshot is the
  /// newest one.
  Basket addScan(InventoryItem item, {int by = 1}) {
    final existing = lineFor(item.id);
    if (existing == null) {
      return Basket([...lines, BasketLine(item: item)]);
    }
    return _replace(
      item.id,
      existing.copyWith(
        item: item,
        quantity: _clampQuantity(existing.quantity + by),
      ),
    );
  }

  /// Sets a line's quantity, kept between 1 and the most a sale line takes.
  Basket withQuantity(String itemId, int quantity) {
    final line = lineFor(itemId);
    if (line == null) return this;
    return _replace(itemId, line.copyWith(quantity: _clampQuantity(quantity)));
  }

  /// Sets this sale's price for a line. Typing the list price back clears the
  /// override, so "changed" always means different from the list.
  Basket withPrice(String itemId, int cents) {
    final line = lineFor(itemId);
    if (line == null) return this;
    if (cents == line.listPriceCents) {
      return _replace(itemId, line.copyWith(clearPrice: true));
    }
    return _replace(itemId, line.copyWith(priceOverrideCents: cents));
  }

  Basket withoutLine(String itemId) =>
      Basket([for (final line in lines) if (line.item.id != itemId) line]);

  /// The same basket with each product replaced by its newest snapshot.
  Basket refreshed(Iterable<InventoryItem> items) {
    final byId = {for (final item in items) item.id: item};
    return Basket([
      for (final line in lines)
        byId[line.item.id] == null
            ? line
            : line.copyWith(item: byId[line.item.id]),
    ]);
  }

  Basket _replace(String itemId, BasketLine next) => Basket([
        for (final line in lines) line.item.id == itemId ? next : line,
      ]);

  /// Why this basket cannot be sold yet, as codes: `basket_empty`,
  /// `item_archived`, `price_too_large`, `total_too_large`.
  List<String> get problems {
    final codes = <String>[];
    if (lines.isEmpty) codes.add('basket_empty');
    if (lines.any((line) => line.item.archived)) codes.add('item_archived');
    if (lines.any((line) =>
        line.soldPriceCents < 0 || line.soldPriceCents > inventoryMaxCents)) {
      codes.add('price_too_large');
    }
    if (lines.any((line) => line.totalCents > inventoryMaxCents) ||
        totalCents > inventoryMaxCents) {
      codes.add('total_too_large');
    }
    return codes;
  }

  /// What identifies this sale for retry safety: the same lines, quantities,
  /// prices and nothing else give the same signature.
  String get signature => [
        for (final line in lines)
          '${line.item.id}x${line.quantity}@${line.soldPriceCents}',
      ].join('|');
}

int _clampQuantity(int quantity) => quantity < 1
    ? 1
    : (quantity > inventoryMaxSaleQuantity
        ? inventoryMaxSaleQuantity
        : quantity);

/// Keeps one `clientRequestId` for as long as a sale being retried is the
/// same sale: a network failure retries with the same id (the server then
/// answers with the same sale, never a second one), while a changed basket
/// or payment method is a different sale and gets a fresh id.
class SaleAttempt {
  SaleAttempt({required this.newId});

  final String Function() newId;
  String _signature = '';
  String _id = '';

  /// The id to send for [basket] paid by [paymentMethod].
  String idFor(Basket basket, String paymentMethod) {
    final signature = '${basket.signature}#$paymentMethod';
    if (_id.isEmpty || signature != _signature) {
      _id = newId();
      _signature = signature;
    }
    return _id;
  }

  /// After a sale went through, the next one starts clean.
  void clear() {
    _id = '';
    _signature = '';
  }
}

// ---------------------------------------------------------------------------
// The product form.
// ---------------------------------------------------------------------------

/// What the product form holds, as typed.
class InventoryItemDraft {
  const InventoryItemDraft({
    this.name = '',
    this.price = '',
    this.cost = '',
    this.quantity = '',
    this.lowStockAt = '',
    this.category = '',
    this.photoUrl = '',
  });

  factory InventoryItemDraft.fromItem(InventoryItem item) => InventoryItemDraft(
        name: item.name,
        price: invoiceCentsToInput(item.priceCents),
        cost: item.costCents == null ? '' : invoiceCentsToInput(item.costCents!),
        quantity: '${item.quantity}',
        lowStockAt: item.lowStockAt == null ? '' : '${item.lowStockAt}',
        category: item.category,
        photoUrl: item.photoUrl,
      );

  final String name;
  final String price;
  final String cost;
  final String quantity;
  final String lowStockAt;
  final String category;
  final String photoUrl;
}

final RegExp _wholeNumber = RegExp(r'^\d+$');

/// A typed whole count, null when blank or not a whole number.
int? readWholeNumber(String raw) {
  final text = raw.trim();
  if (!_wholeNumber.hasMatch(text) || text.length > 9) return null;
  return int.parse(text);
}

/// Whether [raw] is a usable photo link: http or https with a host.
bool inventoryPhotoUrlValid(String raw) {
  final uri = Uri.tryParse(raw.trim());
  return uri != null &&
      (uri.scheme == 'https' || uri.scheme == 'http') &&
      uri.host.contains('.');
}

/// The product form's refusals as codes: `name_required`, `name_too_long`,
/// `price_invalid`, `cost_invalid`, `quantity_invalid`, `low_stock_invalid`,
/// `photo_invalid`. The quantity is only asked for when [creating] - a count
/// changes through stock adjustments, never through editing.
List<String> validateInventoryItemDraft(
  InventoryItemDraft draft, {
  required bool creating,
}) {
  final codes = <String>[];
  final name = draft.name.trim();
  if (name.isEmpty) {
    codes.add('name_required');
  } else if (name.length > inventoryMaxName) {
    codes.add('name_too_long');
  }
  final price = readMoneyInput(draft.price).cents;
  if (price == null || price <= 0 || price > inventoryMaxCents) {
    codes.add('price_invalid');
  }
  final costRead = readMoneyInput(draft.cost);
  if (!costRead.isEmpty) {
    final cost = costRead.cents;
    if (cost == null || cost < 0 || cost > inventoryMaxCents) {
      codes.add('cost_invalid');
    }
  }
  if (creating) {
    final quantity = readWholeNumber(draft.quantity);
    if (quantity == null || quantity > inventoryMaxStock) {
      codes.add('quantity_invalid');
    }
  }
  if (draft.lowStockAt.trim().isNotEmpty) {
    final low = readWholeNumber(draft.lowStockAt);
    if (low == null || low > inventoryMaxStock) codes.add('low_stock_invalid');
  }
  final photo = draft.photoUrl.trim();
  if (photo.isNotEmpty &&
      (photo.length > inventoryMaxPhotoUrl || !inventoryPhotoUrlValid(photo))) {
    codes.add('photo_invalid');
  }
  return codes;
}

/// A stock adjustment typed in the add-stock / set-count sheet:
/// `quantity_invalid` for anything but a whole number (add needs at least 1).
List<String> validateStockAdjustment(String raw, {required bool adding}) {
  final quantity = readWholeNumber(raw);
  if (quantity == null || quantity > inventoryMaxStock) {
    return const ['quantity_invalid'];
  }
  if (adding && quantity < 1) return const ['quantity_invalid'];
  return const [];
}

/// A typed per-line price: dollars and cents, zero allowed (a giveaway),
/// never negative or beyond the cap. Null when unusable.
int? readSoldPrice(String raw) {
  final cents = readMoneyInput(raw).cents;
  if (cents == null || cents < 0 || cents > inventoryMaxCents) return null;
  return cents;
}

// ---------------------------------------------------------------------------
// Request builders: the payload of each callable, so a screen never spells a
// field and a test can read what would be sent.
// ---------------------------------------------------------------------------

/// `createInventoryItem`. Call only after [validateInventoryItemDraft] is clean.
Map<String, Object?> createInventoryItemRequest(
  String businessId,
  InventoryItemDraft draft,
) {
  final cost = readMoneyInput(draft.cost).cents;
  final low = readWholeNumber(draft.lowStockAt);
  final category = draft.category.trim();
  final photo = draft.photoUrl.trim();
  return {
    'businessId': businessId,
    'name': draft.name.trim(),
    'priceCents': readMoneyInput(draft.price).cents ?? 0,
    'costCents': ?cost,
    'quantity': readWholeNumber(draft.quantity) ?? 0,
    'lowStockAt': ?low,
    if (category.isNotEmpty) 'category': category,
    if (photo.isNotEmpty) 'photoUrl': photo,
  };
}

/// `updateInventoryItem`: only what changed against [existing]. A cleared cost
/// or low-stock level goes as an explicit null, a cleared category or photo as
/// an empty string. The count is never part of it.
Map<String, Object?> updateInventoryItemRequest(
  String businessId,
  InventoryItem existing,
  InventoryItemDraft draft,
) {
  final price = readMoneyInput(draft.price).cents ?? existing.priceCents;
  final costRead = readMoneyInput(draft.cost);
  final cost = costRead.isEmpty ? null : costRead.cents;
  final low = draft.lowStockAt.trim().isEmpty
      ? null
      : readWholeNumber(draft.lowStockAt);
  final name = draft.name.trim();
  final category = draft.category.trim();
  final photo = draft.photoUrl.trim();
  return {
    'businessId': businessId,
    'itemId': existing.id,
    if (name != existing.name) 'name': name,
    if (price != existing.priceCents) 'priceCents': price,
    if (cost != existing.costCents) 'costCents': cost,
    if (low != existing.lowStockAt) 'lowStockAt': low,
    if (category != existing.category) 'category': category,
    if (photo != existing.photoUrl) 'photoUrl': photo,
  };
}

/// Whether [updateInventoryItemRequest] would change anything.
bool inventoryUpdateIsEmpty(Map<String, Object?> request) =>
    request.keys.every((key) => key == 'businessId' || key == 'itemId');

/// `adjustInventoryStock`: `add` puts more on the shelf, `set` corrects the
/// count (and clears "count was off").
Map<String, Object?> adjustInventoryStockRequest({
  required String businessId,
  required String itemId,
  required bool add,
  required int quantity,
  String note = '',
}) {
  final cleanNote = note.trim();
  return {
    'businessId': businessId,
    'itemId': itemId,
    'mode': add ? 'add' : 'set',
    'quantity': quantity,
    if (cleanNote.isNotEmpty)
      'note': cleanNote.length > inventoryMaxNote
          ? cleanNote.substring(0, inventoryMaxNote)
          : cleanNote,
  };
}

Map<String, Object?> archiveInventoryItemRequest(
  String businessId,
  String itemId, {
  required bool archived,
}) =>
    {'businessId': businessId, 'itemId': itemId, 'archived': archived};

/// `deleteInventoryItem` refuses without `confirm: true`; the screen only
/// builds this after the person has confirmed.
Map<String, Object?> deleteInventoryItemRequest(
  String businessId,
  String itemId,
) =>
    {'businessId': businessId, 'itemId': itemId, 'confirm': true};

/// `recordInventorySale`: one line per product, the price actually charged.
Map<String, Object?> recordInventorySaleRequest({
  required String businessId,
  required String clientRequestId,
  required String paymentMethod,
  required Basket basket,
}) =>
    {
      'businessId': businessId,
      'clientRequestId': clientRequestId,
      'paymentMethod': inventoryPaymentMethods.contains(paymentMethod)
          ? paymentMethod
          : 'other',
      'lines': [
        for (final line in basket.lines)
          {
            'itemId': line.item.id,
            'quantity': line.quantity,
            'soldPriceCents': line.soldPriceCents,
          },
      ],
    };

Map<String, Object?> voidInventorySaleRequest(
  String businessId,
  String saleId, {
  String reason = '',
}) {
  final clean = reason.trim();
  return {
    'businessId': businessId,
    'saleId': saleId,
    if (clean.isNotEmpty) 'reason': clean,
  };
}

/// `getInventoryLabelsUrl`: N copies of the SAME code, 1..500.
Map<String, Object?> inventoryLabelsRequest(
  String businessId,
  String itemId,
  int copies,
) =>
    {
      'businessId': businessId,
      'itemId': itemId,
      'copies': copies < inventoryMinTagCopies
          ? inventoryMinTagCopies
          : (copies > inventoryMaxTagCopies ? inventoryMaxTagCopies : copies),
    };

/// A tag-copies entry: a whole number from 1 to 500, else null.
int? readTagCopies(String raw) {
  final copies = readWholeNumber(raw);
  if (copies == null ||
      copies < inventoryMinTagCopies ||
      copies > inventoryMaxTagCopies) {
    return null;
  }
  return copies;
}

/// `getInventorySummary`: [range] is `today` or `month`; [timeZone] is the
/// IANA name the server uses to find where "today" starts.
Map<String, Object?> inventorySummaryRequest(
  String businessId, {
  String range = 'today',
  required String timeZone,
}) =>
    {
      'businessId': businessId,
      'range': range == 'month' ? 'month' : 'today',
      'timeZone': timeZone,
    };

/// An IANA zone name for the phone's clock. Dart reports an abbreviation and
/// an offset, not the zone, so the US zones are named from their
/// abbreviation (the shop's own hours) and anything else falls back to a
/// fixed-offset `Etc/GMT` zone for whole-hour offsets - always valid, and
/// right for the day boundary except across a daylight-saving change. Blank
/// (the server then uses UTC) when the offset has no whole-hour zone.
String inventoryTimeZoneName(DateTime now) {
  const byAbbreviation = {
    'EST': 'America/New_York',
    'EDT': 'America/New_York',
    'CST': 'America/Chicago',
    'CDT': 'America/Chicago',
    'MST': 'America/Denver',
    'MDT': 'America/Denver',
    'PST': 'America/Los_Angeles',
    'PDT': 'America/Los_Angeles',
    'AKST': 'America/Anchorage',
    'AKDT': 'America/Anchorage',
    'HST': 'Pacific/Honolulu',
    'UTC': 'UTC',
  };
  final named = byAbbreviation[now.timeZoneName.toUpperCase()];
  if (named != null) return named;
  final offset = now.timeZoneOffset;
  if (offset.inMinutes % 60 != 0) return '';
  final hours = offset.inHours;
  if (hours == 0) return 'UTC';
  if (hours < -12 || hours > 14) return '';
  // POSIX-style names read backwards: UTC+5 is "Etc/GMT-5".
  return hours > 0 ? 'Etc/GMT-$hours' : 'Etc/GMT+${-hours}';
}

// ---------------------------------------------------------------------------
// Answers from the callables.
// ---------------------------------------------------------------------------

/// A warning a sale came back with: today only `count_was_off`.
class InventorySaleWarning {
  const InventorySaleWarning({required this.itemId, required this.reason});

  final String itemId;
  final String reason;

  bool get isCountWasOff => reason == 'count_was_off';
}

class InventorySaleResult {
  const InventorySaleResult({
    required this.saleId,
    required this.totalCents,
    this.warnings = const [],
  });

  /// Reads `{saleId, totalCents, warnings:[{itemId, reason}]}`; null when
  /// there is no sale id (the answer is not a recorded sale).
  static InventorySaleResult? fromCallable(Object? data) {
    final map = callableMap(data);
    final saleId = _text(map['saleId'], 128);
    if (saleId.isEmpty) return null;
    final rawWarnings = map['warnings'];
    return InventorySaleResult(
      saleId: saleId,
      totalCents: _int(map['totalCents']),
      warnings: [
        if (rawWarnings is Iterable)
          for (final w in rawWarnings)
            if (w is Map)
              InventorySaleWarning(
                itemId: _text(w['itemId'], 128),
                reason: _text(w['reason'], 40),
              ),
      ],
    );
  }

  final String saleId;
  final int totalCents;
  final List<InventorySaleWarning> warnings;

  /// The products whose count a sale found wrong.
  List<String> get countWasOffItemIds => [
        for (final w in warnings)
          if (w.isCountWasOff) w.itemId,
      ];
}

class InventoryBestSeller {
  const InventoryBestSeller({
    required this.itemId,
    required this.name,
    required this.quantity,
    required this.revenueCents,
  });

  final String itemId;
  final String name;
  final int quantity;
  final int revenueCents;
}

class InventoryLowStock {
  const InventoryLowStock({
    required this.itemId,
    required this.name,
    required this.quantity,
    this.lowStockAt,
  });

  final String itemId;
  final String name;
  final int quantity;
  final int? lowStockAt;
}

class InventorySummary {
  const InventorySummary({
    this.salesCount = 0,
    this.itemsSold = 0,
    this.revenueCents = 0,
    this.costCents = 0,
    this.profitCents = 0,
    this.discountCents = 0,
    this.best = const [],
    this.low = const [],
    this.countWasOff = const [],
  });

  /// Reads `getInventorySummary`'s answer; an unreadable answer is an empty
  /// summary, never a crash.
  factory InventorySummary.fromCallable(Object? data) {
    final map = callableMap(data);
    List<Map<String, dynamic>> rows(String key) {
      final raw = map[key];
      return [
        if (raw is Iterable)
          for (final row in raw)
            if (row is Map) callableMap(row),
      ];
    }

    return InventorySummary(
      salesCount: _int(map['salesCount']),
      itemsSold: _int(map['itemsSold']),
      revenueCents: _int(map['revenueCents']),
      costCents: _int(map['costCents']),
      profitCents: _int(map['profitCents']),
      discountCents: _int(map['discountCents']),
      best: [
        for (final row in rows('best'))
          InventoryBestSeller(
            itemId: _text(row['itemId'], 128),
            name: _text(row['name'], inventoryMaxName),
            quantity: _int(row['quantity']),
            revenueCents: _int(row['revenueCents']),
          ),
      ],
      low: [
        for (final row in rows('low'))
          InventoryLowStock(
            itemId: _text(row['itemId'], 128),
            name: _text(row['name'], inventoryMaxName),
            quantity: _int(row['quantity']),
            lowStockAt: _optionalInt(row['lowStockAt']),
          ),
      ],
      countWasOff: [
        for (final row in rows('countWasOff'))
          (itemId: _text(row['itemId'], 128), name: _text(row['name'], inventoryMaxName)),
      ],
    );
  }

  final int salesCount;
  final int itemsSold;
  final int revenueCents;
  final int costCents;
  final int profitCents;
  final int discountCents;
  final List<InventoryBestSeller> best;
  final List<InventoryLowStock> low;
  final List<({String itemId, String name})> countWasOff;
}

// ---------------------------------------------------------------------------
// When a call fails.
// ---------------------------------------------------------------------------

/// Why a callable did not go through, as far as the app can tell.
enum InventoryFailure {
  /// No connection (or too slow): nothing was lost, try again. There is no
  /// offline queue - the basket stays and the sale is retried.
  network,
  itemArchived,
  itemNotFound,
  saleVoided,
  noPermission,
  invalid,
  unknown,
}

/// Reads a failure from the parts of a `FirebaseFunctionsException`: its
/// [code], `details.reason` (the codes the callables send) and [message].
InventoryFailure inventoryFailureOf({
  String? code,
  Object? details,
  String? message,
}) {
  final reason =
      details is Map ? _text(details['reason'] ?? details['code'], 60) : '';
  switch (reason) {
    case 'item_archived':
      return InventoryFailure.itemArchived;
    case 'item_not_found':
      return InventoryFailure.itemNotFound;
    case 'sale_voided':
      return InventoryFailure.saleVoided;
  }
  switch (code) {
    case 'unavailable':
    case 'deadline-exceeded':
      return InventoryFailure.network;
    case 'permission-denied':
    case 'unauthenticated':
      return InventoryFailure.noPermission;
    case 'invalid-argument':
    case 'failed-precondition':
    case 'out-of-range':
      return InventoryFailure.invalid;
    case 'not-found':
      return InventoryFailure.itemNotFound;
  }
  return InventoryFailure.unknown;
}

/// Whether a failure leaves the sale safe to simply try again.
bool inventoryFailureIsRetryable(InventoryFailure failure) =>
    failure == InventoryFailure.network || failure == InventoryFailure.unknown;
