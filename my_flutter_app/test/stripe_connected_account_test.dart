import 'dart:io';

import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/payment_flow_safety.dart';

/// A direct-charge PaymentIntent lives on the business's connected account, so
/// the native payment sheet only resolves its client secret while Stripe is
/// scoped to that account. Losing the scope produced a hard payment failure
/// ("The client_secret provided does not match any associated PaymentIntent on
/// this account") that web never hit, because hosted checkout carries the
/// account in its redirect URL instead.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() => Stripe.stripeAccountId = null);

  test('scopes Stripe to the connected account for the whole action', () async {
    String? seenDuringAction;

    await withStripeConnectedAccount('acct_direct_123', () async {
      seenDuringAction = Stripe.stripeAccountId;
    });

    expect(seenDuringAction, 'acct_direct_123');
  });

  test('restores the previous scope after a successful action', () async {
    Stripe.stripeAccountId = null;

    await withStripeConnectedAccount('acct_direct_123', () async {});

    expect(Stripe.stripeAccountId, isNull);
  });

  test('restores the previous scope when the payment sheet throws', () async {
    Stripe.stripeAccountId = null;

    await expectLater(
      withStripeConnectedAccount('acct_direct_123', () async {
        throw StateError('sheet cancelled');
      }),
      throwsStateError,
    );

    // A cancelled direct charge must not leave the connected account applied -
    // the next platform-charge payment in the same session would then look for
    // its intent on the wrong account and fail the same way.
    expect(Stripe.stripeAccountId, isNull);
  });

  test('leaves the scope untouched for a platform-owned intent', () async {
    String? seenDuringAction = 'sentinel';

    await withStripeConnectedAccount('', () async {
      seenDuringAction = Stripe.stripeAccountId;
    });

    expect(seenDuringAction, isNull);
    expect(Stripe.stripeAccountId, isNull);
  });

  test('treats a whitespace-only account id as platform-owned', () async {
    String? seenDuringAction = 'sentinel';

    await withStripeConnectedAccount('   ', () async {
      seenDuringAction = Stripe.stripeAccountId;
    });

    expect(seenDuringAction, isNull);
  });

  test('every payment sheet in lib/services is account-scoped', () {
    final services = Directory('lib/services')
        .listSync()
        .whereType<File>()
        .where((file) => file.path.endsWith('.dart'));

    final unscoped = <String>[];
    for (final service in services) {
      final source = service.readAsStringSync();
      final sheets =
          'Stripe.instance.initPaymentSheet('.allMatches(source).length;
      if (sheets == 0) continue;
      final scopes = 'withStripeConnectedAccount('.allMatches(source).length;
      if (scopes < sheets) {
        unscoped.add('${service.path}: $sheets sheet(s), $scopes scope(s)');
      }
    }

    expect(
      unscoped,
      isEmpty,
      reason:
          'Every initPaymentSheet must run inside withStripeConnectedAccount so '
          'a direct charge confirms against the account that owns it. Pass the '
          "server's stripeConnectedAccountId (empty string for a platform "
          'charge).',
    );
  });
}
