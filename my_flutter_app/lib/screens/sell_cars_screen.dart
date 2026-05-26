import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/car.dart';
import '../widgets/language_toggle.dart';
import 'car_details_screen.dart';
import '../theme/app_colors.dart';

class SellCarsScreen extends StatefulWidget {
  const SellCarsScreen({super.key});

  @override
  State<SellCarsScreen> createState() => _SellCarsScreenState();
}

class _SellCarsScreenState extends State<SellCarsScreen> {
  final TextEditingController _searchController = TextEditingController();
  StreamSubscription<QuerySnapshot>? _subscription;
  final NumberFormat _currency = NumberFormat.simpleCurrency();
  _CarFilters _filters = const _CarFilters();

  List<Car> _allCars = <Car>[];
  List<Car> _filteredCars = <Car>[];

  bool _isLoading = true;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _searchController.addListener(_handleSearch);
    _subscribeToCars();
  }

  void _subscribeToCars() {
    _subscription = FirebaseFirestore.instance
        .collection('cars')
        .where('status', isEqualTo: 'active')
        .snapshots()
        .listen(
          (snapshot) {
            final cars = snapshot.docs
                .map((doc) => Car.fromFirestore(doc))
                .toList();
            if (!mounted) return;
            setState(() {
              _allCars = cars;
              _filteredCars = _applyFilter(_searchController.text, cars);
              _isLoading = false;
              _errorMessage = null;
            });
          },
          onError: (error) {
            if (!mounted) return;
            setState(() {
              _errorMessage = error.toString();
              _isLoading = false;
            });
          },
        );
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _searchController.removeListener(_handleSearch);
    _searchController.dispose();
    super.dispose();
  }

  List<Car> _applyFilter(String query, List<Car> cars) {
    final lower = query.toLowerCase();
    final filtered = cars.where((car) {
      final priceString = _currency.format(car.price).toLowerCase();
      final matchesQuery =
          query.isEmpty ||
          car.title.toLowerCase().contains(lower) ||
          car.make.toLowerCase().contains(lower) ||
          car.model.toLowerCase().contains(lower) ||
          car.year.toLowerCase().contains(lower) ||
          car.mileage.toLowerCase().contains(lower) ||
          priceString.contains(lower);
      final year = int.tryParse(car.year);
      return matchesQuery &&
          (_filters.make == null || car.make == _filters.make) &&
          (_filters.model == null || car.model == _filters.model) &&
          (_filters.minYear == null ||
              (year != null && year >= _filters.minYear!)) &&
          (_filters.maxYear == null ||
              (year != null && year <= _filters.maxYear!)) &&
          (_filters.maxPrice == null || car.price <= _filters.maxPrice!);
    }).toList();

    filtered.sort((a, b) {
      switch (_filters.sort) {
        case _CarSort.priceLow:
          return a.price.compareTo(b.price);
        case _CarSort.priceHigh:
          return b.price.compareTo(a.price);
        case _CarSort.yearNew:
          return (int.tryParse(b.year) ?? 0).compareTo(
            int.tryParse(a.year) ?? 0,
          );
        case _CarSort.yearOld:
          return (int.tryParse(a.year) ?? 0).compareTo(
            int.tryParse(b.year) ?? 0,
          );
      }
    });
    return filtered;
  }

  void _handleSearch() {
    setState(() {
      _filteredCars = _applyFilter(
        _searchController.text,
        List<Car>.from(_allCars),
      );
    });
  }

  void _updateFilters(_CarFilters filters) {
    setState(() {
      _filters = filters;
      _filteredCars = _applyFilter(_searchController.text, _allCars);
    });
  }

  List<String> _valuesFor(String Function(Car car) selector) {
    final values =
        _allCars
            .map(selector)
            .where((value) => value.trim().isNotEmpty)
            .toSet()
            .toList()
          ..sort();
    return values;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: SafeArea(
        child: Column(
          children: [
            _BrowseHeader(l10n: l10n),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 14),
              child: Row(
                children: [
                  Expanded(
                    child: _SearchField(
                      controller: _searchController,
                      l10n: l10n,
                    ),
                  ),
                  const SizedBox(width: 10),
                  _FilterButton(
                    isActive: _filters.isActive,
                    count: _filters.activeCount,
                    onTap: () async {
                      final filters = await showModalBottomSheet<_CarFilters>(
                        context: context,
                        isScrollControlled: true,
                        useSafeArea: true,
                        builder: (_) => _FilterSheet(
                          initialFilters: _filters,
                          makes: _valuesFor((car) => car.make),
                          models: _valuesFor((car) => car.model),
                        ),
                      );
                      if (filters != null) _updateFilters(filters);
                    },
                  ),
                ],
              ),
            ),
            if (_filters.isActive)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                child: _ActiveFilterBar(
                  filters: _filters,
                  onClear: () => _updateFilters(const _CarFilters()),
                ),
              ),
            Expanded(child: _buildContent(context, l10n)),
          ],
        ),
      ),
    );
  }

  Widget _buildContent(BuildContext context, AppLocalizations l10n) {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_errorMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            l10n.operationFailed(_errorMessage!),
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey.shade700),
          ),
        ),
      );
    }

    if (_filteredCars.isEmpty) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
        child: _EmptyState(l10n: l10n),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 2, 20, 24),
      itemCount: _filteredCars.length,
      separatorBuilder: (_, __) => const SizedBox(height: 14),
      itemBuilder: (context, index) {
        final car = _filteredCars[index];
        return _CarListTile(
          car: car,
          priceText: _currency.format(car.price),
          l10n: l10n,
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => CarDetailsScreen(car: car)),
            );
          },
        );
      },
    );
  }
}

enum _CarSort { yearNew, priceLow, priceHigh, yearOld }

class _CarFilters {
  const _CarFilters({
    this.make,
    this.model,
    this.minYear,
    this.maxYear,
    this.maxPrice,
    this.sort = _CarSort.yearNew,
  });

  final String? make;
  final String? model;
  final int? minYear;
  final int? maxYear;
  final double? maxPrice;
  final _CarSort sort;

  bool get isActive =>
      make != null ||
      model != null ||
      minYear != null ||
      maxYear != null ||
      maxPrice != null ||
      sort != _CarSort.yearNew;

  int get activeCount => [
    make,
    model,
    minYear,
    maxYear,
    maxPrice,
    if (sort != _CarSort.yearNew) sort,
  ].where((value) => value != null).length;

  _CarFilters copyWith({
    String? make,
    String? model,
    int? minYear,
    int? maxYear,
    double? maxPrice,
    _CarSort? sort,
    bool clearMake = false,
    bool clearModel = false,
    bool clearMinYear = false,
    bool clearMaxYear = false,
    bool clearMaxPrice = false,
  }) {
    return _CarFilters(
      make: clearMake ? null : make ?? this.make,
      model: clearModel ? null : model ?? this.model,
      minYear: clearMinYear ? null : minYear ?? this.minYear,
      maxYear: clearMaxYear ? null : maxYear ?? this.maxYear,
      maxPrice: clearMaxPrice ? null : maxPrice ?? this.maxPrice,
      sort: sort ?? this.sort,
    );
  }
}

class _FilterButton extends StatelessWidget {
  const _FilterButton({
    required this.isActive,
    required this.count,
    required this.onTap,
  });

  final bool isActive;
  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return SizedBox(
      height: 54,
      width: 58,
      child: FilledButton(
        onPressed: onTap,
        style: FilledButton.styleFrom(
          padding: EdgeInsets.zero,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
        ),
        child: Stack(
          alignment: Alignment.center,
          children: [
            Tooltip(message: l10n.filters, child: const Icon(Icons.tune)),
            if (isActive)
              Positioned(
                right: 9,
                top: 8,
                child: Container(
                  width: 18,
                  height: 18,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    color: AppColors.saffron,
                    shape: BoxShape.circle,
                  ),
                  child: Text(
                    '$count',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ActiveFilterBar extends StatelessWidget {
  const _ActiveFilterBar({required this.filters, required this.onClear});

  final _CarFilters filters;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Row(
      children: [
        Expanded(
          child: Text(
            l10n.filteredResults(filters.activeCount),
            style: const TextStyle(
              color: AppColors.lightMuted,
              fontWeight: FontWeight.w700,
              fontSize: 12,
            ),
          ),
        ),
        TextButton(onPressed: onClear, child: Text(l10n.clearFilters)),
      ],
    );
  }
}

class _FilterSheet extends StatefulWidget {
  const _FilterSheet({
    required this.initialFilters,
    required this.makes,
    required this.models,
  });

  final _CarFilters initialFilters;
  final List<String> makes;
  final List<String> models;

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late _CarFilters _filters = widget.initialFilters;

  static const _years = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2018, 2016];
  static const _prices = <double>[10000, 15000, 20000, 30000, 50000, 75000];

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final currency = NumberFormat.simpleCurrency();
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.filters,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              key: ValueKey('make-${_filters.make}'),
              initialValue: _filters.make,
              decoration: InputDecoration(labelText: l10n.make),
              items: widget.makes
                  .map(
                    (make) => DropdownMenuItem(value: make, child: Text(make)),
                  )
                  .toList(),
              onChanged: (value) {
                setState(() {
                  _filters = _filters.copyWith(make: value, clearModel: true);
                });
              },
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              key: ValueKey('model-${_filters.model}'),
              initialValue: _filters.model,
              decoration: InputDecoration(labelText: l10n.model),
              items: widget.models
                  .map(
                    (model) =>
                        DropdownMenuItem(value: model, child: Text(model)),
                  )
                  .toList(),
              onChanged: (value) {
                setState(() {
                  _filters = _filters.copyWith(model: value);
                });
              },
            ),
            const SizedBox(height: 18),
            Text(l10n.yearRange, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<int>(
                    key: ValueKey('min-year-${_filters.minYear}'),
                    initialValue: _filters.minYear,
                    decoration: InputDecoration(labelText: l10n.minYear),
                    items: _years
                        .map(
                          (year) => DropdownMenuItem(
                            value: year,
                            child: Text('$year'),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      setState(() {
                        _filters = _filters.copyWith(minYear: value);
                      });
                    },
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: DropdownButtonFormField<int>(
                    key: ValueKey('max-year-${_filters.maxYear}'),
                    initialValue: _filters.maxYear,
                    decoration: InputDecoration(labelText: l10n.maxYear),
                    items: _years
                        .map(
                          (year) => DropdownMenuItem(
                            value: year,
                            child: Text('$year'),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      setState(() {
                        _filters = _filters.copyWith(maxYear: value);
                      });
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Text(l10n.maxPrice, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _prices.map((price) {
                return ChoiceChip(
                  selected: _filters.maxPrice == price,
                  label: Text(currency.format(price)),
                  onSelected: (_) {
                    setState(() {
                      _filters = _filters.maxPrice == price
                          ? _filters.copyWith(clearMaxPrice: true)
                          : _filters.copyWith(maxPrice: price);
                    });
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 18),
            Text(l10n.sortBy, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _CarSort.values.map((sort) {
                return ChoiceChip(
                  selected: _filters.sort == sort,
                  label: Text(_sortLabel(l10n, sort)),
                  onSelected: (_) {
                    setState(() {
                      _filters = _filters.copyWith(sort: sort);
                    });
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => setState(() {
                      _filters = const _CarFilters();
                    }),
                    child: Text(l10n.clearFilters),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: () => Navigator.pop(context, _filters),
                    child: Text(l10n.applyFilters),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _sortLabel(AppLocalizations l10n, _CarSort sort) {
    switch (sort) {
      case _CarSort.yearNew:
        return l10n.newestYear;
      case _CarSort.priceLow:
        return l10n.priceLowToHigh;
      case _CarSort.priceHigh:
        return l10n.priceHighToLow;
      case _CarSort.yearOld:
        return l10n.oldestYear;
    }
  }
}

class _BrowseHeader extends StatelessWidget {
  const _BrowseHeader({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        gradient: AppColors.headerGradient,
        borderRadius: BorderRadius.only(
          bottomLeft: Radius.circular(28),
          bottomRight: Radius.circular(28),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.availableCars,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 28,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 0,
                    ),
                  ),
                ),
                const LanguageToggle(),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              l10n.browsePurchaseReserve,
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.76),
                fontSize: 14,
                height: 1.35,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.controller, required this.l10n});

  final TextEditingController controller;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.lightOutline),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: TextField(
        controller: controller,
        decoration: InputDecoration(
          hintText: l10n.searchCars,
          prefixIcon: const Icon(Icons.search, color: AppColors.brandRed),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 18,
            vertical: 17,
          ),
          filled: false,
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.directions_car, size: 72, color: Colors.grey.shade400),
          const SizedBox(height: 20),
          Text(
            l10n.noCarsAvailable,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: Colors.grey.shade700,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            l10n.checkBackSoon,
            style: TextStyle(fontSize: 14, color: Colors.grey.shade500),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

class _CarListTile extends StatelessWidget {
  const _CarListTile({
    required this.car,
    required this.priceText,
    required this.l10n,
    required this.onTap,
  });

  final Car car;
  final String priceText;
  final AppLocalizations l10n;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final imageUrl = car.imageUrls.isNotEmpty ? car.imageUrls.first : null;
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.lightOutline),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.04),
                blurRadius: 16,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: imageUrl != null
                    ? Image.network(
                        imageUrl,
                        width: 108,
                        height: 112,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) {
                          return const _ImagePlaceholder();
                        },
                      )
                    : const _ImagePlaceholder(),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: SizedBox(
                  height: 112,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        car.title,
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 18,
                        ),
                        overflow: TextOverflow.ellipsis,
                        maxLines: 2,
                      ),
                      const SizedBox(height: 5),
                      Text(
                        '${car.make} ${car.model} - ${car.year}',
                        style: TextStyle(
                          color: AppColors.lightMuted,
                          fontSize: 14,
                        ),
                        overflow: TextOverflow.ellipsis,
                        maxLines: 1,
                      ),
                      const Spacer(),
                      Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: [
                          _SpecChip(icon: Icons.speed, label: car.mileage),
                          _SpecChip(
                            icon: Icons.event_available,
                            label: l10n.reserveViewing,
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              priceText,
                              style: const TextStyle(
                                fontWeight: FontWeight.w900,
                                fontSize: 18,
                                color: AppColors.brandRed,
                              ),
                              overflow: TextOverflow.ellipsis,
                              maxLines: 1,
                            ),
                          ),
                          const Icon(
                            Icons.arrow_forward_ios,
                            size: 16,
                            color: AppColors.brandRed,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SpecChip extends StatelessWidget {
  const _SpecChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: AppColors.lightSurfaceVariant,
        borderRadius: BorderRadius.circular(9),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: AppColors.brandRed),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.lightMuted,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

class _ImagePlaceholder extends StatelessWidget {
  const _ImagePlaceholder();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 108,
      height: 112,
      decoration: BoxDecoration(
        color: AppColors.lightSurfaceVariant,
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Icon(
        Icons.directions_car,
        size: 42,
        color: AppColors.lightMuted,
      ),
    );
  }
}
