import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/guest_tracking_result.dart';
import '../services/phone_account_service.dart';
import '../services/phone_accounts.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../utils/root_navigation.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/async_action_button.dart';
import '../widgets/guest_tracking_lookup.dart'
    show guestTrackingServiceLabel, guestTrackingStageLabel;
import '../widgets/package_request_widgets.dart' show requestStatusLabel;
import '../widgets/phone_account_widgets.dart';
import 'phone_sign_in_screen.dart';
import 'phone_verification_screen.dart' show PhoneVerificationArguments;

enum _State { loading, ready, signedOut, noVerifiedPhone, failed }

/// "My packages" (docs/PHONE_ACCOUNTS.md §6): every record any business has
/// with this account's verified number - as the sender ("My packages") and
/// as the receiver ("Coming to you") - grouped by business, newest first.
/// No prices: the server's projection carries none.
class MyPackagesScreen extends StatefulWidget {
  const MyPackagesScreen({
    super.key,
    this.service,
    this.phoneSignInClient,
    this.loadTimeout = const Duration(seconds: 20),
  });

  /// For tests: the callable's stand-in.
  final PhoneAccountService? service;

  /// For tests: the sign-in a signed-out person is offered.
  final PhoneSignInClient? phoneSignInClient;

  /// The first page always resolves: after this it reads as a failure with
  /// Retry instead of a spinner that never ends.
  final Duration loadTimeout;

  @override
  State<MyPackagesScreen> createState() => _MyPackagesScreenState();
}

class _MyPackagesScreenState extends State<MyPackagesScreen> {
  late final PhoneAccountService _service =
      widget.service ?? const PhoneAccountService();

  _State _state = _State.loading;
  Object? _error;
  List<MyShipmentItem> _items = const [];
  MyShipmentSections _sections = const MyShipmentSections(
    mine: [],
    comingToYou: [],
  );
  MyShipmentsCursor? _next;
  String _lastTwo = '';
  final Set<String> _reporting = {};

  /// Bumped by every reload, so an older answer never lands over a newer.
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _setItems(List<MyShipmentItem> items) {
    _items = items;
    // Grouped once per answer, never per card.
    _sections = groupMyShipments(items);
  }

  Future<void> _load() async {
    final generation = ++_generation;
    // A spinner only while there is nothing to show yet (the first load
    // starts in it already).
    if (_items.isEmpty && _state != _State.loading) {
      setState(() => _state = _State.loading);
    }
    try {
      final page = await _service.myShipments().timeout(widget.loadTimeout);
      if (!mounted || generation != _generation) return;
      setState(() {
        _setItems(page.items);
        _next = page.nextCursor;
        _lastTwo = page.phoneLastTwo;
        _error = null;
        _state = _State.ready;
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      final reason = error is PhoneAccountFailure ? error.reason : '';
      setState(() {
        _error = error;
        _state = switch (reason) {
          PhoneRefusalReason.signInRequired => _State.signedOut,
          PhoneRefusalReason.noVerifiedPhone => _State.noVerifiedPhone,
          _ => _items.isEmpty ? _State.failed : _State.ready,
        };
      });
      if (_state == _State.ready && _items.isNotEmpty) {
        showErrorSnackBar(
          context,
          phoneAccountErrorText(AppLocalizations.of(context)!, error),
        );
      }
    }
  }

  Future<void> _loadMore() async {
    final cursor = _next;
    if (cursor == null) return;
    final generation = _generation;
    try {
      final page = await _service
          .myShipments(cursor: cursor)
          .timeout(widget.loadTimeout);
      if (!mounted || generation != _generation) return;
      setState(() {
        _setItems(appendShipmentPage(_items, page.items));
        _next = page.nextCursor;
      });
    } catch (error) {
      if (!mounted) return;
      showErrorSnackBar(
        context,
        phoneAccountErrorText(AppLocalizations.of(context)!, error),
      );
    }
  }

  Future<void> _confirmNotMine(MyShipmentItem item) async {
    if (_reporting.contains(item.key)) return;
    final l10n = AppLocalizations.of(context)!;
    final business = item.businessName;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(l10n.phaNotMineTitle),
        content: Text(
          business.isEmpty
              ? l10n.phaNotMineBodyPlain
              : l10n.phaNotMineBody(business),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            key: const Key('my-packages-not-mine-confirm'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(l10n.phaNotMineConfirm),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _reporting.add(item.key));
    try {
      await _service.reportNotMine(key: item.key, role: item.role);
      if (!mounted) return;
      setState(() {
        _setItems([
          for (final row in _items)
            if (row.key != item.key) row,
        ]);
      });
      showSuccessSnackBar(context, l10n.phaNotMineDone);
    } catch (error) {
      if (!mounted) return;
      showErrorSnackBar(context, phoneAccountErrorText(l10n, error));
    } finally {
      if (mounted) setState(() => _reporting.remove(item.key));
    }
  }

  Future<void> _signIn() async {
    final outcome = await Navigator.of(context).push<PhoneSignInOutcome>(
      MaterialPageRoute(
        builder: (_) => PhoneSignInScreen(client: widget.phoneSignInClient),
      ),
    );
    if (!mounted || outcome == null || !outcome.signedIn) return;
    await _load();
  }

  Future<void> _verifyPhone() async {
    final verified = await pushRootNamed<bool>(
      context,
      '/verify-phone',
      arguments: const PhoneVerificationArguments(),
    );
    if (!mounted || verified != true) return;
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: AppBar(
        leading: const AppBackButton(),
        title: Text(l10n.phaMyPackagesTitle),
      ),
      body: SafeArea(child: _body(l10n)),
    );
  }

  Widget _body(AppLocalizations l10n) {
    switch (_state) {
      case _State.loading:
        return const Center(
          child: CircularProgressIndicator(key: Key('my-packages-loading')),
        );
      case _State.signedOut:
        return _Message(
          key: const Key('my-packages-signed-out'),
          icon: Icons.phone_iphone_outlined,
          text: l10n.phaSignInToSee,
          action: AsyncActionButton.filled(
            onPressed: _signIn,
            label: l10n.phaSignInWithPhone,
            icon: Icons.login,
          ),
        );
      case _State.noVerifiedPhone:
        return _Message(
          key: const Key('my-packages-no-phone'),
          icon: Icons.verified_user_outlined,
          text: l10n.phaErrNoVerifiedPhone,
          action: AsyncActionButton.filled(
            onPressed: _verifyPhone,
            label: l10n.verifyPhone,
            icon: Icons.phone_iphone_outlined,
          ),
        );
      case _State.failed:
        final error = _error;
        return _Message(
          key: const Key('my-packages-failed'),
          icon: Icons.cloud_off_outlined,
          text: error is PhoneAccountFailure && error.reason.isNotEmpty
              ? phoneAccountErrorText(l10n, error)
              : l10n.phaLoadFailed,
          action: AsyncActionButton.filled(
            key: const Key('my-packages-retry'),
            onPressed: _load,
            label: l10n.retry,
            icon: Icons.refresh,
          ),
        );
      case _State.ready:
        return RefreshIndicator(onRefresh: _load, child: _list(l10n));
    }
  }

  Widget _list(AppLocalizations l10n) {
    if (_sections.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          _Message(
            key: const Key('my-packages-empty'),
            icon: Icons.inventory_2_outlined,
            title: l10n.phaEmptyTitle,
            text: _lastTwo.isEmpty
                ? l10n.phaEmptyBodyPlain
                : l10n.phaEmptyBody(_lastTwo),
          ),
        ],
      );
    }
    final children = <Widget>[];
    void section(String key, String title, List<MyShipmentGroup> groups) {
      if (groups.isEmpty) return;
      children.add(_SectionTitle(key: Key(key), text: title));
      for (final group in groups) {
        children.add(
          _BusinessHeader(
            name: group.businessName.isEmpty
                ? l10n.phaBusinessUnknown
                : group.businessName,
          ),
        );
        for (final item in group.items) {
          children.add(
            _ShipmentCard(
              key: ValueKey('my-package:${item.key}'),
              item: item,
              reporting: _reporting.contains(item.key),
              onNotMine: () => _confirmNotMine(item),
            ),
          );
        }
      }
    }

    section('my-packages-mine', l10n.phaSectionMine, _sections.mine);
    section(
      'my-packages-coming',
      l10n.phaSectionComingToYou,
      _sections.comingToYou,
    );
    if (_next != null) {
      children.add(
        Padding(
          padding: const EdgeInsets.only(top: AppSpacing.md),
          child: AsyncActionButton.outlined(
            key: const Key('my-packages-show-more'),
            onPressed: _loadMore,
            label: l10n.phaShowMore,
            loadingLabel: l10n.phaLoadingMore,
            icon: Icons.expand_more,
          ),
        ),
      );
    }
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.sm,
        AppSpacing.lg,
        AppSpacing.xl,
      ),
      children: children,
    );
  }
}

/// A tracking stage in the tracking page's own words; a package request in
/// the request's.
String myShipmentStageText(AppLocalizations l10n, MyShipmentItem item) {
  if (item.isPackageRequest) {
    return requestStatusLabel(l10n, item.requestStatus, forCustomer: true);
  }
  final stage = item.stageValue;
  if (stage == null) return '';
  return guestTrackingStageLabel(
    l10n,
    item.serviceType ?? GuestTrackingServiceType.barrel,
    stage,
  );
}

String myShipmentServiceText(AppLocalizations l10n, MyShipmentItem item) {
  if (item.isPackageRequest) return l10n.phaServicePackageRequest;
  final service = item.serviceType;
  return service == null
      ? l10n.guestTrackingServiceLabel
      : guestTrackingServiceLabel(l10n, service);
}

class _ShipmentCard extends StatelessWidget {
  const _ShipmentCard({
    super.key,
    required this.item,
    required this.reporting,
    required this.onNotMine,
  });

  final MyShipmentItem item;
  final bool reporting;
  final VoidCallback onNotMine;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final stage = myShipmentStageText(l10n, item);
    final created = item.createdAt;
    final updated = item.updatedAt;
    final muted = Theme.of(
      context,
    ).textTheme.bodySmall?.copyWith(color: AppColors.lightMuted, height: 1.35);
    final shipping = item.shipping;
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  myShipmentServiceText(l10n, item),
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              if (stage.isNotEmpty) ...[
                const SizedBox(width: AppSpacing.sm),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.mist.withValues(alpha: 0.6),
                    borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                  ),
                  child: Text(
                    stage,
                    key: const Key('my-package-stage'),
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppColors.cobaltDeep,
                    ),
                  ),
                ),
              ],
            ],
          ),
          if (item.trackingCode.isNotEmpty) ...[
            const SizedBox(height: 4),
            SelectableText(
              item.trackingCode,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.2,
                color: AppColors.cobaltDeep,
              ),
            ),
          ],
          if (item.pieceCount > 0) ...[
            const SizedBox(height: 4),
            Text(l10n.pcsPieceCount(item.pieceCount), style: muted),
          ],
          if (item.parts.length > 1)
            for (final part in item.parts)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  [
                    part.trackingCode,
                    if (part.stage != null)
                      guestTrackingStageLabel(
                        l10n,
                        item.serviceType ?? GuestTrackingServiceType.container,
                        part.stage!,
                      ),
                    if (part.pieceCount > 0)
                      l10n.pcsPieceCount(part.pieceCount),
                  ].join(' · '),
                  style: muted,
                ),
              ),
          if (shipping != null) ...[
            const SizedBox(height: 4),
            if (shipping.shippingLine.isNotEmpty)
              Text(
                '${l10n.guestTrackingShippingLine}: ${shipping.shippingLine}',
                style: muted,
              ),
            if (shipping.containerNumber.isNotEmpty)
              Text(
                '${l10n.guestTrackingContainerNumber}: '
                '${shipping.containerNumber}',
                style: muted,
              ),
            if (shipping.bookingNumber.isNotEmpty)
              Text(
                '${l10n.guestTrackingBookingNumber}: ${shipping.bookingNumber}',
                style: muted,
              ),
          ],
          if (item.sentToSelf) ...[
            const SizedBox(height: 4),
            Text(l10n.phaSentToSelf, style: muted),
          ],
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: Text(
                  [
                    if (created != null)
                      l10n.phaRecordedOn(displayDate(created, locale)),
                    if (updated != null &&
                        (created == null || updated.isAfter(created)))
                      l10n.phaUpdatedOn(displayDateTime(updated, locale)),
                  ].join(' · '),
                  style: muted,
                ),
              ),
              if (reporting)
                const Padding(
                  padding: EdgeInsets.all(AppSpacing.sm),
                  child: SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              else
                TextButton(
                  key: ValueKey('my-package-not-mine:${item.key}'),
                  onPressed: onNotMine,
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.muted,
                    visualDensity: VisualDensity.compact,
                  ),
                  child: Text(l10n.phaNotMine),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.md, bottom: AppSpacing.xs),
      child: Text(
        text,
        style: const TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w800,
          color: AppColors.ink,
        ),
      ),
    );
  }
}

class _BusinessHeader extends StatelessWidget {
  const _BusinessHeader({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.sm, bottom: AppSpacing.xs),
      child: Row(
        children: [
          const Icon(
            Icons.storefront_outlined,
            size: 16,
            color: AppColors.cobaltDeep,
          ),
          const SizedBox(width: AppSpacing.xs),
          Expanded(
            child: Text(
              name,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: AppColors.cobaltDeep,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({
    super.key,
    required this.icon,
    required this.text,
    this.title,
    this.action,
  });

  final IconData icon;
  final String text;
  final String? title;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: AppColors.cobalt),
            const SizedBox(height: AppSpacing.md),
            if (title != null) ...[
              Text(
                title!,
                textAlign: TextAlign.center,
                style: Theme.of(
                  context,
                ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: AppSpacing.xs),
            ],
            Text(
              text,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: AppColors.lightMuted,
                height: 1.4,
              ),
            ),
            if (action != null) ...[
              const SizedBox(height: AppSpacing.lg),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}
