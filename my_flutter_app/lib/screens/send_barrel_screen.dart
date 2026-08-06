import 'dart:async';

import 'package:flutter/material.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../providers/app_gate_provider.dart';
import '../providers/auth_provider.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';
import '../models/business_destination_option.dart';
import '../models/barrel_order.dart';
import '../models/destination_country.dart';
import '../models/structured_address.dart';
import '../services/barrel_pricing_service.dart';
import '../services/barrel_shipment_service.dart';
import '../services/business_service.dart';
import '../services/payment_flow_safety.dart';
import '../utils/barrel_receipt_generator.dart';
import '../utils/action_confirmation.dart';
import '../utils/nyc_borough.dart';
import '../utils/receiver_phone_rules.dart';
import '../widgets/business_reviews_sheet.dart';
import '../widgets/rating_summary_badge.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/recipient_name_field.dart';
import '../widgets/country_phone_field.dart';
import '../widgets/destination_country_field.dart';
import '../widgets/marketplace_transaction_disclosure.dart';
import '../widgets/office_location_picker.dart';
import '../widgets/structured_address_fields.dart';
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
  // Street line only. The rest of the address lives in _pickupAddress; the
  // composed line is what reaches the callables.
  final _pickupAddressController = TextEditingController();
  StructuredAddress _pickupAddress = StructuredAddress.empty;
  final _shipmentService = BarrelShipmentService();
  final List<BarrelOrderLine> _orderLines = [];
  BarrelPickupPricing _pickupPricing = BarrelPickupPricing.defaultPricing;
  bool _pickupRequested = true;
  bool _useDifferentPickupDetails = false;
  // Office location for the shared (non-per-line) drop-off case, keyed to
  // the first destination's business — the common single-business order.
  String _sharedOfficeLocationId = '';
  bool _isSubmitting = false;
  String _pickupBorough = 'Bronx';
  DateTime? _pickupDateTime;
  // Server-quoted shared pickup fee (per line). Null = not quoted yet, which
  // keeps the pay button disabled - the client never invents a fee.
  double? _sharedPickupQuotedFee;
  bool _sharedPickupQuoting = false;
  String? _sharedPickupQuoteError;
  Timer? _sharedPickupDebounce;
  int _sharedPickupQuoteId = 0;
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
    });
  }

  @override
  void dispose() {
    _sharedPickupDebounce?.cancel();
    _heroController.dispose();
    _senderNameController.dispose();
    _pickupAddressController.dispose();
    super.dispose();
  }

  double get _shippingFee =>
      _orderLines.fold(0, (total, line) => total + line.shippingFee);
  int get _billableLineCount => _orderLines.length;
  int get _totalBarrels =>
      _orderLines.fold(0, (total, line) => total + line.quantity);
  bool get _canUseDifferentPickupDetails =>
      _totalBarrels > 1 && _orderLines.length > 1;
  bool get _usesDifferentPickupDetails =>
      _canUseDifferentPickupDetails && _useDifferentPickupDetails;
  double get _sharedPickupFee =>
      _pickupRequested ? (_sharedPickupQuotedFee ?? 0) : 0;
  double get _pickupFee => _usesDifferentPickupDetails
      ? _orderLines.fold(0, (total, line) => total + line.pickupFee)
      : _sharedPickupFee * _billableLineCount;
  double get _estimatedTotal => _shippingFee + _pickupFee;
  bool get _needsPriceReview =>
      _shippingFee <= 0 ||
      (_usesDifferentPickupDetails
          ? _orderLines.any(
              (line) => line.pickupRequested && line.pickupFee <= 0,
            )
          : (_pickupRequested &&
                (_sharedPickupQuoting ||
                    _sharedPickupQuoteError != null ||
                    _sharedPickupQuotedFee == null)));
  bool get _canPay => _orderLines.isNotEmpty && !_needsPriceReview;

  void _handlePickupAddressChanged(
    StructuredAddress address,
    BarrelAddressSuggestion? suggestion,
  ) {
    // The borough shown here is a hint only; the server's geocoded answer in
    // the quote still overrides it, because whoever supplies the borough
    // chooses the price.
    final borough =
        suggestion?.borough ?? nycBoroughFromAddress(address.composeLine());
    setState(() {
      _pickupAddress = address;
      if (borough != null && borough.isNotEmpty) _pickupBorough = borough;
    });
    _scheduleSharedPickupQuote();
  }

  /// Debounced server quote for the shared pickup address. The business's
  /// plan prices the pickup; the client only displays the result.
  void _scheduleSharedPickupQuote() {
    _sharedPickupDebounce?.cancel();
    _sharedPickupQuoteId++;
    final address = _pickupAddress.composeLine();
    if (!_pickupRequested || _usesDifferentPickupDetails || address.isEmpty) {
      setState(() {
        _sharedPickupQuotedFee = null;
        _sharedPickupQuoting = false;
        _sharedPickupQuoteError = null;
      });
      return;
    }
    setState(() {
      _sharedPickupQuoting = true;
      _sharedPickupQuoteError = null;
      _sharedPickupQuotedFee = null;
    });
    _sharedPickupDebounce = Timer(
      const Duration(milliseconds: 700),
      _requestSharedPickupQuote,
    );
  }

  Future<void> _requestSharedPickupQuote() async {
    final businessId = _orderLines.isNotEmpty
        ? _orderLines.first.business.businessId
        : '';
    final address = _pickupAddress.composeLine();
    final l10n = AppLocalizations.of(context)!;
    if (businessId.isEmpty || address.isEmpty) {
      setState(() => _sharedPickupQuoting = false);
      return;
    }
    final quoteId = ++_sharedPickupQuoteId;
    try {
      final quote = await _shipmentService.quoteBarrelPickup(
        businessId: businessId,
        pickupAddress: address,
      );
      if (!mounted || quoteId != _sharedPickupQuoteId) return;
      setState(() {
        _sharedPickupQuoting = false;
        if (quote.available) {
          _sharedPickupQuotedFee = quote.fee;
          if (quote.borough.isNotEmpty) _pickupBorough = quote.borough;
        } else {
          _sharedPickupQuoteError = l10n.pickupBusinessUnavailable;
        }
      });
    } catch (_) {
      if (!mounted || quoteId != _sharedPickupQuoteId) return;
      setState(() {
        _sharedPickupQuoting = false;
        _sharedPickupQuoteError = l10n.pickupAddressQuoteFailed;
      });
    }
  }

  Future<void> _openDestinationEditor({int? editIndex}) async {
    final result = await showModalBottomSheet<BarrelOrderLine>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => _DestinationEditorSheet(
        initial: editIndex != null ? _orderLines[editIndex] : null,
        ordinal: (editIndex ?? _orderLines.length) + 1,
        pickupPricing: _pickupPricing,
        shipmentService: _shipmentService,
        collectPickupDetails: _usesDifferentPickupDetails,
      ),
    );
    if (result == null || !mounted) return;
    setState(() {
      if (editIndex != null) {
        _orderLines[editIndex] = result;
      } else {
        _orderLines.add(result);
      }
      if (!_canUseDifferentPickupDetails) {
        _useDifferentPickupDetails = false;
      }
    });
    _scheduleSharedPickupQuote();
  }

  void _removeDestinationLine(int index) {
    setState(() {
      _orderLines.removeAt(index);
      if (!_canUseDifferentPickupDetails) {
        _useDifferentPickupDetails = false;
      }
    });
    _scheduleSharedPickupQuote();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    if (_orderLines.isEmpty) {
      showErrorSnackBar(
        context,
        AppLocalizations.of(context)!.addAtLeastOneDestination,
      );
      return;
    }
    if (_usesDifferentPickupDetails &&
        _orderLines.any(
          (line) =>
              !line.hasPickupOverride ||
              (line.pickupRequested &&
                  (line.pickupAddress.trim().isEmpty ||
                      line.pickupBorough.trim().isEmpty ||
                      line.pickupDateTime == null)),
        )) {
      showErrorSnackBar(
        context,
        AppLocalizations.of(context)!.destinationPickupDetailsRequired,
      );
      return;
    }
    final isReady = await _ensureCustomerAccount();
    if (!isReady || !mounted) return;
    _prefillSenderName();

    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.requestBarrelShipmentQuestion,
      message: l10n.requestBarrelShipmentMessage,
      confirmLabel: l10n.payAndRequest,
      icon: Icons.local_shipping_outlined,
    );
    if (!confirmed || !mounted) return;

    final providerNames = _orderLines
        .map((line) => line.business.businessName.trim())
        .where((name) => name.isNotEmpty)
        .toSet()
        .join(', ');
    final marketplaceAcceptance = await confirmMarketplaceTransaction(
      context,
      providerNames: providerNames,
      transactionSummary: l10n.sendBarrels,
    );
    if (marketplaceAcceptance == null || !mounted) return;

    setState(() {
      _isSubmitting = true;
    });

    try {
      // Office location always travels per line (it depends on that line's
      // own business), even when pickup itself is shared across the order.
      final lines = _usesDifferentPickupDetails
          ? List.of(_orderLines)
          : _orderLines
                .map((line) => line.copyWith(officeLocationId: _sharedOfficeLocationId))
                .toList();
      final order = await _shipmentService.payForOrder(
        senderName: _senderNameController.text.trim(),
        lines: lines,
        pickupRequested: _usesDifferentPickupDetails ? null : _pickupRequested,
        pickupAddress: _usesDifferentPickupDetails
            ? null
            : (_pickupRequested
                  ? _pickupAddress.composeLine()
                  : _pickupPricing.officeAddress),
        pickupBorough: _usesDifferentPickupDetails
            ? null
            : (_pickupRequested ? _pickupBorough : 'Office drop-off'),
        pickupDateTime: _usesDifferentPickupDetails
            ? null
            : (_pickupRequested ? _pickupDateTime : null),
        marketplaceAcceptance: marketplaceAcceptance,
      );
      final receiptOpened = await runBestEffortPostPaymentAction(
        () => generateBarrelOrderReceipt(
          orderId: order.orderId,
          shipments: order.shipments,
        ),
      );

      if (!mounted) return;
      final trackingLabel = order.trackingCodes.join(', ');
      showSuccessSnackBar(
        context,
        receiptOpened
            ? AppLocalizations.of(
                context,
              )!.shipmentSavedWithTracking(trackingLabel)
            : AppLocalizations.of(
                context,
              )!.shipmentSavedReceiptUnavailable(trackingLabel),
      );
      if (widget.showBackButton) {
        Navigator.of(context).pop();
      } else {
        _formKey.currentState?.reset();
        _senderNameController.clear();
        _pickupAddressController.clear();
        _prefillSenderName();
        setState(() {
          _pickupAddress = StructuredAddress.empty;
          _orderLines.clear();
          _pickupRequested = true;
          _useDifferentPickupDetails = false;
          _pickupDateTime = null;
          _pickupBorough = 'Bronx';
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
              Text(l10n.signInToSaveBarrelShipment),
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
    if (error is BarrelOrderPaymentFunctionMissingException) {
      return 'Multiple destinations need the barrel order payment function to be deployed. Deploy Firebase Functions, then try this order again.';
    }
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
                      const AppBackButton(onDarkBackground: true)
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
                          if (context.watch<AppGateProvider>().sharedBarrelsEnabled) ...[
                            _SharedBarrelCard(
                              onTap: () =>
                                  Navigator.pushNamed(context, '/open-barrels'),
                            ),
                            const SizedBox(height: 18),
                          ],
                          Form(
                            key: _formKey,
                            child: Column(
                              children: [
                                _FormSection(
                                  icon: Icons.person_outline,
                                  title: l10n.sender,
                                  subtitle: l10n.senderQuestion,
                                  children: [
                                    BarrelTextFormField(
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
                                  icon: Icons.public_outlined,
                                  title: l10n.destinationsTitle,
                                  subtitle: _orderLines.isEmpty
                                      ? l10n.barrelDestinationStartSummary
                                      : l10n.barrelDestinationSummary(
                                          _totalBarrels,
                                          _orderLines.length,
                                        ),
                                  children: [
                                    if (_orderLines.isEmpty)
                                      _EmptyDestinations(
                                        onAdd: () => _openDestinationEditor(),
                                      )
                                    else ...[
                                      _DestinationCart(
                                        lines: _orderLines,
                                        showPickupDetails:
                                            _usesDifferentPickupDetails,
                                        onEdit: (index) =>
                                            _openDestinationEditor(
                                              editIndex: index,
                                            ),
                                        onRemove: _removeDestinationLine,
                                      ),
                                      const SizedBox(height: 12),
                                      _AddDestinationButton(
                                        label: l10n.addAnotherDestination,
                                        onPressed: () =>
                                            _openDestinationEditor(),
                                      ),
                                      const SizedBox(height: 14),
                                      _PriceEstimateCard(
                                        shippingFee: _shippingFee,
                                        pickupFee: _pickupFee,
                                        lineCount: _billableLineCount,
                                        total: _estimatedTotal,
                                        needsReview: _needsPriceReview,
                                      ),
                                    ],
                                  ],
                                ),
                                if (_orderLines.isNotEmpty) ...[
                                  const SizedBox(height: 14),
                                  _FormSection(
                                    icon: Icons.local_shipping_outlined,
                                    title: l10n.pickup,
                                    subtitle: _usesDifferentPickupDetails
                                        ? l10n.destinationPickupDetailsHelp
                                        : (_pickupRequested
                                              ? l10n.pickupCollectNyc
                                              : l10n.pickupBringOffice),
                                    children: [
                                      if (_canUseDifferentPickupDetails) ...[
                                        _PickupScopeChoice(
                                          useDifferentPickupDetails:
                                              _usesDifferentPickupDetails,
                                          onChanged: (value) {
                                            setState(
                                              () => _useDifferentPickupDetails =
                                                  value,
                                            );
                                            _formKey.currentState?.validate();
                                          },
                                        ),
                                        const SizedBox(height: 14),
                                      ],
                                      if (_usesDifferentPickupDetails)
                                        Text(
                                          l10n.editDestinationPickupHelp,
                                          style: const TextStyle(
                                            color: AppColors.muted,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        )
                                      else ...[
                                        _PickupChoice(
                                          pickupRequested: _pickupRequested,
                                          officeAddress:
                                              _pickupPricing.officeAddress,
                                          onChanged: (value) {
                                            setState(
                                              () => _pickupRequested = value,
                                            );
                                            _scheduleSharedPickupQuote();
                                            _formKey.currentState?.validate();
                                          },
                                        ),
                                        const SizedBox(height: 14),
                                        AnimatedSwitcher(
                                          duration: const Duration(
                                            milliseconds: 220,
                                          ),
                                          switchInCurve: Curves.easeOutCubic,
                                          switchOutCurve: Curves.easeInCubic,
                                          child: _pickupRequested
                                              ? Column(
                                                  key: const ValueKey(
                                                    'shared-pickup',
                                                  ),
                                                  children: [
                                                    StructuredAddressFields(
                                                      controller:
                                                          _pickupAddressController,
                                                      value: _pickupAddress,
                                                      fetchSuggestions:
                                                          _shipmentService
                                                              .addressSuggestions,
                                                      onChanged:
                                                          _handlePickupAddressChanged,
                                                      showLocateMe: true,
                                                      streetValidator: (value) {
                                                        if (_usesDifferentPickupDetails ||
                                                            !_pickupRequested) {
                                                          return null;
                                                        }
                                                        if (value == null ||
                                                            value
                                                                .trim()
                                                                .isEmpty) {
                                                          return l10n
                                                              .pleaseEnterPickupAddress;
                                                        }
                                                        // The server quote
                                                        // decides coverage;
                                                        // no NYC-only rule.
                                                        return null;
                                                      },
                                                    ),
                                                    if (_sharedPickupQuoting) ...[
                                                      const SizedBox(
                                                        height: 8,
                                                      ),
                                                      Row(
                                                        children: [
                                                          const SizedBox(
                                                            width: 14,
                                                            height: 14,
                                                            child:
                                                                CircularProgressIndicator(
                                                                  strokeWidth:
                                                                      2,
                                                                ),
                                                          ),
                                                          const SizedBox(
                                                            width: 8,
                                                          ),
                                                          Text(
                                                            l10n.freightPickupCalculating,
                                                          ),
                                                        ],
                                                      ),
                                                    ] else if (_sharedPickupQuoteError !=
                                                        null) ...[
                                                      const SizedBox(
                                                        height: 8,
                                                      ),
                                                      Text(
                                                        _sharedPickupQuoteError!,
                                                        style: const TextStyle(
                                                          color: AppColors
                                                              .errorRed,
                                                          fontWeight:
                                                              FontWeight.w700,
                                                        ),
                                                      ),
                                                    ],
                                                    const SizedBox(height: 14),
                                                    _PickupDateTimeTile(
                                                      value: _pickupDateTime,
                                                      onTap:
                                                          _pickPickupDateTime,
                                                      validator: () {
                                                        if (_usesDifferentPickupDetails ||
                                                            !_pickupRequested) {
                                                          return null;
                                                        }
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
                                              : OfficeLocationPicker(
                                                  key: const ValueKey(
                                                    'shared-dropoff',
                                                  ),
                                                  businessId: _orderLines
                                                          .isNotEmpty
                                                      ? _orderLines
                                                            .first
                                                            .business
                                                            .businessId
                                                      : '',
                                                  fallbackAddress:
                                                      _orderLines.isNotEmpty
                                                      ? (_orderLines
                                                                .first
                                                                .business
                                                                .businessAddress ??
                                                            '')
                                                      : '',
                                                  selectedLocationId:
                                                      _sharedOfficeLocationId,
                                                  onChanged: (value) => setState(
                                                    () =>
                                                        _sharedOfficeLocationId =
                                                            value,
                                                  ),
                                                ),
                                        ),
                                      ],
                                    ],
                                  ),
                                ],
                                const SizedBox(height: 14),
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
                    fontSize: 18,
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

class _SharedBarrelCard extends StatelessWidget {
  const _SharedBarrelCard({required this.onTap});

  final VoidCallback onTap;

  String _copy(BuildContext context, String en, String fr) {
    return Localizations.localeOf(context).languageCode == 'fr' ? fr : en;
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: const Color(0xFFE6FFFA),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(
                  Icons.group_add_outlined,
                  color: Color(0xFF0D9488),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _copy(
                        context,
                        "Can't fill a barrel?",
                        "Vous ne remplissez pas un baril ?",
                      ),
                      style: const TextStyle(
                        fontWeight: FontWeight.w900,
                        fontSize: 16,
                        color: Color(0xFF0F172A),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _copy(
                        context,
                        'Join an open shared barrel or reserve a share.',
                        'Rejoignez un baril partagé ouvert ou réservez une part.',
                      ),
                      style: const TextStyle(
                        color: Color(0xFF64748B),
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.arrow_forward_ios_rounded, size: 16),
            ],
          ),
        ),
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
        final l10n = AppLocalizations.of(context)!;
        if (snapshot.hasError) {
          return _InlineNotice(message: l10n.businessOptionsUnavailable);
        }
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final options = snapshot.data!;
        if (options.isEmpty) {
          return _InlineNotice(
            message: l10n.noApprovedBusinessShippingDestination,
          );
        }
        final selectedOption =
            value != null && options.any((option) => option.id == value!.id)
            ? value
            : null;
        // One business serves this country: choosing from a list of one is
        // busywork, so make the choice for them.
        if (selectedOption == null && options.length == 1) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            onChanged(options.first);
          });
        }

        return FormField<BusinessDestinationOption>(
          key: ValueKey('business-options-$countryId-${selectedOption?.id}'),
          initialValue: selectedOption,
          validator: (option) =>
              option == null ? l10n.pleaseChooseBusiness : null,
          builder: (field) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.businessesShippingToCountry,
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
    final destinationNote = option.country.destinationNote?.trim() ?? '';
    final deliveryEstimate = option.country.barrelShippingDeliveryEstimateLabel;

    return Semantics(
      button: true,
      selected: selected,
      inMutuallyExclusiveGroup: true,
      child: InkWell(
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
              Text(
                option.country.flagEmoji,
                style: const TextStyle(fontSize: 22),
              ),
              const SizedBox(width: 8),
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
                    if (option.reviewCount > 0) ...[
                      const SizedBox(height: 2),
                      RatingSummaryBadge(
                        average: option.reviewAverage,
                        count: option.reviewCount,
                        onTap: () => showBusinessReviewsSheet(
                          context,
                          businessId: option.businessId,
                          businessName: option.businessName,
                        ),
                      ),
                    ],
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
                    if (destinationNote.isNotEmpty)
                      Text(
                        destinationNote,
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
                        child: BarrelDeliveryEstimateChip(
                          label: deliveryEstimate,
                        ),
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
      ),
    );
  }
}

class BarrelDeliveryEstimateChip extends StatelessWidget {
  const BarrelDeliveryEstimateChip({super.key, required this.label});

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
          Flexible(
            child: Text(
              AppLocalizations.of(context)!.deliveryLabel(label),
              maxLines: 2,
              softWrap: true,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.sage,
                fontSize: 12,
                fontWeight: FontWeight.w800,
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
    final l10n = AppLocalizations.of(context)!;
    return CheckboxListTile(
      value: value,
      onChanged: (checked) => onChanged(checked ?? false),
      contentPadding: EdgeInsets.zero,
      dense: true,
      controlAffinity: ListTileControlAffinity.leading,
      title: Text(
        l10n.receiverWhatsAppNumberTitle,
        style: const TextStyle(fontWeight: FontWeight.w700),
      ),
      subtitle: Text(l10n.receiverWhatsAppNumberSubtitle),
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

class _PickupScopeChoice extends StatelessWidget {
  const _PickupScopeChoice({
    required this.useDifferentPickupDetails,
    required this.onChanged,
  });

  final bool useDifferentPickupDetails;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return SizedBox(
      width: double.infinity,
      child: SegmentedButton<bool>(
        segments: [
          ButtonSegment<bool>(
            value: false,
            icon: const Icon(Icons.event_repeat_outlined),
            label: Text(l10n.samePickup),
          ),
          ButtonSegment<bool>(
            value: true,
            icon: const Icon(Icons.edit_location_alt_outlined),
            label: Text(l10n.differentPickups),
          ),
        ],
        selected: {useDifferentPickupDetails},
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

class _PickupDateTimeTile extends FormField<DateTime> {
  _PickupDateTimeTile({
    required DateTime? value,
    required VoidCallback onTap,
    required String? Function() validator,
  }) : super(
         initialValue: value,
         validator: (_) => validator(),
         builder: (state) {
           final l10n = AppLocalizations.of(state.context)!;
           final formatted = value == null
               ? l10n.choosePickupDateAndTime
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
                   title: Text(
                     l10n.pickupDateAndTime,
                     style: const TextStyle(fontWeight: FontWeight.w700),
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

class _QuantityStepper extends StatelessWidget {
  const _QuantityStepper({required this.value, required this.onChanged});

  final int value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.lightSurfaceVariant,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        children: [
          const Icon(Icons.inventory_2_outlined, color: AppColors.cobaltDeep),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              l10n.barrelsForThisDestination,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
          IconButton.filledTonal(
            tooltip: l10n.decrease,
            onPressed: value <= 1 ? null : () => onChanged(value - 1),
            icon: const Icon(Icons.remove),
          ),
          SizedBox(
            width: 42,
            child: Text(
              value.toString(),
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
          ),
          IconButton.filledTonal(
            tooltip: l10n.increase,
            onPressed: value >= 20 ? null : () => onChanged(value + 1),
            icon: const Icon(Icons.add),
          ),
        ],
      ),
    );
  }
}

class _DestinationCart extends StatelessWidget {
  const _DestinationCart({
    required this.lines,
    required this.showPickupDetails,
    required this.onEdit,
    required this.onRemove,
  });

  final List<BarrelOrderLine> lines;
  final bool showPickupDetails;
  final ValueChanged<int> onEdit;
  final ValueChanged<int> onRemove;

  @override
  Widget build(BuildContext context) {
    final currency = NumberFormat.simpleCurrency();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var index = 0; index < lines.length; index++) ...[
          _DestinationCartCard(
            line: lines[index],
            price: currency.format(lines[index].lineTotal),
            showPickupDetails: showPickupDetails,
            onEdit: () => onEdit(index),
            onRemove: () => onRemove(index),
          ),
          const SizedBox(height: 8),
        ],
      ],
    );
  }
}

class _DestinationCartCard extends StatelessWidget {
  const _DestinationCartCard({
    required this.line,
    required this.price,
    required this.showPickupDetails,
    required this.onEdit,
    required this.onRemove,
  });

  final BarrelOrderLine line;
  final String price;
  final bool showPickupDetails;
  final VoidCallback onEdit;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final qty = line.quantity;
    return Material(
      color: AppColors.paper,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onEdit,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppColors.rule),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                line.country.flagEmoji,
                style: const TextStyle(fontSize: 24),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      line.country.name,
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      line.business.businessName,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      l10n.barrelCartLine(qty, line.receiverName),
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (showPickupDetails) ...[
                      const SizedBox(height: 4),
                      _PickupSummaryChip(line: line),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    price,
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        tooltip: l10n.edit,
                        visualDensity: VisualDensity.compact,
                        onPressed: onEdit,
                        icon: const Icon(Icons.edit_outlined, size: 18),
                      ),
                      IconButton(
                        tooltip: l10n.remove,
                        visualDensity: VisualDensity.compact,
                        onPressed: onRemove,
                        icon: const Icon(Icons.close, size: 18),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PickupSummaryChip extends StatelessWidget {
  const _PickupSummaryChip({required this.line});

  final BarrelOrderLine line;

  @override
  Widget build(BuildContext context) {
    final label = line.pickupRequested
        ? [
            line.pickupBorough,
            if (line.pickupDateTime != null)
              DateFormat.MMMd().add_jm().format(line.pickupDateTime!),
          ].where((item) => item.trim().isNotEmpty).join(' • ')
        : 'Office drop-off';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.mist,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            line.pickupRequested
                ? Icons.home_work_outlined
                : Icons.storefront_outlined,
            size: 14,
            color: AppColors.cobaltDeep,
          ),
          const SizedBox(width: 5),
          Flexible(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: AppColors.cobaltDeep,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PriceEstimateCard extends StatelessWidget {
  const _PriceEstimateCard({
    required this.shippingFee,
    required this.pickupFee,
    required this.lineCount,
    required this.total,
    required this.needsReview,
  });

  final double shippingFee;
  final double pickupFee;
  final int lineCount;
  final double total;
  final bool needsReview;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final currency = NumberFormat.simpleCurrency();
    final amountDue = total;

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
                  l10n.estimatedCost,
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
                  fontSize: 17,
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
                row(
                  lineCount > 1
                      ? '$lineCount destination shipments'
                      : 'Destination shipment',
                  currency.format(shippingFee),
                ),
                row(
                  pickupFee > 0
                      ? lineCount > 1
                            ? 'Pickup for destination lines'
                            : 'Pickup'
                      : 'Pickup',
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
                          AppLocalizations.of(
                            context,
                          )!.fixedPickupPriceForBorough,
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
              l10n.finalPriceConfirmedByStaff,
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

class BarrelTextFormField extends StatelessWidget {
  const BarrelTextFormField({
    super.key,
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
      autovalidateMode: AutovalidateMode.onUserInteraction,
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

class _AddDestinationButton extends StatelessWidget {
  const _AddDestinationButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton.icon(
        onPressed: onPressed,
        icon: const Icon(Icons.add_location_alt_outlined),
        label: Text(label),
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 14),
          foregroundColor: AppColors.cobaltDeep,
          side: const BorderSide(color: AppColors.cobalt),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
    );
  }
}

class _EmptyDestinations extends StatelessWidget {
  const _EmptyDestinations({required this.onAdd});

  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.lightSurfaceVariant,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: AppColors.cobalt.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(
              Icons.add_location_alt_outlined,
              color: AppColors.cobaltDeep,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            l10n.whereAreBarrelsGoing,
            style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15),
          ),
          const SizedBox(height: 4),
          Text(
            l10n.addDestinationInstruction,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted, height: 1.3),
          ),
          const SizedBox(height: 14),
          _AddDestinationButton(label: l10n.addDestination, onPressed: onAdd),
        ],
      ),
    );
  }
}

class _DestinationEditorSheet extends StatefulWidget {
  const _DestinationEditorSheet({
    required this.initial,
    required this.ordinal,
    required this.pickupPricing,
    required this.shipmentService,
    required this.collectPickupDetails,
  });

  final BarrelOrderLine? initial;
  final int ordinal;
  final BarrelPickupPricing pickupPricing;
  final BarrelShipmentService shipmentService;
  final bool collectPickupDetails;

  @override
  State<_DestinationEditorSheet> createState() =>
      _DestinationEditorSheetState();
}

class _DestinationEditorSheetState extends State<_DestinationEditorSheet> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _receiverNameController;
  late final TextEditingController _receiverPhoneController;
  late final TextEditingController _pickupAddressController;
  StructuredAddress _pickupAddress = StructuredAddress.empty;
  DestinationCountry? _country;
  BusinessDestinationOption? _business;
  int _quantity = 1;
  bool _receiverPhoneIsWhatsappOnly = false;
  bool _pickupRequested = true;
  String _pickupBorough = 'Bronx';
  DateTime? _pickupDateTime;
  String _officeLocationId = '';
  // Server-quoted per-line pickup fee. Null = not quoted; the sheet refuses
  // to save a pickup line without a server price.
  double? _quotedPickupFee;
  bool _pickupQuoting = false;
  String? _pickupQuoteError;
  Timer? _pickupQuoteDebounce;
  int _pickupQuoteId = 0;

  @override
  void initState() {
    super.initState();
    final initial = widget.initial;
    _quotedPickupFee =
        (widget.initial?.hasPickupOverride ?? false) &&
            (widget.initial?.pickupRequested ?? false) &&
            (widget.initial?.pickupFee ?? 0) > 0
        ? widget.initial!.pickupFee
        : null;
    _receiverNameController = TextEditingController(
      text: initial?.receiverName ?? '',
    );
    _receiverPhoneController = TextEditingController(
      text: initial?.receiverPhone ?? '',
    );
    // A saved line only kept the composed string, so it reopens as the street
    // line the customer can split by hand — better than a blank form.
    _pickupAddressController = TextEditingController(
      text: initial?.pickupAddress ?? '',
    );
    _pickupAddress = StructuredAddress(
      streetLine: initial?.pickupAddress ?? '',
    );
    _country = initial?.country;
    _business = initial?.business;
    _quantity = initial?.quantity ?? 1;
    _receiverPhoneIsWhatsappOnly =
        initial?.receiverPhoneIsWhatsappOnly ?? false;
    _pickupRequested = initial?.pickupRequested ?? true;
    _pickupBorough = initial?.pickupBorough.isNotEmpty == true
        ? initial!.pickupBorough
        : 'Bronx';
    _pickupDateTime = initial?.pickupDateTime;
    _officeLocationId = initial?.officeLocationId ?? '';
  }

  @override
  void dispose() {
    _pickupQuoteDebounce?.cancel();
    _receiverNameController.dispose();
    _receiverPhoneController.dispose();
    _pickupAddressController.dispose();
    super.dispose();
  }

  bool get _showWhatsapp => ReceiverPhoneRules.isDifferentCountryNumber(
    value: _receiverPhoneController.text,
    destination: _country,
  );

  double get _lineFee => (_country?.barrelShippingPrice ?? 0) * _quantity;
  double get _pickupFee => widget.collectPickupDetails && _pickupRequested
      ? (_quotedPickupFee ?? 0)
      : 0;

  void _handlePickupAddressChanged(
    StructuredAddress address,
    BarrelAddressSuggestion? suggestion,
  ) {
    // A hint only: the server's quote overrides the borough, because whoever
    // supplies the borough chooses the price.
    final borough =
        suggestion?.borough ?? nycBoroughFromAddress(address.composeLine());
    setState(() {
      _pickupAddress = address;
      if (borough != null && borough.isNotEmpty) _pickupBorough = borough;
    });
    _schedulePickupQuote();
  }

  /// Debounced server quote against this line's business.
  void _schedulePickupQuote() {
    _pickupQuoteDebounce?.cancel();
    _pickupQuoteId++;
    final address = _pickupAddress.composeLine();
    if (!widget.collectPickupDetails ||
        !_pickupRequested ||
        _business == null ||
        address.isEmpty) {
      setState(() {
        _quotedPickupFee = null;
        _pickupQuoting = false;
        _pickupQuoteError = null;
      });
      return;
    }
    setState(() {
      _pickupQuoting = true;
      _pickupQuoteError = null;
      _quotedPickupFee = null;
    });
    _pickupQuoteDebounce = Timer(
      const Duration(milliseconds: 700),
      _requestPickupQuote,
    );
  }

  Future<void> _requestPickupQuote() async {
    final business = _business;
    final address = _pickupAddress.composeLine();
    if (business == null || address.isEmpty) {
      setState(() => _pickupQuoting = false);
      return;
    }
    final l10n = AppLocalizations.of(context)!;
    final quoteId = ++_pickupQuoteId;
    try {
      final quote = await widget.shipmentService.quoteBarrelPickup(
        businessId: business.businessId,
        pickupAddress: address,
      );
      if (!mounted || quoteId != _pickupQuoteId) return;
      setState(() {
        _pickupQuoting = false;
        if (quote.available) {
          _quotedPickupFee = quote.fee;
          if (quote.borough.isNotEmpty) _pickupBorough = quote.borough;
        } else {
          _pickupQuoteError = l10n.pickupBusinessUnavailable;
        }
      });
    } catch (_) {
      if (!mounted || quoteId != _pickupQuoteId) return;
      setState(() {
        _pickupQuoting = false;
        _pickupQuoteError = l10n.pickupAddressQuoteFailed;
      });
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

  void _save() {
    if (!_formKey.currentState!.validate()) return;
    final country = _country;
    final business = _business;
    if (country == null || business == null) return;
    if (widget.collectPickupDetails &&
        _pickupRequested &&
        (_pickupQuoting || _quotedPickupFee == null)) {
      // No server price, no save - the client never invents a pickup fee.
      final l10n = AppLocalizations.of(context)!;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_pickupQuoteError ?? l10n.pickupAddressQuoteFailed),
        ),
      );
      return;
    }
    Navigator.of(context).pop(
      BarrelOrderLine(
        country: country,
        business: business,
        receiverName: _receiverNameController.text.trim(),
        receiverPhone: _receiverPhoneController.text.trim(),
        receiverPhoneIsWhatsappOnly:
            _showWhatsapp && _receiverPhoneIsWhatsappOnly,
        quantity: _quantity,
        pickupRequested: _pickupRequested,
        pickupAddress: _pickupRequested
            ? _pickupAddress.composeLine()
            : widget.pickupPricing.officeAddress,
        pickupBorough: _pickupRequested ? _pickupBorough : 'Office drop-off',
        pickupFee: _pickupFee,
        pickupDateTime: _pickupRequested ? _pickupDateTime : null,
        hasPickupOverride: widget.collectPickupDetails,
        officeLocationId:
            widget.collectPickupDetails && !_pickupRequested
                ? _officeLocationId
                : '',
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final media = MediaQuery.of(context);
    final isEditing = widget.initial != null;
    final currency = NumberFormat.simpleCurrency();

    return Padding(
      padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
      child: Container(
        constraints: BoxConstraints(maxHeight: media.size.height * 0.92),
        decoration: const BoxDecoration(
          color: AppColors.lightBg,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 10),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.rule,
                borderRadius: BorderRadius.circular(4),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 12, 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      isEditing
                          ? l10n.editDestination
                          : l10n.destinationNumber(widget.ordinal),
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 16),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      DestinationCountryField(
                        value: _country,
                        label: l10n.destinationCountry,
                        requiredMessage: l10n.requiredField,
                        onChanged: (country) {
                          setState(() {
                            _country = country;
                            _business = null;
                            _officeLocationId = '';
                            if (!_showWhatsapp) {
                              _receiverPhoneIsWhatsappOnly = false;
                            }
                          });
                        },
                      ),
                      if (_country != null) ...[
                        const SizedBox(height: 14),
                        _BusinessOptionSelector(
                          countryId: _country!.id,
                          value: _business,
                          onChanged: (option) {
                            setState(() {
                              _business = option;
                              _officeLocationId = '';
                            });
                            // A different business means a different pickup
                            // plan, so the old quote no longer applies.
                            _schedulePickupQuote();
                          },
                        ),
                      ],
                      const SizedBox(height: 14),
                      RecipientNameField(
                        controller: _receiverNameController,
                        labelText: l10n.receiverName,
                        onRecipientSelected: (recipient) {
                          setState(() {
                            _receiverPhoneController.text = recipient.phone;
                            _receiverPhoneIsWhatsappOnly =
                                recipient.whatsappOnly;
                          });
                        },
                        validator: (value) =>
                            (value == null || value.trim().isEmpty)
                            ? l10n.pleaseEnterReceiverName
                            : null,
                      ),
                      const SizedBox(height: 14),
                      CountryPhoneField(
                        controller: _receiverPhoneController,
                        labelText: l10n.receiverPhone,
                        initialCountryCode: _country?.displayCode ?? 'US',
                        decoration: InputDecoration(
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
                            borderSide: const BorderSide(
                              color: AppColors.errorRed,
                              width: 2,
                            ),
                          ),
                          filled: true,
                          fillColor: AppColors.lightSurfaceVariant,
                        ),
                        onChanged: (_) => setState(() {
                          if (!_showWhatsapp) {
                            _receiverPhoneIsWhatsappOnly = false;
                          }
                        }),
                        validator: (value) => ReceiverPhoneRules.validate(
                          value: value,
                          destination: _country,
                          allowDifferentCountry: _receiverPhoneIsWhatsappOnly,
                          requiredMessage: l10n.pleaseEnterReceiverPhone,
                          invalidPhoneMessage: l10n.invalidPhoneWithCountryCode,
                          invalidInternationalPhoneMessage:
                              l10n.invalidInternationalPhone,
                          whatsAppCountryCodeMessage:
                              l10n.whatsAppDifferentCountryRequiresCode,
                          destinationMismatchMessage:
                              l10n.receiverPhoneMustMatchDestination,
                        ),
                      ),
                      if (_showWhatsapp)
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: _WhatsAppPhoneOption(
                            value: _receiverPhoneIsWhatsappOnly,
                            onChanged: (value) {
                              setState(
                                () => _receiverPhoneIsWhatsappOnly = value,
                              );
                              _formKey.currentState?.validate();
                            },
                          ),
                        ),
                      const SizedBox(height: 14),
                      _QuantityStepper(
                        value: _quantity,
                        onChanged: (value) => setState(() => _quantity = value),
                      ),
                      if (widget.collectPickupDetails) ...[
                        const SizedBox(height: 14),
                        _PickupChoice(
                          pickupRequested: _pickupRequested,
                          officeAddress: widget.pickupPricing.officeAddress,
                          onChanged: (value) {
                            setState(() => _pickupRequested = value);
                            _schedulePickupQuote();
                            _formKey.currentState?.validate();
                          },
                        ),
                        const SizedBox(height: 14),
                        AnimatedSwitcher(
                          duration: const Duration(milliseconds: 220),
                          switchInCurve: Curves.easeOutCubic,
                          switchOutCurve: Curves.easeInCubic,
                          child: _pickupRequested
                              ? Column(
                                  key: const ValueKey('line-pickup'),
                                  children: [
                                    StructuredAddressFields(
                                      controller: _pickupAddressController,
                                      value: _pickupAddress,
                                      fetchSuggestions: widget
                                          .shipmentService
                                          .addressSuggestions,
                                      onChanged: _handlePickupAddressChanged,
                                      streetValidator: (value) {
                                        if (!_pickupRequested) return null;
                                        if (value == null ||
                                            value.trim().isEmpty) {
                                          return l10n.pleaseEnterPickupAddress;
                                        }
                                        // The server quote decides coverage;
                                        // no NYC-only rule.
                                        return null;
                                      },
                                    ),
                                    if (_pickupQuoting) ...[
                                      const SizedBox(height: 8),
                                      Row(
                                        children: [
                                          const SizedBox(
                                            width: 14,
                                            height: 14,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                            ),
                                          ),
                                          const SizedBox(width: 8),
                                          Text(l10n.freightPickupCalculating),
                                        ],
                                      ),
                                    ] else if (_pickupQuoteError != null) ...[
                                      const SizedBox(height: 8),
                                      Text(
                                        _pickupQuoteError!,
                                        style: const TextStyle(
                                          color: AppColors.errorRed,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ],
                                    const SizedBox(height: 14),
                                    _PickupDateTimeTile(
                                      value: _pickupDateTime,
                                      onTap: _pickPickupDateTime,
                                      validator: () {
                                        if (!_pickupRequested) return null;
                                        if (_pickupDateTime == null) {
                                          return l10n
                                              .pleaseChoosePickupDateTime;
                                        }
                                        if (!_pickupDateTime!.isAfter(
                                          DateTime.now(),
                                        )) {
                                          return l10n.pickupTimeFuture;
                                        }
                                        return null;
                                      },
                                    ),
                                  ],
                                )
                              : OfficeLocationPicker(
                                  key: const ValueKey('line-dropoff'),
                                  businessId: _business?.businessId ?? '',
                                  fallbackAddress:
                                      _business?.businessAddress ?? '',
                                  selectedLocationId: _officeLocationId,
                                  onChanged: (value) =>
                                      setState(() => _officeLocationId = value),
                                ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 14),
                child: Row(
                  children: [
                    if (_lineFee + _pickupFee > 0) ...[
                      Text(
                        currency.format(_lineFee + _pickupFee),
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(width: 14),
                    ],
                    Expanded(
                      child: SizedBox(
                        height: 52,
                        child: ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.cobaltDeep,
                            disabledBackgroundColor: AppColors.rule,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                          ),
                          onPressed: _business == null ? null : _save,
                          icon: Icon(isEditing ? Icons.check : Icons.add),
                          label: Text(
                            isEditing ? l10n.saveDestination : l10n.addToOrder,
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
    );
  }
}
