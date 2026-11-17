import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../utils/business_permissions.dart';

class _PermissionOption {
  const _PermissionOption(this.key, this.icon, this.label);

  final String key;
  final IconData icon;
  final String Function(AppLocalizations l10n) label;
}

// No Freight chip: that permission only opens the old freight records now
// (Freight folded into Send a package), so it is no longer granted. Staff who
// already hold it keep it.
final _permissionOptions = <_PermissionOption>[
  _PermissionOption(
    BusinessPermission.profile,
    Icons.storefront_outlined,
    (l10n) => l10n.profile,
  ),
  _PermissionOption(
    BusinessPermission.listings,
    Icons.directions_car_outlined,
    (l10n) => l10n.listings,
  ),
  _PermissionOption(
    BusinessPermission.purchases,
    Icons.receipt_long_outlined,
    (l10n) => l10n.purchases,
  ),
  _PermissionOption(
    BusinessPermission.barrels,
    Icons.inventory_2_outlined,
    (l10n) => l10n.barrels,
  ),
  _PermissionOption(
    BusinessPermission.transport,
    Icons.local_shipping_outlined,
    (l10n) => l10n.transport,
  ),
  _PermissionOption(
    BusinessPermission.parking,
    Icons.local_parking_outlined,
    (l10n) => l10n.parking,
  ),
  _PermissionOption(
    BusinessPermission.ledger,
    Icons.menu_book_outlined,
    (l10n) => l10n.lotLedgerTitle,
  ),
  _PermissionOption(
    BusinessPermission.invoices,
    Icons.request_quote_outlined,
    (l10n) => l10n.invPermissionLabel,
  ),
  _PermissionOption(
    BusinessPermission.containers,
    Icons.view_in_ar_outlined,
    (l10n) => l10n.ctrTitle,
  ),
  _PermissionOption(
    BusinessPermission.deliveries,
    Icons.how_to_reg_outlined,
    (l10n) => l10n.dlvTitle,
  ),
  _PermissionOption(
    BusinessPermission.inventory,
    Icons.qr_code_scanner,
    (l10n) => l10n.inventoryTitle,
  ),
  _PermissionOption(
    BusinessPermission.destinations,
    Icons.public_outlined,
    (l10n) => l10n.destinations,
  ),
  _PermissionOption(
    BusinessPermission.people,
    Icons.people_outline,
    (l10n) => l10n.people,
  ),
  _PermissionOption(
    BusinessPermission.reviews,
    Icons.star_outline,
    (l10n) => l10n.reviews,
  ),
  _PermissionOption(
    BusinessPermission.support,
    Icons.support_agent_outlined,
    (l10n) => l10n.support,
  ),
  _PermissionOption(
    BusinessPermission.growth,
    Icons.auto_awesome_outlined,
    (l10n) => l10n.growth,
  ),
];

/// The permissions a staff member can be given, in the order the invite
/// form and the team list offer them.
List<String> get staffPermissionKeys => [
  for (final option in _permissionOptions) option.key,
];

/// The permission chips the invite form uses, shared by the team list's
/// "edit permissions" so a person is offered exactly the same choices.
/// [selected] is what is ticked; [onToggle] hears each tap. A permission
/// the person holds that is no longer offered (the retired Freight) is not
/// a chip: whoever saves keeps it (see `editedPermissions`).
class StaffPermissionChips extends StatelessWidget {
  const StaffPermissionChips({
    super.key,
    required this.selected,
    required this.onToggle,
    this.enabled = true,
  });

  final Set<String> selected;
  final void Function(String permission, bool on) onToggle;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Wrap(
      spacing: 7,
      runSpacing: 7,
      children: [
        for (final permission in _permissionOptions)
          FilterChip(
            key: Key('permission-chip:${permission.key}'),
            selected: selected.contains(permission.key),
            avatar: Icon(permission.icon, size: 17),
            label: Text(permission.label(l10n)),
            onSelected: enabled ? (on) => onToggle(permission.key, on) : null,
          ),
      ],
    );
  }
}
