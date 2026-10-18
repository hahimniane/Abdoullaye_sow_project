import 'dart:async';

import 'package:flutter/foundation.dart';

import 'package_request_service.dart';
import 'package_requests.dart';

/// A business's open package requests, listened to ONCE and shared: the
/// containers screen owns one, and the Requests tab and the Waiting list's
/// Expected section read the same feed (the way `ContainerFeed` shares the
/// lines), so opening either costs no second subscription.
class PackageRequestFeed extends ChangeNotifier {
  PackageRequestFeed(this.businessId, {required PackageRequestService service})
    : _service = service {
    _listen();
  }

  final String businessId;
  final PackageRequestService _service;
  StreamSubscription<List<PackageRequest>>? _sub;
  bool _disposed = false;

  List<PackageRequest> requests = const [];
  bool loaded = false;
  bool failed = false;

  PackageRequestService get service => _service;

  void _listen() {
    _sub?.cancel();
    if (businessId.trim().isEmpty) {
      loaded = true;
      return;
    }
    _sub = _service
        .watchOpen(businessId)
        .listen(
          (list) {
            requests = list;
            loaded = true;
            failed = false;
            _changed();
          },
          onError: (Object _) {
            // Without the containers section (or offline) the list stays empty
            // and says so; nothing else on the screen depends on it.
            loaded = true;
            failed = true;
            _changed();
          },
        );
  }

  /// Listens again after a failure.
  void retry() {
    loaded = false;
    failed = false;
    _changed();
    _listen();
  }

  List<PackageRequest> inStage(BusinessRequestStage stage) =>
      requestsInStage(requests, stage);

  List<PackageRequest> get expected => expectedRequests(requests);

  /// New + waiting for the customer: what the Requests tab counts.
  int get openCount => requests
      .where(
        (r) =>
            businessStageOf(r) == BusinessRequestStage.needsEstimate ||
            businessStageOf(r) == BusinessRequestStage.waitingForCustomer,
      )
      .length;

  PackageRequest? byId(String id) =>
      requests.where((r) => r.id == id).firstOrNull;

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _sub?.cancel();
    super.dispose();
  }
}
