import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart' show ImageSource;
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/containers_screen.dart';
import 'package:my_flutter_app/screens/package_result_screen.dart';
import 'package:my_flutter_app/services/container_delivery.dart'
    show PackageAccess;
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/package_photo_service.dart'
    show PackagePhotoFailure;
import 'package:my_flutter_app/services/package_proof.dart';
import 'package:my_flutter_app/services/waiting_packages.dart'
    show DestinationRef;
import 'package:my_flutter_app/theme/app_colors.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/lot_sheets.dart';
import 'package:my_flutter_app/widgets/proof_fields.dart';
import 'package:my_flutter_app/widgets/proof_ticks.dart';

/// The proof widgets (docs/AIR_PACKAGES.md): the editor with a fake camera
/// and a fake upload, the three ticks, the sender's problem banner, and the
/// waiting package form sending the proof fields along.

/// A 1 x 1 PNG: real image bytes, so the thumbnail decodes.
final Uint8List png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA'
  '60e6kgAAAABJRU5ErkJggg==',
);

const path = 'packagePhotos/b1/staff1/abcd1234efgh.png';

class FakeUploads {
  final List<Uint8List> sent = [];
  final List<Completer<String>> pending = [];
  Object? error;

  Future<String> call(Uint8List bytes) {
    sent.add(bytes);
    if (error != null) return Future.error(error!);
    final c = Completer<String>();
    pending.add(c);
    return c.future;
  }
}

Future<String> noUrl(String path) async => '';

ProofFieldsController controller({
  PackageProofDraft initial = PackageProofDraft.empty,
  Uint8List? picked,
  FakeUploads? uploads,
}) =>
    ProofFieldsController(
      businessId: 'b1',
      initial: initial,
      picker: (ImageSource source) async => picked,
      uploader: (uploads ?? FakeUploads()).call,
      urlOf: noUrl,
    );

ContainerLine line([Map<String, dynamic> extra = const {}]) =>
    ContainerLine.fromMap('l1', {
      'businessId': 'b1',
      'containerId': '',
      'containerStatus': containerLineStatusWaiting,
      'kind': containerLineKindBarrels,
      'quantity': 2,
      'ownerKind': containerOwnerCustomer,
      'customerName': 'Fatou Diallo',
      'customerPhone': '+19175551234',
      'receiverName': 'Mariama Bah',
      'receiverPhone': '+224621234567',
      'trackingCode': 'CL-K7M4P2',
      'destinationCountryId': 'guinea',
      'destinationCountryName': 'Guinea',
      ...extra,
    });

Future<void> pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(430, 3200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(body: SingleChildScrollView(child: child)),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> tap(WidgetTester tester, String key) async {
  final finder = find.byKey(Key(key));
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

/// A tap that leaves a spinner running (an upload in flight), so it cannot
/// wait for the tree to settle.
Future<void> tapNoSettle(WidgetTester tester, String key) async {
  final finder = find.byKey(Key(key));
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await tester.pump();
  await tester.pump();
}

Future<void> type(WidgetTester tester, String key, String text) async {
  final finder = find.byKey(Key(key));
  await tester.ensureVisible(finder);
  await tester.enterText(finder, text);
  await tester.pumpAndSettle();
}

Color iconColor(WidgetTester tester, String key) => tester
    .widget<Icon>(find.descendant(
      of: find.byKey(Key(key)),
      matching: find.byType(Icon),
    ))
    .color!;

void main() {
  group('PackageProofTicks', () {
    testWidgets('shows grey, amber, green and red with their words',
        (tester) async {
      await pump(
        tester,
        const PackageProofTicks(
          ticks: ProofTicks(photo: false, senderOk: 'none', delivered: false),
        ),
      );
      expect(iconColor(tester, 'proof-tick-photo'), AppColors.muted);
      expect(iconColor(tester, 'proof-tick-sender'), AppColors.muted);
      expect(iconColor(tester, 'proof-tick-delivered'), AppColors.muted);
      expect(find.byTooltip('No drop-off photo'), findsOneWidget);
      expect(find.byTooltip('Sender not asked'), findsOneWidget);
      expect(find.byTooltip('Not delivered yet'), findsOneWidget);

      await pump(
        tester,
        const PackageProofTicks(
          ticks: ProofTicks(photo: true, senderOk: 'asked', delivered: false),
        ),
      );
      expect(iconColor(tester, 'proof-tick-photo'), AppColors.sage);
      expect(iconColor(tester, 'proof-tick-sender'), AppColors.warn);
      expect(find.byTooltip('Sender asked, no answer yet'), findsOneWidget);

      await pump(
        tester,
        const PackageProofTicks(
          ticks: ProofTicks(
            photo: true,
            senderOk: 'confirmed',
            delivered: true,
            deliveredWithoutCode: true,
          ),
        ),
      );
      expect(iconColor(tester, 'proof-tick-sender'), AppColors.sage);
      expect(iconColor(tester, 'proof-tick-delivered'), AppColors.warn);
      expect(find.byTooltip('Sender confirmed'), findsOneWidget);
      expect(find.byTooltip('Delivered without code'), findsOneWidget);

      await pump(
        tester,
        const PackageProofTicks(
          ticks: ProofTicks(photo: true, senderOk: 'problem', delivered: true),
        ),
        locale: const Locale('fr'),
      );
      expect(iconColor(tester, 'proof-tick-sender'), AppColors.errorRed);
      expect(iconColor(tester, 'proof-tick-delivered'), AppColors.sage);
      expect(find.byTooltip('L’expéditeur a signalé un problème'), findsOneWidget);
      expect(find.byTooltip('Livré'), findsOneWidget);
    });
  });

  group('SenderProblemBanner', () {
    testWidgets('shows the note and opens the conversation', (tester) async {
      var opened = 0;
      await pump(
        tester,
        SenderProblemBanner(
          line: line({
            'senderConfirmation': {'status': 'problem', 'note': 'Only one phone'},
          }),
          onOpenConversation: () => opened++,
        ),
      );
      expect(find.byKey(const Key('proof-problem-banner')), findsOneWidget);
      expect(find.text('Sender reported a problem'), findsOneWidget);
      expect(find.text('Only one phone'), findsOneWidget);
      await tap(tester, 'proof-open-conversation');
      expect(opened, 1);

      await pump(tester, SenderProblemBanner(line: line()));
      expect(find.byKey(const Key('proof-problem-banner')), findsNothing);
    });
  });

  group('ProofFields', () {
    testWidgets('takes a photo, shows it uploading, then keeps its path',
        (tester) async {
      final uploads = FakeUploads();
      final c = controller(picked: png, uploads: uploads);
      addTearDown(c.dispose);
      await pump(tester, ProofFields(controller: c));
      expect(find.text('Photos · 0 of 5'), findsOneWidget);
      expect(find.byKey(const Key('proof-photos-optional')), findsOneWidget);

      await tapNoSettle(tester, 'proof-photo-gallery');
      expect(uploads.sent, hasLength(1));
      expect(find.byKey(const Key('proof-photo-uploading')), findsOneWidget);
      expect(c.uploading, isTrue);
      expect(c.photoPaths, isEmpty);

      uploads.pending.single.complete(path);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('proof-photo-uploading')), findsNothing);
      expect(c.photoPaths, [path]);
      expect(find.text('Photos · 1 of 5'), findsOneWidget);

      await tap(tester, 'proof-photo-remove');
      expect(c.photoPaths, isEmpty);
    });

    testWidgets('names a refused or failed upload and a backed-out picker',
        (tester) async {
      final uploads = FakeUploads()..error = const PackagePhotoFailure('unavailable');
      final c = controller(picked: png, uploads: uploads);
      addTearDown(c.dispose);
      await pump(tester, ProofFields(controller: c));
      await tap(tester, 'proof-photo-camera');
      expect(find.byKey(const Key('proof-photo-error')), findsOneWidget);
      expect(find.text('The photo could not be uploaded. Try again.'),
          findsOneWidget);
      expect(c.photos, isEmpty);

      // Not a photo at all.
      final bad = controller(picked: Uint8List.fromList([1, 2, 3, 4]));
      addTearDown(bad.dispose);
      await pump(tester, ProofFields(controller: bad));
      await tap(tester, 'proof-photo-gallery');
      expect(find.text('That file is not a photo (JPEG, PNG or WebP).'),
          findsOneWidget);

      // Backed out of the picker: nothing happens.
      final none = controller(picked: null);
      addTearDown(none.dispose);
      await pump(tester, ProofFields(controller: none));
      await tap(tester, 'proof-photo-gallery');
      expect(find.byKey(const Key('proof-photo-error')), findsNothing);
      expect(none.photos, isEmpty);
    });

    testWidgets('shows stored photos and stops at five', (tester) async {
      final c = controller(
        initial: PackageProofDraft(photoPaths: [
          for (var i = 0; i < 5; i++) 'packagePhotos/b1/req/r1_${i}xxxxxx.jpg',
        ]),
        picked: png,
      );
      addTearDown(c.dispose);
      await pump(tester, ProofFields(controller: c));
      expect(find.byKey(const Key('proof-photo:4')), findsOneWidget);
      expect(find.text('Photos · 5 of 5'), findsOneWidget);
      // The buttons are disabled at the limit: tapping adds nothing.
      await tap(tester, 'proof-photo-gallery');
      expect(c.photos, hasLength(5));
      await tester.tap(find.byKey(const Key('proof-photo-remove')).first);
      await tester.pumpAndSettle();
      expect(c.photos, hasLength(4));
      expect(c.photoPaths.first, 'packagePhotos/b1/req/r1_1xxxxxx.jpg');
    });

    testWidgets('says when a photo is required and shows the refusals',
        (tester) async {
      final c = controller();
      addTearDown(c.dispose);
      await pump(
        tester,
        ProofFields(
          controller: c,
          photosRequired: true,
          photoError: 'Add at least one photo of the package.',
          contentsError: 'Check the item list.',
          weightError: 'Enter a weight between 0.1 and 2000 lb.',
          valueError: r'Enter a declared value of $0 or more.',
        ),
      );
      expect(find.byKey(const Key('proof-photos-required')), findsOneWidget);
      expect(find.text('A photo of the package is required at drop-off.'),
          findsOneWidget);
      expect(find.text('Add at least one photo of the package.'), findsOneWidget);
      expect(find.text('Check the item list.'), findsOneWidget);
      expect(find.text('Enter a weight between 0.1 and 2000 lb.'), findsOneWidget);
      expect(find.text(r'Enter a declared value of $0 or more.'), findsOneWidget);
    });

    testWidgets('items, weight and value make the draft', (tester) async {
      final c = controller(
        initial: const PackageProofDraft(
          contents: [PackageContent(label: 'tablet', quantity: 1)],
          weightLb: 4.26,
          declaredValueCents: 25000,
        ),
      );
      addTearDown(c.dispose);
      await pump(tester, ProofFields(controller: c));
      expect(c.weight.text, '4.3');
      expect(c.value.text, '250');
      expect(find.byKey(const Key('proof-item-label:0')), findsOneWidget);

      await tap(tester, 'proof-item-add');
      await type(tester, 'proof-item-label:1', 'iPhone 13');
      await type(tester, 'proof-item-quantity:1', '2');
      await type(tester, 'proof-item-serial:1', '35-209900-176148-1');
      await type(tester, 'proof-weight', '12,5');
      await type(tester, 'proof-declared-value', '1,200.50');

      final checked = validateProofFields(c.draft);
      expect(checked.error, '');
      expect(checked.fields.contents, const [
        PackageContent(label: 'tablet'),
        PackageContent(
          label: 'iPhone 13',
          quantity: 2,
          serial: '35-209900-176148-1',
        ),
      ]);
      expect(checked.fields.weightLb, 12.5);
      expect(checked.fields.declaredValueCents, 120050);

      // A row without a name is dropped; a bad quantity is named.
      await tap(tester, 'proof-item-remove:0');
      expect(c.items, hasLength(1));
      await type(tester, 'proof-item-quantity:0', '0');
      expect(validateProofFields(c.draft).error, 'contents_invalid');
      await type(tester, 'proof-item-quantity:0', '2');
      // The field keeps digits only, so "out of range" is the typed refusal.
      await type(tester, 'proof-weight', '0');
      expect(validateProofFields(c.draft).error, 'weight_invalid');
      await type(tester, 'proof-weight', '');
      await type(tester, 'proof-declared-value', '1.2.3');
      expect(validateProofFields(c.draft).error, 'declared_value_invalid');

      c.reset();
      await tester.pumpAndSettle();
      expect(c.items, isEmpty);
      expect(c.weight.text, '');
      expect(validateProofFields(c.draft).fields.toPayload()['contents'],
          isEmpty);
    });

    testWidgets('reads in French', (tester) async {
      final c = controller();
      addTearDown(c.dispose);
      await pump(
        tester,
        ProofFields(controller: c, photosRequired: true),
        locale: const Locale('fr'),
      );
      expect(find.text('Photos · 0 sur 5'), findsOneWidget);
      expect(find.text('Appareil photo'), findsOneWidget);
      expect(find.text('Galerie'), findsOneWidget);
      expect(find.text('Une photo du colis est obligatoire au dépôt.'),
          findsOneWidget);
      expect(find.text('Contenu'), findsOneWidget);
      expect(find.text('Ajouter un article'), findsOneWidget);
      expect(find.text('Poids'), findsOneWidget);
      expect(find.text('Valeur déclarée'), findsOneWidget);
    });
  });

  group('waiting package form', () {
    Future<Object?> Function(String, Map<String, Object?>) caller(
      List<(String, Map<String, Object?>)> log,
    ) =>
        (name, payload) async {
          log.add((name, payload));
          return {'lineId': 'l9', 'trackingCode': 'CL-BCDFGH'};
        };

    testWidgets('requires a photo when the business says so, then sends the proof',
        (tester) async {
      final log = <(String, Map<String, Object?>)>[];
      final uploads = FakeUploads();
      final c = controller(picked: png, uploads: uploads);
      addTearDown(c.dispose);
      await pump(
        tester,
        Builder(
          builder: (context) => TextButton(
            key: const Key('open'),
            onPressed: () => showLotSheet<void>(
              context,
              waitingPackageSheetForTesting(
                caller: caller(log),
                proofController: c,
                proofSettings: const PackageProofSettings(photosRequired: true),
                defaultDestination: const DestinationRef('guinea', 'Guinea'),
              ),
            ),
            child: const Text('open'),
          ),
        ),
      );
      await tap(tester, 'open');
      await type(tester, 'line-customer', 'Fatou Diallo');
      await type(tester, 'line-receiver', 'Mariama Bah');
      expect(find.byKey(const Key('proof-photos-required')), findsOneWidget);

      // No photo yet: refused on the phone, nothing sent.
      await tap(tester, 'line-save');
      expect(log, isEmpty);
      expect(find.text('Add at least one photo of the package.'), findsOneWidget);

      await tapNoSettle(tester, 'proof-photo-camera');
      // Still uploading: the save waits.
      await tapNoSettle(tester, 'line-save');
      expect(log, isEmpty);
      expect(find.text('Uploading…'), findsOneWidget);
      uploads.pending.single.complete(path);
      await tester.pumpAndSettle();

      await tap(tester, 'proof-item-add');
      await type(tester, 'proof-item-label:0', 'phones');
      await type(tester, 'proof-item-quantity:0', '2');
      await type(tester, 'proof-weight', '4.26');
      await type(tester, 'proof-declared-value', '250');
      await tap(tester, 'line-save');

      final sent = log.where((c) => c.$1 == 'addWaitingPackage').single.$2;
      expect(sent['photoPaths'], [path]);
      expect(sent['contents'], [
        {'label': 'phones', 'quantity': 2, 'serial': ''},
      ]);
      expect(sent['weightLb'], 4.3);
      expect(sent['declaredValueCents'], 25000);
    });
  });

  group('package page', () {
    testWidgets('shows the ticks, photos, contents, weight, value and code',
        (tester) async {
      final l = line({
        'photoPaths': [path],
        'contents': [
          {'label': 'iPhone 13', 'quantity': 2, 'serial': '35-1'},
        ],
        'weightLb': 4.2,
        'declaredValueCents': 25000,
        'pickupCode': '4821',
        'senderConfirmation': {'status': 'problem', 'note': 'Wrong count'},
      });
      await pump(
        tester,
        SizedBox(
          height: 2400,
          child: packageResultViewForTesting(line: l, photoUrlOf: noUrl),
        ),
      );
      expect(find.byKey(const Key('pkg-proof')), findsOneWidget);
      expect(find.byKey(const Key('proof-ticks')), findsOneWidget);
      expect(find.byKey(const Key('pkg-proof-photos')), findsOneWidget);
      expect(find.textContaining('2 iPhone 13'), findsOneWidget);
      expect(find.text('Weight: 4.2 lb'), findsOneWidget);
      expect(find.textContaining('Declared value:'), findsOneWidget);
      expect(find.text('Pickup code: 4821'), findsOneWidget);
      expect(find.byKey(const Key('proof-problem-banner')), findsOneWidget);
      expect(find.text('Wrong count'), findsOneWidget);

      // A deliveries-only agent sees neither the value nor the code.
      await pump(
        tester,
        SizedBox(
          height: 2400,
          child: packageResultViewForTesting(
            line: l,
            photoUrlOf: noUrl,
            access: PackageAccess.deliveriesOnly,
          ),
        ),
      );
      expect(find.textContaining('Declared value:'), findsNothing);
      expect(find.text('Pickup code: 4821'), findsNothing);
      expect(find.byKey(const Key('pkg-proof-photos')), findsOneWidget);
    });
  });
}
