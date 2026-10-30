import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart' show FirebaseAuth;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../l10n/app_localizations.dart';
import '../models/parked_car.dart';
import '../providers/auth_provider.dart';
import '../services/business_activity_queries.dart';
import '../services/business_parking_entry.dart'
    show businessParkingReceivedViaValues;
import '../services/firestore_query_spec.dart';
import '../services/lot_ledger.dart' show lotDollarsToCents;
import '../services/parking_month_statement.dart';
import '../services/parking_whatsapp.dart';
import '../services/staff_balances.dart';
import '../services/staff_expense_repayments.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/business_permissions.dart';
import '../utils/date_display.dart';
import '../utils/parking_month_pdf.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/parking_invoices_card.dart';
import '../widgets/parking_messages_section.dart'
    show parkingMessageIsProblem, parkingMessageStatusText;
import '../widgets/received_by_options.dart';
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
    this.balancesService = const StaffBalancesService(),
  });

  final String businessId;

  /// Staff balances, for the cash staff hold in "Business owes".
  final StaffBalancesService balancesService;

  /// "YYYY-MM"; the month just ended when absent.
  final String? monthKey;

  @override
  State<ParkingMonthEndScreen> createState() => _ParkingMonthEndScreenState();
}

class _ParkingMonthEndScreenState extends State<ParkingMonthEndScreen> {
  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final List<StreamSubscription<Object?>> _subs = [];
  late String _monthKey = widget.monthKey ?? previousParkingMonthKey();
  /// The month's cars: [_stayDocs] (stays ending on or after the month
  /// starts) merged with [_unpaidDocs] (cars not paid up, which carries a
  /// car that left before the month still owing, docs/PARKING_CARRYOVER.md).
  List<DocumentSnapshot<Map<String, dynamic>>> _docs = const [];
  List<DocumentSnapshot<Map<String, dynamic>>> _stayDocs = const [];
  List<DocumentSnapshot<Map<String, dynamic>>> _unpaidDocs = const [];
  bool _staysAnswered = false;
  bool _unpaidAnswered = false;

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

  /// This month's invoice WhatsApp rows by customer
  /// (docs/PARKING_INVOICES.md §3). A refused read just means no status on
  /// the cards.
  StreamSubscription<List<ParkingMessage>>? _invoiceSub;
  Map<String, ParkingMessage> _invoices = const {};
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

  /// "Whole month (estimate)": the month still running, counted as of its
  /// last day. A read-only preview; back to "So far" whenever the month
  /// changes.
  bool _wholeMonth = false;

  /// Showing the estimate right now (only the unfinished current month has
  /// one).
  bool get _estimating => _wholeMonth && parkingMonthCanEstimate(_monthKey);

  /// Staff expenses that come off their parking bill
  /// (docs/STAFF_EXPENSE_CREDIT.md): every expense entry and every "Paid
  /// back" of the business - both sides are cumulative, so not per month.
  /// The links live on the business doc read below.
  List<Map<String, dynamic>> _expenseRows = const [];
  List<Map<String, dynamic>> _repaymentRows = const [];

  /// `lotExpenseLines`: only names each expense on the bill; a refused read
  /// leaves the expenses reading as their notes, never blocks the netting.
  List<Map<String, dynamic>> _expenseLineRows = const [];
  bool _expensesLoaded = false;
  bool _repaymentsLoaded = false;

  /// A read was refused (no ledger access, or rules not there yet): the
  /// bills show without expenses and a note says so - never a crash.
  bool _creditError = false;
  bool _creditTimedOut = false;
  Timer? _creditSafety;

  /// The cash each person holds today (Staff balances), for "Business owes"
  /// (owner, 2026-10-30). Fetched once per set of owed lines; loading always
  /// resolves (the service's timeout), and a failure shows expenses only.
  List<StaffBalanceRow>? _cashBalances;
  OwesCashState _cashState = OwesCashState.loading;
  int _cashKey = -1;
  int _cashGeneration = 0;

  void _askCash(int owesCents) {
    if (owesCents == _cashKey) return;
    _cashKey = owesCents;
    final generation = ++_cashGeneration;
    // Never setState during build.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted || generation != _cashGeneration) return;
      setState(() => _cashState = OwesCashState.loading);
      List<StaffBalanceRow>? balances;
      try {
        balances = (await widget.balancesService.load(widget.businessId)).staff;
      } catch (_) {
        balances = null;
      }
      if (!mounted || generation != _cashGeneration) return;
      setState(() {
        _cashBalances = balances;
        _cashState =
            balances == null ? OwesCashState.failed : OwesCashState.ready;
      });
    });
  }

  bool get _creditReady =>
      _expensesLoaded && _repaymentsLoaded && !_creditError;
  bool get _creditPending =>
      !_creditError && !_creditTimedOut && !_creditReady;

  @override
  void initState() {
    super.initState();
    _subscribeMonth();
    _subscribeStaffExpenses();
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

  /// One query each, equality only. The spinner waits for them so a bill
  /// never shows its pre-expense total first - but never longer than the
  /// safety timer; a refused read means no netting and a note.
  void _subscribeStaffExpenses() {
    _creditSafety = Timer(const Duration(seconds: 20), () {
      if (mounted && _creditPending) setState(() => _creditTimedOut = true);
    });
    List<Map<String, dynamic>> rows(QuerySnapshot<Map<String, dynamic>> snap) =>
        [for (final d in snap.docs) {...d.data(), 'id': d.id}];
    void refused(Object _) {
      if (mounted) setState(() => _creditError = true);
    }

    _subs.add(
      lotExpenseEntriesAllSpec(widget.businessId)
          .build(_db)
          .snapshots()
          .listen((snap) {
            if (!mounted) return;
            setState(() {
              _expenseRows = rows(snap);
              _expensesLoaded = true;
            });
          }, onError: refused),
    );
    _subs.add(
      staffExpenseRepaymentsSpec(widget.businessId)
          .build(_db)
          .snapshots()
          .listen((snap) {
            if (!mounted) return;
            setState(() {
              _repaymentRows = rows(snap);
              _repaymentsLoaded = true;
            });
          }, onError: refused),
    );
    _subs.add(
      lotExpenseLinesSpec(widget.businessId)
          .build(_db)
          .snapshots()
          .listen((snap) {
            if (!mounted) return;
            setState(() => _expenseLineRows = rows(snap));
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
    _subscribeInvoices(monthKey);
    final days = parkingMonthDays(monthKey);
    if (days == null) {
      _docs = _stayDocs = _unpaidDocs = const [];
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
    _staysAnswered = _unpaidAnswered = false;
    _stayDocs = _unpaidDocs = _docs = const [];
    _loadingSafety?.cancel();
    // The spinner always resolves, even if a read never answers.
    _loadingSafety = Timer(const Duration(seconds: 20), () {
      if (mounted && _loading) setState(() => _loading = false);
    });
    List<Map<String, dynamic>> rows(QuerySnapshot<Map<String, dynamic>> snap) =>
        [for (final d in snap.docs) {...d.data(), 'id': d.id}];
    // The summary waits for both car reads (an error counts as an answer, the
    // safety timer covers a read that never comes) so the bill never shows
    // without the cars carried in from before.
    void mergeCars() {
      _docs = mergeById<DocumentSnapshot<Map<String, dynamic>>>(
        [_stayDocs, _unpaidDocs],
        (doc) => doc.id,
      );
      _loading = !(_staysAnswered && _unpaidAnswered);
    }

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
            _stayDocs = snap.docs;
            _staysAnswered = true;
            mergeCars();
          });
        },
        onError: (_) {
          if (!mounted) return;
          setState(() {
            _staysAnswered = true;
            mergeCars();
          });
        },
      ),
    );
    _monthSubs.add(
      parkedCarsUnpaidCarriedSpec(id).build(_db).snapshots().listen(
        (snap) {
          if (!mounted) return;
          setState(() {
            _unpaidDocs = snap.docs;
            _unpaidAnswered = true;
            mergeCars();
          });
        },
        onError: (_) {
          if (!mounted) return;
          setState(() {
            _unpaidAnswered = true;
            mergeCars();
          });
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

  void _subscribeInvoices(String monthKey) {
    _invoiceSub?.cancel();
    _invoiceSub = null;
    _invoices = const {};
    if (parkingMonthDays(monthKey) == null) return;
    try {
      _invoiceSub =
          parkingInvoiceMessagesStream(
            businessId: widget.businessId,
            monthKey: monthKey,
          ).listen(
            (rows) {
              if (!mounted) return;
              setState(() => _invoices = parkingInvoiceStatusByCustomer(rows));
            },
            onError: (Object error) {
              debugPrint('Parking invoice rows read failed: $error');
              if (mounted && _invoices.isNotEmpty) {
                setState(() => _invoices = const {});
              }
            },
          );
    } catch (error) {
      debugPrint('Parking invoice rows read failed: $error');
    }
  }

  void _showMonth(String monthKey) {
    setState(() {
      _monthKey = monthKey;
      _wholeMonth = false;
    });
    _subscribeMonth();
    // The reads above reset the month's rows; show that now.
    if (mounted) setState(() {});
  }

  ParkingMonthSummary _summary() {
    final estimating = _estimating;
    final ready = _creditReady;
    final links = _business['staffParkingLinks'];
    final key = (
      _docs,
      _activities,
      _monthKey,
      estimating,
      ready,
      _expenseRows,
      _repaymentRows,
      _expenseLineRows,
      links,
      _staff,
    );
    final cached = _summaryCache;
    if (cached != null && key == _summaryKey) return cached;
    _summaryKey = key;
    return _summaryCache = parkingMonthSummary(
      [
        for (final d in _docs) {...?d.data(), 'id': d.id},
      ],
      _monthKey,
      parkingMonthAsOf(_monthKey, estimating),
      _activities,
      ready
          ? ParkingMonthStaffExpenses(
              entries: _expenseRows,
              repayments: _repaymentRows,
              lines: _expenseLineRows,
              links: links is Map ? links.cast<String, dynamic>() : const {},
              staffNames: {for (final s in _staff) s.id: s.name},
            )
          : null,
    );
  }

  /// This month's "Paid back" rows still standing, newest first.
  List<StaffExpenseRepayment> _monthRepayments() {
    final list = [
      for (final row in _repaymentRows)
        StaffExpenseRepayment.fromMap('${row['id'] ?? ''}', row),
    ].where((r) => !r.voided && r.month == _monthKey).toList()
      ..sort((a, b) {
        final at = a.paidAt?.millisecondsSinceEpoch ?? 0;
        final bt = b.paidAt?.millisecondsSinceEpoch ?? 0;
        return bt.compareTo(at);
      });
    return list;
  }

  Future<void> _paidBack(ParkingMonthStaffOwed row) async {
    // Prefilled with what the business really owes now (the expenses, less
    // the cash they hold); the cap stays the expenses owed.
    final owedNow = _cashState == OwesCashState.ready
        ? businessOwesWithCash([row], _cashBalances).lines.first.owedNowCents
        : row.owedCents;
    await showLotSheet<bool>(
      context,
      StaffRepaymentSheet(
        businessId: widget.businessId,
        owed: row,
        prefillCents: owedNow < row.owedCents ? owedNow : row.owedCents,
        staff: _staff,
        currentUid: FirebaseAuth.instance.currentUser?.uid ?? '',
      ),
    );
  }

  Future<void> _voidRepayment(StaffExpenseRepayment repayment) async {
    final l10n = AppLocalizations.of(context)!;
    final name = _staff.where((s) => s.id == repayment.staffId).firstOrNull?.name;
    final confirmed = await confirmVoidStaffRepayment(
      context,
      amount: parkingMoney(repayment.amountCents),
      name: name == null || name.isEmpty ? '—' : name,
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = 'void:${repayment.id}');
    try {
      await const StaffExpenseRepaymentService().voidRepayment(
        businessId: widget.businessId,
        repaymentId: repayment.id,
      );
      if (mounted) showSuccessSnackBar(context, l10n.pmeRepaymentVoided);
    } on StaffRepaymentFailure catch (failure) {
      if (mounted) {
        showErrorSnackBar(context, staffRepaymentRefusalText(l10n, failure));
      }
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  /// The month's last day as the reader reads a date ("Oct 31, 2026").
  String _lastDayLabel() =>
      displayDay(parkingMonthLastDayKey(_monthKey), dateLocaleOf(context));

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    for (final s in _monthSubs) {
      s.cancel();
    }
    _invoiceSub?.cancel();
    _loadingSafety?.cancel();
    _creditSafety?.cancel();
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
        estimate: _estimating ? l10n.pmeEstimateHeader(_lastDayLabel()) : '',
        expensesTitle: l10n.pmeExpensesTitle,
        lessExpenses: l10n.pmeLessExpenses,
        lessStaffExpenses: l10n.pmeLessStaffExpenses,
        businessOwes: l10n.pmeBusinessOwes,
        noParkingBill: l10n.pmeNoParkingBill,
        lotExpense: l10n.pmeLotExpense,
        earlierExpenses: l10n.pmeEarlierExpenses,
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
    final estimating = _estimating;
    final action = await pickLotOption<String>(
      context,
      title: customer.customerName.isEmpty
          ? l10n.pmePdfBill
          : customer.customerName,
      options: parkingMonthCustomerOptions(
        l10n,
        customer,
        estimate: estimating,
      ),
    );
    if (action == null || !mounted) return;
    switch (action) {
      // Never collect for days that have not happened yet.
      case 'settle' || 'open' when estimating:
        return;
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
        // The bill text mirrors the server byte for byte; an estimate only
        // gets its one-line marker on top, and a linked staff member's bill
        // its expenses (added here, never in the shared builder).
        final text = parkingMonthTextWithExpenses(
          parkingMonthCustomerText(customer, _businessName),
          customer,
          title: l10n.pmeExpensesTitle,
          less: l10n.pmeLessExpenses,
          lotExpense: l10n.pmeLotExpense,
          earlier: l10n.pmeEarlierExpenses,
        );
        await SharePlus.instance.share(
          ShareParams(
            text: estimating
                ? parkingMonthEstimateText(
                    l10n.pmeEstimateHeader(_lastDayLabel()),
                    text,
                  )
                : text,
          ),
        );
      case 'open':
        // A customer with several cars: say which one the payment is for.
        // Cars carried in from before the month are openable too.
        final openable = [
          for (final b in customer.olderCars)
            (id: b.id, vehicle: b.vehicle, vin: b.vinNumber, due: b.dueCents),
          for (final b in customer.cars)
            (id: b.id, vehicle: b.vehicle, vin: b.vinNumber, due: b.dueCents),
        ];
        if (openable.isEmpty) return;
        var carId = openable.first.id;
        if (openable.length > 1) {
          final picked = await pickLotOption<String>(
            context,
            title: l10n.pmePickCar,
            options: [
              for (final b in openable)
                LotOption(
                  b.id,
                  b.vehicle.isEmpty ? b.vin : b.vehicle,
                  detail: parkingMoney(b.due),
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
    // "Business owes" and Paid back: the owner, or staff with the ledger.
    final canSettleStaff = Provider.of<AuthProvider>(context)
        .hasBusinessPermission(BusinessPermission.ledger);
    final monthRepayments =
        canSettleStaff ? _monthRepayments() : const <StaffExpenseRepayment>[];
    final showOwes = canSettleStaff &&
        _creditReady &&
        (summary.businessOwes.isNotEmpty || monthRepayments.isNotEmpty);
    final creditUnavailable =
        _creditError || (_creditTimedOut && !_creditReady);
    // "Send invoices": the owner (or a platform admin) only, with the switch
    // on, for the month just ended (the card hides itself otherwise).
    final auth = Provider.of<AuthProvider>(context);
    final parkingWhatsApp = _business['parkingWhatsApp'];
    final invoicesCard = ParkingInvoicesCard(
      businessId: widget.businessId,
      monthKey: _monthKey,
      switchOn: parkingWhatsApp is Map && parkingWhatsApp['enabled'] == true,
      canSend: auth.isBusinessOwner || auth.isAdmin,
      staffNames: {for (final s in _staff) s.id: s.name},
    );
    if (showOwes && summary.businessOwes.isNotEmpty) {
      _askCash(summary.businessOwesCents);
    }
    final owes = showOwes
        ? ParkingMonthBusinessOwes(
            summary: summary,
            cashState: summary.businessOwes.isEmpty
                ? OwesCashState.none
                : _cashState,
            balances: _cashBalances,
            repayments: monthRepayments,
            staffNames: {for (final s in _staff) s.id: s.name},
            busyKey: _busy,
            // Never pay back against the estimate.
            onPaidBack: _estimating ? null : _paidBack,
            onVoid: _voidRepayment,
          )
        : null;

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
                    ParkingMonthEstimateBar(
                      monthKey: _monthKey,
                      wholeMonth: _wholeMonth,
                      onChanged: (whole) =>
                          setState(() => _wholeMonth = whole),
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
                    if (creditUnavailable) ...[
                      const SizedBox(height: 6),
                      Text(
                        l10n.pmeExpensesUnavailable,
                        key: const Key('month-end-expenses-unavailable'),
                        style: const TextStyle(
                          fontSize: 12,
                          height: 1.3,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
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
            child: _loading || _creditPending
                ? const Center(child: CircularProgressIndicator())
                : ParkingMonthCustomerList(
                    summary: summary,
                    view: _view,
                    busyKey: _busy,
                    onTap: _customerActions,
                    invoices: _invoices,
                    leading: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [invoicesCard, ?owes],
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

/// What a customer's card offers: the bill as a PDF or text, and - only for
/// real numbers, never for the whole-month estimate - the ways to record a
/// payment ("Mark all paid", open the car).
List<LotOption<String>> parkingMonthCustomerOptions(
  AppLocalizations l10n,
  ParkingMonthCustomer customer, {
  bool estimate = false,
}) => [
  LotOption('pdf', l10n.pmeSharePdf),
  LotOption('text', l10n.pmeSendText),
  if (!estimate &&
      customer.dueCents > 0 &&
      monthBillPaymentPlan(customer).items.isNotEmpty)
    LotOption('settle', l10n.pmeMarkAllPaid),
  if (!estimate && (customer.cars.isNotEmpty || customer.olderCars.isNotEmpty))
    LotOption('open', l10n.pmeOpenCar),
];

/// A shared bill marked as the estimate: the marker line, a blank line, then
/// the bill text exactly as the server would send it.
String parkingMonthEstimateText(String header, String billText) =>
    '$header\n\n$billText';

/// "So far" / "Whole month (estimate)", shown only for the month still
/// running (`parkingMonthCanEstimate`), with what the estimate means under
/// it. Nothing for any other month.
class ParkingMonthEstimateBar extends StatelessWidget {
  const ParkingMonthEstimateBar({
    super.key,
    required this.monthKey,
    required this.wholeMonth,
    required this.onChanged,
    this.now,
  });

  final String monthKey;
  final bool wholeMonth;
  final ValueChanged<bool> onChanged;

  /// The clock, for tests; the real one when null.
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    if (!parkingMonthCanEstimate(monthKey, now)) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    final lastDay = displayDay(
      parkingMonthLastDayKey(monthKey),
      dateLocaleOf(context),
    );
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SegmentedButton<bool>(
            key: const Key('month-end-estimate-mode'),
            segments: [
              ButtonSegment(
                value: false,
                label: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(l10n.pmeModeSoFar, maxLines: 1),
                ),
              ),
              ButtonSegment(
                value: true,
                label: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(l10n.pmeModeWholeMonth, maxLines: 1),
                ),
              ),
            ],
            selected: {wholeMonth},
            showSelectedIcon: false,
            onSelectionChanged: (set) => onChanged(set.first),
            style: const ButtonStyle(visualDensity: VisualDensity.compact),
          ),
          if (wholeMonth) ...[
            const SizedBox(height: 6),
            Text(
              l10n.pmeEstimateNote(lastDay),
              key: const Key('month-end-estimate-note'),
              style: const TextStyle(
                fontSize: 12,
                height: 1.3,
                color: AppColors.warn,
              ),
            ),
          ],
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
    this.leading,
    this.invoices = const {},
  });

  final ParkingMonthSummary summary;
  final ParkingMonthView view;
  final ValueChanged<ParkingMonthCustomer> onTap;
  final String busyKey;

  /// The month's invoice WhatsApp row of each customer (by
  /// `ParkingMonthCustomer.key`): shown as that card's invoice status.
  final Map<String, ParkingMessage> invoices;

  /// Shown above the customers in every view ("Business owes").
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final listed = parkingMonthListed(summary, view);
    final empty = listed.isEmpty
        ? LotEmptyState(
            icon: Icons.event_available_outlined,
            title: summary.customers.isEmpty
                ? l10n.pmeNoCars
                : view == ParkingMonthView.paid
                ? l10n.pmeNobodyPaid
                : l10n.pmeNobodyOwes,
          )
        : null;
    if (empty != null && leading == null) return empty;
    final head = leading == null ? 0 : 1;
    return ListView.builder(
      key: const Key('month-end-list'),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        40,
      ),
      itemCount: head + (empty != null ? 1 : listed.length),
      itemBuilder: (_, i) {
        if (i < head) return leading!;
        if (empty != null) return empty;
        final customer = listed[i - head];
        return _CustomerTile(
          customer: customer,
          busy: busyKey.isNotEmpty && busyKey == customer.key,
          invoice: invoices[customer.key],
          onTap: () => onTap(customer),
        );
      },
    );
  }
}

/// A linked staff member's bill as text: the shared text (which mirrors the
/// server byte for byte) with this month's expenses listed before the totals
/// and "Less expenses" just above the balance - added here, so the shared
/// builder stays the server's. Unchanged when nothing came off.
String parkingMonthTextWithExpenses(
  String text,
  ParkingMonthCustomer c, {
  required String title,
  required String less,
  required String lotExpense,
  required String earlier,
}) {
  if (c.expenseCreditCents <= 0) return text;
  final lines = text.split('\n');
  // The totals are the last block; its last line is the balance.
  final totalsStart = lines.lastIndexOf('');
  if (totalsStart < 0 || lines.length < 2) return text;
  final balance = lines.removeLast();
  // This month's expenses, then the earlier months' part of the credit, so
  // the lines add up to "Less expenses".
  final expenses = [
    if (c.expenseLines.isNotEmpty || c.earlierExpenseCents > 0) ...[
      title,
      for (final e in c.expenseLines)
        '${[
          if (e.date.isNotEmpty) dayLabel(e.date),
          e.label.isEmpty ? lotExpense : e.label,
          if (e.staffName.isNotEmpty) e.staffName,
        ].join(' · ')} — ${parkingMoney(e.amountCents)}',
      if (c.earlierExpenseCents > 0)
        '$earlier — ${parkingMoney(c.earlierExpenseCents)}',
      '',
    ],
  ];
  lines
    ..insertAll(totalsStart + 1, expenses)
    ..add('$less — -${parkingMoney(c.expenseCreditCents)}')
    ..add(balance);
  return lines.join('\n');
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
    this.invoice,
  });

  final ParkingMonthCustomer customer;
  final bool busy;
  final VoidCallback onTap;

  /// This month's invoice message to the customer, when one exists.
  final ParkingMessage? invoice;

  @override
  State<_CustomerTile> createState() => _CustomerTileState();
}

class _CustomerTileState extends State<_CustomerTile> {
  bool _showPaid = false;
  bool _showExpenses = false;

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
                          if (customer.cars.isNotEmpty ||
                              customer.olderCars.isNotEmpty)
                            l10n.pmeCars(
                              customer.cars.length + customer.olderCars.length,
                            ),
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
            if (widget.invoice case final invoice?)
              _InvoiceStatus(customer: customer, invoice: invoice),
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
            // Cars that left before the month and still owe: "unpaid from
            // before", the whole stay, what is still due (PARKING_CARRYOVER).
            for (var i = 0; i < customer.olderCars.length; i++)
              Padding(
                key: Key('month-end-carried-${customer.olderCars[i].id}'),
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            customer.olderCars[i].vehicle.isEmpty
                                ? l10n.pmeCar
                                : customer.olderCars[i].vehicle,
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: AppColors.ink,
                            ),
                          ),
                          Text(
                            [
                              '${displayDay(customer.olderCars[i].periodFrom, dateLocaleOf(context))} → '
                                  '${displayDay(customer.olderCars[i].periodTo, dateLocaleOf(context))}',
                              l10n.pmeFromBefore.toLowerCase(),
                              if (customer.olderCars[i].vinNumber.isNotEmpty)
                                'VIN ${customer.olderCars[i].vinNumber}',
                              if (customer.olderCarsRegisteredTo[i].isNotEmpty)
                                '${l10n.pmeRegisteredTo} ${customer.olderCarsRegisteredTo[i]}',
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
                      amount: customer.olderCars[i].dueCents,
                      paid: 0,
                      due: customer.olderCars[i].dueCents,
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
            if (customer.expenseCreditCents > 0)
              _ExpenseCredit(
                customer: customer,
                open: _showExpenses,
                onToggle: () => setState(() => _showExpenses = !_showExpenses),
              ),
          ],
        ),
      ),
    );
  }
}

/// "Invoice: Delivered" under a customer's name: how the month's WhatsApp
/// invoice to them went (sent / delivered / read / failed ...).
class _InvoiceStatus extends StatelessWidget {
  const _InvoiceStatus({required this.customer, required this.invoice});

  final ParkingMonthCustomer customer;
  final ParkingMessage invoice;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final problem = parkingMessageIsProblem(invoice);
    final sent = invoice.status == ParkingMessageStatus.sent;
    final color = problem
        ? AppColors.errorRed
        : sent
        ? AppColors.sage
        : AppColors.muted;
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        key: Key('month-end-invoice-${customer.key}'),
        children: [
          Icon(
            problem ? Icons.error_outline : Icons.receipt_long_outlined,
            size: 15,
            color: color,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              l10n.parkingInvCustomerStatus(
                parkingMessageStatusText(l10n, invoice),
              ),
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// "Less expenses −$X" on a linked staff member's card, with this month's
/// expenses under one toggle.
class _ExpenseCredit extends StatelessWidget {
  const _ExpenseCredit({
    required this.customer,
    required this.open,
    required this.onToggle,
  });

  final ParkingMonthCustomer customer;
  final bool open;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    const small = TextStyle(fontSize: 12, color: AppColors.muted);
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.pmeLessExpensesAmount(
              parkingMoney(customer.expenseCreditCents),
            ),
            key: const Key('month-end-less-expenses'),
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              fontFeatures: [FontFeature.tabularFigures()],
              color: AppColors.sage,
            ),
          ),
          if (customer.expenseLines.isNotEmpty)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                key: const Key('month-end-toggle-expenses'),
                style: TextButton.styleFrom(
                  padding: EdgeInsets.zero,
                  minimumSize: const Size(0, 32),
                  foregroundColor: AppColors.muted,
                ),
                onPressed: onToggle,
                icon: Icon(open ? Icons.expand_less : Icons.expand_more, size: 18),
                label: Text(
                  l10n.pmeExpenseLinesCount(customer.expenseLines.length),
                ),
              ),
            ),
          if (open)
            for (final e in customer.expenseLines)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        [
                          e.label.isEmpty ? l10n.pmeLotExpense : e.label,
                          if (e.staffName.isNotEmpty) e.staffName,
                          if (e.date.isNotEmpty)
                            displayDay(e.date, dateLocaleOf(context)),
                        ].join(' · '),
                        style: small,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Text(
                      parkingMoney(e.amountCents),
                      style: small.copyWith(
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  ],
                ),
              ),
          // The earlier months' part of the credit, so the lines add up to
          // "Less expenses"; shown by itself when there is nothing this month.
          if (customer.earlierExpenseCents > 0 &&
              (open || customer.expenseLines.isEmpty))
            Padding(
              key: const Key('month-end-earlier-expenses'),
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: Text(l10n.pmeEarlierExpenses, style: small)),
                  const SizedBox(width: AppSpacing.sm),
                  Text(
                    parkingMoney(customer.earlierExpenseCents),
                    style: small.copyWith(
                      fontFeatures: const [FontFeature.tabularFigures()],
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

/// Refusals of the Paid back actions in the reader's words
/// (docs/STAFF_EXPENSE_CREDIT.md §4).
String staffRepaymentRefusalText(
  AppLocalizations l10n,
  StaffRepaymentFailure failure,
) {
  if (failure.offline) return l10n.lotCouldNotSave;
  return switch (failure.reason) {
    'repayment_amount_invalid' => l10n.pmeRefusalRepaymentAmountInvalid,
    'repayment_exceeds_credit' => l10n.pmeRefusalRepaymentExceedsCredit,
    'repayment_not_found' => l10n.pmeRefusalRepaymentNotFound,
    'repayment_voided' => l10n.pmeRefusalRepaymentVoided,
    'repayment_method_invalid' => l10n.pmeRefusalRepaymentMethodInvalid,
    'repayment_date_invalid' => l10n.pmeRefusalRepaymentDateInvalid,
    'link_customer_invalid' => l10n.pmeRefusalLinkCustomerInvalid,
    'staff_action_invalid' => l10n.pmeRefusalStaffActionInvalid,
    'staff_not_member' => l10n.pmeRefusalStaffNotMember,
    _ => l10n.lotCouldNotSave,
  };
}

/// "Void this payment?" - it then counts as not paid back; nothing is
/// deleted.
Future<bool?> confirmVoidStaffRepayment(
  BuildContext context, {
  required String amount,
  required String name,
}) {
  final l10n = AppLocalizations.of(context)!;
  return showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l10n.pmeVoidRepaymentTitle),
      content: Text(l10n.pmeVoidRepaymentBody(amount, name)),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: Text(l10n.cancel),
        ),
        TextButton(
          key: const Key('month-end-void-confirm'),
          style: TextButton.styleFrom(foregroundColor: AppColors.errorRed),
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: Text(l10n.lotVoid),
        ),
      ],
    ),
  );
}

/// Whether "Business owes" knows the cash staff hold today (Staff balances).
/// [none]: not asked, so lines read as the expenses owed with no status line.
enum OwesCashState { none, loading, ready, failed }

/// "Business owes": the staff the business still owes for lot expenses they
/// paid themselves - not linked to a parking bill, or owed more than their
/// bill - each with Paid back, and this month's paid-back amounts with Void.
/// Shown to the owner and staff with the ledger only.
class ParkingMonthBusinessOwes extends StatelessWidget {
  const ParkingMonthBusinessOwes({
    super.key,
    required this.summary,
    this.cashState = OwesCashState.none,
    this.balances,
    required this.repayments,
    required this.staffNames,
    required this.onPaidBack,
    required this.onVoid,
    this.busyKey = '',
  });

  final ParkingMonthSummary summary;

  /// Whether the cash staff hold (Staff balances, as of today) is known; with
  /// [OwesCashState.none] no status line shows and lines read as the
  /// expenses owed.
  final OwesCashState cashState;
  final List<StaffBalanceRow>? balances;

  /// This month's repayments still standing.
  final List<StaffExpenseRepayment> repayments;
  final Map<String, String> staffNames;

  /// Null hides Paid back (the whole-month estimate).
  final ValueChanged<ParkingMonthStaffOwed>? onPaidBack;
  final ValueChanged<StaffExpenseRepayment> onVoid;
  final String busyKey;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    String named(String id) {
      final n = staffNames[id] ?? '';
      return n.isEmpty ? '—' : n;
    }

    const muted = TextStyle(fontSize: 12, color: AppColors.muted);
    final withCash = businessOwesWithCash(
      summary.businessOwes,
      cashState == OwesCashState.ready ? balances : null,
    );
    const amountStyle = TextStyle(
      fontSize: 13,
      fontWeight: FontWeight.w700,
      fontFeatures: [FontFeature.tabularFigures()],
      color: AppColors.ink,
    );
    return Container(
      key: const Key('month-end-business-owes'),
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
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
                child: Text(
                  l10n.pmeBusinessOwes,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  if (withCash.owedNowCents > 0)
                    Text(
                      parkingMoney(withCash.owedNowCents),
                      key: const Key('month-end-owes-total'),
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        fontFeatures: [FontFeature.tabularFigures()],
                        color: AppColors.ink,
                      ),
                    ),
                  if (withCash.holdsCents > 0)
                    Text(
                      l10n.pmeOwesStaffHold(parkingMoney(withCash.holdsCents)),
                      key: const Key('month-end-owes-staff-hold'),
                      style: muted,
                    ),
                ],
              ),
            ],
          ),
          Text(l10n.pmeBusinessOwesHint, style: muted),
          if (cashState != OwesCashState.none &&
              summary.businessOwes.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                switch (cashState) {
                  OwesCashState.loading => l10n.pmeOwesCashChecking,
                  OwesCashState.failed => l10n.pmeOwesCashFailed,
                  _ => l10n.pmeOwesCashAsOf,
                },
                key: const Key('month-end-owes-cash-status'),
                style: muted,
              ),
            ),
          const Divider(height: 16),
          if (summary.businessOwes.isEmpty)
            Text(l10n.pmeBusinessOwesNone, style: muted),
          for (final cash in withCash.lines)
            Padding(
              key: Key('month-end-owes-${cash.line.staffId}'),
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          cash.line.staffName.isEmpty
                              ? '—'
                              : cash.line.staffName,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: AppColors.ink,
                          ),
                        ),
                        Text(
                          cash.line.customerKey.isEmpty
                              ? l10n.pmeNoParkingBill
                              : (cash.line.customerName.isEmpty
                                    ? '—'
                                    : cash.line.customerName),
                          style: muted,
                        ),
                        if (cash.known)
                          Text(
                            l10n.pmeOwesCashLine(
                              parkingMoney(cash.expenseOwedCents),
                              parkingMoney(cash.heldCents),
                            ),
                            key: Key('month-end-owes-cash-${cash.line.staffId}'),
                            style: muted,
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        parkingMoney(
                          cash.holdsCents > 0
                              ? cash.holdsCents
                              : cash.owedNowCents,
                        ),
                        style: amountStyle,
                      ),
                      Text(
                        cash.holdsCents > 0
                            ? l10n.pmeOwesHolds
                            : (cash.owedNowCents > 0
                                  ? l10n.pmeOwesOwed
                                  : l10n.pmeOwesSettledUp),
                        key: Key('month-end-owes-kind-${cash.line.staffId}'),
                        style: muted,
                      ),
                      if (onPaidBack != null && cash.canPayBack)
                        TextButton(
                          key: Key('month-end-paid-back-${cash.line.staffId}'),
                          style: TextButton.styleFrom(
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                            minimumSize: const Size(0, 32),
                            foregroundColor: AppColors.cobalt,
                          ),
                          onPressed: busyKey.isNotEmpty
                              ? null
                              : () => onPaidBack!(cash.line),
                          child: Text(l10n.pmePaidBack),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          if (repayments.isNotEmpty) ...[
            const Divider(height: 16),
            Text(
              l10n.pmeRepaymentsThisMonth.toUpperCase(),
              style: const TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.5,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 4),
            for (final r in repayments)
              Padding(
                key: Key('month-end-repayment-${r.id}'),
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        [
                          named(r.staffId),
                          if (r.paidAt != null)
                            displayDate(r.paidAt!, dateLocaleOf(context)),
                          _methodLabel(l10n, r.method),
                          if (r.givenByStaffId.isNotEmpty)
                            l10n.pmeGivenByName(named(r.givenByStaffId)),
                        ].join(' · '),
                        style: muted,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    // Amount over its Void, so a long French label never
                    // squeezes the row.
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          parkingMoney(r.amountCents),
                          style: const TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            fontFeatures: [FontFeature.tabularFigures()],
                            color: AppColors.ink,
                          ),
                        ),
                        busyKey == 'void:${r.id}'
                            ? const Padding(
                                padding: EdgeInsets.all(8),
                                child: SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                ),
                              )
                            : TextButton(
                                key: Key('month-end-void-${r.id}'),
                                style: TextButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                  ),
                                  minimumSize: const Size(0, 32),
                                  foregroundColor: AppColors.errorRed,
                                ),
                                onPressed: busyKey.isNotEmpty
                                    ? null
                                    : () => onVoid(r),
                                child: Text(l10n.lotVoid),
                              ),
                      ],
                    ),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}

/// "Paid back": the money given back to a staff member for their expenses -
/// at most what the business owes them as shown, how, who gave it (the
/// signed-in person by default) and a note - through
/// `updateLotExpenseEntry({action: "record_staff_repayment"})`.
class StaffRepaymentSheet extends StatefulWidget {
  const StaffRepaymentSheet({
    super.key,
    required this.businessId,
    required this.owed,
    required this.staff,
    required this.currentUid,
    this.service = const StaffExpenseRepaymentService(),
    this.prefillCents,
  });

  final String businessId;
  final ParkingMonthStaffOwed owed;

  /// What the amount starts as (what the business really owes now, after the
  /// cash they hold); the cap stays [owed]. Null: all of it.
  final int? prefillCents;
  final List<({String id, String name})> staff;
  final String currentUid;
  final StaffExpenseRepaymentService service;

  @override
  State<StaffRepaymentSheet> createState() => _StaffRepaymentSheetState();
}

class _StaffRepaymentSheetState extends State<StaffRepaymentSheet> {
  late final _amount = TextEditingController(
    text: ((widget.prefillCents ?? widget.owed.owedCents) / 100)
        .toStringAsFixed(2),
  );
  final _note = TextEditingController();
  String _method = 'cash';
  late String _by = widget.currentUid;
  bool _busy = false;
  String _error = '';
  bool _amountWrong = false;

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  String _byName(AppLocalizations l10n) {
    if (_by.isEmpty) return '';
    final name = widget.staff.where((s) => s.id == _by).firstOrNull?.name;
    if (name != null && name.isNotEmpty) return name;
    return _by == widget.currentUid ? l10n.you : '—';
  }

  Future<void> _pickMethod() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.invPayMethod,
      selected: _method,
      options: [
        for (final m in staffRepaymentMethods) LotOption(m, _methodLabel(l10n, m)),
      ],
    );
    if (picked != null && mounted) setState(() => _method = picked);
  }

  Future<void> _pickBy() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.pmePaidBackGivenBy,
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

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    final cents = lotDollarsToCents(_amount.text) ?? 0;
    final owed = widget.owed.owedCents;
    if (cents <= 0 || cents > owed) {
      AppHaptics.refuse();
      setState(() {
        _amountWrong = true;
        _error = l10n.pmePaidBackAmountInvalid(parkingMoney(owed));
      });
      return;
    }
    if (_by.isEmpty) {
      AppHaptics.refuse();
      setState(() => _error = l10n.pmePaidBackSayWho);
      return;
    }
    setState(() {
      _busy = true;
      _error = '';
      _amountWrong = false;
    });
    try {
      await widget.service.record(
        businessId: widget.businessId,
        staffId: widget.owed.staffId,
        amountCents: cents,
        method: _method,
        givenByStaffId: _by,
        note: _note.text,
      );
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(true);
      showSuccessSnackBar(context, l10n.pmePaidBackDone(parkingMoney(cents)));
    } on StaffRepaymentFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = staffRepaymentRefusalText(l10n, failure));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final owed = parkingMoney(widget.owed.owedCents);
    final name = widget.owed.staffName.isEmpty ? '—' : widget.owed.staffName;
    final cents = lotDollarsToCents(_amount.text) ?? 0;
    return LotSheetShell(
      title: l10n.pmePaidBack,
      subtitle: l10n.pmePaidBackSubtitle(name, owed),
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_error.isNotEmpty) ...[
            Text(
              _error,
              key: const Key('month-end-paid-back-error'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('month-end-paid-back-save'),
            label: l10n.pmeRecordTotal(parkingMoney(cents)),
            busy: _busy,
            tone: LotTone.good,
            onTap: _save,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.pmePaidBackHint,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('month-end-paid-back-amount'),
            controller: _amount,
            enabled: !_busy,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() => _amountWrong = false),
            decoration: InputDecoration(
              labelText: l10n.pmePaidBackAmount,
              prefixText: r'$ ',
              errorText: _amountWrong
                  ? l10n.pmePaidBackAmountInvalid(owed)
                  : null,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            label: l10n.invPayMethod,
            value: _methodLabel(l10n, _method),
            placeholder: l10n.invPayMethod,
            onTap: _busy ? () {} : _pickMethod,
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            key: const Key('month-end-paid-back-by'),
            label: l10n.pmePaidBackGivenBy,
            value: _byName(l10n).isEmpty ? null : _byName(l10n),
            placeholder: l10n.pmePaidBackWho,
            onTap: _busy ? () {} : _pickBy,
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
      options: receivedByOptions(l10n, [
        for (final s in widget.staff) LotOption(s.id, s.name),
      ]),
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
    final byName = _by.isEmpty
        ? null
        : receivedByName(
            l10n,
            _by,
            widget.staff.where((s) => s.id == _by).firstOrNull?.name ?? '',
          );
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
