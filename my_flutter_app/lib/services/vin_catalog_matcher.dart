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
  final model = matchCatalogOption(modelOptions, decoded.model);
  if (model == null) {
    return VinCatalogMatch(
      make: make,
      model: null,
      year: null,
      modelOptions: modelOptions,
      yearOptions: const [],
    );
  }

  final yearOptions = yearsForModel(make, model);
  final year = matchCatalogOption(yearOptions, decoded.year);
  return VinCatalogMatch(
    make: make,
    model: model,
    year: year,
    modelOptions: modelOptions,
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
