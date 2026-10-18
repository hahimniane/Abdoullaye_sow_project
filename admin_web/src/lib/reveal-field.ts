/**
 * Bring a form field into view and put the keyboard on it, so a refused save
 * in a scrolled modal shows the person what to fix instead of looking dead.
 * Returns whether there was anything to reveal.
 */
export type RevealableField = {
  scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
  focus?: (options?: FocusOptions) => void;
};

export function revealField(field: RevealableField | null | undefined): boolean {
  if (!field) return false;
  field.scrollIntoView?.({ block: "center", behavior: "smooth" });
  // The scroll above already placed it; focusing must not jump it again.
  field.focus?.({ preventScroll: true });
  return true;
}
