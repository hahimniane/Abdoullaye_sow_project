import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/fleet_widgets.dart';

/// "Reported by drivers, waiting for the bank" on the Bank tab
/// (docs/FLEET_PAYMENT_PROOF.md, Office). A driver's WhatsApp screenshot is
/// only a claim; the deposit in the bank is the proof. Each open claim shows
/// who, how much, when, what it waits for and its photo, with two office
/// actions: "This deposit is theirs" (hand it a waiting deposit) and "Close".
///
/// The claims come from their own live read on [FleetController]; a failure
/// there shows here only and never blanks the rest of Fleet.
class FleetClaimsCard extends StatefulWidget {
  const FleetClaimsCard({
    super.key,
    required this.controller,
    required this.waiting,
    required this.onChanged,
  });

  final FleetController controller;

  /// The deposits waiting for the office (from `bank_status`).
  final List<FleetWaitingDeposit> waiting;

  /// Called after a deposit was given to a claim (the waiting list changed).
  final VoidCallback onChanged;

  @override
  State<FleetClaimsCard> createState() => _FleetClaimsCardState();
}

class _FleetClaimsCardState extends State<FleetClaimsCard> {
  bool _busy = false;
  String? _error;
  String? _flash;
  String? _photoBusyId;

  FleetController get c => widget.controller;

  Future<void> _photo(FleetClaimView v) async {
    if (_photoBusyId != null) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _photoBusyId = v.id;
      _error = null;
      _flash = null;
    });
    try {
      final url = await c.service.claimPhotoUrl(c.businessId, v.id);
      if (!mounted) return;
      if (url == null) {
        setState(() => _error = l10n.fltClaimPhotoGone);
      } else {
        await showFleetPhoto(context, url);
      }
    } on FleetFailure catch (failure) {
      if (mounted) setState(() => _error = fleetRefusalText(l10n, failure));
    } finally {
      if (mounted) setState(() => _photoBusyId = null);
    }
  }

  Future<void> _theirs(FleetClaimView v) async {
    setState(() {
      _error = null;
      _flash = null;
    });
    final l10n = AppLocalizations.of(context)!;
    final done = await showFleetSheet(
      context,
      (_) => FleetClaimDepositSheet(
        controller: c,
        claim: v,
        waiting: widget.waiting,
      ),
    );
    if (done && mounted) {
      setState(() => _flash = l10n.fltPaymentRecorded);
      widget.onChanged();
    }
  }

  Future<void> _close(FleetClaimView v) async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    final yes = await fleetConfirm(
      context,
      title: l10n.fltClaimCloseTitle,
      message: l10n.fltClaimCloseMessage(driverDisplayName(v.who)),
      confirmLabel: l10n.fltClose,
      destructive: true,
    );
    if (!yes || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
      _flash = null;
    });
    try {
      await c.service.call(FleetRequests.claimClose(c.businessId, v.id));
      if (mounted) setState(() => _flash = l10n.fltClaimClosed);
    } on FleetFailure catch (failure) {
      if (mounted) setState(() => _error = fleetRefusalText(l10n, failure));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final names = {
          for (final d in c.state.data.drivers)
            d.id: d.name.isEmpty ? d.phone : d.name,
        };
        final views = fleetOpenClaimViews(c.claims, names);
        return FleetCard(
          key: const Key('fleet-claims-card'),
          title: l10n.fltClaimsTitle,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.fltClaimsHint,
                style: const TextStyle(color: AppColors.muted),
              ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.md),
                  child: Text(
                    _error!,
                    key: const Key('fleet-claims-error'),
                    style: const TextStyle(color: AppColors.errorRed),
                  ),
                ),
              if (_flash != null)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.md),
                  child: Text(
                    _flash!,
                    key: const Key('fleet-claims-flash'),
                    style: const TextStyle(color: AppColors.sage),
                  ),
                ),
              const SizedBox(height: AppSpacing.md),
              if (c.claimsLoading && views.isEmpty)
                const Center(
                  child: CircularProgressIndicator(
                    key: Key('fleet-claims-loading'),
                  ),
                )
              else if (c.claimsError && views.isEmpty)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.fltClaimsLoadFailed,
                      key: const Key('fleet-claims-failed'),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    OutlinedButton(
                      key: const Key('fleet-claims-retry'),
                      style: _bigButton,
                      onPressed: c.retryClaims,
                      child: Text(l10n.fltRetry),
                    ),
                  ],
                )
              else if (views.isEmpty)
                Text(l10n.fltClaimsEmpty, key: const Key('fleet-claims-none'))
              else
                for (final v in views)
                  Padding(
                    key: Key('fleet-claim-${v.id}'),
                    padding: const EdgeInsets.only(bottom: AppSpacing.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          v.amountCents == null
                              ? '—'
                              : fleetMoney(v.amountCents!),
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          v.who,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        if (v.atMs > 0)
                          Text(
                            displayDateTime(
                              DateTime.fromMillisecondsSinceEpoch(v.atMs),
                              locale,
                            ),
                            style: const TextStyle(color: AppColors.muted),
                          ),
                        Text(
                          fleetClaimSentenceText(l10n, v.sentence),
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Wrap(
                          spacing: AppSpacing.sm,
                          runSpacing: AppSpacing.sm,
                          children: [
                            if (v.hasPhoto)
                              OutlinedButton.icon(
                                key: Key('fleet-claim-photo-${v.id}'),
                                style: _bigButton,
                                onPressed: _photoBusyId != null
                                    ? null
                                    : () => _photo(v),
                                icon: _photoBusyId == v.id
                                    ? const SizedBox(
                                        height: 16,
                                        width: 16,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                        ),
                                      )
                                    : const Icon(
                                        Icons.image_outlined,
                                        size: 18,
                                      ),
                                label: Text(l10n.fltClaimViewPhoto),
                              )
                            else
                              Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: AppSpacing.md,
                                ),
                                child: Text(
                                  l10n.fltClaimNoPhoto,
                                  style: const TextStyle(
                                    color: AppColors.muted,
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                            FilledButton(
                              key: Key('fleet-claim-theirs-${v.id}'),
                              style: _bigButton,
                              onPressed: _busy ? null : () => _theirs(v),
                              child: Text(l10n.fltClaimTheirs),
                            ),
                            OutlinedButton(
                              key: Key('fleet-claim-close-${v.id}'),
                              style: _bigButton,
                              onPressed: _busy ? null : () => _close(v),
                              child: Text(l10n.fltClose),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
            ],
          ),
        );
      },
    );
  }
}

/// A button at least 48 high, whatever the theme says.
final ButtonStyle _bigButton = ButtonStyle(
  minimumSize: WidgetStateProperty.all(const Size(48, 48)),
);

/// Picks one waiting deposit for a claim, confirms, and gives it
/// (`claim_assign`). Pops true when the server accepted.
class FleetClaimDepositSheet extends StatefulWidget {
  const FleetClaimDepositSheet({
    super.key,
    required this.controller,
    required this.claim,
    required this.waiting,
  });

  final FleetController controller;
  final FleetClaimView claim;
  final List<FleetWaitingDeposit> waiting;

  @override
  State<FleetClaimDepositSheet> createState() => _FleetClaimDepositSheetState();
}

class _FleetClaimDepositSheetState extends State<FleetClaimDepositSheet>
    with FleetRun {
  String? _picked;
  late final List<FleetDepositOffer> _offers = fleetDepositsForClaim(
    widget.claim.amountCents,
    widget.waiting,
  );

  Future<void> _give() async {
    final l10n = AppLocalizations.of(context)!;
    final offer = _offers.where((o) => o.deposit.id == _picked).firstOrNull;
    if (offer == null) {
      setState(() => error = l10n.fltClaimPickDeposit);
      return;
    }
    final yes = await fleetConfirm(
      context,
      title: l10n.fltClaimGiveTitle,
      message: l10n.fltClaimGiveMessage(
        fleetMoney(offer.deposit.amountCents),
        offer.deposit.senderName.isEmpty
            ? l10n.fltClaimUnknownSender
            : offer.deposit.senderName,
        driverDisplayName(widget.claim.who),
      ),
      confirmLabel: l10n.fltClaimGiveDeposit,
    );
    if (!yes || !mounted) return;
    final c = widget.controller;
    final answer = await runFleet(
      c.service,
      FleetRequests.claimAssign(
        c.businessId,
        claimId: widget.claim.id,
        creditId: offer.deposit.id,
      ),
    );
    if (answer != null && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final chosen = _offers.where((o) => o.deposit.id == _picked).firstOrNull;
    return FleetSheetFrame(
      title: l10n.fltClaimTheirs,
      subtitle: [
        widget.claim.who,
        if (widget.claim.amountCents != null)
          fleetMoney(widget.claim.amountCents!),
      ].join(' · '),
      actionLabel: l10n.fltClaimGiveDeposit,
      busy: busy,
      error: error,
      onSubmit: _give,
      children: [
        if (_offers.isEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.lg),
            child: Text(
              l10n.fltClaimNoDeposits,
              key: const Key('fleet-claim-no-deposits'),
            ),
          )
        else
          RadioGroup<String>(
            groupValue: _picked,
            onChanged: (v) {
              if (!busy) setState(() => _picked = v);
            },
            child: Column(
              children: [
                for (final o in _offers)
                  RadioListTile<String>(
                    key: Key('fleet-claim-offer-${o.deposit.id}'),
                    value: o.deposit.id,
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      fleetMoney(o.deposit.amountCents),
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    subtitle: Text(
                      [
                        if (o.deposit.senderName.isNotEmpty)
                          o.deposit.senderName,
                        if (o.deposit.atMs > 0)
                          displayDateTime(
                            DateTime.fromMillisecondsSinceEpoch(o.deposit.atMs),
                            locale,
                          )
                        else if (o.deposit.dateKey.isNotEmpty)
                          fleetDayLabel(o.deposit.dateKey),
                        if (o.sameAmount) l10n.fltClaimSameAmount,
                      ].join(' · '),
                    ),
                  ),
              ],
            ),
          ),
        if (chosen != null &&
            !chosen.sameAmount &&
            widget.claim.amountCents != null)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            child: Text(
              l10n.fltClaimDifferentAmount,
              key: const Key('fleet-claim-different'),
              style: const TextStyle(color: AppColors.muted, fontSize: 12),
            ),
          ),
      ],
    );
  }
}

/// A full-screen, pinch-to-zoom view of a payment screenshot's link.
Future<void> showFleetPhoto(BuildContext context, String url) {
  final l10n = AppLocalizations.of(context)!;
  return showDialog<void>(
    context: context,
    builder: (context) => Dialog.fullscreen(
      backgroundColor: Colors.black,
      child: Stack(
        children: [
          Positioned.fill(
            child: InteractiveViewer(
              child: Image.network(
                url,
                key: const Key('fleet-claim-photo-image'),
                fit: BoxFit.contain,
                errorBuilder: (_, _, _) => Center(
                  child: Text(
                    l10n.fltClaimPhotoGone,
                    style: const TextStyle(color: Colors.white70),
                  ),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.topRight,
              child: IconButton(
                key: const Key('fleet-claim-photo-close'),
                tooltip: l10n.fltClose,
                color: Colors.white,
                iconSize: 28,
                constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                icon: const Icon(Icons.close),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
