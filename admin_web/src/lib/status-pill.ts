// The class of an in-flow status pill (a container's or an invoice's state
// in a list row or a panel header).
//
// `.lst-badge` is the car listing card's badge: it is absolutely positioned
// over the card photo. Used anywhere else it leaves the flow and lands on
// the nearest positioned ancestor - off the card or behind the header -
// which is how the container and invoice states went missing. Pills that
// sit in a row use the shared `.status-pill` instead, with the same tone
// vocabulary the listing badge uses.

export const STATUS_PILL_TONES = ["ok", "warn", "navy", "muted"] as const;
export type StatusPillTone = (typeof STATUS_PILL_TONES)[number];

export function statusPillClass(tone: string): string {
  const known = (STATUS_PILL_TONES as readonly string[]).includes(tone);
  return known ? `status-pill compact ${tone}` : "status-pill compact";
}
