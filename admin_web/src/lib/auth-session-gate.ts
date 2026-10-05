/**
 * Keeps the console router's profile work tied to the auth session that
 * started it.
 *
 * Every auth change (sign-in, sign-out, account switch) begins a new session.
 * Work from an older session - a profile load still in flight, a live profile
 * listener - must neither write state nor keep running: before this, signing
 * out left the previous user's profile listener subscribed, and a slow
 * profile load that resolved after sign-out put the old profile back.
 */
export type SessionGate = {
  /** Start a new session; returns a check that is true only while it lasts. */
  begin(): () => boolean;
  /** Keep `unsubscribe` as the session's live listener, or drop it at once if
   * that session has already ended. */
  follow(isCurrent: () => boolean, unsubscribe: () => void): void;
  /** End the current session and its listener (unmount / effect cleanup). */
  close(): void;
};

export function createSessionGate(): SessionGate {
  let generation = 0;
  let unfollow: (() => void) | null = null;
  const stopFollowing = () => {
    const stop = unfollow;
    unfollow = null;
    stop?.();
  };
  return {
    begin() {
      generation += 1;
      stopFollowing();
      const id = generation;
      return () => id === generation;
    },
    follow(isCurrent, unsubscribe) {
      if (!isCurrent()) {
        unsubscribe();
        return;
      }
      stopFollowing();
      unfollow = unsubscribe;
    },
    close() {
      generation += 1;
      stopFollowing();
    },
  };
}
