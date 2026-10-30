"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref } from "firebase/storage";
import { Camera, ChevronDown, ChevronUp, PackageCheck, RefreshCw, RotateCcw, X } from "lucide-react";

import { ReceivedByMeOptions } from "@/components/business/received-by-options";
import { confirmImportantAction } from "@/lib/action-confirmation";
import { containerLineTitle, containerLineTitleIsCopy } from "@/lib/container-manifest";
import {
  DELIVERED_WITHOUT_CODE_LABEL,
  DELIVERY_NOT_ARRIVED_HINT,
  DELIVERY_PROGRESS_COPY,
  MAX_COLLECTED_BY,
  collectedByError,
  collectedDollarsToCents,
  defaultCollectedBy,
  deliverAnswerFrom,
  deliverRequest,
  deliverResultText,
  deliveryBalanceWarning,
  deliveryRefusalFrom,
  deliveryRefusalText,
  deliveryStage,
  lineDelivery,
  overrideError,
  pickupCodeAsked,
  pickupCodeComplete,
  pickupCodeDigits,
  proofPickupCodeOn,
  undoDeliveryRequest,
  undoResultText,
  type DeliveryAccess,
} from "@/lib/container-delivery";
import { db, functions, storage } from "@/lib/firebase";
import { currentLanguage, formatDateTime, text } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import { uploadPackagePhoto } from "@/lib/package-photo";
import { statusPillClass } from "@/lib/status-pill";

type Row = Record<string, unknown>;

// Package delivered at the destination (lib/container-delivery.ts, the
// server's container_delivery.js): the dialog that marks it, the undo, and
// how a delivered package reads. Shared by the Deliveries tab, the staff view
// of a package (tracking page) and the containers panel's package list.

/**
 * The business's "Pickup code at delivery" switch
 * (`businesses/{id}.packageProofSettings.pickupCode`, docs/AIR_PACKAGES.md
 * §2), read once per business. `null` while unknown; a business that cannot
 * be read counts as off (the server still judges the handover, and the
 * dialog shows the code field on its refusal).
 */
export function useProofPickupCode(businessId: string): boolean | null {
  const [state, setState] = useState<{ businessId: string; on: boolean } | null>(null);
  useEffect(() => {
    if (!businessId) return undefined;
    let active = true;
    getDoc(doc(db, "businesses", businessId))
      .then((snap) => {
        if (active) setState({ businessId, on: proofPickupCodeOn(snap.exists() ? snap.data() : {}) });
      })
      .catch(() => {
        if (active) setState({ businessId, on: false });
      });
    return () => {
      active = false;
    };
  }, [businessId]);
  return state && state.businessId === businessId ? state.on : null;
}

/** A photo in Storage as a thumbnail that opens full size (the delivered-without-code photo). */
function StoragePhoto({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    setUrl("");
    if (!path) return undefined;
    getDownloadURL(ref(storage, path))
      .then((next) => {
        if (active) setUrl(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [path]);
  if (!path || !url) return null;
  return (
    <a className="dlv-photo" href={url} rel="noopener noreferrer" target="_blank">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={alt} src={url} />
    </a>
  );
}

/**
 * Mark one package delivered: who collected it (the receiver unless someone
 * collected for them), the pickup code when the business asks for one (with
 * "Deliver without a code" - a name and a photo - when the receiver has
 * none), the USD collected now, then - when it still owes money - a warning
 * to confirm. The balance is a warning, never a block. `balanceCents` is
 * what the screen already knows the package owes; when the server finds a
 * balance the screen did not (an older copy of the line), the warning shows
 * then. The line's own pickup code is never displayed here: a deliveries-only
 * agent must hear it from the receiver.
 */
export function MarkDeliveredDialog({
  businessId,
  line,
  balanceCents,
  canSeeMoney,
  askPickupCode = false,
  onClose,
  onDone,
}: {
  businessId: string;
  line: Row;
  /** What the package (its whole group) owes, as far as the screen knows; 0 for nothing. */
  balanceCents: number;
  canSeeMoney: boolean;
  /** The business switch is on and this line has a code (`pickupCodeAsked`). */
  askPickupCode?: boolean;
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
  // The pickup code (docs/AIR_PACKAGES.md §4.7). The server may ask for one
  // the screen did not know about (an older copy of the settings): then the
  // field appears on its refusal.
  const [codeAsked, setCodeAsked] = useState(askPickupCode);
  const [pickupCode, setPickupCode] = useState("");
  const [withoutCode, setWithoutCode] = useState(false);
  const [overrideName, setOverrideName] = useState(() => defaultCollectedBy(line));
  const [overridePhotoPath, setOverridePhotoPath] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  // USD collected at handover, typed in dollars.
  const [collectedTyped, setCollectedTyped] = useState("");
  // Who holds that money: the agent ("") or the Business account (docs/STAFF_BALANCES.md).
  const [collectedReceiver, setCollectedReceiver] = useState("");

  const collectedCents = collectedDollarsToCents(collectedTyped);
  const collectedNow = collectedCents !== null && Number.isFinite(collectedCents) ? collectedCents : 0;
  // What is still owed once the money collected now is counted (as the server counts it).
  const owedAfter = Math.max(0, balanceCents - collectedNow);
  const owes = owedAfter > 0;
  const close = () => {
    if (!busy) onClose();
  };

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    setError("");
    try {
      setOverridePhotoPath(await uploadPackagePhoto(businessId, file));
    } catch {
      setError(deliveryRefusalText({ reason: "photo_invalid" }));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function deliver(acknowledgeBalance: boolean) {
    const tooLong = collectedByError(collectedBy);
    if (tooLong) {
      setError(deliveryRefusalText({ reason: tooLong }));
      return;
    }
    if (collectedCents !== null && Number.isNaN(collectedCents)) {
      setError(deliveryRefusalText({ reason: "collected_cents_invalid" }));
      return;
    }
    const override = codeAsked && withoutCode ? { collectedBy: overrideName, photoPath: overridePhotoPath } : null;
    if (override) {
      const incomplete = overrideError(override);
      if (incomplete) {
        setError(deliveryRefusalText({ reason: incomplete }));
        return;
      }
    } else if (codeAsked && !pickupCodeComplete(pickupCode)) {
      setError(deliveryRefusalText({ reason: "pickup_code_invalid" }));
      return;
    }
    setError("");
    setBusy(true);
    try {
      const response = await httpsCallable(functions, "updateContainerLine")(
        deliverRequest({
          businessId,
          lineId,
          collectedBy,
          acknowledgeBalance,
          pickupCode: override ? "" : pickupCode,
          override,
          collectedCents: collectedNow,
          receivedByStaffId: collectedReceiver,
        }),
      );
      onDone(deliverResultText(deliverAnswerFrom(response.data), lang));
      onClose();
    } catch (failure) {
      const refusal = deliveryRefusalFrom(failure);
      if (refusal.reason === "delivery_balance_due") {
        // The screen thought it was paid: show the warning, let them confirm.
        setOwedCents(refusal.balanceCents);
        setStep("balance");
      } else {
        if (refusal.reason === "pickup_code_invalid") {
          // Wrong code, or a code the screen did not know was asked for.
          setCodeAsked(true);
          setStep("details");
        }
        setError(deliveryRefusalText(refusal));
      }
    } finally {
      setBusy(false);
    }
  }

  const primaryLabel = busy ? DELIVERY_PROGRESS_COPY.deliver : step === "balance" ? "Mark delivered anyway" : "Mark delivered";
  const owedText = canSeeMoney && balanceCents > 0 ? (lang === "fr" ? `Doit ${moneyText(owedAfter, "fr")}` : `Owes ${moneyText(owedAfter, "en")}`) : "";

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
              {codeAsked && !withoutCode && (
                <>
                  <label className="lst-field wide">
                    <span>Pickup code</span>
                    <input
                      autoComplete="one-time-code"
                      autoFocus
                      className="dlv-code-input"
                      data-no-translate
                      disabled={busy}
                      inputMode="numeric"
                      maxLength={4}
                      onChange={(e) => setPickupCode(pickupCodeDigits(e.target.value))}
                      pattern="[0-9]*"
                      placeholder="0000"
                      value={pickupCode}
                    />
                  </label>
                  <p className="lst-hint">The 4-digit code in the receiver's ready-for-pickup message.</p>
                </>
              )}
              {codeAsked && (
                <div className="dlv-override">
                  <button
                    aria-expanded={withoutCode}
                    className="ghost-button dlv-override-toggle"
                    disabled={busy}
                    onClick={() => setWithoutCode((open) => !open)}
                    type="button"
                  >
                    {withoutCode ? <ChevronUp aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />} Deliver without a code
                  </button>
                  {withoutCode && (
                    <div className="dlv-override-fields">
                      <p className="lst-hint">The package will show Delivered without code. Say who collected it and take their photo.</p>
                      <label className="lst-field wide">
                        <span>Who collected it</span>
                        <input
                          autoFocus
                          data-no-translate
                          disabled={busy}
                          maxLength={MAX_COLLECTED_BY}
                          onChange={(e) => setOverrideName(e.target.value)}
                          value={overrideName}
                        />
                      </label>
                      <div className="lst-field wide">
                        <span>Photo of the person collecting</span>
                        <div className="dlv-photo-row">
                          <input
                            accept="image/*"
                            capture="environment"
                            hidden
                            onChange={(e) => void choosePhoto(e)}
                            ref={photoInput}
                            type="file"
                          />
                          <button
                            aria-busy={photoBusy}
                            className="lst-btn ghost"
                            disabled={busy || photoBusy}
                            onClick={() => photoInput.current?.click()}
                            type="button"
                          >
                            {photoBusy ? <RefreshCw className="spin" size={14} /> : <Camera size={14} />}{" "}
                            {photoBusy ? "Uploading photo…" : overridePhotoPath ? "Retake photo" : "Take photo"}
                          </button>
                          {overridePhotoPath && <StoragePhoto alt="Photo of the person collecting" path={overridePhotoPath} />}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!withoutCode && (
                <>
                  <label className="lst-field wide">
                    <span>Picked up by</span>
                    <input
                      autoFocus={!codeAsked}
                      data-no-translate
                      disabled={busy}
                      maxLength={MAX_COLLECTED_BY}
                      onChange={(e) => setCollectedBy(e.target.value)}
                      value={collectedBy}
                    />
                  </label>
                  <p className="lst-hint">The receiver, unless someone collects for them.</p>
                </>
              )}
              <label className="lst-field wide">
                <span>Collected now ($)</span>
                <input
                  data-no-translate
                  disabled={busy}
                  inputMode="decimal"
                  onChange={(e) => setCollectedTyped(e.target.value)}
                  placeholder="0"
                  value={collectedTyped}
                />
              </label>
              {collectedNow > 0 && (
                <label className="lst-field wide">
                  <span>Received by</span>
                  <select disabled={busy} onChange={(e) => setCollectedReceiver(e.target.value)} value={collectedReceiver}>
                    <ReceivedByMeOptions />
                  </select>
                </label>
              )}
              <p className="lst-hint">
                <span>US dollars taken at handover, if any. It is recorded as a cash payment on the package.</span>
                {owedText && <> <strong data-no-translate>{owedText}</strong></>}
              </p>
              {owes && <p className="dlv-warning" role="status" data-no-translate>{deliveryBalanceWarning(owedAfter, canSeeMoney, lang)}</p>}
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
              if (photoBusy) return;
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
      {delivery.withoutCode && <span className={statusPillClass("warn")}>{DELIVERED_WITHOUT_CODE_LABEL}</span>}
      {delivery.collectedBy && (
        <small>
          <span>Picked up by</span> <span data-no-translate>{delivery.collectedBy}</span>
        </small>
      )}
      {delivery.photoPath && <StoragePhoto alt="Photo of the person who collected it" path={delivery.photoPath} />}
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
  const pickupCodeOn = useProofPickupCode(businessId);
  const lang = currentLanguage() === "fr" ? "fr" : "en";

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
            {delivery.withoutCode && <div><span>Pickup code</span><b>{DELIVERED_WITHOUT_CODE_LABEL}</b></div>}
            {access.canSeeMoney && delivery.collectedCents > 0 && (
              <div><span>Collected at handover</span><b data-no-translate>{moneyText(delivery.collectedCents, lang)}</b></div>
            )}
          </div>
          {delivery.photoPath && (
            <div className="dlv-photo-row">
              <StoragePhoto alt="Photo of the person who collected it" path={delivery.photoPath} />
            </div>
          )}
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
          askPickupCode={pickupCodeAsked({ pickupCode: pickupCodeOn === true }, line)}
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
