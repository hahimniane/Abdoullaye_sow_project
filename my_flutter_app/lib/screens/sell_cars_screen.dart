import 'package:flutter/material.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';
import 'car_details_screen.dart';

class SellCarsScreen extends StatefulWidget {
  const SellCarsScreen({super.key});

  @override
  State<SellCarsScreen> createState() => _SellCarsScreenState();
}

class _SellCarsScreenState extends State<SellCarsScreen> {
  final TextEditingController _searchController = TextEditingController();
  List<CarData> _allCars = [];
  List<CarData> _filteredCars = [];
  bool _isInitialized = false;

  @override
  void initState() {
    super.initState();
    _searchController.addListener(_filterCars);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_isInitialized) {
      _initializeCars();
      _isInitialized = true;
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _initializeCars() {
    _allCars = [
      CarData(
        imageUrl:
            'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=400',
        title: AppLocalizations.of(context)!.toyotaCamry,
        year: '2020',
        mileage: '30,000 miles',
        price: '\$25,500',
        description:
            'Well-maintained Toyota Camry with excellent fuel efficiency and comfortable interior. Perfect for daily commuting and long trips.',
        features: [
          'Automatic transmission',
          'Bluetooth connectivity',
          'Backup camera',
          'Lane departure warning',
          'Apple CarPlay',
          'Heated seats',
        ],
        sellerPhone: '+1234567890',
      ),
      CarData(
        imageUrl:
            'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=400',
        title: AppLocalizations.of(context)!.hondaAccord,
        year: '2019',
        mileage: '45,000 miles',
        price: '\$22,200',
        description:
            'Reliable Honda Accord with great performance and safety features. Low maintenance costs and excellent resale value.',
        features: [
          'CVT transmission',
          'Honda Sensing suite',
          'Android Auto',
          'Blind spot monitoring',
          'Adaptive cruise control',
          'LED headlights',
        ],
        sellerPhone: '+1234567891',
      ),
      CarData(
        imageUrl:
            'https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=400',
        title: AppLocalizations.of(context)!.fordEscape,
        year: '2021',
        mileage: '26,000 miles',
        price: '\$28,800',
        description:
            'Modern Ford Escape with advanced technology and spacious interior. Great for families and outdoor activities.',
        features: [
          'EcoBoost engine',
          'SYNC 3 infotainment',
          'All-wheel drive',
          'Panoramic sunroof',
          'Wireless charging',
          'Ford Co-Pilot360',
        ],
        sellerPhone: '+1234567892',
      ),
    ];
    _filteredCars = List.from(_allCars);
  }

  void _filterCars() {
    final query = _searchController.text.toLowerCase();
    setState(() {
      if (query.isEmpty) {
        _filteredCars = List.from(_allCars);
      } else {
        _filteredCars =
            _allCars.where((car) {
              return car.title.toLowerCase().contains(query) ||
                  car.year.contains(query) ||
                  car.price.toLowerCase().contains(query) ||
                  car.mileage.toLowerCase().contains(query);
            }).toList();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
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
          child: Column(
            children: [
              // Header with back button and language toggle
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: Row(
                  children: [
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      style: IconButton.styleFrom(
                        splashFactory: NoSplash.splashFactory,
                      ),
                      icon: const Icon(
                        Icons.arrow_back_ios,
                        color: Colors.white,
                        size: 24,
                      ),
                    ),
                    Expanded(
                      child: Text(
                        AppLocalizations.of(context)!.sellCars,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                        textAlign: TextAlign.center,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const LanguageToggle(),
                  ],
                ),
              ),
              // Main content
              Expanded(
                child: Padding(
                  padding: EdgeInsets.all(
                    MediaQuery.of(context).size.width * 0.06,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Header Section
                      Container(
                        width: double.infinity,
                        padding: EdgeInsets.all(
                          MediaQuery.of(context).size.width * 0.06,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: Colors.white.withOpacity(0.3),
                            width: 1,
                          ),
                        ),
                        child: Column(
                          children: [
                            Container(
                              width: 80,
                              height: 80,
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.2),
                                borderRadius: BorderRadius.circular(40),
                              ),
                              child: const Icon(
                                Icons.sell,
                                size: 40,
                                color: Colors.white,
                              ),
                            ),
                            const SizedBox(height: 16),
                            Text(
                              AppLocalizations.of(context)!.carSalesService,
                              style: const TextStyle(
                                fontSize: 24,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                              textAlign: TextAlign.center,
                              overflow: TextOverflow.ellipsis,
                              maxLines: 2,
                            ),
                            const SizedBox(height: 8),
                            Text(
                              AppLocalizations.of(context)!.browseAvailableCarsForSale,
                              style: const TextStyle(
                                fontSize: 16,
                                color: Colors.white70,
                              ),
                              textAlign: TextAlign.center,
                              overflow: TextOverflow.ellipsis,
                              maxLines: 3,
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(height: 24),

                      // Search Section
                      Container(
                        padding: EdgeInsets.all(
                          MediaQuery.of(context).size.width * 0.04,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.1),
                              blurRadius: 10,
                              offset: const Offset(0, 5),
                            ),
                          ],
                        ),
                        child: TextField(
                          controller: _searchController,
                          decoration: InputDecoration(
                            hintText: AppLocalizations.of(context)!.searchCars,
                            prefixIcon: const Icon(Icons.search),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide(
                                color: Colors.grey.shade300,
                              ),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: const BorderSide(
                                color: Color(0xFF667eea),
                                width: 2,
                              ),
                            ),
                            filled: true,
                            fillColor: Colors.grey.shade50,
                          ),
                        ),
                      ),

                      const SizedBox(height: 24),

                      // Cars List
                      Expanded(
                        child: Container(
                          padding: EdgeInsets.all(
                            MediaQuery.of(context).size.width * 0.04,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(20),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.1),
                                blurRadius: 20,
                                offset: const Offset(0, 10),
                              ),
                            ],
                          ),
                          child:
                              _filteredCars.isEmpty
                                  ? Center(
                                    child: Column(
                                      mainAxisAlignment:
                                          MainAxisAlignment.center,
                                      children: [
                                        Icon(
                                          Icons.search_off,
                                          size: 64,
                                          color: Colors.grey.shade400,
                                        ),
                                        const SizedBox(height: 16),
                                        Text(
                                          AppLocalizations.of(context)!.noResultsFound,
                                          style: TextStyle(
                                            fontSize: 18,
                                            fontWeight: FontWeight.w500,
                                            color: Colors.grey.shade600,
                                          ),
                                          textAlign: TextAlign.center,
                                        ),
                                        const SizedBox(height: 8),
                                        Text(
                                          AppLocalizations.of(context)!.tryDifferentSearch,
                                          style: TextStyle(
                                            fontSize: 14,
                                            color: Colors.grey.shade500,
                                          ),
                                          textAlign: TextAlign.center,
                                        ),
                                      ],
                                    ),
                                  )
                                  : ListView.builder(
                                    itemCount: _filteredCars.length,
                                    itemBuilder: (context, index) {
                                      final car = _filteredCars[index];
                                      return _CarCard(
                                        car: car,
                                        onTap: () {
                                          Navigator.push(
                                            context,
                                            MaterialPageRoute(
                                              builder:
                                                  (context) => CarDetailsScreen(
                                                    imageUrl: car.imageUrl,
                                                    title: car.title,
                                                    year: car.year,
                                                    mileage: car.mileage,
                                                    price: car.price,
                                                    description:
                                                        car.description,
                                                    features: car.features,
                                                    sellerPhone:
                                                        car.sellerPhone,
                                                  ),
                                            ),
                                          );
                                        },
                                      );
                                    },
                                  ),
                        ),
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

class CarData {
  final String imageUrl;
  final String title;
  final String year;
  final String mileage;
  final String price;
  final String description;
  final List<String> features;
  final String sellerPhone;

  CarData({
    required this.imageUrl,
    required this.title,
    required this.year,
    required this.mileage,
    required this.price,
    required this.description,
    required this.features,
    required this.sellerPhone,
  });
}

class _CarCard extends StatelessWidget {
  final CarData car;
  final VoidCallback onTap;

  const _CarCard({required this.car, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 8),
        padding: EdgeInsets.all(MediaQuery.of(context).size.width * 0.04),
        decoration: BoxDecoration(
          color: Colors.grey.shade50,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.grey.shade200),
        ),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.network(
                car.imageUrl,
                width: 80,
                height: 80,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) {
                  return Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      color: Colors.grey.shade300,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(
                      Icons.directions_car,
                      size: 40,
                      color: Colors.grey,
                    ),
                  );
                },
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
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
                    maxLines: 1,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${AppLocalizations.of(context)!.year}: ${car.year}',
                    style: TextStyle(color: Colors.grey.shade600, fontSize: 14),
                    overflow: TextOverflow.ellipsis,
                    maxLines: 1,
                  ),
                  Text(
                    '${AppLocalizations.of(context)!.mileage}: ${car.mileage}',
                    style: TextStyle(color: Colors.grey.shade600, fontSize: 14),
                    overflow: TextOverflow.ellipsis,
                    maxLines: 1,
                  ),
                ],
              ),
            ),
            Text(
              car.price,
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 18,
                color: Color(0xFF667eea),
              ),
              overflow: TextOverflow.ellipsis,
              maxLines: 1,
            ),
          ],
        ),
      ),
    );
  }
}
