"use client";

import { useMemo, useState } from "react";

import { TotalsStatus } from "@/components/totals-status";
import { currentLanguage } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import {
  INVENTORY_RANGE_LABELS,
  inventorySummaryRequest,
  leftText,
  lowAtText,
  readInventorySummary,
  type InventorySummaryRange,
} from "@/lib/inventory";
import { useServerTotals, viewerTimeZone } from "@/lib/use-server-totals";

type SummaryResponse = Record<string, unknown> & { computedAtMs?: number };

/**
 * Today / This month, worked out by the server over every sale
 * (`getInventorySummary`): never added up from the sales list, which is paged.
 * Voided sales are not in it. Also the products that are low and the ones
 * whose count was off, so they can be opened from here.
 */
export function InventorySummaryCard({
  businessId,
  enabled,
  reloadKey,
  onOpenItem,
}: {
  businessId: string;
  enabled: boolean;
  /** Changes when a sale was voided or stock changed, so the figures are asked for again. */
  reloadKey: number;
  onOpenItem: (itemId: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const [range, setRange] = useState<InventorySummaryRange>("today");
  const timeZone = useMemo(() => viewerTimeZone(), []);
  const totals = useServerTotals<SummaryResponse>(
    "getInventorySummary",
    enabled && businessId ? inventorySummaryRequest(businessId, range, timeZone) : null,
    reloadKey,
  );
  const summary = readInventorySummary(totals.data);

  return (
    <section className="ivt-summary" aria-label="Sales summary">
      <div className="service-segments" role="tablist" aria-label="Summary period">
        {(["today", "month"] as InventorySummaryRange[]).map((id) => (
          <span
            key={id}
            role="button"
            tabIndex={0}
            className={`segment ${range === id ? "active" : ""}`}
            aria-pressed={range === id}
            onClick={() => setRange(id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRange(id); } }}
          >
            {INVENTORY_RANGE_LABELS[id]}
          </span>
        ))}
      </div>
      <div className="pk-scoreboard" role="group" aria-label="Sales totals">
        <div className="pk-stat"><span>Sales</span><b data-no-translate>{summary ? summary.salesCount : "—"}</b><small>{summary ? <><span data-no-translate>{summary.itemsSold}</span> <span>items sold</span></> : null}</small></div>
        <div className="pk-stat"><span>Revenue</span><b data-no-translate>{summary ? moneyText(summary.revenueCents) : "—"}</b>
          <small>{summary && summary.discountCents > 0 ? <><span data-no-translate>{moneyText(summary.discountCents)}</span> <span>in discounts</span></> : <span>what was taken at the counter</span>}</small>
        </div>
        <div className="pk-stat"><span>Profit</span><b data-no-translate className={summary && summary.profitCents < 0 ? "owed" : ""}>{summary ? moneyText(summary.profitCents) : "—"}</b><small>from the costs you entered</small></div>
      </div>
      <TotalsStatus
        computedAtMs={totals.data?.computedAtMs ?? null}
        error={totals.error}
        loading={totals.loading}
        onRefresh={() => totals.refresh()}
      />
      {summary && (summary.best.length > 0 || summary.low.length > 0 || summary.countWasOff.length > 0) && (
        <div className="ivt-lists">
          {summary.best.length > 0 && (
            <div className="ivt-list">
              <h4>Best sellers</h4>
              <ul>
                {summary.best.map((row) => (
                  <li key={row.itemId}>
                    <button type="button" className="ivt-link" onClick={() => onOpenItem(row.itemId)} data-no-translate>{row.name}</button>
                    <small data-no-translate>{row.quantity} · {moneyText(row.revenueCents)}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.low.length > 0 && (
            <div className="ivt-list">
              <h4>Running low</h4>
              <ul>
                {summary.low.map((row) => (
                  <li key={row.itemId}>
                    <button type="button" className="ivt-link" onClick={() => onOpenItem(row.itemId)} data-no-translate>{row.name}</button>
                    <small data-no-translate>{leftText(row.quantity, lang)}{row.lowStockAt !== null ? ` · ${lowAtText(row.lowStockAt, lang)}` : ""}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.countWasOff.length > 0 && (
            <div className="ivt-list">
              <h4>Count was off</h4>
              <ul>
                {summary.countWasOff.map((row) => (
                  <li key={row.itemId}>
                    <button type="button" className="ivt-link" onClick={() => onOpenItem(row.itemId)} data-no-translate>{row.name}</button>
                    <small>Recount it and set the count.</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
