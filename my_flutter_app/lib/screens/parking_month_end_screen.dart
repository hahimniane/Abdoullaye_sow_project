import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../l10n/app_localizations.dart';
import '../models/parked_car.dart';
import '../services/business_activity_queries.dart';
import '../services/business_parking_entry.dart'
    show businessParkingReceivedViaValues;
import '../services/firestore_query_spec.dart';
import '../services/parking_month_statement.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../utils/parking_month_pdf.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/lot_sheets.dart';
import 'parked_car_details_screen.dart';
import 'pdf_preview_screen.dart';

/// Settling the books for a month: every car that was on the lot that month,
/// what it ran up, what came in, and who still owes - each with its own bill
/// to send. Worked out live from the cars by
/// `services/parking_month_statement.dart`, which mirrors the server and the
/// console; payments are recorded on the car as always, oldest month first,
/// so a bill turns to paid by itself.
class ParkingMonthEndScreen extends StatefulWidget {
  const ParkingMonthEndScreen({
    super.key,
    required this.businessId,
    this.monthKey,
  });

  final String businessId;

  /// "YYYY-MM"; the month just ended when absent.
  final String? monthKey;

  @override
  State<ParkingMonthEndScreen> createState() => _ParkingMonthEndScreenState();
}

class _ParkingMonthEndScreenState extends State<ParkingMonthEndScreen> {
  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final List<StreamSubscription<Object?>> _subs = [];
  late String _monthKey = widget.monthKey ?? previousParkingMonthKey();
  List<DocumentSnapshot<Map<String, dynamic>>> _docs = const [];

  /// Ledger activities: those dated in the month, and older ones still
  /// unpaid, go on the same bills as the cars.
  List<Map<String, dynamic>> _activities = const [];

  /// The month's reads, replaced when the month changes. Exactly what the
  /// server's month-end job reads (`notifyParkingMonthEndFor`): the stays
  /// that end on or after the month starts, the activities dated in it, the
  /// older unsettled ones, and the rare undated ones. This screen used to
  /// listen to every parked car and every activity the lot ever had to bill
  /// one month.
  final List<StreamSubscription<Object?>> _monthSubs = [];
  String _subscribedMonth = '';
  List<Map<String, dynamic>> _inMonth = const [];
  List<Map<String, dynamic>> _unsettled = const [];
  List<Map<String, dynamic>> _undated = const [];
  Timer? _loadingSafety;

  /// The statement, worked out once per change of the rows or the month -
  /// not on every rebuild (a busy flag flipping used to re-run it).
  Object? _summaryKey;
  ParkingMonthSummary? _summaryCache;

  /// The team, for "Received by" when a whole bill is marked paid.
  List<({String id, String name})> _staff = const [];
  Map<String, dynamic> _business = const {};
  bool _loading = true;
  ParkingMonthView _view = ParkingMonthView.owing;
  String _busy = '';

  @override
  void initState() {
    super.initState();
    _subscribeMonth();
    _subs.add(
      _db
          .collection('users')
          .where('businessId', isEqualTo: widget.businessId)
          .snapshots()
          .listen((snap) {
            if (!mounted) return;
            setState(
              () => _staff = [
                for (final d in snap.docs)
                  (
                    id: d.id,
                    name:
                        (d.data()['fullName'] ??
                                d.data()['name'] ??
                                d.data()['email'] ??
                                '')
                            .toString(),
                  ),
              ].where((s) => s.name.isNotEmpty).toList(),
            );
          }, onError: (_) {}),
    );
    _subs.add(
      _db.collection('businesses').doc(widget.businessId).snapshots().listen((
        doc,
      ) {
        if (mounted) setState(() => _business = doc.data() ?? const {});
      }, onError: (_) {}),
    );
  }

  /// (Re)reads the month on screen. A no-op when it is already the one read.
  void _subscribeMonth() {
    final monthKey = _monthKey;
    if (monthKey == _subscribedMonth) return;
    _subscribedMonth = monthKey;
    for (final s in _monthSubs) {
      s.cancel();
    }
    _monthSubs.clear();
    final days = parkingMonthDays(monthKey);
    if (days == null) {
      _docs = const [];
      _inMonth = _unsettled = _undated = const [];
      _activities = const [];
      _loading = false;
      return;
    }
    const dayMs = 24 * 60 * 60 * 1000;
    final startMs = days.first * dayMs;
    final endMs = (days.last + 1) * dayMs;
    final id = widget.businessId;
    _loading = true;
    _loadingSafety?.cancel();
    // The spinner always resolves, even if a read never answers.
    _loadingSafety = Timer(const Duration(seconds: 20), () {
      if (mounted && _loading) setState(() => _loading = false);
    });
    List<Map<String, dynamic>> rows(QuerySnapshot<Map<String, dynamic>> snap) =>
        [for (final d in snap.docs) {...d.data(), 'id': d.id}];
    void mergeActivities() {
      _activities = mergeById<Map<String, dynamic>>(
        [_inMonth, _unsettled, _undated],
        (row) => '${row['id'] ?? ''}',
      );
    }

    _monthSubs.add(
      parkedCarsEndingFromSpec(id, startMs).build(_db).snapshots().listen(
        (snap) {
          if (!mounted) return;
          setState(() {
            _docs = snap.docs;
            _loading = false;
          });
        },
        onError: (_) {
          if (mounted) setState(() => _loading = false);
        },
      ),
    );
    _monthSubs.add(
      lotActivitiesBetweenSpec(
        id,
        Timestamp.fromMillisecondsSinceEpoch(startMs),
        Timestamp.fromMillisecondsSinceEpoch(endMs),
      ).build(_db).snapshots().listen((snap) {
        if (!mounted) return;
        setState(() {
          _inMonth = rows(snap);
          mergeActivities();
        });
      }, onError: (_) {}),
    );
    _monthSubs.add(
      lotActivitiesUnsettledSpec(id).build(_db).snapshots().listen((snap) {
        if (!mounted) return;
        setState(() {
          _unsettled = rows(snap);
          mergeActivities();
        });
      }, onError: (_) {}),
    );
    _monthSubs.add(
      lotActivitiesUndatedSpec(id).build(_db).snapshots().listen((snap) {
        if (!mounted) return;
        setState(() {
          _undated = rows(snap);
          mergeActivities();
        });
      }, onError: (_) {}),
    );
  }

  void _showMonth(String monthKey) {
    setState(() => _monthKey = monthKey);
    _subscribeMonth();
  }

  ParkingMonthSummary _summary() {
    final key = (_docs, _activities, _monthKey);
    final cached = _summaryCache;
    if (cached != null && key == _summaryKey) return cached;
    _summaryKey = key;
    return _summaryCache = parkingMonthSummary(
      [
        for (final d in _docs) {...?d.data(), 'id': d.id},
      ],
      _monthKey,
      null,
      _activities,
    );
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    for (final s in _monthSubs) {
      s.cancel();
    }
    _loadingSafety?.cancel();
    super.dispose();
  }

  String get _businessName =>
      (_business['name'] ?? _business['businessName'] ?? '').toString();

  ParkingMonthPdfCopy _copy(AppLocalizations l10n, String locale) =>
      ParkingMonthPdfCopy(
        bill: l10n.pmePdfBill,
        summary: l10n.pmePdfSummary,
        monthLabel: parkingMonthLabel(_monthKey, locale),
        billedTo: l10n.invPdfBilledTo,
        vehicle: l10n.pmePdfVehicle,
        period: l10n.pmePdfPeriod,
        parkingLine: (days, rate) => l10n.pmeParkingLine(days, rate),
        priorUnpaid: l10n.pmeFromBefore,
        paid: l10n.invPdfPaid,
        balanceDue: l10n.invPdfBalanceDue,
        paidInFull: l10n.invPdfPaidInFull,
        stillParked: l10n.pmeStillParked,
        left: l10n.pmeLeft,
        soFar: l10n.pmeSoFar,
        carsOnLot: l10n.pmeCarsOnLot,
        billed: l10n.pmeBilled,
        collected: l10n.pmeCollected,
        owed: l10n.pmeStillOwed,
        whoOwes: l10n.pmeWhoOwes,
        nobodyOwes: l10n.pmeNobodyOwes,
        daysLabel: (d) => l10n.pmeDays(d),
        footer: l10n.invPdfFooter,
        car: l10n.pmeCar,
        amount: l10n.pmeAmount,
        to: l10n.pmeTo,
        registeredTo: l10n.pmeRegisteredTo,
        monthTotal: l10n.pmeMonthTotal,
        carsLabel: (n) => l10n.pmeCars(n),
        itemsLabel: (n) => l10n.pmeItems(n),
        activitiesTitle: l10n.pmeActivities,
        activity: l10n.pmeActivity,
        date: l10n.pmeDate,
        parkingTitle: l10n.pmeParking,
        paidToward: l10n.pmePaidToward,
        paidWord: l10n.pmePaidWord,
        dueWord: l10n.pmeDueWord,
        locale: locale,
      );

  Future<void> _run(String key, Future<void> Function() work) async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _busy = key);
    try {
      await work();
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.pmePdfFailed);
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _shareSummary(ParkingMonthSummary summary) async {
    final l10n = AppLocalizations.of(context)!;
    final locale = Localizations.localeOf(context).toLanguageTag();
    await _run('summary', () async {
      final bytes = await buildParkingMonthSummaryPdf(
        business: {..._business, 'name': _businessName},
        summary: summary,
        copy: _copy(l10n, locale),
      );
      if (!mounted) return;
      await openPdfPreview(
        context,
        bytes: bytes,
        fileName: parkingMonthFileName(
          'parking-month-end',
          _monthKey,
          '',
          _businessName,
        ),
        title: '${l10n.pmeTitle} — ${parkingMonthLabel(_monthKey, locale)}',
      );
    });
  }

  Future<void> _customerActions(ParkingMonthCustomer customer) async {
    final l10n = AppLocalizations.of(context)!;
    final locale = Localizations.localeOf(context).toLanguageTag();
    final action = await pickLotOption<String>(
      context,
      title: customer.customerName.isEmpty
          ? l10n.pmePdfBill
          : customer.customerName,
      options: [
        LotOption('pdf', l10n.pmeSharePdf),
        LotOption('text', l10n.pmeSendText),
        if (customer.dueCents > 0 &&
            monthBillPaymentPlan(customer).items.isNotEmpty)
          LotOption('settle', l10n.pmeMarkAllPaid),
        if (customer.cars.isNotEmpty) LotOption('open', l10n.pmeOpenCar),
      ],
    );
    if (action == null || !mounted) return;
    switch (action) {
      case 'settle':
        await showLotSheet<bool>(
          context,
          _SettleSheet(
            customer: customer,
            monthLabel: parkingMonthLabel(_monthKey, locale),
            staff: _staff,
          ),
        );
      case 'pdf':
        await _run(customer.key, () async {
          final bytes = await buildParkingMonthBillPdf(
            business: {..._business, 'name': _businessName},
            customer: customer,
            copy: _copy(l10n, locale),
          );
          if (!mounted) return;
          await openPdfPreview(
            context,
            bytes: bytes,
            fileName: parkingMonthFileName(
              'parking-bill',
              _monthKey,
              customer.customerName,
              _businessName,
            ),
            title: customer.customerName.isEmpty
                ? l10n.pmePdfBill
                : customer.customerName,
          );
        });
      case 'text':
        await SharePlus.instance.share(
          ShareParams(text: parkingMonthCustomerText(customer, _businessName)),
        );
      case 'open':
        // A customer with several cars: say which one the payment is for.
        var carId = customer.cars.first.id;
        if (customer.cars.length > 1) {
          final picked = await pickLotOption<String>(
            context,
            title: l10n.pmePickCar,
            options: [
              for (final b in customer.cars)
                LotOption(
                  b.id,
                  b.vehicle.isEmpty ? b.vinNumber : b.vehicle,
                  detail: parkingMoney(b.dueCents),
                ),
            ],
          );
          if (picked == null || !mounted) return;
          carId = picked;
        }
        final doc = _docs.where((d) => d.id == carId).firstOrNull;
        if (doc == null || !mounted) return;
        await Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) =>
                ParkedCarDetailsScreen(parkedCar: ParkedCar.fromFirestore(doc)),
          ),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = Localizations.localeOf(context).toLanguageTag();
    final summary = _summary();
    final thisMonth = shiftParkingMonthKey(previousParkingMonthKey(), 1);

    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          Container(
            decoration: BoxDecoration(
              color: AppColors.paper,
              border: Border(
                bottom: BorderSide(
                  color: AppColors.rule.withValues(alpha: 0.8),
                ),
              ),
            ),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  4,
                  4,
                  AppSpacing.lg,
                  AppSpacing.md,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        const AppBackButton(),
                        Expanded(
                          child: Text(
                            l10n.pmeTitle,
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                              height: 1.1,
                              letterSpacing: -0.4,
                              color: AppColors.ink,
                            ),
                          ),
                        ),
                        IconButton(
                          key: const Key('month-end-share-summary'),
                          tooltip: l10n.pmeShareMonth,
                          onPressed: _busy.isNotEmpty || _loading
                              ? null
                              : () => _shareSummary(summary),
                          icon: _busy == 'summary'
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.picture_as_pdf_outlined),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        IconButton(
                          key: const Key('month-end-previous'),
                          tooltip: l10n.pmePreviousMonth,
                          onPressed: () => _showMonth(
                            shiftParkingMonthKey(_monthKey, -1),
                          ),
                          icon: const Icon(Icons.chevron_left),
                        ),
                        SizedBox(
                          width: 180,
                          child: Text(
                            parkingMonthLabel(_monthKey, locale),
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize: 17,
                              fontWeight: FontWeight.w700,
                              color: AppColors.ink,
                            ),
                          ),
                        ),
                        IconButton(
                          key: const Key('month-end-next'),
                          tooltip: l10n.pmeNextMonth,
                          onPressed: _monthKey.compareTo(thisMonth) >= 0
                              ? null
                              : () => _showMonth(
                                  shiftParkingMonthKey(_monthKey, 1),
                                ),
                          icon: const Icon(Icons.chevron_right),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      children: [
                        _Stat(
                          label: l10n.pmeCarsOnLot,
                          value: '${summary.carsOnLot}',
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        _Stat(
                          label: l10n.pmeBilled,
                          value: parkingMoney(summary.billedCents),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      children: [
                        _Stat(
                          label: l10n.pmeCollected,
                          value: parkingMoney(summary.collectedCents),
                          tone: AppColors.sage,
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        _Stat(
                          label: l10n.pmeStillOwed,
                          value: parkingMoney(summary.dueCents),
                          tone: summary.dueCents > 0 ? AppColors.warn : null,
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.md),
                    ParkingMonthViewTabs(
                      summary: summary,
                      view: _view,
                      onChanged: (view) => setState(() => _view = view),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : ParkingMonthCustomerList(
                    summary: summary,
                    view: _view,
                    busyKey: _busy,
                    onTap: _customerActions,
                  ),
          ),
        ],
      ),
    );
  }
}

/// Which customers the month end lists: who still owes, who has paid for
/// the month, everyone. The split itself is the statement's
/// (`customersOwing` / `customersPaid`), shared with the console and server.
enum ParkingMonthView { owing, paid, all }

List<ParkingMonthCustomer> parkingMonthListed(
  ParkingMonthSummary summary,
  ParkingMonthView view,
) => switch (view) {
  ParkingMonthView.owing => summary.customersOwing,
  ParkingMonthView.paid => summary.customersPaid,
  ParkingMonthView.all => summary.customers,
};

/// The three views, in order: Who owes · Paid · Everyone, each with its count.
class ParkingMonthViewTabs extends StatelessWidget {
  const ParkingMonthViewTabs({
    super.key,
    required this.summary,
    required this.view,
    required this.onChanged,
  });

  final ParkingMonthSummary summary;
  final ParkingMonthView view;
  final ValueChanged<ParkingMonthView> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final tabs = [
      (
        ParkingMonthView.owing,
        l10n.pmeWhoOwesCount(summary.customersOwing.length),
      ),
      (ParkingMonthView.paid, l10n.pmePaidCount(summary.customersPaid.length)),
      (ParkingMonthView.all, l10n.pmeEveryoneCount(summary.customers.length)),
    ];
    return Row(
      children: [
        for (var i = 0; i < tabs.length; i++) ...[
          if (i > 0) const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: _Tab(
              key: Key('month-end-tab-${tabs[i].$1.name}'),
              label: tabs[i].$2,
              selected: view == tabs[i].$1,
              onTap: () => onChanged(tabs[i].$1),
            ),
          ),
        ],
      ],
    );
  }
}

/// One card per customer (grouped by phone), their cars underneath - the
/// same card in every view - or what the empty view means.
class ParkingMonthCustomerList extends StatelessWidget {
  const ParkingMonthCustomerList({
    super.key,
    required this.summary,
    required this.view,
    required this.onTap,
    this.busyKey = '',
  });

  final ParkingMonthSummary summary;
  final ParkingMonthView view;
  final ValueChanged<ParkingMonthCustomer> onTap;
  final String busyKey;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final listed = parkingMonthListed(summary, view);
    if (listed.isEmpty) {
      return LotEmptyState(
        icon: Icons.event_available_outlined,
        title: summary.customers.isEmpty
            ? l10n.pmeNoCars
            : view == ParkingMonthView.paid
            ? l10n.pmeNobodyPaid
            : l10n.pmeNobodyOwes,
      );
    }
    return ListView.builder(
      key: const Key('month-end-list'),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        40,
      ),
      itemCount: listed.length,
      itemBuilder: (_, i) => _CustomerTile(
        customer: listed[i],
        busy: busyKey.isNotEmpty && busyKey == listed[i].key,
        onTap: () => onTap(listed[i]),
      ),
    );
  }
}

/// A payment method as the app names it: the "How it was paid" words, plus
/// the payment link and online payments a month's bill can also carry.
String _methodLabel(AppLocalizations l10n, String m) => switch (m) {
  'cash' => l10n.invMethodCash,
  'zelle' => l10n.invMethodZelle,
  'cashapp' => l10n.invMethodCashapp,
  'venmo' => l10n.invMethodVenmo,
  'check' => l10n.invMethodCheck,
  'card_in_person' => l10n.invMethodCardInPerson,
  'card_link' => l10n.paymentLinkLabel,
  'online' => l10n.lotPaymentOnline,
  _ => l10n.invMethodOther,
};

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, this.tone});

  final String label;
  final String value;
  final Color? tone;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: AppColors.cream,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          border: Border.all(color: AppColors.rule),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label.toUpperCase(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 9.5,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.5,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              value,
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                fontFeatures: const [FontFeature.tabularFigures()],
                color: tone ?? AppColors.ink,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      scale: 0.96,
      onTap: onTap,
      child: AnimatedContainer(
        duration: AppMotion.press,
        height: 36,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? AppColors.cobalt : AppColors.paper,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          border: Border.all(
            color: selected ? AppColors.cobalt : AppColors.rule,
          ),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 6),
        // Three to a row on a phone: a long French label shrinks to fit
        // rather than wrapping out of the 36pt pill.
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            label,
            maxLines: 1,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: selected ? Colors.white : AppColors.muted,
            ),
          ),
        ),
      ),
    );
  }
}

/// One customer's card. What is left to collect leads; lines already paid
/// fold away under one toggle so a paid car never looks owed. The bill itself
/// (PDF, text) still lists everything.
class _CustomerTile extends StatefulWidget {
  const _CustomerTile({
    required this.customer,
    required this.busy,
    required this.onTap,
  });

  final ParkingMonthCustomer customer;
  final bool busy;
  final VoidCallback onTap;

  @override
  State<_CustomerTile> createState() => _CustomerTileState();
}

class _CustomerTileState extends State<_CustomerTile> {
  bool _showPaid = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final customer = widget.customer;
    final busy = widget.busy;
    final onTap = widget.onTap;
    final owes = customer.dueCents > 0;
    final paidLines =
        customer.cars.where((b) => b.dueCents <= 0).length +
        [
          ...customer.activities,
          ...customer.olderActivities,
        ].where((a) => a.dueCents <= 0).length;
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
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        customer.customerName.isEmpty
                            ? '—'
                            : customer.customerName,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                        ),
                      ),
                      Text(
                        [
                          customer.customerPhone,
                          if (customer.cars.isNotEmpty)
                            l10n.pmeCars(customer.cars.length),
                          if (customer.activities.length +
                                  customer.olderActivities.length >
                              0)
                            l10n.pmeActivitiesCount(
                              customer.activities.length +
                                  customer.olderActivities.length,
                            ),
                        ].where((p) => p.isNotEmpty).join(' · '),
                        style: const TextStyle(
                          fontSize: 12.5,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                if (busy)
                  const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                else
                  Text(
                    owes ? parkingMoney(customer.dueCents) : l10n.invStatusPaid,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                      fontFeatures: const [FontFeature.tabularFigures()],
                      color: owes ? AppColors.warn : AppColors.sage,
                    ),
                  ),
              ],
            ),
            const Divider(height: 16),
            for (var i = 0; i < customer.cars.length; i++)
              if (customer.cars[i].dueCents > 0 || _showPaid)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              customer.cars[i].vehicle.isEmpty
                                  ? l10n.pmeCar
                                  : customer.cars[i].vehicle,
                              style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: AppColors.ink,
                              ),
                            ),
                            Text(
                              [
                                '${displayDay(customer.cars[i].periodFrom, dateLocaleOf(context))} '
                                    '${l10n.pmeTo} '
                                    '${displayDay(customer.cars[i].periodTo, dateLocaleOf(context))}',
                                l10n.pmeParkingLine(
                                  customer.cars[i].days,
                                  parkingMoney(customer.cars[i].dayRateCents),
                                ),
                                if (customer.registeredTo[i].isNotEmpty)
                                  '${l10n.pmeRegisteredTo} ${customer.registeredTo[i]}',
                              ].join(' · '),
                              style: const TextStyle(
                                fontSize: 11.5,
                                color: AppColors.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                      _Amount(
                        amount: customer.cars[i].monthCents,
                        paid: customer.cars[i].monthPaidCents,
                        due: customer.cars[i].dueCents,
                      ),
                    ],
                  ),
                ),
            for (final a in [
              ...customer.activities,
              ...customer.olderActivities,
            ])
              if (a.dueCents > 0 || _showPaid)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${a.label}${a.vehicle.isNotEmpty ? ' · ${a.vehicle}' : ''}',
                              style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: AppColors.ink,
                              ),
                            ),
                            Text(
                              [
                                displayDay(a.date, dateLocaleOf(context)),
                                if (a.prior) l10n.pmeFromBefore.toLowerCase(),
                              ].join(' · '),
                              style: const TextStyle(
                                fontSize: 11.5,
                                color: AppColors.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                      _Amount(
                        amount: a.prior ? a.dueCents : a.feeCents,
                        paid: a.paidCents,
                        due: a.dueCents,
                      ),
                    ],
                  ),
                ),
            if (paidLines > 0)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  key: const Key('month-end-toggle-paid'),
                  style: TextButton.styleFrom(
                    padding: EdgeInsets.zero,
                    minimumSize: const Size(0, 32),
                    foregroundColor: AppColors.muted,
                  ),
                  onPressed: () => setState(() => _showPaid = !_showPaid),
                  icon: Icon(
                    _showPaid ? Icons.expand_less : Icons.expand_more,
                    size: 18,
                  ),
                  label: Text(l10n.pmeAlreadyPaid(paidLines)),
                ),
              ),
            if (customer.priorUnpaidCents > 0 || customer.monthPaidCents > 0)
              Text(
                [
                  if (customer.priorUnpaidCents > 0)
                    '+ ${parkingMoney(customer.priorUnpaidCents)} ${l10n.pmeFromBefore.toLowerCase()}',
                  if (customer.monthPaidCents > 0)
                    '${l10n.invPdfPaid} ${parkingMoney(customer.monthPaidCents)}',
                  if (customer.monthPaidCents > 0 &&
                      customer.paidVia.isNotEmpty)
                    customer.paidVia
                        .map((m) => _methodLabel(l10n, m))
                        .join(', '),
                ].join(' · '),
                style: const TextStyle(fontSize: 12, color: AppColors.muted),
              ),
          ],
        ),
      ),
    );
  }
}

/// An item's amount, with what was paid toward it and what is still due.
class _Amount extends StatelessWidget {
  const _Amount({required this.amount, required this.paid, required this.due});

  final int amount;
  final int paid;
  final int due;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    const small = TextStyle(
      fontSize: 11,
      fontFeatures: [FontFeature.tabularFigures()],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          parkingMoney(amount),
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            fontFeatures: [FontFeature.tabularFigures()],
            color: AppColors.ink,
          ),
        ),
        if (paid > 0)
          Text(
            '${parkingMoney(paid)} ${l10n.pmePaidWord}',
            style: small.copyWith(color: AppColors.sage),
          ),
        Text(
          due > 0
              ? '${parkingMoney(due)} ${l10n.pmeDueWord}'
              : l10n.pmePaidInFull,
          style: small.copyWith(
            color: due > 0 ? AppColors.warn : AppColors.sage,
          ),
        ),
      ],
    );
  }
}

/// "Mark all paid": every line of the bill through the payment it already
/// takes, with the same details any payment needs - how it was paid and who
/// received it (required). Lines go one after another; a line that fails is
/// named and the rest still go through.
class _SettleSheet extends StatefulWidget {
  const _SettleSheet({
    required this.customer,
    required this.monthLabel,
    required this.staff,
  });

  final ParkingMonthCustomer customer;
  final String monthLabel;
  final List<({String id, String name})> staff;

  @override
  State<_SettleSheet> createState() => _SettleSheetState();
}

class _SettleSheetState extends State<_SettleSheet> {
  String _via = 'cash';
  late String _by =
      widget.staff
          .where((s) => s.id == (FirebaseAuth.instance.currentUser?.uid ?? ''))
          .firstOrNull
          ?.id ??
      '';
  late final _note = TextEditingController(
    text: 'Month end — ${widget.monthLabel}',
  );
  bool _busy = false;
  String _progress = '';
  String _error = '';
  List<({String key, String label, String reason})> _failed = const [];

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickVia() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.invPayMethod,
      selected: _via,
      options: [
        for (final m in businessParkingReceivedViaValues)
          LotOption(m, _methodLabel(l10n, m)),
      ],
    );
    if (picked != null && mounted) setState(() => _via = picked);
  }

  Future<void> _pickBy() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.lotReceivedBy,
      selected: _by,
      options: [for (final s in widget.staff) LotOption(s.id, s.name)],
    );
    if (picked != null && mounted) {
      setState(() {
        _by = picked;
        _error = '';
      });
    }
  }

  Future<void> _run() async {
    final l10n = AppLocalizations.of(context)!;
    if (_by.isEmpty) {
      AppHaptics.refuse();
      setState(() => _error = l10n.pmeSayWhoReceived);
      return;
    }
    final plan = monthBillPaymentPlan(widget.customer);
    final retry = _failed.isEmpty ? null : {for (final f in _failed) f.key};
    final items = [
      for (final x in plan.items)
        if (retry == null || retry.contains('${x.kind}:${x.id}')) x,
    ];
    final failed = <({String key, String label, String reason})>[];
    var recorded = 0;
    setState(() {
      _busy = true;
      _error = '';
    });
    for (var i = 0; i < items.length; i++) {
      final x = items[i];
      if (mounted) {
        setState(
          () => _progress = l10n.pmeRecordingProgress(i + 1, items.length),
        );
      }
      try {
        await FirebaseFunctions.instance
            .httpsCallable(
              x.kind == 'car'
                  ? 'recordBusinessParkingPartialPayment'
                  : 'recordLotActivityInstalment',
            )
            .call<Object?>({
              if (x.kind == 'car') 'entryId': x.id else 'activityId': x.id,
              'amountCents': x.amountCents,
              'receivedVia': _via,
              'receivedByStaffId': _by,
              'note': _note.text.trim(),
            });
        recorded += x.amountCents;
      } on FirebaseFunctionsException catch (error) {
        failed.add((
          key: '${x.kind}:${x.id}',
          label: x.label,
          reason: error.message ?? l10n.lotCouldNotSave,
        ));
      } catch (_) {
        failed.add((
          key: '${x.kind}:${x.id}',
          label: x.label,
          reason: l10n.lotCouldNotSave,
        ));
      }
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _progress = '';
      _failed = failed;
    });
    if (failed.isEmpty) {
      AppHaptics.commit();
      Navigator.of(context).pop(true);
      showSuccessSnackBar(
        context,
        l10n.pmeRecordedAll(parkingMoney(recorded), items.length),
      );
    } else {
      AppHaptics.refuse();
      setState(
        () => _error = l10n.pmeSomeFailed(
          items.length - failed.length,
          items.length,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final plan = monthBillPaymentPlan(widget.customer);
    final retry = _failed.isEmpty ? null : {for (final f in _failed) f.key};
    final byName = widget.staff.where((s) => s.id == _by).firstOrNull?.name;
    return LotSheetShell(
      title: l10n.pmeMarkAllPaid,
      subtitle: '${widget.customer.customerName} · ${widget.monthLabel}',
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_error.isNotEmpty) ...[
            Text(
              [
                _error,
                for (final f in _failed) '• ${f.label} — ${f.reason}',
              ].join('\n'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('month-end-settle'),
            label: retry == null
                ? l10n.pmeRecordTotal(parkingMoney(plan.totalCents))
                : l10n.pmeTryAgain(_failed.length),
            busy: _busy,
            busyLabel: _progress,
            tone: LotTone.good,
            onTap: _run,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.pmeSettleHint,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          for (final x in plan.items)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '${x.kind == 'car' ? l10n.pmeParking : l10n.pmeActivity} · ${x.label}',
                      style: TextStyle(
                        fontSize: 13,
                        color:
                            retry != null &&
                                !retry.contains('${x.kind}:${x.id}')
                            ? AppColors.muted
                            : AppColors.ink,
                        decoration:
                            retry != null &&
                                !retry.contains('${x.kind}:${x.id}')
                            ? TextDecoration.lineThrough
                            : null,
                      ),
                    ),
                  ),
                  Text(
                    parkingMoney(x.amountCents),
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          for (final x in plan.skipped)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                '${l10n.pmeParking} · ${x.label} — ${l10n.pmeNotIncluded}',
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
              ),
            ),
          const Divider(height: 18),
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.pmeTotalToRecord,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Text(
                parkingMoney(plan.totalCents),
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            label: l10n.invPayMethod,
            value: _methodLabel(l10n, _via),
            placeholder: l10n.invPayMethod,
            onTap: _busy ? () {} : _pickVia,
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            key: const Key('month-end-received-by'),
            label: l10n.lotReceivedBy,
            value: byName,
            placeholder: l10n.pmeWhoTookIt,
            onTap: _busy ? () {} : _pickBy,
            error: _error.isNotEmpty && _by.isEmpty
                ? l10n.pmeSayWhoReceived
                : null,
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _note,
            enabled: !_busy,
            decoration: InputDecoration(labelText: l10n.invPayNote),
          ),
        ],
      ),
    );
  }
}
