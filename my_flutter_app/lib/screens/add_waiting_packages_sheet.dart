import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/container_manifest.dart';
import '../services/waiting_package_service.dart';
import '../services/waiting_packages.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/lot_sheets.dart';
import 'containers_screen.dart';

/// Opens the "add waiting packages" sheet for a container that is still
/// loading. Answers how many packages went on (null when dismissed).
Future<int?> showAddWaitingPackagesSheet(
  BuildContext context, {
  required String businessId,
  required ShippingContainer container,
  required List<ContainerLine> packages,
  ContainerCallableCaller caller = callContainerCallable,
}) =>
    showLotSheet<int>(
      context,
      AddWaitingPackagesSheet(
        businessId: businessId,
        container: container,
        packages: packages,
        caller: caller,
      ),
    );

/// Tick the waiting packages that go on this container - or "select all
/// matching" what the search shows. A package for another country than the
/// container goes to is shown disabled with the reason and cannot be ticked:
/// the server refuses it too, this just says so first. All or none: one call
/// puts every ticked package on the container, or none of them.
class AddWaitingPackagesSheet extends StatefulWidget {
  const AddWaitingPackagesSheet({
    super.key,
    required this.businessId,
    required this.container,
    required this.packages,
    this.caller = callContainerCallable,
  });

  final String businessId;
  final ShippingContainer container;

  /// The waiting packages, newest first.
  final List<ContainerLine> packages;
  final ContainerCallableCaller caller;

  @override
  State<AddWaitingPackagesSheet> createState() =>
      _AddWaitingPackagesSheetState();
}

class _AddWaitingPackagesSheetState extends State<AddWaitingPackagesSheet> {
  final _filter = TextEditingController();
  final Set<String> _selected = {};

  /// The packages the server named in its last refusal, marked in the list so
  /// the person can untick them and go on.
  Set<String> _flagged = {};
  bool _busy = false;
  String _note = '';

  @override
  void dispose() {
    _filter.dispose();
    super.dispose();
  }

  List<AssignableLine> get _everything =>
      assignableLines(widget.packages, widget.container);

  List<AssignableLine> get _visible {
    final shown = filterWaitingPackages(widget.packages, _filter.text)
        .map((l) => l.id)
        .toSet();
    return [
      for (final entry in _everything)
        if (shown.contains(entry.line.id)) entry,
    ];
  }

  void _toggle(String id) {
    setState(() {
      _flagged = {};
      _note = '';
      if (!_selected.remove(id)) _selected.add(id);
    });
  }

  Future<void> _assign() async {
    final l10n = AppLocalizations.of(context)!;
    if (_selected.isEmpty) {
      AppHaptics.refuse();
      setState(() => _note = l10n.wpkTickOne);
      return;
    }
    final refusal = assignSelectionRefusal(_selected.length);
    if (refusal != null) {
      AppHaptics.refuse();
      setState(() => _note = containerErrorText(l10n, refusal));
      return;
    }
    setState(() {
      _busy = true;
      _note = '';
      _flagged = {};
    });
    try {
      final data = await widget.caller(
        'assignContainerLines',
        assignLinesRequest(
            widget.businessId, widget.container.id, _selected),
      );
      if (!mounted) return;
      AppHaptics.commit();
      final assigned = data is Map && data['assigned'] is num
          ? (data['assigned'] as num).round()
          : _selected.length;
      Navigator.of(context).pop(assigned);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      final refused = parseContainerRefusal(error.details, error.message);
      setState(() {
        _flagged = refused.lineIds.toSet();
        _note = containerRefusalText(l10n, error);
      });
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _note = l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _reason(AppLocalizations l10n, AssignableLine entry) {
    if (entry.refusal == 'container_destination_required') {
      return l10n.wpkErrContainerDestinationRequired;
    }
    final line = entry.line;
    final from = line.destinationCountryName.isEmpty
        ? line.destinationCountryId
        : line.destinationCountryName;
    final c = widget.container;
    final to = c.destinationCountryName.isEmpty
        ? c.destinationCountryId
        : c.destinationCountryName;
    return l10n.wpkBlockedMismatch(from, to);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final visible = _visible;
    final takeable = visible.where((e) => !e.blocked).length;
    final hasDestination =
        widget.container.destinationCountryId.trim().isNotEmpty;

    return LotSheetShell(
      title: l10n.wpkAddWaiting,
      subtitle: l10n.wpkAddWaitingNote(widget.container.displayName),
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_note.isNotEmpty) ...[
            ContainerRefusalNote(text: _note),
            const SizedBox(height: AppSpacing.sm),
          ],
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: Text(
              l10n.wpkSelected(_selected.length),
              key: const Key('assign-count'),
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ),
          LotSheetButton(
            key: const Key('assign-submit'),
            label: l10n.wpkAddToContainer,
            busy: _busy,
            busyLabel: l10n.ctrAdding,
            onTap: _selected.isEmpty ? null : _assign,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Without a destination of its own the container takes nothing
          // that names one; say so once, up here, rather than on every row.
          if (!hasDestination) ...[
            Container(
              key: const Key('assign-no-destination'),
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.warn.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                border: Border.all(color: AppColors.warn.withValues(alpha: 0.4)),
              ),
              child: Text(
                l10n.wpkErrContainerDestinationRequired,
                style: const TextStyle(
                  fontSize: 12.5,
                  height: 1.35,
                  fontWeight: FontWeight.w600,
                  color: AppColors.warn,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
          if (widget.packages.isEmpty)
            LotEmptyState(
              key: const Key('assign-empty'),
              icon: Icons.inventory_2_outlined,
              title: l10n.wpkNoneWaiting,
            )
          else ...[
            TextField(
              key: const Key('assign-search'),
              controller: _filter,
              enabled: !_busy,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: l10n.ctrSearchHint,
                prefixIcon:
                    const Icon(Icons.search, size: 20, color: AppColors.muted),
                isDense: true,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                TextButton(
                  key: const Key('assign-select-all'),
                  onPressed: _busy || takeable == 0
                      ? null
                      : () => setState(() {
                            _flagged = {};
                            _note = '';
                            _selected
                              ..clear()
                              ..addAll(selectAllMatching(visible, _selected));
                          }),
                  child: Text(l10n.wpkSelectAll),
                ),
                if (_selected.isNotEmpty)
                  TextButton(
                    key: const Key('assign-clear'),
                    onPressed: _busy
                        ? null
                        : () => setState(() {
                              _selected.clear();
                              _flagged = {};
                            }),
                    child: Text(l10n.wpkClear),
                  ),
              ],
            ),
            if (visible.isEmpty)
              LotEmptyState(
                icon: Icons.search_off,
                title: l10n.wpkNoMatch,
              )
            else
              for (final entry in visible)
                _PickRow(
                  key: ValueKey('assign-row:${entry.line.id}'),
                  entry: entry,
                  reason: entry.blocked ? _reason(l10n, entry) : '',
                  selected: _selected.contains(entry.line.id),
                  flagged: _flagged.contains(entry.line.id),
                  enabled: !_busy && !entry.blocked,
                  onTap: () => _toggle(entry.line.id),
                ),
          ],
        ],
      ),
    );
  }
}

class _PickRow extends StatelessWidget {
  const _PickRow({
    super.key,
    required this.entry,
    required this.reason,
    required this.selected,
    required this.flagged,
    required this.enabled,
    required this.onTap,
  });

  final AssignableLine entry;
  final String reason;
  final bool selected;
  final bool flagged;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final line = entry.line;
    final size = packageSize(line);
    final people = [line.customerName, line.customerPhone]
        .where((p) => p.isNotEmpty)
        .join(' · ');
    final facts = [
      if (line.destinationCountryName.isNotEmpty) line.destinationCountryName,
      if (size != null) '${size.dimensionsText} · ${size.volumeText}',
      if (line.trackingCode.isNotEmpty) line.trackingCode,
    ].join(' · ');
    return Opacity(
      opacity: entry.blocked ? 0.6 : 1,
      // The tile paints its own ink on the nearest Material, so the card is
      // that Material rather than a coloured box behind it.
      child: Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
        child: Material(
          color: selected ? AppColors.mist : AppColors.parchment,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            side: BorderSide(
              color: flagged
                  ? AppColors.errorRed
                  : (selected ? AppColors.cobalt : AppColors.rule),
            ),
          ),
          clipBehavior: Clip.antiAlias,
          child: CheckboxListTile(
            value: selected,
            onChanged: enabled ? (_) => onTap() : null,
            controlAffinity: ListTileControlAffinity.leading,
            dense: true,
            title: Text(
              containerLineTitle(l10n, line),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
              ),
            ),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (people.isNotEmpty)
                  Text(people,
                      style: const TextStyle(
                          fontSize: 12.5, color: AppColors.muted)),
                if (facts.isNotEmpty)
                  Text(facts,
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.muted)),
                if (entry.blocked)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      reason,
                      key: Key('assign-block:${line.id}'),
                      style: const TextStyle(
                        fontSize: 12,
                        height: 1.3,
                        fontWeight: FontWeight.w600,
                        color: AppColors.warn,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
