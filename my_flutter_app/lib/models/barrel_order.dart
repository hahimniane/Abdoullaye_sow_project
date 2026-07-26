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
    this.pickupRequested = true,
    this.pickupAddress = '',
    this.pickupBorough = '',
    this.pickupFee = 0,
    this.pickupDateTime,
    this.hasPickupOverride = false,
    this.officeLocationId = '',
  });

  final DestinationCountry country;
  final BusinessDestinationOption business;
  final String receiverName;
  final String receiverPhone;
  final bool receiverPhoneIsWhatsappOnly;
  final int quantity;
  final bool pickupRequested;
  final String pickupAddress;
  final String pickupBorough;
  final double pickupFee;
  final DateTime? pickupDateTime;
  final bool hasPickupOverride;
  // Which of the business's office locations to drop off at, when this
  // line isn't using courier pickup.
  final String officeLocationId;

  double get unitShippingFee => country.barrelShippingPrice;
  double get shippingFee => unitShippingFee * quantity;
  double get lineTotal => shippingFee + pickupFee;

  BarrelOrderLine copyWith({String? officeLocationId}) {
    return BarrelOrderLine(
      country: country,
      business: business,
      receiverName: receiverName,
      receiverPhone: receiverPhone,
      receiverPhoneIsWhatsappOnly: receiverPhoneIsWhatsappOnly,
      quantity: quantity,
      pickupRequested: pickupRequested,
      pickupAddress: pickupAddress,
      pickupBorough: pickupBorough,
      pickupFee: pickupFee,
      pickupDateTime: pickupDateTime,
      hasPickupOverride: hasPickupOverride,
      officeLocationId: officeLocationId ?? this.officeLocationId,
    );
  }

  Map<String, dynamic> toCallableJson() {
    return {
      'destinationCountryId': country.id,
      'businessId': business.businessId,
      'receiverName': receiverName,
      'receiverPhone': receiverPhone,
      'quantity': quantity,
      if (officeLocationId.isNotEmpty) 'officeLocationId': officeLocationId,
      if (hasPickupOverride) ...{
        'pickupRequested': pickupRequested,
        'pickupAddress': pickupAddress,
        'pickupBorough': pickupBorough,
        if (pickupDateTime != null)
          'pickupDateTime': pickupDateTime!.toUtc().toIso8601String(),
      },
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
