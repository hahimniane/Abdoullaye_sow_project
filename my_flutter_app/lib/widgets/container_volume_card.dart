import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/business_volume.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';

/// "This month": pieces received and containers shipped, at the top of the
/// containers screen - the business's own monthly volume, the same numbers
/// as the console's Volume tab (`getBusinessVolume`). Shown to whoever opens
/// Containers (the owner, and staff holding the containers permission, as on
/// the console).
///
/// Loaded in initState, then again whenever [refreshKey] changes (the
/// containers screen passes a signature of its live lines and containers),
/// [refreshDelay] after the change so the server's recount (it waits 1.5 s
/// for a burst) has landed. The rollup itself is server-only (rules deny
/// clients), so the card cannot listen to it. The spinner always resolves
/// (a safety timeout), a refresh keeps the last numbers on screen, and a
/// failure offers a retry rather than a wrong zero.
class ContainerVolumeCard extends StatefulWidget {
  const ContainerVolumeCard({
    super.key,
    required this.businessId,
    this.service = const BusinessVolumeService(),
    this.timeout = const Duration(seconds: 20),
    this.refreshKey,
    this.refreshDelay = const Duration(seconds: 4),
  });

  final String businessId;
  final BusinessVolumeService service;
  final Duration timeout;

  /// What the month's numbers are counted from, as the screen sees it; a
  /// change reloads the card. Null while the screen has not loaded yet.
  final Object? refreshKey;
  final Duration refreshDelay;

  @override
  State<ContainerVolumeCard> createState() => _ContainerVolumeCardState();
}

class _ContainerVolumeCardState extends State<ContainerVolumeCard> {
  BusinessVolume? _volume;
  bool _loading = true;
  bool _failed = false;
  int _attempt = 0;

  @override
  void initState() {
    super.initState();
    _load(initial: true);
  }

  Timer? _refresh;

  @override
  void didUpdateWidget(covariant ContainerVolumeCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.businessId != widget.businessId) {
      _refresh?.cancel();
      _load();
      return;
    }
    // A write the month is counted from (a line received, split, removed;
    // a container shipped): reload once the burst settles. The first key
    // (the screen's first load) is no change.
    if (oldWidget.refreshKey != null &&
        widget.refreshKey != null &&
        oldWidget.refreshKey != widget.refreshKey) {
      _refresh?.cancel();
      _refresh = Timer(widget.refreshDelay, () {
        if (mounted) _load(quiet: true);
      });
    }
  }

  @override
  void dispose() {
    _refresh?.cancel();
    super.dispose();
  }

  /// [quiet]: a refresh behind numbers already shown - no spinner, and a
  /// failure keeps them (the next change or a retry tries again).
  Future<void> _load({bool initial = false, bool quiet = false}) async {
    final attempt = ++_attempt;
    if (initial) {
      _loading = true;
      _failed = false;
    } else if (!quiet) {
      setState(() {
        _loading = true;
        _failed = false;
      });
    }
    try {
      final volume = await widget.service
          .thisMonth(widget.businessId)
          .timeout(widget.timeout);
      if (!mounted || attempt != _attempt) return;
      setState(() => _volume = volume);
    } catch (_) {
      if (!mounted || attempt != _attempt) return;
      if (!(quiet && _volume != null)) setState(() => _failed = true);
    } finally {
      if (mounted && attempt == _attempt) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.businessId.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final volume = _volume;
    final start = volume?.monthStart;
    const muted = TextStyle(fontSize: 12.5, height: 1.3, color: AppColors.muted);

    Widget body;
    if (_loading && volume == null) {
      body = const Padding(
        padding: EdgeInsets.symmetric(vertical: 2),
        child: SizedBox(
          height: 16,
          width: 16,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      );
    } else if (_failed && volume == null) {
      body = Text(l10n.volumeLoadFailed,
          key: const Key('volume-card-failed'), style: muted);
    } else {
      body = Wrap(
        spacing: AppSpacing.md,
        runSpacing: 2,
        children: [
          Text(
            l10n.volumePiecesReceived(volume?.pieces ?? 0),
            key: const Key('volume-card-pieces'),
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          Text(
            l10n.volumeContainersShipped(volume?.containersShipped ?? 0),
            key: const Key('volume-card-containers'),
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: AppColors.cobaltDeep,
            ),
          ),
        ],
      );
    }

    return Container(
      key: const Key('container-volume-card'),
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: AppSpacing.sm + 2),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        children: [
          const Icon(Icons.bar_chart_rounded,
              size: 20, color: AppColors.cobaltDeep),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  start == null
                      ? l10n.volumeThisMonth
                      : l10n.volumeThisMonthNamed(
                          displayMonthYear(start, locale)),
                  style: muted,
                ),
                const SizedBox(height: 2),
                body,
              ],
            ),
          ),
          if (_failed && volume == null)
            IconButton(
              key: const Key('volume-card-retry'),
              tooltip: l10n.retry,
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh, size: 20),
            ),
        ],
      ),
    );
  }
}
