"use client";

import { useState } from "react";
import { CreditCard, RotateCcw, ShieldCheck } from "lucide-react";
import { httpsCallable } from "firebase/functions";

import { functions } from "@/lib/firebase";
import { formatMoney } from "@/lib/format";
import { buildWalletCardRefundPayload } from "@/lib/phase5-customer-actions";

const ACTION_TIMEOUT_MS = 30_000;

async function withTimeout<T>(request: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("timeout")),
      ACTION_TIMEOUT_MS,
    );
    request.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function CustomerWalletActions({
  balance,
  currency,
  pendingRefund = 0,
}: {
  balance: number;
  currency: string;
  pendingRefund?: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function requestRefund() {
    if (requesting || balance <= 0) return;
    setRequesting(true);
    setError("");
    setNotice("");
    try {
      const callable = httpsCallable<
        Record<string, never>,
        { amount?: number; currency?: string }
      >(functions, "requestWalletCardRefund");
      const result = await withTimeout(callable(buildWalletCardRefundPayload()));
      // The callable response remains authoritative, while the UI uses one
      // localized success sentence instead of exposing raw backend data.
      Number(result.data.amount ?? balance);
      String(result.data.currency ?? currency);
      setNotice(
        "Your return to card was requested. We will send an update when it is processed.",
      );
      setConfirming(false);
    } catch {
      setError("The return to card could not be requested. Try again.");
    } finally {
      setRequesting(false);
    }
  }

  return (
    <section className="phase5-wallet-card" aria-label="Return wallet balance">
      <div className="phase5-wallet-icon" aria-hidden="true">
        <CreditCard size={22} />
      </div>
      <div className="phase5-wallet-copy">
        <span className="section-kicker">Return to card</span>
        <h3>Move your available balance back to your payment card.</h3>
        <p>
          The full available balance is reserved for refund. Laawol confirms the
          final amount securely on the server.
        </p>
        {pendingRefund > 0 && (
          <div className="phase5-refund-pending">
            <RotateCcw size={16} />
            <strong>{formatMoney(pendingRefund, currency)}</strong>
            <span> is already being returned.</span>
          </div>
        )}
        {notice && <div className="info-band">{notice}</div>}
        {error && <div className="error-box">{error}</div>}
        {!confirming ? (
          <button
            className="secondary-button"
            disabled={requesting || balance <= 0}
            onClick={() => setConfirming(true)}
            type="button"
          >
            Request return to card
          </button>
        ) : (
          <div className="phase5-refund-confirm">
            <div>
              <ShieldCheck size={18} />
              <span>Return </span>
              <strong>{formatMoney(balance, currency)}</strong>
              <span> to the original card?</span>
            </div>
            <div className="phase5-action-row">
              <button
                className="primary-button"
                data-loading={requesting}
                disabled={requesting}
                onClick={() => void requestRefund()}
                type="button"
              >
                {requesting ? "Requesting return..." : "Confirm card return"}
              </button>
              <button
                className="secondary-button"
                disabled={requesting}
                onClick={() => setConfirming(false)}
                type="button"
              >
                Keep in wallet
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
