"use client";

// The business console's Fleet page (docs/FLEET.md sections 6 and 15): one
// sidebar item with tabs (Needs you, Drivers, Plates, Payments, Paperwork),
// one search, a New menu and the settings gear. Each tab is the page that
// was its own menu item before, unchanged; a driver or plate picked on one
// tab stays picked when another opens it. The data is read once by the
// console (useFleetData) and passed in; Today's tiles use the same snapshot.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { carRows, driverRows, expiryState, readFleetSettings } from "@/lib/fleet";
import { openClaimViews } from "@/lib/fleet-claims";
import { fleetSearch, needsItems, plateOnDay, type FleetView } from "@/lib/fleet-home";
import type { FirestoreRow } from "@/types/admin";

import { useFleetBank } from "./fleet-bank";
import { FleetCars, FleetPaperwork } from "./fleet-cars";
import { useFleetClaims, type FleetState } from "./fleet-data";
import { FleetDrivers, type DriverIntent } from "./fleet-drivers";
import {
  DriverPickDialog,
  FleetHeader,
  FleetMovedNote,
  FleetTabBar,
  NeedsYou,
  type FleetTabSpec,
  type NewAction,
  type PickPurpose,
} from "./fleet-home";
import { FleetPayments } from "./fleet-payments";
import { FleetSettings } from "./fleet-settings";

type Anchor = "fleet-claims" | "fleet-deposits" | "fleet-import";

export function FleetPanel({
  view,
  setView,
  businessId,
  business,
  state,
  isAdmin,
  previewMode,
  focus = null,
}: {
  view: FleetView;
  setView: (view: FleetView) => void;
  businessId: string;
  business: FirestoreRow | null;
  state: FleetState;
  isAdmin: boolean;
  previewMode: boolean;
  /** A Fleet alert names a driver or a plate: open its page (a new `stamp` asks again). */
  focus?: { kind: "driver" | "car"; id: string; stamp: number } | null;
}) {
  const [driverId, setDriverId] = useState("");
  const [carId, setCarId] = useState("");
  const [driverIntent, setDriverIntent] = useState<DriverIntent | null>(null);
  const [addPlate, setAddPlate] = useState(false);
  const [pick, setPick] = useState<PickPurpose | null>(null);
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState<Anchor | "">("");
  const settings = useMemo(() => readFleetSettings(business), [business]);
  // One bank_status read and one open-claims listener for the whole page:
  // Needs you and the Payments tab share them.
  const bank = useFleetBank(businessId, !previewMode);
  const claims = useFleetClaims(businessId, !previewMode);

  const rows = useMemo(() => driverRows(state.data, state.index, state.todayKey), [state]);
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const driverNames = useMemo(
    () => new Map(state.data.drivers.map((d) => [String(d.id), String(d.name ?? "") || String(d.phone ?? "")])),
    [state.data.drivers],
  );
  const claimViews = useMemo(() => openClaimViews(claims.rows, driverNames), [claims.rows, driverNames]);
  const needs = useMemo(
    () => needsItems({ data: state.data, index: state.index, todayKey: state.todayKey, claims: claimViews, bank: bank.status }),
    [state, claimViews, bank.status],
  );
  const paperDue = useMemo(
    () =>
      carRows(state.data, state.index, state.todayKey).filter(
        (c) => expiryState(c.diamondExpiry, state.todayKey) !== "ok" || expiryState(c.registrationExpiry, state.todayKey) !== "ok",
      ).length,
    [state],
  );
  const hits = useMemo(() => fleetSearch(query, state.data, state.index, rows), [query, state, rows]);
  const answer = useMemo(() => plateOnDay(query, state.data, state.index, state.todayKey), [query, state]);

  // After a tab change, bring the asked-for panel into view.
  useEffect(() => {
    if (!anchor) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setAnchor("");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [anchor, view]);

  // An alert's driver or plate (docs/FLEET.md section 18). The tab itself was
  // set by the console; this opens the record on it.
  useEffect(() => {
    if (!focus?.id) return;
    if (focus.kind === "driver") setDriverId(focus.id);
    else setCarId(focus.id);
  }, [focus]);

  const clearIntent = useCallback(() => setDriverIntent(null), []);
  const clearAddPlate = useCallback(() => setAddPlate(false), []);

  if (previewMode) {
    return <div className="empty-state">Fleet is not shown in preview.</div>;
  }

  const openDriver = (id: string) => {
    setDriverId(id);
    setView("drivers");
  };
  const openCar = (id: string) => {
    setCarId(id);
    setView("plates");
  };
  const goView = (next: FleetView) => {
    // A tab picked by hand opens its list, not the record left open there.
    if (next === "drivers") setDriverId("");
    if (next === "plates") setCarId("");
    setView(next);
  };
  const onNew = (action: NewAction) => {
    if (action === "driver") {
      setDriverId("");
      setDriverIntent("add");
      setView("drivers");
    } else if (action === "plate") {
      setCarId("");
      setAddPlate(true);
      setView("plates");
    } else if (action === "payment" || action === "charge") {
      setPick({ kind: action });
    } else if (action === "import") {
      setView("settings");
      setAnchor("fleet-import");
    }
  };
  const giveToDriver = (id: string) => {
    const car = state.index.carById.get(id);
    setPick({ kind: "give", carId: id, plate: String(car?.plate ?? "") });
  };
  const onPicked = (id: string) => {
    const purpose = pick;
    setPick(null);
    if (!purpose) return;
    setDriverIntent(purpose.kind === "give" ? { give: purpose.carId } : purpose.kind);
    openDriver(id);
  };

  const tabs: FleetTabSpec[] = [
    { id: "needs", label: "Needs you", count: needs.length, alert: true },
    { id: "drivers", label: "Drivers", count: rows.filter((r) => r.status === "active").length },
    { id: "plates", label: "Plates", count: state.data.cars.length },
    { id: "payments", label: "Payments", count: null },
    { id: "paperwork", label: "Paperwork", count: paperDue, alert: true },
  ];

  return (
    <div className="stack fleet-page fleet-home">
      <div className="fleet-home-bar">
        <FleetHeader
          query={query}
          onQuery={setQuery}
          hits={hits}
          answer={answer}
          onOpenDriver={openDriver}
          onOpenPlate={openCar}
          onChargeTicket={(id, label) => {
            setDriverIntent({ charge: label });
            openDriver(id);
          }}
          onNew={onNew}
          isAdmin={isAdmin}
          onSettings={() => setView(view === "settings" ? "needs" : "settings")}
          settingsOpen={view === "settings"}
        />
        <FleetTabBar tabs={tabs} view={view} onView={goView} />
      </div>
      <FleetMovedNote />

      {view === "needs" && (
        <NeedsYou
          items={needs}
          loading={state.loading || bank.loading}
          bankError={bank.error}
          businessId={businessId}
          settings={settings}
          drivers={rowsById}
          actions={{
            openDriver,
            openPlate: openCar,
            recordPayment: (id) => {
              setDriverIntent("payment");
              openDriver(id);
            },
            giveToDriver,
            goPayments: (target) => {
              setView("payments");
              setAnchor(target);
            },
            goPaperwork: () => setView("paperwork"),
          }}
        />
      )}
      {view === "drivers" && (
        <FleetDrivers
          businessId={businessId}
          driverId={driverId}
          intent={driverIntent}
          isAdmin={isAdmin}
          onIntentDone={clearIntent}
          onOpenCar={openCar}
          onOpenDriver={setDriverId}
          settings={settings}
          state={state}
        />
      )}
      {view === "plates" && (
        <FleetCars
          addRequested={addPlate}
          businessId={businessId}
          carId={carId}
          onAddDone={clearAddPlate}
          onGiveToDriver={giveToDriver}
          onOpenCar={setCarId}
          onOpenDriver={openDriver}
          state={state}
        />
      )}
      {view === "payments" && <FleetPayments bank={bank} businessId={businessId} onOpenDriver={openDriver} state={state} />}
      {view === "paperwork" && <FleetPaperwork onOpenCar={openCar} state={state} />}
      {view === "settings" &&
        (isAdmin ? (
          <>
            <button className="ghost-button compact fleet-back press" type="button" onClick={() => setView("needs")}>
              <ArrowLeft size={14} /> Fleet
            </button>
            <FleetSettings
              businessId={businessId}
              settings={settings}
              drivers={state.data.drivers
                .filter((d) => d.status === "active")
                .map((d) => ({
                  id: String(d.id),
                  name: String(d.name ?? ""),
                  hasPhone: String(d.phone ?? "").replace(/\D/g, "").length >= 10,
                }))}
            />
          </>
        ) : (
          <div className="empty-state">Only a Fleet admin can change the Fleet settings.</div>
        ))}

      {pick && <DriverPickDialog purpose={pick} rows={rows} onPick={onPicked} onClose={() => setPick(null)} />}
    </div>
  );
}
