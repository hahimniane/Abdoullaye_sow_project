import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:provider/provider.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/shipment_tracking_event.dart';
import 'package:my_flutter_app/models/transport_opportunity.dart';
import 'package:my_flutter_app/models/transport_quote.dart';
import 'package:my_flutter_app/models/transport_request.dart';
import 'package:my_flutter_app/screens/business_transport_screen.dart';
import 'package:my_flutter_app/services/business_transport_jobs.dart';
import 'package:my_flutter_app/services/shipment_tracking_service.dart';
import 'package:my_flutter_app/services/transport_job_filters.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

TransportRequest _job(
  String id, {
  String owner = 'Fatou Diallo',
  String make = 'Toyota',
  String model = 'Camry',
  String status = 'scheduled',
  String phone = '+12125550100',
  String dest = 'Guinea',
  String container = '',
  String provider = '',
  DateTime? date,
}) => TransportRequest(
  id: id,
  trackingCode: 'TR-$id',
  ownerName: owner,
  carMake: make,
  carModel: model,
  carYear: '2018',
  vinNumber: 'VIN$id',
  destinationCountryName: dest,
  transportDate: date ?? DateTime(2026, 11, 20),
  price: 900,
  status: status,
  createdAt: DateTime(2026, 11, 1),
  customerPhone: phone,
  containerNumber: container,
  trackingProvider: provider,
);

class _Service implements BusinessTransportService {
  _Service({this.refuse});
  final FirebaseFunctionsException? refuse;
  final calls = <String>[];

  @override
  Stream<List<TransportOpportunity>> watchOpportunities(String businessId) =>
      Stream.value(const []);

  @override
  Stream<List<TransportQuote>> watchBusinessQuotes(String businessId) =>
      Stream.value(const []);

  @override
  Future<TransportFulfillmentUpdate> updateFulfillmentStatus({
    required String requestId,
    required String status,
    String containerNumber = '',
    String businessId = '',
  }) async {
    calls.add('$requestId:$status');
    if (refuse != null) throw refuse!;
    return TransportFulfillmentUpdate(
      status: status,
      previousStatus: 'scheduled',
      alreadyUpdated: false,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Tracking extends ShipmentTrackingService {
  final started = <String>[];
  final milestones = <String>[];

  @override
  Stream<List<ShipmentTrackingEvent>> eventsForShipment({
    required String relatedCollection,
    required String relatedId,
  }) => Stream.value([
    ShipmentTrackingEvent(
      id: 'e1',
      label: 'Loaded at port',
      description: '',
      location: 'Newark',
      timestamp: DateTime(2026, 11, 3, 15),
      source: 'staff',
    ),
  ]);

  @override
  Future<void> addMilestone({
    required String relatedCollection,
    required String relatedId,
    required String label,
    String description = '',
    String location = '',
  }) async => milestones.add('$relatedCollection/$relatedId:$label');

  @override
  Future<void> startContainerTracking({
    required String relatedCollection,
    required String relatedId,
    required String containerNumber,
    String scac = '',
  }) async => started.add('$relatedCollection/$relatedId:$containerNumber');
}

Future<void> _open(
  WidgetTester tester,
  List<TransportRequest> jobs, {
  _Service? service,
  _Tracking? tracking,
  String lang = 'en',
  Size size = const Size(390, 3000),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final language = LanguageProvider()..setLanguage(lang);
  await tester.pumpWidget(
    ChangeNotifierProvider.value(
      value: language,
      child: MaterialApp(
        theme: AppTheme.light,
        locale: Locale(lang),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: BusinessTransportScreen(
          businessId: 'b1',
          service: service ?? _Service(),
          trackingService: tracking ?? _Tracking(),
          jobsStream: Stream.value(jobs),
        ),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
  await tester.ensureVisible(
    find.byKey(const Key('transport-section-wonJobs')),
  );
  await tester.tap(find.byKey(const Key('transport-section-wonJobs')));
  await tester.pump();
}

void main() {
  group('filters', () {
    final jobs = [
      _job('1'),
      _job(
        '2',
        owner: 'Kofi Mensah',
        make: 'Honda',
        model: 'Civic',
        status: 'in_transit',
        dest: 'Ghana',
      ),
      _job('3', status: 'delivered', phone: '+233201112222'),
      _job('4', status: 'pending').copyWith(fulfillmentStatus: 'scheduled'),
    ];
    List<String> ids(List<TransportRequest> l) => l.map((j) => j.id).toList();

    test('no filter returns the same list', () {
      expect(identical(filterTransportJobs(jobs), jobs), isTrue);
    });
    test('search reads reference, owner, vehicle, VIN, country, phone', () {
      expect(ids(filterTransportJobs(jobs, query: 'tr-2')), ['2']);
      expect(ids(filterTransportJobs(jobs, query: 'KOFI')), ['2']);
      expect(ids(filterTransportJobs(jobs, query: 'civic ghana')), ['2']);
      expect(ids(filterTransportJobs(jobs, query: 'vin3')), ['3']);
      expect(ids(filterTransportJobs(jobs, query: '2011122')), ['3']);
      expect(filterTransportJobs(jobs, query: 'nobody'), isEmpty);
    });
    test('status filter uses the status the card shows', () {
      expect(ids(filterTransportJobs(jobs, status: 'scheduled')), ['1', '4']);
      expect(ids(filterTransportJobs(jobs, status: 'delivered')), ['3']);
      expect(
        ids(filterTransportJobs(jobs, query: 'toyota', status: 'in_transit')),
        isEmpty,
      );
    });
    test('options are the statuses jobs are in', () {
      expect(transportJobStatusesIn(jobs), [
        'delivered',
        'in_transit',
        'scheduled',
      ]);
    });
  });

  testWidgets(
    'an accepted job shows the customer phone and the transport date',
    (tester) async {
      await _open(tester, [_job('1', date: DateTime(2026, 11, 20))]);
      expect(find.text('Contact phone'), findsOneWidget);
      expect(find.text('+12125550100'), findsOneWidget);
      expect(find.text('Transport date'), findsOneWidget);
      expect(find.text('Nov 20, 2026'), findsOneWidget);
    },
  );

  testWidgets('a job with no phone says so instead of a blank', (tester) async {
    await _open(tester, [_job('1', phone: '')]);
    expect(find.text('Not provided'), findsWidgets);
  });

  testWidgets('search and status filter narrow the accepted jobs', (
    tester,
  ) async {
    await _open(tester, [
      _job('1'),
      _job(
        '2',
        owner: 'Kofi Mensah',
        make: 'Honda',
        model: 'Civic',
        status: 'in_transit',
      ),
    ]);
    expect(find.byKey(const Key('transport-job-1')), findsOneWidget);
    expect(find.byKey(const Key('transport-job-2')), findsOneWidget);

    await tester.enterText(
      find.byKey(const Key('transport-job-search')),
      'kofi',
    );
    await tester.pump();
    expect(find.byKey(const Key('transport-job-1')), findsNothing);
    expect(find.byKey(const Key('transport-job-2')), findsOneWidget);

    await tester.enterText(
      find.byKey(const Key('transport-job-search')),
      'zzz',
    );
    await tester.pump();
    expect(find.byKey(const Key('transport-job-no-match')), findsOneWidget);

    await tester.enterText(find.byKey(const Key('transport-job-search')), '');
    await tester.pump();
    await tester.tap(find.byKey(const Key('transport-job-status-filter')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Scheduled').last);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('transport-job-1')), findsOneWidget);
    expect(find.byKey(const Key('transport-job-2')), findsNothing);
  });

  testWidgets('the job carries the tracking card and a manual update', (
    tester,
  ) async {
    final tracking = _Tracking();
    await _open(tester, [_job('1')], tracking: tracking);
    expect(
      find.byKey(const Key('transport-job-tracking-card-1')),
      findsOneWidget,
    );
    await tester.ensureVisible(
      find.byKey(const Key('transport-job-tracking-1')),
    );
    await tester.pump();
    // The feed of the same collection the website reads.
    expect(find.text('Loaded at port'), findsOneWidget);
    expect(find.text('Add update'), findsOneWidget);
  });

  testWidgets('a server refusal on a status move is shown in words', (
    tester,
  ) async {
    final service = _Service(
      refuse: FirebaseFunctionsException(
        code: 'failed-precondition',
        message: 'This job is awaiting payment.',
      ),
    );
    await _open(tester, [
      _job('1', container: 'MSKU1234567'),
    ], service: service);
    final move = find.byKey(const Key('transport-job-1-to-in_transit'));
    await tester.ensureVisible(move);
    await tester.tap(move);
    await tester.pumpAndSettle();
    expect(service.calls, ['1:in_transit']);
    expect(find.text('This job is awaiting payment.'), findsOneWidget);
  });

  testWidgets('French at 320 px wide: no overflow', (tester) async {
    await _open(
      tester,
      [_job('1', container: 'MSKU1234567'), _job('2', status: 'delivered')],
      lang: 'fr',
      size: const Size(320, 800),
    );
    expect(find.text('Téléphone du contact'), findsWidgets);
    expect(find.text('Date de transport'), findsWidgets);
    await tester.enterText(
      find.byKey(const Key('transport-job-search')),
      'zzz',
    );
    await tester.pump();
    expect(
      find.text('Aucun transport accepté ne correspond à votre recherche.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
