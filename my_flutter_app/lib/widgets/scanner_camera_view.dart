import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../theme/app_colors.dart';

/// The camera half of every scanner in the app: the live preview, what to
/// say when the camera cannot be used (permission refused, no camera, in
/// use elsewhere), and the frame that tells people where to aim.
///
/// The VIN scanner and the package scanner share it, so a refused camera
/// reads the same and recovers the same everywhere. Each screen keeps its
/// own controller (formats differ) and decides what a detection means.
class ScannerCameraView extends StatelessWidget {
  const ScannerCameraView({
    super.key,
    required this.controller,
    required this.onDetect,
    required this.unavailableText,
    this.frameMargin = const EdgeInsets.symmetric(horizontal: 28, vertical: 160),
    this.frameRadius = 12,
  });

  final MobileScannerController controller;
  final void Function(BarcodeCapture capture) onDetect;

  /// Shown in place of the preview when the camera cannot start; it should
  /// say what still works without it.
  final String unavailableText;
  final EdgeInsets frameMargin;
  final double frameRadius;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        MobileScanner(
          controller: controller,
          onDetect: onDetect,
          errorBuilder: (context, error) => ColoredBox(
            color: Colors.black,
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.no_photography_outlined,
                        color: Colors.white70, size: 28),
                    const SizedBox(height: 10),
                    Text(
                      unavailableText,
                      key: const Key('scanner-camera-unavailable'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white, height: 1.35),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        IgnorePointer(
          child: Container(
            margin: frameMargin,
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.brandRed, width: 3),
              borderRadius: BorderRadius.circular(frameRadius),
            ),
          ),
        ),
      ],
    );
  }
}
