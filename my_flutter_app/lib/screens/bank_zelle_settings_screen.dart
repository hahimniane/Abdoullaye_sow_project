import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../services/zelle_check.dart';
import '../services/zelle_check_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/date_display.dart';
import '../services/eastern_clock.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/zelle_check_widgets.dart';

/// The owner's "Bank for Zelle checks": connect the account that receives
/// Zelle (Plaid Link), see which bank and account it is and whether it still
/// syncs, sign in again when the bank asks, pick how far back a check looks,
/// see this month's checks and paid refreshes (and by whom), set the monthly
/// limit of paid refreshes, and disconnect. Staff never come here; the server refuses them anyway
/// (`bank_owner_required`).
class BankZelleSettingsScreen extends StatefulWidget {
  const BankZelleSettingsScreen({
    super.key,
    required this.businessId,
    this.service = const ZelleCheckService(),
    this.launcher = const PlaidBankLinkLauncher(),
    this.isIOS,
  });

  final String businessId;
  final ZelleCheckService service;

  /// Plaid Link; a fake in tests.
  final BankLinkLauncher launcher;

  /// The platform the Link token is made for; null reads the device.
  final bool? isIOS;

  @override
  State<BankZelleSettingsScreen> createState() =>
      _BankZelleSettingsScreenState();
}

class _BankZelleSettingsScreenState extends State<BankZelleSettingsScreen> {
  BusinessBankStatus? _status;
  bool _loadFailed = false;

  /// Which action is in flight ('connect', 'window', 'disconnect'): every
  /// button waits, the one pressed shows progress.
  String _busy = '';
  String _note = '';

  /// The monthly limit of paid refreshes, as typed.
  final TextEditingController _limit = TextEditingController();
  String? _limitError;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _limit.dispose();
    super.dispose();
  }

  void _showLimit(BusinessBankStatus status) {
    _limit.text = '${status.refreshLimit}';
    _limitError = null;
  }

  Future<void> _load() async {
    setState(() => _loadFailed = false);
    try {
      // A status that never answers is a spinner that never stops.
      final status = await widget.service
          .bankStatus(widget.businessId)
          .timeout(const Duration(seconds: 20));
      if (!mounted) return;
      setState(() {
        _status = status;
        _showLimit(status);
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadFailed = true);
    }
  }

  /// A fresh status without the spinner or the error panel (after connect).
  Future<void> _reloadQuietly() async {
    try {
      final status = await widget.service
          .bankStatus(widget.businessId)
          .timeout(const Duration(seconds: 20));
      if (mounted && status.connected) {
        setState(() {
          _status = status;
          _showLimit(status);
        });
      }
    } catch (_) {
      // What is on screen already came from the connect answer.
    }
  }

  String _failureText(AppLocalizations l10n, Object error) {
    if (error is FirebaseFunctionsException) {
      return zelleFailureText(
        l10n,
        zelleCheckFailureOf(code: error.code, details: error.details),
      );
    }
    if (error is TimeoutException) return l10n.zelleFailNetwork;
    return l10n.inventoryFailUnknown;
  }

  Future<void> _run(String action, Future<void> Function() work) async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _busy = action;
      _note = '';
    });
    try {
      await work();
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _note = _failureText(l10n, error));
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  /// Connect, and Reconnect when the bank asks for a new sign-in: the
  /// server makes the Link token (update mode for a connection that needs
  /// it), Link runs, and the public token goes back to the server.
  Future<void> _connect() => _run('connect', () async {
    final l10n = AppLocalizations.of(context)!;
    final isIOS = widget.isIOS ?? defaultTargetPlatform == TargetPlatform.iOS;
    final token = await widget.service.createLinkToken(
      widget.businessId,
      platform: bankLinkPlatform(isIOS: isIOS),
      // Plaid Link speaks the app's language.
      language: Localizations.localeOf(context).languageCode,
    );
    if (!mounted) return;
    if (token == null) {
      AppHaptics.refuse();
      setState(() => _note = l10n.bankLinkFailed);
      return;
    }
    final outcome = await widget.launcher.open(token.linkToken);
    if (!mounted) return;
    if (outcome.exited) {
      // Closed by the owner: nothing to say. Closed on an error: say so.
      if (outcome.errorCode.isNotEmpty) {
        AppHaptics.refuse();
        setState(() => _note = l10n.bankLinkFailed);
      }
      return;
    }
    final result = await widget.service.connect(
      widget.businessId,
      publicToken: outcome.publicToken,
      accountId: outcome.accountId,
    );
    if (!mounted) return;
    AppHaptics.commit();
    final before = _status;
    setState(() {
      _status = BusinessBankStatus(
        connected: result.status != BankLinkStatus.disconnected,
        status: result.status,
        institutionName: result.institutionName,
        accountMask: result.accountMask,
        accountName: result.accountName,
        windowMinutes: before?.windowMinutes ?? defaultBankCheckWindowMinutes,
        lastSyncAt: before?.lastSyncAt,
        // Kept across a reconnect (server side too).
        refreshLimit: before?.refreshLimit ?? defaultBankRefreshLimit,
        usage: before?.usage,
      );
    });
    showSuccessSnackBar(context, l10n.bankConnectedDone);
    // The first sync ran: read the status again for its time.
    if (result.synced) unawaited(_reloadQuietly());
  });

  Future<void> _pickWindow() async {
    final l10n = AppLocalizations.of(context)!;
    final current = _status?.windowMinutes ?? defaultBankCheckWindowMinutes;
    final picked = await pickLotOption<int>(
      context,
      title: l10n.bankWindowLabel,
      selected: current,
      options: [
        for (final m in bankCheckWindowChoices)
          LotOption(m, l10n.bankWindowMinutes(m)),
      ],
    );
    if (picked == null || picked == current || !mounted) return;
    await _run('window', () async {
      await widget.service.setWindow(widget.businessId, picked);
      if (!mounted) return;
      AppHaptics.commit();
      setState(() => _status = _status?.copyWith(windowMinutes: picked));
      showSuccessSnackBar(context, l10n.bankWindowSaved);
    });
  }

  /// The monthly limit of paid refreshes: 0..1000, whole numbers only.
  Future<void> _saveLimit() async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    final limit = readBankRefreshLimit(_limit.text);
    if (limit == null) {
      AppHaptics.refuse();
      setState(() => _limitError = l10n.bankLimitInvalid);
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() => _limitError = null);
    await _run('limit', () async {
      final kept = await widget.service
          .setRefreshLimit(widget.businessId, limit)
          .timeout(const Duration(seconds: 20));
      if (!mounted) return;
      final saved = kept ?? limit;
      AppHaptics.commit();
      setState(() {
        _status = _status?.copyWith(refreshLimit: saved);
        _limit.text = '$saved';
      });
      showSuccessSnackBar(context, l10n.bankLimitSaved);
    });
  }

  Future<void> _disconnect() async {
    final l10n = AppLocalizations.of(context)!;
    final ok = await confirmMajorAction(
      context,
      title: l10n.bankDisconnectTitle,
      message: l10n.bankDisconnectMessage,
      confirmLabel: l10n.bankDisconnect,
      destructive: true,
    );
    if (!ok || !mounted) return;
    await _run('disconnect', () async {
      await widget.service.disconnect(widget.businessId);
      if (!mounted) return;
      AppHaptics.commit();
      setState(
        () => _status = BusinessBankStatus(
          connected: false,
          status: BankLinkStatus.disconnected,
          windowMinutes:
              _status?.windowMinutes ?? defaultBankCheckWindowMinutes,
        ),
      );
      showSuccessSnackBar(context, l10n.bankDisconnectedDone);
    });
  }

  /// "Monthly limit of paid refreshes": the number, Save, and what it means.
  Widget _limitField(AppLocalizations l10n) {
    final saving = _busy == 'limit';
    return Column(
      key: const Key('bank-limit-block'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: TextField(
                key: const Key('bank-limit'),
                controller: _limit,
                enabled: _busy.isEmpty,
                keyboardType: TextInputType.number,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(4),
                ],
                textInputAction: TextInputAction.done,
                onChanged: (_) {
                  if (_limitError != null) {
                    setState(() => _limitError = null);
                  }
                },
                onSubmitted: (_) => _saveLimit(),
                decoration: InputDecoration(
                  labelText: l10n.bankLimitLabel,
                  labelStyle: const TextStyle(overflow: TextOverflow.ellipsis),
                  errorText: _limitError,
                  errorMaxLines: 3,
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: FilledButton(
                key: const Key('bank-limit-save'),
                // The theme's buttons are full width; beside a field in a
                // Row that is an infinite width.
                style: FilledButton.styleFrom(minimumSize: const Size(72, 48)),
                onPressed: _busy.isEmpty ? _saveLimit : null,
                child: saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(l10n.save),
              ),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            l10n.bankLimitHint(formatLotCents(12)),
            key: const Key('bank-limit-hint'),
            style: const TextStyle(
              fontSize: 12,
              height: 1.35,
              color: AppColors.muted,
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final status = _status;
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(title: l10n.bankZelleTitle),
          Expanded(
            child: ListView(
              key: const Key('bank-settings'),
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                AppSpacing.xl,
              ),
              children: [
                Text(
                  l10n.bankZelleIntro,
                  style: const TextStyle(
                    fontSize: 13.5,
                    height: 1.4,
                    color: AppColors.muted,
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                if (status == null && !_loadFailed)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: AppSpacing.xl),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (status == null)
                  InventoryNote(
                    key: const Key('bank-load-failed'),
                    text: l10n.bankLoadFailed,
                    trailing: TextButton(
                      key: const Key('bank-retry'),
                      onPressed: _load,
                      child: Text(l10n.retry),
                    ),
                  )
                else ...[
                  _StatusCard(
                    status: status,
                    busy: _busy,
                    onConnect: _busy.isEmpty ? _connect : null,
                  ),
                  if (status.connected) ...[
                    const SizedBox(height: AppSpacing.lg),
                    LotPickerField(
                      key: const Key('bank-window'),
                      label: l10n.bankWindowLabel,
                      value: l10n.bankWindowMinutes(status.windowMinutes),
                      placeholder: l10n.bankWindowLabel,
                      onTap: _busy.isEmpty ? _pickWindow : () {},
                    ),
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              l10n.bankWindowHint,
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.muted,
                              ),
                            ),
                          ),
                          if (_busy == 'window')
                            const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                        ],
                      ),
                    ),
                    if (status.usage case final usage?) ...[
                      const SizedBox(height: AppSpacing.lg),
                      _UsageCard(usage: usage),
                    ],
                    const SizedBox(height: AppSpacing.lg),
                    _limitField(l10n),
                    const SizedBox(height: AppSpacing.xl),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        key: const Key('bank-disconnect'),
                        onPressed: _busy.isEmpty ? _disconnect : null,
                        icon: _busy == 'disconnect'
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.link_off, size: 18),
                        label: Text(l10n.bankDisconnect),
                        style: TextButton.styleFrom(
                          foregroundColor: AppColors.errorRed,
                        ),
                      ),
                    ),
                  ],
                ],
                if (_note.isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.md),
                  InventoryNote(key: const Key('bank-note'), text: _note),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// This month: checks, paid refreshes against the limit, the estimated
/// cost, and the same by team member (named, never by uid).
class _UsageCard extends StatelessWidget {
  const _UsageCard({required this.usage});

  final BankUsage usage;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final start = usage.monthStart;
    final month = start == null ? usage.month : displayMonthYear(start, locale);
    return Container(
      key: const Key('bank-usage'),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.bankUsageTitle(month.isEmpty ? '—' : month),
            key: const Key('bank-usage-title'),
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          _UsageRow(
            key: const Key('bank-usage-checks'),
            label: l10n.bankUsageChecks,
            value: '${usage.checks}',
          ),
          _UsageRow(
            key: const Key('bank-usage-refreshes'),
            label: l10n.bankUsageRefreshes,
            value: l10n.bankUsageRefreshesOf(
              usage.refreshes,
              usage.refreshLimit,
            ),
          ),
          _UsageRow(
            key: const Key('bank-usage-cost'),
            label: l10n.bankUsageCost,
            value: formatLotCents(usage.estimatedCostCents),
          ),
          if (usage.limitReached) ...[
            const SizedBox(height: AppSpacing.sm),
            InventoryNote(
              key: const Key('bank-usage-limit-reached'),
              error: false,
              text: l10n.bankUsageLimitReached,
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          if (usage.byStaff.isEmpty)
            Text(
              l10n.bankUsageNone,
              key: const Key('bank-usage-none'),
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            )
          else ...[
            Text(
              l10n.bankUsageByStaff,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: 4),
            for (final person in usage.byStaff)
              Padding(
                key: Key('bank-usage-staff-${person.uid}'),
                padding: const EdgeInsets.only(top: 6),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      person.name.isEmpty
                          ? l10n.lotUnnamedPerson
                          : person.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.ink,
                      ),
                    ),
                    Text(
                      l10n.bankUsageStaffLine(person.checks, person.refreshes),
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _UsageRow extends StatelessWidget {
  const _UsageRow({super.key, required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            label,
            style: const TextStyle(fontSize: 13.5, color: AppColors.muted),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Text(
          value,
          style: const TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w700,
            color: AppColors.ink,
          ),
        ),
      ],
    ),
  );
}

/// Which bank, which account, whether it syncs - and the one action the
/// state asks for (Connect, or Reconnect when the bank wants a new sign-in).
class _StatusCard extends StatelessWidget {
  const _StatusCard({
    required this.status,
    required this.busy,
    required this.onConnect,
  });

  final BusinessBankStatus status;
  final String busy;
  final VoidCallback? onConnect;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final (chipLabel, chipColor) = switch (status.status) {
      BankLinkStatus.active => (l10n.bankStatusActive, AppColors.sage),
      BankLinkStatus.needsReauth => (
        l10n.bankStatusNeedsReauth,
        AppColors.warn,
      ),
      BankLinkStatus.disconnected => (
        l10n.bankStatusDisconnected,
        AppColors.muted,
      ),
    };
    final sync = status.lastSyncAt;
    return Container(
      key: const Key('bank-status-card'),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Padding(
                padding: EdgeInsets.only(top: 2),
                child: Icon(
                  Icons.account_balance_outlined,
                  color: AppColors.cobalt,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      status.connected
                          ? (status.institutionName.isEmpty
                                ? l10n.bankUnnamed
                                : status.institutionName)
                          : l10n.zelleNotConnectedTitle,
                      key: const Key('bank-name'),
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                    if (status.connected &&
                        bankAccountLabel(
                          status.accountName,
                          status.accountMask,
                        ).isNotEmpty)
                      Text(
                        bankAccountLabel(
                          status.accountName,
                          status.accountMask,
                        ),
                        key: const Key('bank-mask'),
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.muted,
                        ),
                      ),
                    if (status.connected)
                      Text(
                        sync == null
                            ? l10n.bankNeverSynced
                            : l10n.bankLastSync(
                                displayDateTime(
                                  easternWallAsLocal(sync),
                                  locale,
                                ),
                              ),
                        key: const Key('bank-last-sync'),
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                    // Under the name, not beside it: a long bank name and a
                    // long French status both keep their room on a phone.
                    const SizedBox(height: 6),
                    InventoryChip(
                      key: const Key('bank-status-chip'),
                      label: chipLabel,
                      color: chipColor,
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (status.needsReauth) ...[
            const SizedBox(height: AppSpacing.md),
            InventoryNote(error: false, text: l10n.bankNeedsReauthNote),
          ],
          if (!status.connected || status.needsReauth) ...[
            const SizedBox(height: AppSpacing.md),
            LotSheetButton(
              key: const Key('bank-connect'),
              label: status.needsReauth
                  ? l10n.zelleReconnect
                  : l10n.zelleConnectBank,
              busy: busy == 'connect',
              busyLabel: l10n.bankConnecting,
              onTap: onConnect,
            ),
          ],
        ],
      ),
    );
  }
}
