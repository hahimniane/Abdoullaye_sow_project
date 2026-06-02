import 'package:flutter/services.dart';

enum AppFeedbackType { success, error, selection }

class AppFeedback {
  const AppFeedback._();

  static Future<void> play(AppFeedbackType type) async {
    try {
      switch (type) {
        case AppFeedbackType.success:
          await HapticFeedback.lightImpact();
          await SystemSound.play(SystemSoundType.click);
        case AppFeedbackType.error:
          await HapticFeedback.vibrate();
        case AppFeedbackType.selection:
          await HapticFeedback.selectionClick();
      }
    } catch (_) {
      // Feedback must never interrupt the task that just completed.
    }
  }

  static Future<void> success() => play(AppFeedbackType.success);

  static Future<void> error() => play(AppFeedbackType.error);

  static Future<void> selection() => play(AppFeedbackType.selection);
}
