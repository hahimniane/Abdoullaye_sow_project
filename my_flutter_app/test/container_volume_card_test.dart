import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/business_volume.dart';
import 'package:my_flutter_app/widgets/container_volume_card.dart';

// What getBusinessVolume answers, as the iOS plugin hands it over (nested
// Map<Object?, Object?>).
Map<Object?, Object?> answer({int pieces = 1284, int shipped = 3}) => {
      'month': '2026-10',
      'businessId': 'biz',
      'totals': <Object?, Object?>{
        'pieces': pieces,
        'barrels': 900,
        'packages': 380,
        'cars': 4,
        'containersShipped': shipped,
      },
      'containers': const <Object?>[],
    };

Widget host(BusinessVolumeService service, {Locale locale = const Locale('en'),
    Duration timeout = const Duration(seconds: 20)}) =>
    MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: ContainerVolumeCard(
          businessId: 'biz',
          service: service,
          timeout: timeout,
        ),
      ),
    );

void main() {
  test('reads the callable answer, iOS maps included', () {
    final volume = BusinessVolume.fromCallable(answer());
    expect(volume.month, '2026-10');
    expect(volume.pieces, 1284);
    expect(volume.containersShipped, 3);
    expect(volume.cars, 4);
    expect(volume.monthStart, DateTime(2026, 10));
    final empty = BusinessVolume.fromCallable(null);
    expect(empty.pieces, 0);
    expect(empty.monthStart, isNull);
    expect(businessVolumeRequest('biz'), {'businessId': 'biz'});
  });

  testWidgets('shows this month in English', (tester) async {
    final calls = <Map<String, Object?>>[];
    await tester.pumpWidget(host(BusinessVolumeService(
      caller: (name, payload) async {
        expect(name, 'getBusinessVolume');
        calls.add(payload);
        return answer();
      },
    )));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.pumpAndSettle();
    expect(calls, [
      {'businessId': 'biz'},
    ]);
    expect(find.text('This month · October 2026'), findsOneWidget);
    expect(find.text('1,284 pieces received'), findsOneWidget);
    expect(find.text('3 containers shipped'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });

  testWidgets('says one piece and one container in the singular',
      (tester) async {
    await tester.pumpWidget(host(BusinessVolumeService(
      caller: (_, _) async => answer(pieces: 1, shipped: 1),
    )));
    await tester.pumpAndSettle();
    expect(find.text('1 piece received'), findsOneWidget);
    expect(find.text('1 container shipped'), findsOneWidget);
  });

  testWidgets('shows this month in French', (tester) async {
    await tester.pumpWidget(host(
      BusinessVolumeService(caller: (_, _) async => answer(shipped: 0)),
      locale: const Locale('fr'),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Ce mois-ci · octobre 2026'), findsOneWidget);
    expect(find.textContaining('pièces reçues'), findsOneWidget);
    expect(find.textContaining('1 284').evaluate().isNotEmpty ||
        find.textContaining('1 284').evaluate().isNotEmpty, isTrue);
    expect(find.text('0 conteneur expédié'), findsOneWidget);
  });

  testWidgets('a failure offers a retry instead of a zero', (tester) async {
    var calls = 0;
    await tester.pumpWidget(host(BusinessVolumeService(
      caller: (_, _) async {
        calls += 1;
        if (calls == 1) throw Exception('offline');
        return answer();
      },
    )));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('volume-card-failed')), findsOneWidget);
    expect(find.textContaining('pieces received'), findsNothing);
    await tester.tap(find.byKey(const Key('volume-card-retry')));
    await tester.pumpAndSettle();
    expect(calls, 2);
    expect(find.text('1,284 pieces received'), findsOneWidget);
    expect(find.byKey(const Key('volume-card-retry')), findsNothing);
  });

  testWidgets('a call that never answers still stops spinning',
      (tester) async {
    final never = Completer<Object?>();
    await tester.pumpWidget(host(
      BusinessVolumeService(caller: (_, _) => never.future),
      timeout: const Duration(seconds: 5),
    ));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.pump(const Duration(seconds: 6));
    await tester.pumpAndSettle();
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.byKey(const Key('volume-card-failed')), findsOneWidget);
  });
}
