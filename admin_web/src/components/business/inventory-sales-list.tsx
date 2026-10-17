"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Undo2 } from "lucide-react";

import { InventoryCreditBlock } from "@/components/business/inventory-credit-block";
import { InventoryStoreFilter } from "@/components/business/inventory-store-filter";
import { LoadMoreButton } from "@/components/show-more";
import { useInventorySales, useLiveDocRead } from "@/lib/business-data";
import { currentLanguage, formatDateTime } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import {
  inventorySaleFromRow,
  itemCountText,
  saleLinesSummary,
  saleStoreId,
  saleVisibleToViewer,
  salesInStore,
  soldByText,
  storeNameIndex,
  voidedByText,
  type InventorySale,
  type SaleFocus,
  type StoreAccess,
  productDisplayName,
} from "@/lib/inventory";
import {
  CREDIT_CHIP_TONES,
  SALE_CREDIT_FILTERS,
  SALE_CREDIT_FILTER_LABELS,
  creditChip,
  creditChipText,
  receivedByText,
  saleMatchesCreditFilter,
  type SaleCreditFilter,
} from "@/lib/inventory-credit";
import { statusPillClass } from "@/lib/status-pill";

/**
 * The counter's sales, newest first, a page at a time. Each sale opens to its
 * lines: the product's list price next to the price it sold at (a markdown is
 * visible at a glance), who sold it, how the customer paid. The one action is
 * Void - the sale stays in the list, marked, so nothing is ever erased.
 *
 * A business with several stores gets a Store column; whoever sees every
 * store also gets a store filter. Staff of one store read only that store's
 * sales (the query is theirs), and have neither.
 *
 * A sale alert opens one sale (`focus`): read by id, so it shows even when it
 * is not in the page loaded so far, put first, opened and briefly
 * highlighted. One that cannot be read or may not be shown to this person
 * says so instead, and the list opens as usual.
 */
/** A sale opened from a notification waits this long to be read before it counts as not available. */
const FOCUS_READ_TIMEOUT_MS = 15_000;
/** How long the opened sale stays highlighted. */
const FOCUS_HIGHLIGHT_MS = 4_000;

export function InventorySalesList({
  businessId,
  enabled,
  staffName,
  busy,
  access,
  storeFilter,
  onStoreFilter,
  onVoid,
  focus = null,
  viewerUid,
  staffOptions,
  todayKey,
  onFlash,
  onError,
}: {
  businessId: string;
  enabled: boolean;
  staffName: (id: string) => string;
  busy: boolean;
  access: StoreAccess;
  /** "" = all stores. */
  storeFilter: string;
  onStoreFilter: (storeId: string) => void;
  onVoid: (sale: InventorySale) => void;
  /** The sale a notification asked for, if any. */
  focus?: SaleFocus | null;
  /** The signed-in person: who received a later payment unless someone else is picked. */
  viewerUid: string;
  /** The business's people, for "Received by" and the collector. */
  staffOptions: readonly { id: string; name: string }[];
  /** Today in the shops' zone (what "overdue" is measured against). */
  todayKey: string;
  onFlash: (message: string) => void;
  onError: (message: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const sales = useInventorySales(businessId, enabled && !access.needsHomeStore, access.scopedStoreId);
  const [openId, setOpenId] = useState("");
  const all = useMemo(() => sales.rows.map(inventorySaleFromRow).filter((sale) => sale.id), [sales.rows]);
  const storeNames = useMemo(() => storeNameIndex(access.stores), [access.stores]);
  const narrowed = access.multi && access.canSeeAll && storeFilter !== "";
  const [creditFilter, setCreditFilter] = useState<SaleCreditFilter>("all");
  const list = useMemo(() => {
    const inStore = narrowed ? salesInStore(all, storeFilter, access.stores) : all;
    return creditFilter === "all" ? inStore : inStore.filter((sale) => saleMatchesCreditFilter(sale, creditFilter));
  }, [all, narrowed, storeFilter, access.stores, creditFilter]);
  const nameOfStore = (sale: InventorySale) => sale.storeName || storeNames.get(saleStoreId(sale, access.stores)) || "";

  // The sale a notification asked for.
  const focusRead = useLiveDocRead("inventorySales", focus?.saleId ?? "", enabled && Boolean(focus));
  const focusedSale = useMemo(
    () => (focus && focusRead.row && saleVisibleToViewer(focusRead.row, businessId, access) ? inventorySaleFromRow(focusRead.row) : null),
    [focus, focusRead.row, businessId, access],
  );
  const [timedOutKey, setTimedOutKey] = useState(-1);
  const focusKey = focus?.key ?? -1;
  const focusPending = Boolean(focus) && !focusRead.settled;
  useEffect(() => {
    if (!focusPending) return undefined;
    const timer = window.setTimeout(() => setTimedOutKey(focusKey), FOCUS_READ_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [focusPending, focusKey]);
  const focusUnavailable = Boolean(focus) && !focusedSale && (focusRead.settled || timedOutKey === focusKey);
  // Opened and highlighted when the alert arrives; the highlight fades by itself.
  const [flashId, setFlashId] = useState("");
  useEffect(() => {
    if (!focus) return undefined;
    setOpenId(focus.saleId);
    setFlashId(focus.saleId);
    const timer = window.setTimeout(() => setFlashId(""), FOCUS_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [focus]);
  // Scrolled into view once it has rendered (once per alert).
  const scrolledKey = useRef(-1);
  const focusedId = focusedSale?.id ?? "";
  useEffect(() => {
    if (!focusedId || scrolledKey.current === focusKey) return;
    const row = document.getElementById(`ivt-sale-${focusedId}`);
    if (!row) return;
    scrolledKey.current = focusKey;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusedId, focusKey]);
  // The opened sale leads the list; it is not shown twice.
  const rows = useMemo(
    () => (focusedSale ? [focusedSale, ...list.filter((sale) => sale.id !== focusedSale.id)] : list),
    [focusedSale, list],
  );

  return (
    <>
      {sales.error && <div className="lst-form-error" role="alert">{sales.error}</div>}
      {focusUnavailable && <div className="lst-form-error" role="status">That sale is not available.</div>}
      <p className="panel-lede">Every sale rung up at the counter in the Laawol app. Open one to see what each product was listed at and what it sold for. Voiding a sale puts its stock back and keeps it here, marked.</p>
      <div className="panel-tools">
        <select value={creditFilter} onChange={(e) => setCreditFilter(e.target.value as SaleCreditFilter)} aria-label="Filter sales by credit">
          {SALE_CREDIT_FILTERS.map((id) => (<option key={id} value={id}>{SALE_CREDIT_FILTER_LABELS[id]}</option>))}
        </select>
        {access.multi && access.canSeeAll && (
          <InventoryStoreFilter stores={access.stores} value={storeFilter} onChange={onStoreFilter} />
        )}
      </div>
      {sales.loading && all.length === 0 && !focusedSale ? (
        <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
      ) : all.length === 0 && !focusedSale ? (
        <div className="empty-state">No sales yet. They appear here once staff sell a product in the app.</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          {creditFilter === "all" ? "No sales from this store in the sales loaded so far." : "No sales match this filter in the sales loaded so far."}
          {sales.hasMore && <> <LoadMoreButton hasMore={sales.hasMore} loading={sales.loadingMore} onLoadMore={sales.loadMore} /></>}
        </div>
      ) : (
        <div className="mini-table">
          <div className={`ctn-table ivt-sales-table${access.multi ? " ivt-with-store" : ""}`}>
            <div className="mini-table-head"><span>Sale</span><span>Products</span>{access.multi && <span>Store</span>}<span>Paid with</span><span>Total</span><span aria-hidden="true"></span></div>
            {rows.map((sale) => {
              const open = openId === sale.id;
              const summary = saleLinesSummary(sale);
              const seller = staffName(sale.soldByStaffId);
              const voider = staffName(sale.voidedByStaffId);
              const chip = creditChip(sale, todayKey);
              const receiver = sale.receivedByStaffId !== sale.soldByStaffId ? staffName(sale.receivedByStaffId) : "";
              return (
                <Fragment key={sale.id}>
                  <div
                    id={`ivt-sale-${sale.id}`}
                    className={`mini-table-row ctn-clickable${sale.voided ? " ivt-voided" : ""}${flashId === sale.id ? " ivt-focused" : ""}`}
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
                    {access.multi && (
                      <span><strong data-no-translate>{nameOfStore(sale) || "—"}</strong></span>
                    )}
                    <span>
                      {sale.paidNowCents > 0 || sale.creditCents === 0 ? <strong>{sale.methodLabel}</strong> : <strong>On credit</strong>}
                      {receiver && <small data-no-translate>{receivedByText(receiver, lang)}</small>}
                      {sale.anyCountWasOff && <small className="ctn-wa-warn">Count was off</small>}
                    </span>
                    <span>
                      <strong data-no-translate>{moneyText(sale.totalCents)}</strong>
                      {sale.discountCents > 0 && <small><span>Discount</span> <span data-no-translate>{moneyText(sale.discountCents)}</span></small>}
                      {sale.voided && <span className={statusPillClass("muted")}>Voided</span>}
                      {chip && <span className={`${statusPillClass(CREDIT_CHIP_TONES[chip.status])}${chip.status === "overdue" ? " ivt-overdue-pill" : ""}`} data-no-translate>{creditChipText(chip, lang)}</span>}
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
                      {sale.credit && (
                        <InventoryCreditBlock
                          businessId={businessId}
                          sale={sale}
                          enabled={enabled}
                          access={access}
                          viewerUid={viewerUid}
                          staffName={staffName}
                          staffOptions={staffOptions}
                          todayKey={todayKey}
                          onFlash={onFlash}
                          onError={onError}
                        />
                      )}
                      <table className="ivt-lines">
                        <thead>
                          <tr><th>Product</th><th>Quantity</th><th>List price</th><th>Sold at</th><th>Line total</th></tr>
                        </thead>
                        <tbody>
                          {sale.lines.map((line, index) => (
                            <tr key={`${line.itemId}-${index}`}>
                              <td>
                                <strong data-no-translate>{productDisplayName(line)}</strong>
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
