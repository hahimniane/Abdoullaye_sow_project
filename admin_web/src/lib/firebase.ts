import { initializeApp, getApps } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey:
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
    "AIzaSyBrRDTd5w2iWxTIfvsn7ra0xjW7M-iuPN8",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    "car-selling-flutter-app.firebaseapp.com",
  projectId:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "car-selling-flutter-app",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    "car-selling-flutter-app.firebasestorage.app",
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "577373430777",
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
    "1:577373430777:web:5af70db59c5d49a8125328",
};

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export let appCheck: AppCheck | null = null;

type AppCheckRuntime = typeof globalThis & {
  FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string;
  __laawolAppCheckInitialized?: boolean;
};

const appCheckRuntime = globalThis as AppCheckRuntime;
const useFirebaseEmulators =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";
const appCheckSiteKey =
  process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY?.trim() ?? "";
const appCheckDebugToken =
  process.env.NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN?.trim() ?? "";

if (
  typeof window !== "undefined" &&
  !useFirebaseEmulators &&
  !appCheckRuntime.__laawolAppCheckInitialized
) {
  const production = process.env.NODE_ENV === "production";
  if (production && !appCheckSiteKey) {
    throw new Error(
      "NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY is required in production.",
    );
  }
  if (production && appCheckDebugToken) {
    throw new Error(
      "NEXT_PUBLIC_FIREBASE_APP_CHECK_DEBUG_TOKEN must not be set in production.",
    );
  }

  // Local preview remains opt-in: set a registered debug token to exercise App
  // Check without shipping a debug provider path in production.
  if (production || appCheckDebugToken) {
    if (!production) {
      appCheckRuntime.FIREBASE_APPCHECK_DEBUG_TOKEN =
        appCheckDebugToken === "true" ? true : appCheckDebugToken;
    }
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(
        appCheckSiteKey || "debug-provider-not-used",
      ),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckRuntime.__laawolAppCheckInitialized = true;
  }
}

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);

// Opt-in local development against the Firebase emulator suite. Off by default,
// so production builds (where NEXT_PUBLIC_USE_FIREBASE_EMULATORS is unset) are
// unaffected. Mirrors the Flutter app's USE_FIREBASE_EMULATORS switch.
if (
  typeof window !== "undefined" &&
  useFirebaseEmulators &&
  !(globalThis as { __laawolEmulatorsConnected?: boolean }).__laawolEmulatorsConnected
) {
  (globalThis as { __laawolEmulatorsConnected?: boolean }).__laawolEmulatorsConnected = true;
  const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST ?? "127.0.0.1";
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectFunctionsEmulator(functions, host, 5001);
  connectStorageEmulator(storage, host, 9199);
}
