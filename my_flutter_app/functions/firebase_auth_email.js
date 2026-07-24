"use strict";

const IDENTITY_TOOLKIT_OOB_URL =
  "https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode";

function normalizeAuthEmailLocale(locale) {
  return String(locale || "").trim().toLowerCase().startsWith("fr") ?
    "fr" :
    "en";
}

function firebaseAuthEmailErrorCode(payload) {
  return String(payload?.error?.message || "FIREBASE_AUTH_EMAIL_FAILED")
      .trim()
      .split(/\s*:\s*/)[0];
}

async function sendFirebasePasswordSetupEmail({
  apiKey,
  email,
  locale = "en",
  request = fetch,
}) {
  const normalizedApiKey = String(apiKey || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedApiKey) {
    throw new Error("FIREBASE_WEB_API_KEY is required");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("A valid invitation email is required");
  }
  const response = await request(
      `${IDENTITY_TOOLKIT_OOB_URL}?key=${encodeURIComponent(normalizedApiKey)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-firebase-locale": normalizeAuthEmailLocale(locale),
        },
        body: JSON.stringify({
          requestType: "PASSWORD_RESET",
          email: normalizedEmail,
        }),
      },
  );
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Preserve the HTTP status as the useful failure signal when a proxy or
    // upstream returns a non-JSON response.
  }
  if (!response.ok) {
    const error = new Error(
        `Firebase Auth email failed: ${firebaseAuthEmailErrorCode(payload)}`,
    );
    error.code = firebaseAuthEmailErrorCode(payload);
    error.status = Number(response.status || 0);
    throw error;
  }
  return {
    email: String(payload.email || normalizedEmail).toLowerCase(),
    provider: "firebaseAuth",
    status: "sent",
  };
}

module.exports = {
  firebaseAuthEmailErrorCode,
  normalizeAuthEmailLocale,
  sendFirebasePasswordSetupEmail,
};
