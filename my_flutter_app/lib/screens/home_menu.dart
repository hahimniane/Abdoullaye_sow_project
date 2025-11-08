import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/parked_car.dart';
import '../models/barrel_shipment.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';

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
  bool _isLoading = true;
  ServiceCategory _selectedCategory = ServiceCategory.all;
  StreamSubscription<QuerySnapshot>? _parkedCarsSubscription;
  StreamSubscription<QuerySnapshot>? _barrelShipmentsSubscription;
  bool _parkedLoaded = false;
  bool _barrelsLoaded = false;

  @override
  void initState() {
    super.initState();
    _subscribeToRecords();
  }

  void _subscribeToRecords() {
    setState(() {
      _isLoading = true;
    });

    _parkedCarsSubscription = FirebaseFirestore.instance
        .collection('parkedCars')
        .orderBy('parkingDate', descending: true)
        .snapshots()
        .listen(
      (snapshot) {
        final parkedCars =
            snapshot.docs.map((doc) => ParkedCar.fromFirestore(doc)).toList();
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

    _barrelShipmentsSubscription = FirebaseFirestore.instance
        .collection('barrelShipments')
        .orderBy('createdAt', descending: true)
        .snapshots()
        .listen(
      (snapshot) {
        final shipments =
            snapshot.docs.map((doc) => BarrelShipment.fromFirestore(doc)).toList();
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

    combined.sort((a, b) => b.date.compareTo(a.date));

    setState(() {
      _records
        ..clear()
        ..addAll(combined);
      _isLoading = !(_parkedLoaded && _barrelsLoaded);
    });
  }

  List<ActivityRecord> get _filteredRecords {
    if (_selectedCategory == ServiceCategory.all) {
      return List<ActivityRecord>.from(_records);
    }
    return _records
        .where((record) => record.category == _selectedCategory)
        .toList();
  }

  @override
  void dispose() {
    _parkedCarsSubscription?.cancel();
    _barrelShipmentsSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final width = MediaQuery.of(context).size.width;

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF667eea), Color(0xFF764ba2)],
          ),
        ),
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
        color: Colors.white.withOpacity(0.2),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.white.withOpacity(0.25)),
      ),
      child: Column(
        children: [
          Container(
            width: 70,
            height: 70,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.18),
              borderRadius: BorderRadius.circular(24),
            ),
            child: const Icon(Icons.business, color: Colors.white, size: 32),
          ),
          const SizedBox(height: 16),
          Text(
            l10n.welcomeToBusinessServices,
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 6),
          Text(
            l10n.chooseServiceToStart,
            style: const TextStyle(fontSize: 14, color: Colors.white70),
            textAlign: TextAlign.center,
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
    return Container(
      padding: EdgeInsets.all(width * 0.06),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.08),
            blurRadius: 18,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        children: [
          _MenuButton(
            title: l10n.parkACar,
            icon: Icons.local_parking,
            onTap: () => Navigator.pushNamed(context, '/park'),
          ),
          const SizedBox(height: 12),
          _MenuButton(
            title: l10n.sendBarrelsToGuinea,
            icon: Icons.local_shipping,
            onTap: () => Navigator.pushNamed(context, '/barrel'),
          ),
          const SizedBox(height: 12),
          _MenuButton(
            title: l10n.transportCarsToGuinea,
            icon: Icons.directions_car,
            onTap: () => Navigator.pushNamed(context, '/transport'),
          ),
          const SizedBox(height: 12),
          _MenuButton(
            title: l10n.sellCars,
            icon: Icons.sell,
            onTap: () => Navigator.pushNamed(context, '/sell'),
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
        return const Color(0xFF667eea);
      case ServiceCategory.barrels:
        return const Color(0xFF9364f4);
      case ServiceCategory.transport:
        return const Color(0xFF5ED5A8);
      case ServiceCategory.sales:
        return const Color(0xFFF7A24B);
      case ServiceCategory.all:
        return const Color(0xFF667eea);
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
            color: Colors.white,
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 16),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: ServiceCategory.values.map((category) {
              final isSelected = category == selectedCategory;
              return Padding(
                padding: const EdgeInsets.only(right: 8),
                child: ChoiceChip(
                  label: Text(_categoryLabel(category, l10n)),
                  selected: isSelected,
                  onSelected: (_) => onCategoryChanged(category),
                  avatar: Icon(
                    _categoryIcon(category),
                    size: 18,
                    color: isSelected ? Colors.white : Colors.white70,
                  ),
                  labelStyle: TextStyle(
                    color: isSelected ? Colors.white : Colors.white70,
                    fontWeight: FontWeight.w600,
                  ),
                  backgroundColor: Colors.white.withOpacity(0.12),
                  selectedColor: _categoryColor(category),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20),
                    side: BorderSide(color: Colors.white.withOpacity(0.2)),
                  ),
                ),
              );
            }).toList(),
          ),
        ),
        const SizedBox(height: 16),
        if (isLoading)
          const Center(child: CircularProgressIndicator(color: Colors.white))
        else if (records.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 48, horizontal: 24),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.1),
              borderRadius: BorderRadius.circular(24),
            ),
            child: Text(
              l10n.noRecordsYet,
              style: TextStyle(
                fontSize: 15,
                color: Colors.white.withOpacity(0.7),
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
              categoryColor: _categoryColor(record.category),
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
    required this.categoryColor,
    required this.categoryIcon,
  });

  final String title;
  final String subtitle;
  final DateTime date;
  final String categoryLabel;
  final Color categoryColor;
  final IconData categoryIcon;

  @override
  Widget build(BuildContext context) {
    final formatter = DateFormat('MMM dd, yyyy');

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.15),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withOpacity(0.2)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: categoryColor.withOpacity(0.8),
              borderRadius: BorderRadius.circular(16),
              boxShadow: [
                BoxShadow(
                  color: categoryColor.withOpacity(0.3),
                  blurRadius: 8,
                  offset: const Offset(0, 4),
                )
              ],
            ),
            child: Icon(categoryIcon, color: Colors.white, size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '$subtitle • ${formatter.format(date)}',
                  style: TextStyle(
                    fontSize: 13,
                    color: Colors.white.withOpacity(0.8),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Icon(Icons.arrow_forward_ios, color: Colors.white.withOpacity(0.6), size: 16),
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
          backgroundColor: const Color(0xFF667eea),
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
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
