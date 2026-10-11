"use client";

import { useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Archive, ArchiveRestore, Boxes, Pencil, Plus, RefreshCw, Tag } from "lucide-react";

import { CopyValue } from "@/components/copy-value";
import { InventoryDeleteDialog } from "@/components/business/inventory-delete-dialog";
import { InventoryItemDetail } from "@/components/business/inventory-item-detail";
import { InventoryItemDialog, type CreatedInventoryItem } from "@/components/business/inventory-item-dialog";
import { InventorySalesList } from "@/components/business/inventory-sales-list";
import { InventoryStockDialog } from "@/components/business/inventory-stock-dialog";
import { InventorySummaryCard } from "@/components/business/inventory-summary-card";
import { InventoryTagsDialog } from "@/components/business/inventory-tags-dialog";
import { InventoryVoidDialog } from "@/components/business/inventory-void-dialog";
import { useBusinessStaff, useInventoryItems, useLiveDoc } from "@/lib/business-data";
import { functions } from "@/lib/firebase";
import { currentLanguage } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import {
  INVENTORY_FILTER_LABELS,
  INVENTORY_STATUS_LABELS,
  INVENTORY_STATUS_TONES,
  archiveInventoryItemRequest,
  filterInventoryItems,
  inventoryCounts,
  inventoryItemFromRow,
  inventoryStatus,
  leftText,
  lowAtText,
  productCountText,
  runInventoryCall,
  type InventoryFilter,
  type InventoryItem,
  type InventorySale,
} from "@/lib/inventory";
import { staffNameFrom, staffNameIndex } from "@/lib/staff-names";
import { statusPillClass } from "@/lib/status-pill";
import type { FirestoreRow } from "@/types/admin";

type Modal = "" | "item" | "stock" | "tags" | "delete" | "void";
type View = "products" | "sales";

const FILTERS: InventoryFilter[] = ["all", "low", "countOff", "archived"];

type InventoryPanelProps = {
  businessId: string;
  business?: FirestoreRow | null;
  /** Reads and writes stay off while the business is a preview. */
  previewMode: boolean;
};

/**
 * The shop's inventory: its products and the QR tag on each, the sales staff
 * ring up at the counter in the app, and a summary of both. Staff sell in the
 * app; the console is where products are set up, stock is counted, tags are
 * printed and a mistaken sale is voided. Every change is a callable and
 * records who made it; nothing here writes to Firestore.
 */
export function InventoryPanel({ businessId, previewMode }: InventoryPanelProps) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const enabled = Boolean(businessId && !previewMode);

  const [view, setView] = useState<View>("products");
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [modal, setModal] = useState<Modal>("");
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [tagsFor, setTagsFor] = useState<{ id: string; name: string; code: string } | null>(null);
  const [voidSale, setVoidSale] = useState<InventorySale | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const [flashError, setFlashError] = useState("");
  // Bumped when a sale is voided or a count changes, so the summary is asked again.
  const [summaryKey, setSummaryKey] = useState(0);

  const onSale = useInventoryItems(businessId, false, enabled);
  const archived = useInventoryItems(businessId, true, enabled && filter === "archived");
  const staff = useBusinessStaff(businessId, enabled);
  const selectedRow = useLiveDoc("inventoryItems", selectedId, enabled && Boolean(selectedId));
  const selected = selectedRow ? inventoryItemFromRow(selectedRow) : null;

  const staffNames = useMemo(() => staffNameIndex(staff.rows), [staff.rows]);
  const staffName = (id: string) => staffNameFrom(staffNames, id);

  const source = filter === "archived" ? archived : onSale;
  const shown = useMemo(() => filterInventoryItems(source.rows, filter, search), [source.rows, filter, search]);
  const counts = useMemo(() => inventoryCounts(onSale.rows), [onSale.rows]);
  const searching = search.trim().length > 0;

  function closeModal() {
    setModal("");
    setEditing(null);
    setTagsFor(null);
    setVoidSale(null);
  }

  function say(message: string) {
    setFlashError("");
    setFlash(message);
    // A count or a sale changed: the summary's low-stock and count-was-off lists may have.
    setSummaryKey((n) => n + 1);
  }

  function openNew() {
    setEditing(null);
    setModal("item");
  }

  function openEdit(item: InventoryItem) {
    setEditing(item);
    setModal("item");
  }

  function openStock(item: InventoryItem) {
    setEditing(item);
    setModal("stock");
  }

  function openTags(item: { id: string; name: string; code: string }) {
    setTagsFor({ id: item.id, name: item.name, code: item.code });
    setModal("tags");
  }

  function created(product: CreatedInventoryItem, printTags: boolean) {
    closeModal();
    if (printTags && product.id) {
      setTagsFor(product);
      setModal("tags");
    }
  }

  async function toggleArchive(item: InventoryItem) {
    setFlash("");
    setFlashError("");
    const next = !item.archived;
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "archiveInventoryItem")(archiveInventoryItemRequest(businessId, item.id, next));
      say(next ? "Product archived. It is hidden from selling and its history is kept." : "Product is back on sale.");
    }, (failure) => setFlashError(failure.message));
  }

  function openFromSummary(itemId: string) {
    if (!itemId) return;
    setView("products");
    setSelectedId(itemId);
  }

  const tabs = (
    <div className="service-segments" role="tablist" aria-label="Inventory lists">
      {([["products", "Products", counts.onSale], ["sales", "Sales", null]] as [View, string, number | null][]).map(([id, label, count]) => (
        <span
          key={id}
          role="button"
          tabIndex={0}
          className={`segment ${view === id ? "active" : ""}`}
          aria-pressed={view === id}
          onClick={() => { setView(id); setSelectedId(""); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setView(id); setSelectedId(""); } }}
        >
          {label}{count !== null && <b data-no-translate>{count}</b>}
        </span>
      ))}
    </div>
  );

  const loadError = onSale.error || (filter === "archived" ? archived.error : "");

  return (
    <div className="ctn-panel ivt-panel">
      {flash && (
        <div className="lst-form-error" role="status" style={{ background: "var(--mist)", color: "var(--brand-strong)" }}>
          {flash} <button className="ghost-button" type="button" onClick={() => setFlash("")}>Dismiss</button>
        </div>
      )}
      {flashError && (
        <div className="lst-form-error" role="alert">
          {flashError} <button className="ghost-button" type="button" onClick={() => setFlashError("")}>Dismiss</button>
        </div>
      )}
      {loadError && <div className="lst-form-error" role="alert">{loadError}</div>}

      {selectedId && selected ? (
        <InventoryItemDetail
          businessId={businessId}
          item={selected}
          enabled={enabled}
          busy={busy}
          staffName={staffName}
          onBack={() => setSelectedId("")}
          onEdit={() => openEdit(selected)}
          onStock={() => openStock(selected)}
          onTags={() => openTags(selected)}
          onArchive={() => void toggleArchive(selected)}
          onDelete={() => { setEditing(selected); setModal("delete"); }}
        />
      ) : selectedId && selectedRow === null ? (
        <article className="panel">
          <div className="panel-header">
            <div><button className="ghost-button" type="button" onClick={() => setSelectedId("")}>All products</button></div>
          </div>
          <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
        </article>
      ) : (
        <>
          <article className="panel">
            <div className="panel-header">
              <div><Boxes size={18} /><h2>Inventory</h2></div>
              <span className="panel-action">
                <button className="lst-add" type="button" disabled={busy || !enabled} onClick={openNew}><Plus size={16} /> New product</button>
              </span>
            </div>
            <InventorySummaryCard
              businessId={businessId}
              enabled={enabled}
              reloadKey={summaryKey}
              onOpenItem={openFromSummary}
            />
          </article>

          <article className="panel">
            {tabs}
            {view === "sales" ? (
              <InventorySalesList
                businessId={businessId}
                enabled={enabled}
                staffName={staffName}
                busy={busy}
                onVoid={(sale) => { setVoidSale(sale); setModal("void"); }}
              />
            ) : (
              <>
                <div className="panel-tools">
                  <select value={filter} onChange={(e) => setFilter(e.target.value as InventoryFilter)} aria-label="Filter products">
                    {FILTERS.map((id) => (
                      <option key={id} value={id}>
                        {INVENTORY_FILTER_LABELS[id]}
                        {id === "low" && counts.low > 0 ? ` (${counts.low})` : ""}
                        {id === "countOff" && counts.countOff > 0 ? ` (${counts.countOff})` : ""}
                      </option>
                    ))}
                  </select>
                  <input type="search" placeholder="Name, category or code" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
                </div>
                <p className="panel-lede">The products you sell. Each has one tag: staff scan it in the Laawol app to sell it at the counter, and the count goes down with every sale.</p>

                {source.loading && source.rows.length === 0 ? (
                  <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
                ) : source.rows.length === 0 && filter === "all" ? (
                  <div className="empty-state">No products yet. Add your first product, then print its tag.</div>
                ) : shown.length === 0 ? (
                  <div className="empty-state">
                    {searching ? "No product matches that search."
                      : filter === "low" ? "Nothing is running low."
                      : filter === "countOff" ? "No product has a count that was off."
                      : filter === "archived" ? "No archived products."
                      : "No products."}
                  </div>
                ) : (
                  <div className="mini-table">
                    <div className="ctn-table ivt-products-table">
                      <div className="mini-table-head"><span>Product</span><span>Price</span><span>In stock</span><span aria-hidden="true"></span></div>
                      {shown.map((item) => {
                        const status = inventoryStatus(item);
                        return (
                          <div
                            className="mini-table-row ctn-clickable"
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedId(item.id)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(item.id); } }}
                          >
                            <span>
                              <strong data-no-translate>{item.name}</strong>
                              {item.category && <small data-no-translate>{item.category}</small>}
                              <small className="ctn-code-row">
                                <code className="ctn-code" data-no-translate>{item.code}</code>
                                <CopyValue value={item.code} label="Copy code" />
                              </small>
                            </span>
                            <span>
                              <strong data-no-translate>{moneyText(item.priceCents)}</strong>
                              {item.costCents !== null && <small><span>Cost</span> <span data-no-translate>{moneyText(item.costCents)}</span></small>}
                            </span>
                            <span>
                              <strong data-no-translate>{leftText(item.quantity, lang)}</strong>
                              {item.lowStockAt !== null && <small data-no-translate>{lowAtText(item.lowStockAt, lang)}</small>}
                              {status !== "ok" && <span className={statusPillClass(INVENTORY_STATUS_TONES[status])}>{INVENTORY_STATUS_LABELS[status]}</span>}
                              {item.countWasOff && <span className={statusPillClass("warn")}>Count was off</span>}
                            </span>
                            <span className="ctn-row-actions">
                              <button className="ghost-button" type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); openTags(item); }} title="Print tags" aria-label="Print tags"><Tag size={14} /></button>
                              {!item.archived && (
                                <button className="ghost-button" type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); openStock(item); }} title="Add stock or set the count" aria-label="Add stock or set the count"><Boxes size={14} /></button>
                              )}
                              <button className="ghost-button" type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); openEdit(item); }} title="Edit product" aria-label="Edit product"><Pencil size={14} /></button>
                              <button className="ghost-button" type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); void toggleArchive(item); }} title={item.archived ? "Unarchive" : "Archive"} aria-label={item.archived ? "Unarchive" : "Archive"}>
                                {item.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                              </button>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {source.rows.length > 0 && <p className="lst-hint wpk-total" data-no-translate>{productCountText(shown.length, lang)}</p>}
              </>
            )}
          </article>
        </>
      )}

      {modal === "item" && (
        <InventoryItemDialog
          businessId={businessId}
          item={editing}
          onClose={closeModal}
          onFlash={say}
          onCreated={created}
        />
      )}
      {modal === "stock" && editing && (
        <InventoryStockDialog businessId={businessId} item={editing} onClose={closeModal} onFlash={say} />
      )}
      {modal === "tags" && tagsFor && (
        <InventoryTagsDialog businessId={businessId} item={tagsFor} onClose={closeModal} />
      )}
      {modal === "delete" && editing && (
        <InventoryDeleteDialog
          businessId={businessId}
          item={editing}
          onClose={closeModal}
          onFlash={say}
          onDeleted={() => { closeModal(); setSelectedId(""); }}
        />
      )}
      {modal === "void" && voidSale && (
        <InventoryVoidDialog
          businessId={businessId}
          sale={voidSale}
          onClose={closeModal}
          onFlash={say}
          onVoided={() => setSummaryKey((n) => n + 1)}
        />
      )}
    </div>
  );
}
