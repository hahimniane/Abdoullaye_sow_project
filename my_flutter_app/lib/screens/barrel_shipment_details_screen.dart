import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/barrel_shipment.dart';
import '../providers/auth_provider.dart';
import '../utils/barrel_receipt_generator.dart';
import '../widgets/language_toggle.dart';
import '../theme/app_colors.dart';

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

  late BarrelShipment _currentShipment;
  late String _statusDraft;
  bool _isSaving = false;

  StreamSubscription<DocumentSnapshot>? _subscription;

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
    _subscription = FirebaseFirestore.instance
        .collection('barrelShipments')
        .doc(widget.shipment.id)
        .snapshots()
        .listen(_handleSnapshot);
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _senderNameController.dispose();
    _senderAddressController.dispose();
    _receiverNameController.dispose();
    _receiverPhoneController.dispose();
    _priceController.dispose();
    super.dispose();
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
      _isSaving = false;
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
      _senderNameController.text = shipment.senderName;
      _senderAddressController.text = shipment.senderAddress;
      _receiverNameController.text = shipment.receiverName;
      _receiverPhoneController.text = shipment.receiverPhone;
      _priceController.text = _formatPrice(shipment.price);
    }
  }

  bool get _hasUnsavedChanges {
    final shipment = _currentShipment;
    return _senderNameController.text.trim() != shipment.senderName ||
        _senderAddressController.text.trim() != shipment.senderAddress ||
        _receiverNameController.text.trim() != shipment.receiverName ||
        _receiverPhoneController.text.trim() != shipment.receiverPhone ||
        _parsePrice(_priceController.text.trim()) != shipment.price ||
        _statusDraft != shipment.status;
  }

  bool get _isCompleted => _currentShipment.status == 'completed';

  String _formatPrice(double value) {
    if (value % 1 == 0) {
      return value.toStringAsFixed(0);
    }
    return value.toStringAsFixed(2);
  }

  double? _parsePrice(String value) {
    return double.tryParse(value);
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
    if (!_formKey.currentState!.validate()) {
      return;
    }

    final l10n = AppLocalizations.of(context)!;
    final price = _parsePrice(_priceController.text.trim());
    if (price == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.pleaseEnterValidNumber),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    setState(() {
      _isSaving = true;
    });

    final updatedShipment = _currentShipment.copyWith(
      senderName: _senderNameController.text.trim(),
      senderAddress: _senderAddressController.text.trim(),
      receiverName: _receiverNameController.text.trim(),
      receiverPhone: _receiverPhoneController.text.trim(),
      price: price,
      status: _statusDraft,
    );

    try {
      await FirebaseFirestore.instance
          .collection('barrelShipments')
          .doc(updatedShipment.id)
          .update(updatedShipment.toFirestore());

      if (!mounted) return;
      setState(() {
        _applyShipment(updatedShipment, updateFields: true);
        _isSaving = false;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.shipmentUpdatedSuccessfully),
          backgroundColor: Colors.green,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isSaving = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.failedToUpdateShipment(e)),
          backgroundColor: Colors.red,
        ),
      );
    }
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

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = Provider.of<AuthProvider>(context);
    final canEdit = auth.isAdmin && !_isCompleted;
    final width = MediaQuery.of(context).size.width;
    final dateLabel = DateFormat(
      'MMM dd, yyyy - HH:mm',
    ).format(_currentShipment.createdAt);

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppColors.headerGradient),
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(
                        Icons.arrow_back_ios,
                        color: Colors.white,
                      ),
                    ),
                    Expanded(
                      child: Text(
                        l10n.barrelShipmentDetails,
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
              Expanded(
                child: SingleChildScrollView(
                  padding: EdgeInsets.all(width * 0.06),
                  child: Container(
                    padding: EdgeInsets.all(width * 0.05),
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
                                child: _InfoRow(
                                  label: l10n.trackingNumber,
                                  value: _currentShipment.trackingCode,
                                ),
                              ),
                              IconButton(
                                onPressed: _copyTrackingNumber,
                                icon: const Icon(Icons.copy),
                                color: AppColors.brandRed,
                                tooltip: l10n.trackingNumber,
                              ),
                            ],
                          ),
                          const SizedBox(height: 24),
                          _SectionTitle(label: l10n.senderInformation),
                          _DetailTextField(
                            controller: _senderNameController,
                            label: l10n.senderName,
                            readOnly: !canEdit,
                            validator: (value) {
                              if (!canEdit) return null;
                              if (value == null || value.isEmpty) {
                                return l10n.pleaseEnterSenderName;
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 16),
                          _DetailTextField(
                            controller: _senderAddressController,
                            label: _currentShipment.pickupRequested
                                ? 'Pickup address'
                                : 'Drop-off office',
                            readOnly: !canEdit,
                            validator: (value) {
                              if (!canEdit) return null;
                              if (value == null || value.isEmpty) {
                                return l10n.pleaseEnterSenderAddress;
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 12),
                          _InfoRow(
                            label: 'Pickup service',
                            value: _currentShipment.pickupRequested
                                ? '${_currentShipment.pickupBorough} pickup'
                                : 'Customer brings barrel to office',
                          ),
                          if (_currentShipment.pickupDateTime != null) ...[
                            const SizedBox(height: 12),
                            _InfoRow(
                              label: 'Pickup time',
                              value: DateFormat(
                                'MMM dd, yyyy - h:mm a',
                              ).format(_currentShipment.pickupDateTime!),
                            ),
                          ],
                          const SizedBox(height: 24),
                          _SectionTitle(label: l10n.receiverInformation),
                          _DetailTextField(
                            controller: _receiverNameController,
                            label: l10n.receiverName,
                            readOnly: !canEdit,
                            validator: (value) {
                              if (!canEdit) return null;
                              if (value == null || value.isEmpty) {
                                return l10n.pleaseEnterReceiverName;
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 16),
                          _DetailTextField(
                            controller: _receiverPhoneController,
                            label: l10n.receiverPhone,
                            keyboardType: TextInputType.phone,
                            readOnly: !canEdit,
                            validator: (value) {
                              if (!canEdit) return null;
                              if (value == null || value.isEmpty) {
                                return l10n.pleaseEnterReceiverPhone;
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 24),
                          _SectionTitle(label: l10n.shipmentSummary),
                          _InfoRow(
                            label: l10n.createdOnLabel,
                            value: dateLabel,
                          ),
                          const SizedBox(height: 12),
                          _InfoRow(
                            label: 'Destination',
                            value: _currentShipment.destinationCountryName,
                          ),
                          const SizedBox(height: 12),
                          _InfoRow(
                            label: 'Shipping fee',
                            value: NumberFormat.simpleCurrency().format(
                              _currentShipment.shippingFee,
                            ),
                          ),
                          const SizedBox(height: 12),
                          _InfoRow(
                            label: 'Pickup fee',
                            value:
                                '${NumberFormat.simpleCurrency().format(_currentShipment.pickupFee)}'
                                ' (${_currentShipment.pickupMiles.toStringAsFixed(0)} miles)',
                          ),
                          const SizedBox(height: 12),
                          _InfoRow(
                            label: 'Payment',
                            value: _currentShipment.paymentStatus,
                          ),
                          if (_currentShipment.pricingPendingReview) ...[
                            const SizedBox(height: 12),
                            Text(
                              'Pricing needs staff review.',
                              style: TextStyle(
                                color: Colors.orange.shade800,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: _priceController,
                            readOnly: !canEdit,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            decoration: InputDecoration(
                              labelText: l10n.price,
                              prefixText: '\$',
                            ),
                            validator: (value) {
                              if (!canEdit) return null;
                              if (value == null || value.isEmpty) {
                                return l10n.pleaseEnterPrice;
                              }
                              if (_parsePrice(value.trim()) == null) {
                                return l10n.pleaseEnterValidNumber;
                              }
                              return null;
                            },
                          ),
                          const SizedBox(height: 16),
                          DropdownButtonFormField<String>(
                            key: ValueKey<String>(_statusDraft),
                            initialValue: _statusDraft,
                            decoration: InputDecoration(
                              labelText: l10n.statusLabel,
                            ),
                            items: _statusOptions
                                .map(
                                  (value) => DropdownMenuItem<String>(
                                    value: value,
                                    child: Text(_statusLabel(value, l10n)),
                                  ),
                                )
                                .toList(),
                            onChanged: canEdit
                                ? (value) {
                                    if (value != null) {
                                      setState(() {
                                        _statusDraft = value;
                                      });
                                    }
                                  }
                                : null,
                          ),
                          const SizedBox(height: 32),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton(
                                  onPressed: _reprintReceipt,
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: AppColors.brandRed,
                                    minimumSize: const Size.fromHeight(52),
                                  ),
                                  child: Text(l10n.reprintReceipt),
                                ),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: ElevatedButton(
                                  onPressed: canEdit && !_isSaving
                                      ? _updateShipment
                                      : null,
                                  style: ElevatedButton.styleFrom(
                                    minimumSize: const Size.fromHeight(52),
                                    backgroundColor: const Color(0xFF28A745),
                                    foregroundColor: Colors.white,
                                  ),
                                  child: _isSaving
                                      ? const SizedBox(
                                          width: 24,
                                          height: 24,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            valueColor:
                                                AlwaysStoppedAnimation<Color>(
                                                  Colors.white,
                                                ),
                                          ),
                                        )
                                      : Text(l10n.updateShipment),
                                ),
                              ),
                            ],
                          ),
                          if (_isCompleted)
                            Padding(
                              padding: const EdgeInsets.only(top: 16),
                              child: Text(
                                l10n.shipmentStatusCompletedNotice,
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
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label,
      style: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        color: AppColors.brandRed,
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ],
    );
  }
}

class _DetailTextField extends StatelessWidget {
  const _DetailTextField({
    required this.controller,
    required this.label,
    this.validator,
    this.readOnly = false,
    this.keyboardType,
  });

  final TextEditingController controller;
  final String label;
  final String? Function(String?)? validator;
  final bool readOnly;
  final TextInputType? keyboardType;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      validator: validator,
      readOnly: readOnly,
      keyboardType: keyboardType,
      decoration: InputDecoration(labelText: label),
    );
  }
}
