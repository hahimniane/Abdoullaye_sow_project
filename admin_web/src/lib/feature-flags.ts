"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";

import { db } from "./firebase";

// appConfig/client has a public "allow read: if true" rule (firestore.rules)
// and is already fetched by the Flutter app's AppGateProvider at startup, so
// feature flags live there rather than in the admin-only platformConfig
// collection: any signed-in or anonymous client can read it directly.
export function useSharedBarrelsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    return onSnapshot(
      doc(db, "appConfig", "client"),
      (snap) => setEnabled(snap.data()?.sharedBarrelsEnabled === true),
      () => setEnabled(false),
    );
  }, []);
  return enabled;
}
