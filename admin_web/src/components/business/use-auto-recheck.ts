"use client";

import { useEffect, useRef, useState } from "react";

import { nextRecheckInMs } from "@/lib/zelle-check";

/**
 * After "not found yet", check again on its own every 20 s for 3 minutes
 * (docs/ZELLE_BANK_CHECK.md: those re-checks send `auto: true`, only sync and
 * are not counted). Each new `startKey` (> 0) starts a fresh 3 minutes;
 * `active` false, a `recheck` answering false (found, or failed) or unmount
 * stops it. Returns whether re-checks are scheduled, for the static
 * "checking again on its own" note (never a spinner between checks).
 */
export function useAutoRecheck(startKey: number, active: boolean, recheck: () => Promise<boolean>): boolean {
  const latest = useRef(recheck);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    latest.current = recheck;
  }, [recheck]);

  useEffect(() => {
    if (!startKey || !active) {
      setRunning(false);
      return undefined;
    }
    const startedAt = Date.now();
    let cancelled = false;
    let timer: number | null = null;
    const schedule = () => {
      const wait = nextRecheckInMs(startedAt, Date.now());
      if (wait === null) {
        setRunning(false);
        return;
      }
      timer = window.setTimeout(() => {
        void (async () => {
          let more = false;
          try {
            more = await latest.current();
          } catch {
            more = false;
          }
          if (cancelled) return;
          if (more) schedule();
          else setRunning(false);
        })();
      }, wait);
    };
    setRunning(true);
    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [startKey, active]);

  return running;
}
