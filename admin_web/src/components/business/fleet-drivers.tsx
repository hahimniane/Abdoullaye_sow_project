"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CarFront, Plus, Search, Undo2 } from "lucide-react";

import { Panel } from "@/components/panel";
import { useBusinessStaff } from "@/lib/business-data";
import { formatDayKey } from "@/lib/format";
import {
  dollarsToCents,
  driverRows,
  freeCars,
  matchesSearch,
  returnRuleText,
  zelleAmountText,
  type FleetSettingsView,
} from "@/lib/fleet";
import { driverBalance, type FleetBill } from "@/lib/fleet-billing";
import { moneyText } from "@/lib/invoice-ledger";
import { staffNameFrom, staffNameIndex } from "@/lib/staff-names";

import type { FleetState } from "./fleet-data";
import { fleetLang, FleetModal, Money, SaveButton, useFleetRun } from "./fleet-ui";

type Row = Record<string, unknown> & { id: string };
const s = (v: unknown) => String(v ?? "").trim();

const methodLabels: Record<string, string> = { zelle: "Zelle", cash: "Cash", other: "Other", import: "Imported" };
const billStatusLabels: Record<string, string> = { open: "Open", paid: "Paid", waived: "Waived", void: "Void" };

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
}: {
  state: FleetState;
  businessId: string;
  isAdmin: boolean;
  settings: FleetSettingsView;
  driverId: string;
  onOpenDriver: (id: string) => void;
  onOpenCar: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const lang = fleetLang();
  const rows = useMemo(() => driverRows(state.data, state.index, state.todayKey), [state]);
  const shown = useMemo(() => (search.trim() ? rows.filter((r) => matchesSearch(r.search, search)) : rows), [rows, search]);
  const selected = driverId ? state.index.driverById.get(driverId) : undefined;

  if (selected) {
    return (
      <DriverPage
        businessId={businessId}
        driver={selected}
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
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        {state.loading && rows.length === 0 ? (
          <div className="empty-state">Loading drivers…</div>
        ) : shown.length === 0 ? (
          <div className="empty-state">{search.trim() ? "No driver matches that search." : "No drivers yet."}</div>
        ) : (
          <div className="fleet-grid-scroll">
            <div className="fleet-grid" role="table">
              <div className="fleet-grid-row fleet-grid-head fleet-drivers-cols" role="row">
                <span>Driver</span>
                <span>Phone</span>
                <span>Status</span>
                <span>Car</span>
                <span className="num">Owed</span>
                <span className="num">Credit</span>
                <span className="num">Zelle cents</span>
              </div>
              {shown.map((r) => (
                <button className="fleet-grid-row fleet-drivers-cols" key={r.id} onClick={() => onOpenDriver(r.id)} type="button">
                  <span className="fleet-name" data-no-translate>{r.name}</span>
                  <span data-no-translate>{r.phone || "—"}</span>
                  <span><span className={`fleet-chip ${r.status === "active" ? "ok" : "muted"}`}>{r.status === "active" ? "Active" : "Left"}</span></span>
                  <span data-no-translate>{r.plate || "—"}</span>
                  <span className={`num${r.lateCents > 0 ? " fleet-late" : ""}`} data-no-translate>{r.owedCents > 0 ? moneyText(r.owedCents, lang) : "—"}</span>
                  <span className="num" data-no-translate>{r.creditCents > 0 ? moneyText(r.creditCents, lang) : "—"}</span>
                  <span className="num" data-no-translate>{r.personalCents === null ? "—" : String(r.personalCents).padStart(2, "0")}</span>
                </button>
              ))}
            </div>
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
        <label className="lst-field">
          <span>Phone</span>
          <input data-no-translate disabled={busy} inputMode="tel" value={draft.phone} onChange={set("phone")} />
        </label>
        <label className="lst-field">
          <span>TLC licence</span>
          <input data-no-translate disabled={busy} maxLength={20} value={draft.tlcLicense} onChange={set("tlcLicense")} />
        </label>
        <label className="lst-field wide">
          <span>Street address</span>
          <input data-no-translate disabled={busy} maxLength={160} value={draft.line1} onChange={set("line1")} />
        </label>
        <label className="lst-field">
          <span>City</span>
          <input data-no-translate disabled={busy} maxLength={80} value={draft.city} onChange={set("city")} />
        </label>
        <label className="lst-field">
          <span>State</span>
          <input data-no-translate disabled={busy} maxLength={40} value={draft.state} onChange={set("state")} />
        </label>
        <label className="lst-field">
          <span>ZIP code</span>
          <input data-no-translate disabled={busy} maxLength={12} value={draft.zip} onChange={set("zip")} />
        </label>
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

type Dialog = "edit" | "give" | "return" | "payment" | "charge" | { waive: Row } | { undo: Row } | null;

function DriverPage({
  businessId,
  driver,
  isAdmin,
  settings,
  state,
  onBack,
  onOpenCar,
}: {
  businessId: string;
  driver: Row;
  isAdmin: boolean;
  settings: FleetSettingsView;
  state: FleetState;
  onBack: () => void;
  onOpenCar: (id: string) => void;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const lang = fleetLang();
  const staff = useBusinessStaff(businessId, true);
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
  const balance = useMemo(() => driverBalance(bills, Number(driver.creditCents) || 0, state.todayKey), [bills, driver, state.todayKey]);
  const code = zelleAmountText(balance.owedCents, driver.personalCents);
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
        <p className="lst-hint">
          {code ? (
            <>
              <span>Zelle amount for this driver</span> <b data-no-translate>{code}</b>
              <br />
              <span>The last two digits are this driver&apos;s own, so the amount tells us who paid.</span>
            </>
          ) : (
            "This driver has no Zelle cents yet (only active drivers get them)."
          )}
        </p>
        <div className="fleet-actions">
          <button className="lst-btn" type="button" onClick={() => setDialog("payment")}>Record a payment</button>
          <button className="lst-btn ghost" type="button" onClick={() => setDialog("charge")}>Add a charge</button>
        </div>
      </Panel>

      <Panel title="Car" icon={<CarFront size={18} />}>
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
              <button className="lst-btn ghost" type="button" onClick={() => setDialog("return")}>Car returned</button>
            )}
          </div>
        ) : (
          <div className="fleet-detail">
            <p className="lst-hint">No car right now.</p>
            {isAdmin && (
              <button className="lst-btn" type="button" onClick={() => setDialog("give")}>Give a car</button>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Bills" icon={<CarFront size={18} />}>
        {bills.length === 0 ? (
          <div className="empty-state">No bills yet.</div>
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
                {bills.map((b) => {
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
        {payments.length === 0 ? (
          <div className="empty-state">No payments yet.</div>
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
                {payments.map((p) => (
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
                        isAdmin && (
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
        <DriverFormDialog businessId={businessId} driver={driver} onClose={() => setDialog(null)} onSaved={() => setDialog(null)} />
      )}
      {dialog === "payment" && <PaymentDialog businessId={businessId} driver={driver} todayKey={state.todayKey} onClose={() => setDialog(null)} />}
      {dialog === "charge" && <ChargeDialog businessId={businessId} driver={driver} todayKey={state.todayKey} onClose={() => setDialog(null)} />}
      {dialog === "give" && <GiveCarDialog businessId={businessId} driver={driver} state={state} onClose={() => setDialog(null)} />}
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
    const name = s(driver.name);
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

function ChargeDialog({ businessId, driver, todayKey, onClose }: { businessId: string; driver: Row; todayKey: string; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [due, setDue] = useState(todayKey);
  const { busy, error, setError, run } = useFleetRun(businessId);

  async function save() {
    const cents = dollarsToCents(amount);
    if (!cents || !label.trim()) {
      setError("Some details are missing or not valid.");
      return;
    }
    const name = s(driver.name);
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
        <label className="lst-field wide">
          <span>What for</span>
          <input autoFocus data-no-translate disabled={busy} maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="lst-field">
          <span>Amount ($)</span>
          <input data-no-translate disabled={busy} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="lst-field">
          <span>Due on</span>
          <input disabled={busy} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
    </FleetModal>
  );
}

function GiveCarDialog({ businessId, driver, state, onClose }: { businessId: string; driver: Row; state: FleetState; onClose: () => void }) {
  const free = useMemo(() => freeCars(state.data, state.index), [state]);
  const [carId, setCarId] = useState("");
  const [start, setStart] = useState(state.todayKey);
  const [rent, setRent] = useState("");
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
    const name = s(driver.name);
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
      title="Give a car"
      subtitle={<span data-no-translate>{s(driver.name)}</span>}
      onClose={onClose}
      busy={busy}
      width={520}
      footer={
        <>
          <CancelClose busy={busy} onClose={onClose} />
          <SaveButton busy={busy} disabled={free.length === 0} label="Give the car" busyLabel="Saving..." onClick={() => void save()} />
        </>
      }
    >
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {free.length === 0 && <p className="lst-hint">Every car has a driver. Add a car first, or return one.</p>}
      <div className="lst-form-grid">
        <label className="lst-field wide">
          <span>Car</span>
          <select disabled={busy} value={carId} onChange={(e) => setCarId(e.target.value)}>
            <option value="">Choose a car…</option>
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
        <label className="lst-field">
          <span>{period === "weekly" ? "Due weekday (1 = Monday … 7 = Sunday)" : "Due day of the month (1–28)"}</span>
          <input data-no-translate disabled={busy} inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
        </label>
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
    const name = s(driver.name);
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
      title="Car returned"
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
