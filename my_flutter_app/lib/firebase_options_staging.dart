// Firebase client configuration for the isolated staging project.
// API keys in Firebase client configuration identify the project; they are not
// server credentials. Server secrets remain in Firebase Secret Manager.
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;

abstract final class StagingFirebaseOptions {
  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyBWjpjUhrN7k49fJjA8u8GA_DmLc1frbTs',
    appId: '1:1000929000913:web:272d516813c004d44bf4f0',
    messagingSenderId: '1000929000913',
    projectId: 'laawol-digital-staging',
    authDomain: 'laawol-digital-staging.firebaseapp.com',
    storageBucket: 'laawol-digital-staging.firebasestorage.app',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyCzBYNSnXxiokohx6haGkFfnSAWOvp71j4',
    appId: '1:1000929000913:android:ecca5c92c63594044bf4f0',
    messagingSenderId: '1000929000913',
    projectId: 'laawol-digital-staging',
    storageBucket: 'laawol-digital-staging.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyBjIdUqdaIZyJmexFAyQ71aOD6ECLm2gFo',
    appId: '1:1000929000913:ios:b94019a646f1d60b4bf4f0',
    messagingSenderId: '1000929000913',
    projectId: 'laawol-digital-staging',
    storageBucket: 'laawol-digital-staging.firebasestorage.app',
    iosBundleId: 'com.laawoldigital.app',
  );
}
