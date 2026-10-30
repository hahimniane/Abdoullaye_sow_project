"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { ArrowRight, Camera, Check, HandCoins, RefreshCw, Scale, Undo2, X } from "lucide-react";

import { useStoragePhotoUrls } from "@/components/business/proof-ticks";
import { useShowMore } from "@/components/show-more";
import { useBusinessCollection } from "@/lib/business-data";
import { functions } from "@/lib/firebase";
import { formatDateTime } from "@/lib/format";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import { uploadStaffHandoverProof } from "@/lib/package-photo";
import { moneyText } from "@/lib/parking-month-statement";
import {
  BUSINESS_ACCOUNT_RECEIVER,
  HANDOVER_METHODS,
  HANDOVER_STATUS_LABELS,
  HANDOVER_STATUS_TONES,
  STAFF_BALANCES_TIMEOUT_MS,
  balanceTotals,
  breakdownLines,
  canVoidHandover,
  collectedByMethodLines,
  confirmHandoverRequest,
  declineHandoverRequest,
  emptyHandoverDraft,
  handoverFrom,
  handoverHistory,
  handoverMethodLabel,
  handoverPartyName,
  handoverProblem,
  isStaffHandoverProofPath,
  mergeHandovers,
  netPhrase,
  openingProblem,
  recordHandoverRequest,
  recordOpeningRequest,
  sortedBalanceRows,
  staffBalancesFrom,
  staffBalancesRefusalText,
  staffBalancesRequest,
  voidHandoverRequest,
  waitingOnViewerRows,
  type BalancesViewer,
  type Handover,
  type HandoverDraft,
  type OpeningDraft,
  type StaffBalanceRow,
  type StaffBalancesAnswer,
} from "@/lib/staff-balances";
import { statusPillClass } from "@/lib/status-pill";

type Busy = "" | "load" | "record" | "opening" | "confirm" | "decline" | "void";

const PHOTO_ERRORS: Record<string, string> = {
  "not-an-image": "That file is not a photo.",
  "image-unreadable": "That photo could not be read.",
  "image-too-large": "That photo is too large.",
  "no-session": "Sign in again to add photos.",
};
const PHOTO_FAILED = "One of the photos could not be used. Add it again.";
const photoError = (error: unknown) => PHOTO_ERRORS[error instanceof Error ? error.message : String(error)] ?? PHOTO_FAILED;

// ---------------------------------------------------------------------------
// The page: asks the server, listens to the hand-overs, runs the actions.
// ---------------------------------------------------------------------------

/**
 * Money -> Staff balances (docs/STAFF_BALANCES.md §4), open to everyone on
 * the team. The numbers come from the server (`staff_balances`, which sees
 * every payment source); the hand-over list is the live `staffHandovers`
 * collection (one equality query). Every action goes through
 * `updateLotExpenseEntry` and refreshes the numbers afterwards.
 */
export function StaffBalancesPanel({
  businessId,
  viewerUid,
  isOwner,
  previewMode = false,
}: {
  businessId: string;
  viewerUid: string;
  /** The business owner or a platform admin. */
  isOwner: boolean;
  previewMode?: boolean;
}) {
  const [answer, setAnswer] = useState<StaffBalancesAnswer | null>(null);
  const [loading, setLoading] = useState(!previewMode);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [busy, setBusy] = useState<Busy>("");
  const inFlight = useRef(false);
  const again = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const live = useBusinessCollection("staffHandovers", businessId, !previewMode, { pageSize: null, sort: "query" });
  const liveHandovers = useMemo(() => live.rows.map(handoverFrom).filter((h) => h.id), [live.rows]);

  const load = useCallback(async () => {
    if (previewMode || !businessId) return;
    // One ask at a time; a change that lands meanwhile asks once more.
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError("");
    let timer = 0;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("timeout")), STAFF_BALANCES_TIMEOUT_MS);
      });
      const response = await Promise.race([
        httpsCallable(functions, "updateLotExpenseEntry")(staffBalancesRequest(businessId)),
        timeout,
      ]);
      if (mounted.current) setAnswer(staffBalancesFrom((response as { data?: unknown }).data));
    } catch (failure) {
      if (mounted.current) {
        setError(
          failure instanceof Error && failure.message === "timeout"
            ? "Loading the balances is taking too long. Try again."
            : "The balances could not be loaded.",
        );
      }
    } finally {
      window.clearTimeout(timer);
      inFlight.current = false;
      if (mounted.current) setLoading(false);
      if (again.current && mounted.current) {
        again.current = false;
        void load();
      }
    }
  }, [businessId, previewMode]);

  useEffect(() => {
    void load();
  }, [load]);

  // The numbers follow the hand-overs: when one is answered, voided or added
  // (by anyone), ask again. The signature changes only with the data.
  const signature = useMemo(
    () => liveHandovers.map((h) => `${h.id}:${h.status}:${h.amountCents}`).sort().join("|"),
    [liveHandovers],
  );
  const firstSignature = useRef<string | null>(null);
  useEffect(() => {
    if (live.loading) return;
    if (firstSignature.current === null) {
      firstSignature.current = signature;
      return;
    }
    if (firstSignature.current !== signature) {
      firstSignature.current = signature;
      void load();
    }
  }, [live.loading, signature, load]);

  const viewer = useMemo<BalancesViewer>(() => ({ uid: viewerUid, isOwner }), [isOwner, viewerUid]);
  const names = useMemo(() => new Map((answer?.staff ?? []).map((s) => [s.staffId, s.name])), [answer]);
  const handovers = useMemo(
    () => mergeHandovers(liveHandovers, answer?.pending ?? []),
    [liveHandovers, answer],
  );

  /** Runs one action, then asks for the numbers again. Returns the refusal text, or "". */
  const act = useCallback(
    async (kind: Busy, payload: Record<string, unknown>, done: string): Promise<string> => {
      setBusy(kind);
      setFlash("");
      try {
        await httpsCallable(functions, "updateLotExpenseEntry")(payload);
        if (mounted.current) setFlash(done);
        void load();
        return "";
      } catch (failure) {
        return staffBalancesRefusalText(failure);
      } finally {
        if (mounted.current) setBusy("");
      }
    },
    [load],
  );

  return (
    <StaffBalancesView
      answer={answer}
      busy={busy}
      error={error}
      flash={flash}
      handovers={handovers}
      historyLoading={live.loading && !previewMode}
      loading={loading}
      names={names}
      onConfirm={async (id) => {
        const problem = await act("confirm", confirmHandoverRequest(businessId, id), "Hand-over confirmed.");
        if (problem) setFlash(problem);
      }}
      onDecline={(id, note) => act("decline", declineHandoverRequest(businessId, id, note), "Hand-over declined.")}
      onDismissFlash={() => setFlash("")}
      onHandover={(draft) => act("record", recordHandoverRequest(businessId, draft), "Hand-over recorded. It waits for the receiver to confirm.")}
      onOpening={(draft) => act("opening", recordOpeningRequest(businessId, draft), "Opening amount recorded.")}
      onRefresh={() => void load()}
      onVoid={(id, reason) => act("void", voidHandoverRequest(businessId, id, reason), "Hand-over voided.")}
      previewMode={previewMode}
      uploadProof={(file) => uploadStaffHandoverProof(businessId, file)}
      viewer={viewer}
    />
  );
}

// ---------------------------------------------------------------------------
// The view: everything on screen, from the answer and the hand-overs.
// ---------------------------------------------------------------------------

export function StaffBalancesView({
  answer,
  handovers,
  names,
  viewer,
  loading,
  historyLoading = false,
  error,
  flash,
  busy,
  previewMode = false,
  onRefresh,
  onDismissFlash,
  onHandover,
  onOpening,
  onConfirm,
  onDecline,
  onVoid,
  uploadProof,
}: {
  answer: StaffBalancesAnswer | null;
  handovers: readonly Handover[];
  names: ReadonlyMap<string, string>;
  viewer: BalancesViewer;
  loading: boolean;
  historyLoading?: boolean;
  error: string;
  flash: string;
  busy: Busy;
  previewMode?: boolean;
  onRefresh: () => void;
  onDismissFlash: () => void;
  onHandover: (draft: HandoverDraft) => Promise<string>;
  onOpening: (draft: OpeningDraft) => Promise<string>;
  onConfirm: (handoverId: string) => Promise<void>;
  onDecline: (handoverId: string, note: string) => Promise<string>;
  onVoid: (handoverId: string, reason: string) => Promise<string>;
  uploadProof: (file: File) => Promise<string>;
}) {
  const [detail, setDetail] = useState<StaffBalanceRow | null>(null);
  const [handing, setHanding] = useState(false);
  const [opening, setOpening] = useState(false);
  const [declining, setDeclining] = useState<Handover | null>(null);
  const [voiding, setVoiding] = useState<Handover | null>(null);

  const rows = useMemo(() => sortedBalanceRows(answer?.staff ?? []), [answer]);
  const totals = useMemo(() => balanceTotals(answer?.staff ?? []), [answer]);
  const waiting = useMemo(() => waitingOnViewerRows(handovers, viewer), [handovers, viewer]);
  const history = useMemo(() => handoverHistory(handovers), [handovers]);
  const { shown, remaining, showMore } = useShowMore(history, "staff-balances");
  const nameOf = (id: string) => handoverPartyName(id, names);
  const people = (answer?.staff ?? []).filter((s) => s.staffId !== viewer.uid);
  const account = answer?.businessAccount ?? { receivedCents: 0, pendingInCents: 0 };
  const photoPaths = useMemo(() => handovers.map((h) => h.proofPath).filter(isStaffHandoverProofPath), [handovers]);
  const photoUrls = useStoragePhotoUrls(photoPaths);

  return (
    <div className="sb-page stack">
      <article className="panel">
        <div className="panel-header">
          <div><Scale size={18} /><h2>Staff balances</h2></div>
          <div className="panel-action sb-actions">
            <button className="ghost-button compact" disabled={loading || previewMode} onClick={onRefresh} type="button">
              <RefreshCw className={loading ? "spin" : undefined} size={14} /> {loading ? "Loading…" : "Refresh"}
            </button>
            {viewer.isOwner && (
              <button className="lst-btn ghost" disabled={!answer || previewMode} onClick={() => setOpening(true)} type="button">
                Opening amount
              </button>
            )}
            <button className="lst-add" disabled={!answer || previewMode} onClick={() => setHanding(true)} type="button">
              <HandCoins size={16} /> Hand over money
            </button>
          </div>
        </div>
        <p className="panel-lede">
          Who is holding the business&apos;s money, who owes it and who it owes. Everyone on the team sees every balance.
        </p>
        {flash && (
          <p className="dlv-notice" role="status">
            {flash} <button className="ghost-button" onClick={onDismissFlash} type="button">Dismiss</button>
          </p>
        )}
        {error && (
          <div className="lst-form-error" role="alert">
            {error} <button className="ghost-button" disabled={loading} onClick={onRefresh} type="button">Retry</button>
          </div>
        )}
        {!answer && loading && <p className="lst-hint">Loading the balances…</p>}
        {answer && (
          <div className="sb-tiles">
            <div className="metric sb-tile"><span>Held by the team</span><b data-no-translate>{moneyText(totals.heldCents)}</b></div>
            <div className="metric sb-tile"><span>Team owes the business</span><b data-no-translate>{moneyText(totals.owedToBusinessCents)}</b></div>
            <div className="metric sb-tile"><span>The business owes the team</span><b data-no-translate>{moneyText(totals.owedToStaffCents)}</b></div>
          </div>
        )}
      </article>

      {waiting.length > 0 && (
        <article className="panel sb-waiting" aria-label="Waiting on you">
          <div className="panel-header">
            <div><HandCoins size={18} /><h2>Waiting on you</h2></div>
            <span className="status-pill warning" data-no-translate>{waiting.length}</span>
          </div>
          <p className="panel-lede">Money handed to you. Confirm it once you have it.</p>
          <ul className="sb-list">
            {waiting.map((h) => (
              <li key={h.id}>
                <HandoverLine h={h} nameOf={nameOf} proofUrl={photoUrls[h.proofPath]} />
                <span className="sb-row-actions">
                  <button className="lst-add" disabled={busy !== ""} onClick={() => void onConfirm(h.id)} type="button">
                    {busy === "confirm" ? <RefreshCw className="spin" size={14} /> : <Check size={14} />} Confirm received
                  </button>
                  <button className="lst-btn ghost danger" disabled={busy !== ""} onClick={() => setDeclining(h)} type="button">
                    <X size={14} /> Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </article>
      )}

      {answer && (
        <article className="panel">
          <div className="panel-header"><div><Scale size={18} /><h2>Balances</h2></div></div>
          {rows.length === 0 ? (
            <div className="empty-state">No team members to show yet.</div>
          ) : (
            <div className="sb-table" role="table">
              <div className="sb-head" role="row">
                <span role="columnheader">Person</span>
                <span role="columnheader">Money held</span>
                <span role="columnheader">Parking bill</span>
                <span role="columnheader">Expenses owed to them</span>
                <span role="columnheader">Net</span>
                <span aria-hidden="true" />
              </div>
              {rows.map((row) => {
                const net = netPhrase(row.netCents);
                return (
                  <div className="sb-row" key={row.staffId} role="row">
                    <span className="sb-person" role="cell">
                      <strong data-no-translate>{row.name || nameOf(row.staffId)}</strong>
                      {row.staffId === viewer.uid && <small className="sb-you">You</small>}
                      {row.staffId === viewer.uid && row.pendingInCents > 0 && (
                        <small className="sb-pending">Waiting for you to confirm</small>
                      )}
                    </span>
                    <span className="sb-cell" role="cell"><span className="sb-label">Money held</span><b data-no-translate>{moneyText(row.heldCents)}</b></span>
                    <span className="sb-cell" role="cell"><span className="sb-label">Parking bill</span><b data-no-translate>{moneyText(row.parkingDueCents)}</b></span>
                    <span className="sb-cell" role="cell"><span className="sb-label">Expenses owed to them</span><b data-no-translate>{moneyText(row.expenseOwedToThemCents)}</b></span>
                    <span className={`sb-cell sb-net ${net.tone}`} role="cell"><span className="sb-label">Net</span>
                      <small>{net.label}</small>
                      {net.cents > 0 && <b data-no-translate>{moneyText(net.cents)}</b>}
                    </span>
                    <span className="sb-more" role="cell">
                      <button className="lst-btn ghost" onClick={() => setDetail(row)} type="button">Details</button>
                    </span>
                  </div>
                );
              })}
              <div className="sb-row sb-account" role="row">
                <span className="sb-person" role="cell">
                  <strong>Business account</strong>
                  <small>Zelle, transfer and card payments, and money handed to the business</small>
                </span>
                <span className="sb-cell" role="cell"><span className="sb-label">Received so far</span><b data-no-translate>{moneyText(account.receivedCents)}</b></span>
                <span className="sb-cell" role="cell"><span className="sb-label">Waiting to be confirmed</span><b data-no-translate>{moneyText(account.pendingInCents)}</b></span>
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
              </div>
            </div>
          )}
        </article>
      )}

      <article className="panel">
        <div className="panel-header"><div><HandCoins size={18} /><h2>Hand-overs</h2></div></div>
        {historyLoading && history.length === 0 ? (
          <p className="lst-hint">Loading…</p>
        ) : history.length === 0 ? (
          <div className="empty-state">No hand-over has been recorded yet.</div>
        ) : (
          <ul className="sb-list sb-history">
            {shown.map((h) => (
              <li key={h.id}>
                <HandoverLine h={h} nameOf={nameOf} proofUrl={photoUrls[h.proofPath]} />
                <span className="sb-row-actions">
                  <span className={statusPillClass(HANDOVER_STATUS_TONES[h.status])}>{HANDOVER_STATUS_LABELS[h.status]}</span>
                  {canVoidHandover(h, viewer) && (
                    <button
                      aria-label="Void this hand-over"
                      className="ghost-button"
                      disabled={busy !== ""}
                      onClick={() => setVoiding(h)}
                      title="Void this hand-over"
                      type="button"
                    >
                      <Undo2 size={14} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {remaining > 0 && (
          <button className="ghost-button" onClick={showMore} type="button">Show more</button>
        )}
      </article>

      {detail && <BalanceDrawer row={detail} onClose={() => setDetail(null)} />}
      {handing && (
        <HandoverDialog
          onClose={() => setHanding(false)}
          onSubmit={onHandover}
          people={people}
          uploadProof={uploadProof}
          viewerUid={viewer.uid}
        />
      )}
      {opening && (
        <OpeningDialog
          onClose={() => setOpening(false)}
          onSubmit={onOpening}
          people={answer?.staff ?? []}
        />
      )}
      {declining && (
        <ReasonDialog
          confirmLabel="Decline hand-over"
          intro="The giver keeps the money on their balance. You can leave a note to tell them why."
          label="Note (optional)"
          onClose={() => setDeclining(null)}
          onSubmit={(note) => onDecline(declining.id, note)}
          title="Decline this hand-over?"
          tone="danger"
        />
      )}
      {voiding && (
        <ReasonDialog
          confirmLabel="Void hand-over"
          intro="It stays in the history, marked void, and no balance changes because of it."
          label="Reason (optional)"
          onClose={() => setVoiding(null)}
          onSubmit={(reason) => onVoid(voiding.id, reason)}
          title="Void this hand-over?"
          tone="danger"
        />
      )}
    </div>
  );
}

/** One hand-over as a line: who to whom, how much, how, when, and the note / photo. */
function HandoverLine({ h, nameOf, proofUrl }: { h: Handover; nameOf: (id: string) => string; proofUrl?: string }) {
  const opening = h.kind === "opening";
  return (
    <span className="sb-line">
      <span className="sb-line-main">
        {opening ? (
          <>
            <span className="status-pill navy">Opening amount</span>{" "}
            <strong data-no-translate>{nameOf(h.fromStaffId)}</strong>
          </>
        ) : (
          <>
            <strong data-no-translate>{nameOf(h.fromStaffId)}</strong>
            <ArrowRight aria-hidden="true" size={14} />
            <strong data-no-translate>{nameOf(h.toId)}</strong>
          </>
        )}
        <b className="sb-amount" data-no-translate>{moneyText(h.amountCents)}</b>
      </span>
      <small>
        {!opening && h.method ? <><span>{handoverMethodLabel(h.method)}</span> · </> : null}
        <span data-no-translate>{formatDateTime(h.createdAtMs)}</span>
        {h.note ? <> · <span data-no-translate>{h.note}</span></> : null}
      </small>
      {h.status === "declined" && h.declineNote && (
        <small className="sb-reason"><span>Reason</span>: <span data-no-translate>{h.declineNote}</span></small>
      )}
      {h.status === "voided" && h.voidReason && (
        <small className="sb-reason"><span>Reason</span>: <span data-no-translate>{h.voidReason}</span></small>
      )}
      {proofUrl && (
        <a className="sb-proof" href={proofUrl} rel="noopener noreferrer" target="_blank">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="Photo of the hand-over slip" src={proofUrl} />
        </a>
      )}
    </span>
  );
}

/** A person's breakdown: how their numbers add up. */
function BalanceDrawer({ row, onClose }: { row: StaffBalanceRow; onClose: () => void }) {
  const methods = collectedByMethodLines(row);
  return (
    <div className="lst-modal-overlay destination-drawer-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal destination-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div><h3 data-no-translate>{row.name || "—"}</h3><p>Breakdown</p></div>
          <button aria-label="Close" className="lst-icon-btn" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          <dl className="sb-breakdown">
            {breakdownLines(row).map((line) => (
              <div className={line.key === "net" ? "sb-total" : undefined} key={line.key}>
                <dt>{line.label}</dt>
                <dd data-no-translate>{moneyText(line.cents)}</dd>
              </div>
            ))}
          </dl>
          <div className="lst-form-section">Collected by method</div>
          {methods.length === 0 ? (
            <p className="lst-hint">Nothing collected yet.</p>
          ) : (
            <dl className="sb-breakdown">
              {methods.map((m) => (
                <div key={m.method}><dt>{m.label}</dt><dd data-no-translate>{moneyText(m.cents)}</dd></div>
              ))}
            </dl>
          )}
          <div className="lst-form-section">Waiting to be confirmed</div>
          <dl className="sb-breakdown">
            <div><dt>Handed over, waiting for the receiver</dt><dd data-no-translate>{moneyText(row.pendingOutCents)}</dd></div>
            <div><dt>Handed to them, waiting for their confirmation</dt><dd data-no-translate>{moneyText(row.pendingInCents)}</dd></div>
          </dl>
          <div className="lst-form-section">Expenses</div>
          <dl className="sb-breakdown">
            <div><dt>Expenses they paid for the lot</dt><dd data-no-translate>{moneyText(row.expenseCreditCents)}</dd></div>
          </dl>
          <p className="lst-hint">Net is the money held plus the parking bill, minus what the business owes for expenses.</p>
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" onClick={onClose} type="button">Close</button>
        </footer>
      </div>
    </div>
  );
}

/** Hand over money: to a person or the Business account, how, a note, an optional photo. */
function HandoverDialog({
  people,
  viewerUid,
  onClose,
  onSubmit,
  uploadProof,
}: {
  people: readonly StaffBalanceRow[];
  viewerUid: string;
  onClose: () => void;
  onSubmit: (draft: HandoverDraft) => Promise<string>;
  uploadProof: (file: File) => Promise<string>;
}) {
  const [draft, setDraft] = useState<HandoverDraft>(emptyHandoverDraft);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoPreview, setPhotoPreview] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  async function addPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setError("");
    const preview = URL.createObjectURL(file);
    try {
      const path = await uploadProof(file);
      setDraft((d) => ({ ...d, proofPath: path }));
      setPhotoPreview(preview);
    } catch (failure) {
      URL.revokeObjectURL(preview);
      setError(photoError(failure));
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function save() {
    const problem = handoverProblem(draft, viewerUid, people.map((p) => p.staffId));
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    const refusal = await onSubmit(draft);
    setBusy(false);
    if (refusal) setError(refusal);
    else onClose();
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!busy) onClose(); })}>
      <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div><h3>Hand over money</h3><p>You are the one giving the money.</p></div>
          <button aria-label="Close" className="lst-icon-btn" disabled={busy} onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          <div className="lst-form-grid">
            <label className="lst-field wide"><span>Give to</span>
              <select disabled={busy} onChange={(e) => setDraft((d) => ({ ...d, toId: e.target.value }))} value={draft.toId}>
                <option value="">Choose who receives it</option>
                <option value={BUSINESS_ACCOUNT_RECEIVER}>Business account (the owner confirms)</option>
                {people.map((p) => (<option data-no-translate key={p.staffId} value={p.staffId}>{p.name}</option>))}
              </select>
            </label>
            <label className="lst-field"><span>Amount ($)</span>
              <input autoFocus disabled={busy} inputMode="decimal" onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} value={draft.amount} />
            </label>
            <label className="lst-field"><span>How it was handed over</span>
              <select disabled={busy} onChange={(e) => setDraft((d) => ({ ...d, method: e.target.value }))} value={draft.method}>
                {HANDOVER_METHODS.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
              </select>
            </label>
            <label className="lst-field wide"><span>Note</span>
              <input disabled={busy} maxLength={300} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} value={draft.note} />
            </label>
          </div>
          <div className="sb-photo">
            <span className="lst-hint">Photo of the slip or screenshot (optional)</span>
            {photoPreview && (
              <figure className="pkr-photo ready">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt="Photo of the hand-over slip" src={photoPreview} />
                <button
                  aria-label="Remove photo"
                  className="pkr-photo-remove"
                  disabled={busy}
                  onClick={() => { setPhotoPreview(""); setDraft((d) => ({ ...d, proofPath: "" })); }}
                  type="button"
                >
                  <X aria-hidden="true" size={12} />
                </button>
              </figure>
            )}
            {!photoPreview && (
              <button className="lst-btn ghost" disabled={busy || photoBusy} onClick={() => fileInput.current?.click()} type="button">
                {photoBusy ? <RefreshCw className="spin" size={14} /> : <Camera size={14} />} Add photo
              </button>
            )}
            <input accept="image/*" hidden onChange={(e) => void addPhoto(e.target.files?.[0])} ref={fileInput} type="file" />
          </div>
          <p className="lst-hint">The person you choose must confirm they received it. Until then your balance does not change.</p>
        </div>
        <footer className="lst-modal-foot">
          {busy && <span className="lst-hint" role="status" style={{ marginRight: "auto" }}><RefreshCw className="spin" size={13} /> Saving…</span>}
          <button className="lst-btn ghost" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="lst-add" disabled={busy || photoBusy} onClick={() => void save()} type="button">
            <HandCoins size={16} /> Record hand-over
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Opening amount (owner): what a person handed over before Staff balances existed, confirmed in one step. */
function OpeningDialog({
  people,
  onClose,
  onSubmit,
}: {
  people: readonly StaffBalanceRow[];
  onClose: () => void;
  onSubmit: (draft: OpeningDraft) => Promise<string>;
}) {
  const [draft, setDraft] = useState<OpeningDraft>({ staffId: "", amount: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const problem = openingProblem(draft, people.map((p) => p.staffId));
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    const refusal = await onSubmit(draft);
    setBusy(false);
    if (refusal) setError(refusal);
    else onClose();
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!busy) onClose(); })}>
      <div className="lst-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div><h3>Opening amount</h3><p>Money already handed to the business before Staff balances existed.</p></div>
          <button aria-label="Close" className="lst-icon-btn" disabled={busy} onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          <div className="lst-form-grid">
            <label className="lst-field wide"><span>Team member</span>
              <select disabled={busy} onChange={(e) => setDraft((d) => ({ ...d, staffId: e.target.value }))} value={draft.staffId}>
                <option value="">Choose a team member</option>
                {people.map((p) => (<option data-no-translate key={p.staffId} value={p.staffId}>{p.name}</option>))}
              </select>
            </label>
            <label className="lst-field"><span>Amount ($)</span>
              <input disabled={busy} inputMode="decimal" onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} value={draft.amount} />
            </label>
            <label className="lst-field wide"><span>Note</span>
              <input disabled={busy} maxLength={300} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} value={draft.note} />
            </label>
          </div>
          <p className="lst-hint">It is recorded and confirmed right away, and lowers what this person is holding by the amount.</p>
        </div>
        <footer className="lst-modal-foot">
          {busy && <span className="lst-hint" role="status" style={{ marginRight: "auto" }}><RefreshCw className="spin" size={13} /> Saving…</span>}
          <button className="lst-btn ghost" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="lst-add" disabled={busy} onClick={() => void save()} type="button">
            <Check size={16} /> Record opening amount
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Decline / Void: one optional line of text, then the action. */
function ReasonDialog({
  title,
  intro,
  label,
  confirmLabel,
  tone,
  onClose,
  onSubmit,
}: {
  title: string;
  intro: string;
  label: string;
  confirmLabel: string;
  tone: "danger";
  onClose: () => void;
  onSubmit: (text: string) => Promise<string>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    const refusal = await onSubmit(value);
    setBusy(false);
    if (refusal) setError(refusal);
    else onClose();
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!busy) onClose(); })}>
      <div className="lst-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div><h3>{title}</h3></div>
          <button aria-label="Close" className="lst-icon-btn" disabled={busy} onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          <p className="lst-hint" style={{ marginTop: 0 }}>{intro}</p>
          <label className="lst-field wide"><span>{label}</span>
            <input disabled={busy} maxLength={300} onChange={(e) => setValue(e.target.value)} value={value} />
          </label>
        </div>
        <footer className="lst-modal-foot">
          {busy && <span className="lst-hint" role="status" style={{ marginRight: "auto" }}><RefreshCw className="spin" size={13} /> Saving…</span>}
          <button className="lst-btn ghost" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className={`lst-btn ${tone}`} disabled={busy} onClick={() => void save()} type="button">{confirmLabel}</button>
        </footer>
      </div>
    </div>
  );
}
