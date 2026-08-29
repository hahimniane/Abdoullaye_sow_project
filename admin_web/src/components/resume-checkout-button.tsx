"use client";

import { useState } from "react";

import {
  checkoutResumePayload,
  checkoutResumeTarget,
} from "@/lib/customer-checkout";
import { startCheckout } from "@/lib/use-checkout";
import type { FirestoreRow } from "@/types/admin";

export function ResumeCheckoutButton({
  record,
}: {
  record: FirestoreRow;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const target = checkoutResumeTarget(record);
  if (!target) return null;

  async function pay() {
    if (!target || busy) return;
    setBusy(true);
    setError("");
    try {
      await startCheckout(target.orderType, checkoutResumePayload(target));
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
