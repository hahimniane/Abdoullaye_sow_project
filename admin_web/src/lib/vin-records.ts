"use client";

// The lot's own record for a VIN, asked of the server when the rows a panel
// already holds do not have it. The invoice, container and ledger forms used
// to subscribe to 500 parked cars and 1,000 activities each - a random subset
// by document id - just to scan them when a VIN was typed; a car outside the
// subset was "never seen". Now a full VIN is two one-document lookups.

import { collection, getDocs, limit, query, where } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { findVehicleRecordByVin } from "@/lib/vin-lookup";

type Row = Record<string, unknown>;

const VIN_RECORD_COLLECTIONS = ["parkedCars", "lotActivities"] as const;

/**
 * The first parked car or ledger activity of `businessId` carrying `vin`,
 * or undefined. Rows already in memory are checked first (no read at all);
 * a collection this account may not read is skipped, not fatal.
 */
export async function findBusinessVehicleRecord(
  businessId: string,
  vin: string,
  loadedRows: readonly Row[] = [],
): Promise<Row | undefined> {
  const wanted = vin.trim().toUpperCase();
  const local = findVehicleRecordByVin(loadedRows, wanted);
  if (local) return local;
  const scopedBusinessId = businessId.trim();
  if (!scopedBusinessId || wanted.length < 6) return undefined;
  for (const name of VIN_RECORD_COLLECTIONS) {
    try {
      // Existence: any one record answers it, so no order is asked for.
      const snap = await getDocs(query(
        collection(db, name),
        where("businessId", "==", scopedBusinessId),
        where("vinNumber", "==", wanted),
        limit(1),
      ));
      const doc = snap.docs[0];
      if (doc) return { id: doc.id, ...doc.data() };
    } catch {
      // Not readable for this account, or offline: try the next source.
    }
  }
  return undefined;
}
