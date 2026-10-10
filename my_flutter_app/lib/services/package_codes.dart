/// Package codes: reading the "CL-XXXXXX" a container line carries off
/// whatever a person or a camera hands us, and deciding where a tapped
/// tracking link should land.
///
/// Pure, so every rule here is unit-tested without Firebase or a camera:
/// the scan screen, the result view and the app-link router are thin glue
/// over these functions.
library;

/// The tracking-code alphabet: no 0/O, 1/I/L, no vowels. Mirrors
/// `TRACKING_ALPHABET` in `functions/tracking_code.js`.
const packageTrackingAlphabet = '23456789BCDFGHJKMNPQRSTVWXYZ';

/// Container lines carry the CL prefix (`functions/container_manifest.js`).
const packageCodePrefix = 'CL';

/// Where package labels and WhatsApp updates point.
const packageLinkHost = 'customer.laawoldigital.com';

final RegExp _packageCode =
    RegExp('^$packageCodePrefix([$packageTrackingAlphabet]{6})\$');

/// [raw] - a QR payload, a typed code, a pasted link - as "CL-XXXXXX", or
/// null when it holds no container-line code.
///
/// Accepts "CL-K7M4P2", "cl k7m4p2", "CLK7M4P2", the label's link
/// `https://customer.laawoldigital.com/t/CL-K7M4P2` (with or without the
/// scheme) and the older `/?service=tracking&code=CL-K7M4P2`. A link to any
/// other site is refused: a QR on someone else's box is not ours to read.
/// Normalising mirrors `normalizeTrackingCode` on the server, narrowed to
/// the CL prefix and the short alphabet, so "CL-K7M4P0" (a zero) is null.
String? packageCodeFromScan(String? raw) {
  final text = (raw ?? '').trim();
  if (text.isEmpty) return null;
  final link = _linkCandidate(text);
  if (link != null) return _normalize(link);
  if (text.contains('/') || text.contains('?')) return null;
  return _normalize(text);
}

/// The code an incoming app link carries, or null when the link is not a
/// package tracking link. Only the label host, and only `/t/<code>` or the
/// older `?service=tracking&code=` form.
String? packageCodeFromLink(Uri? uri) {
  if (uri == null) return null;
  final scheme = uri.scheme.toLowerCase();
  if (scheme != 'https' && scheme != 'http') return null;
  if (uri.host.toLowerCase() != packageLinkHost) return null;
  return packageCodeFromScan(uri.toString());
}

String? _normalize(String value) {
  final stripped = value.toUpperCase().replaceAll(RegExp('[^A-Z0-9]'), '');
  final match = _packageCode.firstMatch(stripped);
  return match == null ? null : '$packageCodePrefix-${match.group(1)}';
}

/// The code-bearing part of a Laawol link, or null when [text] is not one.
String? _linkCandidate(String text) {
  final lower = text.toLowerCase();
  final hasScheme = lower.startsWith('http://') || lower.startsWith('https://');
  if (!hasScheme && !lower.startsWith('$packageLinkHost/') &&
      !lower.startsWith('$packageLinkHost?')) {
    return null;
  }
  final uri = Uri.tryParse(hasScheme ? text : 'https://$text');
  if (uri == null || uri.host.toLowerCase() != packageLinkHost) return '';
  final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  if (segments.length >= 2 && segments.first.toLowerCase() == 't') {
    return segments[1];
  }
  final code = uri.queryParameters['code'];
  if (code != null && code.trim().isNotEmpty) return code;
  return '';
}

// ---------------------------------------------------------------------------
// Calling and messaging the people on a line.
// ---------------------------------------------------------------------------

/// `tel:` for [phone], keeping a leading "+" and the digits. Null when there
/// is nothing to dial.
Uri? packagePhoneCallUri(String phone) {
  final trimmed = phone.trim();
  final digits = trimmed.replaceAll(RegExp(r'\D'), '');
  if (digits.length < 5) return null;
  return Uri(scheme: 'tel', path: trimmed.startsWith('+') ? '+$digits' : digits);
}

/// `https://wa.me/<digits>` for [phone]. WhatsApp needs the full number
/// with its country code, so a number stored without "+" gets null rather
/// than a chat with a stranger in another country.
Uri? packageWhatsAppUri(String phone) {
  final trimmed = phone.trim().replaceAll(RegExp(r'[\s().-]'), '');
  if (!RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(trimmed)) return null;
  return Uri.parse('https://wa.me/${trimmed.substring(1)}');
}

// ---------------------------------------------------------------------------
// Where a tapped tracking link lands.
// ---------------------------------------------------------------------------

enum PackageLinkDestination {
  /// The business's own package view: owner, receiver, container, actions.
  staffPackage,

  /// The public tracking lookup, the code filled in and looked up - what a
  /// customer or anyone else holding the label gets.
  guestTracking,
}

/// Whether the person signed in may look the code up in a business's own
/// lines: a real (not anonymous) account with business access, the
/// containers permission, and a business to look in. The permission alone
/// is not enough - `hasBusinessPermission` answers yes for anyone who is not
/// staff, customers included.
bool packageLinkStaffEligible({
  required bool signedIn,
  required bool isAnonymous,
  required bool hasBusinessDashboardAccess,
  required bool hasContainersPermission,
  required String businessId,
}) =>
    signedIn &&
    !isAnonymous &&
    hasBusinessDashboardAccess &&
    hasContainersPermission &&
    businessId.trim().isNotEmpty;

/// The staff view only for eligible staff whose business holds the line;
/// everyone else, and staff holding another business's label, get the
/// public tracking page.
PackageLinkDestination packageLinkDestination({
  required bool staffEligible,
  required bool lineInBusiness,
}) =>
    staffEligible && lineInBusiness
        ? PackageLinkDestination.staffPackage
        : PackageLinkDestination.guestTracking;

// ---------------------------------------------------------------------------
// Printing labels.
// ---------------------------------------------------------------------------

const labelFormatSheet = 'sheet';
const labelFormatThermal = 'thermal';

/// How labels print: letter sheets (Avery 5524) or a 4x6 thermal roll, and
/// one or two per package. Two is the default (two sides of a barrel); one
/// is for replacing a single torn label.
class LabelPrintChoice {
  const LabelPrintChoice({
    this.format = labelFormatSheet,
    this.copies = 2,
  });

  final String format;
  final int copies;

  LabelPrintChoice copyWith({String? format, int? copies}) => LabelPrintChoice(
        format: format ?? this.format,
        copies: copies ?? this.copies,
      );

  @override
  bool operator ==(Object other) =>
      other is LabelPrintChoice &&
      other.format == format &&
      other.copies == copies;

  @override
  int get hashCode => Object.hash(format, copies);
}

/// The `getContainerDocumentUrl` payload for labels: the whole container,
/// or one line's labels when [lineId] is given. Format and copies are
/// clamped to what the server accepts (`labelFormat` / `labelCopies`).
///
/// With no [containerId] - packages still waiting for a container - the
/// server asks for the lines by id instead (`lineIds`, 1..100): [lineIds],
/// else the one [lineId].
Map<String, Object> containerLabelsRequest({
  required String businessId,
  required String containerId,
  required LabelPrintChoice choice,
  String lineId = '',
  List<String> lineIds = const [],
}) {
  final byLines = containerId.trim().isEmpty;
  final ids = {
    for (final id in [...lineIds, lineId])
      if (id.trim().isNotEmpty) id.trim(),
  }.toList();
  return {
    'businessId': businessId,
    'containerId': containerId,
    'view': 'labels',
    'format':
        choice.format == labelFormatThermal ? labelFormatThermal : labelFormatSheet,
    'copies': choice.copies == 1 ? 1 : 2,
    if (byLines && ids.isNotEmpty) 'lineIds': ids,
    if (!byLines && lineId.trim().isNotEmpty) 'lineId': lineId.trim(),
  };
}
