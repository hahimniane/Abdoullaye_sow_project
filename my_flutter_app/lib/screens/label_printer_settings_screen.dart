import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/label_printer.dart';
import '../services/label_printer_ble.dart';
import '../services/m221_protocol.dart';
import '../services/tag_labels.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/label_printer_widgets.dart';
import 'containers_screen.dart' show ContainerActionButton;

/// The code a test tag carries: the real link shape and length (so it prints
/// at the size a product tag does) with a code no product can have (0 is
/// not in the code alphabet), so scanning it never opens a real product.
const labelPrinterTestCode = 'IT-TEST00';

/// Offsets move in half-millimetre steps (4 dots).
const labelPrinterOffsetStep = 4;

/// Everything the shop owner tunes on the phone, with no computer: pick the
/// printer, the label size, darkness and speed, line the print up with the
/// label (test frame + X/Y), print a test tag, and copy the print log for
/// the developer when something goes wrong.
class LabelPrinterSettingsScreen extends StatefulWidget {
  const LabelPrinterSettingsScreen({super.key, this.printer});

  /// The app's printer unless a test passes its own.
  final LabelPrinterController? printer;

  @override
  State<LabelPrinterSettingsScreen> createState() =>
      _LabelPrinterSettingsScreenState();
}

enum _Action { none, scan, frame, tag, status }

class _LabelPrinterSettingsScreenState
    extends State<LabelPrinterSettingsScreen> {
  late final LabelPrinterController _printer =
      widget.printer ?? sharedLabelPrinter();
  _Action _action = _Action.none;
  bool _scanned = false;
  String _error = '';
  String _done = '';

  @override
  void initState() {
    super.initState();
    unawaited(_printer.load());
  }

  bool get _working => _action != _Action.none || _printer.busy;

  Future<void> _run(_Action action, Future<String?> Function() body) async {
    if (_working) return;
    setState(() {
      _action = action;
      _error = '';
      _done = '';
    });
    try {
      final failure = await body();
      if (!mounted) return;
      if (failure != null) {
        AppHaptics.refuse();
        setState(() => _error = failure);
      }
    } finally {
      if (mounted) setState(() => _action = _Action.none);
    }
  }

  Future<void> _scan() async {
    if (_working) return;
    if (!await ensureBluetoothExplained(context)) return;
    if (!mounted) return;
    final l10n = AppLocalizations.of(context)!;
    await _run(_Action.scan, () async {
      final failure = await _printer.scan();
      if (mounted) setState(() => _scanned = true);
      return failure == null ? null : labelPrinterFailureText(l10n, failure);
    });
  }

  Future<void> _printTest(_Action action) async {
    if (_working) return;
    final l10n = AppLocalizations.of(context)!;
    if (!_printer.settings.hasPrinter) {
      setState(
        () => _error = labelPrinterFailureText(
          l10n,
          PrintFailure.noPrinterChosen,
        ),
      );
      return;
    }
    if (!await ensureBluetoothExplained(context)) return;
    if (!mounted) return;
    await _run(action, () async {
      final size = _printer.settings.size;
      final image = action == _Action.frame
          ? renderTestFrame(size.widthDots, size.heightDots)
          : renderTagBitmap(
              tagQrMatrix(inventoryTagLink(labelPrinterTestCode)),
              size.widthDots,
              size.heightDots,
            );
      final outcome = await _printer.printLabels(
        image: image,
        what: action == _Action.frame ? 'test frame' : 'test tag',
      );
      if (outcome.ok) {
        AppHaptics.commit();
        if (mounted) setState(() => _done = l10n.labelPrinterSent);
        return null;
      }
      final failure = outcome.failure;
      return failure == null ? null : labelPrinterFailureText(l10n, failure);
    });
  }

  Future<void> _checkStatus() async {
    final l10n = AppLocalizations.of(context)!;
    if (!_printer.settings.hasPrinter) {
      setState(
        () => _error = labelPrinterFailureText(
          l10n,
          PrintFailure.noPrinterChosen,
        ),
      );
      return;
    }
    if (!await ensureBluetoothExplained(context)) return;
    if (!mounted) return;
    await _run(_Action.status, () async {
      final failure = await _printer.checkStatus();
      if (failure == null) {
        if (mounted) setState(() => _done = l10n.labelPrinterStatusDone);
        return null;
      }
      return labelPrinterFailureText(l10n, failure);
    });
  }

  /// Changes the settings as they are NOW (two quick taps between frames
  /// must both count).
  Future<void> _update(
    LabelPrinterSettings Function(LabelPrinterSettings current) change,
  ) async {
    AppHaptics.selection();
    await _printer.updateSettings(change(_printer.settings));
  }

  Future<void> _copyLog() async {
    final l10n = AppLocalizations.of(context)!;
    await Clipboard.setData(ClipboardData(text: _printer.logReport()));
    if (mounted) showSuccessSnackBar(context, l10n.labelPrinterLogCopied);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(
            title: l10n.labelPrinterTitle,
            subtitle: l10n.labelPrinterSubtitle,
          ),
          Expanded(
            child: ListenableBuilder(
              listenable: Listenable.merge([_printer, _printer.log]),
              builder: (context, _) => !_printer.loaded
                  ? const Center(child: CircularProgressIndicator())
                  : ListView(
                      key: const Key('label-printer-list'),
                      padding: const EdgeInsets.fromLTRB(
                        AppSpacing.lg,
                        AppSpacing.md,
                        AppSpacing.lg,
                        AppSpacing.xl,
                      ),
                      children: [
                        if (_error.isNotEmpty) ...[
                          InventoryNote(
                            key: const Key('label-printer-error'),
                            text: _error,
                          ),
                          const SizedBox(height: AppSpacing.md),
                        ],
                        if (_done.isNotEmpty) ...[
                          PrinterDoneNote(
                            key: const Key('label-printer-done'),
                            text: _done,
                          ),
                          const SizedBox(height: AppSpacing.md),
                        ],
                        ..._printerSection(l10n),
                        _divider(),
                        ..._labelSection(l10n),
                        _divider(),
                        ..._positionSection(l10n),
                        _divider(),
                        ..._logSection(l10n),
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _divider() => const Padding(
    padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
    child: Divider(height: 1, color: AppColors.rule),
  );

  Widget _title(String text) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 17,
        fontWeight: FontWeight.w700,
        color: AppColors.ink,
      ),
    ),
  );

  Widget _hint(String text) => Text(
    text,
    style: const TextStyle(fontSize: 12.5, height: 1.4, color: AppColors.muted),
  );

  List<Widget> _printerSection(AppLocalizations l10n) {
    final s = _printer.settings;
    final found = _printer.found;
    final battery = _printer.batteryPercent;
    return [
      _title(l10n.labelPrinterSectionPrinter),
      Container(
        key: const Key('label-printer-chosen'),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.paper,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          border: Border.all(color: AppColors.rule),
        ),
        child: Row(
          children: [
            Icon(
              _printer.isConnected
                  ? Icons.bluetooth_connected
                  : Icons.print_outlined,
              color: s.hasPrinter ? AppColors.cobalt : AppColors.muted,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    s.hasPrinter ? s.deviceName : l10n.labelPrinterNone,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: s.hasPrinter
                          ? FontWeight.w700
                          : FontWeight.w400,
                      color: s.hasPrinter ? AppColors.ink : AppColors.muted,
                    ),
                  ),
                  if (_printer.isConnected || battery != null)
                    Text(
                      [
                        if (_printer.isConnected) l10n.labelPrinterConnected,
                        if (battery != null) l10n.labelPrinterBattery(battery),
                      ].join(' · '),
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.sage,
                      ),
                    ),
                ],
              ),
            ),
            if (_printer.isConnected)
              TextButton(
                key: const Key('label-printer-disconnect'),
                onPressed: _working ? null : _printer.disconnect,
                child: Text(l10n.labelPrinterDisconnect),
              )
            else if (s.hasPrinter)
              TextButton(
                key: const Key('label-printer-forget'),
                onPressed: _working ? null : _printer.forget,
                child: Text(l10n.labelPrinterForget),
              ),
          ],
        ),
      ),
      const SizedBox(height: AppSpacing.md),
      _hint(l10n.labelPrinterScanHint),
      const SizedBox(height: AppSpacing.sm),
      ContainerActionButton(
        key: const Key('label-printer-scan'),
        icon: Icons.bluetooth_searching,
        label: _action == _Action.scan
            ? l10n.labelPrinterScanning
            : l10n.labelPrinterScan,
        busy: _action == _Action.scan,
        enabled: !_working,
        onTap: _scan,
      ),
      if (_scanned && found.isEmpty && _action != _Action.scan) ...[
        const SizedBox(height: AppSpacing.sm),
        _hint(l10n.labelPrinterNoneFound),
      ],
      for (final device in found)
        Padding(
          padding: const EdgeInsets.only(top: AppSpacing.sm),
          child: Container(
            key: ValueKey('label-printer-found-${device.id}'),
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: AppSpacing.sm,
            ),
            decoration: BoxDecoration(
              color: AppColors.parchment,
              borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              border: Border.all(color: AppColors.rule),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        device.name.isEmpty ? '—' : device.name,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                        ),
                      ),
                      Text(
                        l10n.labelPrinterSignal(device.rssi),
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                if (device.id == s.deviceId)
                  InventoryChip(
                    label: l10n.labelPrinterInUse,
                    color: AppColors.sage,
                  )
                else
                  FilledButton(
                    key: ValueKey('label-printer-use-${device.id}'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(64, 40),
                    ),
                    onPressed: _working
                        ? null
                        : () {
                            AppHaptics.commit();
                            unawaited(_printer.choose(device));
                          },
                    child: Text(l10n.labelPrinterUse),
                  ),
              ],
            ),
          ),
        ),
    ];
  }

  List<Widget> _labelSection(AppLocalizations l10n) {
    final s = _printer.settings;
    return [
      _title(l10n.labelPrinterSectionLabel),
      LabelSizePicker(
        key: const Key('label-printer-size'),
        settings: s,
        enabled: !_working,
        onChanged: (id, w, h) {
          if (id == tagSizeCustom && (w == null || h == null)) return;
          unawaited(
            _update(
              (c) =>
                  c.copyWith(sizeId: id, customWidthMm: w, customHeightMm: h),
            ),
          );
        },
      ),
      const SizedBox(height: AppSpacing.md),
      PrinterStepper(
        keyPrefix: 'label-printer-density',
        label: l10n.labelPrinterDensity,
        help: l10n.labelPrinterDensityHelp,
        valueText: '${s.density}',
        onLess: _working || s.density <= m221MinDensity
            ? null
            : () => _update((c) => c.copyWith(density: c.density - 1)),
        onMore: _working || s.density >= m221MaxDensity
            ? null
            : () => _update((c) => c.copyWith(density: c.density + 1)),
      ),
      PrinterStepper(
        keyPrefix: 'label-printer-speed',
        label: l10n.labelPrinterSpeed,
        help: l10n.labelPrinterSpeedHelp,
        valueText: '${s.speed}',
        onLess: _working || s.speed <= m221MinSpeed
            ? null
            : () => _update((c) => c.copyWith(speed: c.speed - 1)),
        onMore: _working || s.speed >= m221MaxSpeed
            ? null
            : () => _update((c) => c.copyWith(speed: c.speed + 1)),
      ),
    ];
  }

  List<Widget> _positionSection(AppLocalizations l10n) {
    final s = _printer.settings;
    const step = labelPrinterOffsetStep;
    return [
      _title(l10n.labelPrinterSectionPosition),
      _hint(l10n.labelPrinterPositionHelp),
      const SizedBox(height: AppSpacing.sm),
      PrinterStepper(
        keyPrefix: 'label-printer-x',
        label: l10n.labelPrinterXOffset,
        valueText: l10n.labelPrinterDots(s.xOffset),
        onLess: _working || s.xOffset <= labelPrinterMinXOffset
            ? null
            : () => _update((c) => c.copyWith(xOffset: c.xOffset - step)),
        onMore: _working || s.xOffset >= labelPrinterMaxXOffset
            ? null
            : () => _update((c) => c.copyWith(xOffset: c.xOffset + step)),
      ),
      PrinterStepper(
        keyPrefix: 'label-printer-y',
        label: l10n.labelPrinterYOffset,
        valueText: l10n.labelPrinterDots(s.yOffset),
        onLess: _working || s.yOffset <= labelPrinterMinYOffset
            ? null
            : () => _update((c) => c.copyWith(yOffset: c.yOffset - step)),
        onMore: _working || s.yOffset >= labelPrinterMaxYOffset
            ? null
            : () => _update((c) => c.copyWith(yOffset: c.yOffset + step)),
      ),
      const SizedBox(height: AppSpacing.md),
      ContainerActionButton(
        key: const Key('label-printer-test-frame'),
        icon: Icons.crop_free,
        label: l10n.labelPrinterTestFrame,
        busy: _action == _Action.frame,
        enabled: !_working,
        onTap: () => _printTest(_Action.frame),
      ),
      const SizedBox(height: AppSpacing.sm),
      ContainerActionButton(
        key: const Key('label-printer-test-tag'),
        icon: Icons.qr_code_2,
        label: l10n.labelPrinterTestTag,
        busy: _action == _Action.tag,
        enabled: !_working,
        primary: true,
        onTap: () => _printTest(_Action.tag),
      ),
      const SizedBox(height: AppSpacing.sm),
      ContainerActionButton(
        key: const Key('label-printer-status'),
        icon: Icons.battery_std_outlined,
        label: _action == _Action.status
            ? l10n.labelPrinterChecking
            : l10n.labelPrinterCheckStatus,
        busy: _action == _Action.status,
        enabled: !_working,
        onTap: _checkStatus,
      ),
    ];
  }

  List<Widget> _logSection(AppLocalizations l10n) {
    final entries = _printer.log.entries;
    return [
      Row(
        children: [
          Expanded(child: _title(l10n.labelPrinterSectionLog)),
          TextButton(
            key: const Key('label-printer-clear-log'),
            onPressed: entries.isEmpty ? null : _printer.log.clear,
            child: Text(l10n.labelPrinterClearLog),
          ),
        ],
      ),
      _hint(l10n.labelPrinterLogHelp),
      const SizedBox(height: AppSpacing.sm),
      ContainerActionButton(
        key: const Key('label-printer-copy-log'),
        icon: Icons.copy_all_outlined,
        label: l10n.labelPrinterCopyLog,
        onTap: _copyLog,
      ),
      const SizedBox(height: AppSpacing.sm),
      Container(
        key: const Key('label-printer-log'),
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.sm),
        decoration: BoxDecoration(
          color: AppColors.parchment,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          border: Border.all(color: AppColors.rule),
        ),
        child: entries.isEmpty
            ? _hint(l10n.labelPrinterLogEmpty)
            : SelectableText(
                // Newest first: the last thing that happened is on top.
                entries.reversed.map((e) => e.line).join('\n'),
                style: const TextStyle(
                  fontFamily: 'monospace',
                  // iOS has no "monospace" family: Menlo is its fixed-width
                  // font; Android resolves "monospace" itself.
                  fontFamilyFallback: ['Menlo', 'Courier'],
                  fontSize: 11,
                  height: 1.4,
                  color: AppColors.ink,
                ),
              ),
      ),
    ];
  }
}
