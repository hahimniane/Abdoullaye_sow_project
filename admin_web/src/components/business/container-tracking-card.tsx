"use client";

import { useState, type CSSProperties } from "react";
import { httpsCallable } from "firebase/functions";
import { Satellite, Ship } from "lucide-react";

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
      <div style={cardStyle}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Ship size={16} color="var(--brand)" />
          <div>
            <div style={{ fontWeight: 800, fontSize: 13 }}>
              Automated tracking active
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {text(containerNumber)}
            </div>
            <div style={{ fontSize: 12, color: "#b45309", fontWeight: 700, marginTop: 4 }}>
              Automated updates are not yet flowing for this carrier account. Add manual updates below in the meantime.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>
        Automated container tracking
      </div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "4px 0 8px" }}>
        Enter the container, booking, or bill of lading number from the carrier to get automatic tracking updates.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          placeholder="Container / booking / BOL number (e.g. MSKU1234567)"
          value={number}
          onChange={(event) => setNumber(event.target.value.toUpperCase())}
        />
        <input
          placeholder="Carrier SCAC code (optional)"
          value={scac}
          onChange={(event) => setScac(event.target.value.toUpperCase())}
        />
        {error && <div className="error-box">{error}</div>}
        <button
          type="button"
          className="lst-btn"
          disabled={busy}
          onClick={() => void start()}
        >
          <Satellite size={14} /> {busy ? "Starting…" : "Start tracking"}
        </button>
      </div>
    </div>
  );
}

const cardStyle: CSSProperties = {
  borderTop: "1px solid var(--rule)",
  marginTop: 4,
  paddingTop: 10,
};
