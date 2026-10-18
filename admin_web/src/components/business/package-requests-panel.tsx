"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref } from "firebase/storage";
import {
  CheckCircle2,
  CreditCard,
  Download,
  History,
  Lock,
  MapPin,
  Phone,
  RefreshCw,
  Settings,
  Store,
  Tag,
  Truck,
  X,
  XCircle,
} from "lucide-react";

import { ContainerLabelsDialog } from "@/components/business/container-labels-dialog";
import { PiecesEditor } from "@/components/business/pieces-editor";
import { CONTAINER_MESSAGES } from "@/lib/container-manifest";
import type { PieceDraft } from "@/lib/piece-drafts";
import { CopyValue } from "@/components/copy-value";
import { auth, functions, storage } from "@/lib/firebase";
import { currentLanguage } from "@/lib/format";
import { INVOICE_PAYMENT_METHODS, INVOICE_PAYMENT_METHOD_LABELS, centsToInput as ledgerCentsToInput, type InvoicePaymentMethod } from "@/lib/invoice-ledger";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import {
  LOCK_HEARTBEAT_MS,
  PICKUP_WINDOW_LABELS,
  PICKUP_WINDOWS,
  DEFAULT_TIME_ZONE,
  estimateScheduleDraft,
  pickableDays,
  pickupWhen,
  pieceKindLabel,
  REQUEST_ERROR_MESSAGES,
  REQUEST_STATUS_LABELS,
  WEEK_DAYS,
  centsToInput,
  countryName,
  draftTotalCents,
  estimateDraftPrices,
  expectedRequests,
  filterRequests,
  lockView,
  moneyText,
  pieceSummaryText,
  plannedDayText,
  readDollars,
  receiveDraftsFrom,
  receivedLineStub,
  receivePayload,
  receivePrefillPickupFeeCents,
  receiveTakesPickupFee,
  requestEstimate,
  requestFailure,
  requestFilterCounts,
  requestHistory,
  requestLink,
  requestLocationsFor,
  requestPieces,
  requestSettingsDraft,
  requestSettingsPayload,
  requestSettingsProblems,
  requestStatus,
  receivedFlash,
  sendEstimatePayload,
  slugEditable,
  type RequestFilter,
  type RequestSettingsDraft,
  type SettingsLocation,
  type WeekDay,
} from "@/lib/package-requests";
import type { FirestoreRow } from "@/types/admin";

type Row = Record<string, unknown>;

const DAY_LABELS: Record<WeekDay, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function asRow(value: unknown): Row {
  return value && typeof value === "object" ? (value as Row) : {};
}

function str(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

function lang(): "en" | "fr" {
  return currentLanguage() === "fr" ? "fr" : "en";
}

async function callRequest<T = Row>(name: string, data: Record<string, unknown>): Promise<T> {
  const response = await httpsCallable<Record<string, unknown>, T>(functions, name)(data);
  return response.data;
}

/**
 * "planned Sat, Oct 24" / "Tue morning, 12 Grand Concourse": when the goods
 * come in. A collect request shows the business's own day and window once
 * an estimate set them, and the customer's pickup note, always.
 */
function WhenLine({ row }: { row: Row }) {
  const l = lang();
  const when = pickupWhen(row);
  if (when) {
    return (
      <>
        <small className="pkq-when">
          <Truck aria-hidden="true" size={13} /> <span>{when.scheduled ? "Pickup scheduled" : "Pickup"}</span>{" "}
          {when.date && <span data-no-translate>{plannedDayText(when.date, l)}</span>}{" "}
          {when.window && <span>{PICKUP_WINDOW_LABELS[when.window]}</span>}
          {when.address && <span data-no-translate>{` · ${when.address}`}</span>}
        </small>
        {when.note && (
          <small className="pkq-note"><span>Note:</span> <span data-no-translate>{when.note}</span></small>
        )}
      </>
    );
  }
  const planned = str(row.plannedDate, 10);
  return (
    <small className="pkq-when">
      <Store aria-hidden="true" size={13} /> <span>Bring it in</span>
      {planned && (
        <>
          {" · "}<span>planned</span> <span data-no-translate>{plannedDayText(planned, l)}</span>
        </>
      )}
      {str(asRow(row.location).label) && <span data-no-translate>{` · ${str(asRow(row.location).label)}`}</span>}
    </small>
  );
}

function WhatsAppLine({ row }: { row: Row }) {
  if (row.whatsappUnreachable === true) {
    return <small className="pkq-warn"><Phone aria-hidden="true" size={13} /> Customer not reachable on WhatsApp — call them.</small>;
  }
  const status = str(asRow(row.whatsapp).status);
  // waiting_for_whatsapp: the business has no WhatsApp number connected
  // yet; waiting_for_template: Meta has not approved the template yet.
  if (status === "waiting_for_whatsapp") {
    return <small className="pkq-muted">WhatsApp is not connected yet. The message goes once it is.</small>;
  }
  if (status === "waiting_for_template") {
    return <small className="pkq-muted">Waiting for WhatsApp to approve the message.</small>;
  }
  return null;
}

function PersonLines({ row }: { row: Row }) {
  const sender = asRow(row.sender);
  const receiver = asRow(row.receiver);
  return (
    <span className="pkq-people">
      <strong data-no-translate>{str(sender.name)}</strong>
      <small data-no-translate>{str(sender.phoneE164)}</small>
      {str(receiver.name) && <small data-no-translate>→ {str(receiver.name)}{str(receiver.phoneE164) ? ` · ${str(receiver.phoneE164)}` : ""}</small>}
    </span>
  );
}

function RequestTitle({ row }: { row: Row }) {
  const l = lang();
  const destination = { id: str(row.destinationCountryId, 60), name: str(row.destinationCountryName, 120) };
  return (
    <span className="pkq-title">
      <strong data-no-translate>{pieceSummaryText(requestPieces(row), l)}</strong>
      <small>
        <span data-no-translate>{str(row.code, 20)}</span>
        {destination.id && <span data-no-translate>{` · ${countryName(destination, l)}`}</span>}
      </small>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The Requests view.
// ---------------------------------------------------------------------------

type PanelProps = {
  businessId: string;
  business: FirestoreRow | null;
  rows: FirestoreRow[];
  loading: boolean;
  error: string;
  tabs: ReactNode;
  officeLocations: readonly unknown[];
  onFlash: (message: string) => void;
  enabled: boolean;
  focusId?: string;
};

/**
 * Containers → Requests (docs/PACKAGE_REQUESTS.md §2): what customers asked
 * for, by what it needs - an estimate, or the customer's answer. One person
 * writes an estimate at a time; the others see who.
 */
export function PackageRequestsPanel({ businessId, business, rows, loading, error, tabs, officeLocations, onFlash, enabled, focusId = "" }: PanelProps) {
  const [filter, setFilter] = useState<RequestFilter>("needs_estimate");
  const [openId, setOpenId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const counts = requestFilterCounts(rows);
  const shown = filterRequests(rows, filter);
  const uid = auth.currentUser?.uid ?? "";
  const open = rows.find((row) => str(row.id) === openId) ?? null;

  // A notification opens its request.
  useEffect(() => {
    if (!focusId) return;
    const row = rows.find((r) => str(r.id) === focusId);
    if (!row) return;
    const status = requestStatus(row);
    if (status === "estimate_sent") setFilter("waiting_customer");
    if (status === "new" || status === "estimate_sent") setOpenId(focusId);
  }, [focusId, rows]);

  return (
    <article className="panel">
      <div className="panel-header">
        <div><h2>Containers</h2><span className="panel-count">{counts.needs_estimate + counts.waiting_customer}</span></div>
        <span className="panel-action">
          <button className="lst-btn ghost" disabled={!enabled} onClick={() => setSettingsOpen(true)} type="button"><Settings size={16} aria-hidden="true" /> Request settings</button>
        </span>
      </div>
      {tabs}
      <div className="pkq-chips" role="tablist" aria-label="Request filters">
        {([
          ["needs_estimate", "Needs estimate", counts.needs_estimate],
          ["waiting_customer", "Waiting for customer", counts.waiting_customer],
        ] as [RequestFilter, string, number][]).map(([id, label, count]) => (
          <button aria-selected={filter === id} className={`pkq-chip ${filter === id ? "active" : ""}`} key={id} onClick={() => setFilter(id)} role="tab" type="button">
            <span>{label}</span> <b data-no-translate>· {count}</b>
          </button>
        ))}
      </div>
      <p className="panel-lede">Customers ask on your request link. Send each one an estimate on WhatsApp; confirmed requests wait in the Waiting list as Expected.</p>
      {business && !asRow(business.packageRequestSettings).acceptRequests && (
        <p className="pkq-banner" role="status">You are not taking new requests. Turn them on in Request settings; open requests continue either way.</p>
      )}
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {loading && rows.length === 0 ? (
        <div className="empty-state"><RefreshCw className="spin" size={16} aria-hidden="true" /> Loading…</div>
      ) : shown.length === 0 ? (
        <div className="empty-state">{filter === "needs_estimate" ? "No request needs an estimate." : "No estimate is waiting for a customer."}</div>
      ) : (
        <div className="pkq-cards">
          {shown.map((row) => {
            const lock = lockView(row, uid);
            const estimate = requestEstimate(row);
            return (
              <button className={`pkq-card ${str(row.id) === focusId ? "focus" : ""}`} key={str(row.id)} onClick={() => setOpenId(str(row.id))} type="button">
                <RequestTitle row={row} />
                <PersonLines row={row} />
                <WhenLine row={row} />
                {estimate && (
                  <small><span>Estimate</span> <span data-no-translate>{`v${estimate.version} · ${moneyText(estimate.totalCents, lang())}`}</span></small>
                )}
                {lock.lockedByOther && (
                  <small className="pkq-lock"><Lock aria-hidden="true" size={13} /> <span data-no-translate>{lock.name}</span> <span>is writing the estimate</span></small>
                )}
                <WhatsAppLine row={row} />
              </button>
            );
          })}
        </div>
      )}
      {open && (
        <EstimateDialog businessId={businessId} onClose={() => setOpenId("")} onFlash={onFlash} row={open} />
      )}
      {settingsOpen && (
        <RequestSettingsDialog business={business} businessId={businessId} officeLocations={officeLocations} onClose={() => setSettingsOpen(false)} onFlash={onFlash} />
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// The estimate editor, with its lock.
// ---------------------------------------------------------------------------

function RequestPhotos({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join("|");
  useEffect(() => {
    let active = true;
    for (const path of key ? key.split("|") : []) {
      getDownloadURL(ref(storage, path))
        .then((url) => {
          if (active) setUrls((current) => ({ ...current, [path]: url }));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [key]);
  if (paths.length === 0) return null;
  return (
    <span className="pkq-photos">
      {paths.map((path) =>
        urls[path] ? (
          <a href={urls[path]} key={path} rel="noopener noreferrer" target="_blank">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="Photo from the customer" src={urls[path]} />
          </a>
        ) : (
          <span className="pkq-photo-wait" key={path}><RefreshCw className="spin" size={12} aria-hidden="true" /></span>
        ),
      )}
    </span>
  );
}

function HistoryList({ row }: { row: Row }) {
  const entries = requestHistory(row);
  const l = lang();
  if (entries.length === 0) return null;
  return (
    <details className="pkq-history">
      <summary><History size={14} aria-hidden="true" /> History</summary>
      <ul>
        {entries.map((entry, index) => (
          <li key={index}>
            <span>{entry.label}</span>
            {entry.version !== null && <span data-no-translate>{` v${entry.version}`}</span>}
            {entry.totalCents !== null && <span data-no-translate>{` · ${moneyText(entry.totalCents, l)}`}</span>}
            {entry.change && <span data-no-translate>{` ${entry.change}`}</span>}
            {entry.byName && <small data-no-translate>{entry.byName}</small>}
            {entry.reason && <small data-no-translate>{entry.reason}</small>}
            {entry.atMs > 0 && (
              <small data-no-translate>
                {new Intl.DateTimeFormat(l === "fr" ? "fr-FR" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(entry.atMs))}
              </small>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function EstimateDialog({ businessId, row, onClose, onFlash }: { businessId: string; row: Row; onClose: () => void; onFlash: (m: string) => void }) {
  const l = lang();
  const requestId = str(row.id);
  const [prices, setPrices] = useState<Record<string, string>>(() => estimateDraftPrices(row, l));
  const [pickupFee, setPickupFee] = useState(() => centsToInput(requestEstimate(row)?.pickupFeeCents || null, l));
  const [note, setNote] = useState(() => requestEstimate(row)?.note ?? "");
  // The real pickup day and time (spec §2, §8.6 sendPackageEstimate
  // pickupSchedule): prefilled from the last estimate, else the customer's ask.
  const [schedule, setSchedule] = useState(() => estimateScheduleDraft(row));
  const [lockState, setLockState] = useState<"taking" | "mine" | "other" | "closed">("taking");
  const [lockedBy, setLockedBy] = useState("");
  const [busy, setBusy] = useState<"" | "send" | "phone" | "lock">("");
  const [error, setError] = useState("");
  const [closing, setClosing] = useState(false);
  const held = useRef(false);
  const pieces = requestPieces(row);
  const estimate = requestEstimate(row);
  const total = draftTotalCents(row, prices, pickupFee);
  const collect = str(row.handoff) === "collect";
  const status = requestStatus(row);

  const takeLock = useCallback(async () => {
    setBusy("lock");
    setError("");
    try {
      await callRequest("startPackageEstimate", { businessId, requestId });
      held.current = true;
      setLockState("mine");
    } catch (err) {
      const failure = requestFailure(err);
      if (failure.reason === "estimate_locked") {
        setLockedBy(str(failure.details.lockedByName));
        setLockState("other");
      } else {
        setLockState("closed");
        setError(failure.message);
      }
    } finally {
      setBusy("");
    }
  }, [businessId, requestId]);

  useEffect(() => {
    void takeLock();
  }, [takeLock]);

  // Keep the lock while the editor is open; give it back when it closes.
  useEffect(() => {
    if (lockState !== "mine") return undefined;
    const timer = window.setInterval(() => {
      void callRequest("startPackageEstimate", { businessId, requestId }).catch(() => undefined);
    }, LOCK_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [lockState, businessId, requestId]);
  useEffect(() => () => {
    if (held.current) void callRequest("releasePackageEstimate", { businessId, requestId }).catch(() => undefined);
  }, [businessId, requestId]);

  async function send() {
    const { payload, error: problem } = sendEstimatePayload(businessId, row, prices, { pickupFee, note, schedule });
    if (!payload) {
      setError(REQUEST_ERROR_MESSAGES[problem] ?? REQUEST_ERROR_MESSAGES.amount_invalid);
      return;
    }
    setBusy("send");
    setError("");
    try {
      const result = await callRequest<{ version: number; status: string; reconfirmRequired: boolean; priceDropped: boolean }>("sendPackageEstimate", payload);
      held.current = false;
      onFlash(result.reconfirmRequired ? "Estimate sent. The price went up, so the customer confirms again." : result.priceDropped ? "Estimate sent. The customer is told the price went down." : "Estimate sent on WhatsApp.");
      onClose();
    } catch (err) {
      const failure = requestFailure(err);
      setError(failure.message);
      if (failure.reason === "estimate_locked") {
        setLockedBy(str(failure.details.lockedByName));
        setLockState("other");
      }
    } finally {
      setBusy("");
    }
  }

  async function agreedByPhone() {
    if (!estimate) return;
    setBusy("phone");
    setError("");
    try {
      await callRequest("confirmPackageRequestByPhone", { businessId, requestId, version: estimate.version });
      onFlash("Marked as agreed by phone. It is now Expected in the Waiting list.");
      onClose();
    } catch (err) {
      setError(requestFailure(err).message);
    } finally {
      setBusy("");
    }
  }

  const editable = lockState === "mine";
  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal pkq-modal" onClick={(event) => event.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>Estimate</h3>
            <p><span data-no-translate>{str(row.code)}</span> · <span>{REQUEST_STATUS_LABELS[status]}</span></p>
          </div>
          <button aria-label="Close" className="lst-icon-btn" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {lockState === "other" && (
            <div className="pkq-banner warn" role="status">
              <Lock aria-hidden="true" size={16} /> <span data-no-translate>{lockedBy}</span> <span>is writing the estimate</span>
              <button className="ghost-button" disabled={busy === "lock"} onClick={() => void takeLock()} type="button">Retry</button>
            </div>
          )}
          {lockState === "taking" && <div className="pkq-banner" role="status"><RefreshCw className="spin" size={14} aria-hidden="true" /> Opening…</div>}
          <div className="pkq-detail">
            <PersonLines row={row} />
            <WhenLine row={row} />
            <WhatsAppLine row={row} />
          </div>
          <div className="pkq-pieces">
            {pieces.map((piece, index) => (
              <div className="pkq-piece" key={piece.id}>
                <span>
                  <strong><span data-no-translate>{`${index + 1}. `}</span><span data-no-translate>{pieceKindLabel(piece.kind, lang())}</span></strong>
                  {piece.description && <small data-no-translate>{piece.description}</small>}
                  <RequestPhotos paths={piece.photoPaths} />
                </span>
                <label className="lst-field pkq-price">
                  <span>Price ($)</span>
                  <input disabled={!editable} inputMode="decimal" onChange={(event) => setPrices((p) => ({ ...p, [piece.id]: event.target.value }))} placeholder={l === "fr" ? "0,00" : "0.00"} value={prices[piece.id] ?? ""} />
                </label>
              </div>
            ))}
            {collect && (
              <div className="pkq-piece">
                <span><strong>Pickup fee</strong></span>
                <label className="lst-field pkq-price">
                  <span>Price ($)</span>
                  <input disabled={!editable} inputMode="decimal" onChange={(event) => setPickupFee(event.target.value)} placeholder={l === "fr" ? "0,00" : "0.00"} value={pickupFee} />
                </label>
              </div>
            )}
          </div>
          {collect && (
            <div className="pkq-schedule">
              <label className="lst-field">
                <span>Pickup day</span>
                <input
                  disabled={!editable}
                  max={pickableDays(str(row.timeZone, 60) || DEFAULT_TIME_ZONE).max}
                  min={pickableDays(str(row.timeZone, 60) || DEFAULT_TIME_ZONE).min}
                  onChange={(event) => setSchedule((current) => ({ ...current, date: event.target.value }))}
                  type="date"
                  value={schedule.date}
                />
              </label>
              <div aria-label="Pickup time" className="service-segments pkq-windows" role="radiogroup">
                {PICKUP_WINDOWS.map((window) => (
                  <button
                    aria-checked={schedule.window === window}
                    className={`segment${schedule.window === window ? " active" : ""}`}
                    disabled={!editable}
                    key={window}
                    onClick={() => setSchedule((current) => ({ ...current, window }))}
                    role="radio"
                    type="button"
                  >
                    {PICKUP_WINDOW_LABELS[window]}
                  </button>
                ))}
              </div>
              <small className="lst-hint">The customer sees this day and time on their estimate.</small>
            </div>
          )}
          <p className="pkq-total"><span>Estimated total</span> <strong data-no-translate>{total === null ? "—" : moneyText(total, l)}</strong></p>
          <label className="lst-field wide">
            <span>Note for the customer (optional)</span>
            <input disabled={!editable} maxLength={300} onChange={(event) => setNote(event.target.value)} value={note} />
          </label>
          {estimate && status === "confirmed" && <p className="lst-hint">The customer confirmed <span data-no-translate>{moneyText(Number(row.confirmedTotalCents) || 0, l)}</span>. A higher total asks them to confirm again; a lower one is only told.</p>}
          <HistoryList row={row} />
          {error && <div className="lst-form-error" role="alert">{error}</div>}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost danger" disabled={Boolean(busy)} onClick={() => setClosing(true)} type="button"><XCircle size={16} aria-hidden="true" /> {status === "confirmed" ? "Cancel request" : "Decline request"}</button>
          {status === "estimate_sent" && estimate && (
            <button className="lst-btn ghost" data-loading={busy === "phone"} disabled={Boolean(busy)} onClick={() => void agreedByPhone()} type="button"><Phone size={16} aria-hidden="true" /> Customer agreed by phone</button>
          )}
          <button className="lst-add" data-loading={busy === "send"} disabled={!editable || Boolean(busy)} onClick={() => void send()} type="button">
            {busy === "send" ? "Sending..." : "Send estimate on WhatsApp"}
          </button>
        </footer>
      </div>
      {closing && (
        <CloseRequestDialog businessId={businessId} kind={status === "confirmed" ? "cancel" : "decline"} onClose={() => setClosing(false)} onDone={(message) => { onFlash(message); onClose(); }} requestId={requestId} />
      )}
    </div>
  );
}

function CloseRequestDialog({ businessId, requestId, kind, onClose, onDone }: { businessId: string; requestId: string; kind: "decline" | "cancel"; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!reason.trim()) {
      setError(REQUEST_ERROR_MESSAGES.reason_required);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await callRequest(kind === "decline" ? "declinePackageRequest" : "cancelPackageRequest", { businessId, requestId, reason: reason.trim() });
      onDone(kind === "decline" ? "Request declined." : "Request cancelled.");
    } catch (err) {
      setError(requestFailure(err).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 480 }}>
        <header className="lst-modal-head">
          <div>
            <h3>{kind === "decline" ? "Decline request" : "Cancel request"}</h3>
            <p>The customer sees the reason on their estimate page. No WhatsApp is sent.</p>
          </div>
          <button aria-label="Close" className="lst-icon-btn" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          <label className="lst-field wide">
            <span>Reason</span>
            <input autoFocus maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="e.g. We no longer ship there" value={reason} />
          </label>
          {error && <div className="lst-form-error" role="alert">{error}</div>}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" disabled={busy} onClick={onClose} type="button">Back</button>
          <button className="lst-add danger" data-loading={busy} disabled={busy} onClick={() => void submit()} type="button">{busy ? "Saving..." : kind === "decline" ? "Decline request" : "Cancel request"}</button>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expected, in the Waiting list.
// ---------------------------------------------------------------------------

type ExpectedProps = {
  businessId: string;
  rows: FirestoreRow[];
  staffOptions: readonly { id: string; name: string }[];
  onFlash: (message: string) => void;
  enabled: boolean;
};

/**
 * The confirmed requests, above "In the shop": what customers said they will
 * bring (or the business will collect). "Received" turns one into a line.
 */
export function ExpectedRequestsSection({ businessId, rows, staffOptions, onFlash, enabled }: ExpectedProps) {
  const expected = useMemo(() => expectedRequests(rows), [rows]);
  const [receiving, setReceiving] = useState<Row | null>(null);
  const [cancelling, setCancelling] = useState("");
  const [labels, setLabels] = useState<Row | null>(null);
  // The labels dialog outlives the list: receiving the last expected
  // request empties it, and the labels for that package must still print.
  if (expected.length === 0) {
    return labels ? <ContainerLabelsDialog businessId={businessId} line={labels} lines={[labels]} onClose={() => setLabels(null)} /> : null;
  }
  return (
    <section className="pkq-expected">
      <h3><span>Expected</span> <b data-no-translate>· {expected.length}</b></h3>
      <div className="pkq-cards">
        {expected.map((row) => {
          const estimate = requestEstimate(row);
          const card = asRow(row.payment).timing === "card";
          const collect = str(row.handoff) === "collect";
          return (
            <div className="pkq-card expected" key={str(row.id)}>
              <RequestTitle row={row} />
              <PersonLines row={row} />
              <WhenLine row={row} />
              <span className="pkq-badges">
                {card && <span className="status-pill ok"><CreditCard aria-hidden="true" size={12} /> Paid online</span>}
                {str(row.confirmedVia) === "staff_phone" && <span className="status-pill muted">Customer agreed by phone</span>}
                {estimate && <span className="status-pill muted" data-no-translate>{moneyText(estimate.totalCents, lang())}</span>}
              </span>
              <span className="pkq-actions">
                <button className="lst-add" disabled={!enabled} onClick={() => setReceiving(row)} type="button">
                  <CheckCircle2 size={14} aria-hidden="true" />{" "}
                  {/* "Received" alone is a date label in the dictionary ("Reçu le"). */}
                  {collect ? "Picked up · Received" : <span data-no-translate>{lang() === "fr" ? "Reçu" : "Received"}</span>}
                </button>
                {!card && (
                  <button className="lst-btn ghost" disabled={!enabled} onClick={() => setCancelling(str(row.id))} type="button">Cancel</button>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <h3 className="pkq-in-shop">In the shop</h3>
      {receiving && (
        <ReceiveDialog
          businessId={businessId}
          onClose={() => setReceiving(null)}
          onReceived={(line) => {
            setReceiving(null);
            setLabels(line);
          }}
          onFlash={onFlash}
          row={receiving}
          staffOptions={staffOptions}
        />
      )}
      {cancelling && (
        <CloseRequestDialog businessId={businessId} kind="cancel" onClose={() => setCancelling("")} onDone={(message) => { onFlash(message); setCancelling(""); }} requestId={cancelling} />
      )}
      {labels && <ContainerLabelsDialog businessId={businessId} line={labels} lines={[labels]} onClose={() => setLabels(null)} />}
    </section>
  );
}

function ReceiveDialog({ businessId, row, staffOptions, onClose, onReceived, onFlash }: {
  businessId: string;
  row: Row;
  staffOptions: readonly { id: string; name: string }[];
  onClose: () => void;
  onReceived: (line: Row) => void;
  onFlash: (message: string) => void;
}) {
  const l = lang();
  const card = asRow(row.payment).timing === "card";
  // The load as it arrived: the request's pieces in phase 1's pieces editor
  // (the counter's), plus or minus what the customer actually brought.
  const [pieces, setPieces] = useState<PieceDraft[]>(() => receiveDraftsFrom(row));
  const [showErrors, setShowErrors] = useState(false);
  const [payOnArrival, setPayOnArrival] = useState(false);
  const [takeMoney, setTakeMoney] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<InvoicePaymentMethod>("cash");
  const [receivedBy, setReceivedBy] = useState(auth.currentUser?.uid ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const collect = str(row.handoff) === "collect";
  // A collected request's pickup fee: its own field beside the pieces,
  // prefilled from the estimate, inside the total (never in the prices).
  const [pickupFee, setPickupFee] = useState(() => (receiveTakesPickupFee(row) ? ledgerCentsToInput(receivePrefillPickupFeeCents(row)) : ""));

  async function receive() {
    const { pieces: payloadPieces, pickupFeeCents, error: problem } = receivePayload(pieces, receiveTakesPickupFee(row) ? pickupFee : null);
    if (problem) {
      setShowErrors(true);
      setError(REQUEST_ERROR_MESSAGES[problem] ?? CONTAINER_MESSAGES[problem as keyof typeof CONTAINER_MESSAGES] ?? REQUEST_ERROR_MESSAGES.price_invalid);
      return;
    }
    let payment: Record<string, unknown> | undefined;
    if (takeMoney && !card) {
      const cents = readDollars(amount);
      if (cents === null || cents <= 0) {
        setError(REQUEST_ERROR_MESSAGES.amount_required);
        return;
      }
      if (!receivedBy) {
        setError(REQUEST_ERROR_MESSAGES.received_by_required);
        return;
      }
      payment = { amountCents: cents, method, receivedByStaffId: receivedBy };
    }
    setBusy(true);
    setError("");
    try {
      const result = await callRequest<{ lineId: string; trackingCode: string; alreadyReceived: boolean }>("receivePackageRequest", {
        businessId,
        requestId: str(row.id),
        pieces: payloadPieces,
        ...(pickupFeeCents !== undefined ? { pickupFeeCents } : {}),
        payOnArrival,
        ...(payment ? { payment } : {}),
      });
      onFlash(receivedFlash(result.trackingCode, result.alreadyReceived, l));
      onReceived(receivedLineStub(result, payloadPieces, pickupFeeCents ?? null));
    } catch (err) {
      setError(requestFailure(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal pkq-modal" onClick={(event) => event.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>{collect ? "Picked up · Received" : <span data-no-translate>{l === "fr" ? "Reçu" : "Received"}</span>}</h3>
            <p>Confirm the final price of each piece. This registers the package and sends the received message on WhatsApp.</p>
          </div>
          <button aria-label="Close" className="lst-icon-btn" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          <div className="pkq-detail"><PersonLines row={row} /><WhenLine row={row} /></div>
          <PiecesEditor
            disabled={busy}
            id="pkq-receive-pieces"
            lang={l}
            onChange={setPieces}
            pieces={pieces}
            showErrors={showErrors}
            {...(collect ? { pickupFee, onPickupFeeChange: setPickupFee } : {})}
          />
          {card ? (
            <p className="lst-hint"><CreditCard size={14} aria-hidden="true" /> <span>Paid online by card</span> <span data-no-translate>{moneyText(Number(asRow(row.payment).paidCents) || 0, l)}</span></p>
          ) : (
            <>
              <label className="ctn-notify">
                <input checked={payOnArrival} onChange={(event) => setPayOnArrival(event.target.checked)} type="checkbox" />
                <span>Pay on arrival</span>
              </label>
              <label className="ctn-notify">
                <input checked={takeMoney} onChange={(event) => setTakeMoney(event.target.checked)} role="switch" type="checkbox" />
                <span>Money received now?</span>
              </label>
              {takeMoney && (
                <div className="lst-form-grid">
                  <label className="lst-field"><span>Amount ($)</span><input inputMode="decimal" onChange={(event) => setAmount(event.target.value)} placeholder={l === "fr" ? "0,00" : "0.00"} value={amount} /></label>
                  <label className="lst-field"><span>How it arrived</span>
                    <select onChange={(event) => setMethod(event.target.value as InvoicePaymentMethod)} value={method}>
                      {INVOICE_PAYMENT_METHODS.map((m) => (<option key={m} value={m}>{INVOICE_PAYMENT_METHOD_LABELS[m]}</option>))}
                    </select>
                  </label>
                  <label className="lst-field"><span>Received by</span>
                    <select onChange={(event) => setReceivedBy(event.target.value)} value={receivedBy}>
                      <option value="">Choose staff</option>
                      {staffOptions.map((s) => (<option data-no-translate key={s.id} value={s.id}>{s.name}</option>))}
                    </select>
                  </label>
                </div>
              )}
            </>
          )}
          {error && <div className="lst-form-error" role="alert">{error}</div>}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="lst-add" data-loading={busy} disabled={busy} onClick={() => void receive()} type="button">
            {busy ? "Saving..." : <><Tag size={16} aria-hidden="true" /> Received &amp; print labels</>}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Request settings (owner).
// ---------------------------------------------------------------------------

function RequestSettingsDialog({ businessId, business, officeLocations, onClose, onFlash }: {
  businessId: string;
  business: FirestoreRow | null;
  officeLocations: readonly unknown[];
  onClose: () => void;
  onFlash: (message: string) => void;
}) {
  const biz = asRow(business);
  const locations: SettingsLocation[] = useMemo(
    () => requestLocationsFor(officeLocations, business),
    [officeLocations, business],
  );
  const [draft, setDraft] = useState<RequestSettingsDraft>(() => requestSettingsDraft(business, locations));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [qr, setQr] = useState("");
  const [qrBusy, setQrBusy] = useState(false);
  const uid = auth.currentUser?.uid ?? "";
  // The server is the judge (owner or admin); a business with no ownerUid
  // stamped lets the save go and shows the server's refusal.
  const isOwner = Boolean(uid) && (!str(biz.ownerUid) || str(biz.ownerUid) === uid);
  const currentSlug = str(biz.requestSlug, 40);
  const canEditSlug = slugEditable(business);

  function setDay(locationId: string, day: WeekDay, patch: Partial<{ open: boolean; from: string; to: string }>) {
    setDraft((d) => ({
      ...d,
      hours: { ...d.hours, [locationId]: { ...d.hours[locationId], [day]: { ...d.hours[locationId][day], ...patch } } },
    }));
  }

  async function save() {
    const problems = requestSettingsProblems(draft);
    if (problems.length > 0) {
      setError(REQUEST_ERROR_MESSAGES[problems[0]]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await callRequest("setPackageRequestSettings", requestSettingsPayload(businessId, draft, currentSlug));
      onFlash("Request settings saved.");
      onClose();
    } catch (err) {
      setError(requestFailure(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadQr() {
    setQrBusy(true);
    setError("");
    try {
      const result = await callRequest<{ url: string; pngDataUrl: string }>("getPackageRequestLinkQr", { businessId });
      setQr(result.pngDataUrl);
      const link = document.createElement("a");
      link.href = result.pngDataUrl;
      link.download = `laawol-request-${currentSlug || "link"}.png`;
      link.click();
    } catch (err) {
      setError(requestFailure(err).message);
    } finally {
      setQrBusy(false);
    }
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal pkq-modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 760 }}>
        <header className="lst-modal-head">
          <div>
            <h3>Request settings</h3>
            <p>How customers ask you to take a package.</p>
          </div>
          <button aria-label="Close" className="lst-icon-btn" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {!isOwner && <p className="pkq-banner" role="status">Only the business owner can change these settings.</p>}
          <label className="ctn-notify">
            <input checked={draft.acceptRequests} disabled={!isOwner} onChange={(event) => setDraft((d) => ({ ...d, acceptRequests: event.target.checked }))} role="switch" type="checkbox" />
            <span>Accept package requests</span>
          </label>
          <small className="lst-hint">Turning this off stops new requests. Open requests continue.</small>

          <section className="pkq-settings-block">
            <h4>Request link</h4>
            {currentSlug ? (
              <p className="pkq-link">
                <code data-no-translate>{requestLink(currentSlug)}</code>
                <CopyValue label="Copy" value={requestLink(currentSlug)} />
                <button className="lst-btn ghost" data-loading={qrBusy} disabled={qrBusy} onClick={() => void downloadQr()} type="button"><Download size={14} aria-hidden="true" /> QR code</button>
              </p>
            ) : (
              <p className="lst-hint">Your link is made from your business name when you first save.</p>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr && <img alt="QR code of the request link" className="pkq-qr" src={qr} />}
            {isOwner && canEditSlug && (
              <label className="lst-field">
                <span>{currentSlug ? "Change the link (once)" : "Link name (optional)"}</span>
                <input data-no-translate maxLength={40} onChange={(event) => setDraft((d) => ({ ...d, slug: event.target.value.toLowerCase() }))} placeholder="your-business" value={draft.slug} />
              </label>
            )}
          </section>

          <section className="pkq-settings-block">
            <h4>Opening hours</h4>
            <small className="lst-hint">Customers who bring goods in plan a day you are open. A location without hours is not offered.</small>
            {locations.length === 0 && <p className="lst-hint">Add your business address or an office location first.</p>}
            {locations.map((location) => (
              <div className="pkq-hours" key={location.id}>
                <p><MapPin size={14} aria-hidden="true" /> <strong data-no-translate>{location.label}</strong> <small data-no-translate>{location.address}</small></p>
                {WEEK_DAYS.map((day) => {
                  const value = draft.hours[location.id]?.[day] ?? { open: false, from: "09:00", to: "18:00" };
                  return (
                    <div className="pkq-hours-row" key={day}>
                      <label className="ctn-notify">
                        <input checked={value.open} disabled={!isOwner} onChange={(event) => setDay(location.id, day, { open: event.target.checked })} type="checkbox" />
                        <span>{DAY_LABELS[day]}</span>
                      </label>
                      {value.open ? (
                        <>
                          <input aria-label="Opens" disabled={!isOwner} onChange={(event) => setDay(location.id, day, { from: event.target.value })} type="time" value={value.from} />
                          <span aria-hidden="true">–</span>
                          <input aria-label="Closes" disabled={!isOwner} onChange={(event) => setDay(location.id, day, { to: event.target.value })} type="time" value={value.to} />
                        </>
                      ) : (
                        <small className="pkq-muted">Closed</small>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </section>

          <section className="pkq-settings-block">
            <h4>Collect from me</h4>
            <label className="ctn-notify">
              <input checked={draft.pickupEnabled} disabled={!isOwner} onChange={(event) => setDraft((d) => ({ ...d, pickupEnabled: event.target.checked }))} role="switch" type="checkbox" />
              <span>We pick up</span>
            </label>
            {draft.pickupEnabled && (
              <label className="lst-field wide">
                <span>Areas you cover</span>
                <input disabled={!isOwner} maxLength={300} onChange={(event) => setDraft((d) => ({ ...d, pickupAreas: event.target.value }))} placeholder="e.g. Bronx, Harlem, Newark" value={draft.pickupAreas} />
              </label>
            )}
          </section>

          <section className="pkq-settings-block">
            <h4>Card payment for barrels</h4>
            <label className="ctn-notify">
              <input checked={draft.cardBarrelBooking} disabled={!isOwner} onChange={(event) => setDraft((d) => ({ ...d, cardBarrelBooking: event.target.checked }))} role="switch" type="checkbox" />
              <span>Let customers pay barrels by card when they book</span>
            </label>
            <small className="lst-hint">Paid orders arrive in the Waiting list as Expected — paid online.</small>
          </section>
          {error && <div className="lst-form-error" role="alert">{error}</div>}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" disabled={busy} onClick={onClose} type="button">Close</button>
          {isOwner && (
            <button className="lst-add" data-loading={busy} disabled={busy} onClick={() => void save()} type="button">{busy ? "Saving..." : "Save settings"}</button>
          )}
        </footer>
      </div>
    </div>
  );
}
