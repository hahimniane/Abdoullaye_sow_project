import 'dart:async';

import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../utils/app_feedback.dart';

final rootScaffoldMessengerKey = GlobalKey<ScaffoldMessengerState>();

/// A green confirmation. With [actionLabel] and [onAction] it carries one
/// follow-up action (e.g. "Print tag" after a product is saved) and stays a
/// little longer so there is time to tap it.
void showSuccessSnackBar(
  BuildContext context,
  String message, {
  bool feedback = true,
  String? actionLabel,
  VoidCallback? onAction,
}) {
  if (feedback) {
    unawaited(AppFeedback.success());
  }
  final messenger = rootScaffoldMessengerKey.currentState;
  if (messenger == null && !context.mounted) return;

  final hasAction = actionLabel != null && onAction != null;
  (messenger ?? ScaffoldMessenger.of(context)).showSnackBar(
    SnackBar(
      content: Text(message),
      backgroundColor: const Color(0xFF16A34A),
      behavior: SnackBarBehavior.floating,
      duration: hasAction
          ? const Duration(seconds: 8)
          : const Duration(milliseconds: 4000),
      // An action would otherwise keep the bar up until it is tapped.
      persist: false,
      action: hasAction
          ? SnackBarAction(
              key: const Key('snackbar-action'),
              label: actionLabel,
              textColor: Colors.white,
              onPressed: onAction,
            )
          : null,
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
