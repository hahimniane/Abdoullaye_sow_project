"use client";

import { useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { ArrowLeftRight, RefreshCw, X } from "lucide-react";

import { BUSINESS_ACCOUNT_RECEIVER } from "@/lib/staff-balances";
import { ReceivedByOptions } from "@/components/business/received-by-options";
import { CustomerPhoneField } from "@/components/customer-phone-field";
import { confirmImportantAction } from "@/lib/action-confirmation";
import { functions } from "@/lib/firebase";
import { currentLanguage } from "@/lib/format";
import { INVOICE_PAYMENT_METHODS, INVOICE_PAYMENT_METHOD_LABELS, moneyText } from "@/lib/invoice-ledger";
import { inventoryMessage, newClientRequestId, runInventoryCall, type InventorySale } from "@/lib/inventory";
import {
  canSwitchToCredit,
  emptySwitchToCreditDraft,
  neverCreditText,
  paidNowSplitText,
  switchDraftKey,
  switchSplit,
  switchToCreditConfirmText,
  switchToCreditRequest,
  switchToPaidConfirmText,
  switchToPaidDraftFrom,
  switchToPaidRequest,
  switchedText,
  validateSwitchToCreditDraft,
  validateSwitchToPaidDraft,
  type SwitchToCreditDraft,
  type SwitchToPaidDraft,
} from "@/lib/inventory-credit";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/**
 * Switches a recorded sale between paid and credit (docs/INVENTORY.md v6).
 * A paid sale goes on credit with the questions a credit sale asks in the
 * app (what was paid at the time, the customer, the collector, the due date);
 * a credit sale nothing was collected on becomes paid ("it was never
 * credit") with how it was paid and who received it, prefilled from the
 * sale. Both confirm first; the same answers sent again reuse their request
 * id, so a retry is the same switch. The sale row updates live once it lands.
 */
export function InventorySaleSwitchDialog({
  businessId,
  sale,
  staffOptions,
  todayKey,
  onClose,
  onFlash,
}: {
  businessId: string;
  sale: InventorySale;
  /** The business's people, for the collector and "Received by". */
  staffOptions: readonly { id: string; name: string }[];
  /** Today in the shops' zone, the earliest due date. */
  todayKey: string;
  onClose: () => void;
  onFlash: (message: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const toCredit = canSwitchToCredit(sale);
  const [credit, setCredit] = useState<SwitchToCreditDraft>(emptySwitchToCreditDraft);
  const [paid, setPaid] = useState<SwitchToPaidDraft>(() => switchToPaidDraftFrom(sale));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef({ key: "", id: "" });
  const split = switchSplit(credit, sale.totalCents);
  // A person who is no longer in the team list still shows, so the select never looks empty.
  const receiverOptions = paid.receivedByStaffId && paid.receivedByStaffId !== BUSINESS_ACCOUNT_RECEIVER && !staffOptions.some((s) => s.id === paid.receivedByStaffId)
    ? [...staffOptions, { id: paid.receivedByStaffId, name: paid.receivedByStaffId }]
    : staffOptions;

  /** One request id per set of answers: the same answers sent again are a retry. */
  function requestIdFor(key: string): string {
    if (attempt.current.key !== key || !attempt.current.id) attempt.current = { key, id: newClientRequestId() };
    return attempt.current.id;
  }

  async function submit() {
    if (busy) return;
    const problems = toCredit ? validateSwitchToCreditDraft(credit, sale.totalCents, todayKey) : validateSwitchToPaidDraft(paid);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    const name = credit.customerName.trim();
    const ok = toCredit
      ? await confirmImportantAction(switchToCreditConfirmText(name, split, "en"), switchToCreditConfirmText(name, split, "fr"))
      : await confirmImportantAction(switchToPaidConfirmText(sale.totalCents, "en"), switchToPaidConfirmText(sale.totalCents, "fr"));
    if (!ok) return;
    await runInventoryCall(setBusy, async () => {
      const call = httpsCallable(functions, "switchInventorySalePayment");
      if (toCredit) {
        await call(switchToCreditRequest(businessId, sale.id, requestIdFor(switchDraftKey("credit", credit)), credit));
      } else {
        await call(switchToPaidRequest(businessId, sale.id, requestIdFor(switchDraftKey("paid", paid)), paid));
      }
      onFlash(switchedText(toCredit ? "credit" : "paid", split.creditCents, lang));
      onClose();
    }, (failure) => setError(failure.message));
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>{toCredit ? "Put this sale on credit" : "Mark this sale as paid"}</h3>
            <p data-no-translate>{moneyText(sale.totalCents)}</p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          {toCredit ? (
            <>
              <p className="lst-hint">The customer did not pay it all. Say who owes the rest. What was paid at the time keeps how it was paid and who received it.</p>
              <div className="lst-form-grid">
                <label className="lst-field wide"><span>How much did they pay at the time? ($)</span>
                  <input inputMode="decimal" value={credit.paidNow} onChange={(e) => setCredit((d) => ({ ...d, paidNow: e.target.value }))} placeholder="0.00" disabled={busy} autoFocus />
                </label>
                <label className="lst-field wide"><span>Customer name</span>
                  <input value={credit.customerName} onChange={(e) => setCredit((d) => ({ ...d, customerName: e.target.value }))} disabled={busy} autoComplete="off" />
                </label>
                <div className="lst-field wide ctn-phone">
                  <CustomerPhoneField
                    id="ivt-switch-phone"
                    label="Customer phone (optional)"
                    value={credit.customerPhone}
                    onChange={(value) => setCredit((d) => ({ ...d, customerPhone: value }))}
                    disabled={busy}
                  />
                </div>
                <label className="lst-field"><span>Who collects it</span>
                  <select value={credit.collectorStaffId} disabled={busy} onChange={(e) => setCredit((d) => ({ ...d, collectorStaffId: e.target.value }))}>
                    <option value="">Choose staff</option>
                    {staffOptions.map((s) => (<option key={s.id} value={s.id} data-no-translate>{s.name}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Due date</span>
                  <input type="date" value={credit.dueDate} min={todayKey} disabled={busy} onChange={(e) => setCredit((d) => ({ ...d, dueDate: e.target.value }))} aria-label="Due date" />
                </label>
              </div>
              <div className="wpk-inline-actions">
                <button className="lst-btn ghost" type="button" disabled={busy || !credit.dueDate} onClick={() => setCredit((d) => ({ ...d, dueDate: "" }))}>Remove the due date</button>
                <small className="lst-hint" data-no-translate>{paidNowSplitText(split.paidNowCents, split.creditCents, lang)}</small>
              </div>
              <p className="lst-hint">The collector gets a notification. Past the due date, the collector and the owner are reminded every three days until it is paid.</p>
            </>
          ) : (
            <>
              <p className="lst-hint" data-no-translate>{neverCreditText(sale.totalCents, lang)}</p>
              <div className="lst-form-grid">
                <label className="lst-field"><span>How it was paid</span>
                  <select value={paid.method} disabled={busy} onChange={(e) => setPaid((d) => ({ ...d, method: e.target.value }))}>
                    {INVOICE_PAYMENT_METHODS.map((m) => (<option key={m} value={m}>{INVOICE_PAYMENT_METHOD_LABELS[m]}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Received by</span>
                  <select value={paid.receivedByStaffId} disabled={busy} onChange={(e) => setPaid((d) => ({ ...d, receivedByStaffId: e.target.value }))}>
                    <ReceivedByOptions staffOptions={receiverOptions} placeholder="Choose staff" />
                  </select>
                </label>
              </div>
            </>
          )}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void submit()}>
            {busy ? <RefreshCw className="spin" size={16} /> : <ArrowLeftRight size={16} />}
            {busy ? "Saving..." : toCredit ? "Switch to credit" : "Switch to paid"}
          </button>
        </footer>
      </div>
    </div>
  );
}
