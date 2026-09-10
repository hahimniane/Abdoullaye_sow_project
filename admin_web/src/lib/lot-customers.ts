/**
 * The lot's customer memory, console side. Mirrors
 * `my_flutter_app/functions/lot_customers.js`: the server remembers every
 * customer typed onto a ledger activity or a walk-up, with the cars seen
 * against them; this offers them back as staff type. No Firebase here so
 * `lot-customers.test.ts` runs without a browser.
 */

export type LotCustomerCar = { vin: string; make: string; model: string; year: string };

export type LotCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  cars: LotCustomerCar[];
  lastSeenMs: number;
  /** True when this is one of the business's own people rather than a
   * remembered customer. A lot parks its own staff's cars, and nobody should
   * have to be "saved" as a customer first. */
  staff?: boolean;
};

type Row = Record<string, unknown>;

function s(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

function digits(value: unknown): string {
  return s(value, 40).replace(/\D+/g, "");
}

function ms(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const v = value as { toMillis?: () => number; seconds?: number };
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  return 0;
}

/** A stored `lotCustomers` row as the picker needs it. */
export function lotCustomerFromRow(row: Row): LotCustomer {
  const cars = Array.isArray(row.cars) ? (row.cars as Row[]) : [];
  return {
    id: s(row.id, 200),
    name: s(row.name, 120),
    phone: s(row.phone, 40),
    email: s(row.email, 180),
    cars: cars.map((c) => ({
      vin: s(c.vin, 17).toUpperCase(),
      make: s(c.make, 80),
      model: s(c.model, 80),
      year: s(c.year, 8),
    })),
    lastSeenMs: ms(row.lastSeenAt),
  };
}

/**
 * The customers that match what staff typed, best first. Same ranking as the
 * server module: name prefix, then word prefix, then anywhere; phone digits,
 * email and any car's VIN also match; ties break on how recently seen.
 */
export function matchLotCustomers(customers: LotCustomer[], query: string, limit = 6): LotCustomer[] {
  const q = s(query, 120).toLowerCase();
  const qd = q.replace(/\D+/g, "");
  if (q.length < 2) return [];
  const scored: { c: LotCustomer; score: number }[] = [];
  for (const c of customers) {
    const name = c.name.toLowerCase();
    const email = c.email.toLowerCase();
    const phone = digits(c.phone);
    let score = 0;
    if (name.startsWith(q)) score = 4;
    else if (name.split(" ").some((w) => w.startsWith(q))) score = 3;
    else if (name.includes(q)) score = 2;
    if (qd.length >= 3 && phone.includes(qd)) score = Math.max(score, 3);
    if (email && email.startsWith(q)) score = Math.max(score, 3);
    if (c.cars.some((car) => car.vin && car.vin.toLowerCase().includes(q))) score = Math.max(score, 2);
    if (score > 0) scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || b.c.lastSeenMs - a.c.lastSeenMs);
  return scored.slice(0, limit).map((x) => x.c);
}

/** One line per car, the way the picker labels it: "2019 Toyota Camry · 1HG…". */
export function lotCustomerCarLabel(car: LotCustomerCar): string {
  const name = [car.year, car.make, car.model].filter(Boolean).join(" ");
  return [name, car.vin].filter(Boolean).join(" · ");
}

/**
 * One of the business's own people, offered as someone who can be the
 * customer. A yard parks cars for its own staff, and making someone a saved
 * customer first would be filing paperwork to describe a colleague.
 *
 * Returns null for a row with nothing to show or nothing to fill.
 */
export function lotCustomerFromStaffRow(row: Row): LotCustomer | null {
  const name = s(row.fullName ?? row.displayName ?? row.name, 120);
  const email = s(row.email, 180).toLowerCase();
  const phone = s(row.phone ?? row.phoneNumber, 40);
  if (!name && !email) return null;
  return {
    id: `staff:${s(row.id, 120) || email || name}`,
    name: name || email,
    phone,
    email,
    cars: [],
    lastSeenMs: 0,
    staff: true,
  };
}

/**
 * The people the picker can offer: everyone the lot remembers, plus its own
 * staff. Saved customers win a tie, because they carry cars and a real last
 * seen; a staff row only carries contact details.
 */
export function lotCustomerSources(
  saved: LotCustomer[],
  staff: LotCustomer[],
): LotCustomer[] {
  const identity = (c: LotCustomer) =>
    digits(c.phone) || c.email.toLowerCase() || c.name.trim().toLowerCase();
  const seen = new Set<string>();
  const out: LotCustomer[] = [];
  for (const customer of [...saved, ...staff]) {
    const key = identity(customer);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(customer);
  }
  return out;
}
