"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { RefreshCw, Trash2, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import {
  deleteConfirmationMatches,
  deleteInventoryItemRequest,
  inventoryMessage,
  runInventoryCall,
  type InventoryItem,
} from "@/lib/inventory";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/**
 * Deleting a product cannot be undone, so it asks for more than a click: the
 * product's code, typed. Archiving is the everyday way to take a product off
 * the shelf and is offered first. Sales already made keep the product's name,
 * price and cost, so history survives.
 */
export function InventoryDeleteDialog({
  businessId,
  item,
  onClose,
  onFlash,
  onDeleted,
}: {
  businessId: string;
  item: InventoryItem;
  onClose: () => void;
  onFlash: (message: string) => void;
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = deleteConfirmationMatches(item, typed);

  async function remove() {
    if (!matches) {
      setError(inventoryMessage(["delete_not_confirmed"]));
      return;
    }
    setError("");
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "deleteInventoryItem")(deleteInventoryItemRequest(businessId, item.id));
      onFlash("Product deleted.");
      onDeleted();
    }, (failure) => setError(failure.message));
  }

  return (
    <div className="lst-modal-overlay" role="alertdialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>Delete this product?</h3>
            <p><span data-no-translate>{item.name}</span></p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          <p>This cannot be undone. The product and its tags stop working. Sales already made keep its name and price in the history.</p>
          <p className="lst-hint">If you may sell it again, archive it instead: it disappears from selling and keeps its history.</p>
          <label className="lst-field"><span>Type the product code to confirm</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={item.code} autoComplete="off" autoFocus disabled={busy} data-no-translate />
          </label>
          {item.code && <p className="lst-hint">The code is <code className="ctn-code" data-no-translate>{item.code}</code></p>}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Keep it</button>
          <button className="lst-btn ghost danger" type="button" disabled={busy || !matches} aria-busy={busy} onClick={() => void remove()}>
            {busy ? <RefreshCw className="spin" size={16} /> : <Trash2 size={16} />}
            {busy ? "Deleting..." : "Delete the product"}
          </button>
        </footer>
      </div>
    </div>
  );
}
