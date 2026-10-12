"use client";

import { useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Archive, ArchiveRestore, ArrowRightLeft, BadgeCheck, Boxes, Pencil, Plus, RefreshCw, Store, Tag, Tags } from "lucide-react";

import { CopyValue } from "@/components/copy-value";
import { InventoryBrandsDialog } from "@/components/business/inventory-brands-dialog";
import { InventoryCategoriesDialog } from "@/components/business/inventory-categories-dialog";
import { InventoryDeleteDialog } from "@/components/business/inventory-delete-dialog";
import { InventoryItemDetail } from "@/components/business/inventory-item-detail";
import { InventoryItemDialog, type CreatedInventoryItem } from "@/components/business/inventory-item-dialog";
import { InventorySalesList } from "@/components/business/inventory-sales-list";
import { InventoryStockDialog } from "@/components/business/inventory-stock-dialog";
import { InventoryStoreFilter } from "@/components/business/inventory-store-filter";
import { InventoryStoresDialog } from "@/components/business/inventory-stores-dialog";
import { InventorySummaryCard } from "@/components/business/inventory-summary-card";
import { InventoryTagsDialog } from "@/components/business/inventory-tags-dialog";
import { InventoryTransferDialog } from "@/components/business/inventory-transfer-dialog";
import { InventoryVoidDialog } from "@/components/business/inventory-void-dialog";
import {
  useBusinessStaff,
  useInventoryBrands,
  useInventoryCategories,
  useInventoryItems,
  useInventoryStock,
  useInventoryStores,
  useLiveDoc,
} from "@/lib/business-data";
import { functions } from "@/lib/firebase";
import { currentLanguage } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import {
  INVENTORY_FILTER_LABELS,
  INVENTORY_STATUS_LABELS,
  INVENTORY_STATUS_TONES,
  NO_BRAND_FILTER,
  UNCATEGORIZED_FILTER,
  archiveInventoryItemRequest,
  archivedNameText,
  brandResolver,
  buildStockIndex,
  categoryResolver,
  filterInventoryItems,
  inventoryBrands,
  inventoryCategories,
  inventoryCounts,
  inventoryItemFromRow,
  inventoryStores,
  itemStockView,
  leftText,
  lowAtText,
  lowInStoresText,
  productCountText,
  productDisplayName,
  resolveStoreAccess,
  runInventoryCall,
  withCurrentBrand,
  type InventoryFilter,
  type InventoryItem,
  type InventoryListScope,
  type InventorySale,
  type InventoryViewer,
} from "@/lib/inventory";
import { staffNameFrom, staffNameIndex } from "@/lib/staff-names";
import { statusPillClass } from "@/lib/status-pill";
import type { FirestoreRow } from "@/types/admin";

type Modal = "" | "item" | "stock" | "tags" | "delete" | "void" | "categories" | "brands" | "stores" | "transfer";
type View = "products" | "sales";

const FILTERS: InventoryFilter[] = ["all", "low", "countOff", "archived"];

type InventoryPanelProps = {
  businessId: string;
  business?: FirestoreRow | null;
  /** Reads and writes stay off while the business is a preview. */
  previewMode: boolean;
  /** Who is looking: the owner, or staff with a home store (and maybe all stores). */
  viewer: InventoryViewer;
};

/**
 * The shop's inventory: its products and the QR tag on each, the sales staff
 * ring up at the counter in the app, and a summary of both. Staff sell in the
 * app; the console is where products are set up, stock is counted, tags are
 * printed and a mistaken sale is voided. Every change is a callable and
 * records who made it; nothing here writes to Firestore.
 *
 * A business with one store (or none) sees exactly the screens it always
 * had. With two or more stores stock is counted per store: the lists gain a
 * store filter and per-store counts, and the owner (and staff who work in all
 * stores) can move stock between stores. Staff who work in one store see only
 * that store everywhere, with no filter. The owner alone manages the stores.
 */
export function InventoryPanel({ businessId, previewMode, viewer }: InventoryPanelProps) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const enabled = Boolean(businessId && !previewMode);

  const [view, setView] = useState<View>("products");
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [categoryFilterRaw, setCategoryFilter] = useState("");
  const [brandFilterRaw, setBrandFilter] = useState("");
  const [storeFilterRaw, setStoreFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [modal, setModal] = useState<Modal>("");
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [transferItemId, setTransferItemId] = useState("");
  const [tagsFor, setTagsFor] = useState<{ id: string; name: string; code: string } | null>(null);
  const [voidSale, setVoidSale] = useState<InventorySale | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const [flashError, setFlashError] = useState("");
  // Bumped when a sale is voided or a count changes, so the summary is asked again.
  const [summaryKey, setSummaryKey] = useState(0);

  const storesRead = useInventoryStores(businessId, enabled);
  const categoriesRead = useInventoryCategories(businessId, enabled);
  const brandsRead = useInventoryBrands(businessId, enabled);
  const { isOwner, homeStoreId, allStores } = viewer;
  const access = useMemo(
    () => resolveStoreAccess({ isOwner, homeStoreId, allStores }, storesRead.rows),
    [isOwner, homeStoreId, allStores, storesRead.rows],
  );
  const everyStore = useMemo(() => inventoryStores(storesRead.rows, true), [storesRead.rows]);
  const categories = useMemo(() => inventoryCategories(categoriesRead.rows, true), [categoriesRead.rows]);
  // A list that could not be read is no list: the form falls back to a typed category and the category tools hide.
  const categoriesAvailable = !categoriesRead.error;
  const resolveCategory = useMemo(() => categoryResolver(categories), [categories]);
  const brands = useMemo(() => inventoryBrands(brandsRead.rows, true), [brandsRead.rows]);
  // Same for brands: a list that could not be read leaves the brand tools out and the form takes a typed brand.
  const brandsAvailable = !brandsRead.error;
  const resolveBrand = useMemo(() => brandResolver(brands), [brands]);

  // The store the lists are looking at: the chosen one for whoever sees all, the home store for the rest, none for one store.
  const storeFilter = access.multi && access.canSeeAll && access.stores.some((store) => store.id === storeFilterRaw) ? storeFilterRaw : "";
  const scopeStoreId = access.multi ? (access.canSeeAll ? storeFilter : access.scopedStoreId) : "";
  const categoryFilter = categoryFilterRaw === "" || categoryFilterRaw === UNCATEGORIZED_FILTER || categories.some((category) => category.id === categoryFilterRaw)
    ? categoryFilterRaw
    : "";
  const brandFilter = brandFilterRaw === "" || brandFilterRaw === NO_BRAND_FILTER || brands.some((brand) => brand.id === brandFilterRaw)
    ? brandFilterRaw
    : "";

  const stockRead = useInventoryStock(businessId, enabled && access.multi && !access.needsHomeStore, access.scopedStoreId);
  const stockIndex = useMemo(() => buildStockIndex(stockRead.rows), [stockRead.rows]);
  const scope = useMemo<InventoryListScope>(() => ({
    categories,
    categoryId: categoryFilter,
    brands,
    brandId: brandFilter,
    stores: access.multi ? access.stores : undefined,
    storeId: scopeStoreId,
    stock: stockIndex,
  }), [categories, categoryFilter, brands, brandFilter, access.multi, access.stores, scopeStoreId, stockIndex]);
  const countsScope = useMemo<InventoryListScope>(() => ({ ...scope, categoryId: "", brandId: "" }), [scope]);

  const onSale = useInventoryItems(businessId, false, enabled);
  const archived = useInventoryItems(businessId, true, enabled && filter === "archived");
  const staff = useBusinessStaff(businessId, enabled);
  const selectedRow = useLiveDoc("inventoryItems", selectedId, enabled && Boolean(selectedId));
  const selected = selectedRow ? withCurrentBrand(inventoryItemFromRow(selectedRow), resolveBrand) : null;

  const staffNames = useMemo(() => staffNameIndex(staff.rows), [staff.rows]);
  const staffName = (id: string) => staffNameFrom(staffNames, id);

  const source = filter === "archived" ? archived : onSale;
  const shown = useMemo(() => filterInventoryItems(source.rows, filter, search, scope), [source.rows, filter, search, scope]);
  const counts = useMemo(() => inventoryCounts(onSale.rows, countsScope), [onSale.rows, countsScope]);
  const onSaleItems = useMemo(
    () => onSale.rows.map(inventoryItemFromRow).filter((item) => item.id).map((item) => withCurrentBrand(item, resolveBrand)),
    [onSale.rows, resolveBrand],
  );
  // The brand each product wears now, for the summary's lists (the server's rows carry the name alone).
  const brandByItem = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of onSaleItems) if (item.brand) map.set(item.id, item.brand);
    return map;
  }, [onSaleItems]);
  const searching = search.trim().length > 0;
  const blocked = busy || !enabled || access.needsHomeStore;

  function closeModal() {
    setModal("");
    setEditing(null);
    setTagsFor(null);
    setVoidSale(null);
    setTransferItemId("");
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

  function openTransfer(itemId: string) {
    setTransferItemId(itemId);
    setModal("transfer");
  }

  function openTags(item: { id: string; name: string; brand?: string; code: string }) {
    setTagsFor({ id: item.id, name: productDisplayName(item), code: item.code });
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

  // The reads that matter to everyone report their failure; the v2 ones (categories, stores) quietly leave the v1 screens.
  const loadError = onSale.error || (filter === "archived" ? archived.error : "") || (access.multi ? stockRead.error : "");

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
          categories={categories}
          access={access}
          stock={stockIndex}
          onBack={() => setSelectedId("")}
          onEdit={() => openEdit(selected)}
          onStock={() => openStock(selected)}
          onTransfer={() => openTransfer(selected.id)}
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
              <span className="panel-action ivt-actions">
                {categoriesAvailable && (
                  <button className="lst-btn ghost" type="button" disabled={blocked} onClick={() => setModal("categories")}><Tags size={16} /> Categories</button>
                )}
                {brandsAvailable && (
                  <button className="lst-btn ghost" type="button" disabled={blocked} onClick={() => setModal("brands")}><BadgeCheck size={16} /> Brands</button>
                )}
                {access.canManageStores && (
                  <button className="lst-btn ghost" type="button" disabled={busy || !enabled} onClick={() => setModal("stores")}><Store size={16} /> Stores</button>
                )}
                {access.canTransfer && (
                  <button className="lst-btn ghost" type="button" disabled={blocked} onClick={() => openTransfer("")}><ArrowRightLeft size={16} /> Move stock</button>
                )}
                <button className="lst-add" type="button" disabled={blocked} onClick={openNew}><Plus size={16} /> New product</button>
              </span>
            </div>
            {!access.needsHomeStore && (
              <InventorySummaryCard
                businessId={businessId}
                enabled={enabled}
                reloadKey={summaryKey}
                access={access}
                storeFilter={storeFilter}
                onStoreFilter={setStoreFilter}
                onOpenItem={openFromSummary}
                brandByItem={brandByItem}
              />
            )}
          </article>

          {access.needsHomeStore ? (
            <article className="panel">
              <div className="empty-state">You have no home store yet. Ask the owner to assign one in People, then the products and sales of your store appear here.</div>
            </article>
          ) : (
            <article className="panel">
              {tabs}
              {view === "sales" ? (
                <InventorySalesList
                  businessId={businessId}
                  enabled={enabled}
                  staffName={staffName}
                  busy={busy}
                  access={access}
                  storeFilter={storeFilter}
                  onStoreFilter={setStoreFilter}
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
                    {categoriesAvailable && categories.length > 0 && (
                      <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter by category">
                        <option value="">All categories</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id} data-no-translate>{category.archived ? archivedNameText(category.name, lang, true) : category.name}</option>
                        ))}
                        <option value={UNCATEGORIZED_FILTER}>Uncategorized</option>
                      </select>
                    )}
                    {brandsAvailable && brands.length > 0 && (
                      <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} aria-label="Filter by brand">
                        <option value="">All brands</option>
                        {brands.map((brand) => (
                          <option key={brand.id} value={brand.id} data-no-translate>{brand.archived ? archivedNameText(brand.name, lang, true) : brand.name}</option>
                        ))}
                        <option value={NO_BRAND_FILTER}>No brand</option>
                      </select>
                    )}
                    {access.multi && access.canSeeAll && (
                      <InventoryStoreFilter stores={access.stores} value={storeFilter} onChange={setStoreFilter} />
                    )}
                    <input type="search" placeholder="Brand, name, category or code" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
                  </div>
                  <p className="panel-lede">The products you sell. Each has one tag: staff scan it in the Laawol app to sell it at the counter, and the count goes down with every sale.</p>

                  {source.loading && source.rows.length === 0 ? (
                    <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
                  ) : source.rows.length === 0 && filter === "all" ? (
                    <div className="empty-state">No products yet. Add your first product, then print its tag.</div>
                  ) : shown.length === 0 ? (
                    <div className="empty-state">
                      {searching || categoryFilter || brandFilter ? "No product matches that search."
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
                          const stock = itemStockView(item, scope);
                          const status = stock.status;
                          const categoryName = resolveCategory(item)?.name ?? item.category;
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
                                <strong data-no-translate>{productDisplayName(item)}</strong>
                                {categoryName && <small data-no-translate>{categoryName}</small>}
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
                                <strong data-no-translate>{leftText(stock.multi ? stock.shown : item.quantity, lang)}</strong>
                                {stock.multi && scopeStoreId && stock.cells[0] && <small data-no-translate>{stock.cells[0].storeName}</small>}
                                {stock.multi && !scopeStoreId && stock.cells.length > 0 && (
                                  <small data-no-translate>{stock.cells.map((cell) => `${cell.storeName} ${cell.quantity}`).join(" · ")}</small>
                                )}
                                {item.lowStockAt !== null && <small data-no-translate>{lowAtText(item.lowStockAt, lang)}</small>}
                                {status !== "ok" && <span className={statusPillClass(INVENTORY_STATUS_TONES[status])}>{INVENTORY_STATUS_LABELS[status]}</span>}
                                {stock.multi && !scopeStoreId && stock.lowStoreNames.length > 0 && (
                                  <small className="ctn-wa-warn" data-no-translate>{lowInStoresText(stock.lowStoreNames, lang)}</small>
                                )}
                                {stock.countWasOff && <span className={statusPillClass("warn")}>Count was off</span>}
                              </span>
                              <span className="ctn-row-actions">
                                <button className="ghost-button" type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); openTags(item); }} title="Print tags" aria-label="Print tags"><Tag size={14} /></button>
                                {!item.archived && (
                                  <button className="ghost-button" type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); openStock(item); }} title="Add stock or set the count" aria-label="Add stock or set the count"><Boxes size={14} /></button>
                                )}
                                {!item.archived && access.canTransfer && (
                                  <button className="ghost-button" type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); openTransfer(item.id); }} title="Move stock between stores" aria-label="Move stock between stores"><ArrowRightLeft size={14} /></button>
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
          )}
        </>
      )}

      {modal === "item" && (
        <InventoryItemDialog
          businessId={businessId}
          item={editing}
          categories={categories}
          categoriesAvailable={categoriesAvailable}
          brands={brands}
          brandsAvailable={brandsAvailable}
          access={access}
          onClose={closeModal}
          onFlash={say}
          onCreated={created}
        />
      )}
      {modal === "stock" && editing && (
        <InventoryStockDialog
          businessId={businessId}
          item={editing}
          access={access}
          stock={stockIndex}
          startStoreId={scopeStoreId || access.defaultStoreId}
          onClose={closeModal}
          onFlash={say}
        />
      )}
      {modal === "transfer" && access.canTransfer && (
        <InventoryTransferDialog
          businessId={businessId}
          items={onSaleItems}
          access={access}
          stock={stockIndex}
          stockReady={!stockRead.loading}
          startItemId={transferItemId}
          startFromStoreId={scopeStoreId}
          onClose={closeModal}
          onFlash={say}
        />
      )}
      {modal === "categories" && (
        <InventoryCategoriesDialog businessId={businessId} categories={categories} onClose={closeModal} onFlash={say} />
      )}
      {modal === "brands" && (
        <InventoryBrandsDialog businessId={businessId} brands={brands} onClose={closeModal} onFlash={say} />
      )}
      {modal === "stores" && access.canManageStores && (
        <InventoryStoresDialog businessId={businessId} stores={everyStore} onClose={closeModal} onFlash={say} />
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
