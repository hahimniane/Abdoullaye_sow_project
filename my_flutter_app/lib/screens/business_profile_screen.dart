import 'dart:typed_data';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart' as firebase_storage;
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../data/business_location_catalog.dart';
import '../data/nyc_boroughs.dart';
import '../data/us_locations.dart';
import '../l10n/app_localizations.dart';
import '../models/business_profile.dart';
import '../models/business_service.dart';
import '../models/destination_country.dart';
import '../models/office_location.dart';
import '../providers/auth_provider.dart';
import '../services/office_location_service.dart';
import '../theme/app_colors.dart';
import 'office_locations_screen.dart';
import '../utils/business_profile_validation.dart';
import '../utils/phone_number_validator.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/country_phone_field.dart';
import '../widgets/language_toggle.dart';
import '../widgets/pickup_plan_editor.dart';

class BusinessProfileScreen extends StatefulWidget {
  const BusinessProfileScreen({super.key});

  @override
  State<BusinessProfileScreen> createState() => _BusinessProfileScreenState();
}

enum _BusinessProfileSectionKey {
  details,
  paidHoldPricing,
  parkingCapacity,
  services,
}

class _BusinessProfileScreenState extends State<BusinessProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _detailsSectionKey = GlobalKey();
  final _paidHoldPricingSectionKey = GlobalKey();
  final _parkingCapacitySectionKey = GlobalKey();
  final _servicesSectionKey = GlobalKey();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _websiteController = TextEditingController();
  final _noteController = TextEditingController();
  final _addressLine1Controller = TextEditingController();
  final _countryController = TextEditingController();
  final _cityController = TextEditingController();
  final _stateController = TextEditingController();
  final _postalCodeController = TextEditingController();
  final _holdFlatFeeController = TextEditingController();
  final _holdDailyRateController = TextEditingController();
  final _holdMaxDaysController = TextEditingController();
  final _parkingAddressLine1Controller = TextEditingController();
  final _parkingCountryController = TextEditingController();
  final _parkingCityController = TextEditingController();
  final _parkingStateController = TextEditingController();
  final _parkingTotalSpacesController = TextEditingController();
  final _parkingBlockedSpacesController = TextEditingController();
  final _parkingDailyRateController = TextEditingController();
  final _parkingWeeklyRateController = TextEditingController();
  final _parkingMonthlyRateController = TextEditingController();
  final _parkingMinimumDaysController = TextEditingController();
  final _parkingPickupFeeController = TextEditingController();
  final _parkingInstructionsController = TextEditingController();
  final _freightPickupOriginController = TextEditingController();
  final _freightPickupBaseFeeController = TextEditingController();
  final _freightPickupPerKmController = TextEditingController();
  final _freightPickupMinFeeController = TextEditingController();
  final _freightPickupMaxKmController = TextEditingController();
  final _freightPickupBoroughControllers = {
    for (final borough in kNycBoroughs) borough: TextEditingController(),
  };
  final _featureBlurbController = TextEditingController();
  final _pickupPlanKey = GlobalKey<PickupPlanEditorState>();
  final _selectedServices = <String>{};
  final _sectionErrors = <_BusinessProfileSectionKey, String>{};
  String _holdPricingMode = 'flat';
  String? _hydratedBusinessSignature;
  XFile? _image;
  Uint8List? _imageBytes;
  XFile? _featureLogo;
  Uint8List? _featureLogoBytes;
  bool _featureConsent = false;
  bool _parkingPickupAvailable = false;
  bool _freightPickupAvailable = false;
  String _freightPickupModel = 'distance';
  bool _isSaving = false;
  bool _isRequestingFeature = false;

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _websiteController.dispose();
    _noteController.dispose();
    _addressLine1Controller.dispose();
    _countryController.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _postalCodeController.dispose();
    _holdFlatFeeController.dispose();
    _holdDailyRateController.dispose();
    _holdMaxDaysController.dispose();
    _parkingAddressLine1Controller.dispose();
    _parkingCountryController.dispose();
    _parkingCityController.dispose();
    _parkingStateController.dispose();
    _parkingTotalSpacesController.dispose();
    _parkingBlockedSpacesController.dispose();
    _parkingDailyRateController.dispose();
    _parkingWeeklyRateController.dispose();
    _parkingMonthlyRateController.dispose();
    _parkingMinimumDaysController.dispose();
    _parkingPickupFeeController.dispose();
    _parkingInstructionsController.dispose();
    _freightPickupOriginController.dispose();
    _freightPickupBaseFeeController.dispose();
    _freightPickupPerKmController.dispose();
    _freightPickupMinFeeController.dispose();
    _freightPickupMaxKmController.dispose();
    for (final controller in _freightPickupBoroughControllers.values) {
      controller.dispose();
    }
    _featureBlurbController.dispose();
    super.dispose();
  }

  void _scheduleHydrate(BusinessProfile business) {
    final signature = [
      business.id,
      business.name,
      business.status,
      business.phone ?? '',
      business.email ?? '',
      business.website ?? '',
      business.profileImageUrl ?? '',
      business.profileImagePath ?? '',
      business.logoUrl ?? '',
      business.serviceNote ?? '',
      business.addressLine1 ?? '',
      business.country ?? '',
      business.city ?? '',
      business.state ?? '',
      business.postalCode ?? '',
      business.marketingBlurb ?? '',
      business.featureConsent,
      business.featureStatus,
      business.featureNote ?? '',
      business.enabledServices.join('|'),
      business.carHoldPricingMode,
      business.carHoldFlatFee,
      business.carHoldDailyRate,
      business.carHoldMaxDays,
      business.parkingAddressLine1 ?? '',
      business.parkingCountry ?? '',
      business.parkingCity ?? '',
      business.parkingState ?? '',
      business.parkingTotalSpaces,
      business.parkingBlockedSpaces,
      business.parkingDailyRate,
      business.parkingWeeklyRate,
      business.parkingMonthlyRate,
      business.parkingMinimumDays,
      business.parkingPickupAvailable,
      business.parkingPickupFee,
      business.parkingInstructions ?? '',
      business.parkingLatitude ?? '',
      business.parkingLongitude ?? '',
      business.freightPickupAvailable,
      business.freightPickupModel,
      business.freightPickupBaseFee,
      business.freightPickupPerKm,
      business.freightPickupMinFee,
      business.freightPickupMaxKm,
      business.freightPickupOriginAddress ?? '',
      business.freightPickupBoroughPrices.entries
          .map((e) => '${e.key}:${e.value}')
          .join(','),
    ].join('|#|');
    if (_hydratedBusinessSignature == signature) {
      return;
    }
    _hydratedBusinessSignature = signature;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      setState(() {
        _nameController.text = business.name;
        _phoneController.text = business.phone ?? '';
        _emailController.text = business.email ?? '';
        _websiteController.text = business.website ?? '';
        _noteController.text = business.serviceNote ?? '';
        _addressLine1Controller.text = business.addressLine1 ?? '';
        _countryController.text =
            defaultBusinessCountry(
              country: business.country,
              state: business.state,
            ) ??
            '';
        _cityController.text = business.city ?? '';
        _stateController.text = normalizeUsState(business.state) ?? '';
        _postalCodeController.text = business.postalCode ?? '';
        _holdPricingMode = business.carHoldPricingMode == 'per_day'
            ? 'per_day'
            : 'flat';
        _holdFlatFeeController.text = business.carHoldFlatFee.toStringAsFixed(
          0,
        );
        _holdDailyRateController.text = business.carHoldDailyRate
            .toStringAsFixed(0);
        _holdMaxDaysController.text = business.carHoldMaxDays.toString();
        _parkingAddressLine1Controller.text =
            business.parkingAddressLine1 ?? business.addressLine1 ?? '';
        _parkingCountryController.text =
            defaultBusinessCountry(
              country: business.parkingCountry ?? business.country,
              state: business.parkingState ?? business.state,
            ) ??
            '';
        _parkingCityController.text =
            business.parkingCity ?? business.city ?? '';
        _parkingStateController.text =
            normalizeUsState(business.parkingState ?? business.state) ?? '';
        _parkingTotalSpacesController.text = business.parkingTotalSpaces == 0
            ? ''
            : business.parkingTotalSpaces.toString();
        _parkingBlockedSpacesController.text =
            business.parkingBlockedSpaces == 0
            ? ''
            : business.parkingBlockedSpaces.toString();
        _parkingDailyRateController.text = business.parkingDailyRate == 0
            ? ''
            : business.parkingDailyRate.toStringAsFixed(0);
        _parkingWeeklyRateController.text = business.parkingWeeklyRate == 0
            ? ''
            : business.parkingWeeklyRate.toStringAsFixed(0);
        _parkingMonthlyRateController.text = business.parkingMonthlyRate == 0
            ? ''
            : business.parkingMonthlyRate.toStringAsFixed(0);
        _parkingMinimumDaysController.text = business.parkingMinimumDays
            .toString();
        _parkingPickupAvailable = business.parkingPickupAvailable;
        _parkingPickupFeeController.text = business.parkingPickupFee == 0
            ? ''
            : business.parkingPickupFee.toStringAsFixed(0);
        _parkingInstructionsController.text =
            business.parkingInstructions ?? '';
        _freightPickupAvailable = business.freightPickupAvailable;
        _freightPickupModel = business.effectiveFreightPickupModel;
        _freightPickupOriginController.text =
            business.freightPickupOriginAddress ?? '';
        _freightPickupBaseFeeController.text = business.freightPickupBaseFee == 0
            ? ''
            : business.freightPickupBaseFee.toStringAsFixed(2);
        _freightPickupPerKmController.text = business.freightPickupPerKm == 0
            ? ''
            : business.freightPickupPerKm.toStringAsFixed(2);
        _freightPickupMinFeeController.text = business.freightPickupMinFee == 0
            ? ''
            : business.freightPickupMinFee.toStringAsFixed(2);
        _freightPickupMaxKmController.text = business.freightPickupMaxKm == 0
            ? ''
            : business.freightPickupMaxKm.toStringAsFixed(0);
        for (final borough in kNycBoroughs) {
          final fee = business.freightPickupBoroughPrices[borough];
          _freightPickupBoroughControllers[borough]!.text =
              (fee == null || fee == 0) ? '' : fee.toStringAsFixed(0);
        }
        _featureBlurbController.text = business.marketingBlurb ?? '';
        _featureConsent = business.featureConsent;
        _selectedServices
          ..clear()
          ..addAll(business.enabledServices);
      });
    });
  }

  Future<void> _pickImage() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 82,
      maxWidth: 1200,
    );
    if (picked == null) return;
    final bytes = await picked.readAsBytes();
    if (!mounted) return;
    setState(() {
      _image = picked;
      _imageBytes = bytes;
    });
  }

  Future<_UploadedImage?> _uploadImage(String businessId) async {
    final image = _image;
    final bytes = _imageBytes;
    if (image == null || bytes == null) return null;
    final ext = image.name.split('.').last.toLowerCase();
    final safeExt = ['jpg', 'jpeg', 'png', 'webp'].contains(ext) ? ext : 'jpg';
    final path =
        'businesses/$businessId/profile/profile_${DateTime.now().millisecondsSinceEpoch}.$safeExt';
    final contentType = safeExt == 'png'
        ? 'image/png'
        : safeExt == 'webp'
        ? 'image/webp'
        : 'image/jpeg';
    final ref = firebase_storage.FirebaseStorage.instance.ref(path);
    await ref.putData(
      bytes,
      firebase_storage.SettableMetadata(contentType: contentType),
    );
    return _UploadedImage(path: path, url: await ref.getDownloadURL());
  }

  Future<void> _pickFeatureLogo() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 88,
      maxWidth: 800,
    );
    if (picked == null) return;
    final bytes = await picked.readAsBytes();
    if (!mounted) return;
    setState(() {
      _featureLogo = picked;
      _featureLogoBytes = bytes;
    });
  }

  Future<_UploadedImage?> _uploadFeatureLogo(String businessId) async {
    final image = _featureLogo;
    final bytes = _featureLogoBytes;
    if (image == null || bytes == null) return null;
    final ext = image.name.split('.').last.toLowerCase();
    final safeExt = ['jpg', 'jpeg', 'png', 'webp'].contains(ext) ? ext : 'png';
    final path =
        'businessLogos/$businessId/logo_${DateTime.now().millisecondsSinceEpoch}.$safeExt';
    final contentType = safeExt == 'jpg' || safeExt == 'jpeg'
        ? 'image/jpeg'
        : safeExt == 'webp'
        ? 'image/webp'
        : 'image/png';
    final ref = firebase_storage.FirebaseStorage.instance.ref(path);
    await ref.putData(
      bytes,
      firebase_storage.SettableMetadata(contentType: contentType),
    );
    return _UploadedImage(path: path, url: await ref.getDownloadURL());
  }

  Future<void> _requestFeaturing(BusinessProfile business) async {
    final l10n = AppLocalizations.of(context)!;
    final blurb = _featureBlurbController.text.trim();
    if (blurb.isEmpty || blurb.length > 140) {
      showErrorSnackBar(context, l10n.featureBlurbRequired);
      return;
    }
    if (!_featureConsent) {
      showErrorSnackBar(context, l10n.featureConsentRequired);
      return;
    }
    final existingLogo = (business.logoUrl ?? business.profileImageUrl ?? '')
        .trim();
    if (_featureLogoBytes == null && existingLogo.isEmpty) {
      showErrorSnackBar(context, l10n.featureLogoRequired);
      return;
    }

    setState(() => _isRequestingFeature = true);
    try {
      final uploaded = await _uploadFeatureLogo(business.id);
      final logoUrl = uploaded?.url ?? existingLogo;
      await FirebaseFunctions.instance.httpsCallable('requestFeaturing').call({
        'businessId': business.id,
        'marketingBlurb': blurb,
        'featureConsent': true,
        'logoUrl': logoUrl,
      });
      if (!mounted) return;
      setState(() {
        _featureLogo = null;
        _featureLogoBytes = null;
      });
      showSuccessSnackBar(context, l10n.featureRequestSent);
    } catch (error) {
      if (!mounted) return;
      showErrorSnackBar(context, '$error');
    } finally {
      if (mounted) setState(() => _isRequestingFeature = false);
    }
  }

  void _clearSectionError(_BusinessProfileSectionKey section) {
    if (!_sectionErrors.containsKey(section)) return;
    setState(() => _sectionErrors.remove(section));
  }

  GlobalKey _sectionKeyFor(_BusinessProfileSectionKey section) {
    switch (section) {
      case _BusinessProfileSectionKey.details:
        return _detailsSectionKey;
      case _BusinessProfileSectionKey.paidHoldPricing:
        return _paidHoldPricingSectionKey;
      case _BusinessProfileSectionKey.parkingCapacity:
        return _parkingCapacitySectionKey;
      case _BusinessProfileSectionKey.services:
        return _servicesSectionKey;
    }
  }

  void _showValidationErrors(
    Map<_BusinessProfileSectionKey, String> sectionErrors,
  ) {
    setState(() {
      _sectionErrors
        ..clear()
        ..addAll(sectionErrors);
    });
    final firstError = sectionErrors.entries.first;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(firstError.value),
        backgroundColor: AppColors.errorRed,
      ),
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final targetContext = _sectionKeyFor(firstError.key).currentContext;
      if (targetContext == null) return;
      Scrollable.ensureVisible(
        targetContext,
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOutCubic,
        alignment: 0.08,
      );
    });
  }

  Future<void> _save(BusinessProfile business) async {
    final l10n = AppLocalizations.of(context)!;
    final sectionErrors = <_BusinessProfileSectionKey, String>{};
    if (!_formKey.currentState!.validate()) {
      sectionErrors[_BusinessProfileSectionKey.details] =
          l10n.businessProfileDetailsSectionError;
    }
    if (_selectedServices.isEmpty) {
      sectionErrors[_BusinessProfileSectionKey.services] =
          l10n.chooseAtLeastOneService;
    }
    final holdFlatFee =
        double.tryParse(_holdFlatFeeController.text.trim()) ?? 0;
    final holdDailyRate =
        double.tryParse(_holdDailyRateController.text.trim()) ?? 0;
    final holdMaxDays = int.tryParse(_holdMaxDaysController.text.trim()) ?? 14;
    final parkingTotalSpaces =
        int.tryParse(_parkingTotalSpacesController.text.trim()) ?? 0;
    final parkingBlockedSpaces =
        int.tryParse(_parkingBlockedSpacesController.text.trim()) ?? 0;
    final parkingDailyRate =
        double.tryParse(_parkingDailyRateController.text.trim()) ?? 0;
    final parkingWeeklyRate =
        double.tryParse(_parkingWeeklyRateController.text.trim()) ?? 0;
    final parkingMonthlyRate =
        double.tryParse(_parkingMonthlyRateController.text.trim()) ?? 0;
    final parkingMinimumDays =
        int.tryParse(_parkingMinimumDaysController.text.trim()) ?? 1;
    final parkingPickupFee =
        double.tryParse(_parkingPickupFeeController.text.trim()) ?? 0;
    if ((_holdPricingMode == 'flat' && holdFlatFee <= 0) ||
        (_holdPricingMode == 'per_day' && holdDailyRate <= 0) ||
        holdMaxDays < 1 ||
        holdMaxDays > 30) {
      sectionErrors[_BusinessProfileSectionKey.paidHoldPricing] =
          l10n.enterValidPaidHoldPricing;
    }
    final offersParking = _selectedServices.contains(
      BusinessServiceKey.carParking.value,
    );
    final normalizedParkingState =
        normalizeUsState(_parkingStateController.text) ?? '';
    if (parkingCapacityNeedsAttention(
      offersParking: offersParking,
      addressLine1: _parkingAddressLine1Controller.text,
      country: _parkingCountryController.text,
      state: normalizedParkingState,
      city: _parkingCityController.text,
      totalSpaces: parkingTotalSpaces,
      blockedSpaces: parkingBlockedSpaces,
      dailyRate: parkingDailyRate,
      minimumDays: parkingMinimumDays,
    )) {
      sectionErrors[_BusinessProfileSectionKey.parkingCapacity] =
          l10n.enterValidParkingCapacity;
    }
    final pickupPlanError = _pickupPlanKey.currentState?.validate(l10n);
    if (pickupPlanError != null) {
      showErrorSnackBar(context, pickupPlanError);
      return;
    }
    if (sectionErrors.isNotEmpty) {
      _showValidationErrors(sectionErrors);
      return;
    }
    if (_sectionErrors.isNotEmpty) {
      setState(() => _sectionErrors.clear());
    }
    final changedParkingLocation = parkingLocationChanged(
      currentAddressLine1:
          business.parkingAddressLine1 ?? business.addressLine1 ?? '',
      currentCountry: business.parkingCountry ?? business.country ?? '',
      currentState:
          normalizeUsState(business.parkingState ?? business.state) ?? '',
      currentCity: business.parkingCity ?? business.city ?? '',
      nextAddressLine1: _parkingAddressLine1Controller.text,
      nextCountry: _parkingCountryController.text,
      nextState: normalizedParkingState,
      nextCity: _parkingCityController.text,
    );
    final parkingLatitude = changedParkingLocation
        ? null
        : business.parkingLatitude;
    final parkingLongitude = changedParkingLocation
        ? null
        : business.parkingLongitude;
    setState(() => _isSaving = true);
    try {
      final auth = context.read<AuthProvider>();
      final upload = await _uploadImage(business.id);
      await auth.updateBusinessProfile(
        businessId: business.id,
        name: _nameController.text,
        phone: _phoneController.text,
        email: _emailController.text,
        website: _websiteController.text,
        enabledServices: _selectedServices.toList(),
        profileImageUrl: upload?.url,
        profileImagePath: upload?.path,
        serviceNote: _noteController.text,
        addressLine1: _addressLine1Controller.text,
        city: _cityController.text,
        country: _countryController.text,
        state: normalizeUsState(_stateController.text) ?? '',
        postalCode: _postalCodeController.text,
        carHoldPricingMode: _holdPricingMode,
        carHoldFlatFee: holdFlatFee,
        carHoldDailyRate: holdDailyRate,
        carHoldMaxDays: holdMaxDays,
        parkingAddressLine1: _parkingAddressLine1Controller.text,
        parkingCity: _parkingCityController.text,
        parkingCountry: _parkingCountryController.text,
        parkingState: normalizeUsState(_parkingStateController.text) ?? '',
        parkingTotalSpaces: parkingTotalSpaces,
        parkingBlockedSpaces: parkingBlockedSpaces,
        parkingDailyRate: parkingDailyRate,
        parkingWeeklyRate: parkingWeeklyRate,
        parkingMonthlyRate: parkingMonthlyRate,
        parkingMinimumDays: parkingMinimumDays,
        parkingPickupAvailable: _parkingPickupAvailable,
        parkingPickupFee: parkingPickupFee,
        parkingInstructions: _parkingInstructionsController.text,
        parkingLatitude: parkingLatitude,
        parkingLongitude: parkingLongitude,
        freightPickupAvailable: _freightPickupAvailable,
        freightPickupModel: _freightPickupModel,
        freightPickupBaseFee:
            double.tryParse(_freightPickupBaseFeeController.text.trim()) ?? 0,
        freightPickupPerKm:
            double.tryParse(_freightPickupPerKmController.text.trim()) ?? 0,
        freightPickupMinFee:
            double.tryParse(_freightPickupMinFeeController.text.trim()) ?? 0,
        freightPickupMaxKm:
            double.tryParse(_freightPickupMaxKmController.text.trim()) ?? 0,
        freightPickupOriginAddress: _freightPickupOriginController.text.trim(),
        freightPickupBoroughPrices: {
          for (final entry in _freightPickupBoroughControllers.entries)
            if ((double.tryParse(entry.value.text.trim()) ?? 0) > 0)
              entry.key: double.parse(entry.value.text.trim()),
        },
        pickupPlan: _pickupPlanKey.currentState?.buildPlan(),
      );
      if (!mounted) return;
      setState(() {
        _image = null;
        _imageBytes = null;
      });
      showSuccessSnackBar(context, l10n.businessProfileSaved);
    } catch (error) {
      if (!mounted) return;
      showErrorSnackBar(context, '$error');
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final l10n = AppLocalizations.of(context)!;
    final businessId = auth.businessId;
    if (businessId == null || businessId.isEmpty) {
      return Scaffold(
        body: Center(child: Text(l10n.noBusinessProfileAssigned)),
      );
    }
    final canEdit = auth.isBusinessOwner || auth.isAdmin;
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: SafeArea(
        child: StreamBuilder<DocumentSnapshot>(
          stream: FirebaseFirestore.instance
              .collection('businesses')
              .doc(businessId)
              .snapshots(),
          builder: (context, snapshot) {
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            if (!snapshot.data!.exists) {
              return Center(child: Text(l10n.businessProfileNotFound));
            }
            final business = BusinessProfile.fromFirestore(snapshot.data!);
            _scheduleHydrate(business);
            final offersDestinationShipping =
                hasBusinessService(
                  business.enabledServices,
                  BusinessServiceKey.barrelShipping,
                ) ||
                hasBusinessService(
                  business.enabledServices,
                  BusinessServiceKey.sharedBarrels,
                ) ||
                hasBusinessService(
                  business.enabledServices,
                  BusinessServiceKey.freight,
                ) ||
                hasBusinessService(
                  business.enabledServices,
                  BusinessServiceKey.carTransport,
                );
            return ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 128),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        l10n.businessProfileTitle,
                        style: Theme.of(context).textTheme.headlineSmall
                            ?.copyWith(fontWeight: FontWeight.w900),
                      ),
                    ),
                    const LanguageToggle(),
                  ],
                ),
                const SizedBox(height: 18),
                _ProfileHeader(
                  business: business,
                  imageBytes: _imageBytes,
                  canEdit: canEdit,
                  onPickImage: _pickImage,
                ),
                const SizedBox(height: 18),
                _BusinessForm(
                  formKey: _formKey,
                  canEdit: canEdit,
                  detailsSectionKey: _detailsSectionKey,
                  paidHoldPricingSectionKey: _paidHoldPricingSectionKey,
                  parkingCapacitySectionKey: _parkingCapacitySectionKey,
                  servicesSectionKey: _servicesSectionKey,
                  sectionErrors: _sectionErrors,
                  onSectionEdited: _clearSectionError,
                  nameController: _nameController,
                  phoneController: _phoneController,
                  emailController: _emailController,
                  websiteController: _websiteController,
                  noteController: _noteController,
                  addressLine1Controller: _addressLine1Controller,
                  countryController: _countryController,
                  cityController: _cityController,
                  stateController: _stateController,
                  postalCodeController: _postalCodeController,
                  holdPricingMode: _holdPricingMode,
                  holdFlatFeeController: _holdFlatFeeController,
                  holdDailyRateController: _holdDailyRateController,
                  holdMaxDaysController: _holdMaxDaysController,
                  parkingAddressLine1Controller: _parkingAddressLine1Controller,
                  parkingCountryController: _parkingCountryController,
                  parkingCityController: _parkingCityController,
                  parkingStateController: _parkingStateController,
                  parkingTotalSpacesController: _parkingTotalSpacesController,
                  parkingBlockedSpacesController:
                      _parkingBlockedSpacesController,
                  parkingDailyRateController: _parkingDailyRateController,
                  parkingWeeklyRateController: _parkingWeeklyRateController,
                  parkingMonthlyRateController: _parkingMonthlyRateController,
                  parkingMinimumDaysController: _parkingMinimumDaysController,
                  parkingInstructionsController: _parkingInstructionsController,
                  onHoldPricingModeChanged: (value) {
                    setState(() => _holdPricingMode = value);
                  },
                  onAddressStateChanged: (value) {
                    setState(() {
                      _stateController.text = value ?? '';
                      _cityController.clear();
                    });
                  },
                  onAddressCountryChanged: (value) {
                    setState(() {
                      _countryController.text = value ?? '';
                      _stateController.clear();
                      _cityController.clear();
                    });
                  },
                  onAddressCityChanged: (value) {
                    setState(() => _cityController.text = value ?? '');
                  },
                  onParkingCountryChanged: (value) {
                    setState(() {
                      _parkingCountryController.text = value ?? '';
                      _parkingStateController.clear();
                      _parkingCityController.clear();
                    });
                  },
                  onParkingStateChanged: (value) {
                    setState(() {
                      _parkingStateController.text = value ?? '';
                      _parkingCityController.clear();
                    });
                  },
                  onParkingCityChanged: (value) {
                    setState(() => _parkingCityController.text = value ?? '');
                  },
                  selectedServices: _selectedServices,
                  onServiceChanged: (service, selected) {
                    setState(() {
                      if (selected) {
                        _selectedServices.add(service);
                      } else {
                        _selectedServices.remove(service);
                      }
                    });
                  },
                ),
                if (_selectedServices.any(
                  kPickupServiceByBusinessService.containsKey,
                )) ...[
                  const SizedBox(height: 18),
                  _Panel(
                    title: l10n.pickupPlanSectionTitle,
                    child: PickupPlanEditor(
                      key: _pickupPlanKey,
                      canEdit: canEdit,
                      isNewYorkBased: business.isNewYorkBased,
                      initialPlan: business.pickupPlan,
                      enabledServices: _selectedServices.toList(),
                    ),
                  ),
                ],
                if (offersDestinationShipping) ...[
                  const SizedBox(height: 18),
                  _OfficeLocationsPanel(
                    businessId: business.id,
                    canEdit: canEdit,
                  ),
                  const SizedBox(height: 18),
                  _DestinationSetupPanel(
                    businessId: business.id,
                    canEdit: canEdit,
                  ),
                ],
                const SizedBox(height: 18),
                _FeaturingRequestPanel(
                  business: business,
                  canEdit: canEdit,
                  blurbController: _featureBlurbController,
                  featureConsent: _featureConsent,
                  logoBytes: _featureLogoBytes,
                  isRequesting: _isRequestingFeature,
                  onConsentChanged: (value) {
                    setState(() => _featureConsent = value);
                  },
                  onPickLogo: _pickFeatureLogo,
                  onRequest: () => _requestFeaturing(business),
                ),
                if (canEdit) ...[
                  const SizedBox(height: 18),
                  SizedBox(
                    height: 52,
                    child: FilledButton.icon(
                      onPressed: _isSaving ? null : () => _save(business),
                      icon: _isSaving
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.save_outlined),
                      label: Text(_isSaving ? l10n.saving : l10n.saveChanges),
                    ),
                  ),
                ],
                const SizedBox(height: 18),
                TeamPanel(businessId: business.id, canAddStaff: canEdit),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _DestinationSetupPanel extends StatelessWidget {
  const _DestinationSetupPanel({
    required this.businessId,
    required this.canEdit,
  });

  final String businessId;
  final bool canEdit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return _Panel(
      title: l10n.destinationsAndShippingFees,
      child: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('businesses')
            .doc(businessId)
            .collection('destinationCountries')
            .snapshots(),
        builder: (context, snapshot) {
          final docs = snapshot.data?.docs ?? [];
          final activeCountries = docs
              .map(DestinationCountry.fromFirestore)
              .where((country) => country.isActive)
              .toList();
          final configuredActiveCount = activeCountries
              .where((country) => country.hasAnyServiceCoverage)
              .length;

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                activeCountries.isEmpty
                    ? l10n.selectCountriesAddFees
                    : l10n.activeDestinationsHaveFees(
                        configuredActiveCount,
                        activeCountries.length,
                      ),
                style: const TextStyle(
                  color: AppColors.muted,
                  fontWeight: FontWeight.w700,
                  height: 1.3,
                ),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: canEdit
                    ? () =>
                          Navigator.pushNamed(context, '/destination-countries')
                    : null,
                icon: const Icon(Icons.public),
                label: Text(
                  activeCountries.isEmpty
                      ? l10n.selectDestinationCountries
                      : l10n.manageDestinationsFees,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _OfficeLocationsPanel extends StatelessWidget {
  const _OfficeLocationsPanel({
    required this.businessId,
    required this.canEdit,
  });

  final String businessId;
  final bool canEdit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return _Panel(
      title: l10n.officeLocations,
      child: StreamBuilder<List<OfficeLocation>>(
        stream: OfficeLocationService().allLocations(businessId),
        builder: (context, snapshot) {
          final locations = snapshot.data ?? const <OfficeLocation>[];
          final activeCount = locations.where((item) => item.isActive).length;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                activeCount == 0
                    ? l10n.addOfficeLocationsHelp
                    : l10n.activeOfficeLocationsCount(activeCount),
                style: const TextStyle(
                  color: AppColors.muted,
                  fontWeight: FontWeight.w700,
                  height: 1.3,
                ),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: canEdit
                    ? () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) =>
                              OfficeLocationsScreen(businessId: businessId),
                        ),
                      )
                    : null,
                icon: const Icon(Icons.storefront_outlined),
                label: Text(
                  locations.isEmpty
                      ? l10n.addOfficeLocation
                      : l10n.manageOfficeLocations,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _FeaturingRequestPanel extends StatelessWidget {
  const _FeaturingRequestPanel({
    required this.business,
    required this.canEdit,
    required this.blurbController,
    required this.featureConsent,
    required this.logoBytes,
    required this.isRequesting,
    required this.onConsentChanged,
    required this.onPickLogo,
    required this.onRequest,
  });

  final BusinessProfile business;
  final bool canEdit;
  final TextEditingController blurbController;
  final bool featureConsent;
  final Uint8List? logoBytes;
  final bool isRequesting;
  final ValueChanged<bool> onConsentChanged;
  final VoidCallback onPickLogo;
  final VoidCallback onRequest;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final existingLogo = (business.logoUrl ?? business.profileImageUrl ?? '')
        .trim();
    final status = business.featureStatus.trim().isEmpty
        ? 'none'
        : business.featureStatus.trim();
    final isApproved = status == 'approved';
    final isRequested = status == 'requested';
    final canSubmit = canEdit && !isRequesting;
    final featureNote = business.featureNote?.trim() ?? '';

    return _Panel(
      title: l10n.featuredOnWebsite,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            isApproved
                ? l10n.featureApprovedMessage
                : isRequested
                ? l10n.featureRequestedMessage
                : l10n.featureDefaultMessage,
            style: const TextStyle(
              color: AppColors.muted,
              fontWeight: FontWeight.w700,
              height: 1.3,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Container(
                  width: 72,
                  height: 72,
                  color: AppColors.lightSurfaceVariant,
                  child: logoBytes != null
                      ? Image.memory(logoBytes!, fit: BoxFit.cover)
                      : existingLogo.isNotEmpty
                      ? Image.network(existingLogo, fit: BoxFit.cover)
                      : const Icon(
                          Icons.image_outlined,
                          color: AppColors.muted,
                        ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [_FeatureStatusBadge(status: status)],
                    ),
                    if (featureNote.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(
                        l10n.featureAdminNote(featureNote),
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: AppColors.saffron,
                          fontWeight: FontWeight.w800,
                          height: 1.25,
                        ),
                      ),
                    ],
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: canEdit ? onPickLogo : null,
                      icon: const Icon(Icons.upload_file_outlined),
                      label: Text(
                        existingLogo.isEmpty && logoBytes == null
                            ? l10n.uploadLogo
                            : l10n.changeLogo,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextFormField(
            controller: blurbController,
            enabled: canEdit,
            maxLength: 140,
            minLines: 2,
            maxLines: 4,
            decoration: InputDecoration(
              labelText: l10n.shortPublicBlurb,
              helperText: l10n.shortPublicBlurbHelper,
              prefixIcon: const Icon(Icons.campaign_outlined),
              filled: true,
              fillColor: AppColors.lightSurfaceVariant,
            ),
          ),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: featureConsent,
            controlAffinity: ListTileControlAffinity.leading,
            onChanged: canEdit
                ? (value) => onConsentChanged(value ?? false)
                : null,
            title: Text(
              l10n.featureConsentLabel,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: canSubmit ? onRequest : null,
              icon: isRequesting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.public_outlined),
              label: Text(
                isRequesting
                    ? l10n.sendingFeatureRequest
                    : l10n.requestFeaturing,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FeatureStatusBadge extends StatelessWidget {
  const _FeatureStatusBadge({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.mist.withValues(alpha: 0.58),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: AppColors.rule),
      ),
      child: Text(
        status,
        style: const TextStyle(
          color: AppColors.cobaltDeep,
          fontWeight: FontWeight.w900,
          fontSize: 12,
        ),
      ),
    );
  }
}

class TeamPanel extends StatelessWidget {
  const TeamPanel({
    super.key,
    required this.businessId,
    this.canAddStaff = true,
  });

  final String businessId;
  final bool canAddStaff;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return _Panel(
      title: l10n.team,
      child: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('users')
            .where('businessId', isEqualTo: businessId)
            .where('role', whereIn: ['staff', 'businessOwner'])
            .snapshots(),
        builder: (context, snapshot) {
          final users = snapshot.data?.docs ?? [];
          return Column(
            children: [
              if (canAddStaff)
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    onPressed: () => Navigator.pushNamed(context, '/add-staff'),
                    icon: const Icon(Icons.person_add_alt_1),
                    label: Text(l10n.addStaffMemberButton),
                  ),
                ),
              if (users.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 24),
                  child: Text(l10n.noTeamMembersYet),
                )
              else
                ...users.map((doc) {
                  final data = doc.data() as Map<String, dynamic>;
                  final name = (data['fullName'] as String?)?.trim();
                  final email = (data['email'] as String?) ?? '';
                  final phone = (data['phone'] as String?) ?? '';
                  final imageUrl = data['profileImageUrl'] as String?;
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: CircleAvatar(
                      backgroundImage: imageUrl == null || imageUrl.isEmpty
                          ? null
                          : NetworkImage(imageUrl),
                      child: imageUrl == null || imageUrl.isEmpty
                          ? const Icon(Icons.person_outline)
                          : null,
                    ),
                    title: Text(
                      name == null || name.isEmpty ? email : name,
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    subtitle: Text(
                      [
                        email,
                        phone,
                        data['role'],
                      ].where((item) => '$item'.trim().isNotEmpty).join(' • '),
                    ),
                  );
                }),
            ],
          );
        },
      ),
    );
  }
}

class _UploadedImage {
  const _UploadedImage({required this.path, required this.url});

  final String path;
  final String url;
}

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({
    required this.business,
    required this.imageBytes,
    required this.canEdit,
    required this.onPickImage,
  });

  final BusinessProfile business;
  final Uint8List? imageBytes;
  final bool canEdit;
  final VoidCallback onPickImage;

  @override
  Widget build(BuildContext context) {
    final existingUrl = business.profileImageUrl;
    final l10n = AppLocalizations.of(context)!;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.cobaltDeep,
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: AppColors.cobaltDeep.withValues(alpha: 0.14),
            blurRadius: 18,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Row(
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              GestureDetector(
                onTap: canEdit ? onPickImage : null,
                child: CircleAvatar(
                  radius: 38,
                  backgroundColor: Colors.white.withValues(alpha: 0.12),
                  backgroundImage: imageBytes != null
                      ? MemoryImage(imageBytes!)
                      : existingUrl == null || existingUrl.isEmpty
                      ? null
                      : NetworkImage(existingUrl),
                  child:
                      imageBytes == null &&
                          (existingUrl == null || existingUrl.isEmpty)
                      ? const Icon(
                          Icons.storefront_outlined,
                          color: Colors.white,
                          size: 34,
                        )
                      : null,
                ),
              ),
              if (canEdit)
                Positioned(
                  right: -4,
                  bottom: -4,
                  child: IconButton.filled(
                    onPressed: onPickImage,
                    style: IconButton.styleFrom(
                      backgroundColor: AppColors.saffron,
                      foregroundColor: Colors.white,
                      minimumSize: const Size(34, 34),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    icon: const Icon(Icons.photo_camera_outlined, size: 18),
                  ),
                ),
            ],
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  business.name,
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w900,
                    color: Colors.white,
                    height: 1.05,
                  ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _MiniStatusChip(
                      icon: business.isApproved
                          ? Icons.verified_outlined
                          : Icons.hourglass_top_outlined,
                      label: business.status,
                    ),
                    _MiniStatusChip(
                      icon: Icons.design_services_outlined,
                      label: l10n.businessServicesCount(
                        business.enabledServices.length,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MiniStatusChip extends StatelessWidget {
  const _MiniStatusChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withValues(alpha: 0.16)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: Colors.white, size: 15),
          const SizedBox(width: 5),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class _BusinessForm extends StatelessWidget {
  const _BusinessForm({
    required this.formKey,
    required this.canEdit,
    required this.detailsSectionKey,
    required this.paidHoldPricingSectionKey,
    required this.parkingCapacitySectionKey,
    required this.servicesSectionKey,
    required this.sectionErrors,
    required this.onSectionEdited,
    required this.nameController,
    required this.phoneController,
    required this.emailController,
    required this.websiteController,
    required this.noteController,
    required this.addressLine1Controller,
    required this.countryController,
    required this.cityController,
    required this.stateController,
    required this.postalCodeController,
    required this.holdPricingMode,
    required this.holdFlatFeeController,
    required this.holdDailyRateController,
    required this.holdMaxDaysController,
    required this.parkingAddressLine1Controller,
    required this.parkingCountryController,
    required this.parkingCityController,
    required this.parkingStateController,
    required this.parkingTotalSpacesController,
    required this.parkingBlockedSpacesController,
    required this.parkingDailyRateController,
    required this.parkingWeeklyRateController,
    required this.parkingMonthlyRateController,
    required this.parkingMinimumDaysController,
    required this.parkingInstructionsController,
    required this.onHoldPricingModeChanged,
    required this.onAddressCountryChanged,
    required this.onAddressStateChanged,
    required this.onAddressCityChanged,
    required this.onParkingCountryChanged,
    required this.onParkingStateChanged,
    required this.onParkingCityChanged,
    required this.selectedServices,
    required this.onServiceChanged,
  });

  final GlobalKey<FormState> formKey;
  final bool canEdit;
  final GlobalKey detailsSectionKey;
  final GlobalKey paidHoldPricingSectionKey;
  final GlobalKey parkingCapacitySectionKey;
  final GlobalKey servicesSectionKey;
  final Map<_BusinessProfileSectionKey, String> sectionErrors;
  final ValueChanged<_BusinessProfileSectionKey> onSectionEdited;
  final TextEditingController nameController;
  final TextEditingController phoneController;
  final TextEditingController emailController;
  final TextEditingController websiteController;
  final TextEditingController noteController;
  final TextEditingController addressLine1Controller;
  final TextEditingController countryController;
  final TextEditingController cityController;
  final TextEditingController stateController;
  final TextEditingController postalCodeController;
  final String holdPricingMode;
  final TextEditingController holdFlatFeeController;
  final TextEditingController holdDailyRateController;
  final TextEditingController holdMaxDaysController;
  final TextEditingController parkingAddressLine1Controller;
  final TextEditingController parkingCountryController;
  final TextEditingController parkingCityController;
  final TextEditingController parkingStateController;
  final TextEditingController parkingTotalSpacesController;
  final TextEditingController parkingBlockedSpacesController;
  final TextEditingController parkingDailyRateController;
  final TextEditingController parkingWeeklyRateController;
  final TextEditingController parkingMonthlyRateController;
  final TextEditingController parkingMinimumDaysController;
  final TextEditingController parkingInstructionsController;
  final ValueChanged<String> onHoldPricingModeChanged;
  final ValueChanged<String?> onAddressCountryChanged;
  final ValueChanged<String?> onAddressStateChanged;
  final ValueChanged<String?> onAddressCityChanged;
  final ValueChanged<String?> onParkingCountryChanged;
  final ValueChanged<String?> onParkingStateChanged;
  final ValueChanged<String?> onParkingCityChanged;
  final Set<String> selectedServices;
  final void Function(String service, bool selected) onServiceChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final selectedCountry = countryController.text.trim();
    final isUnitedStates = selectedCountry == 'United States';
    final parkingCountry = parkingCountryController.text.trim();
    final parkingIsUnitedStates = parkingCountry == 'United States';
    final offersParking = selectedServices.contains(
      BusinessServiceKey.carParking.value,
    );
    return Form(
      key: formKey,
      child: Column(
        children: [
          _ProfileSection(
            key: detailsSectionKey,
            icon: Icons.badge_outlined,
            title: l10n.details,
            subtitle: l10n.businessIdentitySubtitle,
            errorText: sectionErrors[_BusinessProfileSectionKey.details],
            children: [
              _BusinessProfileField(
                controller: nameController,
                enabled: canEdit,
                label: l10n.businessName,
                icon: Icons.storefront_outlined,
                onChanged: () =>
                    onSectionEdited(_BusinessProfileSectionKey.details),
                validator: (value) => value == null || value.trim().isEmpty
                    ? l10n.businessNameRequired
                    : null,
              ),
              CountryPhoneField(
                controller: phoneController,
                enabled: canEdit,
                labelText: l10n.businessPhone,
                decoration: InputDecoration(
                  filled: true,
                  fillColor: canEdit
                      ? AppColors.lightSurfaceVariant
                      : AppColors.cream,
                ),
                onChanged: (_) =>
                    onSectionEdited(_BusinessProfileSectionKey.details),
                validator: (value) {
                  final trimmed = value?.trim() ?? '';
                  if (trimmed.isEmpty) return null;
                  return PhoneNumberValidator.validate(
                    trimmed,
                    requiredMessage: l10n.businessPhoneRequired,
                    invalidMessage: l10n.validBusinessPhoneRequired,
                  );
                },
              ),
              _BusinessProfileField(
                controller: emailController,
                enabled: canEdit,
                label: l10n.businessEmail,
                icon: Icons.mail_outline,
                keyboardType: TextInputType.emailAddress,
                onChanged: () =>
                    onSectionEdited(_BusinessProfileSectionKey.details),
              ),
              _BusinessProfileField(
                controller: websiteController,
                enabled: canEdit,
                label: l10n.website,
                icon: Icons.language_outlined,
                keyboardType: TextInputType.url,
                onChanged: () =>
                    onSectionEdited(_BusinessProfileSectionKey.details),
              ),
              _BusinessProfileField(
                controller: noteController,
                enabled: canEdit,
                label: l10n.serviceNote,
                icon: Icons.notes_outlined,
                minLines: 2,
                maxLines: 4,
                onChanged: () =>
                    onSectionEdited(_BusinessProfileSectionKey.details),
              ),
            ],
          ),
          const SizedBox(height: 18),
          _ProfileSection(
            icon: Icons.location_on_outlined,
            title: l10n.businessLocation,
            subtitle: l10n.businessDefaultAddressSubtitle,
            children: [
              _BusinessProfileField(
                controller: addressLine1Controller,
                enabled: canEdit,
                label: l10n.businessAddressLine1,
                icon: Icons.place_outlined,
              ),
              _BusinessProfileDropdown(
                label: l10n.countryName,
                icon: Icons.public_outlined,
                enabled: canEdit,
                value: selectedCountry.isEmpty ? null : selectedCountry,
                values: businessCountryOptions(selectedCountry),
                displayLabel: (value) => value,
                onChanged: onAddressCountryChanged,
              ),
              if (isUnitedStates)
                _BusinessProfileDropdown(
                  label: l10n.locationState,
                  icon: Icons.map_outlined,
                  enabled: canEdit,
                  value: normalizeUsState(stateController.text),
                  values: usStateOptions(stateController.text),
                  displayLabel: (value) => usStateNames[value] ?? value,
                  onChanged: onAddressStateChanged,
                ),
              _BusinessProfileDropdown(
                label: l10n.locationCity,
                icon: Icons.location_city_outlined,
                enabled:
                    canEdit &&
                    (isUnitedStates
                        ? stateController.text.trim().isNotEmpty
                        : selectedCountry.isNotEmpty),
                value: cityController.text.trim().isEmpty
                    ? null
                    : cityController.text.trim(),
                values: isUnitedStates
                    ? usCityOptions(stateController.text, cityController.text)
                    : businessCityOptions(selectedCountry, cityController.text),
                hintText: isUnitedStates && stateController.text.trim().isEmpty
                    ? l10n.selectStateFirst
                    : selectedCountry.isEmpty
                    ? l10n.selectCountryFirst
                    : null,
                displayLabel: (value) =>
                    value == otherCityValue ? l10n.otherOption : value,
                onChanged: onAddressCityChanged,
              ),
              _BusinessProfileField(
                controller: postalCodeController,
                enabled: canEdit,
                label: l10n.postalCode,
                icon: Icons.local_post_office_outlined,
              ),
            ],
          ),
          const SizedBox(height: 18),
          _ProfileSection(
            key: paidHoldPricingSectionKey,
            icon: Icons.lock_clock_outlined,
            title: l10n.paidHoldPricing,
            subtitle: l10n.paidHoldPricingSubtitle,
            errorText:
                sectionErrors[_BusinessProfileSectionKey.paidHoldPricing],
            children: [
              SizedBox(
                width: double.infinity,
                child: SegmentedButton<String>(
                  segments: [
                    ButtonSegment(
                      value: 'flat',
                      icon: const Icon(Icons.payments_outlined),
                      label: Text(l10n.flatFee),
                    ),
                    ButtonSegment(
                      value: 'per_day',
                      icon: const Icon(Icons.calendar_month_outlined),
                      label: Text(l10n.perDay),
                    ),
                  ],
                  selected: {holdPricingMode},
                  onSelectionChanged: canEdit
                      ? (values) {
                          onSectionEdited(
                            _BusinessProfileSectionKey.paidHoldPricing,
                          );
                          onHoldPricingModeChanged(values.first);
                        }
                      : null,
                ),
              ),
              Row(
                children: [
                  Expanded(
                    child: _BusinessProfileField(
                      controller: holdPricingMode == 'flat'
                          ? holdFlatFeeController
                          : holdDailyRateController,
                      enabled: canEdit,
                      label: holdPricingMode == 'flat'
                          ? l10n.flatHoldFee
                          : l10n.dailyHoldRate,
                      icon: Icons.attach_money,
                      keyboardType: TextInputType.number,
                      onChanged: () => onSectionEdited(
                        _BusinessProfileSectionKey.paidHoldPricing,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _BusinessProfileField(
                      controller: holdMaxDaysController,
                      enabled: canEdit,
                      label: l10n.maxDays,
                      icon: Icons.event_busy_outlined,
                      keyboardType: TextInputType.number,
                      helperText: l10n.holdMaxDaysHelper,
                      onChanged: () => onSectionEdited(
                        _BusinessProfileSectionKey.paidHoldPricing,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 18),
          if (offersParking) ...[
            _ProfileSection(
              key: parkingCapacitySectionKey,
              icon: Icons.local_parking_outlined,
              title: l10n.parkingCapacityTitle,
              subtitle: l10n.parkingCapacitySubtitle,
              errorText:
                  sectionErrors[_BusinessProfileSectionKey.parkingCapacity],
              children: [
                _BusinessProfileField(
                  controller: parkingAddressLine1Controller,
                  enabled: canEdit,
                  label: l10n.parkingAddress,
                  icon: Icons.place_outlined,
                  onChanged: () => onSectionEdited(
                    _BusinessProfileSectionKey.parkingCapacity,
                  ),
                ),
                _BusinessProfileDropdown(
                  label: l10n.countryName,
                  icon: Icons.public_outlined,
                  enabled: canEdit,
                  value: parkingCountry.isEmpty ? null : parkingCountry,
                  values: businessCountryOptions(parkingCountry),
                  displayLabel: (value) => value,
                  onChanged: (value) {
                    onSectionEdited(_BusinessProfileSectionKey.parkingCapacity);
                    onParkingCountryChanged(value);
                  },
                ),
                if (parkingIsUnitedStates)
                  _BusinessProfileDropdown(
                    label: l10n.locationState,
                    icon: Icons.map_outlined,
                    enabled: canEdit,
                    value: normalizeUsState(parkingStateController.text),
                    values: usStateOptions(parkingStateController.text),
                    displayLabel: (value) => usStateNames[value] ?? value,
                    onChanged: (value) {
                      onSectionEdited(
                        _BusinessProfileSectionKey.parkingCapacity,
                      );
                      onParkingStateChanged(value);
                    },
                  ),
                _BusinessProfileDropdown(
                  label: l10n.locationCity,
                  icon: Icons.location_city_outlined,
                  enabled:
                      canEdit &&
                      (parkingIsUnitedStates
                          ? parkingStateController.text.trim().isNotEmpty
                          : parkingCountry.isNotEmpty),
                  value: parkingCityController.text.trim().isEmpty
                      ? null
                      : parkingCityController.text.trim(),
                  values: parkingIsUnitedStates
                      ? usCityOptions(
                          parkingStateController.text,
                          parkingCityController.text,
                        )
                      : businessCityOptions(
                          parkingCountry,
                          parkingCityController.text,
                        ),
                  hintText:
                      parkingIsUnitedStates &&
                          parkingStateController.text.trim().isEmpty
                      ? l10n.selectStateFirst
                      : parkingCountry.isEmpty
                      ? l10n.selectCountryFirst
                      : null,
                  displayLabel: (value) =>
                      value == otherCityValue ? l10n.otherOption : value,
                  onChanged: (value) {
                    onSectionEdited(_BusinessProfileSectionKey.parkingCapacity);
                    onParkingCityChanged(value);
                  },
                ),
                _ResponsiveFieldPair(
                  first: _BusinessProfileField(
                    controller: parkingTotalSpacesController,
                    enabled: canEdit,
                    label: l10n.totalParkingSpaces,
                    icon: Icons.directions_car_outlined,
                    keyboardType: TextInputType.number,
                    onChanged: () => onSectionEdited(
                      _BusinessProfileSectionKey.parkingCapacity,
                    ),
                  ),
                  second: _BusinessProfileField(
                    controller: parkingBlockedSpacesController,
                    enabled: canEdit,
                    label: l10n.blockedParkingSpaces,
                    icon: Icons.block_outlined,
                    keyboardType: TextInputType.number,
                    onChanged: () => onSectionEdited(
                      _BusinessProfileSectionKey.parkingCapacity,
                    ),
                  ),
                ),
                _ResponsiveFieldPair(
                  first: _BusinessProfileField(
                    controller: parkingDailyRateController,
                    enabled: canEdit,
                    label: l10n.dailyParkingRate,
                    icon: Icons.attach_money,
                    keyboardType: TextInputType.number,
                    onChanged: () => onSectionEdited(
                      _BusinessProfileSectionKey.parkingCapacity,
                    ),
                  ),
                  second: _BusinessProfileField(
                    controller: parkingMinimumDaysController,
                    enabled: canEdit,
                    label: l10n.minimumParkingDays,
                    icon: Icons.event_outlined,
                    keyboardType: TextInputType.number,
                    onChanged: () => onSectionEdited(
                      _BusinessProfileSectionKey.parkingCapacity,
                    ),
                  ),
                ),
                _ResponsiveFieldPair(
                  first: _BusinessProfileField(
                    controller: parkingWeeklyRateController,
                    enabled: canEdit,
                    label: l10n.weeklyParkingRate,
                    icon: Icons.calendar_view_week_outlined,
                    keyboardType: TextInputType.number,
                    onChanged: () => onSectionEdited(
                      _BusinessProfileSectionKey.parkingCapacity,
                    ),
                  ),
                  second: _BusinessProfileField(
                    controller: parkingMonthlyRateController,
                    enabled: canEdit,
                    label: l10n.monthlyParkingRate,
                    icon: Icons.calendar_month_outlined,
                    keyboardType: TextInputType.number,
                    onChanged: () => onSectionEdited(
                      _BusinessProfileSectionKey.parkingCapacity,
                    ),
                  ),
                ),
                _BusinessProfileField(
                  controller: parkingInstructionsController,
                  enabled: canEdit,
                  label: l10n.parkingInstructions,
                  icon: Icons.notes_outlined,
                  minLines: 2,
                  maxLines: 4,
                  onChanged: () => onSectionEdited(
                    _BusinessProfileSectionKey.parkingCapacity,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
          ],
          _ProfileSection(
            key: servicesSectionKey,
            icon: Icons.apps_outlined,
            title: l10n.services,
            subtitle: l10n.businessServicesSubtitle,
            errorText: sectionErrors[_BusinessProfileSectionKey.services],
            children: [
              for (final service in businessServiceCatalog) ...[
                _ServiceChoiceCard(
                  service: service,
                  selected: selectedServices.contains(service.key.value),
                  enabled: canEdit,
                  onChanged: (value) {
                    onSectionEdited(_BusinessProfileSectionKey.services);
                    if (service.key == BusinessServiceKey.carParking) {
                      onSectionEdited(
                        _BusinessProfileSectionKey.parkingCapacity,
                      );
                    }
                    onServiceChanged(service.key.value, value);
                  },
                ),
                if (service != businessServiceCatalog.last)
                  const SizedBox(height: 10),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _ProfileSection extends StatelessWidget {
  const _ProfileSection({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.children,
    this.errorText,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final List<Widget> children;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    final hasError = errorText != null;
    final accentColor = hasError ? AppColors.errorRed : AppColors.cobaltDeep;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: hasError
            ? AppColors.errorRed.withValues(alpha: 0.035)
            : AppColors.paper,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: hasError
              ? AppColors.errorRed.withValues(alpha: 0.58)
              : AppColors.rule,
          width: hasError ? 1.6 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: hasError
                      ? AppColors.errorRed.withValues(alpha: 0.09)
                      : AppColors.mist.withValues(alpha: 0.65),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, color: accentColor),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w900,
                        color: hasError ? AppColors.errorRed : AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: AppColors.muted,
                        height: 1.25,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (hasError) ...[
                      const SizedBox(height: 8),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            Icons.error_outline,
                            size: 17,
                            color: AppColors.errorRed,
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              errorText!,
                              style: const TextStyle(
                                color: AppColors.errorRed,
                                fontWeight: FontWeight.w800,
                                height: 1.25,
                                fontSize: 12,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          for (var index = 0; index < children.length; index++) ...[
            children[index],
            if (index != children.length - 1) const SizedBox(height: 12),
          ],
        ],
      ),
    );
  }
}

class _ResponsiveFieldPair extends StatelessWidget {
  const _ResponsiveFieldPair({required this.first, required this.second});

  final Widget first;
  final Widget second;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 360) {
          return Column(children: [first, const SizedBox(height: 12), second]);
        }
        return Row(
          children: [
            Expanded(child: first),
            const SizedBox(width: 10),
            Expanded(child: second),
          ],
        );
      },
    );
  }
}

class _BusinessProfileField extends StatelessWidget {
  const _BusinessProfileField({
    required this.controller,
    required this.enabled,
    required this.label,
    required this.icon,
    this.keyboardType,
    this.validator,
    this.minLines = 1,
    this.maxLines = 1,
    this.helperText,
    this.onChanged,
  });

  final TextEditingController controller;
  final bool enabled;
  final String label;
  final IconData icon;
  final TextInputType? keyboardType;
  final String? Function(String?)? validator;
  final int minLines;
  final int maxLines;
  final String? helperText;
  final VoidCallback? onChanged;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      enabled: enabled,
      keyboardType: keyboardType,
      validator: validator,
      onChanged: onChanged == null ? null : (_) => onChanged!(),
      minLines: minLines,
      maxLines: maxLines,
      decoration: InputDecoration(
        labelText: label,
        helperText: helperText,
        prefixIcon: Icon(icon),
        filled: true,
        fillColor: enabled ? AppColors.lightSurfaceVariant : AppColors.cream,
      ),
    );
  }
}

class _BusinessProfileDropdown extends StatelessWidget {
  const _BusinessProfileDropdown({
    required this.label,
    required this.icon,
    required this.enabled,
    required this.value,
    required this.values,
    required this.displayLabel,
    required this.onChanged,
    this.hintText,
  });

  final String label;
  final IconData icon;
  final bool enabled;
  final String? value;
  final List<String> values;
  final String Function(String value) displayLabel;
  final ValueChanged<String?> onChanged;
  final String? hintText;

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      key: ValueKey<String>('$label-$value-${values.join('|')}'),
      initialValue: value != null && values.contains(value) ? value : null,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon),
        filled: true,
        fillColor: enabled ? AppColors.lightSurfaceVariant : AppColors.cream,
      ),
      hint: hintText == null ? null : Text(hintText!),
      items: values
          .map(
            (item) => DropdownMenuItem<String>(
              value: item,
              child: Text(displayLabel(item)),
            ),
          )
          .toList(),
      onChanged: enabled ? onChanged : null,
    );
  }
}

class _ServiceChoiceCard extends StatelessWidget {
  const _ServiceChoiceCard({
    required this.service,
    required this.selected,
    required this.enabled,
    required this.onChanged,
  });

  final BusinessServiceDefinition service;
  final bool selected;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: enabled ? () => onChanged(!selected) : null,
      borderRadius: BorderRadius.circular(8),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected
              ? AppColors.mist.withValues(alpha: 0.42)
              : AppColors.lightSurfaceVariant,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: selected ? AppColors.cobalt : AppColors.rule,
            width: selected ? 1.4 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: selected
                    ? AppColors.cobalt.withValues(alpha: 0.12)
                    : AppColors.paper,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(
                service.icon,
                color: selected ? AppColors.cobaltDeep : AppColors.muted,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    service.label,
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    service.description,
                    style: const TextStyle(
                      color: AppColors.muted,
                      height: 1.25,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Icon(
              selected
                  ? Icons.check_circle_rounded
                  : Icons.radio_button_unchecked,
              color: selected ? AppColors.cobalt : AppColors.muted,
            ),
          ],
        ),
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({this.title, required this.child});

  final String? title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null) ...[
            Text(
              title!,
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 12),
          ],
          child,
        ],
      ),
    );
  }
}
