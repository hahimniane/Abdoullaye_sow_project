# Flutter Architecture Agent Memory

## Mission

Keep the Flutter codebase coherent as features grow. Protect navigation, state management, localization, Firebase integration, shared widgets, and module boundaries.

## Current App Shape

- Entry point: `lib/main.dart`.
- App shell: `MaterialApp` wrapped in `MultiProvider`.
- Providers currently include `LanguageProvider`, `AuthProvider`, and `ThemeProvider`.
- Themes live in `lib/theme/`.
- Localization lives in `lib/l10n/` with English and French ARB files.
- Screens live in `lib/screens/`.
- Shared widgets live in `lib/widgets/`.
- Services live in `lib/services/`.
- Models live in `lib/models/`.
- Data catalogs live in `lib/data/`.
- Firebase options are in `lib/firebase_options.dart`.

## Current Routing Notes

The app uses named routes in `MaterialApp.routes`, including:

- `/splash`
- `/`
- `/login`
- `/signup`
- `/forgot-password`
- `/customer_home`
- `/park`
- `/barrel`
- `/transport`
- `/sell`
- `/tracking`
- `/my-purchases`
- `/purchase-management`
- `/destination-countries`
- detail routes that expect typed `ModalRoute` arguments
- staff and user-management routes

When adding routes, update route names consistently and verify argument types at navigation call sites.

Route audit command:

```sh
rg -n "pushNamed|pushReplacementNamed|pushNamedAndRemoveUntil|routes:" lib
```

When changing navigation, compare every named route call against `MaterialApp.routes` in `lib/main.dart`. Flag any route string used by screens but missing from the route table. Current route-sensitive areas include account profile, wallet, business management, destination countries, staff management, purchase management, and detail pages.

## High-Risk Domains

- Auth roles and staff/admin/business permissions.
- Stripe purchase, deposit, and full-payment flows.
- Firestore document fields used by models and services.
- Destination country catalogs and fallback behavior.
- Barrel, transport, purchase tracking, and receipt generation.
- Generated localization and bilingual route/screen copy.

## Architecture Preferences

- Follow existing Provider and service patterns unless a change clearly requires a larger migration.
- Keep shared UI in `lib/widgets/` when multiple screens use it.
- Keep business logic out of widget build methods when it can live in services, models, or small helpers.
- Do not duplicate localization strings across screens; add keys to ARB files and regenerate when needed.
- Prefer explicit model methods for serialization/deserialization rather than ad hoc map access in screens.
- Keep Firebase calls behind services where practical.
- Be careful with dirty worktrees. Many files may already contain user or generated changes.

## Review Checklist

- Are imports organized and unused imports removed?
- Does the change respect existing provider ownership?
- Are async calls handled with mounted checks where UI state may update after awaits?
- Are route arguments typed and validated at both sender and receiver?
- Are localization keys present in English and French?
- Did the change accidentally create a second source of truth?
- Are shared widgets still reusable and not overloaded with screen-specific logic?

## Output Style

Return file-specific findings or changes, with attention to cross-screen effects. When proposing refactors, separate required fixes from optional cleanup.

## Durable Architecture Lessons

Add future project conventions and repeated architectural decisions here.
