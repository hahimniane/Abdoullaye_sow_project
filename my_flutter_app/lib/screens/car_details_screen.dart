import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../models/car.dart';
import '../models/car_purchase.dart';
import '../providers/auth_provider.dart';
import '../services/car_purchase_service.dart';
import '../services/favorite_cars_service.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/language_toggle.dart';
import '../theme/app_colors.dart';
import '../utils/action_confirmation.dart';
import '../utils/car_option_localization.dart';
import '../utils/phone_number_validator.dart';

String _carDetailOptionLabel(AppLocalizations l10n, String value) {
  return localizedCarOptionLabel(l10n, value);
}

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
    final user = context.watch<AuthProvider>().user;
    final canReserve = car.status == 'active';
    final canPurchase = car.status == 'active' && car.price > 0;
    final allFeatures = car.allFeatures;

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
                    const AppBackButton(onDarkBackground: true),
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
                    color: AppColors.lightBg,
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
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.brandRed,
                                ),
                              ),
                            ),
                            Text(
                              priceText,
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                                color: AppColors.brandRed,
                              ),
                            ),
                            const SizedBox(width: 8),
                            _FavoriteCarDetailsButton(
                              car: car,
                              onToggle: (value) =>
                                  _toggleFavorite(context, value),
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
                            if (car.condition.isNotEmpty)
                              _InfoChip(
                                label: _carDetailOptionLabel(
                                  l10n,
                                  car.condition,
                                ),
                                icon: Icons.verified_outlined,
                              ),
                            if (car.bodyType.isNotEmpty)
                              _InfoChip(
                                label: _carDetailOptionLabel(
                                  l10n,
                                  car.bodyType,
                                ),
                                icon: Icons.category_outlined,
                              ),
                            if (car.transmission.isNotEmpty)
                              _InfoChip(
                                label: _carDetailOptionLabel(
                                  l10n,
                                  car.transmission,
                                ),
                                icon: Icons.settings_suggest_outlined,
                              ),
                            if (car.fuelType.isNotEmpty)
                              _InfoChip(
                                label: _carDetailOptionLabel(
                                  l10n,
                                  car.fuelType,
                                ),
                                icon: Icons.local_gas_station_outlined,
                              ),
                            if (car.locationLabel.isNotEmpty)
                              _InfoChip(
                                label: car.locationLabel,
                                icon: Icons.location_on_outlined,
                              ),
                            if (car.isNegotiable)
                              _InfoChip(
                                label: l10n.priceNegotiable,
                                icon: Icons.handshake_outlined,
                              ),
                            if (car.status.isNotEmpty)
                              _InfoChip(
                                label: l10n.statusLabel,
                                value: statusText,
                                icon: Icons.info_outline,
                              ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        _RebuiltTitleDisclosure(
                          isRebuiltTitle: car.isRebuiltTitle,
                        ),
                        const SizedBox(height: 20),
                        Text(
                          l10n.carDescription,
                          style: const TextStyle(
                            fontSize: 17,
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
                            fontSize: 17,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 8),
                        if (allFeatures.isEmpty)
                          Text(
                            l10n.noFeaturesAvailable,
                            style: TextStyle(color: Colors.grey.shade600),
                          )
                        else
                          Column(
                            children: allFeatures.map((feature) {
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
                                        _carDetailOptionLabel(l10n, feature),
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
                        if (car.locationLabel.isNotEmpty) ...[
                          const SizedBox(height: 14),
                          _BusinessLocationCard(
                            l10n: l10n,
                            businessName: car.businessName,
                            location: car.locationLabel,
                          ),
                        ],
                        const SizedBox(height: 30),
                        if (user == null)
                          _ReservationActionArea(
                            l10n: l10n,
                            canReserve: canReserve,
                            activeViewing: null,
                            onReserve: () => _showReservationSheet(context),
                          )
                        else
                          StreamBuilder<List<CarPurchase>>(
                            stream: CarPurchaseService()
                                .activeViewingReservationsForUser(user.uid),
                            builder: (context, snapshot) {
                              CarPurchase? activeViewing;
                              for (final reservation
                                  in snapshot.data ?? const <CarPurchase>[]) {
                                if (reservation.carId == car.id) {
                                  activeViewing = reservation;
                                  break;
                                }
                              }
                              return _ReservationActionArea(
                                l10n: l10n,
                                canReserve: canReserve,
                                activeViewing: activeViewing,
                                onReserve: () => _showReservationSheet(
                                  context,
                                  knownActiveViewing: activeViewing,
                                ),
                              );
                            },
                          ),
                        const SizedBox(height: 12),
                        SizedBox(
                          width: double.infinity,
                          height: 56,
                          child: OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              foregroundColor: AppColors.cobaltDeep,
                              side: BorderSide(
                                color: AppColors.cobaltDeep.withValues(
                                  alpha: 0.55,
                                ),
                                width: 1.4,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            onPressed: canPurchase
                                ? () => _showDepositSheet(context)
                                : null,
                            icon: const Icon(
                              Icons.lock_clock_outlined,
                              size: 24,
                            ),
                            label: Text(
                              l10n.reserveWithPaidHold,
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
                            onPressed: canPurchase
                                ? () => _showPurchaseSheet(context, priceText)
                                : null,
                            icon: const Icon(Icons.shopping_bag, size: 24),
                            label: Text(
                              l10n.purchaseThisCar,
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

  Future<bool> _ensureCustomerAccount(
    BuildContext context, {
    required String title,
    required String message,
  }) async {
    if (context.read<AuthProvider>().isAuthenticated) return true;
    final route = await showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      builder: (context) {
        final l10n = AppLocalizations.of(context)!;
        return Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: AppColors.brandRed.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: const Icon(
                  Icons.person_outline,
                  color: AppColors.brandRed,
                ),
              ),
              const SizedBox(height: 18),
              Text(title, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              Text(message, style: Theme.of(context).textTheme.bodyMedium),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () => Navigator.pop(context, '/login'),
                  icon: const Icon(Icons.login),
                  label: Text(l10n.signIn),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => Navigator.pop(context, '/signup'),
                  icon: const Icon(Icons.person_add_outlined),
                  label: Text(l10n.createAccount),
                ),
              ),
            ],
          ),
        );
      },
    );
    if (route == null || !context.mounted) return false;
    final result = await Navigator.pushNamed(
      context,
      route,
      arguments: const {'returnToPrevious': true},
    );
    if (!context.mounted) return false;
    return result == true && context.read<AuthProvider>().isAuthenticated;
  }

  Future<void> _toggleFavorite(BuildContext context, bool value) async {
    final l10n = AppLocalizations.of(context)!;
    final ready = await _ensureCustomerAccount(
      context,
      title: l10n.accountRequiredTitle,
      message: l10n.accountOptionalMessage,
    );
    if (!ready || !context.mounted) return;
    try {
      await FavoriteCarsService().setFavorite(car, value);
    } catch (error) {
      if (context.mounted) showErrorSnackBar(context, '$error');
    }
  }

  Future<void> _showReservationSheet(
    BuildContext context, {
    CarPurchase? knownActiveViewing,
  }) async {
    final l10n = AppLocalizations.of(context)!;
    final isReady = await _ensureCustomerAccount(
      context,
      title: l10n.accountRequiredTitle,
      message: l10n.accountRequiredReserveMessage,
    );
    if (!isReady || !context.mounted) return;

    final authProvider = context.read<AuthProvider>();
    final user = authProvider.user;
    if (user == null) return;
    final existingViewing =
        knownActiveViewing ??
        await CarPurchaseService().activeViewingReservationForCar(
          buyerUid: user.uid,
          carId: car.id,
        );
    if (!context.mounted) return;
    if (existingViewing != null) {
      await _showExistingViewingSheet(context, existingViewing);
      return;
    }

    final buyerName = authProvider.buyerName;
    final profilePhone = authProvider.customerPhone?.trim() ?? '';
    final buyerPhoneController = TextEditingController(text: profilePhone);
    final needsPhone = profilePhone.isEmpty;
    final slots = _ViewingSlot.available();
    _ViewingSlot? selectedSlot;
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
                              l10n.reserveViewing,
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
                        l10n.reserveViewingSummary,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      const SizedBox(height: 20),
                      _AccountSummary(name: buyerName, phone: profilePhone),
                      if (needsPhone) ...[
                        const SizedBox(height: 16),
                        TextFormField(
                          controller: buyerPhoneController,
                          decoration: InputDecoration(
                            labelText: l10n.customerPhone,
                          ),
                          keyboardType: TextInputType.phone,
                          inputFormatters:
                              PhoneNumberValidator.allowedInputFormatters,
                          validator: (value) => PhoneNumberValidator.validate(
                            value,
                            requiredMessage: l10n.requiredField,
                          ),
                        ),
                      ],
                      if (car.locationLabel.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        _SheetInfoPanel(
                          icon: Icons.place_outlined,
                          title: l10n.viewingLocation,
                          message: '${car.businessName}\n${car.locationLabel}',
                        ),
                      ],
                      const SizedBox(height: 20),
                      Text(
                        l10n.selectViewingTime,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: slots.map((slot) {
                          final isSelected = selectedSlot == slot;
                          return ChoiceChip(
                            selected: isSelected,
                            avatar: Icon(
                              Icons.schedule,
                              size: 18,
                              color: isSelected
                                  ? Colors.white
                                  : AppColors.brandRed,
                            ),
                            label: Text(slot.label),
                            selectedColor: AppColors.brandRed,
                            labelStyle: TextStyle(
                              color: isSelected
                                  ? Colors.white
                                  : AppColors.lightOnSurface,
                              fontWeight: FontWeight.w600,
                            ),
                            onSelected: isSubmitting
                                ? null
                                : (_) {
                                    setModalState(() => selectedSlot = slot);
                                  },
                          );
                        }).toList(),
                      ),
                      if (selectedSlot == null) ...[
                        const SizedBox(height: 8),
                        Text(
                          l10n.selectViewingTimeRequired,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                            fontSize: 12,
                          ),
                        ),
                      ],
                      const SizedBox(height: 24),
                      SizedBox(
                        width: double.infinity,
                        height: 52,
                        child: ElevatedButton(
                          onPressed: isSubmitting
                              ? null
                              : () async {
                                  if (!formKey.currentState!.validate() ||
                                      selectedSlot == null) {
                                    return;
                                  }
                                  final confirmed = await confirmMajorAction(
                                    context,
                                    title: l10n.reserveViewingQuestion,
                                    message: l10n.reserveViewingConfirmMessage,
                                    confirmLabel: l10n.reserveViewing,
                                    icon: Icons.event_available_outlined,
                                  );
                                  if (!confirmed || !context.mounted) return;
                                  setModalState(() => isSubmitting = true);
                                  try {
                                    if (needsPhone) {
                                      authProvider
                                          .updateCustomerPhone(
                                            buyerPhoneController.text.trim(),
                                          )
                                          .catchError((error) {
                                            debugPrint(
                                              'Could not save customer phone: $error',
                                            );
                                          });
                                    }
                                    await CarPurchaseService().reserveViewing(
                                      car: car,
                                      buyerName: buyerName,
                                      buyerPhone: buyerPhoneController.text
                                          .trim(),
                                      appointmentStart: selectedSlot!.start,
                                      appointmentLabel: selectedSlot!.label,
                                    );
                                    if (!context.mounted) return;
                                    Navigator.pop(context);
                                    showSuccessSnackBar(
                                      context,
                                      l10n.viewingReservationComplete(
                                        selectedSlot!.label,
                                      ),
                                    );
                                  } catch (e) {
                                    if (!context.mounted) return;
                                    showErrorSnackBar(
                                      context,
                                      _checkoutError(l10n, e),
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
                              : Text(l10n.confirmViewingReservation),
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

    buyerPhoneController.dispose();
  }

  Future<void> _showExistingViewingSheet(
    BuildContext context,
    CarPurchase reservation,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    var isSubmitting = false;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final appointment = reservation.appointmentStart;
            final label =
                reservation.appointmentLabel ??
                (appointment == null
                    ? l10n.viewingScheduled
                    : DateFormat.yMMMd().add_jm().format(appointment));
            return Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.of(context).viewInsets.bottom,
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 48,
                          height: 48,
                          decoration: BoxDecoration(
                            color: AppColors.brandRed.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const Icon(
                            Icons.event_available_outlined,
                            color: AppColors.brandRed,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            l10n.youHaveViewingReserved,
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
                    const SizedBox(height: 14),
                    _SheetInfoPanel(
                      icon: Icons.schedule_outlined,
                      title: l10n.currentViewingTime,
                      message: label,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      l10n.changeOrCancelViewingToBookNew,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: AppColors.lightMuted,
                        height: 1.35,
                      ),
                    ),
                    const SizedBox(height: 22),
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: FilledButton.icon(
                        onPressed:
                            isSubmitting ||
                                !reservation.canEditViewingReservation
                            ? null
                            : () async {
                                Navigator.pop(context);
                                await _showEditViewingSheet(
                                  context,
                                  reservation,
                                );
                              },
                        icon: const Icon(Icons.event_repeat_outlined),
                        label: Text(l10n.editViewingReservation),
                      ),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.errorRed,
                          side: const BorderSide(color: AppColors.errorRed),
                        ),
                        onPressed: isSubmitting
                            ? null
                            : () async {
                                final confirmed = await confirmMajorAction(
                                  context,
                                  title: l10n.cancelViewingQuestion,
                                  message: l10n.cancelViewingConfirmMessage,
                                  confirmLabel: l10n.cancelViewingReservation,
                                  icon: Icons.event_busy_outlined,
                                  destructive: true,
                                );
                                if (!confirmed || !context.mounted) return;
                                setModalState(() => isSubmitting = true);
                                try {
                                  await CarPurchaseService()
                                      .cancelViewingReservation(
                                        purchaseId: reservation.id,
                                      );
                                  if (!context.mounted) return;
                                  Navigator.pop(context);
                                  showSuccessSnackBar(
                                    context,
                                    l10n.viewingReservationCancelled,
                                  );
                                } catch (error) {
                                  if (!context.mounted) return;
                                  showErrorSnackBar(
                                    context,
                                    l10n.operationFailed('$error'),
                                  );
                                  setModalState(() => isSubmitting = false);
                                }
                              },
                        icon: isSubmitting
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.event_busy_outlined),
                        label: Text(l10n.cancelViewingReservation),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _showEditViewingSheet(
    BuildContext context,
    CarPurchase reservation,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    final slots = _ViewingSlot.available();
    _ViewingSlot? selectedSlot;
    var isSubmitting = false;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.of(context).viewInsets.bottom,
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            l10n.editViewingReservation,
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
                      l10n.viewingEditCutoff,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: AppColors.lightMuted,
                        height: 1.35,
                      ),
                    ),
                    const SizedBox(height: 18),
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: slots.map((slot) {
                        final isSelected = selectedSlot == slot;
                        return ChoiceChip(
                          selected: isSelected,
                          avatar: Icon(
                            Icons.schedule,
                            size: 18,
                            color: isSelected
                                ? Colors.white
                                : AppColors.brandRed,
                          ),
                          label: Text(slot.label),
                          selectedColor: AppColors.brandRed,
                          labelStyle: TextStyle(
                            color: isSelected
                                ? Colors.white
                                : AppColors.lightOnSurface,
                            fontWeight: FontWeight.w700,
                          ),
                          onSelected: isSubmitting
                              ? null
                              : (_) => setModalState(() => selectedSlot = slot),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 22),
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: FilledButton.icon(
                        onPressed: isSubmitting
                            ? null
                            : () async {
                                final slot = selectedSlot;
                                if (slot == null) return;
                                setModalState(() => isSubmitting = true);
                                try {
                                  await CarPurchaseService()
                                      .updateViewingReservation(
                                        purchaseId: reservation.id,
                                        appointmentStart: slot.start,
                                        appointmentLabel: slot.label,
                                      );
                                  if (!context.mounted) return;
                                  Navigator.pop(context);
                                  showSuccessSnackBar(
                                    context,
                                    l10n.viewingReservationUpdated,
                                  );
                                } catch (error) {
                                  if (!context.mounted) return;
                                  showErrorSnackBar(
                                    context,
                                    l10n.operationFailed('$error'),
                                  );
                                  setModalState(() => isSubmitting = false);
                                }
                              },
                        icon: isSubmitting
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.event_repeat_outlined),
                        label: Text(l10n.changeViewingTime),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _showDepositSheet(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    final isReady = await _ensureCustomerAccount(
      context,
      title: l10n.accountRequiredTitle,
      message: l10n.loginRequiredForDeposit,
    );
    if (!isReady || !context.mounted) return;

    final authProvider = context.read<AuthProvider>();
    final buyerName = authProvider.buyerName;
    final profilePhone = authProvider.customerPhone?.trim() ?? '';
    final buyerPhoneController = TextEditingController(text: profilePhone);
    final needsPhone = profilePhone.isEmpty;
    final holdPricing = await _loadHoldPricing();
    if (!context.mounted) return;
    DateTime selectedHoldUntil = _dateOnly(
      DateTime.now().add(const Duration(days: 1)),
    );
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
            final holdQuote = holdPricing.quote(selectedHoldUntil);
            final depositText = _currency.format(holdQuote.amount);
            final latestHoldDate = _dateOnly(
              DateTime.now().add(Duration(days: holdPricing.maxDays)),
            );
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
                              l10n.reserveWithPaidHold,
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
                        l10n.depositSummary(depositText),
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      const SizedBox(height: 16),
                      _SheetInfoPanel(
                        icon: Icons.lock_clock_outlined,
                        title: l10n.reserveCarHoldTitle,
                        message: l10n.reserveCarHoldMessage,
                      ),
                      const SizedBox(height: 12),
                      const _SheetInfoPanel(
                        icon: Icons.privacy_tip_outlined,
                        title: 'No-show history',
                        message:
                            'If you do not return by the hold date and the '
                            'business marks that you did not come, the deposit '
                            'may be forfeited and this outcome may be visible '
                            'to car-selling businesses.',
                      ),
                      const SizedBox(height: 12),
                      _SheetInfoPanel(
                        icon: Icons.event_busy_outlined,
                        title: 'Hold until',
                        message:
                            '${DateFormat.yMMMd().format(selectedHoldUntil)}\n'
                            '${holdQuote.description}',
                      ),
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: isSubmitting
                              ? null
                              : () async {
                                  final picked = await showDatePicker(
                                    context: context,
                                    initialDate: selectedHoldUntil,
                                    firstDate: _dateOnly(
                                      DateTime.now().add(
                                        const Duration(days: 1),
                                      ),
                                    ),
                                    lastDate: latestHoldDate,
                                  );
                                  if (picked == null) return;
                                  setModalState(() {
                                    selectedHoldUntil = _dateOnly(picked);
                                  });
                                },
                          icon: const Icon(Icons.calendar_month_outlined),
                          label: Text(l10n.chooseReturnDate),
                        ),
                      ),
                      if (car.locationLabel.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        _SheetInfoPanel(
                          icon: Icons.storefront_outlined,
                          title: l10n.businessLocation,
                          message: '${car.businessName}\n${car.locationLabel}',
                        ),
                      ],
                      const SizedBox(height: 20),
                      _AccountSummary(name: buyerName, phone: profilePhone),
                      if (needsPhone) ...[
                        const SizedBox(height: 16),
                        TextFormField(
                          controller: buyerPhoneController,
                          decoration: InputDecoration(
                            labelText: l10n.customerPhone,
                          ),
                          keyboardType: TextInputType.phone,
                          inputFormatters:
                              PhoneNumberValidator.allowedInputFormatters,
                          validator: (value) => PhoneNumberValidator.validate(
                            value,
                            requiredMessage: l10n.requiredField,
                          ),
                        ),
                      ],
                      const SizedBox(height: 24),
                      SizedBox(
                        width: double.infinity,
                        height: 52,
                        child: ElevatedButton(
                          onPressed: isSubmitting
                              ? null
                              : () async {
                                  if (!formKey.currentState!.validate()) return;
                                  final confirmed = await confirmMajorAction(
                                    context,
                                    title: l10n.reserveCarQuestion,
                                    message: l10n.reserveCarConfirmMessage(
                                      depositText,
                                    ),
                                    confirmLabel: l10n.continueToPayment,
                                    icon: Icons.payments_outlined,
                                  );
                                  if (!confirmed || !context.mounted) return;
                                  setModalState(() => isSubmitting = true);
                                  try {
                                    if (needsPhone) {
                                      authProvider
                                          .updateCustomerPhone(
                                            buyerPhoneController.text.trim(),
                                          )
                                          .catchError((error) {
                                            debugPrint(
                                              'Could not save customer phone: $error',
                                            );
                                          });
                                    }
                                    await CarPurchaseService()
                                        .reserveWithDeposit(
                                          car: car,
                                          buyerName: buyerName,
                                          buyerPhone: buyerPhoneController.text
                                              .trim(),
                                          holdUntilDate: selectedHoldUntil,
                                        );
                                    if (!context.mounted) return;
                                    Navigator.pop(context);
                                    showSuccessSnackBar(
                                      context,
                                      l10n.reservationComplete,
                                    );
                                  } catch (e) {
                                    if (!context.mounted) return;
                                    showErrorSnackBar(
                                      context,
                                      _checkoutError(l10n, e),
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
                              : Text(l10n.continueToPayment),
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

    buyerPhoneController.dispose();
  }

  Future<void> _showPurchaseSheet(
    BuildContext context,
    String formattedPrice,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    final isReady = await _ensureCustomerAccount(
      context,
      title: l10n.accountRequiredTitle,
      message: l10n.accountRequiredPurchaseMessage,
    );
    if (!isReady || !context.mounted) return;

    final authProvider = context.read<AuthProvider>();
    final buyerName = authProvider.buyerName;
    final profilePhone = authProvider.customerPhone?.trim() ?? '';
    final buyerPhoneController = TextEditingController(text: profilePhone);
    final needsPhone = profilePhone.isEmpty;
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
                              l10n.purchaseThisCar,
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
                        l10n.purchaseSummary(formattedPrice),
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      const SizedBox(height: 16),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: AppColors.chrome.withValues(alpha: 0.55),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                            color: AppColors.brandRed.withValues(alpha: 0.18),
                          ),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 44,
                              height: 44,
                              decoration: BoxDecoration(
                                color: AppColors.brandRed.withValues(
                                  alpha: 0.12,
                                ),
                                borderRadius: BorderRadius.circular(14),
                              ),
                              child: const Icon(
                                Icons.verified_user_outlined,
                                color: AppColors.brandRed,
                              ),
                            ),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Text(
                                l10n.secureStripeCheckout,
                                style: Theme.of(context).textTheme.bodyMedium
                                    ?.copyWith(fontWeight: FontWeight.w600),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),
                      _AccountSummary(name: buyerName, phone: profilePhone),
                      if (needsPhone) ...[
                        const SizedBox(height: 16),
                        TextFormField(
                          controller: buyerPhoneController,
                          decoration: InputDecoration(
                            labelText: l10n.customerPhone,
                          ),
                          keyboardType: TextInputType.phone,
                          inputFormatters:
                              PhoneNumberValidator.allowedInputFormatters,
                          validator: (value) => PhoneNumberValidator.validate(
                            value,
                            requiredMessage: l10n.requiredField,
                          ),
                        ),
                      ],
                      if (car.locationLabel.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        _SheetInfoPanel(
                          icon: Icons.storefront_outlined,
                          title: l10n.businessLocation,
                          message: '${car.businessName}\n${car.locationLabel}',
                        ),
                      ],
                      const SizedBox(height: 24),
                      SizedBox(
                        width: double.infinity,
                        height: 52,
                        child: ElevatedButton(
                          onPressed: isSubmitting
                              ? null
                              : () async {
                                  if (!formKey.currentState!.validate()) {
                                    return;
                                  }
                                  final confirmed = await confirmMajorAction(
                                    context,
                                    title: l10n.purchaseCarQuestion,
                                    message: l10n.purchaseCarConfirmMessage,
                                    confirmLabel: l10n.continueToPayment,
                                    icon: Icons.payments_outlined,
                                  );
                                  if (!confirmed || !context.mounted) return;
                                  setModalState(() => isSubmitting = true);
                                  try {
                                    if (needsPhone) {
                                      authProvider
                                          .updateCustomerPhone(
                                            buyerPhoneController.text.trim(),
                                          )
                                          .catchError((error) {
                                            debugPrint(
                                              'Could not save customer phone: $error',
                                            );
                                          });
                                    }
                                    await CarPurchaseService().purchaseCar(
                                      car: car,
                                      buyerName: buyerName,
                                      buyerPhone: buyerPhoneController.text
                                          .trim(),
                                    );
                                    if (!context.mounted) return;
                                    Navigator.pop(context);
                                    showSuccessSnackBar(
                                      context,
                                      l10n.purchaseComplete,
                                    );
                                  } catch (e) {
                                    if (!context.mounted) return;
                                    showErrorSnackBar(
                                      context,
                                      _checkoutError(l10n, e),
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
                              : Text(l10n.payNow),
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

  String _checkoutError(AppLocalizations l10n, Object error) {
    final value = error.toString().toLowerCase();
    if (value.contains('permission-denied') ||
        value.contains('permission denied')) {
      return l10n.checkoutUnavailable;
    }
    if (value.contains('already-exists')) {
      return l10n.carAlreadyReserved;
    }
    if (value.contains('failed-precondition')) {
      return l10n.carNoLongerAvailable;
    }
    return l10n.checkoutUnavailable;
  }

  DateTime _dateOnly(DateTime value) {
    return DateTime(value.year, value.month, value.day);
  }

  Future<_ResolvedHoldPricing> _loadHoldPricing() async {
    final businessDoc = await FirebaseFirestore.instance
        .collection('businesses')
        .doc(car.businessId)
        .get();
    final business = businessDoc.data() ?? const <String, dynamic>{};
    return _ResolvedHoldPricing.from(car: car, business: business);
  }
}

class _HoldQuote {
  const _HoldQuote({required this.amount, required this.description});

  final double amount;
  final String description;
}

class _ResolvedHoldPricing {
  const _ResolvedHoldPricing({
    required this.mode,
    required this.flatFee,
    required this.dailyRate,
    required this.maxDays,
  });

  final String mode;
  final double flatFee;
  final double dailyRate;
  final int maxDays;

  factory _ResolvedHoldPricing.from({
    required Car car,
    required Map<String, dynamic> business,
  }) {
    final useBusiness = car.useBusinessHoldPricing;
    final mode = useBusiness
        ? (business['carHoldPricingMode'] ?? 'flat').toString()
        : (car.carHoldPricingMode.isEmpty ? 'flat' : car.carHoldPricingMode);
    final flatFee = useBusiness
        ? _number(business['carHoldFlatFee'], 500)
        : (car.carHoldFlatFee ?? 500);
    final dailyRate = useBusiness
        ? _number(business['carHoldDailyRate'], 100)
        : (car.carHoldDailyRate ?? 100);
    final maxDays =
        (useBusiness
                ? _intValue(business['carHoldMaxDays'], 14)
                : (car.carHoldMaxDays ?? 14))
            .clamp(1, 30);
    return _ResolvedHoldPricing(
      mode: mode == 'per_day' ? 'per_day' : 'flat',
      flatFee: flatFee > 0 ? flatFee : 500,
      dailyRate: dailyRate > 0 ? dailyRate : 100,
      maxDays: maxDays,
    );
  }

  _HoldQuote quote(DateTime holdUntilDate) {
    final today = DateTime.now();
    final todayOnly = DateTime(today.year, today.month, today.day);
    final holdOnly = DateTime(
      holdUntilDate.year,
      holdUntilDate.month,
      holdUntilDate.day,
    );
    final days = holdOnly.difference(todayOnly).inDays.clamp(1, maxDays);
    if (mode == 'per_day') {
      return _HoldQuote(
        amount: dailyRate * days,
        description:
            '$days day hold at ${NumberFormat.simpleCurrency().format(dailyRate)} per day',
      );
    }
    return _HoldQuote(
      amount: flatFee,
      description: 'Flat hold fee for up to $maxDays days',
    );
  }

  static double _number(dynamic value, double fallback) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? fallback;
    return fallback;
  }

  static int _intValue(dynamic value, int fallback) {
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value) ?? fallback;
    return fallback;
  }
}

class _ReservationActionArea extends StatelessWidget {
  const _ReservationActionArea({
    required this.l10n,
    required this.canReserve,
    required this.activeViewing,
    required this.onReserve,
  });

  final AppLocalizations l10n;
  final bool canReserve;
  final CarPurchase? activeViewing;
  final VoidCallback onReserve;

  @override
  Widget build(BuildContext context) {
    final viewing = activeViewing;
    final appointment = viewing?.appointmentStart;
    final label =
        viewing?.appointmentLabel ??
        (appointment == null
            ? l10n.viewingScheduled
            : DateFormat.yMMMd().add_jm().format(appointment));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (viewing != null) ...[
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.brandRed.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: AppColors.brandRed.withValues(alpha: 0.2),
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(
                    Icons.event_available_outlined,
                    color: AppColors.brandRed,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.youHaveViewingReserved,
                        style: const TextStyle(
                          color: AppColors.brandRed,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        label,
                        style: const TextStyle(
                          color: AppColors.lightOnSurface,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
        ],
        SizedBox(
          width: double.infinity,
          height: 56,
          child: OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.brandRed,
              side: const BorderSide(color: AppColors.brandRed, width: 1.4),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            onPressed: canReserve ? onReserve : null,
            icon: Icon(
              viewing == null
                  ? Icons.event_available
                  : Icons.event_repeat_outlined,
              size: 24,
            ),
            label: Text(
              viewing == null
                  ? l10n.reserveViewing
                  : l10n.editViewingReservation,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
          ),
        ),
      ],
    );
  }
}

class _AccountSummary extends StatelessWidget {
  const _AccountSummary({required this.name, required this.phone});

  final String name;
  final String phone;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.lightSurfaceVariant,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.lightOutline),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: AppColors.brandRed.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(Icons.person, color: AppColors.brandRed),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: Theme.of(
                    context,
                  ).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 2),
                Text(
                  phone.isEmpty ? l10n.phoneRequiredForReservation : phone,
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: AppColors.lightMuted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SheetInfoPanel extends StatelessWidget {
  const _SheetInfoPanel({
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: AppColors.cobaltDeep.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, color: AppColors.cobaltDeep),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  message,
                  style: const TextStyle(
                    color: AppColors.lightMuted,
                    height: 1.35,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BusinessLocationCard extends StatelessWidget {
  const _BusinessLocationCard({
    required this.l10n,
    required this.businessName,
    required this.location,
  });

  final AppLocalizations l10n;
  final String businessName;
  final String location;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 14,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: AppColors.brandRed.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(
              Icons.storefront_outlined,
              color: AppColors.brandRed,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.businessLocation,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  businessName,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 2),
                Text(
                  location,
                  style: const TextStyle(
                    color: AppColors.lightMuted,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ViewingSlot {
  const _ViewingSlot({required this.start, required this.label});

  final DateTime start;
  final String label;

  static List<_ViewingSlot> available() {
    final now = DateTime.now();
    final earliest = now.add(const Duration(hours: 2));
    final dateFormat = DateFormat('EEE, MMM d');
    final timeFormat = DateFormat.jm();
    final slots = <_ViewingSlot>[];
    var day = DateTime(now.year, now.month, now.day);

    while (slots.length < 8) {
      day = day.add(const Duration(days: 1));
      if (day.weekday == DateTime.sunday) continue;
      for (final hour in const [10, 12, 14, 16]) {
        final start = DateTime(day.year, day.month, day.day, hour);
        if (start.isBefore(earliest)) continue;
        slots.add(
          _ViewingSlot(
            start: start,
            label: '${dateFormat.format(start)} - ${timeFormat.format(start)}',
          ),
        );
        if (slots.length == 8) break;
      }
    }
    return slots;
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

class _FavoriteCarDetailsButton extends StatelessWidget {
  const _FavoriteCarDetailsButton({required this.car, required this.onToggle});

  final Car car;
  final ValueChanged<bool> onToggle;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<Set<String>>(
      stream: FavoriteCarsService().favoriteIdsStream(),
      builder: (context, snapshot) {
        final isFavorite = (snapshot.data ?? const <String>{}).contains(car.id);
        return SizedBox(
          width: 38,
          height: 38,
          child: IconButton.filledTonal(
            padding: EdgeInsets.zero,
            visualDensity: VisualDensity.compact,
            onPressed: () => onToggle(!isFavorite),
            icon: Icon(
              isFavorite ? Icons.favorite : Icons.favorite_border,
              color: isFavorite ? AppColors.brandRed : AppColors.cobaltDeep,
              size: 20,
            ),
          ),
        );
      },
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

class _RebuiltTitleDisclosure extends StatelessWidget {
  const _RebuiltTitleDisclosure({required this.isRebuiltTitle});

  final bool? isRebuiltTitle;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final isRebuilt = isRebuiltTitle == true;
    final isUnknown = isRebuiltTitle == null;
    final color = isRebuilt
        ? AppColors.brandRed
        : isUnknown
        ? AppColors.warn
        : AppColors.sage;
    final value = isRebuilt
        ? l10n.rebuiltTitleYes
        : isUnknown
        ? l10n.rebuiltTitleUnknown
        : l10n.rebuiltTitleNo;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        border: Border.all(color: color.withValues(alpha: 0.45)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(
            isRebuilt
                ? Icons.report_outlined
                : isUnknown
                ? Icons.help_outline
                : Icons.verified_outlined,
            color: color,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.rebuiltTitle,
                  style: TextStyle(color: color, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ],
            ),
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
