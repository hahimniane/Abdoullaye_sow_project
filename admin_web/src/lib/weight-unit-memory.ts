// The last weight unit (lb or kg) a person picked on this device, for a
// business that has no price list yet (docs/SHIPPING_SIMPLE_HOME.md K4). A
// per-device convenience only: storage can be missing or blocked (a private
// window), and then the answer is simply "none" and the default is pounds.

import type { WeightUnit } from "./package-price-list.ts";

export const WEIGHT_UNIT_KEY = "laawol.weightUnit";

/** The remembered unit, or null when none was picked or storage is unavailable. */
export function readRememberedWeightUnit(): WeightUnit | null {
  try {
    const value = window.localStorage.getItem(WEIGHT_UNIT_KEY);
    return value === "kg" || value === "lb" ? value : null;
  } catch {
    return null;
  }
}

/** Remembers the unit; a blocked store means it is asked again next visit. */
export function writeRememberedWeightUnit(unit: WeightUnit): void {
  try {
    window.localStorage.setItem(WEIGHT_UNIT_KEY, unit);
  } catch {
    // Private window or blocked storage: the choice lasts until the page closes.
  }
}
