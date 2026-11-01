import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/lot_ledger.dart' show LotStaff;
import '../services/parking_team.dart';
import '../theme/app_colors.dart';

/// "Whose car?" on the add and edit parked-car forms (docs/PARKING_TEAM_CARS.md):
/// **Someone else** (name and phone typed, the default) or **Team member**
/// (the owner or any staff member, picked by name).
///
/// Only the choice and the picker live here. The form owns the state and
/// hides its name and phone fields while a member is chosen, so one widget
/// serves the add screen and the edit screen.
class ParkingWhoseCarChoice extends StatelessWidget {
  const ParkingWhoseCarChoice({
    super.key,
    required this.teamCar,
    required this.staffId,
    required this.team,
    required this.onTeamCarChanged,
    required this.onStaffChanged,
    this.enabled = true,
  });

  /// True while "Team member" is chosen.
  final bool teamCar;

  /// The picked member's uid, '' while nobody is picked.
  final String staffId;

  /// The owner and every staff member, as the picker lists them.
  final List<LotStaff> team;
  final ValueChanged<bool> onTeamCarChanged;
  final ValueChanged<String> onStaffChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    // A saved member who is no longer listed still shows as picked.
    final known = team.any((m) => m.id == staffId);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.parkingWhoseCar,
          style: const TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w600,
            color: Color(0xFF6B7280),
          ),
        ),
        const SizedBox(height: 6),
        SizedBox(
          width: double.infinity,
          child: SegmentedButton<bool>(
            key: const Key('parking-whose-car'),
            showSelectedIcon: false,
            segments: [
              ButtonSegment<bool>(
                value: false,
                label: Text(l10n.parkingWhoseCarSomeoneElse),
              ),
              ButtonSegment<bool>(
                value: true,
                label: Text(l10n.parkingWhoseCarTeamMember),
              ),
            ],
            selected: {teamCar},
            onSelectionChanged: enabled
                ? (set) => onTeamCarChanged(set.first)
                : null,
          ),
        ),
        if (teamCar) ...[
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            // Re-created when the pick or the loaded team changes: the
            // field only reads its initial value once.
            key: ValueKey<String>(
              'parking-team-member-$staffId-${team.length}',
            ),
            initialValue: known ? staffId : null,
            isExpanded: true,
            items: [
              for (final member in team)
                DropdownMenuItem<String>(
                  value: member.id,
                  child: Text(member.name, overflow: TextOverflow.ellipsis),
                ),
            ],
            onChanged: enabled ? (v) => onStaffChanged(v ?? '') : null,
            validator: (v) => (v == null || v.isEmpty)
                ? l10n.parkingTeamMemberRequired
                : null,
            decoration: InputDecoration(
              labelText: l10n.parkingTeamMemberPicker,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              filled: true,
              fillColor: Colors.grey.shade50,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            l10n.parkingTeamMemberHint,
            key: const Key('parking-team-member-hint'),
            style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
          ),
        ],
      ],
    );
  }
}

/// The small "Team" / "Former team member" label next to the owner of a team
/// member's own car. Nothing for a customer's car. [text] overrides the words
/// (Month end says "Team member").
class ParkingTeamTagChip extends StatelessWidget {
  const ParkingTeamTagChip({
    super.key,
    this.tag = ParkingTeamTag.team,
    this.text,
  });

  final ParkingTeamTag tag;
  final String? text;

  @override
  Widget build(BuildContext context) {
    if (tag == ParkingTeamTag.none) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    return Container(
      key: const Key('parking-team-tag'),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: AppColors.rule.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        text ??
            (tag == ParkingTeamTag.former
                ? l10n.parkingFormerTeamTag
                : l10n.parkingTeamTag),
        style: const TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          color: AppColors.muted,
        ),
      ),
    );
  }
}
