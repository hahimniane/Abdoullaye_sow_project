/// The lot's customer memory, app side. Mirrors
/// `functions/lot_customers.js`: the server remembers every customer typed
/// onto a ledger activity or a walk-up - a name and a phone number, never a
/// car - and this offers them back as staff type. Pure Dart, tested without
/// Firebase.
library;

class LotCustomer {
  const LotCustomer({
    required this.id,
    required this.name,
    required this.phone,
    required this.email,
    required this.lastSeenMs,
    this.staff = false,
  });

  final String id;
  final String name;
  final String phone;
  final String email;
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
    // A customer is a name and a phone number, nothing more. Any car stored
    // against a legacy record is ignored - the vehicle belongs to the parking
    // record, filled from its VIN, not to the person.
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
      lastSeenMs: 0,
      staff: true,
    );
  }
}

/// The people the picker can offer: everyone the lot remembers, plus its own
/// staff. A saved customer wins a tie because they carry a real last seen; a
/// staff row only carries contact details.
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
/// the server: name prefix, then word prefix, then anywhere; phone digits
/// and email also match; ties break on how recently seen.
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
    if (score > 0) scored.add((c, score));
  }
  scored.sort((a, b) {
    final byScore = b.$2.compareTo(a.$2);
    return byScore != 0 ? byScore : b.$1.lastSeenMs.compareTo(a.$1.lastSeenMs);
  });
  return scored.take(limit).map((e) => e.$1).toList();
}
