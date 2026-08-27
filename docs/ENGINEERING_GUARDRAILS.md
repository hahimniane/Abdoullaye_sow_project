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

## 1b. Machine prerequisites (a missing one blocks deploys silently)

Two things must exist on a machine before it can deploy. Neither fails with a
message that names itself, which is how both have already cost a day.

### Java — required for ANY Cloud Functions deploy

`firebase.json` runs `npm run lint` and `npm test` as a **predeploy** hook, and
part of that suite drives the Firestore emulator, which is a Java process. With
no Java on PATH the deploy dies locally, before anything reaches Google:

```
Error: Process `java -version` has exited with code 1.
Error: functions predeploy error: Command terminated with non-zero exit code 1
```

That text arrives several screens into unrelated passing test output, so it
reads like a flaky test rather than a hard stop. Install it:

```bash
brew install openjdk
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"   # add to your shell profile
java -version                                        # must print a version
```

**Why this matters more than it looks:** the failure is per-machine and total.
Functions stay at whatever revision last deployed successfully while the code,
the commits, and every local test say the change shipped. Short tracking codes
were committed, correct, tested, and *not live* for exactly this reason — the
symptom was a customer-facing code still in the old long format days later.

**So: never treat a function change as shipped because the commit landed.**
Confirm the deploy printed `Successful update operation` for the specific
function you changed, then confirm the behaviour in the product.

### The App Check site key — required for any static console deploy

`NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY` must be **exported** in the
deploy command's environment; preflight reads `process.env` directly and
`admin_web/.env.local` is never consulted. Missing it fails two checks that
look unrelated (see §2 and the deploy runbook). Recover the deployed value:

```bash
curl -s https://business.laawoldigital.com/ \
  | grep -oE '/_next/static/chunks/[^"]+\.js' | sort -u \
  | while read -r u; do
      curl -s "https://business.laawoldigital.com$u" \
        | LC_ALL=C grep -aoE '6L[A-Za-z0-9_-]{38,}' | head -1
    done | head -1
```

It is a public key (it ships to every visitor), so keeping it in a local file
such as `~/.laawol/appcheck.key` is fine and survives session restarts.

### App Check on the iOS simulator — every callable fails without this

A debug build activates `AppleDebugProvider` (`lib/main.dart`). With no
registered debug token the app still runs and Firestore reads still work —
**rules do not enforce App Check, callables do** — so the app looks signed in
and healthy while every `onCall` function rejects the request as
`[firebase_functions/unauthenticated] Unauthenticated`.

This is not an auth bug and no amount of re-signing-in fixes it. It cost a
full mobile test run: the tester correctly reported "nothing on the business
profile saves", which was true of the simulator and false of the product.

The token the simulator generates is printed on every launch:

```bash
xcrun simctl spawn booted log show --last 30m \
  --predicate 'eventMessage CONTAINS "App Check debug token"' | tail -1
```

Register that value once in Firebase Console → App Check → Apps → the iOS app
→ **Manage debug tokens**. It persists for that simulator device. A *different*
simulator, an erased device, or a reinstalled app can mint a new one — re-read
the log rather than assuming.

Before calling a mobile callable failure a product bug, check this first.

### Never run two function deploys at once

Each `firebase deploy --only functions:x` runs the predeploy hook, which
starts the Firestore and Auth emulators on fixed ports. A second deploy
launched while the first is still running fails with

```
Error: Could not start Authentication Emulator, port taken.
Error: functions predeploy error: Command terminated with non-zero exit code 1
```

and **zero test failures** — so it reads like a mysterious broken build when
nothing is wrong with the code. Deploy functions strictly one at a time, and
wait for the previous command to exit before starting the next.

The same clash happens between a deploy and **anything else running the
emulator suite** — a parallel agent running `npm test`, or a bare
`node --test` against a live emulator. The deploy dies with

```
⚠  firestore: Fatal error occurred:
Error: functions predeploy error: Command terminated with non-zero exit code 1
```

again with zero failing tests. Before deploying, check the ports are free:

```bash
lsof -ti :8080 :9099    # empty means no emulator is running
```


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

### Time-boxed CI-verification skip

Through **August 15, 2026 at 11:59:59 p.m. America/New_York**, the "Green CI
for deployed commit" preflight check is satisfied automatically, without
`ALLOW_UNVERIFIED_CI=1`, so deploys are not blocked waiting on a GitHub Actions
run to finish. The authorization expires automatically at
`2026-08-16T04:00:00Z`; after that instant preflight fails closed again and a
real green CI run (or an explicit, logged `ALLOW_UNVERIFIED_CI=1`) is required.
Every other gate still applies every time regardless of this window: clean
git tree, local unit tests, local build from source, App Check config, IAM
verification, and post-deploy smoke checks all still run and still block a
bad deploy. Only the wait for the remote CI result is skipped.

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
| **Car make/model/year** (complete, cascading) | `lib/data/car_catalog.dart` → `CarCatalog.instance` (backed by `assets/data/car_models_flutter.json`) | `src/lib/car-catalog.ts` → `getMakes()`/`getModels()`/`getYears()` (backed by `src/lib/car-models-data.json`, a verbatim copy) | 88 makes, 2,739 make/model/year rows. Do not accept free-text make/model — use the cascading pickers so listing data stays searchable/filterable. |
| **Console translations** | n/a (app uses ARB l10n) | `src/lib/french-dom.ts` | See the translation guardrails in §3. |

If the thing you need is not in this table and is reference data or a reusable
component, add it as a canonical source **and register it here** so the next
agent finds it.

### Testing means driving the interface (MANDATORY)

Use the **tester** agent (`.claude/agents/tester.md`) before reporting that
anything user-facing works. Do not self-certify.

None of the following is a test, and none may be offered as evidence a feature
works: it compiles, `flutter analyze`/`tsc` is clean, unit tests pass, the
deploy went green, an endpoint answered a probe, or the UI rendered. A form
that appears on screen and a form whose save silently fails are the same
screenshot.

A test drives the real interface as the real role: reach the feature the way a
user reaches it, perform the action, then verify the effect survived a reload
and landed where it should. Check the console and network for errors the UI
swallowed. Test both clients when both are affected.

This rule exists because it was broken. The transport edit drawer was reported
working while every save failed on a rejected `requestId` envelope, and a
cancel button was reported done while pointing at a callable name that did not
exist - both would have been caught by one real click. Unit tests passed for
both.

"Blocked" and "not verified" are acceptable outcomes and must be stated
plainly. Reporting a pass you did not observe is not.

### Scout before you build (MANDATORY first step)

Before writing a component, a picker, a catalog, or a helper, **search the
codebase for it first**. Most of what a new feature needs already exists — the
registry above lists the reference data, and `lib/widgets/` and
`src/components/` hold the shared UI. Reuse it, or extend it without changing
behaviour for its existing callers.

Building a parallel version is not a shortcut, it is a defect: a second
country list drifts from the first, a free-text field re-introduces the dirty
data the shared picker was written to prevent, and the bug then has to be
fixed twice. This has already happened here — a transport edit form shipped
with free-text make/model and no country selector while
`DestinationCountryField` and `CarCatalog` were sitting in the same repo, one
of them already imported by that very screen.

If reuse genuinely does not fit, say why in the commit message. "I did not
look" is not a reason.

### Both clients, every time (MANDATORY)

Laawol ships a Flutter app and web consoles against one backend. Before you
start, decide whether the change is user-facing on both — it almost always is —
and if so, **implement it on both in the same piece of work**.

This applies to fixes as much as features. A customer who can edit a request on
the web but not in the app, or cancel in the app but not on the web, has hit a
bug, and it reads as the product being unfinished. Both of those exact gaps
have occurred here.

Practical checks before calling a change done:
- Does the mobile screen and the console panel for this flow both exist? Both
  are updated.
- Does a new callable get exposed in both clients, or is one half unreachable?
- Do the two forms accept the same fields, use the same pickers, and enforce
  the same window?

State the parity decision in the commit message: which clients were touched,
and if only one, why the other genuinely does not apply.

### Form input rules (apply on BOTH clients)

These apply to every customer- and business-facing form, in the mobile app and
in the consoles. A form that follows them on one client and not the other is a
bug, not a difference in taste.

1. **If a canonical source exists, the input is a picker — never free text.**
   Make/model/year, countries, states, and cities all have catalogs in the
   registry above. Free text re-introduces "toyta", "Toyota " and "TOYOTA" as
   three different makes and quietly breaks search, filters, and matching.
   Cascading pickers must clear their dependents: changing the make clears the
   model and year, or the form keeps an impossible combination.

2. **A stored value that is not in the catalog must still be shown.** Records
   predate catalogs. Fold the current value into the options rather than
   rendering an empty picker, which silently looks like data loss and, on a
   Flutter `DropdownButton`, throws when the value is not among its items.

3. **Ask before you reveal.** Optional flows — pickup being the standard case —
   start with the question ("Do you need pickup?"), and the dependent fields
   appear only after the answer. Showing a pickup address to someone dropping
   off themselves invites them to fill in a field that changes their price.
   When the answer flips back to no, clear the dependent values; do not submit
   an address for a request with no pickup.

4. **Every field the backend accepts should be reachable in the UI.** If a
   callable supports editing a field, the form exposes it. A capability that
   ships server-side and never appears on screen reads to the user as a missing
   feature — this happened with the transport destination, which the server
   could re-match from the day it shipped while neither client offered it.

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
