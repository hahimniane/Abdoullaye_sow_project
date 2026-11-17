import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../utils/callable_data.dart';
import 'barrel_shipment_service.dart' show BarrelShipmentService;
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// "Getting paid": a business's Stripe payout setup, the fees it pays and the
/// documents Laawol needs before it is approved. The Dart twin of the website's
/// payout panel (`admin_web/src/lib/payout-status.ts`,
/// `business-verification.ts`); keep them in step. Pure rules live here; the
/// network and the picker are behind functions the screen takes, so a widget
/// test answers in place of Firebase.

/// Where Stripe sends the owner back to after setup: the business console.
const stripeReturnUrl = 'https://business.laawoldigital.com/';

/// The largest document Laawol takes, and the server's limit (strictly under).
const verificationMaxBytes = 20 * 1024 * 1024;

/// How long a call may take before the screen says so: loading resolves.
const gettingPaidTimeout = Duration(seconds: 25);

// ---------------------------------------------------------------------------
// Payout status.
// ---------------------------------------------------------------------------

enum PayoutState { notConnected, pending, ready }

class PayoutStatus {
  const PayoutStatus({
    required this.state,
    this.stripeAccountId = '',
    this.chargesEnabled = false,
    this.payoutsEnabled = false,
    this.currentlyDue = 0,
    this.pendingVerification = 0,
  });

  final PayoutState state;
  final String stripeAccountId;
  final bool chargesEnabled;
  final bool payoutsEnabled;

  /// Stripe requirements due now or past due (counted from `stripeRequirements`).
  final int currentlyDue;
  final int pendingVerification;

  bool get ready => state == PayoutState.ready;
  bool get hasAccount => stripeAccountId.isNotEmpty;
}

List<String> _strings(Object? v) => [
  if (v is List)
    for (final item in v)
      if (callableString(item).isNotEmpty) callableString(item),
];

/// The status from the business document (mirrors `resolveBusinessPayoutStatus`):
/// payouts count only when charges are on too.
PayoutStatus resolvePayoutStatus(Map<String, Object?> business) {
  final account = callableString(business['stripeAccountId']);
  final charges = business['chargesEnabled'] == true;
  final payouts = charges && business['payoutsEnabled'] == true;
  final requirements = callableMap(business['stripeRequirements']);
  final due =
      _strings(requirements['currentlyDue']).length +
      _strings(requirements['pastDue']).length;
  final pending = _strings(requirements['pendingVerification']).length;
  return PayoutStatus(
    state: account.isEmpty
        ? PayoutState.notConnected
        : payouts
        ? PayoutState.ready
        : PayoutState.pending,
    stripeAccountId: account,
    chargesEnabled: charges,
    payoutsEnabled: payouts,
    currentlyDue: due,
    pendingVerification: pending,
  );
}

// ---------------------------------------------------------------------------
// Fees (`getBusinessFeeSettings`, read only).
// ---------------------------------------------------------------------------

class BusinessFeeSettings {
  const BusinessFeeSettings({
    this.stripeFeeMode = '',
    this.connectReady = false,
    this.defaultPlatformFeePct = 0,
    this.hasBusinessOverride = false,
  });

  factory BusinessFeeSettings.fromCallable(Object? raw) {
    final d = callableMap(raw);
    return BusinessFeeSettings(
      stripeFeeMode: callableString(d['stripeFeeMode']),
      connectReady: d['connectReady'] == true,
      defaultPlatformFeePct: callableDouble(d['defaultPlatformFeePct']),
      hasBusinessOverride: d['hasBusinessOverride'] == true,
    );
  }

  final String stripeFeeMode;
  final bool connectReady;

  /// A fraction: 0.025 is 2.5%.
  final double defaultPlatformFeePct;
  final bool hasBusinessOverride;

  /// The business pays Stripe's processing fee itself.
  bool get businessPaysProcessing =>
      stripeFeeMode == 'business_absorbs_processing_fee';

  /// "2.50%", the way the website shows it.
  String get platformFeeText =>
      '${(defaultPlatformFeePct * 100).toStringAsFixed(2)}%';

  /// Set to pay the fee itself but Stripe is not ready, so it does not apply yet.
  bool get processingNotYetActive => businessPaysProcessing && !connectReady;
}

// ---------------------------------------------------------------------------
// Verification documents (mirrors `business-verification.ts`).
// ---------------------------------------------------------------------------

enum VerificationStatus {
  missing,
  submitted,
  verified,
  needsChanges,
  notApplicable,
}

class VerificationRequirement {
  const VerificationRequirement(
    this.id,
    this.services, [
    this.aliases = const [],
  ]);

  final String id;
  final List<String> services;
  final List<String> aliases;
}

const verificationRequirements = [
  VerificationRequirement(
    'shippingAuthority',
    ['barrelShipping', 'sharedBarrels', 'freight'],
    ['freightLicense', 'shippingLicense', 'warehouseAgreement'],
  ),
  VerificationRequirement(
    'dealerLicense',
    ['carSales'],
    ['autoDealerLicense', 'salesLicense'],
  ),
  VerificationRequirement(
    'parkingFacilityProof',
    ['carParking'],
    ['parkingLease', 'facilityProof'],
  ),
  VerificationRequirement(
    'transportInsurance',
    ['carTransport'],
    ['carrierAuthority', 'transportAuthority', 'commercialAutoInsurance'],
  ),
];

class VerificationEvidence {
  const VerificationEvidence({
    this.present = false,
    this.label = '',
    this.url = '',
  });

  final bool present;
  final String label;
  final String url;
}

class VerificationItem {
  const VerificationItem({
    required this.id,
    required this.status,
    this.evidence = const VerificationEvidence(),
    this.reviewNote = '',
  });

  final String id;
  final VerificationStatus status;
  final VerificationEvidence evidence;

  /// What the Laawol reviewer wrote about this document.
  final String reviewNote;
}

class VerificationSummary {
  const VerificationSummary({
    this.total = 0,
    this.complete = 0,
    this.approvalReady = true,
  });

  final int total;

  /// Verified plus not needed.
  final int complete;
  final bool approvalReady;
}

VerificationStatus? _statusOf(Object? v) => switch (callableString(v)) {
  'missing' => VerificationStatus.missing,
  'submitted' => VerificationStatus.submitted,
  'verified' => VerificationStatus.verified,
  'needs_changes' => VerificationStatus.needsChanges,
  'not_applicable' => VerificationStatus.notApplicable,
  _ => null,
};

VerificationEvidence? _evidenceOf(Object? v) {
  if (v is String && v.trim().isNotEmpty) {
    final t = v.trim();
    return VerificationEvidence(
      present: true,
      label: t.split('/').last.isEmpty ? 'Document' : t.split('/').last,
      url: t.startsWith('http') ? t : '',
    );
  }
  if (v is! Map) return null;
  final o = callableMap(v);
  String first(List<String> keys) {
    for (final k in keys) {
      final s = callableString(o[k]);
      if (s.isNotEmpty) return s;
    }
    return '';
  }

  final url = first(['url', 'fileUrl', 'downloadUrl', 'publicUrl']);
  final path = first(['path', 'storagePath']);
  final name = first(['fileName', 'name', 'title']).isNotEmpty
      ? first(['fileName', 'name', 'title'])
      : (path.isEmpty ? '' : path.split('/').last);
  if (url.isEmpty && path.isEmpty && name.isEmpty) return null;
  return VerificationEvidence(
    present: true,
    label: name.isNotEmpty
        ? name
        : (path.split('/').last.isEmpty ? 'Document' : path.split('/').last),
    url: url,
  );
}

String _entryType(Map<String, Object?> o) {
  for (final k in [
    'id',
    'type',
    'documentId',
    'documentType',
    'requirementId',
  ]) {
    final s = callableString(o[k]);
    if (s.isNotEmpty) return s;
  }
  return '';
}

VerificationEvidence _evidenceFor(
  Map<String, Object?> row,
  VerificationRequirement r,
) {
  final keys = [r.id, ...r.aliases];
  final docs = row['verificationDocuments'];
  if (docs is Map) {
    final map = callableMap(docs);
    for (final k in keys) {
      final e = _evidenceOf(map[k]);
      if (e != null) return e;
    }
  }
  if (docs is List) {
    for (final c in docs) {
      if (c is! Map) continue;
      final o = callableMap(c);
      if (keys.contains(_entryType(o))) {
        final e = _evidenceOf(o);
        if (e != null) return e;
      }
    }
  }
  for (final k in keys) {
    for (final field in [k, '${k}Url', '${k}FileUrl', '${k}Path']) {
      final e = _evidenceOf(row[field]);
      if (e != null) return e;
    }
  }
  return const VerificationEvidence();
}

VerificationStatus? _providedStatus(
  Map<String, Object?> row,
  VerificationRequirement r,
) {
  final keys = [r.id, ...r.aliases];
  final docs = row['verificationDocuments'];
  if (docs is Map) {
    final map = callableMap(docs);
    for (final k in keys) {
      final o = callableMap(map[k]);
      final s = _statusOf(o['status']) ?? _statusOf(o['reviewStatus']);
      if (s != null) return s;
    }
  }
  if (docs is List) {
    for (final c in docs) {
      if (c is! Map) continue;
      final o = callableMap(c);
      if (!keys.contains(_entryType(o))) continue;
      final s = _statusOf(o['status']) ?? _statusOf(o['reviewStatus']);
      if (s != null) return s;
    }
  }
  return null;
}

/// The business's services from every place the document keeps them.
List<String> verificationServicesOf(Map<String, Object?> row) {
  final out = <String>{};
  for (final k in [
    'enabledServices',
    'businessServices',
    'services',
    'serviceIds',
  ]) {
    out.addAll(_strings(row[k]));
  }
  return out.toList();
}

/// The documents this business must give, with each one's status, file and the
/// reviewer's note (mirrors `buildBusinessVerificationChecklist`).
List<VerificationItem> buildVerificationChecklist(Map<String, Object?> row) {
  final services = verificationServicesOf(row).toSet();
  final review = callableMap(
    callableMap(row['verificationReview'])['documents'],
  );
  return [
    for (final r in verificationRequirements)
      if (r.services.any(services.contains))
        () {
          final evidence = _evidenceFor(row, r);
          final entry = callableMap(review[r.id]);
          return VerificationItem(
            id: r.id,
            evidence: evidence,
            status:
                _statusOf(entry['status']) ??
                _providedStatus(row, r) ??
                (evidence.present
                    ? VerificationStatus.submitted
                    : VerificationStatus.missing),
            reviewNote: callableString(entry['note']),
          );
        }(),
  ];
}

VerificationSummary summarizeVerification(List<VerificationItem> items) {
  var complete = 0;
  for (final i in items) {
    if (i.status == VerificationStatus.verified ||
        i.status == VerificationStatus.notApplicable) {
      complete++;
    }
  }
  return VerificationSummary(
    total: items.length,
    complete: complete,
    approvalReady: complete == items.length,
  );
}

/// The reviewer's overall note on the application (`verificationReview.note`,
/// else `reviewNote`).
String verificationReviewNote(Map<String, Object?> row) {
  final review = callableMap(row['verificationReview']);
  final note = callableString(review['note']);
  return note.isNotEmpty ? note : callableString(row['reviewNote']);
}

// ---------------------------------------------------------------------------
// The file to upload.
// ---------------------------------------------------------------------------

const _documentTypes = {
  'pdf': 'application/pdf',
  'doc': 'application/msword',
  'docx':
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'heic': 'image/heic',
  'webp': 'image/webp',
  'gif': 'image/gif',
};

/// The extensions the picker offers.
List<String> get verificationExtensions => _documentTypes.keys.toList();

/// The content type for a picked file: its own when it is one the server
/// takes, else read from the name; null for a file Laawol does not take.
String? verificationContentType(String fileName, String? mimeType) {
  final given = (mimeType ?? '').trim().toLowerCase();
  if (given.startsWith('image/') || _documentTypes.values.contains(given)) {
    return given;
  }
  final dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  return _documentTypes[fileName.substring(dot + 1).toLowerCase()];
}

/// What is wrong with a picked file before it is sent: `type`, `empty`,
/// `too_big`, or '' when it is fine (PDF, Word or an image, under 20 MB).
String verificationFileProblem(String fileName, String? mimeType, int bytes) {
  if (verificationContentType(fileName, mimeType) == null) return 'type';
  if (bytes <= 0) return 'empty';
  if (bytes >= verificationMaxBytes) return 'too_big';
  return '';
}

/// A file the person chose, before it is read: its name, the type the system
/// gave it (may be null) and how to read its bytes.
class ChosenFile {
  const ChosenFile({required this.name, required this.read, this.mimeType});

  final String name;
  final String? mimeType;
  final Future<Uint8List> Function() read;
}

/// A picked document, ready to send.
class PickedDocument {
  const PickedDocument({
    required this.name,
    required this.bytes,
    required this.contentType,
  });

  final String name;
  final Uint8List bytes;
  final String contentType;

  int get size => bytes.length;
}

// ---------------------------------------------------------------------------
// The calls.
// ---------------------------------------------------------------------------

/// A refused or failed call, in a form the screen can word.
class GettingPaidFailure implements Exception {
  const GettingPaidFailure({required this.code, this.reason = ''});

  final String code;
  final String reason;

  bool get offline =>
      code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'network-request-failed';
  bool get permission => code == 'permission-denied';

  @override
  String toString() => 'GettingPaidFailure($code $reason)';
}

/// The business's Stripe link, status, fees and document upload.
class GettingPaidService {
  GettingPaidService({
    this.caller = callContainerCallable,
    this.timeout = gettingPaidTimeout,
    Future<String> Function(String businessId)? stripeLink,
    Future<void> Function(String businessId)? refreshStatus,
  }) : _stripeLink = stripeLink,
       _refreshStatus = refreshStatus;

  final ContainerCallableCaller caller;
  final Duration timeout;
  final Future<String> Function(String businessId)? _stripeLink;
  final Future<void> Function(String businessId)? _refreshStatus;

  Future<T> _guard<T>(Future<T> Function() work) async {
    try {
      return await work().timeout(timeout);
    } on FirebaseFunctionsException catch (error) {
      throw GettingPaidFailure(
        code: error.code.trim().toLowerCase(),
        reason: callableString(callableMap(error.details)['reason']),
      );
    } on GettingPaidFailure {
      rethrow;
    } on TimeoutException {
      throw const GettingPaidFailure(code: 'unavailable');
    } catch (error) {
      final text = error.toString().toLowerCase();
      final offline =
          text.contains('socket') ||
          text.contains('network') ||
          text.contains('connection');
      throw GettingPaidFailure(code: offline ? 'unavailable' : 'unknown');
    }
  }

  /// `getBusinessFeeSettings`: what the business pays, as a real charge would.
  Future<BusinessFeeSettings> feeSettings(String businessId) => _guard(
    () async => BusinessFeeSettings.fromCallable(
      await caller('getBusinessFeeSettings', {'businessId': businessId}),
    ),
  );

  /// `createBusinessStripeAccountLink`: the Stripe setup page to open in the
  /// browser. Creates the Stripe account the first time.
  Future<Uri> setupLink(String businessId) => _guard(() async {
    final url =
        await (_stripeLink?.call(businessId) ??
            BarrelShipmentService().createBusinessStripeAccountLink(
              businessId: businessId,
              returnUrl: stripeReturnUrl,
              refreshUrl: stripeReturnUrl,
            ));
    final uri = Uri.tryParse(url);
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) {
      throw const GettingPaidFailure(code: 'unknown');
    }
    return uri;
  });

  /// `refreshBusinessStripeAccountStatus`: asks Stripe and saves the answer on
  /// the business; the screen's live read then shows it.
  Future<void> refreshStatus(String businessId) => _guard(() async {
    final custom = _refreshStatus;
    if (custom != null) return custom(businessId);
    return BarrelShipmentService().refreshBusinessStripeAccountStatus(
      businessId: businessId,
    );
  });

  /// `uploadBusinessVerificationDocument`: one file for one required document.
  Future<void> uploadDocument({
    required String businessId,
    required String documentId,
    required PickedDocument file,
  }) => _guard(() async {
    final answer = callableMap(
      await caller('uploadBusinessVerificationDocument', {
        'businessId': businessId,
        'documentId': documentId,
        'fileName': file.name,
        'contentType': file.contentType,
        'size': file.size,
        'base64': base64Encode(file.bytes),
      }),
    );
    if (answer['success'] != true) {
      throw const GettingPaidFailure(code: 'unknown');
    }
  });
}

// ---------------------------------------------------------------------------
// The business, live.
// ---------------------------------------------------------------------------

/// A live read of the business document, behind an interface so the screen is
/// tested with a fake.
abstract interface class BusinessDocSource {
  Stream<Map<String, Object?>?> watch(String businessId);
}

class FirestoreBusinessDocSource implements BusinessDocSource {
  const FirestoreBusinessDocSource();

  @override
  Stream<Map<String, Object?>?> watch(String businessId) => FirebaseFirestore
      .instance
      .collection('businesses')
      .doc(businessId)
      .snapshots()
      .map((snap) => snap.exists ? callableMap(snap.data()) : null);
}
