"use client";

// The Volume pages (docs/PACKAGE_REQUESTS.md §5): the platform admin's view of
// every business's month, and a business console's view of its own. Counted
// on the server (volume_counts.js); read here through getPlatformVolume and
// getBusinessVolume. Pure logic - months, labels, CSV - is lib/volume.ts.

import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { BarChart3, ChevronLeft, ChevronRight, Container, Download, RefreshCw, X } from "lucide-react";

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
  shiftVolumeMonth,
  stepVolumeMonth,
  volumeChangeTone,
  volumeTrendBars,
  type BusinessVolumeResponse,
  type PlatformVolumeResponse,
  type VolumeContainer,
  type VolumeLanguage,
  type VolumeTotals,
} from "@/lib/volume";

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
  const current = currentVolumeMonth();
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
      <strong className="vol-month-label" aria-live="polite">
        <MonthText month={month} />
      </strong>
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

function Count({ value }: { value: unknown }) {
  const language = useLanguage();
  return <span data-no-translate>{formatVolumeCount(value, language)}</span>;
}

function VolumeTiles({ totals, showCustomerLines }: { totals: VolumeTotals; showCustomerLines: boolean }) {
  const language = useLanguage();
  const change = formatVolumeChange(totals.piecesChangePct, language);
  const tone = volumeChangeTone(totals.piecesChangePct);
  return (
    <div className={`metric-grid vol-tiles ${showCustomerLines ? "" : "three"}`}>
      <article className="metric">
        <span>Pieces received</span>
        {/* The figure sits in the strong itself: a <span> here takes the
            label's ".metric span" look (12px, uppercase, muted). */}
        <strong className="vol-figure" data-no-translate>
          {formatVolumeCount(totals.pieces, language)}
        </strong>
        <small>
          {change ? (
            <>
              <b className={`vol-change ${tone}`} data-no-translate>
                {change}
              </b>{" "}
              <span>vs previous month</span>
            </>
          ) : (
            <span>No earlier month to compare</span>
          )}
        </small>
      </article>
      <article className="metric neutral">
        <span>Barrels · Packages · Cars</span>
        <strong className="vol-figure vol-split" data-no-translate>
          {formatVolumeCount(totals.barrels, language)} · {formatVolumeCount(totals.packages, language)} ·{" "}
          {formatVolumeCount(totals.cars, language)}
        </strong>
      </article>
      <article className="metric neutral">
        <span>Containers shipped</span>
        <strong className="vol-figure" data-no-translate>
          {formatVolumeCount(totals.containersShipped, language)}
        </strong>
        <small>
          <b data-no-translate>{formatVolumeAverage(totals.avgPerContainer, language)}</b>{" "}
          <span>avg pieces per container</span>
        </small>
      </article>
      {showCustomerLines && (
        <article className="metric neutral">
          <span>Customer lines</span>
          <strong className="vol-figure" data-no-translate>
            {formatVolumeCount(totals.customerLines, language)}
          </strong>
          <small>
            <span>customer loads received</span>
          </small>
        </article>
      )}
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

function BusinessContainersDrawer({
  businessId,
  businessName,
  month,
  onClose,
}: {
  businessId: string;
  businessName: string;
  month: string;
  onClose: () => void;
}) {
  const answer = useServerTotals<BusinessVolumeResponse>("getBusinessVolume", { businessId, month });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="account-overlay" role="presentation">
      <button aria-label="Close" className="account-backdrop" onClick={onClose} type="button" />
      <aside aria-modal="true" className="account-drawer vol-drawer" role="dialog">
        <div className="account-drawer-head">
          <h2>
            <span data-no-translate>{businessName || businessId}</span> · <span>containers in</span>{" "}
            <MonthText month={month} />
          </h2>
          <button aria-label="Close" className="icon-button subtle" onClick={onClose} title="Close" type="button">
            <X size={18} />
          </button>
        </div>
        <div className="vol-drawer-body">
          <TotalsStatus
            complete={answer.data?.complete !== false}
            computedAtMs={answer.data?.computedAtMs ?? null}
            error={answer.error}
            loading={answer.loading}
            onRefresh={() => answer.refresh()}
          />
          {answer.data && (
            <ContainerList containers={answer.data.containers} month={month} truncated={answer.data.containersTruncated} />
          )}
        </div>
      </aside>
    </div>
  );
}

/** Admin console → Volume: every business's month (artboard 11). */
export function AdminVolumeView({ previewMode, canRebuild }: { previewMode: boolean; canRebuild: boolean }) {
  const language = useLanguage();
  const [month, setMonth] = useState(() => currentVolumeMonth());
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const answer = useServerTotals<PlatformVolumeResponse>("getPlatformVolume", previewMode ? null : { month }, reload);
  const data = answer.data && answer.data.month === month ? answer.data : null;
  const totals = data?.totals ?? { ...emptyVolumeTotals(), businesses: 0 };
  const rows = data?.businesses ?? [];
  const nothing = Boolean(data) && totals.pieces === 0 && totals.containersShipped === 0;
  return (
    <div className="stack vol-page">
      <section className="vol-topbar">
        <div>
          <h2>Volume</h2>
          <p>Pieces count in the month they were received; containers in the month they sailed (New York time).</p>
        </div>
        <div className="vol-topbar-actions">
          <MonthPicker month={month} onChange={setMonth} />
          <button
            className="secondary-button"
            disabled={!data}
            onClick={() => data && downloadVolumeCsv(data, language)}
            type="button"
          >
            <Download size={15} /> Download CSV
          </button>
        </div>
      </section>
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
                  <tr
                    className={selected?.id === row.businessId ? "selected" : ""}
                    key={row.businessId}
                    onClick={() => setSelected({ id: row.businessId, name: row.name })}
                  >
                    <th scope="row">
                      <button
                        className="vol-row-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected({ id: row.businessId, name: row.name });
                        }}
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
              {rows.length > 1 && (
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
        )}
      </section>
      <TrendChart trend={data?.trend ?? []} />
      {canRebuild && !previewMode && (
        <div className="vol-footer">
          <RecountButton month={month} onDone={() => setReload((value) => value + 1)} />
        </div>
      )}
      {selected && (
        <BusinessContainersDrawer
          businessId={selected.id}
          businessName={selected.name}
          month={month}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** Business console → Volume: the business's own month (artboard 12). */
export function BusinessVolumePanel({ businessId, previewMode }: { businessId: string; previewMode: boolean }) {
  const [month, setMonth] = useState(() => currentVolumeMonth());
  const answer = useServerTotals<BusinessVolumeResponse>(
    "getBusinessVolume",
    previewMode || !businessId ? null : { businessId, month },
  );
  const data = answer.data && answer.data.month === month ? answer.data : null;
  const totals = useMemo(() => data?.totals ?? emptyVolumeTotals(), [data]);
  const thisMonth = month === currentVolumeMonth();
  return (
    <div className="stack vol-page">
      <section className="vol-topbar">
        <div>
          <h2>Volume</h2>
          <p>{thisMonth ? <span>Your volume this month</span> : <MonthText month={month} />}</p>
        </div>
        <div className="vol-topbar-actions">
          <MonthPicker month={month} onChange={setMonth} />
        </div>
      </section>
      {!previewMode && (
        <TotalsStatus
          complete={answer.data?.complete !== false}
          computedAtMs={answer.data?.computedAtMs ?? null}
          error={answer.error}
          loading={answer.loading}
          onRefresh={() => answer.refresh()}
        />
      )}
      <VolumeTiles showCustomerLines={false} totals={totals} />
      <section className="panel">
        <div className="panel-header">
          <div>
            <Container size={18} />
            <h2>
              <span>Containers shipped in</span> <MonthText month={month} />
            </h2>
          </div>
        </div>
        {data ? (
          <ContainerList containers={data.containers} month={month} truncated={data.containersTruncated} />
        ) : (
          !answer.loading && (
            <div className="empty-state">
              <span>No containers shipped in</span> <MonthText month={month} />
            </div>
          )
        )}
      </section>
    </div>
  );
}
