"use client";

import { Anchor, Check, Flag, MapPin, Package, Ship, Truck } from "lucide-react";

import { formatDate, text } from "@/lib/format";
import {
  JOURNEY_STAGES,
  deliveryWindowLabel,
  eventDetail,
  journeyStageFor,
  relativeTime,
} from "@/lib/tracking-journey";
import type { FirestoreRow } from "@/types/admin";

/**
 * The four-stage progress bar at the top of a tracking card.
 *
 * A customer's first question is "where is it", and a status word alone does
 * not answer that - it needs a position on a journey. Stages behind the
 * current one are filled so progress reads at a glance without counting.
 */
export function JourneyProgress({ status }: { status: string }) {
  const stage = journeyStageFor(status);
  if (!stage) {
    return (
      <div className="trk-journey trk-journey-cancelled">
        <span>This shipment was cancelled.</span>
      </div>
    );
  }
  return (
    <ol className="trk-journey" aria-label="Shipment progress">
      {JOURNEY_STAGES.map((item, index) => {
        const done = index < stage.index;
        const current = index === stage.index;
        return (
          <li
            className={`trk-step${done ? " done" : ""}${current ? " current" : ""}`}
            key={item.id}
          >
            <span className="trk-step-dot" aria-hidden="true">
              {done ? <Check size={12} strokeWidth={3} /> : null}
            </span>
            <span className="trk-step-text">
              <strong>{item.label}</strong>
              {current && <small>{item.hint}</small>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The milestone history, customer-facing.
 *
 * Deliberately not the staff component: that one carries an "Add update"
 * control, staff wording and inline styles. This shows the same events as a
 * timeline with a spine, newest first, and says which came from the carrier
 * rather than from the business - a customer trusts "the vessel departed"
 * differently from "the shop says it left".
 */
export function TrackingTimeline({
  events,
  loading,
  trackingActive,
}: {
  events: FirestoreRow[];
  loading?: boolean;
  trackingActive?: boolean;
}) {
  if (loading) {
    return <p className="trk-empty">Loading updates…</p>;
  }
  if (events.length === 0) {
    // An empty log is the normal state for a brand-new booking, so it should
    // read as "not yet" rather than as something being broken.
    return (
      <div className="trk-empty">
        <Package size={16} aria-hidden="true" />
        <span>
          {trackingActive
            ? "No movement reported yet. Updates appear here as your shipment travels."
            : "Updates will appear here once your shipment is on its way."}
        </span>
      </div>
    );
  }
  return (
    <ol className="trk-timeline">
      {events.map((event, index) => {
        const carrier = text(event.source, "") === "carrier_api";
        const detail = eventDetail(event);
        const when = relativeTime(event.timestamp);
        return (
          <li
            className={`trk-event${index === 0 ? " latest" : ""}`}
            key={String(event.id)}
          >
            <span className="trk-event-icon" aria-hidden="true">
              {carrier ? <Ship size={13} /> : <Flag size={13} />}
            </span>
            <div className="trk-event-body">
              <strong>{text(event.label, "Shipment update")}</strong>
              {detail && <span className="trk-event-detail">{detail}</span>}
              <span className="trk-event-when">
                {when ? `${when} · ` : ""}
                {formatDate(event.timestamp)}
                {carrier ? " · from the carrier" : ""}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The headline above the timeline: the single most useful fact right now.
 *
 * Either the last thing that happened, or - before anything has - the
 * delivery window the business quoted, so the card is never silent.
 */
export function TrackingHeadline({
  row,
  latest,
}: {
  row: FirestoreRow;
  latest?: FirestoreRow | null;
}) {
  const window = deliveryWindowLabel(row);
  if (latest) {
    const when = relativeTime(latest.timestamp);
    return (
      <div className="trk-headline">
        <MapPin size={15} aria-hidden="true" />
        <span>
          <strong>{text(latest.label)}</strong>
          {when && <small>{when}</small>}
        </span>
      </div>
    );
  }
  return (
    <div className="trk-headline muted">
      <Truck size={15} aria-hidden="true" />
      <span>
        <strong>Waiting for the first update</strong>
        {window && <small>Estimated delivery {window}</small>}
      </span>
    </div>
  );
}

/** The container line, shown only once a real container is being followed. */
export function ContainerLine({ row }: { row: FirestoreRow }) {
  const container = text(row.containerNumber, "");
  if (!container) return null;
  const live = text(row.trackingProvider, "") === "carrier_api";
  return (
    <div className="trk-container">
      <Anchor size={14} aria-hidden="true" />
      <span>
        Container <strong>{container}</strong>
      </span>
      {live && <span className="trk-live">Live carrier updates</span>}
    </div>
  );
}
