"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clipboard, MapPin, PackageSearch, Search, Star } from "lucide-react";

import { formatDate, text } from "@/lib/format";
import { trackingCodeFor } from "@/lib/phase5-customer-actions";
import { TrackingUpdatesSection } from "@/components/business/tracking-updates-section";
import {
  ReviewComposerDrawer,
  useReviewedOrderKeys,
} from "@/components/customer-review-composer";
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
    <div className="phase5-tracking-actions">
      <button
        aria-label="Copy tracking number"
        className="secondary-button"
        data-loading={copying}
        disabled={copying}
        onClick={() => void copyTrackingCode()}
        type="button"
      >
        {copied ? <Check size={16} /> : <Clipboard size={16} />}
        {copied ? "Tracking number copied" : "Copy tracking number"}
      </button>
      {copyError && <small className="phase5-inline-error">{copyError}</small>}
    </div>
  );
}

export function CustomerTracking({
  focusedRecordId = "",
  onFocusConsumed,
  records,
  uid,
}: {
  focusedRecordId?: string;
  onFocusConsumed?: () => void;
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
        <div className="empty-state">No tracked shipments match your search.</div>
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
              | "freightShipments";
            const isCompleted = text(record.status, "") === "completed";
            const reviewKey = `${relatedCollection}_${record.id}`;
            const reviewed = reviewedKeys.has(reviewKey);
            return (
              <article
                className={`phase5-tracking-card${record.id === highlightId ? " phase5-tracking-card-focused" : ""}`}
                id={`tracking-${record.id}`}
                key={record.id}
              >
                <div className="phase5-tracking-topline">
                  <span className="section-kicker">Tracking number</span>
                  <span className="status-pill compact">
                    {text(record.status, "Pending")}
                  </span>
                </div>
                <h3>{code}</h3>
                <p>
                  <MapPin size={15} aria-hidden="true" />
                  {destination}
                </p>
                <div className="phase5-tracking-meta">
                  <span>{text(record.businessName, "Service provider")}</span>
                  <span>{formatDate(record.updatedAt ?? record.createdAt)}</span>
                </div>
                <CopyTrackingNumber code={trackingCodeFor(record)} />
                {relatedCollection && (
                  <TrackingUpdatesSection
                    canEdit={false}
                    relatedCollection={relatedCollection}
                    relatedId={record.id}
                  />
                )}
                {isCompleted && (
                  <div style={{ marginTop: 10 }}>
                    {reviewed ? (
                      <span className="status-pill compact">Review submitted</span>
                    ) : (
                      <button
                        className="secondary-button"
                        onClick={() => setReviewTarget(record)}
                        type="button"
                      >
                        <Star size={15} /> Leave a review
                      </button>
                    )}
                  </div>
                )}
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
