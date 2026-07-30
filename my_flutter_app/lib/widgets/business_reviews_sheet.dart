import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/business_review.dart';
import '../services/business_review_service.dart';
import '../theme/app_colors.dart';

Future<void> showBusinessReviewsSheet(
  BuildContext context, {
  required String businessId,
  required String businessName,
  BusinessReviewService? reviewService,
}) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    builder: (context) => _BusinessReviewsSheet(
      businessId: businessId,
      businessName: businessName,
      reviewService: reviewService ?? BusinessReviewService(),
    ),
  );
}

class _BusinessReviewsSheet extends StatelessWidget {
  const _BusinessReviewsSheet({
    required this.businessId,
    required this.businessName,
    required this.reviewService,
  });

  final String businessId;
  final String businessName;
  final BusinessReviewService reviewService;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      builder: (context, scrollController) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.rule,
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                businessName.isEmpty
                    ? l10n.reviewsSectionTitle
                    : businessName,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                l10n.reviewsSectionTitle,
                style: const TextStyle(
                  color: AppColors.muted,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: StreamBuilder<List<BusinessReview>>(
                  stream: reviewService.reviewsForBusiness(businessId),
                  builder: (context, snapshot) {
                    final reviews = snapshot.data ?? const <BusinessReview>[];
                    if (!snapshot.hasData) {
                      return const Center(
                        child: CircularProgressIndicator(),
                      );
                    }
                    if (reviews.isEmpty) {
                      return Center(
                        child: Text(
                          l10n.reviewsEmpty,
                          style: const TextStyle(color: AppColors.muted),
                        ),
                      );
                    }
                    return ListView.separated(
                      controller: scrollController,
                      itemCount: reviews.length,
                      separatorBuilder: (_, _) =>
                          const Divider(height: 24, color: AppColors.rule),
                      itemBuilder: (context, index) => _ReviewRow(
                        review: reviews[index],
                        businessId: businessId,
                        reviewService: reviewService,
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ReviewRow extends StatelessWidget {
  const _ReviewRow({
    required this.review,
    required this.businessId,
    required this.reviewService,
  });

  final BusinessReview review;
  final String businessId;
  final BusinessReviewService reviewService;

  Future<void> _report(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    final controller = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.reviewFlagDialogTitle),
        content: TextField(
          controller: controller,
          autofocus: true,
          minLines: 2,
          maxLines: 4,
          decoration: InputDecoration(hintText: l10n.reviewFlagReasonHint),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: Text(MaterialLocalizations.of(dialogContext).cancelButtonLabel),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.of(dialogContext).pop(controller.text.trim()),
            child: Text(l10n.reviewFlagSubmit),
          ),
        ],
      ),
    );
    if (reason == null || reason.isEmpty) return;
    if (!context.mounted) return;
    try {
      await reviewService.flagReview(
        businessId: businessId,
        reviewId: review.id,
        reason: reason,
      );
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(l10n.reviewFlagSubmitted)));
    } catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('$error')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final date = DateFormat.yMMMd().format(review.createdAt);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            for (var i = 1; i <= 5; i++)
              Icon(
                i <= review.rating
                    ? Icons.star_rounded
                    : Icons.star_border_rounded,
                size: 16,
                color: AppColors.saffron,
              ),
            const SizedBox(width: 8),
            Text(
              date,
              style: const TextStyle(
                color: AppColors.muted,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            const Spacer(),
            IconButton(
              icon: const Icon(
                Icons.flag_outlined,
                size: 18,
                color: AppColors.muted,
              ),
              tooltip: l10n.reviewFlagButton,
              onPressed: () => _report(context),
            ),
          ],
        ),
        if (review.comment.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(review.comment, style: const TextStyle(color: AppColors.ink)),
        ],
        const SizedBox(height: 4),
        Text(
          review.customerDisplayName,
          style: const TextStyle(
            color: AppColors.muted,
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }
}
