import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/business_destination_option.dart';
import '../models/business_service.dart';
import '../services/business_service.dart';
import '../services/freight_shipment_service.dart';
import '../utils/phone_number_validator.dart';
import '../utils/receiver_phone_rules.dart';
import '../widgets/marketplace_transaction_disclosure.dart';

/// Customer screen to send a parcel/box by freight, priced by weight,
/// by air or sea. Search-first: find a business + destination, then book.
class SendFreightScreen extends StatefulWidget {
  const SendFreightScreen({super.key});

  @override
  State<SendFreightScreen> createState() => _SendFreightScreenState();
}

class _SendFreightScreenState extends State<SendFreightScreen> {
  final _businessService = BusinessService();
  final _freightService = FreightShipmentService();

  final _searchController = TextEditingController();
  final _senderController = TextEditingController();
  final _receiverController = TextEditingController();
  final _phoneController = TextEditingController();
  final _weightController = TextEditingController();

  List<BusinessDestinationOption> _options = const [];
  BusinessDestinationOption? _selected;
  String _query = '';
  String _mode = 'sea';
  bool _loading = true;
  bool _loadFailed = false;
  bool _busy = false;
  bool _receiverPhoneIsWhatsappOnly = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    _senderController.dispose();
    _receiverController.dispose();
    _phoneController.dispose();
    _weightController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _loadFailed = false;
      });
    }
    try {
      final all = await _businessService.activeDestinationOptions().first;
      final options =
          all
              .where(
                (o) =>
                    hasBusinessService(
                      o.enabledServices,
                      BusinessServiceKey.freight,
                    ) &&
                    o.country.isActive &&
                    o.country.hasAnyFreightRate,
              )
              .toList()
            ..sort((a, b) => a.businessName.compareTo(b.businessName));
      if (!mounted) return;
      setState(() {
        _options = options;
        _loading = false;
        _loadFailed = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadFailed = true;
      });
    }
  }

  List<BusinessDestinationOption> get _filtered {
    final q = _query.trim().toLowerCase();
    if (q.isEmpty) return _options;
    return _options
        .where(
          (o) =>
              o.businessName.toLowerCase().contains(q) ||
              o.country.name.toLowerCase().contains(q),
        )
        .toList();
  }

  List<String> _availableModes(BusinessDestinationOption? o) {
    if (o == null) return const [];
    return [
      if (o.country.freightAvailable('air')) 'air',
      if (o.country.freightAvailable('sea')) 'sea',
    ];
  }

  double get _weightKg => double.tryParse(_weightController.text.trim()) ?? 0;
  double get _ratePerKg => _selected?.country.freightRatePerKg(_mode) ?? 0;
  double get _price => _weightKg > 0 ? _weightKg * _ratePerKg : 0;

  void _select(BusinessDestinationOption o) {
    setState(() {
      _selected = o;
      _receiverPhoneIsWhatsappOnly = false;
      final modes = _availableModes(o);
      _mode = modes.contains(_mode)
          ? _mode
          : (modes.isNotEmpty ? modes.first : 'sea');
    });
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    if (FirebaseAuth.instance.currentUser == null) {
      Navigator.pushNamed(context, '/login');
      return;
    }
    final option = _selected;
    if (option == null) return;
    if (_senderController.text.trim().isEmpty ||
        _receiverController.text.trim().isEmpty) {
      _snack(l10n.fillSenderReceiverPhone);
      return;
    }
    final phoneError = ReceiverPhoneRules.validate(
      value: _phoneController.text,
      destination: option.country,
      allowDifferentCountry: _receiverPhoneIsWhatsappOnly,
      requiredMessage: l10n.pleaseEnterReceiverPhone,
      invalidPhoneMessage: l10n.invalidPhoneWithCountryCode,
      invalidInternationalPhoneMessage: l10n.invalidInternationalPhone,
      whatsAppCountryCodeMessage: l10n.whatsAppDifferentCountryRequiresCode,
      destinationMismatchMessage: l10n.receiverPhoneMustMatchDestination,
    );
    if (phoneError != null) {
      _snack(phoneError);
      return;
    }
    if (_weightKg <= 0) {
      _snack(l10n.enterParcelWeightKg);
      return;
    }
    final marketplaceAcceptance = await confirmMarketplaceTransaction(
      context,
      providerNames: option.businessName,
      transactionSummary: l10n.sendFreight,
    );
    if (marketplaceAcceptance == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final shipment = await _freightService.payForFreight(
        senderName: _senderController.text.trim(),
        receiverName: _receiverController.text.trim(),
        receiverPhone: _phoneController.text.trim(),
        destinationCountryId: option.country.id,
        businessId: option.businessId,
        mode: _mode,
        weightKg: _weightKg,
        marketplaceAcceptance: marketplaceAcceptance,
      );
      if (!mounted) return;
      final code = shipment['trackingCode']?.toString() ?? '';
      final messenger = ScaffoldMessenger.of(context);
      Navigator.pop(context);
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.freightEstimatePaidTracking(code))),
      );
    } catch (error) {
      if (!mounted) return;
      final details =
          error is FirebaseFunctionsException && error.details is Map
          ? Map<String, dynamic>.from(error.details as Map)
          : const <String, dynamic>{};
      final message = details['reason'] == 'invalid_freight_mode'
          ? l10n.invalidFreightMode
          : l10n.freightBookingFailed;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _snack(String m) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.sendFreight)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _loadFailed
          ? _loadErrorState(theme)
          : _options.isEmpty
          ? _emptyState(theme)
          : (_selected == null ? _searchList(theme) : _bookingForm(theme)),
    );
  }

  Widget _loadErrorState(ThemeData theme) {
    final l10n = AppLocalizations.of(context)!;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off_outlined, size: 56, color: theme.hintColor),
            const SizedBox(height: 14),
            Text(
              l10n.couldNotLoadFreightOptions,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh),
              label: Text(l10n.retry),
            ),
          ],
        ),
      ),
    );
  }

  Widget _emptyState(ThemeData theme) {
    final l10n = AppLocalizations.of(context)!;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.inventory_2_outlined, size: 56, color: theme.hintColor),
            const SizedBox(height: 14),
            Text(
              l10n.noFreightBusinessesYet,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              l10n.noFreightBusinessesSubtitle,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.hintColor,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  // ---- Step 1: search + pick a business/destination ----
  Widget _searchList(ThemeData theme) {
    final l10n = AppLocalizations.of(context)!;
    final results = _filtered;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
          child: TextField(
            controller: _searchController,
            onChanged: (v) => setState(() => _query = v),
            decoration: InputDecoration(
              hintText: l10n.searchBusinessOrCountry,
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _query.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () {
                        _searchController.clear();
                        setState(() => _query = '');
                      },
                    ),
            ),
          ),
        ),
        Expanded(
          child: results.isEmpty
              ? Center(
                  child: Text(
                    l10n.noMatchFor(_query),
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.hintColor,
                    ),
                  ),
                )
              : ListView.separated(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                  itemCount: results.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, i) => _optionCard(theme, results[i]),
                ),
        ),
      ],
    );
  }

  Widget _optionCard(ThemeData theme, BusinessDestinationOption o) {
    final l10n = AppLocalizations.of(context)!;
    final air = o.country.freightAvailable('air');
    final sea = o.country.freightAvailable('sea');
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _select(o),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Text(o.country.flagEmoji, style: const TextStyle(fontSize: 28)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      o.businessName,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      l10n.toDestination(o.country.name),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.hintColor,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        if (air)
                          _ratePill(
                            theme,
                            Icons.flight_takeoff,
                            l10n.airRatePerKg(
                              '\$${o.country.freightAirPricePerKg.toStringAsFixed(2)}',
                            ),
                          ),
                        if (sea)
                          _ratePill(
                            theme,
                            Icons.directions_boat,
                            l10n.seaRatePerKg(
                              '\$${o.country.freightSeaPricePerKg.toStringAsFixed(2)}',
                            ),
                          ),
                        _ratePill(
                          theme,
                          Icons.verified_outlined,
                          l10n.approvedBusiness,
                        ),
                        if (o.country.hasDeliveryEstimate)
                          _ratePill(
                            theme,
                            Icons.schedule_outlined,
                            l10n.freightDeliveryEstimateDays(
                              o.country.deliveryEstimateMinDays!,
                              o.country.deliveryEstimateMaxDays!,
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: theme.hintColor),
            ],
          ),
        ),
      ),
    );
  }

  Widget _ratePill(ThemeData theme, IconData icon, String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14),
          const SizedBox(width: 6),
          Text(label, style: theme.textTheme.labelMedium),
        ],
      ),
    );
  }

  // ---- Step 2: booking form for the selected option ----
  Widget _bookingForm(ThemeData theme) {
    final l10n = AppLocalizations.of(context)!;
    final o = _selected!;
    final modes = _availableModes(o);
    final showWhatsapp = ReceiverPhoneRules.isDifferentCountryNumber(
      value: _phoneController.text,
      destination: o.country,
    );
    return ListView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 28),
      children: [
        Card(
          margin: EdgeInsets.zero,
          child: ListTile(
            leading: Text(
              o.country.flagEmoji,
              style: const TextStyle(fontSize: 26),
            ),
            title: Text(
              o.businessName,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
            subtitle: Text(l10n.toDestination(o.country.name)),
            trailing: TextButton(
              onPressed: _busy ? null : () => setState(() => _selected = null),
              child: Text(l10n.change),
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text(l10n.shippingMode, style: theme.textTheme.labelLarge),
        const SizedBox(height: 10),
        Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < modes.length; i++) ...[
              if (i > 0) const SizedBox(width: 12),
              Expanded(
                child: _ModeCard(
                  mode: modes[i],
                  rate: o.country.freightRatePerKg(modes[i]),
                  selected: modes[i] == _mode,
                  onTap: _busy ? null : () => setState(() => _mode = modes[i]),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _weightController,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            labelText: l10n.estimatedWeightKg,
            prefixIcon: const Icon(Icons.scale_outlined),
          ),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _senderController,
          decoration: InputDecoration(labelText: l10n.senderName),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _receiverController,
          decoration: InputDecoration(labelText: l10n.receiverName),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _phoneController,
          keyboardType: TextInputType.phone,
          inputFormatters: PhoneNumberValidator.allowedInputFormatters,
          onChanged: (_) => setState(() {
            if (!ReceiverPhoneRules.isDifferentCountryNumber(
              value: _phoneController.text,
              destination: o.country,
            )) {
              _receiverPhoneIsWhatsappOnly = false;
            }
          }),
          decoration: InputDecoration(labelText: l10n.receiverPhone),
        ),
        if (showWhatsapp)
          CheckboxListTile(
            value: _receiverPhoneIsWhatsappOnly,
            onChanged: _busy
                ? null
                : (checked) => setState(
                    () => _receiverPhoneIsWhatsappOnly = checked ?? false,
                  ),
            contentPadding: EdgeInsets.zero,
            dense: true,
            controlAffinity: ListTileControlAffinity.leading,
            title: Text(
              l10n.receiverWhatsAppNumberTitle,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            subtitle: Text(l10n.receiverWhatsAppNumberSubtitle),
          ),
        const SizedBox(height: 18),
        Card(
          elevation: 0,
          color: theme.colorScheme.surfaceContainerHighest,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.estimatedTotal,
                        style: theme.textTheme.labelMedium,
                      ),
                      Text(
                        _weightKg > 0
                            ? '${_weightKg.toStringAsFixed(1)} kg × '
                                  '\$${_ratePerKg.toStringAsFixed(2)}'
                            : l10n.enterWeightToSeePrice,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.hintColor,
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  '\$${_price.toStringAsFixed(2)}',
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 10),
        Text(
          l10n.freightEstimateExplanation,
          style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 18),
        FilledButton.icon(
          onPressed: _busy || _price <= 0 ? null : _submit,
          icon: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.local_shipping_outlined),
          label: Text(l10n.payEstimate),
        ),
        const SizedBox(height: 8),
        Text(
          l10n.freightDropOffNote,
          style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor),
          textAlign: TextAlign.center,
        ),
        if ((o.businessAddress ?? '').trim().isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(
            l10n.freightDropOffAddress(o.businessAddress!.trim()),
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurface,
              fontWeight: FontWeight.w700,
            ),
            textAlign: TextAlign.center,
          ),
        ],
        if ((o.businessPhone ?? '').trim().isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(
            l10n.freightBusinessPhone(o.businessPhone!.trim()),
            style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor),
            textAlign: TextAlign.center,
          ),
        ],
      ],
    );
  }
}

/// A selectable card for choosing air vs sea freight, showing the mode, its
/// per-kg rate, and a one-line trade-off, with a clear selected state.
class _ModeCard extends StatelessWidget {
  const _ModeCard({
    required this.mode,
    required this.rate,
    required this.selected,
    required this.onTap,
  });

  final String mode;
  final double rate;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final l10n = AppLocalizations.of(context)!;
    final isAir = mode == 'air';
    final accent = cs.primary;
    return Material(
      color: selected ? accent.withValues(alpha: 0.10) : cs.surface,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: selected ? accent : cs.outlineVariant,
              width: selected ? 2 : 1,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(
                      color: accent.withValues(alpha: selected ? 0.18 : 0.10),
                      borderRadius: BorderRadius.circular(11),
                    ),
                    child: Icon(
                      isAir ? Icons.flight_takeoff : Icons.directions_boat,
                      color: accent,
                      size: 20,
                    ),
                  ),
                  const Spacer(),
                  Icon(
                    selected
                        ? Icons.check_circle_rounded
                        : Icons.circle_outlined,
                    color: selected ? accent : cs.outline,
                    size: 22,
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                isAir ? l10n.airFreight : l10n.seaFreight,
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                l10n.pricePerKg('\$${rate.toStringAsFixed(2)}'),
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: accent,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                isAir ? l10n.fasterDelivery : l10n.lowerCost,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: theme.hintColor,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
