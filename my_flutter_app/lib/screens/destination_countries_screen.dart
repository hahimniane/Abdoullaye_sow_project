import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/country_catalog.dart';
import '../l10n/app_localizations.dart';
import '../models/business_profile.dart';
import '../models/business_service.dart';
import '../models/destination_country.dart';
import '../providers/auth_provider.dart';
import '../services/barrel_pricing_service.dart';
import '../services/destination_pickup.dart';
import '../services/destination_visibility.dart';
import '../services/waiting_package_service.dart';
import '../theme/app_colors.dart';
import '../utils/money_input.dart';
import '../widgets/async_action_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/country_phone_field.dart';
import '../widgets/language_toggle.dart';

/// The business's destination records, live. A parameter so a widget test
/// feeds records without Firestore; the default reads the collection.
typedef DestinationRecordsStream =
    Stream<List<DestinationCountry>> Function(String businessId);

Stream<List<DestinationCountry>> _firestoreDestinationRecords(
  String businessId,
) => FirebaseFirestore.instance
    .collection('businesses')
    .doc(businessId)
    .collection('destinationCountries')
    .snapshots()
    .map(
      (snap) => [
        for (final doc in snap.docs) DestinationCountry.fromFirestore(doc),
      ],
    );

class DestinationCountriesScreen extends StatefulWidget {
  const DestinationCountriesScreen({
    super.key,
    this.businessId,
    this.records = _firestoreDestinationRecords,
    this.caller = callContainerCallable,
  });

  /// Tests pass the business; the app reads it from the signed-in user.
  final String? businessId;
  final DestinationRecordsStream records;

  /// Calls `seedDestinationCountries`, `setMainDestination` and
  /// `setDestinationPickup`.
  final ContainerCallableCaller caller;

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
  bool _isSettingMain = false;
  List<DestinationCountry> _stored = const [];

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _seed(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    if (_isSeeding) return;
    // Adding every country is a big, mostly pointless change for a business
    // that ships to a few: ask first, and say what it does.
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        key: const Key('dst-seed-confirm'),
        title: Text(l10n.dstSeedConfirmTitle),
        content: Text(l10n.dstSeedConfirmBody),
        actions: [
          TextButton(
            key: const Key('dst-seed-cancel'),
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            key: const Key('dst-seed-confirm-yes'),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(l10n.dstSeedConfirmAction),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted || _isSeeding) return;
    setState(() => _isSeeding = true);
    try {
      await widget.caller('seedDestinationCountries', const {});
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

  String? _serviceRateError({
    required String value,
    required bool isEnabled,
    required String serviceLabel,
    required AppLocalizations l10n,
  }) {
    if (!isEnabled) return null;
    final trimmed = value.trim();
    if (trimmed.isEmpty) {
      return l10n.destinationServiceRateRequired(serviceLabel);
    }
    final price = parseMoneyDollars(trimmed);
    if (price == null) return l10n.moneyAmountInvalid;
    if (price <= 0) {
      return l10n.destinationServiceRateGreaterThanZero(serviceLabel);
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

  Future<void> _toggleMain(
    BuildContext context,
    String businessId,
    DestinationCountry country,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    if (_isSettingMain) return;
    setState(() => _isSettingMain = true);
    try {
      final isNowMain = await setMainDestination(
        businessId: businessId,
        country: country,
        caller: widget.caller,
      );
      if (!context.mounted) return;
      showSuccessSnackBar(
        context,
        isNowMain ? l10n.dstMainSaved : l10n.dstMainCleared,
      );
    } catch (error) {
      if (!context.mounted) return;
      showErrorSnackBar(context, _friendlyError(l10n, error));
    } finally {
      if (mounted) setState(() => _isSettingMain = false);
    }
  }

  /// "Add country": every country that is not listed (including ones whose
  /// record exists but is unused), searchable. Picking one opens the usual
  /// coverage form for it.
  Future<void> _addCountry(
    BuildContext context,
    List<DestinationCountry> stored,
  ) async {
    final picked = await showModalBottomSheet<DestinationCountry>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _AddCountrySheet(options: destinationsToAdd(stored)),
    );
    if (picked == null || !context.mounted) return;
    await _showForm(context, country: picked);
  }

  Future<void> _showForm(
    BuildContext context, {
    DestinationCountry? country,
  }) async {
    final auth = context.read<AuthProvider>();
    final businessId = _currentBusinessId(auth);
    final l10n = AppLocalizations.of(context)!;
    final businessSnapshot = await _businessDestinationSnapshot(businessId);
    if (!context.mounted) return;
    final enabledServices = normalizeBusinessServices(
      businessSnapshot['enabledServices'],
    );
    final offersBarrelShipping = enabledServices.contains('barrelShipping');
    final offersFreight = enabledServices.contains('freight');
    final offersCarTransport = enabledServices.contains('carTransport');
    if (!offersBarrelShipping && !offersFreight && !offersCarTransport) {
      showErrorSnackBar(context, l10n.enableBusinessServiceBeforeDestination);
      return;
    }
    final nameController = TextEditingController(text: country?.name ?? '');
    final codeController = TextEditingController(text: country?.code ?? '');
    final barrelPriceController = TextEditingController(
      text: (country?.barrelShippingPrice ?? 0) == 0
          ? ''
          : country!.barrelShippingPrice.toStringAsFixed(0),
    );
    final freightAirPriceController = TextEditingController(
      text: (country?.freightAirPricePerKg ?? 0) == 0
          ? ''
          : country!.freightAirPricePerKg.toStringAsFixed(0),
    );
    final freightSeaPriceController = TextEditingController(
      text: (country?.freightSeaPricePerKg ?? 0) == 0
          ? ''
          : country!.freightSeaPricePerKg.toStringAsFixed(0),
    );
    // Each service has its own real-world transit time, so each gets an
    // independent min/max pair instead of one shared estimate.
    final barrelMinDaysController = TextEditingController(
      text: country?.barrelShippingDeliveryEstimateMinDays?.toString() ?? '',
    );
    final barrelMaxDaysController = TextEditingController(
      text: country?.barrelShippingDeliveryEstimateMaxDays?.toString() ?? '',
    );
    final airMinDaysController = TextEditingController(
      text: country?.freightAirDeliveryEstimateMinDays?.toString() ?? '',
    );
    final airMaxDaysController = TextEditingController(
      text: country?.freightAirDeliveryEstimateMaxDays?.toString() ?? '',
    );
    final seaMinDaysController = TextEditingController(
      text: country?.freightSeaDeliveryEstimateMinDays?.toString() ?? '',
    );
    final seaMaxDaysController = TextEditingController(
      text: country?.freightSeaDeliveryEstimateMaxDays?.toString() ?? '',
    );
    var barrelShippingEnabled =
        offersBarrelShipping && (country?.barrelShippingAvailable ?? false);
    var freightAirEnabled =
        offersFreight && (country?.freightAirAvailable ?? false);
    var freightSeaEnabled =
        offersFreight && (country?.freightSeaAvailable ?? false);
    var freightAirDepartureDays = {...?country?.freightAirDepartureDays};
    var freightSeaDepartureDays = {...?country?.freightSeaDepartureDays};
    var carTransportEnabled =
        offersCarTransport && (country?.carTransportAvailable ?? false);
    // Where customers collect here. Saved through `setDestinationPickup`,
    // never in the coverage write below.
    final pickupBefore = DestinationPickup.of(country);
    final pickupCityController = TextEditingController(
      text: pickupBefore.city,
    );
    final pickupAddressController = TextEditingController(
      text: pickupBefore.address,
    );
    final pickupPhoneController = TextEditingController(
      text: pickupBefore.phone,
    );
    final pickupPhoneCountry = (country?.code ?? '').trim().isEmpty
        ? 'US'
        : country!.code!.trim().toUpperCase();
    final formKey = GlobalKey<FormState>();
    final result = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setModalState) {
          void updateService(VoidCallback update) {
            setModalState(update);
            formKey.currentState?.validate();
          }

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
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      l10n.destinationServiceCoverageTitle,
                      style: const TextStyle(
                        color: AppColors.ink,
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      l10n.destinationServiceCoverageSubtitle,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 16),
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
                    FormField<bool>(
                      validator: (_) =>
                          barrelShippingEnabled ||
                              freightAirEnabled ||
                              freightSeaEnabled ||
                              carTransportEnabled
                          ? null
                          : l10n.chooseAtLeastOneDestinationService,
                      builder: (field) {
                        final hasError = field.hasError;
                        final borderColor = hasError
                            ? Theme.of(context).colorScheme.error
                            : AppColors.lightOutline;
                        return Container(
                          decoration: BoxDecoration(
                            border: Border.all(color: borderColor),
                            borderRadius: BorderRadius.circular(8),
                            color: AppColors.lightSurface,
                          ),
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                l10n.servicesForDestination,
                                style: const TextStyle(
                                  color: AppColors.ink,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                l10n.servicesForDestinationHelp,
                                style: const TextStyle(
                                  color: AppColors.muted,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 10),
                              if (offersBarrelShipping)
                                _DestinationServiceToggle(
                                  icon: Icons.inventory_2_outlined,
                                  title: l10n.offerBarrelShipping,
                                  subtitle:
                                      l10n.barrelShippingDestinationHelper,
                                  value: barrelShippingEnabled,
                                  onChanged: (value) => updateService(
                                    () => barrelShippingEnabled = value,
                                  ),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: [
                                      TextFormField(
                                        controller: barrelPriceController,
                                        decoration: InputDecoration(
                                          labelText: l10n.barrelShippingPrice,
                                          prefixText: r'$',
                                        ),
                                        keyboardType:
                                            const TextInputType.numberWithOptions(
                                              decimal: true,
                                            ),
                                        validator: (value) => _serviceRateError(
                                          value: value ?? '',
                                          isEnabled: barrelShippingEnabled,
                                          serviceLabel:
                                              l10n.destinationBarrelService,
                                          l10n: l10n,
                                        ),
                                      ),
                                      const SizedBox(height: 12),
                                      _DeliveryEstimateFields(
                                        minController: barrelMinDaysController,
                                        maxController: barrelMaxDaysController,
                                        deliveryEstimateError:
                                            _deliveryEstimateError,
                                        l10n: l10n,
                                      ),
                                    ],
                                  ),
                                ),
                              if (offersFreight)
                                _DestinationServiceToggle(
                                  icon: Icons.flight_takeoff_outlined,
                                  title: l10n.offerFreightAir,
                                  subtitle: l10n.freightAirDestinationHelper,
                                  value: freightAirEnabled,
                                  onChanged: (value) => updateService(
                                    () => freightAirEnabled = value,
                                  ),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: [
                                      TextFormField(
                                        controller: freightAirPriceController,
                                        decoration: InputDecoration(
                                          labelText: l10n.freightAirRatePerKg,
                                          prefixText: r'$',
                                        ),
                                        keyboardType:
                                            const TextInputType.numberWithOptions(
                                              decimal: true,
                                            ),
                                        validator: (value) => _serviceRateError(
                                          value: value ?? '',
                                          isEnabled: freightAirEnabled,
                                          serviceLabel:
                                              l10n.destinationFreightAir,
                                          l10n: l10n,
                                        ),
                                      ),
                                      const SizedBox(height: 12),
                                      _DepartureDayPicker(
                                        label: l10n.freightAirDepartureDays,
                                        selectedDays: freightAirDepartureDays,
                                        onChanged: (days) => setModalState(
                                          () => freightAirDepartureDays = days,
                                        ),
                                      ),
                                      const SizedBox(height: 12),
                                      _DeliveryEstimateFields(
                                        minController: airMinDaysController,
                                        maxController: airMaxDaysController,
                                        deliveryEstimateError:
                                            _deliveryEstimateError,
                                        l10n: l10n,
                                      ),
                                    ],
                                  ),
                                ),
                              if (offersFreight)
                                _DestinationServiceToggle(
                                  icon: Icons.directions_boat_outlined,
                                  title: l10n.offerFreightSea,
                                  subtitle: l10n.freightSeaDestinationHelper,
                                  value: freightSeaEnabled,
                                  onChanged: (value) => updateService(
                                    () => freightSeaEnabled = value,
                                  ),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: [
                                      TextFormField(
                                        controller: freightSeaPriceController,
                                        decoration: InputDecoration(
                                          labelText: l10n.freightSeaRatePerKg,
                                          prefixText: r'$',
                                        ),
                                        keyboardType:
                                            const TextInputType.numberWithOptions(
                                              decimal: true,
                                            ),
                                        validator: (value) => _serviceRateError(
                                          value: value ?? '',
                                          isEnabled: freightSeaEnabled,
                                          serviceLabel:
                                              l10n.destinationFreightSea,
                                          l10n: l10n,
                                        ),
                                      ),
                                      const SizedBox(height: 12),
                                      _DepartureDayPicker(
                                        label: l10n.freightSeaDepartureDays,
                                        selectedDays: freightSeaDepartureDays,
                                        onChanged: (days) => setModalState(
                                          () => freightSeaDepartureDays = days,
                                        ),
                                      ),
                                      const SizedBox(height: 12),
                                      _DeliveryEstimateFields(
                                        minController: seaMinDaysController,
                                        maxController: seaMaxDaysController,
                                        deliveryEstimateError:
                                            _deliveryEstimateError,
                                        l10n: l10n,
                                      ),
                                    ],
                                  ),
                                ),
                              if (offersCarTransport)
                                _DestinationServiceToggle(
                                  icon: Icons.car_rental_outlined,
                                  title: l10n.offerCarTransportDestination,
                                  subtitle: l10n.carTransportDestinationHelper,
                                  value: carTransportEnabled,
                                  onChanged: (value) => updateService(
                                    () => carTransportEnabled = value,
                                  ),
                                ),
                              if (hasError) ...[
                                const SizedBox(height: 8),
                                Text(
                                  field.errorText!,
                                  style: TextStyle(
                                    color: Theme.of(context).colorScheme.error,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        );
                      },
                    ),
                    const SizedBox(height: 16),
                    Text(
                      l10n.dstPickupTitle,
                      style: const TextStyle(
                        color: AppColors.ink,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      l10n.dstPickupHelp,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextFormField(
                      key: const Key('dst-pickup-city'),
                      controller: pickupCityController,
                      maxLength: pickupCityMaxLength,
                      decoration: InputDecoration(
                        labelText: l10n.dstPickupCity,
                        hintText: l10n.dstPickupCityHint,
                        counterText: '',
                      ),
                      validator: (value) =>
                          pickupCityError(l10n, value ?? ''),
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      key: const Key('dst-pickup-address'),
                      controller: pickupAddressController,
                      maxLength: pickupAddressMaxLength,
                      decoration: InputDecoration(
                        labelText: l10n.dstPickupAddress,
                        hintText: l10n.dstPickupAddressHint,
                        counterText: '',
                      ),
                      validator: (value) =>
                          pickupAddressError(l10n, value ?? ''),
                    ),
                    const SizedBox(height: 12),
                    CountryPhoneField(
                      fieldKey: const Key('dst-pickup-phone'),
                      controller: pickupPhoneController,
                      labelText: l10n.dstPickupPhone,
                      initialCountryCode: pickupPhoneCountry,
                      autofillHints: null,
                      validator: (value) =>
                          pickupPhoneError(l10n, value ?? ''),
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
      final serviceAvailability = {
        'barrelShipping': barrelShippingEnabled,
        'freightAir': freightAirEnabled,
        'freightSea': freightSeaEnabled,
        'carTransport': carTransportEnabled,
      };
      final id =
          country?.id ??
          nameController.text
              .trim()
              .toLowerCase()
              .replaceAll(RegExp(r'[^a-z0-9]+'), '-')
              .replaceAll(RegExp(r'^-|-$'), '');
      final barrelMinDays = int.tryParse(barrelMinDaysController.text.trim());
      final barrelMaxDays = int.tryParse(barrelMaxDaysController.text.trim());
      final hasBarrelEstimate = barrelMinDays != null && barrelMaxDays != null;
      final airMinDays = int.tryParse(airMinDaysController.text.trim());
      final airMaxDays = int.tryParse(airMaxDaysController.text.trim());
      final hasAirEstimate = airMinDays != null && airMaxDays != null;
      final seaMinDays = int.tryParse(seaMinDaysController.text.trim());
      final seaMaxDays = int.tryParse(seaMaxDaysController.text.trim());
      final hasSeaEstimate = seaMinDays != null && seaMaxDays != null;
      await FirebaseFirestore.instance
          .collection('businesses')
          .doc(businessId)
          .collection('destinationCountries')
          .doc(id)
          .set({
            'id': id,
            'countryId': id,
            'name': nameController.text.trim(),
            'code': codeController.text.trim().toUpperCase(),
            ...businessSnapshot,
            'destinationCoverageVersion': 2,
            'serviceAvailability': serviceAvailability,
            'barrelShippingPrice': barrelShippingEnabled
                ? parseMoneyDollars(barrelPriceController.text) ?? 0
                : 0,
            'freightAirPricePerKg': freightAirEnabled
                ? parseMoneyDollars(freightAirPriceController.text) ?? 0
                : 0,
            'freightSeaPricePerKg': freightSeaEnabled
                ? parseMoneyDollars(freightSeaPriceController.text) ?? 0
                : 0,
            'freightAirDepartureDays': freightAirEnabled
                ? _orderedDepartureDays(freightAirDepartureDays)
                : const <String>[],
            'freightSeaDepartureDays': freightSeaEnabled
                ? _orderedDepartureDays(freightSeaDepartureDays)
                : const <String>[],
            'carTransportAvailable': carTransportEnabled,
            'barrelShippingDeliveryEstimateMinDays': hasBarrelEstimate
                ? barrelMinDays
                : FieldValue.delete(),
            'barrelShippingDeliveryEstimateMaxDays': hasBarrelEstimate
                ? barrelMaxDays
                : FieldValue.delete(),
            'freightAirDeliveryEstimateMinDays': hasAirEstimate
                ? airMinDays
                : FieldValue.delete(),
            'freightAirDeliveryEstimateMaxDays': hasAirEstimate
                ? airMaxDays
                : FieldValue.delete(),
            'freightSeaDeliveryEstimateMinDays': hasSeaEstimate
                ? seaMinDays
                : FieldValue.delete(),
            'freightSeaDeliveryEstimateMaxDays': hasSeaEstimate
                ? seaMaxDays
                : FieldValue.delete(),
            'isActive': serviceAvailability.values.any((enabled) => enabled),
            'updatedAt': FieldValue.serverTimestamp(),
          }, SetOptions(merge: true));
      // After the coverage write, so a new destination exists first. The
      // server validates and stores them (blank clears).
      await saveDestinationPickup(
        businessId: businessId,
        countryId: id,
        before: pickupBefore,
        after: DestinationPickup(
          city: pickupCityController.text,
          address: pickupAddressController.text,
          phone: pickupPhoneController.text,
        ),
        caller: widget.caller,
      );
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
      freightAirPriceController.dispose();
      freightSeaPriceController.dispose();
      barrelMinDaysController.dispose();
      barrelMaxDaysController.dispose();
      airMinDaysController.dispose();
      airMaxDaysController.dispose();
      seaMinDaysController.dispose();
      seaMaxDaysController.dispose();
      pickupCityController.dispose();
      pickupAddressController.dispose();
      pickupPhoneController.dispose();
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
                entry.key: parseMoneyDollars(entry.value.text) ?? 0,
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
      return validateRequiredMoney(value, l10n.moneyAmountInvalid);
    };
  }

  List<Widget> _actions(BuildContext context, AppLocalizations l10n) {
    return [
      // Plain buttons: both wait on a sheet or dialog, which an async button
      // would show as a spinner on the page behind it.
      FilledButton.icon(
        key: const Key('dst-add-country'),
        onPressed: _isBusy ? null : () => _addCountry(context, _stored),
        icon: const Icon(Icons.add_location_alt_outlined),
        label: Text(l10n.dstAddCountry),
      ),
      const SizedBox(height: 12),
      AsyncActionButton.outlined(
        onPressed: _isSavingPickupPricing
            ? null
            : () => _showPickupPricingForm(context),
        icon: Icons.local_shipping,
        label: l10n.barrelPickupPricing,
      ),
      const SizedBox(height: 4),
      // Reachable, but a quiet last resort: it asks before it adds ~250 records.
      Align(
        alignment: Alignment.centerLeft,
        child: TextButton.icon(
          key: const Key('dst-seed'),
          onPressed: _isSeeding ? null : () => _seed(context),
          icon: const Icon(Icons.public),
          label: Text(l10n.seedDefaultCountries),
        ),
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
      _isSeeding ||
      _isSavingDestination ||
      _isSavingPickupPricing ||
      _isSettingMain;

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
    AsyncSnapshot<List<DestinationCountry>> snapshot,
    AppLocalizations l10n,
    String businessId,
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

    // Only the destinations in use are listed; the search covers only those.
    final listed = listedDestinations(snapshot.data!);
    final filteredCountries = _orderedCountries(_filterCountries(listed));

    if (listed.isEmpty) {
      return [
        _stateMessage(
          context,
          Text(l10n.dstEmptyInstruction, textAlign: TextAlign.center),
        ),
      ];
    }

    return [
      Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
          l10n.dstListedCount(listed.length),
          key: const Key('dst-listed-count'),
          style: const TextStyle(
            color: AppColors.muted,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      if (filteredCountries.isEmpty)
        _stateMessage(
          context,
          Text(l10n.noResultsFound, textAlign: TextAlign.center),
        )
      else
        ..._countryTiles(
          context,
          filteredCountries,
          canEdit: true,
          businessId: businessId,
        ),
    ];
  }

  List<DestinationCountry> _filterCountries(
    List<DestinationCountry> countries,
  ) {
    return [
      for (final country in countries)
        if (destinationMatchesSearch(country, _searchQuery)) country,
    ];
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

  String _moneyLabel(double amount) {
    final decimals = amount == amount.roundToDouble() ? 0 : 2;
    return '\$${amount.toStringAsFixed(decimals)}';
  }

  List<Widget> _destinationServiceChips(
    AppLocalizations l10n,
    DestinationCountry country,
  ) {
    return [
      if (country.isBarrelShippingConfigured)
        _DestinationSummaryChip(
          icon: Icons.inventory_2_outlined,
          label: l10n.destinationServicePriceSummary(
            l10n.destinationBarrelService,
            _moneyLabel(country.barrelShippingPrice),
          ),
        ),
      if (country.freightAvailable('air'))
        _DestinationSummaryChip(
          icon: Icons.flight_takeoff_outlined,
          label: l10n.destinationServiceRateSummary(
            l10n.destinationFreightAir,
            _moneyLabel(country.freightAirPricePerKg),
          ),
        ),
      if (country.freightAvailable('sea'))
        _DestinationSummaryChip(
          icon: Icons.directions_boat_outlined,
          label: l10n.destinationServiceRateSummary(
            l10n.destinationFreightSea,
            _moneyLabel(country.freightSeaPricePerKg),
          ),
        ),
      if (country.carTransportAvailable)
        _DestinationSummaryChip(
          icon: Icons.car_rental_outlined,
          label: l10n.destinationCarTransport,
        ),
      if (_pickupSummary(country).isNotEmpty)
        _DestinationSummaryChip(
          key: Key('dst-pickup-summary-${country.id}'),
          icon: Icons.place_outlined,
          label: _pickupSummary(country),
          muted: true,
        ),
    ];
  }

  /// "Conakry · Madina, near the market · +224620000000" - typed values.
  String _pickupSummary(DestinationCountry country) => [
    country.pickupCity,
    country.pickupAddress,
    country.pickupPhone,
  ].where((part) => part.isNotEmpty).join(' · ');

  List<Widget> _deliveryEstimateChips(
    AppLocalizations l10n,
    DestinationCountry country,
  ) {
    return [
      if (country.isBarrelShippingConfigured &&
          country.barrelShippingDeliveryEstimateLabel != null)
        _DestinationSummaryChip(
          icon: Icons.schedule_outlined,
          label: l10n.destinationServicePriceSummary(
            l10n.destinationBarrelService,
            country.barrelShippingDeliveryEstimateLabel!,
          ),
          muted: true,
        ),
      if (country.freightAvailable('air') &&
          country.freightAirDeliveryEstimateLabel != null)
        _DestinationSummaryChip(
          icon: Icons.schedule_outlined,
          label: l10n.destinationServicePriceSummary(
            l10n.destinationFreightAir,
            country.freightAirDeliveryEstimateLabel!,
          ),
          muted: true,
        ),
      if (country.freightAvailable('sea') &&
          country.freightSeaDeliveryEstimateLabel != null)
        _DestinationSummaryChip(
          icon: Icons.schedule_outlined,
          label: l10n.destinationServicePriceSummary(
            l10n.destinationFreightSea,
            country.freightSeaDeliveryEstimateLabel!,
          ),
          muted: true,
        ),
    ];
  }

  List<Widget> _countryTiles(
    BuildContext context,
    List<DestinationCountry> countries, {
    required bool canEdit,
    String? businessId,
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
            title: Row(
              children: [
                Expanded(child: Text(country.name)),
                if (canEdit && businessId != null)
                  IconButton(
                    key: Key('dst-main-${country.id}'),
                    tooltip: country.isMain
                        ? l10n.dstMainDestination
                        : l10n.dstMakeMain,
                    visualDensity: VisualDensity.compact,
                    isSelected: country.isMain,
                    icon: const Icon(Icons.star_border),
                    selectedIcon: const Icon(
                      Icons.star,
                      color: AppColors.saffron,
                    ),
                    onPressed: _isBusy
                        ? null
                        : () => _toggleMain(context, businessId, country),
                  ),
              ],
            ),
            subtitle: Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (country.displayCode.isNotEmpty) ...[
                    Text(
                      country.displayCode,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
                  Builder(
                    builder: (context) {
                      final serviceChips = _destinationServiceChips(
                        l10n,
                        country,
                      );
                      return Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: serviceChips.isEmpty
                            ? [
                                _DestinationSummaryChip(
                                  icon: Icons.visibility_off_outlined,
                                  label: l10n.noDestinationServicesConfigured,
                                  muted: true,
                                ),
                              ]
                            : serviceChips,
                      );
                    },
                  ),
                  if (_deliveryEstimateChips(l10n, country).isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: _deliveryEstimateChips(l10n, country),
                    ),
                  ],
                ],
              ),
            ),
            trailing: canEdit ? const Icon(Icons.chevron_right) : null,
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
    final businessId =
        widget.businessId ?? _currentBusinessId(context.watch<AuthProvider>());
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.destinationCountries),
        actions: const [LanguageToggle()],
      ),
      body: Stack(
        children: [
          StreamBuilder<List<DestinationCountry>>(
            stream: widget.records(businessId),
            builder: (context, snapshot) {
              _stored = snapshot.data ?? const [];
              return ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  ..._actions(context, l10n),
                  const SizedBox(height: 12),
                  _searchField(),
                  const SizedBox(height: 12),
                  ..._countryContent(context, snapshot, l10n, businessId),
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

class _DeliveryEstimateFields extends StatelessWidget {
  const _DeliveryEstimateFields({
    required this.minController,
    required this.maxController,
    required this.deliveryEstimateError,
    required this.l10n,
  });

  final TextEditingController minController;
  final TextEditingController maxController;
  final String? Function({
    required String minValue,
    required String maxValue,
    required bool validateMin,
    required AppLocalizations l10n,
  })
  deliveryEstimateError;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: TextFormField(
                controller: minController,
                decoration: InputDecoration(
                  labelText: l10n.minDeliveryDays,
                  prefixIcon: const Icon(Icons.schedule_outlined),
                ),
                keyboardType: TextInputType.number,
                validator: (value) => deliveryEstimateError(
                  minValue: value ?? '',
                  maxValue: maxController.text,
                  validateMin: true,
                  l10n: l10n,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextFormField(
                controller: maxController,
                decoration: InputDecoration(
                  labelText: l10n.maxDeliveryDays,
                  prefixIcon: const Icon(Icons.event_available_outlined),
                ),
                keyboardType: TextInputType.number,
                validator: (value) => deliveryEstimateError(
                  minValue: minController.text,
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
      ],
    );
  }
}

const _destinationDepartureDays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

List<String> _orderedDepartureDays(Set<String> days) =>
    _destinationDepartureDays.where(days.contains).toList(growable: false);

String _departureDayLabel(AppLocalizations l10n, String day) => switch (day) {
  'monday' => l10n.mondayShort,
  'tuesday' => l10n.tuesdayShort,
  'wednesday' => l10n.wednesdayShort,
  'thursday' => l10n.thursdayShort,
  'friday' => l10n.fridayShort,
  'saturday' => l10n.saturdayShort,
  'sunday' => l10n.sundayShort,
  _ => day,
};

class _DepartureDayPicker extends StatelessWidget {
  const _DepartureDayPicker({
    required this.label,
    required this.selectedDays,
    required this.onChanged,
  });

  final String label;
  final Set<String> selectedDays;
  final ValueChanged<Set<String>> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: AppColors.ink,
            fontSize: 13,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          l10n.freightDepartureDaysHelper,
          style: const TextStyle(
            color: AppColors.muted,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 7,
          runSpacing: 7,
          children: _destinationDepartureDays
              .map((day) {
                final selected = selectedDays.contains(day);
                return FilterChip(
                  label: Text(_departureDayLabel(l10n, day)),
                  selected: selected,
                  onSelected: (nextSelected) {
                    final next = {...selectedDays};
                    if (nextSelected) {
                      next.add(day);
                    } else {
                      next.remove(day);
                    }
                    onChanged(next);
                  },
                );
              })
              .toList(growable: false),
        ),
      ],
    );
  }
}

class _DestinationServiceToggle extends StatelessWidget {
  const _DestinationServiceToggle({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
    this.child,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        border: Border.all(
          color: value
              ? AppColors.cobalt.withValues(alpha: 0.45)
              : AppColors.lightOutline,
        ),
        borderRadius: BorderRadius.circular(8),
        color: value
            ? AppColors.mist.withValues(alpha: 0.35)
            : AppColors.lightBg,
      ),
      padding: const EdgeInsets.all(12),
      child: Column(
        children: [
          Row(
            children: [
              Icon(icon, color: value ? AppColors.cobaltDeep : AppColors.muted),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.ink,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        height: 1.25,
                      ),
                    ),
                  ],
                ),
              ),
              Switch.adaptive(value: value, onChanged: onChanged),
            ],
          ),
          if (value && child != null) ...[const SizedBox(height: 12), child!],
        ],
      ),
    );
  }
}

class _DestinationSummaryChip extends StatelessWidget {
  const _DestinationSummaryChip({
    super.key,
    required this.icon,
    required this.label,
    this.muted = false,
  });

  final IconData icon;
  final String label;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final foreground = muted ? AppColors.muted : AppColors.cobaltDeep;
    final background = muted
        ? AppColors.lightBg
        : AppColors.mist.withValues(alpha: 0.45);
    return Container(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.lightOutline),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: foreground),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: foreground,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The "Add country" picker: every country not currently listed, searchable.
/// Pops the chosen [DestinationCountry].
class _AddCountrySheet extends StatefulWidget {
  const _AddCountrySheet({required this.options});

  final List<DestinationCountry> options;

  @override
  State<_AddCountrySheet> createState() => _AddCountrySheetState();
}

class _AddCountrySheetState extends State<_AddCountrySheet> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final shown = [
      for (final country in widget.options)
        if (destinationMatchesSearch(country, _query)) country,
    ];
    return SizedBox(
      height: MediaQuery.of(context).size.height * 0.85,
      child: Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 20,
          bottom: MediaQuery.of(context).viewInsets.bottom + 12,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.dstAddCountryTitle,
              style: const TextStyle(
                color: AppColors.ink,
                fontSize: 20,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('dst-add-search'),
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: l10n.dstAddCountrySearchHint,
              ),
              onChanged: (value) => setState(() => _query = value),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: shown.isEmpty
                  ? Center(
                      child: Text(
                        widget.options.isEmpty
                            ? l10n.dstAddCountryNone
                            : l10n.noResultsFound,
                        textAlign: TextAlign.center,
                      ),
                    )
                  : ListView.builder(
                      itemCount: shown.length,
                      itemBuilder: (context, index) {
                        final country = shown[index];
                        return ListTile(
                          key: Key('dst-add-${country.id}'),
                          leading: Text(
                            country.flagEmoji,
                            style: const TextStyle(fontSize: 24),
                          ),
                          title: Text(country.name),
                          subtitle: country.displayCode.isEmpty
                              ? null
                              : Text(country.displayCode),
                          onTap: () => Navigator.pop(context, country),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
