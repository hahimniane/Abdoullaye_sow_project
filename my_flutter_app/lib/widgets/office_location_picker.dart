import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/office_location.dart';
import '../services/office_location_service.dart';
import '../theme/app_colors.dart';

/// A business can register more than one physical office/drop-off location,
/// so this shows a plain address tile when there's only one (or none
/// configured, falling back to the business's own address), and a picker
/// when the customer needs to choose among several. Shared by every
/// "bring to office" flow (barrel, freight) so they behave identically.
class OfficeLocationPicker extends StatelessWidget {
  const OfficeLocationPicker({
    super.key,
    required this.businessId,
    required this.fallbackAddress,
    required this.selectedLocationId,
    required this.onChanged,
  });

  final String businessId;
  final String fallbackAddress;
  final String selectedLocationId;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<OfficeLocation>>(
      stream: OfficeLocationService().activeLocations(businessId),
      builder: (context, snapshot) {
        final locations = snapshot.data ?? const <OfficeLocation>[];
        if (locations.length <= 1) {
          return OfficeDropOffTile(
            address: locations.isNotEmpty
                ? locations.first.address
                : (fallbackAddress.isNotEmpty
                      ? fallbackAddress
                      : AppLocalizations.of(context)!.dropOffOffice),
          );
        }
        final validSelection = locations.any(
          (location) => location.id == selectedLocationId,
        );
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!validSelection) onChanged(locations.first.id);
        });
        return DropdownButtonFormField<String>(
          decoration: InputDecoration(
            labelText: AppLocalizations.of(context)!.chooseALocation,
            prefixIcon: const Icon(Icons.storefront_outlined),
          ),
          initialValue: validSelection ? selectedLocationId : null,
          items: locations
              .map(
                (location) => DropdownMenuItem(
                  value: location.id,
                  child: Text(
                    '${location.label} — ${location.address}',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              )
              .toList(),
          onChanged: (value) {
            if (value != null) onChanged(value);
          },
        );
      },
    );
  }
}

class OfficeDropOffTile extends StatelessWidget {
  const OfficeDropOffTile({super.key, required this.address});

  final String address;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.lightSurfaceVariant,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        children: [
          const Icon(Icons.storefront_outlined, color: AppColors.cobaltDeep),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  AppLocalizations.of(context)!.dropOffOffice,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  address,
                  style: const TextStyle(
                    color: AppColors.muted,
                    fontWeight: FontWeight.w600,
                    height: 1.3,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
