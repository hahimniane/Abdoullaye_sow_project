/// Normalizes HTTPS-callable payloads for Dart.
///
/// Cloud Functions returns nested `Map<Object?, Object?>` values. Casting
/// those to `Map<String, dynamic>` throws, which previously aborted the
/// freight catalog parse and left Send freight empty.
Map<String, dynamic> callableMap(dynamic value) {
  if (value is Map) {
    return {
      for (final entry in value.entries)
        entry.key.toString(): decodeCallableValue(entry.value),
    };
  }
  return <String, dynamic>{};
}

dynamic decodeCallableValue(dynamic value) {
  if (value is Map) return callableMap(value);
  if (value is List) {
    return [for (final item in value) decodeCallableValue(item)];
  }
  return value;
}

double callableDouble(dynamic value) {
  if (value is num && value.isFinite) return value.toDouble();
  if (value is String) {
    final parsed = double.tryParse(value.trim());
    if (parsed != null && parsed.isFinite) return parsed;
  }
  return 0;
}

int callableInt(dynamic value) {
  if (value is num && value.isFinite) return value.truncate();
  if (value is String) {
    final parsed = int.tryParse(value.trim());
    if (parsed != null) return parsed;
  }
  return 0;
}

bool callableBool(dynamic value) => value == true;

String callableString(dynamic value, [String fallback = '']) {
  if (value == null) return fallback;
  final text = value.toString().trim();
  return text.isEmpty ? fallback : text;
}
