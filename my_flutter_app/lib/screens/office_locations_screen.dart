import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/office_location.dart';
import '../services/office_location_service.dart';
import '../theme/app_colors.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/language_toggle.dart';

/// Lets a business owner/staff manage every physical location customers can
/// choose when "bringing an item to office" — a business can have more than
/// one branch, so this is a real add/edit/pause list rather than a single
/// address field.
class OfficeLocationsScreen extends StatefulWidget {
  const OfficeLocationsScreen({super.key, required this.businessId});

  final String businessId;

  @override
  State<OfficeLocationsScreen> createState() => _OfficeLocationsScreenState();
}

class _OfficeLocationsScreenState extends State<OfficeLocationsScreen> {
  final _service = OfficeLocationService();
  bool _busy = false;

  Future<void> _showForm(BuildContext context, {OfficeLocation? location}) async {
    final l10n = AppLocalizations.of(context)!;
    final labelController = TextEditingController(text: location?.label ?? '');
    final addressController = TextEditingController(
      text: location?.address ?? '',
    );
    final formKey = GlobalKey<FormState>();

    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 20,
          bottom: MediaQuery.of(context).viewInsets.bottom + 20,
        ),
        child: Form(
          key: formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  location == null
                      ? l10n.addOfficeLocation
                      : l10n.editOfficeLocation,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  l10n.officeLocationHelp,
                  style: const TextStyle(
                    color: AppColors.muted,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: labelController,
                  decoration: InputDecoration(labelText: l10n.locationName),
                  validator: (value) => value == null || value.trim().isEmpty
                      ? l10n.requiredField
                      : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: addressController,
                  decoration: InputDecoration(labelText: l10n.address),
                  maxLines: 2,
                  validator: (value) => value == null || value.trim().isEmpty
                      ? l10n.requiredField
                      : null,
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () {
                    if (!formKey.currentState!.validate()) return;
                    Navigator.pop(context, true);
                  },
                  child: Text(l10n.save),
                ),
              ],
            ),
          ),
        ),
      ),
    );

    try {
      if (result != true) return;
      if (!context.mounted) return;
      setState(() => _busy = true);
      await _service.saveLocation(
        businessId: widget.businessId,
        locationId: location?.id,
        label: labelController.text.trim(),
        address: addressController.text.trim(),
        sortOrder: location?.sortOrder ?? DateTime.now().millisecondsSinceEpoch,
      );
      if (!context.mounted) return;
      showSuccessSnackBar(context, l10n.recordUpdated);
    } catch (error) {
      if (!context.mounted) return;
      showErrorSnackBar(context, l10n.operationFailed(error));
    } finally {
      if (mounted) setState(() => _busy = false);
      labelController.dispose();
      addressController.dispose();
    }
  }

  Future<void> _toggleActive(OfficeLocation location) async {
    final l10n = AppLocalizations.of(context)!;
    setState(() => _busy = true);
    try {
      await _service.setActive(
        businessId: widget.businessId,
        locationId: location.id,
        isActive: !location.isActive,
      );
      if (!mounted) return;
      showSuccessSnackBar(context, l10n.recordUpdated);
    } catch (error) {
      if (!mounted) return;
      showErrorSnackBar(context, l10n.operationFailed(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.officeLocations),
        actions: const [LanguageToggle()],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _busy ? null : () => _showForm(context),
        icon: const Icon(Icons.add),
        label: Text(l10n.addOfficeLocation),
      ),
      body: Stack(
        children: [
          StreamBuilder<List<OfficeLocation>>(
            stream: _service.allLocations(widget.businessId),
            builder: (context, snapshot) {
              if (!snapshot.hasData) {
                return const Center(child: CircularProgressIndicator());
              }
              final locations = snapshot.data!;
              if (locations.isEmpty) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      l10n.addOfficeLocationsHelp,
                      textAlign: TextAlign.center,
                    ),
                  ),
                );
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: locations.length,
                itemBuilder: (context, index) {
                  final location = locations[index];
                  return Card(
                    child: ListTile(
                      leading: Icon(
                        Icons.storefront_outlined,
                        color: location.isActive
                            ? AppColors.cobaltDeep
                            : AppColors.muted,
                      ),
                      title: Text(location.label),
                      subtitle: Text(location.address),
                      trailing: Wrap(
                        spacing: 4,
                        children: [
                          IconButton(
                            icon: const Icon(Icons.edit_outlined),
                            onPressed: _busy
                                ? null
                                : () => _showForm(context, location: location),
                          ),
                          IconButton(
                            icon: Icon(
                              location.isActive
                                  ? Icons.visibility_off_outlined
                                  : Icons.visibility_outlined,
                            ),
                            onPressed: _busy
                                ? null
                                : () => _toggleActive(location),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              );
            },
          ),
          if (_busy)
            const Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: LinearProgressIndicator(minHeight: 3),
            ),
        ],
      ),
    );
  }
}
