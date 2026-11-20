"use client";

// Fleet's reads and its one write path. One live read of each of the five
// collections (complete, equality on businessId only, so no composite index),
// held by the console and shared by every Fleet page and by Today's tiles.

import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { useBusinessCollection } from "@/lib/business-data";
import { functions } from "@/lib/firebase";
import { indexFleet, newYorkDayKey, refreshedDayKey, type FleetData, type FleetIndex } from "@/lib/fleet";

export type FleetState = {
  data: FleetData;
  index: FleetIndex;
  /** Today in New York; moves when the day changes, even on a console left open overnight. */
  todayKey: string;
  loading: boolean;
  error: string;
};

const COMPLETE = { pageSize: null, sort: "query" } as const;
const DAY_CHECK_MS = 60_000;

/**
 * Today in New York, checked once a minute. The state only changes when the
 * day does, so nothing re-renders the other 1,439 minutes.
 */
function useNewYorkDayKey(): string {
  const [dayKey, setDayKey] = useState(() => newYorkDayKey());
  useEffect(() => {
    const timer = setInterval(() => setDayKey((held) => refreshedDayKey(held)), DAY_CHECK_MS);
    return () => clearInterval(timer);
  }, []);
  return dayKey;
}

export function useFleetData(businessId: string, enabled: boolean): FleetState {
  const todayKey = useNewYorkDayKey();
  const drivers = useBusinessCollection("fleetDrivers", businessId, enabled, COMPLETE);
  const cars = useBusinessCollection("fleetCars", businessId, enabled, COMPLETE);
  const assignments = useBusinessCollection("fleetAssignments", businessId, enabled, COMPLETE);
  const bills = useBusinessCollection("fleetBills", businessId, enabled, COMPLETE);
  const payments = useBusinessCollection("fleetPayments", businessId, enabled, COMPLETE);
  const notes = useBusinessCollection("fleetNotes", businessId, enabled, COMPLETE);
  const substitutes = useBusinessCollection("fleetSubstitutes", businessId, enabled, COMPLETE);
  const loading =
    enabled &&
    (drivers.loading || cars.loading || assignments.loading || bills.loading || payments.loading || notes.loading || substitutes.loading);
  const error = drivers.error || cars.error || assignments.error || bills.error || payments.error || notes.error || substitutes.error;
  return useMemo(() => {
    const data: FleetData = {
      drivers: drivers.rows as FleetData["drivers"],
      cars: cars.rows as FleetData["cars"],
      assignments: assignments.rows as FleetData["assignments"],
      bills: bills.rows as FleetData["bills"],
      payments: payments.rows as FleetData["payments"],
      notes: notes.rows as FleetData["notes"],
      substitutes: substitutes.rows as FleetData["substitutes"],
    };
    return { data, index: indexFleet(data), todayKey, loading, error };
  }, [todayKey, drivers.rows, cars.rows, assignments.rows, bills.rows, payments.rows, notes.rows, substitutes.rows, loading, error]);
}

/**
 * The drivers' reported payments (fleetClaims), live. Kept apart from
 * useFleetData on purpose: the claims panel shows its own loading/error line,
 * so a claims problem never blanks the drivers pages.
 */
export function useFleetClaims(businessId: string, enabled: boolean) {
  return useBusinessCollection("fleetClaims", businessId, enabled, COMPLETE);
}

/** Calls the one Fleet callable. Throws the callable's error (read it with fleetErrorMessage). */
export async function callFleet<T = Record<string, unknown>>(
  action: string,
  businessId: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const result = await httpsCallable(functions, "fleetAction")({ action, businessId, ...payload });
  return result.data as T;
}
