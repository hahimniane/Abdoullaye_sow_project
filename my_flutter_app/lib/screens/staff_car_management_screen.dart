import 'package:flutter/material.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';

class StaffCarManagementScreen extends StatefulWidget {
  const StaffCarManagementScreen({super.key});

  @override
  State<StaffCarManagementScreen> createState() =>
      _StaffCarManagementScreenState();
}

class _StaffCarManagementScreenState extends State<StaffCarManagementScreen> {
  final List<Map<String, dynamic>> _cars = [
    {
      'id': '1',
      'title': 'Toyota Camry',
      'year': '2020',
      'mileage': '30,000 miles',
      'price': '\$25,500',
      'status': 'active',
    },
    {
      'id': '2',
      'title': 'Honda Accord',
      'year': '2019',
      'mileage': '45,000 miles',
      'price': '\$22,200',
      'status': 'active',
    },
    {
      'id': '3',
      'title': 'Ford Escape',
      'year': '2021',
      'mileage': '26,000 miles',
      'price': '\$28,800',
      'status': 'inactive',
    },
  ];

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
              // Header
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        AppLocalizations.of(context)!.manageCars,
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const LanguageToggle(),
                  ],
                ),
              ),

              // Content
              Expanded(
                child: Container(
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.only(
                      topLeft: Radius.circular(30),
                      topRight: Radius.circular(30),
                    ),
                  ),
                  child: Column(
                    children: [
                      // Stats Section
                      Container(
                        margin: const EdgeInsets.all(20),
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Color(0xFF667eea), Color(0xFF764ba2)],
                          ),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceAround,
                          children: [
                            _buildStatItem(
                              icon: Icons.directions_car,
                              value: _cars.length.toString(),
                              label: AppLocalizations.of(context)!.totalCars,
                            ),
                            _buildStatItem(
                              icon: Icons.check_circle,
                              value:
                                  _cars
                                      .where((car) => car['status'] == 'active')
                                      .length
                                      .toString(),
                              label: AppLocalizations.of(context)!.activeCars,
                            ),
                            _buildStatItem(
                              icon: Icons.pause_circle,
                              value:
                                  _cars
                                      .where(
                                        (car) => car['status'] == 'inactive',
                                      )
                                      .length
                                      .toString(),
                              label: AppLocalizations.of(context)!.inactiveCars,
                            ),
                          ],
                        ),
                      ),

                      // Cars List
                      Expanded(
                        child: ListView.builder(
                          padding: const EdgeInsets.symmetric(horizontal: 20),
                          itemCount: _cars.length,
                          itemBuilder: (context, index) {
                            final car = _cars[index];
                            return _buildCarCard(car);
                          },
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
      floatingActionButton: FloatingActionButton(
        onPressed: () {
          _showAddCarDialog(context);
        },
        backgroundColor: const Color(0xFF667eea),
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }

  Widget _buildStatItem({
    required IconData icon,
    required String value,
    required String label,
  }) {
    return Column(
      children: [
        Icon(icon, color: Colors.white, size: 32),
        const SizedBox(height: 8),
        Text(
          value,
          style: const TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
        ),
        Text(
          label,
          style: const TextStyle(fontSize: 12, color: Colors.white70),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _buildCarCard(Map<String, dynamic> car) {
    final isActive = car['status'] == 'active';
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.grey.shade50,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey.shade200),
      ),
      child: Row(
        children: [
          // Car icon
          Container(
            width: 60,
            height: 60,
            decoration: BoxDecoration(
              color: const Color(0xFF667eea).withOpacity(0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(
              Icons.directions_car,
              color: Color(0xFF667eea),
              size: 30,
            ),
          ),
          const SizedBox(width: 16),

          // Car details
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  car['title'],
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${AppLocalizations.of(context)!.year}: ${car['year']}',
                  style: TextStyle(fontSize: 14, color: Colors.grey.shade600),
                ),
                Text(
                  '${AppLocalizations.of(context)!.mileage}: ${car['mileage']}',
                  style: TextStyle(fontSize: 14, color: Colors.grey.shade600),
                ),
                Text(
                  '${AppLocalizations.of(context)!.price}: ${car['price']}',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: Color(0xFF667eea),
                  ),
                ),
              ],
            ),
          ),

          // Status and actions
          Column(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: isActive ? Colors.green : Colors.orange,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  isActive ? AppLocalizations.of(context)!.active : AppLocalizations.of(context)!.inactive,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    onPressed: () => _editCar(car),
                    icon: const Icon(Icons.edit, color: Color(0xFF667eea)),
                    iconSize: 20,
                  ),
                  IconButton(
                    onPressed: () => _toggleCarStatus(car),
                    icon: Icon(
                      isActive ? Icons.pause : Icons.play_arrow,
                      color: isActive ? Colors.orange : Colors.green,
                    ),
                    iconSize: 20,
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _showAddCarDialog(BuildContext context) {
    showDialog(
      context: context,
      builder:
          (context) => AlertDialog(
            title: Text(AppLocalizations.of(context)!.addNewCar),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  decoration: InputDecoration(
                    labelText: AppLocalizations.of(context)!.carTitle,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  decoration: InputDecoration(
                    labelText: AppLocalizations.of(context)!.year,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  decoration: InputDecoration(
                    labelText: AppLocalizations.of(context)!.mileage,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  decoration: InputDecoration(
                    labelText: AppLocalizations.of(context)!.price,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text(AppLocalizations.of(context)!.cancel),
              ),
              ElevatedButton(
                onPressed: () {
                  // Add car logic here
                  Navigator.pop(context);
                },
                child: Text(AppLocalizations.of(context)!.add),
              ),
            ],
          ),
    );
  }

  void _editCar(Map<String, dynamic> car) {
    // Edit car logic
  }

  void _toggleCarStatus(Map<String, dynamic> car) {
    setState(() {
      car['status'] = car['status'] == 'active' ? 'inactive' : 'active';
    });
  }
}
