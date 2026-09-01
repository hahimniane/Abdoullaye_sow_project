"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, Clipboard, LogIn, PackageSearch, RefreshCw, Search } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { signInAnonymously } from "firebase/auth";

import { GuestJourneyProgress } from "@/components/customer-tracking-journey";
import {
  CustomerFreightQuotes,
  type FreightQuoteRequestRow,
} from "@/components/customer-shipping-services";
import {
  collection,
  limit as limitTo,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { currentLocale } from "@/lib/format";
import {
  GUEST_SERVICE_LABEL,
  GUEST_STAGE_LABEL,
  guestTrackingErrorKind,
  parseGuestTrackingResponse,
  validGuestTrackingIdentifier,
  type GuestTrackingRecord,
} from "@/lib/guest-tracking";
import { auth, db, functions } from "@/lib/firebase";

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
  // Seeing prices takes one proof: the email the customer gave with the
  // request. Claiming moves the request into this browser's session, and
  // from there the ordinary workspace shows the prices and books the win.
  const [claimEmail, setClaimEmail] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");
  // Set once the claim succeeds: the session now owns the request, so the
  // prices render right here - the anonymous session cannot enter the
  // signed-in workspace, and this page is the guest's home ground.
  const [claimedCode, setClaimedCode] = useState("");
  const [claimedRequest, setClaimedRequest] =
    useState<FreightQuoteRequestRow | null>(null);
  useEffect(() => {
    if (!claimedCode) return;
    return onSnapshot(
      query(
        collection(db, "freightQuoteRequests"),
        where("trackingCode", "==", claimedCode),
        limitTo(1),
      ),
      (snapshot) => {
        const doc = snapshot.docs[0];
        setClaimedRequest(
          doc ? ({id: doc.id, ...doc.data()} as FreightQuoteRequestRow) : null,
        );
      },
    );
  }, [claimedCode]);
  // The public tracking page has the box; the lookup lives here, where it is
  // attested and rate limited. A number arriving in the URL is one somebody
  // already typed, so run it rather than making them type it twice.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code") ?? "";
    if (!code.trim()) return;
    setIdentifier(code);
    void search(code);
    // Once only: this is the arrival, not a subscription to the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await search(identifier);
  }

  async function search(raw: string) {
    if (loading) return;
    const value = raw.trim();
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

  async function claimRequest() {
    if (claiming || !record) return;
    const email = claimEmail.trim();
    if (!email.includes("@")) {
      setClaimError("Enter the email you gave with the request.");
      return;
    }
    setClaiming(true);
    setClaimError("");
    try {
      if (!auth.currentUser) await signInAnonymously(auth);
      await httpsCallable(functions, "claimFreightQuoteRequest")({
        trackingCode: record.trackingCode,
        email,
      });
      // The request now belongs to this session. The prices render right
      // here: an anonymous session cannot enter the signed-in workspace,
      // and this page is the guest's home ground.
      setClaimedCode(record.trackingCode);
      setClaiming(false);
    } catch (caught) {
      setClaiming(false);
      setClaimError(
        caught instanceof Error && caught.message
          ? caught.message
          : "That did not work. Check the email and try again.",
      );
    }
  }

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
          {record.service !== "freight_quote" &&
            record.stage !== "awaiting_payment" && (
            <GuestJourneyProgress stage={record.stage} />
          )}
          {record.service === "freight_quote" && claimedRequest && (
            <div className="guest-quote-state guest-quote-open">
              <CustomerFreightQuotes request={claimedRequest} />
              {String(claimedRequest.quoteStatus ?? "") === "selected" &&
                !String(claimedRequest.bookedShipmentId ?? "") && (
                <button
                  className="primary-button"
                  onClick={() =>
                    window.location.assign(
                      "/?service=freight" +
                        `&agreedRequest=${claimedRequest.id}` +
                        `&agreedBusiness=${String(claimedRequest.selectedBusinessId ?? "")}`,
                    )
                  }
                  type="button"
                >
                  Continue to booking
                </button>
              )}
            </div>
          )}
          {record.service === "freight_quote" && !claimedRequest && (
            <div className="guest-quote-state">
              {(record.quoteCount ?? 0) > 0 ? (
                <>
                  <p className="guest-quote-count">
                    <strong>
                      {record.quoteCount === 1
                        ? "1 business has answered with a price."
                        : `${record.quoteCount} businesses have answered with a price.`}
                    </strong>
                  </p>
                  <p>
                    Enter the email you gave with this request to see the
                    prices and choose one.
                  </p>
                </>
              ) : (
                <p>
                  No prices yet. Businesses have been asked, and answers
                  usually arrive within a day. Enter the email you gave to
                  open this request on this device.
                </p>
              )}
              <div className="guest-claim-row">
                <input
                  aria-label="The email you gave with the request"
                  autoComplete="email"
                  disabled={claiming}
                  onChange={(event) => setClaimEmail(event.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  value={claimEmail}
                />
                <button
                  className="primary-button"
                  data-loading={claiming}
                  disabled={claiming}
                  onClick={() => void claimRequest()}
                  type="button"
                >
                  {claiming
                    ? "Opening..."
                    : (record.quoteCount ?? 0) > 0
                      ? "See prices and choose"
                      : "Open my request"}
                </button>
              </div>
              {claimError && (
                <p className="guest-claim-error" role="alert">{claimError}</p>
              )}
            </div>
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
