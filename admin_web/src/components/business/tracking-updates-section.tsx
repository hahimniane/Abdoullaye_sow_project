"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Flag, Plus, Ship } from "lucide-react";

import { db, functions } from "@/lib/firebase";
import { formatDate, text } from "@/lib/format";
import type { FirestoreRow } from "@/types/admin";

// Exported so the customer tracking card can subscribe to the same events
// without also inheriting the staff UI around them.
export function useTrackingEvents(
  relatedCollection: string,
  relatedId: string,
) {
  const [rows, setRows] = useState<FirestoreRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(
      query(
        collection(db, relatedCollection, relatedId, "trackingEvents"),
        orderBy("timestamp", "desc"),
      ),
      (snapshot) => {
        setRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsubscribe;
  }, [relatedCollection, relatedId]);

  return { rows, loading };
}

// Staff-facing milestone timeline for one shipment. The only way to add
// entries is addShipmentTrackingMilestone (server-side validated); this
// component is used identically from BarrelsPanel and FreightPanel.
export function TrackingUpdatesSection({
  relatedCollection,
  relatedId,
  canEdit = true,
}: {
  relatedCollection: "barrelShipments" | "freightShipments";
  relatedId: string;
  canEdit?: boolean;
}) {
  const events = useTrackingEvents(relatedCollection, relatedId);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!label.trim()) {
      setError("Please describe what happened.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await httpsCallable(functions, "addShipmentTrackingMilestone")({
        relatedCollection,
        relatedId,
        label: label.trim(),
        location: location.trim(),
        description: description.trim(),
      });
      setLabel("");
      setLocation("");
      setDescription("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderTop: "1px solid var(--rule)", marginTop: 4, paddingTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em" }}>
          Tracking updates
        </span>
        {canEdit && (
          <button
            type="button"
            className="lst-btn ghost"
            style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => setAdding((value) => !value)}
          >
            <Plus size={13} /> Add update
          </button>
        )}
      </div>

      {adding && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <input
            placeholder="What happened (e.g. Departed origin port)"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <input
            placeholder="Location (optional)"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
          <textarea
            placeholder="Notes (optional)"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
          />
          {error && <div className="error-box">{error}</div>}
          <button type="button" className="lst-btn" disabled={busy} onClick={() => void submit()}>
            {busy ? "Saving…" : "Save update"}
          </button>
        </div>
      )}

      {!events.loading && events.rows.length === 0 && (
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>No updates yet.</p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {events.rows.map((event) => {
          const detail = [text(event.location), text(event.description)]
            .filter(Boolean)
            .join(" · ");
          const isCarrier = text(event.source) === "carrier_api";
          return (
            <div key={event.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              {isCarrier ?
                <Ship size={14} color="var(--brand)" style={{ marginTop: 2, flexShrink: 0 }} /> :
                <Flag size={14} color="#0d9488" style={{ marginTop: 2, flexShrink: 0 }} />}
              <div>
                <strong style={{ fontSize: 13 }}>{text(event.label)}</strong>
                {detail && <div style={{ fontSize: 12, color: "var(--muted)" }}>{detail}</div>}
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{formatDate(event.timestamp)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
