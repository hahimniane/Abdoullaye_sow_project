"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

import { Panel } from "@/components/panel";
import {
  driverRows,
  emptyPaymentsFilter,
  filterGridRows,
  fleetTiles,
  gridFilterCounts,
  monthLabel,
  monthOf,
  monthWindow,
  paymentsGrid,
  type PaymentsFilter,
} from "@/lib/fleet";
import { moneyText } from "@/lib/invoice-ledger";

import { FleetBankDeposits } from "./fleet-bank";
import type { FleetState } from "./fleet-data";
import { cellStateLabel, fleetLang, Money } from "./fleet-ui";

const FIRST_MONTHS = 6;

/** Collected this month, owed now, late drivers: the Payments page's tiles and Today's. */
export function FleetTileGroup({ state }: { state: FleetState }) {
  const tiles = useMemo(() => fleetTiles(state.data, state.index, state.todayKey), [state]);
  const lang = fleetLang();
  const share = tiles.dueThisMonthCents > 0 ? Math.min(100, Math.round((tiles.collectedCents / tiles.dueThisMonthCents) * 100)) : 0;
  return (
    <section className="fleet-kpis" aria-label="Fleet this month">
      <article className="fleet-kpi">
        <span className="fleet-kpi-label">Collected this month</span>
        <strong className="fleet-kpi-value ok" data-no-translate>{moneyText(tiles.collectedCents, lang)}</strong>
        {tiles.dueThisMonthCents > 0 ? (
          <>
            <span className="fleet-kpi-bar" aria-hidden="true"><i style={{ width: `${share}%` }} /></span>
            <small><span data-no-translate>{share}%</span> <span>of</span> <span data-no-translate>{moneyText(tiles.dueThisMonthCents, lang)}</span> <span>billed this month</span></small>
          </>
        ) : (
          <small>Nothing billed yet this month</small>
        )}
      </article>
      <article className="fleet-kpi">
        <span className="fleet-kpi-label">Owed now</span>
        <strong className={`fleet-kpi-value${tiles.owedCents > 0 ? " owed" : ""}`} data-no-translate>{moneyText(tiles.owedCents, lang)}</strong>
        <small><span data-no-translate>{tiles.owingDrivers}</span> <span>{tiles.owingDrivers === 1 ? "driver owes" : "drivers owe"}</span></small>
      </article>
      <article className="fleet-kpi">
        <span className="fleet-kpi-label">Late drivers</span>
        <strong className={`fleet-kpi-value${tiles.lateDrivers > 0 ? " owed" : ""}`} data-no-translate>{tiles.lateDrivers}</strong>
        <small>{tiles.lateCents > 0 ? <><span data-no-translate>{moneyText(tiles.lateCents, lang)}</span> <span>past due</span></> : "Nobody is late"}</small>
      </article>
    </section>
  );
}

export function FleetPayments({ businessId, state, onOpenDriver }: { businessId: string; state: FleetState; onOpenDriver: (driverId: string) => void }) {
  const lang = fleetLang();
  const [monthCount, setMonthCount] = useState(FIRST_MONTHS);
  const [filter, setFilter] = useState<PaymentsFilter>(emptyPaymentsFilter);
  const months = useMemo(() => monthWindow(monthOf(state.todayKey), monthCount), [state.todayKey, monthCount]);
  const grid = useMemo(() => paymentsGrid(state.data, months), [state.data, months]);
  const drivers = useMemo(() => new Map(driverRows(state.data, state.index, state.todayKey).map((d) => [d.id, d])), [state]);
  const rows = useMemo(() => filterGridRows(grid.rows, drivers, filter), [grid.rows, drivers, filter]);
  const counts = useMemo(() => gridFilterCounts(grid.rows, drivers, filter.view), [grid.rows, drivers, filter.view]);
  const narrowed = filter.month !== "any" || filter.late || filter.query.trim() !== "";
  const monthChip = (value: PaymentsFilter["month"], label: string, count: number) =>
    (count > 0 || filter.month === value) && (
      <button
        type="button"
        className={`pk-me-chip${filter.month === value ? " on" : ""}`}
        aria-pressed={filter.month === value}
        onClick={() => setFilter((f) => ({ ...f, month: f.month === value ? "any" : value }))}
      >
        {label} <b data-no-translate>{count}</b>
      </button>
    );
  const template = `minmax(170px, 1.6fr) repeat(${months.length}, minmax(86px, 1fr)) minmax(96px, 1fr)`;

  return (
    <div className="stack fleet-page">
      <FleetTileGroup state={state} />
      <FleetBankDeposits businessId={businessId} state={state} />
      <Panel
        title="Payments by month"
        icon={<Search size={18} />}
        action={
          <button className="ghost-button compact" type="button" onClick={() => setMonthCount((n) => n + FIRST_MONTHS)}>
            Show earlier months
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
              const sort = e.target.value as PaymentsFilter["sort"];
              setFilter((f) => ({ ...f, sort }));
            }}>
              <option value="name">Name A–Z</option>
              <option value="owed">Most owed first</option>
              <option value="total">Most paid first</option>
            </select>
          </label>
          <span className="fleet-legend">
            <i className="fleet-dot full" /> Paid in full <i className="fleet-dot part" /> Part paid <i className="fleet-dot owed" /> Owed
          </span>
        </div>
        <div className="pk-me-chips fleet-driver-chips">
          <div className="pk-view" role="group" aria-label="Which drivers">
            <button type="button" className={filter.view === "active" ? "on" : ""} aria-pressed={filter.view === "active"} onClick={() => setFilter((f) => ({ ...f, view: "active" }))}>Active (<span data-no-translate>{counts.active}</span>)</button>
            <button type="button" className={filter.view === "left" ? "on" : ""} aria-pressed={filter.view === "left"} onClick={() => setFilter((f) => ({ ...f, view: "left" }))}>Left (<span data-no-translate>{counts.left}</span>)</button>
            <button type="button" className={filter.view === "all" ? "on" : ""} aria-pressed={filter.view === "all"} onClick={() => setFilter((f) => ({ ...f, view: "all" }))}>Everyone (<span data-no-translate>{counts.all}</span>)</button>
          </div>
          <span className="fleet-chip-label">This month:</span>
          {monthChip("owed", "Owes", counts.owed)}
          {monthChip("part", "Part paid", counts.part)}
          {monthChip("paid", "Paid in full", counts.paid)}
          {(counts.late > 0 || filter.late) && (
            <button type="button" className={`pk-me-chip${filter.late ? " on" : ""}`} aria-pressed={filter.late} onClick={() => setFilter((f) => ({ ...f, late: !f.late }))}>
              Late <b data-no-translate>{counts.late}</b>
            </button>
          )}
          {narrowed && (
            <button className="ghost-button" type="button" onClick={() => setFilter((f) => ({ ...emptyPaymentsFilter, view: f.view, sort: f.sort }))}>
              <X size={14} /> Clear filters
            </button>
          )}
        </div>
        {state.loading && state.data.drivers.length === 0 ? (
          <div className="empty-state">Loading drivers…</div>
        ) : state.error && state.data.drivers.length === 0 ? (
          <div className="empty-state">The drivers could not be loaded. Refresh in a moment.</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">{narrowed ? "No driver matches. Change the search or the filters." : grid.rows.length === 0 ? "No drivers yet." : "No driver in this list."}</div>
        ) : (
          <div className="fleet-grid-scroll">
            <div className="fleet-grid" role="table" style={{ minWidth: 190 + 96 * (months.length + 1) }}>
              <div className="fleet-grid-row fleet-grid-head" style={{ gridTemplateColumns: template }} role="row">
                <span role="columnheader">Driver</span>
                {months.map((month) => (
                  <span className="num" key={month} role="columnheader" data-no-translate>{monthLabel(month, lang)}</span>
                ))}
                <span className="num" role="columnheader">Total</span>
              </div>
              {rows.map((row) => (
                <button
                  className="fleet-grid-row"
                  key={row.driverId}
                  onClick={() => onOpenDriver(row.driverId)}
                  style={{ gridTemplateColumns: template }}
                  type="button"
                >
                  <span className="fleet-name" data-no-translate>{row.name}</span>
                  {row.cells.map((cell) => (
                    <span
                      className={`num fleet-cell ${cell.state}`}
                      key={cell.month}
                      title={cellStateLabel(cell.state)}
                    >
                      {cell.paidCents > 0
                        ? <b data-no-translate>{moneyText(cell.paidCents, lang)}</b>
                        : cell.state === "owed"
                          ? <b><span>Owes</span> <span data-no-translate>{moneyText(cell.dueCents, lang)}</span></b>
                          : <b>—</b>}
                    </span>
                  ))}
                  <span className="num"><Money cents={row.totalCents} /></span>
                </button>
              ))}
              <div className="fleet-grid-row fleet-grid-foot" style={{ gridTemplateColumns: template }}>
                <span>Total</span>
                {grid.totals.map((cents, i) => (
                  <span className="num" key={months[i]}><Money cents={cents} /></span>
                ))}
                <span className="num"><Money cents={grid.grandTotalCents} /></span>
              </div>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
