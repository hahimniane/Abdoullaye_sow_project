import type { Timestamp } from "firebase/firestore";

import { currentWebLanguage, currentWebLocale } from "./language.ts";

export function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && "toDate" in value) {
    const candidate = value as { toDate?: unknown };
    if (typeof candidate.toDate === "function") return candidate.toDate() as Date;
  }
  return null;
}

export function formatDate(value: unknown) {
  const date = asDate(value);
  if (!date) return currentLanguage() === "fr" ? "Non défini" : "Not set";
  return new Intl.DateTimeFormat(currentLocale(), {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatMoney(value: unknown, currency = "USD") {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  const normalizedAmount = Number.isFinite(amount) ? amount : 0;
  const normalizedCurrency = String(currency ?? "").trim().toUpperCase() || "USD";
  const locale = currentLocale();

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(normalizedAmount);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    const formattedAmount = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(normalizedAmount);
    return `${formattedAmount} ${normalizedCurrency}`;
  }
}

export function optionalText(value: unknown) {
  return String(value ?? "").trim();
}

export function text(value: unknown, fallback?: string) {
  const normalized = optionalText(value);
  if (normalized) return normalized;
  if (fallback !== undefined) return fallback;
  return currentLanguage() === "fr" ? "Inconnu" : "Unknown";
}

export function currentLanguage() {
  return currentWebLanguage();
}

export function currentLocale() {
  return currentWebLocale();
}
