"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Boxes, RefreshCw, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import {
  adjustInventoryStockRequest,
  emptyStockDraft,
  inventoryMessage,
  runInventoryCall,
  stockAfter,
  stockCountFor,
  validateStockDraft,
  type InventoryItem,
  type StockDraft,
  type StockIndex,
  type StoreAccess,
  productDisplayName,
} from "@/lib/inventory";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/**
 * Add stock that arrived, or set the count after counting the shelf. Setting
 * the count is the correction: it clears "count was off". Each one leaves a
 * line in the product's stock history with who made it. With several stores
 * it asks which store's count it changes: the owner and all-stores staff pick
 * any, other staff only their own.
 */
export function InventoryStockDialog({
  businessId,
  item,
  access,
  stock,
  startStoreId,
  onClose,
  onFlash,
}: {
  businessId: string;
  item: InventoryItem;
  access: StoreAccess;
  /** The per-store counts (empty in a single-store business). */
  stock: StockIndex;
  /** The store the dialog opens on; the person's own when it is not one they may use. */
  startStoreId: string;
  onClose: () => void;
  onFlash: (message: string) => void;
}) {
  const choices = access.canSeeAll ? access.stores : access.stores.filter((store) => store.id === access.scopedStoreId);
  const [draft, setDraft] = useState<StockDraft>(emptyStockDraft);
  const [storeId, setStoreId] = useState(() => (choices.some((store) => store.id === startStoreId) ? startStoreId : choices[0]?.id ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = access.multi ? stockCountFor(stock, item.id, storeId) : item.quantity;
  const after = stockAfter(current, draft);
  const storeName = choices.find((store) => store.id === storeId)?.name ?? "";

  async function save() {
    const problems = [...validateStockDraft(draft), ...(access.multi && !storeId ? (["store_required"] as const) : [])];
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "adjustInventoryStock")(adjustInventoryStockRequest(businessId, item.id, draft, access.multi ? storeId : ""));
      onFlash(draft.mode === "set" ? "Count saved." : "Stock added.");
      onClose();
    }, (failure) => setError(failure.message));
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>Add stock or set the count</h3>
            <p>
              <span data-no-translate>{productDisplayName(item)}</span>
              {" — "}
              <span>In stock now</span>{" "}
              <b data-no-translate>{current}</b>
              {access.multi && storeName && <>{" "}<small data-no-translate>{storeName}</small></>}
            </p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          {access.multi && (
            <label className="lst-field"><span>Store</span>
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={busy || choices.length < 2} aria-label="Store">
                {choices.length === 0 && <option value="">No store</option>}
                {choices.map((store) => (
                  <option key={store.id} value={store.id} data-no-translate>{store.name}</option>
                ))}
              </select>
            </label>
          )}
          <fieldset className="lst-fieldset">
            <label className="lst-radio"><input type="radio" name="ivtstockmode" checked={draft.mode === "add"} disabled={busy} onChange={() => setDraft((d) => ({ ...d, mode: "add" }))} /><span>Add stock that arrived</span></label>
            <label className="lst-radio"><input type="radio" name="ivtstockmode" checked={draft.mode === "set"} disabled={busy} onChange={() => setDraft((d) => ({ ...d, mode: "set" }))} /><span>Set the count after counting the shelf</span></label>
          </fieldset>
          <div className="lst-form-grid">
            <label className="lst-field"><span>{draft.mode === "add" ? "How many to add" : "Number counted"}</span>
              <input inputMode="numeric" value={draft.quantity} onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))} autoFocus disabled={busy} />
            </label>
            <label className="lst-field"><span>Note</span>
              <input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="optional" disabled={busy} />
            </label>
          </div>
          {draft.mode === "set" && <p className="lst-hint">Setting the count corrects it and clears the count-was-off mark.</p>}
          {after !== null && (
            <p className="lst-hint ivt-after"><span>Stock after this</span> <b data-no-translate>{after}</b></p>
          )}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void save()}>
            {busy ? <RefreshCw className="spin" size={16} /> : <Boxes size={16} />}
            {busy ? "Saving..." : draft.mode === "set" ? "Save the count" : "Add stock"}
          </button>
        </footer>
      </div>
    </div>
  );
}
