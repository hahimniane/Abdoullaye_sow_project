import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../l10n/app_localizations.dart';
import '../models/destination_country.dart';
import '../services/container_manifest.dart';
import '../services/container_packages.dart';
import '../services/package_codes.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_back_button.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/scanner_camera_view.dart';
import 'containers_screen.dart';
import 'package_result_screen.dart';

/// "Whose is this?" - answered by pointing the phone at a package label.
///
/// The camera reads the label's QR; a label too torn to scan is typed (the
/// code is printed large beside the QR), and a package with no label left
/// at all is found by its customer's or receiver's name or phone. Each way
/// lands on the same package view.
class PackageScanScreen extends StatefulWidget {
  const PackageScanScreen({
    super.key,
    required this.businessId,
    this.businessCountryCode = '',
    this.destinations = const [],
    this.onOpenContainer,
    this.repository,
    this.cameraEnabled = true,
  });

  final String businessId;
  final String businessCountryCode;
  final List<DestinationCountry> destinations;
  final void Function(String containerId)? onOpenContainer;
  final ContainerPackageRepository? repository;

  /// Off in widget tests, where there is no camera plugin.
  @visibleForTesting
  final bool cameraEnabled;

  @override
  State<PackageScanScreen> createState() => _PackageScanScreenState();
}

class _PackageScanScreenState extends State<PackageScanScreen> {
  late final ContainerPackageRepository _repo =
      widget.repository ?? FirestoreContainerPackageRepository();
  final List<StreamSubscription<Object?>> _subs = [];
  final TextEditingController _query = TextEditingController();

  MobileScannerController? _camera;

  List<ContainerLine> _lines = const [];
  Map<String, ShippingContainer> _containersById = const {};

  /// While a package is open on top, the camera is paused and further reads
  /// are ignored, so one label opens one page.
  bool _opening = false;

  /// The last code opened and when its page closed: a label still in front
  /// of the lens when Back is pressed must not reopen it at once.
  String _lastCode = '';
  DateTime _lastClosed = DateTime.fromMillisecondsSinceEpoch(0);

  /// A QR that is not one of our labels, said once rather than on every
  /// frame the camera sees it.
  String _foreignQr = '';

  @override
  void initState() {
    super.initState();
    if (widget.cameraEnabled) {
      _camera = MobileScannerController(
        formats: const [BarcodeFormat.qrCode],
      );
    }
    _subs.add(_repo.watchLines(widget.businessId).listen((lines) {
      if (mounted) setState(() => _lines = lines);
    }, onError: (_) {}));
    _subs.add(_repo.watchContainers(widget.businessId).listen((list) {
      if (mounted) {
        setState(() => _containersById = {for (final c in list) c.id: c});
      }
    }, onError: (_) {}));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _camera?.dispose();
    _query.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_opening) return;
    for (final barcode in capture.barcodes) {
      final raw = barcode.rawValue ?? '';
      if (raw.isEmpty) continue;
      final code = packageCodeFromScan(raw);
      if (code == null) {
        if (_foreignQr != raw) setState(() => _foreignQr = raw);
        continue;
      }
      final justClosed = code == _lastCode &&
          DateTime.now().difference(_lastClosed) < const Duration(seconds: 3);
      if (justClosed) return;
      AppHaptics.commit();
      _open(code: code);
      return;
    }
  }

  Future<void> _open({String code = '', String lineId = ''}) async {
    if (_opening) return;
    setState(() {
      _opening = true;
      _foreignQr = '';
    });
    FocusScope.of(context).unfocus();
    try {
      await _camera?.stop();
    } catch (_) {}
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PackageResultScreen(
          businessId: widget.businessId,
          code: code,
          lineId: lineId,
          businessCountryCode: widget.businessCountryCode,
          destinations: widget.destinations,
          onOpenContainer: widget.onOpenContainer,
          repository: widget.repository,
        ),
      ),
    );
    _lastCode = code;
    _lastClosed = DateTime.now();
    if (!mounted) return;
    setState(() => _opening = false);
    try {
      await _camera?.start();
    } catch (_) {}
  }

  void _submitTyped() {
    final code = packageCodeFromScan(_query.text);
    if (code != null) _open(code: code);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final text = _query.text.trim();
    final typedCode = packageCodeFromScan(text);
    final hits = typedCode == null && text.length >= 2
        ? searchContainerLines(_lines, _containersById, text)
        : const <ContainerSearchHit>[];

    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          Container(
            decoration: BoxDecoration(
              color: AppColors.paper,
              border: Border(
                bottom: BorderSide(color: AppColors.rule.withValues(alpha: 0.8)),
              ),
            ),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                    4, 4, AppSpacing.lg, AppSpacing.md),
                child: Row(
                  children: [
                    const AppBackButton(),
                    Expanded(
                      child: Text(
                        l10n.pkgScanTitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          height: 1.1,
                          letterSpacing: -0.4,
                          color: AppColors.ink,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: ListView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.xl),
              children: [
                if (_camera != null) ...[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                    child: AspectRatio(
                      aspectRatio: 1,
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          ScannerCameraView(
                            controller: _camera!,
                            onDetect: _onDetect,
                            unavailableText: l10n.pkgCameraUnavailable,
                            frameMargin: const EdgeInsets.all(44),
                          ),
                          Positioned(
                            left: AppSpacing.md,
                            right: AppSpacing.md,
                            bottom: AppSpacing.md,
                            child: IgnorePointer(
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: AppSpacing.md,
                                    vertical: AppSpacing.sm),
                                decoration: BoxDecoration(
                                  color: Colors.black.withValues(alpha: 0.62),
                                  borderRadius: BorderRadius.circular(
                                      AppSpacing.radiusSm),
                                ),
                                child: Text(
                                  _foreignQr.isNotEmpty
                                      ? l10n.pkgNotAPackageQr
                                      : l10n.pkgScanHint,
                                  key: const Key('pkg-scan-hint'),
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 13,
                                    height: 1.3,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                ],
                TextField(
                  key: const Key('pkg-query'),
                  controller: _query,
                  autocorrect: false,
                  textInputAction: TextInputAction.search,
                  onChanged: (_) => setState(() {}),
                  onSubmitted: (_) => _submitTyped(),
                  decoration: InputDecoration(
                    labelText: l10n.pkgTypeCode,
                    hintText: l10n.pkgQueryHint,
                    prefixIcon:
                        const Icon(Icons.search, size: 20, color: AppColors.muted),
                    suffixIcon: _query.text.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close, size: 18),
                            tooltip: l10n.pkgClear,
                            onPressed: () => setState(_query.clear),
                          ),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                if (typedCode != null)
                  ContainerActionButton(
                    key: const Key('pkg-open-code'),
                    icon: Icons.arrow_forward,
                    label: l10n.pkgOpenCode(typedCode),
                    primary: true,
                    busy: _opening,
                    enabled: !_opening,
                    onTap: () => _open(code: typedCode),
                  )
                else if (text.length >= 2 && hits.isEmpty)
                  LotEmptyState(
                    key: const Key('pkg-no-match'),
                    icon: Icons.search_off,
                    title: l10n.ctrNoSearchMatch,
                    hint: l10n.pkgNoMatchHint,
                  )
                else if (text.length < 2)
                  Padding(
                    padding: const EdgeInsets.only(left: 2),
                    child: Text(
                      l10n.pkgQueryNote,
                      style: const TextStyle(
                        fontSize: 12.5,
                        height: 1.4,
                        color: AppColors.muted,
                      ),
                    ),
                  ),
                for (final hit in hits)
                  _HitRow(
                    key: ValueKey('pkg-hit-${hit.line.id}'),
                    hit: hit,
                    onTap: _opening
                        ? null
                        : () => hit.line.trackingCode.isNotEmpty
                            ? _open(code: hit.line.trackingCode)
                            : _open(lineId: hit.line.id),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HitRow extends StatelessWidget {
  const _HitRow({super.key, required this.hit, required this.onTap});

  final ContainerSearchHit hit;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final line = hit.line;
    final people = [
      if (!line.isStock && line.customerName.isNotEmpty) line.customerName,
      if (line.receiverName.isNotEmpty) '→ ${line.receiverName}',
    ].join(' ');
    final container = hit.container;
    return PressableScale(
      onTap: onTap,
      scale: 0.985,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.paper,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(color: AppColors.rule),
        ),
        child: Row(
          children: [
            Icon(containerKindIcon(line.kind),
                size: 20, color: AppColors.cobaltDeep),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    containerLineTitle(l10n, line),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  if (people.isNotEmpty)
                    Text(
                      people,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 13, height: 1.35, color: AppColors.muted),
                    ),
                  if (line.trackingCode.isNotEmpty || container != null)
                    Text(
                      [
                        if (line.trackingCode.isNotEmpty) line.trackingCode,
                        if (container != null) container.displayName,
                      ].join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.cobaltDeep,
                      ),
                    ),
                ],
              ),
            ),
            if (container != null) ...[
              const SizedBox(width: AppSpacing.sm),
              ContainerStatusPill(status: container.status),
            ],
          ],
        ),
      ),
    );
  }
}
