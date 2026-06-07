import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/business_profile.dart';
import '../theme/app_colors.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/language_toggle.dart';

class BusinessManagementScreen extends StatelessWidget {
  const BusinessManagementScreen({super.key});

  Future<void> _runMigration(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    try {
      final result = await FirebaseFunctions.instance
          .httpsCallable('migrateDefaultBusiness')
          .call<Map<String, dynamic>>();
      if (!context.mounted) return;
      final writes = result.data['writes'] ?? 0;
      showSuccessSnackBar(context, l10n.migrationComplete(writes));
    } catch (error) {
      if (!context.mounted) return;
      showErrorSnackBar(context, l10n.migrationFailed(error));
    }
  }

  Future<void> _showBusinessForm(
    BuildContext context, {
    BusinessProfile? business,
  }) async {
    final l10n = AppLocalizations.of(context)!;
    final nameController = TextEditingController(text: business?.name ?? '');
    final phoneController = TextEditingController(text: business?.phone ?? '');
    final emailController = TextEditingController(text: business?.email ?? '');
    final noteController = TextEditingController(
      text: business?.serviceNote ?? '',
    );
    var status = business?.status ?? 'pending';
    final formKey = GlobalKey<FormState>();

    final shouldSave = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) {
        return StatefulBuilder(
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
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        business == null ? l10n.addBusiness : l10n.editBusiness,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: nameController,
                        decoration: InputDecoration(labelText: l10n.nameLabel),
                        validator: (value) =>
                            value == null || value.trim().isEmpty
                            ? l10n.businessNameRequired
                            : null,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: phoneController,
                        decoration: InputDecoration(labelText: l10n.phone),
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: emailController,
                        decoration: InputDecoration(labelText: l10n.email),
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: noteController,
                        decoration: InputDecoration(
                          labelText: l10n.serviceNote,
                        ),
                        minLines: 2,
                        maxLines: 4,
                      ),
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String>(
                        initialValue: status,
                        decoration: InputDecoration(labelText: l10n.status),
                        items: [
                          DropdownMenuItem(
                            value: 'pending',
                            child: Text(l10n.pending),
                          ),
                          DropdownMenuItem(
                            value: 'approved',
                            child: Text(l10n.approved),
                          ),
                          DropdownMenuItem(
                            value: 'suspended',
                            child: Text(l10n.suspended),
                          ),
                        ],
                        onChanged: (value) {
                          if (value != null) {
                            setModalState(() => status = value);
                          }
                        },
                      ),
                      const SizedBox(height: 18),
                      FilledButton(
                        onPressed: () {
                          if (!formKey.currentState!.validate()) return;
                          Navigator.pop(context, true);
                        },
                        child: Text(l10n.saveBusiness),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );

    if (shouldSave == true) {
      try {
        final id = business?.id ?? _slug(nameController.text);
        final firestore = FirebaseFirestore.instance;
        final data = {
          'name': nameController.text.trim(),
          'phone': phoneController.text.trim(),
          'email': emailController.text.trim(),
          'serviceNote': noteController.text.trim(),
          'status': status,
          if (business == null) 'createdAt': FieldValue.serverTimestamp(),
          'updatedAt': FieldValue.serverTimestamp(),
        };
        await firestore
            .collection('businesses')
            .doc(id)
            .set(data, SetOptions(merge: true));

        final cars = await firestore
            .collection('cars')
            .where('businessId', isEqualTo: id)
            .get();
        final destinations = await firestore
            .collection('businesses')
            .doc(id)
            .collection('destinationCountries')
            .get();
        final batch = firestore.batch();
        for (final doc in cars.docs) {
          batch.update(doc.reference, {
            'businessName': data['name'],
            'businessStatus': status,
            'updatedAt': FieldValue.serverTimestamp(),
          });
        }
        for (final doc in destinations.docs) {
          batch.update(doc.reference, {
            'businessName': data['name'],
            'businessPhone': data['phone'],
            'businessEmail': data['email'],
            'serviceNote': data['serviceNote'],
            'businessStatus': status,
            'updatedAt': FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
        if (context.mounted) {
          showSuccessSnackBar(context, l10n.businessProfileSaved);
        }
      } catch (error) {
        if (context.mounted) {
          showErrorSnackBar(context, l10n.operationFailed(error));
        }
      }
    }

    nameController.dispose();
    phoneController.dispose();
    emailController.dispose();
    noteController.dispose();
  }

  String _slug(String value) {
    final slug = value
        .trim()
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9]+'), '_')
        .replaceAll(RegExp(r'^_+|_+$'), '');
    return slug.isEmpty
        ? 'business_${DateTime.now().millisecondsSinceEpoch}'
        : slug;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: AppBar(
        title: Text(l10n.businesses),
        actions: const [LanguageToggle()],
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('businesses')
            .orderBy('name')
            .snapshots(),
        builder: (context, snapshot) {
          final businesses =
              snapshot.data?.docs.map(BusinessProfile.fromFirestore).toList() ??
              <BusinessProfile>[];
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              OutlinedButton.icon(
                onPressed: () => _runMigration(context),
                icon: const Icon(Icons.sync),
                label: Text(l10n.migrateKerenData),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: () => _showBusinessForm(context),
                icon: const Icon(Icons.add_business),
                label: Text(l10n.addBusiness),
              ),
              const SizedBox(height: 16),
              if (!snapshot.hasData)
                const Center(child: CircularProgressIndicator())
              else if (businesses.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 72),
                  child: Text(
                    l10n.businessesEmpty,
                    textAlign: TextAlign.center,
                  ),
                )
              else
                for (final business in businesses)
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.storefront_outlined),
                      title: Text(business.name),
                      subtitle: Text(
                        [
                          business.status,
                          if ((business.phone ?? '').isNotEmpty) business.phone,
                          if ((business.email ?? '').isNotEmpty) business.email,
                        ].whereType<String>().join(' • '),
                      ),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () =>
                          _showBusinessForm(context, business: business),
                    ),
                  ),
            ],
          );
        },
      ),
    );
  }
}
