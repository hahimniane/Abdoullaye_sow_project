import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';

const useFirebaseEmulators = bool.fromEnvironment('USE_FIREBASE_EMULATORS');
const firebaseEmulatorProjectId = String.fromEnvironment(
  'FIREBASE_EMULATOR_PROJECT_ID',
  defaultValue: 'demo-laawol-e2e',
);

FirebaseOptions firebaseOptionsForRuntime(FirebaseOptions configuredOptions) {
  if (!useFirebaseEmulators) return configuredOptions;

  return firebaseOptionsForProject(
    configuredOptions,
    firebaseEmulatorProjectId,
  );
}

FirebaseOptions firebaseOptionsForProject(
  FirebaseOptions configuredOptions,
  String requestedProjectId,
) {
  final projectId = requestedProjectId.trim();
  if (projectId.isEmpty) {
    throw StateError(
      'FIREBASE_EMULATOR_PROJECT_ID must not be empty when Firebase '
      'emulators are enabled.',
    );
  }

  return FirebaseOptions(
    apiKey: configuredOptions.apiKey,
    appId: configuredOptions.appId,
    messagingSenderId: configuredOptions.messagingSenderId,
    projectId: projectId,
    authDomain: configuredOptions.authDomain,
    databaseURL: configuredOptions.databaseURL,
    storageBucket: configuredOptions.storageBucket,
    measurementId: configuredOptions.measurementId,
    trackingId: configuredOptions.trackingId,
    deepLinkURLScheme: configuredOptions.deepLinkURLScheme,
    androidClientId: configuredOptions.androidClientId,
    iosClientId: configuredOptions.iosClientId,
    iosBundleId: configuredOptions.iosBundleId,
    appGroupId: configuredOptions.appGroupId,
  );
}

Future<void> connectFirebaseEmulatorsIfRequested() async {
  if (!useFirebaseEmulators) return;

  const host = String.fromEnvironment(
    'FIREBASE_EMULATOR_HOST',
    defaultValue: 'localhost',
  );
  const authPort = int.fromEnvironment(
    'FIREBASE_AUTH_EMULATOR_PORT',
    defaultValue: 9099,
  );
  const firestorePort = int.fromEnvironment(
    'FIRESTORE_EMULATOR_PORT',
    defaultValue: 8080,
  );
  const functionsPort = int.fromEnvironment(
    'FIREBASE_FUNCTIONS_EMULATOR_PORT',
    defaultValue: 5001,
  );
  const storagePort = int.fromEnvironment(
    'FIREBASE_STORAGE_EMULATOR_PORT',
    defaultValue: 9199,
  );

  FirebaseFirestore.instance.settings = const Settings(
    persistenceEnabled: false,
  );
  FirebaseFirestore.instance.useFirestoreEmulator(host, firestorePort);
  FirebaseFunctions.instance.useFunctionsEmulator(host, functionsPort);
  FirebaseStorage.instance.useStorageEmulator(host, storagePort);
  await FirebaseAuth.instance.useAuthEmulator(host, authPort);

  debugPrint('Using Firebase emulators on $host.');
}
