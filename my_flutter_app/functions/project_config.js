"use strict";

/**
 * SINGLE SOURCE OF TRUTH for project-specific values inside Cloud Functions.
 *
 * Functions run INSIDE the project they are deployed to, so almost nothing
 * here is configuration: the project id comes from the runtime
 * (`GCLOUD_PROJECT` / `GCP_PROJECT`), the default Storage bucket is derived
 * from it, and every URL the functions mint is a laawoldigital.com short link
 * (the domain does not change with the project). The only project-specific
 * literal is the public Firebase WEB API key, which identifies the project to
 * the Identity Toolkit REST API (password-setup emails). It is therefore kept
 * per project id and looked up by the project the function is running in -
 * deploying this same code to the new project switches the key with no edit.
 *
 * Nothing outside this file may hardcode a project id (guarded by
 * deploy/test/project-migration-guard.test.mjs). See docs/PROJECT_MIGRATION.md.
 */

/** The project that is production today. */
const CURRENT_PROJECT_CONFIG = Object.freeze({
  projectId: "car-selling-flutter-app",
  projectNumber: "577373430777",
  // A Firebase web API key is public (it ships in every client bundle).
  webApiKey: "AIzaSyBrRDTd5w2iWxTIfvsn7ra0xjW7M-iuPN8",
});

/**
 * NEW_PROJECT_CONFIG: the project production moves to. `webApiKey` exists
 * only after the web app is registered in the new project (Firebase console
 * -> Project settings -> Your apps -> Web). Left empty on purpose: until it is
 * filled in, the new project fails closed ("FIREBASE_WEB_API_KEY is required")
 * rather than borrowing the old project's key. Setting the FIREBASE_WEB_API_KEY
 * env var on the deployed functions has the same effect without a code edit.
 */
const NEW_PROJECT_CONFIG = Object.freeze({
  projectId: "laawol-a855a",
  projectNumber: "127318353394",
  webApiKey: "AIzaSyDyz6neM8FSEgO2v01UZECeSGTAuTuFmQg",
});

const KNOWN_PROJECTS = Object.freeze([
  CURRENT_PROJECT_CONFIG,
  NEW_PROJECT_CONFIG,
]);

/**
 * The project this process is running in ("" when the runtime does not say).
 * @param {object} [env] Environment to read.
 * @return {string} The project id.
 */
function runtimeProjectId(env = process.env) {
  return String(env.GCLOUD_PROJECT || env.GCP_PROJECT || "").trim();
}

/**
 * The public Firebase web API key for the project this process runs in.
 * Order: explicit FIREBASE_WEB_API_KEY, then the key registered for the
 * runtime project. A runtime project that is not registered here (emulators,
 * demo-* projects, an unset env) keeps the long-standing default so local runs
 * behave as before; a registered project with no key yet returns "".
 * @param {object} [env] Environment to read.
 * @return {string} The key, or "" when it must be provided.
 */
function firebaseWebApiKey(env = process.env) {
  const explicit = String(env.FIREBASE_WEB_API_KEY || "").trim();
  if (explicit) return explicit;
  const projectId = runtimeProjectId(env);
  const known = KNOWN_PROJECTS.find((p) => p.projectId === projectId);
  if (known) return known.webApiKey;
  return CURRENT_PROJECT_CONFIG.webApiKey;
}

/**
 * The Storage bucket the functions write to (business logos, etc.).
 * Explicit overrides win; otherwise the project's default bucket; otherwise
 * "" so the Admin SDK picks the app's configured default bucket.
 * @param {object} [env] Environment to read.
 * @return {string} The bucket name or "".
 */
function storageBucketName(env = process.env) {
  const configured = String(
      env.FIREBASE_STORAGE_BUCKET || env.STORAGE_BUCKET || "",
  ).trim();
  if (configured) return configured;
  const projectId = runtimeProjectId(env);
  return projectId ? `${projectId}.firebasestorage.app` : "";
}

module.exports = {
  CURRENT_PROJECT_CONFIG,
  NEW_PROJECT_CONFIG,
  runtimeProjectId,
  firebaseWebApiKey,
  storageBucketName,
};
