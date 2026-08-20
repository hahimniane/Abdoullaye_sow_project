import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/business_destination_option.dart';
import '../models/business_service.dart';
import '../models/office_location.dart';
import '../models/structured_address.dart';
import '../services/barrel_shipment_service.dart';
import '../services/business_service.dart';
import '../services/freight_categories.dart';
import '../services/freight_coverage.dart';
import '../utils/freight_payback.dart';
import '../services/service_ranking.dart';
import '../services/freight_shipment_service.dart';
import '../services/office_location_service.dart';
import '../utils/freight_localization.dart';
import '../utils/receiver_phone_rules.dart';
import '../widgets/business_reviews_sheet.dart';
import '../widgets/country_phone_field.dart';
import '../widgets/marketplace_transaction_disclosure.dart';
import '../widgets/office_location_picker.dart';
import '../widgets/rating_summary_badge.dart';
import '../widgets/recipient_name_field.dart';
import '../widgets/structured_address_fields.dart';

/// Customer screen to send a parcel/box by freight, priced by weight,
/// by air or sea. Search-first: find a business + destination, then book.
class SendFreightScreen extends StatefulWidget {
  const SendFreightScreen({super.key});

  @override
  State<SendFreightScreen> createState() => _SendFreightScreenState();
}

class _SendFreightScreenState extends State<SendFreightScreen> {
  final _businessService = BusinessService();
  final _freightService = FreightShipmentService();
  // `suggestPickupAddresses` is one callable for every pickup address, not a
  // barrel-only one, so this reuses the existing client instead of adding a
  // second copy of the same call.
  final _addressSuggestionService = BarrelShipmentService();

  final _searchController = TextEditingController();
  final _senderController = TextEditingController();
  final _receiverController = TextEditingController();
  final _phoneController = TextEditingController();
  final _weightController = TextEditingController();
  final _declaredValueController = TextEditingController();
  // Street line only. The rest of the address lives in _pickupAddress; the
  // composed line is what reaches the pricing and checkout callables.
  final _pickupAddressController = TextEditingController();
  StructuredAddress _pickupAddress = StructuredAddress.empty;

  List<BusinessDestinationOption> _options = const [];
  BusinessDestinationOption? _selected;
  String _query = '';
  String _mode = 'sea';
  bool _loading = true;
  bool _loadFailed = false;
  bool _busy = false;
  bool _receiverPhoneIsWhatsappOnly = false;

  // What is in the parcel, and what the customer says it would cost to
  // The funnel's answers, taken BEFORE any business is shown - the same
  // country -> category -> item -> qualifying-businesses order as the web
  // console, so both clients walk the customer identically.
  String _funnelCountryId = '';
  String _funnelCategoryId = '';
  String _funnelItemId = '';

  // replace. Two different questions on purpose: the category is what the
  // business charges by, the declared value is what it pays back by.
  String _categoryId = '';
  ServiceSort _sort = kDefaultServiceSort;
  bool _declaresValue = false;

  // Freight home-pickup state for the selected business.
  bool _pickupOffered = false;
  bool _pickupRequested = false;
  DateTime? _pickupDateTime;
  double? _pickupFee;
  double? _pickupDistanceKm;
  bool _pickupQuoting = false;
  String? _pickupError;
  Timer? _pickupDebounce;
  StreamSubscription<List<BusinessDestinationOption>>? _optionsSub;
  // Which of the business's office locations to drop off at (when the
  // business has more than one and pickup isn't requested).
  String _officeLocationId = '';
  int _pickupQuoteId = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _pickupDebounce?.cancel();
    _optionsSub?.cancel();
    _searchController.dispose();
    _senderController.dispose();
    _receiverController.dispose();
    _phoneController.dispose();
    _weightController.dispose();
    _declaredValueController.dispose();
    _pickupAddressController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _loadFailed = false;
      });
    }
    // A subscription, not a one-shot read: a business switching freight or
    // pickup off must reach this screen without the customer restarting it.
    await _optionsSub?.cancel();
    _optionsSub = _businessService.activeDestinationOptions().listen(
      (all) {
        final options =
            all
                .where(
                  (o) =>
                      hasBusinessService(
                        o.enabledServices,
                        BusinessServiceKey.freight,
                      ) &&
                      o.country.isActive &&
                      o.country.hasAnyFreightRate,
                )
                .toList()
              ..sort((a, b) => a.businessName.compareTo(b.businessName));
        if (!mounted) return;
        setState(() {
          _options = options;
          _loading = false;
          _loadFailed = false;
          _refreshSelectionFrom(options);
        });
      },
      onError: (_) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _loadFailed = true;
        });
      },
    );
  }

  /// Re-points the open selection at the freshly loaded option so a business
  /// that turned pickup off (or stopped serving the route) takes effect on a
  /// screen the customer is already looking at.
  void _refreshSelectionFrom(List<BusinessDestinationOption> options) {
    final selected = _selected;
    if (selected == null) return;
    final fresh = options
        .where((o) => o.id == selected.id)
        .cast<BusinessDestinationOption?>()
        .firstWhere((o) => o != null, orElse: () => null);
    if (fresh == null) {
      // This business no longer serves the route at all.
      _selected = null;
      _resetPickup();
      return;
    }
    _selected = fresh;
    if (!fresh.freightPickupAvailable && _pickupRequested) {
      _pickupRequested = false;
      _pickupFee = null;
      _pickupError = null;
    }
    _pickupOffered = fresh.freightPickupAvailable;
    // A business can retire a category or stop covering loss while this screen
    // is open. Quoting a category it no longer offers, or charging a coverage
    // fee for a promise it has withdrawn, would be a price the server refuses
    // to honour.
    if (freightCategoryLookup(fresh.freightCategories, _categoryId) == null) {
      _categoryId = defaultFreightCategoryId(fresh.freightCategories);
    }
    if (!_worthAskingDeclaredValue(fresh)) _resetDeclaredValue();
  }

  bool _worthAskingDeclaredValue(BusinessDestinationOption option) =>
      option.freightCoverage?.worthAskingDeclaredValue == true;

  void _resetDeclaredValue() {
    _declaresValue = false;
    _declaredValueController.clear();
  }

  /// The chip label for a sort. Declared here rather than in the ranking
  /// module so the wording stays with the screen that shows it.
  static String _sortLabel(AppLocalizations l10n, ServiceSort sort) =>
      switch (sort) {
        ServiceSort.cheapest => l10n.freightSortCheapest,
        ServiceSort.coverage => l10n.freightSortBestCover,
        ServiceSort.fastest => l10n.freightSortFastest,
        ServiceSort.rated => l10n.freightSortBestRated,
      };

  List<BusinessDestinationOption> get _countryOptions => _funnelCountryId.isEmpty
      ? const <BusinessDestinationOption>[]
      : _options.where((o) => o.country.id == _funnelCountryId).toList();

  /// Categories worth offering: someone on the route would actually take an
  /// item in them. `freightItemChoicesFor` already speaks for catch-alls and
  /// legacy no-table businesses ("Something else"), so an empty choice list
  /// means nobody takes anything in that category - a guaranteed dead end
  /// the customer must never be offered.
  List<FreightCategory> get _funnelCategoryChoices {
    final tables = [for (final o in _countryOptions) o.freightPaybackTable];
    final seen = <String, FreightCategory>{};
    for (final o in _countryOptions) {
      for (final category in o.freightCategories) {
        seen.putIfAbsent(category.id, () => category);
      }
    }
    return [
      for (final category in seen.values)
        if (freightItemChoicesFor(tables, category.id).isNotEmpty) category,
    ];
  }

  /// The stored selection, unless a data refresh withdrew it from the
  /// offered list - then it counts as unanswered rather than dangling.
  String get _activeFunnelCategoryId =>
      _funnelCategoryChoices.any((c) => c.id == _funnelCategoryId)
      ? _funnelCategoryId
      : '';

  List<FreightItemChoice> get _funnelItems {
    final categoryId = _activeFunnelCategoryId;
    return categoryId.isEmpty
        ? const <FreightItemChoice>[]
        : freightItemChoicesFor(
            [for (final o in _countryOptions) o.freightPaybackTable],
            categoryId,
          );
  }

  String get _activeFunnelItemId =>
      _funnelItems.any((i) => i.id == _funnelItemId) ? _funnelItemId : '';

  /// The funnel is answered only by an actual item choice. Every offered
  /// category has at least one - "Something else" stands in for catch-alls
  /// and legacy businesses - so there is no empty-items shortcut.
  bool get _funnelSatisfied =>
      _funnelCountryId.isNotEmpty && _activeFunnelItemId.isNotEmpty;

  List<BusinessDestinationOption> get _filtered {
    if (!_funnelSatisfied) return const <BusinessDestinationOption>[];
    final q = _query.trim().toLowerCase();
    final qualified = _countryOptions
        .where(
          (o) => providerQualifiesForItem(
            o.freightPaybackTable,
            _activeFunnelCategoryId,
            _activeFunnelItemId,
          ),
        )
        .toList();
    final matches = q.isEmpty
        ? qualified
        : qualified
              .where(
                (o) =>
                    o.businessName.toLowerCase().contains(q) ||
                    o.country.name.toLowerCase().contains(q),
              )
              .toList();
    // Ranked on the parcel as described so far. At this step the customer has
    // not said what they are sending or how, so an empty mode judges each
    // business on whichever of air or sea it does best, and the weight stands
    // in at one kilo - enough to order the per-kg rates against each other.
    return sortServiceOptions(
      matches,
      service: 'freight',
      sort: _sort,
      weightKg: _weightKg > 0 ? _weightKg : 1,
      mode: '',
    );
  }

  List<String> _availableModes(BusinessDestinationOption? o) {
    if (o == null) return const [];
    return [
      if (o.country.freightAvailable('air')) 'air',
      if (o.country.freightAvailable('sea')) 'sea',
    ];
  }

  double get _weightKg => double.tryParse(_weightController.text.trim()) ?? 0;
  double get _ratePerKg => _selected?.country.freightRatePerKg(_mode) ?? 0;

  List<FreightCategory> get _categories =>
      _selected?.freightCategories ?? const <FreightCategory>[];

  FreightCategory? get _category =>
      freightCategoryLookup(_categories, _categoryId);

  /// The per-kg rate the customer is actually paying, category included. The
  /// destination's rate never changes; the category rides on top of it.
  double get _effectiveRatePerKg =>
      _ratePerKg * freightCategoryMultiplier(_categories, _categoryId);

  double get _price => freightShippingFee(
    weightKg: _weightKg,
    ratePerKg: _ratePerKg,
    multiplier: freightCategoryMultiplier(_categories, _categoryId),
  );

  /// What the customer says the parcel would cost to replace. Zero unless they
  /// said there was something worth declaring - the question is optional and a
  /// stale number in a hidden field must not reach the server.
  double get _declaredValue => _declaresValue
      ? (double.tryParse(_declaredValueController.text.trim()) ?? 0)
      : 0;

  /// Priced locally so the fee and the promise are on screen before payment.
  /// The callable re-prices it against a freshly read business document and
  /// has the final word.
  FreightCoverageQuote get _coverageQuote => quoteFreightCoverage(
    policy: _selected?.freightCoverage ?? FreightCoveragePolicy.none,
    declaredValue: _declaredValue,
  );

  /// The business publishes what each item pays back; the customer only says
  /// what the item is. Mirrors the web console exactly - see freight_payback.
  bool get _usesItemPricing =>
      (_selected?.freightPaybackTable?.isNotEmpty ?? false);

  FreightPaybackLookup get _itemPayback => freightPaybackFor(
    table: _selected?.freightPaybackTable,
    categoryId: _activeFunnelCategoryId.isNotEmpty
        ? _activeFunnelCategoryId
        : _categoryId,
    itemId: _activeFunnelItemId == otherItemId ? '' : _activeFunnelItemId,
  );

  double get _itemCoverageFee {
    if (!_usesItemPricing) return 0;
    final policy = _selected?.freightCoverage;
    if (policy == null || !policy.coversLoss) return 0;
    final lookup = _itemPayback;
    if (!lookup.listed) return 0;
    return coverageFeeCentsFor(lookup.paybackAmount, policy.ratePct) / 100;
  }

  double get _coverageFeeApplied =>
      _usesItemPricing ? _itemCoverageFee : _coverageQuote.coverageFee;

  double get _appliedPickupFee => _pickupRequested ? (_pickupFee ?? 0) : 0;
  double get _totalPrice => _price + _appliedPickupFee + _coverageFeeApplied;

  /// Pickup is blocking the order only when it's requested but not yet resolved
  /// (still quoting, errored, or missing required details).
  bool get _pickupBlocksSubmit {
    if (!_pickupRequested) return false;
    if (_pickupQuoting || _pickupError != null || _pickupFee == null) {
      return true;
    }
    if (_pickupDateTime == null) return true;
    if (_pickupAddress.composeLine().isEmpty) return true;
    return false;
  }

  void _select(BusinessDestinationOption o) {
    setState(() {
      _selected = o;
      _receiverPhoneIsWhatsappOnly = false;
      final modes = _availableModes(o);
      _mode = modes.contains(_mode)
          ? _mode
          : (modes.isNotEmpty ? modes.first : 'sea');
      // The funnel already answered what is being sent; the business's own
      // category list only decides the multiplier. Fall back to the default
      // when this business does not price the funnel's category.
      _categoryId =
          freightCategoryLookup(o.freightCategories, _activeFunnelCategoryId) !=
              null
          ? _activeFunnelCategoryId
          : defaultFreightCategoryId(o.freightCategories);
      _resetDeclaredValue();
      _resetPickup();
      // Pickup availability + model are resolved server-side and travel with
      // the option, so no extra (rule-blocked) business read is needed here.
      _pickupOffered = o.freightPickupAvailable;
    });
  }

  void _resetPickup() {
    _pickupDebounce?.cancel();
    _pickupQuoteId++;
    _pickupOffered = false;
    _pickupRequested = false;
    _pickupDateTime = null;
    _pickupFee = null;
    _pickupDistanceKm = null;
    _pickupQuoting = false;
    _pickupError = null;
    _pickupAddressController.clear();
    _pickupAddress = StructuredAddress.empty;
    _officeLocationId = '';
  }

  void _schedulePickupQuote() {
    _pickupDebounce?.cancel();
    final address = _pickupAddress.composeLine();
    if (address.isEmpty) {
      setState(() {
        _pickupFee = null;
        _pickupDistanceKm = null;
        _pickupQuoting = false;
        _pickupError = null;
      });
      return;
    }
    setState(() {
      _pickupQuoting = true;
      _pickupError = null;
    });
    _pickupDebounce = Timer(
      const Duration(milliseconds: 700),
      _requestPickupQuote,
    );
  }

  Future<void> _requestPickupQuote() async {
    final option = _selected;
    if (option == null) return;
    final l10n = AppLocalizations.of(context)!;
    final quoteId = ++_pickupQuoteId;
    try {
      // The server derives the borough from the geocoded address; the client
      // never chooses it (whoever supplies the borough chooses the price).
      final quote = await _freightService.quoteFreightPickup(
        businessId: option.businessId,
        pickupAddress: _pickupAddress.composeLine(),
      );
      if (!mounted || quoteId != _pickupQuoteId) return;
      setState(() {
        _pickupFee = quote.fee;
        _pickupDistanceKm = quote.distanceKm;
        _pickupQuoting = false;
        _pickupError = null;
      });
    } catch (error) {
      if (!mounted || quoteId != _pickupQuoteId) return;
      setState(() {
        _pickupQuoting = false;
        _pickupFee = null;
        _pickupDistanceKm = null;
        _pickupError = _pickupErrorMessage(error, l10n);
      });
    }
  }

  String _pickupErrorMessage(Object error, AppLocalizations l10n) {
    final details = error is FirebaseFunctionsException && error.details is Map
        ? Map<String, dynamic>.from(error.details as Map)
        : const <String, dynamic>{};
    final reason = details['reason'];
    if (reason == 'freight_pickup_unavailable') {
      return l10n.freightPickupUnavailableCustomer;
    }
    if (reason == 'freight_pickup_out_of_range' ||
        reason == 'freight_pickup_out_of_area') {
      return l10n.freightPickupOutOfRangeCustomer;
    }
    return l10n.freightPickupQuoteFailed;
  }

  Future<void> _pickPickupDateTime() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: _pickupDateTime ?? now.add(const Duration(days: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 60)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(
        _pickupDateTime ?? now.add(const Duration(hours: 1)),
      ),
    );
    if (time == null || !mounted) return;
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

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    if (FirebaseAuth.instance.currentUser == null) {
      Navigator.pushNamed(context, '/login');
      return;
    }
    final option = _selected;
    if (option == null) return;
    if (_senderController.text.trim().isEmpty ||
        _receiverController.text.trim().isEmpty) {
      _snack(l10n.fillSenderReceiverPhone);
      return;
    }
    final phoneError = ReceiverPhoneRules.validate(
      value: _phoneController.text,
      destination: option.country,
      allowDifferentCountry: _receiverPhoneIsWhatsappOnly,
      requiredMessage: l10n.pleaseEnterReceiverPhone,
      invalidPhoneMessage: l10n.invalidPhoneWithCountryCode,
      invalidInternationalPhoneMessage: l10n.invalidInternationalPhone,
      whatsAppCountryCodeMessage: l10n.whatsAppDifferentCountryRequiresCode,
      destinationMismatchMessage: l10n.receiverPhoneMustMatchDestination,
    );
    if (phoneError != null) {
      _snack(phoneError);
      return;
    }
    if (_weightKg <= 0) {
      _snack(l10n.enterParcelWeightKg);
      return;
    }
    if (_pickupRequested) {
      if (_pickupAddress.composeLine().isEmpty) {
        _snack(l10n.freightPickupEnterDetailsForFee);
        return;
      }
      if (_pickupDateTime == null) {
        _snack(l10n.freightPickupSelectDateTime);
        return;
      }
      if (_pickupQuoting || _pickupFee == null || _pickupError != null) {
        _snack(_pickupError ?? l10n.freightPickupQuoteFailed);
        return;
      }
    } else {
      // OfficeLocationPicker auto-selects the first location via a
      // post-frame callback once its stream first resolves, so
      // _officeLocationId can still be empty here if the user reaches "Pay
      // estimate" before that callback runs (e.g. a business with multiple
      // locations on a slow connection) - the server then rejects the
      // request for lacking a chosen location. Resolve it directly instead
      // of relying on that timing.
      final locations = await OfficeLocationService()
          .activeLocations(option.businessId)
          .first;
      if (!mounted) return;
      _officeLocationId = OfficeLocation.resolveSelectedId(
        locations,
        _officeLocationId,
      );
    }
    final marketplaceAcceptance = await confirmMarketplaceTransaction(
      context,
      providerNames: option.businessName,
      transactionSummary: l10n.sendFreight,
      additionalBody: l10n.freightAutoChargeDisclosureBody,
      showHoldNotice: true,
    );
    if (marketplaceAcceptance == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final shipment = await _freightService.payForFreight(
        senderName: _senderController.text.trim(),
        receiverName: _receiverController.text.trim(),
        receiverPhone: _phoneController.text.trim(),
        destinationCountryId: option.country.id,
        businessId: option.businessId,
        mode: _mode,
        weightKg: _weightKg,
        itemCategoryId: _categoryId,
        itemId: _usesItemPricing
            ? (_activeFunnelItemId == otherItemId ? '' : _activeFunnelItemId)
            : null,
        declaredValue: !_usesItemPricing && _declaredValue > 0
            ? _declaredValue
            : null,
        pickupRequested: _pickupRequested,
        pickupAddress: _pickupRequested ? _pickupAddress.composeLine() : null,
        pickupDateTime: _pickupRequested
            ? _pickupDateTime!.toUtc().toIso8601String()
            : null,
        officeLocationId: _pickupRequested ? null : _officeLocationId,
        marketplaceAcceptance: marketplaceAcceptance,
      );
      if (!mounted) return;
      final code = shipment['trackingCode']?.toString() ?? '';
      final messenger = ScaffoldMessenger.of(context);
      Navigator.pop(context);
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.freightEstimatePaidTracking(code))),
      );
    } catch (error) {
      if (!mounted) return;
      final details =
          error is FirebaseFunctionsException && error.details is Map
          ? Map<String, dynamic>.from(error.details as Map)
          : const <String, dynamic>{};
      final message = details['reason'] == 'invalid_freight_mode'
          ? l10n.invalidFreightMode
          // The server refuses a declared value in its own words, because only
          // it knows what this business will carry ("This business does not
          // carry parcels worth that much"). Replacing that with a generic
          // failure would leave the customer changing random fields.
          : _declaredValueRefusal(error) ?? l10n.freightBookingFailed;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The server's own sentence when it turned down the declared value, or null
  /// when this failure was about something else. Shown verbatim: it is the only
  /// party that knows the ceiling, and a paraphrase would risk contradicting it.
  String? _declaredValueRefusal(Object error) {
    if (_declaredValue <= 0) return null;
    if (error is! FirebaseFunctionsException) return null;
    if (error.code != 'failed-precondition') return null;
    final message = (error.message ?? '').trim();
    return message.isEmpty ? null : message;
  }

  void _snack(String m) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.sendFreight)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _loadFailed
          ? _loadErrorState(theme)
          : _options.isEmpty
          ? _emptyState(theme)
          : (_selected == null ? _searchList(theme) : _bookingForm(theme)),
    );
  }

  Widget _loadErrorState(ThemeData theme) {
    final l10n = AppLocalizations.of(context)!;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off_outlined, size: 56, color: theme.hintColor),
            const SizedBox(height: 14),
            Text(
              l10n.couldNotLoadFreightOptions,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh),
              label: Text(l10n.retry),
            ),
          ],
        ),
      ),
    );
  }

  Widget _emptyState(ThemeData theme) {
    final l10n = AppLocalizations.of(context)!;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.inventory_2_outlined, size: 56, color: theme.hintColor),
            const SizedBox(height: 14),
            Text(
              l10n.noFreightBusinessesYet,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              l10n.noFreightBusinessesSubtitle,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.hintColor,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  // ---- Step 1: the funnel - country, category, item - then businesses ----
  Widget _funnelDropdowns(ThemeData theme, AppLocalizations l10n) {
    final countries = <String, String>{};
    for (final o in _options) {
      countries.putIfAbsent(o.country.id, () => o.country.name);
    }
    final categories = _funnelCategoryChoices;
    final items = _funnelItems;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          DropdownButtonFormField<String>(
            initialValue: _funnelCountryId.isEmpty ? null : _funnelCountryId,
            decoration: InputDecoration(labelText: l10n.destinationCountry),
            items: [
              for (final entry in countries.entries)
                DropdownMenuItem(value: entry.key, child: Text(entry.value)),
            ],
            onChanged: (value) => setState(() {
              _funnelCountryId = value ?? '';
              _funnelCategoryId = '';
              _funnelItemId = '';
            }),
          ),
          if (_funnelCountryId.isNotEmpty && categories.isNotEmpty) ...[
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _activeFunnelCategoryId.isEmpty
                  ? null
                  : _activeFunnelCategoryId,
              decoration:
                  InputDecoration(labelText: l10n.freightCategoryQuestion),
              items: [
                for (final category in categories)
                  DropdownMenuItem(
                    value: category.id,
                    child: Text(freightCategoryLabel(l10n, category)),
                  ),
              ],
              onChanged: (value) => setState(() {
                _funnelCategoryId = value ?? '';
                _funnelItemId = '';
              }),
            ),
          ],
          if (_activeFunnelCategoryId.isNotEmpty && items.isNotEmpty) ...[
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue:
                  _activeFunnelItemId.isEmpty ? null : _activeFunnelItemId,
              decoration: InputDecoration(labelText: l10n.whatIsTheItem),
              items: [
                for (final item in items)
                  DropdownMenuItem(
                    value: item.id,
                    child: Text(
                      item.id == otherItemId
                          ? l10n.somethingElseInCategory
                          : item.label,
                    ),
                  ),
              ],
              onChanged: (value) =>
                  setState(() => _funnelItemId = value ?? ''),
            ),
          ],
          if (_funnelSatisfied && _filtered.isEmpty && _query.isEmpty) ...[
            const SizedBox(height: 12),
            Text(
              l10n.noBusinessTakesItem,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.hintColor,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _searchList(ThemeData theme) {
    final l10n = AppLocalizations.of(context)!;
    final results = _filtered;
    return Column(
      children: [
        _funnelDropdowns(theme, l10n),
        // The search box exists to narrow a list. With no businesses and no
        // query there is nothing to narrow - showing it under the dead-end
        // note would pair two empty-states on one screen.
        if (!_funnelSatisfied || (results.isEmpty && _query.isEmpty))
          const Expanded(child: SizedBox.shrink())
        else ...[
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
          child: TextField(
            controller: _searchController,
            onChanged: (v) => setState(() => _query = v),
            decoration: InputDecoration(
              hintText: l10n.searchBusinessOrCountry,
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _query.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () {
                        _searchController.clear();
                        setState(() => _query = '');
                      },
                    ),
            ),
          ),
        ),
        // Only worth offering once there is genuinely something to order. A
        // sort control over one result advertises a choice that does not
        // exist.
        if (shouldOfferServiceSort(results, 'freight'))
          Align(
            alignment: Alignment.centerLeft,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Row(
                children: [
                  for (final entry in <(ServiceSort, String)>[
                    for (final sort in sortsForService('freight'))
                      (sort, _sortLabel(l10n, sort)),
                  ])
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(entry.$2),
                        selected: _sort == entry.$1,
                        onSelected: (_) => setState(() => _sort = entry.$1),
                      ),
                    ),
                ],
              ),
            ),
          ),
        Expanded(
          child: results.isEmpty
              ? Center(
                  child: Text(
                    l10n.noMatchFor(_query),
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.hintColor,
                    ),
                  ),
                )
              : ListView.separated(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                  itemCount: results.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, i) => _optionCard(theme, results[i]),
                ),
        ),
        ],
      ],
    );
  }

  Widget _optionCard(ThemeData theme, BusinessDestinationOption o) {
    final l10n = AppLocalizations.of(context)!;
    final air = o.country.freightAvailable('air');
    final sea = o.country.freightAvailable('sea');
    final airDepartureDays = _localizedDepartureDays(
      l10n,
      o.country.freightAirDepartureDays,
    );
    final seaDepartureDays = _localizedDepartureDays(
      l10n,
      o.country.freightSeaDepartureDays,
    );
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _select(o),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Text(o.country.flagEmoji, style: const TextStyle(fontSize: 28)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      o.businessName,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    if (o.reviewCount > 0) ...[
                      const SizedBox(height: 2),
                      RatingSummaryBadge(
                        average: o.reviewAverage,
                        count: o.reviewCount,
                        onTap: () => showBusinessReviewsSheet(
                          context,
                          businessId: o.businessId,
                          businessName: o.businessName,
                        ),
                      ),
                    ],
                    const SizedBox(height: 2),
                    Text(
                      l10n.toDestination(o.country.name),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.hintColor,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        if (air)
                          _ratePill(
                            theme,
                            Icons.flight_takeoff,
                            l10n.airRatePerKg(
                              '\$${o.country.freightAirPricePerKg.toStringAsFixed(2)}',
                            ),
                          ),
                        if (sea)
                          _ratePill(
                            theme,
                            Icons.directions_boat,
                            l10n.seaRatePerKg(
                              '\$${o.country.freightSeaPricePerKg.toStringAsFixed(2)}',
                            ),
                          ),
                        // Before the business is chosen, not after: a customer
                        // should be able to pick partly on whether anyone
                        // stands behind the parcel, and the business that does
                        // not has to say so while it can still be avoided.
                        if (o.freightCoverage != null) _coveragePill(theme, o),
                        _ratePill(
                          theme,
                          Icons.verified_outlined,
                          l10n.approvedBusiness,
                        ),
                        if (air && o.country.hasDeliveryEstimateFor('freightAir'))
                          _ratePill(
                            theme,
                            Icons.schedule_outlined,
                            l10n.freightAirDeliveryEstimateDays(
                              o.country.freightAirDeliveryEstimateMinDays!,
                              o.country.freightAirDeliveryEstimateMaxDays!,
                            ),
                          ),
                        if (sea && o.country.hasDeliveryEstimateFor('freightSea'))
                          _ratePill(
                            theme,
                            Icons.schedule_outlined,
                            l10n.freightSeaDeliveryEstimateDays(
                              o.country.freightSeaDeliveryEstimateMinDays!,
                              o.country.freightSeaDeliveryEstimateMaxDays!,
                            ),
                          ),
                        if (air && airDepartureDays.isNotEmpty)
                          _ratePill(
                            theme,
                            Icons.flight_takeoff_outlined,
                            l10n.regularDepartureDays(airDepartureDays),
                          ),
                        if (sea && seaDepartureDays.isNotEmpty)
                          _ratePill(
                            theme,
                            Icons.directions_boat_outlined,
                            l10n.regularDepartureDays(seaDepartureDays),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: theme.hintColor),
            ],
          ),
        ),
      ),
    );
  }

  String _localizedDepartureDays(AppLocalizations l10n, List<String> days) {
    String label(String day) => switch (day) {
      'monday' => l10n.mondayShort,
      'tuesday' => l10n.tuesdayShort,
      'wednesday' => l10n.wednesdayShort,
      'thursday' => l10n.thursdayShort,
      'friday' => l10n.fridayShort,
      'saturday' => l10n.saturdayShort,
      'sunday' => l10n.sundayShort,
      _ => day,
    };
    return days.map(label).join(', ');
  }

  Widget _ratePill(
    ThemeData theme,
    IconData icon,
    String label, {
    Color? background,
    Color? foreground,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: background ?? theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: foreground),
          const SizedBox(width: 6),
          Text(
            label,
            style: theme.textTheme.labelMedium?.copyWith(color: foreground),
          ),
        ],
      ),
    );
  }

  /// "Covers up to $2,000 · 2%" against "No coverage", on the card the customer
  /// chooses from.
  Widget _coveragePill(ThemeData theme, BusinessDestinationOption o) {
    final l10n = AppLocalizations.of(context)!;
    final covers = o.freightCoverage?.coversLoss == true;
    return _ratePill(
      theme,
      covers ? Icons.shield_outlined : Icons.gpp_maybe_outlined,
      freightCoverageSummaryText(l10n, o.freightCoverage),
      background: covers
          ? theme.colorScheme.primaryContainer
          : theme.colorScheme.surfaceContainerHighest,
      foreground: covers
          ? theme.colorScheme.onPrimaryContainer
          : theme.hintColor,
    );
  }

  Widget _pickupSection(ThemeData theme, AppLocalizations l10n) {
    return Card(
      margin: EdgeInsets.zero,
      elevation: 0,
      color: theme.colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _pickupRequested,
              onChanged: _busy
                  ? null
                  : (value) {
                      setState(() => _pickupRequested = value);
                      if (value) _schedulePickupQuote();
                    },
              title: Text(
                l10n.freightPickupCustomerToggle,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              secondary: const Icon(Icons.home_outlined),
            ),
            if (_pickupRequested) ...[
              StructuredAddressFields(
                controller: _pickupAddressController,
                value: _pickupAddress,
                enabled: !_busy,
                streetLabel: l10n.freightPickupAddressLabel,
                fetchSuggestions:
                    _addressSuggestionService.addressSuggestions,
                onChanged: (address, _) {
                  setState(() => _pickupAddress = address);
                  _schedulePickupQuote();
                },
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _busy ? null : _pickPickupDateTime,
                icon: const Icon(Icons.event_outlined),
                label: Text(
                  _pickupDateTime == null
                      ? l10n.freightPickupChooseDateTime
                      : DateFormat(
                          'EEE, MMM d • h:mm a',
                        ).format(_pickupDateTime!),
                ),
              ),
              const SizedBox(height: 10),
              _pickupFeeStatus(theme, l10n),
            ] else if (_selected != null) ...[
              const SizedBox(height: 12),
              OfficeLocationPicker(
                businessId: _selected!.businessId,
                fallbackAddress: _selected!.businessAddress ?? '',
                selectedLocationId: _officeLocationId,
                onChanged: (value) => setState(() => _officeLocationId = value),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _pickupFeeStatus(ThemeData theme, AppLocalizations l10n) {
    if (_pickupQuoting) {
      return Row(
        children: [
          const SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 8),
          Text(l10n.freightPickupCalculating, style: theme.textTheme.bodySmall),
        ],
      );
    }
    if (_pickupError != null) {
      return Text(
        _pickupError!,
        style: theme.textTheme.bodySmall?.copyWith(
          color: theme.colorScheme.error,
          fontWeight: FontWeight.w600,
        ),
      );
    }
    if (_pickupFee != null) {
      final feeLabel = _pickupFee == 0
          ? l10n.freightPickupFreeLabel
          : '\$${_pickupFee!.toStringAsFixed(2)}';
      final distance = _pickupDistanceKm;
      return Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Text(
              distance != null
                  ? l10n.freightPickupDistanceAway(distance.toStringAsFixed(1))
                  : l10n.freightPickupFeeLabel,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.hintColor,
              ),
            ),
          ),
          Text(
            feeLabel,
            style: theme.textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      );
    }
    return Text(
      l10n.freightPickupEnterDetailsForFee,
      style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor),
    );
  }

  /// What is in the parcel. The platform owns the list so two businesses can be
  /// compared on the same words; this business owns the price, so the effect on
  /// the per-kg rate is shown here rather than discovered on the receipt.
  Widget _categorySection(ThemeData theme, AppLocalizations l10n) {
    final categories = _categories;
    final selected = _category;
    return Card(
      margin: EdgeInsets.zero,
      elevation: 0,
      color: theme.colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.freightCategoryQuestion,
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              l10n.freightCategoryHelp,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.hintColor,
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final category in categories)
                  ChoiceChip(
                    label: Text(
                      category.changesPrice
                          ? '${freightCategoryLabel(l10n, category)} · '
                                '${freightMultiplierText(category.multiplier)}'
                          : freightCategoryLabel(l10n, category),
                    ),
                    selected: category.id == _categoryId,
                    onSelected: _busy
                        ? null
                        : (_) => setState(() => _categoryId = category.id),
                  ),
              ],
            ),
            if (selected != null) ...[
              const SizedBox(height: 10),
              if (freightCategoryHint(l10n, selected).isNotEmpty)
                Text(
                  freightCategoryHint(l10n, selected),
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.hintColor,
                  ),
                ),
              const SizedBox(height: 4),
              Text(
                '${freightCategoryRateText(l10n, selected)} · '
                '${l10n.pricePerKg('\$${_effectiveRatePerKg.toStringAsFixed(2)}')}',
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: theme.colorScheme.primary,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// Who stands behind the parcel, and the one question only the customer can
  /// answer. Asked once, and only where the answer changes something: a
  /// business that neither covers loss nor states a ceiling does nothing with
  /// it, so it is told plainly instead of being asked.
  Widget _coverageSection(ThemeData theme, AppLocalizations l10n) {
    final option = _selected!;
    final policy = option.freightCoverage;
    if (_usesItemPricing) {
      // The business's table decides the payback; there is nothing to ask.
      // Reassurance framing only - no loss-talk in the customer's face,
      // exactly as on the web.
      final lookup = _itemPayback;
      if (policy == null ||
          !policy.coversLoss ||
          !lookup.listed ||
          lookup.paybackAmount <= 0) {
        return const SizedBox.shrink();
      }
      return Card(
        margin: EdgeInsets.zero,
        elevation: 0,
        color: theme.colorScheme.surfaceContainerHighest,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Icon(
                Icons.verified_user_outlined,
                size: 18,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  l10n.protectionIncludedUpTo(
                    freightMoney(lookup.paybackAmount),
                  ),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              if (_itemCoverageFee > 0)
                Text(
                  '+ \$${_itemCoverageFee.toStringAsFixed(2)}',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.hintColor,
                  ),
                ),
            ],
          ),
        ),
      );
    }
    if (policy == null) return const SizedBox.shrink();
    final quote = _coverageQuote;
    final asks = policy.worthAskingDeclaredValue;
    return Card(
      margin: EdgeInsets.zero,
      elevation: 0,
      color: theme.colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  policy.coversLoss
                      ? Icons.shield_outlined
                      : Icons.gpp_maybe_outlined,
                  size: 18,
                  color: policy.coversLoss
                      ? theme.colorScheme.primary
                      : theme.hintColor,
                ),
                const SizedBox(width: 8),
                Text(
                  l10n.freightCoverageSectionTitle,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            // A business that will not pay for a lost parcel says so here,
            // before the parcel is handed over, rather than after it is lost.
            if (!policy.coversLoss)
              Text(
                l10n.freightCoverageNotOffered(option.businessName),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.hintColor,
                ),
              ),
            if (asks) ...[
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _declaresValue,
                onChanged: _busy
                    ? null
                    : (value) => setState(() {
                        _declaresValue = value;
                        if (!value) _declaredValueController.clear();
                      }),
                title: Text(
                  l10n.freightCoverageQuestion(
                    freightMoney(policy.declarationThreshold),
                  ),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                subtitle: Text(l10n.freightCoverageQuestionHelp),
              ),
              if (_declaresValue) ...[
                TextField(
                  controller: _declaredValueController,
                  enabled: !_busy,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    labelText: l10n.freightDeclaredValueLabel,
                    helperText: l10n.freightDeclaredValueHelper,
                    helperMaxLines: 3,
                    prefixText: '\$',
                    prefixIcon: const Icon(Icons.attach_money),
                  ),
                ),
                const SizedBox(height: 10),
                _coverageStatus(theme, l10n, option, policy, quote),
              ],
            ],
          ],
        ),
      ),
    );
  }

  Widget _coverageStatus(
    ThemeData theme,
    AppLocalizations l10n,
    BusinessDestinationOption option,
    FreightCoveragePolicy policy,
    FreightCoverageQuote quote,
  ) {
    // The ceiling is a statement about what this business is willing to carry,
    // so it is shown whether or not the business sells coverage. When the
    // declared value is over it the same sentence turns red - the server owns
    // the refusal wording and there is no point inventing a second one.
    final ceilingLine = policy.hasCeiling
        ? Text(
            l10n.freightCoverageCarriesUpTo(
              option.businessName,
              freightMoney(policy.maxDeclaredValue),
            ),
            style: theme.textTheme.bodySmall?.copyWith(
              color: quote.error == FreightCoverageError.aboveMaxDeclaredValue
                  ? theme.colorScheme.error
                  : theme.hintColor,
              fontWeight:
                  quote.error == FreightCoverageError.aboveMaxDeclaredValue
                  ? FontWeight.w700
                  : FontWeight.w400,
            ),
          )
        : null;

    if (_declaredValue <= 0) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.freightCoverageEnterValue,
            style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor),
          ),
          if (ceilingLine != null) ...[const SizedBox(height: 4), ceilingLine],
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (quote.covered) ...[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Text(
                  l10n.freightCoverageFeeLabel,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.hintColor,
                  ),
                ),
              ),
              Text(
                '\$${quote.coverageFee.toStringAsFixed(2)}',
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            l10n.freightCoveragePaysUpTo(
              option.businessName,
              freightMoney(quote.payoutCap),
            ),
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 2),
          // The platform is not the insurer, and the customer should know
          // whose promise this is before relying on it.
          Text(
            l10n.freightCoverageWhoPays(option.businessName),
            style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor),
          ),
        ],
        if (ceilingLine != null) ...[
          if (quote.covered) const SizedBox(height: 4),
          ceilingLine,
        ],
      ],
    );
  }

  // ---- Step 2: booking form for the selected option ----
  Widget _bookingForm(ThemeData theme) {
    final l10n = AppLocalizations.of(context)!;
    final o = _selected!;
    final modes = _availableModes(o);
    final showWhatsapp = ReceiverPhoneRules.isDifferentCountryNumber(
      value: _phoneController.text,
      destination: o.country,
    );
    return ListView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
      children: [
        Card(
          margin: EdgeInsets.zero,
          child: ListTile(
            leading: Text(
              o.country.flagEmoji,
              style: const TextStyle(fontSize: 26),
            ),
            title: Text(
              o.businessName,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            subtitle: Text(l10n.toDestination(o.country.name)),
            trailing: TextButton(
              onPressed: _busy ? null : () => setState(() => _selected = null),
              child: Text(l10n.change),
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text(l10n.shippingMode, style: theme.textTheme.labelLarge),
        const SizedBox(height: 10),
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < modes.length; i++) ...[
                if (i > 0) const SizedBox(width: 12),
                Expanded(
                  child: _ModeCard(
                    mode: modes[i],
                    rate: o.country.freightRatePerKg(modes[i]),
                    selected: modes[i] == _mode,
                    onTap: _busy
                        ? null
                        : () => setState(() => _mode = modes[i]),
                  ),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _weightController,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            labelText: l10n.estimatedWeightKg,
            prefixIcon: const Icon(Icons.scale_outlined),
          ),
        ),
        if (_categories.isNotEmpty) ...[
          const SizedBox(height: 14),
          _categorySection(theme, l10n),
        ],
        if (o.freightCoverage != null) ...[
          const SizedBox(height: 14),
          _coverageSection(theme, l10n),
        ],
        const SizedBox(height: 14),
        TextField(
          controller: _senderController,
          decoration: InputDecoration(labelText: l10n.senderName),
        ),
        const SizedBox(height: 14),
        RecipientNameField(
          controller: _receiverController,
          labelText: l10n.receiverName,
          onRecipientSelected: (recipient) {
            setState(() {
              _phoneController.text = recipient.phone;
              _receiverPhoneIsWhatsappOnly = recipient.whatsappOnly;
            });
          },
        ),
        const SizedBox(height: 14),
        CountryPhoneField(
          controller: _phoneController,
          labelText: l10n.receiverPhone,
          initialCountryCode: o.country.displayCode,
          onChanged: (_) => setState(() {
            if (!ReceiverPhoneRules.isDifferentCountryNumber(
              value: _phoneController.text,
              destination: o.country,
            )) {
              _receiverPhoneIsWhatsappOnly = false;
            }
          }),
        ),
        if (showWhatsapp)
          CheckboxListTile(
            value: _receiverPhoneIsWhatsappOnly,
            onChanged: _busy
                ? null
                : (checked) => setState(
                    () => _receiverPhoneIsWhatsappOnly = checked ?? false,
                  ),
            contentPadding: EdgeInsets.zero,
            dense: true,
            controlAffinity: ListTileControlAffinity.leading,
            title: Text(
              l10n.receiverWhatsAppNumberTitle,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            subtitle: Text(l10n.receiverWhatsAppNumberSubtitle),
          ),
        if (_pickupOffered) ...[
          const SizedBox(height: 8),
          _pickupSection(theme, l10n),
        ],
        const SizedBox(height: 18),
        Card(
          elevation: 0,
          color: theme.colorScheme.surfaceContainerHighest,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.estimatedTotal,
                        style: theme.textTheme.labelMedium,
                      ),
                      Text(
                        _weightKg > 0
                            ? '${_weightKg.toStringAsFixed(1)} kg × '
                                  '\$${_effectiveRatePerKg.toStringAsFixed(2)}'
                            : l10n.enterWeightToSeePrice,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.hintColor,
                        ),
                      ),
                      if (_coverageFeeApplied > 0)
                        Text(
                          '+ \$${_coverageFeeApplied.toStringAsFixed(2)} '
                          '${l10n.freightCoverageFeeLabel}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.hintColor,
                          ),
                        ),
                      if (_appliedPickupFee > 0)
                        Text(
                          '+ \$${_appliedPickupFee.toStringAsFixed(2)} '
                          '${l10n.freightPickupFeeLabel}',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.hintColor,
                          ),
                        ),
                    ],
                  ),
                ),
                Text(
                  '\$${_totalPrice.toStringAsFixed(2)}',
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),
        Text(
          l10n.freightEstimateExplanation,
          style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 18),
        FilledButton.icon(
          onPressed: _busy || _price <= 0 || _pickupBlocksSubmit
              ? null
              : _submit,
          icon: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.local_shipping_outlined),
          label: Text(l10n.payEstimate),
        ),
        const SizedBox(height: 8),
        Text(
          l10n.freightDropOffNote,
          style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor),
          textAlign: TextAlign.center,
        ),
        if ((o.businessAddress ?? '').trim().isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(
            l10n.freightDropOffAddress(o.businessAddress!.trim()),
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurface,
              fontWeight: FontWeight.w700,
            ),
            textAlign: TextAlign.center,
          ),
        ],
        if ((o.businessPhone ?? '').trim().isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(
            l10n.freightBusinessPhone(o.businessPhone!.trim()),
            style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor),
            textAlign: TextAlign.center,
          ),
        ],
      ],
    );
  }
}

/// A selectable card for choosing air vs sea freight, showing the mode, its
/// per-kg rate, and a one-line trade-off, with a clear selected state.
class _ModeCard extends StatelessWidget {
  const _ModeCard({
    required this.mode,
    required this.rate,
    required this.selected,
    required this.onTap,
  });

  final String mode;
  final double rate;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final l10n = AppLocalizations.of(context)!;
    final isAir = mode == 'air';
    final accent = cs.primary;
    return Material(
      color: selected ? accent.withValues(alpha: 0.10) : cs.surface,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: selected ? accent : cs.outlineVariant,
              width: selected ? 2 : 1,
            ),
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
                      color: accent.withValues(alpha: selected ? 0.18 : 0.10),
                      borderRadius: BorderRadius.circular(11),
                    ),
                    child: Icon(
                      isAir ? Icons.flight_takeoff : Icons.directions_boat,
                      color: accent,
                      size: 20,
                    ),
                  ),
                  const Spacer(),
                  Icon(
                    selected
                        ? Icons.check_circle_rounded
                        : Icons.circle_outlined,
                    color: selected ? accent : cs.outline,
                    size: 22,
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                isAir ? l10n.airFreight : l10n.seaFreight,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                l10n.pricePerKg('\$${rate.toStringAsFixed(2)}'),
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: accent,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                isAir ? l10n.fasterDelivery : l10n.lowerCost,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.hintColor,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
