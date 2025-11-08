import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../data/car_catalog.dart';
import '../l10n/app_localizations.dart';
import '../models/transport_request.dart';
import '../providers/auth_provider.dart';
import '../utils/transport_receipt_generator.dart';
import '../widgets/language_toggle.dart';

class TransportRequestDetailsScreen extends StatefulWidget {
  const TransportRequestDetailsScreen({super.key, required this.request});

  final TransportRequest request;

  @override
  State<TransportRequestDetailsScreen> createState() =>
      _TransportRequestDetailsScreenState();
}

class _TransportRequestDetailsScreenState
    extends State<TransportRequestDetailsScreen> {
  final _formKey = GlobalKey<FormState>();

  late TextEditingController _ownerController;
  late TextEditingController _vinController;
  late TextEditingController _priceController;

  String? _selectedMake;
  String? _selectedModel;
  String? _selectedYear;

  List<String> _makeOptions = [];
  List<String> _modelOptions = [];
  List<String> _yearOptions = [];

  DateTime _transportDate = DateTime.now();
  late String _statusDraft;
  late String _persistedStatus;
  late String _trackingCode;

  bool _isSaving = false;

  StreamSubscription<DocumentSnapshot>? _subscription;

  static const _statusOptions = ['pending', 'in_transit', 'completed'];

  @override
  void initState() {
    super.initState();
    _ownerController = TextEditingController(text: widget.request.ownerName);
    _vinController = TextEditingController(text: widget.request.vinNumber);
    _priceController = TextEditingController(
      text: NumberFormat('#.##').format(widget.request.price),
    );
    _selectedMake = widget.request.carMake.isNotEmpty ? widget.request.carMake : null;
    _selectedModel = widget.request.carModel.isNotEmpty ? widget.request.carModel : null;
    _selectedYear = widget.request.carYear.isNotEmpty ? widget.request.carYear : null;
    _transportDate = widget.request.transportDate;
    _persistedStatus = widget.request.status;
    _statusDraft = _persistedStatus;
    _trackingCode = widget.request.trackingCode;

    _initializeCatalog();

    _subscription = FirebaseFirestore.instance
        .collection('transportRequests')
        .doc(widget.request.id)
        .snapshots()
        .listen(_handleSnapshot);
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _ownerController.dispose();
    _vinController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  Future<void> _initializeCatalog() async {
    final catalog = CarCatalog.instance;
    await catalog.load();
    _refreshCatalogOptions();
    if (mounted) {
      setState(() {});
    }
  }

  void _handleSnapshot(DocumentSnapshot snapshot) {
    if (!snapshot.exists) return;
    final latest = TransportRequest.fromFirestore(snapshot);

    if (!mounted) return;

    _isSaving = false;
    _trackingCode = latest.trackingCode;
    _persistedStatus = latest.status;
    _statusDraft = _persistedStatus;
    _transportDate = latest.transportDate;
    _ownerController.text = latest.ownerName;
    _vinController.text = latest.vinNumber;
    _priceController.text = NumberFormat('#.##').format(latest.price);
    _selectedMake = latest.carMake.isNotEmpty ? latest.carMake : null;
    _selectedModel = latest.carModel.isNotEmpty ? latest.carModel : null;
    _selectedYear = latest.carYear.isNotEmpty ? latest.carYear : null;
    _refreshCatalogOptions();

    setState(() {});
  }

  void _refreshCatalogOptions() {
    final catalog = CarCatalog.instance;
    _makeOptions = catalog.getMakes();
    if (_selectedMake != null && !_makeOptions.contains(_selectedMake)) {
      _makeOptions.insert(0, _selectedMake!);
    }

    _modelOptions = _selectedMake == null
        ? <String>[]
        : catalog.getModels(_selectedMake!);
    if (_selectedModel != null && !_modelOptions.contains(_selectedModel)) {
      _modelOptions.insert(0, _selectedModel!);
    }

    _yearOptions = (_selectedMake != null && _selectedModel != null)
        ? catalog.getYears(_selectedMake!, _selectedModel!)
        : <String>[];
    if (_selectedYear != null && !_yearOptions.contains(_selectedYear)) {
      _yearOptions.insert(0, _selectedYear!);
    }
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
              primary: Color(0xFF667eea),
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
      setState(() {
        _transportDate = picked;
      });
    }
  }

  Future<void> _copyTrackingNumber() async {
    await Clipboard.setData(ClipboardData(text: _trackingCode));
    if (!mounted) return;
    final l10n = AppLocalizations.of(context)!;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(l10n.trackingNumberCopied)),
    );
  }

  Future<void> _reprintReceipt() async {
    final latestSnapshot = await FirebaseFirestore.instance
        .collection('transportRequests')
        .doc(widget.request.id)
        .get();
    final latest = latestSnapshot.exists
        ? TransportRequest.fromFirestore(latestSnapshot)
        : widget.request;
    await generateTransportReceipt(request: latest);
  }

  Future<void> _updateRequest() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    final l10n = AppLocalizations.of(context)!;
    final parsedPrice = double.tryParse(_priceController.text.trim());
    if (parsedPrice == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.pleaseEnterValidNumber),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    setState(() => _isSaving = true);

    try {
      await FirebaseFirestore.instance
          .collection('transportRequests')
          .doc(widget.request.id)
          .update({
        'ownerName': _ownerController.text.trim(),
        'carMake': _selectedMake ?? '',
        'carModel': _selectedModel ?? '',
        'carYear': _selectedYear ?? '',
        'vinNumber': _vinController.text.trim(),
        'transportDate': Timestamp.fromDate(_transportDate),
        'price': parsedPrice,
        'status': _statusDraft,
      });

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.transportUpdatedSuccessfully),
          backgroundColor: Colors.green,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.failedToUpdateTransport(e)),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = Provider.of<AuthProvider>(context);
    final canEdit = auth.isAdmin && _persistedStatus != 'completed';

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF667eea), Color(0xFF764ba2)],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                child: Row(
                  children: [
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.arrow_back_ios, color: Colors.white),
                    ),
                    Expanded(
                      child: Text(
                        l10n.transportRequestDetails,
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
                  padding: EdgeInsets.all(MediaQuery.of(context).size.width * 0.06),
                  child: Container(
                    padding: EdgeInsets.all(MediaQuery.of(context).size.width * 0.05),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(24),
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
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      l10n.trackingNumber,
                                      style: TextStyle(
                                        fontSize: 12,
                                        color: Colors.grey.shade600,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      _trackingCode,
                                      style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              IconButton(
                                onPressed: _copyTrackingNumber,
                                icon: const Icon(Icons.copy, color: Color(0xFF667eea)),
                                tooltip: l10n.trackingNumber,
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          _RoundedTextField(
                            controller: _ownerController,
                            label: l10n.ownerName,
                            readOnly: !canEdit,
                            validator: (value) {
                              if (!canEdit) return null;
                              if (value == null || value.trim().isEmpty) {
                                return l10n.pleaseEnterOwnerName;
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 16),
                          _CarDropdownField(
                            label: l10n.carMake,
                            value: _selectedMake,
                            items: _makeOptions,
                            enabled: canEdit,
                            onChanged: (value) {
                              if (!canEdit) return;
                              setState(() {
                                _selectedMake = value;
                                _selectedModel = null;
                                _selectedYear = null;
                                _refreshCatalogOptions();
                              });
                            },
                            validator: (value) {
                              if (!canEdit) return null;
                              if (value == null || value.isEmpty) {
                                return l10n.pleaseEnterCarMake;
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 16),
                          _CarDropdownField(
                            label: l10n.carModel,
                            value: _selectedModel,
                            items: _modelOptions,
                            enabled: canEdit && _selectedMake != null,
                            onChanged: (value) {
                              if (!canEdit) return;
                              setState(() {
                                _selectedModel = value;
                                _selectedYear = null;
                                _refreshCatalogOptions();
                              });
                            },
                            validator: (value) {
                              if (!canEdit) return null;
                              if (value == null || value.isEmpty) {
                                return l10n.pleaseEnterCarModel;
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 16),
                          _CarDropdownField(
                            label: l10n.carYear,
                            value: _selectedYear,
                            items: _yearOptions,
                            enabled: canEdit && _selectedModel != null,
                            onChanged: (value) {
                              if (!canEdit) return;
                              setState(() => _selectedYear = value);
                            },
                            validator: (value) {
                              if (!canEdit) return null;
                              if (value == null || value.isEmpty) {
                                return l10n.pleaseEnterCarYear;
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 16),
                          _RoundedTextField(
                            controller: _vinController,
                            label: l10n.vinNumber,
                            readOnly: !canEdit,
                            validator: (value) {
                              if (!canEdit) return null;
                              if (value == null || value.trim().isEmpty) {
                                return l10n.pleaseEnterVinNumber;
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 16),
                          _DatePickerTile(
                            label: l10n.transportDate,
                            value: DateFormat.yMMMd().format(_transportDate),
                            onTap: canEdit ? _pickTransportDate : null,
                            enabled: canEdit,
                          ),
                          const SizedBox(height: 16),
                          _RoundedTextField(
                            controller: _priceController,
                            label: l10n.price,
                            readOnly: !canEdit,
                            keyboardType:
                                const TextInputType.numberWithOptions(decimal: true),
                            validator: (value) {
                              if (!canEdit) return null;
                              if (value == null || value.trim().isEmpty) {
                                return l10n.pleaseEnterPrice;
                              }
                              if (double.tryParse(value.trim()) == null) {
                                return l10n.pleaseEnterValidNumber;
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 16),
                          DropdownButtonFormField<String>(
                            key: ValueKey<String>(_statusDraft),
                            initialValue: _statusDraft,
                            items: _statusOptions
                                .map(
                                  (status) => DropdownMenuItem<String>(
                                    value: status,
                                    child: Text(_statusLabel(status, l10n)),
                                  ),
                                )
                                .toList(),
                            onChanged: canEdit
                                ? (value) {
                                    if (value != null) {
                                      setState(() => _statusDraft = value);
                                    }
                                  }
                                : null,
                            decoration: InputDecoration(labelText: l10n.statusLabel),
                          ),
                          const SizedBox(height: 24),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton(
                                  onPressed: _reprintReceipt,
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: const Color(0xFF667eea),
                                    minimumSize: const Size.fromHeight(52),
                                  ),
                                  child: Text(l10n.reprintReceipt),
                                ),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: ElevatedButton(
                                  onPressed: canEdit && !_isSaving ? _updateRequest : null,
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: const Color(0xFF28A745),
                                    foregroundColor: Colors.white,
                                    minimumSize: const Size.fromHeight(52),
                                  ),
                                  child: _isSaving
                                      ? const SizedBox(
                                          width: 22,
                                          height: 22,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            valueColor:
                                                AlwaysStoppedAnimation<Color>(Colors.white),
                                          ),
                                        )
                                      : Text(l10n.updateTransport),
                                ),
                              ),
                            ],
                          ),
                          if (_persistedStatus == 'completed')
                            Padding(
                              padding: const EdgeInsets.only(top: 16),
                              child: Text(
                                l10n.transportStatusCompletedNotice,
                                style: TextStyle(
                                  color: Colors.orange.shade700,
                                  fontWeight: FontWeight.w600,
                                ),
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

  String _statusLabel(String status, AppLocalizations l10n) {
    switch (status) {
      case 'pending':
        return l10n.shipmentStatusPending;
      case 'in_transit':
        return l10n.shipmentStatusInTransit;
      case 'completed':
        return l10n.shipmentStatusCompleted;
      default:
        return status;
    }
  }
}

class _RoundedTextField extends StatelessWidget {
  const _RoundedTextField({
    required this.controller,
    required this.label,
    this.readOnly = false,
    this.validator,
    this.keyboardType,
  });

  final TextEditingController controller;
  final String label;
  final bool readOnly;
  final String? Function(String?)? validator;
  final TextInputType? keyboardType;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      readOnly: readOnly,
      validator: validator,
      keyboardType: keyboardType,
      decoration: InputDecoration(labelText: label),
    );
  }
}

class _CarDropdownField extends StatelessWidget {
  const _CarDropdownField({
    required this.label,
    required this.items,
    required this.value,
    required this.enabled,
    this.onChanged,
    this.validator,
  });

  final String label;
  final List<String> items;
  final String? value;
  final bool enabled;
  final ValueChanged<String?>? onChanged;
  final String? Function(String?)? validator;

  @override
  Widget build(BuildContext context) {
    final options = List<String>.from(items);
    if (value != null && value!.isNotEmpty && !options.contains(value)) {
      options.insert(0, value!);
    }

    final currentValue = enabled && value != null && options.contains(value)
        ? value
        : value != null && value!.isNotEmpty
            ? value
            : null;

    return DropdownButtonFormField<String>(
      key: ValueKey<String?>(currentValue),
      initialValue: currentValue,
      items: options
          .map((item) => DropdownMenuItem<String>(
                value: item,
                child: Text(item),
              ))
          .toList(),
      onChanged: enabled ? onChanged : null,
      validator: validator,
      decoration: InputDecoration(labelText: label),
    );
  }
}

class _DatePickerTile extends StatelessWidget {
  const _DatePickerTile({
    required this.label,
    required this.value,
    required this.onTap,
    required this.enabled,
  });

  final String label;
  final String value;
  final VoidCallback? onTap;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(label),
      subtitle: Text(
        value,
        style: const TextStyle(fontWeight: FontWeight.w600),
      ),
      trailing: const Icon(Icons.calendar_today, color: Color(0xFF667eea)),
      onTap: enabled ? onTap : null,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.grey.shade300),
      ),
    );
  }
}
