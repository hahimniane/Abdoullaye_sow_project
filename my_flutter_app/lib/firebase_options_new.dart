// NEW_PROJECT_CONFIG: Firebase client configuration for the project production
// moves to (laawol-a855a, project number 127318353394).
//
// The apiKey and appId of each client exist only after that client is
// registered in the new project (Firebase console -> Project settings -> Your
// apps, or `flutterfire configure --project=laawol-a855a`). They are EMPTY
// ON PURPOSE: FirebaseEnvironmentOptions refuses to hand out options that
// still carry a placeholder, so selecting `--dart-define=FIREBASE_ENV=new`
// before they are pasted in fails with a clear StateError instead of booting
// against a half-configured project. Never invent or copy another project's
// values here. API keys in Firebase client configuration identify the
// project; they are not server credentials.
//
// The native files that cannot be switched from Dart must be replaced at
// cutover too: android/app/google-services.json, ios/Runner/Info.plist's
// `app-<number>-ios-<id>` URL scheme, macos/Runner/GoogleService-Info.plist and
// macos/firebase_app_id_file.json. See docs/PROJECT_MIGRATION.md.
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;

abstract final class NewProjectFirebaseOptions {
  static const String projectId = 'laawol-a855a';
  static const String projectNumber = '127318353394';

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: '', // TODO(cutover): web app apiKey
    appId: '', // TODO(cutover): 1:127318353394:web:...
    messagingSenderId: projectNumber,
    projectId: projectId,
    authDomain: 'laawol-a855a.firebaseapp.com',
    storageBucket: 'laawol-a855a.firebasestorage.app',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: '', // TODO(cutover): android app apiKey (google-services.json)
    appId: '', // TODO(cutover): 1:127318353394:android:...
    messagingSenderId: projectNumber,
    projectId: projectId,
    storageBucket: 'laawol-a855a.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: '', // TODO(cutover): iOS app apiKey (GoogleService-Info.plist)
    appId: '', // TODO(cutover): 1:127318353394:ios:...
    messagingSenderId: projectNumber,
    projectId: projectId,
    storageBucket: 'laawol-a855a.firebasestorage.app',
    iosBundleId: 'com.laawoldigital.app',
  );

  /// True once [options] carries every value a real client needs.
  static bool isConfigured(FirebaseOptions options) =>
      options.apiKey.isNotEmpty && options.appId.isNotEmpty;
}
