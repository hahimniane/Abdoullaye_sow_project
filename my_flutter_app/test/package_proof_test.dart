import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/package_proof.dart';
import 'package:my_flutter_app/services/package_requests.dart'
    show ReceiveCheck, receivePayload;
import 'package:my_flutter_app/services/waiting_packages.dart'
    show addWaitingPackageRequest, assignLinesRequest;

/// The app's mirror of `functions/package_proof.js`, checked against the
/// same inputs the server's own tests use (functions/test/package-proof
/// .test.js), so a refusal on the phone and one from the server say the
/// same thing for the same reason.
const biz = 'nensona';
const uid = 'staffUid123';
const path = 'packagePhotos/$biz/$uid/abcd1234efgh.jpg';

void main() {
  group('photo paths', () {
    test('accepts our root, a folder and a jpg/png/webp file', () {
      final parts = photoPathParts(path)!;
      expect(parts.businessId, biz);
      expect(parts.folder, uid);
      expect(parts.fileId, 'abcd1234efgh.jpg');
      expect(parts.isServerFolder, isFalse);
      expect(photoPathParts('packagePhotos/$biz/wa/a1b2c3d4e5f6.webp')!
          .isServerFolder, isTrue);
    });

    test('rejects other roots, traversal and odd extensions', () {
      for (final bad in [
        'packageRequestPhotos/$biz/$uid/abcd1234efgh.jpg',
        'packagePhotos/$biz/$uid/../abcd1234efgh.jpg',
        'packagePhotos/$biz/$uid/abcd1234efgh.gif',
        'packagePhotos/$biz/$uid/short.jpg',
        'packagePhotos/$biz/abcd1234efgh.jpg',
        '',
        null,
      ]) {
        expect(photoPathParts(bad), isNull, reason: '$bad');
      }
    });

    test('lets staff attach only their own folder in their business', () {
      expect(photoPathAllowed(path, businessId: biz, uid: uid), isTrue);
      expect(photoPathAllowed(path, businessId: 'keren', uid: uid), isFalse);
      expect(photoPathAllowed(path, businessId: biz, uid: 'other'), isFalse);
      const wa = 'packagePhotos/$biz/wa/abcd1234efgh.jpg';
      expect(photoPathAllowed(wa, businessId: biz, uid: uid), isFalse);
      expect(
        photoPathAllowed(wa, businessId: biz, uid: uid, allowServerFolders: true),
        isTrue,
      );
    });

    test('keeps at most five unique paths', () {
      final paths = [
        for (var i = 0; i < 6; i++) 'packagePhotos/$biz/$uid/photo000${i}xx.jpg',
      ];
      expect(normalizePhotoPaths(paths).error, 'photo_invalid');
      expect(normalizePhotoPaths([path, path]).paths, [path]);
      expect(normalizePhotoPaths(null).paths, isEmpty);
      expect(normalizePhotoPaths(null).error, '');
      expect(normalizePhotoPaths('x').error, 'photo_invalid');
    });
  });

  group('contents, weight and value', () {
    test('normalizes the item list', () {
      final out = normalizeContents([
        {'label': ' iPhone 13 ', 'quantity': '2', 'serial': '35-209900-176148-1'},
        {'label': 'clothes'},
        {'label': ''},
      ]);
      expect(out.error, '');
      expect(out.contents, const [
        PackageContent(
          label: 'iPhone 13',
          quantity: 2,
          serial: '35-209900-176148-1',
        ),
        PackageContent(label: 'clothes'),
      ]);
      expect(
        normalizeContents([
          {'label': 'x', 'quantity': 100},
        ]).error,
        'contents_invalid',
      );
      expect(
        normalizeContents([
          {'label': 'x' * 61},
        ]).error,
        'contents_invalid',
      );
      expect(
        normalizeContents([
          for (var i = 0; i < 11; i++) {'label': 'a'},
        ]).error,
        'contents_invalid',
      );
      expect(normalizeContents(null).contents, isEmpty);
      expect(normalizeContents(null).error, '');
      // Typed rows from the editor: a serial is cleaned, a bad quantity named.
      expect(
        normalizeContents([
          const PackageContent(label: 'tablet', quantity: 1, serial: 'A#1 2'),
        ]).contents.single.serial,
        'A1 2',
      );
      expect(
        normalizeContents([
          {'label': 'x', 'quantity': 'two'},
        ]).error,
        'contents_invalid',
      );
    });

    test('writes the list for a message and trims long ones', () {
      const contents = [
        PackageContent(label: 'phones', quantity: 2),
        PackageContent(label: 'tablet'),
        PackageContent(label: 'clothes'),
      ];
      expect(contentsText(contents), '2 phones, tablet, clothes');
      expect(contentsText(const []), '');
      final long = contentsText(
        [
          for (var i = 0; i < 10; i++)
            PackageContent(label: 'item number $i with a long name'),
        ],
        max: 60,
      );
      expect(long.length, lessThanOrEqualTo(60), reason: long);
      expect(long.endsWith('…'), isTrue);
    });

    test('rounds weight to one decimal within range', () {
      expect(normalizeWeightLb('4.26').value, 4.3);
      expect(normalizeWeightLb('4,26').value, 4.3);
      expect(normalizeWeightLb(null), (value: null, error: ''));
      expect(normalizeWeightLb(''), (value: null, error: ''));
      expect(normalizeWeightLb(0).error, 'weight_invalid');
      expect(normalizeWeightLb(2001).error, 'weight_invalid');
      expect(normalizeWeightLb('heavy').error, 'weight_invalid');
      expect(weightText(4.2, 'en'), '4.2 lb');
      expect(weightText(4.2, 'fr'), '4,2 lb');
      expect(weightText(5, 'en'), '5 lb');
      expect(weightText(null, 'en'), '');
    });

    test('takes whole cents at or above zero as the declared value', () {
      expect(normalizeDeclaredValueCents(90000).value, 90000);
      expect(normalizeDeclaredValueCents(0).value, 0);
      expect(normalizeDeclaredValueCents(null), (value: null, error: ''));
      expect(normalizeDeclaredValueCents(-1).error, 'declared_value_invalid');
      expect(normalizeDeclaredValueCents(10.5).error, 'declared_value_invalid');
    });

    test('reads dollars typed in the field as cents', () {
      expect(declaredValueCentsFromInput(''), isNull);
      expect(declaredValueCentsFromInput('250'), 25000);
      expect(declaredValueCentsFromInput('12.50'), 1250);
      expect(declaredValueCentsFromInput('12,5'), 1250);
      expect(declaredValueCentsFromInput('1,200'), 120000);
      expect(declaredValueCentsFromInput(r'$ 1,200.75'), 120075);
      expect(declaredValueCentsFromInput('abc'), -1);
      expect(declaredValueCentsFromInput('1.2.3'), -1);
      expect(declaredValueInput(1250), '12.50');
      expect(declaredValueInput(1200), '12');
      expect(declaredValueInput(null), '');
    });

    test('checks the four fields together and names the first problem', () {
      final ok = validateProofFields(const PackageProofDraft(
        photoPaths: [path],
        contents: [PackageContent(label: 'phone')],
        weightLb: 4.2,
        declaredValueCents: 1000,
      ));
      expect(ok.error, '');
      expect(ok.fields.toPayload(), {
        'photoPaths': [path],
        'contents': [
          {'label': 'phone', 'quantity': 1, 'serial': ''},
        ],
        'weightLb': 4.2,
        'declaredValueCents': 1000,
      });
      expect(validateProofFields(PackageProofDraft.empty).fields.toPayload(), {
        'photoPaths': <String>[],
        'contents': <Map<String, Object?>>[],
        'weightLb': null,
        'declaredValueCents': null,
      });
      expect(
        validateProofFields(const PackageProofDraft(weightLb: -1)).error,
        'weight_invalid',
      );
      expect(
        validateProofFields(const PackageProofDraft(declaredValueCents: 1.5))
            .error,
        'declared_value_invalid',
      );
      expect(
        validateProofFields(const PackageProofDraft(declaredValueCents: -1))
            .error,
        'declared_value_invalid',
      );
    });
  });

  group('proof settings and ticks', () {
    test('reads the three switches, missing means off', () {
      expect(proofSettingsOf({}), const PackageProofSettings());
      expect(proofSettingsOf(null), const PackageProofSettings());
      expect(
        proofSettingsOf({
          'packageProofSettings': {'photosRequired': true, 'pickupCode': 'yes'},
        }),
        const PackageProofSettings(photosRequired: true),
      );
    });

    test('requires a photo only for counter drop-offs when switched on', () {
      const on = PackageProofSettings(photosRequired: true);
      expect(photoRequirementRefusal(on), 'photo_required');
      expect(photoRequirementRefusal(on, photoPaths: [path]), '');
      expect(photoRequirementRefusal(on, source: 'request'), '');
      expect(photoRequirementRefusal(const PackageProofSettings()), '');
    });

    test('shows the three ticks', () {
      expect(
        proofTicksOf({
          'photoPaths': [path],
          'senderConfirmation': {'status': 'confirmed'},
          'deliveredAt': DateTime(2026, 10, 29),
        }),
        const ProofTicks(
          photo: true,
          senderOk: 'confirmed',
          delivered: true,
        ),
      );
      expect(proofTicksOf({}),
          const ProofTicks(photo: false, senderOk: 'none', delivered: false));
      expect(proofTicksOf({}).complete, isFalse);
      expect(proofTicksOf({}).missing, isTrue);
      expect(
        senderConfirmationOf({
          'senderConfirmation': {'status': 'weird'},
        }).status,
        'none',
      );
      final problem = SenderConfirmation.of({
        'status': 'problem',
        'note': 'Only one phone',
        'answeredAtMs': 1700000000000,
      });
      expect(problem.isProblem, isTrue);
      expect(problem.note, 'Only one phone');
      expect(problem.answeredAtMs, 1700000000000);
    });

    test('reads the proof fields off a stored line', () {
      final line = ContainerLine.fromMap('l1', {
        'businessId': biz,
        'kind': 'barrels',
        'quantity': 1,
        'ownerKind': 'customer',
        'customerName': 'Fatou',
        'photoPaths': [path, 'not/a/path', 'packagePhotos/$biz/req/req12345678_0.jpg'],
        'contents': [
          {'label': 'iPhone 13', 'quantity': 2, 'serial': '35-1'},
          {'label': ''},
        ],
        'weightLb': 4.26,
        'declaredValueCents': 90000,
        'senderConfirmation': {'status': 'problem', 'note': 'Wrong count'},
        'pickupCode': '4821',
        'customerPhotos': [
          {'path': 'packagePhotos/$biz/wa/abcd1234efgh12345678.jpg', 'phone': '+1'},
        ],
        'deliveredWithoutCode': true,
        'deliveredPhotoPath': 'packagePhotos/$biz/$uid/zzzz1234efgh.jpg',
        'collectedAtDeliveryCents': 2500,
      });
      expect(line.photoPaths, [path, 'packagePhotos/$biz/req/req12345678_0.jpg']);
      expect(line.contents.single.label, 'iPhone 13');
      expect(line.weightLb, 4.3);
      expect(line.declaredValueCents, 90000);
      expect(line.senderReportedProblem, isTrue);
      expect(line.pickupCode, '4821');
      expect(line.customerPhotoPaths.length, 1);
      expect(line.deliveredWithoutCode, isTrue);
      expect(line.deliveredPhotoPath, isNotEmpty);
      expect(line.collectedAtDeliveryCents, 2500);
      expect(line.proofTicks.photo, isTrue);
      expect(line.proofTicks.senderOk, 'problem');
      expect(line.proofTicks.delivered, isFalse);
      // The edit form opens on what is stored.
      expect(line.proofDraft.photoPaths, line.photoPaths);
      expect(line.proofDraft.weightLb, 4.3);
    });
  });

  group('refusals and payloads', () {
    test('reads a proof refusal off the callable details', () {
      expect(proofRefusalCode({'reason': 'photo_required'}), 'photo_required');
      expect(
        proofRefusalCode({'reasons': ['vin_required', 'weight_invalid']}),
        'weight_invalid',
      );
      expect(proofRefusalCode({'reason': 'vin_required'}), '');
      expect(proofRefusalCode('nope'), '');
      expect(proofRefusalCodes, contains('air_waybill_invalid'));
    });

    test('names the packages a sender_problem refusal is about', () {
      expect(
        senderProblemLineIds({
          'reason': 'sender_problem',
          'lineIds': ['a', 'b'],
          'warnings': [
            {'lineId': 'b', 'reason': 'sender_problem'},
            {'lineId': 'c', 'reason': 'sender_problem'},
          ],
        }),
        ['a', 'b', 'c'],
      );
      expect(senderProblemLineIds({'reason': 'line_delivered'}), isEmpty);
      expect(senderProblemLineIds(null), isEmpty);
    });

    test('the proof fields ride every line body', () {
      const draft = ContainerLineDraft(
        kind: 'barrels',
        quantity: 1,
        ownerKind: 'customer',
        customerName: 'Fatou',
        receiverName: 'Mariama',
        destinationCountryId: 'guinea',
        destinationCountryName: 'Guinea',
        proof: PackageProofDraft(
          photoPaths: [path],
          contents: [PackageContent(label: 'phone', quantity: 2)],
          weightLb: '4.26',
          declaredValueCents: 25000,
        ),
      );
      final record = containerLineRecord(draft);
      expect(record['photoPaths'], [path]);
      expect(record['contents'], [
        {'label': 'phone', 'quantity': 2, 'serial': ''},
      ]);
      expect(record['weightLb'], 4.3);
      expect(record['declaredValueCents'], 25000);
      // Flat on addWaitingPackage, as the server reads it.
      final waiting = addWaitingPackageRequest('b1', draft);
      expect(waiting['photoPaths'], [path]);
      expect(waiting['weightLb'], 4.3);
      // A draft without proof sends none: an older form leaves the line's.
      expect(
        containerLineRecord(const ContainerLineDraft(kind: 'barrels', quantity: 1))
            .containsKey('photoPaths'),
        isFalse,
      );
      // The validator names the first problem, as the server's does.
      expect(
        validateContainerLine(const ContainerLineDraft(
          kind: 'barrels',
          quantity: 1,
          ownerKind: 'customer',
          receiverName: 'Mariama',
          proof: PackageProofDraft(weightLb: 'heavy'),
        )),
        contains('weight_invalid'),
      );
    });

    test('receivePackageRequest takes the proof at the top level', () {
      final payload = receivePayload(
        businessId: 'b1',
        requestId: 'r1',
        check: const ReceiveCheck(pieces: [], reasons: [], totalCents: null),
        proof: const PackageProofFields(photoPaths: [path], weightLb: 2)
            .toPayload(),
      );
      expect(payload['photoPaths'], [path]);
      expect(payload['weightLb'], 2);
      expect(payload['contents'], isEmpty);
    });

    test('loading sends the acknowledgement only when confirmed', () {
      expect(
        assignLinesRequest('b1', 'c1', ['l1']).containsKey('acknowledgeProblems'),
        isFalse,
      );
      expect(
        assignLinesRequest('b1', 'c1', ['l1'], acknowledgeProblems: true)
            ['acknowledgeProblems'],
        isTrue,
      );
    });
  });
}
