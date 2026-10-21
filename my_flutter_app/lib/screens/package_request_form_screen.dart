import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../data/calling_code_catalog.dart';
import '../l10n/app_localizations.dart';
import '../models/structured_address.dart';
import '../providers/auth_provider.dart';
import '../services/barrel_shipment_service.dart'
    show BarrelAddressSuggestion, BarrelShipmentService;
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
/// once uploaded.
class _Photo {
  _Photo(this.bytes);

  final Uint8List bytes;
  String path = '';
  bool uploading = false;
  bool failed = false;
}

class _Piece {
  String kind = requestPieceBarrel;
  final description = TextEditingController();
  final photos = <_Photo>[];

  RequestPieceDraft get draft => RequestPieceDraft(
    kind: kind,
    description: description.text,
    photoPaths: [
      for (final p in photos)
        if (p.path.isNotEmpty) p.path,
    ],
  );
}

/// "Send a package": a signed-in customer asks one business to take some
/// pieces. Country first, then the businesses that ship there, then how the
/// pieces reach them, who sends and who receives, and the pieces - each step
/// shown once the one before it is answered (§2).
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
  RequestOption? _option;
  String _handoff = '';
  String _locationId = '';
  String _plannedDate = '';
  final _pickupAddress = TextEditingController();
  StructuredAddress _pickupAddressValue = StructuredAddress.empty;
  String _pickupDate = '';
  String _pickupWindow = '';
  final _pickupNote = TextEditingController();
  final _senderName = TextEditingController();
  final _senderPhone = TextEditingController();
  final _receiverName = TextEditingController();
  final _receiverPhone = TextEditingController();
  final _pieces = <_Piece>[_Piece()];
  bool _prefilled = false;

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
    for (final p in _pieces) {
      p.description.dispose();
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

  void _clear(Iterable<String> codes) {
    if (codes.any(_errors.contains) || _banner.isNotEmpty) {
      _errors = {..._errors}..removeAll(codes);
      _banner = '';
    }
  }

  void _pickCountryId(String id) {
    if (id == _countryId) return;
    _countryId = id;
    final businesses = _options?.forCountry(id) ?? const [];
    _selectOption(businesses.length == 1 ? businesses.first : null);
  }

  void _selectOption(RequestOption? option) {
    final sameBusiness = option?.businessId == _option?.businessId;
    _option = option;
    _handoff = '';
    _locationId = '';
    _plannedDate = '';
    _pickupDate = '';
    _pickupWindow = '';
    // Photos are uploaded into the chosen business's folder: another
    // business could not read them, so they go with the choice.
    if (!sameBusiness) {
      for (final piece in _pieces) {
        piece.photos.clear();
      }
    }
    if (option != null) {
      if (option.locations.length == 1) _locationId = option.locations.first.id;
    }
    _errors = {};
    _banner = '';
  }

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
    final option = _option;
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
      _clear(const ['location_invalid', 'planned_day_closed']);
    });
  }

  Future<void> _chooseDay({required bool pickup}) async {
    final today = _today;
    final current = requestDayFromKey(pickup ? _pickupDate : _plannedDate);
    final picked = await pickCalendarDay(
      context,
      initial: current ?? today,
      first: today,
      last: requestLastPlannedDay(today),
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (pickup) {
        _pickupDate = requestDayKey(picked);
        _clear(const ['pickup_date_invalid']);
      } else {
        _plannedDate = requestDayKey(picked);
        _clear(const ['planned_date_invalid', 'planned_day_closed']);
      }
    });
  }

  Future<void> _addPhoto(_Piece piece) async {
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
    final photo = _Photo(picked.bytes);
    setState(() => piece.photos.add(photo));
    await _upload(photo);
  }

  Future<void> _upload(_Photo photo) async {
    final option = _option;
    if (option == null || photo.uploading) return;
    setState(() {
      photo.uploading = true;
      photo.failed = false;
    });
    try {
      final path = await _service.uploadPhoto(
        businessId: option.businessId,
        bytes: photo.bytes,
        contentType: sniffRequestPhotoType(photo.bytes) ?? 'image/jpeg',
      );
      if (!mounted) return;
      setState(() => photo.path = path);
    } catch (_) {
      if (!mounted) return;
      setState(() => photo.failed = true);
    } finally {
      if (mounted) setState(() => photo.uploading = false);
    }
  }

  RequestDraft _draft(RequestOption option) => RequestDraft(
    businessId: option.businessId,
    destinationCountryId: option.countryId,
    handoff: _handoff,
    locationId: _locationId,
    plannedDate: _plannedDate,
    pickupAddress: _pickupAddressValue
        .withStreetLine(_pickupAddress.text)
        .composeLine(),
    pickupDate: _pickupDate,
    pickupWindow: _pickupWindow,
    pickupNote: _pickupNote.text,
    senderName: _senderName.text,
    senderPhone: _senderPhone.text,
    receiverName: _receiverName.text,
    receiverPhone: _receiverPhone.text,
    pieces: [for (final p in _pieces) p.draft],
    language: _language,
    idempotencyKey: _idempotencyKey,
  );

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
  };

  Future<void> _send() async {
    final l10n = AppLocalizations.of(context)!;
    final option = _option;
    if (_busy || option == null) return;
    if (_pieces.any((p) => p.photos.any((ph) => ph.uploading))) {
      setState(() => _banner = l10n.prqWaitPhotos);
      return;
    }
    final draft = _draft(option);
    final reasons = validateRequestDraft(draft, option: option, today: _today);
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
      final sent = await _service.submit(submitRequestPayload(draft));
      if (!mounted) return;
      AppHaptics.commit();
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => PackageRequestSentScreen(
            submitted: sent,
            businessName: option.businessName,
            collect: _handoff == requestHandoffCollect,
            service: _service,
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
    final locale = dateLocaleOf(context);
    final options = _options!;
    final countryName =
        options.countries.where((c) => c.id == _countryId).firstOrNull?.name ??
        '';
    final businesses = _countryId.isEmpty
        ? const <RequestOption>[]
        : options.forCountry(_countryId);
    final option = _option;
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
        if (_countryId.isNotEmpty) ...[
          RequestSectionTitle(l10n.prqStepBusiness),
          if (businesses.isEmpty)
            Text(
              l10n.prqNoBusinesses,
              style: const TextStyle(color: AppColors.muted),
            )
          else
            for (final b in businesses)
              _BusinessCard(
                key: ValueKey('request-business:${b.businessId}'),
                option: b,
                selected: option?.businessId == b.businessId,
                onTap: () {
                  AppHaptics.selection();
                  setState(() => _selectOption(b));
                },
              ),
        ],
        if (option != null) ...[
          RequestSectionTitle(l10n.prqStepHandoff),
          LotChoiceCard(
            key: const Key('request-bring-in'),
            title: l10n.prqBringIn,
            note: option.bringInAvailable
                ? l10n.prqBringInNote
                : l10n.prqUnavailableNote,
            selected: _handoff == requestHandoffBringIn,
            enabled: option.bringInAvailable,
            onTap: () => setState(() {
              _handoff = requestHandoffBringIn;
              _pickupAddress.clear();
              _pickupAddressValue = StructuredAddress.empty;
              _pickupNote.clear();
              _pickupDate = '';
              _pickupWindow = '';
              _clear(const ['handoff_invalid']);
            }),
          ),
          LotChoiceCard(
            key: const Key('request-collect'),
            title: l10n.prqCollect,
            note: option.collectAvailable
                ? l10n.prqCollectNote
                : l10n.prqUnavailableNote,
            selected: _handoff == requestHandoffCollect,
            enabled: option.collectAvailable,
            onTap: () => setState(() {
              _handoff = requestHandoffCollect;
              _plannedDate = '';
              _clear(const ['handoff_invalid']);
            }),
          ),
          if (_handoff == requestHandoffBringIn)
            _bringFields(l10n, locale, option),
          if (_handoff == requestHandoffCollect)
            _collectFields(l10n, locale, option),
          if (_handoff.isNotEmpty) ..._peopleAndPieces(l10n, option),
        ],
      ],
    );
  }

  Widget _bringFields(
    AppLocalizations l10n,
    String locale,
    RequestOption option,
  ) {
    final location = option.locations
        .where((l) => l.id == _locationId)
        .firstOrNull;
    final day = requestDayFromKey(_plannedDate);
    final hours = day == null ? null : location?.hours?.forDate(day);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: AppSpacing.sm),
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
          onTap: () => _chooseDay(pickup: false),
          error: _errorFor(l10n, const [
            'planned_date_invalid',
            'planned_day_closed',
          ]),
        ),
        const SizedBox(height: 6),
        Text(
          hours == null
              ? l10n.prqPlanNote
              : hours.open
              ? l10n.prqHoursOn(
                  requestClockText(hours.from, locale),
                  requestClockText(hours.to, locale),
                )
              : l10n.prqClosedThatDay,
          key: const Key('request-hours-note'),
          style: TextStyle(
            fontSize: 12.5,
            height: 1.35,
            color: hours != null && !hours.open
                ? AppColors.errorRed
                : AppColors.muted,
          ),
        ),
      ],
    );
  }

  Widget _collectFields(
    AppLocalizations l10n,
    String locale,
    RequestOption option,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: AppSpacing.sm),
        if (option.collectAreas.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: Text(
              l10n.prqCollectAreas(option.collectAreas),
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
          ),
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
        const SizedBox(height: AppSpacing.md),
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
        const SizedBox(height: AppSpacing.md),
        Text(
          l10n.prqPickupWindow,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: 6),
        _Segments(
          keyPrefix: 'request-window',
          values: requestPickupWindows,
          labels: [
            for (final w in requestPickupWindows) requestWindowLabel(l10n, w),
          ],
          selected: _pickupWindow,
          onChanged: (w) => setState(() {
            _pickupWindow = w;
            _clear(const ['pickup_window_invalid']);
          }),
        ),
        if (_errorFor(l10n, const ['pickup_window_invalid'])
            case final String e)
          Padding(
            padding: const EdgeInsets.only(top: 5, left: 4),
            child: Text(
              e,
              style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
            ),
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
        const SizedBox(height: 6),
        Text(
          l10n.prqCollectTimeNote,
          style: const TextStyle(
            fontSize: 12.5,
            height: 1.35,
            color: AppColors.muted,
          ),
        ),
      ],
    );
  }

  List<Widget> _peopleAndPieces(AppLocalizations l10n, RequestOption option) {
    final receiverCountry =
        CallingCodeCatalog.countryCodeForReference(option.countryId) ??
        CallingCodeCatalog.countryCodeForReference(option.countryName) ??
        'US';
    final collect = _handoff == requestHandoffCollect;
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
      RequestSectionTitle(l10n.prqPieces),
      for (var i = 0; i < _pieces.length; i++)
        _PieceEditor(
          key: ObjectKey(_pieces[i]),
          index: i,
          piece: _pieces[i],
          option: option,
          showDescriptionError:
              _errors.contains('piece_description_required') &&
              pieceNeedsDescription(_pieces[i].draft),
          canRemove: _pieces.length > 1,
          onKind: (kind) => setState(() {
            _pieces[i].kind = kind;
            _clear(const ['piece_description_required']);
          }),
          onDescription: () =>
              setState(() => _clear(const ['piece_description_required'])),
          onRemove: () => setState(() {
            _pieces.removeAt(i).description.dispose();
          }),
          onAddPhoto: () => _addPhoto(_pieces[i]),
          onRemovePhoto: (photo) =>
              setState(() => _pieces[i].photos.remove(photo)),
          onRetryPhoto: _upload,
        ),
      if (_pieces.length < requestMaxPieces)
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            key: const Key('request-add-piece'),
            onPressed: () => setState(() {
              _pieces.add(_Piece());
              _clear(const ['pieces_required']);
            }),
            child: Text(l10n.prqAddPiece),
          ),
        ),
      const SizedBox(height: AppSpacing.md),
      Text(
        collect ? l10n.prqEstimateNoteCollect : l10n.prqEstimateNoteBring,
        key: const Key('request-estimate-note'),
        style: const TextStyle(
          fontSize: 13,
          height: 1.4,
          color: AppColors.muted,
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

class _BusinessCard extends StatelessWidget {
  const _BusinessCard({
    super.key,
    required this.option,
    required this.selected,
    required this.onTap,
  });

  final RequestOption option;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final price = option.barrelPriceCents;
    return LotChoiceCard(
      title: option.businessName,
      note: price == null
          ? l10n.prqBarrelOnEstimate
          : l10n.prqBarrelPrice(formatRequestCents(price)),
      selected: selected,
      onTap: onTap,
    );
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

class _PieceEditor extends StatelessWidget {
  const _PieceEditor({
    super.key,
    required this.index,
    required this.piece,
    required this.option,
    required this.showDescriptionError,
    required this.canRemove,
    required this.onKind,
    required this.onDescription,
    required this.onRemove,
    required this.onAddPhoto,
    required this.onRemovePhoto,
    required this.onRetryPhoto,
  });

  final int index;
  final _Piece piece;
  final RequestOption option;
  final bool showDescriptionError;
  final bool canRemove;
  final ValueChanged<String> onKind;
  final VoidCallback onDescription;
  final VoidCallback onRemove;
  final VoidCallback onAddPhoto;
  final ValueChanged<_Photo> onRemovePhoto;
  final ValueChanged<_Photo> onRetryPhoto;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final barrel = piece.kind == requestPieceBarrel;
    final price = option.barrelPriceCents;
    return RequestCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.prqPieceN(index + 1),
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              if (canRemove)
                IconButton(
                  key: Key('request-remove-piece:$index'),
                  tooltip: l10n.prqRemovePiece,
                  visualDensity: VisualDensity.compact,
                  onPressed: onRemove,
                  icon: const Icon(
                    Icons.close,
                    size: 18,
                    color: AppColors.muted,
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          _Segments(
            keyPrefix: 'request-kind-$index',
            values: requestPieceKinds,
            labels: [
              for (final k in requestPieceKinds) requestPieceKindLabel(l10n, k),
            ],
            selected: piece.kind,
            onChanged: onKind,
          ),
          const SizedBox(height: AppSpacing.sm),
          if (barrel)
            Text(
              price == null
                  ? l10n.prqBarrelOnEstimate
                  : l10n.prqBarrelPrice(formatRequestCents(price)),
              key: Key('request-barrel-price:$index'),
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.cobaltDeep,
              ),
            )
          else ...[
            TextField(
              key: Key('request-piece-description:$index'),
              controller: piece.description,
              maxLength: requestMaxDescription,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => onDescription(),
              decoration: InputDecoration(
                labelText: l10n.prqWhatIsIt,
                hintText: l10n.prqWhatIsItHint,
                counterText: '',
                errorText: showDescriptionError
                    ? l10n.prqErrPieceDescription
                    : null,
              ),
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
                    onRemove: () => onRemovePhoto(photo),
                    onRetry: () => onRetryPhoto(photo),
                  ),
                if (piece.photos.length < requestMaxPhotosPerPiece)
                  OutlinedButton.icon(
                    key: Key('request-add-photo:$index'),
                    onPressed: onAddPhoto,
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
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: AppColors.muted,
                  ),
                ),
              ),
          ],
        ],
      ),
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

/// After Send: the request code and what happens next (three steps).
class PackageRequestSentScreen extends StatelessWidget {
  const PackageRequestSentScreen({
    super.key,
    required this.submitted,
    required this.businessName,
    required this.collect,
    this.service,
  });

  final RequestSubmitted submitted;
  final String businessName;
  final bool collect;
  final PackageRequestService? service;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final ready = submitted.status == requestStatusEstimateSent;
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
              l10n.prqSentTitle,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 22,
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
