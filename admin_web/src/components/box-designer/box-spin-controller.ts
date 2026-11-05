import { DEFAULT_ANGLES, dragAngles, keyAngles, wrapSpin, type Angles } from "@/lib/box-designer";

/** Idle spin, degrees a second, until the person touches the box. */
export const IDLE_SPIN_DEG_PER_S = 9;

export type SpinController = {
  /** The first touch (or a slider move) stops the idle spin for good. */
  markTouched: () => void;
  getAngles: () => Angles;
  dispose: () => void;
};

type Options = {
  /** The element dragged and focused; it gets the pointer and arrow-key handlers. */
  element: HTMLElement;
  /** Called with the new angles whenever they change (a drag, a key, an idle step). */
  onAngles: (angles: Angles) => void;
  /** Spin by itself until touched (the default). */
  idle?: boolean;
};

/**
 * Drag to spin, arrow keys to turn, idle spin until touched: the one
 * implementation behind the in-page designer and the standalone /box-3d/ page,
 * whichever draws the box (CSS or three.js). It renders nothing itself; it
 * only reports angles. The idle loop runs only while it can be seen, is not
 * touched, and motion is allowed (`prefers-reduced-motion` = no idle spin at
 * all, so nothing runs when idle).
 */
export function createSpinController({ element, onAngles, idle = true }: Options): SpinController {
  let angles: Angles = { ...DEFAULT_ANGLES };
  let drag: { x: number; y: number; from: Angles } | null = null;
  let touched = false;
  let visible = true;
  let frame = 0;
  let last = 0;
  let disposed = false;

  const query = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  const canIdle = () => idle && !touched && !disposed && !(query?.matches ?? false) && visible && !document.hidden;

  const tick = (now: number) => {
    frame = 0;
    if (!canIdle()) {
      last = 0;
      return;
    }
    if (last) {
      angles = { ...angles, spin: wrapSpin(angles.spin + ((now - last) / 1000) * IDLE_SPIN_DEG_PER_S) };
      onAngles(angles);
    }
    last = now;
    frame = requestAnimationFrame(tick);
  };
  const resume = () => {
    if (!frame && canIdle()) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  };
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  };

  const markTouched = () => {
    touched = true;
    stop();
  };

  const onPointerDown = (event: PointerEvent) => {
    markTouched();
    drag = { x: event.clientX, y: event.clientY, from: angles };
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that cannot be captured still drags while it stays over the element.
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag) return;
    angles = dragAngles(drag.from, event.clientX - drag.x, event.clientY - drag.y);
    onAngles(angles);
  };
  const endDrag = () => {
    drag = null;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    markTouched();
    angles = keyAngles(angles, event.key);
    onAngles(angles);
  };

  let watcher: IntersectionObserver | null = null;
  if (idle && typeof IntersectionObserver !== "undefined") {
    watcher = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (visible) resume();
      else stop();
    });
    watcher.observe(element);
  }
  const onVisibility = () => (document.hidden ? stop() : resume());
  const onMotionChange = () => (query?.matches ? stop() : resume());

  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", endDrag);
  element.addEventListener("pointercancel", endDrag);
  element.addEventListener("keydown", onKeyDown);
  document.addEventListener("visibilitychange", onVisibility);
  query?.addEventListener?.("change", onMotionChange);

  onAngles(angles);
  resume();

  return {
    markTouched,
    getAngles: () => angles,
    dispose: () => {
      disposed = true;
      stop();
      watcher?.disconnect();
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", endDrag);
      element.removeEventListener("pointercancel", endDrag);
      element.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("visibilitychange", onVisibility);
      query?.removeEventListener?.("change", onMotionChange);
    },
  };
}
