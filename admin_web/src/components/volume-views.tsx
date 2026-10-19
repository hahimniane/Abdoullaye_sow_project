"use client";

// The Volume pages (docs/PACKAGE_REQUESTS.md §5): the platform admin's view of
// every business's month, and a business console's view of its own. Counted
// on the server (volume_counts.js); read here through getPlatformVolume and
// getBusinessVolume. Pure logic - months, labels, CSV - is lib/volume.ts.

import { useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { BarChart3, ChevronLeft, ChevronRight, Container, Download, RefreshCw } from "lucide-react";

import { TotalsStatus } from "@/components/totals-status";
import { UserText } from "@/components/user-text";
import { functions } from "@/lib/firebase";
import { currentLanguage, formatDate } from "@/lib/format";
import { useServerTotals } from "@/lib/use-server-totals";
import {
  canStepForward,
  currentVolumeMonth,
  downloadVolumeCsv,
  emptyVolumeTotals,
  formatVolumeAverage,
  formatVolumeChange,
  formatVolumeCount,
  formatVolumeMonth,
  formatVolumeMonthShort,
  isEmptyVolume,
  shiftVolumeMonth,
  stepVolumeMonth,
  volumeBusinessOptions,
  volumeChangeTone,
  volumeMonthOptions,
  volumeTiles,
  volumeTrendBars,
  type BusinessVolumeResponse,
  type PlatformVolumeResponse,
  type VolumeBusinessOption,
  type VolumeContainer,
  type VolumeLanguage,
  type VolumeTile,
  type VolumeTotals,
} from "@/lib/volume";
import { previewBusinessVolume, previewPlatformVolume } from "@/lib/volume-preview";

const REBUILD_MAX_CALLS = 20;

function useLanguage(): VolumeLanguage {
  return currentLanguage() === "fr" ? "fr" : "en";
}

/** A month as text, formatted for the page's language and never re-translated. */
function MonthText({ month }: { month: string }) {
  const language = useLanguage();
  return <span data-no-translate>{formatVolumeMonth(month, language)}</span>;
}

function MonthPicker({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const language = useLanguage();
  const current = currentVolumeMonth();
  const months = volumeMonthOptions(month, current);
  return (
    <div className="vol-month-picker" role="group">
      <button
        aria-label="Previous month"
        className="icon-button subtle"
        onClick={() => onChange(stepVolumeMonth(month, -1, current))}
        title="Previous month"
        type="button"
      >
        <ChevronLeft size={18} />
      </button>
      <select
        aria-label="Choose a month"
        className="vol-month-select"
        onChange={(event) => onChange(event.target.value)}
        title="Choose a month"
        value={month}
      >
        {months.map((value) => (
          <option data-no-translate key={value} value={value}>
            {formatVolumeMonth(value, language)}
          </option>
        ))}
      </select>
      <button
        aria-label="Next month"
        className="icon-button subtle"
        disabled={!canStepForward(month, current)}
        onClick={() => onChange(stepVolumeMonth(month, 1, current))}
        title="Next month"
        type="button"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

/** "All businesses" or one business; the names are typed by businesses, so never translated. */
function BusinessPicker({
  options,
  value,
  onChange,
}: {
  options: VolumeBusinessOption[];
  value: string;
  onChange: (businessId: string) => void;
}) {
  return (
    <label className="vol-business-picker">
      <span>Business</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">All businesses</option>
        {options.map((option) => (
          <option data-no-translate key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Count({ value }: { value: unknown }) {
  const language = useLanguage();
  return <span data-no-translate>{formatVolumeCount(value, language)}</span>;
}

function VolumeTileCard({ tile, totals }: { tile: VolumeTile; totals: VolumeTotals | null }) {
  const language = useLanguage();
  const figure = !totals
    ? "—"
    : tile.kind === "average"
      ? formatVolumeAverage(tile.value, language)
      : formatVolumeCount(tile.value, language);
  const change = tile.key === "pieces" && totals ? formatVolumeChange(totals.piecesChangePct, language) : "";
  return (
    <article className={`metric ${tile.key === "pieces" ? "" : "neutral"} vol-tile-${tile.key}`}>
      <span>{tile.label}</span>
      {/* The figure sits in the strong itself: a <span> here takes the
          label's ".metric span" look (12px, uppercase, muted). */}
      <strong className="vol-figure" data-no-translate>
        {figure}
      </strong>
      {totals && tile.key === "pieces" && (
        <small>
          {change ? (
            <>
              <b className={`vol-change ${volumeChangeTone(totals.piecesChangePct)}`} data-no-translate>
                {change}
              </b>{" "}
              <span>vs previous month</span>
            </>
          ) : (
            <span>No earlier month to compare</span>
          )}
        </small>
      )}
      {totals && tile.key === "avgPerContainer" && tile.value === null && (
        <small>
          <span>No containers to average</span>
        </small>
      )}
      {totals && tile.key === "customerLines" && (
        <small>
          <span>customer loads received</span>
        </small>
      )}
    </article>
  );
}

/**
 * The month's tiles in two rows: what came in (pieces, then barrels, packages
 * and cars each on its own tile) and what went out (containers, the average
 * per container, and customer lines where the page shows them). `totals:
 * null` (nothing loaded yet, or it failed) shows dashes, never false zeros.
 */
function VolumeTiles({ totals, showCustomerLines }: { totals: VolumeTotals | null; showCustomerLines: boolean }) {
  const tiles = volumeTiles(totals ?? emptyVolumeTotals(), { showCustomerLines });
  return (
    <div className="vol-tiles">
      <div className="metric-grid vol-tile-row received">
        {tiles.received.map((tile) => (
          <VolumeTileCard key={tile.key} tile={tile} totals={totals} />
        ))}
      </div>
      <div className={`metric-grid vol-tile-row shipped count-${tiles.shipped.length}`}>
        {tiles.shipped.map((tile) => (
          <VolumeTileCard key={tile.key} tile={tile} totals={totals} />
        ))}
      </div>
    </div>
  );
}

function ContainerList({ containers, month, truncated }: { containers: VolumeContainer[]; month: string; truncated: boolean }) {
  if (containers.length === 0) {
    return (
      <div className="empty-state">
        <span>No containers shipped in</span> <MonthText month={month} />
      </div>
    );
  }
  return (
    <>
      <ul className="vol-container-list">
        {containers.map((box) => (
          <li key={box.id}>
            <div className="vol-container-head">
              <Container size={16} />
              <strong data-no-translate>{box.number || box.id}</strong>
              <span className={`status-pill compact ${box.status === "arrived" ? "good" : ""}`}>
                {box.status === "arrived" ? "Arrived" : "Shipped"}
              </span>
            </div>
            <div className="vol-container-meta">
              {box.destination && <UserText value={box.destination} fallback="" />}
              {box.destination && <span aria-hidden="true"> · </span>}
              <span data-no-translate>{box.sailedAtMs ? formatDate(box.sailedAtMs) : ""}</span>
            </div>
            <div className="vol-container-counts">
              <span>
                <span>Barrels</span> <Count value={box.barrels} />
              </span>
              <span>
                <span>Packages</span> <Count value={box.packages} />
              </span>
              <span>
                <span>Cars</span> <Count value={box.cars} />
              </span>
              <span className="vol-container-total">
                <span>Pieces</span> <Count value={box.pieces} />
              </span>
            </div>
          </li>
        ))}
      </ul>
      {truncated && <p className="vol-note">Showing the first 200 containers.</p>}
    </>
  );
}

function TrendChart({ trend }: { trend: PlatformVolumeResponse["trend"] }) {
  const language = useLanguage();
  const bars = volumeTrendBars(trend);
  const width = 720;
  const height = 170;
  const plotHeight = height - 22;
  const step = bars.length > 0 ? width / bars.length : width;
  const barWidth = Math.max(1, Math.min(42, step - 8));
  return (
    <article className="commission-chart-card vol-trend">
      <div className="chart-head">
        <h3>Pieces received, last 12 months</h3>
      </div>
      <svg aria-hidden="true" className="commission-chart" data-no-translate focusable="false" viewBox={`0 0 ${width} ${height}`}>
        <line stroke="var(--rule)" strokeWidth="1" x1="0" x2={width} y1={plotHeight} y2={plotHeight} />
        {bars.map((bar, index) => {
          const x = index * step + (step - barWidth) / 2;
          const barHeight = bar.ratio * (plotHeight - 18);
          return (
            <g key={bar.month}>
              <rect fill="var(--brand)" height={barHeight} rx="2" width={barWidth} x={x} y={plotHeight - barHeight} />
              {bar.pieces > 0 && (
                <text fill="var(--ink)" fontSize="11" textAnchor="middle" x={x + barWidth / 2} y={plotHeight - barHeight - 4}>
                  {formatVolumeCount(bar.pieces, language)}
                </text>
              )}
              <text fill="var(--muted)" fontSize="11" textAnchor="middle" x={x + barWidth / 2} y={height - 6}>
                {formatVolumeMonthShort(bar.month, language)}
              </text>
            </g>
          );
        })}
      </svg>
      <details className="commission-data">
        <summary>Show these numbers as a table</summary>
        <table className="commission-table">
          <caption className="sr-only">Pieces by month</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Pieces</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((bar) => (
              <tr key={bar.month}>
                <th scope="row">
                  <MonthText month={bar.month} />
                </th>
                <td>
                  <Count value={bar.pieces} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </article>
  );
}

/** Recounts the last 12 months for every business (rebuildVolumeMonths), page by page. */
function RecountButton({ month, onDone }: { month: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"" | "done" | "failed">("");
  async function recount() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const rebuild = httpsCallable<Record<string, unknown>, { done: boolean; nextBusinessId: string }>(
        functions,
        "rebuildVolumeMonths",
        { timeout: 310000 },
      );
      let startAfterBusinessId = "";
      for (let call = 0; call < REBUILD_MAX_CALLS; call += 1) {
        const { data } = await rebuild({ fromMonth: shiftVolumeMonth(month, -11), toMonth: month, startAfterBusinessId });
        if (data.done || !data.nextBusinessId) break;
        startAfterBusinessId = data.nextBusinessId;
      }
      setMessage("done");
      onDone();
    } catch {
      setMessage("failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="vol-recount">
      <button aria-busy={busy} className="ghost-button compact" disabled={busy} onClick={recount} type="button">
        <RefreshCw size={14} /> {busy ? "Recounting…" : "Recount the last 12 months"}
      </button>
      {message === "done" && <span role="status">Recounted.</span>}
      {message === "failed" && (
        <span className="totals-status-error" role="alert">
          Could not recount. Try again.
        </span>
      )}
    </span>
  );
}

/**
 * One business's month: its status line, tiles and the containers it
 * shipped (getBusinessVolume). The business console's Volume page and the
 * admin page's one-business view are both this.
 */
function BusinessMonth({
  businessId,
  month,
  previewMode,
  showCustomerLines,
}: {
  businessId: string;
  month: string;
  previewMode: boolean;
  showCustomerLines: boolean;
}) {
  const answer = useServerTotals<BusinessVolumeResponse>(
    "getBusinessVolume",
    previewMode || !businessId ? null : { businessId, month },
  );
  const preview = useMemo(
    () => (previewMode && businessId ? previewBusinessVolume(businessId, month) : null),
    [previewMode, businessId, month],
  );
  // An answer for another business or month (the picker just moved) is never shown.
  const live = answer.data && answer.data.month === month && answer.data.businessId === businessId ? answer.data : null;
  const data = preview ?? live;
  return (
    <>
      {!previewMode && (
        <TotalsStatus
          complete={data?.complete !== false}
          computedAtMs={data?.computedAtMs ?? null}
          error={answer.error}
          loading={answer.loading}
          onRefresh={() => answer.refresh()}
        />
      )}
      {data && isEmptyVolume(data.totals) && (
        <div className="empty-state vol-empty">
          <span>Nothing was received or shipped in</span> <MonthText month={month} />
        </div>
      )}
      <VolumeTiles showCustomerLines={showCustomerLines} totals={data?.totals ?? null} />
      <section className="panel">
        <div className="panel-header">
          <div>
            <Container size={18} />
            <h2>
              <span>Containers shipped in</span> <MonthText month={month} />
            </h2>
          </div>
        </div>
        <div className="vol-panel-body">
          {data ? (
            <ContainerList containers={data.containers} month={month} truncated={data.containersTruncated} />
          ) : (
            !answer.loading && (
              <div className="empty-state">
                <span>No containers shipped in</span> <MonthText month={month} />
              </div>
            )
          )}
        </div>
      </section>
    </>
  );
}

/**
 * Admin console → Volume: every business's month (artboard 11), or one
 * business's month picked from the top of the page or from the table.
 * The pick is the page's own state: the admin console keeps its tab in
 * memory, not in the address, so a reload starts on Today either way.
 */
export function AdminVolumeView({
  previewMode,
  canRebuild,
  businesses = [],
}: {
  previewMode: boolean;
  canRebuild: boolean;
  /** The console's business directory, for the picker. */
  businesses?: ReadonlyArray<{ id?: unknown; name?: unknown; _inferred?: unknown }>;
}) {
  const language = useLanguage();
  const [month, setMonth] = useState(() => currentVolumeMonth());
  const [reload, setReload] = useState(0);
  const [businessId, setBusinessId] = useState("");
  const answer = useServerTotals<PlatformVolumeResponse>(
    "getPlatformVolume",
    previewMode || businessId ? null : { month },
    reload,
  );
  const preview = useMemo(() => (previewMode ? previewPlatformVolume(month) : null), [previewMode, month]);
  const data = preview ?? (answer.data && answer.data.month === month ? answer.data : null);
  // Names for the picker: the directory, plus whatever the last table held.
  const tableRows = preview?.businesses ?? answer.data?.businesses;
  const options = useMemo(() => volumeBusinessOptions(businesses, tableRows ?? []), [businesses, tableRows]);
  const totals = data?.totals ?? null;
  const rows = data?.businesses ?? [];
  const nothing = isEmptyVolume(totals);
  const selectedName = options.find((option) => option.id === businessId)?.name || businessId;

  function pick(id: string, fromTable = false) {
    setBusinessId(id);
    // From the table the top of the page is out of view; bring it back.
    if (fromTable && typeof window !== "undefined") window.scrollTo({ top: 0 });
  }

  return (
    <div className="stack vol-page">
      <section className="vol-topbar">
        <div className="vol-topbar-title">
          {businessId ? (
            <>
              <button className="vol-back" onClick={() => pick("")} type="button">
                <ChevronLeft size={15} /> <span>All businesses</span>
              </button>
              <h2 data-no-translate>{selectedName}</h2>
              <p>Pieces received and containers shipped</p>
            </>
          ) : (
            <>
              <h2 data-no-translate>Volume</h2>
              <p>Pieces count in the month they were received; containers in the month they sailed (New York time).</p>
            </>
          )}
        </div>
        <div className="vol-topbar-actions">
          <BusinessPicker onChange={(id) => pick(id)} options={options} value={businessId} />
          <MonthPicker month={month} onChange={setMonth} />
          {!businessId && (
            <button
              className="secondary-button"
              disabled={!data}
              onClick={() => data && downloadVolumeCsv(data, language)}
              type="button"
            >
              <Download size={15} /> Download CSV
            </button>
          )}
        </div>
      </section>
      {businessId ? (
        <BusinessMonth businessId={businessId} month={month} previewMode={previewMode} showCustomerLines />
      ) : (
        <>
          {!previewMode && (
            <TotalsStatus
              computedAtMs={answer.data?.computedAtMs ?? null}
              error={answer.error}
              loading={answer.loading}
              onRefresh={() => answer.refresh()}
            />
          )}
          <VolumeTiles showCustomerLines totals={totals} />
          <section className="panel">
            <div className="panel-header">
              <div>
                <BarChart3 size={18} />
                <h2>By business</h2>
              </div>
            </div>
            {nothing || (!data && !answer.loading) ? (
              <div className="empty-state">
                <span>Nothing was received or shipped in</span> <MonthText month={month} />
              </div>
            ) : (
              <>
                {rows.length > 0 && <p className="vol-note vol-table-hint">Choose a business to see its own tiles and containers.</p>}
                <div className="vol-table-scroll">
                  <table className="commission-table vol-table">
                    <thead>
                      <tr>
                        <th scope="col">Business</th>
                        <th scope="col">Barrels</th>
                        <th scope="col">Packages</th>
                        <th scope="col">Cars</th>
                        <th scope="col">Pieces</th>
                        <th scope="col">Containers</th>
                        <th scope="col">Avg / container</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.businessId} onClick={() => pick(row.businessId, true)}>
                          <th scope="row">
                            <button
                              className="vol-row-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                pick(row.businessId, true);
                              }}
                              title="See this business only"
                              type="button"
                            >
                              <span data-no-translate>{row.name || row.businessId}</span>
                            </button>
                          </th>
                          <td>
                            <Count value={row.barrels} />
                          </td>
                          <td>
                            <Count value={row.packages} />
                          </td>
                          <td>
                            <Count value={row.cars} />
                          </td>
                          <td>
                            <b>
                              <Count value={row.pieces} />
                            </b>
                          </td>
                          <td>
                            <Count value={row.containersShipped} />
                          </td>
                          <td data-no-translate>{formatVolumeAverage(row.avgPerContainer, language)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {rows.length > 1 && totals && (
                      <tfoot>
                        <tr>
                          <th scope="row">Total</th>
                          <td>
                            <Count value={totals.barrels} />
                          </td>
                          <td>
                            <Count value={totals.packages} />
                          </td>
                          <td>
                            <Count value={totals.cars} />
                          </td>
                          <td>
                            <b>
                              <Count value={totals.pieces} />
                            </b>
                          </td>
                          <td>
                            <Count value={totals.containersShipped} />
                          </td>
                          <td data-no-translate>{formatVolumeAverage(totals.avgPerContainer, language)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </>
            )}
          </section>
          <TrendChart trend={data?.trend ?? []} />
          {canRebuild && !previewMode && (
            <div className="vol-footer">
              <RecountButton month={month} onDone={() => setReload((value) => value + 1)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Business console → Volume: the business's own month (artboard 12). */
export function BusinessVolumePanel({ businessId, previewMode }: { businessId: string; previewMode: boolean }) {
  const [month, setMonth] = useState(() => currentVolumeMonth());
  const thisMonth = month === currentVolumeMonth();
  return (
    <div className="stack vol-page">
      <section className="vol-topbar">
        <div className="vol-topbar-title">
          <h2 data-no-translate>Volume</h2>
          <p>{thisMonth ? <span>Your volume this month</span> : <MonthText month={month} />}</p>
        </div>
        <div className="vol-topbar-actions">
          <MonthPicker month={month} onChange={setMonth} />
        </div>
      </section>
      <BusinessMonth businessId={businessId} month={month} previewMode={previewMode} showCustomerLines={false} />
    </div>
  );
}
