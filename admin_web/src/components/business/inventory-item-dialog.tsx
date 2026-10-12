"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { CopyPlus, Plus, Printer, RefreshCw, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import { currentLanguage, text } from "@/lib/format";
import {
  archivedNameText,
  brandOptions,
  categoryOptions,
  createInventoryBrandRequest,
  createInventoryCategoryRequest,
  createInventoryItemRequest,
  emptyInventoryItemDraft,
  inventoryDraftChanged,
  inventoryDraftFromItem,
  inventoryMessage,
  productDisplayName,
  quickEntryDraft,
  readCreatedBrandId,
  readCreatedCategoryId,
  savedNextText,
  runInventoryCall,
  updateInventoryItemRequest,
  validateBrandName,
  validateCategoryName,
  validateInventoryItemDraft,
  type InventoryBrand,
  type InventoryCategory,
  type InventoryItem,
  type InventoryItemDraft,
  type StoreAccess,
} from "@/lib/inventory";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/** What the panel needs of a product just created, to print its tags straight away. */
export type CreatedInventoryItem = { id: string; code: string; name: string };

const LEGACY_CATEGORY = "__legacy__";
const NEW_CATEGORY = "__new__";
const LEGACY_BRAND = "__legacy_brand__";
const NEW_BRAND = "__new_brand__";

/**
 * One form for a new product and for editing one. The count is entered only
 * when a product is created - one number, or one per store in a business with
 * several stores; afterwards it changes through "Add stock / set count" (every
 * change leaves a line in the stock history). The brand and the category are
 * picked from the business's lists, or added on the spot. The photo is a link,
 * not an upload.
 *
 * "Save and add another like it" (new products only) saves and reopens the
 * empty form keeping only the brand and the category, for a run of similar
 * products.
 */
export function InventoryItemDialog({
  businessId,
  item,
  categories,
  categoriesAvailable,
  brands,
  brandsAvailable,
  access,
  onClose,
  onFlash,
  onCreated,
}: {
  businessId: string;
  /** The product being edited; null for a new one. */
  item: InventoryItem | null;
  /** Every category of the business, archived ones included. */
  categories: readonly InventoryCategory[];
  /** False when the list could not be read: the form then takes the category as typed text. */
  categoriesAvailable: boolean;
  /** Every brand of the business, archived ones included. */
  brands: readonly InventoryBrand[];
  /** False when the list could not be read: the form then takes the brand as typed text. */
  brandsAvailable: boolean;
  access: StoreAccess;
  onClose: () => void;
  onFlash: (message: string) => void;
  /** After a create; `printTags` is true for "Save & print tags". */
  onCreated: (created: CreatedInventoryItem, printTags: boolean) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const editing = item !== null;
  const [draft, setDraft] = useState<InventoryItemDraft>(() => (item ? inventoryDraftFromItem(item, categories, brands) : { ...emptyInventoryItemDraft, stock: {} }));
  // A typed category the list does not hold yet stays choosable until the person picks another.
  const [legacyCategory] = useState(() => (item ? inventoryDraftFromItem(item, categories) : emptyInventoryItemDraft).category);
  const [justAdded, setJustAdded] = useState<InventoryCategory[]>([]);
  const [adding, setAdding] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [addingBusy, setAddingBusy] = useState(false);
  // A typed brand the list does not hold yet stays choosable until the person picks another.
  const [legacyBrand] = useState(() => (item ? inventoryDraftFromItem(item, categories, brands) : emptyInventoryItemDraft).brand ?? "");
  const [justAddedBrands, setJustAddedBrands] = useState<InventoryBrand[]>([]);
  const [addingBrand, setAddingBrand] = useState(false);
  const [newBrand, setNewBrand] = useState("");
  const [addingBrandBusy, setAddingBrandBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The product just saved through "Save and add another like it", so the form says it worked.
  const [savedHere, setSavedHere] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  // Set after "Save and add another like it": the cursor goes back to Name once the form is enabled again.
  const refocusName = useRef(false);
  useEffect(() => {
    if (refocusName.current && !busy) {
      refocusName.current = false;
      nameRef.current?.focus();
    }
  }, [busy, savedHere]);

  const set = (patch: Partial<InventoryItemDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const legacyShown = Boolean(item) && Boolean(text(legacyCategory, ""));
  const known = useMemo(() => {
    const ids = new Set(categories.map((category) => category.id));
    return [...categories, ...justAdded.filter((category) => !ids.has(category.id))];
  }, [categories, justAdded]);
  const options = useMemo(() => categoryOptions(known, draft.categoryId ?? ""), [known, draft.categoryId]);
  const legacyBrandShown = Boolean(item) && Boolean(text(legacyBrand, ""));
  const knownBrands = useMemo(() => {
    const ids = new Set(brands.map((brand) => brand.id));
    return [...brands, ...justAddedBrands.filter((brand) => !ids.has(brand.id))];
  }, [brands, justAddedBrands]);
  const brandChoices = useMemo(() => brandOptions(knownBrands, draft.brandId ?? ""), [knownBrands, draft.brandId]);
  const brandSelectValue = draft.brandId || (text(draft.brand ?? "", "") ? LEGACY_BRAND : "");
  const selectValue = draft.categoryId || (text(draft.category, "") ? LEGACY_CATEGORY : "");
  const form = { multiStore: access.multi };
  // Who may give a starting count where: every store, or only one's own.
  const stockStores = access.canSeeAll ? access.stores : access.stores.filter((store) => store.id === access.scopedStoreId);

  function pickCategory(value: string) {
    if (value === NEW_CATEGORY) {
      setAdding(true);
      return;
    }
    setAdding(false);
    setError("");
    if (value === "") set({ categoryId: "", category: "" });
    else if (value === LEGACY_CATEGORY) set({ categoryId: "", category: legacyCategory });
    else set({ categoryId: value, category: known.find((category) => category.id === value)?.name ?? "" });
  }

  function pickBrand(value: string) {
    if (value === NEW_BRAND) {
      setAddingBrand(true);
      return;
    }
    setAddingBrand(false);
    setError("");
    if (value === "") set({ brandId: "", brand: "" });
    else if (value === LEGACY_BRAND) set({ brandId: "", brand: legacyBrand });
    else set({ brandId: value, brand: knownBrands.find((brand) => brand.id === value)?.name ?? "" });
  }

  async function addBrand() {
    const problems = validateBrandName(newBrand, knownBrands);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    await runInventoryCall(setAddingBrandBusy, async () => {
      const response = await httpsCallable(functions, "createInventoryBrand")(createInventoryBrandRequest(businessId, newBrand));
      const brandId = readCreatedBrandId(response.data);
      const name = text(newBrand, "");
      if (brandId) {
        setJustAddedBrands((list) => [...list, { id: brandId, name, nameKey: name.toLowerCase(), archived: false }]);
        set({ brandId, brand: name });
      } else {
        // No id back: send the name with the product and let the server file it.
        set({ brandId: "", brand: name });
      }
      setNewBrand("");
      setAddingBrand(false);
    }, (failure) => setError(failure.message));
  }

  async function addCategory() {
    const problems = validateCategoryName(newCategory, known);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    await runInventoryCall(setAddingBusy, async () => {
      const response = await httpsCallable(functions, "createInventoryCategory")(createInventoryCategoryRequest(businessId, newCategory));
      const categoryId = readCreatedCategoryId(response.data);
      const name = text(newCategory, "");
      if (categoryId) {
        setJustAdded((list) => [...list, { id: categoryId, name, nameKey: name.toLowerCase(), archived: false }]);
        set({ categoryId, category: name });
      } else {
        // No id back: send the name with the product and let the server file it.
        set({ categoryId: "", category: name });
      }
      setNewCategory("");
      setAdding(false);
    }, (failure) => setError(failure.message));
  }

  async function save(mode: "save" | "print" | "another") {
    const printTags = mode === "print";
    const problems = validateInventoryItemDraft(draft, !editing, form);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    if (item) {
      // Nothing changed: nothing to send.
      if (!inventoryDraftChanged(item, draft, categories, brands)) {
        onClose();
        return;
      }
      await runInventoryCall(setBusy, async () => {
        await httpsCallable(functions, "updateInventoryItem")(updateInventoryItemRequest(businessId, item, draft));
        onFlash("Product updated.");
        onClose();
      }, (failure) => setError(failure.message));
      return;
    }
    await runInventoryCall(setBusy, async () => {
      const response = await httpsCallable(functions, "createInventoryItem")(createInventoryItemRequest(businessId, draft, form));
      const data = (response.data ?? {}) as { itemId?: unknown; code?: unknown };
      const code = text(data.code, "");
      onFlash(code ? `Product saved: ${code}` : "Product saved.");
      if (mode === "another") {
        // The form stays open and empty, keeping only the brand and the category.
        setSavedHere(productDisplayName({ name: draft.name, brand: draft.brand }));
        setDraft(quickEntryDraft(draft));
        refocusName.current = true;
        return;
      }
      onCreated({ id: text(data.itemId, ""), code, name: productDisplayName({ name: draft.name, brand: draft.brand }) }, printTags);
    }, (failure) => setError(failure.message));
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>{editing ? "Edit product" : "New product"}</h3>
            <p>{editing ? "Change what is shown at the counter. The count changes through Add stock." : "One product, one tag. Each size or colour is its own product."}</p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          {savedHere && !error && (
            <div className="lst-form-error" role="status" style={{ background: "var(--mist)", color: "var(--brand-strong)" }}>
              <span data-no-translate>{savedNextText(savedHere, lang)}</span>
            </div>
          )}
          <div className="lst-form-grid">
            <label className="lst-field wide"><span>Name</span>
              <input ref={nameRef} value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus disabled={busy} />
              {brandsAvailable && <small className="lst-hint">Type the name without the brand. The brand you pick below is shown in front of it.</small>}
            </label>
            <label className="lst-field"><span>Price ($)</span>
              <input inputMode="decimal" value={draft.price} onChange={(e) => set({ price: e.target.value })} placeholder="0.00" disabled={busy} />
            </label>
            <label className="lst-field"><span>Cost ($)</span>
              <input inputMode="decimal" value={draft.cost} onChange={(e) => set({ cost: e.target.value })} placeholder="optional" disabled={busy} />
              <small className="lst-hint">What it cost you. Only used to work out profit.</small>
            </label>
            {!editing && !access.multi && (
              <label className="lst-field"><span>How many in stock</span>
                <input inputMode="numeric" value={draft.quantity} onChange={(e) => set({ quantity: e.target.value })} disabled={busy} />
              </label>
            )}
            <label className="lst-field"><span>Low stock at</span>
              <input inputMode="numeric" value={draft.lowStockAt} onChange={(e) => set({ lowStockAt: e.target.value })} placeholder="optional" disabled={busy} />
              <small className="lst-hint">{access.multi ? "Flagged as low in a store at or below this number, and always at 0." : "Flagged as low at or below this number, and always at 0."}</small>
            </label>
            {brandsAvailable ? (
              <div className="lst-field"><span>Brand</span>
                <select value={brandSelectValue} onChange={(e) => pickBrand(e.target.value)} disabled={busy || addingBrandBusy} aria-label="Brand">
                  <option value="">No brand</option>
                  {brandChoices.map((brand) => (
                    <option key={brand.id} value={brand.id} data-no-translate>{brand.archived ? archivedNameText(brand.name, lang, true) : brand.name}</option>
                  ))}
                  {legacyBrandShown && <option value={LEGACY_BRAND} data-no-translate>{legacyBrand}</option>}
                  <option value={NEW_BRAND}>Add a new brand</option>
                </select>
                {addingBrand && (
                  <div className="ivt-inline-add">
                    <input
                      value={newBrand}
                      onChange={(e) => setNewBrand(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addBrand(); } }}
                      placeholder="New brand name"
                      aria-label="New brand name"
                      autoFocus
                      disabled={addingBrandBusy}
                    />
                    <button className="lst-btn" type="button" disabled={addingBrandBusy} aria-busy={addingBrandBusy} onClick={() => void addBrand()}>
                      {addingBrandBusy ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />} Add
                    </button>
                    <button className="lst-btn ghost" type="button" disabled={addingBrandBusy} onClick={() => { setAddingBrand(false); setNewBrand(""); }}>Cancel</button>
                  </div>
                )}
              </div>
            ) : (
              <label className="lst-field"><span>Brand</span>
                <input value={draft.brand ?? ""} onChange={(e) => set({ brand: e.target.value, brandId: "" })} placeholder="optional" disabled={busy} />
              </label>
            )}
            {categoriesAvailable ? (
              <div className="lst-field"><span>Category</span>
                <select value={selectValue} onChange={(e) => pickCategory(e.target.value)} disabled={busy || addingBusy} aria-label="Category">
                  <option value="">No category</option>
                  {options.map((category) => (
                    <option key={category.id} value={category.id} data-no-translate>{category.archived ? archivedNameText(category.name, lang, true) : category.name}</option>
                  ))}
                  {legacyShown && <option value={LEGACY_CATEGORY} data-no-translate>{legacyCategory}</option>}
                  <option value={NEW_CATEGORY}>Add a new category</option>
                </select>
                {adding && (
                  <div className="ivt-inline-add">
                    <input
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addCategory(); } }}
                      placeholder="New category name"
                      aria-label="New category name"
                      autoFocus
                      disabled={addingBusy}
                    />
                    <button className="lst-btn" type="button" disabled={addingBusy} aria-busy={addingBusy} onClick={() => void addCategory()}>
                      {addingBusy ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />} Add
                    </button>
                    <button className="lst-btn ghost" type="button" disabled={addingBusy} onClick={() => { setAdding(false); setNewCategory(""); }}>Cancel</button>
                  </div>
                )}
              </div>
            ) : (
              <label className="lst-field"><span>Category</span>
                <input value={draft.category} onChange={(e) => set({ category: e.target.value, categoryId: "" })} placeholder="optional" disabled={busy} />
              </label>
            )}
            {!editing && access.multi && (
              <fieldset className="lst-fieldset wide ivt-stock-stores">
                <legend>How many in stock in each store</legend>
                {access.needsHomeStore ? (
                  <p className="lst-hint">You have no home store yet. Ask the owner to assign one before adding stock.</p>
                ) : (
                  stockStores.map((store) => (
                    <label className="lst-field ivt-store-count" key={store.id}>
                      <span data-no-translate>{store.name}</span>
                      <input
                        inputMode="numeric"
                        value={draft.stock?.[store.id] ?? ""}
                        onChange={(e) => set({ stock: { ...draft.stock, [store.id]: e.target.value } })}
                        placeholder="0"
                        aria-label={store.name}
                        data-no-translate
                        disabled={busy}
                      />
                    </label>
                  ))
                )}
              </fieldset>
            )}
            <label className="lst-field wide"><span>Photo link</span>
              <input inputMode="url" value={draft.photoUrl} onChange={(e) => set({ photoUrl: e.target.value })} placeholder="https://" disabled={busy} />
              <small className="lst-hint">A link to a picture on the web. Leave empty for none.</small>
            </label>
          </div>
        </div>
        <footer className="lst-modal-foot wpk-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          {!editing && (
            <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => void save("print")}><Printer size={16} /> Save &amp; print tags</button>
          )}
          {!editing && (
            <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => void save("another")}><CopyPlus size={16} /> Save and add another like it</button>
          )}
          <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void save("save")}>
            {busy ? <RefreshCw className="spin" size={16} /> : editing ? null : <Plus size={16} />}
            {busy ? "Saving..." : editing ? "Save changes" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}
