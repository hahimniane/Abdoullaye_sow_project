import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/country_phone_field.dart';
import '../widgets/fleet_pickers.dart';
import '../widgets/fleet_widgets.dart';

/// Fleet settings (Fleet admin only, docs/FLEET.md): the late fee and the
/// plate-returned rule, Zelle details, WhatsApp to drivers, and the pay-day
/// bank-check schedule. The spreadsheet import stays on the website.
class FleetSettingsTab extends StatelessWidget {
  const FleetSettingsTab({super.key, required this.controller});

  final FleetController controller;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        _SettingsForm(controller: controller),
        const SizedBox(height: AppSpacing.md),
        _WhatsAppCard(controller: controller),
        const SizedBox(height: AppSpacing.md),
        _BankScheduleCard(controller: controller),
        const SizedBox(height: AppSpacing.md),
        FleetCard(
          child: Text(
            AppLocalizations.of(context)!.fltImportOnWebsite,
            style: const TextStyle(color: AppColors.muted),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// The settings form.
// ---------------------------------------------------------------------------

class _SettingsForm extends StatefulWidget {
  const _SettingsForm({required this.controller});

  final FleetController controller;

  @override
  State<_SettingsForm> createState() => _SettingsFormState();
}

class _SettingsFormState extends State<_SettingsForm> with FleetRun {
  final _fee = TextEditingController();
  int _day = 5;
  final _first = TextEditingController();
  final _zelleName = TextEditingController();
  final _zelleHandle = TextEditingController();
  String _rule = 'full';
  bool _only = true;
  bool _seeded = false;
  bool _saved = false;

  FleetController get c => widget.controller;

  @override
  void initState() {
    super.initState();
    c.addListener(_seed);
    _seed();
  }

  /// The business document arrives after the screen opens: fill the fields
  /// from it once, then leave what the person types alone.
  void _seed() {
    if (_seeded || c.state.business.isEmpty) return;
    _seeded = true;
    final s = c.state.settings;
    _fee.text = fleetCentsToInput(s.lateFeeCents);
    _day = s.lateFeeDay;
    _first.text = s.lateFeeFirstMonth;
    _zelleName.text = s.zelleName;
    _zelleHandle.text = s.zelleHandle;
    _rule = s.returnRule;
    _only = s.driversSeeOnly;
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    c.removeListener(_seed);
    for (final t in [_fee, _first, _zelleName, _zelleHandle]) {
      t.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    setState(() => _saved = false);
    final cents = _fee.text.trim().isEmpty ? 0 : fleetDollarsToCents(_fee.text);
    final day = _day;
    final first = _first.text.trim();
    if (cents == null ||
        cents < 0 ||
        day < 1 ||
        day > 28 ||
        (first.isNotEmpty && !RegExp(r'^\d{4}-\d{2}$').hasMatch(first))) {
      setState(() => error = l10n.fltRefusalBadInput);
      return;
    }
    final yes = await fleetConfirm(
      context,
      title: l10n.fltSettingsSaveTitle,
      message: l10n.fltSettingsSaveMessage,
      confirmLabel: l10n.fltSaveSettings,
    );
    if (!yes || !mounted) return;
    final answer = await runFleet(
      c.service,
      FleetRequests.settingsSave(
        c.businessId,
        FleetSettingsView(
          lateFeeCents: cents,
          lateFeeDay: day,
          lateFeeFirstMonth: first,
          returnRule: _rule,
          driversSeeOnly: _only,
          zelleName: _zelleName.text.trim(),
          zelleHandle: _zelleHandle.text.trim(),
        ),
      ),
    );
    if (answer != null && mounted) setState(() => _saved = true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return FleetCard(
      title: l10n.fltSettingsTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FleetField(
            controller: _fee,
            label: l10n.fltSettingLateFee,
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            enabled: !busy,
          ),
          FleetDueDayField(
            key: const Key('fleet-settings-late-day'),
            label: l10n.fltSettingLateFeeDay,
            value: _day,
            enabled: !busy,
            onChanged: (d) => setState(() => _day = d ?? 5),
          ),
          FleetField(
            controller: _first,
            label: l10n.fltSettingFirstMonth,
            hint: '2026-11',
            enabled: !busy,
          ),
          Text(
            l10n.fltSettingReturnRule,
            style: const TextStyle(color: AppColors.muted, fontSize: 12),
          ),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            child: SegmentedButton<String>(
              key: const Key('fleet-setting-rule'),
              showSelectedIcon: false,
              segments: [
                ButtonSegment(value: 'full', label: Text(l10n.fltRuleFull)),
                ButtonSegment(value: 'days', label: Text(l10n.fltRuleDays)),
              ],
              selected: {_rule},
              onSelectionChanged: busy
                  ? null
                  : (v) => setState(() => _rule = v.first),
            ),
          ),
          FleetField(
            controller: _zelleName,
            label: l10n.fltSettingZelleName,
            maxLength: 80,
            enabled: !busy,
          ),
          FleetField(
            controller: _zelleHandle,
            label: l10n.fltSettingZelleHandle,
            maxLength: 120,
            enabled: !busy,
          ),
          SwitchListTile(
            key: const Key('fleet-setting-only'),
            contentPadding: EdgeInsets.zero,
            title: Text(l10n.fltSettingDriversSeeOnly),
            subtitle: Text(l10n.fltSettingDriversSeeOnlyHint),
            value: _only,
            onChanged: busy ? null : (v) => setState(() => _only = v),
          ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
              child: Text(
                error!,
                key: const Key('fleet-settings-error'),
                style: const TextStyle(color: AppColors.errorRed),
              ),
            ),
          Wrap(
            spacing: AppSpacing.md,
            runSpacing: AppSpacing.sm,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              FilledButton(
                key: const Key('fleet-settings-save'),
                onPressed: busy ? null : _save,
                child: busy
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(l10n.fltSaveSettings),
              ),
              if (_saved) ...[
                Text(
                  l10n.fltSaved,
                  key: const Key('fleet-settings-saved'),
                  style: const TextStyle(color: AppColors.sage),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// WhatsApp to drivers.
// ---------------------------------------------------------------------------

class _WhatsAppCard extends StatefulWidget {
  const _WhatsAppCard({required this.controller});

  final FleetController controller;

  @override
  State<_WhatsAppCard> createState() => _WhatsAppCardState();
}

class _WhatsAppCardState extends State<_WhatsAppCard> with FleetRun {
  final _phone = TextEditingController();
  bool _enabled = false;
  List<String> _savedOnly = const [];
  List<String> _only = const [];
  bool _some = false;
  bool _seeded = false;
  String? _testResult;

  FleetController get c => widget.controller;

  @override
  void initState() {
    super.initState();
    c.addListener(_seed);
    _seed();
  }

  void _seed() {
    if (_seeded || c.state.business.isEmpty) return;
    _seeded = true;
    final s = c.state.settings;
    _enabled = s.whatsappEnabled;
    _savedOnly = s.whatsappOnlyDriverIds;
    _only = s.whatsappOnlyDriverIds;
    _some = s.whatsappOnlyDriverIds.isNotEmpty;
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    c.removeListener(_seed);
    _phone.dispose();
    super.dispose();
  }

  List<String> get _audience => _some ? _only : const [];

  int get _withPhone => [
    for (final d in c.state.data.drivers)
      if (d.isActive && d.phone.isNotEmpty) d,
  ].length;

  Future<void> _sendTest() async {
    final l10n = AppLocalizations.of(context)!;
    setState(() => _testResult = null);
    final answer = await runFleet(
      c.service,
      FleetRequests.whatsappTest(c.businessId, _phone.text.trim()),
    );
    if (answer == null || !mounted) return;
    final ok = answer['receipt'] == 'sent' && answer['reminder'] == 'sent';
    setState(
      () => _testResult = ok ? l10n.fltWaTestSent : l10n.fltWaTestFailed,
    );
  }

  void _applyAnswer(Map<String, dynamic> answer, bool enabled) {
    final list = answer['onlyDriverIds'];
    final ids = list is List
        ? [
            for (final id in list)
              if (id is String) id,
          ]
        : _audience;
    setState(() {
      _enabled = enabled;
      _savedOnly = ids;
      _only = ids;
      _some = ids.isNotEmpty;
    });
  }

  Future<void> _toggle(bool next) async {
    final l10n = AppLocalizations.of(context)!;
    final count = _some ? _only.length : _withPhone;
    final yes = await fleetConfirm(
      context,
      title: next ? l10n.fltWaTurnOnTitle : l10n.fltWaTurnOffTitle,
      message: next
          ? (_some ? l10n.fltWaTurnOnSome(count) : l10n.fltWaTurnOnAll(count))
          : l10n.fltWaTurnOffMessage,
      confirmLabel: next ? l10n.fltWaTurnOn : l10n.fltWaTurnOff,
    );
    if (!yes || !mounted) return;
    final answer = await runFleet(
      c.service,
      FleetRequests.whatsappSave(
        c.businessId,
        enabled: next,
        onlyDriverIds: _audience,
      ),
    );
    if (answer != null) _applyAnswer(answer, next);
  }

  Future<void> _saveAudience() async {
    final answer = await runFleet(
      c.service,
      FleetRequests.whatsappSave(
        c.businessId,
        enabled: true,
        onlyDriverIds: _audience,
      ),
    );
    if (answer != null) _applyAnswer(answer, true);
  }

  Future<void> _pickDriver() async {
    final l10n = AppLocalizations.of(context)!;
    final options = [
      for (final d in c.state.data.drivers)
        if (d.isActive && d.phone.isNotEmpty && !_only.contains(d.id)) d,
    ]..sort((a, b) => a.name.compareTo(b.name));
    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => options.isEmpty
          ? Padding(
              padding: const EdgeInsets.all(AppSpacing.xl),
              child: Text(l10n.fltWaNoMoreDrivers),
            )
          : ListView(
              shrinkWrap: true,
              children: [
                for (final d in options)
                  ListTile(
                    key: Key('fleet-wa-pick-${d.id}'),
                    title: Text(d.name),
                    subtitle: Text(d.phone),
                    onTap: () => Navigator.of(context).pop(d.id),
                  ),
              ],
            ),
    );
    if (picked != null && mounted) setState(() => _only = [..._only, picked]);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final names = {for (final d in c.state.data.drivers) d.id: d.name};
    final audienceChanged = _audience.join('|') != _savedOnly.join('|');
    final canTurnOn = !_some || _only.isNotEmpty;
    final stateText = !_enabled
        ? l10n.fltWaStateOff
        : _savedOnly.isNotEmpty
        ? l10n.fltWaStateSome(_savedOnly.length)
        : l10n.fltWaStateOn;
    return FleetCard(
      title: l10n.fltWaTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l10n.fltWaIntro, style: const TextStyle(color: AppColors.muted)),
          const SizedBox(height: AppSpacing.md),
          SwitchListTile(
            key: const Key('fleet-wa-switch'),
            contentPadding: EdgeInsets.zero,
            title: Text(stateText),
            subtitle: _enabled ? null : Text(l10n.fltWaTestFirst),
            value: _enabled,
            onChanged: busy || (!_enabled && !canTurnOn) ? null : _toggle,
          ),
          SegmentedButton<bool>(
            key: const Key('fleet-wa-who'),
            showSelectedIcon: false,
            segments: [
              ButtonSegment(value: false, label: Text(l10n.fltWaAllDrivers)),
              ButtonSegment(value: true, label: Text(l10n.fltWaChosenDrivers)),
            ],
            selected: {_some},
            onSelectionChanged: busy
                ? null
                : (v) => setState(() => _some = v.first),
          ),
          if (_some) ...[
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: 6,
              children: [
                for (final id in _only)
                  InputChip(
                    label: Text(names[id] ?? id),
                    onDeleted: busy
                        ? null
                        : () => setState(
                            () => _only = [
                              for (final x in _only)
                                if (x != id) x,
                            ],
                          ),
                  ),
                ActionChip(
                  key: const Key('fleet-wa-add'),
                  avatar: const Icon(Icons.add, size: 16),
                  label: Text(l10n.fltWaAddDriver),
                  onPressed: busy ? null : _pickDriver,
                ),
              ],
            ),
          ],
          if (_enabled && audienceChanged) ...[
            const SizedBox(height: AppSpacing.sm),
            FilledButton(
              key: const Key('fleet-wa-save-who'),
              onPressed: busy || !canTurnOn ? null : _saveAudience,
              child: Text(l10n.fltWaSaveWho),
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
          CountryPhoneField(
            fieldKey: const Key('fleet-wa-test-phone'),
            controller: _phone,
            labelText: l10n.fltWaTestPhone,
            enabled: !busy,
            decoration: InputDecoration(
              isDense: true,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          OutlinedButton(
            key: const Key('fleet-wa-test'),
            onPressed: busy ? null : _sendTest,
            child: Text(l10n.fltWaSendTest),
          ),
          if (_testResult != null)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.sm),
              child: Text(_testResult!, key: const Key('fleet-wa-test-result')),
            ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.sm),
              child: Text(
                error!,
                key: const Key('fleet-wa-error'),
                style: const TextStyle(color: AppColors.errorRed),
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// The pay-day bank-check schedule.
// ---------------------------------------------------------------------------

class _BankScheduleCard extends StatefulWidget {
  const _BankScheduleCard({required this.controller});

  final FleetController controller;

  @override
  State<_BankScheduleCard> createState() => _BankScheduleCardState();
}

class _BankScheduleCardState extends State<_BankScheduleCard> with FleetRun {
  FleetBankStatus? _status;
  FleetBankSchedule _schedule = const FleetBankSchedule(monthDays: [1, 2, 3]);
  bool _loading = true;
  bool _saved = false;
  String? _loadError;

  FleetController get c => widget.controller;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final status = await c.service
          .bankStatus(c.businessId)
          .timeout(const Duration(seconds: 20));
      if (!mounted) return;
      setState(() {
        _status = status;
        _schedule = status.schedule.monthDays.isEmpty
            ? status.schedule.copyWith(monthDays: const [1, 2, 3])
            : status.schedule;
      });
    } on FleetFailure catch (failure) {
      if (mounted) {
        setState(
          () => _loadError = fleetRefusalText(
            AppLocalizations.of(context)!,
            failure,
          ),
        );
      }
    } on TimeoutException {
      if (mounted) {
        setState(
          () => _loadError = AppLocalizations.of(context)!.fltBankTooSlow,
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _set(FleetBankSchedule next) => setState(() {
    _saved = false;
    _schedule = next;
  });

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    final quote = fleetBankScheduleQuote(
      _schedule,
      _status?.quote.centsEach ?? fleetPlaidRefreshCents,
    );
    final yes = await fleetConfirm(
      context,
      title: l10n.fltScheduleSaveTitle,
      message: _schedule.every > 0
          ? l10n.fltScheduleSaveOn(
              _schedule.every,
              quote.perMonth,
              fleetMoney(quote.monthCents),
            )
          : l10n.fltScheduleSaveOff,
      confirmLabel: l10n.fltScheduleSave,
    );
    if (!yes || !mounted) return;
    final answer = await runFleet(
      c.service,
      FleetRequests.bankScheduleSave(c.businessId, _schedule),
    );
    if (answer != null && mounted) {
      setState(() => _saved = true);
      unawaited(_load());
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final lang = Localizations.localeOf(context).languageCode;
    final status = _status;
    final quote = fleetBankScheduleQuote(
      _schedule,
      status?.quote.centsEach ?? fleetPlaidRefreshCents,
    );
    return FleetCard(
      title: l10n.fltScheduleTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.fltScheduleIntro,
            style: const TextStyle(color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          if (_loading && status == null)
            const Center(
              child: CircularProgressIndicator(
                key: Key('fleet-schedule-loading'),
              ),
            )
          else if (_loadError != null && status == null)
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _loadError!,
                  style: const TextStyle(color: AppColors.errorRed),
                ),
                OutlinedButton(
                  key: const Key('fleet-schedule-retry'),
                  onPressed: _load,
                  child: Text(l10n.fltRetry),
                ),
              ],
            )
          else ...[
            if (status != null && !status.connected)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.md),
                child: Text(l10n.fltBankNotConnected),
              ),
            DropdownButtonFormField<int>(
              key: const Key('fleet-schedule-every'),
              isExpanded: true,
              initialValue: _schedule.every,
              decoration: InputDecoration(
                labelText: l10n.fltScheduleEvery,
                isDense: true,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                ),
              ),
              items: [
                for (final m in fleetBankRefreshEvery)
                  DropdownMenuItem(
                    value: m,
                    child: Text(
                      m == 0
                          ? l10n.fltScheduleOff
                          : m == 60
                          ? l10n.fltScheduleEveryHour
                          : l10n.fltScheduleEveryMinutes(m),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: busy
                  ? null
                  : (v) => _set(_schedule.copyWith(every: v)),
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<int>(
                    key: ValueKey('fleet-schedule-from-${_schedule.fromHour}'),
                    isExpanded: true,
                    initialValue: _schedule.fromHour,
                    decoration: InputDecoration(
                      labelText: l10n.fltScheduleFrom,
                      isDense: true,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(
                          AppSpacing.radiusMd,
                        ),
                      ),
                    ),
                    items: [
                      for (var h = 0; h <= 23; h++)
                        DropdownMenuItem(
                          value: h,
                          child: Text(fleetHourLabel(h, language: lang)),
                        ),
                    ],
                    onChanged: busy || _schedule.every == 0
                        ? null
                        : (v) => _set(_schedule.copyWith(fromHour: v)),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: DropdownButtonFormField<int>(
                    key: ValueKey('fleet-schedule-to-${_schedule.toHour}'),
                    isExpanded: true,
                    initialValue: _schedule.toHour,
                    decoration: InputDecoration(
                      labelText: l10n.fltScheduleUntil,
                      isDense: true,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(
                          AppSpacing.radiusMd,
                        ),
                      ),
                    ),
                    items: [
                      for (var h = 1; h <= 24; h++)
                        DropdownMenuItem(
                          value: h,
                          child: Text(fleetHourLabel(h, language: lang)),
                        ),
                    ],
                    onChanged: busy || _schedule.every == 0
                        ? null
                        : (v) => _set(_schedule.copyWith(toHour: v)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              l10n.fltSchedulePayDays,
              style: const TextStyle(color: AppColors.muted, fontSize: 12),
            ),
            Wrap(
              spacing: 6,
              children: [
                for (var d = 1; d <= 28; d++)
                  FilterChip(
                    label: Text('$d'),
                    selected: _schedule.monthDays.contains(d),
                    visualDensity: VisualDensity.compact,
                    onSelected: busy || _schedule.every == 0
                        ? null
                        : (_) => _set(
                            _schedule.copyWith(
                              monthDays: _schedule.monthDays.contains(d)
                                  ? [
                                      for (final x in _schedule.monthDays)
                                        if (x != d) x,
                                    ]
                                  : [..._schedule.monthDays, d],
                            ),
                          ),
                  ),
              ],
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(l10n.fltScheduleMondays),
              value: _schedule.mondays,
              onChanged: busy || _schedule.every == 0
                  ? null
                  : (v) => _set(_schedule.copyWith(mondays: v)),
            ),
            Container(
              key: const Key('fleet-schedule-quote'),
              width: double.infinity,
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.parchment,
                borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              ),
              child: Text(
                quote.perMonth > 0
                    ? l10n.fltScheduleQuote(
                        quote.perMonth,
                        fleetMoney(quote.monthCents),
                      )
                    : l10n.fltScheduleNoCost,
              ),
            ),
            if (error != null)
              Padding(
                padding: const EdgeInsets.only(top: AppSpacing.sm),
                child: Text(
                  error!,
                  key: const Key('fleet-schedule-error'),
                  style: const TextStyle(color: AppColors.errorRed),
                ),
              ),
            const SizedBox(height: AppSpacing.md),
            Wrap(
              spacing: AppSpacing.md,
              runSpacing: AppSpacing.sm,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                FilledButton(
                  key: const Key('fleet-schedule-save'),
                  onPressed:
                      busy ||
                          (status != null &&
                              !status.connected &&
                              _schedule.every > 0)
                      ? null
                      : _save,
                  child: busy
                      ? const SizedBox(
                          height: 18,
                          width: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(l10n.fltScheduleSave),
                ),
                if (_saved) ...[
                  const SizedBox(width: AppSpacing.md),
                  Text(
                    l10n.fltSaved,
                    style: const TextStyle(color: AppColors.sage),
                  ),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }
}
