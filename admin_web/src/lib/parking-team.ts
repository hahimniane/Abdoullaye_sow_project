/**
 * A team member's own car on the lot (docs/PARKING_TEAM_CARS.md), console side.
 *
 * Pure: the picker's options and the "Team car" label are worked out here so the
 * forms and the list share one rule and it is tested without a browser. The
 * server (`my_flutter_app/functions/parking_team.js`, `isTeamMember`) is the
 * authority on who may be picked: the business's owner and every staff member.
 */

type Row = Record<string, unknown>;

export type TeamMemberOption = { id: string; name: string };

const s = (value: unknown, max = 200): string => String(value ?? "").trim().slice(0, max);

/**
 * Who can be picked as "Team member": the owner and every staff member of the
 * business, names only, sorted by name. `staffRows` is the business's `users`
 * (`useBusinessStaff`), which carries the owner too; when the owner's row is
 * not there the business document's `ownerUid` still names them.
 */
export function teamMemberOptions(
  staffRows: readonly Row[] | null | undefined,
  business?: Row | null,
): TeamMemberOption[] {
  const ownerUid = s(business?.ownerUid, 128);
  const out: TeamMemberOption[] = [];
  const seen = new Set<string>();
  for (const row of staffRows || []) {
    const id = s(row?.id, 128);
    if (!id || seen.has(id)) continue;
    const role = s(row?.role, 40);
    if (role !== "staff" && role !== "businessOwner" && id !== ownerUid) continue;
    seen.add(id);
    out.push({ id, name: s(row.fullName, 120) || s(row.name, 120) || s(row.email, 120) || id });
  }
  if (ownerUid && !seen.has(ownerUid)) {
    out.push({ id: ownerUid, name: s(business?.ownerName, 120) || s(business?.ownerEmail, 120) || "Owner" });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export type ParkingTeamLabel = "" | "Team car" | "Former team member";

/**
 * The small label beside a parked car's owner: "" for a customer's car,
 * "Team car" for a tied car whose person is still on the team, "Former team
 * member" when that uid is no longer in the list. While the team list has not
 * loaded, a tied car reads "Team car" (never wrongly "Former").
 */
export function parkingTeamLabel(
  forStaffId: unknown,
  teamIds: ReadonlySet<string> | null | undefined,
): ParkingTeamLabel {
  const id = s(forStaffId, 128);
  if (!id) return "";
  if (!teamIds || teamIds.size === 0) return "Team car";
  return teamIds.has(id) ? "Team car" : "Former team member";
}
