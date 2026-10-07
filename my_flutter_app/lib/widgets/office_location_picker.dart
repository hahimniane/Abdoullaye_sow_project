import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/office_location.dart';
import '../services/office_location_service.dart';
import '../theme/app_colors.dart';
import '../utils/drop_off_address.dart';

/// A business can register more than one physical office/drop-off location,
/// so this shows a plain address tile when there's only one (or none
/// configured, falling back to the business's own address), and a picker
/// when the customer needs to choose among several. Shared by every
/// "bring to office" flow (barrel, freight) so they behave identically, and
/// matching the web customer console's PickupFields.
///
/// The head office is shown only once the business's active office
/// locations have been read and there are none. While they load the tile
/// says so, and a failed read offers Retry: showing the head office in
/// either case told customers it was the only place to drop off.
class OfficeLocationPicker extends StatefulWidget {
  const OfficeLocationPicker({
    super.key,
    required this.businessId,
    required this.fallbackAddress,
    required this.selectedLocationId,
    required this.onChanged,
    this.service,
  });

  final String businessId;
  final String fallbackAddress;
  final String selectedLocationId;
  final ValueChanged<String> onChanged;

  /// Where the locations come from; tests pass a double.
  final OfficeLocationService? service;

  @override
  State<OfficeLocationPicker> createState() => _OfficeLocationPickerState();
}

class _OfficeLocationPickerState extends State<OfficeLocationPicker> {
  // Held in State, keyed by the business: building the stream in build()
  // re-subscribed on every parent rebuild (and every selection).
  late Stream<List<OfficeLocation>> _locations;
  // Bumped by Retry so the builder starts over (and shows loading) instead
  // of keeping the failed snapshot while the new read runs.
  int _attempt = 0;

  @override
  void initState() {
    super.initState();
    _subscribe();
  }

  void _retry() {
    setState(() {
      _attempt += 1;
      _subscribe();
    });
  }

  @override
  void didUpdateWidget(covariant OfficeLocationPicker oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.businessId != widget.businessId ||
        oldWidget.service != widget.service) {
      _subscribe();
    }
  }

  void _subscribe() {
    _locations = (widget.service ?? OfficeLocationService()).activeLocations(
      widget.businessId,
    );
  }

  @override
  Widget build(BuildContext context) {
    final businessId = widget.businessId;
    final fallbackAddress = widget.fallbackAddress;
    final selectedLocationId = widget.selectedLocationId;
    final onChanged = widget.onChanged;
    return StreamBuilder<List<OfficeLocation>>(
      key: ValueKey('$businessId#$_attempt'),
      stream: _locations,
      builder: (context, snapshot) {
        final l10n = AppLocalizations.of(context)!;
        if (snapshot.hasError) {
          return _OfficeLocationsProblem(
            message: l10n.dropOffLocationsLoadFailed,
            onRetry: _retry,
          );
        }
        if (!snapshot.hasData) {
          return _OfficeLocationsProblem(message: l10n.dropOffLocationsLoading);
        }
        final locations = snapshot.data!;
        if (locations.length <= 1) {
          return OfficeDropOffTile(
            address: resolveOfficeDropOffAddress(
              officeAddress: locations.isNotEmpty
                  ? locations.first.address
                  : null,
              fallbackAddress: fallbackAddress,
              genericLabel: l10n.dropOffOffice,
            ),
          );
        }
        final effectiveSelection = OfficeLocation.resolveSelectedId(
          locations,
          selectedLocationId,
        );
        if (effectiveSelection != selectedLocationId) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) onChanged(effectiveSelection);
          });
        }
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

/// The drop-off tile while the locations load (spinner) or after the read
/// failed (Retry) - never the head office, which is only right once the
/// business is known to have no other location.
class _OfficeLocationsProblem extends StatelessWidget {
  const _OfficeLocationsProblem({required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final failed = onRetry != null;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
      decoration: BoxDecoration(
        color: AppColors.lightSurfaceVariant,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        children: [
          if (failed)
            const Icon(Icons.error_outline, color: AppColors.muted)
          else
            const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: AppColors.muted,
                fontWeight: FontWeight.w600,
                height: 1.3,
              ),
            ),
          ),
          if (failed)
            TextButton(
              onPressed: onRetry,
              child: Text(AppLocalizations.of(context)!.retry),
            ),
        ],
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
