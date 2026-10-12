/*
 * SINGLE SOURCE OF TRUTH for the Firebase/GCP project the marketing site
 * talks to. Every page loads this file BEFORE chat.js / content.js, and the
 * inline module in partner.html - none of them may name a project, key, or
 * cloudfunctions.net host themselves (public_site/verify-cms.mjs and
 * deploy/test/project-migration-guard.test.mjs pin that).
 *
 * Cutover = set ACTIVE_TARGET to "new" (after filling NEW_PROJECT_CONFIG),
 * bump the ?v= on this file in every page, and update the two /p and /d
 * rewrites in public_site/.htaccess (see the NEW_PROJECT_CONFIG block there).
 * See docs/PROJECT_MIGRATION.md.
 */
(function () {
  "use strict";

  var REGION = "us-central1";

  // The project that is production today. Firebase web keys are public.
  var CURRENT_PROJECT_CONFIG = {
    firebase: {
      apiKey: "AIzaSyBrRDTd5w2iWxTIfvsn7ra0xjW7M-iuPN8",
      authDomain: "car-selling-flutter-app.firebaseapp.com",
      projectId: "car-selling-flutter-app",
      storageBucket: "car-selling-flutter-app.firebasestorage.app",
      messagingSenderId: "577373430777",
      appId: "1:577373430777:web:5af70db59c5d49a8125328",
    },
    // reCAPTCHA Enterprise site key registered for Firebase App Check.
    appCheckSiteKey: "6Lcs5FUtAAAAAA_XmvDg0rDqUE4noHLjFCLqofHX",
  };

  // NEW_PROJECT_CONFIG: laawol-a855a (project number 127318353394). apiKey,
  // appId and appCheckSiteKey exist only once the web app and a reCAPTCHA
  // Enterprise key are created in that project - they are empty on purpose,
  // and ACTIVE_TARGET = "new" throws below until they are filled in.
  var NEW_PROJECT_CONFIG = {
    firebase: {
      apiKey: "", // TODO(cutover): web app apiKey
      authDomain: "laawol-a855a.firebaseapp.com",
      projectId: "laawol-a855a",
      storageBucket: "laawol-a855a.firebasestorage.app",
      messagingSenderId: "127318353394",
      appId: "", // TODO(cutover): web app appId (1:127318353394:web:...)
    },
    appCheckSiteKey: "", // TODO(cutover): reCAPTCHA Enterprise key in the new project
  };

  // THE cutover switch for the marketing site.
  var ACTIVE_TARGET = "current";

  var chosen = ACTIVE_TARGET === "new" ? NEW_PROJECT_CONFIG : CURRENT_PROJECT_CONFIG;
  var missing = [];
  Object.keys(chosen.firebase).forEach(function (key) {
    if (!chosen.firebase[key]) missing.push("firebase." + key);
  });
  if (!chosen.appCheckSiteKey) missing.push("appCheckSiteKey");
  if (missing.length) {
    throw new Error(
      "site-config.js: target \"" + ACTIVE_TARGET + "\" is missing " + missing.join(", ")
    );
  }

  window.LAAWOL_CONFIG = {
    target: ACTIVE_TARGET,
    firebase: chosen.firebase,
    appCheckSiteKey: chosen.appCheckSiteKey,
    region: REGION,
    functionsBaseUrl:
      "https://" + REGION + "-" + chosen.firebase.projectId + ".cloudfunctions.net",
  };
})();
