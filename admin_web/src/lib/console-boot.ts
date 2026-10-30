/**
 * Opening the console without giving up on the first slow answer.
 *
 * The console reads the signed-in person's profile to decide which console to
 * open. On a slow or flaky connection one attempt sometimes fails or times
 * out, and the person saw "We could not open your console" although a second
 * try a moment later would have worked. These helpers retry quietly first;
 * the router then keeps listening behind the error so the console opens by
 * itself once the connection answers.
 */

export const PROFILE_ATTEMPT_TIMEOUT_MS = 10_000;
export const PROFILE_ATTEMPTS = 2;
export const PROFILE_RETRY_DELAY_MS = 1_000;
export const TOKEN_REFRESH_TIMEOUT_MS = 8_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `work`, or a rejection after `ms`. */
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Runs `attempt` up to `attempts` times, waiting `delayMs` between tries, and
 * stops early once `keepGoing()` is false (the session ended). Rethrows the
 * last failure.
 */
export async function withRetries<T>(
  attempt: () => Promise<T>,
  opts: {attempts: number; delayMs: number; keepGoing?: () => boolean; sleep?: (ms: number) => Promise<void>},
): Promise<T> {
  const sleep = opts.sleep ?? wait;
  let last: unknown = new Error("no-attempt");
  for (let i = 0; i < Math.max(1, opts.attempts); i += 1) {
    if (i > 0) {
      await sleep(opts.delayMs);
      if (opts.keepGoing && !opts.keepGoing()) break;
    }
    try {
      return await attempt();
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

/**
 * Refreshes the ID token so new custom claims reach Storage rules, but never
 * blocks the console on it: if the refresh fails or is slow, the session's
 * current token is still valid for reading the profile, and the refresh is
 * tried again in the background.
 */
export async function refreshTokenSoftly(user: {getIdToken(forceRefresh?: boolean): Promise<string>}, timeoutMs = TOKEN_REFRESH_TIMEOUT_MS): Promise<"fresh" | "cached"> {
  const fresh = user.getIdToken(true);
  try {
    await withTimeout(fresh, timeoutMs, "token-refresh-timeout");
    return "fresh";
  } catch {
    // The slow refresh may still land; nothing waits on it.
    fresh.catch(() => undefined);
    return "cached";
  }
}
