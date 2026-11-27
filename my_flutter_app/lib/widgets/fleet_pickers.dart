import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';

import '../data/car_catalog.dart';
import '../data/us_locations.dart';
import '../l10n/app_localizations.dart';
import '../services/barrel_shipment_service.dart';
import '../services/fleet_pickers.dart';
import '../theme/app_spacing.dart';
import 'fleet_widgets.dart';

// The pick lists the Fleet owner forms use instead of typed boxes
// (docs/FLEET.md section 16; website twin: components/business/
// fleet-pickers.tsx). Pure logic is in services/fleet_pickers.dart.

InputDecoration _dec(String label) => InputDecoration(
  labelText: label,
  isDense: true,
  border: OutlineInputBorder(
    borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
  ),
);

Widget _gap(Widget child) =>
    Padding(padding: const EdgeInsets.only(bottom: AppSpacing.md), child: child);

const _addNew = '__add_new__';

/// A fixed choice of a pick-or-add field: the stored [value] and its words.
class FleetFixedChoice {
  const FleetFixedChoice(this.value, this.label);
  final String value, label;
}

/// Pick one of the values this business already uses, or add a new one that
/// joins the list next time.
class FleetPickOrAdd extends StatefulWidget {
  const FleetPickOrAdd({
    super.key,
    required this.label,
    required this.value,
    required this.known,
    required this.onChanged,
    required this.addLabel,
    this.fixed = const [],
    this.enabled = true,
    this.maxLength = 80,
  });

  final String label, value, addLabel;
  final List<String> known;
  final List<FleetFixedChoice> fixed;
  final ValueChanged<String> onChanged;
  final bool enabled;
  final int maxLength;

  @override
  State<FleetPickOrAdd> createState() => _FleetPickOrAddState();
}

class _FleetPickOrAddState extends State<FleetPickOrAdd> {
  bool _adding = false;
  final _text = TextEditingController();
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _focus.addListener(() {
      if (!_focus.hasFocus && _adding) {
        final fixedValues = widget.fixed.map((f) => f.value).toList();
        final matched = fleetMatchKnown([
          ...fixedValues,
          ...widget.known,
        ], _text.text);
        _text.text = matched;
        widget.onChanged(matched);
      }
    });
  }

  @override
  void dispose() {
    _text.dispose();
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    if (_adding) {
      return _gap(
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: TextField(
                key: const Key('fleet-pick-add-text'),
                controller: _text,
                focusNode: _focus,
                enabled: widget.enabled,
                maxLength: widget.maxLength,
                autofocus: true,
                onChanged: widget.onChanged,
                decoration: _dec(widget.label).copyWith(counterText: ''),
              ),
            ),
            TextButton(
              key: const Key('fleet-pick-back'),
              onPressed: widget.enabled
                  ? () {
                      setState(() => _adding = false);
                      widget.onChanged(
                        fleetMatchKnown([
                          ...widget.fixed.map((f) => f.value),
                          ...widget.known,
                        ], _text.text),
                      );
                    }
                  : null,
              child: Text(l10n.fltPickBackToList),
            ),
          ],
        ),
      );
    }
    final fixedValues = widget.fixed.map((f) => f.value).toList();
    final saved = widget.known
        .where((k) => !fixedValues.any((f) => f.toLowerCase() == k.toLowerCase()))
        .toList();
    final all = [...fixedValues, ...saved];
    final current = fleetMatchKnown(all, widget.value);
    final extra = fleetOptionsWith(all, current)
        .where((o) => !all.contains(o))
        .toList();
    return _gap(
      DropdownButtonFormField<String>(
        key: ValueKey('pick-${widget.label}-$current'),
        isExpanded: true,
        initialValue: current,
        decoration: _dec(widget.label),
        items: [
          DropdownMenuItem(value: '', child: Text(l10n.fltPickNotSet)),
          for (final f in widget.fixed)
            DropdownMenuItem(value: f.value, child: Text(f.label)),
          for (final o in [...extra, ...saved])
            DropdownMenuItem(
              value: o,
              child: Text(o, overflow: TextOverflow.ellipsis),
            ),
          DropdownMenuItem(value: _addNew, child: Text(widget.addLabel)),
        ],
        onChanged: widget.enabled
            ? (v) {
                if (v == _addNew) {
                  _text.text = '';
                  widget.onChanged('');
                  setState(() => _adding = true);
                } else {
                  widget.onChanged(v ?? '');
                }
              }
            : null,
      ),
    );
  }
}

/// The weekday names, Monday first, in the person's language.
List<String> fleetWeekdayNames(AppLocalizations l10n) => [
  l10n.fltWeekdayMon,
  l10n.fltWeekdayTue,
  l10n.fltWeekdayWed,
  l10n.fltWeekdayThu,
  l10n.fltWeekdayFri,
  l10n.fltWeekdaySat,
  l10n.fltWeekdaySun,
];

/// The day a bill or insurance is due: 1-28 monthly, Monday-Sunday weekly
/// (stored 1-7). [value] 0 or null is "not set" when [emptyLabel] is given.
class FleetDueDayField extends StatelessWidget {
  const FleetDueDayField({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    this.weekly = false,
    this.enabled = true,
    this.emptyLabel,
  });

  final String label;
  final int? value;
  final bool weekly, enabled;
  final String? emptyLabel;
  final ValueChanged<int?> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final names = fleetWeekdayNames(l10n);
    final days = weekly ? fleetWeekdayNumbers : fleetMonthDays;
    final v = value ?? 0;
    // A day saved before the lists (a 30th) still shows as it was.
    final legacy = v > 0 && !days.contains(v) ? v : 0;
    return _gap(
      DropdownButtonFormField<int>(
        key: ValueKey('dueday-$label-$weekly-$v'),
        isExpanded: true,
        initialValue: emptyLabel == null && v == 0 ? days.first : v,
        decoration: _dec(label),
        items: [
          if (emptyLabel != null)
            DropdownMenuItem(value: 0, child: Text(emptyLabel!)),
          if (legacy > 0) DropdownMenuItem(value: legacy, child: Text('$legacy')),
          for (final d in days)
            DropdownMenuItem(
              value: d,
              child: Text(weekly ? names[d - 1] : '$d'),
            ),
        ],
        onChanged: enabled ? (d) => onChanged(d == null || d == 0 ? null : d) : null,
      ),
    );
  }
}

/// The reason's words in the person's language (stored in English).
String fleetChargeReasonLabel(AppLocalizations l10n, String reason) =>
    switch (reason) {
      'Ticket' => l10n.fltPickReasonTicket,
      'Toll' => l10n.fltPickReasonToll,
      'Damage repair' => l10n.fltPickReasonDamage,
      'Insurance deductible' => l10n.fltPickReasonDeductible,
      _ => l10n.fltPickReasonOther,
    };

/// What a charge is for: a reason from the list or "Something else", plus
/// details. The sheet saves [fleetComposeChargeLabel] of the two.
class FleetChargeReasonFields extends StatelessWidget {
  const FleetChargeReasonFields({
    super.key,
    required this.reason,
    required this.details,
    required this.onReason,
    this.enabled = true,
  });

  final String reason;
  final TextEditingController details;
  final ValueChanged<String> onReason;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _gap(
          DropdownButtonFormField<String>(
            key: const Key('fleet-charge-reason'),
            isExpanded: true,
            initialValue: reason,
            decoration: _dec(l10n.fltFieldWhatFor),
            items: [
              for (final r in fleetChargeReasons)
                DropdownMenuItem(
                  value: r,
                  child: Text(fleetChargeReasonLabel(l10n, r)),
                ),
              DropdownMenuItem(
                value: '',
                child: Text(l10n.fltPickReasonOther),
              ),
            ],
            onChanged: enabled ? (v) => onReason(v ?? '') : null,
          ),
        ),
        FleetField(
          controller: details,
          label: reason.isEmpty ? l10n.fltPickSayWhat : l10n.fltPickDetails,
          hint: reason == 'Ticket' ? l10n.fltPickTicketHint : null,
          maxLength: 100,
          enabled: enabled,
        ),
      ],
    );
  }
}

/// A driver's (or a friend's) address: the street is looked up with Google
/// as it is typed and fills the rest; state and city are lists from the
/// app's US catalog, "Other city" reveals a typed city. The controllers keep
/// the saved shape {line1, city, state, zip}; state is the two-letter code.
class FleetAddressFields extends StatefulWidget {
  const FleetAddressFields({
    super.key,
    required this.line1,
    required this.city,
    required this.state,
    required this.zip,
    this.enabled = true,
    this.fetchSuggestions,
  });

  final TextEditingController line1, city, state, zip;
  final bool enabled;

  /// Test seam; defaults to the app's `suggestPickupAddresses` callable.
  final Future<List<BarrelAddressSuggestion>> Function(String query)?
  fetchSuggestions;

  @override
  State<FleetAddressFields> createState() => _FleetAddressFieldsState();
}

class _FleetAddressFieldsState extends State<FleetAddressFields> {
  final _focus = FocusNode();
  int _version = 0;
  late bool _typing;

  String get _code => fleetStateCode(widget.state.text);

  bool _inList(String code, String city) =>
      (citiesByUsState[code] ?? const <String>[]).contains(city);

  @override
  void initState() {
    super.initState();
    final city = widget.city.text.trim();
    // A saved city the state's list does not have stays visible as typed.
    _typing = city.isNotEmpty && !_inList(_code, city);
  }

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  Future<List<BarrelAddressSuggestion>> _fetch(String query) async {
    final custom = widget.fetchSuggestions;
    if (custom != null) return custom(query);
    return BarrelShipmentService().addressSuggestions(query);
  }

  Future<Iterable<BarrelAddressSuggestion>> _options(
    TextEditingValue value,
  ) async {
    final query = value.text.trim();
    if (query.length < 4 || !widget.enabled) return const [];
    final version = ++_version;
    await Future<void>.delayed(const Duration(milliseconds: 380));
    if (version != _version) return const [];
    try {
      final found = await _fetch(query);
      return version == _version ? found : const [];
    } catch (_) {
      return const [];
    }
  }

  String _street(BarrelAddressSuggestion s) {
    final line = [
      s.streetLine,
      s.apartment,
    ].where((p) => p != null && p.isNotEmpty).join(' ');
    return line.isNotEmpty ? line : s.description.split(',').first.trim();
  }

  void _picked(BarrelAddressSuggestion s) {
    final code = fleetStateCode(s.stateCode ?? s.state ?? '');
    final city = (s.city ?? '').trim();
    setState(() {
      if (code.isNotEmpty) widget.state.text = code;
      if (city.isNotEmpty) widget.city.text = city;
      if ((s.postalCode ?? '').isNotEmpty) widget.zip.text = s.postalCode!;
      _typing = city.isNotEmpty && !_inList(_code, city);
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final code = _code;
    final city = widget.city.text.trim();
    final stateItems = usStateOptions(code.isEmpty ? null : code);
    final cityItems = code.isEmpty
        ? const <String>[]
        : usCityOptions(code, null);
    final cityValue = _typing
        ? otherCityValue
        : (cityItems.contains(city) ? city : '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _gap(
          RawAutocomplete<BarrelAddressSuggestion>(
            textEditingController: widget.line1,
            focusNode: _focus,
            optionsBuilder: _options,
            displayStringForOption: _street,
            onSelected: _picked,
            fieldViewBuilder: (context, controller, focus, onSubmit) =>
                TextField(
                  key: const Key('fleet-address-street'),
                  controller: controller,
                  focusNode: focus,
                  enabled: widget.enabled,
                  maxLength: 160,
                  decoration: _dec(l10n.fltFieldStreet).copyWith(counterText: ''),
                ),
            optionsViewBuilder: (context, onSelected, options) => Align(
              alignment: Alignment.topLeft,
              child: Material(
                elevation: 4,
                borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 220),
                  child: ListView(
                    padding: EdgeInsets.zero,
                    shrinkWrap: true,
                    children: [
                      for (final o in options)
                        ListTile(
                          dense: true,
                          title: Text(o.description),
                          onTap: () => onSelected(o),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
        _gap(
          DropdownButtonFormField<String>(
            key: ValueKey('fleet-address-state-$code'),
            isExpanded: true,
            initialValue: code,
            decoration: _dec(l10n.fltFieldState),
            items: [
              DropdownMenuItem(value: '', child: Text(l10n.fltPickChooseState)),
              for (final c in stateItems)
                DropdownMenuItem(
                  value: c,
                  child: Text(usStateNames[c] ?? c),
                ),
            ],
            onChanged: widget.enabled
                ? (v) => setState(() {
                    final next = v ?? '';
                    widget.state.text = next;
                    if (!_inList(next, widget.city.text.trim())) {
                      widget.city.text = '';
                    }
                    _typing = false;
                  })
                : null,
          ),
        ),
        _gap(
          DropdownButtonFormField<String>(
            key: ValueKey('fleet-address-city-$code-$cityValue'),
            isExpanded: true,
            initialValue: cityValue,
            decoration: _dec(l10n.fltFieldCity),
            items: [
              DropdownMenuItem(
                value: '',
                child: Text(
                  code.isEmpty ? l10n.fltPickStateFirst : l10n.fltPickChooseCity,
                ),
              ),
              for (final c in cityItems)
                DropdownMenuItem(
                  value: c,
                  child: Text(c == otherCityValue ? l10n.fltPickOtherCity : c),
                ),
            ],
            onChanged: widget.enabled && code.isNotEmpty
                ? (v) => setState(() {
                    if (v == otherCityValue) {
                      _typing = true;
                      widget.city.text = '';
                    } else {
                      _typing = false;
                      widget.city.text = v ?? '';
                    }
                  })
                : null,
          ),
        ),
        if (_typing)
          FleetField(
            controller: widget.city,
            label: l10n.fltPickTypeCity,
            maxLength: 80,
            enabled: widget.enabled,
          ),
        FleetField(
          controller: widget.zip,
          label: l10n.fltFieldZip,
          maxLength: 12,
          enabled: widget.enabled,
        ),
      ],
    );
  }
}

Future<Map<String, dynamic>?> _nhtsaRow(String vin) async {
  final client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
  try {
    final req = await client.getUrl(
      Uri.parse(
        'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/'
        '${Uri.encodeComponent(vin)}?format=json',
      ),
    );
    final res = await req.close().timeout(const Duration(seconds: 10));
    final body = await res.transform(utf8.decoder).join();
    final data = jsonDecode(body) as Map<String, dynamic>;
    final results = data['Results'];
    if (results is List && results.isNotEmpty && results.first is Map) {
      return Map<String, dynamic>.from(results.first as Map);
    }
    return const <String, dynamic>{};
  } catch (_) {
    return null;
  } finally {
    client.close();
  }
}

/// The car on a plate: make, model and year from the app's car catalog,
/// filled from the VIN when a full one is typed, saved as one line
/// ("Toyota Camry 2021") through [onVehicleType]. A line the catalog cannot
/// read is kept and shown as "Saved as ..." until a make is picked.
class FleetPlateCarFields extends StatefulWidget {
  const FleetPlateCarFields({
    super.key,
    required this.vinController,
    required this.vehicleType,
    required this.onVehicleType,
    this.enabled = true,
    this.decodeVin,
  });

  final TextEditingController vinController;
  final String vehicleType;
  final ValueChanged<String> onVehicleType;
  final bool enabled;

  /// Test seam; defaults to the public NHTSA vPIC database.
  final Future<Map<String, dynamic>?> Function(String vin)? decodeVin;

  @override
  State<FleetPlateCarFields> createState() => _FleetPlateCarFieldsState();
}

class _FleetPlateCarFieldsState extends State<FleetPlateCarFields> {
  static final _lookup = FleetCatalogLookup(
    makes: () => CarCatalog.instance.getMakes(),
    models: (m) => CarCatalog.instance.getModels(m),
    years: (m, mo) => CarCatalog.instance.getYears(m, mo),
  );

  bool _ready = CarCatalog.instance.isLoaded;
  bool _failed = false;
  bool _reading = false;
  FleetVehicleParts _parts = const FleetVehicleParts();
  String _unread = '';
  String _note = '';
  String _lastVin = '';

  @override
  void initState() {
    super.initState();
    _lastVin = fleetCleanVin(widget.vinController.text);
    widget.vinController.addListener(_vinChanged);
    if (_ready) {
      _readSaved();
    } else {
      CarCatalog.instance
          .load()
          .then((_) {
            if (!mounted) return;
            setState(() {
              _ready = true;
              _readSaved();
            });
          })
          .catchError((_) {
            // The lists never arrive: keep the saved line, never spin.
            if (mounted) setState(() => _failed = true);
          });
    }
  }

  void _readSaved() {
    final split = fleetSplitVehicleType(widget.vehicleType, _lookup);
    if (split != null) {
      _parts = split;
    } else {
      _unread = widget.vehicleType.trim();
    }
  }

  @override
  void dispose() {
    widget.vinController.removeListener(_vinChanged);
    super.dispose();
  }

  void _vinChanged() {
    final clean = fleetCleanVin(widget.vinController.text);
    if (clean.isEmpty || clean == _lastVin || !_ready) return;
    _lastVin = clean;
    setState(() {
      _reading = true;
      _note = '';
    });
    final l10n = AppLocalizations.of(context)!;
    (widget.decodeVin ?? _nhtsaRow)(clean).then((row) {
      if (!mounted || clean != _lastVin) return;
      final r = fleetVinResultFrom(
        row,
        _lookup,
        (m, mo) => CarCatalog.instance.canonicalModel(m, mo),
      );
      setState(() {
        _reading = false;
        switch (r.kind) {
          case FleetVinKind.filled:
            _parts = r.parts;
            _unread = '';
            widget.onVehicleType(fleetComposeVehicleType(r.parts));
            _note = r.parts.model.isNotEmpty && r.parts.year.isNotEmpty
                ? l10n.fltPickVinFilled
                : l10n.fltPickVinMakeOnly;
          case FleetVinKind.unknownMake:
            _note = l10n.fltPickVinUnknownMake;
          case FleetVinKind.unreadable:
            _note = l10n.fltPickVinUnreadable;
          case FleetVinKind.offline:
            _note = l10n.fltPickVinOffline;
        }
      });
    });
  }

  void _update(FleetVehicleParts next) {
    setState(() {
      _parts = next;
      _unread = '';
    });
    widget.onVehicleType(fleetComposeVehicleType(next));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final on = widget.enabled && _ready;
    final makes = _ready ? _lookup.makes() : const <String>[];
    final models = _ready && _parts.make.isNotEmpty
        ? _lookup.models(_parts.make)
        : const <String>[];
    final years = _ready && _parts.model.isNotEmpty
        ? _lookup.years(_parts.make, _parts.model)
        : const <String>[];
    Widget pick(
      String key,
      String label,
      String value,
      String empty,
      List<String> items,
      bool enabled,
      ValueChanged<String> onPick,
    ) => _gap(
      DropdownButtonFormField<String>(
        key: ValueKey('$key-$value-${items.length}'),
        isExpanded: true,
        initialValue: items.contains(value) ? value : '',
        decoration: _dec(label),
        items: [
          DropdownMenuItem(value: '', child: Text(empty)),
          for (final i in items) DropdownMenuItem(value: i, child: Text(i)),
        ],
        onChanged: enabled ? (v) => onPick(v ?? '') : null,
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        pick(
          'fleet-car-make',
          l10n.fltPickMake,
          _parts.make,
          _ready || _failed ? l10n.fltPickChooseMake : l10n.fltPickLoading,
          makes,
          on,
          (v) => _update(FleetVehicleParts(make: v)),
        ),
        pick(
          'fleet-car-model',
          l10n.fltPickModel,
          _parts.model,
          _parts.make.isEmpty ? l10n.fltPickMakeFirst : l10n.fltPickChooseModel,
          models,
          widget.enabled && _parts.make.isNotEmpty,
          (v) => _update(FleetVehicleParts(make: _parts.make, model: v)),
        ),
        pick(
          'fleet-car-year',
          l10n.fltPickYear,
          _parts.year,
          _parts.model.isEmpty ? l10n.fltPickModelFirst : l10n.fltPickChooseYear,
          years,
          widget.enabled && _parts.model.isNotEmpty,
          (v) => _update(
            FleetVehicleParts(make: _parts.make, model: _parts.model, year: v),
          ),
        ),
        if (_reading || _unread.isNotEmpty || _note.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            child: Text(
              _reading
                  ? l10n.fltPickReadingVin
                  : _unread.isNotEmpty
                  ? l10n.fltPickSavedAs(_unread)
                  : _note,
              key: const Key('fleet-car-note'),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
      ],
    );
  }
}
