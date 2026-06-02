import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart' as firebase_storage;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../data/car_catalog.dart';
import '../data/us_locations.dart';
import '../l10n/app_localizations.dart';
import '../models/business_profile.dart';
import '../models/business_service.dart';
import '../models/car.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../utils/phone_number_validator.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/language_toggle.dart';

class StaffCarManagementScreen extends StatefulWidget {
  const StaffCarManagementScreen({super.key});

  @override
  State<StaffCarManagementScreen> createState() =>
      _StaffCarManagementScreenState();
}

class _StaffCarManagementScreenState extends State<StaffCarManagementScreen> {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final Set<String> _processingCars = <String>{};
  final NumberFormat _currency = NumberFormat.simpleCurrency();
  bool _isSavingCar = false;

  void _setProcessing(String id, bool value) {
    setState(() {
      if (value) {
        _processingCars.add(id);
      } else {
        _processingCars.remove(id);
      }
    });
  }

  Future<void> _toggleCarStatus(Car car) async {
    if (car.isSold || car.isReserved) {
      return;
    }
    final newStatus = car.status == 'active' ? 'inactive' : 'active';
    _setProcessing(car.id, true);
    try {
      await _firestore.collection('cars').doc(car.id).update({
        'status': newStatus,
        'updatedAt': FieldValue.serverTimestamp(),
      });
      if (!mounted) return;
      final l10n = AppLocalizations.of(context)!;
      showSuccessSnackBar(
        context,
        newStatus == 'active' ? l10n.activateSuccess : l10n.deactivateSuccess,
      );
    } catch (e) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context)!;
      showErrorSnackBar(context, l10n.operationFailed('$e'));
    } finally {
      _setProcessing(car.id, false);
    }
  }

  Future<void> _createCar(_CarFormResult result) async {
    final auth = context.read<AuthProvider>();
    final businessId = auth.isAdmin
        ? BusinessProfile.defaultBusinessId
        : auth.businessId ?? BusinessProfile.defaultBusinessId;
    final businessName = auth.isAdmin
        ? BusinessProfile.defaultBusinessName
        : auth.businessName ?? BusinessProfile.defaultBusinessName;
    final businessDoc = await _firestore
        .collection('businesses')
        .doc(businessId)
        .get();
    if (!mounted) return;
    final businessData = businessDoc.data() ?? <String, dynamic>{};
    final docRef = _firestore.collection('cars').doc();
    final imageUrls = await _uploadImages(
      carId: docRef.id,
      images: result.images,
    );
    await docRef.set({
      'id': docRef.id,
      'businessId': businessId,
      'businessName': businessName,
      'businessStatus': businessData['status'] ?? 'pending',
      'businessProfileImageUrl': businessData['profileImageUrl'] ?? '',
      'enabledServices':
          businessData['enabledServices'] ?? defaultBusinessServiceValues,
      ...result.toFirestoreMap(),
      'status': result.status,
      'imageUrls': imageUrls,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> _updateCar(Car car, _CarFormResult result) async {
    final data = result.toFirestoreMap();
    final statusToPersist = car.isSold || car.isReserved
        ? car.status
        : result.status;
    final imageUrls = await _uploadImages(
      carId: car.id,
      images: result.images,
      previousUrls: car.imageUrls,
    );
    if (result.contactName == null || result.contactName!.isEmpty) {
      data['contactName'] = FieldValue.delete();
    }
    if (result.contactEmail == null || result.contactEmail!.isEmpty) {
      data['contactEmail'] = FieldValue.delete();
    }
    await _firestore.collection('cars').doc(car.id).update({
      ...data,
      'imageUrls': imageUrls,
      'status': statusToPersist,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<List<String>> _uploadImages({
    required String carId,
    required List<_EditableCarImage> images,
    List<String>? previousUrls,
  }) async {
    final storage = firebase_storage.FirebaseStorage.instance;
    final List<String> urls = [];

    for (var index = 0; index < images.length; index++) {
      final image = images[index];
      if (image.url != null) {
        urls.add(image.url!);
        continue;
      }
      if (image.bytes == null) {
        continue;
      }
      final ext = (image.file?.name.split('.').last ?? 'jpg').toLowerCase();
      final filename =
          'car_${carId}_${DateTime.now().millisecondsSinceEpoch}_$index.$ext';
      final ref = storage.ref().child('cars').child(carId).child(filename);
      final contentType = ext == 'png'
          ? 'image/png'
          : ext == 'webp'
          ? 'image/webp'
          : 'image/jpeg';
      final metadata = firebase_storage.SettableMetadata(
        contentType: contentType,
      );
      await ref.putData(image.bytes!, metadata);
      final url = await ref.getDownloadURL();
      urls.add(url);
    }

    if (previousUrls != null) {
      for (final oldUrl in previousUrls) {
        if (!urls.contains(oldUrl)) {
          try {
            await storage.refFromURL(oldUrl).delete();
          } catch (_) {
            // Ignore deletion errors; file may already be removed.
          }
        }
      }
    }

    return urls;
  }

  Future<void> _showCarForm({Car? car}) async {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.read<AuthProvider>();
    final businessId = auth.isAdmin
        ? BusinessProfile.defaultBusinessId
        : auth.businessId ?? BusinessProfile.defaultBusinessId;
    final businessDoc = await _firestore
        .collection('businesses')
        .doc(businessId)
        .get();
    if (!mounted) return;
    final businessData = businessDoc.data() ?? <String, dynamic>{};
    final result = await showModalBottomSheet<_CarFormResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => _CarFormSheet(
        initialCar: car,
        defaultAddressLine1: (businessData['addressLine1'] ?? '') as String,
        defaultCity: (businessData['city'] ?? '') as String,
        defaultState: (businessData['state'] ?? '') as String,
        defaultPostalCode: (businessData['postalCode'] ?? '') as String,
      ),
    );

    if (result == null) return;

    setState(() {
      _isSavingCar = true;
      if (car != null) {
        _processingCars.add(car.id);
      }
    });
    try {
      if (car == null) {
        await _createCar(result);
        if (!mounted) return;
        showSuccessSnackBar(context, l10n.carCreated);
      } else {
        await _updateCar(car, result);
        if (!mounted) return;
        showSuccessSnackBar(context, l10n.carUpdated);
      }
    } catch (e) {
      if (!mounted) return;
      showErrorSnackBar(context, l10n.operationFailed('$e'));
    } finally {
      if (car != null) {
        _setProcessing(car.id, false);
      }
      if (mounted) {
        setState(() => _isSavingCar = false);
      }
    }
  }

  Future<void> _markCarAsSold(Car car) async {
    final l10n = AppLocalizations.of(context)!;
    final sale = await showModalBottomSheet<SoldCarResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => _MarkAsSoldSheet(car: car),
    );

    if (sale == null) return;

    _setProcessing(car.id, true);
    try {
      await _firestore.collection('cars').doc(car.id).update({
        'status': 'sold',
        'soldInfo': sale.toMap(),
        'updatedAt': FieldValue.serverTimestamp(),
      });
      if (!mounted) return;
      showSuccessSnackBar(context, l10n.saleRecorded);
    } catch (e) {
      if (!mounted) return;
      showErrorSnackBar(context, l10n.operationFailed('$e'));
    } finally {
      _setProcessing(car.id, false);
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'active':
        return Colors.green;
      case 'inactive':
        return Colors.orange;
      case 'sold':
        return Colors.purple;
      case 'reserved':
        return Colors.blue;
      default:
        return Colors.blueGrey;
    }
  }

  String _statusLabel(AppLocalizations l10n, String status) {
    switch (status) {
      case 'active':
        return l10n.active;
      case 'inactive':
        return l10n.inactive;
      case 'sold':
        return l10n.sold;
      case 'reserved':
        return l10n.reserved;
      default:
        return status;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.watch<AuthProvider>();
    final stream = auth.isAdmin
        ? _firestore
              .collection('cars')
              .orderBy('createdAt', descending: true)
              .snapshots()
        : _firestore
              .collection('cars')
              .where('businessId', isEqualTo: auth.businessId)
              .snapshots();
    return Scaffold(
      body: Stack(
        children: [
          Container(
            decoration: const BoxDecoration(gradient: AppColors.headerGradient),
            child: SafeArea(
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            l10n.manageCars,
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
                  Expanded(
                    child: Container(
                      decoration: const BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.only(
                          topLeft: Radius.circular(30),
                          topRight: Radius.circular(30),
                        ),
                      ),
                      child: StreamBuilder<QuerySnapshot>(
                        stream: stream,
                        builder: (context, snapshot) {
                          if (snapshot.hasError) {
                            return _CenteredMessage(
                              message: l10n.operationFailed(
                                snapshot.error.toString(),
                              ),
                            );
                          }
                          if (!snapshot.hasData) {
                            return const Center(
                              child: CircularProgressIndicator(),
                            );
                          }
                          final cars =
                              snapshot.data!.docs
                                  .map((doc) => Car.fromFirestore(doc))
                                  .toList()
                                ..sort((a, b) {
                                  final aDate = a.createdAt ?? DateTime(1970);
                                  final bDate = b.createdAt ?? DateTime(1970);
                                  return bDate.compareTo(aDate);
                                });
                          if (cars.isEmpty) {
                            return _EmptyCarsState(onAdd: () => _showCarForm());
                          }

                          final total = cars.length;
                          final active = cars
                              .where((car) => car.status == 'active')
                              .length;
                          final inactive = cars
                              .where((car) => car.status == 'inactive')
                              .length;
                          final sold = cars
                              .where((car) => car.status == 'sold')
                              .length;
                          final reserved = cars
                              .where((car) => car.status == 'reserved')
                              .length;

                          return Column(
                            children: [
                              _StatsBanner(
                                total: total,
                                active: active,
                                inactive: inactive,
                                sold: sold,
                                reserved: reserved,
                                l10n: l10n,
                              ),
                              Expanded(
                                child: ListView.builder(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 20,
                                  ),
                                  itemCount: cars.length,
                                  itemBuilder: (context, index) {
                                    final car = cars[index];
                                    final isProcessing = _processingCars
                                        .contains(car.id);
                                    return _CarCard(
                                      car: car,
                                      l10n: l10n,
                                      currency: _currency,
                                      statusColor: _statusColor(car.status),
                                      statusLabel: _statusLabel(
                                        l10n,
                                        car.status,
                                      ),
                                      isProcessing: isProcessing,
                                      onEdit: () => _showCarForm(car: car),
                                      onToggleStatus:
                                          car.isSold || car.isReserved
                                          ? null
                                          : () => _toggleCarStatus(car),
                                      onMarkSold: car.isSold
                                          ? null
                                          : () => _markCarAsSold(car),
                                    );
                                  },
                                ),
                              ),
                            ],
                          );
                        },
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (_isSavingCar)
            Positioned.fill(
              child: Container(
                color: Colors.black.withValues(alpha: 0.38),
                alignment: Alignment.center,
                child: Container(
                  width: 230,
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: AppColors.paper,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const CircularProgressIndicator(),
                      const SizedBox(height: 16),
                      Text(
                        l10n.uploadingCar,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: AppColors.ink,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
      floatingActionButton: StreamBuilder<QuerySnapshot>(
        stream: stream,
        builder: (context, snapshot) {
          if (!snapshot.hasData ||
              snapshot.hasError ||
              snapshot.data!.docs.isEmpty) {
            return const SizedBox.shrink();
          }
          return FloatingActionButton(
            onPressed: () => _showCarForm(),
            backgroundColor: AppColors.brandRed,
            child: const Icon(Icons.add, color: Colors.white),
          );
        },
      ),
    );
  }
}

class _StatsBanner extends StatelessWidget {
  const _StatsBanner({
    required this.total,
    required this.active,
    required this.inactive,
    required this.sold,
    required this.reserved,
    required this.l10n,
  });

  final int total;
  final int active;
  final int inactive;
  final int sold;
  final int reserved;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.all(20),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AppColors.brandRed, AppColors.brandRedDark],
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Wrap(
        alignment: WrapAlignment.spaceBetween,
        runSpacing: 16,
        children: [
          _StatItem(
            icon: Icons.directions_car,
            value: total.toString(),
            label: l10n.totalCars,
          ),
          _StatItem(
            icon: Icons.check_circle,
            value: active.toString(),
            label: l10n.activeCars,
          ),
          _StatItem(
            icon: Icons.pause_circle,
            value: inactive.toString(),
            label: l10n.inactiveCars,
          ),
          _StatItem(
            icon: Icons.sell,
            value: sold.toString(),
            label: l10n.soldCars,
          ),
          _StatItem(
            icon: Icons.lock_clock,
            value: reserved.toString(),
            label: l10n.reserved,
          ),
        ],
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  const _StatItem({
    required this.icon,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: MediaQuery.of(context).size.width / 2 - 40,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: Colors.white, size: 28),
          const SizedBox(height: 6),
          Text(
            value,
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
          ),
          Text(
            label,
            style: const TextStyle(fontSize: 12, color: Colors.white70),
          ),
        ],
      ),
    );
  }
}

class _CarCard extends StatelessWidget {
  const _CarCard({
    required this.car,
    required this.l10n,
    required this.currency,
    required this.statusColor,
    required this.statusLabel,
    required this.isProcessing,
    required this.onEdit,
    required this.onToggleStatus,
    required this.onMarkSold,
  });

  final Car car;
  final AppLocalizations l10n;
  final NumberFormat currency;
  final Color statusColor;
  final String statusLabel;
  final bool isProcessing;
  final VoidCallback onEdit;
  final VoidCallback? onToggleStatus;
  final VoidCallback? onMarkSold;

  @override
  Widget build(BuildContext context) {
    final imageUrl = car.imageUrls.isNotEmpty ? car.imageUrls.first : null;
    final hasSoldInfo = car.soldInfo?.hasData ?? false;
    final soldInfo = car.soldInfo;
    final soldDateString = soldInfo?.soldDate != null
        ? DateFormat.yMMMd().format(soldInfo!.soldDate!)
        : null;

    return Stack(
      children: [
        Container(
          margin: const EdgeInsets.only(bottom: 20),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: Colors.grey.shade200),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.05),
                blurRadius: 10,
                offset: const Offset(0, 5),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: imageUrl != null
                        ? Image.network(
                            imageUrl,
                            width: 90,
                            height: 90,
                            fit: BoxFit.cover,
                            errorBuilder: (context, error, stackTrace) {
                              return _ImagePlaceholder(size: 90);
                            },
                          )
                        : const _ImagePlaceholder(size: 90),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          car.title,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 6),
                        Text(
                          '${car.make} ${car.model} • ${car.year}',
                          style: TextStyle(
                            color: Colors.grey.shade600,
                            fontSize: 14,
                          ),
                        ),
                        Text(
                          l10n.mileageLabel(car.mileage),
                          style: TextStyle(
                            color: Colors.grey.shade600,
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: statusColor.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          statusLabel,
                          style: TextStyle(
                            color: statusColor,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        currency.format(car.price),
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: AppColors.brandRed,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                car.description,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: Colors.grey.shade700, height: 1.4),
              ),
              const SizedBox(height: 12),
              if (car.allFeatures.isNotEmpty)
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: car.allFeatures.take(6).map((feature) {
                    return Chip(
                      label: Text(_carOptionLabel(l10n, feature)),
                      visualDensity: VisualDensity.compact,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(20),
                      ),
                    );
                  }).toList(),
                ),
              if (hasSoldInfo) ...[
                const SizedBox(height: 16),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.purple.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: Colors.purple.withValues(alpha: 0.3),
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.soldInfo,
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: Colors.purple,
                        ),
                      ),
                      const SizedBox(height: 8),
                      if (soldInfo!.customerName.isNotEmpty)
                        Text(l10n.soldTo(soldInfo.customerName)),
                      if (soldDateString != null)
                        Text(l10n.soldOn(soldDateString)),
                      if (soldInfo.amount != null)
                        Text(
                          l10n.soldPriceLabel(currency.format(soldInfo.amount)),
                        ),
                      if (soldInfo.customerPhone.isNotEmpty)
                        Text(
                          '${l10n.customerPhone}: ${soldInfo.customerPhone}',
                        ),
                      if ((soldInfo.customerEmail ?? '').isNotEmpty)
                        Text(
                          '${l10n.customerEmail}: ${soldInfo.customerEmail}',
                        ),
                      if ((soldInfo.notes ?? '').isNotEmpty)
                        Text('${l10n.additionalNotes}: ${soldInfo.notes}'),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 16),
              Wrap(
                spacing: 12,
                runSpacing: 8,
                children: [
                  OutlinedButton.icon(
                    onPressed: isProcessing ? null : onEdit,
                    icon: const Icon(Icons.edit),
                    label: Text(l10n.editCar),
                  ),
                  OutlinedButton.icon(
                    onPressed: isProcessing || onMarkSold == null
                        ? null
                        : onMarkSold,
                    icon: const Icon(Icons.sell),
                    label: Text(l10n.markAsSold),
                  ),
                  OutlinedButton.icon(
                    onPressed: isProcessing || onToggleStatus == null
                        ? null
                        : onToggleStatus,
                    icon: Icon(
                      car.status == 'active'
                          ? Icons.pause_circle
                          : Icons.play_circle,
                    ),
                    label: Text(
                      car.status == 'active' ? l10n.deactivate : l10n.activate,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        if (isProcessing)
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Center(child: CircularProgressIndicator()),
            ),
          ),
      ],
    );
  }
}

class _CarOption {
  const _CarOption(this.value, this.icon);

  final String value;
  final IconData icon;
}

const _conditionOptions = [
  _CarOption('new', Icons.new_releases_outlined),
  _CarOption('used', Icons.verified_outlined),
  _CarOption('certified', Icons.workspace_premium_outlined),
  _CarOption('salvage', Icons.build_circle_outlined),
];

const _bodyTypeOptions = [
  _CarOption('sedan', Icons.directions_car_outlined),
  _CarOption('suv', Icons.airport_shuttle_outlined),
  _CarOption('truck', Icons.local_shipping_outlined),
  _CarOption('van', Icons.airport_shuttle),
  _CarOption('coupe', Icons.directions_car_filled_outlined),
  _CarOption('hatchback', Icons.car_rental),
  _CarOption('wagon', Icons.time_to_leave_outlined),
  _CarOption('convertible', Icons.car_crash_outlined),
];

const _transmissionOptions = [
  _CarOption('automatic', Icons.auto_mode),
  _CarOption('manual', Icons.settings_suggest_outlined),
  _CarOption('cvt', Icons.motion_photos_auto_outlined),
];

const _fuelOptions = [
  _CarOption('gas', Icons.local_gas_station_outlined),
  _CarOption('diesel', Icons.local_gas_station),
  _CarOption('hybrid', Icons.eco_outlined),
  _CarOption('electric', Icons.electric_car_outlined),
  _CarOption('plug_in_hybrid', Icons.ev_station_outlined),
];

const _drivetrainOptions = [
  _CarOption('fwd', Icons.arrow_upward),
  _CarOption('rwd', Icons.arrow_downward),
  _CarOption('awd', Icons.all_inclusive),
  _CarOption('4wd', Icons.explore_outlined),
];

const _featureOptions = [
  _CarOption('backup_camera', Icons.camera_rear_outlined),
  _CarOption('bluetooth', Icons.bluetooth),
  _CarOption('leather_seats', Icons.event_seat_outlined),
  _CarOption('sunroof', Icons.wb_sunny_outlined),
  _CarOption('navigation', Icons.navigation_outlined),
  _CarOption('heated_seats', Icons.whatshot_outlined),
  _CarOption('apple_carplay', Icons.phone_iphone),
  _CarOption('android_auto', Icons.android),
  _CarOption('blind_spot', Icons.visibility_outlined),
  _CarOption('third_row', Icons.airline_seat_recline_extra),
  _CarOption('remote_start', Icons.key_outlined),
  _CarOption('keyless_entry', Icons.lock_open_outlined),
];

const _carColorValues = [
  'black',
  'white',
  'silver',
  'gray',
  'red',
  'blue',
  'green',
  'yellow',
  'brown',
  'beige',
  'gold',
  'orange',
  'purple',
  'burgundy',
  'other',
];

String _carOptionLabel(AppLocalizations l10n, String value) {
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
    case 'black':
      return l10n.carColorBlack;
    case 'white':
      return l10n.carColorWhite;
    case 'silver':
      return l10n.carColorSilver;
    case 'gray':
      return l10n.carColorGray;
    case 'red':
      return l10n.carColorRed;
    case 'blue':
      return l10n.carColorBlue;
    case 'green':
      return l10n.carColorGreen;
    case 'yellow':
      return l10n.carColorYellow;
    case 'brown':
      return l10n.carColorBrown;
    case 'beige':
      return l10n.carColorBeige;
    case 'gold':
      return l10n.carColorGold;
    case 'orange':
      return l10n.carColorOrange;
    case 'purple':
      return l10n.carColorPurple;
    case 'burgundy':
      return l10n.carColorBurgundy;
    case 'other':
      return l10n.carColorOther;
    default:
      return value;
  }
}

class _CarFormSheet extends StatefulWidget {
  const _CarFormSheet({
    required this.initialCar,
    required this.defaultAddressLine1,
    required this.defaultCity,
    required this.defaultState,
    required this.defaultPostalCode,
  });

  final Car? initialCar;
  final String defaultAddressLine1;
  final String defaultCity;
  final String defaultState;
  final String defaultPostalCode;

  @override
  State<_CarFormSheet> createState() => _CarFormSheetState();
}

class _CarFormSheetState extends State<_CarFormSheet> {
  static const int _stepCount = 7;
  static const int _maxImages = 12;

  late final TextEditingController _titleController;
  late final TextEditingController _descriptionController;
  late final TextEditingController _mileageController;
  late final TextEditingController _priceController;
  late final TextEditingController _featuresController;
  late final TextEditingController _contactNameController;
  late final TextEditingController _contactPhoneController;
  late final TextEditingController _contactEmailController;
  late final TextEditingController _vinController;
  late final TextEditingController _stockNumberController;
  late final TextEditingController _holdFlatFeeController;
  late final TextEditingController _holdDailyRateController;
  late final TextEditingController _holdMaxDaysController;

  final ImagePicker _picker = ImagePicker();
  final List<_EditableCarImage> _images = [];
  final Set<String> _structuredFeatures = <String>{};

  String? _selectedMake;
  String? _selectedModel;
  String? _selectedYear;
  String? _condition;
  String? _bodyType;
  String? _transmission;
  String? _fuelType;
  String? _drivetrain;
  String? _exteriorColor;
  String? _interiorColor;
  String? _locationState;
  String? _locationCity;
  String _locationAddressLine1 = '';
  String _locationPostalCode = '';
  bool _useBusinessAddress = true;
  bool _useBusinessHoldPricing = true;
  String _holdPricingMode = 'flat';
  String _status = 'active';
  bool _isNegotiable = false;
  bool _isPickingImages = false;
  String? _stepError;
  String? _contactPhoneError;
  String? _businessDefaultAddressError;
  String? _locationAddressLine1Error;
  String? _locationStateError;
  String? _locationCityError;
  int _currentStep = 0;

  List<String> _makeOptions = <String>[];
  List<String> _modelOptions = <String>[];
  List<String> _yearOptions = <String>[];
  bool _catalogLoading = true;

  @override
  void initState() {
    super.initState();
    final car = widget.initialCar;
    _titleController = TextEditingController(text: car?.title);
    _descriptionController = TextEditingController(text: car?.description);
    _mileageController = TextEditingController(text: car?.mileage);
    _priceController = TextEditingController(
      text: car != null ? car.price.toStringAsFixed(0) : '',
    );
    _featuresController = TextEditingController(
      text: car?.features.join(', ') ?? '',
    );
    _contactNameController = TextEditingController(
      text: car?.contactName ?? '',
    );
    _contactPhoneController = TextEditingController(
      text: car?.contactPhone ?? '',
    );
    _contactEmailController = TextEditingController(
      text: car?.contactEmail ?? '',
    );
    _vinController = TextEditingController(text: car?.vin ?? '');
    _stockNumberController = TextEditingController(
      text: car?.stockNumber ?? '',
    );
    _holdFlatFeeController = TextEditingController(
      text: car?.carHoldFlatFee?.toStringAsFixed(0) ?? '',
    );
    _holdDailyRateController = TextEditingController(
      text: car?.carHoldDailyRate?.toStringAsFixed(0) ?? '',
    );
    _holdMaxDaysController = TextEditingController(
      text: car?.carHoldMaxDays?.toString() ?? '',
    );
    _selectedMake = car?.make.isNotEmpty == true ? car!.make : null;
    _selectedModel = car?.model.isNotEmpty == true ? car!.model : null;
    _selectedYear = car?.year.isNotEmpty == true ? car!.year : null;
    _condition = car?.condition.isNotEmpty == true ? car!.condition : null;
    _bodyType = car?.bodyType.isNotEmpty == true ? car!.bodyType : null;
    _transmission = car?.transmission.isNotEmpty == true
        ? car!.transmission
        : null;
    _fuelType = car?.fuelType.isNotEmpty == true ? car!.fuelType : null;
    _drivetrain = car?.drivetrain.isNotEmpty == true ? car!.drivetrain : null;
    _exteriorColor = car?.exteriorColor.isNotEmpty == true
        ? car!.exteriorColor
        : null;
    _interiorColor = car?.interiorColor.isNotEmpty == true
        ? car!.interiorColor
        : null;
    _locationState = car?.locationState.isNotEmpty == true
        ? car!.locationState
        : null;
    _locationCity = car?.locationCity.isNotEmpty == true
        ? car!.locationCity
        : null;
    _locationAddressLine1 = car?.locationAddressLine1.isNotEmpty == true
        ? car!.locationAddressLine1
        : widget.defaultAddressLine1;
    _locationPostalCode = car?.locationPostalCode.isNotEmpty == true
        ? car!.locationPostalCode
        : widget.defaultPostalCode;
    _useBusinessAddress =
        car == null &&
        [
          widget.defaultAddressLine1,
          widget.defaultCity,
          widget.defaultState,
          widget.defaultPostalCode,
        ].any((part) => part.trim().isNotEmpty);
    if (_useBusinessAddress) {
      _locationCity = widget.defaultCity.isNotEmpty ? widget.defaultCity : null;
      _locationState = widget.defaultState.isNotEmpty
          ? widget.defaultState
          : null;
    }
    _useBusinessHoldPricing = car?.useBusinessHoldPricing ?? true;
    _holdPricingMode = car?.carHoldPricingMode == 'per_day'
        ? 'per_day'
        : 'flat';
    _status = car?.status ?? 'active';
    _isNegotiable = car?.isNegotiable ?? false;
    _structuredFeatures.addAll(car?.structuredFeatures ?? const <String>[]);
    if (car != null) {
      _images.addAll(car.imageUrls.map(_EditableCarImage.remote));
    }
    _loadCatalog();
  }

  Future<void> _loadCatalog() async {
    final catalog = CarCatalog.instance;
    await catalog.load();
    final makes = catalog.getMakes();
    if (!mounted) return;
    setState(() {
      _makeOptions = List<String>.from(makes);
      if (_selectedMake != null && !_makeOptions.contains(_selectedMake)) {
        _makeOptions.insert(0, _selectedMake!);
      }
      _updateModelOptions();
      _catalogLoading = false;
    });
  }

  void _updateModelOptions() {
    if (_selectedMake == null) {
      _modelOptions = <String>[];
      _yearOptions = <String>[];
      return;
    }
    final catalog = CarCatalog.instance;
    _modelOptions = catalog.getModels(_selectedMake!);
    if (_selectedModel != null && !_modelOptions.contains(_selectedModel)) {
      _modelOptions.insert(0, _selectedModel!);
    }
    _updateYearOptions();
  }

  void _updateYearOptions() {
    if (_selectedMake == null || _selectedModel == null) {
      _yearOptions = <String>[];
      return;
    }
    final catalog = CarCatalog.instance;
    _yearOptions = catalog.getYears(_selectedMake!, _selectedModel!);
    if (_selectedYear != null && !_yearOptions.contains(_selectedYear)) {
      _yearOptions.insert(0, _selectedYear!);
    }
  }

  List<String> _splitText(String value) {
    return value
        .split(',')
        .map((item) => item.trim())
        .where((item) => item.isNotEmpty)
        .toList();
  }

  Future<void> _pickImages() async {
    if (_isPickingImages || _images.length >= _maxImages) return;
    setState(() => _isPickingImages = true);
    try {
      final files = await _picker.pickMultiImage();
      if (files.isEmpty) return;
      final slots = _maxImages - _images.length;
      final additions = <_EditableCarImage>[];
      for (final file in files.take(slots)) {
        final bytes = await file.readAsBytes();
        additions.add(_EditableCarImage.local(file, bytes));
      }
      if (!mounted) return;
      setState(() {
        _images.addAll(additions);
      });
    } catch (e) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context)!;
      showErrorSnackBar(context, l10n.operationFailed('$e'));
    } finally {
      if (mounted) setState(() => _isPickingImages = false);
    }
  }

  void _removeImage(int index) {
    setState(() => _images.removeAt(index));
  }

  void _markAsCover(int index) {
    if (index == 0) return;
    setState(() {
      final image = _images.removeAt(index);
      _images.insert(0, image);
    });
  }

  void _showError(String message) {
    setState(() => _stepError = message);
    showErrorSnackBar(context, message, feedback: false);
  }

  int? _mileageValue() {
    final text = _mileageController.text.trim().replaceAll(',', '');
    if (text.isEmpty) return null;
    return int.tryParse(text);
  }

  double? _priceValue() {
    return double.tryParse(_priceController.text.trim().replaceAll(',', ''));
  }

  double? _holdFlatFeeValue() {
    final text = _holdFlatFeeController.text.trim().replaceAll(',', '');
    if (text.isEmpty) return null;
    return double.tryParse(text);
  }

  double? _holdDailyRateValue() {
    final text = _holdDailyRateController.text.trim().replaceAll(',', '');
    if (text.isEmpty) return null;
    return double.tryParse(text);
  }

  int? _holdMaxDaysValue() {
    final text = _holdMaxDaysController.text.trim();
    if (text.isEmpty) return null;
    return int.tryParse(text);
  }

  String? _validationErrorForStep(int step, AppLocalizations l10n) {
    switch (step) {
      case 0:
        if (_titleController.text.trim().isEmpty ||
            _selectedMake == null ||
            _selectedModel == null ||
            _selectedYear == null ||
            _condition == null ||
            _bodyType == null) {
          return l10n.requiredField;
        }
        return null;
      case 1:
        final price = _priceValue();
        if (price == null) return l10n.pleaseEnterValidNumber;
        if (price <= 0) return l10n.positivePriceRequired;
        if (!_useBusinessHoldPricing) {
          final maxDays = _holdMaxDaysValue();
          if (maxDays == null || maxDays < 1 || maxDays > 30) {
            return 'Hold max days must be between 1 and 30.';
          }
          final fee = _holdPricingMode == 'flat'
              ? _holdFlatFeeValue()
              : _holdDailyRateValue();
          if (fee == null || fee <= 0) {
            return 'Enter a positive paid hold amount.';
          }
        }
        return null;
      case 2:
        final mileage = _mileageValue();
        if (mileage == null || mileage < 0) {
          return l10n.mileageWholeNumberRequired;
        }
        final vin = _vinController.text.trim().replaceAll(' ', '');
        if (vin.isNotEmpty && vin.length != 17) {
          return l10n.vinLengthRequired;
        }
        return null;
      case 4:
        if (_images.isEmpty) return l10n.addAtLeastOneImage;
        return null;
      case 5:
        final phoneError = PhoneNumberValidator.validate(
          _contactPhoneController.text,
          requiredMessage: l10n.requiredField,
        );
        if (phoneError != null) return phoneError;
        if (_useBusinessAddress) {
          if (_businessAddressLabel.isEmpty) {
            return l10n.businessAddressMissing;
          }
          return null;
        }
        if (_locationAddressLine1.trim().isEmpty ||
            _locationState == null ||
            _locationCity == null) {
          return l10n.requiredField;
        }
        return null;
      default:
        return null;
    }
  }

  void _clearLocationStepErrors() {
    _contactPhoneError = null;
    _businessDefaultAddressError = null;
    _locationAddressLine1Error = null;
    _locationStateError = null;
    _locationCityError = null;
  }

  void _applyLocationStepErrors(AppLocalizations l10n) {
    final phoneError = PhoneNumberValidator.validate(
      _contactPhoneController.text,
      requiredMessage: l10n.requiredField,
    );
    final businessDefaultError =
        _useBusinessAddress && _businessAddressLabel.isEmpty
        ? l10n.businessAddressMissing
        : null;
    final addressError =
        !_useBusinessAddress && _locationAddressLine1.trim().isEmpty
        ? l10n.requiredField
        : null;
    final stateError = !_useBusinessAddress && _locationState == null
        ? l10n.requiredField
        : null;
    final cityError = !_useBusinessAddress && _locationCity == null
        ? l10n.requiredField
        : null;

    setState(() {
      _stepError = null;
      _contactPhoneError = phoneError;
      _businessDefaultAddressError = businessDefaultError;
      _locationAddressLine1Error = addressError;
      _locationStateError = stateError;
      _locationCityError = cityError;
    });
  }

  bool _validateStep(int step) {
    final l10n = AppLocalizations.of(context)!;
    final error = _validationErrorForStep(step, l10n);
    if (error == null) {
      setState(() {
        _stepError = null;
        if (step == 5) _clearLocationStepErrors();
      });
      return true;
    }
    if (step == 5) {
      _applyLocationStepErrors(l10n);
      return false;
    }
    _showError(error);
    return false;
  }

  void _goNext() {
    if (!_validateStep(_currentStep)) return;
    if (_currentStep < _stepCount - 1) {
      setState(() => _currentStep++);
    } else {
      _submit();
    }
  }

  void _goBack() {
    if (_currentStep == 0) {
      Navigator.pop(context);
      return;
    }
    setState(() => _currentStep--);
  }

  void _submit() {
    final l10n = AppLocalizations.of(context)!;
    for (var step = 0; step < _stepCount - 1; step++) {
      final error = _validationErrorForStep(step, l10n);
      if (error != null) {
        setState(() => _currentStep = step);
        if (step == 5) {
          _applyLocationStepErrors(l10n);
          return;
        }
        _showError(error);
        return;
      }
    }
    final car = widget.initialCar;
    final result = _CarFormResult(
      title: _titleController.text.trim(),
      description: _descriptionController.text.trim(),
      make: _selectedMake!,
      model: _selectedModel!,
      year: _selectedYear!,
      mileage: _mileageValue().toString(),
      price: _priceValue()!,
      features: _splitText(_featuresController.text),
      structuredFeatures: _structuredFeatures.toList(),
      images: List<_EditableCarImage>.from(_images),
      contactName: _contactNameController.text.trim().isEmpty
          ? null
          : _contactNameController.text.trim(),
      contactPhone: _contactPhoneController.text.trim(),
      contactEmail: _contactEmailController.text.trim().isEmpty
          ? null
          : _contactEmailController.text.trim(),
      condition: _condition ?? '',
      bodyType: _bodyType ?? '',
      transmission: _transmission ?? '',
      fuelType: _fuelType ?? '',
      drivetrain: _drivetrain ?? '',
      exteriorColor: _exteriorColor ?? '',
      interiorColor: _interiorColor ?? '',
      vin: _vinController.text.trim().replaceAll(' ', '').toUpperCase(),
      stockNumber: _stockNumberController.text.trim(),
      isNegotiable: _isNegotiable,
      locationAddressLine1: _locationAddressLine1,
      locationCity: _locationCity ?? '',
      locationState: _locationState ?? '',
      locationPostalCode: _locationPostalCode,
      status: car?.isSold == true || car?.isReserved == true
          ? car!.status
          : _status,
      useBusinessHoldPricing: _useBusinessHoldPricing,
      carHoldPricingMode: _holdPricingMode,
      carHoldFlatFee: _holdFlatFeeValue(),
      carHoldDailyRate: _holdDailyRateValue(),
      carHoldMaxDays: _holdMaxDaysValue(),
    );
    Navigator.of(context).pop(result);
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _mileageController.dispose();
    _priceController.dispose();
    _featuresController.dispose();
    _contactNameController.dispose();
    _contactPhoneController.dispose();
    _contactEmailController.dispose();
    _vinController.dispose();
    _stockNumberController.dispose();
    _holdFlatFeeController.dispose();
    _holdDailyRateController.dispose();
    _holdMaxDaysController.dispose();
    super.dispose();
  }

  String _stepTitle(AppLocalizations l10n, int step) {
    switch (step) {
      case 0:
        return l10n.carInventoryBasics;
      case 1:
        return l10n.carInventoryPricing;
      case 2:
        return l10n.carInventoryDetails;
      case 3:
        return l10n.carInventoryFeatures;
      case 4:
        return l10n.carInventoryMedia;
      case 5:
        return l10n.carInventoryContact;
      default:
        return l10n.carInventoryReview;
    }
  }

  IconData _stepIcon(int step) {
    switch (step) {
      case 0:
        return Icons.directions_car_outlined;
      case 1:
        return Icons.payments_outlined;
      case 2:
        return Icons.tune_outlined;
      case 3:
        return Icons.checklist_outlined;
      case 4:
        return Icons.photo_library_outlined;
      case 5:
        return Icons.location_on_outlined;
      default:
        return Icons.fact_check_outlined;
    }
  }

  Widget _textField({
    required TextEditingController controller,
    required String label,
    IconData? icon,
    TextInputType? keyboardType,
    List<TextInputFormatter>? inputFormatters,
    int minLines = 1,
    int maxLines = 1,
    String? errorText,
    ValueChanged<String>? onChanged,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      inputFormatters: inputFormatters,
      minLines: minLines,
      maxLines: maxLines,
      onChanged: onChanged,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: icon == null ? null : Icon(icon),
        errorText: errorText,
      ),
    );
  }

  Widget _dropdown({
    required String label,
    required String? value,
    required List<String> values,
    required ValueChanged<String?>? onChanged,
    required AppLocalizations l10n,
    IconData? icon,
    bool localized = false,
    String Function(String value)? displayLabel,
    String? hintText,
    String? errorText,
  }) {
    return DropdownButtonFormField<String>(
      key: ValueKey<String>('$label-$value-${values.join('|')}'),
      initialValue: value != null && values.contains(value) ? value : null,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: icon == null ? null : Icon(icon),
        errorText: errorText,
      ),
      hint: hintText == null ? null : Text(hintText),
      items: values
          .map(
            (item) => DropdownMenuItem<String>(
              value: item,
              child: Text(
                displayLabel != null
                    ? displayLabel(item)
                    : localized
                    ? _carOptionLabel(l10n, item)
                    : item,
              ),
            ),
          )
          .toList(),
      onChanged: onChanged,
    );
  }

  List<String> _stateOptions() {
    return usStateOptions(_locationState);
  }

  List<String> _cityOptions() {
    return usCityOptions(_locationState, _locationCity);
  }

  String get _businessAddressLabel {
    return [
      widget.defaultAddressLine1,
      widget.defaultCity,
      widget.defaultState,
      widget.defaultPostalCode,
    ].where((part) => part.trim().isNotEmpty).join(', ');
  }

  Widget _optionGrid({
    required List<_CarOption> options,
    required String? selected,
    required ValueChanged<String> onSelected,
    required AppLocalizations l10n,
  }) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: options.map((option) {
        final isSelected = selected == option.value;
        return ChoiceChip(
          selected: isSelected,
          avatar: Icon(option.icon, size: 18),
          label: Text(_carOptionLabel(l10n, option.value)),
          onSelected: (_) => onSelected(option.value),
        );
      }).toList(),
    );
  }

  Widget _featureGrid(AppLocalizations l10n) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: _featureOptions.map((option) {
        final isSelected = _structuredFeatures.contains(option.value);
        return FilterChip(
          selected: isSelected,
          avatar: Icon(option.icon, size: 18),
          label: Text(_carOptionLabel(l10n, option.value)),
          onSelected: (selected) {
            setState(() {
              if (selected) {
                _structuredFeatures.add(option.value);
              } else {
                _structuredFeatures.remove(option.value);
              }
            });
          },
        );
      }).toList(),
    );
  }

  Widget _sectionCard({
    required String title,
    required IconData icon,
    required List<Widget> children,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: AppColors.cobaltDeep, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ...children,
        ],
      ),
    );
  }

  Widget _buildImageSection(AppLocalizations l10n) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '${l10n.imagesLabel} (${_images.length}/$_maxImages)',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            TextButton.icon(
              onPressed: _isPickingImages || _images.length >= _maxImages
                  ? null
                  : _pickImages,
              icon: _isPickingImages
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.photo_library_outlined),
              label: Text(l10n.addImages),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (_images.isEmpty)
          InkWell(
            onTap: _pickImages,
            borderRadius: BorderRadius.circular(8),
            child: Container(
              width: double.infinity,
              height: 170,
              decoration: BoxDecoration(
                color: AppColors.mist,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.rule),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(
                    Icons.add_photo_alternate_outlined,
                    size: 40,
                    color: AppColors.cobaltDeep,
                  ),
                  const SizedBox(height: 10),
                  Text(
                    l10n.addAtLeastOneImage,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: AppColors.cobaltDeep,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          )
        else
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: List.generate(
              _images.length,
              (index) => _ImagePreviewTile(
                image: _images[index],
                isCover: index == 0,
                l10n: l10n,
                onRemove: () => _removeImage(index),
                onSetCover: () => _markAsCover(index),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildStep(AppLocalizations l10n) {
    switch (_currentStep) {
      case 0:
        return _sectionCard(
          title: l10n.carInventoryBasics,
          icon: Icons.directions_car_outlined,
          children: [
            _textField(
              controller: _titleController,
              label: l10n.carTitle,
              icon: Icons.title,
            ),
            const SizedBox(height: 12),
            _textField(
              controller: _descriptionController,
              label: l10n.carDescription,
              icon: Icons.notes_outlined,
              minLines: 3,
              maxLines: 5,
            ),
            const SizedBox(height: 12),
            _dropdown(
              label: l10n.make,
              value: _selectedMake,
              values: _makeOptions,
              l10n: l10n,
              icon: Icons.apartment_outlined,
              onChanged: (value) {
                setState(() {
                  _selectedMake = value;
                  _selectedModel = null;
                  _selectedYear = null;
                  _updateModelOptions();
                });
              },
            ),
            const SizedBox(height: 12),
            _dropdown(
              label: l10n.model,
              value: _selectedModel,
              values: _modelOptions,
              l10n: l10n,
              icon: Icons.directions_car_filled_outlined,
              onChanged: (value) {
                setState(() {
                  _selectedModel = value;
                  _selectedYear = null;
                  _updateYearOptions();
                });
              },
            ),
            const SizedBox(height: 12),
            _dropdown(
              label: l10n.year,
              value: _selectedYear,
              values: _yearOptions,
              l10n: l10n,
              icon: Icons.event_outlined,
              onChanged: (value) => setState(() => _selectedYear = value),
            ),
            const SizedBox(height: 16),
            Text(l10n.condition, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            _optionGrid(
              options: _conditionOptions,
              selected: _condition,
              l10n: l10n,
              onSelected: (value) => setState(() => _condition = value),
            ),
            const SizedBox(height: 16),
            Text(l10n.bodyType, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            _optionGrid(
              options: _bodyTypeOptions,
              selected: _bodyType,
              l10n: l10n,
              onSelected: (value) => setState(() => _bodyType = value),
            ),
            const SizedBox(height: 12),
            if (widget.initialCar?.isSold != true &&
                widget.initialCar?.isReserved != true)
              _dropdown(
                label: l10n.statusLabel,
                value: _status,
                values: const ['active', 'inactive'],
                l10n: l10n,
                icon: Icons.visibility_outlined,
                onChanged: (value) {
                  if (value == null) return;
                  setState(() => _status = value);
                },
              )
            else
              Chip(label: Text(_status == 'sold' ? l10n.sold : l10n.reserved)),
          ],
        );
      case 1:
        return _sectionCard(
          title: l10n.carInventoryPricing,
          icon: Icons.payments_outlined,
          children: [
            _textField(
              controller: _priceController,
              label: l10n.sellingPrice,
              icon: Icons.attach_money,
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 12),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              value: _isNegotiable,
              onChanged: (value) => setState(() => _isNegotiable = value),
              title: Text(l10n.negotiable),
              secondary: const Icon(Icons.handshake_outlined),
            ),
            const SizedBox(height: 8),
            SwitchListTile.adaptive(
              contentPadding: EdgeInsets.zero,
              value: _useBusinessHoldPricing,
              onChanged: (value) =>
                  setState(() => _useBusinessHoldPricing = value),
              title: const Text('Use business paid hold pricing'),
              subtitle: const Text(
                'Turn off to override hold fee for this car.',
              ),
              secondary: const Icon(Icons.lock_clock_outlined),
            ),
            if (!_useBusinessHoldPricing) ...[
              const SizedBox(height: 8),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(
                    value: 'flat',
                    icon: Icon(Icons.payments_outlined),
                    label: Text('Flat fee'),
                  ),
                  ButtonSegment(
                    value: 'per_day',
                    icon: Icon(Icons.calendar_month_outlined),
                    label: Text('Per day'),
                  ),
                ],
                selected: {_holdPricingMode},
                onSelectionChanged: (values) =>
                    setState(() => _holdPricingMode = values.first),
              ),
              const SizedBox(height: 12),
              _textField(
                controller: _holdPricingMode == 'flat'
                    ? _holdFlatFeeController
                    : _holdDailyRateController,
                label: _holdPricingMode == 'flat'
                    ? 'Flat hold fee'
                    : 'Daily hold rate',
                icon: Icons.attach_money,
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: 12),
              _textField(
                controller: _holdMaxDaysController,
                label: 'Maximum hold days (1-30)',
                icon: Icons.event_busy_outlined,
                keyboardType: TextInputType.number,
              ),
            ],
          ],
        );
      case 2:
        return _sectionCard(
          title: l10n.carInventoryDetails,
          icon: Icons.tune_outlined,
          children: [
            _textField(
              controller: _mileageController,
              label: l10n.carMileage,
              icon: Icons.speed,
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 12),
            _dropdown(
              label: l10n.transmission,
              value: _transmission,
              values: _transmissionOptions.map((e) => e.value).toList(),
              localized: true,
              l10n: l10n,
              icon: Icons.settings_suggest_outlined,
              onChanged: (value) => setState(() => _transmission = value),
            ),
            const SizedBox(height: 12),
            _dropdown(
              label: l10n.fuelType,
              value: _fuelType,
              values: _fuelOptions.map((e) => e.value).toList(),
              localized: true,
              l10n: l10n,
              icon: Icons.local_gas_station_outlined,
              onChanged: (value) => setState(() => _fuelType = value),
            ),
            const SizedBox(height: 12),
            _dropdown(
              label: l10n.drivetrain,
              value: _drivetrain,
              values: _drivetrainOptions.map((e) => e.value).toList(),
              localized: true,
              l10n: l10n,
              icon: Icons.all_inclusive,
              onChanged: (value) => setState(() => _drivetrain = value),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _dropdown(
                    label: l10n.exteriorColor,
                    value: _exteriorColor,
                    values: valuesWithLegacy(_carColorValues, _exteriorColor),
                    localized: true,
                    l10n: l10n,
                    icon: Icons.palette_outlined,
                    onChanged: (value) =>
                        setState(() => _exteriorColor = value),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _dropdown(
                    label: l10n.interiorColor,
                    value: _interiorColor,
                    values: valuesWithLegacy(_carColorValues, _interiorColor),
                    localized: true,
                    l10n: l10n,
                    icon: Icons.chair_outlined,
                    onChanged: (value) =>
                        setState(() => _interiorColor = value),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            _textField(
              controller: _vinController,
              label: l10n.vinOptional,
              icon: Icons.pin_outlined,
            ),
            const SizedBox(height: 12),
            _textField(
              controller: _stockNumberController,
              label: l10n.stockNumberOptional,
              icon: Icons.tag_outlined,
            ),
          ],
        );
      case 3:
        return _sectionCard(
          title: l10n.carInventoryFeatures,
          icon: Icons.checklist_outlined,
          children: [
            Text(
              l10n.structuredFeatures,
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            _featureGrid(l10n),
            const SizedBox(height: 16),
            _textField(
              controller: _featuresController,
              label: l10n.customFeaturesHint,
              icon: Icons.add_circle_outline,
              minLines: 2,
              maxLines: 4,
            ),
          ],
        );
      case 4:
        return _sectionCard(
          title: l10n.carInventoryMedia,
          icon: Icons.photo_library_outlined,
          children: [_buildImageSection(l10n)],
        );
      case 5:
        return _sectionCard(
          title: l10n.carInventoryContact,
          icon: Icons.location_on_outlined,
          children: [
            _textField(
              controller: _contactNameController,
              label: l10n.contactName,
              icon: Icons.person_outline,
            ),
            const SizedBox(height: 12),
            _textField(
              controller: _contactPhoneController,
              label: l10n.contactPhone,
              icon: Icons.phone_outlined,
              keyboardType: TextInputType.phone,
              inputFormatters: PhoneNumberValidator.allowedInputFormatters,
              errorText: _contactPhoneError,
              onChanged: (_) {
                if (_contactPhoneError != null) {
                  setState(() => _contactPhoneError = null);
                }
              },
            ),
            const SizedBox(height: 12),
            _textField(
              controller: _contactEmailController,
              label: l10n.contactEmail,
              icon: Icons.email_outlined,
              keyboardType: TextInputType.emailAddress,
            ),
            const SizedBox(height: 16),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                l10n.listingLocationSource,
                style: Theme.of(context).textTheme.titleSmall,
              ),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                _useBusinessAddress
                    ? Icons.radio_button_checked
                    : Icons.radio_button_unchecked,
                color: AppColors.brandRed,
              ),
              onTap: () {
                setState(() {
                  _useBusinessAddress = true;
                  _locationAddressLine1 = widget.defaultAddressLine1;
                  _locationCity = widget.defaultCity.isEmpty
                      ? null
                      : widget.defaultCity;
                  _locationState = widget.defaultState.isEmpty
                      ? null
                      : widget.defaultState;
                  _locationPostalCode = widget.defaultPostalCode;
                  _stepError = null;
                  _locationAddressLine1Error = null;
                  _locationStateError = null;
                  _locationCityError = null;
                });
              },
              title: Text(l10n.useBusinessDefaultAddress),
              subtitle: Text(
                _businessAddressLabel.isEmpty
                    ? l10n.businessAddressMissing
                    : _businessAddressLabel,
              ),
            ),
            if (_useBusinessAddress && _businessDefaultAddressError != null)
              Padding(
                padding: const EdgeInsets.only(left: 56, bottom: 8),
                child: Text(
                  _businessDefaultAddressError!,
                  style: const TextStyle(
                    color: AppColors.errorRed,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                !_useBusinessAddress
                    ? Icons.radio_button_checked
                    : Icons.radio_button_unchecked,
                color: AppColors.brandRed,
              ),
              onTap: () => setState(() {
                _useBusinessAddress = false;
                _stepError = null;
                _businessDefaultAddressError = null;
              }),
              title: Text(l10n.useCustomViewingAddress),
            ),
            if (!_useBusinessAddress) ...[
              const SizedBox(height: 12),
              TextFormField(
                key: ValueKey(
                  'address_${_useBusinessAddress}_$_locationAddressLine1',
                ),
                initialValue: _locationAddressLine1,
                decoration: InputDecoration(
                  labelText: l10n.businessAddressLine1,
                  prefixIcon: const Icon(Icons.place_outlined),
                  errorText: _locationAddressLine1Error,
                ),
                onChanged: (value) {
                  _locationAddressLine1 = value.trim();
                  if (_locationAddressLine1Error != null) {
                    setState(() => _locationAddressLine1Error = null);
                  }
                },
              ),
              const SizedBox(height: 12),
              _dropdown(
                label: l10n.locationState,
                value: _locationState,
                values: _stateOptions(),
                l10n: l10n,
                icon: Icons.map_outlined,
                errorText: _locationStateError,
                displayLabel: (value) => usStateNames[value] ?? value,
                onChanged: (value) {
                  setState(() {
                    _locationState = value;
                    _locationCity = null;
                    _stepError = null;
                    _locationStateError = null;
                    _locationCityError = null;
                  });
                },
              ),
              const SizedBox(height: 12),
              _dropdown(
                label: l10n.locationCity,
                value: _locationCity,
                values: _cityOptions(),
                l10n: l10n,
                icon: Icons.location_city_outlined,
                hintText: _locationState == null ? l10n.selectStateFirst : null,
                errorText: _locationCityError,
                displayLabel: (value) =>
                    value == otherCityValue ? l10n.otherOption : value,
                onChanged: _locationState == null
                    ? null
                    : (value) {
                        setState(() {
                          _locationCity = value;
                          _stepError = null;
                          _locationCityError = null;
                        });
                      },
              ),
              const SizedBox(height: 12),
              TextFormField(
                key: ValueKey(
                  'postal_${_useBusinessAddress}_$_locationPostalCode',
                ),
                initialValue: _locationPostalCode,
                decoration: InputDecoration(
                  labelText: l10n.postalCode,
                  prefixIcon: const Icon(Icons.local_post_office_outlined),
                ),
                onChanged: (value) => _locationPostalCode = value.trim(),
              ),
            ],
          ],
        );
      default:
        return _buildReviewStep(l10n);
    }
  }

  Widget _reviewLine(String label, String value) {
    if (value.trim().isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 122,
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.lightMuted,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildReviewStep(AppLocalizations l10n) {
    final price = _priceValue();
    final currency = NumberFormat.simpleCurrency();
    final missing = <String>[];
    for (var step = 0; step < _stepCount - 1; step++) {
      final error = _validationErrorForStep(step, l10n);
      if (error != null) missing.add(_stepTitle(l10n, step));
    }
    final featureLabels = [
      ..._structuredFeatures.map((feature) => _carOptionLabel(l10n, feature)),
      ..._splitText(_featuresController.text),
    ];
    return _sectionCard(
      title: l10n.carInventoryReview,
      icon: Icons.fact_check_outlined,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: missing.isEmpty
                ? AppColors.sage.withValues(alpha: 0.12)
                : AppColors.saffron.withValues(alpha: 0.14),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              Icon(
                missing.isEmpty
                    ? Icons.check_circle_outline
                    : Icons.warning_amber_outlined,
                color: missing.isEmpty ? AppColors.sage : AppColors.warn,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  missing.isEmpty
                      ? l10n.readyToPublish
                      : '${l10n.missingRequiredInfo}: ${missing.join(', ')}',
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _reviewLine(l10n.carTitle, _titleController.text.trim()),
        _reviewLine(
          l10n.make,
          [
            _selectedMake,
            _selectedModel,
            _selectedYear,
          ].whereType<String>().join(' '),
        ),
        _reviewLine(
          l10n.sellingPrice,
          price == null ? '' : currency.format(price),
        ),
        _reviewLine(
          'Paid hold',
          _useBusinessHoldPricing
              ? 'Business default'
              : _holdPricingMode == 'flat'
              ? 'Flat ${currency.format(_holdFlatFeeValue() ?? 0)}'
              : '${currency.format(_holdDailyRateValue() ?? 0)} per day',
        ),
        _reviewLine(
          l10n.condition,
          _condition == null ? '' : _carOptionLabel(l10n, _condition!),
        ),
        _reviewLine(
          l10n.bodyType,
          _bodyType == null ? '' : _carOptionLabel(l10n, _bodyType!),
        ),
        _reviewLine(l10n.carMileage, _mileageController.text.trim()),
        _reviewLine(
          l10n.transmission,
          _transmission == null ? '' : _carOptionLabel(l10n, _transmission!),
        ),
        _reviewLine(
          l10n.fuelType,
          _fuelType == null ? '' : _carOptionLabel(l10n, _fuelType!),
        ),
        _reviewLine(
          l10n.location,
          [
            _locationAddressLine1,
            _locationCity,
            if (_locationState != null)
              usStateNames[_locationState] ?? _locationState,
            _locationPostalCode,
          ].whereType<String>().where((e) => e.isNotEmpty).join(', '),
        ),
        _reviewLine(l10n.imagesLabel, '${_images.length}'),
        _reviewLine(l10n.features, featureLabels.join(', ')),
        if (_status == 'inactive') ...[
          const SizedBox(height: 8),
          Text(
            l10n.listingWillStayInactive,
            style: const TextStyle(
              color: AppColors.lightMuted,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    final isLast = _currentStep == _stepCount - 1;
    return Material(
      color: Colors.transparent,
      child: Padding(
        padding: EdgeInsets.only(bottom: bottomInset),
        child: FractionallySizedBox(
          heightFactor: 0.94,
          child: Container(
            decoration: const BoxDecoration(
              color: AppColors.lightBg,
              borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
            ),
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
                  decoration: const BoxDecoration(
                    color: AppColors.paper,
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(18),
                    ),
                    border: Border(bottom: BorderSide(color: AppColors.rule)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              widget.initialCar == null
                                  ? l10n.addCar
                                  : l10n.editCar,
                              style: const TextStyle(
                                color: AppColors.ink,
                                fontSize: 20,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                          IconButton(
                            onPressed: () => Navigator.pop(context),
                            icon: const Icon(Icons.close),
                          ),
                        ],
                      ),
                      Text(
                        l10n.stepCount(_currentStep + 1, _stepCount),
                        style: const TextStyle(
                          color: AppColors.lightMuted,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 10),
                      SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(
                          children: List.generate(_stepCount, (index) {
                            final selected = index == _currentStep;
                            return Padding(
                              padding: const EdgeInsets.only(right: 8),
                              child: ChoiceChip(
                                selected: selected,
                                avatar: Icon(_stepIcon(index), size: 17),
                                label: Text(_stepTitle(l10n, index)),
                                onSelected: (_) => setState(() {
                                  _currentStep = index;
                                }),
                              ),
                            );
                          }),
                        ),
                      ),
                    ],
                  ),
                ),
                if (_catalogLoading)
                  const LinearProgressIndicator(minHeight: 2),
                if (_stepError != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: AppColors.errorRed.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: AppColors.errorRed.withValues(alpha: 0.35),
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.error_outline,
                            color: AppColors.errorRed,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              '${l10n.fixRequiredFields}: $_stepError',
                              style: const TextStyle(
                                color: AppColors.errorRed,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: _buildStep(l10n),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                  decoration: const BoxDecoration(
                    color: AppColors.paper,
                    border: Border(top: BorderSide(color: AppColors.rule)),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _goBack,
                          icon: Icon(
                            _currentStep == 0 ? Icons.close : Icons.arrow_back,
                          ),
                          label: Text(
                            _currentStep == 0 ? l10n.cancel : l10n.back,
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        flex: 2,
                        child: FilledButton.icon(
                          onPressed: _catalogLoading || _isPickingImages
                              ? null
                              : _goNext,
                          icon: Icon(
                            isLast
                                ? Icons.cloud_upload_outlined
                                : Icons.arrow_forward,
                          ),
                          label: Text(
                            isLast
                                ? (widget.initialCar == null
                                      ? l10n.publishCar
                                      : l10n.updateListing)
                                : l10n.next,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MarkAsSoldSheet extends StatefulWidget {
  const _MarkAsSoldSheet({required this.car});

  final Car car;

  @override
  State<_MarkAsSoldSheet> createState() => _MarkAsSoldSheetState();
}

class _MarkAsSoldSheetState extends State<_MarkAsSoldSheet> {
  final _formKey = GlobalKey<FormState>();
  final _customerNameController = TextEditingController();
  final _customerPhoneController = TextEditingController();
  final _customerEmailController = TextEditingController();
  final _customerAddressController = TextEditingController();
  final _salePriceController = TextEditingController();
  final _notesController = TextEditingController();

  DateTime _saleDate = DateTime.now();

  @override
  void initState() {
    super.initState();
    final info = widget.car.soldInfo;
    if (info != null) {
      _customerNameController.text = info.customerName;
      _customerPhoneController.text = info.customerPhone;
      _customerEmailController.text = info.customerEmail ?? '';
      _customerAddressController.text = info.customerAddress ?? '';
      if (info.amount != null) {
        _salePriceController.text = info.amount!.toStringAsFixed(
          info.amount! % 1 == 0 ? 0 : 2,
        );
      }
      if (info.soldDate != null) {
        _saleDate = info.soldDate!;
      }
      _notesController.text = info.notes ?? '';
    }
  }

  @override
  void dispose() {
    _customerNameController.dispose();
    _customerPhoneController.dispose();
    _customerEmailController.dispose();
    _customerAddressController.dispose();
    _salePriceController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _pickSaleDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _saleDate,
      firstDate: DateTime.now().subtract(const Duration(days: 365 * 5)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked != null) {
      setState(() {
        _saleDate = picked;
      });
    }
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    final amount = double.tryParse(_salePriceController.text.trim());
    final result = SoldCarResult(
      customerName: _customerNameController.text.trim(),
      customerPhone: _customerPhoneController.text.trim(),
      customerEmail: _customerEmailController.text.trim().isEmpty
          ? null
          : _customerEmailController.text.trim(),
      customerAddress: _customerAddressController.text.trim().isEmpty
          ? null
          : _customerAddressController.text.trim(),
      amount: amount,
      soldDate: _saleDate,
      notes: _notesController.text.trim().isEmpty
          ? null
          : _notesController.text.trim(),
    );
    Navigator.of(context).pop(result);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Material(
      color: Colors.transparent,
      child: Padding(
        padding: EdgeInsets.only(bottom: bottomInset),
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Text(
                    l10n.markAsSold,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Form(
                key: _formKey,
                child: Column(
                  children: [
                    TextFormField(
                      controller: _customerNameController,
                      decoration: InputDecoration(labelText: l10n.customerName),
                      validator: (value) {
                        if (value == null || value.trim().isEmpty) {
                          return l10n.requiredField;
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _customerPhoneController,
                      keyboardType: TextInputType.phone,
                      inputFormatters:
                          PhoneNumberValidator.allowedInputFormatters,
                      decoration: InputDecoration(
                        labelText: l10n.customerPhone,
                      ),
                      validator: (value) => PhoneNumberValidator.validate(
                        value,
                        requiredMessage: l10n.requiredField,
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _customerEmailController,
                      decoration: InputDecoration(
                        labelText: l10n.customerEmailOptional,
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _customerAddressController,
                      decoration: InputDecoration(
                        labelText: l10n.customerAddressOptional,
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _salePriceController,
                      decoration: InputDecoration(labelText: l10n.salePrice),
                      keyboardType: TextInputType.number,
                    ),
                    const SizedBox(height: 16),
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(l10n.saleDate),
                      subtitle: Text(DateFormat.yMMMd().format(_saleDate)),
                      trailing: const Icon(Icons.calendar_month),
                      onTap: _pickSaleDate,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _notesController,
                      decoration: InputDecoration(
                        labelText: l10n.additionalNotes,
                      ),
                      minLines: 2,
                      maxLines: 4,
                    ),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: _submit,
                        style: ElevatedButton.styleFrom(
                          minimumSize: const Size.fromHeight(52),
                          backgroundColor: AppColors.brandRed,
                          foregroundColor: Colors.white,
                        ),
                        child: Text(l10n.confirmSale),
                      ),
                    ),
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

class _ImagePreviewTile extends StatelessWidget {
  const _ImagePreviewTile({
    required this.image,
    required this.isCover,
    required this.l10n,
    required this.onRemove,
    required this.onSetCover,
  });

  final _EditableCarImage image;
  final bool isCover;
  final AppLocalizations l10n;
  final VoidCallback onRemove;
  final VoidCallback onSetCover;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: SizedBox(
            width: 100,
            height: 100,
            child: image.url != null
                ? Image.network(image.url!, fit: BoxFit.cover)
                : image.bytes != null
                ? Image.memory(image.bytes!, fit: BoxFit.cover)
                : Container(
                    color: Colors.grey.shade300,
                    alignment: Alignment.center,
                    child: const Icon(Icons.image, color: Colors.grey),
                  ),
          ),
        ),
        Positioned(
          top: 4,
          right: 4,
          child: _IconCircleButton(icon: Icons.close, onPressed: onRemove),
        ),
        Positioned(
          left: 4,
          bottom: 4,
          child: isCover
              ? Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.6),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    l10n.coverLabel,
                    style: const TextStyle(color: Colors.white, fontSize: 12),
                  ),
                )
              : TextButton(
                  style: TextButton.styleFrom(
                    foregroundColor: Colors.white,
                    backgroundColor: Colors.black.withValues(alpha: 0.45),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  onPressed: onSetCover,
                  child: Text(
                    l10n.setAsCover,
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
        ),
      ],
    );
  }
}

class _IconCircleButton extends StatelessWidget {
  const _IconCircleButton({required this.icon, required this.onPressed});

  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.black.withValues(alpha: 0.5),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onPressed,
        child: Padding(
          padding: const EdgeInsets.all(4),
          child: Icon(icon, size: 16, color: Colors.white),
        ),
      ),
    );
  }
}

class _ImagePlaceholder extends StatelessWidget {
  const _ImagePlaceholder({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: Colors.grey.shade200,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Icon(Icons.directions_car, size: size * 0.5, color: Colors.grey),
    );
  }
}

class _CenteredMessage extends StatelessWidget {
  const _CenteredMessage({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          message,
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.grey.shade600, fontSize: 16),
        ),
      ),
    );
  }
}

class _EmptyCarsState extends StatelessWidget {
  const _EmptyCarsState({required this.onAdd});

  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 32),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 92,
                height: 92,
                decoration: BoxDecoration(
                  color: AppColors.mist,
                  borderRadius: BorderRadius.circular(24),
                ),
                child: const Icon(
                  Icons.directions_car,
                  size: 46,
                  color: AppColors.cobalt,
                ),
              ),
              const SizedBox(height: 22),
              Text(
                l10n.noCarsFound,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 21,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                l10n.addYourFirstCar,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 15,
                  color: AppColors.lightMuted,
                  height: 1.35,
                ),
              ),
              const SizedBox(height: 28),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton.icon(
                  onPressed: onAdd,
                  icon: const Icon(Icons.add),
                  label: Text(l10n.addCar),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.brandRed,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
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

class _CarFormResult {
  _CarFormResult({
    required this.title,
    required this.description,
    required this.make,
    required this.model,
    required this.year,
    required this.mileage,
    required this.price,
    required this.features,
    required this.structuredFeatures,
    required this.images,
    required this.contactPhone,
    this.contactName,
    this.contactEmail,
    required this.condition,
    required this.bodyType,
    required this.transmission,
    required this.fuelType,
    required this.drivetrain,
    required this.exteriorColor,
    required this.interiorColor,
    required this.vin,
    required this.stockNumber,
    required this.isNegotiable,
    required this.locationAddressLine1,
    required this.locationCity,
    required this.locationState,
    required this.locationPostalCode,
    required this.status,
    required this.useBusinessHoldPricing,
    required this.carHoldPricingMode,
    this.carHoldFlatFee,
    this.carHoldDailyRate,
    this.carHoldMaxDays,
  });

  final String title;
  final String description;
  final String make;
  final String model;
  final String year;
  final String mileage;
  final double price;
  final List<String> features;
  final List<String> structuredFeatures;
  final List<_EditableCarImage> images;
  final String contactPhone;
  final String? contactName;
  final String? contactEmail;
  final String condition;
  final String bodyType;
  final String transmission;
  final String fuelType;
  final String drivetrain;
  final String exteriorColor;
  final String interiorColor;
  final String vin;
  final String stockNumber;
  final bool isNegotiable;
  final String locationAddressLine1;
  final String locationCity;
  final String locationState;
  final String locationPostalCode;
  final String status;
  final bool useBusinessHoldPricing;
  final String carHoldPricingMode;
  final double? carHoldFlatFee;
  final double? carHoldDailyRate;
  final int? carHoldMaxDays;

  Map<String, dynamic> toFirestoreMap() {
    final map = <String, dynamic>{
      'title': title,
      'description': description,
      'make': make,
      'model': model,
      'year': year,
      'mileage': mileage,
      'price': price,
      'features': features,
      'structuredFeatures': structuredFeatures,
      'contactPhone': contactPhone,
      'condition': condition,
      'bodyType': bodyType,
      'transmission': transmission,
      'fuelType': fuelType,
      'drivetrain': drivetrain,
      'exteriorColor': exteriorColor,
      'interiorColor': interiorColor,
      'vin': vin,
      'stockNumber': stockNumber,
      'isNegotiable': isNegotiable,
      'locationAddressLine1': locationAddressLine1,
      'locationCity': locationCity,
      'locationState': locationState,
      'locationPostalCode': locationPostalCode,
      'useBusinessHoldPricing': useBusinessHoldPricing,
      'carHoldPricingMode': carHoldPricingMode,
      if (carHoldFlatFee != null) 'carHoldFlatFee': carHoldFlatFee,
      if (carHoldDailyRate != null) 'carHoldDailyRate': carHoldDailyRate,
      if (carHoldMaxDays != null) 'carHoldMaxDays': carHoldMaxDays,
      if (contactName != null && contactName!.isNotEmpty)
        'contactName': contactName,
      if (contactEmail != null && contactEmail!.isNotEmpty)
        'contactEmail': contactEmail,
    };
    return map;
  }
}

class _EditableCarImage {
  _EditableCarImage.remote(this.url) : file = null, bytes = null;

  _EditableCarImage.local(this.file, this.bytes) : url = null;

  final String? url;
  final XFile? file;
  final Uint8List? bytes;
}

class SoldCarResult {
  SoldCarResult({
    required this.customerName,
    required this.customerPhone,
    this.customerEmail,
    this.customerAddress,
    this.amount,
    this.soldDate,
    this.notes,
  });

  final String customerName;
  final String customerPhone;
  final String? customerEmail;
  final String? customerAddress;
  final double? amount;
  final DateTime? soldDate;
  final String? notes;

  Map<String, dynamic> toMap() {
    final map = <String, dynamic>{
      'customerName': customerName,
      'customerPhone': customerPhone,
    };
    if (customerEmail != null && customerEmail!.isNotEmpty) {
      map['customerEmail'] = customerEmail;
    }
    if (customerAddress != null && customerAddress!.isNotEmpty) {
      map['customerAddress'] = customerAddress;
    }
    if (amount != null) {
      map['amount'] = amount;
    }
    if (soldDate != null) {
      map['soldDate'] = Timestamp.fromDate(soldDate!);
    }
    if (notes != null && notes!.isNotEmpty) {
      map['notes'] = notes;
    }
    return map;
  }
}
