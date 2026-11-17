import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/team_staff.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import 'app_snackbars.dart';
import 'lot_sheets.dart';
import 'staff_permission_chips.dart';

/// A refusal of one of the team's callables in the app's own words.
String teamRefusalText(AppLocalizations l10n, TeamRefusal refusal) =>
    switch (refusal) {
      TeamRefusal.fullAccessOwnerOnly => l10n.pplErrFullAccessOwnerOnly,
      TeamRefusal.fullAccessStaffOnly => l10n.pplErrFullAccessStaffOnly,
      TeamRefusal.notMember => l10n.pplErrNotMember,
      TeamRefusal.linkOwnerOnly => l10n.pplErrLinkOwnerOnly,
      TeamRefusal.linkCustomerInvalid => l10n.pplErrLinkCustomer,
      TeamRefusal.actionInvalid => l10n.pplErrActionInvalid,
      TeamRefusal.notAllowed => l10n.pplErrNotAllowed,
      TeamRefusal.other => l10n.pplErrOther,
    };

/// Reads the business's parked cars of the last twelve months for the
/// Parking bill picker; a fake in tests.
typedef ParkingLinkCarsLoader =
    Future<List<Map<String, dynamic>>> Function(String businessId);

Future<List<Map<String, dynamic>>> loadParkingLinkCars(
  String businessId,
) async {
  final snapshot = await FirebaseFirestore.instance
      .collection('parkedCars')
      .where('businessId', isEqualTo: businessId)
      .where(
        'occupancyEndMs',
        isGreaterThanOrEqualTo: parkingLinkSinceMs(DateTime.now()),
      )
      .get();
  return [
    for (final doc in snapshot.docs) {...doc.data(), 'id': doc.id},
  ];
}

/// One person of the team: who they are, what they can manage (editable by
/// the owner), "Full access" (given or removed only by the real owner or a
/// super admin) and their own "Parking bill" (linked by the owner or a
/// platform admin). Every write shows progress, disables the others, says
/// what happened and always releases.
class TeamMemberCard extends StatefulWidget {
  const TeamMemberCard({
    super.key,
    required this.businessId,
    required this.member,
    this.canEditPermissions = false,
    this.canGrantFullAccess = false,
    this.canLinkParking = false,
    this.parkingLink,
    this.service = const TeamStaffService(),
    this.loadCars = loadParkingLinkCars,
  });

  final String businessId;
  final TeamMember member;
  final bool canEditPermissions;

  /// The real owner or a super admin: never a full-access person.
  final bool canGrantFullAccess;

  /// The real owner or a platform admin.
  final bool canLinkParking;
  final StaffParkingLink? parkingLink;
  final TeamStaffService service;
  final ParkingLinkCarsLoader loadCars;

  @override
  State<TeamMemberCard> createState() => _TeamMemberCardState();
}

class _TeamMemberCardState extends State<TeamMemberCard> {
  late List<String> _held = widget.member.permissions;

  /// What the server last held, so "Save" stays off until something changed.
  late List<String> _saved = widget.member.permissions;
  String _busy = '';
  String _error = '';

  @override
  void didUpdateWidget(TeamMemberCard old) {
    super.didUpdateWidget(old);
    // The live list moved (a save landed, or another phone changed it):
    // start from what it says.
    if (!samePermissions(old.member.permissions, widget.member.permissions)) {
      _held = widget.member.permissions;
      _saved = widget.member.permissions;
    }
  }

  bool get _changed => !samePermissions(_held, _saved);

  /// One shape for every write: confirm elsewhere, then disable the others,
  /// show progress on the one pressed, say what happened, release in
  /// `finally`.
  Future<void> _run(
    String action,
    Future<void> Function() work,
    String done,
  ) async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _busy = action;
      _error = '';
    });
    try {
      await work();
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(context, done);
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = teamRefusalText(l10n, teamRefusalOf(error)));
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<void> _savePermissions() async {
    final l10n = AppLocalizations.of(context)!;
    final name = widget.member.displayName;
    final ok = await confirmMajorAction(
      context,
      title: l10n.pplSavePermissionsTitle,
      message: l10n.pplSavePermissionsMessage(name),
      confirmLabel: l10n.pplSavePermissions,
      icon: Icons.save_outlined,
    );
    if (!ok || !mounted) return;
    final sent = List<String>.of(_held);
    await _run('permissions', () async {
      await widget.service.savePermissions(
        widget.businessId,
        widget.member.id,
        sent,
      );
      if (mounted) setState(() => _saved = sent);
    }, l10n.pplPermissionsSaved);
  }

  Future<void> _setFullAccess(bool on) async {
    final l10n = AppLocalizations.of(context)!;
    final name = widget.member.displayName;
    final ok = await confirmMajorAction(
      context,
      title: on ? l10n.pplGiveFullAccessTitle : l10n.pplRemoveFullAccessTitle,
      message: on
          ? l10n.pplGiveFullAccessMessage(name)
          : l10n.pplRemoveFullAccessMessage(name),
      confirmLabel: on ? l10n.pplGiveFullAccess : l10n.pplRemoveFullAccess,
      icon: Icons.verified_user_outlined,
    );
    if (!ok || !mounted) return;
    await _run(
      'fullAccess',
      () => widget.service.setFullAccess(
        widget.businessId,
        widget.member.id,
        widget.member.permissions,
        on: on,
      ),
      on ? l10n.pplFullAccessGiven : l10n.pplFullAccessRemoved,
    );
  }

  Future<void> _link() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await showLotSheet<ParkingLinkCustomer>(
      context,
      StaffParkingLinkSheet(
        businessId: widget.businessId,
        staffName: widget.member.displayName,
        staffPhone: widget.member.phone,
        currentKey: widget.parkingLink?.customerKey ?? '',
        loadCars: widget.loadCars,
      ),
    );
    if (picked == null || !mounted) return;
    await _run(
      'link',
      () => widget.service.linkParking(
        widget.businessId,
        widget.member.id,
        picked,
      ),
      l10n.pplParkingLinked,
    );
  }

  Future<void> _unlink() async {
    final l10n = AppLocalizations.of(context)!;
    final ok = await confirmMajorAction(
      context,
      title: l10n.pplUnlinkTitle,
      message: l10n.pplUnlinkMessage(widget.member.displayName),
      confirmLabel: l10n.pplUnlink,
      icon: Icons.link_off,
      destructive: true,
    );
    if (!ok || !mounted) return;
    await _run(
      'unlink',
      () =>
          widget.service.linkParking(widget.businessId, widget.member.id, null),
      l10n.pplParkingUnlinked,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final member = widget.member;
    final busy = _busy.isNotEmpty;
    final link = widget.parkingLink;
    final tag = member.isOwner
        ? l10n.pplOwnerTag
        : member.fullAccess
        ? l10n.pplFullAccessTag
        : l10n.pplStaffTag;
    final contact = [
      member.email,
      member.phone,
    ].where((s) => s.isNotEmpty).join(' • ');
    return Container(
      key: Key('team-member:${member.id}'),
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: AppSpacing.md),
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                backgroundImage: member.imageUrl.isEmpty
                    ? null
                    : NetworkImage(member.imageUrl),
                child: member.imageUrl.isEmpty
                    ? const Icon(Icons.person_outline)
                    : null,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      member.displayName,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                      ),
                    ),
                    if (contact.isNotEmpty)
                      Text(
                        contact,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Container(
                key: Key('team-tag:${member.id}'),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: member.isOwner || member.fullAccess
                      ? AppColors.cobaltDeep
                      : AppColors.mist,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                ),
                child: Text(
                  tag,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: member.isOwner || member.fullAccess
                        ? Colors.white
                        : AppColors.cobaltDeep,
                  ),
                ),
              ),
            ],
          ),
          if (member.isStaff &&
              (widget.canGrantFullAccess || member.fullAccess)) ...[
            const SizedBox(height: AppSpacing.md),
            Text(
              l10n.pplFullAccessExplained,
              key: Key('team-full-access-note:${member.id}'),
              style: const TextStyle(
                fontSize: 12,
                height: 1.4,
                color: AppColors.muted,
              ),
            ),
            if (widget.canGrantFullAccess) ...[
              const SizedBox(height: AppSpacing.sm),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  key: Key('team-full-access:${member.id}'),
                  onPressed: busy
                      ? null
                      : () => _setFullAccess(!member.fullAccess),
                  icon: _busy == 'fullAccess'
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.verified_user_outlined, size: 18),
                  label: Text(
                    member.fullAccess
                        ? l10n.pplRemoveFullAccess
                        : l10n.pplGiveFullAccess,
                  ),
                ),
              ),
            ],
          ],
          if (member.isStaff) ...[
            const SizedBox(height: AppSpacing.md),
            Text(
              l10n.pplCanManage,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: AppSpacing.sm),
            StaffPermissionChips(
              selected: _held.toSet(),
              enabled: widget.canEditPermissions && !busy,
              onToggle: (permission, on) => setState(
                () => _held = togglePermission(_held, permission, on),
              ),
            ),
            if (widget.canEditPermissions) ...[
              const SizedBox(height: AppSpacing.md),
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton.icon(
                  key: Key('team-save-permissions:${member.id}'),
                  onPressed: busy || !_changed ? null : _savePermissions,
                  icon: _busy == 'permissions'
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.save_outlined, size: 18),
                  label: Text(l10n.pplSavePermissions),
                ),
              ),
            ],
          ] else
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.md),
              child: Text(
                l10n.pplOwnerAccessNote,
                style: const TextStyle(fontSize: 12, color: AppColors.muted),
              ),
            ),
          if (member.isStaff && (widget.canLinkParking || link != null)) ...[
            const SizedBox(height: AppSpacing.lg),
            Text(
              l10n.pplParkingBill,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 4),
            if (link != null)
              Text(
                [
                  link.label,
                  if (link.customerName.isNotEmpty &&
                      link.customerPhone.isNotEmpty)
                    link.customerPhone,
                ].join(' • '),
                key: Key('team-parking-link:${member.id}'),
                style: const TextStyle(fontWeight: FontWeight.w700),
              )
            else
              Text(
                l10n.pplNotLinked,
                key: Key('team-parking-link:${member.id}'),
                style: const TextStyle(color: AppColors.muted),
              ),
            const SizedBox(height: 2),
            Text(
              l10n.pplParkingBillHint,
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
            if (widget.canLinkParking) ...[
              const SizedBox(height: AppSpacing.sm),
              Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.xs,
                children: [
                  OutlinedButton.icon(
                    key: Key('team-link-parking:${member.id}'),
                    onPressed: busy ? null : _link,
                    icon: _busy == 'link'
                        ? const SizedBox.square(
                            dimension: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.link, size: 18),
                    label: Text(link == null ? l10n.pplLink : l10n.pplChange),
                  ),
                  if (link != null)
                    OutlinedButton.icon(
                      key: Key('team-unlink-parking:${member.id}'),
                      onPressed: busy ? null : _unlink,
                      icon: _busy == 'unlink'
                          ? const SizedBox.square(
                              dimension: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.link_off, size: 18),
                      label: Text(l10n.pplUnlink),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.errorRed,
                      ),
                    ),
                ],
              ),
            ],
          ],
          if (_error.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            Semantics(
              liveRegion: true,
              child: Text(
                _error,
                key: Key('team-error:${member.id}'),
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.errorRed,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The Parking bill picker: the business's parking customers (cars of the
/// last twelve months, grouped the way month-end bills group them), the
/// likely match first. Pops with the customer chosen.
class StaffParkingLinkSheet extends StatefulWidget {
  const StaffParkingLinkSheet({
    super.key,
    required this.businessId,
    required this.staffName,
    required this.staffPhone,
    required this.currentKey,
    this.loadCars = loadParkingLinkCars,
  });

  final String businessId;
  final String staffName;
  final String staffPhone;
  final String currentKey;
  final ParkingLinkCarsLoader loadCars;

  @override
  State<StaffParkingLinkSheet> createState() => _StaffParkingLinkSheetState();
}

class _StaffParkingLinkSheetState extends State<StaffParkingLinkSheet> {
  List<ParkingLinkCustomer>? _customers;
  bool _failed = false;
  String _search = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _failed = false;
      _customers = null;
    });
    try {
      final cars = await widget.loadCars(widget.businessId);
      if (mounted) setState(() => _customers = parkingLinkCustomers(cars));
    } catch (_) {
      // Always resolves: the picker says it could not load, with Try again.
      if (mounted) setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final customers = _customers;
    final choices = customers == null
        ? const <ParkingLinkChoice>[]
        : parkingLinkChoices(
            (name: widget.staffName, phone: widget.staffPhone),
            customers,
            search: _search,
          );
    final suggestedCount = choices.where((c) => c.suggested).length;
    return LotSheetShell(
      title: l10n.pplLinkSheetTitle,
      subtitle: widget.staffName,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.pplLinkSheetHint,
            style: const TextStyle(fontSize: 13, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('team-link-search'),
            onChanged: (v) => setState(() => _search = v),
            decoration: InputDecoration(
              hintText: l10n.pplFindCustomer,
              prefixIcon: const Icon(Icons.search, size: 20),
              isDense: true,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          if (_failed) ...[
            Text(
              l10n.pplCarsLoadFailed,
              key: const Key('team-link-failed'),
              style: const TextStyle(color: AppColors.errorRed),
            ),
            TextButton(onPressed: _load, child: Text(l10n.pplTryAgain)),
          ] else if (customers == null)
            const Padding(
              padding: EdgeInsets.all(AppSpacing.lg),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (choices.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
              child: Text(
                _search.trim().isEmpty ? l10n.pplNoCars : l10n.pplNoMatch,
                key: const Key('team-link-empty'),
                style: const TextStyle(color: AppColors.muted),
              ),
            )
          else
            for (var i = 0; i < choices.length; i++) ...[
              if (suggestedCount > 0 && i == 0) _GroupLabel(l10n.pplSuggested),
              if (suggestedCount > 0 && i == suggestedCount)
                _GroupLabel(l10n.pplEveryoneElse),
              _Choice(
                choice: choices[i],
                current: choices[i].customer.key == widget.currentKey,
                onTap: () => Navigator.of(context).pop(choices[i].customer),
              ),
            ],
        ],
      ),
    );
  }
}

class _GroupLabel extends StatelessWidget {
  const _GroupLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: AppSpacing.sm, bottom: 4),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w800,
        color: AppColors.muted,
      ),
    ),
  );
}

class _Choice extends StatelessWidget {
  const _Choice({
    required this.choice,
    required this.current,
    required this.onTap,
  });

  final ParkingLinkChoice choice;
  final bool current;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final c = choice.customer;
    return InkWell(
      key: Key('team-link-choice:${c.key}'),
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    c.name.isNotEmpty
                        ? c.name
                        : (c.phone.isNotEmpty ? c.phone : '—'),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  Text(
                    [
                      if (c.phone.isNotEmpty) c.phone,
                      l10n.pplCarsCount(c.cars),
                    ].join(' • '),
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
            if (current)
              _Pill(l10n.pplLinkedBadge, AppColors.sage)
            else if (choice.suggested)
              _Pill(l10n.pplLikelyMatch, AppColors.cobaltDeep),
          ],
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill(this.text, this.color);

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(left: AppSpacing.sm),
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
    ),
    child: Text(
      text,
      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color),
    ),
  );
}
