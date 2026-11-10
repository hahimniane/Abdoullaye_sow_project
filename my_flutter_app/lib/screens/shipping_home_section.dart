import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/package_request_feed.dart';
import '../services/package_request_service.dart';
import '../services/shipping_home.dart';
import '../services/shipping_home_facts.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/home_destinations.dart';
import 'containers_screen.dart';
import 'shop_home_section.dart' show ShopApprovalNote;

/// Opens the containers screen on one of its entries (the home's Register a
/// package, Packages here, On the way and Requests rows).
typedef ShippingHomeOpener =
    void Function(ContainersEntry entry, {bool registerOnOpen});

/// The simple shipping home (docs/SHIPPING_SIMPLE_HOME.md, part H): the
/// business name, one loud Register a package, a short list of places, a
/// quiet Money group, and the same tail the standard home ends with.
///
/// Only the rows that depend on this business's own state live here -
/// Requests (a count from a light request feed), Packages here and On the
/// way / Containers (which one depends on [factsLoader]). The Deliveries,
/// Containers and Money rows are built by the home from the same permission
/// gates it has always used and handed in, so a place can never be offered
/// here and refused there.
///
/// Nothing blocks on a read: while the facts load, the one row that depends
/// on them is simply not there yet; a failed or slow read falls back to the
/// Containers row, which is today's behaviour.
class ShippingHomeSection extends StatefulWidget {
  const ShippingHomeSection({
    super.key,
    required this.businessId,
    this.businessName = '',
    this.approvalStatus,
    this.containersRow,
    this.deliveriesRow,
    this.moneyRows = const [],
    this.tools = const [],
    this.factsLoader = loadShippingHomeFacts,
    this.requestServiceBuilder,
    this.opener,
  });

  final String businessId;
  final String businessName;

  /// 'pending' / 'changes_requested' shows the calm note; null or 'approved'
  /// shows nothing.
  final String? approvalStatus;

  /// The existing Containers and Deliveries rows (keys `open-containers`,
  /// `open-deliveries`), null where the person does not hold the access.
  final HomeDestination? containersRow;
  final HomeDestination? deliveriesRow;

  /// The existing Invoices and Staff balances rows, same gates, same keys.
  final List<HomeDestination> moneyRows;

  /// The console's other sections, for the tail.
  final List<HomeTool> tools;

  final ShippingHomeFactsLoader factsLoader;

  /// How the request count is read; the real service when null. A widget
  /// test hands in a fake.
  final PackageRequestService Function()? requestServiceBuilder;

  /// Opens a containers entry; pushes [ContainersScreen] when null.
  final ShippingHomeOpener? opener;

  @override
  State<ShippingHomeSection> createState() => _ShippingHomeSectionState();
}

class _ShippingHomeSectionState extends State<ShippingHomeSection> {
  ShippingHomeFacts? _facts;
  late PackageRequestFeed _requests;
  int _loadToken = 0;

  @override
  void initState() {
    super.initState();
    _requests = _makeFeed()..addListener(_onRequests);
    _loadFacts();
  }

  @override
  void didUpdateWidget(ShippingHomeSection old) {
    super.didUpdateWidget(old);
    if (old.businessId != widget.businessId) {
      _requests
        ..removeListener(_onRequests)
        ..dispose();
      _requests = _makeFeed()..addListener(_onRequests);
      _facts = null;
      _loadFacts();
    }
  }

  @override
  void dispose() {
    _loadToken++;
    _requests
      ..removeListener(_onRequests)
      ..dispose();
    super.dispose();
  }

  PackageRequestFeed _makeFeed() => PackageRequestFeed(
    widget.businessId,
    service:
        widget.requestServiceBuilder?.call() ?? FirebasePackageRequestService(),
  );

  void _onRequests() {
    if (mounted) setState(() {});
  }

  /// Reads the facts once. The state always resolves: a failure, or no
  /// answer within the timeout, is [ShippingHomeFacts.unknown].
  Future<void> _loadFacts() async {
    final token = ++_loadToken;
    ShippingHomeFacts facts;
    try {
      facts = await widget
          .factsLoader(widget.businessId)
          .timeout(shippingHomeFactsTimeout);
    } catch (_) {
      facts = ShippingHomeFacts.unknown;
    }
    if (!mounted || token != _loadToken) return;
    setState(() => _facts = facts);
  }

  void _open(ContainersEntry entry, {bool registerOnOpen = false}) {
    AppHaptics.selection();
    final opener = widget.opener;
    if (opener != null) {
      opener(entry, registerOnOpen: registerOnOpen);
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ContainersScreen(
          businessId: widget.businessId,
          entry: entry,
          registerOnOpen: registerOnOpen,
        ),
      ),
    );
  }

  HomeDestination? _row(ShippingHomePlace place, AppLocalizations l10n) {
    switch (place) {
      case ShippingHomePlace.requests:
        return HomeDestination(
          rowKey: const Key('open-package-requests'),
          icon: Icons.mark_email_unread_outlined,
          title: l10n.prqRequestsTitle,
          subtitle: l10n.prqEntryCount(_requests.openCount),
          onTap: () => _open(ContainersEntry.requests),
        );
      case ShippingHomePlace.packagesHere:
        return HomeDestination(
          rowKey: const Key('open-packages-here'),
          icon: Icons.inventory_2_outlined,
          title: l10n.shhPackagesHereTitle,
          subtitle: l10n.shhPackagesHereSubtitle,
          onTap: () => _open(ContainersEntry.waiting),
        );
      case ShippingHomePlace.onTheWay:
        return HomeDestination(
          rowKey: const Key('open-on-the-way'),
          icon: Icons.flight_takeoff,
          title: l10n.shhOnTheWayTitle,
          subtitle: l10n.shhOnTheWaySubtitle,
          onTap: () => _open(ContainersEntry.shipments),
        );
      case ShippingHomePlace.containers:
        return widget.containersRow;
      case ShippingHomePlace.deliveries:
        return widget.deliveriesRow;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final status = widget.approvalStatus;
    final places = shippingHomePlaces(
      facts: _facts,
      openRequests: _requests.openCount,
      canUseDeliveries: widget.deliveriesRow != null,
    );
    final rows = [for (final place in places) ?_row(place, l10n)];
    final name = widget.businessName.trim();
    return Column(
      key: const Key('shipping-home'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (name.isNotEmpty)
          Text(
            name,
            key: const Key('shipping-business-name'),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 22,
              height: 1.2,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.4,
              color: AppColors.ink,
            ),
          ),
        if (status != null && status != 'approved') ...[
          const SizedBox(height: AppSpacing.sm),
          Align(
            alignment: Alignment.centerLeft,
            child: ShopApprovalNote(status: status),
          ),
        ],
        const SizedBox(height: AppSpacing.lg),
        HomePrimaryAction(
          buttonKey: const Key('register-package'),
          icon: Icons.add,
          label: l10n.wpkRegister,
          onTap: () => _open(ContainersEntry.waiting, registerOnOpen: true),
        ),
        const SizedBox(height: AppSpacing.md),
        HomeDestinationGroup(key: const Key('shipping-places'), rows: rows),
        if (widget.moneyRows.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.lg),
          Text(
            l10n.shhMoneyTitle,
            key: const Key('shipping-money-title'),
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          HomeDestinationGroup(
            key: const Key('shipping-money'),
            rows: widget.moneyRows,
          ),
        ],
        BusinessHomeTail(tools: widget.tools, businessId: widget.businessId),
      ],
    );
  }
}
