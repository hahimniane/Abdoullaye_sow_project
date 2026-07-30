import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/customer_order.dart';
import '../providers/auth_provider.dart';
import '../services/freight_shipment_service.dart';
import '../services/shipment_tracking_service.dart';
import '../theme/app_colors.dart';
import '../utils/barrel_receipt_generator.dart';
import '../widgets/app_back_button.dart';
import '../widgets/language_toggle.dart';
import '../widgets/marketplace_transaction_disclosure.dart';
import '../widgets/shipment_tracking_section.dart';

enum _StatusFilter { inProgress, delivered, all }

const barrelTrackingCollection = 'barrelShipments';
const freightTrackingCollection = 'freightShipments';
const trackingShipmentCollections = <String>[
  barrelTrackingCollection,
  freightTrackingCollection,
];

class TrackingScreenArguments {
  const TrackingScreenArguments({this.shipmentId});

  final String? shipmentId;
}

abstract interface class CustomerTrackingRepository {
  Stream<List<CustomerTrackingShipment>> watchCustomerShipments(
    String customerUid,
  );
}

class FirestoreCustomerTrackingRepository
    implements CustomerTrackingRepository {
  FirestoreCustomerTrackingRepository({FirebaseFirestore? firestore})
    : _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _firestore;

  @override
  Stream<List<CustomerTrackingShipment>> watchCustomerShipments(
    String customerUid,
  ) {
    late StreamController<List<CustomerTrackingShipment>> controller;
    StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? barrelSub;
    StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? freightSub;
    var barrels = <CustomerTrackingShipment>[];
    var freight = <CustomerTrackingShipment>[];
    var barrelsReady = false;
    var freightReady = false;
    Object? barrelError;
    Object? freightError;

    void emitWhenReady() {
      if (!barrelsReady || !freightReady || controller.isClosed) return;
      if (barrelError != null && freightError != null) {
        controller.addError(barrelError!);
        return;
      }
      final combined = [...barrels, ...freight]
        ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
      controller.add(combined);
    }

    controller = StreamController<List<CustomerTrackingShipment>>(
      onListen: () {
        barrelSub = _firestore
            .collection(barrelTrackingCollection)
            .where('customerUid', isEqualTo: customerUid)
            .snapshots()
            .listen(
              (snapshot) {
                barrelError = null;
                barrelsReady = true;
                barrels = snapshot.docs
                    .map(CustomerTrackingShipment.fromBarrel)
                    .toList();
                emitWhenReady();
              },
              onError: (Object error) {
                barrelError = error;
                barrelsReady = true;
                barrels = const [];
                emitWhenReady();
              },
            );
        freightSub = _firestore
            .collection(freightTrackingCollection)
            .where('customerUid', isEqualTo: customerUid)
            .snapshots()
            .listen(
              (snapshot) {
                freightError = null;
                freightReady = true;
                freight = snapshot.docs
                    .map(CustomerTrackingShipment.fromFreight)
                    .toList();
                emitWhenReady();
              },
              onError: (Object error) {
                freightError = error;
                freightReady = true;
                freight = const [];
                emitWhenReady();
              },
            );
      },
      onCancel: () async {
        await barrelSub?.cancel();
        await freightSub?.cancel();
      },
    );
    return controller.stream;
  }
}

class TrackingScreen extends StatefulWidget {
  const TrackingScreen({
    super.key,
    this.showBackButton = false,
    this.repository,
    this.customerUidOverride,
    this.freightService,
    this.trackingService,
    this.focusShipmentId,
  });

  final bool showBackButton;
  final CustomerTrackingRepository? repository;
  final String? customerUidOverride;
  final FreightShipmentService? freightService;
  final ShipmentTrackingService? trackingService;
  final String? focusShipmentId;

  @override
  State<TrackingScreen> createState() => _TrackingScreenState();
}

class _TrackingScreenState extends State<TrackingScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _query = '';
  _StatusFilter _status = _StatusFilter.inProgress;
  String? _destination;
  late CustomerTrackingRepository _repository;
  String? _streamCustomerUid;
  Stream<List<CustomerTrackingShipment>>? _shipmentsStream;
  FreightShipmentService? _freightService;
  final Set<String> _balancePayments = <String>{};
  bool _showAllShipments = false;

  @override
  void initState() {
    super.initState();
    _repository = widget.repository ?? FirestoreCustomerTrackingRepository();
    _freightService = widget.freightService;
  }

  @override
  void didUpdateWidget(covariant TrackingScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.repository != widget.repository) {
      _repository = widget.repository ?? FirestoreCustomerTrackingRepository();
      _streamCustomerUid = null;
      _shipmentsStream = null;
    }
    if (oldWidget.freightService != widget.freightService) {
      _freightService = widget.freightService;
    }
    if (oldWidget.focusShipmentId != widget.focusShipmentId) {
      _showAllShipments = false;
    }
  }

  Future<void> _payFreightBalance(CustomerTrackingShipment shipment) async {
    final l10n = AppLocalizations.of(context)!;
    final marketplaceAcceptance = await confirmMarketplaceTransaction(
      context,
      providerNames: shipment.businessName,
      transactionSummary: l10n.marketplaceBalancePaymentSummary,
    );
    if (marketplaceAcceptance == null || !mounted) return;
    setState(() => _balancePayments.add(shipment.id));
    try {
      final service = _freightService ??= FreightShipmentService();
      await service.payFreightBalance(
        shipmentId: shipment.id,
        marketplaceAcceptance: marketplaceAcceptance,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(l10n.freightSettled)));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(l10n.couldNotPayBalance)));
    } finally {
      if (mounted) setState(() => _balancePayments.remove(shipment.id));
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  bool _inProgress(CustomerTrackingShipment s) =>
      s.status != 'completed' && s.status != 'cancelled';

  bool _matchesStatus(CustomerTrackingShipment s) {
    switch (_status) {
      case _StatusFilter.inProgress:
        return _inProgress(s);
      case _StatusFilter.delivered:
        return s.status == 'completed';
      case _StatusFilter.all:
        return true;
    }
  }

  bool _matchesQuery(CustomerTrackingShipment s) {
    if (_query.isEmpty) return true;
    final q = _query.toLowerCase();
    return s.trackingCode.toLowerCase().contains(q) ||
        s.receiverName.toLowerCase().contains(q) ||
        s.destinationCountryName.toLowerCase().contains(q) ||
        s.businessName.toLowerCase().contains(q);
  }

  void _clearFilters() {
    setState(() {
      _query = '';
      _searchController.clear();
      _status = _StatusFilter.all;
      _destination = null;
    });
  }

  String? get _activeFocusShipmentId {
    final shipmentId = widget.focusShipmentId?.trim();
    if (_showAllShipments || shipmentId == null || shipmentId.isEmpty) {
      return null;
    }
    return shipmentId;
  }

  CustomerTrackingShipment? _focusedShipment(
    List<CustomerTrackingShipment> shipments,
    String shipmentId,
  ) {
    for (final shipment in shipments) {
      if (shipment.id == shipmentId || shipment.trackingCode == shipmentId) {
        return shipment;
      }
    }
    return null;
  }

  Stream<List<CustomerTrackingShipment>> _streamFor(String customerUid) {
    if (_streamCustomerUid != customerUid || _shipmentsStream == null) {
      _streamCustomerUid = customerUid;
      _shipmentsStream = _repository.watchCustomerShipments(customerUid);
    }
    return _shipmentsStream!;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final user = widget.customerUidOverride == null
        ? context.watch<AuthProvider>().user
        : null;
    final customerUid = widget.customerUidOverride ?? user?.uid;

    if (customerUid == null) {
      return Scaffold(
        backgroundColor: AppColors.lightBg,
        body: SafeArea(
          child: _EmptyShipmentsState(
            title: l10n.trackShipment,
            message: l10n.signInToTrackShipments,
            actionLabel: l10n.signIn,
            onAction: () => Navigator.pushNamed(context, '/login'),
            showBackButton: widget.showBackButton,
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: StreamBuilder<List<CustomerTrackingShipment>>(
        stream: _streamFor(customerUid),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return SafeArea(
              child: _EmptyShipmentsState(
                title: l10n.trackShipment,
                icon: Icons.lock_outline,
                message: l10n.shipmentsLoadError,
                showBackButton: widget.showBackButton,
              ),
            );
          }

          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }

          final shipments = snapshot.data!;

          if (shipments.isEmpty) {
            return SafeArea(
              child: _EmptyShipmentsState(
                title: l10n.trackShipment,
                message: l10n.shipmentsAppearAfterPayment,
                actionLabel: l10n.sendBarrels,
                onAction: () => Navigator.pushNamed(context, '/barrel'),
                showBackButton: widget.showBackButton,
              ),
            );
          }

          Widget shipmentCard(
            CustomerTrackingShipment shipment, {
            bool focused = false,
          }) {
            return _ShipmentCard(
              shipment: shipment,
              focused: focused,
              balancePaymentBusy: _balancePayments.contains(shipment.id),
              onPayBalance: shipment.isFreight && shipment.balanceDue > 0
                  ? () => _payFreightBalance(shipment)
                  : null,
              trackingService: widget.trackingService,
            );
          }

          final focusShipmentId = _activeFocusShipmentId;
          if (focusShipmentId != null) {
            final focusedShipment = _focusedShipment(
              shipments,
              focusShipmentId,
            );
            return SafeArea(
              child: Column(
                children: [
                  _ShipmentsHeader(
                    title: focusedShipment?.isFreight == true
                        ? l10n.freightOrderDetails
                        : l10n.trackShipment,
                        showBackButton: widget.showBackButton,
                  ),
                  Expanded(
                    child: focusedShipment == null
                        ? _NoResults(
                            message: l10n.shipmentStillSyncing,
                            clearLabel: l10n.viewAllShipments,
                            onClear: () =>
                                setState(() => _showAllShipments = true),
                          )
                        : ListView(
                            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                            children: [
                              shipmentCard(focusedShipment, focused: true),
                              const SizedBox(height: 12),
                              Center(
                                child: TextButton.icon(
                                  onPressed: () =>
                                      setState(() => _showAllShipments = true),
                                  icon: const Icon(
                                    Icons.format_list_bulleted_outlined,
                                    size: 18,
                                  ),
                                  label: Text(l10n.viewAllShipments),
                                ),
                              ),
                            ],
                          ),
                  ),
                ],
              ),
            );
          }

          final destinations = <String>{
            for (final s in shipments) s.destinationCountryName.trim(),
          }.where((d) => d.isNotEmpty).toList()..sort();

          // Search + destination define the working set; the status segment
          // shows counts within it and decides what the list displays.
          final base = shipments
              .where(
                (s) =>
                    _matchesQuery(s) &&
                    (_destination == null ||
                        s.destinationCountryName == _destination),
              )
              .toList();
          final inProgressCount = base.where(_inProgress).length;
          final deliveredCount = base
              .where((s) => s.status == 'completed')
              .length;
          final filtered = base.where(_matchesStatus).toList();
          final groups = _ShipmentGroup.fromShipments(filtered);

          return SafeArea(
            child: Column(
              children: [
                _ShipmentsHeader(
                  title: l10n.trackShipment,
                    showBackButton: widget.showBackButton,
                ),
                _TrackSearchField(
                  controller: _searchController,
                  hint: l10n.trackSearchHint,
                  onChanged: (value) => setState(() => _query = value.trim()),
                  onClear: () => setState(() {
                    _searchController.clear();
                    _query = '';
                  }),
                ),
                _StatusSegment(
                  status: _status,
                  inProgressLabel: l10n.filterInProgress,
                  deliveredLabel: l10n.filterDelivered,
                  allLabel: l10n.filterAll,
                  inProgressCount: inProgressCount,
                  deliveredCount: deliveredCount,
                  allCount: base.length,
                  onChanged: (value) => setState(() => _status = value),
                ),
                if (destinations.length > 1)
                  _DestinationChips(
                    destinations: destinations,
                    selected: _destination,
                    allLabel: l10n.allDestinations,
                    onSelected: (value) => setState(() => _destination = value),
                  ),
                Expanded(
                  child: groups.isEmpty
                      ? _NoResults(
                          message: l10n.noShipmentsMatchFilters,
                          clearLabel: l10n.clearFilters,
                          onClear: _clearFilters,
                        )
                      : RefreshIndicator(
                          onRefresh: () async {},
                          child: ListView.separated(
                            physics: const AlwaysScrollableScrollPhysics(),
                            padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                            itemCount: groups.length,
                            separatorBuilder: (_, _) =>
                                const SizedBox(height: 12),
                            itemBuilder: (context, index) {
                              final group = groups[index];
                              if (group.shipments.length == 1) {
                                return shipmentCard(group.shipments.single);
                              }
                              return _ShipmentGroupCard(group: group);
                            },
                          ),
                        ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _ShipmentGroup {
  const _ShipmentGroup({required this.id, required this.shipments});

  final String id;
  final List<CustomerTrackingShipment> shipments;

  CustomerTrackingShipment get latest => shipments.first;

  static List<_ShipmentGroup> fromShipments(
    List<CustomerTrackingShipment> shipments,
  ) {
    final grouped = <String, List<CustomerTrackingShipment>>{};
    for (final shipment in shipments) {
      final orderId = shipment.barrelShipment?.orderId;
      final key = shipment.isFreight
          ? 'freight:${shipment.id}'
          : orderId?.trim().isNotEmpty == true
          ? 'order:$orderId'
          : 'shipment:${shipment.id}';
      grouped.putIfAbsent(key, () => []).add(shipment);
    }
    final groups = grouped.entries
        .map(
          (entry) => _ShipmentGroup(
            id: entry.key,
            shipments: entry.value
              ..sort((a, b) => b.createdAt.compareTo(a.createdAt)),
          ),
        )
        .toList();
    groups.sort((a, b) => b.latest.createdAt.compareTo(a.latest.createdAt));
    return groups;
  }
}

class _ShipmentsHeader extends StatelessWidget {
  const _ShipmentsHeader({required this.title, required this.showBackButton});

  final String title;
  final bool showBackButton;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
      child: Row(
        children: [
          if (showBackButton) ...[
            const AppBackButton(),
            const SizedBox(width: 4),
          ],
          Expanded(
            child: Text(
              title,
              style: Theme.of(
                context,
              ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
            ),
          ),
          const LanguageToggle(),
        ],
      ),
    );
  }
}

class _ShipmentGroupCard extends StatelessWidget {
  const _ShipmentGroupCard({required this.group});

  final _ShipmentGroup group;

  Future<void> _downloadReceipt(BuildContext context) async {
    await generateBarrelOrderReceipt(
      orderId:
          group.latest.barrelShipment?.orderId ??
          group.latest.barrelShipment!.id,
      shipments: group.shipments
          .map((shipment) => shipment.barrelShipment!)
          .toList(),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final currency = NumberFormat.simpleCurrency();
    final total = group.shipments.fold<double>(
      0,
      (runningTotal, shipment) => runningTotal + shipment.price,
    );
    final barrelCount = group.shipments.fold<int>(
      0,
      (runningTotal, shipment) =>
          runningTotal + shipment.barrelShipment!.quantity,
    );
    final businesses = {
      for (final shipment in group.shipments) shipment.businessName,
    }.where((name) => name.trim().isNotEmpty).length;
    final pickupCount = group.shipments
        .where((shipment) => shipment.barrelShipment!.pickupRequested)
        .length;

    return Card(
      margin: EdgeInsets.zero,
      elevation: 0,
      color: AppColors.paper,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: const BorderSide(color: AppColors.rule),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: AppColors.cobalt.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.inventory_2_outlined,
                    color: AppColors.cobaltDeep,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.barrelOrder,
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        l10n.barrelOrderSummary(
                          barrelCount,
                          group.shipments.length,
                          businesses,
                        ),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: AppColors.lightMuted,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                _StatusPill(
                  label: _ShipmentCard.statusLabel(l10n, group.latest.status),
                  color: _ShipmentCard.statusColor(group.latest.status),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _InfoChip(
                  icon: Icons.payments_outlined,
                  label:
                      '${currency.format(total)} • ${_ShipmentCard.paymentLabel(l10n, group.latest.paymentStatus)}',
                ),
                _InfoChip(
                  icon: pickupCount > 0
                      ? Icons.home_work_outlined
                      : Icons.storefront_outlined,
                  label: pickupCount > 0
                      ? '$pickupCount pickup${pickupCount == 1 ? '' : 's'}'
                      : l10n.customerDropOffAtOffice,
                ),
              ],
            ),
            const SizedBox(height: 12),
            for (final shipment in group.shipments) ...[
              _ShipmentGroupLine(shipment: shipment),
              if (shipment != group.shipments.last) const Divider(height: 14),
            ],
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                onPressed: () => _downloadReceipt(context),
                icon: const Icon(Icons.receipt_long, size: 18),
                label: Text(l10n.receipt),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ShipmentGroupLine extends StatelessWidget {
  const _ShipmentGroupLine({required this.shipment});

  final CustomerTrackingShipment shipment;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: () => Navigator.pushNamed(
        context,
        '/barrel-shipment-details',
        arguments: shipment.barrelShipment,
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            SizedBox(
              width: 82,
              child: Text(
                shipment.destinationCountryName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    shipment.trackingCode,
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${shipment.receiverName} • ${shipment.businessName}',
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.muted,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: AppColors.muted),
          ],
        ),
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  const _InfoChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.lightSurfaceVariant,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: AppColors.cobaltDeep),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.ink,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _FreightNextStepCallout extends StatelessWidget {
  const _FreightNextStepCallout({
    required this.shipment,
    required this.currency,
    required this.onPayBalance,
    required this.balancePaymentBusy,
  });

  final CustomerTrackingShipment shipment;
  final NumberFormat currency;
  final VoidCallback? onPayBalance;
  final bool balancePaymentBusy;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final amount =
        shipment.priceSettlementStatus == 'settled' &&
            shipment.finalTotal != null
        ? shipment.finalTotal!
        : (shipment.estimatedTotal > 0
              ? shipment.estimatedTotal
              : shipment.price);
    final businessName = shipment.businessName.trim();
    final hasBalanceDue = shipment.balanceDue > 0;
    final title = hasBalanceDue
        ? l10n.additionalPaymentRequired
        : (shipment.status == 'completed' ||
              shipment.priceSettlementStatus == 'settled')
        ? l10n.freightSettled
        : (shipment.status == 'in_transit' ||
              shipment.status == 'ready_for_pickup')
        ? _ShipmentCard.statusLabel(l10n, shipment.status)
        : l10n.estimatePaid;
    final nextStep = hasBalanceDue
        ? l10n.shipmentHeldForBalance
        : shipment.status == 'completed'
        ? l10n.freightNextCompleted
        : shipment.status == 'in_transit'
        ? l10n.freightNextInTransit
        : shipment.status == 'ready_for_pickup'
        ? l10n.freightNextReadyForPickup
        : shipment.status == 'awaiting_weight_confirmation'
        ? l10n.freightNextWeightReview
        : businessName.isEmpty
        ? l10n.freightNextDropOffAtBusiness
        : l10n.freightNextDropOffAtProvider(businessName);

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.lightSurfaceVariant,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.task_alt_outlined, color: AppColors.cobalt),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.freightNextStep,
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: AppColors.cobaltDeep,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      title,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      nextStep,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppColors.lightMuted,
                        height: 1.35,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _FreightSummaryChip(
                icon: Icons.payments_outlined,
                label: l10n.paidEstimateAmount(currency.format(amount)),
              ),
              if (shipment.estimatedWeightKg > 0)
                _FreightSummaryChip(
                  icon: Icons.scale_outlined,
                  label: l10n.estimatedWeightValue(
                    '${shipment.estimatedWeightKg.toStringAsFixed(1)} kg',
                  ),
                ),
            ],
          ),
          if (!hasBalanceDue) ...[
            const SizedBox(height: 8),
            Text(
              l10n.freightNoActionUntilWeightConfirmed,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: AppColors.lightMuted,
                height: 1.35,
              ),
            ),
          ],
          if (onPayBalance != null) ...[
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: balancePaymentBusy ? null : onPayBalance,
                child: Text(
                  balancePaymentBusy
                      ? l10n.paymentProcessing
                      : l10n.payBalanceAmount(
                          currency.format(shipment.balanceDue),
                        ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _FreightSummaryChip extends StatelessWidget {
  const _FreightSummaryChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: AppColors.cobaltDeep),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.ink,
              fontSize: 12,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _ShipmentCard extends StatelessWidget {
  const _ShipmentCard({
    required this.shipment,
    this.onPayBalance,
    this.balancePaymentBusy = false,
    this.focused = false,
    this.trackingService,
  });

  final CustomerTrackingShipment shipment;
  final VoidCallback? onPayBalance;
  final bool balancePaymentBusy;
  final bool focused;
  final ShipmentTrackingService? trackingService;

  Future<void> _copyTrackingNumber(BuildContext context) async {
    await Clipboard.setData(ClipboardData(text: shipment.trackingCode));
    if (!context.mounted) return;
    final l10n = AppLocalizations.of(context)!;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(l10n.trackingNumberCopiedShort)));
  }

  Future<void> _downloadReceipt(BuildContext context) async {
    await generateBarrelShipmentReceipt(shipment: shipment.barrelShipment!);
  }

  @override
  Widget build(BuildContext context) {
    final currency = NumberFormat.simpleCurrency();
    final l10n = AppLocalizations.of(context)!;
    final createdAt = DateFormat.yMMMd().add_jm().format(shipment.createdAt);
    final barrel = shipment.barrelShipment;
    final pickupDate = barrel?.pickupDateTime == null
        ? null
        : DateFormat.MMMd().add_jm().format(barrel!.pickupDateTime!);
    final freightMode = shipment.mode == 'air'
        ? l10n.airFreight
        : shipment.mode == 'sea'
        ? l10n.seaFreight
        : l10n.orderTypeFreight;

    return Card(
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: focused
            ? BorderSide(color: AppColors.cobalt.withValues(alpha: 0.32))
            : BorderSide.none,
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: shipment.isFreight
            ? null
            : () => Navigator.pushNamed(
                context,
                '/barrel-shipment-details',
                arguments: barrel,
              ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          shipment.trackingCode,
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          l10n.toReceiverInCountry(
                            shipment.receiverName,
                            shipment.destinationCountryName,
                          ),
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(color: AppColors.lightMuted),
                        ),
                      ],
                    ),
                  ),
                  _StatusPill(
                    label: statusLabel(l10n, shipment.status),
                    color: statusColor(shipment.status),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              if (shipment.isFreight) ...[
                _FreightNextStepCallout(
                  shipment: shipment,
                  currency: currency,
                  onPayBalance: onPayBalance,
                  balancePaymentBusy: balancePaymentBusy,
                ),
                const SizedBox(height: 8),
                _DetailLine(
                  icon: shipment.mode == 'air'
                      ? Icons.flight_outlined
                      : Icons.directions_boat_outlined,
                  text: shipment.estimatedWeightKg > 0
                      ? '$freightMode • ${l10n.estimatedWeight}: '
                            '${shipment.estimatedWeightKg.toStringAsFixed(1)} kg'
                      : freightMode,
                ),
                if (shipment.verifiedWeightKg != null) ...[
                  const SizedBox(height: 8),
                  _DetailLine(
                    icon: Icons.verified_outlined,
                    text:
                        '${l10n.verifiedWeight}: '
                        '${shipment.verifiedWeightKg!.toStringAsFixed(1)} kg',
                  ),
                ],
              ] else ...[
                _DetailLine(
                  icon: barrel!.pickupRequested
                      ? Icons.home_work_outlined
                      : Icons.storefront_outlined,
                  text: barrel.pickupRequested
                      ? (pickupDate == null
                            ? l10n.pickupRequested
                            : l10n.pickupRequestedWithDate(pickupDate))
                      : l10n.customerDropOffAtOffice,
                ),
                const SizedBox(height: 8),
                _DetailLine(
                  icon: Icons.payments_outlined,
                  text:
                      '${currency.format(shipment.price)} • '
                      '${paymentLabel(l10n, shipment.paymentStatus)}',
                ),
              ],
              if (shipment.isFreight &&
                  shipment.priceSettlementStatus.isNotEmpty) ...[
                const SizedBox(height: 8),
                _DetailLine(
                  icon: Icons.account_balance_wallet_outlined,
                  text: freightSettlementLabel(
                    l10n,
                    shipment.priceSettlementStatus,
                  ),
                ),
              ],
              if (barrel?.deliveryEstimateLabel != null) ...[
                const SizedBox(height: 8),
                _DetailLine(
                  icon: Icons.schedule_outlined,
                  text: l10n.deliveryWithLabel(barrel!.deliveryEstimateLabel!),
                ),
              ],
              const SizedBox(height: 8),
              _DetailLine(icon: Icons.schedule, text: createdAt),
              const SizedBox(height: 14),
              Row(
                children: [
                  OutlinedButton.icon(
                    onPressed: () => _copyTrackingNumber(context),
                    icon: const Icon(Icons.copy, size: 18),
                    label: Text(l10n.copy),
                  ),
                  const SizedBox(width: 8),
                  if (!shipment.isFreight) ...[
                    OutlinedButton.icon(
                      onPressed: () => _downloadReceipt(context),
                      icon: const Icon(Icons.receipt_long, size: 18),
                      label: Text(l10n.receipt),
                    ),
                  ],
                  if (!shipment.isFreight && onPayBalance != null) ...[
                    const SizedBox(width: 8),
                    Expanded(
                      child: FilledButton(
                        onPressed: balancePaymentBusy ? null : onPayBalance,
                        child: Text(
                          balancePaymentBusy
                              ? l10n.paymentProcessing
                              : l10n.payBalanceAmount(
                                  currency.format(shipment.balanceDue),
                                ),
                        ),
                      ),
                    ),
                  ] else
                    const Spacer(),
                  if (!shipment.isFreight)
                    Icon(
                      Icons.chevron_right,
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                ],
              ),
              if (shipment.isFreight) ...[
                const SizedBox(height: 14),
                ShipmentTrackingSection(
                  relatedCollection: freightTrackingCollection,
                  relatedId: shipment.id,
                  canEdit: false,
                  trackingService: trackingService,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  static String statusLabel(AppLocalizations l10n, String status) {
    switch (status) {
      case 'pending_payment':
        return l10n.pendingPayment;
      case 'pending':
        return l10n.requested;
      case 'awaiting_weight_confirmation':
        return l10n.awaitingConfirmedWeight;
      case 'awaiting_balance_payment':
        return l10n.additionalPaymentRequired;
      case 'settlement_processing':
        return l10n.refundProcessing;
      case 'in_transit':
        return l10n.inTransit;
      case 'ready_for_pickup':
        return l10n.readyForPickup;
      case 'completed':
        return l10n.completed;
      case 'cancelled':
        return l10n.cancelled;
      default:
        return status;
    }
  }

  static Color statusColor(String status) {
    switch (status) {
      case 'completed':
        return AppColors.sage;
      case 'in_transit':
        return AppColors.cobalt;
      case 'ready_for_pickup':
        return AppColors.sage;
      case 'cancelled':
        return AppColors.errorRed;
      case 'pending_payment':
        return AppColors.warn;
      case 'awaiting_weight_confirmation':
      case 'awaiting_balance_payment':
      case 'settlement_processing':
        return AppColors.warn;
      default:
        return AppColors.saffron;
    }
  }

  static String paymentLabel(AppLocalizations l10n, String paymentStatus) {
    switch (paymentStatus) {
      case 'succeeded':
        return l10n.paid;
      case 'simulated_succeeded':
        return l10n.paid;
      case 'pending':
        return l10n.paymentPending;
      case 'cancelled':
        return l10n.paymentCancelled;
      default:
        return paymentStatus.replaceAll('_', ' ');
    }
  }

  static String freightSettlementLabel(AppLocalizations l10n, String status) {
    switch (status) {
      case 'awaiting_weight':
        return l10n.awaitingConfirmedWeight;
      case 'balance_due':
      case 'balance_payment_pending':
        return l10n.additionalPaymentRequired;
      case 'refund_processing':
        return l10n.refundProcessing;
      case 'settled':
        return l10n.freightSettled;
      case 'needs_attention':
        return l10n.settlementNeedsAttention;
      default:
        return status.replaceAll('_', ' ');
    }
  }
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: AppColors.cobalt),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: Theme.of(context).textTheme.bodyMedium,
            overflow: TextOverflow.ellipsis,
            maxLines: 2,
          ),
        ),
      ],
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _EmptyShipmentsState extends StatelessWidget {
  const _EmptyShipmentsState({
    required this.title,
    required this.message,
    this.icon = Icons.inventory_2_outlined,
    this.actionLabel,
    this.onAction,
    this.showBackButton = false,
  });

  final String title;
  final String message;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;
  final bool showBackButton;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _ShipmentsHeader(title: title, showBackButton: showBackButton),
        Expanded(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 58,
                    height: 58,
                    decoration: BoxDecoration(
                      color: AppColors.cobalt.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Icon(icon, color: AppColors.cobalt),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    message,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: AppColors.lightMuted,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 18),
                  if (actionLabel != null && onAction != null)
                    FilledButton(
                      onPressed: onAction,
                      child: Text(actionLabel!),
                    ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _TrackSearchField extends StatelessWidget {
  const _TrackSearchField({
    required this.controller,
    required this.hint,
    required this.onChanged,
    required this.onClear,
  });

  final TextEditingController controller;
  final String hint;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          hintText: hint,
          prefixIcon: const Icon(Icons.search, size: 20),
          suffixIcon: controller.text.isEmpty
              ? null
              : IconButton(
                  tooltip: AppLocalizations.of(context)!.clear,
                  icon: const Icon(Icons.close, size: 18),
                  onPressed: onClear,
                ),
          isDense: true,
          filled: true,
          fillColor: AppColors.paper,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 14,
            vertical: 12,
          ),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: AppColors.rule),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: AppColors.rule),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: AppColors.cobalt, width: 1.5),
          ),
        ),
      ),
    );
  }
}

class _StatusSegment extends StatelessWidget {
  const _StatusSegment({
    required this.status,
    required this.inProgressLabel,
    required this.deliveredLabel,
    required this.allLabel,
    required this.inProgressCount,
    required this.deliveredCount,
    required this.allCount,
    required this.onChanged,
  });

  final _StatusFilter status;
  final String inProgressLabel;
  final String deliveredLabel;
  final String allLabel;
  final int inProgressCount;
  final int deliveredCount;
  final int allCount;
  final ValueChanged<_StatusFilter> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: AppColors.lightSurfaceVariant,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.rule),
        ),
        child: Row(
          children: [
            _segment(
              _StatusFilter.inProgress,
              inProgressLabel,
              inProgressCount,
            ),
            _segment(_StatusFilter.delivered, deliveredLabel, deliveredCount),
            _segment(_StatusFilter.all, allLabel, allCount),
          ],
        ),
      ),
    );
  }

  Widget _segment(_StatusFilter value, String label, int count) {
    final selected = value == status;
    return Expanded(
      child: GestureDetector(
        onTap: () => onChanged(value),
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          padding: const EdgeInsets.symmetric(vertical: 9),
          decoration: BoxDecoration(
            color: selected ? AppColors.paper : Colors.transparent,
            borderRadius: BorderRadius.circular(11),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: AppColors.ink.withValues(alpha: 0.06),
                      blurRadius: 6,
                      offset: const Offset(0, 2),
                    ),
                  ]
                : null,
          ),
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              '$label  $count',
              style: TextStyle(
                color: selected ? AppColors.cobaltDeep : AppColors.muted,
                fontWeight: FontWeight.w800,
                fontSize: 13,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DestinationChips extends StatelessWidget {
  const _DestinationChips({
    required this.destinations,
    required this.selected,
    required this.allLabel,
    required this.onSelected,
  });

  final List<String> destinations;
  final String? selected;
  final String allLabel;
  final ValueChanged<String?> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 42,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
        children: [
          _chip(allLabel, selected == null, () => onSelected(null)),
          for (final destination in destinations) ...[
            const SizedBox(width: 8),
            _chip(
              destination,
              selected == destination,
              () => onSelected(destination),
            ),
          ],
        ],
      ),
    );
  }

  Widget _chip(String label, bool isSelected, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.cobalt : AppColors.paper,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: isSelected ? AppColors.cobalt : AppColors.rule,
          ),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? Colors.white : AppColors.ink,
            fontWeight: FontWeight.w700,
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}

class _NoResults extends StatelessWidget {
  const _NoResults({
    required this.message,
    required this.clearLabel,
    required this.onClear,
  });

  final String message;
  final String clearLabel;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 60, 20, 24),
      children: [
        const Icon(Icons.search_off_outlined, size: 44, color: AppColors.muted),
        const SizedBox(height: 12),
        Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: AppColors.muted,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 12),
        Center(
          child: TextButton.icon(
            onPressed: onClear,
            icon: const Icon(Icons.filter_alt_off_outlined, size: 18),
            label: Text(clearLabel),
          ),
        ),
      ],
    );
  }
}
