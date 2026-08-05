import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;

class CarModelEntry {
  CarModelEntry({
    required this.brand,
    required this.model,
    required this.startYear,
    required this.endYear,
  });

  final String brand;
  final String model;
  final int startYear;
  final int? endYear;

  factory CarModelEntry.fromJson(Map<String, dynamic> json) {
    final endYearValue = json['endYear'];
    int? parsedEndYear;
    if (endYearValue is int) {
      parsedEndYear = endYearValue;
    } else if (endYearValue is String && endYearValue.toLowerCase() == 'present') {
      parsedEndYear = DateTime.now().year;
    }
    return CarModelEntry(
      brand: (json['brand'] as String).trim(),
      model: (json['model'] as String).trim(),
      startYear: json['startYear'] as int,
      endYear: parsedEndYear,
    );
  }
}

class CarCatalog {
  CarCatalog._();

  static final CarCatalog instance = CarCatalog._();

  bool _isLoaded = false;

  /// Whether [load] has completed. Callers that may run before loading
  /// finishes should check this instead of catching the assertion - the
  /// getters throw rather than returning empty when read too early.
  bool get isLoaded => _isLoaded;
  final Map<String, List<CarModelEntry>> _entriesByBrand = {};

  Future<void> load() async {
    if (_isLoaded) return;
    final jsonString =
        await rootBundle.loadString('assets/data/car_models_flutter.json');
    final List<dynamic> data = jsonDecode(jsonString);
    for (final dynamic item in data) {
      if (item is Map<String, dynamic>) {
        final entry = CarModelEntry.fromJson(item);
        _entriesByBrand.putIfAbsent(entry.brand, () => []).add(entry);
      }
    }
    _isLoaded = true;
  }

  List<String> getMakes() {
    _assertLoaded();
    final makes = _entriesByBrand.keys.toList();
    makes.sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    return makes;
  }

  /// Canonical catalog spelling for a make, whatever casing was stored.
  ///
  /// Records created before the cascading pickers carry free-text makes and
  /// models in whatever casing the customer typed ("toyota", "rav4"). An
  /// exact-key lookup finds nothing for those, leaving an empty dropdown the
  /// customer cannot change, so resolve to the catalog's own spelling first.
  /// Returns an empty string when the make is not in the catalog at all.
  String canonicalMake(String brand) {
    _assertLoaded();
    final raw = brand.trim();
    if (raw.isEmpty) return '';
    final target = raw.toLowerCase();
    for (final key in _entriesByBrand.keys) {
      if (key.toLowerCase() == target) return key;
    }
    return '';
  }

  /// Canonical catalog spelling for a model within a make, or '' if unknown.
  String canonicalModel(String brand, String model) {
    final raw = model.trim();
    if (raw.isEmpty) return '';
    final target = raw.toLowerCase();
    for (final option in getModels(brand)) {
      if (option.toLowerCase() == target) return option;
    }
    return '';
  }

  List<String> getModels(String brand) {
    _assertLoaded();
    final resolved = canonicalMake(brand);
    final entries = _entriesByBrand[resolved.isEmpty ? brand : resolved] ?? [];
    final models = <String>{};
    for (final entry in entries) {
      if (entry.model.isNotEmpty) {
        models.add(entry.model);
      }
    }
    final sorted = models.toList()
      ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    return sorted;
  }

  List<String> getYears(String brand, String model) {
    _assertLoaded();
    final resolved = canonicalMake(brand);
    final entries = _entriesByBrand[resolved.isEmpty ? brand : resolved] ?? [];
    final target = model.trim().toLowerCase();
    final years = <int>{};
    for (final entry in entries) {
      if (entry.model.toLowerCase() == target) {
        final endYear = entry.endYear ?? DateTime.now().year;
        for (int year = entry.startYear; year <= endYear; year++) {
          years.add(year);
        }
      }
    }
    final sorted = years.toList()..sort((a, b) => b.compareTo(a));
    return sorted.map((year) => year.toString()).toList();
  }

  void _assertLoaded() {
    if (!_isLoaded) {
      throw StateError(
        'CarCatalog.load() must be called before accessing data.',
      );
    }
  }
}

