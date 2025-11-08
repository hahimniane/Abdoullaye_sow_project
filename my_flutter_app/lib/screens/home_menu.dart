import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/parked_car.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';

enum ServiceCategory { all, parking, barrels, transport, sales }

enum ServiceStatus { active, processing, completed }

class ServiceRecord {
  ServiceRecord({
    required this.category,
    required this.title,
    required this.reference,
    required this.status,
    required this.date,
    required this.details,
  });

  final ServiceCategory category;
  final String title;
  final String reference;
  final ServiceStatus status;
  final DateTime date;
  final String details;
}

class HomeMenu extends StatefulWidget {
  const HomeMenu({super.key});

  @override
  State<HomeMenu> createState() => _HomeMenuState();
}

class _HomeMenuState extends State<HomeMenu> {
  List<dynamic> _records = [];
  bool _isLoading = true;
  ServiceCategory _selectedCategory = ServiceCategory.all;
  StreamSubscription<QuerySnapshot>? _parkedCarsSubscription;

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
        if (mounted) {
          setState(() {
            _records = parkedCars;
            _isLoading = false;
          });
        }
      },
      onError: (_) {
        if (mounted) {
          setState(() {
            _isLoading = false;
          });
        }
      },
    );
  }

  List<dynamic> get _filteredRecords {
    if (_selectedCategory == ServiceCategory.all) {
      return _records;
    }
    return _records.where((record) {
      if (record is ParkedCar && _selectedCategory == ServiceCategory.parking) {
        return true;
      }
      // Add similar checks for other record types here
      return false;
    }).toList();
  }

  @override
  void dispose() {
    _parkedCarsSubscription?.cancel();
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
  final List<dynamic> records;
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
          ...records.map(
            (record) {
              if (record is ParkedCar) {
                return GestureDetector(
                  onTap: () {
                    Navigator.pushNamed(
                      context,
                      '/parked-car-details',
                      arguments: record,
                    );
                  },
                  child: _RecordCard(
                    title: '${record.carMake} ${record.carModel}',
                    subtitle: record.ownerName,
                    date: record.parkingDate,
                    categoryLabel: _categoryLabel(ServiceCategory.parking, l10n),
                    categoryColor: _categoryColor(ServiceCategory.parking),
                    categoryIcon: _categoryIcon(ServiceCategory.parking),
                  ),
                );
              }
              // Add similar checks for other record types here
              return const SizedBox.shrink();
            },
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
