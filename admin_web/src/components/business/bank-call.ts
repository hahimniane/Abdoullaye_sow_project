"use client";

import { httpsCallable } from "firebase/functions";

import { previewBankCall } from "@/lib/bank-check-preview";
import { functions } from "@/lib/firebase";

/** Longer than a check normally takes (a bank refresh plus a sync), shorter than a person waits. */
const CALL_TIMEOUT_MS = 45_000;

/**
 * One way to reach the bank callables (docs/ZELLE_BANK_CHECK.md): the
 * server, or - in the console's local preview only - the sample answers of
 * lib/bank-check-preview.ts, so the screens can be checked in a browser.
 */
export async function callBank(name: string, data: Record<string, unknown>, previewMode = false): Promise<unknown> {
  const call = previewMode ? previewBankCall(name, data) : httpsCallable(functions, name)(data).then((result) => result.data);
  // Every wait ends: no answer in this long reads as "did not reach Laawol".
  let timer: number | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(Object.assign(new Error("deadline-exceeded"), { code: "functions/deadline-exceeded" })), CALL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([call, late]);
  } finally {
    window.clearTimeout(timer);
  }
}
