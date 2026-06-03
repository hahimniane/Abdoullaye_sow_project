import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../data/car_catalog.dart';
import '../l10n/app_localizations.dart';
import '../models/business_profile.dart';
import '../models/destination_country.dart';
import '../models/transport_request.dart';
import '../providers/auth_provider.dart';
import '../utils/tracking_code_generator.dart';
import '../utils/action_confirmation.dart';
import '../utils/transport_receipt_generator.dart';
import '../widgets/app_back_button.dart';
import '../widgets/destination_country_field.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/language_toggle.dart';
import '../theme/app_colors.dart';

class TransportCarScreen extends StatefulWidget {
  const TransportCarScreen({super.key});

  @override
  State<TransportCarScreen> createState() => _TransportCarScreenState();
}

class _TransportCarScreenState extends State<TransportCarScreen> {
  final _formKey = GlobalKey<FormState>();
  final _ownerController = TextEditingController();
  final _vinController = TextEditingController();
  final _priceController = TextEditingController();

  String? _selectedMake;
  String? _selectedModel;
  String? _selectedYear;
  DestinationCountry? _selectedCountry;

  List<String> _makeOptions = [];
  List<String> _modelOptions = [];
  List<String> _yearOptions = [];

  DateTime _transportDate = DateTime.now();
  bool _isCatalogLoading = true;
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _loadCatalog();
  }

  Future<void> _loadCatalog() async {
    final catalog = CarCatalog.instance;
    await catalog.load();
    setState(() {
      _makeOptions = catalog.getMakes();
      _isCatalogLoading = false;
    });
  }

  @override
  void dispose() {
    _ownerController.dispose();
    _vinController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  Future<void> _pickTransportDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _transportDate,
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
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
    if (picked != null) {
      setState(() => _transportDate = picked);
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    final l10n = AppLocalizations.of(context)!;
    final price = double.tryParse(_priceController.text.trim());
    if (price == null) {
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
      title: l10n.submitTransportRequestQuestion,
      message: l10n.submitTransportRequestMessage,
      confirmLabel: l10n.submitRequest,
      icon: Icons.local_shipping_outlined,
    );
    if (!confirmed || !mounted) return;

    setState(() => _isSubmitting = true);

    try {
      final auth = context.read<AuthProvider>();
      final trackingCode = await TrackingCodeGenerator.generateUniqueCode(
        prefix: 'TR',
        collectionPath: 'transportRequests',
      );

      final request = TransportRequest(
        id: '',
        trackingCode: trackingCode,
        ownerName: _ownerController.text.trim(),
        carMake: _selectedMake!,
        carModel: _selectedModel!,
        carYear: _selectedYear!,
        vinNumber: _vinController.text.trim(),
        destinationCountryId:
            _selectedCountry?.id ?? DestinationCountry.fallback.id,
        destinationCountryName:
            _selectedCountry?.name ?? DestinationCountry.fallback.name,
        transportDate: _transportDate,
        price: price,
        status: 'pending',
        createdAt: DateTime.now(),
      );

      final docRef = await FirebaseFirestore.instance
          .collection('transportRequests')
          .add({
            ...request.toFirestore(),
            'businessId': auth.isAdmin
                ? BusinessProfile.defaultBusinessId
                : auth.businessId ?? BusinessProfile.defaultBusinessId,
            'businessName': auth.isAdmin
                ? BusinessProfile.defaultBusinessName
                : auth.businessName ?? BusinessProfile.defaultBusinessName,
          });

      final savedRequest = request.copyWith(id: docRef.id);
      await generateTransportReceipt(request: savedRequest);

      if (!mounted) return;
      showSuccessSnackBar(
        context,
        l10n.transportRequestSavedWithTracking(savedRequest.trackingCode),
      );
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      showErrorSnackBar(context, l10n.failedToSaveTransport(e.toString()));
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.of(context).size.width;
    final l10n = AppLocalizations.of(context)!;

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppColors.headerGradient),
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: Row(
                  children: [
                    const AppBackButton(onDarkBackground: true),
                    Expanded(
                      child: Text(
                        l10n.transportCars,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const LanguageToggle(),
                  ],
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: EdgeInsets.all(width * 0.06),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: double.infinity,
                        padding: EdgeInsets.all(width * 0.06),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.3),
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
                                Icons.directions_car,
                                size: 40,
                                color: Colors.white,
                              ),
                            ),
                            const SizedBox(height: 16),
                            Text(
                              l10n.carTransportService,
                              style: const TextStyle(
                                fontSize: 24,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: 8),
                            Text(
                              l10n.enterCarTransportDetails,
                              style: const TextStyle(
                                fontSize: 16,
                                color: Colors.white70,
                              ),
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 32),
                      Container(
                        padding: EdgeInsets.all(width * 0.06),
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
                                label: l10n.ownerName,
                                controller: _ownerController,
                                validator: (value) {
                                  if (value == null || value.trim().isEmpty) {
                                    return l10n.pleaseEnterOwnerName;
                                  }
                                  return null;
                                },
                              ),
                              const SizedBox(height: 16),
                              if (_isCatalogLoading)
                                const Padding(
                                  padding: EdgeInsets.symmetric(vertical: 24.0),
                                  child: Center(
                                    child: CircularProgressIndicator(),
                                  ),
                                )
                              else ...[
                                _RoundedDropdownField(
                                  label: l10n.carMake,
                                  value: _selectedMake,
                                  items: _makeOptions,
                                  onChanged: (value) {
                                    setState(() {
                                      _selectedMake = value;
                                      _selectedModel = null;
                                      _selectedYear = null;
                                      _modelOptions = value == null
                                          ? <String>[]
                                          : CarCatalog.instance.getModels(
                                              value,
                                            );
                                      _yearOptions = <String>[];
                                    });
                                  },
                                  validator: (value) {
                                    if (value == null || value.isEmpty) {
                                      return l10n.pleaseEnterCarMake;
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: 16),
                                _RoundedDropdownField(
                                  label: l10n.carModel,
                                  value: _selectedModel,
                                  items: _modelOptions,
                                  enabled: _selectedMake != null,
                                  onChanged: (value) {
                                    setState(() {
                                      _selectedModel = value;
                                      if (_selectedMake != null &&
                                          value != null) {
                                        _yearOptions = CarCatalog.instance
                                            .getYears(_selectedMake!, value);
                                      } else {
                                        _yearOptions = <String>[];
                                      }
                                      _selectedYear = null;
                                    });
                                  },
                                  validator: (value) {
                                    if (value == null || value.isEmpty) {
                                      return l10n.pleaseEnterCarModel;
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: 16),
                                _RoundedDropdownField(
                                  label: l10n.carYear,
                                  value: _selectedYear,
                                  items: _yearOptions,
                                  enabled: _selectedModel != null,
                                  onChanged: (value) =>
                                      setState(() => _selectedYear = value),
                                  validator: (value) {
                                    if (value == null || value.isEmpty) {
                                      return l10n.pleaseEnterCarYear;
                                    }
                                    return null;
                                  },
                                ),
                              ],
                              const SizedBox(height: 16),
                              _RoundedTextField(
                                label: l10n.vinNumber,
                                controller: _vinController,
                                validator: (value) {
                                  if (value == null || value.trim().isEmpty) {
                                    return l10n.pleaseEnterVinNumber;
                                  }
                                  return null;
                                },
                              ),
                              const SizedBox(height: 16),
                              DestinationCountryField(
                                value: _selectedCountry,
                                label: l10n.destinationCountry,
                                requiredMessage: l10n.requiredField,
                                onChanged: (country) {
                                  setState(() => _selectedCountry = country);
                                },
                              ),
                              const SizedBox(height: 16),
                              _DatePickerTile(
                                label: l10n.transportDate,
                                value: DateFormat.yMMMd().format(
                                  _transportDate,
                                ),
                                onTap: _pickTransportDate,
                              ),
                              const SizedBox(height: 16),
                              _RoundedTextField(
                                label: l10n.price,
                                controller: _priceController,
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                      decimal: true,
                                    ),
                                validator: (value) {
                                  if (value == null || value.trim().isEmpty) {
                                    return l10n.pleaseEnterPrice;
                                  }
                                  if (double.tryParse(value.trim()) == null) {
                                    return l10n.pleaseEnterValidNumber;
                                  }
                                  return null;
                                },
                              ),
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
                                  onPressed: _isSubmitting ? null : _submit,
                                  child: _isSubmitting
                                      ? const SizedBox(
                                          width: 22,
                                          height: 22,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            valueColor:
                                                AlwaysStoppedAnimation<Color>(
                                                  Colors.white,
                                                ),
                                          ),
                                        )
                                      : Text(
                                          l10n.submit,
                                          style: const TextStyle(
                                            fontSize: 16,
                                            fontWeight: FontWeight.w600,
                                          ),
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

class _RoundedTextField extends StatelessWidget {
  const _RoundedTextField({
    required this.label,
    this.controller,
    this.validator,
    this.keyboardType,
  });

  final String label;
  final TextEditingController? controller;
  final String? Function(String?)? validator;
  final TextInputType? keyboardType;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      validator: validator,
      keyboardType: keyboardType,
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

class _RoundedDropdownField extends StatelessWidget {
  const _RoundedDropdownField({
    required this.label,
    required this.items,
    this.value,
    this.onChanged,
    this.validator,
    this.enabled = true,
  });

  final String label;
  final List<String> items;
  final String? value;
  final ValueChanged<String?>? onChanged;
  final String? Function(String?)? validator;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final effectiveItems = List<String>.from(items);
    if (value != null && value!.isNotEmpty && !effectiveItems.contains(value)) {
      effectiveItems.insert(0, value!);
    }

    final selectedValue = enabled && effectiveItems.contains(value)
        ? value
        : null;

    return DropdownButtonFormField<String>(
      key: ValueKey<String?>(selectedValue),
      initialValue: selectedValue,
      items: effectiveItems
          .map(
            (item) => DropdownMenuItem<String>(value: item, child: Text(item)),
          )
          .toList(),
      onChanged: enabled ? onChanged : null,
      validator: validator,
      decoration: InputDecoration(
        labelText: label,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }
}

class _DatePickerTile extends StatelessWidget {
  const _DatePickerTile({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(label),
      subtitle: Text(
        value,
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      trailing: const Icon(Icons.calendar_today, color: AppColors.brandRed),
      onTap: onTap,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.grey.shade300),
      ),
    );
  }
}
