import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Each customer tab owns a nested Navigator whose `onGenerateRoute` ends with
/// "unknown routes fall back to the tab root rather than crashing"
/// (`customer_home_screen.dart`). That fallback is deliberate, but it means a
/// route missing from `_customerTabRoute` fails *silently*: the push appears to
/// work and the customer lands back on the tab root instead of the screen they
/// asked for, with no error anywhere.
///
/// `Navigator.pushNamed` from a screen inside the shell resolves against the
/// tab navigator, not `main.dart`'s root routes - so being registered in
/// `main.dart` is not enough. That is how "tapping Review on a completed order
/// takes me to the Activity page" shipped, and how `/businesses` and
/// `/business-profile` were broken from Settings at the same time.
void main() {
  test('every route pushed inside a customer tab is handled by that tab', () {
    final shell = File(
      'lib/screens/customer_home_screen.dart',
    ).readAsStringSync();

    final handled = RegExp("case '(/[a-z0-9-]+)'")
        .allMatches(shell)
        .map((m) => m.group(1)!)
        .toSet();

    expect(
      handled,
      isNotEmpty,
      reason: 'failed to parse the tab route table - has it been restructured?',
    );

    // Screens the shell imports are exactly the ones reachable in-tab.
    final inTabScreens = RegExp(r"import '([a-z_]+_screen)\.dart'")
        .allMatches(shell)
        .map((m) => m.group(1)!)
        .toSet();

    // pushNamed(context, '/route') - tolerating line breaks between arguments,
    // which is how the multi-argument call sites are actually formatted.
    final pushed = RegExp(
      r"pushNamed(?:<[^>]*>)?\s*\(\s*context\s*,\s*'(/[a-z0-9-]+)'",
    );

    final unreachable = <String>[];
    for (final screen in inTabScreens) {
      final file = File('lib/screens/$screen.dart');
      if (!file.existsSync()) continue;
      final source = file.readAsStringSync();
      for (final match in pushed.allMatches(source)) {
        final route = match.group(1)!;
        if (!handled.contains(route)) {
          unreachable.add('$route (pushed from $screen)');
        }
      }
    }

    expect(
      unreachable,
      isEmpty,
      reason:
          'These routes are pushed from inside a customer tab but are missing '
          'from _customerTabRoute in customer_home_screen.dart, so the tab '
          "navigator's unknown-route fallback will silently show the tab root "
          'instead. Add a case for each (registering it in main.dart alone '
          'does not help - the tab navigator never consults that table).',
    );
  });

  test('the review composer is reachable from inside a tab', () {
    final shell = File(
      'lib/screens/customer_home_screen.dart',
    ).readAsStringSync();

    // Both OrdersScreen and TrackingScreen push this, and both live in-tab.
    expect(
      shell,
      contains("case '/leave-review':"),
      reason:
          'Leaving a review from a completed order must resolve inside the tab '
          'navigator, not fall through to the tab root.',
    );
    expect(
      shell,
      contains('ReviewComposerScreen'),
      reason: 'the /leave-review case must actually build the composer',
    );
  });
}
