"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { CreditCard, RefreshCw, RotateCcw, Send, X } from "lucide-react";

import { BoxDesigner } from "@/components/box-designer/box-designer";
import { functions } from "@/lib/firebase";
import { formatDateTime } from "@/lib/format";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import { boxPicture, requestBoxOf, requestBoxText, type BoxSizeId } from "@/lib/package-box";
import { centsToInput, requestFailure, type Lang } from "@/lib/package-requests";
import {
  PAY_NOW_MESSAGES,
  canResend,
  money,
  payChip,
  refundPayload,
  refundProblems,
  refundableCents,
  requestPayNowOf,
  resendPayload,
} from "@/lib/pay-now";

type Row = Record<string, unknown>;

async function callSettings<T = Row>(data: Record<string, unknown>): Promise<T> {
  const response = await httpsCallable<Record<string, unknown>, T>(functions, "setPackageRequestSettings")(data);
  return response.data;
}

/**
 * A request's box piece as staff read it: the size picture, the size and the
 * inches the customer typed, and the same 3D box (read-only, still spinnable)
 * when there are inches. Nothing renders for a piece that is not a sized box.
 */
export function RequestBoxDetail({ piece, lang }: { piece: unknown; lang: Lang }) {
  const [shown, setShown] = useState(false);
  const box = requestBoxOf(piece, lang);
  if (!box) return null;
  const raw = (piece && typeof piece === "object" ? piece : {}) as Row;
  const price = (raw.price && typeof raw.price === "object" ? raw.price : {}) as Row;
  const unit = Number(price.unitCents);
  const prices: Partial<Record<BoxSizeId, number>> = Number.isInteger(unit) && unit > 0 && box.size !== "xl" ? { [box.size]: unit } : {};
  return (
    <span className="pkq-box">
      <span className="pkq-box-line">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" height={48} src={boxPicture(box.size)} width={48} />
        <span data-no-translate>{requestBoxText(box, lang)}</span>
        {box.dims ? (
          <button className="text-button" onClick={() => setShown((value) => !value)} type="button">{shown ? "Hide the box" : "See the box"}</button>
        ) : (
          <small className="pkq-muted">No inches given</small>
        )}
      </span>
      {shown && box.dims && <BoxDesigner dims={box.dims} lang={lang} prices={prices} size={box.size} />}
    </span>
  );
}

type PayProps = {
  businessId: string;
  row: Row;
  lang: Lang;
  /** Owner, admin or staff who can void: the server checks again. */
  canRefund: boolean;
  onFlash: (message: string) => void;
};

/**
 * Pay now on a request: the chip (Link sent / Paid online $X / Refunded $Y),
 * who is charged (the business's Stripe or Laawol), Resend link, and Refund.
 * Nothing renders for a request that never had a link.
 */
export function RequestPayNow({ businessId, row, lang, canRefund, onFlash }: PayProps) {
  const payNow = requestPayNowOf(row);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refunding, setRefunding] = useState(false);
  const chip = payChip(payNow, lang);
  if (!payNow || !chip) return null;
  const requestId = String(row.id ?? "");
  const left = refundableCents(payNow);

  async function resend() {
    setBusy(true);
    setError("");
    try {
      await callSettings(resendPayload(businessId, requestId));
      onFlash("The pay link was sent again.");
    } catch (err) {
      const failure = requestFailure(err);
      setError(PAY_NOW_MESSAGES[failure.reason] ?? failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pkq-pay">
      <p className="pkq-pay-head">
        <CreditCard aria-hidden="true" size={16} />
        <span className={`status-pill ${chip.tone === "paid" ? "ok" : chip.tone === "refund" ? "warning" : "muted"}`} data-no-translate>{chip.text}</span>
        {payNow.chargeType && <small className="pkq-muted">{payNow.chargeType === "direct" ? "Charged on your Stripe account" : "Laawol collects and pays you on Mondays"}</small>}
      </p>
      {payNow.refunds.length > 0 && (
        <ul className="pkq-pay-refunds">
          {payNow.refunds.map((refund, index) => (
            <li key={`${refund.atMs}-${index}`}>
              <span data-no-translate>{`${money(refund.amountCents, lang)} · ${refund.reason}`}</span>
              <small data-no-translate>{[refund.byName, refund.atMs ? formatDateTime(refund.atMs) : ""].filter(Boolean).join(" · ")}</small>
            </li>
          ))}
        </ul>
      )}
      <span className="pkq-actions">
        {canResend(payNow) && (
          <button className="lst-btn ghost" data-loading={busy} disabled={busy} onClick={() => void resend()} type="button">
            {busy ? <RefreshCw className="spin" size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />} Resend link
          </button>
        )}
        {canRefund && left > 0 && (
          <button className="lst-btn ghost danger" disabled={busy} onClick={() => setRefunding(true)} type="button">
            <RotateCcw size={14} aria-hidden="true" /> Refund
          </button>
        )}
      </span>
      {error && <small className="lst-form-error" role="alert">{error}</small>}
      {refunding && (
        <RefundDialog
          businessId={businessId}
          lang={lang}
          leftCents={left}
          onClose={() => setRefunding(false)}
          onDone={(message) => {
            setRefunding(false);
            onFlash(message);
          }}
          requestId={requestId}
        />
      )}
    </section>
  );
}

function RefundDialog({ businessId, requestId, leftCents, lang, onClose, onDone }: { businessId: string; requestId: string; leftCents: number; lang: Lang; onClose: () => void; onDone: (message: string) => void }) {
  const [amount, setAmount] = useState(() => centsToInput(leftCents, lang));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const { cents, problems } = refundProblems({ amount, reason, refundableCents: leftCents });
    if (cents === null) {
      setError(PAY_NOW_MESSAGES[problems[0]] ?? PAY_NOW_MESSAGES.refund_invalid);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await callSettings(refundPayload(businessId, requestId, cents, reason));
      onDone("Refunded. The customer is told on WhatsApp.");
    } catch (err) {
      const failure = requestFailure(err);
      setError(PAY_NOW_MESSAGES[failure.reason] ?? failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 480 }}>
        <header className="lst-modal-head">
          <div>
            <h3>Refund the card payment</h3>
            <p>The card is refunded at once. The card fee is not returned by Stripe.</p>
          </div>
          <button aria-label="Close" className="lst-icon-btn" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          <p className="lst-hint"><span>Up to</span> <b data-no-translate>{money(leftCents, lang)}</b></p>
          <label className="lst-field">
            <span>Amount ($)</span>
            <input autoFocus inputMode="decimal" onChange={(event) => setAmount(event.target.value)} value={amount} />
          </label>
          <label className="lst-field wide">
            <span>Reason</span>
            <input maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Damaged in transit" value={reason} />
          </label>
          {error && <div className="lst-form-error" role="alert">{error}</div>}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" disabled={busy} onClick={onClose} type="button">Back</button>
          <button className="lst-add danger" data-loading={busy} disabled={busy} onClick={() => void submit()} type="button">{busy ? "Refunding..." : "Refund"}</button>
        </footer>
      </div>
    </div>
  );
}
