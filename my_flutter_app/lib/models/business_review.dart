import 'package:cloud_firestore/cloud_firestore.dart';

/// A customer's rating and comment for a business, tied to one completed
/// order. See businesses/{businessId}/reviews/{reviewId} in Firestore.
class BusinessReview {
  const BusinessReview({
    required this.id,
    required this.businessId,
    required this.customerDisplayName,
    required this.orderType,
    required this.rating,
    required this.comment,
    required this.createdAt,
    required this.moderationStatus,
    this.flagCount = 0,
  });

  final String id;
  final String businessId;
  final String customerDisplayName;
  final String orderType;
  final int rating;
  final String comment;
  final DateTime createdAt;
  final String moderationStatus;
  final int flagCount;

  bool get isRemoved => moderationStatus == 'removed';

  factory BusinessReview.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final d = doc.data() ?? const {};
    final createdAt = d['createdAt'];
    return BusinessReview(
      id: doc.id,
      businessId: (d['businessId'] as String?) ?? '',
      customerDisplayName: (d['customerDisplayName'] as String?) ?? 'Customer',
      orderType: (d['orderType'] as String?) ?? '',
      rating: (d['rating'] as num?)?.toInt() ?? 0,
      comment: (d['comment'] as String?) ?? '',
      createdAt: createdAt is Timestamp
          ? createdAt.toDate()
          : DateTime.fromMillisecondsSinceEpoch(0),
      moderationStatus: (d['moderationStatus'] as String?) ?? 'published',
      flagCount: (d['flagCount'] as num?)?.toInt() ?? 0,
    );
  }
}
