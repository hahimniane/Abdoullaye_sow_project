"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { ArrowDownRight, ArrowUpRight, Banknote, Boxes, ChevronLeft, ChevronRight, Receipt, RefreshCw, Undo2 } from "lucide-react";

import { InventoryStoreFilter } from "@/components/business/inventory-store-filter";
import { LoadMoreButton } from "@/components/show-more";
import { useInventoryPeriodRows } from "@/lib/business-data";
import { currentLanguage } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import { INVENTORY_MOVEMENT_LABELS, inventoryMethodLabel, legacyStoreId, type InventoryMovementType, type StoreAccess } from "@/lib/inventory";
import {
  HISTORY_KINDS,
  HISTORY_KIND_LABELS,
  NO_BRAND_KEY,
  UNCATEGORIZED_KEY,
  aggregateHistory,
  bucketLabel,
  canGoNext,
  cappedText,
  changePercent,
  changeText,
  changeTone,
  comparedWithText,
  customPeriod,
  historyTimeline,
  linesWithoutCostText,
  periodBounds,
  periodFor,
  periodTitle,
  previousPeriod,
  salesCountText,
  shiftPeriod,
  signedDelta,
  timeText,
  timelineDayTitle,
  voidedCountText,
  type HistoryKind,
  type HistoryPeriod,
  type HistoryShare,
  type TimelineEvent,
} from "@/lib/inventory-history";
import { owesText } from "@/lib/inventory-credit";

/** The most rows one period reads per collection before "Load more". */
const SALES_PAGE = 2000;
const EVENTS_PAGE = 500;
const PAID_COLOR = "var(--money, #0d9488)";
const CREDIT_COLOR = "#d97706";

type Row = Record<string, unknown>;

/**
 * Sales history: a shop's sales by Day / Week / Month / Year (or a range
 * picked on the calendar), with prev / next, what they add up to against the
 * period before, a chart, the breakdowns and a "what happened" timeline. Read
 * straight from the period's documents (bounded, newest first, "Load more"
 * past the cap) and worked out in `inventory-history.ts`; staff of one store
 * read their store only, whoever sees every store may narrow to one. The
 * profit tile is the owner's alone.
 */
export function InventoryHistory({
  businessId,
  enabled,
  access,
  isOwner,
  zone,
  todayKey,
  storeFilter,
  onStoreFilter,
  staffName,
  itemName,
  onOpenSale,
}: {
  businessId: string;
  enabled: boolean;
  access: StoreAccess;
  /** Only the owner sees the profit. */
  isOwner: boolean;
  /** The business's zone (America/New_York unless it stores another). */
  zone: string;
  todayKey: string;
  storeFilter: string;
  onStoreFilter: (storeId: string) => void;
  staffName: (id: string) => string;
  itemName: (itemId: string) => string;
  onOpenSale: (saleId: string, storeId: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const [period, setPeriod] = useState<HistoryPeriod>(() => periodFor("day", todayKey));
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const previous = useMemo(() => previousPeriod(period), [period]);
  const bounds = useMemo(() => periodBounds(period, zone), [period, zone]);
  const previousBounds = useMemo(() => periodBounds(previous, zone), [previous, zone]);
  const active = enabled && !access.needsHomeStore;
  const scoped = access.scopedStoreId;
  const sales = useInventoryPeriodRows("inventorySales", businessId, active, { storeId: scoped, ...bounds, pageSize: SALES_PAGE });
  const before = useInventoryPeriodRows("inventorySales", businessId, active, { storeId: scoped, ...previousBounds, pageSize: SALES_PAGE });
  const payments = useInventoryPeriodRows("inventoryCreditPayments", businessId, active, { storeId: scoped, ...bounds, pageSize: EVENTS_PAGE });
  const movements = useInventoryPeriodRows("inventoryMovements", businessId, active, { storeId: scoped, ...bounds, pageSize: EVENTS_PAGE });

  // Whoever sees every store narrows in the browser: a row from before stores counts under the Main store.
  const narrowTo = access.multi && access.canSeeAll ? storeFilter : "";
  const mainId = access.multi ? legacyStoreId(access.stores) : "";
  const inStore = useMemo(() => {
    if (!narrowTo) return (rows: Row[]) => rows;
    return (rows: Row[]) => rows.filter((row) => (String(row.storeId ?? "") || mainId) === narrowTo);
  }, [narrowTo, mainId]);
  const saleRows = useMemo(() => inStore(sales.rows), [inStore, sales.rows]);
  const beforeRows = useMemo(() => inStore(before.rows), [inStore, before.rows]);
  const paymentRows = useMemo(() => inStore(payments.rows), [inStore, payments.rows]);
  const movementRows = useMemo(() => inStore(movements.rows), [inStore, movements.rows]);
  const stores = access.multi ? access.stores : [];

  const now = useMemo(() => aggregateHistory({ rows: saleRows, period, zone, stores }), [saleRows, period, zone, stores]);
  const then = useMemo(() => aggregateHistory({ rows: beforeRows, period: previous, zone, stores }), [beforeRows, previous, zone, stores]);
  const days = useMemo(
    () => historyTimeline({ sales: saleRows, payments: paymentRows, movements: movementRows, period, zone, itemName }),
    [saleRows, paymentRows, movementRows, period, zone, itemName],
  );

  const loading = sales.loading && sales.rows.length === 0;
  const error = sales.error || before.error || payments.error || movements.error;
  const k = now.kpis;
  const p = then.kpis;
  const showProfit = isOwner && k.profitKnown;
  const nextOk = canGoNext(period, todayKey);

  function pickKind(kind: Exclude<HistoryKind, "custom">) {
    const anchor = period.endKey < todayKey ? period.startKey : todayKey;
    setPeriod(periodFor(kind, anchor));
  }

  function pickDay(key: string) {
    if (!key) return;
    setPeriod(periodFor(period.kind === "custom" ? "day" : period.kind, key > todayKey ? todayKey : key));
  }

  function applyRange() {
    const range = customPeriod(rangeFrom, rangeTo || rangeFrom);
    if (range) setPeriod({ ...range, endKey: range.endKey > todayKey ? todayKey : range.endKey });
  }

  return (
    <section className="ivt-history" aria-label="Sales history">
      <div className="ivt-history-bar">
        <div className="service-segments" role="tablist" aria-label="History period">
          {HISTORY_KINDS.map((kind) => (
            <span
              key={kind}
              role="button"
              tabIndex={0}
              className={`segment ${period.kind === kind ? "active" : ""}`}
              aria-pressed={period.kind === kind}
              onClick={() => pickKind(kind)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickKind(kind); } }}
            >
              {HISTORY_KIND_LABELS[kind]}
            </span>
          ))}
        </div>
        <div className="ivt-history-nav">
          <button className="lst-icon-btn" type="button" onClick={() => setPeriod(shiftPeriod(period, -1))} aria-label="Previous period" title="Previous period"><ChevronLeft size={18} /></button>
          <strong data-no-translate>{periodTitle(period, lang)}</strong>
          <button className="lst-icon-btn" type="button" disabled={!nextOk} onClick={() => setPeriod(shiftPeriod(period, 1))} aria-label="Next period" title="Next period"><ChevronRight size={18} /></button>
          <input type="date" value={period.kind === "custom" ? "" : period.startKey} max={todayKey} onChange={(e) => pickDay(e.target.value)} aria-label="Pick a day" title="Pick a day" />
        </div>
      </div>
      <div className="panel-tools ivt-history-range">
        <span className="lst-hint">Custom range</span>
        <input type="date" value={rangeFrom} max={todayKey} onChange={(e) => setRangeFrom(e.target.value)} aria-label="Range start" title="Range start" />
        <input type="date" value={rangeTo} max={todayKey} min={rangeFrom || undefined} onChange={(e) => setRangeTo(e.target.value)} aria-label="Range end" title="Range end" />
        <button className="lst-btn ghost" type="button" disabled={!rangeFrom} onClick={applyRange}>Show range</button>
        {period.kind !== "day" || period.startKey !== todayKey ? (
          <button className="lst-btn ghost" type="button" onClick={() => setPeriod(periodFor("day", todayKey))}>Today</button>
        ) : null}
        {access.multi && access.canSeeAll && (
          <InventoryStoreFilter stores={access.stores} value={storeFilter} onChange={onStoreFilter} />
        )}
      </div>
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {sales.hasMore && (
        <div className="lst-form-error" role="status">
          <span data-no-translate>{cappedText(sales.rows.length, lang)}</span>
          {" "}<LoadMoreButton hasMore={sales.hasMore} loading={sales.loadingMore} onLoadMore={sales.loadMore} />
        </div>
      )}

      <div className="pk-scoreboard ivt-history-kpis" role="group" aria-label="Period totals">
        <Kpi label="Total sales" value={moneyText(k.totalCents)} change={changePercent(k.totalCents, p.totalCents)} lang={lang} />
        <Kpi label="Sales" value={String(k.count)} change={changePercent(k.count, p.count)} lang={lang} />
        <Kpi label="Items sold" value={String(k.items)} change={changePercent(k.items, p.items)} lang={lang} />
        <Kpi label="Average sale" value={moneyText(k.averageCents)} change={changePercent(k.averageCents, p.averageCents)} lang={lang} />
        <div className="pk-stat">
          <span>Paid now</span>
          <b data-no-translate>{moneyText(k.paidNowCents)}</b>
          <small><span>On credit</span> <span data-no-translate>{moneyText(k.creditCents)}</span></small>
        </div>
        {showProfit && (
          <Kpi
            label="Gross profit"
            value={moneyText(k.profitCents)}
            change={changePercent(k.profitCents, p.profitCents)}
            lang={lang}
            note={k.linesWithoutCost > 0 ? linesWithoutCostText(k.linesWithoutCost, lang) : ""}
          />
        )}
      </div>
      <p className="lst-hint" data-no-translate>
        {comparedWithText(previous, lang)}
        {k.voidedCount > 0 ? ` · ${voidedCountText(k.voidedCount, lang)} (${moneyText(k.voidedCents)})` : ""}
      </p>

      {loading ? (
        <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
      ) : (
        <>
          <HistoryChart buckets={now.buckets} granularity={now.granularity} period={period} lang={lang} totalCents={k.totalCents} />
          <div className="ivt-breakdowns">
            {access.multi && access.canSeeAll && !narrowTo && now.byStore.length > 0 && (
              <ShareBars title="By store" rows={now.byStore} total={k.totalCents} nameOf={(row) => row.name} lang={lang} />
            )}
            {now.bySeller.length > 0 && (
              <ShareBars title="By seller" rows={now.bySeller} total={k.totalCents} nameOf={(row) => staffName(row.key)} lang={lang} />
            )}
            {now.byMethod.length > 0 && (
              <div className="ivt-breakdown">
                <h4>By payment method</h4>
                <div className="lot-spend-breakdown">
                  {now.byMethod.map((row) => {
                    const share = k.totalCents > 0 ? row.cents / k.totalCents : 0;
                    return (
                      <div className="lot-spend-row" key={row.method}>
                        <div className="lot-spend-head">
                          <strong>{row.method === "credit" ? "On credit" : inventoryMethodLabel(row.method)}</strong>
                          <b data-no-translate>{moneyText(row.cents)}</b>
                        </div>
                        <div className="lot-spend-track">
                          <div className="lot-spend-fill" style={{ width: `${Math.max(share * 100, 1.2)}%`, background: row.method === "credit" ? CREDIT_COLOR : PAID_COLOR }} />
                          <span data-no-translate>{percentText(share)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {(now.topProducts.length > 0 || now.topBrands.length > 0 || now.topCategories.length > 0) && (
            <div className="ivt-breakdowns">
              {now.topProducts.length > 0 && (
                <TopTable title="Top products" head="Product" rows={now.topProducts} nameOf={(row) => row.name} />
              )}
              {now.topBrands.length > 0 && (
                <TopTable title="Top brands" head="Brand" rows={now.topBrands} nameOf={(row) => (row.key === NO_BRAND_KEY ? "" : row.name)} emptyName="No brand" />
              )}
              {now.topCategories.length > 0 && (
                <TopTable title="Top categories" head="Category" rows={now.topCategories} nameOf={(row) => (row.key === UNCATEGORIZED_KEY ? "" : row.name)} emptyName="Uncategorized" />
              )}
            </div>
          )}

          <h3 className="ivt-history-title">What happened</h3>
          {(payments.hasMore || movements.hasMore) && (
            <p className="lst-hint">The newest events of this period are shown.</p>
          )}
          {days.length === 0 ? (
            <div className="empty-state">Nothing happened in this period.</div>
          ) : (
            <ol className="ivt-timeline">
              {days.map((day) => (
                <li key={day.dateKey}>
                  <h4 data-no-translate>{timelineDayTitle(day.dateKey, todayKey, lang)}</h4>
                  <ul>
                    {day.events.map((event) => (
                      <TimelineRow key={event.id} event={event} zone={zone} lang={lang} staffName={staffName} onOpenSale={onOpenSale} />
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
          {(payments.hasMore || movements.hasMore) && (
            <div className="wpk-inline-actions">
              {payments.hasMore && <LoadMoreButton hasMore={payments.hasMore} loading={payments.loadingMore} onLoadMore={payments.loadMore} />}
              {movements.hasMore && <LoadMoreButton hasMore={movements.hasMore} loading={movements.loadingMore} onLoadMore={movements.loadMore} />}
            </div>
          )}
          <p className="lst-hint" data-no-translate>{salesCountText(k.count, lang)} · {periodTitle(period, lang)}</p>
        </>
      )}
    </section>
  );
}

function percentText(share: number): string {
  const percent = Math.round(share * 100);
  return percent < 1 && share > 0 ? "<1%" : `${percent}%`;
}

function Kpi({ label, value, change, lang, note = "" }: { label: string; value: string; change: number | null; lang: "en" | "fr"; note?: string }) {
  const tone = changeTone(change);
  return (
    <div className="pk-stat">
      <span>{label}</span>
      <b data-no-translate>{value}</b>
      <small data-no-translate className={`ivt-change ivt-change-${tone}`}>
        {tone === "up" && <ArrowUpRight size={12} aria-hidden="true" />}
        {tone === "down" && <ArrowDownRight size={12} aria-hidden="true" />}
        {changeText(change, lang)}
        {note ? ` · ${note}` : ""}
      </small>
    </div>
  );
}

/**
 * Money per hour, day or month, paid now and on credit stacked, as an inline
 * SVG column chart (the console's commission chart) with the same numbers in
 * a table under it - the table is the accessible copy.
 */
function HistoryChart({ buckets, granularity, period, lang, totalCents }: {
  buckets: ReturnType<typeof aggregateHistory>["buckets"];
  granularity: ReturnType<typeof aggregateHistory>["granularity"];
  period: HistoryPeriod;
  lang: "en" | "fr";
  totalCents: number;
}) {
  const width = 720;
  const height = 180;
  const bottom = 22;
  const plot = height - bottom;
  const step = buckets.length > 0 ? width / buckets.length : width;
  const bar = Math.max(1, Math.min(40, step - 3));
  const max = Math.max(1, ...buckets.map((b) => b.totalCents));
  const labelEvery = Math.max(1, Math.ceil(buckets.length / (granularity === "hour" ? 8 : 12)));
  const credit = buckets.reduce((sum, b) => sum + b.creditCents, 0);
  return (
    <article className="commission-chart-card ivt-history-chart">
      <div className="chart-head">
        <h3>{granularity === "hour" ? "Sales by hour" : granularity === "day" ? "Sales by day" : "Sales by month"}</h3>
        <span className="chart-total" data-no-translate>{moneyText(totalCents)}</span>
      </div>
      <ul className="commission-legend">
        <li><span className="dot" style={{ background: PAID_COLOR }} />Paid now<b data-no-translate>{moneyText(totalCents - credit)}</b></li>
        <li><span className="dot" style={{ background: CREDIT_COLOR }} />On credit<b data-no-translate>{moneyText(credit)}</b></li>
      </ul>
      {totalCents === 0 ? (
        <div className="empty-state">No sales in this period.</div>
      ) : (
        <svg aria-hidden="true" className="commission-chart" focusable="false" viewBox={`0 0 ${width} ${height}`}>
          <line stroke="var(--rule)" strokeWidth="1" x1="0" x2={width} y1={plot} y2={plot} />
          {buckets.map((bucket, index) => {
            const x = index * step + (step - bar) / 2;
            const paidHeight = (bucket.paidNowCents / max) * (plot - 6);
            const creditHeight = (bucket.creditCents / max) * (plot - 6);
            return (
              <g key={bucket.key}>
                <title>{`${bucketLabel(bucket.key, granularity, period, lang)}: ${moneyText(bucket.totalCents)}`}</title>
                <rect fill={PAID_COLOR} height={paidHeight} width={bar} x={x} y={plot - paidHeight} rx="2" />
                {creditHeight > 0 && <rect fill={CREDIT_COLOR} height={creditHeight} width={bar} x={x} y={plot - paidHeight - creditHeight} rx="2" />}
                {index % labelEvery === 0 && (
                  <text fill="var(--muted)" fontSize="11" textAnchor="middle" x={x + bar / 2} y={height - 6}>
                    {bucketLabel(bucket.key, granularity, period, lang)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      <details className="commission-data">
        <summary>Show these numbers as a table</summary>
        <table className="commission-table">
          <thead>
            <tr><th scope="col">When</th><th scope="col">Sales</th><th scope="col">Paid now</th><th scope="col">On credit</th><th scope="col">Total</th></tr>
          </thead>
          <tbody>
            {buckets.filter((b) => b.count > 0).map((bucket) => (
              <tr key={bucket.key}>
                <th scope="row" data-no-translate>{bucketLabel(bucket.key, granularity, period, lang)}</th>
                <td data-no-translate>{bucket.count}</td>
                <td data-no-translate>{moneyText(bucket.paidNowCents)}</td>
                <td data-no-translate>{moneyText(bucket.creditCents)}</td>
                <td data-no-translate>{moneyText(bucket.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </article>
  );
}

/** Ranked shares drawn against the period's total, in one colour (the ranking is the information). */
function ShareBars({ title, rows, total, nameOf, lang }: { title: string; rows: HistoryShare[]; total: number; nameOf: (row: HistoryShare) => string; lang: "en" | "fr" }) {
  return (
    <div className="ivt-breakdown">
      <h4>{title}</h4>
      <div className="lot-spend-breakdown">
        {rows.map((row) => {
          const share = total > 0 ? row.totalCents / total : 0;
          return (
            <div className="lot-spend-row" key={row.key || "none"}>
              <div className="lot-spend-head">
                <strong data-no-translate>{nameOf(row) || "—"}</strong>
                <b data-no-translate>{moneyText(row.totalCents)}</b>
              </div>
              <div className="lot-spend-track">
                <div className="lot-spend-fill" style={{ width: `${Math.max(share * 100, 1.2)}%`, background: PAID_COLOR }} />
                <span data-no-translate>{percentText(share)} · {salesCountText(row.count, lang)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopTable({ title, head, rows, nameOf, emptyName = "" }: { title: string; head: string; rows: HistoryShare[]; nameOf: (row: HistoryShare) => string; emptyName?: string }) {
  return (
    <div className="ivt-breakdown">
      <h4>{title}</h4>
      <table className="ivt-lines ivt-money-table">
        <thead>
          <tr><th>{head}</th><th>Items sold</th><th>Revenue</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const name = nameOf(row);
            return (
              <tr key={row.key}>
                <td>{name ? <strong data-no-translate>{name}</strong> : <strong>{emptyName || "—"}</strong>}</td>
                <td data-no-translate>{row.quantity}</td>
                <td data-no-translate>{moneyText(row.totalCents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function movementLabel(type: string): string {
  return type in INVENTORY_MOVEMENT_LABELS ? INVENTORY_MOVEMENT_LABELS[type as InventoryMovementType] : type;
}

function TimelineRow({ event, zone, lang, staffName, onOpenSale }: {
  event: TimelineEvent;
  zone: string;
  lang: "en" | "fr";
  staffName: (id: string) => string;
  onOpenSale: (saleId: string, storeId: string) => void;
}) {
  const who = staffName(event.staffId);
  const opens = Boolean(event.saleId);
  const open = () => { if (opens) onOpenSale(event.saleId, event.storeId); };
  const icon = event.kind === "sale" ? <Receipt size={15} /> : event.kind === "stock" ? <Boxes size={15} />
    : event.kind === "void" || event.kind === "credit_reverted" ? <Undo2 size={15} /> : <Banknote size={15} />;
  return (
    <li
      className={`ivt-event ivt-event-${event.kind}${event.voided ? " ivt-event-struck" : ""}${opens ? " ctn-clickable" : ""}`}
      {...(opens ? {
        role: "button",
        tabIndex: 0,
        onClick: open,
        onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
      } : {})}
    >
      <time data-no-translate>{timeText(event.atMs, zone, lang)}</time>
      <span className="ivt-event-icon" aria-hidden="true">{icon}</span>
      <span className="ivt-event-main">
        {event.kind === "sale" && (
          <>
            <strong><span>Sale</span> <span data-no-translate>{moneyText(event.amountCents)}</span></strong>
            <small data-no-translate>{event.title}{who ? ` · ${who}` : ""}{event.method ? ` · ${inventoryMethodLabel(event.method)}` : ""}</small>
            {event.creditCents > 0 && <small className="ivt-event-credit" data-no-translate>{owesText(event.customerName, event.creditCents, lang)}</small>}
            {event.voided && <small className="ivt-overdue">Voided</small>}
          </>
        )}
        {event.kind === "void" && (
          <>
            <strong><span>Sale voided</span> <span data-no-translate>{moneyText(event.amountCents)}</span></strong>
            <small data-no-translate>{[who, event.note].filter(Boolean).join(" · ")}</small>
          </>
        )}
        {event.kind === "credit_payment" && (
          <>
            <strong><span>Credit payment</span> <span data-no-translate>{moneyText(event.amountCents)}</span></strong>
            <small data-no-translate>{[event.customerName, who, event.method ? inventoryMethodLabel(event.method) : "", event.note].filter(Boolean).join(" · ")}</small>
            {event.voided && <small className="ivt-overdue">Reverted</small>}
          </>
        )}
        {event.kind === "credit_reverted" && (
          <>
            <strong><span>Credit payment reverted</span> <span data-no-translate>{moneyText(event.amountCents)}</span></strong>
            <small data-no-translate>{[event.customerName, who].filter(Boolean).join(" · ")}</small>
          </>
        )}
        {event.kind === "stock" && (
          <>
            <strong><span>{movementLabel(event.movementType)}</span> <span data-no-translate>{signedDelta(event.delta)}</span></strong>
            <small data-no-translate>{[event.title, who, event.note].filter(Boolean).join(" · ")}</small>
          </>
        )}
      </span>
    </li>
  );
}
