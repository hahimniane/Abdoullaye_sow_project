import 'package:flutter/services.dart';

class VinTextRecognitionException implements Exception {
  const VinTextRecognitionException(this.message);

  final String message;

  @override
  String toString() => message;
}

class VinTextRecognitionService {
  const VinTextRecognitionService();

  static const MethodChannel _channel = MethodChannel(
    'com.autosales.myFlutterApp/vin_text_recognition',
  );

  Future<String> recognizeText(String imagePath) async {
    try {
      final text = await _channel.invokeMethod<String>('recognizeText', {
        'path': imagePath,
      });
      return text ?? '';
    } on PlatformException catch (error) {
      throw VinTextRecognitionException(
        error.message ?? 'VIN text recognition failed',
      );
    } on MissingPluginException {
      throw const VinTextRecognitionException(
        'VIN text recognition is unavailable on this platform',
      );
    }
  }
}
