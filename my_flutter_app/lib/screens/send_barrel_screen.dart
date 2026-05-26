import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
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

class _SendBarrelScreenState extends State<SendBarrelScreen> {
  final _formKey = GlobalKey<FormState>();
  final _senderNameController = TextEditingController();
  final _senderAddressController = TextEditingController();
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

  @override
  void initState() {
    super.initState();
    _loadPricing();
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
    _senderNameController.dispose();
    _senderAddressController.dispose();
    _pickupAddressController.dispose();
    _receiverNameController.dispose();
    _receiverPhoneController.dispose();
    super.dispose();
  }

  double get _shippingFee => _selectedCountry?.barrelShippingPrice ?? 0;
  double get _pickupMiles =>
      _pickupRequested ? _pickupPricing.milesForBorough(_pickupBorough) : 0;
  double get _pickupFee =>
      _pickupRequested ? _pickupPricing.pickupFeeForBorough(_pickupBorough) : 0;
  double get _estimatedTotal => _shippingFee + _pickupFee;
  bool get _needsPriceReview =>
      !_pricingLoaded ||
      _shippingFee <= 0 ||
      (_pickupRequested && _pickupFee <= 0);
  bool get _canPay => _shippingFee > 0 && (!_pickupRequested || _pickupFee > 0);

  void _handlePickupAddressChanged(String address) {
    final borough = _NycAddressSuggestions.detectBorough(address);
    if (borough != null && borough != _pickupBorough) {
      setState(() => _pickupBorough = borough);
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

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
        _senderAddressController.clear();
        _pickupAddressController.clear();
        _receiverNameController.clear();
        _receiverPhoneController.clear();
        setState(() {
          _selectedCountry = null;
          _pickupDateTime = null;
          _pickupBorough = 'Bronx';
        });
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.failedToSaveShipment(e)),
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
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppColors.headerGradient),
        child: SafeArea(
          child: Column(
            children: [
              // Header with back button and language toggle
              Padding(
                padding: const EdgeInsets.all(16.0),
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
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
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
              // Main content
              Expanded(
                child: SingleChildScrollView(
                  padding: EdgeInsets.all(
                    MediaQuery.of(context).size.width * 0.06,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Header Section
                      Container(
                        width: double.infinity,
                        padding: EdgeInsets.all(
                          MediaQuery.of(context).size.width * 0.06,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.3),
                            width: 1,
                          ),
                        ),
                        child: Column(
                          children: [
                            Container(
                              width: 80,
                              height: 80,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.2),
                                borderRadius: BorderRadius.circular(40),
                              ),
                              child: const Icon(
                                Icons.local_shipping,
                                size: 40,
                                color: Colors.white,
                              ),
                            ),
                            const SizedBox(height: 16),
                            Text(
                              AppLocalizations.of(
                                context,
                              )!.barrelShippingService,
                              style: const TextStyle(
                                fontSize: 24,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                              textAlign: TextAlign.center,
                              overflow: TextOverflow.ellipsis,
                              maxLines: 2,
                            ),
                            const SizedBox(height: 8),
                            Text(
                              AppLocalizations.of(
                                context,
                              )!.enterShippingDetails,
                              style: const TextStyle(
                                fontSize: 16,
                                color: Colors.white70,
                              ),
                              textAlign: TextAlign.center,
                              overflow: TextOverflow.ellipsis,
                              maxLines: 3,
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(height: 32),

                      // Form Section
                      Container(
                        padding: EdgeInsets.all(
                          MediaQuery.of(context).size.width * 0.06,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.1),
                              blurRadius: 20,
                              offset: const Offset(0, 10),
                            ),
                          ],
                        ),
                        child: Form(
                          key: _formKey,
                          child: Column(
                            children: [
                              _RoundedTextField(
                                label: AppLocalizations.of(context)!.senderName,
                                controller: _senderNameController,
                                validator: (value) {
                                  if (value == null || value.isEmpty) {
                                    return AppLocalizations.of(
                                      context,
                                    )!.pleaseEnterSenderName;
                                  }
                                  return null;
                                },
                              ),
                              const SizedBox(height: 16),
                              _PickupChoice(
                                pickupRequested: _pickupRequested,
                                officeAddress: _pickupPricing.officeAddress,
                                onChanged: (value) {
                                  setState(() => _pickupRequested = value);
                                },
                              ),
                              const SizedBox(height: 16),
                              if (_pickupRequested)
                                _AddressAutocompleteField(
                                  controller: _pickupAddressController,
                                  service: _shipmentService,
                                  onChanged: _handlePickupAddressChanged,
                                  validator: (value) {
                                    if (value == null || value.trim().isEmpty) {
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
                                )
                              else
                                _RoundedTextField(
                                  label: 'Drop-off office',
                                  controller: _senderAddressController
                                    ..text = _pickupPricing.officeAddress,
                                  readOnly: true,
                                ),
                              const SizedBox(height: 16),
                              if (_pickupRequested) ...[
                                _PickupDateTimeTile(
                                  value: _pickupDateTime,
                                  onTap: _pickPickupDateTime,
                                  validator: () {
                                    if (_pickupDateTime == null) {
                                      return 'Please choose pickup date and time';
                                    }
                                    if (!_pickupDateTime!.isAfter(
                                      DateTime.now(),
                                    )) {
                                      return 'Pickup time must be in the future';
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: 16),
                              ],
                              _RoundedTextField(
                                label: AppLocalizations.of(
                                  context,
                                )!.receiverName,
                                controller: _receiverNameController,
                                validator: (value) {
                                  if (value == null || value.isEmpty) {
                                    return AppLocalizations.of(
                                      context,
                                    )!.pleaseEnterReceiverName;
                                  }
                                  return null;
                                },
                              ),
                              const SizedBox(height: 16),
                              _RoundedTextField(
                                label: AppLocalizations.of(
                                  context,
                                )!.receiverPhone,
                                controller: _receiverPhoneController,
                                keyboardType: TextInputType.phone,
                                validator: (value) {
                                  if (value == null || value.isEmpty) {
                                    return AppLocalizations.of(
                                      context,
                                    )!.pleaseEnterReceiverPhone;
                                  }
                                  return null;
                                },
                              ),
                              const SizedBox(height: 16),
                              DestinationCountryField(
                                value: _selectedCountry,
                                label: AppLocalizations.of(
                                  context,
                                )!.destinationCountry,
                                requiredMessage: AppLocalizations.of(
                                  context,
                                )!.requiredField,
                                onChanged: (country) {
                                  setState(() => _selectedCountry = country);
                                },
                              ),
                              const SizedBox(height: 16),
                              _PriceEstimateCard(
                                shippingFee: _shippingFee,
                                pickupFee: _pickupFee,
                                pickupMiles: _pickupMiles,
                                pickupBorough: _pickupRequested
                                    ? _pickupBorough
                                    : 'Office drop-off',
                                total: _estimatedTotal,
                                needsReview: _needsPriceReview,
                              ),
                              if (!_canPay) ...[
                                const SizedBox(height: 10),
                                Text(
                                  'Please ask staff to set a barrel shipping price for this destination before payment.',
                                  style: TextStyle(
                                    color: Colors.orange.shade900,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                              const SizedBox(height: 32),
                              SizedBox(
                                width: double.infinity,
                                height: 56,
                                child: ElevatedButton(
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: AppColors.brandRed,
                                    foregroundColor: Colors.white,
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    elevation: 0,
                                    splashFactory: NoSplash.splashFactory,
                                  ),
                                  onPressed: _isSubmitting || !_canPay
                                      ? null
                                      : _submit,
                                  child: _isSubmitting
                                      ? const SizedBox(
                                          height: 24,
                                          width: 24,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            valueColor:
                                                AlwaysStoppedAnimation<Color>(
                                                  Colors.white,
                                                ),
                                          ),
                                        )
                                      : Text(
                                          'Pay and request shipment',
                                          style: const TextStyle(
                                            fontSize: 16,
                                            fontWeight: FontWeight.w600,
                                          ),
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
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
    return SegmentedButton<bool>(
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
        visualDensity: VisualDensity.compact,
        side: WidgetStatePropertyAll(BorderSide(color: Colors.grey.shade300)),
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

  @override
  Widget build(BuildContext context) {
    return RawAutocomplete<String>(
      textEditingController: widget.controller,
      focusNode: _focusNode,
      optionsBuilder: (textEditingValue) {
        final query = textEditingValue.text.trim();
        if (query.length >= 3) {
          _loadSuggestions(query);
        }
        if (query.length < 2) return const Iterable<String>.empty();
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
                  borderRadius: BorderRadius.circular(12),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide(color: Colors.grey.shade300),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: const BorderSide(
                    color: AppColors.brandRed,
                    width: 2,
                  ),
                ),
                filled: true,
                fillColor: Colors.grey.shade50,
              ),
            );
          },
      optionsViewBuilder: (context, onSelected, options) {
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 4,
            borderRadius: BorderRadius.circular(12),
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
                    leading: const Icon(Icons.place_outlined, size: 20),
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
                 contentPadding: EdgeInsets.zero,
                 title: const Text('Pickup date and time'),
                 subtitle: Text(
                   formatted,
                   style: TextStyle(
                     color: value == null ? Colors.grey.shade700 : Colors.black,
                     fontWeight: FontWeight.w600,
                   ),
                 ),
                 trailing: const Icon(
                   Icons.event_available,
                   color: AppColors.brandRed,
                 ),
                 onTap: onTap,
                 shape: RoundedRectangleBorder(
                   borderRadius: BorderRadius.circular(12),
                   side: BorderSide(
                     color: state.hasError ? Colors.red : Colors.grey.shade300,
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
    required this.pickupMiles,
    required this.pickupBorough,
    required this.total,
    required this.needsReview,
  });

  final double shippingFee;
  final double pickupFee;
  final double pickupMiles;
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
            Expanded(child: Text(label)),
            Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.cream,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.shade300),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Estimated cost',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          row('Destination shipment', currency.format(shippingFee)),
          row(
            pickupMiles > 0 ? 'Pickup from $pickupBorough' : 'Pickup',
            currency.format(pickupFee),
          ),
          if (pickupMiles > 0)
            Text(
              '${pickupMiles.toStringAsFixed(0)} estimated miles to Bronx office',
              style: TextStyle(color: Colors.grey.shade700, fontSize: 12),
            ),
          const Divider(height: 24),
          row('Total estimate', currency.format(total)),
          if (needsReview) ...[
            const SizedBox(height: 8),
            Text(
              'Final price will be confirmed by staff.',
              style: TextStyle(
                color: Colors.orange.shade900,
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

class _RoundedTextField extends StatelessWidget {
  const _RoundedTextField({
    required this.label,
    this.controller,
    this.validator,
    this.keyboardType,
    this.readOnly = false,
  });

  final String label;
  final TextEditingController? controller;
  final String? Function(String?)? validator;
  final TextInputType? keyboardType;
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
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.grey.shade300),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.brandRed, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Colors.red, width: 2),
        ),
        filled: true,
        fillColor: Colors.grey.shade50,
      ),
    );
  }
}
