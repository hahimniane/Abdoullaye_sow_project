import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../services/parking_lots.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/parking_lots_localization.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/language_toggle.dart';

/// The owner's list of parking lots (docs/PARKING_LOTS.md): add a lot, rename
/// it, set its spaces and address, close or reopen it, and choose where
/// online bookings go. A business that never set lots up sees its one lot
/// under the default name; saving anything turns its parking settings into
/// that lot (the server does it).
///
/// The server is the authority: its refusals ("a lot with cars in it cannot
/// be closed") come back as `details.reason` and are shown in words.
class ParkingLotsSettingsScreen extends StatefulWidget {
  const ParkingLotsSettingsScreen({
    super.key,
    required this.businessId,
    this.service,
  });

  final String businessId;

  /// Injectable so a widget test runs without Firebase.
  final ParkingLotsService? service;

  @override
  State<ParkingLotsSettingsScreen> createState() =>
      _ParkingLotsSettingsScreenState();
}

class _ParkingLotsSettingsScreenState extends State<ParkingLotsSettingsScreen> {
  late final ParkingLotsService _service;
  StreamSubscription<List<ParkingLot>>? _sub;
  Timer? _safety;
  List<ParkingLot> _stored = const [];
  ParkingBusinessSettings _settings = const ParkingBusinessSettings();
  bool _loaded = false;
  bool _loadFailed = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? ParkingLotsService();
    // The list always resolves: an answer, an error, or this timer.
    _safety = Timer(const Duration(seconds: 8), () {
      if (mounted && !_loaded) setState(() => _loaded = true);
    });
    unawaited(_loadSettings());
    try {
      _sub = _service
          .watchLots(widget.businessId)
          .listen(
            (lots) {
              if (!mounted) return;
              setState(() {
                _stored = lots;
                _loaded = true;
                _loadFailed = false;
              });
            },
            onError: (Object _) {
              if (!mounted) return;
              setState(() {
                _loaded = true;
                _loadFailed = true;
              });
            },
          );
    } catch (_) {
      _loaded = true;
      _loadFailed = true;
    }
  }

  @override
  void dispose() {
    _safety?.cancel();
    unawaited(_sub?.cancel());
    super.dispose();
  }

  Future<void> _loadSettings() async {
    try {
      final settings = await _service.readSettings(widget.businessId);
      if (mounted) setState(() => _settings = settings);
    } catch (_) {
      // The defaults stand: the first lot reads as having no spaces set.
    }
  }

  List<ParkingLot> _shown(AppLocalizations l10n) => parkingLotsOrFirst(
    stored: _stored,
    businessId: widget.businessId,
    settings: _settings,
    firstName: 'Lot 1',
  );

  /// Opens the form; [lot] null adds one. The first lot of a business with
  /// none stored has no id yet: it is edited under its id-to-be.
  Future<void> _openForm(ParkingLot? lot) async {
    final l10n = AppLocalizations.of(context)!;
    final shown = _shown(l10n);
    final draft = lot == null
        ? ParkingLotDraft(name: 'Lot ${shown.length + 1}')
        : ParkingLotDraft.from(lot);
    final editingFirst = lot != null && lot.id.isEmpty;
    final lotId = editingFirst
        ? mainParkingLotId(widget.businessId)
        : (lot?.id ?? '');
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetContext) => _LotForm(
        initial: draft,
        isNew: lot == null,
        canClose: lot != null && lot.id.isNotEmpty,
        onSave: (typed) => _save(typed, lotId, editingFirst),
      ),
    );
    if (saved == true && mounted) {
      showSuccessSnackBar(context, AppLocalizations.of(context)!.pltSaved);
      unawaited(_loadSettings());
    }
  }

  /// Saves one lot; returns the sentence to show when it is refused, else
  /// null. Mirrors the console: a first lot not yet stored is made real by
  /// the server before it is edited.
  Future<String?> _save(
    ParkingLotDraft typed,
    String lotId,
    bool editingFirst,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    final errors = parkingLotDraftErrors(typed, _stored, lotId: lotId);
    if (errors.isNotEmpty) return parkingLotErrorText(l10n, errors.first);
    setState(() => _busy = true);
    try {
      if (editingFirst && _stored.isEmpty) {
        await _service.setBookingLot(
          businessId: widget.businessId,
          lotId: lotId,
        );
      }
      await _service.saveLot(
        businessId: widget.businessId,
        draft: typed,
        lotId: lotId,
      );
      return null;
    } catch (failure) {
      if (!mounted) return l10n.pltSaveFailed;
      return parkingLotFailureText(l10n, failure, l10n.pltSaveFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendBookingsTo(String lotId) async {
    final l10n = AppLocalizations.of(context)!;
    setState(() => _busy = true);
    try {
      await _service.setBookingLot(businessId: widget.businessId, lotId: lotId);
      await _loadSettings();
      if (!mounted) return;
      showSuccessSnackBar(context, l10n.pltSaved);
    } catch (failure) {
      if (!mounted) return;
      showErrorSnackBar(
        context,
        parkingLotFailureText(l10n, failure, l10n.pltBookingSaveFailed),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.watch<AuthProvider>();
    final canEdit = auth.isBusinessOwner || auth.isAdmin;
    final shown = _shown(l10n);
    final openLots = openParkingLots(shown);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.pltSettingsTitle),
        actions: const [LanguageToggle()],
      ),
      body: Stack(
        children: [
          if (!_loaded)
            const Center(child: CircularProgressIndicator())
          else
            ListView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              children: [
                Text(
                  l10n.pltSettingsHint,
                  style: const TextStyle(color: AppColors.muted, fontSize: 13),
                ),
                if (_loadFailed) ...[
                  const SizedBox(height: AppSpacing.md),
                  Text(
                    l10n.pltLoadFailed,
                    key: const ValueKey<String>('parking-lots-load-failed'),
                    style: const TextStyle(color: AppColors.warn),
                  ),
                ],
                if (!canEdit) ...[
                  const SizedBox(height: AppSpacing.md),
                  Text(l10n.pltOwnerOnly),
                ],
                const SizedBox(height: AppSpacing.lg),
                for (final lot in shown)
                  _LotCard(
                    key: ValueKey<String>(
                      'lot-${lot.id.isEmpty ? 'first' : lot.id}',
                    ),
                    lot: lot,
                    onEdit: canEdit && !_busy ? () => _openForm(lot) : null,
                  ),
                if (openLots.length >= 2) ...[
                  const SizedBox(height: AppSpacing.md),
                  DropdownButtonFormField<String>(
                    key: ValueKey<String>(
                      'booking-lot-${parkingBookingLotIdOf(shown, _settings)}',
                    ),
                    initialValue: parkingBookingLotIdOf(shown, _settings),
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: l10n.pltBookingsGoTo,
                      helperText: l10n.pltBookingsHint,
                      helperMaxLines: 3,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    items: [
                      for (final lot in openLots)
                        DropdownMenuItem<String>(
                          value: lot.id,
                          child: Text(
                            lot.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: canEdit && !_busy
                        ? (id) => id == null ? null : _sendBookingsTo(id)
                        : null,
                  ),
                ],
                // Room for the button below the last row.
                const SizedBox(height: 88),
              ],
            ),
          if (_busy)
            const Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: LinearProgressIndicator(minHeight: 3),
            ),
        ],
      ),
      floatingActionButton: canEdit
          ? FloatingActionButton.extended(
              key: const ValueKey<String>('parking-lot-add'),
              onPressed: _busy || !_loaded ? null : () => _openForm(null),
              icon: const Icon(Icons.add),
              label: Text(l10n.pltAddLot),
            )
          : null,
    );
  }
}

class _LotCard extends StatelessWidget {
  const _LotCard({super.key, required this.lot, required this.onEdit});

  final ParkingLot lot;
  final VoidCallback? onEdit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final spaces = [
      l10n.pltSpacesCount(lot.totalSpaces),
      if (lot.blockedSpaces > 0) l10n.pltSpacesBlocked(lot.blockedSpaces),
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: AppColors.paper,
          border: Border.all(color: AppColors.rule),
          borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        ),
        child: Row(
          children: [
            Expanded(
              child: Opacity(
                opacity: lot.open ? 1 : 0.6,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      lot.open
                          ? lot.name
                          : '${lot.name} · ${l10n.pltStripClosed}',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      spaces,
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppColors.muted,
                      ),
                    ),
                    Text(
                      lot.addressLine.isEmpty
                          ? l10n.pltAtBusinessAddress
                          : lot.addressLine,
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (onEdit != null)
              IconButton(
                key: ValueKey<String>('lot-edit-${lot.id}'),
                tooltip: l10n.pltEditLot,
                onPressed: onEdit,
                icon: const Icon(Icons.edit_outlined),
              ),
          ],
        ),
      ),
    );
  }
}

/// The add / edit form, a sheet that stays open on a refusal so the owner
/// reads it and corrects the lot.
class _LotForm extends StatefulWidget {
  const _LotForm({
    required this.initial,
    required this.isNew,
    required this.canClose,
    required this.onSave,
  });

  final ParkingLotDraft initial;
  final bool isNew;

  /// Whether the "Open" switch is offered (a stored lot; the first lot of a
  /// business with none stored cannot be closed).
  final bool canClose;
  final Future<String?> Function(ParkingLotDraft draft) onSave;

  @override
  State<_LotForm> createState() => _LotFormState();
}

class _LotFormState extends State<_LotForm> {
  late final TextEditingController _name;
  late final TextEditingController _spaces;
  late final TextEditingController _blocked;
  late final TextEditingController _address;
  late final TextEditingController _city;
  late final TextEditingController _state;
  late bool _open;
  bool _busy = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    final d = widget.initial;
    _name = TextEditingController(text: d.name);
    _spaces = TextEditingController(text: d.totalSpaces);
    _blocked = TextEditingController(text: d.blockedSpaces);
    _address = TextEditingController(text: d.addressLine1);
    _city = TextEditingController(text: d.city);
    _state = TextEditingController(text: d.state);
    _open = d.open;
  }

  @override
  void dispose() {
    for (final c in [_name, _spaces, _blocked, _address, _city, _state]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final failedText = AppLocalizations.of(context)!.pltSaveFailed;
    setState(() {
      _busy = true;
      _error = '';
    });
    String? refusal;
    try {
      refusal = await widget.onSave(
        ParkingLotDraft(
          name: _name.text,
          addressLine1: _address.text,
          city: _city.text,
          state: _state.text,
          zipCode: widget.initial.zipCode,
          totalSpaces: _spaces.text,
          blockedSpaces: _blocked.text,
          open: _open,
        ),
      );
    } catch (_) {
      refusal = failedText;
    }
    if (!mounted) return;
    if (refusal == null) {
      Navigator.of(context).pop(true);
      return;
    }
    setState(() {
      _busy = false;
      _error = refusal!;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    Widget field(
      TextEditingController controller,
      String label, {
      TextInputType? keyboard,
      Key? key,
      int? maxLength,
    }) => TextField(
      key: key,
      controller: controller,
      enabled: !_busy,
      keyboardType: keyboard,
      maxLength: maxLength,
      decoration: InputDecoration(
        labelText: label,
        counterText: '',
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.lg,
        AppSpacing.lg,
        MediaQuery.of(context).viewInsets.bottom + AppSpacing.lg,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              widget.isNew ? l10n.pltAddLot : l10n.pltEditLot,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            if (_error.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.md),
              Text(
                _error,
                key: const ValueKey<String>('parking-lot-form-error'),
                style: const TextStyle(color: AppColors.warn),
              ),
            ],
            const SizedBox(height: AppSpacing.lg),
            field(
              _name,
              l10n.pltLotName,
              key: const ValueKey<String>('lot-name'),
              maxLength: 60,
            ),
            const SizedBox(height: AppSpacing.md),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: field(
                    _spaces,
                    l10n.pltSpaces,
                    key: const ValueKey<String>('lot-spaces'),
                    keyboard: TextInputType.number,
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: field(
                    _blocked,
                    l10n.pltBlockedSpaces,
                    key: const ValueKey<String>('lot-blocked'),
                    keyboard: TextInputType.number,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            field(_address, l10n.pltAddressOptional, maxLength: 200),
            const SizedBox(height: AppSpacing.md),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: field(_city, l10n.pltCity, maxLength: 120)),
                const SizedBox(width: AppSpacing.md),
                Expanded(child: field(_state, l10n.pltState, maxLength: 80)),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              l10n.pltAddressHint,
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            if (widget.canClose)
              SwitchListTile(
                key: const ValueKey<String>('lot-open'),
                contentPadding: EdgeInsets.zero,
                title: Text(l10n.pltOpenToggle),
                value: _open,
                onChanged: _busy ? null : (v) => setState(() => _open = v),
              ),
            const SizedBox(height: AppSpacing.lg),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _busy ? null : () => Navigator.of(context).pop(),
                    child: Text(l10n.cancel),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: FilledButton(
                    key: const ValueKey<String>('lot-save'),
                    onPressed: _busy ? null : _save,
                    child: _busy
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(l10n.pltSaveLot),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// The single row on the business profile that opens the lots settings.
/// Shown to the owner (or an admin) only; reads the business from the
/// signed-in profile.
class ParkingLotsEntryRow extends StatelessWidget {
  const ParkingLotsEntryRow({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.read<AuthProvider>();
    final businessId = (auth.businessId ?? '').trim();
    if (businessId.isEmpty || !(auth.isBusinessOwner || auth.isAdmin)) {
      return const SizedBox.shrink();
    }
    final l10n = AppLocalizations.of(context)!;
    return ListTile(
      key: const ValueKey<String>('open-parking-lots-settings'),
      contentPadding: EdgeInsets.zero,
      leading: const Icon(Icons.local_parking_outlined),
      title: Text(l10n.pltSettingsTitle),
      subtitle: Text(l10n.pltSettingsRowSubtitle),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => ParkingLotsSettingsScreen(businessId: businessId),
        ),
      ),
    );
  }
}
