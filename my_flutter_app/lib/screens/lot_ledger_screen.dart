import 'dart:async';
import 'dart:ui' show FontFeature, ImageFilter;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_storage/firebase_storage.dart' as storage;
import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart' hide TextDirection;
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../services/lot_customers.dart';
import '../services/lot_ledger.dart';
import '../services/vin_decoder_service.dart';
import '../utils/vin_utils.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import 'vin_scanner_screen.dart';

/// The lot ledger, yard-side.
///
/// Staff standing next to a car read what the lot earned and spent this month,
/// record what was just done, and log a purchase — without opening the web
/// console. The money shown here is computed by [LotLedgerMath] from the same
/// documents the lists show, so a tile and the rows under it can never
/// disagree, and the write flows call the same authority callables the console
/// does (`createLotActivity`, `createLotExpenseEntry`, and the rest).
///
/// The screen answers the four wayfinding questions on sight: where you are
/// (title and business), where you can go (three segments), what is here (the
/// month's money above the list it comes from), and how to leave (back, top
/// left, where it always is).
class LotLedgerScreen extends StatefulWidget {
  const LotLedgerScreen({super.key, required this.businessId});

  final String businessId;

  @override
  State<LotLedgerScreen> createState() => _LotLedgerScreenState();
}

class _LotLedgerScreenState extends State<LotLedgerScreen> {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  final List<StreamSubscription<Object?>> _subs = [];

  List<LotActivityType> _types = const [];
  List<LotActivity> _activities = const [];
  List<LotExpenseLine> _lines = const [];
  List<LotExpenseEntry> _entries = const [];
  List<LotStaff> _staff = const [];
  List<LotCustomer> _customers = const [];
  List<LotKnownCar> _parkedCars = const [];

  String _businessName = '';
  int _proofThresholdCents = lotDefaultProofThresholdCents;

  int _segment = 0;
  int _direction = 1;
  late String _month = lotMonthKey(DateTime.now());
  String _typeFilter = 'all';
  String _search = '';
  bool _loading = true;

  LotLedgerMath get _math => LotLedgerMath(
        activities: _activities,
        lines: _lines,
        entries: _entries,
      );

  /// Every vehicle this business has on file: parked cars first, then whatever
  /// a past activity recorded, then the customer memory. Typing a VIN it
  /// recognises should never leave staff re-typing the car.
  List<LotKnownCar> get _knownCars => [
        ..._parkedCars,
        for (final a in _activities)
          LotKnownCar(
            vin: a.vinNumber,
            make: a.carMake,
            model: a.carModel,
            year: a.carYear,
            customerName: a.customerName,
            customerPhone: a.customerPhone,
          ),
        for (final c in _customers)
          for (final car in c.cars)
            LotKnownCar(
              vin: car.vin.toUpperCase(),
              make: car.make,
              model: car.model,
              year: car.year,
              customerName: c.name,
              customerPhone: c.phone,
            ),
      ];

  @override
  void initState() {
    super.initState();
    _listen();
  }

  void _listen() {
    final id = widget.businessId;
    Query<Map<String, dynamic>> scoped(String path) =>
        _db.collection(path).where('businessId', isEqualTo: id);

    _subs.add(scoped('lotActivityTypes').snapshots().listen((snap) {
      if (!mounted) return;
      final list = [
        for (final d in snap.docs) LotActivityType.fromMap(d.id, d.data()),
      ]..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      setState(() => _types = list.where((t) => t.active).toList());
    }));

    _subs.add(scoped('lotActivities')
        .orderBy('activityDate', descending: true)
        .limit(500)
        .snapshots()
        .listen((snap) {
      if (!mounted) return;
      setState(() {
        _activities = [
          for (final d in snap.docs) LotActivity.fromMap(d.id, d.data()),
        ];
        _loading = false;
      });
    }, onError: (_) {
      if (mounted) setState(() => _loading = false);
    }));

    _subs.add(scoped('lotExpenseLines').snapshots().listen((snap) {
      if (!mounted) return;
      final list = [
        for (final d in snap.docs) LotExpenseLine.fromMap(d.id, d.data()),
      ]..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      setState(() => _lines = list.where((l) => l.active).toList());
    }));

    _subs.add(scoped('lotExpenseEntries').limit(2000).snapshots().listen((snap) {
      if (!mounted) return;
      setState(() => _entries = [
            for (final d in snap.docs) LotExpenseEntry.fromMap(d.id, d.data()),
          ]);
    }));

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
    }));

    _subs.add(scoped('parkedCars').limit(500).snapshots().listen((snap) {
      if (!mounted) return;
      setState(() => _parkedCars = [
            for (final d in snap.docs) LotKnownCar.fromMap(d.data()),
          ]);
    }, onError: (_) {}));

    _subs.add(_db.collection('businesses').doc(id).snapshots().listen((doc) {
      if (!mounted) return;
      final data = doc.data() ?? const <String, dynamic>{};
      final threshold = data['expenseProofThresholdCents'];
      setState(() {
        _businessName = (data['name'] ?? data['businessName'] ?? '').toString();
        _proofThresholdCents = threshold is num
            ? threshold.round()
            : lotDefaultProofThresholdCents;
      });
    }));

    // The lot's customer memory is a one-shot read: it seeds the customer
    // picker, and a new customer written by a record refreshes it.
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
      // No memory yet, or no permission to read it: every form still works by
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

  void _goToSegment(int next) {
    if (next == _segment) return;
    AppHaptics.selection();
    setState(() {
      _direction = next > _segment ? 1 : -1;
      _segment = next;
    });
  }

  void _shiftMonth(int delta) {
    AppHaptics.selection();
    setState(() {
      _direction = delta;
      _month = lotShiftMonth(_month, delta);
    });
  }

  String _monthLabel(String key) =>
      DateFormat.yMMMM(Localizations.localeOf(context).toLanguageTag())
          .format(lotMonthStart(key));

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final math = _math;

    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          _LedgerHeader(
            businessName: _businessName,
            monthLabel: _monthLabel(_month),
            onPreviousMonth: () => _shiftMonth(-1),
            onNextMonth: () => _shiftMonth(1),
            revenueCents: math.monthRevenueCents(_month),
            expenseCents: math.monthExpenseCents(_month),
            netCents: math.monthNetCents(_month),
            awaitingCents: math.monthAwaitingCents(_month),
            segment: _segment,
            onSegment: _goToSegment,
            labels: [l10n.lotTabActivity, l10n.lotTabExpenses, l10n.lotTabReports],
          ),
          Expanded(
            child: AnimatedSwitcher(
              duration: AppMotion.swapFor(context),
              switchInCurve: AppMotion.standard,
              switchOutCurve: AppMotion.standardReverse,
              layoutBuilder: (current, previous) => Stack(
                alignment: Alignment.topCenter,
                children: [...previous, ?current],
              ),
              transitionBuilder: (child, animation) {
                if (AppMotion.reduced(context)) {
                  return FadeTransition(opacity: animation, child: child);
                }
                // The panel leaves the way it came: a segment to the right
                // enters from the right and, on the way back, exits to it.
                final incoming =
                    (child.key as ValueKey<int>?)?.value == _segment;
                final sign = incoming ? _direction : -_direction;
                return FadeTransition(
                  opacity: animation,
                  child: SlideTransition(
                    position: Tween<Offset>(
                      begin: Offset(0.06 * sign, 0),
                      end: Offset.zero,
                    ).animate(animation),
                    child: child,
                  ),
                );
              },
              child: KeyedSubtree(
                key: ValueKey<int>(_segment),
                child: _segmentBody(math),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _segmentBody(LotLedgerMath math) {
    switch (_segment) {
      case 1:
        return _ExpensesPanel(
          businessId: widget.businessId,
          month: _month,
          monthLabel: _monthLabel(_month),
          math: math,
          lines: _lines,
          staff: _staff,
          proofThresholdCents: _proofThresholdCents,
        );
      case 2:
        return _ReportsPanel(
          math: math,
          month: _month,
          onPickMonth: (m) {
            AppHaptics.selection();
            setState(() => _month = m);
          },
          monthLabel: _monthLabel,
        );
      default:
        return _ActivityPanel(
          businessId: widget.businessId,
          knownCars: _knownCars,
          loading: _loading,
          month: _month,
          monthLabel: _monthLabel(_month),
          activities: _activities,
          types: _types,
          staff: _staff,
          customers: _customers,
          typeFilter: _typeFilter,
          search: _search,
          onTypeFilter: (v) => setState(() => _typeFilter = v),
          onSearch: (v) => setState(() => _search = v),
          onRecorded: _loadCustomers,
        );
    }
  }
}

/// A staff member, as the pickers need them.
class LotStaff {
  const LotStaff({required this.id, required this.name});

  final String id;
  final String name;
}

// ---------------------------------------------------------------------------
// Header: identity, the month, the money, and the three ways in.
// ---------------------------------------------------------------------------

class _LedgerHeader extends StatelessWidget {
  const _LedgerHeader({
    required this.businessName,
    required this.monthLabel,
    required this.onPreviousMonth,
    required this.onNextMonth,
    required this.revenueCents,
    required this.expenseCents,
    required this.netCents,
    required this.awaitingCents,
    required this.segment,
    required this.onSegment,
    required this.labels,
  });

  final String businessName;
  final String monthLabel;
  final VoidCallback onPreviousMonth;
  final VoidCallback onNextMonth;
  final int revenueCents;
  final int expenseCents;
  final int netCents;
  final int awaitingCents;
  final int segment;
  final ValueChanged<int> onSegment;
  final List<String> labels;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      decoration: const BoxDecoration(color: AppColors.paper),
      child: SafeArea(
        bottom: false,
        child: Column(
          children: [
            // Where am I, and how do I get out — the back button keeps the
            // place it holds on every other screen.
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
                          l10n.lotLedgerTitle,
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
            _MonthStepper(
              label: monthLabel,
              onPrevious: onPreviousMonth,
              onNext: onNextMonth,
            ),
            const SizedBox(height: AppSpacing.md),
            Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: Row(
                children: [
                  Expanded(
                    child: _MoneyTile(
                      label: l10n.lotRevenue,
                      cents: revenueCents,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: _MoneyTile(
                      label: l10n.lotExpensesLabel,
                      cents: expenseCents,
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: _MoneyTile(
                      label: l10n.lotNet,
                      cents: netCents,
                      tone: netCents < 0 ? _Tone.warn : _Tone.good,
                    ),
                  ),
                ],
              ),
            ),
            // Status, and only when there is status to report.
            AnimatedSize(
              duration: AppMotion.swapFor(context),
              curve: AppMotion.standard,
              child: awaitingCents <= 0
                  ? const SizedBox(width: double.infinity)
                  : Padding(
                      padding: const EdgeInsets.fromLTRB(
                          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 0),
                      child: _AwaitingBanner(
                        title: l10n
                            .lotAwaitingPaymentBanner(formatLotCents(awaitingCents)),
                        note: l10n.lotAwaitingPaymentNote,
                      ),
                    ),
            ),
            const SizedBox(height: AppSpacing.lg),
            Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: _Segmented(
                labels: labels,
                index: segment,
                onChanged: onSegment,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            // A soft edge where content meets the chrome, rather than a hard
            // rule drawn across the screen.
            Container(
              height: 8,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    AppColors.ink.withValues(alpha: 0.05),
                    AppColors.ink.withValues(alpha: 0),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MonthStepper extends StatelessWidget {
  const _MonthStepper({
    required this.label,
    required this.onPrevious,
    required this.onNext,
  });

  final String label;
  final VoidCallback onPrevious;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _StepArrow(
          icon: Icons.chevron_left,
          semanticLabel: l10n.lotPreviousMonth,
          onTap: onPrevious,
        ),
        SizedBox(
          width: 190,
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.2,
              color: AppColors.ink,
            ),
          ),
        ),
        _StepArrow(
          icon: Icons.chevron_right,
          semanticLabel: l10n.lotNextMonth,
          onTap: onNext,
        ),
      ],
    );
  }
}

class _StepArrow extends StatelessWidget {
  const _StepArrow({
    required this.icon,
    required this.semanticLabel,
    required this.onTap,
  });

  final IconData icon;
  final String semanticLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticLabel,
      child: PressableScale(
        onTap: onTap,
        scale: 0.9,
        // A generous target around a small glyph: the arrow is 20px, the
        // reachable area is 44.
        child: SizedBox(
          width: 44,
          height: 44,
          child: Center(
            child: Icon(icon, size: 22, color: AppColors.cobaltDeep),
          ),
        ),
      ),
    );
  }
}

enum _Tone { neutral, good, warn }

class _MoneyTile extends StatelessWidget {
  const _MoneyTile({
    required this.label,
    required this.cents,
    this.tone = _Tone.neutral,
  });

  final String label;
  final int cents;
  final _Tone tone;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      _Tone.good => AppColors.sage,
      _Tone.warn => AppColors.errorRed,
      _Tone.neutral => AppColors.ink,
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.md,
      ),
      decoration: BoxDecoration(
        color: AppColors.parchment,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
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
              fontSize: 10,
              fontWeight: FontWeight.w700,
              // Small text reads better with a touch more air between letters.
              letterSpacing: 0.6,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: 4),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              formatLotCents(cents),
              style: TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.w800,
                height: 1.05,
                // Large text needs the letters pulled back together.
                letterSpacing: -0.6,
                color: color,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AwaitingBanner extends StatelessWidget {
  const _AwaitingBanner({required this.title, required this.note});

  final String title;
  final String note;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: AppColors.saffron.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.saffron.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          const Icon(Icons.schedule, size: 16, color: AppColors.warn),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                Text(
                  note,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.muted,
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

/// A segmented control whose thumb is driven by a spring rather than a fixed
/// curve: a tap mid-flight re-targets from where the thumb actually is, at the
/// speed it is already moving, instead of restarting from the logical value.
class _Segmented extends StatefulWidget {
  const _Segmented({
    required this.labels,
    required this.index,
    required this.onChanged,
  });

  final List<String> labels;
  final int index;
  final ValueChanged<int> onChanged;

  @override
  State<_Segmented> createState() => _SegmentedState();
}

class _SegmentedState extends State<_Segmented>
    with SingleTickerProviderStateMixin {
  late final AnimationController _thumb = AnimationController.unbounded(
    vsync: this,
    value: widget.index.toDouble(),
  );

  @override
  void didUpdateWidget(covariant _Segmented old) {
    super.didUpdateWidget(old);
    if (old.index == widget.index) return;
    final target = widget.index.toDouble();
    if (AppMotion.reduced(context)) {
      _thumb.value = target;
      return;
    }
    _thumb.animateWith(
      SpringSimulation(
        AppMotion.move,
        _thumb.value,
        target,
        // Carrying the current velocity through the re-target is what keeps a
        // reversal from hitting a brick wall.
        _thumb.velocity,
      ),
    );
  }

  @override
  void dispose() {
    _thumb.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final count = widget.labels.length;
    return Container(
      height: 40,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: AppColors.parchment,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final slot = constraints.maxWidth / count;
          return Stack(
            children: [
              AnimatedBuilder(
                animation: _thumb,
                builder: (context, _) {
                  return Positioned(
                    left: (_thumb.value.clamp(0, count - 1)) * slot,
                    top: 0,
                    bottom: 0,
                    width: slot,
                    child: Container(
                      decoration: BoxDecoration(
                        color: AppColors.paper,
                        borderRadius:
                            BorderRadius.circular(AppSpacing.radiusSm),
                        boxShadow: [
                          BoxShadow(
                            color: AppColors.ink.withValues(alpha: 0.08),
                            blurRadius: 6,
                            offset: const Offset(0, 1),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
              Row(
                children: [
                  for (var i = 0; i < count; i++)
                    Expanded(
                      child: PressableScale(
                        scale: 0.94,
                        onTap: () => widget.onChanged(i),
                        child: Center(
                          child: AnimatedDefaultTextStyle(
                            duration: AppMotion.press,
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: i == widget.index
                                  ? FontWeight.w700
                                  : FontWeight.w600,
                              color: i == widget.index
                                  ? AppColors.cobaltDeep
                                  : AppColors.muted,
                            ),
                            child: Text(widget.labels[i]),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Shared pieces.
// ---------------------------------------------------------------------------

/// The one action a panel exists for, parked where the thumb is, on a
/// translucent layer the list scrolls under rather than an opaque strip that
/// eats the bottom of the screen.
class _PrimaryBar extends StatelessWidget {
  const _PrimaryBar({required this.label, required this.icon, required this.onTap});

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.paper.withValues(alpha: 0.78),
            border: Border(
              top: BorderSide(color: AppColors.rule.withValues(alpha: 0.8)),
            ),
          ),
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.md),
          child: SafeArea(
            top: false,
            child: PressableScale(
              onTap: onTap,
              child: Container(
                height: 50,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.cobalt,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(icon, size: 18, color: Colors.white),
                    const SizedBox(width: AppSpacing.sm),
                    Text(
                      label,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.1,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.icon, required this.title, this.hint});

  final IconData icon;
  final String title;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.xl, vertical: 48),
      child: Column(
        children: [
          Icon(icon, size: 30, color: AppColors.muted.withValues(alpha: 0.55)),
          const SizedBox(height: AppSpacing.md),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          if (hint != null) ...[
            const SizedBox(height: 6),
            Text(
              hint!,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 13,
                height: 1.4,
                color: AppColors.muted,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// How the money reads, read off the money itself rather than off a colour
/// someone set by hand.
class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.activity});

  final LotActivity activity;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    late final String label;
    late final Color color;
    if (activity.voided) {
      label = l10n.lotVoidedStatus;
      color = AppColors.muted;
    } else if (activity.cancelled) {
      label = l10n.lotCancelledStatus;
      color = AppColors.muted;
    } else if (activity.awaitingLink) {
      label = l10n.lotAwaitingShort;
      color = AppColors.warn;
    } else if (activity.paid && activity.paymentMethod == lotPaymentMethodLink) {
      label = l10n.lotPaidOnPlatform;
      color = AppColors.sage;
    } else if (activity.paid) {
      label = l10n.lotPaidOutsideShort;
      color = AppColors.cobalt;
    } else {
      label = l10n.lotAwaitingShort;
      color = AppColors.warn;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        label,
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

String _lotErrorText(AppLocalizations l10n, String code, int thresholdCents) {
  return switch (code) {
    'activity_type_invalid' => l10n.lotErrActivityType,
    'custom_label_required' => l10n.lotErrCustomLabel,
    'fee_required' => l10n.lotErrFee,
    'customer_name_required' => l10n.lotErrCustomerName,
    'vin_required' => l10n.lotErrVin,
    'payment_link_contact_required' => l10n.lotErrLinkContact,
    'received_by_required' => l10n.lotErrReceivedBy,
    'expense_amount_required' => l10n.lotErrExpenseAmount,
    'expense_paid_by_required' => l10n.lotErrExpensePaidBy,
    'expense_proof_required' =>
      l10n.lotErrExpenseProof(formatLotCents(thresholdCents)),
    _ => l10n.lotCouldNotSave,
  };
}

String _receivedViaLabel(AppLocalizations l10n, String value) {
  return switch (value) {
    'cash' => l10n.lotViaCash,
    'zelle' => l10n.lotViaZelle,
    'cashapp' => l10n.lotViaCashApp,
    'venmo' => l10n.lotViaVenmo,
    'check' => l10n.lotViaCheck,
    'card_in_person' => l10n.lotViaCardInPerson,
    _ => l10n.lotViaOther,
  };
}

/// Sheets arrive from the bottom and leave the same way, over a scrim that
/// dims what they interrupt.
Future<T?> showLotSheet<T>(BuildContext context, Widget child) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    backgroundColor: AppColors.paper,
    barrierColor: AppColors.ink.withValues(alpha: 0.32),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (sheetContext) => Padding(
      padding:
          EdgeInsets.only(bottom: MediaQuery.of(sheetContext).viewInsets.bottom),
      child: child,
    ),
  );
}

class _SheetShell extends StatelessWidget {
  const _SheetShell({
    required this.title,
    this.subtitle,
    required this.body,
    this.footer,
  });

  final String title;
  final String? subtitle;
  final Widget body;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.9,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w700,
                    height: 1.15,
                    letterSpacing: -0.4,
                    color: AppColors.ink,
                  ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    subtitle!,
                    style: const TextStyle(
                      fontSize: 13,
                      height: 1.4,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ],
            ),
          ),
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.lg),
              child: body,
            ),
          ),
          if (footer != null)
            Container(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.lg),
              decoration: BoxDecoration(
                color: AppColors.paper,
                border: Border(
                  top: BorderSide(color: AppColors.rule.withValues(alpha: 0.7)),
                ),
              ),
              child: SafeArea(top: false, child: footer!),
            ),
        ],
      ),
    );
  }
}

class _SheetButton extends StatelessWidget {
  const _SheetButton({
    required this.label,
    required this.onTap,
    this.busy = false,
    this.busyLabel,
    this.tone = _Tone.neutral,
  });

  final String label;
  final VoidCallback? onTap;
  final bool busy;
  final String? busyLabel;
  final _Tone tone;

  @override
  Widget build(BuildContext context) {
    final background = switch (tone) {
      _Tone.warn => AppColors.errorRed,
      _Tone.good => AppColors.cobalt,
      _Tone.neutral => AppColors.cobalt,
    };
    return PressableScale(
      onTap: busy ? null : onTap,
      child: Container(
        height: 50,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: busy ? background.withValues(alpha: 0.5) : background,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              busy ? (busyLabel ?? label) : label,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 15,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A field that opens a list instead of dropping a menu over the content.
/// The list is a sheet like every other choice in the app, so one pattern
/// covers picking an activity, a payment method, and a staff member.
class _PickerField extends StatelessWidget {
  const _PickerField({
    required this.label,
    required this.value,
    required this.placeholder,
    required this.onTap,
    this.error,
  });

  final String label;
  final String? value;
  final String placeholder;
  final VoidCallback onTap;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final filled = value != null && value!.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        PressableScale(
          onTap: onTap,
          scale: 0.99,
          child: Container(
            padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg, vertical: AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.parchment,
              borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              border: Border.all(
                color: error != null ? AppColors.errorRed : AppColors.rule,
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.2,
                          color: AppColors.muted,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        filled ? value! : placeholder,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: filled ? FontWeight.w600 : FontWeight.w400,
                          color: filled ? AppColors.ink : AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.unfold_more,
                    size: 18, color: AppColors.muted),
              ],
            ),
          ),
        ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(left: 4, top: 5),
            child: Text(
              error!,
              style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
            ),
          ),
      ],
    );
  }
}

class LotOption<T> {
  const LotOption(this.value, this.label, {this.detail});

  final T value;
  final String label;
  final String? detail;
}

Future<T?> _pickOption<T>(
  BuildContext context, {
  required String title,
  required List<LotOption<T>> options,
  T? selected,
}) {
  return showLotSheet<T>(
    context,
    _SheetShell(
      title: title,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final option in options)
            PressableScale(
              onTap: () => Navigator.of(context).pop(option.value),
              child: Container(
                margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.lg, vertical: AppSpacing.md),
                decoration: BoxDecoration(
                  color: option.value == selected
                      ? AppColors.mist
                      : AppColors.parchment,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                  border: Border.all(
                    color: option.value == selected
                        ? AppColors.cobalt
                        : AppColors.rule,
                  ),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            option.label,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              color: AppColors.ink,
                            ),
                          ),
                          if (option.detail != null)
                            Text(
                              option.detail!,
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.muted,
                              ),
                            ),
                        ],
                      ),
                    ),
                    if (option.value == selected)
                      const Icon(Icons.check, size: 18, color: AppColors.cobalt),
                  ],
                ),
              ),
            ),
        ],
      ),
    ),
  );
}

/// A choice with two long explanations reads better as two cards than as two
/// radio dots: the whole card is the target, and the reasoning sits with it.
class _ChoiceCard extends StatelessWidget {
  const _ChoiceCard({
    required this.title,
    required this.note,
    required this.selected,
    required this.onTap,
    this.enabled = true,
  });

  final String title;
  final String note;
  final bool selected;
  final VoidCallback onTap;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: enabled ? onTap : null,
      scale: 0.99,
      child: AnimatedContainer(
        duration: AppMotion.press,
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: selected ? AppColors.mist : AppColors.parchment,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          border: Border.all(
            color: selected ? AppColors.cobalt : AppColors.rule,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              selected ? Icons.radio_button_checked : Icons.radio_button_off,
              size: 18,
              color: selected ? AppColors.cobalt : AppColors.muted,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    note,
                    style: const TextStyle(
                      fontSize: 12,
                      height: 1.35,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Activity.
// ---------------------------------------------------------------------------

class _ActivityPanel extends StatelessWidget {
  const _ActivityPanel({
    required this.businessId,
    required this.knownCars,
    required this.loading,
    required this.month,
    required this.monthLabel,
    required this.activities,
    required this.types,
    required this.staff,
    required this.customers,
    required this.typeFilter,
    required this.search,
    required this.onTypeFilter,
    required this.onSearch,
    required this.onRecorded,
  });

  final String businessId;
  final List<LotKnownCar> knownCars;
  final bool loading;
  final String month;
  final String monthLabel;
  final List<LotActivity> activities;
  final List<LotActivityType> types;
  final List<LotStaff> staff;
  final List<LotCustomer> customers;
  final String typeFilter;
  final String search;
  final ValueChanged<String> onTypeFilter;
  final ValueChanged<String> onSearch;
  final VoidCallback onRecorded;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final rows = lotFilterActivities(
      activities,
      month: month,
      typeFilter: typeFilter,
      query: search,
    );

    return Stack(
      children: [
        ListView(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 120),
          children: [
            _SearchField(value: search, onChanged: onSearch),
            const SizedBox(height: AppSpacing.md),
            _FilterChips(
              types: types,
              selected: typeFilter,
              onChanged: onTypeFilter,
            ),
            const SizedBox(height: AppSpacing.md),
            if (loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 48),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (rows.isEmpty)
              _EmptyState(
                icon: search.trim().isEmpty
                    ? Icons.receipt_long_outlined
                    : Icons.search_off,
                title: search.trim().isEmpty
                    ? l10n.lotNoActivityForMonth(monthLabel)
                    : l10n.lotNoSearchMatch,
                hint: search.trim().isEmpty ? l10n.lotNoActivityHint : null,
              )
            else ...[
              Padding(
                padding: const EdgeInsets.only(left: 2, bottom: AppSpacing.sm),
                child: Text(
                  l10n.lotEntriesCount(rows.length),
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.3,
                    color: AppColors.muted,
                  ),
                ),
              ),
              for (final row in rows)
                _ActivityCard(
                  activity: row,
                  staff: staff,
                  onTap: () => showLotSheet(
                    context,
                    _ActivityDetailSheet(
                      activity: row,
                      staff: staff,
                      types: types,
                      customers: customers,
                      knownCars: knownCars,
                      businessId: businessId,
                      onChanged: onRecorded,
                    ),
                  ),
                ),
            ],
          ],
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: _PrimaryBar(
            label: l10n.lotRecordActivity,
            icon: Icons.add,
            onTap: () => showLotSheet(
              context,
              _ActivityFormSheet(
                businessId: businessId,
                types: types,
                staff: staff,
                customers: customers,
                knownCars: knownCars,
                onSaved: onRecorded,
              ),
            ),
          ),
        ),
      ],
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
      controller: _controller,
      onChanged: widget.onChanged,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: l10n.lotSearchHint,
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

class _FilterChips extends StatelessWidget {
  const _FilterChips({
    required this.types,
    required this.selected,
    required this.onChanged,
  });

  final List<LotActivityType> types;
  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final chips = <(String, String)>[
      ('all', l10n.lotFilterAll),
      for (final t in types) (t.id, t.label),
      (lotCustomActivityId, l10n.lotFilterOneOff),
    ];
    return SizedBox(
      height: 34,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: chips.length,
        separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.sm),
        itemBuilder: (context, i) {
          final (id, label) = chips[i];
          final active = id == selected;
          return PressableScale(
            scale: 0.94,
            onTap: () {
              AppHaptics.selection();
              onChanged(id);
            },
            child: AnimatedContainer(
              duration: AppMotion.press,
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              decoration: BoxDecoration(
                color: active ? AppColors.cobalt : AppColors.paper,
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                border: Border.all(
                    color: active ? AppColors.cobalt : AppColors.rule),
              ),
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: active ? Colors.white : AppColors.muted,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

class _ActivityCard extends StatelessWidget {
  const _ActivityCard({
    required this.activity,
    required this.staff,
    required this.onTap,
  });

  final LotActivity activity;
  final List<LotStaff> staff;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final voided = activity.voided;
    final strike = voided ? TextDecoration.lineThrough : null;
    final dateText = activity.activityDate == null
        ? ''
        : DateFormat.MMMd(Localizations.localeOf(context).toLanguageTag())
            .format(activity.activityDate!);

    return PressableScale(
      onTap: onTap,
      scale: 0.985,
      child: Opacity(
        opacity: voided ? 0.55 : 1,
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
                      activity.vehicleLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.2,
                        color: AppColors.ink,
                        decoration: strike,
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Text(
                    formatLotCents(activity.feeCents),
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.3,
                      color: AppColors.ink,
                      decoration: strike,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 3),
              Text(
                [activity.customerName, activity.label]
                    .where((p) => p.isNotEmpty)
                    .join(' · '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 13,
                  height: 1.35,
                  color: AppColors.muted,
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              Row(
                children: [
                  _StatusPill(activity: activity),
                  const Spacer(),
                  Text(
                    dateText,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Recording and editing an activity.
// ---------------------------------------------------------------------------

class _ActivityFormSheet extends StatefulWidget {
  const _ActivityFormSheet({
    required this.businessId,
    required this.types,
    required this.staff,
    required this.customers,
    required this.knownCars,
    required this.onSaved,
    this.existing,
  });

  final String businessId;
  final List<LotActivityType> types;
  final List<LotStaff> staff;
  final List<LotCustomer> customers;
  final List<LotKnownCar> knownCars;
  final VoidCallback onSaved;
  final LotActivity? existing;

  @override
  State<_ActivityFormSheet> createState() => _ActivityFormSheetState();
}

class _ActivityFormSheetState extends State<_ActivityFormSheet> {
  final _customLabel = TextEditingController();
  final _fee = TextEditingController();
  final _vin = TextEditingController();
  final _customer = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _make = TextEditingController();
  final _model = TextEditingController();
  final _year = TextEditingController();

  String? _typeId;
  String _auctionHouse = '';
  DateTime _date = DateTime.now();
  String _method = lotPaymentMethodLink;
  String _receivedVia = 'cash';
  String? _receivedBy;
  // Direct only: whether the money is already in hand. When false the activity
  // is logged as owed and asks for no one who received it.
  bool _paymentReceived = true;
  bool _busy = false;
  Set<String> _errors = {};
  List<LotCustomer> _suggestions = const [];

  final VinDecoderService _vinDecoder = NhtsaVinDecoderService();
  String _vinHint = '';
  bool _vinBusy = false;
  String _decodedVin = '';

  bool get _editing => widget.existing != null;

  /// A paid entry's money is settled: the server refuses a new amount or a new
  /// route, so the form does not offer them rather than letting someone type
  /// into a field that cannot be saved.
  bool get _locked => widget.existing?.paid ?? false;

  LotActivityType? get _type =>
      widget.types.where((t) => t.id == _typeId).firstOrNull;

  bool get _isCustom => _typeId == lotCustomActivityId;

  @override
  void initState() {
    super.initState();
    final existing = widget.existing;
    if (existing == null) return;
    _typeId = existing.activityTypeId;
    _customLabel.text = existing.customLabel;
    _fee.text = (existing.feeCents / 100).toStringAsFixed(2);
    _vin.text = existing.vinNumber;
    _customer.text = existing.customerName;
    _phone.text = existing.customerPhone;
    _email.text = existing.customerEmail;
    _make.text = existing.carMake;
    _model.text = existing.carModel;
    _year.text = existing.carYear;
    _auctionHouse = existing.auctionHouse;
    _date = existing.activityDate ?? DateTime.now();
    _method = existing.paymentMethod.isEmpty
        ? lotPaymentMethodLink
        : existing.paymentMethod;
    _receivedVia =
        existing.receivedVia.isEmpty ? 'cash' : existing.receivedVia;
    _receivedBy =
        existing.receivedByStaffId.isEmpty ? null : existing.receivedByStaffId;
    // A direct row still awaiting payment loads as not-yet-received, so the
    // form does not demand a staff member it never had.
    _paymentReceived = !existing.awaitingDirect;
  }

  @override
  void dispose() {
    for (final c in [
      _customLabel, _fee, _vin, _customer, _phone, _email, _make, _model, _year,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  void _clearError(String code) {
    if (!_errors.contains(code)) return;
    setState(() => _errors = {..._errors}..remove(code));
  }

  void _applyCustomer(LotCustomer c) {
    setState(() {
      _customer.text = c.name;
      if (c.phone.isNotEmpty) _phone.text = c.phone;
      if (c.email.isNotEmpty) _email.text = c.email;
      _suggestions = const [];
      if (c.cars.length == 1) {
        final car = c.cars.first;
        if (car.vin.isNotEmpty) _vin.text = car.vin;
        if (car.make.isNotEmpty) _make.text = car.make;
        if (car.model.isNotEmpty) _model.text = car.model;
        if (car.year.isNotEmpty) _year.text = car.year;
      }
    });
  }

  /// A VIN is the vehicle's identity, so typing one should end the typing.
  ///
  /// First the business's own records — a parked car, a past activity, a
  /// customer's saved car — because those also carry who owns it. Only when
  /// the yard has never seen the VIN does this fall back to decoding it.
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
      // A decode that fails leaves the three fields typeable, which is what
      // they were before; it is not worth an alarm.
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

  Future<void> _pickType() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await _pickOption<String>(
      context,
      title: l10n.lotWhatWasDone,
      selected: _typeId,
      options: [
        for (final t in widget.types)
          LotOption(t.id, t.label,
              detail: t.defaultFeeCents > 0
                  ? formatLotCents(t.defaultFeeCents)
                  : null),
        LotOption(lotCustomActivityId, l10n.lotOneOffOption),
      ],
    );
    if (picked == null || !mounted) return;
    setState(() {
      _typeId = picked;
      _errors = {..._errors}..remove('activity_type_invalid');
      final rate = widget.types.where((t) => t.id == picked).firstOrNull;
      if (rate != null && rate.defaultFeeCents > 0 && _fee.text.trim().isEmpty) {
        _fee.text = (rate.defaultFeeCents / 100).toStringAsFixed(2);
      }
    });
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (picked != null && mounted) setState(() => _date = picked);
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    final draft = LotActivityDraft(
      activityTypeId: _typeId ?? '',
      customLabel: _customLabel.text,
      feeCents: lotDollarsToCents(_fee.text),
      customerName: _customer.text,
      vinNumber: _vin.text,
      paymentMethod: _method,
      customerPhone: _phone.text,
      customerEmail: _email.text,
      receivedByStaffId: _receivedBy ?? '',
      paymentReceived: _paymentReceived,
    );
    final errors = validateLotActivityDraft(draft, lockedPayment: _locked);
    if (errors.isNotEmpty) {
      AppHaptics.refuse();
      setState(() => _errors = errors.toSet());
      return;
    }

    setState(() => _busy = true);
    final payload = <String, dynamic>{
      'businessId': widget.businessId,
      'activityTypeId': _typeId,
      'customLabel': _isCustom ? _customLabel.text.trim() : '',
      'feeCents': draft.feeCents ?? 0,
      'activityDate': lotMiddayIso(_date),
      'customerName': _customer.text.trim(),
      'customerPhone': _phone.text.trim(),
      'customerEmail': _email.text.trim(),
      'carMake': _make.text.trim(),
      'carModel': _model.text.trim(),
      'carYear': _year.text.trim(),
      'vinNumber': _vin.text.trim(),
      'auctionHouse': (_type?.needsAuctionHouse ?? false) ? _auctionHouse : '',
      'paymentMethod': _method,
      // Absent-means-received on the server, so send it; a direct activity not
      // yet paid carries no received fields.
      'paymentReceived':
          _method == lotPaymentMethodDirect ? _paymentReceived : true,
      'receivedVia': _method == lotPaymentMethodDirect && _paymentReceived
          ? _receivedVia
          : '',
      'receivedByStaffId':
          _method == lotPaymentMethodDirect && _paymentReceived
          ? (_receivedBy ?? '')
          : '',
    };

    try {
      final functions = FirebaseFunctions.instance;
      Object? data;
      if (_editing) {
        final result = await functions.httpsCallable('updateLotActivity').call<Object?>({
          'activityId': widget.existing!.id,
          'changes': payload,
        });
        data = result.data;
      } else {
        final result =
            await functions.httpsCallable('createLotActivity').call<Object?>(payload);
        data = result.data;
      }
      if (!mounted) return;
      AppHaptics.commit();
      final activityId = data is Map ? (data['activityId'] ?? '').toString() : '';
      final paid = data is Map && data['paymentStatus'] == lotStatusSucceeded;
      widget.onSaved();
      Navigator.of(context).pop();
      final messenger = ScaffoldMessenger.of(context);
      messenger.showSnackBar(
        SnackBar(
          content: Text(
              _editing ? l10n.lotActivityUpdated : l10n.lotActivityRecorded),
          duration: const Duration(seconds: 6),
          action: activityId.isEmpty
              ? null
              : SnackBarAction(
                  label: paid ? l10n.lotOpenReceipt : l10n.lotOpenInvoice,
                  onPressed: () => _openLotDocument(context, activityId),
                ),
        ),
      );
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, error.message ?? l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    String? errorFor(String code) => _errors.contains(code)
        ? _lotErrorText(l10n, code, lotDefaultProofThresholdCents)
        : null;
    final dateLabel = DateFormat.yMMMEd(
            Localizations.localeOf(context).toLanguageTag())
        .format(_date);

    return _SheetShell(
      title: _editing ? l10n.lotEditActivity : l10n.lotRecordActivity,
      subtitle: _locked ? l10n.lotPaidOnPlatform : null,
      footer: _SheetButton(
        label: l10n.lotSave,
        busy: _busy,
        busyLabel: l10n.lotSaving,
        onTap: _submit,
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _PickerField(
            label: l10n.lotWhatWasDone,
            value: _isCustom
                ? l10n.lotOneOffOption
                : _type?.label,
            placeholder: l10n.lotChooseActivity,
            onTap: _pickType,
            error: errorFor('activity_type_invalid'),
          ),
          if (_isCustom) ...[
            const SizedBox(height: AppSpacing.md),
            TextField(
              controller: _customLabel,
              onChanged: (_) => _clearError('custom_label_required'),
              decoration: InputDecoration(
                labelText: l10n.lotSayWhatWasDone,
                errorText: errorFor('custom_label_required'),
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _fee,
            enabled: !_locked,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => _clearError('fee_required'),
            decoration: InputDecoration(
              labelText: l10n.lotFee,
              prefixText: r'$ ',
              errorText: errorFor('fee_required'),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          _PickerField(
            label: l10n.lotDate,
            value: dateLabel,
            placeholder: dateLabel,
            onTap: _pickDate,
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
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
              errorText: errorFor('vin_required'),
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
          TextField(
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
          // The lot's memory, offered inline rather than in a menu that floats
          // over the form and hides the field being typed into.
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
            controller: _phone,
            keyboardType: TextInputType.phone,
            onChanged: (_) => _clearError('payment_link_contact_required'),
            decoration: InputDecoration(
              labelText: l10n.lotPhone,
              errorText: errorFor('payment_link_contact_required'),
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
          if (_type?.needsAuctionHouse ?? false) ...[
            const SizedBox(height: AppSpacing.md),
            _PickerField(
              label: l10n.lotAuctionHouse,
              value: _auctionHouse.isEmpty ? null : _auctionHouse,
              placeholder: l10n.lotChooseActivity,
              onTap: () async {
                final picked = await _pickOption<String>(
                  context,
                  title: l10n.lotAuctionHouse,
                  selected: _auctionHouse,
                  options: [
                    for (final a in lotAuctionHouses) LotOption(a, a),
                  ],
                );
                if (picked != null && mounted) {
                  setState(() => _auctionHouse = picked);
                }
              },
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
          Text(
            l10n.lotHowItGetsPaid,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.2,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          _ChoiceCard(
            title: l10n.lotChargeThroughWebsite,
            note: l10n.lotChargeThroughWebsiteNote,
            selected: _method == lotPaymentMethodLink,
            enabled: !_locked,
            onTap: () => setState(() => _method = lotPaymentMethodLink),
          ),
          if (_method == lotPaymentMethodLink && !_locked) ...[
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              onChanged: (_) => _clearError('payment_link_contact_required'),
              decoration: InputDecoration(
                labelText: l10n.lotEmail,
                helperText: l10n.lotLinkGoesByTextAndEmail,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          _ChoiceCard(
            title: l10n.lotPaidOutsideWebsite,
            note: l10n.lotPaidOutsideWebsiteNote,
            selected: _method == lotPaymentMethodDirect,
            enabled: !_locked,
            onTap: () => setState(() => _method = lotPaymentMethodDirect),
          ),
          if (_method == lotPaymentMethodDirect && !_locked) ...[
            const SizedBox(height: AppSpacing.sm),
            // The money is not always in hand when the job is logged. Only when
            // it has been received do we ask who took it.
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _paymentReceived,
              onChanged: (v) => setState(() => _paymentReceived = v),
              title: Text(l10n.lotMoneyReceived),
              subtitle: Text(
                _paymentReceived ? l10n.lotMoneyReceivedNote : l10n.lotLoggedAsOwed,
              ),
            ),
            if (_paymentReceived) ...[
              const SizedBox(height: AppSpacing.md),
              _PickerField(
                label: l10n.lotHowItWasPaid,
                value: _receivedViaLabelFor(l10n, _receivedVia),
                placeholder: l10n.lotHowItWasPaid,
                onTap: () async {
                  final picked = await _pickOption<String>(
                    context,
                    title: l10n.lotHowItWasPaid,
                    selected: _receivedVia,
                    options: [
                      for (final v in lotReceivedViaOptions)
                        LotOption(v, _receivedViaLabelFor(l10n, v)),
                    ],
                  );
                  if (picked != null && mounted) {
                    setState(() => _receivedVia = picked);
                  }
                },
              ),
              const SizedBox(height: AppSpacing.md),
              _PickerField(
                label: l10n.lotReceivedBy,
                value: widget.staff
                    .where((s) => s.id == _receivedBy)
                    .firstOrNull
                    ?.name,
                placeholder: l10n.lotReceivedBy,
                error: errorFor('received_by_required'),
                onTap: () async {
                  final picked = await _pickOption<String>(
                    context,
                    title: l10n.lotReceivedBy,
                    selected: _receivedBy,
                    options: [
                      for (final s in widget.staff) LotOption(s.id, s.name),
                    ],
                  );
                  if (picked != null && mounted) {
                    setState(() {
                      _receivedBy = picked;
                      _errors = {..._errors}..remove('received_by_required');
                    });
                  }
                },
              ),
            ],
          ],
        ],
      ),
    );
  }
}

String _receivedViaLabelFor(AppLocalizations l10n, String value) =>
    _receivedViaLabel(l10n, value);

Future<void> _openLotDocument(BuildContext context, String activityId) async {
  final l10n = AppLocalizations.of(context)!;
  final messenger = ScaffoldMessenger.of(context);
  try {
    final response = await FirebaseFunctions.instance
        .httpsCallable('getLotActivityDocumentUrl')
        .call<Object?>({'activityId': activityId});
    final data = response.data;
    final url = data is Map ? (data['url'] ?? '').toString() : '';
    final uri = url.isEmpty ? null : Uri.tryParse(url);
    if (uri == null) {
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.lotDocumentCouldNotBeOpened)),
      );
      return;
    }
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened) {
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.lotDocumentCouldNotBeOpened)),
      );
    }
  } catch (_) {
    messenger.showSnackBar(
      SnackBar(content: Text(l10n.lotDocumentCouldNotBeOpened)),
    );
  }
}

// ---------------------------------------------------------------------------
// One entry, and everything that can still be done to it.
// ---------------------------------------------------------------------------

class _ActivityDetailSheet extends StatelessWidget {
  const _ActivityDetailSheet({
    required this.activity,
    required this.staff,
    required this.types,
    required this.customers,
    required this.knownCars,
    required this.businessId,
    required this.onChanged,
  });

  final LotActivity activity;
  final List<LotStaff> staff;
  final List<LotActivityType> types;
  final List<LotCustomer> customers;
  final List<LotKnownCar> knownCars;
  final String businessId;
  final VoidCallback onChanged;

  String _staffName(String id) =>
      staff.where((s) => s.id == id).firstOrNull?.name ?? '';

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final date = activity.activityDate;
    return _SheetShell(
      title: activity.label.isEmpty ? l10n.lotLedgerTitle : activity.label,
      subtitle: [
        activity.vehicleLabel,
        if (activity.vinNumber.isNotEmpty) activity.vinNumber,
      ].where((p) => p.isNotEmpty).join(' · '),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Text(
                formatLotCents(activity.feeCents),
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.8,
                  height: 1.05,
                  color: AppColors.ink,
                  decoration:
                      activity.voided ? TextDecoration.lineThrough : null,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              _StatusPill(activity: activity),
            ],
          ),
          if (activity.voided && activity.voidReason.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              activity.voidReason,
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
          _DetailRow(label: l10n.lotCustomer, value: activity.customerName),
          if (activity.customerPhone.isNotEmpty)
            _DetailRow(label: l10n.lotPhone, value: activity.customerPhone),
          if (activity.customerEmail.isNotEmpty)
            _DetailRow(label: l10n.lotEmail, value: activity.customerEmail),
          if (date != null)
            _DetailRow(
              label: l10n.lotDate,
              value: DateFormat.yMMMEd(
                      Localizations.localeOf(context).toLanguageTag())
                  .format(date),
            ),
          if (activity.paymentMethod == lotPaymentMethodDirect) ...[
            _DetailRow(
              label: l10n.lotHowItWasPaid,
              value: _receivedViaLabel(l10n, activity.receivedVia),
            ),
            if (_staffName(activity.receivedByStaffId).isNotEmpty)
              _DetailRow(
                label: l10n.lotReceivedBy,
                value: _staffName(activity.receivedByStaffId),
              ),
          ],
          if (activity.auctionHouse.isNotEmpty)
            _DetailRow(
                label: l10n.lotAuctionHouse, value: activity.auctionHouse),
          const SizedBox(height: AppSpacing.lg),
          if (activity.hasDocument)
            _ActionRow(
              icon: Icons.receipt_long_outlined,
              label: activity.paid ? l10n.lotOpenReceipt : l10n.lotOpenInvoice,
              onTap: () => _openLotDocument(context, activity.id),
            ),
          if (activity.canChase)
            _ActionRow(
              icon: Icons.campaign_outlined,
              label: l10n.lotChasePayment,
              onTap: () => showLotSheet(
                context,
                _ChaseSheet(
                  activity: activity,
                  staff: staff,
                  onDone: onChanged,
                ),
              ),
            ),
          // Money marked received off-platform can be set back to not-received
          // if it never actually came in; the change is logged under whoever
          // does it (visible in History).
          if (!activity.voided &&
              activity.paid &&
              activity.paymentMethod == lotPaymentMethodDirect)
            _ActionRow(
              icon: Icons.undo_outlined,
              label: l10n.lotMarkNotReceived,
              onTap: () => showLotSheet(
                context,
                _RevertSheet(activityId: activity.id, onDone: onChanged),
              ),
            ),
          if (!activity.voided)
            _ActionRow(
              icon: Icons.edit_outlined,
              label: l10n.lotEditActivity,
              onTap: () => showLotSheet(
                context,
                _ActivityFormSheet(
                  businessId: businessId,
                  types: types,
                  staff: staff,
                  customers: customers,
                  knownCars: knownCars,
                  onSaved: onChanged,
                  existing: activity,
                ),
              ),
            ),
          _ActionRow(
            icon: Icons.history,
            label: l10n.lotHistory,
            onTap: () => showLotSheet(
              context,
              _HistorySheet(
                businessId: businessId,
                entityId: activity.id,
                staff: staff,
              ),
            ),
          ),
          if (!activity.voided)
            _ActionRow(
              icon: Icons.block_outlined,
              label: l10n.lotVoid,
              destructive: true,
              onTap: () => showLotSheet(
                context,
                _VoidSheet(
                  callable: 'voidLotActivity',
                  idKey: 'activityId',
                  id: activity.id,
                  onDone: onChanged,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    if (value.trim().isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 116,
            child: Text(
              label,
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({
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
      scale: 0.985,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md, vertical: AppSpacing.md),
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
                  fontSize: 14,
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

/// Chasing a payment is two different acts: send the same link again, or
/// record that the money already arrived another way. They are separated
/// because one contacts the customer and the other closes the entry.
class _ChaseSheet extends StatefulWidget {
  const _ChaseSheet({
    required this.activity,
    required this.staff,
    required this.onDone,
  });

  final LotActivity activity;
  final List<LotStaff> staff;
  final VoidCallback onDone;

  @override
  State<_ChaseSheet> createState() => _ChaseSheetState();
}

class _ChaseSheetState extends State<_ChaseSheet> {
  String _via = 'cash';
  String? _receivedBy;
  bool _busy = false;

  Future<void> _run(String name, Map<String, dynamic> payload, String done) async {
    final l10n = AppLocalizations.of(context)!;
    setState(() => _busy = true);
    try {
      await FirebaseFunctions.instance.httpsCallable(name).call<Object?>(payload);
      if (!mounted) return;
      AppHaptics.commit();
      widget.onDone();
      Navigator.of(context).pop();
      showSuccessSnackBar(context, done);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, error.message ?? l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return _SheetShell(
      title: l10n.lotChasePayment,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // A direct activity logged as owed has no link to re-send; it is
          // only marked received. A link row offers both.
          if (widget.activity.awaitingLink) ...[
            _ActionRow(
              icon: Icons.send_outlined,
              label: l10n.lotSendLinkAgain,
              onTap: _busy
                  ? () {}
                  : () => _run(
                        'resendLotActivityLink',
                        {'activityId': widget.activity.id},
                        l10n.lotLinkResent,
                      ),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
          _PickerField(
            label: l10n.lotHowItWasPaid,
            value: _receivedViaLabel(l10n, _via),
            placeholder: l10n.lotHowItWasPaid,
            onTap: () async {
              final picked = await _pickOption<String>(
                context,
                title: l10n.lotHowItWasPaid,
                selected: _via,
                options: [
                  for (final v in lotReceivedViaOptions)
                    LotOption(v, _receivedViaLabel(l10n, v)),
                ],
              );
              if (picked != null && mounted) setState(() => _via = picked);
            },
          ),
          const SizedBox(height: AppSpacing.md),
          _PickerField(
            label: l10n.lotReceivedBy,
            value: widget.staff
                .where((s) => s.id == _receivedBy)
                .firstOrNull
                ?.name,
            placeholder: l10n.lotReceivedBy,
            onTap: () async {
              final picked = await _pickOption<String>(
                context,
                title: l10n.lotReceivedBy,
                selected: _receivedBy,
                options: [
                  for (final s in widget.staff) LotOption(s.id, s.name),
                ],
              );
              if (picked != null && mounted) {
                setState(() => _receivedBy = picked);
              }
            },
          ),
        ],
      ),
      footer: _SheetButton(
        label: l10n.lotRecordAsPaid,
        busy: _busy,
        busyLabel: l10n.lotSaving,
        onTap: () {
          if (_receivedBy == null || _receivedBy!.isEmpty) {
            AppHaptics.refuse();
            showErrorSnackBar(context, l10n.lotErrReceivedBy);
            return;
          }
          _run(
            'recordLotActivityDirectPayment',
            {
              'activityId': widget.activity.id,
              'receivedVia': _via,
              'receivedByStaffId': _receivedBy,
            },
            l10n.lotActivityUpdated,
          );
        },
      ),
    );
  }
}

/// Voiding is the one destructive act here, so it asks — and says exactly what
/// happens, because "are you sure" teaches nothing.
class _VoidSheet extends StatefulWidget {
  const _VoidSheet({
    required this.callable,
    required this.idKey,
    required this.id,
    required this.onDone,
  });

  final String callable;
  final String idKey;
  final String id;
  final VoidCallback onDone;

  @override
  State<_VoidSheet> createState() => _VoidSheetState();
}

class _VoidSheetState extends State<_VoidSheet> {
  final _reason = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    setState(() => _busy = true);
    try {
      await FirebaseFunctions.instance.httpsCallable(widget.callable).call<Object?>({
        widget.idKey: widget.id,
        'reason': _reason.text.trim(),
      });
      if (!mounted) return;
      AppHaptics.commit();
      widget.onDone();
      Navigator.of(context).pop(true);
      showSuccessSnackBar(context, l10n.lotVoidDone);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, error.message ?? l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return _SheetShell(
      title: l10n.lotVoidTitle,
      subtitle: l10n.lotVoidExplain,
      body: TextField(
        controller: _reason,
        decoration: InputDecoration(labelText: l10n.lotVoidReason),
      ),
      footer: _SheetButton(
        label: l10n.lotVoid,
        tone: _Tone.warn,
        busy: _busy,
        busyLabel: l10n.lotSaving,
        onTap: _submit,
      ),
    );
  }
}

/// Undo a "received" mark when the money never actually came in. Off-platform
/// only, and logged under whoever does it - the History sheet shows it.
class _RevertSheet extends StatefulWidget {
  const _RevertSheet({required this.activityId, required this.onDone});

  final String activityId;
  final VoidCallback onDone;

  @override
  State<_RevertSheet> createState() => _RevertSheetState();
}

class _RevertSheetState extends State<_RevertSheet> {
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    setState(() => _busy = true);
    try {
      await FirebaseFunctions.instance
          .httpsCallable('revertLotActivityDirectPayment')
          .call<Object?>({
            'activityId': widget.activityId,
            'note': _note.text.trim(),
          });
      if (!mounted) return;
      AppHaptics.commit();
      widget.onDone();
      Navigator.of(context).pop(true);
      showSuccessSnackBar(context, l10n.lotMarkNotReceivedDone);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, error.message ?? l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return _SheetShell(
      title: l10n.lotMarkNotReceivedTitle,
      subtitle: l10n.lotMarkNotReceivedExplain,
      body: TextField(
        controller: _note,
        decoration: InputDecoration(labelText: l10n.lotMarkNotReceivedNote),
      ),
      footer: _SheetButton(
        label: l10n.lotMarkNotReceived,
        tone: _Tone.warn,
        busy: _busy,
        busyLabel: l10n.lotSaving,
        onTap: _submit,
      ),
    );
  }
}

class _HistorySheet extends StatelessWidget {
  const _HistorySheet({
    required this.businessId,
    required this.entityId,
    required this.staff,
  });

  final String businessId;
  final String entityId;
  final List<LotStaff> staff;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    // Scoped by business as well as entity: the rule authorizes by business,
    // and Firestore refuses a query it cannot prove stays inside that scope.
    final query = FirebaseFirestore.instance
        .collection('lotLedgerAudit')
        .where('businessId', isEqualTo: businessId)
        .where('entityId', isEqualTo: entityId)
        .orderBy('at', descending: true)
        .limit(50)
        .get();

    return _SheetShell(
      title: l10n.lotHistory,
      body: FutureBuilder<QuerySnapshot<Map<String, dynamic>>>(
        future: query,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: 32),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          final events = [
            for (final d in snapshot.data?.docs ?? [])
              LotAuditEvent.fromMap(d.id, d.data()),
          ];
          if (events.isEmpty) {
            return _EmptyState(
              icon: Icons.history,
              title: l10n.lotNoHistory,
            );
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final event in events)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.md),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        event.summary,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        [
                          staff
                                  .where((s) => s.id == event.byStaffId)
                                  .firstOrNull
                                  ?.name ??
                              '',
                          if (event.at != null)
                            DateFormat.yMMMd(Localizations.localeOf(context)
                                    .toLanguageTag())
                                .add_jm()
                                .format(event.at!),
                        ].where((p) => p.isNotEmpty).join(' · '),
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Expenses.
// ---------------------------------------------------------------------------

class _ExpensesPanel extends StatelessWidget {
  const _ExpensesPanel({
    required this.businessId,
    required this.month,
    required this.monthLabel,
    required this.math,
    required this.lines,
    required this.staff,
    required this.proofThresholdCents,
  });

  final String businessId;
  final String month;
  final String monthLabel;
  final LotLedgerMath math;
  final List<LotExpenseLine> lines;
  final List<LotStaff> staff;
  final int proofThresholdCents;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Stack(
      children: [
        ListView(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 120),
          children: [
            if (proofThresholdCents > 0)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.md),
                child: Row(
                  children: [
                    const Icon(Icons.receipt_outlined,
                        size: 15, color: AppColors.muted),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        l10n.lotProofRequiredFrom(
                            formatLotCents(proofThresholdCents)),
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            if (lines.isEmpty)
              _EmptyState(
                icon: Icons.account_balance_wallet_outlined,
                title: l10n.lotNoExpenseLines,
                hint: l10n.lotNoExpenseLinesHint,
              )
            else
              for (final line in lines)
                _ExpenseLineCard(
                  line: line,
                  month: month,
                  monthLabel: monthLabel,
                  math: math,
                  onTap: () => showLotSheet(
                    context,
                    _PurchasesSheet(
                      businessId: businessId,
                      line: line,
                      month: month,
                      monthLabel: monthLabel,
                      math: math,
                      staff: staff,
                      proofThresholdCents: proofThresholdCents,
                    ),
                  ),
                ),
          ],
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: _PrimaryBar(
            label: l10n.lotAddExpenseLine,
            icon: Icons.add,
            onTap: () => showLotSheet(
              context,
              _ExpenseLineSheet(businessId: businessId),
            ),
          ),
        ),
      ],
    );
  }
}

class _ExpenseLineCard extends StatelessWidget {
  const _ExpenseLineCard({
    required this.line,
    required this.month,
    required this.monthLabel,
    required this.math,
    required this.onTap,
  });

  final LotExpenseLine line;
  final String month;
  final String monthLabel;
  final LotLedgerMath math;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final entries = math.lineEntries(line.id, month);
    final amount = math.lineMonthCents(line, month);
    // A line that changes every month and has nothing logged yet is the one
    // thing on this screen that wants attention, so it is the only thing
    // marked.
    final waiting = line.isMetered && entries.isEmpty;

    final subtitle = line.isMetered
        ? (entries.isEmpty
            ? l10n.lotWaitingOnBill
            : l10n.lotPurchasesCount(entries.length))
        : l10n.lotEveryMonth(formatLotCents(line.recurringCents));

    return PressableScale(
      onTap: onTap,
      scale: 0.985,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.paper,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(
            color: waiting
                ? AppColors.saffron.withValues(alpha: 0.55)
                : AppColors.rule,
          ),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    line.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.2,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    [line.detail, subtitle]
                        .where((p) => p.isNotEmpty)
                        .join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    line.isMetered
                        ? l10n.lotChangesEveryMonth
                        : l10n.lotSameEveryMonth,
                    style: const TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.4,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Text(
              formatLotCents(amount),
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.3,
                color: AppColors.ink,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right, size: 18, color: AppColors.muted),
          ],
        ),
      ),
    );
  }
}

class _PurchasesSheet extends StatefulWidget {
  const _PurchasesSheet({
    required this.businessId,
    required this.line,
    required this.month,
    required this.monthLabel,
    required this.math,
    required this.staff,
    required this.proofThresholdCents,
  });

  final String businessId;
  final LotExpenseLine line;
  final String month;
  final String monthLabel;
  final LotLedgerMath math;
  final List<LotStaff> staff;
  final int proofThresholdCents;

  @override
  State<_PurchasesSheet> createState() => _PurchasesSheetState();
}

class _PurchasesSheetState extends State<_PurchasesSheet> {
  final _amount = TextEditingController();
  final _note = TextEditingController();
  DateTime _date = DateTime.now();
  String? _paidBy;
  bool _busy = false;
  bool _uploading = false;
  Set<String> _errors = {};

  String _proofUrl = '';
  String _proofName = '';

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _attachReceipt() async {
    final l10n = AppLocalizations.of(context)!;
    final source = await _pickOption<ImageSource>(
      context,
      title: l10n.lotAttachReceipt,
      options: [
        LotOption(ImageSource.camera, l10n.lotReceipt),
        LotOption(ImageSource.gallery, l10n.lotAttachReceipt),
      ],
    );
    if (source == null || !mounted) return;
    final picked = await ImagePicker()
        .pickImage(source: source, imageQuality: 72, maxWidth: 2200);
    if (picked == null || !mounted) return;
    setState(() => _uploading = true);
    try {
      final bytes = await picked.readAsBytes();
      final ref = storage.FirebaseStorage.instance
          .ref()
          .child('lotExpenseProofs')
          .child(widget.businessId)
          .child('${DateTime.now().millisecondsSinceEpoch}-${picked.name}');
      await ref.putData(
        bytes,
        storage.SettableMetadata(contentType: 'image/jpeg'),
      );
      final url = await ref.getDownloadURL();
      if (!mounted) return;
      setState(() {
        _proofUrl = url;
        _proofName = picked.name;
        _errors = {..._errors}..remove('expense_proof_required');
      });
      AppHaptics.commit();
    } catch (_) {
      if (mounted) {
        AppHaptics.refuse();
        showErrorSnackBar(context, AppLocalizations.of(context)!.lotCouldNotSave);
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _voidEntry(LotExpenseEntry entry) async {
    final voided = await showLotSheet<bool>(
      context,
      _VoidSheet(
        callable: 'voidLotExpenseEntry',
        idKey: 'entryId',
        id: entry.id,
        onDone: () {},
      ),
    );
    // This sheet holds a snapshot of the month, so once a row in it is gone
    // the honest thing is to close and let the list behind rebuild.
    if (voided == true && mounted) Navigator.of(context).pop();
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    final cents = lotDollarsToCents(_amount.text);
    final errors = validateLotExpenseDraft(
      amountCents: cents,
      paidByStaffId: _paidBy ?? '',
      hasProof: _proofUrl.isNotEmpty,
      thresholdCents: widget.proofThresholdCents,
    );
    if (errors.isNotEmpty) {
      AppHaptics.refuse();
      setState(() => _errors = errors.toSet());
      return;
    }
    setState(() => _busy = true);
    try {
      await FirebaseFunctions.instance
          .httpsCallable('createLotExpenseEntry')
          .call<Object?>({
        'businessId': widget.businessId,
        'lineId': widget.line.id,
        'month': widget.month,
        'amountCents': cents,
        'spentAt': lotMiddayIso(_date),
        'paidByStaffId': _paidBy,
        'note': _note.text.trim(),
        'proofUrl': _proofUrl,
        'proofFileName': _proofName,
        'proofContentType': _proofUrl.isEmpty ? '' : 'image/jpeg',
      });
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop();
      showSuccessSnackBar(context, l10n.lotPurchaseAdded);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, error.message ?? l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final entries = widget.math.lineEntries(widget.line.id, widget.month);
    String? errorFor(String code) => _errors.contains(code)
        ? _lotErrorText(l10n, code, widget.proofThresholdCents)
        : null;
    final dateLabel =
        DateFormat.yMMMEd(Localizations.localeOf(context).toLanguageTag())
            .format(_date);

    return _SheetShell(
      title: widget.line.label,
      subtitle: widget.monthLabel,
      footer: _SheetButton(
        label: l10n.lotAddPurchase,
        busy: _busy,
        busyLabel: l10n.lotSaving,
        onTap: _submit,
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (entries.isEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.md),
              child: Text(
                l10n.lotNoPurchasesForMonth(widget.monthLabel),
                style: const TextStyle(fontSize: 13, color: AppColors.muted),
              ),
            )
          else ...[
            for (final entry in entries)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: Row(
                  children: [
                    Text(
                      formatLotCents(entry.amountCents),
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                        fontFeatures: [FontFeature.tabularFigures()],
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        entry.note,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                    ),
                    if (entry.hasProof)
                      const Padding(
                        padding: EdgeInsets.only(right: AppSpacing.sm),
                        child: Icon(Icons.attachment,
                            size: 15, color: AppColors.muted),
                      ),
                    Semantics(
                      button: true,
                      label: l10n.lotVoid,
                      child: PressableScale(
                        scale: 0.9,
                        onTap: () => _voidEntry(entry),
                        child: const Padding(
                          padding: EdgeInsets.all(4),
                          child: Icon(Icons.block_outlined,
                              size: 16, color: AppColors.muted),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            const Divider(height: AppSpacing.xl),
          ],
          TextField(
            controller: _amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) =>
                setState(() => _errors = {..._errors}..remove('expense_amount_required')),
            decoration: InputDecoration(
              labelText: l10n.lotAmount,
              prefixText: r'$ ',
              errorText: errorFor('expense_amount_required'),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          _PickerField(
            label: l10n.lotDate,
            value: dateLabel,
            placeholder: dateLabel,
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: _date,
                firstDate: DateTime(2020),
                lastDate: DateTime(2100),
              );
              if (picked != null && mounted) setState(() => _date = picked);
            },
          ),
          const SizedBox(height: AppSpacing.md),
          _PickerField(
            label: l10n.lotPaidBy,
            value: widget.staff.where((s) => s.id == _paidBy).firstOrNull?.name,
            placeholder: l10n.lotPaidBy,
            error: errorFor('expense_paid_by_required'),
            onTap: () async {
              final picked = await _pickOption<String>(
                context,
                title: l10n.lotPaidBy,
                selected: _paidBy,
                options: [
                  for (final s in widget.staff) LotOption(s.id, s.name),
                ],
              );
              if (picked != null && mounted) {
                setState(() {
                  _paidBy = picked;
                  _errors = {..._errors}..remove('expense_paid_by_required');
                });
              }
            },
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _note,
            decoration: InputDecoration(labelText: l10n.lotNote),
          ),
          const SizedBox(height: AppSpacing.md),
          _ActionRow(
            icon: _proofUrl.isEmpty ? Icons.add_a_photo_outlined : Icons.check,
            label: _uploading
                ? l10n.lotUploadingReceipt
                : (_proofUrl.isEmpty
                    ? l10n.lotAttachReceipt
                    : l10n.lotReceiptAttached),
            onTap: _uploading ? () {} : _attachReceipt,
          ),
          if (errorFor('expense_proof_required') != null)
            Text(
              errorFor('expense_proof_required')!,
              style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
            ),
        ],
      ),
    );
  }
}

class _ExpenseLineSheet extends StatefulWidget {
  const _ExpenseLineSheet({required this.businessId});

  final String businessId;

  @override
  State<_ExpenseLineSheet> createState() => _ExpenseLineSheetState();
}

class _ExpenseLineSheetState extends State<_ExpenseLineSheet> {
  final _label = TextEditingController();
  final _detail = TextEditingController();
  final _recurring = TextEditingController();
  String _kind = lotExpenseKindMetered;
  bool _busy = false;

  @override
  void dispose() {
    _label.dispose();
    _detail.dispose();
    _recurring.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    if (_label.text.trim().isEmpty) {
      AppHaptics.refuse();
      showErrorSnackBar(context, l10n.lotExpenseName);
      return;
    }
    setState(() => _busy = true);
    try {
      await FirebaseFunctions.instance
          .httpsCallable('upsertLotExpenseLine')
          .call<Object?>({
        'businessId': widget.businessId,
        'label': _label.text.trim(),
        'detail': _detail.text.trim(),
        'kind': _kind,
        'recurringCents': _kind == lotExpenseKindFixed
            ? (lotDollarsToCents(_recurring.text) ?? 0)
            : 0,
      });
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop();
      showSuccessSnackBar(context, l10n.lotExpenseLineSaved);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, error.message ?? l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return _SheetShell(
      title: l10n.lotAddExpenseLine,
      footer: _SheetButton(
        label: l10n.lotSave,
        busy: _busy,
        busyLabel: l10n.lotSaving,
        onTap: _submit,
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _label,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: l10n.lotExpenseName),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _detail,
            decoration: InputDecoration(labelText: l10n.lotExpenseSupplier),
          ),
          const SizedBox(height: AppSpacing.md),
          _ChoiceCard(
            title: l10n.lotChangesEveryMonth,
            note: l10n.lotWaitingOnBill,
            selected: _kind == lotExpenseKindMetered,
            onTap: () => setState(() => _kind = lotExpenseKindMetered),
          ),
          _ChoiceCard(
            title: l10n.lotSameEveryMonth,
            note: l10n.lotMonthlyAmount,
            selected: _kind == lotExpenseKindFixed,
            onTap: () => setState(() => _kind = lotExpenseKindFixed),
          ),
          if (_kind == lotExpenseKindFixed)
            TextField(
              controller: _recurring,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                labelText: l10n.lotMonthlyAmount,
                prefixText: r'$ ',
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Reports.
// ---------------------------------------------------------------------------

class _ReportsPanel extends StatelessWidget {
  const _ReportsPanel({
    required this.math,
    required this.month,
    required this.onPickMonth,
    required this.monthLabel,
  });

  final LotLedgerMath math;
  final String month;
  final ValueChanged<String> onPickMonth;
  final String Function(String) monthLabel;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final year = lotMonthStart(month).year;
    final revenue = math.yearRevenueByMonth(year);
    final expenses = math.yearExpenseByMonth(year);
    final totalRevenue = revenue.fold(0, (a, b) => a + b);
    final totalExpense = expenses.fold(0, (a, b) => a + b);
    final net = totalRevenue - totalExpense;
    final margin = lotMarginPercent(totalRevenue, net);
    final months = lotYearMonths(year);

    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.xl),
      children: [
        Row(
          children: [
            Expanded(
              child: _MoneyTile(
                label: l10n.lotRevenueForYear('$year'),
                cents: totalRevenue,
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: _MoneyTile(
                label: l10n.lotExpensesForYear('$year'),
                cents: totalExpense,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        Row(
          children: [
            Expanded(
              child: _MoneyTile(
                label: l10n.lotNetProfit,
                cents: net,
                tone: net < 0 ? _Tone.warn : _Tone.good,
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md, vertical: AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.parchment,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                  border: Border.all(color: AppColors.rule),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.lotMargin.toUpperCase(),
                      style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.6,
                        color: AppColors.muted,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      margin == null ? '—' : '$margin%',
                      style: const TextStyle(
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                        height: 1.05,
                        letterSpacing: -0.6,
                        color: AppColors.ink,
                        fontFeatures: [FontFeature.tabularFigures()],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(
          l10n.lotMonthByMonth,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.2,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Container(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.md, AppSpacing.lg, AppSpacing.md, AppSpacing.sm),
          decoration: BoxDecoration(
            color: AppColors.paper,
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            border: Border.all(color: AppColors.rule),
          ),
          child: Column(
            children: [
              _YearChart(
                revenue: revenue,
                expenses: expenses,
                selected: months.indexOf(month),
                onSelect: (i) => onPickMonth(months[i]),
              ),
              const SizedBox(height: AppSpacing.md),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _LegendDot(color: AppColors.cobalt, label: l10n.lotRevenue),
                  const SizedBox(width: AppSpacing.lg),
                  _LegendDot(
                      color: AppColors.saffron, label: l10n.lotExpensesLabel),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        Text(
          monthLabel(month),
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(
          l10n.lotWhereTheMoneyGoes,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.2,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        _ExpenseBreakdown(
          spend: math.expenseByLine(year),
          totalCents: totalExpense,
          year: year,
        ),
      ],
    );
  }
}

/// Which line is eating the money, ranked, with each share drawn against the
/// same total the tile above shows. The bars are one colour on purpose: the
/// ranking is the information, and a palette would only decorate it.
class _ExpenseBreakdown extends StatelessWidget {
  const _ExpenseBreakdown({
    required this.spend,
    required this.totalCents,
    required this.year,
  });

  final List<LotLineSpend> spend;
  final int totalCents;
  final int year;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    if (spend.isEmpty || totalCents <= 0) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: AppColors.paper,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(color: AppColors.rule),
        ),
        child: Text(
          l10n.lotNothingSpentYear('$year'),
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 13, color: AppColors.muted),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        children: [
          for (final row in spend)
            Padding(
              padding: EdgeInsets.only(
                bottom: row == spend.last ? 0 : AppSpacing.md,
              ),
              child: _ExpenseShareRow(
                label: row.label.isEmpty ? l10n.lotOtherExpense : row.label,
                cents: row.cents,
                fraction: row.cents / totalCents,
              ),
            ),
        ],
      ),
    );
  }
}

class _ExpenseShareRow extends StatelessWidget {
  const _ExpenseShareRow({
    required this.label,
    required this.cents,
    required this.fraction,
  });

  final String label;
  final int cents;
  final double fraction;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final percent = (fraction * 100).round();
    // A line worth a fraction of a percent should not read as nothing.
    final share = percent < 1 ? l10n.lotShareUnderOnePercent : '$percent%';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Text(
              formatLotCents(cents),
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                letterSpacing: -0.2,
                color: AppColors.ink,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(3),
                child: Container(
                  height: 6,
                  color: AppColors.parchment,
                  child: FractionallySizedBox(
                    alignment: Alignment.centerLeft,
                    // Never a bar of literally nothing: a line that cost money
                    // shows a sliver.
                    widthFactor: fraction.clamp(0.012, 1.0),
                    child: AnimatedContainer(
                      duration: AppMotion.swapFor(context),
                      curve: AppMotion.standard,
                      decoration: BoxDecoration(
                        color: AppColors.saffron,
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            SizedBox(
              width: 38,
              child: Text(
                share,
                textAlign: TextAlign.right,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: AppColors.muted,
                  fontFeatures: [FontFeature.tabularFigures()],
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _LegendDot extends StatelessWidget {
  const _LegendDot({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 9,
          height: 9,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(
          label,
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: AppColors.muted,
          ),
        ),
      ],
    );
  }
}

/// Twelve months of revenue against expense. Tapping a month selects it, so
/// the chart is a way of moving through the year rather than a picture of it.
class _YearChart extends StatelessWidget {
  const _YearChart({
    required this.revenue,
    required this.expenses,
    required this.selected,
    required this.onSelect,
  });

  final List<int> revenue;
  final List<int> expenses;
  final int selected;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    final initials = [
      for (var m = 1; m <= 12; m++)
        DateFormat.MMM(Localizations.localeOf(context).toLanguageTag())
            .format(DateTime(2026, m))
            .characters
            .first,
    ];
    return LayoutBuilder(
      builder: (context, constraints) {
        return GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapDown: (details) {
            final slot = constraints.maxWidth / 12;
            final index = (details.localPosition.dx / slot).floor().clamp(0, 11);
            AppHaptics.selection();
            onSelect(index);
          },
          child: SizedBox(
            height: 150,
            width: double.infinity,
            child: CustomPaint(
              painter: _YearChartPainter(
                revenue: revenue,
                expenses: expenses,
                selected: selected,
                initials: initials,
                textDirection: Directionality.of(context),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _YearChartPainter extends CustomPainter {
  _YearChartPainter({
    required this.revenue,
    required this.expenses,
    required this.selected,
    required this.initials,
    required this.textDirection,
  });

  final List<int> revenue;
  final List<int> expenses;
  final int selected;
  final List<String> initials;
  final TextDirection textDirection;

  @override
  void paint(Canvas canvas, Size size) {
    const labelHeight = 18.0;
    final chartHeight = size.height - labelHeight;
    final slot = size.width / 12;
    final barWidth = (slot - 8) / 2;
    var max = 0;
    for (final v in [...revenue, ...expenses]) {
      if (v > max) max = v;
    }
    if (max <= 0) max = 1;

    final baseline = Paint()
      ..color = AppColors.rule
      ..strokeWidth = 1;
    canvas.drawLine(
      Offset(0, chartHeight),
      Offset(size.width, chartHeight),
      baseline,
    );

    final revenuePaint = Paint()..color = AppColors.cobalt;
    final expensePaint = Paint()..color = AppColors.saffron;

    for (var i = 0; i < 12; i++) {
      final left = i * slot;
      if (i == selected) {
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromLTWH(left + 1, 0, slot - 2, chartHeight + labelHeight),
            const Radius.circular(6),
          ),
          Paint()..color = AppColors.mist.withValues(alpha: 0.55),
        );
      }

      void bar(int value, double offset, Paint paint) {
        if (value <= 0) return;
        final height = (value / max) * (chartHeight - 6);
        final rect = Rect.fromLTWH(
          left + offset,
          chartHeight - height,
          barWidth,
          height,
        );
        canvas.drawRRect(
          RRect.fromRectAndCorners(
            rect,
            topLeft: const Radius.circular(2),
            topRight: const Radius.circular(2),
          ),
          paint,
        );
      }

      bar(revenue[i], 4, revenuePaint);
      bar(expenses[i], 4 + barWidth, expensePaint);

      final label = TextPainter(
        text: TextSpan(
          text: initials[i],
          style: TextStyle(
            fontSize: 10,
            fontWeight: i == selected ? FontWeight.w800 : FontWeight.w500,
            color: i == selected ? AppColors.cobaltDeep : AppColors.muted,
          ),
        ),
        textDirection: textDirection,
      )..layout();
      label.paint(
        canvas,
        Offset(left + (slot - label.width) / 2, chartHeight + 4),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _YearChartPainter old) =>
      old.selected != selected ||
      !identical(old.revenue, revenue) ||
      !identical(old.expenses, expenses);
}
