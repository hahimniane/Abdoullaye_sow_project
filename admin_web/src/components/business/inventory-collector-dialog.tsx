"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { RefreshCw, UserCheck, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import { currentLanguage } from "@/lib/format";
import { inventoryMessage, runInventoryCall, type InventorySale } from "@/lib/inventory";
import {
  collectorDraftChanged,
  collectorDraftFrom,
  owesText,
  setInventoryCreditCollectorRequest,
  validateCollectorDraft,
  type CollectorDraft,
} from "@/lib/inventory-credit";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/**
 * Who collects a credit, and by when. Any person of the business can be the
 * collector; the new one gets a push. The due date is optional ("" removes
 * it) and can only be today or later; a new date earns its own overdue
 * reminder.
 */
export function InventoryCollectorDialog({
  businessId,
  sale,
  staffOptions,
  todayKey,
  onClose,
  onFlash,
}: {
  businessId: string;
  sale: InventorySale;
  staffOptions: readonly { id: string; name: string }[];
  /** Today in the shops' zone, the earliest due date. */
  todayKey: string;
  onClose: () => void;
  onFlash: (message: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const [draft, setDraft] = useState<CollectorDraft>(() => collectorDraftFrom(sale));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A collector who is no longer in the team list still shows, so the select never looks empty.
  const current = draft.collectorStaffId;
  const options = current && !staffOptions.some((s) => s.id === current)
    ? [...staffOptions, { id: current, name: current }]
    : staffOptions;

  async function save() {
    const problems = validateCollectorDraft(draft, todayKey);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    if (!collectorDraftChanged(sale, draft)) {
      onClose();
      return;
    }
    setError("");
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "setInventoryCreditCollector")(setInventoryCreditCollectorRequest(businessId, sale.id, draft));
      onFlash("Collector saved.");
      onClose();
    }, (failure) => setError(failure.message));
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>Change the collector</h3>
            <p data-no-translate>{owesText(sale.credit?.customerName ?? "", sale.creditRemainingCents, lang)}</p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          <div className="lst-form-grid">
            <label className="lst-field"><span>Who collects it</span>
              <select value={draft.collectorStaffId} disabled={busy} onChange={(e) => setDraft((d) => ({ ...d, collectorStaffId: e.target.value }))}>
                <option value="">Choose staff</option>
                {options.map((s) => (<option key={s.id} value={s.id} data-no-translate>{s.name}</option>))}
              </select>
            </label>
            <label className="lst-field"><span>Due date</span>
              <input type="date" value={draft.dueDate} min={todayKey} disabled={busy} onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))} aria-label="Due date" />
            </label>
          </div>
          <div className="wpk-inline-actions">
            <button className="lst-btn ghost" type="button" disabled={busy || !draft.dueDate} onClick={() => setDraft((d) => ({ ...d, dueDate: "" }))}>Remove the due date</button>
          </div>
          <p className="lst-hint">The new collector gets a notification. Past the due date, the collector and the owner are reminded every three days until it is paid.</p>
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void save()}>
            {busy ? <RefreshCw className="spin" size={16} /> : <UserCheck size={16} />}
            {busy ? "Saving..." : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}
