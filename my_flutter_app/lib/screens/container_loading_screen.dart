import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../l10n/app_localizations.dart';
import '../services/container_loading.dart';
import '../services/container_manifest.dart';
import '../services/package_codes.dart';
import '../services/waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/app_feedback.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/scanner_camera_view.dart';
import 'containers_screen.dart'
    show ContainerActionButton, showContainerLabelSheet;

/// The sound and buzz of a scan: [ok] is a light tap and a click, anything
/// else (refused, not counted, no connection) a vibration. Injected in
/// widget tests.
typedef LoadFeedback = void Function(bool ok);

void _defaultLoadFeedback(bool ok) =>
    unawaited(ok ? AppFeedback.success() : AppFeedback.error());

/// Blue for "2 of 5": a package part-way on.
const Color loadBlue = Color(0xFF1D4ED8);

/// Scan to load (docs/WAITING_PACKAGES.md "Scan to load"): opened with
/// Start loading on a container that is still loading. The camera stays
/// open; every package label it reads goes onto this container at once,
/// with a buzz and a click, and lands in Recent scans with what happened.
/// A damaged label is typed. Done loading asks the server what is left
/// (packages part-way on, never scanned, still waiting) before leaving.
///
/// Every call is `assignContainerLines` with an `action`, through [caller]
/// (the container callables' caller, so a widget test answers instead of
/// Firebase). The rules live in `services/container_loading.dart`.
class ContainerLoadingScreen extends StatefulWidget {
  const ContainerLoadingScreen({
    super.key,
    required this.businessId,
    required this.container,
    this.caller = callContainerCallable,
    this.liveUpdates,
    this.liveLines,
    this.feedback = _defaultLoadFeedback,
    this.callTimeout = const Duration(seconds: 20),
    this.cameraEnabled = true,
  });

  final String businessId;
  final ShippingContainer container;
  final ContainerCallableCaller caller;

  /// The containers feed, when the screen was opened from one: the running
  /// total then counts every phone's scans from the live lines. Without it
  /// the total comes from this phone's answers.
  final Listenable? liveUpdates;
  final List<ContainerLine> Function()? liveLines;

  final LoadFeedback feedback;

  /// A scan with no answer by then is shown as "No connection" and not
  /// counted (after one immediate retry under the same id; the row's
  /// Retry resends it under that id too).
  final Duration callTimeout;

  /// Off in widget tests, where there is no camera plugin.
  @visibleForTesting
  final bool cameraEnabled;

  @override
  State<ContainerLoadingScreen> createState() => _ContainerLoadingScreenState();
}

class _ContainerLoadingScreenState extends State<ContainerLoadingScreen> {
  final _typed = TextEditingController();
  final _guard = LoadDuplicateGuard();
  MobileScannerController? _camera;

  List<LoadRow> _rows = const [];
  int _nextKey = 0;

  /// The last answer about each package, for the total when there is no
  /// live read.
  final Map<String, LoadLine> _latestByLine = {};
  LoadTotals _liveTotals = const LoadTotals();

  /// What is on the container in all: from the live lines, else the last
  /// answer that carried the container (scan, undo, leave).
  LoadTotals _liveContainerTotals = const LoadTotals();
  LoadContainer? _latestContainer;

  /// A QR that is not one of our labels, said once.
  bool _foreignQr = false;
  bool _typedInvalid = false;

  /// A question or the summary is open: the camera is paused and reads are
  /// ignored.
  bool _modal = false;
  bool _undoing = false;
  bool _summaryBusy = false;

  String get _containerId => widget.container.id;

  @override
  void initState() {
    super.initState();
    if (widget.cameraEnabled) {
      _camera = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
    }
    widget.liveUpdates?.addListener(_onLive);
    _readLive();
  }

  @override
  void dispose() {
    widget.liveUpdates?.removeListener(_onLive);
    _camera?.dispose();
    _typed.dispose();
    super.dispose();
  }

  void _readLive() {
    final read = widget.liveLines;
    if (read == null) return;
    final lines = read();
    _liveTotals = loadTotalsOfLines(lines, _containerId);
    _liveContainerTotals = loadContainerTotalsOfLines(lines, _containerId);
  }

  /// Keeps what an answer says about a package and the container.
  void _learn(LoadLine line, LoadContainer? container) {
    if (line.lineId.isNotEmpty) _latestByLine[line.lineId] = line;
    if (container != null) _latestContainer = container;
  }

  void _onLive() {
    if (!mounted) return;
    setState(_readLive);
  }

  LoadTotals get _totals => widget.liveLines != null
      ? _liveTotals
      : loadTotalsOfAnswers(_latestByLine.values);

  LoadTotals? get _containerTotals => widget.liveLines != null
      ? _liveContainerTotals
      : loadContainerTotalsOf(_latestContainer);

  // -------------------------------------------------------------------------
  // Scanning.
  // -------------------------------------------------------------------------

  void _onDetect(BarcodeCapture capture) {
    if (_modal || !mounted) return;
    for (final barcode in capture.barcodes) {
      final raw = barcode.rawValue ?? '';
      if (raw.isEmpty) continue;
      final code = packageCodeFromScan(raw);
      if (code == null) {
        if (!_foreignQr) setState(() => _foreignQr = true);
        continue;
      }
      if (_foreignQr) setState(() => _foreignQr = false);
      if (_guard.accept(code, DateTime.now())) unawaited(_scan(code));
    }
  }

  void _submitTyped() {
    final code = packageCodeFromScan(_typed.text);
    if (code == null) {
      setState(() => _typedInvalid = _typed.text.trim().isNotEmpty);
      return;
    }
    // Typed on purpose: always sent, and the camera then leaves that label
    // alone for the usual window.
    _guard.accept(code, DateTime.now());
    setState(() {
      _typedInvalid = false;
      _typed.clear();
    });
    unawaited(_scan(code));
  }

  void _put(LoadRow row) => _rows = loadRowsWith(_rows, row);

  /// Sends one scan. A new physical scan always has a fresh id; [scanId]
  /// is given only to retry the SAME request (the failed row's Retry). A
  /// send that gets no answer is retried once at once with the same id.
  Future<void> _scan(
    String code, {
    bool move = false,
    int? key,
    String? scanId,
  }) async {
    final rowKey = key ?? _nextKey++;
    final id = scanId ?? newLoadScanId();
    final sending = LoadRow(
      key: rowKey,
      code: code,
      scanId: id,
      moved: move,
      state: LoadRowState.sending,
    );
    setState(() => _put(sending));
    for (var attempt = 0; ; attempt++) {
      LoadFailure failure;
      try {
        final data = await widget
            .caller(
              loadCallable,
              loadScanRequest(
                businessId: widget.businessId,
                containerId: _containerId,
                code: code,
                scanId: id,
                move: move,
              ),
            )
            .timeout(widget.callTimeout);
        final answer = LoadAnswer.fromCallable(data);
        if (!mounted) return;
        setState(() {
          _put(sending.answered(answer, moved: move));
          _learn(answer.line, answer.container);
        });
        // "All N already in" changed nothing: it buzzes like a refusal.
        widget.feedback(answer.result != loadResultAllScanned);
        return;
      } on FirebaseFunctionsException catch (error) {
        failure = parseLoadFailure(error.code, error.details);
      } catch (error) {
        failure = loadFailureOf(error);
      }
      if (!mounted) return;
      if (loadShouldAutoRetry(failure, attempt)) continue;
      _failed(code, sending, failure);
      return;
    }
  }

  void _failed(String code, LoadRow row, LoadFailure failure) {
    // Not counted here. The next physical scan of this label goes at once,
    // under its own new id (it is the next piece); Retry on the row resends
    // this one under its id.
    if (failure.offline) _guard.forget(code);
    setState(() => _put(row.refused(failure)));
    widget.feedback(false);
    if (failure.offersMove) unawaited(_askMove(code, row.key, failure));
  }

  void _retry(LoadRow row) {
    if (!loadCanRetry(row)) return;
    unawaited(
      _scan(row.code, move: row.moved, key: row.key, scanId: row.scanId),
    );
  }

  Future<void> _askMove(String code, int key, LoadFailure failure) async {
    final l10n = AppLocalizations.of(context)!;
    final where = failure.otherContainerLabel.isNotEmpty
        ? failure.otherContainerLabel
        : failure.otherContainerId;
    await _pauseFor(() async {
      final move = await confirmMajorAction(
        context,
        title: l10n.ldgMoveTitle,
        message: failure.otherScannedPieces > 0
            ? '${l10n.ldgMoveMessage(where)}\n\n'
                  '${l10n.ldgMoveScannedWarning(failure.otherScannedPieces, where)}'
            : l10n.ldgMoveMessage(where),
        confirmLabel: l10n.ldgMoveConfirm,
        icon: Icons.swap_horiz,
      );
      if (move && mounted) unawaited(_scan(code, move: true, key: key));
    });
  }

  /// Runs [work] (a dialog or a sheet) with the camera paused.
  Future<void> _pauseFor(Future<void> Function() work) async {
    setState(() => _modal = true);
    try {
      await _camera?.stop();
    } catch (_) {}
    try {
      await work();
    } finally {
      if (mounted) {
        setState(() => _modal = false);
        try {
          await _camera?.start();
        } catch (_) {}
      }
    }
  }

  // -------------------------------------------------------------------------
  // Undo and Done loading.
  // -------------------------------------------------------------------------

  Future<void> _undo(LoadRow row) async {
    final lineId = row.line?.lineId ?? '';
    if (_undoing || lineId.isEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _undoing = true);
    try {
      final data = await widget
          .caller(
            loadCallable,
            loadUndoRequest(
              businessId: widget.businessId,
              containerId: _containerId,
              lineId: lineId,
              scanId: row.scanId,
            ),
          )
          .timeout(widget.callTimeout);
      final answer = LoadAnswer.fromCallable(data);
      if (!mounted) return;
      _guard.forget(row.code);
      setState(() {
        _put(row.undone(answer));
        _learn(answer.line, answer.container);
        // Off this container (back to waiting, or back to the box it was
        // moved from): none of its pieces count here any more.
        if (answer.result == loadResultUnloaded ||
            answer.result == loadResultMovedBack) {
          _latestByLine.remove(lineId);
        }
      });
      // Already undone changed nothing: a neutral note, no buzz.
      if (answer.result != loadResultAlreadyUndone) widget.feedback(true);
    } catch (error) {
      if (!mounted) return;
      final failure = error is FirebaseFunctionsException
          ? parseLoadFailure(error.code, error.details)
          : loadFailureOf(error);
      showErrorSnackBar(
        context,
        loadLineActionErrorText(l10n, failure, fallback: l10n.ldgUndoFailed),
      );
    } finally {
      if (mounted) setState(() => _undoing = false);
    }
  }

  Future<void> _done() async {
    if (_summaryBusy) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _summaryBusy = true);
    LoadSummary? summary;
    try {
      summary = LoadSummary.fromCallable(
        await widget
            .caller(
              loadCallable,
              loadSummaryRequest(
                businessId: widget.businessId,
                containerId: _containerId,
              ),
            )
            .timeout(widget.callTimeout),
      );
    } catch (error) {
      final failure = error is FirebaseFunctionsException
          ? parseLoadFailure(error.code, error.details)
          : loadFailureOf(error);
      if (mounted) {
        showErrorSnackBar(
          context,
          failure.offline ? l10n.dlvErrOffline : l10n.ldgSummaryFailed,
        );
      }
    } finally {
      // Released before the sheet opens: a spinner left running under it
      // never settles.
      if (mounted) setState(() => _summaryBusy = false);
    }
    if (summary == null || !mounted) return;
    var leave = false;
    await _pauseFor(() async {
      leave =
          await showLotSheet<bool>(
            context,
            LoadSummarySheet(
              key: const Key('load-summary'),
              businessId: widget.businessId,
              container: widget.container,
              summary: summary!,
              caller: widget.caller,
              callTimeout: widget.callTimeout,
              onLeft: (left) {
                if (mounted) setState(() => _learn(left.line, left.container));
              },
            ),
          ) ==
          true;
    });
    if (leave && mounted) Navigator.of(context).pop();
  }

  // -------------------------------------------------------------------------
  // Drawing.
  // -------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final container = widget.container;
    final keyboardOpen = MediaQuery.viewInsetsOf(context).bottom > 0;
    final totals = _totals;
    final containerTotals = _containerTotals;

    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          Container(
            decoration: BoxDecoration(
              color: AppColors.paper,
              border: Border(
                bottom: BorderSide(
                  color: AppColors.rule.withValues(alpha: 0.8),
                ),
              ),
            ),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  4,
                  4,
                  AppSpacing.lg,
                  AppSpacing.md,
                ),
                child: Row(
                  children: [
                    const AppBackButton(),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            container.displayName,
                            key: const Key('load-container'),
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
                          if (container.destinationCountryName.isNotEmpty)
                            Text(
                              l10n.ldgHeaderTo(
                                container.destinationCountryName,
                              ),
                              key: const Key('load-destination'),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 12.5,
                                height: 1.3,
                                color: AppColors.muted,
                              ),
                            ),
                          const SizedBox(height: 4),
                          Text(
                            loadTotalsText(l10n, totals),
                            key: const Key('load-totals'),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              height: 1.25,
                              color: AppColors.cobaltDeep,
                            ),
                          ),
                          if (containerTotals != null)
                            Text(
                              loadContainerTotalsText(l10n, containerTotals),
                              key: const Key('load-container-totals'),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 12.5,
                                height: 1.3,
                                color: AppColors.muted,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // Out of the way while typing: on a small phone the keyboard
          // leaves no room for it.
          if (_camera != null && !keyboardOpen)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                0,
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                child: SizedBox(
                  // Room for Recent scans on a small phone too.
                  height: (MediaQuery.sizeOf(context).height * 0.26).clamp(
                    150.0,
                    220.0,
                  ),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      ScannerCameraView(
                        controller: _camera!,
                        onDetect: _onDetect,
                        unavailableText: l10n.ldgCameraUnavailable,
                        frameMargin: const EdgeInsets.symmetric(
                          horizontal: 70,
                          vertical: 28,
                        ),
                      ),
                      Positioned(
                        left: AppSpacing.sm,
                        right: AppSpacing.sm,
                        bottom: AppSpacing.sm,
                        child: IgnorePointer(
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: AppSpacing.md,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.62),
                              borderRadius: BorderRadius.circular(
                                AppSpacing.radiusSm,
                              ),
                            ),
                            child: Text(
                              _foreignQr
                                  ? l10n.pkgNotAPackageQr
                                  : l10n.pkgScanHint,
                              key: const Key('load-scan-hint'),
                              textAlign: TextAlign.center,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 12.5,
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
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.md,
              AppSpacing.lg,
              0,
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('load-type-code'),
                    controller: _typed,
                    autocorrect: false,
                    textCapitalization: TextCapitalization.characters,
                    textInputAction: TextInputAction.send,
                    onChanged: (_) {
                      if (_typedInvalid) setState(() => _typedInvalid = false);
                    },
                    onSubmitted: (_) => _submitTyped(),
                    decoration: InputDecoration(
                      labelText: l10n.ldgTypeCode,
                      hintText: l10n.ldgTypeHint,
                      errorText: _typedInvalid ? l10n.ldgErrCodeInvalid : null,
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                FilledButton(
                  key: const Key('load-type-send'),
                  // The theme's FilledButton is full width; beside a field
                  // it must not be.
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(0, 48),
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.lg,
                    ),
                  ),
                  onPressed: _submitTyped,
                  child: Text(l10n.ldgTypeSend),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg + 2,
              AppSpacing.md,
              AppSpacing.lg,
              AppSpacing.xs,
            ),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                l10n.ldgRecent,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.3,
                  color: AppColors.muted,
                ),
              ),
            ),
          ),
          Expanded(
            child: _rows.isEmpty
                ? Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.lg,
                      vertical: AppSpacing.sm,
                    ),
                    child: Text(
                      l10n.ldgNoScans,
                      key: const Key('load-no-scans'),
                      style: const TextStyle(
                        fontSize: 13,
                        height: 1.4,
                        color: AppColors.muted,
                      ),
                    ),
                  )
                : ListView.builder(
                    key: const Key('load-recent'),
                    keyboardDismissBehavior:
                        ScrollViewKeyboardDismissBehavior.onDrag,
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg,
                      0,
                      AppSpacing.lg,
                      AppSpacing.lg,
                    ),
                    itemCount: _rows.length,
                    itemBuilder: (context, i) {
                      final row = _rows[i];
                      final canUndo = loadCanUndo(_rows, row);
                      return LoadScanRowTile(
                        key: ValueKey('load-row-${row.key}'),
                        row: row,
                        undoBusy: canUndo && _undoing,
                        onUndo: canUndo && !_undoing ? () => _undo(row) : null,
                        onRetry: loadCanRetry(row) ? () => _retry(row) : null,
                      );
                    },
                  ),
          ),
          if (!keyboardOpen)
            Container(
              decoration: BoxDecoration(
                color: AppColors.paper,
                border: Border(
                  top: BorderSide(color: AppColors.rule.withValues(alpha: 0.8)),
                ),
              ),
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                AppSpacing.md,
              ),
              child: SafeArea(
                top: false,
                child: ContainerActionButton(
                  key: const Key('load-done'),
                  icon: Icons.check,
                  label: l10n.ldgDone,
                  primary: true,
                  busy: _summaryBusy,
                  enabled: !_summaryBusy,
                  onTap: _done,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Words.
// ---------------------------------------------------------------------------

/// "37 packages · 52 pieces scanned".
String loadTotalsText(AppLocalizations l10n, LoadTotals totals) =>
    '${l10n.ldgTotalPackages(totals.packages)} · '
    '${l10n.ldgTotalPieces(totals.pieces)}';

/// "On the container: 40 packages · 61 pieces" - scanned or not.
String loadContainerTotalsText(AppLocalizations l10n, LoadTotals totals) =>
    l10n.ldgOnContainer(
      l10n.ldgTotalPackages(totals.packages),
      l10n.ldgPieces(totals.pieces),
    );

/// An Undo or a Leave N waiting that failed. They name a package by line
/// id, so `line_not_found` there means it is no longer on this container.
String loadLineActionErrorText(
  AppLocalizations l10n,
  LoadFailure failure, {
  required String fallback,
}) {
  if (failure.offline) return l10n.dlvErrOffline;
  return switch (loadRefusalMessage(failure)) {
    LoadMessage.lineNotFound => l10n.ldgErrNotOnContainer,
    LoadMessage.generic => fallback,
    _ => loadMessageText(l10n, failure),
  };
}

/// A refused or failed loading call in plain words, by `details.reason`.
String loadMessageText(AppLocalizations l10n, LoadFailure failure) {
  final where = failure.otherContainerLabel.isNotEmpty
      ? failure.otherContainerLabel
      : failure.otherContainerId;
  return switch (loadRefusalMessage(failure)) {
    LoadMessage.offline => l10n.ldgErrOffline,
    LoadMessage.notAllowed => l10n.ldgErrNotAllowed,
    LoadMessage.lineNotFound => l10n.ldgErrNotFound,
    LoadMessage.containerLocked => l10n.ldgErrLocked,
    LoadMessage.destinationRequired => l10n.ldgErrDestinationRequired,
    LoadMessage.destinationMismatch => l10n.ldgErrDestinationMismatch,
    LoadMessage.lineDelivered => l10n.ldgErrDelivered,
    LoadMessage.inOtherContainer =>
      where.isEmpty
          ? l10n.ldgErrInAnotherContainer
          : l10n.ldgErrOtherContainer(where),
    LoadMessage.inShippedContainer =>
      where.isEmpty
          ? l10n.ldgErrInAnotherContainer
          : l10n.ldgErrShippedContainer(where),
    LoadMessage.codeInvalid => l10n.ldgErrCodeInvalid,
    LoadMessage.scanIdInvalid => l10n.ldgErrScanId,
    LoadMessage.pieceCountInvalid => l10n.ldgErrPieceCount,
    LoadMessage.actionInvalid => l10n.ldgErrAction,
    LoadMessage.generic => l10n.ldgErrGeneric,
  };
}

/// What a row says happened.
String loadRowText(AppLocalizations l10n, LoadRow row) {
  final line = row.line;
  final scanned = line?.scannedPieces ?? 0;
  final total = line?.pieceCount ?? 0;
  switch (row.state) {
    case LoadRowState.sending:
      return l10n.ldgSending;
    case LoadRowState.loaded:
      final loaded = row.moved ? l10n.ldgMovedHere : l10n.ldgLoaded;
      // A package of several pieces: say how far along it is.
      return total > 1
          ? '$loaded · ${l10n.ldgCountedOf(scanned, total)}'
          : loaded;
    case LoadRowState.counted:
      return l10n.ldgCountedOf(scanned, total);
    case LoadRowState.allScanned:
      return l10n.ldgAllIn(total);
    case LoadRowState.refused:
      return loadMessageText(
        l10n,
        row.failure ?? const LoadFailure(code: 'unknown'),
      );
    case LoadRowState.undone:
      return switch (row.undoResult) {
        loadResultUnloaded => l10n.ldgUndoneBack,
        loadResultMovedBack => l10n.ldgUndoneMovedBack(row.movedBackTo),
        loadResultAlreadyUndone => l10n.ldgAlreadyUndone,
        _ => l10n.ldgUndoneOf(scanned, total),
      };
  }
}

Color loadToneColor(LoadTone tone) => switch (tone) {
  LoadTone.pending => AppColors.muted,
  LoadTone.green => AppColors.sage,
  LoadTone.blue => loadBlue,
  LoadTone.amber => AppColors.warn,
  LoadTone.red => AppColors.errorRed,
  LoadTone.grey => AppColors.muted,
};

IconData _toneIcon(LoadTone tone) => switch (tone) {
  LoadTone.pending => Icons.schedule,
  LoadTone.green => Icons.check_circle,
  LoadTone.blue => Icons.add_circle,
  LoadTone.amber => Icons.info,
  LoadTone.red => Icons.error,
  LoadTone.grey => Icons.undo,
};

/// One scan in Recent scans: the code and whose it is, and what happened in
/// its colour.
class LoadScanRowTile extends StatelessWidget {
  const LoadScanRowTile({
    super.key,
    required this.row,
    this.onUndo,
    this.undoBusy = false,
    this.onRetry,
  });

  final LoadRow row;
  final VoidCallback? onUndo;
  final bool undoBusy;

  /// Resends a scan that got no answer, under the same scan id.
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final tone = row.tone;
    final color = loadToneColor(tone);
    final line = row.line;
    final code = (line?.trackingCode.isNotEmpty ?? false)
        ? line!.trackingCode
        : row.code;
    final who = line?.name ?? '';
    // A rounded border must be one colour: the tone is a strip inside it.
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ColoredBox(color: color, child: const SizedBox(width: 4)),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.md,
                  AppSpacing.sm,
                  AppSpacing.sm,
                  AppSpacing.sm,
                ),
                child: _content(l10n, tone, color, code, who),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _content(
    AppLocalizations l10n,
    LoadTone tone,
    Color color,
    String code,
    String who,
  ) {
    return Row(
      children: [
        tone == LoadTone.pending
            ? SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2, color: color),
              )
            : Icon(_toneIcon(tone), size: 20, color: color),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                who.isEmpty ? code : '$code · $who',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.ink,
                ),
              ),
              Text(
                loadRowText(l10n, row),
                key: ValueKey('load-row-text-${row.key}'),
                style: TextStyle(
                  fontSize: 13,
                  height: 1.3,
                  fontWeight: FontWeight.w600,
                  color: color,
                ),
              ),
            ],
          ),
        ),
        if (onRetry != null) ...[
          const SizedBox(width: AppSpacing.xs),
          TextButton.icon(
            key: ValueKey('load-retry-${row.key}'),
            onPressed: onRetry,
            icon: const Icon(Icons.refresh, size: 18),
            label: Text(l10n.retry),
            style: TextButton.styleFrom(
              foregroundColor: AppColors.cobaltDeep,
              visualDensity: VisualDensity.compact,
            ),
          ),
        ],
        if (onUndo != null || undoBusy) ...[
          const SizedBox(width: AppSpacing.xs),
          TextButton.icon(
            key: const Key('load-undo'),
            onPressed: onUndo,
            icon: undoBusy
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.undo, size: 18),
            label: Text(l10n.ldgUndo),
            style: TextButton.styleFrom(
              foregroundColor: AppColors.cobaltDeep,
              visualDensity: VisualDensity.compact,
            ),
          ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Done loading.
// ---------------------------------------------------------------------------

/// What is left before the container is done: packages part-way on (each
/// "Load all" - keep it whole - or "Leave N waiting"), packages on the
/// container never scanned, and waiting packages for its destination that
/// were not scanned. Pops true on Close (leave the scanner), null or false
/// to keep scanning.
class LoadSummarySheet extends StatefulWidget {
  const LoadSummarySheet({
    super.key,
    required this.businessId,
    required this.container,
    required this.summary,
    this.caller = callContainerCallable,
    this.callTimeout = const Duration(seconds: 20),
    this.onLeft,
  });

  final String businessId;
  final ShippingContainer container;
  final LoadSummary summary;
  final ContainerCallableCaller caller;
  final Duration callTimeout;

  /// A package's unscanned pieces were left waiting: the screen updates
  /// its totals from the answer.
  final void Function(LoadLeaveAnswer answer)? onLeft;

  @override
  State<LoadSummarySheet> createState() => _LoadSummarySheetState();
}

class _LoadSummarySheetState extends State<LoadSummarySheet> {
  late final LoadSummaryView _view = LoadSummaryView.of(widget.summary);

  /// Kept whole ("Load all"), by line id.
  final Set<String> _whole = {};

  /// Left waiting: the part that stays behind, by line id.
  final Map<String, LoadPart> _left = {};
  String _leaving = '';

  Future<void> _leave(LoadLine line) async {
    if (_leaving.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _leaving = line.lineId);
    try {
      final answer = LoadLeaveAnswer.fromCallable(
        await widget
            .caller(
              loadCallable,
              loadLeaveRequest(
                businessId: widget.businessId,
                containerId: widget.container.id,
                lineId: line.lineId,
              ),
            )
            .timeout(widget.callTimeout),
      );
      if (!mounted) return;
      setState(() => _left[line.lineId] = answer.part);
      widget.onLeft?.call(answer);
      unawaited(AppFeedback.success());
    } catch (error) {
      if (!mounted) return;
      final failure = error is FirebaseFunctionsException
          ? parseLoadFailure(error.code, error.details)
          : loadFailureOf(error);
      showErrorSnackBar(
        context,
        loadLineActionErrorText(l10n, failure, fallback: l10n.lotCouldNotSave),
      );
    } finally {
      if (mounted) setState(() => _leaving = '');
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final view = _view;
    final destination = widget.container.destinationCountryName.isNotEmpty
        ? widget.container.destinationCountryName
        : l10n.ldgThisDestination;
    return LotSheetShell(
      title: l10n.ldgSummaryTitle,
      subtitle: widget.container.displayName,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (view.allClear)
            _SummaryNote(
              key: const Key('load-summary-clear'),
              icon: Icons.check_circle,
              color: AppColors.sage,
              text: l10n.ldgAllClear,
            ),
          if (view.showsIncomplete) ...[
            _SectionTitle(l10n.ldgIncompleteTitle),
            for (final line in view.incomplete)
              _IncompleteRow(
                key: ValueKey('load-incomplete-${line.lineId}'),
                line: line,
                whole: _whole.contains(line.lineId),
                part: _left[line.lineId],
                busy: _leaving == line.lineId,
                enabled: _leaving.isEmpty,
                onLoadAll: () => setState(() => _whole.add(line.lineId)),
                onLeave: () => _leave(line),
                onPrint: (part) => showContainerLabelSheet(
                  context,
                  businessId: widget.businessId,
                  lineIds: [part.lineId],
                ),
              ),
            const SizedBox(height: AppSpacing.md),
          ],
          if (view.showsUnscanned)
            _SummaryNote(
              key: const Key('load-summary-unscanned'),
              icon: Icons.info_outline,
              color: AppColors.muted,
              text: l10n.ldgUnscanned(view.unscannedCount),
              note: l10n.ldgUnscannedNote,
            ),
          if (view.showsWaiting) ...[
            _SummaryNote(
              key: const Key('load-summary-waiting'),
              icon: Icons.inventory_2_outlined,
              color: AppColors.warn,
              text: l10n.ldgWaitingNotScanned(view.waitingCount, destination),
            ),
            for (final line in view.waitingShown)
              Padding(
                padding: const EdgeInsets.only(left: 30, bottom: 2),
                child: Text(
                  [
                    if (line.trackingCode.isNotEmpty) line.trackingCode,
                    if (line.name.isNotEmpty) line.name,
                  ].join(' · '),
                  key: ValueKey('load-waiting-${line.lineId}'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13, color: AppColors.ink),
                ),
              ),
            if (view.waitingMore > 0)
              Padding(
                padding: const EdgeInsets.only(left: 30, top: 2),
                child: Text(
                  l10n.ldgWaitingMore(view.waitingMore),
                  style: const TextStyle(fontSize: 13, color: AppColors.muted),
                ),
              ),
          ],
        ],
      ),
      footer: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          LotSheetButton(
            key: const Key('load-summary-close'),
            label: l10n.close,
            onTap: _leaving.isEmpty
                ? () => Navigator.of(context).pop(true)
                : null,
          ),
          const SizedBox(height: AppSpacing.xs),
          TextButton(
            key: const Key('load-summary-keep'),
            onPressed: _leaving.isEmpty
                ? () => Navigator.of(context).pop(false)
                : null,
            child: Text(l10n.ldgKeepScanning),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w700,
        color: AppColors.ink,
      ),
    ),
  );
}

class _SummaryNote extends StatelessWidget {
  const _SummaryNote({
    super.key,
    required this.icon,
    required this.color,
    required this.text,
    this.note,
  });

  final IconData icon;
  final Color color;
  final String text;
  final String? note;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 20, color: color),
        const SizedBox(width: AppSpacing.sm + 2),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                text,
                style: const TextStyle(
                  fontSize: 14,
                  height: 1.35,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
              if (note != null)
                Text(
                  note!,
                  style: const TextStyle(
                    fontSize: 12.5,
                    height: 1.35,
                    color: AppColors.muted,
                  ),
                ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _IncompleteRow extends StatelessWidget {
  const _IncompleteRow({
    super.key,
    required this.line,
    required this.whole,
    required this.part,
    required this.busy,
    required this.enabled,
    required this.onLoadAll,
    required this.onLeave,
    required this.onPrint,
  });

  final LoadLine line;
  final bool whole;
  final LoadPart? part;
  final bool busy;
  final bool enabled;
  final VoidCallback onLoadAll;
  final VoidCallback onLeave;
  final void Function(LoadPart part) onPrint;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final left = part;
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            [
              if (line.trackingCode.isNotEmpty) line.trackingCode,
              if (line.name.isNotEmpty) line.name,
            ].join(' · '),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          Text(
            l10n.ldgIncompleteOf(line.scannedPieces, line.pieceCount),
            style: const TextStyle(
              fontSize: 13,
              height: 1.35,
              fontWeight: FontWeight.w600,
              color: loadBlue,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          if (left != null)
            Row(
              children: [
                const Icon(Icons.check, size: 18, color: AppColors.sage),
                const SizedBox(width: AppSpacing.xs),
                Expanded(
                  child: Text(
                    // A retried split (alreadyDone) may not name the part.
                    left.trackingCode.isEmpty
                        ? l10n.ldgRestWaiting
                        : l10n.ldgLeftWaiting(
                            left.pieceCount > 0
                                ? left.pieceCount
                                : line.unscannedPieces,
                            left.trackingCode,
                          ),
                    key: ValueKey('load-left-${line.lineId}'),
                    style: const TextStyle(fontSize: 13, color: AppColors.ink),
                  ),
                ),
                if (left.lineId.isNotEmpty)
                  TextButton.icon(
                    key: ValueKey('load-print-${line.lineId}'),
                    onPressed: () => onPrint(left),
                    icon: const Icon(Icons.qr_code_2, size: 18),
                    label: Text(l10n.pcsPrintPartsConfirm),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.cobaltDeep,
                      visualDensity: VisualDensity.compact,
                    ),
                  ),
              ],
            )
          else if (whole)
            Row(
              children: [
                const Icon(Icons.check, size: 18, color: AppColors.sage),
                const SizedBox(width: AppSpacing.xs),
                Expanded(
                  child: Text(
                    l10n.ldgGoesWhole,
                    key: ValueKey('load-whole-${line.lineId}'),
                    style: const TextStyle(fontSize: 13, color: AppColors.ink),
                  ),
                ),
              ],
            )
          else
            // Wrap, not Row: "En laisser 3 en attente" beside "Tout
            // charger" does not fit a narrow phone on one line.
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: [
                OutlinedButton(
                  key: ValueKey('load-all-${line.lineId}'),
                  onPressed: enabled ? onLoadAll : null,
                  child: Text(l10n.ldgLoadAll),
                ),
                OutlinedButton.icon(
                  key: ValueKey('load-leave-${line.lineId}'),
                  onPressed: enabled ? onLeave : null,
                  icon: busy
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.call_split, size: 18),
                  label: Text(l10n.ldgLeaveWaiting(line.unscannedPieces)),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
