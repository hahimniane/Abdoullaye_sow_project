"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { AlertCircle, Radar, Ship } from "lucide-react";

import { functions } from "@/lib/firebase";
import { text } from "@/lib/format";

// Staff-only card for starting Terminal49 automated container tracking on a
// sea shipment. New milestones from the carrier appear on the shared
// TrackingUpdatesSection timeline via the scheduled pollContainerTracking
// Cloud Function (Terminal49's free tier has no webhooks, so it's poll-based
// rather than instant) - this card only kicks off the subscription.
export function ContainerTrackingCard({
  relatedCollection,
  relatedId,
  containerNumber,
  trackingProvider,
}: {
  relatedCollection: "barrelShipments" | "freightShipments";
  relatedId: string;
  containerNumber: string;
  trackingProvider: string;
}) {
  const [number, setNumber] = useState("");
  const [scac, setScac] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    if (number.trim().length < 4) {
      setError("Enter a valid tracking number.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await httpsCallable(functions, "subscribeToContainerTracking")({
        relatedCollection,
        relatedId,
        containerNumber: number.trim(),
        scac: scac.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start tracking.");
    } finally {
      setBusy(false);
    }
  }

  if (trackingProvider === "carrier_api") {
    return (
      <section className="ctrack ctrack-live">
        <div className="ctrack-head">
          <span className="ctrack-icon" aria-hidden="true">
            <Ship size={16} />
          </span>
          <div className="ctrack-headings">
            <h4>
              Automated tracking active
              <span className="ctrack-pulse" aria-hidden="true" />
            </h4>
            <p className="ctrack-container-number">{text(containerNumber)}</p>
          </div>
        </div>
        <p className="ctrack-note">
          Automated updates are not yet flowing for this carrier account. Add
          manual updates below in the meantime.
        </p>
      </section>
    );
  }

  return (
    <section className="ctrack">
      <div className="ctrack-head">
        <span className="ctrack-icon" aria-hidden="true">
          <Radar size={16} />
        </span>
        <div className="ctrack-headings">
          <h4>Automated container tracking</h4>
          <p>
            Enter the container, booking, or bill of lading number from the
            carrier to get automatic tracking updates.
          </p>
        </div>
      </div>

      <div className="ctrack-fields">
        {/* Labels stay visible after typing - a placeholder-only field loses
            its meaning the moment a number is in it, which is exactly when
            someone is checking they pasted the right one. */}
        <label className="bar-field">
          <span>Container / booking / BOL number</span>
          <input
            autoComplete="off"
            onChange={(event) => setNumber(event.target.value.toUpperCase())}
            placeholder="MSKU1234567"
            spellCheck={false}
            value={number}
          />
        </label>
        <label className="bar-field">
          <span>Carrier SCAC code · optional</span>
          <input
            autoComplete="off"
            onChange={(event) => setScac(event.target.value.toUpperCase())}
            placeholder="MAEU"
            spellCheck={false}
            value={scac}
          />
        </label>
      </div>

      {error && (
        <p className="ctrack-error" role="alert">
          <AlertCircle aria-hidden="true" size={15} />
          <span>{error}</span>
        </p>
      )}

      <div className="ctrack-actions">
        <button
          className="lst-btn"
          disabled={busy || number.trim().length < 4}
          onClick={() => void start()}
          type="button"
        >
          <Radar size={14} /> {busy ? "Starting…" : "Start tracking"}
        </button>
      </div>
    </section>
  );
}
