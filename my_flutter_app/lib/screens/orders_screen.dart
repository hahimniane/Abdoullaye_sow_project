import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/customer_order.dart';
import '../providers/auth_provider.dart';
import '../services/business_review_service.dart';
import '../services/notification_routing.dart';
import '../theme/app_colors.dart';
import '../widgets/app_back_button.dart';
import '../widgets/async_action_button.dart';
import '../widgets/support_entry_button.dart';
import 'review_composer_screen.dart';
import 'tracking_screen.dart';

/// Unified "Orders" — every paid transaction (cars, barrels, freight,
/// transport, parking) in one searchable, type-filtered history.
class OrdersScreen extends StatefulWidget {
  const OrdersScreen({
    super.key,
    this.showBackButton = false,
    this.initialArgs,
  });

  final bool showBackButton;
  final OrdersScreenArguments? initialArgs;

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _query = '';
  OrderType? _typeFilter;
  OrderStatus? _statusFilter;
  OrdersScreenArguments? _args;
  bool _appliedArgs = false;
  bool _openedFocus = false;

  final List<StreamSubscription<dynamic>> _subscriptions = [];
  final BusinessReviewService _reviewService = BusinessReviewService();
  bool _subscribed = false;
  List<DocumentSnapshot<Map<String, dynamic>>>? _cars;
  List<DocumentSnapshot<Map<String, dynamic>>>? _barrels;
  List<DocumentSnapshot<Map<String, dynamic>>>? _freight;
  List<DocumentSnapshot<Map<String, dynamic>>>? _transport;
  List<DocumentSnapshot<Map<String, dynamic>>>? _parking;
  List<DocumentSnapshot<Map<String, dynamic>>>? _priceRequests;
  Set<String> _reviewedKeys = const {};

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _args ??=
        widget.initialArgs ??
        (ModalRoute.of(context)?.settings.arguments is OrdersScreenArguments
            ? ModalRoute.of(context)!.settings.arguments
                  as OrdersScreenArguments
            : null);
    if (!_appliedArgs && _args != null) {
      _appliedArgs = true;
      _typeFilter = _orderTypeForInnerTab(_args!);
    }
    if (_subscribed) return;
    final user = context.read<AuthProvider>().user;
    if (user == null) return;
    _subscribed = true;
    final db = FirebaseFirestore.instance;

    void listen(
      Query<Map<String, dynamic>> query,
      void Function(List<DocumentSnapshot<Map<String, dynamic>>>) assign,
    ) {
      _subscriptions.add(
        query.snapshots().listen(
          (snap) {
            if (mounted) setState(() => assign(snap.docs));
          },
          onError: (_) {
            if (mounted) setState(() => assign(const []));
          },
        ),
      );
    }

    listen(
      db.collection('carPurchases').where('buyerUid', isEqualTo: user.uid),
      (docs) => _cars = docs,
    );
    listen(
      db
          .collection('barrelShipments')
          .where('customerUid', isEqualTo: user.uid),
      (docs) => _barrels = docs,
    );
    listen(
      db
          .collection('freightShipments')
          .where('customerUid', isEqualTo: user.uid),
      (docs) => _freight = docs,
    );
    listen(
      db
          .collection('transportRequests')
          .where('customerUid', isEqualTo: user.uid),
      (docs) => _transport = docs,
    );
    listen(
      db.collection('parkedCars').where('customerUid', isEqualTo: user.uid),
      (docs) => _parking = docs,
    );
    listen(
      db
          .collection('freightQuoteRequests')
          .where('customerUid', isEqualTo: user.uid),
      (docs) => _priceRequests = docs,
    );
    _subscriptions.add(
      _reviewService.reviewedOrderKeysForCurrentUser().listen((keys) {
        if (mounted) setState(() => _reviewedKeys = keys);
      }),
    );
  }

  @override
  void dispose() {
    for (final sub in _subscriptions) {
      sub.cancel();
    }
    _searchController.dispose();
    super.dispose();
  }

  bool get _loading =>
      _cars == null ||
      _barrels == null ||
      _freight == null ||
      _transport == null ||
      _parking == null ||
      _priceRequests == null;

  List<CustomerOrder> _allOrders() {
    final orders = <CustomerOrder>[];
    // One malformed document (e.g. a legacy or hand-edited record missing a
    // required field) must not blank out every other order on this screen -
    // skip just that record and keep going.
    void addSafely(String collection, String docId, CustomerOrder Function() build) {
      try {
        orders.add(build());
      } catch (error) {
        debugPrint('Skipping malformed $collection/$docId order: $error');
      }
    }

    for (final doc in _cars ?? const []) {
      addSafely('carPurchases', doc.id, () => CustomerOrder.fromCarPurchase(doc));
    }
    for (final doc in _freight ?? const []) {
      addSafely('freightShipments', doc.id, () => CustomerOrder.fromFreight(doc));
    }
    for (final doc in _transport ?? const []) {
      addSafely('transportRequests', doc.id, () => CustomerOrder.fromTransport(doc));
    }
    for (final doc in _parking ?? const []) {
      addSafely('parkedCars', doc.id, () => CustomerOrder.fromParking(doc));
    }
    for (final doc in _priceRequests ?? const []) {
      addSafely(
        'freightQuoteRequests',
        doc.id,
        () => CustomerOrder.fromPriceRequest(doc),
      );
    }
    final barrelGroups =
        <String, List<DocumentSnapshot<Map<String, dynamic>>>>{};
    for (final doc in _barrels ?? const []) {
      final orderId = (doc.data()?['orderId'] as String?)?.trim();
      final key = orderId != null && orderId.isNotEmpty
          ? 'order:$orderId'
          : 'ship:${doc.id}';
      barrelGroups.putIfAbsent(key, () => []).add(doc);
    }
    for (final group in barrelGroups.values) {
      addSafely(
        'barrelShipments',
        group.first.id,
        () => CustomerOrder.fromBarrelGroup(group),
      );
    }
    orders.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return orders;
  }

  bool _matches(CustomerOrder order) {
    if (_typeFilter != null && order.type != _typeFilter) return false;
    if (_statusFilter != null && order.status != _statusFilter) return false;
    if (_query.isEmpty) return true;
    final q = _query.toLowerCase();
    return order.title.toLowerCase().contains(q) ||
        order.businessName.toLowerCase().contains(q) ||
        order.subtitle.toLowerCase().contains(q) ||
        (order.trackingCode?.toLowerCase().contains(q) ?? false);
  }

  void _openReview(CustomerOrder order) {
    Navigator.pushNamed(
      context,
      '/leave-review',
      arguments: ReviewComposerArguments(
        relatedCollection: order.relatedCollection,
        relatedId: order.relatedId,
        businessId: order.businessId,
        businessName: order.businessName,
        orderTitle: order.title,
      ),
    );
  }

  OrderType? _orderTypeForInnerTab(OrdersScreenArguments args) {
    switch (args.innerTab) {
      case 'barrels':
        return OrderType.barrel;
      case 'freight':
        return OrderType.freight;
      case 'transport':
        return OrderType.transport;
      case 'cars':
        return args.focusCollection == 'parkedCars'
            ? OrderType.parking
            : OrderType.car;
      default:
        return null;
    }
  }

  void _openFocusedOrder(List<CustomerOrder> orders) {
    final focusId = _args?.focusId;
    if (_openedFocus || focusId == null || focusId.isEmpty) return;
    CustomerOrder? match;
    for (final order in orders) {
      if (order.relatedId == focusId || order.id == focusId) {
        match = order;
        break;
      }
    }
    if (match == null) return;
    _openedFocus = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _open(match!);
    });
  }

  void _open(CustomerOrder order) {
    if (order.hasDetail) {
      Navigator.pushNamed(
        context,
        order.detailRoute!,
        arguments: order.detailArgument,
      );
    } else if (order.trackable) {
      // Prefer the tracking code over the document id: the signed-in list
      // matches either, but a guest's lookup only understands codes - an id
      // left a guest on a blank search for an order they had already paid.
      final code = order.trackingCode?.trim() ?? '';
      Navigator.pushNamed(
        context,
        '/tracking',
        arguments: code.isNotEmpty
            ? TrackingScreenArguments(shipmentId: code)
            : (order.type == OrderType.freight
                  ? TrackingScreenArguments(shipmentId: order.relatedId)
                  : null),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final orders = _allOrders();
    _openFocusedOrder(orders);
    final presentTypes = {for (final o in orders) o.type};
    final presentStatuses = {for (final o in orders) o.status};
    final filtered = orders.where(_matches).toList();

    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: SafeArea(
        child: Column(
          children: [
            _OrdersHeader(
              title: l10n.ordersTitle,
              showBackButton: widget.showBackButton,
            ),
            _OrdersSearchField(
              controller: _searchController,
              hint: l10n.ordersSearchHint,
              onChanged: (value) => setState(() => _query = value.trim()),
              onClear: () => setState(() {
                _searchController.clear();
                _query = '';
              }),
            ),
            if (presentTypes.length > 1)
              _TypeChips(
                present: presentTypes,
                selected: _typeFilter,
                allLabel: l10n.filterAll,
                onSelected: (type) => setState(() => _typeFilter = type),
              ),
            if (presentStatuses.length > 1)
              _StatusChips(
                present: presentStatuses,
                selected: _statusFilter,
                allLabel: l10n.filterAll,
                onSelected: (status) => setState(() => _statusFilter = status),
              ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : filtered.isEmpty
                  ? _OrdersEmpty(
                      message: orders.isEmpty
                          ? l10n.ordersEmpty
                          : l10n.ordersNoMatch,
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                      itemCount: filtered.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 10),
                      itemBuilder: (context, index) => _OrderCard(
                        order: filtered[index],
                        onTap: () => _open(filtered[index]),
                        reviewed: _reviewedKeys.contains(
                          '${filtered[index].relatedCollection}_'
                          '${filtered[index].relatedId}',
                        ),
                        onLeaveReview: () => _openReview(filtered[index]),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

({IconData icon, Color color}) _typeVisual(OrderType type) {
  switch (type) {
    case OrderType.car:
      return (icon: Icons.directions_car_outlined, color: AppColors.cobalt);
    case OrderType.barrel:
      return (icon: Icons.local_shipping_outlined, color: AppColors.saffron);
    case OrderType.freight:
      return (icon: Icons.inventory_2_outlined, color: AppColors.sage);
    case OrderType.transport:
      return (icon: Icons.car_rental_outlined, color: AppColors.cobaltMid);
    case OrderType.parking:
      return (icon: Icons.local_parking_outlined, color: AppColors.sage);
  }
}

String _typeLabel(AppLocalizations l10n, OrderType type) {
  switch (type) {
    case OrderType.car:
      return l10n.orderTypeCars;
    case OrderType.barrel:
      return l10n.orderTypeBarrels;
    case OrderType.freight:
      return l10n.orderTypeFreight;
    case OrderType.transport:
      return l10n.orderTypeTransport;
    case OrderType.parking:
      return l10n.orderTypeParking;
  }
}

({String label, Color color}) _statusVisual(
  AppLocalizations l10n,
  OrderStatus status,
) {
  switch (status) {
    case OrderStatus.inTransit:
      return (label: l10n.orderStatusInTransit, color: AppColors.cobalt);
    case OrderStatus.completed:
      return (label: l10n.orderStatusCompleted, color: AppColors.sage);
    case OrderStatus.cancelled:
      return (label: l10n.orderStatusCancelled, color: AppColors.errorRed);
    case OrderStatus.refunded:
      return (label: l10n.orderStatusRefunded, color: AppColors.warn);
    case OrderStatus.active:
      return (label: l10n.orderStatusActive, color: AppColors.cobaltMid);
    case OrderStatus.pending:
      return (label: l10n.orderStatusPending, color: AppColors.saffron);
  }
}

class _OrdersHeader extends StatelessWidget {
  const _OrdersHeader({required this.title, required this.showBackButton});

  final String title;
  final bool showBackButton;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 16, 8),
      child: Row(
        children: [
          if (showBackButton)
            const AppBackButton()
          else
            const SizedBox(width: 12),
          Expanded(
            child: Text(
              title,
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w900,
                color: AppColors.ink,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _OrdersSearchField extends StatelessWidget {
  const _OrdersSearchField({
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
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
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

class _TypeChips extends StatelessWidget {
  const _TypeChips({
    required this.present,
    required this.selected,
    required this.allLabel,
    required this.onSelected,
  });

  final Set<OrderType> present;
  final OrderType? selected;
  final String allLabel;
  final ValueChanged<OrderType?> onSelected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final types = OrderType.values.where(present.contains).toList();
    return SizedBox(
      height: 42,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
        children: [
          _chip(allLabel, null, selected == null),
          for (final type in types) ...[
            const SizedBox(width: 8),
            _chip(_typeLabel(l10n, type), type, selected == type),
          ],
        ],
      ),
    );
  }

  Widget _chip(String label, OrderType? type, bool isSelected) {
    return GestureDetector(
      onTap: () => onSelected(type),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: isSelected ? AppColors.cobalt : AppColors.paper,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: isSelected ? AppColors.cobalt : AppColors.rule,
          ),
        ),
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

class _StatusChips extends StatelessWidget {
  const _StatusChips({
    required this.present,
    required this.selected,
    required this.allLabel,
    required this.onSelected,
  });

  final Set<OrderStatus> present;
  final OrderStatus? selected;
  final String allLabel;
  final ValueChanged<OrderStatus?> onSelected;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final statuses = OrderStatus.values.where(present.contains).toList();
    return SizedBox(
      height: 42,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
        children: [
          _chip(allLabel, null, selected == null, AppColors.cobalt),
          for (final status in statuses) ...[
            const SizedBox(width: 8),
            _chip(
              _statusVisual(l10n, status).label,
              status,
              selected == status,
              _statusVisual(l10n, status).color,
            ),
          ],
        ],
      ),
    );
  }

  Widget _chip(
    String label,
    OrderStatus? status,
    bool isSelected,
    Color color,
  ) {
    return GestureDetector(
      onTap: () => onSelected(status),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: isSelected ? color : AppColors.paper,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: isSelected ? color : AppColors.rule),
        ),
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

class _OrderCard extends StatelessWidget {
  const _OrderCard({
    required this.order,
    required this.onTap,
    required this.reviewed,
    required this.onLeaveReview,
  });

  final CustomerOrder order;
  final VoidCallback onTap;
  final bool reviewed;
  final VoidCallback onLeaveReview;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final visual = _typeVisual(order.type);
    final status = _statusVisual(l10n, order.status);
    final currency = NumberFormat.simpleCurrency(
      name: order.currency.toUpperCase(),
    );
    final date = DateFormat.yMMMd().format(order.createdAt);
    final tappable = order.hasDetail || order.trackable;

    return Material(
      color: AppColors.paper,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: tappable ? onTap : null,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.rule),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: visual.color.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: Icon(visual.icon, color: visual.color, size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                order.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 15.5,
                                  fontWeight: FontWeight.w900,
                                  color: AppColors.ink,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            _StatusPill(
                              label: status.label,
                              color: status.color,
                            ),
                          ],
                        ),
                        const SizedBox(height: 3),
                        Text(
                          [
                            order.businessName,
                            if (order.amount > 0) currency.format(order.amount),
                            date,
                          ].where((s) => s.isNotEmpty).join(' · '),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (tappable)
                    const Padding(
                      padding: EdgeInsets.only(left: 6),
                      child: Icon(
                        Icons.chevron_right_rounded,
                        color: AppColors.muted,
                        size: 22,
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: SupportEntryButton(
                      relatedCollection: order.relatedCollection,
                      relatedId: order.relatedId,
                      subject: l10n.supportChat,
                      relatedLabel: order.title,
                      compact: true,
                    ),
                  ),
                  if (order.status == OrderStatus.completed) ...[
                    const SizedBox(width: 8),
                    Expanded(
                      child: reviewed
                          ? _ReviewedPill(label: l10n.orderReviewedBadge)
                          : AsyncActionButton.outlined(
                              onPressed: () => onLeaveReview(),
                              label: l10n.orderLeaveReviewCta,
                              icon: Icons.star_border_rounded,
                            ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
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
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11.5,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _ReviewedPill extends StatelessWidget {
  const _ReviewedPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.sage.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.sage.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.star_rounded, color: AppColors.sage, size: 16),
          const SizedBox(width: 4),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.sage,
              fontWeight: FontWeight.w800,
              fontSize: 12.5,
            ),
          ),
        ],
      ),
    );
  }
}

class _OrdersEmpty extends StatelessWidget {
  const _OrdersEmpty({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.receipt_long_outlined,
              size: 48,
              color: AppColors.muted,
            ),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.muted,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
