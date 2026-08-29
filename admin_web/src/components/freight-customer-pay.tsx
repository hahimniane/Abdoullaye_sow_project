"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";

import { DisclosureCheckbox } from "@/components/disclosure-checkbox";
import { functions } from "@/lib/firebase";
import {
  buildFreightSettlementPayload,
} from "@/lib/customer-shipping";
import { marketplaceDisclosure } from "@/lib/disclosures";
import {
  freightCustomerPayKind,
} from "@/lib/freight-fulfillment";
import { startCheckout } from "@/lib/use-checkout";
import { text } from "@/lib/format";
import type { FirestoreRow } from "@/types/admin";

/**
 * The one customer action a freight shipment may still need.
 *
 * Abandoned pay-on-arrival setup: save the card. Failed arrival charge:
 * pay the settlement. Card already saved and nothing due: render nothing.
 */
export function FreightCustomerPay({ record }: { record: FirestoreRow }) {
  const kind = freightCustomerPayKind(record);
  if (kind === "setup") return <ResumeFreightSetup record={record} />;
  if (kind === "settlement") return <PayFreightSettlement record={record} />;
  return null;
}

function ResumeFreightSetup({ record }: { record: FirestoreRow }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function resume() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const call = httpsCallable<{ shipmentId: string }, { url?: string }>(
        functions,
        "resumeFreightShipmentSetup",
      );
      const result = await call({ shipmentId: text(record.id, "") });
      const url = text(result.data?.url, "");
      if (!url) throw new Error("no url");
      window.location.assign(url);
    } catch {
      setError("That did not open. Try again in a moment.");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="primary-button"
        disabled={busy}
        onClick={resume}
        type="button"
      >
        {busy ? "Opening..." : "Finish payment"}
      </button>
      {error && (
        <span className="customer-inline-note error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

function PayFreightSettlement({ record }: { record: FirestoreRow }) {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pay() {
    if (busy || !accepted) return;
    setBusy(true);
    setError("");
    try {
      await startCheckout(
        "freightSettlement",
        buildFreightSettlementPayload(
          text(record.id, ""),
          marketplaceDisclosure(accepted),
        ),
      );
    } catch {
      setError("The freight balance payment could not be started. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <DisclosureCheckbox accepted={accepted} onChange={setAccepted} />
      <button
        className="primary-button"
        disabled={busy || !accepted}
        onClick={() => void pay()}
        type="button"
      >
        {busy ? "Opening secure payment..." : "Pay now"}
      </button>
      {error && (
        <span className="customer-inline-note error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
