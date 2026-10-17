import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../services/zelle_check.dart';
import '../services/zelle_check_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/inventory_widgets.dart' show InventoryNote;
import '../widgets/lot_sheets.dart';
import '../widgets/zelle_check_widgets.dart';
import 'bank_zelle_settings_screen.dart';

/// Whether the signed-in person owns the business (and so may connect the
/// bank). Read from [AuthProvider] when there is one above [context].
bool zelleViewerIsOwner(BuildContext context, String businessId) {
  final auth = Provider.of<AuthProvider?>(context, listen: false);
  if (auth == null || !auth.isBusinessOwner) return false;
  final own = auth.businessId ?? '';
  return own.isEmpty || own == businessId;
}

/// Opens "Check Zelle" for one payment and runs the check at once.
/// [onConfirmed] hears the confirmation, so the row can show "Bank ✓" before
/// its record's stream catches up.
Future<void> showZelleCheckSheet(
  BuildContext context, {
  required String businessId,
  required ZelleCheckKind kind,
  required String id,
  required int amountCents,
  bool? isOwner,
  ZelleCheckService service = const ZelleCheckService(),
  BankLinkLauncher launcher = const PlaidBankLinkLauncher(),
  ValueChanged<BankCheck>? onConfirmed,
}) => showLotSheet<void>(
  context,
  ZelleCheckSheet(
    businessId: businessId,
    kind: kind,
    id: id,
    amountCents: amountCents,
    isOwner: isOwner ?? zelleViewerIsOwner(context, businessId),
    service: service,
    launcher: launcher,
    onConfirmed: onConfirmed,
  ),
);

enum _Phase {
  checking,
  confirmed,
  notFound,
  choose,
  notConnected,
  needsReauth,
  failed,
}

/// Asks the server whether the owner's bank shows a deposit of exactly this
/// amount. Not there yet: it asks again every 20 seconds for up to 3 minutes
/// while the sheet is open, with the countdown and Stop on screen. Several
/// deposits of the same amount: the person picks by sender name. No bank: the
/// owner can connect one from here, staff are told to ask the owner.
class ZelleCheckSheet extends StatefulWidget {
  const ZelleCheckSheet({
    super.key,
    required this.businessId,
    required this.kind,
    required this.id,
    required this.amountCents,
    this.isOwner = false,
    this.service = const ZelleCheckService(),
    this.launcher = const PlaidBankLinkLauncher(),
    this.onConfirmed,
    this.countdown,
  });

  final String businessId;
  final ZelleCheckKind kind;
  final String id;
  final int amountCents;
  final bool isOwner;
  final ZelleCheckService service;
  final BankLinkLauncher launcher;
  final ValueChanged<BankCheck>? onConfirmed;

  /// The re-check schedule; the default is 20 s over 3 minutes.
  final ZelleRetryCountdown? countdown;

  @override
  State<ZelleCheckSheet> createState() => _ZelleCheckSheetState();
}

class _ZelleCheckSheetState extends State<ZelleCheckSheet> {
  late final ZelleRetryCountdown _countdown =
      widget.countdown ?? ZelleRetryCountdown();
  Timer? _ticker;

  _Phase _phase = _Phase.checking;
  ZelleCheckResult? _result;
  ZelleCheckFailure? _failure;
  bool _unreadable = false;

  /// A check (or a pick) is on its way: nothing else starts.
  bool _inFlight = false;
  String _confirming = '';
  String _note = '';

  @override
  void initState() {
    super.initState();
    // The first check starts at once; the fields are set here, not through
    // setState, since the sheet has not been built yet.
    _countdown.reset();
    _inFlight = true;
    unawaited(_request());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  void _stopTicker() {
    _ticker?.cancel();
    _ticker = null;
  }

  void _startTicker() {
    _stopTicker();
    if (!_countdown.running) return;
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      if (_countdown.tick()) {
        _stopTicker();
        unawaited(_check(manual: false));
      } else {
        setState(() {});
      }
    });
  }

  void _stopRetrying() {
    _countdown.stop();
    _stopTicker();
    setState(() {});
  }

  void _confirmedWith(ZelleCheckResult result) {
    AppHaptics.commit();
    _stopTicker();
    setState(() {
      _phase = _Phase.confirmed;
      _result = result;
    });
    final c = result.confirmation;
    if (c != null) widget.onConfirmed?.call(BankCheck.ofConfirmation(c));
  }

  void _failed(Object error) {
    final failure = error is FirebaseFunctionsException
        ? zelleCheckFailureOf(code: error.code, details: error.details)
        : error is TimeoutException
        ? ZelleCheckFailure.network
        : ZelleCheckFailure.unknown;
    _stopTicker();
    setState(() {
      _failure = failure;
      _unreadable = false;
      _phase = switch (failure) {
        ZelleCheckFailure.bankNotConnected => _Phase.notConnected,
        ZelleCheckFailure.bankNeedsReauth => _Phase.needsReauth,
        _ => _Phase.failed,
      };
    });
  }

  /// One check. By hand it starts a fresh 3-minute window; by itself (the
  /// countdown reached zero) it keeps the "not there yet" panel on screen.
  Future<void> _check({required bool manual}) async {
    if (_inFlight) return;
    if (manual) _countdown.reset();
    _stopTicker();
    setState(() {
      _inFlight = true;
      _note = '';
      if (manual) _phase = _Phase.checking;
    });
    await _request();
  }

  /// The call itself; [_inFlight] is already set.
  Future<void> _request() async {
    try {
      final result = await widget.service
          .check(widget.businessId, widget.kind, widget.id)
          .timeout(const Duration(seconds: 30));
      if (!mounted) return;
      if (result == null) {
        AppHaptics.refuse();
        setState(() {
          _phase = _Phase.failed;
          _failure = null;
          _unreadable = true;
        });
        return;
      }
      switch (result.outcome) {
        case ZelleCheckOutcome.confirmed:
        case ZelleCheckOutcome.alreadyConfirmed:
          _confirmedWith(result);
        case ZelleCheckOutcome.notFound:
          _countdown.scheduleNext();
          setState(() {
            _phase = _Phase.notFound;
            _result = result;
          });
          _startTicker();
        case ZelleCheckOutcome.choose:
          setState(() {
            _phase = _Phase.choose;
            _result = result;
          });
      }
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      _failed(error);
    } finally {
      if (mounted) setState(() => _inFlight = false);
    }
  }

  Future<void> _pick(ZelleCandidate candidate) async {
    if (_inFlight) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _inFlight = true;
      _confirming = candidate.creditId;
      _note = '';
    });
    var recheck = false;
    try {
      final result = await widget.service
          .confirmCandidate(
            widget.businessId,
            widget.kind,
            widget.id,
            candidate.creditId,
          )
          .timeout(const Duration(seconds: 30));
      if (!mounted) return;
      if (result == null || !result.isConfirmed) {
        AppHaptics.refuse();
        setState(() => _note = l10n.zelleFailUnreadable);
        return;
      }
      _confirmedWith(result);
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      final failure = error is FirebaseFunctionsException
          ? zelleCheckFailureOf(code: error.code, details: error.details)
          : error is TimeoutException
          ? ZelleCheckFailure.network
          : ZelleCheckFailure.unknown;
      if (failure == ZelleCheckFailure.candidateTaken) {
        // Someone else just matched that deposit: the list is stale.
        recheck = true;
      } else {
        setState(() => _note = zelleFailureText(l10n, failure));
      }
    } finally {
      if (mounted) {
        setState(() {
          _inFlight = false;
          _confirming = '';
        });
      }
    }
    if (recheck && mounted) {
      await _check(manual: true);
      if (mounted) {
        setState(
          () =>
              _note = zelleFailureText(l10n, ZelleCheckFailure.candidateTaken),
        );
      }
    }
  }

  /// The owner connects (or signs in again) from here, then the check runs
  /// again by itself.
  Future<void> _openBankSettings() async {
    _stopTicker();
    await Navigator.of(context, rootNavigator: true).push(
      MaterialPageRoute<void>(
        builder: (_) => BankZelleSettingsScreen(
          businessId: widget.businessId,
          service: widget.service,
          launcher: widget.launcher,
        ),
      ),
    );
    if (!mounted) return;
    await _check(manual: true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final amount = formatLotCents(widget.amountCents);
    return LotSheetShell(
      title: l10n.zelleCheckTitle,
      subtitle: l10n.zelleCheckSubtitle(amount),
      footer: _footer(l10n),
      body: Column(
        key: Key('zelle-phase-${_phase.name}'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ..._body(l10n, locale, amount),
          if (_note.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            InventoryNote(key: const Key('zelle-note'), text: _note),
          ],
        ],
      ),
    );
  }

  Widget? _footer(AppLocalizations l10n) {
    switch (_phase) {
      case _Phase.confirmed:
        return LotSheetButton(
          key: const Key('zelle-done'),
          label: l10n.close,
          onTap: () => Navigator.of(context).maybePop(),
        );
      case _Phase.choose:
      case _Phase.checking:
        return null;
      case _Phase.notConnected:
      case _Phase.needsReauth:
        if (widget.isOwner) {
          return LotSheetButton(
            key: const Key('zelle-connect'),
            label: _phase == _Phase.needsReauth
                ? l10n.zelleReconnect
                : l10n.zelleConnectBank,
            onTap: _inFlight ? null : _openBankSettings,
          );
        }
        return _checkAgainButton(l10n);
      case _Phase.notFound:
      case _Phase.failed:
        return _checkAgainButton(l10n);
    }
  }

  Widget _checkAgainButton(AppLocalizations l10n) => LotSheetButton(
    key: const Key('zelle-check-again'),
    label: l10n.zelleCheckAgain,
    busy: _inFlight,
    busyLabel: l10n.zelleChecking,
    onTap: _inFlight ? null : () => _check(manual: true),
  );

  Widget _headline(String text, {required Color color, IconData? icon}) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      if (icon != null) ...[
        Icon(icon, color: color, size: 22),
        const SizedBox(width: AppSpacing.sm),
      ],
      Expanded(
        child: Text(
          text,
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w700,
            height: 1.25,
            color: color,
          ),
        ),
      ),
    ],
  );

  Widget _muted(String text, {Key? key}) => Padding(
    padding: const EdgeInsets.only(top: 4),
    child: Text(
      text,
      key: key,
      style: const TextStyle(fontSize: 13, height: 1.4, color: AppColors.muted),
    ),
  );

  List<Widget> _body(AppLocalizations l10n, String locale, String amount) {
    switch (_phase) {
      case _Phase.checking:
        return [
          const SizedBox(height: AppSpacing.md),
          const Center(child: CircularProgressIndicator()),
          const SizedBox(height: AppSpacing.md),
          Center(child: _muted(l10n.zelleChecking)),
        ];
      case _Phase.confirmed:
        final result = _result!;
        final c = result.confirmation!;
        return [
          KeyedSubtree(
            key: const Key('zelle-confirmed'),
            child: _headline(
              zelleConfirmationLine(l10n, c, locale),
              color: AppColors.sage,
              icon: Icons.check_circle,
            ),
          ),
          if (c.institutionName.isNotEmpty)
            _muted(l10n.zelleDepositedIn(c.institutionName)),
          if (result.outcome == ZelleCheckOutcome.alreadyConfirmed)
            _muted(l10n.zelleAlreadyConfirmed, key: const Key('zelle-already')),
        ];
      case _Phase.notFound:
        final String status;
        if (_inFlight) {
          status = l10n.zelleChecking;
        } else if (_countdown.running) {
          status = l10n.zelleRetryIn(_countdown.secondsLeft);
        } else if (_countdown.stopped) {
          status = l10n.zelleRetryStopped;
        } else {
          status = l10n.zelleRetryExhausted;
        }
        return [
          _headline(
            l10n.zelleNotFoundTitle,
            color: AppColors.ink,
            icon: Icons.hourglass_top_rounded,
          ),
          _muted(l10n.zelleNotFoundHint(amount)),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              if (_inFlight)
                const Padding(
                  padding: EdgeInsets.only(right: AppSpacing.sm),
                  child: SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              else if (_countdown.running)
                const Padding(
                  padding: EdgeInsets.only(right: AppSpacing.sm),
                  child: Icon(Icons.schedule, size: 16, color: AppColors.muted),
                ),
              Expanded(
                child: Text(
                  status,
                  key: const Key('zelle-retry-status'),
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
              ),
              if (_countdown.running && !_inFlight)
                TextButton(
                  key: const Key('zelle-retry-stop'),
                  onPressed: _stopRetrying,
                  child: Text(l10n.zelleRetryStop),
                ),
            ],
          ),
        ];
      case _Phase.choose:
        final candidates = _result?.candidates ?? const <ZelleCandidate>[];
        return [
          _headline(l10n.zelleChooseTitle(amount), color: AppColors.ink),
          _muted(l10n.zelleChooseHint),
          const SizedBox(height: AppSpacing.md),
          for (final c in candidates)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: LotChoiceCard(
                key: Key('zelle-candidate-${c.creditId}'),
                title: c.senderName.isEmpty
                    ? l10n.zelleUnknownSender
                    : c.senderName,
                note: [
                  amount,
                  if (c.at != null)
                    zelleTimeLabel(c.at, locale, timeKnown: c.timeKnown),
                ].join(' · '),
                selected: _confirming == c.creditId,
                enabled: !_inFlight,
                onTap: () => _pick(c),
              ),
            ),
          if (_inFlight)
            const Padding(
              padding: EdgeInsets.only(top: AppSpacing.sm),
              child: Center(child: CircularProgressIndicator()),
            ),
        ];
      case _Phase.notConnected:
        return [
          _headline(
            l10n.zelleNotConnectedTitle,
            color: AppColors.ink,
            icon: Icons.account_balance_outlined,
          ),
          _muted(
            widget.isOwner
                ? l10n.zelleNotConnectedOwner
                : l10n.zelleNotConnectedStaff,
            key: const Key('zelle-not-connected'),
          ),
        ];
      case _Phase.needsReauth:
        return [
          _headline(
            l10n.zelleNeedsReauthTitle,
            color: AppColors.warn,
            icon: Icons.lock_clock_outlined,
          ),
          _muted(
            widget.isOwner
                ? l10n.zelleNeedsReauthOwner
                : l10n.zelleNeedsReauthStaff,
            key: const Key('zelle-needs-reauth'),
          ),
        ];
      case _Phase.failed:
        return [
          InventoryNote(
            key: const Key('zelle-failed'),
            text: _unreadable || _failure == null
                ? l10n.zelleFailUnreadable
                : zelleFailureText(l10n, _failure!),
          ),
        ];
    }
  }
}
