"use client";

import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Clipboard,
  MapPin,
  PackageSearch,
  Search,
} from "lucide-react";

import { formatDate, text } from "@/lib/format";
import {
  MAERSK_TRACKING_URL,
  safeCustomerTrackingUrl,
  trackingCodeFor,
} from "@/lib/phase5-customer-actions";
import type { FirestoreRow } from "@/types/admin";

export function CustomerTrackingActions({
  record,
}: {
  record: FirestoreRow;
}) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const trackingCode = trackingCodeFor(record);
  const externalUrl = safeCustomerTrackingUrl(
    record.carrierTrackingUrl ?? record.trackingUrl ?? MAERSK_TRACKING_URL,
  );

  async function copyTrackingCode() {
    if (!trackingCode || copying) return;
    setCopying(true);
    setCopyError("");
    try {
      await navigator.clipboard.writeText(trackingCode);
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

  return (
    <div className="phase5-tracking-actions">
      {trackingCode && (
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
      )}
      <a
        className="primary-button"
        href={externalUrl}
        rel="noreferrer"
        target="_blank"
      >
        Open carrier tracking <ArrowUpRight size={16} />
      </a>
      {copyError && <small className="phase5-inline-error">{copyError}</small>}
    </div>
  );
}

export function CustomerTracking({
  records,
}: {
  records: FirestoreRow[];
}) {
  const [search, setSearch] = useState("");
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
        <p>Follow your Laawol status or continue on the carrier’s secure site.</p>
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
            return (
              <article className="phase5-tracking-card" key={record.id}>
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
                <CustomerTrackingActions record={record} />
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
