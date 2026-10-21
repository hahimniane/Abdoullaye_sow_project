/// The pure half of the containers screen's feed (`ContainerFeed` in
/// `screens/containers_screen.dart`): which reads it keeps open, and how
/// their rows become one list.
///
/// The feed used to listen to every container and every line a business
/// ever had - a read per document each time the screen opened, growing with
/// every sailing. It now reads, the way the console's containers panel does:
///
///  - the open boxes (loading, at sea) and their lines, whole and live;
///  - the packages waiting for a box, whole and live;
///  - the arrived boxes newest first, a page at a time, and the lines of
///    exactly those boxes (an `in` filter, [firestoreWhereInLimit] ids a
///    read);
///  - any one box opened from a link that is not on screen yet;
///  - the rest of every split package on screen, because a package's money
///    lives on its root and the root may have sailed long ago.
///
/// Counts stay exact: loading and at-sea from the whole open set, arrived
/// from a server `count()` ([arrivedCountShown]).
library;

import 'business_activity_queries.dart' show firestoreWhereInLimit;
import 'container_manifest.dart';

/// Splits [wanted] ids into `in`-sized groups, keeping every id that is
/// still wanted in the group it was already in.
///
/// A group whose ids did not change is returned as an equal list, so the
/// feed keeps that listener and only re-opens the groups that did change -
/// paging in 25 more boxes opens one more read, it does not re-read the
/// boxes already on screen. Ids are kept in [wanted]'s order inside new
/// groups; duplicates and blanks are dropped.
List<List<String>> planIdChunks(
  List<List<String>> current,
  Iterable<String> wanted, {
  int size = firestoreWhereInLimit,
}) {
  assert(size > 0);
  final want = <String>{
    for (final id in wanted)
      if (id.trim().isNotEmpty) id.trim(),
  };
  final placed = <String>{};
  final out = <List<String>>[];
  final shrank = <bool>[];
  for (final chunk in current) {
    final kept = [
      for (final id in chunk)
        if (want.contains(id) && placed.add(id)) id,
    ];
    if (kept.isEmpty) continue;
    out.add(kept);
    shrank.add(kept.length < chunk.length);
  }
  final fresh = [
    for (final id in want)
      if (!placed.contains(id)) id,
  ];
  var next = 0;
  // Top up the groups that lost an id before opening new ones: a group that
  // changed is re-read anyway, while one that grows would be re-read only
  // for the growing - so an untouched group stays untouched.
  for (var i = 0; i < out.length && next < fresh.length; i++) {
    if (!shrank[i]) continue;
    while (out[i].length < size && next < fresh.length) {
      out[i] = [...out[i], fresh[next++]];
    }
  }
  while (next < fresh.length) {
    final end = (next + size) > fresh.length ? fresh.length : next + size;
    out.add(fresh.sublist(next, end));
    next = end;
  }
  return out;
}

/// A stable name for one `in` group, so a listener can be kept by it.
String chunkKey(List<String> chunk) => chunk.join('\u0000');

/// The roots of the split packages among [lines]: a part names its root, and
/// a root that has handed out parts says so with `lastPartIndex` above 1.
/// A line never split is a group of one and needs no further read.
Set<String> splitGroupRoots(Iterable<ContainerLine> lines) => {
  for (final line in lines)
    if (line.isPart)
      line.rootLineId
    else if (line.lastPartIndex > 1 && line.id.isNotEmpty)
      line.id,
};

/// [roots] whose own line is not among [lines]: a root written before
/// groups existed carries no `rootLineId`, so the group read cannot find it
/// and it is read by id instead.
Set<String> missingRoots(Set<String> roots, Iterable<ContainerLine> lines) {
  if (roots.isEmpty) return <String>{};
  final have = {for (final line in lines) line.id};
  return {
    for (final root in roots)
      if (!have.contains(root)) root,
  };
}

/// Rows from several live reads as one list, each id once. The same
/// document can sit in two reads for a moment - a box that just arrived is
/// still in the open read's last answer and already in the arrived page -
/// so the copy written last wins; on a tie, or with no stamp, the earlier
/// read wins.
List<T> mergeFreshest<T>(
  Iterable<Iterable<T>> reads,
  String Function(T) idOf,
  DateTime? Function(T) stampOf,
) {
  final byId = <String, T>{};
  for (final read in reads) {
    for (final row in read) {
      final id = idOf(row);
      if (id.isEmpty) continue;
      final held = byId[id];
      if (held == null) {
        byId[id] = row;
        continue;
      }
      final a = stampOf(held), b = stampOf(row);
      if (a != null && b != null && b.isAfter(a)) byId[id] = row;
    }
  }
  return byId.values.toList();
}

/// Every container the feed holds: open, the arrived pages, and any opened
/// from a link. Sorted the way the list shows them.
List<ShippingContainer> mergeFeedContainers(
  Iterable<Iterable<ShippingContainer>> reads,
) => sortContainers(
  mergeFreshest<ShippingContainer>(reads, (c) => c.id, (c) => c.updatedAt),
);

/// Every line the feed holds, each once.
List<ContainerLine> mergeFeedLines(Iterable<Iterable<ContainerLine>> reads) =>
    mergeFreshest<ContainerLine>(reads, (l) => l.id, (l) => l.updatedAt);

/// The arrived boxes whose lines are read by id: the arrived ones the feed
/// holds, and any box opened from a link that the open read does not
/// already cover.
List<String> containerIdsNeedingLines({
  required Iterable<ShippingContainer> arrived,
  required Iterable<String> focused,
  required Iterable<ShippingContainer> open,
}) {
  final openIds = {for (final c in open) c.id};
  final out = <String>[];
  final seen = <String>{};
  for (final id in [for (final c in arrived) c.id, ...focused]) {
    if (id.isEmpty || openIds.contains(id) || !seen.add(id)) continue;
    out.add(id);
  }
  return out;
}

/// What the Arrived chip says: the server's count of every arrived box once
/// it answers, and never fewer than the list already shows.
int arrivedCountShown(int? serverCount, int loadedArrived) {
  if (serverCount == null) return loadedArrived;
  return serverCount < loadedArrived ? loadedArrived : serverCount;
}

/// Whether the arrived read came back full, so an older page may exist.
bool arrivedPageFull(int rows, int limit) => limit > 0 && rows >= limit;
