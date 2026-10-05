/// Containers, app side: what a business loaded into a shipping box, recorded
/// by the business itself rather than assembled from customer requests.
///
/// Mirrors `functions/container_manifest.js` rule for rule - the validation,
/// the state machine, the counts, the VIN conflict - so the phone refuses the
/// same things the server refuses, before the round trip, with the same code.
/// Pure Dart, tested without Firebase. The records the screen reads and the
/// joins it shows (search, the "in MSKU1234567" cross-link) live here too, so
/// they are tested the same way.
library;

import 'lot_ledger.dart' show lotDateOf;

// ---------------------------------------------------------------------------
// Vocabulary shared with the server.
// ---------------------------------------------------------------------------

const containerStatusLoading = 'loading';
const containerStatusShipped = 'shipped';
const containerStatusArrived = 'arrived';

const containerStatuses = <String>[
  containerStatusLoading,
  containerStatusShipped,
  containerStatusArrived,
];

const containerLineKindCar = 'car';
const containerLineKindBarrels = 'barrels';
const containerLineKindOther = 'other';

const containerLineKinds = <String>[
  containerLineKindCar,
  containerLineKindBarrels,
  containerLineKindOther,
];

const containerOwnerCustomer = 'customer';
const containerOwnerStock = 'stock';

const containerOwnerKinds = <String>[
  containerOwnerCustomer,
  containerOwnerStock,
];

/// ISO 6346: four letters (owner code) and seven digits. Booking numbers and
/// bills of lading have no universal shape, so they live in their own field
/// and are never mistaken for a container number.
final RegExp isoContainerNumber = RegExp(r'^[A-Z]{4}\d{7}$');

const containerMaxText = 200;
const containerMaxLabel = 120;
const containerMaxNote = 500;
const containerMaxVin = 17;
const containerMinVin = 6;
const containerMaxQuantity = 999;

/// Every refusal the server can answer with. The screen maps each to its
/// own copy; anything outside this list is shown as the server sent it.
const containerRefusalCodes = <String>[
  'container_label_required',
  'container_number_invalid',
  'container_status_invalid',
  'container_transition_invalid',
  'destination_required',
  'container_empty',
  'container_locked',
  'container_has_lines',
  'container_not_found',
  'line_not_found',
  'line_kind_invalid',
  'vin_required',
  'quantity_required',
  'description_required',
  'owner_kind_invalid',
  'customer_name_required',
  'customer_phone_invalid',
  'receiver_phone_invalid',
  'vin_already_loaded',
  'move_target_not_loading',
];

String _text(Object? value, [int max = containerMaxText]) {
  final t = (value ?? '').toString().trim();
  return t.length > max ? t.substring(0, max) : t;
}

// ---------------------------------------------------------------------------
// Phones.
// ---------------------------------------------------------------------------

/// Formatting a person typed is theirs to type and ours to drop.
final RegExp _phoneFormatting = RegExp(r'[\s().-]');

/// 7-15 digits, the plus optional: the shape a stored phone may have.
final RegExp _storablePhone = RegExp(r'^\+?\d{7,15}$');

/// The full international form, `+<country code><number>`. WhatsApp can only
/// reach a number written this way; a local "622 11 22 33" is a number for a
/// person to dial, not one a message can be sent to. Mirrors
/// `INTERNATIONAL_PHONE`.
final RegExp internationalPhonePattern = RegExp(r'^\+[1-9]\d{7,14}$');

/// A phone as stored: formatting dropped, the leading plus kept. Anything
/// that is not 7-15 digits is returned as typed so the validator can name
/// it. Mirrors the server's `phone`.
String containerPhone(Object? value) {
  final raw = _text(value, 40);
  final compact = raw.replaceAll(_phoneFormatting, '');
  return _storablePhone.hasMatch(compact) ? compact : raw;
}

/// Whether [value] is a reachable international number. Mirrors
/// `isInternationalPhone`.
bool isInternationalPhone(Object? value) =>
    internationalPhonePattern.hasMatch(containerPhone(value));

/// Empty is fine (nobody to reach); anything else must look like a phone.
/// Local numbers are still accepted - older app versions send them - but
/// only an international one can be messaged. Mirrors `phoneAcceptable`.
bool containerPhoneAcceptable(Object? value) {
  final stored = containerPhone(value);
  if (stored.isEmpty) return true;
  return _storablePhone.hasMatch(stored);
}

/// A number the server will store but WhatsApp cannot reach: it looks like a
/// phone and is missing its country code. Empty and malformed numbers are
/// not this - the first has nobody to reach, the second is refused.
bool containerPhoneLacksCountryCode(Object? value) {
  final stored = containerPhone(value);
  return stored.isNotEmpty &&
      containerPhoneAcceptable(stored) &&
      !isInternationalPhone(stored);
}

/// A switch that is on unless it was explicitly turned off. Mirrors
/// `onUnlessOff`.
bool _onUnlessOff(Object? value) => value != false && value != 'false';

int _positiveInt(Object? value) {
  final n = value is num
      ? value.toDouble()
      : double.tryParse((value ?? '').toString().trim());
  if (n == null || n.isNaN || n.isInfinite || n <= 0) return 0;
  return n.round();
}

// ---------------------------------------------------------------------------
// The container.
// ---------------------------------------------------------------------------

/// What staff typed for a container, before it is checked.
class ContainerDraft {
  const ContainerDraft({
    this.label = '',
    this.containerNumber = '',
    this.bookingReference = '',
    this.destinationCountryId = '',
    this.destinationCountryName = '',
    this.notes = '',
  });

  final String label;
  final String containerNumber;
  final String bookingReference;
  final String destinationCountryId;
  final String destinationCountryName;
  final String notes;
}

/// Error codes, every problem at once. Mirrors `validateContainer`.
List<String> validateContainer(ContainerDraft input) {
  final errors = <String>[];
  final number = _text(input.containerNumber, 20).toUpperCase();
  // The working name is for the box that has no number yet; a container or
  // booking number is a name enough.
  if (_text(input.label, containerMaxLabel).isEmpty &&
      number.isEmpty &&
      _text(input.bookingReference, 60).isEmpty) {
    errors.add('container_label_required');
  }
  if (number.isNotEmpty && !isoContainerNumber.hasMatch(number)) {
    errors.add('container_number_invalid');
  }
  return errors;
}

/// The fields a business may set on a container, normalised the way the
/// server will store them. Mirrors `containerRecord`.
Map<String, String> containerRecord(ContainerDraft input) {
  return {
    'label': _text(input.label, containerMaxLabel),
    'containerNumber': _text(input.containerNumber, 20).toUpperCase(),
    'bookingReference': _text(input.bookingReference, 60).toUpperCase(),
    'destinationCountryId': _text(input.destinationCountryId, 60),
    'destinationCountryName':
        _text(input.destinationCountryName, containerMaxLabel),
    'notes': _text(input.notes, containerMaxNote),
  };
}

/// A stored `containers/{id}` document, as the screen reads it.
class ShippingContainer {
  const ShippingContainer({
    required this.id,
    required this.businessId,
    required this.label,
    required this.containerNumber,
    required this.bookingReference,
    required this.destinationCountryId,
    required this.destinationCountryName,
    required this.status,
    required this.notes,
    required this.lineCount,
    required this.carCount,
    required this.barrelCount,
    required this.otherCount,
    required this.sailedAt,
    required this.arrivedAt,
    required this.createdByStaffId,
    required this.shippedByStaffId,
    required this.arrivedByStaffId,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String businessId;
  final String label;
  final String containerNumber;
  final String bookingReference;
  final String destinationCountryId;
  final String destinationCountryName;
  final String status;
  final String notes;
  final int lineCount;
  final int carCount;
  final int barrelCount;
  final int otherCount;
  final DateTime? sailedAt;
  final DateTime? arrivedAt;
  final String createdByStaffId;
  final String shippedByStaffId;
  final String arrivedByStaffId;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory ShippingContainer.fromMap(String id, Map<String, dynamic> d) {
    final status = _text(d['status'], 20);
    return ShippingContainer(
      id: id,
      businessId: _text(d['businessId'], containerMaxLabel),
      label: _text(d['label'], containerMaxLabel),
      containerNumber: _text(d['containerNumber'], 20).toUpperCase(),
      bookingReference: _text(d['bookingReference'], 60),
      destinationCountryId: _text(d['destinationCountryId'], 60),
      destinationCountryName:
          _text(d['destinationCountryName'], containerMaxLabel),
      status: containerStatuses.contains(status)
          ? status
          : containerStatusLoading,
      notes: _text(d['notes'], containerMaxNote),
      lineCount: _positiveInt(d['lineCount']),
      carCount: _positiveInt(d['carCount']),
      barrelCount: _positiveInt(d['barrelCount']),
      otherCount: _positiveInt(d['otherCount']),
      sailedAt: lotDateOf(d['sailedAt']),
      arrivedAt: lotDateOf(d['arrivedAt']),
      createdByStaffId: _text(d['createdByStaffId'], containerMaxLabel),
      shippedByStaffId: _text(d['shippedByStaffId'], containerMaxLabel),
      arrivedByStaffId: _text(d['arrivedByStaffId'], containerMaxLabel),
      createdAt: lotDateOf(d['createdAt']),
      updatedAt: lotDateOf(d['updatedAt']),
    );
  }

  bool get isLoading => status == containerStatusLoading;
  bool get isShipped => status == containerStatusShipped;
  bool get isArrived => status == containerStatusArrived;

  /// The number once the line has sent it, the working name until then.
  /// "MSKU1234567" is what a tracking site wants; "Sailing 3 Oct, box 2" is
  /// what the yard calls it.
  String get displayName => containerNumber.isNotEmpty
      ? containerNumber
      : (label.isNotEmpty ? label : bookingReference);

  bool get isEmpty => lineCount <= 0;
}

/// Whether the container may move from its current state to the next one.
/// Forward only: a shipped box does not come back to the yard, and an arrived
/// one is closed. Shipping needs a destination and something on board.
/// Mirrors `containerTransitionRefusal`.
String? containerTransitionRefusal(
  ShippingContainer? current,
  String nextStatus,
  int lineCount,
) {
  final from = current?.status ?? containerStatusLoading;
  final to = _text(nextStatus, 20);
  if (!containerStatuses.contains(to)) return 'container_status_invalid';
  if (from == containerStatusLoading && to == containerStatusShipped) {
    if (_text(current?.destinationCountryId, 60).isEmpty) {
      return 'destination_required';
    }
    if (lineCount <= 0) return 'container_empty';
    return null;
  }
  if (from == containerStatusShipped && to == containerStatusArrived) {
    return null;
  }
  return 'container_transition_invalid';
}

/// True while structural fields may still change. Once shipped, the list and
/// its identity are the record of what was declared; only the notes stay
/// open. Mirrors `containerIsOpen`.
bool containerIsOpen(ShippingContainer? current) =>
    (current?.status ?? containerStatusLoading) == containerStatusLoading;

/// Why it cannot be deleted, or null. Mirrors `containerDeleteRefusal`.
String? containerDeleteRefusal(ShippingContainer? current, int lineCount) {
  if (!containerIsOpen(current)) return 'container_locked';
  if (lineCount > 0) return 'container_has_lines';
  return null;
}

// ---------------------------------------------------------------------------
// A line on the list.
// ---------------------------------------------------------------------------

/// What staff typed for a line, before it is checked.
class ContainerLineDraft {
  const ContainerLineDraft({
    this.kind = '',
    this.vinNumber = '',
    this.carMake = '',
    this.carModel = '',
    this.carYear = '',
    this.quantity = 0,
    this.description = '',
    this.ownerKind = '',
    this.customerName = '',
    this.customerPhone = '',
    this.receiverName = '',
    this.receiverPhone = '',
    this.notifyCustomer = true,
    this.notifyReceiver = true,
  });

  final String kind;
  final String vinNumber;
  final String carMake;
  final String carModel;
  final String carYear;
  final int quantity;
  final String description;
  final String ownerKind;
  final String customerName;
  final String customerPhone;

  /// Who collects it at the other end - the name written on the barrel.
  final String receiverName;
  final String receiverPhone;

  /// Whether each person hears about the shipment on WhatsApp. On unless
  /// staff switch it off; there is nobody to tell without a number, so the
  /// record turns it off when the phone is empty.
  final bool notifyCustomer;
  final bool notifyReceiver;
}

/// Error codes. Mirrors `validateContainerLine`.
List<String> validateContainerLine(ContainerLineDraft input) {
  final errors = <String>[];
  final kind = _text(input.kind, 20);
  if (!containerLineKinds.contains(kind)) errors.add('line_kind_invalid');

  if (kind == containerLineKindCar) {
    final vin = _text(input.vinNumber, containerMaxVin).toUpperCase();
    if (vin.length < containerMinVin) errors.add('vin_required');
  } else if (kind == containerLineKindBarrels) {
    if (_positiveInt(input.quantity) <= 0) errors.add('quantity_required');
  } else if (kind == containerLineKindOther) {
    if (_text(input.description, containerMaxLabel).isEmpty) {
      errors.add('description_required');
    }
    if (_positiveInt(input.quantity) <= 0) errors.add('quantity_required');
  }

  final owner = _text(input.ownerKind, 20);
  if (!containerOwnerKinds.contains(owner)) errors.add('owner_kind_invalid');
  // A customer's line has to say who; the business's own stock has no one to
  // name, and asking for a name there is how fictional customers get typed.
  if (owner == containerOwnerCustomer &&
      _text(input.customerName, containerMaxLabel).isEmpty) {
    errors.add('customer_name_required');
  }
  errors.addAll(
    _contactPhoneErrors(input.customerPhone, input.receiverPhone, owner),
  );
  return errors;
}

/// Mirrors `contactPhoneErrors`: a customer's phone is only checked on a
/// customer's line, the receiver's on any line.
List<String> _contactPhoneErrors(
  String customerPhone,
  String receiverPhone,
  String owner,
) {
  return [
    if (owner == containerOwnerCustomer &&
        !containerPhoneAcceptable(customerPhone))
      'customer_phone_invalid',
    if (!containerPhoneAcceptable(receiverPhone)) 'receiver_phone_invalid',
  ];
}

/// The contact half of a line - who it belongs to, who collects it, and
/// whether each of them hears about it - as the server stores it. Shared by
/// adding a line and by correcting its contacts. Mirrors
/// `containerLineContacts`.
Map<String, dynamic> _containerLineContacts({
  required String owner,
  required String customerName,
  required String customerPhone,
  required String receiverName,
  required String receiverPhone,
  required Object? notifyCustomer,
  required Object? notifyReceiver,
}) {
  final customer = owner == containerOwnerCustomer;
  final storedCustomerPhone = customer ? containerPhone(customerPhone) : '';
  final storedReceiverPhone = containerPhone(receiverPhone);
  return {
    'customerName': customer ? _text(customerName, containerMaxLabel) : '',
    'customerPhone': storedCustomerPhone,
    // Either owner kind may name a receiver: stock goes to the business's
    // own agent at the port.
    'receiverName': _text(receiverName, containerMaxLabel),
    'receiverPhone': storedReceiverPhone,
    'notifyCustomer':
        storedCustomerPhone.isNotEmpty && _onUnlessOff(notifyCustomer),
    'notifyReceiver':
        storedReceiverPhone.isNotEmpty && _onUnlessOff(notifyReceiver),
  };
}

/// The line body the callable is sent, shaped the way the server stores it:
/// a car carries no quantity, stock carries no customer. Mirrors
/// `containerLineRecord` minus the server-only fields.
Map<String, dynamic> containerLineRecord(ContainerLineDraft input) {
  final kind = _text(input.kind, 20);
  final owner = _text(input.ownerKind, 20);
  final isCar = kind == containerLineKindCar;
  final quantity = _positiveInt(input.quantity);
  return {
    'kind': kind,
    'vinNumber':
        isCar ? _text(input.vinNumber, containerMaxVin).toUpperCase() : '',
    'carMake': isCar ? _text(input.carMake, 80) : '',
    'carModel': isCar ? _text(input.carModel, 80) : '',
    'carYear': isCar ? _text(input.carYear, 8) : '',
    'quantity': isCar
        ? 1
        : (quantity > containerMaxQuantity ? containerMaxQuantity : quantity),
    'description': kind == containerLineKindOther
        ? _text(input.description, containerMaxLabel)
        : '',
    'ownerKind': owner,
    ..._containerLineContacts(
      owner: owner,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      receiverName: input.receiverName,
      receiverPhone: input.receiverPhone,
      notifyCustomer: input.notifyCustomer,
      notifyReceiver: input.notifyReceiver,
    ),
  };
}

// ---------------------------------------------------------------------------
// Correcting a line's contacts - allowed in every container state.
// ---------------------------------------------------------------------------

/// What staff typed when correcting who a line belongs to and who collects
/// it. The server allows this after the box has sailed too: a wrong number
/// is the one mistake that matters most once it has.
class ContainerLineContactsDraft {
  const ContainerLineContactsDraft({
    this.customerName = '',
    this.customerPhone = '',
    this.receiverName = '',
    this.receiverPhone = '',
    this.notifyCustomer = true,
    this.notifyReceiver = true,
  });

  /// The line's contacts as they stand, to start a correction from.
  factory ContainerLineContactsDraft.fromLine(ContainerLine line) =>
      ContainerLineContactsDraft(
        customerName: line.customerName,
        customerPhone: line.customerPhone,
        receiverName: line.receiverName,
        receiverPhone: line.receiverPhone,
        notifyCustomer: line.notifyCustomer,
        notifyReceiver: line.notifyReceiver,
      );

  final String customerName;
  final String customerPhone;
  final String receiverName;
  final String receiverPhone;
  final bool notifyCustomer;
  final bool notifyReceiver;
}

/// Checks a contact correction against the line it changes: a customer's
/// line keeps a customer name, and every phone must look like one. Mirrors
/// `validateContainerLineContacts`.
List<String> validateContainerLineContacts(
  ContainerLineContactsDraft input,
  ContainerLine current,
) {
  final owner = current.ownerKind;
  final errors = <String>[];
  if (owner == containerOwnerCustomer &&
      _text(input.customerName, containerMaxLabel).isEmpty) {
    errors.add('customer_name_required');
  }
  errors.addAll(
    _contactPhoneErrors(input.customerPhone, input.receiverPhone, owner),
  );
  return errors;
}

/// The `contacts` payload for `updateContainerLineContacts`, shaped the way
/// the server will store it: stock keeps no customer, a switch follows its
/// phone. Mirrors `containerLineContactsUpdate`.
Map<String, dynamic> containerLineContactsUpdate(
  ContainerLineContactsDraft input,
  ContainerLine current,
) {
  return _containerLineContacts(
    owner: current.ownerKind,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    receiverName: input.receiverName,
    receiverPhone: input.receiverPhone,
    notifyCustomer: input.notifyCustomer,
    notifyReceiver: input.notifyReceiver,
  );
}

/// A stored `containerLines/{id}` document.
class ContainerLine {
  const ContainerLine({
    required this.id,
    required this.businessId,
    required this.containerId,
    required this.containerStatus,
    required this.kind,
    required this.vinNumber,
    required this.carMake,
    required this.carModel,
    required this.carYear,
    required this.quantity,
    required this.description,
    required this.ownerKind,
    required this.customerName,
    required this.customerPhone,
    this.receiverName = '',
    this.receiverPhone = '',
    this.trackingCode = '',
    this.notifyCustomer = false,
    this.notifyReceiver = false,
    required this.addedByStaffId,
    required this.createdAt,
    required this.updatedAt,
    this.lastCustomerUpdate,
  });

  final String id;
  final String businessId;
  final String containerId;

  /// The latest WhatsApp update the server sent about this line, and who it
  /// reached. Null until the container's first update goes out.
  final ContainerLineUpdate? lastCustomerUpdate;

  /// Denormalised from the container so "is this car already on an open
  /// container" is one query on lines, not a read of every container.
  final String containerStatus;
  final String kind;
  final String vinNumber;
  final String carMake;
  final String carModel;
  final String carYear;
  final int quantity;
  final String description;
  final String ownerKind;
  final String customerName;
  final String customerPhone;

  /// The name on the barrel: whoever collects it at the port.
  final String receiverName;
  final String receiverPhone;

  /// "CL-XXXXXX": what the customer types to follow it and what the package
  /// label carries. Empty on lines added before codes existed, until their
  /// container next moves.
  final String trackingCode;

  /// Whether each person hears about the shipment. Read as the server would
  /// decide it: on unless switched off, and never without a phone.
  final bool notifyCustomer;
  final bool notifyReceiver;
  final String addedByStaffId;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory ContainerLine.fromMap(String id, Map<String, dynamic> d) {
    final customerPhone = _text(d['customerPhone'], 40);
    final receiverPhone = _text(d['receiverPhone'], 40);
    return ContainerLine(
      id: id,
      businessId: _text(d['businessId'], containerMaxLabel),
      containerId: _text(d['containerId'], containerMaxLabel),
      containerStatus: _text(d['containerStatus'], 20),
      kind: _text(d['kind'], 20),
      vinNumber: _text(d['vinNumber'], containerMaxVin).toUpperCase(),
      carMake: _text(d['carMake'], 80),
      carModel: _text(d['carModel'], 80),
      carYear: _text(d['carYear'], 8),
      quantity: _positiveInt(d['quantity']),
      description: _text(d['description'], containerMaxLabel),
      ownerKind: _text(d['ownerKind'], 20),
      customerName: _text(d['customerName'], containerMaxLabel),
      customerPhone: customerPhone,
      receiverName: _text(d['receiverName'], containerMaxLabel),
      receiverPhone: receiverPhone,
      trackingCode: _text(d['trackingCode'], 40).toUpperCase(),
      notifyCustomer:
          customerPhone.isNotEmpty && _onUnlessOff(d['notifyCustomer']),
      notifyReceiver:
          receiverPhone.isNotEmpty && _onUnlessOff(d['notifyReceiver']),
      addedByStaffId: _text(d['addedByStaffId'], containerMaxLabel),
      createdAt: lotDateOf(d['createdAt']),
      updatedAt: lotDateOf(d['updatedAt']),
      lastCustomerUpdate: ContainerLineUpdate.fromMap(d['lastCustomerUpdate']),
    );
  }

  bool get isCar => kind == containerLineKindCar;
  bool get isBarrels => kind == containerLineKindBarrels;
  bool get isOther => kind == containerLineKindOther;
  bool get isStock => ownerKind == containerOwnerStock;

  /// The customer will hear about the shipment on WhatsApp: switched on and
  /// written in full international form. The same decision the server's
  /// `recipientsForLine` makes before it sends.
  bool get updatesCustomer =>
      _isCustomerLine && notifyCustomer && isInternationalPhone(customerPhone);

  /// The receiver will hear about the shipment on WhatsApp.
  bool get updatesReceiver =>
      notifyReceiver && isInternationalPhone(receiverPhone);

  /// Switched on, but the number has no country code, so no message can
  /// reach it. The tile says so; editing the contacts fixes it.
  bool get customerPhoneLacksCountryCode =>
      _isCustomerLine &&
      notifyCustomer &&
      containerPhoneLacksCountryCode(customerPhone);

  bool get _isCustomerLine => ownerKind == containerOwnerCustomer;
  bool get receiverPhoneLacksCountryCode =>
      notifyReceiver && containerPhoneLacksCountryCode(receiverPhone);

  /// "2019 Toyota Camry" when the car is known, else the VIN.
  String get vehicleLabel {
    final name =
        [carYear, carMake, carModel].where((p) => p.isNotEmpty).join(' ');
    return name.isNotEmpty ? name : vinNumber;
  }
}

// The update moments and per-person outcomes the server writes to
// `lastCustomerUpdate` (functions/index.js sendContainerCustomerUpdates).
const containerUpdateShipped = 'shipped';
const containerUpdateAtPort = 'at_port';
const containerUpdateArrived = 'arrived';
const containerUpdateRoleSender = 'sender';
const containerUpdateRoleReceiver = 'receiver';
const containerUpdateSent = 'sent';
const containerUpdateFailed = 'failed';
const containerUpdateSkipped = 'skipped';
const containerUpdateWaiting = 'waiting_for_whatsapp';

/// What happened for one person on one WhatsApp update.
class ContainerLineUpdateResult {
  const ContainerLineUpdateResult({
    required this.role,
    required this.status,
    this.reason = '',
  });

  /// [containerUpdateRoleSender] (the customer) or
  /// [containerUpdateRoleReceiver].
  final String role;

  /// sent, failed, skipped or waiting_for_whatsapp.
  final String status;

  /// Why a skipped person was skipped: no_phone, switched_off or
  /// needs_country_code.
  final String reason;
}

/// `containerLines/{id}.lastCustomerUpdate`: `{update, results, atMs}`.
class ContainerLineUpdate {
  const ContainerLineUpdate({
    required this.update,
    required this.results,
    required this.at,
  });

  final String update;
  final List<ContainerLineUpdateResult> results;
  final DateTime? at;

  /// Null for anything that is not a recorded update, so a malformed field
  /// reads as "no update yet" rather than breaking the line.
  static ContainerLineUpdate? fromMap(Object? value) {
    if (value is! Map) return null;
    final update = _text(value['update'], 40);
    if (update.isEmpty) return null;
    final results = <ContainerLineUpdateResult>[];
    final raw = value['results'];
    if (raw is Iterable) {
      for (final item in raw) {
        if (item is! Map) continue;
        final role = _text(item['role'], 20);
        final status = _text(item['status'], 40);
        if (role.isEmpty || status.isEmpty) continue;
        results.add(ContainerLineUpdateResult(
          role: role,
          status: status,
          reason: _text(item['reason'], 40),
        ));
      }
    }
    final atMs = value['atMs'];
    final at = atMs is num && atMs > 0
        ? DateTime.fromMillisecondsSinceEpoch(atMs.round())
        : lotDateOf(value['at']);
    return ContainerLineUpdate(update: update, results: results, at: at);
  }
}

/// The open container already holding this VIN, if any. A car on two loading
/// lists is a mistake every time. [lines] are the business's lines with this
/// VIN, as on the server; [ignoreContainerId] is the container being added
/// to (a move from it is fine). Mirrors `openContainerHoldingVin`.
String openContainerHoldingVin(
  Iterable<ContainerLine> lines, {
  String ignoreContainerId = '',
}) {
  final ignore = _text(ignoreContainerId, containerMaxLabel);
  for (final line in lines) {
    if (!line.isCar) continue;
    if (line.containerStatus == containerStatusArrived) continue;
    if (line.containerId.isNotEmpty && line.containerId != ignore) {
      return line.containerId;
    }
  }
  return '';
}

/// The lines of the whole business that carry [vin] - the phone holds every
/// line, where the server queried for these. Pair with
/// [openContainerHoldingVin] to refuse before the round trip.
List<ContainerLine> containerLinesForVin(
  Iterable<ContainerLine> lines,
  String vin,
) {
  final needle = _text(vin, containerMaxVin).toUpperCase();
  if (needle.length < containerMinVin) return const [];
  return [
    for (final line in lines)
      if (line.isCar && line.vinNumber == needle) line,
  ];
}

/// The summary a container carries so a list of them can be scanned without
/// loading every line. Barrels count by quantity; cars and other by line.
/// Mirrors `containerCounts`.
class ContainerCounts {
  const ContainerCounts({
    this.lineCount = 0,
    this.carCount = 0,
    this.barrelCount = 0,
    this.otherCount = 0,
  });

  final int lineCount;
  final int carCount;
  final int barrelCount;
  final int otherCount;
}

ContainerCounts containerCounts(Iterable<ContainerLine> lines) {
  var lineCount = 0, carCount = 0, barrelCount = 0, otherCount = 0;
  for (final line in lines) {
    lineCount += 1;
    if (line.isCar) {
      carCount += 1;
    } else if (line.isBarrels) {
      barrelCount += line.quantity;
    } else {
      otherCount += line.quantity > 0 ? line.quantity : 1;
    }
  }
  return ContainerCounts(
    lineCount: lineCount,
    carCount: carCount,
    barrelCount: barrelCount,
    otherCount: otherCount,
  );
}

// ---------------------------------------------------------------------------
// What the screen shows: order, filter, search, and the cross-link.
// ---------------------------------------------------------------------------

int _statusRank(String status) => switch (status) {
      containerStatusLoading => 0,
      containerStatusShipped => 1,
      _ => 2,
    };

int _newestFirst(DateTime? a, DateTime? b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b.compareTo(a);
}

/// Loading boxes first (they are the ones being worked), then shipped, then
/// arrived; newest first within each. Sorted here because the query carries
/// no `orderBy`, so it needs no composite index.
List<ShippingContainer> sortContainers(Iterable<ShippingContainer> list) {
  final out = list.toList();
  out.sort((a, b) {
    final byStatus = _statusRank(a.status).compareTo(_statusRank(b.status));
    if (byStatus != 0) return byStatus;
    return _newestFirst(a.updatedAt ?? a.createdAt, b.updatedAt ?? b.createdAt);
  });
  return out;
}

/// The containers in one state. An unknown filter shows everything.
List<ShippingContainer> filterContainers(
  Iterable<ShippingContainer> list,
  String status,
) {
  if (!containerStatuses.contains(status)) return sortContainers(list);
  return sortContainers(list.where((c) => c.status == status));
}

/// In the order they were loaded, oldest first: the list reads top to bottom
/// the way the box was filled.
List<ContainerLine> sortContainerLines(Iterable<ContainerLine> list) {
  final out = list.toList();
  out.sort((a, b) {
    final x = a.createdAt, y = b.createdAt;
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return x.compareTo(y);
  });
  return out;
}

List<ContainerLine> linesOfContainer(
  Iterable<ContainerLine> lines,
  String containerId,
) =>
    sortContainerLines(lines.where((l) => l.containerId == containerId));

String _digits(String v) => v.replaceAll(RegExp(r'\D+'), '');

/// One line found by search, with the container it sits on.
class ContainerSearchHit {
  const ContainerSearchHit({required this.line, required this.container});

  final ContainerLine line;

  /// Null when the line's container is not in the rows the screen holds - a
  /// deleted box, or one still arriving - so the hit still names the line.
  final ShippingContainer? container;
}

/// Lines matching a VIN, a customer name or a phone number, best first:
/// exact VIN, then anything containing the text. A phone matches on digits
/// so "(917) 555" finds "9175551234". Under two characters nothing matches,
/// the same floor the customer picker uses.
List<ContainerSearchHit> searchContainerLines(
  Iterable<ContainerLine> lines,
  Map<String, ShippingContainer> containersById,
  String query,
) {
  final q = query.trim().toLowerCase();
  if (q.length < 2) return const [];
  final qUpper = q.toUpperCase();
  final qDigits = _digits(q);
  final scored = <(ContainerSearchHit, int)>[];
  for (final line in lines) {
    var score = 0;
    if (line.vinNumber.isNotEmpty) {
      if (line.vinNumber == qUpper) {
        score = 5;
      } else if (line.vinNumber.contains(qUpper)) {
        score = 4;
      }
    }
    final name = line.customerName.toLowerCase();
    if (name.isNotEmpty) {
      if (name.startsWith(q)) {
        score = score < 4 ? 4 : score;
      } else if (name.contains(q)) {
        score = score < 3 ? 3 : score;
      }
    }
    if (qDigits.length >= 3 && _digits(line.customerPhone).contains(qDigits)) {
      score = score < 3 ? 3 : score;
    }
    // "Is there anything for Mariama Bah?" is the port's question; the
    // receiver answers it even on a stock line that names no customer.
    final receiver = line.receiverName.toLowerCase();
    if (receiver.isNotEmpty && receiver.contains(q)) {
      score = score < 3 ? 3 : score;
    }
    if (qDigits.length >= 3 && _digits(line.receiverPhone).contains(qDigits)) {
      score = score < 3 ? 3 : score;
    }
    if (score > 0) {
      scored.add((
        ContainerSearchHit(
          line: line,
          container: containersById[line.containerId],
        ),
        score,
      ));
    }
  }
  scored.sort((a, b) {
    final byScore = b.$2.compareTo(a.$2);
    if (byScore != 0) return byScore;
    final ca = a.$1.container, cb = b.$1.container;
    final byStatus = _statusRank(ca?.status ?? containerStatusArrived)
        .compareTo(_statusRank(cb?.status ?? containerStatusArrived));
    if (byStatus != 0) return byStatus;
    return _newestFirst(ca?.sailedAt ?? ca?.updatedAt, cb?.sailedAt ?? cb?.updatedAt);
  });
  return [for (final s in scored) s.$1];
}

/// Where a car is right now, as far as the containers know: on a box still
/// loading, or on one that has sailed. An arrived box says nothing about the
/// car any more, so it makes no link.
class ContainerVinLink {
  const ContainerVinLink({
    required this.containerId,
    required this.containerName,
    required this.status,
    required this.sailedAt,
  });

  final String containerId;

  /// The number when the box has one, the working name otherwise.
  final String containerName;
  final String status;
  final DateTime? sailedAt;

  bool get isShipped => status == containerStatusShipped;
}

/// VIN → link, for the rows a screen already holds. One pass over the lines,
/// so a parked-car list of five hundred rows costs one map lookup each and
/// no query. A VIN can only be on one open box, so first wins.
Map<String, ContainerVinLink> containerVinLinks(
  Iterable<ContainerLine> lines,
  Iterable<ShippingContainer> containers,
) {
  final byId = {for (final c in containers) c.id: c};
  final out = <String, ContainerVinLink>{};
  for (final line in lines) {
    if (!line.isCar || line.vinNumber.isEmpty) continue;
    final container = byId[line.containerId];
    if (container == null || container.isArrived) continue;
    out.putIfAbsent(
      line.vinNumber,
      () => ContainerVinLink(
        containerId: container.id,
        containerName: container.displayName,
        status: container.status,
        sailedAt: container.sailedAt,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading a refusal the server sent back.
// ---------------------------------------------------------------------------

/// What a callable refused with: the codes, and the container a VIN clash
/// names. Codes come from `details` when the server attached them, and from
/// the message when it only spoke the code. A refusal with no known code
/// keeps [message] so the screen can still say what the server said.
class ContainerRefusal {
  const ContainerRefusal({
    required this.codes,
    required this.conflictContainerId,
    required this.message,
  });

  final List<String> codes;
  final String conflictContainerId;
  final String message;

  bool get isEmpty => codes.isEmpty;
}

ContainerRefusal parseContainerRefusal(Object? details, String? message) {
  final codes = <String>{};
  var conflict = '';
  void addCode(Object? value) {
    final code = _text(value, 60);
    if (containerRefusalCodes.contains(code)) codes.add(code);
  }

  if (details is Map) {
    addCode(details['code']);
    addCode(details['reason']);
    for (final key in ['codes', 'errors']) {
      final list = details[key];
      if (list is Iterable) list.forEach(addCode);
    }
    conflict = _text(details['conflictContainerId'], containerMaxLabel);
  }
  // A message made only of codes ("vin_required customer_name_required") is
  // the server speaking in codes; read them. Prose stays prose.
  final text = _text(message, 600);
  if (text.isNotEmpty) {
    for (final word in text.split(RegExp(r'\s+'))) {
      addCode(word.replaceAll(RegExp(r'[^a-z_]'), ''));
    }
  }
  return ContainerRefusal(
    codes: codes.toList(),
    conflictContainerId: conflict,
    message: text,
  );
}
