import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/screens/getting_paid_screen.dart';
import 'package:my_flutter_app/services/getting_paid.dart';
import 'package:provider/provider.dart';

/// "Getting paid": Stripe payout status, the fees (read only) and the
/// verification documents. Firebase is a fake: a live business document, a
/// callable recorder, a browser and a file picker.

Map<String, Object?> _business({
  String account = '',
  bool charges = false,
  bool payouts = false,
  List<String> services = const ['carSales', 'carParking'],
  Map<String, Object?>? documents,
  Map<String, Object?>? review,
  Map<String, Object?>? requirements,
}) => {
  'stripeAccountId': account,
  'chargesEnabled': charges,
  'payoutsEnabled': payouts,
  'enabledServices': services,
  'verificationDocuments': ?documents,
  'verificationReview': ?review,
  'stripeRequirements': ?requirements,
};

class _Source implements BusinessDocSource {
  _Source([Map<String, Object?>? first]) {
    if (first != null) controller.add(first);
  }

  final controller = StreamController<Map<String, Object?>?>.broadcast();
  Map<String, Object?>? latest;

  @override
  Stream<Map<String, Object?>?> watch(String businessId) {
    final out = StreamController<Map<String, Object?>?>();
    final initial = latest;
    if (initial != null) scheduleMicrotask(() => out.add(initial));
    final sub = controller.stream.listen(out.add);
    out.onCancel = sub.cancel;
    return out.stream;
  }

  void push(Map<String, Object?>? data) {
    latest = data;
    controller.add(data);
  }
}

class _Calls {
  final log = <({String name, Map<String, Object?> payload})>[];
  Object? Function(String name, Map<String, Object?> payload)? respond;

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    log.add((name: name, payload: payload));
    final custom = respond;
    if (custom != null) {
      final r = custom(name, payload);
      if (r != null) return r;
    }
    switch (name) {
      case 'getBusinessFeeSettings':
        return {
          'stripeFeeMode': 'laawol_absorbs',
          'connectReady': false,
          'defaultPlatformFeePct': 0.025,
          'hasBusinessOverride': false,
        };
      case 'uploadBusinessVerificationDocument':
        return {'success': true};
    }
    return {};
  }

  List<Map<String, Object?>> sent(String name) => [
    for (final c in log)
      if (c.name == name) c.payload,
  ];
}

FirebaseFunctionsException _refusal(String code, [String reason = '']) =>
    FirebaseFunctionsException(
      message: reason,
      code: code,
      details: reason.isEmpty ? null : {'reason': reason},
    );

class _World {
  _World({Map<String, Object?>? business}) : source = _Source(business) {
    source.latest = business;
  }

  final _Source source;
  final calls = _Calls();
  final opened = <Uri>[];
  bool openResult = true;
  var links = 0;
  var refreshes = 0;
  Object? linkError;
  Object? refreshError;
  ChosenFile? next;

  GettingPaidService get service => GettingPaidService(
    caller: calls.call,
    timeout: const Duration(seconds: 2),
    stripeLink: (id) async {
      links++;
      if (linkError != null) throw linkError!;
      return 'https://connect.stripe.test/setup/$id';
    },
    refreshStatus: (id) async {
      refreshes++;
      if (refreshError != null) throw refreshError!;
    },
  );
}

Future<void> _pump(
  WidgetTester tester,
  _World w, {
  bool owner = true,
  Locale locale = const Locale('en'),
  Size size = const Size(800, 3600),
  bool settle = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: GettingPaidScreen(
        businessId: 'b1',
        isRealOwner: owner,
        service: w.service,
        source: w.source,
        opener: (uri) async {
          w.opened.add(uri);
          return w.openResult;
        },
        picker: () async => w.next,
      ),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

Future<void> _tap(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

class _Auth extends ChangeNotifier implements AuthProvider {
  _Auth({this.real = false, this.full = false, this.business = 'b1'});

  final bool real;
  final bool full;
  final String? business;

  @override
  bool get isBusinessOwner => real || full;
  @override
  bool get hasFullAccess => full;
  @override
  bool get isRealBusinessOwner => real;
  @override
  String? get businessId => business;
  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.isGetter) return null;
    return super.noSuchMethod(invocation);
  }
}

void main() {
  group('the rules', () {
    test('payouts count only when charges are on too', () {
      expect(resolvePayoutStatus({}).state, PayoutState.notConnected);
      expect(
        resolvePayoutStatus({'stripeAccountId': 'acct_1'}).state,
        PayoutState.pending,
      );
      expect(
        resolvePayoutStatus({
          'stripeAccountId': 'acct_1',
          'payoutsEnabled': true,
        }).state,
        PayoutState.pending,
      );
      final ready = resolvePayoutStatus({
        'stripeAccountId': 'acct_1',
        'chargesEnabled': true,
        'payoutsEnabled': true,
      });
      expect(ready.ready, isTrue);
      expect(ready.stripeAccountId, 'acct_1');
    });

    test('Stripe requirements are counted', () {
      final s = resolvePayoutStatus({
        'stripeAccountId': 'acct_1',
        'stripeRequirements': {
          'currentlyDue': ['a', 'b'],
          'pastDue': ['c'],
          'pendingVerification': ['d'],
        },
      });
      expect(s.currentlyDue, 3);
      expect(s.pendingVerification, 1);
    });

    test('fees read as the website shows them', () {
      final f = BusinessFeeSettings.fromCallable({
        'stripeFeeMode': 'business_absorbs_processing_fee',
        'connectReady': false,
        'defaultPlatformFeePct': 0.025,
        'hasBusinessOverride': true,
      });
      expect(f.platformFeeText, '2.50%');
      expect(f.businessPaysProcessing, isTrue);
      expect(f.processingNotYetActive, isTrue);
      expect(f.hasBusinessOverride, isTrue);
      expect(BusinessFeeSettings.fromCallable(null).platformFeeText, '0.00%');
    });

    test('the checklist follows the business services', () {
      final items = buildVerificationChecklist(
        _business(services: ['carSales', 'carParking', 'inventory']),
      );
      expect(items.map((i) => i.id), ['dealerLicense', 'parkingFacilityProof']);
      expect(
        items.every((i) => i.status == VerificationStatus.missing),
        isTrue,
      );
      expect(
        buildVerificationChecklist(_business(services: ['inventory'])),
        isEmpty,
      );
    });

    test('a file makes a document submitted; the review wins', () {
      final items = buildVerificationChecklist(
        _business(
          services: ['carSales', 'carParking', 'carTransport'],
          documents: {
            'dealerLicense': {
              'fileName': 'license.pdf',
              'url': 'https://files.test/license.pdf',
            },
            'parkingFacilityProof': {'name': 'lease.pdf'},
          },
          review: {
            'documents': {
              'parkingFacilityProof': {
                'status': 'needs_changes',
                'note': 'The lease is expired.',
              },
              'transportInsurance': {'status': 'not_applicable'},
            },
          },
        ),
      );
      final byId = {for (final i in items) i.id: i};
      expect(byId['dealerLicense']!.status, VerificationStatus.submitted);
      expect(
        byId['dealerLicense']!.evidence.url,
        'https://files.test/license.pdf',
      );
      expect(
        byId['parkingFacilityProof']!.status,
        VerificationStatus.needsChanges,
      );
      expect(byId['parkingFacilityProof']!.reviewNote, 'The lease is expired.');
      expect(byId['parkingFacilityProof']!.evidence.label, 'lease.pdf');
      expect(
        byId['transportInsurance']!.status,
        VerificationStatus.notApplicable,
      );
      final summary = summarizeVerification(items);
      expect(summary.total, 3);
      expect(summary.complete, 1);
      expect(summary.approvalReady, isFalse);
    });

    test('a document the old way (alias, list) still reads', () {
      final items = buildVerificationChecklist(
        _business(services: ['carParking'], documents: null)
          ..['parkingLease'] = 'https://files.test/lease.pdf',
      );
      expect(items.single.evidence.present, isTrue);
      expect(items.single.evidence.label, 'lease.pdf');
      final listed = buildVerificationChecklist({
        'enabledServices': ['carSales'],
        'verificationDocuments': [
          {
            'documentId': 'dealerLicense',
            'status': 'verified',
            'name': 'a.pdf',
          },
        ],
      });
      expect(listed.single.status, VerificationStatus.verified);
      expect(summarizeVerification(listed).approvalReady, isTrue);
    });

    test('the reviewer note falls back to reviewNote', () {
      expect(
        verificationReviewNote({
          'verificationReview': {'note': 'Fix the lease.'},
          'reviewNote': 'old',
        }),
        'Fix the lease.',
      );
      expect(verificationReviewNote({'reviewNote': 'old'}), 'old');
      expect(verificationReviewNote({}), '');
    });

    test('a file is PDF, Word or an image under 20 MB', () {
      expect(verificationFileProblem('a.pdf', null, 10), '');
      expect(verificationFileProblem('a.DOCX', null, 10), '');
      expect(verificationFileProblem('a.jpg', 'image/jpeg', 10), '');
      expect(verificationFileProblem('a.exe', null, 10), 'type');
      expect(verificationFileProblem('noext', null, 10), 'type');
      expect(verificationFileProblem('a.pdf', null, 0), 'empty');
      expect(
        verificationFileProblem('a.pdf', null, verificationMaxBytes),
        'too_big',
      );
      expect(
        verificationFileProblem('a.pdf', null, verificationMaxBytes - 1),
        '',
      );
      expect(verificationContentType('a.heic', null), 'image/heic');
      expect(
        verificationContentType('a.pdf', 'application/octet-stream'),
        'application/pdf',
      );
    });

    test('the upload carries the file as the server expects it', () async {
      final calls = _Calls();
      await GettingPaidService(caller: calls.call).uploadDocument(
        businessId: 'b1',
        documentId: 'dealerLicense',
        file: PickedDocument(
          name: 'license.pdf',
          bytes: Uint8List.fromList([1, 2, 3]),
          contentType: 'application/pdf',
        ),
      );
      expect(calls.sent('uploadBusinessVerificationDocument').single, {
        'businessId': 'b1',
        'documentId': 'dealerLicense',
        'fileName': 'license.pdf',
        'contentType': 'application/pdf',
        'size': 3,
        'base64': base64Encode([1, 2, 3]),
      });
    });

    test('an upload with no success is a failure', () async {
      final calls = _Calls()..respond = (n, p) => {'success': false};
      await expectLater(
        GettingPaidService(caller: calls.call).uploadDocument(
          businessId: 'b1',
          documentId: 'dealerLicense',
          file: PickedDocument(
            name: 'a.pdf',
            bytes: Uint8List.fromList([1]),
            contentType: 'application/pdf',
          ),
        ),
        throwsA(isA<GettingPaidFailure>()),
      );
    });

    test('the Stripe link must be https', () async {
      final bad = GettingPaidService(
        stripeLink: (_) async => 'http://x.test/a',
      );
      await expectLater(
        bad.setupLink('b1'),
        throwsA(isA<GettingPaidFailure>()),
      );
      final good = GettingPaidService(
        stripeLink: (_) async => 'https://x.test/a',
      );
      expect((await good.setupLink('b1')).host, 'x.test');
    });

    test('a failed call is read as offline or refused', () async {
      final off = GettingPaidService(
        caller: (_, _) async => throw _refusal('unavailable'),
      );
      await expectLater(
        off.feeSettings('b1'),
        throwsA(isA<GettingPaidFailure>().having((f) => f.offline, 'o', true)),
      );
      final denied = GettingPaidService(
        caller: (_, _) async => throw _refusal('permission-denied'),
      );
      await expectLater(
        denied.feeSettings('b1'),
        throwsA(
          isA<GettingPaidFailure>().having((f) => f.permission, 'p', true),
        ),
      );
    });
  });

  group('payout status on screen', () {
    testWidgets('not connected: Start opens the Stripe link in the browser', (
      tester,
    ) async {
      final w = _World(business: _business());
      await _pump(tester, w);
      expect(find.text('Payout setup required'), findsOneWidget);
      expect(find.text('Start Stripe registration'), findsOneWidget);
      await _tap(tester, 'getting-paid-stripe');
      expect(w.links, 1);
      expect(
        w.opened.single.toString(),
        'https://connect.stripe.test/setup/b1',
      );
      // Nothing was asked of Stripe: there is no account to check yet.
      expect(w.refreshes, 0);
    });

    testWidgets('connected but pending: Continue, a check on open, a refresh', (
      tester,
    ) async {
      final w = _World(
        business: _business(
          account: 'acct_1',
          requirements: {
            'currentlyDue': ['x', 'y'],
          },
        ),
      );
      await _pump(tester, w);
      expect(find.text('Connected, pending verification'), findsOneWidget);
      expect(find.text('Continue in Stripe'), findsOneWidget);
      expect(find.text('Account: acct_1'), findsOneWidget);
      expect(find.text('2 Stripe requirements due'), findsOneWidget);
      expect(w.refreshes, 1, reason: 'the open check');
      await _tap(tester, 'getting-paid-refresh');
      expect(w.refreshes, 2);
      expect(find.text('Status updated.'), findsOneWidget);
    });

    testWidgets('the status follows the business when Stripe says ready', (
      tester,
    ) async {
      final w = _World(business: _business(account: 'acct_1'));
      await _pump(tester, w);
      w.source.push(_business(account: 'acct_1', charges: true, payouts: true));
      await tester.pumpAndSettle();
      expect(find.text('Payouts enabled'), findsOneWidget);
      expect(find.text('Charges verified'), findsOneWidget);
      expect(find.byKey(const Key('getting-paid-stripe')), findsNothing);
      expect(find.byKey(const Key('getting-paid-refresh')), findsOneWidget);
    });

    testWidgets('a failed silent check says the status may be old', (
      tester,
    ) async {
      final w = _World(business: _business(account: 'acct_1'))
        ..refreshError = _refusal('failed-precondition');
      await _pump(tester, w);
      expect(find.byKey(const Key('getting-paid-auto-failed')), findsOneWidget);
    });

    testWidgets('a failed manual refresh says so in words', (tester) async {
      final w = _World(
        business: _business(account: 'acct_1', charges: true, payouts: true),
      );
      await _pump(tester, w);
      w.refreshError = _refusal('failed-precondition');
      await _tap(tester, 'getting-paid-refresh');
      expect(
        find.text('Could not refresh payout status. Try again.'),
        findsOneWidget,
      );
    });

    testWidgets('a Stripe link that cannot be made is said in words', (
      tester,
    ) async {
      final w = _World(business: _business())..linkError = _refusal('internal');
      await _pump(tester, w);
      await _tap(tester, 'getting-paid-stripe');
      expect(
        find.text('Could not start Stripe setup. Try again.'),
        findsOneWidget,
      );
      expect(w.opened, isEmpty);
    });

    testWidgets('a browser that will not open says so', (tester) async {
      final w = _World(business: _business())..openResult = false;
      await _pump(tester, w);
      await _tap(tester, 'getting-paid-stripe');
      expect(
        find.text('We could not open the page. Try again.'),
        findsOneWidget,
      );
    });

    testWidgets('the business that never loads resolves into a retry', (
      tester,
    ) async {
      final w = _World();
      await _pump(tester, w, settle: false);
      expect(find.byKey(const Key('getting-paid-loading')), findsOneWidget);
      await tester.pump(const Duration(seconds: 16));
      await tester.pump();
      expect(find.byKey(const Key('getting-paid-error')), findsOneWidget);
      // The business is there when the screen asks again.
      w.source.latest = _business();
      await _tap(tester, 'getting-paid-retry');
      expect(find.text('Payout setup required'), findsOneWidget);
    });
  });

  group('who sees Getting paid', () {
    testWidgets('someone who is not the real owner gets a note and no action', (
      tester,
    ) async {
      final w = _World(business: _business());
      await _pump(tester, w, owner: false);
      expect(find.byKey(const Key('getting-paid-owner-only')), findsOneWidget);
      expect(find.byKey(const Key('getting-paid-stripe')), findsNothing);
      expect(find.byKey(const Key('getting-paid-refresh')), findsNothing);
      expect(w.calls.log, isEmpty);
      expect(w.links, 0);
    });

    Future<void> pumpEntry(WidgetTester tester, _Auth auth) async {
      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        ChangeNotifierProvider<AuthProvider>.value(
          value: auth,
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: GettingPaidEntryRow()),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('the real owner sees the row', (tester) async {
      await pumpEntry(tester, _Auth(real: true));
      expect(find.byKey(const Key('open-getting-paid')), findsOneWidget);
      expect(find.text('Getting paid'), findsOneWidget);
    });

    testWidgets('a full-access staff member never sees Stripe setup', (
      tester,
    ) async {
      await pumpEntry(tester, _Auth(full: true));
      expect(find.byKey(const Key('open-getting-paid')), findsNothing);
      expect(find.text('Getting paid'), findsNothing);
    });

    testWidgets('no business, no row', (tester) async {
      await pumpEntry(tester, _Auth(real: true, business: ''));
      expect(find.byKey(const Key('open-getting-paid')), findsNothing);
    });
  });

  group('fees', () {
    testWidgets('shown as facts, with no field to change them', (tester) async {
      final w = _World(business: _business());
      await _pump(tester, w);
      expect(find.text('Platform fee'), findsOneWidget);
      expect(find.text('2.50%'), findsOneWidget);
      expect(
        find.text('May vary by service on our default rate.'),
        findsOneWidget,
      );
      expect(find.text("Who pays Stripe's processing fee"), findsOneWidget);
      expect(find.text('Laawol'), findsOneWidget);
      final fees = find.byKey(const Key('getting-paid-fees'));
      expect(
        find.descendant(of: fees, matching: find.byType(TextField)),
        findsNothing,
      );
      expect(
        find.descendant(of: fees, matching: find.byType(Switch)),
        findsNothing,
      );
      expect(w.calls.sent('getBusinessFeeSettings').single, {
        'businessId': 'b1',
      });
    });

    testWidgets('a custom rate and a processing fee not active yet', (
      tester,
    ) async {
      final w = _World(business: _business());
      w.calls.respond = (n, p) => n == 'getBusinessFeeSettings'
          ? {
              'stripeFeeMode': 'business_absorbs_processing_fee',
              'connectReady': false,
              'defaultPlatformFeePct': 0.03,
              'hasBusinessOverride': true,
            }
          : null;
      await _pump(tester, w);
      expect(find.text('Custom rate for your business'), findsOneWidget);
      expect(find.text('You'), findsOneWidget);
      expect(find.byKey(const Key('getting-paid-fee-note')), findsOneWidget);
    });

    testWidgets('fees that cannot load say so and the rest still works', (
      tester,
    ) async {
      final w = _World(business: _business());
      w.calls.respond = (n, p) =>
          n == 'getBusinessFeeSettings' ? throw _refusal('internal') : null;
      await _pump(tester, w);
      expect(find.byKey(const Key('getting-paid-fees-failed')), findsOneWidget);
      expect(find.text('Start Stripe registration'), findsOneWidget);
    });
  });

  group('verification documents', () {
    _World world() => _World(
      business: _business(
        services: ['carSales', 'carParking'],
        documents: {
          'dealerLicense': {
            'fileName': 'license.pdf',
            'url': 'https://files.test/license.pdf',
          },
        },
        review: {
          'note': 'Please send the lease too.',
          'documents': {
            'dealerLicense': {'status': 'verified'},
            'parkingFacilityProof': {
              'status': 'needs_changes',
              'note': 'The lease is expired.',
            },
          },
        },
      ),
    );

    testWidgets('each document with its status and the reviewer note', (
      tester,
    ) async {
      await _pump(tester, world());
      expect(
        find.text('Dealer license or sales authorization'),
        findsOneWidget,
      );
      expect(find.text('Parking facility proof'), findsOneWidget);
      expect(find.text('Verified'), findsOneWidget);
      expect(find.text('Needs changes'), findsOneWidget);
      expect(find.text('1/2 complete'), findsOneWidget);
      expect(
        find.text('Admin note: Please send the lease too.'),
        findsOneWidget,
      );
      expect(find.text('Admin request: The lease is expired.'), findsOneWidget);
      expect(
        find.byKey(const Key('doc-nofile-parkingFacilityProof')),
        findsOneWidget,
      );
      expect(find.byKey(const Key('doc-open-dealerLicense')), findsOneWidget);
    });

    testWidgets('Open document opens the file outside the app', (tester) async {
      final w = world();
      await _pump(tester, w);
      await _tap(tester, 'doc-open-dealerLicense');
      expect(w.opened.last.toString(), 'https://files.test/license.pdf');
    });

    testWidgets('choose, then upload sends the file for that document', (
      tester,
    ) async {
      final w = world();
      await _pump(tester, w);
      w.next = ChosenFile(
        name: 'lease.pdf',
        mimeType: 'application/pdf',
        read: () async => Uint8List.fromList(List.filled(2048, 7)),
      );
      await _tap(tester, 'doc-choose-parkingFacilityProof');
      expect(find.text('lease.pdf (2 KB)'), findsOneWidget);
      await _tap(tester, 'doc-upload-parkingFacilityProof');
      final sent = w.calls.sent('uploadBusinessVerificationDocument').single;
      expect(sent['businessId'], 'b1');
      expect(sent['documentId'], 'parkingFacilityProof');
      expect(sent['fileName'], 'lease.pdf');
      expect(sent['contentType'], 'application/pdf');
      expect(sent['size'], 2048);
      expect(find.text('Document uploaded.'), findsOneWidget);
      expect(
        find.byKey(const Key('doc-selected-parkingFacilityProof')),
        findsNothing,
      );
    });

    testWidgets('upload stays off until a file is chosen', (tester) async {
      await _pump(tester, world());
      await tester.ensureVisible(
        find.byKey(const Key('doc-upload-parkingFacilityProof')),
      );
      final button = tester.widget<FilledButton>(
        find.byKey(const Key('doc-upload-parkingFacilityProof')),
      );
      expect(button.onPressed, isNull);
    });

    testWidgets('a file that is not a document is refused in words', (
      tester,
    ) async {
      final w = world();
      await _pump(tester, w);
      w.next = ChosenFile(
        name: 'program.exe',
        read: () async => Uint8List.fromList([1, 2, 3]),
      );
      await _tap(tester, 'doc-choose-parkingFacilityProof');
      expect(
        find.text('Documents must be PDF, Word, or image files.'),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('doc-selected-parkingFacilityProof')),
        findsNothing,
      );
      expect(w.calls.sent('uploadBusinessVerificationDocument'), isEmpty);
    });

    testWidgets('an empty file is refused in words', (tester) async {
      final w = world();
      await _pump(tester, w);
      w.next = ChosenFile(name: 'a.pdf', read: () async => Uint8List(0));
      await _tap(tester, 'doc-choose-parkingFacilityProof');
      expect(find.text('That file is empty.'), findsOneWidget);
    });

    testWidgets('a server refusal is shown in words and the file is kept', (
      tester,
    ) async {
      final w = world();
      w.calls.respond = (n, p) => n == 'uploadBusinessVerificationDocument'
          ? throw _refusal('permission-denied')
          : null;
      await _pump(tester, w);
      w.next = ChosenFile(
        name: 'lease.pdf',
        mimeType: 'application/pdf',
        read: () async => Uint8List.fromList([1, 2, 3]),
      );
      await _tap(tester, 'doc-choose-parkingFacilityProof');
      await _tap(tester, 'doc-upload-parkingFacilityProof');
      expect(
        find.text('You cannot upload documents for this business.'),
        findsOneWidget,
      );
      expect(
        find.byKey(const Key('doc-selected-parkingFacilityProof')),
        findsOneWidget,
      );
    });

    testWidgets('another failure says the document was not uploaded', (
      tester,
    ) async {
      final w = world();
      w.calls.respond = (n, p) => n == 'uploadBusinessVerificationDocument'
          ? throw _refusal('invalid-argument', 'x')
          : null;
      await _pump(tester, w);
      w.next = ChosenFile(
        name: 'a.pdf',
        mimeType: 'application/pdf',
        read: () async => Uint8List.fromList([1]),
      );
      await _tap(tester, 'doc-choose-parkingFacilityProof');
      await _tap(tester, 'doc-upload-parkingFacilityProof');
      expect(
        find.text('The document was not uploaded. Try again.'),
        findsOneWidget,
      );
    });

    testWidgets('a waived document asks for nothing', (tester) async {
      final w = _World(
        business: _business(
          services: ['carSales'],
          review: {
            'documents': {
              'dealerLicense': {'status': 'not_applicable'},
            },
          },
        ),
      );
      await _pump(tester, w);
      expect(find.text('Not needed: approved by Laawol.'), findsOneWidget);
      expect(find.byKey(const Key('doc-choose-dealerLicense')), findsNothing);
    });

    testWidgets('no required documents says so', (tester) async {
      await _pump(tester, _World(business: _business(services: ['inventory'])));
      expect(find.byKey(const Key('getting-paid-no-docs')), findsOneWidget);
    });
  });

  testWidgets('French at 320 px wide does not overflow', (tester) async {
    final w = _World(
      business: _business(
        account: 'acct_1abcdefghijklmnopqrstuvwxyz',
        services: ['carSales', 'carParking', 'barrelShipping', 'carTransport'],
        requirements: {
          'currentlyDue': ['x'],
        },
        review: {
          'note': 'Merci de joindre le bail du terrain.',
          'documents': {
            'parkingFacilityProof': {
              'status': 'needs_changes',
              'note': 'Le bail est expiré.',
            },
          },
        },
      ),
    );
    w.calls.respond = (n, p) => n == 'getBusinessFeeSettings'
        ? {
            'stripeFeeMode': 'business_absorbs_processing_fee',
            'connectReady': false,
            'defaultPlatformFeePct': 0.025,
            'hasBusinessOverride': true,
          }
        : null;
    await _pump(
      tester,
      w,
      locale: const Locale('fr'),
      size: const Size(320, 5200),
    );
    expect(find.text('Être payé'), findsOneWidget);
    expect(find.text('Continuer dans Stripe'), findsOneWidget);
    expect(find.text('Documents de vérification'), findsOneWidget);
    expect(find.text('À corriger'), findsOneWidget);
    expect(
      find.text('Demande de l\'administrateur : Le bail est expiré.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    // The same screen, a person who may not set up Stripe, in French.
    await _pump(
      tester,
      w,
      owner: false,
      locale: const Locale('fr'),
      size: const Size(320, 1200),
    );
    expect(
      find.text(
        'Seul le propriétaire de l\'entreprise configure les versements.',
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
