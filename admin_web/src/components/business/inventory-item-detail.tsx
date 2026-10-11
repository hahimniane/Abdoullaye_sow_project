"use client";

import { useMemo } from "react";
import { ArrowLeft, Archive, ArchiveRestore, Boxes, Pencil, RefreshCw, Tag, Trash2 } from "lucide-react";

import { LoadMoreButton } from "@/components/show-more";
import { CopyValue } from "@/components/copy-value";
import { useInventoryMovements } from "@/lib/business-data";
import { currentLanguage, formatDateTime } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import {
  INVENTORY_STATUS_LABELS,
  INVENTORY_STATUS_TONES,
  inventoryMovementEntries,
  inventoryStatus,
  inventoryTagUrl,
  leftText,
  type InventoryItem,
} from "@/lib/inventory";
import { statusPillClass } from "@/lib/status-pill";

/**
 * One product: what it is, what is left, and the stock history - every change
 * to its count with who made it. The actions are the product's own (edit, add
 * stock, tags, archive, delete); the panel owns the dialogs they open.
 */
export function InventoryItemDetail({
  businessId,
  item,
  enabled,
  busy,
  staffName,
  onBack,
  onEdit,
  onStock,
  onTags,
  onArchive,
  onDelete,
}: {
  businessId: string;
  item: InventoryItem;
  enabled: boolean;
  busy: boolean;
  staffName: (id: string) => string;
  onBack: () => void;
  onEdit: () => void;
  onStock: () => void;
  onTags: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const movements = useInventoryMovements(businessId, item.id, enabled);
  const entries = useMemo(() => inventoryMovementEntries(movements.rows), [movements.rows]);
  const status = inventoryStatus(item);
  const creator = staffName(item.createdByStaffId);

  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <button className="ghost-button" type="button" onClick={onBack}><ArrowLeft size={14} /> All products</button>
        </div>
        <span className="panel-action">
          <span className={statusPillClass(INVENTORY_STATUS_TONES[status])}>{INVENTORY_STATUS_LABELS[status]}</span>
          {item.countWasOff && <span className={statusPillClass("warn")}>Count was off</span>}
        </span>
      </div>
      <div className="ctn-detail">
        <div className="ctn-detail-head">
          <div>
            <h2 data-no-translate>{item.name}</h2>
            {item.category && <p className="panel-lede" data-no-translate>{item.category}</p>}
          </div>
          <div className="ctn-detail-actions">
            <button className="lst-btn ghost" type="button" disabled={busy} onClick={onEdit}><Pencil size={14} /> Edit</button>
            <button className="lst-btn" type="button" disabled={busy || item.archived} onClick={onStock}><Boxes size={14} /> Add stock / set count</button>
            <button className="lst-btn ghost" type="button" disabled={busy} onClick={onTags}><Tag size={14} /> Print tags</button>
            <button className="lst-btn ghost" type="button" disabled={busy} onClick={onArchive}>
              {item.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />} {item.archived ? "Unarchive" : "Archive"}
            </button>
            <button className="lst-btn ghost danger" type="button" disabled={busy} onClick={onDelete}><Trash2 size={14} /> Delete</button>
          </div>
        </div>
        {item.countWasOff && (
          <p className="ctn-notes">A sale was rung up for more than the count showed, so the count went to 0. Count the shelf and set the real number to clear this mark.</p>
        )}
        <div className="pk-scoreboard" role="group" aria-label="Product figures">
          <div className="pk-stat"><span>In stock</span><b data-no-translate>{item.quantity}</b>
            <small>{item.lowStockAt !== null ? <><span>Low at</span> <span data-no-translate>{item.lowStockAt}</span></> : <span>Low only at 0</span>}</small>
          </div>
          <div className="pk-stat"><span>Price</span><b data-no-translate>{moneyText(item.priceCents)}</b>
            <small>{item.costCents !== null ? <><span>Cost</span> <span data-no-translate>{moneyText(item.costCents)}</span></> : <span>No cost entered</span>}</small>
          </div>
          <div className="pk-stat"><span>Tag code</span>
            <b className="ivt-code"><code className="ctn-code" data-no-translate>{item.code}</code><CopyValue value={item.code} label="Copy code" /></b>
            <small className="ivt-tagurl" data-no-translate>{inventoryTagUrl(item.code)}</small>
          </div>
        </div>
        <div className="pur-info ctn-info">
          <div><span>Added</span><b data-no-translate>{formatDateTime(item.createdAt)}</b>{creator && <small data-no-translate>{creator}</small>}</div>
          <div><span>Last changed</span><b data-no-translate>{formatDateTime(item.updatedAt)}</b></div>
          {item.photoUrl && (
            <div><span>Photo</span><b><a href={item.photoUrl} target="_blank" rel="noopener noreferrer" data-no-translate>{item.photoUrl}</a></b></div>
          )}
        </div>
      </div>

      <div className="panel-header">
        <div><h3>Stock history</h3><span className="panel-count">{entries.length}</span></div>
      </div>
      {movements.error && <div className="lst-form-error" role="alert">{movements.error}</div>}
      {movements.loading && entries.length === 0 ? (
        <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
      ) : entries.length === 0 ? (
        <div className="empty-state">No changes to the count yet.</div>
      ) : (
        <div className="mini-table">
          <div className="ctn-table ivt-history-table">
            <div className="mini-table-head"><span>What happened</span><span>Change</span><span>Count after</span><span>By</span></div>
            {entries.map((entry) => {
              const who = staffName(entry.byStaffId);
              return (
                <div className="mini-table-row" key={entry.id}>
                  <span>
                    <strong>{entry.label}</strong>
                    <small data-no-translate>{formatDateTime(entry.at)}</small>
                    {entry.note && <small data-no-translate>{entry.note}</small>}
                  </span>
                  <span><strong data-no-translate className={entry.delta < 0 ? "ivt-neg" : entry.delta > 0 ? "ivt-pos" : undefined}>{entry.deltaText}</strong></span>
                  <span><strong data-no-translate>{leftText(entry.quantityAfter, lang)}</strong></span>
                  <span>{who ? <strong data-no-translate>{who}</strong> : <small>—</small>}</span>
                </div>
              );
            })}
          </div>
          <LoadMoreButton hasMore={movements.hasMore} loading={movements.loadingMore} onLoadMore={movements.loadMore} />
        </div>
      )}
    </article>
  );
}
