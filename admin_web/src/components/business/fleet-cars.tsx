"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CarFront, FileWarning, Plus, Search } from "lucide-react";

import { Panel } from "@/components/panel";
import { formatDayKey } from "@/lib/format";
import {
  carRows,
  carTimeline,
  centsToInput,
  dollarsToCents,
  matchesSearch,
  paperworkCounts,
  paperworkRows,
  type CarRow,
  type Expiry,
} from "@/lib/fleet";
import { moneyText } from "@/lib/invoice-ledger";

import type { FleetState } from "./fleet-data";
import { ExpiryChip, fleetLang, FleetModal, SaveButton, useFleetRun } from "./fleet-ui";

type Row = Record<string, unknown> & { id: string };
const s = (v: unknown) => String(v ?? "").trim();

/** A date that reads red when it is past. */
function ExpiryDate({ dayKey, state }: { dayKey: string; state: Expiry }) {
  if (!dayKey) return <span className="muted">—</span>;
  return (
    <span className={state === "expired" ? "fleet-late" : undefined} data-no-translate>
      {formatDayKey(dayKey, fleetLang())}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Cars.
// ---------------------------------------------------------------------------

export function FleetCars({
  state,
  businessId,
  carId,
  onOpenCar,
  onOpenDriver,
}: {
  state: FleetState;
  businessId: string;
  carId: string;
  onOpenCar: (id: string) => void;
  onOpenDriver: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => carRows(state.data, state.index, state.todayKey), [state]);
  const shown = useMemo(() => (search.trim() ? rows.filter((r) => matchesSearch(r.search, search)) : rows), [rows, search]);
  const selected = carId ? state.index.carById.get(carId) : undefined;

  if (selected) {
    return (
      <CarPage
        businessId={businessId}
        car={selected}
        onBack={() => onOpenCar("")}
        onOpenDriver={onOpenDriver}
        row={rows.find((r) => r.id === selected.id)}
        state={state}
      />
    );
  }

  return (
    <div className="stack fleet-page">
      <Panel
        title="Cars"
        icon={<CarFront size={18} />}
        action={
          <button className="lst-btn" type="button" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add car
          </button>
        }
      >
        <div className="fleet-toolbar">
          <label className="fleet-search">
            <Search aria-hidden="true" size={15} />
            <input
              aria-label="Search cars"
              placeholder="Search plate, company or driver"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        {state.loading && rows.length === 0 ? (
          <div className="empty-state">Loading cars…</div>
        ) : shown.length === 0 ? (
          <div className="empty-state">{search.trim() ? "No car matches that search." : "No cars yet."}</div>
        ) : (
          <div className="fleet-grid-scroll">
            <div className="fleet-grid" role="table">
              <div className="fleet-grid-row fleet-grid-head fleet-cars-cols" role="row">
                <span>Plate</span>
                <span>Company</span>
                <span>Driver now</span>
                <span>Status</span>
                <span>Registration</span>
                <span>Diamond</span>
              </div>
              {shown.map((r) => (
                <button className="fleet-grid-row fleet-cars-cols" key={r.id} onClick={() => onOpenCar(r.id)} type="button">
                  <span className="fleet-name" data-no-translate>{r.plate}</span>
                  <span data-no-translate>{r.company || "—"}</span>
                  <span data-no-translate>{r.driverName || "—"}</span>
                  <span><span className={`fleet-chip ${r.status === "active" ? "ok" : "muted"}`}>{r.status === "active" ? "With a driver" : "Free"}</span></span>
                  <span><ExpiryDate dayKey={r.registrationExpiry} state={r.registration} /></span>
                  <span><ExpiryDate dayKey={r.diamondExpiry} state={r.diamond} /></span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Panel>
      {adding && (
        <CarFormDialog
          businessId={businessId}
          car={null}
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            if (id) onOpenCar(id);
          }}
        />
      )}
    </div>
  );
}

function CarFormDialog({
  businessId,
  car,
  onClose,
  onSaved,
}: {
  businessId: string;
  car: Row | null;
  onClose: () => void;
  onSaved: (carId: string) => void;
}) {
  const [d, setD] = useState({
    plate: s(car?.plate),
    company: s(car?.company),
    vehicleType: s(car?.vehicleType),
    vin: s(car?.vin),
    registrationExpiry: s(car?.registrationExpiry),
    diamondExpiry: s(car?.diamondExpiry),
    insurer: s(car?.insurer),
    policyNumber: s(car?.policyNumber),
    premium: centsToInput(car?.premiumCents),
    insuranceDueDay: car?.insuranceDueDay ? String(car.insuranceDueDay) : "",
    insuranceAutopay: car?.insuranceAutopay === true,
    insurancePaidBy: s(car?.insurancePaidBy),
    ownership: s(car?.ownership) === "driver" ? "driver" : "company",
  });
  const { busy, error, setError, run } = useFleetRun(businessId);
  const set = (key: keyof typeof d) => (event: { target: { value: string } }) => setD((x) => ({ ...x, [key]: event.target.value }));

  async function save() {
    const premium = d.premium.trim() ? dollarsToCents(d.premium) : 0;
    if (!d.plate.trim() || premium === null) {
      setError("Some details are missing or not valid.");
      return;
    }
    const result = await run<{ carId?: string }>("car_save", {
      carId: car?.id || undefined,
      car: {
        plate: d.plate,
        company: d.company,
        vehicleType: d.vehicleType,
        vin: d.vin,
        registrationExpiry: d.registrationExpiry,
        diamondExpiry: d.diamondExpiry,
        insurer: d.insurer,
        policyNumber: d.policyNumber,
        premiumCents: premium,
        insuranceDueDay: d.insuranceDueDay ? Number(d.insuranceDueDay) : null,
        insuranceAutopay: d.insuranceAutopay,
        insurancePaidBy: d.insurancePaidBy,
        ownership: d.ownership,
      },
    });
    if (result) onSaved(result.carId || car?.id || "");
  }

  return (
    <FleetModal
      title={car ? "Edit car" : "Add car"}
      onClose={onClose}
      busy={busy}
      width={640}
      footer={
        <>
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <SaveButton busy={busy} label="Save car" busyLabel="Saving..." onClick={() => void save()} />
        </>
      }
    >
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      <div className="lst-form-grid">
        <label className="lst-field">
          <span>Plate</span>
          <input autoFocus data-no-translate disabled={busy} maxLength={12} value={d.plate} onChange={set("plate")} />
        </label>
        <label className="lst-field">
          <span>Company</span>
          <input data-no-translate disabled={busy} maxLength={80} value={d.company} onChange={set("company")} />
        </label>
        <label className="lst-field">
          <span>Vehicle type</span>
          <input data-no-translate disabled={busy} maxLength={80} value={d.vehicleType} onChange={set("vehicleType")} />
        </label>
        <label className="lst-field">
          <span>VIN</span>
          <input data-no-translate disabled={busy} maxLength={17} value={d.vin} onChange={set("vin")} />
        </label>
        <label className="lst-field">
          <span>Registration expires</span>
          <input disabled={busy} type="date" value={d.registrationExpiry} onChange={set("registrationExpiry")} />
        </label>
        <label className="lst-field">
          <span>Diamond expires</span>
          <input disabled={busy} type="date" value={d.diamondExpiry} onChange={set("diamondExpiry")} />
        </label>
        <label className="lst-field">
          <span>Insurer</span>
          <input data-no-translate disabled={busy} maxLength={80} value={d.insurer} onChange={set("insurer")} />
        </label>
        <label className="lst-field">
          <span>Policy number</span>
          <input data-no-translate disabled={busy} maxLength={40} value={d.policyNumber} onChange={set("policyNumber")} />
        </label>
        <label className="lst-field">
          <span>Monthly premium ($)</span>
          <input data-no-translate disabled={busy} inputMode="decimal" value={d.premium} onChange={set("premium")} />
        </label>
        <label className="lst-field">
          <span>Insurance due day</span>
          <input data-no-translate disabled={busy} inputMode="numeric" value={d.insuranceDueDay} onChange={set("insuranceDueDay")} />
        </label>
        <label className="lst-field">
          <span>Insurance paid by</span>
          <input data-no-translate disabled={busy} maxLength={80} value={d.insurancePaidBy} onChange={set("insurancePaidBy")} />
        </label>
        <label className="lst-field">
          <span>Who owns the car</span>
          <select disabled={busy} value={d.ownership} onChange={set("ownership")}>
            <option value="company">The company</option>
            <option value="driver">The driver</option>
          </select>
        </label>
        <label className="lst-check">
          <input type="checkbox" disabled={busy} checked={d.insuranceAutopay} onChange={(e) => setD((x) => ({ ...x, insuranceAutopay: e.target.checked }))} />
          <span>Insurance is on autopay</span>
        </label>
      </div>
    </FleetModal>
  );
}

function CarPage({
  businessId,
  car,
  row,
  state,
  onBack,
  onOpenDriver,
}: {
  businessId: string;
  car: Row;
  row: CarRow | undefined;
  state: FleetState;
  onBack: () => void;
  onOpenDriver: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const lang = fleetLang();
  const timeline = useMemo(() => carTimeline(car.id, state.index), [state, car.id]);
  const facts: [string, string][] = [
    ["Company", s(car.company)],
    ["Vehicle type", s(car.vehicleType)],
    ["VIN", s(car.vin)],
    ["Insurer", s(car.insurer)],
    ["Policy number", s(car.policyNumber)],
    ["Monthly premium", Number(car.premiumCents) > 0 ? moneyText(Number(car.premiumCents), lang) : ""],
    ["Insurance due day", car.insuranceDueDay ? String(car.insuranceDueDay) : ""],
    ["Insurance paid by", s(car.insurancePaidBy)],
  ];
  return (
    <div className="stack fleet-page">
      <button className="ghost-button compact fleet-back" type="button" onClick={onBack}>
        <ArrowLeft size={14} /> All cars
      </button>
      <Panel
        title="Car"
        icon={<CarFront size={18} />}
        action={<button className="ghost-button compact" type="button" onClick={() => setEditing(true)}>Edit details</button>}
      >
        <h3 data-no-translate>{s(car.plate)}</h3>
        <div className="fleet-facts fleet-facts-wide">
          <div>
            <small>Registration expires</small>
            <b><ExpiryDate dayKey={s(car.registrationExpiry)} state={row?.registration ?? "missing"} /></b>
          </div>
          <div>
            <small>Diamond expires</small>
            <b><ExpiryDate dayKey={s(car.diamondExpiry)} state={row?.diamond ?? "missing"} /></b>
          </div>
          <div>
            <small>Insurance on autopay</small>
            <b>{car.insuranceAutopay === true ? "Yes" : "No"}</b>
          </div>
          <div>
            <small>Who owns the car</small>
            <b>{s(car.ownership) === "driver" ? "The driver" : "The company"}</b>
          </div>
          {facts.map(([label, value]) => (
            <div key={label}>
              <small>{label}</small>
              <b data-no-translate>{value || "—"}</b>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Who had this car" icon={<CarFront size={18} />}>
        {timeline.length === 0 ? (
          <div className="empty-state">No driver has had this car yet.</div>
        ) : (
          <div className="fleet-grid-scroll">
            <table className="fleet-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>From</th>
                  <th>To</th>
                  <th className="num">Rent</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <button className="fleet-link" type="button" onClick={() => onOpenDriver(t.driverId)}>
                        <b data-no-translate>{t.driverName || "—"}</b>
                      </button>
                    </td>
                    <td data-no-translate>{formatDayKey(t.startDayKey, lang)}</td>
                    <td>{t.endDayKey ? <span data-no-translate>{formatDayKey(t.endDayKey, lang)}</span> : <span className="fleet-chip ok">Now</span>}</td>
                    <td className="num" data-no-translate>
                      {moneyText(t.rentCents, lang)} / {t.period === "weekly" ? "wk" : "mo"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {editing && <CarFormDialog businessId={businessId} car={car} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paperwork.
// ---------------------------------------------------------------------------

type Filter = Expiry | "all";

export function FleetPaperwork({ state, onOpenCar }: { state: FleetState; onOpenCar: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = useMemo(() => paperworkRows(carRows(state.data, state.index, state.todayKey)), [state]);
  const counts = useMemo(() => paperworkCounts(rows), [rows]);
  const shown = useMemo(() => (filter === "all" ? rows : rows.filter((r) => r.worst === filter)), [rows, filter]);
  const chips: [Filter, string, number][] = [
    ["all", "All", rows.length],
    ["expired", "Expired", counts.expired],
    ["soon", "Due in 60 days", counts.soon],
    ["missing", "Missing", counts.missing],
    ["ok", "OK", counts.ok],
  ];
  return (
    <div className="stack fleet-page">
      <Panel title="Paperwork" icon={<FileWarning size={18} />}>
        <div className="fleet-toolbar">
          <div className="pk-view" role="group" aria-label="Filter by state">
            {chips.map(([id, label, count]) => (
              <button className={filter === id ? "on" : ""} key={id} onClick={() => setFilter(id)} type="button">
                {label} <span data-no-translate>{count}</span>
              </button>
            ))}
          </div>
        </div>
        {state.loading && rows.length === 0 ? (
          <div className="empty-state">Loading cars…</div>
        ) : shown.length === 0 ? (
          <div className="empty-state">No cars in this list.</div>
        ) : (
          <div className="fleet-grid-scroll">
            <div className="fleet-grid" role="table">
              <div className="fleet-grid-row fleet-grid-head fleet-paper-cols" role="row">
                <span>Plate</span>
                <span>Driver now</span>
                <span>Registration</span>
                <span />
                <span>Diamond</span>
                <span />
              </div>
              {shown.map((r) => (
                <button className="fleet-grid-row fleet-paper-cols" key={r.id} onClick={() => onOpenCar(r.id)} type="button">
                  <span className="fleet-name" data-no-translate>{r.plate}</span>
                  <span data-no-translate>{r.driverName || "—"}</span>
                  <span><ExpiryDate dayKey={r.registrationExpiry} state={r.registration} /></span>
                  <span><ExpiryChip state={r.registration} /></span>
                  <span><ExpiryDate dayKey={r.diamondExpiry} state={r.diamond} /></span>
                  <span><ExpiryChip state={r.diamond} /></span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
