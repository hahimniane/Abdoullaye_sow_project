"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Plus, Printer, RefreshCw, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import { text } from "@/lib/format";
import {
  createInventoryItemRequest,
  emptyInventoryItemDraft,
  inventoryDraftChanged,
  inventoryDraftFromItem,
  inventoryMessage,
  runInventoryCall,
  updateInventoryItemRequest,
  validateInventoryItemDraft,
  type InventoryItem,
  type InventoryItemDraft,
} from "@/lib/inventory";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/** What the panel needs of a product just created, to print its tags straight away. */
export type CreatedInventoryItem = { id: string; code: string; name: string };

/**
 * One form for a new product and for editing one. The count is entered only
 * when a product is created; afterwards it changes through "Add stock / set
 * count" (every change leaves a line in the stock history). The photo is a
 * link, not an upload.
 */
export function InventoryItemDialog({
  businessId,
  item,
  onClose,
  onFlash,
  onCreated,
}: {
  businessId: string;
  /** The product being edited; null for a new one. */
  item: InventoryItem | null;
  onClose: () => void;
  onFlash: (message: string) => void;
  /** After a create; `printTags` is true for "Save & print tags". */
  onCreated: (created: CreatedInventoryItem, printTags: boolean) => void;
}) {
  const editing = item !== null;
  const [draft, setDraft] = useState<InventoryItemDraft>(() => (item ? inventoryDraftFromItem(item) : emptyInventoryItemDraft));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (patch: Partial<InventoryItemDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function save(printTags: boolean) {
    const problems = validateInventoryItemDraft(draft, !editing);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    if (item) {
      // Nothing changed: nothing to send.
      if (!inventoryDraftChanged(item, draft)) {
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
      const response = await httpsCallable(functions, "createInventoryItem")(createInventoryItemRequest(businessId, draft));
      const data = (response.data ?? {}) as { itemId?: unknown; code?: unknown };
      const code = text(data.code, "");
      onFlash(code ? `Product saved: ${code}` : "Product saved.");
      onCreated({ id: text(data.itemId, ""), code, name: text(draft.name, "") }, printTags);
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
          <div className="lst-form-grid">
            <label className="lst-field wide"><span>Name</span>
              <input value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus disabled={busy} />
            </label>
            <label className="lst-field"><span>Price ($)</span>
              <input inputMode="decimal" value={draft.price} onChange={(e) => set({ price: e.target.value })} placeholder="0.00" disabled={busy} />
            </label>
            <label className="lst-field"><span>Cost ($)</span>
              <input inputMode="decimal" value={draft.cost} onChange={(e) => set({ cost: e.target.value })} placeholder="optional" disabled={busy} />
              <small className="lst-hint">What it cost you. Only used to work out profit.</small>
            </label>
            {!editing && (
              <label className="lst-field"><span>How many in stock</span>
                <input inputMode="numeric" value={draft.quantity} onChange={(e) => set({ quantity: e.target.value })} disabled={busy} />
              </label>
            )}
            <label className="lst-field"><span>Low stock at</span>
              <input inputMode="numeric" value={draft.lowStockAt} onChange={(e) => set({ lowStockAt: e.target.value })} placeholder="optional" disabled={busy} />
              <small className="lst-hint">Flagged as low at or below this number, and always at 0.</small>
            </label>
            <label className="lst-field"><span>Category</span>
              <input value={draft.category} onChange={(e) => set({ category: e.target.value })} placeholder="optional" disabled={busy} />
            </label>
            <label className="lst-field wide"><span>Photo link</span>
              <input inputMode="url" value={draft.photoUrl} onChange={(e) => set({ photoUrl: e.target.value })} placeholder="https://" disabled={busy} />
              <small className="lst-hint">A link to a picture on the web. Leave empty for none.</small>
            </label>
          </div>
        </div>
        <footer className="lst-modal-foot wpk-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          {!editing && (
            <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => void save(true)}><Printer size={16} /> Save &amp; print tags</button>
          )}
          <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void save(false)}>
            {busy ? <RefreshCw className="spin" size={16} /> : editing ? null : <Plus size={16} />}
            {busy ? "Saving..." : editing ? "Save changes" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}
