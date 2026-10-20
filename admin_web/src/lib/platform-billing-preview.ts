// Sample bills for the console's local preview (`?preview=1` on localhost),
// so the Bills page can be checked in a browser - read, record a payment,
// close and reopen a month, change a deal, try other rates - without a
// signed-in admin or a server. Never read outside preview mode.
//
// It answers the `platformBilling` actions with the same shapes, from an
// in-memory state that lives as long as the page. Counts reuse the Volume
// preview (volume-preview.ts) so both pages tell the same story; bills are
// worked out with the console's mirror of the server math
// (platform-billing.ts), so a preview figure is what the server would say.

import {
  computeBill,
  dealInEffect,
  isEmptyDeal,
  monthIsOver,
  monthStanding,
  normalizeDeal,
  normalizeUsage,
  paymentDraftErrors,
  todayInNewYork,
  type BillBankUsage,
  type BusinessBillResponse,
  type Deal,
  type DealVersion,
  type Drift,
  type DriftItem,
  type MonthBillsResponse,
  type MonthRow,
  type Payment,
  type Usage,
  type WhatIfAllResponse,
  type WhatIfOneResponse,
  type WhatIfRow,
  centsToInput,
} from "./platform-billing.ts";
import { currentVolumeMonth, shiftVolumeMonth, VOLUME_TIME_ZONE } from "./volume.ts";
import { previewPlatformVolume } from "./volume-preview.ts";

/** `bank`: the business connected its bank for Zelle checks (Check bank, docs/ZELLE_BANK_CHECK.md). */
type Business = { id: string; name: string; parking: boolean; shop: boolean; bank: boolean; feePct: number | null };

const BUSINESSES: Business[] = [
  { id: "atlantic_exports", name: "Atlantic Exports", parking: false, shop: false, bank: true, feePct: 0.08 },
  { id: "keren_auto_sales", name: "Keren Auto Sales", parking: true, shop: false, bank: false, feePct: null },
  { id: "sahel_freight", name: "Sahel Freight", parking: false, shop: false, bank: false, feePct: null },
  { id: "dakar_parking", name: "Dakar Parking Lot", parking: true, shop: false, bank: false, feePct: 0.05 },
  { id: "teranga_shop", name: "Teranga Shop", parking: false, shop: true, bank: true, feePct: null },
];

type MonthDoc = {
  status: "open" | "closed";
  paidCents: number;
  amountCents: number | null;
  snapshot: { bill: ReturnType<typeof computeBill>; usage: Usage; deal: Deal | null; dealVersionId: string } | null;
  closedAtMs: number | null;
  closedBy: string;
  reopenHistory: Array<{ reopenedAtMs: number; reopenedBy: string; reason: string; closedAmountCents: number }>;
};

type State = {
  deals: Map<string, { versions: DealVersion[]; commissionMode: "keep" | "replace" }>;
  months: Map<string, MonthDoc>;
  payments: Array<Payment & { businessId: string; month: string }>;
  extra: Map<string, number>;
};

const ME = "preview-admin";
const PEOPLE: Record<string, string> = { [ME]: "Preview admin", "preview-finance": "Aminata Diallo" };

function monthsBack(month: string, current: string): number {
  const index = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7));
  return index(current) - index(month);
}

/** A month's records for a sample business (Volume's counts, plus made-up prices, parking and sales). */
function usageOf(state: State, id: string, month: string, current: string): Usage {
  const back = monthsBack(month, current);
  const row = previewPlatformVolume(month, current).businesses.find((b) => b.businessId === id);
  const barrels = row?.barrels ?? 0;
  const packages = row?.packages ?? 0;
  // "3 packages added since you closed" in the preview's closed month.
  const extra = state.extra.get(`${id}_${month}`) ?? 0;
  const count = packages + extra;
  const prices = Array.from({ length: count }, (_, i) => (i % 6 === 5 ? null : 2500 + ((i * 1700 + back * 300) % 9000)));
  const business = BUSINESSES.find((b) => b.id === id);
  const parkingCars = business?.parking && back >= 0 && back <= 11 ? 6 + ((back * 5 + id.length) % 9) : 0;
  const itemsSold = business?.shop && back >= 0 && back <= 11 ? 180 + ((back * 37) % 140) : 0;
  const bank = bankOf(id, month, current);
  return normalizeUsage({
    barrels,
    packages: count,
    cars: row?.cars ?? 0,
    packagePrices: prices,
    parkingCars: business?.parking ? parkingCars : null,
    parkingBilledCents: business?.parking ? parkingCars * 31500 : null,
    itemsSold: business?.shop ? itemsSold : null,
    bankConnected: business?.bank ? bank.connected : null,
    bankRefreshes: business?.bank ? bank.refreshes : null,
  });
}

/** A month of Check bank for a sample business: connected from 3 months back, 37 paid refreshes this month. */
function bankOf(id: string, month: string, current: string): { connected: boolean; checks: number; refreshes: number } {
  const back = monthsBack(month, current);
  const business = BUSINESSES.find((b) => b.id === id);
  if (!business?.bank || back < 0 || back > 3) return { connected: false, checks: 0, refreshes: 0 };
  const refreshes = id === "teranga_shop" ? 37 - back * 6 : 12 - back * 2;
  return { connected: true, checks: refreshes + 9, refreshes };
}

function bankUsageOf(id: string, month: string, current: string): BillBankUsage {
  const bank = bankOf(id, month, current);
  const split = (n: number, part: number) => Math.round((n * part) / 10);
  const byStaff = bank.checks > 0
    ? [
        { uid: "preview-staff-1", name: "Aminata Diallo", checks: split(bank.checks, 6), refreshes: split(bank.refreshes, 6) },
        { uid: "preview-staff-2", name: "", checks: bank.checks - split(bank.checks, 6), refreshes: bank.refreshes - split(bank.refreshes, 6) },
      ]
    : [];
  return {
    month,
    checks: bank.checks,
    refreshes: bank.refreshes,
    refreshesFailed: bank.refreshes > 0 ? 1 : 0,
    estimatedCostCents: bank.refreshes * 12,
    refreshLimit: 100,
    limitReached: bank.refreshes >= 100,
    byStaff,
    connected: bank.connected,
  };
}

function commissionOf(id: string, month: string, current: string): number {
  const back = monthsBack(month, current);
  if (back < 0 || back > 11) return 0;
  const base: Record<string, number> = { atlantic_exports: 18450, keren_auto_sales: 9620, dakar_parking: 4410 };
  return Math.round((base[id] ?? 0) * (1 - (back % 3) * 0.12));
}

function version(effectiveFrom: string, raw: unknown, note: string, createdAtMs: number): DealVersion {
  const { deal } = normalizeDeal(raw);
  return { id: `v-${effectiveFrom}-${createdAtMs}`, effectiveFrom, deal: deal as Deal, note, createdAtMs, createdBy: "preview-finance" };
}

let state: State | null = null;

function initial(current: string): State {
  const at = Date.UTC(2026, 0, 1);
  const s: State = { deals: new Map(), months: new Map(), payments: [], extra: new Map() };
  s.deals.set("atlantic_exports", {
    commissionMode: "keep",
    versions: [
      version(shiftVolumeMonth(current, -6), { barrel: { centsEach: 400 }, package: { mode: "fixed", centsEach: 100 } }, "Launch rate", at),
      version(shiftVolumeMonth(current, -2), { barrel: { centsEach: 500 }, package: { mode: "fixed", centsEach: 100 }, minimumCents: 5000 }, "New season", at + 1),
    ],
  });
  s.deals.set("keren_auto_sales", {
    commissionMode: "keep",
    versions: [
      version(shiftVolumeMonth(current, -4), {
        package: { mode: "percent", bps: 500, minCents: 100 },
        shippedCar: { centsEach: 4000 },
        parking: { mode: "perCar", centsEach: 1000 },
      }, "", at + 2),
    ],
  });
  s.deals.set("dakar_parking", {
    commissionMode: "replace",
    versions: [version(shiftVolumeMonth(current, -3), { parking: { mode: "percent", bps: 1000 }, flatCents: 2500 }, "Replaces the 5% card commission", at + 3)],
  });
  s.deals.set("teranga_shop", {
    commissionMode: "keep",
    versions: [
      version(shiftVolumeMonth(current, -1), { itemSold: { centsEach: 15 }, capCents: 20000 }, "", at + 4),
      version(current, { itemSold: { centsEach: 15 }, bankConnection: { centsEach: 300 }, bankCheck: { centsEach: 20 }, capCents: 20000 }, "Check bank added", at + 5),
    ],
  });
  // Last month: Atlantic closed and part paid, then 3 packages came in.
  const prev = shiftVolumeMonth(current, -1);
  const closed = (id: string, month: string) => {
    const deal = dealInEffect(s.deals.get(id)?.versions ?? [], month);
    const usage = usageOf(s, id, month, current);
    const bill = computeBill({ deal: deal?.deal ?? null, usage, commissionCents: commissionOf(id, month, current) });
    s.months.set(`${id}_${month}`, {
      status: "closed",
      paidCents: 0,
      amountCents: bill.amountCents,
      snapshot: { bill, usage, deal: deal?.deal ?? null, dealVersionId: deal?.id ?? "" },
      closedAtMs: Date.now() - 6 * 86400000,
      closedBy: "preview-finance",
      reopenHistory: [],
    });
    return bill.amountCents;
  };
  const owed = closed("atlantic_exports", prev);
  s.extra.set(`atlantic_exports_${prev}`, 3);
  closed("keren_auto_sales", shiftVolumeMonth(current, -2));
  const pay = (businessId: string, month: string, amountCents: number, method: string, note: string) => {
    s.payments.push({
      id: `p${s.payments.length + 1}`,
      businessId,
      month,
      amountCents,
      paidOn: `${month}-28`,
      method,
      note,
      recordedBy: "preview-finance",
      recordedAtMs: Date.now() - 3 * 86400000,
      voided: false,
      voidedBy: "",
      voidedAtMs: null,
      voidReason: "",
    });
    const doc = s.months.get(`${businessId}_${month}`);
    if (doc) doc.paidCents += amountCents;
    else s.months.set(`${businessId}_${month}`, { status: "open", paidCents: amountCents, amountCents: null, snapshot: null, closedAtMs: null, closedBy: "", reopenHistory: [] });
  };
  pay("atlantic_exports", prev, Math.min(owed, 5000), "zelle", "First part");
  return s;
}

function store(current: string): State {
  if (!state) state = initial(current);
  return state;
}

/** Starts the preview over (tests). */
export function resetBillingPreview() {
  state = null;
}

function refusal(code: string): Error {
  const error = new Error(code) as Error & { details: { reasons: string[] } };
  error.details = { reasons: [code] };
  return error;
}

type Row = {
  businessId: string;
  name: string;
  status: "open" | "closed";
  deal: Deal | null;
  hasDeal: boolean;
  effectiveFrom: string;
  dealVersionId: string;
  usage: Usage;
  liveUsage: Usage;
  bill: ReturnType<typeof computeBill>;
  liveBill: ReturnType<typeof computeBill>;
  amountCents: number;
  paidCents: number;
  commissionCents: number;
  drift: Drift | null;
  doc: MonthDoc | null;
};

function driftOf(snapshot: NonNullable<MonthDoc["snapshot"]>, usage: Usage, commission: number): Drift {
  const fig = (u: Usage, c: number) => ({
    barrels: u.barrels,
    packages: u.packages,
    cars: u.cars,
    parkingCars: u.parkingCars,
    itemsSold: u.itemsSold,
    bankConnected: u.bankConnected === null ? null : Number(u.bankConnected),
    bankRefreshes: u.bankRefreshes,
    commissionCents: c,
  });
  const before = fig(snapshot.usage, snapshot.bill.commissionCents);
  const after = fig(usage, commission);
  const items: DriftItem[] = [];
  for (const key of Object.keys(before) as Array<keyof typeof before>) {
    const a = before[key];
    const b = after[key];
    if (a === null || b === null || a === b) continue;
    items.push({ key, kind: key === "commissionCents" ? "cents" : "count", before: a, after: b, delta: b - a });
  }
  const now = computeBill({ deal: snapshot.deal, usage, commissionCents: commission });
  return {
    changed: items.length > 0,
    items,
    closedAmountCents: snapshot.bill.amountCents,
    amountNowCents: now.amountCents,
    amountDeltaCents: now.amountCents - snapshot.bill.amountCents,
  };
}

function rowFor(s: State, id: string, month: string, current: string): Row {
  const business = BUSINESSES.find((b) => b.id === id);
  const doc = s.months.get(`${id}_${month}`) ?? null;
  const version = dealInEffect(s.deals.get(id)?.versions ?? [], month);
  const snapshot = doc?.status === "closed" ? doc.snapshot : null;
  const liveDeal = snapshot ? snapshot.deal : (version?.deal ?? null);
  const usage = usageOf(s, id, month, current);
  const commission = commissionOf(id, month, current);
  const live = computeBill({ deal: liveDeal, usage, commissionCents: commission });
  const bill = snapshot ? snapshot.bill : live;
  return {
    businessId: id,
    name: business?.name ?? id,
    status: snapshot ? "closed" : "open",
    deal: liveDeal,
    hasDeal: Boolean(liveDeal) && !isEmptyDeal(liveDeal),
    effectiveFrom: version?.effectiveFrom ?? "",
    dealVersionId: snapshot ? snapshot.dealVersionId : (version?.id ?? ""),
    usage: snapshot ? snapshot.usage : usage,
    liveUsage: usage,
    bill,
    liveBill: live,
    amountCents: bill.amountCents,
    paidCents: doc?.paidCents ?? 0,
    commissionCents: snapshot ? bill.commissionCents : commission,
    drift: snapshot ? driftOf(snapshot, usage, commission) : null,
    doc,
  };
}

function unpaidToDate(s: State, id: string): number {
  let sum = 0;
  for (const [key, doc] of s.months) {
    if (key.startsWith(`${id}_`) && doc.status === "closed") sum += Math.max(0, (doc.amountCents ?? 0) - doc.paidCents);
  }
  return sum;
}

function candidates(s: State, month: string, current: string): string[] {
  const volume = new Set(previewPlatformVolume(month, current).businesses.filter((b) => b.pieces > 0).map((b) => b.businessId));
  return BUSINESSES.filter((b) => s.deals.has(b.id) || volume.has(b.id) || commissionOf(b.id, month, current) > 0)
    .map((b) => ({ id: b.id, name: b.name, hasDeal: Boolean(dealInEffect(s.deals.get(b.id)?.versions ?? [], month)) }))
    .sort((a, b) => Number(b.hasDeal) - Number(a.hasDeal) || a.name.localeCompare(b.name))
    .map((b) => b.id);
}

function monthBills(s: State, month: string, current: string): MonthBillsResponse {
  const rows: MonthRow[] = candidates(s, month, current).map((id) => {
    const row = rowFor(s, id, month, current);
    const standing = monthStanding(row.amountCents, row.paidCents);
    return {
      businessId: id,
      name: row.name,
      hasDeal: row.hasDeal,
      deal: row.deal,
      effectiveFrom: row.effectiveFrom,
      status: row.status,
      counts: {
        barrels: row.usage.barrels,
        packages: row.usage.packages,
        cars: row.usage.cars,
        parkingCars: row.usage.parkingCars,
        itemsSold: row.usage.itemsSold,
        bankRefreshes: row.usage.bankRefreshes,
      },
      amountCents: row.amountCents,
      paidCents: row.paidCents,
      unpaidCents: standing.unpaidCents,
      standing: standing.status,
      commissionCents: row.commissionCents,
      earnedCents: row.commissionCents + row.amountCents,
      unpaidToDateCents: unpaidToDate(s, id),
      drift: row.drift,
      complete: true,
    };
  });
  const sum = (key: "amountCents" | "paidCents" | "commissionCents") => rows.reduce((total, row) => total + row[key], 0);
  return {
    month,
    timeZone: VOLUME_TIME_ZONE,
    summary: {
      owedCents: sum("amountCents"),
      paidCents: sum("paidCents"),
      commissionCents: sum("commissionCents"),
      earnedCents: sum("amountCents") + sum("commissionCents"),
      unpaidToDateCents: BUSINESSES.reduce((total, b) => total + unpaidToDate(s, b.id), 0),
      businesses: rows.length,
      withDeal: rows.filter((row) => row.hasDeal).length,
      candidates: rows.length,
      partial: false,
    },
    rows,
    nextCursor: null,
    complete: true,
    canManage: true,
    computedAtMs: Date.now(),
  };
}

function businessBill(s: State, id: string, month: string, current: string): BusinessBillResponse {
  const business = BUSINESSES.find((b) => b.id === id);
  if (!business) throw refusal("business_not_found");
  const row = rowFor(s, id, month, current);
  const standing = monthStanding(row.amountCents, row.paidCents);
  const deal = s.deals.get(id);
  const months = [...s.months.entries()]
    .filter(([key]) => key.startsWith(`${id}_`))
    .map(([key, doc]) => ({
      month: key.slice(id.length + 1),
      status: doc.status,
      amountCents: doc.status === "closed" ? (doc.amountCents ?? 0) : null,
      paidCents: doc.paidCents,
      unpaidCents: doc.status === "closed" ? Math.max(0, (doc.amountCents ?? 0) - doc.paidCents) : 0,
      closedAtMs: doc.closedAtMs,
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
  const closed = new Set(months.filter((m) => m.status === "closed").map((m) => m.month));
  const versions = deal?.versions ?? [];
  const first = versions.map((v) => v.effectiveFrom).sort()[0];
  const pastOpenMonths: string[] = [];
  if (first) {
    for (let back = 1; back <= 24; back += 1) {
      const at = shiftVolumeMonth(current, -back);
      if (at < first) break;
      const v = dealInEffect(versions, at);
      if (v && !isEmptyDeal(v.deal) && !closed.has(at)) pastOpenMonths.push(at);
    }
  }
  const { usage } = row;
  return {
    business: { id, name: business.name, exists: true, platformFeePct: deal?.commissionMode === "replace" ? 0 : business.feePct },
    month,
    timeZone: VOLUME_TIME_ZONE,
    status: row.status,
    hasDeal: row.hasDeal,
    deal: row.deal,
    dealVersionId: row.dealVersionId,
    effectiveFrom: row.effectiveFrom,
    bill: row.bill,
    usage: { ...usage, packagePrices: undefined },
    liveBill: row.liveBill,
    drift: row.drift,
    closed: row.status === "closed" ? { closedAtMs: row.doc?.closedAtMs ?? null, closedBy: row.doc?.closedBy ?? "", amountCents: row.amountCents } : null,
    reopenHistory: row.doc?.reopenHistory ?? [],
    amountCents: row.amountCents,
    paidCents: row.paidCents,
    unpaidCents: standing.unpaidCents,
    standing,
    commissionCents: row.commissionCents,
    earnedCents: row.commissionCents + row.amountCents,
    payments: s.payments
      .filter((p) => p.businessId === id && p.month === month)
      .map(({ businessId: _b, month: _m, ...p }) => p)
      .sort((a, b) => a.recordedAtMs - b.recordedAtMs),
    versions: [...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAtMs - a.createdAtMs),
    commissionMode: deal?.commissionMode ?? "keep",
    months,
    unpaidToDateCents: unpaidToDate(s, id),
    pastOpenMonths,
    people: PEOPLE,
    bankUsage: bankUsageOf(id, month, current),
    canManage: true,
    complete: true,
    computedAtMs: Date.now(),
  };
}

function whatIf(s: State, data: Record<string, unknown>, current: string): WhatIfOneResponse | WhatIfAllResponse {
  const month = String(data.month || current);
  const { deal: alt, errors } = normalizeDeal(data.deal);
  if (errors.length > 0 || !alt) throw refusal(errors[0] ?? "deal_invalid");
  const one = String(data.businessId || "");
  const compute = (id: string) => {
    const version = dealInEffect(s.deals.get(id)?.versions ?? [], month);
    const usage = usageOf(s, id, month, current);
    const commission = commissionOf(id, month, current);
    return {
      usage,
      now: computeBill({ deal: version?.deal ?? null, usage, commissionCents: commission }),
      alt: computeBill({ deal: alt, usage, commissionCents: commission }),
      commission,
      hasDeal: Boolean(version),
    };
  };
  if (one) {
    const r = compute(one);
    return { month, businessId: one, usage: { ...r.usage, packagePrices: undefined }, now: r.now, alt: r.alt, deltaCents: r.alt.amountCents - r.now.amountCents, complete: true };
  }
  const ids = new Set(candidates(s, month, current));
  for (const b of BUSINESSES) {
    if ((alt.parking && b.parking) || (alt.itemSold && b.shop) || ((alt.bankConnection || alt.bankCheck) && b.bank)) ids.add(b.id);
  }
  const rows: WhatIfRow[] = [...ids].map((id) => {
    const r = compute(id);
    return {
      businessId: id,
      name: BUSINESSES.find((b) => b.id === id)?.name ?? id,
      hasDeal: r.hasDeal,
      usage: { ...r.usage, packagePrices: undefined },
      nowCents: r.now.amountCents,
      altCents: r.alt.amountCents,
      deltaCents: r.alt.amountCents - r.now.amountCents,
      commissionCents: r.commission,
      altLines: r.alt.lines,
      complete: true,
    };
  });
  const sum = (key: "nowCents" | "altCents" | "commissionCents") => rows.reduce((total, row) => total + row[key], 0);
  return {
    month,
    rows,
    totals: { nowCents: sum("nowCents"), altCents: sum("altCents"), deltaCents: sum("altCents") - sum("nowCents"), commissionCents: sum("commissionCents"), businesses: rows.length },
    nextCursor: null,
    candidates: rows.length,
    skipped: 0,
    complete: true,
  };
}

function monthDoc(s: State, key: string): MonthDoc {
  let doc = s.months.get(key);
  if (!doc) {
    doc = { status: "open", paidCents: 0, amountCents: null, snapshot: null, closedAtMs: null, closedBy: "", reopenHistory: [] };
    s.months.set(key, doc);
  }
  return doc;
}

/**
 * The preview's answer to a `platformBilling` call (same shapes; refusals
 * carry `details.reasons` like the server's). Async, with a short pause, so
 * the screens' loading states show.
 */
export async function previewPlatformBilling(data: Record<string, unknown>, current: string = currentVolumeMonth()): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const s = store(current);
  const action = String(data.action || "");
  const month = String(data.month || current);
  const id = String(data.businessId || "");
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  switch (action) {
    case "getMonthBills":
      return clone(monthBills(s, month, current));
    case "getBusinessBill":
      return clone(businessBill(s, id, month, current));
    case "whatIf":
      return clone(whatIf(s, data, current));
    case "saveDeal": {
      const { deal, errors } = normalizeDeal(data.deal);
      if (!deal) throw refusal(errors[0] ?? "deal_invalid");
      const from = String(data.effectiveFrom || current);
      if (s.months.get(`${id}_${from}`)?.status === "closed") throw refusal("effective_month_closed");
      const entry = s.deals.get(id) ?? { versions: [], commissionMode: "keep" as const };
      entry.versions = [...entry.versions, { id: `v-${Date.now()}`, effectiveFrom: from, deal, note: String(data.note || ""), createdAtMs: Date.now(), createdBy: ME }];
      s.deals.set(id, entry);
      return { success: true };
    }
    case "setCommissionMode": {
      const entry = s.deals.get(id) ?? { versions: [], commissionMode: "keep" as const };
      const mode = data.mode === "replace" ? "replace" : "keep";
      const changed = entry.commissionMode !== mode;
      entry.commissionMode = mode;
      s.deals.set(id, entry);
      return { success: true, mode, changed, notRestored: [] };
    }
    case "recordPayment": {
      const errors = paymentDraftErrors(
        { amount: centsToInput(Number(data.amountCents)), paidOn: String(data.paidOn || ""), method: String(data.method || ""), note: String(data.note || "") },
        todayInNewYork(),
      );
      if (Object.keys(errors).length > 0) throw refusal(errors.paidOn ? "paid_on_invalid" : errors.method ? "method_invalid" : "amount_invalid");
      const doc = monthDoc(s, `${id}_${month}`);
      const amount = Number(data.amountCents);
      if (doc.status === "closed" && doc.paidCents + amount > (doc.amountCents ?? 0)) throw refusal("payment_exceeds_balance");
      s.payments.push({
        id: `p${s.payments.length + 1}`,
        businessId: id,
        month,
        amountCents: amount,
        paidOn: String(data.paidOn),
        method: String(data.method),
        note: String(data.note || ""),
        recordedBy: ME,
        recordedAtMs: Date.now(),
        voided: false,
        voidedBy: "",
        voidedAtMs: null,
        voidReason: "",
      });
      doc.paidCents += amount;
      return { success: true, paidCents: doc.paidCents };
    }
    case "voidPayment": {
      const payment = s.payments.find((p) => p.id === data.paymentId && p.businessId === id);
      if (!payment) throw refusal("payment_not_found");
      if (payment.voided) throw refusal("payment_already_voided");
      payment.voided = true;
      payment.voidedBy = ME;
      payment.voidedAtMs = Date.now();
      payment.voidReason = String(data.reason || "");
      const doc = monthDoc(s, `${id}_${payment.month}`);
      doc.paidCents = Math.max(0, doc.paidCents - payment.amountCents);
      return { success: true, paidCents: doc.paidCents };
    }
    case "closeMonth": {
      if (!monthIsOver(month, current)) throw refusal("month_not_over");
      const doc = monthDoc(s, `${id}_${month}`);
      if (doc.status === "closed") throw refusal("month_already_closed");
      const row = rowFor(s, id, month, current);
      doc.status = "closed";
      doc.amountCents = row.liveBill.amountCents;
      doc.snapshot = { bill: row.liveBill, usage: row.liveUsage, deal: row.deal, dealVersionId: row.dealVersionId };
      doc.closedAtMs = Date.now();
      doc.closedBy = ME;
      return { success: true, amountCents: doc.amountCents, closedAtMs: doc.closedAtMs };
    }
    case "reopenMonth": {
      const reason = String(data.reason || "").trim();
      if (!reason) throw refusal("reason_required");
      const doc = monthDoc(s, `${id}_${month}`);
      if (doc.status !== "closed") throw refusal("month_not_closed");
      doc.reopenHistory = [...doc.reopenHistory, { reopenedAtMs: Date.now(), reopenedBy: ME, reason, closedAmountCents: doc.amountCents ?? 0 }];
      doc.status = "open";
      doc.amountCents = null;
      doc.snapshot = null;
      doc.closedAtMs = null;
      doc.closedBy = "";
      return { success: true, status: "open" };
    }
    default:
      throw refusal("action_invalid");
  }
}
