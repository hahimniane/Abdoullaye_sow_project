"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Landmark, Link2, RefreshCw, Unlink } from "lucide-react";

import { confirmImportantAction } from "@/lib/action-confirmation";
import { functions } from "@/lib/firebase";
import { currentLanguage, formatDateTime } from "@/lib/format";
import { statusPillClass } from "@/lib/status-pill";
import {
  BANK_STATUS_LABELS,
  BANK_STATUS_TONES,
  PLAID_LINK_SCRIPT_URL,
  ZELLE_MESSAGES,
  bankAccountText,
  bankLinkTokenRequest,
  connectBankRequest,
  readBankStatus,
  setBankWindowRequest,
  windowLabel,
  windowOptions,
  zelleFailureMessage,
  type BankStatus,
} from "@/lib/zelle-check";

type PlaidHandler = { open: () => void; destroy?: () => void };
type PlaidFactory = {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string, metadata: unknown) => void;
    onExit: () => void;
  }) => PlaidHandler;
};

/** How long the status may take before the card says it could not load. */
const STATUS_TIMEOUT_MS = 15_000;
/** How long Plaid's script may take to arrive. */
const SCRIPT_TIMEOUT_MS = 15_000;
/** Link can stay open while the owner signs in; the button comes back after this anyway. */
const LINK_SAFETY_MS = 10 * 60_000;

function plaidOnWindow(): PlaidFactory | null {
  const candidate = (window as unknown as { Plaid?: PlaidFactory }).Plaid;
  return candidate && typeof candidate.create === "function" ? candidate : null;
}

/** Loads Plaid's official Link script once, only when the owner presses Connect. */
function loadPlaidLink(): Promise<PlaidFactory> {
  const ready = plaidOnWindow();
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("link_not_loaded"));
    const timer = window.setTimeout(fail, SCRIPT_TIMEOUT_MS);
    const done = () => {
      window.clearTimeout(timer);
      const plaid = plaidOnWindow();
      if (plaid) resolve(plaid);
      else fail();
    };
    let script = document.querySelector<HTMLScriptElement>(`script[src="${PLAID_LINK_SCRIPT_URL}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = PLAID_LINK_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", () => {
      window.clearTimeout(timer);
      fail();
    }, { once: true });
  });
}

/**
 * "Bank for Zelle checks", for the owner: connect the business's bank through
 * Plaid Link (read-only), see which bank and account, set the check window,
 * reconnect when the bank asks the owner to sign in again, or disconnect.
 * Staff never see this card; they only see Check Zelle on payments.
 */
export function BankZelleCard({ businessId, enabled }: { businessId: string; enabled: boolean }) {
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const safety = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!enabled || !businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), STATUS_TIMEOUT_MS);
    try {
      const result = await httpsCallable(functions, "getBusinessBankStatus")({ businessId });
      setStatus(readBankStatus(result.data));
      setError("");
    } catch (failure) {
      setError(zelleFailureMessage(failure));
    } finally {
      window.clearTimeout(timer);
      setLoading(false);
    }
  }, [businessId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    if (safety.current !== null) window.clearTimeout(safety.current);
  }, []);

  const release = () => {
    if (safety.current !== null) window.clearTimeout(safety.current);
    safety.current = null;
    setBusy(false);
  };

  async function connect() {
    setBusy(true);
    setError("");
    setFlash("");
    safety.current = window.setTimeout(release, LINK_SAFETY_MS);
    try {
      const lang = currentLanguage() === "fr" ? "fr" : "en";
      const token = await httpsCallable(functions, "createBankLinkToken")(bankLinkTokenRequest(businessId, lang));
      const linkToken = String((token.data as { linkToken?: unknown })?.linkToken ?? "");
      if (!linkToken) throw new Error("link_not_loaded");
      const plaid = await loadPlaidLink();
      const handler = plaid.create({
        token: linkToken,
        onSuccess: (publicToken, metadata) => {
          void (async () => {
            try {
              const answer = await httpsCallable(functions, "connectBusinessBank")(
                connectBankRequest(businessId, publicToken, metadata));
              const synced = (answer.data as { synced?: unknown })?.synced === true;
              setFlash(synced ? "Bank connected." : "The bank connected, but its history is still being prepared. Checks work in a few minutes.");
              await load();
            } catch (failure) {
              setError(zelleFailureMessage(failure));
            } finally {
              release();
            }
          })();
        },
        onExit: () => release(),
      });
      handler.open();
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "link_not_loaded" ? ZELLE_MESSAGES.link_not_loaded : zelleFailureMessage(failure));
      release();
    }
  }

  async function disconnect() {
    const ok = await confirmImportantAction(
      "Disconnect the bank? Staff can no longer check Zelle payments until you connect it again.",
      "Déconnecter la banque ? L’équipe ne pourra plus vérifier les paiements Zelle tant que vous ne la reconnectez pas.",
    );
    if (!ok) return;
    setBusy(true);
    setError("");
    setFlash("");
    try {
      await httpsCallable(functions, "disconnectBusinessBank")({ businessId });
      setFlash("Bank disconnected.");
      await load();
    } catch (failure) {
      setError(zelleFailureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function saveWindow(minutes: number) {
    setBusy(true);
    setError("");
    setFlash("");
    try {
      await httpsCallable(functions, "setBankCheckWindow")(setBankWindowRequest(businessId, minutes));
      setStatus((current) => (current ? { ...current, windowMinutes: minutes } : current));
      setFlash("Check window saved.");
    } catch (failure) {
      setError(zelleFailureMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const state = status?.status ?? "disconnected";
  return (
    <article className="panel bank-zelle-card">
      <div className="panel-header">
        <div>
          <Landmark size={18} />
          <h2>Bank for Zelle checks</h2>
        </div>
        {status && <span className={statusPillClass(BANK_STATUS_TONES[state])}>{BANK_STATUS_LABELS[state]}</span>}
      </div>
      <p className="panel-lede">Connect the business's bank so staff can check a Zelle payment at the counter without calling you. Laawol only reads deposits; it cannot move money. Staff never see your balance or other transactions.</p>
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {flash && <div className="lst-form-ok" role="status">{flash}</div>}
      {loading && !status ? (
        <p className="panel-lede"><RefreshCw className="spin" size={14} /> Loading the bank…</p>
      ) : (
        <>
          {status?.connected && (
            <p className="bank-zelle-account">
              <strong data-no-translate>{bankAccountText(status)}</strong>
              <small>
                <span>Last read</span>{" "}
                {status.lastSyncAtMs !== null ? <time data-no-translate>{formatDateTime(status.lastSyncAtMs)}</time> : <span>Not read yet</span>}
              </small>
            </p>
          )}
          {state === "needs_reauth" && (
            <p className="ctn-wa-warn">The bank needs you to sign in again before staff can check Zelle payments.</p>
          )}
          <div className="wpk-inline-actions">
            {state === "disconnected" && (
              <button className="lst-add" type="button" disabled={busy || !enabled} aria-busy={busy} onClick={() => void connect()}>
                {busy ? <RefreshCw className="spin" size={16} /> : <Link2 size={16} />}
                {busy ? "Connecting…" : "Connect bank"}
              </button>
            )}
            {state === "needs_reauth" && (
              <button className="lst-add" type="button" disabled={busy || !enabled} aria-busy={busy} onClick={() => void connect()}>
                {busy ? <RefreshCw className="spin" size={16} /> : <Link2 size={16} />}
                {busy ? "Connecting…" : "Reconnect"}
              </button>
            )}
            {state !== "disconnected" && (
              <button className="lst-btn ghost" type="button" disabled={busy || !enabled} onClick={() => void disconnect()}>
                <Unlink size={16} /> Disconnect
              </button>
            )}
          </div>
          <label className="lst-field bank-zelle-window">
            <span>Check window</span>
            <select
              value={status?.windowMinutes ?? 15}
              disabled={busy || !enabled}
              onChange={(e) => void saveWindow(Number(e.target.value))}
            >
              {windowOptions(status?.windowMinutes ?? 15).map((minutes) => (
                <option key={minutes} value={minutes} data-no-translate>{windowLabel(minutes)}</option>
              ))}
            </select>
            <small>Staff look for a deposit of exactly the payment's amount, this many minutes before or after it was recorded.</small>
          </label>
        </>
      )}
    </article>
  );
}
