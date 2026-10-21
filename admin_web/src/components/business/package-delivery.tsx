"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { PackageCheck, RefreshCw, RotateCcw, X } from "lucide-react";

import { confirmImportantAction } from "@/lib/action-confirmation";
import { containerLineTitle, containerLineTitleIsCopy } from "@/lib/container-manifest";
import {
  DELIVERY_NOT_ARRIVED_HINT,
  DELIVERY_PROGRESS_COPY,
  MAX_COLLECTED_BY,
  collectedByError,
  defaultCollectedBy,
  deliverAnswerFrom,
  deliverRequest,
  deliverResultText,
  deliveryBalanceWarning,
  deliveryRefusalFrom,
  deliveryRefusalText,
  deliveryStage,
  lineDelivery,
  undoDeliveryRequest,
  undoResultText,
  type DeliveryAccess,
} from "@/lib/container-delivery";
import { functions } from "@/lib/firebase";
import { currentLanguage, formatDateTime, text } from "@/lib/format";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import { statusPillClass } from "@/lib/status-pill";

type Row = Record<string, unknown>;

// Package delivered at the destination (lib/container-delivery.ts, the
// server's container_delivery.js): the dialog that marks it, the undo, and
// how a delivered package reads. Shared by the Deliveries tab, the staff view
// of a package (tracking page) and the containers panel's package list.

/**
 * Mark one package delivered: who collected it (the receiver unless someone
 * collected for them), then - when it still owes money - a warning to
 * confirm. The balance is a warning, never a block. `balanceCents` is what
 * the screen already knows the package owes; when the server finds a balance
 * the screen did not (an older copy of the line), the warning shows then.
 */
export function MarkDeliveredDialog({
  businessId,
  line,
  balanceCents,
  canSeeMoney,
  onClose,
  onDone,
}: {
  businessId: string;
  line: Row;
  /** What the package (its whole group) owes, as far as the screen knows; 0 for nothing. */
  balanceCents: number;
  canSeeMoney: boolean;
  onClose: () => void;
  /** After the server answered: the sentence to show where the dialog was opened. */
  onDone: (message: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const lineId = text(line.id, "");
  const [collectedBy, setCollectedBy] = useState(() => defaultCollectedBy(line));
  // "details": who collected it. "balance": the unpaid-balance warning.
  const [step, setStep] = useState<"details" | "balance">("details");
  // The amount the warning names: the screen's, or the server's when it found one.
  const [owedCents, setOwedCents] = useState<number | null>(balanceCents > 0 ? balanceCents : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const owes = balanceCents > 0;
  const close = () => {
    if (!busy) onClose();
  };

  async function deliver(acknowledgeBalance: boolean) {
    const tooLong = collectedByError(collectedBy);
    if (tooLong) {
      setError(deliveryRefusalText({ reason: tooLong }));
      return;
    }
    setError("");
    setBusy(true);
    try {
      const response = await httpsCallable(functions, "updateContainerLine")(
        deliverRequest({ businessId, lineId, collectedBy, acknowledgeBalance }),
      );
      onDone(deliverResultText(deliverAnswerFrom(response.data)));
      onClose();
    } catch (failure) {
      const refusal = deliveryRefusalFrom(failure);
      if (refusal.reason === "delivery_balance_due") {
        // The screen thought it was paid: show the warning, let them confirm.
        setOwedCents(refusal.balanceCents);
        setStep("balance");
      } else {
        setError(deliveryRefusalText(refusal));
      }
    } finally {
      setBusy(false);
    }
  }

  const primaryLabel = busy ? DELIVERY_PROGRESS_COPY.deliver : step === "balance" ? "Mark delivered anyway" : "Mark delivered";

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(close)}>
      <div className="lst-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>Mark delivered</h3>
            <p>
              <code className="ctn-code" data-no-translate>{text(line.trackingCode, "")}</code>{" "}
              <span data-no-translate={containerLineTitleIsCopy(line) ? undefined : true}>{containerLineTitle(line, lang)}</span>
            </p>
          </div>
          <button className="lst-icon-btn" type="button" disabled={busy} onClick={close} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          {step === "details" ? (
            <>
              <label className="lst-field wide">
                <span>Picked up by</span>
                <input
                  autoFocus
                  disabled={busy}
                  maxLength={MAX_COLLECTED_BY}
                  onChange={(e) => setCollectedBy(e.target.value)}
                  value={collectedBy}
                />
              </label>
              <p className="lst-hint">The receiver, unless someone collects for them.</p>
              {owes && <p className="dlv-warning" role="status" data-no-translate>{deliveryBalanceWarning(balanceCents, canSeeMoney, lang)}</p>}
            </>
          ) : (
            <>
              <p className="dlv-warning" role="alert" data-no-translate>{deliveryBalanceWarning(owedCents, canSeeMoney, lang)}</p>
              <p className="lst-hint">Mark it delivered anyway? The balance stays on the package.</p>
            </>
          )}
        </div>
        <footer className="lst-modal-foot">
          {step === "balance" ? (
            <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => setStep("details")}>Back</button>
          ) : (
            <button className="lst-btn ghost" type="button" disabled={busy} onClick={close}>Cancel</button>
          )}
          <button
            aria-busy={busy}
            className="lst-btn"
            disabled={busy}
            onClick={() => {
              // A package that owes money asks again before it goes.
              if (step === "details" && owes) setStep("balance");
              else void deliver(step === "balance");
            }}
            type="button"
          >
            {busy ? <RefreshCw className="spin" size={14} /> : <PackageCheck size={14} />} {primaryLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Undo a delivery (owners, admins and the containers permission only): the
 * package goes back to ready for pickup. Nobody is messaged.
 */
export function UndoDeliveryButton({
  businessId,
  line,
  onDone,
  variant = "button",
}: {
  businessId: string;
  line: Row;
  onDone: (message: string) => void;
  /** "icon" in a table row's actions, "button" elsewhere. */
  variant?: "button" | "icon";
}) {
  const [busy, setBusy] = useState(false);

  async function undo() {
    const ok = await confirmImportantAction(
      `Undo the delivery of ${containerLineTitle(line, "en")}? It goes back to ready for pickup. Nobody is messaged.`,
      `Annuler la livraison de ${containerLineTitle(line, "fr")} ? Le colis redevient prêt à récupérer. Personne n’est prévenu.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const response = await httpsCallable(functions, "updateContainerLine")(
        undoDeliveryRequest(businessId, text(line.id, "")),
      );
      onDone(undoResultText(response.data));
    } catch (failure) {
      onDone(deliveryRefusalText(deliveryRefusalFrom(failure)));
    } finally {
      setBusy(false);
    }
  }

  if (variant === "icon") {
    return (
      <button
        aria-busy={busy}
        aria-label={busy ? DELIVERY_PROGRESS_COPY.undo : "Undo delivery"}
        className="ghost-button"
        disabled={busy}
        onClick={() => void undo()}
        title="Undo delivery"
        type="button"
      >
        {busy ? <RefreshCw className="spin" size={14} /> : <RotateCcw size={14} />}
      </button>
    );
  }
  return (
    <button aria-busy={busy} className="secondary-button" disabled={busy} onClick={() => void undo()} type="button">
      {busy ? <RefreshCw aria-hidden="true" className="spin" size={15} /> : <RotateCcw aria-hidden="true" size={15} />}{" "}
      {busy ? DELIVERY_PROGRESS_COPY.undo : "Undo delivery"}
    </button>
  );
}

/** A delivered package in a list: the chip and who collected it. Nothing when not delivered. */
export function LineDeliveredChip({ line }: { line: Row }) {
  const delivery = lineDelivery(line);
  if (!delivery.delivered) return null;
  return (
    <>
      <span className={statusPillClass("ok")}>Delivered</span>
      {delivery.collectedBy && (
        <small>
          <span>Picked up by</span> <span data-no-translate>{delivery.collectedBy}</span>
        </small>
      )}
    </>
  );
}

/**
 * The delivery block of one package (the staff view): delivered when, by
 * whom and to whom, with Undo for a manager; or Mark delivered once its
 * container is ready for pickup; or why not yet.
 */
export function PackageDeliverySection({
  businessId,
  line,
  container,
  balanceCents,
  access,
}: {
  businessId: string;
  line: Row;
  /** The line's own container, or null while unknown. */
  container: Row | null;
  balanceCents: number;
  access: DeliveryAccess;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const stage = deliveryStage(line, container);
  const delivery = lineDelivery(line);

  return (
    <section className="pkg-staff-section">
      <h3>Delivery</h3>
      {notice && (
        <p className="dlv-notice" role="status">
          {notice}{" "}
          <button className="ghost-button" type="button" onClick={() => setNotice("")}>Dismiss</button>
        </p>
      )}
      {stage === "delivered" ? (
        <>
          <div className="pur-info">
            <div><span>Delivered</span><b>{delivery.deliveredAt ? formatDateTime(delivery.deliveredAt) : "—"}</b></div>
            <div><span>Picked up by</span>{delivery.collectedBy ? <b data-no-translate>{delivery.collectedBy}</b> : <b>—</b>}</div>
            <div><span>Handed over by</span>{delivery.deliveredByName ? <b data-no-translate>{delivery.deliveredByName}</b> : <b>—</b>}</div>
          </div>
          {access.canUndo && (
            <div className="dlv-actions">
              <UndoDeliveryButton businessId={businessId} line={line} onDone={setNotice} />
            </div>
          )}
        </>
      ) : stage === "ready" ? (
        <>
          <p className="pkg-staff-muted">Ready to hand over.</p>
          {access.canDeliver && (
            <div className="dlv-actions">
              <button className="primary-button" type="button" onClick={() => { setNotice(""); setDialogOpen(true); }}>
                <PackageCheck aria-hidden="true" size={16} /> Mark delivered
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="pkg-staff-muted">{DELIVERY_NOT_ARRIVED_HINT}</p>
      )}
      {dialogOpen && (
        <MarkDeliveredDialog
          balanceCents={balanceCents}
          businessId={businessId}
          canSeeMoney={access.canSeeMoney}
          line={line}
          onClose={() => setDialogOpen(false)}
          onDone={setNotice}
        />
      )}
    </section>
  );
}
