import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/car.dart';

class FavoriteCarSnapshot {
  const FavoriteCarSnapshot({
    required this.carId,
    required this.title,
    required this.make,
    required this.model,
    required this.year,
    required this.price,
    required this.imageUrl,
    required this.isRebuiltTitle,
    required this.createdAt,
  });

  final String carId;
  final String title;
  final String make;
  final String model;
  final String year;
  final double price;
  final String imageUrl;
  final bool? isRebuiltTitle;
  final DateTime? createdAt;

  factory FavoriteCarSnapshot.fromDoc(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return FavoriteCarSnapshot(
      carId: (data['carId'] ?? doc.id).toString(),
      title: (data['title'] ?? '').toString(),
      make: (data['make'] ?? '').toString(),
      model: (data['model'] ?? '').toString(),
      year: (data['year'] ?? '').toString(),
      price: (data['price'] is num) ? (data['price'] as num).toDouble() : 0,
      imageUrl: (data['imageUrl'] ?? '').toString(),
      isRebuiltTitle: data['isRebuiltTitle'] is bool
          ? data['isRebuiltTitle'] as bool
          : null,
      createdAt: data['createdAt'] is Timestamp
          ? (data['createdAt'] as Timestamp).toDate()
          : null,
    );
  }
}

class FavoriteCarsService {
  FavoriteCarsService({FirebaseFirestore? firestore, FirebaseAuth? auth})
    : _firestore = firestore ?? FirebaseFirestore.instance,
      _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;

  String? get currentUserId => _auth.currentUser?.uid;

  CollectionReference<Map<String, dynamic>> _favoritesRef(String uid) {
    return _firestore.collection('users').doc(uid).collection('favoriteCars');
  }

  Stream<Set<String>> favoriteIdsStream() {
    final uid = currentUserId;
    if (uid == null) return Stream.value(<String>{});
    return _favoritesRef(
      uid,
    ).snapshots().map((snapshot) => snapshot.docs.map((doc) => doc.id).toSet());
  }

  Stream<List<FavoriteCarSnapshot>> favoritesStream() {
    final uid = currentUserId;
    if (uid == null) return Stream.value(const <FavoriteCarSnapshot>[]);
    return _favoritesRef(uid)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map(
          (snapshot) => snapshot.docs.map(FavoriteCarSnapshot.fromDoc).toList(),
        );
  }

  Future<bool> isFavorite(String carId) async {
    final uid = currentUserId;
    if (uid == null) return false;
    final doc = await _favoritesRef(uid).doc(carId).get();
    return doc.exists;
  }

  Future<void> setFavorite(Car car, bool favorite) async {
    final uid = currentUserId;
    if (uid == null) {
      throw StateError('Sign in to save favorite cars.');
    }
    final ref = _favoritesRef(uid).doc(car.id);
    if (!favorite) {
      await ref.delete();
      return;
    }
    await ref.set({
      'carId': car.id,
      'title': car.title,
      'make': car.make,
      'model': car.model,
      'year': car.year,
      'price': car.price,
      'imageUrl': car.imageUrls.isNotEmpty ? car.imageUrls.first : '',
      'businessId': car.businessId,
      'businessName': car.businessName,
      'isRebuiltTitle': car.isRebuiltTitle,
      'createdAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }
}
