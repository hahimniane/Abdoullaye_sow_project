import 'package:flutter/material.dart';

enum BusinessServiceKey {
  barrelShipping('barrelShipping'),
  sharedBarrels('sharedBarrels'),
  freight('freight'),
  carSales('carSales'),
  carParking('carParking'),
  carTransport('carTransport');

  const BusinessServiceKey(this.value);

  final String value;

  static BusinessServiceKey? fromValue(String value) {
    for (final service in values) {
      if (service.value == value) return service;
    }
    return null;
  }
}

class BusinessServiceDefinition {
  const BusinessServiceDefinition({
    required this.key,
    required this.label,
    required this.description,
    required this.icon,
  });

  final BusinessServiceKey key;
  final String label;
  final String description;
  final IconData icon;
}

const businessServiceCatalog = <BusinessServiceDefinition>[
  BusinessServiceDefinition(
    key: BusinessServiceKey.barrelShipping,
    label: 'Barrel shipping',
    description: 'Ship barrels to destination countries.',
    icon: Icons.local_shipping_outlined,
  ),
  BusinessServiceDefinition(
    key: BusinessServiceKey.sharedBarrels,
    label: 'Shared barrels',
    description: 'Pool partial barrels and match customers by destination.',
    icon: Icons.group_add_outlined,
  ),
  BusinessServiceDefinition(
    key: BusinessServiceKey.freight,
    label: 'Freight (parcels)',
    description: 'Ship parcels and boxes by weight, by air or sea.',
    icon: Icons.inventory_2_outlined,
  ),
  BusinessServiceDefinition(
    key: BusinessServiceKey.carSales,
    label: 'Car sales',
    description: 'List cars for customers to browse and buy.',
    icon: Icons.directions_car_outlined,
  ),
  BusinessServiceDefinition(
    key: BusinessServiceKey.carParking,
    label: 'Car parking',
    description: 'Manage parked cars and parking receipts.',
    icon: Icons.local_parking_outlined,
  ),
  BusinessServiceDefinition(
    key: BusinessServiceKey.carTransport,
    label: 'Car transport',
    description: 'Track car transport requests.',
    icon: Icons.car_rental_outlined,
  ),
];

const defaultBusinessServiceValues = <String>[
  'barrelShipping',
  'sharedBarrels',
  'freight',
  'carSales',
  'carParking',
  'carTransport',
];

List<String> normalizeBusinessServices(dynamic raw) {
  final values = raw is Iterable
      ? raw.map((item) => item.toString()).toSet()
      : <String>{};
  final normalized = <String>[
    for (final service in businessServiceCatalog)
      if (values.contains(service.key.value)) service.key.value,
  ];
  return normalized.isEmpty
      ? List<String>.from(defaultBusinessServiceValues)
      : normalized;
}

bool hasBusinessService(Iterable<String> services, BusinessServiceKey key) {
  return services.contains(key.value);
}
