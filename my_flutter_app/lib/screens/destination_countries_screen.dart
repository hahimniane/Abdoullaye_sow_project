import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../data/country_catalog.dart';
import '../l10n/app_localizations.dart';
import '../models/destination_country.dart';
import '../services/barrel_pricing_service.dart';
import '../widgets/language_toggle.dart';

class DestinationCountriesScreen extends StatefulWidget {
  const DestinationCountriesScreen({super.key});

  @override
  State<DestinationCountriesScreen> createState() =>
      _DestinationCountriesScreenState();
}

class _DestinationCountriesScreenState
    extends State<DestinationCountriesScreen> {
  final _searchController = TextEditingController();
  String _searchQuery = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _seed(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    try {
      await FirebaseFunctions.instance
          .httpsCallable('seedDestinationCountries')
          .call();
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(l10n.countriesSeeded)));
    } catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(_friendlyError(l10n, error))));
    }
  }

  String _friendlyError(AppLocalizations l10n, Object error) {
    if (error is FirebaseException) {
      return l10n.operationFailed(error.message ?? error.code);
    }
    return l10n.operationFailed(error);
  }

  bool _isPermissionDenied(Object? error) {
    return error is FirebaseException && error.code == 'permission-denied';
  }

  String _permissionMessage() {
    return 'Firebase denied access. Deploy the local Firestore rules and functions, then seed the country catalog.';
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
    final priceControllers = {
      for (final entry in latest.boroughPrices.entries)
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
                  for (final entry in priceControllers.entries) ...[
                    TextFormField(
                      controller: entry.value,
                      decoration: InputDecoration(
                        labelText: '${entry.key} pickup price',
                        prefixText: r'$',
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
          boroughPrices: {
            for (final entry in priceControllers.entries)
              entry.key: double.parse(entry.value.text.trim()),
          },
        ),
      );
    }

    officeController.dispose();
    for (final controller in priceControllers.values) {
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

  List<Widget> _actions(BuildContext context, AppLocalizations l10n) {
    return [
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
    ];
  }

  Widget _searchField() {
    return TextField(
      controller: _searchController,
      textInputAction: TextInputAction.search,
      decoration: const InputDecoration(
        prefixIcon: Icon(Icons.search),
        hintText: 'Search countries, codes, or flags',
      ),
      onChanged: (value) => setState(() => _searchQuery = value.trim()),
    );
  }

  Widget _stateMessage(BuildContext context, Widget child) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 96),
      child: Center(child: child),
    );
  }

  List<Widget> _countryContent(
    BuildContext context,
    AsyncSnapshot<QuerySnapshot> snapshot,
    AppLocalizations l10n,
  ) {
    if (snapshot.hasError) {
      if (_isPermissionDenied(snapshot.error)) {
        return [
          _stateMessage(
            context,
            Text(_permissionMessage(), textAlign: TextAlign.center),
          ),
          ..._countryTiles(
            context,
            _orderedCountries(_filterCountries(CountryCatalog.all)),
            canEdit: false,
          ),
        ];
      }
      return [
        _stateMessage(
          context,
          Text(
            _friendlyError(l10n, snapshot.error ?? ''),
            textAlign: TextAlign.center,
          ),
        ),
      ];
    }

    if (!snapshot.hasData) {
      return [_stateMessage(context, const CircularProgressIndicator())];
    }

    final countries = snapshot.data!.docs
        .map(DestinationCountry.fromFirestore)
        .toList();
    final filteredCountries = _orderedCountries(_filterCountries(countries));

    if (countries.isEmpty) {
      return [
        _stateMessage(
          context,
          const Text(
            'Seed the full country catalog, then search and activate the destinations you serve.',
            textAlign: TextAlign.center,
          ),
        ),
      ];
    }

    if (filteredCountries.isEmpty) {
      return [
        _stateMessage(
          context,
          Text(l10n.noResultsFound, textAlign: TextAlign.center),
        ),
      ];
    }

    return _countryTiles(context, filteredCountries, canEdit: true);
  }

  List<DestinationCountry> _filterCountries(
    List<DestinationCountry> countries,
  ) {
    final query = _searchQuery.toLowerCase();
    if (query.isEmpty) return countries;
    return countries.where((country) {
      final code = country.code?.toLowerCase() ?? '';
      return country.name.toLowerCase().contains(query) ||
          code.contains(query) ||
          country.flagEmoji.contains(_searchQuery);
    }).toList();
  }

  List<DestinationCountry> _orderedCountries(
    List<DestinationCountry> countries,
  ) {
    return [...countries]..sort((a, b) {
      if (a.isActive != b.isActive) return a.isActive ? -1 : 1;
      final order = a.sortOrder.compareTo(b.sortOrder);
      return order != 0 ? order : a.name.compareTo(b.name);
    });
  }

  List<Widget> _countryTiles(
    BuildContext context,
    List<DestinationCountry> countries, {
    required bool canEdit,
  }) {
    final l10n = AppLocalizations.of(context)!;
    return [
      for (final country in countries)
        Card(
          child: ListTile(
            leading: Text(
              country.flagEmoji,
              style: const TextStyle(fontSize: 28),
            ),
            title: Text(country.name),
            subtitle: Text(
              [
                if (country.displayCode.isNotEmpty) country.displayCode,
                'Barrel: \$${country.barrelShippingPrice.toStringAsFixed(0)}',
              ].whereType<String>().join(' • '),
            ),
            trailing: Switch(
              value: country.isActive,
              onChanged: canEdit
                  ? (value) async {
                      try {
                        await FirebaseFirestore.instance
                            .collection('destinationCountries')
                            .doc(country.id)
                            .update({'isActive': value});
                      } catch (error) {
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text(_friendlyError(l10n, error))),
                        );
                      }
                    }
                  : null,
            ),
            onTap: canEdit ? () => _showForm(context, country: country) : null,
          ),
        ),
    ];
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
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              ..._actions(context, l10n),
              const SizedBox(height: 12),
              _searchField(),
              const SizedBox(height: 12),
              ..._countryContent(context, snapshot, l10n),
            ],
          );
        },
      ),
    );
  }
}
