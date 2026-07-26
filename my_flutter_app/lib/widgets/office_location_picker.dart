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
        final l10n = AppLocalizations.of(context)!;
        final effectiveSelection = validSelection
            ? selectedLocationId
            : locations.first.id;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                l10n.locationsAvailableChooseOne(locations.length),
                style: const TextStyle(
                  color: AppColors.cobaltDeep,
                  fontWeight: FontWeight.w800,
                  fontSize: 13,
                ),
              ),
            ),
            for (final location in locations)
              _OfficeLocationChoice(
                location: location,
                selected: location.id == effectiveSelection,
                onTap: () => onChanged(location.id),
              ),
          ],
        );
      },
    );
  }
}

class _OfficeLocationChoice extends StatelessWidget {
  const _OfficeLocationChoice({
    required this.location,
    required this.selected,
    required this.onTap,
  });

  final OfficeLocation location;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        borderRadius: BorderRadius.circular(9),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.mist.withValues(alpha: 0.35)
                : AppColors.lightSurfaceVariant,
            borderRadius: BorderRadius.circular(9),
            border: Border.all(
              color: selected ? AppColors.cobalt : AppColors.rule,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Icon(
                selected
                    ? Icons.radio_button_checked
                    : Icons.radio_button_off,
                color: selected ? AppColors.cobaltDeep : AppColors.muted,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      location.label,
                      style: const TextStyle(
                        color: AppColors.ink,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      location.address,
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
        ),
      ),
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
