import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { functions } from "@/lib/firebase";
import { text } from "@/lib/format";
import { packageUpdateMarks, type PackageUpdateTick } from "@/lib/package-staff";

/** "✓✓ Read" - the ticks of one person's update, read in the thread's blue. */
export function UpdateTick({ tick }: { tick: PackageUpdateTick }) {
  return (
    <span className={`wa-tick ${tick.delivery}`} title={tick.label}>
      <span aria-hidden="true" data-no-translate>{tick.ticks}</span>
      <span className="wa-tick-label">{tick.label}</span>
    </span>
  );
}

/** Why the server would not send again, in words staff can act on. */
function resendErrorText(error: unknown): string {
  const reason = text((error as { details?: { reason?: unknown } })?.details?.reason, "");
  if (reason === "whatsapp_not_configured") return "WhatsApp is not connected yet.";
  if (reason === "no_customer_update") return "There is no message to send again yet.";
  return "Could not send again. Try again.";
}

/**
 * "Send again" on a package whose last WhatsApp message did not arrive
 * (docs/WHATSAPP_RESEND.md): the server sends the latest update again to the
 * people it failed to reach - never to someone it already reached. Fix a
 * wrong number first: a corrected number is sent the message by itself.
 */
export function SendAgainButton({ businessId, lineId }: { businessId: string; lineId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");
  if (!businessId || !lineId) return null;
  async function sendAgain() {
    setState("busy");
    setError("");
    try {
      await httpsCallable(functions, "updateContainerLine", { timeout: 20_000 })({ businessId, lineId, action: "resend_update" });
      setState("done");
    } catch (caught) {
      setError(resendErrorText(caught));
      setState("idle");
    }
  }
  return (
    <span className="ctn-wa-again">
      {state === "done" ? (
        <small className="ctn-wa-again-done">Sent again</small>
      ) : (
        <button type="button" className="ctn-wa-again-button" disabled={state === "busy"} onClick={() => void sendAgain()}>
          <RefreshCw size={11} aria-hidden="true" /> <span>{state === "busy" ? "Sending…" : "Send again"}</span>
        </button>
      )}
      {error && <small className="ctn-wa-fail">{error}</small>}
    </span>
  );
}

/**
 * What the line's last WhatsApp update did, compactly, on the Waiting list
 * and the containers: who it failed to reach (red, with WhatsApp's reason as
 * it wrote it, and "Send again") and who it reached ("Receiver ✓✓ Read").
 * Nothing for an update WhatsApp has not reported on yet.
 */
export function LineUpdateFailures({ line }: { line: Record<string, unknown> }) {
  const marks = packageUpdateMarks(line.lastCustomerUpdate);
  if (marks.length === 0) return null;
  const failed = marks.some((mark) => !mark.tick);
  return (
    <>
      {marks.map((mark) => mark.tick ? (
        <small className="ctn-wa-tick" key={mark.role}>
          <span>{mark.tick.who}</span> <UpdateTick tick={mark.tick} />
        </small>
      ) : (
        <small className="ctn-wa-fail" key={mark.role}>
          <AlertTriangle size={11} aria-hidden="true" /> <span>{mark.text}</span>
          {mark.failure && <> · <span data-no-translate>{mark.failure}</span></>}
        </small>
      ))}
      {failed && <SendAgainButton businessId={text(line.businessId, "")} lineId={text(line.id, "")} />}
    </>
  );
}
