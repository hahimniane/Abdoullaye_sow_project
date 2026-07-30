import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/barrel_shipment.dart';
import '../models/business_destination_option.dart';
import '../models/destination_country.dart';
import '../providers/auth_provider.dart';
import '../services/barrel_shipment_service.dart';
import '../services/business_service.dart';
import '../services/destination_country_service.dart';
import '../utils/action_confirmation.dart';
import '../utils/barrel_receipt_generator.dart';
import '../utils/receiver_phone_rules.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/container_tracking_card.dart';
import '../widgets/country_phone_field.dart';
import '../widgets/destination_country_field.dart';
import '../widgets/language_toggle.dart';
import '../widgets/shipment_tracking_section.dart';
import '../widgets/support_entry_button.dart';
import '../theme/app_colors.dart';
import '../widgets/marketplace_transaction_disclosure.dart';

class BarrelShipmentDetailsScreen extends StatefulWidget {
  const BarrelShipmentDetailsScreen({super.key, required this.shipment});

  final BarrelShipment shipment;

  @override
  State<BarrelShipmentDetailsScreen> createState() =>
      _BarrelShipmentDetailsScreenState();
}

class _BarrelShipmentDetailsScreenState
    extends State<BarrelShipmentDetailsScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _senderNameController;
  late final TextEditingController _senderAddressController;
  late final TextEditingController _receiverNameController;
  late final TextEditingController _receiverPhoneController;
  late final TextEditingController _priceController;

  final _shipmentService = BarrelShipmentService();
  late BarrelShipment _currentShipment;
  late String _statusDraft;
  String? _destinationCountryIdDraft;
  String? _businessIdDraft;
  DateTime? _pickupDateTimeDraft;
  List<DestinationCountry> _destinationCountries = [];
  List<BusinessDestinationOption> _destinationOptions = [];
  bool _isSaving = false;
  bool _hasDraftChanges = false;

  StreamSubscription<DocumentSnapshot>? _subscription;
  StreamSubscription<List<DestinationCountry>>? _countriesSubscription;
  StreamSubscription<List<BusinessDestinationOption>>? _optionsSubscription;

  static const _statusOptions = [
    'pending_payment',
    'pending',
    'in_transit',
    'completed',
    'cancelled',
  ];

  @override
  void initState() {
    super.initState();
    _senderNameController = TextEditingController();
    _senderAddressController = TextEditingController();
    _receiverNameController = TextEditingController();
    _receiverPhoneController = TextEditingController();
    _priceController = TextEditingController();
    _applyShipment(widget.shipment, updateFields: true);
    for (final controller in [
      _senderNameController,
      _senderAddressController,
      _receiverNameController,
      _receiverPhoneController,
      _priceController,
    ]) {
      controller.addListener(_updateDraftChangeState);
    }
    _subscription = FirebaseFirestore.instance
        .collection('barrelShipments')
        .doc(widget.shipment.id)
        .snapshots()
        .listen(_handleSnapshot);
    _countriesSubscription = DestinationCountryService()
        .activeCountries()
        .listen((countries) {
          if (!mounted) return;
          setState(() {
            _destinationCountries = countries;
          });
        });
    _optionsSubscription = BusinessService().activeDestinationOptions().listen((
      options,
    ) {
      if (!mounted) return;
      setState(() {
        _destinationOptions = options;
      });
    });
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _countriesSubscription?.cancel();
    _optionsSubscription?.cancel();
    _senderNameController.dispose();
    _senderAddressController.dispose();
    _receiverNameController.dispose();
    _receiverPhoneController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  void _updateDraftChangeState() {
    if (!mounted) return;
    final next = _hasUnsavedChanges;
    if (next == _hasDraftChanges) return;
    setState(() {
      _hasDraftChanges = next;
    });
  }

  void _setDraftState(VoidCallback update) {
    setState(() {
      update();
      _hasDraftChanges = _hasUnsavedChanges;
    });
  }

  void _handleSnapshot(DocumentSnapshot snapshot) {
    if (!snapshot.exists) {
      return;
    }
    final latest = BarrelShipment.fromFirestore(snapshot);
    final hasLocalChanges = _hasUnsavedChanges;

    if (!mounted) return;

    setState(() {
      final shouldSync = !_isSaving && !hasLocalChanges;
      _applyShipment(latest, updateFields: shouldSync, syncStatus: shouldSync);
    });
  }

  void _applyShipment(
    BarrelShipment shipment, {
    bool updateFields = false,
    bool syncStatus = true,
  }) {
    _currentShipment = shipment;
    if (syncStatus) {
      _statusDraft = shipment.status;
    }
    if (updateFields) {
      _destinationCountryIdDraft = shipment.destinationCountryId;
      _businessIdDraft = shipment.businessId;
      _pickupDateTimeDraft = shipment.pickupDateTime;
      _senderNameController.text = shipment.senderName;
      _senderAddressController.text = shipment.senderAddress;
      _receiverNameController.text = shipment.receiverName;
      _receiverPhoneController.text = shipment.receiverPhone;
      _priceController.text = _formatPrice(shipment.price);
    }
    _hasDraftChanges = _hasUnsavedChanges;
  }

  bool get _hasUnsavedChanges {
    final shipment = _currentShipment;
    return _senderNameController.text.trim() != shipment.senderName ||
        _senderAddressController.text.trim() != shipment.senderAddress ||
        _destinationCountryIdDraft != shipment.destinationCountryId ||
        _businessIdDraft != shipment.businessId ||
        _receiverNameController.text.trim() != shipment.receiverName ||
        _receiverPhoneController.text.trim() != shipment.receiverPhone ||
        _pickupDateTimeDraft != shipment.pickupDateTime ||
        _parsePrice(_priceController.text.trim()) != shipment.price ||
        _statusDraft != shipment.status;
  }

  bool get _isCompleted => _currentShipment.status == 'completed';

  bool _isShipmentOwner(AuthProvider auth) {
    final uid = auth.user?.uid;
    return uid != null && uid == _currentShipment.customerUid;
  }

  bool _customerEditWindowOpen(AuthProvider auth) {
    final pickupDateTime = _currentShipment.pickupDateTime;
    return _isShipmentOwner(auth) &&
        !auth.hasBusinessDashboardAccess &&
        (pickupDateTime == null || DateTime.now().isBefore(pickupDateTime)) &&
        _currentShipment.status == 'pending';
  }

  bool _canEditDetails(AuthProvider auth) {
    return (auth.isAdmin && !_isCompleted) || _customerEditWindowOpen(auth);
  }

  bool _canEditAdminFields(AuthProvider auth) {
    return auth.isAdmin && !_isCompleted;
  }

  String _formatPrice(double value) {
    if (value % 1 == 0) {
      return value.toStringAsFixed(0);
    }
    return value.toStringAsFixed(2);
  }

  double? _parsePrice(String value) {
    return double.tryParse(value);
  }

  DestinationCountry? get _selectedDestinationDraft {
    final id = _destinationCountryIdDraft;
    if (id == null) return null;
    for (final country in _destinationCountries) {
      if (country.id == id) return country;
    }
    return null;
  }

  BusinessDestinationOption? get _selectedDestinationOptionDraft {
    final countryId = _destinationCountryIdDraft;
    final businessId = _businessIdDraft;
    if (countryId == null || businessId == null) return null;
    for (final option in _destinationOptions) {
      if (option.country.id == countryId && option.businessId == businessId) {
        return option;
      }
    }
    return null;
  }

  double? get _destinationDifference {
    final selected = _selectedDestinationDraft;
    if (selected == null ||
        _destinationCountryIdDraft == _currentShipment.destinationCountryId) {
      return null;
    }
    final option = _selectedDestinationOptionDraft;
    final nextShippingFee =
        option?.country.barrelShippingPrice ?? selected.barrelShippingPrice;
    return nextShippingFee - _currentShipment.shippingFee;
  }

  Future<void> _handleDestinationCountryChanged(
    DestinationCountry? country,
  ) async {
    if (country == null) {
      _setDraftState(() {
        _destinationCountryIdDraft = null;
        _businessIdDraft = null;
      });
      return;
    }

    final options = _destinationOptions
        .where((option) => option.country.id == country.id)
        .toList();
    final currentBusinessOption = options
        .where((option) => option.businessId == _currentShipment.businessId)
        .firstOrNull;
    if (currentBusinessOption != null) {
      _setDraftState(() {
        _destinationCountryIdDraft = country.id;
        _businessIdDraft = currentBusinessOption.businessId;
      });
      return;
    }

    if (options.isEmpty) {
      final l10n = AppLocalizations.of(context)!;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            l10n.shippingBusinessUnavailable(
              _currentShipment.businessName,
              country.name,
            ),
          ),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    final selectedOption = await _confirmBusinessChange(
      country: country,
      options: options,
    );
    if (!mounted || selectedOption == null) return;
    _setDraftState(() {
      _destinationCountryIdDraft = country.id;
      _businessIdDraft = selectedOption.businessId;
    });
  }

  Future<BusinessDestinationOption?> _confirmBusinessChange({
    required DestinationCountry country,
    required List<BusinessDestinationOption> options,
  }) {
    return showModalBottomSheet<BusinessDestinationOption>(
      context: context,
      useSafeArea: true,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        final l10n = AppLocalizations.of(context)!;
        var selected = options.first;
        final currency = NumberFormat.simpleCurrency();
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Padding(
              padding: EdgeInsets.only(
                left: 14,
                right: 14,
                bottom: MediaQuery.of(context).viewInsets.bottom + 14,
              ),
              child: Container(
                decoration: BoxDecoration(
                  color: AppColors.paper,
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.2),
                      blurRadius: 26,
                      offset: const Offset(0, 14),
                    ),
                  ],
                ),
                clipBehavior: Clip.antiAlias,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.fromLTRB(20, 20, 20, 18),
                      decoration: const BoxDecoration(
                        gradient: AppColors.headerGradient,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 46,
                            height: 46,
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.16),
                              borderRadius: BorderRadius.circular(14),
                              border: Border.all(
                                color: Colors.white.withValues(alpha: 0.24),
                              ),
                            ),
                            child: const Icon(
                              Icons.swap_horiz,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(height: 14),
                          Text(
                            l10n.shippingBusinessWillChange,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.w900,
                              height: 1.05,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            l10n.shippingBusinessChangeMessage(
                              _currentShipment.businessName,
                              country.name,
                            ),
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.86),
                              fontWeight: FontWeight.w700,
                              height: 1.35,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Flexible(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _BusinessChangeRoutePreview(
                              fromBusiness: _currentShipment.businessName,
                              toCountry: country.name,
                              selectedBusiness: selected.businessName,
                            ),
                            const SizedBox(height: 16),
                            Text(
                              l10n.availableBusinesses,
                              style: Theme.of(context).textTheme.titleSmall
                                  ?.copyWith(fontWeight: FontWeight.w900),
                            ),
                            const SizedBox(height: 10),
                            for (final option in options) ...[
                              _BusinessSwitchOption(
                                option: option,
                                price: currency.format(
                                  option.country.barrelShippingPrice,
                                ),
                                selected: option.id == selected.id,
                                onTap: () =>
                                    setModalState(() => selected = option),
                              ),
                              const SizedBox(height: 8),
                            ],
                          ],
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
                      child: Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () => Navigator.pop(context),
                              style: OutlinedButton.styleFrom(
                                minimumSize: const Size.fromHeight(52),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(8),
                                ),
                              ),
                              child: Text(
                                AppLocalizations.of(context)!.decline,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: FilledButton.icon(
                              onPressed: () => Navigator.pop(context, selected),
                              icon: const Icon(Icons.check_circle_outline),
                              label: Text(AppLocalizations.of(context)!.accept),
                              style: FilledButton.styleFrom(
                                minimumSize: const Size.fromHeight(52),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(8),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  String _statusLabel(String status, AppLocalizations l10n) {
    switch (status) {
      case 'pending':
        return l10n.shipmentStatusPending;
      case 'pending_payment':
        return 'Pending payment';
      case 'in_transit':
        return l10n.shipmentStatusInTransit;
      case 'completed':
        return l10n.shipmentStatusCompleted;
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  }

  Future<void> _updateShipment() async {
    final auth = context.read<AuthProvider>();
    final canEditDetails = _canEditDetails(auth);
    final canEditAdminFields = _canEditAdminFields(auth);

    if (!canEditDetails) {
      return;
    }

    if (!_formKey.currentState!.validate()) {
      return;
    }

    final l10n = AppLocalizations.of(context)!;
    final price = canEditAdminFields
        ? _parsePrice(_priceController.text.trim())
        : _currentShipment.price;
    if (canEditAdminFields && price == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.pleaseEnterValidNumber),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    final confirmed = await confirmMajorAction(
      context,
      title: l10n.saveShipmentChangesQuestion,
      message: l10n.saveShipmentChangesMessage,
      confirmLabel: l10n.saveChanges,
      icon: Icons.save_outlined,
    );
    if (!confirmed || !mounted) return;

    setState(() {
      _isSaving = true;
    });

    final senderAddress = _senderAddressController.text.trim();
    final destinationCountryId = _destinationCountryIdDraft;
    final destinationChanged =
        destinationCountryId != null &&
        (destinationCountryId != _currentShipment.destinationCountryId ||
            _businessIdDraft != _currentShipment.businessId);
    final updatedShipment = _currentShipment.copyWith(
      senderName: _senderNameController.text.trim(),
      senderAddress: senderAddress,
      receiverName: _receiverNameController.text.trim(),
      receiverPhone: _receiverPhoneController.text.trim(),
      pickupAddress: _currentShipment.pickupRequested
          ? senderAddress
          : _currentShipment.pickupAddress,
      pickupDateTime: _pickupDateTimeDraft,
      price: price ?? _currentShipment.price,
      status: canEditAdminFields ? _statusDraft : _currentShipment.status,
    );

    final updateData = <String, dynamic>{
      'senderName': updatedShipment.senderName,
      'senderAddress': updatedShipment.senderAddress,
      'receiverName': updatedShipment.receiverName,
      'receiverPhone': updatedShipment.receiverPhone,
      if (updatedShipment.pickupRequested) ...{
        'pickupAddress': updatedShipment.senderAddress,
        if (updatedShipment.pickupDateTime != null)
          'pickupDateTime': Timestamp.fromDate(updatedShipment.pickupDateTime!),
      },
      if (canEditAdminFields) ...{
        'price': updatedShipment.price,
        'status': updatedShipment.status,
      },
      'updatedAt': FieldValue.serverTimestamp(),
    };

    final marketplaceAcceptance = destinationChanged
        ? await confirmMarketplaceTransaction(
            context,
            providerNames:
                _selectedDestinationOptionDraft?.businessName ??
                _currentShipment.businessName,
            transactionSummary: l10n.marketplaceDestinationChangeSummary,
          )
        : null;
    if (destinationChanged && (marketplaceAcceptance == null || !mounted)) {
      setState(() => _isSaving = false);
      return;
    }

    try {
      await FirebaseFirestore.instance
          .collection('barrelShipments')
          .doc(updatedShipment.id)
          .update(updateData);

      BarrelDestinationChangeResult? destinationResult;
      if (destinationChanged) {
        destinationResult = await _shipmentService.changeDestination(
          shipmentId: updatedShipment.id,
          destinationCountryId: destinationCountryId,
          businessId: _businessIdDraft ?? _currentShipment.businessId,
          marketplaceAcceptance: marketplaceAcceptance!,
        );
      }

      if (!mounted) return;
      final shipmentToApply = destinationResult == null
          ? updatedShipment
          : BarrelShipment.fromFirestore(
              await FirebaseFirestore.instance
                  .collection('barrelShipments')
                  .doc(updatedShipment.id)
                  .get(),
            );
      if (!mounted) return;
      setState(() {
        _applyShipment(shipmentToApply, updateFields: true);
        _hasDraftChanges = false;
        _isSaving = false;
      });

      final message = destinationResult == null
          ? l10n.shipmentUpdatedSuccessfully
          : _destinationChangeMessage(destinationResult);
      showSuccessSnackBar(context, message);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isSaving = false;
      });
      showErrorSnackBar(context, switch (e) {
        BarrelDestinationPaymentInitializationException() =>
          l10n.destinationPaymentInitializationFailed,
        BarrelDestinationRequiresSupportException() =>
          l10n.paidShipmentDestinationChangeRequiresSupport,
        _ => l10n.failedToUpdateShipment(e),
      });
    }
  }

  String _destinationChangeMessage(BarrelDestinationChangeResult result) {
    final currency = NumberFormat.simpleCurrency();
    if (result.amountDue > 0) {
      return AppLocalizations.of(
        context,
      )!.destinationChangePaid(currency.format(result.amountDue));
    }
    if (result.walletCredit > 0) {
      return AppLocalizations.of(
        context,
      )!.destinationChangeCredited(currency.format(result.walletCredit));
    }
    return AppLocalizations.of(context)!.shipmentDestinationUpdated;
  }

  Future<void> _reprintReceipt() async {
    await generateBarrelShipmentReceipt(shipment: _currentShipment);
  }

  Future<void> _copyTrackingNumber() async {
    await Clipboard.setData(ClipboardData(text: _currentShipment.trackingCode));
    if (!mounted) return;
    final l10n = AppLocalizations.of(context)!;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(l10n.trackingNumberCopied)));
  }

  Future<void> _pickPickupDateTime() async {
    final now = DateTime.now();
    final initial = _pickupDateTimeDraft ?? now.add(const Duration(days: 1));
    final date = await showDatePicker(
      context: context,
      initialDate: initial.isAfter(now) ? initial : now,
      firstDate: now,
      lastDate: now.add(const Duration(days: 180)),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: AppColors.brandRed,
              onPrimary: Colors.white,
              surface: Colors.white,
              onSurface: Colors.black,
            ),
          ),
          child: child!,
        );
      },
    );
    if (date == null || !mounted) return;

    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: AppColors.brandRed,
              onPrimary: Colors.white,
              surface: Colors.white,
              onSurface: Colors.black,
            ),
          ),
          child: child!,
        );
      },
    );
    if (time == null) return;

    _setDraftState(() {
      _pickupDateTimeDraft = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = Provider.of<AuthProvider>(context);
    final canEditDetails = _canEditDetails(auth);
    final canEditAdminFields = _canEditAdminFields(auth);
    final isOwner = _isShipmentOwner(auth);
    final media = MediaQuery.of(context);
    final horizontalPadding = media.size.width >= 720 ? 32.0 : 20.0;
    final maxContentWidth = media.size.width >= 900 ? 760.0 : double.infinity;
    final dateLabel = DateFormat(
      'MMM dd, yyyy - HH:mm',
    ).format(_currentShipment.createdAt);
    final shippingFee =
        _selectedDestinationOptionDraft?.country.barrelShippingPrice ??
        _selectedDestinationDraft?.barrelShippingPrice ??
        _currentShipment.shippingFee;
    final estimatedTotal = shippingFee + _currentShipment.pickupFee;
    final needsReview = shippingFee <= 0;

    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [AppColors.cobaltDeep, AppColors.cobalt, AppColors.lightBg],
            stops: [0, 0.34, 0.34],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: EdgeInsets.fromLTRB(horizontalPadding, 12, 16, 4),
                child: Row(
                  children: [
                    const AppBackButton(onDarkBackground: true),
                    Expanded(
                      child: Text(
                        l10n.barrelShipmentDetails,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                        ),
                        textAlign: TextAlign.center,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const LanguageToggle(),
                  ],
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: EdgeInsets.fromLTRB(
                    horizontalPadding,
                    14,
                    horizontalPadding,
                    28,
                  ),
                  child: Center(
                    child: ConstrainedBox(
                      constraints: BoxConstraints(maxWidth: maxContentWidth),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const _EditBarrelHero(),
                          const SizedBox(height: 18),
                          _TrackingBanner(
                            trackingCode: _currentShipment.trackingCode,
                            createdAt: dateLabel,
                            onCopy: _copyTrackingNumber,
                            onReceipt: _reprintReceipt,
                          ),
                          if (canEditAdminFields) ...[
                            const SizedBox(height: 12),
                            ContainerTrackingCard(
                              relatedCollection: 'barrelShipments',
                              relatedId: _currentShipment.id,
                              containerNumber: _currentShipment.containerNumber,
                              trackingProvider:
                                  _currentShipment.trackingProvider,
                            ),
                          ],
                          const SizedBox(height: 12),
                          ShipmentTrackingSection(
                            relatedCollection: 'barrelShipments',
                            relatedId: _currentShipment.id,
                            canEdit: canEditAdminFields,
                          ),
                          const SizedBox(height: 12),
                          SupportEntryButton(
                            relatedCollection: 'barrelShipments',
                            relatedId: _currentShipment.id,
                            subject: l10n.supportChat,
                            relatedLabel: _currentShipment.trackingCode,
                          ),
                          const SizedBox(height: 14),
                          Form(
                            key: _formKey,
                            child: Column(
                              children: [
                                _EditFormSection(
                                  icon: Icons.person_outline,
                                  title: l10n.sender,
                                  subtitle: l10n.senderQuestion,
                                  children: [
                                    _EditRoundedTextField(
                                      label: l10n.senderName,
                                      controller: _senderNameController,
                                      icon: Icons.badge_outlined,
                                      readOnly: !canEditDetails,
                                      validator: (value) {
                                        if (!canEditDetails) return null;
                                        if (value == null || value.isEmpty) {
                                          return l10n.pleaseEnterSenderName;
                                        }
                                        return null;
                                      },
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 14),
                                _EditFormSection(
                                  icon: Icons.local_shipping_outlined,
                                  title: l10n.pickup,
                                  subtitle: _currentShipment.pickupRequested
                                      ? l10n.pickupCollectNyc
                                      : l10n.pickupBringOffice,
                                  children: [
                                    _PickupModeTile(
                                      pickupRequested:
                                          _currentShipment.pickupRequested,
                                      pickupBorough:
                                          _currentShipment.pickupBorough,
                                    ),
                                    const SizedBox(height: 14),
                                    if (_currentShipment.pickupRequested) ...[
                                      _EditRoundedTextField(
                                        label: l10n.pickupAddress,
                                        controller: _senderAddressController,
                                        icon: Icons.location_on_outlined,
                                        readOnly: !canEditDetails,
                                        validator: (value) {
                                          if (!canEditDetails) return null;
                                          if (value == null ||
                                              value.trim().isEmpty) {
                                            return l10n
                                                .pleaseEnterSenderAddress;
                                          }
                                          return null;
                                        },
                                      ),
                                      const SizedBox(height: 14),
                                      _PickupTimeEditor(
                                        value: _pickupDateTimeDraft,
                                        onTap: canEditDetails
                                            ? _pickPickupDateTime
                                            : null,
                                      ),
                                    ] else
                                      _OfficeDropOffTile(
                                        address: _currentShipment.senderAddress,
                                      ),
                                  ],
                                ),
                                const SizedBox(height: 14),
                                _EditFormSection(
                                  icon: Icons.call_received_outlined,
                                  title: l10n.receiver,
                                  subtitle: l10n.receiverQuestion,
                                  children: [
                                    _EditRoundedTextField(
                                      label: l10n.receiverName,
                                      controller: _receiverNameController,
                                      icon: Icons.person_pin_outlined,
                                      readOnly: !canEditDetails,
                                      validator: (value) {
                                        if (!canEditDetails) return null;
                                        if (value == null || value.isEmpty) {
                                          return l10n.pleaseEnterReceiverName;
                                        }
                                        return null;
                                      },
                                    ),
                                    const SizedBox(height: 14),
                                    CountryPhoneField(
                                      controller: _receiverPhoneController,
                                      labelText: l10n.receiverPhone,
                                      enabled: canEditDetails,
                                      initialCountryCode:
                                          _selectedDestinationDraft
                                              ?.displayCode ??
                                          'US',
                                      validator: (value) {
                                        if (!canEditDetails) return null;
                                        return ReceiverPhoneRules.validate(
                                          value: value,
                                          destination:
                                              _selectedDestinationDraft,
                                          allowDifferentCountry: false,
                                          requiredMessage:
                                              l10n.pleaseEnterReceiverPhone,
                                          invalidPhoneMessage:
                                              l10n.invalidPhoneWithCountryCode,
                                          invalidInternationalPhoneMessage:
                                              l10n.invalidInternationalPhone,
                                          whatsAppCountryCodeMessage: l10n
                                              .whatsAppDifferentCountryRequiresCode,
                                          destinationMismatchMessage: l10n
                                              .receiverPhoneMustMatchDestination,
                                        );
                                      },
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 14),
                                _EditFormSection(
                                  icon: Icons.public_outlined,
                                  title: l10n.destination,
                                  subtitle:
                                      l10n.destinationSubtitleEstimateRoute,
                                  children: [
                                    if (canEditDetails)
                                      _DestinationEditor(
                                        value: _selectedDestinationDraft,
                                        originalShippingFee:
                                            _currentShipment.shippingFee,
                                        difference: _destinationDifference,
                                        onChanged:
                                            _handleDestinationCountryChanged,
                                        businessValue:
                                            _selectedDestinationOptionDraft,
                                        businessOptions: _destinationOptions
                                            .where(
                                              (option) =>
                                                  option.country.id ==
                                                  _destinationCountryIdDraft,
                                            )
                                            .toList(),
                                        onBusinessChanged: (option) {
                                          _setDraftState(() {
                                            _businessIdDraft =
                                                option?.businessId;
                                          });
                                        },
                                      )
                                    else
                                      _ReadOnlyTile(
                                        icon: Icons.public_outlined,
                                        title: l10n.destination,
                                        subtitle:
                                            _currentShipment
                                                    .deliveryEstimateLabel ==
                                                null
                                            ? _currentShipment
                                                  .destinationCountryName
                                            : '${_currentShipment.destinationCountryName} • ${l10n.deliveryWithLabel(_currentShipment.deliveryEstimateLabel!)}',
                                      ),
                                    const SizedBox(height: 14),
                                    _EditPriceEstimateCard(
                                      shippingFee: shippingFee,
                                      pickupFee: _currentShipment.pickupFee,
                                      pickupBorough:
                                          _currentShipment.pickupRequested
                                          ? _currentShipment.pickupBorough
                                          : l10n.officeDropOff,
                                      total: estimatedTotal,
                                      needsReview: needsReview,
                                      paymentStatus:
                                          _currentShipment.paymentStatus,
                                    ),
                                    if (_currentShipment.pricingPendingReview ||
                                        needsReview) ...[
                                      const SizedBox(height: 12),
                                      _InlineNotice(
                                        message:
                                            l10n.pleaseAskStaffSetBarrelPrice,
                                      ),
                                    ],
                                  ],
                                ),
                                if (canEditAdminFields) ...[
                                  const SizedBox(height: 14),
                                  _EditFormSection(
                                    icon: Icons.admin_panel_settings_outlined,
                                    title: l10n.staffControls,
                                    subtitle: l10n.staffControlsSubtitle,
                                    children: [
                                      _EditRoundedTextField(
                                        label: l10n.price,
                                        controller: _priceController,
                                        icon: Icons.attach_money,
                                        keyboardType:
                                            const TextInputType.numberWithOptions(
                                              decimal: true,
                                            ),
                                        validator: (value) {
                                          if (value == null || value.isEmpty) {
                                            return l10n.pleaseEnterPrice;
                                          }
                                          if (_parsePrice(value.trim()) ==
                                              null) {
                                            return l10n.pleaseEnterValidNumber;
                                          }
                                          return null;
                                        },
                                      ),
                                      const SizedBox(height: 14),
                                      DropdownButtonFormField<String>(
                                        key: ValueKey<String>(_statusDraft),
                                        initialValue: _statusDraft,
                                        decoration: InputDecoration(
                                          labelText: l10n.statusLabel,
                                        ),
                                        items: _statusOptions
                                            .map(
                                              (value) =>
                                                  DropdownMenuItem<String>(
                                                    value: value,
                                                    child: Text(
                                                      _statusLabel(value, l10n),
                                                    ),
                                                  ),
                                            )
                                            .toList(),
                                        onChanged: (value) {
                                          if (value != null) {
                                            _setDraftState(() {
                                              _statusDraft = value;
                                            });
                                          }
                                        },
                                      ),
                                    ],
                                  ),
                                ],
                                const SizedBox(height: 18),
                                _EditSubmitButton(
                                  isSubmitting: _isSaving,
                                  canSave:
                                      canEditDetails &&
                                      !needsReview &&
                                      _hasDraftChanges,
                                  onPressed: _updateShipment,
                                ),
                                const SizedBox(height: 12),
                                OutlinedButton.icon(
                                  onPressed: _reprintReceipt,
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: AppColors.cobaltDeep,
                                    minimumSize: const Size.fromHeight(52),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                  ),
                                  icon: const Icon(Icons.receipt_long),
                                  label: Text(l10n.reprintReceipt),
                                ),
                                if (isOwner && !canEditDetails && !_isCompleted)
                                  const Padding(
                                    padding: EdgeInsets.only(top: 16),
                                    child: _InlineNotice(
                                      message:
                                          'This shipment can no longer be edited because pickup has arrived or the request is already being processed.',
                                    ),
                                  ),
                                if (_isCompleted)
                                  Padding(
                                    padding: const EdgeInsets.only(top: 16),
                                    child: _InlineNotice(
                                      message:
                                          l10n.shipmentStatusCompletedNotice,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DestinationEditor extends StatelessWidget {
  const _DestinationEditor({
    required this.value,
    required this.businessValue,
    required this.businessOptions,
    required this.originalShippingFee,
    required this.difference,
    required this.onChanged,
    required this.onBusinessChanged,
  });

  final DestinationCountry? value;
  final BusinessDestinationOption? businessValue;
  final List<BusinessDestinationOption> businessOptions;
  final double originalShippingFee;
  final double? difference;
  final ValueChanged<DestinationCountry?> onChanged;
  final ValueChanged<BusinessDestinationOption?> onBusinessChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final currency = NumberFormat.simpleCurrency();
    final diff = difference;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        DestinationCountryField(
          value: value,
          label: AppLocalizations.of(context)!.destinationCountry,
          requiredMessage: AppLocalizations.of(context)!.requiredField,
          onChanged: onChanged,
        ),
        if (value != null) ...[
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue:
                businessValue != null &&
                    businessOptions.any(
                      (option) => option.id == businessValue!.id,
                    )
                ? businessValue!.id
                : null,
            decoration: InputDecoration(labelText: l10n.shippingBusiness),
            validator: (id) => id == null ? l10n.requiredField : null,
            items: businessOptions
                .map(
                  (option) => DropdownMenuItem<String>(
                    value: option.id,
                    child: Text(
                      [
                        option.businessName,
                        currency.format(option.country.barrelShippingPrice),
                        if (option.country.barrelShippingDeliveryEstimateLabel !=
                            null)
                          option.country.barrelShippingDeliveryEstimateLabel!,
                      ].join(' • '),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                )
                .toList(),
            onChanged: (id) {
              onBusinessChanged(
                businessOptions.where((option) => option.id == id).firstOrNull,
              );
            },
          ),
        ],
        if (diff != null && diff.abs() >= 0.01) ...[
          const SizedBox(height: 8),
          Text(
            diff > 0
                ? l10n.destinationChangeCollect(currency.format(diff))
                : l10n.destinationChangeCredit(currency.format(diff.abs())),
            style: TextStyle(
              color: diff > 0 ? AppColors.warn : AppColors.sage,
              fontWeight: FontWeight.w700,
            ),
          ),
        ] else if (value != null) ...[
          const SizedBox(height: 8),
          Text(
            l10n.currentDestinationShipping(
              currency.format(originalShippingFee),
            ),
            style: const TextStyle(
              color: AppColors.muted,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ],
    );
  }
}

class _BusinessChangeRoutePreview extends StatelessWidget {
  const _BusinessChangeRoutePreview({
    required this.fromBusiness,
    required this.toCountry,
    required this.selectedBusiness,
  });

  final String fromBusiness;
  final String toCountry;
  final String selectedBusiness;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.lightSurfaceVariant,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        children: [
          _BusinessChangeLine(
            icon: Icons.storefront_outlined,
            label: l10n.currentBusiness,
            value: fromBusiness,
            muted: true,
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 10),
            child: Row(
              children: [
                Expanded(child: Divider(color: AppColors.rule)),
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: 10),
                  child: Icon(Icons.arrow_downward, size: 18),
                ),
                Expanded(child: Divider(color: AppColors.rule)),
              ],
            ),
          ),
          _BusinessChangeLine(
            icon: Icons.public_outlined,
            label: l10n.newRoute,
            value: l10n.newRouteValue(selectedBusiness, toCountry),
          ),
        ],
      ),
    );
  }
}

class _BusinessChangeLine extends StatelessWidget {
  const _BusinessChangeLine({
    required this.icon,
    required this.label,
    required this.value,
    this.muted = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            color: muted
                ? AppColors.muted.withValues(alpha: 0.12)
                : AppColors.cobalt.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(
            icon,
            size: 20,
            color: muted ? AppColors.muted : AppColors.cobalt,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: const TextStyle(
                  color: AppColors.muted,
                  fontSize: 12,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: const TextStyle(
                  color: AppColors.ink,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _BusinessSwitchOption extends StatelessWidget {
  const _BusinessSwitchOption({
    required this.option,
    required this.price,
    required this.selected,
    required this.onTap,
  });

  final BusinessDestinationOption option;
  final String price;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final contact = [
      option.businessPhone,
      option.businessEmail,
      option.businessWebsite,
    ].where((item) => item != null && item.trim().isNotEmpty).join(' • ');
    final deliveryEstimate = option.country.barrelShippingDeliveryEstimateLabel;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected
              ? AppColors.cobalt.withValues(alpha: 0.1)
              : AppColors.paper,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: selected ? AppColors.cobalt : AppColors.rule,
            width: selected ? 1.6 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(
              selected
                  ? Icons.radio_button_checked
                  : Icons.radio_button_unchecked,
              color: selected ? AppColors.cobalt : AppColors.muted,
            ),
            const SizedBox(width: 10),
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: AppColors.lightSurfaceVariant,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.storefront_outlined),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    option.businessName,
                    style: const TextStyle(fontWeight: FontWeight.w900),
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (contact.isNotEmpty)
                    Text(
                      contact,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  if (deliveryEstimate != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 5),
                      child: Text(
                        AppLocalizations.of(
                          context,
                        )!.deliveryLabel(deliveryEstimate),
                        style: const TextStyle(
                          color: AppColors.sage,
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Text(
              price,
              style: const TextStyle(
                color: AppColors.cobaltDeep,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PickupTimeEditor extends StatelessWidget {
  const _PickupTimeEditor({required this.value, required this.onTap});

  final DateTime? value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final label = value == null
        ? 'Choose pickup time'
        : DateFormat('MMM dd, yyyy - h:mm a').format(value!);

    return FormField<DateTime>(
      initialValue: value,
      validator: (_) {
        if (onTap == null) return null;
        if (value == null) return 'Please choose pickup date and time';
        if (!value!.isAfter(DateTime.now())) {
          return 'Pickup time must be in the future';
        }
        return null;
      },
      builder: (state) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Material(
              color: AppColors.lightSurfaceVariant,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
                side: BorderSide(
                  color: state.hasError ? AppColors.errorRed : AppColors.rule,
                  width: state.hasError ? 2 : 1,
                ),
              ),
              clipBehavior: Clip.antiAlias,
              child: ListTile(
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 4,
                ),
                title: Text(
                  AppLocalizations.of(context)!.pickupDateAndTime,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                subtitle: Text(
                  label,
                  style: TextStyle(
                    color: value == null ? AppColors.muted : AppColors.ink,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                trailing: Icon(
                  Icons.event_available,
                  color: onTap == null ? AppColors.muted : AppColors.brandRed,
                ),
                onTap: onTap,
              ),
            ),
            if (state.hasError)
              Padding(
                padding: const EdgeInsets.only(left: 12, top: 6),
                child: Text(
                  state.errorText!,
                  style: const TextStyle(color: Colors.red, fontSize: 12),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _EditBarrelHero extends StatelessWidget {
  const _EditBarrelHero();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;

    return Container(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withValues(alpha: 0.22)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 74,
            height: 74,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: Colors.white.withValues(alpha: 0.2)),
            ),
            child: const Icon(
              Icons.inventory_2_outlined,
              color: Colors.white,
              size: 34,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.barrelShippingService,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                    height: 1.05,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 8),
                Text(
                  l10n.enterShippingDetails,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.82),
                    fontSize: 14,
                    height: 1.35,
                    fontWeight: FontWeight.w500,
                  ),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TrackingBanner extends StatelessWidget {
  const _TrackingBanner({
    required this.trackingCode,
    required this.createdAt,
    required this.onCopy,
    required this.onReceipt,
  });

  final String trackingCode;
  final String createdAt;
  final VoidCallback onCopy;
  final VoidCallback onReceipt;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        children: [
          const Icon(Icons.qr_code_2, color: AppColors.cobaltDeep),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  trackingCode,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  createdAt,
                  style: const TextStyle(
                    color: AppColors.muted,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: onCopy,
            tooltip: l10n.copyTrackingNumber,
            icon: const Icon(Icons.copy),
          ),
          IconButton(
            onPressed: onReceipt,
            tooltip: l10n.receipt,
            icon: const Icon(Icons.receipt_long),
          ),
        ],
      ),
    );
  }
}

class _EditFormSection extends StatelessWidget {
  const _EditFormSection({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.children,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
        boxShadow: [
          BoxShadow(
            color: AppColors.ink.withValues(alpha: 0.06),
            blurRadius: 18,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Material(
        type: MaterialType.transparency,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: AppColors.mist,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(icon, color: AppColors.cobaltDeep, size: 22),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: const TextStyle(
                          color: AppColors.ink,
                          fontSize: 17,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        subtitle,
                        style: const TextStyle(
                          color: AppColors.muted,
                          fontSize: 13,
                          height: 1.25,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            ...children,
          ],
        ),
      ),
    );
  }
}

class _EditRoundedTextField extends StatelessWidget {
  const _EditRoundedTextField({
    required this.label,
    this.controller,
    this.validator,
    this.keyboardType,
    this.icon,
    this.readOnly = false,
  });

  final String label;
  final TextEditingController? controller;
  final String? Function(String?)? validator;
  final TextInputType? keyboardType;
  final IconData? icon;
  final bool readOnly;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      validator: validator,
      keyboardType: keyboardType,
      readOnly: readOnly,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: icon == null ? null : Icon(icon),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.rule),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.brandRed, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.errorRed, width: 2),
        ),
        filled: true,
        fillColor: AppColors.lightSurfaceVariant,
      ),
    );
  }
}

class _PickupModeTile extends StatelessWidget {
  const _PickupModeTile({
    required this.pickupRequested,
    required this.pickupBorough,
  });

  final bool pickupRequested;
  final String pickupBorough;

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
          Icon(
            pickupRequested
                ? Icons.local_shipping_outlined
                : Icons.storefront_outlined,
            color: AppColors.cobaltDeep,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              pickupRequested
                  ? '${pickupBorough.isEmpty ? 'NYC' : pickupBorough} pickup'
                  : 'Bring to office',
              style: const TextStyle(
                color: AppColors.ink,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _OfficeDropOffTile extends StatelessWidget {
  const _OfficeDropOffTile({required this.address});

  final String address;

  @override
  Widget build(BuildContext context) {
    return _ReadOnlyTile(
      icon: Icons.storefront_outlined,
      title: AppLocalizations.of(context)!.dropOffOffice,
      subtitle: address,
    );
  }
}

class _ReadOnlyTile extends StatelessWidget {
  const _ReadOnlyTile({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

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
          Icon(icon, color: AppColors.cobaltDeep),
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
                const SizedBox(height: 3),
                Text(
                  subtitle,
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

class _EditPriceEstimateCard extends StatelessWidget {
  const _EditPriceEstimateCard({
    required this.shippingFee,
    required this.pickupFee,
    required this.pickupBorough,
    required this.total,
    required this.needsReview,
    required this.paymentStatus,
  });

  final double shippingFee;
  final double pickupFee;
  final String pickupBorough;
  final double total;
  final bool needsReview;
  final String paymentStatus;

  @override
  Widget build(BuildContext context) {
    final currency = NumberFormat.simpleCurrency();

    Widget row(String label, String value) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  color: Colors.white70,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Text(
              value,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      );
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOutCubic,
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.cobaltDeep,
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: AppColors.cobaltDeep.withValues(alpha: 0.18),
            blurRadius: 18,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(
                  Icons.payments_outlined,
                  color: Colors.white,
                  size: 21,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  AppLocalizations.of(context)!.shipmentEstimate,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          row('Destination shipment', currency.format(shippingFee)),
          row('$pickupBorough pickup', currency.format(pickupFee)),
          row('Payment', paymentStatus.replaceAll('_', ' ')),
          const Divider(height: 22, color: Colors.white24),
          row(
            needsReview ? 'Pending staff review' : 'Updated total',
            needsReview ? 'TBD' : currency.format(total),
          ),
        ],
      ),
    );
  }
}

class _InlineNotice extends StatelessWidget {
  const _InlineNotice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.saffron.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.saffron.withValues(alpha: 0.32)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline, color: AppColors.warn, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: AppColors.warn,
                fontWeight: FontWeight.w700,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EditSubmitButton extends StatelessWidget {
  const _EditSubmitButton({
    required this.isSubmitting,
    required this.canSave,
    required this.onPressed,
  });

  final bool isSubmitting;
  final bool canSave;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final enabled = !isSubmitting && canSave;

    return AnimatedScale(
      scale: isSubmitting ? 0.985 : 1,
      duration: const Duration(milliseconds: 180),
      curve: Curves.easeOutCubic,
      child: SizedBox(
        width: double.infinity,
        height: 58,
        child: ElevatedButton.icon(
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.cobaltDeep,
            disabledBackgroundColor: AppColors.rule,
            foregroundColor: Colors.white,
            disabledForegroundColor: AppColors.muted,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
            ),
            elevation: 0,
            splashFactory: NoSplash.splashFactory,
          ),
          onPressed: enabled ? onPressed : null,
          icon: AnimatedSwitcher(
            duration: const Duration(milliseconds: 180),
            child: isSubmitting
                ? const SizedBox(
                    key: ValueKey('loading'),
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                    ),
                  )
                : const Icon(
                    key: ValueKey('icon'),
                    Icons.lock_outline,
                    size: 20,
                  ),
          ),
          label: Text(
            isSubmitting ? 'Saving changes' : 'Save shipment changes',
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
          ),
        ),
      ),
    );
  }
}
