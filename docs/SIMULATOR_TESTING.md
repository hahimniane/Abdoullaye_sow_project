# Driving the iOS Simulator for Testing (Handoff Runbook)

This explains how to **control and test the Flutter app on the iOS Simulator**
programmatically. Use this when you need to tap/type/scroll and verify screens.

## TL;DR — the tool that works is **Maestro**
`cliclick`/AppleScript (screen-coordinate clicks) and `idb` were dead ends on this
machine (dual-monitor + Retina mapping issues, Screen-Recording permission missing,
`idb-companion` removed from Homebrew). **Maestro taps in the device's own
coordinate space** (by text or by screen %), so it ignores all of that.

```bash
export PATH="$HOME/.maestro/bin:$PATH"
export JAVA_HOME=/opt/homebrew/opt/openjdk@17   # Maestro needs a JDK
```

Maestro is installed at `~/.maestro/bin/maestro` (via `curl -Ls https://get.maestro.mobile.dev | bash`).

## Key identifiers (re-derive if they changed)
- **Simulator UDID**: `9BF0BD36-1FC0-4DF4-BBA5-F348CA5F23D7` (iPhone 17 Pro Max,
  iOS 26.5). Re-derive: `xcrun simctl list devices | grep Booted`
- **App bundle id**: `com.laawoldigital.app`
  (re-derive: `grep PRODUCT_BUNDLE_IDENTIFIER ios/Runner.xcodeproj/project.pbxproj`)
- **Project**: `/Users/hashimniane/Downloads/Abdoullaye_sow_project/my_flutter_app`

Claude Code's built-in iOS Simulator tool now drives the sim directly (attach /
launch / screenshot / tap in device points), so Maestro is optional for
interactive checks. The Maestro notes below still apply for scripted flows.

## Firebase App Check blocks Firestore in debug
A debug build attests with a debug token. If that token is not registered, every
Firestore read is rejected and screens render empty with no visible error - the
symptom is a picker that opens to nothing, or a button that does nothing.
Check with:
`xcrun simctl spawn <UDID> log show --last 5m --predicate 'processImagePath CONTAINS "Runner"' | grep -i appcheck`
A `Failed to exchange debug token ... 403` means it is unregistered. Register the
token printed in that same log under Firebase Console -> App Check -> the iOS app
-> Manage debug tokens. Pass a stable one instead of the auto-generated per-install
token with `--dart-define=FIREBASE_APP_CHECK_DEBUG_TOKEN=<uuid>` so it survives
reinstalls (see `lib/main.dart:75`).

## ⚠️ #1 gotcha: the sim freezes under RAM pressure
This machine is RAM-constrained. When the sim is frozen, **Maestro still reports
`Tap ... COMPLETED` but nothing happens on screen** (taps queue, then all fire at
once when it recovers — which can land you on the wrong screen). If a tap has no
effect: the sim is frozen, not the tooling. **Fix: close Chrome/Cursor/Zoom/Spotify**
to free memory, then retry. (Disk was already cleared; RAM is the bottleneck.)

## Run a tap (write a tiny flow, then run it)
```bash
cat > /tmp/flow.yaml <<'EOF'
appId: com.laawoldigital.app
---
- tapOn: "Send Barrels"          # tap by visible text (Flutter semantics ARE exposed)
EOF
maestro test /tmp/flow.yaml
```
Tap by **screen percentage** when text is ambiguous (good for the bottom nav):
```yaml
- tapOn:
    point: "30%, 96%"            # x%, y% of the device screen
```
Bottom nav item centers (5 tabs): Home ~11%, Shipping ~31%, Cars ~50%,
Activity ~69%, Settings ~89%; the bar sits at ~95–97% height. (Send Barrels now
lives under Shipping, not the tab bar.)

Other useful Maestro commands inside a flow:
```yaml
- inputText: "some text"          # types into the focused field
- swipe: { direction: UP }        # scroll
- assertVisible: "Open barrels"   # verify a screen/element
- takeScreenshot: /tmp/shot       # Maestro's own screenshot (-> /tmp/shot.png)
- launchApp                       # (re)launch the app
```

## See the screen (device framebuffer — always works, no permissions)
`simctl io screenshot` reads the device buffer directly (unlike macOS
`screencapture`, which is blocked here by the missing Screen-Recording permission):
```bash
xcrun simctl io 9BF0BD36-1FC0-4DF4-BBA5-F348CA5F23D7 screenshot /tmp/s.png
sips -Z 1200 /tmp/s.png            # downscale so it's easy to view/read
```
Then view `/tmp/s.png`. Native size is 1206x2622 (iPhone 17 Pro @3x → 402x874 pts).

## Relaunch / rebuild the app
Dart-only changes never need a native rebuild — stay inside one `flutter run`
session and hot reload (`r`) / hot restart (`R`). A full native rebuild is only
needed after changing native code, `Podfile`, `pubspec.yaml`, or `Info.plist`.
```bash
cd /Users/hashimniane/Downloads/Abdoullaye_sow_project/my_flutter_app
flutter run -d 9BF0BD36-1FC0-4DF4-BBA5-F348CA5F23D7 --no-version-check
# or, app already built, just (re)install + launch:
xcrun simctl install <UDID> build/ios/iphonesimulator/Runner.app
xcrun simctl launch  <UDID> com.laawoldigital.app
```
**On 8 GB machines cap Xcode's parallelism or the build thrashes and never
finishes** (it schedules one compile job per core regardless of RAM):
`defaults write com.apple.dt.Xcode IDEBuildOperationMaxNumberOfConcurrentCompileTasks 3`
Close Chrome before a native rebuild. To tell a slow build from a stuck one,
check whether clang is actually burning CPU: `ps -Ao %cpu=,comm= -r | head -5`.
If the sim data store gets corrupted ("Data Migration Failed" on boot):
`xcrun simctl shutdown <UDID> && xcrun simctl erase <UDID> && xcrun simctl boot <UDID>`
then reinstall the app.

## Backend / deploy state (as of this handoff)
- **Cloud Functions deployed to prod** (`car-selling-flutter-app`), incl. the full
  shared-barrel set (`createBarrelPool`, `requestJoinBarrelPool`, `sealBarrelPool`,
  `rollBarrelPoolToBusinessHeld`, `expireBarrelPools`, `syncOpenBarrelMirror`, …).
- Firestore rules + indexes deployed. Marketing site + business/admin dashboards
  deployed (Hostinger).
- The sim app talks to **prod**, so the shared-barrel flow is testable end-to-end —
  except payments (below).

## Stripe (needed before testing the PAY step)
- `STRIPE_SECRET_KEY` is set to a **test** key on Stripe account `51TnSUd…`.
  Verify with `firebase functions:secrets:access STRIPE_SECRET_KEY --project car-selling-flutter-app`
  (prints a secret — run it yourself, never through a tool/chat).
- The client's fallback publishable key in `lib/services/stripe_config_service.dart`
  is on that **same** account, so a plain `flutter run` pays correctly. Override with
  `--dart-define=STRIPE_PUBLISHABLE_KEY=pk_test_…` only when pointing at another
  account (publishable keys are public, safe to embed). **The publishable key and
  the deployed secret must be the same Stripe account** — test mode is per-account,
  so a `pk_test_` from account A cannot confirm an intent created by account B's
  `sk_test_`. That mismatch reports "The client_secret provided does not match any
  associated PaymentIntent on this account".
- **Direct charges (Connect).** When a destination business has a connected account
  and `stripeFeeMode == business_absorbs_processing_fee`, the intent is created on
  that connected account. The server returns `stripeConnectedAccountId` next to
  `clientSecret`, and the client scopes the sheet via `withStripeConnectedAccount`
  (`lib/services/payment_flow_safety.dart`). Both sides are required — a client
  that ignores the account reports the same "does not match" error while hosted web
  checkout keeps working, because its redirect URL already carries the account.
- Note: the native Stripe **payment sheet** only works on a real device/simulator,
  not on Flutter web.

## What's verified working
App launches on the sim; Maestro navigates by text/point; the **shared-barrel entry
point renders** on Send Barrels ("Can't fill a barrel? Join an open shared barrel or
reserve a share"). Everything up to the payment step is testable now.
