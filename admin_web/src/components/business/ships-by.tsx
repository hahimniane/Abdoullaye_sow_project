"use client";

import { Plane, Ship } from "lucide-react";

import type { PackageShipMode } from "@/lib/package-proof";

/**
 * "Ships by: Sea · Air" at the top of a package form (docs/AIR_PACKAGES.md
 * §7). Shown only when the business ships by air (`shipsByAir`); Sea is the
 * form as it always was, Air adds the proof section. The same segmented
 * radio group as the container form's "How it travels".
 */
export function ShipsByChoice({
  value,
  onChange,
  disabled = false,
  id,
}: {
  value: PackageShipMode;
  onChange: (mode: PackageShipMode) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <div className="lst-field wide prf-mode" id={id}>
      <span>Ships by</span>
      <div className="service-segments pcs-kinds" role="radiogroup" aria-label="Ships by">
        {(["sea", "air"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={value === mode}
            className={`segment${value === mode ? " active" : ""}`}
            disabled={disabled}
            onClick={() => onChange(mode)}
          >
            {mode === "sea" ? <Ship size={14} aria-hidden="true" /> : <Plane size={14} aria-hidden="true" />}
            {mode === "sea" ? "Sea" : "Air"}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The small "Air" mark on a waiting package that flies. */
export function AirPackageBadge() {
  return (
    <small className="prf-air" title="Ships by air">
      <Plane size={11} aria-hidden="true" /> <span>Air</span>
    </small>
  );
}
