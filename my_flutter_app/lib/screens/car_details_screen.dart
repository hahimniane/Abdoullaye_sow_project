import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../models/car.dart';
import '../models/destination_country.dart';
import '../providers/auth_provider.dart';
import '../services/car_purchase_service.dart';
import '../widgets/language_toggle.dart';
import '../widgets/destination_country_field.dart';
import '../theme/app_colors.dart';

class CarDetailsScreen extends StatelessWidget {
  CarDetailsScreen({super.key, required this.car});

  final Car car;
  final NumberFormat _currency = NumberFormat.simpleCurrency();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final images = car.imageUrls.isNotEmpty
        ? car.imageUrls
        : <String>['placeholder'];
    final priceText = _currency.format(car.price);
    final canContact = car.contactPhone.isNotEmpty;
    final statusText = () {
      switch (car.status) {
        case 'active':
          return l10n.active;
        case 'inactive':
          return l10n.inactive;
        case 'sold':
          return l10n.sold;
        case 'reserved':
          return l10n.reserved;
        default:
          return car.status;
      }
    }();
    final canReserve = car.status == 'active';

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppColors.headerGradient),
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
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
                        l10n.carDetails,
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
              Expanded(
                child: Container(
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.only(
                      topLeft: Radius.circular(30),
                      topRight: Radius.circular(30),
                    ),
                  ),
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _ImageGallery(images: images),
                        const SizedBox(height: 20),
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                car.title,
                                style: const TextStyle(
                                  fontSize: 24,
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.brandRed,
                                ),
                              ),
                            ),
                            Text(
                              priceText,
                              style: const TextStyle(
                                fontSize: 24,
                                fontWeight: FontWeight.bold,
                                color: AppColors.brandRed,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: [
                            _InfoChip(
                              label: '${car.make} ${car.model}',
                              icon: Icons.directions_car,
                            ),
                            _InfoChip(
                              label: '${l10n.year}: ${car.year}',
                              icon: Icons.calendar_today,
                            ),
                            _InfoChip(
                              label: l10n.mileageLabel(car.mileage),
                              icon: Icons.speed,
                            ),
                            if (car.status.isNotEmpty)
                              _InfoChip(
                                label: l10n.statusLabel,
                                value: statusText,
                                icon: Icons.info_outline,
                              ),
                          ],
                        ),
                        const SizedBox(height: 20),
                        Text(
                          l10n.carDescription,
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          car.description.isNotEmpty
                              ? car.description
                              : l10n.noDescriptionAvailable,
                          style: TextStyle(
                            fontSize: 16,
                            color: Colors.grey.shade700,
                            height: 1.5,
                          ),
                        ),
                        const SizedBox(height: 20),
                        Text(
                          l10n.features,
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 8),
                        if (car.features.isEmpty)
                          Text(
                            l10n.noFeaturesAvailable,
                            style: TextStyle(color: Colors.grey.shade600),
                          )
                        else
                          Column(
                            children: car.features.map((feature) {
                              return Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 4,
                                ),
                                child: Row(
                                  children: [
                                    const Icon(
                                      Icons.check_circle,
                                      color: AppColors.brandRed,
                                      size: 20,
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Text(
                                        feature,
                                        style: const TextStyle(fontSize: 16),
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            }).toList(),
                          ),
                        const SizedBox(height: 20),
                        _ContactCard(
                          l10n: l10n,
                          phone: car.contactPhone,
                          contactName: car.contactName,
                          contactEmail: car.contactEmail,
                        ),
                        const SizedBox(height: 30),
                        SizedBox(
                          width: double.infinity,
                          height: 56,
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.brandRed,
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                              elevation: 0,
                              splashFactory: NoSplash.splashFactory,
                            ),
                            onPressed: canReserve
                                ? () => _showReservationSheet(context)
                                : null,
                            icon: const Icon(Icons.lock_clock, size: 24),
                            label: Text(
                              l10n.reserveWithDeposit,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                        SizedBox(
                          width: double.infinity,
                          height: 52,
                          child: OutlinedButton.icon(
                            onPressed: canContact
                                ? () => _sendWhatsAppMessage(context, priceText)
                                : null,
                            icon: const Icon(Icons.message, size: 22),
                            label: Text(l10n.sendWhatsAppMessage),
                          ),
                        ),
                      ],
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

  Future<void> _showReservationSheet(BuildContext context) async {
    final authProvider = context.read<AuthProvider>();
    final l10n = AppLocalizations.of(context)!;
    if (!authProvider.isAuthenticated) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(l10n.loginRequiredForDeposit)));
      await Navigator.pushNamed(context, '/login');
      return;
    }

    final buyerNameController = TextEditingController();
    final buyerPhoneController = TextEditingController();
    DestinationCountry? selectedCountry;
    var isSubmitting = false;
    final formKey = GlobalKey<FormState>();

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final bottomInset = MediaQuery.of(context).viewInsets.bottom;
            return Padding(
              padding: EdgeInsets.only(bottom: bottomInset),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Form(
                  key: formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              l10n.reserveThisCar,
                              style: Theme.of(context).textTheme.titleLarge,
                            ),
                          ),
                          IconButton(
                            onPressed: isSubmitting
                                ? null
                                : () => Navigator.pop(context),
                            icon: const Icon(Icons.close),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        l10n.depositSummary('\$500 USD'),
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      const SizedBox(height: 20),
                      TextFormField(
                        controller: buyerNameController,
                        decoration: InputDecoration(
                          labelText: l10n.customerName,
                        ),
                        validator: (value) =>
                            value == null || value.trim().isEmpty
                            ? l10n.requiredField
                            : null,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: buyerPhoneController,
                        decoration: InputDecoration(
                          labelText: l10n.customerPhone,
                        ),
                        keyboardType: TextInputType.phone,
                        validator: (value) =>
                            value == null || value.trim().isEmpty
                            ? l10n.requiredField
                            : null,
                      ),
                      const SizedBox(height: 16),
                      DestinationCountryField(
                        value: selectedCountry,
                        label: l10n.destinationCountry,
                        requiredMessage: l10n.requiredField,
                        onChanged: (country) {
                          setModalState(() => selectedCountry = country);
                        },
                      ),
                      const SizedBox(height: 24),
                      SizedBox(
                        width: double.infinity,
                        height: 52,
                        child: ElevatedButton(
                          onPressed: isSubmitting
                              ? null
                              : () async {
                                  if (!formKey.currentState!.validate() ||
                                      selectedCountry == null) {
                                    return;
                                  }
                                  setModalState(() => isSubmitting = true);
                                  try {
                                    await CarPurchaseService()
                                        .reserveWithDeposit(
                                          car: car,
                                          destinationCountry: selectedCountry!,
                                          buyerName: buyerNameController.text
                                              .trim(),
                                          buyerPhone: buyerPhoneController.text
                                              .trim(),
                                        );
                                    if (!context.mounted) return;
                                    Navigator.pop(context);
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                        content: Text(l10n.reservationComplete),
                                        backgroundColor: Colors.green,
                                      ),
                                    );
                                  } catch (e) {
                                    if (!context.mounted) return;
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                        content: Text(
                                          l10n.operationFailed(e.toString()),
                                        ),
                                        backgroundColor: Colors.red,
                                      ),
                                    );
                                  } finally {
                                    if (context.mounted) {
                                      setModalState(() => isSubmitting = false);
                                    }
                                  }
                                },
                          child: isSubmitting
                              ? const SizedBox(
                                  width: 22,
                                  height: 22,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : Text(l10n.payDeposit),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );

    buyerNameController.dispose();
    buyerPhoneController.dispose();
  }

  void _sendWhatsAppMessage(BuildContext context, String formattedPrice) {
    final localizations = AppLocalizations.of(context)!;
    final messenger = ScaffoldMessenger.maybeOf(context);
    final phone = car.contactPhone;
    if (phone.isEmpty) {
      messenger?.showSnackBar(
        SnackBar(
          content: Text(localizations.contactUnavailable),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }
    final message = localizations.whatsAppMessage(
      car.title,
      car.year,
      formattedPrice,
    );
    final uri = Uri.parse(
      'https://wa.me/$phone?text=${Uri.encodeComponent(message)}',
    );

    launchUrl(uri).catchError((error) {
      messenger?.showSnackBar(
        SnackBar(
          content: Text(localizations.operationFailed('$error')),
          backgroundColor: Colors.red,
        ),
      );
      return false;
    });
  }
}

class _ImageGallery extends StatelessWidget {
  const _ImageGallery({required this.images});

  final List<String> images;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 250,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.1),
            blurRadius: 10,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(20),
        child: PageView.builder(
          itemCount: images.length,
          itemBuilder: (context, index) {
            final imageUrl = images[index];
            if (imageUrl == 'placeholder') {
              return Container(
                color: Colors.grey.shade300,
                child: const Icon(
                  Icons.directions_car,
                  size: 80,
                  color: Colors.grey,
                ),
              );
            }
            return Image.network(
              imageUrl,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) {
                return Container(
                  color: Colors.grey.shade300,
                  child: const Icon(
                    Icons.directions_car,
                    size: 80,
                    color: Colors.grey,
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  const _InfoChip({required this.label, this.value, required this.icon});

  final String label;
  final String? value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.grey.shade100,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 18, color: AppColors.brandRed),
          const SizedBox(width: 8),
          Text(
            value != null ? '$label: $value' : label,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }
}

class _ContactCard extends StatelessWidget {
  const _ContactCard({
    required this.l10n,
    required this.phone,
    required this.contactName,
    required this.contactEmail,
  });

  final AppLocalizations l10n;
  final String phone;
  final String? contactName;
  final String? contactEmail;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.grey.shade50,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey.shade200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.contactInfo,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          if (contactName != null && contactName!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                children: [
                  const Icon(Icons.person, color: AppColors.brandRed, size: 20),
                  const SizedBox(width: 12),
                  Text(contactName!, style: const TextStyle(fontSize: 16)),
                ],
              ),
            ),
          Row(
            children: [
              const Icon(Icons.phone, color: AppColors.brandRed, size: 20),
              const SizedBox(width: 12),
              Text(
                phone.isNotEmpty ? phone : l10n.contactUnavailable,
                style: const TextStyle(fontSize: 16),
              ),
            ],
          ),
          if (contactEmail != null && contactEmail!.isNotEmpty) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                const Icon(Icons.email, color: AppColors.brandRed, size: 20),
                const SizedBox(width: 12),
                Text(contactEmail!, style: const TextStyle(fontSize: 16)),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
