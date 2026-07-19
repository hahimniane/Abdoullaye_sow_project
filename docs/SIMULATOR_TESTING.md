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
- **Simulator UDID**: `6E2671E5-5378-4095-BB58-1804871582C1` (iPhone 17 Pro, iOS 26.3).
  Re-derive: `xcrun simctl list devices | grep Booted`
- **App bundle id**: `com.autosales.myFlutterApp`
- **Project**: `/Users/hashimniane/Abdoullaye_sow_project/my_flutter_app`

## ⚠️ #1 gotcha: the sim freezes under RAM pressure
This machine is RAM-constrained. When the sim is frozen, **Maestro still reports
`Tap ... COMPLETED` but nothing happens on screen** (taps queue, then all fire at
once when it recovers — which can land you on the wrong screen). If a tap has no
effect: the sim is frozen, not the tooling. **Fix: close Chrome/Cursor/Zoom/Spotify**
to free memory, then retry. (Disk was already cleared; RAM is the bottleneck.)

## Run a tap (write a tiny flow, then run it)
```bash
cat > /tmp/flow.yaml <<'EOF'
appId: com.autosales.myFlutterApp
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
Bottom nav item centers (5 tabs): Cars ~12%, Send Barrels ~31%, My Purchases ~50%,
Tracking ~69%, Settings ~88%; the bar sits at ~95–97% height.

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
xcrun simctl io 6E2671E5-5378-4095-BB58-1804871582C1 screenshot /tmp/s.png
sips -Z 1200 /tmp/s.png            # downscale so it's easy to view/read
```
Then view `/tmp/s.png`. Native size is 1206x2622 (iPhone 17 Pro @3x → 402x874 pts).

## Relaunch / rebuild the app
The Xcode build cache is warm, so this is fast now (the first build took ~9 min):
```bash
cd /Users/hashimniane/Abdoullaye_sow_project/my_flutter_app
flutter run -d 6E2671E5-5378-4095-BB58-1804871582C1 --no-version-check
# or, app already built, just (re)install + launch:
xcrun simctl install <UDID> build/ios/iphonesimulator/Runner.app
xcrun simctl launch  <UDID> com.autosales.myFlutterApp
```
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
- Prod secret `STRIPE_SECRET_KEY` is currently the placeholder
  `REPLACE_WITH_STRIPE_SECRET_KEY` → payments fail (but **no risk of real charges**).
- Working **test** keys live in
  `~/Downloads/alluvial_academy-main/functions/.env` (`sk_test_…` + `pk_test_…`).
- To enable payment testing (the USER must set the secret — never paste keys into
  chat/tools): `firebase functions:secrets:set STRIPE_SECRET_KEY --project car-selling-flutter-app`
  then **redeploy functions**. The Flutter client reads the publishable key from a
  build define, so rebuild with: `flutter run … --dart-define=STRIPE_PUBLISHABLE_KEY=pk_test_…`
  (publishable keys are public, safe to embed). Note: the native Stripe **payment
  sheet** only works on a real device/simulator, not on Flutter web.

## What's verified working
App launches on the sim; Maestro navigates by text/point; the **shared-barrel entry
point renders** on Send Barrels ("Can't fill a barrel? Join an open shared barrel or
reserve a share"). Everything up to the payment step is testable now.
