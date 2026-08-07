import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/transport_opportunity.dart';
import '../models/transport_quote.dart';

/// The business side of car transport, app side.
///
/// A transport business could do nothing for transport from the phone: nothing
/// subscribed to `transportOpportunities`, so a business never saw a request it
/// was invited to bid on, and the only way to move a won job was the web
/// console.
///
/// A deliberate mirror of the server's own rules in `functions/index.js`
/// (`submitTransportQuote`, `withdrawTransportQuote`,
/// `updateTransportFulfillmentStatus`). The callables are still the authority;
/// this exists so a carrier is refused before it costs a round trip, and so the
/// two clients enforce the same table.
///
/// Everything above [BusinessTransportService] is pure - no Firebase, no
/// widgets - so `test/business_transport_jobs_test.dart` drives it directly.
/// `AuthProvider` builds Firebase in its field initialisers and cannot be
/// constructed in a widget test, which is why the decisions live here and not
/// in the screens.

// ---------------------------------------------------------------------------
// Quoting
// ---------------------------------------------------------------------------

/// The only currency a transport quote may be denominated in.
///
/// `SHIPMENT_CURRENCY` in `functions/index.js`. The server compares the
/// lowercased value against this exact string and refuses anything else, so
/// there is nothing for a picker to offer - it is asserted, not chosen.
const String transportQuoteCurrency = 'usd';

/// The largest quote the server will accept, in cents.
///
/// `MAX_TRANSPORT_QUOTE_CENTS` in `functions/index.js` - one million dollars.
/// A fat-fingered extra zero is the realistic way this is hit, which is exactly
/// why it is caught in front of the carrier rather than as a server refusal.
const int maxTransportQuoteCents = 100000000;

/// The two ways a car travels. `TRANSPORT_QUOTE_METHODS` in
/// `functions/index.js`.
const List<String> transportQuoteMethods = <String>['open', 'enclosed'];

/// The longest terms text the server keeps. Anything longer is refused with
/// `invalid-argument` rather than truncated.
const int maxTransportQuoteTermsLength = 1000;

/// Everything a bid can be refused for, in the server's own vocabulary so the
/// two never drift.
enum TransportQuoteError {
  /// Nothing typed at all.
  amountRequired,

  /// Typed, but not a number this can price.
  amountInvalid,

  /// More precision than money has. The server takes cents as a safe integer,
  /// so a third decimal place is not a rounding problem - it is a different
  /// amount from the one the carrier meant.
  amountFractionalCents,

  /// Zero or negative. The server requires `amountCents > 0`.
  amountNotPositive,

  /// Above [maxTransportQuoteCents].
  amountAboveCap,

  /// Not [transportQuoteCurrency].
  currencyNotSupported,

  /// Not one of [transportQuoteMethods].
  methodNotSupported,

  /// The server takes both estimate dates or neither.
  datesIncomplete,

  /// `estimatedPickupDate` must be in the future.
  pickupDateNotInFuture,

  /// `estimatedDeliveryDate` cannot precede pickup.
  deliveryBeforePickup,

  /// Terms longer than [maxTransportQuoteTermsLength].
  termsTooLong,
}

/// A group separator, as opposed to a decimal mark: a comma followed by exactly
/// three digits. `1,250` is twelve hundred and fifty dollars, not one dollar
/// twenty-five, and a carrier who types it that way must not be quoted a
/// thousandth of what they meant.
final RegExp _groupSeparator = RegExp(r',(?=\d{3}(?:\D|$))');

/// Whole dollars, optionally followed by one or two decimal places.
final RegExp _wholeCents = RegExp(r'^(-?)(\d+)(?:\.(\d{1,2}))?$');

/// The same shape but with more precision than cents can hold.
final RegExp _fractionalCents = RegExp(r'^-?\d+\.\d{3,}$');

/// Reads a typed amount as whole cents, or null when it is not a number.
///
/// Money is integer cents end to end - the server takes `amountCents` and
/// checks it with `Number.isSafeInteger`, so a double introduced here would
/// only ever be a way to send it something it refuses. The text is parsed into
/// dollars and cents as two integers and combined; nothing is ever multiplied
/// by 100 as a double.
///
/// Both catalogs are in play, so both separators are read as the decimal mark:
/// a French carrier types `1250,50` and an English one `1250.50`. A comma
/// followed by exactly three digits is a thousands group and is dropped.
///
/// Returns a negative value for a negative amount rather than null, so the
/// caller can say "a quote cannot be negative" instead of "that is not a
/// number". Returns null for more precision than cents can hold; callers
/// separate that case with [transportQuoteAmountIsFractional].
int? parseTransportQuoteCents(String input) {
  final cleaned = input
      .replaceAll(RegExp(r'[\s ]'), '')
      .replaceAll(r'$', '')
      .replaceAll(_groupSeparator, '')
      .replaceAll(',', '.');
  final match = _wholeCents.firstMatch(cleaned);
  if (match == null) return null;
  final dollars = int.tryParse(match.group(2) ?? '');
  if (dollars == null) return null;
  final fraction = match.group(3) ?? '';
  final cents = fraction.isEmpty
      ? 0
      : int.parse(fraction.padRight(2, '0').substring(0, 2));
  final total = dollars * 100 + cents;
  return match.group(1) == '-' ? -total : total;
}

/// Whether the text is a number but carries more precision than cents.
///
/// Separated from [parseTransportQuoteCents] returning null so "1250.005" can
/// be refused as "amounts are in whole cents" rather than as "that is not a
/// number", which would send the carrier hunting for a typo that is not there.
bool transportQuoteAmountIsFractional(String input) {
  final cleaned = input
      .replaceAll(RegExp(r'[\s ]'), '')
      .replaceAll(r'$', '')
      .replaceAll(_groupSeparator, '')
      .replaceAll(',', '.');
  return _fractionalCents.hasMatch(cleaned);
}

/// What a carrier typed into the bid form.
class TransportQuoteDraft {
  const TransportQuoteDraft({
    required this.requestId,
    required this.amountText,
    this.currency = transportQuoteCurrency,
    this.transportMethod = 'open',
    this.terms = '',
    this.estimatedPickupDate,
    this.estimatedDeliveryDate,
  });

  final String requestId;
  final String amountText;
  final String currency;
  final String transportMethod;
  final String terms;
  final DateTime? estimatedPickupDate;
  final DateTime? estimatedDeliveryDate;
}

/// Every problem at once, not just the first.
///
/// A form that reveals its objections one submission at a time is how a carrier
/// misses a quote deadline. [now] is injected so the future-pickup boundary is
/// testable rather than a coin flip on the day the test happens to run.
List<TransportQuoteError> validateTransportQuoteDraft(
  TransportQuoteDraft draft, {
  DateTime? now,
}) {
  final errors = <TransportQuoteError>[];

  final amountText = draft.amountText.trim();
  if (amountText.isEmpty) {
    errors.add(TransportQuoteError.amountRequired);
  } else if (transportQuoteAmountIsFractional(amountText)) {
    errors.add(TransportQuoteError.amountFractionalCents);
  } else {
    final cents = parseTransportQuoteCents(amountText);
    if (cents == null) {
      errors.add(TransportQuoteError.amountInvalid);
    } else if (cents <= 0) {
      errors.add(TransportQuoteError.amountNotPositive);
    } else if (cents > maxTransportQuoteCents) {
      errors.add(TransportQuoteError.amountAboveCap);
    }
  }

  if (draft.currency.trim().toLowerCase() != transportQuoteCurrency) {
    errors.add(TransportQuoteError.currencyNotSupported);
  }
  if (!transportQuoteMethods.contains(
    draft.transportMethod.trim().toLowerCase(),
  )) {
    errors.add(TransportQuoteError.methodNotSupported);
  }
  if (draft.terms.trim().length > maxTransportQuoteTermsLength) {
    errors.add(TransportQuoteError.termsTooLong);
  }

  final pickup = draft.estimatedPickupDate;
  final delivery = draft.estimatedDeliveryDate;
  // The server takes both or neither (`parseTransportQuoteDates`), so one date
  // on its own is refused here rather than there.
  if ((pickup == null) != (delivery == null)) {
    errors.add(TransportQuoteError.datesIncomplete);
  }
  if (pickup != null && !pickup.isAfter(now ?? DateTime.now())) {
    errors.add(TransportQuoteError.pickupDateNotInFuture);
  }
  if (pickup != null && delivery != null && delivery.isBefore(pickup)) {
    errors.add(TransportQuoteError.deliveryBeforePickup);
  }

  return errors;
}

/// What the customer pays: the carrier's own price plus the pickup leg.
///
/// The server computes `totalCents = amountCents + pickupFeeCents` in
/// `submitTransportQuote`, pricing the pickup from THIS business's `pickupPlan`
/// under the `carTransport` key. The carrier never sets that number, but it is
/// on the same line the customer compares against other carriers, so the bid
/// screen has to show it.
int transportQuoteTotalCents(int amountCents, int pickupFeeCents) =>
    amountCents + pickupFeeCents;

/// The exact payload `submitTransportQuote` expects.
///
/// The amount goes as integer cents, never as dollars: the server checks it
/// with `Number.isSafeInteger` and would refuse a float. Dates go as ISO
/// strings at midday so a timezone west of UTC cannot roll an estimate back a
/// day on the server's `new Date(...)`.
Map<String, dynamic> transportQuotePayload(
  TransportQuoteDraft draft, {
  String businessId = '',
}) {
  final cents = parseTransportQuoteCents(draft.amountText.trim()) ?? 0;
  return <String, dynamic>{
    'requestId': draft.requestId,
    if (businessId.trim().isNotEmpty) 'businessId': businessId.trim(),
    'amountCents': cents,
    'currency': transportQuoteCurrency,
    'transportMethod': draft.transportMethod.trim().toLowerCase(),
    'terms': draft.terms.trim(),
    if (draft.estimatedPickupDate != null)
      'estimatedPickupDate': transportQuoteMiddayIso(draft.estimatedPickupDate),
    if (draft.estimatedDeliveryDate != null)
      'estimatedDeliveryDate': transportQuoteMiddayIso(
        draft.estimatedDeliveryDate,
      ),
  };
}

/// A calendar day plus a midday clock.
///
/// The clock is the point: the server parses with `new Date(...)`, and a bare
/// `yyyy-mm-dd` read west of UTC would move a pickup estimate back a day. The
/// same rule `businessParkingMiddayIso` already applies to parking windows.
String transportQuoteMiddayIso(DateTime? value) {
  if (value == null) return '';
  final month = value.month.toString().padLeft(2, '0');
  final day = value.day.toString().padLeft(2, '0');
  return '${value.year}-$month-${day}T12:00:00';
}

// ---------------------------------------------------------------------------
// Fulfilment
// ---------------------------------------------------------------------------

/// The statuses the transport state machine produces.
const List<String> transportFulfillmentStatuses = <String>[
  'pending',
  'scheduled',
  'in_transit',
  'delivered',
  'cancelled',
];

/// Where a job may go from where it is.
///
/// A deliberate, literal mirror of the `transitions` table inside
/// `updateTransportFulfillmentStatus` (`functions/index.js`). `delivered` and
/// `cancelled` are terminal and map to an empty list rather than being absent,
/// so "this status is known but finished" and "this status is not ours" stay
/// different answers - the first is a delivered job, the second is something an
/// admin path wrote and the state machine cannot reason about.
const Map<String, List<String>> transportFulfillmentTransitions =
    <String, List<String>>{
      'pending': <String>['scheduled', 'in_transit', 'cancelled'],
      'scheduled': <String>['in_transit', 'cancelled'],
      'in_transit': <String>['delivered'],
      'delivered': <String>[],
      'cancelled': <String>[],
    };

/// The status the server will compare against its own table.
///
/// `updateTransportFulfillmentStatus` reads
/// `String(requestData.fulfillmentStatus || requestData.status || "")` - JS
/// truthiness, so an EMPTY `fulfillmentStatus` falls through to `status`. Dart's
/// `??` does not: it keeps the empty string. Getting this wrong means reading a
/// job as statusless when the server reads it as `pending`, and offering it no
/// action at all.
String transportJobCurrentStatus(Map<String, dynamic> row) {
  final fulfillment = (row['fulfillmentStatus'] ?? '').toString();
  if (fulfillment.isNotEmpty) return fulfillment;
  return (row['status'] ?? '').toString();
}

/// Whether the state machine recognises this status.
///
/// Compared literally, with no trimming or case folding, because the server
/// compares it literally too: a stored `"Pending"` is not `pending` to
/// `updateTransportFulfillmentStatus` and would be refused. Being more generous
/// here than the server is only a way to offer a button that cannot work.
bool transportFulfillmentStatusIsKnown(String status) =>
    transportFulfillmentTransitions.containsKey(status);

/// The legal next statuses, in the table's own order.
///
/// An unrecognised status - `active`, `in_progress`, `completed`, `sold`,
/// `reserved`, `inactive`, anything else `updateAdminRecordStatus` can write
/// onto a transportRequests document - yields an empty list. The UI shows the
/// value and offers nothing, which is the honest answer: the state machine has
/// no opinion about where a job goes from a status it never produced.
List<String> transportFulfillmentNextStatuses(String currentStatus) =>
    transportFulfillmentTransitions[currentStatus] ?? const <String>[];

/// Whether moving to [nextStatus] needs a container number.
///
/// A car in transit is in a container, and the customer's next question is
/// always "where is it". The server refuses `in_transit` without one; the app
/// asks for it rather than letting that refusal be the way a carrier finds out.
bool transportFulfillmentRequiresContainer(String nextStatus) =>
    nextStatus == 'in_transit';

/// A container number as the server would store it, or '' when it is not one.
///
/// A deliberate mirror of `validateContainerNumber` in
/// `functions/shipment_tracking.js`: trimmed, capped at 40 characters,
/// upper-cased, and anything shorter than four characters is not a number at
/// all. Mirroring the length rule matters - a carrier who types `AB` must be
/// told here, not by a `failed-precondition` after the tap.
String normalizeTransportContainerNumber(Object? value) {
  final text = (value ?? '').toString().trim();
  final capped = text.length <= 40 ? text : text.substring(0, 40);
  final cleaned = capped.toUpperCase();
  return cleaned.length >= 4 ? cleaned : '';
}

/// Why a status change cannot be made.
enum TransportFulfillmentError {
  /// The job is sitting on a status the state machine never produced, so there
  /// is no table row to move along.
  currentStatusUnknown,

  /// A status the server would not accept as a destination at all.
  nextStatusUnknown,

  /// Known statuses, but not an edge in the table.
  transitionNotAllowed,

  /// `in_transit` with nothing to track the car by.
  containerNumberRequired,
}

/// Whether this job may move to this status, and why not.
///
/// Every refusal the server can give for a transition, given in front of the
/// carrier instead. [existingContainerNumber] is what the request already
/// holds and [submittedContainerNumber] is what the carrier just typed; the
/// server accepts either, taking the submitted one first, so a job that already
/// carries a container number does not have to be given it again.
List<TransportFulfillmentError> validateTransportFulfillmentChange({
  required String currentStatus,
  required String nextStatus,
  String existingContainerNumber = '',
  String submittedContainerNumber = '',
}) {
  final errors = <TransportFulfillmentError>[];
  if (!transportFulfillmentStatusIsKnown(currentStatus)) {
    errors.add(TransportFulfillmentError.currentStatusUnknown);
  }
  // `pending` is a legal place to be but never a legal destination: the server's
  // allowedStatuses set is scheduled/in_transit/delivered/cancelled.
  if (!transportFulfillmentStatuses.contains(nextStatus) ||
      nextStatus == 'pending') {
    errors.add(TransportFulfillmentError.nextStatusUnknown);
  } else if (!transportFulfillmentNextStatuses(
    currentStatus,
  ).contains(nextStatus)) {
    errors.add(TransportFulfillmentError.transitionNotAllowed);
  }
  if (transportFulfillmentRequiresContainer(nextStatus) &&
      normalizeTransportContainerNumber(submittedContainerNumber).isEmpty &&
      normalizeTransportContainerNumber(existingContainerNumber).isEmpty) {
    errors.add(TransportFulfillmentError.containerNumberRequired);
  }
  return errors;
}

/// The exact payload `updateTransportFulfillmentStatus` expects.
///
/// The container number is sent only when the carrier typed one: the server
/// keeps whatever the request already holds, and sending an empty string would
/// be indistinguishable from not sending it - except that it reads, at a
/// glance, like an attempt to clear it.
Map<String, dynamic> transportFulfillmentPayload({
  required String requestId,
  required String status,
  String containerNumber = '',
  String businessId = '',
}) {
  final container = normalizeTransportContainerNumber(containerNumber);
  return <String, dynamic>{
    'requestId': requestId,
    'status': status,
    if (businessId.trim().isNotEmpty) 'businessId': businessId.trim(),
    if (container.isNotEmpty) 'containerNumber': container,
  };
}

// ---------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------

/// Which of the three lists a business's transport work is in.
enum BusinessTransportSection {
  /// Invited, not quoted. The clock is running on `expiresAt`.
  openToBid,

  /// Quoted, waiting on the customer.
  quoted,

  /// Won. This one has a car to move.
  wonJobs,
}

/// Whether this opportunity is still waiting for a bid.
///
/// `open` is the status `createTransportRequest` stamps and the status
/// `withdrawTransportQuote` restores. `quoted`, `selected`, `closed`,
/// `cancelled` and the `withdrawn` an edited destination leaves behind are all
/// "not asking you for a price right now".
bool transportOpportunityIsOpenForBidding(String status) =>
    status.trim().toLowerCase() == 'open';

/// Whether this opportunity carries a live bid from this business.
bool transportOpportunityIsQuoted(String status) =>
    status.trim().toLowerCase() == 'quoted';

/// Which section an opportunity belongs to, or null when it belongs to none.
///
/// A `selected` opportunity is deliberately not in a section: the work has
/// moved to the transportRequests document, which is what [wonJobs] counts, and
/// showing it in both would have a carrier looking at one car twice.
BusinessTransportSection? transportOpportunitySection(String status) {
  if (transportOpportunityIsOpenForBidding(status)) {
    return BusinessTransportSection.openToBid;
  }
  if (transportOpportunityIsQuoted(status)) {
    return BusinessTransportSection.quoted;
  }
  return null;
}

/// The statuses that mean a won job no longer needs anyone.
///
/// `delivered` and `cancelled` are the state machine's terminals. `completed`
/// is what the admin path (`updateAdminRecordStatus`) writes for the same
/// thing, so a job an admin closed out is not counted as still needing a
/// carrier who has nothing left to do to it.
const Set<String> transportJobFinalStatuses = <String>{
  'delivered',
  'cancelled',
  'completed',
};

/// Whether a won job still has work in it.
///
/// A job with no status recorded counts as open: it has certainly not been
/// delivered, and under-counting work is the direction that strands a car.
bool transportJobNeedsAction(String status) =>
    !transportJobFinalStatuses.contains(status.trim().toLowerCase());

/// The one number the Car Transport tile carries: what needs this business.
///
/// Not "how many transport records exist" - a business that has quoted
/// everything and delivered everything should read zero, and a business with
/// three unbid invitations and a car sitting on a dock should read four.
/// So: requests still open for a bid, plus won jobs not yet delivered.
int businessTransportNeedsYouCount({
  Iterable<String> opportunityStatuses = const <String>[],
  Iterable<String> jobStatuses = const <String>[],
}) =>
    opportunityStatuses.where(transportOpportunityIsOpenForBidding).length +
    jobStatuses.where(transportJobNeedsAction).length;

// ---------------------------------------------------------------------------
// The callables
// ---------------------------------------------------------------------------

/// What `submitTransportQuote` answers with.
class TransportQuoteSubmission {
  const TransportQuoteSubmission({
    required this.quoteId,
    required this.requestId,
    required this.businessId,
    required this.revision,
  });

  /// Reads the response defensively: a missing revision must read as a first
  /// submission rather than as a null rendered into "Revision null".
  factory TransportQuoteSubmission.fromCallable(Object? data) {
    final row = data is Map ? data : const <Object?, Object?>{};
    String at(String key) => (row[key] ?? '').toString().trim();
    return TransportQuoteSubmission(
      quoteId: at('quoteId'),
      requestId: at('requestId'),
      businessId: at('businessId'),
      revision: (num.tryParse(at('revision')) ?? 1).round(),
    );
  }

  final String quoteId;
  final String requestId;
  final String businessId;

  /// The server bumps this on every re-submission. Anything above one is a
  /// revision of the quote already in the customer's hands, not a second quote:
  /// one business gets one quote per request, written to the same document.
  final int revision;

  bool get isRevision => revision > 1;
}

/// What `updateTransportFulfillmentStatus` answers with.
class TransportFulfillmentUpdate {
  const TransportFulfillmentUpdate({
    required this.status,
    required this.previousStatus,
    required this.alreadyUpdated,
  });

  /// `alreadyUpdated` is a success, not a failure - two people tapping the same
  /// status must not read as an error.
  factory TransportFulfillmentUpdate.fromCallable(Object? data) {
    final row = data is Map ? data : const <Object?, Object?>{};
    return TransportFulfillmentUpdate(
      status: (row['status'] ?? '').toString().trim(),
      previousStatus: (row['previousStatus'] ?? '').toString().trim(),
      alreadyUpdated: row['alreadyUpdated'] == true,
    );
  }

  final String status;
  final String previousStatus;
  final bool alreadyUpdated;
}

/// The three callables plus the two streams, behind injectable Firebase handles
/// so the screens can be driven without a network - the same shape
/// [TransportService] and `BusinessParkingService` already use.
class BusinessTransportService {
  BusinessTransportService({
    FirebaseFunctions? functions,
    FirebaseFirestore? firestore,
  }) : _functions = functions ?? FirebaseFunctions.instance,
       _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFunctions _functions;
  final FirebaseFirestore _firestore;

  /// The requests this business has been invited to bid on.
  ///
  /// `transportOpportunities` is the collection that answers "which requests
  /// may I quote"; nothing in the app subscribed to it before, which is why a
  /// business could not bid from the phone at all.
  Stream<List<TransportOpportunity>> watchOpportunities(String businessId) {
    return _firestore
        .collection('transportOpportunities')
        .where('businessId', isEqualTo: businessId)
        .snapshots()
        .map(
          (snapshot) =>
              snapshot.docs.map(TransportOpportunity.fromFirestore).toList()
                ..sort((a, b) => b.createdAt.compareTo(a.createdAt)),
        );
  }

  /// This business's own quotes, one per request.
  Stream<List<TransportQuote>> watchBusinessQuotes(String businessId) {
    return _firestore
        .collection('transportQuotes')
        .where('businessId', isEqualTo: businessId)
        .snapshots()
        .map((snapshot) => snapshot.docs.map(TransportQuote.fromFirestore).toList());
  }

  /// Bids on a request, or revises the bid already in.
  ///
  /// One quote per business per request: a re-submission rewrites the same
  /// document and bumps `revision`, it does not add a second quote. The server
  /// adds its own `pickupFeeCents` from this business's `pickupPlan` and stores
  /// `totalCents`, so the amount sent here is the transport leg alone.
  ///
  /// The callable refuses with `failed-precondition` when the request has
  /// stopped collecting, the deadline has passed, the business is not approved
  /// or no longer serves the destination, or the customer moved the pickup
  /// address while the quote was being priced. Those messages say something
  /// this app's copy cannot, so callers surface them rather than replacing them.
  Future<TransportQuoteSubmission> submitQuote(
    TransportQuoteDraft draft, {
    String businessId = '',
  }) async {
    final response = await _functions
        .httpsCallable('submitTransportQuote')
        .call<Object?>(transportQuotePayload(draft, businessId: businessId));
    return TransportQuoteSubmission.fromCallable(response.data);
  }

  /// Pulls a bid. The quote goes `withdrawn` and the opportunity returns to
  /// `open`, so the business can bid again later.
  Future<void> withdrawQuote({
    required String requestId,
    String businessId = '',
  }) async {
    await _functions.httpsCallable('withdrawTransportQuote').call<Object?>(
      <String, dynamic>{
        'requestId': requestId,
        if (businessId.trim().isNotEmpty) 'businessId': businessId.trim(),
      },
    );
  }

  /// Moves a won job along.
  ///
  /// Deliberately the callable and never a direct `transportRequests` write.
  /// The web console writes the document directly
  /// (`admin_web/src/components/business/operations-panels.tsx`) and so
  /// bypasses both the transition table and the container-number gate; mobile
  /// is the correct implementation of the same action.
  Future<TransportFulfillmentUpdate> updateFulfillmentStatus({
    required String requestId,
    required String status,
    String containerNumber = '',
    String businessId = '',
  }) async {
    final response = await _functions
        .httpsCallable('updateTransportFulfillmentStatus')
        .call<Object?>(
          transportFulfillmentPayload(
            requestId: requestId,
            status: status,
            containerNumber: containerNumber,
            businessId: businessId,
          ),
        );
    return TransportFulfillmentUpdate.fromCallable(response.data);
  }
}
