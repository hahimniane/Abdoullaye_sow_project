import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/business_review.dart';
import '../services/business_review_service.dart';
import '../theme/app_colors.dart';

/// What customers have said about this business - the console's Reviews
/// section, on the phone. Read-only: replies and flags stay server-side.
class BusinessReviewsScreen extends StatelessWidget {
  const BusinessReviewsScreen({
    super.key,
    required this.businessId,
    this.service,
  });

  final String businessId;
  final BusinessReviewService? service;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final reviews = service ?? BusinessReviewService();
    return Scaffold(
      appBar: AppBar(title: Text(l10n.businessReviewsTitle)),
      body: StreamBuilder<List<BusinessReview>>(
        stream: reviews.reviewsForBusiness(businessId),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          final items = (snapshot.data ?? const <BusinessReview>[])
              .where((r) => r.moderationStatus != 'hidden')
              .toList();
          if (items.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Text(
                  l10n.businessReviewsEmpty,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.muted),
                ),
              ),
            );
          }
          final average =
              items.fold<int>(0, (sum, r) => sum + r.rating) / items.length;
          final locale = Localizations.localeOf(context).toLanguageTag();
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: AppColors.paper,
                  border: Border.all(color: AppColors.rule),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    Text(
                      average.toStringAsFixed(1),
                      style: const TextStyle(
                        fontSize: 34,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _Stars(rating: average.round()),
                          const SizedBox(height: 4),
                          Text(
                            l10n.businessReviewsCount(items.length),
                            style: const TextStyle(color: AppColors.muted),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              for (final r in items) ...[
                Card(
                  margin: EdgeInsets.zero,
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                r.customerDisplayName.isEmpty
                                    ? l10n.customer
                                    : r.customerDisplayName,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            _Stars(rating: r.rating),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          [
                            if (r.orderType.isNotEmpty) r.orderType,
                            DateFormat.yMMMd(locale).format(r.createdAt),
                          ].join(' · '),
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 12,
                          ),
                        ),
                        if (r.comment.trim().isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Text(r.comment.trim()),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 10),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _Stars extends StatelessWidget {
  const _Stars({required this.rating});

  final int rating;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 1; i <= 5; i += 1)
          Icon(
            i <= rating ? Icons.star_rounded : Icons.star_outline_rounded,
            size: 18,
            color: i <= rating ? const Color(0xFFF59E0B) : AppColors.muted,
          ),
      ],
    );
  }
}
