"use client";

import { useCallback, useEffect, useState } from "react";

import { useLiveDocRead } from "@/lib/business-data";
import { businessWeightUnit } from "@/lib/business-price-list";
import type { WeightUnit } from "@/lib/package-price-list";
import { readRememberedWeightUnit, writeRememberedWeightUnit } from "@/lib/weight-unit-memory";

/**
 * The unit a business weighs and quotes in (docs/SHIPPING_SIMPLE_HOME.md K4):
 * its price list's when it has priced a route, else the unit this person
 * last picked on this device (pounds if none). `fromList` is true when the
 * list decides - the lb/kg choice on a weight field shows only when it is
 * false, and only once the list has answered (`settled`), so a kilo
 * business never sees the choice flash by. A weight field stays closed
 * until `settled`, so nothing is typed in a unit the list is about to
 * change; a list that never answers settles on its own after
 * `SETTLE_TIMEOUT_MS`. Reading the list needs the containers section;
 * without it the answer is the remembered unit, which is also the safe
 * default.
 */
const SETTLE_TIMEOUT_MS = 5000;

export function useBusinessWeightUnit(
  businessId: string,
  enabled = true,
): { unit: WeightUnit; fromList: boolean; settled: boolean; choose: (unit: WeightUnit) => void } {
  const list = useLiveDocRead("packagePriceLists", businessId, enabled);
  const [remembered, setRemembered] = useState<WeightUnit | null>(null);
  useEffect(() => {
    setRemembered(readRememberedWeightUnit());
  }, []);
  const choose = useCallback((unit: WeightUnit) => {
    setRemembered(unit);
    writeRememberedWeightUnit(unit);
  }, []);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false);
    const timer = setTimeout(() => setTimedOut(true), SETTLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [businessId, enabled]);
  const { unit, fromList } = businessWeightUnit(list.row, remembered);
  return { unit, fromList, settled: !enabled || !businessId || list.settled || timedOut, choose };
}
