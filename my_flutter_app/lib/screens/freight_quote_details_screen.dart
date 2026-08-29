import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/freight_quote.dart';
import '../services/freight_quote_service.dart';
import '../utils/freight_localization.dart';
import 'send_freight_screen.dart';

/// The prices businesses have sent back for one parcel, as they arrive.
///
/// The same marketplace shape as `transport_request_details_screen.dart`: one
/// request, many answers, and the customer takes one. What is different is the
/// second line on every card - a business quoting an item outside its
/// published table states whether it makes good on the parcel, and one that
/// will not says so here, where it can still be passed over. That line never
/// carries a sum: cover is a yes or a no, and it is free either way.
class FreightQuoteDetailsScreen extends StatefulWidget {
  const FreightQuoteDetailsScreen({
    super.key,
    required this.requestId,
    this.trackingCode = '',
    this.eligibleBusinessCount = 0,
  });

  final String requestId;
  final String trackingCode;

  /// How many businesses the question reached, known from the moment it was
  /// sent so the customer is not left wondering whether anyone heard it.
  final int eligibleBusinessCount;

  @override
  State<FreightQuoteDetailsScreen> createState() =>
      _FreightQuoteDetailsScreenState();
}

class _FreightQuoteDetailsScreenState extends State<FreightQuoteDetailsScreen> {
  final _service = FreightQuoteService();
  String _selectingQuoteId = '';
  String _error = '';

  Future<void> _select(FreightQuote quote) async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.confirmFreightQuoteTitle(quote.businessName)),
        content: Text(
          l10n.confirmFreightQuoteMessage(
            quote.businessName,
            freightMoney(quote.amount),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.keepComparing),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.chooseThisBusiness),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _selectingQuoteId = quote.id;
      _error = '';
    });
    try {
      await _service.selectQuote(
        requestId: widget.requestId,
        quoteId: quote.id,
      );
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = l10n.couldNotSelectFreightQuote);
    } finally {
      if (mounted) setState(() => _selectingQuoteId = '');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.freightQuotesTitle)),
      body: StreamBuilder<FreightQuoteRequest?>(
        stream: _service.watchRequest(widget.requestId),
        builder: (context, requestSnapshot) {
          final request = requestSnapshot.data;
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
            children: [
              _header(theme, l10n, request),
              if (_error.isNotEmpty) ...[
                const SizedBox(height: 14),
                Text(
                  _error,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.error,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
              const SizedBox(height: 16),
              _quotes(theme, l10n, request),
            ],
          );
        },
      ),
    );
  }

  Widget _header(
    ThemeData theme,
    AppLocalizations l10n,
    FreightQuoteRequest? request,
  ) {
    final code = request?.trackingCode.isNotEmpty == true
        ? request!.trackingCode
        : widget.trackingCode;
    final asked = request?.eligibleBusinessCount ?? widget.eligibleBusinessCount;
    return Card(
      margin: EdgeInsets.zero,
      elevation: 0,
      color: theme.colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.check_circle,
                  color: theme.colorScheme.primary,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Text(
                  l10n.freightQuoteRequestSent,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            if (asked > 0) ...[
              const SizedBox(height: 4),
              Text(
                l10n.freightQuoteRequestSentSubtitle(asked),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.hintColor,
                ),
              ),
            ],
            if (code.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                l10n.freightQuoteRequestReference(code),
                style: theme.textTheme.labelMedium?.copyWith(
                  color: theme.hintColor,
                ),
              ),
            ],
            if ((request?.description ?? '').isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                request!.description,
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
            if ((request?.destinationCountryName ?? '').isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(
                l10n.toDestination(request!.destinationCountryName),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.hintColor,
                ),
              ),
            ],

          ],
        ),
      ),
    );
  }

  Widget _quotes(
    ThemeData theme,
    AppLocalizations l10n,
    FreightQuoteRequest? request,
  ) {
    return StreamBuilder<List<FreightQuote>>(
      stream: _service.watchQuotes(widget.requestId),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return _notice(
            theme,
            Icons.cloud_off_outlined,
            l10n.couldNotLoadFreightQuotes,
            l10n.couldNotLoadFreightQuotesSubtitle,
          );
        }
        if (!snapshot.hasData) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 32),
            child: Center(child: CircularProgressIndicator()),
          );
        }
        final quotes = snapshot.data!;
        final chosen = quotes.where((q) => q.isSelected).toList();
        if (chosen.isNotEmpty || request?.isSelected == true) {
          final winner = chosen.isNotEmpty ? chosen.first : null;
          final businessId =
              winner?.businessId ?? request?.selectedBusinessId ?? '';
          final amountCents =
              winner?.amountCents ?? request?.selectedAmountCents ?? 0;
          // Accepting a price used to end here, on a notice with nowhere to
          // go: the price was agreed and the customer had no way to book it
          // or pay. Selecting fixes the price; the parcel still needs a
          // receiver, an address and a pickup choice, so this carries them
          // into the booking that collects those.
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _notice(
                theme,
                Icons.verified_outlined,
                l10n.freightQuoteChosenTitle,
                l10n.freightQuoteChosenMessage(
                  winner?.businessName ?? request!.selectedBusinessName,
                  freightMoney(amountCents / 100),
                ),
              ),
              const SizedBox(height: 14),
              Text(
                l10n.freightQuoteChosenNext,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.hintColor,
                ),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => SendFreightScreen(
                      quoteRequestId: widget.requestId,
                      agreedBusinessId: businessId,
                      agreedAmountCents: amountCents,
                    ),
                  ),
                ),
                icon: const Icon(Icons.arrow_forward),
                label: Text(l10n.continueToBooking),
              ),
            ],
          );
        }
        final open = quotes
            .where((quote) => quote.isSubmitted && !quote.isExpired)
            .toList();
        if (open.isEmpty) {
          return _notice(
            theme,
            Icons.schedule_outlined,
            l10n.waitingForFreightQuotes,
            l10n.waitingForFreightQuotesSubtitle,
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              l10n.freightQuotesIntro,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.hintColor,
              ),
            ),
            const SizedBox(height: 12),
            for (final quote in open) ...[
              _FreightQuoteCard(
                quote: quote,
                selecting: _selectingQuoteId == quote.id,
                onSelect: _selectingQuoteId.isEmpty
                    ? () => _select(quote)
                    : null,
              ),
              if (quote != open.last) const SizedBox(height: 12),
            ],
          ],
        );
      },
    );
  }

  Widget _notice(
    ThemeData theme,
    IconData icon,
    String title,
    String message,
  ) {
    return Card(
      margin: EdgeInsets.zero,
      elevation: 0,
      color: theme.colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: theme.colorScheme.primary),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  if (message.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      message,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.hintColor,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One business's answer: what it charges, and whether it stands behind the
/// parcel if it never arrives.
class _FreightQuoteCard extends StatelessWidget {
  const _FreightQuoteCard({
    required this.quote,
    required this.selecting,
    required this.onSelect,
  });

  final FreightQuote quote;
  final bool selecting;
  final VoidCallback? onSelect;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context)!;
    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    quote.businessName,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                Text(
                  freightMoney(quote.amount),
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w900,
                    color: theme.colorScheme.primary,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            // The customer is choosing on this as much as on the price, so it
            // sits on the card rather than behind a tap.
            Row(
              children: [
                Icon(
                  quote.coversLoss
                      ? Icons.verified_user_outlined
                      : Icons.gpp_maybe_outlined,
                  size: 18,
                  color: quote.coversLoss
                      ? theme.colorScheme.primary
                      : theme.hintColor,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    // The price is the only figure on this card. A sum beside
                    // cover turns a reassurance into the number a customer
                    // expects to argue over.
                    quote.coversLoss
                        ? l10n.freightQuoteCoversLoss(quote.businessName)
                        : l10n.freightQuoteDoesNotCoverLoss(quote.businessName),
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: quote.coversLoss
                          ? theme.colorScheme.onSurface
                          : theme.hintColor,
                      fontWeight: quote.coversLoss
                          ? FontWeight.w700
                          : FontWeight.w400,
                    ),
                  ),
                ),
              ],
            ),
            if (quote.terms.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(quote.terms, style: theme.textTheme.bodySmall),
            ],
            const SizedBox(height: 14),
            FilledButton(
              onPressed: selecting ? null : onSelect,
              child: Text(
                selecting
                    ? l10n.selectingFreightQuote
                    : l10n.selectFreightQuote,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
