import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:url_launcher/url_launcher.dart';

import '../data/country_catalog.dart';
import '../l10n/app_localizations.dart';
import '../models/destination_country.dart';
import '../services/container_lot_cars.dart';
import '../services/container_manifest.dart';
import '../services/lot_customers.dart';
import '../services/lot_ledger.dart';
import '../services/vin_decoder_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/vin_utils.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/lot_sheets.dart';
import 'vin_scanner_screen.dart';

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
class ContainersScreen extends StatefulWidget {
  const ContainersScreen({super.key, required this.businessId});

  final String businessId;

  @override
  State<ContainersScreen> createState() => _ContainersScreenState();
}

class _ContainersScreenState extends State<ContainersScreen> {
  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final List<StreamSubscription<Object?>> _subs = [];

  List<ShippingContainer> _containers = const [];
  List<ContainerLine> _lines = const [];
  List<LotStaff> _staff = const [];
  List<LotCustomer> _customers = const [];

  /// The business's `parkedCars` rows as stored, each with its `id`. One
  /// subscription feeds two readers: the VIN memory below, and the "is this
  /// car parked in your lot?" picker on the add-line sheet, which needs the
  /// status and dates a bare known-car does not keep.
  List<Map<String, dynamic>> _parkedCarRows = const [];
  List<LotKnownCar> _activityCars = const [];

  List<LotKnownCar> get _parkedCars => [
        for (final row in _parkedCarRows) LotKnownCar.fromMap(row),
      ];
  List<DestinationCountry> _destinations = const [];
  String _businessName = '';

  String _filter = containerStatusLoading;
  String _search = '';
  bool _loading = true;
  bool _loadFailed = false;

  /// Every vehicle this business has on file: parked cars first, then what
  /// a past activity recorded, then what an earlier container carried.
  /// Typing a VIN it recognises should never leave staff re-typing the car.
  List<LotKnownCar> get _knownCars => [
        ..._parkedCars,
        ..._activityCars,
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
    // No orderBy on either collection: sorted client-side so neither query
    // needs a composite index.
    Query<Map<String, dynamic>> scoped(String path) =>
        _db.collection(path).where('businessId', isEqualTo: id);

    _subs.add(scoped('containers').snapshots().listen((snap) {
      if (!mounted) return;
      setState(() {
        _containers = sortContainers([
          for (final d in snap.docs) ShippingContainer.fromMap(d.id, d.data()),
        ]);
        _loading = false;
        _loadFailed = false;
      });
    }, onError: (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _loadFailed = true;
        });
      }
    }));

    _subs.add(scoped('containerLines').snapshots().listen((snap) {
      if (!mounted) return;
      setState(() => _lines = [
            for (final d in snap.docs) ContainerLine.fromMap(d.id, d.data()),
          ]);
    }, onError: (_) {}));

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

    _subs.add(scoped('parkedCars').limit(500).snapshots().listen((snap) {
      if (!mounted) return;
      setState(() => _parkedCarRows = [
            for (final d in snap.docs) {...d.data(), 'id': d.id},
          ]);
    }, onError: (_) {}));

    _subs.add(scoped('lotActivities')
        .orderBy('activityDate', descending: true)
        .limit(500)
        .snapshots()
        .listen((snap) {
      if (!mounted) return;
      setState(() => _activityCars = [
            for (final d in snap.docs) LotKnownCar.fromMap(d.data()),
          ]);
    }, onError: (_) {}));

    _subs.add(_db.collection('businesses').doc(id).snapshots().listen((doc) {
      if (!mounted) return;
      final data = doc.data() ?? const <String, dynamic>{};
      setState(() =>
          _businessName = (data['name'] ?? data['businessName'] ?? '').toString());
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
    super.dispose();
  }

  void _openDetail(String containerId) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ContainerDetailScreen(
          businessId: widget.businessId,
          containerId: containerId,
          staff: _staff,
          customers: _customers,
          knownCars: _knownCars,
          parkedCarRows: _parkedCarRows,
          destinations: _destinations,
          onCustomerRecorded: _loadCustomers,
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
            search: _search,
            onSearch: (v) => setState(() => _search = v),
            filter: _filter,
            counts: counts,
            onFilter: (v) {
              AppHaptics.selection();
              setState(() => _filter = v);
            },
            showFilter: !searching,
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
    required this.search,
    required this.onSearch,
    required this.filter,
    required this.counts,
    required this.onFilter,
    required this.showFilter,
  });

  final String businessName;
  final String search;
  final ValueChanged<String> onSearch;
  final String filter;
  final Map<String, int> counts;
  final ValueChanged<String> onFilter;
  final bool showFilter;

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
                      child: _StatusChips(
                        selected: filter,
                        counts: counts,
                        onChanged: onFilter,
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
                _StatusPill(status: c.status),
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
  });

  final List<ContainerSearchHit> hits;
  final List<LotStaff> staff;
  final ValueChanged<String> onOpen;

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
              // The line's whereabouts, which is what a search is asking.
              trailing: hit.container == null
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
                        _StatusPill(status: hit.container!.status),
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
              onTap: hit.container == null
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
    required this.onCustomerRecorded,
  });

  final String businessId;
  final String containerId;
  final List<LotStaff> staff;
  final List<LotCustomer> customers;
  final List<LotKnownCar> knownCars;

  /// The business's `parkedCars` rows, from the subscription the list screen
  /// already holds: the add-line sheet offers the ones standing in the lot.
  final List<Map<String, dynamic>> parkedCarRows;
  final List<DestinationCountry> destinations;
  final VoidCallback onCustomerRecorded;

  @override
  State<ContainerDetailScreen> createState() => _ContainerDetailScreenState();
}

class _ContainerDetailScreenState extends State<ContainerDetailScreen> {
  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final List<StreamSubscription<Object?>> _subs = [];

  List<ShippingContainer> _containers = const [];
  List<ContainerLine> _allLines = const [];
  bool _loaded = false;

  /// Which action is in flight, so every button disables together and the
  /// one pressed shows it is working.
  String _busy = '';

  ShippingContainer? get _container =>
      _containers.where((c) => c.id == widget.containerId).firstOrNull;

  List<ContainerLine> get _lines =>
      linesOfContainer(_allLines, widget.containerId);

  Map<String, ShippingContainer> get _byId =>
      {for (final c in _containers) c.id: c};

  @override
  void initState() {
    super.initState();
    final id = widget.businessId;
    Query<Map<String, dynamic>> scoped(String path) =>
        _db.collection(path).where('businessId', isEqualTo: id);
    _subs.add(scoped('containers').snapshots().listen((snap) {
      if (!mounted) return;
      setState(() {
        _containers = sortContainers([
          for (final d in snap.docs) ShippingContainer.fromMap(d.id, d.data()),
        ]);
        _loaded = true;
      });
    }, onError: (_) {
      if (mounted) setState(() => _loaded = true);
    }));
    _subs.add(scoped('containerLines').snapshots().listen((snap) {
      if (!mounted) return;
      setState(() => _allLines = [
            for (final d in snap.docs) ContainerLine.fromMap(d.id, d.data()),
          ]);
    }, onError: (_) {}));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
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
      showErrorSnackBar(context, _refusalText(l10n, error, containers: _byId));
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
    showErrorSnackBar(context, _containerErrorText(l10n, code));
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
        onLineAdded: widget.onCustomerRecorded,
      ),
    );
    if (added == true) widget.onCustomerRecorded();
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
                          child: _ActionButton(
                            key: const Key('container-document'),
                            icon: Icons.print_outlined,
                            label: l10n.ctrOpenDocument,
                            busy: _busy == 'document',
                            enabled: !busy,
                            onTap: _openDocument,
                          ),
                        ),
                        if (!container.isArrived) ...[
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: _ActionButton(
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
                          ),
                        ],
                      ],
                    ),
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
              _StatusPill(status: c.status),
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

class _ActionButton extends StatelessWidget {
  const _ActionButton({
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
              child: Icon(_kindIcon(line.kind), size: 18, color: AppColors.cobaltDeep),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _lineTitle(l10n, line),
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
      title: _lineTitle(l10n, line),
      subtitle: open ? null : l10n.ctrLockedNote,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _LineCard(line: line, staff: staff),
          if (open) ...[
            const SizedBox(height: AppSpacing.sm),
            _SheetAction(
              key: const Key('line-move'),
              icon: Icons.drive_file_move_outlined,
              label: l10n.ctrMoveLine,
              onTap: () => Navigator.of(context).pop('move'),
            ),
            _SheetAction(
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

class _SheetAction extends StatelessWidget {
  const _SheetAction({
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
    final l10n = AppLocalizations.of(context)!;
    // The business's own destinations first, then every other country: a
    // business that lists none under Services & coverage still has the
    // whole world to choose from, never an empty sheet.
    final ownIds = {for (final d in widget.destinations) d.id};
    final own = [...widget.destinations]
      ..sort((a, b) => a.name.compareTo(b.name));
    final rest = [
      for (final c in CountryCatalog.all)
        if (!ownIds.contains(c.id)) c,
    ]..sort((a, b) => a.name.compareTo(b.name));
    final picked = await pickLotSearchableOption<String>(
      context,
      title: l10n.ctrDestination,
      searchHint: l10n.ctrSearchCountries,
      selected: _destinationId,
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
    if (picked == null || !mounted) return;
    final country = [...widget.destinations, ...CountryCatalog.all]
        .where((d) => d.id == picked)
        .firstOrNull;
    setState(() {
      _destinationId = picked;
      _destinationName = country?.name ?? picked;
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
            ? rest.map((c) => _containerErrorText(l10n, c)).join(' ')
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
        _errors.contains(code) ? _containerErrorText(l10n, code) : null;

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
// Adding a line.
// ---------------------------------------------------------------------------

class _LineFormSheet extends StatefulWidget {
  const _LineFormSheet({
    required this.businessId,
    required this.container,
    required this.containers,
    required this.lines,
    required this.customers,
    required this.knownCars,
    this.parkedCarRows = const [],
    this.onLineAdded,
  });

  final String businessId;
  final ShippingContainer container;
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

  /// Lines saved from this one opening of the sheet. Five barrels for three
  /// customers are three lines, entered back to back without closing it.
  final List<String> _addedThisSitting = [];

  String _kind = containerLineKindCar;
  String _owner = containerOwnerCustomer;
  bool _busy = false;
  Set<String> _errors = {};
  String _serverNote = '';
  String _conflictName = '';
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

  @override
  void dispose() {
    for (final c in [
      _vin, _make, _model, _year, _quantity, _description, _customer, _phone,
      _receiver, _receiverPhone, _lotFilter,
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
    // refuse the same VIN with the same code.
    final holding = openContainerHoldingVin(
      containerLinesForVin(widget.lines, clean),
      ignoreContainerId: widget.container.id,
    );
    if (holding.isNotEmpty) {
      setState(() {
        _conflictName = widget.containers
                .where((c) => c.id == holding)
                .firstOrNull
                ?.displayName ??
            '';
        _errors = {..._errors, 'vin_already_loaded'};
      });
    }

    final known = lotFindKnownCar(clean, widget.knownCars);
    if (known != null && known.hasVehicle) {
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
      return;
    }

    if (_vinHint.isNotEmpty) setState(() => _vinHint = '');
    if (isValidVin(clean) && clean != _decodedVin) _decodeVin(clean);
  }

  Future<void> _decodeVin(String vin) async {
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _vinBusy = true;
      _decodedVin = vin;
    });
    try {
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
      );

  /// What a saved line reads as in the "added so far" tally.
  String _tallyLabel(AppLocalizations l10n, ContainerLineDraft d) {
    final what = d.kind == containerLineKindBarrels
        ? l10n.ctrBarrelsQty(d.quantity)
        : '${d.description} ${l10n.ctrTimes(d.quantity)}';
    final whose = d.ownerKind == containerOwnerStock
        ? l10n.ctrStock
        : d.customerName.trim();
    final to = d.receiverName.trim();
    return '$what — $whose${to.isEmpty ? '' : ' → $to'}';
  }

  /// `andAnother` keeps the sheet open after the save with the same kind of
  /// cargo selected and the customer cleared, for the next customer's share.
  Future<void> _submit({bool andAnother = false}) async {
    final l10n = AppLocalizations.of(context)!;
    final draft = _draft;
    final errors = validateContainerLine(draft).toSet();
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
      await FirebaseFunctions.instance
          .httpsCallable('addContainerLine')
          .call<Object?>({
        'businessId': widget.businessId,
        'containerId': widget.container.id,
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
        if (refusal.conflictContainerId.isNotEmpty) {
          _conflictName = widget.containers
                  .where((c) => c.id == refusal.conflictContainerId)
                  .firstOrNull
                  ?.displayName ??
              '';
        }
        _serverNote = rest.isNotEmpty
            ? rest.map((c) => _containerErrorText(l10n, c)).join(' ')
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
    'vin_required',
    'vin_already_loaded',
    'quantity_required',
    'description_required',
    'customer_name_required',
  };

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    String? errorFor(String code) => _errors.contains(code)
        ? _containerErrorText(l10n, code, conflictName: _conflictName)
        : null;
    final isCar = _kind == containerLineKindCar;
    final isOther = _kind == containerLineKindOther;
    // A car's fields (and whose it is) appear once the lot question is
    // answered: straight away under "No", after a pick under "Yes".
    final showCarFields =
        isCar && (_inLot == false || (_inLot == true && _pickedCar != null));
    final showOwner = !isCar || showCarFields;

    return LotSheetShell(
      title: l10n.ctrAddLine,
      subtitle: widget.container.displayName,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            _RefusalNote(text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          if (showOwner && !isCar) ...[
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
            label: _addedThisSitting.isEmpty ? l10n.ctrAdd : l10n.ctrAddAndClose,
            busy: _busy,
            busyLabel: l10n.ctrAdding,
            onTap: _submit,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
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
              TextField(
                key: const Key('line-phone'),
                controller: _phone,
                keyboardType: TextInputType.phone,
                decoration: InputDecoration(labelText: l10n.lotPhone),
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
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
            TextField(
              key: const Key('line-receiver-phone'),
              controller: _receiverPhone,
              keyboardType: TextInputType.phone,
              decoration: InputDecoration(labelText: l10n.ctrReceiverPhone),
            ),
            if (!isCar) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(
                l10n.ctrSplitHint,
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
                      _kindIcon(kind),
                      size: 16,
                      color: kind == selected
                          ? AppColors.cobaltDeep
                          : AppColors.muted,
                    ),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        _kindLabel(l10n, kind),
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

// ---------------------------------------------------------------------------
// Shared bits: the state pill, kinds, counts, and the refusal vocabulary.
// ---------------------------------------------------------------------------

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final color = switch (status) {
      containerStatusShipped => AppColors.cobalt,
      containerStatusArrived => AppColors.sage,
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
      _ => l10n.ctrStatusLoading,
    };

IconData _kindIcon(String kind) => switch (kind) {
      containerLineKindCar => Icons.directions_car_outlined,
      containerLineKindBarrels => Icons.oil_barrel_outlined,
      _ => Icons.category_outlined,
    };

String _kindLabel(AppLocalizations l10n, String kind) => switch (kind) {
      containerLineKindCar => l10n.ctrKindCar,
      containerLineKindBarrels => l10n.ctrKindBarrels,
      _ => l10n.ctrKindOther,
    };

String _lineTitle(AppLocalizations l10n, ContainerLine line) {
  if (line.isCar) return line.vehicleLabel;
  if (line.isBarrels) return l10n.ctrBarrelsQty(line.quantity);
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
String _containerErrorText(
  AppLocalizations l10n,
  String code, {
  String conflictName = '',
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
    'vin_already_loaded' => conflictName.isEmpty
        ? l10n.ctrErrVinAlreadyLoaded
        : l10n.ctrErrVinAlreadyLoadedIn(conflictName),
    'move_target_not_loading' => l10n.ctrErrMoveTarget,
    _ => l10n.lotCouldNotSave,
  };
}

/// What to say for a refusal the server sent back: its codes in our words,
/// naming the conflicting container when it named one; the server's own
/// message when it spoke no code we know.
String _refusalText(
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
      .map((c) => _containerErrorText(l10n, c, conflictName: conflict))
      .join(' ');
}
