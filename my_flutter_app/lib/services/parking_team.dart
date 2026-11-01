/// A team member's own car on the lot (docs/PARKING_TEAM_CARS.md), app side.
///
/// A car tied to a team member carries their uid in `forStaffId`. These are
/// the small pure rules the screens share; the server owns the real ones
/// (`functions/parking_team.js`). Pure: no Firebase, no widgets.
library;

/// What the small label next to a car's owner says.
enum ParkingTeamTag {
  /// A customer's car: no label.
  none,

  /// A team member's own car: "Team".
  team,

  /// Tied to someone who is no longer on the team: "Former team member".
  former,
}

/// The label for a car tied to [forStaffId]. [teamIds] is everyone on the
/// team the screen knows (the owner and every staff member); when it is
/// empty the screen could not read the team, so the car just says "Team"
/// rather than wrongly calling the person a former member. Pass a `Set` or a
/// `Map.keys`: `contains` is then constant time, so a long list stays cheap.
ParkingTeamTag parkingTeamTagOf(String forStaffId, Iterable<String> teamIds) {
  final id = forStaffId.trim();
  if (id.isEmpty) return ParkingTeamTag.none;
  if (teamIds.isEmpty || teamIds.contains(id)) return ParkingTeamTag.team;
  return ParkingTeamTag.former;
}
