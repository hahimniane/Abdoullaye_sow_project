"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, Clock3, CreditCard, MapPin, Phone, Plane, RefreshCw, Ship, Truck, XCircle } from "lucide-react";

import { BoxDesigner } from "@/components/box-designer/box-designer";

import { functions } from "@/lib/firebase";
import { boxPicture, requestBoxOf, requestBoxText, type BoxSizeId } from "@/lib/package-box";
import { currentWebLanguage } from "@/lib/language";
import {
  canReschedule,
  dayChoices,
  listPriceCents,
  priceExplanation,
  requestPlanText,
  reschedulePayload,
  whenText,
  windowText,
  windowsForDay,
} from "@/lib/package-compare";
import {
  confirmedBannerText,
  pieceKindLabel,
  REQUEST_ERROR_MESSAGES,
  estimatePageState,
  estimateRows,
  hoursLines,
  moneyText,
  requestFailure,
  type Lang,
  type PublicRequest,
} from "@/lib/package-requests";
import { customerPayView, paidOnlineText, payNowButtonText, publicPayNowOf, money } from "@/lib/pay-now";

const CALL_TIMEOUT_MS = 20_000;

async function call<T>(name: string, data: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      httpsCallable<Record<string, unknown>, T>(functions, name)(data),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "functions/deadline-exceeded" })), CALL_TIMEOUT_MS);
      }),
    ]);
    return response.data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A box piece on the request page: its picture, the size and the inches the
 * customer gave, and the same 3D box (read-only, still spinnable) when there
 * are inches. Nothing for a piece that is not a sized box.
 */
function RequestBox({ piece, lang }: { piece: PublicRequest["pieces"][number] | undefined; lang: Lang }) {
  const [shown, setShown] = useState(false);
  const box = requestBoxOf(piece, lang);
  if (!box || !piece) return null;
  const unit = piece.price?.unitCents ?? null;
  const prices: Partial<Record<BoxSizeId, number>> = unit && box.size !== "xl" ? { [box.size]: unit } : {};
  return (
    <span className="pkr-estimate-box">
      <span className="pkr-estimate-box-line">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" height={44} src={boxPicture(box.size)} width={44} />
        <span data-no-translate>{requestBoxText(box, lang)}</span>
      </span>
      {box.dims && (
        <button className="text-button" onClick={() => setShown((value) => !value)} type="button">{shown ? "Hide your box" : "See your box"}</button>
      )}
      {shown && box.dims && <BoxDesigner dims={box.dims} lang={lang} prices={prices} size={box.size} />}
    </span>
  );
}

/**
 * The page the WhatsApp estimate button opens: customer.laawoldigital.com/e/<token>
 * (docs/PACKAGE_REQUESTS.md §8.5). The token is the capability; no sign-in.
 * It shows the current version and every later state: confirmed, price went
 * down, received, declined (with the reason), cancelled, expired.
 */
export function PackageEstimatePage({ token }: { token: string }) {
  const lang = currentWebLanguage();
  const [request, setRequest] = useState<PublicRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<"" | "confirm" | "decline" | "reschedule">("");
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [rescheduling, setRescheduling] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newWindow, setNewWindow] = useState("");
  const [rescheduled, setRescheduled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await call<{ request: PublicRequest }>("getPackageRequestByToken", { token });
      setRequest(result.request);
    } catch (err) {
      const failure = requestFailure(err);
      setLoadError(failure.reason === "request_not_found" ? REQUEST_ERROR_MESSAGES.request_not_found : failure.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirm() {
    if (!request?.estimate) return;
    setBusy("confirm");
    setError("");
    try {
      await call("confirmPackageEstimate", { token, version: request.estimate.version });
      setChanged(false);
      await load();
    } catch (err) {
      const failure = requestFailure(err);
      if (failure.reason === "estimate_changed") {
        setChanged(true);
        await load();
      } else if (failure.reason === "request_closed") {
        await load();
      } else {
        setError(failure.message);
      }
    } finally {
      setBusy("");
    }
  }

  async function decline() {
    setBusy("decline");
    setError("");
    try {
      await call("declinePackageEstimate", { token, reason: reason.trim() });
      setDeclining(false);
      await load();
    } catch (err) {
      const failure = requestFailure(err);
      if (failure.reason === "request_closed") await load();
      else setError(failure.message);
    } finally {
      setBusy("");
    }
  }

  async function reschedule() {
    if (!request) return;
    setBusy("reschedule");
    setError("");
    try {
      await call("confirmPackageEstimate", reschedulePayload(token, newDate, newWindow));
      setRescheduling(false);
      setNewDate("");
      setNewWindow("");
      setRescheduled(true);
      await load();
    } catch (err) {
      const failure = requestFailure(err);
      if (failure.reason === "request_closed") {
        setRescheduling(false);
        await load();
      } else {
        // The picker stays open on the same choice: the person can pick again.
        setError(failure.message);
      }
    } finally {
      setBusy("");
    }
  }

  const resched = request?.location?.hours ?? null;
  const reschedZone = request?.timeZone || "America/New_York";
  const reschedDays = useMemo(() => (resched ? dayChoices(resched, reschedZone, lang) : []), [resched, reschedZone, lang]);
  const reschedWindows = useMemo(
    () => (newDate && resched ? windowsForDay({ handoff: "bring_in", hours: resched, dateKey: newDate, zone: reschedZone }) : []),
    [newDate, resched, reschedZone],
  );

  if (loading && !request) {
    return (
      <div className="customer-service-loading" role="status">
        <span className="loading-spinner" />
        Loading your estimate...
      </div>
    );
  }
  if (loadError || !request) {
    return (
      <section className="pkr-card pkr-notice" role="alert">
        <p>{loadError || REQUEST_ERROR_MESSAGES.request_not_found}</p>
        <button className="secondary-button" onClick={() => void load()} type="button"><RefreshCw aria-hidden="true" size={16} /> Retry</button>
      </section>
    );
  }

  const state = estimatePageState(request);
  const rows = estimateRows(request);
  const estimate = request.estimate;
  const location = request.location;
  const open = state === "confirm" || state === "confirmed" || state === "price_dropped" || state === "waiting_estimate";
  const plan = requestPlanText(request, lang);
  const pricesById = new Map(request.pieces.map((piece) => [piece.id, piece.price]));
  const listCentsById = new Map(request.pieces.map((piece) => [piece.id, listPriceCents(piece.price)]));
  const pickupFeeCents = estimate ? estimate.pickupFeeCents : request.pickup?.feeCents ?? 0;
  const mayReschedule = open && canReschedule(request);
  const piecesById = new Map(request.pieces.map((piece) => [piece.id, piece]));
  // Pay now is optional: a link while the request is open, "Paid online" after.
  const payOpen = state === "confirmed" || state === "price_dropped" || state === "received";
  const pay = customerPayView(publicPayNowOf(request.payNow), payOpen, estimate ? estimate.totalCents : null);
  const paidText = pay.kind === "paid" ? paidOnlineText(pay, lang) : null;

  return (
    <section className="pkr-card pkr-estimate">
      <header className="pkr-business">
        <div>
          <small>Estimate from</small>
          <strong data-no-translate>{request.business.name}</strong>
          <small><span>Request</span> <span data-no-translate>{request.code}</span></small>
        </div>
      </header>

      {changed && <p className="pkr-banner warn" role="status">This estimate changed — see the new one.</p>}
      {state === "confirmed" && (
        <p className="pkr-banner ok" role="status"><CheckCircle2 aria-hidden="true" size={18} /> {confirmedBannerText(request)}</p>
      )}
      {state === "price_dropped" && (
        <p className="pkr-banner ok" role="status"><CheckCircle2 aria-hidden="true" size={18} /> Good news: the price went down. Nothing to do, your confirmation stands.</p>
      )}
      {state === "waiting_estimate" && (
        <p className="pkr-banner" role="status"><Clock3 aria-hidden="true" size={18} /> The business is writing your estimate. You will get it on WhatsApp.</p>
      )}
      {state === "received" && (
        <p className="pkr-banner ok" role="status"><CheckCircle2 aria-hidden="true" size={18} /> The business has received your goods.</p>
      )}
      {state === "declined" && <p className="pkr-banner danger" role="status"><XCircle aria-hidden="true" size={18} /> The business declined this request.</p>}
      {state === "cancelled" && <p className="pkr-banner danger" role="status"><XCircle aria-hidden="true" size={18} /> This request was cancelled.</p>}
      {state === "customer_declined" && <p className="pkr-banner" role="status">You said no thanks to this estimate.</p>}
      {state === "expired" && <p className="pkr-banner" role="status">This request has expired. Send a new one if you still need it.</p>}
      {(state === "declined" || state === "cancelled") && request.declineReason && (
        <p className="pkr-reason"><span>Reason:</span> <span data-no-translate>{request.declineReason}</span></p>
      )}
      {state === "received" && request.trackingCode && (
        <p className="pkr-code"><span>Tracking code</span> <a data-no-translate href={`/t/${request.trackingCode}`}>{request.trackingCode}</a></p>
      )}

      <p className="pkr-mode">
        {request.shipMode === "air" ? <Plane aria-hidden="true" size={16} /> : <Ship aria-hidden="true" size={16} />}
        <span>{request.shipMode === "air" ? "Sent by air" : "Sent by sea"}</span>
      </p>
      <div className="pkr-estimate-lines">
        {rows.map((row) => {
          const explanation = priceExplanation(pricesById.get(row.id), lang);
          const cents = row.cents ?? listCentsById.get(row.id) ?? null;
          return (
            <div className="pkr-estimate-line" key={row.id}>
              <span>
                <strong data-no-translate>{pieceKindLabel(row.kind, lang)}</strong>
                {row.description && <small data-no-translate>{row.description}</small>}
                {explanation && <small data-no-translate>{explanation}</small>}
                <RequestBox lang={lang} piece={piecesById.get(row.id)} />
              </span>
              <span data-no-translate>{cents === null ? "—" : moneyText(cents, lang)}</span>
            </div>
          );
        })}
        {pickupFeeCents > 0 && (
          <div className="pkr-estimate-line">
            <span><strong>Pickup fee</strong></span>
            <span data-no-translate>{moneyText(pickupFeeCents, lang)}</span>
          </div>
        )}
        {estimate && (
          <div className="pkr-estimate-line total">
            <span><strong>Estimated total</strong></span>
            <strong data-no-translate>{moneyText(estimate.totalCents, lang)}</strong>
          </div>
        )}
      </div>
      {estimate?.note && <p className="pkr-note" data-no-translate>{estimate.note}</p>}
      {pay.kind === "pay" && (
        <div className="pkr-pay">
          <p className="pkr-pay-title"><CreditCard aria-hidden="true" size={18} /> <strong>Pay by card now</strong></p>
          <a className="primary-button pkr-big" data-no-translate href={pay.linkUrl} rel="noopener noreferrer" target="_blank">{payNowButtonText(pay.amountCents, lang)}</a>
          <p className="pkr-hint">Paying online is optional. You can still pay at the counter in cash or by Zelle.</p>
        </div>
      )}
      {pay.kind === "paid" && paidText && (
        <div className="pkr-pay paid">
          <p className="pkr-banner ok" role="status"><CheckCircle2 aria-hidden="true" size={18} /> <span data-no-translate>{paidText.paid}</span></p>
          {paidText.refunded && <p className="pkr-hint" data-no-translate>{paidText.refunded}</p>}
          {pay.balanceCents > 0 && (
            <p className="pkr-hint"><span>Balance due at the counter</span> <strong data-no-translate>{money(pay.balanceCents, lang)}</strong></p>
          )}
        </div>
      )}
      {estimate && (
        <p className="pkr-hint">
          {request.handoff === "collect"
            ? "The final price is set when the business takes your goods. You pay when the business collects."
            : "The final price is set when the business takes your goods. You pay at drop-off."}
        </p>
      )}

      {open && request.handoff === "bring_in" && location && (
        <div className="pkr-place">
          <MapPin aria-hidden="true" size={18} />
          <div>
            <small>Where to bring it</small>
            <strong data-no-translate>{location.label}</strong>
            <span data-no-translate>{location.address}</span>
            {location.hours && <span className="pkr-hours" data-no-translate>{hoursLines(location.hours, lang).join(" · ")}</span>}
            {plan && <span><span>You planned</span> <strong data-no-translate>{plan}</strong></span>}
          </div>
        </div>
      )}
      {open && request.handoff === "collect" && request.pickup && (
        <div className="pkr-place">
          <Truck aria-hidden="true" size={18} />
          <div>
            {/* The business's own day and time once its estimate set them. */}
            <small>{estimate?.pickupSchedule ? "The business comes" : "Pickup"}</small>
            <span data-no-translate>{request.pickup.address}</span>
            {(estimate?.pickupSchedule || plan) && (
              <strong data-no-translate>
                {estimate?.pickupSchedule ? whenText(estimate.pickupSchedule.date, estimate.pickupSchedule.window, lang) : plan}
              </strong>
            )}
          </div>
        </div>
      )}
      {rescheduled && <p className="pkr-banner ok" role="status"><CheckCircle2 aria-hidden="true" size={18} /> Your new time is saved.</p>}
      {mayReschedule && !rescheduling && !declining && (
        <div className="pkr-actions">
          <button className="secondary-button" disabled={Boolean(busy)} onClick={() => { setRescheduling(true); setRescheduled(false); setError(""); }} type="button">Pick a new time</button>
        </div>
      )}
      {mayReschedule && rescheduling && (
        <div className="pkr-group">
          <h3>Pick a new time</h3>
          <label className="pkr-field">
            <span>Day</span>
            <select onChange={(event) => { setNewDate(event.target.value); setNewWindow(""); }} value={newDate}>
              <option value="">Choose a day</option>
              {reschedDays.map((day) => (
                <option data-no-translate disabled={!day.open} key={day.key} value={day.key}>{day.label}</option>
              ))}
            </select>
          </label>
          {newDate && (
            <fieldset className="pkr-segments">
              <legend>Time window</legend>
              {reschedWindows.map((slot) => (
                <label className={newWindow === slot.value ? "active" : ""} key={slot.value}>
                  <input checked={newWindow === slot.value} name="pkr-new-window" onChange={() => setNewWindow(slot.value)} type="radio" />
                  <span data-no-translate>{windowText(slot.value, lang)}</span>
                </label>
              ))}
            </fieldset>
          )}
          {newDate && reschedWindows.length === 0 && <p className="pkr-hint" role="status">No time left that day. Pick another day.</p>}
          <div className="pkr-actions">
            <button className="secondary-button" disabled={Boolean(busy)} onClick={() => { setRescheduling(false); setError(""); }} type="button">Cancel</button>
            <button className="primary-button" data-loading={busy === "reschedule"} disabled={Boolean(busy) || !newDate || !newWindow} onClick={() => void reschedule()} type="button">
              {busy === "reschedule" ? "Saving..." : "Save new time"}
            </button>
          </div>
        </div>
      )}
      {request.business.phone && (
        <p className="pkr-phone"><Phone aria-hidden="true" size={16} /> <a data-no-translate href={`tel:${request.business.phone}`}>{request.business.phone}</a></p>
      )}

      {error && <p className="customer-field-error" role="alert">{error}</p>}
      {state === "confirm" && !declining && (
        <div className="pkr-actions pkr-confirm">
          <button className="primary-button pkr-big" data-loading={busy === "confirm"} disabled={Boolean(busy)} onClick={() => void confirm()} type="button">
            {busy === "confirm" ? "Confirming..." : "Confirm"}
          </button>
          <button className="text-button" disabled={Boolean(busy)} onClick={() => setDeclining(true)} type="button">No thanks</button>
        </div>
      )}
      {(state === "confirm" || state === "confirmed" || state === "price_dropped" || state === "waiting_estimate") && declining && request.payment.timing !== "card" && (
        <div className="pkr-group">
          <label className="pkr-field">
            <span>Tell the business why (optional)</span>
            <input maxLength={300} onChange={(event) => setReason(event.target.value)} value={reason} />
          </label>
          <div className="pkr-actions">
            <button className="secondary-button" disabled={Boolean(busy)} onClick={() => setDeclining(false)} type="button">Back</button>
            <button className="danger-button" data-loading={busy === "decline"} disabled={Boolean(busy)} onClick={() => void decline()} type="button">
              {busy === "decline" ? "Sending..." : "No thanks"}
            </button>
          </div>
        </div>
      )}
      {(state === "confirmed" || state === "price_dropped") && !declining && request.payment.timing !== "card" && (
        <div className="pkr-actions">
          <button className="text-button" onClick={() => setDeclining(true)} type="button">I no longer need this</button>
        </div>
      )}
    </section>
  );
}
