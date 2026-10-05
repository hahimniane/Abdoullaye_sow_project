import 'package:cloud_firestore/cloud_firestore.dart';

/// A Firestore query written down as data before it is run.
///
/// The screens that list a business's records used to open listeners on the
/// whole collection - every parked car, every barrel, every invoice the lot
/// ever had - and pay a read per document each time they opened. The fix is
/// a narrower query, and a narrower query is only as good as three facts a
/// reviewer cannot see from a screen: it names the business, it is bounded
/// (a status/date scope, or an orderBy with a limit), and Firestore holds a
/// composite index for its exact shape. Writing the query as a spec makes all
/// three testable without Firebase: `test/firestore_query_scope_test.dart`
/// checks the scope and the bound, and checks [compositeIndex] against
/// `firestore.indexes.json`.
///
/// [build] is the only place a spec touches the SDK.
enum QueryFilterOp {
  equal,
  whereIn,
  notIn,
  notEqual,
  greaterOrEqual,
  less,
  isNull,
}

class QueryFilterSpec {
  const QueryFilterSpec(this.field, this.op, [this.value]);

  final String field;
  final QueryFilterOp op;
  final Object? value;

  /// Filters Firestore can serve by merging single-field indexes.
  bool get isEquality =>
      op == QueryFilterOp.equal ||
      op == QueryFilterOp.whereIn ||
      op == QueryFilterOp.isNull;

  bool get isRange =>
      op == QueryFilterOp.greaterOrEqual || op == QueryFilterOp.less;

  @override
  String toString() => '$field ${op.name} $value';
}

/// One field of a composite index, as `firestore.indexes.json` spells it.
class IndexFieldSpec {
  const IndexFieldSpec(this.fieldPath, {this.descending = false});

  final String fieldPath;
  final bool descending;

  String get order => descending ? 'DESCENDING' : 'ASCENDING';

  @override
  bool operator ==(Object other) =>
      other is IndexFieldSpec &&
      other.fieldPath == fieldPath &&
      other.descending == descending;

  @override
  int get hashCode => Object.hash(fieldPath, descending);

  @override
  String toString() => '$fieldPath $order';
}

class FirestoreQuerySpec {
  const FirestoreQuerySpec({
    required this.collection,
    this.filters = const <QueryFilterSpec>[],
    this.orderBy,
    this.descending = false,
    this.limit,
  });

  final String collection;
  final List<QueryFilterSpec> filters;
  final String? orderBy;
  final bool descending;
  final int? limit;

  /// The business this query is confined to, or '' when it names none.
  String get businessId {
    for (final filter in filters) {
      if (filter.field == 'businessId' && filter.op == QueryFilterOp.equal) {
        return '${filter.value ?? ''}'.trim();
      }
    }
    return '';
  }

  bool get isBusinessScoped => businessId.isNotEmpty;

  /// Whether the query reads a bounded slice rather than a whole history:
  /// an ordered page, a status scope, or a date window.
  ///
  /// A `limit` without an `orderBy` is never a bound - it is a random subset,
  /// which is how the ledger's expense totals went wrong past 2,000 rows.
  bool get isBounded {
    if (limit != null && orderBy == null) return false;
    if (limit != null) return true;
    return filters.any(
      (f) =>
          f.op == QueryFilterOp.notIn ||
          f.op == QueryFilterOp.notEqual ||
          f.op == QueryFilterOp.isNull ||
          f.isRange ||
          (f.field != 'businessId' &&
              (f.op == QueryFilterOp.equal || f.op == QueryFilterOp.whereIn)),
    );
  }

  /// The composite index Firestore needs for this exact shape, or null when
  /// merged single-field indexes serve it (equality filters only, no order).
  List<IndexFieldSpec>? get compositeIndex {
    final equalities = [
      for (final f in filters)
        if (f.isEquality) f.field,
    ];
    final inequalities = <String>{
      for (final f in filters)
        if (!f.isEquality) f.field,
    };
    assert(
      inequalities.length <= 1,
      'one inequality field per query keeps the index rule simple',
    );
    final inequality = inequalities.isEmpty ? null : inequalities.first;
    final order = orderBy ?? inequality;
    if (order == null) return null;
    assert(
      inequality == null || inequality == order,
      'the first orderBy must be the inequality field',
    );
    return <IndexFieldSpec>[
      for (final field in equalities)
        if (field != order) IndexFieldSpec(field),
      IndexFieldSpec(order, descending: orderBy != null && descending),
    ];
  }

  FirestoreQuerySpec copyWith({int? limit}) => FirestoreQuerySpec(
    collection: collection,
    filters: filters,
    orderBy: orderBy,
    descending: descending,
    limit: limit ?? this.limit,
  );

  Query<Map<String, dynamic>> build(FirebaseFirestore db) {
    Query<Map<String, dynamic>> query = db.collection(collection);
    for (final f in filters) {
      query = switch (f.op) {
        QueryFilterOp.equal => query.where(f.field, isEqualTo: f.value),
        QueryFilterOp.whereIn => query.where(
          f.field,
          whereIn: f.value as Iterable<Object?>,
        ),
        QueryFilterOp.notIn => query.where(
          f.field,
          whereNotIn: f.value as Iterable<Object?>,
        ),
        QueryFilterOp.notEqual => query.where(f.field, isNotEqualTo: f.value),
        QueryFilterOp.greaterOrEqual => query.where(
          f.field,
          isGreaterThanOrEqualTo: f.value,
        ),
        QueryFilterOp.less => query.where(f.field, isLessThan: f.value),
        QueryFilterOp.isNull => query.where(f.field, isNull: true),
      };
    }
    final order = orderBy;
    if (order != null) query = query.orderBy(order, descending: descending);
    final max = limit;
    if (max != null) query = query.limit(max);
    return query;
  }

  @override
  String toString() =>
      '$collection where ${filters.join(', ')}'
      '${orderBy == null ? '' : ' orderBy $orderBy${descending ? ' desc' : ''}'}'
      '${limit == null ? '' : ' limit $limit'}';
}

/// Rows from several narrow queries as one list, each document once - the
/// live copy wins, so an open record that also came back on a history page
/// shows its current state. Mirrors the server's `mergeRowsById`.
List<T> mergeById<T>(Iterable<Iterable<T>> lists, String Function(T) idOf) {
  final seen = <String, T>{};
  for (final list in lists) {
    for (final row in list) {
      final id = idOf(row);
      if (id.isEmpty) continue;
      seen.putIfAbsent(id, () => row);
    }
  }
  return seen.values.toList();
}
