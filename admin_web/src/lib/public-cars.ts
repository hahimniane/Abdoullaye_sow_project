// The public car listings, and the shape every customer collection hook
// returns. Extracted from customer-console so that the signed-out service
// entry can subscribe to listings without importing the whole customer
// console module - one hook was pulling 2,000 lines onto the guest's first
// paint.

import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";

import { customerCarListingIsEligible } from "@/lib/customer-service-eligibility";
import { db } from "@/lib/firebase";
import type { FirestoreRow } from "@/types/admin";

export type CustomerCollection = {
  rows: FirestoreRow[];
  loading: boolean;
  error: string;
};

export function usePublicCars(enabled: boolean): CustomerCollection {
  const [state, setState] = useState<CustomerCollection>({ rows: [], loading: false, error: "" });
  useEffect(() => {
    if (!enabled) return undefined;
    setState({ rows: [], loading: true, error: "" });
    const request = query(collection(db, "cars"), where("status", "==", "active"), limit(100));
    return onSnapshot(request, (snapshot) => {
      const rows = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter(customerCarListingIsEligible);
      setState({ rows, loading: false, error: "" });
    }, (error) => setState({ rows: [], loading: false, error: error.message }));
  }, [enabled]);
  return state;
}
