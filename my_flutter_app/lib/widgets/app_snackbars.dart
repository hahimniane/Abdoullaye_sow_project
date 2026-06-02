import 'dart:async';

import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../utils/app_feedback.dart';

void showSuccessSnackBar(
  BuildContext context,
  String message, {
  bool feedback = true,
}) {
  if (feedback) {
    unawaited(AppFeedback.success());
  }
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message),
      backgroundColor: const Color(0xFF16A34A),
      behavior: SnackBarBehavior.floating,
    ),
  );
}

void showErrorSnackBar(
  BuildContext context,
  String message, {
  bool feedback = true,
}) {
  if (feedback) {
    unawaited(AppFeedback.error());
  }
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(message),
      backgroundColor: AppColors.brandRed,
      behavior: SnackBarBehavior.floating,
    ),
  );
}
