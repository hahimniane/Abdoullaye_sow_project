import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';

import '../l10n/app_localizations.dart';
import '../data/country_catalog.dart';
import '../data/us_locations.dart';
import '../models/structured_address.dart';
import '../services/barrel_shipment_service.dart';
import '../theme/app_colors.dart';
import '../utils/nyc_borough.dart';

/// The customer's pickup address as separate, editable fields
/// (docs/PLAN-2026-08-backlog.md item 1).
///
/// Web twin: `StructuredAddressFields` in
/// admin_web/src/components/address-autocomplete.tsx. Both surfaces compose the
/// parts with the same rules ([StructuredAddress.composeLine]) because the
/// composed line is what the pricing and checkout callables receive — a client
/// that composes differently prices differently.
///
/// Two rules this widget exists to enforce:
///   * The apartment/unit is the customer's own field. A suggestion never
///     overwrites it: Google autocompletes buildings, not units, so its
///     `subpremise` is nearly always empty and letting it win is what silently
///     dropped unit numbers.
///   * Nobody is forced to accept a suggestion. The street box is a plain text
///     field, and every other part stays editable after a suggestion lands.
///
/// Unlike the web twin, the state and country boxes are free text rather than
/// pickers: the app carries no US-state or country catalog, and inventing one
/// here would be a second source of truth for names the server already
/// normalises when it geocodes.
class StructuredAddressFields extends StatefulWidget {
  const StructuredAddressFields({
    super.key,
    required this.controller,
    required this.value,
    required this.onChanged,
    required this.fetchSuggestions,
    this.streetValidator,
    this.streetLabel,
    this.streetHint,
    this.enabled = true,
    this.showLocateMe = false,
  });

  /// Controller for the street line only. It stays with the caller so an
  /// existing screen keeps its `clear()`-on-submit and initial-value wiring.
  final TextEditingController controller;

  /// The whole address. [StructuredAddress.streetLine] is expected to track
  /// [controller]; the other parts are owned by this widget's own boxes.
  final StructuredAddress value;

  /// The chosen suggestion travels with the change so a caller can apply its
  /// extras (the pickup borough) in the same state update rather than in a
  /// second, racing one. It is null when the customer typed the change.
  final void Function(StructuredAddress value, BarrelAddressSuggestion? suggestion)
  onChanged;

  /// Address suggestions for a query. Errors are swallowed by the caller's
  /// service or here — a failing suggestion service must never block typing.
  final Future<List<BarrelAddressSuggestion>> Function(String query)
  fetchSuggestions;

  /// Validates the street box. The other parts are deliberately unvalidated:
  /// only the street line is required, matching the web twin, so a customer
  /// who types a whole address into one box still checks out.
  final String? Function(String?)? streetValidator;

  final String? streetLabel;
  final String? streetHint;
  final bool enabled;

  /// Shows the "use my current location" button under the fields.
  final bool showLocateMe;

  @override
  State<StructuredAddressFields> createState() =>
      _StructuredAddressFieldsState();
}

class _StructuredAddressFieldsState extends State<StructuredAddressFields> {
  late final FocusNode _focusNode;
  late final TextEditingController _apartmentController;
  late final TextEditingController _cityController;
  late final TextEditingController _stateController;
  late final TextEditingController _postalCodeController;
  late final TextEditingController _countryController;

  // Version counter for stale-request detection inside _buildOptions.
  // NOT tied to setState — mutations here never trigger a rebuild, which is
  // intentional: we pass _buildOptions as a method tearoff so that
  // RawAutocomplete.didUpdateWidget sees oldWidget.optionsBuilder ==
  // widget.optionsBuilder and skips _updateOptions(), breaking the loop where
  // every setState call re-triggered a new suggestion fetch.
  var _optionsVersion = 0;
  bool _isLocating = false;

  @override
  void initState() {
    super.initState();
    _focusNode = FocusNode();
    _apartmentController = TextEditingController(text: widget.value.apartment);
    _cityController = TextEditingController(text: widget.value.city);
    _stateController = TextEditingController(text: widget.value.state);
    _postalCodeController = TextEditingController(text: widget.value.postalCode);
    _countryController = TextEditingController(text: widget.value.country);
  }

  @override
  void didUpdateWidget(StructuredAddressFields oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Pull the parts back in when the owner changed them (a suggestion landed,
    // or the form was reset after checkout). Skipping equal values is what
    // keeps the caret still while the customer types: the parent echoes the
    // same text straight back on every keystroke.
    _syncField(_apartmentController, widget.value.apartment);
    _syncField(_cityController, widget.value.city);
    _syncField(_stateController, widget.value.state);
    _syncField(_postalCodeController, widget.value.postalCode);
    _syncField(_countryController, widget.value.country);
  }

  static void _syncField(TextEditingController controller, String value) {
    if (controller.text == value) return;
    controller.value = TextEditingValue(
      text: value,
      selection: TextSelection.collapsed(offset: value.length),
    );
  }

  @override
  void dispose() {
    _focusNode.dispose();
    _apartmentController.dispose();
    _cityController.dispose();
    _stateController.dispose();
    _postalCodeController.dispose();
    _countryController.dispose();
    super.dispose();
  }

  void _emit(StructuredAddress value, [BarrelAddressSuggestion? suggestion]) {
    widget.onChanged(value, suggestion);
  }

  // ─── Suggestions (FutureOr — no setState, no infinite loop) ──────────────

  Future<Iterable<BarrelAddressSuggestion>> _buildOptions(
    TextEditingValue value,
  ) async {
    final query = value.text.trim();
    if (query.isEmpty) return const [];

    final version = ++_optionsVersion;
    // Debounce: wait for the user to pause typing.
    await Future.delayed(const Duration(milliseconds: 380));
    if (version != _optionsVersion) return const [];

    // 1. Firebase Function (Google Places) — works when user is signed in.
    try {
      final remote = await widget.fetchSuggestions(query);
      if (version != _optionsVersion) return const [];
      if (remote.isNotEmpty) {
        return remote;
      }
    } catch (_) {}

    // 2. Nominatim (OpenStreetMap) — free, real addresses, no key needed.
    try {
      final results = await _nominatimSuggestions(query);
      if (version != _optionsVersion) return const [];
      return results;
    } catch (_) {
      return const [];
    }
  }

  Future<List<BarrelAddressSuggestion>> _nominatimSuggestions(
    String query,
  ) async {
    final uri = Uri.https('nominatim.openstreetmap.org', '/search', {
      'q': '$query, New York',
      'format': 'jsonv2',
      'limit': '6',
      'countrycodes': 'us',
      'addressdetails': '1',
    });
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 7);
    try {
      final req = await client.getUrl(uri);
      req.headers.set(HttpHeaders.userAgentHeader, 'Laawol-App/1.0');
      req.headers.set(HttpHeaders.acceptLanguageHeader, 'en-US,en;q=0.9');
      final res = await req.close();
      if (res.statusCode != 200) return const [];
      final body = await res.transform(utf8.decoder).join();
      final data = jsonDecode(body) as List<dynamic>;
      return data
          .whereType<Map<String, dynamic>>()
          .map(_formatNominatim)
          .whereType<BarrelAddressSuggestion>()
          .take(5)
          .toList();
    } finally {
      client.close();
    }
  }

  BarrelAddressSuggestion? _formatNominatim(Map<String, dynamic> result) {
    final addr = (result['address'] as Map?)?.cast<String, dynamic>();
    if (addr == null) return null;
    final houseNo = addr['house_number'] as String? ?? '';
    final road = addr['road'] as String? ?? '';
    final postcode = addr['postcode'] as String? ?? '';
    final borough =
        nycBoroughFromAddress(
          [
            addr['borough'] as String? ?? '',
            addr['city_district'] as String? ?? '',
            addr['county'] as String? ?? '',
            postcode,
          ].where((s) => s.isNotEmpty).join(', '),
        ) ??
        nycBoroughFromAddress(result['display_name'] as String? ?? '');
    if (houseNo.isEmpty || road.isEmpty || borough == null) return null;
    final street = [houseNo, road].where((s) => s.isNotEmpty).join(' ');
    final description = [
      street,
      borough,
      'NY',
      postcode,
    ].where((s) => s.isNotEmpty).join(', ');
    final lat = double.tryParse(result['lat'] as String? ?? '');
    final lon = double.tryParse(result['lon'] as String? ?? '');
    return BarrelAddressSuggestion(
      description: description,
      placeId: result['place_id']?.toString() ?? '',
      borough: borough,
      postalCode: postcode.isEmpty ? null : postcode,
      formattedAddress: result['display_name'] as String?,
      latitude: lat,
      longitude: lon,
      // Nominatim already hands back the parts, so the split fields fill in
      // even on the fallback path instead of dumping one line in the street
      // box.
      streetLine: street,
      city: borough,
      stateCode: 'NY',
      country: addr['country'] as String?,
    );
  }

  // ─── GPS locate ──────────────────────────────────────────────────────────

  Future<void> _locateMe() async {
    setState(() => _isLocating = true);
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.deniedForever) {
        if (mounted) await Geolocator.openAppSettings();
        return;
      }
      if (permission == LocationPermission.denied) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                AppLocalizations.of(context)!.locationPermissionDenied,
              ),
            ),
          );
        }
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      );
      final placemarks = await Geocoding().placemarkFromCoordinates(
        position.latitude,
        position.longitude,
      );
      if (placemarks.isEmpty || !mounted) return;

      final p = placemarks.first;
      // The apartment is kept: GPS resolves a building, never a unit, so
      // overwriting it here would drop what the customer typed — the same bug
      // a suggestion is barred from causing.
      final located = StructuredAddress(
        streetLine: p.street ?? '',
        apartment: widget.value.apartment,
        city: p.locality?.isNotEmpty == true
            ? p.locality!
            : (p.subLocality ?? ''),
        state: p.administrativeArea ?? '',
        postalCode: p.postalCode ?? '',
        country: p.country ?? '',
      );

      widget.controller.text = located.streetLine;
      _emit(located);
      _focusNode.requestFocus();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.couldNotGetLocation),
        ),
      );
    } finally {
      if (mounted) setState(() => _isLocating = false);
    }
  }

  // ─── Build ────────────────────────────────────────────────────────────────

  InputDecoration _decoration({
    required String label,
    String? hint,
    String? helper,
    Widget? prefixIcon,
  }) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      helperText: helper,
      helperMaxLines: 2,
      prefixIcon: prefixIcon,
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
        borderSide: const BorderSide(color: AppColors.errorRed),
      ),
      filled: true,
      fillColor: AppColors.lightSurfaceVariant,
    );
  }

  /// A dropdown over a known catalog that still honours whatever is already
  /// stored: a legacy or geocoded value outside the catalog is offered as its
  /// own option rather than silently blanked.
  Widget _catalogField({
    required String label,
    required String value,
    required List<String> options,
    required StructuredAddress Function(String) apply,
  }) {
    final trimmed = value.trim();
    final all = <String>[
      if (trimmed.isNotEmpty && !options.contains(trimmed)) trimmed,
      ...options,
    ];
    return DropdownButtonFormField<String>(
      // Long names ("United States Minor Outlying Islands") overflow without
      // this and paint a debug stripe over the field.
      isExpanded: true,
      initialValue: trimmed.isEmpty ? null : trimmed,
      decoration: InputDecoration(labelText: label),
      items: [
        for (final option in all)
          DropdownMenuItem(value: option, child: Text(option)),
      ],
      onChanged: widget.enabled
          ? (selected) => widget.onChanged(apply(selected ?? ''), null)
          : null,
    );
  }

  Widget _partField({
    required TextEditingController controller,
    required String label,
    required StructuredAddress Function(String) apply,
    String? hint,
    String? helper,
    TextInputType? keyboardType,
    TextCapitalization capitalization = TextCapitalization.words,
  }) {
    return TextFormField(
      controller: controller,
      enabled: widget.enabled,
      keyboardType: keyboardType,
      textCapitalization: capitalization,
      onChanged: (value) => _emit(apply(value)),
      decoration: _decoration(label: label, hint: hint, helper: helper),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        RawAutocomplete<BarrelAddressSuggestion>(
          textEditingController: widget.controller,
          focusNode: _focusNode,
          displayStringForOption: (option) => option.description,
          // Method tearoff — equal across rebuilds so didUpdateWidget never
          // spuriously re-triggers _updateOptions and restarts the fetch.
          optionsBuilder: _buildOptions,
          onSelected: (selection) {
            // `current:` is what protects the apartment the customer already
            // typed from the suggestion's (almost always empty) subpremise.
            final next = selection.toStructuredAddress(current: widget.value);
            // RawAutocomplete has already written displayStringForOption into
            // the box; the street box holds the street line only, so overwrite
            // it after.
            widget.controller.text = next.streetLine;
            _emit(next, selection);
            _focusNode.requestFocus();
          },
          fieldViewBuilder:
              (context, textEditingController, focusNode, onFieldSubmitted) {
                return TextFormField(
                  controller: textEditingController,
                  focusNode: focusNode,
                  enabled: widget.enabled,
                  validator: widget.streetValidator,
                  onChanged: (value) =>
                      _emit(widget.value.withStreetLine(value)),
                  keyboardType: TextInputType.streetAddress,
                  decoration: _decoration(
                    label: widget.streetLabel ?? l10n.pickupAddressInNyc,
                    hint: widget.streetHint ?? l10n.pickupAddressNycHint,
                    prefixIcon: const Icon(Icons.location_on_outlined),
                  ),
                );
              },
          optionsViewBuilder: (context, onSelected, options) {
            return Align(
              alignment: Alignment.topLeft,
              child: Material(
                elevation: 4,
                borderRadius: BorderRadius.circular(8),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    maxHeight: 240,
                    maxWidth: 420,
                  ),
                  child: ListView.builder(
                    padding: EdgeInsets.zero,
                    shrinkWrap: true,
                    itemCount: options.length,
                    itemBuilder: (context, index) {
                      final option = options.elementAt(index);
                      return ListTile(
                        dense: true,
                        leading: const Icon(
                          Icons.place_outlined,
                          size: 20,
                          color: AppColors.cobaltDeep,
                        ),
                        title: Text(option.description),
                        subtitle: option.borough == null
                            ? null
                            : Text(
                                AppLocalizations.of(
                                  context,
                                )!.boroughPickupAddress(option.borough!),
                              ),
                        onTap: () => onSelected(option),
                      );
                    },
                  ),
                ),
              ),
            );
          },
        ),
        const SizedBox(height: 12),
        _partField(
          controller: _apartmentController,
          label: l10n.addressApartmentLabel,
          hint: l10n.addressApartmentHint,
          helper: l10n.addressApartmentHelper,
          capitalization: TextCapitalization.characters,
          apply: (value) => widget.value.copyWith(apartment: value),
        ),
        const SizedBox(height: 12),
        _partField(
          controller: _cityController,
          label: l10n.addressCityLabel,
          apply: (value) => widget.value.copyWith(city: value),
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              // A picker, not free text: the web console uses catalogs for
              // these, and "NY" typed on one device against "New York" picked
              // on the other is the same customer with two addresses.
              child: _catalogField(
                label: l10n.addressStateLabel,
                value: widget.value.state,
                options: usStateOptions(widget.value.state),
                apply: (value) => widget.value.copyWith(state: value),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _partField(
                controller: _postalCodeController,
                label: l10n.addressPostalCodeLabel,
                // Not a number pad: postal codes outside the US are
                // alphanumeric ("M5V 3L9", "SW1A 1AA").
                capitalization: TextCapitalization.characters,
                apply: (value) => widget.value.copyWith(postalCode: value),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        _catalogField(
          label: l10n.addressCountryLabel,
          value: widget.value.country,
          options: [
            for (final country in CountryCatalog.all) country.name,
          ],
          apply: (value) => widget.value.copyWith(country: value),
        ),
        if (widget.showLocateMe) ...[
          const SizedBox(height: 8),
          _LocateMeButton(
            isLocating: _isLocating,
            onTap: widget.enabled ? _locateMe : null,
          ),
        ],
      ],
    );
  }
}

class _LocateMeButton extends StatelessWidget {
  const _LocateMeButton({required this.isLocating, required this.onTap});

  final bool isLocating;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: isLocating ? null : onTap,
        borderRadius: BorderRadius.circular(8),
        splashColor: AppColors.cobaltDeep.withValues(alpha: 0.08),
        highlightColor: AppColors.cobaltDeep.withValues(alpha: 0.05),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: AppColors.cobaltDeep.withValues(alpha: 0.05),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: AppColors.cobaltDeep.withValues(alpha: 0.18),
            ),
          ),
          child: Row(
            children: [
              if (isLocating)
                const SizedBox(
                  width: 17,
                  height: 17,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation(AppColors.cobaltDeep),
                  ),
                )
              else
                const Icon(
                  Icons.my_location,
                  size: 17,
                  color: AppColors.cobaltDeep,
                ),
              const SizedBox(width: 10),
              Text(
                isLocating
                    ? AppLocalizations.of(context)!.gettingYourLocation
                    : AppLocalizations.of(context)!.useMyCurrentLocation,
                style: const TextStyle(
                  color: AppColors.cobaltDeep,
                  fontWeight: FontWeight.w700,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
