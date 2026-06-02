import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/car.dart';
import '../models/car_purchase.dart';
import '../models/business_service.dart';
import '../providers/auth_provider.dart';
import '../services/car_purchase_service.dart';
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
                .where(
                  (car) =>
                      car.businessStatus == 'approved' &&
                      hasBusinessService(
                        car.enabledServices,
                        BusinessServiceKey.carSales,
                      ),
                )
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
      final location = car.locationLabel.toLowerCase();
      final featureText = car.allFeatures.join(' ').toLowerCase();
      final matchesQuery =
          query.isEmpty ||
          car.title.toLowerCase().contains(lower) ||
          car.make.toLowerCase().contains(lower) ||
          car.model.toLowerCase().contains(lower) ||
          car.year.toLowerCase().contains(lower) ||
          car.mileage.toLowerCase().contains(lower) ||
          car.businessName.toLowerCase().contains(lower) ||
          car.condition.toLowerCase().contains(lower) ||
          car.bodyType.toLowerCase().contains(lower) ||
          car.transmission.toLowerCase().contains(lower) ||
          car.fuelType.toLowerCase().contains(lower) ||
          car.drivetrain.toLowerCase().contains(lower) ||
          location.contains(lower) ||
          featureText.contains(lower) ||
          priceString.contains(lower);
      final year = car.yearNumber;
      final mileage = car.mileageNumber;
      return matchesQuery &&
          (_filters.make == null || car.make == _filters.make) &&
          (_filters.model == null || car.model == _filters.model) &&
          (_filters.minYear == null ||
              (year != null && year >= _filters.minYear!)) &&
          (_filters.maxYear == null ||
              (year != null && year <= _filters.maxYear!)) &&
          (_filters.minPrice == null || car.price >= _filters.minPrice!) &&
          (_filters.maxPrice == null || car.price <= _filters.maxPrice!) &&
          (_filters.minMileage == null ||
              (mileage != null && mileage >= _filters.minMileage!)) &&
          (_filters.maxMileage == null ||
              (mileage != null && mileage <= _filters.maxMileage!)) &&
          (_filters.condition == null || car.condition == _filters.condition) &&
          (_filters.bodyType == null || car.bodyType == _filters.bodyType) &&
          (_filters.transmission == null ||
              car.transmission == _filters.transmission) &&
          (_filters.fuelType == null || car.fuelType == _filters.fuelType) &&
          (_filters.drivetrain == null ||
              car.drivetrain == _filters.drivetrain) &&
          (_filters.businessName == null ||
              car.businessName == _filters.businessName) &&
          (_filters.location == null ||
              car.locationLabel == _filters.location) &&
          (_filters.feature == null ||
              car.allFeatures.contains(_filters.feature));
    }).toList();

    filtered.sort((a, b) {
      switch (_filters.sort) {
        case _CarSort.priceLow:
          return a.price.compareTo(b.price);
        case _CarSort.priceHigh:
          return b.price.compareTo(a.price);
        case _CarSort.mileageLow:
          return (a.mileageNumber ?? 1 << 30).compareTo(
            b.mileageNumber ?? 1 << 30,
          );
        case _CarSort.mileageHigh:
          return (b.mileageNumber ?? -1).compareTo(a.mileageNumber ?? -1);
        case _CarSort.newest:
          return (b.createdAt ?? DateTime(1970)).compareTo(
            a.createdAt ?? DateTime(1970),
          );
        case _CarSort.yearNew:
          return (b.yearNumber ?? 0).compareTo(a.yearNumber ?? 0);
        case _CarSort.yearOld:
          return (a.yearNumber ?? 0).compareTo(b.yearNumber ?? 0);
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

  List<String> _listValuesFor(Iterable<String> Function(Car car) selector) {
    final values =
        _allCars
            .expand(selector)
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
            _BrowseHeader(
              l10n: l10n,
              totalCars: _allCars.length,
              visibleCars: _filteredCars.length,
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 14),
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
                          conditions: _valuesFor((car) => car.condition),
                          bodyTypes: _valuesFor((car) => car.bodyType),
                          transmissions: _valuesFor((car) => car.transmission),
                          fuelTypes: _valuesFor((car) => car.fuelType),
                          drivetrains: _valuesFor((car) => car.drivetrain),
                          businesses: _valuesFor((car) => car.businessName),
                          locations: _valuesFor((car) => car.locationLabel),
                          features: _listValuesFor((car) => car.allFeatures),
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
        child: _EmptyState(l10n: l10n, filtered: _filters.isActive),
      );
    }

    final user = context.watch<AuthProvider>().user;
    if (user == null) {
      return _CarList(
        cars: _filteredCars,
        currency: _currency,
        l10n: l10n,
        reservationsByCarId: const <String, CarPurchase>{},
      );
    }

    return StreamBuilder<List<CarPurchase>>(
      stream: CarPurchaseService().activeViewingReservationsForUser(user.uid),
      builder: (context, snapshot) {
        final reservationsByCarId = <String, CarPurchase>{};
        for (final reservation in snapshot.data ?? const <CarPurchase>[]) {
          reservationsByCarId.putIfAbsent(reservation.carId, () => reservation);
        }
        return _CarList(
          cars: _filteredCars,
          currency: _currency,
          l10n: l10n,
          reservationsByCarId: reservationsByCarId,
        );
      },
    );
  }
}

class _CarList extends StatelessWidget {
  const _CarList({
    required this.cars,
    required this.currency,
    required this.l10n,
    required this.reservationsByCarId,
  });

  final List<Car> cars;
  final NumberFormat currency;
  final AppLocalizations l10n;
  final Map<String, CarPurchase> reservationsByCarId;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 2, 20, 24),
      itemCount: cars.length,
      separatorBuilder: (_, __) => const SizedBox(height: 14),
      itemBuilder: (context, index) {
        final car = cars[index];
        return _CarListTile(
          car: car,
          priceText: currency.format(car.price),
          l10n: l10n,
          activeViewing: reservationsByCarId[car.id],
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

enum _CarSort {
  newest,
  yearNew,
  yearOld,
  priceLow,
  priceHigh,
  mileageLow,
  mileageHigh,
}

class _CarFilters {
  const _CarFilters({
    this.make,
    this.model,
    this.minYear,
    this.maxYear,
    this.minPrice,
    this.maxPrice,
    this.minMileage,
    this.maxMileage,
    this.condition,
    this.bodyType,
    this.transmission,
    this.fuelType,
    this.drivetrain,
    this.businessName,
    this.location,
    this.feature,
    this.sort = _CarSort.newest,
  });

  final String? make;
  final String? model;
  final int? minYear;
  final int? maxYear;
  final double? minPrice;
  final double? maxPrice;
  final int? minMileage;
  final int? maxMileage;
  final String? condition;
  final String? bodyType;
  final String? transmission;
  final String? fuelType;
  final String? drivetrain;
  final String? businessName;
  final String? location;
  final String? feature;
  final _CarSort sort;

  bool get isActive =>
      make != null ||
      model != null ||
      minYear != null ||
      maxYear != null ||
      minPrice != null ||
      maxPrice != null ||
      minMileage != null ||
      maxMileage != null ||
      condition != null ||
      bodyType != null ||
      transmission != null ||
      fuelType != null ||
      drivetrain != null ||
      businessName != null ||
      location != null ||
      feature != null ||
      sort != _CarSort.newest;

  int get activeCount => [
    make,
    model,
    minYear,
    maxYear,
    minPrice,
    maxPrice,
    minMileage,
    maxMileage,
    condition,
    bodyType,
    transmission,
    fuelType,
    drivetrain,
    businessName,
    location,
    feature,
    if (sort != _CarSort.newest) sort,
  ].where((value) => value != null).length;

  _CarFilters copyWith({
    String? make,
    String? model,
    int? minYear,
    int? maxYear,
    double? minPrice,
    double? maxPrice,
    int? minMileage,
    int? maxMileage,
    String? condition,
    String? bodyType,
    String? transmission,
    String? fuelType,
    String? drivetrain,
    String? businessName,
    String? location,
    String? feature,
    _CarSort? sort,
    bool clearMake = false,
    bool clearModel = false,
    bool clearMinYear = false,
    bool clearMaxYear = false,
    bool clearMinPrice = false,
    bool clearMaxPrice = false,
    bool clearMinMileage = false,
    bool clearMaxMileage = false,
    bool clearCondition = false,
    bool clearBodyType = false,
    bool clearTransmission = false,
    bool clearFuelType = false,
    bool clearDrivetrain = false,
    bool clearBusinessName = false,
    bool clearLocation = false,
    bool clearFeature = false,
  }) {
    return _CarFilters(
      make: clearMake ? null : make ?? this.make,
      model: clearModel ? null : model ?? this.model,
      minYear: clearMinYear ? null : minYear ?? this.minYear,
      maxYear: clearMaxYear ? null : maxYear ?? this.maxYear,
      minPrice: clearMinPrice ? null : minPrice ?? this.minPrice,
      maxPrice: clearMaxPrice ? null : maxPrice ?? this.maxPrice,
      minMileage: clearMinMileage ? null : minMileage ?? this.minMileage,
      maxMileage: clearMaxMileage ? null : maxMileage ?? this.maxMileage,
      condition: clearCondition ? null : condition ?? this.condition,
      bodyType: clearBodyType ? null : bodyType ?? this.bodyType,
      transmission: clearTransmission
          ? null
          : transmission ?? this.transmission,
      fuelType: clearFuelType ? null : fuelType ?? this.fuelType,
      drivetrain: clearDrivetrain ? null : drivetrain ?? this.drivetrain,
      businessName: clearBusinessName
          ? null
          : businessName ?? this.businessName,
      location: clearLocation ? null : location ?? this.location,
      feature: clearFeature ? null : feature ?? this.feature,
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
    required this.conditions,
    required this.bodyTypes,
    required this.transmissions,
    required this.fuelTypes,
    required this.drivetrains,
    required this.businesses,
    required this.locations,
    required this.features,
  });

  final _CarFilters initialFilters;
  final List<String> makes;
  final List<String> models;
  final List<String> conditions;
  final List<String> bodyTypes;
  final List<String> transmissions;
  final List<String> fuelTypes;
  final List<String> drivetrains;
  final List<String> businesses;
  final List<String> locations;
  final List<String> features;

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

String _carBrowserOptionLabel(AppLocalizations l10n, String value) {
  switch (value) {
    case 'new':
      return l10n.conditionNew;
    case 'used':
      return l10n.conditionUsed;
    case 'certified':
      return l10n.conditionCertified;
    case 'salvage':
      return l10n.conditionSalvage;
    case 'sedan':
      return l10n.bodySedan;
    case 'suv':
      return l10n.bodySuv;
    case 'truck':
      return l10n.bodyTruck;
    case 'van':
      return l10n.bodyVan;
    case 'coupe':
      return l10n.bodyCoupe;
    case 'hatchback':
      return l10n.bodyHatchback;
    case 'wagon':
      return l10n.bodyWagon;
    case 'convertible':
      return l10n.bodyConvertible;
    case 'automatic':
      return l10n.transmissionAutomatic;
    case 'manual':
      return l10n.transmissionManual;
    case 'cvt':
      return l10n.transmissionCvt;
    case 'gas':
      return l10n.fuelGas;
    case 'diesel':
      return l10n.fuelDiesel;
    case 'hybrid':
      return l10n.fuelHybrid;
    case 'electric':
      return l10n.fuelElectric;
    case 'plug_in_hybrid':
      return l10n.fuelPlugInHybrid;
    case 'fwd':
      return l10n.drivetrainFwd;
    case 'rwd':
      return l10n.drivetrainRwd;
    case 'awd':
      return l10n.drivetrainAwd;
    case '4wd':
      return l10n.drivetrainFourWd;
    case 'backup_camera':
      return l10n.featureBackupCamera;
    case 'bluetooth':
      return l10n.featureBluetooth;
    case 'leather_seats':
      return l10n.featureLeatherSeats;
    case 'sunroof':
      return l10n.featureSunroof;
    case 'navigation':
      return l10n.featureNavigation;
    case 'heated_seats':
      return l10n.featureHeatedSeats;
    case 'apple_carplay':
      return l10n.featureAppleCarPlay;
    case 'android_auto':
      return l10n.featureAndroidAuto;
    case 'blind_spot':
      return l10n.featureBlindSpot;
    case 'third_row':
      return l10n.featureThirdRow;
    case 'remote_start':
      return l10n.featureRemoteStart;
    case 'keyless_entry':
      return l10n.featureKeylessEntry;
    default:
      return value;
  }
}

class _FilterSheetState extends State<_FilterSheet> {
  late _CarFilters _filters = widget.initialFilters;

  static const _years = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2018, 2016];
  static const _prices = <double>[10000, 15000, 20000, 30000, 50000, 75000];
  static const _mileages = <int>[25000, 50000, 75000, 100000, 150000];

  DropdownButtonFormField<T> _dropdown<T>({
    required String label,
    required T? value,
    required List<T> values,
    required ValueChanged<T?> onChanged,
    String Function(T value)? display,
  }) {
    return DropdownButtonFormField<T>(
      initialValue: value != null && values.contains(value) ? value : null,
      decoration: InputDecoration(labelText: label),
      items: values
          .map(
            (item) => DropdownMenuItem<T>(
              value: item,
              child: Text(display == null ? '$item' : display(item)),
            ),
          )
          .toList(),
      onChanged: onChanged,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final currency = NumberFormat.simpleCurrency();
    return Padding(
      padding: EdgeInsets.fromLTRB(
        20,
        10,
        20,
        24 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.lightOutline,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
            const SizedBox(height: 16),
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
            _dropdown<String>(
              label: l10n.make,
              value: _filters.make,
              values: widget.makes,
              onChanged: (value) {
                setState(() {
                  _filters = _filters.copyWith(make: value, clearModel: true);
                });
              },
            ),
            const SizedBox(height: 12),
            _dropdown<String>(
              label: l10n.model,
              value: _filters.model,
              values: widget.models,
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
                  child: _dropdown<int>(
                    label: l10n.minYear,
                    value: _filters.minYear,
                    values: _years,
                    onChanged: (value) {
                      setState(() {
                        _filters = _filters.copyWith(minYear: value);
                      });
                    },
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _dropdown<int>(
                    label: l10n.maxYear,
                    value: _filters.maxYear,
                    values: _years,
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
            Text(l10n.minPrice, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _prices.map((price) {
                return ChoiceChip(
                  selected: _filters.minPrice == price,
                  label: Text(currency.format(price)),
                  onSelected: (_) {
                    setState(() {
                      _filters = _filters.minPrice == price
                          ? _filters.copyWith(clearMinPrice: true)
                          : _filters.copyWith(minPrice: price);
                    });
                  },
                );
              }).toList(),
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
            Text(
              l10n.minMileage,
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _mileages.map((mileage) {
                return ChoiceChip(
                  selected: _filters.minMileage == mileage,
                  label: Text(NumberFormat.decimalPattern().format(mileage)),
                  onSelected: (_) {
                    setState(() {
                      _filters = _filters.minMileage == mileage
                          ? _filters.copyWith(clearMinMileage: true)
                          : _filters.copyWith(minMileage: mileage);
                    });
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 18),
            Text(
              l10n.maxMileage,
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _mileages.map((mileage) {
                return ChoiceChip(
                  selected: _filters.maxMileage == mileage,
                  label: Text(NumberFormat.decimalPattern().format(mileage)),
                  onSelected: (_) {
                    setState(() {
                      _filters = _filters.maxMileage == mileage
                          ? _filters.copyWith(clearMaxMileage: true)
                          : _filters.copyWith(maxMileage: mileage);
                    });
                  },
                );
              }).toList(),
            ),
            const SizedBox(height: 18),
            _dropdown<String>(
              label: l10n.condition,
              value: _filters.condition,
              values: widget.conditions,
              display: (value) => _carBrowserOptionLabel(l10n, value),
              onChanged: (value) => setState(
                () => _filters = _filters.copyWith(condition: value),
              ),
            ),
            const SizedBox(height: 12),
            _dropdown<String>(
              label: l10n.bodyType,
              value: _filters.bodyType,
              values: widget.bodyTypes,
              display: (value) => _carBrowserOptionLabel(l10n, value),
              onChanged: (value) =>
                  setState(() => _filters = _filters.copyWith(bodyType: value)),
            ),
            const SizedBox(height: 12),
            _dropdown<String>(
              label: l10n.transmission,
              value: _filters.transmission,
              values: widget.transmissions,
              display: (value) => _carBrowserOptionLabel(l10n, value),
              onChanged: (value) => setState(
                () => _filters = _filters.copyWith(transmission: value),
              ),
            ),
            const SizedBox(height: 12),
            _dropdown<String>(
              label: l10n.fuelType,
              value: _filters.fuelType,
              values: widget.fuelTypes,
              display: (value) => _carBrowserOptionLabel(l10n, value),
              onChanged: (value) =>
                  setState(() => _filters = _filters.copyWith(fuelType: value)),
            ),
            const SizedBox(height: 12),
            _dropdown<String>(
              label: l10n.drivetrain,
              value: _filters.drivetrain,
              values: widget.drivetrains,
              display: (value) => _carBrowserOptionLabel(l10n, value),
              onChanged: (value) => setState(
                () => _filters = _filters.copyWith(drivetrain: value),
              ),
            ),
            const SizedBox(height: 12),
            _dropdown<String>(
              label: l10n.dealer,
              value: _filters.businessName,
              values: widget.businesses,
              onChanged: (value) => setState(
                () => _filters = _filters.copyWith(businessName: value),
              ),
            ),
            const SizedBox(height: 12),
            _dropdown<String>(
              label: l10n.location,
              value: _filters.location,
              values: widget.locations,
              onChanged: (value) =>
                  setState(() => _filters = _filters.copyWith(location: value)),
            ),
            const SizedBox(height: 12),
            _dropdown<String>(
              label: l10n.features,
              value: _filters.feature,
              values: widget.features,
              display: (value) => _carBrowserOptionLabel(l10n, value),
              onChanged: (value) =>
                  setState(() => _filters = _filters.copyWith(feature: value)),
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
      case _CarSort.newest:
        return l10n.newestListings;
      case _CarSort.yearNew:
        return l10n.newestYear;
      case _CarSort.yearOld:
        return l10n.oldestYear;
      case _CarSort.priceLow:
        return l10n.priceLowToHigh;
      case _CarSort.priceHigh:
        return l10n.priceHighToLow;
      case _CarSort.mileageLow:
        return l10n.mileageLowToHigh;
      case _CarSort.mileageHigh:
        return l10n.mileageHighToLow;
    }
  }
}

class _BrowseHeader extends StatelessWidget {
  const _BrowseHeader({
    required this.l10n,
    required this.totalCars,
    required this.visibleCars,
  });

  final AppLocalizations l10n;
  final int totalCars;
  final int visibleCars;

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
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.18),
                    ),
                  ),
                  child: const Icon(Icons.directions_car, color: Colors.white),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.availableCars,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 28,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 0,
                          height: 1.05,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        l10n.browsePurchaseReserve,
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.78),
                          fontSize: 14,
                          height: 1.35,
                        ),
                      ),
                    ],
                  ),
                ),
                const LanguageToggle(),
              ],
            ),
            const SizedBox(height: 18),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _HeaderMetric(
                  icon: Icons.garage,
                  label: l10n.availableCars,
                  value: '$visibleCars',
                ),
                _HeaderMetric(
                  icon: Icons.inventory_2_outlined,
                  label: l10n.cars,
                  value: '$totalCars',
                ),
                _HeaderMetric(
                  icon: Icons.verified_user_outlined,
                  label: l10n.reserveViewing,
                  value: '24/7',
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _HeaderMetric extends StatelessWidget {
  const _HeaderMetric({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withValues(alpha: 0.16)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: AppColors.mist),
          const SizedBox(width: 6),
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w900,
              fontSize: 13,
            ),
          ),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.72),
              fontWeight: FontWeight.w600,
              fontSize: 11,
            ),
          ),
        ],
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
        borderRadius: BorderRadius.circular(8),
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
        textInputAction: TextInputAction.search,
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
  const _EmptyState({required this.l10n, required this.filtered});

  final AppLocalizations l10n;
  final bool filtered;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.lightOutline),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.directions_car, size: 72, color: Colors.grey.shade400),
          const SizedBox(height: 20),
          Text(
            filtered ? l10n.noFilterResults : l10n.noCarsAvailable,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: Colors.grey.shade700,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            filtered ? l10n.clearFiltersToSeeCars : l10n.checkBackSoon,
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
    this.activeViewing,
  });

  final Car car;
  final String priceText;
  final AppLocalizations l10n;
  final VoidCallback onTap;
  final CarPurchase? activeViewing;

  @override
  Widget build(BuildContext context) {
    final imageUrl = car.imageUrls.isNotEmpty ? car.imageUrls.first : null;
    final location = car.locationLabel;
    final featurePreview = car.allFeatures.take(3).toList();
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppColors.lightOutline),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.04),
                blurRadius: 16,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Stack(
                children: [
                  imageUrl != null
                      ? Image.network(
                          imageUrl,
                          width: double.infinity,
                          height: 176,
                          fit: BoxFit.cover,
                          errorBuilder: (context, error, stackTrace) {
                            return const _ImagePlaceholder(
                              width: double.infinity,
                              height: 176,
                            );
                          },
                        )
                      : const _ImagePlaceholder(
                          width: double.infinity,
                          height: 176,
                        ),
                  Positioned(
                    left: 12,
                    top: 12,
                    child: _StatusPill(label: car.status.toUpperCase()),
                  ),
                  Positioned(
                    right: 12,
                    bottom: 12,
                    child: _PriceBadge(priceText: priceText),
                  ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            car.title,
                            style: const TextStyle(
                              fontWeight: FontWeight.w900,
                              fontSize: 19,
                              height: 1.15,
                            ),
                            overflow: TextOverflow.ellipsis,
                            maxLines: 2,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Container(
                          width: 34,
                          height: 34,
                          decoration: BoxDecoration(
                            color: AppColors.mist,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Icon(
                            Icons.arrow_forward,
                            size: 18,
                            color: AppColors.cobaltDeep,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        const Icon(
                          Icons.storefront_outlined,
                          size: 16,
                          color: AppColors.cobaltDeep,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            car.businessName,
                            style: const TextStyle(
                              color: AppColors.cobaltDeep,
                              fontSize: 13,
                              fontWeight: FontWeight.w800,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        const Icon(
                          Icons.directions_car_filled_outlined,
                          size: 16,
                          color: AppColors.lightMuted,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            '${car.make} ${car.model} - ${car.year}',
                            style: const TextStyle(
                              color: AppColors.lightMuted,
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                            ),
                            overflow: TextOverflow.ellipsis,
                            maxLines: 1,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        _SpecChip(icon: Icons.speed, label: car.mileage),
                        _SpecChip(icon: Icons.event, label: car.year),
                        if (car.condition.isNotEmpty)
                          _SpecChip(
                            icon: Icons.verified_outlined,
                            label: _carBrowserOptionLabel(l10n, car.condition),
                          ),
                        if (car.transmission.isNotEmpty)
                          _SpecChip(
                            icon: Icons.settings_suggest_outlined,
                            label: _carBrowserOptionLabel(
                              l10n,
                              car.transmission,
                            ),
                          ),
                        if (car.fuelType.isNotEmpty)
                          _SpecChip(
                            icon: Icons.local_gas_station_outlined,
                            label: _carBrowserOptionLabel(l10n, car.fuelType),
                          ),
                        if (location.isNotEmpty)
                          _SpecChip(
                            icon: Icons.location_on_outlined,
                            label: location,
                          ),
                        if (car.isNegotiable)
                          _SpecChip(
                            icon: Icons.handshake_outlined,
                            label: l10n.priceNegotiable,
                            emphasized: true,
                          ),
                        _SpecChip(
                          icon: Icons.verified_outlined,
                          label: l10n.reserveViewing,
                          emphasized: true,
                        ),
                      ],
                    ),
                    if (featurePreview.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Text(
                        featurePreview
                            .map((item) => _carBrowserOptionLabel(l10n, item))
                            .join('  /  '),
                        style: const TextStyle(
                          color: AppColors.lightMuted,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          height: 1.4,
                        ),
                        overflow: TextOverflow.ellipsis,
                        maxLines: 2,
                      ),
                    ],
                    if (activeViewing != null) ...[
                      const SizedBox(height: 12),
                      _ActiveViewingBanner(
                        l10n: l10n,
                        reservation: activeViewing!,
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActiveViewingBanner extends StatelessWidget {
  const _ActiveViewingBanner({required this.l10n, required this.reservation});

  final AppLocalizations l10n;
  final CarPurchase reservation;

  @override
  Widget build(BuildContext context) {
    final appointment = reservation.appointmentStart;
    final label =
        reservation.appointmentLabel ??
        (appointment == null
            ? l10n.viewingScheduled
            : DateFormat.yMMMd().add_jm().format(appointment));
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.brandRed.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.brandRed.withValues(alpha: 0.18)),
      ),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(
              Icons.event_available_outlined,
              color: AppColors.brandRed,
              size: 19,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.youHaveViewingReserved,
                  style: const TextStyle(
                    color: AppColors.brandRed,
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  label,
                  style: const TextStyle(
                    color: AppColors.lightOnSurface,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SpecChip extends StatelessWidget {
  const _SpecChip({
    required this.icon,
    required this.label,
    this.emphasized = false,
  });

  final IconData icon;
  final String label;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: emphasized ? AppColors.mist : AppColors.lightSurfaceVariant,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 13,
            color: emphasized ? AppColors.cobaltDeep : AppColors.brandRed,
          ),
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
  const _ImagePlaceholder({this.width = 108, this.height = 112});

  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(color: AppColors.lightSurfaceVariant),
      child: const Icon(
        Icons.directions_car,
        size: 42,
        color: AppColors.lightMuted,
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.cobaltDeep.withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 10,
          fontWeight: FontWeight.w900,
          letterSpacing: 0,
        ),
      ),
    );
  }
}

class _PriceBadge extends StatelessWidget {
  const _PriceBadge({required this.priceText});

  final String priceText;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.16),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Text(
        priceText,
        style: const TextStyle(
          fontWeight: FontWeight.w900,
          fontSize: 17,
          color: AppColors.cobaltDeep,
        ),
        overflow: TextOverflow.ellipsis,
        maxLines: 1,
      ),
    );
  }
}
