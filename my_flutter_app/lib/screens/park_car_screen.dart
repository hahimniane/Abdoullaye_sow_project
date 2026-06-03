import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';
import 'dart:io';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:intl/intl.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:provider/provider.dart';
import '../models/business_profile.dart';
import '../models/parked_car.dart';
import '../providers/auth_provider.dart';
import '../screens/vin_scanner_screen.dart';
import '../services/vin_catalog_matcher.dart';
import '../services/vin_decoder_service.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';
import '../data/car_catalog.dart';
import '../utils/tracking_code_generator.dart';
import '../utils/vin_utils.dart';
import '../theme/app_colors.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';

class ParkCarScreen extends StatefulWidget {
  const ParkCarScreen({super.key});

  @override
  State<ParkCarScreen> createState() => _ParkCarScreenState();
}

class _ParkCarScreenState extends State<ParkCarScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _vinController = TextEditingController();

  String? _selectedMake;
  String? _selectedModel;
  String? _selectedYear;

  DateTime _selectedDateTime = DateTime.now();
  bool _isLoading = false;
  bool _isCatalogLoading = true;
  bool _isVinDecoding = false;
  List<String> _makeOptions = [];
  List<String> _modelOptions = [];
  List<String> _yearOptions = [];
  final VinDecoderService _vinDecoderService = NhtsaVinDecoderService();
  DecodedVehicleInfo? _decodedVehicleInfo;

  @override
  void initState() {
    super.initState();
    _loadCatalog();
  }

  Future<void> _loadCatalog() async {
    final catalog = CarCatalog.instance;
    await catalog.load();
    final makes = catalog.getMakes();
    setState(() {
      _makeOptions = makes;
      if (_selectedMake != null) {
        _modelOptions = catalog.getModels(_selectedMake!);
        if (_selectedModel != null) {
          _yearOptions = catalog.getYears(_selectedMake!, _selectedModel!);
        }
      }
      _isCatalogLoading = false;
    });
  }

  @override
  void dispose() {
    _nameController.dispose();
    _vinController.dispose();
    super.dispose();
  }

  Future<void> _selectDateTime() async {
    if (Platform.isIOS) {
      // Use iOS-style date picker
      await _showIOSDatePicker();
    } else {
      // Use Android-style date picker
      await _showAndroidDatePicker();
    }
  }

  Future<void> _showIOSDatePicker() async {
    DateTime tempDateTime = _selectedDateTime;

    await showCupertinoModalPopup<void>(
      context: context,
      builder: (BuildContext context) {
        return Container(
          height: 300,
          padding: const EdgeInsets.only(top: 6.0),
          margin: EdgeInsets.only(
            bottom: MediaQuery.of(context).viewInsets.bottom,
          ),
          color: CupertinoColors.systemBackground.resolveFrom(context),
          child: SafeArea(
            top: false,
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
                          _selectedDateTime = tempDateTime;
                        });
                        Navigator.pop(context);
                      },
                    ),
                  ],
                ),
                Expanded(
                  child: CupertinoDatePicker(
                    mode: CupertinoDatePickerMode.dateAndTime,
                    initialDateTime: _selectedDateTime,
                    onDateTimeChanged: (DateTime newDateTime) {
                      tempDateTime = newDateTime;
                    },
                    use24hFormat: false,
                    minuteInterval: 1,
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _showAndroidDatePicker() async {
    final DateTime? pickedDate = await showDatePicker(
      context: context,
      initialDate: _selectedDateTime,
      firstDate: DateTime(2020),
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

    if (pickedDate != null && mounted) {
      final TimeOfDay? pickedTime = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(_selectedDateTime),
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

      if (pickedTime != null && mounted) {
        setState(() {
          _selectedDateTime = DateTime(
            pickedDate.year,
            pickedDate.month,
            pickedDate.day,
            pickedTime.hour,
            pickedTime.minute,
          );
        });
      }
    }
  }

  Future<void> _scanVin() async {
    final vin = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (context) => const VinScannerScreen()),
    );
    if (vin == null || !mounted) return;
    _vinController.text = vin;
    await _decodeCurrentVin();
  }

  Future<void> _decodeCurrentVin() async {
    final l10n = AppLocalizations.of(context)!;
    final vin = normalizeVin(_vinController.text);
    if (!isValidVin(vin)) {
      showErrorSnackBar(context, l10n.invalidVinNumber);
      return;
    }

    setState(() {
      _isVinDecoding = true;
    });
    try {
      final decoded = await _vinDecoderService.decode(vin);
      if (!mounted) return;
      _applyDecodedVehicleInfo(decoded);
      final message = decoded.summary.isEmpty
          ? l10n.vinDecoded
          : l10n.vinDecodedVehicle(decoded.summary);
      showSuccessSnackBar(context, message);
    } catch (_) {
      if (mounted) {
        showErrorSnackBar(context, l10n.vinDecodeFailed);
      }
    } finally {
      if (mounted) {
        setState(() {
          _isVinDecoding = false;
        });
      }
    }
  }

  void _applyDecodedVehicleInfo(DecodedVehicleInfo decoded) {
    final match = matchDecodedVehicleToCatalog(
      decoded: decoded,
      makeOptions: _makeOptions,
      modelsForMake: CarCatalog.instance.getModels,
      yearsForModel: CarCatalog.instance.getYears,
    );

    setState(() {
      _decodedVehicleInfo = decoded;
      if (match.make != null) {
        _selectedMake = match.make;
        _modelOptions = match.modelOptions;
        _selectedModel = match.model;
        _yearOptions = match.yearOptions;
        _selectedYear = match.year;
      }
    });

    if (!match.isComplete) {
      showErrorSnackBar(context, AppLocalizations.of(context)!.vinMatchReview);
    }
  }

  Future<void> _saveAndPrintReceipt() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      _isLoading = true;
    });

    try {
      final auth = context.read<AuthProvider>();
      final trackingCode = await TrackingCodeGenerator.generateUniqueCode(
        prefix: 'PC',
        collectionPath: 'parkedCars',
      );

      final newRecord = ParkedCar(
        id: '',
        trackingCode: trackingCode,
        ownerName: _nameController.text,
        carMake: _selectedMake!,
        carModel: _selectedModel!,
        carYear: _selectedYear!,
        vinNumber: normalizeVin(_vinController.text),
        parkingDate: _selectedDateTime,
      );

      final docRef = await FirebaseFirestore.instance
          .collection('parkedCars')
          .add({
            ...newRecord.toFirestore(),
            'businessId': auth.isAdmin
                ? BusinessProfile.defaultBusinessId
                : auth.businessId ?? BusinessProfile.defaultBusinessId,
            'businessName': auth.isAdmin
                ? BusinessProfile.defaultBusinessName
                : auth.businessName ?? BusinessProfile.defaultBusinessName,
          });

      final savedRecord = newRecord.copyWith(id: docRef.id);

      await _generateAndPrintReceipt(savedRecord);

      if (mounted) {
        showSuccessSnackBar(
          context,
          AppLocalizations.of(
            context,
          )!.parkingSavedWithTracking(savedRecord.trackingCode),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        showErrorSnackBar(
          context,
          AppLocalizations.of(context)!.errorGeneratingReceipt(e.toString()),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _generateAndPrintReceipt(ParkedCar record) async {
    final pdf = pw.Document();

    pdf.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a4,
        build: (pw.Context context) {
          return pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              // Header
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
                      'CAR PARKING RECEIPT',
                      style: pw.TextStyle(
                        fontSize: 24,
                        fontWeight: pw.FontWeight.bold,
                        color: PdfColors.white,
                      ),
                      textAlign: pw.TextAlign.center,
                    ),
                    pw.SizedBox(height: 10),
                    pw.Text(
                      'Business Services',
                      style: pw.TextStyle(fontSize: 16, color: PdfColors.white),
                      textAlign: pw.TextAlign.center,
                    ),
                  ],
                ),
              ),

              pw.SizedBox(height: 20),

              // Receipt Details
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
                      'Receipt Details',
                      style: pw.TextStyle(
                        fontSize: 18,
                        fontWeight: pw.FontWeight.bold,
                      ),
                    ),
                    pw.SizedBox(height: 15),

                    _buildReceiptRow(
                      'Receipt Number:',
                      record.id.isEmpty ? record.trackingCode : record.id,
                    ),
                    _buildReceiptRow('Tracking Number:', record.trackingCode),
                    _buildReceiptRow(
                      'Date & Time:',
                      DateFormat(
                        'MMM dd, yyyy - HH:mm',
                      ).format(record.parkingDate),
                    ),
                    _buildReceiptRow(
                      'Generated On:',
                      DateFormat('MMM dd, yyyy - HH:mm').format(DateTime.now()),
                    ),

                    pw.SizedBox(height: 20),

                    pw.Text(
                      'Car Information',
                      style: pw.TextStyle(
                        fontSize: 18,
                        fontWeight: pw.FontWeight.bold,
                      ),
                    ),
                    pw.SizedBox(height: 15),

                    _buildReceiptRow('Owner Name:', _nameController.text),
                    _buildReceiptRow('Car Make:', _selectedMake ?? ''),
                    _buildReceiptRow('Car Model:', _selectedModel ?? ''),
                    _buildReceiptRow('Year:', _selectedYear ?? ''),
                    _buildReceiptRow('VIN Number:', _vinController.text),

                    pw.SizedBox(height: 20),

                    pw.Container(
                      width: double.infinity,
                      padding: const pw.EdgeInsets.all(15),
                      decoration: pw.BoxDecoration(
                        color: PdfColors.grey100,
                        borderRadius: const pw.BorderRadius.all(
                          pw.Radius.circular(8),
                        ),
                      ),
                      child: pw.Column(
                        children: [
                          pw.Text(
                            'Parking Status: ACTIVE',
                            style: pw.TextStyle(
                              fontSize: 16,
                              fontWeight: pw.FontWeight.bold,
                              color: PdfColors.green,
                            ),
                          ),
                          pw.SizedBox(height: 5),
                          pw.Text(
                            'Vehicle has been successfully parked',
                            style: pw.TextStyle(
                              fontSize: 12,
                              color: PdfColors.grey700,
                            ),
                          ),
                        ],
                      ),
                    ),

                    pw.SizedBox(height: 30),

                    // Footer
                    pw.Container(
                      width: double.infinity,
                      padding: const pw.EdgeInsets.all(15),
                      decoration: pw.BoxDecoration(
                        color: PdfColors.grey200,
                        borderRadius: const pw.BorderRadius.all(
                          pw.Radius.circular(8),
                        ),
                      ),
                      child: pw.Column(
                        children: [
                          pw.Text(
                            'Terms & Conditions',
                            style: pw.TextStyle(
                              fontSize: 14,
                              fontWeight: pw.FontWeight.bold,
                            ),
                          ),
                          pw.SizedBox(height: 10),
                          pw.Text(
                            '• This receipt serves as proof of parking\n'
                            '• Vehicle will be stored securely\n'
                            '• Contact us for any inquiries\n'
                            '• Valid until vehicle is retrieved',
                            style: pw.TextStyle(
                              fontSize: 10,
                              color: PdfColors.grey700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );

    // Print the PDF
    await Printing.layoutPdf(
      onLayout: (PdfPageFormat format) async => pdf.save(),
      name: 'Car_Parking_Receipt_${DateTime.now().millisecondsSinceEpoch}',
    );
  }

  pw.Widget _buildReceiptRow(String label, String value) {
    return pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 5),
      child: pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.SizedBox(
            width: 120,
            child: pw.Text(
              label,
              style: pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold),
            ),
          ),
          pw.Expanded(child: pw.Text(value, style: pw.TextStyle(fontSize: 12))),
        ],
      ),
    );
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
                    const AppBackButton(onDarkBackground: true),
                    Expanded(
                      child: Text(
                        AppLocalizations.of(context)!.parkACar,
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
                                Icons.local_parking,
                                size: 40,
                                color: Colors.white,
                              ),
                            ),
                            const SizedBox(height: 16),
                            Text(
                              AppLocalizations.of(context)!.carParkingService,
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
                              )!.enterCarDetailsToGenerateReceipt,
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
                                controller: _nameController,
                                label: AppLocalizations.of(context)!.name,
                                validator: (value) {
                                  if (value == null || value.isEmpty) {
                                    return AppLocalizations.of(
                                      context,
                                    )!.pleaseEnterOwnerName;
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
                                  label: AppLocalizations.of(context)!.make,
                                  value: _selectedMake,
                                  items: _makeOptions,
                                  onChanged: (value) {
                                    setState(() {
                                      _selectedMake = value;
                                      _selectedModel = null;
                                      _selectedYear = null;
                                      _modelOptions = [];
                                      _yearOptions = [];
                                    });
                                    if (value != null) {
                                      final models = CarCatalog.instance
                                          .getModels(value);
                                      setState(() {
                                        _modelOptions = models;
                                      });
                                    }
                                  },
                                  validator: (value) {
                                    if (value == null || value.isEmpty) {
                                      return AppLocalizations.of(
                                        context,
                                      )!.pleaseEnterCarMake;
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: 16),
                                _RoundedDropdownField(
                                  label: AppLocalizations.of(context)!.model,
                                  value: _selectedModel,
                                  items: _modelOptions,
                                  onChanged: (value) {
                                    setState(() {
                                      _selectedModel = value;
                                      _selectedYear = null;
                                      _yearOptions = [];
                                    });
                                    if (_selectedMake != null &&
                                        value != null) {
                                      final years = CarCatalog.instance
                                          .getYears(_selectedMake!, value);
                                      setState(() {
                                        _yearOptions = years;
                                      });
                                    }
                                  },
                                  enabled: _selectedMake != null,
                                  validator: (value) {
                                    if (value == null || value.isEmpty) {
                                      return AppLocalizations.of(
                                        context,
                                      )!.pleaseEnterCarModel;
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: 16),
                                _RoundedDropdownField(
                                  label: AppLocalizations.of(context)!.year,
                                  value: _selectedYear,
                                  items: _yearOptions,
                                  onChanged: (value) {
                                    setState(() {
                                      _selectedYear = value;
                                    });
                                  },
                                  enabled: _selectedModel != null,
                                  validator: (value) {
                                    if (value == null || value.isEmpty) {
                                      return AppLocalizations.of(
                                        context,
                                      )!.pleaseEnterCarYear;
                                    }
                                    return null;
                                  },
                                ),
                              ],
                              const SizedBox(height: 16),
                              _RoundedTextField(
                                controller: _vinController,
                                label: AppLocalizations.of(context)!.vinNumber,
                                textCapitalization:
                                    TextCapitalization.characters,
                                suffixIcon: IconButton(
                                  tooltip: AppLocalizations.of(
                                    context,
                                  )!.scanVin,
                                  onPressed: _isVinDecoding ? null : _scanVin,
                                  icon: const Icon(Icons.qr_code_scanner),
                                ),
                                validator: (value) {
                                  if (value == null || value.trim().isEmpty) {
                                    return AppLocalizations.of(
                                      context,
                                    )!.pleaseEnterVinNumber;
                                  }
                                  if (!isValidVin(value)) {
                                    return AppLocalizations.of(
                                      context,
                                    )!.invalidVinNumber;
                                  }
                                  return null;
                                },
                              ),
                              const SizedBox(height: 10),
                              Row(
                                children: [
                                  Expanded(
                                    child: OutlinedButton.icon(
                                      onPressed: _isVinDecoding
                                          ? null
                                          : _decodeCurrentVin,
                                      icon: _isVinDecoding
                                          ? const SizedBox(
                                              width: 18,
                                              height: 18,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                              ),
                                            )
                                          : const Icon(Icons.manage_search),
                                      label: Text(
                                        AppLocalizations.of(context)!.decodeVin,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: OutlinedButton.icon(
                                      onPressed: _isVinDecoding
                                          ? null
                                          : _scanVin,
                                      icon: const Icon(Icons.document_scanner),
                                      label: Text(
                                        AppLocalizations.of(context)!.scanVin,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              if (_decodedVehicleInfo != null) ...[
                                const SizedBox(height: 12),
                                _DecodedVinPanel(info: _decodedVehicleInfo!),
                              ],
                              const SizedBox(height: 16),

                              // Date & Time Selector
                              GestureDetector(
                                onTap: _selectDateTime,
                                child: Container(
                                  width: double.infinity,
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 16,
                                    vertical: 16,
                                  ),
                                  decoration: BoxDecoration(
                                    border: Border.all(
                                      color: Colors.grey.shade300,
                                    ),
                                    borderRadius: BorderRadius.circular(12),
                                    color: Colors.grey.shade50,
                                  ),
                                  child: Row(
                                    children: [
                                      Icon(
                                        Icons.calendar_today,
                                        color: Colors.grey.shade600,
                                        size: 20,
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              AppLocalizations.of(
                                                context,
                                              )!.parkingDateTime,
                                              style: TextStyle(
                                                fontSize: 12,
                                                color: Colors.grey.shade600,
                                              ),
                                            ),
                                            const SizedBox(height: 4),
                                            Text(
                                              DateFormat(
                                                'MMM dd, yyyy - HH:mm',
                                              ).format(_selectedDateTime),
                                              style: const TextStyle(
                                                fontSize: 16,
                                                fontWeight: FontWeight.w500,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      Icon(
                                        Icons.arrow_drop_down,
                                        color: Colors.grey.shade600,
                                      ),
                                    ],
                                  ),
                                ),
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
                                  onPressed: _isLoading
                                      ? null
                                      : _saveAndPrintReceipt,
                                  child: _isLoading
                                      ? const SizedBox(
                                          width: 20,
                                          height: 20,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            valueColor:
                                                AlwaysStoppedAnimation<Color>(
                                                  Colors.white,
                                                ),
                                          ),
                                        )
                                      : Row(
                                          mainAxisAlignment:
                                              MainAxisAlignment.center,
                                          children: [
                                            const Icon(Icons.print, size: 20),
                                            const SizedBox(width: 8),
                                            Text(
                                              AppLocalizations.of(
                                                context,
                                              )!.printReceipt,
                                              style: const TextStyle(
                                                fontSize: 16,
                                                fontWeight: FontWeight.w600,
                                              ),
                                              overflow: TextOverflow.ellipsis,
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
            ],
          ),
        ),
      ),
    );
  }
}

class _RoundedTextField extends StatelessWidget {
  final String label;
  final TextEditingController? controller;
  final String? Function(String?)? validator;
  final Widget? suffixIcon;
  final TextCapitalization textCapitalization;

  const _RoundedTextField({
    required this.label,
    this.controller,
    this.validator,
    this.suffixIcon,
    this.textCapitalization = TextCapitalization.none,
  });

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      validator: validator,
      textCapitalization: textCapitalization,
      decoration: InputDecoration(
        labelText: label,
        suffixIcon: suffixIcon,
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

class _DecodedVinPanel extends StatelessWidget {
  const _DecodedVinPanel({required this.info});

  final DecodedVehicleInfo info;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final rows = <MapEntry<String, String>>[
      if (info.summary.isNotEmpty) MapEntry(l10n.vehicle, info.summary),
      if (info.bodyClass?.isNotEmpty == true)
        MapEntry(l10n.bodyStyle, info.bodyClass!),
      if (info.engine?.isNotEmpty == true) MapEntry(l10n.engine, info.engine!),
      if (info.fuelType?.isNotEmpty == true)
        MapEntry(l10n.fuelType, info.fuelType!),
    ];

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.brandRed.withValues(alpha: 0.06),
        border: Border.all(color: AppColors.brandRed.withValues(alpha: 0.22)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.fact_check_outlined, color: AppColors.brandRed),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  l10n.decodedVinDetails,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('${row.key}: ${row.value}'),
            ),
        ],
      ),
    );
  }
}

class _RoundedDropdownField extends StatelessWidget {
  final String label;
  final String? value;
  final List<String> items;
  final ValueChanged<String?>? onChanged;
  final String? Function(String?)? validator;
  final bool enabled;

  const _RoundedDropdownField({
    required this.label,
    required this.items,
    this.value,
    this.onChanged,
    this.validator,
    this.enabled = true,
  });

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      key: ValueKey<String?>(enabled ? value : null),
      initialValue: enabled ? value : null,
      onChanged: enabled ? onChanged : null,
      validator: validator,
      isExpanded: true,
      items: items
          .map(
            (item) => DropdownMenuItem<String>(value: item, child: Text(item)),
          )
          .toList(),
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
      icon: const Icon(Icons.arrow_drop_down),
      dropdownColor: Colors.white,
    );
  }
}
