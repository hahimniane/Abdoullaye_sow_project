"use client";

import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Check, Clock3, Send, X } from "lucide-react";

import { confirmImportantAction } from "@/lib/action-confirmation";
import {
  VIEWING_BLOCK_MESSAGES,
  VIEWING_SLOT_ERROR_MESSAGES,
  carPurchaseIsViewing,
  formatViewingSlot,
  validateViewingSlots,
  viewingActionAvailability,
  viewingActionPayload,
  viewingHistoryFrom,
  viewingHistoryLabel,
  viewingRecordFrom,
  viewingSlotFromInput,
  viewingSlotInputMin,
  viewingStatusLabel,
  viewingWaitingLabel,
  type ViewingAction,
  type ViewingSlot,
} from "@/lib/car-viewing";
import { functions } from "@/lib/firebase";
import type { FirestoreRow } from "@/types/admin";

/**
 * The customer's half of a car-viewing negotiation.
 *
 * A viewing used to be a time the customer picked and the seller found out
 * about later, so there was nothing here to show. Now both sides have to
 * agree, and this is where the buyer sees what has been offered, takes one of
 * the times, offers one back, or pulls out.
 *
 * Which buttons exist comes from `viewingActionAvailability`, the console's
 * copy of the server's rules, so nothing is offered that `actOnCarViewing`
 * would refuse. Unlike the business console this passes no `carStatus`: the
 * customer's orders view holds no listing documents, so a viewing on a
 * withdrawn car keeps its buttons and the callable's own sentence is what the
 * buyer reads. Cancel is never gated on the listing either way.
 */
export function CustomerCarViewing({ row }: { row: FirestoreRow }) {
  // Every window here is measured against the hour before an appointment, so
  // an open drawer has to stop offering an action when that hour arrives.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const [chosenSlotMs, setChosenSlotMs] = useState(0);
  const [proposing, setProposing] = useState(false);
  const [proposedAt, setProposedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const record = viewingRecordFrom(row);
  const available = viewingActionAvailability({ record, actor: "customer", nowMs });
  const history = viewingHistoryFrom(row);
  const waiting = viewingWaitingLabel(record.purchaseStatus, "customer");
  const selected =
    available.acceptableSlots.find((slot) => slot.startAtMs === chosenSlotMs) ??
    available.acceptableSlots[0];

  async function act(
    action: ViewingAction,
    slots: ViewingSlot[],
    success: string,
    confirm: string,
    confirmFr: string,
  ) {
    if (busy) return;
    if (!(await confirmImportantAction(confirm, confirmFr))) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await httpsCallable(functions, "actOnCarViewing")(
        viewingActionPayload({ purchaseId: row.id, action, slots }),
      );
      setNotice(success);
    } catch (callableError) {
      // Every refusal this callable gives is already a sentence written for
      // the person reading it, so it is shown as it arrives rather than
      // replaced with a generic failure line.
      setError(
        callableError instanceof Error
          ? callableError.message
          : "The viewing could not be updated. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function sendProposal() {
    const slot = viewingSlotFromInput(proposedAt);
    const slots = slot ? [slot] : [];
    const slotError = validateViewingSlots(slots, nowMs, available.maxSlots);
    if (slotError) {
      setError(VIEWING_SLOT_ERROR_MESSAGES[slotError]);
      return;
    }
    setProposing(false);
    setProposedAt("");
    void act(
      "propose",
      slots,
      "Your time was sent to the seller.",
      "Send this time to the seller?",
      "Envoyer cet horaire au vendeur ?",
    );
  }

  if (!carPurchaseIsViewing(row)) return null;

  const statusName = viewingStatusLabel(record.purchaseStatus);
  const scheduled = record.purchaseStatus === "viewing_scheduled";

  return (
    <section className="customer-viewing">
      <h3>Viewing appointment</h3>

      <div className="customer-order-facts">
        {statusName && (
          <div><span>Viewing status</span><strong>{statusName}</strong></div>
        )}
        {scheduled && record.appointmentStartMs != null && (
          <div><span>Agreed time</span><strong>{formatViewingSlot(record.appointmentStartMs)}</strong></div>
        )}
        {waiting && <div><span>Waiting on</span><strong>{waiting}</strong></div>}
        {record.respondByAtMs != null && (
          <div><span>Reply by</span><strong>{formatViewingSlot(record.respondByAtMs)}</strong></div>
        )}
      </div>

      {available.blockedReason !== "" && available.blockedReason !== "closed" && (
        <div className="info-band">{VIEWING_BLOCK_MESSAGES[available.blockedReason]}</div>
      )}
      {available.open && available.proposalsLeft === 0 && (
        <div className="info-band">
          You have offered as many times as this booking allows. Take one of the
          times on the table, or cancel the viewing.
        </div>
      )}

      {record.proposedSlots.length > 0 && available.blockedReason !== "closed" && (
        <div className="viewing-slots">
          <small>{available.canAccept ? "Pick a time to accept" : "Times on the table"}</small>
          {record.proposedSlots.map((slot) => {
            const acceptable = available.acceptableSlots.some(
              (item) => item.startAtMs === slot.startAtMs,
            );
            return (
              <label className="viewing-slot" key={slot.startAtMs}>
                {available.canAccept ? (
                  <input
                    checked={selected?.startAtMs === slot.startAtMs}
                    disabled={busy || !acceptable}
                    name={`customer-viewing-slot-${row.id}`}
                    onChange={() => setChosenSlotMs(slot.startAtMs)}
                    type="radio"
                  />
                ) : (
                  <Clock3 size={14} />
                )}
                <span>{formatViewingSlot(slot.startAtMs)}</span>
                {/* Shown but not selectable: a time inside the last hour can no
                    longer be agreed, and hiding it would make the seller's
                    offer look smaller than it was. */}
                {!acceptable && <span className="status-pill compact">Too soon</span>}
              </label>
            );
          })}
        </div>
      )}

      {proposing && (
        <div className="customer-form-grid">
          <label>
            Time you would like
            <input
              min={viewingSlotInputMin(nowMs)}
              onChange={(event) => setProposedAt(event.target.value)}
              type="datetime-local"
              value={proposedAt}
            />
          </label>
        </div>
      )}

      {history.length > 0 && (
        <details className="viewing-history">
          <summary>Negotiation history</summary>
          <ol>
            {history.map((entry) => (
              <li key={`${entry.atMs}-${entry.actor}-${entry.action}`}>
                <b>{viewingHistoryLabel(entry)}</b>
                {entry.slots.length > 0 && (
                  <span>{entry.slots.map((slot) => formatViewingSlot(slot.startAtMs)).join(" · ")}</span>
                )}
                <small>{formatViewingSlot(entry.atMs)}</small>
              </li>
            ))}
          </ol>
        </details>
      )}

      {error && <div className="error-box">{error}</div>}
      {notice && <span className="status-pill compact">{notice}</span>}

      {available.open && (
        <div className="button-row">
          {proposing ? (
            <>
              <button
                className="primary-button"
                data-loading={busy}
                disabled={busy}
                onClick={sendProposal}
                type="button"
              >
                <Send size={16} /> Send this time
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setProposing(false);
                  setProposedAt("");
                  setError("");
                }}
                type="button"
              >
                Discard this time
              </button>
            </>
          ) : (
            <>
              {available.canAccept && (
                <button
                  className="primary-button"
                  data-loading={busy}
                  disabled={busy || !selected}
                  onClick={() => selected && void act(
                    "accept",
                    [selected],
                    "Viewing confirmed.",
                    "Confirm this viewing time?",
                    "Confirmer cet horaire de visite ?",
                  )}
                  type="button"
                >
                  <Check size={16} /> Accept this time
                </button>
              )}
              {available.canPropose && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setProposing(true)}
                  type="button"
                >
                  <Clock3 size={16} />
                  {scheduled ? "Propose a new time" : "Offer a different time"}
                </button>
              )}
              {/* Last, and always on offer while the viewing is open — a buyer
                  who cannot come must never be stuck leaving the seller
                  waiting. */}
              {available.canCancel && (
                <button
                  className="danger-button"
                  data-loading={busy}
                  disabled={busy}
                  onClick={() => void act(
                    "cancel",
                    [],
                    "Viewing cancelled.",
                    "Cancel this viewing?",
                    "Annuler cette visite ?",
                  )}
                  type="button"
                >
                  <X size={16} /> Cancel viewing
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
