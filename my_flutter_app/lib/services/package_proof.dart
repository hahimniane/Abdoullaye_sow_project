/// Proof on a package (docs/AIR_PACKAGES.md): drop-off photos, what is
/// inside, weight and declared value, the sender's WhatsApp confirmation and
/// the three ticks a package shows.
///
/// Mirrors `functions/package_proof.js` rule for rule, so the phone refuses
/// what the server refuses before the round trip, with the same code. Pure
/// Dart: no Firebase, no clock, tested on its own.
library;

// ---------------------------------------------------------------------------
// Vocabulary shared with the server.
// ---------------------------------------------------------------------------

const proofPhotoRoot = 'packagePhotos';
const proofMaxPhotos = 5;
const proofMaxCustomerPhotos = 10;
const proofPhotoMaxBytes = 2 * 1024 * 1024;

const proofMaxContents = 10;
const proofMaxContentLabel = 60;
const proofMaxContentQuantity = 99;
const proofMaxSerial = 40;
const proofMinWeightLb = 0.1;
const proofMaxWeightLb = 2000.0;
const proofMaxDeclaredValueCents = 100000 * 100;

const senderConfirmationNone = 'none';
const senderConfirmationAsked = 'asked';
const senderConfirmationConfirmed = 'confirmed';
const senderConfirmationProblem = 'problem';

const senderConfirmationStatuses = <String>[
  senderConfirmationNone,
  senderConfirmationAsked,
  senderConfirmationConfirmed,
  senderConfirmationProblem,
];

/// The refusal codes the proof rules add (docs/AIR_PACKAGES.md §4).
const proofRefusalCodes = <String>[
  'photo_invalid',
  'photo_required',
  'pickup_code_invalid',
  'override_incomplete',
  'contents_invalid',
  'weight_invalid',
  'declared_value_invalid',
  'proof_settings_invalid',
  'air_waybill_invalid',
];

/// `assignContainerLines` refuses with this `reason` (and `lineIds`) until
/// the caller resends with `acknowledgeProblems: true` (§4.8).
const loadWarningSenderProblem = 'sender_problem';

final RegExp _photoFile = RegExp(r'^[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$');
final RegExp _photoFolder = RegExp(r'^[A-Za-z0-9_-]{2,128}$');
final RegExp _businessId = RegExp(r'^[A-Za-z0-9_-]{1,128}$');
final RegExp _serialChars = RegExp(r'[^A-Za-z0-9 ./-]');

String _text(Object? value, int max) {
  final s = (value ?? '').toString().trim();
  return s.length > max ? s.substring(0, max) : s;
}

// ---------------------------------------------------------------------------
// Photo paths.
// ---------------------------------------------------------------------------

/// The parts of `packagePhotos/{businessId}/{folder}/{fileId}`.
class PhotoPathParts {
  const PhotoPathParts({
    required this.businessId,
    required this.folder,
    required this.fileId,
  });

  final String businessId;
  final String folder;
  final String fileId;

  /// Written by the server: copied from WhatsApp (`wa`) or from a package
  /// request (`req`).
  bool get isServerFolder => folder == 'wa' || folder == 'req';
}

/// The parts of a photo path, or null when it is not one of ours. Mirrors
/// `photoPathParts`.
PhotoPathParts? photoPathParts(Object? path) {
  final parts = (path ?? '').toString().split('/');
  if (parts.length != 4 || parts[0] != proofPhotoRoot) return null;
  final businessId = parts[1];
  final folder = parts[2];
  final fileId = parts[3];
  if (!_businessId.hasMatch(businessId)) return null;
  if (!_photoFolder.hasMatch(folder) || !_photoFile.hasMatch(fileId)) {
    return null;
  }
  return PhotoPathParts(businessId: businessId, folder: folder, fileId: fileId);
}

/// A staff photo path this caller may attach: in this business, in the
/// caller's own folder; the server's folders only when [allowServerFolders]
/// (an edit keeps what the server added). Mirrors `photoPathAllowed`.
bool photoPathAllowed(
  String path, {
  required String businessId,
  required String uid,
  bool allowServerFolders = false,
}) {
  final parts = photoPathParts(path);
  if (parts == null || parts.businessId != businessId) return false;
  if (parts.folder == uid) return true;
  return allowServerFolders && parts.isServerFolder;
}

/// The photo list a line stores: unique, in order, at most [proofMaxPhotos].
/// Mirrors `normalizePhotoPaths`.
({List<String> paths, String error}) normalizePhotoPaths(Object? raw) {
  if (raw == null) return (paths: const [], error: '');
  if (raw is! Iterable) return (paths: const [], error: 'photo_invalid');
  final paths = <String>[];
  for (final entry in raw) {
    final path = (entry ?? '').toString().trim();
    if (photoPathParts(path) == null) {
      return (paths: const [], error: 'photo_invalid');
    }
    if (!paths.contains(path)) paths.add(path);
  }
  if (paths.length > proofMaxPhotos) {
    return (paths: const [], error: 'photo_invalid');
  }
  return (paths: paths, error: '');
}

// ---------------------------------------------------------------------------
// What is inside.
// ---------------------------------------------------------------------------

/// One item of a package's contents: "2 × iPhone 13, serial …".
class PackageContent {
  const PackageContent({
    required this.label,
    this.quantity = 1,
    this.serial = '',
  });

  final String label;
  final int quantity;
  final String serial;

  factory PackageContent.fromMap(Object? raw) {
    final m = raw is Map ? raw : const {};
    final q = m['quantity'];
    return PackageContent(
      label: _text(m['label'], proofMaxContentLabel),
      quantity: q is num
          ? q.round()
          : int.tryParse((q ?? '').toString().trim()) ?? 1,
      serial: _text(m['serial'], proofMaxSerial),
    );
  }

  Map<String, Object?> toMap() => {
        'label': label,
        'quantity': quantity,
        'serial': serial,
      };

  @override
  bool operator ==(Object other) =>
      other is PackageContent &&
      other.label == label &&
      other.quantity == quantity &&
      other.serial == serial;

  @override
  int get hashCode => Object.hash(label, quantity, serial);

  @override
  String toString() => 'PackageContent($quantity × $label${serial.isEmpty ? '' : ' #$serial'})';
}

/// The stored list, read leniently (nothing is refused on a read).
List<PackageContent> packageContentsOf(Object? raw) => [
      if (raw is Iterable)
        for (final entry in raw)
          if (entry is Map && _text(entry['label'], proofMaxContentLabel + 1).isNotEmpty)
            PackageContent.fromMap(entry),
    ];

/// What is inside, checked: a name up to 60, a quantity 1..99, an optional
/// serial. Rows without a name are skipped. Mirrors `normalizeContents`.
({List<PackageContent> contents, String error}) normalizeContents(Object? raw) {
  if (raw == null) return (contents: const [], error: '');
  if (raw is! Iterable) return (contents: const [], error: 'contents_invalid');
  final out = <PackageContent>[];
  for (final entry in raw) {
    final m = entry is PackageContent
        ? entry.toMap()
        : (entry is Map ? entry : const <String, Object?>{});
    final label = _text(m['label'], proofMaxContentLabel + 1);
    if (label.isEmpty) continue;
    if (label.length > proofMaxContentLabel) {
      return (contents: const [], error: 'contents_invalid');
    }
    final quantityRaw = m['quantity'] ?? 1;
    final quantity = quantityRaw is num
        ? (quantityRaw == quantityRaw.roundToDouble() ? quantityRaw.round() : null)
        : int.tryParse(quantityRaw.toString().trim());
    if (quantity == null || quantity < 1 || quantity > proofMaxContentQuantity) {
      return (contents: const [], error: 'contents_invalid');
    }
    final serial =
        _text(m['serial'], proofMaxSerial + 1).replaceAll(_serialChars, '').trim();
    if (serial.length > proofMaxSerial) {
      return (contents: const [], error: 'contents_invalid');
    }
    out.add(PackageContent(label: label, quantity: quantity, serial: serial));
  }
  if (out.length > proofMaxContents) {
    return (contents: const [], error: 'contents_invalid');
  }
  return (contents: out, error: '');
}

/// "2 phones, tablet, clothes" for a message or a row; serials left out.
/// Mirrors `contentsText`.
String contentsText(Iterable<PackageContent> contents, {int max = 120}) {
  final parts = [
    for (final c in contents)
      if (c.label.isNotEmpty) c.quantity > 1 ? '${c.quantity} ${c.label}' : c.label,
  ];
  final joined = parts.join(', ');
  if (joined.length <= max) return joined;
  final cut = joined.substring(0, max - 1 < 0 ? 0 : max - 1);
  return '${cut.replaceFirst(RegExp(r',?\s*\S*$'), '')}…';
}

// ---------------------------------------------------------------------------
// Weight and declared value.
// ---------------------------------------------------------------------------

/// Pounds with one decimal (`value`), or `error` "weight_invalid"; both null
/// when nothing was given. Mirrors `normalizeWeightLb`.
({double? value, String error}) normalizeWeightLb(Object? raw) {
  if (raw == null || (raw is String && raw.trim().isEmpty)) {
    return (value: null, error: '');
  }
  final n = raw is num
      ? raw.toDouble()
      : double.tryParse(raw.toString().trim().replaceAll(',', '.'));
  if (n == null || n.isNaN || n.isInfinite) {
    return (value: null, error: 'weight_invalid');
  }
  final rounded = (n * 10).round() / 10;
  if (rounded < proofMinWeightLb || rounded > proofMaxWeightLb) {
    return (value: null, error: 'weight_invalid');
  }
  return (value: rounded, error: '');
}

/// "4.2 lb" (en) or "4,2 lb" (fr); "" without a weight. Mirrors `weightText`.
String weightText(double? weightLb, [String lang = 'en']) {
  if (weightLb == null || weightLb.isNaN || weightLb <= 0) return '';
  var n = weightLb.toStringAsFixed(1);
  if (n.endsWith('.0')) n = n.substring(0, n.length - 2);
  return '${lang.toLowerCase().startsWith('fr') ? n.replaceAll('.', ',') : n} lb';
}

/// Whole cents at or above zero, or `error` "declared_value_invalid"; both
/// null when nothing was given. Mirrors `normalizeDeclaredValueCents`.
({int? value, String error}) normalizeDeclaredValueCents(Object? raw) {
  if (raw == null || (raw is String && raw.trim().isEmpty)) {
    return (value: null, error: '');
  }
  final n = raw is num ? raw : num.tryParse(raw.toString().trim());
  if (n == null ||
      n != n.roundToDouble() ||
      n < 0 ||
      n > proofMaxDeclaredValueCents) {
    return (value: null, error: 'declared_value_invalid');
  }
  return (value: n.round(), error: '');
}

/// Dollars as typed in the declared value field ("250", "12.50", "12,50",
/// "1,200") to cents; null when empty; -1 when unreadable.
int? declaredValueCentsFromInput(String input) {
  final text = input.replaceAll(RegExp(r'[\s$]'), '');
  if (text.isEmpty) return null;
  final lastComma = text.lastIndexOf(',');
  final lastDot = text.lastIndexOf('.');
  String whole;
  String fraction = '';
  if (lastComma < 0 && lastDot < 0) {
    whole = text;
  } else {
    final markAt = lastComma > lastDot ? lastComma : lastDot;
    final mark = text[markAt];
    final after = text.substring(markAt + 1);
    final before = text.substring(0, markAt);
    // "1,200" / "1.200" is a thousands group, "12,50" / "12.50" are cents.
    if (after.length == 3 && !before.contains(RegExp(r'[.,]'))) {
      whole = before + after;
    } else {
      // Anything before the decimal mark is whole dollars, grouped by
      // threes with the other mark ("1,200.50"), or plain digits.
      if (before.contains(RegExp(r'[.,]'))) {
        final groupMark = mark == '.' ? ',' : '.';
        if (before.contains(mark) ||
            !RegExp('^\\d{1,3}(\\$groupMark\\d{3})+\$').hasMatch(before)) {
          return -1;
        }
      }
      whole = before.replaceAll(RegExp(r'[.,]'), '');
      fraction = after;
    }
  }
  if (!RegExp(r'^\d*$').hasMatch(whole) || !RegExp(r'^\d{0,2}$').hasMatch(fraction)) {
    return -1;
  }
  if (whole.isEmpty && fraction.isEmpty) return -1;
  final dollars = int.tryParse(whole.isEmpty ? '0' : whole);
  if (dollars == null) return -1;
  final cents = int.parse(fraction.isEmpty ? '0' : fraction.padRight(2, '0'));
  return dollars * 100 + cents;
}

/// Cents back to the field: 1250 -> "12.50", 1200 -> "12".
String declaredValueInput(int? cents) {
  if (cents == null) return '';
  if (cents % 100 == 0) return (cents ~/ 100).toString();
  return (cents / 100).toStringAsFixed(2);
}

// ---------------------------------------------------------------------------
// The four fields together.
// ---------------------------------------------------------------------------

/// What the form typed for the proof fields, before it is checked.
class PackageProofDraft {
  const PackageProofDraft({
    this.photoPaths = const [],
    this.contents = const [],
    this.weightLb,
    this.declaredValueCents,
  });

  static const empty = PackageProofDraft();

  final List<String> photoPaths;
  final List<PackageContent> contents;

  /// As typed or as stored: a number, or a string the validator reads.
  final Object? weightLb;
  final Object? declaredValueCents;

  bool get isEmpty =>
      photoPaths.isEmpty &&
      contents.isEmpty &&
      (weightLb == null || weightLb.toString().trim().isEmpty) &&
      (declaredValueCents == null || declaredValueCents.toString().trim().isEmpty);
}

/// The proof fields as the server stores them.
class PackageProofFields {
  const PackageProofFields({
    this.photoPaths = const [],
    this.contents = const [],
    this.weightLb,
    this.declaredValueCents,
  });

  final List<String> photoPaths;
  final List<PackageContent> contents;
  final double? weightLb;
  final int? declaredValueCents;

  /// The keys every line callable takes (`addContainerLine` /
  /// `updateContainerLine` inside `line`, `addWaitingPackage` and
  /// `receivePackageRequest` at the top level).
  Map<String, Object?> toPayload() => {
        'photoPaths': photoPaths,
        'contents': [for (final c in contents) c.toMap()],
        'weightLb': weightLb,
        'declaredValueCents': declaredValueCents,
      };
}

/// The four fields checked together; the first problem's code, or "".
/// Mirrors `validateProofFields`.
({PackageProofFields fields, String error}) validateProofFields(
  PackageProofDraft draft,
) {
  final photos = normalizePhotoPaths(draft.photoPaths);
  if (photos.error.isNotEmpty) {
    return (fields: const PackageProofFields(), error: photos.error);
  }
  final contents = normalizeContents(draft.contents);
  if (contents.error.isNotEmpty) {
    return (fields: const PackageProofFields(), error: contents.error);
  }
  final weight = normalizeWeightLb(draft.weightLb);
  if (weight.error.isNotEmpty) {
    return (fields: const PackageProofFields(), error: weight.error);
  }
  final value = normalizeDeclaredValueCents(draft.declaredValueCents);
  if (value.error.isNotEmpty) {
    return (fields: const PackageProofFields(), error: value.error);
  }
  return (
    fields: PackageProofFields(
      photoPaths: photos.paths,
      contents: contents.contents,
      weightLb: weight.value,
      declaredValueCents: value.value,
    ),
    error: '',
  );
}

// ---------------------------------------------------------------------------
// The business's switches.
// ---------------------------------------------------------------------------

/// `businesses/{id}.packageProofSettings`; anything missing is off.
class PackageProofSettings {
  const PackageProofSettings({
    this.photosRequired = false,
    this.senderConfirm = false,
    this.pickupCode = false,
  });

  static const off = PackageProofSettings();

  final bool photosRequired;
  final bool senderConfirm;
  final bool pickupCode;

  /// Mirrors `proofSettingsOf`: reads the business document.
  factory PackageProofSettings.of(Map<String, dynamic>? business) {
    final raw = business?['packageProofSettings'];
    final m = raw is Map ? raw : const {};
    return PackageProofSettings(
      photosRequired: m['photosRequired'] == true,
      senderConfirm: m['senderConfirm'] == true,
      pickupCode: m['pickupCode'] == true,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is PackageProofSettings &&
      other.photosRequired == photosRequired &&
      other.senderConfirm == senderConfirm &&
      other.pickupCode == pickupCode;

  @override
  int get hashCode => Object.hash(photosRequired, senderConfirm, pickupCode);
}

/// The three switches from the business document. Mirrors `proofSettingsOf`.
PackageProofSettings proofSettingsOf(Map<String, dynamic>? business) =>
    PackageProofSettings.of(business);

/// Whether a counter drop-off may be saved without a photo: "" or
/// "photo_required". Mirrors `photoRequirementRefusal`.
String photoRequirementRefusal(
  PackageProofSettings settings, {
  String source = 'counter',
  List<String> photoPaths = const [],
}) {
  if (!settings.photosRequired) return '';
  if ((source.isEmpty ? 'counter' : source) != 'counter') return '';
  return photoPaths.isEmpty ? 'photo_required' : '';
}

// ---------------------------------------------------------------------------
// The sender's confirmation and the ticks.
// ---------------------------------------------------------------------------

/// The sender's WhatsApp answer as stored. Mirrors `senderConfirmationOf`.
class SenderConfirmation {
  const SenderConfirmation({
    this.status = senderConfirmationNone,
    this.askedAtMs = 0,
    this.answeredAtMs = 0,
    this.wamid = '',
    this.note = '',
  });

  static const none = SenderConfirmation();

  final String status;
  final int askedAtMs;
  final int answeredAtMs;
  final String wamid;
  final String note;

  factory SenderConfirmation.of(Object? raw) {
    final m = raw is Map ? raw : const {};
    final status = (m['status'] ?? '').toString();
    int ms(Object? v) => v is num ? v.round() : int.tryParse('$v') ?? 0;
    return SenderConfirmation(
      status: senderConfirmationStatuses.contains(status)
          ? status
          : senderConfirmationNone,
      askedAtMs: ms(m['askedAtMs']),
      answeredAtMs: ms(m['answeredAtMs']),
      wamid: _text(m['wamid'], 200),
      note: _text(m['note'], 500),
    );
  }

  bool get isAsked => status == senderConfirmationAsked;
  bool get isConfirmed => status == senderConfirmationConfirmed;
  bool get isProblem => status == senderConfirmationProblem;
}

/// The sender's confirmation of a stored line map.
SenderConfirmation senderConfirmationOf(Map<String, dynamic>? line) =>
    SenderConfirmation.of(line?['senderConfirmation']);

/// The three ticks a package shows (§1.11): drop-off photo, the sender's
/// answer, delivered. Derived, never stored. Mirrors `proofTicks`.
class ProofTicks {
  const ProofTicks({
    required this.photo,
    required this.senderOk,
    required this.delivered,
    this.deliveredWithoutCode = false,
  });

  final bool photo;

  /// One of [senderConfirmationStatuses].
  final String senderOk;
  final bool delivered;
  final bool deliveredWithoutCode;

  bool get complete =>
      photo && senderOk == senderConfirmationConfirmed && delivered;

  /// Missing proof (the Waiting list's filter): no photo, or a sender who
  /// has not said OK.
  bool get missing => !photo || senderOk != senderConfirmationConfirmed;

  @override
  bool operator ==(Object other) =>
      other is ProofTicks &&
      other.photo == photo &&
      other.senderOk == senderOk &&
      other.delivered == delivered &&
      other.deliveredWithoutCode == deliveredWithoutCode;

  @override
  int get hashCode => Object.hash(photo, senderOk, delivered, deliveredWithoutCode);

  @override
  String toString() =>
      'ProofTicks(photo: $photo, sender: $senderOk, delivered: $delivered)';
}

/// The ticks of a stored line map. Mirrors `proofTicks`.
ProofTicks proofTicksOf(Map<String, dynamic>? line) {
  final photos = line?['photoPaths'];
  return ProofTicks(
    photo: photos is Iterable && photos.isNotEmpty,
    senderOk: senderConfirmationOf(line).status,
    delivered: line?['deliveredAt'] != null,
    deliveredWithoutCode: line?['deliveredWithoutCode'] == true,
  );
}

// ---------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------

/// The proof refusal a callable's `details` carries (`reason`, or the first
/// of `reasons`), or "" when it is about something else.
String proofRefusalCode(Object? details) {
  if (details is! Map) return '';
  final reason = (details['reason'] ?? '').toString();
  if (proofRefusalCodes.contains(reason)) return reason;
  final reasons = details['reasons'];
  if (reasons is Iterable) {
    for (final r in reasons) {
      final code = (r ?? '').toString();
      if (proofRefusalCodes.contains(code)) return code;
    }
  }
  return '';
}

/// The packages a loading refusal names as `sender_problem` (§4.8): their
/// ids, or an empty list when the refusal is about something else.
List<String> senderProblemLineIds(Object? details) {
  if (details is! Map) return const [];
  if ((details['reason'] ?? '').toString() != loadWarningSenderProblem) {
    return const [];
  }
  final ids = <String>[];
  final raw = details['lineIds'];
  if (raw is Iterable) {
    for (final id in raw) {
      final clean = (id ?? '').toString().trim();
      if (clean.isNotEmpty && !ids.contains(clean)) ids.add(clean);
    }
  }
  final warnings = details['warnings'];
  if (warnings is Iterable) {
    for (final w in warnings) {
      if (w is! Map) continue;
      final clean = (w['lineId'] ?? '').toString().trim();
      if (clean.isNotEmpty && !ids.contains(clean)) ids.add(clean);
    }
  }
  return ids;
}
