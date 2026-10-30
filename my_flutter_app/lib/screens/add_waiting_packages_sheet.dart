import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/container_manifest.dart';
import '../services/package_proof.dart' show senderProblemLineIds;
import '../services/waiting_package_service.dart';
import '../services/waiting_packages.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../widgets/lot_sheets.dart';
import 'containers_screen.dart';

/// Opens the "add waiting packages" sheet for a container that is still
/// loading. Answers what went on - how many packages, and the parts a split
/// left waiting - or null when dismissed.
Future<AssignLinesResult?> showAddWaitingPackagesSheet(
  BuildContext context, {
  required String businessId,
  required ShippingContainer container,
  required List<ContainerLine> packages,
  List<ContainerLine> lines = const [],
  ContainerCallableCaller caller = callContainerCallable,
}) => showLotSheet<AssignLinesResult>(
  context,
  AddWaitingPackagesSheet(
    businessId: businessId,
    container: container,
    packages: packages,
    lines: lines,
    caller: caller,
  ),
);

/// Tick the waiting packages that go on this container - or "select all
/// matching" what the search shows. A package for another country than the
/// container goes to is shown disabled with the reason and cannot be ticked:
/// the server refuses it too, this just says so first. All or none: one call
/// puts every ticked package on the container, or none of them.
///
/// A ticked package of several pieces asks how many go in ("Pieces going
/// in: 2 of 4"). Fewer than all splits it (docs/WAITING_PACKAGES.md "Split
/// across containers"): its own code rides with the pieces that go, the rest
/// stay waiting as a new part (`CL-T9W2QA-2`) that needs new labels. No
/// message is sent by a split.
class AddWaitingPackagesSheet extends StatefulWidget {
  const AddWaitingPackagesSheet({
    super.key,
    required this.businessId,
    required this.container,
    required this.packages,
    this.lines = const [],
    this.caller = callContainerCallable,
  });

  final String businessId;
  final ShippingContainer container;

  /// The waiting packages, newest first.
  final List<ContainerLine> packages;

  /// Every line the screen holds, so a split previews the code its waiting
  /// part will get (one past the group's highest part).
  final List<ContainerLine> lines;
  final ContainerCallableCaller caller;

  @override
  State<AddWaitingPackagesSheet> createState() =>
      _AddWaitingPackagesSheetState();
}

class _AddWaitingPackagesSheetState extends State<AddWaitingPackagesSheet> {
  final _filter = TextEditingController();
  final Set<String> _selected = {};

  /// How many pieces of a ticked package go in, when not all of them do.
  final Map<String, int> _going = {};

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
    final shown = filterWaitingPackages(
      widget.packages,
      _filter.text,
    ).map((l) => l.id).toSet();
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

  /// All of a package's pieces go in unless the stepper says fewer.
  int _goingOf(ContainerLine line) => _going[line.id] ?? line.pieceCount;

  void _step(ContainerLine line, int delta) {
    final next = _goingOf(line) + delta;
    if (next < 1 || next > line.pieceCount) return;
    AppHaptics.selection();
    setState(() {
      _note = '';
      _flagged = {};
      if (next == line.pieceCount) {
        _going.remove(line.id);
      } else {
        _going[line.id] = next;
      }
    });
  }

  Future<void> _assign({bool acknowledgeProblems = false}) async {
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
          widget.businessId,
          widget.container.id,
          _selected,
          pieceCounts: _going,
          pieceTotals: {
            for (final line in widget.packages) line.id: line.pieceCount,
          },
          acknowledgeProblems: acknowledgeProblems,
        ),
      );
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(
        context,
      ).pop(AssignLinesResult.fromCallable(data, sent: _selected.length));
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      // A sender's "Something's wrong" (docs/AIR_PACKAGES.md §4.8) warns,
      // never blocks: name the packages, ask, and send again confirmed.
      final problems = senderProblemLineIds(error.details);
      if (problems.isNotEmpty && !acknowledgeProblems) {
        setState(() {
          _busy = false;
          _flagged = problems.toSet();
        });
        final codes = [
          for (final id in problems)
            widget.packages
                    .where((l) => l.id == id)
                    .firstOrNull
                    ?.trackingCode ??
                id,
        ].where((c) => c.isNotEmpty).join(', ');
        final load = await confirmMajorAction(
          context,
          title: l10n.proofLoadAnywayTitle,
          message: l10n.proofLoadAnywayMessage(codes),
          confirmLabel: l10n.proofLoadAnyway,
          icon: Icons.error_outline,
        );
        if (load && mounted) await _assign(acknowledgeProblems: true);
        return;
      }
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
    // Going the other way (docs/AIR_PACKAGES.md §7): say how it ships.
    if (entry.refusal == 'ship_mode_mismatch') {
      return entry.line.isAirPackage
          ? l10n.wpkBlockedShipsByAir
          : l10n.wpkBlockedShipsBySea;
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
    final hasDestination = widget.container.destinationCountryId
        .trim()
        .isNotEmpty;

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
                border: Border.all(
                  color: AppColors.warn.withValues(alpha: 0.4),
                ),
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
                prefixIcon: const Icon(
                  Icons.search,
                  size: 20,
                  color: AppColors.muted,
                ),
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
              LotEmptyState(icon: Icons.search_off, title: l10n.wpkNoMatch)
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
                  // A ticked package of several pieces: how many go in.
                  split:
                      _selected.contains(entry.line.id) &&
                          !entry.line.isCar &&
                          entry.line.pieceCount > 1
                      ? splitPreview(
                          entry.line,
                          _goingOf(entry.line),
                          widget.lines,
                        )
                      : null,
                  onFewer: _busy ? null : () => _step(entry.line, -1),
                  onMore: _busy ? null : () => _step(entry.line, 1),
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
    this.split,
    this.onFewer,
    this.onMore,
  });

  final AssignableLine entry;
  final String reason;
  final bool selected;
  final bool flagged;
  final bool enabled;
  final VoidCallback onTap;

  /// How many of its pieces go in, and what that leaves; null when the
  /// package goes whole without asking (one piece, a car, not ticked).
  final SplitPreview? split;
  final VoidCallback? onFewer;
  final VoidCallback? onMore;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final line = entry.line;
    final size = packageSize(line);
    // With no sender, the receiver is the customer (lineCustomer).
    final people = [
      lineCustomerName(line),
      lineCustomerPhone(line),
    ].where((p) => p.isNotEmpty).join(' · ');
    final facts = [
      if (!line.isCar) l10n.pcsPieceCount(line.pieceCount),
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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              CheckboxListTile(
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
                      Text(
                        people,
                        style: const TextStyle(
                          fontSize: 12.5,
                          color: AppColors.muted,
                        ),
                      ),
                    if (facts.isNotEmpty)
                      Text(
                        facts,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
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
              if (split != null)
                SplitPieces(
                  lineId: line.id,
                  preview: split!,
                  onFewer: onFewer,
                  onMore: onMore,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "Pieces going in: 2 of 4", with what that does: this code and its
/// pieces go in, a new code stays waiting with the rest - and nobody is
/// messaged now (each part gets its own departed and ready-for-pickup
/// messages later), but the pieces that stay need new labels.
class SplitPieces extends StatelessWidget {
  const SplitPieces({
    super.key,
    required this.lineId,
    required this.preview,
    this.onFewer,
    this.onMore,
  });

  final String lineId;
  final SplitPreview preview;
  final VoidCallback? onFewer;
  final VoidCallback? onMore;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final p = preview;
    Widget stepButton(
      String key,
      IconData icon,
      String label,
      VoidCallback? onTap,
    ) => SizedBox(
      width: 44,
      height: 44,
      child: IconButton.outlined(
        key: Key('$key:$lineId'),
        onPressed: onTap,
        icon: Icon(icon, size: 20),
        tooltip: label,
      ),
    );
    Widget previewRow(String key, String code, String text, Color tint) =>
        Container(
          key: Key('$key:$lineId'),
          margin: const EdgeInsets.only(top: AppSpacing.sm),
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: AppSpacing.sm,
          ),
          decoration: BoxDecoration(
            color: tint.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (code.isNotEmpty) ...[
                Text(
                  code,
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: tint,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
              ],
              Expanded(
                child: Text(
                  text,
                  style: const TextStyle(fontSize: 13, color: AppColors.ink),
                ),
              ),
            ],
          ),
        );

    return Container(
      key: Key('assign-split:$lineId'),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        0,
        AppSpacing.md,
        AppSpacing.md,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.pcsGoingIn,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              stepButton(
                'assign-fewer',
                Icons.remove,
                l10n.pcsFewer,
                p.going > 1 ? onFewer : null,
              ),
              SizedBox(
                width: 72,
                child: Text(
                  l10n.pcsGoingOf(p.going, p.total),
                  key: Key('assign-going:$lineId'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
              ),
              stepButton(
                'assign-more',
                Icons.add,
                l10n.pcsMore,
                p.going < p.total ? onMore : null,
              ),
            ],
          ),
          if (p.splits) ...[
            previewRow(
              'assign-preview-going',
              p.code,
              l10n.pcsPreviewGoing(p.going),
              AppColors.cobaltDeep,
            ),
            previewRow(
              'assign-preview-staying',
              p.partCode,
              l10n.pcsPreviewStaying(p.staying),
              AppColors.warn,
            ),
            const SizedBox(height: 6),
            Text(
              l10n.pcsSplitNote,
              key: Key('assign-split-note:$lineId'),
              style: const TextStyle(
                fontSize: 12,
                height: 1.4,
                color: AppColors.muted,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
