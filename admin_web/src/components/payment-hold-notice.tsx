"use client";

import { useEffect, useState } from "react";

import {
  currentWebLanguage,
  type SupportedLanguage,
} from "@/lib/language";

/**
 * The payment-timing promise, shown wherever a booking payment is taken.
 *
 * Booking payments hold the money instead of charging it (see
 * functions/payment_hold.js). The customer has to know three things before
 * they pay, on the screen rather than behind an "i" (UI-CONVENTIONS rule 1 -
 * money moving is never detail-on-demand): nothing is charged today, when
 * the charge happens, and what cancelling costs after it does.
 */
export function PaymentHoldNotice({ amount }: { amount?: number }) {
  const [language, setLanguage] = useState<SupportedLanguage>("en");
  useEffect(() => setLanguage(currentWebLanguage()), []);
  const isFrench = language === "fr";

  // The same estimate the backend quotes (2.9% + 30¢); the real figure for a
  // real refund comes from Stripe's balance transaction.
  const fee =
    typeof amount === "number" && amount > 0
      ? (Math.round(amount * 2.9) / 100 + 0.3).toFixed(2)
      : null;

  return (
    <p className="customer-inline-note payment-hold-notice">
      {isFrench ? (
        <>
          Aucun débit aujourd’hui : le montant est réservé sur votre carte.
          Il sera débité à l’expiration de la réservation (5 à 7 jours pour la
          plupart des cartes). Annulation gratuite avant le débit ; après,
          le remboursement se fait moins les frais bancaires
          {fee ? ` (environ $${fee})` : ""}.
        </>
      ) : (
        <>
          No charge today — the amount is reserved on your card and charged
          when the reservation window ends (5–7 days for most cards).
          Cancelling before then is free; after that, refunds lose the card
          fee{fee ? ` (about $${fee})` : ""}.
        </>
      )}
    </p>
  );
}
