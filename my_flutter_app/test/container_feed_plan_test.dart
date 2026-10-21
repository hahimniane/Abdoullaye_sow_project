import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_activity_queries.dart';
import 'package:my_flutter_app/services/container_feed_plan.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/firestore_query_spec.dart';
import 'package:my_flutter_app/services/waiting_packages.dart';

import 'firestore_query_scope_test.dart' show run;

/// The containers screen's feed reads the open boxes and waiting packages
/// whole, the arrived boxes a page at a time, and the rest of every split
/// package on screen - instead of every container and line the business
/// ever had. These tests hold it to the same answers the whole history
/// gave: the chip counts, the waiting list, every box's lines, and every
/// package's group money.
const _biz = 'biz-1';

Map<String, dynamic> _box(
  String id,
  String status, {
  int day = 1,
  String business = _biz,
}) => {
  'id': id,
  'businessId': business,
  'status': status,
  'label': 'Box $id',
  'createdAt': DateTime(2026, 1, day),
  'updatedAt': DateTime(2026, 1, day),
  if (status == containerStatusArrived) 'arrivedAt': DateTime(2026, 1, day),
};

Map<String, dynamic> _line(
  String id, {
  String containerId = '',
  required String containerStatus,
  String rootLineId = '',
  int partIndex = 1,
  int lastPartIndex = 1,
  int priceCents = 1000,
  int paidCents = 0,
  String business = _biz,
}) => {
  'id': id,
  'businessId': business,
  'containerId': containerId,
  'containerStatus': containerStatus,
  'kind': containerLineKindBarrels,
  'quantity': 1,
  'ownerKind': containerOwnerCustomer,
  'customerName': 'Customer $id',
  'trackingCode': 'CL-$id',
  'rootLineId': rootLineId,
  'partIndex': partIndex,
  'lastPartIndex': lastPartIndex,
  'priceCents': priceCents,
  'paidCents': paidCents,
  'createdAt': DateTime(2026, 1, 1),
};

ShippingContainer _c(Map<String, dynamic> row) =>
    ShippingContainer.fromMap(row['id'] as String, row);
ContainerLine _l(Map<String, dynamic> row) =>
    ContainerLine.fromMap(row['id'] as String, row);

/// What the feed holds after every read it opens has answered, replayed in
/// memory over [boxes] and [lines] with [pages] arrived pages and the
/// [focused] boxes opened from links.
({
  List<ShippingContainer> containers,
  List<ContainerLine> lines,
  Map<String, int> counts,
  int docsRead,
})
_replayFeed(
  List<Map<String, dynamic>> boxes,
  List<Map<String, dynamic>> lines, {
  int pages = 1,
  List<String> focused = const [],
}) {
  var read = 0;
  List<Map<String, dynamic>> q(
    FirestoreQuerySpec spec,
    List<Map<String, dynamic>> rows,
  ) {
    var out = run(spec, rows);
    final order = spec.orderBy;
    if (order != null) {
      out = out.where((r) => r[order] != null).toList()
        ..sort((a, b) {
          final x = a[order] as DateTime, y = b[order] as DateTime;
          return spec.descending ? y.compareTo(x) : x.compareTo(y);
        });
    }
    final limit = spec.limit;
    if (limit != null && out.length > limit) out = out.sublist(0, limit);
    read += out.length;
    return out;
  }

  final open = q(openContainersSpec(_biz), boxes).map(_c).toList();
  final arrived = q(
    arrivedContainersPageSpec(_biz, pages: pages),
    boxes,
  ).map(_c).toList();
  final linked = [
    for (final id in focused)
      ...boxes.where((b) => b['id'] == id && b['businessId'] == _biz).map(_c),
  ];
  read += linked.length;
  final openLines = q(openContainerLinesSpec(_biz), lines).map(_l).toList();
  final waiting = q(waitingContainerLinesSpec(_biz), lines).map(_l).toList();
  final chunks = planIdChunks(
    const [],
    containerIdsNeedingLines(
      arrived: [...arrived, ...linked],
      focused: focused,
      open: open,
    ),
  );
  final chunkLines = [
    for (final chunk in chunks)
      ...q(containerLinesOfContainersSpec(_biz, chunk), lines).map(_l),
  ];
  var held = mergeFeedLines([openLines, waiting, chunkLines]);
  // The group reads, to their fixpoint, the way the feed re-plans them.
  var groupRows = <ContainerLine>[];
  var rootRows = <ContainerLine>[];
  for (var round = 0; round < 5; round++) {
    final roots = splitGroupRoots(held);
    final groupChunks = planIdChunks(const [], roots.toList()..sort());
    groupRows = [
      for (final chunk in groupChunks)
        ...q(containerLineGroupsSpec(_biz, chunk), lines).map(_l),
    ];
    final withGroups = mergeFeedLines([held, groupRows]);
    final missing = missingRoots(roots, withGroups);
    rootRows = [
      for (final id in missing)
        ...lines.where((r) => r['id'] == id && r['businessId'] == _biz).map(_l),
    ];
    read += rootRows.length;
    final next = mergeFeedLines([withGroups, rootRows]);
    if (next.length == held.length) {
      held = next;
      break;
    }
    held = next;
  }
  final serverArrived = run(arrivedContainersCountSpec(_biz), boxes).length;
  final counts = {
    for (final s in containerStatuses) s: 0,
    for (final s in containerStatuses)
      if (s != containerStatusArrived)
        s: open.where((c) => c.status == s).length,
    containerStatusArrived: arrivedCountShown(serverArrived, arrived.length),
  };
  return (
    containers: mergeFeedContainers([open, arrived, linked]),
    lines: held,
    counts: counts,
    docsRead: read,
  );
}

void main() {
  group('planIdChunks', () {
    test('splits ids into in-sized groups, in order, once each', () {
      final ids = [for (var i = 0; i < 65; i++) 'c$i'];
      final plan = planIdChunks(const [], [...ids, 'c3', ' ', '']);
      expect(plan.map((c) => c.length), [30, 30, 5]);
      expect(plan.expand((c) => c), ids);
    });

    test('a group whose ids did not change is kept as it was', () {
      final first = planIdChunks(const [], [
        for (var i = 0; i < 25; i++) 'a$i',
      ]);
      final next = planIdChunks(first, [
        for (var i = 0; i < 25; i++) 'a$i',
        for (var i = 0; i < 25; i++) 'b$i',
      ]);
      // Paging in 25 more boxes opens one more read; the first is untouched.
      expect(next.length, 2);
      expect(chunkKey(next.first), chunkKey(first.first));
      expect(next.last, [for (var i = 0; i < 25; i++) 'b$i']);
    });

    test('a group that lost an id is topped up before a new one opens', () {
      final first = planIdChunks(const [], ['a', 'b', 'c']);
      final next = planIdChunks(first, ['a', 'c', 'd']);
      expect(next, [
        ['a', 'c', 'd'],
      ]);
      expect(planIdChunks(next, const <String>[]), isEmpty);
    });

    test('never exceeds the in limit', () {
      var plan = const <List<String>>[];
      for (var round = 1; round <= 6; round++) {
        plan = planIdChunks(plan, [for (var i = 0; i < round * 17; i++) 'x$i']);
        expect(plan.every((c) => c.length <= firestoreWhereInLimit), isTrue);
        expect(plan.expand((c) => c).toSet().length, round * 17);
      }
    });
  });

  group('the pieces of the plan', () {
    test('split roots: a part names its root, a split root names itself', () {
      final lines = [
        _l(
          _line(
            'r1',
            containerStatus: 'loading',
            rootLineId: 'r1',
            lastPartIndex: 2,
          ),
        ),
        _l(
          _line(
            'r1-2',
            containerStatus: 'waiting',
            rootLineId: 'r1',
            partIndex: 2,
          ),
        ),
        _l(
          _line(
            'p9',
            containerStatus: 'waiting',
            rootLineId: 'old',
            partIndex: 3,
          ),
        ),
        _l(_line('solo', containerStatus: 'waiting', rootLineId: 'solo')),
        _l(_line('legacy', containerStatus: 'waiting')),
      ];
      expect(splitGroupRoots(lines), {'r1', 'old'});
      expect(missingRoots({'r1', 'old'}, lines), {'old'});
      expect(missingRoots(const {}, lines), isEmpty);
    });

    test('the copy written last wins; a tie keeps the first read', () {
      final stale = _c(_box('b1', containerStatusShipped, day: 2));
      final fresh = _c(_box('b1', containerStatusArrived, day: 3));
      expect(
        mergeFeedContainers([
          [stale],
          [fresh],
        ]).single.status,
        containerStatusArrived,
      );
      expect(
        mergeFeedContainers([
          [fresh],
          [stale],
        ]).single.status,
        containerStatusArrived,
      );
      final a = _l(_line('l1', containerStatus: 'loading'));
      final b = _l(_line('l1', containerStatus: 'shipped'));
      expect(
        mergeFeedLines([
          [a],
          [b],
        ]).single.containerStatus,
        'loading',
      );
    });

    test(
      'lines are read by id only for boxes the open read does not cover',
      () {
        final open = [_c(_box('o1', containerStatusLoading))];
        final arrived = [_c(_box('a1', containerStatusArrived))];
        expect(
          containerIdsNeedingLines(
            arrived: arrived,
            focused: const ['o1', 'old', 'a1', ''],
            open: open,
          ),
          ['a1', 'old'],
        );
      },
    );

    test('the Arrived chip: the server count, never below the list', () {
      expect(arrivedCountShown(null, 25), 25);
      expect(arrivedCountShown(140, 25), 140);
      expect(arrivedCountShown(20, 25), 25);
      expect(arrivedPageFull(25, 25), isTrue);
      expect(arrivedPageFull(24, 25), isFalse);
      expect(arrivedPageFull(0, 0), isFalse);
    });
  });

  group('the bounded feed answers what the whole history answered', () {
    // A year of sailings: 60 arrived boxes, 2 at sea, 2 loading; lines on
    // each; waiting packages; and packages split across old and new boxes.
    final boxes = <Map<String, dynamic>>[
      for (var i = 0; i < 60; i++)
        _box('arr$i', containerStatusArrived, day: i + 1),
      _box('sea1', containerStatusShipped, day: 70),
      _box('sea2', containerStatusShipped, day: 71),
      _box('load1', containerStatusLoading, day: 72),
      _box('load2', containerStatusLoading, day: 73),
      // Another business's boxes never come back.
      _box('other', containerStatusLoading, business: 'biz-2'),
      _box('otherArr', containerStatusArrived, business: 'biz-2', day: 90),
    ];
    String statusOf(String box) =>
        boxes.firstWhere((b) => b['id'] == box)['status'] as String;
    final lines = <Map<String, dynamic>>[
      for (final b in boxes)
        if (b['businessId'] == _biz)
          for (var k = 0; k < 4; k++)
            _line(
              '${b['id']}-$k',
              containerId: b['id'] as String,
              containerStatus: b['status'] as String,
              rootLineId: '${b['id']}-$k',
            ),
      for (var k = 0; k < 6; k++)
        _line(
          'w$k',
          containerStatus: containerLineStatusWaiting,
          rootLineId: 'w$k',
        ),
      // Split in spring: root sailed and arrived long ago (off the first
      // page), its part still waits. The money is on the root.
      _line(
        'spring',
        containerId: 'arr2',
        containerStatus: statusOf('arr2'),
        rootLineId: 'spring',
        lastPartIndex: 2,
        priceCents: 30000,
        paidCents: 12000,
      ),
      _line(
        'spring-2',
        containerStatus: containerLineStatusWaiting,
        rootLineId: 'spring',
        partIndex: 2,
        priceCents: 4500,
      ),
      // A root written before groups existed (no rootLineId), on an old box;
      // its part is loading now.
      _line(
        'legacy',
        containerId: 'arr5',
        containerStatus: statusOf('arr5'),
        lastPartIndex: 2,
        priceCents: 20000,
        paidCents: 20000,
      ),
      _line(
        'legacy-2',
        containerId: 'load1',
        containerStatus: containerStatusLoading,
        rootLineId: 'legacy',
        partIndex: 2,
        priceCents: 3000,
      ),
      // A root loading now whose earlier part sailed on an old box.
      _line(
        'now',
        containerId: 'load2',
        containerStatus: containerStatusLoading,
        rootLineId: 'now',
        lastPartIndex: 2,
        priceCents: 8000,
        paidCents: 500,
      ),
      _line(
        'now-2',
        containerId: 'arr1',
        containerStatus: statusOf('arr1'),
        rootLineId: 'now',
        partIndex: 2,
        priceCents: 2000,
      ),
      _line(
        'x',
        containerId: 'other',
        containerStatus: containerStatusLoading,
        business: 'biz-2',
      ),
    ];
    final whole = [
      for (final l in lines)
        if (l['businessId'] == _biz) _l(l),
    ];
    final wholeBoxes = [
      for (final b in boxes)
        if (b['businessId'] == _biz) _c(b),
    ];
    final feed = _replayFeed(boxes, lines);

    test('the chip counts are exact', () {
      for (final status in containerStatuses) {
        expect(
          feed.counts[status],
          wholeBoxes.where((c) => c.status == status).length,
          reason: status,
        );
      }
    });

    test('every open box, the newest arrivals, and no other business', () {
      final ids = {for (final c in feed.containers) c.id};
      expect(ids, containsAll(['sea1', 'sea2', 'load1', 'load2']));
      expect(
        ids.where((id) => id.startsWith('arr')).length,
        arrivedContainerPageSize,
      );
      expect(ids, contains('arr59'));
      expect(ids, isNot(contains('arr0')));
      expect(ids, isNot(contains('other')));
      expect(ids, isNot(contains('otherArr')));
    });

    test('every box held shows all of its lines', () {
      for (final c in feed.containers) {
        expect(
          linesOfContainer(feed.lines, c.id).map((l) => l.id).toSet(),
          linesOfContainer(whole, c.id).map((l) => l.id).toSet(),
          reason: c.id,
        );
      }
    });

    test('the waiting list is the whole waiting list', () {
      expect(
        waitingLines(feed.lines).map((l) => l.id).toSet(),
        waitingLines(whole).map((l) => l.id).toSet(),
      );
    });

    test('every package on screen shows its whole group money', () {
      final held = lineGroupsByRoot(feed.lines);
      final all = lineGroupsByRoot(whole);
      for (final line in feed.lines) {
        final got = lineGroupOf(line, held), want = lineGroupOf(line, all);
        expect(got.partCount, want.partCount, reason: line.id);
        expect(got.priceCents, want.priceCents, reason: line.id);
        expect(got.paidCents, want.paidCents, reason: line.id);
        expect(got.balanceCents, want.balanceCents, reason: line.id);
      }
      // The three split packages above are each whole.
      expect(
        lineGroupOf(
          feed.lines.firstWhere((l) => l.id == 'spring-2'),
          held,
        ).paidCents,
        12000,
      );
      expect(
        lineGroupOf(
          feed.lines.firstWhere((l) => l.id == 'legacy-2'),
          held,
        ).priceCents,
        23000,
      );
      expect(
        lineGroupOf(
          feed.lines.firstWhere((l) => l.id == 'now'),
          held,
        ).priceCents,
        10000,
      );
    });

    test('a box opened from a link is read with its lines', () {
      final linked = _replayFeed(boxes, lines, focused: const ['arr0']);
      expect(linked.containers.map((c) => c.id), contains('arr0'));
      expect(
        linesOfContainer(linked.lines, 'arr0').length,
        linesOfContainer(whole, 'arr0').length,
      );
      // Another business's id opens nothing.
      final foreign = _replayFeed(boxes, lines, focused: const ['otherArr']);
      expect(foreign.containers.map((c) => c.id), isNot(contains('otherArr')));
    });

    test('load more brings the next arrivals, and their lines', () {
      final more = _replayFeed(boxes, lines, pages: 3);
      final ids = {for (final c in more.containers) c.id};
      expect(ids.where((id) => id.startsWith('arr')).length, 60);
      expect(more.counts[containerStatusArrived], 60);
      for (final c in more.containers) {
        expect(
          linesOfContainer(more.lines, c.id).length,
          linesOfContainer(whole, c.id).length,
        );
      }
    });

    test('while reading far less than the history', () {
      final history = boxes.length + lines.length;
      expect(feed.docsRead, lessThan(history * 0.7));
    });
  });

  group('the shapes are bounded and scoped', () {
    test('every read names the business and is bounded', () {
      for (final spec in [
        waitingContainerLinesSpec(_biz),
        arrivedContainersPageSpec(_biz, pages: 1),
        arrivedContainersCountSpec(_biz),
        containerLinesOfContainersSpec(_biz, const ['a', 'b']),
        containerLineGroupsSpec(_biz, const ['r']),
      ]) {
        expect(spec.isBusinessScoped, isTrue, reason: '$spec');
        expect(spec.isBounded, isTrue, reason: '$spec');
      }
      expect(
        arrivedContainersPageSpec(_biz, pages: 3).limit,
        arrivedContainerPageSize * 3,
      );
      expect(
        arrivedContainersPageSpec(_biz, pages: 0).limit,
        arrivedContainerPageSize,
      );
    });
  });
}
