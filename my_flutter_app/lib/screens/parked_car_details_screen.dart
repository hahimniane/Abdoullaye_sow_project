import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:provider/provider.dart';
import '../models/parked_car.dart';
import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../data/car_catalog.dart';
import '../theme/app_colors.dart';
import '../utils/parking_status_options.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';

class ParkedCarDetailsScreen extends StatefulWidget {
  final ParkedCar parkedCar;

  const ParkedCarDetailsScreen({super.key, required this.parkedCar});

  @override
  State<ParkedCarDetailsScreen> createState() => _ParkedCarDetailsScreenState();
}

class _ParkedCarDetailsScreenState extends State<ParkedCarDetailsScreen> {
  final _formKey = GlobalKey<FormState>();
  late TextEditingController _ownerNameController;
  late TextEditingController _costPerDayController;
  late TextEditingController _vinController;
  late final String _trackingCode;
  DateTime? _parkingEndDate;
  late DateTime _parkingStartDate;
  late String _statusDraft;
  late String _persistedStatus;
  double _totalCost = 0.0;
  int _totalDays = 0;
  String? _selectedMake;
  String? _selectedModel;
  String? _selectedYear;
  List<String> _makeOptions = [];
  List<String> _modelOptions = [];
  List<String> _yearOptions = [];
  bool _isCatalogLoading = true;

  @override
  void initState() {
    super.initState();
    _ownerNameController = TextEditingController(
      text: widget.parkedCar.ownerName,
    );
    _costPerDayController = TextEditingController();
    _vinController = TextEditingController(text: widget.parkedCar.vinNumber);
    _trackingCode = widget.parkedCar.trackingCode;
    _persistedStatus = widget.parkedCar.status;
    _statusDraft = _persistedStatus;
    _parkingStartDate = widget.parkedCar.parkingDate;
    _parkingEndDate = widget.parkedCar.parkingEndDate;
    _totalCost = widget.parkedCar.totalCost ?? 0.0;
    _selectedMake = widget.parkedCar.carMake.isNotEmpty
        ? widget.parkedCar.carMake
        : null;
    _selectedModel = widget.parkedCar.carModel.isNotEmpty
        ? widget.parkedCar.carModel
        : null;
    _selectedYear = widget.parkedCar.carYear.isNotEmpty
        ? widget.parkedCar.carYear
        : null;

    if (_parkingEndDate != null) {
      final startDate = DateTime(
        _parkingStartDate.year,
        _parkingStartDate.month,
        _parkingStartDate.day,
      );
      final endDate = DateTime(
        _parkingEndDate!.year,
        _parkingEndDate!.month,
        _parkingEndDate!.day,
      );
      final duration = endDate.difference(startDate).inDays;
      _totalDays = duration >= 0 ? duration + 1 : 0;
      if (_totalDays > 0 && _totalCost > 0) {
        final inferredCostPerDay = _totalCost / _totalDays;
        _costPerDayController.text = inferredCostPerDay.toStringAsFixed(2);
      }
    }

    _initializeCatalog();
  }

  @override
  void dispose() {
    _ownerNameController.dispose();
    _costPerDayController.dispose();
    _vinController.dispose();
    super.dispose();
  }

  Future<void> _initializeCatalog() async {
    final catalog = CarCatalog.instance;
    await catalog.load();

    List<String> makes = List<String>.from(catalog.getMakes());
    List<String> modelOptions = <String>[];
    List<String> yearOptions = <String>[];

    if (_selectedMake != null) {
      modelOptions = catalog.getModels(_selectedMake!);
      if (_selectedModel != null) {
        if (modelOptions.contains(_selectedModel)) {
          yearOptions = catalog.getYears(_selectedMake!, _selectedModel!);
        } else {
          modelOptions = [_selectedModel!, ...modelOptions];
        }
      }
    }

    if (_selectedYear != null && !yearOptions.contains(_selectedYear)) {
      yearOptions = [_selectedYear!, ...yearOptions];
    }

    if (_selectedMake != null && !makes.contains(_selectedMake)) {
      makes.insert(0, _selectedMake!);
    }

    setState(() {
      _makeOptions = makes;
      _modelOptions = modelOptions;
      _yearOptions = yearOptions;
      _isCatalogLoading = false;
    });
  }

  void _calculateTotalCost() {
    if (_parkingEndDate != null && _costPerDayController.text.isNotEmpty) {
      final costPerDay = double.tryParse(_costPerDayController.text);
      if (costPerDay != null) {
        final startDate = DateTime(
          _parkingStartDate.year,
          _parkingStartDate.month,
          _parkingStartDate.day,
        );
        final endDate = DateTime(
          _parkingEndDate!.year,
          _parkingEndDate!.month,
          _parkingEndDate!.day,
        );
        final duration = endDate.difference(startDate).inDays;
        final totalDays = duration >= 0 ? duration + 1 : 0;
        setState(() {
          _totalDays = totalDays;
          _totalCost = totalDays > 0 ? totalDays * costPerDay : 0;
        });
      } else {
        setState(() {
          _totalDays = 0;
          _totalCost = 0;
        });
      }
    } else {
      setState(() {
        _totalDays = 0;
        _totalCost = 0;
      });
    }
  }

  Future<void> _selectEndDate() async {
    final minDate = DateTime(
      _parkingStartDate.year,
      _parkingStartDate.month,
      _parkingStartDate.day,
    );
    DateTime tempDateTime = _parkingEndDate ?? DateTime.now();

    await showCupertinoModalPopup<void>(
      context: context,
      builder: (BuildContext context) {
        return Container(
          height: 300,
          color: CupertinoColors.systemBackground.resolveFrom(context),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  CupertinoButton(
                    child: Text(AppLocalizations.of(context)!.cancel),
                    onPressed: () => Navigator.pop(context),
                  ),
                  CupertinoButton(
                    child: Text(AppLocalizations.of(context)!.done),
                    onPressed: () {
                      setState(() {
                        _parkingEndDate = tempDateTime;
                      });
                      _calculateTotalCost();
                      Navigator.pop(context);
                    },
                  ),
                ],
              ),
              Expanded(
                child: CupertinoDatePicker(
                  mode: CupertinoDatePickerMode.date,
                  initialDateTime: _parkingEndDate ?? minDate,
                  minimumDate: minDate,
                  onDateTimeChanged: (DateTime newDateTime) {
                    tempDateTime = newDateTime;
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _selectStartDate() async {
    DateTime tempDateTime = _parkingStartDate;

    await showCupertinoModalPopup<void>(
      context: context,
      builder: (BuildContext context) {
        return Container(
          height: 300,
          color: CupertinoColors.systemBackground.resolveFrom(context),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  CupertinoButton(
                    child: Text(AppLocalizations.of(context)!.cancel),
                    onPressed: () => Navigator.pop(context),
                  ),
                  CupertinoButton(
                    child: Text(AppLocalizations.of(context)!.done),
                    onPressed: () {
                      setState(() {
                        _parkingStartDate = tempDateTime;
                        if (_parkingEndDate != null &&
                            _parkingEndDate!.isBefore(_parkingStartDate)) {
                          _parkingEndDate = null;
                        }
                      });
                      _calculateTotalCost();
                      Navigator.pop(context);
                    },
                  ),
                ],
              ),
              Expanded(
                child: CupertinoDatePicker(
                  mode: CupertinoDatePickerMode.date,
                  initialDateTime: _parkingStartDate,
                  maximumDate: DateTime.now().add(const Duration(days: 365)),
                  minimumDate: DateTime.now().subtract(
                    const Duration(days: 365 * 5),
                  ),
                  onDateTimeChanged: (DateTime newDateTime) {
                    tempDateTime = newDateTime;
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<bool> _persistChanges({bool showSuccess = true}) async {
    final l10n = AppLocalizations.of(context)!;
    if (!_formKey.currentState!.validate()) {
      return false;
    }

    if (_selectedMake == null ||
        _selectedModel == null ||
        _selectedYear == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(l10n.carIdentityRequired),
            backgroundColor: Colors.red,
          ),
        );
      }
      return false;
    }

    final normalizedStart = DateTime(
      _parkingStartDate.year,
      _parkingStartDate.month,
      _parkingStartDate.day,
    );

    final updateData = <String, dynamic>{
      'ownerName': _ownerNameController.text.trim(),
      'carMake': _selectedMake ?? '',
      'carModel': _selectedModel ?? '',
      'carYear': _selectedYear ?? '',
      'vinNumber': _vinController.text.trim(),
      'parkingDate': Timestamp.fromDate(normalizedStart),
      'status': _statusDraft,
    };

    if (_parkingEndDate != null) {
      updateData['parkingEndDate'] = Timestamp.fromDate(
        DateTime(
          _parkingEndDate!.year,
          _parkingEndDate!.month,
          _parkingEndDate!.day,
        ),
      );
    } else {
      updateData['parkingEndDate'] = FieldValue.delete();
    }

    if (_totalCost > 0) {
      updateData['totalCost'] = _totalCost;
    } else {
      updateData['totalCost'] = FieldValue.delete();
    }

    try {
      await FirebaseFirestore.instance
          .collection('parkedCars')
          .doc(widget.parkedCar.id)
          .update(updateData);

      if (mounted) {
        setState(() {
          _persistedStatus = _statusDraft;
        });
      }

      if (showSuccess && mounted) {
        showSuccessSnackBar(context, l10n.recordUpdated);
      }
      return true;
    } catch (e) {
      if (mounted) {
        showErrorSnackBar(context, l10n.failedToUpdateRecord(e.toString()));
      }
      return false;
    }
  }

  Future<void> _updateRecord() async {
    final success = await _persistChanges();
    if (success && mounted) {
      Navigator.pop(context);
    }
  }

  Future<void> _generateFinalReceipt() async {
    final l10n = AppLocalizations.of(context)!;
    if (_parkingEndDate == null || _costPerDayController.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.addParkingEndAndDailyCost),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    if (_selectedMake == null ||
        _selectedModel == null ||
        _selectedYear == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.carIdentityReceiptRequired),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    final pdf = pw.Document();

    final startDate = DateTime(
      _parkingStartDate.year,
      _parkingStartDate.month,
      _parkingStartDate.day,
    );
    final endDate = DateTime(
      _parkingEndDate!.year,
      _parkingEndDate!.month,
      _parkingEndDate!.day,
    );

    if (endDate.isBefore(startDate)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(l10n.endDateBeforeStart),
            backgroundColor: Colors.red,
          ),
        );
      }
      return;
    }

    final totalDays = endDate.difference(startDate).inDays + 1;

    pdf.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a4,
        build: (context) {
          return pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              pw.Container(
                width: double.infinity,
                padding: const pw.EdgeInsets.all(20),
                decoration: pw.BoxDecoration(
                  color: PdfColors.blue,
                  borderRadius: const pw.BorderRadius.all(
                    pw.Radius.circular(10),
                  ),
                ),
                child: pw.Column(
                  children: [
                    pw.Text(
                      l10n.carParkingReceipt,
                      style: pw.TextStyle(
                        fontSize: 24,
                        fontWeight: pw.FontWeight.bold,
                        color: PdfColors.white,
                      ),
                    ),
                    pw.SizedBox(height: 10),
                    pw.Text(
                      l10n.businessServices,
                      style: pw.TextStyle(fontSize: 16, color: PdfColors.white),
                    ),
                  ],
                ),
              ),
              pw.SizedBox(height: 20),
              pw.Container(
                padding: const pw.EdgeInsets.all(20),
                decoration: pw.BoxDecoration(
                  border: pw.Border.all(color: PdfColors.grey),
                  borderRadius: const pw.BorderRadius.all(
                    pw.Radius.circular(10),
                  ),
                ),
                child: pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.start,
                  children: [
                    pw.Text(
                      l10n.receiptDetails,
                      style: pw.TextStyle(
                        fontSize: 18,
                        fontWeight: pw.FontWeight.bold,
                      ),
                    ),
                    pw.SizedBox(height: 15),
                    _buildPdfRow(l10n.receiptNumber, widget.parkedCar.id),
                    _buildPdfRow(l10n.trackingNumberPdf, _trackingCode),
                    _buildPdfRow(
                      l10n.generatedOn,
                      DateFormat('MMM dd, yyyy - HH:mm').format(DateTime.now()),
                    ),
                    pw.SizedBox(height: 20),
                    pw.Text(
                      l10n.carInformation,
                      style: pw.TextStyle(
                        fontSize: 18,
                        fontWeight: pw.FontWeight.bold,
                      ),
                    ),
                    pw.SizedBox(height: 15),
                    _buildPdfRow(l10n.ownerNamePdf, _ownerNameController.text),
                    _buildPdfRow(l10n.carMakePdf, _selectedMake ?? ''),
                    _buildPdfRow(l10n.carModelPdf, _selectedModel ?? ''),
                    _buildPdfRow(l10n.yearPdf, _selectedYear ?? ''),
                    _buildPdfRow(l10n.vinNumberPdf, _vinController.text),
                    _buildPdfRow(
                      l10n.parkingStartPdf,
                      DateFormat('MMM dd, yyyy').format(_parkingStartDate),
                    ),
                    _buildPdfRow(
                      l10n.parkingEndPdf,
                      DateFormat('MMM dd, yyyy').format(_parkingEndDate!),
                    ),
                    _buildPdfRow(l10n.totalDaysPdf, totalDays.toString()),
                    pw.SizedBox(height: 20),
                    pw.Text(
                      l10n.billingSummary,
                      style: pw.TextStyle(
                        fontSize: 18,
                        fontWeight: pw.FontWeight.bold,
                      ),
                    ),
                    pw.SizedBox(height: 12),
                    _buildPdfRow(
                      l10n.costPerDayPdf,
                      '\$${_costPerDayController.text}',
                    ),
                    _buildPdfRow(
                      l10n.totalCostPdf,
                      '\$${_totalCost.toStringAsFixed(2)}',
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );

    try {
      await Printing.layoutPdf(onLayout: (format) async => pdf.save());

      final previousStatus = _statusDraft;
      if (_statusDraft != 'completed') {
        setState(() {
          _statusDraft = 'completed';
        });
      }

      final saved = await _persistChanges(showSuccess: false);
      if (!saved) {
        if (mounted) {
          setState(() {
            _statusDraft = previousStatus;
          });
        }
        return;
      }

      if (mounted) {
        showSuccessSnackBar(context, l10n.finalReceiptGeneratedCompleted);
      }
    } catch (e) {
      if (mounted) {
        showErrorSnackBar(context, l10n.failedToGenerateReceipt(e.toString()));
      }
    }
  }

  Future<void> _copyTrackingNumber() async {
    await Clipboard.setData(ClipboardData(text: _trackingCode));
    if (!mounted) return;
    final l10n = AppLocalizations.of(context)!;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(l10n.trackingNumberCopied),
        duration: const Duration(seconds: 2),
      ),
    );
  }

  pw.Widget _buildPdfRow(String label, String value) {
    return pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 4),
      child: pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.SizedBox(
            width: 140,
            child: pw.Text(
              label,
              style: pw.TextStyle(fontWeight: pw.FontWeight.bold, fontSize: 12),
            ),
          ),
          pw.Expanded(
            child: pw.Text(value, style: const pw.TextStyle(fontSize: 12)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final authProvider = context.watch<AuthProvider>();
    final bool isAdmin = authProvider.isAdmin;
    final bool canEdit = isAdmin && _persistedStatus != 'completed';

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppColors.headerGradient),
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
                child: Row(
                  children: [
                    const AppBackButton(onDarkBackground: true),
                    Expanded(
                      child: Text(
                        l10n.carDetails,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const SizedBox(width: 48),
                  ],
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: EdgeInsets.all(
                    MediaQuery.of(context).size.width * 0.06,
                  ),
                  child: Container(
                    padding: EdgeInsets.all(
                      MediaQuery.of(context).size.width * 0.05,
                    ),
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
                                icon: const Icon(
                                  Icons.copy,
                                  color: AppColors.brandRed,
                                ),
                                tooltip: l10n.trackingNumber,
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          _buildInfoCard(canEdit),
                          const SizedBox(height: 24),
                          _buildBillingCard(l10n, canEdit),
                          const SizedBox(height: 24),
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton(
                                  style: OutlinedButton.styleFrom(
                                    minimumSize: const Size.fromHeight(52),
                                    foregroundColor: AppColors.brandRed,
                                    side: const BorderSide(
                                      color: AppColors.brandRed,
                                    ),
                                  ),
                                  onPressed: canEdit ? _updateRecord : null,
                                  child: Text(l10n.updateRecord),
                                ),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: ElevatedButton(
                                  style: ElevatedButton.styleFrom(
                                    minimumSize: const Size.fromHeight(52),
                                    backgroundColor: const Color(0xFF28A745),
                                    foregroundColor: Colors.white,
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                  ),
                                  onPressed: _generateFinalReceipt,
                                  child: Text(l10n.generateFinalReceipt),
                                ),
                              ),
                            ],
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

  Widget _buildInfoCard(bool canEdit) {
    final l10n = AppLocalizations.of(context)!;
    final dropdownEnabled = canEdit && !_isCatalogLoading;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.85),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_isCatalogLoading) const LinearProgressIndicator(minHeight: 2),
          if (_isCatalogLoading) const SizedBox(height: 16),
          TextFormField(
            controller: _ownerNameController,
            readOnly: !canEdit,
            decoration: InputDecoration(labelText: l10n.ownerName),
            validator: (value) {
              if (!canEdit) return null;
              return value == null || value.isEmpty
                  ? l10n.ownerNameRequired
                  : null;
            },
          ),
          const SizedBox(height: 16),
          _buildDropdownField(
            label: l10n.carMake,
            value: _selectedMake,
            items: _makeOptions,
            enabled: dropdownEnabled,
            validator: (val) => !canEdit || (val != null && val.isNotEmpty)
                ? null
                : l10n.pleaseSelectCarMake,
            onChanged: (value) {
              if (!dropdownEnabled) return;
              setState(() {
                _selectedMake = value;
                _selectedModel = null;
                _selectedYear = null;
                if (value != null) {
                  _modelOptions = CarCatalog.instance.getModels(value);
                } else {
                  _modelOptions = <String>[];
                }
                _yearOptions = <String>[];
              });
            },
          ),
          const SizedBox(height: 16),
          _buildDropdownField(
            label: l10n.carModel,
            value: _selectedModel,
            items: _modelOptions,
            enabled: dropdownEnabled && _selectedMake != null,
            validator: (val) => !canEdit || (val != null && val.isNotEmpty)
                ? null
                : l10n.pleaseSelectCarModel,
            onChanged: (value) {
              if (!dropdownEnabled) return;
              setState(() {
                _selectedModel = value;
                _selectedYear = null;
                if (_selectedMake != null && value != null) {
                  _yearOptions = CarCatalog.instance.getYears(
                    _selectedMake!,
                    value,
                  );
                } else {
                  _yearOptions = <String>[];
                }
              });
            },
          ),
          const SizedBox(height: 16),
          _buildDropdownField(
            label: l10n.year,
            value: _selectedYear,
            items: _yearOptions,
            enabled: dropdownEnabled && _selectedModel != null,
            validator: (val) => !canEdit || (val != null && val.isNotEmpty)
                ? null
                : l10n.pleaseSelectYear,
            onChanged: (value) {
              if (!dropdownEnabled) return;
              setState(() {
                _selectedYear = value;
              });
            },
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _vinController,
            readOnly: !canEdit,
            decoration: InputDecoration(labelText: l10n.vinNumber),
            validator: (value) {
              if (!canEdit) return null;
              return value == null || value.isEmpty
                  ? 'Please enter VIN number'
                  : null;
            },
          ),
          const SizedBox(height: 16),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(l10n.parkingStartDate),
            subtitle: Text(
              DateFormat.yMMMd().format(_parkingStartDate),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            trailing: Icon(
              Icons.calendar_today,
              color: canEdit ? AppColors.brandRed : Colors.grey,
            ),
            onTap: canEdit ? _selectStartDate : null,
          ),
        ],
      ),
    );
  }

  Widget _buildBillingCard(AppLocalizations l10n, bool canEdit) {
    final statusOptions = parkedCarStatusOptions(_statusDraft);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.85),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(l10n.parkingEndDate),
            subtitle: Text(
              _parkingEndDate == null
                  ? 'Select a date'
                  : DateFormat.yMMMd().format(_parkingEndDate!),
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            trailing: Icon(
              Icons.calendar_today,
              color: canEdit ? AppColors.brandRed : Colors.grey,
            ),
            onTap: canEdit ? _selectEndDate : null,
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _costPerDayController,
            readOnly: !canEdit,
            decoration: InputDecoration(labelText: l10n.costPerDayCurrency),
            keyboardType: TextInputType.number,
            onChanged: (_) => _calculateTotalCost(),
            validator: (value) {
              if (!canEdit) return null;
              return value == null || value.isEmpty
                  ? 'Please enter cost per day'
                  : null;
            },
          ),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            key: ValueKey<String>(_statusDraft),
            initialValue: _statusDraft,
            decoration: InputDecoration(labelText: l10n.status),
            items: statusOptions
                .map(
                  (status) => DropdownMenuItem(
                    value: status,
                    child: Text(_parkingStatusLabel(l10n, status)),
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
          const SizedBox(height: 24),
          Text(
            l10n.totalDaysLabel(_totalDays > 0 ? _totalDays : '-'),
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            l10n.totalCostLabel('\$${_totalCost.toStringAsFixed(2)}'),
            style: Theme.of(context).textTheme.headlineSmall,
          ),
        ],
      ),
    );
  }

  String _parkingStatusLabel(AppLocalizations l10n, String status) {
    switch (status) {
      case 'active':
        return l10n.active;
      case 'reserved':
        return l10n.reserved;
      case 'completed':
        return l10n.completed;
      case 'cancelled':
        return l10n.cancelled;
      case 'pending':
        return l10n.pending;
      default:
        return status;
    }
  }

  Widget _buildDropdownField({
    required String label,
    required String? value,
    required List<String> items,
    required bool enabled,
    String? Function(String?)? validator,
    ValueChanged<String?>? onChanged,
  }) {
    final effectiveItems = List<String>.from(items);
    if (value != null && !effectiveItems.contains(value)) {
      effectiveItems.insert(0, value);
    }
    final selectedValue = value != null && effectiveItems.contains(value)
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
      onChanged: enabled
          ? (newValue) {
              if (onChanged != null) {
                onChanged(newValue);
              }
            }
          : null,
      validator: validator,
      decoration: InputDecoration(labelText: label),
      isExpanded: true,
    );
  }
}
