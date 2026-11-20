import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:my_flutter_app/services/fleet.dart';
import 'package:my_flutter_app/services/fleet_service.dart';

/// Stands in for Firestore behind [FleetController]: holds the Fleet data and
/// the business document, and hands every listener the latest of each.
class FakeFleetSource implements FleetSource {
  FakeFleetSource({
    FleetData data = FleetData.empty,
    Map<String, dynamic>? business,
    List<FleetClaim> claims = const [],
  }) : _data = data,
       _business = business ?? const {},
       _claims = claims;

  FleetData _data;
  Map<String, dynamic> _business;
  final _dataListeners = <StreamController<FleetData>>[];
  final _businessListeners = <StreamController<Map<String, dynamic>>>[];
  List<FleetClaim> _claims;
  final _claimListeners = <StreamController<List<FleetClaim>>>[];

  /// Make the data read fail with this error instead of answering.
  Object? failWith;

  /// Make the claims read fail (the rest of Fleet keeps working).
  Object? claimsFailWith;

  void setClaims(List<FleetClaim> claims) {
    _claims = claims;
    for (final c in _claimListeners) {
      c.add(claims);
    }
  }

  void set(FleetData data) {
    _data = data;
    for (final c in _dataListeners) {
      c.add(data);
    }
  }

  void setBusiness(Map<String, dynamic> business) {
    _business = business;
    for (final c in _businessListeners) {
      c.add(business);
    }
  }

  @override
  Stream<FleetData> watch(String businessId) {
    final c = StreamController<FleetData>();
    _dataListeners.add(c);
    if (failWith != null) {
      scheduleMicrotask(() => c.addError(failWith!));
    } else {
      scheduleMicrotask(() => c.add(_data));
    }
    return c.stream;
  }

  @override
  Stream<List<FleetClaim>> watchClaims(String businessId) {
    final c = StreamController<List<FleetClaim>>();
    _claimListeners.add(c);
    if (claimsFailWith != null) {
      scheduleMicrotask(() => c.addError(claimsFailWith!));
    } else {
      scheduleMicrotask(() => c.add(_claims));
    }
    return c.stream;
  }

  @override
  Stream<Map<String, dynamic>> watchBusiness(String businessId) {
    final c = StreamController<Map<String, dynamic>>();
    _businessListeners.add(c);
    scheduleMicrotask(() => c.add(_business));
    return c.stream;
  }
}

FirebaseFunctionsException fleetRefusal(
  String reason, {
  String code = 'failed-precondition',
}) => FirebaseFunctionsException(
  message: 'refused',
  code: code,
  details: {'reason': reason},
);

/// A small stand-in for the server: answers `fleetAction`, records every
/// request, and applies the effect of the actions the tests use to a
/// [FakeFleetSource] (so the screens show what the server would have written).
class FakeFleetBackend {
  FakeFleetBackend(this.source);

  final FakeFleetSource source;
  final calls = <Map<String, Object?>>[];

  /// Throw this for the next call of the named action (then cleared).
  final errors = <String, Object>{};

  /// What `bank_status` answers.
  Object? bankAnswer;

  /// What `claim_photo` answers as `url` (null: no photo).
  String? photoUrl = 'https://example.test/shot.png';

  /// With no url: true is "deleted after 12 months", false just no photo.
  bool photoDeleted = true;

  /// What `assignment_update` answers as `effectiveDayKey`.
  String effectiveDayKey = '2026-12-01';

  /// When set, every call waits for it.
  Completer<void>? gate;

  FleetData get data => source._data;

  FleetService get service => FleetService(caller: call);

  List<Map<String, Object?>> of(String action) => [
    for (final c in calls)
      if (c['action'] == action) c,
  ];

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    calls.add(payload);
    final wait = gate;
    if (wait != null) await wait.future;
    final action = payload['action'] as String;
    final error = errors.remove(action);
    if (error != null) throw error;
    switch (action) {
      case 'payment_record':
        return _record(payload);
      case 'payment_undo':
        return _undo(payload);
      case 'driver_save':
        return _driverSave(payload);
      case 'assignment_start':
        return _assignmentStart(payload);
      case 'bank_status':
        return bankAnswer ?? {'success': true};
      case 'claim_photo':
        return {
          'success': true,
          'url': photoUrl,
          'deleted': photoUrl == null && photoDeleted,
        };
      case 'claim_assign':
      case 'claim_close':
        // The server closes the claim: it leaves the open list.
        source.setClaims([
          for (final c in source._claims)
            if (c.id != payload['claimId']) c,
        ]);
        return {'success': true};
      case 'payer_names_save':
        return _payerNames(payload);
      case 'assignment_update':
        return {'success': true, 'effectiveDayKey': effectiveDayKey};
      case 'driver_leave':
        return _driverLeave(payload);
      default:
        return {'success': true};
    }
  }

  Map<String, Object?> _record(Map<String, Object?> p) {
    final driverId = p['driverId'] as String;
    final amount = p['amountCents'] as int;
    final open = [
      for (final b in data.bills)
        if (b.driverId == driverId && b.isOpen) b,
    ];
    final plan = fleetAllocatePayment(open, amount);
    final paidMore = {for (final a in plan.allocations) a.billId: a.cents};
    final bills = [
      for (final b in data.bills)
        if (paidMore.containsKey(b.id))
          FleetBill(
            id: b.id,
            driverId: b.driverId,
            kind: b.kind,
            label: b.label,
            dueDayKey: b.dueDayKey,
            amountCents: b.amountCents,
            paidCents: b.paidCents + paidMore[b.id]!,
            status: b.paidCents + paidMore[b.id]! >= b.amountCents
                ? 'paid'
                : 'open',
          )
        else
          b,
    ];
    final payments = [
      ...data.payments,
      FleetPayment(
        id: 'p-new-${data.payments.length}',
        driverId: driverId,
        amountCents: amount,
        method: p['method'] as String,
        paidDayKey: p['paidDayKey'] as String,
        creditAddedCents: plan.creditAddedCents,
      ),
    ];
    _put(
      FleetData(
        drivers: data.drivers,
        cars: data.cars,
        assignments: data.assignments,
        bills: bills,
        payments: payments,
        notes: data.notes,
        friends: data.friends,
      ),
    );
    return {'success': true, 'creditAddedCents': plan.creditAddedCents};
  }

  Map<String, Object?> _undo(Map<String, Object?> p) {
    final id = p['paymentId'] as String;
    final target = data.payments.firstWhere((x) => x.id == id);
    final paidBack = {
      for (final b in data.bills)
        b.id: b.driverId == target.driverId ? target.amountCents : 0,
    };
    final bills = [
      for (final b in data.bills)
        FleetBill(
          id: b.id,
          driverId: b.driverId,
          kind: b.kind,
          label: b.label,
          dueDayKey: b.dueDayKey,
          amountCents: b.amountCents,
          paidCents: (b.paidCents - (paidBack[b.id] ?? 0)).clamp(
            0,
            b.amountCents,
          ),
          status: 'open',
        ),
    ];
    final payments = [
      for (final x in data.payments)
        if (x.id == id)
          FleetPayment(
            id: x.id,
            driverId: x.driverId,
            amountCents: x.amountCents,
            method: x.method,
            paidDayKey: x.paidDayKey,
            status: 'undone',
          )
        else
          x,
    ];
    _put(
      FleetData(
        drivers: data.drivers,
        cars: data.cars,
        assignments: data.assignments,
        bills: bills,
        payments: payments,
        notes: data.notes,
        friends: data.friends,
      ),
    );
    return {'success': true};
  }

  Map<String, Object?> _driverSave(Map<String, Object?> p) {
    final d = p['driver'] as Map;
    final id = (p['driverId'] as String?) ?? 'd-new';
    final drivers = [
      for (final x in data.drivers)
        if (x.id != id) x,
      FleetDriver(
        id: id,
        name: d['name'] as String,
        phone: d['phone'] as String,
      ),
    ];
    _put(
      FleetData(
        drivers: drivers,
        cars: data.cars,
        assignments: data.assignments,
        bills: data.bills,
        payments: data.payments,
        notes: data.notes,
        friends: data.friends,
      ),
    );
    return {'success': true, 'driverId': id};
  }

  Map<String, Object?> _payerNames(Map<String, Object?> p) {
    final names = fleetCleanPayerNames(p['names'] as List);
    _put(
      FleetData(
        drivers: [
          for (final d in data.drivers)
            if (d.id == p['driverId'])
              FleetDriver(
                id: d.id,
                name: d.name,
                phone: d.phone,
                payerNames: names,
              )
            else
              d,
        ],
        cars: data.cars,
        assignments: data.assignments,
        bills: data.bills,
        payments: data.payments,
        notes: data.notes,
        friends: data.friends,
      ),
    );
    return {'success': true, 'names': names};
  }

  Map<String, Object?> _driverLeave(Map<String, Object?> p) {
    final id = p['driverId'] as String;
    _put(
      FleetData(
        drivers: [
          for (final d in data.drivers)
            if (d.id == id)
              FleetDriver(
                id: d.id,
                name: d.name,
                phone: d.phone,
                status: 'left',
              )
            else
              d,
        ],
        cars: data.cars,
        assignments: [
          for (final a in data.assignments)
            if (a.driverId == id && a.isOpen)
              FleetAssignment(
                id: a.id,
                carId: a.carId,
                driverId: a.driverId,
                startDayKey: a.startDayKey,
                endDayKey: p['endDayKey'] as String,
                rentCents: a.rentCents,
                dueDay: a.dueDay,
              )
            else
              a,
        ],
        bills: data.bills,
        payments: data.payments,
        notes: data.notes,
        friends: data.friends,
      ),
    );
    return {'success': true, 'ended': 1};
  }

  Map<String, Object?> _assignmentStart(Map<String, Object?> p) {
    final carId = p['carId'] as String;
    if (data.assignments.any((a) => a.carId == carId && a.isOpen)) {
      throw fleetRefusal('fleet_car_taken');
    }
    _put(
      FleetData(
        drivers: data.drivers,
        cars: data.cars,
        assignments: [
          ...data.assignments,
          FleetAssignment(
            id: 'a-new',
            carId: carId,
            driverId: p['driverId'] as String,
            startDayKey: p['startDayKey'] as String,
            rentCents: p['rentCents'] as int,
            period: p['period'] as String,
            dueDay: p['dueDay'] as int,
          ),
        ],
        bills: data.bills,
        payments: data.payments,
        notes: data.notes,
        friends: data.friends,
      ),
    );
    return {'success': true, 'assignmentId': 'a-new'};
  }

  void _put(FleetData next) => source.set(next);
}
