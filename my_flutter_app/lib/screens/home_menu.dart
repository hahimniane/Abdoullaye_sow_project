import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:provider/provider.dart';
import '../models/parked_car.dart';
import '../models/barrel_shipment.dart';
import '../models/transport_request.dart';
import '../models/business_service.dart' as business_services;
import '../providers/auth_provider.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';
import '../theme/app_colors.dart';

enum ServiceCategory { all, parking, barrels, transport, sales }

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
  final List<TransportRequest> _transportRequests = [];
  bool _isLoading = true;
  ServiceCategory _selectedCategory = ServiceCategory.all;
  StreamSubscription<QuerySnapshot>? _parkedCarsSubscription;
  StreamSubscription<QuerySnapshot>? _barrelShipmentsSubscription;
  StreamSubscription<QuerySnapshot>? _transportRequestsSubscription;
  bool _parkedLoaded = false;
  bool _barrelsLoaded = false;
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

    _parkedCarsSubscription =
        scope(
          FirebaseFirestore.instance.collection('parkedCars'),
          'parkingDate',
        ).snapshots().listen(
          (snapshot) {
            final parkedCars = snapshot.docs
                .map((doc) => ParkedCar.fromFirestore(doc))
                .toList();
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
      _isLoading = !(_parkedLoaded && _barrelsLoaded && _transportLoaded);
    });
  }

  List<ActivityRecord> get _filteredRecords {
    final enabled = _enabledActivityCategories();
    final serviceRecords = _records
        .where((record) => enabled.contains(record.category))
        .toList();
    if (_selectedCategory == ServiceCategory.all) {
      return serviceRecords;
    }
    return serviceRecords
        .where((record) => record.category == _selectedCategory)
        .toList();
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
      ))
        ServiceCategory.parking,
      if (business_services.hasBusinessService(
        services,
        business_services.BusinessServiceKey.barrelShipping,
      ))
        ServiceCategory.barrels,
      if (business_services.hasBusinessService(
        services,
        business_services.BusinessServiceKey.carTransport,
      ))
        ServiceCategory.transport,
      if (business_services.hasBusinessService(
        services,
        business_services.BusinessServiceKey.carSales,
      ))
        ServiceCategory.sales,
    };
  }

  @override
  void dispose() {
    _parkedCarsSubscription?.cancel();
    _barrelShipmentsSubscription?.cancel();
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
              children: const [
                TextSpan(text: 'Services'),
                TextSpan(
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
    final showParking = business_services.hasBusinessService(
      services,
      business_services.BusinessServiceKey.carParking,
    );
    final showBarrels = business_services.hasBusinessService(
      services,
      business_services.BusinessServiceKey.barrelShipping,
    );
    final showTransport = business_services.hasBusinessService(
      services,
      business_services.BusinessServiceKey.carTransport,
    );
    final showSales = business_services.hasBusinessService(
      services,
      business_services.BusinessServiceKey.carSales,
    );
    return Container(
      padding: EdgeInsets.all(width * 0.06),
      decoration: BoxDecoration(
        color: AppColors.paper,
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        children: [
          if (showParking) ...[
            _MenuButton(
              title: l10n.parkACar,
              icon: Icons.local_parking,
              onTap: () => Navigator.pushNamed(context, '/park'),
            ),
            const SizedBox(height: 12),
          ],
          if (showBarrels) ...[
            _MenuButton(
              title: l10n.sendBarrels,
              icon: Icons.local_shipping,
              onTap: () => Navigator.pushNamed(context, '/barrel'),
            ),
            const SizedBox(height: 12),
          ],
          if (showTransport) ...[
            _MenuButton(
              title: l10n.transportCars,
              icon: Icons.directions_car,
              onTap: () => Navigator.pushNamed(context, '/transport'),
            ),
            const SizedBox(height: 12),
          ],
          if (showSales)
            _MenuButton(
              title: l10n.sellCars,
              icon: Icons.sell,
              onTap: () => Navigator.pushNamed(context, '/sell'),
            ),
          if (!showParking && !showBarrels && !showTransport && !showSales)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(l10n.noServicesEnabledYet),
            ),
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
  });

  final AppLocalizations l10n;
  final List<ActivityRecord> records;
  final bool isLoading;
  final ServiceCategory selectedCategory;
  final ValueChanged<ServiceCategory> onCategoryChanged;

  Color _categoryColor(ServiceCategory category) {
    switch (category) {
      case ServiceCategory.parking:
        return AppColors.sage;
      case ServiceCategory.barrels:
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
      case ServiceCategory.transport:
        return l10n.filterTransport;
      case ServiceCategory.sales:
        return l10n.filterSales;
    }
  }

  @override
  Widget build(BuildContext context) {
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
              l10n.noRecordsYet,
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
            final card = _RecordCard(
              title: record.title,
              subtitle: record.subtitle,
              date: record.date,
              categoryLabel: _categoryLabel(record.category, l10n),
              categoryIcon: _categoryIcon(record.category),
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
  });

  final String title;
  final String subtitle;
  final DateTime date;
  final String categoryLabel;
  final IconData categoryIcon;

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
                        children: [
                          Icon(categoryIcon, color: AppColors.cobalt, size: 16),
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
                    const Spacer(),
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

class _MenuButton extends StatelessWidget {
  final String title;
  final IconData icon;
  final VoidCallback onTap;

  const _MenuButton({
    required this.title,
    required this.icon,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(minHeight: 60, maxHeight: 80),
      child: ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.paper,
          foregroundColor: AppColors.ink,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.zero,
            side: const BorderSide(color: AppColors.rule),
          ),
          elevation: 0,
          splashFactory: NoSplash.splashFactory,
        ),
        onPressed: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8.0, vertical: 12.0),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 24),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                  textAlign: TextAlign.center,
                  overflow: TextOverflow.ellipsis,
                  maxLines: 2,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
