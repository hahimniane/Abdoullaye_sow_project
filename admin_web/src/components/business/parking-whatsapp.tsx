"use client";

import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Check, CheckCheck, Clock, MessageCircle, Minus, Pause, RefreshCw, X, XCircle } from "lucide-react";

import { db, functions } from "@/lib/firebase";
import { currentLanguage, formatDateTime } from "@/lib/format";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import {
  PARKING_WELCOME_SEND_TIMEOUT_MS,
  PARKING_WHATSAPP_COPY as COPY,
  PARKING_WHATSAPP_TIMEOUT_MS,
  defaultWelcomeSelection,
  parkingMessageLines,
  parkingWhatsAppEnabled,
  parkingWhatsAppRefusalText,
  parseWelcomePreview,
  parseWelcomeResult,
  selectAllWelcome,
  setParkingWhatsAppRequest,
  toggleWelcomePhone,
  welcomePreviewRequest,
  welcomeResultText,
  welcomeSelectionText,
  welcomeSendRequest,
  welcomeSendText,
  type ParkingMessageLine,
  type WelcomeRecipient,
  type WelcomeResult,
} from "@/lib/parking-whatsapp";

type Row = Record<string, unknown>;

const lang = () => (currentLanguage() === "fr" ? "fr" : "en");

function parkingEntryCall(timeout: number) {
  return httpsCallable(functions, "updateBusinessParkingEntry", { timeout });
}

/**
 * Business settings, parking: "Send WhatsApp messages to parking customers".
 * Off by default; the owner (or a platform admin) turns it on. It saves at
 * once, on its own - it is not part of the services form's draft - and the
 * business document (live) carries the answer back.
 */
export function ParkingWhatsAppSwitch({
  businessId,
  business,
  canChange,
}: {
  businessId: string;
  business?: Row | null;
  canChange: boolean;
}) {
  const enabled = parkingWhatsAppEnabled(business);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function change(next: boolean) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await parkingEntryCall(PARKING_WHATSAPP_TIMEOUT_MS)(setParkingWhatsAppRequest(businessId, next));
      setSaved(true);
    } catch (failure) {
      setError(parkingWhatsAppRefusalText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wide pk-whatsapp-switch">
      <label className="customer-choice-row">
        <input
          checked={enabled}
          disabled={!canChange || busy || !businessId}
          onChange={() => void change(!enabled)}
          type="checkbox"
        />
        <span>
          <strong>{COPY.switchTitle}</strong>
          <small>{COPY.switchHint}</small>
        </span>
      </label>
      {!canChange && <p className="lst-hint">{COPY.ownerOnly}</p>}
      {busy && <p className="lst-hint" role="status"><RefreshCw className="spin" size={12} aria-hidden="true" /> {COPY.saving}</p>}
      {saved && !busy && !error && <p className="lst-hint" role="status">{COPY.saved}</p>}
      {error && <div className="lst-form-error" role="alert">{error}</div>}
    </div>
  );
}

/**
 * Parking panel: the one-time welcome to everyone parked now. The preview
 * lists each phone number once with its cars; numbers already welcomed are
 * muted and unticked. Every wait ends: the callable has a timeout, and an
 * error leaves the dialog usable with a Try again.
 */
export function ParkingWelcomeDialog({
  businessId,
  onClose,
}: {
  businessId: string;
  onClose: () => void;
}) {
  const language = lang();
  const [recipients, setRecipients] = useState<WelcomeRecipient[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<WelcomeResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setRecipients(null);
    setLoadError("");
    parkingEntryCall(PARKING_WHATSAPP_TIMEOUT_MS)(welcomePreviewRequest(businessId))
      .then((answer) => {
        if (!active) return;
        const list = parseWelcomePreview(answer.data);
        setRecipients(list);
        setSelected(defaultWelcomeSelection(list));
      })
      .catch((failure) => {
        if (active) setLoadError(parkingWhatsAppRefusalText(failure));
      });
    return () => {
      active = false;
    };
  }, [businessId, attempt]);

  const close = () => {
    if (!sending) onClose();
  };

  async function send() {
    if (selected.length === 0 || sending) return;
    setSending(true);
    setSendError("");
    try {
      const answer = await parkingEntryCall(PARKING_WELCOME_SEND_TIMEOUT_MS)(welcomeSendRequest(businessId, selected));
      setResult(parseWelcomeResult(answer.data));
    } catch (failure) {
      setSendError(parkingWhatsAppRefusalText(failure));
    } finally {
      setSending(false);
    }
  }

  const loading = recipients === null && !loadError;
  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(close)}>
      <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>{COPY.welcomeButton}</h3>
            {!result && <p>{COPY.welcomeLede}</p>}
          </div>
          <button className="lst-icon-btn" type="button" disabled={sending} onClick={close} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {loading && <p className="panel-lede" role="status">{COPY.welcomeLoading}</p>}
          {loadError && (
            <div className="lst-form-error" role="alert">
              {loadError}{" "}
              <button className="lst-btn ghost" type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
            </div>
          )}
          {sendError && <div className="lst-form-error" role="alert">{sendError}</div>}
          {result && (
            <div className="pk-welcome-result" role="status">
              <strong data-no-translate>{welcomeResultText(result, language)}</strong>
            </div>
          )}
          {!result && recipients && recipients.length === 0 && <p className="panel-lede">{COPY.welcomeEmpty}</p>}
          {!result && recipients && recipients.length > 0 && (
            <>
              <div className="pk-welcome-bar">
                <small data-no-translate>{welcomeSelectionText(selected.length, recipients.length, language)}</small>
                <button className="lst-btn ghost" type="button" disabled={sending} onClick={() => setSelected(selectAllWelcome(recipients))}>{COPY.selectAll}</button>
                <button className="lst-btn ghost" type="button" disabled={sending} onClick={() => setSelected([])}>{COPY.selectNone}</button>
              </div>
              <ul className="pk-welcome-list">
                {recipients.map((person) => {
                  const checked = selected.includes(person.phone);
                  return (
                    <li className={person.alreadyWelcomed ? "muted" : undefined} key={person.phone}>
                      <label className="customer-choice-row">
                        <input
                          checked={checked}
                          disabled={sending}
                          onChange={() => setSelected((current) => toggleWelcomePhone(current, person.phone))}
                          type="checkbox"
                        />
                        <span>
                          <strong data-no-translate>{person.name || person.phone}</strong>
                          <small data-no-translate>{person.name ? person.phone : ""}</small>
                          <small data-no-translate>{person.cars.map((car) => car.label).filter(Boolean).join(", ")}</small>
                          {person.alreadyWelcomed && <small className="muted">{COPY.alreadyWelcomed}</small>}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        <footer className="lst-modal-foot">
          {result ? (
            <button className="lst-add" type="button" onClick={onClose}>{COPY.done}</button>
          ) : (
            <>
              <button className="lst-btn ghost" type="button" disabled={sending} onClick={close}>Cancel</button>
              <button
                className="lst-add"
                type="button"
                disabled={sending || selected.length === 0 || !recipients}
                aria-busy={sending}
                onClick={() => void send()}
              >
                {sending ? <RefreshCw className="spin" size={14} /> : <MessageCircle size={14} />}
                <span data-no-translate>{sending ? (language === "fr" ? "Envoi…" : "Sending…") : welcomeSendText(selected.length, language)}</span>
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function Tick({ tick }: { tick: ParkingMessageLine["tick"] }) {
  const props = { "aria-hidden": true, size: 14 } as const;
  if (tick === "cross") return <XCircle {...props} />;
  if (tick === "double" || tick === "double-read") return <CheckCheck {...props} />;
  if (tick === "single") return <Check {...props} />;
  if (tick === "pause") return <Pause {...props} />;
  if (tick === "dash") return <Minus {...props} />;
  return <Clock {...props} />;
}

/** How long a car's messages may load before the list says it could not (loading always resolves). */
const MESSAGES_LOAD_TIMEOUT_MS = 15_000;

/**
 * The WhatsApp messages sent for one parked car (parkingMessages where
 * parkedCarId ==): what kind, when, and its tick. Opened on demand, so a lot
 * with thirty cars holds no thirty listeners; the business id rides in the
 * query because the rules read it from the document.
 */
export function ParkingCarMessages({
  businessId,
  parkedCarId,
}: {
  businessId: string;
  parkedCarId: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const settled = useRef(false);

  useEffect(() => {
    if (!open || !businessId || !parkedCarId) return undefined;
    settled.current = false;
    setLoading(true);
    setError(false);
    const giveUp = setTimeout(() => {
      if (!settled.current) {
        setError(true);
        setLoading(false);
      }
    }, MESSAGES_LOAD_TIMEOUT_MS);
    const unsubscribe = onSnapshot(
      query(
        collection(db, "parkingMessages"),
        where("businessId", "==", businessId),
        where("parkedCarId", "==", parkedCarId),
      ),
      (snapshot) => {
        settled.current = true;
        setRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        setError(false);
        setLoading(false);
      },
      () => {
        settled.current = true;
        setError(true);
        setLoading(false);
      },
    );
    return () => {
      clearTimeout(giveUp);
      unsubscribe();
    };
  }, [open, businessId, parkedCarId]);

  const lines = parkingMessageLines(rows);
  return (
    <div className="pk-wa-messages">
      <button
        aria-expanded={open}
        className="lst-btn ghost"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <MessageCircle size={14} /> {COPY.messagesTitle}
      </button>
      {open && (
        <div className="pk-wa-list">
          {loading && <p className="lst-hint" role="status">{COPY.messagesLoading}</p>}
          {error && <p className="lst-form-error" role="alert">{COPY.messagesError}</p>}
          {!loading && !error && lines.length === 0 && <p className="lst-hint">{COPY.messagesEmpty}</p>}
          {lines.length > 0 && (
            <ul>
              {lines.map((line) => (
                <li className={`pk-wa-line state-${line.state}`} key={line.id}>
                  <span className="pk-wa-kind">{line.kindLabel}</span>
                  <small className="pk-wa-date" data-no-translate>{line.atMs > 0 ? formatDateTime(line.atMs) : ""}</small>
                  <span className="pk-wa-state" data-tick={line.tick}>
                    <Tick tick={line.tick} /> {line.stateLabel}
                  </span>
                  {line.error && <small className="pk-wa-error" data-no-translate>{line.error}</small>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
