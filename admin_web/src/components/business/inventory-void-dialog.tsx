"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { RefreshCw, Undo2, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import { currentLanguage, formatDateTime } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import {
  inventoryMessage,
  itemCountText,
  runInventoryCall,
  validateVoidReason,
  voidConsequenceText,
  voidInventorySaleRequest,
  type InventorySale,
} from "@/lib/inventory";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/**
 * Voiding undoes a whole sale: its stock goes back and the sale stays in the
 * history, marked voided with who did it and when. Nothing is erased, so the
 * reason is optional and the confirmation is a button, not a typed word.
 */
export function InventoryVoidDialog({
  businessId,
  sale,
  onClose,
  onFlash,
  onVoided,
}: {
  businessId: string;
  sale: InventorySale;
  onClose: () => void;
  onFlash: (message: string) => void;
  /** After the server accepted, so the summary can be asked again. */
  onVoided: () => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    const problems = validateVoidReason(reason);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "voidInventorySale")(voidInventorySaleRequest(businessId, sale.id, reason));
      onFlash("Sale voided. The stock went back.");
      onVoided();
      onClose();
    }, (failure) => setError(failure.message));
  }

  return (
    <div className="lst-modal-overlay" role="alertdialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>Void this sale?</h3>
            <p>
              <time data-no-translate>{formatDateTime(sale.createdAt)}</time>
              {" — "}
              <span data-no-translate>{itemCountText(sale.itemCount, lang)}</span>
              {" · "}
              <b data-no-translate>{moneyText(sale.totalCents)}</b>
            </p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          <ul className="ivt-void-lines">
            {sale.lines.map((line, index) => (
              <li key={`${line.itemId}-${index}`}>
                <span data-no-translate>{line.quantity} × {line.name}</span>
              </li>
            ))}
          </ul>
          <p data-no-translate>{voidConsequenceText(sale.itemCount, lang)}</p>
          <label className="lst-field"><span>Reason</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="optional" autoFocus disabled={busy} />
          </label>
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Keep the sale</button>
          <button className="lst-btn ghost danger" type="button" disabled={busy} aria-busy={busy} onClick={() => void confirm()}>
            {busy ? <RefreshCw className="spin" size={16} /> : <Undo2 size={16} />}
            {busy ? "Voiding..." : "Void the sale"}
          </button>
        </footer>
      </div>
    </div>
  );
}
