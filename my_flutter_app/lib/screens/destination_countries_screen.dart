import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/destination_country.dart';
import '../services/barrel_pricing_service.dart';
import '../widgets/language_toggle.dart';

class DestinationCountriesScreen extends StatelessWidget {
  const DestinationCountriesScreen({super.key});

  Future<void> _seed(BuildContext context) async {
    await FirebaseFunctions.instance
        .httpsCallable('seedDestinationCountries')
        .call();
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(AppLocalizations.of(context)!.countriesSeeded)),
    );
  }

  Future<void> _showForm(
    BuildContext context, {
    DestinationCountry? country,
  }) async {
    final l10n = AppLocalizations.of(context)!;
    final nameController = TextEditingController(text: country?.name ?? '');
    final codeController = TextEditingController(text: country?.code ?? '');
    final barrelPriceController = TextEditingController(
      text: (country?.barrelShippingPrice ?? 0) == 0
          ? ''
          : country!.barrelShippingPrice.toStringAsFixed(0),
    );
    var isActive = country?.isActive ?? true;
    final formKey = GlobalKey<FormState>();
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setModalState) {
          return Padding(
            padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 20,
              bottom: MediaQuery.of(context).viewInsets.bottom + 20,
            ),
            child: Form(
              key: formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextFormField(
                    controller: nameController,
                    decoration: InputDecoration(labelText: l10n.countryName),
                    validator: (value) => value == null || value.trim().isEmpty
                        ? l10n.requiredField
                        : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: codeController,
                    decoration: InputDecoration(labelText: l10n.countryCode),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: barrelPriceController,
                    decoration: const InputDecoration(
                      labelText: 'Barrel shipping price',
                      prefixText: r'$',
                    ),
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    validator: (value) {
                      final trimmed = value?.trim() ?? '';
                      if (trimmed.isEmpty) return null;
                      return double.tryParse(trimmed) == null
                          ? l10n.pleaseEnterValidNumber
                          : null;
                    },
                  ),
                  SwitchListTile(
                    value: isActive,
                    onChanged: (value) => setModalState(() => isActive = value),
                    title: Text(l10n.active),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () async {
                      if (!formKey.currentState!.validate()) return;
                      Navigator.pop(context, true);
                    },
                    child: Text(l10n.save),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
    if (result != true) return;
    final id =
        country?.id ??
        nameController.text
            .trim()
            .toLowerCase()
            .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
            .replaceAll(RegExp(r'^-|-$'), '');
    await FirebaseFirestore.instance
        .collection('destinationCountries')
        .doc(id)
        .set({
          'name': nameController.text.trim(),
          'code': codeController.text.trim(),
          'barrelShippingPrice':
              double.tryParse(barrelPriceController.text.trim()) ?? 0,
          'isActive': isActive,
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
    nameController.dispose();
    codeController.dispose();
    barrelPriceController.dispose();
  }

  Future<void> _showPickupPricingForm(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    final service = BarrelPricingService();
    final latest = await service.pickupPricing().first;
    if (!context.mounted) return;
    final officeController = TextEditingController(text: latest.officeAddress);
    final baseController = TextEditingController(
      text: latest.basePickupFee.toStringAsFixed(0),
    );
    final perMileController = TextEditingController(
      text: latest.perMileFee.toStringAsFixed(2),
    );
    final minimumController = TextEditingController(
      text: latest.minimumPickupFee.toStringAsFixed(0),
    );
    final mileControllers = {
      for (final entry in latest.boroughMiles.entries)
        entry.key: TextEditingController(text: entry.value.toStringAsFixed(0)),
    };
    final formKey = GlobalKey<FormState>();

    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) {
        return Padding(
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
                children: [
                  const Text(
                    'Barrel pickup pricing',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: officeController,
                    decoration: const InputDecoration(
                      labelText: 'Office address',
                    ),
                    validator: (value) => value == null || value.trim().isEmpty
                        ? l10n.requiredField
                        : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: baseController,
                    decoration: const InputDecoration(
                      labelText: 'Base pickup fee',
                      prefixText: r'$',
                    ),
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    validator: _numberValidator(l10n),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: perMileController,
                    decoration: const InputDecoration(
                      labelText: 'Per mile fee',
                      prefixText: r'$',
                    ),
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    validator: _numberValidator(l10n),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: minimumController,
                    decoration: const InputDecoration(
                      labelText: 'Minimum pickup fee',
                      prefixText: r'$',
                    ),
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    validator: _numberValidator(l10n),
                  ),
                  const SizedBox(height: 16),
                  for (final entry in mileControllers.entries) ...[
                    TextFormField(
                      controller: entry.value,
                      decoration: InputDecoration(
                        labelText: '${entry.key} miles to office',
                      ),
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      validator: _numberValidator(l10n),
                    ),
                    const SizedBox(height: 12),
                  ],
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
        );
      },
    );

    if (result == true) {
      await service.savePickupPricing(
        BarrelPickupPricing(
          officeAddress: officeController.text.trim(),
          basePickupFee: double.parse(baseController.text.trim()),
          perMileFee: double.parse(perMileController.text.trim()),
          minimumPickupFee: double.parse(minimumController.text.trim()),
          boroughMiles: {
            for (final entry in mileControllers.entries)
              entry.key: double.parse(entry.value.text.trim()),
          },
        ),
      );
    }

    officeController.dispose();
    baseController.dispose();
    perMileController.dispose();
    minimumController.dispose();
    for (final controller in mileControllers.values) {
      controller.dispose();
    }
  }

  String? Function(String?) _numberValidator(AppLocalizations l10n) {
    return (value) {
      if (value == null || value.trim().isEmpty) return l10n.requiredField;
      return double.tryParse(value.trim()) == null
          ? l10n.pleaseEnterValidNumber
          : null;
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.destinationCountries),
        actions: const [LanguageToggle()],
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('destinationCountries')
            .snapshots(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final countries =
              snapshot.data!.docs.map(DestinationCountry.fromFirestore).toList()
                ..sort((a, b) => a.name.compareTo(b.name));
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              OutlinedButton.icon(
                onPressed: () => _seed(context),
                icon: const Icon(Icons.public),
                label: Text(l10n.seedDefaultCountries),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () => _showPickupPricingForm(context),
                icon: const Icon(Icons.local_shipping),
                label: const Text('Barrel pickup pricing'),
              ),
              const SizedBox(height: 12),
              for (final country in countries)
                Card(
                  child: ListTile(
                    title: Text(country.name),
                    subtitle: Text(
                      [
                        if ((country.code ?? '').isNotEmpty) country.code,
                        'Barrel: \$${country.barrelShippingPrice.toStringAsFixed(0)}',
                      ].whereType<String>().join(' • '),
                    ),
                    trailing: Switch(
                      value: country.isActive,
                      onChanged: (value) {
                        FirebaseFirestore.instance
                            .collection('destinationCountries')
                            .doc(country.id)
                            .update({'isActive': value});
                      },
                    ),
                    onTap: () => _showForm(context, country: country),
                  ),
                ),
            ],
          );
        },
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showForm(context),
        child: const Icon(Icons.add),
      ),
    );
  }
}
