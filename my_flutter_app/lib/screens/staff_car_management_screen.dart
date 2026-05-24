import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart' as firebase_storage;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../data/car_catalog.dart';
import '../l10n/app_localizations.dart';
import '../models/car.dart';
import '../widgets/language_toggle.dart';
import '../theme/app_colors.dart';

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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            newStatus == 'active'
                ? l10n.activateSuccess
                : l10n.deactivateSuccess,
          ),
          backgroundColor: Colors.green,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context)!;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.operationFailed('$e')),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      _setProcessing(car.id, false);
    }
  }

  Future<void> _createCar(_CarFormResult result) async {
    final docRef = _firestore.collection('cars').doc();
    final imageUrls = await _uploadImages(
      carId: docRef.id,
      images: result.images,
    );
    await docRef.set({
      'id': docRef.id,
      ...result.toFirestoreMap(),
      'status': result.status,
      'imageUrls': imageUrls,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> _updateCar(Car car, _CarFormResult result) async {
    final data = result.toFirestoreMap();
    final statusToPersist =
        car.isSold || car.isReserved ? car.status : result.status;
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
      final metadata =
          firebase_storage.SettableMetadata(contentType: contentType);
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
    final result = await showModalBottomSheet<_CarFormResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (context) => _CarFormSheet(initialCar: car),
    );

    if (result == null) return;

    if (car != null) {
      _setProcessing(car.id, true);
    }
    try {
      if (car == null) {
        await _createCar(result);
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(l10n.carCreated),
            backgroundColor: Colors.green,
          ),
        );
      } else {
        await _updateCar(car, result);
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(l10n.carUpdated),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.operationFailed('$e')),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      if (car != null) {
        _setProcessing(car.id, false);
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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.saleRecorded),
          backgroundColor: Colors.green,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.operationFailed('$e')),
          backgroundColor: Colors.red,
        ),
      );
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
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: AppColors.headerGradient,
        ),
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
                    stream: _firestore
                        .collection('cars')
                        .orderBy('createdAt', descending: true)
                        .snapshots(),
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
                      final cars = snapshot.data!.docs
                          .map((doc) => Car.fromFirestore(doc))
                          .toList();
                      if (cars.isEmpty) {
                        return _EmptyCarsState(onAdd: () => _showCarForm());
                      }

                      final total = cars.length;
                      final active =
                          cars.where((car) => car.status == 'active').length;
                      final inactive =
                          cars.where((car) => car.status == 'inactive').length;
                      final sold =
                          cars.where((car) => car.status == 'sold').length;
                      final reserved =
                          cars.where((car) => car.status == 'reserved').length;

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
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 20),
                              itemCount: cars.length,
                          itemBuilder: (context, index) {
                                final car = cars[index];
                                final isProcessing =
                                    _processingCars.contains(car.id);
                                return _CarCard(
                                  car: car,
                                  l10n: l10n,
                                  currency: _currency,
                                  statusColor: _statusColor(car.status),
                                  statusLabel: _statusLabel(l10n, car.status),
                                  isProcessing: isProcessing,
                                  onEdit: () => _showCarForm(car: car),
                                  onToggleStatus: car.isSold
                                      || car.isReserved
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
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showCarForm(),
        backgroundColor: AppColors.brandRed,
        child: const Icon(Icons.add, color: Colors.white),
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
    final imageUrl =
        car.imageUrls.isNotEmpty ? car.imageUrls.first : null;
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
                style: TextStyle(
                  color: Colors.grey.shade700,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 12),
              if (car.features.isNotEmpty)
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: car.features.take(6).map((feature) {
                    return Chip(
                      label: Text(feature),
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
                          l10n.soldPriceLabel(
                            currency.format(soldInfo.amount),
                          ),
                        ),
                      if (soldInfo.customerPhone.isNotEmpty)
                        Text('${l10n.customerPhone}: ${soldInfo.customerPhone}'),
                      if ((soldInfo.customerEmail ?? '').isNotEmpty)
                        Text('${l10n.customerEmail}: ${soldInfo.customerEmail}'),
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
                    onPressed:
                        isProcessing || onMarkSold == null ? null : onMarkSold,
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
                      car.status == 'active'
                          ? l10n.deactivate
                          : l10n.activate,
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
              child: const Center(
                child: CircularProgressIndicator(),
              ),
            ),
          ),
      ],
    );
  }
}

class _CarFormSheet extends StatefulWidget {
  const _CarFormSheet({required this.initialCar});

  final Car? initialCar;

  @override
  State<_CarFormSheet> createState() => _CarFormSheetState();
}

class _CarFormSheetState extends State<_CarFormSheet> {
  final _formKey = GlobalKey<FormState>();

  late final TextEditingController _titleController;
  late final TextEditingController _descriptionController;
  late final TextEditingController _mileageController;
  late final TextEditingController _priceController;
  late final TextEditingController _featuresController;
  late final TextEditingController _contactNameController;
  late final TextEditingController _contactPhoneController;
  late final TextEditingController _contactEmailController;

  final ImagePicker _picker = ImagePicker();
  final List<_EditableCarImage> _images = [];

  String? _selectedMake;
  String? _selectedModel;
  String? _selectedYear;
  String _status = 'active';

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
    _contactNameController =
        TextEditingController(text: car?.contactName ?? '');
    _contactPhoneController =
        TextEditingController(text: car?.contactPhone ?? '');
    _contactEmailController =
        TextEditingController(text: car?.contactEmail ?? '');
    _selectedMake = car?.make.isNotEmpty == true ? car!.make : null;
    _selectedModel = car?.model.isNotEmpty == true ? car!.model : null;
    _selectedYear = car?.year.isNotEmpty == true ? car!.year : null;
    _status = car?.status ?? 'active';
    if (car != null) {
      _images.addAll(
        car.imageUrls.map(_EditableCarImage.remote),
      );
    }
    _loadCatalog();
  }

  Future<void> _loadCatalog() async {
    final catalog = CarCatalog.instance;
    await catalog.load();
    final makes = catalog.getMakes();
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
    try {
      final files = await _picker.pickMultiImage();
      if (files.isEmpty) return;
      final additions = <_EditableCarImage>[];
      for (final file in files) {
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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.operationFailed('$e')),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  void _removeImage(int index) {
    setState(() {
      _images.removeAt(index);
    });
  }

  void _markAsCover(int index) {
    if (index == 0) return;
    setState(() {
      final image = _images.removeAt(index);
      _images.insert(0, image);
    });
  }

  Widget _buildImageSection(AppLocalizations l10n) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              l10n.imagesLabel,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
            TextButton.icon(
              onPressed: _pickImages,
              icon: const Icon(Icons.photo_library_outlined),
              label: Text(l10n.addImages),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (_images.isEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.grey.shade100,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.grey.shade200),
            ),
            child: Text(
              l10n.noImagesSelected,
              style: TextStyle(color: Colors.grey.shade600),
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

  void _submit() {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    if (_images.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.addImagesPrompt),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }
    final price = double.tryParse(_priceController.text.trim());
    if (price == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context)!.pleaseEnterValidNumber),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }
    final car = widget.initialCar;
    final result = _CarFormResult(
      title: _titleController.text.trim(),
      description: _descriptionController.text.trim(),
      make: _selectedMake!,
      model: _selectedModel!,
      year: _selectedYear!,
      mileage: _mileageController.text.trim(),
      price: price,
      features: _splitText(_featuresController.text),
      images: List<_EditableCarImage>.from(_images),
      contactName: _contactNameController.text.trim().isEmpty
          ? null
          : _contactNameController.text.trim(),
      contactPhone: _contactPhoneController.text.trim(),
      contactEmail: _contactEmailController.text.trim().isEmpty
          ? null
          : _contactEmailController.text.trim(),
      status: car?.status == 'sold' ? 'sold' : _status,
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
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Material(
      color: Colors.transparent,
      child: Padding(
        padding: EdgeInsets.only(
          bottom: bottomInset,
        ),
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      widget.initialCar == null
                          ? l10n.addCar
                          : l10n.editCar,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
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
                        controller: _titleController,
                        decoration: InputDecoration(labelText: l10n.carTitle),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return l10n.requiredField;
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _descriptionController,
                  decoration: InputDecoration(
                          labelText: l10n.carDescription,
                        ),
                        minLines: 3,
                        maxLines: 5,
                      ),
                      const SizedBox(height: 16),
                      DropdownButtonFormField<String>(
                        key: ValueKey<String>('make-${_selectedMake ?? 'none'}'),
                        initialValue: _selectedMake,
                        items: _makeOptions
                            .map(
                              (make) => DropdownMenuItem<String>(
                                value: make,
                                child: Text(make),
                              ),
                            )
                            .toList(),
                        onChanged: (value) {
                          setState(() {
                            _selectedMake = value;
                            _selectedModel = null;
                            _selectedYear = null;
                            _updateModelOptions();
                          });
                        },
                        decoration: InputDecoration(labelText: l10n.make),
                        validator: (value) =>
                            value == null ? l10n.requiredField : null,
                ),
                const SizedBox(height: 16),
                      DropdownButtonFormField<String>(
                        key: ValueKey<String>('model-${_selectedModel ?? 'none'}'),
                        initialValue: _selectedModel,
                        items: _modelOptions
                            .map(
                              (model) => DropdownMenuItem<String>(
                                value: model,
                                child: Text(model),
                              ),
                            )
                            .toList(),
                        onChanged: (value) {
                          setState(() {
                            _selectedModel = value;
                            _selectedYear = null;
                            _updateYearOptions();
                          });
                        },
                        decoration: InputDecoration(labelText: l10n.model),
                        validator: (value) =>
                            value == null ? l10n.requiredField : null,
                      ),
                      const SizedBox(height: 16),
                      DropdownButtonFormField<String>(
                        key: ValueKey<String>('year-${_selectedYear ?? 'none'}'),
                        initialValue: _selectedYear,
                        items: _yearOptions
                            .map(
                              (year) => DropdownMenuItem<String>(
                                value: year,
                                child: Text(year),
                              ),
                            )
                            .toList(),
                        onChanged: (value) {
                          setState(() {
                            _selectedYear = value;
                          });
                        },
                        decoration: InputDecoration(labelText: l10n.year),
                        validator: (value) =>
                            value == null ? l10n.requiredField : null,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _mileageController,
                  decoration: InputDecoration(
                          labelText: l10n.carMileage,
                        ),
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _priceController,
                        decoration: InputDecoration(
                          labelText: l10n.sellingPrice,
                        ),
                        keyboardType: TextInputType.number,
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return l10n.requiredField;
                          }
                          if (double.tryParse(value.trim()) == null) {
                            return l10n.pleaseEnterValidNumber;
                          }
                          return null;
                        },
                ),
                const SizedBox(height: 16),
                      TextFormField(
                        controller: _featuresController,
                  decoration: InputDecoration(
                          labelText: l10n.carFeaturesHint,
                        ),
                      ),
                      const SizedBox(height: 16),
                      _buildImageSection(l10n),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _contactNameController,
                  decoration: InputDecoration(
                          labelText: l10n.contactName,
                  ),
                ),
                const SizedBox(height: 16),
                      TextFormField(
                        controller: _contactPhoneController,
                  decoration: InputDecoration(
                          labelText: l10n.contactPhone,
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return l10n.requiredField;
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _contactEmailController,
                        decoration: InputDecoration(
                          labelText: l10n.contactEmail,
                        ),
                        keyboardType: TextInputType.emailAddress,
                      ),
                      const SizedBox(height: 16),
                      if (widget.initialCar?.isSold != true)
                        DropdownButtonFormField<String>(
                          key: ValueKey<String>('status-$_status'),
                          initialValue: _status,
                          items: const [
                            DropdownMenuItem(
                              value: 'active',
                              child: Text('Active'),
                            ),
                            DropdownMenuItem(
                              value: 'inactive',
                              child: Text('Inactive'),
                            ),
                          ],
                          onChanged: (value) {
                            if (value == null) return;
                            setState(() {
                              _status = value;
                            });
                          },
                          decoration:
                              InputDecoration(labelText: l10n.statusLabel),
                        )
                      else
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Chip(
                            backgroundColor: Colors.purple.withValues(alpha: 0.12),
                            label: Text(
                              l10n.sold,
                              style: const TextStyle(color: Colors.purple),
                            ),
                          ),
                        ),
                      const SizedBox(height: 24),
                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: _catalogLoading ? null : _submit,
                          style: ElevatedButton.styleFrom(
                            minimumSize: const Size.fromHeight(52),
                            backgroundColor: AppColors.brandRed,
                            foregroundColor: Colors.white,
                          ),
                          child: Text(
                            widget.initialCar == null
                                ? l10n.saveCar
                                : l10n.updateCar,
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
        _salePriceController.text =
            info.amount!.toStringAsFixed(info.amount! % 1 == 0 ? 0 : 2);
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
                      decoration: InputDecoration(labelText: l10n.customerPhone),
                      validator: (value) {
                        if (value == null || value.trim().isEmpty) {
                          return l10n.requiredField;
                        }
                        return null;
                      },
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
                      decoration:
                          InputDecoration(labelText: l10n.salePrice),
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
                      decoration:
                          InputDecoration(labelText: l10n.additionalNotes),
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
                ? Image.network(
                    image.url!,
                    fit: BoxFit.cover,
                  )
                : image.bytes != null
                    ? Image.memory(
                        image.bytes!,
                        fit: BoxFit.cover,
                      )
                    : Container(
                        color: Colors.grey.shade300,
                        alignment: Alignment.center,
                        child: const Icon(
                          Icons.image,
                          color: Colors.grey,
                        ),
                      ),
          ),
        ),
        Positioned(
          top: 4,
          right: 4,
          child: _IconCircleButton(
            icon: Icons.close,
            onPressed: onRemove,
          ),
        ),
        Positioned(
          left: 4,
          bottom: 4,
          child: isCover
              ? Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.6),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    l10n.coverLabel,
                    style:
                        const TextStyle(color: Colors.white, fontSize: 12),
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
          child: Icon(
            icon,
            size: 16,
            color: Colors.white,
          ),
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
      child: Icon(
        Icons.directions_car,
        size: size * 0.5,
        color: Colors.grey,
      ),
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
          style: TextStyle(
            color: Colors.grey.shade600,
            fontSize: 16,
          ),
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
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(
          Icons.directions_car,
          size: 80,
          color: Colors.grey.shade400,
        ),
        const SizedBox(height: 16),
        Text(
          l10n.noCarsFound,
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: Colors.grey.shade700,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          l10n.addYourFirstCar,
          style: TextStyle(
            fontSize: 14,
            color: Colors.grey.shade500,
          ),
        ),
        const SizedBox(height: 24),
        ElevatedButton.icon(
          onPressed: onAdd,
          icon: const Icon(Icons.add),
          label: Text(l10n.addCar),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.brandRed,
            foregroundColor: Colors.white,
          ),
        ),
      ],
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
    required this.images,
    required this.contactPhone,
    this.contactName,
    this.contactEmail,
    required this.status,
  });

  final String title;
  final String description;
  final String make;
  final String model;
  final String year;
  final String mileage;
  final double price;
  final List<String> features;
  final List<_EditableCarImage> images;
  final String contactPhone;
  final String? contactName;
  final String? contactEmail;
  final String status;

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
      'contactPhone': contactPhone,
      if (contactName != null && contactName!.isNotEmpty)
        'contactName': contactName,
      if (contactEmail != null && contactEmail!.isNotEmpty)
        'contactEmail': contactEmail,
    };
    return map;
  }
}

class _EditableCarImage {
  _EditableCarImage.remote(this.url)
      : file = null,
        bytes = null;

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

