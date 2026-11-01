"use client";

import type { TeamMemberOption } from "@/lib/parking-team";

export type WhoseCar = "other" | "team";

/**
 * "Whose car?" on the add and edit parking forms (docs/PARKING_TEAM_CARS.md):
 * someone else (a customer, typed as before) or a team member (picked from
 * the owner and the staff). The same control in both forms, so they cannot
 * drift. The form hides its customer fields while "Team member" is chosen.
 */
export function WhoseCarField({
  whose,
  staffId,
  options,
  disabled = false,
  onWhose,
  onStaffId,
}: {
  whose: WhoseCar;
  staffId: string;
  options: readonly TeamMemberOption[];
  disabled?: boolean;
  onWhose: (whose: WhoseCar) => void;
  onStaffId: (staffId: string) => void;
}) {
  return (
    <div className="lst-field wide">
      <span>Whose car?</span>
      <div className="lst-chips" role="group" aria-label="Whose car?">
        <button type="button" className={`lst-chip ${whose === "other" ? "on" : ""}`} aria-pressed={whose === "other"} disabled={disabled} onClick={() => onWhose("other")}>Someone else</button>
        <button type="button" className={`lst-chip ${whose === "team" ? "on" : ""}`} aria-pressed={whose === "team"} disabled={disabled} onClick={() => onWhose("team")}>Team member</button>
      </div>
      {whose === "team" && (
        <>
          <select value={staffId} disabled={disabled} aria-label="Team member" onChange={(event) => onStaffId(event.target.value)}>
            <option value="">Choose a team member…</option>
            {/* A tied car whose person has left stays pickable as itself. */}
            {staffId && !options.some((option) => option.id === staffId) && (
              <option value={staffId}>Former team member</option>
            )}
            {options.map((option) => (
              <option key={option.id} value={option.id} data-no-translate>{option.name}</option>
            ))}
          </select>
          <small className="lst-hint">Their parking goes on their Staff balances. No WhatsApp is sent.</small>
        </>
      )}
    </div>
  );
}

/** The small "Team car" / "Former team member" / "Team member" label beside a name. */
export function TeamTag({ label }: { label: string }) {
  if (!label) return null;
  return <span className="lst-team-tag">{label}</span>;
}
