"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { RefreshCw, Tag, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import {
  inventoryCallableFailure,
  inventoryLabelsRequest,
  inventoryLabelsUrl,
  inventoryMessage,
  validateLabelCopies,
} from "@/lib/inventory";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import { closePendingTab, openPendingTab, sendPendingTab } from "@/lib/pending-tab";

/**
 * Print a product's tags: a QR code only, one per label (2 x 1 in thermal),
 * as many copies of the SAME code as asked. Printing again never changes the
 * code, so a torn or lost tag is replaced by simply printing another.
 */
export function InventoryTagsDialog({
  businessId,
  item,
  onClose,
}: {
  businessId: string;
  item: { id: string; name: string; code: string };
  onClose: () => void;
}) {
  const [copies, setCopies] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The link to show when the browser refused the new tab.
  const [link, setLink] = useState("");

  async function open() {
    if (busy) return;
    const problems = validateLabelCopies(copies);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    setLink("");
    // Opened inside the click, before the await, so a popup blocker lets it
    // through; it is pointed at the tags once the server answers.
    const tab = openPendingTab(window);
    setBusy(true);
    try {
      const response = await httpsCallable(functions, "getInventoryLabelsUrl")(inventoryLabelsRequest(businessId, item.id, copies));
      const url = inventoryLabelsUrl(response.data);
      if (!url) throw new Error("The tags are not ready yet. Try again in a moment.");
      if (sendPendingTab(tab, url)) onClose();
      else setLink(url);
    } catch (failure) {
      closePendingTab(tab);
      setError(inventoryCallableFailure(failure).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>Print tags</h3>
            <p><span data-no-translate>{item.name}</span>{item.code && <> — <code className="ctn-code" data-no-translate>{item.code}</code></>}</p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          {link && (
            <div className="lst-form-error" role="status" style={{ background: "var(--mist)", color: "var(--brand-strong)" }}>
              Your browser blocked the new tab. <a href={link} target="_blank" rel="noopener noreferrer">Open the tags page</a>
            </div>
          )}
          <div className="lst-form-grid">
            <label className="lst-field"><span>How many tags</span>
              <input inputMode="numeric" value={copies} onChange={(e) => setCopies(e.target.value)} autoFocus disabled={busy} />
              <small className="lst-hint">From 1 to 500, all with the same code.</small>
            </label>
          </div>
          <p className="lst-hint">Each tag is a QR code only, made for a 2 × 1 inch thermal label. Anyone who scans it with a phone camera sees a plain page with no product details; staff scanning it in the Laawol app can sell it.</p>
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void open()}>
            {busy ? <RefreshCw className="spin" size={16} /> : <Tag size={16} />}
            {busy ? "Opening..." : "Open tags"}
          </button>
        </footer>
      </div>
    </div>
  );
}
