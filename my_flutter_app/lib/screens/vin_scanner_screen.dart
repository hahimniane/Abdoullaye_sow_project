import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../l10n/app_localizations.dart';
import '../services/vin_text_recognition_service.dart';
import '../theme/app_colors.dart';
import '../utils/vin_utils.dart';

class VinScannerScreen extends StatefulWidget {
  const VinScannerScreen({super.key});

  @override
  State<VinScannerScreen> createState() => _VinScannerScreenState();
}

class _VinScannerScreenState extends State<VinScannerScreen> {
  final MobileScannerController _scannerController = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    formats: const [
      BarcodeFormat.code39,
      BarcodeFormat.code128,
      BarcodeFormat.dataMatrix,
      BarcodeFormat.pdf417,
      BarcodeFormat.qrCode,
    ],
  );
  final ImagePicker _imagePicker = ImagePicker();
  final VinTextRecognitionService _textRecognitionService =
      const VinTextRecognitionService();

  bool _isCompleting = false;
  bool _isConfirmingVin = false;
  bool _isOcrLoading = false;

  @override
  void dispose() {
    _scannerController.dispose();
    super.dispose();
  }

  Future<void> _handleBarcode(BarcodeCapture capture) async {
    if (_isCompleting || _isConfirmingVin) return;
    for (final barcode in capture.barcodes) {
      final vin = extractVin(barcode.rawValue ?? '');
      if (vin != null) {
        await _confirmAndComplete(vin);
        return;
      }
    }
  }

  Future<void> _scanTextFromCamera() async {
    if (_isCompleting || _isOcrLoading) return;
    setState(() {
      _isOcrLoading = true;
    });
    try {
      final image = await _imagePicker.pickImage(
        source: ImageSource.camera,
        imageQuality: 95,
      );
      if (image == null) return;
      final capture = await _scannerController.analyzeImage(
        image.path,
        formats: _scannerController.formats,
      );
      for (final barcode in capture?.barcodes ?? const <Barcode>[]) {
        final vin = extractVin(barcode.rawValue ?? '');
        if (vin != null) {
          await _confirmAndComplete(vin);
          return;
        }
      }
      final recognizedText = await _textRecognitionService.recognizeText(
        image.path,
      );
      final vin = extractVin(recognizedText);
      if (vin != null) {
        await _confirmAndComplete(vin);
        return;
      }
      final reviewCandidate = extractVinCandidateForReview(recognizedText);
      if (reviewCandidate != null) {
        await _confirmAndComplete(reviewCandidate);
        return;
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context)!.vinScanNoResult),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(AppLocalizations.of(context)!.vinScanFailed)),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isOcrLoading = false;
        });
      }
    }
  }

  Future<void> _confirmAndComplete(String vin) async {
    if (_isCompleting || _isConfirmingVin) return;
    _isConfirmingVin = true;
    await _scannerController.stop();
    if (!mounted) return;

    final controller = TextEditingController(text: vin);
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) {
        final l10n = AppLocalizations.of(context)!;
        return StatefulBuilder(
          builder: (context, setDialogState) {
            final normalized = normalizeVin(controller.text);
            final isValid = isValidVin(normalized);
            return AlertDialog(
              title: Text(l10n.vinNumber),
              content: TextField(
                controller: controller,
                autofocus: true,
                maxLength: vinLength,
                textCapitalization: TextCapitalization.characters,
                decoration: InputDecoration(
                  errorText: normalized.isEmpty || isValid
                      ? null
                      : l10n.invalidVinNumber,
                ),
                onChanged: (_) => setDialogState(() {}),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: Text(l10n.useManualEntry),
                ),
                FilledButton(
                  onPressed: isValid
                      ? () => Navigator.of(context).pop(true)
                      : null,
                  child: Text(l10n.done),
                ),
              ],
            );
          },
        );
      },
    );

    if (!mounted) return;
    final confirmedVin = normalizeVin(controller.text);
    controller.dispose();
    if (accepted == true) {
      await _complete(confirmedVin);
      return;
    }
    _isConfirmingVin = false;
    await _scannerController.start();
  }

  Future<void> _complete(String vin) async {
    _isCompleting = true;
    await _scannerController.stop();
    if (mounted) {
      Navigator.of(context).pop(vin);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: Text(l10n.scanVin),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
      ),
      body: Stack(
        children: [
          MobileScanner(
            controller: _scannerController,
            onDetect: _handleBarcode,
            errorBuilder: (context, error) {
              return Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    l10n.vinCameraUnavailable,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white),
                  ),
                ),
              );
            },
          ),
          Positioned.fill(
            child: IgnorePointer(
              child: Container(
                margin: const EdgeInsets.symmetric(
                  horizontal: 28,
                  vertical: 160,
                ),
                decoration: BoxDecoration(
                  border: Border.all(color: AppColors.brandRed, width: 3),
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ),
          Positioned(
            left: 20,
            right: 20,
            bottom: 28,
            child: SafeArea(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.72),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      l10n.scanVinInstructions,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white),
                    ),
                  ),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: FilledButton.icon(
                      onPressed: _isOcrLoading ? null : _scanTextFromCamera,
                      icon: _isOcrLoading
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.document_scanner_outlined),
                      label: Text(l10n.scanVinText),
                    ),
                  ),
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: Text(
                      l10n.useManualEntry,
                      style: const TextStyle(color: Colors.white),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
