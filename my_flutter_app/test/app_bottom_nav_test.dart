import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/app_bottom_nav.dart';

// A long tab label stays on one line. With six tabs on a phone the French
// "Paramètres" used to break mid-word ("Paramètre / s").
void main() {
  testWidgets('six French tabs on a phone: every label is one line', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(402, 874);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const labels = [
      'Accueil',
      'Voitures',
      'Achats',
      'Entreprise',
      'Support',
      'Paramètres',
    ];
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light,
        home: Scaffold(
          bottomNavigationBar: AppBottomNav(
            currentIndex: 0,
            onTap: (_) {},
            items: [
              for (final label in labels)
                AppBottomNavItem(icon: Icons.circle_outlined, label: label),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    for (final label in labels) {
      final text = tester.widget<Text>(find.text(label));
      expect(text.maxLines, 1, reason: label);
      final box = tester.renderObject<RenderBox>(find.text(label));
      // One line of 10.5 text is about 12 high; two lines would be over 20.
      expect(box.size.height, lessThan(16), reason: label);
    }
    expect(tester.takeException(), isNull);
  });
}
