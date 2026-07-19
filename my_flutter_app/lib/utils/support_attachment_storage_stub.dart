import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';

Future<void> putSupportXFile({
  required Reference reference,
  required XFile file,
  required SettableMetadata metadata,
}) {
  throw UnsupportedError('Support attachment uploads are unavailable.');
}
