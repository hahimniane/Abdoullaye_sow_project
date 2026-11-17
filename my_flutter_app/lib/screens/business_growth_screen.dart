import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../services/business_growth.dart';
import '../theme/app_colors.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';

/// Opens the payment page the Pro checkout returned. Replaced in tests.
typedef GrowthLinkOpener = Future<bool> Function(Uri uri);

Future<bool> _openExternally(Uri uri) =>
    launchUrl(uri, mode: LaunchMode.externalApplication);

/// The console's Growth page on the phone: the plan (Free / Pro, with the
/// Pro checkout opened in the browser), the AI advisor's "Generate insights",
/// and the cards of its newest runs. Reached from the business tools for
/// whoever holds the `growth` permission (the owner and full-access staff
/// always); only the owner can start the subscription, as on the server.
class BusinessGrowthScreen extends StatefulWidget {
  const BusinessGrowthScreen({
    super.key,
    required this.businessId,
    this.canUpgrade = true,
    this.source,
    this.openLink = _openExternally,
  });

  final String businessId;

  /// Whether this person may start the Pro subscription (the owner).
  final bool canUpgrade;
  final BusinessGrowthSource? source;
  final GrowthLinkOpener openLink;

  /// Where the payment page returns to: the business console.
  static const String returnUrl = 'https://business.laawoldigital.com/';

  @override
  State<BusinessGrowthScreen> createState() => _BusinessGrowthScreenState();
}

class _BusinessGrowthScreenState extends State<BusinessGrowthScreen> {
  late final BusinessGrowthSource _source =
      widget.source ?? FirebaseBusinessGrowthSource();

  StreamSubscription<Map<String, dynamic>?>? _businessSub;
  StreamSubscription<List<GrowthInsight>>? _insightSub;
  Timer? _safety;

  GrowthPlan _plan = const GrowthPlan.free();
  List<GrowthCardEntry> _entries = const [];
  bool _planLoaded = false;
  bool _insightsLoaded = false;
  bool _loadFailed = false;

  bool _checkoutBusy = false;
  bool _generateBusy = false;
  String _message = '';
  bool _messageIsError = false;

  bool get _loading => !(_planLoaded && _insightsLoaded) && !_loadFailed;

  @override
  void initState() {
    super.initState();
    // A read that never answers stops spinning after a while.
    _safety = Timer(const Duration(seconds: 15), () {
      if (mounted && _loading) {
        setState(() {
          _planLoaded = true;
          _insightsLoaded = true;
        });
      }
    });
    _listen();
  }

  void _listen() {
    _businessSub?.cancel();
    _insightSub?.cancel();
    try {
      _businessSub = _source.watchBusiness(widget.businessId).listen((data) {
        if (!mounted) return;
        setState(() {
          _plan = GrowthPlan.fromBusiness(data);
          _planLoaded = true;
        });
      }, onError: (_) => _failed());
      _insightSub = _source.watchInsights(widget.businessId).listen((rows) {
        if (!mounted) return;
        setState(() {
          _entries = growthCardEntries(rows);
          _insightsLoaded = true;
        });
      }, onError: (_) => _failed());
    } catch (_) {
      _failed();
    }
  }

  void _failed() {
    if (!mounted) return;
    _safety?.cancel();
    setState(() {
      _loadFailed = true;
      _planLoaded = true;
      _insightsLoaded = true;
    });
  }

  @override
  void dispose() {
    _safety?.cancel();
    _businessSub?.cancel();
    _insightSub?.cancel();
    super.dispose();
  }

  String _failureText(AppLocalizations l10n, GrowthFailure failure) =>
      switch (failure) {
        GrowthFailure.checkoutOwnerOnly => l10n.extGrowthErrCheckoutOwner,
        GrowthFailure.checkoutNotSetUp => l10n.extGrowthErrCheckoutSetup,
        GrowthFailure.advisorNeedsPro => l10n.extGrowthErrAdvisorPro,
        GrowthFailure.noAccess => l10n.extGrowthErrNoAccess,
        GrowthFailure.generic => l10n.extGrowthErrGeneric,
      };

  void _say(String text, {bool error = false}) {
    setState(() {
      _message = text;
      _messageIsError = error;
    });
  }

  Future<void> _checkout() async {
    final l10n = AppLocalizations.of(context)!;
    if (_checkoutBusy) return;
    setState(() {
      _checkoutBusy = true;
      _message = '';
    });
    try {
      final url = await _source.startProCheckout(
        businessId: widget.businessId,
        successUrl: BusinessGrowthScreen.returnUrl,
        cancelUrl: BusinessGrowthScreen.returnUrl,
      );
      final opened = await widget.openLink(Uri.parse(url));
      if (!mounted) return;
      _say(
        opened ? l10n.extGrowthCheckoutOpened : l10n.extGrowthOpenFailed,
        error: !opened,
      );
    } on GrowthException catch (e) {
      if (!mounted) return;
      _say(_failureText(l10n, e.failure), error: true);
    } catch (_) {
      if (!mounted) return;
      _say(l10n.extGrowthErrGeneric, error: true);
    } finally {
      if (mounted) setState(() => _checkoutBusy = false);
    }
  }

  Future<void> _generate() async {
    final l10n = AppLocalizations.of(context)!;
    if (_generateBusy) return;
    setState(() {
      _generateBusy = true;
      _message = '';
    });
    try {
      await _source.generateInsights(widget.businessId);
      if (!mounted) return;
      _say(l10n.extGrowthGenerated);
      showSuccessSnackBar(context, l10n.extGrowthGenerated);
    } on GrowthException catch (e) {
      if (!mounted) return;
      _say(_failureText(l10n, e.failure), error: true);
    } catch (_) {
      if (!mounted) return;
      _say(l10n.extGrowthErrGeneric, error: true);
    } finally {
      if (mounted) setState(() => _generateBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: AppColors.cream,
      appBar: AppBar(title: Text(l10n.extGrowthTitle)),
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                key: const Key('growth-list'),
                padding: const EdgeInsets.all(16),
                children: [
                  Text(
                    l10n.extGrowthSubtitle,
                    style: const TextStyle(color: AppColors.muted, height: 1.4),
                  ),
                  const SizedBox(height: 16),
                  if (_loadFailed) ...[
                    Text(
                      l10n.extGrowthLoadFailed,
                      key: const Key('growth-load-failed'),
                      style: const TextStyle(
                        color: AppColors.errorRed,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: TextButton(
                        key: const Key('growth-retry'),
                        onPressed: () {
                          setState(() {
                            _loadFailed = false;
                            _planLoaded = false;
                            _insightsLoaded = false;
                          });
                          _listen();
                        },
                        child: Text(l10n.retry),
                      ),
                    ),
                    const SizedBox(height: 8),
                  ],
                  _PlanCard(
                    key: const Key('growth-plan-free'),
                    title: l10n.extGrowthFreeTitle,
                    heading: l10n.extGrowthFreeBody,
                    badge: _plan.isPro ? null : l10n.extGrowthCurrentPlan,
                  ),
                  const SizedBox(height: 12),
                  _PlanCard(
                    key: const Key('growth-plan-pro'),
                    title: l10n.extGrowthProTitle,
                    heading: l10n.extGrowthProBody,
                    badge: _plan.isPro ? l10n.extGrowthActive : null,
                    action: _plan.isPro
                        ? null
                        : widget.canUpgrade
                        ? FilledButton.icon(
                            key: const Key('growth-upgrade'),
                            onPressed: _checkoutBusy ? null : _checkout,
                            icon: _checkoutBusy
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.workspace_premium_outlined),
                            label: Text(l10n.extGrowthUpgrade),
                          )
                        : Text(
                            l10n.extGrowthUpgradeOwnerOnly,
                            key: const Key('growth-owner-only'),
                            style: const TextStyle(
                              color: AppColors.muted,
                              fontSize: 13,
                              height: 1.35,
                            ),
                          ),
                  ),
                  const SizedBox(height: 16),
                  _AdvisorCard(
                    enabled: _plan.aiAdvisorEnabled,
                    busy: _generateBusy,
                    onGenerate: _generate,
                  ),
                  if (_message.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Text(
                      _message,
                      key: const Key('growth-message'),
                      style: TextStyle(
                        color: _messageIsError
                            ? AppColors.errorRed
                            : AppColors.sage,
                        fontWeight: FontWeight.w600,
                        height: 1.4,
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  if (_entries.isEmpty)
                    _EmptyInsights(enabled: _plan.aiAdvisorEnabled)
                  else
                    for (final entry in _entries) ...[
                      _InsightCard(
                        key: ValueKey('growth-card-${entry.key}'),
                        entry: entry,
                      ),
                      const SizedBox(height: 12),
                    ],
                ],
              ),
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: AppColors.paper,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: AppColors.rule),
    ),
    child: child,
  );
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({
    super.key,
    required this.title,
    required this.heading,
    this.badge,
    this.action,
  });

  final String title;
  final String heading;
  final String? badge;
  final Widget? action;

  @override
  Widget build(BuildContext context) => _Panel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
            ),
            if (badge != null)
              Flexible(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.sage.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    badge!,
                    style: const TextStyle(
                      color: AppColors.sage,
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          heading,
          style: const TextStyle(color: AppColors.muted, height: 1.4),
        ),
        if (action != null) ...[const SizedBox(height: 12), action!],
      ],
    ),
  );
}

class _AdvisorCard extends StatelessWidget {
  const _AdvisorCard({
    required this.enabled,
    required this.busy,
    required this.onGenerate,
  });

  final bool enabled;
  final bool busy;
  final VoidCallback onGenerate;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return _Panel(
      key: const Key('growth-advisor'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.auto_awesome, color: AppColors.cobaltDeep),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  l10n.extGrowthAdvisorTitle,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            enabled ? l10n.extGrowthAdvisorOn : l10n.extGrowthAdvisorOff,
            style: const TextStyle(color: AppColors.muted, height: 1.4),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            key: const Key('growth-generate'),
            onPressed: enabled && !busy ? onGenerate : null,
            icon: busy
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.auto_awesome_outlined),
            label: Text(l10n.extGrowthGenerate),
          ),
          if (busy) ...[
            const SizedBox(height: 8),
            Text(
              l10n.extGrowthGenerating,
              key: const Key('growth-generating'),
              style: const TextStyle(color: AppColors.muted, fontSize: 13),
            ),
          ],
        ],
      ),
    );
  }
}

class _EmptyInsights extends StatelessWidget {
  const _EmptyInsights({required this.enabled});

  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return _Panel(
      key: const Key('growth-empty'),
      child: Column(
        children: [
          Text(
            l10n.extGrowthNoInsights,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontWeight: FontWeight.w800,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            enabled
                ? l10n.extGrowthNoInsightsPro
                : l10n.extGrowthNoInsightsFree,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted, height: 1.4),
          ),
        ],
      ),
    );
  }
}

String _severityLabel(AppLocalizations l10n, String severity) =>
    switch (severity) {
      'critical' => l10n.extGrowthSevCritical,
      'high' => l10n.extGrowthSevHigh,
      'medium' => l10n.extGrowthSevMedium,
      'low' => l10n.extGrowthSevLow,
      '' => l10n.extGrowthSevUnknown,
      final other =>
        other
            .split(RegExp(r'[_-]'))
            .where((part) => part.isNotEmpty)
            .map((part) => part[0].toUpperCase() + part.substring(1))
            .join(' '),
    };

Color _severityColor(String severity) => switch (severity) {
  'critical' || 'high' => AppColors.errorRed,
  'medium' => AppColors.warn,
  _ => AppColors.muted,
};

class _InsightCard extends StatelessWidget {
  const _InsightCard({super.key, required this.entry});

  final GrowthCardEntry entry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final card = entry.card;
    final color = _severityColor(card.severity);
    final when = entry.createdAt == null
        ? ''
        : displayDate(entry.createdAt!, dateLocaleOf(context));
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  card.title.isEmpty
                      ? l10n.extGrowthCardFallbackTitle
                      : card.title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    _severityLabel(l10n, card.severity),
                    style: TextStyle(
                      color: color,
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                  ),
                ),
              ),
            ],
          ),
          if (when.isNotEmpty)
            Text(
              when,
              style: const TextStyle(color: AppColors.muted, fontSize: 12),
            ),
          if (card.finding.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '${l10n.extGrowthFinding}: ',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  TextSpan(text: card.finding),
                ],
              ),
              style: const TextStyle(color: AppColors.ink, height: 1.4),
            ),
          ],
          if (card.recommendation.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '${l10n.extGrowthAction}: ',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  TextSpan(text: card.recommendation),
                ],
              ),
              style: const TextStyle(color: AppColors.ink, height: 1.4),
            ),
          ],
        ],
      ),
    );
  }
}
