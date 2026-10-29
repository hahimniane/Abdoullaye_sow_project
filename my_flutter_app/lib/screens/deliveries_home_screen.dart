import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/container_delivery.dart';
import '../services/container_delivery_service.dart';
import '../services/container_packages.dart';
import '../services/deliveries_home.dart';
import '../services/line_pieces.dart' show LineGroupSummary;
import '../services/package_codes.dart';
import '../services/package_requests.dart' show PackageProofSettings;
import '../services/waiting_packages.dart' show lineGroupOf, lineGroupsByRoot;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_back_button.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/package_delivery_widgets.dart';
import 'package_result_screen.dart';
import 'package_scan_screen.dart';

/// The Deliveries home for the agent at the destination
/// (docs/AIR_PACKAGES.md §1.2): **To hand over** - this business's
/// shipments and containers that are ready for pickup, each with the
/// packages still to hand over (code, receiver, pieces) - a big **Scan**
/// button to the label scanner, and **Enter a code**. Tapping a package
/// opens the Mark delivered sheet (with the pickup code when the business
/// asks for one); its Details icon opens the package page.
///
/// Opened by deliveries-only staff from the menu with the [access] they
/// hold: no prices, edits or container pages anywhere behind it.
class DeliveriesHomeScreen extends StatefulWidget {
  const DeliveriesHomeScreen({
    super.key,
    required this.businessId,
    this.access,
    this.source,
    this.repository,
    this.deliveryService = const ContainerDeliveryService(),
    this.photoCapture,
    this.photoUploader,
    this.cameraEnabled = true,
  });

  final String businessId;

  /// What this person may see and do; null reads the signed-in person's.
  final PackageAccess? access;

  /// Where the sections come from; Firestore when null.
  final DeliveriesHomeSource? source;

  /// Handed to the scan and package screens (a fake in widget tests).
  final ContainerPackageRepository? repository;
  final ContainerDeliveryService deliveryService;
  final DeliveryPhotoCapture? photoCapture;
  final DeliveryPhotoUploader? photoUploader;

  /// Off in widget tests, where there is no camera plugin.
  @visibleForTesting
  final bool cameraEnabled;

  @override
  State<DeliveriesHomeScreen> createState() => _DeliveriesHomeScreenState();
}

class _DeliveriesHomeScreenState extends State<DeliveriesHomeScreen> {
  late final DeliveriesHomeSource _source =
      widget.source ?? FirestoreDeliveriesHomeSource();
  final List<StreamSubscription<Object?>> _subs = [];
  Timer? _safety;

  List<ArrivedContainer>? _containers;
  List<HandoverLine>? _lines;
  PackageProofSettings _proof = const PackageProofSettings();

  /// Precomputed when either stream moves, never per build.
  List<HandoverSection> _sections = const [];
  Map<String, LineGroupSummary> _groups = const {};
  bool _failed = false;

  /// A package is open on top: a second tap must not open another.
  bool _opening = false;

  PackageAccess get _access => widget.access ?? packageAccessOf(context);
  bool get _loaded => _containers != null && _lines != null;

  @override
  void initState() {
    super.initState();
    _listen();
  }

  void _listen() {
    for (final s in _subs) {
      s.cancel();
    }
    _subs.clear();
    _safety?.cancel();
    // Loading always resolves: after 15 s without both answers the screen
    // says it could not load, with Retry.
    _safety = Timer(const Duration(seconds: 15), () {
      if (mounted && !_loaded) setState(() => _failed = true);
    });
    _subs.add(
      _source
          .watchArrivedContainers(widget.businessId)
          .listen((list) => _onData(containers: list), onError: _onError),
    );
    _subs.add(
      _source
          .watchArrivedLines(widget.businessId)
          .listen((list) => _onData(lines: list), onError: _onError),
    );
    _subs.add(
      _source
          .watchProofSettings(widget.businessId)
          .listen(
            (proof) {
              if (mounted) setState(() => _proof = proof);
            },
            // Unreadable switches read as off; the server still decides.
            onError: (Object _) {},
          ),
    );
  }

  void _onData({
    List<ArrivedContainer>? containers,
    List<HandoverLine>? lines,
  }) {
    if (!mounted) return;
    if (containers != null) _containers = containers;
    if (lines != null) _lines = lines;
    if (!_loaded) {
      setState(() {});
      return;
    }
    _safety?.cancel();
    final all = _lines!;
    setState(() {
      _failed = false;
      _sections = handoverSections(_containers!, all);
      _groups = lineGroupsByRoot([for (final row in all) row.line]);
    });
  }

  void _onError(Object _) {
    if (!mounted) return;
    _safety?.cancel();
    setState(() => _failed = true);
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _safety?.cancel();
    super.dispose();
  }

  Future<void> _scan() async {
    if (_opening) return;
    setState(() => _opening = true);
    try {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => PackageScanScreen(
            businessId: widget.businessId,
            deliveries: true,
            access: _access,
            repository: widget.repository,
            deliveryService: widget.deliveryService,
            cameraEnabled: widget.cameraEnabled,
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  Future<void> _enterCode() async {
    if (_opening) return;
    final code = await showLotSheet<String>(
      context,
      const _EnterCodeSheet(),
    );
    if (code == null || !mounted) return;
    await _openPackage(code: code);
  }

  Future<void> _openPackage({String code = '', String lineId = ''}) async {
    if (_opening) return;
    setState(() => _opening = true);
    try {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => PackageResultScreen(
            businessId: widget.businessId,
            code: code,
            lineId: lineId,
            access: _access,
            repository: widget.repository,
            deliveryService: widget.deliveryService,
            groupLines: [for (final row in _lines ?? const []) row.line],
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  Future<void> _deliver(HandoverLine row) async {
    if (_opening) return;
    setState(() => _opening = true);
    try {
      await showMarkDeliveredSheet(
        context,
        businessId: widget.businessId,
        line: row.line,
        group: lineGroupOf(row.line, _groups),
        access: _access,
        service: widget.deliveryService,
        askPickupCode: deliveryAsksPickupCode(
          businessPickupCode: _proof.pickupCode,
          linePickupCode: row.hasPickupCode ? '*' : '',
        ),
        photoCapture: widget.photoCapture,
        photoUploader: widget.photoUploader,
      );
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final count = handoverCount(_sections);
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          Container(
            decoration: BoxDecoration(
              color: AppColors.paper,
              border: Border(
                bottom: BorderSide(color: AppColors.rule.withValues(alpha: 0.8)),
              ),
            ),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  4,
                  4,
                  AppSpacing.lg,
                  AppSpacing.md,
                ),
                child: Row(
                  children: [
                    const AppBackButton(),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            l10n.deliverHomeTitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w700,
                              height: 1.1,
                              letterSpacing: -0.4,
                              color: AppColors.ink,
                            ),
                          ),
                          Text(
                            l10n.deliverHomeSubtitle,
                            maxLines: 2,
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
          ),
          Expanded(
            child: !_loaded && !_failed
                ? const Center(child: CircularProgressIndicator())
                : _failed && !_loaded
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.cloud_off_outlined,
                            size: 36,
                            color: AppColors.muted,
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          Text(
                            l10n.deliverCouldNotLoad,
                            key: const Key('deliveries-failed'),
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize: 14,
                              height: 1.4,
                              color: AppColors.ink,
                            ),
                          ),
                          const SizedBox(height: AppSpacing.md),
                          OutlinedButton(
                            key: const Key('deliveries-retry'),
                            onPressed: () {
                              setState(() => _failed = false);
                              _listen();
                            },
                            child: Text(l10n.deliverRetry),
                          ),
                        ],
                      ),
                    ),
                  )
                : ListView(
                    key: const Key('deliveries-home'),
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg,
                      AppSpacing.md,
                      AppSpacing.lg,
                      AppSpacing.xl,
                    ),
                    children: [
                      _ScanButton(
                        enabled: !_opening,
                        onTap: _scan,
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      OutlinedButton.icon(
                        key: const Key('deliveries-enter-code'),
                        onPressed: _opening ? null : _enterCode,
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(0, 44),
                        ),
                        icon: const Icon(Icons.keyboard_outlined, size: 18),
                        label: Text(l10n.deliverEnterCode),
                      ),
                      const SizedBox(height: AppSpacing.lg),
                      Text(
                        count > 0
                            ? '${l10n.deliverToHandOver} · $count'
                            : l10n.deliverToHandOver,
                        key: const Key('deliveries-to-hand-over'),
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.2,
                          color: AppColors.muted,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      if (_sections.isEmpty)
                        LotEmptyState(
                          key: const Key('deliveries-empty'),
                          icon: Icons.inventory_2_outlined,
                          title: l10n.deliverToHandOverEmpty,
                          hint: l10n.deliverToHandOverEmptyHint,
                        )
                      else
                        for (var i = 0; i < _sections.length; i++)
                          RiseIn(
                            key: ValueKey(
                              'deliveries-section:${_sections[i].container.id}',
                            ),
                            index: i,
                            child: _SectionCard(
                              section: _sections[i],
                              enabled: !_opening,
                              onDeliver: _deliver,
                              onDetails: (row) => _openPackage(
                                code: row.line.trackingCode,
                                lineId: row.line.trackingCode.isEmpty
                                    ? row.line.id
                                    : '',
                              ),
                            ),
                          ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

/// The big Scan button: the agent's first move on every package.
class _ScanButton extends StatelessWidget {
  const _ScanButton({required this.enabled, required this.onTap});

  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Semantics(
      button: true,
      enabled: enabled,
      child: PressableScale(
        onTap: enabled ? onTap : null,
        child: Container(
          key: const Key('deliveries-scan'),
          height: 64,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: enabled
                ? AppColors.cobalt
                : AppColors.cobalt.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.qr_code_scanner, color: Colors.white, size: 26),
              const SizedBox(width: AppSpacing.sm),
              Flexible(
                child: Text(
                  l10n.deliverScan,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One shipment or container: its name, "X of Y delivered", and each
/// package still to hand over.
class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.section,
    required this.enabled,
    required this.onDeliver,
    required this.onDetails,
  });

  final HandoverSection section;
  final bool enabled;
  final ValueChanged<HandoverLine> onDeliver;
  final ValueChanged<HandoverLine> onDetails;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final container = section.container;
    final kind = section.isAir ? l10n.deliverShipment : l10n.deliverContainer;
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule.withValues(alpha: 0.8)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              AppSpacing.md,
              AppSpacing.md,
              AppSpacing.sm,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      section.isAir
                          ? Icons.flight_takeoff
                          : Icons.view_in_ar_outlined,
                      size: 18,
                      color: AppColors.cobaltDeep,
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        '$kind · ${container.displayName}',
                        key: ValueKey('deliveries-container:${container.id}'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                ContainerDeliveryProgressLabel(container: container),
              ],
            ),
          ),
          if (section.lines.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.md,
                0,
                AppSpacing.md,
                AppSpacing.md,
              ),
              child: Text(
                l10n.deliverToHandOverEmpty,
                style: const TextStyle(fontSize: 13, color: AppColors.muted),
              ),
            )
          else
            for (final row in section.lines)
              _LineRow(
                key: ValueKey('deliveries-line:${row.line.id}'),
                row: row,
                enabled: enabled,
                onDeliver: () => onDeliver(row),
                onDetails: () => onDetails(row),
              ),
        ],
      ),
    );
  }
}

class _LineRow extends StatelessWidget {
  const _LineRow({
    super.key,
    required this.row,
    required this.enabled,
    required this.onDeliver,
    required this.onDetails,
  });

  final HandoverLine row;
  final bool enabled;
  final VoidCallback onDeliver;
  final VoidCallback onDetails;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final line = row.line;
    final pieces = line.allPieces.isNotEmpty
        ? line.allPieces.length
        : (line.quantity > 0 ? line.quantity : 1);
    final receiver = line.receiverName.isNotEmpty
        ? line.receiverName
        : line.customerName;
    final phone = line.receiverPhone.isNotEmpty
        ? line.receiverPhone
        : line.customerPhone;
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: enabled ? onDeliver : null,
        child: Container(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            AppSpacing.sm,
            AppSpacing.xs,
            AppSpacing.sm,
          ),
          decoration: BoxDecoration(
            border: Border(
              top: BorderSide(color: AppColors.rule.withValues(alpha: 0.6)),
            ),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          line.trackingCode.isEmpty ? '—' : line.trackingCode,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.3,
                            color: AppColors.cobaltDeep,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.sm),
                        Text(
                          l10n.deliverPieces(pieces),
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.muted,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      phone.isEmpty ? receiver : '$receiver · $phone',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 13.5,
                        height: 1.3,
                        color: AppColors.ink,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                key: ValueKey('deliveries-details:${line.id}'),
                tooltip: l10n.deliverDetails,
                onPressed: enabled ? onDetails : null,
                icon: const Icon(
                  Icons.info_outline,
                  size: 20,
                  color: AppColors.muted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "Enter a code": a package code typed by hand, answered normalised.
class _EnterCodeSheet extends StatefulWidget {
  const _EnterCodeSheet();

  @override
  State<_EnterCodeSheet> createState() => _EnterCodeSheetState();
}

class _EnterCodeSheetState extends State<_EnterCodeSheet> {
  final _code = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  void _submit() {
    final l10n = AppLocalizations.of(context)!;
    final code = packageCodeFromScan(_code.text);
    if (code == null) {
      AppHaptics.refuse();
      setState(() => _error = l10n.deliverCodeInvalid);
      return;
    }
    Navigator.of(context).pop(code);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return LotSheetShell(
      title: l10n.deliverEnterCode,
      body: TextField(
        key: const Key('deliveries-code'),
        controller: _code,
        autofocus: true,
        autocorrect: false,
        textCapitalization: TextCapitalization.characters,
        textInputAction: TextInputAction.search,
        onChanged: (_) {
          if (_error != null) setState(() => _error = null);
        },
        onSubmitted: (_) => _submit(),
        decoration: InputDecoration(
          labelText: l10n.pkgTypeCode,
          hintText: l10n.deliverEnterCodeHint,
          errorText: _error,
          prefixIcon: const Icon(
            Icons.qr_code_2,
            size: 20,
            color: AppColors.muted,
          ),
        ),
      ),
      footer: LotSheetButton(
        key: const Key('deliveries-code-find'),
        label: l10n.deliverFind,
        tone: LotTone.good,
        onTap: _submit,
      ),
    );
  }
}
