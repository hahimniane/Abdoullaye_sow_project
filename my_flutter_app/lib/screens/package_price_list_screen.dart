import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../models/destination_country.dart';
import '../services/box_sizes.dart';
import '../services/business_price_list.dart';
import '../services/package_price_list.dart';
import '../services/package_request_service.dart';
import '../services/package_requests.dart' show RequestRefusal;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../utils/money_input.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/package_request_widgets.dart';

/// A price-list refusal code (`PRICE_LIST_MESSAGES` key) in our words, or
/// null when this app has none for it.
String? priceListReasonText(AppLocalizations l10n, String code) =>
    switch (code) {
      'price_list_invalid' => l10n.pplErrPriceListInvalid,
      'country_unknown' => l10n.pplErrCountryUnknown,
      'mode_invalid' => l10n.pplErrModeInvalid,
      'too_many_routes' => l10n.pplErrTooManyRoutes,
      'too_many_items' => l10n.pplErrTooManyItems,
      'label_required' => l10n.pplErrLabelRequired,
      'label_too_long' => l10n.pplErrLabelTooLong,
      'label_duplicate' => l10n.pplErrLabelDuplicate,
      'category_invalid' => l10n.pplErrCategoryInvalid,
      'price_invalid' => l10n.pplErrPriceInvalid,
      'included_invalid' => l10n.pplErrIncludedInvalid,
      'per_lb_invalid' => l10n.pplErrPerLbInvalid,
      'departure_invalid' => l10n.pplErrDepartureInvalid,
      'item_unknown' => l10n.pplErrItemUnknown,
      'quantity_invalid' => l10n.pplErrQuantityInvalid,
      'weight_invalid' => l10n.pplErrWeightInvalid,
      'box_size_invalid' => l10n.pplErrBoxSizeInvalid,
      'dims_invalid' => l10n.pplErrDimsInvalid,
      'box_sizes_sea_only' => l10n.pplErrBoxSizesSeaOnly,
      'box_price_invalid' => l10n.pplErrBoxPriceInvalid,
      _ => null,
    };

/// A category's name in the app's language.
String priceCategoryLabel(BuildContext context, String id) =>
    priceCategoryOf(id)?.label(Localizations.localeOf(context).languageCode) ??
    id;

/// "Mon" / "lun." for a weekday key.
String _weekdayLabel(String day, String locale) => displayWeekdayShort(
  // 2026-01-05 is a Monday.
  DateTime(2026, 1, 5 + priceWeekDays.indexOf(day)),
  locale,
);

/// Business > Shipping > Price list (docs/PACKAGE_PRICE_LIST.md §6): per
/// destination country, Sea | Air tabs holding the items (a fixed price,
/// optionally covering up to some pounds), a price per pound for each
/// category, and the days a shipment leaves. The owner (or an admin) edits
/// and saves the whole list; staff read it. A list Laawol set up shows
/// "please check them" until the business taps "Looks right".
class PackagePriceListScreen extends StatefulWidget {
  const PackagePriceListScreen({
    super.key,
    required this.businessId,
    required this.canEdit,
    this.service,
    this.countries,
  });

  final String businessId;

  /// The owner or an admin: may type, save and say "Looks right".
  final bool canEdit;
  final PackageRequestService? service;

  /// The business's destination countries; `destinationCountries` when null.
  final Stream<List<DestinationCountry>> Function(String businessId)? countries;

  @override
  State<PackagePriceListScreen> createState() => _PackagePriceListScreenState();
}

class _PackagePriceListScreenState extends State<PackagePriceListScreen> {
  late final PackageRequestService _service =
      widget.service ?? FirebasePackageRequestService();
  StreamSubscription<PackagePriceList>? _listSub;
  StreamSubscription<List<DestinationCountry>>? _countriesSub;
  Timer? _safety;

  PackagePriceList? _list;
  List<DestinationCountry>? _countries;
  bool _failed = false;

  PriceListDraft _draft = const {};
  bool _seeded = false;
  String _countryId = '';
  String _mode = 'sea';

  /// '' / 'save' / 'check'.
  String _busy = '';
  String _banner = '';

  @override
  void initState() {
    super.initState();
    // A load that never answers ends in Retry, never a spinner for good.
    _safety = Timer(const Duration(seconds: 20), () {
      if (mounted && !_loaded) setState(() => _failed = true);
    });
    _listen();
  }

  void _listen() {
    _listSub?.cancel();
    _countriesSub?.cancel();
    _listSub = _service
        .watchPriceList(widget.businessId)
        .listen(_onList, onError: _onLoadError);
    final source = widget.countries ?? _firestoreCountries;
    _countriesSub = source(
      widget.businessId,
    ).listen(_onCountries, onError: _onLoadError);
  }

  static Stream<List<DestinationCountry>> _firestoreCountries(
    String businessId,
  ) => FirebaseFirestore.instance
      .collection('businesses')
      .doc(businessId)
      .collection('destinationCountries')
      .snapshots()
      .map(
        (snap) =>
            [for (final d in snap.docs) DestinationCountry.fromFirestore(d)]
              ..sort((a, b) {
                final byOrder = a.sortOrder.compareTo(b.sortOrder);
                return byOrder != 0 ? byOrder : a.name.compareTo(b.name);
              }),
      );

  @override
  void dispose() {
    _listSub?.cancel();
    _countriesSub?.cancel();
    _safety?.cancel();
    super.dispose();
  }

  bool get _loaded => _list != null && _countries != null;

  void _onLoadError(Object _) {
    if (mounted) setState(() => _failed = true);
  }

  void _onList(PackagePriceList list) {
    if (!mounted) return;
    setState(() {
      // Typing in progress is judged against the list it started from.
      final typing = _changed;
      _list = list;
      _failed = false;
      _reseed(keepTyping: typing);
    });
  }

  void _onCountries(List<DestinationCountry> countries) {
    if (!mounted) return;
    setState(() {
      final typing = _changed;
      _countries = countries;
      _failed = false;
      _reseed(keepTyping: typing);
    });
  }

  /// The countries a price list is kept for: the ones the business ships to
  /// now, and any that still hold a stored route.
  List<DestinationCountry> get _shown {
    final list = _list ?? PackagePriceList.empty;
    return [
      for (final c in _countries ?? const <DestinationCountry>[])
        if (c.isActive || list.routes.containsKey(c.id)) c,
    ];
  }

  List<String> get _ids => [for (final c in _shown) c.id];

  /// Opens (or re-opens, while nothing is typed) on what is stored.
  void _reseed({required bool keepTyping}) {
    final list = _list, countries = _countries;
    if (list == null || countries == null) return;
    _safety?.cancel();
    final ids = _ids;
    if (!_seeded || !keepTyping) {
      _draft = priceListDraftOf(list, ids);
      _seeded = true;
    } else {
      // Typing in progress: keep it, and give a new country an empty list.
      final fresh = priceListDraftOf(list, ids);
      _draft = {for (final id in ids) id: _draft[id] ?? fresh[id]!};
    }
    if (!ids.contains(_countryId)) _countryId = ids.isEmpty ? '' : ids.first;
  }

  bool get _changed {
    final list = _list;
    if (list == null || !_seeded) return false;
    return priceListChanged(list, _draft, _ids);
  }

  PriceRouteDraft get _route =>
      _draft[_countryId]?[_mode] ?? const PriceRouteDraft();

  void _edit(PriceRouteDraft Function(PriceRouteDraft route) change) {
    if (!widget.canEdit || _countryId.isEmpty) return;
    setState(() {
      final byMode = {...?_draft[_countryId]};
      byMode[_mode] = change(byMode[_mode] ?? const PriceRouteDraft());
      _draft = {..._draft, _countryId: byMode};
      _banner = '';
    });
  }

  String _countryName(String id) {
    for (final c in _countries ?? const <DestinationCountry>[]) {
      if (c.id == id) return c.name;
    }
    return id;
  }

  String _refusalText(AppLocalizations l10n, RequestRefusal refusal) {
    for (final reason in refusal.reasons) {
      final text = priceListReasonText(l10n, reason);
      if (text != null) return text;
    }
    return requestRefusalText(l10n, refusal);
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    if (_busy.isNotEmpty || !widget.canEdit) return;
    final ids = _ids;
    final problems = priceListProblems(_draft, ids);
    if (problems.isNotEmpty) {
      AppHaptics.refuse();
      final first = problems.first;
      setState(() {
        _countryId = first.countryId;
        _mode = first.mode;
        _banner = priceListReasonText(l10n, first.code) ?? l10n.prqErrGeneric;
      });
      return;
    }
    setState(() {
      _busy = 'save';
      _banner = '';
    });
    try {
      final saved = await _service.savePriceList(
        businessId: widget.businessId,
        routes: priceListRoutesPayload(_draft, ids),
      );
      if (!mounted) return;
      AppHaptics.commit();
      setState(() => _list = saved);
      showSuccessSnackBar(context, l10n.pplSaved);
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _banner = _refusalText(l10n, failure.refusal));
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _looksRight() async {
    final l10n = AppLocalizations.of(context)!;
    if (_busy.isNotEmpty || !widget.canEdit) return;
    setState(() {
      _busy = 'check';
      _banner = '';
    });
    try {
      final checked = await _service.markPriceListChecked(widget.businessId);
      if (!mounted) return;
      AppHaptics.commit();
      // The server answers the list as it stands; the watcher says the same
      // a moment later. Until then the banner goes at once.
      setState(
        () => _list = PackagePriceList(
          routes: checked.routes.isEmpty
              ? (_list?.routes ?? const {})
              : checked.routes,
          needsCheck: false,
          updatedAtMs: checked.updatedAtMs,
          updatedByName: checked.updatedByName,
          updatedByLaawol: checked.updatedByLaawol,
          checkedAtMs: checked.checkedAtMs,
          checkedByName: checked.checkedByName,
          history: checked.history.isEmpty
              ? (_list?.history ?? const [])
              : checked.history,
        ),
      );
      showSuccessSnackBar(context, l10n.pplCheckedDone);
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, _refusalText(l10n, failure.refusal));
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _openItem(int? index) async {
    final route = _route;
    final result = await showPriceItemSheet(
      context,
      initial: index == null ? null : route.items[index],
    );
    if (result == null || !mounted) return;
    if (result is PriceItemRemoved) {
      if (index == null) return;
      _edit((r) => r.copyWith(items: [...r.items]..removeAt(index)));
    } else if (result is PriceItemDraft) {
      _edit((r) {
        final items = [...r.items];
        if (index == null) {
          items.add(result);
        } else {
          items[index] = result;
        }
        return r.copyWith(items: items);
      });
    }
  }

  Future<void> _pickAnchor() async {
    final route = _route;
    final today = DateTime.now();
    final initial = parseDayKey(route.anchorDate) ?? today;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(today.year - 1),
      lastDate: DateTime(today.year + 3),
    );
    if (picked == null || !mounted) return;
    _edit(
      (r) => r.copyWith(
        anchorDate:
            '${picked.year.toString().padLeft(4, '0')}-'
            '${picked.month.toString().padLeft(2, '0')}-'
            '${picked.day.toString().padLeft(2, '0')}',
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    Widget body;
    if (!_loaded) {
      body = _failed
          ? Center(
              child: RequestLoadFailed(
                message: l10n.pplLoadFailed,
                onRetry: () {
                  setState(() => _failed = false);
                  _safety?.cancel();
                  _safety = Timer(const Duration(seconds: 20), () {
                    if (mounted && !_loaded) setState(() => _failed = true);
                  });
                  _listen();
                },
              ),
            )
          : const Center(child: CircularProgressIndicator());
    } else {
      body = _form(l10n);
    }
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          RequestPageHeader(title: l10n.pplTitle, subtitle: l10n.pplSubtitle),
          Expanded(child: body),
        ],
      ),
    );
  }

  Widget _form(AppLocalizations l10n) {
    final list = _list ?? PackagePriceList.empty;
    final shown = _shown;
    final edit = widget.canEdit && _busy.isEmpty;
    final locale = dateLocaleOf(context);
    return ListView(
      key: const Key('price-list'),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        48,
      ),
      children: [
        if (!widget.canEdit)
          RequestBanner(
            key: const Key('ppl-read-only'),
            text: l10n.pplReadOnly,
            icon: Icons.lock_outline,
            color: AppColors.muted,
          ),
        if (list.needsCheck)
          RequestBanner(
            key: const Key('ppl-needs-check'),
            text: l10n.pplNeedsCheckBanner,
            icon: Icons.fact_check_outlined,
            color: AppColors.warn,
            action: widget.canEdit
                ? FilledButton(
                    key: const Key('ppl-looks-right'),
                    onPressed: _busy.isEmpty ? _looksRight : null,
                    child: _busy == 'check'
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : Text(l10n.pplLooksRight),
                  )
                : null,
          ),
        if (_banner.isNotEmpty)
          RequestBanner(
            key: const Key('ppl-banner'),
            text: _banner,
            icon: Icons.error_outline,
            color: AppColors.errorRed,
          ),
        if (shown.isEmpty)
          LotEmptyState(
            key: const Key('ppl-no-countries'),
            icon: Icons.public_outlined,
            title: l10n.pplNoCountries,
            hint: l10n.pplNoCountriesHint,
          )
        else ...[
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              for (final c in shown)
                ChoiceChip(
                  key: ValueKey('ppl-country:${c.id}'),
                  label: Text(c.name),
                  selected: _countryId == c.id,
                  onSelected: (_) => setState(() => _countryId = c.id),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          // A Wrap, not a Row: in French on a 320 px phone the two chips
          // (icon + "Maritime" / "Aérien") are wider than the screen.
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              for (final mode in priceModes)
                ChoiceChip(
                  key: ValueKey('ppl-mode:$mode'),
                  avatar: Icon(
                    mode == 'air'
                        ? Icons.flight
                        : Icons.directions_boat_outlined,
                    size: 16,
                  ),
                  label: Text(
                    mode == 'air' ? l10n.airModeAir : l10n.airModeSea,
                  ),
                  selected: _mode == mode,
                  onSelected: (_) => setState(() => _mode = mode),
                ),
            ],
          ),
          _itemsSection(l10n, edit),
          // Box sizes are Sea only (the server refuses them on Air).
          if (_mode == 'sea') _boxSizesSection(l10n, edit),
          _perLbSection(l10n, edit),
          _departureSection(l10n, edit, locale),
          if (widget.canEdit) ...[
            const SizedBox(height: AppSpacing.lg),
            if (_changed)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: Text(
                  l10n.pplUnsaved,
                  key: const Key('ppl-unsaved'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.warn,
                  ),
                ),
              ),
            RequestPrimaryButton(
              key: const Key('ppl-save'),
              label: l10n.pplSave,
              busyLabel: l10n.pplSaving,
              busy: _busy == 'save',
              onTap: _save,
            ),
          ],
        ],
        _historySection(l10n, list, locale),
      ],
    );
  }

  Widget _itemsSection(AppLocalizations l10n, bool edit) {
    final route = _route;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        RequestSectionTitle(l10n.pplItemsTitle),
        Text(
          l10n.pplItemsHint,
          style: const TextStyle(
            fontSize: 12.5,
            height: 1.35,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        if (route.items.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            child: Text(
              l10n.pplNoItems,
              key: const Key('ppl-no-items'),
              style: const TextStyle(fontSize: 13.5, color: AppColors.muted),
            ),
          ),
        for (var i = 0; i < route.items.length; i++)
          _ItemTile(
            key: ValueKey('ppl-item:$i'),
            item: route.items[i],
            onTap: edit ? () => _openItem(i) : null,
          ),
        if (widget.canEdit)
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              key: const Key('ppl-add-item'),
              onPressed: edit ? () => _openItem(null) : null,
              icon: const Icon(Icons.add, size: 18),
              label: Text(l10n.pplAddItem),
            ),
          ),
      ],
    );
  }

  Widget _boxSizesSection(AppLocalizations l10n, bool edit) {
    final route = _route;
    final language = Localizations.localeOf(context).languageCode;
    Widget picture(String id) => SizedBox(
      width: 56,
      height: 42,
      child: Image.asset(
        boxSizeAsset(id),
        fit: BoxFit.contain,
        excludeFromSemantics: true,
        errorBuilder: (_, _, _) => const Icon(
          Icons.inventory_2_outlined,
          color: AppColors.muted,
        ),
      ),
    );
    return Column(
      key: const Key('ppl-box-sizes'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        RequestSectionTitle(l10n.boxSizesTitle),
        Text(
          l10n.boxSizesHint,
          style: const TextStyle(
            fontSize: 12.5,
            height: 1.35,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        RequestCard(
          child: Column(
            children: [
              for (final id in boxPricedIds)
                _RateRow(
                  key: ValueKey('ppl-box:$_countryId:$id'),
                  fieldKey: ValueKey('ppl-box-field:$_countryId:$id'),
                  label: boxSizeName(id, language),
                  subtitle: boxSizeExample(id, language),
                  leading: picture(id),
                  suffix: '',
                  initial: route.boxPrices[id] ?? '',
                  enabled: edit,
                  onChanged: (text) => _edit(
                    (r) => r.copyWith(boxPrices: {...r.boxPrices, id: text}),
                  ),
                ),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    picture(boxSizeXl),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Text(
                        l10n.boxSizesXlQuote,
                        key: const Key('ppl-box-xl'),
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.muted,
                        ),
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
  }

  Widget _perLbSection(AppLocalizations l10n, bool edit) {
    final route = _route;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        RequestSectionTitle(l10n.pplPerLbTitle),
        Text(
          l10n.pplPerLbHint,
          style: const TextStyle(
            fontSize: 12.5,
            height: 1.35,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        RequestCard(
          child: Column(
            children: [
              for (final category in priceCategories)
                _RateRow(
                  key: ValueKey('ppl-rate:$_countryId:$_mode:${category.id}'),
                  fieldKey: ValueKey(
                    'ppl-rate-field:$_countryId:$_mode:${category.id}',
                  ),
                  label: priceCategoryLabel(context, category.id),
                  initial: route.rates[category.id] ?? '',
                  enabled: edit,
                  onChanged: (text) => _edit(
                    (r) => r.copyWith(rates: {...r.rates, category.id: text}),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _departureSection(AppLocalizations l10n, bool edit, String locale) {
    final route = _route;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        RequestSectionTitle(l10n.pplDepartureTitle),
        Text(
          l10n.pplDepartureHint,
          style: const TextStyle(
            fontSize: 12.5,
            height: 1.35,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            for (final day in priceWeekDays)
              FilterChip(
                key: ValueKey('ppl-day:$day'),
                label: Text(_weekdayLabel(day, locale)),
                selected: route.weekdays.contains(day),
                onSelected: edit
                    ? (on) => _edit(
                        (r) => r.copyWith(
                          weekdays: on
                              ? {...r.weekdays, day}
                              : ({...r.weekdays}..remove(day)),
                        ),
                      )
                    : null,
              ),
          ],
        ),
        if (route.weekdays.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              // The label gives way first: "Toutes les 12 semaines" between
              // two 48 px buttons does not fit a 320 px phone beside it.
              Expanded(
                child: Text(
                  l10n.pplRepeat,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
              ),
              IconButton(
                key: const Key('ppl-weeks-less'),
                onPressed: edit && route.everyWeeks > 1
                    ? () =>
                          _edit((r) => r.copyWith(everyWeeks: r.everyWeeks - 1))
                    : null,
                icon: const Icon(Icons.remove_circle_outline),
              ),
              Flexible(
                flex: 3,
                child: Text(
                  route.everyWeeks == 1
                      ? l10n.pplEveryWeek
                      : l10n.pplEveryNWeeks(route.everyWeeks),
                  key: const Key('ppl-weeks'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              IconButton(
                key: const Key('ppl-weeks-more'),
                onPressed: edit && route.everyWeeks < PriceLimit.everyWeeks
                    ? () =>
                          _edit((r) => r.copyWith(everyWeeks: r.everyWeeks + 1))
                    : null,
                icon: const Icon(Icons.add_circle_outline),
              ),
            ],
          ),
          if (route.everyWeeks > 1)
            LotPickerField(
              key: const Key('ppl-anchor'),
              label: l10n.pplAnchorDate,
              value: route.anchorDate.isEmpty
                  ? null
                  : displayDay(route.anchorDate, locale),
              placeholder: l10n.pplPickDate,
              onTap: edit ? _pickAnchor : () {},
            ),
          if (route.everyWeeks > 1)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                l10n.pplAnchorHint,
                style: const TextStyle(fontSize: 12, color: AppColors.muted),
              ),
            ),
        ],
      ],
    );
  }

  Widget _historySection(
    AppLocalizations l10n,
    PackagePriceList list,
    String locale,
  ) {
    final entries = list.historyNewestFirst;
    String who(PriceListHistoryEntry e) {
      final name = e.byName.isEmpty ? '-' : e.byName;
      return e.byLaawol
          ? (e.byName.isEmpty ? 'Laawol' : l10n.pplHistoryLaawol(name))
          : name;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        RequestSectionTitle(l10n.pplHistoryTitle),
        if (entries.isEmpty)
          Text(
            l10n.pplHistoryNone,
            key: const Key('ppl-history-empty'),
            style: const TextStyle(fontSize: 13.5, color: AppColors.muted),
          ),
        for (var i = 0; i < entries.length; i++)
          Padding(
            key: ValueKey('ppl-history:$i'),
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  entries[i].isChecked
                      ? l10n.pplHistoryChecked(who(entries[i]))
                      : l10n.pplHistorySaved(who(entries[i])),
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                Text(
                  [
                    if (entries[i].atMs > 0)
                      displayDateTime(
                        DateTime.fromMillisecondsSinceEpoch(entries[i].atMs),
                        locale,
                      ),
                    if (entries[i].countries.isNotEmpty)
                      l10n.pplHistoryCountries(
                        entries[i].countries.map(_countryName).join(', '),
                      ),
                  ].join(' · '),
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// One item of a route: its name, price and what the price covers.
class _ItemTile extends StatelessWidget {
  const _ItemTile({super.key, required this.item, required this.onTap});

  final PriceItemDraft item;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final cents = readItemCents(item.price);
    final covers = item.includedLb.trim();
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: PressableScale(
        scale: 0.985,
        onTap: onTap == null
            ? null
            : () {
                AppHaptics.selection();
                onTap!();
              },
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.paper,
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            border: Border.all(color: AppColors.rule),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.label.isEmpty ? '-' : item.label,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                    Text(
                      [
                        priceCategoryLabel(context, item.categoryId),
                        if (covers.isNotEmpty) l10n.pplItemCoversUpTo(covers),
                      ].join(' · '),
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                cents == null ? item.price : formatPriceCents(cents),
                key: const Key('ppl-item-price-text'),
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: AppColors.cobaltDeep,
                ),
              ),
              if (onTap != null)
                const Icon(
                  Icons.chevron_right,
                  size: 18,
                  color: AppColors.muted,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One category's price per pound.
class _RateRow extends StatefulWidget {
  const _RateRow({
    super.key,
    required this.fieldKey,
    required this.label,
    required this.initial,
    required this.enabled,
    required this.onChanged,
    this.suffix = '/lb',
    this.leading,
    this.subtitle,
  });

  final Key fieldKey;
  final String label;

  /// What follows the number: "/lb" for a rate, nothing for a box price.
  final String suffix;
  final Widget? leading;
  final String? subtitle;
  final String initial;
  final bool enabled;
  final ValueChanged<String> onChanged;

  @override
  State<_RateRow> createState() => _RateRowState();
}

class _RateRowState extends State<_RateRow> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.initial,
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          if (widget.leading != null) ...[
            widget.leading!,
            const SizedBox(width: AppSpacing.md),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.label,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                if (widget.subtitle != null)
                  Text(
                    widget.subtitle!,
                    style: const TextStyle(
                      fontSize: 11.5,
                      height: 1.25,
                      color: AppColors.muted,
                    ),
                  ),
              ],
            ),
          ),
          SizedBox(
            width: 128,
            child: TextField(
              key: widget.fieldKey,
              controller: _controller,
              enabled: widget.enabled,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
              ],
              onChanged: widget.onChanged,
              decoration: InputDecoration(
                prefixText: r'$ ',
                suffixText: widget.suffix.isEmpty ? null : widget.suffix,
                isDense: true,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Dollars for cents ("$40", "$12.50").
String formatPriceCents(int cents) => cents % 100 == 0
    ? '\$${cents ~/ 100}'
    : '\$${(cents / 100).toStringAsFixed(2)}';

/// The cents a typed price reads as, or null.
int? readItemCents(String text) {
  final cents = readMoneyInput(text).cents;
  return cents != null && cents > 0 ? cents : null;
}

// ---------------------------------------------------------------------------
// The item sheet.
// ---------------------------------------------------------------------------

/// What the item sheet answers when "Remove" was tapped.
class PriceItemRemoved {
  const PriceItemRemoved();
}

/// Adds ([initial] null) or edits one item; answers the [PriceItemDraft],
/// a [PriceItemRemoved], or null when dismissed.
Future<Object?> showPriceItemSheet(
  BuildContext context, {
  PriceItemDraft? initial,
}) => showLotSheet<Object?>(context, _ItemSheet(initial: initial));

class _ItemSheet extends StatefulWidget {
  const _ItemSheet({this.initial});

  final PriceItemDraft? initial;

  @override
  State<_ItemSheet> createState() => _ItemSheetState();
}

class _ItemSheetState extends State<_ItemSheet> {
  late final TextEditingController _name = TextEditingController(
    text: widget.initial?.label ?? '',
  );
  late final TextEditingController _price = TextEditingController(
    text: widget.initial?.price ?? '',
  );
  late final TextEditingController _covers = TextEditingController(
    text: widget.initial?.includedLb ?? '',
  );
  late String _category = widget.initial?.categoryId ?? 'general';
  String _error = '';

  @override
  void dispose() {
    _name.dispose();
    _price.dispose();
    _covers.dispose();
    super.dispose();
  }

  PriceItemDraft get _draft => PriceItemDraft(
    id: widget.initial?.id ?? '',
    label: _name.text.trim(),
    categoryId: _category,
    price: _price.text.trim(),
    includedLb: _covers.text.trim(),
  );

  Future<void> _pickCategory() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.pplItemCategory,
      selected: _category,
      options: [
        for (final c in priceCategories)
          LotOption(c.id, priceCategoryLabel(context, c.id)),
      ],
    );
    if (picked == null || !mounted) return;
    setState(() {
      _category = picked;
      _error = '';
    });
  }

  void _done() {
    final l10n = AppLocalizations.of(context)!;
    final errors = validateRoute({
      'items': [_draft.toPayload()],
    }).errors;
    if (errors.isNotEmpty) {
      AppHaptics.refuse();
      setState(
        () => _error =
            priceListReasonText(l10n, errors.first) ?? l10n.prqErrGeneric,
      );
      return;
    }
    Navigator.of(context).pop(_draft);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    void clear(String _) {
      if (_error.isNotEmpty) setState(() => _error = '');
    }

    return LotSheetShell(
      title: widget.initial == null ? l10n.pplNewItem : l10n.pplEditItem,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_error.isNotEmpty) ...[
            RequestBanner(
              key: const Key('ppl-item-error'),
              text: _error,
              icon: Icons.error_outline,
              color: AppColors.errorRed,
            ),
          ],
          LotSheetButton(
            key: const Key('ppl-item-done'),
            label: l10n.pplItemDone,
            onTap: _done,
          ),
          if (widget.initial != null)
            TextButton(
              key: const Key('ppl-item-remove'),
              style: TextButton.styleFrom(foregroundColor: AppColors.errorRed),
              onPressed: () =>
                  Navigator.of(context).pop(const PriceItemRemoved()),
              child: Text(l10n.pplRemoveItem),
            ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('ppl-item-name'),
            controller: _name,
            textCapitalization: TextCapitalization.sentences,
            maxLength: PriceLimit.label,
            onChanged: clear,
            decoration: InputDecoration(
              labelText: l10n.pplItemName,
              hintText: l10n.pplItemNameHint,
              counterText: '',
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            key: const Key('ppl-item-category'),
            label: l10n.pplItemCategory,
            value: priceCategoryLabel(context, _category),
            placeholder: l10n.pplItemCategory,
            onTap: _pickCategory,
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('ppl-item-price'),
            controller: _price,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
            ],
            onChanged: clear,
            decoration: InputDecoration(
              labelText: l10n.pplItemPrice,
              prefixText: r'$ ',
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('ppl-item-covers'),
            controller: _covers,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
            ],
            onChanged: clear,
            decoration: InputDecoration(
              labelText: l10n.pplItemCovers,
              suffixText: 'lb',
              helperText: l10n.pplItemCoversHint,
              helperMaxLines: 3,
            ),
          ),
        ],
      ),
    );
  }
}
