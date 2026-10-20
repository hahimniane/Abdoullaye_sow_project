import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/bank_check.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../services/zelle_check.dart';
import '../services/zelle_check_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/inventory_widgets.dart' show InventoryChip, InventoryNote;
import '../widgets/lot_sheets.dart';
import '../widgets/zelle_check_widgets.dart';
import 'bank_zelle_settings_screen.dart';

/// docs/ZELLE_BANK_CHECK.md "Check bank any time": the entry on the
/// Inventory and Shipping homes, the check itself, and "Use for a sale".

ZelleCheckFailure _failureOf(Object error) =>
    error is FirebaseFunctionsException
    ? zelleCheckFailureOf(code: error.code, details: error.details)
    : error is TimeoutException
    ? ZelleCheckFailure.network
    : ZelleCheckFailure.unknown;

Widget _headline(
  String text, {
  required Color color,
  IconData? icon,
  Key? key,
}) => Row(
  key: key,
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

// ---------------------------------------------------------------------------
// The entry on a home screen.
// ---------------------------------------------------------------------------

/// "Check bank" on a home screen. Reads the business's bank status once (in
/// [State.initState], through a short shared cache) and shows:
/// the entry when the bank is connected and active and the person can check
/// or owns the business; for the owner only, a hint to connect (or sign in
/// again to) the bank, which opens the bank settings; nothing otherwise.
class BankCheckEntry extends StatefulWidget {
  const BankCheckEntry({
    super.key,
    required this.businessId,
    required this.isOwner,
    required this.canCheck,
    this.service = const ZelleCheckService(),
    this.launcher = const PlaidBankLinkLauncher(),
    this.cache,
    this.padding = EdgeInsets.zero,
  });

  final String businessId;
  final bool isOwner;

  /// Sells (inventory permission with the service on) or takes package
  /// payments (containers permission).
  final bool canCheck;
  final ZelleCheckService service;
  final BankLinkLauncher launcher;

  /// Null uses [BankStatusCache.shared].
  final BankStatusCache? cache;

  /// Around the entry when it shows; nothing takes room when it does not.
  final EdgeInsets padding;

  @override
  State<BankCheckEntry> createState() => _BankCheckEntryState();
}

class _BankCheckEntryState extends State<BankCheckEntry> {
  BusinessBankStatus? _status;
  int _ticket = 0;

  BankStatusCache get _cache => widget.cache ?? BankStatusCache.shared;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void didUpdateWidget(BankCheckEntry oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.businessId != widget.businessId) _start();
  }

  void _start() {
    _status = null;
    if (widget.businessId.isEmpty) return;
    final cached = _cache.fresh(widget.businessId);
    if (cached != null) {
      _status = cached;
      return;
    }
    unawaited(_load());
  }

  Future<void> _load() async {
    final ticket = ++_ticket;
    final businessId = widget.businessId;
    try {
      final status = await widget.service
          .bankStatus(businessId)
          .timeout(const Duration(seconds: 20));
      _cache.put(businessId, status);
      if (!mounted || ticket != _ticket) return;
      setState(() => _status = status);
    } catch (_) {
      // Unknown: nothing shows. The check itself would say what is wrong.
    }
  }

  Future<void> _openSettings() async {
    AppHaptics.selection();
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
    _cache.forget(widget.businessId);
    await _load();
  }

  void _openCheck() {
    AppHaptics.selection();
    unawaited(
      showBankCheckSheet(
        context,
        businessId: widget.businessId,
        isOwner: widget.isOwner,
        service: widget.service,
        launcher: widget.launcher,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final state = bankCheckEntryState(
      status: _status,
      isOwner: widget.isOwner,
      canCheck: widget.canCheck,
    );
    final Widget child;
    switch (state) {
      case BankCheckEntryState.hidden:
        return const SizedBox.shrink();
      case BankCheckEntryState.check:
        child = _EntryTile(
          key: const Key('bank-check-entry'),
          icon: Icons.account_balance_outlined,
          title: l10n.bankCheckEntryTitle,
          caption: l10n.bankCheckEntryHint,
          onTap: _openCheck,
        );
      case BankCheckEntryState.connectHint:
        child = _EntryTile(
          key: const Key('bank-check-connect-hint'),
          icon: Icons.account_balance_outlined,
          title: l10n.zelleConnectBank,
          caption: l10n.bankCheckConnectHint,
          quiet: true,
          onTap: _openSettings,
        );
      case BankCheckEntryState.reconnectHint:
        child = _EntryTile(
          key: const Key('bank-check-reconnect-hint'),
          icon: Icons.lock_clock_outlined,
          title: l10n.zelleReconnect,
          caption: l10n.bankCheckReconnectHint,
          quiet: true,
          onTap: _openSettings,
        );
    }
    return Padding(padding: widget.padding, child: child);
  }
}

class _EntryTile extends StatelessWidget {
  const _EntryTile({
    super.key,
    required this.icon,
    required this.title,
    required this.caption,
    required this.onTap,
    this.quiet = false,
  });

  final IconData icon;
  final String title;
  final String caption;
  final VoidCallback onTap;

  /// The owner's hint: calmer than an action.
  final bool quiet;

  @override
  Widget build(BuildContext context) {
    final accent = quiet ? AppColors.warn : AppColors.cobaltDeep;
    return Semantics(
      button: true,
      label: '$title. $caption',
      excludeSemantics: true,
      onTap: onTap,
      child: Material(
        color: quiet
            ? AppColors.saffron.withValues(alpha: 0.08)
            : AppColors.paper,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: quiet
                ? AppColors.saffron.withValues(alpha: 0.35)
                : AppColors.rule,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 52),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.sm,
              ),
              child: Row(
                children: [
                  Icon(icon, size: 20, color: accent),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          title,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: AppColors.ink,
                          ),
                        ),
                        Text(
                          caption,
                          style: const TextStyle(
                            fontSize: 12.5,
                            height: 1.3,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  const Icon(
                    Icons.chevron_right_rounded,
                    color: AppColors.muted,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// The check.
// ---------------------------------------------------------------------------

/// Opens "Check bank": the exact amount, when it was sent, and the answer.
Future<void> showBankCheckSheet(
  BuildContext context, {
  required String businessId,
  bool isOwner = false,
  ZelleCheckService service = const ZelleCheckService(),
  BankLinkLauncher launcher = const PlaidBankLinkLauncher(),
  ZelleRetryCountdown? countdown,
}) => showLotSheet<void>(
  context,
  BankCheckSheet(
    businessId: businessId,
    isOwner: isOwner,
    service: service,
    launcher: launcher,
    countdown: countdown,
  ),
);

enum _Phase {
  idle,
  checking,
  received,
  several,
  notFound,
  notConnected,
  needsReauth,
  failed,
}

/// Staff type the exact amount and when it was sent; the server answers
/// from the owner's bank. Not there yet: it asks again by itself every 20
/// seconds for up to 3 minutes (those re-checks are sent as `auto`). From a
/// received deposit, "Use for a sale" spends it on a recorded payment.
/// Staff see the amount, the time, the sender and "pending" - never a
/// balance or anything else of the bank.
class BankCheckSheet extends StatefulWidget {
  const BankCheckSheet({
    super.key,
    required this.businessId,
    this.isOwner = false,
    this.service = const ZelleCheckService(),
    this.launcher = const PlaidBankLinkLauncher(),
    this.countdown,
  });

  final String businessId;
  final bool isOwner;
  final ZelleCheckService service;
  final BankLinkLauncher launcher;

  /// The re-check schedule; the default is 20 s over 3 minutes.
  final ZelleRetryCountdown? countdown;

  @override
  State<BankCheckSheet> createState() => _BankCheckSheetState();
}

class _BankCheckSheetState extends State<BankCheckSheet> {
  late final ZelleRetryCountdown _countdown =
      widget.countdown ?? ZelleRetryCountdown();
  final TextEditingController _amount = TextEditingController();
  Timer? _ticker;

  BankCheckSince _since = defaultBankCheckSince;
  _Phase _phase = _Phase.idle;
  BankCheckAnswer? _answer;
  ZelleCheckFailure? _failure;
  String? _amountError;

  /// What the answer on screen was asked for (re-checks ask the same).
  int _checkedCents = 0;
  BankCheckSince _checkedSince = defaultBankCheckSince;

  /// The deposits already used for a sale from this sheet.
  final Set<String> _used = {};

  /// A check is on its way: nothing else starts.
  bool _inFlight = false;

  @override
  void dispose() {
    _ticker?.cancel();
    _amount.dispose();
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

  /// A new amount or window: the answer on screen no longer applies.
  void _inputChanged() {
    if (_inFlight) return;
    _stopTicker();
    _countdown.reset();
    setState(() {
      _amountError = null;
      _phase = _Phase.idle;
      _answer = null;
      _failure = null;
    });
  }

  String? _amountIssueText(AppLocalizations l10n, BankCheckAmountIssue issue) =>
      switch (issue) {
        BankCheckAmountIssue.tooLarge => l10n.bankCheckAmountTooLarge,
        _ => l10n.bankCheckAmountInvalid,
      };

  /// By hand (Check, Check again): reads the field and starts a fresh
  /// 3-minute window. By itself (the countdown reached zero): asks the same
  /// again, sent as `auto` so it is not counted as a check.
  Future<void> _check({required bool manual}) async {
    if (_inFlight) return;
    final l10n = AppLocalizations.of(context)!;
    if (manual) {
      final read = readBankCheckAmount(_amount.text);
      final cents = read.cents;
      if (cents == null) {
        AppHaptics.refuse();
        setState(() => _amountError = _amountIssueText(l10n, read.issue!));
        return;
      }
      FocusScope.of(context).unfocus();
      _checkedCents = cents;
      _checkedSince = _since;
      _countdown.reset();
    }
    _stopTicker();
    setState(() {
      _inFlight = true;
      _amountError = null;
      if (manual) _phase = _Phase.checking;
    });
    try {
      final answer = await widget.service
          .checkStandalone(
            widget.businessId,
            amountCents: _checkedCents,
            since: _checkedSince,
            auto: !manual,
          )
          .timeout(const Duration(seconds: 30));
      if (!mounted) return;
      if (answer == null) {
        AppHaptics.refuse();
        setState(() {
          _phase = _Phase.failed;
          _failure = null;
        });
        return;
      }
      switch (answer.outcome) {
        case BankCheckOutcome.received:
        case BankCheckOutcome.several:
          AppHaptics.commit();
          setState(() {
            _answer = answer;
            _phase = answer.outcome == BankCheckOutcome.received
                ? _Phase.received
                : _Phase.several;
          });
        case BankCheckOutcome.notFound:
          _countdown.scheduleNext();
          setState(() {
            _answer = answer;
            _phase = _Phase.notFound;
          });
          _startTicker();
      }
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      final failure = _failureOf(error);
      _stopTicker();
      setState(() {
        _failure = failure;
        _phase = switch (failure) {
          ZelleCheckFailure.bankNotConnected => _Phase.notConnected,
          ZelleCheckFailure.bankNeedsReauth => _Phase.needsReauth,
          _ => _Phase.failed,
        };
      });
    } finally {
      if (mounted) setState(() => _inFlight = false);
    }
  }

  Future<void> _useForSale(BankDeposit deposit) async {
    if (_inFlight) return;
    AppHaptics.selection();
    await showLotSheet<void>(
      context,
      BankUseForSaleSheet(
        businessId: widget.businessId,
        deposit: deposit,
        service: widget.service,
        onUsed: () {
          if (mounted) setState(() => _used.add(deposit.creditId));
        },
      ),
    );
  }

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
    if (!mounted || _checkedCents <= 0) return;
    _countdown.reset();
    setState(() => _phase = _Phase.checking);
    await _check(manual: false);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    return LotSheetShell(
      title: l10n.bankCheckEntryTitle,
      subtitle: l10n.bankCheckSubtitle,
      footer: _footer(l10n),
      body: Column(
        key: Key('bank-check-phase-${_phase.name}'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('bank-check-amount'),
            controller: _amount,
            enabled: !_inFlight,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            textInputAction: TextInputAction.search,
            onChanged: (_) => _inputChanged(),
            onSubmitted: (_) => _check(manual: true),
            decoration: InputDecoration(
              labelText: l10n.bankCheckAmountLabel,
              prefixText: r'$ ',
              errorText: _amountError,
              errorMaxLines: 3,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            l10n.bankCheckSinceLabel,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              for (final since in BankCheckSince.values)
                ChoiceChip(
                  key: Key('bank-check-since-${since.wire}'),
                  label: Text(_sinceLabel(l10n, since)),
                  selected: _since == since,
                  onSelected: _inFlight
                      ? null
                      : (_) {
                          if (_since == since) return;
                          AppHaptics.selection();
                          _since = since;
                          _inputChanged();
                        },
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          ..._result(l10n, locale),
          if (_answer?.limitReached ?? false) ...[
            const SizedBox(height: AppSpacing.md),
            InventoryNote(
              key: const Key('bank-check-limit'),
              error: false,
              text: l10n.bankCheckLimitNote,
            ),
          ],
        ],
      ),
    );
  }

  static String _sinceLabel(AppLocalizations l10n, BankCheckSince since) =>
      switch (since) {
        BankCheckSince.last15Minutes => l10n.bankCheckSince15m,
        BankCheckSince.lastHour => l10n.bankCheckSince1h,
        BankCheckSince.today => l10n.bankCheckSinceToday,
      };

  Widget _footer(AppLocalizations l10n) {
    if ((_phase == _Phase.notConnected || _phase == _Phase.needsReauth) &&
        widget.isOwner) {
      return LotSheetButton(
        key: const Key('bank-check-connect'),
        label: _phase == _Phase.needsReauth
            ? l10n.zelleReconnect
            : l10n.zelleConnectBank,
        onTap: _inFlight ? null : _openBankSettings,
      );
    }
    return LotSheetButton(
      key: const Key('bank-check-submit'),
      label: _phase == _Phase.idle
          ? l10n.bankCheckButton
          : l10n.zelleCheckAgain,
      busy: _inFlight,
      busyLabel: l10n.zelleChecking,
      onTap: _inFlight ? null : () => _check(manual: true),
    );
  }

  List<Widget> _result(AppLocalizations l10n, String locale) {
    final amount = formatLotCents(_checkedCents);
    switch (_phase) {
      case _Phase.idle:
        return const [];
      case _Phase.checking:
        return [
          const Center(child: CircularProgressIndicator()),
          const SizedBox(height: AppSpacing.sm),
          Center(child: _muted(l10n.zelleChecking)),
        ];
      case _Phase.received:
        final deposit = _answer!.deposits.first;
        return [
          _headline(
            bankDepositLine(l10n, deposit, locale),
            color: AppColors.sage,
            icon: Icons.check_circle,
            key: const Key('bank-check-received'),
          ),
          if (deposit.pending) ...[
            const SizedBox(height: 6),
            Align(
              alignment: Alignment.centerLeft,
              child: InventoryChip(
                key: const Key('bank-check-pending'),
                label: l10n.bankCheckPending,
                color: AppColors.warn,
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          _useAction(l10n, deposit),
        ];
      case _Phase.several:
        final deposits = _answer!.deposits;
        return [
          _headline(
            l10n.zelleChooseTitle(amount),
            color: AppColors.ink,
            key: const Key('bank-check-several'),
          ),
          _muted(l10n.bankCheckSeveralHint),
          const SizedBox(height: AppSpacing.md),
          for (final d in deposits)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: _DepositCard(
                key: Key('bank-check-deposit-${d.creditId}'),
                deposit: d,
                action: _useAction(l10n, d),
              ),
            ),
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
            key: const Key('bank-check-not-found'),
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
                  key: const Key('bank-check-retry-status'),
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
              ),
              if (_countdown.running && !_inFlight)
                TextButton(
                  key: const Key('bank-check-retry-stop'),
                  onPressed: _stopRetrying,
                  child: Text(l10n.zelleRetryStop),
                ),
            ],
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
            key: const Key('bank-check-not-connected'),
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
            key: const Key('bank-check-needs-reauth'),
          ),
        ];
      case _Phase.failed:
        final failure = _failure;
        return [
          InventoryNote(
            key: const Key('bank-check-failed'),
            text: failure == null
                ? l10n.zelleFailUnreadable
                : zelleFailureText(l10n, failure),
          ),
        ];
    }
  }

  Widget _useAction(AppLocalizations l10n, BankDeposit deposit) {
    if (_used.contains(deposit.creditId)) {
      return Align(
        alignment: Alignment.centerLeft,
        child: InventoryChip(
          key: Key('bank-check-used-${deposit.creditId}'),
          label: l10n.bankCheckUsed,
          color: AppColors.sage,
        ),
      );
    }
    return Align(
      alignment: Alignment.centerLeft,
      child: OutlinedButton.icon(
        key: Key('bank-check-use-${deposit.creditId}'),
        onPressed: _inFlight ? null : () => _useForSale(deposit),
        icon: const Icon(Icons.receipt_long_outlined, size: 18),
        label: Text(l10n.bankCheckUseForSale),
      ),
    );
  }
}

/// One of several deposits: sender, time (date only when the bank gave no
/// time), pending, and its action.
class _DepositCard extends StatelessWidget {
  const _DepositCard({super.key, required this.deposit, required this.action});

  final BankDeposit deposit;
  final Widget action;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final note = [
      formatLotCents(deposit.amountCents),
      if (deposit.at != null)
        zelleTimeLabel(deposit.at, locale, timeKnown: deposit.timeKnown),
    ].join(' · ');
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            deposit.senderName.isEmpty
                ? l10n.zelleUnknownSender
                : deposit.senderName,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            note,
            style: const TextStyle(fontSize: 13, color: AppColors.muted),
          ),
          if (deposit.pending) ...[
            const SizedBox(height: 6),
            InventoryChip(label: l10n.bankCheckPending, color: AppColors.warn),
          ],
          const SizedBox(height: AppSpacing.sm),
          action,
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Use for a sale.
// ---------------------------------------------------------------------------

/// Picks the recorded Zelle payment a deposit pays: first the recent ones,
/// then a search. Picking one and pressing "Use for this sale" spends the
/// deposit on it; closing without that consumes nothing.
class BankUseForSaleSheet extends StatefulWidget {
  const BankUseForSaleSheet({
    super.key,
    required this.businessId,
    required this.deposit,
    this.service = const ZelleCheckService(),
    this.onUsed,
  });

  final String businessId;
  final BankDeposit deposit;
  final ZelleCheckService service;

  /// The deposit was spent on a payment.
  final VoidCallback? onUsed;

  @override
  State<BankUseForSaleSheet> createState() => _BankUseForSaleSheetState();
}

class _BankUseForSaleSheetState extends State<BankUseForSaleSheet> {
  final TextEditingController _query = TextEditingController();

  List<BankUseRecord> _records = const [];
  bool _loading = true;
  bool _loadFailed = false;
  String _shownQuery = '';
  int _ticket = 0;

  String _selected = '';
  bool _confirming = false;
  BankUseRecord? _usedRecord;
  ZelleConfirmation? _confirmation;
  String _note = '';

  @override
  void initState() {
    super.initState();
    unawaited(_load(''));
  }

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<void> _load(String query) async {
    final ticket = ++_ticket;
    final q = query.trim();
    if (mounted) {
      setState(() {
        _loading = true;
        _loadFailed = false;
        _note = '';
      });
    }
    try {
      final answer = await widget.service
          .useRecords(widget.businessId, widget.deposit.creditId, query: q)
          .timeout(const Duration(seconds: 20));
      if (!mounted || ticket != _ticket) return;
      setState(() {
        _loading = false;
        _loadFailed = answer == null;
        _records = answer?.records ?? const [];
        _shownQuery = q;
        if (!_records.any((r) => r.key == _selected)) _selected = '';
      });
    } catch (error) {
      if (!mounted || ticket != _ticket) return;
      final failure = _failureOf(error);
      final l10n = AppLocalizations.of(context)!;
      setState(() {
        _loading = false;
        _loadFailed = true;
        _records = const [];
        // A refusal says why; anything else is "could not load".
        _note =
            failure == ZelleCheckFailure.unknown ||
                failure == ZelleCheckFailure.network
            ? ''
            : zelleFailureText(l10n, failure);
      });
    }
  }

  void _search() {
    if (_confirming) return;
    FocusScope.of(context).unfocus();
    unawaited(_load(_query.text));
  }

  Future<void> _use() async {
    if (_confirming) return;
    final record = _records.where((r) => r.key == _selected).firstOrNull;
    if (record == null) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _confirming = true;
      _note = '';
    });
    try {
      final result = await widget.service
          .useDeposit(widget.businessId, widget.deposit.creditId, record)
          .timeout(const Duration(seconds: 30));
      if (!mounted) return;
      final confirmation = result?.confirmation;
      if (result == null || !result.isConfirmed || confirmation == null) {
        AppHaptics.refuse();
        setState(() => _note = l10n.zelleFailUnreadable);
        return;
      }
      AppHaptics.commit();
      setState(() {
        _usedRecord = record;
        _confirmation = confirmation;
      });
      widget.onUsed?.call();
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _note = zelleFailureText(l10n, _failureOf(error)));
    } finally {
      if (mounted) setState(() => _confirming = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final amount = formatLotCents(widget.deposit.amountCents);
    final confirmation = _confirmation;
    if (confirmation != null) {
      final record = _usedRecord!;
      return LotSheetShell(
        title: l10n.bankCheckUseForSale,
        footer: LotSheetButton(
          key: const Key('bank-use-done'),
          label: l10n.close,
          onTap: () => Navigator.of(context).maybePop(),
        ),
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _headline(
              l10n.bankUseConfirmed,
              color: AppColors.sage,
              icon: Icons.check_circle,
              key: const Key('bank-use-confirmed'),
            ),
            _muted(zelleConfirmationLine(l10n, confirmation, locale)),
            if (confirmation.institutionName.isNotEmpty)
              _muted(l10n.zelleDepositedIn(confirmation.institutionName)),
            const SizedBox(height: AppSpacing.md),
            _RecordCard(record: record, selected: true, onTap: null),
          ],
        ),
      );
    }
    return LotSheetShell(
      title: l10n.bankCheckUseForSale,
      subtitle: l10n.bankUseSubtitle(amount),
      footer: LotSheetButton(
        key: const Key('bank-use-confirm'),
        label: l10n.bankUseConfirmButton,
        busy: _confirming,
        busyLabel: l10n.bankUseConfirming,
        onTap: _selected.isEmpty || _confirming || _loading ? null : _use,
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('bank-use-search'),
                  controller: _query,
                  enabled: !_confirming,
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => _search(),
                  decoration: InputDecoration(
                    labelText: l10n.bankUseSearchLabel,
                    prefixIcon: const Icon(Icons.search, size: 20),
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.xs),
              IconButton(
                key: const Key('bank-use-search-button'),
                tooltip: l10n.bankUseSearchButton,
                onPressed: _confirming || _loading ? null : _search,
                icon: const Icon(Icons.arrow_forward_rounded),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            _shownQuery.isEmpty ? l10n.bankUseRecent : l10n.bankUseResults,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_loadFailed)
            InventoryNote(
              key: const Key('bank-use-load-failed'),
              text: _note.isNotEmpty ? _note : l10n.bankUseLoadFailed,
              trailing: TextButton(
                key: const Key('bank-use-retry'),
                onPressed: () => _load(_shownQuery),
                child: Text(l10n.retry),
              ),
            )
          else if (_records.isEmpty)
            _muted(
              _shownQuery.isEmpty
                  ? l10n.bankUseEmptyRecent(amount)
                  : l10n.bankUseEmptySearch(_shownQuery),
              key: const Key('bank-use-empty'),
            )
          else
            for (final r in _records)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: _RecordCard(
                  key: Key('bank-use-record-${r.kind.wire}-${r.id}'),
                  record: r,
                  selected: _selected == r.key,
                  onTap: _confirming
                      ? null
                      : () {
                          AppHaptics.selection();
                          setState(() {
                            _selected = r.key;
                            _note = '';
                          });
                        },
                ),
              ),
          if (_note.isNotEmpty && !_loadFailed) ...[
            const SizedBox(height: AppSpacing.sm),
            InventoryNote(key: const Key('bank-use-note'), text: _note),
          ],
        ],
      ),
    );
  }
}

/// A payment to pick: what it is, who, what, how much and when.
class _RecordCard extends StatelessWidget {
  const _RecordCard({
    super.key,
    required this.record,
    required this.selected,
    required this.onTap,
  });

  final BankUseRecord record;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final when = bankRecordTimeLabel(record.at, locale);
    return Material(
      color: selected ? AppColors.mist : AppColors.paper,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        side: BorderSide(
          color: selected ? AppColors.cobalt : AppColors.rule,
          width: selected ? 1.5 : 1,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: AppSpacing.sm,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        InventoryChip(
                          label: bankUseKindLabel(l10n, record.kind),
                          color: AppColors.cobalt,
                        ),
                        Text(
                          formatLotCents(record.amountCents),
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: AppColors.ink,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      record.who.isEmpty ? l10n.bankUseNoName : record.who,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: record.who.isEmpty
                            ? AppColors.muted
                            : AppColors.ink,
                      ),
                    ),
                    if (record.what.isNotEmpty)
                      Text(
                        record.what,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 13,
                          height: 1.3,
                          color: AppColors.ink,
                        ),
                      ),
                    if (when.isNotEmpty)
                      Text(
                        when,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                  ],
                ),
              ),
              if (selected) ...[
                const SizedBox(width: AppSpacing.sm),
                const Icon(Icons.check_circle, color: AppColors.cobalt),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
