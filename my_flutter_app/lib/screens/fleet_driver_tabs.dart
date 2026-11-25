import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_driver_app.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/fleet_widgets.dart';

/// Opens a link outside the app (WhatsApp, the dialer); false when nothing
/// could open it. Injected by tests.
typedef DriverLinkOpener = Future<bool> Function(Uri uri);

String _lang(BuildContext context) =>
    Localizations.localeOf(context).languageCode == 'fr' ? 'fr' : 'en';

// Styles come from the theme: the app's typeface ships one file per weight,
// so a bare `fontWeight` on a plain TextStyle would not be drawn bold.
TextStyle _muted(BuildContext context) => Theme.of(context)
    .textTheme
    .bodyMedium!
    .copyWith(fontSize: 13, color: AppColors.muted, height: 1.35);
TextStyle _body(BuildContext context) => Theme.of(
  context,
).textTheme.bodyLarge!.copyWith(color: AppColors.ink, height: 1.35);
TextStyle _strong(BuildContext context) =>
    Theme.of(context).textTheme.titleMedium!.copyWith(color: AppColors.ink);
TextStyle _display(BuildContext context) =>
    Theme.of(context).textTheme.displayLarge!.copyWith(color: AppColors.ink);

/// The page frame every driver tab shares: a title block, then cards, with
/// pull to refresh. Nothing touches the screen's edge.
class _DriverPage extends StatelessWidget {
  const _DriverPage({
    required this.pageKey,
    required this.title,
    required this.onRefresh,
    required this.children,
    this.eyebrow,
    this.leading,
    this.trailing,
  });

  final Key pageKey;
  final String title;
  final String? eyebrow;
  final Widget? leading;
  final Widget? trailing;
  final Future<void> Function() onRefresh;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        onRefresh: onRefresh,
        child: ListView(
          key: pageKey,
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (leading != null) ...[
                  leading!,
                  const SizedBox(width: AppSpacing.xs),
                ],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (eyebrow != null)
                        Text(
                          eyebrow!,
                          style: _muted(context),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      Text(
                        title,
                        style: Theme.of(context).textTheme.displaySmall
                            ?.copyWith(color: AppColors.ink),
                      ),
                    ],
                  ),
                ),
                ?trailing,
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            for (final child in children) ...[
              child,
              const SizedBox(height: AppSpacing.md),
            ],
          ],
        ),
      ),
    );
  }
}

/// A label on the left, a value (and maybe a chip) on the right; the value
/// wraps under the label on a narrow phone instead of overflowing.
class _Line extends StatelessWidget {
  const _Line({required this.label, this.value, this.trailing, this.sub});

  final String label;
  final String? value, sub;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: _body(context)),
                if (sub != null && sub!.isNotEmpty)
                  Text(sub!, style: _muted(context)),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          // Sized to its content, against the right edge; never wider than
          // this, so a long French chip wraps instead of overflowing.
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 150),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (value != null)
                  Text(
                    value!,
                    style: _strong(context),
                    textAlign: TextAlign.end,
                  ),
                if (trailing != null) ...[
                  if (value != null) const SizedBox(height: 4),
                  trailing!,
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _billTitle(AppLocalizations l10n, FleetBill bill, String language) {
  final kind = driverBillKind(bill);
  final base = switch (kind) {
    DriverBillKind.plateFee => l10n.fdrBillPlateFee,
    DriverBillKind.lateFee => l10n.fdrBillLateFee,
    DriverBillKind.ticket => l10n.fdrBillTicket,
    DriverBillKind.charge => l10n.fdrBillCharge,
  };
  if (kind == DriverBillKind.plateFee) {
    final period = driverBillPeriod(bill, language: language);
    return period.isEmpty ? base : '$base · $period';
  }
  // A charge or a ticket carries the office's own words for it.
  if (kind != DriverBillKind.lateFee && bill.label.isNotEmpty) {
    return bill.label;
  }
  return base;
}

Widget _billChip(AppLocalizations l10n, DriverBillState state) =>
    switch (state) {
      DriverBillState.paid => FleetChip(
        label: l10n.fltBillPaid,
        tone: FleetTone.ok,
      ),
      DriverBillState.waived => FleetChip(label: l10n.fltBillWaived),
      DriverBillState.late => FleetChip(
        label: l10n.fltBillLate,
        tone: FleetTone.bad,
      ),
      DriverBillState.open => FleetChip(
        label: l10n.fltBillOpen,
        tone: FleetTone.warn,
      ),
    };

String _methodText(AppLocalizations l10n, FleetPayment p) =>
    p.imported ? l10n.fdrMethodEarlier : fleetMethodText(l10n, p.method);

// ---------------------------------------------------------------------------
// Home.
// ---------------------------------------------------------------------------

/// The driver's home: what they owe, how to pay, the payments they reported
/// and the last ones received.
class FleetDriverHomeTab extends StatelessWidget {
  const FleetDriverHomeTab({
    super.key,
    required this.fleet,
    required this.home,
    required this.stale,
    required this.onRefresh,
    required this.onSeePayments,
    required this.openLink,
    this.leading,
    this.trailing,
  });

  final DriverFleet fleet;
  final DriverHome home;

  /// The last refresh failed: what is shown is the copy kept on the phone.
  final bool stale;
  final Future<void> Function() onRefresh;
  final VoidCallback onSeePayments;
  final DriverLinkOpener openLink;
  final Widget? leading, trailing;

  Future<void> _toClipboard(BuildContext context, String text) async {
    final l10n = AppLocalizations.of(context)!;
    await Clipboard.setData(ClipboardData(text: text));
    if (context.mounted) showSuccessSnackBar(context, l10n.fdrCopied);
  }

  Future<void> _sendProof(BuildContext context) async {
    final l10n = AppLocalizations.of(context)!;
    final uri = driverProofWhatsAppUri(
      home.proofWhatsApp,
      l10n.fdrProofMessage(fleet.businessName),
    );
    var opened = false;
    if (uri != null) {
      try {
        opened = await openLink(uri);
      } catch (_) {
        opened = false;
      }
    }
    if (!opened && context.mounted) {
      showErrorSnackBar(
        context,
        l10n.fdrProofNoWhatsApp(driverPhoneLabel(home.proofWhatsApp)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final language = _lang(context);
    final owe = driverOwe(fleet, home.todayKey);
    final open = fleet.openBills;
    final shown = open.take(4).toList();
    final credit = fleet.balance.creditCents;
    return _DriverPage(
      pageKey: const Key('fleet-driver-home'),
      eyebrow: l10n.fdrOnLaawol(fleet.businessName),
      title: fleet.driverName.isEmpty
          ? l10n.fdrHiNoName
          : l10n.fdrHi(fleet.driverName),
      leading: leading,
      trailing: trailing,
      onRefresh: onRefresh,
      children: [
        if (stale)
          Text(
            l10n.fdrStale,
            key: const Key('fleet-driver-stale'),
            style: _muted(context),
          ),
        if (fleet.left)
          Text(
            l10n.fdrLeftNote(fleet.businessName),
            key: const Key('fleet-driver-left'),
            style: _body(context),
          ),
        FleetCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(l10n.fdrYouOwe, style: _muted(context)),
              const SizedBox(height: 2),
              Text(
                fleetMoney(owe.cents),
                key: const Key('fleet-driver-owed'),
                style: _display(context).copyWith(
                  fontSize: 34,
                  color: owe.state == DriverOwe.late
                      ? AppColors.errorRed
                      : AppColors.ink,
                ),
              ),
              const SizedBox(height: 4),
              switch (owe.state) {
                DriverOwe.nothing => Text(
                  l10n.fdrPaidUp,
                  key: const Key('fleet-driver-paid-up'),
                  style: _strong(context).copyWith(color: AppColors.sage),
                ),
                DriverOwe.late => Text(
                  owe.dayKey.isEmpty
                      ? l10n.fltBillLate
                      : l10n.fdrLateSince(
                          driverDayLabel(owe.dayKey, language: language),
                        ),
                  key: const Key('fleet-driver-late'),
                  style: _strong(context).copyWith(color: AppColors.errorRed),
                ),
                DriverOwe.due => Text(
                  l10n.fdrDueOn(driverDayLabel(owe.dayKey, language: language)),
                  key: const Key('fleet-driver-due'),
                  style: _strong(context),
                ),
              },
              if (shown.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.md),
                const Divider(height: 1, color: AppColors.hairline),
                for (final bill in shown)
                  _Line(
                    label: _billTitle(l10n, bill, language),
                    sub: bill.dueDayKey.isEmpty
                        ? null
                        : l10n.fdrDueOn(
                            driverDayLabel(bill.dueDayKey, language: language),
                          ),
                    value: fleetMoney(bill.remainingCents),
                  ),
                if (open.length > shown.length)
                  Text(
                    l10n.fdrMoreBills(open.length - shown.length),
                    style: _muted(context),
                  ),
              ],
              if (credit > 0) ...[
                const SizedBox(height: AppSpacing.sm),
                Text(
                  l10n.fdrCredit(fleetMoney(credit)),
                  key: const Key('fleet-driver-credit'),
                  style: _muted(context),
                ),
              ],
            ],
          ),
        ),
        FleetCard(
          title: l10n.fdrPayTitle,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (fleet.hasZelle) ...[
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(l10n.fdrPaySendTo, style: _muted(context)),
                          if (fleet.zelleName.isNotEmpty)
                            Text(fleet.zelleName, style: _body(context)),
                          SelectableText(
                            fleet.zelleHandle,
                            key: const Key('fleet-driver-zelle'),
                            style: _strong(context),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    OutlinedButton(
                      key: const Key('fleet-driver-copy-zelle'),
                      onPressed: () => _toClipboard(context, fleet.zelleHandle),
                      child: Text(l10n.fdrCopy),
                    ),
                  ],
                ),
                if (owe.cents > 0) ...[
                  const SizedBox(height: AppSpacing.sm),
                  Text(l10n.fdrPayAmount, style: _muted(context)),
                  Text(fleetMoney(owe.cents), style: _strong(context)),
                ],
              ] else
                Text(
                  l10n.fdrPayNoZelle(fleet.businessName),
                  key: const Key('fleet-driver-no-zelle'),
                  style: _body(context),
                ),
              const SizedBox(height: AppSpacing.lg),
              SizedBox(
                width: double.infinity,
                height: 50,
                child: FilledButton.icon(
                  key: const Key('fleet-driver-send-proof'),
                  onPressed: () => _sendProof(context),
                  icon: const Icon(Icons.photo_camera_outlined, size: 20),
                  label: Text(
                    l10n.fdrProofButton,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                l10n.fdrProofHint(fleet.businessName),
                style: _muted(context),
              ),
            ],
          ),
        ),
        if (fleet.claims.isNotEmpty)
          FleetCard(
            key: const Key('fleet-driver-claims'),
            title: l10n.fdrClaimsTitle,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final claim in fleet.claims)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _claimLabel(l10n, claim, language),
                          style: _body(context),
                        ),
                        const SizedBox(height: 4),
                        FleetChip(
                          label: switch (claim.state) {
                            DriverClaimState.checking => l10n.fdrClaimChecking,
                            DriverClaimState.reply => l10n.fdrClaimReply,
                            DriverClaimState.office => l10n.fdrClaimOffice(
                              fleet.businessName,
                            ),
                          },
                          tone: claim.state == DriverClaimState.reply
                              ? FleetTone.warn
                              : FleetTone.muted,
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        FleetCard(
          title: l10n.fdrLastPayments,
          child: fleet.payments.isEmpty
              ? Text(l10n.fdrNoPayments, style: _muted(context))
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final p in fleet.payments.take(3))
                      _Line(
                        label: driverDayLabel(p.paidDayKey, language: language),
                        sub: _methodText(l10n, p),
                        value: fleetMoney(p.amountCents),
                      ),
                    TextButton(
                      key: const Key('fleet-driver-see-payments'),
                      style: TextButton.styleFrom(
                        padding: EdgeInsets.zero,
                        minimumSize: const Size(44, 44),
                        alignment: Alignment.centerLeft,
                      ),
                      onPressed: onSeePayments,
                      child: Text(l10n.fdrSeeAll),
                    ),
                  ],
                ),
        ),
      ],
    );
  }

  String _claimLabel(AppLocalizations l10n, DriverClaim c, String language) {
    final day = c.createdAtMs <= 0
        ? ''
        : driverDayLabel(
            fleetDayKeyOf(DateTime.fromMillisecondsSinceEpoch(c.createdAtMs)),
            language: language,
          );
    return c.amountCents > 0
        ? l10n.fdrClaimRow(fleetMoney(c.amountCents), day)
        : l10n.fdrClaimRowNoAmount(day);
  }
}

/// A local day as a day key.
String fleetDayKeyOf(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-'
    '${d.month.toString().padLeft(2, '0')}-'
    '${d.day.toString().padLeft(2, '0')}';

// ---------------------------------------------------------------------------
// Payments.
// ---------------------------------------------------------------------------

/// Every bill (open first) and every payment received.
class FleetDriverPaymentsTab extends StatelessWidget {
  const FleetDriverPaymentsTab({
    super.key,
    required this.fleet,
    required this.home,
    required this.onRefresh,
    this.leading,
  });

  final DriverFleet fleet;
  final DriverHome home;
  final Future<void> Function() onRefresh;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final language = _lang(context);
    return _DriverPage(
      pageKey: const Key('fleet-driver-payments'),
      title: l10n.fdrTabPayments,
      leading: leading,
      onRefresh: onRefresh,
      children: [
        FleetCard(
          title: l10n.fdrBillsTitle,
          child: fleet.bills.isEmpty
              ? Text(l10n.fdrNoBills, style: _muted(context))
              : Column(
                  children: [
                    for (final bill in fleet.bills)
                      _Line(
                        label: _billTitle(l10n, bill, language),
                        sub: [
                          if (bill.dueDayKey.isNotEmpty)
                            l10n.fdrDueOn(
                              driverDayLabel(
                                bill.dueDayKey,
                                language: language,
                              ),
                            ),
                          if (bill.isOpen &&
                              bill.paidCents > 0 &&
                              bill.remainingCents > 0)
                            l10n.fdrBillPartPaid(
                              fleetMoney(bill.paidCents),
                              fleetMoney(bill.amountCents),
                            ),
                        ].join(' · '),
                        value: fleetMoney(
                          bill.isOpen ? bill.remainingCents : bill.amountCents,
                        ),
                        trailing: _billChip(
                          l10n,
                          driverBillState(bill, home.todayKey),
                        ),
                      ),
                  ],
                ),
        ),
        FleetCard(
          title: l10n.fdrPaymentsReceived,
          child: fleet.payments.isEmpty
              ? Text(l10n.fdrNoPayments, style: _muted(context))
              : Column(
                  children: [
                    for (final p in fleet.payments)
                      _Line(
                        label: driverDayLabel(p.paidDayKey, language: language),
                        sub: [
                          _methodText(l10n, p),
                          if (p.creditAddedCents > 0)
                            l10n.fdrPaymentCredit(
                              fleetMoney(p.creditAddedCents),
                            ),
                        ].join(' · '),
                        value: fleetMoney(p.amountCents),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// My plate.
// ---------------------------------------------------------------------------

/// The plate the driver holds, its fee and the papers to keep valid.
class FleetDriverPlateTab extends StatelessWidget {
  const FleetDriverPlateTab({
    super.key,
    required this.fleet,
    required this.home,
    required this.onRefresh,
    required this.openLink,
    this.leading,
  });

  final DriverFleet fleet;
  final DriverHome home;
  final Future<void> Function() onRefresh;
  final DriverLinkOpener openLink;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final language = _lang(context);
    return _DriverPage(
      pageKey: const Key('fleet-driver-plate'),
      title: l10n.fdrTabPlate,
      leading: leading,
      onRefresh: onRefresh,
      children: [
        if (fleet.plates.isEmpty)
          FleetCard(
            child: Text(
              l10n.fdrPlateNone,
              key: const Key('fleet-driver-no-plate'),
              style: _body(context),
            ),
          ),
        for (final plate in fleet.plates) ...[
          FleetCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.fltPlate, style: _muted(context)),
                Text(
                  plate.plate.isEmpty ? '—' : plate.plate,
                  style: _display(context).copyWith(letterSpacing: 1),
                ),
                if (plate.vehicleType.isNotEmpty)
                  Text(plate.vehicleType, style: _body(context)),
                Text(
                  plate.driverOwnsCar
                      ? l10n.fdrCarYours
                      : l10n.fdrCarBusiness(fleet.businessName),
                  style: _muted(context),
                ),
                const SizedBox(height: AppSpacing.md),
                const Divider(height: 1, color: AppColors.hairline),
                _Line(
                  label: l10n.fdrBillPlateFee,
                  sub: plate.isWeekly
                      ? l10n.fdrPlateDueWeekly(
                          driverWeekdayName(plate.dueDay, language: language),
                        )
                      : l10n.fdrPlateDueMonthly(plate.dueDay),
                  value: fleetRentText(l10n, plate.rentCents, plate.period),
                ),
                if (plate.startDayKey.isNotEmpty)
                  Text(
                    l10n.fdrPlateSince(
                      driverDayLabel(plate.startDayKey, language: language),
                    ),
                    style: _muted(context),
                  ),
              ],
            ),
          ),
          FleetCard(
            title: l10n.fdrPapersTitle,
            child: Column(
              children: [
                _paper(
                  l10n,
                  l10n.fdrPaperRegistration,
                  plate.registrationExpiry,
                  language,
                ),
                _paper(
                  l10n,
                  l10n.fdrPaperDiamond,
                  plate.diamondExpiry,
                  language,
                ),
              ],
            ),
          ),
          if (plate.insurer.isNotEmpty || plate.policyNumber.isNotEmpty)
            FleetCard(
              title: l10n.fdrInsuranceTitle,
              child: Column(
                children: [
                  if (plate.insurer.isNotEmpty)
                    _Line(label: l10n.fdrInsurer, value: plate.insurer),
                  if (plate.policyNumber.isNotEmpty)
                    _Line(label: l10n.fdrPolicy, value: plate.policyNumber),
                ],
              ),
            ),
        ],
        if (fleet.businessPhone.isNotEmpty)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              key: const Key('fleet-driver-call'),
              onPressed: () async {
                try {
                  await openLink(Uri(scheme: 'tel', path: fleet.businessPhone));
                } catch (_) {
                  // No dialer (a tablet): the number is on the button.
                }
              },
              icon: const Icon(Icons.call_outlined, size: 18),
              label: Text(
                '${l10n.fdrCallBusiness(fleet.businessName)} · '
                '${driverPhoneLabel(fleet.businessPhone)}',
              ),
            ),
          ),
      ],
    );
  }

  Widget _paper(
    AppLocalizations l10n,
    String label,
    String dayKey,
    String language,
  ) {
    final state = fleetExpiryState(dayKey, home.todayKey);
    final day = driverDayLabel(dayKey, language: language);
    return _Line(
      label: label,
      sub: switch (state) {
        FleetExpiry.missing => l10n.fdrPaperNoDate,
        FleetExpiry.expired => l10n.fdrPaperExpired(day),
        _ => l10n.fdrPaperExpires(day),
      },
      trailing: switch (state) {
        FleetExpiry.expired => FleetChip(
          label: l10n.fltExpiryExpired,
          tone: FleetTone.bad,
        ),
        FleetExpiry.soon => FleetChip(
          label: l10n.fdrPaperSoon,
          tone: FleetTone.warn,
        ),
        FleetExpiry.ok => FleetChip(
          label: l10n.fltExpiryOk,
          tone: FleetTone.ok,
        ),
        FleetExpiry.missing => null,
      },
    );
  }
}
