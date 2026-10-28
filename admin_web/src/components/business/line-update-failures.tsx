import { AlertTriangle } from "lucide-react";

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

/**
 * What the line's last WhatsApp update did, compactly, on the Waiting list
 * and the containers: who it failed to reach (red, with WhatsApp's reason as
 * it wrote it) and who it reached ("Receiver ✓✓ Read"). Nothing for an update
 * WhatsApp has not reported on yet.
 */
export function LineUpdateFailures({ line }: { line: Record<string, unknown> }) {
  const marks = packageUpdateMarks(line.lastCustomerUpdate);
  if (marks.length === 0) return null;
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
    </>
  );
}
