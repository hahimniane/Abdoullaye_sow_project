import 'package:my_flutter_app/services/fleet_driver_service.dart';
import 'package:my_flutter_app/services/fleet_requests.dart' show FleetFailure;

/// A made-up `driver_home` answer (docs/FLEET.md section 11). No real person,
/// plate or business.
Map<String, dynamic> driverHomeAnswer({
  bool onlyFleet = true,
  int owedCents = 42500,
  int lateCents = 40000,
  int creditCents = 0,
  String status = 'active',
  bool zelle = true,
  bool claims = true,
  bool plates = true,
  String businessId = 'biz-dala',
  String businessName = 'Dala Fleet',
}) => {
  'success': true,
  'todayKey': '2026-12-05',
  'proofWhatsApp': '+16465550199',
  'onlyFleet': onlyFleet,
  'fleets': [
    {
      'businessId': businessId,
      'businessName': businessName,
      'businessPhone': '+16465550100',
      'onlyFleet': onlyFleet,
      'zelle': {
        'name': zelle ? 'Dala Fleet LLC' : '',
        'handle': zelle ? 'pay@dala.test' : '',
      },
      'driver': {
        'id': 'd1',
        'name': 'Awa Test',
        'status': status,
        'creditCents': creditCents,
      },
      'balance': {
        'owedCents': owedCents,
        'lateCents': lateCents,
        'nextDueDayKey': owedCents > lateCents ? '2026-12-08' : '',
        'nextDueCents': owedCents > lateCents ? owedCents - lateCents : 0,
      },
      'plates': [
        if (plates)
          {
            'assignmentId': 'a1',
            'plate': 'T100000C',
            'vehicleType': 'Toyota Camry',
            'ownership': 'driver',
            'registrationExpiry': '2027-06-01',
            'diamondExpiry': '2026-12-20',
            'insurer': 'Sample Mutual',
            'policyNumber': 'P-100',
            'rentCents': 40000,
            'period': 'monthly',
            'dueDay': 1,
            'startDayKey': '2026-01-10',
          },
      ],
      'bills': [
        if (owedCents > 0) ...[
          {
            'id': 'b-dec',
            'kind': 'rent',
            'label': 'Rent',
            'periodFrom': '2026-12-01',
            'periodTo': '2026-12-31',
            'dueDayKey': '2026-12-01',
            'amountCents': 40000,
            'paidCents': 0,
            'status': 'open',
          },
          {
            'id': 'b-fee',
            'kind': 'late_fee',
            'label': 'Late fee',
            'periodFrom': '',
            'periodTo': '',
            'dueDayKey': '2026-12-08',
            'amountCents': 2500,
            'paidCents': 0,
            'status': 'open',
          },
        ],
        {
          'id': 'b-nov',
          'kind': 'rent',
          'label': 'Rent',
          'periodFrom': '2026-11-01',
          'periodTo': '2026-11-30',
          'dueDayKey': '2026-11-01',
          'amountCents': 40000,
          'paidCents': 40000,
          'status': 'paid',
        },
      ],
      'payments': [
        {
          'id': 'p-nov',
          'amountCents': 40000,
          'method': 'zelle',
          'paidDayKey': '2026-11-02',
          'creditAddedCents': 0,
        },
        {
          'id': 'p-old',
          'amountCents': 40000,
          'method': 'import',
          'paidDayKey': '2026-10-01',
          'creditAddedCents': 0,
        },
      ],
      'claims': [
        if (claims)
          {
            'id': 'c1',
            'amountCents': 40000,
            'state': 'checking',
            'createdAtMs': DateTime(2026, 12, 4, 10).millisecondsSinceEpoch,
          },
      ],
    },
  ],
};

/// "Not a driver": what a regular customer's account gets.
Map<String, dynamic> notADriverAnswer() => {
  'success': true,
  'todayKey': '2026-12-05',
  'proofWhatsApp': '+16465550199',
  'onlyFleet': false,
  'fleets': <Object>[],
};

/// Answers from [answer] (a map, a [FleetFailure] to throw, or a function);
/// counts the calls.
class FakeFleetDriverService extends FleetDriverService {
  FakeFleetDriverService(this.answer);

  Object answer;
  int calls = 0;

  @override
  Future<Map<String, dynamic>> home() async {
    calls += 1;
    final a = answer;
    if (a is Future<Map<String, dynamic>> Function()) return a();
    if (a is FleetFailure) throw a;
    return Map<String, dynamic>.from(a as Map);
  }
}

class MemoryDriverHomeCache implements DriverHomeCache {
  final Map<String, String> kept = {};

  @override
  Future<String?> read(String uid) async => kept[uid];

  @override
  Future<void> write(String uid, String? raw) async {
    if (raw == null) {
      kept.remove(uid);
    } else {
      kept[uid] = raw;
    }
  }
}
