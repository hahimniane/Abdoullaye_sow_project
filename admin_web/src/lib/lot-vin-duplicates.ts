/**
 * The lot ledger's VIN duplicate rule, as the console reads it (owner
 * decision 2026-10-22). The rule itself lives on the server
 * (`my_flutter_app/functions/lot_ledger.js`): the same car, job and customer
 * is refused (`vin_job_duplicate`); the same car and job for another customer
 * asks first (`vin_job_repeat_confirm`, resent with `confirmRepeat: true`).
 * The "Possible duplicates" list is computed by the server too
 * (`getLotLedgerTotals` with `action: "vinDuplicates"`), over every activity
 * of the business - the console's own list is paged by date, and a duplicate
 * can sit months apart. This module only parses those answers and words them.
 */

export type LotDuplicateMember = {
  id: string;
  trackingCode: string;
  /** Milliseconds, or null when the record has no date. */
  activityDate: number | null;
  activityTypeId: string;
  activityTypeLabel: string;
  customLabel: string;
  customerName: string;
  customerPhone: string;
  vinNumber: string;
  carYear: string;
  carMake: string;
  carModel: string;
  feeCents: number;
  amountPaidCents: number;
  paymentStatus: string;
  paymentMethod: string;
};

export type LotDuplicateGroup = {
  key: string;
  vinKey: string;
  jobKey: string;
  jobLabel: string;
  /** Two of its records are for the same customer: likely a mistake. */
  sameCustomer: boolean;
  activities: LotDuplicateMember[];
};

/** One earlier record a refusal names. `activityDate` is an ISO string. */
export type LotVinJobExisting = {
  activityId: string;
  trackingCode: string;
  activityDate: string;
  customerName: string;
};

export type LotVinJobRefusal =
  | { kind: "duplicate"; existing: LotVinJobExisting }
  | { kind: "repeat"; existing: LotVinJobExisting[] };

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function member(value: unknown): LotDuplicateMember {
  const row = record(value);
  const date = Number(row.activityDate);
  return {
    id: str(row.id),
    trackingCode: str(row.trackingCode),
    activityDate: Number.isFinite(date) && date > 0 ? date : null,
    activityTypeId: str(row.activityTypeId),
    activityTypeLabel: str(row.activityTypeLabel),
    customLabel: str(row.customLabel),
    customerName: str(row.customerName),
    customerPhone: str(row.customerPhone),
    vinNumber: str(row.vinNumber),
    carYear: str(row.carYear),
    carMake: str(row.carMake),
    carModel: str(row.carModel),
    feeCents: num(row.feeCents),
    amountPaidCents: num(row.amountPaidCents),
    paymentStatus: str(row.paymentStatus),
    paymentMethod: str(row.paymentMethod),
  };
}

/**
 * The groups out of a `vinDuplicates` answer. Anything malformed is dropped,
 * and a group needs two records to be a group at all.
 */
export function lotDuplicateGroupsFrom(data: unknown): LotDuplicateGroup[] {
  const list = record(data).duplicates;
  if (!Array.isArray(list)) return [];
  const groups: LotDuplicateGroup[] = [];
  for (const raw of list) {
    const row = record(raw);
    const activities = Array.isArray(row.activities)
      ? row.activities.map(member).filter((m) => m.id)
      : [];
    if (activities.length < 2) continue;
    groups.push({
      key: str(row.key) || `${str(row.vinKey)}|${str(row.jobKey)}`,
      vinKey: str(row.vinKey),
      jobKey: str(row.jobKey),
      jobLabel: str(row.jobLabel),
      sameCustomer: row.sameCustomer === true,
      activities,
    });
  }
  return groups;
}

function existing(value: unknown): LotVinJobExisting {
  const row = record(value);
  return {
    activityId: str(row.activityId),
    trackingCode: str(row.trackingCode),
    activityDate: str(row.activityDate),
    customerName: str(row.customerName),
  };
}

/**
 * The duplicate rule's refusal inside a callable error, or null for any
 * other error. Reads the `details.reason` the server sets; the Firebase SDK
 * prefixes the code ("functions/already-exists"), so the code is not relied
 * on.
 */
export function lotVinJobRefusal(error: unknown): LotVinJobRefusal | null {
  const details = record(record(error).details);
  if (details.reason === "vin_job_duplicate") {
    return {
      kind: "duplicate",
      existing: {
        activityId: str(details.existingActivityId),
        trackingCode: str(details.existingTrackingCode),
        activityDate: str(details.existingActivityDate),
        customerName: str(details.existingCustomerName),
      },
    };
  }
  if (details.reason === "vin_job_repeat_confirm") {
    const list = Array.isArray(details.existing) ? details.existing.map(existing) : [];
    return { kind: "repeat", existing: list };
  }
  return null;
}

/** "…3A004352": the last 8 characters of a VIN, as the lists show it. */
export function lotVinTail(vin: string): string {
  const key = vin.toUpperCase().replace(/\s+/g, "");
  return key ? `…${key.slice(-8)}` : "";
}

/** "a Dispatch", "an Auction purchase". */
function withArticle(job: string): string {
  return `${/^[aeiou]/i.test(job) ? "an" : "a"} ${job}`;
}

/**
 * The refusal shown on the form: "This car already has a Dispatch for this
 * customer: LA-K7M4P2 (Oct 1, 2026)". Built in the page's language, because
 * it carries typed values the dictionary must not touch.
 */
export function lotDuplicateNotice(
  job: string,
  found: LotVinJobExisting,
  formatDate: (value: unknown) => string,
  lang: "en" | "fr",
): string {
  const name = job.trim() || (lang === "fr" ? "ce travail" : "job");
  const when = found.activityDate ? ` (${formatDate(found.activityDate)})` : "";
  const code = found.trackingCode || (lang === "fr" ? "sans code" : "no code");
  if (lang === "fr") {
    return `Cette voiture a déjà « ${name} » pour ce client : ${code}${when}`;
  }
  return `This car already has ${withArticle(name)} for this customer: ${code}${when}`;
}

/**
 * The question before a repeat for another customer: "This car already had
 * a Dispatch on Oct 1, 2026 for Fatou Camara (LA-K7M4P2). Record another for
 * this customer?" - both languages, for confirmImportantAction.
 */
export function lotRepeatQuestion(
  job: string,
  found: LotVinJobExisting[],
  formatDate: (value: unknown) => string,
): { en: string; fr: string } {
  const list = found.length > 0 ? found : [{ activityId: "", trackingCode: "", activityDate: "", customerName: "" }];
  const each = (lang: "en" | "fr") =>
    list
      .map((row) => {
        const on = row.activityDate ? `${lang === "fr" ? "le" : "on"} ${formatDate(row.activityDate)} ` : "";
        const who = row.customerName || (lang === "fr" ? "un autre client" : "another customer");
        const code = row.trackingCode ? ` (${row.trackingCode})` : "";
        return `${on}${lang === "fr" ? "pour" : "for"} ${who}${code}`;
      })
      .join(", ");
  const name = job.trim();
  return {
    en: `This car already had ${withArticle(name || "job")} ${each("en")}. Record another for this customer?`,
    fr: `Cette voiture a déjà eu « ${name || "ce travail"} » ${each("fr")}. En enregistrer un autre pour ce client ?`,
  };
}
