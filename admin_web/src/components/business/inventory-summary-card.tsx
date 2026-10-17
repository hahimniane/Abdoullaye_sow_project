"use client";

import { useMemo, useState } from "react";

import { InventoryStoreFilter } from "@/components/business/inventory-store-filter";
import { TotalsStatus } from "@/components/totals-status";
import { currentLanguage } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import {
  INVENTORY_RANGE_LABELS,
  inventorySummaryRequest,
  leftText,
  lowAtText,
  productDisplayName,
  readInventorySummary,
  type InventorySummaryRange,
  type StoreAccess,
} from "@/lib/inventory";
import { ofWhichOnCreditText, stillOwedText } from "@/lib/inventory-credit";
import { useServerTotals, viewerTimeZone } from "@/lib/use-server-totals";

type SummaryResponse = Record<string, unknown> & { computedAtMs?: number };

/**
 * Today / This month, worked out by the server over every sale
 * (`getInventorySummary`): never added up from the sales list, which is paged.
 * Voided sales are not in it. Also the products that are low and the ones
 * whose count was off, so they can be opened from here; what each category
 * sold; and - for someone who sees every store of a multi-store business - a
 * store filter and what each store sold. Staff who work in one store get that
 * store's figures and no filter.
 */
export function InventorySummaryCard({
  businessId,
  enabled,
  reloadKey,
  access,
  storeFilter,
  onStoreFilter,
  onOpenItem,
  brandByItem,
}: {
  businessId: string;
  enabled: boolean;
  /** Changes when a sale was voided or stock changed, so the figures are asked for again. */
  reloadKey: number;
  access: StoreAccess;
  /** "" = all stores. */
  storeFilter: string;
  onStoreFilter: (storeId: string) => void;
  onOpenItem: (itemId: string) => void;
  /** The brand each product wears now, by product id: the server's best/low rows may carry the name alone. */
  brandByItem?: ReadonlyMap<string, string>;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const [range, setRange] = useState<InventorySummaryRange>("today");
  const timeZone = useMemo(() => viewerTimeZone(), []);
  // Staff of one store ask for that store; everyone else for all, or the chosen one. A single store sends none.
  const storeId = access.multi ? (access.canSeeAll ? storeFilter : access.scopedStoreId) : "";
  const totals = useServerTotals<SummaryResponse>(
    "getInventorySummary",
    enabled && businessId ? inventorySummaryRequest(businessId, range, timeZone, storeId) : null,
    reloadKey,
  );
  const summary = readInventorySummary(totals.data);
  const showByStore = access.multi && access.canSeeAll && !storeFilter && summary !== null && summary.byStore.length > 0;
  const showByCategory = summary !== null && summary.byCategory.length > 0;
  const showByBrand = summary !== null && summary.byBrand.length > 0;
  const shownName = (row: { itemId: string; name: string; brand: string }) =>
    productDisplayName({ name: row.name, brand: row.brand || brandByItem?.get(row.itemId) || "" });

  return (
    <section className="ivt-summary" aria-label="Sales summary">
      <div className="ivt-summary-bar">
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
        {access.multi && access.canSeeAll && (
          <div className="panel-tools">
            <InventoryStoreFilter stores={access.stores} value={storeFilter} onChange={onStoreFilter} />
          </div>
        )}
      </div>
      <div className="pk-scoreboard" role="group" aria-label="Sales totals">
        <div className="pk-stat"><span>Sales</span><b data-no-translate>{summary ? summary.salesCount : "—"}</b><small>{summary ? <><span data-no-translate>{summary.itemsSold}</span> <span>items sold</span></> : null}</small></div>
        <div className="pk-stat"><span>Revenue</span><b data-no-translate>{summary ? moneyText(summary.revenueCents) : "—"}</b>
          <small>{summary && summary.discountCents > 0 ? <><span data-no-translate>{moneyText(summary.discountCents)}</span> <span>in discounts</span></> : summary && summary.creditCents > 0 ? <span>everything sold</span> : <span>what was taken at the counter</span>}</small>
          {/* The total keeps its meaning (everything sold); what went on credit is said beside it. */}
          {summary && summary.creditCents > 0 && (
            <small className="ivt-of-credit" data-no-translate>
              {ofWhichOnCreditText(summary.creditCents, lang)}
              {summary.creditOutstandingCents > 0 ? ` · ${stillOwedText(summary.creditOutstandingCents, lang)}` : ""}
            </small>
          )}
        </div>
        <div className="pk-stat"><span>Profit</span><b data-no-translate className={summary && summary.profitCents < 0 ? "owed" : ""}>{summary ? moneyText(summary.profitCents) : "—"}</b><small>from the costs you entered</small></div>
      </div>
      <TotalsStatus
        computedAtMs={totals.data?.computedAtMs ?? null}
        error={totals.error}
        loading={totals.loading}
        onRefresh={() => totals.refresh()}
      />
      {(showByCategory || showByBrand || showByStore) && summary && (
        <div className="ivt-breakdowns">
          {showByCategory && (
            <div className="ivt-breakdown">
              <h4>Categories</h4>
              <table className="ivt-lines ivt-money-table">
                <thead>
                  <tr><th>Category</th><th>Items sold</th><th>Revenue</th><th>Profit</th></tr>
                </thead>
                <tbody>
                  {summary.byCategory.map((row) => (
                    <tr key={row.categoryId || "uncategorized"}>
                      <td>{row.categoryId ? <strong data-no-translate>{row.name}</strong> : <strong>Uncategorized</strong>}</td>
                      <td data-no-translate>{row.itemsSold}</td>
                      <td data-no-translate>{moneyText(row.revenueCents)}</td>
                      <td data-no-translate className={row.profitCents < 0 ? "ivt-neg" : undefined}>{moneyText(row.profitCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showByBrand && (
            <div className="ivt-breakdown">
              <h4>Brands</h4>
              <table className="ivt-lines ivt-money-table">
                <thead>
                  <tr><th>Brand</th><th>Items sold</th><th>Revenue</th><th>Profit</th></tr>
                </thead>
                <tbody>
                  {summary.byBrand.map((row) => (
                    <tr key={row.brandId || "no-brand"}>
                      <td>{row.brandId ? <strong data-no-translate>{row.name}</strong> : <strong>No brand</strong>}</td>
                      <td data-no-translate>{row.itemsSold}</td>
                      <td data-no-translate>{moneyText(row.revenueCents)}</td>
                      <td data-no-translate className={row.profitCents < 0 ? "ivt-neg" : undefined}>{moneyText(row.profitCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showByStore && (
            <div className="ivt-breakdown">
              <h4>By store</h4>
              <table className="ivt-lines ivt-money-table">
                <thead>
                  <tr><th>Store</th><th>Sales</th><th>Items sold</th><th>Revenue</th><th>Profit</th></tr>
                </thead>
                <tbody>
                  {summary.byStore.map((row) => (
                    <tr key={row.storeId}>
                      <td><strong data-no-translate>{row.name}</strong></td>
                      <td data-no-translate>{row.salesCount}</td>
                      <td data-no-translate>{row.itemsSold}</td>
                      <td data-no-translate>{moneyText(row.revenueCents)}</td>
                      <td data-no-translate className={row.profitCents < 0 ? "ivt-neg" : undefined}>{moneyText(row.profitCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {summary && (summary.best.length > 0 || summary.low.length > 0 || summary.countWasOff.length > 0) && (
        <div className="ivt-lists">
          {summary.best.length > 0 && (
            <div className="ivt-list">
              <h4>Best sellers</h4>
              <ul>
                {summary.best.map((row) => (
                  <li key={row.itemId}>
                    <button type="button" className="ivt-link" onClick={() => onOpenItem(row.itemId)} data-no-translate>{shownName(row)}</button>
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
                  <li key={`${row.itemId}-${row.storeId}`}>
                    <button type="button" className="ivt-link" onClick={() => onOpenItem(row.itemId)} data-no-translate>{shownName(row)}</button>
                    <small data-no-translate>
                      {leftText(row.quantity, lang)}
                      {row.lowStockAt !== null ? ` · ${lowAtText(row.lowStockAt, lang)}` : ""}
                      {access.multi && row.storeName ? ` · ${row.storeName}` : ""}
                    </small>
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
                    <button type="button" className="ivt-link" onClick={() => onOpenItem(row.itemId)} data-no-translate>{shownName(row)}</button>
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
