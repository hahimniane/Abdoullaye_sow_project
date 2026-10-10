import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:url_launcher/url_launcher.dart';

import '../data/calling_code_catalog.dart';
import '../data/country_catalog.dart';
import '../l10n/app_localizations.dart';
import '../models/destination_country.dart';
import '../services/business_activity_queries.dart';
import '../services/container_lot_cars.dart';
import '../services/container_manifest.dart';
import '../services/container_packages.dart';
import '../services/known_car_lookup.dart';
import '../services/lot_customers.dart';
import '../services/lot_ledger.dart';
import '../services/vin_decoder_service.dart';
import '../services/invoice_ledger.dart' show invoiceCentsToInput;
import '../services/waiting_package_service.dart';
import '../services/waiting_packages.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/vin_utils.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/country_phone_field.dart';
import '../widgets/label_print_sheet.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/package_money.dart';
import '../widgets/waiting_package_fields.dart';
import 'add_waiting_packages_sheet.dart';
import 'package_payment_sheet.dart';
import 'package_result_screen.dart';
import 'package_scan_screen.dart';
import 'vin_scanner_screen.dart';
import 'waiting_packages_screen.dart';

/// Containers, yard-side.
///
/// A business registers the physical boxes it ships and records what it
/// loaded into each: a car (VIN first), barrels, or anything else, each line
/// saying whose it is. This is the business's own loading list - customers
/// never see it - and the phone in the yard is where most of it gets written,
/// so the screen carries the whole capability of the console: create, load,
/// move, ship, arrive, print, search, history.
///
/// Every rule the server enforces is checked first by
/// `services/container_manifest.dart`, which mirrors the server module, so a
/// refusal is shown at the field before the round trip and in the same words
/// when the server refuses anyway.
/// A business's containers and their lines, listened to ONCE and shared.
///
/// The list screen owns one, and every container detail opened from it reads
/// the same feed - the detail used to open a second listener on both
/// collections each time a box was tapped. A detail opened from anywhere
/// else (a scanned package) makes and disposes its own.
class ContainerFeed extends ChangeNotifier {
  ContainerFeed(this.businessId, {FirebaseFirestore? db})
    : _db = db ?? FirebaseFirestore.instance {
    _listen();
  }

  final String businessId;
  final FirebaseFirestore _db;
  final List<StreamSubscription<Object?>> _subs = [];

  List<ShippingContainer> containers = const [];
  List<ContainerLine> lines = const [];
  bool loaded = false;
  bool failed = false;
  bool _disposed = false;

  void _listen() {
    final id = businessId;
    // No orderBy on either collection: sorted client-side so neither query
    // needs a composite index.
    Query<Map<String, dynamic>> scoped(String path) =>
        _db.collection(path).where('businessId', isEqualTo: id);

    _subs.add(scoped('containers').snapshots().listen((snap) {
      containers = sortContainers([
        for (final d in snap.docs) ShippingContainer.fromMap(d.id, d.data()),
      ]);
      loaded = true;
      failed = false;
      _changed();
    }, onError: (_) {
      loaded = true;
      failed = true;
      _changed();
    }));

    _subs.add(scoped('containerLines').snapshots().listen((snap) {
      lines = [
        for (final d in snap.docs) ContainerLine.fromMap(d.id, d.data()),
      ];
      _changed();
    }, onError: (_) {}));
  }

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }
}

class ContainersScreen extends StatefulWidget {
  const ContainersScreen({super.key, required this.businessId});

  final String businessId;

  @override
  State<ContainersScreen> createState() => _ContainersScreenState();
}

class _ContainersScreenState extends State<ContainersScreen> {
  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final List<StreamSubscription<Object?>> _subs = [];

  /// The containers and lines, shared with every detail opened from here.
  late final ContainerFeed _feed;

  void _onFeed() {
    if (mounted) setState(() {});
  }

  List<ShippingContainer> get _containers => _feed.containers;
  List<ContainerLine> get _lines => _feed.lines;
  bool get _loading => !_feed.loaded;
  bool get _loadFailed => _feed.failed;
  List<LotStaff> _staff = const [];
  List<LotCustomer> _customers = const [];

  /// The business's `parkedCars` rows that still hold a space - in the lot,
  /// booked, or open-ended - each with its `id`. That is exactly what the
  /// "is this car parked in your lot?" picker on the add-line sheet offers,
  /// so it is all that is read: this used to be an unordered `limit(500)`
  /// over the lot's whole history, which dropped cars once it was full.
  List<Map<String, dynamic>> _parkedCarRows = const [];

  /// Older vehicles come from the shared VIN memory (recent cars, then an
  /// exact lookup), not from a listener on every ledger job.
  late final KnownCarLookup _carLookup = KnownCarLookup.forBusiness(
    widget.businessId,
  );

  List<LotKnownCar> get _parkedCars => [
        for (final row in _parkedCarRows) LotKnownCar.fromMap(row),
      ];
  List<DestinationCountry> _destinations = const [];
  String _businessName = '';

  /// ISO code of the business's headquarters country, read from its address.
  /// A customer handing goods in is usually local, so their phone picker
  /// starts there. Empty until known.
  String _businessCountryCode = '';

  String _filter = containerStatusLoading;
  String _search = '';

  /// Every vehicle this business has on file: parked cars first, then what
  /// a past activity recorded, then what an earlier container carried.
  /// Typing a VIN it recognises should never leave staff re-typing the car.
  List<LotKnownCar> get _knownCars => [
        ..._parkedCars,
        ..._carLookup.recent,
        for (final line in _lines)
          if (line.isCar)
            LotKnownCar(
              vin: line.vinNumber,
              make: line.carMake,
              model: line.carModel,
              year: line.carYear,
              customerName: line.customerName,
              customerPhone: line.customerPhone,
            ),
      ];

  @override
  void initState() {
    super.initState();
    _listen();
  }

  void _listen() {
    final id = widget.businessId;
    _feed = ContainerFeed(id)..addListener(_onFeed);

    _subs.add(_db
        .collection('users')
        .where('businessId', isEqualTo: id)
        .snapshots()
        .listen((snap) {
      if (!mounted) return;
      setState(() => _staff = [
            for (final d in snap.docs)
              LotStaff(
                id: d.id,
                name: (d.data()['fullName'] ??
                        d.data()['name'] ??
                        d.data()['email'] ??
                        d.id)
                    .toString(),
              ),
          ]);
    }, onError: (_) {
      // Reading the team needs the people permission; without it every
      // "added by" simply stays blank.
    }));

    _subs.add(parkedCarsOnLotSpec(id, DateTime.now())
        .build(_db)
        .snapshots()
        .listen((snap) {
      if (!mounted) return;
      setState(() => _parkedCarRows = [
            for (final d in snap.docs) {...d.data(), 'id': d.id},
          ]);
    }, onError: (_) {}));

    unawaited(_carLookup.loadRecent().then((_) {
      if (mounted) setState(() {});
    }));

    _subs.add(_db.collection('businesses').doc(id).snapshots().listen((doc) {
      if (!mounted) return;
      final data = doc.data() ?? const <String, dynamic>{};
      setState(() {
        _businessName = (data['name'] ?? data['businessName'] ?? '').toString();
        _businessCountryCode = CallingCodeCatalog.countryCodeForReference(
              (data['country'] ?? '').toString(),
            ) ??
            '';
      });
    }, onError: (_) {}));

    // The business's own countries, the same list Services & coverage
    // manages, lead the destination picker; the rest of the catalogue
    // follows, since a container goes wherever the business sends it.
    _subs.add(_db
        .collection('businesses')
        .doc(id)
        .collection('destinationCountries')
        .snapshots()
        .listen((snap) {
      if (!mounted) return;
      final list = [
        for (final d in snap.docs) DestinationCountry.fromFirestore(d),
      ]..sort((a, b) {
          final byOrder = a.sortOrder.compareTo(b.sortOrder);
          return byOrder != 0 ? byOrder : a.name.compareTo(b.name);
        });
      setState(() => _destinations = list);
    }, onError: (_) {}));

    _loadCustomers();
  }

  Future<void> _loadCustomers() async {
    try {
      final snap = await _db
          .collection('lotCustomers')
          .where('businessId', isEqualTo: widget.businessId)
          .orderBy('lastSeenAt', descending: true)
          .limit(500)
          .get();
      if (!mounted) return;
      setState(() => _customers = [
            for (final d in snap.docs) LotCustomer.fromMap(d.id, d.data()),
          ]);
    } catch (_) {
      // No memory yet, or no permission to read it: the form still works by
      // hand, so this stays silent rather than alarming.
    }
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _feed
      ..removeListener(_onFeed)
      ..dispose();
    super.dispose();
  }

  void _openDetail(String containerId) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ContainerDetailScreen(
          businessId: widget.businessId,
          containerId: containerId,
          feed: _feed,
          staff: _staff,
          customers: _customers,
          knownCars: _knownCars,
          parkedCarRows: _parkedCarRows,
          destinations: _destinations,
          businessCountryCode: _businessCountryCode,
          onCustomerRecorded: _loadCustomers,
        ),
      ),
    );
  }

  /// Point the phone at a package label - or type its code, or a name or a
  /// phone - and see whose it is and which box it is on.
  void _openScan() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PackageScanScreen(
          businessId: widget.businessId,
          businessCountryCode: _businessCountryCode,
          destinations: _destinations,
          onOpenContainer: _openDetail,
          staff: _staff,
        ),
      ),
    );
  }

  /// The packages dropped off with no container yet, on their own list.
  void _openWaiting() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => WaitingPackagesScreen(
          businessId: widget.businessId,
          feed: _feed,
          staff: _staff,
          customers: _customers,
          knownCars: _knownCars,
          parkedCarRows: _parkedCarRows,
          destinations: _destinations,
          businessCountryCode: _businessCountryCode,
          onCustomerRecorded: _loadCustomers,
        ),
      ),
    );
  }

  /// A search hit on a package that has no container opens its package page.
  void _openWaitingHit(ContainerLine line) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PackageResultScreen(
          businessId: widget.businessId,
          code: line.trackingCode,
          lineId: line.id,
          businessCountryCode: _businessCountryCode,
          destinations: _destinations,
          onOpenContainer: _openDetail,
          staff: _staff,
        ),
      ),
    );
  }

  Future<void> _create() async {
    final created = await showLotSheet<String>(
      context,
      _ContainerFormSheet(
        businessId: widget.businessId,
        destinations: _destinations,
      ),
    );
    if (created == null || created.isEmpty || !mounted) return;
    _openDetail(created);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final searching = _search.trim().length >= 2;
    final byId = {for (final c in _containers) c.id: c};
    final counts = {
      for (final status in containerStatuses)
        status: _containers.where((c) => c.status == status).length,
    };

    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          _ContainersHeader(
            businessName: _businessName,
            onScan: _openScan,
            search: _search,
            onSearch: (v) => setState(() => _search = v),
            filter: _filter,
            counts: counts,
            onFilter: (v) {
              AppHaptics.selection();
              setState(() => _filter = v);
            },
            showFilter: !searching,
            waitingCount: _lines.where((l) => l.isWaiting).length,
            onOpenWaiting: _openWaiting,
          ),
          Expanded(
            child: Stack(
              children: [
                if (_loading)
                  const Center(child: CircularProgressIndicator())
                else if (_loadFailed)
                  LotEmptyState(
                    icon: Icons.cloud_off_outlined,
                    title: l10n.ctrCouldNotLoad,
                  )
                else if (searching)
                  _SearchResults(
                    hits: searchContainerLines(_lines, byId, _search),
                    staff: _staff,
                    onOpen: _openDetail,
                    onOpenWaiting: _openWaitingHit,
                  )
                else
                  _ContainerList(
                    containers: filterContainers(_containers, _filter),
                    filter: _filter,
                    anyAtAll: _containers.isNotEmpty,
                    onOpen: _openDetail,
                  ),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: LotPrimaryBar(
                    label: l10n.ctrNewContainer,
                    icon: Icons.add,
                    onTap: _create,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Header: where you are, the search, and the three states.
// ---------------------------------------------------------------------------

class _ContainersHeader extends StatelessWidget {
  const _ContainersHeader({
    required this.businessName,
    required this.onScan,
    required this.search,
    required this.onSearch,
    required this.filter,
    required this.counts,
    required this.onFilter,
    required this.showFilter,
    required this.waitingCount,
    required this.onOpenWaiting,
  });

  final String businessName;
  final VoidCallback onScan;
  final String search;
  final ValueChanged<String> onSearch;
  final String filter;
  final Map<String, int> counts;
  final ValueChanged<String> onFilter;
  final bool showFilter;
  final int waitingCount;
  final VoidCallback onOpenWaiting;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      decoration: BoxDecoration(
        color: AppColors.paper,
        border: Border(
          bottom: BorderSide(color: AppColors.rule.withValues(alpha: 0.8)),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 4, AppSpacing.lg, 0),
              child: Row(
                children: [
                  const AppBackButton(),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l10n.ctrTitle,
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w700,
                            height: 1.1,
                            letterSpacing: -0.4,
                            color: AppColors.ink,
                          ),
                        ),
                        if (businessName.isNotEmpty)
                          Text(
                            businessName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 12,
                              height: 1.3,
                              color: AppColors.muted,
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  // The yard's most frequent question - whose is this? - is
                  // one tap from the top of the list.
                  PressableScale(
                    key: const Key('containers-scan-package'),
                    scale: 0.96,
                    onTap: () {
                      AppHaptics.selection();
                      onScan();
                    },
                    child: Container(
                      height: 36,
                      padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.md),
                      decoration: BoxDecoration(
                        color: AppColors.mist,
                        borderRadius:
                            BorderRadius.circular(AppSpacing.radiusSm),
                        border: Border.all(
                            color: AppColors.cobalt.withValues(alpha: 0.35)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.qr_code_scanner,
                              size: 18, color: AppColors.cobaltDeep),
                          const SizedBox(width: 6),
                          Text(
                            l10n.pkgScanAction,
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: AppColors.cobaltDeep,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: _SearchField(value: search, onChanged: onSearch),
            ),
            // Search cuts across every state, so the state chips step aside
            // while a query is in force rather than appearing to narrow it.
            AnimatedSize(
              duration: AppMotion.swapFor(context),
              curve: AppMotion.standard,
              alignment: Alignment.topCenter,
              child: showFilter
                  ? Padding(
                      padding: const EdgeInsets.fromLTRB(
                          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.md),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _StatusChips(
                            selected: filter,
                            counts: counts,
                            onChanged: onFilter,
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          WaitingEntryRow(
                              count: waitingCount, onTap: onOpenWaiting),
                        ],
                      ),
                    )
                  : const SizedBox(height: AppSpacing.md, width: double.infinity),
            ),
          ],
        ),
      ),
    );
  }
}

class _SearchField extends StatefulWidget {
  const _SearchField({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  State<_SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<_SearchField> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.value);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return TextField(
      key: const Key('containers-search'),
      controller: _controller,
      onChanged: (v) {
        widget.onChanged(v);
        setState(() {});
      },
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: l10n.ctrSearchHint,
        prefixIcon: const Icon(Icons.search, size: 20, color: AppColors.muted),
        suffixIcon: _controller.text.isEmpty
            ? null
            : IconButton(
                icon: const Icon(Icons.close, size: 18),
                onPressed: () {
                  _controller.clear();
                  widget.onChanged('');
                  setState(() {});
                },
              ),
        isDense: true,
      ),
    );
  }
}

class _StatusChips extends StatelessWidget {
  const _StatusChips({
    required this.selected,
    required this.counts,
    required this.onChanged,
  });

  final String selected;
  final Map<String, int> counts;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Row(
      children: [
        for (final status in containerStatuses) ...[
          Expanded(
            child: PressableScale(
              scale: 0.96,
              onTap: () => onChanged(status),
              child: AnimatedContainer(
                duration: AppMotion.press,
                height: 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: status == selected ? AppColors.cobalt : AppColors.paper,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                  border: Border.all(
                    color: status == selected ? AppColors.cobalt : AppColors.rule,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _statusLabel(l10n, status),
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: status == selected ? Colors.white : AppColors.muted,
                      ),
                    ),
                    if ((counts[status] ?? 0) > 0) ...[
                      const SizedBox(width: 6),
                      Text(
                        '${counts[status]}',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: status == selected
                              ? Colors.white.withValues(alpha: 0.85)
                              : AppColors.muted,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
          if (status != containerStatuses.last)
            const SizedBox(width: AppSpacing.sm),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// The list, and the search results.
// ---------------------------------------------------------------------------

class _ContainerList extends StatelessWidget {
  const _ContainerList({
    required this.containers,
    required this.filter,
    required this.anyAtAll,
    required this.onOpen,
  });

  final List<ShippingContainer> containers;
  final String filter;
  final bool anyAtAll;
  final ValueChanged<String> onOpen;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    if (containers.isEmpty) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 120),
        children: [
          LotEmptyState(
            icon: Icons.view_in_ar_outlined,
            title: !anyAtAll
                ? l10n.ctrNoContainers
                : switch (filter) {
                    containerStatusShipped => l10n.ctrNoShipped,
                    containerStatusArrived => l10n.ctrNoArrived,
                    _ => l10n.ctrNoLoading,
                  },
            hint: anyAtAll ? null : l10n.ctrNoContainersHint,
          ),
        ],
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 120),
      itemCount: containers.length,
      itemBuilder: (context, i) {
        final c = containers[i];
        return RiseIn(
          key: ValueKey(c.id),
          index: i,
          child: _ContainerCard(container: c, onTap: () => onOpen(c.id)),
        );
      },
    );
  }
}

class _ContainerCard extends StatelessWidget {
  const _ContainerCard({required this.container, required this.onTap});

  final ShippingContainer container;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final tag = Localizations.localeOf(context).toLanguageTag();
    final c = container;
    final counts = _countsText(l10n, c.carCount, c.barrelCount, c.otherCount);
    final second = [
      if (c.containerNumber.isNotEmpty) c.label,
      if (c.destinationCountryName.isNotEmpty) c.destinationCountryName,
    ].join(' · ');
    final when = c.isArrived && c.arrivedAt != null
        ? l10n.ctrArrivedOn(DateFormat.MMMd(tag).format(c.arrivedAt!))
        : c.isShipped && c.sailedAt != null
            ? l10n.ctrSailed(DateFormat.MMMd(tag).format(c.sailedAt!))
            : '';

    return PressableScale(
      onTap: () {
        AppHaptics.selection();
        onTap();
      },
      scale: 0.985,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.paper,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(color: AppColors.rule),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    c.displayName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.2,
                      color: AppColors.ink,
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                ContainerStatusPill(status: c.status),
              ],
            ),
            if (second.isNotEmpty) ...[
              const SizedBox(height: 3),
              Text(
                second,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 13,
                  height: 1.35,
                  color: AppColors.muted,
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                Expanded(
                  child: Text(
                    counts.isEmpty ? l10n.ctrEmptyContainer : counts,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                ),
                if (when.isNotEmpty) ...[
                  const SizedBox(width: AppSpacing.sm),
                  Text(
                    when,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _SearchResults extends StatelessWidget {
  const _SearchResults({
    required this.hits,
    required this.staff,
    required this.onOpen,
    required this.onOpenWaiting,
  });

  final List<ContainerSearchHit> hits;
  final List<LotStaff> staff;
  final ValueChanged<String> onOpen;
  final ValueChanged<ContainerLine> onOpenWaiting;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final tag = Localizations.localeOf(context).toLanguageTag();
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 120),
      children: [
        if (hits.isEmpty)
          LotEmptyState(icon: Icons.search_off, title: l10n.ctrNoSearchMatch)
        else ...[
          Padding(
            padding: const EdgeInsets.only(left: 2, bottom: AppSpacing.sm),
            child: Text(
              l10n.ctrHitsCount(hits.length),
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.3,
                color: AppColors.muted,
              ),
            ),
          ),
          for (final hit in hits)
            _LineCard(
              key: ValueKey('hit-${hit.line.id}'),
              line: hit.line,
              staff: staff,
              // The line's whereabouts, which is what a search is asking: the
              // box it is on, or that it has none yet.
              trailing: hit.isWaiting
                  ? Column(
                      key: Key('hit-waiting-${hit.line.id}'),
                      crossAxisAlignment: CrossAxisAlignment.end,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const ContainerStatusPill(
                            status: containerLineStatusWaiting),
                        if (hit.line.destinationCountryName.isNotEmpty) ...[
                          const SizedBox(height: 3),
                          Text(
                            hit.line.destinationCountryName,
                            style: const TextStyle(
                              fontSize: 11,
                              color: AppColors.muted,
                            ),
                          ),
                        ],
                      ],
                    )
                  : hit.container == null
                      ? null
                      : Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          hit.container!.displayName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            color: AppColors.ink,
                          ),
                        ),
                        const SizedBox(height: 3),
                        ContainerStatusPill(status: hit.container!.status),
                        if (hit.container!.sailedAt != null) ...[
                          const SizedBox(height: 3),
                          Text(
                            l10n.ctrSailed(DateFormat.MMMd(tag)
                                .format(hit.container!.sailedAt!)),
                            style: const TextStyle(
                              fontSize: 11,
                              color: AppColors.muted,
                            ),
                          ),
                        ],
                      ],
                    ),
              onTap: hit.isWaiting
                  ? () => onOpenWaiting(hit.line)
                  : hit.container == null
                      ? null
                      : () => onOpen(hit.container!.id),
            ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// One container: what is on it, and everything that can still be done to it.
// ---------------------------------------------------------------------------

class ContainerDetailScreen extends StatefulWidget {
  const ContainerDetailScreen({
    super.key,
    required this.businessId,
    required this.containerId,
    required this.staff,
    required this.customers,
    required this.knownCars,
    this.parkedCarRows = const [],
    required this.destinations,
    this.businessCountryCode = '',
    required this.onCustomerRecorded,
    this.feed,
  });

  final String businessId;
  final String containerId;

  /// The list screen's feed, when opened from it. Absent, the detail makes
  /// its own (and disposes it).
  final ContainerFeed? feed;
  final List<LotStaff> staff;
  final List<LotCustomer> customers;
  final List<LotKnownCar> knownCars;

  /// The business's `parkedCars` rows, from the subscription the list screen
  /// already holds: the add-line sheet offers the ones standing in the lot.
  final List<Map<String, dynamic>> parkedCarRows;
  final List<DestinationCountry> destinations;

  /// ISO code of the business's own country, when its address names one.
  final String businessCountryCode;
  final VoidCallback onCustomerRecorded;

  @override
  State<ContainerDetailScreen> createState() => _ContainerDetailScreenState();
}

class _ContainerDetailScreenState extends State<ContainerDetailScreen> {
  ContainerFeed? _ownFeed;
  late final ContainerFeed _feed =
      widget.feed ?? (_ownFeed = ContainerFeed(widget.businessId));

  List<ShippingContainer> get _containers => _feed.containers;
  List<ContainerLine> get _allLines => _feed.lines;
  bool get _loaded => _feed.loaded;

  void _onFeed() {
    if (mounted) setState(() {});
  }

  /// Which action is in flight, so every button disables together and the
  /// one pressed shows it is working.
  String _busy = '';

  ShippingContainer? get _container =>
      _containers.where((c) => c.id == widget.containerId).firstOrNull;

  List<ContainerLine> get _lines =>
      linesOfContainer(_allLines, widget.containerId);

  Map<String, ShippingContainer> get _byId =>
      {for (final c in _containers) c.id: c};

  String get _customerCountryCode =>
      containerCustomerCountryCode(widget.businessCountryCode);

  String _receiverCountryCode(ShippingContainer container) =>
      containerReceiverCountryCode(
        container,
        destinations: widget.destinations,
        businessCountryCode: widget.businessCountryCode,
      );

  @override
  void initState() {
    super.initState();
    _feed.addListener(_onFeed);
  }

  @override
  void dispose() {
    _feed.removeListener(_onFeed);
    _ownFeed?.dispose();
    super.dispose();
  }

  /// One shape for every action: disable the others, show progress on the
  /// one pressed, say what happened, and always release in `finally`.
  /// [failure] is what a non-callable failure says; the callable's own
  /// refusal is mapped through the shared code vocabulary.
  Future<void> _run(
    String action,
    Future<void> Function() work, {
    String? done,
    String? failure,
  }) async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _busy = action);
    try {
      await work();
      if (!mounted) return;
      AppHaptics.commit();
      if (done != null) showSuccessSnackBar(context, done);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, containerRefusalText(l10n, error, containers: _byId));
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, failure ?? l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  /// A refusal the phone can see coming is said here, at once, in the same
  /// words the server would use.
  void _refuse(String code) {
    final l10n = AppLocalizations.of(context)!;
    AppHaptics.refuse();
    showErrorSnackBar(context, containerErrorText(l10n, code));
  }

  Future<void> _edit() async {
    final container = _container;
    if (container == null) return;
    await showLotSheet<String>(
      context,
      _ContainerFormSheet(
        businessId: widget.businessId,
        destinations: widget.destinations,
        existing: container,
      ),
    );
  }

  Future<void> _addLine() async {
    final container = _container;
    if (container == null) return;
    final added = await showLotSheet<bool>(
      context,
      _LineFormSheet(
        businessId: widget.businessId,
        container: container,
        containers: _containers,
        lines: _allLines,
        customers: widget.customers,
        knownCars: widget.knownCars,
        parkedCarRows: widget.parkedCarRows,
        customerCountryCode: _customerCountryCode,
        receiverCountryCode: _receiverCountryCode(container),
        onLineAdded: widget.onCustomerRecorded,
      ),
    );
    if (added == true) widget.onCustomerRecorded();
  }

  /// Tick waiting packages onto this box; the server takes them all or none,
  /// and refuses any that go to another country.
  Future<void> _addWaiting() async {
    final l10n = AppLocalizations.of(context)!;
    final container = _container;
    if (container == null || !container.isLoading) return;
    final added = await showAddWaitingPackagesSheet(
      context,
      businessId: widget.businessId,
      container: container,
      packages: waitingLines(_allLines),
    );
    if (added == null || !mounted) return;
    AppHaptics.commit();
    showSuccessSnackBar(context, l10n.wpkAdded(added, container.displayName));
  }

  Future<void> _ship() async {
    final l10n = AppLocalizations.of(context)!;
    final container = _container;
    if (container == null) return;
    final refusal = containerTransitionRefusal(
        container, containerStatusShipped, _lines.length);
    if (refusal != null) return _refuse(refusal);
    final ok = await confirmMajorAction(
      context,
      title: l10n.ctrShipTitle,
      message: l10n.ctrShipMessage,
      confirmLabel: l10n.ctrShip,
      icon: Icons.directions_boat_outlined,
    );
    if (!ok || !mounted) return;
    await _run('ship', () async {
      await FirebaseFunctions.instance
          .httpsCallable('setContainerStatus')
          .call<Object?>({
        'businessId': widget.businessId,
        'containerId': widget.containerId,
        'status': containerStatusShipped,
      });
    }, done: l10n.ctrShippedDone);
  }

  Future<void> _arrive() async {
    final l10n = AppLocalizations.of(context)!;
    final container = _container;
    if (container == null) return;
    final refusal = containerTransitionRefusal(
        container, containerStatusArrived, _lines.length);
    if (refusal != null) return _refuse(refusal);
    final ok = await confirmMajorAction(
      context,
      title: l10n.ctrArriveTitle,
      message: l10n.ctrArriveMessage,
      confirmLabel: l10n.ctrArrive,
      icon: Icons.flag_outlined,
    );
    if (!ok || !mounted) return;
    await _run('arrive', () async {
      await FirebaseFunctions.instance
          .httpsCallable('setContainerStatus')
          .call<Object?>({
        'businessId': widget.businessId,
        'containerId': widget.containerId,
        'status': containerStatusArrived,
      });
    }, done: l10n.ctrArrivedDone);
  }

  Future<void> _delete() async {
    final l10n = AppLocalizations.of(context)!;
    final container = _container;
    if (container == null) return;
    final refusal = containerDeleteRefusal(container, _lines.length);
    if (refusal != null) return _refuse(refusal);
    final ok = await confirmMajorAction(
      context,
      title: l10n.ctrDeleteTitle,
      message: l10n.ctrDeleteMessage,
      confirmLabel: l10n.ctrDelete,
      destructive: true,
    );
    if (!ok || !mounted) return;
    final navigator = Navigator.of(context);
    await _run('delete', () async {
      await FirebaseFunctions.instance
          .httpsCallable('deleteContainer')
          .call<Object?>({
        'businessId': widget.businessId,
        'containerId': widget.containerId,
      });
      if (mounted) navigator.pop();
    }, done: l10n.ctrDeleted);
  }

  Future<void> _openDocument() async {
    final l10n = AppLocalizations.of(context)!;
    await _run('document', () async {
      final response = await FirebaseFunctions.instance
          .httpsCallable('getContainerDocumentUrl')
          .call<Object?>({
        'businessId': widget.businessId,
        'containerId': widget.containerId,
      });
      final data = response.data;
      final url = data is Map ? (data['url'] ?? '').toString() : '';
      final uri = url.isEmpty ? null : Uri.tryParse(url);
      if (uri == null) throw StateError('no url');
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened) throw StateError('not opened');
    }, failure: l10n.lotDocumentCouldNotBeOpened);
  }

  /// Labels for every package on the box, or one line's when [line] is
  /// given - in every state: a label torn at the port needs reprinting
  /// long after the box has sailed.
  Future<void> _printLabels({ContainerLine? line}) async {
    final container = _container;
    if (container == null) return;
    await showContainerLabelSheet(
      context,
      businessId: widget.businessId,
      container: container,
      line: line,
    );
  }

  void _history() {
    showLotSheet(
      context,
      LotHistorySheet(
        businessId: widget.businessId,
        entityId: widget.containerId,
        staff: widget.staff,
      ),
    );
  }

  Future<void> _lineActions(ContainerLine line) async {
    final container = _container;
    if (container == null) return;
    final l10n = AppLocalizations.of(context)!;
    final others = [
      for (final c in _containers)
        if (c.isLoading && c.id != container.id) c,
    ];
    final action = await showLotSheet<String>(
      context,
      _LineActionsSheet(
        line: line,
        staff: widget.staff,
        open: container.isLoading,
      ),
    );
    if (action == null || !mounted) return;
    if (action == 'contacts') {
      // Open in every state: a wrong number matters most once the box has
      // sailed, which is when the updates start going out.
      final saved = await editContainerLineContacts(
        context,
        businessId: widget.businessId,
        line: line,
        container: container,
        businessCountryCode: widget.businessCountryCode,
        destinations: widget.destinations,
      );
      if (saved) widget.onCustomerRecorded();
      return;
    }
    if (action == 'labels') {
      await _printLabels(line: line);
      return;
    }
    if (action == 'money') {
      // The price and what has been paid, in every state: the team at the
      // port records the money as it arrives.
      await showPackagePaymentSheet(
        context,
        businessId: widget.businessId,
        line: line,
        staff: widget.staff,
      );
      return;
    }
    if (action == 'back') {
      final ok = await confirmMajorAction(
        context,
        title: l10n.wpkSendBackTitle,
        message: l10n.wpkSendBackMessage(
            containerLineTitle(l10n, line), container.displayName),
        confirmLabel: l10n.wpkSendBack,
      );
      if (!ok || !mounted) return;
      await _run('back', () async {
        await FirebaseFunctions.instance
            .httpsCallable('unassignContainerLine')
            .call<Object?>(unassignLineRequest(widget.businessId, line.id));
      }, done: l10n.wpkSentBack);
      return;
    }
    if (action == 'edit') {
      final saved = await editContainerLine(
        context,
        businessId: widget.businessId,
        line: line,
        container: container,
        containers: _containers,
        lines: _allLines,
        customers: widget.customers,
        knownCars: widget.knownCars,
        parkedCarRows: widget.parkedCarRows,
        businessCountryCode: widget.businessCountryCode,
        destinations: widget.destinations,
      );
      if (saved) widget.onCustomerRecorded();
      return;
    }
    if (action == 'move') {
      if (others.isEmpty) {
        AppHaptics.refuse();
        showErrorSnackBar(context, l10n.ctrNoOtherLoading);
        return;
      }
      final target = await pickLotOption<String>(
        context,
        title: l10n.ctrMoveTo,
        options: [
          for (final c in others)
            LotOption(
              c.id,
              c.displayName,
              detail: c.containerNumber.isNotEmpty ? c.label : null,
            ),
        ],
      );
      if (target == null || !mounted) return;
      await _run('move', () async {
        await FirebaseFunctions.instance
            .httpsCallable('moveContainerLine')
            .call<Object?>({
          'businessId': widget.businessId,
          'lineId': line.id,
          'toContainerId': target,
        });
      }, done: l10n.ctrMoved);
    } else if (action == 'remove') {
      final ok = await confirmMajorAction(
        context,
        title: l10n.ctrRemoveLineTitle,
        message: l10n.ctrRemoveLineMessage,
        confirmLabel: l10n.ctrRemove,
        destructive: true,
      );
      if (!ok || !mounted) return;
      await _run('remove', () async {
        await FirebaseFunctions.instance
            .httpsCallable('removeContainerLine')
            .call<Object?>({
          'businessId': widget.businessId,
          'containerId': widget.containerId,
          'lineId': line.id,
        });
      }, done: l10n.ctrLineRemoved);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final tag = Localizations.localeOf(context).toLanguageTag();
    final container = _container;
    final lines = _lines;

    if (container == null) {
      // Deleted from another device, or not readable: there is nothing to
      // show, and staying on an empty page is how people tap Add into a void.
      return Scaffold(
        backgroundColor: AppColors.cream,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(4, 4, 0, 0),
                child: AppBackButton(),
              ),
              Expanded(
                child: _loaded
                    ? LotEmptyState(
                        icon: Icons.view_in_ar_outlined,
                        title: l10n.ctrErrNotFound,
                      )
                    : const Center(child: CircularProgressIndicator()),
              ),
            ],
          ),
        ),
      );
    }

    final counts = containerCounts(lines);
    final countsText = _countsText(
        l10n, counts.carCount, counts.barrelCount, counts.otherCount);
    final busy = _busy.isNotEmpty;
    final waitingCount = _allLines.where((l) => l.isWaiting).length;

    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          Container(
            decoration: BoxDecoration(
              color: AppColors.paper,
              border: Border(
                bottom: BorderSide(color: AppColors.rule.withValues(alpha: 0.8)),
              ),
            ),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(4, 4, AppSpacing.sm, AppSpacing.md),
                child: Row(
                  children: [
                    const AppBackButton(),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            container.displayName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                              height: 1.1,
                              letterSpacing: -0.4,
                              color: AppColors.ink,
                            ),
                          ),
                          if (container.containerNumber.isNotEmpty)
                            Text(
                              container.label,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 12,
                                height: 1.3,
                                color: AppColors.muted,
                              ),
                            ),
                        ],
                      ),
                    ),
                    IconButton(
                      key: const Key('container-edit'),
                      onPressed: busy ? null : _edit,
                      icon: const Icon(Icons.edit_outlined, size: 20),
                      color: AppColors.muted,
                      tooltip: l10n.ctrEditContainer,
                    ),
                    IconButton(
                      key: const Key('container-history'),
                      onPressed: _history,
                      icon: const Icon(Icons.history, size: 20),
                      color: AppColors.muted,
                      tooltip: l10n.lotHistory,
                    ),
                    if (container.isLoading)
                      IconButton(
                        key: const Key('container-delete'),
                        onPressed: busy ? null : _delete,
                        icon: const Icon(Icons.delete_outline, size: 20),
                        color: AppColors.muted,
                        tooltip: l10n.ctrDelete,
                      ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: Stack(
              children: [
                ListView(
                  padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 120),
                  children: [
                    _DetailFacts(
                      container: container,
                      countsText: countsText,
                      tag: tag,
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Row(
                      children: [
                        Expanded(
                          child: ContainerActionButton(
                            key: const Key('container-document'),
                            icon: Icons.description_outlined,
                            label: l10n.ctrOpenDocument,
                            busy: _busy == 'document',
                            enabled: !busy,
                            onTap: _openDocument,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        // Every state: labels get reprinted at the port too.
                        Expanded(
                          child: ContainerActionButton(
                            key: const Key('container-print-labels'),
                            icon: Icons.qr_code_2,
                            label: l10n.ctrPrintLabels,
                            enabled: !busy && lines.isNotEmpty,
                            onTap: _printLabels,
                          ),
                        ),
                      ],
                    ),
                    if (!container.isArrived) ...[
                      const SizedBox(height: AppSpacing.sm),
                      ContainerActionButton(
                        key: Key(container.isLoading
                            ? 'container-ship'
                            : 'container-arrive'),
                        icon: container.isLoading
                            ? Icons.directions_boat_outlined
                            : Icons.flag_outlined,
                        label: container.isLoading
                            ? l10n.ctrShip
                            : l10n.ctrArrive,
                        busy: _busy == 'ship' || _busy == 'arrive',
                        enabled: !busy,
                        primary: true,
                        onTap: container.isLoading ? _ship : _arrive,
                      ),
                    ],
                    // Once the box has news for customers: catch everyone
                    // on it up to the latest update they have not had.
                    if (!container.isLoading && lines.isNotEmpty) ...[
                      const SizedBox(height: AppSpacing.sm),
                      ContainerSendStatusAction(
                        businessId: widget.businessId,
                        containerId: widget.containerId,
                        enabled: !busy || _busy == 'status',
                        onBusyChanged: (on) {
                          if (mounted) setState(() => _busy = on ? 'status' : '');
                        },
                      ),
                    ],
                    // Packages dropped off before any container: tick the ones
                    // that go on this box. Only while it is still loading.
                    if (container.isLoading) ...[
                      const SizedBox(height: AppSpacing.sm),
                      ContainerActionButton(
                        key: const Key('container-add-waiting'),
                        icon: Icons.inventory_2_outlined,
                        label: l10n.wpkAddWaitingCount(waitingCount),
                        enabled: !busy && waitingCount > 0,
                        onTap: _addWaiting,
                      ),
                    ],
                    const SizedBox(height: AppSpacing.lg),
                    Padding(
                      padding: const EdgeInsets.only(left: 2, bottom: AppSpacing.sm),
                      child: Text(
                        '${l10n.ctrLoaded} · ${lines.length}',
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.3,
                          color: AppColors.muted,
                        ),
                      ),
                    ),
                    if (lines.isEmpty)
                      LotEmptyState(
                        icon: Icons.inventory_2_outlined,
                        title: l10n.ctrEmptyContainer,
                        hint: container.isLoading
                            ? l10n.ctrEmptyContainerHint
                            : null,
                      )
                    else
                      for (var i = 0; i < lines.length; i++)
                        RiseIn(
                          key: ValueKey(lines[i].id),
                          index: i,
                          child: _LineCard(
                            line: lines[i],
                            staff: widget.staff,
                            onTap: busy ? null : () => _lineActions(lines[i]),
                            trailing: IconButton(
                              key: ValueKey('line-print-labels:${lines[i].id}'),
                              onPressed: busy
                                  ? null
                                  : () => _printLabels(line: lines[i]),
                              icon: const Icon(Icons.qr_code_2, size: 20),
                              color: AppColors.cobaltDeep,
                              tooltip: l10n.ctrPrintLineLabels,
                              visualDensity: VisualDensity.compact,
                            ),
                          ),
                        ),
                  ],
                ),
                if (container.isLoading)
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: LotPrimaryBar(
                      label: l10n.ctrAddLine,
                      icon: Icons.add,
                      onTap: _addLine,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The facts of the box: state, destination, reference, dates, notes.
class _DetailFacts extends StatelessWidget {
  const _DetailFacts({
    required this.container,
    required this.countsText,
    required this.tag,
  });

  final ShippingContainer container;
  final String countsText;
  final String tag;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final c = container;
    final dates = <String>[
      if (c.sailedAt != null)
        l10n.ctrSailed(DateFormat.yMMMd(tag).format(c.sailedAt!)),
      if (c.arrivedAt != null)
        l10n.ctrArrivedOn(DateFormat.yMMMd(tag).format(c.arrivedAt!)),
    ];
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              ContainerStatusPill(status: c.status),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  countsText.isEmpty ? l10n.ctrEmptyContainer : countsText,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          _FactRow(
            icon: Icons.public,
            label: l10n.ctrDestination,
            value: c.destinationCountryName.isEmpty
                ? l10n.ctrDestinationUnset
                : c.destinationCountryName,
            muted: c.destinationCountryName.isEmpty,
          ),
          if (c.bookingReference.isNotEmpty)
            _FactRow(
              icon: Icons.confirmation_number_outlined,
              label: l10n.ctrBookingReference,
              value: c.bookingReference,
            ),
          for (final d in dates)
            _FactRow(icon: Icons.event_outlined, label: '', value: d),
          if (!c.isLoading) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              l10n.ctrLockedNote,
              style: const TextStyle(
                fontSize: 12,
                height: 1.35,
                color: AppColors.muted,
              ),
            ),
          ],
          if (c.notes.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.parchment,
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              ),
              child: Text(
                c.notes,
                style: const TextStyle(
                  fontSize: 13,
                  height: 1.4,
                  color: AppColors.ink,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _FactRow extends StatelessWidget {
  const _FactRow({
    required this.icon,
    required this.label,
    required this.value,
    this.muted = false,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: AppColors.muted),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              label.isEmpty ? value : '$label: $value',
              style: TextStyle(
                fontSize: 13,
                height: 1.35,
                color: muted ? AppColors.muted : AppColors.ink,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A full-width action on a container or package: quiet by default, solid
/// when [primary], with its own spinner while [busy].
class ContainerActionButton extends StatelessWidget {
  const ContainerActionButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.busy = false,
    this.enabled = true,
    this.primary = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool busy;
  final bool enabled;
  final bool primary;

  @override
  Widget build(BuildContext context) {
    final fg = primary ? Colors.white : AppColors.cobaltDeep;
    return PressableScale(
      onTap: enabled ? onTap : null,
      child: AnimatedOpacity(
        duration: AppMotion.press,
        opacity: enabled || busy ? 1 : 0.55,
        child: Container(
          height: 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: primary ? AppColors.cobalt : AppColors.paper,
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            border: Border.all(
              color: primary ? AppColors.cobalt : AppColors.rule,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (busy)
                SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2, color: fg),
                )
              else
                Icon(icon, size: 18, color: fg),
              const SizedBox(width: AppSpacing.sm),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: fg,
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

/// Calls `sendContainerCurrentStatus` and answers its data. Injected in tests.
typedef ContainerStatusSender = Future<Object?> Function(
  Map<String, Object?> payload,
);

Future<Object?> _sendContainerStatusCallable(Map<String, Object?> payload) async {
  final response = await FirebaseFunctions.instance
      .httpsCallable('sendContainerCurrentStatus')
      .call<Object?>(payload);
  return response.data;
}

/// "Send current status on WhatsApp": everyone on the box who has not heard
/// its latest update gets it now (`sendContainerCurrentStatus`). Asks first,
/// shows progress while the server queues the messages, and says what
/// happened - including, plainly, that nothing can go out until WhatsApp is
/// connected.
class ContainerSendStatusAction extends StatefulWidget {
  const ContainerSendStatusAction({
    super.key,
    required this.businessId,
    required this.containerId,
    this.enabled = true,
    this.onBusyChanged,
    this.send,
  });

  final String businessId;
  final String containerId;
  final bool enabled;

  /// Lets the container detail disable its other actions while this runs.
  final ValueChanged<bool>? onBusyChanged;
  final ContainerStatusSender? send;

  @override
  State<ContainerSendStatusAction> createState() =>
      _ContainerSendStatusActionState();
}

class _ContainerSendStatusActionState extends State<ContainerSendStatusAction> {
  bool _busy = false;

  void _setBusy(bool busy) {
    if (!mounted) return;
    setState(() => _busy = busy);
    widget.onBusyChanged?.call(busy);
  }

  Future<void> _run() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    final ok = await confirmMajorAction(
      context,
      title: l10n.ctrSendStatusTitle,
      message: l10n.ctrSendStatusMessage,
      confirmLabel: l10n.ctrSendStatusConfirm,
      icon: Icons.chat_outlined,
    );
    if (!ok || !mounted) return;
    _setBusy(true);
    try {
      final data = await (widget.send ?? _sendContainerStatusCallable)({
        'businessId': widget.businessId,
        'containerId': widget.containerId,
      });
      if (!mounted) return;
      final result = ContainerCurrentStatusResult.fromCallable(data);
      AppHaptics.commit();
      showSuccessSnackBar(context, containerSendStatusSummary(l10n, result));
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      final reason = containerStatusRefusalReason(error.details);
      if (reason == containerStatusRefusalNotConfigured) {
        // The server has answered: the button stops spinning while the
        // explanation is read.
        _setBusy(false);
        await showDialog<void>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            key: const Key('container-whatsapp-not-connected'),
            icon: const Icon(Icons.link_off, color: AppColors.warn),
            title: Text(l10n.ctrWhatsAppNotConnectedTitle),
            content: Text(l10n.ctrWhatsAppNotConnectedMessage),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: Text(l10n.close),
              ),
            ],
          ),
        );
      } else if (reason == containerStatusRefusalNoUpdate) {
        showErrorSnackBar(context, l10n.ctrSendStatusNoNews);
      } else {
        showErrorSnackBar(context, containerRefusalText(l10n, error));
      }
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, l10n.lotCouldNotSave);
    } finally {
      _setBusy(false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ContainerActionButton(
      key: const Key('container-send-status'),
      icon: Icons.chat_outlined,
      label: l10n.ctrSendStatus,
      busy: _busy,
      enabled: widget.enabled && !_busy,
      onTap: _run,
    );
  }
}

/// What the server did, in one sentence or three: who was messaged, who
/// already had it, who cannot be reached.
String containerSendStatusSummary(
  AppLocalizations l10n,
  ContainerCurrentStatusResult result,
) {
  final moment = containerUpdateMomentLabel(l10n, result.update);
  final parts = <String>[
    if (result.queued > 0)
      l10n.ctrSendStatusQueued(result.queued, moment)
    else if (result.inFlight > 0)
      l10n.ctrSendStatusInFlight(result.inFlight)
    else
      l10n.ctrSendStatusNothingToSend,
    if (result.alreadySent > 0) l10n.ctrSendStatusAlreadyHad(result.alreadySent),
    if (result.skipped > 0) l10n.ctrSendStatusCantReach(result.skipped),
  ];
  return parts.join(' ');
}

/// A customer-update moment in words: "left port", "arrived".
String containerUpdateMomentLabel(AppLocalizations l10n, String update) =>
    switch (update) {
      containerUpdateShipped => l10n.pkgMomentShipped,
      containerUpdateAtPort => l10n.pkgMomentAtPort,
      containerUpdateArrived => l10n.pkgMomentArrived,
      _ => update,
    };

// ---------------------------------------------------------------------------
// A line on the list.
// ---------------------------------------------------------------------------

class _LineCard extends StatelessWidget {
  const _LineCard({
    super.key,
    required this.line,
    required this.staff,
    this.trailing,
    this.onTap,
  });

  final ContainerLine line;
  final List<LotStaff> staff;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final addedBy = staff
            .where((s) => s.id == line.addedByStaffId)
            .firstOrNull
            ?.name ??
        '';
    final owner = line.isStock
        ? l10n.ctrStock
        : [line.customerName, line.customerPhone]
            .where((p) => p.isNotEmpty)
            .join(' · ');
    final receiver = [line.receiverName, line.receiverPhone]
        .where((p) => p.isNotEmpty)
        .join(' · ');
    final detail = [
      if (line.isCar && line.vinNumber.isNotEmpty && line.vehicleLabel != line.vinNumber)
        line.vinNumber,
      owner,
      if (receiver.isNotEmpty) '→ $receiver',
    ].where((p) => p.isNotEmpty).join(' · ');
    // Who will hear about the shipment on WhatsApp, and whose number cannot
    // be reached because it has no country code.
    final updated = [
      if (line.updatesCustomer)
        line.customerName.isNotEmpty ? line.customerName : l10n.lotCustomer,
      if (line.updatesReceiver)
        line.receiverName.isNotEmpty ? line.receiverName : l10n.ctrReceiverShort,
    ];
    final unreachable = [
      if (line.customerPhoneLacksCountryCode) l10n.ctrCustomerPhoneNoCountryCode,
      if (line.receiverPhoneLacksCountryCode) l10n.ctrReceiverPhoneNoCountryCode,
    ];
    final anyPhone = (!line.isStock && line.customerPhone.isNotEmpty) ||
        line.receiverPhone.isNotEmpty;

    return PressableScale(
      onTap: onTap == null
          ? null
          : () {
              AppHaptics.selection();
              onTap!();
            },
      scale: 0.985,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.paper,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(color: AppColors.rule),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.mist,
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              ),
              child: Icon(containerKindIcon(line.kind), size: 18, color: AppColors.cobaltDeep),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    containerLineTitle(l10n, line),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.2,
                      color: AppColors.ink,
                    ),
                  ),
                  if (detail.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(
                      detail,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 13,
                        height: 1.35,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                  if (packageSize(line) != null)
                    _LineNote(
                      key: const Key('line-size'),
                      icon: Icons.straighten,
                      text:
                          '${packageSize(line)!.dimensionsText} · ${packageSize(line)!.volumeText}',
                      color: AppColors.muted,
                    ),
                  if (line.trackingCode.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      l10n.ctrLineTrackingCode(line.trackingCode),
                      key: const Key('line-tracking-code'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.2,
                        color: AppColors.cobaltDeep,
                      ),
                    ),
                  ],
                  // Priced packages show their payment standing; most lines on
                  // a container predate prices and show nothing.
                  PackageMoneyLine(payment: packagePayment(line)),
                  if (updated.isNotEmpty)
                    _LineNote(
                      key: const Key('line-updates'),
                      icon: Icons.chat_outlined,
                      text: l10n.ctrUpdatesTo(updated.join(', ')),
                      color: AppColors.sage,
                    )
                  else if (anyPhone && unreachable.isEmpty)
                    _LineNote(
                      key: const Key('line-updates-off'),
                      icon: Icons.notifications_off_outlined,
                      text: l10n.ctrUpdatesOff,
                      color: AppColors.muted,
                    ),
                  for (final warning in unreachable)
                    _LineNote(
                      key: ValueKey('line-phone-warning:$warning'),
                      icon: Icons.warning_amber_rounded,
                      text: warning,
                      color: AppColors.warn,
                    ),
                  if (addedBy.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      '${l10n.lotRecordedBy}: $addedBy',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (trailing != null) ...[
              const SizedBox(width: AppSpacing.sm),
              trailing!,
            ],
          ],
        ),
      ),
    );
  }
}

/// One short line under a line's details: an icon and what it says.
class _LineNote extends StatelessWidget {
  const _LineNote({
    super.key,
    required this.icon,
    required this.text,
    required this.color,
  });

  final IconData icon;
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Icon(icon, size: 14, color: color),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 12,
                height: 1.3,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LineActionsSheet extends StatelessWidget {
  const _LineActionsSheet({
    required this.line,
    required this.staff,
    required this.open,
  });

  final ContainerLine line;
  final List<LotStaff> staff;

  /// Whether the container is still loading. A shipped list is the record
  /// of what went, so its lines are shown and left alone.
  final bool open;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return LotSheetShell(
      title: containerLineTitle(l10n, line),
      subtitle: open ? null : l10n.ctrLockedNote,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _LineCard(line: line, staff: staff),
          const SizedBox(height: AppSpacing.sm),
          // Contacts stay correctable after the box ships; the rest of the
          // line is the record of what went.
          ContainerSheetAction(
            key: const Key('line-edit-contacts'),
            icon: Icons.contact_phone_outlined,
            label: l10n.ctrEditContacts,
            onTap: () => Navigator.of(context).pop('contacts'),
          ),
          ContainerSheetAction(
            key: const Key('line-print-labels'),
            icon: Icons.qr_code_2,
            label: l10n.ctrPrintLineLabels,
            onTap: () => Navigator.of(context).pop('labels'),
          ),
          // A price is agreed and money arrives after the box has sailed as
          // often as before, so this stays open in every state.
          ContainerSheetAction(
            key: const Key('line-price-payments'),
            icon: Icons.payments_outlined,
            label: l10n.wpkMoney,
            onTap: () => Navigator.of(context).pop('money'),
          ),
          if (open) ...[
            // What the line is and whose: only while the box is loading.
            ContainerSheetAction(
              key: const Key('line-edit'),
              icon: Icons.edit_outlined,
              label: l10n.ctrEditLine,
              onTap: () => Navigator.of(context).pop('edit'),
            ),
            ContainerSheetAction(
              key: const Key('line-move'),
              icon: Icons.drive_file_move_outlined,
              label: l10n.ctrMoveLine,
              onTap: () => Navigator.of(context).pop('move'),
            ),
            // Back to the waiting list, keeping its label and code.
            ContainerSheetAction(
              key: const Key('line-send-back'),
              icon: Icons.undo,
              label: l10n.wpkSendBack,
              onTap: () => Navigator.of(context).pop('back'),
            ),
            ContainerSheetAction(
              key: const Key('line-remove'),
              icon: Icons.remove_circle_outline,
              label: l10n.ctrRemoveLine,
              destructive: true,
              onTap: () => Navigator.of(context).pop('remove'),
            ),
          ],
        ],
      ),
    );
  }
}

class ContainerSheetAction extends StatelessWidget {
  const ContainerSheetAction({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.destructive = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final color = destructive ? AppColors.errorRed : AppColors.ink;
    return PressableScale(
      onTap: onTap,
      scale: 0.99,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg, vertical: AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.parchment,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          border: Border.all(color: AppColors.rule),
        ),
        child: Row(
          children: [
            Icon(icon, size: 18, color: color),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: color,
                ),
              ),
            ),
            const Icon(Icons.chevron_right, size: 18, color: AppColors.muted),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Creating and editing a container.
// ---------------------------------------------------------------------------

class _ContainerFormSheet extends StatefulWidget {
  const _ContainerFormSheet({
    required this.businessId,
    required this.destinations,
    this.existing,
  });

  final String businessId;
  final List<DestinationCountry> destinations;
  final ShippingContainer? existing;

  @override
  State<_ContainerFormSheet> createState() => _ContainerFormSheetState();
}

class _ContainerFormSheetState extends State<_ContainerFormSheet> {
  final _label = TextEditingController();
  final _number = TextEditingController();
  final _reference = TextEditingController();
  final _notes = TextEditingController();
  String _destinationId = '';
  String _destinationName = '';
  bool _busy = false;
  Set<String> _errors = {};

  /// A refusal that belongs to no one field, said above the button.
  String _serverNote = '';

  bool get _editing => widget.existing != null;

  /// Once shipped the identity is the record: only the notes stay open, and
  /// the form offers only what the server will accept.
  bool get _open => containerIsOpen(widget.existing);

  @override
  void initState() {
    super.initState();
    final existing = widget.existing;
    if (existing == null) return;
    _label.text = existing.label;
    _number.text = existing.containerNumber;
    _reference.text = existing.bookingReference;
    _notes.text = existing.notes;
    _destinationId = existing.destinationCountryId;
    _destinationName = existing.destinationCountryName;
  }

  @override
  void dispose() {
    for (final c in [_label, _number, _reference, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  void _clearError(String code) {
    if (_serverNote.isNotEmpty) setState(() => _serverNote = '');
    if (!_errors.contains(code)) return;
    setState(() => _errors = {..._errors}..remove(code));
  }

  Future<void> _pickDestination() async {
    final picked = await pickContainerDestination(
      context,
      destinations: widget.destinations,
      selectedId: _destinationId,
    );
    if (picked == null || !mounted) return;
    setState(() {
      _destinationId = picked.id;
      _destinationName = picked.name;
      _errors = {..._errors}..remove('destination_required');
    });
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    final draft = ContainerDraft(
      label: _label.text,
      containerNumber: _number.text,
      bookingReference: _reference.text,
      destinationCountryId: _destinationId,
      destinationCountryName: _destinationName,
      notes: _notes.text,
    );
    final errors = _open ? validateContainer(draft) : const <String>[];
    if (errors.isNotEmpty) {
      AppHaptics.refuse();
      setState(() => _errors = errors.toSet());
      return;
    }

    setState(() {
      _busy = true;
      _serverNote = '';
    });
    final record = containerRecord(draft);
    try {
      final functions = FirebaseFunctions.instance;
      String id;
      if (_editing) {
        id = widget.existing!.id;
        await functions.httpsCallable('updateContainer').call<Object?>({
          'businessId': widget.businessId,
          'containerId': id,
          // Structural fields only while loading; the notes always.
          'changes': _open ? record : {'notes': record['notes']},
        });
      } else {
        final result = await functions.httpsCallable('createContainer').call<Object?>({
          'businessId': widget.businessId,
          ...record,
        });
        final data = result.data;
        id = data is Map ? (data['containerId'] ?? '').toString() : '';
      }
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(id);
      showSuccessSnackBar(context, _editing ? l10n.ctrUpdated : l10n.ctrCreated);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      final refusal = parseContainerRefusal(error.details, error.message);
      // A code that names a field lands on the field; the rest is said
      // above the button, where the person who pressed it is looking.
      final fieldCodes = refusal.codes.where(_fieldCodes.contains).toSet();
      final rest = refusal.codes.where((c) => !_fieldCodes.contains(c));
      setState(() {
        _errors = fieldCodes;
        _serverNote = rest.isNotEmpty
            ? rest.map((c) => containerErrorText(l10n, c)).join(' ')
            : (fieldCodes.isEmpty
                ? (refusal.message.isNotEmpty
                    ? refusal.message
                    : l10n.lotCouldNotSave)
                : '');
      });
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _serverNote = l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  static const _fieldCodes = {
    'container_label_required',
    'container_number_invalid',
    'destination_required',
  };

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    String? errorFor(String code) =>
        _errors.contains(code) ? containerErrorText(l10n, code) : null;

    return LotSheetShell(
      title: _editing ? l10n.ctrEditContainer : l10n.ctrNewContainer,
      subtitle: _open ? null : l10n.ctrLockedNote,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            _RefusalNote(text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            label: _editing ? l10n.lotSave : l10n.ctrCreate,
            busy: _busy,
            busyLabel: _editing ? l10n.lotSaving : l10n.ctrCreating,
            onTap: _submit,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('container-label'),
            controller: _label,
            enabled: _open,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => _clearError('container_label_required'),
            decoration: InputDecoration(
              labelText: l10n.ctrLabel,
              hintText: l10n.ctrLabelHint,
              helperText: l10n.ctrLabelOptionalNote,
              errorText: errorFor('container_label_required'),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('container-number'),
            controller: _number,
            enabled: _open,
            textCapitalization: TextCapitalization.characters,
            onChanged: (_) => _clearError('container_number_invalid'),
            decoration: InputDecoration(
              labelText: l10n.ctrNumber,
              helperText: l10n.ctrNumberHint,
              helperMaxLines: 2,
              errorText: errorFor('container_number_invalid'),
              errorMaxLines: 3,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('container-reference'),
            controller: _reference,
            enabled: _open,
            textCapitalization: TextCapitalization.characters,
            onChanged: (_) => _clearError('server'),
            decoration: InputDecoration(labelText: l10n.ctrBookingReference),
          ),
          const SizedBox(height: AppSpacing.md),
          if (_open)
            LotPickerField(
              label: l10n.ctrDestination,
              value: _destinationName.isEmpty ? null : _destinationName,
              placeholder: l10n.ctrChooseDestination,
              onTap: _pickDestination,
              error: errorFor('destination_required'),
            )
          else
            InputDecorator(
              decoration: InputDecoration(
                labelText: l10n.ctrDestination,
                enabled: false,
              ),
              child: Text(
                _destinationName.isEmpty
                    ? l10n.ctrDestinationUnset
                    : _destinationName,
                style: const TextStyle(fontSize: 15, color: AppColors.muted),
              ),
            ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('container-notes'),
            controller: _notes,
            maxLines: 3,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => _clearError('server'),
            decoration: InputDecoration(labelText: l10n.ctrNotes),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Adding a line, or editing one already on the list.
// ---------------------------------------------------------------------------

class _LineFormSheet extends StatefulWidget {
  const _LineFormSheet({
    required this.businessId,
    this.container,
    required this.containers,
    required this.lines,
    required this.customers,
    required this.knownCars,
    this.parkedCarRows = const [],
    this.customerCountryCode = 'US',
    this.receiverCountryCode = 'US',
    this.onLineAdded,
    this.existing,
    this.waiting = false,
    this.destinations = const [],
    this.defaultDestination,
    this.caller = callContainerCallable,
  }) : assert(waiting || container != null);

  final String businessId;

  /// The container the line goes on; null for a package dropped off before
  /// any container ([waiting]).
  final ShippingContainer? container;

  /// The same form, registering (or correcting) a package that waits for a
  /// container: always a customer's, plus where it is going, its size and its
  /// price, saved through `addWaitingPackage`.
  final bool waiting;

  /// The business's own destinations, which lead the destination picker, and
  /// the one a new package opens on (the main destination).
  final List<DestinationCountry> destinations;
  final DestinationRef? defaultDestination;

  /// How a waiting package is saved; a fake in tests.
  final ContainerCallableCaller caller;

  /// The line being edited; null when adding a new one. The same form opens
  /// pre-filled and saves through `updateContainerLine` instead.
  final ContainerLine? existing;

  /// Where the customer's phone picker starts: the business's country.
  final String customerCountryCode;

  /// Where the receiver's phone picker starts: the container's destination.
  final String receiverCountryCode;
  final List<ShippingContainer> containers;

  /// Told after every save, including the ones that keep the sheet open
  /// for the next customer's share, so the lot's customer memory refreshes
  /// even if the sheet is then dismissed.
  final VoidCallback? onLineAdded;

  /// Every line of the business, so a VIN already on an open box is refused
  /// here before the server has to.
  final List<ContainerLine> lines;
  final List<LotCustomer> customers;
  final List<LotKnownCar> knownCars;

  /// The raw `parkedCars` rows: the "parked in your lot?" picker is built
  /// from these, joined in memory to the open containers.
  final List<Map<String, dynamic>> parkedCarRows;

  @override
  State<_LineFormSheet> createState() => _LineFormSheetState();
}

class _LineFormSheetState extends State<_LineFormSheet> {
  final _vin = TextEditingController();
  final _make = TextEditingController();
  final _model = TextEditingController();
  final _year = TextEditingController();
  final _quantity = TextEditingController();
  final _description = TextEditingController();
  final _customer = TextEditingController();
  final _phone = TextEditingController();
  final _receiver = TextEditingController();
  final _receiverPhone = TextEditingController();
  final _lotFilter = TextEditingController();
  final _length = TextEditingController();
  final _width = TextEditingController();
  final _height = TextEditingController();
  final _price = TextEditingController();
  String _destinationId = '';
  String _destinationName = '';
  bool _payOnArrival = false;

  /// Lines saved from this one opening of the sheet. Five barrels for three
  /// customers are three lines, entered back to back without closing it.
  final List<String> _addedThisSitting = [];

  String _kind = containerLineKindCar;
  String _owner = containerOwnerCustomer;

  /// Whether each person hears about the shipment on WhatsApp: on unless
  /// staff switch it off, and only ever sent with a phone.
  bool _notifyCustomer = true;
  bool _notifyReceiver = true;
  bool _busy = false;
  Set<String> _errors = {};
  String _serverNote = '';
  String _conflictName = '';

  /// The VIN is held by a package waiting for a container: no box to name.
  bool _conflictWaiting = false;
  List<LotCustomer> _suggestions = const [];

  /// "Is this car parked in your lot?" - unanswered until one of the two is
  /// tapped, and nothing about the car is asked until then. Part of the
  /// draft: the sheet opens unanswered and a change of kind clears it.
  bool? _inLot;

  /// The parked car chosen from the lot, once one is. The fields it filled
  /// stay editable; this only remembers where they came from.
  LotCarChoice? _pickedCar;

  final VinDecoderService _vinDecoder = NhtsaVinDecoderService();
  String _vinHint = '';
  bool _vinBusy = false;
  String _decodedVin = '';

  bool get _editing => widget.existing != null;
  bool get _waiting => widget.waiting;

  @override
  void initState() {
    super.initState();
    final line = widget.existing;
    if (line == null) {
      final start = widget.defaultDestination;
      if (_waiting && start != null) {
        _destinationId = start.id;
        _destinationName = start.name;
      }
      return;
    }
    // The stored line, as the form would have typed it. A car opens on the
    // typed-VIN branch with its fields filled; its VIN counts as decoded so
    // nothing is looked up until it is changed.
    _kind = containerLineKinds.contains(line.kind)
        ? line.kind
        : containerLineKindCar;
    _owner = line.isStock ? containerOwnerStock : containerOwnerCustomer;
    if (line.isCar) {
      _inLot = false;
      _vin.text = line.vinNumber;
      _make.text = line.carMake;
      _model.text = line.carModel;
      _year.text = line.carYear;
      _decodedVin = line.vinNumber;
    } else if (line.quantity > 0) {
      _quantity.text = '${line.quantity}';
    }
    if (line.isOther) _description.text = line.description;
    if (!line.isStock) {
      _customer.text = line.customerName;
      _phone.text = line.customerPhone;
    }
    _receiver.text = line.receiverName;
    _receiverPhone.text = line.receiverPhone;
    // A switch staff turned off stays off; someone with no number yet starts
    // switched on, as on a new line.
    _notifyCustomer = line.customerPhone.isEmpty || line.notifyCustomer;
    _notifyReceiver = line.receiverPhone.isEmpty || line.notifyReceiver;
    if (_waiting) {
      _destinationId = line.destinationCountryId;
      _destinationName = line.destinationCountryName;
      _length.text = line.lengthIn == null ? '' : trimNumber(line.lengthIn!);
      _width.text = line.widthIn == null ? '' : trimNumber(line.widthIn!);
      _height.text = line.heightIn == null ? '' : trimNumber(line.heightIn!);
      _price.text =
          line.priceCents == null ? '' : invoiceCentsToInput(line.priceCents!);
      _payOnArrival = line.payOnArrival;
    }
  }

  @override
  void dispose() {
    for (final c in [
      _vin, _make, _model, _year, _quantity, _description, _customer, _phone,
      _receiver, _receiverPhone, _lotFilter, _length, _width, _height, _price,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  /// The cars standing in the lot right now, joined to the open container
  /// already holding each - the same join the parked-car list draws its
  /// chip from, so "already on MSKU1234567" here and there agree.
  List<LotCarChoice> get _lotCars => lotCarChoices(
        widget.parkedCarRows,
        containerVinLinks(widget.lines, widget.containers),
      );

  /// Answering the question, or changing the answer. Everything the answer
  /// controls is cleared with it: a car picked under "Yes" must not linger
  /// as typed values under "No", and the other way round.
  void _answerInLot(bool? answer) {
    AppHaptics.selection();
    setState(() {
      _inLot = answer;
      _clearCarDraft();
    });
  }

  void _clearCarDraft() {
    final picked = _pickedCar;
    _pickedCar = null;
    _lotFilter.clear();
    _vin.clear();
    _make.clear();
    _model.clear();
    _year.clear();
    _vinHint = '';
    _decodedVin = '';
    _conflictName = '';
    _conflictWaiting = false;
    _errors = {..._errors}
      ..remove('vin_required')
      ..remove('vin_already_loaded');
    // The owner came with the pick; only what the pick wrote is taken back,
    // so a name typed by hand survives.
    if (picked != null) {
      if (_customer.text == picked.ownerName) _customer.clear();
      if (_phone.text == picked.ownerPhone) _phone.clear();
    }
  }

  /// A car chosen off the lot: the VIN, make, model and year are certain, and
  /// the parked car's owner is the customer unless one was already named.
  void _pickLotCar(LotCarChoice car) {
    final l10n = AppLocalizations.of(context)!;
    if (car.isTaken) {
      AppHaptics.refuse();
      return;
    }
    AppHaptics.commit();
    setState(() {
      _pickedCar = car;
      _vin.text = car.vin;
      _make.text = car.make;
      _model.text = car.model;
      _year.text = car.year;
      // Already filled from the lot's own record, so the decoder has nothing
      // to add; mark it decoded so an untouched VIN never triggers a lookup.
      _decodedVin = car.vin;
      _vinHint = l10n.ctrLotPicked;
      _conflictName = '';
      _errors = {..._errors}
        ..remove('vin_required')
        ..remove('vin_already_loaded');
      if (car.ownerName.isNotEmpty) {
        _owner = containerOwnerCustomer;
        if (_customer.text.trim().isEmpty) _customer.text = car.ownerName;
        if (_phone.text.trim().isEmpty && car.ownerPhone.isNotEmpty) {
          _phone.text = car.ownerPhone;
        }
        _errors = {..._errors}..remove('customer_name_required');
      }
      _suggestions = const [];
    });
  }

  void _clearError(String code) {
    if (_serverNote.isNotEmpty) setState(() => _serverNote = '');
    if (!_errors.contains(code)) return;
    setState(() => _errors = {..._errors}..remove(code));
  }

  void _applyCustomer(LotCustomer c) {
    setState(() {
      _customer.text = c.name;
      if (c.phone.isNotEmpty) _phone.text = c.phone;
      _suggestions = const [];
      _errors = {..._errors}..remove('customer_name_required');
    });
  }

  /// The VIN is the vehicle's identity, so typing one should end the typing:
  /// the business's own records first (they also carry whose car it is),
  /// then the decoder. Same order as the ledger's activity form.
  void _applyVin(String raw) {
    final l10n = AppLocalizations.of(context)!;
    var clean = normalizeVin(raw);
    if (clean.length > 17) clean = clean.substring(0, 17);
    if (clean != _vin.text) {
      _vin.value = TextEditingValue(
        text: clean,
        selection: TextSelection.collapsed(offset: clean.length),
      );
    }
    _clearError('vin_required');
    _clearError('vin_already_loaded');

    // Refused here, at the field, before the round trip; the server would
    // refuse the same VIN with the same code. A line being edited never
    // conflicts with itself.
    final existing = widget.existing;
    final holding = existing == null
        ? openContainerHoldingVin(
            containerLinesForVin(widget.lines, clean),
            ignoreContainerId: widget.container?.id ?? '',
          )
        : openContainerHoldingVin(
            containerLinesForVin(widget.lines, clean)
                .where((l) => l.id != existing.id)
                .toList(),
          );
    if (holding.isNotEmpty) {
      setState(() {
        // A package waiting for a container holds the VIN too, and there is
        // no box to name for it.
        _conflictWaiting = holding == containerWaitingHolder;
        _conflictName = _conflictWaiting
            ? ''
            : widget.containers
                    .where((c) => c.id == holding)
                    .firstOrNull
                    ?.displayName ??
                '';
        _errors = {..._errors, 'vin_already_loaded'};
      });
    }

    final known = lotFindKnownCar(clean, widget.knownCars);
    if (known != null && known.hasVehicle) {
      _applyKnownCar(known, l10n);
      return;
    }

    if (_vinHint.isNotEmpty) setState(() => _vinHint = '');
    if (isValidVin(clean) && clean != _decodedVin) _decodeVin(clean);
  }

  void _applyKnownCar(LotKnownCar known, AppLocalizations l10n) {
    setState(() {
      if (known.make.isNotEmpty) _make.text = known.make;
      if (known.model.isNotEmpty) _model.text = known.model;
      if (known.year.isNotEmpty) _year.text = known.year;
      // The car is certain; the customer is a suggestion, so it never
      // overwrites a name already typed.
      if (_customer.text.trim().isEmpty && known.customerName.isNotEmpty) {
        _customer.text = known.customerName;
      }
      if (_phone.text.trim().isEmpty && known.customerPhone.isNotEmpty) {
        _phone.text = known.customerPhone;
      }
      _vinHint = l10n.lotVinMatchedExisting;
    });
  }

  Future<void> _decodeVin(String vin) async {
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _vinBusy = true;
      _decodedVin = vin;
    });
    try {
      // Older than the cars kept in memory? Ask the business's own records
      // for this exact VIN before the decoder - they also know whose it is.
      final known = await KnownCarLookup.forBusiness(
        widget.businessId,
      ).findExact(vin);
      if (!mounted) return;
      if (known != null && known.hasVehicle) {
        if (_vin.text == vin) _applyKnownCar(known, l10n);
        return;
      }
      final decoded = await _vinDecoder.decode(vin);
      if (!mounted) return;
      setState(() {
        final make = (decoded.make ?? '').trim();
        final model = (decoded.model ?? '').trim();
        final year = (decoded.year ?? '').trim();
        if (make.isNotEmpty) _make.text = make;
        if (model.isNotEmpty) _model.text = model;
        if (year.isNotEmpty) _year.text = year;
        _vinHint = decoded.summary.isEmpty
            ? ''
            : l10n.vinDecodedVehicle(decoded.summary);
      });
      if (decoded.hasIdentity) AppHaptics.commit();
    } catch (_) {
      if (mounted) setState(() => _vinHint = '');
    } finally {
      if (mounted) setState(() => _vinBusy = false);
    }
  }

  Future<void> _scanVin() async {
    final vin = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const VinScannerScreen()),
    );
    if (vin == null || !mounted) return;
    _applyVin(vin);
  }

  ContainerLineDraft get _draft => ContainerLineDraft(
        kind: _kind,
        vinNumber: _vin.text,
        carMake: _make.text,
        carModel: _model.text,
        carYear: _year.text,
        quantity: int.tryParse(_quantity.text.trim()) ?? 0,
        description: _description.text,
        ownerKind: _owner,
        customerName: _customer.text,
        customerPhone: _phone.text,
        receiverName: _receiver.text,
        receiverPhone: _receiverPhone.text,
        notifyCustomer: _notifyCustomer,
        notifyReceiver: _notifyReceiver,
        // The package's own fields only when it is one: a line on a container
        // sends none of them, so editing it leaves its size and price alone.
        destinationCountryId: _waiting ? _destinationId : '',
        destinationCountryName: _waiting ? _destinationName : '',
        lengthIn: _waiting ? _length.text : '',
        widthIn: _waiting ? _width.text : '',
        heightIn: _waiting ? _height.text : '',
        priceCents: _waiting ? readPackagePrice(_price.text).cents : null,
        payOnArrival: _waiting && _payOnArrival,
      );

  Future<void> _pickDestination() async {
    final picked = await pickContainerDestination(
      context,
      destinations: widget.destinations,
      selectedId: _destinationId,
    );
    if (picked == null || !mounted) return;
    setState(() {
      _destinationId = picked.id;
      _destinationName = picked.name;
      _errors = {..._errors}..remove('package_destination_required');
    });
  }

  /// Where the receiver's phone picker opens: the package's own destination
  /// once chosen, else the box's (or the business's) country.
  String get _receiverCountry =>
      CallingCodeCatalog.countryCodeForReference(
        _destinationId,
        extra: widget.destinations,
      ) ??
      CallingCodeCatalog.countryCodeForReference(
        _destinationName,
        extra: widget.destinations,
      ) ??
      widget.receiverCountryCode;

  /// What a saved line reads as in the "added so far" tally.
  String _tallyLabel(AppLocalizations l10n, ContainerLineDraft d) {
    final what = d.kind == containerLineKindBarrels
        ? l10n.ctrBarrelsCount(d.quantity)
        : '${d.description} ${l10n.ctrTimes(d.quantity)}';
    final whose = d.ownerKind == containerOwnerStock
        ? l10n.ctrStock
        : d.customerName.trim();
    final to = d.receiverName.trim();
    return '$what — $whose${to.isEmpty ? '' : ' → $to'}';
  }

  /// `andAnother` keeps the sheet open after the save with the same kind of
  /// cargo selected and the customer cleared, for the next customer's share.
  Future<void> _submit({
    bool andAnother = false,
    bool printLabel = false,
  }) async {
    final l10n = AppLocalizations.of(context)!;
    final draft = _draft;
    final errors =
        (_waiting ? validateWaitingPackage(draft) : validateContainerLine(draft))
            .toSet();
    // A price that was typed but cannot be read is its own refusal; the draft
    // only carries the cents it could read.
    if (_waiting && readPackagePrice(_price.text).error != null) {
      errors.add('price_invalid');
    }
    if (_kind == containerLineKindCar && _errors.contains('vin_already_loaded')) {
      errors.add('vin_already_loaded');
    }
    if (errors.isNotEmpty) {
      AppHaptics.refuse();
      setState(() => _errors = errors);
      return;
    }

    setState(() {
      _busy = true;
      _serverNote = '';
    });
    try {
      if (_waiting) {
        await _saveWaiting(draft, andAnother: andAnother, printLabel: printLabel);
        return;
      }
      final existing = widget.existing;
      if (existing != null) {
        // The same line, edited in place: its code and container stay.
        await FirebaseFunctions.instance
            .httpsCallable('updateContainerLine')
            .call<Object?>({
          'businessId': widget.businessId,
          'containerId': existing.containerId,
          'lineId': existing.id,
          'line': containerLineRecord(draft),
        });
        if (!mounted) return;
        AppHaptics.commit();
        widget.onLineAdded?.call();
        Navigator.of(context).pop(true);
        showSuccessSnackBar(context, l10n.ctrLineUpdated);
        return;
      }
      await FirebaseFunctions.instance
          .httpsCallable('addContainerLine')
          .call<Object?>({
        'businessId': widget.businessId,
        'containerId': widget.container!.id,
        'line': containerLineRecord(draft),
      });
      if (!mounted) return;
      AppHaptics.commit();
      widget.onLineAdded?.call();
      if (andAnother) {
        setState(() {
          _addedThisSitting.add(_tallyLabel(l10n, draft));
          _quantity.clear();
          _customer.clear();
          _phone.clear();
          _receiver.clear();
          _receiverPhone.clear();
          _notifyCustomer = true;
          _notifyReceiver = true;
          _suggestions = const [];
          _errors = {};
          _serverNote = '';
        });
        return;
      }
      Navigator.of(context).pop(true);
      showSuccessSnackBar(context, l10n.ctrLineAdded);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      final refusal = parseContainerRefusal(error.details, error.message);
      final fieldCodes = refusal.codes.where(_fieldCodes.contains).toSet();
      final rest = refusal.codes.where((c) => !_fieldCodes.contains(c));
      setState(() {
        _errors = fieldCodes;
        _conflictWaiting = refusal.conflictWaiting;
        if (refusal.conflictContainerId.isNotEmpty) {
          _conflictName = widget.containers
                  .where((c) => c.id == refusal.conflictContainerId)
                  .firstOrNull
                  ?.displayName ??
              '';
        }
        _serverNote = rest.isNotEmpty
            ? rest.map((c) => containerErrorText(l10n, c)).join(' ')
            : (fieldCodes.isEmpty
                ? (refusal.message.isNotEmpty
                    ? refusal.message
                    : l10n.lotCouldNotSave)
                : '');
      });
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _serverNote = l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Registers a package that waits for a container, or corrects one. The
  /// sheet closes with what was saved - or, on "add another", stays open on
  /// the same customer for the next box.
  Future<void> _saveWaiting(
    ContainerLineDraft draft, {
    required bool andAnother,
    required bool printLabel,
  }) async {
    final l10n = AppLocalizations.of(context)!;
    final existing = widget.existing;
    if (existing != null) {
      await widget.caller(
        'updateContainerLine',
        updateWaitingPackageRequest(widget.businessId, existing.id, draft),
      );
      // The price is audited and checked against what was paid, so it goes
      // through its own callable.
      if (packagePriceChanged(existing, draft)) {
        await widget.caller(
          'setContainerLinePrice',
          setPackagePriceRequest(
            widget.businessId,
            existing.id,
            priceCents: draft.priceCents,
            payOnArrival: draft.payOnArrival,
          ),
        );
      }
      if (!mounted) return;
      AppHaptics.commit();
      widget.onLineAdded?.call();
      Navigator.of(context).pop(WaitingPackageSaved(
        lineId: existing.id,
        trackingCode: existing.trackingCode,
        edited: true,
        line: existing,
      ));
      showSuccessSnackBar(context, l10n.wpkUpdated);
      return;
    }
    final data = await widget.caller(
      'addWaitingPackage',
      addWaitingPackageRequest(widget.businessId, draft),
    );
    final map = data is Map ? data : const {};
    final lineId = (map['lineId'] ?? '').toString();
    final code = (map['trackingCode'] ?? '').toString();
    final saved = WaitingPackageSaved(
      lineId: lineId,
      trackingCode: code,
      printLabel: printLabel,
      line: ContainerLine.fromMap(lineId, {
        ...addWaitingPackageRequest(widget.businessId, draft),
        'containerId': '',
        'containerStatus': containerLineStatusWaiting,
        'trackingCode': code,
      }),
    );
    if (!mounted) return;
    AppHaptics.commit();
    widget.onLineAdded?.call();
    if (andAnother) {
      // The same customer's next box: the people, the country and the
      // WhatsApp switches stay; everything about the box itself starts over.
      setState(() {
        _addedThisSitting.add(
          '${draft.kind == containerLineKindCar ? draft.vinNumber : _tallyLabel(l10n, draft)}'
          '${saved.trackingCode.isEmpty ? '' : ' (${saved.trackingCode})'}',
        );
        _pickedCar = null;
        _inLot = null;
        for (final c in [
          _vin, _make, _model, _year, _quantity, _description, _lotFilter,
          _length, _width, _height, _price,
        ]) {
          c.clear();
        }
        _vinHint = '';
        _decodedVin = '';
        _conflictName = '';
        _conflictWaiting = false;
        _payOnArrival = false;
        _errors = {};
        _serverNote = '';
      });
      return;
    }
    Navigator.of(context).pop(saved);
    showSuccessSnackBar(
      context,
      saved.trackingCode.isEmpty
          ? l10n.wpkSavedNoCode
          : l10n.wpkSaved(saved.trackingCode),
    );
  }

  static const _fieldCodes = {
    'vin_required',
    'vin_already_loaded',
    'quantity_required',
    'description_required',
    'customer_name_required',
    'customer_phone_invalid',
    'receiver_phone_invalid',
    'package_destination_required',
    'size_invalid',
    'price_invalid',
    'price_below_paid',
  };

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    String? errorFor(String code) => _errors.contains(code)
        ? containerErrorText(
            l10n,
            code,
            conflictName: _conflictName,
            conflictWaiting: _conflictWaiting,
          )
        : null;
    final isCar = _kind == containerLineKindCar;
    final isOther = _kind == containerLineKindOther;
    // A car's fields (and whose it is) appear once the lot question is
    // answered: straight away under "No", after a pick under "Yes".
    final showCarFields =
        isCar && (_inLot == false || (_inLot == true && _pickedCar != null));
    final showOwner = !isCar || showCarFields;

    return LotSheetShell(
      title: _waiting
          ? (_editing ? l10n.wpkEditPackage : l10n.wpkRegister)
          : (_editing ? l10n.ctrEditLine : l10n.ctrAddLine),
      subtitle: _waiting
          ? l10n.wpkRegisterSubtitle
          : widget.container!.displayName,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            _RefusalNote(text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          // A waiting package: add another box for the same customer, or
          // print this one's label now. Any kind of cargo, cars included.
          if (_waiting && showOwner && !_editing) ...[
            LotSheetButton(
              key: const Key('line-save-and-another'),
              label: l10n.wpkSaveAndAnother,
              busy: _busy,
              busyLabel: l10n.ctrAdding,
              tone: LotTone.neutral,
              onTap: () => _submit(andAnother: true),
            ),
            const SizedBox(height: AppSpacing.sm),
            LotSheetButton(
              key: const Key('line-save-and-print'),
              label: l10n.wpkSaveAndPrint,
              busy: _busy,
              busyLabel: l10n.ctrAdding,
              tone: LotTone.neutral,
              onTap: () => _submit(printLabel: true),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          // One line edited is saved and closed; "add another" is for adding.
          if (!_waiting && showOwner && !isCar && !_editing) ...[
            LotSheetButton(
              key: const Key('line-save-and-another'),
              label: l10n.ctrSaveAndAnother,
              busy: _busy,
              busyLabel: l10n.ctrAdding,
              tone: LotTone.neutral,
              onTap: () => _submit(andAnother: true),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: Key(_editing ? 'line-save-edit' : 'line-save'),
            label: _editing
                ? l10n.lotSave
                : (_waiting
                    ? l10n.lotSave
                    : (_addedThisSitting.isEmpty
                        ? l10n.ctrAdd
                        : l10n.ctrAddAndClose)),
            busy: _busy,
            busyLabel: _editing ? l10n.lotSaving : l10n.ctrAdding,
            onTap: _submit,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_editing && !_waiting) ...[
            Text(
              l10n.ctrEditLineNote,
              key: const Key('line-edit-note'),
              style: const TextStyle(
                fontSize: 12,
                height: 1.35,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
          Text(
            l10n.ctrKind,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.2,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          _KindChips(
            selected: _kind,
            onChanged: (k) => setState(() {
              _kind = k;
              _errors = {};
              _serverNote = '';
              // The lot question belongs to a car; a new kind starts over.
              _inLot = null;
              _clearCarDraft();
            }),
          ),
          // A car is asked about before any VIN is: is it parked here?
          // Until that is answered nothing else is shown, and a "Yes" shows
          // the lot's cars until one is picked.
          if (isCar) ...[
            const SizedBox(height: AppSpacing.lg),
            _LotQuestion(
              answer: _inLot,
              onAnswer: _answerInLot,
            ),
          ],
          if (isCar && _inLot == true && _pickedCar == null) ...[
            const SizedBox(height: AppSpacing.md),
            _LotCarPicker(
              cars: _lotCars,
              filter: _lotFilter,
              onPick: _pickLotCar,
              onFilterChanged: (_) => setState(() {}),
              onEnterVinInstead: () => _answerInLot(false),
            ),
          ],
          if (isCar && showCarFields) ...[
            const SizedBox(height: AppSpacing.md),
            TextField(
              key: const Key('line-vin'),
              controller: _vin,
              textCapitalization: TextCapitalization.characters,
              onChanged: _applyVin,
              decoration: InputDecoration(
                labelText: l10n.lotVin,
                helperText: _vinBusy
                    ? l10n.lotDecodingVin
                    : (_vinHint.isEmpty ? l10n.lotVinHint : _vinHint),
                helperStyle: _vinHint.isEmpty && !_vinBusy
                    ? null
                    : const TextStyle(
                        color: AppColors.sage,
                        fontWeight: FontWeight.w600,
                      ),
                helperMaxLines: 2,
                errorText: errorFor('vin_already_loaded') ?? errorFor('vin_required'),
                errorMaxLines: 3,
                suffixIcon: _vinBusy
                    ? const Padding(
                        padding: EdgeInsets.all(13),
                        child: SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : IconButton(
                        icon: const Icon(Icons.document_scanner_outlined),
                        tooltip: l10n.scanVin,
                        onPressed: _scanVin,
                      ),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextField(
                    controller: _make,
                    textCapitalization: TextCapitalization.words,
                    decoration: InputDecoration(labelText: l10n.lotMake),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: TextField(
                    controller: _model,
                    textCapitalization: TextCapitalization.words,
                    decoration: InputDecoration(labelText: l10n.lotModel),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                SizedBox(
                  width: 78,
                  child: TextField(
                    controller: _year,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(labelText: l10n.lotYearField),
                  ),
                ),
              ],
            ),
            if (_pickedCar != null) ...[
              const SizedBox(height: AppSpacing.sm),
              Align(
                alignment: Alignment.centerLeft,
                child: PressableScale(
                  scale: 0.96,
                  onTap: () {
                    AppHaptics.selection();
                    setState(_clearCarDraft);
                  },
                  child: Padding(
                    key: const Key('line-lot-pick-another'),
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Text(
                      l10n.ctrLotPickAnother,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.cobaltDeep,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ],
          if (isOther) ...[
            const SizedBox(height: AppSpacing.md),
            TextField(
              key: const Key('line-description'),
              controller: _description,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => _clearError('description_required'),
              decoration: InputDecoration(
                labelText: l10n.ctrDescription,
                errorText: errorFor('description_required'),
              ),
            ),
          ],
          if (!isCar) ...[
            const SizedBox(height: AppSpacing.md),
            TextField(
              key: const Key('line-quantity'),
              controller: _quantity,
              keyboardType: TextInputType.number,
              onChanged: (_) => _clearError('quantity_required'),
              decoration: InputDecoration(
                labelText: l10n.ctrQuantity,
                errorText: errorFor('quantity_required'),
              ),
            ),
          ],
          if (_waiting && showOwner)
            WaitingPackageFields(
              destinationName: _destinationName,
              onPickDestination: _pickDestination,
              length: _length,
              width: _width,
              height: _height,
              price: _price,
              payOnArrival: _payOnArrival,
              onPayOnArrival: (v) => setState(() => _payOnArrival = v),
              onEdited: () {
                if (_serverNote.isNotEmpty ||
                    _errors.any(const {
                      'size_invalid',
                      'price_invalid',
                      'price_below_paid',
                    }.contains)) {
                  setState(() {
                    _serverNote = '';
                    _errors = {..._errors}
                      ..remove('size_invalid')
                      ..remove('price_invalid')
                      ..remove('price_below_paid');
                  });
                }
              },
              destinationError: errorFor('package_destination_required'),
              sizeError: errorFor('size_invalid'),
              priceError:
                  errorFor('price_invalid') ?? errorFor('price_below_paid'),
            ),
          if (showOwner) ...[
            const SizedBox(height: AppSpacing.lg),
            Text(
              l10n.ctrOwner,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.2,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            // A package dropped off is always a customer's: stock is not
            // "dropped off", so there is nothing to choose.
            if (!_waiting)
              LotChoiceCard(
                title: l10n.ctrOwnerCustomer,
                note: l10n.ctrOwnerCustomerNote,
                selected: _owner == containerOwnerCustomer,
                onTap: () => setState(() => _owner = containerOwnerCustomer),
              ),
            if (_owner == containerOwnerCustomer) ...[
              TextField(
                key: const Key('line-customer'),
                controller: _customer,
                textCapitalization: TextCapitalization.words,
                onChanged: (value) {
                  _clearError('customer_name_required');
                  setState(() => _suggestions =
                      matchLotCustomers(widget.customers, value).toList());
                },
                decoration: InputDecoration(
                  labelText: l10n.lotCustomer,
                  errorText: errorFor('customer_name_required'),
                ),
              ),
              // The lot's memory, offered inline rather than in a menu that
              // floats over the form and hides the field being typed into.
              if (_suggestions.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.sm),
                Text(
                  l10n.lotSavedCustomers,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppColors.muted,
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final c in _suggestions.take(4))
                      PressableScale(
                        scale: 0.95,
                        onTap: () => _applyCustomer(c),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: AppSpacing.md, vertical: 7),
                          decoration: BoxDecoration(
                            color: AppColors.mist,
                            borderRadius:
                                BorderRadius.circular(AppSpacing.radiusSm),
                            border: Border.all(
                                color: AppColors.cobalt.withValues(alpha: 0.3)),
                          ),
                          child: Text(
                            c.name,
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: AppColors.cobaltDeep,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: AppSpacing.md),
              _ContactPhone(
                fieldKey: 'line-phone',
                controller: _phone,
                label: l10n.lotPhone,
                initialCountryCode: widget.customerCountryCode,
                errorText: errorFor('customer_phone_invalid'),
                notify: _notifyCustomer,
                onNotifyChanged: (v) => setState(() => _notifyCustomer = v),
                onChanged: () => _clearError('customer_phone_invalid'),
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
            if (!_waiting)
              LotChoiceCard(
                title: l10n.ctrOwnerStock,
                note: l10n.ctrOwnerStockNote,
                selected: _owner == containerOwnerStock,
                onTap: () => setState(() {
                  _owner = containerOwnerStock;
                  _errors = {..._errors}..remove('customer_name_required');
                }),
              ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              key: const Key('line-receiver'),
              controller: _receiver,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(
                labelText: l10n.ctrReceiver,
                hintText: l10n.ctrReceiverHint,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            _ContactPhone(
              fieldKey: 'line-receiver-phone',
              controller: _receiverPhone,
              label: l10n.ctrReceiverPhone,
              initialCountryCode: _waiting ? _receiverCountry : widget.receiverCountryCode,
              errorText: errorFor('receiver_phone_invalid'),
              notify: _notifyReceiver,
              onNotifyChanged: (v) => setState(() => _notifyReceiver = v),
              onChanged: () => _clearError('receiver_phone_invalid'),
            ),
            if (!isCar && !_editing && !_waiting) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                l10n.ctrSplitHint,
                style: const TextStyle(fontSize: 12, color: AppColors.muted),
              ),
            ],
            if (_waiting && !_editing) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                l10n.wpkNoNotice,
                key: const Key('wpk-no-notice'),
                style: const TextStyle(fontSize: 12, color: AppColors.muted),
              ),
            ],
            if (_addedThisSitting.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                l10n.ctrAddedSoFar(_addedThisSitting.join('; ')),
                key: const Key('line-added-so-far'),
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.cobaltDeep,
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

/// A contact's phone the way WhatsApp needs it: the country picked from the
/// calling-code catalogue rather than typed, a warning when the number still
/// has no country code, and whether this person hears about the shipment.
///
/// The warning and the switch listen to the controller themselves and sit
/// after the field, so a number the field rewrites into international form
/// as it mounts is read in its final shape.
class _ContactPhone extends StatelessWidget {
  const _ContactPhone({
    required this.fieldKey,
    required this.controller,
    required this.label,
    required this.initialCountryCode,
    required this.notify,
    required this.onNotifyChanged,
    required this.onChanged,
    this.errorText,
  });

  /// The field's key; the warning and the switch take it as a prefix.
  final String fieldKey;
  final TextEditingController controller;
  final String label;
  final String initialCountryCode;
  final String? errorText;
  final bool notify;
  final ValueChanged<bool> onNotifyChanged;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        CountryPhoneField(
          fieldKey: Key(fieldKey),
          controller: controller,
          labelText: label,
          initialCountryCode: initialCountryCode,
          errorText: errorText,
          // Staff type someone else's number; offering their own is wrong.
          autofillHints: null,
          onChanged: (_) => onChanged(),
        ),
        ValueListenableBuilder<TextEditingValue>(
          valueListenable: controller,
          builder: (context, value, _) {
            final hasPhone = containerPhone(value.text).isNotEmpty;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (containerPhoneLacksCountryCode(value.text))
                  Padding(
                    key: Key('$fieldKey-country-warning'),
                    padding: const EdgeInsets.only(top: 6, left: 2),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(
                          Icons.warning_amber_rounded,
                          size: 16,
                          color: AppColors.warn,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            l10n.ctrPhoneNeedsCountryCode,
                            style: const TextStyle(
                              fontSize: 12,
                              height: 1.35,
                              fontWeight: FontWeight.w600,
                              color: AppColors.warn,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                SwitchListTile.adaptive(
                  key: Key('$fieldKey-notify'),
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  value: hasPhone && notify,
                  onChanged: hasPhone ? onNotifyChanged : null,
                  title: Text(
                    l10n.ctrNotifyToggle,
                    style: const TextStyle(
                      fontSize: 13,
                      height: 1.3,
                      color: AppColors.ink,
                    ),
                  ),
                  subtitle: hasPhone
                      ? null
                      : Text(
                          l10n.ctrNotifyNeedsPhone,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.muted,
                          ),
                        ),
                ),
              ],
            );
          },
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Correcting a line's contacts.
// ---------------------------------------------------------------------------

/// Who a line belongs to, who collects it, and whether each hears about the
/// shipment - correctable in every container state, unlike the rest of the
/// line, because a wrong number matters most once the box has sailed.
class _LineContactsSheet extends StatefulWidget {
  const _LineContactsSheet({
    required this.businessId,
    required this.line,
    required this.customerCountryCode,
    required this.receiverCountryCode,
  });

  final String businessId;
  final ContainerLine line;
  final String customerCountryCode;
  final String receiverCountryCode;

  @override
  State<_LineContactsSheet> createState() => _LineContactsSheetState();
}

class _LineContactsSheetState extends State<_LineContactsSheet> {
  late final _customer = TextEditingController(text: widget.line.customerName);
  late final _phone = TextEditingController(text: widget.line.customerPhone);
  late final _receiver = TextEditingController(text: widget.line.receiverName);
  late final _receiverPhone =
      TextEditingController(text: widget.line.receiverPhone);

  /// A switch that was turned off stays off; a person who had no number yet
  /// starts switched on, as on a new line.
  late bool _notifyCustomer =
      widget.line.customerPhone.isEmpty || widget.line.notifyCustomer;
  late bool _notifyReceiver =
      widget.line.receiverPhone.isEmpty || widget.line.notifyReceiver;

  bool _busy = false;
  Set<String> _errors = {};
  String _serverNote = '';

  bool get _customerLine => !widget.line.isStock;

  @override
  void dispose() {
    for (final c in [_customer, _phone, _receiver, _receiverPhone]) {
      c.dispose();
    }
    super.dispose();
  }

  void _clearError(String code) {
    if (_serverNote.isNotEmpty) setState(() => _serverNote = '');
    if (!_errors.contains(code)) return;
    setState(() => _errors = {..._errors}..remove(code));
  }

  ContainerLineContactsDraft get _draft => ContainerLineContactsDraft(
        customerName: _customer.text,
        customerPhone: _phone.text,
        receiverName: _receiver.text,
        receiverPhone: _receiverPhone.text,
        notifyCustomer: _notifyCustomer,
        notifyReceiver: _notifyReceiver,
      );

  static const _fieldCodes = {
    'customer_name_required',
    'customer_phone_invalid',
    'receiver_phone_invalid',
  };

  Future<void> _submit() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    final draft = _draft;
    final errors = validateContainerLineContacts(draft, widget.line);
    if (errors.isNotEmpty) {
      AppHaptics.refuse();
      setState(() => _errors = errors.toSet());
      return;
    }
    setState(() {
      _busy = true;
      _serverNote = '';
    });
    try {
      await FirebaseFunctions.instance
          .httpsCallable('updateContainerLineContacts')
          .call<Object?>({
        'businessId': widget.businessId,
        'lineId': widget.line.id,
        'contacts': containerLineContactsUpdate(draft, widget.line),
      });
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      final refusal = parseContainerRefusal(error.details, error.message);
      final fieldCodes = refusal.codes.where(_fieldCodes.contains).toSet();
      final rest = refusal.codes.where((c) => !_fieldCodes.contains(c));
      setState(() {
        _errors = fieldCodes;
        _serverNote = rest.isNotEmpty
            ? rest.map((c) => containerErrorText(l10n, c)).join(' ')
            : (fieldCodes.isEmpty
                ? (refusal.message.isNotEmpty
                    ? refusal.message
                    : l10n.lotCouldNotSave)
                : '');
      });
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _serverNote = l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    String? errorFor(String code) =>
        _errors.contains(code) ? containerErrorText(l10n, code) : null;

    return LotSheetShell(
      title: l10n.ctrEditContacts,
      subtitle: containerLineTitle(l10n, widget.line),
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            _RefusalNote(text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('contacts-save'),
            label: l10n.lotSave,
            busy: _busy,
            busyLabel: l10n.lotSaving,
            onTap: _submit,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.ctrEditContactsNote,
            style: const TextStyle(
              fontSize: 12,
              height: 1.35,
              color: AppColors.muted,
            ),
          ),
          if (_customerLine) ...[
            const SizedBox(height: AppSpacing.md),
            TextField(
              key: const Key('contacts-customer'),
              controller: _customer,
              textCapitalization: TextCapitalization.words,
              onChanged: (_) => _clearError('customer_name_required'),
              decoration: InputDecoration(
                labelText: l10n.lotCustomer,
                errorText: errorFor('customer_name_required'),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            _ContactPhone(
              fieldKey: 'contacts-phone',
              controller: _phone,
              label: l10n.lotPhone,
              initialCountryCode: widget.customerCountryCode,
              errorText: errorFor('customer_phone_invalid'),
              notify: _notifyCustomer,
              onNotifyChanged: (v) => setState(() => _notifyCustomer = v),
              onChanged: () => _clearError('customer_phone_invalid'),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('contacts-receiver'),
            controller: _receiver,
            textCapitalization: TextCapitalization.words,
            onChanged: (_) => _clearError('server'),
            decoration: InputDecoration(
              labelText: l10n.ctrReceiver,
              hintText: l10n.ctrReceiverHint,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          _ContactPhone(
            fieldKey: 'contacts-receiver-phone',
            controller: _receiverPhone,
            label: l10n.ctrReceiverPhone,
            initialCountryCode: widget.receiverCountryCode,
            errorText: errorFor('receiver_phone_invalid'),
            notify: _notifyReceiver,
            onNotifyChanged: (v) => setState(() => _notifyReceiver = v),
            onChanged: () => _clearError('receiver_phone_invalid'),
          ),
        ],
      ),
    );
  }
}

/// "Is this car parked in your lot?" Two cards until answered; once
/// answered, the question folds to one line with the answer and a way back,
/// so the fields below keep the room.
class _LotQuestion extends StatelessWidget {
  const _LotQuestion({required this.answer, required this.onAnswer});

  final bool? answer;
  final ValueChanged<bool?> onAnswer;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final title = Text(
      l10n.ctrLotQuestion,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.2,
        color: AppColors.ink,
      ),
    );
    if (answer == null) {
      return Column(
        key: const Key('line-lot-question'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          title,
          const SizedBox(height: AppSpacing.sm),
          LotChoiceCard(
            key: const Key('line-lot-yes'),
            title: l10n.ctrLotYes,
            note: l10n.ctrLotYesNote,
            selected: false,
            onTap: () => onAnswer(true),
          ),
          LotChoiceCard(
            key: const Key('line-lot-no'),
            title: l10n.ctrLotNo,
            note: l10n.ctrLotNoNote,
            selected: false,
            onTap: () => onAnswer(false),
          ),
        ],
      );
    }
    return Row(
      key: const Key('line-lot-answered'),
      children: [
        Expanded(child: title),
        const SizedBox(width: AppSpacing.sm),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: AppColors.mist,
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            border: Border.all(color: AppColors.cobalt.withValues(alpha: 0.3)),
          ),
          child: Text(
            answer! ? l10n.ctrLotYes : l10n.ctrLotNo,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppColors.cobaltDeep,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        PressableScale(
          scale: 0.96,
          onTap: () => onAnswer(null),
          child: Padding(
            key: const Key('line-lot-change'),
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
            child: Text(
              l10n.ctrLotChange,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.cobaltDeep,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// The cars in the lot, one tap each. A car already on an open container is
/// listed but greyed and says which box has it. Nothing parked, or nothing
/// matching the filter, says so and offers the VIN route instead.
class _LotCarPicker extends StatelessWidget {
  const _LotCarPicker({
    required this.cars,
    required this.filter,
    required this.onPick,
    required this.onFilterChanged,
    required this.onEnterVinInstead,
  });

  final List<LotCarChoice> cars;
  final TextEditingController filter;
  final ValueChanged<LotCarChoice> onPick;
  final ValueChanged<String> onFilterChanged;
  final VoidCallback onEnterVinInstead;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final shown = filterLotCarChoices(cars, filter.text);
    final sectionTitle = Text(
      l10n.ctrLotPickTitle,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.2,
        color: AppColors.ink,
      ),
    );
    final switchToVin = Align(
      alignment: Alignment.centerLeft,
      child: PressableScale(
        scale: 0.96,
        onTap: onEnterVinInstead,
        child: Padding(
          key: const Key('line-lot-enter-vin'),
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Text(
            l10n.ctrLotEnterVinInstead,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.cobaltDeep,
            ),
          ),
        ),
      ),
    );

    if (cars.isEmpty) {
      return Column(
        key: const Key('line-lot-empty'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.parchment,
              borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              border: Border.all(color: AppColors.rule),
            ),
            child: Text(
              l10n.ctrLotNoCars,
              style: const TextStyle(
                fontSize: 13,
                height: 1.4,
                color: AppColors.muted,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          switchToVin,
        ],
      );
    }

    return Column(
      key: const Key('line-lot-picker'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        sectionTitle,
        const SizedBox(height: AppSpacing.sm),
        TextField(
          key: const Key('line-lot-filter'),
          controller: filter,
          textCapitalization: TextCapitalization.characters,
          onChanged: onFilterChanged,
          decoration: InputDecoration(
            hintText: l10n.ctrLotFilterHint,
            prefixIcon: const Icon(Icons.search, size: 20),
            isDense: true,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        if (shown.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
            child: Text(
              l10n.ctrLotNoMatch,
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          ),
        for (final car in shown)
          _LotCarRow(
            key: ValueKey('lot-car-${car.id}'),
            car: car,
            onTap: () => onPick(car),
          ),
        const SizedBox(height: AppSpacing.xs),
        switchToVin,
      ],
    );
  }
}

class _LotCarRow extends StatelessWidget {
  const _LotCarRow({super.key, required this.car, required this.onTap});

  final LotCarChoice car;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final taken = car.isTaken;
    final ink = taken ? AppColors.muted : AppColors.ink;
    final vehicle =
        car.vehicleLabel.isEmpty ? l10n.ctrLotCarUnknown : car.vehicleLabel;
    return PressableScale(
      onTap: taken ? null : onTap,
      scale: 0.99,
      child: Opacity(
        opacity: taken ? 0.55 : 1,
        child: Container(
          margin: const EdgeInsets.only(bottom: AppSpacing.sm),
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.parchment,
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            border: Border.all(color: AppColors.rule),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                taken ? Icons.lock_outline : Icons.directions_car_outlined,
                size: 18,
                color: taken ? AppColors.muted : AppColors.cobalt,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      vehicle,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: ink,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      car.ownerName.isEmpty
                          ? car.vin
                          : '${car.vin} · ${car.ownerName}',
                      style: const TextStyle(
                        fontSize: 12,
                        height: 1.35,
                        color: AppColors.muted,
                      ),
                    ),
                    if (taken) ...[
                      const SizedBox(height: 4),
                      Text(
                        l10n.ctrLotTaken(car.onContainer!.containerName),
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppColors.errorRed,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _KindChips extends StatelessWidget {
  const _KindChips({required this.selected, required this.onChanged});

  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Row(
      children: [
        for (final kind in containerLineKinds) ...[
          Expanded(
            child: PressableScale(
              scale: 0.96,
              onTap: () {
                AppHaptics.selection();
                onChanged(kind);
              },
              child: AnimatedContainer(
                duration: AppMotion.press,
                height: 40,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: kind == selected ? AppColors.mist : AppColors.parchment,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                  border: Border.all(
                    color: kind == selected ? AppColors.cobalt : AppColors.rule,
                    width: kind == selected ? 1.5 : 1,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      containerKindIcon(kind),
                      size: 16,
                      color: kind == selected
                          ? AppColors.cobaltDeep
                          : AppColors.muted,
                    ),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        containerKindLabel(l10n, kind),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: kind == selected
                              ? AppColors.cobaltDeep
                              : AppColors.muted,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          if (kind != containerLineKinds.last)
            const SizedBox(width: AppSpacing.sm),
        ],
      ],
    );
  }
}

/// A refusal that belongs to no one field, said above the button that was
/// pressed rather than in a snackbar at the far end of the screen.
class _RefusalNote extends StatelessWidget {
  const _RefusalNote({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('container-refusal'),
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.errorRed.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: AppColors.errorRed.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline, size: 16, color: AppColors.errorRed),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.35,
                color: AppColors.errorRed,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// [_RefusalNote] for the waiting-package sheets, which live in their own
/// files and say a refusal the same way.
class ContainerRefusalNote extends StatelessWidget {
  const ContainerRefusalNote({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => _RefusalNote(text: text);
}

// ---------------------------------------------------------------------------
// Shared bits: the state pill, kinds, counts, and the refusal vocabulary.
// ---------------------------------------------------------------------------

/// A container's state as a small coloured pill: loading, shipped, arrived.
/// Shared with the package view so a state reads the same everywhere.
class ContainerStatusPill extends StatelessWidget {
  const ContainerStatusPill({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final color = switch (status) {
      containerStatusShipped => AppColors.cobalt,
      containerStatusArrived => AppColors.sage,
      containerLineStatusWaiting => AppColors.muted,
      _ => AppColors.warn,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        _statusLabel(l10n, status),
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.3,
          color: color,
        ),
      ),
    );
  }
}

String _statusLabel(AppLocalizations l10n, String status) => switch (status) {
      containerStatusShipped => l10n.ctrStatusShipped,
      containerStatusArrived => l10n.ctrStatusArrived,
      containerLineStatusWaiting => l10n.ctrStatusWaiting,
      _ => l10n.ctrStatusLoading,
    };

/// The icon for a line's kind: car, barrels, or anything else.
IconData containerKindIcon(String kind) => switch (kind) {
      containerLineKindCar => Icons.directions_car_outlined,
      containerLineKindBarrels => Icons.oil_barrel_outlined,
      _ => Icons.category_outlined,
    };

/// A line's kind in words: car, barrels, other.
String containerKindLabel(AppLocalizations l10n, String kind) => switch (kind) {
      containerLineKindCar => l10n.ctrKindCar,
      containerLineKindBarrels => l10n.ctrKindBarrels,
      _ => l10n.ctrKindOther,
    };

/// What a line is, in one phrase: "2019 Toyota Camry", "3 barrels".
String containerLineTitle(AppLocalizations l10n, ContainerLine line) {
  if (line.isCar) return line.vehicleLabel;
  if (line.isBarrels) return l10n.ctrBarrelsCount(line.quantity);
  return line.quantity > 1
      ? '${line.description} ${l10n.ctrTimes(line.quantity)}'
      : line.description;
}

/// "2 cars · 14 barrels · 1 other item", leaving out what there is none of.
String _countsText(AppLocalizations l10n, int cars, int barrels, int other) {
  return [
    if (cars > 0) l10n.ctrCarsCount(cars),
    if (barrels > 0) l10n.ctrBarrelsCount(barrels),
    if (other > 0) l10n.ctrOtherCount(other),
  ].join(' · ');
}

/// One vocabulary of refusals, whether the screen refused locally or the
/// server did: both speak the codes in `functions/container_manifest.js`.
String containerErrorText(
  AppLocalizations l10n,
  String code, {
  String conflictName = '',
  bool conflictWaiting = false,
}) {
  return switch (code) {
    'container_label_required' => l10n.ctrErrLabelRequired,
    'container_number_invalid' => l10n.ctrErrNumberInvalid,
    'container_status_invalid' => l10n.ctrErrStatusInvalid,
    'container_transition_invalid' => l10n.ctrErrTransitionInvalid,
    'destination_required' => l10n.ctrErrDestinationRequired,
    'container_empty' => l10n.ctrErrEmpty,
    'container_locked' => l10n.ctrErrLocked,
    'container_has_lines' => l10n.ctrErrHasLines,
    'container_not_found' => l10n.ctrErrNotFound,
    'line_not_found' => l10n.ctrErrLineNotFound,
    'line_kind_invalid' => l10n.ctrErrLineKind,
    'vin_required' => l10n.lotErrVin,
    'quantity_required' => l10n.ctrErrQuantity,
    'description_required' => l10n.ctrErrDescription,
    'owner_kind_invalid' => l10n.ctrErrOwnerKind,
    'customer_name_required' => l10n.lotErrCustomerName,
    'customer_phone_invalid' => l10n.ctrErrCustomerPhoneInvalid,
    'receiver_phone_invalid' => l10n.ctrErrReceiverPhoneInvalid,
    'vin_already_loaded' => conflictWaiting
        ? l10n.ctrErrVinAlreadyWaiting
        : conflictName.isEmpty
            ? l10n.ctrErrVinAlreadyLoaded
            : l10n.ctrErrVinAlreadyLoadedIn(conflictName),
    'vin_already_waiting' => l10n.ctrErrVinAlreadyWaiting,
    'move_target_not_loading' => l10n.ctrErrMoveTarget,
    // Waiting packages: copy in lib/l10n (wpkErr*), the server's own words.
    'package_destination_required' => l10n.wpkErrDestinationRequired,
    'destination_mismatch' => l10n.wpkErrDestinationMismatch,
    'container_destination_required' => l10n.wpkErrContainerDestinationRequired,
    'size_invalid' => l10n.wpkErrSizeInvalid,
    'line_not_waiting' => l10n.wpkErrLineNotWaiting,
    'line_is_waiting' => l10n.wpkErrLineIsWaiting,
    'line_not_in_container' => l10n.wpkErrLineNotInContainer,
    'line_ids_invalid' => l10n.wpkErrLineIdsInvalid,
    'line_has_payments' => l10n.wpkErrLineHasPayments,
    'price_invalid' => l10n.wpkErrPriceInvalid,
    'price_below_paid' => l10n.wpkErrPriceBelowPaid,
    'price_required' => l10n.wpkErrPriceRequired,
    'amount_required' => l10n.wpkErrAmountRequired,
    'amount_too_large' => l10n.wpkErrAmountTooLarge,
    'payment_method_invalid' => l10n.wpkErrMethodInvalid,
    'payment_exceeds_balance' => l10n.wpkErrExceedsBalance,
    'payment_not_found' => l10n.wpkErrPaymentNotFound,
    'payment_already_reverted' => l10n.wpkErrPaymentReverted,
    _ => l10n.lotCouldNotSave,
  };
}

/// What to say for a refusal the server sent back: its codes in our words,
/// naming the conflicting container when it named one; the server's own
/// message when it spoke no code we know.
String containerRefusalText(
  AppLocalizations l10n,
  FirebaseFunctionsException error, {
  Map<String, ShippingContainer> containers = const {},
}) {
  final refusal = parseContainerRefusal(error.details, error.message);
  if (refusal.isEmpty) {
    return refusal.message.isNotEmpty ? refusal.message : l10n.lotCouldNotSave;
  }
  final conflict = containers[refusal.conflictContainerId]?.displayName ?? '';
  return refusal.codes
      .map((c) => containerErrorText(
            l10n,
            c,
            conflictName: conflict,
            conflictWaiting: refusal.conflictWaiting,
          ))
      .join(' ');
}

// ---------------------------------------------------------------------------
// Shared with the package view: where phone pickers start, correcting a
// line's contacts, and printing labels. One implementation, opened from the
// container detail and from a scanned package alike.
// ---------------------------------------------------------------------------

/// Where a customer's phone picker starts: the business's own country,
/// else the United States.
String containerCustomerCountryCode(String businessCountryCode) =>
    businessCountryCode.isNotEmpty ? businessCountryCode : 'US';

/// Where a receiver's phone picker starts: the country the box is going
/// to. The destination is stored as a catalogue or business destination
/// id, so it is resolved through the calling-code catalogue; the name is
/// the fallback for older boxes.
String containerReceiverCountryCode(
  ShippingContainer? container, {
  List<DestinationCountry> destinations = const [],
  String businessCountryCode = '',
}) =>
    (container == null
        ? null
        : CallingCodeCatalog.countryCodeForReference(
              container.destinationCountryId,
              extra: destinations,
            ) ??
            CallingCodeCatalog.countryCodeForReference(
              container.destinationCountryName,
              extra: destinations,
            )) ??
    containerCustomerCountryCode(businessCountryCode);

/// Picks the country a container or a waiting package is going to: the
/// business's own destinations first, then every other country, so a business
/// that lists none under Services & coverage still has the whole world to
/// choose from, never an empty sheet. Null when dismissed.
Future<({String id, String name})?> pickContainerDestination(
  BuildContext context, {
  required List<DestinationCountry> destinations,
  String selectedId = '',
}) async {
  final l10n = AppLocalizations.of(context)!;
  final ownIds = {for (final d in destinations) d.id};
  final own = [...destinations]..sort((a, b) => a.name.compareTo(b.name));
  final rest = [
    for (final c in CountryCatalog.all)
      if (!ownIds.contains(c.id)) c,
  ]..sort((a, b) => a.name.compareTo(b.name));
  final picked = await pickLotSearchableOption<String>(
    context,
    title: l10n.ctrDestination,
    searchHint: l10n.ctrSearchCountries,
    selected: selectedId,
    sections: [
      if (own.isNotEmpty)
        LotOptionSection(l10n.ctrYourDestinations, [
          for (final d in own) LotOption(d.id, d.name, detail: d.code),
        ]),
      LotOptionSection(
        own.isEmpty ? l10n.ctrEveryCountry : l10n.ctrEveryOtherCountry,
        [for (final c in rest) LotOption(c.id, c.name, detail: c.code)],
      ),
    ],
  );
  if (picked == null) return null;
  final country = [...destinations, ...CountryCatalog.all]
      .where((d) => d.id == picked)
      .firstOrNull;
  return (id: picked, name: country?.name ?? picked);
}

/// Opens the contacts sheet for [line]; on a save, confirms it and returns
/// true. Correctable in every container state.
Future<bool> editContainerLineContacts(
  BuildContext context, {
  required String businessId,
  required ContainerLine line,
  ShippingContainer? container,
  String businessCountryCode = '',
  List<DestinationCountry> destinations = const [],
}) async {
  final l10n = AppLocalizations.of(context)!;
  final saved = await showLotSheet<bool>(
    context,
    _LineContactsSheet(
      businessId: businessId,
      line: line,
      customerCountryCode: containerCustomerCountryCode(businessCountryCode),
      // A package with no container yet opens on the country it is going to.
      receiverCountryCode: container == null && line.destinationCountryId.isNotEmpty
          ? (CallingCodeCatalog.countryCodeForReference(
                line.destinationCountryId,
                extra: destinations,
              ) ??
              CallingCodeCatalog.countryCodeForReference(
                line.destinationCountryName,
                extra: destinations,
              ) ??
              containerCustomerCountryCode(businessCountryCode))
          : containerReceiverCountryCode(
              container,
              destinations: destinations,
              businessCountryCode: businessCountryCode,
            ),
    ),
  );
  if (saved != true || !context.mounted) return false;
  AppHaptics.commit();
  showSuccessSnackBar(context, l10n.ctrContactsSaved);
  return true;
}

/// Opens the add-line form pre-filled with [line] and saves the edit through
/// `updateContainerLine`; returns true on a save. Offered only while
/// [container] is loading - after that the list is the record of what went
/// and only the contacts change (see [editContainerLineContacts]). The lists
/// let the form refuse a VIN already on an open box and offer the lot's cars
/// and customers; without them the server still refuses the same VIN.
Future<bool> editContainerLine(
  BuildContext context, {
  required String businessId,
  required ContainerLine line,
  required ShippingContainer container,
  List<ShippingContainer> containers = const [],
  List<ContainerLine> lines = const [],
  List<LotCustomer> customers = const [],
  List<LotKnownCar> knownCars = const [],
  List<Map<String, dynamic>> parkedCarRows = const [],
  String businessCountryCode = '',
  List<DestinationCountry> destinations = const [],
}) async {
  final saved = await showLotSheet<bool>(
    context,
    _LineFormSheet(
      businessId: businessId,
      container: container,
      containers: containers.isEmpty ? [container] : containers,
      lines: lines,
      customers: customers,
      knownCars: knownCars,
      parkedCarRows: parkedCarRows,
      customerCountryCode: containerCustomerCountryCode(businessCountryCode),
      receiverCountryCode: containerReceiverCountryCode(
        container,
        destinations: destinations,
        businessCountryCode: businessCountryCode,
      ),
      existing: line,
    ),
  );
  return saved == true;
}

/// Opens the register form for a package dropped off before any container:
/// the same form as a line on a container, with where it is going, its size
/// and its price. Registers a new one, or corrects [existing]. Answers what
/// was saved - null when dismissed - so the caller can print its label.
Future<WaitingPackageSaved?> showWaitingPackageSheet(
  BuildContext context, {
  required String businessId,
  List<ShippingContainer> containers = const [],
  List<ContainerLine> lines = const [],
  List<LotCustomer> customers = const [],
  List<LotKnownCar> knownCars = const [],
  List<Map<String, dynamic>> parkedCarRows = const [],
  String businessCountryCode = '',
  List<DestinationCountry> destinations = const [],
  ContainerLine? existing,
  VoidCallback? onLineAdded,
  ContainerCallableCaller caller = callContainerCallable,
}) {
  final start = existing == null
      ? defaultWaitingDestination(destinations)
      : DestinationRef(
          existing.destinationCountryId, existing.destinationCountryName);
  return showLotSheet<WaitingPackageSaved>(
    context,
    _LineFormSheet(
      businessId: businessId,
      containers: containers,
      lines: lines,
      customers: customers,
      knownCars: knownCars,
      parkedCarRows: parkedCarRows,
      customerCountryCode: containerCustomerCountryCode(businessCountryCode),
      receiverCountryCode: containerCustomerCountryCode(businessCountryCode),
      onLineAdded: onLineAdded,
      existing: existing,
      waiting: true,
      destinations: destinations,
      defaultDestination: start,
      caller: caller,
    ),
  );
}

/// The print-labels sheet for every package on [container], or for [line]
/// alone. [opener] fetches the page and opens it (a fake in tests).
///
/// A package still waiting for a container has none: pass the [line] alone and
/// the labels are asked for by line id, printable before any container exists.
Future<void> showContainerLabelSheet(
  BuildContext context, {
  required String businessId,
  ShippingContainer? container,
  ContainerLine? line,
  ContainerLabelOpener opener = openContainerLabels,
}) {
  assert(container != null || line != null);
  final l10n = AppLocalizations.of(context)!;
  return showLotSheet<bool>(
    context,
    LabelPrintSheet(
      subtitle: line == null
          ? l10n.ctrPrintLabelsAll(container!.displayName)
          : l10n.ctrPrintLabelsOne(containerLineTitle(l10n, line)),
      onPrint: (choice) => opener(
        businessId: businessId,
        containerId: container?.id ?? '',
        choice: choice,
        lineId: line?.id ?? '',
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Test seams. The screens around these sheets need a signed-in business and
// live Firestore streams; the sheets themselves only touch Firebase when a
// valid form is submitted, so widget tests pump them directly.
// ---------------------------------------------------------------------------

/// The add-line sheet for [container], on its own; with [existing], the same
/// sheet editing that line.
@visibleForTesting
Widget containerLineFormSheetForTesting({
  required ShippingContainer container,
  List<LotCustomer> customers = const [],
  String customerCountryCode = 'US',
  String receiverCountryCode = 'US',
  ContainerLine? existing,
  List<ContainerLine> lines = const [],
}) =>
    _LineFormSheet(
      businessId: container.businessId,
      container: container,
      containers: [container],
      lines: lines,
      customers: customers,
      knownCars: const [],
      customerCountryCode: customerCountryCode,
      receiverCountryCode: receiverCountryCode,
      existing: existing,
    );

/// The register-a-waiting-package sheet, on its own. [caller] stands in for
/// the callables.
@visibleForTesting
Widget waitingPackageSheetForTesting({
  required ContainerCallableCaller caller,
  List<DestinationCountry> destinations = const [],
  DestinationRef? defaultDestination,
  ContainerLine? existing,
  List<ContainerLine> lines = const [],
  List<LotCustomer> customers = const [],
}) =>
    _LineFormSheet(
      businessId: 'b1',
      containers: const [],
      lines: lines,
      customers: customers,
      knownCars: const [],
      customerCountryCode: 'US',
      receiverCountryCode: 'GN',
      existing: existing,
      waiting: true,
      destinations: destinations,
      defaultDestination: defaultDestination,
      caller: caller,
    );

/// The contacts sheet for [line], on its own.
@visibleForTesting
Widget containerLineContactsSheetForTesting({
  required ContainerLine line,
  String customerCountryCode = 'US',
  String receiverCountryCode = 'US',
}) =>
    _LineContactsSheet(
      businessId: line.businessId,
      line: line,
      customerCountryCode: customerCountryCode,
      receiverCountryCode: receiverCountryCode,
    );

/// A line's actions sheet; [open] is whether its container still loads.
@visibleForTesting
Widget containerLineActionsSheetForTesting({
  required ContainerLine line,
  required bool open,
}) =>
    _LineActionsSheet(line: line, staff: const [], open: open);
