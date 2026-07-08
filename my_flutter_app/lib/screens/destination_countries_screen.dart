import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/country_catalog.dart';
import '../l10n/app_localizations.dart';
import '../models/business_profile.dart';
import '../models/destination_country.dart';
import '../providers/auth_provider.dart';
import '../services/barrel_pricing_service.dart';
import '../theme/app_colors.dart';
import '../widgets/async_action_button.dart';
import '../widgets/app_snackbars.dart';
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
  bool _isSeeding = false;
  bool _isSavingDestination = false;
  bool _isSavingPickupPricing = false;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _seed(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    if (_isSeeding) return;
    setState(() => _isSeeding = true);
    try {
      await FirebaseFunctions.instance
          .httpsCallable('seedDestinationCountries')
          .call();
      if (!context.mounted) return;
      showSuccessSnackBar(context, l10n.countriesSeeded);
    } catch (error) {
      if (!context.mounted) return;
      showErrorSnackBar(context, _friendlyError(l10n, error));
    } finally {
      if (mounted) setState(() => _isSeeding = false);
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

  String? _barrelShippingFeeError({
    required String value,
    required bool isActive,
    required AppLocalizations l10n,
  }) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return isActive ? l10n.addBarrelFeeBeforeActivating : null;
    }
    final price = double.tryParse(trimmed);
    if (price == null) return l10n.pleaseEnterValidNumber;
    if (isActive && price <= 0) {
      return l10n.activeDestinationsNeedFee;
    }
    return null;
  }

  String? _deliveryEstimateError({
    required String minValue,
    required String maxValue,
    required bool validateMin,
    required AppLocalizations l10n,
  }) {
    final minText = minValue.trim();
    final maxText = maxValue.trim();
    if (minText.isEmpty && maxText.isEmpty) return null;
    if (validateMin && minText.isEmpty) return l10n.addMinimumDeliveryDays;
    if (!validateMin && maxText.isEmpty) return l10n.addMaximumDeliveryDays;

    final value = int.tryParse(validateMin ? minText : maxText);
    if (value == null) return l10n.useWholeCalendarDays;
    if (value <= 0) return l10n.deliveryDaysGreaterThanZero;

    final min = int.tryParse(minText);
    final max = int.tryParse(maxText);
    if (!validateMin && min != null && max != null && max < min) {
      return l10n.maxDaysAtLeastMin;
    }
    return null;
  }

  String _permissionMessage() {
    return AppLocalizations.of(context)!.firebaseDeniedDeployRules;
  }

  Future<Map<String, dynamic>> _businessDestinationSnapshot(
    String businessId,
  ) async {
    final fallbackBusinessName = _currentBusinessName(
      context.read<AuthProvider>(),
    );
    final businessDoc = await FirebaseFirestore.instance
        .collection('businesses')
        .doc(businessId)
        .get();
    final businessData = businessDoc.data() ?? <String, dynamic>{};
    return {
      'businessId': businessId,
      'businessName': businessData['name'] ?? fallbackBusinessName,
      'businessPhone': businessData['phone'] ?? '',
      'businessEmail': businessData['email'] ?? '',
      'businessWebsite': businessData['website'] ?? '',
      'businessStatus': businessData['status'] ?? 'pending',
      'businessProfileImageUrl': businessData['profileImageUrl'] ?? '',
      'businessProfileImagePath': businessData['profileImagePath'] ?? '',
      'enabledServices': businessData['enabledServices'],
      'serviceNote': businessData['serviceNote'] ?? '',
    };
  }

  Future<void> _showForm(
    BuildContext context, {
    DestinationCountry? country,
  }) async {
    final auth = context.read<AuthProvider>();
    final businessId = _currentBusinessId(auth);
    final l10n = AppLocalizations.of(context)!;
    final nameController = TextEditingController(text: country?.name ?? '');
    final codeController = TextEditingController(text: country?.code ?? '');
    final barrelPriceController = TextEditingController(
      text: (country?.barrelShippingPrice ?? 0) == 0
          ? ''
          : country!.barrelShippingPrice.toStringAsFixed(0),
    );
    final minDaysController = TextEditingController(
      text: country?.deliveryEstimateMinDays?.toString() ?? '',
    );
    final maxDaysController = TextEditingController(
      text: country?.deliveryEstimateMaxDays?.toString() ?? '',
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
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextFormField(
                      controller: nameController,
                      decoration: InputDecoration(labelText: l10n.countryName),
                      validator: (value) =>
                          value == null || value.trim().isEmpty
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
                      decoration: InputDecoration(
                        labelText: l10n.barrelShippingPrice,
                        prefixText: r'$',
                      ),
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      validator: (value) {
                        return _barrelShippingFeeError(
                          value: value ?? '',
                          isActive: isActive,
                          l10n: l10n,
                        );
                      },
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: minDaysController,
                            decoration: InputDecoration(
                              labelText: l10n.minDeliveryDays,
                              prefixIcon: const Icon(Icons.schedule_outlined),
                            ),
                            keyboardType: TextInputType.number,
                            validator: (value) => _deliveryEstimateError(
                              minValue: value ?? '',
                              maxValue: maxDaysController.text,
                              validateMin: true,
                              l10n: l10n,
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextFormField(
                            controller: maxDaysController,
                            decoration: InputDecoration(
                              labelText: l10n.maxDeliveryDays,
                              prefixIcon: const Icon(
                                Icons.event_available_outlined,
                              ),
                            ),
                            keyboardType: TextInputType.number,
                            validator: (value) => _deliveryEstimateError(
                              minValue: minDaysController.text,
                              maxValue: value ?? '',
                              validateMin: false,
                              l10n: l10n,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      l10n.optionalDeliveryEstimateNote,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    SwitchListTile(
                      value: isActive,
                      onChanged: (value) {
                        setModalState(() => isActive = value);
                        formKey.currentState?.validate();
                      },
                      title: Text(l10n.active),
                      subtitle: isActive
                          ? Text(l10n.activeDestinationsRequireFee)
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
          );
        },
      ),
    );
    try {
      if (result != true) return;
      if (!context.mounted) return;
      if (mounted) setState(() => _isSavingDestination = true);
      final id =
          country?.id ??
          nameController.text
              .trim()
              .toLowerCase()
              .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
              .replaceAll(RegExp(r'^-|-$'), '');
      final businessSnapshot = await _businessDestinationSnapshot(businessId);
      final minDays = int.tryParse(minDaysController.text.trim());
      final maxDays = int.tryParse(maxDaysController.text.trim());
      final hasEstimate = minDays != null && maxDays != null;
      await FirebaseFirestore.instance
          .collection('businesses')
          .doc(businessId)
          .collection('destinationCountries')
          .doc(id)
          .set({
            'name': nameController.text.trim(),
            'code': codeController.text.trim(),
            ...businessSnapshot,
            'barrelShippingPrice':
                double.tryParse(barrelPriceController.text.trim()) ?? 0,
            'deliveryEstimateMinDays': hasEstimate
                ? minDays
                : FieldValue.delete(),
            'deliveryEstimateMaxDays': hasEstimate
                ? maxDays
                : FieldValue.delete(),
            'isActive': isActive,
            'updatedAt': FieldValue.serverTimestamp(),
          }, SetOptions(merge: true));
      if (!context.mounted) return;
      showSuccessSnackBar(context, l10n.recordUpdated);
    } catch (error) {
      if (!context.mounted) return;
      showErrorSnackBar(context, _friendlyError(l10n, error));
    } finally {
      if (mounted) setState(() => _isSavingDestination = false);
      nameController.dispose();
      codeController.dispose();
      barrelPriceController.dispose();
      minDaysController.dispose();
      maxDaysController.dispose();
    }
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
                  Text(
                    l10n.barrelPickupPricing,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: officeController,
                    decoration: InputDecoration(labelText: l10n.officeAddress),
                    validator: (value) => value == null || value.trim().isEmpty
                        ? l10n.requiredField
                        : null,
                  ),
                  const SizedBox(height: 12),
                  for (final entry in priceControllers.entries) ...[
                    TextFormField(
                      controller: entry.value,
                      decoration: InputDecoration(
                        labelText: l10n.pickupPriceLabel(entry.key),
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

    try {
      if (result == true) {
        if (!context.mounted) return;
        if (mounted) setState(() => _isSavingPickupPricing = true);
        await service.savePickupPricing(
          BarrelPickupPricing(
            officeAddress: officeController.text.trim(),
            boroughPrices: {
              for (final entry in priceControllers.entries)
                entry.key: double.parse(entry.value.text.trim()),
            },
          ),
        );
        if (!context.mounted) return;
        showSuccessSnackBar(context, l10n.recordUpdated);
      }
    } catch (error) {
      if (!context.mounted) return;
      showErrorSnackBar(context, _friendlyError(l10n, error));
    } finally {
      if (mounted) setState(() => _isSavingPickupPricing = false);
      officeController.dispose();
      for (final controller in priceControllers.values) {
        controller.dispose();
      }
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
      AsyncActionButton.outlined(
        onPressed: _isSeeding ? null : () => _seed(context),
        icon: Icons.public,
        label: l10n.seedDefaultCountries,
      ),
      const SizedBox(height: 12),
      AsyncActionButton.outlined(
        onPressed: _isSavingPickupPricing
            ? null
            : () => _showPickupPricingForm(context),
        icon: Icons.local_shipping,
        label: l10n.barrelPickupPricing,
      ),
    ];
  }

  String _currentBusinessId(AuthProvider auth) {
    if (auth.isAdmin) return BusinessProfile.defaultBusinessId;
    return auth.businessId ?? BusinessProfile.defaultBusinessId;
  }

  String _currentBusinessName(AuthProvider auth) {
    if (auth.isAdmin) return BusinessProfile.defaultBusinessName;
    return auth.businessName ?? BusinessProfile.defaultBusinessName;
  }

  bool get _isBusy =>
      _isSeeding || _isSavingDestination || _isSavingPickupPricing;

  Widget _searchField() {
    return TextField(
      controller: _searchController,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        prefixIcon: const Icon(Icons.search),
        hintText: AppLocalizations.of(context)!.searchCountriesCodesFlags,
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
          Text(l10n.seedCountriesEmptyInstruction, textAlign: TextAlign.center),
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
                l10n.barrelPriceSummary(
                  '\$${country.barrelShippingPrice.toStringAsFixed(0)}',
                ),
                if (country.deliveryEstimateLabel != null)
                  l10n.deliveryEstimateSummary(country.deliveryEstimateLabel!),
              ].whereType<String>().join(' • '),
            ),
            trailing: Switch(
              value: country.isActive,
              onChanged: canEdit && !_isBusy
                  ? (value) async {
                      if (_isSavingDestination) return;
                      if (value && country.barrelShippingPrice <= 0) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(l10n.addBarrelFeeBeforeActivating),
                          ),
                        );
                        await _showForm(context, country: country);
                        return;
                      }
                      try {
                        if (mounted) {
                          setState(() => _isSavingDestination = true);
                        }
                        final businessId = _currentBusinessId(
                          context.read<AuthProvider>(),
                        );
                        final businessSnapshot =
                            await _businessDestinationSnapshot(businessId);
                        await FirebaseFirestore.instance
                            .collection('businesses')
                            .doc(businessId)
                            .collection('destinationCountries')
                            .doc(country.id)
                            .set({
                              ...businessSnapshot,
                              'isActive': value,
                              'updatedAt': FieldValue.serverTimestamp(),
                            }, SetOptions(merge: true));
                        if (!context.mounted) return;
                        showSuccessSnackBar(context, l10n.recordUpdated);
                      } catch (error) {
                        if (!context.mounted) return;
                        showErrorSnackBar(context, _friendlyError(l10n, error));
                      } finally {
                        if (mounted) {
                          setState(() => _isSavingDestination = false);
                        }
                      }
                    }
                  : null,
            ),
            onTap: canEdit && !_isBusy
                ? () => _showForm(context, country: country)
                : null,
          ),
        ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.watch<AuthProvider>();
    final businessId = _currentBusinessId(auth);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.destinationCountries),
        actions: const [LanguageToggle()],
      ),
      body: Stack(
        children: [
          StreamBuilder<QuerySnapshot>(
            stream: FirebaseFirestore.instance
                .collection('businesses')
                .doc(businessId)
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
          if (_isBusy)
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
