import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/fleet_widgets.dart';

/// The driver page's "Names this driver pays from": the Zelle sender names
/// remembered for this driver. A deposit from one of them pays the driver by
/// itself (docs/FLEET_PAYMENT_PROOF.md, Q5). The office can remove a name and
/// add one; the server refuses what is not a person's name.
class FleetPayerNamesCard extends StatefulWidget {
  const FleetPayerNamesCard({
    super.key,
    required this.controller,
    required this.driver,
  });

  final FleetController controller;
  final FleetDriver driver;

  @override
  State<FleetPayerNamesCard> createState() => _FleetPayerNamesCardState();
}

class _FleetPayerNamesCardState extends State<FleetPayerNamesCard>
    with FleetRun {
  final _draft = TextEditingController();
  late List<String> _names = widget.driver.payerNames;

  @override
  void didUpdateWidget(FleetPayerNamesCard old) {
    super.didUpdateWidget(old);
    // The live record is the truth: follow it when it changes (a save
    // answered, or a deposit remembered a name).
    if (!_same(old.driver.payerNames, widget.driver.payerNames)) {
      _names = widget.driver.payerNames;
    }
  }

  @override
  void dispose() {
    _draft.dispose();
    super.dispose();
  }

  static bool _same(List<String> a, List<String> b) =>
      a.length == b.length && a.every(b.contains);

  Future<bool> _save(List<String> next) async {
    final c = widget.controller;
    final answer = await runFleet(
      c.service,
      FleetRequests.payerNamesSave(
        c.businessId,
        driverId: widget.driver.id,
        names: next,
      ),
    );
    if (answer == null || !mounted) return false;
    final saved = answer['names'];
    setState(() => _names = saved is List ? fleetCleanPayerNames(saved) : next);
    return true;
  }

  Future<void> _add() async {
    final l10n = AppLocalizations.of(context)!;
    final next = fleetCleanPayerNames([..._names, _draft.text]);
    if (next.length == _names.length) {
      setState(
        () => error = _draft.text.trim().isEmpty
            ? l10n.fltPayerNameTypeFirst
            : l10n.fltPayerNameDuplicate,
      );
      return;
    }
    if (await _save(next)) _draft.clear();
  }

  Future<void> _remove(String name) async {
    final l10n = AppLocalizations.of(context)!;
    final yes = await fleetConfirm(
      context,
      title: l10n.fltPayerNameRemoveTitle,
      message: l10n.fltPayerNameRemoveMessage(
        driverDisplayName(widget.driver.name),
        name,
      ),
      confirmLabel: l10n.fltRemove,
      destructive: true,
    );
    if (!yes || !mounted) return;
    await _save([
      for (final n in _names)
        if (n != name) n,
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return FleetCard(
      key: const Key('fleet-payer-names'),
      title: l10n.fltPayerNamesTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.fltPayerNamesHint,
            style: const TextStyle(color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          if (_names.isEmpty)
            Text(l10n.fltPayerNamesEmpty, key: const Key('fleet-payer-empty'))
          else
            for (final name in _names)
              ConstrainedBox(
                key: Key('fleet-payer-name-$name'),
                constraints: const BoxConstraints(minHeight: 48),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        name,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                    IconButton(
                      key: Key('fleet-payer-remove-$name'),
                      tooltip: l10n.fltPayerNameRemove,
                      constraints: const BoxConstraints(
                        minWidth: 48,
                        minHeight: 48,
                      ),
                      icon: const Icon(Icons.close, size: 20),
                      onPressed: busy ? null : () => _remove(name),
                    ),
                  ],
                ),
              ),
          const SizedBox(height: AppSpacing.md),
          FleetField(
            controller: _draft,
            label: l10n.fltPayerNameField,
            maxLength: 80,
            enabled: !busy,
          ),
          Text(
            l10n.fltPayerNamesTwoWords,
            key: const Key('fleet-payer-hint'),
            style: const TextStyle(color: AppColors.muted, fontSize: 12),
          ),
          if (error != null)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.md),
              child: Text(
                error!,
                key: const Key('fleet-payer-error'),
                style: const TextStyle(color: AppColors.errorRed),
              ),
            ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              key: const Key('fleet-payer-add'),
              style: ButtonStyle(
                minimumSize: WidgetStateProperty.all(const Size(48, 48)),
              ),
              onPressed: busy ? null : _add,
              child: busy
                  ? const SizedBox(
                      height: 18,
                      width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(l10n.fltPayerNameAdd),
            ),
          ),
        ],
      ),
    );
  }
}
