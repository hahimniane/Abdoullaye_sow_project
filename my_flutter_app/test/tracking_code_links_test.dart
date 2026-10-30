import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/package_codes.dart';

/// Every Laawol tracking code opens the app's tracking page from a tapped
/// link (the "Track" button in a WhatsApp update), not only container-line
/// `CL-` package codes. The prefixes and alphabet are the server's.
void main() {
  Uri link(String path) => Uri.parse('https://customer.laawoldigital.com$path');

  group('parity with the server', () {
    test('the prefixes are the ones lookupGuestTracking routes', () {
      final source = File('functions/guest_tracking.js').readAsStringSync();
      final block = RegExp(
        r'GUEST_TRACKING_COLLECTIONS = Object\.freeze\(\[(.*?)\]\);',
        dotAll: true,
      ).firstMatch(source);
      expect(block, isNotNull, reason: 'the server list moved or was renamed');
      final server = RegExp(r'prefix:\s*"([A-Z]{2})"')
          .allMatches(block!.group(1)!)
          .map((m) => m.group(1)!)
          .toList();
      expect(server, isNotEmpty);
      expect(laawolTrackingPrefixes.toSet(), server.toSet());
      expect(
        laawolTrackingPrefixes.length,
        server.length,
        reason: 'no prefix listed twice',
      );
    });

    test("the alphabet and code length are the server's", () {
      final source = File('functions/tracking_code.js').readAsStringSync();
      final alphabet = RegExp(
        r'TRACKING_ALPHABET = "([^"]+)"',
      ).firstMatch(source);
      expect(alphabet?.group(1), packageTrackingAlphabet);
      expect(RegExp(r'TRACKING_CODE_LENGTH = 6;').hasMatch(source), isTrue);
    });
  });

  group('trackingCodeFromLink', () {
    test('a parked car link (the WhatsApp Track button) is readable', () {
      expect(trackingCodeFromLink(link('/t/PK-2KF3H9')), 'PK-2KF3H9');
      expect(trackingCodeFromLink(link('/t/pk-2kf3h9')), 'PK-2KF3H9');
      expect(trackingCodeFromLink(link('/t/PK2KF3H9')), 'PK-2KF3H9');
      expect(
        trackingCodeFromLink(link('/?service=tracking&code=PK-2KF3H9')),
        'PK-2KF3H9',
      );
      expect(trackingCodeFromLink(link('/t/PK-2KF3H9?utm=wa')), 'PK-2KF3H9');
    });

    test('every prefix the server routes is readable', () {
      for (final prefix in laawolTrackingPrefixes) {
        expect(
          trackingCodeFromLink(link('/t/$prefix-K7M4P2')),
          '$prefix-K7M4P2',
          reason: prefix,
        );
        expect(
          trackingCodeFromLink(link('/?service=tracking&code=$prefix-K7M4P2')),
          '$prefix-K7M4P2',
          reason: prefix,
        );
      }
    });

    test('package codes, split parts included, read exactly as before', () {
      expect(trackingCodeFromLink(link('/t/CL-K7M4P2')), 'CL-K7M4P2');
      expect(trackingCodeFromLink(link('/t/CL-K7M4P2-2')), 'CL-K7M4P2-2');
      expect(trackingCodeFromLink(link('/t/cl-k7m4p2-12')), 'CL-K7M4P2-12');
      expect(packageCodeFromLink(link('/t/CL-K7M4P2')), 'CL-K7M4P2');
      expect(packageCodeFromLink(link('/t/CL-K7M4P2-2')), 'CL-K7M4P2-2');
      // Only a package is a "package code": the staff view is CL-only.
      expect(packageCodeFromLink(link('/t/PK-2KF3H9')), isNull);
      expect(packageCodeFromLink(link('/t/BS-K7M4P2')), isNull);
      expect(isPackageTrackingCode('CL-K7M4P2-2'), isTrue);
      expect(isPackageTrackingCode('PK-2KF3H9'), isFalse);
    });

    test('only a split package has parts', () {
      expect(trackingCodeFromLink(link('/t/PK-2KF3H9-2')), isNull);
    });

    test('garbage is null', () {
      for (final path in [
        '/t/',
        '/t',
        '/t/garbage',
        '/t/PK-2KF3H',
        '/t/PK-2KF3H90', // a zero is not in the alphabet
        '/t/PK-2KF3HA9', // neither is a vowel
        '/t/XX-2KF3H9', // not a Laawol prefix
        '/pay/return',
        '/?service=tracking&code=nope',
        '/',
      ]) {
        expect(trackingCodeFromLink(link(path)), isNull, reason: path);
      }
      expect(trackingCodeFromLink(null), isNull);
    });

    test('another site, another scheme, another host are not ours', () {
      expect(
        trackingCodeFromLink(Uri.parse('https://example.com/t/PK-2KF3H9')),
        isNull,
      );
      expect(
        trackingCodeFromLink(
          Uri.parse('https://business.laawoldigital.com/t/PK-2KF3H9'),
        ),
        isNull,
      );
      expect(trackingCodeFromLink(Uri.parse('laawol://t/PK-2KF3H9')), isNull);
    });
  });

  group('trackingCodeFromScan', () {
    test('reads typed codes and pasted links of every prefix', () {
      expect(trackingCodeFromScan('pk 2kf3h9'), 'PK-2KF3H9');
      expect(trackingCodeFromScan(' BS-K7M4P2 '), 'BS-K7M4P2');
      expect(
        trackingCodeFromScan('customer.laawoldigital.com/t/FR-K7M4P2'),
        'FR-K7M4P2',
      );
      expect(trackingCodeFromScan('https://evil.example/t/PK-2KF3H9'), isNull);
      expect(trackingCodeFromScan(''), isNull);
      expect(trackingCodeFromScan(null), isNull);
    });

    test('the package scan still wants a package code', () {
      expect(packageCodeFromScan('PK-2KF3H9'), isNull);
      expect(packageCodeFromScan('CL-K7M4P2'), 'CL-K7M4P2');
    });
  });

  group('isTrackingLinkAttempt', () {
    test('a tracking link is one even when its code is damaged', () {
      expect(isTrackingLinkAttempt(link('/t/garbage')), isTrue);
      expect(isTrackingLinkAttempt(link('/t/')), isTrue);
      expect(isTrackingLinkAttempt(link('/t/PK-2KF3H9')), isTrue);
      expect(isTrackingLinkAttempt(link('/?service=tracking&code=x')), isTrue);
    });

    test('other pages and other hosts are not', () {
      expect(isTrackingLinkAttempt(link('/pay/return')), isFalse);
      expect(isTrackingLinkAttempt(link('/i/IT-K7M4P2')), isFalse);
      expect(isTrackingLinkAttempt(link('/')), isFalse);
      expect(
        isTrackingLinkAttempt(Uri.parse('https://example.com/t/x')),
        isFalse,
      );
      expect(isTrackingLinkAttempt(null), isFalse);
    });
  });
}
