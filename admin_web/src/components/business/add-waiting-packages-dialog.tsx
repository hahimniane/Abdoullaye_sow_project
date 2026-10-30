"use client";

import { useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Minus, Plus, RefreshCw, Tag, X } from "lucide-react";

import { ContainerLabelsDialog } from "@/components/business/container-labels-dialog";
import { confirmImportantAction } from "@/lib/action-confirmation";
import { loadAnywayText, packageShipModeOf, withProblemAcknowledgement } from "@/lib/package-proof";
import { AirPackageBadge } from "@/components/business/ships-by";
import {
  MAX_ASSIGN_LINES,
  CONTAINER_MESSAGES,
  containerLineTitle,
  containerLineTitleIsCopy,
  containerTitle,
  lineCustomer,
} from "@/lib/container-manifest";
import { functions } from "@/lib/firebase";
import { currentLanguage, text } from "@/lib/format";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import {
  assignAnswerFrom,
  assignLinesRequest,
  assignSelectionRefusal,
  assignableLines,
  assignedText,
  assignmentBlockText,
  clampPiecesGoing,
  destinationPlace,
  filterWaitingPackages,
  packageSize,
  partLabelStubs,
  partsCreatedText,
  piecesGoingText,
  piecesStayText,
  runPackageCall,
  selectAllMatching,
  selectedCountText,
  sortWaitingNewestFirst,
  splitPreviewRows,
  splittablePieceCount,
  type AssignedPart,
} from "@/lib/waiting-packages";

type Row = Record<string, unknown>;

/**
 * Add waiting packages to a container that is still loading: tick them in a
 * list, or "select all matching" what the search shows. A package for another
 * country than the container goes to is shown disabled with the reason, and
 * cannot be ticked - the server refuses it too, this just says so first.
 *
 * A ticked package with several pieces can go in part: "Pieces going in: 2 of
 * 4" splits it (docs/WAITING_PACKAGES.md "Split across containers"); the rest
 * stay waiting as a linked part with its own code, which needs its own labels.
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
  // How many pieces of each ticked package go in; absent means all of them.
  const [going, setGoing] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offending, setOffending] = useState<string[]>([]);
  // After a split: the parts that stay waiting, whose labels are new.
  const [parts, setParts] = useState<AssignedPart[]>([]);
  const [doneMessage, setDoneMessage] = useState("");
  const [printingParts, setPrintingParts] = useState(false);

  const containerName = containerTitle(container);
  const containerHasDestination = Boolean(text(container.destinationCountryId, ""));
  const everything = useMemo(() => assignableLines(sortWaitingNewestFirst(packages), container), [packages, container]);
  const visible = useMemo(() => {
    const shown = new Set(filterWaitingPackages(everything.map((entry) => entry.line), filter).map((row) => text(row.id, "")));
    return everything.filter((entry) => shown.has(entry.id));
  }, [everything, filter]);
  // Each package's piece count, read once per list (never per render of a row).
  const pieceTotals = useMemo(() => new Map(everything.map((entry) => [entry.id, splittablePieceCount(entry.line)])), [everything]);
  const takeable = visible.filter((entry) => !entry.refusal).length;
  const chosen = new Set(selected);
  const splitting = selected.some((id) => {
    const total = pieceTotals.get(id) ?? 0;
    return total > 1 && going[id] !== undefined && going[id] < total;
  });

  function toggle(id: string) {
    setOffending([]);
    setSelected((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  }

  function step(id: string, delta: number) {
    const total = pieceTotals.get(id) ?? 0;
    setGoing((map) => ({ ...map, [id]: clampPiecesGoing((map[id] ?? total) + delta, total) }));
  }

  async function assign() {
    const request = assignLinesRequest(businessId, text(container.id, ""), selected, going, packages);
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
      // A sender who reported a problem: the server warns and refuses until
      // staff confirm; the package itself is never refused for it
      // (docs/AIR_PACKAGES.md §4.8). Declined, nothing is loaded.
      const response = await withProblemAcknowledgement(
        (acknowledgeProblems) => httpsCallable(functions, "assignContainerLines")(acknowledgeProblems ? { ...request, acknowledgeProblems: true } : request),
        async (lineIds) => {
          const codes = lineIds.map((id) => text(everything.find((entry) => entry.id === id)?.line.trackingCode, id));
          const ok = await confirmImportantAction(loadAnywayText(codes, "en"), loadAnywayText(codes, "fr"));
          return ok;
        },
      );
      if (!response) return;
      const answer = assignAnswerFrom(response.data);
      const message = assignedText(request.lineIds.length, containerName, lang);
      onAssigned(message);
      if (answer.parts.length === 0) {
        onClose();
        return;
      }
      // The pieces that stay are a new part with a new code: offer their labels.
      setParts(answer.parts);
      setDoneMessage(`${message} ${partsCreatedText(answer.parts.length, lang)}`);
    }, (failure) => {
      // A package that went to another container meanwhile, or whose country
      // no longer matches: name them so the person can untick and go on.
      setError(failure.message);
      setOffending(failure.offendingLineIds);
    });
  }

  if (printingParts && parts.length > 0) {
    return <ContainerLabelsDialog businessId={businessId} lines={partLabelStubs(parts)} onClose={onClose} />;
  }

  if (parts.length > 0) {
    return (
      <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
        <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
          <header className="lst-modal-head">
            <div>
              <h3>Added to the container</h3>
              <p data-no-translate>{doneMessage}</p>
            </div>
            <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </header>
          <div className="lst-modal-body">
            <ul className="wpk-pick-list">
              {parts.map((part) => (
                <li key={part.partLineId}>
                  <label>
                    <span aria-hidden="true"></span>
                    <span className="wpk-pick-main">
                      <code className="ctn-code" data-no-translate>{part.trackingCode}</code>
                    </span>
                    <span className="wpk-pick-side"><small data-no-translate>{piecesStayText(part.pieceCount, lang)}</small></span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="lst-hint wpk-split-note">Print new labels for the pieces that stay and put them on those pieces. No message is sent now; each part gets its own departed and ready-for-pickup messages.</p>
          </div>
          <footer className="lst-modal-foot">
            <button className="lst-btn ghost" type="button" onClick={onClose}>Done</button>
            <button className="lst-add" type="button" onClick={() => setPrintingParts(true)}><Tag size={16} /> Print labels for the pieces that stay</button>
          </footer>
        </div>
      </div>
    );
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
                    const total = pieceTotals.get(entry.id) ?? 0;
                    const ticked = chosen.has(entry.id);
                    const goes = going[entry.id] ?? total;
                    const preview = ticked && total > 1 ? splitPreviewRows(line, goes, packages, lang) : [];
                    return (
                      <li className={`${blocked ? "wpk-blocked" : ""}${flagged ? " wpk-flagged" : ""}`.trim() || undefined} key={entry.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={ticked}
                            disabled={blocked || busy}
                            onChange={() => toggle(entry.id)}
                          />
                          <span className="wpk-pick-main">
                            <strong data-no-translate={containerLineTitleIsCopy(line) ? undefined : true}>{containerLineTitle(line, lang)}</strong>
                            <small data-no-translate>
                              {[lineCustomer(line).name, lineCustomer(line).phone].filter(Boolean).join(" · ")}
                            </small>
                            {packageShipModeOf(line.shipMode) === "air" && <AirPackageBadge />}
                            {blocked && reason && <small className="wpk-block-reason">{reason}</small>}
                          </span>
                          <span className="wpk-pick-side">
                            <small data-no-translate>{place || "—"}</small>
                            {size && <small data-no-translate>{size.dimensionsText} · {size.volumeText}</small>}
                            {text(line.trackingCode, "") && <code className="ctn-code" data-no-translate>{text(line.trackingCode, "")}</code>}
                          </span>
                        </label>
                        {ticked && total > 1 && (
                          <div className="wpk-split">
                            <div className="wpk-split-stepper">
                              <button className="ghost-button" type="button" disabled={busy || goes <= 1} onClick={() => step(entry.id, -1)} aria-label="One piece fewer"><Minus size={14} /></button>
                              <strong data-no-translate aria-live="polite">{piecesGoingText(goes, total, lang)}</strong>
                              <button className="ghost-button" type="button" disabled={busy || goes >= total} onClick={() => step(entry.id, 1)} aria-label="One piece more"><Plus size={14} /></button>
                            </div>
                            {preview.map((row) => (
                              <small key={`${row.code}-${row.going}`} data-no-translate>
                                <code className="ctn-code">{row.code}</code> {row.text}
                              </small>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="lst-hint wpk-pick-count" role="status" data-no-translate>{selectedCountText(selected.length, lang)}</p>
              {splitting && (
                <p className="lst-hint wpk-split-note">The pieces that stay wait with their own code. No message is sent now; each part gets its own departed and ready-for-pickup messages. Print new labels for the pieces that stay.</p>
              )}
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
