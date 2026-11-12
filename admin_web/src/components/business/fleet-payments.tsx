"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Panel } from "@/components/panel";
import { fleetTiles, matchesSearch, monthLabel, monthOf, monthWindow, paymentsGrid } from "@/lib/fleet";
import { moneyText } from "@/lib/invoice-ledger";

import type { FleetState } from "./fleet-data";
import { cellStateLabel, fleetLang, Money } from "./fleet-ui";

const FIRST_MONTHS = 6;

/** Collected this month, owed now, late drivers: the Payments page's tiles and Today's. */
export function FleetTileGroup({ state }: { state: FleetState }) {
  const tiles = useMemo(() => fleetTiles(state.data, state.index, state.todayKey), [state]);
  const lang = fleetLang();
  return (
    <div className="today-tiles fleet-tiles">
      <article className="metric today-tile good">
        <span>Fleet: collected this month</span>
        <strong className="today-figure is-money" data-no-translate>{moneyText(tiles.collectedCents, lang)}</strong>
      </article>
      <article className="metric today-tile attention">
        <span>Fleet: owed now</span>
        <strong className="today-figure is-money" data-no-translate>{moneyText(tiles.owedCents, lang)}</strong>
      </article>
      <article className="metric today-tile attention">
        <span>Fleet: late drivers</span>
        <strong className="today-figure" data-no-translate>{tiles.lateDrivers}</strong>
      </article>
    </div>
  );
}

export function FleetPayments({ state, onOpenDriver }: { state: FleetState; onOpenDriver: (driverId: string) => void }) {
  const lang = fleetLang();
  const [monthCount, setMonthCount] = useState(FIRST_MONTHS);
  const [search, setSearch] = useState("");
  const months = useMemo(() => monthWindow(monthOf(state.todayKey), monthCount), [state.todayKey, monthCount]);
  const grid = useMemo(() => paymentsGrid(state.data, months), [state.data, months]);
  const rows = useMemo(
    () => (search.trim() ? grid.rows.filter((r) => matchesSearch(r.search, search)) : grid.rows),
    [grid.rows, search],
  );
  const template = `minmax(170px, 1.6fr) repeat(${months.length}, minmax(86px, 1fr)) minmax(96px, 1fr)`;

  return (
    <div className="stack fleet-page">
      <FleetTileGroup state={state} />
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
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <span className="fleet-legend">
            <i className="fleet-dot full" /> Paid in full <i className="fleet-dot part" /> Part paid <i className="fleet-dot owed" /> Owed
          </span>
        </div>
        {state.loading && state.data.drivers.length === 0 ? (
          <div className="empty-state">Loading drivers…</div>
        ) : state.error && state.data.drivers.length === 0 ? (
          <div className="empty-state">The drivers could not be loaded. Refresh in a moment.</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">{search.trim() ? "No driver matches that search." : "No drivers yet."}</div>
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
                      <b data-no-translate>{cell.paidCents > 0 ? moneyText(cell.paidCents, lang) : cell.state === "owed" ? moneyText(cell.dueCents, lang) : "—"}</b>
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
