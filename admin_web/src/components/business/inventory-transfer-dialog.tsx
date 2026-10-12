"use client";

import { useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { ArrowRightLeft, RefreshCw, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import { currentLanguage } from "@/lib/format";
import {
  availableInStoreText,
  countChangeText,
  emptyTransferDraft,
  inventoryMessage,
  runInventoryCall,
  stockCountFor,
  transferAfter,
  transferInventoryStockRequest,
  validateTransferDraft,
  type InventoryItem,
  type StockIndex,
  type StoreAccess,
  type TransferDraft,
  productDisplayName,
} from "@/lib/inventory";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/**
 * Move stock from one store to another: product, store it leaves, store it
 * goes to, how many, an optional note. The total never changes. Only the
 * owner and staff who work in all stores get here; the server refuses a move
 * of more than the source holds (`insufficient_stock`) or to the same store.
 */
export function InventoryTransferDialog({
  businessId,
  items,
  access,
  stock,
  stockReady,
  startItemId,
  startFromStoreId,
  onClose,
  onFlash,
}: {
  businessId: string;
  /** The products on sale. */
  items: readonly InventoryItem[];
  access: StoreAccess;
  stock: StockIndex;
  /** The per-store counts have arrived: until then the source count is unknown and the server decides. */
  stockReady: boolean;
  startItemId: string;
  startFromStoreId: string;
  onClose: () => void;
  onFlash: (message: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const [draft, setDraft] = useState<TransferDraft>(() => {
    const from = access.stores.some((store) => store.id === startFromStoreId) ? startFromStoreId : access.defaultStoreId;
    const to = access.stores.find((store) => store.id !== from)?.id ?? "";
    return { ...emptyTransferDraft, itemId: startItemId, fromStoreId: from, toStoreId: to };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sorted = useMemo(() => [...items].sort((a, b) => productDisplayName(a).localeCompare(productDisplayName(b)) || a.code.localeCompare(b.code)), [items]);
  const hasProduct = Boolean(draft.itemId);
  const fromCount = hasProduct && draft.fromStoreId ? stockCountFor(stock, draft.itemId, draft.fromStoreId) : 0;
  const toCount = hasProduct && draft.toStoreId ? stockCountFor(stock, draft.itemId, draft.toStoreId) : 0;
  const after = stockReady ? transferAfter(fromCount, toCount, draft.quantity) : null;
  const fromName = access.stores.find((store) => store.id === draft.fromStoreId)?.name ?? "";
  const toName = access.stores.find((store) => store.id === draft.toStoreId)?.name ?? "";

  async function save() {
    const known = stockReady && hasProduct && Boolean(draft.fromStoreId) ? fromCount : null;
    const problems = validateTransferDraft(draft, known);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "transferInventoryStock")(transferInventoryStockRequest(businessId, draft));
      onFlash("Stock moved.");
      onClose();
    }, (failure) => setError(failure.message));
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>Move stock between stores</h3>
            <p>The total does not change: what leaves one store arrives in the other.</p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          <div className="lst-form-grid">
            <label className="lst-field wide"><span>Product</span>
              <select value={draft.itemId} onChange={(e) => setDraft((d) => ({ ...d, itemId: e.target.value }))} disabled={busy} aria-label="Product">
                <option value="">Choose a product</option>
                {sorted.map((item) => (
                  <option key={item.id} value={item.id} data-no-translate>{productDisplayName(item)} · {item.code}</option>
                ))}
              </select>
            </label>
            <label className="lst-field"><span>From store</span>
              <select value={draft.fromStoreId} onChange={(e) => setDraft((d) => ({ ...d, fromStoreId: e.target.value }))} disabled={busy} aria-label="From store">
                <option value="">Choose a store</option>
                {access.stores.map((store) => (
                  <option key={store.id} value={store.id} data-no-translate>{store.name}</option>
                ))}
              </select>
              {stockReady && hasProduct && draft.fromStoreId && (
                <small className="lst-hint" data-no-translate>{availableInStoreText(fromCount, fromName, lang)}</small>
              )}
            </label>
            <label className="lst-field"><span>To store</span>
              <select value={draft.toStoreId} onChange={(e) => setDraft((d) => ({ ...d, toStoreId: e.target.value }))} disabled={busy} aria-label="To store">
                <option value="">Choose a store</option>
                {access.stores.map((store) => (
                  <option key={store.id} value={store.id} data-no-translate>{store.name}</option>
                ))}
              </select>
            </label>
            <label className="lst-field"><span>How many to move</span>
              <input inputMode="numeric" value={draft.quantity} onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))} disabled={busy} />
            </label>
            <label className="lst-field"><span>Note</span>
              <input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="optional" disabled={busy} />
            </label>
          </div>
          {after !== null && draft.fromStoreId !== draft.toStoreId && (
            <p className="lst-hint ivt-after">
              <span>After this</span>{" "}
              <b data-no-translate>{countChangeText(fromName, fromCount, after.from)} · {countChangeText(toName, toCount, after.to)}</b>
            </p>
          )}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void save()}>
            {busy ? <RefreshCw className="spin" size={16} /> : <ArrowRightLeft size={16} />}
            {busy ? "Moving..." : "Move stock"}
          </button>
        </footer>
      </div>
    </div>
  );
}
