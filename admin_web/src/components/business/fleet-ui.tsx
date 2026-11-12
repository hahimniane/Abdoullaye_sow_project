"use client";

// Small pieces every Fleet page shares: the modal, a money figure, a state
// chip, and the one call-and-report helper (busy flag, refusal sentence).

import { useCallback, useState, type ReactNode } from "react";
import { RefreshCw, X } from "lucide-react";

import { confirmImportantAction } from "@/lib/action-confirmation";
import { currentLanguage } from "@/lib/format";
import { fleetErrorMessage, type CellState, type Expiry } from "@/lib/fleet";
import { moneyText } from "@/lib/invoice-ledger";
import { overlayDismiss } from "@/lib/overlay-dismiss";

import { callFleet } from "./fleet-data";

export const fleetLang = (): "en" | "fr" => (currentLanguage() === "fr" ? "fr" : "en");

/** A money figure; the digits are never translated. */
export function Money({ cents, className }: { cents: number; className?: string }) {
  return (
    <b className={className} data-no-translate>
      {moneyText(cents, fleetLang())}
    </b>
  );
}

const cellLabels: Record<CellState, string> = { full: "Paid", part: "Part paid", owed: "Owed", none: "—" };
export const cellStateLabel = (state: CellState) => cellLabels[state];

const expiryLabels: Record<Expiry, string> = {
  expired: "Expired",
  soon: "Due in 60 days",
  missing: "Missing",
  ok: "OK",
};
export function ExpiryChip({ state }: { state: Expiry }) {
  const tone = state === "expired" ? "bad" : state === "soon" ? "warn" : state === "missing" ? "muted" : "ok";
  return <span className={`fleet-chip ${tone}`}>{expiryLabels[state]}</span>;
}

export function FleetModal({
  title,
  subtitle,
  onClose,
  busy = false,
  width = 560,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  width?: number;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!busy) onClose(); })}>
      <div className="lst-modal" style={{ maxWidth: width }} onClick={(event) => event.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p className="lst-hint">{subtitle}</p>}
          </div>
          <button className="lst-icon-btn" type="button" disabled={busy} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="lst-modal-body">{children}</div>
        <footer className="lst-modal-foot">{footer}</footer>
      </div>
    </div>
  );
}

export function SaveButton({ busy, label, busyLabel, onClick, disabled = false, danger = false }: {
  busy: boolean;
  label: string;
  busyLabel: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button className={`lst-btn${danger ? " danger" : ""}`} type="button" disabled={busy || disabled} aria-busy={busy} onClick={onClick}>
      {busy && <RefreshCw className="spin" size={14} />} {busy ? busyLabel : label}
    </button>
  );
}

/**
 * Runs one Fleet action: asks first when `confirm` is given (EN + FR text),
 * keeps `busy` true while it runs and ALWAYS clears it, and turns a refusal
 * into its sentence. Resolves with the server's answer, or null on a refusal
 * or when the person said no.
 */
export function useFleetRun(businessId: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(
    async <T = Record<string, unknown>,>(
      action: string,
      payload: Record<string, unknown>,
      confirm?: { en: string; fr: string },
    ): Promise<T | null> => {
      setError("");
      if (confirm && !(await confirmImportantAction(confirm.en, confirm.fr))) return null;
      setBusy(true);
      try {
        return await callFleet<T>(action, businessId, payload);
      } catch (failure) {
        setError(fleetErrorMessage(failure));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [businessId],
  );
  return { busy, error, setError, run };
}
