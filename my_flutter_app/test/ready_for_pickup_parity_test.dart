import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations_en.dart';
import 'package:my_flutter_app/l10n/app_localizations_fr.dart';
import 'package:my_flutter_app/models/guest_tracking_result.dart';
import 'package:my_flutter_app/widgets/guest_tracking_lookup.dart';

/// A container's last status is still stored as `arrived`, but it now means
/// READY FOR PICKUP (staff mark it when the goods can be collected, and the
/// ready-for-pickup WhatsApp message goes out). The app, the console and the
/// public tracking page all say so, in English and in French.
void main() {
  Map<String, dynamic> arb(String path) =>
      jsonDecode(File(path).readAsStringSync()) as Map<String, dynamic>;
  final en = arb('lib/l10n/app_en.arb');
  final fr = arb('lib/l10n/app_fr.arb');
  String read(String path) => File(path).readAsStringSync();

  test('the app labels say ready for pickup, in both languages', () {
    expect(en['ctrStatusArrived'], 'Ready for pickup');
    expect(fr['ctrStatusArrived'], 'Prêt à récupérer');
    expect(en['ctrArrive'], 'Mark ready for pickup');
    expect(fr['ctrArrive'], 'Marquer prêt à récupérer');
    expect(en['ctrArrivedDone'], 'Marked ready for pickup.');
    expect(fr['ctrArrivedDone'], 'Marqué prêt à récupérer.');
    expect(en['ctrArriveTitle'], 'Mark this container ready for pickup?');
    expect(en['pkgMomentArrived'], 'ready for pickup');
    expect(fr['pkgMomentArrived'], 'prêt à récupérer');
    for (final key in [
      'ctrStatusArrived',
      'ctrNoArrived',
      'ctrArrivedOn',
      'ctrArrive',
      'ctrArriveTitle',
      'ctrArriveMessage',
      'ctrArrivedDone',
      'pkgMomentArrived',
    ]) {
      expect('${en[key]}'.toLowerCase(), isNot(contains('arrived')),
          reason: key);
      expect('${fr[key]}'.toLowerCase(), isNot(contains('arrivé')),
          reason: key);
    }
  });

  test('the console says the same words', () {
    final labels = read('../admin_web/src/lib/container-manifest.ts');
    expect(labels, contains('arrived: "Ready for pickup",'));
    final panel = read('../admin_web/src/components/business/containers-panel.tsx');
    expect(panel, contains('Mark ready for pickup</button>'));
    expect(panel, contains('"Marked ready for pickup."'));
    expect(panel, contains('<option value="arrived">Ready for pickup</option>'));
    final french = read('../admin_web/src/lib/french-dom.ts');
    expect(french, contains('"Ready for pickup": "Prêt à récupérer",'));
    expect(french,
        contains('"Mark ready for pickup": "Marquer prêt à récupérer",'));
    expect(french,
        contains('"Marked ready for pickup.": "Marqué prêt à récupérer.",'));
  });

  test('the public tracking page names the last container stage the same',
      () {
    expect(
      guestTrackingStageLabel(AppLocalizationsEn(),
          GuestTrackingServiceType.container, GuestTrackingStage.arrived),
      'Ready for pickup',
    );
    expect(
      guestTrackingStageLabel(AppLocalizationsFr(),
          GuestTrackingServiceType.container, GuestTrackingStage.arrived),
      'Prêt à récupérer',
    );
    // Other services keep their own word.
    expect(
      guestTrackingStageLabel(AppLocalizationsEn(),
          GuestTrackingServiceType.barrel, GuestTrackingStage.arrived),
      'Arrived',
    );
    final web = read('../admin_web/src/lib/guest-tracking.ts');
    expect(web, contains('{id: "arrived", label: "Ready for pickup",'));
  });

  test('the server writes the moment and History in the new words', () {
    final backend = read('functions/index.js');
    expect(backend, contains('"Container shipped" : "Ready for pickup"'));
    expect(backend, contains('"Marked ready for pickup"'));
    final audit = read('../admin_web/src/lib/audit-summaries.ts');
    expect(audit, contains('/^Marked ready for pickup\$/'));
  });
}
