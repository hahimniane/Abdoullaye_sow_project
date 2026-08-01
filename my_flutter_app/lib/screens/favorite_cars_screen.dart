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

class FavoriteCarsScreen extends StatefulWidget {
  const FavoriteCarsScreen({super.key});

  @override
  State<FavoriteCarsScreen> createState() => _FavoriteCarsScreenState();
}

class _FavoriteCarsScreenState extends State<FavoriteCarsScreen> {
  final FavoriteCarsService _service = FavoriteCarsService();

  /// Live cars behind the saved favourites, keyed by car id.
  ///
  /// The favourite document is a snapshot taken the moment the car was saved,
  /// so anything added to the listing afterwards - photos, a price, a title -
  /// never reaches it. A car saved before its listing was finished therefore
  /// renders as a blank card forever. These live reads are layered over the
  /// snapshot so the card shows the car as it is now.
  Map<String, Car> _cars = const {};

  /// The id set `_cars` was loaded for, so a stream tick that changes nothing
  /// does not trigger another round of reads.
  String _loadedFor = '';
  bool _loading = false;

  Future<void> _hydrate(List<String> carIds) async {
    final key = (carIds.toList()..sort()).join(',');
    if (_loading || key == _loadedFor) return;
    _loading = true;
    try {
      final cars = await _service.loadCars(carIds);
      if (!mounted) return;
      setState(() {
        _cars = cars;
        _loadedFor = key;
      });
    } catch (_) {
      // The saved snapshot still renders, so a failed refresh degrades to
      // stale data rather than an empty screen.
      if (mounted) setState(() => _loadedFor = key);
    } finally {
      _loading = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final service = _service;
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
          // Refresh once per distinct id set, after this frame so the list
          // paints from the saved snapshot immediately rather than waiting.
          final ids = favorites.map((favorite) => favorite.carId).toList();
          WidgetsBinding.instance.addPostFrameCallback((_) => _hydrate(ids));

          return ListView.separated(
            padding: const EdgeInsets.all(20),
            itemCount: favorites.length,
            separatorBuilder: (_, _) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final saved = favorites[index];
              final favorite = mergeFavoriteWithLiveCar(
                saved,
                _cars[saved.carId],
              );
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
    final l10n = AppLocalizations.of(context)!;
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
                      ? const _CarThumbPlaceholder()
                      : Image.network(
                          favorite.imageUrl,
                          fit: BoxFit.cover,
                          // A listing whose photo has since been removed or
                          // whose URL expired must not render as a broken
                          // image glyph - fall back to the same placeholder an
                          // image-less car gets.
                          errorBuilder: (_, _, _) =>
                              const _CarThumbPlaceholder(),
                          loadingBuilder: (context, child, progress) =>
                              progress == null
                              ? child
                              : const _CarThumbPlaceholder(),
                        ),
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
                    const SizedBox(height: 4),
                    Text(
                      favorite.isRebuiltTitle == true
                          ? l10n.rebuiltTitleYes
                          : favorite.isRebuiltTitle == null
                          ? '${l10n.rebuiltTitle}: ${l10n.rebuiltTitleUnknown}'
                          : l10n.rebuiltTitleNo,
                      style: TextStyle(
                        color: favorite.isRebuiltTitle == false
                            ? AppColors.sage
                            : AppColors.warn,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
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

class _CarThumbPlaceholder extends StatelessWidget {
  const _CarThumbPlaceholder();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: AppColors.lightSurfaceVariant,
      alignment: Alignment.center,
      child: const Icon(
        Icons.directions_car_outlined,
        color: AppColors.lightMuted,
      ),
    );
  }
}
