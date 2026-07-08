# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ Engineering guardrails — READ FIRST (MANDATORY)

Before changing or deploying anything, follow **[docs/ENGINEERING_GUARDRAILS.md](docs/ENGINEERING_GUARDRAILS.md)**. Non-negotiables:

- **Definition of Done:** typecheck + tests + build pass, and any UI/behavior change is **verified in a real running app/browser** — not just "it compiles." When you fix a bug, add a regression test.
- **Deploy gate:** production deploys go through `deploy/` preflight, which enforces a **clean git tree** (deploy only committed code; emergency override `ALLOW_DIRTY_DEPLOY=1`), **passing unit tests**, and **build-from-source** (never deploy a stale/hand-edited `admin_web/out/`). CI (`.github/workflows/ci.yml`) must be green.
- **Design patterns:** no O(N) work per render/DOM-node (precompute once); `MutationObserver`s must never react to their own writes (guard + `takeRecords()`); transforms must converge/be idempotent; loading states must always resolve (safety timeout on every path); keep pure logic separate and unit-tested.
- **Reuse before you build:** search for an existing component/data source and reuse or extend it — never fork a partial copy. Shared reference data must be **complete** (a country picker offers every country; a state picker every state). Use the **Canonical sources registry** in the guardrails doc (e.g. `country_catalog.dart` / `country-catalog.ts` for all countries, `us_locations.dart` / `us-locations.ts` for US states). Curated subsets (e.g. barrel destination countries) are the explicit exception.
- **Localize every user-facing string (both languages):** Flutter — never hardcode copy; add keys to **both** `app_en.arb` and `app_fr.arb`, run `flutter gen-l10n`, use `AppLocalizations`. Web — add an English→French entry to `french-dom.ts` for every new string (incl. `placeholder`/`title`/`aria-label`). Verify it renders in English **and** French. A string only in English is a bug. (Guardrails §5.)

## Project Overview

This is a Flutter application for a car selling and shipping services business with Firebase backend integration. The app supports three user roles (customer, staff, admin) with distinct navigation flows and features. It includes localization support for English and French.

**Key Technologies:**
- Flutter 3.7.2+ with Material Design 3
- Firebase (Authentication + Firestore)
- Provider pattern for state management
- Platform-specific native features (iOS/Android)

## Development Commands

### Setup
```bash
# Install dependencies
flutter pub get

# Generate localization files (required after ARB file changes)
flutter gen-l10n

# Install iOS pods (macOS only)
cd ios && pod install && cd ..
```

### Running the App
```bash
# Run on connected device/emulator
flutter run

# Run on specific device
flutter devices  # List available devices
flutter run -d <device-id>

# Run with specific flavor
flutter run --debug
flutter run --release
flutter run --profile
```

### Building
```bash
# Build APK (Android)
flutter build apk
flutter build apk --split-per-abi  # Generate smaller APKs

# Build iOS (macOS only, requires Xcode)
flutter build ios
flutter build ipa  # For App Store distribution

# Build for web
flutter build web
```

### Code Quality
```bash
# Run linter
flutter analyze

# Format code
flutter format .
flutter format lib/

# Run tests
flutter test
flutter test test/widget_test.dart  # Run single test file
flutter test --coverage  # Generate coverage report
```

### Firebase
```bash
# The app is configured with Firebase project: car-selling-flutter-app
# Firebase options are in lib/firebase_options.dart
# Firestore security rules are in ../firestore.rules at project root
```

## Architecture Overview

### Directory Structure
```
lib/
├── main.dart                    # App entry point with MultiProvider setup
├── firebase_options.dart        # Auto-generated Firebase configuration
├── providers/                   # State management (Provider pattern)
│   ├── auth_provider.dart      # Firebase Auth + Firestore user management
│   └── language_provider.dart  # Localization state
├── screens/                     # 18+ screens organized by feature
│   ├── splash_screen.dart
│   ├── login_screen.dart       # Staff authentication
│   ├── customer_home_screen.dart
│   ├── staff_home_screen.dart
│   └── ...
├── widgets/                     # Reusable components
│   └── language_toggle.dart
└── l10n/                        # Localization files
    ├── app_en.arb              # English strings (150+ keys)
    ├── app_fr.arb              # French translations
    └── app_localizations*.dart # Auto-generated
```

### State Management: Provider Pattern

The app uses **Provider** for state management with two main providers:

1. **AuthProvider** ([lib/providers/auth_provider.dart](lib/providers/auth_provider.dart))
   - Manages Firebase Authentication and Firestore user profiles
   - Auto-syncs auth state with Firestore role data
   - Listens to `authStateChanges()` for session persistence
   - Exposes: `isStaff`, `isAdmin`, `userEmail`, `currentUser`
   - Methods: `login()`, `logout()`, `createStaffAccount()`, `updateUserRole()`

2. **LanguageProvider** ([lib/providers/language_provider.dart](lib/providers/language_provider.dart))
   - Manages locale switching (English/French)
   - Triggers app-wide rebuilds on language change
   - Exposes: `currentLocale`, `isEnglish`, `isFrench`, `toggleLanguage()`

**Access patterns:**
```dart
// Listen to changes (rebuilds on state update)
Consumer<AuthProvider>(builder: (context, auth, child) => ...)

// One-time access (no rebuild)
Provider.of<AuthProvider>(context, listen: false).login(...)

// Multiple providers
Consumer2<LanguageProvider, AuthProvider>(...)
```

### Firebase Integration

**Authentication Flow:**
- Email/password sign-in via `signInWithEmailAndPassword()`
- Auto-creates Firestore user profile on first login
- Password reset via `sendPasswordResetEmail()`
- Session persistence through `authStateChanges()` stream

**Firestore Schema:**
```
users/
  {uid}/
    email: string
    role: 'customer' | 'staff' | 'admin'
    createdAt: Timestamp
    updatedAt: Timestamp
```

**Security Rules:** See [firestore.rules](../firestore.rules) at project root
- Users can read/update their own profile (except role)
- Admins can read all profiles and update roles
- Role-based access enforced both client-side and server-side

### User Roles & Navigation

**Three role-based flows:**

1. **Customer** (default)
   - Entry: Splash Screen → Customer Home Screen
   - Features: Browse cars, tracking, settings
   - Hidden feature: 5-tap on settings version unlocks staff login

2. **Staff**
   - Entry: Login Screen → Staff Home Screen
   - Features: All customer features + service forms (park car, send barrels, transport cars)
   - Access: Car management dashboard

3. **Admin** (staff with elevated privileges)
   - All staff features + user management
   - Can create staff accounts and change user roles
   - "Users" tab appears in staff navigation

**Named Routes:**
- `/splash` - Splash screen (initial route)
- `/` - Customer home
- `/login` - Staff login
- `/staff-home` - Staff dashboard
- `/user-management` - Admin user management
- See [lib/main.dart:60-86](lib/main.dart#L60-L86) for complete route list

### Localization System

**ARB-based localization with code generation:**
- Strings defined in [lib/l10n/app_en.arb](lib/l10n/app_en.arb) (English, complete)
- French translations in [lib/l10n/app_fr.arb](lib/l10n/app_fr.arb) (partial)
- Auto-generated access via `AppLocalizations.of(context)!.stringKey`
- Dynamic switching without app restart via `LanguageProvider`

**After modifying ARB files, regenerate:**
```bash
flutter gen-l10n
```

**String categories:**
- Authentication messages
- UI labels and buttons
- Service/feature names
- Validation errors
- Parameterized strings (e.g., `helloUser(String name)`)

### Key Screens Implementation Notes

**ParkCarScreen** ([lib/screens/park_car_screen.dart](lib/screens/park_car_screen.dart))
- Complex form with 20+ fields and validation
- Platform-specific date/time pickers (CupertinoDatePicker on iOS, Material on Android)
- Generates PDF receipts using `pdf` package
- Prints receipts using `printing` package
- 745 lines - largest screen in the app

**UserManagementScreen** ([lib/screens/user_management_screen.dart](lib/screens/user_management_screen.dart))
- Real-time Firestore updates via `StreamBuilder`
- Role management with popup menu
- Admin-only access (enforced in navigation)

**TrackingScreen** ([lib/screens/tracking_screen.dart](lib/screens/tracking_screen.dart))
- Embeds Maersk tracking service via `webview_flutter`
- Custom navigation controls

**SellCarsScreen** ([lib/screens/sell_cars_screen.dart](lib/screens/sell_cars_screen.dart))
- Currently uses mock data with Unsplash images
- Search/filter functionality
- WhatsApp integration via `url_launcher`

### Design Patterns & Conventions

**Consistent UI Elements:**
- Primary gradient: `#667eea` to `#764ba2` (purple)
- Form fields: 12dp border radius, `OutlineInputBorder`, grey.shade50 fill
- Cards: 16-20dp border radius with box shadows
- Feedback: `ScaffoldMessenger.showSnackBar()` for errors/success

**Platform-Specific Code:**
- Always use `Platform.isIOS` checks for iOS-specific features
- iOS: `CupertinoDatePicker`, `CupertinoAlertDialog`
- Android: `showDatePicker()`, `showTimePicker()`, Material dialogs

**Error Handling:**
- Try-catch blocks with Firebase error code mapping
- User-friendly error messages via localization
- Loading states via `_isLoading` boolean flags

**Form Validation:**
- `GlobalKey<FormState>` pattern
- Localized validator messages
- `TextEditingController` for input management

## Working with This Codebase

### Adding a New Screen

1. Create screen file in `lib/screens/`
2. Import required providers: `import 'package:provider/provider.dart';`
3. Add Consumer/Provider.of for state access
4. Use `AppLocalizations.of(context)!.stringKey` for all text
5. Add route in `lib/main.dart` routes map
6. Update navigation logic in appropriate home screen

### Adding Localization Strings

1. Add key-value to [lib/l10n/app_en.arb](lib/l10n/app_en.arb)
2. Add corresponding translation to [lib/l10n/app_fr.arb](lib/l10n/app_fr.arb)
3. Run `flutter gen-l10n`
4. Access via `AppLocalizations.of(context)!.newKey`

### Modifying User Roles/Permissions

1. Update `AuthProvider` methods if needed
2. Modify Firestore security rules in [../firestore.rules](../firestore.rules)
3. Deploy rules: `firebase deploy --only firestore:rules`
4. Update navigation logic in `main.dart` and home screens

### Adding Firebase Collections

1. Define schema in code comments
2. Add security rules to [../firestore.rules](../firestore.rules)
3. Create service methods in `AuthProvider` or new provider
4. Use `StreamBuilder` for real-time updates or `FutureBuilder` for one-time reads

### Testing

The project has minimal test coverage currently. When adding tests:
- Widget tests go in `test/` directory
- Use `flutter test` to run all tests
- Mock Firebase with `firebase_auth_mocks` and `fake_cloud_firestore` packages (not currently installed)

## Known Limitations

- Some service forms (barrels, transport) have UI but lack backend implementation
- Car management dashboard uses mock data
- No offline mode support
- Firebase API keys are embedded in `firebase_options.dart` (consider environment variables for production)
- Test coverage is minimal
