import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../data/car_catalog.dart';
import '../l10n/app_localizations.dart';
import '../models/business_destination_option.dart';
import '../providers/auth_provider.dart';
import '../services/transport_service.dart';
import '../theme/app_colors.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/country_phone_field.dart';

/// Customer-facing flow: request car transport through a business that offers
/// the service. The business reviews the request and sends back a price quote —
/// nothing is paid here.
class RequestTransportScreen extends StatefulWidget {
  const RequestTransportScreen({super.key});

  @override
  State<RequestTransportScreen> createState() => _RequestTransportScreenState();
}

class _RequestTransportScreenState extends State<RequestTransportScreen> {
  final _formKey = GlobalKey<FormState>();
  final _service = TransportService();

  final _ownerController = TextEditingController();
  final _phoneController = TextEditingController();
  final _vinController = TextEditingController();
  final _pickupController = TextEditingController();
  final _notesController = TextEditingController();

  List<BusinessDestinationOption> _options = const [];
  BusinessDestinationOption? _selectedOption;

  String? _selectedMake;
  String? _selectedModel;
  String? _selectedYear;
  List<String> _makeOptions = const [];
  List<String> _modelOptions = const [];
  List<String> _yearOptions = const [];

  DateTime? _preferredDate;
  bool _loading = true;
  bool _submitting = false;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _ownerController.dispose();
    _phoneController.dispose();
    _vinController.dispose();
    _pickupController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    final auth = context.read<AuthProvider>();
    _ownerController.text = auth.buyerName == 'Customer' ? '' : auth.buyerName;
    _phoneController.text = auth.customerPhone ?? '';
    await CarCatalog.instance.load();
    if (!mounted) return;
    _makeOptions = CarCatalog.instance.getMakes();
    try {
      final options = await _service.activeTransportOptions();
      if (!mounted) return;
      setState(() {
        _options = options;
        _selectedOption = options.isNotEmpty ? options.first : null;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadError = error.toString();
        _loading = false;
      });
    }
  }

  String _optionLabel(BusinessDestinationOption option) {
    return '${option.businessName} · ${option.country.name}';
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
    final option = _selectedOption;
    if (option == null) {
      showErrorSnackBar(context, l10n.chooseBusinessAndDestination);
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
        businessId: option.businessId,
        destinationCountryId: option.country.id,
        destinationCountryName: option.country.name,
        ownerName: _ownerController.text.trim(),
        carMake: _selectedMake!,
        carModel: _selectedModel!,
        carYear: _selectedYear!,
        customerPhone: _phoneController.text.trim(),
        vinNumber: _vinController.text.trim(),
        pickupAddress: _pickupController.text.trim(),
        notes: _notesController.text.trim(),
        preferredDate: _preferredDate,
      );
      if (!mounted) return;
      showSuccessSnackBar(
        context,
        l10n.transportRequestSentToBusiness(
          option.businessName,
          result.trackingCode,
        ),
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
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_loadError != null) {
      return _ErrorState(
        message: _loadError!,
        onRetry: () {
          setState(() {
            _loading = true;
            _loadError = null;
          });
          _bootstrap();
        },
      );
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
          _SectionLabel(l10n.whoShouldHandleTransport),
          _CardField(
            child: DropdownButtonFormField<BusinessDestinationOption>(
              initialValue: _selectedOption,
              isExpanded: true,
              decoration: InputDecoration(
                border: InputBorder.none,
                labelText: l10n.businessDestination,
              ),
              items: [
                for (final option in _options)
                  DropdownMenuItem(
                    value: option,
                    child: Text(
                      _optionLabel(option),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: (value) => setState(() => _selectedOption = value),
            ),
          ),
          if (_selectedOption?.serviceNote != null &&
              _selectedOption!.serviceNote!.trim().isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6, left: 4),
              child: Text(
                _selectedOption!.serviceNote!.trim(),
                style: const TextStyle(color: AppColors.muted, fontSize: 12.5),
              ),
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

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.local_shipping_outlined,
              size: 56,
              color: AppColors.muted,
            ),
            const SizedBox(height: 16),
            Text(
              l10n.noTransportBusinessesYet,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 8),
            Text(
              l10n.noTransportBusinessesSubtitle,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.muted),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 52, color: AppColors.warn),
            const SizedBox(height: 14),
            Text(
              l10n.couldNotLoadTransportOptions,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.muted),
            ),
            const SizedBox(height: 18),
            FilledButton(onPressed: onRetry, child: Text(l10n.retry)),
          ],
        ),
      ),
    );
  }
}
