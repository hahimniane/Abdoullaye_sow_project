import 'dart:convert';

import 'package:flutter/material.dart';

import '../data/nyc_boroughs.dart';
import '../l10n/app_localizations.dart';

/// The services a pickup plan can cover, in display order. Keys match the
/// server's PICKUP_SERVICES (functions/pickup_plan.js).
const kPickupPlanServices = ['barrels', 'freight', 'parking', 'carTransport'];

/// Maps enabledServices ids to pickup plan service keys.
const kPickupServiceByBusinessService = {
  'barrelShipping': 'barrels',
  'freight': 'freight',
  'carParking': 'parking',
  'carTransport': 'carTransport',
};

/// Business-side editor for the shared pickup plan (docs/PLAN-business-
/// pickup.md): one plan across all services, three modes (flat / distance /
/// borough for New York businesses), a mandatory travel cap, and per-service
/// choices (inherit / custom / off). The server re-validates on save; this
/// widget mirrors those rules so owners see problems before submitting.
class PickupPlanEditor extends StatefulWidget {
  const PickupPlanEditor({
    super.key,
    required this.canEdit,
    required this.isNewYorkBased,
    required this.initialPlan,
    required this.enabledServices,
  });

  final bool canEdit;
  final bool isNewYorkBased;
  final Map<String, dynamic>? initialPlan;
  final List<String> enabledServices;

  @override
  State<PickupPlanEditor> createState() => PickupPlanEditorState();
}

/// One pickup configuration's editable state (the shared plan or a custom
/// per-service override).
class _PickupConfigDraft {
  _PickupConfigDraft();

  String mode = 'flat';
  final flatFee = TextEditingController();
  final baseFee = TextEditingController();
  final perMileFee = TextEditingController();
  final minimumFee = TextEditingController();
  final maxPickupMiles = TextEditingController();
  final originAddress = TextEditingController();
  final boroughFees = {
    for (final borough in kNycBoroughs) borough: TextEditingController(),
  };

  void dispose() {
    flatFee.dispose();
    baseFee.dispose();
    perMileFee.dispose();
    minimumFee.dispose();
    maxPickupMiles.dispose();
    originAddress.dispose();
    for (final controller in boroughFees.values) {
      controller.dispose();
    }
  }

  static String _feeText(dynamic value) {
    if (value is! num) return '';
    return value == value.roundToDouble()
        ? value.toInt().toString()
        : value.toString();
  }

  void hydrate(Map<String, dynamic> config) {
    final rawMode = config['mode'];
    mode = (rawMode == 'distance' || rawMode == 'borough') ? rawMode : 'flat';
    flatFee.text = _feeText(config['flatFee']);
    baseFee.text = _feeText(config['baseFee']);
    perMileFee.text = _feeText(config['perMileFee']);
    minimumFee.text = _feeText(config['minimumFee']);
    maxPickupMiles.text = _feeText(config['maxPickupMiles']);
    originAddress.text = (config['originAddress'] as String?) ?? '';
    final prices = config['boroughPrices'];
    for (final borough in kNycBoroughs) {
      boroughFees[borough]!.text = prices is Map
          ? _feeText(prices[borough])
          : '';
    }
  }

  void clear() => hydrate(const {});

  double? _fee(TextEditingController controller) {
    final text = controller.text.trim();
    if (text.isEmpty) return null;
    final value = double.tryParse(text);
    if (value == null || value < 0) return null;
    return value;
  }

  /// The section's config as the server expects it, with enabled: true.
  Map<String, dynamic> toConfig() {
    final config = <String, dynamic>{'enabled': true, 'mode': mode};
    if (mode == 'borough') {
      config['boroughPrices'] = {
        for (final entry in boroughFees.entries)
          if (_fee(entry.value) != null) entry.key: _fee(entry.value),
      };
      return config;
    }
    config['maxPickupMiles'] = _fee(maxPickupMiles);
    if (mode == 'flat') {
      config['flatFee'] = _fee(flatFee);
    } else {
      config['baseFee'] = _fee(baseFee);
      config['perMileFee'] = _fee(perMileFee);
      config['minimumFee'] = _fee(minimumFee);
      config['originAddress'] = originAddress.text.trim();
    }
    return config;
  }

  /// Localized validation error for this section, or null when complete.
  /// Mirrors functions/pickup_plan.js normalizePickupConfig.
  String? validate(
    AppLocalizations l10n,
    String sectionLabel, {
    required bool isNewYorkBased,
  }) {
    if (mode == 'borough') {
      if (!isNewYorkBased) {
        return l10n.pickupPlanErrorBoroughRequiresNewYork(sectionLabel);
      }
      final hasPrice = boroughFees.values.any((c) => _fee(c) != null);
      if (!hasPrice) return l10n.pickupPlanErrorBoroughPrice(sectionLabel);
      return null;
    }
    if (_fee(maxPickupMiles) == null || _fee(maxPickupMiles) == 0) {
      return l10n.pickupPlanErrorCapRequired(sectionLabel);
    }
    if (mode == 'flat') {
      if (_fee(flatFee) == null) {
        return l10n.pickupPlanErrorFlatFee(sectionLabel);
      }
      return null;
    }
    if (_fee(baseFee) == null ||
        _fee(perMileFee) == null ||
        _fee(minimumFee) == null) {
      return l10n.pickupPlanErrorDistanceFees(sectionLabel);
    }
    if (originAddress.text.trim().isEmpty) {
      return l10n.pickupPlanErrorOrigin(sectionLabel);
    }
    return null;
  }
}

class PickupPlanEditorState extends State<PickupPlanEditor> {
  bool _enabled = false;
  final _shared = _PickupConfigDraft();
  final _serviceChoices = {
    for (final service in kPickupPlanServices) service: 'inherit',
  };
  final _serviceConfigs = {
    for (final service in kPickupPlanServices) service: _PickupConfigDraft(),
  };
  String? _hydratedSignature;

  @override
  void initState() {
    super.initState();
    _hydrate();
  }

  @override
  void didUpdateWidget(PickupPlanEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    _hydrate();
  }

  @override
  void dispose() {
    _shared.dispose();
    for (final draft in _serviceConfigs.values) {
      draft.dispose();
    }
    super.dispose();
  }

  void _hydrate() {
    final signature = jsonEncode(widget.initialPlan ?? const {});
    if (_hydratedSignature == signature) return;
    _hydratedSignature = signature;
    final plan = widget.initialPlan ?? const <String, dynamic>{};
    final shared = plan['shared'];
    _enabled = shared is Map && shared['enabled'] == true;
    _shared.hydrate(
      shared is Map ? Map<String, dynamic>.from(shared) : const {},
    );
    final services = plan['services'];
    for (final service in kPickupPlanServices) {
      final entry = services is Map ? services[service] : null;
      if (entry is Map && entry['inherit'] == false) {
        _serviceChoices[service] = entry['enabled'] == true ? 'custom' : 'off';
      } else {
        _serviceChoices[service] = 'inherit';
      }
      if (_serviceChoices[service] == 'custom') {
        _serviceConfigs[service]!.hydrate(Map<String, dynamic>.from(entry));
      } else {
        _serviceConfigs[service]!.clear();
      }
    }
    if (mounted) setState(() {});
  }

  List<String> get _visibleServices => kPickupPlanServices
      .where(
        (service) => widget.enabledServices.any(
          (id) => kPickupServiceByBusinessService[id] == service,
        ),
      )
      .toList();

  /// Localized error for the whole plan, or null when it can be saved.
  String? validate(AppLocalizations l10n) {
    if (_enabled) {
      final error = _shared.validate(
        l10n,
        l10n.pickupPlanSharedSectionLabel,
        isNewYorkBased: widget.isNewYorkBased,
      );
      if (error != null) return error;
    }
    for (final service in _visibleServices) {
      if (_serviceChoices[service] != 'custom') continue;
      final error = _serviceConfigs[service]!.validate(
        l10n,
        _serviceLabel(l10n, service),
        isNewYorkBased: widget.isNewYorkBased,
      );
      if (error != null) return error;
    }
    return null;
  }

  /// The pickupPlan payload, or null when there is nothing to send (no stored
  /// plan and nothing configured) so untouched businesses keep no plan.
  Map<String, dynamic>? buildPlan() {
    final hasExplicitService = kPickupPlanServices.any(
      (service) => _serviceChoices[service] != 'inherit',
    );
    if (widget.initialPlan == null && !_enabled && !hasExplicitService) {
      return null;
    }
    final storedServices = widget.initialPlan?['services'];
    final services = <String, dynamic>{};
    for (final service in kPickupPlanServices) {
      switch (_serviceChoices[service]) {
        case 'custom':
          services[service] = _serviceConfigs[service]!.toConfig();
        case 'off':
          services[service] = {'enabled': false};
        default:
          // An absent key already inherits; only keep an explicit record.
          final stored = storedServices is Map ? storedServices[service] : null;
          if (stored is Map && stored['inherit'] == true) {
            services[service] = {'inherit': true};
          }
      }
    }
    return {
      'shared': _enabled ? _shared.toConfig() : {'enabled': false},
      'services': services,
    };
  }

  String _serviceLabel(AppLocalizations l10n, String service) {
    switch (service) {
      case 'barrels':
        return l10n.pickupPlanServiceBarrels;
      case 'freight':
        return l10n.pickupPlanServiceFreight;
      case 'parking':
        return l10n.pickupPlanServiceParking;
      default:
        return l10n.pickupPlanServiceCarTransport;
    }
  }

  String _choiceLabel(AppLocalizations l10n, String choice) {
    switch (choice) {
      case 'custom':
        return l10n.pickupPlanChoiceCustom;
      case 'off':
        return l10n.pickupPlanChoiceOff;
      default:
        return l10n.pickupPlanChoiceInherit;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final hintStyle = Theme.of(context).textTheme.bodySmall?.copyWith(
      color: Theme.of(context).hintColor,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(l10n.pickupPlanSectionSubtitle, style: hintStyle),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _enabled,
          onChanged: widget.canEdit
              ? (value) => setState(() => _enabled = value)
              : null,
          title: Text(l10n.pickupPlanOfferToggle),
        ),
        if (_enabled)
          ..._configFields(context, l10n, _shared)
        else
          Text(l10n.pickupPlanDisabledHint, style: hintStyle),
        const SizedBox(height: 16),
        Text(l10n.pickupPlanPerServiceHint, style: hintStyle),
        const SizedBox(height: 8),
        for (final service in _visibleServices) ...[
          DropdownButtonFormField<String>(
            initialValue: _serviceChoices[service],
            decoration: InputDecoration(
              labelText: _serviceLabel(l10n, service),
            ),
            items: [
              for (final choice in const ['inherit', 'custom', 'off'])
                DropdownMenuItem(
                  value: choice,
                  child: Text(_choiceLabel(l10n, choice)),
                ),
            ],
            onChanged: widget.canEdit
                ? (value) => setState(
                    () => _serviceChoices[service] = value ?? 'inherit',
                  )
                : null,
          ),
          if (_serviceChoices[service] == 'custom') ...[
            const SizedBox(height: 12),
            ..._configFields(context, l10n, _serviceConfigs[service]!),
          ],
          const SizedBox(height: 12),
        ],
      ],
    );
  }

  List<Widget> _configFields(
    BuildContext context,
    AppLocalizations l10n,
    _PickupConfigDraft draft,
  ) {
    final hintStyle = Theme.of(context).textTheme.bodySmall?.copyWith(
      color: Theme.of(context).hintColor,
    );
    final effectiveMode = draft.mode == 'borough' && !widget.isNewYorkBased
        ? 'flat'
        : draft.mode;
    return [
      const SizedBox(height: 4),
      DropdownButtonFormField<String>(
        initialValue: effectiveMode,
        decoration: InputDecoration(labelText: l10n.pickupPlanModeLabel),
        items: [
          DropdownMenuItem(
            value: 'flat',
            child: Text(l10n.pickupPlanModeFlat),
          ),
          DropdownMenuItem(
            value: 'distance',
            child: Text(l10n.pickupPlanModeDistance),
          ),
          if (widget.isNewYorkBased)
            DropdownMenuItem(
              value: 'borough',
              child: Text(l10n.pickupPlanModeBorough),
            ),
        ],
        onChanged: widget.canEdit
            ? (value) => setState(() => draft.mode = value ?? 'flat')
            : null,
      ),
      const SizedBox(height: 12),
      if (effectiveMode == 'flat') ...[
        Text(l10n.pickupPlanFlatHint, style: hintStyle),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _numberField(
                controller: draft.flatFee,
                label: l10n.pickupPlanFlatFee,
                icon: Icons.attach_money,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _numberField(
                controller: draft.maxPickupMiles,
                label: l10n.pickupPlanMaxMiles,
                icon: Icons.social_distance_outlined,
              ),
            ),
          ],
        ),
      ] else if (effectiveMode == 'distance') ...[
        Text(l10n.pickupPlanDistanceHint, style: hintStyle),
        const SizedBox(height: 12),
        TextField(
          controller: draft.originAddress,
          enabled: widget.canEdit,
          decoration: InputDecoration(
            labelText: l10n.pickupPlanOriginAddress,
            helperText: l10n.pickupPlanOriginHelper,
            prefixIcon: const Icon(Icons.store_outlined),
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _numberField(
                controller: draft.baseFee,
                label: l10n.pickupPlanBaseFee,
                icon: Icons.attach_money,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _numberField(
                controller: draft.perMileFee,
                label: l10n.pickupPlanPerMile,
                icon: Icons.straighten_outlined,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _numberField(
                controller: draft.minimumFee,
                label: l10n.pickupPlanMinFee,
                icon: Icons.south_outlined,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _numberField(
                controller: draft.maxPickupMiles,
                label: l10n.pickupPlanMaxMiles,
                icon: Icons.social_distance_outlined,
              ),
            ),
          ],
        ),
      ] else ...[
        Text(l10n.pickupPlanBoroughHint, style: hintStyle),
        const SizedBox(height: 12),
        for (final borough in kNycBoroughs) ...[
          _numberField(
            controller: draft.boroughFees[borough]!,
            label: borough,
            icon: Icons.attach_money,
          ),
          const SizedBox(height: 12),
        ],
      ],
    ];
  }

  Widget _numberField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
  }) {
    return TextField(
      controller: controller,
      enabled: widget.canEdit,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      decoration: InputDecoration(labelText: label, prefixIcon: Icon(icon)),
    );
  }
}
