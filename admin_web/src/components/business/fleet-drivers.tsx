"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CarFront, Plus, Search, Undo2, X } from "lucide-react";

import { Panel } from "@/components/panel";
import { useBusinessStaff } from "@/lib/business-data";
import { formatDayKey } from "@/lib/format";
import {
  centsToInput,
  dollarsToCents,
  driverDisplayName,
  driverLeaveConfirm,
  estimateFeeEffectiveDay,
  readPlateFeeInput,
  driverFilterCounts,
  driverFilterNarrowed,
  billInView,
  driverRows,
  emptyDriverFilter,
  paymentInView,
  type BillView,
  type PaymentView,
  filterDriverRows,
  freeCars,
  type DriverFilter,
  type DriverSort,
  returnRuleText,
  type FleetSettingsView,
} from "@/lib/fleet";
import { driverBalance, type FleetBill } from "@/lib/fleet-billing";
import { CHARGE_REASONS, composeChargeLabel, splitChargeLabel } from "@/lib/fleet-pickers";
import { moneyText } from "@/lib/invoice-ledger";
import { staffNameFrom, staffNameIndex } from "@/lib/staff-names";

import type { FleetState } from "./fleet-data";
import { FriendsPanel, NotesPanel, ProfileTenureFacts, TrackRecordPanel } from "./fleet-profile";
import { fleetLang, FleetModal, Money, SaveButton, useFleetRun } from "./fleet-ui";
import { FleetPayerNames } from "./fleet-payer-names";
import { ChargeReasonFields, DueDaySelect, FleetAddressFields, FleetPhoneField } from "./fleet-pickers";
import { FleetRemindButton } from "./fleet-whatsapp";

type Row = Record<string, unknown> & { id: string };
const s = (v: unknown) => String(v ?? "").trim();

const methodLabels: Record<string, string> = { zelle: "Zelle", cash: "Cash", other: "Other", import: "Imported" };
const billStatusLabels: Record<string, string> = { open: "Open", paid: "Paid", waived: "Waived", void: "Void" };
const billViewLabels: Record<BillView, string> = { open: "Open", paid: "Paid", waived: "Waived", all: "All" };
const paymentViewLabels: Record<PaymentView, string> = { all: "All", zelle: "Zelle", cash: "Cash", import: "Imported", other: "Other" };

// ---------------------------------------------------------------------------
// List.
// ---------------------------------------------------------------------------

export function FleetDrivers({
  state,
  businessId,
  isAdmin,
  settings,
  driverId,
  onOpenDriver,
  onOpenCar,
  intent = null,
  onIntentDone,
}: {
  state: FleetState;
  businessId: string;
  isAdmin: boolean;
  settings: FleetSettingsView;
  driverId: string;
  onOpenDriver: (id: string) => void;
  onOpenCar: (id: string) => void;
  /** What the Fleet page's New menu asked for (docs/FLEET.md section 15); done once, then cleared. */
  intent?: DriverIntent | null;
  onIntentDone?: () => void;
}) {
  const [filter, setFilter] = useState<DriverFilter>(emptyDriverFilter);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (intent !== "add") return;
    setAdding(true);
    onIntentDone?.();
  }, [intent, onIntentDone]);
  const lang = fleetLang();
  const rows = useMemo(() => driverRows(state.data, state.index, state.todayKey), [state]);
  const shown = useMemo(() => filterDriverRows(rows, filter), [rows, filter]);
  const counts = useMemo(() => driverFilterCounts(rows, filter.view), [rows, filter.view]);
  const narrowed = driverFilterNarrowed(filter);
  const shownOwedCents = useMemo(() => shown.reduce((sum, r) => sum + r.owedCents, 0), [shown]);
  const chip = (key: "owes" | "late" | "credit" | "noCar" | "noFee", label: string) =>
    (counts[key] > 0 || filter[key]) && (
      <button
        type="button"
        className={`pk-me-chip${filter[key] ? " on" : ""}`}
        aria-pressed={filter[key]}
        onClick={() => setFilter((f) => ({ ...f, [key]: !f[key] }))}
      >
        {label} <b data-no-translate>{counts[key]}</b>
      </button>
    );
  const selected = driverId ? state.index.driverById.get(driverId) : undefined;

  if (selected) {
    return (
      <DriverPage
        businessId={businessId}
        driver={selected}
        intent={intent && intent !== "add" ? intent : null}
        onIntentDone={onIntentDone}
        isAdmin={isAdmin}
        onBack={() => onOpenDriver("")}
        onOpenCar={onOpenCar}
        settings={settings}
        state={state}
      />
    );
  }

  return (
    <div className="stack fleet-page">
      <Panel
        title="Drivers"
        icon={<CarFront size={18} />}
        action={
          <button className="lst-btn" type="button" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add driver
          </button>
        }
      >
        <div className="fleet-toolbar">
          <label className="fleet-search">
            <Search aria-hidden="true" size={15} />
            <input
              aria-label="Search drivers"
              placeholder="Search name, phone or plate"
              value={filter.query}
              onChange={(event) => {
                const query = event.target.value;
                setFilter((f) => ({ ...f, query }));
              }}
            />
          </label>
          <label className="pk-me-select">
            <span>Sort by</span>
            <select value={filter.sort} onChange={(e) => {
              const sort = e.target.value as DriverSort;
              setFilter((f) => ({ ...f, sort }));
            }}>
              <option value="name">Name A–Z</option>
              <option value="owed">Most owed first</option>
            </select>
          </label>
        </div>
        <div className="pk-me-chips fleet-driver-chips">
          <div className="pk-view" role="group" aria-label="Which drivers">
            <button type="button" className={filter.view === "active" ? "on" : ""} aria-pressed={filter.view === "active"} onClick={() => setFilter((f) => ({ ...f, view: "active" }))}>Active (<span data-no-translate>{counts.active}</span>)</button>
            <button type="button" className={filter.view === "left" ? "on" : ""} aria-pressed={filter.view === "left"} onClick={() => setFilter((f) => ({ ...f, view: "left" }))}>Left (<span data-no-translate>{counts.left}</span>)</button>
            <button type="button" className={filter.view === "all" ? "on" : ""} aria-pressed={filter.view === "all"} onClick={() => setFilter((f) => ({ ...f, view: "all" }))}>Everyone (<span data-no-translate>{counts.all}</span>)</button>
          </div>
          {chip("owes", "Owes money")}
          {chip("late", "Late")}
          {chip("noFee", "No plate fee")}
          {chip("noCar", "No plate")}
          {chip("credit", "Has credit")}
          {narrowed && (
            <button className="ghost-button" type="button" onClick={() => setFilter((f) => ({ ...emptyDriverFilter, view: f.view, sort: f.sort }))}>
              <X size={14} /> Clear filters
            </button>
          )}
        </div>
        {state.loading && rows.length === 0 ? (
          <div className="empty-state">Loading drivers…</div>
        ) : shown.length === 0 ? (
          <div className="empty-state">{narrowed ? "No driver matches. Change the search or the filters." : rows.length === 0 ? "No drivers yet." : "No driver in this list."}</div>
        ) : (
          <div className="fleet-grid-scroll">
            <div className="fleet-grid" role="table">
              <div className="fleet-grid-row fleet-grid-head fleet-drivers-cols" role="row">
                <span>Driver</span>
                <span>Phone</span>
                <span>Status</span>
                <span>Plate</span>
                <span className="num">Owed</span>
                <span className="num">Credit</span>
              </div>
              {shown.map((r) => (
                <button className="fleet-grid-row fleet-drivers-cols" key={r.id} onClick={() => onOpenDriver(r.id)} type="button">
                  <span className="fleet-name" data-no-translate>{r.name}</span>
                  <span data-no-translate>{r.phone || "—"}</span>
                  <span><span className={`fleet-chip ${r.status === "active" ? "ok" : "muted"}`}>{r.status === "active" ? "Active" : "Left"}</span></span>
                  <span>
                    <span data-no-translate>{r.plate || "—"}</span>
                    {r.status === "active" && r.carId && r.rentCents <= 0 && <small className="fleet-no-fee">No plate fee</small>}
                  </span>
                  <span className={`num${r.lateCents > 0 ? " fleet-late" : ""}`} data-no-translate>{r.owedCents > 0 ? moneyText(r.owedCents, lang) : "—"}</span>
                  <span className="num" data-no-translate>{r.creditCents > 0 ? moneyText(r.creditCents, lang) : "—"}</span>
                </button>
              ))}
            </div>
            <p className="pk-me-foot">
              <span>Drivers shown:</span> <b data-no-translate>{shown.length}</b>
              {shownOwedCents > 0 && <> · <span>Owed by these drivers:</span> <b className="pk-owed" data-no-translate>{moneyText(shownOwedCents, lang)}</b></>}
            </p>
          </div>
        )}
      </Panel>
      {adding && (
        <DriverFormDialog
          businessId={businessId}
          driver={null}
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            if (id) onOpenDriver(id);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / edit a driver.
// ---------------------------------------------------------------------------

function DriverFormDialog({
  businessId,
  driver,
  onClose,
  onSaved,
}: {
  businessId: string;
  driver: Row | null;
  onClose: () => void;
  onSaved: (driverId: string) => void;
}) {
  const address = (driver?.address ?? {}) as Record<string, unknown>;
  const [draft, setDraft] = useState({
    name: s(driver?.name),
    phone: s(driver?.phone),
    tlcLicense: s(driver?.tlcLicense),
    line1: s(address.line1),
    city: s(address.city),
    state: s(address.state),
    zip: s(address.zip),
    notes: s(driver?.notes),
    status: s(driver?.status) === "left" ? "left" : "active",
  });
  const { busy, error, setError, run } = useFleetRun(businessId);
  const set = (key: keyof typeof draft) => (event: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [key]: event.target.value }));

  async function save() {
    if (!draft.name.trim()) {
      setError("Some details are missing or not valid.");
      return;
    }
    const result = await run<{ driverId?: string }>("driver_save", {
      driverId: driver?.id || undefined,
      driver: {
        name: draft.name,
        phone: draft.phone,
        tlcLicense: draft.tlcLicense,
        address: { line1: draft.line1, city: draft.city, state: draft.state, zip: draft.zip },
        notes: draft.notes,
        status: driver ? draft.status : undefined,
      },
    });
    if (result) onSaved(result.driverId || driver?.id || "");
  }

  return (
    <FleetModal
      title={driver ? "Edit driver" : "Add driver"}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <SaveButton busy={busy} label="Save driver" busyLabel="Saving..." onClick={() => void save()} />
        </>
      }
    >
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      <div className="lst-form-grid">
        <label className="lst-field wide">
          <span>Full name</span>
          <input autoFocus data-no-translate disabled={busy} maxLength={120} value={draft.name} onChange={set("name")} />
        </label>
        <FleetPhoneField id="fleet-driver-phone" value={draft.phone} onChange={(phone) => setDraft((d) => ({ ...d, phone }))} disabled={busy} />
        <label className="lst-field">
          <span>TLC licence</span>
          <input data-no-translate disabled={busy} maxLength={20} value={draft.tlcLicense} onChange={set("tlcLicense")} />
        </label>
        <FleetAddressFields
          idPrefix="fleet-driver"
          value={{ line1: draft.line1, city: draft.city, state: draft.state, zip: draft.zip }}
          onChange={(a) => setDraft((d) => ({ ...d, ...a }))}
          disabled={busy}
        />
        {driver && (
          <label className="lst-field">
            <span>Status</span>
            <select disabled={busy} value={draft.status} onChange={set("status")}>
              <option value="active">Active</option>
              <option value="left">Left</option>
            </select>
          </label>
        )}
        <label className="lst-field wide">
          <span>Notes</span>
          <textarea data-no-translate disabled={busy} maxLength={1000} rows={3} value={draft.notes} onChange={set("notes")} />
        </label>
      </div>
    </FleetModal>
  );
}

// ---------------------------------------------------------------------------
// A driver's page.
// ---------------------------------------------------------------------------

type Dialog = "edit" | "give" | "return" | "fee" | "leave" | "payment" | "charge" | { waive: Row } | { undo: Row } | null;

/**
 * What the Fleet page's New menu or Needs you asked for: Add driver (the
 * list), or a payment, a charge, or a given plate for the driver being opened.
 */
export type DriverIntent = "add" | "payment" | "charge" | { give: string } | { charge: string };

function DriverPage({
  businessId,
  driver,
  isAdmin,
  settings,
  state,
  onBack,
  onOpenCar,
  intent,
  onIntentDone,
}: {
  businessId: string;
  driver: Row;
  isAdmin: boolean;
  settings: FleetSettingsView;
  state: FleetState;
  onBack: () => void;
  onOpenCar: (id: string) => void;
  intent: Exclude<DriverIntent, "add"> | null;
  onIntentDone?: () => void;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  // The plate a "Give to a driver" picked before this page opened, and the
  // "What for" a ticket found by the plate search starts with.
  const [giveCarId, setGiveCarId] = useState("");
  const [chargeLabel, setChargeLabel] = useState("");
  useEffect(() => {
    if (!intent) return;
    if (typeof intent === "object" && "give" in intent) {
      setGiveCarId(intent.give);
      setDialog("give");
    } else if (typeof intent === "object") {
      setChargeLabel(intent.charge);
      setDialog("charge");
    } else {
      setDialog(intent);
    }
    onIntentDone?.();
  }, [intent, onIntentDone]);
  // Open bills first by default; every payment by default.
  const [billView, setBillView] = useState<BillView>("open");
  const [paymentView, setPaymentView] = useState<PaymentView>("all");
  // Bumped after a details edit so the track record re-reads its History lines.
  const [profileRefresh, setProfileRefresh] = useState(0);
  const lang = fleetLang();
  const staff =useBusinessStaff(businessId, true);
  const staffNames = useMemo(() => staffNameIndex(staff.rows), [staff.rows]);
  const current = state.index.currentByDriver.get(driver.id);
  const car = current ? state.index.carById.get(s(current.carId)) : undefined;
  const bills = useMemo(
    () => [...(state.index.billsByDriver.get(driver.id) ?? [])].sort((a, b) => s(b.dueDayKey).localeCompare(s(a.dueDayKey))),
    [state, driver.id],
  );
  const payments = useMemo(
    () =>
      [...(state.index.paymentsByDriver.get(driver.id) ?? [])].sort(
        (a, b) => s(b.paidDayKey).localeCompare(s(a.paidDayKey)) || Number(b.receivedAtMs || 0) - Number(a.receivedAtMs || 0),
      ),
    [state, driver.id],
  );
  const shownBills = useMemo(() => bills.filter((b) => billInView(b, billView)), [bills, billView]);
  const shownPayments = useMemo(() => payments.filter((p) => paymentInView(p, paymentView)), [payments, paymentView]);
  const balance = useMemo(() => driverBalance(bills, Number(driver.creditCents) || 0, state.todayKey), [bills, driver, state.todayKey]);
  const address = (driver.address ?? {}) as Record<string, unknown>;
  const addressLine = [address.line1, address.city, address.state, address.zip].map(s).filter(Boolean).join(", ");

  return (
    <div className="stack fleet-page">
      <button className="ghost-button compact fleet-back" type="button" onClick={onBack}>
        <ArrowLeft size={14} /> All drivers
      </button>
      <Panel
        title="Driver"
        icon={<CarFront size={18} />}
        action={
          <button className="ghost-button compact" type="button" onClick={() => setDialog("edit")}>Edit details</button>
        }
      >
        <div className="fleet-detail">
          <div>
            <h3 data-no-translate>{s(driver.name)}</h3>
            <p className="lst-hint" data-no-translate>
              {[s(driver.phone), s(driver.tlcLicense) && `TLC ${s(driver.tlcLicense)}`, addressLine].filter(Boolean).join(" · ") || "—"}
            </p>
            {s(driver.notes) && <p className="lst-hint" data-no-translate>{s(driver.notes)}</p>}
            <span className={`fleet-chip ${s(driver.status) === "left" ? "muted" : "ok"}`}>{s(driver.status) === "left" ? "Left" : "Active"}</span>
          </div>
          <div className="fleet-facts">
            <ProfileTenureFacts driver={driver} state={state} />
            <div>
              <small>Current plate</small>
              <b data-no-translate>{car ? s(car.plate) : "—"}</b>
            </div>
            <div><small>Owed now</small><Money cents={balance.owedCents} /></div>
            <div><small>Late</small><Money cents={balance.lateCents} /></div>
            <div><small>Credit</small><Money cents={balance.creditCents} /></div>
            <div>
              <small>Next due</small>
              {balance.nextDue ? (
                <b data-no-translate>{formatDayKey(balance.nextDue.dueDayKey, lang)} · {moneyText(balance.nextDue.cents, lang)}</b>
              ) : (
                <b>—</b>
              )}
            </div>
          </div>
        </div>
        <div className="fleet-actions">
          <button className="lst-btn" type="button" onClick={() => setDialog("payment")}>Record a payment</button>
          <button className="lst-btn ghost" type="button" onClick={() => setDialog("charge")}>Add a charge</button>
          {isAdmin && s(driver.status) !== "left" && (
            <button className="lst-btn ghost" type="button" onClick={() => setDialog("leave")}>Driver has left</button>
          )}
          <FleetRemindButton
            businessId={businessId}
            settings={settings}
            driverId={driver.id}
            active={s(driver.status) === "active"}
            owedCents={balance.owedCents}
          />
        </div>
      </Panel>

      <Panel title="Plate" icon={<CarFront size={18} />}>
        {current && car ? (
          <div className="fleet-detail">
            <div>
              <button className="fleet-link" type="button" onClick={() => onOpenCar(car.id)}>
                <b data-no-translate>{s(car.plate)}</b>
              </button>
              <p className="lst-hint" data-no-translate>
                {[s(car.company), s(car.vehicleType)].filter(Boolean).join(" · ")}
              </p>
              <p className="lst-hint">
                Since <span data-no-translate>{formatDayKey(current.startDayKey, lang)}</span>
                {" · "}
                <span data-no-translate>{moneyText(Number(current.rentCents) || 0, lang)}</span>{" "}
                {current.period === "weekly" ? "a week" : "a month"}
                {" · "}
                {current.period === "weekly" ? "Due weekday" : "Due day"} <span data-no-translate>{String(current.dueDay)}</span>
              </p>
            </div>
            {isAdmin && (
              <div className="fleet-actions">
                <button className="lst-btn ghost" type="button" onClick={() => setDialog("fee")}>Change plate fee</button>
                <button className="lst-btn ghost" type="button" onClick={() => setDialog("return")}>Plate returned</button>
              </div>
            )}
          </div>
        ) : (
          <div className="fleet-detail">
            <p className="lst-hint">No plate right now.</p>
            {isAdmin && (
              <button className="lst-btn" type="button" onClick={() => setDialog("give")}>Give a plate</button>
            )}
          </div>
        )}
      </Panel>

      <FleetPayerNames businessId={businessId} driver={driver} />
      <TrackRecordPanel businessId={businessId} driver={driver} refresh={profileRefresh} state={state} />
      <NotesPanel businessId={businessId} driver={driver} isAdmin={isAdmin} state={state} />
      <FriendsPanel businessId={businessId} driver={driver} isAdmin={isAdmin} state={state} />

      <Panel title="Bills" icon={<CarFront size={18} />}>
        {bills.length > 0 && (
          <div className="pk-view fleet-list-view" role="group" aria-label="Which bills">
            {(["open", "paid", "waived", "all"] as BillView[]).map((v) => (
              <button key={v} type="button" className={billView === v ? "on" : ""} aria-pressed={billView === v} onClick={() => setBillView(v)}>
                {billViewLabels[v]} (<span data-no-translate>{bills.filter((b) => billInView(b, v)).length}</span>)
              </button>
            ))}
          </div>
        )}
        {bills.length === 0 ? (
          <div className="empty-state">No bills yet.</div>
        ) : shownBills.length === 0 ? (
          <div className="empty-state">No bill in this list.</div>
        ) : (
          <div className="fleet-grid-scroll">
            <table className="fleet-table">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Due</th>
                  <th className="num">Amount</th>
                  <th className="num">Paid</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shownBills.map((b) => {
                  const late = b.status === "open" && s(b.dueDayKey) < state.todayKey;
                  return (
                    <tr key={b.id}>
                      <td data-no-translate>{s(b.label) || s(b.kind)}</td>
                      <td data-no-translate>{formatDayKey(b.dueDayKey, lang)}</td>
                      <td className="num"><Money cents={Number(b.amountCents) || 0} /></td>
                      <td className="num"><Money cents={Number(b.paidCents) || 0} /></td>
                      <td>
                        <span className={`fleet-chip ${b.status === "paid" ? "ok" : late ? "bad" : b.status === "open" ? "warn" : "muted"}`}>
                          {late ? "Late" : billStatusLabels[s(b.status)] ?? "Open"}
                        </span>
                        {b.status === "waived" && Boolean((b.waived as { reason?: string } | undefined)?.reason) && (
                          <small className="fleet-note" data-no-translate>{String((b.waived as { reason?: string }).reason)}</small>
                        )}
                      </td>
                      <td className="num">
                        {isAdmin && b.status === "open" && (
                          <button className="ghost-button compact" type="button" onClick={() => setDialog({ waive: b as unknown as Row })}>Waive</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Payments" icon={<CarFront size={18} />}>
        {payments.length > 0 && (
          <div className="pk-view fleet-list-view" role="group" aria-label="Which payments">
            {(["all", "zelle", "cash", "import", "other"] as PaymentView[]).map((v) => {
              const count = payments.filter((p) => paymentInView(p, v)).length;
              return v !== "all" && count === 0 && paymentView !== v ? null : (
                <button key={v} type="button" className={paymentView === v ? "on" : ""} aria-pressed={paymentView === v} onClick={() => setPaymentView(v)}>
                  {paymentViewLabels[v]} (<span data-no-translate>{count}</span>)
                </button>
              );
            })}
          </div>
        )}
        {payments.length === 0 ? (
          <div className="empty-state">No payments yet.</div>
        ) : shownPayments.length === 0 ? (
          <div className="empty-state">No payment in this list.</div>
        ) : (
          <div className="fleet-grid-scroll">
            <table className="fleet-table">
              <thead>
                <tr>
                  <th>Paid on</th>
                  <th className="num">Amount</th>
                  <th>Method</th>
                  <th>Recorded by</th>
                  <th>Note</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shownPayments.map((p) => (
                  <tr className={p.status === "undone" ? "fleet-undone" : ""} key={p.id}>
                    <td data-no-translate>{formatDayKey(p.paidDayKey, lang)}</td>
                    <td className="num"><Money cents={Number(p.amountCents) || 0} /></td>
                    <td>{methodLabels[s(p.method)] ?? "Other"}</td>
                    <td data-no-translate>{p.imported ? "—" : staffNameFrom(staffNames, p.receivedByUid) || "—"}</td>
                    <td data-no-translate>
                      {s(p.note)}
                      {Number(p.creditAddedCents) > 0 && ` (${moneyText(Number(p.creditAddedCents), lang)} → credit)`}
                    </td>
                    <td className="num">
                      {p.status === "undone" ? (
                        <span className="fleet-chip muted">Undone</span>
                      ) : (
                        // A payment brought in from the spreadsheet is history:
                        // it has no bill split to take back (docs/FLEET.md §5).
                        isAdmin && p.imported !== true && (
                          <button className="ghost-button compact" type="button" onClick={() => setDialog({ undo: p })}>
                            <Undo2 size={13} /> Undo
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {dialog === "edit" && (
        <DriverFormDialog
          businessId={businessId}
          driver={driver}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setProfileRefresh((n) => n + 1);
          }}
        />
      )}
      {dialog === "payment" && <PaymentDialog businessId={businessId} driver={driver} todayKey={state.todayKey} onClose={() => setDialog(null)} />}
      {dialog === "charge" && (
        <ChargeDialog
          businessId={businessId}
          driver={driver}
          initialLabel={chargeLabel}
          todayKey={state.todayKey}
          onClose={() => {
            setChargeLabel("");
            setDialog(null);
          }}
        />
      )}
      {dialog === "fee" && current && car && (
        <ChangeFeeDialog
          assignment={current}
          bills={bills}
          businessId={businessId}
          driver={driver}
          plate={s(car.plate)}
          todayKey={state.todayKey}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "leave" && (
        <DriverLeftDialog businessId={businessId} driver={driver} plate={car ? s(car.plate) : ""} todayKey={state.todayKey} onClose={() => setDialog(null)} />
      )}
      {dialog === "give" && (
        <GiveCarDialog
          businessId={businessId}
          driver={driver}
          initialCarId={giveCarId}
          state={state}
          onClose={() => {
            setGiveCarId("");
            setDialog(null);
          }}
        />
      )}
      {dialog === "return" && current && (
        <ReturnCarDialog
          assignment={current}
          businessId={businessId}
          driver={driver}
          onClose={() => setDialog(null)}
          rule={settings.returnRule}
          todayKey={state.todayKey}
        />
      )}
      {typeof dialog === "object" && dialog && "waive" in dialog && (
        <WaiveDialog bill={dialog.waive as unknown as FleetBill & Row} businessId={businessId} onClose={() => setDialog(null)} />
      )}
      {typeof dialog === "object" && dialog && "undo" in dialog && (
        <UndoDialog businessId={businessId} onClose={() => setDialog(null)} payment={dialog.undo} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs.
// ---------------------------------------------------------------------------

function CancelClose({ busy, onClose, label = "Cancel" }: { busy: boolean; onClose: () => void; label?: string }) {
  return <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>{label}</button>;
}

function PaymentDialog({ businessId, driver, todayKey, onClose }: { businessId: string; driver: Row; todayKey: string; onClose: () => void }) {
  const lang = fleetLang();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("zelle");
  const [day, setDay] = useState(todayKey);
  const [note, setNote] = useState("");
  const [credit, setCredit] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useFleetRun(businessId);

  async function save() {
    const cents = dollarsToCents(amount);
    if (!cents) {
      setError("Enter an amount.");
      return;
    }
    const name = driverDisplayName(driver.name);
    const shown = moneyText(cents, "en");
    const result = await run<{ creditAddedCents?: number }>(
      "payment_record",
      { driverId: driver.id, amountCents: cents, method, paidDayKey: day, note },
      {
        en: `Record ${shown} from ${name} (${methodLabels[method]})? It is spread over their oldest bills first.`,
        fr: `Enregistrer ${moneyText(cents, "fr")} de ${name} (${methodLabels[method]}) ? Il est réparti d’abord sur leurs plus anciennes factures.`,
      },
    );
    if (result) {
      setCredit(Number(result.creditAddedCents) || 0);
      setDone(true);
    }
  }

  return (
    <FleetModal
      title="Record a payment"
      subtitle={<span data-no-translate>{s(driver.name)}</span>}
      onClose={onClose}
      busy={busy}
      width={480}
      footer={
        done ? (
          <button className="lst-btn" type="button" onClick={onClose}>Close</button>
        ) : (
          <>
            <CancelClose busy={busy} onClose={onClose} />
            <SaveButton busy={busy} label="Record payment" busyLabel="Recording..." onClick={() => void save()} />
          </>
        )
      }
    >
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {done ? (
        <p>
          Payment recorded.{" "}
          {credit ? (
            <>
              <b data-no-translate>{moneyText(credit, lang)}</b> was more than they owed and went to their credit, which pays their next bill.
            </>
          ) : (
            "It was spread over their open bills, oldest first."
          )}
        </p>
      ) : (
        <div className="lst-form-grid">
          <label className="lst-field">
            <span>Amount ($)</span>
            <input autoFocus data-no-translate disabled={busy} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="lst-field">
            <span>Method</span>
            <select disabled={busy} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="zelle">Zelle</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="lst-field">
            <span>Paid on</span>
            <input disabled={busy} type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <label className="lst-field wide">
            <span>Note (optional)</span>
            <input data-no-translate disabled={busy} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      )}
    </FleetModal>
  );
}

function ChargeDialog({
  businessId,
  driver,
  todayKey,
  onClose,
  initialLabel = "",
}: {
  businessId: string;
  driver: Row;
  todayKey: string;
  onClose: () => void;
  initialLabel?: string;
}) {
  const [amount, setAmount] = useState("");
  // A ticket from the search arrives as "Ticket · T712000C · Oct 3".
  const [reason, setReason] = useState(() => (initialLabel ? splitChargeLabel(initialLabel).reason : CHARGE_REASONS[0]));
  const [details, setDetails] = useState(() => splitChargeLabel(initialLabel).details);
  const label = composeChargeLabel(reason, details);
  const [due, setDue] = useState(todayKey);
  const { busy, error, setError, run } = useFleetRun(businessId);

  async function save() {
    const cents = dollarsToCents(amount);
    if (!cents || !label.trim()) {
      setError("Some details are missing or not valid.");
      return;
    }
    const name = driverDisplayName(driver.name);
    const result = await run(
      "charge_add",
      { driverId: driver.id, amountCents: cents, label: label.trim(), dueDayKey: due },
      {
        en: `Charge ${name} ${moneyText(cents, "en")} for “${label.trim()}”? It becomes a bill they owe.`,
        fr: `Facturer ${moneyText(cents, "fr")} à ${name} pour « ${label.trim()} » ? Cela devient une facture due.`,
      },
    );
    if (result) onClose();
  }

  return (
    <FleetModal
      title="Add a charge"
      subtitle={<span data-no-translate>{s(driver.name)}</span>}
      onClose={onClose}
      busy={busy}
      width={480}
      footer={
        <>
          <CancelClose busy={busy} onClose={onClose} />
          <SaveButton busy={busy} label="Add charge" busyLabel="Adding..." onClick={() => void save()} />
        </>
      }
    >
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      <div className="lst-form-grid">
        <ChargeReasonFields reason={reason} details={details} onReason={setReason} onDetails={setDetails} disabled={busy} />
        <label className="lst-field">
          <span>Amount ($)</span>
          <input autoFocus={Boolean(reason)} data-no-translate disabled={busy} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="lst-field">
          <span>Due on</span>
          <input disabled={busy} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
    </FleetModal>
  );
}

function GiveCarDialog({
  businessId,
  driver,
  state,
  onClose,
  initialCarId = "",
}: {
  businessId: string;
  driver: Row;
  state: FleetState;
  onClose: () => void;
  /** A free plate already picked (Needs you, or the plate's own page). */
  initialCarId?: string;
}) {
  const free = useMemo(() => freeCars(state.data, state.index), [state]);
  const [carId, setCarId] = useState(() => (free.some((c) => c.id === initialCarId) ? initialCarId : ""));
  const [start, setStart] = useState(state.todayKey);
  // A plate picked in advance starts with the fee its last driver paid; the office can change it.
  const [rent, setRent] = useState(() => {
    if (!initialCarId) return "";
    const last = [...(state.index.assignmentsByCar.get(initialCarId) ?? [])].sort((x, y) => s(y.startDayKey).localeCompare(s(x.startDayKey)))[0];
    return last && Number(last.rentCents) > 0 ? centsToInput(last.rentCents) : "";
  });
  const [period, setPeriod] = useState<"monthly" | "weekly">("monthly");
  const [dueDay, setDueDay] = useState("1");
  const { busy, error, setError, run } = useFleetRun(businessId);

  async function save() {
    const cents = dollarsToCents(rent);
    const day = Number(dueDay);
    if (!carId || !cents || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !(day >= 1 && day <= (period === "weekly" ? 7 : 28))) {
      setError("Some details are missing or not valid.");
      return;
    }
    const car = state.index.carById.get(carId);
    const name = driverDisplayName(driver.name);
    const plate = s(car?.plate);
    const result = await run(
      "assignment_start",
      { driverId: driver.id, carId, startDayKey: start, rentCents: cents, period, dueDay: day },
      {
        en: `Give car ${plate} to ${name} from ${start}, ${moneyText(cents, "en")} ${period === "weekly" ? "a week" : "a month"}? Their rent bills start now.`,
        fr: `Donner la voiture ${plate} à ${name} à partir du ${start}, ${moneyText(cents, "fr")} ${period === "weekly" ? "par semaine" : "par mois"} ? Leurs factures de loyer commencent maintenant.`,
      },
    );
    if (result) onClose();
  }

  return (
    <FleetModal
      title="Give a plate"
      subtitle={<span data-no-translate>{s(driver.name)}</span>}
      onClose={onClose}
      busy={busy}
      width={520}
      footer={
        <>
          <CancelClose busy={busy} onClose={onClose} />
          <SaveButton busy={busy} disabled={free.length === 0} label="Give the plate" busyLabel="Saving..." onClick={() => void save()} />
        </>
      }
    >
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {free.length === 0 && <p className="lst-hint">Every plate has a driver. Add a plate first, or get one back.</p>}
      <div className="lst-form-grid">
        <label className="lst-field wide">
          <span>Plate</span>
          <select disabled={busy} value={carId} onChange={(e) => setCarId(e.target.value)}>
            <option value="">Choose a plate…</option>
            {free.map((c) => (
              <option data-no-translate key={c.id} value={c.id}>
                {s(c.plate)}{s(c.company) ? ` · ${s(c.company)}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="lst-field">
          <span>Start date</span>
          <input disabled={busy} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="lst-field">
          <span>Rent ($)</span>
          <input data-no-translate disabled={busy} inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} />
        </label>
        <label className="lst-field">
          <span>Rent is paid</span>
          <select
            disabled={busy}
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value as "monthly" | "weekly");
              setDueDay(e.target.value === "weekly" ? "1" : "1");
            }}
          >
            <option value="monthly">Monthly</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        <DueDaySelect
          label={period === "weekly" ? "Due weekday" : "Due day of the month"}
          weekly={period === "weekly"}
          value={dueDay}
          onChange={setDueDay}
          disabled={busy}
        />
      </div>
    </FleetModal>
  );
}

function ReturnCarDialog({
  businessId,
  driver,
  assignment,
  rule,
  todayKey,
  onClose,
}: {
  businessId: string;
  driver: Row;
  assignment: Row;
  rule: "full" | "days";
  todayKey: string;
  onClose: () => void;
}) {
  const [day, setDay] = useState(todayKey);
  const [credit, setCredit] = useState<number | null>(null);
  const { busy, error, setError, run } = useFleetRun(businessId);

  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setError("Some details are missing or not valid.");
      return;
    }
    const name = driverDisplayName(driver.name);
    const result = await run<{ creditBackCents?: number }>(
      "assignment_end",
      { assignmentId: assignment.id, endDayKey: day },
      {
        en: `Mark the car as returned by ${name} on ${day}? ${returnRuleText(rule)}`,
        fr: `Marquer la voiture comme rendue par ${name} le ${day} ? ${rule === "days" ? "Une voiture rendue en cours de période est facturée pour les jours utilisés." : "Une voiture rendue en cours de période est facturée pour la période complète."}`,
      },
    );
    if (result) setCredit(Number(result.creditBackCents) || 0);
  }

  return (
    <FleetModal
      title="Plate returned"
      subtitle={<span data-no-translate>{s(driver.name)}</span>}
      onClose={onClose}
      busy={busy}
      width={480}
      footer={
        credit !== null ? (
          <button className="lst-btn" type="button" onClick={onClose}>Close</button>
        ) : (
          <>
            <CancelClose busy={busy} onClose={onClose} />
            <SaveButton busy={busy} label="Mark as returned" busyLabel="Saving..." onClick={() => void save()} />
          </>
        )
      }
    >
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {credit !== null ? (
        <p>
          The car is back.{" "}
          {credit > 0 && (
            <>
              <b data-no-translate>{moneyText(credit, fleetLang())}</b> they had paid for days they did not use went to their credit.
            </>
          )}
        </p>
      ) : (
        <>
          <p className="lst-hint">{returnRuleText(rule)}</p>
          <label className="lst-field">
            <span>Returned on</span>
            <input disabled={busy} type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
        </>
      )}
    </FleetModal>
  );
}

function ChangeFeeDialog({
  businessId,
  driver,
  assignment,
  bills,
  plate,
  todayKey,
  onClose,
}: {
  businessId: string;
  driver: Row;
  assignment: Row;
  bills: FleetBill[];
  plate: string;
  todayKey: string;
  onClose: () => void;
}) {
  const lang = fleetLang();
  const weekly = assignment.period === "weekly";
  const [amount, setAmount] = useState(centsToInput(assignment.rentCents));
  const [dueDay, setDueDay] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const { busy, error, setError, run } = useFleetRun(businessId);
  const estimate = useMemo(() => estimateFeeEffectiveDay(assignment, bills, todayKey), [assignment, bills, todayKey]);

  async function save() {
    const input = readPlateFeeInput(amount, dueDay, { rentCents: assignment.rentCents, dueDay: assignment.dueDay, period: assignment.period });
    if (!input.ok) {
      setError(input.error);
      return;
    }
    const name = driverDisplayName(driver.name);
    const when = formatDayKey(estimate, "en");
    const whenFr = formatDayKey(estimate, "fr");
    const what = input.payload.rentCents !== undefined ? moneyText(input.payload.rentCents, "en") : "";
    const whatFr = input.payload.rentCents !== undefined ? moneyText(input.payload.rentCents, "fr") : "";
    const result = await run<{ effectiveDayKey?: string }>(
      "assignment_update",
      { assignmentId: assignment.id, ...input.payload },
      {
        en: `Change ${name}'s plate fee for ${plate}${what ? ` to ${what}` : ""}${input.payload.dueDay ? `, due day ${input.payload.dueDay}` : ""}? It applies from ${when}. Bills already made are not changed.`,
        fr: `Modifier les frais de plaque de ${name} pour ${plate}${whatFr ? ` à ${whatFr}` : ""}${input.payload.dueDay ? `, jour d’échéance ${input.payload.dueDay}` : ""} ? Cela s’applique à partir du ${whenFr}. Les factures déjà créées ne sont pas modifiées.`,
      },
    );
    if (result) setAppliedFrom(s(result.effectiveDayKey) || estimate);
  }

  return (
    <FleetModal
      title="Change plate fee"
      subtitle={<span data-no-translate>{s(driver.name)} · {plate}</span>}
      onClose={onClose}
      busy={busy}
      width={480}
      footer={
        appliedFrom ? (
          <button className="lst-btn" type="button" onClick={onClose}>Close</button>
        ) : (
          <>
            <CancelClose busy={busy} onClose={onClose} />
            <SaveButton busy={busy} label="Save plate fee" busyLabel="Saving..." onClick={() => void save()} />
          </>
        )
      }
    >
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {appliedFrom ? (
        <p>
          Saved. <span>Applies from</span> <b data-no-translate>{formatDayKey(appliedFrom, lang)}</b>. <span>Bills already made are not changed.</span>
        </p>
      ) : (
        <>
          <div className="lst-form-grid">
            <label className="lst-field">
              <span>{weekly ? "New plate fee a week ($)" : "New plate fee a month ($)"}</span>
              <input autoFocus data-no-translate disabled={busy} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <DueDaySelect
              label={weekly ? "Due weekday" : "Due day of the month"}
              weekly={weekly}
              value={dueDay}
              onChange={setDueDay}
              disabled={busy}
              emptyLabel="Keep the same day"
            />
          </div>
          <p className="lst-hint">
            <span>Applies from</span> <span data-no-translate>{formatDayKey(estimate, lang)}</span>. <span>Bills already made are not changed.</span>
          </p>
        </>
      )}
    </FleetModal>
  );
}

function DriverLeftDialog({
  businessId,
  driver,
  plate,
  todayKey,
  onClose,
}: {
  businessId: string;
  driver: Row;
  plate: string;
  todayKey: string;
  onClose: () => void;
}) {
  const [day, setDay] = useState(todayKey);
  const [ended, setEnded] = useState<number | null>(null);
  const { busy, error, setError, run } = useFleetRun(businessId);

  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setError("Some details are missing or not valid.");
      return;
    }
    const result = await run<{ ended?: number }>(
      "driver_leave",
      { driverId: driver.id, endDayKey: day },
      {
        en: driverLeaveConfirm(driver.name, plate, formatDayKey(day, "en")).en,
        fr: driverLeaveConfirm(driver.name, plate, formatDayKey(day, "fr")).fr,
      },
    );
    if (result) setEnded(Number(result.ended) || 0);
  }

  return (
    <FleetModal
      title="Driver has left"
      subtitle={<span data-no-translate>{s(driver.name)}</span>}
      onClose={onClose}
      busy={busy}
      width={480}
      footer={
        ended !== null ? (
          <button className="lst-btn" type="button" onClick={onClose}>Close</button>
        ) : (
          <>
            <CancelClose busy={busy} onClose={onClose} />
            <SaveButton danger busy={busy} label="Driver has left" busyLabel="Saving..." onClick={() => void save()} />
          </>
        )
      }
    >
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {ended !== null ? (
        <p>The driver is marked as left. Their plate came back and their bills stopped.</p>
      ) : (
        <>
          <p className="lst-hint">{plate ? "The plate comes back on this date and bills stop." : "Bills stop on this date."}</p>
          <label className="lst-field">
            <span>Left on</span>
            <input disabled={busy} type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
        </>
      )}
    </FleetModal>
  );
}

function WaiveDialog({ bill, businessId, onClose }: { bill: Row; businessId: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const { busy, error, setError, run } = useFleetRun(businessId);

  async function save() {
    if (!reason.trim()) {
      setError("Say why.");
      return;
    }
    const cents = Number(bill.amountCents) || 0;
    const label = s(bill.label);
    const result = await run(
      "bill_waive",
      { billId: bill.id, reason: reason.trim() },
      {
        en: `Waive “${label}” (${moneyText(cents, "en")})? The driver will no longer owe it.`,
        fr: `Annuler « ${label} » (${moneyText(cents, "fr")}) ? Le chauffeur ne le devra plus.`,
      },
    );
    if (result) onClose();
  }

  return (
    <FleetModal
      title="Waive this bill"
      subtitle={<span data-no-translate>{s(bill.label)}</span>}
      onClose={onClose}
      busy={busy}
      width={460}
      footer={
        <>
          <CancelClose busy={busy} onClose={onClose} label="Keep the bill" />
          <SaveButton busy={busy} label="Waive it" busyLabel="Saving..." onClick={() => void save()} />
        </>
      }
    >
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      <label className="lst-field wide">
        <span>Reason</span>
        <input autoFocus data-no-translate disabled={busy} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
    </FleetModal>
  );
}

function UndoDialog({ payment, businessId, onClose }: { payment: Row; businessId: string; onClose: () => void }) {
  const { busy, error, run } = useFleetRun(businessId);
  const cents = Number(payment.amountCents) || 0;

  async function save() {
    const result = await run(
      "payment_undo",
      { paymentId: payment.id },
      {
        en: `Undo this ${moneyText(cents, "en")} payment? The bills it paid open again and any credit it created is taken back.`,
        fr: `Annuler ce paiement de ${moneyText(cents, "fr")} ? Les factures qu’il a payées sont rouvertes et le crédit qu’il a créé est repris.`,
      },
    );
    if (result) onClose();
  }

  return (
    <FleetModal
      title="Undo this payment?"
      subtitle={
        <>
          <span data-no-translate>{formatDayKey(payment.paidDayKey, fleetLang())}</span>
          {" · "}
          <Money cents={cents} />
        </>
      }
      onClose={onClose}
      busy={busy}
      width={460}
      footer={
        <>
          <CancelClose busy={busy} onClose={onClose} label="Keep the payment" />
          <SaveButton danger busy={busy} label="Undo the payment" busyLabel="Undoing..." onClick={() => void save()} />
        </>
      }
    >
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      <p>The payment stays in the history, marked undone.</p>
    </FleetModal>
  );
}
