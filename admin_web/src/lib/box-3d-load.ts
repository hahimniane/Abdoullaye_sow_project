/**
 * Starting the 3D box without ever hanging the form (docs/ENGINEERING_GUARDRAILS.md
 * section 3: a loading state must always resolve). The scene is a lazy chunk
 * plus two model files; whatever happens to them, `done` settles: the scene, a
 * failure, a timeout, or a cancel (the page left). A scene that arrives after
 * the answer was given is handed to `discard`, so its WebGL context and
 * geometry are freed instead of leaking.
 *
 * Pure of three.js and of the DOM: `box-3d-load.test.ts` runs it.
 */

/** After this the designer stays on its CSS box (and the standalone page tells the app "failed"). */
export const BOX_3D_TIMEOUT_MS = 8000;

export type Box3dOutcome<T> = { ok: true; value: T } | { ok: false; reason: "timeout" | "error" | "cancelled" };

export function startWithin<T>(
  make: () => Promise<T>,
  ms: number,
  discard: (late: T) => void,
): { done: Promise<Box3dOutcome<T>>; cancel: () => void } {
  let settled = false;
  let resolveDone: (outcome: Box3dOutcome<T>) => void = () => undefined;
  const done = new Promise<Box3dOutcome<T>>((resolve) => {
    resolveDone = resolve;
  });
  const finish = (outcome: Box3dOutcome<T>) => {
    if (settled) return false;
    settled = true;
    clearTimeout(timer);
    resolveDone(outcome);
    return true;
  };
  const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), ms);
  let started: Promise<T>;
  try {
    started = make();
  } catch {
    started = Promise.reject(new Error("make threw"));
  }
  started.then(
    (value) => {
      if (!finish({ ok: true, value })) discard(value);
    },
    () => {
      finish({ ok: false, reason: "error" });
    },
  );
  return { done, cancel: () => void finish({ ok: false, reason: "cancelled" }) };
}

/** Whether this browser can make a WebGL context at all (checked before the big chunk is fetched). */
export function webglAvailable(doc: Pick<Document, "createElement"> | null = typeof document === "undefined" ? null : document): boolean {
  if (!doc) return false;
  try {
    const canvas = doc.createElement("canvas") as HTMLCanvasElement;
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
