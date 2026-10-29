/// Package delivered at the destination, app side (docs/WAITING_PACKAGES.md
/// "Delivered at destination").
///
/// Mirrors the rules of `functions/container_delivery.js` that the screens
/// need: who may mark a package delivered, undo it and see what it still
/// owes; when a package can be handed over (its container is ready for
/// pickup); who collected it; the requests the `updateContainerLine`
/// callable takes for its `deliver` / `undo_delivery` actions, its answers
/// and its refusals (`details.reason`); and "X of Y delivered" on a
/// container. Pure Dart, tested without Firebase - the calls themselves are
/// `ContainerDeliveryService`.
library;

import '../utils/business_permissions.dart';
import '../utils/callable_data.dart';
import 'container_manifest.dart';
import 'line_pieces.dart' show LineGroupSummary;
import 'waiting_packages.dart' show groupHasRoot, groupPayment, packagePayment;

/// The callable a delivery rides: an action on the line edit, not its own
/// Cloud Function (the CPU instance budget is at its limit).
const deliveryCallable = 'updateContainerLine';

/// `DELIVERY_ACTION` on the server.
const deliveryActionDeliver = 'deliver';
const deliveryActionUndo = 'undo_delivery';

/// `MAX_COLLECTED_BY`: the longest "collected by" name the server keeps.
const deliveryMaxCollectedBy = 120;

/// The refusal codes the server sends in `details.reason` for a delivery
/// (`DELIVERY_MESSAGES` keys). Screens put each in their own words
/// (`deliveryRefusalText`), never the server's English message.
abstract final class DeliveryReason {
  static const actionInvalid = 'delivery_action_invalid';
  static const notArrived = 'delivery_not_arrived';
  static const balanceDue = 'delivery_balance_due';
  static const collectedByTooLong = 'collected_by_too_long';
  static const lineNotFound = 'line_not_found';

  /// USD collected at handover (docs/AIR_PACKAGES.md §4.7): not a whole
  /// number of cents, or over the ledger's ceiling.
  static const collectedCentsInvalid = 'collected_cents_invalid';

  /// The proof refusals (`package_proof.REFUSAL`), spread into
  /// `DELIVERY_MESSAGES` on the server. A delivery meets the last two:
  /// the pickup code did not match, or the override lacks a name or a
  /// photo. The others are line-edit refusals that share the callable.
  static const photoInvalid = 'photo_invalid';
  static const photoRequired = 'photo_required';
  static const contentsInvalid = 'contents_invalid';
  static const weightInvalid = 'weight_invalid';
  static const declaredValueInvalid = 'declared_value_invalid';
  static const pickupCodeInvalid = 'pickup_code_invalid';
  static const overrideIncomplete = 'override_incomplete';

  static const all = <String>[
    actionInvalid,
    collectedCentsInvalid,
    photoInvalid,
    photoRequired,
    contentsInvalid,
    weightInvalid,
    declaredValueInvalid,
    pickupCodeInvalid,
    overrideIncomplete,
    notArrived,
    balanceDue,
    collectedByTooLong,
    lineNotFound,
  ];
}

// ---------------------------------------------------------------------------
// The pickup code and the override (docs/AIR_PACKAGES.md §1.6, §4.7).
// ---------------------------------------------------------------------------

/// Whether the Mark delivered sheet asks for the pickup code: the business
/// switch is on AND the line was minted a code. Mirrors the first branch of
/// `handoverCheck`. The code itself is never shown to deliveries-only
/// staff; the sheet only needs to know one exists.
bool deliveryAsksPickupCode({
  required bool businessPickupCode,
  required String linePickupCode,
}) => businessPickupCode && linePickupCode.trim().isNotEmpty;

/// What the agent typed as the code, digits only. Mirrors the cleaning in
/// `pickupCodeMatches`; four digits are a complete code.
String pickupCodeDigits(String typed) =>
    typed.replaceAll(RegExp(r'\D'), '');

bool pickupCodeComplete(String typed) => pickupCodeDigits(typed).length == 4;

/// The least the override needs before it is sent: a name of two
/// characters and a photo. Mirrors the `override_incomplete` branch of
/// `handoverCheck`. Empty when complete.
List<String> deliveryOverrideErrors({
  required String collectedBy,
  required String photoPath,
}) => deliveryOneLine(collectedBy).length < 2 || photoPath.trim().isEmpty
    ? const [DeliveryReason.overrideIncomplete]
    : const [];

/// "Collected now" as typed, in whole dollars: cents, 0 for blank, null
/// when it is not an amount (a negative, a fraction of a cent, letters).
/// Mirrors `collectedCentsOf` on whole-dollar input.
int? collectedCentsFromInput(String typed) {
  final text = typed.trim().replaceAll(RegExp(r'[\$,\s]'), '');
  if (text.isEmpty) return 0;
  final value = double.tryParse(text);
  if (value == null || value < 0 || !value.isFinite) return null;
  final cents = (value * 100).round();
  if ((value * 100 - cents).abs() > 1e-6) return null;
  return cents;
}

// ---------------------------------------------------------------------------
// Who may do what. Owners and admins hold every section (`isStaff` false);
// staff hold what their `businessPermissions` list.
// ---------------------------------------------------------------------------

bool _holds(bool isStaff, Iterable<String> permissions, String permission) =>
    canAccessBusinessPermission(
      isStaff: isStaff,
      permissions: permissions,
      permission: permission,
    );

/// Mark a package delivered: the containers permission OR the narrower
/// deliveries one (`DELIVERY_SECTIONS`).
bool canDeliverPackages({
  required bool isStaff,
  required Iterable<String> permissions,
}) =>
    _holds(isStaff, permissions, BusinessPermission.containers) ||
    _holds(isStaff, permissions, BusinessPermission.deliveries);

/// Undo a delivery: a manager of the containers (`DELIVERY_UNDO_SECTION`).
bool canUndoDeliveries({
  required bool isStaff,
  required Iterable<String> permissions,
}) => _holds(isStaff, permissions, BusinessPermission.containers);

/// See prices, payments and what a package still owes: the containers or
/// the ledger permission (`DELIVERY_MONEY_SECTIONS`). A deliveries-only
/// person is told there is a balance, never how much.
bool canSeePackageMoney({
  required bool isStaff,
  required Iterable<String> permissions,
}) =>
    _holds(isStaff, permissions, BusinessPermission.containers) ||
    _holds(isStaff, permissions, BusinessPermission.ledger);

/// What one person may see and do on a package page.
class PackageAccess {
  const PackageAccess({
    required this.canDeliver,
    required this.canUndoDelivery,
    required this.canSeeMoney,
    required this.restricted,
  });

  /// Everything: an owner, an admin, or staff with the containers
  /// permission.
  static const full = PackageAccess(
    canDeliver: true,
    canUndoDelivery: true,
    canSeeMoney: true,
    restricted: false,
  );

  /// Staff holding only the deliveries permission.
  static const deliveriesOnly = PackageAccess(
    canDeliver: true,
    canUndoDelivery: false,
    canSeeMoney: false,
    restricted: true,
  );

  factory PackageAccess.of({
    required bool isStaff,
    required Iterable<String> permissions,
  }) => PackageAccess(
    canDeliver: canDeliverPackages(isStaff: isStaff, permissions: permissions),
    canUndoDelivery: canUndoDeliveries(
      isStaff: isStaff,
      permissions: permissions,
    ),
    canSeeMoney: canSeePackageMoney(isStaff: isStaff, permissions: permissions),
    // Without the containers permission nothing else on a package can be
    // changed (contacts, the line, labels, prices and payments are all
    // containers callables), and the container page shows every price.
    restricted: !_holds(isStaff, permissions, BusinessPermission.containers),
  );

  final bool canDeliver;
  final bool canUndoDelivery;
  final bool canSeeMoney;

  /// Deliveries mode: no edits, labels, prices, payments or container page.
  final bool restricted;

  @override
  bool operator ==(Object other) =>
      other is PackageAccess &&
      other.canDeliver == canDeliver &&
      other.canUndoDelivery == canUndoDelivery &&
      other.canSeeMoney == canSeeMoney &&
      other.restricted == restricted;

  @override
  int get hashCode =>
      Object.hash(canDeliver, canUndoDelivery, canSeeMoney, restricted);
}

// ---------------------------------------------------------------------------
// When a package can be handed over.
// ---------------------------------------------------------------------------

/// Why [line] cannot be marked delivered now, or null. Only a package on a
/// container marked ready for pickup (stored `arrived`) can be handed over.
/// Mirrors `deliveryRefusal`; [container] is the line's container, null
/// when it has none or it is not loaded.
String? deliveryRefusal(ContainerLine line, ShippingContainer? container) {
  if (line.containerId.trim().isEmpty) return DeliveryReason.notArrived;
  if (container == null || container.id != line.containerId) {
    return DeliveryReason.notArrived;
  }
  return container.isArrived ? null : DeliveryReason.notArrived;
}

/// Whether the "Mark delivered" action is offered for [line].
bool canMarkDelivered(
  ContainerLine line,
  ShippingContainer? container,
  PackageAccess access,
) =>
    access.canDeliver &&
    !line.isDelivered &&
    deliveryRefusal(line, container) == null;

/// Whether "Undo delivery" is offered for [line].
bool canUndoDelivery(ContainerLine line, PackageAccess access) =>
    access.canUndoDelivery && line.isDelivered;

// ---------------------------------------------------------------------------
// Who collected it.
// ---------------------------------------------------------------------------

/// One line of text: a name is never several lines. Mirrors `oneLine`.
String deliveryOneLine(String value) => value
    .replaceAll(RegExp(r'[\r\n\t]+'), ' ')
    .replaceAll(RegExp(r' {2,}'), ' ')
    .trim();

/// What the "collected by" field starts with: the receiver's name, else the
/// line's customer (a line with no receiver predates required receivers).
/// The server falls back the same way when the field is left blank.
String collectedByDefault(ContainerLine line) {
  final receiver = deliveryOneLine(line.receiverName);
  final name = receiver.isNotEmpty
      ? receiver
      : deliveryOneLine(lineCustomerName(line));
  return name.length > deliveryMaxCollectedBy
      ? name.substring(0, deliveryMaxCollectedBy)
      : name;
}

/// Error codes for what staff typed as "collected by". Mirrors
/// `collectedByErrors`.
List<String> collectedByErrors(String input) =>
    deliveryOneLine(input).length > deliveryMaxCollectedBy
    ? const [DeliveryReason.collectedByTooLong]
    : const [];

// ---------------------------------------------------------------------------
// Money: a warning, never a block.
// ---------------------------------------------------------------------------

/// What the package still owes, as far as the phone can tell: its whole
/// group's balance (a part owes what the group owes; the payments live on
/// the root). A part read without its root cannot know the payments, so it
/// answers 0 and leaves the warning to the server's `delivery_balance_due`.
int deliveryBalanceCents(ContainerLine line, LineGroupSummary? group) {
  if (group != null) {
    if (!groupHasRoot(group)) return 0;
    return groupPayment(group).balanceCents ?? 0;
  }
  if (line.isPart) return 0;
  return packagePayment(line).balanceCents ?? 0;
}

/// How the balance warning reads for one person.
enum DeliveryBalanceNoticeKind { none, amount, unpaid }

class DeliveryBalanceNotice {
  const DeliveryBalanceNotice._(this.kind, [this.balanceCents]);

  static const none = DeliveryBalanceNotice._(DeliveryBalanceNoticeKind.none);

  final DeliveryBalanceNoticeKind kind;

  /// Only for [DeliveryBalanceNoticeKind.amount].
  final int? balanceCents;

  bool get warns => kind != DeliveryBalanceNoticeKind.none;
}

/// The warning to show before handing a package over: the amount for someone
/// who may see money, "there is a balance" for anyone else, nothing when it
/// is paid (or has no price). Mirrors `deliveryBalanceView`.
DeliveryBalanceNotice deliveryBalanceNotice({
  required int balanceCents,
  required bool canSeeMoney,
}) {
  if (balanceCents <= 0) return DeliveryBalanceNotice.none;
  return canSeeMoney
      ? DeliveryBalanceNotice._(DeliveryBalanceNoticeKind.amount, balanceCents)
      : const DeliveryBalanceNotice._(DeliveryBalanceNoticeKind.unpaid);
}

// ---------------------------------------------------------------------------
// The callable.
// ---------------------------------------------------------------------------

/// `updateContainerLine` with `action: deliver`. [collectedBy] is sent as
/// typed (one line); blank lets the server name the receiver.
/// [acknowledgeBalance] is true once the person saw the balance warning.
///
/// [pickupCode] is what the agent typed (digits only are sent); [overrideCollectedBy]
/// and [overridePhotoPath] together are the "deliver without a code"
/// override; [collectedCents] is the USD collected now (0 sends nothing).
Map<String, Object?> deliverLineRequest(
  String businessId,
  String lineId, {
  String collectedBy = '',
  bool acknowledgeBalance = false,
  String pickupCode = '',
  String overrideCollectedBy = '',
  String overridePhotoPath = '',
  int collectedCents = 0,
}) {
  final code = pickupCodeDigits(pickupCode);
  final overrideName = deliveryOneLine(overrideCollectedBy);
  final overridePhoto = overridePhotoPath.trim();
  return {
    'businessId': businessId,
    'lineId': lineId,
    'action': deliveryActionDeliver,
    'collectedBy': deliveryOneLine(collectedBy),
    'acknowledgeBalance': acknowledgeBalance,
    if (code.isNotEmpty) 'pickupCode': code,
    if (overrideName.isNotEmpty || overridePhoto.isNotEmpty)
      'override': {'collectedBy': overrideName, 'photoPath': overridePhoto},
    if (collectedCents > 0) 'collectedCents': collectedCents,
  };
}

/// `updateContainerLine` with `action: undo_delivery`.
Map<String, Object?> undoDeliveryRequest(String businessId, String lineId) => {
  'businessId': businessId,
  'lineId': lineId,
  'action': deliveryActionUndo,
};

/// The answer to a delivery.
class DeliveryResult {
  const DeliveryResult({
    required this.lineId,
    required this.alreadyDelivered,
    required this.collectedBy,
    required this.hasBalance,
    this.balanceCents,
    this.deliveredWithoutCode = false,
    this.collectedCents = 0,
    this.paymentId = '',
  });

  factory DeliveryResult.fromCallable(Object? data) {
    final map = callableMap(data);
    final cents = map['balanceCents'];
    return DeliveryResult(
      lineId: callableString(map['lineId']),
      alreadyDelivered: callableBool(map['alreadyDelivered']),
      collectedBy: callableString(map['collectedBy']),
      hasBalance: callableBool(map['hasBalance']),
      balanceCents: cents is num ? callableInt(cents) : null,
      deliveredWithoutCode: callableBool(map['deliveredWithoutCode']),
      collectedCents: callableInt(map['collectedCents']),
      paymentId: callableString(map['paymentId']),
    );
  }

  final String lineId;

  /// Someone (another phone, a second tap) had already marked it: nothing
  /// changed and nobody was messaged again.
  final bool alreadyDelivered;
  final String collectedBy;
  final bool hasBalance;

  /// Null for a caller who may not see money.
  final int? balanceCents;

  /// The override was used (docs/AIR_PACKAGES.md §4.7).
  final bool deliveredWithoutCode;

  /// USD collected at handover, and the payment row it wrote ('' when
  /// nothing was collected).
  final int collectedCents;
  final String paymentId;
}

/// The answer to an undo: false when the package was not delivered.
bool undoDeliveryResult(Object? data) =>
    callableBool(callableMap(data)['undone']);

/// A refused delivery call, or one that never got through.
class DeliveryFailure implements Exception {
  const DeliveryFailure({
    required this.code,
    this.reason = '',
    this.hasBalance = false,
    this.balanceCents,
  });

  /// The Functions code (`failed-precondition`, `permission-denied`,
  /// `unavailable`...); `unknown` when none.
  final String code;

  /// `details.reason`, one of [DeliveryReason.all]; '' when none came.
  final String reason;

  /// On `delivery_balance_due`: whether there is a balance, and how much
  /// (null for a caller who may not see money).
  final bool hasBalance;
  final int? balanceCents;

  bool get balanceDue => reason == DeliveryReason.balanceDue;
  bool get notAllowed => code == 'permission-denied';
  bool get offline =>
      code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'network-request-failed';

  @override
  String toString() => 'DeliveryFailure($code $reason)';
}

DeliveryFailure parseDeliveryFailure(String code, Object? details) {
  final map = callableMap(details);
  final cents = map['balanceCents'];
  final reason = callableString(map['reason']);
  return DeliveryFailure(
    code: code.trim().toLowerCase(),
    reason: reason,
    hasBalance:
        callableBool(map['hasBalance']) || reason == DeliveryReason.balanceDue,
    balanceCents: cents is num ? callableInt(cents) : null,
  );
}

// ---------------------------------------------------------------------------
// "X of Y delivered".
// ---------------------------------------------------------------------------

class ContainerDeliveryProgress {
  const ContainerDeliveryProgress({
    required this.delivered,
    required this.total,
  });

  final int delivered;
  final int total;

  bool get complete => total > 0 && delivered >= total;
}

/// From the container's stored tallies; `delivered` never above `total`.
/// Mirrors `containerDeliveryProgress`.
ContainerDeliveryProgress containerDeliveryProgress(
  ShippingContainer container,
) {
  final total = container.lineCount < 0 ? 0 : container.lineCount;
  final delivered = container.deliveredCount < 0
      ? 0
      : (container.deliveredCount > total ? total : container.deliveredCount);
  return ContainerDeliveryProgress(delivered: delivered, total: total);
}

/// Whether a container shows its delivery progress: once it is ready for
/// pickup, or whenever something on it was delivered (a box set back to
/// shipped keeps its count visible).
bool showsDeliveryProgress(ShippingContainer container) =>
    container.lineCount > 0 &&
    (container.isArrived || container.deliveredCount > 0);
