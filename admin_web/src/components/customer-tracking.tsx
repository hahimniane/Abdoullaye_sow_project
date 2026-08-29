"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Clipboard,
  MapPin,
  PackageSearch,
  ReceiptText,
  Search,
  Star,
} from "lucide-react";

import { formatDate, text } from "@/lib/format";
import { trackingCodeFor } from "@/lib/phase5-customer-actions";
import { useTrackingEvents } from "@/components/business/tracking-updates-section";
import { statusLabel } from "@/lib/tracking-journey";
import {
  ContainerLine,
  JourneyProgress,
  TrackingHeadline,
  TrackingTimeline,
} from "@/components/customer-tracking-journey";
import {
  ReviewComposerDrawer,
  useReviewedOrderKeys,
} from "@/components/customer-review-composer";
import { ResumeCheckoutButton } from "@/components/resume-checkout-button";
import { FreightCustomerPay } from "@/components/freight-customer-pay";
import type { FirestoreRow } from "@/types/admin";

function CopyTrackingNumber({ code }: { code: string }) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  async function copyTrackingCode() {
    if (!code || copying) return;
    setCopying(true);
    setCopyError("");
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopyError(
        "The tracking number could not be copied. Select and copy it manually.",
      );
    } finally {
      setCopying(false);
    }
  }

  if (!code) return null;
  return (
    <>
      <button
        aria-label="Copy tracking number"
        className="secondary-button"
        data-loading={copying}
        disabled={copying}
        onClick={() => void copyTrackingCode()}
        type="button"
      >
        {copied ? <Check size={15} /> : <Clipboard size={15} />}
        {/* Short on purpose: "Copy tracking number" pushed this button and
            "Order details" onto separate lines in a card column, costing a
            row of height on every shipment. The full phrase stays in the
            aria-label, and the number it copies is the card's heading. */}
        {copied ? "Copied" : "Copy number"}
      </button>
      {copyError && <small className="phase5-inline-error">{copyError}</small>}
    </>
  );
}

/**
 * One card's live milestone feed. Split out so each card owns its own
 * subscription and the list re-renders independently.
 */
function ShipmentUpdates({
  record,
  relatedCollection,
}: {
  record: FirestoreRow;
  relatedCollection: "barrelShipments" | "freightShipments" | "transportRequests";
}) {
  const events = useTrackingEvents(relatedCollection, record.id);
  const latest = events.rows[0] ?? null;
  // A cancelled shipment has no next update to wait for and no journey left
  // to narrate. Showing it a headline and an empty feed made a dead card as
  // tall as a live one.
  if (text(record.status, "") === "cancelled") return null;
  return (
    <>
      <TrackingHeadline row={record} latest={latest} />
      <TrackingTimeline events={events.rows} />
    </>
  );
}

export function CustomerTracking({
  focusedRecordId = "",
  onFocusConsumed,
  onOpenDetails,
  records,
  uid,
}: {
  focusedRecordId?: string;
  onFocusConsumed?: () => void;
  /**
   * Opens this shipment's order drawer, where paying, cancelling and
   * reviewing live. Optional so the panel still renders on its own.
   */
  onOpenDetails?: (record: FirestoreRow) => void;
  records: FirestoreRow[];
  uid: string;
}) {
  const [search, setSearch] = useState("");
  // A notification deep-link names one shipment: scroll it into view and
  // hold a highlight on it long enough to be seen.
  const [highlightId, setHighlightId] = useState("");
  useEffect(() => {
    if (!focusedRecordId) return;
    if (!records.some((record) => record.id === focusedRecordId)) return;
    setHighlightId(focusedRecordId);
    onFocusConsumed?.();
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`tracking-${focusedRecordId}`)
        ?.scrollIntoView({behavior: "smooth", block: "center"});
    });
    const timer = setTimeout(() => setHighlightId(""), 6000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedRecordId, records]);
  const [reviewTarget, setReviewTarget] = useState<FirestoreRow | null>(null);
  const reviewedKeys = useReviewedOrderKeys(uid);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return records;
    return records.filter((record) =>
      [
        trackingCodeFor(record),
        text(record.receiverName ?? record.customerName, ""),
        text(record.destinationCountryName ?? record.destinationCountry, ""),
        text(record.businessName, ""),
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [records, search]);

  return (
    <section className="panel phase5-tracking-panel">
      <div className="panel-header phase5-panel-heading">
        <div>
          <PackageSearch size={18} />
          <h2>Shipment tracking</h2>
        </div>
        <p>Follow your Laawol status from pickup to delivery.</p>
      </div>
      <label className="phase5-tracking-search">
        <Search size={17} aria-hidden="true" />
        <span className="sr-only">Search tracking</span>
        <input
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Tracking number, destination, or business"
          type="search"
          value={search}
        />
      </label>
      {filtered.length === 0 ? (
        // Blaming an empty result on a search the customer never typed reads
        // as though their shipments had gone missing.
        <div className="empty-state">
          {search.trim()
            ? "No tracked shipments match your search."
            : "Nothing to track yet. Your barrels and freight appear here once they are booked."}
        </div>
      ) : (
        <div className="phase5-tracking-grid">
          {filtered.map((record) => {
            const code = trackingCodeFor(record) || record.id;
            const destination = text(
              record.destinationCountryName ?? record.destinationCountry,
              "Destination not set",
            );
            const relatedCollection = text(record.relatedCollection, "") as
              | "barrelShipments"
              | "freightShipments"
              | "transportRequests";
            const isTransport = relatedCollection === "transportRequests";
            // The transport machine reads fulfillmentStatus first; status can
            // trail it (and did, before the capture re-run fix).
            const journeyStatus = isTransport
              ? text(record.fulfillmentStatus, "") || text(record.status, "")
              : text(record.status, "");
            const isCompleted = text(record.status, "") === "completed";
            const reviewKey = `${relatedCollection}_${record.id}`;
            const reviewed = reviewedKeys.has(reviewKey);
            return (
              <article
                className={`phase5-tracking-card${record.id === highlightId ? " phase5-tracking-card-focused" : ""}`}
                id={`tracking-${record.id}`}
                key={record.id}
              >
                {/* The tracking number and its status on one line: the
                    "Tracking number" kicker cost a whole row to label a
                    value the Copy button already names. */}
                <div className="trk-head">
                  <h3>{code}</h3>
                  <span className="status-pill compact">
                    {statusLabel(
                      isTransport
                        ? text(record.fulfillmentStatus, "") ||
                            text(record.status, "")
                        : text(record.status, ""),
                      record.destinationDelivery === true,
                    )}
                  </span>
                </div>
                <p className="trk-where">
                  <MapPin size={14} aria-hidden="true" />
                  <span>
                    {destination} · {text(record.businessName, "Service provider")}
                  </span>
                  <time>{formatDate(record.updatedAt ?? record.createdAt)}</time>
                </p>
                <JourneyProgress
                  destinationDelivery={record.destinationDelivery === true}
                  service={isTransport ? "transport" : "shipment"}
                  status={journeyStatus}
                />
                <ContainerLine row={record} />
                {relatedCollection && (
                  <ShipmentUpdates
                    record={record}
                    relatedCollection={relatedCollection}
                  />
                )}
                {/* Actions sit at the foot so the card reads status first and
                    the buttons do not split it in half. */}
                <div className="trk-actions">
                  <CopyTrackingNumber code={trackingCodeFor(record)} />
                  {/* Abandoned pay-now (barrels, freight, transport) reopens
                      the SAME record. Pay-on-arrival freight still uses the
                      card-save resume below. */}
                  <ResumeCheckoutButton record={record} />
                  {/* Pay-on-arrival: Finish payment if the card was never
                      saved, or Pay now if the arrival charge failed.
                      A saved card with nothing due renders nothing. */}
                  <FreightCustomerPay record={record} />
                  {onOpenDetails && (
                    <button
                      className="secondary-button"
                      onClick={() => onOpenDetails(record)}
                      type="button"
                    >
                      <ReceiptText size={15} /> Order details
                    </button>
                  )}
                  {isCompleted &&
                    (reviewed ? (
                      <span className="status-pill compact">Review submitted</span>
                    ) : (
                      <button
                        className="secondary-button"
                        onClick={() => setReviewTarget(record)}
                        type="button"
                      >
                        <Star size={15} /> Leave a review
                      </button>
                    ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {reviewTarget && (
        <ReviewComposerDrawer
          businessId={text(reviewTarget.businessId, "")}
          businessName={text(reviewTarget.businessName, "")}
          onClose={() => setReviewTarget(null)}
          onSubmitted={() => setReviewTarget(null)}
          open={reviewTarget !== null}
          orderTitle={trackingCodeFor(reviewTarget) || reviewTarget.id}
          relatedCollection={text(reviewTarget.relatedCollection, "")}
          relatedId={reviewTarget.id}
        />
      )}
    </section>
  );
}

