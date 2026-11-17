/// WhatsApp "Send again" and the counter warning, app side
/// (docs/WHATSAPP_RESEND.md). Pure: the request `updateContainerLine` takes
/// for `resend_update`, what its answer and its refusals mean, who a
/// just-saved package's message failed to reach. Mirrors the console's
/// `line-update-failures.tsx` and `counterAlerts` (`package-staff.ts`).
library;

import '../utils/callable_data.dart';
import 'container_manifest.dart';
import 'whatsapp_conversations.dart' show PackageUpdateTick, packageUpdateTicks;

/// The callable "Send again" rides: an action on the line edit.
const resendCallable = 'updateContainerLine';
const resendAction = 'resend_update';

/// The request. Null when there is nothing to name: a line with no id.
Map<String, Object?>? resendRequest(String businessId, String lineId) {
  final business = businessId.trim();
  final line = lineId.trim();
  if (business.isEmpty || line.isEmpty) return null;
  return {'businessId': business, 'lineId': line, 'action': resendAction};
}

/// Whether the line's last update did not reach someone: the only time
/// "Send again" is offered. Mirrors the console's `failed` test.
bool lineUpdateFailed(ContainerLine line) => packageUpdateTicks(
  line.lastCustomerUpdate,
).any((t) => t.tick == PackageUpdateTick.failed);

/// Why the server would not send again, from `details.reason`.
enum ResendRefusal {
  /// WhatsApp is not connected for this business yet.
  notConfigured,

  /// The line has told nobody anything yet.
  noUpdate,

  /// Anything else: the network, a permission, the server.
  other,
}

ResendRefusal resendRefusalOf(String? reason) => switch (reason) {
  'whatsapp_not_configured' => ResendRefusal.notConfigured,
  'no_customer_update' => ResendRefusal.noUpdate,
  _ => ResendRefusal.other,
};

/// What the server did: how many people it queued the message for, and how
/// many had it already (a delivered or read message is never sent twice, and
/// a person is hand-resent to the same number at most five times).
class ResendResult {
  const ResendResult({required this.queued, required this.alreadySent});

  final int queued;
  final int alreadySent;

  /// Nobody was queued: they all have it, or it is already on its way.
  bool get nothingToSend => queued <= 0;

  static ResendResult fromCallable(Object? data) {
    final map = callableMap(data);
    int count(Object? v) {
      final n = callableInt(v);
      return n < 0 ? 0 : n;
    }

    return ResendResult(
      queued: count(map['queued']),
      alreadySent: count(map['alreadySent']),
    );
  }
}

/// A person a just-saved package's message could not reach.
class CounterAlert {
  const CounterAlert({
    required this.lineId,
    required this.trackingCode,
    required this.isReceiver,
    required this.phone,
    required this.failure,
  });

  final String lineId;
  final String trackingCode;
  final bool isReceiver;

  /// The number the message went to, as stored on the line.
  final String phone;

  /// WhatsApp's reason ("Message undeliverable"), or ''.
  final String failure;
}

/// The people a just-saved package's message failed to reach, in the order
/// of [lines]. Only the lines saved in this sitting ([savedIds]), so the
/// warning is about the customer at the counter, not the whole list. One
/// pass over the rows. Mirrors `counterAlerts`.
List<CounterAlert> counterAlerts(
  Iterable<ContainerLine> lines,
  Set<String> savedIds,
) {
  if (savedIds.isEmpty) return const [];
  final alerts = <CounterAlert>[];
  for (final line in lines) {
    if (!savedIds.contains(line.id)) continue;
    for (final tick in packageUpdateTicks(line.lastCustomerUpdate)) {
      if (tick.tick != PackageUpdateTick.failed) continue;
      alerts.add(
        CounterAlert(
          lineId: line.id,
          trackingCode: line.trackingCode,
          isReceiver: tick.isReceiver,
          phone: tick.isReceiver ? line.receiverPhone : line.customerPhone,
          failure: tick.reason,
        ),
      );
    }
  }
  return alerts;
}
