import 'dart:convert';

import 'package:http/http.dart' as http;

import '../utils/vin_utils.dart';

class DecodedVehicleInfo {
  const DecodedVehicleInfo({
    required this.vin,
    this.make,
    this.model,
    this.year,
    this.trim,
    this.bodyClass,
    this.engine,
    this.fuelType,
  });

  final String vin;
  final String? make;
  final String? model;
  final String? year;
  final String? trim;
  final String? bodyClass;
  final String? engine;
  final String? fuelType;

  bool get hasIdentity =>
      _hasValue(make) || _hasValue(model) || _hasValue(year);

  String get summary {
    final parts = [
      year,
      make,
      model,
      trim,
    ].where((value) => _hasValue(value)).map((value) => value!.trim()).toList();
    return parts.join(' ');
  }

  static bool _hasValue(String? value) =>
      value != null && value.trim().isNotEmpty;
}

abstract class VinDecoderService {
  Future<DecodedVehicleInfo> decode(String vin);
}

class VinDecodeException implements Exception {
  const VinDecodeException(this.message);

  final String message;

  @override
  String toString() => message;
}

class NhtsaVinDecoderService implements VinDecoderService {
  NhtsaVinDecoderService({http.Client? client})
    : _client = client ?? http.Client();

  final http.Client _client;

  @override
  Future<DecodedVehicleInfo> decode(String vin) async {
    final normalizedVin = normalizeVin(vin);
    if (!isValidVin(normalizedVin)) {
      throw const VinDecodeException('Invalid VIN');
    }

    final uri = Uri.https(
      'vpic.nhtsa.dot.gov',
      '/api/vehicles/DecodeVinValues/$normalizedVin',
      {'format': 'json'},
    );
    final response = await _client
        .get(uri)
        .timeout(const Duration(seconds: 10));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw VinDecodeException('VIN decoder failed (${response.statusCode})');
    }

    return parseNhtsaVinResponse(normalizedVin, jsonDecode(response.body));
  }
}

DecodedVehicleInfo parseNhtsaVinResponse(String vin, Object? payload) {
  if (payload is! Map<String, dynamic>) {
    throw const VinDecodeException('VIN decoder returned an invalid response');
  }
  final results = payload['Results'];
  if (results is! List || results.isEmpty || results.first is! Map) {
    throw const VinDecodeException('VIN decoder returned no vehicle details');
  }

  final data = Map<String, dynamic>.from(results.first as Map);
  final errorCode = _clean(data['ErrorCode']);
  final errorText = _clean(data['ErrorText']);
  final hasBlockingError =
      errorCode != null && errorCode.isNotEmpty && !errorCode.startsWith('0');
  if (hasBlockingError && !_hasIdentity(data)) {
    throw VinDecodeException(errorText ?? 'VIN could not be decoded');
  }

  final decoded = DecodedVehicleInfo(
    vin: normalizeVin(_clean(data['VIN']) ?? vin),
    make: _clean(data['Make']),
    model: _clean(data['Model']),
    year: _clean(data['ModelYear']),
    trim: _clean(data['Trim']),
    bodyClass: _clean(data['BodyClass']),
    engine: _engineSummary(data),
    fuelType: _clean(data['FuelTypePrimary']),
  );
  if (!decoded.hasIdentity) {
    throw const VinDecodeException('VIN decoder returned no vehicle identity');
  }
  return decoded;
}

bool _hasIdentity(Map<String, dynamic> data) {
  return _clean(data['Make']) != null ||
      _clean(data['Model']) != null ||
      _clean(data['ModelYear']) != null;
}

String? _engineSummary(Map<String, dynamic> data) {
  final cylinders = _clean(data['EngineCylinders']);
  final displacement = _clean(data['DisplacementL']);
  final parts = [
    _clean(data['EngineConfiguration']),
    cylinders == null ? null : '$cylinders cyl',
    displacement == null ? null : '${displacement}L',
  ].whereType<String>().where((value) => value.isNotEmpty).toList();
  return parts.isEmpty ? null : parts.join(' ');
}

String? _clean(Object? value) {
  if (value == null) return null;
  final text = value.toString().trim();
  if (text.isEmpty || text.toLowerCase() == 'not applicable') return null;
  return text;
}
