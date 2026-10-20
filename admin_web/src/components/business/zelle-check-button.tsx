"use client";

import { useCallback, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { BadgeCheck, Clock, RefreshCw, SearchCheck } from "lucide-react";

import { useAutoRecheck } from "@/components/business/use-auto-recheck";
import { functions } from "@/lib/firebase";
import { formatDate, formatDateTime } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import { statusPillClass } from "@/lib/status-pill";
import {
  AUTO_RECHECK_TEXT,
  checkZelleRequest,
  confirmZelleCandidateRequest,
  confirmationFromBankCheck,
  readZelleCheckAnswer,
  zelleFailureMessage,
  type BankCheck,
  type ZelleCandidate,
  type ZelleCheckAnswer,
  type ZelleConfirmation,
  type ZelleKind,
} from "@/lib/zelle-check";

/** A deposit's time: the bank's time, or only its date when the bank gave no time. */
export function whenText(atMs: number | null, timeKnown: boolean): string {
  if (atMs === null) return "";
  return timeKnown ? formatDateTime(atMs) : formatDate(atMs);
}

/**
 * "Check Zelle" on a payment recorded as Zelle: asks the business's bank
 * (through `checkZellePayment`) for a deposit of exactly this amount in the
 * owner's window. Confirmed shows the deposit's time and the sender as the
 * bank shows it; not found offers Check again and checks again on its own
 * every 20 s for 3 minutes (`auto: true`: free, not counted as a check);
 * several same-amount deposits
 * are listed to pick by sender (`confirmZelleCandidate`). The record is live,
 * so a confirmation written by anyone shows here too (`bankCheck`).
 */
export function ZelleCheckButton({
  businessId,
  kind,
  id,
  bankCheck,
  enabled = true,
}: {
  businessId: string;
  kind: ZelleKind;
  id: string;
  bankCheck: BankCheck | null;
  enabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<ZelleConfirmation | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [candidates, setCandidates] = useState<ZelleCandidate[]>([]);
  const [recheckRun, setRecheckRun] = useState(0);
  const shown = confirmed ?? confirmationFromBankCheck(bankCheck);

  const apply = useCallback((answer: ZelleCheckAnswer) => {
    setCandidates(answer.result === "choose" ? answer.candidates : []);
    setNotFound(answer.result === "not_found");
    if (answer.confirmation) setConfirmed(answer.confirmation);
  }, []);

  /** One call at a time: a click and an automatic re-check never overlap. */
  const run = useCallback(async (call: () => Promise<unknown>, auto: boolean): Promise<ZelleCheckAnswer | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    if (!auto) setError("");
    try {
      const answer = readZelleCheckAnswer(await call());
      apply(answer);
      return answer;
    } catch (failure) {
      setError(zelleFailureMessage(failure));
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [apply]);

  const ask = useCallback(
    (auto: boolean) => run(async () => (await httpsCallable(functions, "checkZellePayment")(checkZelleRequest(businessId, kind, id, auto))).data, auto),
    [businessId, id, kind, run],
  );

  async function check() {
    const answer = await ask(false);
    // A person's "not found yet" starts 3 minutes of automatic re-checks.
    if (answer?.result === "not_found") setRecheckRun((value) => value + 1);
  }

  const recheck = useCallback(async () => {
    if (busyRef.current) return true;
    const answer = await ask(true);
    return answer?.result === "not_found";
  }, [ask]);
  const autoRunning = useAutoRecheck(recheckRun, notFound && !shown && enabled, recheck);

  const pick = (creditId: string) => run(async () => (await httpsCallable(functions, "confirmZelleCandidate")(
    confirmZelleCandidateRequest(businessId, kind, id, creditId))).data, false);

  if (shown) {
    return (
      <div className="zelle-check" role="status">
        <span className={statusPillClass("ok")}><BadgeCheck size={14} /> Zelle confirmed</span>
        <small data-no-translate>
          {moneyText(shown.amountCents)}
          {shown.atMs !== null && ` · ${whenText(shown.atMs, shown.timeKnown)}`}
          {shown.senderName && ` · ${shown.senderName}`}
          {shown.institutionName && ` · ${shown.institutionName}`}
        </small>
      </div>
    );
  }

  return (
    <div className="zelle-check">
      <button className="lst-btn ghost" type="button" disabled={busy || !enabled} aria-busy={busy} onClick={() => void check()}>
        {busy ? <RefreshCw className="spin" size={14} /> : <SearchCheck size={14} />}
        {busy ? "Checking…" : notFound || bankCheck?.status === "not_found" ? "Check again" : "Check Zelle"}
      </button>
      {error && <small className="lst-form-error" role="alert">{error}</small>}
      {notFound && !error && (
        <small role="status">
          <span className={statusPillClass("warn")}>Not found yet</span>{" "}
          <span>No deposit of this amount has arrived yet. Ask the customer to wait a minute, then check again.</span>
        </small>
      )}
      {notFound && autoRunning && (
        <small className="zelle-auto" role="status">
          <Clock size={12} aria-hidden="true" /> <span>{AUTO_RECHECK_TEXT}</span>
        </small>
      )}
      {candidates.length > 0 && (
        <div className="zelle-candidates" role="group" aria-label="Several deposits of this amount arrived. Pick the one from this customer:">
          <small>Several deposits of this amount arrived. Pick the one from this customer:</small>
          <ul>
            {candidates.map((candidate) => (
              <li key={candidate.creditId}>
                <span data-no-translate>
                  <strong>{candidate.senderName || "—"}</strong>
                  {candidate.atMs !== null && ` · ${whenText(candidate.atMs, candidate.timeKnown)}`}
                </span>
                {candidate.pending && <small> <span>pending</span></small>}
                <button className="lst-btn ghost" type="button" disabled={busy || !enabled} onClick={() => void pick(candidate.creditId)}>This one</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
