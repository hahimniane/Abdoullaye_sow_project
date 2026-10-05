import 'package:flutter/widgets.dart';

/// Tabs that are built the first time they are shown and kept alive after.
///
/// The staff shell used to show `screens[currentIndex]` alone, so every tap
/// on the bottom bar disposed the tab being left: the business home dropped
/// its listeners and re-read all of them on the way back, and lost its
/// scroll and filters. A plain IndexedStack would keep them but build every
/// tab - and start every tab's listeners - at once on sign-in. This builds
/// each tab on first visit and holds it from then on.
///
/// Give each child a stable [Key] (its tab id): the bar's tab list changes
/// when the business's services load, and the key is what keeps a tab's
/// state attached to the tab rather than to a position.
class LazyIndexedStack extends StatefulWidget {
  const LazyIndexedStack({
    super.key,
    required this.index,
    required this.children,
  });

  final int index;
  final List<Widget> children;

  @override
  State<LazyIndexedStack> createState() => _LazyIndexedStackState();
}

class _LazyIndexedStackState extends State<LazyIndexedStack> {
  final Set<Key> _visited = <Key>{};

  Key _keyOf(int i) => widget.children[i].key ?? ValueKey<int>(i);

  @override
  Widget build(BuildContext context) {
    final children = widget.children;
    if (children.isEmpty) return const SizedBox.shrink();
    final index = widget.index.clamp(0, children.length - 1);
    _visited.add(_keyOf(index));
    // Forget tabs that no longer exist, so a tab that comes back later is
    // built fresh rather than revived from a stale visit.
    final live = {for (var i = 0; i < children.length; i++) _keyOf(i)};
    _visited.removeWhere((key) => !live.contains(key));
    // Not an IndexedStack: it wraps each child in an unkeyed wrapper, so a
    // tab inserted ahead of another would hand that tab's state to its
    // neighbour. Each child here carries its own key down to the element
    // that holds its state, and a hidden tab is offstage (not painted, not
    // hit-tested) with its tickers paused.
    return Stack(
      fit: StackFit.expand,
      children: [
        for (var i = 0; i < children.length; i++)
          KeyedSubtree(
            key: _keyOf(i),
            child: Offstage(
              offstage: i != index,
              child: TickerMode(
                enabled: i == index,
                child: _visited.contains(_keyOf(i))
                    ? children[i]
                    : const SizedBox.shrink(),
              ),
            ),
          ),
      ],
    );
  }
}
