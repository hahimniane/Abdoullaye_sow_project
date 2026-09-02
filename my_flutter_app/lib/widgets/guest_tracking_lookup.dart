import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/guest_tracking_result.dart';
import '../screens/freight_quote_details_screen.dart';
import '../services/guest_tracking_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'app_back_button.dart';
import 'app_card.dart';
import 'async_action_button.dart';
import 'language_toggle.dart';

enum _GuestLookupMessage { rateLimited, unavailable }

class GuestTrackingLookup extends StatefulWidget {
  const GuestTrackingLookup({
    super.key,
    required this.onSignIn,
    this.service,
    this.showBackButton = false,
    this.initialCode,
  });

  final GuestTrackingLookupService? service;

  /// Null when the caller is already signed in - the sign-in upsell would
  /// only ask for what they already have.
  final VoidCallback? onSignIn;
  final bool showBackButton;

  /// A tracking code to look up immediately, for a caller that already knows
  /// it - a guest tapping their own order. Without this they land on an
  /// empty search being asked for a number the app was already holding.
  final String? initialCode;

  @override
  State<GuestTrackingLookup> createState() => _GuestTrackingLookupState();
}

class _GuestTrackingLookupState extends State<GuestTrackingLookup> {
  final TextEditingController _controller = TextEditingController();
  GuestTrackingLookupService? _service;
  GuestTrackingResult? _result;
  _GuestLookupMessage? _message;
  String? _fieldError;
  bool _submitting = false;

  GuestTrackingLookupService get _lookupService =>
      widget.service ?? (_service ??= FirebaseGuestTrackingService());

  @override
  void initState() {
    super.initState();
    final code = widget.initialCode?.trim() ?? '';
    if (code.isNotEmpty) {
      _controller.text = code;
      // After the first frame: _submit reads AppLocalizations off context,
      // which is not available during initState.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _submit();
      });
    }
  }

  @override
  void didUpdateWidget(covariant GuestTrackingLookup oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.service != widget.service) _service = null;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// Moves the price request into this device's session and opens it.
  /// Returns null on success, or the message to show beside the field.
  Future<String?> _claimQuoteRequest(String trackingCode, String email) async {
    final l10n = AppLocalizations.of(context)!;
    try {
      final requestId = await _lookupService.claimQuoteRequest(
        trackingCode: trackingCode,
        email: email,
      );
      if (!mounted) return null;
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => FreightQuoteDetailsScreen(
            requestId: requestId,
            trackingCode: trackingCode,
          ),
        ),
      );
      return null;
    } on GuestTrackingFailure {
      return l10n.guestQuoteClaimFailed;
    } catch (_) {
      return l10n.guestQuoteClaimFailed;
    }
  }

  Future<void> _submit() async {
    if (_submitting) return;
    final l10n = AppLocalizations.of(context)!;
    final identifier = _controller.text.trim();
    if (identifier.isEmpty) {
      setState(() {
        _fieldError = l10n.guestTrackingRequired;
        _message = null;
      });
      return;
    }
    if (!_looksLikeTrackingIdentifier(identifier)) {
      setState(() {
        _fieldError = l10n.guestTrackingInvalid;
        _message = null;
      });
      return;
    }

    FocusScope.of(context).unfocus();
    setState(() {
      _submitting = true;
      _fieldError = null;
      _message = null;
      _result = null;
    });
    try {
      final result = await _lookupService.lookup(identifier);
      if (!mounted) return;
      setState(() => _result = result);
    } on GuestTrackingFailure catch (error) {
      if (!mounted) return;
      setState(() {
        switch (error.kind) {
          case GuestTrackingFailureKind.invalid:
            _fieldError = l10n.guestTrackingInvalid;
          case GuestTrackingFailureKind.rateLimited:
            _message = _GuestLookupMessage.rateLimited;
          case GuestTrackingFailureKind.unavailable:
            _message = _GuestLookupMessage.unavailable;
        }
      });
    } catch (_) {
      if (mounted) {
        setState(() => _message = _GuestLookupMessage.unavailable);
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _trackAnother() {
    setState(() {
      _controller.clear();
      _result = null;
      _message = null;
      _fieldError = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ListView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.xl,
      ),
      children: [
        Row(
          children: [
            if (widget.showBackButton) ...[
              const AppBackButton(),
              const SizedBox(width: AppSpacing.xs),
            ],
            Expanded(
              child: Text(
                l10n.trackShipment,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            const LanguageToggle(),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        l10n.guestTrackingIntro,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: AppColors.lightMuted,
                          height: 1.4,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      TextField(
                        controller: _controller,
                        autofocus: false,
                        autocorrect: false,
                        enableSuggestions: false,
                        inputFormatters: const [_UpperCaseTextFormatter()],
                        textCapitalization: TextCapitalization.characters,
                        textInputAction: TextInputAction.search,
                        onChanged: (_) {
                          if (_fieldError != null || _message != null) {
                            setState(() {
                              _fieldError = null;
                              _message = null;
                            });
                          }
                        },
                        onSubmitted: (_) => _submit(),
                        decoration: InputDecoration(
                          labelText: l10n.guestTrackingIdentifierLabel,
                          hintText: l10n.guestTrackingIdentifierHint,
                          errorText: _fieldError,
                          prefixIcon: const Icon(
                            Icons.confirmation_number_outlined,
                          ),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      SizedBox(
                        width: double.infinity,
                        child: AsyncActionButton.filled(
                          onPressed: _submitting ? null : _submit,
                          label: l10n.guestTrackingSubmit,
                          loadingLabel: l10n.guestTrackingLoading,
                          icon: Icons.search,
                        ),
                      ),
                    ],
                  ),
                ),
                if (_message != null) ...[
                  const SizedBox(height: AppSpacing.md),
                  _GuestMessageCard(
                    icon: _message == _GuestLookupMessage.rateLimited
                        ? Icons.timer_outlined
                        : Icons.cloud_off_outlined,
                    message: _message == _GuestLookupMessage.rateLimited
                        ? l10n.guestTrackingRateLimited
                        : l10n.guestTrackingUnavailable,
                  ),
                ],
                if (_result != null) ...[
                  const SizedBox(height: AppSpacing.md),
                  if (_result!.found)
                    _GuestTrackingSuccess(
                      record: _result!.record!,
                      onSignIn: widget.onSignIn,
                      onTrackAnother: _trackAnother,
                      onClaim: _claimQuoteRequest,
                    )
                  else
                    _GuestTrackingNotFound(onTrackAnother: _trackAnother),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _GuestTrackingSuccess extends StatelessWidget {
  const _GuestTrackingSuccess({
    required this.record,
    required this.onSignIn,
    required this.onTrackAnother,
    required this.onClaim,
  });

  final GuestTrackingRecord record;
  final VoidCallback? onSignIn;
  final VoidCallback onTrackAnother;
  final Future<String?> Function(String trackingCode, String email) onClaim;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = Localizations.localeOf(context).toLanguageTag();
    final updatedAt = record.updatedAt;
    final updatedLabel = updatedAt == null
        ? null
        : l10n.guestTrackingUpdatedLabel(
            DateFormat.yMMMd(locale).add_jm().format(updatedAt.toLocal()),
          );

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.check_circle_outline, color: AppColors.sage),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  l10n.guestTrackingSuccessTitle,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          SelectableText(
            record.trackingCode,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              color: AppColors.cobaltDeep,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          _GuestFact(
            label: l10n.guestTrackingServiceLabel,
            value: _serviceLabel(l10n, record.service),
          ),
          const SizedBox(height: AppSpacing.sm),
          _GuestFact(
            label: l10n.guestTrackingStatusLabel,
            value: _stageLabel(l10n, record.stage),
          ),
          if (record.service == GuestTrackingServiceType.freightQuote) ...[
            const SizedBox(height: AppSpacing.md),
            _GuestQuoteClaim(
              quoteCount: record.quoteCount,
              onClaim: (email) => onClaim(record.trackingCode, email),
            ),
          ],
          if (updatedLabel != null) ...[
            const SizedBox(height: AppSpacing.md),
            Text(
              updatedLabel,
              style: Theme.of(
                context,
              ).textTheme.bodySmall?.copyWith(color: AppColors.lightMuted),
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
          Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.lightSurfaceVariant,
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.privacy_tip_outlined,
                  color: AppColors.cobaltDeep,
                  size: 20,
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    l10n.guestTrackingPrivacyNote,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: AppColors.lightMuted,
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          AsyncActionButton.outlined(
            onPressed: onTrackAnother,
            label: l10n.guestTrackingTrackAnother,
            icon: Icons.search,
          ),
          if (onSignIn != null) ...[
            const SizedBox(height: AppSpacing.sm),
            AsyncActionButton.filled(
              onPressed: onSignIn,
              label: l10n.guestTrackingSignInUpsell,
              icon: Icons.login,
            ),
          ],
        ],
      ),
    );
  }
}

class _GuestTrackingNotFound extends StatelessWidget {
  const _GuestTrackingNotFound({required this.onTrackAnother});

  final VoidCallback onTrackAnother;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Icon(
            Icons.search_off_outlined,
            color: AppColors.lightMuted,
            size: 32,
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            l10n.guestTrackingNotFoundTitle,
            textAlign: TextAlign.center,
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            l10n.guestTrackingNotFoundBody,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: AppColors.lightMuted,
              height: 1.4,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          AsyncActionButton.outlined(
            onPressed: onTrackAnother,
            label: l10n.guestTrackingTrackAnother,
            icon: Icons.refresh,
          ),
        ],
      ),
    );
  }
}

class _GuestMessageCard extends StatelessWidget {
  const _GuestMessageCard({required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: AppColors.warn),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}

class _GuestFact extends StatelessWidget {
  const _GuestFact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 72,
          child: Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: AppColors.lightMuted,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Text(
            value,
            style: Theme.of(
              context,
            ).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w800),
          ),
        ),
      ],
    );
  }
}

class _UpperCaseTextFormatter extends TextInputFormatter {
  const _UpperCaseTextFormatter();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    return newValue.copyWith(text: newValue.text.toUpperCase());
  }
}

bool _looksLikeTrackingIdentifier(String value) {
  return value.length >= 4 &&
      value.length <= 64 &&
      RegExp(r'^[A-Z0-9\s-]+$').hasMatch(value);
}

String _serviceLabel(AppLocalizations l10n, GuestTrackingServiceType service) {
  return switch (service) {
    GuestTrackingServiceType.barrel => l10n.guestTrackingServiceBarrel,
    GuestTrackingServiceType.freight => l10n.guestTrackingServiceFreight,
    GuestTrackingServiceType.transport => l10n.guestTrackingServiceTransport,
    GuestTrackingServiceType.parking => l10n.guestTrackingServiceParking,
    GuestTrackingServiceType.sharedBarrel =>
      l10n.guestTrackingServiceSharedBarrel,
    GuestTrackingServiceType.freightQuote =>
      l10n.guestTrackingServiceFreightQuote,
  };
}

String _stageLabel(AppLocalizations l10n, GuestTrackingStage stage) {
  return switch (stage) {
    GuestTrackingStage.awaitingPayment =>
      l10n.guestTrackingStageAwaitingPayment,
    GuestTrackingStage.booked => l10n.guestTrackingStageBooked,
    GuestTrackingStage.inTransit => l10n.guestTrackingStageInTransit,
    GuestTrackingStage.arrived => l10n.guestTrackingStageArrived,
    GuestTrackingStage.delivered => l10n.guestTrackingStageDelivered,
    GuestTrackingStage.cancelled => l10n.guestTrackingStageCancelled,
  };
}

/// A price request's public state, and the one proof that opens it: the
/// email the customer gave with it. Claiming moves the request into this
/// device's session, where the details screen shows prices and books.
class _GuestQuoteClaim extends StatefulWidget {
  const _GuestQuoteClaim({required this.quoteCount, required this.onClaim});

  final int quoteCount;
  final Future<String?> Function(String email) onClaim;

  @override
  State<_GuestQuoteClaim> createState() => _GuestQuoteClaimState();
}

class _GuestQuoteClaimState extends State<_GuestQuoteClaim> {
  final _emailController = TextEditingController();
  bool _busy = false;
  String _error = '';

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _claim() async {
    final l10n = AppLocalizations.of(context)!;
    final email = _emailController.text.trim();
    if (!email.contains('@')) {
      setState(() => _error = l10n.guestQuoteClaimFailed);
      return;
    }
    setState(() {
      _busy = true;
      _error = '';
    });
    final failure = await widget.onClaim(email);
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = failure ?? '';
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          widget.quoteCount > 0
              ? widget.quoteCount == 1
                    ? l10n.guestQuoteOneAnswer
                    : l10n.guestQuoteManyAnswers(widget.quoteCount)
              : l10n.guestQuoteNoAnswers,
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: widget.quoteCount > 0 ? FontWeight.w700 : null,
          ),
        ),
        if (widget.quoteCount > 0) ...[
          const SizedBox(height: 4),
          Text(
            l10n.guestQuoteSeeHint,
            style: theme.textTheme.bodySmall?.copyWith(
              color: AppColors.lightMuted,
            ),
          ),
        ],
        const SizedBox(height: AppSpacing.sm),
        TextField(
          controller: _emailController,
          enabled: !_busy,
          keyboardType: TextInputType.emailAddress,
          autofillHints: const [AutofillHints.email],
          decoration: InputDecoration(
            labelText: l10n.guestQuoteEmailLabel,
            errorText: _error.isEmpty ? null : _error,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        FilledButton(
          onPressed: _busy ? null : _claim,
          child: _busy
              ? const SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(
                  widget.quoteCount > 0
                      ? l10n.guestQuoteSeePrices
                      : l10n.guestQuoteOpenRequest,
                ),
        ),
      ],
    );
  }
}
