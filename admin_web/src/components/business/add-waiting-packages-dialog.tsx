"use client";

import { useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Plus, RefreshCw, X } from "lucide-react";

import {
  MAX_ASSIGN_LINES,
  CONTAINER_MESSAGES,
  containerLineTitle,
  containerTitle,
} from "@/lib/container-manifest";
import { functions } from "@/lib/firebase";
import { currentLanguage, text } from "@/lib/format";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import {
  assignLinesRequest,
  assignSelectionRefusal,
  assignableLines,
  assignedText,
  assignmentBlockText,
  destinationPlace,
  filterWaitingPackages,
  packageSize,
  runPackageCall,
  selectAllMatching,
  selectedCountText,
  sortWaitingNewestFirst,
} from "@/lib/waiting-packages";

type Row = Record<string, unknown>;

/**
 * Add waiting packages to a container that is still loading: tick them in a
 * list, or "select all matching" what the search shows. A package for another
 * country than the container goes to is shown disabled with the reason, and
 * cannot be ticked - the server refuses it too, this just says so first.
 */
export function AddWaitingPackagesDialog({
  businessId,
  container,
  packages,
  onClose,
  onAssigned,
}: {
  businessId: string;
  container: Row;
  packages: readonly Row[];
  onClose: () => void;
  onAssigned: (message: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offending, setOffending] = useState<string[]>([]);

  const containerName = containerTitle(container);
  const containerHasDestination = Boolean(text(container.destinationCountryId, ""));
  const everything = useMemo(() => assignableLines(sortWaitingNewestFirst(packages), container), [packages, container]);
  const visible = useMemo(() => {
    const shown = new Set(filterWaitingPackages(everything.map((entry) => entry.line), filter).map((row) => text(row.id, "")));
    return everything.filter((entry) => shown.has(entry.id));
  }, [everything, filter]);
  const takeable = visible.filter((entry) => !entry.refusal).length;
  const chosen = new Set(selected);

  function toggle(id: string) {
    setOffending([]);
    setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  }

  async function assign() {
    const request = assignLinesRequest(businessId, text(container.id, ""), selected);
    if (request.lineIds.length === 0) {
      setError("Tick at least one package.");
      return;
    }
    const tooMany = assignSelectionRefusal(request.lineIds.length);
    if (tooMany) {
      setError(tooMany);
      return;
    }
    setError("");
    setOffending([]);
    await runPackageCall(setBusy, async () => {
      await httpsCallable(functions, "assignContainerLines")(request);
      onAssigned(assignedText(request.lineIds.length, containerName, lang));
      onClose();
    }, (failure) => {
      // A package that went to another container meanwhile, or whose country
      // no longer matches: name them so the person can untick and go on.
      setError(failure.message);
      setOffending(failure.offendingLineIds);
    });
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>Add waiting packages</h3>
            <p><span data-no-translate>{containerName}</span> — tick the packages that go on this container.</p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          {!containerHasDestination && (
            <div className="lst-form-error" role="status">{CONTAINER_MESSAGES.container_destination_required}</div>
          )}
          {everything.length === 0 ? (
            <div className="empty-state">No packages are waiting for a container.</div>
          ) : (
            <>
              <div className="wpk-pick-tools">
                <input type="search" placeholder="VIN, customer, phone" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search waiting packages" />
                <button
                  className="lst-btn ghost"
                  type="button"
                  disabled={busy || takeable === 0}
                  onClick={() => setSelected((list) => selectAllMatching(visible, list))}
                >
                  Select all matching
                </button>
                {selected.length > 0 && (
                  <button className="ghost-button" type="button" disabled={busy} onClick={() => setSelected([])}>Clear</button>
                )}
              </div>
              {visible.length === 0 ? (
                <div className="empty-state">No waiting package matches that search.</div>
              ) : (
                <ul className="wpk-pick-list">
                  {visible.map((entry) => {
                    const line = entry.line;
                    const blocked = entry.refusal !== null;
                    const size = packageSize(line);
                    const place = destinationPlace(line.destinationCountryId, line.destinationCountryName, lang);
                    const reason = assignmentBlockText(line, container, lang);
                    const flagged = offending.includes(entry.id);
                    return (
                      <li className={`${blocked ? "wpk-blocked" : ""}${flagged ? " wpk-flagged" : ""}`.trim() || undefined} key={entry.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={chosen.has(entry.id)}
                            disabled={blocked || busy}
                            onChange={() => toggle(entry.id)}
                          />
                          <span className="wpk-pick-main">
                            <strong data-no-translate>{containerLineTitle(line)}</strong>
                            <small data-no-translate>
                              {[text(line.customerName, ""), text(line.customerPhone, "")].filter(Boolean).join(" · ")}
                            </small>
                            {blocked && reason && <small className="wpk-block-reason">{reason}</small>}
                          </span>
                          <span className="wpk-pick-side">
                            <small data-no-translate>{place || "—"}</small>
                            {size && <small data-no-translate>{size.dimensionsText} · {size.volumeText}</small>}
                            {text(line.trackingCode, "") && <code className="ctn-code" data-no-translate>{text(line.trackingCode, "")}</code>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="lst-hint wpk-pick-count" role="status" data-no-translate>{selectedCountText(selected.length, lang)}</p>
              {selected.length > MAX_ASSIGN_LINES && <div className="lst-form-error" role="alert">{CONTAINER_MESSAGES.line_ids_invalid}</div>}
            </>
          )}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button className="lst-add" type="button" disabled={busy || selected.length === 0 || selected.length > MAX_ASSIGN_LINES} aria-busy={busy} onClick={() => void assign()}>
            {busy ? <RefreshCw className="spin" size={16} /> : <Plus size={16} />}
            {busy ? "Adding..." : "Add to container"}
          </button>
        </footer>
      </div>
    </div>
  );
}
