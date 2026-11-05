import 'package:flutter/material.dart';

enum BusinessServiceKey {
  barrelShipping('barrelShipping'),
  sharedBarrels('sharedBarrels'),
  freight('freight'),
  carSales('carSales'),
  carParking('carParking'),
  carTransport('carTransport'),
  inventory('inventory');

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
    label: 'Freight (retired)',
    description: 'Retired: parcels now go through Send a package.',
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
  BusinessServiceDefinition(
    key: BusinessServiceKey.inventory,
    label: 'Inventory',
    description: 'Keep a product list, print tags, and sell by scanning.',
    icon: Icons.qr_code_scanner,
  ),
];

/// What a new business gets. Freight is not here any more: it folded into
/// Send a package (docs/PACKAGE_PRICE_LIST.md decision 12), so nothing offers
/// it by default. A business that already has it keeps it in its stored
/// `enabledServices` (see [retiredBusinessServiceKeys]).
const defaultBusinessServiceValues = <String>[
  'barrelShipping',
  'sharedBarrels',
  'carSales',
  'carParking',
  'carTransport',
];

List<String> normalizeBusinessServices(dynamic raw) {
  if (raw == null) return List<String>.from(defaultBusinessServiceValues);
  if (raw is! Iterable) return const <String>[];
  final values = raw.map((item) => item.toString()).toSet();
  return <String>[
    for (final service in businessServiceCatalog)
      if (values.contains(service.key.value)) service.key.value,
  ];
}

bool hasBusinessService(Iterable<String> services, BusinessServiceKey key) {
  return services.contains(key.value);
}

/// Services nobody can switch on any more. They stay in
/// [businessServiceCatalog] and the enum so a business that already has one
/// still parses (`normalizeBusinessServices` keeps it) and its old records
/// stay readable, but no picker offers them.
const retiredBusinessServiceKeys = <BusinessServiceKey>{
  BusinessServiceKey.freight,
};

/// True for a service in [retiredBusinessServiceKeys].
bool isRetiredBusinessService(BusinessServiceKey key) =>
    retiredBusinessServiceKeys.contains(key);

/// The services an owner can tick for their own business. Inventory is left
/// out: a platform admin switches it on, so it never shows as an owner choice
/// (the server also keeps an owner's save from adding or dropping it).
/// Retired services (Freight) are left out too; a business that still has one
/// keeps it, because the screens start from the stored list and only change
/// what the owner ticks.
List<BusinessServiceDefinition> get ownerBusinessServiceCatalog =>
    businessServiceCatalog
        .where(
          (service) =>
              service.key != BusinessServiceKey.inventory &&
              !isRetiredBusinessService(service.key),
        )
        .toList(growable: false);

/// What a platform admin sees in the services list of one business: every
/// live service, plus a retired one only for a business that still has it (as
/// a read-only line, so the admin can see why old freight records exist).
List<BusinessServiceDefinition> adminBusinessServiceCatalog(
  Iterable<String> currentServices,
) {
  final current = currentServices.toSet();
  return businessServiceCatalog
      .where(
        (service) =>
            !isRetiredBusinessService(service.key) ||
            current.contains(service.key.value),
      )
      .toList(growable: false);
}

/// The services that move goods in containers. Containers only make sense for
/// a business that ships: barrels, cars (transport or parking, which load onto
/// a box), or - for a business that still has the retired service - old
/// freight parcels. A shop with only `inventory`, or a
/// business with no services at all, has nothing to put in one.
const shippingBusinessServiceKeys = <BusinessServiceKey>[
  BusinessServiceKey.barrelShipping,
  BusinessServiceKey.freight,
  BusinessServiceKey.carTransport,
  BusinessServiceKey.carParking,
];

/// True when [services] (the business's `enabledServices` values) include any
/// shipping service. Pure: the one rule every Containers entry point shares.
bool businessHasShippingService(Iterable<String> services) {
  final enabled = services.toSet();
  return shippingBusinessServiceKeys.any((key) => enabled.contains(key.value));
}

/// True when [services] (the business's `enabledServices` values) are
/// Inventory and nothing else: a shop that sells at a counter. Such a business
/// has no destinations, cars or shipments to set up, so copy written for those
/// (the full-width "pending approval" banner, "no services are switched on")
/// is wrong for it. Pure: the business home and the staff shell share it.
bool businessIsShopOnly(Iterable<String> services) {
  final enabled = services.toSet();
  if (!enabled.contains(BusinessServiceKey.inventory.value)) return false;
  return businessServiceCatalog.every(
    (service) =>
        service.key == BusinessServiceKey.inventory ||
        !enabled.contains(service.key.value),
  );
}

/// The Containers section is offered only when the business ships something,
/// this person holds the containers permission, and there is a business to
/// look in. Same three-gate shape as `inventoryAvailable`.
bool containersAvailable({
  required Iterable<String> services,
  required bool hasPermission,
  required String businessId,
}) =>
    businessHasShippingService(services) &&
    hasPermission &&
    businessId.trim().isNotEmpty;
