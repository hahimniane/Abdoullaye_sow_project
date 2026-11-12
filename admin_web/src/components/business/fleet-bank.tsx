"use client";

// Fleet phase 1b (docs/FLEET.md §8): the pay-day bank-check schedule with its
// monthly cost (Fleet settings), and the Zelle deposits that wait for the
// office to pick a driver (Fleet payments). Deposits Laawol recognizes pay
// their driver by themselves on the server.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, RefreshCw } from "lucide-react";

import { Panel } from "@/components/panel";
import { formatDateTime, formatDayKey } from "@/lib/format";
import { fleetErrorMessage } from "@/lib/fleet";
import {
  BANK_REFRESH_EVERY,
  bankScheduleQuote,
  cleanBankSchedule,
  hourLabel,
  readFleetBankStatus,
  waitingReasonText,
  type BankSchedule,
  type FleetBankStatus,
} from "@/lib/fleet-bank";
import { moneyText } from "@/lib/invoice-ledger";

import { callFleet, type FleetState } from "./fleet-data";
import { fleetLang, SaveButton, useFleetRun } from "./fleet-ui";

const STATUS_TIMEOUT_MS = 20_000;

/** bank_status, with a load that always ends (answer, error or timeout). */
function useFleetBank(businessId: string) {
  const [status, setStatus] = useState<FleetBankStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    let timer = 0;
    setLoading(true);
    setError("");
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error("The bank details took too long to load. Try again.")), STATUS_TIMEOUT_MS);
    });
    Promise.race([callFleet("bank_status", businessId), timeout])
      .then((answer) => {
        if (live) setStatus(readFleetBankStatus(answer));
      })
      .catch((failure) => {
        if (live) setError(fleetErrorMessage(failure));
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [businessId, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { status, error, loading, reload };
}

const HOURS_FROM = Array.from({ length: 24 }, (_, i) => i);
const HOURS_TO = Array.from({ length: 24 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/** Fleet settings: how often Laawol asks the bank on pay days, and what it costs. */
export function FleetBankSchedule({ businessId }: { businessId: string }) {
  const lang = fleetLang();
  const { status, error: loadError, loading, reload } = useFleetBank(businessId);
  const [draft, setDraft] = useState<BankSchedule | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useFleetRun(businessId);
  useEffect(() => {
    if (status && !draft) setDraft(status.schedule.monthDays.length ? status.schedule : { ...status.schedule, monthDays: [1, 2, 3] });
  }, [status, draft]);
  const schedule = draft ?? cleanBankSchedule({ monthDays: [1, 2, 3] });
  const quote = useMemo(() => bankScheduleQuote(schedule, status?.quote.centsEach), [schedule, status?.quote.centsEach]);
  const set = (patch: Partial<BankSchedule>) => {
    setSaved(false);
    setDraft(cleanBankSchedule({ ...schedule, ...patch }));
  };
  const toggleDay = (day: number) =>
    set({ monthDays: schedule.monthDays.includes(day) ? schedule.monthDays.filter((d) => d !== day) : [...schedule.monthDays, day] });

  async function save() {
    const result = await run(
      "bank_schedule_save",
      { schedule },
      schedule.every > 0
        ? {
            en: `Check the bank every ${schedule.every} minutes on pay days? About ${quote.perMonth} checks a month, about ${moneyText(quote.monthCents, "en")} a month on your Laawol bill.`,
            fr: `Vérifier la banque toutes les ${schedule.every} minutes les jours de paiement ? Environ ${quote.perMonth} vérifications par mois, environ ${moneyText(quote.monthCents, "fr")} par mois sur votre facture Laawol.`,
          }
        : {
            en: "Turn the pay-day bank checks off? Deposits still pay drivers when the bank updates on its own, a few times a day, at no cost.",
            fr: "Désactiver les vérifications de banque les jours de paiement ? Les dépôts paient toujours les chauffeurs quand la banque se met à jour d’elle-même, quelques fois par jour, sans frais.",
          },
    );
    if (result) {
      setSaved(true);
      reload();
    }
  }

  return (
    <Panel title="Pay-day bank checks" icon={<Landmark size={18} />}>
      <p className="lst-hint">
        Zelle deposits pay drivers&apos; bills by themselves when Laawol recognizes the driver. The bank tells Laawol about new deposits a few times a day for free. On pay days you can have Laawol ask the bank more often, so payments show up within minutes. Each ask is a paid bank check.
      </p>
      {(loadError || error) && <div className="lst-form-error" role="alert">{loadError || error}</div>}
      {loading && !status && <p className="lst-hint" role="status"><RefreshCw className="spin" size={12} aria-hidden="true" /> Loading…</p>}
      {status && !status.bank.connected && (
        <p className="lst-hint" role="status">Connect the business&apos;s bank first (Profile, Bank for Zelle checks).</p>
      )}
      {status && (
        <>
          <div className="lst-form-grid">
            <label className="lst-field">
              <span>How often on pay days</span>
              <select disabled={busy} value={schedule.every} onChange={(e) => set({ every: Number(e.target.value) })}>
                {BANK_REFRESH_EVERY.map((m) => (
                  <option key={m} value={m}>{m === 0 ? "Off: only when the bank updates" : m === 60 ? "Every hour" : `Every ${m} minutes`}</option>
                ))}
              </select>
            </label>
            <label className="lst-field">
              <span>From</span>
              <select disabled={busy || schedule.every === 0} value={schedule.fromHour} onChange={(e) => set({ fromHour: Number(e.target.value) })}>
                {HOURS_FROM.map((h) => <option key={h} value={h} data-no-translate>{hourLabel(h, lang)}</option>)}
              </select>
            </label>
            <label className="lst-field">
              <span>Until</span>
              <select disabled={busy || schedule.every === 0} value={schedule.toHour} onChange={(e) => set({ toHour: Number(e.target.value) })}>
                {HOURS_TO.map((h) => <option key={h} value={h} data-no-translate>{hourLabel(h, lang)}</option>)}
              </select>
            </label>
          </div>
          <fieldset className="fleet-bank-days" disabled={busy || schedule.every === 0}>
            <legend>Pay days (day of the month)</legend>
            <div className="fleet-bank-day-grid">
              {DAYS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`fleet-bank-day${schedule.monthDays.includes(d) ? " on" : ""}`}
                  aria-pressed={schedule.monthDays.includes(d)}
                  onClick={() => toggleDay(d)}
                  data-no-translate
                >
                  {d}
                </button>
              ))}
            </div>
            <label className="lst-check">
              <input type="checkbox" checked={schedule.mondays} onChange={(e) => set({ mondays: e.target.checked })} />
              <span>Also every Monday (weekly drivers)</span>
            </label>
          </fieldset>
          <div className={`fleet-bank-quote${quote.perMonth > 0 ? "" : " off"}`} role="status">
            {quote.perMonth > 0 ? (
              <>
                <strong>
                  <span>About</span> <span data-no-translate>{quote.perMonth}</span> <span>checks a month</span> ·{" "}
                  <span>about</span> <span data-no-translate>{moneyText(quote.monthCents, lang)}</span> <span>a month</span>
                </strong>
                <small>
                  <span data-no-translate>{quote.perDay}</span> <span>checks a pay day ×</span> <span data-no-translate>{quote.days}</span>{" "}
                  <span>pay days ×</span> <span data-no-translate>{moneyText(quote.centsEach, lang)}</span> <span>a check. Added to your Laawol bill.</span>
                </small>
              </>
            ) : (
              <strong>No extra cost: deposits pay drivers when the bank updates, a few times a day.</strong>
            )}
          </div>
          <div className="fleet-actions">
            <SaveButton busy={busy} label="Save the schedule" busyLabel="Saving..." onClick={() => void save()} disabled={!status.bank.connected && schedule.every > 0} />
            {saved && <span className="fleet-saved" role="status">Saved.</span>}
          </div>
        </>
      )}
    </Panel>
  );
}

/** Fleet payments: the deposits waiting for a driver, and "Check bank now". */
export function FleetBankDeposits({ businessId, state }: { businessId: string; state: FleetState }) {
  const lang = fleetLang();
  const { status, error: loadError, loading, reload } = useFleetBank(businessId);
  const { busy, error, setError, run } = useFleetRun(businessId);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState("");
  const drivers = useMemo(
    () =>
      state.data.drivers
        .filter((d) => d.status === "active")
        .map((d) => ({ id: String(d.id), name: String(d.name ?? "") || String(d.phone ?? "") }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [state.data.drivers],
  );

  async function checkNow() {
    setFlash("");
    const result = await run<{ limitReached?: boolean }>("bank_check_now", {});
    if (result) {
      setFlash(result.limitReached ? "This month's bank-check limit is reached: Laawol reads what the bank already sent." : "Bank checked. New deposits from known drivers are now paid.");
      reload();
    }
  }

  async function pay(creditId: string) {
    const driverId = picked[creditId];
    if (!driverId) {
      setError("Pick the driver who sent it.");
      return;
    }
    const driver = drivers.find((d) => d.id === driverId);
    const result = await run("bank_assign", { creditId, driverId }, {
      en: `Pay ${driver?.name || "this driver"}'s bills with this deposit? Their next deposits from the same sender are paid by themselves.`,
      fr: `Payer les factures de ${driver?.name || "ce chauffeur"} avec ce dépôt ? Ses prochains dépôts du même expéditeur seront payés automatiquement.`,
    });
    if (result) {
      setFlash("Payment recorded.");
      reload();
    }
  }

  const bankLine = status?.bank.connected
    ? `${status.bank.institutionName || "Bank"}${status.bank.accountMask ? ` ••${status.bank.accountMask}` : ""}`
    : "";

  return (
    <Panel
      title="Zelle from the bank"
      icon={<Landmark size={18} />}
      action={
        status?.bank.connected ? (
          <button className="ghost-button compact" type="button" disabled={busy} aria-busy={busy} onClick={() => void checkNow()}>
            <RefreshCw className={busy ? "spin" : undefined} size={14} aria-hidden="true" /> Check bank now
          </button>
        ) : undefined
      }
    >
      {(loadError || error) && <div className="lst-form-error" role="alert">{loadError || error}</div>}
      {flash && <p className="fleet-saved" role="status">{flash}</p>}
      {loading && !status && <p className="lst-hint" role="status"><RefreshCw className="spin" size={12} aria-hidden="true" /> Loading…</p>}
      {status && !status.bank.connected && (
        <p className="lst-hint">Connect the business&apos;s bank (Profile, Bank for Zelle checks) and Zelle deposits pay drivers&apos; bills by themselves.</p>
      )}
      {status?.bank.connected && (
        <>
          <p className="lst-hint">
            <span data-no-translate>{bankLine}</span> · <span>Deposits from known drivers pay their bills by themselves.</span>
            {status.lastScheduledMs > 0 && <> · <span>Last pay-day check</span> <span data-no-translate>{formatDateTime(status.lastScheduledMs)}</span></>}
          </p>
          {status.waiting.length === 0 ? (
            <p className="empty-state">No deposit is waiting for a driver.</p>
          ) : (
            <ul className="fleet-bank-waiting">
              {status.waiting.map((w) => (
                <li key={w.id}>
                  <div className="fleet-bank-deposit">
                    <strong data-no-translate>{moneyText(w.amountCents, lang)}</strong>
                    <span data-no-translate>{w.senderName || "—"}</span>
                    <small>
                      <span data-no-translate>{w.atMs > 0 ? formatDateTime(w.atMs) : w.dateKey ? formatDayKey(w.dateKey) : ""}</span>
                      {w.pending && <> · <span>pending at the bank</span></>}
                    </small>
                    <small>{waitingReasonText(w.reason)}</small>
                  </div>
                  <div className="fleet-bank-assign">
                    <label className="lst-field">
                      <span className="sr-only">Driver who sent it</span>
                      <select disabled={busy} value={picked[w.id] ?? ""} aria-label="Driver who sent it" onChange={(e) => setPicked((p) => ({ ...p, [w.id]: e.target.value }))}>
                        <option value="">Pick the driver…</option>
                        {drivers.map((d) => <option key={d.id} value={d.id} data-no-translate>{d.name}</option>)}
                      </select>
                    </label>
                    <SaveButton busy={busy} label="Pay this driver" busyLabel="Recording..." onClick={() => void pay(w.id)} disabled={!picked[w.id]} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
