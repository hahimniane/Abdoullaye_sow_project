"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Undo2 } from "lucide-react";

import { LoadMoreButton } from "@/components/show-more";
import { useInventorySales } from "@/lib/business-data";
import { currentLanguage, formatDateTime } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import {
  inventorySaleFromRow,
  itemCountText,
  saleLinesSummary,
  soldByText,
  voidedByText,
  type InventorySale,
} from "@/lib/inventory";
import { statusPillClass } from "@/lib/status-pill";

/**
 * The counter's sales, newest first, a page at a time. Each sale opens to its
 * lines: the product's list price next to the price it sold at (a markdown is
 * visible at a glance), who sold it, how the customer paid. The one action is
 * Void - the sale stays in the list, marked, so nothing is ever erased.
 */
export function InventorySalesList({
  businessId,
  enabled,
  staffName,
  busy,
  onVoid,
}: {
  businessId: string;
  enabled: boolean;
  staffName: (id: string) => string;
  busy: boolean;
  onVoid: (sale: InventorySale) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const sales = useInventorySales(businessId, enabled);
  const [openId, setOpenId] = useState("");
  const list = useMemo(() => sales.rows.map(inventorySaleFromRow).filter((sale) => sale.id), [sales.rows]);

  return (
    <>
      {sales.error && <div className="lst-form-error" role="alert">{sales.error}</div>}
      <p className="panel-lede">Every sale rung up at the counter in the Laawol app. Open one to see what each product was listed at and what it sold for. Voiding a sale puts its stock back and keeps it here, marked.</p>
      {sales.loading && list.length === 0 ? (
        <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
      ) : list.length === 0 ? (
        <div className="empty-state">No sales yet. They appear here once staff sell a product in the app.</div>
      ) : (
        <div className="mini-table">
          <div className="ctn-table ivt-sales-table">
            <div className="mini-table-head"><span>Sale</span><span>Products</span><span>Paid with</span><span>Total</span><span aria-hidden="true"></span></div>
            {list.map((sale) => {
              const open = openId === sale.id;
              const summary = saleLinesSummary(sale);
              const seller = staffName(sale.soldByStaffId);
              const voider = staffName(sale.voidedByStaffId);
              return (
                <Fragment key={sale.id}>
                  <div
                    className={`mini-table-row ctn-clickable${sale.voided ? " ivt-voided" : ""}`}
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? "" : sale.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(open ? "" : sale.id); } }}
                  >
                    <span>
                      <strong data-no-translate>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {formatDateTime(sale.createdAt)}</strong>
                      {seller && <small data-no-translate>{soldByText(seller, lang)}</small>}
                    </span>
                    <span>
                      <strong data-no-translate>{summary.names.join(", ")}{summary.more > 0 ? ` +${summary.more}` : ""}</strong>
                      <small data-no-translate>{itemCountText(sale.itemCount, lang)}</small>
                    </span>
                    <span>
                      <strong>{sale.methodLabel}</strong>
                      {sale.anyCountWasOff && <small className="ctn-wa-warn">Count was off</small>}
                    </span>
                    <span>
                      <strong data-no-translate>{moneyText(sale.totalCents)}</strong>
                      {sale.discountCents > 0 && <small><span>Discount</span> <span data-no-translate>{moneyText(sale.discountCents)}</span></small>}
                      {sale.voided && <span className={statusPillClass("muted")}>Voided</span>}
                    </span>
                    <span className="ctn-row-actions">
                      {!sale.voided && (
                        <button
                          className="ghost-button"
                          type="button"
                          disabled={busy}
                          onClick={(e) => { e.stopPropagation(); onVoid(sale); }}
                          title="Void this sale"
                          aria-label="Void this sale"
                        ><Undo2 size={14} /></button>
                      )}
                    </span>
                  </div>
                  {open && (
                    <div className="ivt-sale-detail">
                      {sale.voided && (
                        <p className="ivt-void-note" data-no-translate>
                          {voidedByText(voider, lang)} · {formatDateTime(sale.voidedAt)}{sale.voidReason ? ` · ${sale.voidReason}` : ""}
                        </p>
                      )}
                      <table className="ivt-lines">
                        <thead>
                          <tr><th>Product</th><th>Quantity</th><th>List price</th><th>Sold at</th><th>Line total</th></tr>
                        </thead>
                        <tbody>
                          {sale.lines.map((line, index) => (
                            <tr key={`${line.itemId}-${index}`}>
                              <td>
                                <strong data-no-translate>{line.name}</strong>
                                {line.code && <small data-no-translate>{line.code}</small>}
                                {line.countWasOff && <small className="ctn-wa-warn">Count was off</small>}
                              </td>
                              <td data-no-translate>{line.quantity}</td>
                              <td data-no-translate>{moneyText(line.listPriceCents)}</td>
                              <td data-no-translate className={line.repriced ? "ivt-repriced" : undefined}>{moneyText(line.soldPriceCents)}</td>
                              <td data-no-translate>{moneyText(line.lineTotalCents)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
          <LoadMoreButton hasMore={sales.hasMore} loading={sales.loadingMore} onLoadMore={sales.loadMore} />
        </div>
      )}
    </>
  );
}
