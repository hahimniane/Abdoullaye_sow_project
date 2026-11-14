// Fleet phase 1b on the console (docs/FLEET.md §8): the pay-day bank-check
// schedule the business picks, its monthly cost, and the deposits waiting
// for a driver. The schedule and cost mirror functions/fleet_bank.js (shared
// fixture functions/test/fixtures/fleet-bank-cases.json); the server
// decides what is saved and billed.

type Row = Record<string, unknown>;

export const BANK_REFRESH_EVERY = [0, 15, 30, 60] as const;
export const PLAID_REFRESH_CENTS = 12;

export type BankSchedule = {
  every: number;
  fromHour: number;
  toHour: number;
  monthDays: number[];
  mondays: boolean;
};

export type BankQuote = { perDay: number; days: number; perMonth: number; centsEach: number; monthCents: number };

export type WaitingDeposit = {
  id: string;
  amountCents: number;
  senderName: string;
  atMs: number;
  dateKey: string;
  pending: boolean;
  reason: string;
};

export type FleetBankStatus = {
  schedule: BankSchedule;
  quote: BankQuote;
  bank: { connected: boolean; institutionName: string; accountMask: string };
  waiting: WaitingDeposit[];
  lastScheduledMs: number;
};

const DEFAULTS = { every: 0, fromHour: 7, toHour: 23 };
const MONDAYS_PER_MONTH = 4;

function wholeIn(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** The schedule as the server saves it (fleet_bank.cleanBankSchedule). */
export function cleanBankSchedule(input: unknown): BankSchedule {
  const raw = (input && typeof input === "object" ? input : {}) as Row;
  const every = (BANK_REFRESH_EVERY as readonly number[]).includes(Number(raw.every)) ? Number(raw.every) : 0;
  let fromHour = wholeIn(raw.fromHour, 0, 23, DEFAULTS.fromHour);
  let toHour = wholeIn(raw.toHour, 1, 24, DEFAULTS.toHour);
  if (toHour <= fromHour) {
    fromHour = DEFAULTS.fromHour;
    toHour = DEFAULTS.toHour;
  }
  const days = Array.isArray(raw.monthDays) ? raw.monthDays : [];
  const monthDays = [...new Set(days.map((d) => Math.trunc(Number(d))).filter((d) => d >= 1 && d <= 28))].sort((a, b) => a - b);
  return { every, fromHour, toHour, monthDays, mondays: raw.mondays === true };
}

/** Checks a month and their cost (fleet_bank.bankScheduleQuote). */
export function bankScheduleQuote(schedule: unknown, centsEach: number = PLAID_REFRESH_CENTS): BankQuote {
  const s = cleanBankSchedule(schedule);
  const price = Number.isFinite(Number(centsEach)) && Number(centsEach) >= 0 ? Math.round(Number(centsEach)) : PLAID_REFRESH_CENTS;
  const perDay = s.every > 0 ? Math.floor(((s.toHour - s.fromHour) * 60) / s.every) : 0;
  const days = s.monthDays.length + (s.mondays ? MONDAYS_PER_MONTH : 0);
  const perMonth = perDay * days;
  return { perDay, days, perMonth, centsEach: price, monthCents: perMonth * price };
}

/** "7 AM", "11 PM", "midnight" for an hour 0-24 (US 12-hour clock). */
export function hourLabel(hour: number, lang: "en" | "fr" = "en"): string {
  if (lang === "fr") return hour === 24 || hour === 0 ? "minuit" : `${hour} h`;
  if (hour === 0 || hour === 24) return "midnight";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The bank_status answer, read defensively. */
export function readFleetBankStatus(answer: unknown): FleetBankStatus {
  const a = (answer && typeof answer === "object" ? answer : {}) as Row;
  const schedule = cleanBankSchedule(a.schedule);
  const q = (a.quote && typeof a.quote === "object" ? a.quote : {}) as Row;
  const bank = (a.bank && typeof a.bank === "object" ? a.bank : {}) as Row;
  const waiting = Array.isArray(a.waiting) ? (a.waiting as Row[]) : [];
  return {
    schedule,
    quote: bankScheduleQuote(schedule, num(q.centsEach) || PLAID_REFRESH_CENTS),
    bank: { connected: bank.connected === true, institutionName: String(bank.institutionName ?? ""), accountMask: String(bank.accountMask ?? "") },
    waiting: waiting.map((w) => ({
      id: String(w.id ?? ""),
      amountCents: num(w.amountCents),
      senderName: String(w.senderName ?? ""),
      atMs: num(w.atMs),
      dateKey: String(w.dateKey ?? ""),
      pending: w.pending === true,
      reason: String(w.reason ?? "unknown"),
    })).filter((w) => w.id && w.amountCents > 0),
    lastScheduledMs: num(a.lastScheduledMs),
  };
}

/** Why a deposit is waiting, in the office's words. */
export function waitingReasonText(reason: string): string {
  if (reason === "two_drivers") return "It could be from two drivers: pick the right one.";
  if (reason === "undone") return "Its payment was undone: pick the right driver.";
  if (reason === "possible_duplicate")
    return "This may be a Zelle already used, sent again by the bank. Pay it only if the driver really sent it twice.";
  if (reason === "own_transfer")
    return "This is a transfer from a bank account, not a Zelle from a person. Use it for a driver only if they really paid this way.";
  return "Laawol does not know this sender yet: pick the driver once and it is remembered.";
}
