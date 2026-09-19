/**
 * Click-outside-to-close for a modal overlay, done so that a press which
 * began INSIDE the modal can never close it.
 *
 * The browser fires `click` on the deepest element under the pointer at
 * mouse-up. If what was pressed has vanished by then - a customer suggestion
 * that closes itself on blur, a chip list that re-rendered - the click lands
 * on the overlay instead, and a plain `onClick={close}` there dismisses the
 * whole form mid-entry. That is the "popup disappears before I can save" the
 * yard reported. Closing only when the press both started and ended on the
 * overlay itself makes the dismissal mean what it looks like: a deliberate
 * click on the dark background.
 */

// Only identity is compared, so the shape is deliberately loose: React's
// mouse events satisfy it, and so does a plain object in a unit test.
type OverlayEvent = { target: unknown; currentTarget: unknown };

const pressedOnOverlay = new WeakSet<object>();

export function overlayDismiss(close: () => void) {
  return {
    onMouseDown(event: OverlayEvent) {
      const overlay = event.currentTarget as object;
      if (event.target === event.currentTarget) pressedOnOverlay.add(overlay);
      else pressedOnOverlay.delete(overlay);
    },
    onClick(event: OverlayEvent) {
      const overlay = event.currentTarget as object;
      const deliberate =
        event.target === event.currentTarget && pressedOnOverlay.has(overlay);
      pressedOnOverlay.delete(overlay);
      if (deliberate) close();
    },
  };
}
