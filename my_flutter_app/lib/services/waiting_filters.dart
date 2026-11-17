/// The Waiting list's filters as one pure computation (docs/AIR_PACKAGES.md
/// §1.11 and §7): the search, "Missing proof", and Air / Sea, with the
/// counts the chips show and what an empty list should say. Mirrors the
/// console's `waiting-packages-panel.tsx`, so the phone and the website
/// read the same list the same way.
library;

import 'container_manifest.dart';
import 'waiting_packages.dart';

/// Why the list is empty, which picks its sentence. Mirrors the console's
/// empty-state branches.
enum WaitingEmpty {
  /// Something is shown.
  none,

  /// Nothing waits at all.
  noPackages,

  /// The search found nothing.
  noSearchMatch,

  /// "Missing proof" is on and every package has its proof.
  allHaveProof,

  /// Only Air or only Sea is on and nothing ships that way.
  noShipMode,
}

class WaitingFilterView {
  const WaitingFilterView({
    required this.shown,
    required this.total,
    required this.missingCount,
    required this.airCount,
    required this.modeFilterShown,
    required this.empty,
  });

  /// What the list shows.
  final List<ContainerLine> shown;

  /// Every waiting package, whatever the filters.
  final int total;

  /// How many of them lack a drop-off photo or the sender's OK.
  final int missingCount;
  final int airCount;
  int get seaCount => total - airCount;

  /// Whether the Air / Sea chips are offered.
  final bool modeFilterShown;
  final WaitingEmpty empty;
}

/// Whether the Air / Sea chips are offered: a business that ships by air,
/// unless it ships only by air and nothing waiting goes by sea.
bool waitingModeFilterShown({
  required bool shipsByAir,
  required bool airOnly,
  required int airCount,
  required int total,
}) => shipsByAir && (!airOnly || airCount < total);

/// The list the filters show, and the counts beside the chips. [mode] is
/// "", "air" or "sea"; it is ignored when the chips are not offered.
/// [missingOnly] keeps the packages missing a tick.
WaitingFilterView waitingFilterView(
  Iterable<ContainerLine> waiting, {
  String query = '',
  bool missingOnly = false,
  String mode = '',
  bool shipsByAir = false,
  bool airOnly = false,
}) {
  final all = waiting.toList();
  final airCount = all
      .where((l) => containerShipModeOf(l.shipMode) == containerShipModeAir)
      .length;
  final missingCount = all.where((l) => l.proofTicks.missing).length;
  final modeShown = waitingModeFilterShown(
    shipsByAir: shipsByAir,
    airOnly: airOnly,
    airCount: airCount,
    total: all.length,
  );
  final searched = filterWaitingPackages(all, query);
  final proofed = missingOnly
      ? [
          for (final l in searched)
            if (l.proofTicks.missing) l,
        ]
      : searched;
  final shown = filterWaitingByShipMode(proofed, modeShown ? mode : '');

  final searching = query.trim().length >= 2;
  final WaitingEmpty empty;
  if (shown.isNotEmpty) {
    empty = WaitingEmpty.none;
  } else if (all.isEmpty) {
    empty = WaitingEmpty.noPackages;
  } else if (missingOnly && !searching) {
    empty = WaitingEmpty.allHaveProof;
  } else if (searching) {
    empty = WaitingEmpty.noSearchMatch;
  } else if (modeShown && mode.trim().isNotEmpty) {
    empty = WaitingEmpty.noShipMode;
  } else {
    empty = WaitingEmpty.noPackages;
  }
  return WaitingFilterView(
    shown: shown,
    total: all.length,
    missingCount: missingCount,
    airCount: airCount,
    modeFilterShown: modeShown,
    empty: empty,
  );
}
