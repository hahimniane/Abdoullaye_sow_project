"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Banknote, ChevronDown, RefreshCw, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import { currentLanguage, formatDateTime, formatDayKey } from "@/lib/format";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import { requestFailure } from "@/lib/package-requests";
import {
  PAYOUT_MESSAGES,
  PAYOUT_METHODS,
  dueWeeks,
  ledgerLabel,
  methodLabel,
  money,
  paidOutWord,
  payoutDay,
  payoutPaidPayload,
  payoutProblems,
  payoutWeeksOf,
  payoutsPayload,
  type PayoutWeek,
} from "@/lib/pay-now";
import { moneyText } from "@/lib/invoice-ledger";

type Lang = "en" | "fr";
const READ_TIMEOUT_MS = 20_000;

function lang(): Lang {
  return currentLanguage() === "fr" ? "fr" : "en";
}

async function callSettings(data: Record<string, unknown>): Promise<unknown> {
  const response = await httpsCallable<Record<string, unknown>, unknown>(functions, "setPackageRequestSettings")(data);
  return response.data;
}

type Read = { weeks: PayoutWeek[]; unpaidBillCents: number; loading: boolean; error: string; refresh: () => void };

/** The payouts read: always resolves (answer, refusal, or silence past 20 seconds). */
function usePayouts(businessId: string | undefined, enabled: boolean): Read {
  const [state, setState] = useState<{ weeks: PayoutWeek[]; unpaidBillCents: number; loading: boolean; error: string }>({ weeks: [], unpaidBillCents: 0, loading: enabled, error: "" });
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let settled = false;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setState((prev) => ({ ...prev, loading: false, error: "Payouts are taking longer than usual. Try again in a moment." }));
    }, READ_TIMEOUT_MS);
    callSettings(payoutsPayload(businessId))
      .then((data) => {
        if (settled) return;
        settled = true;
        setState({ ...payoutWeeksOf(data), loading: false, error: "" });
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        const failure = requestFailure(err);
        // Not allowed to see them (staff): nothing to show, and no error either.
        setState({ weeks: [], unpaidBillCents: 0, loading: false, error: failure.reason === "not_allowed" || /permission/.test(String((err as { code?: string })?.code)) ? "" : "Payouts could not be loaded. Try again." });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      settled = true;
      window.clearTimeout(timer);
    };
  }, [businessId, enabled, again]);
  return { ...state, refresh: () => setAgain((n) => n + 1) };
}

function WeekLines({ week, l }: { week: PayoutWeek; l: Lang }) {
  if (week.lines.length === 0) return null;
  return (
    <ul className="pn-lines">
      {week.lines.map((line) => (
        <li key={line.id}>
          <span>
            <span data-no-translate>{ledgerLabel(line.type, l)}</span>
            {line.requestCode && <small data-no-translate>{line.requestCode}</small>}
            {line.note && <small data-no-translate>{line.note}</small>}
          </span>
          <span className={line.amountCents < 0 ? "pn-neg" : ""} data-no-translate>{moneyText(line.amountCents, l)}</span>
          {line.atMs > 0 && <small data-no-translate>{formatDateTime(line.atMs)}</small>}
        </li>
      ))}
    </ul>
  );
}

function StatusText({ week, l }: { week: PayoutWeek; l: Lang }) {
  if (week.status === "paid") {
    return (
      <small className="pn-status paid" data-no-translate>
        {[paidOutWord(l), week.paidAtMs ? formatDateTime(week.paidAtMs) : "", week.method ? methodLabel(week.method, l) : "", week.reference].filter(Boolean).join(" · ")}
      </small>
    );
  }
  if (week.status === "nothing") return <small className="pn-status"><span>Nothing to pay this week</span></small>;
  if (week.status === "due") {
    return (
      <small className="pn-status due">
        {week.netCents < 0 ? <span>Goes onto the Laawol bill</span> : <><span>Paid out on</span> <span data-no-translate>{formatDayKey(payoutDay(week.weekKey), l)}</span></>}
      </small>
    );
  }
  return (
    <small className="pn-status">
      <span>Still collecting. Paid out on</span> <span data-no-translate>{formatDayKey(payoutDay(week.weekKey), l)}</span>
    </small>
  );
}

/**
 * The business's Bills: "Laawol owes you" - the weeks when Laawol collected
 * card payments for it (no Stripe of its own), with every line (payment, card
 * fee, refund, chargeback, the Laawol bill taken off) and the payout. Hidden
 * when there is nothing to show.
 */
export function LaawolOwesYou({ businessId, previewMode = false }: { businessId: string; previewMode?: boolean }) {
  const l = lang();
  const read = usePayouts(businessId, Boolean(businessId) && !previewMode);
  const [open, setOpen] = useState<string>("");
  const owed = useMemo(() => read.weeks.filter((w) => w.status === "open" || w.status === "due").reduce((sum, w) => sum + w.netCents, 0), [read.weeks]);
  if (previewMode || (!read.loading && !read.error && read.weeks.length === 0)) return null;
  return (
    <section className="panel pn-card">
      <div className="panel-header">
        <div><Banknote size={18} aria-hidden="true" /><h2>Laawol owes you</h2></div>
        <span className="panel-action">
          <button aria-label="Refresh" className="lst-icon-btn" disabled={read.loading} onClick={read.refresh} title="Refresh" type="button"><RefreshCw className={read.loading ? "spin" : ""} size={14} aria-hidden="true" /></button>
        </span>
      </div>
      <p className="panel-lede">Card payments Laawol collected for you, paid out by Zelle or bank every Monday for the week before (Monday to Sunday, New York time). Card fees, refunds and chargebacks are taken off.</p>
      {read.error && <div className="lst-form-error" role="alert">{read.error}</div>}
      {read.loading && read.weeks.length === 0 ? (
        <div className="empty-state"><RefreshCw className="spin" size={16} aria-hidden="true" /> Loading…</div>
      ) : (
        <>
          <p className="pn-total"><span>Owed to you now</span> <strong data-no-translate>{money(Math.max(0, owed), l)}</strong></p>
          {read.unpaidBillCents > 0 && (
            <p className="pn-note"><span>Your unpaid Laawol bill of</span> <b data-no-translate>{money(read.unpaidBillCents, l)}</b> <span>is taken out of the next payout.</span></p>
          )}
          <ul className="pn-weeks">
            {read.weeks.map((week) => {
              const key = `${week.businessId}-${week.weekKey}`;
              const expanded = open === key;
              return (
                <li key={key}>
                  <button aria-expanded={expanded} className="pn-week" onClick={() => setOpen(expanded ? "" : key)} type="button">
                    <span>
                      <strong><span>Week of</span> <span data-no-translate>{formatDayKey(week.weekKey, l)}</span></strong>
                      <StatusText l={l} week={week} />
                    </span>
                    <strong className={week.netCents < 0 ? "pn-neg" : ""} data-no-translate>{moneyText(week.netCents, l)}</strong>
                    <ChevronDown aria-hidden="true" className={expanded ? "open" : ""} size={16} />
                  </button>
                  {expanded && <WeekLines l={l} week={week} />}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * The Laawol admin's Bills: "Pay now payouts" - the weeks that are due, per
 * business, each with Paid out (how you paid and the Zelle / bank reference).
 * A business's receipt goes to it on WhatsApp.
 */
export function PayNowPayoutsAdmin({ previewMode = false, canPayOut = true }: { previewMode?: boolean; canPayOut?: boolean }) {
  const l = lang();
  const read = usePayouts(undefined, !previewMode);
  const [paying, setPaying] = useState<PayoutWeek | null>(null);
  const [flash, setFlash] = useState("");
  const due = useMemo(() => dueWeeks(read.weeks), [read.weeks]);
  const recent = useMemo(() => read.weeks.filter((w) => w.status === "paid").slice(0, 10), [read.weeks]);
  if (previewMode || (!read.loading && !read.error && read.weeks.length === 0)) return null;
  const total = due.reduce((sum, w) => sum + Math.max(0, w.netCents), 0);
  return (
    <section className="panel pn-card">
      <div className="panel-header">
        <div><Banknote size={18} aria-hidden="true" /><h2>Pay now payouts</h2></div>
        <span className="panel-action">
          <button aria-label="Refresh" className="lst-icon-btn" disabled={read.loading} onClick={read.refresh} title="Refresh" type="button"><RefreshCw className={read.loading ? "spin" : ""} size={14} aria-hidden="true" /></button>
        </span>
      </div>
      <p className="panel-lede">Card payments Laawol collected for businesses without their own Stripe. Send each business what is due by Zelle or bank, then tap Paid out.</p>
      {flash && <p className="pkq-banner" role="status">{flash}</p>}
      {read.error && <div className="lst-form-error" role="alert">{read.error}</div>}
      {read.loading && read.weeks.length === 0 ? (
        <div className="empty-state"><RefreshCw className="spin" size={16} aria-hidden="true" /> Loading…</div>
      ) : due.length === 0 ? (
        <div className="empty-state">No payout is due.</div>
      ) : (
        <>
          <p className="pn-total"><span>Due to businesses</span> <strong data-no-translate>{money(total, l)}</strong></p>
          <ul className="pn-weeks">
            {due.map((week) => (
              <li key={`${week.businessId}-${week.weekKey}`}>
                <div className="pn-week static">
                  <span>
                    <strong data-no-translate>{week.businessName || week.businessId}</strong>
                    <small><span>Week of</span> <span data-no-translate>{formatDayKey(week.weekKey, l)}</span></small>
                    <StatusText l={l} week={week} />
                  </span>
                  <strong className={week.netCents < 0 ? "pn-neg" : ""} data-no-translate>{moneyText(week.netCents, l)}</strong>
                  {canPayOut && (
                    <button className="lst-add" onClick={() => setPaying(week)} type="button">{week.netCents > 0 ? "Paid out" : "Put on the bill"}</button>
                  )}
                </div>
                <WeekLines l={l} week={week} />
              </li>
            ))}
          </ul>
        </>
      )}
      {recent.length > 0 && (
        <details className="pkq-history pn-recent">
          <summary>Recently paid out</summary>
          <ul className="pn-weeks">
            {recent.map((week) => (
              <li key={`${week.businessId}-${week.weekKey}`}>
                <div className="pn-week static">
                  <span>
                    <strong data-no-translate>{week.businessName || week.businessId}</strong>
                    <small><span>Week of</span> <span data-no-translate>{formatDayKey(week.weekKey, l)}</span></small>
                    <StatusText l={l} week={week} />
                  </span>
                  <strong data-no-translate>{moneyText(week.netCents, l)}</strong>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      {paying && (
        <PaidOutDialog
          l={l}
          onClose={() => setPaying(null)}
          onDone={(message) => {
            setPaying(null);
            setFlash(message);
            read.refresh();
          }}
          week={paying}
        />
      )}
    </section>
  );
}

function PaidOutDialog({ week, l, onClose, onDone }: { week: PayoutWeek; l: Lang; onClose: () => void; onDone: (message: string) => void }) {
  const [method, setMethod] = useState<string>("zelle");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const toBill = week.netCents <= 0;

  const submit = useCallback(async () => {
    const problems = payoutProblems({ method, reference, netCents: week.netCents });
    if (problems.length) {
      setError(PAYOUT_MESSAGES[problems[0]]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await callSettings(payoutPaidPayload(week, method, reference));
      onDone(toBill ? "Put on the business's Laawol bill." : "Paid out. The business gets a receipt on WhatsApp.");
    } catch (err) {
      setError(requestFailure(err).message);
    } finally {
      setBusy(false);
    }
  }, [method, reference, week, toBill, onDone]);

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 480 }}>
        <header className="lst-modal-head">
          <div>
            <h3>{toBill ? "Put on the Laawol bill" : "Paid out"}</h3>
            <p data-no-translate>{`${week.businessName || week.businessId} · ${moneyText(week.netCents, l)} · ${formatDayKey(week.weekKey, l)}`}</p>
          </div>
          <button aria-label="Close" className="lst-icon-btn" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {toBill ? (
            <p className="lst-hint">This week nets to less than nothing, so it is charged on the business&apos;s Laawol bill. No money is sent.</p>
          ) : (
            <>
              <p className="lst-hint">Send the money first, then record how you paid. Any unpaid Laawol bill is taken out and recorded as a bill payment.</p>
              <label className="lst-field">
                <span>How you paid</span>
                <select onChange={(event) => setMethod(event.target.value)} value={method}>
                  {PAYOUT_METHODS.map((m) => (
                    <option key={m} value={m}>{methodLabel(m, l)}</option>
                  ))}
                </select>
              </label>
              <label className="lst-field wide">
                <span>Reference (optional)</span>
                <input maxLength={120} onChange={(event) => setReference(event.target.value)} placeholder="e.g. Zelle confirmation number" value={reference} />
              </label>
            </>
          )}
          {error && <div className="lst-form-error" role="alert">{error}</div>}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" disabled={busy} onClick={onClose} type="button">Back</button>
          <button className="lst-add" data-loading={busy} disabled={busy} onClick={() => void submit()} type="button">{busy ? "Saving..." : toBill ? "Put on the bill" : "Paid out"}</button>
        </footer>
      </div>
    </div>
  );
}
