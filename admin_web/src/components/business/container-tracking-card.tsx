"use client";

import { useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { AlertCircle, Radar, Save, Ship } from "lucide-react";

import { SearchableSelect } from "@/components/searchable-select";
import { functions } from "@/lib/firebase";
import { text } from "@/lib/format";
import {
  OTHER_CARRIER_VALUE,
  oceanCarrierOptions,
} from "@/lib/ocean-carrier-catalog";

// Staff-only card for a sea shipment's container / BOL number.
// Automated Terminal49 tracking is optional: barrels can save the number
// alone (onSaveManual) and mark the load in transit without a carrier
// subscription. New milestones from a subscription appear on the shared
// TrackingUpdatesSection timeline via pollContainerTracking.
export function ContainerTrackingCard({
  relatedCollection,
  relatedId,
  containerNumber,
  trackingProvider,
  allowManualSave = false,
  containerDraft,
  onContainerDraftChange,
  onSaveManual,
}: {
  relatedCollection: "barrelShipments" | "freightShipments" | "transportRequests";
  relatedId: string;
  containerNumber: string;
  trackingProvider: string;
  allowManualSave?: boolean;
  containerDraft?: string;
  onContainerDraftChange?: (value: string) => void;
  onSaveManual?: (containerNumber: string) => Promise<void>;
}) {
  const [internalNumber, setInternalNumber] = useState("");
  // Carrier picked from the catalog, or the sentinel that reveals free text.
  const [carrier, setCarrier] = useState("");
  const [customScac, setCustomScac] = useState("");
  const [busy, setBusy] = useState<"track" | "save" | "">("");
  const [error, setError] = useState("");

  const number = containerDraft ?? internalNumber;
  function setNumber(value: string) {
    if (onContainerDraftChange) onContainerDraftChange(value);
    else setInternalNumber(value);
  }

  const carrierOptions = useMemo(
    () => oceanCarrierOptions("Another carrier — enter the code"),
    [],
  );
  const usingCustomScac = carrier === OTHER_CARRIER_VALUE;
  const scac = usingCustomScac ? customScac.trim().toUpperCase() : carrier;
  const canSaveNumber = number.trim().length >= 4;

  async function start() {
    if (number.trim().length < 4) {
      setError("Enter a valid tracking number.");
      return;
    }
    setBusy("track");
    setError("");
    try {
      await httpsCallable(functions, "subscribeToContainerTracking")({
        relatedCollection,
        relatedId,
        containerNumber: number.trim(),
        scac,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start tracking.");
    } finally {
      setBusy("");
    }
  }

  async function saveManual() {
    if (!onSaveManual) return;
    if (number.trim().length < 4) {
      setError("Enter a valid tracking number.");
      return;
    }
    setBusy("save");
    setError("");
    try {
      await onSaveManual(number.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The shipment could not be updated. Try again.");
    } finally {
      setBusy("");
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
          <h4>{allowManualSave ? "Container / booking / BOL number" : "Automated container tracking"}</h4>
          <p>
            {allowManualSave
              ? "Automated tracking is optional. Save the number to mark the barrel in transit without a carrier subscription."
              : "Enter the container, booking, or bill of lading number from the carrier to get automatic tracking updates."}
          </p>
        </div>
      </div>

      {containerNumber ? (
        <p className="ctrack-on-file">
          <span>Container on file</span>
          <b>{text(containerNumber)}</b>
        </p>
      ) : null}

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
        {/* Picked, not typed: a mistyped SCAC does not fail loudly - the
            carrier lookup just never resolves and tracking silently never
            starts. Optional, because the server infers it from the number
            first and only asks when that lookup comes back empty. */}
        <SearchableSelect
          className="bar-field"
          emptyMessage="No carrier matches your search."
          label="Carrier · optional"
          listLabel="Ocean carrier options"
          onChange={(value) => {
            setCarrier(value);
            if (value !== OTHER_CARRIER_VALUE) setCustomScac("");
          }}
          options={carrierOptions}
          placeholder="Search carrier or code"
          value={carrier}
        />
      </div>

      {usingCustomScac && (
        <label className="bar-field ctrack-custom-scac">
          <span>Carrier SCAC code</span>
          <input
            autoComplete="off"
            maxLength={4}
            onChange={(event) => setCustomScac(event.target.value.toUpperCase())}
            placeholder="MAEU"
            spellCheck={false}
            value={customScac}
          />
        </label>
      )}

      {error && (
        <p className="ctrack-error" role="alert">
          <AlertCircle aria-hidden="true" size={15} />
          <span>{error}</span>
        </p>
      )}

      <div className="ctrack-actions">
        {allowManualSave && onSaveManual ? (
          <button
            className="lst-btn"
            disabled={Boolean(busy) || !canSaveNumber}
            onClick={() => void saveManual()}
            type="button"
          >
            <Save size={14} /> {busy === "save" ? "Saving number…" : "Save number"}
          </button>
        ) : null}
        <button
          className="lst-btn"
          disabled={Boolean(busy) || !canSaveNumber}
          onClick={() => void start()}
          type="button"
        >
          <Radar size={14} /> {busy === "track" ? "Starting…" : "Start tracking"}
        </button>
      </div>
    </section>
  );
}
