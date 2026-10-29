"use client";

// The one "Void this …" confirmation and the one "Voided · reason · by ·
// date" line, shared by the lot ledger (activities, purchases, expense
// lines) and the parked cars. A record is never deleted: voiding keeps it on
// the list, struck through, and takes it out of the totals.

import { RefreshCw, X } from "lucide-react";

import { formatDate } from "@/lib/format";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import { voidedNoteParts } from "@/lib/voided-record";

export type VoidRecordModalProps = {
  /** "Void this entry", "Void this car", "Void this line". */
  title: string;
  /** What voiding does, in one or two sentences. */
  body: string;
  /** What is being voided ("2019 Toyota Camry · $50.00"). */
  label: string;
  /** Left out for a confirmation with nothing to explain (stop a line). */
  reason?: string;
  onReason?: (value: string) => void;
  busy: boolean;
  /** A refusal from the server, said inside the modal (not behind it). */
  error?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function VoidRecordModal({
  title,
  body,
  label,
  reason = "",
  onReason,
  busy,
  error = "",
  confirmLabel = "Void entry",
  onCancel,
  onConfirm,
}: VoidRecordModalProps) {
  const close = () => {
    if (!busy) onCancel();
  };
  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(close)}>
      <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head"><div><h3>{title}</h3><p>{body}</p></div><button className="lst-icon-btn" type="button" disabled={busy} onClick={close} aria-label="Close"><X size={18} /></button></header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          <p className="panel-lede" data-no-translate>{label}</p>
          {onReason && <label className="lst-field wide"><span>Reason (optional)</span><input value={reason} maxLength={300} onChange={(e) => onReason(e.target.value)} placeholder="e.g. entered twice, wrong amount" /></label>}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={close}>Cancel</button>
          <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={onConfirm}>
            {busy && <RefreshCw className="spin" size={14} />}
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * "Voided · reason · by Name · Oct 29, 2026" under a voided record. The
 * reason and the name are user data and are never translated.
 */
export function VoidedNote({
  row,
  nameFor,
}: {
  row: Record<string, unknown>;
  nameFor: (staffId: string) => string;
}) {
  const parts = voidedNoteParts(row);
  const by = parts.byStaffId ? nameFor(parts.byStaffId) : "";
  return (
    <small className="voided-note">
      <span>Voided</span>
      {parts.reason && <> · <span data-no-translate>{parts.reason}</span></>}
      {by && <> · <span>by</span> <span data-no-translate>{by}</span></>}
      {Boolean(parts.at) && <> · <span>{formatDate(parts.at)}</span></>}
    </small>
  );
}
