"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Clipboard, LogIn, PackageSearch, RefreshCw, Search, X } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { signInAnonymously } from "firebase/auth";

import { GuestJourneyProgress } from "@/components/customer-tracking-journey";
import { GetAppBanner } from "@/components/get-app-banner";
import { PhoneSignIn } from "@/components/phone-sign-in";
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
import { currentLanguage, currentLocale } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import {
  GUEST_FLIGHT_FIELDS,
  GUEST_PHOTO_KIND_LABEL,
  GUEST_SHIPPING_COPY,
  GUEST_SHIPPING_FIELDS,
  guestShippingMode,
  guestJourneyStages,
  guestPiecesText,
  guestServiceLabel,
  guestStageLabel,
  guestTrackingErrorKind,
  parseGuestTrackingResponse,
  validGuestTrackingIdentifier,
  type GuestTrackingPhoto,
  type GuestTrackingRecord,
} from "@/lib/guest-tracking";
import { auth, db, functions } from "@/lib/firebase";
import {
  MY_PACKAGES_PATH,
  PHONE_ROLE_LABELS,
  type GuestSignInHint,
} from "@/lib/phone-accounts";

type GuestTrackingProps = {
  authenticated: boolean;
  onAccountAccess: (mode: "sign-in" | "sign-up") => void;
  /** Told the code of every record found, so a staff view above can follow it. */
  onFound?: (trackingCode: string) => void;
  /**
   * App first: offer the app at the top, the status right below it. Off for
   * staff on their own device, who work in the business flow rather than
   * follow a shipment (their page is unchanged).
   */
  offerApp?: boolean;
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

/**
 * One package photo full size, with Previous / Next and Escape. Opens in a
 * new tab too (the link), for a phone that wants to save it.
 */
function GuestPhotoLightbox({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: readonly GuestTrackingPhoto[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onIndexChange((index - 1 + photos.length) % photos.length);
      if (event.key === "ArrowRight") onIndexChange((index + 1) % photos.length);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [photos.length, index, onClose, onIndexChange]);
  const photo = photos[index];
  return (
    <div className="customer-car-lightbox guest-tracking-lightbox" onClick={onClose} role="presentation">
      <button aria-label="Close" className="customer-car-lightbox-close" onClick={onClose} type="button"><X size={20} /></button>
      {photos.length > 1 && (
        <button
          aria-label="Previous photo"
          className="customer-car-lightbox-nav prev"
          onClick={(event) => { event.stopPropagation(); onIndexChange((index - 1 + photos.length) % photos.length); }}
          type="button"
        >
          <ChevronLeft size={26} />
        </button>
      )}
      <figure onClick={(event) => event.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" className="customer-car-lightbox-image" src={photo.url} />
        <figcaption>
          <span>{GUEST_PHOTO_KIND_LABEL[photo.kind]}</span>
          <a href={photo.url} rel="noopener noreferrer" target="_blank">Open full size</a>
        </figcaption>
      </figure>
      {photos.length > 1 && (
        <button
          aria-label="Next photo"
          className="customer-car-lightbox-nav next"
          onClick={(event) => { event.stopPropagation(); onIndexChange((index + 1) % photos.length); }}
          type="button"
        >
          <ChevronRight size={26} />
        </button>
      )}
    </div>
  );
}

export function GuestTracking({
  authenticated,
  onAccountAccess,
  onFound,
  offerApp = true,
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
  // "Sign in as the number ending in ••35": the number on this record the
  // visitor chose. The page never has more of it than its last two digits.
  const [signingInAs, setSigningInAs] = useState<GuestSignInHint | null>(null);
  // Arrived from a link (WhatsApp, a label): the app section says to tap
  // Track in WhatsApp again once installed.
  const [arrivedWithCode] = useState(
    () => typeof window !== "undefined" &&
      Boolean(new URLSearchParams(window.location.search).get("code")?.trim()),
  );
  useEffect(() => {
    if (!claimedCode) return;
    const uid = auth.currentUser?.uid ?? "";
    if (!uid) return;
    // Both filters are load-bearing: the rules allow an owner to read, and
    // a query is only allowed when every possible result provably matches -
    // so the owner clause must appear IN the query. By code alone the
    // listener dies with permission-denied even though every matching
    // document is the caller's own.
    return onSnapshot(
      query(
        collection(db, "freightQuoteRequests"),
        where("customerUid", "==", uid),
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
  // Which package photo is open full size, or none.
  const [lightbox, setLightbox] = useState<number | null>(null);

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
    setLightbox(null);
    setSigningInAs(null);
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
      onFound?.(parsed.record.trackingCode);
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
    setLightbox(null);
    setSigningInAs(null);
    setError("");
    setCopied(false);
    inputRef.current?.focus();
  }

  const lang = currentLanguage() === "fr" ? "fr" : "en";
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

  const lookupSection = (
    <>
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
    </>
  );

  const resultSection = record && (
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
            <span className="status-pill compact">{guestStageLabel(record.service, record.stage)}</span>
          </div>
          <p className="guest-tracking-service">{guestServiceLabel(record.service)}</p>
          {record.pieceCount !== undefined && (
            <p className="guest-tracking-service" data-no-translate>{guestPiecesText(record.pieceCount, lang)}</p>
          )}
          {/* Nothing has started moving until it is paid for, so there is no
              journey to draw - showing one from "Booked" would imply the
              shipment is under way when it is waiting on the customer. */}
          {record.service !== "freight_quote" &&
            record.stage !== "awaiting_payment" && (
            <GuestJourneyProgress
              stage={record.stage}
              stages={guestJourneyStages(record.service)}
            />
          )}
          {/* The WhatsApp "departed" message sends people here for these,
              so a sailed box names what the shipping line calls it. */}
          {record.shipping && (
            <section
              aria-labelledby="guest-tracking-shipping-title"
              className="guest-tracking-shipping"
            >
              {/* A flight (docs/AIR_PACKAGES.md §2) names the airline and the
                  air waybill instead of the shipping line and the box. */}
              <h3 id="guest-tracking-shipping-title">{GUEST_SHIPPING_COPY[guestShippingMode(record.shipping)].title}</h3>
              <p>{GUEST_SHIPPING_COPY[guestShippingMode(record.shipping)].lede}</p>
              <dl>
                {guestShippingMode(record.shipping) === "air"
                  ? GUEST_FLIGHT_FIELDS.filter(({key}) => record.shipping?.[key]).map(
                    ({key, label}) => (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd data-no-translate>{record.shipping?.[key]}</dd>
                      </div>
                    ),
                  )
                  : GUEST_SHIPPING_FIELDS.filter(({key}) => record.shipping?.[key]).map(
                    ({key, label}) => (
                      <div key={key}>
                        <dt>{label}</dt>
                        <dd data-no-translate>{record.shipping?.[key]}</dd>
                      </div>
                    ),
                  )}
              </dl>
            </section>
          )}
          {/* The photos filed on the package, only for the signed-in sender
              or receiver (the server sends none to anyone else). */}
          {record.photos && record.photos.length > 0 && (
            <section aria-labelledby="guest-tracking-photos-title" className="guest-tracking-photos">
              <h3 id="guest-tracking-photos-title">Photos of the package</h3>
              <p>Photos of this package: at drop-off, what was sent on WhatsApp, and at delivery.</p>
              <ul>
                {record.photos.map((photo, index) => (
                  <li key={photo.url}>
                    <button
                      aria-label={GUEST_PHOTO_KIND_LABEL[photo.kind]}
                      className="guest-tracking-photo"
                      onClick={() => setLightbox(index)}
                      type="button"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="" loading="lazy" src={photo.url} />
                    </button>
                    <small>{GUEST_PHOTO_KIND_LABEL[photo.kind]}</small>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {record.photos && lightbox !== null && record.photos[lightbox] && (
            <GuestPhotoLightbox
              onClose={() => setLightbox(null)}
              onIndexChange={setLightbox}
              index={lightbox}
              photos={record.photos}
            />
          )}
          {/* A package split across containers: each part has its own code
              and moves on its own; either code finds them all. */}
          {record.parts && record.parts.length > 1 && (
            <section aria-labelledby="guest-tracking-parts-title" className="guest-tracking-parts">
              <h3 id="guest-tracking-parts-title">This shipment travels in parts</h3>
              <p>Each part has its own code and its own updates.</p>
              <ul>
                {record.parts.map((part) => (
                  <li key={part.trackingCode}>
                    <code className="ctn-code" data-no-translate>{part.trackingCode}</code>
                    <span className="status-pill compact">{guestStageLabel(record.service, part.stage)}</span>
                    <small data-no-translate>{guestPiecesText(part.pieceCount, lang)}</small>
                    {part.priceCents !== null && <small data-no-translate>{moneyText(part.priceCents, lang)}</small>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {record.payment && (
            <section aria-labelledby="guest-tracking-payment-title" className="guest-tracking-payment">
              <h3 id="guest-tracking-payment-title">Payment</h3>
              <dl>
                {(record.payment.pickupFeeCents ?? 0) > 0 && (
                  <div><dt>Pickup fee</dt><dd data-no-translate>{moneyText(record.payment.pickupFeeCents ?? 0, lang)}</dd></div>
                )}
                <div><dt>Final price</dt><dd data-no-translate>{moneyText(record.payment.priceCents, lang)}</dd></div>
                <div><dt>Paid</dt><dd data-no-translate>{moneyText(record.payment.paidCents, lang)}</dd></div>
                <div><dt>Balance</dt><dd data-no-translate>{moneyText(record.payment.balanceCents, lang)}</dd></div>
              </dl>
            </section>
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
            {record.payment
              ? "For your privacy, only the shipment status, its payment and shipping details are shown here."
              : record.shipping
                ? "For your privacy, only the shipment status and shipping details are shown here."
                : "For your privacy, only the booking status is shown here."}
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
          {!authenticated && record.signIn && record.signIn.length > 0 && (
            <section
              aria-labelledby="guest-phone-sign-in-title"
              className="guest-phone-sign-in"
            >
              <div>
                <h3 id="guest-phone-sign-in-title">Is this your package?</h3>
                <p>Sign in with a code to see every package sent with your number.</p>
              </div>
              {signingInAs ? (
                <PhoneSignIn
                  autoStart
                  backLabel="Cancel"
                  hint={{
                    trackingCode: record.trackingCode,
                    role: signingInAs.role,
                    lastTwo: signingInAs.lastTwo,
                  }}
                  idPrefix="guest-phone-sign-in"
                  key={`${record.trackingCode}-${signingInAs.role}`}
                  onBack={() => setSigningInAs(null)}
                  onSignedIn={() => window.location.assign(MY_PACKAGES_PATH)}
                />
              ) : (
                <div className="guest-phone-sign-in-actions">
                  {record.signIn.map((hint) => (
                    <button
                      className="secondary-button"
                      key={hint.role}
                      onClick={() => setSigningInAs(hint)}
                      type="button"
                    >
                      <LogIn aria-hidden="true" size={16} />
                      {(record.signIn?.length ?? 0) > 1 && (
                        <span className="guest-phone-role">{PHONE_ROLE_LABELS[hint.role]}</span>
                      )}
                      <span>
                        Sign in as the number ending in{" "}
                        <span data-no-translate>••{hint.lastTwo}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
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
  );

  return (
    <section className="guest-tracking-layout" aria-labelledby="guest-tracking-title">
      {offerApp ? (
        <>
          {/* App first: a link from WhatsApp or a label lands here when the
              app is not installed. The app is offered first and the status
              sits right below it - nobody has to install anything. */}
          <GetAppBanner variant={arrivedWithCode ? "track" : "follow"} />
          {resultSection}
          {lookupSection}
        </>
      ) : (
        <>
          {lookupSection}
          {resultSection}
        </>
      )}
    </section>
  );
}
