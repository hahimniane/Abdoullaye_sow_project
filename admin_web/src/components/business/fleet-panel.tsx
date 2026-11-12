"use client";

// The business console's Fleet pages (docs/FLEET.md section 6): one component
// for the five sidebar tabs, so a driver or car picked on one page stays
// picked when another opens it (a grid row opens the driver, a driver's car
// opens the car). The data is read once by the console (useFleetData) and
// passed in; Today's tiles use the same snapshot.

import { useMemo, useState } from "react";

import type { BusinessTab } from "@/lib/business-sidebar";
import { readFleetSettings } from "@/lib/fleet";
import type { FirestoreRow } from "@/types/admin";

import { FleetCars, FleetPaperwork } from "./fleet-cars";
import type { FleetState } from "./fleet-data";
import { FleetDrivers } from "./fleet-drivers";
import { FleetPayments } from "./fleet-payments";
import { FleetSettings } from "./fleet-settings";

export const FLEET_TABS: readonly BusinessTab[] = ["fleetPayments", "fleetDrivers", "fleetCars", "fleetPaperwork", "fleetSettings"];

export function FleetPanel({
  tab,
  setTab,
  businessId,
  business,
  state,
  isAdmin,
  previewMode,
}: {
  tab: BusinessTab;
  setTab: (tab: BusinessTab) => void;
  businessId: string;
  business: FirestoreRow | null;
  state: FleetState;
  isAdmin: boolean;
  previewMode: boolean;
}) {
  const [driverId, setDriverId] = useState("");
  const [carId, setCarId] = useState("");
  const settings = useMemo(() => readFleetSettings(business), [business]);

  if (previewMode) {
    return <div className="empty-state">Fleet is not shown in preview.</div>;
  }
  const openDriver = (id: string) => {
    setDriverId(id);
    setTab("fleetDrivers");
  };
  const openCar = (id: string) => {
    setCarId(id);
    setTab("fleetCars");
  };

  if (tab === "fleetDrivers") {
    return (
      <FleetDrivers
        businessId={businessId}
        driverId={driverId}
        isAdmin={isAdmin}
        onOpenCar={openCar}
        onOpenDriver={setDriverId}
        settings={settings}
        state={state}
      />
    );
  }
  if (tab === "fleetCars") {
    return <FleetCars businessId={businessId} carId={carId} onOpenCar={setCarId} onOpenDriver={openDriver} state={state} />;
  }
  if (tab === "fleetPaperwork") return <FleetPaperwork onOpenCar={openCar} state={state} />;
  if (tab === "fleetSettings") {
    return isAdmin ? (
      <FleetSettings businessId={businessId} settings={settings} />
    ) : (
      <div className="empty-state">Only a Fleet admin can change the Fleet settings.</div>
    );
  }
  return <FleetPayments onOpenDriver={openDriver} state={state} />;
}
