// Fleet payment claims on the console (docs/FLEET_PAYMENT_PROOF.md, "Office").
// A driver's WhatsApp screenshot is only a claim; the bank deposit is the
// proof. This file turns the fleetClaims snapshot into the rows the office
// sees: which claims are still open, what each one is waiting for (one plain
// sentence per state and reason), oldest first, and which waiting deposits
// the office may hand to a claim. Pure: no React, no Firebase, no clock of
// its own. Built once per snapshot, never per row render.

type Row = Record<string, unknown>;

export const CLAIM_STATES = ["asking_driver", "asking_amount", "waiting_bank", "asking_name", "paid", "office", "closed"] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

export const CLAIM_OFFICE_REASONS = ["wrong_recipient", "deposit_taken", "too_old", "not_a_driver", "two_claims", "no_amount", "no_deposit", "payment_undone"] as const;

export type FleetClaim = {
  id: string;
  driverId: string | null;
  fromPhone: string;
  state: ClaimState | "unknown";
  amountCents: number | null;
  payerName: string;
  hasPhoto: boolean;
  creditId: string;
  paymentId: string;
  reason: string;
  createdAtMs: number;
  toldLateAtMs: number;
  closeAtMs: number;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const ms = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/** One fleetClaims document, read defensively. */
export function readClaim(raw: unknown): FleetClaim | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Row;
  const id = str(r.id);
  if (!id) return null;
  const state = str(r.state);
  const amount = Math.round(Number(r.amountCents));
  return {
    id,
    driverId: str(r.driverId) || null,
    fromPhone: str(r.fromPhone),
    state: (CLAIM_STATES as readonly string[]).includes(state) ? (state as ClaimState) : "unknown",
    amountCents: r.amountCents !== null && r.amountCents !== undefined && Number.isFinite(amount) && amount > 0 ? amount : null,
    payerName: str(r.payerName),
    hasPhoto: r.hasPhoto === true || Boolean(str(r.mediaPath)),
    creditId: str(r.creditId),
    paymentId: str(r.paymentId),
    reason: str(r.reason),
    createdAtMs: ms(r.createdAtMs),
    toldLateAtMs: ms(r.toldLateAtMs),
    closeAtMs: ms(r.closeAtMs),
  };
}

/** What the photo button shows once the server answered `claim_photo`: the picture, the 12-month notice, or none. */
export type PhotoAnswer = { kind: "url"; url: string } | { kind: "deleted" } | { kind: "none" };

export function readPhotoAnswer(result: unknown): PhotoAnswer {
  const r = (result && typeof result === "object" ? result : {}) as Row;
  const url = str(r.url);
  if (url) return { kind: "url", url };
  return r.deleted === true ? { kind: "deleted" } : { kind: "none" };
}

export const PHOTO_DELETED_TEXT = "This photo was deleted after 12 months.";
export const PHOTO_NONE_TEXT = "No photo";

/** Claims the office still looks at: the driver's side is open, or a person is needed. Paid, closed and unreadable are not listed. */
export function isOpenClaim(claim: FleetClaim): boolean {
  return claim.state !== "paid" && claim.state !== "closed" && claim.state !== "unknown";
}

/** What an open claim is waiting for, in the office's words. One sentence per state and reason. */
export function claimSentence(claim: Pick<FleetClaim, "state" | "reason" | "toldLateAtMs">): string {
  switch (claim.state) {
    case "asking_driver":
      return "Waiting for the sender to say which driver this payment is for.";
    case "asking_amount":
      return "Waiting for the driver to type the amount.";
    case "asking_name":
      return "Waiting for the driver to say the name on the account they paid from.";
    case "waiting_bank":
      return claim.toldLateAtMs > 0
        ? "The deposit has not shown in the bank after 2 days. The driver was told."
        : "Waiting for the deposit to show in the bank.";
    case "office":
      if (claim.reason === "wrong_recipient") return "The payment went to someone other than this business. Look at the photo.";
      if (claim.reason === "deposit_taken") return "The deposit it matches was already used for another payment.";
      if (claim.reason === "too_old") return "The screenshot is more than 10 days old.";
      if (claim.reason === "not_a_driver") return "This phone is not one of your drivers. Find out who the payment is for.";
      if (claim.reason === "two_claims") return "Two claims point to the same deposit. Pick who it belongs to.";
      if (claim.reason === "no_amount") return "The driver did not give a readable amount. Look at the photo.";
      if (claim.reason === "no_deposit") return "No deposit has shown in the bank after 2 days.";
      if (claim.reason === "payment_undone") return "The payment made from this report was undone. Pick the right deposit or close it.";
      return "A person needs to look at this claim.";
    default:
      return "";
  }
}

export type ClaimView = {
  id: string;
  /** The driver it came from ("" when the phone matched nobody). */
  driverId: string;
  /** Driver's name, else the phone the photo came from. */
  who: string;
  hasDriver: boolean;
  amountCents: number | null;
  atMs: number;
  sentence: string;
  hasPhoto: boolean;
  state: FleetClaim["state"];
};

/**
 * The rows of the panel: open claims only, oldest first (the one waiting
 * longest on top), with the driver's name looked up once.
 */
export function openClaimViews(rows: readonly unknown[], driverNames: ReadonlyMap<string, string>): ClaimView[] {
  const out: ClaimView[] = [];
  for (const raw of rows) {
    const claim = readClaim(raw);
    if (!claim || !isOpenClaim(claim)) continue;
    const name = claim.driverId ? driverNames.get(claim.driverId) || "" : "";
    out.push({
      id: claim.id,
      driverId: claim.driverId ?? "",
      who: name || claim.fromPhone || "—",
      hasDriver: Boolean(name),
      amountCents: claim.amountCents,
      atMs: claim.createdAtMs,
      sentence: claimSentence(claim),
      hasPhoto: claim.hasPhoto,
      state: claim.state,
    });
  }
  return out.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
}

type OfferDeposit = { id: string; amountCents: number; atMs: number; pending: boolean };

/**
 * The waiting deposits a claim may be given. A deposit still pending at the
 * bank is never offered (it can change). Same amount first, then newest. The
 * bank's amount is what is recorded (Q3), so a different amount is allowed:
 * the picker marks it.
 */
export function depositsForClaim<T extends OfferDeposit>(
  claimAmountCents: number | null,
  waiting: readonly T[],
): { deposit: T; sameAmount: boolean }[] {
  return waiting
    .filter((w) => !w.pending && w.id && w.amountCents > 0)
    .map((deposit) => ({ deposit, sameAmount: claimAmountCents !== null && deposit.amountCents === claimAmountCents }))
    .sort((a, b) => Number(b.sameAmount) - Number(a.sameAmount) || b.deposit.atMs - a.deposit.atMs || a.deposit.id.localeCompare(b.deposit.id));
}

/** Remembered payer names, cleaned the way the list is saved: trimmed, one space, no empty, no duplicate (any case). */
export function cleanPayerNames(names: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const name = String(n ?? "").replace(/\s+/g, " ").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** The remembered names on an old or new driver record (rememberedSenders), read defensively. */
export function readPayerNames(driver: unknown): string[] {
  const d = (driver && typeof driver === "object" ? driver : {}) as Row;
  const raw = d.rememberedSenders;
  if (Array.isArray(raw)) return cleanPayerNames(raw);
  if (raw && typeof raw === "object") return cleanPayerNames(Object.keys(raw as Row));
  return [];
}
