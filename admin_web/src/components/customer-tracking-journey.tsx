"use client";

import { useState } from "react";
import { Anchor, Check, Flag, MapPin, Ship, Truck } from "lucide-react";

import { formatDate, text } from "@/lib/format";
import {
  JOURNEY_STAGES,
  TRANSPORT_JOURNEY_STAGES,
  deliveryWindowLabel,
  eventDetail,
  journeyStageFor,
  relativeTime,
  transportJourneyStageFor,
} from "@/lib/tracking-journey";
import type { FirestoreRow } from "@/types/admin";

/** Milestones shown before the timeline folds the rest behind a toggle. */
const VISIBLE_EVENTS = 3;

/**
 * The four-stage progress bar at the top of a tracking card.
 *
 * A customer's first question is "where is it", and a status word alone does
 * not answer that - it needs a position on a journey. Stages behind the
 * current one are filled so progress reads at a glance without counting.
 */
export function JourneyProgress({
  status,
  service = "shipment",
}: {
  status: string;
  /** Which journey vocabulary this record speaks. */
  service?: "shipment" | "transport";
}) {
  const transport = service === "transport";
  const stage = transport
    ? transportJourneyStageFor(status)
    : journeyStageFor(status);
  const stages = transport ? TRANSPORT_JOURNEY_STAGES : JOURNEY_STAGES;
  if (!stage) {
    return (
      <div className="trk-journey trk-journey-cancelled">
        <span>
          {transport
            ? "This transport job was cancelled."
            : "This shipment was cancelled."}
        </span>
      </div>
    );
  }
  return (
    <ol className="trk-journey" aria-label="Shipment progress">
      {stages.map((item, index) => {
        const done = index < stage.index;
        const current = index === stage.index;
        return (
          <li
            className={`trk-step${done ? " done" : ""}${current ? " current" : ""}`}
            key={item.id}
            // The hint explains the stage without costing a line of card
            // height - it wrapped to two lines in a narrow column, on every
            // card, to say what the label had already said.
            title={item.hint}
          >
            <span className="trk-step-dot" aria-hidden="true">
              {done ? <Check size={12} strokeWidth={3} /> : null}
            </span>
            <strong className="trk-step-text">{item.label}</strong>
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
export function TrackingTimeline({ events }: { events: FirestoreRow[] }) {
  // Most shipments sit at two or three milestones, but a long voyage can
  // reach a dozen, and an unbounded list makes one card taller than the
  // screen. The recent ones answer "is it moving"; the rest is history.
  const [expanded, setExpanded] = useState(false);
  if (events.length === 0) {
    // The headline above already says an un-started shipment is waiting, and
    // saying it twice was most of the height of an empty card.
    return null;
  }
  const visible = expanded ? events : events.slice(0, VISIBLE_EVENTS);
  return (
    <>
    <ol className="trk-timeline">
      {visible.map((event, index) => {
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
    {events.length > VISIBLE_EVENTS && (
      <button
        className="trk-more"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        {expanded ? "Show fewer updates" : `Show all ${events.length} updates`}
      </button>
    )}
    </>
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
