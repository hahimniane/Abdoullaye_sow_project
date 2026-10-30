"use client";

import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { HandCoins, RefreshCw, Undo2, X } from "lucide-react";

import { auth, functions } from "@/lib/firebase";
import { currentLanguage, formatDayKey, text } from "@/lib/format";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import { monthLabel, moneyText, type ParkingMonthSummary } from "@/lib/parking-month-statement";
import {
  defaultRepaymentDay,
  dollarsToCents,
  monthStaffRepayments,
  newYorkDayKey,
  repaymentDayKey,
  staffCreditRefusalText,
  staffRepaymentProblem,
  staffRepaymentRequest,
  STAFF_REPAYMENT_METHODS,
  type StaffRepaymentDraft,
} from "@/lib/staff-expense-console";
import type { BusinessOwesLine, StaffParkingLinks } from "@/lib/staff-expense-credit";
import {
  businessOwesWithCash,
  staffBalancesFrom,
  staffBalancesRequest,
  STAFF_BALANCES_TIMEOUT_MS,
  type StaffBalanceRow,
} from "@/lib/staff-balances";

type Row = Record<string, unknown>;

type BusinessOwesSectionProps = {
  businessId: string;
  monthKey: string;
  summary: ParkingMonthSummary;
  links: StaffParkingLinks;
  /** Every staffExpenseRepayments row of the business (this month's are listed). */
  repayments: readonly Row[];
  staffOptions: readonly { id: string; name: string }[];
  /** Owner, platform admin, or staff with the `ledger` permission. */
  canSettle: boolean;
  /** The whole-month estimate: nothing is recorded from it. */
  estimating: boolean;
  onFlash: (message: string) => void;
};

/**
 * "Business owes" (docs/STAFF_EXPENSE_CREDIT.md §1.4): staff who paid lot
 * expenses out of their own pocket and are still owed after their parking
 * bill - no bill, or credit bigger than it - with Paid back to record the
 * money given, and this month's paid-back records (voidable, never deleted).
 * Each line also counts the business money the person holds today (Staff
 * balances' one net number, owner 2026-10-30): someone who collected more
 * than they are owed "holds $X for the business", and Paid back is offered
 * only when the business really owes them.
 */
export function BusinessOwesSection({
  businessId, monthKey, summary, links, repayments, staffOptions, canSettle, estimating, onFlash,
}: BusinessOwesSectionProps) {
  const [payFor, setPayFor] = useState<BusinessOwesLine | null>(null);
  const [draft, setDraft] = useState<StaffRepaymentDraft>({ amount: "", method: "cash", givenByStaffId: "", note: "", paidAt: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [voidTarget, setVoidTarget] = useState<Row | null>(null);
  const [voidBusy, setVoidBusy] = useState(false);
  const [voidError, setVoidError] = useState("");
  const history = monthStaffRepayments(repayments, monthKey);
  const nameOf = (id: string) => staffOptions.find((s) => s.id === id)?.name ?? "";
  const today = newYorkDayKey();
  const [balances, setBalances] = useState<StaffBalanceRow[] | null>(null);
  const [cashState, setCashState] = useState<"loading" | "ready" | "failed">("loading");
  const asking = summary.businessOwes.length > 0;

  // The cash each person holds, from Staff balances (as of today). Loading
  // always resolves: an answer, a refusal or the timeout.
  useEffect(() => {
    if (!asking || !businessId) return;
    let live = true;
    let timer = 0;
    setCashState("loading");
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error("timeout")), STAFF_BALANCES_TIMEOUT_MS);
    });
    Promise.race([httpsCallable(functions, "updateLotExpenseEntry")(staffBalancesRequest(businessId)), timeout])
      .then((response) => {
        if (!live) return;
        setBalances(staffBalancesFrom((response as { data?: unknown }).data).staff);
        setCashState("ready");
      })
      .catch(() => {
        if (!live) return;
        setBalances(null);
        setCashState("failed");
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [asking, businessId, summary.businessOwesCents]);

  if (summary.businessOwes.length === 0 && history.length === 0) return null;
  const withCash = businessOwesWithCash(summary.businessOwes, cashState === "ready" ? balances : null);

  /** The parking bill a staff member's expenses come off, as the row says it. */
  const billOf = (line: BusinessOwesLine) => {
    if (!line.customerKey) return { name: "", note: "No parking bill" };
    const bill = summary.customers.find((c) => c.key === line.customerKey);
    if (bill) return { name: bill.customerName, note: "credit bigger than the bill" };
    return { name: text(links[line.staffId]?.customerName, ""), note: "no parking bill this month" };
  };

  function openPay(line: BusinessOwesLine, owedNowCents: number) {
    const me = auth.currentUser?.uid ?? "";
    setPayFor(line);
    setDraft({
      amount: (Math.min(line.owedCents, owedNowCents) / 100).toFixed(2),
      method: "cash",
      givenByStaffId: staffOptions.some((s) => s.id === me) ? me : "",
      note: "",
      paidAt: defaultRepaymentDay(monthKey, today),
    });
    setError("");
  }

  async function recordPay() {
    if (!payFor) return;
    const problem = staffRepaymentProblem(draft, payFor.owedCents, today);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await httpsCallable(functions, "updateLotExpenseEntry")(staffRepaymentRequest(businessId, payFor.staffId, draft));
      onFlash(`Recorded ${moneyText(dollarsToCents(draft.amount))} paid back to ${payFor.staffName || nameOf(payFor.staffId) || "your team member"}.`);
      setPayFor(null);
    } catch (failure) {
      setError(staffCreditRefusalText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function confirmVoid() {
    if (!voidTarget) return;
    setVoidBusy(true);
    setVoidError("");
    try {
      await httpsCallable(functions, "updateLotExpenseEntry")({
        action: "void_staff_repayment",
        businessId,
        repaymentId: String(voidTarget.id),
      });
      onFlash("Paid-back record voided.");
      setVoidTarget(null);
    } catch (failure) {
      setVoidError(staffCreditRefusalText(failure));
    } finally {
      setVoidBusy(false);
    }
  }

  const methodLabel = (code: unknown) => STAFF_REPAYMENT_METHODS.find((m) => m.value === code)?.label ?? "Another method";

  return (
    <section className="pk-owes" aria-label="Business owes">
      <header className="pk-owes-head">
        <div>
          <h3>Business owes</h3>
          <small>Lot expenses staff paid out of their own pocket, after their parking bill and the business money they hold.</small>
        </div>
        <span className="pk-month-amount">
          {withCash.owedNowCents > 0 && <strong className="pk-owed">{moneyText(withCash.owedNowCents)}</strong>}
          {withCash.holdsCents > 0 && <small><span>Staff hold</span> {moneyText(withCash.holdsCents)}</small>}
        </span>
      </header>
      {asking && cashState === "loading" && <p className="lst-hint" role="status"><RefreshCw className="spin" size={12} aria-hidden="true" /> Checking the cash staff hold…</p>}
      {asking && cashState === "failed" && <p className="lst-hint" role="status">The cash staff hold could not be checked; showing expenses only.</p>}
      {asking && cashState === "ready" && <p className="lst-hint">Cash held is as of today, from Staff balances.</p>}
      {summary.businessOwes.length === 0 ? (
        <div className="empty-state">The business owes its staff nothing for this month.</div>
      ) : (
        <ul className="pk-owes-list">
          {summary.businessOwes.map((line, index) => {
            const bill = billOf(line);
            const cash = withCash.lines[index];
            const known = cash.netCents !== null;
            return (
              <li key={line.staffId}>
                <span className="pk-month-car">
                  <strong data-no-translate>{line.staffName || nameOf(line.staffId) || "—"}</strong>
                  <small>
                    {bill.name ? <><span>Parking bill</span>: <span data-no-translate>{bill.name}</span> · </> : null}
                    <span>{bill.note}</span>
                  </small>
                  {known && (
                    <small>
                      <span>Expenses owed</span> {moneyText(cash.expenseOwedCents)} · <span>Holding</span> {moneyText(cash.heldCents)}
                    </small>
                  )}
                </span>
                {cash.holdsCents > 0 ? (
                  <span className="pk-month-amount"><strong className="pk-due">{moneyText(cash.holdsCents)}</strong><small>holds for the business</small></span>
                ) : cash.owedNowCents > 0 ? (
                  <span className="pk-month-amount"><strong>{moneyText(cash.owedNowCents)}</strong><small>owed</small></span>
                ) : (
                  <span className="pk-month-amount"><strong className="pk-paid">{moneyText(0)}</strong><small>Settled up</small></span>
                )}
                {canSettle && !estimating && cash.canPayBack && (
                  <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => openPay(line, cash.owedNowCents)}><HandCoins size={14} /> Paid back</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {history.length > 0 && (
        <>
          <div className="lst-form-section">{`Paid back in ${monthLabel(monthKey, currentLanguage() === "fr" ? "fr" : "en")}`}</div>
          <ul className="pk-owes-list pk-owes-history">
            {history.map((r) => (
              <li key={String(r.id)}>
                <span className="pk-month-car">
                  <strong data-no-translate>{nameOf(text(r.staffId, "")) || "—"}</strong>
                  <small>
                    <span>{methodLabel(r.method)}</span>
                    {nameOf(text(r.givenByStaffId, "")) ? <> · <span>given by</span> <span data-no-translate>{nameOf(text(r.givenByStaffId, ""))}</span></> : null}
                    {repaymentDayKey(r) ? <> · {formatDayKey(repaymentDayKey(r))}</> : null}
                    {text(r.note, "") ? <> · <span data-no-translate>{text(r.note, "")}</span></> : null}
                  </small>
                </span>
                <span className="pk-month-amount"><strong className="pk-paid">{moneyText(Number(r.amountCents) || 0)}</strong></span>
                {canSettle && (
                  <button className="ghost-button" type="button" title="Void this paid-back record" aria-label="Void this paid-back record" onClick={() => { setVoidTarget(r); setVoidError(""); }}><Undo2 size={14} /></button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {payFor && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!busy) setPayFor(null); })}>
          <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div><h3>Paid back</h3><p><span data-no-translate>{payFor.staffName || nameOf(payFor.staffId)}</span> · {`${moneyText(payFor.owedCents)} owed`}</p></div>
              <button className="lst-icon-btn" type="button" disabled={busy} onClick={() => setPayFor(null)} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {error && <div className="lst-form-error" role="alert">{error}</div>}
              <p className="lst-hint" style={{ marginTop: 0 }}>Record the money the business gave back for lot expenses. It lowers what the business owes; a mistake is voided, never deleted.</p>
              <div className="lst-form-grid">
                <label className="lst-field"><span>Amount ($)</span>
                  <input inputMode="decimal" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))} aria-label="Amount paid back" />
                </label>
                <label className="lst-field"><span>How it was given</span>
                  <select value={draft.method} onChange={(e) => setDraft((d) => ({ ...d, method: e.target.value }))}>
                    {STAFF_REPAYMENT_METHODS.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Given by</span>
                  <select value={draft.givenByStaffId} onChange={(e) => setDraft((d) => ({ ...d, givenByStaffId: e.target.value }))} aria-label="Given by">
                    <option value="">Who gave the money?</option>
                    {staffOptions.map((s) => (<option key={s.id} value={s.id} data-no-translate>{s.name}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Paid back on</span>
                  <input type="date" max={today} value={draft.paidAt} onChange={(e) => setDraft((d) => ({ ...d, paidAt: e.target.value }))} />
                </label>
                <label className="lst-field wide"><span>Note</span><input value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} /></label>
              </div>
              <p className="lst-hint">{`At most ${moneyText(payFor.owedCents)}: what the business owes on this report.`}</p>
            </div>
            <footer className="lst-modal-foot">
              {busy && <span className="lst-hint" role="status" style={{ marginRight: "auto" }}><RefreshCw className="spin" size={13} /> Saving…</span>}
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => setPayFor(null)}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy || !draft.givenByStaffId} onClick={() => void recordPay()}>
                <HandCoins size={16} /> Record paid back
              </button>
            </footer>
          </div>
        </div>
      )}

      {voidTarget && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!voidBusy) setVoidTarget(null); })}>
          <div className="lst-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div><h3>Void this paid-back record?</h3><p><span data-no-translate>{nameOf(text(voidTarget.staffId, ""))}</span> · {moneyText(Number(voidTarget.amountCents) || 0)}</p></div>
              <button className="lst-icon-btn" type="button" disabled={voidBusy} onClick={() => setVoidTarget(null)} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {voidError && <div className="lst-form-error" role="alert">{voidError}</div>}
              <p className="lst-hint" style={{ marginTop: 0 }}>The business will owe this amount again. The record stays in the history, marked void.</p>
            </div>
            <footer className="lst-modal-foot">
              {voidBusy && <span className="lst-hint" role="status" style={{ marginRight: "auto" }}><RefreshCw className="spin" size={13} /> Saving…</span>}
              <button className="lst-btn ghost" type="button" disabled={voidBusy} onClick={() => setVoidTarget(null)}>Cancel</button>
              <button className="lst-btn danger" type="button" disabled={voidBusy} onClick={() => void confirmVoid()}><Undo2 size={14} /> Void</button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
