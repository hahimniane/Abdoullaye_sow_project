import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import 'my_purchases_screen.dart' show PurchaseListScope;
import '../models/business_profile.dart';
import '../models/car_purchase.dart';
import '../providers/auth_provider.dart';
import '../services/business_activity_queries.dart';
import '../services/business_service.dart';
import '../services/car_viewing_service.dart';
import '../theme/app_colors.dart';
import '../utils/action_confirmation.dart';
import '../utils/car_purchase_localization.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/car_viewing_negotiation.dart';
import '../widgets/language_toggle.dart';
import '../widgets/support_entry_button.dart';

class StaffPurchaseManagementScreen extends StatefulWidget {
  const StaffPurchaseManagementScreen({super.key});

  @override
  State<StaffPurchaseManagementScreen> createState() =>
      _StaffPurchaseManagementScreenState();
}

/// What the list reads: whose purchases, in which state, how many pages.
/// The scope a business user sees is always their own business; a platform
/// admin reads across businesses until one is chosen.
@immutable
class PurchaseListQuery {
  const PurchaseListQuery({
    required this.businessId,
    required this.status,
    required this.pages,
  });

  final String businessId;
  final String status;
  final int pages;

  @override
  bool operator ==(Object other) =>
      other is PurchaseListQuery &&
      other.businessId == businessId &&
      other.status == status &&
      other.pages == pages;

  @override
  int get hashCode => Object.hash(businessId, status, pages);
}

/// The business an admin's list is confined to, or '' for every business.
/// A business user is always confined to their own; one with no business
/// reads nothing (null).
String? purchaseListBusinessId({
  required bool isAdmin,
  required String? ownBusinessId,
  required String? chosenBusinessId,
}) {
  if (isAdmin) return (chosenBusinessId ?? '').trim();
  final own = (ownBusinessId ?? '').trim();
  return own.isEmpty ? null : own;
}

class _StaffPurchaseManagementScreenState
    extends State<StaffPurchaseManagementScreen> {
  // Staff work both queues from this screen, so they stay side by side rather
  // than becoming separate destinations: a viewing request and the hold on the
  // same car are usually looked at together.
  PurchaseListScope _scope = PurchaseListScope.purchases;

  bool get _isViewings => _scope == PurchaseListScope.viewings;

  /// An admin's chosen business ('' is every business) and the state filter
  /// ('' is every state). Both narrow the query itself, not the page.
  String _chosenBusinessId = '';
  String _status = '';
  int _pages = 1;

  Future<void> _callPurchaseAction(
    BuildContext context,
    String functionName,
    Map<String, dynamic> data,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    try {
      await FirebaseFunctions.instance.httpsCallable(functionName).call(data);
      if (!context.mounted) return;
      showSuccessSnackBar(context, l10n.purchaseUpdated);
    } catch (e) {
      if (!context.mounted) return;
      showErrorSnackBar(context, l10n.operationFailed('$e'));
    }
  }

  Future<void> _markPaidHoldSold(
    BuildContext context,
    CarPurchase purchase,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.purchaseMarkSoldTitle,
      message: l10n.purchaseMarkSoldMessage(purchase.carTitle),
      confirmLabel: l10n.completed,
      icon: Icons.sell_outlined,
    );
    if (!confirmed || !context.mounted) return;
    await _callPurchaseAction(context, 'markPaidHoldSold', {
      'purchaseId': purchase.id,
    });
  }

  Future<void> _markPaidHoldNoShow(
    BuildContext context,
    CarPurchase purchase,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.purchaseNoShowTitle,
      message: l10n.purchaseNoShowMessage(purchase.carTitle),
      confirmLabel: l10n.customerDidNotCome,
      icon: Icons.person_off_outlined,
      destructive: true,
    );
    if (!confirmed || !context.mounted) return;
    await _callPurchaseAction(context, 'markPaidHoldNoShow', {
      'purchaseId': purchase.id,
    });
  }

  Future<void> _decideExtension(
    BuildContext context,
    CarPurchase purchase,
    String decision,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    final approve = decision == 'approved';
    final confirmed = await confirmMajorAction(
      context,
      title: approve
          ? l10n.purchaseApproveExtensionTitle
          : l10n.purchaseRejectExtensionTitle,
      message: approve
          ? l10n.purchaseApproveExtensionMessage
          : l10n.purchaseRejectExtensionMessage,
      confirmLabel: approve ? l10n.purchaseApprove : l10n.purchaseReject,
      icon: approve ? Icons.check_circle_outline : Icons.cancel_outlined,
      destructive: !approve,
    );
    if (!confirmed || !context.mounted) return;
    await _callPurchaseAction(context, 'decidePaidHoldExtension', {
      'purchaseId': purchase.id,
      'decision': decision,
    });
  }

  Future<void> _updateStatus(
    BuildContext context,
    CarPurchase purchase,
    String status,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.updatePurchaseStatusQuestion,
      message: l10n.updatePurchaseStatusMessage(
        purchase.carTitle,
        carPurchaseStatusLabel(l10n, status),
      ),
      confirmLabel: l10n.updateStatus,
      icon: Icons.receipt_long_outlined,
      destructive: status == 'cancelled',
    );
    if (!confirmed || !context.mounted) return;
    if (purchase.purchaseStatus == 'forfeited' && status == 'completed') {
      showErrorSnackBar(
        context,
        l10n.purchaseForfeitedCannotComplete,
        feedback: false,
      );
      return;
    }

    // Completed / cancelled are terminal: they move the car, may queue a
    // deposit refund, and close the record for good. Firestore rules refuse
    // them as a raw client write, so they go through the same guarded callable
    // the business console uses (`businessFinalizeCarPurchase`), which
    // re-checks the state machine and payment inside a transaction. A cancel
    // of a paid deposit queues the refund there, so there is no separate
    // "refunded" write from the app.
    await _callPurchaseAction(context, 'businessFinalizeCarPurchase', {
      'purchaseId': purchase.id,
      'outcome': status,
    });
  }

  /// Made once per query, not per build. Switching the purchases/viewings
  /// segment is a setState, and a stream built in `build` dropped the
  /// listener and re-read the list on each tap. The list used to read every
  /// purchase on the platform for an admin; it now reads one ordered page of
  /// the chosen business and state (`carPurchasesPageSpec`), and "Load more"
  /// grows the page. StreamBuilder keeps the rows on screen while the bigger
  /// page arrives.
  Stream<QuerySnapshot<Map<String, dynamic>>>? _purchasesStream;
  PurchaseListQuery? _purchasesStreamKey;

  Stream<QuerySnapshot<Map<String, dynamic>>> _purchasesStreamFor(
    PurchaseListQuery key,
  ) {
    final existing = _purchasesStream;
    if (existing != null && _purchasesStreamKey == key) return existing;
    _purchasesStreamKey = key;
    return _purchasesStream = carPurchasesPageSpec(
      businessId: key.businessId,
      status: key.status,
      pages: key.pages,
    ).build(FirebaseFirestore.instance).snapshots();
  }

  /// Approved businesses, for an admin's business picker. Held in State.
  Stream<List<BusinessProfile>>? _businesses;

  Stream<List<BusinessProfile>> _businessesStream() =>
      _businesses ??= BusinessService().approvedBusinesses();

  void _setScope(PurchaseListScope scope) {
    setState(() {
      _scope = scope;
      final allowed = scope == PurchaseListScope.viewings
          ? carViewingStatusFilters
          : carPurchaseStatusFilters;
      if (!allowed.contains(_status)) {
        _status = '';
        _pages = 1;
      }
    });
  }

  void _setStatus(String status) {
    if (status == _status) return;
    setState(() {
      _status = status;
      _pages = 1;
    });
  }

  void _setBusiness(String businessId) {
    if (businessId == _chosenBusinessId) return;
    setState(() {
      _chosenBusinessId = businessId;
      _pages = 1;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.watch<AuthProvider>();
    final businessId = purchaseListBusinessId(
      isAdmin: auth.isAdmin,
      ownBusinessId: auth.businessId,
      chosenBusinessId: _chosenBusinessId,
    );
    final filters = PurchaseListFilters(
      businesses: auth.isAdmin ? _businessesStream() : null,
      chosenBusinessId: _chosenBusinessId,
      onBusiness: _setBusiness,
      statuses: _isViewings ? carViewingStatusFilters : carPurchaseStatusFilters,
      status: _status,
      onStatus: _setStatus,
    );
    final key = businessId == null
        ? null
        : PurchaseListQuery(
            businessId: businessId,
            status: _status,
            pages: _pages,
          );
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.purchaseReservations),
        actions: const [LanguageToggle()],
      ),
      body: key == null
          ? Center(child: Text(l10n.noPurchasesYet))
          : StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
              // A new business or state is a new list (spinner, then its
              // rows); a new page of the same list keeps its rows on screen.
              key: ValueKey('${key.businessId}|${key.status}'),
              stream: _purchasesStreamFor(key),
              builder: (context, snapshot) {
                Widget framed(Widget body, {int? purchases, int? viewings}) =>
                    Column(
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                          child: SegmentedButton<PurchaseListScope>(
                            segments: <ButtonSegment<PurchaseListScope>>[
                              ButtonSegment(
                                value: PurchaseListScope.purchases,
                                label: Text(
                                  purchases == null
                                      ? l10n.myPurchases
                                      : '${l10n.myPurchases} ($purchases)',
                                ),
                                icon: const Icon(Icons.receipt_long_outlined),
                              ),
                              ButtonSegment(
                                value: PurchaseListScope.viewings,
                                label: Text(
                                  viewings == null
                                      ? l10n.myCarViewings
                                      : '${l10n.myCarViewings} ($viewings)',
                                ),
                                icon: const Icon(
                                  Icons.event_available_outlined,
                                ),
                              ),
                            ],
                            selected: <PurchaseListScope>{_scope},
                            showSelectedIcon: false,
                            onSelectionChanged: (selection) =>
                                _setScope(selection.first),
                          ),
                        ),
                        filters,
                        Expanded(child: body),
                      ],
                    );

                if (snapshot.hasError) {
                  return framed(
                    Center(
                      child: Text(l10n.operationFailed('${snapshot.error}')),
                    ),
                  );
                }
                if (!snapshot.hasData) {
                  return framed(
                    const Center(child: CircularProgressIndicator()),
                  );
                }
                final docs = snapshot.data!.docs;
                final limit = carPurchasesPageSpec(
                  businessId: key.businessId,
                  status: key.status,
                  pages: key.pages,
                ).limit!;
                // A page shorter than its limit is everything there is.
                final pageFull = docs.length >= limit;
                final loadingMore =
                    snapshot.connectionState == ConnectionState.waiting;
                final all = docs.map(CarPurchase.fromFirestore).toList();
                final purchases =
                    all
                        .where(
                          (purchase) =>
                              purchase.isViewingReservation == _isViewings,
                        )
                        .toList()
                      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
                final viewingCount = all
                    .where((purchase) => purchase.isViewingReservation)
                    .length;
                final purchaseCount = all.length - viewingCount;
                final more = pageFull
                    ? PurchaseListLoadMore(
                        loading: loadingMore,
                        onTap: () => setState(() => _pages++),
                      )
                    : null;
                final Widget list;
                if (purchases.isEmpty) {
                  list = ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      const SizedBox(height: 48),
                      Center(
                        child: Text(
                          _isViewings
                              ? l10n.noCarViewingsYet
                              : l10n.noPurchasesYet,
                        ),
                      ),
                      if (more != null) ...[const SizedBox(height: 16), more],
                    ],
                  );
                } else {
                  list = ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: purchases.length + (more == null ? 0 : 1),
                    separatorBuilder: (_, _) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      if (index == purchases.length) return more!;
                      final purchase = purchases[index];
                      return _StaffPurchaseCard(
                        purchase: purchase,
                        onStatus: (status) =>
                            _updateStatus(context, purchase, status),
                        onMarkSold: () => _markPaidHoldSold(context, purchase),
                        onNoShow: () => _markPaidHoldNoShow(context, purchase),
                        onApproveExtension: () =>
                            _decideExtension(context, purchase, 'approved'),
                        onRejectExtension: () =>
                            _decideExtension(context, purchase, 'rejected'),
                      );
                    },
                  );
                }
                // Counts only once the whole list is here: a page's count
                // is not the business's.
                return framed(
                  list,
                  purchases: pageFull ? null : purchaseCount,
                  viewings: pageFull ? null : viewingCount,
                );
              },
            ),
    );
  }
}

/// The admin's business picker and the state chips. Both change the query.
class PurchaseListFilters extends StatelessWidget {
  const PurchaseListFilters({
    super.key,
    required this.businesses,
    required this.chosenBusinessId,
    required this.onBusiness,
    required this.statuses,
    required this.status,
    required this.onStatus,
  });

  /// Null for a business user, who only ever sees their own business.
  final Stream<List<BusinessProfile>>? businesses;
  final String chosenBusinessId;
  final ValueChanged<String> onBusiness;
  final List<String> statuses;
  final String status;
  final ValueChanged<String> onStatus;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final stream = businesses;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (stream != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: StreamBuilder<List<BusinessProfile>>(
              stream: stream,
              builder: (context, snapshot) {
                final rows = snapshot.data ?? const <BusinessProfile>[];
                // A chosen business that has since left the approved list
                // stays selectable, so the picker never shows an empty value.
                final options = <String, String>{
                  '': l10n.purchaseAllBusinesses,
                  for (final b in rows) b.id: b.name.isEmpty ? b.id : b.name,
                  if (chosenBusinessId.isNotEmpty &&
                      !rows.any((b) => b.id == chosenBusinessId))
                    chosenBusinessId: chosenBusinessId,
                };
                return DropdownButtonFormField<String>(
                  key: const Key('purchase-business-filter'),
                  initialValue: chosenBusinessId,
                  isExpanded: true,
                  decoration: InputDecoration(
                    labelText: l10n.purchaseFilterBusiness,
                    isDense: true,
                    border: const OutlineInputBorder(),
                  ),
                  items: [
                    for (final entry in options.entries)
                      DropdownMenuItem(
                        value: entry.key,
                        child: Text(
                          entry.value,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: (value) => onBusiness(value ?? ''),
                );
              },
            ),
          ),
        SizedBox(
          height: 48,
          child: ListView(
            key: const Key('purchase-status-filter'),
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            children: [
              for (final s in statuses)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    key: ValueKey('purchase-status:$s'),
                    label: Text(carPurchaseStatusLabel(l10n, s)),
                    selected: s == status,
                    onSelected: (_) => onStatus(s),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// The foot of the purchase list when there may be more.
class PurchaseListLoadMore extends StatelessWidget {
  const PurchaseListLoadMore({
    super.key,
    required this.loading,
    required this.onTap,
  });

  final bool loading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Center(
      child: OutlinedButton.icon(
        key: const Key('purchase-load-more'),
        onPressed: loading ? null : onTap,
        icon: loading
            ? const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.expand_more),
        label: Text(l10n.purchaseLoadMore),
      ),
    );
  }
}

/// One card on its own, for widget tests.
@visibleForTesting
Widget staffPurchaseCardForTesting(CarPurchase purchase) => _StaffPurchaseCard(
  purchase: purchase,
  onStatus: (_) {},
  onMarkSold: () {},
  onNoShow: () {},
  onApproveExtension: () {},
  onRejectExtension: () {},
);

class _StaffPurchaseCard extends StatelessWidget {
  const _StaffPurchaseCard({
    required this.purchase,
    required this.onStatus,
    required this.onMarkSold,
    required this.onNoShow,
    required this.onApproveExtension,
    required this.onRejectExtension,
  });

  final CarPurchase purchase;
  final ValueChanged<String> onStatus;
  final VoidCallback onMarkSold;
  final VoidCallback onNoShow;
  final VoidCallback onApproveExtension;
  final VoidCallback onRejectExtension;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final currency = NumberFormat.simpleCurrency(
      name: purchase.depositCurrency,
    );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    purchase.carTitle,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                Chip(
                  label: Text(
                    carPurchaseStatusLabel(l10n, purchase.purchaseStatus),
                  ),
                  backgroundColor: AppColors.brandRed.withValues(alpha: 0.1),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text('${l10n.customerName}: ${purchase.buyerName}'),
            Text('${l10n.customerPhone}: ${purchase.buyerPhone}'),
            Text('${l10n.customerEmail}: ${purchase.buyerEmail}'),
            if (purchase.destinationCountryName.trim().isNotEmpty)
              Text(
                '${l10n.destinationCountry}: ${purchase.destinationCountryName}',
              ),
            Text(
              l10n.depositPaid(
                currency.format(purchase.depositAmount),
                carPurchasePaymentStatusLabel(l10n, purchase.paymentStatus),
              ),
            ),
            // A viewing's appointment belongs to the negotiation panel below,
            // which knows whether it is agreed or still being argued over.
            if (purchase.appointmentStart != null &&
                !purchase.isViewingReservation)
              Text(
                '${l10n.selectViewingTime}: '
                '${purchase.appointmentLabel ?? displayDateTime(purchase.appointmentStart!, l10n.localeName)}',
              ),
            if (purchase.isViewingReservation) ...[
              const SizedBox(height: 10),
              CarViewingNegotiationPanel(
                purchase: purchase,
                party: ViewingParty.business,
              ),
            ],
            if (purchase.holdUntilDate != null)
              Text(
                l10n.holdUntilDate(
                  displayDate(purchase.holdUntilDate!, l10n.localeName),
                ),
              ),
            if (purchase.holdPricingMode != null)
              Text(
                l10n.holdPricingSummary(
                  purchase.holdPricingMode == 'per_day'
                      ? l10n.perDay
                      : l10n.flat,
                  purchase.holdDays == null
                      ? ''
                      : l10n.holdDaysSuffix(purchase.holdDays!),
                ),
              ),
            if (purchase.depositForfeitureStatus != null)
              Text(
                l10n.forfeitureStatusLabel(
                  carPurchaseForfeitureStatusLabel(
                    l10n,
                    purchase.depositForfeitureStatus!,
                  ),
                ),
              ),
            if (purchase.holdReviewRequiredAt != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: _NoticeBand(
                  icon: Icons.priority_high_outlined,
                  text: l10n.holdDateReachedStaffAction,
                  color: AppColors.warn,
                ),
              ),
            if (purchase.extensionRequestStatus != null) ...[
              const SizedBox(height: 8),
              _NoticeBand(
                icon: Icons.event_repeat_outlined,
                color: AppColors.brandRed,
                text: carPurchaseExtensionLine(
                  l10n,
                  purchase,
                  currency,
                  dateLocaleOf(context),
                ),
              ),
            ],
            if (purchase.buyerReliabilitySnapshot != null) ...[
              const SizedBox(height: 8),
              Text(
                l10n.buyerHistoryLine(
                  purchase.buyerReliabilitySnapshot!['completedHolds'] ?? 0,
                  purchase.buyerReliabilitySnapshot!['noShows'] ?? 0,
                  purchase.buyerReliabilitySnapshot!['forfeitures'] ?? 0,
                ),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (purchase.isPaidHold &&
                    (purchase.purchaseStatus == 'reserved' ||
                        purchase.purchaseStatus == 'hold_review_required')) ...[
                  FilledButton.icon(
                    onPressed: onMarkSold,
                    icon: const Icon(Icons.sell_outlined),
                    label: Text(l10n.markAsSold),
                  ),
                  if (purchase.purchaseStatus == 'hold_review_required')
                    OutlinedButton.icon(
                      onPressed: onNoShow,
                      icon: const Icon(Icons.person_off_outlined),
                      label: Text(l10n.customerDidNotCome),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.errorRed,
                      ),
                    ),
                ] else if (purchase.isViewingReservation) ...[
                  // Everything else a viewing can do - agree a time, counter,
                  // decline, cancel - goes through `actOnCarViewing` in the
                  // panel above, which notifies the buyer and keeps the two
                  // sides in step. Only "the viewing happened" is left here,
                  // and only once there is an appointment to have happened.
                  OutlinedButton(
                    onPressed: purchase.purchaseStatus == viewingScheduled
                        ? () => onStatus('completed')
                        : null,
                    child: Text(l10n.completed),
                  ),
                ] else ...[
                  OutlinedButton(
                    onPressed:
                        purchase.purchaseStatus == 'forfeited' ||
                            purchase.purchaseStatus == 'no_show'
                        ? null
                        : () => onStatus('completed'),
                    child: Text(l10n.completed),
                  ),
                  OutlinedButton(
                    onPressed: () => onStatus('cancelled'),
                    child: Text(l10n.cancelled),
                  ),
                ],
                if (purchase.extensionRequestStatus == 'pending') ...[
                  OutlinedButton.icon(
                    onPressed: onApproveExtension,
                    icon: const Icon(Icons.check_circle_outline),
                    label: Text(l10n.approveExtension),
                  ),
                  OutlinedButton.icon(
                    onPressed: onRejectExtension,
                    icon: const Icon(Icons.cancel_outlined),
                    label: Text(l10n.rejectExtension),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.errorRed,
                    ),
                  ),
                ],
                SupportEntryButton(
                  relatedCollection: 'carPurchases',
                  relatedId: purchase.id,
                  relatedLabel: purchase.carTitle,
                  subject: l10n.supportPurchaseCaseSubject(purchase.carTitle),
                  compact: true,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _NoticeBand extends StatelessWidget {
  const _NoticeBand({
    required this.icon,
    required this.text,
    required this.color,
  });

  final IconData icon;
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.22)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 8),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}
