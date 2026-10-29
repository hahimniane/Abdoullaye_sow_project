import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/package_request_service.dart';
import '../services/package_requests.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import 'lot_sheets.dart';
import 'package_request_widgets.dart' show requestRefusalText;

/// "Enter the customer's code" at the counter (docs/AIR_PACKAGES.md §1.9,
/// §4.10): the customer pre-declared online and brought `R-XXXXX`; staff
/// type it (with or without the dash or spaces) and the request is looked
/// up for this business. Answers the request, or null when dismissed; the
/// caller opens the same Received sheet an Expected card opens.
Future<PackageRequest?> showRequestCodeLookupSheet(
  BuildContext context, {
  required String businessId,
  required PackageRequestService service,
}) => showLotSheet<PackageRequest>(
  context,
  RequestCodeLookupSheet(businessId: businessId, service: service),
);

class RequestCodeLookupSheet extends StatefulWidget {
  const RequestCodeLookupSheet({
    super.key,
    required this.businessId,
    required this.service,
  });

  final String businessId;
  final PackageRequestService service;

  @override
  State<RequestCodeLookupSheet> createState() => _RequestCodeLookupSheetState();
}

class _RequestCodeLookupSheetState extends State<RequestCodeLookupSheet> {
  final _code = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _find() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    final code = normalizeRequestCode(_code.text);
    if (code.isEmpty) {
      AppHaptics.refuse();
      setState(() => _error = l10n.lookupCodeInvalid);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final request = await widget.service.lookupByCode(
        businessId: widget.businessId,
        code: code,
      );
      if (!mounted) return;
      Navigator.of(context).pop(request);
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = requestRefusalText(l10n, failure.refusal));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return LotSheetShell(
      title: l10n.lookupTitle,
      subtitle: l10n.lookupHint,
      body: TextField(
        key: const Key('lookup-code'),
        controller: _code,
        enabled: !_busy,
        autofocus: true,
        autocorrect: false,
        textCapitalization: TextCapitalization.characters,
        textInputAction: TextInputAction.search,
        onChanged: (_) {
          if (_error != null) setState(() => _error = null);
        },
        onSubmitted: (_) => _find(),
        decoration: InputDecoration(
          labelText: l10n.lookupCodeLabel,
          hintText: 'R-XXXXX',
          errorText: _error,
          errorMaxLines: 3,
          prefixIcon: const Icon(
            Icons.confirmation_number_outlined,
            size: 20,
            color: AppColors.muted,
          ),
        ),
      ),
      footer: Padding(
        padding: EdgeInsets.zero,
        child: LotSheetButton(
          key: const Key('lookup-find'),
          label: l10n.lookupFind,
          busy: _busy,
          busyLabel: l10n.lookupFinding,
          tone: LotTone.good,
          onTap: _find,
        ),
      ),
    );
  }
}

/// A small row offering the look-up, above the Waiting list.
class RequestCodeLookupRow extends StatelessWidget {
  const RequestCodeLookupRow({super.key, required this.onTap});

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: OutlinedButton.icon(
        key: const Key('waiting-lookup-code'),
        onPressed: onTap,
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(0, 44),
          alignment: Alignment.centerLeft,
        ),
        icon: const Icon(Icons.confirmation_number_outlined, size: 18),
        label: Text(
          l10n.lookupTitle,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
  }
}
