/**
 * SINGLE SOURCE OF TRUTH for which Firebase/GCP project the three consoles
 * (admin, business, customer) talk to. Nothing else under `src/` may hardcode
 * a project id, number, bucket, auth domain, or console URL - that is pinned
 * by `deploy/test/project-migration-guard.test.mjs`.
 *
 * Cutover = flip `DEFAULT_PROJECT_TARGET` to "new" (after filling the
 * `NEW_PROJECT_CONFIG` placeholders below), or build with
 * `NEXT_PUBLIC_FIREBASE_PROJECT_TARGET=new`. Per-field
 * `NEXT_PUBLIC_FIREBASE_*` variables still override either target.
 * See docs/PROJECT_MIGRATION.md.
 */

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export type ProjectTarget = "current" | "new";

/** The project that is production today. Firebase web keys are public. */
export const CURRENT_PROJECT_CONFIG: FirebaseWebConfig = {
  apiKey: "AIzaSyBrRDTd5w2iWxTIfvsn7ra0xjW7M-iuPN8",
  authDomain: "car-selling-flutter-app.firebaseapp.com",
  projectId: "car-selling-flutter-app",
  storageBucket: "car-selling-flutter-app.firebasestorage.app",
  messagingSenderId: "577373430777",
  appId: "1:577373430777:web:5af70db59c5d49a8125328",
};

/**
 * NEW_PROJECT_CONFIG: the project production moves to (laawol-a855a, number
 * 127318353394). `apiKey` and `appId` exist only after a Web app is registered
 * in that project (Firebase console -> Project settings -> Your apps -> Web);
 * they are empty on purpose and selecting the "new" target while they are
 * empty throws at load, so a half-filled switch can never ship silently.
 * The authDomain / storageBucket follow Firebase's naming for new projects -
 * confirm both in the console when pasting the real values.
 */
export const NEW_PROJECT_CONFIG: FirebaseWebConfig = {
  apiKey: "AIzaSyDyz6neM8FSEgO2v01UZECeSGTAuTuFmQg", // new project web app apiKey
  authDomain: "laawol-a855a.firebaseapp.com",
  projectId: "laawol-a855a",
  storageBucket: "laawol-a855a.firebasestorage.app",
  messagingSenderId: "127318353394",
  appId: "1:127318353394:web:877e3c653bfcce7ec5776b",
};

/** THE cutover switch for the consoles. */
export const DEFAULT_PROJECT_TARGET: ProjectTarget = "current";

type ConfigEnv = Partial<Record<string, string | undefined>>;

const REQUIRED_FIELDS: (keyof FirebaseWebConfig)[] = [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
];

function pick(value: string | undefined, fallback: string): string {
  return value === undefined || value === "" ? fallback : value;
}

/**
 * Resolve the web config. `env` is passed in (rather than read from
 * `process.env` here) because Next only inlines `process.env.NEXT_PUBLIC_X`
 * when written out literally - see `ACTIVE_FIREBASE_CONFIG` below.
 */
export function resolveFirebaseConfig(
  env: ConfigEnv,
  defaultTarget: ProjectTarget = DEFAULT_PROJECT_TARGET,
): FirebaseWebConfig {
  const requested = env.NEXT_PUBLIC_FIREBASE_PROJECT_TARGET || defaultTarget;
  if (requested !== "current" && requested !== "new") {
    throw new Error(
      `NEXT_PUBLIC_FIREBASE_PROJECT_TARGET must be "current" or "new", got "${requested}".`,
    );
  }
  const base = requested === "new" ? NEW_PROJECT_CONFIG : CURRENT_PROJECT_CONFIG;
  const config: FirebaseWebConfig = {
    apiKey: pick(env.NEXT_PUBLIC_FIREBASE_API_KEY, base.apiKey),
    authDomain: pick(env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, base.authDomain),
    projectId: pick(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, base.projectId),
    storageBucket: pick(
      env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      base.storageBucket,
    ),
    messagingSenderId: pick(
      env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      base.messagingSenderId,
    ),
    appId: pick(env.NEXT_PUBLIC_FIREBASE_APP_ID, base.appId),
  };
  const missing = REQUIRED_FIELDS.filter((field) => !config[field]);
  if (missing.length) {
    throw new Error(
      `Firebase project target "${requested}" is missing ${missing.join(", ")}. ` +
        "Fill NEW_PROJECT_CONFIG in src/lib/project-config.ts (or set the NEXT_PUBLIC_FIREBASE_* variables).",
    );
  }
  return config;
}

export const ACTIVE_FIREBASE_CONFIG: FirebaseWebConfig = resolveFirebaseConfig({
  NEXT_PUBLIC_FIREBASE_PROJECT_TARGET:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_TARGET,
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
});

/** The Firebase console page for the active project (admin help links). */
export function firebaseConsoleUrl(
  section: string,
  projectId: string = ACTIVE_FIREBASE_CONFIG.projectId,
): string {
  return `https://console.firebase.google.com/project/${projectId}/${section}`;
}
