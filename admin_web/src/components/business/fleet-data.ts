"use client";

// Fleet's reads and its one write path. One live read of each of the five
// collections (complete, equality on businessId only, so no composite index),
// held by the console and shared by every Fleet page and by Today's tiles.

import { useMemo } from "react";
import { httpsCallable } from "firebase/functions";

import { useBusinessCollection } from "@/lib/business-data";
import { functions } from "@/lib/firebase";
import { indexFleet, newYorkDayKey, type FleetData, type FleetIndex } from "@/lib/fleet";

export type FleetState = {
  data: FleetData;
  index: FleetIndex;
  /** Today in New York, read once per snapshot. */
  todayKey: string;
  loading: boolean;
  error: string;
};

const COMPLETE = { pageSize: null, sort: "query" } as const;

export function useFleetData(businessId: string, enabled: boolean): FleetState {
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
    return { data, index: indexFleet(data), todayKey: newYorkDayKey(), loading, error };
  }, [drivers.rows, cars.rows, assignments.rows, bills.rows, payments.rows, notes.rows, substitutes.rows, loading, error]);
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
