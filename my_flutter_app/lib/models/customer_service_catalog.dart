import 'package:flutter/material.dart';

/// A customer-facing service that can be opened from the hub and pinned to the
/// bottom navbar.
class CustomerService {
  const CustomerService({
    required this.id,
    required this.label,
    required this.icon,
    required this.route,
  });

  final String id;
  final String label;
  final IconData icon;
  final String route;
}

const customerServiceCatalog = <CustomerService>[
  CustomerService(
    id: 'cars',
    label: 'Cars',
    icon: Icons.directions_car_outlined,
    route: '/sell',
  ),
  CustomerService(
    id: 'barrel',
    label: 'Send barrels',
    icon: Icons.local_shipping_outlined,
    route: '/barrel',
  ),
  CustomerService(
    id: 'shared',
    label: 'Shared barrels',
    icon: Icons.group_add_outlined,
    route: '/open-barrels',
  ),
  CustomerService(
    id: 'freight',
    label: 'Freight',
    icon: Icons.inventory_2_outlined,
    route: '/send-freight',
  ),
  CustomerService(
    id: 'park',
    label: 'Park a car',
    icon: Icons.local_parking_outlined,
    route: '/park',
  ),
  CustomerService(
    id: 'transport',
    label: 'Transport',
    icon: Icons.car_rental_outlined,
    route: '/request-transport',
  ),
  CustomerService(
    id: 'purchases',
    label: 'Purchases',
    icon: Icons.receipt_long_outlined,
    route: '/my-purchases',
  ),
  CustomerService(
    id: 'tracking',
    label: 'Tracking',
    icon: Icons.route_outlined,
    route: '/tracking',
  ),
  CustomerService(
    id: 'wallet',
    label: 'Wallet',
    icon: Icons.account_balance_wallet_outlined,
    route: '/wallet',
  ),
];

const defaultPinnedServiceIds = <String>['cars', 'barrel', 'tracking'];
const maxPinnedServices = 3;

CustomerService? serviceById(String id) {
  for (final service in customerServiceCatalog) {
    if (service.id == id) return service;
  }
  return null;
}
