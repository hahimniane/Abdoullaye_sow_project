import 'package:cloud_functions/cloud_functions.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/barrel_shipment.dart';
import 'guest_checkout_service.dart';

/// An abandoned pay-now booking the customer can reopen.
class CheckoutResumeTarget {
  const CheckoutResumeTarget({required this.orderType, required this.recordId});

  final String orderType;
  final String recordId;
}

const _settledPayment = {
  'succeeded',
  'paid',
  'completed',
  'reserved',
  'card_saved',
};

/// Mirrors `admin_web/src/lib/customer-checkout.ts` `checkoutResumeTarget`.
///
/// A barrel with `orderId` must resume the order: siblings share one
/// PaymentIntent, and minting a second barrelOrder is the live bug.
CheckoutResumeTarget? checkoutResumeTarget(Map<String, dynamic> record) {
  final status = (record['status'] ?? '').toString().toLowerCase();
  final payment = (record['paymentStatus'] ?? '').toString().toLowerCase();
  final checkout = (record['checkoutStatus'] ?? '').toString().toLowerCase();
  if (_settledPayment.contains(payment) || checkout == 'completed') {
    return null;
  }
  if (status == 'cancelled' || payment == 'cancelled') return null;
  if (status != 'pending_payment' && payment != 'pending') return null;
  if ((record['paymentTiming'] ?? '').toString() == 'arrival') return null;

  final collection = (record['relatedCollection'] ?? record['collectionName'] ?? '')
      .toString();
  final id = (record['id'] ?? '').toString().trim();
  final orderId = (record['orderId'] ?? '').toString().trim();

  if (collection == 'barrelShipments' || collection == 'barrelOrders') {
    if (orderId.isNotEmpty) {
      return CheckoutResumeTarget(orderType: 'barrelOrder', recordId: orderId);
    }
    if (collection == 'barrelOrders' && id.isNotEmpty) {
      return CheckoutResumeTarget(orderType: 'barrelOrder', recordId: id);
    }
    if (id.isNotEmpty) {
      return CheckoutResumeTarget(orderType: 'barrelShipment', recordId: id);
    }
  }
  if (collection == 'freightShipments' && id.isNotEmpty) {
    return CheckoutResumeTarget(orderType: 'freightShipment', recordId: id);
  }
  if (collection == 'transportRequests' && id.isNotEmpty) {
    return CheckoutResumeTarget(orderType: 'transportJob', recordId: id);
  }
  return null;
}

CheckoutResumeTarget? barrelCheckoutResumeTarget(BarrelShipment shipment) {
  return checkoutResumeTarget(shipment.checkoutResumeRecord);
}

Map<String, String> checkoutResumePayload(CheckoutResumeTarget target) {
  if (target.orderType == 'transportJob') {
    return {'requestId': target.recordId};
  }
  return {'resumeRecordId': target.recordId};
}

bool isStripeCheckoutUrl(Uri uri) {
  if (uri.scheme != 'https') return false;
  return uri.host == 'checkout.stripe.com' ||
      uri.host.endsWith('.stripe.com');
}

/// Starts hosted Checkout for an existing unpaid record. Never mints a
/// new barrelOrder / shipment.
class CustomerCheckoutService {
  CustomerCheckoutService({
    FirebaseFunctions? functions,
    Future<bool> Function(Uri url)? urlLauncher,
  }) : _functions = functions ?? FirebaseFunctions.instance,
       _urlLauncher =
           urlLauncher ??
           ((url) => launchUrl(url, mode: LaunchMode.externalApplication));

  final FirebaseFunctions _functions;
  final Future<bool> Function(Uri url) _urlLauncher;

  Future<void> resumeCheckout(CheckoutResumeTarget target) async {
    final response = await _functions
        .httpsCallable('createCustomerCheckoutSession')
        .call({
          'orderType': target.orderType,
          'payload': {
            ...guestCheckout.payloadFields(),
            ...checkoutResumePayload(target),
          },
        });
    final data = response.data;
    if (data is! Map) {
      throw StateError('Checkout could not be opened.');
    }
    if (data['simulatedPayment'] == true) return;
    final rawUrl = data['url']?.toString() ?? '';
    final uri = Uri.tryParse(rawUrl);
    if (uri == null || !isStripeCheckoutUrl(uri)) {
      throw StateError('The secure payment page could not be opened.');
    }
    final opened = await _urlLauncher(uri);
    if (!opened) {
      throw StateError('The secure payment page could not be opened.');
    }
  }
}
