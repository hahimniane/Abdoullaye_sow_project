import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/car.dart';
import 'package:my_flutter_app/services/listing_filters.dart';
import 'package:my_flutter_app/widgets/listing_toolbar.dart';

Car _car(String id, String make, String status) => Car(
  id: id,
  title: '2018 $make',
  make: make,
  model: 'X',
  year: '2018',
  mileage: '1',
  price: 1000,
  description: '',
  features: const [],
  imageUrls: const [],
  status: status,
  contactPhone: '',
);

/// The listings screen's wiring, without Firebase: the same widgets and the
/// same pure functions, driven by the same state.
class _Harness extends StatefulWidget {
  const _Harness({this.onApply});
  final void Function(Set<String> ids, String status)? onApply;

  @override
  State<_Harness> createState() => _HarnessState();
}

class _HarnessState extends State<_Harness> {
  final cars = [
    _car('a', 'Toyota', 'active'),
    _car('b', 'Honda', 'sold'),
    _car('c', 'Ford', 'draft'),
  ];
  String query = '';
  String status = 'all';
  Set<String> selected = {};
  String bulk = 'active';
  final List<String> added = [];

  @override
  Widget build(BuildContext context) {
    final shown = filterListings(cars, query: query, status: status);
    return Scaffold(
      body: SingleChildScrollView(
        child: Column(
          children: [
            ListingFilterBar(
              query: query,
              status: status,
              onQueryChanged: (v) => setState(() => query = v),
              onStatusChanged: (v) => setState(() => status = v),
            ),
            if (selected.isNotEmpty)
              ListingBulkBar(
                count: selected.length,
                status: bulk,
                busy: false,
                onStatusChanged: (v) => setState(() => bulk = v),
                onApply: () => widget.onApply?.call(selected, bulk),
                onClear: () => setState(() => selected = {}),
              ),
            for (final c in shown)
              CheckboxListTile(
                key: Key('row-${c.id}'),
                value: selected.contains(c.id),
                title: Text(c.title),
                onChanged: (on) => setState(
                  () => selected = toggleListingSelection(selected, c.id, on!),
                ),
              ),
            ImageLinkField(
              count: 11 + added.length,
              max: 12,
              onAdd: (url) => setState(() => added.add(url)),
            ),
            Text('added:${added.join(",")}', key: const Key('added')),
          ],
        ),
      ),
    );
  }
}

Widget _app(Widget child, {String lang = 'en'}) => MaterialApp(
  locale: Locale(lang),
  supportedLocales: AppLocalizations.supportedLocales,
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  home: child,
);

void main() {
  testWidgets('search narrows the list and the status filter combines', (
    tester,
  ) async {
    await tester.pumpWidget(_app(const _Harness()));
    expect(find.byKey(const Key('row-a')), findsOneWidget);
    expect(find.byKey(const Key('row-b')), findsOneWidget);

    await tester.enterText(find.byKey(const Key('listing-search')), 'honda');
    await tester.pump();
    expect(find.byKey(const Key('row-a')), findsNothing);
    expect(find.byKey(const Key('row-b')), findsOneWidget);

    await tester.enterText(find.byKey(const Key('listing-search')), '');
    await tester.tap(find.byKey(const Key('listing-status-filter')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Draft').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('row-c')), findsOneWidget);
    expect(find.byKey(const Key('row-a')), findsNothing);
  });

  testWidgets('ticking listings shows the bulk bar and Apply passes them', (
    tester,
  ) async {
    Set<String>? ids;
    String? status;
    await tester.pumpWidget(
      _app(
        _Harness(
          onApply: (i, s) {
            ids = i;
            status = s;
          },
        ),
      ),
    );
    expect(find.byKey(const Key('listing-bulk-bar')), findsNothing);
    await tester.tap(find.byKey(const Key('row-a')));
    await tester.tap(find.byKey(const Key('row-b')));
    await tester.pump();
    expect(find.text('2 selected'), findsOneWidget);

    await tester.tap(find.byKey(const Key('listing-bulk-status')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Inactive').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('listing-bulk-apply')));
    expect(ids, {'a', 'b'});
    expect(status, 'inactive');

    await tester.tap(find.byKey(const Key('listing-bulk-clear')));
    await tester.pump();
    expect(find.byKey(const Key('listing-bulk-bar')), findsNothing);
  });

  testWidgets(
    'a photo link is added; a bad one is refused in words; the cap holds',
    (tester) async {
      await tester.pumpWidget(_app(const _Harness()));
      await tester.enterText(
        find.byKey(const Key('image-link-input')),
        'not a link',
      );
      await tester.tap(find.byKey(const Key('image-link-add')));
      await tester.pump();
      expect(
        find.text('Paste a web address that starts with https://'),
        findsOneWidget,
      );
      expect(find.text('added:'), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('image-link-input')),
        'https://cdn.example.com/a.jpg',
      );
      await tester.tap(find.byKey(const Key('image-link-add')));
      await tester.pump();
      expect(find.text('added:https://cdn.example.com/a.jpg'), findsOneWidget);
      // 11 + 1 = the cap of 12: the box is off and says why.
      expect(
        find.text('This listing already has the most photos it can hold (12).'),
        findsOneWidget,
      );
      final add = tester.widget<OutlinedButton>(
        find.byKey(const Key('image-link-add')),
      );
      expect(add.onPressed, isNull);
    },
  );

  testWidgets('French at 320 px wide: no overflow', (tester) async {
    tester.view.physicalSize = const Size(320, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(_app(const _Harness(), lang: 'fr'));
    await tester.tap(find.byKey(const Key('row-a')));
    await tester.pump();
    expect(find.text('1 sélectionnée(s)'), findsOneWidget);
    expect(find.text('Ajouter une photo par lien'), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('image-link-input')));
    await tester.enterText(find.byKey(const Key('image-link-input')), 'x');
    await tester.ensureVisible(find.byKey(const Key('image-link-add')));
    await tester.tap(find.byKey(const Key('image-link-add')));
    await tester.pump();
    expect(
      find.text('Collez une adresse web qui commence par https://'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
