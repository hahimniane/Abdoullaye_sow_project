import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../data/car_catalog.dart';
import '../l10n/app_localizations.dart';
import '../models/business_destination_option.dart';
import '../models/destination_country.dart';
import '../providers/auth_provider.dart';
import '../services/transport_service.dart';
import '../theme/app_colors.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/country_phone_field.dart';
import '../widgets/searchable_destination_country_field.dart';

/// Customer-facing flow: publish one route-first car transport request to every
/// eligible verified business. Businesses submit comparable quotes and the
/// customer chooses one later; nothing is paid here.
class RequestTransportScreen extends StatefulWidget {
  const RequestTransportScreen({super.key, this.service});

  /// Injected by tests; the app builds its own.
  final TransportService? service;

  @override
  State<RequestTransportScreen> createState() => _RequestTransportScreenState();
}

class _RequestTransportScreenState extends State<RequestTransportScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TransportService _service = widget.service ?? TransportService();

  final _ownerController = TextEditingController();
  final _phoneController = TextEditingController();
  final _vinController = TextEditingController();
  final _pickupAreaController = TextEditingController();
  final _pickupController = TextEditingController();
  final _notesController = TextEditingController();

  List<BusinessDestinationOption> _options = const [];
  DestinationCountry? _selectedDestination;

  String? _selectedMake;
  String? _selectedModel;
  String? _selectedYear;
  List<String> _makeOptions = const [];
  List<String> _modelOptions = const [];
  List<String> _yearOptions = const [];

  DateTime? _preferredDate;
  bool _vehicleOperable = true;
  String _requestedTransportMethod = 'open';
  bool _flexibleDates = true;
  bool _loading = true;
  bool _submitting = false;
  bool _loadFailed = false;
  bool? _signedIn;

  // A request can only be sent from an account, so a signed-out customer is
  // asked to sign in before anything loads. Loading follows the auth state
  // rather than running once from initState, so returning from sign-in (or
  // signing in anywhere else) brings the form up without a manual retry.
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final signedIn = Provider.of<AuthProvider>(context).isAuthenticated;
    if (signedIn == _signedIn) return;
    _signedIn = signedIn;
    if (!signedIn) return;
    _loading = true;
    _loadFailed = false;
    _bootstrap();
  }

  @override
  void dispose() {
    _ownerController.dispose();
    _phoneController.dispose();
    _vinController.dispose();
    _pickupAreaController.dispose();
    _pickupController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  // Every path ends in setState with _loading false: the catalog load sits
  // inside the try so a failure there cannot leave the spinner up.
  Future<void> _bootstrap() async {
    try {
      await CarCatalog.instance.load();
      final options = await _service.activeTransportOptions();
      if (!mounted) return;
      final auth = context.read<AuthProvider>();
      _ownerController.text = auth.buyerName == 'Customer'
          ? ''
          : auth.buyerName;
      _phoneController.text = auth.customerPhone ?? '';
      setState(() {
        _makeOptions = CarCatalog.instance.getMakes();
        _options = options;
        _loading = false;
      });
    } catch (error) {
      // The raw error (often a platform stack trace) is for the log only;
      // the customer gets a short localized message and a retry.
      debugPrint('Could not load transport options: $error');
      if (!mounted) return;
      setState(() {
        _loadFailed = true;
        _loading = false;
      });
    }
  }

  void _retryLoad() {
    setState(() {
      _loading = true;
      _loadFailed = false;
    });
    _bootstrap();
  }

  // Same entry point the other customer flows use: the auth screens pop back
  // here on success, and didChangeDependencies then loads the form.
  void _openAuth(String route) {
    Navigator.pushNamed(
      context,
      route,
      arguments: const {'returnToPrevious': true},
    );
  }

  List<DestinationCountry> get _destinationCountries {
    final byId = <String, DestinationCountry>{};
    for (final option in _options) {
      byId.putIfAbsent(option.country.id, () => option.country);
    }
    final countries = byId.values.toList();
    countries.sort((a, b) => a.name.compareTo(b.name));
    return countries;
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _preferredDate ?? now.add(const Duration(days: 2)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 180)),
    );
    if (picked != null && mounted) {
      setState(() => _preferredDate = picked);
    }
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    if (FirebaseAuth.instance.currentUser == null) {
      Navigator.pushNamed(context, '/login');
      return;
    }
    final destination = _selectedDestination;
    if (destination == null) {
      showErrorSnackBar(context, l10n.chooseTransportDestination);
      return;
    }
    if (!_formKey.currentState!.validate()) return;
    if (_selectedMake == null ||
        _selectedModel == null ||
        _selectedYear == null) {
      showErrorSnackBar(context, l10n.selectCarMakeModelYear);
      return;
    }

    setState(() => _submitting = true);
    try {
      final result = await _service.createRequest(
        destinationCountryId: destination.id,
        destinationCountryName: destination.name,
        ownerName: _ownerController.text.trim(),
        carMake: _selectedMake!,
        carModel: _selectedModel!,
        carYear: _selectedYear!,
        customerPhone: _phoneController.text.trim(),
        pickupArea: _pickupAreaController.text.trim(),
        vehicleOperable: _vehicleOperable,
        requestedTransportMethod: _requestedTransportMethod,
        flexibleDates: _flexibleDates,
        vinNumber: _vinController.text.trim(),
        pickupAddress: _pickupController.text.trim(),
        notes: _notesController.text.trim(),
        preferredDate: _preferredDate,
      );
      if (!mounted) return;
      showSuccessSnackBar(
        context,
        l10n.transportMarketplaceRequestSent(result.trackingCode),
      );
      Navigator.of(context).pop();
    } catch (error) {
      if (!mounted) return;
      showErrorSnackBar(context, l10n.couldNotSendRequest('$error'));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: AppColors.cream,
      appBar: AppBar(
        backgroundColor: AppColors.cream,
        elevation: 0,
        leading: const AppBackButton(),
        title: Text(
          l10n.requestCarTransport,
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
      body: SafeArea(child: _buildBody()),
    );
  }

  Widget _buildBody() {
    final l10n = AppLocalizations.of(context)!;
    if (_signedIn != true) {
      return _SignedOutState(
        onSignIn: () => _openAuth('/login'),
        onCreateAccount: () => _openAuth('/signup'),
      );
    }
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_loadFailed) {
      return _ErrorState(onRetry: _retryLoad);
    }
    if (_options.isEmpty) {
      return const _EmptyState();
    }

    final dateLabel = _preferredDate == null
        ? l10n.pickPreferredDateOptional
        : DateFormat.yMMMMd().format(_preferredDate!);

    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
        children: [
          _SectionLabel(l10n.whereIsTheCarGoing),
          _CardField(
            child: SearchableDestinationCountryField(
              countries: _destinationCountries,
              value: _selectedDestination,
              label: l10n.destinationCountry,
              requiredMessage: l10n.chooseTransportDestination,
              onChanged: (value) =>
                  setState(() => _selectedDestination = value),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            l10n.transportBusinessesWillQuote,
            style: const TextStyle(color: AppColors.muted, fontSize: 12.5),
          ),

          _SectionLabel(l10n.theCar),
          _CardField(
            child: DropdownButtonFormField<String>(
              initialValue: _selectedMake,
              isExpanded: true,
              decoration: InputDecoration(
                border: InputBorder.none,
                labelText: l10n.make,
              ),
              items: [
                for (final make in _makeOptions)
                  DropdownMenuItem(value: make, child: Text(make)),
              ],
              onChanged: (value) {
                setState(() {
                  _selectedMake = value;
                  _selectedModel = null;
                  _selectedYear = null;
                  _modelOptions = value == null
                      ? const []
                      : CarCatalog.instance.getModels(value);
                  _yearOptions = const [];
                });
              },
            ),
          ),
          const SizedBox(height: 12),
          _CardField(
            child: DropdownButtonFormField<String>(
              initialValue: _selectedModel,
              isExpanded: true,
              decoration: InputDecoration(
                border: InputBorder.none,
                labelText: l10n.model,
              ),
              items: [
                for (final model in _modelOptions)
                  DropdownMenuItem(value: model, child: Text(model)),
              ],
              onChanged: _selectedMake == null
                  ? null
                  : (value) {
                      setState(() {
                        _selectedModel = value;
                        _selectedYear = null;
                        _yearOptions = (value == null)
                            ? const []
                            : CarCatalog.instance.getYears(
                                _selectedMake!,
                                value,
                              );
                      });
                    },
            ),
          ),
          const SizedBox(height: 12),
          _CardField(
            child: DropdownButtonFormField<String>(
              initialValue: _selectedYear,
              isExpanded: true,
              decoration: InputDecoration(
                border: InputBorder.none,
                labelText: l10n.year,
              ),
              items: [
                for (final year in _yearOptions)
                  DropdownMenuItem(value: year, child: Text(year)),
              ],
              onChanged: _selectedModel == null
                  ? null
                  : (value) => setState(() => _selectedYear = value),
            ),
          ),
          const SizedBox(height: 12),
          _CardField(
            child: TextFormField(
              controller: _vinController,
              decoration: InputDecoration(
                border: InputBorder.none,
                labelText: l10n.vinOptional,
              ),
            ),
          ),
          const SizedBox(height: 12),
          _ChoicePanel<bool>(
            label: l10n.vehicleCondition,
            value: _vehicleOperable,
            options: [
              (value: true, label: l10n.vehicleRunsAndDrives),
              (value: false, label: l10n.vehicleInoperable),
            ],
            onChanged: (value) => setState(() => _vehicleOperable = value),
          ),
          const SizedBox(height: 12),
          _ChoicePanel<String>(
            label: l10n.preferredTransportMethod,
            value: _requestedTransportMethod,
            options: [
              (value: 'open', label: l10n.openTransport),
              (value: 'enclosed', label: l10n.enclosedTransport),
            ],
            onChanged: (value) =>
                setState(() => _requestedTransportMethod = value),
          ),

          _SectionLabel(l10n.contactAndPickup),
          _CardField(
            child: TextFormField(
              controller: _ownerController,
              decoration: InputDecoration(
                border: InputBorder.none,
                labelText: l10n.ownerName,
              ),
              validator: (value) => (value == null || value.trim().isEmpty)
                  ? l10n.enterOwnerName
                  : null,
            ),
          ),
          const SizedBox(height: 12),
          _CardField(
            child: CountryPhoneField(
              controller: _phoneController,
              labelText: l10n.contactPhone,
              decoration: const InputDecoration(border: InputBorder.none),
              validator: (value) => (value == null || value.trim().isEmpty)
                  ? l10n.enterContactPhone
                  : null,
            ),
          ),
          const SizedBox(height: 12),
          _CardField(
            child: TextFormField(
              controller: _pickupAreaController,
              decoration: InputDecoration(
                border: InputBorder.none,
                labelText: l10n.pickupArea,
                hintText: l10n.pickupAreaHint,
              ),
              validator: (value) => (value == null || value.trim().isEmpty)
                  ? l10n.enterPickupArea
                  : null,
            ),
          ),
          const SizedBox(height: 12),
          _CardField(
            child: TextFormField(
              controller: _pickupController,
              decoration: InputDecoration(
                border: InputBorder.none,
                labelText: l10n.pickupAddressOptional,
              ),
            ),
          ),
          const SizedBox(height: 12),
          _CardField(
            child: TextFormField(
              controller: _notesController,
              maxLines: 3,
              decoration: InputDecoration(
                border: InputBorder.none,
                labelText: l10n.notesForBusinessOptional,
              ),
            ),
          ),
          const SizedBox(height: 12),
          _CardField(
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(
                Icons.calendar_today_outlined,
                color: AppColors.cobalt,
              ),
              title: Text(dateLabel),
              trailing: _preferredDate == null
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () => setState(() => _preferredDate = null),
                    ),
              onTap: _pickDate,
            ),
          ),
          SwitchListTile.adaptive(
            contentPadding: const EdgeInsets.symmetric(horizontal: 4),
            title: Text(l10n.flexibleTransportDates),
            subtitle: Text(l10n.flexibleTransportDatesSubtitle),
            value: _flexibleDates,
            onChanged: (value) => setState(() => _flexibleDates = value),
          ),

          const SizedBox(height: 22),
          SizedBox(
            height: 52,
            child: FilledButton.icon(
              onPressed: _submitting ? null : _submit,
              icon: _submitting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.send_outlined),
              label: Text(_submitting ? l10n.sending : l10n.sendRequest),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            l10n.transportQuoteNoPaymentNote,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted, fontSize: 12.5),
          ),
        ],
      ),
    );
  }
}

class _ChoicePanel<T> extends StatelessWidget {
  const _ChoicePanel({
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
  });

  final String label;
  final T value;
  final List<({T value, String label})> options;
  final ValueChanged<T> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: AppColors.muted,
              fontWeight: FontWeight.w700,
              fontSize: 12.5,
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: SegmentedButton<T>(
              segments: [
                for (final option in options)
                  ButtonSegment<T>(
                    value: option.value,
                    label: Text(option.label),
                  ),
              ],
              selected: {value},
              showSelectedIcon: false,
              onSelectionChanged: (values) => onChanged(values.first),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 22, 2, 10),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w800,
          color: AppColors.ink,
        ),
      ),
    );
  }
}

class _CardField extends StatelessWidget {
  const _CardField({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.rule),
      ),
      child: child,
    );
  }
}

/// Centred icon, title, message and optional actions for the screen's
/// non-form states. Scrolls instead of overflowing when the copy outgrows the
/// viewport (a short phone, large accessibility text, French copy).
class _StatusMessage extends StatelessWidget {
  const _StatusMessage({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.message,
    this.actions = const [],
  });

  static const _padding = 32.0;

  final IconData icon;
  final Color iconColor;
  final String title;
  final String message;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        padding: const EdgeInsets.all(_padding),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            minHeight: (constraints.maxHeight - _padding * 2).clamp(
              0.0,
              double.infinity,
            ),
          ),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 52, color: iconColor),
                const SizedBox(height: 14),
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.muted),
                ),
                for (var i = 0; i < actions.length; i++) ...[
                  SizedBox(height: i == 0 ? 18 : 10),
                  actions[i],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SignedOutState extends StatelessWidget {
  const _SignedOutState({
    required this.onSignIn,
    required this.onCreateAccount,
  });
  final VoidCallback onSignIn;
  final VoidCallback onCreateAccount;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return _StatusMessage(
      icon: Icons.person_outline,
      iconColor: AppColors.cobalt,
      title: l10n.accountRequiredTitle,
      message: l10n.signInToRequestTransport,
      actions: [
        FilledButton.icon(
          onPressed: onSignIn,
          icon: const Icon(Icons.login),
          label: Text(l10n.signIn),
        ),
        OutlinedButton.icon(
          onPressed: onCreateAccount,
          icon: const Icon(Icons.person_add_outlined),
          label: Text(l10n.createAccount),
        ),
      ],
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return _StatusMessage(
      icon: Icons.local_shipping_outlined,
      iconColor: AppColors.muted,
      title: l10n.noTransportBusinessesYet,
      message: l10n.noTransportBusinessesSubtitle,
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.onRetry});
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return _StatusMessage(
      icon: Icons.error_outline,
      iconColor: AppColors.warn,
      title: l10n.couldNotLoadTransportOptions,
      message: l10n.genericError,
      actions: [FilledButton(onPressed: onRetry, child: Text(l10n.retry))],
    );
  }
}
