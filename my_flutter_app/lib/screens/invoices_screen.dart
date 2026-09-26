import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import '../l10n/app_localizations.dart';
import '../services/invoice_ledger.dart';
import '../services/lot_customers.dart';
import '../services/lot_ledger.dart'
    show LotKnownCar, LotStaff, lotFindKnownCar;
import '../services/vin_decoder_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/invoice_pdf.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/lot_sheets.dart';
import 'vin_scanner_screen.dart';

/// Invoices and receipts the business writes by hand: what it sold to
/// someone - a car, barrels, tyres, anything, whether or not it exists
/// anywhere else on the platform - and what has been paid against it. One
/// invoice is one open tab; the paper is a PDF built on the phone and sent
/// over WhatsApp. Customers never see this screen.
///
/// Every rule the server enforces is checked first by
/// `services/invoice_ledger.dart`, which mirrors the server module, so a
/// refusal is shown at the field before the round trip and in the same words
/// when the server refuses anyway.
class InvoicesScreen extends StatefulWidget {
  const InvoicesScreen({super.key, required this.businessId});

  final String businessId;

  @override
  State<InvoicesScreen> createState() => _InvoicesScreenState();
}

class _InvoicesScreenState extends State<InvoicesScreen> {
  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final List<StreamSubscription<Object?>> _subs = [];

  List<Invoice> _invoices = const [];
  List<LotStaff> _staff = const [];
  List<LotCustomer> _customers = const [];

  /// Every vehicle this business has on file - parked cars and past ledger
  /// jobs - so typing a VIN it recognises never means re-typing the car.
  List<LotKnownCar> _parkedCars = const [];
  List<LotKnownCar> _activityCars = const [];
  List<LotKnownCar> get _knownCars => [..._parkedCars, ..._activityCars];
  Map<String, dynamic> _business = const {};
  String _filter = invoiceFilterOpen;
  String _search = '';
  bool _loading = true;
  bool _loadFailed = false;

  @override
  void initState() {
    super.initState();
    _listen();
  }

  void _listen() {
    final id = widget.businessId;
    // No orderBy on any collection: sorted client-side so no query needs a
    // composite index.
    Query<Map<String, dynamic>> scoped(String path) =>
        _db.collection(path).where('businessId', isEqualTo: id);

    _subs.add(scoped('invoices').snapshots().listen((snap) {
      if (!mounted) return;
      setState(() {
        _invoices = sortInvoices([
          for (final d in snap.docs) Invoice.fromMap(d.id, d.data()),
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
    _subs.add(scoped('parkedCars').snapshots().listen((snap) {
      if (!mounted) return;
      setState(() => _parkedCars = [
            for (final d in snap.docs) LotKnownCar.fromMap(d.data()),
          ]);
    }, onError: (_) {}));
    _subs.add(scoped('lotActivities').snapshots().listen((snap) {
      if (!mounted) return;
      setState(() => _activityCars = [
            for (final d in snap.docs)
              if ((d.data()['vinNumber'] ?? '').toString().isNotEmpty)
                LotKnownCar.fromMap(d.data()),
          ]);
    }, onError: (_) {}));
    // The list reads the totals stamped on each invoice; only the detail
    // screen subscribes to lines and payments, and only for its own invoice.
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
    }, onError: (_) {}));
    // The business's own identity: what the paper wears.
    _subs.add(_db.collection('businesses').doc(id).snapshots().listen((doc) {
      if (!mounted) return;
      setState(() => _business = doc.data() ?? const {});
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

  String get _businessName =>
      (_business['name'] ?? _business['businessName'] ?? '').toString();

  void _openDetail(String invoiceId) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => InvoiceDetailScreen(
          businessId: widget.businessId,
          invoiceId: invoiceId,
          staff: _staff,
          customers: _customers,
          knownCars: _knownCars,
          business: _business,
          onCustomerRecorded: _loadCustomers,
        ),
      ),
    );
  }

  Future<void> _create() async {
    final created = await showLotSheet<String>(
      context,
      _InvoiceFormSheet(
        businessId: widget.businessId,
        customers: _customers,
      ),
    );
    if (created == null || !mounted) return;
    _loadCustomers();
    _openDetail(created);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final today = invoiceTodayKey();
    final counts = <String, int>{
      invoiceFilterOpen: _invoices.where((i) => i.isOpen).length,
      invoiceFilterOverdue:
          _invoices.where((i) => invoiceIsOverdue(i, today)).length,
      invoiceFilterPaid: _invoices.where((i) => i.isPaid).length,
      invoiceFilterAll: _invoices.length,
    };
    final owed = _invoices
        .where((i) => i.isOpen)
        .fold<int>(0, (s, i) => s + (i.balanceCents < 0 ? 0 : i.balanceCents));
    final collected = _invoices.fold<int>(
        0, (s, i) => s + (i.paidCents < 0 ? 0 : i.paidCents));
    final rows = filterInvoices(_invoices, _filter, _search, today);
    final searching = _search.trim().length >= 2;

    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          _InvoicesHeader(
            businessName: _businessName,
            search: _search,
            onSearch: (v) => setState(() => _search = v),
            filter: _filter,
            counts: counts,
            onFilter: (f) => setState(() => _filter = f),
            showFilter: !searching,
            owedCents: owed,
            collectedCents: collected,
          ),
          Expanded(
            child: Stack(
              children: [
                if (_loading)
                  const Center(child: CircularProgressIndicator())
                else if (_loadFailed)
                  LotEmptyState(
                    icon: Icons.receipt_long_outlined,
                    title: l10n.lotCouldNotSave,
                  )
                else if (_invoices.isEmpty)
                  LotEmptyState(
                    icon: Icons.receipt_long_outlined,
                    title: l10n.invEmptyTitle,
                    hint: l10n.invEmptyHint,
                  )
                else if (rows.isEmpty)
                  LotEmptyState(
                    icon: Icons.search_off_outlined,
                    title: l10n.invNoMatch,
                  )
                else
                  ListView.builder(
                    key: const Key('invoices-list'),
                    padding: const EdgeInsets.fromLTRB(
                        AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 96),
                    itemCount: rows.length,
                    itemBuilder: (_, i) => _InvoiceCard(
                      invoice: rows[i],
                      onTap: () => _openDetail(rows[i].id),
                    ),
                  ),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: LotPrimaryBar(
                    label: l10n.invNew,
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
// Header: where you are, the numbers, the search, and the four states.
// ---------------------------------------------------------------------------

class _InvoicesHeader extends StatelessWidget {
  const _InvoicesHeader({
    required this.businessName,
    required this.search,
    required this.onSearch,
    required this.filter,
    required this.counts,
    required this.onFilter,
    required this.showFilter,
    required this.owedCents,
    required this.collectedCents,
  });

  final String businessName;
  final String search;
  final ValueChanged<String> onSearch;
  final String filter;
  final Map<String, int> counts;
  final ValueChanged<String> onFilter;
  final bool showFilter;
  final int owedCents;
  final int collectedCents;

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
                          l10n.invTitle,
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
              child: Row(
                children: [
                  _Stat(label: l10n.invStatOpen, value: '${counts[invoiceFilterOpen] ?? 0}'),
                  const SizedBox(width: AppSpacing.sm),
                  _Stat(
                    label: l10n.invStatOwed,
                    value: invoiceMoney(owedCents),
                    tone: owedCents > 0 ? AppColors.warn : null,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  _Stat(label: l10n.invStatCollected, value: invoiceMoney(collectedCents)),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              child: _SearchField(value: search, onChanged: onSearch),
            ),
            AnimatedSize(
              duration: AppMotion.swapFor(context),
              curve: AppMotion.standard,
              alignment: Alignment.topCenter,
              child: showFilter
                  ? Padding(
                      padding: const EdgeInsets.fromLTRB(
                          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.md),
                      child: _FilterChips(
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
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
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
      key: const Key('invoices-search'),
      controller: _controller,
      onChanged: (v) {
        widget.onChanged(v);
        setState(() {});
      },
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: l10n.invSearchHint,
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
        for (final f in invoiceFilters) ...[
          Expanded(
            child: PressableScale(
              scale: 0.96,
              onTap: () => onChanged(f),
              child: AnimatedContainer(
                duration: AppMotion.press,
                height: 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: f == selected ? AppColors.cobalt : AppColors.paper,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                  border: Border.all(
                    color: f == selected ? AppColors.cobalt : AppColors.rule,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _filterLabel(l10n, f),
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: f == selected ? Colors.white : AppColors.muted,
                      ),
                    ),
                    if ((counts[f] ?? 0) > 0) ...[
                      const SizedBox(width: 6),
                      Text(
                        '${counts[f]}',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: f == selected
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
          if (f != invoiceFilters.last) const SizedBox(width: AppSpacing.sm),
        ],
      ],
    );
  }
}

String _filterLabel(AppLocalizations l10n, String f) => switch (f) {
      invoiceFilterOpen => l10n.invFilterOpen,
      invoiceFilterOverdue => l10n.invFilterOverdue,
      invoiceFilterPaid => l10n.invFilterPaid,
      _ => l10n.invFilterAll,
    };

// ---------------------------------------------------------------------------
// The list.
// ---------------------------------------------------------------------------

class _InvoiceCard extends StatelessWidget {
  const _InvoiceCard({required this.invoice, required this.onTap});

  final Invoice invoice;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final overdue = invoiceIsOverdue(invoice);
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
                    invoice.displayName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    [
                      invoice.customerName,
                      invoice.issuedOn,
                      if (invoice.isOpen && invoice.dueOn.isNotEmpty)
                        l10n.invDue(invoice.dueOn),
                    ].where((p) => p.isNotEmpty).join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  invoiceMoney(invoice.isPaid ? invoice.totalCents : invoice.balanceCents),
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    fontFeatures: const [FontFeature.tabularFigures()],
                    color: invoice.isPaid
                        ? AppColors.sage
                        : (overdue ? AppColors.errorRed : AppColors.ink),
                  ),
                ),
                const SizedBox(height: 4),
                _StatusPill(invoice: invoice),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.invoice});

  final Invoice invoice;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final overdue = invoiceIsOverdue(invoice);
    final color = invoice.isPaid
        ? AppColors.sage
        : (overdue ? AppColors.errorRed : AppColors.cobalt);
    final label = invoice.isPaid
        ? l10n.invStatusPaid
        : (overdue ? l10n.invStatusOverdue : l10n.invStatusOpen);
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

// ---------------------------------------------------------------------------
// One invoice: its lines, its payments, and the paper.
// ---------------------------------------------------------------------------

class InvoiceDetailScreen extends StatefulWidget {
  const InvoiceDetailScreen({
    super.key,
    required this.businessId,
    required this.invoiceId,
    required this.staff,
    required this.customers,
    required this.business,
    required this.onCustomerRecorded,
    this.knownCars = const [],
  });

  final String businessId;
  final String invoiceId;
  final List<LotStaff> staff;
  final List<LotCustomer> customers;
  final List<LotKnownCar> knownCars;
  final Map<String, dynamic> business;
  final VoidCallback onCustomerRecorded;

  @override
  State<InvoiceDetailScreen> createState() => _InvoiceDetailScreenState();
}

class _InvoiceDetailScreenState extends State<InvoiceDetailScreen> {
  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final List<StreamSubscription<Object?>> _subs = [];
  Invoice? _invoice;
  List<InvoiceLine> _lines = const [];
  List<InvoicePayment> _payments = const [];
  bool _loaded = false;
  String _busy = '';

  @override
  void initState() {
    super.initState();
    _subs.add(_db.collection('invoices').doc(widget.invoiceId).snapshots().listen(
      (doc) {
        if (!mounted) return;
        setState(() {
          _invoice = doc.exists ? Invoice.fromMap(doc.id, doc.data()!) : null;
          _loaded = true;
        });
      },
      onError: (_) {
        if (mounted) setState(() => _loaded = true);
      },
    ));
    _subs.add(_db
        .collection('invoiceLines')
        .where('invoiceId', isEqualTo: widget.invoiceId)
        .snapshots()
        .listen((snap) {
      if (!mounted) return;
      setState(() => _lines = [
            for (final d in snap.docs) InvoiceLine.fromMap(d.id, d.data()),
          ]..sort((a, b) => (a.createdAt ?? DateTime(0))
              .compareTo(b.createdAt ?? DateTime(0))));
    }, onError: (_) {}));
    _subs.add(_db
        .collection('invoicePayments')
        .where('invoiceId', isEqualTo: widget.invoiceId)
        .snapshots()
        .listen((snap) {
      if (!mounted) return;
      setState(() => _payments = [
            for (final d in snap.docs) InvoicePayment.fromMap(d.id, d.data()),
          ]..sort((a, b) => (a.createdAt ?? DateTime(0))
              .compareTo(b.createdAt ?? DateTime(0))));
    }, onError: (_) {}));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  String get _businessName =>
      (widget.business['name'] ?? widget.business['businessName'] ?? '')
          .toString();

  Future<void> _run(
    String action,
    Future<void> Function() work, {
    String? done,
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
      showErrorSnackBar(
          context, _serverRefusalText(l10n, error.message ?? ''));
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _edit() async {
    final invoice = _invoice;
    if (invoice == null) return;
    final saved = await showLotSheet<String>(
      context,
      _InvoiceFormSheet(
        businessId: widget.businessId,
        customers: widget.customers,
        existing: invoice,
      ),
    );
    if (saved != null) widget.onCustomerRecorded();
  }

  Future<void> _addLine() async {
    final invoice = _invoice;
    if (invoice == null) return;
    await showLotSheet<bool>(
      context,
      _LineFormSheet(
        businessId: widget.businessId,
        invoice: invoice,
        knownCars: widget.knownCars,
      ),
    );
  }

  Future<void> _editLine(InvoiceLine line) async {
    final invoice = _invoice;
    if (invoice == null) return;
    await showLotSheet<bool>(
      context,
      _LineFormSheet(
        businessId: widget.businessId,
        invoice: invoice,
        knownCars: widget.knownCars,
        existing: line,
      ),
    );
  }

  Future<void> _lineActions(InvoiceLine line) async {
    final l10n = AppLocalizations.of(context)!;
    final action = await pickLotOption<String>(
      context,
      title: line.description,
      options: [
        LotOption('edit', l10n.invEditLine),
        LotOption('remove', l10n.invRemoveLine),
      ],
    );
    if (action == null || !mounted) return;
    if (action == 'edit') {
      await _editLine(line);
    } else {
      final ok = await confirmMajorAction(
        context,
        title: l10n.invRemoveLine,
        message: l10n.invRemoveLineMessage,
        confirmLabel: l10n.ctrRemove,
        destructive: true,
      );
      if (!ok || !mounted) return;
      await _run('remove', () async {
        await FirebaseFunctions.instance
            .httpsCallable('removeInvoiceLine')
            .call<Object?>({
          'businessId': widget.businessId,
          'invoiceId': widget.invoiceId,
          'lineId': line.id,
        });
      }, done: l10n.invLineRemoved);
    }
  }

  Future<void> _recordPayment() async {
    final invoice = _invoice;
    if (invoice == null) return;
    final totals = invoiceTotals(_lines, _payments);
    await showLotSheet<bool>(
      context,
      _PaymentFormSheet(
        businessId: widget.businessId,
        invoice: invoice,
        lines: _lines,
        balanceCents: totals.balanceCents,
      ),
    );
  }

  Future<void> _revertPayment(InvoicePayment payment) async {
    final l10n = AppLocalizations.of(context)!;
    final ok = await confirmMajorAction(
      context,
      title: l10n.invRevertPayment,
      message: l10n.invRevertMessage,
      confirmLabel: l10n.invRevertPayment,
      destructive: true,
    );
    if (!ok || !mounted) return;
    await _run('revert', () async {
      await FirebaseFunctions.instance
          .httpsCallable('revertInvoicePayment')
          .call<Object?>({
        'businessId': widget.businessId,
        'invoiceId': widget.invoiceId,
        'paymentId': payment.id,
      });
    }, done: l10n.invPaymentReverted);
  }

  Future<void> _delete() async {
    final l10n = AppLocalizations.of(context)!;
    final invoice = _invoice;
    if (invoice == null) return;
    final ok = await confirmMajorAction(
      context,
      title: l10n.invDelete,
      message: l10n.invDeleteMessage,
      confirmLabel: l10n.invDelete,
      destructive: true,
    );
    if (!ok || !mounted) return;
    await _run('delete', () async {
      await FirebaseFunctions.instance
          .httpsCallable('deleteInvoice')
          .call<Object?>({
        'businessId': widget.businessId,
        'invoiceId': widget.invoiceId,
      });
      if (!mounted) return;
      Navigator.of(context).pop();
    }, done: l10n.invDeleted);
  }

  Future<void> _savePdf() async {
    final l10n = AppLocalizations.of(context)!;
    final invoice = _invoice;
    if (invoice == null) return;
    await _run('pdf', () async {
      final bytes = await buildInvoicePdf(
        business: {...widget.business, 'name': _businessName},
        invoice: invoice,
        lines: _lines,
        payments: _payments,
        copy: InvoicePdfCopy(
          invoice: l10n.invPdfInvoice,
          receipt: l10n.invPdfReceipt,
          billedTo: l10n.invPdfBilledTo,
          date: l10n.invPdfDate,
          due: l10n.invPdfDue,
          paidOn: l10n.invPdfPaidOn,
          description: l10n.invPdfDescription,
          qty: l10n.invPdfQty,
          each: l10n.invPdfEach,
          amount: l10n.invPdfAmount,
          total: l10n.invPdfTotal,
          paid: l10n.invPdfPaid,
          balanceDue: l10n.invPdfBalanceDue,
          paidInFull: l10n.invPdfPaidInFull,
          notes: l10n.invPdfNotes,
          payments: l10n.invPdfPayments,
          issuedBy: l10n.invPdfIssuedBy,
          customer: l10n.invPdfCustomer,
          footer: l10n.invPdfFooter,
          methodLabel: (m) => _methodLabel(l10n, m),
          forLine: l10n.invPdfFor,
        ),
      );
      await shareInvoicePdf(bytes, invoiceFileName(invoice, _businessName));
    });
  }

  Future<void> _shareText() async {
    final invoice = _invoice;
    if (invoice == null) return;
    final text = invoiceTextSummary(
      invoice: invoice,
      lines: _lines,
      payments: _payments,
      businessName: _businessName,
    );
    await _run('text', () async {
      await SharePlus.instance.share(ShareParams(text: text));
    });
  }

  void _history() {
    showLotSheet<void>(
      context,
      LotHistorySheet(
        businessId: widget.businessId,
        entityId: widget.invoiceId,
        staff: widget.staff,
      ),
    );
  }

  String _staffName(String id) =>
      widget.staff.where((s) => s.id == id).firstOrNull?.name ?? '';

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final invoice = _invoice;
    if (invoice == null) {
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
                        icon: Icons.receipt_long_outlined,
                        title: l10n.invNotFound,
                      )
                    : const Center(child: CircularProgressIndicator()),
              ),
            ],
          ),
        ),
      );
    }
    final totals = invoiceTotals(_lines, _payments);
    final paid = totals.status == invoiceStatusPaid;
    final busy = _busy.isNotEmpty;
    final overdue = invoiceIsOverdue(invoice);

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
                            invoice.displayName,
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
                          Text(
                            '${paid ? l10n.invKindReceipt : l10n.invKindInvoice} · '
                            '${l10n.invFor(invoice.customerName)}',
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
                    _StatusPill(invoice: invoice),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 40),
              children: [
                // The three numbers.
                Container(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  decoration: BoxDecoration(
                    color: AppColors.paper,
                    borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                    border: Border.all(color: AppColors.rule),
                  ),
                  child: Column(
                    children: [
                      _MoneyRow(label: l10n.invTotal, value: invoiceMoney(totals.totalCents)),
                      if (totals.paidCents > 0)
                        _MoneyRow(
                          label: l10n.invPaid,
                          value: '-${invoiceMoney(totals.paidCents)}',
                          color: AppColors.sage,
                        ),
                      const Divider(height: 18),
                      _MoneyRow(
                        label: paid ? l10n.invPdfPaidInFull : l10n.invBalanceDue,
                        value: invoiceMoney(paid ? 0 : totals.balanceCents),
                        bold: true,
                        color: paid
                            ? AppColors.sage
                            : (overdue ? AppColors.errorRed : AppColors.ink),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        paid
                            ? (invoice.paidOn.isNotEmpty
                                ? l10n.invPaidOn(invoice.paidOn)
                                : l10n.invStatusPaid)
                            : (invoice.dueOn.isNotEmpty
                                ? l10n.invDue(invoice.dueOn)
                                : l10n.invNoDueDate),
                        style: const TextStyle(fontSize: 12, color: AppColors.muted),
                      ),
                      if (invoice.notes.isNotEmpty) ...[
                        const SizedBox(height: AppSpacing.sm),
                        Text(
                          invoice.notes,
                          style: const TextStyle(fontSize: 12.5, color: AppColors.muted, height: 1.4),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                // What can be done with it.
                Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: AppSpacing.sm,
                  children: [
                    if (!paid && totals.balanceCents > 0)
                      _Action(
                        key: const Key('invoice-record-payment'),
                        icon: Icons.payments_outlined,
                        label: l10n.invRecordPayment,
                        primary: true,
                        busy: _busy == 'payment',
                        onTap: busy ? null : _recordPayment,
                      ),
                    _Action(
                      key: const Key('invoice-save-pdf'),
                      icon: Icons.picture_as_pdf_outlined,
                      label: l10n.invSavePdf,
                      busy: _busy == 'pdf',
                      onTap: busy ? null : _savePdf,
                    ),
                    _Action(
                      icon: Icons.chat_outlined,
                      label: l10n.invShareText,
                      busy: _busy == 'text',
                      onTap: busy ? null : _shareText,
                    ),
                    _Action(
                      icon: Icons.edit_outlined,
                      label: l10n.invEdit,
                      onTap: busy ? null : _edit,
                    ),
                    _Action(
                      icon: Icons.history,
                      label: l10n.invHistory,
                      onTap: _history,
                    ),
                    if (_lines.isEmpty && _payments.isEmpty)
                      _Action(
                        icon: Icons.delete_outline,
                        label: l10n.invDelete,
                        destructive: true,
                        busy: _busy == 'delete',
                        onTap: busy ? null : _delete,
                      ),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
                _SectionTitle(
                  title: l10n.invLines,
                  count: _lines.length,
                  action: l10n.invAddLine,
                  onAction: busy ? null : _addLine,
                ),
                if (_lines.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
                    child: Text(l10n.invNoLines,
                        style: const TextStyle(fontSize: 13, color: AppColors.muted)),
                  )
                else
                  for (final line in _lines)
                    _LineTile(
                      line: line,
                      onTap: busy ? null : () => _lineActions(line),
                    ),
                const SizedBox(height: AppSpacing.lg),
                _SectionTitle(title: l10n.invPayments, count: totals.paymentCount),
                if (_payments.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
                    child: Text(l10n.invNoPayments,
                        style: const TextStyle(fontSize: 13, color: AppColors.muted)),
                  )
                else
                  for (final p in _payments)
                    _PaymentTile(
                      payment: p,
                      receivedBy: _staffName(p.receivedByStaffId),
                      onRevert: busy || p.reverted ? null : () => _revertPayment(p),
                    ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MoneyRow extends StatelessWidget {
  const _MoneyRow({
    required this.label,
    required this.value,
    this.bold = false,
    this.color,
  });

  final String label;
  final String value;
  final bool bold;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontSize: bold ? 17 : 13.5,
      fontWeight: bold ? FontWeight.w800 : FontWeight.w500,
      fontFeatures: const [FontFeature.tabularFigures()],
      color: color ?? (bold ? AppColors.ink : AppColors.muted),
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [Text(label, style: style), Text(value, style: style)],
      ),
    );
  }
}

class _Action extends StatelessWidget {
  const _Action({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.primary = false,
    this.destructive = false,
    this.busy = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool primary;
  final bool destructive;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final color = destructive
        ? AppColors.errorRed
        : (primary ? Colors.white : AppColors.ink);
    return PressableScale(
      onTap: onTap == null
          ? null
          : () {
              AppHaptics.selection();
              onTap!();
            },
      scale: 0.96,
      child: Opacity(
        opacity: onTap == null && !busy ? 0.55 : 1,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: primary ? AppColors.cobalt : AppColors.paper,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(
              color: primary
                  ? AppColors.cobalt
                  : (destructive
                      ? AppColors.errorRed.withValues(alpha: 0.4)
                      : AppColors.rule),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (busy)
                SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2, color: color),
                )
              else
                Icon(icon, size: 16, color: color),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({
    required this.title,
    required this.count,
    this.action,
    this.onAction,
  });

  final String title;
  final int count;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          title.toUpperCase(),
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.6,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(width: 6),
        Text(
          '$count',
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: AppColors.muted,
          ),
        ),
        const Spacer(),
        if (action != null)
          TextButton.icon(
            key: const Key('invoice-add-line'),
            onPressed: onAction,
            icon: const Icon(Icons.add, size: 16),
            label: Text(action!),
          ),
      ],
    );
  }
}

class _LineTile extends StatelessWidget {
  const _LineTile({required this.line, required this.onTap});

  final InvoiceLine line;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
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
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    line.description,
                    style: const TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    [
                      if (line.quantity > 1 || line.unitPriceCents != line.amountCents)
                        l10n.invLineEach(line.quantity, invoiceMoney(line.unitPriceCents)),
                      if (line.vinNumber.isNotEmpty) 'VIN ${line.vinNumber}',
                    ].join(' · '),
                    style: const TextStyle(fontSize: 12, color: AppColors.muted),
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Text(
              invoiceMoney(line.amountCents),
              style: const TextStyle(
                fontSize: 14.5,
                fontWeight: FontWeight.w700,
                fontFeatures: [FontFeature.tabularFigures()],
                color: AppColors.ink,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PaymentTile extends StatelessWidget {
  const _PaymentTile({
    required this.payment,
    required this.receivedBy,
    required this.onRevert,
  });

  final InvoicePayment payment;
  final String receivedBy;
  final VoidCallback? onRevert;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final muted = payment.reverted;
    return Container(
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
                  '${payment.paidOn} · ${_methodLabel(l10n, payment.method)}',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: muted ? AppColors.muted : AppColors.ink,
                    decoration: muted ? TextDecoration.lineThrough : null,
                  ),
                ),
                if (receivedBy.isNotEmpty ||
                    payment.note.isNotEmpty ||
                    payment.forDescription.isNotEmpty ||
                    muted)
                  Text(
                    [
                      if (muted) l10n.invReverted,
                      if (payment.forDescription.isNotEmpty)
                        l10n.invPayForLine(payment.forDescription),
                      if (payment.note.isNotEmpty) payment.note,
                      if (receivedBy.isNotEmpty) receivedBy,
                    ].join(' · '),
                    style: const TextStyle(fontSize: 12, color: AppColors.muted),
                  ),
              ],
            ),
          ),
          Text(
            invoiceMoney(payment.amountCents),
            style: TextStyle(
              fontSize: 14.5,
              fontWeight: FontWeight.w700,
              fontFeatures: const [FontFeature.tabularFigures()],
              color: muted ? AppColors.muted : AppColors.sage,
              decoration: muted ? TextDecoration.lineThrough : null,
            ),
          ),
          if (onRevert != null)
            IconButton(
              tooltip: l10n.invRevertPayment,
              icon: const Icon(Icons.undo, size: 18, color: AppColors.muted),
              onPressed: onRevert,
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sheets.
// ---------------------------------------------------------------------------

/// Open or edit an invoice: who it is for and when it is due.
class _InvoiceFormSheet extends StatefulWidget {
  const _InvoiceFormSheet({
    required this.businessId,
    required this.customers,
    this.existing,
  });

  final String businessId;
  final List<LotCustomer> customers;
  final Invoice? existing;

  @override
  State<_InvoiceFormSheet> createState() => _InvoiceFormSheetState();
}

class _InvoiceFormSheetState extends State<_InvoiceFormSheet> {
  late final _title = TextEditingController(text: widget.existing?.title ?? '');
  late final _customer =
      TextEditingController(text: widget.existing?.customerName ?? '');
  late final _phone =
      TextEditingController(text: widget.existing?.customerPhone ?? '');
  late final _email =
      TextEditingController(text: widget.existing?.customerEmail ?? '');
  late final _notes = TextEditingController(text: widget.existing?.notes ?? '');
  late String _issuedOn = widget.existing?.issuedOn ?? invoiceTodayKey();
  late String _dueOn = widget.existing?.dueOn ?? '';
  Set<String> _errors = {};
  String _serverNote = '';
  bool _busy = false;
  List<LotCustomer> _suggestions = const [];

  @override
  void dispose() {
    for (final c in [_title, _customer, _phone, _email, _notes]) {
      c.dispose();
    }
    super.dispose();
  }

  InvoiceDraft get _draft => InvoiceDraft(
        title: _title.text,
        customerName: _customer.text,
        customerPhone: _phone.text,
        customerEmail: _email.text,
        issuedOn: _issuedOn,
        dueOn: _dueOn,
        notes: _notes.text,
      );

  Future<void> _pickDay(bool due) async {
    final current = due ? _dueOn : _issuedOn;
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(current) ?? DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (picked == null || !mounted) return;
    setState(() {
      final key = invoiceTodayKey(picked);
      if (due) {
        _dueOn = key;
      } else {
        _issuedOn = key;
      }
      _errors = {..._errors}
        ..remove('due_before_issued')
        ..remove('due_on_invalid')
        ..remove('issued_on_invalid');
    });
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    final draft = _draft;
    final errors = validateInvoice(draft).toSet();
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
      final existing = widget.existing;
      if (existing == null) {
        final result = await FirebaseFunctions.instance
            .httpsCallable('createInvoice')
            .call<Object?>({
          'businessId': widget.businessId,
          ...invoicePayload(draft),
        });
        if (!mounted) return;
        AppHaptics.commit();
        final data = result.data;
        final id = data is Map ? (data['invoiceId'] ?? '').toString() : '';
        Navigator.of(context).pop(id);
        showSuccessSnackBar(context, l10n.invOpened);
      } else {
        await FirebaseFunctions.instance
            .httpsCallable('updateInvoice')
            .call<Object?>({
          'businessId': widget.businessId,
          'invoiceId': existing.id,
          'changes': invoicePayload(draft),
        });
        if (!mounted) return;
        AppHaptics.commit();
        Navigator.of(context).pop(existing.id);
        showSuccessSnackBar(context, l10n.invUpdated);
      }
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _serverNote = _serverRefusalText(l10n, error.message ?? ''));
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
        _errors.contains(code) ? _errorText(l10n, code) : null;
    void clear(String code) {
      if (_errors.contains(code)) {
        setState(() => _errors = {..._errors}..remove(code));
      }
    }

    return LotSheetShell(
      title: widget.existing == null ? l10n.invNew : l10n.invEdit,
      subtitle: widget.existing?.displayName,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            _RefusalNote(text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            label: widget.existing == null ? l10n.invOpen : l10n.invSave,
            busy: _busy,
            busyLabel: widget.existing == null ? l10n.invOpening : l10n.invSaving,
            onTap: _submit,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('invoice-title'),
            controller: _title,
            autofocus: widget.existing == null,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => clear('title_required'),
            decoration: InputDecoration(
              labelText: l10n.invFormTitle,
              hintText: l10n.invFormTitleHint,
              errorText: errorFor('title_required'),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('invoice-customer'),
            controller: _customer,
            textCapitalization: TextCapitalization.words,
            onChanged: (value) {
              clear('customer_name_required');
              setState(() => _suggestions =
                  matchLotCustomers(widget.customers, value).toList());
            },
            decoration: InputDecoration(
              labelText: l10n.lotCustomer,
              errorText: errorFor('customer_name_required'),
            ),
          ),
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
                    onTap: () => setState(() {
                      _customer.text = c.name;
                      if (c.phone.isNotEmpty) _phone.text = c.phone;
                      if (c.email.isNotEmpty) _email.text = c.email;
                      _suggestions = const [];
                      _errors = {..._errors}..remove('customer_name_required');
                    }),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.md, vertical: 7),
                      decoration: BoxDecoration(
                        color: AppColors.mist,
                        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
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
            decoration: InputDecoration(labelText: l10n.lotPhone),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: InputDecoration(labelText: l10n.invFormEmail),
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            label: l10n.invFormIssuedOn,
            value: _issuedOn,
            placeholder: l10n.invFormIssuedOn,
            onTap: () => _pickDay(false),
            error: errorFor('issued_on_invalid'),
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            label: l10n.invFormDueOn,
            value: _dueOn.isEmpty ? null : _dueOn,
            placeholder: l10n.invFormDueHint,
            onTap: () => _pickDay(true),
            error: errorFor('due_on_invalid') ?? errorFor('due_before_issued'),
          ),
          if (_dueOn.isNotEmpty)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: () => setState(() => _dueOn = ''),
                child: Text(l10n.invNoDueDate),
              ),
            ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _notes,
            maxLines: 3,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: l10n.invFormNotes),
          ),
        ],
      ),
    );
  }
}

/// Add or edit a line: what it is, how many, the price for one.
class _LineFormSheet extends StatefulWidget {
  const _LineFormSheet({
    required this.businessId,
    required this.invoice,
    this.knownCars = const [],
    this.existing,
  });

  final String businessId;
  final Invoice invoice;
  final List<LotKnownCar> knownCars;
  final InvoiceLine? existing;

  @override
  State<_LineFormSheet> createState() => _LineFormSheetState();
}

class _LineFormSheetState extends State<_LineFormSheet> {
  late final _description =
      TextEditingController(text: widget.existing?.description ?? '');
  late final _quantity =
      TextEditingController(text: '${widget.existing?.quantity ?? 1}');
  late final _unit = TextEditingController(
      text: widget.existing == null
          ? ''
          : invoiceCentsToInput(widget.existing!.unitPriceCents));
  late final _vin = TextEditingController(text: widget.existing?.vinNumber ?? '');
  Set<String> _errors = {};
  String _serverNote = '';
  bool _busy = false;
  int _addedThisSitting = 0;

  final VinDecoderService _vinDecoder = NhtsaVinDecoderService();
  String _vinHint = '';
  bool _vinBusy = false;
  String _decodedVin = '';

  @override
  void dispose() {
    for (final c in [_description, _quantity, _unit, _vin]) {
      c.dispose();
    }
    super.dispose();
  }

  /// The VIN is the vehicle's identity, so typing one should end the typing:
  /// the business's own records first (a parked car, a past job), then the
  /// decoder. The description is filled only while it is empty, so a name
  /// the person already chose is never overwritten.
  void _applyVin(String raw) {
    final l10n = AppLocalizations.of(context)!;
    var clean = raw.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');
    if (clean.length > invoiceMaxVin) clean = clean.substring(0, invoiceMaxVin);
    if (clean != _vin.text) {
      _vin.value = TextEditingValue(
        text: clean,
        selection: TextSelection.collapsed(offset: clean.length),
      );
    }
    if (_errors.contains('vin_invalid')) {
      setState(() => _errors = {..._errors}..remove('vin_invalid'));
    }
    final known = lotFindKnownCar(clean, widget.knownCars);
    if (known != null && known.hasVehicle) {
      setState(() {
        final car = [known.year, known.make, known.model]
            .where((p) => p.isNotEmpty)
            .join(' ');
        if (_description.text.trim().isEmpty) _description.text = car;
        _vinHint = l10n.lotVinMatchedExisting;
      });
      return;
    }
    if (_vinHint.isNotEmpty) setState(() => _vinHint = '');
    if (clean.length == invoiceMaxVin && clean != _decodedVin) _decodeVin(clean);
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
        final car = [decoded.year, decoded.make, decoded.model]
            .map((p) => (p ?? '').trim())
            .where((p) => p.isNotEmpty)
            .join(' ');
        if (car.isNotEmpty && _description.text.trim().isEmpty) {
          _description.text = car;
        }
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

  InvoiceLineDraft get _draft => InvoiceLineDraft(
        description: _description.text,
        quantity: int.tryParse(_quantity.text.trim()) ?? 0,
        unitPriceCents: invoiceDollarsToCents(_unit.text),
        vinNumber: _vin.text,
      );

  Future<void> _submit({bool andAnother = false}) async {
    final l10n = AppLocalizations.of(context)!;
    final draft = _draft;
    final errors = validateInvoiceLine(draft).toSet();
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
      final existing = widget.existing;
      await FirebaseFunctions.instance
          .httpsCallable(existing == null ? 'addInvoiceLine' : 'updateInvoiceLine')
          .call<Object?>({
        'businessId': widget.businessId,
        'invoiceId': widget.invoice.id,
        if (existing != null) 'lineId': existing.id,
        'line': invoiceLinePayload(draft),
      });
      if (!mounted) return;
      AppHaptics.commit();
      if (andAnother) {
        setState(() {
          _addedThisSitting += 1;
          _description.clear();
          _quantity.text = '1';
          _unit.clear();
          _vin.clear();
          _errors = {};
        });
        return;
      }
      Navigator.of(context).pop(true);
      showSuccessSnackBar(
          context, existing == null ? l10n.invLineAdded : l10n.invLineUpdated);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _serverNote = _serverRefusalText(l10n, error.message ?? ''));
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
        _errors.contains(code) ? _errorText(l10n, code) : null;
    void clear(String code) {
      if (_errors.contains(code)) {
        setState(() => _errors = {..._errors}..remove(code));
      }
    }

    final editing = widget.existing != null;
    return LotSheetShell(
      title: editing ? l10n.invEditLine : l10n.invAddLine,
      subtitle: widget.invoice.displayName,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            _RefusalNote(text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          if (!editing) ...[
            LotSheetButton(
              key: const Key('line-save-and-another'),
              label: l10n.invSaveAndAnother,
              busy: _busy,
              busyLabel: l10n.invSaving,
              onTap: () => _submit(andAnother: true),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            label: editing
                ? l10n.invSave
                : (_addedThisSitting > 0 ? l10n.invAddAndClose : l10n.invAddLine),
            busy: _busy,
            busyLabel: l10n.invSaving,
            onTap: _submit,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('line-vin'),
            controller: _vin,
            autofocus: !editing,
            textCapitalization: TextCapitalization.characters,
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9]')),
              LengthLimitingTextInputFormatter(invoiceMaxVin),
            ],
            onChanged: _applyVin,
            decoration: InputDecoration(
              labelText: l10n.invLineVinFirst,
              helperText: _vinBusy
                  ? l10n.lotDecodingVin
                  : (_vinHint.isEmpty ? l10n.invLineVinFills : _vinHint),
              helperStyle: _vinHint.isEmpty && !_vinBusy
                  ? null
                  : const TextStyle(
                      color: AppColors.sage,
                      fontWeight: FontWeight.w600,
                    ),
              helperMaxLines: 2,
              errorText: errorFor('vin_invalid'),
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
            key: const Key('line-description'),
            controller: _description,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => clear('description_required'),
            decoration: InputDecoration(
              labelText: l10n.invLineWhat,
              hintText: l10n.invLineWhatHint,
              errorText: errorFor('description_required'),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  key: const Key('line-quantity'),
                  controller: _quantity,
                  keyboardType: TextInputType.number,
                  onChanged: (_) => clear('quantity_required'),
                  decoration: InputDecoration(
                    labelText: l10n.invLineQty,
                    errorText: errorFor('quantity_required'),
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                flex: 2,
                child: TextField(
                  key: const Key('line-unit-price'),
                  controller: _unit,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  onChanged: (_) {
                    clear('unit_price_invalid');
                    clear('amount_too_large');
                  },
                  decoration: InputDecoration(
                    labelText: l10n.invLineUnit,
                    errorText:
                        errorFor('unit_price_invalid') ?? errorFor('amount_too_large'),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Record a payment against what is still owed.
class _PaymentFormSheet extends StatefulWidget {
  const _PaymentFormSheet({
    required this.businessId,
    required this.invoice,
    required this.balanceCents,
    this.lines = const [],
  });

  final String businessId;
  final Invoice invoice;
  final int balanceCents;
  final List<InvoiceLine> lines;

  @override
  State<_PaymentFormSheet> createState() => _PaymentFormSheetState();
}

class _PaymentFormSheetState extends State<_PaymentFormSheet> {
  final _amount = TextEditingController();
  final _note = TextEditingController();
  String _method = 'cash';
  String _paidOn = invoiceTodayKey();
  String _forLineId = '';
  Set<String> _errors = {};
  String _serverNote = '';
  bool _busy = false;

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  InvoicePaymentDraft get _draft => InvoicePaymentDraft(
        amountCents: invoiceDollarsToCents(_amount.text),
        method: _method,
        paidOn: _paidOn,
        note: _note.text,
        forLineId: _forLineId,
      );

  Future<void> _pickFor() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.invPayFor,
      selected: _forLineId,
      options: [
        LotOption('', l10n.invPayWholeInvoice),
        for (final line in widget.lines)
          LotOption(line.id, line.description,
              detail: invoiceMoney(line.amountCents)),
      ],
    );
    if (picked == null || !mounted) return;
    setState(() => _forLineId = picked);
  }

  Future<void> _pickMethod() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.invPayMethod,
      selected: _method,
      options: [
        for (final m in invoicePaymentMethods) LotOption(m, _methodLabel(l10n, m)),
      ],
    );
    if (picked == null || !mounted) return;
    setState(() => _method = picked);
  }

  Future<void> _pickDay() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(_paidOn) ?? DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
    );
    if (picked == null || !mounted) return;
    setState(() => _paidOn = invoiceTodayKey(picked));
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    final draft = _draft;
    final errors = validateInvoicePayment(draft, widget.balanceCents).toSet();
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
      final result = await FirebaseFunctions.instance
          .httpsCallable('recordInvoicePayment')
          .call<Object?>({
        'businessId': widget.businessId,
        'invoiceId': widget.invoice.id,
        'payment': invoicePaymentPayload(draft),
      });
      if (!mounted) return;
      AppHaptics.commit();
      final data = result.data;
      final paid = data is Map && data['status'] == invoiceStatusPaid;
      Navigator.of(context).pop(true);
      showSuccessSnackBar(
          context, paid ? l10n.invPaidInFull : l10n.invPaymentRecorded);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _serverNote = _serverRefusalText(l10n, error.message ?? ''));
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
        _errors.contains(code) ? _errorText(l10n, code) : null;

    return LotSheetShell(
      title: l10n.invRecordPayment,
      subtitle: l10n.invPayStillOwed(invoiceMoney(widget.balanceCents)),
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            _RefusalNote(text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            label: l10n.invRecordPayment,
            busy: _busy,
            busyLabel: l10n.invSaving,
            tone: LotTone.good,
            onTap: _submit,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('payment-amount'),
            controller: _amount,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() => _errors = {..._errors}
              ..remove('amount_required')
              ..remove('payment_exceeds_balance')
              ..remove('amount_too_large')),
            decoration: InputDecoration(
              labelText: l10n.invPayAmount,
              errorText: errorFor('amount_required') ??
                  errorFor('payment_exceeds_balance') ??
                  errorFor('amount_too_large'),
            ),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              key: const Key('payment-whole-balance'),
              onPressed: () => setState(() {
                _amount.text = invoiceCentsToInput(widget.balanceCents);
                _errors = {};
              }),
              child: Text(l10n.invPayWhole),
            ),
          ),
          LotPickerField(
            label: l10n.invPayMethod,
            value: _methodLabel(l10n, _method),
            placeholder: l10n.invPayMethod,
            onTap: _pickMethod,
            error: errorFor('payment_method_invalid'),
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            label: l10n.invPayDate,
            value: _paidOn,
            placeholder: l10n.invPayDate,
            onTap: _pickDay,
            error: errorFor('paid_on_invalid'),
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            label: l10n.invPayFor,
            value: _forLineId.isEmpty
                ? l10n.invPayWholeInvoice
                : (widget.lines
                        .where((l) => l.id == _forLineId)
                        .firstOrNull
                        ?.description ??
                    l10n.invPayWholeInvoice),
            placeholder: l10n.invPayWholeInvoice,
            onTap: _pickFor,
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _note,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: l10n.invPayNote),
          ),
        ],
      ),
    );
  }
}

class _RefusalNote extends StatelessWidget {
  const _RefusalNote({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('invoice-refusal'),
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
// Shared vocabulary.
// ---------------------------------------------------------------------------

String _methodLabel(AppLocalizations l10n, String method) => switch (method) {
      'cash' => l10n.invMethodCash,
      'zelle' => l10n.invMethodZelle,
      'cashapp' => l10n.invMethodCashapp,
      'venmo' => l10n.invMethodVenmo,
      'check' => l10n.invMethodCheck,
      'card_in_person' => l10n.invMethodCardInPerson,
      _ => l10n.invMethodOther,
    };

String _errorText(AppLocalizations l10n, String code) => switch (code) {
      'title_required' => l10n.invErrTitle,
      'customer_name_required' => l10n.invErrCustomer,
      'issued_on_invalid' => l10n.invErrIssuedOn,
      'due_on_invalid' => l10n.invErrDueOn,
      'due_before_issued' => l10n.invErrDueOrder,
      'description_required' => l10n.invErrDescription,
      'quantity_required' => l10n.invErrQuantity,
      'unit_price_invalid' => l10n.invErrUnitPrice,
      'amount_too_large' => l10n.invErrTooLarge,
      'vin_invalid' => l10n.invErrVin,
      'amount_required' => l10n.invErrAmount,
      'payment_method_invalid' => l10n.invErrMethod,
      'paid_on_invalid' => l10n.invErrPaidOn,
      'payment_exceeds_balance' => l10n.invErrExceeds,
      'invoice_has_lines' => l10n.invErrHasLines,
      'invoice_not_found' => l10n.invNotFound,
      _ => l10n.lotCouldNotSave,
    };

/// The server says its refusals in English; the phone says them in the
/// reader's language when it recognises them, and repeats them otherwise.
String _serverRefusalText(AppLocalizations l10n, String message) {
  const known = {
    'Give the invoice a short title (what it is for).': 'title_required',
    'Say who the invoice is for.': 'customer_name_required',
    'The invoice date is not a real date.': 'issued_on_invalid',
    'The due date is not a real date.': 'due_on_invalid',
    'The due date is before the invoice date.': 'due_before_issued',
    'Say what the line is.': 'description_required',
    'Enter how many (at least one).': 'quantity_required',
    'Enter the price for one.': 'unit_price_invalid',
    'That amount is larger than an invoice can carry.': 'amount_too_large',
    'A VIN is 17 letters and digits.': 'vin_invalid',
    'Enter the amount received.': 'amount_required',
    'Say how the payment arrived.': 'payment_method_invalid',
    'The payment date is not a real date.': 'paid_on_invalid',
    'That is more than what is still owed.': 'payment_exceeds_balance',
    'That invoice no longer exists.': 'invoice_not_found',
    'Remove the lines and payments before deleting.': 'invoice_has_lines',
  };
  final trimmed = message.trim();
  final code = known[trimmed];
  if (code != null) return _errorText(l10n, code);
  return trimmed.isEmpty ? l10n.lotCouldNotSave : trimmed;
}
