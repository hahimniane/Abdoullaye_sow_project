import 'dart:async';

import 'package:flutter/material.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';
import '../models/destination_country.dart';
import '../services/barrel_pricing_service.dart';
import '../services/barrel_shipment_service.dart';
import '../utils/barrel_receipt_generator.dart';
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
  BarrelPickupPricing _pickupPricing = BarrelPickupPricing.defaultPricing;
  bool _pickupRequested = true;
  bool _isSubmitting = false;
  bool _pricingLoaded = false;
  String _pickupBorough = 'Bronx';
  DateTime? _pickupDateTime;
  bool _receiverPhoneIsWhatsappOnly = false;
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

  double get _shippingFee => _selectedCountry?.barrelShippingPrice ?? 0;
  double get _pickupFee =>
      _pickupRequested ? _pickupPricing.pickupFeeForBorough(_pickupBorough) : 0;
  double get _estimatedTotal => _shippingFee + _pickupFee;
  bool get _needsPriceReview =>
      !_pricingLoaded ||
      _shippingFee <= 0 ||
      (_pickupRequested && _pickupFee <= 0);
  bool get _canPay => _shippingFee > 0 && (!_pickupRequested || _pickupFee > 0);
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

    setState(() {
      _isSubmitting = true;
    });

    try {
      final shipment = await _shipmentService.payForShipment(
        senderName: _senderNameController.text.trim(),
        receiverName: _receiverNameController.text.trim(),
        receiverPhone: _receiverPhoneController.text.trim(),
        destinationCountryId: _selectedCountry!.id,
        pickupRequested: _pickupRequested,
        pickupAddress: pickupAddress,
        pickupBorough: _pickupRequested ? _pickupBorough : 'Office drop-off',
        pickupDateTime: _pickupRequested ? _pickupDateTime : null,
      );
      await generateBarrelShipmentReceipt(shipment: shipment);

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            AppLocalizations.of(
              context,
            )!.shipmentSavedWithTracking(shipment.trackingCode),
          ),
          backgroundColor: Colors.green,
        ),
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
          _pickupDateTime = null;
          _pickupBorough = 'Bronx';
          _receiverPhoneIsWhatsappOnly = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_friendlyShipmentError(context, e)),
          backgroundColor: Colors.red,
        ),
      );
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
                                  title: 'Sender',
                                  subtitle: 'Who is sending the barrel?',
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
                                  title: 'Pickup',
                                  subtitle: _pickupRequested
                                      ? 'We will collect it from a NYC address.'
                                      : 'You will bring it to the office.',
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
                                                      return 'Please enter the pickup address';
                                                    }
                                                    if (_NycAddressSuggestions.detectBorough(
                                                          value,
                                                        ) ==
                                                        null) {
                                                      return 'Please include the NYC borough or ZIP code';
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
                                                      return 'Please choose pickup date and time';
                                                    }
                                                    if (!_pickupDateTime!
                                                        .isAfter(
                                                          DateTime.now(),
                                                        )) {
                                                      return 'Pickup time must be in the future';
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
                                  title: 'Receiver',
                                  subtitle: 'Who should receive it overseas?',
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
                                  title: 'Destination',
                                  subtitle:
                                      'Choose the country so we can estimate the route.',
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
                                    const SizedBox(height: 14),
                                    _PriceEstimateCard(
                                      shippingFee: _shippingFee,
                                      pickupFee: _pickupFee,
                                      pickupBorough: _pickupRequested
                                          ? _pickupBorough
                                          : 'Office drop-off',
                                      total: _estimatedTotal,
                                      needsReview: _needsPriceReview,
                                    ),
                                    if (!_canPay) ...[
                                      const SizedBox(height: 12),
                                      const _InlineNotice(
                                        message:
                                            'Please ask staff to set a barrel shipping price for this destination before payment.',
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
            isSubmitting ? 'Processing payment' : 'Pay and request shipment',
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
    return SizedBox(
      width: double.infinity,
      child: SegmentedButton<bool>(
        segments: [
          const ButtonSegment<bool>(
            value: true,
            icon: Icon(Icons.local_shipping_outlined),
            label: Text('Pick up'),
          ),
          ButtonSegment<bool>(
            value: false,
            icon: const Icon(Icons.storefront_outlined),
            label: Text('Bring to office', overflow: TextOverflow.ellipsis),
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
  var _suggestions = const <String>[];
  var _requestVersion = 0;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _focusNode = FocusNode();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RawAutocomplete<String>(
      textEditingController: widget.controller,
      focusNode: _focusNode,
      optionsBuilder: (textEditingValue) {
        final query = textEditingValue.text.trim();
        if (query.isNotEmpty) {
          _loadSuggestions(query);
        }
        if (query.isEmpty) return const Iterable<String>.empty();
        return _suggestions.isEmpty
            ? _NycAddressSuggestions.match(query)
            : _suggestions;
      },
      onSelected: (selection) {
        widget.controller.text = selection;
        widget.onChanged(selection);
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
                labelText: 'Pickup address in NYC',
                hintText: 'Street, borough, ZIP',
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
              constraints: const BoxConstraints(maxHeight: 240, maxWidth: 420),
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
                    title: Text(option),
                    onTap: () => onSelected(option),
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _loadSuggestions(String query) async {
    final version = ++_requestVersion;
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 220), () async {
      try {
        final remote = await widget.service.addressSuggestions(query);
        if (!mounted || version != _requestVersion) return;
        setState(() {
          _suggestions = remote.map((item) => item.description).toList();
        });
      } catch (_) {
        if (!mounted || version != _requestVersion) return;
        setState(() {
          _suggestions = _NycAddressSuggestions.match(query).toList();
        });
      }
    });
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
               ListTile(
                 contentPadding: const EdgeInsets.symmetric(
                   horizontal: 14,
                   vertical: 4,
                 ),
                 tileColor: AppColors.lightSurfaceVariant,
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
                 shape: RoundedRectangleBorder(
                   borderRadius: BorderRadius.circular(8),
                   side: BorderSide(
                     color: state.hasError
                         ? AppColors.errorRed
                         : AppColors.rule,
                     width: state.hasError ? 2 : 1,
                   ),
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
    required this.needsReview,
  });

  final double shippingFee;
  final double pickupFee;
  final String pickupBorough;
  final double total;
  final bool needsReview;

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
              const Expanded(
                child: Text(
                  'Estimated cost',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Text(
                currency.format(total),
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

class _NycAddressSuggestions {
  static const _samples = [
    'Bronx, NY 10451',
    'Fordham Road, Bronx, NY 10458',
    'Grand Concourse, Bronx, NY 10456',
    'East 149th Street, Bronx, NY 10455',
    'Manhattan, NY 10001',
    'Harlem, Manhattan, NY 10027',
    'Washington Heights, Manhattan, NY 10032',
    'Brooklyn, NY 11201',
    'Flatbush, Brooklyn, NY 11226',
    'Crown Heights, Brooklyn, NY 11213',
    'Queens, NY 11375',
    'Jamaica, Queens, NY 11432',
    'Flushing, Queens, NY 11354',
    'Staten Island, NY 10301',
    'St George, Staten Island, NY 10301',
  ];

  static Iterable<String> match(String query) {
    final lower = query.toLowerCase();
    final matches = _samples.where(
      (address) => address.toLowerCase().contains(lower),
    );
    final borough = detectBorough(query);
    if (borough == null) return matches.take(5);
    return [
      '$query, $borough, NY',
      ...matches,
    ].where((value) => value.trim().isNotEmpty).take(5);
  }

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
    if (!RegExp(r'^\+?\d{7,15}$').hasMatch(normalized)) {
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
    if (!RegExp(r'^\+?\d{7,15}$').hasMatch(normalized)) return false;

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
  });

  final String label;
  final TextEditingController? controller;
  final String? Function(String?)? validator;
  final TextInputType? keyboardType;
  final IconData? icon;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      validator: validator,
      keyboardType: keyboardType,
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
