import { BOX_3D_TIMEOUT_MS, startWithin, webglAvailable } from "@/lib/box-3d-load";
import type { Angles, Dims, LabelLang } from "@/lib/box-designer";

import type { Box3dScene } from "./box-3d-scene";

export type Box3dMountOptions = {
  container: HTMLElement;
  dims: Dims;
  lang: LabelLang;
  /** The scene is up and its first frame (both models) is drawn. */
  onReady?: () => void;
  /** No WebGL, a model that would not load, a context loss, or more than 8 seconds. Called at most once. */
  onFail?: (reason: string) => void;
  timeoutMs?: number;
};

export type Box3dHandle = {
  setDims: (dims: Dims) => void;
  setLang: (lang: LabelLang) => void;
  setAngles: (angles: Angles) => void;
  dispose: () => void;
};

/**
 * Starts the 3D scene for the in-page designer and the standalone page alike.
 * three.js and the models are loaded here, with `import()`, never earlier, so
 * the main bundle carries none of them. The handle can be used at once: what
 * is set before the scene exists is applied when it arrives. It always ends in
 * `onReady` or `onFail` (the 8 second timeout covers the chunk and the models),
 * and `dispose` frees whatever exists or arrives later.
 */
export function mountBox3d(options: Box3dMountOptions): Box3dHandle {
  let dims = options.dims;
  let lang = options.lang;
  let angles: Angles | null = null;
  let scene: Box3dScene | null = null;
  let ended = false;
  let failed = false;

  const fail = (reason: string) => {
    if (failed) return;
    failed = true;
    ended = true;
    options.onFail?.(reason);
  };

  if (!webglAvailable()) {
    // Asynchronously, so the caller's effect has finished before the callback runs.
    queueMicrotask(() => fail("no-webgl"));
    return { setDims() {}, setLang() {}, setAngles() {}, dispose() { ended = true; failed = true; } };
  }

  const run = startWithin<Box3dScene>(
    async () => {
      const { createBox3dScene } = await import("./box-3d-scene");
      let firstFrame: () => void = () => undefined;
      const drawn = new Promise<void>((resolve) => {
        firstFrame = resolve;
      });
      const created = await createBox3dScene({
        container: options.container,
        dims,
        lang,
        onFirstFrame: () => firstFrame(),
        onContextLost: () => fail("context-lost"),
      });
      // Ready means drawn: the caller swaps its fallback only once the 3D box is on screen.
      await drawn;
      return created;
    },
    options.timeoutMs ?? BOX_3D_TIMEOUT_MS,
    (late) => late.dispose(),
  );

  void run.done.then((outcome) => {
    if (!outcome.ok) {
      if (outcome.reason !== "cancelled") fail(outcome.reason);
      return;
    }
    scene = outcome.value;
    scene.setDims(dims);
    scene.setLang(lang);
    if (angles) scene.setAngles(angles);
    if (!ended) {
      ended = true;
      options.onReady?.();
    }
  });

  return {
    setDims(next) {
      dims = next;
      scene?.setDims(next);
    },
    setLang(next) {
      lang = next;
      scene?.setLang(next);
    },
    setAngles(next) {
      angles = next;
      scene?.setAngles(next);
    },
    dispose() {
      ended = true;
      failed = true;
      run.cancel();
      scene?.dispose();
      scene = null;
    },
  };
}
