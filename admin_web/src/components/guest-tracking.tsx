"use client";

import { FormEvent, useRef, useState } from "react";
import { Check, Clipboard, LogIn, PackageSearch, RefreshCw, Search } from "lucide-react";
import { httpsCallable } from "firebase/functions";

import { GuestJourneyProgress } from "@/components/customer-tracking-journey";
import { currentLocale } from "@/lib/format";
import {
  GUEST_SERVICE_LABEL,
  GUEST_STAGE_LABEL,
  guestTrackingErrorKind,
  parseGuestTrackingResponse,
  validGuestTrackingIdentifier,
  type GuestTrackingRecord,
} from "@/lib/guest-tracking";
import { functions } from "@/lib/firebase";

type GuestTrackingProps = {
  authenticated: boolean;
  onAccountAccess: (mode: "sign-in" | "sign-up") => void;
};

type GuestTrackingError =
  | ""
  | "required"
  | "invalid"
  | "not_found"
  | "rate_limited"
  | "unavailable";

const ERROR_COPY: Record<Exclude<GuestTrackingError, "">, string> = {
  required: "Enter a booking or tracking number.",
  invalid: "Enter a valid booking or tracking number.",
  not_found: "We couldn’t find that number. Check it and try again.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  unavailable: "Tracking is unavailable right now. Try again.",
};

export function GuestTracking({
  authenticated,
  onAccountAccess,
}: GuestTrackingProps) {
  const [identifier, setIdentifier] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<GuestTrackingError>("");
  const [record, setRecord] = useState<GuestTrackingRecord | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const value = identifier.trim();
    if (!value) {
      setError("required");
      inputRef.current?.focus();
      return;
    }
    if (!validGuestTrackingIdentifier(value)) {
      setError("invalid");
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    setError("");
    setRecord(null);
    setCopied(false);
    try {
      const response = await httpsCallable(functions, "lookupGuestTracking")({
        identifier: value,
      });
      const parsed = parseGuestTrackingResponse(response.data);
      if (!parsed.found) {
        setError("not_found");
        return;
      }
      setIdentifier(parsed.record.trackingCode);
      setRecord(parsed.record);
      window.setTimeout(() => resultRef.current?.focus(), 0);
    } catch (lookupError) {
      setError(guestTrackingErrorKind(lookupError));
    } finally {
      setLoading(false);
    }
  }

  async function copyCode() {
    if (!record) return;
    try {
      await navigator.clipboard.writeText(record.trackingCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // The visible, selectable code remains available when clipboard access
      // is unavailable; guest tracking does not need another error banner.
    }
  }

  function trackAnother() {
    setIdentifier("");
    setRecord(null);
    setError("");
    setCopied(false);
    inputRef.current?.focus();
  }

  const updated = record?.updatedAtMs
    ? new Intl.DateTimeFormat(currentLocale(), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(record.updatedAtMs))
    : "Not available";

  return (
    <section className="guest-tracking-layout" aria-labelledby="guest-tracking-title">
      <div className="customer-service-hero guest-tracking-hero">
        <div>
          <span className="customer-eyebrow">No sign-in required</span>
          <h2 id="guest-tracking-title">Track a booking</h2>
          <p>Enter the number from your Laawol confirmation or receipt.</p>
        </div>
        <PackageSearch aria-hidden="true" size={34} />
      </div>

      <section className="panel guest-tracking-panel">
        <div className="panel-header phase5-panel-heading">
          <div>
            <Search aria-hidden="true" size={18} />
            <h2>Booking lookup</h2>
          </div>
          <p>Use a Laawol code such as BS-K7M4P2.</p>
        </div>
        <form className="guest-tracking-form" onSubmit={lookup}>
          <label htmlFor="guest-tracking-identifier">
            Booking or tracking number
          </label>
          <div className="guest-tracking-form-row">
            <input
              aria-describedby={error ? "guest-tracking-error" : "guest-tracking-help"}
              aria-invalid={Boolean(error)}
              autoCapitalize="characters"
              autoComplete="off"
              disabled={loading}
              id="guest-tracking-identifier"
              onChange={(event) => setIdentifier(event.target.value.toUpperCase())}
              placeholder="Example: BS-K7M4P2"
              ref={inputRef}
              spellCheck={false}
              type="text"
              value={identifier}
            />
            <button className="primary-button" disabled={loading} type="submit">
              {loading ? <RefreshCw aria-hidden="true" className="spin" size={17} /> : <Search aria-hidden="true" size={17} />}
              {loading ? "Checking your tracking number…" : "Track"}
            </button>
          </div>
          <small id="guest-tracking-help">Spaces and lowercase letters are accepted.</small>
          {error && (
            <div className="error-box guest-tracking-error" id="guest-tracking-error" role="alert">
              {ERROR_COPY[error]}
            </div>
          )}
        </form>
      </section>

      {record && (
        <section
          aria-labelledby="guest-tracking-result-title"
          className="phase5-tracking-card guest-tracking-result"
          ref={resultRef}
          tabIndex={-1}
        >
          <div className="trk-head">
            <div>
              <span className="customer-service-kicker">Tracking result</span>
              <h2 id="guest-tracking-result-title">{record.trackingCode}</h2>
            </div>
            <span className="status-pill compact">{GUEST_STAGE_LABEL[record.stage]}</span>
          </div>
          <p className="guest-tracking-service">{GUEST_SERVICE_LABEL[record.service]}</p>
          {/* Nothing has started moving until it is paid for, so there is no
              journey to draw - showing one from "Booked" would imply the
              shipment is under way when it is waiting on the customer. */}
          {record.stage !== "awaiting_payment" && (
            <GuestJourneyProgress stage={record.stage} />
          )}
          <p className="guest-tracking-updated">
            <strong>Updated</strong> <time>{updated}</time>
          </p>
          <p className="guest-tracking-privacy">
            For your privacy, only the booking status is shown here.
          </p>
          <div className="trk-actions">
            <button className="secondary-button" onClick={() => void copyCode()} type="button">
              {copied ? <Check aria-hidden="true" size={16} /> : <Clipboard aria-hidden="true" size={16} />}
              {copied ? "Copied" : "Copy number"}
            </button>
            <button className="secondary-button" onClick={trackAnother} type="button">
              Track another
            </button>
          </div>
          {!authenticated && (
            <aside className="guest-tracking-upsell">
              <div>
                <strong>More details in your account</strong>
                <p>Sign in to see your own receipts, payment details, and complete order history.</p>
              </div>
              <div className="guest-tracking-upsell-actions">
                <button className="secondary-button" onClick={() => onAccountAccess("sign-in")} type="button">
                  <LogIn aria-hidden="true" size={16} /> Sign in
                </button>
                <button className="primary-button" onClick={() => onAccountAccess("sign-up")} type="button">
                  Create account
                </button>
              </div>
            </aside>
          )}
        </section>
      )}
    </section>
  );
}
