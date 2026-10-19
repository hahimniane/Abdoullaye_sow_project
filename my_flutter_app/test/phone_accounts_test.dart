import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/guest_tracking_result.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/phone_account_service.dart';
import 'package:my_flutter_app/services/phone_accounts.dart';
import 'package:my_flutter_app/widgets/phone_account_widgets.dart';
import 'package:cloud_functions/cloud_functions.dart';

/// The wire shape of docs/PHONE_ACCOUNTS.md §6, as iOS hands it over
/// (nested `Map<Object?, Object?>`).
Map<Object?, Object?> _item(
  String key, {
  String role = 'sender',
  List<String>? roles,
  String businessId = 'biz-a',
  String businessName = 'Conakry Express',
  String service = 'container',
  String stage = 'in_transit',
  int createdAtMs = 1000,
  int updatedAtMs = 0,
  Object? shipping,
}) => <Object?, Object?>{
  'key': key,
  'collection': key.split('/').first,
  'role': role,
  'roles': roles ?? [role],
  'businessId': businessId,
  'businessName': businessName,
  'service': service,
  'trackingCode': 'CL-${key.hashCode.abs() % 1000}',
  'stage': stage,
  'pieceCount': 3,
  'createdAtMs': createdAtMs,
  'updatedAtMs': updatedAtMs,
  'shipping': ?shipping,
};

MyShipmentItem _parsed(Map<Object?, Object?> raw) =>
    MyShipmentItem.fromCallable(raw)!;

void main() {
  group('refusals', () {
    test('reads reason, retryAfterMs and attemptsLeft from details', () {
      final refusal = parsePhoneAccountRefusal(
        'RESOURCE-EXHAUSTED',
        <Object?, Object?>{'reason': 'rate_limited', 'retryAfterMs': 29001},
      );
      expect(refusal.code, 'resource-exhausted');
      expect(refusal.reason, PhoneRefusalReason.rateLimited);
      expect(refusal.retryAfterSeconds, 30);
      final wrong = parsePhoneAccountRefusal('invalid-argument', {
        'reason': 'code_wrong',
        'attemptsLeft': 3,
      });
      expect(wrong.attemptsLeft, 3);
      expect(wrong.needsNewCode, isFalse);
      expect(
        parsePhoneAccountRefusal('failed-precondition', {
          'reason': 'code_expired',
        }).needsNewCode,
        isTrue,
      );
      final none = parsePhoneAccountRefusal('unavailable', null);
      expect(none.reason, '');
      expect(none.offline, isTrue);
    });

    test('every server reason has its own words in both languages', () {
      const reasons = [
        PhoneRefusalReason.phoneInvalid,
        PhoneRefusalReason.needsCountryCode,
        PhoneRefusalReason.trackingNotFound,
        PhoneRefusalReason.noPhoneOnRecord,
        PhoneRefusalReason.rateLimited,
        PhoneRefusalReason.whatsappUnavailable,
        PhoneRefusalReason.signInRequired,
        PhoneRefusalReason.codeWrong,
        PhoneRefusalReason.codeExpired,
        PhoneRefusalReason.tooManyAttempts,
        PhoneRefusalReason.challengeNotFound,
        PhoneRefusalReason.phoneInUse,
        PhoneRefusalReason.wrongAccount,
        PhoneRefusalReason.proofInvalid,
        PhoneRefusalReason.noVerifiedPhone,
        PhoneRefusalReason.recordInvalid,
      ];
      for (final locale in const [Locale('en'), Locale('fr')]) {
        final l10n = lookupAppLocalizations(locale);
        final texts = <String>{};
        for (final reason in reasons) {
          final text = phoneAccountRefusalText(
            l10n,
            PhoneAccountRefusal(code: 'failed-precondition', reason: reason),
          );
          expect(text, isNot(l10n.phaErrGeneric), reason: reason);
          texts.add(text);
        }
        expect(texts, hasLength(reasons.length), reason: '$locale');
      }
    });

    test('a wrong code counts the tries left; a wait reads in s or min', () {
      final en = lookupAppLocalizations(const Locale('en'));
      expect(
        phoneAccountRefusalText(
          en,
          const PhoneAccountRefusal(
            code: 'invalid-argument',
            reason: PhoneRefusalReason.codeWrong,
            attemptsLeft: 2,
          ),
        ),
        "That code isn't right. 2 tries left.",
      );
      expect(phoneRateLimitText(en, 25), contains('25 s'));
      expect(phoneRateLimitText(en, 600), contains('10 minutes'));
      expect(phoneRateLimitText(en, 0), en.phaErrRateLimited);
      final fr = lookupAppLocalizations(const Locale('fr'));
      expect(phoneRateLimitText(fr, 25), contains('Réessayez dans 25 s'));
    });

    test('no reason falls back by code, never to the server message', () {
      final en = lookupAppLocalizations(const Locale('en'));
      expect(
        phoneAccountRefusalText(
          en,
          const PhoneAccountRefusal(code: 'unavailable'),
        ),
        en.phaErrOffline,
      );
      expect(
        phoneAccountRefusalText(
          en,
          const PhoneAccountRefusal(code: 'unauthenticated'),
        ),
        en.phaErrAppCheck,
      );
      expect(phoneAccountErrorText(en, StateError('boom')), en.phaErrGeneric);
    });
  });

  group('the code flow on the wire', () {
    test('payloads name the action and nothing else', () {
      expect(const TypedPhoneCodeRequest(' +224620000035 ').toPayload(), {
        'action': 'requestPhoneLoginCode',
        'phone': '+224620000035',
      });
      expect(
        const TrackingPhoneCodeRequest(
          trackingCode: 'cl-k7m4p2',
          role: 'receiver',
        ).toPayload(),
        {
          'action': 'requestPhoneLoginCode',
          'trackingCode': 'CL-K7M4P2',
          'role': 'receiver',
        },
      );
      expect(const LinkPhoneCodeRequest('+17185550100').toPayload(), {
        'action': 'requestPhoneLoginCode',
        'phone': '+17185550100',
        'purpose': 'link',
      });
      expect(verifyCodePayload('ab', '123456'), {
        'action': 'verifyPhoneLoginCode',
        'challengeId': 'ab',
        'code': '123456',
      });
      expect(completeSignInPayload(), {'action': 'completePhoneSignIn'});
      expect(completeSignInPayload(placeholderIdToken: 'tok'), {
        'action': 'completePhoneSignIn',
        'placeholderIdToken': 'tok',
      });
      expect(reportNotMinePayload(key: 'containerLines/l1', role: 'x'), {
        'action': 'reportShipmentNotMine',
        'key': 'containerLines/l1',
        'role': 'sender',
      });
      expect(
        myShipmentsPayload(
          cursor: const MyShipmentsCursor(beforeMs: 9, skipKeys: ['a/b']),
        ),
        {
          'action': 'getMyShipments',
          'cursor': {
            'beforeMs': 9,
            'skipKeys': ['a/b'],
          },
        },
      );
    });

    test('a challenge reads with a 30 s resend by default', () {
      final challenge = PhoneLoginChallenge.fromCallable(<Object?, Object?>{
        'challengeId': 'c1',
        'channel': 'whatsapp',
        'lastTwo': '35',
        'expiresAtMs': 5,
      })!;
      expect(challenge.lastTwo, '35');
      expect(challenge.resendAfterSeconds, 30);
      expect(PhoneLoginChallenge.fromCallable({'lastTwo': '35'}), isNull);
    });

    test('verify answers read as a sign-in or a link', () {
      final signIn = PhoneCodeVerified.fromCallable({
        'customToken': 't',
        'uid': 'u',
        'isNewAccount': true,
      });
      expect(signIn.signsIn, isTrue);
      final link = PhoneCodeVerified.fromCallable({
        'linked': true,
        'merged': true,
      });
      expect(link.signsIn, isFalse);
      expect(link.merged, isTrue);
    });

    test('six digits make a code', () {
      expect(isCompleteLoginCode('123456'), isTrue);
      expect(isCompleteLoginCode('12345'), isFalse);
      expect(isCompleteLoginCode('12345a'), isFalse);
    });
  });

  group('My packages', () {
    test('an item reads the projection, never a price', () {
      final item = _parsed(
        _item(
          'containerLines/l1',
          shipping: <Object?, Object?>{
            'shippingLine': 'Maersk',
            'containerNumber': 'MSKU1234567',
          },
        )..['payment'] = {'priceCents': 9900},
      );
      expect(item.serviceType, GuestTrackingServiceType.container);
      expect(item.stageValue, GuestTrackingStage.inTransit);
      expect(item.shipping?.shippingLine, 'Maersk');
      expect(item.pieceCount, 3);
      expect(item.createdAt, isNotNull);
      final request = _parsed(
        _item(
          'packageRequests/r1',
          service: 'package_request',
          stage: 'requested',
        )..['requestStatus'] = 'new',
      );
      expect(request.isPackageRequest, isTrue);
      expect(request.serviceType, isNull);
      expect(request.stageValue, isNull);
      expect(request.requestStatus, 'new');
      expect(MyShipmentItem.fromCallable({'key': 'nokey'}), isNull);
    });

    test('a page carries its cursor; none means the end', () {
      final page = MyShipmentsPage.fromCallable(<Object?, Object?>{
        'phoneLastTwo': '35',
        'items': [
          _item('containerLines/a'),
          {'bad': true},
        ],
        'nextCursor': <Object?, Object?>{
          'beforeMs': 900,
          'skipKeys': ['containerLines/a'],
        },
      });
      expect(page.items, hasLength(1));
      expect(page.hasMore, isTrue);
      expect(page.nextCursor!.skipKeys, ['containerLines/a']);
      expect(
        MyShipmentsPage.fromCallable({'items': [], 'nextCursor': null}).hasMore,
        isFalse,
      );
    });

    test(
      'grouped by business, a business placed by its newest item, newest first',
      () {
        final items = [
          _parsed(_item('containerLines/a1', createdAtMs: 100)),
          _parsed(
            _item(
              'barrelShipments/b1',
              businessId: 'biz-b',
              businessName: 'Dakar Freight',
              createdAtMs: 300,
            ),
          ),
          _parsed(_item('containerLines/a2', createdAtMs: 200)),
          _parsed(
            _item('containerLines/a3', role: 'receiver', createdAtMs: 50),
          ),
          _parsed(
            _item(
              'freightShipments/c1',
              role: 'receiver',
              businessId: 'biz-c',
              businessName: 'Bamako Cargo',
              createdAtMs: 400,
            ),
          ),
        ];
        final sections = groupMyShipments(items);
        expect(sections.mine.map((g) => g.businessId), ['biz-b', 'biz-a']);
        expect(sections.mine.last.items.map((i) => i.key), [
          'containerLines/a2',
          'containerLines/a1',
        ]);
        expect(sections.comingToYou.map((g) => g.businessName), [
          'Bamako Cargo',
          'Conakry Express',
        ]);
        expect(groupMyShipments(const []).isEmpty, isTrue);
      },
    );

    test('sent to oneself stays in My packages and says both', () {
      final self = _parsed(
        _item('containerLines/s', roles: ['sender', 'receiver']),
      );
      expect(self.sentToSelf, isTrue);
      final sections = groupMyShipments([self]);
      expect(sections.mine.single.items.single.key, 'containerLines/s');
      expect(sections.comingToYou, isEmpty);
    });

    test('a later page adds only records not shown yet', () {
      final first = [_parsed(_item('a/1')), _parsed(_item('a/2'))];
      final merged = appendShipmentPage(first, [
        _parsed(_item('a/2')),
        _parsed(_item('a/3')),
      ]);
      expect(merged.map((i) => i.key), ['a/1', 'a/2', 'a/3']);
    });
  });

  group('the tracking page hints', () {
    test('a role and two digits each; anything else is dropped', () {
      final hints = TrackingSignInHint.listFrom([
        {'role': 'sender', 'lastTwo': '35'},
        {'role': 'receiver', 'lastTwo': '12'},
        {'role': 'receiver', 'lastTwo': '99'},
        {'role': 'owner', 'lastTwo': '11'},
        {'role': 'sender', 'lastTwo': '+224620000035'},
        'junk',
      ]);
      expect(hints.map((h) => '${h.role}:${h.lastTwo}'), [
        'sender:35',
        'receiver:12',
      ]);
      expect(hintsNameTheRole(hints), isTrue);
      expect(hintsNameTheRole(hints.take(1).toList()), isFalse);
      expect(TrackingSignInHint.listFrom(null), isEmpty);
    });

    test('the guest record reads them (absent on an older server)', () {
      final record = GuestTrackingRecord.fromMap({
        'trackingCode': 'CL-K7M4P2',
        'service': 'container',
        'stage': 'booked',
        'signIn': [
          {'role': 'sender', 'lastTwo': '35'},
        ],
      });
      expect(record.signIn.single.lastTwo, '35');
      final older = GuestTrackingRecord.fromMap({
        'trackingCode': 'BS-K7M4P2',
        'service': 'barrel',
        'stage': 'booked',
      });
      expect(older.signIn, isEmpty);
    });

    test('button words: the number alone, or with its role', () {
      final en = lookupAppLocalizations(const Locale('en'));
      const sender = TrackingSignInHint(role: 'sender', lastTwo: '35');
      const receiver = TrackingSignInHint(role: 'receiver', lastTwo: '12');
      expect(
        trackingSignInHintLabel(en, sender, nameTheRole: false),
        'Sign in as the number ending in ••35',
      );
      expect(
        trackingSignInHintLabel(en, receiver, nameTheRole: true),
        'Sign in as the receiver (••12)',
      );
      final fr = lookupAppLocalizations(const Locale('fr'));
      expect(
        trackingSignInHintLabel(fr, sender, nameTheRole: true),
        contains('expéditeur'),
      );
    });
  });

  group('staff warnings on a record\'s phones', () {
    test('a line reads both lists; absent is empty', () {
      final line = ContainerLine.fromMap('l1', {
        'businessId': 'biz-a',
        'customerPhone': '6200000035',
        'receiverPhone': '+224620000012',
        'phoneCountryCodeMissing': ['customerPhone', 'nonsense'],
        'phoneReportedNotMine': ['receiverPhone'],
      });
      expect(line.phoneCountryCodeMissing, ['customerPhone']);
      expect(
        line.phoneFlags(RecordPhoneField.customer).needsCountryCode,
        isTrue,
      );
      expect(
        line.phoneFlags(RecordPhoneField.customer).reportedNotMine,
        isFalse,
      );
      expect(
        line.phoneFlags(RecordPhoneField.receiver).reportedNotMine,
        isTrue,
      );
      final plain = ContainerLine.fromMap('l2', {'businessId': 'biz-a'});
      expect(plain.phoneCountryCodeMissing, isEmpty);
      expect(plain.phoneReportedNotMine, isEmpty);
      expect(plain.phoneFlags(RecordPhoneField.customer).any, isFalse);
    });

    test('a parking entry is read off its raw fields', () {
      final flags = recordPhoneFlagsOf({
        'phoneCountryCodeMissing': 'customerPhone',
        'phoneReportedNotMine': ['customerPhone'],
      }, RecordPhoneField.customer);
      expect(flags.needsCountryCode, isFalse, reason: 'not a list');
      expect(flags.reportedNotMine, isTrue);
    });
  });

  group('resend countdown', () {
    test('counts down to zero and says when it ends', () {
      final countdown = ResendCountdown()..start(3);
      expect(countdown.waiting, isTrue);
      expect(countdown.tick(), isFalse);
      expect(countdown.tick(), isFalse);
      expect(countdown.tick(), isTrue);
      expect(countdown.waiting, isFalse);
      expect(countdown.tick(), isFalse);
      countdown
        ..start(5)
        ..clear();
      expect(countdown.secondsLeft, 0);
      expect((ResendCountdown()..start(-4)).waiting, isFalse);
    });
  });

  group('PhoneAccountService', () {
    test('one callable, the action in the payload', () async {
      final calls = <(String, Map<String, Object?>)>[];
      final service = PhoneAccountService(
        caller: (name, payload) async {
          calls.add((name, payload));
          return <Object?, Object?>{
            'challengeId': 'c9',
            'lastTwo': '35',
            'resendAfterMs': 30000,
          };
        },
      );
      final challenge = await service.requestCode(
        const TypedPhoneCodeRequest('+224620000035'),
      );
      expect(challenge.challengeId, 'c9');
      expect(calls.single.$1, 'phoneAccount');
      expect(calls.single.$2['action'], 'requestPhoneLoginCode');
    });

    test('a refusal arrives as its reason', () async {
      final service = PhoneAccountService(
        caller: (name, payload) async => throw FirebaseFunctionsException(
          code: 'failed-precondition',
          message: 'WhatsApp codes are not available. Send a text instead.',
          details: {'reason': 'whatsapp_unavailable'},
        ),
      );
      await expectLater(
        service.requestCode(const TypedPhoneCodeRequest('+224620000035')),
        throwsA(
          isA<PhoneAccountFailure>().having(
            (f) => f.reason,
            'reason',
            PhoneRefusalReason.whatsappUnavailable,
          ),
        ),
      );
    });

    test('an answer with no challenge is a failure, not a crash', () async {
      final service = PhoneAccountService(caller: (_, _) async => null);
      await expectLater(
        service.requestCode(const TypedPhoneCodeRequest('+224620000035')),
        throwsA(isA<PhoneAccountFailure>()),
      );
    });
  });
}
