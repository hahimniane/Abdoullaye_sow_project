import '../l10n/app_localizations.dart';
import '../services/business_parking_entry.dart';

/// EN/FR copy for business-entered parking.
///
/// The decisions live in the pure module (`services/business_parking_entry.dart`)
/// and the words live here, the same split `car_option_localization.dart` uses:
/// a validator returns a code, never a sentence, so a French user is never
/// shown an English refusal.

/// The sentence for one refusal.
String businessParkingErrorText(
  AppLocalizations l10n,
  BusinessParkingEntryError error,
) => switch (error) {
  BusinessParkingEntryError.businessRequired =>
    l10n.parkingErrorBusinessRequired,
  BusinessParkingEntryError.customerNameRequired =>
    l10n.parkingErrorCustomerName,
  BusinessParkingEntryError.customerPhoneRequired =>
    l10n.parkingErrorCustomerPhone,
  BusinessParkingEntryError.customerEmailInvalid =>
    l10n.parkingErrorCustomerEmail,
  BusinessParkingEntryError.paymentLinkContactRequired =>
    l10n.parkingErrorPaymentLinkContact,
  BusinessParkingEntryError.carMakeRequired => l10n.parkingErrorCarMake,
  BusinessParkingEntryError.carModelRequired => l10n.parkingErrorCarModel,
  BusinessParkingEntryError.carYearRequired => l10n.parkingErrorCarYear,
  BusinessParkingEntryError.carYearInvalid => l10n.parkingErrorCarYearInvalid,
  BusinessParkingEntryError.startDateRequired => l10n.parkingErrorStartDate,
  BusinessParkingEntryError.endDateRequired => l10n.parkingErrorEndDate,
  BusinessParkingEntryError.endDateBeforeStartDate =>
    l10n.parkingErrorEndBeforeStart,
};

/// Every refusal in one line, so the form names all of its objections at once.
String businessParkingErrorSummary(
  AppLocalizations l10n,
  List<BusinessParkingEntryError> errors,
) => errors.map((error) => businessParkingErrorText(l10n, error)).join(' ');

/// The label for one of [businessParkingReceivedViaValues].
String businessParkingReceivedViaLabel(AppLocalizations l10n, String value) =>
    switch (value) {
      'zelle' => l10n.receivedViaZelle,
      'cash' => l10n.receivedViaCash,
      'cashapp' => l10n.receivedViaCashApp,
      'venmo' => l10n.receivedViaVenmo,
      'check' => l10n.receivedViaCheck,
      'card_in_person' => l10n.receivedViaCardInPerson,
      _ => l10n.receivedViaOther,
    };

/// Who is collecting this entry's money, and whether they have.
///
/// Returns "" for a customer's own booking - that record's payment is the
/// platform's, and labelling it here would say the opposite.
String businessParkingPaymentStatusLabel(
  AppLocalizations l10n,
  Map<String, dynamic> row,
) {
  if (!isBusinessEnteredParking(row)) return '';
  final method = (row['paymentMethod'] ?? '').toString().trim();
  final paymentStatus = (row['paymentStatus'] ?? '').toString().trim();
  if (method == 'payment_link') {
    return paymentStatus == 'succeeded' || paymentStatus == 'paid'
        ? l10n.paymentLinkPaid
        : l10n.paymentLinkSent;
  }
  if (paymentStatus == 'paid') return l10n.paidToTheBusiness;
  if (paymentStatus == 'not_required') return l10n.nothingToCollect;
  return l10n.awaitingPaymentToTheBusiness;
}
