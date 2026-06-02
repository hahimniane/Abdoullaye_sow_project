import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';
import '../models/business_destination_option.dart';
import '../models/destination_country.dart';
import '../services/barrel_pricing_service.dart';
import '../services/barrel_shipment_service.dart';
import '../services/business_service.dart';
import '../utils/barrel_receipt_generator.dart';
import '../utils/action_confirmation.dart';
import '../utils/phone_number_validator.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/destination_country_field.dart';
import '../theme/app_colors.dart';

class SendBarrelScreen extends StatefulWidget {
  const SendBarrelScreen({super.key, this.showBackButton = true});

  final bool showBackButton;

  @override
  State<SendBarrelScreen> createState() => _SendBarrelScreenState();
}

class _SendBarrelScreenState extends State<SendBarrelScreen>
    with SingleTickerProviderStateMixin {
  final _formKey = GlobalKey<FormState>();
  final _senderNameController = TextEditingController();
  final _pickupAddressController = TextEditingController();
  final _receiverNameController = TextEditingController();
  final _receiverPhoneController = TextEditingController();
  final _shipmentService = BarrelShipmentService();
  DestinationCountry? _selectedCountry;
  BusinessDestinationOption? _selectedBusinessOption;
  BarrelPickupPricing _pickupPricing = BarrelPickupPricing.defaultPricing;
  bool _pickupRequested = true;
  bool _isSubmitting = false;
  bool _pricingLoaded = false;
  String _pickupBorough = 'Bronx';
  DateTime? _pickupDateTime;
  bool _receiverPhoneIsWhatsappOnly = false;
  bool _useWalletBalance = false;
  double _walletBalance = 0;
  bool _prefilledSenderName = false;
  late final AnimationController _heroController;

  @override
  void initState() {
    super.initState();
    _heroController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2200),
    )..repeat(reverse: true);
    _loadPricing();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_prefilledSenderName) return;
    _prefilledSenderName = true;
    _prefillSenderName();
  }

  Future<void> _loadPricing() async {
    final pricing = await BarrelPricingService().pickupPricing().first;
    if (!mounted) return;
    setState(() {
      _pickupPricing = pricing;
      _pricingLoaded = true;
    });
  }

  @override
  void dispose() {
    _heroController.dispose();
    _senderNameController.dispose();
    _pickupAddressController.dispose();
    _receiverNameController.dispose();
    _receiverPhoneController.dispose();
    super.dispose();
  }

  double get _shippingFee =>
      _selectedBusinessOption?.country.barrelShippingPrice ?? 0;
  double get _pickupFee =>
      _pickupRequested ? _pickupPricing.pickupFeeForBorough(_pickupBorough) : 0;
  double get _estimatedTotal => _shippingFee + _pickupFee;
  bool get _needsPriceReview =>
      !_pricingLoaded ||
      _shippingFee <= 0 ||
      (_pickupRequested && _pickupFee <= 0);
  bool get _canPay =>
      _selectedCountry != null &&
      _selectedBusinessOption != null &&
      _shippingFee > 0 &&
      (!_pickupRequested || _pickupFee > 0);
  bool get _showReceiverWhatsappOption =>
      _ReceiverPhoneRules.isDifferentCountryNumber(
        value: _receiverPhoneController.text,
        destination: _selectedCountry,
      );

  void _handlePickupAddressChanged(String address) {
    final borough = _NycAddressSuggestions.detectBorough(address);
    if (borough != null && borough != _pickupBorough) {
      setState(() => _pickupBorough = borough);
    }
  }

  void _handleReceiverPhoneChanged(String value) {
    final showWhatsAppOption = _showReceiverWhatsappOption;
    setState(() {
      if (!showWhatsAppOption) {
        _receiverPhoneIsWhatsappOnly = false;
      }
    });
    _formKey.currentState?.validate();
  }

  void _handleDestinationChanged(DestinationCountry? country) {
    setState(() {
      _selectedCountry = country;
      _selectedBusinessOption = null;
      if (!_ReceiverPhoneRules.isDifferentCountryNumber(
        value: _receiverPhoneController.text,
        destination: country,
      )) {
        _receiverPhoneIsWhatsappOnly = false;
      }
    });
    _formKey.currentState?.validate();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    final isReady = await _ensureCustomerAccount();
    if (!isReady || !mounted) return;
    _prefillSenderName();

    final pickupAddress = _pickupRequested
        ? _pickupAddressController.text.trim()
        : _pickupPricing.officeAddress;
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.requestBarrelShipmentQuestion,
      message: l10n.requestBarrelShipmentMessage,
      confirmLabel: l10n.payAndRequest,
      icon: Icons.local_shipping_outlined,
    );
    if (!confirmed || !mounted) return;

    setState(() {
      _isSubmitting = true;
    });

    try {
      final shipment = await _shipmentService.payForShipment(
        senderName: _senderNameController.text.trim(),
        receiverName: _receiverNameController.text.trim(),
        receiverPhone: _receiverPhoneController.text.trim(),
        destinationCountryId: _selectedCountry!.id,
        businessId: _selectedBusinessOption!.businessId,
        pickupRequested: _pickupRequested,
        pickupAddress: pickupAddress,
        pickupBorough: _pickupRequested ? _pickupBorough : 'Office drop-off',
        pickupDateTime: _pickupRequested ? _pickupDateTime : null,
        useWalletBalance: _useWalletBalance,
      );
      await generateBarrelShipmentReceipt(shipment: shipment);

      if (!mounted) return;
      showSuccessSnackBar(
        context,
        AppLocalizations.of(
          context,
        )!.shipmentSavedWithTracking(shipment.trackingCode),
      );
      if (widget.showBackButton) {
        Navigator.of(context).pop();
      } else {
        _formKey.currentState?.reset();
        _senderNameController.clear();
        _pickupAddressController.clear();
        _receiverNameController.clear();
        _receiverPhoneController.clear();
        _prefillSenderName();
        setState(() {
          _selectedCountry = null;
          _selectedBusinessOption = null;
          _pickupDateTime = null;
          _pickupBorough = 'Bronx';
          _receiverPhoneIsWhatsappOnly = false;
          _useWalletBalance = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      showErrorSnackBar(context, _friendlyShipmentError(context, e));
    } finally {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
        });
      }
    }
  }

  Future<bool> _ensureCustomerAccount() async {
    if (context.read<AuthProvider>().isAuthenticated) return true;

    final route = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      builder: (context) {
        final l10n = AppLocalizations.of(context)!;
        return Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: AppColors.cobalt.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: const Icon(
                  Icons.person_outline,
                  color: AppColors.cobalt,
                ),
              ),
              const SizedBox(height: 18),
              Text(
                l10n.accountRequiredTitle,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              const Text(
                'Sign in or create an account so we can securely save this barrel shipment and show it in tracking.',
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () => Navigator.pop(context, '/login'),
                  icon: const Icon(Icons.login),
                  label: Text(l10n.signIn),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => Navigator.pop(context, '/signup'),
                  icon: const Icon(Icons.person_add_outlined),
                  label: Text(l10n.createAccount),
                ),
              ),
            ],
          ),
        );
      },
    );

    if (route == null || !mounted) return false;
    final result = await Navigator.pushNamed(
      context,
      route,
      arguments: const {'returnToPrevious': true},
    );
    if (!mounted) return false;
    return result == true && context.read<AuthProvider>().isAuthenticated;
  }

  void _prefillSenderName() {
    final auth = context.read<AuthProvider>();
    final profileName = auth.customerName?.trim();
    final displayName = auth.user?.displayName?.trim();
    final fallbackName = auth.buyerName.trim();
    final name = profileName?.isNotEmpty == true
        ? profileName!
        : displayName?.isNotEmpty == true
        ? displayName!
        : fallbackName != 'Customer'
        ? fallbackName
        : '';
    if (name.isNotEmpty && _senderNameController.text.trim().isEmpty) {
      _senderNameController.text = name;
    }
  }

  String _friendlyShipmentError(BuildContext context, Object error) {
    final l10n = AppLocalizations.of(context)!;
    if (error is FirebaseFunctionsException) {
      if (error.code == 'not-found') {
        return 'Payment service is not deployed yet. Please deploy the Firebase Functions and try again.';
      }
      if (error.code == 'internal') {
        return 'The deployed payment function is still returning an internal error. Deploy the latest Firebase Functions so simulated payments are active.';
      }
      return l10n.failedToSaveShipment(
        error.message?.trim().isNotEmpty == true ? error.message! : error.code,
      );
    }
    return l10n.failedToSaveShipment(error);
  }

  Future<void> _pickPickupDateTime() async {
    final now = DateTime.now();
    final initial = _pickupDateTime ?? now.add(const Duration(days: 1));
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

    setState(() {
      _pickupDateTime = DateTime(
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
    final media = MediaQuery.of(context);
    final l10n = AppLocalizations.of(context)!;
    final horizontalPadding = media.size.width >= 720 ? 32.0 : 20.0;
    final maxContentWidth = media.size.width >= 900 ? 760.0 : double.infinity;

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
                    if (widget.showBackButton)
                      IconButton(
                        onPressed: () => Navigator.pop(context),
                        style: IconButton.styleFrom(
                          splashFactory: NoSplash.splashFactory,
                        ),
                        icon: const Icon(
                          Icons.arrow_back_ios,
                          color: Colors.white,
                          size: 24,
                        ),
                      )
                    else
                      const SizedBox(width: 48, height: 48),
                    Expanded(
                      child: Text(
                        AppLocalizations.of(context)!.sendBarrels,
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
                          _BarrelHero(animation: _heroController),
                          const SizedBox(height: 18),
                          Form(
                            key: _formKey,
                            child: Column(
                              children: [
                                _FormSection(
                                  icon: Icons.person_outline,
                                  title: l10n.sender,
                                  subtitle: l10n.senderQuestion,
                                  children: [
                                    _RoundedTextField(
                                      label: AppLocalizations.of(
                                        context,
                                      )!.senderName,
                                      controller: _senderNameController,
                                      icon: Icons.badge_outlined,
                                      validator: (value) {
                                        if (value == null || value.isEmpty) {
                                          return AppLocalizations.of(
                                            context,
                                          )!.pleaseEnterSenderName;
                                        }
                                        return null;
                                      },
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 14),
                                _FormSection(
                                  icon: Icons.local_shipping_outlined,
                                  title: l10n.pickup,
                                  subtitle: _pickupRequested
                                      ? l10n.pickupCollectNyc
                                      : l10n.pickupBringOffice,
                                  children: [
                                    _PickupChoice(
                                      pickupRequested: _pickupRequested,
                                      officeAddress:
                                          _pickupPricing.officeAddress,
                                      onChanged: (value) {
                                        setState(
                                          () => _pickupRequested = value,
                                        );
                                      },
                                    ),
                                    const SizedBox(height: 14),
                                    AnimatedSwitcher(
                                      duration: const Duration(
                                        milliseconds: 260,
                                      ),
                                      switchInCurve: Curves.easeOutCubic,
                                      switchOutCurve: Curves.easeInCubic,
                                      transitionBuilder: (child, animation) {
                                        final offset = Tween<Offset>(
                                          begin: const Offset(0, .06),
                                          end: Offset.zero,
                                        ).animate(animation);
                                        return FadeTransition(
                                          opacity: animation,
                                          child: SlideTransition(
                                            position: offset,
                                            child: child,
                                          ),
                                        );
                                      },
                                      child: _pickupRequested
                                          ? Column(
                                              key: const ValueKey('pickup'),
                                              children: [
                                                _AddressAutocompleteField(
                                                  controller:
                                                      _pickupAddressController,
                                                  service: _shipmentService,
                                                  onChanged:
                                                      _handlePickupAddressChanged,
                                                  validator: (value) {
                                                    if (value == null ||
                                                        value.trim().isEmpty) {
                                                      return l10n
                                                          .pleaseEnterPickupAddress;
                                                    }
                                                    if (_NycAddressSuggestions.detectBorough(
                                                          value,
                                                        ) ==
                                                        null) {
                                                      return l10n
                                                          .pleaseIncludeNycBoroughZip;
                                                    }
                                                    return null;
                                                  },
                                                ),
                                                const SizedBox(height: 14),
                                                _PickupDateTimeTile(
                                                  value: _pickupDateTime,
                                                  onTap: _pickPickupDateTime,
                                                  validator: () {
                                                    if (_pickupDateTime ==
                                                        null) {
                                                      return l10n
                                                          .pleaseChoosePickupDateTime;
                                                    }
                                                    if (!_pickupDateTime!
                                                        .isAfter(
                                                          DateTime.now(),
                                                        )) {
                                                      return l10n
                                                          .pickupTimeFuture;
                                                    }
                                                    return null;
                                                  },
                                                ),
                                              ],
                                            )
                                          : _OfficeDropOffTile(
                                              key: const ValueKey('dropoff'),
                                              address:
                                                  _pickupPricing.officeAddress,
                                            ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 14),
                                _FormSection(
                                  icon: Icons.call_received_outlined,
                                  title: l10n.receiver,
                                  subtitle: l10n.receiverQuestion,
                                  children: [
                                    _RoundedTextField(
                                      label: AppLocalizations.of(
                                        context,
                                      )!.receiverName,
                                      controller: _receiverNameController,
                                      icon: Icons.person_pin_outlined,
                                      validator: (value) {
                                        if (value == null || value.isEmpty) {
                                          return AppLocalizations.of(
                                            context,
                                          )!.pleaseEnterReceiverName;
                                        }
                                        return null;
                                      },
                                    ),
                                    const SizedBox(height: 14),
                                    _RoundedTextField(
                                      label: AppLocalizations.of(
                                        context,
                                      )!.receiverPhone,
                                      controller: _receiverPhoneController,
                                      icon: Icons.phone_outlined,
                                      keyboardType: TextInputType.phone,
                                      inputFormatters: PhoneNumberValidator
                                          .allowedInputFormatters,
                                      onChanged: _handleReceiverPhoneChanged,
                                      validator: (value) {
                                        return _ReceiverPhoneRules.validate(
                                          value: value,
                                          destination: _selectedCountry,
                                          allowDifferentCountry:
                                              _receiverPhoneIsWhatsappOnly,
                                          requiredMessage: AppLocalizations.of(
                                            context,
                                          )!.pleaseEnterReceiverPhone,
                                        );
                                      },
                                    ),
                                    AnimatedSwitcher(
                                      duration: const Duration(
                                        milliseconds: 180,
                                      ),
                                      switchInCurve: Curves.easeOutCubic,
                                      switchOutCurve: Curves.easeInCubic,
                                      child: _showReceiverWhatsappOption
                                          ? Padding(
                                              key: const ValueKey(
                                                'whatsapp-phone-option',
                                              ),
                                              padding: const EdgeInsets.only(
                                                top: 8,
                                              ),
                                              child: _WhatsAppPhoneOption(
                                                value:
                                                    _receiverPhoneIsWhatsappOnly,
                                                onChanged: (value) {
                                                  setState(
                                                    () =>
                                                        _receiverPhoneIsWhatsappOnly =
                                                            value,
                                                  );
                                                  _formKey.currentState
                                                      ?.validate();
                                                },
                                              ),
                                            )
                                          : const SizedBox.shrink(
                                              key: ValueKey(
                                                'no-whatsapp-phone-option',
                                              ),
                                            ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 14),
                                _FormSection(
                                  icon: Icons.public_outlined,
                                  title: l10n.destination,
                                  subtitle:
                                      l10n.destinationSubtitleEstimateRoute,
                                  children: [
                                    DestinationCountryField(
                                      value: _selectedCountry,
                                      label: AppLocalizations.of(
                                        context,
                                      )!.destinationCountry,
                                      requiredMessage: AppLocalizations.of(
                                        context,
                                      )!.requiredField,
                                      onChanged: _handleDestinationChanged,
                                    ),
                                    if (_selectedCountry != null) ...[
                                      const SizedBox(height: 14),
                                      _BusinessOptionSelector(
                                        countryId: _selectedCountry!.id,
                                        value: _selectedBusinessOption,
                                        onChanged: (option) {
                                          setState(() {
                                            _selectedBusinessOption = option;
                                          });
                                        },
                                      ),
                                    ],
                                    const SizedBox(height: 14),
                                    _PriceEstimateCard(
                                      shippingFee: _shippingFee,
                                      pickupFee: _pickupFee,
                                      pickupBorough: _pickupRequested
                                          ? _pickupBorough
                                          : 'Office drop-off',
                                      total: _estimatedTotal,
                                      useWalletBalance: _useWalletBalance,
                                      walletBalance: _walletBalance,
                                      needsReview: _needsPriceReview,
                                    ),
                                    _WalletPaymentOption(
                                      total: _estimatedTotal,
                                      selected: _useWalletBalance,
                                      onBalanceChanged: (balance) {
                                        if (_walletBalance == balance) return;
                                        setState(() {
                                          _walletBalance = balance;
                                        });
                                      },
                                      onChanged: (value) {
                                        setState(
                                          () => _useWalletBalance = value,
                                        );
                                      },
                                    ),
                                    if (!_canPay) ...[
                                      const SizedBox(height: 12),
                                      _InlineNotice(
                                        message:
                                            l10n.chooseBusinessWithShippingFee,
                                      ),
                                    ],
                                  ],
                                ),
                                const SizedBox(height: 18),
                                _SubmitButton(
                                  isSubmitting: _isSubmitting,
                                  canPay: _canPay,
                                  onPressed: _submit,
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

class _BarrelHero extends StatelessWidget {
  const _BarrelHero({required this.animation});

  final Animation<double> animation;

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
          AnimatedBuilder(
            animation: animation,
            builder: (context, child) {
              final lift = -5 * Curves.easeInOut.transform(animation.value);
              return Transform.translate(offset: Offset(0, lift), child: child);
            },
            child: Container(
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
                    fontSize: 24,
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

class _FormSection extends StatelessWidget {
  const _FormSection({
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

class _OfficeDropOffTile extends StatelessWidget {
  const _OfficeDropOffTile({super.key, required this.address});

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
                const Text(
                  'Drop-off office',
                  style: TextStyle(
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

class _BusinessOptionSelector extends StatelessWidget {
  const _BusinessOptionSelector({
    required this.countryId,
    required this.value,
    required this.onChanged,
  });

  final String countryId;
  final BusinessDestinationOption? value;
  final ValueChanged<BusinessDestinationOption?> onChanged;

  @override
  Widget build(BuildContext context) {
    final currency = NumberFormat.simpleCurrency();

    return StreamBuilder<List<BusinessDestinationOption>>(
      stream: BusinessService().optionsForCountry(countryId),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return const _InlineNotice(
            message:
                'Business options are not available right now. Please try again in a moment.',
          );
        }
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final options = snapshot.data!;
        if (options.isEmpty) {
          return const _InlineNotice(
            message:
                'No approved business is currently shipping to this destination.',
          );
        }
        final selectedOption =
            value != null && options.any((option) => option.id == value!.id)
            ? value
            : null;

        return FormField<BusinessDestinationOption>(
          key: ValueKey('business-options-$countryId-${selectedOption?.id}'),
          initialValue: selectedOption,
          validator: (option) =>
              option == null ? 'Please choose a business' : null,
          builder: (field) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Businesses shipping to this country',
                  style: Theme.of(
                    context,
                  ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 8),
                for (final option in options) ...[
                  _BusinessOptionCard(
                    option: option,
                    price: currency.format(option.country.barrelShippingPrice),
                    selected: field.value?.id == option.id,
                    onTap: () {
                      field.didChange(option);
                      onChanged(option);
                    },
                  ),
                  const SizedBox(height: 8),
                ],
                if (field.hasError)
                  Padding(
                    padding: const EdgeInsets.only(left: 12, top: 2),
                    child: Text(
                      field.errorText!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
              ],
            );
          },
        );
      },
    );
  }
}

class _BusinessOptionCard extends StatelessWidget {
  const _BusinessOptionCard({
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

    final note = option.serviceNote?.trim() ?? '';
    final deliveryEstimate = option.country.deliveryEstimateLabel;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: selected
              ? AppColors.cobalt.withValues(alpha: 0.08)
              : AppColors.paper,
          borderRadius: BorderRadius.circular(8),
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
                  : Icons.radio_button_unchecked,
              color: selected ? AppColors.cobalt : AppColors.muted,
            ),
            const SizedBox(width: 4),
            const Icon(Icons.storefront_outlined, size: 22),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    option.businessName,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                  if (contact.isNotEmpty)
                    Text(
                      contact,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  if (note.isNotEmpty)
                    Text(
                      note,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  if (deliveryEstimate != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: _DeliveryEstimateChip(label: deliveryEstimate),
                    ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 86),
              child: FittedBox(
                fit: BoxFit.scaleDown,
                alignment: Alignment.centerRight,
                child: Text(
                  price,
                  style: const TextStyle(
                    color: AppColors.cobaltDeep,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DeliveryEstimateChip extends StatelessWidget {
  const _DeliveryEstimateChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.sage.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.sage.withValues(alpha: 0.28)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.schedule_outlined, size: 14, color: AppColors.sage),
          const SizedBox(width: 5),
          Text(
            'Delivery $label',
            style: const TextStyle(
              color: AppColors.sage,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _SubmitButton extends StatelessWidget {
  const _SubmitButton({
    required this.isSubmitting,
    required this.canPay,
    required this.onPressed,
  });

  final bool isSubmitting;
  final bool canPay;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final enabled = !isSubmitting && canPay;

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
            isSubmitting ? l10n.processingPayment : l10n.payAndRequestShipment,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
          ),
        ),
      ),
    );
  }
}

class _WhatsAppPhoneOption extends StatelessWidget {
  const _WhatsAppPhoneOption({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return CheckboxListTile(
      value: value,
      onChanged: (checked) => onChanged(checked ?? false),
      contentPadding: EdgeInsets.zero,
      dense: true,
      controlAffinity: ListTileControlAffinity.leading,
      title: const Text(
        'This receiver number is used on WhatsApp',
        style: TextStyle(fontWeight: FontWeight.w700),
      ),
      subtitle: const Text(
        'Use this only if the receiver uses a different country number on WhatsApp.',
      ),
      activeColor: AppColors.cobaltDeep,
    );
  }
}

class _PickupChoice extends StatelessWidget {
  const _PickupChoice({
    required this.pickupRequested,
    required this.officeAddress,
    required this.onChanged,
  });

  final bool pickupRequested;
  final String officeAddress;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return SizedBox(
      width: double.infinity,
      child: SegmentedButton<bool>(
        segments: [
          ButtonSegment<bool>(
            value: true,
            icon: const Icon(Icons.local_shipping_outlined),
            label: Text(l10n.pickUp),
          ),
          ButtonSegment<bool>(
            value: false,
            icon: const Icon(Icons.storefront_outlined),
            label: Text(l10n.bringToOffice, overflow: TextOverflow.ellipsis),
            tooltip: officeAddress,
          ),
        ],
        selected: {pickupRequested},
        onSelectionChanged: (selection) => onChanged(selection.first),
        style: ButtonStyle(
          visualDensity: VisualDensity.standard,
          minimumSize: const WidgetStatePropertyAll(Size.fromHeight(48)),
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.selected)) {
              return AppColors.mist;
            }
            return AppColors.paper;
          }),
          foregroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.selected)) {
              return AppColors.cobaltDeep;
            }
            return AppColors.muted;
          }),
          side: const WidgetStatePropertyAll(BorderSide(color: AppColors.rule)),
          shape: WidgetStatePropertyAll(
            RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          ),
        ),
      ),
    );
  }
}

class _AddressAutocompleteField extends StatefulWidget {
  const _AddressAutocompleteField({
    required this.controller,
    required this.service,
    required this.onChanged,
    required this.validator,
  });

  final TextEditingController controller;
  final BarrelShipmentService service;
  final ValueChanged<String> onChanged;
  final String? Function(String?) validator;

  @override
  State<_AddressAutocompleteField> createState() =>
      _AddressAutocompleteFieldState();
}

class _AddressAutocompleteFieldState extends State<_AddressAutocompleteField> {
  late final FocusNode _focusNode;
  // Version counter for stale-request detection inside _buildOptions.
  // NOT tied to setState — mutations here never trigger a rebuild, which is
  // intentional: we pass _buildOptions as a method tearoff so that
  // RawAutocomplete.didUpdateWidget sees oldWidget.optionsBuilder ==
  // widget.optionsBuilder and skips _updateOptions(), breaking the loop where
  // every setState call re-triggered a new suggestion fetch.
  var _optionsVersion = 0;
  bool _isLocating = false;

  @override
  void initState() {
    super.initState();
    _focusNode = FocusNode();
  }

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  // ─── Suggestions (FutureOr — no setState, no infinite loop) ──────────────

  Future<Iterable<BarrelAddressSuggestion>> _buildOptions(
    TextEditingValue value,
  ) async {
    final query = value.text.trim();
    if (query.isEmpty) return const [];

    final version = ++_optionsVersion;
    // Debounce: wait for the user to pause typing.
    await Future.delayed(const Duration(milliseconds: 380));
    if (version != _optionsVersion) return const [];

    // 1. Firebase Function (Google Places) — works when user is signed in.
    try {
      final remote = await widget.service.addressSuggestions(query);
      if (version != _optionsVersion) return const [];
      if (remote.isNotEmpty) {
        return remote;
      }
    } catch (_) {}

    // 2. Nominatim (OpenStreetMap) — free, real addresses, no key needed.
    try {
      final results = await _nominatimSuggestions(query);
      if (version != _optionsVersion) return const [];
      return results;
    } catch (_) {
      return const [];
    }
  }

  Future<List<BarrelAddressSuggestion>> _nominatimSuggestions(
    String query,
  ) async {
    final uri = Uri.https('nominatim.openstreetmap.org', '/search', {
      'q': '$query, New York',
      'format': 'jsonv2',
      'limit': '6',
      'countrycodes': 'us',
      'addressdetails': '1',
    });
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 7);
    try {
      final req = await client.getUrl(uri);
      req.headers.set(HttpHeaders.userAgentHeader, 'Veyra-App/1.0');
      req.headers.set(HttpHeaders.acceptLanguageHeader, 'en-US,en;q=0.9');
      final res = await req.close();
      if (res.statusCode != 200) return const [];
      final body = await res.transform(utf8.decoder).join();
      final data = jsonDecode(body) as List<dynamic>;
      return data
          .whereType<Map<String, dynamic>>()
          .map(_formatNominatim)
          .whereType<BarrelAddressSuggestion>()
          .take(5)
          .toList();
    } finally {
      client.close();
    }
  }

  BarrelAddressSuggestion? _formatNominatim(Map<String, dynamic> result) {
    final addr = (result['address'] as Map?)?.cast<String, dynamic>();
    if (addr == null) return null;
    final houseNo = addr['house_number'] as String? ?? '';
    final road = addr['road'] as String? ?? '';
    final postcode = addr['postcode'] as String? ?? '';
    final borough =
        _NycAddressSuggestions.detectBorough(
          [
            addr['borough'] as String? ?? '',
            addr['city_district'] as String? ?? '',
            addr['county'] as String? ?? '',
            postcode,
          ].where((s) => s.isNotEmpty).join(', '),
        ) ??
        _NycAddressSuggestions.detectBorough(
          result['display_name'] as String? ?? '',
        );
    if (houseNo.isEmpty || road.isEmpty || borough == null) return null;
    final street = [houseNo, road].where((s) => s.isNotEmpty).join(' ');
    final description = [
      street,
      borough,
      'NY',
      postcode,
    ].where((s) => s.isNotEmpty).join(', ');
    final lat = double.tryParse(result['lat'] as String? ?? '');
    final lon = double.tryParse(result['lon'] as String? ?? '');
    return BarrelAddressSuggestion(
      description: description,
      placeId: result['place_id']?.toString() ?? '',
      borough: borough,
      postalCode: postcode.isEmpty ? null : postcode,
      formattedAddress: result['display_name'] as String?,
      latitude: lat,
      longitude: lon,
    );
  }

  // ─── GPS locate ──────────────────────────────────────────────────────────

  Future<void> _locateMe() async {
    setState(() => _isLocating = true);
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.deniedForever) {
        if (mounted) await Geolocator.openAppSettings();
        return;
      }
      if (permission == LocationPermission.denied) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                AppLocalizations.of(context)!.locationPermissionDenied,
              ),
            ),
          );
        }
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      );
      final placemarks = await placemarkFromCoordinates(
        position.latitude,
        position.longitude,
      );
      if (placemarks.isEmpty || !mounted) return;

      final p = placemarks.first;
      final address = [
        if (p.street?.isNotEmpty == true) p.street!,
        if (p.subLocality?.isNotEmpty == true) p.subLocality!,
        if (p.locality?.isNotEmpty == true) p.locality!,
        if (p.administrativeArea?.isNotEmpty == true) p.administrativeArea!,
        if (p.postalCode?.isNotEmpty == true) p.postalCode!,
      ].join(', ');

      widget.controller.text = address;
      widget.onChanged(address);
      _focusNode.requestFocus();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.couldNotGetLocation),
        ),
      );
    } finally {
      if (mounted) setState(() => _isLocating = false);
    }
  }

  // ─── Build ────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        RawAutocomplete<BarrelAddressSuggestion>(
          textEditingController: widget.controller,
          focusNode: _focusNode,
          displayStringForOption: (option) => option.description,
          // Method tearoff — equal across rebuilds so didUpdateWidget never
          // spuriously re-triggers _updateOptions and restarts the fetch.
          optionsBuilder: _buildOptions,
          onSelected: (selection) {
            widget.controller.text = selection.description;
            widget.onChanged(selection.description);
            _focusNode.requestFocus();
          },
          fieldViewBuilder:
              (context, textEditingController, focusNode, onFieldSubmitted) {
                return TextFormField(
                  controller: textEditingController,
                  focusNode: focusNode,
                  validator: widget.validator,
                  onChanged: widget.onChanged,
                  keyboardType: TextInputType.streetAddress,
                  decoration: InputDecoration(
                    labelText: l10n.pickupAddressInNyc,
                    hintText: l10n.pickupAddressNycHint,
                    prefixIcon: const Icon(Icons.location_on_outlined),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: const BorderSide(color: AppColors.rule),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: const BorderSide(
                        color: AppColors.brandRed,
                        width: 2,
                      ),
                    ),
                    errorBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(8),
                      borderSide: const BorderSide(color: AppColors.errorRed),
                    ),
                    filled: true,
                    fillColor: AppColors.lightSurfaceVariant,
                  ),
                );
              },
          optionsViewBuilder: (context, onSelected, options) {
            return Align(
              alignment: Alignment.topLeft,
              child: Material(
                elevation: 4,
                borderRadius: BorderRadius.circular(8),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    maxHeight: 240,
                    maxWidth: 420,
                  ),
                  child: ListView.builder(
                    padding: EdgeInsets.zero,
                    shrinkWrap: true,
                    itemCount: options.length,
                    itemBuilder: (context, index) {
                      final option = options.elementAt(index);
                      return ListTile(
                        dense: true,
                        leading: const Icon(
                          Icons.place_outlined,
                          size: 20,
                          color: AppColors.cobaltDeep,
                        ),
                        title: Text(option.description),
                        subtitle: option.borough == null
                            ? null
                            : Text('${option.borough} pickup address'),
                        onTap: () => onSelected(option),
                      );
                    },
                  ),
                ),
              ),
            );
          },
        ),
        const SizedBox(height: 8),
        _LocateMeButton(isLocating: _isLocating, onTap: _locateMe),
      ],
    );
  }
}

class _LocateMeButton extends StatelessWidget {
  const _LocateMeButton({required this.isLocating, required this.onTap});

  final bool isLocating;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: isLocating ? null : onTap,
        borderRadius: BorderRadius.circular(8),
        splashColor: AppColors.cobaltDeep.withValues(alpha: 0.08),
        highlightColor: AppColors.cobaltDeep.withValues(alpha: 0.05),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: AppColors.cobaltDeep.withValues(alpha: 0.05),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: AppColors.cobaltDeep.withValues(alpha: 0.18),
            ),
          ),
          child: Row(
            children: [
              if (isLocating)
                const SizedBox(
                  width: 17,
                  height: 17,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation(AppColors.cobaltDeep),
                  ),
                )
              else
                const Icon(
                  Icons.my_location,
                  size: 17,
                  color: AppColors.cobaltDeep,
                ),
              const SizedBox(width: 10),
              Text(
                isLocating
                    ? 'Getting your location…'
                    : 'Use my current location',
                style: const TextStyle(
                  color: AppColors.cobaltDeep,
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PickupDateTimeTile extends FormField<DateTime> {
  _PickupDateTimeTile({
    required DateTime? value,
    required VoidCallback onTap,
    required String? Function() validator,
  }) : super(
         initialValue: value,
         validator: (_) => validator(),
         builder: (state) {
           final formatted = value == null
               ? 'Choose pickup date and time'
               : DateFormat('EEE, MMM d, yyyy • h:mm a').format(value);
           return Column(
             crossAxisAlignment: CrossAxisAlignment.start,
             children: [
               Material(
                 color: AppColors.lightSurfaceVariant,
                 shape: RoundedRectangleBorder(
                   borderRadius: BorderRadius.circular(8),
                   side: BorderSide(
                     color: state.hasError
                         ? AppColors.errorRed
                         : AppColors.rule,
                     width: state.hasError ? 2 : 1,
                   ),
                 ),
                 clipBehavior: Clip.antiAlias,
                 child: ListTile(
                   contentPadding: const EdgeInsets.symmetric(
                     horizontal: 14,
                     vertical: 4,
                   ),
                   title: const Text(
                     'Pickup date and time',
                     style: TextStyle(fontWeight: FontWeight.w700),
                   ),
                   subtitle: Text(
                     formatted,
                     style: TextStyle(
                       color: value == null ? AppColors.muted : AppColors.ink,
                       fontWeight: FontWeight.w700,
                     ),
                   ),
                   trailing: const Icon(
                     Icons.event_available,
                     color: AppColors.brandRed,
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

class _PriceEstimateCard extends StatelessWidget {
  const _PriceEstimateCard({
    required this.shippingFee,
    required this.pickupFee,
    required this.pickupBorough,
    required this.total,
    required this.useWalletBalance,
    required this.walletBalance,
    required this.needsReview,
  });

  final double shippingFee;
  final double pickupFee;
  final String pickupBorough;
  final double total;
  final bool useWalletBalance;
  final double walletBalance;
  final bool needsReview;

  @override
  Widget build(BuildContext context) {
    final currency = NumberFormat.simpleCurrency();
    final walletApplied = useWalletBalance
        ? walletBalance.clamp(0, total).toDouble()
        : 0.0;
    final amountDue = (total - walletApplied).clamp(0, double.infinity);

    Widget row(String label, String value) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  color: AppColors.muted,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Text(
              value,
              style: const TextStyle(
                color: AppColors.ink,
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
                  useWalletBalance ? 'Amount due now' : 'Estimated cost',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Text(
                currency.format(amountDue),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              children: [
                row('Destination shipment', currency.format(shippingFee)),
                row(
                  pickupFee > 0 ? 'Pickup from $pickupBorough' : 'Pickup',
                  currency.format(pickupFee),
                ),
                if (pickupFee > 0) ...[
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      const Icon(
                        Icons.route_outlined,
                        size: 16,
                        color: AppColors.muted,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          'Fixed pickup price for this borough',
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
                if (useWalletBalance) ...[
                  const Divider(height: 18),
                  row('Original estimated cost', currency.format(total)),
                  row('Wallet credit', '-${currency.format(walletApplied)}'),
                  const Divider(height: 18),
                  row('Card payment due', currency.format(amountDue)),
                ],
              ],
            ),
          ),
          if (needsReview) ...[
            const SizedBox(height: 10),
            Text(
              'Final price will be confirmed by staff.',
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.86),
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _WalletPaymentOption extends StatelessWidget {
  const _WalletPaymentOption({
    required this.total,
    required this.selected,
    required this.onBalanceChanged,
    required this.onChanged,
  });

  final double total;
  final bool selected;
  final ValueChanged<double> onBalanceChanged;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    if (user == null || total <= 0 || auth.hasBusinessDashboardAccess) {
      return const SizedBox.shrink();
    }

    final currency = NumberFormat.simpleCurrency();
    return StreamBuilder<DocumentSnapshot>(
      stream: FirebaseFirestore.instance
          .collection('wallets')
          .doc(user.uid)
          .snapshots(),
      builder: (context, snapshot) {
        final data = snapshot.data?.data() as Map<String, dynamic>?;
        final balance =
            (data?['balance'] as num?)?.toDouble() ??
            (((data?['balanceCents'] as num?)?.toDouble() ?? 0) / 100);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (context.mounted) onBalanceChanged(balance);
        });
        if (balance <= 0) {
          if (selected) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (context.mounted) onChanged(false);
            });
          }
          return const SizedBox.shrink();
        }

        final applied = balance > total ? total : balance;
        final cardRemainder = (total - applied).clamp(0, double.infinity);
        return Padding(
          padding: const EdgeInsets.only(top: 12),
          child: InkWell(
            onTap: () => onChanged(!selected),
            borderRadius: BorderRadius.circular(8),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: selected
                    ? AppColors.cobalt.withValues(alpha: 0.1)
                    : AppColors.paper,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: selected ? AppColors.cobalt : AppColors.rule,
                  width: selected ? 1.5 : 1,
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Checkbox(
                    value: selected,
                    onChanged: (value) => onChanged(value ?? false),
                    activeColor: AppColors.cobalt,
                  ),
                  const SizedBox(width: 6),
                  Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(
                      color: AppColors.cobalt.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Icon(
                      Icons.account_balance_wallet_outlined,
                      color: AppColors.cobaltDeep,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Use wallet credit',
                          style: TextStyle(
                            color: AppColors.ink,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          selected
                              ? '${currency.format(applied)} from wallet • ${currency.format(cardRemainder)} remaining'
                              : '${currency.format(balance)} available',
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
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
      },
    );
  }
}

class _NycAddressSuggestions {
  static String? detectBorough(String value) {
    final lower = value.toLowerCase();
    if (lower.contains('bronx') || _zipInRange(lower, 10400, 10499)) {
      return 'Bronx';
    }
    if (lower.contains('manhattan') ||
        lower.contains('new york, ny') ||
        _zipInRange(lower, 10000, 10299)) {
      return 'Manhattan';
    }
    if (lower.contains('brooklyn') || _zipInRange(lower, 11200, 11299)) {
      return 'Brooklyn';
    }
    if (lower.contains('queens') ||
        lower.contains('jamaica') ||
        lower.contains('flushing') ||
        _zipInRange(lower, 11000, 11199) ||
        _zipInRange(lower, 11300, 11699)) {
      return 'Queens';
    }
    if (lower.contains('staten island') || _zipInRange(lower, 10300, 10399)) {
      return 'Staten Island';
    }
    return null;
  }

  static bool _zipInRange(String value, int start, int end) {
    final matches = RegExp(r'\b\d{5}\b').allMatches(value);
    for (final match in matches) {
      final zip = int.tryParse(match.group(0)!);
      if (zip != null && zip >= start && zip <= end) return true;
    }
    return false;
  }
}

class _ReceiverPhoneRules {
  static const _callingCodes = <String, List<String>>{
    'AF': ['93'],
    'AL': ['355'],
    'DZ': ['213'],
    'AD': ['376'],
    'AO': ['244'],
    'AR': ['54'],
    'AM': ['374'],
    'AU': ['61'],
    'AT': ['43'],
    'AZ': ['994'],
    'BS': ['1'],
    'BH': ['973'],
    'BD': ['880'],
    'BB': ['1'],
    'BY': ['375'],
    'BE': ['32'],
    'BZ': ['501'],
    'BJ': ['229'],
    'BT': ['975'],
    'BO': ['591'],
    'BA': ['387'],
    'BW': ['267'],
    'BR': ['55'],
    'BN': ['673'],
    'BG': ['359'],
    'BF': ['226'],
    'BI': ['257'],
    'CV': ['238'],
    'KH': ['855'],
    'CM': ['237'],
    'CA': ['1'],
    'CF': ['236'],
    'TD': ['235'],
    'CL': ['56'],
    'CN': ['86'],
    'CO': ['57'],
    'KM': ['269'],
    'CG': ['242'],
    'CD': ['243'],
    'CR': ['506'],
    'CI': ['225'],
    'HR': ['385'],
    'CU': ['53'],
    'CY': ['357'],
    'CZ': ['420'],
    'DK': ['45'],
    'DJ': ['253'],
    'DM': ['1'],
    'DO': ['1'],
    'EC': ['593'],
    'EG': ['20'],
    'SV': ['503'],
    'GQ': ['240'],
    'ER': ['291'],
    'EE': ['372'],
    'SZ': ['268'],
    'ET': ['251'],
    'FJ': ['679'],
    'FI': ['358'],
    'FR': ['33'],
    'GA': ['241'],
    'GM': ['220'],
    'GE': ['995'],
    'DE': ['49'],
    'GH': ['233'],
    'GR': ['30'],
    'GD': ['1'],
    'GT': ['502'],
    'GN': ['224'],
    'GW': ['245'],
    'GY': ['592'],
    'HT': ['509'],
    'HN': ['504'],
    'HU': ['36'],
    'IS': ['354'],
    'IN': ['91'],
    'ID': ['62'],
    'IR': ['98'],
    'IQ': ['964'],
    'IE': ['353'],
    'IL': ['972'],
    'IT': ['39'],
    'JM': ['1'],
    'JP': ['81'],
    'JO': ['962'],
    'KZ': ['7'],
    'KE': ['254'],
    'KI': ['686'],
    'KW': ['965'],
    'KG': ['996'],
    'LA': ['856'],
    'LV': ['371'],
    'LB': ['961'],
    'LS': ['266'],
    'LR': ['231'],
    'LY': ['218'],
    'LI': ['423'],
    'LT': ['370'],
    'LU': ['352'],
    'MG': ['261'],
    'MW': ['265'],
    'MY': ['60'],
    'MV': ['960'],
    'ML': ['223'],
    'MT': ['356'],
    'MH': ['692'],
    'MR': ['222'],
    'MU': ['230'],
    'MX': ['52'],
    'FM': ['691'],
    'MD': ['373'],
    'MC': ['377'],
    'MN': ['976'],
    'ME': ['382'],
    'MA': ['212'],
    'MZ': ['258'],
    'MM': ['95'],
    'NA': ['264'],
    'NR': ['674'],
    'NP': ['977'],
    'NL': ['31'],
    'NZ': ['64'],
    'NI': ['505'],
    'NE': ['227'],
    'NG': ['234'],
    'KP': ['850'],
    'MK': ['389'],
    'NO': ['47'],
    'OM': ['968'],
    'PK': ['92'],
    'PW': ['680'],
    'PS': ['970'],
    'PA': ['507'],
    'PG': ['675'],
    'PY': ['595'],
    'PE': ['51'],
    'PH': ['63'],
    'PL': ['48'],
    'PT': ['351'],
    'QA': ['974'],
    'RO': ['40'],
    'RU': ['7'],
    'RW': ['250'],
    'KN': ['1'],
    'LC': ['1'],
    'VC': ['1'],
    'WS': ['685'],
    'SM': ['378'],
    'ST': ['239'],
    'SA': ['966'],
    'SN': ['221'],
    'RS': ['381'],
    'SC': ['248'],
    'SL': ['232'],
    'SG': ['65'],
    'SK': ['421'],
    'SI': ['386'],
    'SB': ['677'],
    'SO': ['252'],
    'ZA': ['27'],
    'KR': ['82'],
    'SS': ['211'],
    'ES': ['34'],
    'LK': ['94'],
    'SD': ['249'],
    'SR': ['597'],
    'SE': ['46'],
    'CH': ['41'],
    'SY': ['963'],
    'TW': ['886'],
    'TJ': ['992'],
    'TZ': ['255'],
    'TH': ['66'],
    'TL': ['670'],
    'TG': ['228'],
    'TO': ['676'],
    'TT': ['1'],
    'TN': ['216'],
    'TR': ['90'],
    'TM': ['993'],
    'TV': ['688'],
    'UG': ['256'],
    'UA': ['380'],
    'AE': ['971'],
    'GB': ['44'],
    'US': ['1'],
    'UY': ['598'],
    'UZ': ['998'],
    'VU': ['678'],
    'VE': ['58'],
    'VN': ['84'],
    'YE': ['967'],
    'ZM': ['260'],
    'ZW': ['263'],
  };

  static String? validate({
    required String? value,
    required DestinationCountry? destination,
    required bool allowDifferentCountry,
    required String requiredMessage,
  }) {
    final raw = value?.trim() ?? '';
    if (raw.isEmpty) return requiredMessage;

    final normalized = raw.replaceAll(RegExp(r'[\s().-]'), '');
    if (!PhoneNumberValidator.isValid(raw)) {
      return 'Enter a valid phone number with country code.';
    }

    final international = normalized.startsWith('+')
        ? normalized.substring(1)
        : normalized;
    if (international.length < 8 || international.length > 15) {
      return 'Enter a valid international phone number.';
    }

    final destinationCode = destination?.displayCode ?? '';
    final expectedCodes = _callingCodes[destinationCode];
    if (expectedCodes == null || expectedCodes.isEmpty) {
      return null;
    }

    final matchesDestination = expectedCodes.any(
      (code) => international.startsWith(code),
    );
    if (matchesDestination) return null;

    if (allowDifferentCountry) {
      return normalized.startsWith('+')
          ? null
          : 'For WhatsApp numbers from another country, include + and the country code.';
    }

    final prefixExample = '+${expectedCodes.first}';
    final destinationName = destination?.name ?? 'the destination';
    return 'Receiver number must match $destinationName ($prefixExample) or mark it as a WhatsApp number.';
  }

  static bool isDifferentCountryNumber({
    required String value,
    required DestinationCountry? destination,
  }) {
    final normalized = value.trim().replaceAll(RegExp(r'[\s().-]'), '');
    if (!PhoneNumberValidator.isValid(value)) return false;

    final destinationCode = destination?.displayCode ?? '';
    final expectedCodes = _callingCodes[destinationCode];
    if (expectedCodes == null || expectedCodes.isEmpty) return false;

    final international = normalized.startsWith('+')
        ? normalized.substring(1)
        : normalized;
    return !expectedCodes.any((code) => international.startsWith(code));
  }
}

class _RoundedTextField extends StatelessWidget {
  const _RoundedTextField({
    required this.label,
    this.controller,
    this.validator,
    this.keyboardType,
    this.icon,
    this.onChanged,
    this.inputFormatters,
  });

  final String label;
  final TextEditingController? controller;
  final String? Function(String?)? validator;
  final TextInputType? keyboardType;
  final IconData? icon;
  final ValueChanged<String>? onChanged;
  final List<TextInputFormatter>? inputFormatters;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      validator: validator,
      keyboardType: keyboardType,
      inputFormatters: inputFormatters,
      onChanged: onChanged,
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
