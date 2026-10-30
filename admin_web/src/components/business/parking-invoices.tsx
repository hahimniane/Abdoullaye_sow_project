"use client";

import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { MessageCircle, RefreshCw } from "lucide-react";

import { Tick } from "@/components/business/parking-whatsapp";
import { db, functions } from "@/lib/firebase";
import { currentLanguage, formatDate } from "@/lib/format";
import {
  PARKING_INVOICES_COPY as COPY,
  PARKING_INVOICES_PREVIEW_TIMEOUT_MS,
  PARKING_INVOICES_SEND_TIMEOUT_MS,
  PARKING_INVOICE_MESSAGES_TIMEOUT_MS,
  PAYMENT_INSTRUCTIONS_MAX,
  defaultInvoiceSelection,
  invoiceMessagesByCustomer,
  invoiceResultText,
  invoiceRunText,
  invoiceSelectionText,
  invoiceSendText,
  invoicesPreviewRequest,
  invoicesSendRequest,
  parkingInvoiceRefusalText,
  parseInvoicePreview,
  parseInvoiceResult,
  paymentInstructionsCanSave,
  paymentInstructionsOf,
  selectAllInvoices,
  setPaymentInstructionsRequest,
  type InvoicePreview,
  type InvoiceResult,
} from "@/lib/parking-invoices";
import { moneyText } from "@/lib/parking-month-statement";
import { toggleWelcomePhone, type ParkingMessageLine } from "@/lib/parking-whatsapp";

type Row = Record<string, unknown>;

const lang = () => (currentLanguage() === "fr" ? "fr" : "en");

function parkingEntryCall(timeout: number) {
  return httpsCallable(functions, "updateBusinessParkingEntry", { timeout });
}

/**
 * Business settings, parking, next to the WhatsApp switch: the line printed
 * under "Balance due" on every monthly invoice (how to pay). Saves on its own
 * through updateBusinessParkingEntry, not with the services form's draft; the
 * business document (live) carries the saved text back. Owner or platform admin.
 */
export function PaymentInstructionsField({
  businessId,
  business,
  canChange,
}: {
  businessId: string;
  business?: Row | null;
  canChange: boolean;
}) {
  const saved = paymentInstructionsOf(business);
  const [draft, setDraft] = useState(saved);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // The saved text arrives live: follow it until the owner starts typing.
  useEffect(() => {
    if (!dirty) setDraft(saved);
  }, [saved, dirty]);

  async function save() {
    setBusy(true);
    setError("");
    setDone(false);
    try {
      await parkingEntryCall(30_000)(setPaymentInstructionsRequest(businessId, draft));
      setDirty(false);
      setDone(true);
    } catch (failure) {
      setError(parkingInvoiceRefusalText(failure));
    } finally {
      setBusy(false);
    }
  }

  const canSave = canChange && !busy && Boolean(businessId) && paymentInstructionsCanSave(draft, saved);
  return (
    <div className="wide pk-payment-instructions">
      <label className="lst-field wide">
        <span>{COPY.paymentTitle}</span>
        <textarea
          disabled={!canChange || busy || !businessId}
          maxLength={PAYMENT_INSTRUCTIONS_MAX}
          onChange={(event) => {
            setDraft(event.target.value);
            setDirty(true);
            setDone(false);
          }}
          placeholder="Pay at the office, or Zelle …"
          rows={3}
          value={draft}
        />
      </label>
      <small className="lst-hint">{COPY.paymentHint}</small>
      {!canChange && <p className="lst-hint">Only the business owner can change this.</p>}
      {canChange && (
        <div className="pk-payment-actions">
          <button className="lst-btn ghost" type="button" disabled={!canSave} aria-busy={busy} onClick={() => void save()}>
            {busy && <RefreshCw className="spin" size={14} aria-hidden="true" />} {COPY.paymentSave}
          </button>
          <small className="lst-hint" data-no-translate>{draft.trim().length} / {PAYMENT_INSTRUCTIONS_MAX}</small>
          {done && !busy && !error && <small className="lst-hint" role="status">Saved.</small>}
        </div>
      )}
      {error && <div className="lst-form-error" role="alert">{error}</div>}
    </div>
  );
}

/**
 * The month's invoice messages (parkingMessages where businessId == and
 * kind == "invoice" and monthKey ==: equalities only, no composite index),
 * keyed by the month-end customer key. Read by the business's managers; a
 * member who cannot read them simply sees no status. Loading always ends: an
 * error and a silent listener both stop waiting.
 */
export function useParkingInvoiceMessages(businessId: string, monthKey: string, enabled: boolean) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const settled = useRef(false);

  useEffect(() => {
    setRows([]);
    if (!enabled || !businessId || !monthKey) return undefined;
    settled.current = false;
    setLoading(true);
    const giveUp = setTimeout(() => {
      if (!settled.current) setLoading(false);
    }, PARKING_INVOICE_MESSAGES_TIMEOUT_MS);
    const unsubscribe = onSnapshot(
      query(
        collection(db, "parkingMessages"),
        where("businessId", "==", businessId),
        where("kind", "==", "invoice"),
        where("monthKey", "==", monthKey),
      ),
      (snapshot) => {
        settled.current = true;
        setRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        setLoading(false);
      },
      () => {
        settled.current = true;
        setRows([]);
        setLoading(false);
      },
    );
    return () => {
      clearTimeout(giveUp);
      unsubscribe();
    };
  }, [enabled, businessId, monthKey]);

  return { byCustomer: invoiceMessagesByCustomer(rows, monthKey), loading };
}

/** One customer card's invoice line: "Monthly invoice" and its tick. */
export function InvoiceMessageStatus({ line }: { line: ParkingMessageLine }) {
  return (
    <span className={`pk-wa-line state-${line.state} pk-invoice-status`}>
      <span className="pk-wa-kind">{COPY.invoiceMessage}</span>
      <span className="pk-wa-state" data-tick={line.tick}>
        <Tick tick={line.tick} /> <span>{line.stateLabel}</span>
      </span>
      {line.error && <small className="pk-wa-error" data-no-translate>{line.error}</small>}
    </span>
  );
}

/**
 * Month end, "Send invoices": the owner's review before the 3rd. The preview
 * lists each phone number once with its cars and balance; numbers already
 * sent are muted and unticked. Every wait ends: both calls carry a timeout
 * and an error leaves the panel usable with a Retry.
 */
export function ParkingInvoicesPanel({
  businessId,
  monthKey,
  staffNames,
}: {
  businessId: string;
  monthKey: string;
  /** User id to name, for "sent by". */
  staffNames: Readonly<Record<string, string>>;
}) {
  const language = lang();
  const [preview, setPreview] = useState<InvoicePreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<InvoiceResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadError("");
    parkingEntryCall(PARKING_INVOICES_PREVIEW_TIMEOUT_MS)(invoicesPreviewRequest(businessId, monthKey))
      .then((answer) => {
        if (!active) return;
        const parsed = parseInvoicePreview(answer.data);
        setPreview(parsed);
        setSelected(defaultInvoiceSelection(parsed.recipients));
      })
      .catch((failure) => {
        if (active) setLoadError(parkingInvoiceRefusalText(failure));
      });
    return () => {
      active = false;
    };
  }, [businessId, monthKey, attempt]);

  async function send() {
    if (selected.length === 0 || sending) return;
    setSending(true);
    setConfirming(false);
    setSendError("");
    try {
      const answer = await parkingEntryCall(PARKING_INVOICES_SEND_TIMEOUT_MS)(invoicesSendRequest(businessId, monthKey, selected));
      setResult(parseInvoiceResult(answer.data));
      // The list and the run line move on to what the server now says.
      setAttempt((n) => n + 1);
    } catch (failure) {
      setSendError(parkingInvoiceRefusalText(failure));
    } finally {
      setSending(false);
    }
  }

  const recipients = preview?.recipients ?? [];
  const run = preview?.run ?? null;
  const loading = preview === null && !loadError;
  const runBusy = run?.status === "sending";
  const sentOn = run && run.sentAtMs > 0 ? formatDate(run.sentAtMs) : "";
  return (
    <section className="pk-invoices" aria-label="Send invoices">
      <header className="pk-invoices-head">
        <div>
          <h3>{COPY.invoicesTitle}</h3>
          <p className="panel-lede">{COPY.invoicesLede}</p>
        </div>
        <button className="lst-btn ghost" type="button" disabled={sending || loading} onClick={() => setAttempt((n) => n + 1)}>
          <RefreshCw className={loading ? "spin" : undefined} size={14} aria-hidden="true" /> {COPY.refresh}
        </button>
      </header>
      {loading && <p className="lst-hint" role="status">{COPY.loading}</p>}
      {loadError && (
        <div className="lst-form-error" role="alert">
          {loadError}{" "}
          <button className="lst-btn ghost" type="button" onClick={() => setAttempt((n) => n + 1)}>{COPY.retry}</button>
        </div>
      )}
      {preview && (run && (run.status === "ready" || run.status === "sent") ? (
        // Built here in the language on screen, with numbers, a date and a name.
        <p className="pk-invoices-run" role="status" data-no-translate>{invoiceRunText(run, { lang: language, sentOn, staffNames })}</p>
      ) : (
        <p className="pk-invoices-run" role="status">{run ? COPY.runSending : COPY.runNone}</p>
      ))}
      {sendError && <div className="lst-form-error" role="alert">{sendError}</div>}
      {result && (
        <div className="pk-welcome-result" role="status">
          <strong data-no-translate>{invoiceResultText(result, language)}</strong>
          {result.remaining > 0 && <small className="lst-hint">{COPY.remainingHint}</small>}
        </div>
      )}
      {preview && recipients.length === 0 && <p className="panel-lede">{COPY.empty}</p>}
      {recipients.length > 0 && (
        <>
          <div className="pk-welcome-bar">
            <small data-no-translate>{invoiceSelectionText(selected.length, recipients.length, language)}</small>
            <button className="lst-btn ghost" type="button" disabled={sending} onClick={() => setSelected(selectAllInvoices(recipients))}>{COPY.selectAll}</button>
            <button className="lst-btn ghost" type="button" disabled={sending} onClick={() => setSelected([])}>{COPY.selectNone}</button>
          </div>
          <ul className="pk-welcome-list pk-invoices-list">
            {recipients.map((person) => (
              <li className={person.alreadySent ? "muted" : undefined} key={person.phone}>
                <label className="customer-choice-row">
                  <input
                    checked={selected.includes(person.phone)}
                    disabled={sending}
                    onChange={() => setSelected((current) => toggleWelcomePhone(current, person.phone))}
                    type="checkbox"
                  />
                  <span>
                    <strong data-no-translate>{person.name || person.phone}</strong>
                    <small data-no-translate>{person.name ? person.phone : ""}</small>
                    <small data-no-translate>{person.cars.map((car) => car.label).filter(Boolean).join(", ")}</small>
                    {person.stillParked && <small>{COPY.stillParked}</small>}
                    {person.alreadySent && <small className="muted">{COPY.alreadySent}</small>}
                  </span>
                  <strong className="pk-invoices-due" data-no-translate>{moneyText(person.totalDueCents)}</strong>
                </label>
              </li>
            ))}
          </ul>
          {confirming ? (
            <div className="pk-invoices-confirm" role="alertdialog" aria-label="Send invoices">
              <p>{COPY.confirmText}</p>
              <button className="lst-btn ghost" type="button" onClick={() => setConfirming(false)}>{COPY.cancel}</button>
              <button className="lst-add" type="button" onClick={() => void send()}>
                <MessageCircle size={14} /> {COPY.confirmYes}
              </button>
            </div>
          ) : (
            <div className="pk-invoices-actions">
              <button
                className="lst-add"
                type="button"
                disabled={sending || runBusy || selected.length === 0}
                aria-busy={sending}
                onClick={() => setConfirming(true)}
              >
                {sending ? <RefreshCw className="spin" size={14} /> : <MessageCircle size={14} />}
                <span data-no-translate>{sending ? (language === "fr" ? "Envoi…" : "Sending…") : invoiceSendText(selected.length, language)}</span>
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
