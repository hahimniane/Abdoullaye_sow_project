/// The lot ledger's VIN duplicate rule, as the app reads it (owner decision
/// 2026-10-22).
///
/// The rule lives on the server (`functions/lot_ledger.js`): the same car,
/// job and customer is refused (`vin_job_duplicate`); the same car and job for
/// another customer asks first (`vin_job_repeat_confirm`) and is resent with
/// `confirmRepeat: true`. The "Possible duplicates" list is the server's too -
/// `getLotLedgerTotals` with `action: 'vinDuplicates'`, over every activity of
/// the business, because the ledger only loads the months on screen and a
/// duplicate can sit months apart. Mirrors the console's
/// `admin_web/src/lib/lot-vin-duplicates.ts`; this file only parses.
library;

import '../utils/callable_data.dart';
import 'lot_ledger.dart';

/// One earlier record a refusal names.
class LotVinJobExisting {
  const LotVinJobExisting({
    required this.activityId,
    required this.trackingCode,
    required this.activityDate,
    required this.customerName,
  });

  final String activityId;
  final String trackingCode;
  final DateTime? activityDate;
  final String customerName;

  factory LotVinJobExisting.fromMap(Map<String, dynamic> map) =>
      LotVinJobExisting(
        activityId: (map['activityId'] ?? '').toString(),
        trackingCode: (map['trackingCode'] ?? '').toString(),
        activityDate: lotDateOf(_nonEmpty(map['activityDate'])),
        customerName: (map['customerName'] ?? '').toString(),
      );
}

Object? _nonEmpty(Object? value) =>
    value is String && value.trim().isEmpty ? null : value;

enum LotVinJobRefusalKind {
  /// Same car, job and customer: refused.
  duplicate,

  /// Same car and job, another customer: allowed once confirmed.
  repeat,
}

class LotVinJobRefusal {
  const LotVinJobRefusal({required this.kind, required this.existing});

  final LotVinJobRefusalKind kind;

  /// The records it repeats, oldest first (one for a duplicate).
  final List<LotVinJobExisting> existing;
}

/// The rule's refusal in a callable error's `details`, or null for any other
/// error. Reads the `reason` the server sets, never the message.
LotVinJobRefusal? lotVinJobRefusalFrom(Object? details) {
  final map = callableMap(details);
  switch (map['reason']) {
    case 'vin_job_duplicate':
      return LotVinJobRefusal(
        kind: LotVinJobRefusalKind.duplicate,
        existing: [
          LotVinJobExisting(
            activityId: (map['existingActivityId'] ?? '').toString(),
            trackingCode: (map['existingTrackingCode'] ?? '').toString(),
            activityDate: lotDateOf(_nonEmpty(map['existingActivityDate'])),
            customerName: (map['existingCustomerName'] ?? '').toString(),
          ),
        ],
      );
    case 'vin_job_repeat_confirm':
      final list = map['existing'];
      return LotVinJobRefusal(
        kind: LotVinJobRefusalKind.repeat,
        existing: [
          if (list is List)
            for (final row in list)
              LotVinJobExisting.fromMap(callableMap(row)),
        ],
      );
    default:
      return null;
  }
}

/// One car + job recorded more than once.
class LotDuplicateGroup {
  const LotDuplicateGroup({
    required this.key,
    required this.vinKey,
    required this.jobKey,
    required this.jobLabel,
    required this.sameCustomer,
    required this.activities,
  });

  final String key;
  final String vinKey;
  final String jobKey;
  final String jobLabel;

  /// Two of its records are for the same customer: likely a mistake.
  /// Otherwise every one is a different customer - maybe a resale.
  final bool sameCustomer;

  /// Oldest first.
  final List<LotActivity> activities;
}

/// The groups out of a `vinDuplicates` answer. Anything malformed is dropped,
/// and a group needs two records to be one.
List<LotDuplicateGroup> lotDuplicateGroupsFrom(Object? data) {
  final list = callableMap(data)['duplicates'];
  if (list is! List) return const [];
  final groups = <LotDuplicateGroup>[];
  for (final raw in list) {
    final row = callableMap(raw);
    final members = row['activities'];
    final activities = <LotActivity>[
      if (members is List)
        for (final member in members)
          if ((callableMap(member)['id'] ?? '').toString().isNotEmpty)
            LotActivity.fromMap(
              callableMap(member)['id'].toString(),
              callableMap(member),
            ),
    ];
    if (activities.length < 2) continue;
    final vinKey = (row['vinKey'] ?? '').toString();
    final jobKey = (row['jobKey'] ?? '').toString();
    final key = (row['key'] ?? '').toString();
    groups.add(LotDuplicateGroup(
      key: key.isEmpty ? '$vinKey|$jobKey' : key,
      vinKey: vinKey,
      jobKey: jobKey,
      jobLabel: (row['jobLabel'] ?? '').toString(),
      sameCustomer: row['sameCustomer'] == true,
      activities: activities,
    ));
  }
  return groups;
}

/// "…3A004352": the last 8 characters of a VIN.
String lotVinTail(String vin) {
  final key = vin.toUpperCase().replaceAll(RegExp(r'\s+'), '');
  if (key.isEmpty) return '';
  return '…${key.length > 8 ? key.substring(key.length - 8) : key}';
}

/// The English article a job's name takes: `an` before a vowel, else `other`
/// (the ARB select's value; French ignores it).
String lotJobArticle(String job) =>
    RegExp(r'^[aeiou]', caseSensitive: false).hasMatch(job.trim())
        ? 'an'
        : 'other';
