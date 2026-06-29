import 'business_destination_option.dart';
import 'destination_country.dart';
import 'barrel_shipment.dart';

class BarrelOrderLine {
  const BarrelOrderLine({
    required this.country,
    required this.business,
    required this.receiverName,
    required this.receiverPhone,
    this.receiverPhoneIsWhatsappOnly = false,
    this.quantity = 1,
  });

  final DestinationCountry country;
  final BusinessDestinationOption business;
  final String receiverName;
  final String receiverPhone;
  final bool receiverPhoneIsWhatsappOnly;
  final int quantity;

  double get unitShippingFee => country.barrelShippingPrice;
  double get shippingFee => unitShippingFee * quantity;

  Map<String, dynamic> toCallableJson() {
    return {
      'destinationCountryId': country.id,
      'businessId': business.businessId,
      'receiverName': receiverName,
      'receiverPhone': receiverPhone,
      'quantity': quantity,
    };
  }
}

class BarrelOrderResult {
  const BarrelOrderResult({
    required this.orderId,
    required this.shipments,
    required this.trackingCodes,
  });

  final String orderId;
  final List<BarrelShipment> shipments;
  final List<String> trackingCodes;
}
