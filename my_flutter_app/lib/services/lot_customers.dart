/// The lot's customer memory, app side. Mirrors
/// `functions/lot_customers.js`: the server remembers every customer typed
/// onto a ledger activity or a walk-up, with the cars seen against them; this
/// offers them back as staff type. Pure Dart, tested without Firebase.
library;

class LotCustomerCar {
  const LotCustomerCar({
    required this.vin,
    required this.make,
    required this.model,
    required this.year,
  });

  final String vin;
  final String make;
  final String model;
  final String year;

  /// "2019 Toyota Camry · 1HG…" - the way the picker labels a car.
  String get label {
    final name = [year, make, model].where((p) => p.isNotEmpty).join(' ');
    return [name, vin].where((p) => p.isNotEmpty).join(' · ');
  }
}

class LotCustomer {
  const LotCustomer({
    required this.id,
    required this.name,
    required this.phone,
    required this.email,
    required this.cars,
    required this.lastSeenMs,
    this.staff = false,
  });

  final String id;
  final String name;
  final String phone;
  final String email;
  final List<LotCustomerCar> cars;
  final int lastSeenMs;

  /// True when this is one of the business's own people rather than a
  /// remembered customer. A lot parks its own staff's cars, and nobody should
  /// have to be filed as a customer first.
  final bool staff;

  static String _s(Object? v, [int max = 200]) {
    final t = (v ?? '').toString().trim();
    return t.length > max ? t.substring(0, max) : t;
  }

  /// A stored `lotCustomers` document, as the picker needs it.
  factory LotCustomer.fromMap(String id, Map<String, dynamic> data) {
    final rawCars = data['cars'];
    final cars = <LotCustomerCar>[];
    if (rawCars is List) {
      for (final c in rawCars) {
        if (c is Map) {
          cars.add(LotCustomerCar(
            vin: _s(c['vin'], 17).toUpperCase(),
            make: _s(c['make'], 80),
            model: _s(c['model'], 80),
            year: _s(c['year'], 8),
          ));
        }
      }
    }
    final seen = data['lastSeenAt'];
    int ms = 0;
    if (seen != null) {
      try {
        ms = (seen as dynamic).millisecondsSinceEpoch as int;
      } catch (_) {
        try {
          ms = ((seen as dynamic).seconds as int) * 1000;
        } catch (_) {}
      }
    }
    return LotCustomer(
      id: id,
      name: _s(data['name'], 120),
      phone: _s(data['phone'], 40),
      email: _s(data['email'], 180),
      cars: cars,
      lastSeenMs: ms,
    );
  }

  /// One of the business's own people, offered as someone who can be the
  /// customer. Returns null for a row with nothing to show or nothing to fill.
  static LotCustomer? fromStaff(String id, Map<String, dynamic> data) {
    final name = _s(data['fullName'] ?? data['displayName'] ?? data['name'], 120);
    final email = _s(data['email'], 180).toLowerCase();
    final phone = _s(data['phone'] ?? data['phoneNumber'], 40);
    if (name.isEmpty && email.isEmpty) return null;
    return LotCustomer(
      id: 'staff:${id.isNotEmpty ? id : (email.isNotEmpty ? email : name)}',
      name: name.isNotEmpty ? name : email,
      phone: phone,
      email: email,
      cars: const [],
      lastSeenMs: 0,
      staff: true,
    );
  }
}

/// The people the picker can offer: everyone the lot remembers, plus its own
/// staff. A saved customer wins a tie because they carry cars and a real last
/// seen; a staff row only carries contact details.
List<LotCustomer> lotCustomerSources(
  List<LotCustomer> saved,
  List<LotCustomer> staff,
) {
  String identity(LotCustomer c) {
    final d = _digits(c.phone);
    if (d.isNotEmpty) return d;
    if (c.email.isNotEmpty) return c.email.toLowerCase();
    return c.name.trim().toLowerCase();
  }

  final seen = <String>{};
  final out = <LotCustomer>[];
  for (final customer in [...saved, ...staff]) {
    final key = identity(customer);
    if (key.isEmpty || !seen.add(key)) continue;
    out.add(customer);
  }
  return out;
}

String _digits(String v) => v.replaceAll(RegExp(r'\D+'), '');

/// The customers that match what staff typed, best first. Same ranking as
/// the server: name prefix, then word prefix, then anywhere; phone digits,
/// email and any car's VIN also match; ties break on how recently seen.
List<LotCustomer> matchLotCustomers(
  List<LotCustomer> customers,
  String query, {
  int limit = 6,
}) {
  final q = query.trim().toLowerCase();
  final qd = _digits(q);
  if (q.length < 2) return const [];
  final scored = <(LotCustomer, int)>[];
  for (final c in customers) {
    final name = c.name.toLowerCase();
    final email = c.email.toLowerCase();
    final phone = _digits(c.phone);
    var score = 0;
    if (name.startsWith(q)) {
      score = 4;
    } else if (name.split(' ').any((w) => w.startsWith(q))) {
      score = 3;
    } else if (name.contains(q)) {
      score = 2;
    }
    if (qd.length >= 3 && phone.contains(qd) && score < 3) score = 3;
    if (email.isNotEmpty && email.startsWith(q) && score < 3) score = 3;
    if (c.cars.any((car) => car.vin.isNotEmpty && car.vin.toLowerCase().contains(q)) && score < 2) {
      score = 2;
    }
    if (score > 0) scored.add((c, score));
  }
  scored.sort((a, b) {
    final byScore = b.$2.compareTo(a.$2);
    return byScore != 0 ? byScore : b.$1.lastSeenMs.compareTo(a.$1.lastSeenMs);
  });
  return scored.take(limit).map((e) => e.$1).toList();
}
