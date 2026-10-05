import 'dart:async';

/// One upstream subscription shared by every listener, with the latest value
/// replayed to whoever joins late.
///
/// The destination catalog is a Cloud Function call plus a Firestore
/// listener. Every widget that asked for it used to start its own copy - and
/// widgets that asked from `build` started a new one on every keystroke. With
/// this, the Send Barrel selector, the destination field and the shipment
/// details screen all read one upstream: the first listener starts it, later
/// ones get the cached value at once, and the upstream stops [linger] after
/// the last one leaves (so stepping back and forth between screens does not
/// re-run the function).
class SharedLatestStream<T> {
  SharedLatestStream(this._source, {this.linger = Duration.zero});

  final Stream<T> Function() _source;
  final Duration linger;

  late final StreamController<T> _hub = StreamController<T>.broadcast(
    onListen: _start,
    onCancel: _scheduleStop,
  );
  StreamSubscription<T>? _upstream;
  Timer? _stopTimer;

  bool _hasValue = false;
  T? _value;
  Object? _error;
  StackTrace? _errorStack;

  /// How many times the upstream has been started. For tests.
  int get startCount => _startCount;
  int _startCount = 0;

  /// Whether the upstream is currently subscribed. For tests.
  bool get isActive => _upstream != null;

  /// A fresh single-subscription view: the latest value (or error) first,
  /// then everything the shared upstream emits.
  Stream<T> get stream {
    late final StreamController<T> view;
    StreamSubscription<T>? link;
    view = StreamController<T>(
      onListen: () {
        // Join the hub first: that is what starts a stopped upstream, and a
        // fresh start forgets a stale error before anything is replayed.
        link = _hub.stream.listen(view.add, onError: view.addError);
        // An upstream that finished (an error ends it) while other views
        // were still open is restarted by the next one to join.
        if (_upstream == null) _start();
        if (_hasValue) {
          view.add(_value as T);
        } else if (_error != null) {
          view.addError(_error!, _errorStack);
        }
      },
      onPause: () => link?.pause(),
      onResume: () => link?.resume(),
      onCancel: () => link?.cancel(),
    );
    return view.stream;
  }

  void _start() {
    _stopTimer?.cancel();
    _stopTimer = null;
    if (_upstream != null) return;
    _startCount += 1;
    _error = null;
    _errorStack = null;
    _upstream = _source().listen(
      (value) {
        _hasValue = true;
        _value = value;
        _error = null;
        _errorStack = null;
        _hub.add(value);
      },
      onError: (Object error, StackTrace stack) {
        _error = error;
        _errorStack = stack;
        _hub.addError(error, stack);
      },
      // An upstream that finishes is restarted by the next first listener;
      // the views stay open on the hub meanwhile, holding the last value.
      onDone: () => _upstream = null,
    );
  }

  void _scheduleStop() {
    _stopTimer?.cancel();
    if (linger == Duration.zero) {
      _stop();
      return;
    }
    _stopTimer = Timer(linger, _stop);
  }

  void _stop() {
    _stopTimer = null;
    if (_hub.hasListener) return;
    final upstream = _upstream;
    _upstream = null;
    unawaited(upstream?.cancel());
  }
}
