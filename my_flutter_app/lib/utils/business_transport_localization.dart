import '../l10n/app_localizations.dart';
import '../services/business_transport_jobs.dart';

/// EN/FR copy for the business side of car transport.
///
/// The decisions live in the pure module (`services/business_transport_jobs.dart`)
/// and the words live here, the same split `business_parking_localization.dart`
/// uses: a validator returns a code, never a sentence, so a French carrier is
/// never shown an English refusal.

/// The sentence for one bid refusal.
String transportQuoteErrorText(
  AppLocalizations l10n,
  TransportQuoteError error,
) => switch (error) {
  TransportQuoteError.amountRequired => l10n.transportQuoteAmountRequired,
  TransportQuoteError.amountInvalid => l10n.transportQuoteAmountInvalid,
  TransportQuoteError.amountFractionalCents =>
    l10n.transportQuoteAmountFractional,
  TransportQuoteError.amountNotPositive => l10n.transportQuoteAmountNotPositive,
  TransportQuoteError.amountAboveCap => l10n.transportQuoteAmountAboveCap,
  TransportQuoteError.currencyNotSupported =>
    l10n.transportQuoteCurrencyNotSupported,
  TransportQuoteError.methodNotSupported =>
    l10n.transportQuoteMethodNotSupported,
  TransportQuoteError.datesIncomplete => l10n.transportQuoteDatesIncomplete,
  TransportQuoteError.pickupDateNotInFuture =>
    l10n.transportQuotePickupNotInFuture,
  TransportQuoteError.deliveryBeforePickup =>
    l10n.transportQuoteDeliveryBeforePickup,
  TransportQuoteError.termsTooLong => l10n.transportQuoteTermsTooLong,
};

/// Every refusal in one line, so the bid form names all of its objections at
/// once rather than one per tap.
String transportQuoteErrorSummary(
  AppLocalizations l10n,
  List<TransportQuoteError> errors,
) => errors.map((error) => transportQuoteErrorText(l10n, error)).join(' ');

/// The sentence for one refused status change.
String transportFulfillmentErrorText(
  AppLocalizations l10n,
  TransportFulfillmentError error, {
  String currentStatus = '',
  String nextStatus = '',
}) => switch (error) {
  TransportFulfillmentError.currentStatusUnknown =>
    l10n.transportJobStatusUnknown(
      transportFulfillmentStatusLabel(l10n, currentStatus),
    ),
  TransportFulfillmentError.nextStatusUnknown ||
  TransportFulfillmentError.transitionNotAllowed =>
    l10n.transportJobTransitionNotAllowed(
      transportFulfillmentStatusLabel(l10n, currentStatus),
      transportFulfillmentStatusLabel(l10n, nextStatus),
    ),
  TransportFulfillmentError.containerNumberRequired =>
    l10n.transportJobContainerRequired,
};

/// The label for a transport fulfilment status.
///
/// Only the five the state machine produces get words. Anything else - the
/// `active`, `in_progress`, `sold`, `reserved`, `inactive` an admin path can
/// write onto the same document - is shown as stored rather than mapped onto
/// the nearest transport status, because mis-labelling a car as "In transit"
/// when nobody said it was moving is worse than showing a raw value.
String transportFulfillmentStatusLabel(AppLocalizations l10n, String status) =>
    switch (status.trim()) {
      'pending' => l10n.pending,
      'scheduled' => l10n.transportStatusScheduled,
      'in_transit' => l10n.inTransit,
      'delivered' => l10n.filterDelivered,
      'cancelled' => l10n.cancelled,
      '' => l10n.notProvided,
      _ => status.trim(),
    };

/// "Open carrier" or "Enclosed carrier".
String transportMethodLabel(AppLocalizations l10n, String method) =>
    method.trim().toLowerCase() == 'enclosed'
    ? l10n.enclosedTransport
    : l10n.openTransport;

/// The heading for a section of the business transport feed.
String businessTransportSectionLabel(
  AppLocalizations l10n,
  BusinessTransportSection section,
) => switch (section) {
  BusinessTransportSection.openToBid => l10n.businessTransportOpenToBid,
  BusinessTransportSection.quoted => l10n.businessTransportQuoted,
  BusinessTransportSection.wonJobs => l10n.businessTransportWonJobs,
};

/// What to say when a section is empty.
String businessTransportSectionEmpty(
  AppLocalizations l10n,
  BusinessTransportSection section,
) => switch (section) {
  BusinessTransportSection.openToBid => l10n.businessTransportNoOpportunities,
  BusinessTransportSection.quoted => l10n.businessTransportNoQuotes,
  BusinessTransportSection.wonJobs => l10n.businessTransportNoJobs,
};
