import '../l10n/app_localizations.dart';
import '../services/business_account_receiver.dart';
import 'lot_sheets.dart';

/// The "Received by" choices wherever the app records money: **Business
/// account** first (money paid straight to the business), then the people
/// [people] names, in their order (docs/STAFF_BALANCES.md §4).
///
/// Every "Received by" picker builds its options here, so a place can never
/// offer the business account while another forgets it.
List<LotOption<String>> receivedByOptions(
  AppLocalizations l10n,
  Iterable<LotOption<String>> people,
) => [
  LotOption<String>(businessAccountReceiver, l10n.sbalBusinessAccount),
  ...people,
];

/// A stored receiver as words: the business account's name for
/// [businessAccountReceiver], else [personName] (which may be '').
String receivedByName(AppLocalizations l10n, String? id, String personName) =>
    isBusinessAccountReceiver(id) ? l10n.sbalBusinessAccount : personName;
