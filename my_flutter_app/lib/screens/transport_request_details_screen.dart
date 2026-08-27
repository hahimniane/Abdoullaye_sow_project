import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../data/car_catalog.dart';
import '../models/destination_country.dart';
import '../l10n/app_localizations.dart';
import '../models/transport_request.dart';
import '../models/transport_quote.dart';
import '../providers/auth_provider.dart';
import '../services/transport_service.dart';
import '../widgets/destination_country_field.dart';
import '../utils/transport_receipt_generator.dart';
import '../widgets/app_back_button.dart';
import '../widgets/transport_journey.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/language_toggle.dart';
import '../widgets/support_entry_button.dart';
import '../theme/app_colors.dart';

/// Statuses this screen can set on a transport request.
///
/// `not_started` is the `fulfillmentStatus` the server stamps on a brand-new
/// request (`functions/index.js`), and `TransportRequest` maps
/// `fulfillmentStatus` onto `status` - so it is the first value this screen
/// ever sees for a new request, and omitting it made every new transport
/// request unopenable.
const transportStatusOptions = [
  'not_started',
  'pending',
  'in_transit',
  'completed',
];

/// The dropdown's items must always contain its current value, or the framework
/// asserts and the screen renders a red error instead of the request.
///
/// A status written by the server or an older build that this screen does not
/// know about is folded in rather than dropped, so the request stays readable
/// and can be moved to a known status instead of becoming unopenable.
List<String> transportStatusChoices(String current) =>
    transportStatusOptions.contains(current)
    ? transportStatusOptions
    : [current, ...transportStatusOptions];

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
  late TransportRequest _request;

  bool _isSaving = false;

  StreamSubscription<DocumentSnapshot>? _subscription;

  List<String> get _statusChoices => transportStatusChoices(_statusDraft);

  @override
  void initState() {
    super.initState();
    _ownerController = TextEditingController(text: widget.request.ownerName);
    _vinController = TextEditingController(text: widget.request.vinNumber);
    _priceController = TextEditingController(
      text: NumberFormat('#.##').format(widget.request.price),
    );
    _selectedMake = widget.request.carMake.isNotEmpty
        ? widget.request.carMake
        : null;
    _selectedModel = widget.request.carModel.isNotEmpty
        ? widget.request.carModel
        : null;
    _selectedYear = widget.request.carYear.isNotEmpty
        ? widget.request.carYear
        : null;
    _transportDate = widget.request.transportDate;
    _persistedStatus = widget.request.status;
    _statusDraft = _persistedStatus;
    _trackingCode = widget.request.trackingCode;
    _request = widget.request;

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
    _request = latest;
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
    // A Firestore snapshot can land before CarCatalog.load() finishes, and the
    // catalog throws rather than returning empty when read too early. Skipping
    // this pass is safe: the next snapshot, or the edit sheet's own read, will
    // populate the options once loading completes.
    if (!catalog.isLoaded) return;
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
      setState(() {
        _transportDate = picked;
      });
    }
  }

  Future<void> _copyTrackingNumber() async {
    await Clipboard.setData(ClipboardData(text: _trackingCode));
    if (!mounted) return;
    final l10n = AppLocalizations.of(context)!;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(l10n.trackingNumberCopied)));
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
      showSuccessSnackBar(context, l10n.transportUpdatedSuccessfully);
    } catch (e) {
      if (!mounted) return;
      setState(() => _isSaving = false);
      showErrorSnackBar(context, l10n.failedToUpdateTransport(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = Provider.of<AuthProvider>(context);
    final canEdit =
        auth.isAdmin &&
        !_request.usesQuoteMarketplace &&
        _persistedStatus != 'completed';

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
                          // The same journey-and-timeline answer barrels
                          // give: where is it, and what just happened.
                          if (_request.hasSelectedQuote) ...[
                            TransportJourneyBar(
                              status: _request.fulfillmentStatus.isNotEmpty
                                  ? _request.fulfillmentStatus
                                  : _request.status,
                            ),
                            TransportTrackingTimeline(
                              requestId: _request.id,
                            ),
                            const SizedBox(height: 16),
                          ],
                          _CustomerRequestInfo(request: _request),
                          if (_request.usesQuoteMarketplace) ...[
                            const SizedBox(height: 16),
                            _TransportQuoteSection(request: _request),
                          ],
                          const SizedBox(height: 16),
                          SupportEntryButton(
                            relatedCollection: 'transportRequests',
                            relatedId: widget.request.id,
                            subject: l10n.supportChat,
                            relatedLabel: _trackingCode,
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
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
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
                            items: _statusChoices
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
                            decoration: InputDecoration(
                              labelText: l10n.statusLabel,
                            ),
                          ),
                          const SizedBox(height: 24),
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
                                      ? _updateRequest
                                      : null,
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
                                                AlwaysStoppedAnimation<Color>(
                                                  Colors.white,
                                                ),
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
      case 'not_started':
        return l10n.shipmentStatusNotStarted;
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

class _TransportQuoteSection extends StatefulWidget {
  const _TransportQuoteSection({required this.request});

  final TransportRequest request;

  @override
  State<_TransportQuoteSection> createState() => _TransportQuoteSectionState();
}

class _TransportQuoteSectionState extends State<_TransportQuoteSection> {
  final _service = TransportService();
  String _selectingQuoteId = '';
  String _error = '';
  bool _cancelling = false;
  bool _savingEdit = false;
  bool _paying = false;

  Future<void> _selectQuote(TransportQuote quote) async {
    final l10n = AppLocalizations.of(context)!;
    final price = NumberFormat.simpleCurrency(
      name: quote.currency.toUpperCase(),
    ).format(quote.amount);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.confirmTransportQuoteTitle),
        content: Text(
          l10n.confirmTransportQuoteMessage(quote.businessName, price),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.keepComparing),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.chooseThisBusiness),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _selectingQuoteId = quote.id;
      _error = '';
    });
    try {
      await _service.selectQuote(
        requestId: widget.request.id,
        quoteId: quote.id,
      );
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = l10n.couldNotSelectTransportQuote);
      return;
    } finally {
      if (mounted) setState(() => _selectingQuoteId = '');
    }
    // Accepting is a commitment, so the money is the next step, not a later
    // one. A failure here is recoverable: the selection stands and the
    // details screen keeps offering Pay now.
    await _payForJob();
  }

  Future<void> _payForJob() async {
    if (_paying || !mounted) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _paying = true;
      _error = '';
    });
    try {
      await _service.payForJob(requestId: widget.request.id);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = l10n.transportPaymentFailed);
    } finally {
      if (mounted) setState(() => _paying = false);
    }
  }

  Future<void> _cancelRequest() async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.confirmCancelTransportRequestTitle),
        content: Text(l10n.confirmCancelTransportRequestMessage),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.keepRequestOpen),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.cancelTransportRequest),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _cancelling = true;
      _error = '';
    });
    try {
      await _service.cancelRequest(widget.request.id);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = l10n.couldNotCancelTransportRequest);
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  /// The customer may revise the request until they pick a quote. No business
  /// "accepts" here - they quote - so quote selection is the real cutoff.
  bool _canCustomerEdit(AuthProvider auth) {
    final request = widget.request;
    // Mirrors assertCollectingTransportRequest on the server, with one
    // deliberate difference: the server checks the raw `status` field, but
    // this model maps `status` to `fulfillmentStatus ?? status`, so it never
    // reads back as 'quote_requested' and comparing it hid the action
    // entirely. quoteStatus is stored raw, and for v2 records it only leaves
    // 'collecting' when status leaves 'quote_requested' - so the pair below
    // expresses the same window without depending on the mapped field.
    return request.customerUid != null &&
        request.customerUid == auth.user?.uid &&
        request.flowVersion == 2 &&
        request.quoteStatus == 'collecting';
  }

  /// Fields a business priced its quote against. Changing any of these makes
  /// the quotes in hand quotes for a different job.
  bool _isQuoteAffecting(Map<String, Object?> patch) {
    const quoted = {
      'carMake',
      'carModel',
      'carYear',
      'pickupArea',
      'vehicleOperable',
      'requestedTransportMethod',
      'destinationCountryId',
    };
    return patch.keys.any(quoted.contains);
  }

  Future<void> _saveEdit(Map<String, Object?> patch) async {
    final l10n = AppLocalizations.of(context)!;
    if (patch.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(l10n.transportEditNoChanges)));
      return;
    }

    // Warn before saving, not after: the customer has watched these quotes
    // arrive, and clearing them silently would read as losing them.
    if (_isQuoteAffecting(patch) && widget.request.quoteCount > 0) {
      final proceed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(l10n.transportEditQuoteWarningTitle),
          content: Text(l10n.transportEditQuoteWarningMessage),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(l10n.transportEditKeepEditing),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(l10n.transportEditSaveAnyway),
            ),
          ],
        ),
      );
      if (proceed != true || !mounted) return;
    }

    setState(() {
      _savingEdit = true;
      _error = '';
    });
    try {
      final result = await _service.updateRequestDetails(
        requestId: widget.request.id,
        destinationCountryId: patch['destinationCountryId'] as String?,
        carMake: patch['carMake'] as String?,
        carModel: patch['carModel'] as String?,
        carYear: patch['carYear'] as String?,
        customerPhone: patch['customerPhone'] as String?,
        pickupArea: patch['pickupArea'] as String?,
        pickupAddress: patch['pickupAddress'] as String?,
        notes: patch['notes'] as String?,
        vehicleOperable: patch['vehicleOperable'] as bool?,
        requestedTransportMethod: patch['requestedTransportMethod'] as String?,
        flexibleDates: patch['flexibleDates'] as bool?,
      );
      if (!mounted) return;
      final message = !result.updated
          ? l10n.transportEditNoChanges
          : result.destinationChanged
              ? l10n.transportEditDestinationMoved
              : result.requoteRequired
                  ? l10n.transportEditSavedRequote
                  : l10n.transportEditSaved;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = l10n.couldNotUpdateTransportRequest);
    } finally {
      if (mounted) setState(() => _savingEdit = false);
    }
  }

  Future<void> _openEditSheet() async {
    final l10n = AppLocalizations.of(context)!;
    final request = widget.request;
    final catalog = CarCatalog.instance;
    final phone = TextEditingController(text: request.customerPhone);
    final pickupAddress = TextEditingController(text: request.pickupAddress);
    final notes = TextEditingController(text: request.notes);
    final pickupArea = TextEditingController(text: request.pickupArea);
    var operable = request.vehicleOperable;
    var method = request.requestedTransportMethod;
    // Pickup fields stay hidden until the customer says they want pickup -
    // an address on a drop-off request is a field that changes their price.
    var wantsPickup = request.pickupAddress.trim().isNotEmpty;
    DestinationCountry? country;
    // Free text would let "toyta" and "Toyota " become separate makes, so
    // make/model/year come from the shared catalog, each narrowing the next.
    // Seed from the catalog's spelling when the stored value only differs by
    // case, so the dependent pickers populate and saving cleans the record.
    final canonMake = catalog.canonicalMake(request.carMake);
    final canonModel =
        catalog.canonicalModel(request.carMake, request.carModel);
    String? make = canonMake.isNotEmpty
        ? canonMake
        : (request.carMake.isNotEmpty ? request.carMake : null);
    String? model = canonModel.isNotEmpty
        ? canonModel
        : (request.carModel.isNotEmpty ? request.carModel : null);
    String? year = request.carYear.isNotEmpty ? request.carYear : null;

    // A stored value from before the catalog must still be selectable, or the
    // dropdown renders empty and DropdownButton asserts on an unknown value.
    List<String> withCurrent(List<String> options, String? current) {
      if (current == null || current.isEmpty || options.contains(current)) {
        return options;
      }
      return [current, ...options];
    }

    final patch = await showModalBottomSheet<Map<String, Object?>>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          bottom: MediaQuery.of(sheetContext).viewInsets.bottom + 20,
        ),
        child: StatefulBuilder(
          builder: (sheetContext, setSheetState) {
            final makes = withCurrent(catalog.getMakes(), make);
            final models = withCurrent(
              make == null ? const [] : catalog.getModels(make!),
              model,
            );
            final years = withCurrent(
              make == null || model == null
                  ? const []
                  : catalog.getYears(make!, model!),
              year,
            );
            return SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    l10n.editTransportRequestTitle,
                    style: Theme.of(sheetContext).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    l10n.editTransportRequestSubtitle,
                    style: Theme.of(sheetContext).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 18),
                  Text(l10n.transportEditContactSection,
                      style: Theme.of(sheetContext).textTheme.labelLarge),
                  const SizedBox(height: 8),
                  TextField(
                    controller: phone,
                    keyboardType: TextInputType.phone,
                    decoration: InputDecoration(labelText: l10n.phoneNumber),
                  ),
                  const SizedBox(height: 10),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: wantsPickup,
                    title: Text(l10n.transportEditNeedsPickup),
                    onChanged: (value) =>
                        setSheetState(() => wantsPickup = value),
                  ),
                  if (wantsPickup) ...[
                    TextField(
                      controller: pickupAddress,
                      decoration:
                          InputDecoration(labelText: l10n.pickupAddress),
                    ),
                    const SizedBox(height: 10),
                  ],
                  TextField(
                    controller: pickupArea,
                    decoration: InputDecoration(labelText: l10n.pickupArea),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: notes,
                    maxLines: 2,
                    decoration: InputDecoration(labelText: l10n.notes),
                  ),
                  const SizedBox(height: 18),
                  Text(l10n.transportEditVehicleSection,
                      style: Theme.of(sheetContext).textTheme.labelLarge),
                  const SizedBox(height: 8),
                  DestinationCountryField(
                    value: country,
                    label: l10n.destinationCountry,
                    requiredMessage: l10n.requiredField,
                    onChanged: (value) =>
                        setSheetState(() => country = value),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: make,
                    isExpanded: true,
                    decoration: InputDecoration(labelText: l10n.carMake),
                    items: [
                      for (final option in makes)
                        DropdownMenuItem(value: option, child: Text(option)),
                    ],
                    // Model and year belong to the old make; keeping them
                    // would save a combination that does not exist.
                    onChanged: (value) => setSheetState(() {
                      make = value;
                      model = null;
                      year = null;
                    }),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: model,
                    isExpanded: true,
                    decoration: InputDecoration(labelText: l10n.carModel),
                    items: [
                      for (final option in models)
                        DropdownMenuItem(value: option, child: Text(option)),
                    ],
                    onChanged: make == null
                        ? null
                        : (value) => setSheetState(() {
                              model = value;
                              year = null;
                            }),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: year,
                    isExpanded: true,
                    decoration: InputDecoration(labelText: l10n.carYear),
                    items: [
                      for (final option in years)
                        DropdownMenuItem(value: option, child: Text(option)),
                    ],
                    onChanged: model == null
                        ? null
                        : (value) => setSheetState(() => year = value),
                  ),
                  const SizedBox(height: 10),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    value: operable,
                    title: Text(l10n.vehicleOperable),
                    onChanged: (value) =>
                        setSheetState(() => operable = value),
                  ),
                  DropdownButtonFormField<String>(
                    initialValue: method.isEmpty ? 'open' : method,
                    decoration:
                        InputDecoration(labelText: l10n.transportMethod),
                    items: const [
                      DropdownMenuItem(value: 'open', child: Text('Open')),
                      DropdownMenuItem(
                          value: 'enclosed', child: Text('Enclosed')),
                    ],
                    onChanged: (value) =>
                        setSheetState(() => method = value ?? method),
                  ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: () {
                      // Send only what changed - a full resubmission would
                      // look like an edit and void every quote.
                      final result = <String, Object?>{};
                      void put(String key, Object? next, Object? before) {
                        if (next.toString().trim() !=
                            before.toString().trim()) {
                          result[key] = next;
                        }
                      }

                      put('customerPhone', phone.text.trim(),
                          request.customerPhone);
                      put(
                        'pickupAddress',
                        wantsPickup ? pickupAddress.text.trim() : '',
                        request.pickupAddress,
                      );
                      put('notes', notes.text.trim(), request.notes);
                      put('pickupArea', pickupArea.text.trim(),
                          request.pickupArea);
                      put('carMake', make ?? '', request.carMake);
                      put('carModel', model ?? '', request.carModel);
                      put('carYear', year ?? '', request.carYear);
                      if (country != null) {
                        put('destinationCountryId', country!.id,
                            request.destinationCountryId);
                      }
                      if (operable != request.vehicleOperable) {
                        result['vehicleOperable'] = operable;
                      }
                      if (method != request.requestedTransportMethod) {
                        result['requestedTransportMethod'] = method;
                      }
                      Navigator.of(sheetContext).pop(result);
                    },
                    child: Text(l10n.save),
                  ),
                  const SizedBox(height: 10),
                ],
              ),
            );
          },
        ),
      ),
    );

    phone.dispose();
    pickupAddress.dispose();
    notes.dispose();
    pickupArea.dispose();
    if (patch != null && mounted) await _saveEdit(patch);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    if (widget.request.quoteStatus == 'cancelled') {
      return _QuoteNotice(
        icon: Icons.cancel_outlined,
        title: l10n.transportRequestCancelled,
        message: l10n.transportRequestCancelledSubtitle,
      );
    }
    if (widget.request.hasSelectedQuote) {
      final price = NumberFormat.simpleCurrency(
        name: widget.request.currency.toUpperCase(),
      ).format(widget.request.selectedAmountCents / 100);
      if (widget.request.awaitingPayment) {
        // Accepted but unpaid: the customer owes an action before the
        // carrier can start, so this is a call to action, not a notice.
        final total = NumberFormat.simpleCurrency(
          name: widget.request.currency.toUpperCase(),
        ).format(
          (widget.request.totalCents > 0
                  ? widget.request.totalCents
                  : widget.request.selectedAmountCents) /
              100,
        );
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _QuoteNotice(
              icon: Icons.lock_clock_outlined,
              title: l10n.transportPaymentTitle,
              message: l10n.transportPaymentBody(total),
            ),
            if (_error.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                _error,
                style: TextStyle(
                  color: Theme.of(context).colorScheme.error,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _paying ? null : () => _payForJob(),
              icon: _paying
                  ? const SizedBox(
                      height: 16,
                      width: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.lock_outline),
              label: Text(l10n.transportPayNow),
            ),
          ],
        );
      }
      return _QuoteNotice(
        icon: Icons.verified_outlined,
        title: l10n.transportQuoteSelectedTitle,
        message: l10n.transportQuoteSelectedMessage(
          widget.request.businessName.isNotEmpty
              ? widget.request.businessName
              : widget.request.selectedBusinessId,
          price,
        ),
      );
    }

    return StreamBuilder<List<TransportQuote>>(
      stream: _service.watchQuotes(widget.request.id),
      builder: (context, snapshot) {
        final quotes = snapshot.data ?? const <TransportQuote>[];
        final activeQuotes = quotes
            .where((quote) => quote.isSubmitted && !quote.isExpired)
            .toList();
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.cream,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppColors.rule),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.transportQuotesTitle,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                l10n.transportQuotesIntro,
                style: const TextStyle(color: AppColors.muted, height: 1.35),
              ),
              if (_error.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  _error,
                  style: TextStyle(
                    color: Theme.of(context).colorScheme.error,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
              if (snapshot.hasError) ...[
                const SizedBox(height: 14),
                Text(l10n.couldNotLoadTransportQuotes),
              ] else if (!snapshot.hasData) ...[
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: CircularProgressIndicator()),
                ),
              ] else if (activeQuotes.isEmpty) ...[
                const SizedBox(height: 16),
                _QuoteNotice(
                  icon: Icons.schedule_outlined,
                  title: l10n.waitingForTransportQuotes,
                  message: l10n.waitingForTransportQuotesSubtitle,
                  compact: true,
                ),
              ] else ...[
                const SizedBox(height: 14),
                for (final quote in activeQuotes) ...[
                  _TransportQuoteCard(
                    quote: quote,
                    selecting: _selectingQuoteId == quote.id,
                    onSelect: () => _selectQuote(quote),
                  ),
                  if (quote != activeQuotes.last) const SizedBox(height: 12),
                ],
              ],
              const SizedBox(height: 14),
              // Editing stays available for as long as quotes are being
              // collected - the window closes when a quote is selected.
              if (_canCustomerEdit(context.read<AuthProvider>())) ...[
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.tonalIcon(
                    onPressed: _savingEdit || _cancelling ||
                            _selectingQuoteId.isNotEmpty
                        ? null
                        : _openEditSheet,
                    icon: const Icon(Icons.edit_outlined),
                    label: Text(l10n.editTransportRequest),
                  ),
                ),
                const SizedBox(height: 10),
              ],
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: _cancelling || _savingEdit ||
                          _selectingQuoteId.isNotEmpty
                      ? null
                      : _cancelRequest,
                  child: Text(
                    _cancelling
                        ? l10n.cancellingTransportRequest
                        : l10n.cancelTransportRequest,
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _TransportQuoteCard extends StatelessWidget {
  const _TransportQuoteCard({
    required this.quote,
    required this.selecting,
    required this.onSelect,
  });

  final TransportQuote quote;
  final bool selecting;
  final VoidCallback onSelect;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = Localizations.localeOf(context).toLanguageTag();
    final dateFormat = DateFormat.yMMMd(locale);
    final price = NumberFormat.simpleCurrency(
      name: quote.currency.toUpperCase(),
    ).format(quote.amount);
    final details = <MapEntry<String, String>>[
      if (quote.estimatedPickupDate != null)
        MapEntry(
          l10n.estimatedPickup,
          dateFormat.format(quote.estimatedPickupDate!),
        ),
      if (quote.estimatedDeliveryDate != null)
        MapEntry(
          l10n.estimatedDelivery,
          dateFormat.format(quote.estimatedDeliveryDate!),
        ),
      if (quote.transportMethod.isNotEmpty)
        MapEntry(
          l10n.transportMethod,
          quote.transportMethod == 'enclosed'
              ? l10n.enclosedTransport
              : l10n.openTransport,
        ),
    ];

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.cobalt.withValues(alpha: 0.28)),
        boxShadow: [
          BoxShadow(
            color: AppColors.cobaltDeep.withValues(alpha: 0.06),
            blurRadius: 16,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(9),
                decoration: BoxDecoration(
                  color: AppColors.mist,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.local_shipping_outlined,
                  color: AppColors.cobalt,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      quote.businessName,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                    Text(
                      price,
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w900,
                        color: AppColors.cobalt,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          for (final detail in details)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      detail.key,
                      style: const TextStyle(color: AppColors.muted),
                    ),
                  ),
                  Text(
                    detail.value,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ],
              ),
            ),
          if (quote.terms.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              quote.terms,
              style: const TextStyle(color: AppColors.ink, height: 1.35),
            ),
          ],
          const SizedBox(height: 14),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: selecting ? null : onSelect,
              child: Text(
                selecting
                    ? l10n.selectingTransportQuote
                    : l10n.selectTransportQuote,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _QuoteNotice extends StatelessWidget {
  const _QuoteNotice({
    required this.icon,
    required this.title,
    required this.message,
    this.compact = false,
  });

  final IconData icon;
  final String title;
  final String message;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(compact ? 14 : 18),
      decoration: BoxDecoration(
        color: AppColors.mist.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: AppColors.cobalt),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  message,
                  style: const TextStyle(color: AppColors.muted, height: 1.35),
                ),
              ],
            ),
          ),
        ],
      ),
    );
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
          .map(
            (item) => DropdownMenuItem<String>(value: item, child: Text(item)),
          )
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
      trailing: const Icon(Icons.calendar_today, color: AppColors.brandRed),
      onTap: enabled ? onTap : null,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.grey.shade300),
      ),
    );
  }
}

/// Read-only summary of what a customer submitted (contact, pickup, notes) so
/// the business has what it needs to send back a price quote. Only shows for
/// customer-submitted requests that carry this info.
class _CustomerRequestInfo extends StatelessWidget {
  const _CustomerRequestInfo({required this.request});

  final TransportRequest request;

  @override
  Widget build(BuildContext context) {
    final isCustomerRequest = request.customerUid != null;
    final hasDetails =
        request.customerPhone.isNotEmpty ||
        request.pickupAddress.isNotEmpty ||
        request.notes.isNotEmpty;
    if (!isCustomerRequest && !hasDetails) {
      return const SizedBox.shrink();
    }

    final l10n = AppLocalizations.of(context)!;
    final rows = <Widget>[];
    void add(IconData icon, String label, String value) {
      if (value.trim().isEmpty) return;
      rows.add(
        Padding(
          padding: const EdgeInsets.only(top: 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 18, color: AppColors.cobalt),
              const SizedBox(width: 10),
              Expanded(
                child: RichText(
                  text: TextSpan(
                    style: const TextStyle(
                      color: AppColors.ink,
                      fontSize: 13.5,
                    ),
                    children: [
                      TextSpan(
                        text: '$label  ',
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          color: AppColors.muted,
                        ),
                      ),
                      TextSpan(text: value),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }

    add(Icons.phone_outlined, l10n.phoneNumber, request.customerPhone);
    add(Icons.map_outlined, l10n.pickupArea, request.pickupArea);
    add(Icons.place_outlined, l10n.pickup, request.pickupAddress);
    if (request.usesQuoteMarketplace) {
      add(
        Icons.car_repair_outlined,
        l10n.vehicleCondition,
        request.vehicleOperable
            ? l10n.vehicleRunsAndDrives
            : l10n.vehicleInoperable,
      );
      add(
        Icons.local_shipping_outlined,
        l10n.preferredTransportMethod,
        request.requestedTransportMethod == 'enclosed'
            ? l10n.enclosedTransport
            : l10n.openTransport,
      );
    }
    add(Icons.notes_outlined, l10n.additionalNotes, request.notes);

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.mist.withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                l10n.customerRequest,
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
              const Spacer(),
              if (request.awaitingQuote)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.saffron.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    l10n.awaitingQuote,
                    style: const TextStyle(
                      color: AppColors.warn,
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                  ),
                ),
            ],
          ),
          ...rows,
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                l10n.setPriceQuoteInstruction,
                style: const TextStyle(color: AppColors.muted, fontSize: 13),
              ),
            ),
        ],
      ),
    );
  }
}
