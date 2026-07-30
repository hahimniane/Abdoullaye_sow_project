import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/business_review_service.dart';
import '../theme/app_colors.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/async_action_button.dart';

/// Route arguments for `/leave-review`, reachable either from a completed
/// order's card on OrdersScreen or from a "review_request" push notification
/// deep link (see notification_routing.dart).
class ReviewComposerArguments {
  const ReviewComposerArguments({
    required this.relatedCollection,
    required this.relatedId,
    required this.businessId,
    this.businessName = '',
    this.orderTitle = '',
  });

  final String relatedCollection;
  final String relatedId;
  final String businessId;
  final String businessName;
  final String orderTitle;
}

class ReviewComposerScreen extends StatefulWidget {
  const ReviewComposerScreen({
    super.key,
    required this.arguments,
    this.reviewService,
  });

  final ReviewComposerArguments arguments;
  final BusinessReviewService? reviewService;

  @override
  State<ReviewComposerScreen> createState() => _ReviewComposerScreenState();
}

class _ReviewComposerScreenState extends State<ReviewComposerScreen> {
  late final BusinessReviewService _service;
  final TextEditingController _commentController = TextEditingController();
  int _rating = 0;

  @override
  void initState() {
    super.initState();
    _service = widget.reviewService ?? BusinessReviewService();
  }

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    if (_rating < 1) {
      showErrorSnackBar(context, l10n.reviewRatingRequired);
      return;
    }
    final comment = _commentController.text.trim();
    if (comment.isEmpty) {
      showErrorSnackBar(context, l10n.reviewCommentRequired);
      return;
    }
    try {
      await _service.submitReview(
        relatedCollection: widget.arguments.relatedCollection,
        relatedId: widget.arguments.relatedId,
        businessId: widget.arguments.businessId,
        rating: _rating,
        comment: comment,
      );
      if (!mounted) return;
      showSuccessSnackBar(context, l10n.reviewSubmitSuccess);
      Navigator.of(context).pop(true);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      showErrorSnackBar(context, _errorMessage(l10n, error));
    } catch (error) {
      if (!mounted) return;
      showErrorSnackBar(context, l10n.reviewSubmitFailed);
    }
  }

  String _errorMessage(
    AppLocalizations l10n,
    FirebaseFunctionsException error,
  ) {
    switch (error.code) {
      case 'already-exists':
        return l10n.reviewAlreadySubmitted;
      case 'failed-precondition':
        return l10n.reviewOrderNotCompleted;
      default:
        return error.message ?? error.code;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final args = widget.arguments;
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const AppBackButton(),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      l10n.reviewComposerTitle,
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        color: AppColors.ink,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (args.businessName.isNotEmpty)
                Text(
                  args.businessName,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
              if (args.orderTitle.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(
                  args.orderTitle,
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppColors.muted,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
              const SizedBox(height: 28),
              Text(
                l10n.reviewRatingLabel,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 10),
              _StarPicker(
                rating: _rating,
                onChanged: (value) => setState(() => _rating = value),
              ),
              const SizedBox(height: 24),
              TextField(
                controller: _commentController,
                minLines: 4,
                maxLines: 8,
                maxLength: 1000,
                decoration: InputDecoration(
                  labelText: l10n.reviewCommentHint,
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: 8),
              AsyncActionButton.filled(
                onPressed: _submit,
                label: l10n.reviewSubmitButton,
                loadingLabel: l10n.reviewSubmitButton,
                icon: Icons.send_outlined,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StarPicker extends StatelessWidget {
  const _StarPicker({required this.rating, required this.onChanged});

  final int rating;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (var value = 1; value <= 5; value++)
          Semantics(
            button: true,
            label: '$value ${value == 1 ? 'star' : 'stars'}',
            child: GestureDetector(
              onTap: () => onChanged(value),
              child: Padding(
                padding: const EdgeInsets.only(right: 6),
                child: Icon(
                  value <= rating
                      ? Icons.star_rounded
                      : Icons.star_border_rounded,
                  color: AppColors.saffron,
                  size: 38,
                ),
              ),
            ),
          ),
      ],
    );
  }
}
