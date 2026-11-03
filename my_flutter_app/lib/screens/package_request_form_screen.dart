import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../data/calling_code_catalog.dart';
import '../l10n/app_localizations.dart';
import '../models/structured_address.dart';
import '../providers/auth_provider.dart';
import '../services/barrel_shipment_service.dart'
    show BarrelAddressSuggestion, BarrelShipmentService;
import '../services/business_price_list.dart' show priceLbText;
import '../services/eastern_clock.dart' show easternWall;
import '../services/package_price_list.dart';
import '../services/package_request_compare.dart';
import '../services/package_request_service.dart';
import '../services/package_requests.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/country_phone_field.dart';
import '../widgets/day_picker.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/package_request_compare_widgets.dart';
import '../widgets/package_request_widgets.dart';
import '../widgets/structured_address_fields.dart';
import 'package_request_detail_screen.dart';

/// What `/package-request` carries: a business chosen by its request link.
class PackageRequestFormArguments {
  const PackageRequestFormArguments({this.slug = ''});

  final String slug;
}

/// Who is asking: the signed-in customer, as the form needs them.
class RequestCustomer {
  const RequestCustomer({required this.uid, this.name = '', this.phone = ''});

  final String uid;
  final String name;
  final String phone;

  /// The signed-in, non-anonymous customer, or null.
  static RequestCustomer? of(BuildContext context, {bool listen = true}) {
    final AuthProvider auth;
    try {
      auth = Provider.of<AuthProvider>(context, listen: listen);
    } on ProviderNotFoundException {
      return null;
    }
    final user = auth.user;
    if (user == null || user.isAnonymous) return null;
    return RequestCustomer(
      uid: user.uid,
      name: auth.customerName ?? '',
      phone: auth.customerPhone ?? auth.normalizedPhone ?? '',
    );
  }
}

/// A picked photo, compressed by the picker.
class PickedRequestPhoto {
  const PickedRequestPhoto(this.bytes);

  final Uint8List bytes;
}

typedef RequestPhotoPicker =
    Future<PickedRequestPhoto?> Function(ImageSource source);

/// The camera or the library, through the picker's own compression: about
/// 1.5 MB for a phone photo (`requestPhotoMaxWidth`, `requestPhotoQuality`).
Future<PickedRequestPhoto?> pickRequestPhoto(ImageSource source) async {
  final picked = await ImagePicker().pickImage(
    source: source,
    maxWidth: requestPhotoMaxWidth,
    maxHeight: requestPhotoMaxWidth,
    imageQuality: requestPhotoQuality,
  );
  if (picked == null) return null;
  return PickedRequestPhoto(await picked.readAsBytes());
}

/// A photo on the form: its bytes (for the preview), then its Storage path
/// once uploaded. Photos are added before a business is chosen and go into
/// the chosen business's folder when the request is sent.
class _Photo {
  _Photo(this.bytes);

  final Uint8List bytes;
  String path = '';

  /// The business whose folder [path] is in.
  String uploadedFor = '';
  bool uploading = false;
  bool failed = false;
}

/// A category priced by the pound: its pounds field and the size button
/// last tapped.
class _WeightLine {
  _WeightLine(this.categoryId);

  final String categoryId;
  final controller = TextEditingController();
  String sizePreset = '';

  BasketWeight get value => BasketWeight(
    categoryId: categoryId,
    weightLb: parseWeightLb(controller.text),
    sizePreset: sizePreset,
  );
}

/// "Something else": described in words, with photos.
class _ElsePiece {
  final description = TextEditingController();
  final photos = <_Photo>[];

  BasketOther get value => BasketOther(
    description: description.text,
    photoPaths: [
      for (final p in photos)
        if (p.path.isNotEmpty) p.path,
    ],
  );
}

/// "Send a package": country, Sea or Air, what is being sent, how it gets to
/// the business, a comparison of the businesses with the total for these
/// items, the day and 2-hour window, then who sends and who receives - each
/// step shown once the one before it is answered (docs/PACKAGE_PRICE_LIST.md
/// §6). Opened from a business's own link it shows that business only.
class PackageRequestFormScreen extends StatefulWidget {
  const PackageRequestFormScreen({
    super.key,
    this.slug = '',
    this.service,
    this.customer,
    this.photoPicker = pickRequestPhoto,
    this.clock = DateTime.now,
    this.addressSuggestions,
  });

  /// A business chosen by its `/r/<slug>` link.
  final String slug;
  final PackageRequestService? service;

  /// Who is asking; read from the signed-in profile when null.
  final RequestCustomer? customer;
  final RequestPhotoPicker photoPicker;
  final DateTime Function() clock;

  /// Pickup address suggestions; the server's (`suggestPickupAddresses`)
  /// when null.
  final Future<List<BarrelAddressSuggestion>> Function(String query)?
  addressSuggestions;

  @override
  State<PackageRequestFormScreen> createState() =>
      _PackageRequestFormScreenState();
}

class _PackageRequestFormScreenState extends State<PackageRequestFormScreen> {
  late final PackageRequestService _service =
      widget.service ?? FirebasePackageRequestService();

  late final Future<List<BarrelAddressSuggestion>> Function(String)
  _suggestions =
      widget.addressSuggestions ??
      (query) => BarrelShipmentService().addressSuggestions(query);

  RequestOptions? _options;
  Object? _loadError;
  bool _loading = true;
  Timer? _safety;

  String _countryId = '';
  String _mode = '';

  // What is being sent.
  final _qty = <String, int>{};
  final _weights = <_WeightLine>[];
  int _barrels = 0;
  final _others = <_ElsePiece>[];

  // How it gets to the business.
  String _handoff = '';
  final _pickupAddress = TextEditingController();
  StructuredAddress _pickupAddressValue = StructuredAddress.empty;
  Map<String, PickupQuote>? _quotes;
  String _quotesAddress = '';
  bool _quoting = false;
  Object? _quoteError;

  // The comparison.
  String _sort = 'best';
  CompareFilters _filters = const CompareFilters();
  String _businessId = '';

  // When.
  String _locationId = '';
  String _plannedDate = '';
  String _plannedWindow = '';
  String _pickupDate = '';
  String _pickupWindow = '';
  final _pickupNote = TextEditingController();

  // Who.
  final _senderName = TextEditingController();
  final _senderPhone = TextEditingController();
  final _receiverName = TextEditingController();
  final _receiverPhone = TextEditingController();
  bool _prefilled = false;

  /// What the catalog of the chosen country and mode was built for.
  String _catalogFor = '';
  RequestCatalog _catalog = const RequestCatalog();

  /// One key for this form: a Send repeated after a lost answer returns the
  /// request the first one made.
  final String _idempotencyKey = newRequestIdempotencyKey();

  Set<String> _errors = {};
  String _banner = '';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _safety?.cancel();
    for (final c in [
      _pickupAddress,
      _pickupNote,
      _senderName,
      _senderPhone,
      _receiverName,
      _receiverPhone,
    ]) {
      c.dispose();
    }
    for (final w in _weights) {
      w.controller.dispose();
    }
    for (final o in _others) {
      o.description.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    // A call that never answers is a spinner that never stops.
    _safety?.cancel();
    _safety = Timer(const Duration(seconds: 20), () {
      if (mounted && _loading) {
        setState(() {
          _loading = false;
          _loadError = const RequestFailure(
            RequestRefusal(code: 'unavailable'),
          );
        });
      }
    });
    try {
      final options = await _service.listOptions(slug: widget.slug);
      if (!mounted) return;
      _safety?.cancel();
      setState(() {
        _options = options;
        _loading = false;
        final countries = options.countries;
        if (countries.length == 1) _pickCountryId(countries.first.id);
      });
    } catch (error) {
      if (!mounted) return;
      _safety?.cancel();
      setState(() {
        _loadError = error;
        _loading = false;
      });
    }
  }

  void _prefill(RequestCustomer customer) {
    if (_prefilled) return;
    _prefilled = true;
    if (_senderName.text.isEmpty) _senderName.text = customer.name;
    if (_senderPhone.text.isEmpty && isRequestPhone(customer.phone)) {
      _senderPhone.text = customer.phone;
    }
  }

  String get _language =>
      Localizations.localeOf(context).languageCode == 'fr' ? 'fr' : 'en';

  DateTime get _today => requestToday(widget.clock());

  /// Whether the form came through a business's own link / QR (decision 4).
  bool get _fromBusinessLink =>
      widget.slug.isNotEmpty || _options?.business != null;

  void _clear(Iterable<String> codes) {
    if (codes.any(_errors.contains) || _banner.isNotEmpty) {
      _errors = {..._errors}..removeAll(codes);
      _banner = '';
    }
  }

  // -------------------------------------------------------------------------
  // What the customer chose, and what follows from it.
  // -------------------------------------------------------------------------

  List<RequestOption> get _countryOptions => _countryId.isEmpty
      ? const []
      : (_options?.forCountry(_countryId) ?? const []);

  List<RequestOption> get _offered => offeredForMode(_countryOptions, _mode);

  /// The catalog of the country and mode, built once per choice.
  RequestCatalog get _theCatalog {
    final key = '$_countryId|$_mode';
    if (_catalogFor != key) {
      _catalogFor = key;
      _catalog = _mode.isEmpty
          ? const RequestCatalog()
          : buildRequestCatalog(_offered, _mode);
    }
    return _catalog;
  }

  RequestBasket get _basket => RequestBasket(
    items: {
      for (final e in _qty.entries)
        if (e.value > 0) e.key: e.value,
    },
    weights: [for (final w in _weights) w.value],
    barrels: _barrels,
    others: [for (final o in _others) o.value],
  );

  String get _composedAddress => _pickupAddressValue
      .withStreetLine(_pickupAddress.text)
      .composeLine()
      .trim();

  bool get _quotesFresh =>
      _quotes != null && _quotesAddress == _composedAddress;

  /// A row per business, with the basket priced at its list.
  List<ComparisonRow> get _rows => comparisonRows(
    options: _offered,
    mode: _mode,
    catalog: _theCatalog,
    basket: _basket,
    handoff: _handoff,
    quotes: _quotesFresh ? _quotes! : const {},
  );

  ComparisonRow? _chosenRow(List<ComparisonRow> rows) {
    for (final r in rows) {
      if (r.option.businessId == _businessId && r.available) return r;
    }
    return null;
  }

  /// Keeps the chosen business one the customer can still choose, and picks
  /// the only one there is.
  void _reconcileBusiness() {
    final ready =
        _handoff == requestHandoffBringIn ||
        (_handoff == requestHandoffCollect && _quotesFresh);
    final ids = [
      if (ready && _mode.isNotEmpty)
        for (final r in _rows)
          if (r.available) r.option.businessId,
    ];
    if (!ids.contains(_businessId)) _setBusiness('');
    if (_businessId.isEmpty && ids.length == 1) _setBusiness(ids.single);
  }

  void _setBusiness(String id) {
    if (id == _businessId) return;
    _businessId = id;
    // Another business: another place, other hours.
    _locationId = '';
    _plannedDate = '';
    _plannedWindow = '';
    final option = _optionOf(id);
    if (option != null && option.locations.length == 1) {
      _locationId = option.locations.first.id;
    }
    _errors = {};
    _banner = '';
  }

  RequestOption? _optionOf(String id) {
    if (id.isEmpty) return null;
    for (final o in _offered) {
      if (o.businessId == id) return o;
    }
    return null;
  }

  void _pickCountryId(String id) {
    if (id == _countryId) return;
    _countryId = id;
    _qty.clear();
    for (final w in _weights) {
      w.controller.dispose();
    }
    _weights.clear();
    _barrels = 0;
    // Air is a choice only where some business ships by air.
    _mode = anyOfferedForMode(_countryOptions, 'air') ? '' : 'sea';
    _quotes = null;
    _quotesAddress = '';
    _businessId = '';
    _errors = {};
    _banner = '';
    _reconcileBusiness();
  }

  void _pickMode(String mode) {
    if (mode == _mode) return;
    _mode = mode;
    // Keep what the other mode's catalog also has.
    final catalog = _theCatalog;
    _qty.removeWhere((key, _) => catalog.item(key) == null);
    _weights.removeWhere((w) {
      final gone = !catalog.perLbCategoryIds.contains(w.categoryId);
      if (gone) w.controller.dispose();
      return gone;
    });
    if (!catalog.barrel) _barrels = 0;
    _businessId = '';
    _errors = {};
    _banner = '';
    _reconcileBusiness();
  }

  bool get _canAddPiece => _basket.pieceCount < requestMaxPieces;

  Future<void> _chooseCountry() async {
    final l10n = AppLocalizations.of(context)!;
    final countries = _options?.countries ?? const [];
    final picked = await pickLotSearchableOption<String>(
      context,
      title: l10n.prqPickCountry,
      searchHint: l10n.prqSearchCountry,
      selected: _countryId,
      sections: [
        LotOptionSection(l10n.prqStepCountry, [
          for (final c in countries) LotOption(c.id, c.name),
        ]),
      ],
    );
    if (picked == null || !mounted) return;
    AppHaptics.selection();
    setState(() => _pickCountryId(picked));
  }

  Future<void> _chooseLocation() async {
    final l10n = AppLocalizations.of(context)!;
    final option = _optionOf(_businessId);
    if (option == null) return;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.prqDropOffAt,
      selected: _locationId,
      options: [
        for (final l in option.locations)
          LotOption(
            l.id,
            l.title,
            detail: l.label.isNotEmpty && l.address.isNotEmpty
                ? l.address
                : null,
          ),
      ],
    );
    if (picked == null || !mounted) return;
    setState(() {
      _locationId = picked;
      _plannedDate = '';
      _plannedWindow = '';
      _clear(const [
        'location_invalid',
        'planned_day_closed',
        'window_invalid',
      ]);
    });
  }

  RequestLocation? get _location {
    final option = _optionOf(_businessId);
    if (option == null) return null;
    for (final l in option.locations) {
      if (l.id == _locationId) return l;
    }
    return null;
  }

  /// Now, in minutes after midnight, in the shop's zone.
  int get _nowMinutes {
    final wall = easternWall(widget.clock());
    return wall.hour * 60 + wall.minute;
  }

  /// The windows left on [day] for a drop-off at the chosen location.
  List<RequestTimeWindow> _dropOffWindowsOn(DateTime day) {
    final hours = _location?.hours?.forDate(day);
    if (hours == null) return const [];
    final isToday = requestDayKey(day) == requestDayKey(_today);
    return dropOffWindows(hours, afterMinutes: isToday ? _nowMinutes : null);
  }

  Future<void> _chooseDay({required bool pickup}) async {
    final today = _today;
    final current = requestDayFromKey(pickup ? _pickupDate : _plannedDate);
    final picked = await pickCalendarDay(
      context,
      initial: current ?? today,
      first: today,
      last: requestLastPlannedDay(today),
      // A closed day, or one with no window left, cannot be picked.
      selectable: pickup
          ? null
          : (day) => _location?.hours == null
                ? true
                : _dropOffWindowsOn(day).isNotEmpty,
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (pickup) {
        _pickupDate = requestDayKey(picked);
        _pickupWindow = '';
        _clear(const ['pickup_date_invalid']);
      } else {
        _plannedDate = requestDayKey(picked);
        _plannedWindow = '';
        _clear(const [
          'planned_date_invalid',
          'planned_day_closed',
          'window_invalid',
        ]);
      }
    });
  }

  Future<void> _seePrices() async {
    if (_quoting) return;
    final address = _composedAddress;
    if (address.isEmpty) {
      setState(() => _errors = {..._errors, 'pickup_address_required'});
      return;
    }
    final ids = [
      for (final o in _offered)
        if (o.collectAvailable) o.businessId,
    ].take(20).toList();
    setState(() {
      _quoting = true;
      _quoteError = null;
      _errors = {..._errors}..remove('pickup_address_required');
    });
    try {
      final quotes = await _service
          .pickupQuotes(address: address, businessIds: ids)
          .timeout(const Duration(seconds: 25));
      if (!mounted) return;
      setState(() {
        _quotes = quotes;
        _quotesAddress = address;
        _reconcileBusiness();
      });
    } on TimeoutException {
      if (!mounted) return;
      setState(
        () => _quoteError = const RequestFailure(
          RequestRefusal(code: 'unavailable'),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _quoteError = error);
    } finally {
      if (mounted) setState(() => _quoting = false);
    }
  }

  // -------------------------------------------------------------------------
  // Photos.
  // -------------------------------------------------------------------------

  Future<void> _addPhoto(_ElsePiece piece) async {
    final l10n = AppLocalizations.of(context)!;
    if (piece.photos.length >= requestMaxPhotosPerPiece) return;
    final source = await pickLotOption<ImageSource>(
      context,
      title: l10n.prqAddPhoto,
      options: [
        LotOption(ImageSource.camera, l10n.prqTakePhoto),
        LotOption(ImageSource.gallery, l10n.prqChoosePhoto),
      ],
    );
    if (source == null || !mounted) return;
    PickedRequestPhoto? picked;
    try {
      picked = await widget.photoPicker(source);
    } catch (_) {
      picked = null;
    }
    if (picked == null || !mounted) return;
    final problem = requestPhotoProblem(picked.bytes);
    if (problem != null) {
      showErrorSnackBar(
        context,
        problem == 'photo_too_large'
            ? l10n.prqPhotoTooLarge
            : l10n.prqPhotoNotImage,
      );
      return;
    }
    setState(() => piece.photos.add(_Photo(picked!.bytes)));
  }

  /// Uploads every photo into [businessId]'s folder (a photo already there
  /// stays). False when one could not go up.
  Future<bool> _uploadPhotos(String businessId) async {
    for (final piece in _others) {
      for (final photo in piece.photos) {
        if (photo.path.isNotEmpty && photo.uploadedFor == businessId) continue;
        setState(() {
          photo.uploading = true;
          photo.failed = false;
        });
        try {
          final path = await _service.uploadPhoto(
            businessId: businessId,
            bytes: photo.bytes,
            contentType: sniffRequestPhotoType(photo.bytes) ?? 'image/jpeg',
          );
          if (!mounted) return false;
          photo.path = path;
          photo.uploadedFor = businessId;
        } catch (_) {
          if (!mounted) return false;
          setState(() => photo.failed = true);
          return false;
        } finally {
          if (mounted) setState(() => photo.uploading = false);
        }
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Send.
  // -------------------------------------------------------------------------

  RequestDraft _draft(RequestOption option) {
    final windowParts = _plannedWindow.split('-');
    final bring = _handoff == requestHandoffBringIn;
    return RequestDraft(
      businessId: option.businessId,
      destinationCountryId: option.countryId,
      handoff: _handoff,
      locationId: _locationId,
      plannedDate: _plannedDate,
      pickupAddress: _composedAddress,
      pickupDate: _pickupDate,
      pickupWindow: _pickupWindow,
      pickupNote: _pickupNote.text,
      senderName: _senderName.text,
      senderPhone: _senderPhone.text,
      receiverName: _receiverName.text,
      receiverPhone: _receiverPhone.text,
      pieces: basketDrafts(_basket, _theCatalog, option, _mode),
      language: _language,
      idempotencyKey: _idempotencyKey,
      shipMode: _mode,
      foundVia: _fromBusinessLink ? 'business' : 'laawol',
      channel: 'app',
      plannedWindow: bring && windowParts.length == 2
          ? RequestTimeWindow(from: windowParts[0], to: windowParts[1])
          : null,
    );
  }

  /// Reasons that have no field of their own: said above the button.
  static const _bannerReasons = {
    'handoff_invalid',
    'pieces_required',
    'too_many_pieces',
    'too_many_photos',
    'text_too_long',
    'photo_invalid',
    'piece_kind_invalid',
    'size_invalid',
    'ship_mode_invalid',
    'air_unavailable',
    'quantity_invalid',
    'category_invalid',
  };

  Future<void> _send() async {
    final l10n = AppLocalizations.of(context)!;
    final row = _chosenRow(_rows);
    if (_busy || row == null) return;
    final option = row.option;
    final draft = _draft(option);
    final reasons = validateRequestDraft(
      draft,
      option: option,
      today: _today,
      requireWindow: true,
    );
    if (reasons.isNotEmpty) {
      AppHaptics.refuse();
      setState(() {
        _errors = reasons.toSet();
        final general = reasons.where(_bannerReasons.contains).toList();
        _banner = general.isEmpty
            ? l10n.prqFixErrors
            : requestReasonText(l10n, general.first) ?? l10n.prqFixErrors;
      });
      return;
    }
    setState(() {
      _busy = true;
      _banner = '';
      _errors = {};
    });
    try {
      if (!await _uploadPhotos(option.businessId)) {
        if (!mounted) return;
        AppHaptics.refuse();
        setState(() => _banner = l10n.spkErrPhotoUpload);
        return;
      }
      final sent = await _service.submit(submitRequestPayload(_draft(option)));
      if (!mounted) return;
      AppHaptics.commit();
      final locale = dateLocaleOf(context);
      final collect = _handoff == requestHandoffCollect;
      final day = collect ? _pickupDate : _plannedDate;
      final window = collect ? _pickupWindow : _plannedWindow;
      final parts = window.split('-');
      final windowText = parts.length == 2
          ? requestWindowShortText(parts[0], parts[1], _language)
          : null;
      final dayText = compareDayText(day, locale);
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => PackageRequestSentScreen(
            submitted: sent,
            businessName: option.businessName,
            collect: collect,
            service: _service,
            when: windowText == null
                ? dayText
                : l10n.prqDayWindow(dayText, windowText),
            where: collect
                ? _composedAddress
                : (_location?.address.isNotEmpty ?? false)
                ? _location!.address
                : (_location?.title ?? ''),
            weighs: row.basket.weighsAtCounter,
          ),
        ),
      );
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() {
        _errors = failure.refusal.reasons.toSet();
        _banner = requestRefusalText(l10n, failure.refusal);
      });
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _banner = l10n.prqErrGeneric);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _errorFor(AppLocalizations l10n, List<String> codes) {
    for (final code in codes) {
      if (_errors.contains(code)) return requestReasonText(l10n, code);
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Build.
  // -------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final customer = widget.customer ?? RequestCustomer.of(context);
    if (customer != null) _prefill(customer);
    final business = _options?.business;

    // Nobody has to sign in to ask for an estimate: a signed-out phone fills
    // the form (its name and WhatsApp number included) and the service starts
    // a guest session at the first photo or at Send, as the website does.
    Widget body;
    if (_loading) {
      body = const Center(child: CircularProgressIndicator());
    } else if (_loadError != null) {
      body = Center(
        child: RequestLoadFailed(
          message: requestErrorText(l10n, _loadError!),
          onRetry: _load,
        ),
      );
    } else if (business != null && !business.acceptRequests) {
      body = LotEmptyState(
        key: const Key('request-business-stopped'),
        icon: Icons.do_not_disturb_on_outlined,
        title: l10n.prqBusinessStopped(business.name),
      );
    } else if ((_options?.options ?? const []).isEmpty) {
      body = LotEmptyState(
        key: const Key('request-no-options'),
        icon: Icons.inventory_2_outlined,
        title: l10n.prqNoOptions,
      );
    } else {
      body = _form(l10n);
    }

    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          RequestPageHeader(
            title: l10n.prqSendPackage,
            subtitle: business?.name,
          ),
          Expanded(child: body),
        ],
      ),
    );
  }

  Widget _form(AppLocalizations l10n) {
    final options = _options!;
    final countryName =
        options.countries.where((c) => c.id == _countryId).firstOrNull?.name ??
        '';
    final countryOptions = _countryOptions;
    final airAvailable = anyOfferedForMode(countryOptions, 'air');
    return ListView(
      key: const Key('request-form'),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        48,
      ),
      children: [
        RequestSectionTitle(l10n.prqStepCountry),
        LotPickerField(
          key: const Key('request-country'),
          label: l10n.prqStepCountry,
          value: countryName,
          placeholder: l10n.prqPickCountry,
          onTap: _chooseCountry,
        ),
        if (_countryId.isNotEmpty && countryOptions.isEmpty)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.md),
            child: Text(
              l10n.prqNoBusinesses,
              style: const TextStyle(color: AppColors.muted),
            ),
          ),
        if (_countryId.isNotEmpty && airAvailable) ..._modeStep(l10n),
        if (_countryId.isNotEmpty && _mode.isNotEmpty)
          ..._afterMode(l10n, countryName),
      ],
    );
  }

  List<Widget> _modeStep(AppLocalizations l10n) => [
    RequestSectionTitle(l10n.spkStepMode),
    _Segments(
      keyPrefix: 'request-mode',
      values: priceModes,
      labels: [l10n.spkModeSea, l10n.spkModeAir],
      selected: _mode,
      onChanged: (mode) => setState(() {
        _pickMode(mode);
        _clear(const ['ship_mode_invalid']);
      }),
    ),
    if (_errorFor(l10n, const ['ship_mode_invalid']) case final String e)
      Padding(
        padding: const EdgeInsets.only(top: 5, left: 4),
        child: Text(
          e,
          style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
        ),
      ),
  ];

  List<Widget> _afterMode(AppLocalizations l10n, String countryName) {
    final offered = _offered;
    if (offered.isEmpty) {
      return [
        const SizedBox(height: AppSpacing.md),
        Text(
          _mode == 'air'
              ? l10n.spkNoBusinessAir(countryName)
              : l10n.spkNoBusinessSea(countryName),
          key: const Key('request-no-business-mode'),
          style: const TextStyle(color: AppColors.muted),
        ),
      ];
    }
    final locale = dateLocaleOf(context);
    final rows = _handoff.isEmpty ? const <ComparisonRow>[] : _rows;
    final chosen = _chosenRow(rows);
    return [
      ..._itemsStep(l10n, countryName),
      ..._handoffStep(l10n, offered),
      if (_handoff.isNotEmpty) ..._compareStep(l10n, rows, chosen, locale),
      if (chosen != null) ..._whenStep(l10n, chosen, locale),
      if (chosen != null) ..._peopleAndSend(l10n, chosen),
    ];
  }

  // -------------------------------------------------------------------------
  // Step: what is being sent.
  // -------------------------------------------------------------------------

  List<Widget> _itemsStep(AppLocalizations l10n, String countryName) {
    final catalog = _theCatalog;
    final canAdd = _canAddPiece;
    return [
      RequestSectionTitle(l10n.prqPieces),
      Text(
        l10n.spkItemsIntro(countryName),
        style: const TextStyle(
          fontSize: 13,
          height: 1.4,
          color: AppColors.muted,
        ),
      ),
      const SizedBox(height: AppSpacing.sm),
      for (final item in catalog.items)
        RequestCatalogRow(
          key: ValueKey('request-item:${item.key}'),
          keyPrefix: 'request-item-${item.key}',
          title: item.label,
          note: item.includedLb > 0
              ? l10n.spkUpToLbEach(priceLbText(item.includedLb))
              : null,
          quantity: _qty[item.key] ?? 0,
          max: (_qty[item.key] ?? 0) > 0 || canAdd ? requestMaxQuantity : 0,
          onChanged: (n) => setState(() {
            if (n <= 0) {
              _qty.remove(item.key);
            } else {
              _qty[item.key] = n;
            }
            _clear(const ['pieces_required', 'quantity_invalid']);
          }),
        ),
      if (catalog.barrel)
        RequestCatalogRow(
          key: const Key('request-barrels'),
          keyPrefix: 'request-barrels',
          title: l10n.prqKindBarrel,
          note: l10n.spkBarrelRowNote,
          quantity: _barrels,
          max: canAdd ? requestMaxQuantity : _barrels,
          onChanged: (n) => setState(() {
            _barrels = n;
            _clear(const ['pieces_required']);
          }),
        ),
      if (catalog.perLbCategoryIds.isNotEmpty) ..._byWeight(l10n, catalog),
      ..._elsePieces(l10n),
    ];
  }

  List<Widget> _byWeight(AppLocalizations l10n, RequestCatalog catalog) {
    final language = _language;
    return [
      RequestSectionTitle(l10n.spkByWeightTitle),
      Text(
        l10n.spkByWeightHint,
        style: const TextStyle(
          fontSize: 13,
          height: 1.4,
          color: AppColors.muted,
        ),
      ),
      const SizedBox(height: AppSpacing.sm),
      Wrap(
        spacing: AppSpacing.sm,
        runSpacing: AppSpacing.sm,
        children: [
          for (final id in catalog.perLbCategoryIds)
            RequestPill(
              key: Key('request-add-weight:$id'),
              label: l10n.spkAddWeight(
                priceCategoryOf(id)?.label(language) ?? id,
              ),
              selected: false,
              onTap: !_canAddPiece
                  ? () {}
                  : () => setState(() {
                      _weights.add(_WeightLine(id));
                      _clear(const ['pieces_required']);
                    }),
            ),
        ],
      ),
      const SizedBox(height: AppSpacing.sm),
      for (var i = 0; i < _weights.length; i++)
        _weightEditor(l10n, i, _weights[i], language),
    ];
  }

  Widget _weightEditor(
    AppLocalizations l10n,
    int index,
    _WeightLine line,
    String language,
  ) {
    final bad =
        _errors.contains('weight_invalid') && line.value.weightLb == null;
    return RequestCard(
      key: ObjectKey(line),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  priceCategoryOf(line.categoryId)?.label(language) ??
                      line.categoryId,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              IconButton(
                key: Key('request-remove-weight:$index'),
                tooltip: l10n.spkRemoveWeight,
                visualDensity: VisualDensity.compact,
                onPressed: () => setState(() {
                  _weights.removeAt(index).controller.dispose();
                }),
                icon: const Icon(Icons.close, size: 18, color: AppColors.muted),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              for (final preset in sizePresets)
                RequestPill(
                  key: Key('request-size:$index:${preset.id}'),
                  label: l10n.spkSizeButton(
                    preset.label(language),
                    '${preset.lb}',
                  ),
                  selected: line.sizePreset == preset.id,
                  onTap: () => setState(() {
                    line.sizePreset = preset.id;
                    line.controller.text = '${preset.lb}';
                    _clear(const ['weight_invalid']);
                  }),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          TextField(
            key: Key('request-weight:$index'),
            controller: line.controller,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
              LengthLimitingTextInputFormatter(7),
            ],
            onChanged: (text) => setState(() {
              final preset = sizePresets
                  .where((p) => p.id == line.sizePreset)
                  .firstOrNull;
              if (preset != null && parseWeightLb(text) != preset.lb) {
                line.sizePreset = '';
              }
              _clear(const ['weight_invalid']);
            }),
            decoration: InputDecoration(
              labelText: l10n.spkWeightLabel,
              errorText: bad ? l10n.spkErrWeight : null,
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _elsePieces(AppLocalizations l10n) {
    return [
      RequestSectionTitle(l10n.spkElseTitle),
      Text(
        l10n.spkElseNote,
        style: const TextStyle(
          fontSize: 13,
          height: 1.4,
          color: AppColors.muted,
        ),
      ),
      const SizedBox(height: AppSpacing.sm),
      for (var i = 0; i < _others.length; i++) _elseEditor(l10n, i, _others[i]),
      Align(
        alignment: Alignment.centerLeft,
        child: TextButton(
          key: const Key('request-add-else'),
          onPressed: _canAddPiece
              ? () => setState(() {
                  _others.add(_ElsePiece());
                  _clear(const ['pieces_required']);
                })
              : null,
          child: Text(l10n.spkElseAdd),
        ),
      ),
    ];
  }

  Widget _elseEditor(AppLocalizations l10n, int index, _ElsePiece piece) {
    final bad =
        _errors.contains('piece_description_required') &&
        pieceNeedsDescription(
          RequestPieceDraft(
            kind: requestPieceOther,
            description: piece.description.text,
          ),
        );
    return RequestCard(
      key: ObjectKey(piece),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: Key('request-else-description:$index'),
                  controller: piece.description,
                  maxLength: requestMaxDescription,
                  textCapitalization: TextCapitalization.sentences,
                  onChanged: (_) => setState(
                    () => _clear(const ['piece_description_required']),
                  ),
                  decoration: InputDecoration(
                    labelText: l10n.prqWhatIsIt,
                    hintText: l10n.prqWhatIsItHint,
                    counterText: '',
                    errorText: bad ? l10n.prqErrPieceDescription : null,
                  ),
                ),
              ),
              IconButton(
                key: Key('request-remove-else:$index'),
                tooltip: l10n.prqRemovePiece,
                visualDensity: VisualDensity.compact,
                onPressed: () => setState(() {
                  _others.removeAt(index).description.dispose();
                }),
                icon: const Icon(Icons.close, size: 18, color: AppColors.muted),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              for (final photo in piece.photos)
                _PhotoTile(
                  photo: photo,
                  onRemove: () => setState(() => piece.photos.remove(photo)),
                  onRetry: () => setState(() => photo.failed = false),
                ),
              if (piece.photos.length < requestMaxPhotosPerPiece)
                OutlinedButton.icon(
                  key: Key('request-add-photo:$index'),
                  onPressed: () => _addPhoto(piece),
                  icon: const Icon(Icons.add_a_photo_outlined, size: 18),
                  label: Text(l10n.prqAddPhoto),
                ),
            ],
          ),
          if (piece.photos.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                l10n.prqPhotosCount(
                  piece.photos.length,
                  requestMaxPhotosPerPiece,
                ),
                style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
              ),
            ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Step: how it gets to the business.
  // -------------------------------------------------------------------------

  List<Widget> _handoffStep(
    AppLocalizations l10n,
    List<RequestOption> offered,
  ) {
    final bringAny = offered.any((o) => o.bringInAvailable);
    final collectAny = offered.any((o) => o.collectAvailable);
    return [
      RequestSectionTitle(l10n.prqStepHandoff),
      LotChoiceCard(
        key: const Key('request-bring-in'),
        title: l10n.prqBringIn,
        note: bringAny ? l10n.prqBringInNote : l10n.prqUnavailableNote,
        selected: _handoff == requestHandoffBringIn,
        enabled: bringAny,
        onTap: () => setState(() {
          _handoff = requestHandoffBringIn;
          _pickupAddress.clear();
          _pickupAddressValue = StructuredAddress.empty;
          _pickupNote.clear();
          _pickupDate = '';
          _pickupWindow = '';
          _quotes = null;
          _quotesAddress = '';
          _clear(const ['handoff_invalid']);
          _reconcileBusiness();
        }),
      ),
      LotChoiceCard(
        key: const Key('request-collect'),
        title: l10n.spkPickUp,
        note: collectAny ? l10n.spkPickUpNote : l10n.prqUnavailableNote,
        selected: _handoff == requestHandoffCollect,
        enabled: collectAny,
        onTap: () => setState(() {
          _handoff = requestHandoffCollect;
          _plannedDate = '';
          _plannedWindow = '';
          _clear(const ['handoff_invalid']);
          _reconcileBusiness();
        }),
      ),
      if (_handoff == requestHandoffCollect) _pickupAddressStep(l10n),
    ];
  }

  Widget _pickupAddressStep(AppLocalizations l10n) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        RequestSectionTitle(l10n.spkPickupAddressTitle),
        // The app's one pickup address form (street, unit, city...) with
        // its suggestions; the composed line is what the request carries.
        StructuredAddressFields(
          key: const Key('request-pickup-address'),
          controller: _pickupAddress,
          value: _pickupAddressValue,
          enabled: !_busy,
          streetLabel: l10n.prqPickupAddress,
          fetchSuggestions: _suggestions,
          onChanged: (address, _) => setState(() {
            _pickupAddressValue = address;
            _clear(const ['pickup_address_required']);
            // Fees are for one address: a changed one asks again.
            if (!_quotesFresh) _reconcileBusiness();
          }),
        ),
        if (_errorFor(l10n, const ['pickup_address_required'])
            case final String e)
          Padding(
            padding: const EdgeInsets.only(top: 5, left: 4),
            child: Text(
              e,
              key: const Key('request-pickup-address-error'),
              style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
            ),
          ),
        if (_quoteError != null)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.sm),
            child: Text(
              requestErrorText(l10n, _quoteError!),
              key: const Key('request-quote-error'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
            ),
          ),
        const SizedBox(height: AppSpacing.md),
        RequestPrimaryButton(
          key: const Key('request-see-prices'),
          label: l10n.spkSeePrices,
          busyLabel: l10n.spkSeePricesBusy,
          busy: _quoting,
          onTap: _seePrices,
        ),
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Step: the comparison.
  // -------------------------------------------------------------------------

  List<Widget> _compareStep(
    AppLocalizations l10n,
    List<ComparisonRow> rows,
    ComparisonRow? chosen,
    String locale,
  ) {
    final collect = _handoff == requestHandoffCollect;
    // A pickup is priced once the address has been checked.
    if (collect && !_quotesFresh) return const [];
    final basket = _basket;
    final single = _fromBusinessLink;
    final shown = single
        ? rows
        : arrangeRows(rows, sort: _sort, filters: _filters);
    return [
      RequestSectionTitle(single ? l10n.spkStepYourPrice : l10n.spkStepCompare),
      if (!basket.hasPriceable)
        Text(
          l10n.spkAddItemsHint,
          key: const Key('request-add-items-hint'),
          style: const TextStyle(fontSize: 13, color: AppColors.muted),
        )
      else ...[
        if (!single)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            child: RequestCompareControls(
              sort: _sort,
              filters: _filters,
              onSort: (s) => setState(() => _sort = s),
              onFilters: (f) => setState(() => _filters = f),
            ),
          ),
        if (shown.isEmpty)
          Text(
            l10n.spkNoRowsFiltered,
            key: const Key('request-no-rows'),
            style: const TextStyle(color: AppColors.muted),
          ),
        for (final row in shown)
          RequestComparisonCard(
            key: ValueKey('request-business:${row.option.businessId}'),
            row: row,
            locale: locale,
            showRadio: !single,
            selected: chosen?.option.businessId == row.option.businessId,
            onTap: () {
              AppHaptics.selection();
              setState(() => _setBusiness(row.option.businessId));
            },
          ),
        if (!single && shown.where((r) => r.available).length > 1)
          Text(
            l10n.spkChooseHint,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
      ],
    ];
  }

  // -------------------------------------------------------------------------
  // Step: when.
  // -------------------------------------------------------------------------

  List<Widget> _whenStep(
    AppLocalizations l10n,
    ComparisonRow chosen,
    String locale,
  ) {
    final collect = _handoff == requestHandoffCollect;
    return [
      RequestSectionTitle(
        collect ? l10n.spkStepWhenPickup : l10n.spkStepWhenBring,
      ),
      if (collect) _pickupWhen(l10n, locale) else _bringWhen(l10n, locale),
    ];
  }

  Widget _windowsBlock(
    AppLocalizations l10n, {
    required List<RequestTimeWindow>? windows,
    required String selected,
    required ValueChanged<RequestTimeWindow> onChanged,
    required String? error,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: AppSpacing.md),
        Text(
          l10n.spkWindowTitle,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: 6),
        if (windows == null)
          Text(
            l10n.spkPickDayFirst,
            key: const Key('request-windows-hint'),
            style: const TextStyle(fontSize: 13, color: AppColors.muted),
          )
        else if (windows.isEmpty)
          Text(
            l10n.spkNoWindowsLeft,
            key: const Key('request-windows-none'),
            style: const TextStyle(fontSize: 13, color: AppColors.errorRed),
          )
        else
          RequestWindowChips(
            keyPrefix: 'request-window',
            windows: windows,
            selected: selected,
            languageCode: _language,
            onChanged: onChanged,
          ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(top: 5, left: 4),
            child: Text(
              error,
              key: const Key('request-window-error'),
              style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
            ),
          ),
        const SizedBox(height: 6),
        Text(
          l10n.spkWindowNote,
          style: const TextStyle(
            fontSize: 12.5,
            height: 1.35,
            color: AppColors.muted,
          ),
        ),
      ],
    );
  }

  Widget _bringWhen(AppLocalizations l10n, String locale) {
    final option = _optionOf(_businessId)!;
    final location = _location;
    final day = requestDayFromKey(_plannedDate);
    final hours = day == null ? null : location?.hours?.forDate(day);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (option.locations.length > 1) ...[
          LotPickerField(
            key: const Key('request-location'),
            label: l10n.prqDropOffAt,
            value: location?.title,
            placeholder: l10n.prqDropOffAt,
            onTap: _chooseLocation,
            error: _errorFor(l10n, const ['location_invalid']),
          ),
          const SizedBox(height: AppSpacing.md),
        ] else if (location != null) ...[
          RequestCard(
            color: AppColors.parchment,
            child: Row(
              children: [
                const Icon(
                  Icons.storefront_outlined,
                  size: 18,
                  color: AppColors.cobaltDeep,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    [
                      location.label,
                      location.address,
                    ].where((s) => s.isNotEmpty).join(' · '),
                    style: const TextStyle(
                      fontSize: 13.5,
                      color: AppColors.ink,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
        ],
        LotPickerField(
          key: const Key('request-planned-day'),
          label: l10n.prqPlannedDay,
          value: _plannedDate.isEmpty
              ? null
              : requestDayText(_plannedDate, locale),
          placeholder: l10n.prqPickDay,
          onTap: location == null ? () {} : () => _chooseDay(pickup: false),
          error: _errorFor(l10n, const [
            'planned_date_invalid',
            'planned_day_closed',
          ]),
        ),
        if (hours != null) ...[
          const SizedBox(height: 6),
          Text(
            hours.open
                ? l10n.prqHoursOn(
                    requestClockText(hours.from, locale),
                    requestClockText(hours.to, locale),
                  )
                : l10n.prqClosedThatDay,
            key: const Key('request-hours-note'),
            style: TextStyle(
              fontSize: 12.5,
              height: 1.35,
              color: !hours.open ? AppColors.errorRed : AppColors.muted,
            ),
          ),
        ],
        _windowsBlock(
          l10n,
          windows: day == null ? null : _dropOffWindowsOn(day),
          selected: _plannedWindow,
          error: _errorFor(l10n, const ['window_invalid']),
          onChanged: (w) => setState(() {
            _plannedWindow = requestWindowKey(w);
            _clear(const ['window_invalid']);
          }),
        ),
      ],
    );
  }

  Widget _pickupWhen(AppLocalizations l10n, String locale) {
    final day = requestDayFromKey(_pickupDate);
    final isToday = day != null && requestDayKey(day) == requestDayKey(_today);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LotPickerField(
          key: const Key('request-pickup-day'),
          label: l10n.prqPickupDay,
          value: _pickupDate.isEmpty
              ? null
              : requestDayText(_pickupDate, locale),
          placeholder: l10n.prqPickDay,
          onTap: () => _chooseDay(pickup: true),
          error: _errorFor(l10n, const ['pickup_date_invalid']),
        ),
        _windowsBlock(
          l10n,
          windows: day == null
              ? null
              : pickupWindowSlots(afterMinutes: isToday ? _nowMinutes : null),
          selected: _pickupWindow,
          error: _errors.contains('pickup_window_invalid')
              ? l10n.spkErrWindow
              : null,
          onChanged: (w) => setState(() {
            _pickupWindow = requestWindowKey(w);
            _clear(const ['pickup_window_invalid']);
          }),
        ),
        const SizedBox(height: AppSpacing.md),
        TextField(
          key: const Key('request-pickup-note'),
          controller: _pickupNote,
          maxLength: requestMaxNote,
          minLines: 1,
          maxLines: 3,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            labelText: l10n.prqPickupNote,
            counterText: '',
          ),
        ),
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Step: who, and Send.
  // -------------------------------------------------------------------------

  List<Widget> _peopleAndSend(AppLocalizations l10n, ComparisonRow chosen) {
    final option = chosen.option;
    final receiverCountry =
        CallingCodeCatalog.countryCodeForReference(option.countryId) ??
        CallingCodeCatalog.countryCodeForReference(option.countryName) ??
        'US';
    final collect = _handoff == requestHandoffCollect;
    final basket = chosen.basket;
    final ready = basket.allPriced && !chosen.feePending;
    return [
      RequestSectionTitle(l10n.prqSender),
      TextField(
        key: const Key('request-sender-name'),
        controller: _senderName,
        maxLength: requestMaxName,
        textCapitalization: TextCapitalization.words,
        onChanged: (_) =>
            setState(() => _clear(const ['sender_name_required'])),
        decoration: InputDecoration(
          labelText: l10n.prqSenderName,
          counterText: '',
          errorText: _errorFor(l10n, const ['sender_name_required']),
        ),
      ),
      const SizedBox(height: AppSpacing.md),
      CountryPhoneField(
        key: const Key('request-sender-phone'),
        controller: _senderPhone,
        labelText: l10n.prqSenderPhone,
        helperText: l10n.prqSenderPhoneHint,
        errorText: _errorFor(l10n, const ['sender_phone_invalid']),
        onChanged: (_) =>
            setState(() => _clear(const ['sender_phone_invalid'])),
      ),
      RequestSectionTitle(l10n.prqReceiver),
      TextField(
        key: const Key('request-receiver-name'),
        controller: _receiverName,
        maxLength: requestMaxName,
        textCapitalization: TextCapitalization.words,
        onChanged: (_) =>
            setState(() => _clear(const ['receiver_name_required'])),
        decoration: InputDecoration(
          labelText: l10n.prqReceiverName,
          counterText: '',
          errorText: _errorFor(l10n, const ['receiver_name_required']),
        ),
      ),
      const SizedBox(height: AppSpacing.md),
      CountryPhoneField(
        key: const Key('request-receiver-phone'),
        controller: _receiverPhone,
        labelText: l10n.prqReceiverPhone,
        initialCountryCode: receiverCountry,
        errorText: _errorFor(l10n, const ['receiver_phone_invalid']),
        onChanged: (_) =>
            setState(() => _clear(const ['receiver_phone_invalid'])),
      ),
      const SizedBox(height: AppSpacing.lg),
      Text(
        ready
            ? (collect
                  ? l10n.spkSendReadyPickup(
                      formatRequestCents(basket.totalCents ?? 0),
                    )
                  : l10n.spkSendReadyBring(
                      formatRequestCents(basket.totalCents ?? 0),
                    ))
            : l10n.spkSendQuote(option.businessName),
        key: const Key('request-estimate-note'),
        style: const TextStyle(
          fontSize: 13,
          height: 1.4,
          color: AppColors.muted,
        ),
      ),
      if (basket.weighsAtCounter)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            l10n.spkSendWeighed,
            key: const Key('request-weighed-note'),
            style: const TextStyle(
              fontSize: 13,
              height: 1.4,
              color: AppColors.muted,
            ),
          ),
        ),
      const SizedBox(height: AppSpacing.md),
      if (_banner.isNotEmpty)
        RequestBanner(
          key: const Key('request-form-banner'),
          text: _banner,
          icon: Icons.error_outline,
          color: AppColors.errorRed,
        ),
      RequestPrimaryButton(
        key: const Key('request-send'),
        label: l10n.prqSendRequest,
        busyLabel: l10n.prqSending,
        busy: _busy,
        onTap: _send,
      ),
    ];
  }
}

/// A row of equal segments that wraps its labels instead of clipping them.
class _Segments extends StatelessWidget {
  const _Segments({
    required this.keyPrefix,
    required this.values,
    required this.labels,
    required this.selected,
    required this.onChanged,
  });

  final String keyPrefix;
  final List<String> values;
  final List<String> labels;
  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (var i = 0; i < values.length; i++) ...[
          if (i > 0) const SizedBox(width: 6),
          Expanded(
            child: PressableScale(
              key: Key('$keyPrefix:${values[i]}'),
              scale: 0.97,
              onTap: () {
                AppHaptics.selection();
                onChanged(values[i]);
              },
              child: AnimatedContainer(
                duration: AppMotion.press,
                padding: const EdgeInsets.symmetric(
                  vertical: 10,
                  horizontal: 4,
                ),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected == values[i]
                      ? AppColors.mist
                      : AppColors.parchment,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                  border: Border.all(
                    color: selected == values[i]
                        ? AppColors.cobalt
                        : AppColors.rule,
                    width: selected == values[i] ? 1.5 : 1,
                  ),
                ),
                child: Text(
                  labels[i],
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: selected == values[i]
                        ? AppColors.cobaltDeep
                        : AppColors.ink,
                  ),
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _PhotoTile extends StatelessWidget {
  const _PhotoTile({
    required this.photo,
    required this.onRemove,
    required this.onRetry,
  });

  final _Photo photo;
  final VoidCallback onRemove;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return SizedBox(
      width: 64,
      height: 64,
      child: Stack(
        fit: StackFit.expand,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            child: Image.memory(
              photo.bytes,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => Container(color: AppColors.parchment),
            ),
          ),
          if (photo.uploading)
            Container(
              color: Colors.black26,
              alignment: Alignment.center,
              child: const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: Colors.white,
                ),
              ),
            ),
          if (photo.failed)
            Material(
              color: Colors.black45,
              borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              child: InkWell(
                onTap: onRetry,
                child: Tooltip(
                  message: l10n.prqPhotoFailed,
                  child: const Icon(Icons.refresh, color: Colors.white),
                ),
              ),
            ),
          Positioned(
            top: -6,
            right: -6,
            child: IconButton(
              tooltip: l10n.prqRemovePhoto,
              visualDensity: VisualDensity.compact,
              onPressed: onRemove,
              icon: const Icon(Icons.cancel, size: 18, color: Colors.white),
            ),
          ),
        ],
      ),
    );
  }
}

/// After Send: what happens next. A request priced in full is confirmed -
/// "You're all set", with when and where and the total; one with items to
/// quote says who sends the price (docs/PACKAGE_PRICE_LIST.md §3).
class PackageRequestSentScreen extends StatelessWidget {
  const PackageRequestSentScreen({
    super.key,
    required this.submitted,
    required this.businessName,
    required this.collect,
    this.service,
    this.when = '',
    this.where = '',
    this.weighs = false,
  });

  final RequestSubmitted submitted;
  final String businessName;
  final bool collect;
  final PackageRequestService? service;

  /// "Thu, Nov 6, 2–4 PM": the day and window the customer chose.
  final String when;

  /// The drop-off address, or the pickup address.
  final String where;

  /// Some item is priced by weight and weighed at the counter.
  final bool weighs;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = submitted.status == requestStatusConfirmed;
    final ready = submitted.status == requestStatusEstimateSent;
    final total = submitted.totalCents;
    final steps = [
      ready ? l10n.prqNext1Ready : l10n.prqNext1(businessName),
      l10n.prqNext2,
      collect ? l10n.prqNext3Collect : l10n.prqNext3Bring,
    ];
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            const SizedBox(height: AppSpacing.xl),
            const Icon(
              Icons.check_circle_outline,
              size: 48,
              color: AppColors.sage,
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              confirmed
                  ? (collect
                        ? l10n.spkSentAllSetPickup(when, where)
                        : l10n.spkSentAllSetBring(when, where))
                  : l10n.prqSentTitle,
              key: const Key('request-sent-title'),
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: confirmed ? 18 : 22,
                height: 1.3,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              l10n.prqSentTo(businessName),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 14, color: AppColors.muted),
            ),
            if (!confirmed && !ready)
              Padding(
                padding: const EdgeInsets.only(top: AppSpacing.sm),
                child: Text(
                  l10n.spkSentToQuote(businessName),
                  key: const Key('request-sent-quote'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.4,
                    color: AppColors.ink,
                  ),
                ),
              ),
            const SizedBox(height: AppSpacing.lg),
            RequestCard(
              child: Column(
                children: [
                  Text(
                    l10n.prqSentCode,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: 4),
                  SelectableText(
                    submitted.code,
                    key: const Key('request-sent-code'),
                    style: const TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.5,
                      color: AppColors.cobaltDeep,
                    ),
                  ),
                ],
              ),
            ),
            if (confirmed) ...[
              if (total != null)
                Text(
                  l10n.spkSentTotal(formatRequestCents(total)),
                  key: const Key('request-sent-total'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              const SizedBox(height: 4),
              Text(
                collect ? l10n.prqPayAtPickup : l10n.prqPayAtDropOff,
                key: const Key('request-sent-pay'),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 14, color: AppColors.muted),
              ),
              if (weighs)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    l10n.spkSendWeighed,
                    key: const Key('request-sent-weighed'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 13.5,
                      height: 1.4,
                      color: AppColors.muted,
                    ),
                  ),
                ),
            ] else ...[
              RequestSectionTitle(l10n.prqNextSteps),
              for (var i = 0; i < steps.length; i++)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.md),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 24,
                        height: 24,
                        alignment: Alignment.center,
                        decoration: const BoxDecoration(
                          color: AppColors.mist,
                          shape: BoxShape.circle,
                        ),
                        child: Text(
                          '${i + 1}',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: AppColors.cobaltDeep,
                          ),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: Text(
                          steps[i],
                          key: Key('request-next-step:$i'),
                          style: const TextStyle(
                            fontSize: 14,
                            height: 1.4,
                            color: AppColors.ink,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
            const SizedBox(height: AppSpacing.md),
            RequestPrimaryButton(
              key: const Key('request-see-request'),
              label: l10n.prqSeeRequest,
              onTap: () => Navigator.of(context).pushReplacement(
                MaterialPageRoute<void>(
                  builder: (_) => PackageRequestDetailScreen(
                    requestId: submitted.requestId,
                    token: submitted.token,
                    service: service,
                  ),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextButton(
              key: const Key('request-sent-done'),
              onPressed: () => Navigator.of(context).maybePop(),
              child: Text(l10n.done),
            ),
          ],
        ),
      ),
    );
  }
}
