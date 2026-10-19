"use client";

import { useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { CheckCheck, Minus, Plus, RefreshCw, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import { currentLanguage } from "@/lib/format";
import { productDisplayName } from "@/lib/inventory";
import {
  MAX_TRANSFER_NOTE,
  arrivedOfText,
  clampQuantity,
  confirmReceivedText,
  didNotArriveText,
  fewerThanSentText,
  itemsFromText,
  newTransferRequestId,
  noteTooLong,
  readTypedQuantity,
  receiveCountsFrom,
  receiveShortfall,
  receiveTransferRequest,
  shortfallLineText,
  transferFailure,
  transferTimeText,
  type InventoryTransfer,
} from "@/lib/inventory-transfers";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/**
 * Confirm what arrived. Every line starts on what was sent: people change a
 * number only when it differs (0 up to what was sent, never more). When
 * everything arrived it is one click; when fewer did, a second step says how
 * many did not arrive and takes an optional "What happened?" note before
 * `receiveInventoryTransfer`. The received pieces can be sold in the
 * destination at once; the missing ones wait for the owner.
 */
export function InventoryTransferReceiveDialog({
  businessId,
  transfer,
  fromName,
  toName,
  zone,
  onClose,
  onFlash,
}: {
  businessId: string;
  transfer: InventoryTransfer;
  fromName: string;
  toName: string;
  zone: string;
  onClose: () => void;
  onFlash: (message: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const [counts, setCounts] = useState<Record<string, number>>(() => receiveCountsFrom(transfer));
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [step, setStep] = useState<"count" | "confirm">("count");
  const [note, setNote] = useState("");
  // One key per opening: a retry after a lost answer is the same receive.
  const [requestId] = useState(() => newTransferRequestId());
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");

  const shortfall = receiveShortfall(transfer, counts);

  function setCount(itemId: string, value: number, sent: number) {
    setCounts((current) => ({ ...current, [itemId]: clampQuantity(value, 0, sent) }));
    setTyped((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  function typeCount(itemId: string, value: string, sent: number) {
    setTyped((current) => ({ ...current, [itemId]: value }));
    const n = readTypedQuantity(value, 0, sent);
    if (n !== null) setCounts((current) => ({ ...current, [itemId]: n }));
  }

  async function confirm() {
    if (inFlight.current) return;
    if (step === "count" && shortfall.missing > 0) {
      setStep("confirm");
      return;
    }
    if (noteTooLong(note)) {
      setError("The note is too long.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await httpsCallable(functions, "receiveInventoryTransfer")(
        receiveTransferRequest(businessId, transfer, counts, shortfall.missing > 0 ? note : "", requestId),
      );
      onFlash(shortfall.missing > 0 ? "Received. The owner was told about the missing items." : "Received. The items can be sold in this store now.");
      onClose();
    } catch (failure) {
      setError(transferFailure(failure).message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const sentAt = transferTimeText(transfer.sentAtMs, lang, zone);
  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(busy ? () => undefined : onClose)}>
      <div className="lst-modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            {step === "count" ? (
              <>
                <h3 data-no-translate>{itemsFromText(transfer.itemsCount, fromName, lang)}</h3>
                <p>
                  <span data-no-translate>{toName}</span>{" · "}<code className="ctn-code" data-no-translate>{transfer.code}</code>
                  {sentAt && <> · <span data-no-translate>{sentAt}</span></>}
                  {transfer.sentByName && <> · <span data-no-translate>{transfer.sentByName}</span></>}
                </p>
              </>
            ) : (
              <>
                <h3 data-no-translate>{didNotArriveText(shortfall.missing, lang)}</h3>
                <p data-no-translate>{arrivedOfText(shortfall.received, shortfall.sent, lang)}</p>
              </>
            )}
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} disabled={busy} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          {step === "count" ? (
            <>
              <p className="lst-hint">Check the box against this list. If a number is different, change it before you confirm.</p>
              <ul className="ivt-tr-lines">
                {transfer.lines.map((line) => {
                  const counted = counts[line.itemId] ?? line.quantitySent;
                  const fewer = line.quantitySent - counted;
                  return (
                    <li key={line.itemId} className={fewer > 0 ? "ivt-tr-line-bad" : undefined}>
                      <div className="ivt-tr-line-main">
                        <strong data-no-translate>{productDisplayName(line)}</strong>
                        <small><span>Sent</span> <span data-no-translate>{line.quantitySent}</span></small>
                        {fewer > 0 && <small className="ivt-overdue" data-no-translate>{fewerThanSentText(fewer, lang)}</small>}
                      </div>
                      <div className="wpk-split-stepper">
                        <button className="ghost-button" type="button" disabled={busy || counted <= 0} onClick={() => setCount(line.itemId, counted - 1, line.quantitySent)} aria-label="One less"><Minus size={14} /></button>
                        <input
                          className="ivt-tr-qty"
                          inputMode="numeric"
                          value={typed[line.itemId] ?? String(counted)}
                          onChange={(e) => typeCount(line.itemId, e.target.value, line.quantitySent)}
                          onBlur={() => setCount(line.itemId, counted, line.quantitySent)}
                          disabled={busy}
                          aria-label="How many arrived"
                        />
                        <button className="ghost-button" type="button" disabled={busy || counted >= line.quantitySent} onClick={() => setCount(line.itemId, counted + 1, line.quantitySent)} aria-label="One more"><Plus size={14} /></button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="lst-hint">Once confirmed, these items can be sold in this store. Need tags? Print them from the product when you put it on the shelf.</p>
            </>
          ) : (
            <>
              <ul className="ivt-tr-sent-lines">
                {shortfall.lines.map((line) => (
                  <li key={line.itemId}>
                    <span data-no-translate>{shortfallLineText(line.name, line.sent, line.counted, lang)}</span>
                    <b className="ivt-neg" data-no-translate>{`-${line.sent - line.counted}`}</b>
                  </li>
                ))}
              </ul>
              <label className="lst-field wide"><span>What happened? (optional)</span>
                <textarea
                  rows={3}
                  value={note}
                  maxLength={MAX_TRANSFER_NOTE}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. The box arrived opened"
                  disabled={busy}
                />
              </label>
              <p className="lst-hint">They stay off the shelves until the owner decides what happened. What arrived can be sold now.</p>
            </>
          )}
        </div>
        <footer className="lst-modal-foot">
          {step === "confirm" ? (
            <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => setStep("count")}>Go back</button>
          ) : (
            <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          )}
          <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void confirm()}>
            {busy ? <RefreshCw className="spin" size={16} /> : <CheckCheck size={16} />}
            {busy ? <span>Saving...</span>
              : step === "confirm" ? <span data-no-translate>{confirmReceivedText(shortfall.received, lang)}</span>
              : <span>Confirm received</span>}
          </button>
        </footer>
      </div>
    </div>
  );
}
