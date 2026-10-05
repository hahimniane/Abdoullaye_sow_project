import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/package_codes.dart';

/// The rules behind scanning a package: what counts as a package code, which
/// links the app claims, how people on a line are called, where a tapped
/// link lands, and what the label request carries.
void main() {
  group('packageCodeFromScan', () {
    test('reads a code however it was typed', () {
      for (final raw in [
        'CL-K7M4P2',
        'cl-k7m4p2',
        'cl k7m4p2',
        'CLK7M4P2',
        '  clk7m4p2  ',
        'CL K7M4 P2',
        'CL_K7M4P2',
      ]) {
        expect(packageCodeFromScan(raw), 'CL-K7M4P2', reason: raw);
      }
    });

    test('reads the code out of the label link, old and new', () {
      for (final raw in [
        'https://customer.laawoldigital.com/t/CL-K7M4P2',
        'https://customer.laawoldigital.com/t/cl-k7m4p2/',
        'http://customer.laawoldigital.com/t/CLK7M4P2',
        'customer.laawoldigital.com/t/CL-K7M4P2',
        'https://CUSTOMER.LAAWOLDIGITAL.COM/t/CL-K7M4P2',
        'https://customer.laawoldigital.com/?service=tracking&code=CL-K7M4P2',
        'https://customer.laawoldigital.com/?code=cl-k7m4p2&service=tracking',
        'customer.laawoldigital.com?service=tracking&code=CL-K7M4P2',
      ]) {
        expect(packageCodeFromScan(raw), 'CL-K7M4P2', reason: raw);
      }
    });

    test('refuses what is not one of our package codes', () {
      for (final raw in [
        null,
        '',
        '   ',
        // Wrong prefix: barrels and freight have their own pages.
        'BS-K7M4P2',
        'FR-K7M4P2',
        // Outside the alphabet: zero, one, O, I, L and vowels never appear.
        'CL-K7M4P0',
        'CL-K7M4P1',
        'CL-K7MOP2',
        'CL-K7MAP2',
        // Wrong length.
        'CL-K7M4P',
        'CL-K7M4P2X',
        // Someone else's QR, even with a code-shaped path.
        'https://example.com/t/CL-K7M4P2',
        'https://laawoldigital.com.evil.com/t/CL-K7M4P2',
        'example.com/t/CL-K7M4P2',
        // Our host, but not a tracking link.
        'https://customer.laawoldigital.com/',
        'https://customer.laawoldigital.com/pay/return?session=CL-K7M4P2',
        // A VIN.
        '1HGCM82633A004352',
      ]) {
        expect(packageCodeFromScan(raw), isNull, reason: '$raw');
      }
    });

    test('is idempotent: its output reads back as itself', () {
      final once = packageCodeFromScan('cl k7m4p2')!;
      expect(packageCodeFromScan(once), once);
    });
  });

  group('packageCodeFromLink', () {
    test('claims only the label host and the tracking path', () {
      expect(
        packageCodeFromLink(
            Uri.parse('https://customer.laawoldigital.com/t/CL-K7M4P2')),
        'CL-K7M4P2',
      );
      expect(
        packageCodeFromLink(Uri.parse(
            'https://customer.laawoldigital.com/?service=tracking&code=CL-K7M4P2')),
        'CL-K7M4P2',
      );
      expect(packageCodeFromLink(null), isNull);
      expect(
        packageCodeFromLink(Uri.parse('https://business.laawoldigital.com/t/CL-K7M4P2')),
        isNull,
      );
      expect(
        packageCodeFromLink(Uri.parse('laawol://t/CL-K7M4P2')),
        isNull,
      );
      expect(
        packageCodeFromLink(Uri.parse('https://customer.laawoldigital.com/t/BS-K7M4P2')),
        isNull,
      );
    });
  });

  group('calling and messaging', () {
    test('tel: keeps the + and the digits', () {
      expect(packagePhoneCallUri('+224 621 23 45 67').toString(),
          'tel:+224621234567');
      expect(packagePhoneCallUri('(917) 555-1234').toString(), 'tel:9175551234');
      expect(packagePhoneCallUri(''), isNull);
      expect(packagePhoneCallUri('12'), isNull);
    });

    test('WhatsApp needs the full international number', () {
      expect(packageWhatsAppUri('+224 621 23 45 67').toString(),
          'https://wa.me/224621234567');
      expect(packageWhatsAppUri('+1 (917) 555-1234').toString(),
          'https://wa.me/19175551234');
      // No country code: a wa.me link would reach a stranger.
      expect(packageWhatsAppUri('9175551234'), isNull);
      expect(packageWhatsAppUri(''), isNull);
    });
  });

  group('where a tapped link lands', () {
    bool eligible({
      bool signedIn = true,
      bool isAnonymous = false,
      bool dashboard = true,
      bool containers = true,
      String businessId = 'b1',
    }) =>
        packageLinkStaffEligible(
          signedIn: signedIn,
          isAnonymous: isAnonymous,
          hasBusinessDashboardAccess: dashboard,
          hasContainersPermission: containers,
          businessId: businessId,
        );

    test('staff with the containers permission are eligible', () {
      expect(eligible(), isTrue);
    });

    test('everyone else is not', () {
      expect(eligible(signedIn: false), isFalse, reason: 'signed out');
      expect(eligible(isAnonymous: true), isFalse, reason: 'guest session');
      // hasBusinessPermission answers yes for any non-staff account, so a
      // customer passes the permission check and must fail this one.
      expect(eligible(dashboard: false), isFalse, reason: 'customer');
      expect(eligible(containers: false), isFalse, reason: 'no permission');
      expect(eligible(businessId: ''), isFalse, reason: 'no business');
      expect(eligible(businessId: '  '), isFalse, reason: 'blank business');
    });

    test('the staff view only when their business holds the line', () {
      expect(
        packageLinkDestination(staffEligible: true, lineInBusiness: true),
        PackageLinkDestination.staffPackage,
      );
      expect(
        packageLinkDestination(staffEligible: true, lineInBusiness: false),
        PackageLinkDestination.guestTracking,
        reason: "another business's label",
      );
      expect(
        packageLinkDestination(staffEligible: false, lineInBusiness: true),
        PackageLinkDestination.guestTracking,
      );
      expect(
        packageLinkDestination(staffEligible: false, lineInBusiness: false),
        PackageLinkDestination.guestTracking,
      );
    });
  });

  group('label request', () {
    test('a whole container asks for labels with the chosen paper and copies',
        () {
      expect(
        containerLabelsRequest(
          businessId: 'b1',
          containerId: 'c1',
          choice: const LabelPrintChoice(format: labelFormatThermal, copies: 1),
        ),
        {
          'businessId': 'b1',
          'containerId': 'c1',
          'view': 'labels',
          'format': 'thermal',
          'copies': 1,
        },
      );
    });

    test('one line adds its id; odd values clamp to what the server takes',
        () {
      final request = containerLabelsRequest(
        businessId: 'b1',
        containerId: 'c1',
        lineId: ' l7 ',
        choice: const LabelPrintChoice(format: 'a4', copies: 5),
      );
      expect(request['lineId'], 'l7');
      expect(request['format'], 'sheet');
      expect(request['copies'], 2);
      expect(request['view'], 'labels');
    });

    test('defaults: letter sheet, two per package', () {
      const choice = LabelPrintChoice();
      expect(choice.format, labelFormatSheet);
      expect(choice.copies, 2);
      expect(choice.copyWith(copies: 1),
          const LabelPrintChoice(format: labelFormatSheet, copies: 1));
    });
  });

  group('lastCustomerUpdate', () {
    test('reads the moment, who it reached, and when', () {
      final line = ContainerLine.fromMap('l1', {
        'businessId': 'b1',
        'lastCustomerUpdate': {
          'update': 'shipped',
          'results': [
            {'role': 'sender', 'status': 'sent'},
            {'role': 'receiver', 'status': 'skipped', 'reason': 'needs_country_code'},
            'junk',
            {'role': '', 'status': 'sent'},
          ],
          'atMs': 1790000000000,
        },
      });
      final update = line.lastCustomerUpdate!;
      expect(update.update, containerUpdateShipped);
      expect(update.results, hasLength(2));
      expect(update.results.first.role, containerUpdateRoleSender);
      expect(update.results.first.status, containerUpdateSent);
      expect(update.results.last.reason, 'needs_country_code');
      expect(update.at, DateTime.fromMillisecondsSinceEpoch(1790000000000));
    });

    test('anything malformed reads as no update yet', () {
      for (final value in [null, 'shipped', 3, <String, Object>{}, {'update': ''}]) {
        final line = ContainerLine.fromMap('l1', {'lastCustomerUpdate': value});
        expect(line.lastCustomerUpdate, isNull, reason: '$value');
      }
    });
  });
}
