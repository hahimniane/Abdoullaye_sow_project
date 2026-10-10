/**
 * Which destination records the Services & coverage page lists by default.
 *
 * A business can hold a record for every country (the platform's seed action
 * writes the whole catalog), nearly all of them "No services configured" and
 * paused. The page lists the ones the business actually uses - active, the
 * main destination, or with a service switched on - and keeps the rest one
 * switch away, so a business that serves Guinea sees Guinea.
 */
export type DestinationVisibilityRow = Record<string, unknown>;

export function destinationIsInUse(row: DestinationVisibilityRow, hasAnyService: boolean): boolean {
  return row.isActive === true || row.isMain === true || hasAnyService;
}
