import 'vin_decoder_service.dart';

class VinCatalogMatch {
  const VinCatalogMatch({
    required this.make,
    required this.model,
    required this.year,
    required this.modelOptions,
    required this.yearOptions,
  });

  final String? make;
  final String? model;
  final String? year;
  final List<String> modelOptions;
  final List<String> yearOptions;

  bool get isComplete => make != null && model != null && year != null;
}

VinCatalogMatch matchDecodedVehicleToCatalog({
  required DecodedVehicleInfo decoded,
  required List<String> makeOptions,
  required List<String> Function(String make) modelsForMake,
  required List<String> Function(String make, String model) yearsForModel,
}) {
  final make = matchCatalogOption(makeOptions, decoded.make);
  if (make == null) {
    return const VinCatalogMatch(
      make: null,
      model: null,
      year: null,
      modelOptions: [],
      yearOptions: [],
    );
  }

  final modelOptions = modelsForMake(make);
  final model =
      matchCatalogOption(modelOptions, decoded.model) ??
      _matchDecodedModel(modelOptions, decoded.model) ??
      _decodedModelFallback(decoded.model);
  if (model == null) {
    return VinCatalogMatch(
      make: make,
      model: null,
      year: null,
      modelOptions: modelOptions,
      yearOptions: const [],
    );
  }

  final allModelOptions = modelOptions.contains(model)
      ? modelOptions
      : <String>[model, ...modelOptions];
  final catalogYearOptions = yearsForModel(make, model);
  final decodedYear = _decodedYearFallback(decoded.year);
  final yearOptions =
      decodedYear != null && !catalogYearOptions.contains(decodedYear)
      ? <String>[decodedYear, ...catalogYearOptions]
      : catalogYearOptions;
  final year = matchCatalogOption(yearOptions, decoded.year) ?? decodedYear;
  return VinCatalogMatch(
    make: make,
    model: model,
    year: year,
    modelOptions: allModelOptions,
    yearOptions: yearOptions,
  );
}

String? matchCatalogOption(List<String> options, String? value) {
  final normalized = value?.trim().toLowerCase();
  if (normalized == null || normalized.isEmpty) return null;
  for (final option in options) {
    if (option.trim().toLowerCase() == normalized) {
      return option;
    }
  }
  return null;
}

String? _matchDecodedModel(List<String> options, String? value) {
  final normalized = _normalizeModel(value);
  if (normalized == null) return null;

  for (final option in options) {
    final optionNormalized = _normalizeModel(option);
    if (optionNormalized == null) continue;

    final compactOption = optionNormalized.replaceAll(' ', '');
    final compactDecoded = normalized.replaceAll(' ', '');

    if (_looksLikeModelCode(compactOption) &&
        (compactDecoded == compactOption ||
            compactDecoded.startsWith(compactOption))) {
      return option;
    }
  }

  return null;
}

String? _decodedModelFallback(String? value) {
  final trimmed = value?.trim();
  if (trimmed == null || trimmed.isEmpty) return null;

  final codeMatch = RegExp(
    r'^[A-Za-z]{1,4}\d[A-Za-z0-9-]*',
  ).firstMatch(trimmed);
  if (codeMatch != null) {
    return codeMatch.group(0)?.toUpperCase();
  }

  return trimmed.replaceAll(RegExp(r'\s+'), ' ');
}

String? _decodedYearFallback(String? value) {
  final trimmed = value?.trim();
  if (trimmed == null || trimmed.isEmpty) return null;
  final yearMatch = RegExp(r'(19|20)\d{2}').firstMatch(trimmed);
  return yearMatch?.group(0);
}

String? _normalizeModel(String? value) {
  final trimmed = value?.trim().toLowerCase();
  if (trimmed == null || trimmed.isEmpty) return null;
  return trimmed
      .replaceAll(RegExp(r'[^a-z0-9]+'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
}

bool _looksLikeModelCode(String value) {
  return RegExp(r'^[a-z]{1,4}\d[a-z0-9-]*$').hasMatch(value);
}
