/**
 * The one reader for money people type into the consoles - the mirror of
 * the app's `lib/utils/money_input.dart`, rule for rule, so "12,50" means
 * twelve dollars fifty on the phone and in the browser alike.
 *
 * - `12.50`, `12,50`, `0,5`, `.5` - one mark followed by one or two digits
 *   is the decimal mark.
 * - `1,200`, `1,200.50`, `1.200,50`, `1 200,50` - a separator in valid
 *   thousands grouping is a thousands separator.
 * - `1,2,3`, `12,500,5`, `1,20.5`, `12.34.56` - no single clean reading, so
 *   refused rather than guessed at. Guessing is how "12,50" became $1,250.
 * - `12.505` - finer than a cent: refused with its own reason.
 *
 * Integer cents end to end: dollars and cents are read separately, never
 * multiplied as a float.
 */

export type MoneyInputIssue = "empty" | "invalid" | "fractionalCents";

export type MoneyInput =
  | { cents: number; issue: null }
  | { cents: null; issue: MoneyInputIssue };

const MAX_DOLLAR_DIGITS = 12;
const refused = (issue: MoneyInputIssue): MoneyInput => ({ cents: null, issue });
const DIGITS = /^[0-9]*$/;

export function readMoneyInput(input: unknown): MoneyInput {
  let text = String(input ?? "").replace(/[\s  ]/g, "").replace(/\$/g, "");
  if (!text) return refused("empty");
  let negative = false;
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }
  if (!text || !/^[0-9.,]+$/.test(text)) return refused("invalid");

  const commas = (text.match(/,/g) || []).length;
  const dots = (text.match(/\./g) || []).length;
  let decimalMark: "," | "." | null = null;
  let groupMark: "," | "." | null = null;
  if (commas > 0 && dots > 0) {
    decimalMark = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
    groupMark = decimalMark === "," ? "." : ",";
    if ((decimalMark === "," ? commas : dots) !== 1) return refused("invalid");
  } else if (commas + dots === 1) {
    const mark = commas === 1 ? "," : ".";
    const after = text.length - text.indexOf(mark) - 1;
    if (mark === "," && after === 3) groupMark = ",";
    else if (mark === "," && after > 3) return refused("invalid");
    else decimalMark = mark;
  } else if (commas > 1 || dots > 1) {
    groupMark = commas > 1 ? "," : ".";
  }

  let whole = text;
  let fraction = "";
  if (decimalMark) {
    const at = text.lastIndexOf(decimalMark);
    whole = text.slice(0, at);
    fraction = text.slice(at + 1);
    if (!fraction || !DIGITS.test(fraction)) return refused("invalid");
  }
  if (groupMark) {
    const groups = whole.split(groupMark);
    const first = groups[0];
    if (!first || first.length > 3 || !DIGITS.test(first)) return refused("invalid");
    if (groups.slice(1).some((g) => g.length !== 3 || !DIGITS.test(g))) {
      return refused("invalid");
    }
    whole = groups.join("");
  }
  if (!DIGITS.test(whole) || (!whole && !fraction)) return refused("invalid");
  if (fraction.length > 2) return refused("fractionalCents");
  const trimmed = whole.replace(/^0+(?=\d)/, "");
  if (trimmed.length > MAX_DOLLAR_DIGITS) return refused("invalid");
  const dollars = trimmed ? Number(trimmed) : 0;
  const cents = fraction ? Number(fraction.padEnd(2, "0")) : 0;
  const total = dollars * 100 + cents;
  return { cents: negative ? -total : total, issue: null };
}

/** Signed whole cents, or null when the text is empty or unusable. */
export function parseMoneyCents(input: unknown): number | null {
  return readMoneyInput(input).cents;
}

/**
 * Typed dollars as a number of dollars (for fields stored in dollars:
 * prices, fees, rates), read through cents so it is exact to the cent.
 * Blank gives `whenBlank`; unreadable text gives NaN, which the forms
 * already refuse.
 */
export function moneyDollars(input: unknown, whenBlank = NaN): number {
  const read = readMoneyInput(input);
  if (read.issue === "empty") return whenBlank;
  return read.cents === null ? NaN : read.cents / 100;
}
