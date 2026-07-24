enum PlatformAccessLevel { none, view, manage }

abstract final class PlatformSection {
  static const people = 'people';
  static const businesses = 'businesses';
  static const marketplace = 'marketplace';
  static const operations = 'operations';
  static const finance = 'finance';
  static const support = 'support';
  static const website = 'website';
}

class PlatformAccess {
  const PlatformAccess({
    required this.role,
    required this.sections,
    required this.services,
  });

  const PlatformAccess.none()
    : role = '',
      sections = const {},
      services = const [];

  const PlatformAccess.superAdmin()
    : role = 'superAdmin',
      sections = const {
        PlatformSection.people: PlatformAccessLevel.manage,
        PlatformSection.businesses: PlatformAccessLevel.manage,
        PlatformSection.marketplace: PlatformAccessLevel.manage,
        PlatformSection.operations: PlatformAccessLevel.manage,
        PlatformSection.finance: PlatformAccessLevel.manage,
        PlatformSection.support: PlatformAccessLevel.manage,
        PlatformSection.website: PlatformAccessLevel.manage,
      },
      services = null;

  final String role;
  final Map<String, PlatformAccessLevel> sections;

  /// `null` means every service. An empty list means no service access.
  final List<String>? services;

  bool canView(String section) {
    final level = sections[section] ?? PlatformAccessLevel.none;
    return level == PlatformAccessLevel.view ||
        level == PlatformAccessLevel.manage;
  }

  bool canManage(String section) =>
      sections[section] == PlatformAccessLevel.manage;

  bool canAccessService(String service) =>
      services == null || services!.contains(service);

  static PlatformAccess resolve({
    required String? role,
    Map<String, dynamic>? permissionsConfig,
  }) {
    final roleKey = role?.trim() ?? '';
    if (roleKey == 'superAdmin') return const PlatformAccess.superAdmin();

    final defaults = _defaultRoles[roleKey];
    final configuredRoles = permissionsConfig?['roles'];
    final configured = configuredRoles is Map ? configuredRoles[roleKey] : null;
    if (defaults == null && configured is! Map) {
      return PlatformAccess(
        role: roleKey,
        sections: const {},
        services: const [],
      );
    }

    final sections = <String, PlatformAccessLevel>{};
    final defaultSections = defaults?['sections'];
    if (defaultSections is Map) {
      for (final entry in defaultSections.entries) {
        sections[entry.key.toString()] = _level(entry.value);
      }
    }
    if (configured is Map && configured['sections'] is Map) {
      for (final entry in (configured['sections'] as Map).entries) {
        sections[entry.key.toString()] = _level(entry.value);
      }
    }

    final configuredServices = configured is Map
        ? configured['services']
        : null;
    final defaultServices = defaults?['services'];
    final rawServices = configuredServices is Iterable
        ? configuredServices
        : defaultServices;
    final services = rawServices is Iterable
        ? rawServices.map((item) => item.toString()).toList(growable: false)
        : const <String>[];

    return PlatformAccess(
      role: roleKey,
      sections: Map.unmodifiable(sections),
      services: List.unmodifiable(services),
    );
  }

  static PlatformAccessLevel _level(Object? value) {
    return switch (value?.toString()) {
      'manage' => PlatformAccessLevel.manage,
      'view' => PlatformAccessLevel.view,
      _ => PlatformAccessLevel.none,
    };
  }

  static const Map<String, Map<String, Object>> _defaultRoles = {
    'operationsManager': {
      'sections': {
        PlatformSection.people: 'view',
        PlatformSection.businesses: 'manage',
        PlatformSection.marketplace: 'manage',
        PlatformSection.operations: 'manage',
        PlatformSection.finance: 'none',
        PlatformSection.support: 'manage',
        PlatformSection.website: 'manage',
      },
      'services': <String>[],
    },
    'financeManager': {
      'sections': {
        PlatformSection.people: 'view',
        PlatformSection.businesses: 'none',
        PlatformSection.marketplace: 'none',
        PlatformSection.operations: 'view',
        PlatformSection.finance: 'manage',
        PlatformSection.support: 'manage',
        PlatformSection.website: 'none',
      },
      'services': <String>[],
    },
    'supportAdmin': {
      'sections': {
        PlatformSection.people: 'view',
        PlatformSection.businesses: 'view',
        PlatformSection.marketplace: 'view',
        PlatformSection.operations: 'view',
        PlatformSection.finance: 'none',
        PlatformSection.support: 'manage',
        PlatformSection.website: 'none',
      },
      'services': <String>[],
    },
    'contentManager': {
      'sections': {
        PlatformSection.people: 'view',
        PlatformSection.businesses: 'view',
        PlatformSection.marketplace: 'none',
        PlatformSection.operations: 'none',
        PlatformSection.finance: 'none',
        PlatformSection.support: 'none',
        PlatformSection.website: 'manage',
      },
      'services': <String>[],
    },
  };
}
