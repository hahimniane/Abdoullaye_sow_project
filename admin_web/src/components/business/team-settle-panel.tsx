"use client";

import { useState, type ReactNode } from "react";
import { httpsCallable } from "firebase/functions";
import { Banknote, Check, RefreshCw, Undo2, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import { formatDateTime } from "@/lib/format";
import { moneyText } from "@/lib/parking-month-statement";
import { dollarsToCents } from "@/lib/staff-expense-console";
import { BUSINESS_ACCOUNT_RECEIVER, businessAccountName } from "@/lib/staff-balances";
import {
  defaultSettleCents,
  mayAnswerSettlement,
  paybackRefusal,
  settleLimits,
  teamPaybackRequest,
  teamSettleConfirmRequest,
  teamSettleDeclineRequest,
  teamSettlePlan,
  teamSettleRefusalText,
  teamSettleRequest,
  teamSettleUndoRequest,
  SETTLE_MESSAGES,
  type SettleScope,
  type SettlementRecord,
} from "@/lib/team-settle";

type Person = { id: string; name: string };

type Props = {
  businessId: string;
  monthKey: string;
  /** The team member's Month end card (their statement). */
  staffId: string;
  staffName: string;
  owesCents: number;
  parkingJobsCents: number;
  expenseCents: number;
  cashHeldCents: number;
  settlements: readonly SettlementRecord[];
  /** Everyone who may receive: the owner and people with Full access. */
  receivers: readonly Person[];
  names: Readonly<Record<string, string>>;
  myUid: string;
  /** The signed-in person is the owner, has Full access, or is a platform admin. */
  isReceiver: boolean;
  estimating: boolean;
  onFlash: (message: ReactNode) => void;
};

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "zelle", label: "Zelle" },
  { value: "check", label: "Check" },
  { value: "deposit", label: "Bank deposit" },
  { value: "other", label: "Other" },
];
const PAYBACK_METHODS = METHODS.filter((m) => m.value !== "deposit");

const SCOPES: { value: SettleScope; label: string }[] = [
  { value: "everything", label: "Everything" },
  { value: "cash", label: "Only the cash I hold" },
  { value: "parking", label: "Only my parking" },
];

const centsInput = (cents: number) => (cents / 100).toFixed(2);

/**
 * "I paid everything" on a team member's Month end card
 * (docs/TEAM_SETTLE.md): the member says they paid their month; it counts
 * once the receiver confirms. The receiver confirms or declines; anyone on
 * the team can undo a settlement that counts. When the business owes the
 * member, the owner (or Full access) records "Paid them back".
 */
export function TeamSettlePanel(props: Props) {
  const { businessId, monthKey, staffId, staffName, owesCents, settlements, receivers, names, myUid, isReceiver, estimating, onFlash } = props;
  const mine = staffId === myUid;
  const statement = { parkingJobsCents: props.parkingJobsCents, expenseCents: props.expenseCents, cashHeldCents: props.cashHeldCents };
  const limits = settleLimits(statement);

  const [open, setOpen] = useState<"" | "settle" | "payback">("");
  const [scope, setScope] = useState<SettleScope>("everything");
  const [amount, setAmount] = useState("");
  const [receiverId, setReceiverId] = useState("");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [undoTarget, setUndoTarget] = useState<SettlementRecord | null>(null);
  const [declineTarget, setDeclineTarget] = useState<SettlementRecord | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const [rowBusy, setRowBusy] = useState("");

  const options: Person[] = [
    ...receivers.filter((r) => r.id !== staffId),
    { id: BUSINESS_ACCOUNT_RECEIVER, name: businessAccountName() },
  ];
  const nameOf = (id: string) => (id === BUSINESS_ACCOUNT_RECEIVER ? businessAccountName() : names[id] || "");

  function limitFor(next: SettleScope): number {
    return next === "cash" ? limits.cashDueCents : next === "parking" ? limits.parkingDueCents : defaultSettleCents(statement);
  }

  function openSettle() {
    setScope("everything");
    setAmount(centsInput(defaultSettleCents(statement)));
    // A receiver filing it for the member is the receiver themselves; the member picks the owner (or whoever took it).
    const self = isReceiver && !mine && options.some((o) => o.id === myUid) ? myUid : "";
    setReceiverId(self || options[0]?.id || "");
    setMethod("cash");
    setNote("");
    setError("");
    setOpen("settle");
  }

  function openPayback() {
    setAmount(centsInput(-owesCents));
    setMethod("cash");
    setNote("");
    setError("");
    setOpen("payback");
  }

  async function call(input: Record<string, unknown>): Promise<boolean> {
    try {
      const result = await httpsCallable(functions, "updateLotExpenseEntry")(input);
      const data = (result.data && typeof result.data === "object" ? result.data : {}) as { receipt?: string };
      if (data.receipt === "failed") onFlash(<span>The WhatsApp receipt could not be sent.</span>);
      return true;
    } catch (failure) {
      setError(teamSettleRefusalText(failure));
      return false;
    }
  }

  const typedCents = dollarsToCents(amount);
  const plan = teamSettlePlan({ statement, amountCents: Number.isFinite(typedCents) ? typedCents : 0, scope });
  const paybackProblem = paybackRefusal({ owesCents, amountCents: Number.isFinite(typedCents) ? typedCents : 0, method });

  async function runSettle() {
    if (busy || !plan.ok || !receiverId) return;
    setBusy(true);
    setError("");
    const filed = await call(teamSettleRequest({ businessId, monthKey, staffId, amountCents: typedCents, scope, receiverId, method, note }));
    setBusy(false);
    if (!filed) return;
    setOpen("");
    const direct = isReceiver && !mine && (receiverId === myUid || receiverId === BUSINESS_ACCOUNT_RECEIVER);
    onFlash(direct ? <span>Payment recorded.</span> : <span>Sent. It counts once the person who received it confirms.</span>);
  }

  async function runPayback() {
    if (busy || paybackProblem) return;
    setBusy(true);
    setError("");
    const done = await call(teamPaybackRequest({ businessId, monthKey, staffId, amountCents: typedCents, method, note }));
    setBusy(false);
    if (!done) return;
    setOpen("");
    onFlash(<span>Paid back — recorded.</span>);
  }

  async function answer(record: SettlementRecord, confirm: boolean) {
    if (rowBusy) return;
    setRowBusy(record.id);
    setError("");
    const done = await call(confirm ? teamSettleConfirmRequest(businessId, record.id) : teamSettleDeclineRequest(businessId, record.id, declineNote));
    setRowBusy("");
    if (!done) return;
    setDeclineTarget(null);
    setDeclineNote("");
    onFlash(confirm ? <span>Payment confirmed.</span> : <span>Payment declined.</span>);
  }

  async function runUndo() {
    if (!undoTarget || rowBusy) return;
    setRowBusy(undoTarget.id);
    setError("");
    const done = await call(teamSettleUndoRequest(businessId, undoTarget.id));
    setRowBusy("");
    if (!done) return;
    setUndoTarget(null);
    onFlash(<span>Payment undone.</span>);
  }

  const canFile = !estimating && owesCents > 0 && (mine || isReceiver);
  const canPayback = !estimating && owesCents < 0 && isReceiver;
  if (!canFile && !canPayback && settlements.length === 0) return null;

  return (
    <section className="pk-bill-payments" aria-label="I paid everything">
      <h4>Month settlement</h4>
      {error && !open && !undoTarget && !declineTarget && <div className="lst-form-error" role="alert">{error}</div>}
      {settlements.length > 0 && (
        <ul>
          {settlements.map((s) => {
            const receiver = nameOf(s.receiverId);
            const answerable = mayAnswerSettlement(s, { uid: myUid, isReceiver });
            return (
              <li key={s.id} className={s.status === "undone" || s.status === "declined" ? "pk-bill-payment pk-bill-payment-undone" : "pk-bill-payment"}>
                <span className="pk-bill-payment-main">
                  <strong data-no-translate>{moneyText(s.amountCents)}</strong>
                  <small>
                    {s.status === "pending" && <><span>Waiting for</span> <span data-no-translate>{receiver || "—"}</span> <span>to confirm</span></>}
                    {s.status === "confirmed" && <><span>Confirmed</span>{s.confirmedAtMs > 0 && <> · <span data-no-translate>{formatDateTime(s.confirmedAtMs)}</span></>}</>}
                    {s.status === "declined" && <><span>Not confirmed</span>{s.declineNote && <> · <span data-no-translate>{s.declineNote}</span></>}</>}
                    {s.status === "undone" && <><span>Undone</span>{s.undoneAtMs > 0 && <> · <span data-no-translate>{formatDateTime(s.undoneAtMs)}</span></>}{nameOf(s.undoneByUid) && <> · <span>by</span> <span data-no-translate>{nameOf(s.undoneByUid)}</span></>}</>}
                    {" · "}<span>{METHODS.find((m) => m.value === s.method)?.label ?? "Other"}</span>
                    {s.status !== "pending" && receiver && <> · <span>received by</span> <span data-no-translate>{receiver}</span></>}
                  </small>
                  <small>
                    {s.cashCents > 0 && <><span>Cash held</span> <b data-no-translate>{moneyText(s.cashCents)}</b></>}
                    {s.cashCents > 0 && s.parkingCents > 0 && " · "}
                    {s.parkingCents > 0 && <><span>Parking and jobs</span> <b data-no-translate>{moneyText(s.parkingCents)}</b></>}
                    {" · "}<span>The statement was</span> <b data-no-translate>{moneyText(s.statementOwedCents)}</b>
                  </small>
                </span>
                {answerable && (
                  <span>
                    <button className="lst-btn" type="button" disabled={Boolean(rowBusy)} onClick={() => void answer(s, true)}>
                      {rowBusy === s.id ? <RefreshCw className="spin" size={14} /> : <Check size={14} />} Confirm
                    </button>
                    <button className="ghost-button" type="button" disabled={Boolean(rowBusy)} onClick={() => { setDeclineTarget(s); setDeclineNote(""); setError(""); }}><X size={14} /> Decline</button>
                  </span>
                )}
                {(s.status === "confirmed" || s.status === "pending") && !answerable && (
                  <button className="ghost-button" type="button" disabled={Boolean(rowBusy)} onClick={() => { setUndoTarget(s); setError(""); }}><Undo2 size={14} /> {s.status === "pending" ? "Cancel" : "Undo"}</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="pk-month-actions">
        {canFile && (
          <button className="lst-add" type="button" disabled={busy} onClick={openSettle}>
            <Banknote size={16} /> {mine ? <span>I paid everything</span> : <span>Record that they paid everything</span>} · <span data-no-translate>{moneyText(defaultSettleCents(statement))}</span>
          </button>
        )}
        {canPayback && (
          <button className="lst-add" type="button" disabled={busy} onClick={openPayback}>
            <Banknote size={16} /> <span>Paid them back</span> · <span data-no-translate>{moneyText(-owesCents)}</span>
          </button>
        )}
      </div>

      {open === "settle" && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!busy) setOpen(""); })}>
          <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div><h3>I paid everything</h3><p><span data-no-translate>{staffName}</span></p></div>
              <button className="lst-icon-btn" type="button" disabled={busy} onClick={() => setOpen("")} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {error && <div className="lst-form-error" role="alert">{error}</div>}
              <p className="lst-hint" style={{ marginTop: 0 }}>It counts once the person who received the money confirms. The amount and what it is for are kept as you send them.</p>
              <div className="lst-form-grid">
                <label className="lst-field"><span>What it is for</span>
                  <select value={scope} disabled={busy} aria-label="What it is for" onChange={(e) => { const next = e.target.value as SettleScope; setScope(next); setAmount(centsInput(limitFor(next))); setError(""); }}>
                    {SCOPES.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Amount paid ($)</span>
                  <input value={amount} inputMode="decimal" autoComplete="off" aria-label="Amount paid" disabled={busy} onChange={(e) => { setAmount(e.target.value); setError(""); }} />
                </label>
                <label className="lst-field"><span>Who received it</span>
                  <select value={receiverId} disabled={busy} aria-label="Who received it" onChange={(e) => setReceiverId(e.target.value)}>
                    {options.map((o) => (<option key={o.id} value={o.id} data-no-translate={o.id === BUSINESS_ACCOUNT_RECEIVER ? undefined : true}>{o.name}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>How it was paid</span>
                  <select value={method} disabled={busy} aria-label="How it was paid" onChange={(e) => setMethod(e.target.value)}>
                    {METHODS.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
                  </select>
                </label>
                <label className="lst-field wide"><span>Note</span><input value={note} maxLength={300} disabled={busy} onChange={(e) => setNote(e.target.value)} /></label>
              </div>
              <div aria-live="polite">
                {plan.ok ? (
                  <ul className="pk-settle-list">
                    {plan.cashCents > 0 && <li><span>Cash held</span><strong>{moneyText(plan.cashCents)}</strong></li>}
                    {plan.parkingCents > 0 && <li><span>Parking and jobs</span><strong>{moneyText(plan.parkingCents)}</strong></li>}
                    <li className="pk-settle-total"><span>Left to pay</span><strong>{moneyText(plan.leftCents)}</strong></li>
                  </ul>
                ) : (
                  <div className="lst-form-error" role="alert">{SETTLE_MESSAGES[plan.reason]}</div>
                )}
              </div>
            </div>
            <footer className="lst-modal-foot">
              {busy && <span className="lst-hint" role="status" style={{ marginRight: "auto" }}><RefreshCw className="spin" size={13} /> Saving…</span>}
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => setOpen("")}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy || !plan.ok || !receiverId} onClick={() => void runSettle()}><Banknote size={16} /> I paid everything</button>
            </footer>
          </div>
        </div>
      )}

      {open === "payback" && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!busy) setOpen(""); })}>
          <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div><h3>Paid them back</h3><p><span data-no-translate>{staffName}</span></p></div>
              <button className="lst-icon-btn" type="button" disabled={busy} onClick={() => setOpen("")} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {error && <div className="lst-form-error" role="alert">{error}</div>}
              <p className="lst-hint" style={{ marginTop: 0 }}><span>The business owes them</span> <b data-no-translate>{moneyText(-owesCents)}</b>. <span>It is recorded as paid back for their expenses.</span></p>
              <div className="lst-form-grid">
                <label className="lst-field"><span>Amount paid back ($)</span>
                  <input value={amount} inputMode="decimal" autoComplete="off" aria-label="Amount paid back" disabled={busy} onChange={(e) => { setAmount(e.target.value); setError(""); }} />
                </label>
                <label className="lst-field"><span>How it was paid</span>
                  <select value={method} disabled={busy} aria-label="How it was paid" onChange={(e) => setMethod(e.target.value)}>
                    {PAYBACK_METHODS.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
                  </select>
                </label>
                <label className="lst-field wide"><span>Note</span><input value={note} maxLength={300} disabled={busy} onChange={(e) => setNote(e.target.value)} /></label>
              </div>
              {paybackProblem && amount.trim() !== "" && <div className="lst-form-error" role="alert">{SETTLE_MESSAGES[paybackProblem]}</div>}
            </div>
            <footer className="lst-modal-foot">
              {busy && <span className="lst-hint" role="status" style={{ marginRight: "auto" }}><RefreshCw className="spin" size={13} /> Saving…</span>}
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => setOpen("")}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy || Boolean(paybackProblem)} onClick={() => void runPayback()}><Banknote size={16} /> Paid them back</button>
            </footer>
          </div>
        </div>
      )}

      {declineTarget && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!rowBusy) setDeclineTarget(null); })}>
          <div className="lst-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div><h3>Decline this payment?</h3><p><b data-no-translate>{moneyText(declineTarget.amountCents)}</b> · <span data-no-translate>{staffName}</span></p></div>
              <button className="lst-icon-btn" type="button" disabled={Boolean(rowBusy)} onClick={() => setDeclineTarget(null)} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {error && <div className="lst-form-error" role="alert">{error}</div>}
              <label className="lst-field wide"><span>Why (optional)</span><input value={declineNote} maxLength={300} onChange={(e) => setDeclineNote(e.target.value)} /></label>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={Boolean(rowBusy)} onClick={() => setDeclineTarget(null)}>Cancel</button>
              <button className="lst-btn danger" type="button" disabled={Boolean(rowBusy)} onClick={() => void answer(declineTarget, false)}><X size={14} /> Decline</button>
            </footer>
          </div>
        </div>
      )}

      {undoTarget && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!rowBusy) setUndoTarget(null); })}>
          <div className="lst-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div><h3>{undoTarget.status === "pending" ? "Cancel this payment?" : "Undo this payment?"}</h3><p><b data-no-translate>{moneyText(undoTarget.amountCents)}</b> · <span data-no-translate>{staffName}</span></p></div>
              <button className="lst-icon-btn" type="button" disabled={Boolean(rowBusy)} onClick={() => setUndoTarget(null)} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {error && <div className="lst-form-error" role="alert">{error}</div>}
              <p className="lst-hint" style={{ marginTop: 0 }}>{undoTarget.status === "pending" ? "It will not count. Nobody is told." : "It takes off the parking payment and the cash hand-over together. Nobody is told."}</p>
            </div>
            <footer className="lst-modal-foot">
              {rowBusy && <span className="lst-hint" role="status" style={{ marginRight: "auto" }}><RefreshCw className="spin" size={13} /> Saving…</span>}
              <button className="lst-btn ghost" type="button" disabled={Boolean(rowBusy)} onClick={() => setUndoTarget(null)}>Keep it</button>
              <button className="lst-btn danger" type="button" disabled={Boolean(rowBusy)} onClick={() => void runUndo()}><Undo2 size={14} /> {undoTarget.status === "pending" ? "Cancel payment" : "Undo payment"}</button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
