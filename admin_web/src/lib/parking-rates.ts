/**
 * A lot's price cards, console side. Mirrors
 * `my_flutter_app/functions/business_parking_entry.js`: a business can charge
 * more than one price - a bigger space, a long-stay deal, a rate for the
 * dealer who brings six cars at once - and staff pick the card when they
 * record the car.
 *
 * The business's own parkingDailyRate stays the standard price. A card is an
 * alternative to it, never a replacement, so a customer booking and every
 * existing record price exactly as they always did.
 */

export type ParkingRate = {
  id: string;
  label: string;
  dailyRate: number;
  weeklyRate: number;
  monthlyRate: number;
  minimumDays: number;
};

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function positive(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Clean cards from whatever the business document holds. */
export function normalizeParkingRates(raw: unknown): ParkingRate[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ParkingRate[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const id = text(row.id, 60);
    const label = text(row.label, 80);
    const dailyRate = positive(row.dailyRate);
    // A card with no name cannot be chosen, and one with no daily rate cannot
    // price the days a stay is actually billed in.
    if (!id || !label || dailyRate <= 0 || seen.has(id)) continue;
    seen.add(id);
    const minimum = Math.floor(Number(row.minimumDays));
    out.push({
      id,
      label,
      dailyRate,
      weeklyRate: positive(row.weeklyRate),
      monthlyRate: positive(row.monthlyRate),
      minimumDays: Number.isFinite(minimum) && minimum > 0 ? minimum : 1,
    });
  }
  return out;
}

/** A stable id for a newly added card, unique within what is already there. */
export function nextParkingRateId(existing: ParkingRate[]): string {
  const taken = new Set(existing.map((rate) => rate.id));
  for (let n = 1; n < 1000; n += 1) {
    const id = `rate${n}`;
    if (!taken.has(id)) return id;
  }
  return `rate${Date.now()}`;
}

/**
 * What the picker shows: the lot's standard price first, then every card.
 * The standard price carries an empty id, which is what the server reads as
 * "no card chosen" - so the default costs nothing new to express.
 */
export function parkingRateChoices(
  business: Record<string, unknown> | null | undefined,
): { id: string; label: string; dailyRate: number }[] {
  const source = business ?? {};
  const standardRate = positive(source.parkingDailyRate);
  const choices = standardRate > 0
    ? [{ id: "", label: "Standard", dailyRate: standardRate }]
    : [];
  for (const rate of normalizeParkingRates(source.parkingRates)) {
    choices.push({ id: rate.id, label: rate.label, dailyRate: rate.dailyRate });
  }
  return choices;
}

/** "Long stay — $9.00/day", the way a picker names a price. */
export function parkingRateOptionLabel(
  choice: { label: string; dailyRate: number },
): string {
  return `${choice.label} — $${choice.dailyRate.toFixed(2)}/day`;
}
