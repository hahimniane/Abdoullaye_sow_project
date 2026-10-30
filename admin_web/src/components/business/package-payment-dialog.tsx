"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Banknote, RefreshCw, Undo2, X } from "lucide-react";

import { ReceivedByOptions } from "@/components/business/received-by-options";
import { confirmImportantAction } from "@/lib/action-confirmation";
import { useBusinessCollection } from "@/lib/business-data";
import { containerLineTitle } from "@/lib/container-manifest";
import { functions } from "@/lib/firebase";
import { currentLanguage, formatDateTime, text } from "@/lib/format";
import { groupRootId, linePickupFeeCents, type LineGroupSummary } from "@/lib/line-pieces";
import { INVOICE_PAYMENT_METHODS, INVOICE_PAYMENT_METHOD_LABELS, moneyText, type InvoicePaymentMethod } from "@/lib/invoice-ledger";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import {
  PACKAGE_PAYMENT_LABELS,
  PACKAGE_PAYMENT_TONES,
  emptyPackagePaymentDraft,
  groupForLine,
  groupMoneyNote,
  groupPayment,
  linePaidFloor,
  packageHasPieces,
  packagePayment,
  packagePaymentEntries,
  partHintText,
  packagePaymentMessage,
  packagePriceMessage,
  recordPackagePaymentRequest,
  revertPackagePaymentRequest,
  runPackageCall,
  setPackagePriceRequest,
  validatePackagePaymentDraft,
  validatePackagePrice,
  waitingPackageDraftFromRow,
  wholeBalanceInput,
  type PackagePaymentDraft,
} from "@/lib/waiting-packages";
import { statusPillClass } from "@/lib/status-pill";
import { zelleCheckable } from "@/lib/zelle-check";
import { ZelleCheckButton } from "@/components/business/zelle-check-button";

type Row = Record<string, unknown>;

/**
 * Record a payment on a package, see who took what, and revert a mistake.
 * Modelled on the invoice ledger's "Record a payment": the amount is dollars
 * as typed and cents on the wire, never above what is still owed; any staff
 * member may record or revert, and every change names who made it. The price
 * and the pay-on-arrival switch live here too, since a payment is only
 * meaningful against a price.
 *
 * `line` is the live row, so the balance moves as the server's answer lands.
 * A package split across containers is one group: its `group` gives the
 * balance of the whole, the payment is recorded with this part's id (the
 * server puts it on the root) and the list shows the root's payments.
 */
export function PackagePaymentDialog({
  businessId,
  line,
  group: groupProp,
  staffName,
  staffOptions,
  onClose,
  onFlash,
}: {
  businessId: string;
  line: Row;
  /** The line's split group, from the lines the panel holds; its own one-line group when absent. */
  group?: LineGroupSummary;
  staffName: (id: string) => string;
  /** The business's people, for "Received by". */
  staffOptions: readonly { id: string; name: string }[];
  onClose: () => void;
  onFlash: (message: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const lineId = text(line.id, "");
  const group = groupProp ?? groupForLine(null, line);
  // The group's money: a part's balance is the whole package's.
  const payment = groupPayment(group);
  const own = packagePayment(line);
  // Payments live on the root of the group (the line itself when never split).
  const paymentsLineId = group.rootLineId || groupRootId(line, lineId);
  const pieced = packageHasPieces(line);
  // A collected request's pickup fee: its own amount, inside the price.
  const ownFee = linePickupFeeCents(line);
  const partHint = partHintText(group, line, lang);
  const groupNote = groupMoneyNote(group, lang);
  // The line's (its root's) payments, live. The business filter is what the
  // rule authorizes the read by; the line filter narrows it.
  const history = useBusinessCollection("containerLinePayments", businessId, Boolean(paymentsLineId), {
    pageSize: null,
    where: [["lineId", "==", paymentsLineId]],
    sort: "query",
  });
  const entries = packagePaymentEntries(history.rows);

  const [draft, setDraft] = useState<PackagePaymentDraft>(emptyPackagePaymentDraft);
  const [priceText, setPriceText] = useState(() => waitingPackageDraftFromRow(line).price);
  const [payOnArrival, setPayOnArrival] = useState(own.payOnArrival);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fail = (failure: { message: string }) => setError(failure.message);

  async function record() {
    const errors = validatePackagePaymentDraft(draft, payment);
    if (errors.length) {
      setError(packagePaymentMessage(errors));
      return;
    }
    setError("");
    await runPackageCall(setBusy, async () => {
      await httpsCallable(functions, "recordContainerLinePayment")(recordPackagePaymentRequest(businessId, lineId, draft));
      // The next payment may be taken by someone else: start blank, as parking does.
      setDraft(emptyPackagePaymentDraft);
      onFlash("Payment recorded.");
    }, fail);
  }

  async function revert(entryId: string, amountCents: number) {
    const ok = await confirmImportantAction(
      `Revert the ${moneyText(amountCents)} payment? The balance goes back up.`,
      `Annuler le paiement de ${moneyText(amountCents, "fr")} ? Le solde remonte.`,
    );
    if (!ok) return;
    setError("");
    await runPackageCall(setBusy, async () => {
      await httpsCallable(functions, "revertContainerLinePayment")(revertPackagePaymentRequest(businessId, entryId));
      onFlash("Payment reverted.");
    }, fail);
  }

  async function savePrice() {
    // A package with pieces is priced piece by piece (Edit package): here its
    // total goes back unchanged, so the server only toggles pay on arrival.
    if (pieced) {
      setError("");
      await runPackageCall(setBusy, async () => {
        await httpsCallable(functions, "setContainerLinePrice")({ businessId, lineId, priceCents: own.priceCents, payOnArrival });
        onFlash("Price saved.");
      }, fail);
      return;
    }
    // A part may not take its group below what the root was paid.
    const problems = validatePackagePrice(priceText, linePaidFloor(group, line));
    if (problems.length) {
      setError(packagePriceMessage(problems));
      return;
    }
    setError("");
    await runPackageCall(setBusy, async () => {
      await httpsCallable(functions, "setContainerLinePrice")(setPackagePriceRequest(businessId, lineId, priceText, payOnArrival));
      onFlash("Price saved.");
    }, fail);
  }

  const owed = payment.balanceCents === null ? "No price yet" : null;

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>Record a payment</h3>
            <p>
              <span data-no-translate>{containerLineTitle(line, lang)}</span>
              {" — "}
              {owed ? <span>{owed}</span> : <span data-no-translate>{moneyText(payment.balanceCents, lang)}</span>}
              {payment.balanceCents !== null && <> <span>still owed</span></>}
            </p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          <p className="wpk-money-line">
            <span className={statusPillClass(PACKAGE_PAYMENT_TONES[payment.status])}>{PACKAGE_PAYMENT_LABELS[payment.status]}</span>
            {payment.priceCents !== null && (
              <small data-no-translate>
                {moneyText(payment.paidCents, lang)} / {moneyText(payment.priceCents, lang)}
              </small>
            )}
            {partHint && <small className="wpk-part-hint" data-no-translate>{partHint}</small>}
          </p>
          {groupNote && <p className="lst-hint" data-no-translate>{groupNote}</p>}
          {group.partCount > 1 && group.pickupFeeCents > 0 && (
            <p className="lst-hint wpk-fee-line"><span>Includes the pickup fee</span> <span data-no-translate>{moneyText(group.pickupFeeCents, lang)}</span></p>
          )}

          <div className="lst-form-grid">
            {pieced ? (
              <div className="lst-field">
                <span>Price</span>
                <strong data-no-translate>{own.priceCents === null ? "—" : moneyText(own.priceCents, lang)}</strong>
                {ownFee > 0 && <small className="lst-hint wpk-fee-line"><span>Pickup fee</span> <span data-no-translate>{moneyText(ownFee, lang)}</span></small>}
                <small className="lst-hint">Set each piece&apos;s price in Edit package.</small>
              </div>
            ) : (
              <label className="lst-field"><span>Price ($)</span>
                <input inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)} placeholder={lang === "fr" ? "0,00" : "0.00"} disabled={busy} />
              </label>
            )}
            <label className="ctn-notify wpk-pay-arrival">
              <input type="checkbox" checked={payOnArrival} disabled={busy} onChange={(e) => setPayOnArrival(e.target.checked)} />
              <span>Pay on arrival</span>
            </label>
          </div>
          <div className="wpk-inline-actions">
            <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => void savePrice()}>{pieced ? "Save pay on arrival" : "Save price"}</button>
          </div>

          {payment.balanceCents !== null && (
            <>
              <div className="lst-form-grid wpk-payment-form">
                <label className="lst-field"><span>Amount received ($)</span>
                  <input inputMode="decimal" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} placeholder={lang === "fr" ? "0,00" : "0.00"} disabled={busy} autoFocus />
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
                <button
                  className="lst-btn ghost"
                  type="button"
                  disabled={busy || payment.balanceCents === 0}
                  onClick={() => setDraft((d) => ({ ...d, amount: wholeBalanceInput(payment) }))}
                >
                  Pay the whole balance
                </button>
              </div>
            </>
          )}

          <h4 className="wpk-history-title">Payments</h4>
          {history.loading && entries.length === 0 ? (
            <p className="panel-lede">Loading…</p>
          ) : entries.length === 0 ? (
            <div className="empty-state">No payments recorded yet.</div>
          ) : (
            <ul className="wpk-history">
              {entries.map((entry) => {
                const received = staffName(entry.receivedByStaffId);
                // Only when someone else typed it in; older rows have no such field.
                const entered = entry.recordedByStaffId && entry.recordedByStaffId !== entry.receivedByStaffId
                  ? staffName(entry.recordedByStaffId)
                  : "";
                const revertedBy = staffName(entry.revertedByStaffId);
                return (
                  <li className={entry.reverted ? "wpk-reverted" : undefined} key={entry.id}>
                    <div>
                      <strong data-no-translate>{moneyText(entry.amountCents, lang)}</strong>
                      {" "}<span>{entry.methodLabel}</span>
                      {entry.note && <small data-no-translate>{entry.note}</small>}
                      <small>
                        <time data-no-translate>{formatDateTime(entry.at)}</time>
                        {received && <> · <span>Received by</span> <span data-no-translate>{received}</span></>}
                        {entered && <> · <span>entered by</span> <span data-no-translate>{entered}</span></>}
                      </small>
                      {entry.reverted && (
                        <small className="wpk-reverted-note">
                          <span>Reverted</span>
                          {revertedBy && <> · <span data-no-translate>{revertedBy}</span></>}
                        </small>
                      )}
                      {zelleCheckable({ method: entry.method, amountCents: entry.amountCents, voided: entry.reverted }) && (
                        <ZelleCheckButton businessId={businessId} kind="container_line_payment" id={entry.id} bankCheck={entry.bankCheck} enabled={!busy} />
                      )}
                    </div>
                    {!entry.reverted && (
                      <button className="ghost-button" type="button" disabled={busy} onClick={() => void revert(entry.id, entry.amountCents)} title="Revert payment" aria-label="Revert payment">
                        <Undo2 size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Close</button>
          {payment.balanceCents !== null && (
            <button className="lst-add" type="button" disabled={busy || payment.balanceCents === 0} aria-busy={busy} onClick={() => void record()}>
              {busy ? <RefreshCw className="spin" size={16} /> : <Banknote size={16} />}
              {busy ? "Saving..." : "Record payment"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
