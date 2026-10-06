import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../models/destination_country.dart';
import '../services/container_manifest.dart';
import '../services/container_packages.dart';
import '../services/package_codes.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/guest_tracking_lookup.dart';
import '../widgets/lot_sheets.dart';
import 'containers_screen.dart';

/// One package, as the yard needs it after scanning its label: whose it is
/// (with a way to call or message them), who collects it, what it is, which
/// box it is on and where that box is, whether the WhatsApp updates reached
/// anyone - and the three things staff do next: fix a contact, reprint a
/// label, open the container.
///
/// Found by tracking code (a scan, a typed code, a tapped link) or by line id
/// (a search hit on a line that has no code yet). Only the business's own
/// lines are found: another business's label says so and offers the public
/// tracking page instead.
class PackageResultScreen extends StatefulWidget {
  const PackageResultScreen({
    super.key,
    required this.businessId,
    this.code = '',
    this.lineId = '',
    this.businessCountryCode = '',
    this.destinations = const [],
    this.onOpenContainer,
    this.repository,
    this.labelOpener = openContainerLabels,
  }) : assert(code != '' || lineId != '');

  final String businessId;

  /// "CL-XXXXXX".
  final String code;

  /// Used when [code] is empty.
  final String lineId;

  /// Where the phone pickers start when contacts are edited. Loaded from the
  /// business when the caller does not already hold them.
  final String businessCountryCode;
  final List<DestinationCountry> destinations;

  /// Opens the container from the screen that already holds its context
  /// (staff, customers, parked cars). Without it the container opens on its
  /// own.
  final void Function(String containerId)? onOpenContainer;
  final ContainerPackageRepository? repository;
  final ContainerLabelOpener labelOpener;

  @override
  State<PackageResultScreen> createState() => _PackageResultScreenState();
}

class _PackageResultScreenState extends State<PackageResultScreen> {
  late final ContainerPackageRepository _repo =
      widget.repository ?? FirestoreContainerPackageRepository();
  StreamSubscription<ContainerLine?>? _lineSub;
  StreamSubscription<ShippingContainer?>? _containerSub;
  Timer? _safety;

  ContainerLine? _line;
  ShippingContainer? _container;
  String _containerId = '';
  bool _loaded = false;
  bool _failed = false;

  late String _businessCountryCode = widget.businessCountryCode;
  late List<DestinationCountry> _destinations = widget.destinations;

  @override
  void initState() {
    super.initState();
    _listen();
    _loadBusinessContext();
  }

  void _listen() {
    final stream = widget.code.isNotEmpty
        ? _repo.watchLineByCode(widget.businessId, widget.code)
        : _repo.watchLine(widget.lineId);
    // A spinner that waits on a stream which never answers is a frozen
    // screen; after this long it says it could not load instead.
    _safety = Timer(const Duration(seconds: 15), () {
      if (mounted && !_loaded) {
        setState(() {
          _loaded = true;
          _failed = true;
        });
      }
    });
    _lineSub = stream.listen((line) {
      if (!mounted) return;
      // A line read by id is only shown when it is this business's own.
      final own = line != null && line.businessId == widget.businessId;
      setState(() {
        _line = own ? line : null;
        _loaded = true;
        _failed = false;
      });
      _safety?.cancel();
      _followContainer(own ? line.containerId : '');
    }, onError: (_) {
      if (!mounted) return;
      _safety?.cancel();
      setState(() {
        _loaded = true;
        _failed = true;
      });
    });
  }

  void _followContainer(String containerId) {
    if (containerId == _containerId) return;
    _containerId = containerId;
    _containerSub?.cancel();
    _containerSub = null;
    if (containerId.isEmpty) {
      setState(() => _container = null);
      return;
    }
    _containerSub = _repo.watchContainer(containerId).listen((c) {
      if (mounted) setState(() => _container = c);
    }, onError: (_) {});
  }

  Future<void> _loadBusinessContext() async {
    if (_businessCountryCode.isEmpty) {
      final code = await _repo.businessCountryCode(widget.businessId);
      if (mounted && code.isNotEmpty) setState(() => _businessCountryCode = code);
    }
    if (_destinations.isEmpty) {
      final list = await _repo.destinations(widget.businessId);
      if (mounted && list.isNotEmpty) setState(() => _destinations = list);
    }
  }

  @override
  void dispose() {
    _safety?.cancel();
    _lineSub?.cancel();
    _containerSub?.cancel();
    super.dispose();
  }

  Future<void> _launch(Uri? uri) async {
    final l10n = AppLocalizations.of(context)!;
    if (uri == null) return;
    var opened = false;
    try {
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      opened = false;
    }
    if (!opened && mounted) {
      showErrorSnackBar(context, l10n.pkgCouldNotOpenApp);
    }
  }

  Future<void> _editContacts() async {
    final line = _line;
    if (line == null) return;
    await editContainerLineContacts(
      context,
      businessId: widget.businessId,
      line: line,
      container: _container,
      businessCountryCode: _businessCountryCode,
      destinations: _destinations,
    );
  }

  Future<void> _printLabels() async {
    final line = _line;
    final container = _container;
    if (line == null || container == null) return;
    await showContainerLabelSheet(
      context,
      businessId: widget.businessId,
      container: container,
      line: line,
      opener: widget.labelOpener,
    );
  }

  void _openContainer() {
    final containerId = _line?.containerId ?? '';
    if (containerId.isEmpty) return;
    final open = widget.onOpenContainer;
    if (open != null) {
      open(containerId);
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ContainerDetailScreen(
          businessId: widget.businessId,
          containerId: containerId,
          staff: const [],
          customers: const [],
          knownCars: const [],
          destinations: _destinations,
          businessCountryCode: _businessCountryCode,
          onCustomerRecorded: () {},
        ),
      ),
    );
  }

  void _lookUpPublicly() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => GuestTrackingLookupPage(initialCode: widget.code),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final line = _line;
    final Widget body;
    if (!_loaded) {
      body = const Center(child: CircularProgressIndicator());
    } else if (_failed) {
      body = ListView(
        children: [
          LotEmptyState(
            icon: Icons.cloud_off_outlined,
            title: l10n.pkgCouldNotLoad,
          ),
        ],
      );
    } else if (line == null) {
      body = _NotFound(code: widget.code, onLookUpPublicly: _lookUpPublicly);
    } else {
      body = PackageResultView(
        line: line,
        container: _container,
        onCall: (phone) => _launch(packagePhoneCallUri(phone)),
        onWhatsApp: (phone) => _launch(packageWhatsAppUri(phone)),
        onEditContacts: _editContacts,
        onPrintLabels: _container == null ? null : _printLabels,
        onOpenContainer: _openContainer,
      );
    }
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          _Header(code: line?.trackingCode.isNotEmpty == true
              ? line!.trackingCode
              : widget.code),
          Expanded(child: body),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      decoration: BoxDecoration(
        color: AppColors.paper,
        border: Border(
          bottom: BorderSide(color: AppColors.rule.withValues(alpha: 0.8)),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(4, 4, AppSpacing.lg, AppSpacing.md),
          child: Row(
            children: [
              const AppBackButton(),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.pkgTitle,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        height: 1.1,
                        letterSpacing: -0.4,
                        color: AppColors.ink,
                      ),
                    ),
                    if (code.isNotEmpty)
                      Text(
                        code,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          height: 1.3,
                          color: AppColors.muted,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NotFound extends StatelessWidget {
  const _NotFound({required this.code, required this.onLookUpPublicly});

  final String code;
  final VoidCallback onLookUpPublicly;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ListView(
      key: const Key('pkg-not-found'),
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        LotEmptyState(
          icon: Icons.search_off,
          title: code.isEmpty ? l10n.pkgLineGone : l10n.pkgNotFoundTitle(code),
          hint: code.isEmpty ? null : l10n.pkgNotFoundHint,
        ),
        if (code.isNotEmpty)
          ContainerActionButton(
            key: const Key('pkg-look-up-publicly'),
            icon: Icons.travel_explore,
            label: l10n.pkgLookUpPublicly,
            onTap: onLookUpPublicly,
          ),
      ],
    );
  }
}

/// The package itself, given its line and container: pure rendering over
/// callbacks, so it is tested without Firebase.
class PackageResultView extends StatelessWidget {
  const PackageResultView({
    super.key,
    required this.line,
    required this.container,
    required this.onCall,
    required this.onWhatsApp,
    required this.onEditContacts,
    required this.onPrintLabels,
    required this.onOpenContainer,
  });

  final ContainerLine line;

  /// Null while it loads, or when it was deleted.
  final ShippingContainer? container;
  final ValueChanged<String> onCall;
  final ValueChanged<String> onWhatsApp;
  final VoidCallback onEditContacts;

  /// Null until the container is known: labels are printed per container.
  final VoidCallback? onPrintLabels;
  final VoidCallback onOpenContainer;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final c = container;
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.xl),
      children: [
        _CodeCard(line: line, container: c),
        const SizedBox(height: AppSpacing.md),
        _Section(
          title: l10n.pkgWhatItIs,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _Fact(
                icon: containerKindIcon(line.kind),
                text: [
                  containerKindLabel(l10n, line.kind),
                  if (!line.isCar && line.quantity > 0)
                    l10n.pkgQuantity(line.quantity),
                ].join(' · '),
              ),
              if (line.isCar && line.vinNumber.isNotEmpty)
                _Fact(
                  key: const Key('pkg-vin'),
                  icon: Icons.pin_outlined,
                  text: l10n.pkgVin(line.vinNumber),
                ),
              if (line.description.isNotEmpty)
                _Fact(icon: Icons.notes_outlined, text: line.description),
            ],
          ),
        ),
        _Section(
          title: l10n.pkgOwner,
          child: line.isStock
              ? _Fact(icon: Icons.storefront_outlined, text: l10n.ctrStock)
              : _Person(
                  role: 'customer',
                  name: line.customerName,
                  phone: line.customerPhone,
                  lacksCountryCode:
                      containerPhoneLacksCountryCode(line.customerPhone),
                  onCall: onCall,
                  onWhatsApp: onWhatsApp,
                ),
        ),
        _Section(
          title: l10n.ctrReceiver,
          child: line.receiverName.isEmpty && line.receiverPhone.isEmpty
              ? _Fact(
                  key: const Key('pkg-no-receiver'),
                  icon: Icons.person_off_outlined,
                  text: l10n.pkgNoReceiver,
                  muted: true,
                )
              : _Person(
                  role: 'receiver',
                  name: line.receiverName,
                  phone: line.receiverPhone,
                  lacksCountryCode:
                      containerPhoneLacksCountryCode(line.receiverPhone),
                  onCall: onCall,
                  onWhatsApp: onWhatsApp,
                ),
        ),
        _Section(
          title: l10n.pkgContainer,
          child: c == null
              ? _Fact(
                  icon: Icons.view_in_ar_outlined,
                  text: l10n.pkgContainerUnknown,
                  muted: true,
                )
              : Column(
                  key: const Key('pkg-container'),
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            c.displayName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: AppColors.ink,
                            ),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        ContainerStatusPill(status: c.status),
                      ],
                    ),
                    if (c.containerNumber.isNotEmpty && c.label.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          c.label,
                          style: const TextStyle(
                            fontSize: 13,
                            color: AppColors.muted,
                          ),
                        ),
                      ),
                    const SizedBox(height: AppSpacing.sm),
                    _Fact(
                      icon: Icons.public,
                      text: c.destinationCountryName.isEmpty
                          ? l10n.ctrDestinationUnset
                          : '${l10n.ctrDestination}: ${c.destinationCountryName}',
                      muted: c.destinationCountryName.isEmpty,
                    ),
                    if (c.sailedAt != null)
                      _Fact(
                        icon: Icons.directions_boat_outlined,
                        text: l10n.ctrSailed(displayDate(c.sailedAt!, locale)),
                      ),
                    if (c.arrivedAt != null)
                      _Fact(
                        icon: Icons.flag_outlined,
                        text: l10n.ctrArrivedOn(
                            displayDate(c.arrivedAt!, locale)),
                      ),
                  ],
                ),
        ),
        _Section(
          title: l10n.pkgUpdates,
          child: _Updates(line: line, locale: locale),
        ),
        const SizedBox(height: AppSpacing.sm),
        ContainerActionButton(
          key: const Key('pkg-print-labels'),
          icon: Icons.qr_code_2,
          label: l10n.pkgReprintLabels,
          primary: true,
          enabled: onPrintLabels != null,
          onTap: onPrintLabels ?? () {},
        ),
        const SizedBox(height: AppSpacing.sm),
        Row(
          children: [
            Expanded(
              child: ContainerActionButton(
                key: const Key('pkg-edit-contacts'),
                icon: Icons.contact_phone_outlined,
                label: l10n.ctrEditContacts,
                onTap: onEditContacts,
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: ContainerActionButton(
                key: const Key('pkg-open-container'),
                icon: Icons.view_in_ar_outlined,
                label: l10n.pkgOpenContainer,
                enabled: line.containerId.isNotEmpty,
                onTap: onOpenContainer,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// The code, large - it is what staff read back over the phone - with what
/// the package is and the state of its box.
class _CodeCard extends StatelessWidget {
  const _CodeCard({required this.line, required this.container});

  final ContainerLine line;
  final ShippingContainer? container;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.mist,
              borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            ),
            child: Icon(containerKindIcon(line.kind),
                size: 22, color: AppColors.cobaltDeep),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  line.trackingCode.isEmpty ? l10n.pkgNoCode : line.trackingCode,
                  key: const Key('pkg-code'),
                  style: TextStyle(
                    fontSize: line.trackingCode.isEmpty ? 15 : 24,
                    fontWeight: FontWeight.w800,
                    letterSpacing: line.trackingCode.isEmpty ? 0 : 1.2,
                    color: line.trackingCode.isEmpty
                        ? AppColors.muted
                        : AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  containerLineTitle(l10n, line),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.3,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
              ],
            ),
          ),
          if (container != null) ...[
            const SizedBox(width: AppSpacing.sm),
            ContainerStatusPill(status: container!.status),
          ],
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 2, bottom: AppSpacing.sm),
            child: Text(
              title,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                letterSpacing: 0.4,
                color: AppColors.muted,
              ),
            ),
          ),
          Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.paper,
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              border: Border.all(color: AppColors.rule),
            ),
            child: child,
          ),
        ],
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({
    super.key,
    required this.icon,
    required this.text,
    this.muted = false,
    this.color,
  });

  final IconData icon;
  final String text;
  final bool muted;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final tone = color ?? (muted ? AppColors.muted : AppColors.ink);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Icon(icon, size: 16, color: color ?? AppColors.muted),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: TextStyle(fontSize: 13.5, height: 1.35, color: tone),
            ),
          ),
        ],
      ),
    );
  }
}

/// A person on the line, with Call and WhatsApp. WhatsApp needs the country
/// code, so a number without one cannot open a chat - and says why.
class _Person extends StatelessWidget {
  const _Person({
    required this.role,
    required this.name,
    required this.phone,
    required this.lacksCountryCode,
    required this.onCall,
    required this.onWhatsApp,
  });

  /// 'customer' or 'receiver': names the keys.
  final String role;
  final String name;
  final String phone;
  final bool lacksCountryCode;
  final ValueChanged<String> onCall;
  final ValueChanged<String> onWhatsApp;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final canCall = packagePhoneCallUri(phone) != null;
    final canWhatsApp = packageWhatsAppUri(phone) != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          name.isEmpty ? l10n.pkgNoName : name,
          key: Key('pkg-$role-name'),
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            color: name.isEmpty ? AppColors.muted : AppColors.ink,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          phone.isEmpty ? l10n.pkgNoPhone : phone,
          key: Key('pkg-$role-phone'),
          style: const TextStyle(fontSize: 13.5, color: AppColors.muted),
        ),
        if (phone.isNotEmpty && lacksCountryCode)
          _Fact(
            icon: Icons.warning_amber_rounded,
            text: l10n.ctrPhoneNeedsCountryCode,
            color: AppColors.warn,
          ),
        if (phone.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              Expanded(
                child: _ContactButton(
                  key: Key('pkg-call-$role'),
                  icon: Icons.call_outlined,
                  label: l10n.pkgCall,
                  onTap: canCall ? () => onCall(phone) : null,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: _ContactButton(
                  key: Key('pkg-whatsapp-$role'),
                  icon: Icons.chat_outlined,
                  label: l10n.pkgWhatsApp,
                  onTap: canWhatsApp ? () => onWhatsApp(phone) : null,
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

class _ContactButton extends StatelessWidget {
  const _ContactButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return Semantics(
      button: true,
      enabled: enabled,
      label: label,
      excludeSemantics: true,
      child: PressableScale(
        onTap: onTap,
        scale: 0.97,
        child: Opacity(
          opacity: enabled ? 1 : 0.45,
          child: Container(
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.parchment,
              borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              border: Border.all(color: AppColors.rule),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 17, color: AppColors.cobaltDeep),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.cobaltDeep,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Who will hear about the shipment now, and what happened on the last
/// update that went out.
class _Updates extends StatelessWidget {
  const _Updates({required this.line, required this.locale});

  final ContainerLine line;
  final String locale;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final who = [
      if (line.updatesCustomer)
        line.customerName.isNotEmpty ? line.customerName : l10n.lotCustomer,
      if (line.updatesReceiver)
        line.receiverName.isNotEmpty ? line.receiverName : l10n.ctrReceiverShort,
    ];
    final last = line.lastCustomerUpdate;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _Fact(
          key: const Key('pkg-updates-to'),
          icon: who.isEmpty
              ? Icons.notifications_off_outlined
              : Icons.chat_outlined,
          text: who.isEmpty ? l10n.ctrUpdatesOff : l10n.ctrUpdatesTo(who.join(', ')),
          color: who.isEmpty ? AppColors.muted : AppColors.sage,
        ),
        if (last == null)
          _Fact(
            key: const Key('pkg-no-update-yet'),
            icon: Icons.schedule,
            text: l10n.pkgNoUpdateYet,
            muted: true,
          )
        else ...[
          _Fact(
            key: const Key('pkg-last-update'),
            icon: Icons.history,
            text: last.at == null
                ? l10n.pkgLastUpdate(containerUpdateMomentLabel(l10n, last.update))
                : l10n.pkgLastUpdateAt(containerUpdateMomentLabel(l10n, last.update),
                    displayDateTime(last.at!, locale)),
          ),
          for (final result in last.results)
            Padding(
              padding: const EdgeInsets.only(left: 24),
              child: _Fact(
                icon: _resultIcon(result.status),
                text: l10n.pkgUpdateResult(
                  result.role == containerUpdateRoleReceiver
                      ? l10n.ctrReceiverShort
                      : l10n.lotCustomer,
                  _resultLabel(l10n, result),
                ),
                color: _resultColor(result.status),
              ),
            ),
        ],
      ],
    );
  }
}

String _resultLabel(AppLocalizations l10n, ContainerLineUpdateResult r) =>
    switch (r.status) {
      containerUpdateSent => l10n.pkgResultSent,
      containerUpdateFailed => l10n.pkgResultFailed,
      containerUpdateWaiting => l10n.pkgResultWaiting,
      // The send queue's states: on its way, not a failure.
      containerUpdateQueued => l10n.pkgResultQueued,
      containerUpdateSending => l10n.pkgResultSending,
      containerUpdateRetrying => l10n.pkgResultRetrying,
      _ => switch (r.reason) {
          'no_phone' => l10n.pkgResultNoPhone,
          'switched_off' => l10n.pkgResultSwitchedOff,
          'needs_country_code' => l10n.pkgResultNeedsCountryCode,
          _ => l10n.pkgResultNotSent,
        },
    };

IconData _resultIcon(String status) => switch (status) {
      containerUpdateSent => Icons.check_circle_outline,
      containerUpdateFailed => Icons.error_outline,
      containerUpdateWaiting => Icons.hourglass_empty,
      containerUpdateQueued => Icons.schedule_send_outlined,
      containerUpdateSending => Icons.send_outlined,
      containerUpdateRetrying => Icons.autorenew,
      _ => Icons.remove_circle_outline,
    };

Color _resultColor(String status) => switch (status) {
      containerUpdateSent => AppColors.sage,
      containerUpdateFailed => AppColors.errorRed,
      containerUpdateWaiting => AppColors.warn,
      containerUpdateQueued || containerUpdateSending => AppColors.cobaltDeep,
      containerUpdateRetrying => AppColors.warn,
      _ => AppColors.muted,
    };

/// The package view on its own, for widget tests.
@visibleForTesting
Widget packageResultViewForTesting({
  required ContainerLine line,
  ShippingContainer? container,
  ValueChanged<String>? onCall,
  ValueChanged<String>? onWhatsApp,
  VoidCallback? onEditContacts,
  VoidCallback? onPrintLabels,
  VoidCallback? onOpenContainer,
}) =>
    PackageResultView(
      line: line,
      container: container,
      onCall: onCall ?? (_) {},
      onWhatsApp: onWhatsApp ?? (_) {},
      onEditContacts: onEditContacts ?? () {},
      onPrintLabels: onPrintLabels,
      onOpenContainer: onOpenContainer ?? () {},
    );
