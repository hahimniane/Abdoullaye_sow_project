# Engineering Guardrails (MANDATORY)

These rules are binding on every contributor and every AI agent working in this
repository. They exist because a change that passed a casual review once froze
the production admin console (`admin.laawoldigital.com`) for end users. The goal
is simple: **a broken build must never reach production again.**

If a rule blocks you, do not route around it — fix the underlying problem or
raise it. The escape hatches that exist are explicit and logged.

---

## 1. Definition of Done

A change is **not done** until all of the following are true:

- `npm run typecheck` passes (admin_web) / `flutter analyze` passes (app) /
  `npm run lint` passes (functions) — for whatever you touched.
- `npm test` passes (admin_web) and any tests for the area you changed.
- `npm run build` succeeds for any web change.
- **For any UI/behavior change: you verified it in a real running app/browser**
  and watched it reach the expected state — not just "it compiles." The freeze
  incident compiled and typechecked cleanly; only loading the page revealed it.
- When you fix a bug, you add a regression test that fails before the fix and
  passes after. (See `admin_web/src/lib/french-dom.test.ts` for the pattern.)
- **Every user-facing string is localized in both languages — see §5.** New or
  changed copy is not done until it renders correctly in English *and* French.

State plainly what you ran and what the result was. If you skipped a step, say
so. Never report "done" on unverified work.

## 2. Deployment gate — non-negotiable

Production deploys go through the preflight, which now enforces:

1. **Clean git tree** — we ship only committed, reviewable code. Override only
   in a genuine emergency with `ALLOW_DIRTY_DEPLOY=1`, and commit immediately
   after.
2. **Unit tests pass** (`admin_web` regression suite).
3. **Build from source** — the deployed bundle is always rebuilt from the
   committed source. Never hand-edit or deploy a stale `admin_web/out/`.
4. **Secret-isolated child processes** — deploy credentials are validated by
   the preflight but removed from lint, test, build, emulator, dry-run, and
   Firebase deploy child environments. Tooling must never expose a secret while
   printing a child process environment.

Commands:

```bash
cd deploy
npm run preflight:static     # or preflight / preflight:backend
npm run deploy:static:ssh    # static sites (marketing, admin, business)
npm run deploy:backend       # Firebase functions/rules/indexes
```

CI (`.github/workflows/ci.yml`) runs typecheck + test + build (admin_web), lint
(functions), and analyze (flutter) on every push and PR. **A red CI run means
the change does not ship.** Do not merge or deploy around a failing check.

### Time-boxed development payment mode

The Firebase project `car-selling-flutter-app` remains subject to every
production release gate, including a clean tree, green CI for the exact commit,
tests, builds, App Check, IAM verification, and post-deploy smoke checks.
Through **August 31, 2026 at 11:59:59 p.m. America/New_York**, an explicit
`DEPLOY_ENV=development` may use a Stripe `sk_test_` key while the product is
under construction. The authorization expires automatically at
`2026-09-01T04:00:00Z`; after that instant the preflight fails closed and the
project again requires `DEPLOY_ENV=production` with an `sk_live_` key.
Simulation remains prohibited and no other production check is relaxed.

### Firebase Gen 2 deployment recovery

Firebase Functions Gen 2 deployments can fail even after a green preflight when
the CLI tries to update the entire function catalog concurrently and Cloud Run
exhausts its temporary regional CPU or mutation quota. Treat this as a partial
rollout, not permission to bypass the deployment gate:

1. Let the original deploy command finish. Do not interrupt in-flight Cloud Run
   operations or immediately retry the full catalog.
2. On macOS, export the verified Java 21 runtime into the real deploy process,
   not only the preflight:

   ```bash
   export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
   export PATH="/opt/homebrew/opt/node@22/bin:$JAVA_HOME/bin:$PATH"
   ```

3. If successful Firebase commands incorrectly exit after a five-second
   Analytics request timeout, disable Firebase CLI usage reporting locally:

   ```bash
   node -e 'const c=require("/opt/homebrew/lib/node_modules/firebase-tools/lib/configstore.js").configstore;c.set("usage",false)'
   ```

   This changes only local CLI telemetry. It does not disable App Check,
   authentication, tests, CI, IAM checks, or any deployed monitoring.
4. Inspect the live state before retrying. Use
   `firebase functions:list --project car-selling-flutter-app --json` and
   compare the intended endpoints with their `ACTIVE`/`FAILED` state. Never
   redeploy healthy unrelated functions merely because the original aggregate
   command returned non-zero.
5. After the guarded preflight has passed for the exact clean, green commit,
   redeploy only the incomplete functions with the normal `firebase deploy`
   command and its normal predeploy hooks. Use one function at a time or a pair:

   ```bash
   DEPLOY_ENV=development FIREBASE_PROJECT=car-selling-flutter-app \
     firebase deploy \
     --only functions:firstIncompleteFunction,functions:secondIncompleteFunction \
     --project car-selling-flutter-app
   ```

   Do not strip or skip the configured lint/tests to make these retries faster.
   If Cloud Run reports `Quota exceeded for total allowable CPU per project per
   region`, reduce the batch to one function and wait for it to become `ACTIVE`
   before starting the next.
6. Run `cd deploy && FIREBASE_PROJECT=car-selling-flutter-app npm run
   smoke:backend` after every recovery rollout. A function is not recovered
   until the deployed endpoint is `ACTIVE` and smoke checks pass.

An `ACTIVE` Gen 2 callable is not necessarily reachable from a browser.
Cloud Run can finish the function rollout without the `allUsers`
`roles/run.invoker` binding, which makes the browser's unauthenticated CORS
`OPTIONS` request fail with HTTP 403 before Firebase can deliver App Check and
Auth tokens to the callable handler. Browser-facing callable exports must use
an explicit shared options object with `invoker: "public"`, `cors: true`, and
`enforceAppCheck: ENFORCE_APP_CHECK`. Public invoker access opens only the HTTP
transport; authentication, verified-email, role, and capability enforcement
remain mandatory inside each handler. The backend smoke suite must send a
browser-like `OPTIONS` request to every access-management callable and treat
any non-2xx response as a failed deployment.

When the CLI asks to delete deployed Firestore indexes that are absent from the
local manifest, answer **no** unless the index deletion has been independently
reviewed and is part of the requested change.

## 3. Design patterns that prevent the incident class

These are the specific lessons from the freeze. They generalize — apply the
spirit, not just the letter.

- **No O(N) work per render or per DOM node.** Precompute once (module scope),
  not inside loops/effects/observers. The freeze ran ~600 string replacements
  *per text node* across the whole tree. If a transform scales with both your
  data size and the DOM size, you have a performance bug. Keep a budget and
  test it (see the time-budget test in `french-dom.test.ts`).
- **`MutationObserver` discipline.** An observer must never react to its own
  writes. Guard mutations with a re-entrancy flag and call
  `observer.takeRecords()` after writing to discard self-generated records.
  Never `observe(document.body, { subtree: true })` and then write to the body
  without that guard.
- **Transforms must converge and be idempotent.** Applying an operation to its
  own output must reach a fixpoint quickly and never grow unbounded. If a value
  is already in the target state, return it untouched.
- **Effects must always resolve their loading state.** Every `loading`/`booting`
  flag needs a guaranteed exit on *every* path (success, error, and a safety
  timeout). Never let a spinner depend on a promise that might never settle.
- **Every async user action must show progress.** Any button, tap target, menu
  item, or icon action that awaits network, disk, Firebase, Stripe, navigation
  handoff, geolocation, image picking, file generation, or other non-immediate
  work must disable repeat activation and show a visible loading state until the
  work resolves or errors. Prefer shared loading-button primitives over
  one-off spinners; always reset the state in `finally` and preserve accessible
  labels.
- **User-facing text must be localized correctly.** Every new or changed label,
  title, button, tooltip, snackbar, validation message, empty state, and error
  message must use the app localization system (`AppLocalizations` / ARB for
  Flutter, the registered translation system for web) instead of hardcoded
  English or one-off inline translation helpers. Add both English and French
  values, use placeholders for dynamic values, regenerate generated localization
  files, and run a missing-translation audit before finishing.
- **Separate pure logic from framework glue.** Keep business/transform logic in
  pure, exported functions so they can be unit-tested without a browser or
  React. UI components should be thin wrappers over tested logic.
- **Same code, different runtime ≠ infrastructure bug.** When one surface breaks
  and an identical build works elsewhere, suspect runtime/role/host-conditional
  code paths before blaming DNS/SSL/deploy. (admin vs business consoles ship the
  same bundle; only role and host-conditional code differ.)
- **Do not trust one local DNS path for production truth.** Router and ISP
  security filters can rewrite ordinary UDP DNS answers to a block-page IPv4
  and `AAAA ::` while authoritative DNS remains correct. Deployment DNS gates
  must use at least two trusted DNS-over-HTTPS resolvers, require consensus, and
  fail closed on disagreement or resolver errors.

## 4. Reuse before you build — no reinvented or partial components

When you implement something, **first search the repo for an existing
implementation and reuse or extend it.** Do not build a second, parallel version
of a thing that already exists — especially address/location pickers, country /
state / city selectors, status chips, currency/phone formatters, and
car-attribute option lists. Forking a partial copy is how we ended up with a
business address form that offered **8 countries** while a complete 249-country
catalog sat one file away.

Rules:

- **Search first.** Before writing a selector or option list, grep for the
  concept (`country`, `state`, `usState`, `catalog`, the data you need). If a
  canonical source exists, import it. If it is missing something, **extend the
  canonical source**, never start a private partial list.
- **Shared reference data must be complete.** A country picker must offer
  *every* country; a US state picker *every* state. Completeness is the default.
- **Curated subsets must be clearly named as curated** and must never be mistaken
  for the full set. Example: barrel **destination** countries are a deliberate
  West-Africa subset (`operations-panels.tsx` `countries`,
  `country_catalog.dart` filtered by the platform) — that is *not* the list an
  address picker should use.
- **Keep mobile and web in sync.** Reference data used on both platforms lives in
  one canonical file per platform with an `AUTO-PORTED` header pointing at the
  source of truth (see `us-locations.ts`, `country-catalog.ts`). Change the
  source, re-port — do not hand-edit one side.

### Canonical sources registry (reuse these — do not re-create)

| Data | Mobile (Flutter) | Web (admin_web) | Notes |
| --- | --- | --- | --- |
| **All countries** (complete) | `lib/data/country_catalog.dart` → `CountryCatalog.all` | `src/lib/country-catalog.ts` → `COUNTRY_CATALOG` / `COUNTRY_NAMES` | 249 ISO-3166 entries. For **address/location** pickers. |
| **Phone calling codes** | `lib/data/calling_code_catalog.dart` → `CallingCodeCatalog` | n/a | Generated from libphonenumber metadata. Reuse for phone country selectors and validation. |
| **Business address country options** | `lib/data/business_location_catalog.dart` → `businessCountryOptions()` | use `COUNTRY_NAMES` | Full catalog with common countries pinned on top. |
| **US states + cities** (complete) | `lib/data/us_locations.dart` → `usStateNames` | `src/lib/us-locations.ts` → `US_STATE_NAMES` | All states; cities per state. |
| **Barrel destination countries** (CURATED) | Firestore `destinationCountries` / `country_catalog.dart` filtered | `operations-panels.tsx` `countries` | Deliberately limited (West Africa). Not for addresses. |
| **Car attributes** (condition, body, fuel, …) | `staff_car_management_screen.dart` | `operations-panels.tsx` option lists | Keep both sides in sync. |
| **Console translations** | n/a (app uses ARB l10n) | `src/lib/french-dom.ts` | See the translation guardrails in §3. |

If the thing you need is not in this table and is reference data or a reusable
component, add it as a canonical source **and register it here** so the next
agent finds it.

## 5. Localization — translate every user-facing string

This product ships in **English and French**. A string that is only in English
is a bug for half the users. Every time you add or change user-facing copy,
localize it the right way and verify both languages — this is part of the
Definition of Done, checked on **every** implementation.

**Mobile app (Flutter) — ARB localization:**

- **Never hardcode a user-facing string.** Add the key to **both**
  `lib/l10n/app_en.arb` *and* `lib/l10n/app_fr.arb`, run `flutter gen-l10n`, and
  read it with `AppLocalizations.of(context)!.key`. A key missing from
  `app_fr.arb` means French users see English.
- Parameterized strings use ARB placeholders, not string interpolation of
  user-facing fragments.
- Grep for the visible text you just added: if it appears as a raw Dart string
  literal in a widget, it is not localized.

**Web consoles (admin_web) — runtime DOM translation:**

- The console renders English in the markup and is translated to French at
  runtime by `src/lib/french-dom.ts`. Any new English user-facing string —
  including `placeholder`, `title`, `aria-label`, and `alt` — **must** get an
  English→French entry in `TEXT_TRANSLATIONS` (or `ATTRIBUTE_TRANSLATIONS`),
  or French users see raw English.
- Keep the dictionary **convergent**: a translated value must not contain a
  source key that would re-translate it (the `french-dom.test.ts` convergence
  test enforces this — run `npm test`).

**Verify both languages.** Toggle French and confirm the new copy is translated
and fits (no overflow/clipping) — English text is often shorter than French.

> Known debt: recent barrel/navigation screens added hardcoded English strings
> (e.g. "Add another destination", "Shipping", "Destinations"). These need ARB
> keys + French translations to satisfy this rule.

## 6. Changing the guardrails

The preflight, CI, and these rules are themselves protected work. Changing them
to make a deploy pass is not allowed. Strengthen them when you find a new class
of failure: add the regression test, add the check, then document the lesson
here so the next agent inherits it.
