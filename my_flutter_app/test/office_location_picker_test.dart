import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/office_location.dart';
import 'package:my_flutter_app/services/office_location_service.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/office_location_picker.dart';

/// Barrel (and freight) drop-off lists the business's active office
/// locations, as the web customer console does, and shows the head office
/// only once the read has come back empty.
///
/// Regression: the picker showed the head-office address while the
/// locations were still loading, and again whenever the read failed, so
/// a customer saw one address where the business had several.

class _FakeOfficeLocations extends OfficeLocationService {
  final List<StreamController<List<OfficeLocation>>> reads = [];
  final List<String> businessIds = [];

  @override
  Stream<List<OfficeLocation>> activeLocations(String businessId) {
    businessIds.add(businessId);
    final controller = StreamController<List<OfficeLocation>>();
    reads.add(controller);
    return controller.stream;
  }
}

const _headOffice = '12 Main St, Bronx, NY';
const _branches = [
  OfficeLocation(id: 'a', label: 'Bronx yard', address: '400 Yard Rd'),
  OfficeLocation(id: 'b', label: 'Newark depot', address: '9 Port St'),
];

class _Host extends StatefulWidget {
  const _Host({required this.service});

  final OfficeLocationService service;

  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  String selected = '';
  int rebuilds = 0;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        OfficeLocationPicker(
          businessId: 'biz',
          fallbackAddress: _headOffice,
          selectedLocationId: selected,
          onChanged: (value) => setState(() => selected = value),
          service: widget.service,
        ),
        Text('selected:$selected', key: const Key('selected')),
        TextButton(
          onPressed: () => setState(() => rebuilds += 1),
          child: const Text('rebuild parent'),
        ),
      ],
    );
  }
}

Future<void> _pump(
  WidgetTester tester,
  OfficeLocationService service, {
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(body: _Host(service: service)),
    ),
  );
}

void main() {
  testWidgets('lists every active office location and selects the first', (
    tester,
  ) async {
    final service = _FakeOfficeLocations();
    await _pump(tester, service);
    // Still loading: say so, and do not offer the head office.
    expect(find.text('Loading drop-off locations…'), findsOneWidget);
    expect(find.text(_headOffice), findsNothing);

    service.reads.single.add(_branches);
    await tester.pumpAndSettle();
    expect(find.text('2 locations available — choose one'), findsOneWidget);
    expect(find.text('Bronx yard'), findsOneWidget);
    expect(find.text('Newark depot'), findsOneWidget);
    expect(find.text('9 Port St'), findsOneWidget);
    expect(find.text(_headOffice), findsNothing);
    expect(find.text('selected:a'), findsOneWidget);

    await tester.tap(find.text('Newark depot'));
    await tester.pumpAndSettle();
    expect(find.text('selected:b'), findsOneWidget);
    expect(service.businessIds, ['biz']);
  });

  testWidgets('a parent rebuild does not re-read the locations', (
    tester,
  ) async {
    final service = _FakeOfficeLocations();
    await _pump(tester, service);
    service.reads.single.add(_branches);
    await tester.pumpAndSettle();
    await tester.tap(find.text('rebuild parent'));
    await tester.pumpAndSettle();
    expect(service.reads, hasLength(1));
    expect(find.text('Bronx yard'), findsOneWidget);
  });

  testWidgets('falls back to the head office only when there is none', (
    tester,
  ) async {
    final service = _FakeOfficeLocations();
    await _pump(tester, service);
    service.reads.single.add(const []);
    await tester.pumpAndSettle();
    expect(find.text(_headOffice), findsOneWidget);
    expect(find.text('selected:'), findsOneWidget);
  });

  testWidgets('a single location is shown instead of the head office', (
    tester,
  ) async {
    final service = _FakeOfficeLocations();
    await _pump(tester, service);
    service.reads.single.add([_branches.first]);
    await tester.pumpAndSettle();
    expect(find.text('400 Yard Rd'), findsOneWidget);
    expect(find.text(_headOffice), findsNothing);
  });

  testWidgets('a failed read offers Retry, not the head office', (
    tester,
  ) async {
    final service = _FakeOfficeLocations();
    await _pump(tester, service);
    service.reads.single.addError(Exception('permission-denied'));
    await tester.pumpAndSettle();
    expect(find.text('Drop-off locations could not be loaded.'), findsOneWidget);
    expect(find.text(_headOffice), findsNothing);

    await tester.tap(find.text('Retry'));
    await tester.pump();
    expect(service.reads, hasLength(2));
    expect(find.text('Loading drop-off locations…'), findsOneWidget);
    service.reads.last.add(_branches);
    await tester.pumpAndSettle();
    expect(find.text('Bronx yard'), findsOneWidget);
  });

  testWidgets('reads in French', (tester) async {
    final service = _FakeOfficeLocations();
    await _pump(tester, service, locale: const Locale('fr'));
    expect(find.text('Chargement des points de dépôt…'), findsOneWidget);
    service.reads.single.addError(Exception('offline'));
    await tester.pumpAndSettle();
    expect(
      find.text('Les points de dépôt n’ont pas pu être chargés.'),
      findsOneWidget,
    );
    expect(find.text('Réessayer'), findsOneWidget);
  });

  test('barrel drop-off uses the shared picker for both pickup scopes', () {
    final source = File(
      'lib/screens/send_barrel_screen.dart',
    ).readAsStringSync();
    expect(
      RegExp(r'OfficeLocationPicker\(').allMatches(source).length,
      greaterThanOrEqualTo(2),
    );
    // A quick Pay resolves the choice instead of racing the auto-select.
    expect(source, contains('OfficeLocation.resolveSelectedId('));
  });
}
