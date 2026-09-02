import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/guest_checkout_service.dart';

/// Asks a customer who has no account for the details a booking needs, then
/// starts an anonymous session so the booking has an identity.
///
/// Returns true when the guest session is ready and the caller should carry
/// on with the submission that opened this sheet.
Future<bool> showGuestCheckoutSheet(
  BuildContext context, {
  GuestCheckoutSession? session,
  VoidCallback? onUseAccount,
  String initialName = '',
}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (sheetContext) => _GuestCheckoutSheet(
      session: session ?? guestCheckout,
      onUseAccount: onUseAccount,
      initialName: initialName,
    ),
  );
  return result ?? false;
}

class _GuestCheckoutSheet extends StatefulWidget {
  const _GuestCheckoutSheet({
    required this.session,
    this.onUseAccount,
    this.initialName = '',
  });

  final GuestCheckoutSession session;
  final VoidCallback? onUseAccount;

  /// The sender name the form already collected. A guest asked to retype
  /// their own name reads the sheet as the screen having lost their work.
  final String initialName;

  @override
  State<_GuestCheckoutSheet> createState() => _GuestCheckoutSheetState();
}

class _GuestCheckoutSheetState extends State<_GuestCheckoutSheet> {
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  bool _submitting = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _nameController.text = widget.initialName.trim();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  List<GuestContactField> get _problems => guestContactProblems(
    name: _nameController.text,
    email: _emailController.text,
    phone: _phoneController.text,
  );

  Future<void> _submit() async {
    if (_submitting) return;
    final l10n = AppLocalizations.of(context)!;
    // Validate through the form so every unusable field is marked at once
    // rather than one per attempt.
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _submitting = true;
      _error = '';
    });
    try {
      await widget.session.begin(
        normalizeGuestContact(
          name: _nameController.text,
          email: _emailController.text,
          phone: _phoneController.text,
        ),
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = l10n.guestCheckoutFailed;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                l10n.guestCheckoutTitle,
                style: theme.textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Text(
                l10n.guestCheckoutIntro,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 20),
              TextFormField(
                // Re-checks as the customer types once they have touched the
                // field, so a message clears the moment it stops being true.
                autovalidateMode: AutovalidateMode.onUserInteraction,
                autofillHints: const [AutofillHints.name],
                controller: _nameController,
                decoration: InputDecoration(
                  labelText: l10n.guestCheckoutFullName,
                ),
                enabled: !_submitting,
                textInputAction: TextInputAction.next,
                validator: (_) => _problems.contains(GuestContactField.name)
                    ? l10n.guestCheckoutNameError
                    : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                // Re-checks as the customer types once they have touched the
                // field, so a message clears the moment it stops being true.
                autovalidateMode: AutovalidateMode.onUserInteraction,
                autofillHints: const [AutofillHints.email],
                controller: _emailController,
                decoration: InputDecoration(
                  labelText: l10n.guestCheckoutEmail,
                ),
                enabled: !_submitting,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                validator: (_) => _problems.contains(GuestContactField.email)
                    ? l10n.guestCheckoutEmailError
                    : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                // Re-checks as the customer types once they have touched the
                // field, so a message clears the moment it stops being true.
                autovalidateMode: AutovalidateMode.onUserInteraction,
                autofillHints: const [AutofillHints.telephoneNumber],
                controller: _phoneController,
                decoration: InputDecoration(
                  labelText: l10n.guestCheckoutPhone,
                ),
                enabled: !_submitting,
                keyboardType: TextInputType.phone,
                validator: (_) => _problems.contains(GuestContactField.phone)
                    ? l10n.guestCheckoutPhoneError
                    : null,
              ),
              if (_error.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  _error,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.error,
                  ),
                ),
              ],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(
                        height: 18,
                        width: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(l10n.guestCheckoutContinue),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: _submitting
                    ? null
                    : () {
                        Navigator.of(context).pop(false);
                        widget.onUseAccount?.call();
                      },
                child: Text(l10n.guestCheckoutUseAccount),
              ),
              const SizedBox(height: 4),
              Text(
                l10n.guestCheckoutNote,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
