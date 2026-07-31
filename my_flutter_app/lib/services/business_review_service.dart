import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/business_review.dart';

class BusinessReviewService {
  BusinessReviewService({
    FirebaseFirestore? firestore,
    FirebaseFunctions? functions,
    FirebaseAuth? auth,
  }) : _firestoreOverride = firestore,
       _functionsOverride = functions,
       _authOverride = auth;

  // Resolved lazily (not in the constructor) so building a
  // BusinessReviewService never touches Firebase.instance unless one of the
  // methods below is actually invoked - lets subclasses used in widget tests
  // override methods without needing Firebase initialized.
  final FirebaseFirestore? _firestoreOverride;
  final FirebaseFunctions? _functionsOverride;
  final FirebaseAuth? _authOverride;

  FirebaseFirestore get _firestore =>
      _firestoreOverride ?? FirebaseFirestore.instance;
  FirebaseFunctions get _functions =>
      _functionsOverride ?? FirebaseFunctions.instance;
  FirebaseAuth get _auth => _authOverride ?? FirebaseAuth.instance;

  Stream<List<BusinessReview>> reviewsForBusiness(String businessId) {
    return _firestore
        .collection('businesses')
        .doc(businessId)
        .collection('reviews')
        .orderBy('createdAt', descending: true)
        .limit(200)
        .snapshots()
        .map(
          (snapshot) => snapshot.docs
              .map(BusinessReview.fromFirestore)
              .where((review) => !review.isRemoved)
              .toList(),
        );
  }

  /// The `relatedCollection_relatedId` key of every order the current user
  /// has already reviewed, so a screen listing completed orders can tell
  /// "leave a review" from "reviewed" without a per-order read.
  Stream<Set<String>> reviewedOrderKeysForCurrentUser() {
    final uid = _auth.currentUser?.uid;
    if (uid == null) return Stream.value(const <String>{});
    return _firestore
        .collectionGroup('reviews')
        .where('customerUid', isEqualTo: uid)
        .snapshots()
        .map((snapshot) => snapshot.docs.map((doc) => doc.id).toSet());
  }

  Future<void> submitReview({
    required String relatedCollection,
    required String relatedId,
    required String businessId,
    required int rating,
    required String comment,
  }) {
    return _functions.httpsCallable('submitBusinessReview').call({
      'relatedCollection': relatedCollection,
      'relatedId': relatedId,
      'businessId': businessId,
      'rating': rating,
      'comment': comment.trim(),
    });
  }

  Future<void> flagReview({
    required String businessId,
    required String reviewId,
    required String reason,
  }) {
    return _functions.httpsCallable('flagBusinessReview').call({
      'businessId': businessId,
      'reviewId': reviewId,
      'reason': reason.trim(),
    });
  }
}
