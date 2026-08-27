import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/freight_quote_service.dart';
import 'freight_quote_details_screen.dart';

/// Describing a parcel nobody on the route has put a price on.
///
/// Deliberately short. The customer is here because the platform could not
/// answer "what does this cost" - asking them to classify the parcel first
/// would be demanding the answer they came for. A sentence, a destination and
/// a way to send it is enough for a business to name a number.
class FreightQuoteRequestScreen extends StatefulWidget {
  const FreightQuoteRequestScreen({
    super.key,
    required this.destinationCountryId,
    required this.destinationCountryName,
    required this.availableModes,
    this.itemCategoryId = '',
    this.itemLabel = '',
  });

  final String destinationCountryId;
  final String destinationCountryName;

  /// Air, sea, or both - whichever the route actually offers.
  final List<String> availableModes;

  /// What the customer already told the funnel, carried so the businesses
  /// answering see the same parcel the customer was looking at.
  final String itemCategoryId;
  final String itemLabel;

  @override
  State<FreightQuoteRequestScreen> createState() =>
      _FreightQuoteRequestScreenState();
}

class _FreightQuoteRequestScreenState extends State<FreightQuoteRequestScreen> {
  final _service = FreightQuoteService();
  final _descriptionController = TextEditingController();
  final _weightController = TextEditingController();
  late String _mode;
  bool _busy = false;

  static const _maxDescriptionLength = 2000;

  @override
  void initState() {
    super.initState();
    _mode = widget.availableModes.contains('sea')
        ? 'sea'
        : (widget.availableModes.isNotEmpty
              ? widget.availableModes.first
              : 'sea');
    if (widget.itemLabel.isNotEmpty) {
      _descriptionController.text = widget.itemLabel;
    }
  }

  @override
  void dispose() {
    _descriptionController.dispose();
    _weightController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    if (FirebaseAuth.instance.currentUser == null) {
      Navigator.pushNamed(context, '/login');
      return;
    }
    final description = _descriptionController.text.trim();
    if (description.isEmpty) {
      _snack(l10n.freightQuoteDescriptionRequired);
      return;
    }
    setState(() => _busy = true);
    try {
      final result = await _service.createRequest(
        destinationCountryId: widget.destinationCountryId,
        mode: _mode,
        description: description,
        weightKg: double.tryParse(_weightController.text.trim()) ?? 0,
        itemCategoryId: widget.itemCategoryId,
        itemLabel: widget.itemLabel,
      );
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(
          builder: (_) => FreightQuoteDetailsScreen(
            requestId: result.id,
            trackingCode: result.trackingCode,
            eligibleBusinessCount: result.eligibleBusinessCount,
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      // The server refuses in its own words - only it has read which
      // businesses serve this route - so its sentence is shown verbatim.
      _snack(_serverRefusal(error) ?? l10n.freightQuoteRequestFailed);
    }
  }

  String? _serverRefusal(Object error) {
    if (error is! FirebaseFunctionsException) return null;
    if (error.code != 'failed-precondition' &&
        error.code != 'invalid-argument') {
      return null;
    }
    final message = (error.message ?? '').trim();
    return message.isEmpty ? null : message;
  }

  void _snack(String message) => ScaffoldMessenger.of(
    context,
  ).showSnackBar(SnackBar(content: Text(message)));

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.freightAskForPriceTitle)),
      body: ListView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
        children: [
          Text(
            l10n.freightAskForPriceIntro(widget.destinationCountryName),
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.hintColor,
            ),
          ),
          const SizedBox(height: 18),
          TextField(
            controller: _descriptionController,
            enabled: !_busy,
            minLines: 3,
            maxLines: 6,
            maxLength: _maxDescriptionLength,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: l10n.freightQuoteDescriptionLabel,
              hintText: l10n.freightQuoteDescriptionHint,
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _weightController,
            enabled: !_busy,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              labelText: l10n.freightQuoteWeightLabel,
              helperText: l10n.freightQuoteWeightHelper,
              helperMaxLines: 2,
              prefixIcon: const Icon(Icons.scale_outlined),
            ),
          ),
          if (widget.availableModes.length > 1) ...[
            const SizedBox(height: 18),
            Text(l10n.shippingMode, style: theme.textTheme.labelLarge),
            const SizedBox(height: 6),
            for (final mode in widget.availableModes)
              RadioListTile<String>(
                value: mode,
                // ignore: deprecated_member_use
                groupValue: _mode,
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(
                  mode == 'air' ? l10n.airFreight : l10n.seaFreight,
                ),
                // ignore: deprecated_member_use
                onChanged: _busy
                    ? null
                    : (value) => setState(() => _mode = value ?? _mode),
              ),
          ],
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: _busy || _descriptionController.text.trim().isEmpty
                ? null
                : _submit,
            icon: _busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.price_change_outlined),
            label: Text(
              _busy ? l10n.freightQuoteSending : l10n.freightQuoteSendRequest,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            l10n.freightAskForPriceNote,
            style: theme.textTheme.bodySmall?.copyWith(color: theme.hintColor),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
