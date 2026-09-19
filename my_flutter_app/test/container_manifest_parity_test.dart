import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Containers shipped to the console and the app in the same change, and
/// this keeps them there. It reads source rather than rendering, the way
/// `parking_ledger_parity_test.dart` does: these are screens behind a
/// signed-in business with live Firestore streams, and a callable the app
/// never calls is exactly the failure a screen that never renders in a test
/// cannot report.
void main() {
  String read(String path) => File(path).readAsStringSync();

  final perms = read('lib/utils/business_permissions.dart');
  final screen = read('lib/screens/containers_screen.dart');
  final model = read('lib/services/container_manifest.dart');
  final backend = read('functions/container_manifest.js');
  final menu = read('lib/screens/home_menu.dart');
  final ledger = read('lib/screens/lot_ledger_screen.dart');
  final parkedCar = read('lib/screens/parked_car_details_screen.dart');

  test('the containers permission exists in the form the backend test reads',
      () {
    // `functions/test/business-permission-vocabulary.test.js` regex-reads
    // this file: `static const x = 'x';` on one line, nothing fancier.
    expect(perms, contains("static const containers = 'containers';"));
  });

  test('the screen is gated on it and offered wherever permissions are edited',
      () {
    expect(menu, contains('BusinessPermission.containers'));
    expect(menu, contains('ContainersScreen(businessId: ledgerBusinessId)'));
    expect(menu, contains("Key('open-containers')"));
    for (final path in [
      'lib/screens/add_staff_screen.dart',
      'lib/screens/user_management_screen.dart',
    ]) {
      expect(read(path), contains('BusinessPermission.containers'),
          reason: '$path lists every business permission');
    }
  });

  test('the app calls every container callable the console calls', () {
    for (final callable in [
      'createContainer',
      'updateContainer',
      'deleteContainer',
      'addContainerLine',
      'removeContainerLine',
      'moveContainerLine',
      'setContainerStatus',
      'getContainerDocumentUrl',
    ]) {
      expect(screen, contains("httpsCallable('$callable')"),
          reason: '$callable is called by the console and not by the app');
    }
  });

  test('it reads the business own collections, scoped and unordered', () {
    // No orderBy on either query, so neither needs a composite index; the
    // module sorts. The destination picker leads with the business's own
    // list and then offers every other country, so a business that has
    // listed nothing under Services & coverage never meets an empty sheet.
    for (final collection in ['containers', 'containerLines', 'lotCustomers']) {
      expect(screen, contains("'$collection'"));
    }
    expect(screen, contains("collection('destinationCountries')"));
    expect(screen, contains('CountryCatalog.all'));
    expect(screen, contains('pickLotSearchableOption<String>('));
    expect(screen, isNot(contains('ctrNoDestinations')));
    expect(screen, contains("where('businessId', isEqualTo: id)"));
    expect(model, contains('List<ShippingContainer> sortContainers('));
    expect(screen, isNot(contains("scoped('containers').orderBy")));
    expect(screen, isNot(contains("scoped('containerLines').orderBy")));
  });

  test('the pure module mirrors the server rule for rule', () {
    for (final name in [
      'validateContainer',
      'containerRecord',
      'containerTransitionRefusal',
      'containerIsOpen',
      'containerDeleteRefusal',
      'validateContainerLine',
      'containerLineRecord',
      'openContainerHoldingVin',
      'containerCounts',
    ]) {
      expect(backend, contains('function $name('),
          reason: '$name is the server rule');
      expect(model, contains(' $name('), reason: '$name is mirrored');
    }
    // Every refusal code the server can send has a home in the app's map.
    final messages = backend.split('const CONTAINER_MESSAGES').last;
    final serverCodes = RegExp(r'^  ([a-z_]+):', multiLine: true)
        .allMatches(messages.substring(0, messages.indexOf('});')))
        .map((m) => m.group(1)!)
        .toSet();
    expect(serverCodes, contains('vin_already_loaded'));
    for (final code in serverCodes) {
      expect(model, contains("'$code'"), reason: '$code missing from the app');
      expect(screen, contains("'$code' =>"),
          reason: '$code has no copy on the screen');
    }
    expect(model, contains(r"RegExp(r'^[A-Z]{4}\d{7}$')"));
  });

  test('a line is VIN first, filled from what the yard already knows', () {
    expect(screen, contains('lotFindKnownCar('));
    expect(screen, contains('NhtsaVinDecoderService()'));
    expect(screen, contains('VinScannerScreen()'));
    expect(screen, contains('matchLotCustomers('));
    // The VIN conflict is refused at the field before the round trip, and
    // the server's answer names the box when the phone missed it.
    expect(screen, contains('openContainerHoldingVin('));
    expect(screen, contains('conflictContainerId'));
    // Stock is a real owner, not a customer with a made-up name.
    expect(screen, contains('containerOwnerStock'));
  });

  test('a car is asked "parked in your lot?" before any VIN is shown', () {
    // The question is part of the sheet's draft state, unanswered when it
    // opens and reset by a change of kind; nothing about the car shows until
    // it is answered.
    expect(screen, contains('bool? _inLot;'));
    expect(screen, contains("Key('line-lot-question')"));
    expect(screen, contains("Key('line-lot-yes')"));
    expect(screen, contains("Key('line-lot-no')"));
    final question = screen.indexOf('_LotQuestion(\n');
    final vinField = screen.indexOf("key: const Key('line-vin')");
    expect(question, greaterThan(0));
    expect(vinField, greaterThan(question),
        reason: 'the lot question is built before the VIN field');
    expect(
      screen,
      contains(
          'isCar && (_inLot == false || (_inLot == true && _pickedCar != null))'),
      reason: 'car fields wait for "No", or for a pick under "Yes"',
    );
    expect(screen, contains('_inLot = null;\n              _clearCarDraft();'),
        reason: 'a change of kind resets the answer and what it filled');
  });

  test('the "Yes" list is the business parkedCars rows, joined in memory', () {
    final picker = read('lib/services/container_lot_cars.dart');
    // One subscription on the list screen feeds both the VIN memory and the
    // picker; the raw rows travel down by constructor, and nothing on the
    // detail screen or the sheet opens a second `parkedCars` stream.
    expect(screen, contains("scoped('parkedCars').limit(500).snapshots()"));
    expect("scoped('parkedCars')".allMatches(screen).length, 1,
        reason: 'exactly one parkedCars subscription on the containers screens');
    expect(screen, contains('parkedCarRows: _parkedCarRows'));
    expect(screen, contains('parkedCarRows: widget.parkedCarRows'));
    expect(screen, contains('lotCarChoices(\n        widget.parkedCarRows,'));
    // In the lot = not cancelled, not ended, through the parking helpers.
    expect(picker, contains('parkingRowKind(row, now: now)'));
    expect(picker, contains('ParkingKind.inLot || kind == ParkingKind.reserved'));
    // Taken = the existing VIN → open-container join, not a new query.
    expect(screen, contains('containerVinLinks(widget.lines, widget.containers)'));
    expect(picker, contains('onContainer: links[vin]'));
    expect(screen, contains('onTap: taken ? null : onTap'));
    expect(screen, contains('l10n.ctrLotTaken(car.onContainer!.containerName)'));
    // The filter and the empty state that offers the VIN route.
    expect(screen, contains("Key('line-lot-filter')"));
    expect(screen, contains('filterLotCarChoices(cars, filter.text)'));
    expect(screen, contains("Key('line-lot-empty')"));
    expect(screen, contains('onEnterVinInstead: () => _answerInLot(false)'));
    // A pick fills the car and the owner, then shows the normal fields.
    expect(screen, contains('void _pickLotCar(LotCarChoice car)'));
    expect(screen, contains('_customer.text = car.ownerName'));
  });

  test('server refusals land where the person is looking', () {
    expect(model, contains('ContainerRefusal parseContainerRefusal('));
    expect(screen, contains('parseContainerRefusal(error.details, error.message)'));
    expect(screen, contains('_RefusalNote('));
    expect(screen, contains("errorText: errorFor('vin_already_loaded')"));
  });

  test('search finds a line by VIN, customer or phone', () {
    expect(model, contains('List<ContainerSearchHit> searchContainerLines('));
    expect(screen, contains('searchContainerLines(_lines, byId, _search)'));
    expect(screen, contains("Key('containers-search')"));
  });

  test('the cross-link is an in-memory join on every surface that names a car',
      () {
    expect(model, contains('Map<String, ContainerVinLink> containerVinLinks('));
    // The parked-car list and card, the ledger activity row, the parked-car
    // detail: each carries the chip, none queries per row.
    expect(menu, contains('containerVinLinks(_containerLines, _containers)'));
    expect(menu, contains('ContainerLinkChip(link: containerLink!)'));
    expect(ledger, contains('containerVinLinks(_containerLines, _containers)'));
    expect(ledger, contains('containerLink: containerLinks[row.vinNumber]'));
    expect(parkedCar, contains('ContainerLinkChip(link: _containerLink!)'));
    expect(parkedCar, contains("where('vinNumber', isEqualTo: vin)"));
    final chip = read('lib/widgets/container_link_chip.dart');
    expect(chip, contains('l10n.ctrLinkShipped('));
    expect(chip, contains('l10n.ctrLinkLoading('));
  });

  test('history is the ledger\'s history view, not a second one', () {
    expect(screen, contains('LotHistorySheet('));
    final sheets = read('lib/widgets/lot_sheets.dart');
    expect(sheets, contains("collection('lotLedgerAudit')"));
    expect(screen, isNot(contains("collection('lotLedgerAudit')")));
  });

  test('every string on the screen is in both catalogs', () {
    final en = jsonDecode(read('lib/l10n/app_en.arb')) as Map<String, dynamic>;
    final fr = jsonDecode(read('lib/l10n/app_fr.arb')) as Map<String, dynamic>;
    final used = RegExp(r'l10n\.((?:ctr|lot|vin|scan)[A-Za-z0-9]*)')
        .allMatches(screen)
        .map((m) => m.group(1)!)
        .toSet();
    expect(used.length, greaterThan(60),
        reason: 'the screen should be reading its copy from the catalog');
    for (final key in used) {
      expect(en.containsKey(key), isTrue, reason: '$key missing from English');
      expect(fr.containsKey(key), isTrue, reason: '$key missing from French');
    }
  });
}
