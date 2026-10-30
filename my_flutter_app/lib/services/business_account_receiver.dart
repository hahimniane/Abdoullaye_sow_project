/// The "Received by" value for money that went straight to the business
/// (Zelle, a transfer, a card or a payment link) rather than into a staff
/// member's hands. Accepted by every callable that takes `receivedByStaffId`
/// and stored as is; nobody "holds" it (docs/STAFF_BALANCES.md §1 and §2).
const businessAccountReceiver = 'business_account';

/// True for [businessAccountReceiver].
bool isBusinessAccountReceiver(String? id) =>
    (id ?? '').trim() == businessAccountReceiver;
