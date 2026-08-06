import 'dart:async';

import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../utils/app_feedback.dart';

final rootScaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

void showSuccessSnackBar(
  BuildContext context,
  String message, {
  bool feedback = true,
}) {
  if (feedback) {
    unawaited(AppFeedback.success());
  }
  final messenger = rootScaffoldMessengerKey.currentState;
  if (messenger == null && !context.mounted) return;

  (messenger ?? ScaffoldMessenger.of(context)).showSnackBar(
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
  final messenger = rootScaffoldMessengerKey.currentState;
  if (messenger == null && !context.mounted) return;

  (messenger ?? ScaffoldMessenger.of(context)).showSnackBar(
    SnackBar(
      content: Text(message),
      // errorRed, NOT brandRed: brandRed is an alias for cobalt (teal), so
      // every failure rendered in the same colour as a success and testers
      // reasonably read "no error appeared".
      backgroundColor: AppColors.errorRed,
      behavior: SnackBarBehavior.floating,
    ),
  );
}
