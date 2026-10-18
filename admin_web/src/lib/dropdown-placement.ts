/**
 * Where a dropdown anchored under a button sits so it stays inside the
 * viewport. Pure: the bell (components/notification-bell.tsx) measures its
 * wrapper and applies the result.
 *
 * The dropdown prefers to line its right edge up with the anchor's right
 * edge (the desktop look). On a phone the bell is not at the screen's right
 * edge, so a 340 px panel aligned that way started 123 px left of the screen
 * at 390 px wide. Here it narrows to the viewport minus a gutter each side
 * and slides back inside.
 */
export type DropdownPlacement = {
  /** Offset of the dropdown's left edge from the anchor's left edge, px. */
  left: number;
  width: number;
};

export function dropdownPlacement({
  anchorLeft,
  anchorRight,
  viewportWidth,
  preferredWidth = 340,
  gutter = 16,
}: {
  anchorLeft: number;
  anchorRight: number;
  viewportWidth: number;
  preferredWidth?: number;
  gutter?: number;
}): DropdownPlacement {
  const room = Math.max(0, viewportWidth - gutter * 2);
  const width = Math.min(preferredWidth, room);
  const wanted = anchorRight - width;
  const min = gutter;
  const max = viewportWidth - gutter - width;
  const pageLeft = Math.min(Math.max(wanted, min), Math.max(min, max));
  return { left: Math.round(pageLeft - anchorLeft), width: Math.round(width) };
}
