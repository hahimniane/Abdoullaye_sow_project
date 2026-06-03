import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/car.dart';
import '../services/favorite_cars_service.dart';
import '../theme/app_colors.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import 'car_details_screen.dart';

class FavoriteCarsScreen extends StatelessWidget {
  const FavoriteCarsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final service = FavoriteCarsService();
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: AppBar(
        leading: const AppBackButton(),
        title: Text(l10n.favoriteCars),
      ),
      body: StreamBuilder<List<FavoriteCarSnapshot>>(
        stream: service.favoritesStream(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(l10n.operationFailed('${snapshot.error}')),
              ),
            );
          }
          final favorites = snapshot.data ?? const <FavoriteCarSnapshot>[];
          if (favorites.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.favorite_border,
                      size: 46,
                      color: AppColors.brandRed,
                    ),
                    const SizedBox(height: 14),
                    Text(
                      l10n.noFavoriteCarsYet,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      l10n.favoriteCarsSubtitle,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.lightMuted),
                    ),
                  ],
                ),
              ),
            );
          }
          return ListView.separated(
            padding: const EdgeInsets.all(20),
            itemCount: favorites.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final favorite = favorites[index];
              return _FavoriteCarTile(
                favorite: favorite,
                onOpen: () => _openCar(context, favorite.carId),
                onRemove: () async {
                  final doc = await FirebaseFirestore.instance
                      .collection('cars')
                      .doc(favorite.carId)
                      .get();
                  if (doc.exists) {
                    await service.setFavorite(Car.fromFirestore(doc), false);
                  } else if (service.currentUserId != null) {
                    await FirebaseFirestore.instance
                        .collection('users')
                        .doc(service.currentUserId)
                        .collection('favoriteCars')
                        .doc(favorite.carId)
                        .delete();
                  }
                  if (context.mounted) {
                    showSuccessSnackBar(context, l10n.favoriteRemoved);
                  }
                },
              );
            },
          );
        },
      ),
    );
  }

  Future<void> _openCar(BuildContext context, String carId) async {
    final l10n = AppLocalizations.of(context)!;
    final doc = await FirebaseFirestore.instance
        .collection('cars')
        .doc(carId)
        .get();
    if (!context.mounted) return;
    if (!doc.exists) {
      showErrorSnackBar(context, l10n.carNoLongerAvailable);
      return;
    }
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => CarDetailsScreen(car: Car.fromFirestore(doc)),
      ),
    );
  }
}

class _FavoriteCarTile extends StatelessWidget {
  const _FavoriteCarTile({
    required this.favorite,
    required this.onOpen,
    required this.onRemove,
  });

  final FavoriteCarSnapshot favorite;
  final VoidCallback onOpen;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final currency = NumberFormat.simpleCurrency();
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onOpen,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: SizedBox(
                  width: 82,
                  height: 70,
                  child: favorite.imageUrl.isEmpty
                      ? Container(
                          color: AppColors.lightSurfaceVariant,
                          child: const Icon(Icons.directions_car_outlined),
                        )
                      : Image.network(favorite.imageUrl, fit: BoxFit.cover),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      favorite.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${favorite.year} ${favorite.make} ${favorite.model}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: AppColors.lightMuted),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      currency.format(favorite.price),
                      style: const TextStyle(
                        color: AppColors.brandRed,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: MaterialLocalizations.of(context).deleteButtonTooltip,
                onPressed: onRemove,
                icon: const Icon(Icons.favorite, color: AppColors.brandRed),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
