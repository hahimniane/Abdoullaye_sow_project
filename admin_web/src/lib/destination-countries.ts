import { COUNTRY_CATALOG, type CountryEntry } from "./country-catalog.ts";

export type DestinationCountry = CountryEntry & { nameFr?: string };

const LEGACY_DESTINATION_COUNTRIES: readonly DestinationCountry[] = [
  { id: "burkina_faso", name: "Burkina Faso", code: "BF" },
  { id: "guinea_bissau", name: "Guinea-Bissau", code: "GW" },
  { id: "sierra_leone", name: "Sierra Leone", code: "SL" },
];

export const DESTINATION_COUNTRIES: readonly DestinationCountry[] =
  COUNTRY_CATALOG;

const countryById = new Map<string, DestinationCountry>([
  ...DESTINATION_COUNTRIES.map((country) => [country.id, country] as const),
  ...LEGACY_DESTINATION_COUNTRIES.map((country) => [country.id, country] as const),
]);

const countryByCode = new Map(
  DESTINATION_COUNTRIES.map((country) => [country.code.toUpperCase(), country] as const),
);

const countryBySlug = new Map(
  DESTINATION_COUNTRIES.map((country) => [slug(country.name), country] as const),
);

export function destinationCountryById(countryId: string): DestinationCountry | undefined {
  return countryById.get(countryId.trim());
}

export function destinationCountryName(countryId: string, language: "en" | "fr" = "en") {
  const country = destinationCountryById(countryId);
  if (country) return language === "fr" ? country.nameFr ?? country.name : country.name;
  return titleize(countryId);
}

export function destinationCountryOptionForRow(row: {
  id?: unknown;
  name?: unknown;
  destinationCountryName?: unknown;
  code?: unknown;
  countryCode?: unknown;
}): DestinationCountry {
  const rowId = stringValue(row.id);
  const knownById = destinationCountryById(rowId);
  if (knownById) return knownById;

  const rowCode = stringValue(row.code ?? row.countryCode).toUpperCase();
  const knownByCode = rowCode ? countryByCode.get(rowCode) : undefined;
  const rowName = stringValue(row.destinationCountryName ?? row.name);
  const knownByName = rowName ? countryBySlug.get(slug(rowName)) : undefined;
  const known = knownByCode ?? knownByName;

  return {
    id: rowId || known?.id || slug(rowName),
    name: known?.name ?? (rowName || titleize(rowId)),
    code: known?.code ?? rowCode,
    nameFr: known?.nameFr,
  };
}

export function withSelectedDestinationCountry(
  options: readonly DestinationCountry[],
  selected: DestinationCountry,
): readonly DestinationCountry[] {
  if (!selected.id || options.some((country) => country.id === selected.id)) {
    return options;
  }
  return [selected, ...options];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1));
}
