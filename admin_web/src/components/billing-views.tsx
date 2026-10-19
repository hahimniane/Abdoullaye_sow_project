"use client";

// Admin console → Bills (docs/PLATFORM_BILLING.md): what each business owes
// Laawol for a month under its own deal, its payments, closing a month, the
// deal and its history, the commission keep / replace switch, and "Try other
// rates" for one business or all of them. Everything goes through the one
// `platformBilling` callable; preview mode (`?preview=1`) answers from
// lib/platform-billing-preview.ts. Pure logic is lib/platform-billing.ts.
//
// Business names, notes, amounts, counts and months render in elements
// marked data-no-translate; every other string is English here and French in
// french-dom.ts.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { httpsCallable } from "firebase/functions";
import {
  AlertTriangle,
  Calculator,
  ChevronLeft,
  History,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Undo2,
  X,
} from "lucide-react";

import { MonthPicker, MonthText } from "@/components/volume-views";
import { confirmImportantAction } from "@/lib/action-confirmation";
import { functions } from "@/lib/firebase";
import { currentLanguage, formatDateTime, formatDayKey } from "@/lib/format";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import {
  BILLING_CALLABLE,
  CHARGE_LABELS,
  DRIFT_LABELS,
  PAYMENT_METHODS,
  STANDING_LABELS,
  centsToInput,
  dealFromDraft,
  dealSegments,
  draftFromDeal,
  effectiveMonthOptions,
  emptyDealDraft,
  formatBps,
  formatCents,
  formatDelta,
  monthIsOver,
  paymentDraftErrors,
  paymentMethodLabel,
  refusalMessage,
  standingTone,
  todayInNewYork,
  type Bill,
  type BillLine,
  type BusinessBillResponse,
  type Deal,
  type DealDraft,
  type DraftErrors,
  type MonthBillsResponse,
  type MonthRow,
  type Standing,
  type WhatIfAllResponse,
  type WhatIfOneResponse,
} from "@/lib/platform-billing";
import { previewPlatformBilling } from "@/lib/platform-billing-preview";
import { readMoneyInput } from "@/lib/money-input";
import { currentVolumeMonth, formatVolumeCount, formatVolumeMonth } from "@/lib/volume";

/** A bills read can take a while (it counts every business's month): this long, then say so. */
const READ_TIMEOUT_MS = 125000;
const READ_FAILED = "Bills could not be loaded. Try again.";
const READ_SLOW = "Bills are taking longer than usual. Try again in a moment.";

type Lang = "en" | "fr";

function useLang(): Lang {
  return currentLanguage() === "fr" ? "fr" : "en";
}

/** Calls the callable, or the preview in preview mode. */
function useBillingCall(previewMode: boolean) {
  return useCallback(
    async <T,>(data: Record<string, unknown>): Promise<T> => {
      if (previewMode) return (await previewPlatformBilling(data)) as T;
      const response = await httpsCallable(functions, BILLING_CALLABLE, { timeout: READ_TIMEOUT_MS })(data);
      return response.data as T;
    },
    [previewMode],
  );
}

type Read<T> = { data: T | null; loading: boolean; error: string; refresh: () => void };

/**
 * A read that re-runs when its payload changes. Every path - answer,
 * failure, or no answer at all within READ_TIMEOUT_MS - leaves `loading`
 * false (guardrails: loading states always resolve).
 */
function useBillingRead<T>(previewMode: boolean, payload: Record<string, unknown> | null, reloadKey: number): Read<T> {
  const call = useBillingCall(previewMode);
  const payloadKey = payload ? JSON.stringify(payload) : "";
  const [again, setAgain] = useState(0);
  const key = payloadKey ? `${payloadKey}|${reloadKey}|${again}` : "";
  const [state, setState] = useState<{ key: string; data: T | null; loading: boolean; error: string }>({
    key: "",
    data: null,
    loading: false,
    error: "",
  });
  useEffect(() => {
    if (!key) return undefined;
    let settled = false;
    setState((prev) => ({ key, data: prev.data, loading: true, error: "" }));
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setState((prev) => (prev.key === key ? { ...prev, loading: false, error: READ_SLOW } : prev));
    }, READ_TIMEOUT_MS + 2000);
    call<T>(JSON.parse(payloadKey) as Record<string, unknown>)
      .then((data) => {
        if (settled) return;
        settled = true;
        setState((prev) => (prev.key === key ? { key, data, loading: false, error: "" } : prev));
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        setState((prev) => (prev.key === key ? { ...prev, loading: false, error: READ_FAILED } : prev));
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      settled = true;
      window.clearTimeout(timer);
    };
  }, [call, key, payloadKey]);
  const current = state.key === key;
  return {
    data: key ? state.data : null,
    loading: Boolean(key) && (!current || state.loading),
    error: current ? state.error : "",
    refresh: () => setAgain((value) => value + 1),
  };
}

// ---------------------------------------------------------------------------
// Small pieces.
// ---------------------------------------------------------------------------

function Money({ cents, strong = false }: { cents: number; strong?: boolean }) {
  const lang = useLang();
  const text = formatCents(cents, lang);
  return strong ? <b data-no-translate>{text}</b> : <span data-no-translate>{text}</span>;
}

function Count({ value }: { value: number | null | undefined }) {
  const lang = useLang();
  if (value === null || value === undefined) return <span data-no-translate>—</span>;
  return <span data-no-translate>{formatVolumeCount(value, lang)}</span>;
}

function Pct({ bps }: { bps: number }) {
  const lang = useLang();
  return <span data-no-translate>{formatBps(bps, lang)}</span>;
}

function StandingPill({ status }: { status: Standing }) {
  return <span className={`status-pill compact ${standingTone(status)}`}>{STANDING_LABELS[status]}</span>;
}

function StatusPill({ status }: { status: "open" | "closed" }) {
  return status === "closed" ? (
    <span className="status-pill compact navy">
      <Lock size={11} /> Closed
    </span>
  ) : (
    <span className="status-pill compact muted">Open</span>
  );
}

function BillsStatus({
  loading,
  error,
  computedAtMs,
  onRefresh,
}: {
  loading: boolean;
  error: string;
  computedAtMs: number | null | undefined;
  onRefresh: () => void;
}) {
  return (
    <div aria-live="polite" className="totals-status">
      {error ? (
        <span className="totals-status-error">{error}</span>
      ) : loading && !computedAtMs ? (
        <span>Working out the bills…</span>
      ) : computedAtMs ? (
        <span>
          <span>Bills as of</span> <span data-no-translate>{formatDateTime(computedAtMs)}</span>
        </span>
      ) : null}
      <button aria-busy={loading} className="ghost-button compact" disabled={loading} onClick={onRefresh} type="button">
        <RefreshCw size={14} /> {loading ? "Loading…" : error ? "Retry" : "Refresh"}
      </button>
    </div>
  );
}

/** A deal as a short list: "Barrels $5.00 each · Packages 5% of the price (minimum $1.00)". */
function DealSummary({ deal, empty = "No deal" }: { deal: Deal | null | undefined; empty?: string }) {
  const segments = dealSegments(deal);
  if (segments.length === 0) return <span className="bl-muted">{empty}</span>;
  return (
    <ul className="bl-deal-summary">
      {segments.map((segment) => (
        <li key={segment.key}>
          <span className="bl-deal-label">{segment.label}</span>{" "}
          {segment.cents !== undefined && <Money cents={segment.cents} />}
          {segment.bps !== undefined && <Pct bps={segment.bps} />} {segment.unit && <span>{segment.unit}</span>}
          {segment.minCents !== undefined && (
            <>
              {" "}
              <span>(minimum</span> <Money cents={segment.minCents} />
              <span>)</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** What a bill line is made of: "87 × $1.00 each", "5% of the price, minimum $1.00 each". */
function LineDetail({ line }: { line: BillLine }) {
  if (line.key === "packages" && line.mode === "percent") {
    return (
      <>
        <span>
          <span data-no-translate>
            <Count value={line.quantity} /> ×{" "}
          </span>
          <Pct bps={line.bps ?? 0} /> <span>of the price</span>
          {(line.minCents ?? 0) > 0 && (
            <>
              {" · "}
              <span>minimum</span> <Money cents={line.minCents ?? 0} /> <span>per package</span>
            </>
          )}
        </span>
        {(line.noPriceCount ?? 0) > 0 && (
          <span className="bl-line-note">
            <Count value={line.noPriceCount} /> <span>with no price</span>
          </span>
        )}
        {(line.atMinimumCount ?? 0) > 0 && (
          <span className="bl-line-note">
            <Count value={line.atMinimumCount} /> <span>at the minimum</span>
          </span>
        )}
      </>
    );
  }
  if (line.key === "parking" && line.mode === "percent") {
    return (
      <span>
        <Pct bps={line.bps ?? 0} /> <span>of parking billed</span> (<Money cents={line.baseCents ?? 0} />) ·{" "}
        <Count value={line.quantity} /> <span>cars on the lot</span>
      </span>
    );
  }
  return (
    <span>
      <span data-no-translate>
        <Count value={line.quantity} /> ×{" "}
      </span>
      <Money cents={line.centsEach ?? 0} />
    </span>
  );
}

/** The bill, line by line, down to what is owed and what Laawol earned. */
function BillLines({ bill, showCommission = true }: { bill: Bill; showCommission?: boolean }) {
  return (
    <div className="bl-lines">
      {!bill.hasDeal && <p className="bl-muted bl-no-deal">No deal for this month. Only the commission counts.</p>}
      {bill.lines.map((line) => (
        <div className="bl-line" key={line.key}>
          <div className="bl-line-text">
            <strong>{CHARGE_LABELS[line.key]}</strong>
            <LineDetail line={line} />
          </div>
          <Money cents={line.cents} />
        </div>
      ))}
      {bill.flatCents > 0 && (
        <div className="bl-line">
          <div className="bl-line-text">
            <strong>Flat monthly fee</strong>
          </div>
          <Money cents={bill.flatCents} />
        </div>
      )}
      {bill.minimumAdjustmentCents > 0 && (
        <div className="bl-line bl-adjust">
          <div className="bl-line-text">
            <strong>Raised to the monthly minimum</strong>
            <span>
              <span>Monthly minimum</span> <Money cents={bill.minimumCents ?? 0} />
            </span>
          </div>
          <span data-no-translate>+{formatCents(bill.minimumAdjustmentCents, currentLanguage() === "fr" ? "fr" : "en")}</span>
        </div>
      )}
      {bill.capAdjustmentCents < 0 && (
        <div className="bl-line bl-adjust">
          <div className="bl-line-text">
            <strong>Lowered to the monthly cap</strong>
            <span>
              <span>Monthly cap</span> <Money cents={bill.capCents ?? 0} />
            </span>
          </div>
          <span data-no-translate>{formatDelta(bill.capAdjustmentCents, "cents", currentLanguage() === "fr" ? "fr" : "en")}</span>
        </div>
      )}
      <div className="bl-line bl-total">
        <strong>Owed to Laawol</strong>
        <Money cents={bill.amountCents} strong />
      </div>
      {showCommission && (
        <>
          <div className="bl-line bl-commission">
            <div className="bl-line-text">
              <strong>Commission already taken</strong>
              <span>Online payments this month</span>
            </div>
            <Money cents={bill.commissionCents} />
          </div>
          <div className="bl-line bl-earned">
            <strong>Total earned</strong>
            <Money cents={bill.earnedCents} strong />
          </div>
        </>
      )}
    </div>
  );
}

function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="lst-form-error" role="alert">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The deal form (deal editor, "Try a different deal", "Try other rates").
// ---------------------------------------------------------------------------

function MoneyField({
  label,
  value,
  onChange,
  error,
  hint,
  disabled,
  prefix = "$",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  prefix?: "$" | "%";
}) {
  return (
    <label className="lst-field bl-money-field">
      <span>{label}</span>
      <div className={`bl-affix ${prefix === "%" ? "suffix" : ""}`}>
        {prefix === "$" && <i aria-hidden="true">$</i>}
        <input
          aria-invalid={error ? true : undefined}
          disabled={disabled}
          inputMode="decimal"
          onChange={(event) => onChange(event.target.value)}
          placeholder={prefix === "%" ? "0" : "0.00"}
          value={value}
        />
        {prefix === "%" && <i aria-hidden="true">%</i>}
      </div>
      {error ? <small className="bl-field-error">{error}</small> : hint ? <small>{hint}</small> : null}
    </label>
  );
}

function DealForm({
  draft,
  onChange,
  errors,
  disabled,
}: {
  draft: DealDraft;
  onChange: (draft: DealDraft) => void;
  errors: DraftErrors;
  disabled?: boolean;
}) {
  const set = <K extends keyof DealDraft>(key: K, value: DealDraft[K]) => onChange({ ...draft, [key]: value });
  return (
    <div className="bl-deal-form">
      <fieldset className="lst-fieldset">
        <legend>Barrels received</legend>
        <label className="lst-field">
          <span>How it is charged</span>
          <select disabled={disabled} onChange={(e) => set("barrelMode", e.target.value as DealDraft["barrelMode"])} value={draft.barrelMode}>
            <option value="none">No charge</option>
            <option value="fixed">Per barrel</option>
          </select>
        </label>
        {draft.barrelMode === "fixed" && (
          <MoneyField disabled={disabled} error={errors.barrel} label="Per barrel" onChange={(v) => set("barrel", v)} value={draft.barrel} />
        )}
      </fieldset>
      <fieldset className="lst-fieldset">
        <legend>Packages received</legend>
        <label className="lst-field">
          <span>How it is charged</span>
          <select disabled={disabled} onChange={(e) => set("packageMode", e.target.value as DealDraft["packageMode"])} value={draft.packageMode}>
            <option value="none">No charge</option>
            <option value="fixed">Per package</option>
            <option value="percent">Percent of the package price</option>
          </select>
        </label>
        {draft.packageMode === "fixed" && (
          <MoneyField
            disabled={disabled}
            error={errors.packageCents}
            label="Per package"
            onChange={(v) => set("packageCents", v)}
            value={draft.packageCents}
          />
        )}
        {draft.packageMode === "percent" && (
          <div className="bl-field-pair">
            <MoneyField
              disabled={disabled}
              error={errors.packagePct}
              label="Percent of the price"
              onChange={(v) => set("packagePct", v)}
              prefix="%"
              value={draft.packagePct}
            />
            <MoneyField
              disabled={disabled}
              error={errors.packageMin}
              hint="Optional. A package with no price pays this."
              label="Minimum per package"
              onChange={(v) => set("packageMin", v)}
              value={draft.packageMin}
            />
          </div>
        )}
      </fieldset>
      <fieldset className="lst-fieldset">
        <legend>Shipped cars</legend>
        <label className="lst-field">
          <span>How it is charged</span>
          <select disabled={disabled} onChange={(e) => set("shippedCarMode", e.target.value as DealDraft["shippedCarMode"])} value={draft.shippedCarMode}>
            <option value="none">No charge</option>
            <option value="fixed">Per shipped car</option>
          </select>
        </label>
        {draft.shippedCarMode === "fixed" && (
          <MoneyField disabled={disabled} error={errors.shippedCar} label="Per car" onChange={(v) => set("shippedCar", v)} value={draft.shippedCar} />
        )}
      </fieldset>
      <fieldset className="lst-fieldset">
        <legend>Parked cars</legend>
        <label className="lst-field">
          <span>How it is charged</span>
          <select disabled={disabled} onChange={(e) => set("parkingMode", e.target.value as DealDraft["parkingMode"])} value={draft.parkingMode}>
            <option value="none">No charge</option>
            <option value="perCar">Per car on the lot in the month</option>
            <option value="percent">Percent of parking billed</option>
          </select>
        </label>
        {draft.parkingMode === "perCar" && (
          <MoneyField
            disabled={disabled}
            error={errors.parkingCents}
            hint="A car on the lot any day of the month counts once."
            label="Per car"
            onChange={(v) => set("parkingCents", v)}
            value={draft.parkingCents}
          />
        )}
        {draft.parkingMode === "percent" && (
          <MoneyField
            disabled={disabled}
            error={errors.parkingPct}
            label="Percent of parking billed"
            onChange={(v) => set("parkingPct", v)}
            prefix="%"
            value={draft.parkingPct}
          />
        )}
      </fieldset>
      <fieldset className="lst-fieldset">
        <legend>Shop items sold</legend>
        <label className="lst-field">
          <span>How it is charged</span>
          <select disabled={disabled} onChange={(e) => set("itemMode", e.target.value as DealDraft["itemMode"])} value={draft.itemMode}>
            <option value="none">No charge</option>
            <option value="fixed">Per item sold</option>
          </select>
        </label>
        {draft.itemMode === "fixed" && (
          <MoneyField disabled={disabled} error={errors.item} label="Per item" onChange={(v) => set("item", v)} value={draft.item} />
        )}
      </fieldset>
      <fieldset className="lst-fieldset">
        <legend>Every month</legend>
        <div className="bl-field-trio">
          <MoneyField disabled={disabled} error={errors.flat} hint="Optional." label="Flat monthly fee" onChange={(v) => set("flat", v)} value={draft.flat} />
          <MoneyField
            disabled={disabled}
            error={errors.minimum}
            hint="Optional. Owed even in a quiet month."
            label="Monthly minimum"
            onChange={(v) => set("minimum", v)}
            value={draft.minimum}
          />
          <MoneyField disabled={disabled} error={errors.cap} hint="Optional." label="Monthly cap" onChange={(v) => set("cap", v)} value={draft.cap} />
        </div>
        <p className="lst-hint">Charges and the flat fee are added up, raised to the minimum, then held to the cap. Commission is never counted in them.</p>
      </fieldset>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs.
// ---------------------------------------------------------------------------

function Dialog({
  title,
  subtitle,
  onClose,
  busy,
  children,
  footer,
  width = 560,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
  footer: ReactNode;
  width?: number;
}) {
  return (
    <div aria-modal="true" className="lst-modal-overlay" role="dialog" {...overlayDismiss(() => !busy && onClose())}>
      <div className="lst-modal bl-modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: width }}>
        <header className="lst-modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button aria-label="Close" className="lst-icon-btn" disabled={busy} onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <div className="lst-modal-body">{children}</div>
        <footer className="lst-modal-foot">{footer}</footer>
      </div>
    </div>
  );
}

function DealEditorDialog({
  bill,
  previewMode,
  onClose,
  onSaved,
}: {
  bill: BusinessBillResponse;
  previewMode: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const call = useBillingCall(previewMode);
  const lang = useLang();
  const current = currentVolumeMonth();
  const [draft, setDraft] = useState<DealDraft>(() => draftFromDeal(bill.deal));
  const [effectiveFrom, setEffectiveFrom] = useState(current);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<DraftErrors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const closed = new Set(bill.months.filter((m) => m.status === "closed").map((m) => m.month));
  const months = effectiveMonthOptions(current).filter((m) => !closed.has(m)).reverse();

  async function save() {
    if (busy) return;
    const { deal, errors: found } = dealFromDraft(draft);
    setErrors(found);
    if (!deal) return;
    if (note.trim().length > 300) {
      setError("Keep the note under 300 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await call({ action: "saveDeal", businessId: bill.business.id, effectiveFrom, deal, note: note.trim() });
      onSaved("Deal saved.");
      onClose();
    } catch (failure) {
      setError(refusalMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      busy={busy}
      footer={
        <>
          <button className="secondary-button" disabled={busy} onClick={onClose} type="button">
            Cancel
          </button>
          <button aria-busy={busy} className="primary-button" disabled={busy} onClick={() => void save()} type="button">
            {busy ? <RefreshCw className="spin" size={16} /> : <Pencil size={16} />} {busy ? "Saving…" : "Save the deal"}
          </button>
        </>
      }
      onClose={onClose}
      subtitle={<span data-no-translate>{bill.business.name}</span>}
      title="Change the deal"
      width={720}
    >
      <FormError message={error} />
      <div className="bl-field-pair">
        <label className="lst-field">
          <span>Starts with the month of</span>
          <select disabled={busy} onChange={(event) => setEffectiveFrom(event.target.value)} value={effectiveFrom}>
            {months.map((month) => (
              <option data-no-translate key={month} value={month}>
                {formatVolumeMonth(month, lang)}
              </option>
            ))}
          </select>
          <small>Months before keep the deal they had. A closed month never changes.</small>
        </label>
        <label className="lst-field">
          <span>Note</span>
          <input disabled={busy} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="Optional" value={note} />
        </label>
      </div>
      <DealForm disabled={busy} draft={draft} errors={errors} onChange={setDraft} />
    </Dialog>
  );
}

function RecordPaymentDialog({
  bill,
  previewMode,
  onClose,
  onSaved,
}: {
  bill: BusinessBillResponse;
  previewMode: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const call = useBillingCall(previewMode);
  const today = todayInNewYork();
  const [amount, setAmount] = useState(() => (bill.unpaidCents > 0 ? centsToInput(bill.unpaidCents) : ""));
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("zelle");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<ReturnType<typeof paymentDraftErrors>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    const found = paymentDraftErrors({ amount, paidOn, method, note }, today);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setError("");
    try {
      await call({
        action: "recordPayment",
        businessId: bill.business.id,
        month: bill.month,
        amountCents: readMoneyInput(amount).cents,
        paidOn,
        method,
        note: note.trim(),
      });
      onSaved("Payment recorded.");
      onClose();
    } catch (failure) {
      setError(refusalMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      busy={busy}
      footer={
        <>
          <button className="secondary-button" disabled={busy} onClick={onClose} type="button">
            Cancel
          </button>
          <button aria-busy={busy} className="primary-button" disabled={busy} onClick={() => void save()} type="button">
            {busy ? <RefreshCw className="spin" size={16} /> : <Plus size={16} />} {busy ? "Saving…" : "Record payment"}
          </button>
        </>
      }
      onClose={onClose}
      subtitle={
        <>
          <span data-no-translate>{bill.business.name}</span> · <MonthText month={bill.month} />
        </>
      }
      title="Record a payment"
    >
      <FormError message={error} />
      <div className="bl-field-pair">
        <MoneyField disabled={busy} error={errors.amount} label="Amount" onChange={setAmount} value={amount} />
        <label className="lst-field">
          <span>Paid on</span>
          <input
            aria-invalid={errors.paidOn ? true : undefined}
            disabled={busy}
            max={today}
            min="2020-01-01"
            onChange={(event) => setPaidOn(event.target.value)}
            type="date"
            value={paidOn}
          />
          {errors.paidOn && <small className="bl-field-error">{errors.paidOn}</small>}
        </label>
        <label className="lst-field">
          <span>Payment method</span>
          <select disabled={busy} onChange={(event) => setMethod(event.target.value)} value={method}>
            {PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {paymentMethodLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="lst-field">
          <span>Note</span>
          <input disabled={busy} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="Optional" value={note} />
          {errors.note && <small className="bl-field-error">{errors.note}</small>}
        </label>
      </div>
      <p className="lst-hint">
        <span>Still owed for this month:</span> <Money cents={bill.unpaidCents} />
      </p>
    </Dialog>
  );
}

function ReopenDialog({
  bill,
  previewMode,
  onClose,
  onSaved,
}: {
  bill: BusinessBillResponse;
  previewMode: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const call = useBillingCall(previewMode);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function reopen() {
    if (busy) return;
    if (!reason.trim()) {
      setError("Say why.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await call({ action: "reopenMonth", businessId: bill.business.id, month: bill.month, reason: reason.trim() });
      onSaved("Month reopened. The bill is live again.");
      onClose();
    } catch (failure) {
      setError(refusalMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      busy={busy}
      footer={
        <>
          <button className="secondary-button" disabled={busy} onClick={onClose} type="button">
            Keep it closed
          </button>
          <button aria-busy={busy} className="primary-button warning" disabled={busy} onClick={() => void reopen()} type="button">
            {busy ? <RefreshCw className="spin" size={16} /> : <LockOpen size={16} />} {busy ? "Reopening…" : "Reopen the month"}
          </button>
        </>
      }
      onClose={onClose}
      subtitle={
        <>
          <span data-no-translate>{bill.business.name}</span> · <MonthText month={bill.month} />
        </>
      }
      title="Reopen this month?"
    >
      <FormError message={error} />
      <p className="lst-hint">
        <span>The closed amount</span> (<Money cents={bill.amountCents} />){" "}
        <span>stays in the history. The bill becomes live again until the month is closed again.</span>
      </p>
      <label className="lst-field">
        <span>Reason</span>
        <input disabled={busy} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="What was wrong" value={reason} />
      </label>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// One business.
// ---------------------------------------------------------------------------

function DriftNote({ bill }: { bill: BusinessBillResponse }) {
  const lang = useLang();
  if (!bill.drift?.changed) return null;
  return (
    <div className="bl-drift" role="status">
      <AlertTriangle size={16} />
      <div>
        <strong>The records changed since this month was closed.</strong>
        <ul>
          {bill.drift.items.map((item) => (
            <li key={item.key}>
              <span>{DRIFT_LABELS[item.key]}</span> <b data-no-translate>{formatDelta(item.delta, item.kind, lang)}</b>{" "}
              <span>since you closed</span>
            </li>
          ))}
        </ul>
        <p>
          <span>Worked out today, the bill would be</span> <Money cents={bill.drift.amountNowCents} />{" "}
          <span data-no-translate>({formatDelta(bill.drift.amountDeltaCents, "cents", lang)})</span>.{" "}
          <span>The closed amount is what is owed.</span>
        </p>
      </div>
    </div>
  );
}

function TryDeal({ bill, previewMode }: { bill: BusinessBillResponse; previewMode: boolean }) {
  const call = useBillingCall(previewMode);
  const [draft, setDraft] = useState<DealDraft>(() => draftFromDeal(bill.deal));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [result, setResult] = useState<WhatIfOneResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function calculate() {
    if (busy) return;
    const { deal, errors: found } = dealFromDraft(draft);
    setErrors(found);
    if (!deal) return;
    setBusy(true);
    setError("");
    try {
      setResult(await call<WhatIfOneResponse>({ action: "whatIf", businessId: bill.business.id, month: bill.month, deal }));
    } catch (failure) {
      setError(refusalMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel bl-panel">
      <div className="panel-header">
        <div>
          <Calculator size={18} />
          <h2>Try a different deal</h2>
        </div>
      </div>
      <div className="bl-panel-body">
        <p className="lst-hint">Starts from this business&apos;s deal. Change anything, then calculate: nothing is saved.</p>
        <DealForm disabled={busy} draft={draft} errors={errors} onChange={setDraft} />
        <FormError message={error} />
        <div className="bl-actions">
          <button className="secondary-button" disabled={busy} onClick={() => setDraft(draftFromDeal(bill.deal))} type="button">
            Start from the current deal
          </button>
          <button aria-busy={busy} className="primary-button" disabled={busy} onClick={() => void calculate()} type="button">
            {busy ? <RefreshCw className="spin" size={16} /> : <Calculator size={16} />} {busy ? "Calculating…" : "Calculate"}
          </button>
        </div>
        {result && result.month === bill.month && (
          <div className="bl-compare" role="status">
            <div>
              <span>With the current deal</span>
              <Money cents={result.now.amountCents} strong />
            </div>
            <div>
              <span>With this deal</span>
              <Money cents={result.alt.amountCents} strong />
            </div>
            <div className={result.deltaCents > 0 ? "up" : result.deltaCents < 0 ? "down" : ""}>
              <span>Difference</span>
              <b data-no-translate>{formatDelta(result.deltaCents, "cents", currentLanguage() === "fr" ? "fr" : "en")}</b>
            </div>
          </div>
        )}
        {result && result.month === bill.month && <BillLines bill={result.alt} showCommission={false} />}
      </div>
    </section>
  );
}

function BusinessBill({
  businessId,
  month,
  previewMode,
  onBack,
  onMonth,
}: {
  businessId: string;
  month: string;
  previewMode: boolean;
  onBack: () => void;
  onMonth: (month: string) => void;
}) {
  const lang = useLang();
  const call = useBillingCall(previewMode);
  const [reload, setReload] = useState(0);
  const read = useBillingRead<BusinessBillResponse>(previewMode, { action: "getBusinessBill", businessId, month }, reload);
  const bill = read.data && read.data.month === month && read.data.business.id === businessId ? read.data : null;
  const [dialog, setDialog] = useState<"" | "deal" | "payment" | "reopen">("");
  const [flash, setFlash] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState("");
  const canManage = Boolean(bill?.canManage);
  const current = currentVolumeMonth();
  const name = (uid: string) => (uid ? bill?.people[uid] || uid : "");

  const done = useCallback((message: string) => {
    setFlash(message);
    setActionError("");
    setReload((value) => value + 1);
  }, []);

  async function run(key: string, data: Record<string, unknown>, message: string) {
    if (busy) return;
    setBusy(key);
    setActionError("");
    setFlash("");
    try {
      await call(data);
      done(message);
    } catch (failure) {
      setActionError(refusalMessage(failure));
    } finally {
      setBusy("");
    }
  }

  async function closeMonth() {
    if (!bill) return;
    const amount = formatCents(bill.liveBill.amountCents, "en");
    const amountFr = formatCents(bill.liveBill.amountCents, "fr");
    const ok = await confirmImportantAction(
      `Close ${formatVolumeMonth(month, "en")} for this business? The bill is frozen at ${amount}. Later changes to the records show as a note; the amount stays.`,
      `Clôturer ${formatVolumeMonth(month, "fr")} pour cette entreprise ? Le montant est figé à ${amountFr}. Les changements ultérieurs s’affichent en note ; le montant reste dû tel quel.`,
    );
    if (ok) await run("close", { action: "closeMonth", businessId, month }, "Month closed.");
  }

  async function voidPayment(paymentId: string, amountCents: number) {
    const ok = await confirmImportantAction(
      `Void this payment of ${formatCents(amountCents, "en")}? It stays in the list, struck through.`,
      `Annuler ce paiement de ${formatCents(amountCents, "fr")} ? Il reste dans la liste, barré.`,
    );
    if (ok) await run(`void-${paymentId}`, { action: "voidPayment", businessId, paymentId }, "Payment voided.");
  }

  async function setMode(mode: "keep" | "replace") {
    if (!bill || bill.commissionMode === mode) return;
    const ok = await confirmImportantAction(
      mode === "replace"
        ? `Let the deal replace the online-payment commission for this business? Its platform fee becomes 0% from now on (the previous rate is kept and comes back if you switch back).`
        : `Bring the online-payment commission back for this business? Its previous platform fee is restored.`,
      mode === "replace"
        ? `Le contrat remplace la commission sur les paiements en ligne pour cette entreprise ? Ses frais de plateforme passent à 0 % dès maintenant (l’ancien taux est conservé et revient si vous changez d’avis).`
        : `Rétablir la commission sur les paiements en ligne pour cette entreprise ? Ses anciens frais de plateforme sont restaurés.`,
    );
    if (ok) {
      await run(
        `mode-${mode}`,
        { action: "setCommissionMode", businessId, mode },
        mode === "replace" ? "The deal now replaces the commission." : "The commission is back alongside the deal.",
      );
    }
  }

  return (
    <div className="stack bl-page">
      <section className="vol-topbar">
        <div className="vol-topbar-title">
          <button className="vol-back" onClick={onBack} type="button">
            <ChevronLeft size={15} /> <span>All businesses</span>
          </button>
          <h2 data-no-translate>{bill?.business.name || businessId}</h2>
          <p className="bl-title-pills">
            {bill && <StatusPill status={bill.status} />}
            {bill && <StandingPill status={bill.standing.status} />}
            {bill?.commissionMode === "replace" && <span className="status-pill compact warn">Deal replaces commission</span>}
          </p>
        </div>
        <div className="vol-topbar-actions">
          <MonthPicker month={month} onChange={onMonth} />
        </div>
      </section>
      {!previewMode && (
        <BillsStatus computedAtMs={bill?.computedAtMs} error={read.error} loading={read.loading} onRefresh={read.refresh} />
      )}
      {flash && (
        <p className="bl-flash" role="status">
          {flash}
        </p>
      )}
      {actionError && (
        <div className="lst-form-error" role="alert">
          {actionError}
        </div>
      )}
      {bill && !bill.complete && <p className="bl-warning">Some records are still being counted. Refresh in a moment before closing this month.</p>}
      {bill && <DriftNote bill={bill} />}
      {bill && bill.pastOpenMonths.length > 0 && (
        <p className="bl-warning">
          <span>Past months not closed yet:</span>{" "}
          {bill.pastOpenMonths.map((m, index) => (
            <span key={m}>
              {index > 0 && ", "}
              <button className="bl-link" onClick={() => onMonth(m)} type="button">
                <MonthText month={m} />
              </button>
            </span>
          ))}
          . <span>They count toward unpaid only once closed.</span>
        </p>
      )}
      {!bill && !read.loading && !read.error && <div className="empty-state">Nothing to show for this business.</div>}
      {bill && (
        <div className="bl-grid">
          <div className="bl-col">
            <section className="panel bl-panel">
              <div className="panel-header">
                <div>
                  <Receipt size={18} />
                  <h2>
                    <span>Bill for</span> <MonthText month={month} />
                  </h2>
                </div>
              </div>
              <div className="bl-panel-body">
                <BillLines bill={bill.bill} />
                <div className="bl-paid-summary">
                  <div>
                    <span>Paid</span>
                    <Money cents={bill.paidCents} strong />
                  </div>
                  <div>
                    <span>{bill.standing.status === "overpaid" ? "Overpaid" : "Still owed"}</span>
                    <Money cents={bill.standing.status === "overpaid" ? bill.standing.overpaidCents : bill.unpaidCents} strong />
                  </div>
                </div>
                {bill.status === "closed" && bill.closed && (
                  <p className="bl-muted">
                    <Lock size={13} /> <span>Closed</span>{" "}
                    <span data-no-translate>{bill.closed.closedAtMs ? formatDateTime(bill.closed.closedAtMs) : ""}</span>
                    {bill.closed.closedBy && (
                      <>
                        {" "}
                        <span>by</span> <span data-no-translate>{name(bill.closed.closedBy)}</span>
                      </>
                    )}
                    . <span>The amount is final.</span>
                  </p>
                )}
                {bill.status === "open" && !monthIsOver(month, current) && (
                  <p className="bl-muted">This month is still running: the bill is live.</p>
                )}
                {bill.reopenHistory.length > 0 && (
                  <ul className="bl-history-list">
                    {bill.reopenHistory.map((entry) => (
                      <li key={entry.reopenedAtMs}>
                        <span>Reopened</span> <span data-no-translate>{formatDateTime(entry.reopenedAtMs)}</span> <span>by</span>{" "}
                        <span data-no-translate>{name(entry.reopenedBy)}</span> · <span>Closed amount</span>{" "}
                        <Money cents={entry.closedAmountCents} /> · <span data-no-translate>{entry.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {canManage && (
                  <div className="bl-actions">
                    {bill.status === "open" && monthIsOver(month, current) && (
                      <button
                        aria-busy={busy === "close"}
                        className="primary-button"
                        disabled={Boolean(busy) || !bill.complete}
                        onClick={() => void closeMonth()}
                        type="button"
                      >
                        {busy === "close" ? <RefreshCw className="spin" size={16} /> : <Lock size={16} />}{" "}
                        {busy === "close" ? "Closing…" : "Close month"}
                      </button>
                    )}
                    {bill.status === "closed" && (
                      <button className="secondary-button" disabled={Boolean(busy)} onClick={() => setDialog("reopen")} type="button">
                        <LockOpen size={16} /> Reopen
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="panel bl-panel">
              <div className="panel-header">
                <div>
                  <Receipt size={18} />
                  <h2>Payments</h2>
                </div>
                {canManage && (
                  <button className="secondary-button compact" disabled={Boolean(busy)} onClick={() => setDialog("payment")} type="button">
                    <Plus size={15} /> Record payment
                  </button>
                )}
              </div>
              <div className="bl-panel-body">
                {bill.payments.length === 0 ? (
                  <p className="bl-muted">No payment recorded for this month.</p>
                ) : (
                  <ul className="bl-payments">
                    {bill.payments.map((payment) => (
                      <li className={payment.voided ? "voided" : ""} key={payment.id}>
                        <div className="bl-payment-main">
                          <Money cents={payment.amountCents} strong />
                          <span>{paymentMethodLabel(payment.method)}</span>
                          <span data-no-translate>{formatDayKey(payment.paidOn, lang)}</span>
                          {payment.voided && <span className="status-pill compact muted">Voided</span>}
                        </div>
                        {payment.note && (
                          <div className="bl-payment-note" data-no-translate>
                            {payment.note}
                          </div>
                        )}
                        <div className="bl-payment-meta">
                          <span>Recorded by</span> <span data-no-translate>{name(payment.recordedBy)}</span>
                          {payment.voided && (
                            <>
                              {" · "}
                              <span>Voided by</span> <span data-no-translate>{name(payment.voidedBy)}</span>
                              {payment.voidReason && <span data-no-translate>: {payment.voidReason}</span>}
                            </>
                          )}
                        </div>
                        {canManage && !payment.voided && (
                          <button
                            aria-busy={busy === `void-${payment.id}`}
                            className="ghost-button compact bl-void"
                            disabled={Boolean(busy)}
                            onClick={() => void voidPayment(payment.id, payment.amountCents)}
                            type="button"
                          >
                            <Undo2 size={14} /> {busy === `void-${payment.id}` ? "Voiding…" : "Void"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>

          <div className="bl-col">
            <section className="panel bl-panel">
              <div className="panel-header">
                <div>
                  <Pencil size={18} />
                  <h2>Deal</h2>
                </div>
                {canManage && (
                  <button className="secondary-button compact" disabled={Boolean(busy)} onClick={() => setDialog("deal")} type="button">
                    <Pencil size={15} /> Change the deal
                  </button>
                )}
              </div>
              <div className="bl-panel-body">
                <DealSummary deal={bill.deal} empty="No deal for this month." />
                {bill.effectiveFrom && (
                  <p className="bl-muted">
                    <span>In effect since</span> <MonthText month={bill.effectiveFrom} />
                  </p>
                )}
                <div className="bl-commission-mode">
                  <h3>Online-payment commission</h3>
                  <p className="bl-muted">
                    {bill.commissionMode === "replace" ? (
                      <span>The deal replaces the commission: this business&apos;s platform fee is 0%.</span>
                    ) : (
                      <span>The commission is kept alongside the deal.</span>
                    )}
                  </p>
                  {canManage && (
                    <div className="bl-segmented" role="group">
                      <button
                        aria-pressed={bill.commissionMode === "keep"}
                        className={bill.commissionMode === "keep" ? "active" : ""}
                        disabled={Boolean(busy)}
                        onClick={() => void setMode("keep")}
                        type="button"
                      >
                        Keep the commission
                      </button>
                      <button
                        aria-pressed={bill.commissionMode === "replace"}
                        className={bill.commissionMode === "replace" ? "active" : ""}
                        disabled={Boolean(busy)}
                        onClick={() => void setMode("replace")}
                        type="button"
                      >
                        The deal replaces it
                      </button>
                    </div>
                  )}
                </div>
                <details className="bl-versions">
                  <summary>
                    <History size={14} /> <span>Deal history</span>
                    <span className="bl-muted" data-no-translate>
                      ({bill.versions.length})
                    </span>
                  </summary>
                  {bill.versions.length === 0 ? (
                    <p className="bl-muted">No deal recorded yet.</p>
                  ) : (
                    <ol>
                      {bill.versions.map((v) => (
                        <li key={v.id}>
                          <div className="bl-version-head">
                            <span>In effect from</span> <MonthText month={v.effectiveFrom} />
                            <span className="bl-muted">
                              {" · "}
                              <span>Saved</span> <span data-no-translate>{formatDateTime(v.createdAtMs)}</span> <span>by</span>{" "}
                              <span data-no-translate>{name(v.createdBy)}</span>
                            </span>
                          </div>
                          <DealSummary deal={v.deal} empty="No charges: nothing owed from this month." />
                          {v.note && (
                            <p className="bl-payment-note" data-no-translate>
                              {v.note}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </details>
              </div>
            </section>

            <TryDeal bill={bill} key={`${bill.business.id}-${bill.month}-${bill.dealVersionId}`} previewMode={previewMode} />

            <section className="panel bl-panel">
              <div className="panel-header">
                <div>
                  <History size={18} />
                  <h2>Month by month</h2>
                </div>
              </div>
              <div className="bl-panel-body">
                <p>
                  <span>Unpaid to date (closed months):</span> <Money cents={bill.unpaidToDateCents} strong />
                </p>
                {bill.months.length === 0 ? (
                  <p className="bl-muted">No month closed or paid yet.</p>
                ) : (
                  <ul className="bl-months">
                    {bill.months.map((m) => (
                      <li key={m.month}>
                        <button className="bl-link" onClick={() => onMonth(m.month)} type="button">
                          <MonthText month={m.month} />
                        </button>
                        <StatusPill status={m.status} />
                        <span className="bl-months-figures">
                          {m.amountCents !== null && (
                            <>
                              <span>Owed</span> <Money cents={m.amountCents} />{" "}
                            </>
                          )}
                          <span>Paid</span> <Money cents={m.paidCents} />
                          {m.status === "closed" && m.unpaidCents > 0 && (
                            <>
                              {" "}
                              <span>Still owed</span> <Money cents={m.unpaidCents} />
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
      {bill && dialog === "deal" && <DealEditorDialog bill={bill} onClose={() => setDialog("")} onSaved={done} previewMode={previewMode} />}
      {bill && dialog === "payment" && (
        <RecordPaymentDialog bill={bill} onClose={() => setDialog("")} onSaved={done} previewMode={previewMode} />
      )}
      {bill && dialog === "reopen" && <ReopenDialog bill={bill} onClose={() => setDialog("")} onSaved={done} previewMode={previewMode} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Try other rates, for every business at once.
// ---------------------------------------------------------------------------

function TryRatesForAll({ month, previewMode, onBack, onMonth }: { month: string; previewMode: boolean; onBack: () => void; onMonth: (month: string) => void }) {
  const call = useBillingCall(previewMode);
  const [draft, setDraft] = useState<DealDraft>(() => emptyDealDraft());
  const [errors, setErrors] = useState<DraftErrors>({});
  const [result, setResult] = useState<WhatIfAllResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function calculate(cursor = 0) {
    if (busy) return;
    const { deal, errors: found } = dealFromDraft(draft);
    setErrors(found);
    if (!deal) return;
    setBusy(true);
    setError("");
    try {
      const answer = await call<WhatIfAllResponse>({ action: "whatIf", month, deal, cursor });
      setResult((prev) =>
        cursor > 0 && prev
          ? {
              ...answer,
              rows: [...prev.rows, ...answer.rows],
              totals: {
                nowCents: prev.totals.nowCents + answer.totals.nowCents,
                altCents: prev.totals.altCents + answer.totals.altCents,
                deltaCents: prev.totals.deltaCents + answer.totals.deltaCents,
                commissionCents: prev.totals.commissionCents + answer.totals.commissionCents,
                businesses: prev.totals.businesses + answer.totals.businesses,
              },
            }
          : answer,
      );
    } catch (failure) {
      setError(refusalMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  const lang = useLang();
  const rows = result && result.month === month ? result.rows : [];
  return (
    <div className="stack bl-page">
      <section className="vol-topbar">
        <div className="vol-topbar-title">
          <button className="vol-back" onClick={onBack} type="button">
            <ChevronLeft size={15} /> <span>All businesses</span>
          </button>
          <h2>Try other rates</h2>
          <p>One rate card on every business with a deal or activity this month. Nothing is saved.</p>
        </div>
        <div className="vol-topbar-actions">
          <MonthPicker month={month} onChange={onMonth} />
        </div>
      </section>
      <section className="panel bl-panel">
        <div className="panel-header">
          <div>
            <Calculator size={18} />
            <h2>Rate card</h2>
          </div>
        </div>
        <div className="bl-panel-body">
          <DealForm disabled={busy} draft={draft} errors={errors} onChange={setDraft} />
          <FormError message={error} />
          <div className="bl-actions">
            <button aria-busy={busy} className="primary-button" disabled={busy} onClick={() => void calculate()} type="button">
              {busy ? <RefreshCw className="spin" size={16} /> : <Calculator size={16} />} {busy ? "Calculating…" : "Calculate"}
            </button>
          </div>
        </div>
      </section>
      {result && result.month === month && (
        <section className="panel bl-panel">
          <div className="panel-header">
            <div>
              <Receipt size={18} />
              <h2>
                <span>With this rate card in</span> <MonthText month={month} />
              </h2>
            </div>
          </div>
          <div className="bl-compare bl-compare-wide" role="status">
            <div>
              <span>With the current deal</span>
              <Money cents={result.totals.nowCents} strong />
            </div>
            <div>
              <span>With this rate card</span>
              <Money cents={result.totals.altCents} strong />
            </div>
            <div className={result.totals.deltaCents > 0 ? "up" : result.totals.deltaCents < 0 ? "down" : ""}>
              <span>Difference</span>
              <b data-no-translate>{formatDelta(result.totals.deltaCents, "cents", lang)}</b>
            </div>
          </div>
          {rows.length === 0 ? (
            <div className="empty-state">No business had a deal or activity this month.</div>
          ) : (
            <div className="vol-table-scroll">
              <table className="commission-table vol-table bl-table">
                <thead>
                  <tr>
                    <th scope="col">Business</th>
                    <th scope="col">With the current deal</th>
                    <th scope="col">With this rate card</th>
                    <th scope="col">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.businessId}>
                      <th scope="row">
                        <span data-no-translate>{row.name}</span>
                        {!row.hasDeal && <small className="bl-muted bl-cell-note">No deal yet</small>}
                      </th>
                      <td>
                        <Money cents={row.nowCents} />
                      </td>
                      <td>
                        <Money cents={row.altCents} strong />
                      </td>
                      <td data-no-translate>{formatDelta(row.deltaCents, "cents", lang)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Total</th>
                    <td>
                      <Money cents={result.totals.nowCents} />
                    </td>
                    <td>
                      <Money cents={result.totals.altCents} />
                    </td>
                    <td data-no-translate>{formatDelta(result.totals.deltaCents, "cents", lang)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {result.nextCursor !== null && (
            <div className="bl-actions bl-more">
              <span className="bl-muted">
                <span>Showing</span> <Count value={rows.length} /> <span>of</span> <Count value={result.candidates} />{" "}
                <span>businesses.</span>
              </span>
              <button className="secondary-button" disabled={busy} onClick={() => void calculate(result.nextCursor ?? 0)} type="button">
                Show more
              </button>
            </div>
          )}
          {!result.complete && <p className="bl-warning">Some records are still being counted. Calculate again in a moment.</p>}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The month, every business.
// ---------------------------------------------------------------------------

function Tile({ label, cents, note }: { label: string; cents: number | null; note?: ReactNode }) {
  const lang = useLang();
  return (
    <article className="metric neutral bl-tile">
      <span>{label}</span>
      <strong className="bl-figure" data-no-translate>
        {cents === null ? "—" : formatCents(cents, lang)}
      </strong>
      {note && <small>{note}</small>}
    </article>
  );
}

function MonthTable({ rows, onPick }: { rows: MonthRow[]; onPick: (businessId: string) => void }) {
  return (
    <div className="vol-table-scroll">
      <table className="commission-table vol-table bl-table">
        <thead>
          <tr>
            <th scope="col">Business</th>
            <th className="bl-deal-head" scope="col">
              Deal
            </th>
            <th scope="col">Barrels</th>
            <th scope="col">Packages</th>
            <th scope="col">Cars</th>
            <th scope="col">Owed</th>
            <th scope="col">Paid</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.businessId} onClick={() => onPick(row.businessId)}>
              <th scope="row">
                <button
                  className="vol-row-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onPick(row.businessId);
                  }}
                  title="Open this business's bill"
                  type="button"
                >
                  <span data-no-translate>{row.name}</span>
                </button>
              </th>
              <td className="bl-deal-cell">
                <DealSummary deal={row.hasDeal ? row.deal : null} />
              </td>
              <td>
                <Count value={row.counts.barrels} />
              </td>
              <td>
                <Count value={row.counts.packages} />
              </td>
              <td>
                <Count value={row.counts.cars} />
              </td>
              <td>
                <Money cents={row.amountCents} strong />
              </td>
              <td>
                <Money cents={row.paidCents} />
              </td>
              <td className="bl-status-cell">
                <div className="bl-status-stack">
                  <StatusPill status={row.status} />
                  {row.amountCents > 0 || row.paidCents > 0 ? <StandingPill status={row.standing} /> : null}
                  {row.drift?.changed && (
                    <span className="status-pill compact warn" title="The records changed since this month was closed">
                      <AlertTriangle size={11} /> Changed since closed
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Admin console → Bills. The page keeps its own state (month, which business,
 * the rate calculator); the admin console keeps its tab in memory, so a
 * reload starts on Today either way.
 */
export function AdminBillsView({ previewMode }: { previewMode: boolean }) {
  const lang = useLang();
  const [month, setMonth] = useState(() => currentVolumeMonth());
  const [businessId, setBusinessId] = useState("");
  const [view, setView] = useState<"month" | "business" | "rates">("month");
  const [reload, setReload] = useState(0);
  const [more, setMore] = useState<{ month: string; rows: MonthRow[]; nextCursor: number | null } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState("");
  const call = useBillingCall(previewMode);
  const read = useBillingRead<MonthBillsResponse>(previewMode, view === "month" ? { action: "getMonthBills", month } : null, reload);
  const data = read.data && read.data.month === month ? read.data : null;
  const rows = useMemo(() => [...(data?.rows ?? []), ...(more && more.month === month ? more.rows : [])], [data, more, month]);
  const nextCursor = more && more.month === month ? more.nextCursor : (data?.nextCursor ?? null);

  function pick(id: string) {
    setBusinessId(id);
    setView("business");
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }

  function back() {
    setView("month");
    setReload((value) => value + 1);
    setMore(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }

  async function loadMore() {
    if (moreBusy || nextCursor === null) return;
    setMoreBusy(true);
    setMoreError("");
    try {
      const answer = await call<MonthBillsResponse>({ action: "getMonthBills", month, cursor: nextCursor });
      setMore((prev) => ({ month, rows: [...(prev && prev.month === month ? prev.rows : []), ...answer.rows], nextCursor: answer.nextCursor }));
    } catch (failure) {
      setMoreError(refusalMessage(failure));
    } finally {
      setMoreBusy(false);
    }
  }

  if (view === "business" && businessId) {
    return <BusinessBill businessId={businessId} month={month} onBack={back} onMonth={setMonth} previewMode={previewMode} />;
  }
  if (view === "rates") {
    return <TryRatesForAll month={month} onBack={back} onMonth={setMonth} previewMode={previewMode} />;
  }
  const summary = data?.summary ?? null;
  return (
    <div className="stack bl-page">
      <section className="vol-topbar">
        <div className="vol-topbar-title">
          <h2>Bills</h2>
          <p>What each business owes Laawol for the month under its own deal. Counted in the month received (New York time).</p>
        </div>
        <div className="vol-topbar-actions">
          <MonthPicker
            month={month}
            onChange={(next) => {
              setMonth(next);
              setMore(null);
            }}
          />
          <button className="secondary-button" onClick={() => setView("rates")} type="button">
            <Calculator size={15} /> Try other rates
          </button>
        </div>
      </section>
      {!previewMode && <BillsStatus computedAtMs={data?.computedAtMs} error={read.error} loading={read.loading} onRefresh={read.refresh} />}
      <div className="metric-grid bl-tiles">
        <Tile
          cents={summary ? summary.owedCents : null}
          label="Owed this month"
          note={
            summary ? (
              <>
                <Count value={summary.withDeal} /> <span>with a deal</span>
              </>
            ) : undefined
          }
        />
        <Tile cents={summary ? summary.paidCents : null} label="Paid this month" />
        <Tile cents={summary ? summary.unpaidToDateCents : null} label="Unpaid to date" note={summary ? <span>closed months</span> : undefined} />
        <Tile
          cents={summary ? summary.commissionCents : null}
          label="Commission taken"
          note={summary ? <span>online payments, this month</span> : undefined}
        />
      </div>
      {summary?.partial && <p className="bl-warning">Not every business is counted yet. Show more below, or refresh in a moment.</p>}
      <section className="panel">
        <div className="panel-header">
          <div>
            <Receipt size={18} />
            <h2>
              <span>Businesses in</span> <MonthText month={month} />
            </h2>
          </div>
        </div>
        {rows.length === 0 ? (
          !read.loading && (
            <div className="empty-state">
              <span>No business had a deal or activity in</span> <MonthText month={month} />
            </div>
          )
        ) : (
          <>
            <p className="vol-note vol-table-hint">Choose a business to see its bill, payments and deal.</p>
            <MonthTable onPick={pick} rows={rows} />
          </>
        )}
        {nextCursor !== null && (
          <div className="bl-actions bl-more">
            <span className="bl-muted">
              <span>Showing</span> <Count value={rows.length} /> <span>of</span> <Count value={data?.summary.candidates ?? rows.length} />{" "}
              <span>businesses.</span>
            </span>
            <button aria-busy={moreBusy} className="secondary-button" disabled={moreBusy} onClick={() => void loadMore()} type="button">
              {moreBusy ? "Loading…" : "Show more"}
            </button>
            {moreError && (
              <span className="totals-status-error" role="alert">
                {moreError}
              </span>
            )}
          </div>
        )}
      </section>
      <p className="vol-note">
        <span>Total earned this month (owed + commission):</span>{" "}
        <b data-no-translate>{summary ? formatCents(summary.earnedCents, lang) : "—"}</b>
      </p>
    </div>
  );
}
