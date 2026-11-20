// Fleet payment claims on the phone (docs/FLEET_PAYMENT_PROOF.md, "Office"),
// mirroring admin_web/src/lib/fleet-claims.ts. A driver's WhatsApp screenshot
// is only a claim; the bank deposit is the proof. This file turns the
// `fleetClaims` snapshot into the rows the office sees: which claims are still
// open, what each one waits for (one plain sentence kind per state and
// reason), oldest first, and which waiting deposits the office may hand to a
// claim. Pure: no Firebase, no clock of its own. Built once per snapshot,
// never per row.

import 'fleet_requests.dart' show FleetWaitingDeposit;

String _s(Object? v) => (v ?? '').toString().trim();

int _ms(Object? v) {
  final n = v is num ? v : num.tryParse(_s(v));
  return n != null && n.isFinite && n > 0 ? n.round() : 0;
}

enum FleetClaimState {
  askingDriver,
  askingAmount,
  waitingBank,
  askingName,
  paid,
  office,
  closed,
  unknown,
}

const _stateNames = {
  'asking_driver': FleetClaimState.askingDriver,
  'asking_amount': FleetClaimState.askingAmount,
  'waiting_bank': FleetClaimState.waitingBank,
  'asking_name': FleetClaimState.askingName,
  'paid': FleetClaimState.paid,
  'office': FleetClaimState.office,
  'closed': FleetClaimState.closed,
};

/// One `fleetClaims` document.
class FleetClaim {
  const FleetClaim({
    required this.id,
    this.driverId,
    this.fromPhone = '',
    this.state = FleetClaimState.unknown,
    this.amountCents,
    this.payerName = '',
    this.mediaPath = '',
    this.creditId = '',
    this.paymentId = '',
    this.reason = '',
    this.createdAtMs = 0,
    this.toldLateAtMs = 0,
    this.closeAtMs = 0,
  });

  final String id, fromPhone, payerName, mediaPath, creditId, paymentId, reason;

  /// Null until the claim names a driver.
  final String? driverId;
  final FleetClaimState state;

  /// Null until an amount is known.
  final int? amountCents;
  final int createdAtMs, toldLateAtMs, closeAtMs;
}

/// A `fleetClaims` document read defensively; null without an id.
FleetClaim? readFleetClaim(String id, Map<String, dynamic> m) {
  final docId = _s(m['id']).isNotEmpty ? _s(m['id']) : _s(id);
  if (docId.isEmpty) return null;
  final amount = m['amountCents'] is num
      ? (m['amountCents'] as num).round()
      : int.tryParse(_s(m['amountCents']));
  return FleetClaim(
    id: docId,
    driverId: _s(m['driverId']).isEmpty ? null : _s(m['driverId']),
    fromPhone: _s(m['fromPhone']),
    state: _stateNames[_s(m['state'])] ?? FleetClaimState.unknown,
    amountCents: amount != null && amount > 0 ? amount : null,
    payerName: _s(m['payerName']),
    mediaPath: _s(m['mediaPath']),
    creditId: _s(m['creditId']),
    paymentId: _s(m['paymentId']),
    reason: _s(m['reason']),
    createdAtMs: _ms(m['createdAtMs']),
    toldLateAtMs: _ms(m['toldLateAtMs']),
    closeAtMs: _ms(m['closeAtMs']),
  );
}

/// Claims the office still looks at: the driver's side is open, or a person is
/// needed. Paid, closed and unreadable are not listed.
bool isOpenFleetClaim(FleetClaim claim) =>
    claim.state != FleetClaimState.paid &&
    claim.state != FleetClaimState.closed &&
    claim.state != FleetClaimState.unknown;

/// What an open claim waits for. One sentence per state and reason; the words
/// are in the ARB files (`fleetClaimSentenceText`).
enum FleetClaimSentence {
  askingDriver,
  askingAmount,
  askingName,
  waitingBank,
  noDepositAfterTwoDays,
  wrongRecipient,
  depositTaken,
  tooOld,
  notADriver,
  twoClaims,
  needsPerson,
  none,
}

FleetClaimSentence fleetClaimSentence(FleetClaim claim) {
  switch (claim.state) {
    case FleetClaimState.askingDriver:
      return FleetClaimSentence.askingDriver;
    case FleetClaimState.askingAmount:
      return FleetClaimSentence.askingAmount;
    case FleetClaimState.askingName:
      return FleetClaimSentence.askingName;
    case FleetClaimState.waitingBank:
      return claim.toldLateAtMs > 0
          ? FleetClaimSentence.noDepositAfterTwoDays
          : FleetClaimSentence.waitingBank;
    case FleetClaimState.office:
      return switch (claim.reason) {
        'wrong_recipient' => FleetClaimSentence.wrongRecipient,
        'deposit_taken' => FleetClaimSentence.depositTaken,
        'too_old' => FleetClaimSentence.tooOld,
        'not_a_driver' => FleetClaimSentence.notADriver,
        'two_claims' => FleetClaimSentence.twoClaims,
        _ => FleetClaimSentence.needsPerson,
      };
    default:
      return FleetClaimSentence.none;
  }
}

/// One row of the "Reported by drivers" card.
class FleetClaimView {
  const FleetClaimView({
    required this.id,
    required this.who,
    required this.hasDriver,
    required this.amountCents,
    required this.atMs,
    required this.sentence,
    required this.hasPhoto,
    required this.state,
  });

  final String id;

  /// The driver's name, else the phone the photo came from.
  final String who;
  final bool hasDriver;
  final int? amountCents;
  final int atMs;
  final FleetClaimSentence sentence;
  final bool hasPhoto;
  final FleetClaimState state;
}

/// The rows of the card: open claims only, oldest first (the one waiting
/// longest on top), with the driver's name looked up once.
List<FleetClaimView> fleetOpenClaimViews(
  Iterable<FleetClaim> claims,
  Map<String, String> driverNames,
) {
  final out = <FleetClaimView>[];
  for (final claim in claims) {
    if (!isOpenFleetClaim(claim)) continue;
    final name = claim.driverId == null
        ? ''
        : (driverNames[claim.driverId] ?? '');
    out.add(
      FleetClaimView(
        id: claim.id,
        who: name.isNotEmpty
            ? name
            : (claim.fromPhone.isEmpty ? '—' : claim.fromPhone),
        hasDriver: name.isNotEmpty,
        amountCents: claim.amountCents,
        atMs: claim.createdAtMs,
        sentence: fleetClaimSentence(claim),
        hasPhoto: claim.mediaPath.isNotEmpty,
        state: claim.state,
      ),
    );
  }
  out.sort((a, b) {
    final t = a.atMs - b.atMs;
    return t != 0 ? t : a.id.compareTo(b.id);
  });
  return out;
}

/// A waiting deposit a claim may be given, and whether it is the claim's
/// amount.
class FleetDepositOffer {
  const FleetDepositOffer(this.deposit, this.sameAmount);

  final FleetWaitingDeposit deposit;
  final bool sameAmount;
}

/// The waiting deposits a claim may be given. A deposit still pending at the
/// bank is never offered (it can change). Same amount first, then newest. The
/// bank's amount is what is recorded (Q3), so a different amount is allowed:
/// the picker marks it.
List<FleetDepositOffer> fleetDepositsForClaim(
  int? claimAmountCents,
  Iterable<FleetWaitingDeposit> waiting,
) {
  final out = [
    for (final w in waiting)
      if (!w.pending && w.id.isNotEmpty && w.amountCents > 0)
        FleetDepositOffer(
          w,
          claimAmountCents != null && w.amountCents == claimAmountCents,
        ),
  ];
  out.sort((a, b) {
    final same = (b.sameAmount ? 1 : 0) - (a.sameAmount ? 1 : 0);
    if (same != 0) return same;
    final t = b.deposit.atMs - a.deposit.atMs;
    return t != 0 ? t : a.deposit.id.compareTo(b.deposit.id);
  });
  return out;
}
