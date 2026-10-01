import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../l10n/app_localizations.dart';
import '../models/parked_car.dart';
import '../services/parking_month_statement.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/parking_month_pdf.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/lot_sheets.dart';
import 'parked_car_details_screen.dart';

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
  Map<String, dynamic> _business = const {};
  bool _loading = true;
  bool _showAll = false;
  String _busy = '';

  @override
  void initState() {
    super.initState();
    _subs.add(_db
        .collection('parkedCars')
        .where('businessId', isEqualTo: widget.businessId)
        .snapshots()
        .listen((snap) {
      if (!mounted) return;
      setState(() {
        _docs = snap.docs;
        _loading = false;
      });
    }, onError: (_) {
      if (mounted) setState(() => _loading = false);
    }));
    _subs.add(_db.collection('businesses').doc(widget.businessId).snapshots().listen(
      (doc) {
        if (mounted) setState(() => _business = doc.data() ?? const {});
      },
      onError: (_) {},
    ));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
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
      await shareParkingMonthPdf(bytes,
          parkingMonthFileName('parking-month-end', _monthKey, '', _businessName));
    });
  }

  Future<void> _billActions(ParkingMonthBill bill) async {
    final l10n = AppLocalizations.of(context)!;
    final locale = Localizations.localeOf(context).toLanguageTag();
    final action = await pickLotOption<String>(
      context,
      title: bill.customerName.isEmpty ? bill.vehicle : bill.customerName,
      options: [
        LotOption('pdf', l10n.pmeSharePdf),
        LotOption('text', l10n.pmeSendText),
        LotOption('open', l10n.pmeOpenCar),
      ],
    );
    if (action == null || !mounted) return;
    switch (action) {
      case 'pdf':
        await _run(bill.id, () async {
          final bytes = await buildParkingMonthBillPdf(
            business: {..._business, 'name': _businessName},
            bill: bill,
            copy: _copy(l10n, locale),
          );
          await shareParkingMonthPdf(bytes,
              parkingMonthFileName('parking-bill', _monthKey, bill.customerName, _businessName));
        });
      case 'text':
        await SharePlus.instance
            .share(ShareParams(text: parkingMonthBillText(bill, _businessName)));
      case 'open':
        final doc = _docs.where((d) => d.id == bill.id).firstOrNull;
        if (doc == null) return;
        await Navigator.of(context).push(MaterialPageRoute<void>(
          builder: (_) =>
              ParkedCarDetailsScreen(parkedCar: ParkedCar.fromFirestore(doc)),
        ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = Localizations.localeOf(context).toLanguageTag();
    final summary = parkingMonthSummary(
      [for (final d in _docs) {...?d.data(), 'id': d.id}],
      _monthKey,
    );
    final thisMonth = shiftParkingMonthKey(previousParkingMonthKey(), 1);
    final listed = _showAll
        ? ([...summary.bills]..sort((a, b) => b.dueCents.compareTo(a.dueCents)))
        : summary.owing;

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
                padding: const EdgeInsets.fromLTRB(4, 4, AppSpacing.lg, AppSpacing.md),
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
                                  child: CircularProgressIndicator(strokeWidth: 2),
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
                          onPressed: () => setState(
                              () => _monthKey = shiftParkingMonthKey(_monthKey, -1)),
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
                              : () => setState(
                                  () => _monthKey = shiftParkingMonthKey(_monthKey, 1)),
                          icon: const Icon(Icons.chevron_right),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    Row(children: [
                      _Stat(label: l10n.pmeCarsOnLot, value: '${summary.carsOnLot}'),
                      const SizedBox(width: AppSpacing.sm),
                      _Stat(label: l10n.pmeBilled, value: parkingMoney(summary.billedCents)),
                    ]),
                    const SizedBox(height: AppSpacing.sm),
                    Row(children: [
                      _Stat(
                          label: l10n.pmeCollected,
                          value: parkingMoney(summary.collectedCents),
                          tone: AppColors.sage),
                      const SizedBox(width: AppSpacing.sm),
                      _Stat(
                          label: l10n.pmeStillOwed,
                          value: parkingMoney(summary.dueCents),
                          tone: summary.dueCents > 0 ? AppColors.warn : null),
                    ]),
                    const SizedBox(height: AppSpacing.md),
                    Row(children: [
                      Expanded(
                        child: _Tab(
                          label: l10n.pmeWhoOwesCount(summary.carsOwing),
                          selected: !_showAll,
                          onTap: () => setState(() => _showAll = false),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      Expanded(
                        child: _Tab(
                          label: l10n.pmeEveryCarCount(summary.carsOnLot),
                          selected: _showAll,
                          onTap: () => setState(() => _showAll = true),
                        ),
                      ),
                    ]),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : listed.isEmpty
                    ? LotEmptyState(
                        icon: Icons.event_available_outlined,
                        title: summary.carsOnLot == 0
                            ? l10n.pmeNoCars
                            : l10n.pmeNobodyOwes,
                      )
                    : ListView.builder(
                        key: const Key('month-end-list'),
                        padding: const EdgeInsets.fromLTRB(
                            AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 40),
                        itemCount: listed.length,
                        itemBuilder: (_, i) => _BillTile(
                          bill: listed[i],
                          busy: _busy == listed[i].id,
                          onTap: () => _billActions(listed[i]),
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}

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
            horizontal: AppSpacing.md, vertical: AppSpacing.sm),
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
  const _Tab({required this.label, required this.selected, required this.onTap});

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
          border: Border.all(color: selected ? AppColors.cobalt : AppColors.rule),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: selected ? Colors.white : AppColors.muted,
          ),
        ),
      ),
    );
  }
}

class _BillTile extends StatelessWidget {
  const _BillTile({required this.bill, required this.busy, required this.onTap});

  final ParkingMonthBill bill;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final owes = bill.dueCents > 0;
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
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    bill.customerName.isEmpty ? '—' : bill.customerName,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    [
                      bill.vehicle,
                      bill.stillParked ? l10n.pmeStillParked : l10n.pmeLeft,
                    ].where((p) => p.isNotEmpty).join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    [
                      '${l10n.pmeParkingLine(bill.days, parkingMoney(bill.dayRateCents))}'
                          ' = ${parkingMoney(bill.monthCents)}',
                      if (bill.priorUnpaidCents > 0)
                        '+ ${parkingMoney(bill.priorUnpaidCents)} ${l10n.pmeFromBefore.toLowerCase()}',
                    ].join(' · '),
                    style: const TextStyle(fontSize: 12, color: AppColors.muted),
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            if (busy)
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            else
              Text(
                owes ? parkingMoney(bill.dueCents) : l10n.invStatusPaid,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  fontFeatures: const [FontFeature.tabularFigures()],
                  color: owes ? AppColors.warn : AppColors.sage,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
