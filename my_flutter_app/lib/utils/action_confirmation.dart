import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

Future<bool> confirmMajorAction(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  String? cancelLabel,
  IconData icon = Icons.warning_amber_rounded,
  bool destructive = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (context) {
      return AlertDialog(
        icon: Icon(
          icon,
          color: destructive ? AppColors.errorRed : AppColors.cobaltDeep,
        ),
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(
              cancelLabel ??
                  MaterialLocalizations.of(context).cancelButtonLabel,
            ),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: destructive
                  ? AppColors.errorRed
                  : AppColors.cobaltDeep,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.pop(context, true),
            child: Text(confirmLabel),
          ),
        ],
      );
    },
  );
  return result == true;
}
