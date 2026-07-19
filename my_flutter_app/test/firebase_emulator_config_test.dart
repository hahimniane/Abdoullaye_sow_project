import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/firebase_emulator_config.dart';

void main() {
  const configured = FirebaseOptions(
    apiKey: 'api-key',
    appId: 'app-id',
    messagingSenderId: 'sender-id',
    projectId: 'production-project',
    authDomain: 'production.example',
    storageBucket: 'production-bucket',
    iosBundleId: 'com.laawoldigital.app',
  );

  test('emulator options isolate database and function calls by project', () {
    final options = firebaseOptionsForProject(configured, ' demo-laawol-e2e ');

    expect(options.projectId, 'demo-laawol-e2e');
    expect(options.apiKey, configured.apiKey);
    expect(options.appId, configured.appId);
    expect(options.messagingSenderId, configured.messagingSenderId);
    expect(options.iosBundleId, configured.iosBundleId);
  });

  test('emulator project ID cannot be empty', () {
    expect(() => firebaseOptionsForProject(configured, '  '), throwsStateError);
  });
}
