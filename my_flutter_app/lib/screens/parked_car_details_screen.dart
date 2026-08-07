import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:intl/intl.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/parked_car.dart';
import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../data/car_catalog.dart';
import '../services/business_parking_entry.dart';
import '../theme/app_colors.dart';
import '../utils/action_confirmation.dart';
import '../utils/business_parking_localization.dart';
import '../utils/business_permissions.dart';
import '../utils/parking_status_options.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/async_action_button.dart';
import '../widgets/business_parking_payment_badge.dart';

class ParkedCarDetailsScreen extends StatefulWidget {
  final ParkedCar parkedCar;

  /// Injectable so a widget test can drive "mark payment received" without
  /// Firebase.
  final BusinessParkingService? businessParkingService;

  const ParkedCarDetailsScreen({
    super.key,
    required this.parkedCar,
    this.businessParkingService,
  });

  @override
  State<ParkedCarDetailsScreen> createState() => _ParkedCarDetailsScreenState();
}

class _ParkedCarDetailsScreenState extends State<ParkedCarDetailsScreen> {
  final _formKey = GlobalKey<FormState>();
  late TextEditingController _ownerNameController;
  late TextEditingController _costPerDayController;
  late TextEditingController _vinController;

  /// Only ever shown for a walk-up the lot recorded: a customer's own booking
  /// carries the platform's contact details, not the lot's to rewrite.
  late TextEditingController _customerPhoneController;
  late TextEditingController _customerEmailController;
  late final String _trackingCode;
  DateTime? _parkingEndDate;
  late DateTime _parkingStartDate;

  /// What the record held when this screen opened, so a save can send only
  /// what actually moved. The server treats an unchanged date as a reprice and
  /// would reissue a payment link the customer is already holding.
  late DateTime _savedStartDate;
  DateTime? _savedEndDate;
  late BusinessParkingPaymentMethod _paymentMethod;
  bool _isSavingEntry = false;
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

  /// Server-owned payment state for a walk-up the lot entered itself. Held in
  /// state rather than read straight off the widget so marking a payment
  /// received updates the card without a round trip through the list screen.
  late Map<String, dynamic> _paymentFields;
  late final BusinessParkingService _businessParkingService;
  String _receivedVia = businessParkingReceivedViaValues.first;
  bool _isMarkingPaid = false;

  @override
  void initState() {
    super.initState();
    _ownerNameController = TextEditingController(
      text: widget.parkedCar.ownerName,
    );
    _costPerDayController = TextEditingController();
    _vinController = TextEditingController(text: widget.parkedCar.vinNumber);
    _trackingCode = widget.parkedCar.trackingCode;
    _paymentFields = Map<String, dynamic>.from(widget.parkedCar.paymentFields);
    _customerPhoneController = TextEditingController(
      text: (_paymentFields['customerPhone'] ?? '').toString(),
    );
    _customerEmailController = TextEditingController(
      text: (_paymentFields['customerEmail'] ?? '').toString(),
    );
    _paymentMethod =
        (_paymentFields['paymentMethod'] ?? '').toString().trim() ==
            BusinessParkingPaymentMethod.paymentLink.wireValue
        ? BusinessParkingPaymentMethod.paymentLink
        : BusinessParkingPaymentMethod.direct;
    _businessParkingService =
        widget.businessParkingService ?? BusinessParkingService();
    _persistedStatus = widget.parkedCar.status;
    _statusDraft = _persistedStatus;
    _parkingStartDate = widget.parkedCar.parkingDate;
    _parkingEndDate = widget.parkedCar.parkingEndDate;
    _savedStartDate = widget.parkedCar.parkingDate;
    _savedEndDate = widget.parkedCar.parkingEndDate;
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
    _customerPhoneController.dispose();
    _customerEmailController.dispose();
    super.dispose();
  }

  /// A walk-up the lot entered itself, rather than a customer's own booking.
  bool get _isBusinessEntry => isBusinessEnteredParking(_paymentFields);

  /// Settled money. The server refuses every edit on such a record, so the
  /// screen must not offer one.
  bool get _isPaidEntry =>
      businessParkingPaymentTone(_paymentFields) ==
      BusinessParkingPaymentTone.paid;

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

  /// What this edit actually moved, in the callable's own field names.
  ///
  /// Only the difference goes to the server. An unchanged date resent as a
  /// change reads as a reprice, and a reprice on the payment-link path kills
  /// the URL the customer is holding and mints another - so sending the whole
  /// form every time would reissue links nobody asked to reissue.
  ///
  /// There is no amount here, and there cannot be one: the server recomputes
  /// it from the business's parking rates.
  Map<String, dynamic> _businessParkingChanges(
    BusinessParkingEntryDraft draft,
  ) {
    // The create payload already trims, lower-cases the email, upper-cases the
    // VIN and stamps the midday clock on both dates, which is exactly the
    // normalisation the comparison has to happen in.
    final payload = businessParkingEntryPayload(draft);
    final changes = <String, dynamic>{};
    void moved(String field, Object? current) {
      final next = payload[field];
      if ((next ?? '').toString() != (current ?? '').toString()) {
        changes[field] = next;
      }
    }

    moved(
      'customerName',
      _paymentFields['customerName'] ?? _paymentFields['ownerName'],
    );
    moved('customerPhone', _paymentFields['customerPhone']);
    moved(
      'customerEmail',
      (_paymentFields['customerEmail'] ?? '').toString().toLowerCase(),
    );
    moved('carMake', _paymentFields['carMake']);
    moved('carModel', _paymentFields['carModel']);
    moved('carYear', _paymentFields['carYear']);
    moved(
      'vinNumber',
      (_paymentFields['vinNumber'] ?? '').toString().toUpperCase(),
    );
    moved('startDate', businessParkingMiddayIso(_savedStartDate));
    moved('endDate', businessParkingMiddayIso(_savedEndDate));
    moved('paymentMethod', _paymentFields['paymentMethod']);
    return changes;
  }

  /// Saves a walk-up through `updateBusinessParkingEntry`.
  ///
  /// Deliberately not the Firestore write below. Dates move the price, and the
  /// price on a payment-link entry is baked into the Stripe session the
  /// customer is holding, so only the server can reprice the window, expire
  /// the stale session and reissue the link. Switching payment method is the
  /// same thing in reverse: one arrangement cancelled, another started.
  Future<bool> _saveBusinessParkingEntry({bool showSuccess = true}) async {
    final l10n = AppLocalizations.of(context)!;
    if (!_formKey.currentState!.validate()) return false;
    if (_selectedMake == null ||
        _selectedModel == null ||
        _selectedYear == null) {
      showErrorSnackBar(context, l10n.carIdentityRequired);
      return false;
    }

    final draft = BusinessParkingEntryDraft(
      businessId: (_paymentFields['businessId'] ?? '').toString(),
      customerName: _ownerNameController.text,
      customerPhone: _customerPhoneController.text,
      customerEmail: _customerEmailController.text,
      carMake: _selectedMake ?? '',
      carModel: _selectedModel ?? '',
      carYear: _selectedYear ?? '',
      vinNumber: _vinController.text,
      startDate: _parkingStartDate,
      endDate: _parkingEndDate,
      paymentMethod: _paymentMethod,
    );
    // The same rules the create form and the server enforce, so a correction
    // can never leave a record the create path would have refused.
    final errors = validateBusinessParkingEntry(draft);
    if (errors.isNotEmpty) {
      showErrorSnackBar(context, businessParkingErrorSummary(l10n, errors));
      return false;
    }

    final changes = _businessParkingChanges(draft);
    if (changes.isEmpty) {
      // The server answers an empty edit with a refusal; saying so here keeps
      // "nothing was changed" from arriving as a red failure.
      if (showSuccess) showSuccessSnackBar(context, l10n.parkingNothingChanged);
      return true;
    }

    setState(() => _isSavingEntry = true);
    try {
      final result = await _businessParkingService.updateEntry(
        entryId: widget.parkedCar.id,
        changes: changes,
      );
      if (!mounted) return false;

      final nextFields = <String, dynamic>{
        ..._paymentFields,
        'customerName': draft.customerName.trim(),
        'ownerName': draft.customerName.trim(),
        'customerPhone': draft.customerPhone.trim(),
        'customerEmail': draft.customerEmail.trim().toLowerCase(),
        'carMake': draft.carMake,
        'carModel': draft.carModel,
        'carYear': draft.carYear,
        'vinNumber': draft.vinNumber.trim().toUpperCase(),
        'parkingDate': _parkingStartDate,
        'parkingEndDate': _parkingEndDate,
        'paymentMethod': result.paymentMethod.isEmpty
            ? _paymentMethod.wireValue
            : result.paymentMethod,
        'amountDueCents': result.amountDueCents,
      };
      if (changes.containsKey('paymentMethod')) {
        nextFields['paymentStatus'] = result.isPaymentLink
            ? 'awaiting_link_payment'
            : 'awaiting_direct_payment';
      }
      if (result.relinked) {
        // A reissued link is a live link again, whatever the record said
        // before, and the URL in the card is now the stale one.
        nextFields['paymentLinkCancelledAt'] = null;
        nextFields['checkoutStatus'] = 'open';
        if (result.paymentLinkUrl.isNotEmpty) {
          nextFields['checkoutUrl'] = result.paymentLinkUrl;
        }
      }
      if (!result.isPaymentLink) {
        // Off the link path: the server deleted the URL and expired the
        // session, so the card must stop offering either.
        nextFields['checkoutUrl'] = '';
        nextFields['paymentLinkCancelledAt'] = null;
      }
      setState(() {
        _paymentFields = nextFields;
        _savedStartDate = _parkingStartDate;
        _savedEndDate = _parkingEndDate;
      });

      if (result.relinked) {
        // Said whether or not the caller wanted a success message: the staff
        // member is holding a URL that no longer takes money.
        final delivery = businessParkingLinkDeliveryMessage(
          l10n,
          emailed: result.emailed,
          texted: result.texted,
        );
        final message = '${l10n.parkingPaymentLinkReissued} $delivery';
        if (result.reachedCustomer) {
          showSuccessSnackBar(context, message);
        } else {
          showErrorSnackBar(context, message);
        }
      } else if (showSuccess) {
        showSuccessSnackBar(context, l10n.recordUpdated);
      }
      return true;
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return false;
      // The server's refusal says something this screen's copy cannot - "This
      // parking has been paid for and can no longer be edited", or which field
      // it would not accept - so it is shown as written.
      final message = (error.message ?? '').trim();
      showErrorSnackBar(
        context,
        message.isEmpty ? l10n.parkingRecordCouldNotBeUpdated : message,
      );
      return false;
    } catch (_) {
      if (!mounted) return false;
      showErrorSnackBar(context, l10n.parkingRecordCouldNotBeUpdated);
      return false;
    } finally {
      if (mounted) setState(() => _isSavingEntry = false);
    }
  }

  Future<bool> _persistChanges({bool showSuccess = true}) async {
    // A walk-up the lot recorded is the callable's to change, never this
    // screen's: the money, the availability check and the payment link all
    // hang off the same edit.
    if (_isBusinessEntry) {
      return _saveBusinessParkingEntry(showSuccess: showSuccess);
    }

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
    final wasBusinessEntry = _isBusinessEntry;
    final success = await _persistChanges();
    // A walk-up stays on screen after a save: the edit may have reissued the
    // payment link, and popping would take the new URL away with it.
    if (success && mounted && !wasBusinessEntry) {
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
    // Marking money received is a parking-permission action, not an admin one:
    // the lot's own staff are the people who take the Zelle.
    final bool canRecordPayment =
        isAdmin || authProvider.hasBusinessPermission(BusinessPermission.parking);
    final bool isBusinessEntry = _isBusinessEntry;
    final bool isPaidEntry = _isPaidEntry;
    // A walk-up is the lot's own record, taken at its own window, so its staff
    // correct it under the same permission that records the payment - and the
    // callable enforces that permission anyway. A PAID record is frozen: the
    // charge was taken, the platform cut split and the payout sent, so the
    // server refuses every edit and an editable field would be a lie.
    final bool canEdit = isBusinessEntry
        ? (canRecordPayment && !isPaidEntry)
        : (isAdmin && _persistedStatus != 'completed');

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
                                    // Paid / Not paid, in the header rather
                                    // than among the detail rows, so the state
                                    // is readable at a glance.
                                    if (businessParkingPaymentTone(
                                          _paymentFields,
                                        ) !=
                                        BusinessParkingPaymentTone.none) ...[
                                      const SizedBox(height: 8),
                                      BusinessParkingPaymentBadge(
                                        paymentFields: _paymentFields,
                                      ),
                                    ],
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
                          // The record is frozen rather than silently
                          // unsaveable: a form that accepts typing and then
                          // refuses to save is how a lot loses an afternoon.
                          if (isBusinessEntry && isPaidEntry) ...[
                            Container(
                              key: const ValueKey<String>(
                                'parking-edit-locked',
                              ),
                              width: double.infinity,
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.85),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(
                                l10n.parkingPaidCannotBeEdited,
                                style: TextStyle(
                                  fontSize: 13,
                                  color: Colors.grey.shade800,
                                ),
                              ),
                            ),
                            const SizedBox(height: 16),
                          ],
                          _buildInfoCard(canEdit, isBusinessEntry),
                          const SizedBox(height: 24),
                          _buildBillingCard(l10n, canEdit, isBusinessEntry),
                          if (isBusinessEntry) ...[
                            const SizedBox(height: 24),
                            _buildBusinessPaymentCard(l10n, canRecordPayment),
                          ],
                          const SizedBox(height: 24),
                          if (isBusinessEntry)
                            // One button, and only while the record can still
                            // be changed. The printable document for a walk-up
                            // is the server's - it is offered in the payment
                            // card above, headed receipt or invoice to match
                            // the money.
                            SizedBox(
                              width: double.infinity,
                              child: AsyncActionButton.filled(
                                key: const ValueKey<String>(
                                  'parking-save-entry',
                                ),
                                onPressed: (canEdit && !_isSavingEntry)
                                    ? _updateRecord
                                    : null,
                                icon: Icons.save_outlined,
                                label: l10n.updateRecord,
                              ),
                            )
                          else
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

  /// The day the car leaves. It lives beside the arrival date on a walk-up
  /// (the window is what the server prices) and in the billing card on a
  /// customer booking, where the cost per day sits next to it.
  Widget _buildEndDateTile(AppLocalizations l10n, bool canEdit) {
    return ListTile(
      key: const ValueKey<String>('parking-end-date'),
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
    );
  }

  /// The payment question, asked in the same plain words the intake form uses.
  ///
  /// Changing it is not a form edit but a money edit - one arrangement
  /// cancelled and another started - which is why the callable performs it and
  /// this only collects the answer.
  Widget _buildPaymentMethodChoice(AppLocalizations l10n, bool canEdit) {
    return Column(
      key: const ValueKey<String>('parking-payment-method'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.howDoesThisParkingGetPaid,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: Colors.grey.shade800,
          ),
        ),
        RadioGroup<BusinessParkingPaymentMethod>(
          groupValue: _paymentMethod,
          // The group's callback is not nullable, so a frozen record is held
          // by the tiles' `enabled` and by this guard together.
          onChanged: (value) {
            if (value == null || !canEdit) return;
            setState(() => _paymentMethod = value);
          },
          child: Column(
            children: [
              RadioListTile<BusinessParkingPaymentMethod>(
                value: BusinessParkingPaymentMethod.direct,
                contentPadding: EdgeInsets.zero,
                enabled: canEdit,
                title: Text(
                  l10n.customerPaysUsDirectly,
                  style: const TextStyle(fontSize: 15),
                ),
              ),
              RadioListTile<BusinessParkingPaymentMethod>(
                value: BusinessParkingPaymentMethod.paymentLink,
                contentPadding: EdgeInsets.zero,
                enabled: canEdit,
                title: Text(
                  l10n.sendTheCustomerAPaymentLink,
                  style: const TextStyle(fontSize: 15),
                ),
              ),
            ],
          ),
        ),
        Text(
          _paymentMethod == BusinessParkingPaymentMethod.direct
              ? l10n.directPaymentExplainer
              : l10n.paymentLinkExplainer,
          style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600),
        ),
      ],
    );
  }

  Widget _buildInfoCard(bool canEdit, bool isBusinessEntry) {
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
          // A walk-up carries the customer's own contact details, and they are
          // what a payment link travels on: an email corrected here is the
          // difference between a link that arrives and one that does not.
          if (isBusinessEntry) ...[
            const SizedBox(height: 16),
            TextFormField(
              key: const ValueKey<String>('parking-customer-phone'),
              controller: _customerPhoneController,
              readOnly: !canEdit,
              keyboardType: TextInputType.phone,
              decoration: InputDecoration(labelText: l10n.customerPhone),
              validator: (value) {
                if (!canEdit) return null;
                return (value ?? '').trim().isEmpty
                    ? l10n.parkingErrorCustomerPhone
                    : null;
              },
            ),
            const SizedBox(height: 16),
            TextFormField(
              key: const ValueKey<String>('parking-customer-email'),
              controller: _customerEmailController,
              readOnly: !canEdit,
              keyboardType: TextInputType.emailAddress,
              decoration: InputDecoration(
                labelText: l10n.customerEmailOptional,
              ),
            ),
          ],
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
          if (isBusinessEntry) ...[
            _buildEndDateTile(l10n, canEdit),
            const SizedBox(height: 8),
            _buildPaymentMethodChoice(l10n, canEdit),
          ],
        ],
      ),
    );
  }

  /// Records that the customer paid the lot off-platform.
  ///
  /// The platform never held this money - it recorded what was owed - so this
  /// only moves the record's payment status. It is idempotent server-side, and
  /// `alreadyPaid` comes back as a success rather than an error so two staff
  /// marking the same walk-up at once cannot double-record it.
  Future<void> _markPaymentReceived() async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.markPaymentReceivedTitle,
      message: l10n.markPaymentReceivedMessage,
      confirmLabel: l10n.markPaymentReceived,
      icon: Icons.payments_outlined,
    );
    if (!confirmed || !mounted) return;

    setState(() => _isMarkingPaid = true);
    try {
      final result = await _businessParkingService.markPaid(
        entryId: widget.parkedCar.id,
        receivedVia: _receivedVia,
      );
      if (!mounted) return;
      setState(() {
        _paymentFields = <String, dynamic>{
          ..._paymentFields,
          'paymentStatus': 'paid',
          'directPaymentReceived': true,
          'directPaymentMethod': _receivedVia,
        };
      });
      showSuccessSnackBar(
        context,
        result.alreadyPaid ? l10n.parkingAlreadyMarkedPaid : l10n.paymentRecorded,
      );
    } catch (error) {
      if (!mounted) return;
      showErrorSnackBar(context, l10n.paymentCouldNotBeRecorded);
    } finally {
      if (mounted) setState(() => _isMarkingPaid = false);
    }
  }

  /// Kills a payment link the customer has not used.
  ///
  /// The other half of the owner's rule: a link stays valid until the
  /// customer pays it or the lot cancels it. `alreadyCancelled` comes back as
  /// a success, and the callable's own `failed-precondition` message ("This
  /// parking has already been paid for") is shown rather than replaced, since
  /// it says something this screen's copy cannot.
  Future<void> _cancelPaymentLink() async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.cancelPaymentLink,
      message: l10n.cancelPaymentLinkConfirm,
      confirmLabel: l10n.cancelPaymentLink,
      icon: Icons.link_off,
      destructive: true,
    );
    if (!confirmed || !mounted) return;

    try {
      final result = await _businessParkingService.cancelPaymentLink(
        entryId: widget.parkedCar.id,
      );
      if (!mounted) return;
      setState(() {
        _paymentFields = <String, dynamic>{
          ..._paymentFields,
          'paymentLinkCancelledAt': DateTime.now().toIso8601String(),
          'checkoutStatus': 'cancelled',
        };
      });
      showSuccessSnackBar(
        context,
        result.alreadyCancelled
            ? l10n.parkingPaymentLinkCancelled
            : l10n.paymentLinkCancelled,
      );
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      final message = (error.message ?? '').trim();
      showErrorSnackBar(
        context,
        message.isEmpty ? l10n.paymentLinkCouldNotBeCancelled : message,
      );
    } catch (_) {
      if (!mounted) return;
      showErrorSnackBar(context, l10n.paymentLinkCouldNotBeCancelled);
    }
  }

  /// Sends the customer their payment link again.
  ///
  /// The record's own durable URL, not a new one - the customer may already be
  /// holding this link, and two live links for one car is how a lot ends up
  /// chasing a payment that already happened. No confirmation: sending a link
  /// again takes nothing away, unlike cancelling one.
  ///
  /// A send that reached neither the email nor the phone is reported as a
  /// failure even though the callable calls it a success: the staff member has
  /// to know the customer never got it.
  Future<void> _resendPaymentLink() async {
    final l10n = AppLocalizations.of(context)!;
    try {
      final result = await _businessParkingService.resendPaymentLink(
        entryId: widget.parkedCar.id,
      );
      if (!mounted) return;
      final message = businessParkingLinkDeliveryMessage(
        l10n,
        emailed: result.emailed,
        texted: result.texted,
      );
      if (result.reachedCustomer) {
        showSuccessSnackBar(context, message);
      } else {
        showErrorSnackBar(context, message);
      }
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      // "This parking has already been paid for", "This payment link was
      // cancelled", "There is no email or phone number on file" - each says
      // something this screen's copy cannot.
      final message = (error.message ?? '').trim();
      showErrorSnackBar(
        context,
        message.isEmpty ? l10n.parkingPaymentLinkCouldNotBeResent : message,
      );
    } catch (_) {
      if (!mounted) return;
      showErrorSnackBar(context, l10n.parkingPaymentLinkCouldNotBeResent);
    }
  }

  /// Opens the branded receipt or invoice for this record.
  ///
  /// The server owns the document: it mints the durable token, decides
  /// whether the page is headed "Receipt" or "Invoice", and serves the print
  /// button. All this does is ask for the URL and hand it to the OS browser -
  /// [LaunchMode.externalApplication] rather than an in-app view, because
  /// printing and sharing are the browser's, not ours.
  ///
  /// The callable enforces the parking permission itself and answers a refusal
  /// with `FirebaseFunctionsException`, whose message says something this
  /// screen's copy cannot, so it is shown rather than replaced.
  Future<void> _openParkingDocument() async {
    final l10n = AppLocalizations.of(context)!;
    try {
      final document = await _businessParkingService.parkingDocumentUrl(
        entryId: widget.parkedCar.id,
      );
      if (!mounted) return;
      final uri = document.hasUrl ? Uri.tryParse(document.url) : null;
      if (uri == null) {
        showErrorSnackBar(context, l10n.parkingDocumentCouldNotBeOpened);
        return;
      }
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && mounted) {
        showErrorSnackBar(context, l10n.parkingDocumentCouldNotBeOpened);
      }
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      final message = (error.message ?? '').trim();
      showErrorSnackBar(
        context,
        message.isEmpty ? l10n.parkingDocumentCouldNotBeOpened : message,
      );
    } catch (_) {
      if (!mounted) return;
      showErrorSnackBar(context, l10n.parkingDocumentCouldNotBeOpened);
    }
  }

  Future<void> _copyCheckoutUrl(String url) async {
    final l10n = AppLocalizations.of(context)!;
    try {
      await Clipboard.setData(ClipboardData(text: url));
      if (mounted) showSuccessSnackBar(context, l10n.paymentLinkCopied);
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.paymentLinkCopyFailed);
    }
  }

  /// The payment card for a walk-up the lot entered itself. Absent entirely
  /// for a customer's own booking, whose payment the platform owns.
  Widget _buildBusinessPaymentCard(AppLocalizations l10n, bool canRecordPayment) {
    final currency = NumberFormat.simpleCurrency(
      locale: Localizations.localeOf(context).toString(),
      name: 'USD',
    );
    final checkoutUrl = (_paymentFields['checkoutUrl'] ?? '').toString();
    final awaitingDirect = canMarkBusinessParkingPaid(_paymentFields);
    // A settled link is a dead end: Stripe answers it with an
    // already-completed page, which the owner read as a broken link. Say the
    // money is in instead of offering the link again.
    final isPaid =
        businessParkingPaymentTone(_paymentFields) ==
        BusinessParkingPaymentTone.paid;
    // A cancelled link is just as dead, and for the same reason: offering it
    // again would send the customer to a page that cannot take their money.
    final linkCancelled = isBusinessParkingPaymentLinkCancelled(_paymentFields);
    // Cancelling is a parking-permission action for the same reason marking a
    // payment received is - and the callable enforces the permission anyway.
    final canCancelLink =
        canRecordPayment &&
        canCancelBusinessParkingPaymentLink(_paymentFields);
    // Same gate, same reasons: a paid entry, a killed link or a record with no
    // link has nothing to resend, and the server would refuse all three.
    final canResendLink =
        canRecordPayment &&
        canResendBusinessParkingPaymentLink(_paymentFields);
    // Settled money prints as a receipt, money still owed as an invoice - the
    // owner asked for one button, not two, and for it to say which it is
    // before it is pressed.
    final documentIsReceipt =
        businessParkingDocumentType(_paymentFields) ==
        BusinessParkingDocumentType.receipt;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.85),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.paymentStatusLabel,
            style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
          ),
          const SizedBox(height: 4),
          Text(
            businessParkingPaymentStatusLabel(l10n, _paymentFields),
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 12),
          Text(
            l10n.amountRecorded,
            style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
          ),
          const SizedBox(height: 4),
          Text(
            currency.format(businessParkingAmountDue(_paymentFields)),
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          // Gated on the same permission as the rest of the card: the lot's
          // own staff hand a customer their paperwork, and the callable
          // enforces the permission anyway.
          if (canRecordPayment) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: AsyncActionButton.outlined(
                key: const ValueKey<String>('parking-print-document'),
                onPressed: _openParkingDocument,
                icon: Icons.print_outlined,
                label: documentIsReceipt
                    ? l10n.parkingPrintReceipt
                    : l10n.parkingPrintInvoice,
              ),
            ),
          ],
          if (checkoutUrl.isNotEmpty && isPaid) ...[
            const SizedBox(height: 12),
            Text(
              l10n.parkingPaymentLinkAlreadyUsed,
              style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
            ),
          ] else if (checkoutUrl.isNotEmpty && linkCancelled) ...[
            const SizedBox(height: 12),
            Text(
              l10n.parkingPaymentLinkCancelled,
              style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
            ),
          ] else if (checkoutUrl.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              l10n.paymentLinkLabel,
              style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
            ),
            const SizedBox(height: 4),
            SelectableText(
              checkoutUrl,
              style: const TextStyle(fontSize: 12.5),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 12,
              runSpacing: 8,
              children: [
                AsyncActionButton.outlined(
                  onPressed: () => _copyCheckoutUrl(checkoutUrl),
                  icon: Icons.copy,
                  label: l10n.copyPaymentLink,
                ),
                if (canResendLink)
                  AsyncActionButton.outlined(
                    key: const ValueKey<String>('parking-resend-payment-link'),
                    onPressed: _resendPaymentLink,
                    icon: Icons.send_outlined,
                    label: l10n.resendPaymentLink,
                  ),
                if (canCancelLink)
                  AsyncActionButton.outlined(
                    key: const ValueKey<String>('parking-cancel-payment-link'),
                    onPressed: _cancelPaymentLink,
                    icon: Icons.link_off,
                    label: l10n.cancelPaymentLink,
                  ),
              ],
            ),
          ],
          if (awaitingDirect && canRecordPayment) ...[
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              key: ValueKey<String>(_receivedVia),
              initialValue: _receivedVia,
              decoration: InputDecoration(labelText: l10n.receivedVia),
              isExpanded: true,
              items: businessParkingReceivedViaValues
                  .map(
                    (value) => DropdownMenuItem<String>(
                      value: value,
                      child: Text(
                        businessParkingReceivedViaLabel(l10n, value),
                      ),
                    ),
                  )
                  .toList(),
              onChanged: _isMarkingPaid
                  ? null
                  : (value) {
                      if (value == null) return;
                      setState(() => _receivedVia = value);
                    },
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: AsyncActionButton.filled(
                onPressed: _isMarkingPaid ? null : _markPaymentReceived,
                icon: Icons.payments_outlined,
                label: l10n.markPaymentReceived,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildBillingCard(
    AppLocalizations l10n,
    bool canEdit,
    bool isBusinessEntry,
  ) {
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
          // A walk-up shows neither of these. The amount is the server's: it
          // reprices the window from the business's own parking rates on every
          // edit, so a cost-per-day field here would offer to contradict what
          // the customer is actually charged. What the entry recorded is shown
          // in the payment card below, as "amount recorded".
          if (!isBusinessEntry) ...[
            _buildEndDateTile(l10n, canEdit),
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
          ],
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
            // Read-only on a walk-up: the status of such a record follows the
            // money (`updateBusinessParkingEntry` sets it from the payment
            // plan), and the callable takes no status field - a dropdown that
            // saved nothing would be worse than one that cannot be moved.
            onChanged: (canEdit && !isBusinessEntry)
                ? (value) {
                    if (value != null) {
                      setState(() {
                        _statusDraft = value;
                      });
                    }
                  }
                : null,
          ),
          if (!isBusinessEntry) ...[
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
