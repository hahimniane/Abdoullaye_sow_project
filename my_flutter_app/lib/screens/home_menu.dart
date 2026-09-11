import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/parked_car.dart';
import '../models/barrel_shipment.dart';
import '../models/transport_request.dart';
import '../models/business_service.dart' as business_services;
import '../providers/auth_provider.dart';
import '../widgets/language_toggle.dart';
import '../widgets/async_action_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/business_parking_payment_badge.dart';
import '../l10n/app_localizations.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../services/business_parking_entry.dart';
import '../services/business_service_overview.dart';
import '../utils/business_parking_localization.dart';
import '../utils/business_permissions.dart';
import '../widgets/customer_notification_bell.dart';
import 'business_assistant_screen.dart';
import 'business_reviews_screen.dart';
import 'business_transport_screen.dart';
import 'office_locations_screen.dart';
import 'park_car_screen.dart';
import 'lot_ledger_screen.dart';
import 'staff_car_management_screen.dart';

export '../services/business_service_overview.dart' show ServiceCategory;

/// The tint a service carries wherever it appears - tile, chip or record card.
Color _categoryColor(ServiceCategory category) {
  switch (category) {
    case ServiceCategory.parking:
      return AppColors.sage;
    case ServiceCategory.barrels:
      return AppColors.cobalt;
    case ServiceCategory.freight:
      return AppColors.cobalt;
    case ServiceCategory.transport:
      return AppColors.sage;
    case ServiceCategory.sales:
      return AppColors.saffron;
    case ServiceCategory.all:
      return AppColors.ink;
  }
}

IconData _categoryIcon(ServiceCategory category) {
  switch (category) {
    case ServiceCategory.parking:
      return Icons.local_parking;
    case ServiceCategory.barrels:
      return Icons.inventory_2;
    case ServiceCategory.freight:
      return Icons.inventory_2_outlined;
    case ServiceCategory.transport:
      return Icons.directions_car;
    case ServiceCategory.sales:
      return Icons.storefront;
    case ServiceCategory.all:
      return Icons.dashboard_outlined;
  }
}

String _categoryLabel(ServiceCategory category, AppLocalizations l10n) {
  switch (category) {
    case ServiceCategory.all:
      return l10n.filterAll;
    case ServiceCategory.parking:
      return l10n.filterParking;
    case ServiceCategory.barrels:
      return l10n.filterBarrels;
    case ServiceCategory.freight:
      return l10n.filterFreight;
    case ServiceCategory.transport:
      return l10n.filterTransport;
    case ServiceCategory.sales:
      return l10n.filterSales;
  }
}

class HomeMenu extends StatefulWidget {
  const HomeMenu({super.key, this.initialCategory, this.showBackButton = false});

  /// Open on one service's list (a notification about freight lands on the
  /// freight list, not on "all").
  final ServiceCategory? initialCategory;

  /// True when pushed on top of the shell (from a notification) rather than
  /// shown as the Home tab, so there is a way back.
  final bool showBackButton;

  @override
  State<HomeMenu> createState() => _HomeMenuState();
}

class ActivityRecord {
  ActivityRecord({
    required this.category,
    required this.title,
    required this.subtitle,
    required this.date,
    this.payload,
  });

  final ServiceCategory category;
  final String title;
  final String subtitle;
  final DateTime date;
  final Object? payload;
}

class _HomeMenuState extends State<HomeMenu> {
  final List<ActivityRecord> _records = [];
  final List<ParkedCar> _parkedCars = [];
  final List<BarrelShipment> _barrelShipments = [];
  final List<ActivityRecord> _freightRecords = [];

  /// The statuses of the same freight documents `_freightRecords` was built
  /// from, kept alongside rather than on the record because the record's
  /// payload is the id the freight tap needs. No extra read: both come out of
  /// the one snapshot.
  final List<String> _freightStatuses = [];
  final List<TransportRequest> _transportRequests = [];

  /// The statuses of the `transportOpportunities` this business was invited to
  /// price. A won job lives in `transportRequests`; a request nobody has quoted
  /// yet lives ONLY here, which is why the transport tile could not have meant
  /// anything operational before this subscription existed.
  final List<String> _transportOpportunityStatuses = [];
  bool _isLoading = true;
  ServiceCategory _selectedCategory = ServiceCategory.all;

  /// Narrows the parked-car list to what the lot is still owed, or to what is
  /// settled. Only ever offered while parking is the selected category, and
  /// reset whenever the category changes so a narrowing can never be in force
  /// while its control is off screen.
  BusinessParkingPaymentFilter _paymentFilter =
      BusinessParkingPaymentFilter.all;

  /// Where the car is in its stay, as opposed to whether it has been paid
  /// for - the console asks both questions and so must this. `all` is "do not
  /// narrow" rather than a status.
  String _parkingStatusFilter = businessParkingStatusFilterAll;

  /// Free text over tracking code, owner, car and VIN. A lot with a windscreen
  /// slip in its hand looks the car up by its code; without this the only way
  /// to find one was to scroll.
  String _parkingSearch = '';
  final TextEditingController _parkingSearchController =
      TextEditingController();

  /// "Which cars were parked that week." Either bound alone is a question in
  /// its own right ("everything from the 10th onwards"), so both are optional
  /// and independent. Reset with the payment filter when the category changes.
  DateTime? _parkedFrom;
  DateTime? _parkedTo;
  StreamSubscription<QuerySnapshot>? _parkedCarsSubscription;
  StreamSubscription<QuerySnapshot>? _barrelShipmentsSubscription;
  StreamSubscription<QuerySnapshot>? _freightShipmentsSubscription;
  StreamSubscription<QuerySnapshot>? _transportRequestsSubscription;
  StreamSubscription<QuerySnapshot>? _transportOpportunitiesSubscription;
  bool _parkedLoaded = false;

  /// The lot's capacity, from the business record. Read once when parking is
  /// in scope; drives the "Spaces" tile, which stays hidden while it is zero
  /// (unknown) - exactly as the console does.
  int _parkingTotalSpaces = 0;
  bool _barrelsLoaded = false;
  bool _freightLoaded = false;
  bool _transportLoaded = false;
  bool _transportOpportunitiesLoaded = false;

  @override
  void initState() {
    super.initState();
    if (widget.initialCategory != null) {
      _selectedCategory = widget.initialCategory!;
    }
    _subscribeToRecords();
  }

  void _subscribeToRecords() {
    setState(() {
      _isLoading = true;
    });

    final auth = context.read<AuthProvider>();
    Query<Map<String, dynamic>> scope(
      CollectionReference<Map<String, dynamic>> collection,
      String orderBy,
    ) {
      if (auth.isAdmin) return collection.orderBy(orderBy, descending: true);
      return collection.where('businessId', isEqualTo: auth.businessId);
    }

    if (auth.hasBusinessPermission(BusinessPermission.parking)) {
      _loadParkingSpaces(auth.businessId);
      _parkedCarsSubscription =
          scope(
            FirebaseFirestore.instance.collection('parkedCars'),
            'parkingDate',
          ).snapshots().listen(
            (snapshot) {
              final parkedCars = <ParkedCar>[];
              for (final doc in snapshot.docs) {
                try {
                  parkedCars.add(ParkedCar.fromFirestore(doc));
                } catch (error) {
                  debugPrint('Skipping malformed parkedCars/${doc.id}: $error');
                }
              }
              _parkedCars
                ..clear()
                ..addAll(parkedCars);
              _parkedLoaded = true;
              _rebuildActivityRecords();
            },
            onError: (_) {
              _parkedLoaded = true;
              _rebuildActivityRecords();
            },
          );
    } else {
      _parkedLoaded = true;
    }

    if (auth.hasBusinessPermission(BusinessPermission.barrels)) {
      _barrelShipmentsSubscription =
          scope(
            FirebaseFirestore.instance.collection('barrelShipments'),
            'createdAt',
          ).snapshots().listen(
            (snapshot) {
              final shipments = snapshot.docs
                  .map((doc) => BarrelShipment.fromFirestore(doc))
                  .toList();
              _barrelShipments
                ..clear()
                ..addAll(shipments);
              _barrelsLoaded = true;
              _rebuildActivityRecords();
            },
            onError: (_) {
              _barrelsLoaded = true;
              _rebuildActivityRecords();
            },
          );
    } else {
      _barrelsLoaded = true;
    }

    if (auth.hasBusinessPermission(BusinessPermission.freight)) {
      final freightCollection = FirebaseFirestore.instance.collection(
        'freightShipments',
      );
      final freightQuery = auth.isAdmin
          ? freightCollection
          : freightCollection.where('businessId', isEqualTo: auth.businessId);
      _freightShipmentsSubscription = freightQuery.snapshots().listen(
        (snapshot) {
          _freightStatuses
            ..clear()
            ..addAll(
              snapshot.docs.map((doc) => '${doc.data()['status'] ?? ''}'),
            );
          _freightRecords
            ..clear()
            ..addAll(
              snapshot.docs.map((doc) {
                final data = doc.data();
                final createdAt = data['createdAt'];
                return ActivityRecord(
                  category: ServiceCategory.freight,
                  title:
                      '${data['receiverName'] ?? ''} • ${data['trackingCode'] ?? doc.id}',
                  subtitle: '${data['senderName'] ?? ''}',
                  date: createdAt is Timestamp
                      ? createdAt.toDate()
                      : DateTime.fromMillisecondsSinceEpoch(0),
                  payload: doc.id,
                );
              }),
            );
          _freightLoaded = true;
          _rebuildActivityRecords();
        },
        onError: (_) {
          _freightLoaded = true;
          _rebuildActivityRecords();
        },
      );
    } else {
      _freightLoaded = true;
    }

    if (auth.hasBusinessPermission(BusinessPermission.transport)) {
      _transportRequestsSubscription =
          scope(
            FirebaseFirestore.instance.collection('transportRequests'),
            'createdAt',
          ).snapshots().listen(
            (snapshot) {
              final requests = snapshot.docs
                  .map((doc) => TransportRequest.fromFirestore(doc))
                  .toList();
              _transportRequests
                ..clear()
                ..addAll(requests);
              _transportLoaded = true;
              _rebuildActivityRecords();
            },
            onError: (_) {
              _transportLoaded = true;
              _rebuildActivityRecords();
            },
          );
      // The requests this business may BID on. A separate collection, and the
      // only one that knows about work nobody has priced yet - the transport
      // tile counted delivered-or-not on won jobs alone before this, which told
      // a carrier nothing about the deadline running down on an open request.
      _transportOpportunitiesSubscription =
          scope(
            FirebaseFirestore.instance.collection('transportOpportunities'),
            'createdAt',
          ).snapshots().listen(
            (snapshot) {
              _transportOpportunityStatuses
                ..clear()
                ..addAll(
                  snapshot.docs.map((doc) => '${doc.data()['status'] ?? ''}'),
                );
              _transportOpportunitiesLoaded = true;
              _rebuildActivityRecords();
            },
            onError: (_) {
              _transportOpportunitiesLoaded = true;
              _rebuildActivityRecords();
            },
          );
    } else {
      _transportLoaded = true;
      _transportOpportunitiesLoaded = true;
    }
    _rebuildActivityRecords();
  }

  /// A one-shot read of the lot's capacity. Silent on failure: the scoreboard
  /// simply drops its "Spaces" tile, which is also what it does when the field
  /// was never set.
  Future<void> _loadParkingSpaces(String? businessId) async {
    if (businessId == null || businessId.isEmpty) return;
    try {
      final snap = await FirebaseFirestore.instance
          .collection('businesses')
          .doc(businessId)
          .get();
      if (!mounted) return;
      final spaces =
          num.tryParse('${snap.data()?['parkingTotalSpaces'] ?? ''}') ?? 0;
      setState(() => _parkingTotalSpaces = spaces > 0 ? spaces.round() : 0);
    } catch (_) {
      // No capacity to show; the rest of the scoreboard is unaffected.
    }
  }

  /// The scoreboard over the parked cars currently in view, or null when
  /// parking is not the selected service or there is nothing to total. It
  /// reads the SAME filtered records the feed shows, so a filter re-totals the
  /// numbers - mirroring the console.
  BusinessParkingTotals? get _parkingTotals {
    if (_selectedCategory != ServiceCategory.parking) return null;
    final rows = <Map<String, dynamic>>[
      for (final record in _filteredRecords)
        if (record.category == ServiceCategory.parking &&
            record.payload is ParkedCar)
          (record.payload as ParkedCar).paymentFields,
    ];
    if (rows.isEmpty) return null;
    return businessParkingTotals(rows, spacesTotal: _parkingTotalSpaces);
  }

  void _rebuildActivityRecords() {
    if (!mounted) return;
    final combined = <ActivityRecord>[];

    for (final car in _parkedCars) {
      combined.add(
        ActivityRecord(
          category: ServiceCategory.parking,
          title: '${car.carMake} ${car.carModel}'.trim(),
          subtitle: '${car.ownerName} • ${car.trackingCode}',
          date: car.parkingDate,
          payload: car,
        ),
      );
    }

    for (final shipment in _barrelShipments) {
      combined.add(
        ActivityRecord(
          category: ServiceCategory.barrels,
          title: '${shipment.receiverName} • ${shipment.trackingCode}',
          subtitle: shipment.senderName,
          date: shipment.createdAt,
          payload: shipment,
        ),
      );
    }

    combined.addAll(_freightRecords);

    for (final request in _transportRequests) {
      combined.add(
        ActivityRecord(
          category: ServiceCategory.transport,
          title:
              '${request.carMake} ${request.carModel} • ${request.trackingCode}',
          subtitle: request.ownerName,
          date: request.createdAt,
          payload: request,
        ),
      );
    }

    combined.sort((a, b) => b.date.compareTo(a.date));

    setState(() {
      _records
        ..clear()
        ..addAll(combined);
      _isLoading =
          !(_parkedLoaded &&
              _barrelsLoaded &&
              _freightLoaded &&
              _transportLoaded &&
              _transportOpportunitiesLoaded);
    });
  }

  /// Whether any parking narrowing is in force.
  ///
  /// An empty list means two different things - "you have no parked cars" and
  /// "none of them match what you asked for" - and only one of them is fixed
  /// by clearing a filter, so the empty state has to know which.
  bool get _parkingListIsNarrowed => businessParkingListIsNarrowed(
    search: _parkingSearch,
    statusFilter: _parkingStatusFilter,
    paymentFilter: _paymentFilter,
    from: _parkedFrom,
    to: _parkedTo,
  );

  List<ActivityRecord> get _filteredRecords {
    final enabled = _enabledActivityCategories();
    final serviceRecords = _records
        .where((record) => enabled.contains(record.category))
        .toList();
    final categoryRecords = _selectedCategory == ServiceCategory.all
        ? serviceRecords
        : serviceRecords
              .where((record) => record.category == _selectedCategory)
              .toList();
    if (!_parkingListIsNarrowed) {
      return categoryRecords;
    }
    // Only a parked car has a payment state or a stay to narrow on. Nothing
    // else is touched, so a barrel cannot be hidden by a parking filter.
    return categoryRecords.where((record) {
      final car = record.payload;
      if (record.category != ServiceCategory.parking || car is! ParkedCar) {
        return true;
      }
      if (!businessParkingMatchesSearch(car.paymentFields, _parkingSearch)) {
        return false;
      }
      if (!businessParkingMatchesStatusFilter(
        car.paymentFields,
        _parkingStatusFilter,
      )) {
        return false;
      }
      if (!businessParkingMatchesPaymentFilter(
        car.paymentFields,
        _paymentFilter,
      )) {
        return false;
      }
      // Overlap, not containment: a car that arrived before the window and
      // leaves after it was parked during that week and must still appear.
      return businessParkingWithinRange(
        car.paymentFields,
        _parkedFrom,
        _parkedTo,
      );
    }).toList();
  }

  Set<ServiceCategory> _enabledActivityCategories() {
    final auth = context.read<AuthProvider>();
    return businessActivityCategories(
      services: auth.businessServices,
      hasPermission: auth.hasBusinessPermission,
    );
  }

  /// The overview grid, built from the lists this screen has already
  /// subscribed to. The tiles and the feed's own gate come from the same pure
  /// decision, so a tile can never offer a service whose records are hidden.
  List<BusinessServiceTile> _overviewTiles() {
    final auth = context.read<AuthProvider>();
    return businessServiceOverviewTiles(
      services: auth.businessServices,
      hasPermission: auth.hasBusinessPermission,
      parkedCarFields: _parkedCars.map((car) => car.paymentFields),
      barrelStatuses: _barrelShipments.map((shipment) => shipment.status),
      freightStatuses: _freightStatuses,
      transportStatuses: _transportRequests.map((request) => request.status),
      transportOpportunityStatuses: _transportOpportunityStatuses,
    );
  }

  /// Narrows the feed to one service, or back to everything.
  ///
  /// Leaving parking takes the parking filters with it - an invisible
  /// narrowing reads as missing records.
  void _selectCategory(ServiceCategory category) {
    setState(() {
      _selectedCategory = category;
      _paymentFilter = BusinessParkingPaymentFilter.all;
      _parkingStatusFilter = businessParkingStatusFilterAll;
      _parkingSearch = '';
      _parkingSearchController.clear();
      _parkedFrom = null;
      _parkedTo = null;
    });
  }

  @override
  void dispose() {
    _parkingSearchController.dispose();
    _parkedCarsSubscription?.cancel();
    _barrelShipmentsSubscription?.cancel();
    _freightShipmentsSubscription?.cancel();
    _transportRequestsSubscription?.cancel();
    _transportOpportunitiesSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final width = MediaQuery.of(context).size.width;

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(color: AppColors.cream),
        child: SafeArea(
          child: SingleChildScrollView(
            padding: EdgeInsets.all(width * 0.06),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (widget.showBackButton) const BackButton(),
                    const Spacer(),
                    // Same bell customers have: a business's notifications
                    // (paid links, new opportunities, viewing requests) were
                    // stored but reachable only from a push banner.
                    const CustomerNotificationBell(),
                    const SizedBox(width: 4),
                    const LanguageToggle(),
                  ],
                ),
                const SizedBox(height: 16),
                // "Services. / Choose a service to get started" is an
                // invitation to pick something. Once the service grid is on
                // screen it is a caption for the thing directly under it,
                // costing a phone-height of space to say what the tiles
                // already say. Customers, who get no grid, still need it.
                if (_overviewTiles().isEmpty) ...[
                  _WelcomeSection(l10n: l10n, width: width),
                  const SizedBox(height: 24),
                ],
                _ServicesSection(
                  l10n: l10n,
                  width: width,
                  tiles: _overviewTiles(),
                  isLoading: _isLoading,
                  selectedCategory: _selectedCategory,
                  onCategoryTapped: (category) => _selectCategory(
                    businessServiceOverviewSelection(
                      _selectedCategory,
                      category,
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                _ActivitySection(
                  l10n: l10n,
                  records: _filteredRecords,
                  isLoading: _isLoading,
                  selectedCategory: _selectedCategory,
                  onCategoryChanged: _selectCategory,
                  paymentFilter: _paymentFilter,
                  onPaymentFilterChanged: (filter) {
                    setState(() {
                      _paymentFilter = filter;
                    });
                  },
                  statusFilter: _parkingStatusFilter,
                  onStatusFilterChanged: (status) {
                    setState(() {
                      _parkingStatusFilter = status;
                    });
                  },
                  searchController: _parkingSearchController,
                  onSearchChanged: (value) {
                    setState(() {
                      _parkingSearch = value;
                    });
                  },
                  isNarrowed: _parkingListIsNarrowed,
                  parkedFrom: _parkedFrom,
                  parkedTo: _parkedTo,
                  onParkedRangeChanged: (from, to) {
                    setState(() {
                      _parkedFrom = from;
                      _parkedTo = to;
                    });
                  },
                  parkingTotals: _parkingTotals,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _WelcomeSection extends StatelessWidget {
  const _WelcomeSection({required this.l10n, required this.width});

  final AppLocalizations l10n;
  final double width;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(width * 0.06),
      decoration: BoxDecoration(
        color: AppColors.paper,
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: AppColors.parchment,
              border: Border.all(color: AppColors.rule),
            ),
            child: const Icon(
              Icons.business,
              color: AppColors.cobalt,
              size: 28,
            ),
          ),
          const SizedBox(height: 16),
          RichText(
            text: TextSpan(
              style: Theme.of(context).textTheme.displayMedium?.copyWith(
                fontSize: 24,
                height: 1,
                color: AppColors.ink,
              ),
              children: [
                TextSpan(text: l10n.services),
                const TextSpan(
                  text: '.',
                  style: TextStyle(color: AppColors.cobalt),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Text(
            l10n.chooseServiceToStart,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: AppColors.muted,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }
}

/// The business's own services, on the first screen, above the fold.
///
/// This card used to be a five-line paragraph and a filled button that left
/// the app for Safari, with the one action a lot performs all day - recording
/// a walk-up - stranded below a "Recent activity" heading as a plain outlined
/// button. The order here is the order of the day: what needs doing, then the
/// thing you do, then the console you occasionally leave for.
class _ServicesSection extends StatelessWidget {
  const _ServicesSection({
    required this.l10n,
    required this.width,
    required this.tiles,
    required this.isLoading,
    required this.selectedCategory,
    required this.onCategoryTapped,
  });

  final AppLocalizations l10n;
  final double width;
  final List<BusinessServiceTile> tiles;
  final bool isLoading;
  final ServiceCategory selectedCategory;
  final ValueChanged<ServiceCategory> onCategoryTapped;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final services = auth.businessServices.isEmpty
        ? business_services.defaultBusinessServiceValues
        : auth.businessServices;
    final showSales =
        business_services.hasBusinessService(
          services,
          business_services.BusinessServiceKey.carSales,
        ) &&
        (auth.hasBusinessPermission(BusinessPermission.listings) ||
            auth.hasBusinessPermission(BusinessPermission.purchases));
    // Same gate as the parkedCars subscription in _HomeMenuState: the lot that
    // can see its parked cars is the lot that can add one, so the list and the
    // way to extend it appear together or not at all.
    final canRecordParkedCar = auth.hasBusinessPermission(
      BusinessPermission.parking,
    );
    // The lot ledger — activity and expenses from the yard — is its own
    // permission, mirroring the console's `ledger` tab.
    final ledgerBusinessId = auth.businessId ?? '';
    final canUseLotLedger =
        auth.hasBusinessPermission(BusinessPermission.ledger) &&
        ledgerBusinessId.isNotEmpty;
    // Same two gates as the Car Transport tile itself: the business offers
    // transport and this person holds the transport permission. Everything
    // behind the button - `submitTransportQuote`, `withdrawTransportQuote`,
    // `updateTransportFulfillmentStatus` - is gated on that same permission
    // server-side, so an ungated button would only ever be refused.
    final transportBusinessId = auth.businessId ?? '';
    final canWorkTransport =
        business_services.hasBusinessService(
          services,
          business_services.BusinessServiceKey.carTransport,
        ) &&
        auth.hasBusinessPermission(BusinessPermission.transport) &&
        transportBusinessId.isNotEmpty;
    final businessId = auth.businessId ?? '';
    final hasCarSales = business_services.hasBusinessService(
      services,
      business_services.BusinessServiceKey.carSales,
    );
    void go(Widget screen) {
      Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => screen),
      );
    }
    final moreTools = <_BusinessTool>[
      if (hasCarSales &&
          auth.hasBusinessPermission(BusinessPermission.listings))
        _BusinessTool(
          'listings',
          Icons.directions_car_outlined,
          l10n.businessListingsTitle,
          () => go(const StaffCarManagementScreen(showBackButton: true)),
        ),
      if (hasCarSales &&
          auth.hasBusinessPermission(BusinessPermission.purchases))
        _BusinessTool(
          'purchases',
          Icons.handshake_outlined,
          l10n.businessPurchasesTitle,
          () => Navigator.of(context).pushNamed('/purchase-management'),
        ),
      if (auth.hasBusinessPermission(BusinessPermission.profile))
        _BusinessTool(
          'profile',
          Icons.storefront_outlined,
          l10n.businessProfile,
          () => Navigator.of(context).pushNamed('/business-profile'),
        ),
      if (auth.hasBusinessPermission(BusinessPermission.destinations))
        _BusinessTool(
          'destinations',
          Icons.public,
          l10n.businessServicesCoverageTitle,
          () => Navigator.of(context).pushNamed('/destination-countries'),
        ),
      if (businessId.isNotEmpty &&
          auth.hasBusinessPermission(BusinessPermission.destinations))
        _BusinessTool(
          'offices',
          Icons.place_outlined,
          l10n.businessOfficesTitle,
          () => go(OfficeLocationsScreen(businessId: businessId)),
        ),
      if (auth.hasBusinessPermission(BusinessPermission.people))
        _BusinessTool(
          'people',
          Icons.group_outlined,
          l10n.businessPeopleTitle,
          () => Navigator.of(context).pushNamed('/add-staff'),
        ),
      if (businessId.isNotEmpty)
        _BusinessTool(
          'reviews',
          Icons.star_outline_rounded,
          l10n.businessReviewsTitle,
          () => go(BusinessReviewsScreen(businessId: businessId)),
        ),
      if (auth.hasBusinessPermission(BusinessPermission.support))
        _BusinessTool(
          'support',
          Icons.forum_outlined,
          l10n.supportInbox,
          () => Navigator.of(context).pushNamed('/business-support'),
        ),
    ];
    return Container(
      padding: EdgeInsets.all(width * 0.06),
      decoration: BoxDecoration(
        color: AppColors.paper,
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.businessOperations,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
              color: AppColors.ink,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 16),
          _ServiceOverviewGrid(
            key: const Key('service-overview-grid'),
            l10n: l10n,
            tiles: tiles,
            isLoading: isLoading,
            selectedCategory: selectedCategory,
            onCategoryTapped: onCategoryTapped,
          ),
          if (showSales) ...[
            const SizedBox(height: 12),
            Text(
              l10n.businessCarsMobileNote,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontSize: 12.5,
                height: 1.4,
                color: AppColors.muted,
              ),
            ),
          ],
          // The daily action, and so the loudest thing on the screen.
          // ParkCarScreen picks its own flow from auth.hasBusinessDashboardAccess
          // (see its build), so pushing the screen directly opens the walk-up
          // intake for a business - no flag to pass, and no named customer route.
          if (canRecordParkedCar) ...[
            const SizedBox(height: 16),
            _PrimaryAction(
              buttonKey: const Key('record-parked-car'),
              icon: Icons.add,
              label: l10n.recordAParkedCar,
              onTap: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const ParkCarScreen(),
                  ),
                );
              },
            ),
          ],
          // The ledger and the transport board are places, not commands, so
          // they read as a list you can walk into rather than as two more
          // buttons competing with the one action above them. Each says what
          // is inside, because a name alone makes people guess.
          if (canUseLotLedger || canWorkTransport) ...[
            const SizedBox(height: 12),
            _DestinationGroup(
              rows: [
                if (canUseLotLedger)
                  _Destination(
                    rowKey: const Key('open-lot-ledger'),
                    icon: Icons.receipt_long_outlined,
                    title: l10n.lotLedgerTitle,
                    subtitle: l10n.lotLedgerSubtitle,
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) =>
                              LotLedgerScreen(businessId: ledgerBusinessId),
                        ),
                      );
                    },
                  ),
                // For a carrier rather than a lot: quote what came in, move
                // what was won.
                if (canWorkTransport)
                  _Destination(
                    rowKey: const Key('open-transport-jobs'),
                    icon: Icons.local_shipping_outlined,
                    title: l10n.businessTransportTitle,
                    subtitle: l10n.businessTransportRowSubtitle,
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => BusinessTransportScreen(
                            businessId: transportBusinessId,
                          ),
                        ),
                      );
                    },
                  ),
              ],
            ),
          ],
          // Everything else the console offers, by the same permissions it
          // uses. Before this the phone said "use the web console" for most
          // of it, even though the screens already existed in the app.
          if (moreTools.isNotEmpty) ...[
            const SizedBox(height: 18),
            Text(
              l10n.businessMoreTools,
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                color: AppColors.muted,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final tool in moreTools)
                  OutlinedButton.icon(
                    key: Key('business-tool-${tool.key}'),
                    icon: Icon(tool.icon, size: 18),
                    label: Text(tool.label),
                    onPressed: tool.onPressed,
                  ),
              ],
            ),
          ],
          // Occasional, and it leaves the app - so it is outlined, and it says
          // so before it is tapped.
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: AsyncActionButton.outlined(
              icon: Icons.open_in_browser,
              label: l10n.openBusinessConsole,
              loadingLabel: l10n.openingBusinessConsole,
              onPressed: () async {
                final opened = await launchUrl(
                  Uri.parse('https://business.laawoldigital.com/'),
                  mode: LaunchMode.externalApplication,
                );
                if (!opened && context.mounted) {
                  showErrorSnackBar(context, l10n.businessConsoleOpenFailed);
                }
              },
            ),
          ),
          const SizedBox(height: 6),
          Text(
            l10n.businessOperationsWebNote,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: AppColors.muted,
              height: 1.4,
            ),
          ),
          if ((auth.businessId ?? '').isNotEmpty) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                key: const Key('open-business-assistant'),
                icon: const Icon(Icons.support_agent),
                label: Text(l10n.businessAssistantOpen),
                onPressed: () {
                  final businessId = auth.businessId ?? '';
                  if (businessId.isEmpty) return;
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) =>
                          BusinessAssistantScreen(businessId: businessId),
                    ),
                  );
                },
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// One tile per service the business actually offers, two to a row.
///
/// A tile that only ever said "Barrels" would be a filter chip drawn larger.
/// What earns the space is the number: for parking, what the lot is still
/// owed; for the shipping services, what is still moving. A tile with nothing
/// outstanding still appears - "nothing to chase today" is an answer, and a
/// grid that changed shape as work arrived would be unreadable.
class _ServiceOverviewGrid extends StatelessWidget {
  const _ServiceOverviewGrid({
    super.key,
    required this.l10n,
    required this.tiles,
    required this.isLoading,
    required this.selectedCategory,
    required this.onCategoryTapped,
  });

  final AppLocalizations l10n;
  final List<BusinessServiceTile> tiles;
  final bool isLoading;
  final ServiceCategory selectedCategory;
  final ValueChanged<ServiceCategory> onCategoryTapped;

  @override
  Widget build(BuildContext context) {
    if (tiles.isEmpty) {
      return Text(
        l10n.businessServiceOverviewEmpty,
        style: Theme.of(
          context,
        ).textTheme.bodyMedium?.copyWith(color: AppColors.muted, height: 1.4),
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = 12.0;
        // Two to a row on a phone; a single service gets the full width rather
        // than a lonely half-tile.
        final columns = tiles.length == 1 ? 1 : 2;
        final tileWidth =
            (constraints.maxWidth - gap * (columns - 1)) / columns;
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [
            for (final tile in tiles)
              SizedBox(
                width: tileWidth,
                child: _ServiceOverviewCard(
                  key: Key('service-tile-${tile.category.name}'),
                  l10n: l10n,
                  tile: tile,
                  isLoading: isLoading,
                  isSelected: tile.category == selectedCategory,
                  onTap: () => onCategoryTapped(tile.category),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _ServiceOverviewCard extends StatelessWidget {
  const _ServiceOverviewCard({
    super.key,
    required this.l10n,
    required this.tile,
    required this.isLoading,
    required this.isSelected,
    required this.onTap,
  });

  final AppLocalizations l10n;
  final BusinessServiceTile tile;
  final bool isLoading;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tint = _categoryColor(tile.category);
    final name = _categoryLabel(tile.category, l10n);
    // The same digit means three different things across the grid, and this
    // caption is the only thing that says which: money owed, records open, or
    // work waiting on this business.
    final caption = switch (tile.meaning) {
      BusinessServiceCountMeaning.unpaid => l10n.businessServiceOverviewUnpaid,
      BusinessServiceCountMeaning.open => l10n.businessServiceOverviewOpen,
      BusinessServiceCountMeaning.needsYou =>
        l10n.businessServiceOverviewNeedsYou,
    };
    // Until the feeds have all reported, a "0" would be a claim the screen
    // cannot make yet.
    final countText = isLoading ? '—' : '${tile.count}';
    return Semantics(
      button: true,
      selected: isSelected,
      label: '$name, $countText $caption',
      // The tile is its own Material rather than an `Ink` decoration.
      //
      // `Ink` paints onto the nearest Material ANCESTOR, and the nearest one
      // here is the Scaffold - underneath the white card this grid sits in. So
      // the border and the selected fill were being painted below the card and
      // hidden by it: tapping a tile filtered the feed, but every tile still
      // looked identical, and the only evidence of the filter was a heading
      // further down the page. Giving the tile its own Material paints the
      // decoration where the tile actually is, and still clips the tap splash
      // to the rounded corners.
      child: Material(
        color: isSelected ? tint.withValues(alpha: 0.12) : AppColors.paper,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: tint.withValues(alpha: isSelected ? 1 : 0.45),
            width: isSelected ? 2 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(_categoryIcon(tile.category), color: tint, size: 22),
                const SizedBox(height: 10),
                Text(
                  name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      countText,
                      style: TextStyle(
                        fontSize: 24,
                        height: 1,
                        fontWeight: FontWeight.w800,
                        // Nothing outstanding is not news; it must not shout.
                        color: tile.count == 0 || isLoading
                            ? AppColors.muted
                            : AppColors.ink,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Flexible(
                      child: Text(
                        caption,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppColors.muted,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ActivitySection extends StatelessWidget {
  const _ActivitySection({
    required this.l10n,
    required this.records,
    required this.isLoading,
    required this.selectedCategory,
    required this.onCategoryChanged,
    required this.paymentFilter,
    required this.onPaymentFilterChanged,
    required this.statusFilter,
    required this.onStatusFilterChanged,
    required this.searchController,
    required this.onSearchChanged,
    required this.isNarrowed,
    required this.parkedFrom,
    required this.parkedTo,
    required this.onParkedRangeChanged,
    required this.parkingTotals,
  });

  final AppLocalizations l10n;
  final List<ActivityRecord> records;
  final bool isLoading;
  final ServiceCategory selectedCategory;
  final ValueChanged<ServiceCategory> onCategoryChanged;
  final BusinessParkingPaymentFilter paymentFilter;
  final ValueChanged<BusinessParkingPaymentFilter> onPaymentFilterChanged;
  final String statusFilter;
  final ValueChanged<String> onStatusFilterChanged;
  final TextEditingController searchController;
  final ValueChanged<String> onSearchChanged;

  /// True when a parking filter is hiding something, which is what lets the
  /// empty state say "nothing matches" instead of "you have no records".
  final bool isNarrowed;
  final DateTime? parkedFrom;
  final DateTime? parkedTo;
  final void Function(DateTime? from, DateTime? to) onParkedRangeChanged;

  /// The scoreboard over the parked cars in view, or null when there is
  /// nothing to total. Re-computed as filters narrow the feed, so the numbers
  /// always describe what the owner is looking at.
  final BusinessParkingTotals? parkingTotals;

  /// Picks one end of the window.
  ///
  /// A bound that would invert the window drags the other with it: "from the
  /// 20th to the 10th" is not a range anyone meant to ask for, and the pure
  /// predicate would answer it with an empty list rather than an explanation.
  Future<void> _pickParkedBound(
    BuildContext context, {
    required bool isFrom,
  }) async {
    final current = isFrom ? parkedFrom : parkedTo;
    final picked = await showDatePicker(
      context: context,
      initialDate: current ?? DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 730)),
    );
    if (picked == null) return;
    final day = DateTime(picked.year, picked.month, picked.day);
    if (isFrom) {
      final to = parkedTo;
      onParkedRangeChanged(day, to != null && to.isBefore(day) ? day : to);
    } else {
      final from = parkedFrom;
      onParkedRangeChanged(
        from != null && day.isBefore(from) ? day : from,
        day,
      );
    }
  }

  String _boundLabel(String prefix, DateTime? value) => value == null
      ? '$prefix: ${l10n.anyDate}'
      : '$prefix: ${DateFormat.yMMMd().format(value)}';

  String _paymentFilterLabel(
    BusinessParkingPaymentFilter filter,
    AppLocalizations l10n,
  ) {
    switch (filter) {
      case BusinessParkingPaymentFilter.all:
        return l10n.filterAll;
      case BusinessParkingPaymentFilter.paid:
        return l10n.paid;
      case BusinessParkingPaymentFilter.notPaid:
        return l10n.notPaid;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // The tiles above are the only way to narrow this feed now - the
        // filter chips that used to sit here did the same job twice. What the
        // tiles cannot say is "you are looking at one service", so the heading
        // does, and carries the way back.
        Row(
          children: [
            Expanded(
              child: Text(
                selectedCategory == ServiceCategory.all
                    ? l10n.recentActivity
                    : '${l10n.recentActivity} • '
                          '${_categoryLabel(selectedCategory, l10n)}',
                style: const TextStyle(
                  color: AppColors.ink,
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            if (selectedCategory != ServiceCategory.all)
              TextButton.icon(
                key: const Key('activity-show-all'),
                onPressed: () => onCategoryChanged(ServiceCategory.all),
                icon: const Icon(Icons.close, size: 16),
                label: Text(l10n.businessServiceOverviewShowAll),
              ),
          ],
        ),
        // Paid / Not paid, offered only where it means something. The lot's
        // question is "who still owes me", and scrolling a mixed activity
        // list for amber badges was the only way to answer it.
        if (selectedCategory == ServiceCategory.parking) ...[
          // The lot's spreadsheet kept totals in the margin - at the lot,
          // left, collected, owed. This is the live version, re-totalling to
          // whatever the filters below leave in view, the same as the console.
          if (parkingTotals != null) ...[
            const SizedBox(height: 12),
            _ParkingScoreboard(l10n: l10n, totals: parkingTotals!),
          ],
          // Tracking code, owner, car, VIN - the same fields the console
          // searches, in the same order, so the same query finds the same car
          // on both.
          const SizedBox(height: 12),
          TextField(
            key: const Key('parking-search'),
            controller: searchController,
            onChanged: onSearchChanged,
            decoration: InputDecoration(
              isDense: true,
              prefixIcon: const Icon(Icons.search, size: 20),
              hintText: l10n.searchParkedCars,
              suffixIcon: searchController.text.isEmpty
                  ? null
                  : IconButton(
                      key: const Key('parking-search-clear'),
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: () {
                        searchController.clear();
                        onSearchChanged('');
                      },
                    ),
            ),
          ),
          // Where the car is in its stay. A separate question from whether it
          // has been paid for, and the console asks both.
          const SizedBox(height: 12),
          SingleChildScrollView(
            key: const Key('parking-status-filter'),
            scrollDirection: Axis.horizontal,
            child: Row(
              children:
                  <String>[
                    businessParkingStatusFilterAll,
                    ...businessParkingStatusOptions,
                  ].map((status) {
                    final isSelected = status == statusFilter;
                    return Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(
                          status == businessParkingStatusFilterAll
                              ? l10n.filterAll
                              : businessParkingStatusLabel(l10n, status),
                        ),
                        selected: isSelected,
                        onSelected: (_) => onStatusFilterChanged(status),
                        labelStyle: TextStyle(
                          color: isSelected ? AppColors.paper : AppColors.ink,
                          fontWeight: FontWeight.w600,
                        ),
                        backgroundColor: AppColors.paper,
                        selectedColor: AppColors.ink,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.zero,
                          side: BorderSide(
                            color: AppColors.ink.withValues(
                              alpha: isSelected ? 1 : 0.5,
                            ),
                          ),
                        ),
                      ),
                    );
                  }).toList(),
            ),
          ),
          const SizedBox(height: 12),
          SingleChildScrollView(
            key: const Key('parking-payment-filter'),
            scrollDirection: Axis.horizontal,
            child: Row(
              children: BusinessParkingPaymentFilter.values.map((filter) {
                final isSelected = filter == paymentFilter;
                // Mirrors the badge: sage carries white text, amber carries
                // dark ink. brandRed is an alias for the teal brand colour,
                // so an unpaid control painted with it would read as settled.
                final fill = switch (filter) {
                  BusinessParkingPaymentFilter.all => AppColors.ink,
                  BusinessParkingPaymentFilter.paid => AppColors.sage,
                  BusinessParkingPaymentFilter.notPaid => AppColors.warn,
                };
                final selectedText =
                    filter == BusinessParkingPaymentFilter.notPaid
                    ? AppColors.ink
                    : AppColors.paper;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(_paymentFilterLabel(filter, l10n)),
                    selected: isSelected,
                    onSelected: (_) => onPaymentFilterChanged(filter),
                    labelStyle: TextStyle(
                      color: isSelected ? selectedText : AppColors.ink,
                      fontWeight: FontWeight.w600,
                    ),
                    backgroundColor: AppColors.paper,
                    selectedColor: fill,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.zero,
                      side: BorderSide(
                        color: fill.withValues(alpha: isSelected ? 1 : 0.5),
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          // "Which cars were parked that week." A stay that OVERLAPS the
          // window counts, so a car that arrived before it and leaves after it
          // is still listed - the long stays are exactly the ones a lot is
          // looking for. Either bound alone is a valid question.
          const SizedBox(height: 12),
          Wrap(
            key: const Key('parking-date-range-filter'),
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                l10n.parkedBetween,
                style: const TextStyle(
                  color: AppColors.ink,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
              OutlinedButton.icon(
                key: const Key('parking-range-from'),
                onPressed: () => _pickParkedBound(context, isFrom: true),
                icon: const Icon(Icons.event, size: 16),
                label: Text(_boundLabel(l10n.dateFrom, parkedFrom)),
              ),
              OutlinedButton.icon(
                key: const Key('parking-range-to'),
                onPressed: () => _pickParkedBound(context, isFrom: false),
                icon: const Icon(Icons.event_available, size: 16),
                label: Text(_boundLabel(l10n.dateTo, parkedTo)),
              ),
              if (parkedFrom != null || parkedTo != null)
                TextButton.icon(
                  key: const Key('parking-range-clear'),
                  onPressed: () => onParkedRangeChanged(null, null),
                  icon: const Icon(Icons.close, size: 16),
                  label: Text(l10n.clearDates),
                ),
            ],
          ),
        ],
        const SizedBox(height: 16),
        if (isLoading)
          const Center(child: CircularProgressIndicator())
        else if (records.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
            decoration: BoxDecoration(
              color: AppColors.paper,
              border: Border.all(color: AppColors.rule),
            ),
            child: Text(
              // "You have nothing" and "nothing matches what you asked for"
              // are different problems, and only the second is fixed by
              // clearing a filter. The console says so; this used to not.
              isNarrowed && selectedCategory == ServiceCategory.parking
                  ? l10n.noParkingRecordsMatchFilter
                  : l10n.noRecordsYet,
              style: TextStyle(
                fontSize: 15,
                color: AppColors.muted,
                fontWeight: FontWeight.w600,
              ),
              textAlign: TextAlign.center,
            ),
          )
        else
          ...records.map((record) {
            final paymentNote =
                record.category == ServiceCategory.parking &&
                    record.payload is ParkedCar &&
                    (record.payload as ParkedCar).isBusinessEntered
                ? businessParkingPaymentStatusLabel(
                    l10n,
                    (record.payload as ParkedCar).paymentFields,
                  )
                : '';
            final card = _RecordCard(
              title: record.title,
              subtitle: paymentNote.isEmpty
                  ? record.subtitle
                  : '${record.subtitle} • $paymentNote',
              date: record.date,
              categoryLabel: _categoryLabel(record.category, l10n),
              categoryIcon: _categoryIcon(record.category),
              // Only a parked car carries a payment badge; the widget itself
              // returns nothing for a customer booking, a cancelled record or
              // an entry with nothing to collect.
              paymentFields:
                  record.category == ServiceCategory.parking &&
                      record.payload is ParkedCar
                  ? (record.payload as ParkedCar).paymentFields
                  : null,
            );

            void Function()? onTap;
            if (record.category == ServiceCategory.parking &&
                record.payload is ParkedCar) {
              final car = record.payload as ParkedCar;
              onTap = () {
                Navigator.pushNamed(
                  context,
                  '/parked-car-details',
                  arguments: car,
                );
              };
            } else if (record.category == ServiceCategory.barrels &&
                record.payload is BarrelShipment) {
              final shipment = record.payload as BarrelShipment;
              onTap = () {
                Navigator.pushNamed(
                  context,
                  '/barrel-shipment-details',
                  arguments: shipment,
                );
              };
            } else if (record.category == ServiceCategory.transport &&
                record.payload is TransportRequest) {
              final request = record.payload as TransportRequest;
              onTap = () {
                Navigator.pushNamed(
                  context,
                  '/transport-request-details',
                  arguments: request,
                );
              };
            } else if (record.category == ServiceCategory.freight) {
              onTap = () {
                unawaited(
                  launchUrl(
                    Uri.parse('https://business.laawoldigital.com/'),
                    mode: LaunchMode.externalApplication,
                  ),
                );
              };
            } else {
              onTap = null;
            }

            if (onTap != null) {
              return GestureDetector(onTap: onTap, child: card);
            }
            return card;
          }),
      ],
    );
  }
}

/// The lot's margin totals, made live. Cars in the lot and departed as counts;
/// money collected and still owed as amounts; capacity when the lot has set
/// it. The whole thing re-totals to whatever the filters below leave in view,
/// the same numbers the console shows over its table.
class _ParkingScoreboard extends StatelessWidget {
  const _ParkingScoreboard({required this.l10n, required this.totals});

  final AppLocalizations l10n;
  final BusinessParkingTotals totals;

  @override
  Widget build(BuildContext context) {
    final money = NumberFormat.simpleCurrency(
      locale: Localizations.localeOf(context).toString(),
      name: 'USD',
    );
    final stats = <Widget>[
      _ParkingStat(label: l10n.parkingScoreInLot, value: '${totals.inLot}'),
      _ParkingStat(label: l10n.parkingScoreLeft, value: '${totals.left}'),
      _ParkingStat(
        label: l10n.parkingScoreCollected,
        value: money.format(totals.collected),
      ),
      _ParkingStat(
        label: l10n.parkingScoreOwed,
        value: money.format(totals.owed),
        emphasis: totals.owed > 0,
      ),
      if (totals.spacesTotal > 0)
        _ParkingStat(
          label: l10n.parkingScoreSpaces,
          value: '${totals.spacesUsed} / ${totals.spacesTotal}',
        ),
    ];
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.rule),
      ),
      child: Wrap(
        spacing: 22,
        runSpacing: 12,
        children: stats,
      ),
    );
  }
}

class _ParkingStat extends StatelessWidget {
  const _ParkingStat({
    required this.label,
    required this.value,
    this.emphasis = false,
  });

  final String label;
  final String value;

  /// Owed is drawn in the warning colour when there is anything to chase, so
  /// the one number a lot acts on stands out - like the console's amber.
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label.toUpperCase(),
          style: const TextStyle(
            color: AppColors.muted,
            fontSize: 11,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.4,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          value,
          style: TextStyle(
            color: emphasis ? AppColors.warn : AppColors.ink,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }
}

class _RecordCard extends StatelessWidget {
  const _RecordCard({
    required this.title,
    required this.subtitle,
    required this.date,
    required this.categoryLabel,
    required this.categoryIcon,
    this.paymentFields,
  });

  final String title;
  final String subtitle;
  final DateTime date;
  final String categoryLabel;
  final IconData categoryIcon;

  /// Raw parked-car fields, or null for a record that has no payment state of
  /// its own to show.
  final Map<String, dynamic>? paymentFields;

  @override
  Widget build(BuildContext context) {
    final formatter = DateFormat('MMM dd, yyyy');

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.paper,
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // The category chip and the payment badge wrap rather than
                    // overflow: two chips plus a date do not fit one line on a
                    // narrow phone.
                    Expanded(
                      child: Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.parchment,
                              border: Border.all(color: AppColors.rule),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  categoryIcon,
                                  color: AppColors.cobalt,
                                  size: 16,
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  categoryLabel,
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.ink,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          if (paymentFields != null)
                            BusinessParkingPaymentBadge(
                              paymentFields: paymentFields!,
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      formatter.format(date),
                      style: TextStyle(
                        fontSize: 12,
                        color: AppColors.muted,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  subtitle,
                  style: TextStyle(fontSize: 14, color: AppColors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Icon(Icons.arrow_forward_ios, color: AppColors.muted, size: 16),
        ],
      ),
    );
  }
}

/// One "more tools" button: the console section it stands in for.
class _BusinessTool {
  const _BusinessTool(this.key, this.icon, this.label, this.onPressed);

  final String key;
  final IconData icon;
  final String label;
  final VoidCallback onPressed;
}

/// The one thing this screen is for, and the only filled button on it.
///
/// A filled button is a commit: it does something. When three of them stack up
/// the eye has no entry point and the screen reads as a menu of equals, which
/// is how the business home used to look. Everything else on the page is
/// quieter than this by design.
class _PrimaryAction extends StatelessWidget {
  const _PrimaryAction({
    required this.buttonKey,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final Key buttonKey;
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      key: buttonKey,
      onTap: onTap,
      child: Container(
        height: 52,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.cobalt,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          boxShadow: [
            BoxShadow(
              color: AppColors.cobaltDeep.withValues(alpha: 0.18),
              blurRadius: 10,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 19, color: Colors.white),
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
    );
  }
}

/// One place the business can go.
class _Destination {
  const _Destination({
    required this.rowKey,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final Key rowKey;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
}

/// Destinations, grouped the way a list of places is grouped everywhere else
/// on the platform: one surface, hairlines between the rows, a chevron saying
/// each one leads somewhere.
class _DestinationGroup extends StatelessWidget {
  const _DestinationGroup({required this.rows});

  final List<_Destination> rows;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return const SizedBox.shrink();
    return Container(
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0)
              // Inset to start under the text, so the icons read as one column.
              const Padding(
                padding: EdgeInsets.only(left: 60),
                child: Divider(height: 1, thickness: 1),
              ),
            _DestinationRow(row: rows[i]),
          ],
        ],
      ),
    );
  }
}

class _DestinationRow extends StatelessWidget {
  const _DestinationRow({required this.row});

  final _Destination row;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      key: row.rowKey,
      onTap: row.onTap,
      scale: 0.99,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: 14,
        ),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.mist,
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              ),
              child: Icon(row.icon, size: 18, color: AppColors.cobaltDeep),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    row.title,
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
                    row.subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 12,
                      height: 1.35,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            const Icon(Icons.chevron_right, size: 20, color: AppColors.muted),
          ],
        ),
      ),
    );
  }
}
