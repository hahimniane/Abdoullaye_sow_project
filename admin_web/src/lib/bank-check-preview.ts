// Sample bank answers for the business console's local preview
// (`?preview=1&console=business` on localhost), so Check bank, Use for a
// sale and the owner's bank card can be checked in a browser without a
// signed-in owner, a server or a bank. Never read outside preview mode.
//
// Same shapes as the callables (docs/ZELLE_BANK_CHECK.md); refusals carry
// `details.reason` like the server's. The amounts tell the story:
// $40.00 arrived once, $25.00 twice, anything else "not yet" until its
// third check (then it arrives).

type Row = Record<string, unknown>;

const SALE_RECORDS = [
  { kind: "inventory_sale", id: "sale-preview-1", who: "Mariama Sow", what: "2 x Rice 25 kg, Oil" },
  { kind: "inventory_credit_payment", id: "credit-preview-1", who: "Ibrahima Diallo", what: "Phone case, Charger" },
  { kind: "container_line_payment", id: "line-pay-preview-1", who: "Awa Camara", what: "CL-K7M4P2" },
];

type State = {
  status: "active" | "needs_reauth" | "disconnected";
  refreshLimit: number;
  windowMinutes: number;
  checks: number;
  refreshes: number;
  tries: Map<number, number>;
  used: Set<string>;
};

let state: State | null = null;

function store(): State {
  if (!state) {
    state = { status: "active", refreshLimit: 100, windowMinutes: 15, checks: 23, refreshes: 18, tries: new Map(), used: new Set() };
  }
  return state;
}

/** Starts the preview over (tests). */
export function resetBankPreview() {
  state = null;
}

function refusal(reason: string): Error {
  const error = new Error(reason) as Error & { code: string; details: { reason: string } };
  error.code = "functions/failed-precondition";
  error.details = { reason };
  return error;
}

function usage(s: State) {
  return {
    month: new Date().toISOString().slice(0, 7),
    checks: s.checks,
    refreshes: s.refreshes,
    refreshesFailed: 1,
    estimatedCostCents: s.refreshes * 12,
    refreshLimit: s.refreshLimit,
    limitReached: s.refreshes >= s.refreshLimit,
    byStaff: [
      { uid: "u-aminata", name: "Aminata Diallo", checks: 14, refreshes: 11 },
      { uid: "u-owner", name: "Atlantic Owner", checks: 6, refreshes: 5 },
      { uid: "u-noname", name: "", checks: 3, refreshes: 2 },
    ],
  };
}

function deposits(s: State, amountCents: number, now: number) {
  const id = (n: number) => `atlantic_exports_preview_${amountCents}_${n}`;
  const free = (list: Row[]) => list.filter((d) => !s.used.has(String(d.creditId)));
  if (amountCents === 4000) {
    return free([{ creditId: id(1), amountCents, atMs: now - 4 * 60_000, timeKnown: true, senderName: "FATOU BAH", pending: true }]);
  }
  if (amountCents === 2500) {
    return free([
      { creditId: id(1), amountCents, atMs: now - 3 * 60_000, timeKnown: true, senderName: "MAMADOU BARRY", pending: false },
      { creditId: id(2), amountCents, atMs: Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate(), 12), timeKnown: false, senderName: "KADIATOU SYLLA", pending: false },
    ]);
  }
  return (s.tries.get(amountCents) ?? 0) >= 3
    ? free([{ creditId: id(1), amountCents, atMs: now - 30_000, timeKnown: true, senderName: "OUSMANE BAH", pending: true }])
    : [];
}

/** The preview's answer to a bank callable (same shapes as the server). */
export async function previewBankCall(name: string, data: Row, now: number = Date.now()): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const s = store();
  switch (name) {
    case "getBusinessBankStatus":
      return {
        connected: s.status !== "disconnected",
        status: s.status,
        windowMinutes: s.windowMinutes,
        institutionName: s.status === "disconnected" ? "" : "Chase",
        accountMask: s.status === "disconnected" ? "" : "1234",
        accountName: s.status === "disconnected" ? "" : "Business Checking",
        lastSyncAt: now - 2 * 60_000,
        lastErrorCode: null,
        refreshLimit: s.refreshLimit,
        usage: usage(s),
      };
    case "setBankCheckWindow": {
      if (data.refreshLimit !== undefined) {
        const limit = Number(data.refreshLimit);
        if (!Number.isInteger(limit) || limit < 0 || limit > 1000) throw refusal("limit_invalid");
        s.refreshLimit = limit;
      }
      if (data.minutes !== undefined) s.windowMinutes = Number(data.minutes);
      return { success: true, windowMinutes: s.windowMinutes, refreshLimit: s.refreshLimit };
    }
    case "disconnectBusinessBank":
      s.status = "disconnected";
      return { success: true, connected: false, status: "disconnected" };
    case "checkZellePayment": {
      if (data.mode !== "standalone") throw refusal("bank_not_connected");
      if (s.status !== "active") throw refusal(s.status === "needs_reauth" ? "bank_needs_reauth" : "bank_not_connected");
      const amountCents = data.amountCents;
      if (typeof amountCents !== "number" || !Number.isInteger(amountCents) || amountCents < 1) throw refusal("check_amount_invalid");
      if (data.auto !== true) s.checks += 1;
      s.tries.set(amountCents, (s.tries.get(amountCents) ?? 0) + 1);
      const list = deposits(s, amountCents, now);
      const since = data.since === "1h" || data.since === "today" ? data.since : "15m";
      return {
        result: list.length === 0 ? "not_found" : list.length === 1 ? "received" : "several",
        deposits: list,
        since,
        fromMs: now - (since === "1h" ? 3_600_000 : 900_000),
        limitReached: s.refreshes >= s.refreshLimit,
      };
    }
    case "confirmZelleCandidate": {
      const creditId = String(data.creditId || "");
      const amountCents = Number(creditId.split("_").at(-2));
      if (data.mode === "records") {
        const query = String(data.query || "").toLowerCase();
        const records = SALE_RECORDS.filter((r) => !s.used.has(`${r.kind}:${r.id}`))
          .map((r, index) => ({ ...r, amountCents, atMs: now - (index + 1) * 47 * 60_000 }))
          .filter((r) => !query || [r.who, r.what, r.id].some((field) => field.toLowerCase().includes(query)));
        return { records, searched: Boolean(query) };
      }
      if (data.mode === "use") {
        const deposit = deposits(s, amountCents, now).find((d) => d.creditId === creditId);
        if (!deposit) throw refusal("candidate_taken");
        s.used.add(creditId);
        s.used.add(`${data.kind}:${data.id}`);
        return {
          result: "confirmed",
          confirmation: { amountCents, atMs: deposit.atMs, timeKnown: deposit.timeKnown, senderName: deposit.senderName, institutionName: "Chase" },
        };
      }
      throw refusal("mode_invalid");
    }
    default:
      throw refusal("bank_error");
  }
}
