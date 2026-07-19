# QA / release-readiness handoff

You are continuing a QA/release-readiness pass on a Flutter app that a previous session started but was handed off mid-task. Read this whole brief before doing anything — it captures everything already learned so you don't repeat work.

## Current continuation snapshot — 2026-07-19

The detailed, row-by-row source of truth is now
`my_flutter_app/docs/ios-role-feature-qa.md`. Continue updating that matrix as
each state is exercised; do not infer that all testing is complete from a
passing automated suite.

Latest verified state:

- The screenshot-reported shared-barrel failure was caused by an unverified
  phone account reaching a callable that returned a raw Firebase exception.
  The app now presents a localized recovery/verification path, the backend
  synchronizes only Firebase-verified phone numbers, editing a verified number
  invalidates verification, and a dedicated unverified customer is part of the
  reusable E2E seed. Shared-barrel callable lifecycle tests are 22/22 PASS.
  Physical-iPhone OTP/runtime verification of this repaired branch is still
  pending and remains a release blocker.
- The customer car purchase reached a real Stripe TEST PaymentSheet and
  succeeded; PaymentIntent `pi_3Tuie6EO69oPXmLj0oq072FD` is test-mode, not
  live. Full-barrel shipment payment/creation and shared-barrel approval,
  rejection, and original-payment refund records were also exercised. See the
  QA matrix for remaining receipt, wallet, retry, and cancellation gaps.
- Image attachments now have a review step with preview, Cancel, Replace,
  Upload, caption, and retry. Widget regressions cover cancel-without-write,
  replacement, failed retry, narrow layout, and French. The production Storage
  IAM prerequisite is still failing, so production upload readiness is not
  claimed.
- Every admin web section and every business-console section was exercised in a
  real browser, including English/French, 390 px layout, empty validation,
  modal cancel paths, restricted access, Stripe payout states, and preview
  isolation. Repairs prevent preview tabs from opening authenticated Firestore
  listeners or live Pro checkout, correct French dynamic status copy, and
  remove the 390 px overflow. Admin web gates are 73/73 tests, typecheck, and
  production build PASS.
- Restricted Flutter staff access now loads `businessPermissions`, hides denied
  tabs, and skips denied activity listeners. Rules and permission regressions
  pass, but a real restricted-staff runtime pass is still pending.
- Latest Flutter gates: `flutter analyze` PASS and 157/157 tests PASS. The full
  Functions/emulator command passes, including 121 unit/payment/security tests,
  isolated admin/service/shared-barrel/support suites, and 46/46 rules tests.
- App version is `1.0.0+15`. The signed App Store IPA was copied to
  `/Users/hashimniane/Downloads/Laawol-1.0.0-15.ipa`. Bundle/version metadata and
  the deep signature pass. SHA-256:
  `7534604b4bcf01cbc356eb32d1aca343ea0c35a25b4994c4e7353e1a19cfb5b7`.
- Build 15 contains the complete phone-verification UX and backend callable
  client changes. Deploy the matching Firebase Functions before distributing
  this build to testers.
- The disposable Xcode/Flutter build output was removed after re-verifying the
  handoff IPA. Free disk is about 12 GiB; stop new heavy builds at 6 GiB.
  Simulator, Flutter-run, web-preview, Playwright, and Firebase emulator
  processes are stopped.

Important remaining work is recorded as `PENDING`, `FAIL`, or `BLOCKED` in the
QA matrix. In particular: physical-device OTP/camera/Face ID/APNs checks,
restricted-staff runtime verification, native admin capability gating and
finance/refund UI, shared-barrel customer receipt/wallet behavior, selected
retry/idempotency/offline paths, the Storage IAM prerequisite, clean release
commit/green CI, and production smoke/deploy. Do not call the app fully tested
or release-ready until those rows are closed.

## Project & goal
Repo: `/Users/hashimniane/Abdoullaye_sow_project` (git branch: `codex/public-site-motion`). App: `my_flutter_app/` — a car-selling + barrel/freight shipping business app (customer, staff, admin roles), Firebase-backed, English/French localized. See `/Users/hashimniane/Abdoullaye_sow_project/CLAUDE.md` for house rules (read it — it overrides defaults). Key non-negotiables from it: Definition of Done = typecheck + tests + build pass AND the UI change is verified in a real running app (not just "it compiles"); any bug fix needs a regression test; any new user-facing string needs BOTH `app_en.arb` and `app_fr.arb` entries plus `flutter gen-l10n`, verified in both languages.

The user's actual ask: "test this app... launch the device and test by clicking everything and make sure it's ready for release. if something is broken you fix it if you are confused you ask me."

## Environment state — already fixed, don't redo
- Disk was nearly full (1.2GB free), causing freezes. The latest cleanup leaves
  about 12 GiB free; 6 GiB is the hard stop for heavy test/build work. Cleared
  Xcode DerivedData, Dart analysis server cache, stale Flutter build artifacts,
  wiped one bloated E2E simulator's app data, removed `/Applications/Xcode-beta.app`
  (user's explicit choice, after being warned it would remove the ability to
  install on their physical iOS 27 phone — accepted), and removed the redundant
  iOS 26.3 simulator runtime (kept iOS 26.5). Only Xcode.app 26.6 (stable)
  remains, `xcode-select` already points to it.
- The Flutter engine's `flutter_tester` binary was missing from `~/flutter/bin/cache/artifacts/engine/darwin-x64/` (almost certainly corrupted by the earlier disk-full freeze) — fixed by running `flutter precache --force`. If you ever see "Failed to find flutter_tester" again, that's the fix.
- `flutter analyze`: clean, no issues. `flutter test`: all 157 tests pass. Both
  verified after the latest code changes — rerun after any further code change.
- Simulator device: "Laawol E2E iPhone 17 Pro" (UDID `B4A0415D-FB22-4D9D-9CAC-F9B7A9864806`), iOS 26.5, was booted. It was recreated (the old one was pinned to the now-deleted iOS 26.3 runtime) — nothing in `maestro/*.yaml` or docs referenced its UDID by name, so recreating it was safe.
- App and Simulator are currently stopped. A prior run used:
  `flutter run -d B4A0415D-FB22-4D9D-9CAC-F9B7A9864806 --debug`, logging to
  `/tmp/flutter_run.log`.
- Screenshot method (no generic GUI-automation tool available for the Simulator app itself): `xcrun simctl io "Laawol E2E iPhone 17 Pro" screenshot /tmp/screen_NN.png`, then view the png.
- The app launched cleanly to the customer home screen (title "Good evening / there", quick actions: Send a barrel / Browse cars / Track Shipment, bottom nav: Home/Shipping/Cars/Activity/Settings) — confirmed via screenshot, looked correct.

## The blocker that was still open — pick this up first
This project already has an established Maestro (mobile.dev, v2.6.1, at `~/.maestro/bin/maestro`) E2E suite: `my_flutter_app/maestro/*.yaml`, documented in `my_flutter_app/maestro/README.md`. Tried to reuse Maestro to drive taps through the app (no generic desktop/simulator GUI tool was otherwise available).

**Problem found:** a Maestro flow doing `tapOn: "Browse cars"` against the running app FAILED with "Element not found" — the captured UI hierarchy JSON in the debug artifacts (`~/.maestro/tests/<timestamp>/commands-*.json`) showed the accessibility tree only contains OS status-bar items ("No signal", "Not charging", "SSID...") — NONE of the Flutter app's own widget text is exposed. This is a known Flutter+XCUITest-based-tooling issue: Flutter doesn't populate its semantics tree (what native accessibility/XCUITest reads) unless something activates it — normally an active accessibility client like VoiceOver, the `integration_test` package's binding, or an explicit `SemanticsBinding.instance.ensureSemantics()` call in app code (grepped the codebase — no such call exists in `lib/main.dart` or anywhere).

Confirmed it's **NOT** an Xcode-beta issue: Maestro's own XCTest runner (`maestro-driver-iosUITests-Runner`) built and ran fine with plain Xcode.app 26.6, no `DEVELOPER_DIR` override, no crashes in its log (`~/.maestro/tests/<ts>/xctest_runner_*.log`) — just the empty-semantics symptom. Also confirmed native OS screens ARE visible to Maestro (successfully drove Settings.app: `launchApp com.apple.Preferences` → `tapOn "Accessibility"` worked and produced a real screenshot of the Accessibility settings page). So the XCUITest pipeline itself works; it's specifically Flutter's own content that's invisible.

Was testing the standard workaround — enabling VoiceOver via Settings > Accessibility > VoiceOver, which should force Flutter's `SemanticsBinding` to auto-activate — but got interrupted mid-navigation. Screenshot showed the Accessibility page's "Vision" section with only: Hover Text, Display & Text Size, Motion, Spoken Content (no visible "VoiceOver" or "Zoom" entry — iOS 26's Accessibility settings appear reorganized vs. older iOS versions that Maestro guides usually assume). A `scrollUntilVisible` for "VoiceOver" text then failed to find it too, and the flow seems to have ended up back on the main Settings list rather than staying in Accessibility (possibly a stray back-navigation or the scroll overshot into a different page — unclear, re-verify from scratch).

**First job: get Maestro (or some other means) actually able to see and tap Flutter widgets in this app.** Approaches to try, in rough order of promise:
1. Re-navigate Settings > Accessibility carefully with screenshots after every step (don't chain multiple untested taps) and thoroughly scroll the ENTIRE Vision section — VoiceOver might just be further down, relabeled, or nested. Once found, toggle it on, then relaunch/foreground the app and retry `tapOn: "Browse cars"` — if the semantics tree populates, Flutter widgets should become tappable by text (VoiceOver changes gesture semantics in the OS, but Maestro/XCUITest's element-based `.tap()` API bypasses raw gesture simulation and works correctly even with VoiceOver on — this is the standard documented approach for testing Flutter apps with Appium/Maestro).
2. Read `my_flutter_app/docs/agents/testing-agent.md` IN FULL (only lines ~100-170 were reviewed) and `my_flutter_app/maestro/README.md` IN FULL, plus check `my_flutter_app/maestro/*.yaml` for any setup step that might've been missed (e.g. a `runFlow`, launch argument, or environment variable that enables semantics) — since these flows apparently worked for whoever wrote them, there may be a documented trick not yet tried.
3. Check whether `flutter run` has a flag, or the app has a debug affordance (search `lib/` for any debug-only "enable accessibility" toggle). Also worth trying: Xcode's Accessibility Inspector (Xcode > Open Developer Tool > Accessibility Inspector, targeting the simulator) — might achieve the same semantics activation without changing OS-wide VoiceOver behavior. Can potentially be scripted via `open -a "Accessibility Inspector"` plus AppleScript.
4. If Maestro really can't be made to work in reasonable time, fall back to: `xcrun simctl io ... screenshot` to see the UI, and drive taps via AppleScript/System Events (`osascript`) clicking the actual Simulator.app window at real screen coordinates — computed by reading the Simulator window's frame (`osascript -e 'tell application "System Events" to get {position, size} of window 1 of process "Simulator"'`) and mapping screenshot pixel coordinates (screenshots are exactly device resolution, e.g. 1206x2622 for this iPhone 17 Pro simulator) proportionally onto that window frame, then click via `cliclick` (check if installed) or `osascript -e 'tell application "System Events" to click at {x, y}'`. Fragile but works as a last resort.
5. Even if Flutter semantics stays unsolved, Maestro can still test navigation between apps and OS-level permission dialogs (camera/photo library prompts) since those are native — reserve screenshot + manual coordinate-tap specifically for in-app Flutter widget interaction.

Don't burn more than ~30-45 minutes chasing the semantics issue before falling back to manual coordinate tapping via screenshots — the goal is thorough app testing, not a perfect Maestro setup. Whichever method works, use it consistently for the rest of the session.

## A second thing flagged but not resolved — revisit carefully
`my_flutter_app/docs/agents/testing-agent.md` (around line 133-135, 160-162) states local iPhone E2E testing explicitly requires `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer`, and mentions "the current iOS toolchain may require the `objective_c` package hook to derive DEVELOPER_DIR from Xcode's compiler path" as a "local cache workaround, not a product fix; retest after Flutter or objective_c upgrades." Xcode-beta.app was already removed (user's informed choice). Plain `flutter build ios`, `flutter run`, and Maestro's own XCTest runner all worked fine with just stable Xcode.app 26.6 and no `DEVELOPER_DIR` override — so this seems like it may have been a stale note tied to an older Xcode/Flutter version combo. But if you hit ANY build failure mentioning `objective_c`, `DEVELOPER_DIR` resolution, or a plugin codegen step failing, that's likely this exact issue resurfacing — do NOT silently reinstall Xcode-beta as a fix. Stop, explain the specific failure, and flag it as a question for the user (they may need to decide whether to keep waiting on stable Xcode/Flutter to catch up, or reinstall the beta and accept losing the ability to test on their physical iOS-27 phone in the meantime).

Once confident the app builds/runs/tests fine without Xcode-beta (currently looks true), update `my_flutter_app/maestro/README.md` and `my_flutter_app/docs/agents/testing-agent.md` to remove/soften the Xcode-beta requirement — but only after actually running a real Maestro flow successfully end-to-end without it (e.g. get `customer_freight_settlement.yaml` passing per the README's own documented steps), since that's the real proof, not just a plain `flutter run`.

## Then: the actual QA work
1. Manually/systematically click through every screen for all three roles — customer, staff, admin. For staff/admin you'll need real accounts; check `my_flutter_app/functions/scripts/seed-e2e-emulator.js` and `my_flutter_app/maestro/README.md` for how to start Firebase emulators (Auth, Firestore, Functions, Storage) with `SIMULATE_PAYMENTS=true`, seed them (`cd my_flutter_app/functions && npm run seed:e2e-emulator`), and launch the app against them: `flutter run -d <device> --dart-define=USE_FIREBASE_EMULATORS=true --dart-define=SIMULATE_PAYMENTS=true --dart-define=FIREBASE_EMULATOR_PROJECT_ID=<same demo project id the seed script uses>`. The README warns a shell-exported env var is NOT enough for `String.fromEnvironment` — must pass `--dart-define` explicitly. Also: "the seeded password" must be passed to Maestro via `-e E2E_TEST_PASSWORD='...'`, not a shell var.
2. Note everything clicked, what worked, what looks broken/half-implemented (CLAUDE.md's "Known Limitations" section already flags: some barrel/transport forms have UI but no backend, car dashboard uses mock data — don't be surprised by known gaps, but DO flag anything that looks like a genuine regression or crash).
3. Fix real bugs found directly (per CLAUDE.md: reuse existing components, don't fork partial copies; localize every new/changed user-facing string in both `app_en.arb` and `app_fr.arb` then run `flutter gen-l10n`; add a regression test for any bug fix). Re-run `flutter analyze` and `flutter test` after any fix.
4. Run the existing `my_flutter_app/maestro/*.yaml` flows once tap automation works, per the README's ordering (`customer_freight_settlement.yaml` first — it resets app/keychain state — then others; reseed the emulator before repeating it since a successful run intentionally leaves the shipment settled).
5. Do NOT commit anything to git — there's substantial pre-existing uncommitted work in the tree (many modified/untracked files, unrelated to this task) from before this session started. Leave the working tree as-is beyond the fixes made; don't run `git add`/`git commit` unless explicitly asked.
6. Do NOT push, deploy, or run anything under `deploy/` — this task is local QA only.

## Reporting
When done or stuck, give a clear final report: what was tested, what was fixed (with file:line references), what's still broken or ambiguous and needs a product-decision answer from the user, and the current state of the running app/simulator so whoever picks this up next knows exactly where things stand.
