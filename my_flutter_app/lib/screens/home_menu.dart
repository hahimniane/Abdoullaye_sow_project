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
import '../services/business_parking_entry.dart';
import '../utils/business_parking_localization.dart';
import '../utils/business_permissions.dart';
import 'business_assistant_screen.dart';
import 'park_car_screen.dart';

enum ServiceCategory { all, parking, barrels, freight, transport, sales }

class HomeMenu extends StatefulWidget {
  const HomeMenu({super.key});

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
  final List<TransportRequest> _transportRequests = [];
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
  bool _parkedLoaded = false;
  bool _barrelsLoaded = false;
  bool _freightLoaded = false;
  bool _transportLoaded = false;

  @override
  void initState() {
    super.initState();
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
    } else {
      _transportLoaded = true;
    }
    _rebuildActivityRecords();
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
              _transportLoaded);
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
    final services = auth.businessServices.isEmpty
        ? business_services.defaultBusinessServiceValues
        : auth.businessServices;
    return {
      if (business_services.hasBusinessService(
            services,
            business_services.BusinessServiceKey.carParking,
          ) &&
          auth.hasBusinessPermission(BusinessPermission.parking))
        ServiceCategory.parking,
      if (business_services.hasBusinessService(
            services,
            business_services.BusinessServiceKey.barrelShipping,
          ) &&
          auth.hasBusinessPermission(BusinessPermission.barrels))
        ServiceCategory.barrels,
      if (business_services.hasBusinessService(
            services,
            business_services.BusinessServiceKey.freight,
          ) &&
          auth.hasBusinessPermission(BusinessPermission.freight))
        ServiceCategory.freight,
      if (business_services.hasBusinessService(
            services,
            business_services.BusinessServiceKey.carTransport,
          ) &&
          auth.hasBusinessPermission(BusinessPermission.transport))
        ServiceCategory.transport,
      if (business_services.hasBusinessService(
            services,
            business_services.BusinessServiceKey.carSales,
          ) &&
          (auth.hasBusinessPermission(BusinessPermission.listings) ||
              auth.hasBusinessPermission(BusinessPermission.purchases)))
        ServiceCategory.sales,
    };
  }

  @override
  void dispose() {
    _parkingSearchController.dispose();
    _parkedCarsSubscription?.cancel();
    _barrelShipmentsSubscription?.cancel();
    _freightShipmentsSubscription?.cancel();
    _transportRequestsSubscription?.cancel();
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
                Align(
                  alignment: Alignment.topRight,
                  child: const LanguageToggle(),
                ),
                const SizedBox(height: 16),
                _WelcomeSection(l10n: l10n, width: width),
                const SizedBox(height: 24),
                _ServicesSection(l10n: l10n, width: width),
                const SizedBox(height: 24),
                _ActivitySection(
                  l10n: l10n,
                  records: _filteredRecords,
                  isLoading: _isLoading,
                  selectedCategory: _selectedCategory,
                  onCategoryChanged: (category) {
                    setState(() {
                      _selectedCategory = category;
                      // Leaving parking takes the parking filters with it -
                      // an invisible narrowing reads as missing records.
                      _paymentFilter = BusinessParkingPaymentFilter.all;
                      _parkingStatusFilter = businessParkingStatusFilterAll;
                      _parkingSearch = '';
                      _parkingSearchController.clear();
                      _parkedFrom = null;
                      _parkedTo = null;
                    });
                  },
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

class _ServicesSection extends StatelessWidget {
  const _ServicesSection({required this.l10n, required this.width});

  final AppLocalizations l10n;
  final double width;

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
          const SizedBox(height: 8),
          Text(
            l10n.businessOperationsWebNote,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: AppColors.muted,
              height: 1.45,
            ),
          ),
          if (showSales) ...[
            const SizedBox(height: 8),
            Text(
              l10n.businessCarsMobileNote,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: AppColors.cobalt,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: AsyncActionButton.filled(
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
      onParkedRangeChanged(from != null && day.isBefore(from) ? day : from, day);
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

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    // Same gate as the parkedCars subscription in _HomeMenuState: the lot that
    // can see its parked cars is the lot that can add one, so the list and the
    // way to extend it appear together or not at all.
    final canRecordParkedCar = auth.hasBusinessPermission(
      BusinessPermission.parking,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.recentActivity,
          style: const TextStyle(
            color: AppColors.ink,
            fontSize: 17,
            fontWeight: FontWeight.bold,
          ),
        ),
        // ParkCarScreen picks its own flow from auth.hasBusinessDashboardAccess
        // (see its build), so pushing the screen directly opens the walk-up
        // intake for a business - no flag to pass, and no named customer route.
        if (canRecordParkedCar) ...[
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              key: const Key('record-parked-car'),
              icon: const Icon(Icons.local_parking),
              label: Text(l10n.recordAParkedCar),
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const ParkCarScreen(),
                  ),
                );
              },
            ),
          ),
        ],
        const SizedBox(height: 16),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: ServiceCategory.values.map((category) {
              final isSelected = category == selectedCategory;
              final chipColor = _categoryColor(category);
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: Text(_categoryLabel(category, l10n)),
                  selected: isSelected,
                  onSelected: (_) => onCategoryChanged(category),
                  avatar: Icon(
                    _categoryIcon(category),
                    size: 18,
                    color: isSelected ? AppColors.paper : chipColor,
                  ),
                  labelStyle: TextStyle(
                    color: isSelected ? AppColors.paper : chipColor,
                    fontWeight: FontWeight.w600,
                  ),
                  backgroundColor: AppColors.paper,
                  selectedColor: chipColor,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.zero,
                    side: BorderSide(
                      color: chipColor.withValues(alpha: isSelected ? 1 : 0.5),
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
        ),
        // Paid / Not paid, offered only where it means something. The lot's
        // question is "who still owes me", and scrolling a mixed activity
        // list for amber badges was the only way to answer it.
        if (selectedCategory == ServiceCategory.parking) ...[
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
