"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BadgeCheck, Clock, Landmark, RefreshCw, Search, SearchCheck, X } from "lucide-react";

import { callBank } from "@/components/business/bank-call";
import { useAutoRecheck } from "@/components/business/use-auto-recheck";
import { whenText } from "@/components/business/zelle-check-button";
import {
  BANK_SINCE_OPTIONS,
  DEFAULT_SINCE,
  RECORD_KIND_LABELS,
  STANDALONE_TEXT,
  USE_TEXT,
  readCheckAmount,
  readStandaloneAnswer,
  readUseRecords,
  standaloneCheckRequest,
  useDepositRequest,
  useRecordsRequest,
  type BankDeposit,
  type BankSince,
  type CheckBankEntry,
  type StandaloneAnswer,
  type UseRecord,
} from "@/lib/bank-check";
import { currentLanguage, formatDateTime } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import { statusPillClass } from "@/lib/status-pill";
import { readZelleCheckAnswer, zelleFailureMessage } from "@/lib/zelle-check";

function money(cents: number): string {
  return moneyText(cents, currentLanguage() === "fr" ? "fr" : "en");
}

/**
 * "Check bank" in the business console header (docs/ZELLE_BANK_CHECK.md,
 * "Check bank any time"): the button for someone who can check while the
 * bank is connected and active; for the owner, a hint to the bank card when
 * it is not. Staff see nothing then.
 */
export function CheckBankHeaderEntry({
  entry,
  onOpen,
  onOpenSettings,
}: {
  entry: CheckBankEntry;
  onOpen: () => void;
  onOpenSettings: () => void;
}) {
  if (entry === "button") {
    return (
      <button aria-label="Check bank" className="check-bank-button" onClick={onOpen} title="Check bank" type="button">
        <Landmark size={16} /> <span className="check-bank-label">Check bank</span>
      </button>
    );
  }
  if (entry === "connect_hint" || entry === "reconnect_hint") {
    const label = entry === "connect_hint" ? "Connect a bank for Zelle checks" : "The bank needs you to sign in again";
    return (
      <button aria-label={label} className="check-bank-button check-bank-hint" key={entry} onClick={onOpenSettings} title={label} type="button">
        <Landmark size={16} /> <span className="check-bank-label">{entry === "connect_hint" ? "Connect a bank" : "Reconnect the bank"}</span>
      </button>
    );
  }
  return null;
}

/**
 * Staff type the exact amount a customer says they sent and when; the bank
 * says whether it arrived. Looking consumes nothing. A received deposit can
 * be used for a sale or payment of exactly that amount. "Not yet" checks
 * again on its own every 20 s for 3 minutes (`auto: true`).
 */
export function CheckBankDialog({ businessId, previewMode, onClose }: { businessId: string; previewMode: boolean; onClose: () => void }) {
  const [amountText, setAmountText] = useState("");
  const [amountError, setAmountError] = useState("");
  const [since, setSince] = useState<BankSince>(DEFAULT_SINCE);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<StandaloneAnswer | null>(null);
  const [asked, setAsked] = useState<{ cents: number; since: BankSince } | null>(null);
  const [recheckRun, setRecheckRun] = useState(0);
  const [picking, setPicking] = useState("");
  const [used, setUsed] = useState<Record<string, string>>({});

  const ask = useCallback(
    async (request: { cents: number; since: BankSince }, auto: boolean): Promise<StandaloneAnswer | null> => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      if (!auto) setError("");
      try {
        const next = readStandaloneAnswer(await callBank("checkZellePayment", standaloneCheckRequest(businessId, request.cents, request.since, auto), previewMode));
        setAnswer(next);
        return next;
      } catch (failure) {
        setError(zelleFailureMessage(failure));
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [businessId, previewMode],
  );

  async function check(event?: FormEvent) {
    event?.preventDefault();
    if (busyRef.current) return;
    const read = readCheckAmount(amountText);
    setAmountError(read.error);
    if (read.cents === null) return;
    const request = { cents: read.cents, since };
    setAsked(request);
    setPicking("");
    const next = await ask(request, false);
    if (next?.result === "not_found") setRecheckRun((value) => value + 1);
  }

  const recheck = useCallback(async () => {
    if (!asked) return false;
    if (busyRef.current) return true;
    const next = await ask(asked, true);
    return next?.result === "not_found";
  }, [ask, asked]);
  const autoRunning = useAutoRecheck(recheckRun, answer?.result === "not_found", recheck);

  /** A changed amount or time is a new question: the old answer goes. */
  function edit(apply: () => void) {
    apply();
    setAnswer(null);
    setPicking("");
    setError("");
  }

  return (
    <div aria-modal="true" className="lst-modal-overlay" role="dialog" {...overlayDismiss(() => !busy && onClose())}>
      <div className="lst-modal check-bank-modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 560 }}>
        <header className="lst-modal-head">
          <div>
            <h3>Check bank</h3>
            <p>See whether a Zelle payment reached the business&apos;s bank before you record it.</p>
          </div>
          <button aria-label="Close" className="lst-icon-btn" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <div className="lst-modal-body">
          <form className="check-bank-form" onSubmit={(event) => void check(event)}>
            <label className="lst-field">
              <span>Exact amount</span>
              <div className="bl-affix">
                <i aria-hidden="true">$</i>
                <input
                  aria-invalid={amountError ? true : undefined}
                  autoFocus
                  inputMode="decimal"
                  onChange={(event) => edit(() => setAmountText(event.target.value))}
                  placeholder="0.00"
                  value={amountText}
                />
              </div>
              {amountError && <small className="bl-field-error">{amountError}</small>}
            </label>
            <div className="lst-field">
              <span>When was it sent?</span>
              <div aria-label="When was it sent?" className="bl-segmented check-bank-since" role="group">
                {BANK_SINCE_OPTIONS.map((option) => (
                  <button
                    aria-pressed={since === option.value}
                    className={since === option.value ? "active" : ""}
                    key={option.value}
                    onClick={() => edit(() => setSince(option.value))}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <button aria-busy={busy} className="primary-button" disabled={busy} type="submit">
              {busy ? <RefreshCw className="spin" size={16} /> : <SearchCheck size={16} />} {busy ? "Checking…" : "Check now"}
            </button>
          </form>

          {error && (
            <div className="lst-form-error" role="alert">
              {error}
            </div>
          )}

          {answer && answer.result === "not_found" && (
            <div className="check-bank-result" role="status">
              <p>
                <span className={statusPillClass("warn")}>{STANDALONE_TEXT.notYet}</span>{" "}
                <span>{STANDALONE_TEXT.notYetDetail}</span>
              </p>
              <button aria-busy={busy} className="lst-btn ghost" disabled={busy} onClick={() => void check()} type="button">
                {busy ? <RefreshCw className="spin" size={14} /> : <SearchCheck size={14} />} {busy ? "Checking…" : "Check again"}
              </button>
              {autoRunning && (
                <small className="zelle-auto">
                  <Clock aria-hidden="true" size={12} /> <span>{STANDALONE_TEXT.autoRecheck}</span>
                </small>
              )}
            </div>
          )}

          {answer && answer.deposits.length > 0 && (
            <div className="check-bank-result" role="status">
              {answer.result === "several" && <p>{STANDALONE_TEXT.several}</p>}
              <ul className="check-bank-deposits">
                {answer.deposits.map((deposit) => (
                  <li key={deposit.creditId}>
                    <div className="check-bank-deposit">
                      <span className={statusPillClass("ok")}>
                        <BadgeCheck size={14} /> {STANDALONE_TEXT.received}
                      </span>
                      <span data-no-translate>
                        <strong>{money(deposit.amountCents)}</strong>
                        {deposit.atMs !== null && ` · ${whenText(deposit.atMs, deposit.timeKnown)}`}
                        {deposit.senderName && ` · ${deposit.senderName}`}
                      </span>
                      {deposit.pending && <span className={statusPillClass("muted")}>pending</span>}
                    </div>
                    {used[deposit.creditId] ? (
                      <small className="lst-form-ok">{used[deposit.creditId]}</small>
                    ) : picking === deposit.creditId ? (
                      <UseForSale
                        businessId={businessId}
                        deposit={deposit}
                        onCancel={() => setPicking("")}
                        onUsed={(message) => {
                          setUsed((current) => ({ ...current, [deposit.creditId]: message }));
                          setPicking("");
                        }}
                        previewMode={previewMode}
                      />
                    ) : (
                      <button className="lst-btn ghost" disabled={busy || Boolean(picking)} onClick={() => setPicking(deposit.creditId)} type="button">
                        Use for a sale
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {answer?.limitReached && <p className="ctn-wa-warn">{STANDALONE_TEXT.limitReached}</p>}
        </div>
        <footer className="lst-modal-foot">
          <button className="secondary-button" onClick={onClose} type="button">
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * "Use for a sale": the recent standing Zelle payments of exactly the
 * deposit's amount, then a search. Picking one spends the deposit on it
 * (`confirmZelleCandidate` mode "use"); leaving consumes nothing.
 */
function UseForSale({
  businessId,
  deposit,
  previewMode,
  onUsed,
  onCancel,
}: {
  businessId: string;
  deposit: BankDeposit;
  previewMode: boolean;
  onUsed: (message: string) => void;
  onCancel: () => void;
}) {
  const [records, setRecords] = useState<UseRecord[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [usingId, setUsingId] = useState("");
  const [error, setError] = useState("");
  const busy = loading || Boolean(usingId);

  const load = useCallback(
    async (search: string) => {
      setLoading(true);
      setError("");
      try {
        const answer = readUseRecords(await callBank("confirmZelleCandidate", useRecordsRequest(businessId, deposit.creditId, search), previewMode));
        setRecords(answer.records);
        setSearched(answer.searched);
      } catch (failure) {
        setError(zelleFailureMessage(failure));
      } finally {
        setLoading(false);
      }
    },
    [businessId, deposit.creditId, previewMode],
  );

  useEffect(() => {
    void load("");
  }, [load]);

  async function use(record: UseRecord) {
    if (busy) return;
    setUsingId(`${record.kind}:${record.id}`);
    setError("");
    try {
      const answer = readZelleCheckAnswer(
        await callBank("confirmZelleCandidate", useDepositRequest(businessId, deposit.creditId, record.kind, record.id), previewMode),
      );
      if (answer.result === "confirmed") onUsed(USE_TEXT.confirmed);
      else if (answer.result === "already_confirmed") {
        setError(USE_TEXT.already);
        void load(query);
      } else setError(zelleFailureMessage(null));
    } catch (failure) {
      setError(zelleFailureMessage(failure));
    } finally {
      setUsingId("");
    }
  }

  return (
    <div className="check-bank-use">
      <form
        className="check-bank-search"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void load(query);
        }}
      >
        <input
          aria-label="Search by customer, items or tracking code"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by customer, items or tracking code"
          value={query}
        />
        <button aria-busy={loading} className="lst-btn ghost" disabled={busy} type="submit">
          {loading ? <RefreshCw className="spin" size={14} /> : <Search size={14} />} {loading ? "Searching…" : "Search"}
        </button>
      </form>
      {error && (
        <small className="lst-form-error" role="alert">
          {error}
        </small>
      )}
      {!loading && <small className="check-bank-use-head">{searched ? USE_TEXT.searched : USE_TEXT.recent}</small>}
      {!loading && records.length === 0 && <small>{searched ? USE_TEXT.noMatch : USE_TEXT.none}</small>}
      {records.length > 0 && (
        <ul className="check-bank-records">
          {records.map((record) => {
            const key = `${record.kind}:${record.id}`;
            return (
              <li key={key}>
                <button aria-busy={usingId === key} disabled={busy} onClick={() => void use(record)} type="button">
                  <span className={statusPillClass("navy")}>{RECORD_KIND_LABELS[record.kind]}</span>
                  <span className="check-bank-record-text">
                    <strong data-no-translate>{record.who || "—"}</strong>
                    {record.what && <span data-no-translate>{record.what}</span>}
                    <small data-no-translate>
                      {money(record.amountCents)}
                      {record.atMs !== null && ` · ${formatDateTime(record.atMs)}`}
                    </small>
                  </span>
                  {usingId === key ? <RefreshCw className="spin" size={14} /> : <span className="check-bank-use-label">Use this one</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button className="lst-btn ghost" disabled={Boolean(usingId)} onClick={onCancel} type="button">
        Not now
      </button>
    </div>
  );
}
