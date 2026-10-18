"use client";

import { useCallback, useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, Clock3, MapPin, Phone, RefreshCw, Truck, XCircle } from "lucide-react";

import { functions } from "@/lib/firebase";
import { currentWebLanguage } from "@/lib/language";
import {
  PICKUP_WINDOW_LABELS,
  confirmedBannerText,
  pickupWhen,
  pieceKindLabel,
  REQUEST_ERROR_MESSAGES,
  estimatePageState,
  estimateRows,
  hoursLines,
  moneyText,
  plannedDayText,
  requestFailure,
  type PublicRequest,
} from "@/lib/package-requests";

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
  const [busy, setBusy] = useState<"" | "confirm" | "decline">("");
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

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
  const when = pickupWhen(request);

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

      <div className="pkr-estimate-lines">
        {rows.map((row) => (
          <div className="pkr-estimate-line" key={row.id}>
            <span>
              <strong data-no-translate>{pieceKindLabel(row.kind, lang)}</strong>
              {row.description && <small data-no-translate>{row.description}</small>}
            </span>
            <span data-no-translate>{row.cents === null ? "—" : moneyText(row.cents, lang)}</span>
          </div>
        ))}
        {estimate && estimate.pickupFeeCents > 0 && (
          <div className="pkr-estimate-line">
            <span><strong>Pickup fee</strong></span>
            <span data-no-translate>{moneyText(estimate.pickupFeeCents, lang)}</span>
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
            {request.plannedDate && <span><span>You planned</span> <span data-no-translate>{plannedDayText(request.plannedDate, lang)}</span></span>}
          </div>
        </div>
      )}
      {open && when && (
        <div className="pkr-place">
          <Truck aria-hidden="true" size={18} />
          <div>
            {/* The business's own day and time once its estimate set them. */}
            <small>{when.scheduled ? "The business comes" : "Pickup"}</small>
            <span data-no-translate>{when.address}</span>
            {when.date && (
              <span>
                <span data-no-translate>{plannedDayText(when.date, lang)}</span>{" "}
                {when.window ? PICKUP_WINDOW_LABELS[when.window] : ""}
              </span>
            )}
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
