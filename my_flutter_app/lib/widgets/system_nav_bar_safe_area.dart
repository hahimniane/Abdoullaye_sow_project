import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';

/// Keeps everything the app draws out from under the Android system
/// navigation bar (gesture pill or 3-button bar) and out of landscape
/// display cutouts.
///
/// Android 15+ enforces edge-to-edge for apps targeting SDK 35, so every
/// route, bottom sheet and dialog is laid out under the system bars unless
/// each surface handles the inset itself. Many did not (padded lists whose
/// last rows sat under the nav bar, sheets whose last action did), so the
/// inset is handled ONCE here, around the whole navigator, from
/// `MaterialApp.builder`. The status bar is left alone: app bars and page
/// headers already pad for it and paint their own colour behind it.
///
/// While the keyboard is open MediaQuery.padding.bottom is already 0 (the
/// keyboard covers the nav bar), so there is no double gap above it.
///
/// iOS is unchanged: its home indicator is meant to sit over content, and
/// screens there already pad for it.
class SystemNavBarSafeArea extends StatelessWidget {
  const SystemNavBarSafeArea({super.key, required this.child, this.platform});

  final Widget child;

  /// Overrides the platform, for tests.
  final TargetPlatform? platform;

  /// Whether the wrapper applies on [platform].
  static bool appliesTo(TargetPlatform platform, {required bool isWeb}) =>
      !isWeb && platform == TargetPlatform.android;

  @override
  Widget build(BuildContext context) {
    if (!appliesTo(platform ?? defaultTargetPlatform, isWeb: kIsWeb)) {
      return child;
    }
    return ColoredBox(
      // Painted behind the nav bar; matches the bottom navigation bar and
      // sheet surfaces.
      color: Theme.of(context).colorScheme.surface,
      child: SafeArea(top: false, child: child),
    );
  }
}
