# Project migration: `car-selling-flutter-app` -> `laawol-a855a`

| | Current (production today) | New |
| --- | --- | --- |
| Project id | `car-selling-flutter-app` | `laawol-a855a` |
| Project number | `577373430777` | `127318353394` |
| Functions region | `us-central1` | `us-central1` (assumed - confirm) |

**Status of this branch:** the CODE side is prepared. Production behavior is
unchanged: every single-source config below still points at the current
project. Moving to the new project is now a small, explicit change to those
files plus the external steps in the cutover checklist (Section 3).

No secret values appear in this document or in the repo. Firebase web/app API
keys and reCAPTCHA *site* keys are public identifiers (they ship in every
client bundle); they are referred to by file:line only.

---

## 1. Single sources of truth (the cutover switches)

Each component now has exactly ONE place that names the project. The old
project is the active default in all of them. A repo-wide guard test
(`deploy/test/project-migration-guard.test.mjs`, run by CI job
"Deployment safety helpers") fails if any source file outside these names the
old project id, number, public keys, or `cloudfunctions.net` host.

| Component | Single-source file | The switch | New-project values |
| --- | --- | --- | --- |
| Deploy tooling (`deploy/*.mjs`, `deploy/store/gate.py`) | `deploy/project-config.json` (+ loader `deploy/project-config.mjs`) | `"active": "current"` -> `"new"` (this is also the project the preflight treats as PRODUCTION). One-off override without editing: `FIREBASE_PROJECT=<id\|current\|new>` or `--project <id>` | ids/number/region already filled in |
| Firebase CLI aliases | `my_flutter_app/.firebaserc`, `admin_web/.firebaserc` | `default` / `production` -> `laawol-a855a` (alias `new` already added; `default` still old) | n/a |
| Cloud Functions | `my_flutter_app/functions/project_config.js` | none needed: functions read `GCLOUD_PROJECT`/`GCP_PROJECT` and derive the bucket; the only literal is the public Firebase web API key, looked up per deployed project id | `NEW_PROJECT_CONFIG.webApiKey` (empty -> fails closed with "FIREBASE_WEB_API_KEY is required"; or set env `FIREBASE_WEB_API_KEY`) |
| Consoles (admin / business / customer) | `admin_web/src/lib/project-config.ts` | `DEFAULT_PROJECT_TARGET = "current"` -> `"new"`, or build with `NEXT_PUBLIC_FIREBASE_PROJECT_TARGET=new` | `NEW_PROJECT_CONFIG.apiKey`, `.appId` (empty -> build/load throws) |
| Marketing site | `public_site/assets/site-config.js` (+ the two rewrites in `public_site/.htaccess`) | `ACTIVE_TARGET = "current"` -> `"new"`; swap the commented `/p` and `/d` rewrite pair in `.htaccess`; bump `site-config.js?v=` in every page | `NEW_PROJECT_CONFIG.firebase.apiKey`, `.appId`, `.appCheckSiteKey` (empty -> throws) |
| Flutter app (Dart) | `my_flutter_app/lib/firebase_environment_options.dart` | `defaultEnvironment = 'production'` -> `'new'`, or build with `--dart-define=FIREBASE_ENV=new` | `my_flutter_app/lib/firebase_options_new.dart`: per-client `apiKey`, `appId` (empty -> `StateError`) |
| Flutter native files (not switchable from Dart) | `android/app/google-services.json`, `ios/Runner/Info.plist` (URL scheme), `macos/Runner/GoogleService-Info.plist`, `macos/firebase_app_id_file.json` | replace with files downloaded from the NEW project's apps | n/a |

New-project values that exist only after the apps are registered (left as
marked `TODO(cutover)` placeholders, never invented):

- Web app: `apiKey`, `appId` (admin_web, public_site, functions, Flutter web)
- Android app `com.laawoldigital.app`: `apiKey`, `appId`, new `google-services.json`
- iOS app `com.laawoldigital.app`: `apiKey`, `appId`, `app-<number>-ios-<id>` URL scheme
- reCAPTCHA Enterprise site key(s) for App Check (web) - used by admin_web
  build env, `public_site/assets/site-config.js`, Flutter web dart-define
- `authDomain` / `storageBucket` for the new project are filled with Firebase's
  standard names (`laawol-a855a.firebaseapp.com`,
  `laawol-a855a.firebasestorage.app`); confirm both when pasting the real
  config.

---

## 2. Inventory (baseline commit `edf88f8`, line numbers as of that commit)

"Now" says what this branch did. Counts are lines that name the old project
id/number, a project API key, or a project-specific URL, excluding docs
prose and lockfiles.

### 2.1 Cloud Functions (`my_flutter_app/functions`) - 3 hits (+1 comment)

Functions are already project-agnostic: no id/number/`cloudfunctions.net`
literal builds any link. Links in WhatsApp/SMS/receipts, `/p` and `/d`,
Stripe success/cancel/return/refresh URLs, and customer console URLs all use
`laawoldigital.com` / `customer.laawoldigital.com` / `business.laawoldigital.com`
(or the `PARKING_LINK_BASE_URL`, `PARKING_DOCUMENT_BASE_URL`,
`CUSTOMER_CONSOLE_URL`, `BUSINESS_DASHBOARD_URL` env overrides) - domain-level,
unchanged by the move.

| File:line | Value | Now |
| --- | --- | --- |
| `index.js:591` | public Firebase web API key fallback for `FIREBASE_WEB_API_KEY` (password-setup email via Identity Toolkit, used at `index.js:22616`) | moved to `project_config.js` `CURRENT_PROJECT_CONFIG`; looked up by runtime project id; new project fails closed until `NEW_PROJECT_CONFIG.webApiKey` (or the env var) is set |
| `index.js:11463-11470` | Storage bucket: `FIREBASE_STORAGE_BUCKET` / `STORAGE_BUCKET` / `${GCLOUD_PROJECT}.firebasestorage.app` | same logic, now `storageBucketName()` in `project_config.js` (derives from the deployed project; confirm the new project's default bucket really is `laawol-a855a.firebasestorage.app`) |
| `scripts/seed-lot-activity-types.js:10` | usage comment with `--project car-selling-flutter-app` | comment now `<project-id>` |
| `request_guard.js:21` | comment only (`*.cloudfunctions.net` / `*.run.app` forwarding semantics) | untouched, not a hit |

Not project-specific (domain-level; do NOT change for this migration):
`index.js:8044` (`laawol.com/app` Stripe fallback - note this is a *different*
domain from `laawoldigital.com`; worth a separate look), `8614`, `13071`,
`13876`, `13922`, `16022`, `19228`, `container_updates.js:265`,
`customer_checkout.js:115`, `access_invitation.js:22`, `container_document.js:19`,
`index.js:37663-37667` (`ASSISTANT_ALLOWED_ORIGINS`: the CORS allow-list is
website origins, not project hosts). `cors: true` on callables is
origin-agnostic. Region: no literal; defaults to `us-central1`.

Runtime params that are set per deployment (no code change, but must exist in
the new project): secrets in 3.4; env `FIREBASE_WEB_API_KEY`,
`PARKING_LINK_BASE_URL`, `PARKING_DOCUMENT_BASE_URL`, `CUSTOMER_CONSOLE_URL`,
`BUSINESS_DASHBOARD_URL`, `PLATFORM_SERVICE_FEE_PCT`, `TRUSTED_PROXY_HOPS`,
`FIREBASE_STORAGE_BUCKET`/`STORAGE_BUCKET` (all optional overrides).

Inbound endpoints (what external systems call): `handleBusinessProStripeWebhook`
(also exported as `stripeCheckoutWebhook`, `index.js:9430/9595`),
`parkingPaymentLink` (`13467`), `parkingDocument` (`13678`), `assistantChat`
(`37702`). There is NO inbound WhatsApp (Meta) or Terminal49 or Twilio
webhook in code: WhatsApp Graph, Twilio and Terminal49 are outbound; tracking
is poll-based (`pollContainerTracking`, "Terminal49's free plan has no
webhooks", `index.js:2454`).

### 2.2 Consoles (`admin_web`; admin, business, customer share one build) - 10 hits

| File:line | Value | Now |
| --- | --- | --- |
| `src/lib/firebase.ts:25` | web `apiKey` default | `project-config.ts` `CURRENT_PROJECT_CONFIG` |
| `src/lib/firebase.ts:28` | `authDomain` `car-selling-flutter-app.firebaseapp.com` | same |
| `src/lib/firebase.ts:30` | `projectId` | same |
| `src/lib/firebase.ts:33` | `storageBucket` `...firebasestorage.app` | same |
| `src/lib/firebase.ts:35` | `messagingSenderId` = project number | same |
| `src/lib/firebase.ts:38` | web `appId` | same |
| `src/components/admin-console.tsx:6435` | link to Firebase console Extensions page for the project | `firebaseConsoleUrl("extensions")` (follows active project) |
| `package.json:8` | `start` script `--project car-selling-flutter-app` | flag dropped; uses `.firebaserc` default |
| `.firebaserc:3-4` | `default`, `production` | alias `new` added; default unchanged |
| `.env.example` | n/a | documents `NEXT_PUBLIC_FIREBASE_PROJECT_TARGET` and per-field overrides |

Also project-linked but not literals: `NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY`
(build env; the reCAPTCHA key belongs to a GCP project - see 3.6),
`firebase.json` hosting (unused in production; consoles are served from
Hostinger). Domains (`console-host.ts`, `legal-links.ts`, `package-staff.ts:400`,
`inventory.ts:110`, `customer-service-intent.ts:45`, `app-store-links.ts`) are
`*.laawoldigital.com` and unchanged.

### 2.3 Flutter app (`my_flutter_app`) - 39 hits

| File:line | Value | Now |
| --- | --- | --- |
| `lib/firebase_options.dart:47-52` web (apiKey, appId, senderId, projectId, authDomain, bucket) | current project | unchanged; remains the production options |
| `lib/firebase_options.dart:56-60` android | current project | unchanged |
| `lib/firebase_options.dart:64-68` ios (`iosBundleId com.laawoldigital.app`) | current project | unchanged |
| `lib/firebase_options.dart:73-77` macos | current project | unchanged (new project not configured for macOS) |
| `lib/firebase_options_staging.dart:8-29` | staging project `laawol-digital-staging` (different project; stays) | untouched |
| `lib/firebase_environment_options.dart` | `FIREBASE_ENV` production/staging selector | added `new` (fails closed on placeholders); `defaultEnvironment` is the switch |
| `lib/firebase_options_new.dart` (new file) | `NEW_PROJECT_CONFIG` for web/android/ios | placeholders for apiKey/appId |
| `android/app/google-services.json:3-5,10,18` | project number, project id, bucket, android app id, android api key | replace file at cutover (Gradle plugin, not switchable at runtime) |
| `ios/Runner/Info.plist:34` | URL scheme `app-1-577373430777-ios-<id>` (Firebase Auth phone/reCAPTCHA redirect) | replace with the new iOS app's scheme at cutover |
| `macos/Runner/GoogleService-Info.plist:6,8,14,16,28` | macOS app config | replace only if macOS is ever migrated |
| `macos/firebase_app_id_file.json:4-6` | macOS app id / project id / sender id | same |
| `.firebaserc:3-4` | default / production | alias `new` added |
| `tool/seed_car_listings.mjs:4` | hardcoded `projectId` for a dev seed script that writes listings | now REQUIRES `FIREBASE_PROJECT_ID` (deliberately no default for a prod-writing script) |
| `test/firebase_environment_options_test.dart:37` | pins production default id | kept as the pin; new-project tests added |
| `lib/main.dart:120-123` | `FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY` dart-define (web App Check) | per-project key - rebuild web with the new key (3.6) |
| `ios/Runner/Runner.entitlements`, `android/.../AndroidManifest.xml:42,54` | `aps-environment`, associated domains / app links for `customer.laawoldigital.com` | domain-level, unchanged |
| `firebase.json`, `firestore.rules`, `functions/storage.rules`, `firestore.indexes.json` | no project literals | deploy to new project (3.5) |

No Dart code calls a function by URL; all callables use the default region
(`FirebaseFunctions.instance`), so the app follows whatever `FirebaseOptions`
it initialises with. `main.dart:73` is the only initialisation point.

### 2.4 Marketing site (`public_site`) - 18 hits

| File:line | Value | Now |
| --- | --- | --- |
| `.htaccess:17-18` | `/p` -> `...cloudfunctions.net/parkingPaymentLink`, `/d` -> `.../parkingDocument` (the short links in SMS/WhatsApp/receipts/invoices) | active pair kept; NEW_PROJECT_CONFIG pair added commented; `verify-cms.mjs` pins that the active pair matches `site-config.js` |
| `assets/chat.js:209` | assistantChat URL | `LAAWOL_CONFIG.functionsBaseUrl + "/assistantChat"` |
| `assets/chat.js:221-226` | firebase web config (apiKey, authDomain, projectId, bucket, senderId, appId) | `LAAWOL_CONFIG.firebase` |
| `assets/chat.js:228` | reCAPTCHA Enterprise App Check site key | `LAAWOL_CONFIG.appCheckSiteKey` |
| `assets/content.js:2` | `projectId` for the Firestore REST read of `websiteContent/*` and `featuredBusinesses` | `LAAWOL_CONFIG.firebase.projectId` |
| `partner.html:249-254` | firebase web config | `LAAWOL_CONFIG.firebase` |
| `partner.html:264` | reCAPTCHA Enterprise site key | `LAAWOL_CONFIG.appCheckSiteKey` |
| all 12 `*.html` | load `assets/site-config.js?v=1` before `chat.js`/`content.js` (bumped to `chat.js?v=5`, `content.js?v=11`) | added; `verify-cms.mjs` pins order |

`partner.html` initialises Firebase (Auth, Functions, Storage, App Check) from
`LAAWOL_CONFIG`, so partner sign-in/applications follow the active project.
Other host-level items (`https://laawoldigital.com`, `customer.`/`admin.`/
`business.` hosts, the CORS allow-list) are domain-level and unchanged.

### 2.5 Deploy tooling (`deploy/`, `.github/workflows`) - 7 literal defaults (+3 region defaults) + 16 test lines

| File:line | Value | Now |
| --- | --- | --- |
| `backend-deploy.mjs:25` | `FIREBASE_PROJECT \|\| "car-selling-flutter-app"` | `resolveProjectId()` |
| `post-deploy-smoke.mjs:21-22` | same + `us-central1` | `resolveProjectId()` / `resolveRegion()` |
| `preflight.mjs:49` | same | `resolveProjectId()` |
| `preflight.mjs:577` | `--region us-central1` for the Cloud Run revision check | `resolveRegion()` |
| `preflight-lib.mjs:5` | `DEFAULT_PRODUCTION_PROJECT` (decides "production" vs "nonproduction" mode, payment-simulation gates) | = `project-config.json` active project |
| `prune-cloud-run-revisions.mjs:22-23` | same + `us-central1` | `resolveProjectId()` / `resolveRegion()` |
| `store/gate.py:25` | `PROJECT` for the force-update gate (`appConfig/client`) | reads `project-config.json`; `FIREBASE_PROJECT` override |
| `callable-cors-smoke-lib.mjs:38,74`, `post-deploy-smoke.mjs:241` | build `https://<region>-<project>.cloudfunctions.net/<fn>` from the resolved project | already parameterised, untouched |
| `test/preflight.test.mjs` (12), `test/callable-cors-smoke.test.mjs` (4) | old id/number as fixtures | now use `ACTIVE_PROJECT` from the config, so they pass either side of the flip |
| `.github/workflows/ci.yml` | no project literal; added `npm run verify:public` to the deployment-safety job | done |
| `README.md`, `HOSTINGER_DEPLOY.md`, `DEPLOYMENT_GUIDE.md`, `docs/*.md` | `--project car-selling-flutter-app` / `FIREBASE_PROJECT=car-selling-flutter-app` in commands | commands now use `"$FIREBASE_PROJECT"` / `<project-id>`; remaining prose mentions are historical |

Pre-cutover rehearsal: with `active` still `current`, a deploy to the new
project runs as a NON-production project, so preflight demands an explicit
`DEPLOY_ENV=test|staging|development|nonproduction`:
`FIREBASE_PROJECT=new DEPLOY_ENV=nonproduction npm run preflight:backend`.
After the flip (`active: "new"`) the new project is production and the old one
becomes the non-production one (override `PRODUCTION_FIREBASE_PROJECT` still
works).

### 2.6 Docs and agent files (not code, listed for completeness)

`CLAUDE.md:108`, `docs/ENGINEERING_GUARDRAILS.md:181`,
`docs/PLAN-website-cms-and-featured-businesses.md:35`,
`docs/SIMULATOR_TESTING.md:106`, `deploy/HOSTINGER_DEPLOY.md:193,226,283`
(prose, incl. the Stripe webhook URL), `docs/RUNBOOK-stripe-live-cutover.md:27`
(a `*-uc.a.run.app` Cloud Run URL: project-specific, changes in the new
project - read the new one from `firebase functions:list` after deploying),
`.claude/agents/tester.md:174` (iOS app id; the `.claude/` directory is excluded from the guard scan).
After the cutover refresh these by hand.

---

## 3. CUTOVER CHECKLIST (things code cannot change)

Legend: **[HUMAN]** needs a person (console login, a secret value, an account
owner). Order matters where noted. Nothing here has been done.

### 3.1 Before the switch (new project readiness)

1. **[HUMAN]** Billing/Blaze plan linked to `laawol-a855a`; enable APIs: Cloud
   Functions, Cloud Run, Cloud Build, Artifact Registry, Eventarc, Pub/Sub,
   Cloud Scheduler, Secret Manager, Firestore, Identity Toolkit, Firebase App
   Check, reCAPTCHA Enterprise, Cloud Storage, FCM, and whichever Maps APIs
   the Maps key uses (Places, Geocoding, Distance Matrix).
2. **[HUMAN]** Cloud Run quota in the new project (the old one was capped at
   20 vCPU/region; see `deploy/cloud-run-capacity-lib.mjs`) - request/confirm
   quota before the first full functions deploy; do not poll after deploy.
3. **[HUMAN]** Register apps in `laawol-a855a`: Web, Android
   (`com.laawoldigital.app`), iOS (`com.laawoldigital.app`). Paste values into
   the `NEW_PROJECT_CONFIG` blocks (1) and replace the native files.
4. **[HUMAN]** Firestore database (same location/mode as the old one), Storage
   default bucket (confirm the name is `laawol-a855a.firebasestorage.app`).
5. Deploy rules and indexes: `firestore.rules`, `firestore.indexes.json`,
   `functions/storage.rules` via `firebase deploy --only firestore,storage
   --project laawol-a855a` (this is a deploy: do it deliberately, from a clean
   tree).
6. **[HUMAN]** Data migration plan (not covered by code): Firestore export/
   import (or backup restore), Storage objects (`gsutil -m rsync` between the
   two buckets), Auth users with password hashes preserved
   (`firebase auth:export` / `auth:import` with the project's hash config, so
   UIDs and phone/email links survive), then re-run `npm run backfill:user-claims`
   and the explicit-access / scaling backfills in `ops/README.md` if claims or
   derived fields did not carry over. Decide the write-freeze window.
7. **[HUMAN]** Firestore backups for the new project: run
   `ops/configure-firestore-backups.sh` (project id is an argument) and
   confirm PITR.

### 3.2 Firebase console (new project)

8. **[HUMAN]** Authentication -> Sign-in method: enable exactly what the old
   project has - Email/Password and Phone (the app and consoles use
   `verifyPhoneNumber`). Authentication -> Settings -> **Authorized domains**:
   `laawoldigital.com`, `admin.laawoldigital.com`, `business.laawoldigital.com`,
   `customer.laawoldigital.com` (+ `localhost` for dev). Re-apply email
   templates/sender, SMS region policy, password policy, and test phone
   numbers.
9. **[HUMAN]** App Check (new project): register providers - reCAPTCHA
   Enterprise (web), App Attest/DeviceCheck (iOS), Play Integrity (Android);
   then enforce on Firestore/Storage/Functions as in the old project. Create
   the **reCAPTCHA Enterprise key(s)** in the new GCP project for
   admin/business/customer/laawoldigital.com and put the new site key in:
   `NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY` (console builds /
   `~/.laawol/appcheck.key`, per guardrails 1b),
   `public_site/assets/site-config.js` `appCheckSiteKey`, Flutter web
   `--dart-define=FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY`. Register simulator
   debug tokens again (guardrails 1b).
10. **[HUMAN]** Cloud Messaging: upload the **APNs authentication key** (and
    team/key ids) to the new project's iOS app - push AND iOS phone-auth silent
    push depend on it. Android FCM comes with `google-services.json`.
11. **[HUMAN]** Android app settings: add every **SHA-1 and SHA-256**
    fingerprint (debug, upload key, **Play App Signing** key) to the new
    Android app; link Play Integrity for App Check; re-download
    `google-services.json`.
12. **[HUMAN]** Extensions: reinstall **Trigger Email** (collection `mail`,
    SMTP credentials) - it is referenced from the admin console
    (`admin-console.tsx:6435`) - and any other installed extension.
13. **[HUMAN]** Maps key: `GOOGLE_MAPS_API_KEY` is a secret VALUE. If the same
    key keeps being used it still belongs to the OLD GCP project (and dies with
    it); create a new key in `laawol-a855a`, enable Places/Geocoding/Distance
    Matrix there, apply API restrictions (server key: no HTTP-referrer/app
    restriction, IP restriction is impractical on Cloud Functions), then store
    it as the secret. No client app embeds a Maps key.

### 3.3 Deploy order

14. Set the `NEW_PROJECT_CONFIG` values and flip the switches in Section 1 in
    ONE reviewed commit (functions web key, `admin_web` target, `site-config.js`
    target + `.htaccess`, Flutter `defaultEnvironment`, `deploy/project-config.json`
    `active`, `.firebaserc` default/production, native files).
15. Rehearse first with `FIREBASE_PROJECT=new DEPLOY_ENV=nonproduction`.
    `firebase deploy` requires Java on PATH (guardrails 1b) and clean git tree.
    Never run two function deploys at once.
16. Functions: confirm `Successful update operation` per function; confirm each
    public `onRequest`/callable has the public invoker IAM binding (a function
    created in a failed batch can come up without it).
17. Hostinger static deploy of the consoles (rebuilt with the new env) and the
    marketing site (`site-config.js`, `.htaccess`, bumped `?v=`): `deploy/`
    static scripts. DNS for `laawoldigital.com`, `admin.`, `business.`,
    `customer.` does NOT change.

### 3.4 Secrets (Secret Manager in the new project) - values by a human

`firebase functions:secrets:set <NAME> --project laawol-a855a`. 13 secrets
declared with `defineSecret` in `functions/index.js:551-577`:
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`
(optional until a Connect destination exists), `BUSINESS_PRO_PRICE_ID`,
`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `GOOGLE_MAPS_API_KEY`,
`TERMINAL49_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.
Secret values cannot be copied by code here. Optional deploy-time env (not
secrets): `FIREBASE_WEB_API_KEY` (until `project_config.js` is filled),
`PARKING_LINK_BASE_URL`, `PARKING_DOCUMENT_BASE_URL`, `CUSTOMER_CONSOLE_URL`,
`BUSINESS_DASHBOARD_URL`, `PLATFORM_SERVICE_FEE_PCT`. Deploy-machine-only
(never to functions): `FTP_PASS`, `NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY`.

### 3.5 Third-party webhooks and accounts

18. **Stripe - webhook endpoints x2 and their signing secrets [HUMAN]:**
    both point at `handleBusinessProStripeWebhook` (alias
    `stripeCheckoutWebhook`) in the new project: (a) the platform/account
    destination -> `STRIPE_WEBHOOK_SECRET`; (b) the Connect (connected
    accounts) destination -> `STRIPE_CONNECT_WEBHOOK_SECRET`. Each new endpoint
    has a NEW `whsec_...`; set both secrets, redeploy. Use the new function's
    URL from `firebase functions:list` (the doc form is
    `https://us-central1-laawol-a855a.cloudfunctions.net/handleBusinessProStripeWebhook`;
    the Cloud Run `*.a.run.app` URL in `RUNBOOK-stripe-live-cutover.md:27` is
    project-specific). **Disable/delete the old endpoints only after the new
    ones are verified**, otherwise events are double-delivered or lost. The
    `STRIPE_SECRET_KEY`, price ids, connected accounts and customers live in
    Stripe and do not change.
19. **Meta WhatsApp [HUMAN]:** code only calls the Graph API outbound
    (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`); there is no inbound
    webhook handler. Confirm in Meta's app dashboard that no webhook callback
    URL pointing at the old project is configured (if one exists, repoint it
    and re-verify). Templates/number stay with the WABA.
20. **Terminal49 [HUMAN]:** tracking is poll-based; only `TERMINAL49_API_KEY`
    moves. Confirm no webhook is registered in the Terminal49 dashboard that
    targets the old project.
21. **Twilio [HUMAN]:** outbound SMS only (`TWILIO_*` secrets); confirm no
    status-callback / inbound webhook URL on the Messaging service/number
    targets the old project, and that the sending number/service is unchanged.
22. **Anthropic / DeepSeek:** keys only (secrets).
23. **Cloud Scheduler [HUMAN verify]:** the 9 scheduled functions create their
    own jobs on deploy: `pollContainerTracking`, `chargeMonthlySubscriptions`,
    `notifyParkingMonthEnd`, `captureExpiringPaymentHolds`,
    `reconcileStaleStripePayments`, `expireBarrelPools`,
    `retryFreightSettlementRefunds`, `expireStaleCarViewings`,
    `expirePaidCarHolds`. Confirm the jobs exist and are enabled in the new
    project, and **pause the old project's jobs at the moment of cutover** -
    two live schedulers against the same Stripe account will double-charge
    subscriptions / double-capture holds.

### 3.6 Client releases and stores

24. **[HUMAN]** App Store / Play: the bundle id/package are unchanged
    (`com.laawoldigital.app`), but builds that ship the new Firebase options are
    a NEW release (iOS build + Android build with the new `google-services.json`
    and Info.plist URL scheme). Old installed builds keep talking to the old
    project until updated: keep the old project serving (or read-only) during
    the transition and use the force-update gate
    (`deploy/store/gate.py`, `FIREBASE_PROJECT=<project>` selects which
    project's `appConfig/client` is moved) to push users to the new build.
    Never point `minSupportedBuild` at a build that is not yet installable
    (see the gate's docstring).
25. **[HUMAN]** Universal links / app links (`customer.laawoldigital.com/t/`,
    `/i/`) are domain-level and unchanged.
26. **[HUMAN]** DNS / `.htaccess` rewrites: DNS records do not change. The two
    rewrites in `public_site/.htaccess` (`/p`, `/d`) MUST be switched to the new
    project's `parkingPaymentLink` / `parkingDocument` at the same moment as
    the functions - they are live links already sent in SMS/WhatsApp/receipts
    and must keep resolving after cutover.

### 3.7 After the switch

27. Smoke: `FIREBASE_PROJECT=laawol-a855a npm run smoke` (backend + static);
    sign in on all three consoles; run one parking link (`/p?t=`), one receipt
    (`/d`), one Stripe test payment path, one WhatsApp/SMS dry-run path, one
    partner application from `partner.html`, the assistant chat bubble, and a
    mobile sign-in + callable (checks App Check).
28. Refresh the doc references in 2.6; delete the old pair in `.htaccess` and
    the superseded `CURRENT_PROJECT_CONFIG` blocks once the old project is
    decommissioned (the guard test allow-list in
    `deploy/test/project-migration-guard.test.mjs` shrinks with them).

---

## 4. What the guard tests pin

- `deploy/test/project-migration-guard.test.mjs`: (a) no file outside the
  single-source files / pin tests contains the old id, number, public web key
  or reCAPTCHA key; (b) the deploy tooling resolves a project override
  (`FIREBASE_PROJECT=<id|current|new>`, `--project`) and every deploy script
  uses it; production stays on `current`; `.firebaserc` default/production are
  the active project and alias `new` is `laawol-a855a`; all component configs
  register the same two projects and carry a `NEW_PROJECT_CONFIG` block.
- `functions/test/project-config.test.js`: key lookup by runtime project, new
  project fails closed and never borrows the old key, bucket derivation.
- `admin_web/src/lib/project-config.test.ts`: default is current, new target
  throws while placeholders are empty, env overrides, unknown target rejected.
- `public_site/verify-cms.mjs`: `site-config.js` defines `LAAWOL_CONFIG`
  (current active), loads before `chat.js`/`content.js` on every page, no
  hardcoded project values in `partner.html`/`chat.js`/`content.js`, `.htaccess`
  active rewrites match the active project and the new pair is present.
- `my_flutter_app/test/firebase_environment_options_test.dart`: production
  default, `new` registered and fails closed, never reuses the old keys.
