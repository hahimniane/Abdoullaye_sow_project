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
    apiKey: 'AIzaSyDyz6neM8FSEgO2v01UZECeSGTAuTuFmQg', // new project web app apiKey
    appId: '1:127318353394:web:877e3c653bfcce7ec5776b',
    messagingSenderId: projectNumber,
    projectId: projectId,
    authDomain: 'laawol-a855a.firebaseapp.com',
    storageBucket: 'laawol-a855a.firebasestorage.app',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyCRCTpw_pH0XQ_dsbE7SGIIILNcb5cGEco', // new project android apiKey
    appId: '1:127318353394:android:ff257491e3e691bcc5776b',
    messagingSenderId: projectNumber,
    projectId: projectId,
    storageBucket: 'laawol-a855a.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyDIee2dyRW2o26ghNt3vDra4EtgYInBAT8', // new project iOS apiKey
    appId: '1:127318353394:ios:920363c21e47717bc5776b',
    messagingSenderId: projectNumber,
    projectId: projectId,
    storageBucket: 'laawol-a855a.firebasestorage.app',
    iosBundleId: 'com.laawoldigital.app',
    // The iOS OAuth client (GoogleService-Info.plist CLIENT_ID), used by
    // Sign in with Google; ios/Runner/Info.plist carries it as GIDClientID
    // and its reversed form as a URL scheme.
    iosClientId: googleIosClientId,
  );

  /// Sign in with Google: the iOS OAuth client of the iOS app.
  static const String googleIosClientId =
      '127318353394-3t82qud6k4s4deunvj2oaaqocuqh08h6.apps.googleusercontent.com';

  /// Sign in with Google: the project's WEB OAuth client (client_type 3 in
  /// google-services.json). Android and iOS ask Google for an ID token whose
  /// audience is this client, which is the one Firebase Auth accepts.
  static const String googleServerClientId =
      '127318353394-hfp1jf3abq7j13it7ug201ccv7fpj1hu.apps.googleusercontent.com';

  /// True once [options] carries every value a real client needs.
  static bool isConfigured(FirebaseOptions options) =>
      options.apiKey.isNotEmpty && options.appId.isNotEmpty;
}
