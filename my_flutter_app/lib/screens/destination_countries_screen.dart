import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/destination_country.dart';
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
          'isActive': isActive,
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
    nameController.dispose();
    codeController.dispose();
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
              for (final country in countries)
                Card(
                  child: ListTile(
                    title: Text(country.name),
                    subtitle: Text(country.code ?? ''),
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
