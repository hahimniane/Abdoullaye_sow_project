"use client";

import { Fragment, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";

import { InventoryStoreFilter } from "@/components/business/inventory-store-filter";
import { useInventoryOpenCredit } from "@/lib/business-data";
import { currentLanguage, formatDateTime } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import type { StoreAccess } from "@/lib/inventory";
import {
  CREDIT_GROUP_LABELS,
  creditSalesCountText,
  customerCountText,
  dueDateText,
  filterOpenCredit,
  groupOpenCredit,
  openCreditRows,
  openCreditTotals,
  overdueDaysText,
  paidOfText,
  type CreditGroupBy,
} from "@/lib/inventory-credit";

const GROUPS: CreditGroupBy[] = ["none", "customer", "collector", "store"];

/**
 * Credit owed: every sale that still owes money, oldest due first (no due
 * date last, oldest sale first), overdue ones highlighted. Filter by
 * collector, store, overdue only, or a customer's name or phone; group by
 * customer, collector or store with a total per group. A row opens its sale
 * on the Sales tab, where payments are recorded.
 *
 * Read whole (`creditStatus == "open"`): staff of one store read their
 * store's only; whoever sees every store gets the store filter.
 */
export function InventoryCreditList({
  businessId,
  enabled,
  access,
  storeFilter,
  onStoreFilter,
  staffName,
  staffOptions,
  todayKey,
  onOpenSale,
}: {
  businessId: string;
  enabled: boolean;
  access: StoreAccess;
  storeFilter: string;
  onStoreFilter: (storeId: string) => void;
  staffName: (id: string) => string;
  staffOptions: readonly { id: string; name: string }[];
  todayKey: string;
  onOpenSale: (saleId: string, storeId: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const read = useInventoryOpenCredit(businessId, enabled && !access.needsHomeStore, access.scopedStoreId);
  const [groupBy, setGroupBy] = useState<CreditGroupBy>("none");
  const [collector, setCollector] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const all = useMemo(() => openCreditRows(read.rows, { stores: access.multi ? access.stores : [], todayKey }), [read.rows, access.multi, access.stores, todayKey]);
  const storeId = access.multi && access.canSeeAll ? storeFilter : "";
  const shown = useMemo(
    () => filterOpenCredit(all, { collectorStaffId: collector, storeId, overdueOnly, search }),
    [all, collector, storeId, overdueOnly, search],
  );
  const totals = useMemo(() => openCreditTotals(shown), [shown]);
  const groups = useMemo(() => groupOpenCredit(shown, groupBy, staffName), [shown, groupBy, staffName]);
  // Collectors in the list who are not in the team list (someone who left) can still be picked.
  const collectorOptions = useMemo(() => {
    const known = new Map(staffOptions.map((s) => [s.id, s.name]));
    for (const row of all) if (row.collectorStaffId && !known.has(row.collectorStaffId)) known.set(row.collectorStaffId, row.collectorStaffId);
    return [...known.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [all, staffOptions]);
  const groupChoices = access.multi ? GROUPS : GROUPS.filter((id) => id !== "store");

  return (
    <>
      {read.error && <div className="lst-form-error" role="alert">{read.error}</div>}
      <p className="panel-lede">Sales the customer has not finished paying, oldest due date first. Open one to record a payment or change who collects it.</p>
      <div className="pk-scoreboard" role="group" aria-label="Credit totals">
        <div className="pk-stat"><span>Still owed</span><b data-no-translate>{moneyText(totals.remainingCents)}</b><small data-no-translate>{creditSalesCountText(totals.count, lang)} · {customerCountText(totals.customers, lang)}</small></div>
        <div className="pk-stat"><span>Overdue</span><b data-no-translate className={totals.overdueCents > 0 ? "owed" : ""}>{moneyText(totals.overdueCents)}</b><small data-no-translate>{creditSalesCountText(totals.overdueCount, lang)}</small></div>
      </div>
      <div className="panel-tools">
        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as CreditGroupBy)} aria-label="Group credit">
          {groupChoices.map((id) => (<option key={id} value={id}>{CREDIT_GROUP_LABELS[id]}</option>))}
        </select>
        <select value={collector} onChange={(e) => setCollector(e.target.value)} aria-label="Filter by collector">
          <option value="">Every collector</option>
          {collectorOptions.map((s) => (<option key={s.id} value={s.id} data-no-translate>{s.name}</option>))}
        </select>
        {access.multi && access.canSeeAll && (
          <InventoryStoreFilter stores={access.stores} value={storeFilter} onChange={onStoreFilter} />
        )}
        <label className="ctn-notify">
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          <span>Overdue only</span>
        </label>
        <input type="search" placeholder="Customer name or phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search credit" />
      </div>
      {read.loading && all.length === 0 ? (
        <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
      ) : all.length === 0 ? (
        <div className="empty-state">Nobody owes the shop anything. Sales on credit appear here until they are paid.</div>
      ) : shown.length === 0 ? (
        <div className="empty-state">No credit matches this filter.</div>
      ) : (
        <div className="mini-table">
          <div className={`ctn-table ivt-credit-table${access.multi ? " ivt-with-store" : ""}`}>
            <div className="mini-table-head"><span>Customer</span><span>Due</span><span>Collected by</span>{access.multi && <span>Store</span>}<span>Owed</span></div>
            {groups.map((group) => (
              <Fragment key={group.key}>
                {groupBy !== "none" && (
                  <div className="ivt-credit-group" role="presentation">
                    <strong data-no-translate>{group.label || "—"}</strong>
                    {group.detail && <small data-no-translate>{group.detail}</small>}
                    <b data-no-translate>{moneyText(group.totals.remainingCents)}</b>
                    <small data-no-translate>{creditSalesCountText(group.totals.count, lang)}</small>
                  </div>
                )}
                {group.rows.map((row) => (
                  <div
                    className={`mini-table-row ctn-clickable${row.overdue ? " ivt-overdue-row" : ""}`}
                    key={row.saleId}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenSale(row.saleId, row.storeId)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenSale(row.saleId, row.storeId); } }}
                  >
                    <span>
                      <strong data-no-translate>{row.customerName || "—"}</strong>
                      {row.customerPhone && <small data-no-translate>{row.customerPhone}</small>}
                    </span>
                    <span>
                      <strong data-no-translate className={row.overdue ? "ivt-overdue" : undefined}>{dueDateText(row.dueDate, lang)}</strong>
                      {row.overdue ? <small data-no-translate className="ivt-overdue">{overdueDaysText(row.daysOverdue, lang)}</small>
                        : <small data-no-translate>{formatDateTime(row.sale.createdAt)}</small>}
                    </span>
                    <span><strong data-no-translate>{staffName(row.collectorStaffId) || "—"}</strong></span>
                    {access.multi && <span><strong data-no-translate>{row.storeName || "—"}</strong></span>}
                    <span>
                      <strong data-no-translate>{moneyText(row.remainingCents)}</strong>
                      <small data-no-translate>{paidOfText(row.paidCents, row.creditCents, lang)}</small>
                    </span>
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
