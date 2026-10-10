"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { RefreshCw, Tag, X } from "lucide-react";

import {
  containerCallableFailure,
  containerLabelsRequest,
  containerLineTitle,
  containerTitle,
  readContainerLabelChoice,
  writeContainerLabelChoice,
  type ContainerLabelChoice,
} from "@/lib/container-manifest";
import { functions } from "@/lib/firebase";
import { text } from "@/lib/format";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import { closePendingTab, openPendingTab, sendPendingTab } from "@/lib/pending-tab";

type Row = Record<string, unknown>;

/**
 * Package labels: the printable QR + code sheet for a container, or for one
 * line's packages when `line` is given (a reprint for one torn label). With
 * no `container` the package is still waiting for one: its label is asked for
 * by line id alone (`line`, or several in `lines`). One dialog for the
 * Containers panel, the waiting list and the package view on the tracking
 * page, so all print the same way and remember the same choice.
 */
export function ContainerLabelsDialog({
  businessId,
  container = null,
  line,
  lines,
  onClose,
}: {
  businessId: string;
  container?: Row | null;
  line?: Row;
  /** Several waiting packages on one sheet; ignored when there is a container. */
  lines?: readonly Row[];
  onClose: () => void;
}) {
  const [labelChoice, setLabelChoice] = useState<ContainerLabelChoice>(() => readContainerLabelChoice(labelStorage()));
  const [busy, setBusy] = useState(false);
  const [draftError, setDraftError] = useState("");
  // The link to show when the browser refused the new tab.
  const [labelsLink, setLabelsLink] = useState("");
  const labelsContainerId = container ? text(container.id, "") : "";
  const labelsLineId = line ? text(line.id, "") : "";
  const labelsLineCode = line ? text(line.trackingCode, "") : "";
  // Waiting packages have no container to print from: their ids are the request.
  const waitingIds = labelsContainerId
    ? []
    : (lines ?? (line ? [line] : [])).map((row) => text(row.id, "")).filter(Boolean);
  const several = !labelsContainerId && waitingIds.length > 1;

  async function printLabels() {
    if (busy || (!labelsContainerId && waitingIds.length === 0)) return;
    setLabelsLink("");
    setDraftError("");
    writeContainerLabelChoice(labelStorage(), labelChoice);
    // Opened inside the click, before the await, so a popup blocker lets it
    // through; it is pointed at the labels once the server answers.
    const tab = openPendingTab(window);
    const request = containerLabelsRequest(businessId, labelsContainerId, labelChoice, labelsContainerId ? labelsLineId : waitingIds);
    setBusy(true);
    try {
      const response = await httpsCallable(functions, "getContainerDocumentUrl")(request);
      const data = (response.data ?? {}) as { url?: string };
      const url = text(data.url, "");
      if (!url) throw new Error("The labels are not ready yet. Try again in a moment.");
      if (sendPendingTab(tab, url)) onClose();
      else setLabelsLink(url);
    } catch (error) {
      closePendingTab(tab);
      setDraftError(containerCallableFailure(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            {several ? (
              <h3>Print labels</h3>
            ) : line ? (
              <h3>Labels for {labelsLineCode ? <code className="ctn-code" data-no-translate>{labelsLineCode}</code> : <span data-no-translate>{containerLineTitle(line)}</span>}</h3>
            ) : (
              <h3>Print labels</h3>
            )}
            {several ? (
              <p>A QR code, tracking code and both phone numbers for each of the selected packages.</p>
            ) : line && !labelsContainerId ? (
              <p><span data-no-translate>{containerLineTitle(line)}</span> — a QR code, tracking code and both phone numbers.</p>
            ) : line ? (
              <p><span data-no-translate>{containerLineTitle(line)}</span> — only this line's packages.</p>
            ) : container ? (
              <p><span data-no-translate>{containerTitle(container)}</span> — a QR code and tracking code for every package on this container.</p>
            ) : null}
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {draftError && <div className="lst-form-error" role="alert">{draftError}</div>}
          {labelsLink && (
            <div className="lst-form-error" role="status" style={{ background: "var(--mist)", color: "var(--brand-strong)" }}>
              Your browser blocked the new tab. <a href={labelsLink} target="_blank" rel="noopener noreferrer">Open the labels page</a>
            </div>
          )}
          <fieldset className="lst-fieldset">
            <legend>Label format</legend>
            <label className="lst-radio"><input type="radio" name="ctnlabelformat" checked={labelChoice.format === "sheet"} disabled={busy} onChange={() => setLabelChoice((c) => ({ ...c, format: "sheet" }))} /><span>Letter sheet — Avery 5524 weatherproof, 6 per page</span></label>
            <label className="lst-radio"><input type="radio" name="ctnlabelformat" checked={labelChoice.format === "thermal"} disabled={busy} onChange={() => setLabelChoice((c) => ({ ...c, format: "thermal" }))} /><span>Thermal printer 4×6</span></label>
          </fieldset>
          <fieldset className="lst-fieldset">
            <legend>Labels per package</legend>
            <label className="lst-radio"><input type="radio" name="ctnlabelcopies" checked={labelChoice.copies === 2} disabled={busy} onChange={() => setLabelChoice((c) => ({ ...c, copies: 2 }))} /><span>2 — one for each side (recommended)</span></label>
            <label className="lst-radio"><input type="radio" name="ctnlabelcopies" checked={labelChoice.copies === 1} disabled={busy} onChange={() => setLabelChoice((c) => ({ ...c, copies: 1 }))} /><span>1 — to replace a single torn label</span></label>
          </fieldset>
          <p className="lst-hint ctn-label-tip">Use weatherproof polyester or vinyl labels and cover each one with clear packing tape. On a thermal printer use thermal-transfer labels with a resin ribbon; direct-thermal labels fade in a hot container.</p>
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void printLabels()}>
            {busy ? <RefreshCw className="spin" size={16} /> : <Tag size={16} />}
            {busy ? "Opening..." : "Open labels"}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** This browser's storage, or null where reading it throws (a blocked or private window). */
export function labelStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
