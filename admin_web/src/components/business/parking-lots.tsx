"use client";

// Several parking lots for one business (docs/PARKING_LOTS.md): the pieces
// the Parking page and the parking settings share. A lot is only where a
// car stands; prices and bills stay the business's.

import { httpsCallable } from "firebase/functions";
import { ArrowRightLeft, MapPin, Pencil, Plus, RefreshCw, X } from "lucide-react";
import { useMemo, useState } from "react";

import { useBusinessCollection } from "@/lib/business-data";
import { functions } from "@/lib/firebase";
import { currentLanguage, formatMoney } from "@/lib/format";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import {
  PARKING_LOT_MESSAGES,
  asksForParkingLot,
  emptyParkingLotDraft,
  openParkingLots,
  parkingLotBookingRequest,
  parkingLotDraftErrors,
  parkingLotDraftFrom,
  parkingLotIdOf,
  parkingLotIsFull,
  parkingLotMoveRequest,
  parkingLotRefusalText,
  parkingLotSaveRequest,
  sortedParkingLots,
  type ParkingLot,
  type ParkingLotDraft,
  type ServerParkingLot,
} from "@/lib/parking-lots";

type Row = Record<string, unknown>;

/** The business's lots, live: every lot, the open ones, and whether staff are asked for one. */
export function useParkingLots(businessId: string, enabled: boolean) {
  const rows = useBusinessCollection("parkingLots", businessId, enabled, { pageSize: null });
  return useMemo(() => {
    const lots = sortedParkingLots(rows.rows as Row[]);
    return { lots, open: openParkingLots(lots), asks: asksForParkingLot(lots), loading: rows.loading };
  }, [rows.rows, rows.loading]);
}

/** The few words that carry a number, said whole in the reader's language (never translated piecemeal). */
function lotWords() {
  const fr = currentLanguage() === "fr";
  return {
    fill: (used: number, total: number) => total > 0
      ? (fr ? `${used} sur ${total} places` : `${used} of ${total} spaces`)
      : (fr ? `${used} voiture${used === 1 ? "" : "s"}` : `${used} car${used === 1 ? "" : "s"}`),
    full: fr ? "complet" : "full",
    movement: (arrived: number, left: number) => fr
      ? `Ce mois-ci : ${arrived} arrivée${arrived === 1 ? "" : "s"} · ${left} départ${left === 1 ? "" : "s"}`
      : `This month: ${arrived} arrived · ${left} left`,
    spaces: (total: number, blocked: number) => fr
      ? `${total} place${total === 1 ? "" : "s"}${blocked > 0 ? ` · ${blocked} bloquée${blocked === 1 ? "" : "s"}` : ""}`
      : `${total} space${total === 1 ? "" : "s"}${blocked > 0 ? ` · ${blocked} blocked` : ""}`,
  };
}

function refusalText(failure: unknown, fallback: string): string {
  return parkingLotRefusalText(failure) ||
    (failure instanceof Error && failure.message ? failure.message : fallback);
}

/** "Which lot?" on a form: the open lots, each with its free spaces when known. */
export function ParkingLotSelect({
  lots,
  value,
  onChange,
  disabled = false,
  figures,
  label = "Which lot?",
}: {
  lots: readonly ParkingLot[];
  value: string;
  onChange: (lotId: string) => void;
  disabled?: boolean;
  /** getParkingTotals' lots, to say how full each one is. */
  figures?: readonly ServerParkingLot[] | null;
  label?: string;
}) {
  const words = lotWords();
  return (
    <label className="lst-field">
      <span>{label}</span>
      <select data-no-translate disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        {lots.map((lot) => {
          const told = figures?.find((f) => f.lotId === lot.id);
          const full = parkingLotIsFull(told);
          const text = [lot.name, told ? words.fill(told.totals.spacesUsed, told.totals.spacesTotal) : "", full ? words.full : ""]
            .filter(Boolean).join(" · ");
          return (<option key={lot.id} value={lot.id} disabled={full && lot.id !== value}>{text}</option>);
        })}
      </select>
    </label>
  );
}

/** The lot a car stands in, as a small tag on its row. */
export function ParkingLotBadge({ name }: { name: string }) {
  if (!name) return null;
  return <span className="pk-lot-badge" data-no-translate><MapPin aria-hidden="true" size={11} /> {name}</span>;
}

/**
 * The lots side by side: how full each is, the month's arrivals and
 * departures, the money collected this month and what is still owed.
 * Tapping a lot narrows the list to it; tapping it again shows every lot.
 */
export function ParkingLotStrip({
  lots,
  selected,
  onSelect,
}: {
  lots: readonly ServerParkingLot[];
  selected: string;
  onSelect: (lotId: string) => void;
}) {
  const shown = lots.filter((lot) => lot.open || lot.totals.spacesUsed > 0 || lot.totals.owed > 0);
  if (shown.length < 2) return null;
  const words = lotWords();
  return (
    <div className="pk-lots" role="group" aria-label="Parking lots">
      {shown.map((lot) => {
        const on = selected === lot.lotId;
        return (
          <button
            key={lot.lotId}
            type="button"
            className={`pk-lot${on ? " on" : ""}`}
            aria-pressed={on}
            onClick={() => onSelect(on ? "" : lot.lotId)}
          >
            <span className="pk-lot-name">
              <strong data-no-translate>{lot.name}</strong>
              {!lot.open && <em>Closed</em>}
            </span>
            <span className="pk-lot-fill"><b data-no-translate>{words.fill(lot.totals.spacesUsed, lot.totals.spacesTotal)}</b></span>
            <span className="pk-lot-line" data-no-translate>{words.movement(lot.month.arrived, lot.month.left)}</span>
            <span className="pk-lot-line"><span>Collected this month</span> <b data-no-translate>{formatMoney(lot.month.collectedCents / 100)}</b></span>
            <span className="pk-lot-line"><span>Still owed</span> <b className={lot.totals.owed > 0 ? "owed" : undefined} data-no-translate>{formatMoney(lot.totals.owed)}</b></span>
          </button>
        );
      })}
    </div>
  );
}

/** Move one car to another lot: nobody is messaged and the bill does not change. */
export function MoveCarLot({
  businessId,
  car,
  lots,
  disabled = false,
  onMoved,
}: {
  businessId: string;
  car: Row;
  lots: readonly ParkingLot[];
  disabled?: boolean;
  onMoved: (message: string) => void;
}) {
  const current = parkingLotIdOf(car, businessId);
  const open = openParkingLots(lots);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choices = open.filter((lot) => lot.id !== current);
  if (!asksForParkingLot(lots) || choices.length === 0) return null;
  const chosen = choices.find((lot) => lot.id === target)?.id ?? choices[0].id;

  async function move() {
    setBusy(true);
    setError("");
    try {
      await httpsCallable(functions, "updateBusinessParkingEntry")(
        parkingLotMoveRequest(String(car.id ?? ""), chosen));
      onMoved("Moved to the other lot.");
    } catch (failure) {
      setError(refusalText(failure, "The car could not be moved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pk-lot-move">
      <label className="lst-field">
        <span>Move to another lot</span>
        <select disabled={disabled || busy} value={chosen} onChange={(event) => setTarget(event.target.value)}>
          {choices.map((lot) => (<option key={lot.id} value={lot.id}>{lot.name}</option>))}
        </select>
      </label>
      <button className="lst-btn ghost" type="button" disabled={disabled || busy} aria-busy={busy} onClick={() => void move()}>
        {busy ? <RefreshCw className="spin" size={14} /> : <ArrowRightLeft size={14} />} Move car
      </button>
      {error && <p className="lst-form-error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * The owner's list of lots (parking settings): add a lot, rename it, set
 * its spaces and address, close it, and choose where online bookings go.
 * A business that never set lots up sees its one lot under the default
 * name; saving anything here turns its parking settings into that lot.
 */
export function ParkingLotsSettings({
  businessId,
  business,
  canEdit,
}: {
  businessId: string;
  business: Row | null;
  canEdit: boolean;
}) {
  const { lots, loading } = useParkingLots(businessId, Boolean(businessId));
  // Before the first save there is one lot: the business's own settings.
  const shown: ParkingLot[] = lots.length > 0 ? lots : [{
    id: "", name: "Lot 1", addressLine1: "", city: "", state: "", zipCode: "",
    totalSpaces: Math.max(0, Math.trunc(Number(business?.parkingTotalSpaces) || 0)),
    blockedSpaces: Math.max(0, Math.trunc(Number(business?.parkingBlockedSpaces) || 0)),
    open: true, isMain: true, sortOrder: 0,
  }];
  const bookingLotId = String(business?.parkingBookingLotId ?? "") || shown.find((lot) => lot.open)?.id || "";
  // null: closed. "": a new lot. Else the lot being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ParkingLotDraft>(emptyParkingLotDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const editingLot = editing ? shown.find((lot) => lot.id === editing) ?? null : null;
  // The first lot of a business with none stored is edited under its id-to-be.
  const editingFirst = editing === "first";

  function open(lot: ParkingLot | null, first = false) {
    setError("");
    setFlash("");
    setDraft(lot ? parkingLotDraftFrom(lot) : { ...emptyParkingLotDraft, name: `Lot ${shown.length + 1}` });
    setEditing(first ? "first" : lot ? lot.id : "");
  }

  async function save() {
    const lotId = editingFirst ? `${businessId}_main` : editing ?? "";
    const errors = parkingLotDraftErrors(draft, lots, lotId);
    if (errors.length > 0) {
      setError(PARKING_LOT_MESSAGES[errors[0]]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      // The first lot of a business with none stored is created by the
      // server from its settings before anything else is saved: adding a
      // lot converts it, and editing "Lot 1" edits what the server made.
      if (editingFirst && lots.length === 0) {
        await httpsCallable(functions, "updateBusinessParkingEntry")(
          parkingLotBookingRequest(businessId, lotId));
      }
      await httpsCallable(functions, "updateBusinessParkingEntry")(
        parkingLotSaveRequest(businessId, draft, lotId));
      setEditing(null);
      setFlash("Saved.");
    } catch (failure) {
      setError(refusalText(failure, "The lot could not be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function sendBookingsTo(lotId: string) {
    setBusy(true);
    setFlash("");
    try {
      await httpsCallable(functions, "updateBusinessParkingEntry")(parkingLotBookingRequest(businessId, lotId));
      setFlash("Saved.");
    } catch (failure) {
      setFlash(refusalText(failure, "That could not be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const openLots = shown.filter((lot) => lot.open);
  const words = lotWords();
  return (
    <section className="pk-lots-settings" aria-label="Parking lots">
      <header>
        <div>
          <h4>Parking lots</h4>
          <p className="lst-hint">Where your cars stand. Prices are the same in every lot; each lot has its own spaces.</p>
        </div>
        {canEdit && (
          <button className="lst-btn ghost" type="button" disabled={busy || loading} onClick={() => open(null)}>
            <Plus size={14} /> Add a lot
          </button>
        )}
      </header>
      {flash && <p className="lst-hint" role="status">{flash}</p>}
      <ul className="pk-lots-list">
        {shown.map((lot) => (
          <li key={lot.id || "first"} className={lot.open ? undefined : "closed"}>
            <div>
              <strong data-no-translate>{lot.name}</strong>
              {!lot.open && <em>Closed</em>}
              <small>
                <span data-no-translate>{words.spaces(lot.totalSpaces, lot.blockedSpaces)}</span>
                {" · "}
                {lot.addressLine1
                  ? <span data-no-translate>{[lot.addressLine1, lot.city, lot.state].filter(Boolean).join(", ")}</span>
                  : <span>at the business&apos;s parking address</span>}
              </small>
            </div>
            {canEdit && (
              <button className="lst-icon-btn" type="button" disabled={busy} aria-label="Edit lot" title="Edit lot" onClick={() => open(lot, !lot.id)}>
                <Pencil size={15} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {openLots.length >= 2 && (
        <label className="lst-field">
          <span>Online bookings go to</span>
          <select disabled={!canEdit || busy} value={bookingLotId} onChange={(event) => void sendBookingsTo(event.target.value)}>
            {openLots.map((lot) => (<option key={lot.id} value={lot.id}>{lot.name}</option>))}
          </select>
          <small className="lst-hint">When that lot is full, a booking goes to the next lot with room.</small>
        </label>
      )}
      {editing !== null && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!busy) setEditing(null); })}>
          <div className="lst-modal" style={{ maxWidth: 480 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <div><h3>{editing === "" ? "Add a lot" : "Edit lot"}</h3></div>
              <button className="lst-icon-btn" type="button" disabled={busy} onClick={() => setEditing(null)} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {error && <div className="lst-form-error" role="alert">{error}</div>}
              <label className="lst-field wide">
                <span>Lot name</span>
                <input autoFocus data-no-translate disabled={busy} maxLength={60} value={draft.name} onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))} />
              </label>
              <div className="lst-form-grid">
                <label className="lst-field">
                  <span>Spaces</span>
                  <input data-no-translate disabled={busy} inputMode="numeric" value={draft.totalSpaces} onChange={(event) => setDraft((d) => ({ ...d, totalSpaces: event.target.value }))} />
                </label>
                <label className="lst-field">
                  <span>Blocked spaces</span>
                  <input data-no-translate disabled={busy} inputMode="numeric" placeholder="0" value={draft.blockedSpaces} onChange={(event) => setDraft((d) => ({ ...d, blockedSpaces: event.target.value }))} />
                </label>
              </div>
              <label className="lst-field wide">
                <span>Street address (optional)</span>
                <input data-no-translate disabled={busy} maxLength={200} value={draft.addressLine1} onChange={(event) => setDraft((d) => ({ ...d, addressLine1: event.target.value }))} />
              </label>
              <div className="lst-form-grid">
                <label className="lst-field">
                  <span>City</span>
                  <input data-no-translate disabled={busy} maxLength={120} value={draft.city} onChange={(event) => setDraft((d) => ({ ...d, city: event.target.value }))} />
                </label>
                <label className="lst-field">
                  <span>State</span>
                  <input data-no-translate disabled={busy} maxLength={80} value={draft.state} onChange={(event) => setDraft((d) => ({ ...d, state: event.target.value }))} />
                </label>
              </div>
              <p className="lst-hint">Leave the address empty when the lot is at your business's parking address. Customers see the lot's name and address on their receipt.</p>
              {editingLot && editingLot.id && (
                <label className="lst-check">
                  <input type="checkbox" disabled={busy} checked={draft.open} onChange={(event) => setDraft((d) => ({ ...d, open: event.target.checked }))} />
                  <span>Open: cars can be parked here</span>
                </label>
              )}
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
              <button className="lst-btn" type="button" disabled={busy} aria-busy={busy} onClick={() => void save()}>
                {busy && <RefreshCw className="spin" size={14} />} Save lot
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
