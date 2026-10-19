"use client";

import { useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { RefreshCw, Trash2, X, XCircle } from "lucide-react";

import { functions } from "@/lib/firebase";
import { currentLanguage } from "@/lib/format";
import {
  cancelConsequenceText,
  cancelTransferRequest,
  newTransferRequestId,
  transferFailure,
  type InventoryTransfer,
} from "@/lib/inventory-transfers";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/**
 * Cancel a transfer in transit (the pieces go back to the source store and
 * the destination is told) or discard a draft (nothing was reserved). Both
 * are `cancelInventoryTransfer`; the retry key is made when the dialog opens,
 * so a retried cancel after a lost answer is the same cancel.
 */
export function InventoryTransferCancelDialog({
  businessId,
  transfer,
  fromName,
  toName,
  onClose,
  onFlash,
  onDone,
}: {
  businessId: string;
  transfer: InventoryTransfer;
  fromName: string;
  toName: string;
  onClose: () => void;
  onFlash: (message: string) => void;
  /** A discarded draft leaves the list: the caller closes its detail. */
  onDone: () => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const draft = transfer.status === "draft";
  const [requestId] = useState(() => newTransferRequestId());
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await httpsCallable(functions, "cancelInventoryTransfer")(cancelTransferRequest(businessId, transfer.id, requestId));
      onFlash(draft ? "Draft discarded." : "Transfer cancelled. The items are back in the store they left.");
      onDone();
      onClose();
    } catch (failure) {
      setError(transferFailure(failure).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(busy ? () => undefined : onClose)}>
      <div className="lst-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>{draft ? "Discard this draft?" : "Cancel this transfer?"}</h3>
            <p><code className="ctn-code" data-no-translate>{transfer.code}</code></p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} disabled={busy} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          {draft
            ? <p>Nothing was reserved, so no count changes.</p>
            : <p data-no-translate>{cancelConsequenceText(transfer.itemsCount, fromName, toName, lang)}</p>}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Keep it</button>
          <button className="lst-btn ghost danger" type="button" disabled={busy} aria-busy={busy} onClick={() => void confirm()}>
            {busy ? <RefreshCw className="spin" size={16} /> : draft ? <Trash2 size={16} /> : <XCircle size={16} />}
            {busy ? (draft ? "Discarding the draft..." : "Cancelling...") : draft ? "Discard draft" : "Cancel transfer"}
          </button>
        </footer>
      </div>
    </div>
  );
}
