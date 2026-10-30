"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Banknote, RefreshCw, X } from "lucide-react";

import { ReceivedByOptions } from "@/components/business/received-by-options";
import { functions } from "@/lib/firebase";
import { currentLanguage } from "@/lib/format";
import { INVOICE_PAYMENT_METHODS, INVOICE_PAYMENT_METHOD_LABELS, moneyText, type InvoicePaymentMethod } from "@/lib/invoice-ledger";
import { inventoryMessage, runInventoryCall, type InventorySale } from "@/lib/inventory";
import {
  emptyCreditPaymentDraft,
  owesText,
  recordInventoryCreditPaymentRequest,
  validateCreditPaymentDraft,
  wholeRemainingInput,
  type CreditPaymentDraft,
} from "@/lib/inventory-credit";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/**
 * Money the customer brings in later on a credit sale. Same form as a package
 * payment: dollars as typed (never above what is still owed), how it came in,
 * who held it (the signed-in person unless someone else is picked from the
 * business's people) and an optional note. The server recomputes what was
 * collected from the payment rows, so two people recording at once cannot
 * overpay it.
 */
export function InventoryCreditPaymentDialog({
  businessId,
  sale,
  viewerUid,
  staffOptions,
  onClose,
  onFlash,
}: {
  businessId: string;
  sale: InventorySale;
  /** The signed-in person: who received the money unless someone else is picked. */
  viewerUid: string;
  /** The business's people, for "Received by". */
  staffOptions: readonly { id: string; name: string }[];
  onClose: () => void;
  onFlash: (message: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const startWith = staffOptions.some((s) => s.id === viewerUid) ? viewerUid : "";
  const [draft, setDraft] = useState<CreditPaymentDraft>(() => emptyCreditPaymentDraft(startWith));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remaining = sale.creditRemainingCents;

  async function record() {
    const problems = validateCreditPaymentDraft(draft, remaining);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "recordInventoryCreditPayment")(recordInventoryCreditPaymentRequest(businessId, sale.id, draft));
      onFlash("Payment recorded.");
      onClose();
    }, (failure) => setError(failure.message));
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>Record a payment</h3>
            <p data-no-translate>{owesText(sale.credit?.customerName ?? "", remaining, lang)}</p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          <div className="lst-form-grid wpk-payment-form">
            <label className="lst-field"><span>Amount received ($)</span>
              <input inputMode="decimal" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} placeholder="0.00" disabled={busy} autoFocus />
            </label>
            <label className="lst-field"><span>How it arrived</span>
              <select value={draft.method} disabled={busy} onChange={(e) => setDraft((d) => ({ ...d, method: e.target.value as InvoicePaymentMethod }))}>
                {INVOICE_PAYMENT_METHODS.map((m) => (<option key={m} value={m}>{INVOICE_PAYMENT_METHOD_LABELS[m]}</option>))}
              </select>
            </label>
            <label className="lst-field"><span>Received by</span>
              <select value={draft.receivedByStaffId} disabled={busy} onChange={(e) => setDraft((d) => ({ ...d, receivedByStaffId: e.target.value }))}>
                <ReceivedByOptions staffOptions={staffOptions} placeholder="Choose staff" />
              </select>
            </label>
            <label className="lst-field wide"><span>Note</span>
              <input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="optional" disabled={busy} />
            </label>
          </div>
          <div className="wpk-inline-actions">
            <button className="lst-btn ghost" type="button" disabled={busy || remaining <= 0} onClick={() => setDraft((d) => ({ ...d, amount: wholeRemainingInput(remaining) }))}>
              Pay all that is owed
            </button>
            <small className="lst-hint" data-no-translate>{moneyText(sale.creditPaidCents)} / {moneyText(sale.creditCents)}</small>
          </div>
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="lst-add" type="button" disabled={busy || remaining <= 0} aria-busy={busy} onClick={() => void record()}>
            {busy ? <RefreshCw className="spin" size={16} /> : <Banknote size={16} />}
            {busy ? "Saving..." : "Record payment"}
          </button>
        </footer>
      </div>
    </div>
  );
}
