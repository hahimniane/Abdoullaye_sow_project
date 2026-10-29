import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import '../l10n/app_localizations.dart';
import '../models/office_location.dart';
import '../services/office_location_service.dart';
import '../services/package_request_service.dart';
import '../services/package_requests.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/package_request_widgets.dart';

/// The owner's package-request settings (§3): accept requests or not, the
/// request link (copy, share, QR), opening hours per location, the areas the
/// business picks up in, and card payment for barrels. Staff see the link
/// and its QR, and the rest read only (`setPackageRequestSettings` is the
/// owner's).
class PackageRequestSettingsScreen extends StatefulWidget {
  const PackageRequestSettingsScreen({
    super.key,
    required this.businessId,
    required this.canEdit,
    this.service,
    this.locations,
    this.onShare,
  });

  final String businessId;
  final bool canEdit;
  final PackageRequestService? service;

  /// The business's active locations; `officeLocations` when null.
  final Stream<List<OfficeLocation>> Function(String businessId)? locations;

  /// Shares the link; the system sheet when null.
  final Future<void> Function(String link)? onShare;

  @override
  State<PackageRequestSettingsScreen> createState() =>
      _PackageRequestSettingsScreenState();
}

class _PackageRequestSettingsScreenState
    extends State<PackageRequestSettingsScreen> {
  late final PackageRequestService _service =
      widget.service ?? FirebasePackageRequestService();
  StreamSubscription<PackageRequestSettings>? _settingsSub;
  StreamSubscription<List<OfficeLocation>>? _locationsSub;
  Timer? _safety;

  PackageRequestSettings? _saved;
  List<OfficeLocation>? _locations;
  bool _loaded = false;
  bool _failed = false;

  bool _accept = false;
  Map<String, RequestWeekHours> _hours = {};
  bool _pickup = false;
  final _areas = TextEditingController();
  bool _cardBarrels = false;
  PackageProofSettings _proof = const PackageProofSettings();
  final _slug = TextEditingController();

  Set<String> _errors = {};
  String _busy = '';

  @override
  void initState() {
    super.initState();
    _safety = Timer(const Duration(seconds: 20), () {
      if (mounted && !_loaded) {
        setState(() {
          _loaded = true;
          _failed = true;
        });
      }
    });
    _settingsSub = _service
        .watchSettings(widget.businessId)
        .listen(
          _onSettings,
          onError: (Object _) {
            if (!mounted) return;
            setState(() {
              _loaded = true;
              _failed = true;
            });
          },
        );
    final locations =
        widget.locations ?? (id) => OfficeLocationService().activeLocations(id);
    _locationsSub = locations(widget.businessId).listen(
      (list) {
        if (!mounted) return;
        setState(() => _locations = list);
      },
      onError: (Object _) {
        if (mounted) setState(() => _locations = const []);
      },
    );
  }

  @override
  void dispose() {
    _settingsSub?.cancel();
    _locationsSub?.cancel();
    _safety?.cancel();
    _areas.dispose();
    _slug.dispose();
    super.dispose();
  }

  void _onSettings(PackageRequestSettings settings) {
    if (!mounted) return;
    final first = _saved == null;
    setState(() {
      _saved = settings;
      _loaded = true;
      _failed = false;
      if (first) {
        _accept = settings.acceptRequests;
        _hours = {...settings.openingHours};
        _pickup = settings.pickupEnabled;
        _areas.text = settings.pickupAreas;
        _cardBarrels = settings.cardBarrelBooking;
        _proof = settings.proof;
        _slug.text = settings.requestSlug;
      } else if (_slug.text.isEmpty) {
        _slug.text = settings.requestSlug;
      }
    });
    _safety?.cancel();
  }

  /// The places hours are kept for: the active locations, or the main
  /// address when the business keeps none.
  List<({String id, String title})> get _places {
    final list = _locations ?? const <OfficeLocation>[];
    if (list.isEmpty) {
      return [(id: requestDefaultLocationId, title: '')];
    }
    return [
      for (final l in list)
        (id: l.id, title: l.label.isNotEmpty ? l.label : l.address),
    ];
  }

  RequestWeekHours _weekOf(String id) =>
      _hours[id] ?? RequestWeekHours.standard();

  Future<void> _pickTime(
    String placeId,
    String day, {
    required bool from,
  }) async {
    final week = _weekOf(placeId);
    final hours = week.day(day);
    final minutes =
        requestMinutesOf(from ? hours.from : hours.to) ?? (from ? 540 : 1080);
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: minutes ~/ 60, minute: minutes % 60),
    );
    if (picked == null || !mounted) return;
    final value = requestHhmm(picked.hour * 60 + picked.minute);
    setState(() {
      _hours = {
        ..._hours,
        placeId: week.withDay(
          day,
          from ? hours.copyWith(from: value) : hours.copyWith(to: value),
        ),
      };
      _errors = {..._errors}..remove('hours_invalid');
    });
  }

  void _setOpen(String placeId, String day, bool open) {
    final week = _weekOf(placeId);
    final hours = week.day(day);
    setState(() {
      _hours = {
        ..._hours,
        placeId: week.withDay(
          day,
          hours.copyWith(
            open: open,
            from: hours.from.isEmpty ? '09:00' : hours.from,
            to: hours.to.isEmpty ? '18:00' : hours.to,
          ),
        ),
      };
      _errors = {..._errors}..remove('hours_invalid');
    });
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    final saved = _saved;
    if (_busy.isNotEmpty || !widget.canEdit) return;
    final hours = {for (final place in _places) place.id: _weekOf(place.id)};
    final currentSlug = saved?.requestSlug ?? '';
    final slug = (saved?.slugEditable ?? true) ? _slug.text : '';
    final reasons = validateRequestSettings(
      openingHours: hours,
      pickupEnabled: _pickup,
      pickupAreas: _areas.text,
      slug: slug,
      currentSlug: currentSlug,
    );
    if (reasons.isNotEmpty) {
      AppHaptics.refuse();
      // Each problem shows at its own field (hours, areas, link name).
      setState(() => _errors = reasons.toSet());
      return;
    }
    setState(() {
      _busy = 'save';
      _errors = {};
    });
    try {
      final result = await _service.saveSettings(
        requestSettingsPayload(
          businessId: widget.businessId,
          acceptRequests: _accept,
          openingHours: hours,
          pickupEnabled: _pickup,
          pickupAreas: _areas.text,
          cardBarrelBooking: _cardBarrels,
          slug: slug,
          currentSlug: currentSlug,
          proof: _proof,
        ),
      );
      if (!mounted) return;
      if (result.requestSlug.isNotEmpty) _slug.text = result.requestSlug;
      // The switches as the server kept them.
      _proof = result.proof;
      AppHaptics.commit();
      showSuccessSnackBar(context, l10n.prqSaved);
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _errors = failure.refusal.reasons.toSet());
      showErrorSnackBar(context, requestRefusalText(l10n, failure.refusal));
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _copy(String link) async {
    final l10n = AppLocalizations.of(context)!;
    await Clipboard.setData(ClipboardData(text: link));
    if (!mounted) return;
    showSuccessSnackBar(context, l10n.prqCopied);
  }

  Future<void> _share(String link) async {
    final share = widget.onShare;
    if (share != null) return share(link);
    await SharePlus.instance.share(ShareParams(text: link));
  }

  Future<void> _showQr() async {
    final l10n = AppLocalizations.of(context)!;
    if (_busy.isNotEmpty) return;
    setState(() => _busy = 'qr');
    try {
      final qr = await _service.linkQr(widget.businessId);
      if (!mounted) return;
      // Loaded: the button stops spinning while the QR is on screen.
      setState(() => _busy = '');
      final png = qr.png;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(l10n.prqShowQr),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (png != null)
                Image.memory(
                  png,
                  key: const Key('settings-qr-image'),
                  width: 220,
                  height: 220,
                )
              else
                const Icon(Icons.qr_code_2, size: 120, color: AppColors.muted),
              const SizedBox(height: AppSpacing.sm),
              SelectableText(qr.url, textAlign: TextAlign.center),
              const SizedBox(height: AppSpacing.sm),
              Text(
                l10n.prqQrHint,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(l10n.close),
            ),
          ],
        ),
      );
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      showErrorSnackBar(context, requestRefusalText(l10n, failure.refusal));
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    Widget body;
    if (!_loaded || _locations == null && !_failed) {
      body = const Center(child: CircularProgressIndicator());
    } else if (_failed && _saved == null) {
      body = Center(
        child: RequestLoadFailed(
          message: l10n.prqCouldNotLoad,
          onRetry: () {
            setState(() {
              _loaded = false;
              _failed = false;
            });
            _settingsSub?.cancel();
            _settingsSub = _service
                .watchSettings(widget.businessId)
                .listen(_onSettings);
          },
        ),
      );
    } else {
      body = _form(l10n);
    }
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          RequestPageHeader(title: l10n.prqSettingsTitle),
          Expanded(child: body),
        ],
      ),
    );
  }

  Widget _form(AppLocalizations l10n) {
    final locale = dateLocaleOf(context);
    final saved = _saved ?? const PackageRequestSettings();
    final edit = widget.canEdit && _busy.isEmpty;
    final link = saved.requestLink;
    return ListView(
      key: const Key('request-settings'),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        48,
      ),
      children: [
        if (!widget.canEdit)
          RequestBanner(
            key: const Key('settings-owner-only'),
            text: l10n.prqOwnerOnly,
            icon: Icons.lock_outline,
            color: AppColors.muted,
          ),
        RequestCard(
          child: SwitchListTile.adaptive(
            key: const Key('settings-accept'),
            contentPadding: EdgeInsets.zero,
            value: _accept,
            onChanged: edit ? (v) => setState(() => _accept = v) : null,
            title: Text(
              l10n.prqAccept,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            subtitle: Text(
              l10n.prqAcceptNote,
              style: const TextStyle(fontSize: 12.5),
            ),
          ),
        ),
        RequestSectionTitle(l10n.prqLinkTitle),
        RequestCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                link.isEmpty ? l10n.prqLinkNone : link,
                key: const Key('settings-link'),
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: link.isEmpty ? FontWeight.w400 : FontWeight.w700,
                  color: link.isEmpty ? AppColors.muted : AppColors.cobaltDeep,
                ),
              ),
              if (link.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.sm),
                Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: AppSpacing.sm,
                  children: [
                    OutlinedButton.icon(
                      key: const Key('settings-copy'),
                      onPressed: () => _copy(link),
                      icon: const Icon(Icons.copy, size: 16),
                      label: Text(l10n.prqCopy),
                    ),
                    OutlinedButton.icon(
                      key: const Key('settings-share'),
                      onPressed: () => _share(link),
                      icon: const Icon(Icons.ios_share, size: 16),
                      label: Text(l10n.prqShare),
                    ),
                    OutlinedButton.icon(
                      key: const Key('settings-qr'),
                      onPressed: _busy.isEmpty ? _showQr : null,
                      icon: _busy == 'qr'
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.qr_code_2, size: 16),
                      label: Text(l10n.prqShowQr),
                    ),
                  ],
                ),
              ],
              if (widget.canEdit) ...[
                const SizedBox(height: AppSpacing.md),
                TextField(
                  key: const Key('settings-slug'),
                  controller: _slug,
                  enabled: edit && saved.slugEditable,
                  maxLength: 40,
                  autocorrect: false,
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[a-zA-Z0-9-]')),
                  ],
                  onChanged: (_) => setState(
                    () =>
                        _errors = {..._errors}
                          ..removeAll(const ['slug_invalid', 'slug_taken']),
                  ),
                  decoration: InputDecoration(
                    labelText: l10n.prqSlugField,
                    helperText: saved.slugEditable
                        ? l10n.prqSlugHint
                        : l10n.prqSlugLocked,
                    helperMaxLines: 2,
                    counterText: '',
                    errorText: _errors.contains('slug_invalid')
                        ? l10n.prqErrSlugInvalid
                        : _errors.contains('slug_taken')
                        ? l10n.prqErrSlugTaken
                        : _errors.contains('slug_locked')
                        ? l10n.prqSlugLocked
                        : null,
                    errorMaxLines: 2,
                  ),
                ),
              ],
            ],
          ),
        ),
        RequestSectionTitle(l10n.prqHoursTitle),
        Text(
          l10n.prqHoursHint,
          style: const TextStyle(
            fontSize: 12.5,
            height: 1.35,
            color: AppColors.muted,
          ),
        ),
        if (_errors.contains('hours_invalid'))
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              l10n.prqErrHoursInvalid,
              key: const Key('settings-hours-error'),
              style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
            ),
          ),
        const SizedBox(height: AppSpacing.sm),
        for (final place in _places)
          RequestCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  place.title.isEmpty ? l10n.prqHeadquarters : place.title,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                for (var i = 0; i < requestWeekdays.length; i++)
                  _DayRow(
                    key: Key('settings-day:${place.id}:${requestWeekdays[i]}'),
                    dayLabel: displayWeekdayShort(
                      DateTime(2026, 1, 5 + i),
                      locale,
                    ),
                    hours: _weekOf(place.id).day(requestWeekdays[i]),
                    locale: locale,
                    enabled: edit,
                    onOpen: (open) =>
                        _setOpen(place.id, requestWeekdays[i], open),
                    onFrom: () =>
                        _pickTime(place.id, requestWeekdays[i], from: true),
                    onTo: () =>
                        _pickTime(place.id, requestWeekdays[i], from: false),
                  ),
              ],
            ),
          ),
        RequestSectionTitle(l10n.prqPickupSettingsTitle),
        RequestCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SwitchListTile.adaptive(
                key: const Key('settings-pickup'),
                contentPadding: EdgeInsets.zero,
                value: _pickup,
                onChanged: edit
                    ? (v) => setState(() {
                        _pickup = v;
                        _errors = {..._errors}..remove('pickup_areas_required');
                      })
                    : null,
                title: Text(
                  l10n.prqPickupSettingsTitle,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                subtitle: Text(
                  l10n.prqPickupSettingsNote,
                  style: const TextStyle(fontSize: 12.5),
                ),
              ),
              if (_pickup)
                TextField(
                  key: const Key('settings-areas'),
                  controller: _areas,
                  enabled: edit,
                  maxLength: requestMaxAreas,
                  minLines: 1,
                  maxLines: 3,
                  onChanged: (_) => setState(
                    () =>
                        _errors = {..._errors}..remove('pickup_areas_required'),
                  ),
                  decoration: InputDecoration(
                    labelText: l10n.prqAreas,
                    hintText: l10n.prqAreasHint,
                    counterText: '',
                    errorText: _errors.contains('pickup_areas_required')
                        ? l10n.prqErrPickupAreas
                        : null,
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        RequestCard(
          child: SwitchListTile.adaptive(
            key: const Key('settings-card-barrels'),
            contentPadding: EdgeInsets.zero,
            value: _cardBarrels,
            onChanged: edit ? (v) => setState(() => _cardBarrels = v) : null,
            title: Text(
              l10n.prqCardBarrels,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            subtitle: Text(
              l10n.prqCardBarrelsNote,
              style: const TextStyle(fontSize: 12.5),
            ),
          ),
        ),
        // Proof at every step (docs/AIR_PACKAGES.md §1.3): three switches,
        // all off by default, saved with the rest as `proof`.
        RequestSectionTitle(l10n.proofSettingTitle),
        RequestCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _ProofSwitch(
                key: const Key('settings-proof-photos'),
                value: _proof.photosRequired,
                title: l10n.proofSettingPhotosRequired,
                note: l10n.proofSettingPhotosRequiredNote,
                onChanged: edit
                    ? (v) => setState(
                        () => _proof = _proof.copyWith(photosRequired: v),
                      )
                    : null,
              ),
              _ProofSwitch(
                key: const Key('settings-proof-sender'),
                value: _proof.senderConfirm,
                title: l10n.proofSettingSenderConfirm,
                note: l10n.proofSettingSenderConfirmNote,
                onChanged: edit
                    ? (v) => setState(
                        () => _proof = _proof.copyWith(senderConfirm: v),
                      )
                    : null,
              ),
              _ProofSwitch(
                key: const Key('settings-proof-pickup-code'),
                value: _proof.pickupCode,
                title: l10n.proofSettingPickupCode,
                note: l10n.proofSettingPickupCodeNote,
                onChanged: edit
                    ? (v) =>
                          setState(() => _proof = _proof.copyWith(pickupCode: v))
                    : null,
              ),
              if (_errors.contains('proof_settings_invalid'))
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    l10n.deliverRefusalProofSettingsInvalid,
                    key: const Key('settings-proof-error'),
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.errorRed,
                    ),
                  ),
                ),
            ],
          ),
        ),
        if (widget.canEdit) ...[
          const SizedBox(height: AppSpacing.lg),
          RequestPrimaryButton(
            key: const Key('settings-save'),
            label: l10n.save,
            busyLabel: l10n.prqSaving,
            busy: _busy == 'save',
            onTap: _save,
          ),
        ],
      ],
    );
  }
}

/// One proof switch with its one-line explanation.
class _ProofSwitch extends StatelessWidget {
  const _ProofSwitch({
    super.key,
    required this.value,
    required this.title,
    required this.note,
    required this.onChanged,
  });

  final bool value;
  final String title;
  final String note;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    return SwitchListTile.adaptive(
      contentPadding: EdgeInsets.zero,
      value: value,
      onChanged: onChanged,
      title: Text(
        title,
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
      ),
      subtitle: Text(note, style: const TextStyle(fontSize: 12.5)),
    );
  }
}

class _DayRow extends StatelessWidget {
  const _DayRow({
    super.key,
    required this.dayLabel,
    required this.hours,
    required this.locale,
    required this.enabled,
    required this.onOpen,
    required this.onFrom,
    required this.onTo,
  });

  final String dayLabel;
  final RequestDayHours hours;
  final String locale;
  final bool enabled;
  final ValueChanged<bool> onOpen;
  final VoidCallback onFrom;
  final VoidCallback onTo;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        children: [
          SizedBox(
            width: 44,
            child: Text(
              dayLabel,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
          ),
          Switch.adaptive(
            value: hours.open,
            onChanged: enabled ? onOpen : null,
          ),
          const SizedBox(width: 4),
          Expanded(
            child: hours.open
                ? Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 2,
                    children: [
                      TextButton(
                        onPressed: enabled ? onFrom : null,
                        style: TextButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                          padding: const EdgeInsets.symmetric(horizontal: 4),
                        ),
                        child: Text(requestClockText(hours.from, locale)),
                      ),
                      const Text('–'),
                      TextButton(
                        onPressed: enabled ? onTo : null,
                        style: TextButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                          padding: const EdgeInsets.symmetric(horizontal: 4),
                        ),
                        child: Text(requestClockText(hours.to, locale)),
                      ),
                    ],
                  )
                : Text(
                    l10n.prqDayClosed,
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppColors.muted,
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}
