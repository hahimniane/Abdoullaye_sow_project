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
- **Separate pure logic from framework glue.** Keep business/transform logic in
  pure, exported functions so they can be unit-tested without a browser or
  React. UI components should be thin wrappers over tested logic.
- **Same code, different runtime ≠ infrastructure bug.** When one surface breaks
  and an identical build works elsewhere, suspect runtime/role/host-conditional
  code paths before blaming DNS/SSL/deploy. (admin vs business consoles ship the
  same bundle; only role and host-conditional code differ.)

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
| **Business address country options** | `lib/data/business_location_catalog.dart` → `businessCountryOptions()` | use `COUNTRY_NAMES` | Full catalog with common countries pinned on top. |
| **US states + cities** (complete) | `lib/data/us_locations.dart` → `usStateNames` | `src/lib/us-locations.ts` → `US_STATE_NAMES` | All states; cities per state. |
| **Barrel destination countries** (CURATED) | Firestore `destinationCountries` / `country_catalog.dart` filtered | `operations-panels.tsx` `countries` | Deliberately limited (West Africa). Not for addresses. |
| **Car attributes** (condition, body, fuel, …) | `staff_car_management_screen.dart` | `operations-panels.tsx` option lists | Keep both sides in sync. |
| **Console translations** | n/a (app uses ARB l10n) | `src/lib/french-dom.ts` | See the translation guardrails in §3. |

If the thing you need is not in this table and is reference data or a reusable
component, add it as a canonical source **and register it here** so the next
agent finds it.

## 5. Changing the guardrails

The preflight, CI, and these rules are themselves protected work. Changing them
to make a deploy pass is not allowed. Strengthen them when you find a new class
of failure: add the regression test, add the check, then document the lesson
here so the next agent inherits it.
