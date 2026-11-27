"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CarFront, FileWarning, Plus, Search, X } from "lucide-react";

import { Panel } from "@/components/panel";
import { formatDayKey } from "@/lib/format";
import {
  carRows,
  carTimeline,
  centsToInput,
  dollarsToCents,
  matchesSearch,
  carsInPaperworkScope,
  paperworkCounts,
  type PaperworkScope,
  paperworkRows,
  plateCarHistory,
  type CarRow,
  type Expiry,
  carCompanies,
  carFilterCounts,
  emptyCarFilter,
  filterCarRows,
  type CarFilter,
} from "@/lib/fleet";
import { knownValues } from "@/lib/fleet-pickers";
import { moneyText } from "@/lib/invoice-ledger";

import type { FleetState } from "./fleet-data";
import { DueDaySelect, PickOrAdd, PlateCarFields } from "./fleet-pickers";
import { ExpiryChip, fleetLang, FleetModal, SaveButton, useFleetRun } from "./fleet-ui";

type Row = Record<string, unknown> & { id: string };

// Who usually pays a plate's insurance; any other payer is added once.
const INSURANCE_PAYERS = ["The company", "The driver"];
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
  addRequested = false,
  onAddDone,
  onGiveToDriver,
}: {
  state: FleetState;
  businessId: string;
  carId: string;
  onOpenCar: (id: string) => void;
  onOpenDriver: (id: string) => void;
  /** The Fleet page's New menu asked for "Add plate"; done once, then cleared. */
  addRequested?: boolean;
  onAddDone?: () => void;
  /** A free plate's "Give to a driver": the Fleet page asks which driver, then opens their Give a plate. */
  onGiveToDriver?: (carId: string) => void;
}) {
  const [filter, setFilter] = useState<CarFilter>(emptyCarFilter);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (!addRequested) return;
    setAdding(true);
    onAddDone?.();
  }, [addRequested, onAddDone]);
  const rows = useMemo(() => carRows(state.data, state.index, state.todayKey), [state]);
  const shown = useMemo(() => filterCarRows(rows, filter), [rows, filter]);
  const counts = useMemo(() => carFilterCounts(rows), [rows]);
  const companies = useMemo(() => carCompanies(rows), [rows]);
  const narrowed = filter.view !== "all" || filter.paper !== "any" || filter.company !== "" || filter.query.trim() !== "";
  const paperChip = (value: CarFilter["paper"], label: string, count: number) =>
    (count > 0 || filter.paper === value) && (
      <button
        type="button"
        className={`pk-me-chip${filter.paper === value ? " on" : ""}`}
        aria-pressed={filter.paper === value}
        onClick={() => setFilter((f) => ({ ...f, paper: f.paper === value ? "any" : value }))}
      >
        {label} <b data-no-translate>{count}</b>
      </button>
    );
  const selected = carId ? state.index.carById.get(carId) : undefined;

  if (selected) {
    return (
      <CarPage
        businessId={businessId}
        car={selected}
        onBack={() => onOpenCar("")}
        onOpenDriver={onOpenDriver}
        onGiveToDriver={onGiveToDriver}
        row={rows.find((r) => r.id === selected.id)}
        state={state}
      />
    );
  }

  return (
    <div className="stack fleet-page">
      <Panel
        title="Plates"
        icon={<CarFront size={18} />}
        action={
          <button className="lst-btn" type="button" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add plate
          </button>
        }
      >
        <div className="fleet-toolbar">
          <label className="fleet-search">
            <Search aria-hidden="true" size={15} />
            <input
              aria-label="Search plates"
              placeholder="Search plate, company or driver"
              value={filter.query}
              onChange={(event) => {
                const query = event.target.value;
                setFilter((f) => ({ ...f, query }));
              }}
            />
          </label>
          {companies.length > 1 && (
            <label className="pk-me-select">
              <span>Company</span>
              <select value={filter.company} onChange={(e) => {
                const company = e.target.value;
                setFilter((f) => ({ ...f, company }));
              }}>
                <option value="">All companies</option>
                {companies.map((c) => <option key={c} value={c} data-no-translate>{c}</option>)}
              </select>
            </label>
          )}
          <label className="pk-me-select">
            <span>Sort by</span>
            <select value={filter.sort} onChange={(e) => {
              const sort = e.target.value as CarFilter["sort"];
              setFilter((f) => ({ ...f, sort }));
            }}>
              <option value="plate">Plate</option>
              <option value="expiry">Paperwork due first</option>
            </select>
          </label>
        </div>
        <div className="pk-me-chips fleet-driver-chips">
          <div className="pk-view" role="group" aria-label="Which plates">
            <button type="button" className={filter.view === "all" ? "on" : ""} aria-pressed={filter.view === "all"} onClick={() => setFilter((f) => ({ ...f, view: "all" }))}>All (<span data-no-translate>{counts.all}</span>)</button>
            <button type="button" className={filter.view === "driver" ? "on" : ""} aria-pressed={filter.view === "driver"} onClick={() => setFilter((f) => ({ ...f, view: "driver" }))}>With a driver (<span data-no-translate>{counts.driver}</span>)</button>
            <button type="button" className={filter.view === "free" ? "on" : ""} aria-pressed={filter.view === "free"} onClick={() => setFilter((f) => ({ ...f, view: "free" }))}>Free (<span data-no-translate>{counts.free}</span>)</button>
          </div>
          <span className="fleet-chip-label">Paperwork:</span>
          {paperChip("expired", "Expired", counts.expired)}
          {paperChip("soon", "Due in 60 days", counts.soon)}
          {paperChip("missing", "Missing", counts.missing)}
          {narrowed && (
            <button className="ghost-button" type="button" onClick={() => setFilter((f) => ({ ...emptyCarFilter, sort: f.sort }))}>
              <X size={14} /> Clear filters
            </button>
          )}
        </div>
        {state.loading && rows.length === 0 ? (
          <div className="empty-state">Loading plates…</div>
        ) : shown.length === 0 ? (
          <div className="empty-state">{narrowed ? "No plate matches. Change the search or the filters." : "No plates yet."}</div>
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
          cars={state.data.cars}
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
  cars,
  onClose,
  onSaved,
}: {
  businessId: string;
  car: Row | null;
  cars: readonly Row[];
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
    // A new plate: the car on it is usually the driver's own.
    ownership: car ? (s(car.ownership) === "driver" ? "driver" : "company") : "driver",
  });
  // Editing the car's details: a different car on the same plate, or a typo being fixed?
  const [carChange, setCarChange] = useState<"" | "moved" | "typo">("");
  const [movedSince, setMovedSince] = useState("");
  const hadCar = Boolean(car && (s(car.vin) || s(car.vehicleType)));
  const carEdited = hadCar && (d.vin.trim().toUpperCase() !== s(car?.vin).toUpperCase() || d.vehicleType.trim() !== s(car?.vehicleType));
  const { busy, error, setError, run } = useFleetRun(businessId);
  const set = (key: keyof typeof d) => (event: { target: { value: string } }) => setD((x) => ({ ...x, [key]: event.target.value }));
  const put = (key: keyof typeof d) => (value: string) => setD((x) => ({ ...x, [key]: value }));
  const setVehicleType = useCallback((vehicleType: string) => setD((x) => ({ ...x, vehicleType })), []);
  // What this business already uses, so the same company is never typed twice.
  const companies = useMemo(() => knownValues(cars, "company"), [cars]);
  const insurers = useMemo(() => knownValues(cars, "insurer"), [cars]);
  const payers = useMemo(() => knownValues(cars, "insurancePaidBy"), [cars]);

  async function save() {
    const premium = d.premium.trim() ? dollarsToCents(d.premium) : 0;
    if (!d.plate.trim() || premium === null) {
      setError("Some details are missing or not valid.");
      return;
    }
    if (carEdited && !carChange) {
      setError("Say whether the plate moved to another car or you are fixing a mistake.");
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
        ...(carEdited && carChange === "moved" ? { vehicleChange: { moved: true, sinceDayKey: movedSince } } : {}),
      },
    });
    if (result) onSaved(result.carId || car?.id || "");
  }

  return (
    <FleetModal
      title={car ? "Edit plate" : "Add plate"}
      onClose={onClose}
      busy={busy}
      width={640}
      footer={
        <>
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <SaveButton busy={busy} label="Save plate" busyLabel="Saving..." onClick={() => void save()} />
        </>
      }
    >
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      <div className="lst-form-grid">
        <label className="lst-field">
          <span>Plate</span>
          <input autoFocus data-no-translate disabled={busy} maxLength={12} value={d.plate} onChange={set("plate")} />
        </label>
        <PickOrAdd label="Company" value={d.company} known={companies} onChange={put("company")} disabled={busy} addLabel="Add a new company…" />
        <label className="lst-field">
          <span>VIN</span>
          <input data-no-translate disabled={busy} maxLength={17} value={d.vin} onChange={set("vin")} />
        </label>
        <PlateCarFields vehicleType={d.vehicleType} vin={d.vin} onVehicleType={setVehicleType} disabled={busy} />
        <label className="lst-field">
          <span>Registration expires</span>
          <input disabled={busy} type="date" value={d.registrationExpiry} onChange={set("registrationExpiry")} />
        </label>
        <label className="lst-field">
          <span>Diamond expires</span>
          <input disabled={busy} type="date" value={d.diamondExpiry} onChange={set("diamondExpiry")} />
        </label>
        <PickOrAdd label="Insurer" value={d.insurer} known={insurers} onChange={put("insurer")} disabled={busy} addLabel="Add a new insurer…" />
        <label className="lst-field">
          <span>Policy number</span>
          <input data-no-translate disabled={busy} maxLength={40} value={d.policyNumber} onChange={set("policyNumber")} />
        </label>
        <label className="lst-field">
          <span>Monthly premium ($)</span>
          <input data-no-translate disabled={busy} inputMode="decimal" value={d.premium} onChange={set("premium")} />
        </label>
        <DueDaySelect label="Insurance due day" value={d.insuranceDueDay} onChange={put("insuranceDueDay")} disabled={busy} emptyLabel="Not set" />
        <PickOrAdd label="Insurance paid by" value={d.insurancePaidBy} known={payers} fixed={INSURANCE_PAYERS} onChange={put("insurancePaidBy")} disabled={busy} addLabel="Add someone new…" />
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
      {carEdited && (
        <fieldset className="fleet-car-change">
          <legend>You changed the car on this plate</legend>
          <label className="lst-radio">
            <input type="radio" name="fleetcarchange" disabled={busy} checked={carChange === "moved"} onChange={() => setCarChange("moved")} />
            <span>The plate moved to another car</span>
          </label>
          {carChange === "moved" && (
            <label className="lst-field">
              <span>Since (leave empty for today)</span>
              <input disabled={busy} type="date" value={movedSince} onChange={(e) => setMovedSince(e.target.value)} />
            </label>
          )}
          <label className="lst-radio">
            <input type="radio" name="fleetcarchange" disabled={busy} checked={carChange === "typo"} onChange={() => setCarChange("typo")} />
            <span>Same car: I am fixing a mistake</span>
          </label>
          <p className="lst-hint">When the plate moves, the car it was on stays in the plate&apos;s history.</p>
        </fieldset>
      )}
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
  onGiveToDriver,
}: {
  businessId: string;
  car: Row;
  row: CarRow | undefined;
  state: FleetState;
  onBack: () => void;
  onOpenDriver: (id: string) => void;
  onGiveToDriver?: (carId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const lang = fleetLang();
  const timeline = useMemo(() => carTimeline(car.id, state.index), [state, car.id]);
  const plateCars = useMemo(() => plateCarHistory(car), [car]);
  const facts: [string, string][] = [
    ["Company", s(car.company)],
    ["Car on this plate", s(car.vehicleType)],
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
        <ArrowLeft size={14} /> All plates
      </button>
      <Panel
        title="Plate"
        icon={<CarFront size={18} />}
        action={<button className="ghost-button compact" type="button" onClick={() => setEditing(true)}>Edit details</button>}
      >
        <h3 data-no-translate>{s(car.plate)}</h3>
        {onGiveToDriver && !state.index.currentByCar.has(car.id) && (
          <div className="fleet-actions">
            <button className="lst-btn" type="button" onClick={() => onGiveToDriver(car.id)}>Give to a driver</button>
          </div>
        )}
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
      <Panel title="Cars this plate has been on" icon={<CarFront size={18} />}>
        {plateCars.length === 0 ? (
          <div className="empty-state">No car is recorded on this plate yet.</div>
        ) : (
          <div className="fleet-grid-scroll">
            <table className="fleet-table">
              <thead>
                <tr>
                  <th>Car</th>
                  <th>VIN</th>
                  <th>Whose car</th>
                  <th>From</th>
                  <th>To</th>
                </tr>
              </thead>
              <tbody>
                {plateCars.map((c, i) => (
                  <tr key={`${c.vin}-${c.fromDayKey}-${i}`}>
                    <td data-no-translate>{c.vehicleType || "—"}</td>
                    <td data-no-translate>{c.vin || "—"}</td>
                    <td>{c.ownership === "driver" ? "The driver" : "The company"}</td>
                    <td>{c.fromDayKey ? <span data-no-translate>{formatDayKey(c.fromDayKey, lang)}</span> : <span className="muted">—</span>}</td>
                    <td>{c.toDayKey ? <span data-no-translate>{formatDayKey(c.toDayKey, lang)}</span> : <span className="fleet-chip ok">Now</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Who had this plate" icon={<CarFront size={18} />}>
        {timeline.length === 0 ? (
          <div className="empty-state">No driver has had this plate yet.</div>
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
                      {t.friends.map((f) => (
                        <small className="fleet-note" key={f.id}>
                          <span>Friend drove</span>{" "}
                          <span data-no-translate>
                            {f.name} · {formatDayKey(f.fromDayKey, lang)} → {formatDayKey(f.toDayKey, lang)}
                          </span>
                        </small>
                      ))}
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
      {editing && <CarFormDialog businessId={businessId} car={car} cars={state.data.cars} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paperwork.
// ---------------------------------------------------------------------------

type Filter = Expiry | "all";

export function FleetPaperwork({ state, onOpenCar }: { state: FleetState; onOpenCar: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState("");
  const [scope, setScope] = useState<PaperworkScope>("driver");
  const allCars = useMemo(() => carRows(state.data, state.index, state.todayKey), [state]);
  const cars = useMemo(() => carsInPaperworkScope(allCars, scope), [allCars, scope]);
  const scopeCounts = useMemo(() => ({ driver: carsInPaperworkScope(allCars, "driver").length, all: allCars.length }), [allCars]);
  const rows = useMemo(() => paperworkRows(cars), [cars]);
  const counts = useMemo(() => paperworkCounts(rows), [rows]);
  const companies = useMemo(() => carCompanies(cars), [cars]);
  const shown = useMemo(
    () => filterCarRows(cars, { ...emptyCarFilter, query, company, sort: "expiry" }).filter((r) => filter === "all" || r.worst === filter),
    [cars, query, company, filter],
  );
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
          <label className="fleet-search">
            <Search aria-hidden="true" size={15} />
            <input aria-label="Search plates" placeholder="Search plate, company or driver" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {companies.length > 1 && (
            <label className="pk-me-select">
              <span>Company</span>
              <select value={company} onChange={(e) => setCompany(e.target.value)}>
                <option value="">All companies</option>
                {companies.map((c) => <option key={c} value={c} data-no-translate>{c}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="fleet-toolbar">
          <div className="pk-view" role="group" aria-label="Which plates">
            <button className={scope === "driver" ? "on" : ""} aria-pressed={scope === "driver"} onClick={() => setScope("driver")} type="button">
              Plates with a driver (<span data-no-translate>{scopeCounts.driver}</span>)
            </button>
            <button className={scope === "all" ? "on" : ""} aria-pressed={scope === "all"} onClick={() => setScope("all")} type="button">
              Every plate (<span data-no-translate>{scopeCounts.all}</span>)
            </button>
          </div>
          <div className="pk-view" role="group" aria-label="Filter by state">
            {chips.map(([id, label, count]) => (
              <button className={filter === id ? "on" : ""} key={id} onClick={() => setFilter(id)} type="button">
                {label} <span data-no-translate>{count}</span>
              </button>
            ))}
          </div>
        </div>
        {state.loading && rows.length === 0 ? (
          <div className="empty-state">Loading plates…</div>
        ) : shown.length === 0 ? (
          <div className="empty-state">No plates in this list.</div>
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
