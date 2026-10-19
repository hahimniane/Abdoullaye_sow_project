"use client";

import { useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { RefreshCw, Undo2, X, XCircle } from "lucide-react";

import { functions } from "@/lib/firebase";
import { currentLanguage } from "@/lib/format";
import { inventoryMessage, productDisplayName, type InventoryViewer } from "@/lib/inventory";
import {
  MAX_TRANSFER_NOTE,
  WRITE_OFF_REASONS,
  WRITE_OFF_REASON_LABELS,
  canResolveLine,
  lineOpenMissing,
  lineResultText,
  missingText,
  newTransferRequestId,
  resolveLineRequest,
  returnToText,
  transferFailure,
  validateWriteOff,
  writeOffButtonText,
  type InventoryTransfer,
  type ResolveAction,
  type WriteOffReason,
} from "@/lib/inventory-transfers";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/**
 * The owner's review of what did not arrive: per missing line, return the
 * pieces to the source store or write them off with a reason (Lost in
 * transit, Damaged, Stolen, Other) and an optional note
 * (`resolveInventoryTransferLine`). The transfer is live, so a decided line
 * shows its result at once; when every line is decided it is settled.
 */
export function InventoryTransferReviewDialog({
  businessId,
  transfer,
  viewer,
  fromName,
  toName,
  onClose,
  onFlash,
}: {
  businessId: string;
  transfer: InventoryTransfer;
  viewer: InventoryViewer;
  fromName: string;
  toName: string;
  onClose: () => void;
  onFlash: (message: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const [writingOff, setWritingOff] = useState("");
  const [reason, setReason] = useState<WriteOffReason | "">("");
  const [note, setNote] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  // One retry key per line and action while the dialog is open: a retried decision is the same decision.
  const requestIds = useRef(new Map<string, string>());
  const requestIdFor = (key: string) => {
    let id = requestIds.current.get(key);
    if (!id) {
      id = newTransferRequestId();
      requestIds.current.set(key, id);
    }
    return id;
  };

  const missingLines = transfer.lines.filter((line) => line.missing > 0);
  const open = missingLines.filter((line) => lineOpenMissing(line) > 0);

  async function decide(itemId: string, action: ResolveAction) {
    if (inFlight.current) return;
    if (action === "write_off") {
      const problems = validateWriteOff(reason, note);
      if (problems.length) {
        setError(inventoryMessage(problems));
        return;
      }
    }
    const key = `${itemId}:${action}`;
    inFlight.current = true;
    setBusyKey(key);
    setError("");
    try {
      await httpsCallable(functions, "resolveInventoryTransferLine")(
        resolveLineRequest(businessId, transfer.id, itemId, action, { reason, note, requestId: requestIdFor(key) }),
      );
      onFlash(action === "return" ? "Returned to the store it came from." : "Written off.");
      setWritingOff("");
      setReason("");
      setNote("");
    } catch (failure) {
      setError(transferFailure(failure).message);
    } finally {
      inFlight.current = false;
      setBusyKey("");
    }
  }

  const busy = busyKey !== "";
  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(busy ? () => undefined : onClose)}>
      <div className="lst-modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>Settle differences</h3>
            <p><code className="ctn-code" data-no-translate>{transfer.code}</code> · <span data-no-translate>{`${fromName} → ${toName}`}</span></p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} disabled={busy} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          {transfer.receiveNote && (
            <p className="ctn-notes"><span>Note from the receiving store:</span> <span data-no-translate>{`“${transfer.receiveNote}”`}</span></p>
          )}
          {open.length === 0 && <div className="empty-state">Every missing item is decided. This transfer is settled.</div>}
          <ul className="ivt-tr-lines">
            {missingLines.map((line) => {
              const pending = lineOpenMissing(line);
              const name = productDisplayName(line);
              const mayDecide = canResolveLine(transfer, line, viewer);
              const choosing = writingOff === line.itemId;
              return (
                <li key={line.itemId} className="ivt-tr-review-line">
                  <div className="ivt-tr-line-main">
                    <strong data-no-translate>{name}</strong>
                    {pending > 0
                      ? <small className="ivt-overdue" data-no-translate>{missingText(pending, lang)}</small>
                      : <small data-no-translate>{lineResultText(line, fromName, lang)}</small>}
                    {pending > 0 && <small>These can&apos;t be sold anywhere until you decide.</small>}
                  </div>
                  {pending > 0 && mayDecide && (
                    <div className="ivt-tr-review-actions">
                      <button className="lst-btn ghost" type="button" disabled={busy} aria-busy={busyKey === `${line.itemId}:return`} onClick={() => void decide(line.itemId, "return")}>
                        {busyKey === `${line.itemId}:return` ? <RefreshCw className="spin" size={14} /> : <Undo2 size={14} />}
                        <span data-no-translate>{returnToText(fromName, lang)}</span>
                      </button>
                      <button className="lst-btn ghost danger" type="button" disabled={busy} aria-pressed={choosing} onClick={() => { setWritingOff(choosing ? "" : line.itemId); setReason(""); setNote(""); setError(""); }}>
                        <XCircle size={14} /> Write off
                      </button>
                    </div>
                  )}
                  {pending > 0 && mayDecide && choosing && (
                    <div className="ivt-tr-writeoff">
                      <fieldset className="ivt-tr-reasons">
                        <legend>Reason for write-off</legend>
                        {WRITE_OFF_REASONS.map((id) => (
                          <label key={id} className="ivt-tr-reason">
                            <input type="radio" name={`reason-${line.itemId}`} value={id} checked={reason === id} onChange={() => setReason(id)} disabled={busy} />
                            <span>{WRITE_OFF_REASON_LABELS[id]}</span>
                          </label>
                        ))}
                      </fieldset>
                      <label className="lst-field wide"><span>Note (optional)</span>
                        <input value={note} maxLength={MAX_TRANSFER_NOTE} onChange={(e) => setNote(e.target.value)} placeholder="What you know about it" disabled={busy} />
                      </label>
                      <button className="lst-add" type="button" disabled={busy || !reason} aria-busy={busyKey === `${line.itemId}:write_off`} onClick={() => void decide(line.itemId, "write_off")}>
                        {busyKey === `${line.itemId}:write_off` ? <RefreshCw className="spin" size={16} /> : <XCircle size={16} />}
                        {busyKey === `${line.itemId}:write_off` ? <span>Saving...</span> : <span data-no-translate>{writeOffButtonText(pending, lang)}</span>}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="lst-hint">Only the owner and staff who work in all stores can settle differences. Reminders go out every 2 days until it is settled.</p>
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-add" type="button" disabled={busy} onClick={onClose}>Done</button>
        </footer>
      </div>
    </div>
  );
}
